import { randomUUID } from "node:crypto";
import type { WSEvents, WSContext, WSMessageReceive } from "hono/ws";
import {
  MAX_AGENT_SELECTED_REFERENCES,
  type AgentConversationContextSnapshot,
  type AgentConversationOutputReference,
  type AgentClientMessage,
  type AgentClientMessageType,
  type AgentContextResolvedReference,
  type AgentErrorEvent,
  type AgentSelectedCanvasReference,
  type AgentServerEvent,
  type AgentToolCallEvent,
  type GeneratedAsset,
  type GenerationPlan
} from "../contracts.js";
import { getAgentConversationContext, saveAgentConversationContext } from "./conversation-store.js";
import { getUsableAgentLlmConfig } from "./config.js";
import {
  executeGenerationPlan,
  isExecutableGenerationPlan,
  type StoredAgentGenerationPlan
} from "./executor.js";
import {
  DEEPAGENT_DEEPSEEK_THINKING_MODE,
  DEEPAGENT_PLANNING_CHECKPOINTER,
  DEEPAGENT_PLANNING_HITL_TOOLS,
  DEEPAGENT_PLANNING_MEMORY_SOURCES,
  DEEPAGENT_PLANNING_SKILL_SOURCES,
  DEEPAGENT_PLANNING_SUBAGENTS,
  createGenerationPlan,
  type AgentPlannerConversationContext
} from "./planner.js";
import { resolveAvailablePlanningSkillLoadout } from "./skill-store.js";
import { getStoredAssetFile, saveReferenceImageInput } from "../generation/image-generation.js";

const OPEN_READY_STATE = 1;
const AGENT_SOCKET_SERVER_HEARTBEAT_INTERVAL_MS = 10_000;
const AGENT_ACTIVE_DISCONNECT_GRACE_MS = 2 * 60 * 60 * 1000;
const AGENT_IDLE_DISCONNECT_GRACE_MS = 5 * 60 * 1000;
const AGENT_PENDING_EVENT_LIMIT = 500;
const CLIENT_MESSAGE_TYPES: readonly AgentClientMessageType[] = [
  "user_message",
  "revise_plan",
  "execute_plan",
  "cancel_run",
  "retry_failed",
  "ping"
];
const AGENT_WORK_MESSAGE_TYPES = new Set<AgentClientMessageType>([
  "user_message",
  "revise_plan",
  "execute_plan",
  "retry_failed"
]);

interface ActiveAgentRun {
  id: string;
  controller: AbortController;
  cancelled: boolean;
}

interface AgentSocketSession {
  connectionId: string;
  conversationId?: string;
  ws?: WSContext;
  activeRun?: ActiveAgentRun;
  plans: Map<string, StoredAgentGenerationPlan>;
  conversationContext: AgentConversationContext;
  pendingEvents: AgentServerEvent[];
  keepAliveTimer?: ReturnType<typeof setInterval>;
  disconnectTimer?: ReturnType<typeof setTimeout>;
}

interface AgentConversationContext {
  previousUserText?: string;
  pendingUserText?: string;
  previousPlan?: GenerationPlan;
  previousOutputs: AgentConversationOutputReference[];
  pendingOutputsByRun: Map<string, AgentConversationOutputReference[]>;
}

interface ParsedMessage {
  ok: true;
  value: AgentClientMessage;
}

interface MessageParseError {
  ok: false;
  code: string;
  message: string;
}

const sessions = new Map<string, AgentSocketSession>();

export function createAgentWebSocketEvents(connectionId?: string, runId?: string, conversationId?: string): WSEvents {
  const { resumeFailedRunId, session } = resolveAgentSocketSession(connectionId, runId, conversationId);

  return {
    onOpen(_event, ws) {
      attachAgentSocket(session, ws);
      sendDirectEvent(ws, {
        type: "connected",
        connectionId: session.connectionId,
        conversationId: session.conversationId,
        restoredContext: hasConversationContext(session.conversationContext),
        timestamp: new Date().toISOString()
      });
      if (resumeFailedRunId) {
        sendSessionError(session, {
          code: "agent_session_expired",
          message: "Agent session expired before the browser could reconnect. Start a new Agent run.",
          runId: resumeFailedRunId,
          recoverable: true
        });
        sendSessionEvent(session, {
          type: "run_done",
          runId: resumeFailedRunId,
          status: "failed",
          timestamp: new Date().toISOString()
        });
      }
      flushPendingSessionEvents(session);
    },
    onMessage(event, ws) {
      handleAgentMessage(event.data, ws, session);
    },
    onClose(_event, ws) {
      detachAgentSocket(session, ws, "socket_disconnected");
    },
    onError(_event, ws) {
      detachAgentSocket(session, ws, "socket_error");
    }
  };
}

export function closeAllAgentSessions(reason = "server_shutdown"): void {
  for (const session of sessions.values()) {
    cancelActiveRun(session, reason);
    disposeAgentSession(session);
  }
  sessions.clear();
}

function createAgentSocketSession(conversationId?: string): AgentSocketSession {
  const contextSnapshot = getAgentConversationContext(conversationId);
  return {
    connectionId: randomUUID(),
    conversationId: normalizeConversationId(conversationId),
    plans: new Map(),
    conversationContext: conversationContextFromSnapshot(contextSnapshot),
    pendingEvents: []
  };
}

function normalizeConversationId(value: string | undefined): string | undefined {
  const id = value?.trim();
  return id && /^[a-zA-Z0-9:_-]{1,120}$/u.test(id) ? id : undefined;
}

function conversationContextFromSnapshot(snapshot: AgentConversationContextSnapshot | undefined): AgentConversationContext {
  return {
    previousUserText: snapshot?.previousUserText,
    pendingUserText: snapshot?.pendingUserText,
    previousPlan: snapshot?.previousPlan,
    previousOutputs: snapshot?.previousOutputs ?? [],
    pendingOutputsByRun: new Map()
  };
}

function hasConversationContext(context: AgentConversationContext): boolean {
  return Boolean(context.pendingUserText || context.previousUserText || context.previousPlan || context.previousOutputs.length > 0);
}

function resolveAgentSocketSession(
  requestedConnectionId?: string,
  requestedRunId?: string,
  requestedConversationId?: string
): { session: AgentSocketSession; resumeFailedRunId?: string } {
  const connectionId = requestedConnectionId?.trim();
  const runId = requestedRunId?.trim();
  const conversationId = normalizeConversationId(requestedConversationId);
  if (connectionId) {
    const existingSession = sessions.get(connectionId);
    if (existingSession) {
      existingSession.conversationId ??= conversationId;
      return { session: existingSession };
    }
  }

  if (runId) {
    const activeRunSession = [...sessions.values()].find((session) => session.activeRun?.id === runId);
    if (activeRunSession) {
      activeRunSession.conversationId ??= conversationId;
      return { session: activeRunSession };
    }
  }

  const session = createAgentSocketSession(conversationId);
  return {
    session,
    resumeFailedRunId: connectionId && runId ? runId : undefined
  };
}

function attachAgentSocket(session: AgentSocketSession, ws: WSContext): void {
  clearSessionDisconnectTimer(session);
  if (session.ws && session.ws !== ws) {
    closeAgentSocket(session.ws, 1012, "agent_session_replaced");
  }

  session.ws = ws;
  sessions.set(session.connectionId, session);
  startSessionKeepAlive(session);
}

function detachAgentSocket(session: AgentSocketSession, ws: WSContext, reason: string): void {
  if (session.ws !== ws) {
    return;
  }

  session.ws = undefined;
  stopSessionKeepAlive(session);
  scheduleDisconnectedSessionCleanup(session, reason);
}

function scheduleDisconnectedSessionCleanup(session: AgentSocketSession, reason = "socket_disconnected"): void {
  if (session.ws) {
    clearSessionDisconnectTimer(session);
    return;
  }

  clearSessionDisconnectTimer(session);
  const timeoutMs = session.activeRun ? AGENT_ACTIVE_DISCONNECT_GRACE_MS : AGENT_IDLE_DISCONNECT_GRACE_MS;
  session.disconnectTimer = setTimeout(() => {
    if (session.ws) {
      return;
    }

    if (session.activeRun) {
      cancelActiveRun(session, reason);
    }
    disposeAgentSession(session);
  }, timeoutMs);
}

function clearSessionDisconnectTimer(session: AgentSocketSession): void {
  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
    session.disconnectTimer = undefined;
  }
}

function startSessionKeepAlive(session: AgentSocketSession): void {
  stopSessionKeepAlive(session);
  session.keepAliveTimer = setInterval(() => {
    const ws = session.ws;
    if (!ws) {
      return;
    }

    const heartbeat: AgentServerEvent = {
      type: "pong",
      requestId: `agent-server-heartbeat-${session.connectionId}-${Date.now()}`,
      runId: session.activeRun?.id,
      timestamp: new Date().toISOString()
    };
    if (!sendDirectEvent(ws, heartbeat)) {
      detachAgentSocket(session, ws, "socket_send_failed");
    }
  }, AGENT_SOCKET_SERVER_HEARTBEAT_INTERVAL_MS);
}

function stopSessionKeepAlive(session: AgentSocketSession): void {
  if (session.keepAliveTimer) {
    clearInterval(session.keepAliveTimer);
    session.keepAliveTimer = undefined;
  }
}

function disposeAgentSession(session: AgentSocketSession): void {
  clearSessionDisconnectTimer(session);
  stopSessionKeepAlive(session);
  session.conversationContext.pendingOutputsByRun.clear();
  session.pendingEvents = [];
  session.ws = undefined;
  sessions.delete(session.connectionId);
}

function closeAgentSocket(ws: WSContext, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // The socket may already be closed by the underlying adapter.
  }
}

function flushPendingSessionEvents(session: AgentSocketSession): void {
  const ws = session.ws;
  if (!ws || session.pendingEvents.length === 0) {
    return;
  }

  const events = session.pendingEvents;
  session.pendingEvents = [];
  for (let index = 0; index < events.length; index += 1) {
    if (!sendDirectEvent(ws, events[index])) {
      session.pendingEvents = events.slice(index);
      detachAgentSocket(session, ws, "socket_flush_failed");
      return;
    }
  }
}

function handleAgentMessage(data: WSMessageReceive, _ws: WSContext, session: AgentSocketSession): void {
  const parsed = parseAgentClientMessage(data);
  if (!parsed.ok) {
    sendSessionError(session, {
      code: parsed.code,
      message: parsed.message,
      recoverable: true
    });
    return;
  }

  const message = parsed.value;
  if (message.type === "ping") {
    sendSessionEvent(session, {
      type: "pong",
      requestId: message.requestId,
      runId: message.runId,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (message.type === "cancel_run") {
    const cancelled = cancelActiveRun(session, "client_cancelled", message.runId);
    sendSessionEvent(session, {
      type: "run_cancelled",
      requestId: message.requestId,
      runId: cancelled.runId,
      reason: cancelled.reason,
      alreadyCancelled: cancelled.alreadyCancelled,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (AGENT_WORK_MESSAGE_TYPES.has(message.type)) {
    handleAgentWorkMessage(message, session);
    return;
  }

  sendSessionError(session, {
    code: "unsupported_agent_message",
    message: "Unsupported Agent WebSocket message.",
    requestId: message.requestId,
    runId: message.runId,
    recoverable: true
  });
}

function handleAgentWorkMessage(message: AgentClientMessage, session: AgentSocketSession): void {
  const llmConfig = getUsableAgentLlmConfig();
  if (!llmConfig) {
    sendSessionError(session, {
      code: "missing_agent_config",
      message: "Configure an Agent LLM before using the Agent.",
      requestId: message.requestId,
      runId: message.runId,
      recoverable: true
    });
    return;
  }

  if (message.type === "user_message") {
    if (session.activeRun) {
      sendSessionError(session, {
        code: "agent_run_in_progress",
        message: "An Agent run is already in progress for this connection.",
        requestId: message.requestId,
        runId: session.activeRun.id,
        recoverable: true
      });
      return;
    }

    const runId = message.runId ?? randomUUID();
    const activeRun: ActiveAgentRun = {
      id: runId,
      controller: new AbortController(),
      cancelled: false
    };
    session.activeRun = activeRun;
    void handleAgentPlanMessage(message, session, activeRun, llmConfig);
    return;
  }

  if (message.type === "execute_plan" || message.type === "retry_failed") {
    if (session.activeRun) {
      sendSessionError(session, {
        code: "agent_run_in_progress",
        message: "An Agent run is already in progress for this connection.",
        requestId: message.requestId,
        runId: session.activeRun.id,
        recoverable: true
      });
      return;
    }

    const storedPlan = resolveStoredPlanForExecution(session, message);
    if (!storedPlan) {
      sendSessionError(session, {
        code: "unknown_agent_plan",
        message: "The requested Agent plan is not available. Regenerate the plan or execute it from the canvas node payload.",
        requestId: message.requestId,
        runId: message.runId,
        recoverable: true
      });
      return;
    }

    const runId = message.runId ?? randomUUID();
    const activeRun: ActiveAgentRun = {
      id: runId,
      controller: new AbortController(),
      cancelled: false
    };
    session.activeRun = activeRun;
    void handleAgentPlanExecutionMessage(message, session, activeRun, storedPlan);
    return;
  }

  sendSessionError(session, {
    code: "agent_work_unavailable",
    message: "This Agent action is not available in this build yet.",
    requestId: message.requestId,
    runId: message.runId,
    recoverable: true
  });
}

async function handleAgentPlanMessage(
  message: Extract<AgentClientMessage, { type: "user_message" }>,
  session: AgentSocketSession,
  activeRun: ActiveAgentRun,
  llmConfig: NonNullable<ReturnType<typeof getUsableAgentLlmConfig>>
): Promise<void> {
  let result: Awaited<ReturnType<typeof createGenerationPlan>>;
  const rawClientSelectedReferences = Array.isArray(message.selectedReferences)
    ? (message.selectedReferences as AgentSelectedCanvasReference[])
    : [];
  let clientSelectedReferences: AgentSelectedCanvasReference[];
  try {
    clientSelectedReferences = await persistAgentSelectedReferences(rawClientSelectedReferences);
  } catch (error) {
    finishAgentPlanRunWithError(
      session,
      message,
      activeRun,
      "invalid_selected_references",
      error instanceof Error && error.message ? error.message : "Selected canvas references could not be saved."
    );
    return;
  }
  let effectiveSelectedReferences: AgentSelectedCanvasReference[] = clientSelectedReferences;
  let selectedReferencesForPlanner: unknown = message.selectedReferences ?? [];
  let resolvedConversationReferences: AgentConversationOutputReference[] | undefined;

  const canUseImplicitContextReferences = message.selectedReferences === undefined || Array.isArray(message.selectedReferences);
  if (canUseImplicitContextReferences && clientSelectedReferences.length === 0) {
    const contextResolution = resolveImplicitAgentContextReferences({
      userText: message.text,
      previousOutputs: session.conversationContext.previousOutputs
    });
    if (!contextResolution.ok) {
      finishAgentPlanRunWithError(session, message, activeRun, contextResolution.code, contextResolution.message);
      return;
    }

    if (contextResolution.selectedReferences.length > 0) {
      effectiveSelectedReferences = contextResolution.selectedReferences;
      selectedReferencesForPlanner = effectiveSelectedReferences;
      resolvedConversationReferences = contextResolution.resolvedOutputs;
      sendSessionEvent(session, {
        type: "context_resolved",
        requestId: message.requestId,
        runId: activeRun.id,
        source: "previous_agent_outputs",
        referenceCount: contextResolution.resolvedOutputs.length,
        referenceIndexes: contextResolution.resolvedOutputs.map((output) => output.index),
        references: contextResolution.resolvedOutputs.map(contextResolvedReferenceFromOutput),
        timestamp: new Date().toISOString()
      });
    }
  }

  if (clientSelectedReferences.length > 0) {
    selectedReferencesForPlanner = clientSelectedReferences;
  }

  const conversationContext = createPlannerConversationContext(
    session.conversationContext,
    resolvedConversationReferences,
    resolvedConversationReferences ? "previous_agent_outputs" : clientSelectedReferences.length > 0 ? "manual_selection" : undefined
  );
  const planningSkillLoadout = resolveAvailablePlanningSkillLoadout();
  const plannerToolCallId = `tool-call-${randomUUID()}`;
  const plannerStartedAt = Date.now();
  sendAgentToolCallEvent(session, {
    phase: "started",
    toolCallId: plannerToolCallId,
    toolName: "create_generation_plan",
    requestId: message.requestId,
    runId: activeRun.id,
    input: {
      userText: message.text,
      defaults: message.defaults,
      plannerOptions: message.plannerOptions,
      selectedReferences: effectiveSelectedReferences.map(agentSelectedReferenceTrace),
      conversationContext: conversationContext
        ? {
            previousPlanId: conversationContext.previousPlan?.id,
            previousOutputCount: conversationContext.previousOutputs?.length ?? 0,
            resolvedReferenceCount: conversationContext.resolvedReferences?.length ?? 0,
            referenceResolution: conversationContext.referenceResolution
          }
        : undefined,
      model: llmConfig.model,
      supportsVision: llmConfig.supportsVision,
      skillSelectionMode: "deepagent_progressive_disclosure",
      skills: planningSkillLoadout.skills.map((skill) => skill.slug),
      deepAgent: {
        skillSources: [...DEEPAGENT_PLANNING_SKILL_SOURCES],
        memorySources: [...DEEPAGENT_PLANNING_MEMORY_SOURCES],
        subagents: [...DEEPAGENT_PLANNING_SUBAGENTS],
        hitlTools: [...DEEPAGENT_PLANNING_HITL_TOOLS],
        checkpointer: DEEPAGENT_PLANNING_CHECKPOINTER,
        deepSeekThinkingMode: DEEPAGENT_DEEPSEEK_THINKING_MODE
      }
    }
  });

  try {
    result = await createGenerationPlan({
      userText: message.text,
      defaults: message.defaults,
      selectedReferences: selectedReferencesForPlanner,
      conversationContext,
      plannerOptions: message.plannerOptions,
      llmConfig,
      skillLoadout: planningSkillLoadout,
      onAssistantDelta: (delta) => {
        if (session.activeRun?.id !== activeRun.id || activeRun.cancelled) {
          return;
        }

        sendSessionEvent(session, {
          type: "assistant_delta",
          requestId: message.requestId,
          runId: activeRun.id,
          delta,
          timestamp: new Date().toISOString()
        });
      },
      onThinkingDelta: (delta) => {
        if (session.activeRun?.id !== activeRun.id || activeRun.cancelled) {
          return;
        }

        sendSessionEvent(session, {
          type: "assistant_thinking_delta",
          requestId: message.requestId,
          runId: activeRun.id,
          delta,
          timestamp: new Date().toISOString()
        });
      },
      signal: activeRun.controller.signal
    });
  } catch {
    result = {
      ok: false,
      code: "agent_planner_failed",
      message: "Agent planner request failed."
    };
  }

  if (session.activeRun?.id !== activeRun.id || activeRun.cancelled) {
    return;
  }

  sendAgentToolCallEvent(session, {
    phase: result.ok ? "completed" : "failed",
    toolCallId: plannerToolCallId,
    toolName: "create_generation_plan",
    requestId: message.requestId,
    runId: activeRun.id,
    durationMs: Date.now() - plannerStartedAt,
    output: result.ok
      ? {
          planId: result.plan.id,
          title: result.plan.title,
          status: result.plan.status,
          jobCount: result.plan.jobs.length,
          totalImageCount: result.plan.jobs.reduce((total, job) => total + job.count, 0)
        }
      : {
          code: result.code,
          message: result.message,
          issueCount: result.issues?.length ?? 0
        },
    error: result.ok ? undefined : result.message
  });

  session.activeRun = undefined;
  scheduleDisconnectedSessionCleanup(session);

  if (!result.ok) {
    if (isAgentUserInputErrorCode(result.code)) {
      session.conversationContext.pendingUserText = message.text;
      storeConversationContextForSession(session);
    }

    sendSessionError(session, {
      code: result.code,
      message: result.message,
      requestId: message.requestId,
      runId: activeRun.id,
      recoverable: true
    });
    sendSessionEvent(session, {
      type: "run_done",
      requestId: message.requestId,
      runId: activeRun.id,
      status: "failed",
      timestamp: new Date().toISOString()
    });
    return;
  }

  session.plans.set(result.plan.id, {
    plan: result.plan,
    selectedReferences: sanitizeSelectedReferencesForStorage(effectiveSelectedReferences)
  });
  session.conversationContext.previousUserText = resolvedConversationUserText(
    session.conversationContext.pendingUserText,
    message.text
  );
  session.conversationContext.pendingUserText = undefined;
  session.conversationContext.previousPlan = result.plan;
  storeConversationContextForSession(session);

  sendSessionEvent(session, {
    type: "plan_created",
    requestId: message.requestId,
    runId: activeRun.id,
    plan: result.plan,
    timestamp: new Date().toISOString()
  });
  sendSessionEvent(session, {
    type: "run_done",
    requestId: message.requestId,
    runId: activeRun.id,
    status: "succeeded",
    timestamp: new Date().toISOString()
  });
}

function finishAgentPlanRunWithError(
  session: AgentSocketSession,
  message: Extract<AgentClientMessage, { type: "user_message" }>,
  activeRun: ActiveAgentRun,
  code: string,
  errorMessage: string
): void {
  if (session.activeRun?.id !== activeRun.id || activeRun.cancelled) {
    return;
  }

  session.activeRun = undefined;
  scheduleDisconnectedSessionCleanup(session);
  sendSessionError(session, {
    code,
    message: errorMessage,
    requestId: message.requestId,
    runId: activeRun.id,
    recoverable: true
  });
  sendSessionEvent(session, {
    type: "run_done",
    requestId: message.requestId,
    runId: activeRun.id,
    status: "failed",
    timestamp: new Date().toISOString()
  });
}

function createPlannerConversationContext(
  context: AgentConversationContext,
  resolvedReferences: AgentConversationOutputReference[] | undefined,
  referenceResolution: AgentPlannerConversationContext["referenceResolution"] | undefined
): AgentPlannerConversationContext | undefined {
  const previousUserText = context.pendingUserText ?? context.previousUserText;
  if (!previousUserText && !context.previousPlan && context.previousOutputs.length === 0 && !resolvedReferences?.length) {
    return undefined;
  }

  return {
    previousUserText,
    previousPlan: context.previousPlan,
    previousOutputs: context.previousOutputs,
    resolvedReferences,
    referenceResolution
  };
}

function isAgentUserInputErrorCode(code: string): boolean {
  return code === "missing_selected_canvas_reference" || code === "agent_requires_user_input";
}

function resolvedConversationUserText(pendingUserText: string | undefined, userText: string): string {
  const pending = pendingUserText?.trim();
  const current = userText.trim();
  if (!pending || !isShortClarificationResponse(current)) {
    return current;
  }

  return `Original request: ${pending}\nClarification: ${current}`;
}

function isShortClarificationResponse(userText: string): boolean {
  const text = userText.trim().toLowerCase();
  return (
    text.length <= 80 &&
    /新的设计图|新设计图|编辑原图|直接编辑|生成新的|生成新图|文生图|new design|new image|generate new|edit original|edit selected/u.test(
      text
    )
  );
}

function contextResolvedReferenceFromOutput(output: AgentConversationOutputReference): AgentContextResolvedReference {
  return {
    index: output.index,
    assetId: output.assetId,
    label: output.label
  };
}

async function persistAgentSelectedReferences(
  references: AgentSelectedCanvasReference[]
): Promise<AgentSelectedCanvasReference[]> {
  return Promise.all(
    references.slice(0, MAX_AGENT_SELECTED_REFERENCES).map(async (reference) => {
      const storedAssetId = storedAssetIdForAgentReference(reference.assetId);
      if (storedAssetId) {
        return {
          ...reference,
          assetId: storedAssetId
        };
      }

      if (!reference.dataUrl) {
        return reference;
      }

      const asset = await saveReferenceImageInput({
        dataUrl: reference.dataUrl,
        fileName: fileNameForSelectedReference(reference)
      });

      return {
        ...reference,
        assetId: asset.id,
        label: reference.label ?? asset.fileName,
        width: asset.width,
        height: asset.height,
        mimeType: asset.mimeType
      };
    })
  );
}

function storedAssetIdForAgentReference(assetId: string): string | undefined {
  for (const candidate of storedAssetIdCandidates(assetId)) {
    const stored = getStoredAssetFile(candidate);
    if (stored) {
      return stored.id;
    }
  }

  return undefined;
}

function storedAssetIdCandidates(assetId: string): string[] {
  const trimmed = assetId.trim();
  const candidates = [trimmed];
  const tldrawAssetMatch = /^asset:(.+)$/u.exec(trimmed);
  if (tldrawAssetMatch?.[1]) {
    candidates.push(tldrawAssetMatch[1]);
  }

  return candidates.filter((candidate, index) => candidate && candidates.indexOf(candidate) === index);
}

function fileNameForSelectedReference(reference: AgentSelectedCanvasReference): string | undefined {
  const label = reference.label?.trim();
  if (!label) {
    return undefined;
  }

  if (/\.(png|jpe?g|webp)$/iu.test(label)) {
    return label;
  }

  if (!reference.mimeType) {
    return label;
  }

  const extension = reference.mimeType === "image/jpeg" ? "jpg" : reference.mimeType.split("/")[1] || "png";
  return `${label}.${extension}`;
}

function sanitizeSelectedReferencesForStorage(references: AgentSelectedCanvasReference[]): AgentSelectedCanvasReference[] {
  return references.map(({ dataUrl: _dataUrl, ...reference }) => reference);
}

function agentSelectedReferenceTrace(reference: AgentSelectedCanvasReference): Omit<AgentSelectedCanvasReference, "dataUrl"> {
  const { dataUrl: _dataUrl, ...traceReference } = reference;
  return traceReference;
}

function storeConversationContextForSession(session: AgentSocketSession): void {
  if (!session.conversationId) {
    return;
  }

  saveAgentConversationContext(session.conversationId, {
    previousUserText: session.conversationContext.previousUserText,
    pendingUserText: session.conversationContext.pendingUserText,
    previousPlan: session.conversationContext.previousPlan,
    previousOutputs: session.conversationContext.previousOutputs
  });
}

async function handleAgentPlanExecutionMessage(
  message: Extract<AgentClientMessage, { type: "execute_plan" | "retry_failed" }>,
  session: AgentSocketSession,
  activeRun: ActiveAgentRun,
  storedPlan: StoredAgentGenerationPlan
): Promise<void> {
  let result: Awaited<ReturnType<typeof executeGenerationPlan>>;
  try {
    result = await executeGenerationPlan({
      ...storedPlan,
      mode: message.type === "execute_plan" ? "execute" : "retry_failed",
      requestId: message.requestId,
      runId: activeRun.id,
      signal: activeRun.controller.signal,
      isRunActive: () => session.activeRun?.id === activeRun.id && !activeRun.cancelled,
      sendEvent: (event) => sendAgentExecutionEvent(session, event)
    });
  } catch (error) {
    if (activeRun.controller.signal.aborted || activeRun.cancelled || session.activeRun?.id !== activeRun.id) {
      return;
    }

    const messageText = error instanceof Error && error.message ? error.message : "Agent plan execution failed.";
    sendSessionError(session, {
      code: "agent_execution_failed",
      message: messageText,
      requestId: message.requestId,
      runId: activeRun.id,
      recoverable: true
    });
    sendSessionEvent(session, {
      type: "run_done",
      requestId: message.requestId,
      runId: activeRun.id,
      status: "failed",
      timestamp: new Date().toISOString()
    });
    session.activeRun = undefined;
    scheduleDisconnectedSessionCleanup(session);
    return;
  }

  if (session.activeRun?.id !== activeRun.id || activeRun.cancelled) {
    return;
  }

  session.activeRun = undefined;
  scheduleDisconnectedSessionCleanup(session);
  updateConversationContextAfterExecution(session, activeRun.id, result.plan, storedPlan.plan);
  storeConversationContextForSession(session);
  session.plans.set(result.plan.id, {
    plan: result.plan,
    selectedReferences: storedPlan.selectedReferences
  });
  sendSessionEvent(session, {
    type: "run_done",
    requestId: message.requestId,
    runId: activeRun.id,
    status: result.status,
    timestamp: new Date().toISOString()
  });
}

function sendAgentExecutionEvent(session: AgentSocketSession, event: AgentServerEvent): void {
  if (event.type === "asset_preview") {
    rememberAgentExecutionOutput(session, event);
  } else if (event.type === "plan_updated") {
    session.conversationContext.previousPlan = event.plan;
  }

  sendSessionEvent(session, event);
}

function rememberAgentExecutionOutput(
  session: AgentSocketSession,
  event: Extract<AgentServerEvent, { type: "asset_preview" }>
): void {
  if (!event.runId) {
    return;
  }

  const outputs = session.conversationContext.pendingOutputsByRun.get(event.runId) ?? [];
  const output = outputReferenceFromAssetPreview(event.asset, {
    index: outputs.length + 1,
    planId: event.planId,
    jobId: event.jobId,
    outputId: event.outputId,
    assetId: event.assetId
  });
  const existingIndex = outputs.findIndex(
    (item) => item.assetId === output.assetId && item.jobId === output.jobId && item.outputId === output.outputId
  );
  const nextOutputs = [...outputs];
  if (existingIndex >= 0) {
    nextOutputs[existingIndex] = {
      ...output,
      index: nextOutputs[existingIndex]?.index ?? output.index
    };
  } else {
    nextOutputs.push(output);
  }

  session.conversationContext.pendingOutputsByRun.set(event.runId, nextOutputs);
}

function updateConversationContextAfterExecution(
  session: AgentSocketSession,
  runId: string,
  resultPlan: GenerationPlan,
  fallbackPlan: GenerationPlan
): void {
  session.conversationContext.previousPlan = resultPlan;
  const pendingOutputs = session.conversationContext.pendingOutputsByRun.get(runId);
  session.conversationContext.pendingOutputsByRun.delete(runId);
  if (pendingOutputs?.length) {
    session.conversationContext.previousOutputs = pendingOutputs.slice(0, MAX_AGENT_SELECTED_REFERENCES);
    return;
  }

  const outputsFromPlan = outputReferencesFromPlan(resultPlan);
  if (outputsFromPlan.length) {
    session.conversationContext.previousOutputs = outputsFromPlan.slice(0, MAX_AGENT_SELECTED_REFERENCES);
    return;
  }

  const fallbackOutputs = outputReferencesFromPlan(fallbackPlan);
  if (fallbackOutputs.length) {
    session.conversationContext.previousOutputs = fallbackOutputs.slice(0, MAX_AGENT_SELECTED_REFERENCES);
  }
}

function outputReferencesFromPlan(plan: GenerationPlan): AgentConversationOutputReference[] {
  const outputs: AgentConversationOutputReference[] = [];
  for (const job of plan.jobs) {
    for (const output of job.outputs) {
      if (output.status !== "succeeded" || !output.asset) {
        continue;
      }
      outputs.push(
        outputReferenceFromAsset(output.asset, {
          index: outputs.length + 1,
          planId: plan.id,
          jobId: job.id,
          outputId: output.id
        })
      );
    }
  }

  return outputs;
}

function outputReferenceFromAssetPreview(
  asset: GeneratedAsset,
  input: {
    index: number;
    planId: string;
    jobId: string;
    outputId: string;
    assetId: string;
  }
): AgentConversationOutputReference {
  return {
    ...outputReferenceFromAsset(asset, input),
    assetId: input.assetId
  };
}

function outputReferenceFromAsset(
  asset: GeneratedAsset,
  input: {
    index: number;
    planId?: string;
    jobId?: string;
    outputId?: string;
  }
): AgentConversationOutputReference {
  return {
    index: input.index,
    assetId: asset.id,
    label: asset.fileName,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType,
    planId: input.planId,
    jobId: input.jobId,
    outputId: input.outputId
  };
}

export type AgentImplicitContextReferenceResolution =
  | {
      ok: true;
      selectedReferences: AgentSelectedCanvasReference[];
      resolvedOutputs: AgentConversationOutputReference[];
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

export function resolveImplicitAgentContextReferences(input: {
  userText: string;
  previousOutputs: AgentConversationOutputReference[];
}): AgentImplicitContextReferenceResolution {
  const outputs = input.previousOutputs.filter((output) => output.assetId).slice(0, MAX_AGENT_SELECTED_REFERENCES);
  if (outputs.length === 0 || !hasFollowUpEditAction(input.userText)) {
    return {
      ok: true,
      selectedReferences: [],
      resolvedOutputs: []
    };
  }

  const requestedIndexes = extractRequestedOutputIndexes(input.userText);
  if (requestedIndexes.length > 0) {
    const outOfRangeIndex = requestedIndexes.find((index) => index < 1 || index > outputs.length);
    if (outOfRangeIndex !== undefined) {
      return {
        ok: false,
        code: "agent_context_reference_out_of_range",
        message: `The previous Agent run has ${outputs.length} output image(s), so output ${outOfRangeIndex} is not available. Choose a number from 1 to ${outputs.length}, or ask to edit all outputs.`
      };
    }

    const resolvedOutputs = requestedIndexes.map((index) => outputs[index - 1]).filter(isDefined);
    return successfulImplicitResolution(resolvedOutputs);
  }

  if (hasAllPreviousOutputsTarget(input.userText)) {
    return successfulImplicitResolution(outputs);
  }

  if (hasLastOutputTarget(input.userText)) {
    return successfulImplicitResolution([outputs[outputs.length - 1]].filter(isDefined));
  }

  if (hasAmbiguousPreviousOutputTarget(input.userText)) {
    if (outputs.length === 1) {
      return successfulImplicitResolution(outputs);
    }

    return {
      ok: false,
      code: "agent_context_reference_ambiguous",
      message: `The previous Agent run has ${outputs.length} output images. Specify an output number such as "image 3", or ask to edit all outputs.`
    };
  }

  return {
    ok: true,
    selectedReferences: [],
    resolvedOutputs: []
  };
}

function successfulImplicitResolution(
  outputs: AgentConversationOutputReference[]
): Extract<AgentImplicitContextReferenceResolution, { ok: true }> {
  return {
    ok: true,
    selectedReferences: selectedReferencesFromConversationOutputs(outputs),
    resolvedOutputs: outputs
  };
}

function selectedReferencesFromConversationOutputs(outputs: AgentConversationOutputReference[]): AgentSelectedCanvasReference[] {
  return outputs.slice(0, MAX_AGENT_SELECTED_REFERENCES).map((output) => ({
    id: `previous-agent-output-${output.index}`,
    assetId: output.assetId,
    label: output.label ?? `Agent output ${output.index}`,
    width: output.width,
    height: output.height,
    mimeType: output.mimeType
  }));
}

function hasFollowUpEditAction(userText: string): boolean {
  return /(?:\u7f16\u8f91|\u4fee\u6539|\u8c03\u6574|\u6539\u6210|\u6539\u4e3a|\u4f18\u5316|\u6da6\u8272|\u91cd\u7ed8|\u4fee\u56fe|\u4fdd\u7559|\u57fa\u4e8e|\u52a0\u5b57|\u52a0\u6587\u5b57|\u914d\u5b57|\u914d\u6587|\u6587\u6848|\u6587\u5b57|\u5b57\u4f53|\u5b57\u53f7|\u6807\u9898|\u5b57\u5e55|\u6392\u7248|\u8d34\u5b57|\u53d8\u5927|\u53d8\u5c0f|\u5927\u4e00\u70b9|\u5c0f\u4e00\u70b9|edit|modify|adjust|retouch|polish|redesign|based on|add text|text|caption|title|typography|copy|font|bigger|smaller|larger|resize)/iu.test(
    normalizeAgentContextText(userText)
  );
}

function hasAllPreviousOutputsTarget(userText: string): boolean {
  return /(?:\u6240\u6709|\u5168\u90e8|\u6bcf\u5f20|\u6bcf\u4e00\u5f20|\u6bcf\u4e2a|\u4e0a\u4e00\u8f6e\u8f93\u51fa|\u4e0a\u6b21\u8f93\u51fa|all|each|every|previous outputs?|latest outputs?|generated outputs?)/iu.test(
    normalizeAgentContextText(userText)
  );
}

function hasLastOutputTarget(userText: string): boolean {
  return /(?:\u6700\u540e\u4e00?\u5f20|\u6700\u540e\u4e00?\u4e2a|last image|last output|last one)/iu.test(
    normalizeAgentContextText(userText)
  );
}

function hasAmbiguousPreviousOutputTarget(userText: string): boolean {
  return /(?:\u8fd9\u5f20|\u90a3\u5f20|\u8fd9\u4e2a|\u90a3\u4e2a|\u56fe|\u56fe\u7247|\u753b\u9762|\u521a\u521a|\u521a\u751f\u6210|\u4e0a\u4e00\u8f6e|\u4e0a\u6b21|this image|that image|this one|that one|image|picture|output|previous|latest|generated)/iu.test(
    normalizeAgentContextText(userText)
  );
}

function extractRequestedOutputIndexes(userText: string): number[] {
  const text = normalizeAgentContextText(userText);
  const indexes = new Set<number>();

  for (const match of text.matchAll(/(?:\u7b2c|#)\s*(\d{1,2})\s*(?:\u5f20|\u4e2a|\u5e45|\u4efd|image|output|picture)?/giu)) {
    const index = Number(match[1]);
    if (Number.isSafeInteger(index)) {
      indexes.add(index);
    }
  }

  for (const match of text.matchAll(/(?:image|output|picture)\s*(?:#|number|no\.?)?\s*(\d{1,2})\b/giu)) {
    const index = Number(match[1]);
    if (Number.isSafeInteger(index)) {
      indexes.add(index);
    }
  }

  for (const match of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)\s+(?:image|output|picture)\b/giu)) {
    const index = Number(match[1]);
    if (Number.isSafeInteger(index)) {
      indexes.add(index);
    }
  }

  for (const match of text.matchAll(/\u7b2c\s*([\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u4e24]+)\s*(?:\u5f20|\u4e2a|\u5e45|\u4efd)?/giu)) {
    const index = chineseOrdinalToNumber(match[1] ?? "");
    if (index !== undefined) {
      indexes.add(index);
    }
  }

  return [...indexes].sort((left, right) => left - right);
}

function chineseOrdinalToNumber(value: string): number | undefined {
  const digits = new Map<string, number>([
    ["\u4e00", 1],
    ["\u4e8c", 2],
    ["\u4e24", 2],
    ["\u4e09", 3],
    ["\u56db", 4],
    ["\u4e94", 5],
    ["\u516d", 6],
    ["\u4e03", 7],
    ["\u516b", 8],
    ["\u4e5d", 9]
  ]);
  if (!value) {
    return undefined;
  }

  if (digits.has(value)) {
    return digits.get(value);
  }

  const tenIndex = value.indexOf("\u5341");
  if (tenIndex < 0) {
    return undefined;
  }

  const beforeTen = value.slice(0, tenIndex);
  const afterTen = value.slice(tenIndex + 1);
  const tens = beforeTen ? digits.get(beforeTen) : 1;
  const ones = afterTen ? digits.get(afterTen) : 0;
  if (!tens || ones === undefined) {
    return undefined;
  }

  return tens * 10 + ones;
}

function normalizeAgentContextText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function resolveStoredPlanForExecution(
  session: AgentSocketSession,
  message: Extract<AgentClientMessage, { type: "execute_plan" | "retry_failed" }>
): StoredAgentGenerationPlan | undefined {
  const messagePlan = isExecutableGenerationPlan(message.plan) && message.plan.id === message.planId ? message.plan : undefined;
  const storedPlan = session.plans.get(message.planId);
  const selectedReferences =
    message.selectedReferences ?? storedPlan?.selectedReferences ?? (messagePlan ? selectedReferencesFromPlan(messagePlan) : undefined);

  if (!messagePlan) {
    return storedPlan
      ? {
          ...storedPlan,
          selectedReferences: selectedReferences ?? storedPlan.selectedReferences
        }
      : undefined;
  }

  return {
    plan: messagePlan,
    selectedReferences: selectedReferences ?? selectedReferencesFromPlan(messagePlan)
  };
}

function selectedReferencesFromPlan(plan: GenerationPlan): StoredAgentGenerationPlan["selectedReferences"] {
  const selectedReferences = new Map<string, StoredAgentGenerationPlan["selectedReferences"][number]>();
  for (const job of plan.jobs) {
    for (const reference of job.references) {
      if (reference.kind !== "selected_canvas_image" || !reference.assetId) {
        continue;
      }
      selectedReferences.set(reference.assetId, {
        id: reference.assetId,
        assetId: reference.assetId,
        label: reference.label
      });
    }
  }

  return [...selectedReferences.values()];
}

function cancelActiveRun(
  session: AgentSocketSession,
  reason: string,
  requestedRunId?: string
): { runId?: string; alreadyCancelled: boolean; reason: string } {
  const activeRun = session.activeRun;
  if (!activeRun || (requestedRunId && requestedRunId !== activeRun.id)) {
    return {
      runId: requestedRunId ?? activeRun?.id,
      alreadyCancelled: true,
      reason
    };
  }

  const alreadyCancelled = activeRun.cancelled;
  if (!activeRun.cancelled) {
    activeRun.cancelled = true;
    activeRun.controller.abort(reason);
  }
  session.activeRun = undefined;

  return {
    runId: activeRun.id,
    alreadyCancelled,
    reason
  };
}

function parseAgentClientMessage(data: WSMessageReceive): ParsedMessage | MessageParseError {
  if (typeof data !== "string") {
    return {
      ok: false,
      code: "invalid_agent_message",
      message: "Agent WebSocket messages must be JSON text."
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    return {
      ok: false,
      code: "invalid_json",
      message: "Agent WebSocket message must be valid JSON."
    };
  }

  if (!isRecord(value) || typeof value.type !== "string" || !isAgentClientMessageType(value.type)) {
    return {
      ok: false,
      code: "invalid_agent_message",
      message: `Agent WebSocket message type must be one of: ${CLIENT_MESSAGE_TYPES.join(", ")}.`
    };
  }

  if (value.requestId !== undefined && typeof value.requestId !== "string") {
    return {
      ok: false,
      code: "invalid_agent_message",
      message: "Agent WebSocket requestId must be a string when provided."
    };
  }

  if (value.runId !== undefined && typeof value.runId !== "string") {
    return {
      ok: false,
      code: "invalid_agent_message",
      message: "Agent WebSocket runId must be a string when provided."
    };
  }

  return {
    ok: true,
    value: value as unknown as AgentClientMessage
  };
}

function sendSessionError(
  session: AgentSocketSession,
  input: Omit<AgentErrorEvent, "type" | "timestamp">
): void {
  sendSessionEvent(session, {
    type: "error",
    timestamp: new Date().toISOString(),
    ...input
  });
}

function sendAgentToolCallEvent(
  session: AgentSocketSession,
  input: Omit<AgentToolCallEvent, "type" | "timestamp">
): void {
  const event: AgentToolCallEvent = {
    type: "tool_call",
    timestamp: new Date().toISOString(),
    ...input
  };
  sendSessionEvent(session, event);
}

function sendSessionEvent(session: AgentSocketSession, event: AgentServerEvent): void {
  const ws = session.ws;
  if (ws) {
    if (sendDirectEvent(ws, event)) {
      return;
    }
    detachAgentSocket(session, ws, "socket_send_failed");
  }

  session.pendingEvents.push(event);
  if (session.pendingEvents.length > AGENT_PENDING_EVENT_LIMIT) {
    session.pendingEvents.splice(0, session.pendingEvents.length - AGENT_PENDING_EVENT_LIMIT);
  }
}

function sendDirectEvent(ws: WSContext, event: AgentServerEvent): boolean {
  if (ws.readyState !== OPEN_READY_STATE) {
    return false;
  }

  try {
    ws.send(JSON.stringify(event));
    return true;
  } catch {
    return false;
  }
}

function isAgentClientMessageType(value: string): value is AgentClientMessageType {
  return (CLIENT_MESSAGE_TYPES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
