import { randomUUID } from "node:crypto";
import { MemorySaver } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent, type AnySubAgent, type FileData } from "deepagents";
import type { UsableAgentLlmConfig } from "./config.js";
import {
  createBuiltInPlanningSkillLibraryLoadout,
  createPlanningSkillFiles,
  createPlanningSystemPrompt,
  type PlanningSkillLoadout
} from "./planning-skill.js";
import {
  GENERATION_PLAN_SCHEMA_VERSION,
  IMAGE_QUALITIES,
  MAX_AGENT_SELECTED_REFERENCES,
  MAX_GENERATION_JOB_REFERENCES,
  MAX_GENERATION_PLAN_IMAGES,
  MAX_REFERENCE_IMAGES,
  OUTPUT_FORMATS,
  STYLE_PRESETS,
  validateSceneImageSize,
  type AgentPlannerOptions,
  type AgentReasoningEffort,
  type AgentSelectedCanvasReference,
  type AgentThinkingType,
  type GenerationDependencyEdge,
  type GenerationJob,
  type GenerationJobRole,
  type GenerationJobStatus,
  type GenerationPlan,
  type GenerationPlanDefaults,
  type GenerationPlanValidationCode,
  type GenerationPlanValidationIssue,
  type GenerationPlanValidationResult,
  type GenerationReference,
  type GenerationReferenceKind,
  type GenerationReferenceUsage,
  type ImageQuality,
  type ImageSize,
  type OutputFormat,
  type StylePresetId
} from "../contracts.js";

const DEFAULT_PLAN_SIZE: ImageSize = { width: 1024, height: 1024 };
const DEFAULT_PLAN_QUALITY: ImageQuality = "auto";
const DEFAULT_PLAN_OUTPUT_FORMAT: OutputFormat = "png";
const DEFAULT_PLAN_COUNT = 1;
const MAX_PLANNER_REFLECTION_ATTEMPTS = 1;
const PLANNER_REFLECTION_OUTPUT_PREVIEW_LIMIT = 6000;
const PLANNER_REFLECTION_ISSUE_LIMIT = 8;
const DIRECT_EDIT_FALLBACK_VARIANT_DIRECTIONS = [
  "bold chrome typography and high-contrast editorial flash",
  "pastel magazine collage with softer UI stickers and glossy accents",
  "grunge Y2K layout with silver holographic elements and dense type",
  "cyber UI grid composition with neon sticker details",
  "polished luxury campaign layout with rainbow holographic highlights"
] as const;
const CREATIVE_REFERENCE_FALLBACK_VARIANT_DIRECTIONS = [
  "a fresh pose, wardrobe, and setting matched to the requested style",
  "a different camera angle, lighting mood, and color palette",
  "a new scene composition with styling details that avoid copying the original layout",
  "a more expressive action and background while keeping the referenced subject recognizable",
  "a distinct art-direction treatment that follows the user's requested theme"
] as const;
export const DEEPAGENT_PLANNING_SKILL_SOURCES = ["/skills/"] as const;
export const DEEPAGENT_PLANNING_MEMORY_PATH = "/memories/gpt-image-canvas/AGENTS.md" as const;
export const DEEPAGENT_PLANNING_MEMORY_SOURCES = [DEEPAGENT_PLANNING_MEMORY_PATH] as const;
export const DEEPAGENT_PLANNING_HITL_TOOLS = ["execute"] as const;
export const DEEPAGENT_PLANNING_CHECKPOINTER = "MemorySaver" as const;
export const DEEPAGENT_DEEPSEEK_THINKING_MODE = "enabled_with_reasoning_content_roundtrip" as const;
export const DEEPAGENT_PLANNING_SUBAGENTS = ["general-purpose"] as const;

const GENERATION_JOB_ROLES: readonly GenerationJobRole[] = [
  "final_image",
  "variation",
  "character_anchor",
  "style_anchor",
  "reference_anchor"
];
const GENERATION_JOB_STATUSES: readonly GenerationJobStatus[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "cancelled"
];
const GENERATION_JOB_ROLE_ALIASES: Record<string, GenerationJobRole> = {
  anchor: "reference_anchor",
  anchorimage: "reference_anchor",
  base: "reference_anchor",
  baseimage: "reference_anchor",
  character: "character_anchor",
  characteranchor: "character_anchor",
  characterbase: "character_anchor",
  characterimage: "character_anchor",
  characterreference: "character_anchor",
  characterseed: "character_anchor",
  cover: "final_image",
  coverimage: "final_image",
  detail: "final_image",
  detailimage: "final_image",
  detailpage: "final_image",
  final: "final_image",
  finalimage: "final_image",
  generatedimage: "final_image",
  generateimage: "final_image",
  generation: "final_image",
  hero: "final_image",
  heroimage: "final_image",
  image: "final_image",
  imagegeneration: "final_image",
  intermediate: "reference_anchor",
  intermediateimage: "reference_anchor",
  listingimage: "final_image",
  listingmainimage: "final_image",
  main: "final_image",
  mainimage: "final_image",
  mainvisual: "final_image",
  marketingimage: "final_image",
  moodboard: "style_anchor",
  output: "final_image",
  outputgeneration: "final_image",
  outputimage: "final_image",
  page: "final_image",
  pageimage: "final_image",
  poster: "final_image",
  posterimage: "final_image",
  primary: "final_image",
  primaryimage: "final_image",
  product: "final_image",
  productdetail: "final_image",
  productdetailpage: "final_image",
  producthero: "final_image",
  productimage: "final_image",
  reference: "reference_anchor",
  referenceanchor: "reference_anchor",
  referenceimage: "reference_anchor",
  seedimage: "reference_anchor",
  scene: "final_image",
  sceneimage: "final_image",
  sourceimage: "reference_anchor",
  socialimage: "final_image",
  socialpost: "final_image",
  style: "style_anchor",
  styleanchor: "style_anchor",
  stylebase: "style_anchor",
  styleguide: "style_anchor",
  styleimage: "style_anchor",
  stylemoodboard: "style_anchor",
  stylereference: "style_anchor",
  thumbnail: "final_image",
  variation: "variation",
  variationimage: "variation",
  variant: "variation",
  variantimage: "variation"
};
const GENERATION_REFERENCE_KINDS: readonly GenerationReferenceKind[] = ["selected_canvas_image", "generated_output"];
const GENERATION_REFERENCE_USAGES: readonly GenerationReferenceUsage[] = [
  "subject",
  "character",
  "style",
  "composition",
  "scene",
  "product",
  "other"
];

type PlannerMessageContent =
  | string
  | Array<
      | {
          type: "text";
          text: string;
        }
      | {
          type: "image_url";
          image_url: {
            url: string;
          };
        }
    >;

interface PlannerMessage {
  role: "user";
  content: PlannerMessageContent;
}

export interface GenerationPlanAgentRunner {
  invoke(
    input: {
      messages: PlannerMessage[];
      files?: Record<string, unknown>;
    },
    options?: {
      configurable?: {
        thread_id: string;
      };
      recursionLimit?: number;
      signal?: AbortSignal;
    }
  ): Promise<unknown>;
}

export interface AgentPlannerInput {
  userText: string;
  defaults?: unknown;
  selectedReferences?: unknown;
  conversationContext?: AgentPlannerConversationContext;
  plannerOptions?: unknown;
  llmConfig: UsableAgentLlmConfig;
  onAssistantDelta?: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
  signal?: AbortSignal;
  now?: Date;
  runner?: GenerationPlanAgentRunner;
  skillLoadout?: PlanningSkillLoadout;
}

export interface AgentPlannerConversationOutput {
  index: number;
  assetId: string;
  label?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  planId?: string;
  jobId?: string;
  outputId?: string;
}

export interface AgentPlannerConversationContext {
  previousUserText?: string;
  previousPlan?: GenerationPlan;
  previousOutputs?: AgentPlannerConversationOutput[];
  resolvedReferences?: AgentPlannerConversationOutput[];
  referenceResolution?: "manual_selection" | "previous_agent_outputs";
}

export type AgentPlannerResult =
  | {
      ok: true;
      plan: GenerationPlan;
    }
  | {
      ok: false;
      code: string;
      message: string;
      issues?: GenerationPlanValidationIssue[];
    };

type AgentPlannerFailure = Extract<AgentPlannerResult, { ok: false }>;
type GenerationPlanDefaultsParseResult =
  | AgentPlannerFailure
  | {
      ok: true;
      defaults: GenerationPlanDefaults;
    };
type SelectedReferencesParseResult =
  | AgentPlannerFailure
  | {
      ok: true;
      references: AgentSelectedCanvasReference[];
    };
type PlannerAttemptEvaluation =
  | {
      ok: true;
      plan: GenerationPlan;
    }
  | {
      ok: false;
      failure: AgentPlannerFailure;
      shouldReflect: boolean;
      previousOutput: string;
    };
type SelectedReferencePromptMode = "direct_edit" | "creative_reference";
type SelectedReferenceIntent = {
  requiresSelectedImageEdit: boolean;
  requiresEverySelectedReference: boolean;
  allowsCombinedReferences: boolean;
  requiresSingleCombinedOutput: boolean;
  promptMode: SelectedReferencePromptMode;
};

export interface GenerationPlanValidationContext {
  defaults: GenerationPlanDefaults;
  selectedReferences?: AgentSelectedCanvasReference[];
  now?: Date;
  planId?: string;
}

export async function createGenerationPlan(input: AgentPlannerInput): Promise<AgentPlannerResult> {
  const userText = typeof input.userText === "string" ? input.userText.trim() : "";
  if (!userText) {
    return {
      ok: false,
      code: "invalid_agent_request",
      message: "Agent planning requires non-empty user text."
    };
  }

  const defaultsResult = parseGenerationPlanDefaults(input.defaults);
  if (!defaultsResult.ok) {
    return defaultsResult;
  }

  const selectedReferencesResult = parseSelectedCanvasReferences(input.selectedReferences);
  if (!selectedReferencesResult.ok) {
    return selectedReferencesResult;
  }

  const selectedReferences = selectedReferencesResult.references;
  const selectedReferenceRequestIssue = validateSelectedReferenceEditRequest(userText, selectedReferences);
  if (selectedReferenceRequestIssue) {
    return selectedReferenceRequestIssue;
  }

  const plannerOptions = normalizeAgentPlannerOptions(input.plannerOptions);
  const planningSkillLoadout = input.skillLoadout ?? createBuiltInPlanningSkillLibraryLoadout();
  const runner = input.runner ?? createDeepAgentsPlanner(input.llmConfig, plannerOptions, planningSkillLoadout);
  const now = input.now ?? new Date();
  const planId = `plan-${randomUUID()}`;
  const message = buildPlannerUserMessage({
    userText,
    defaults: defaultsResult.defaults,
    selectedReferences,
    supportsVision: input.llmConfig.supportsVision,
    conversationContext: input.conversationContext
  });

  const planningFiles = {
    ...createPlanningSkillFiles(now, planningSkillLoadout),
    ...createPlanningMemoryFiles(now, {
      userText,
      conversationContext: input.conversationContext
    })
  };
  const invokePlannerAttempt = async (
    messages: PlannerMessage[],
    attemptIndex: number
  ): Promise<AgentPlannerFailure | { ok: true; agentResult: unknown }> => {
    emitAssistantDelta(input.onAssistantDelta, [
      attemptIndex === 0
        ? "我会先把你的需求整理成可执行的图像计划。"
        : "上一次规划没有通过校验，我会让 Agent 反思后重写一次。",
      " "
    ]);
    const runnerOptions: NonNullable<Parameters<GenerationPlanAgentRunner["invoke"]>[1]> = {
      configurable: {
        thread_id: `agent-plan-${planId}-attempt-${attemptIndex + 1}`
      },
      recursionLimit: 30,
      signal: input.signal
    };

    try {
      const agentResult = await runner.invoke(
        {
          messages,
          files: planningFiles
        },
        runnerOptions
      );
      if (input.signal?.aborted) {
        return agentRunCancelledResult();
      }

      const reasoningText = extractReasoningFromAgentResult(agentResult);
      if (reasoningText) {
        emitAssistantDelta(input.onThinkingDelta, [reasoningText]);
      }

      return {
        ok: true,
        agentResult
      };
    } catch (error) {
      if (input.signal?.aborted) {
        return agentRunCancelledResult();
      }

      return {
        ok: false,
        code: "agent_planner_failed",
        message: plannerRequestFailureMessage(error)
      };
    }
  };

  let plannerMessages: PlannerMessage[] = [message];
  let reflectionAttempt = 0;

  while (true) {
    const invocation = await invokePlannerAttempt(plannerMessages, reflectionAttempt);
    if (!invocation.ok) {
      return invocation;
    }

    const modelText = extractTextFromAgentResult(invocation.agentResult) ?? "";
    const evaluation = evaluatePlannerAttemptOutput({
      modelText,
      userText,
      defaults: defaultsResult.defaults,
      selectedReferences,
      now,
      planId
    });

    if (evaluation.ok) {
      emitAssistantDelta(input.onAssistantDelta, ["计划已生成，请在对话卡片中检查细节并确认执行。"]);
      return {
        ok: true,
        plan: evaluation.plan
      };
    }

    if (!evaluation.shouldReflect || reflectionAttempt >= MAX_PLANNER_REFLECTION_ATTEMPTS) {
      return evaluation.failure;
    }
    reflectionAttempt += 1;
    plannerMessages = [message, buildPlannerReflectionUserMessage(evaluation)];
  }
}

function evaluatePlannerAttemptOutput(input: {
  modelText: string;
  userText: string;
  defaults: GenerationPlanDefaults;
  selectedReferences: AgentSelectedCanvasReference[];
  now: Date;
  planId: string;
}): PlannerAttemptEvaluation {
  const previousOutput = input.modelText;
  if (!input.modelText) {
    return {
      ok: false,
      shouldReflect: true,
      previousOutput,
      failure: {
        ok: false,
        code: "invalid_plan_json",
        message: "Agent returned no GenerationPlan JSON."
      }
    };
  }

  const fallbackPlan = createSelectedReferenceEditFallbackPlan(input);
  const userQuestion = parsePlannerUserQuestionModelOutput(input.modelText);
  if (userQuestion) {
    if (!shouldAcceptPlannerUserQuestion(userQuestion, input.userText, input.selectedReferences)) {
      return {
        ok: false,
        shouldReflect: true,
        previousOutput,
        failure: {
          ok: false,
          code: "agent_requires_user_input",
          message:
            "The user request can be planned as a text-to-image request. Do not ask for selected canvas references unless the user explicitly mentions an original, selected, current, or previous image."
        }
      };
    }

    const usableFallbackPlan = fallbackPlan && planSatisfiesRequestedOutputCount(fallbackPlan, input.userText);
    return usableFallbackPlan
      ? {
          ok: true,
          plan: usableFallbackPlan
        }
      : {
          ok: false,
          shouldReflect: false,
          previousOutput,
          failure: userQuestion
        };
  }

  const validated = parseGenerationPlanModelOutput(input.modelText, {
    defaults: input.defaults,
    selectedReferences: input.selectedReferences,
    now: input.now,
    planId: input.planId
  });
  if (!validated.ok) {
    return {
      ok: false,
      shouldReflect: true,
      previousOutput,
      failure: {
        ok: false,
        code: validated.code,
        message: validated.message,
        issues: validated.issues
      }
    };
  }

  const normalizedPlan = normalizeSelectedReferenceUsagesForIntent(validated.plan, {
    userText: input.userText,
    selectedReferences: input.selectedReferences
  });

  const selectedReferenceEditIssue = validateSelectedReferenceEditPlan(normalizedPlan, {
    userText: input.userText,
    selectedReferences: input.selectedReferences
  });
  if (selectedReferenceEditIssue) {
    const usableFallbackPlan = fallbackPlan && planSatisfiesRequestedOutputCount(fallbackPlan, input.userText);
    return usableFallbackPlan
      ? {
          ok: true,
          plan: usableFallbackPlan
        }
      : {
          ok: false,
          shouldReflect: true,
          previousOutput,
          failure: selectedReferenceEditIssue
        };
  }

  const requestedOutputCountIssue = validateRequestedOutputCount(normalizedPlan, input.userText);
  if (requestedOutputCountIssue) {
    const usableFallbackPlan = fallbackPlan && planSatisfiesRequestedOutputCount(fallbackPlan, input.userText);
    return usableFallbackPlan
      ? {
          ok: true,
          plan: usableFallbackPlan
        }
      : {
          ok: false,
          shouldReflect: true,
          previousOutput,
          failure: requestedOutputCountIssue
        };
  }

  return {
    ok: true,
    plan: normalizedPlan
  };
}

function shouldAcceptPlannerUserQuestion(
  question: AgentPlannerFailure,
  userText: string,
  selectedReferences: AgentSelectedCanvasReference[]
): boolean {
  if (question.code !== "missing_selected_canvas_reference") {
    return true;
  }

  return hasSelectedReferenceEditIntent(userText, selectedReferences.length);
}

function agentRunCancelledResult(): AgentPlannerFailure {
  return {
    ok: false,
    code: "agent_run_cancelled",
    message: "Agent planning was cancelled."
  };
}

function emitAssistantDelta(onAssistantDelta: AgentPlannerInput["onAssistantDelta"], chunks: string[]): void {
  if (!onAssistantDelta) {
    return;
  }

  for (const chunk of chunks) {
    onAssistantDelta(chunk);
  }
}

export function createDeepAgentsPlanner(
  config: UsableAgentLlmConfig,
  plannerOptions?: AgentPlannerOptions,
  skillLoadout?: PlanningSkillLoadout
): GenerationPlanAgentRunner {
  const isDeepSeek = isDeepSeekAgentConfig(config);
  const model = createAgentChatModel(config, isDeepSeek, plannerOptions);

  return createDeepAgent({
    model,
    skills: [...DEEPAGENT_PLANNING_SKILL_SOURCES],
    memory: [...DEEPAGENT_PLANNING_MEMORY_SOURCES],
    checkpointer: new MemorySaver(),
    interruptOn: Object.fromEntries(DEEPAGENT_PLANNING_HITL_TOOLS.map((toolName) => [toolName, true])),
    subagents: [] as AnySubAgent[],
    systemPrompt: createPlanningSystemPrompt(skillLoadout),
    tools: []
  }) as unknown as GenerationPlanAgentRunner;
}

export function createPlanningMemoryFiles(
  now = new Date(),
  input?: {
    userText?: string;
    conversationContext?: AgentPlannerConversationContext;
  }
): Record<string, FileData> {
  const timestamp = now.toISOString();
  const memory = createPlanningMemoryContent(input);
  return {
    [DEEPAGENT_PLANNING_MEMORY_PATH]: {
      content: memory.split("\n"),
      created_at: timestamp,
      modified_at: timestamp
    }
  };
}

function createPlanningMemoryContent(input?: {
  userText?: string;
  conversationContext?: AgentPlannerConversationContext;
}): string {
  const contextSummary = formatConversationContextSummary(input?.conversationContext);
  const clarificationSummary = input?.userText
    ? formatClarificationFollowUpSummary(input.userText, input.conversationContext)
    : "";

  return [
    "# gpt-image-canvas Agent Memory",
    "",
    "This file is request-scoped memory seeded by the host application for DeepAgents native memory/context middleware.",
    "Use it as context for planning, not as a place to reveal internal storage details to the user.",
    "",
    contextSummary || "No previous Agent conversation context is available for this request.",
    clarificationSummary ? `\n${clarificationSummary}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function createAgentChatModel(
  config: UsableAgentLlmConfig,
  isDeepSeek = isDeepSeekAgentConfig(config),
  plannerOptions?: AgentPlannerOptions
): ChatOpenAI {
  const modelKwargs = agentModelKwargsForConfig(config, plannerOptions);
  const model = new ChatOpenAI({
    apiKey: config.apiKey,
    configuration: config.baseUrl ? { baseURL: config.baseUrl } : undefined,
    maxRetries: 1,
    model: config.model,
    modelKwargs,
    streaming: isDeepSeek,
    streamUsage: false,
    temperature: isDeepSeek ? undefined : 0,
    timeout: config.timeoutMs
  });
  if (isDeepSeek) {
    attachDeepSeekReasoningContentRoundTrip(model);
  }
  return model;
}

export function agentModelKwargsForConfig(
  config: Pick<UsableAgentLlmConfig, "baseUrl" | "model">,
  plannerOptions?: AgentPlannerOptions
): Record<string, unknown> {
  if (!isDeepSeekAgentConfig(config)) {
    return {};
  }

  const thinkingType = plannerOptions?.thinking?.type ?? "enabled";
  if (thinkingType === "disabled") {
    return {
      thinking: {
        type: "disabled"
      }
    };
  }

  return {
    thinking: {
      type: "enabled"
    },
    reasoning_effort: plannerOptions?.reasoningEffort ?? "high"
  };
}

type DeepSeekChatCompletionRequest = {
  messages?: unknown;
  [key: string]: unknown;
};

type DeepSeekRequestMessage = {
  role?: unknown;
  reasoning_content?: unknown;
  tool_calls?: unknown;
  [key: string]: unknown;
};

type DeepSeekCompletionsAdapter = {
  __deepSeekReasoningContentRoundTripPatched?: boolean;
  _generate?: (...args: unknown[]) => Promise<unknown>;
  _streamResponseChunks?: (...args: unknown[]) => AsyncGenerator<unknown>;
  completionWithRetry?: (...args: unknown[]) => Promise<unknown>;
};

type DeepSeekChatOpenAIAdapter = ChatOpenAI & {
  __deepSeekReasoningContentRoundTripPatched?: boolean;
  completions?: DeepSeekCompletionsAdapter;
  withConfig?: (...args: unknown[]) => unknown;
};

function attachDeepSeekReasoningContentRoundTrip(model: ChatOpenAI): void {
  const adapter = model as DeepSeekChatOpenAIAdapter;
  const mutableAdapter = adapter as unknown as {
    __deepSeekReasoningContentRoundTripPatched?: boolean;
    withConfig?: (...args: unknown[]) => unknown;
    completions?: DeepSeekCompletionsAdapter;
  };
  if (!adapter.__deepSeekReasoningContentRoundTripPatched) {
    mutableAdapter.__deepSeekReasoningContentRoundTripPatched = true;
    const originalWithConfig = mutableAdapter.withConfig?.bind(adapter);
    if (originalWithConfig) {
      mutableAdapter.withConfig = (...args: unknown[]) => {
        const configuredModel = originalWithConfig(...args);
        if (configuredModel && typeof configuredModel === "object") {
          attachDeepSeekReasoningContentRoundTrip(configuredModel as ChatOpenAI);
        }
        return configuredModel;
      };
    }
  }

  const completions = mutableAdapter.completions;
  if (
    !completions?.completionWithRetry ||
    !completions._generate ||
    !completions._streamResponseChunks ||
    completions.__deepSeekReasoningContentRoundTripPatched
  ) {
    return;
  }
  completions.__deepSeekReasoningContentRoundTripPatched = true;

  const originalGenerate = completions._generate.bind(completions);
  const originalStream = completions._streamResponseChunks.bind(completions);
  const originalCompletionWithRetry = completions.completionWithRetry.bind(completions);
  let activeMessages: unknown[] | undefined;
  const reasoningContentByToolCallId = new Map<string, string>();

  completions._generate = async (...args: unknown[]) => {
    const previousMessages = activeMessages;
    activeMessages = Array.isArray(args[0]) ? args[0] : undefined;
    try {
      return await originalGenerate(...args);
    } finally {
      activeMessages = previousMessages;
    }
  };

  completions._streamResponseChunks = async function* (...args: unknown[]) {
    const previousMessages = activeMessages;
    activeMessages = Array.isArray(args[0]) ? args[0] : undefined;
    try {
      yield* originalStream(...args);
    } finally {
      activeMessages = previousMessages;
    }
  };

  completions.completionWithRetry = async (...args: unknown[]) => {
    const [request, requestOptions] = args;
    return originalCompletionWithRetry(
      patchDeepSeekReasoningContentForRequest(
        request as DeepSeekChatCompletionRequest,
        activeMessages,
        reasoningContentByToolCallId
      ),
      requestOptions
    );
  };
}

export function patchDeepSeekReasoningContentForRequest(
  request: DeepSeekChatCompletionRequest,
  langChainMessages: unknown[] | undefined,
  reasoningContentByToolCallId?: Map<string, string>
): DeepSeekChatCompletionRequest {
  if (!Array.isArray(request.messages) || !Array.isArray(langChainMessages)) {
    return request;
  }

  return {
    ...request,
    messages: request.messages.map((message, index) => {
      if (!isRecord(message) || message.role !== "assistant") {
        return message;
      }

      const reasoningContent =
        deepSeekReasoningContentForRequestMessage(message) ??
        deepSeekReasoningContentForLangChainMessage(langChainMessages[index]) ??
        deepSeekReasoningContentFromToolCallMemory(message, reasoningContentByToolCallId);
      if (reasoningContent === undefined && !hasOpenAIToolCalls(message)) {
        return message;
      }

      const patchedMessage = {
        ...message,
        reasoning_content: reasoningContent ?? ""
      } satisfies DeepSeekRequestMessage;
      rememberDeepSeekReasoningContentForToolCalls(patchedMessage, reasoningContentByToolCallId);
      return patchedMessage;
    })
  };
}

function deepSeekReasoningContentForRequestMessage(message: DeepSeekRequestMessage): string | undefined {
  return reasoningContentToText(message.reasoning_content);
}

function deepSeekReasoningContentForLangChainMessage(message: unknown): string | undefined {
  if (!isRecord(message)) {
    return undefined;
  }

  const additionalKwargs = isRecord(message.additional_kwargs) ? message.additional_kwargs : undefined;
  const responseMetadata = isRecord(message.response_metadata) ? message.response_metadata : undefined;
  return (
    reasoningContentToText(additionalKwargs?.reasoning_content) ??
    reasoningContentToText(additionalKwargs?.reasoning) ??
    reasoningContentToText(responseMetadata?.reasoning_content) ??
    reasoningContentToText(responseMetadata?.reasoning)
  );
}

function hasOpenAIToolCalls(message: DeepSeekRequestMessage): boolean {
  return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}

function deepSeekReasoningContentFromToolCallMemory(
  message: DeepSeekRequestMessage,
  reasoningContentByToolCallId: Map<string, string> | undefined
): string | undefined {
  if (!reasoningContentByToolCallId || !Array.isArray(message.tool_calls)) {
    return undefined;
  }

  for (const toolCall of message.tool_calls) {
    const toolCallId = isRecord(toolCall) && typeof toolCall.id === "string" ? toolCall.id : undefined;
    const reasoningContent = toolCallId ? reasoningContentByToolCallId.get(toolCallId) : undefined;
    if (reasoningContent) {
      return reasoningContent;
    }
  }

  return undefined;
}

function rememberDeepSeekReasoningContentForToolCalls(
  message: DeepSeekRequestMessage,
  reasoningContentByToolCallId: Map<string, string> | undefined
): void {
  if (!reasoningContentByToolCallId || !Array.isArray(message.tool_calls)) {
    return;
  }

  const reasoningContent = reasoningContentToText(message.reasoning_content);
  if (!reasoningContent) {
    return;
  }

  for (const toolCall of message.tool_calls) {
    const toolCallId = isRecord(toolCall) && typeof toolCall.id === "string" ? toolCall.id : undefined;
    if (toolCallId) {
      reasoningContentByToolCallId.set(toolCallId, reasoningContent);
    }
  }
}

function normalizeAgentPlannerOptions(input: unknown): AgentPlannerOptions | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const thinkingType = parseAgentThinkingType(input.thinking);
  const reasoningEffort = parseAgentReasoningEffort(input.reasoningEffort);
  if (!thinkingType && !reasoningEffort) {
    return undefined;
  }

  return {
    thinking: thinkingType
      ? {
          type: thinkingType
        }
      : undefined,
    reasoningEffort
  };
}

function parseAgentThinkingType(input: unknown): AgentThinkingType | undefined {
  if (isRecord(input) && typeof input.type === "string") {
    return input.type === "enabled" || input.type === "disabled" ? input.type : undefined;
  }

  return undefined;
}

function parseAgentReasoningEffort(input: unknown): AgentReasoningEffort | undefined {
  return input === "high" || input === "max" ? input : undefined;
}

function isDeepSeekAgentConfig(config: Pick<UsableAgentLlmConfig, "baseUrl" | "model">): boolean {
  const model = config.model.trim().toLowerCase();
  const baseUrl = config.baseUrl?.trim().toLowerCase() ?? "";
  return model.startsWith("deepseek-") || baseUrl.includes("deepseek.");
}

export function parseGenerationPlanDefaults(input: unknown): GenerationPlanDefaultsParseResult {
  if (input === undefined || input === null) {
    return {
      ok: true,
      defaults: {
        size: DEFAULT_PLAN_SIZE,
        quality: DEFAULT_PLAN_QUALITY,
        outputFormat: DEFAULT_PLAN_OUTPUT_FORMAT,
        count: DEFAULT_PLAN_COUNT
      }
    };
  }

  if (!isRecord(input)) {
    return {
      ok: false,
      code: "invalid_plan_defaults",
      message: "Agent defaults must be a JSON object."
    };
  }

  const size = parseOptionalImageSize(input.size) ?? DEFAULT_PLAN_SIZE;
  const sizeValidation = validateSceneImageSize({ size });
  if (!sizeValidation.ok) {
    return {
      ok: false,
      code: "invalid_plan_defaults",
      message: sizeValidation.message
    };
  }

  const quality = parseQuality(input.quality) ?? DEFAULT_PLAN_QUALITY;
  const outputFormat = parseOutputFormat(input.outputFormat) ?? DEFAULT_PLAN_OUTPUT_FORMAT;
  const count = parseGenerationCount(input.count) ?? DEFAULT_PLAN_COUNT;
  const stylePresetId = parseStylePresetId(input.stylePresetId);

  return {
    ok: true,
    defaults: {
      size: sizeValidation.size,
      quality,
      outputFormat,
      count,
      stylePresetId
    }
  };
}

export function parseSelectedCanvasReferences(
  input: unknown
): SelectedReferencesParseResult {
  if (input === undefined || input === null) {
    return {
      ok: true,
      references: []
    };
  }

  if (!Array.isArray(input)) {
    return {
      ok: false,
      code: "invalid_selected_references",
      message: "Selected canvas references must be an array."
    };
  }

  if (input.length > MAX_AGENT_SELECTED_REFERENCES) {
    return {
      ok: false,
      code: "too_many_selected_references",
      message: `Select at most ${MAX_AGENT_SELECTED_REFERENCES} canvas references for Agent planning.`
    };
  }

  const references: AgentSelectedCanvasReference[] = [];
  for (const [index, rawReference] of input.entries()) {
    if (!isRecord(rawReference)) {
      return {
        ok: false,
        code: "invalid_selected_references",
        message: `Selected reference at index ${index} must be an object.`
      };
    }

    const id = stringValue(rawReference.id);
    const assetId = stringValue(rawReference.assetId);
    if (!id || !assetId) {
      return {
        ok: false,
        code: "invalid_selected_references",
        message: `Selected reference at index ${index} must include id and assetId.`
      };
    }

    references.push({
      id,
      assetId,
      label: stringValue(rawReference.label),
      width: positiveIntegerValue(rawReference.width),
      height: positiveIntegerValue(rawReference.height),
      mimeType: stringValue(rawReference.mimeType),
      dataUrl: stringValue(rawReference.dataUrl)
    });
  }

  return {
    ok: true,
    references
  };
}

export function buildPlannerUserMessage(input: {
  userText: string;
  defaults: GenerationPlanDefaults;
  selectedReferences: AgentSelectedCanvasReference[];
  supportsVision: boolean;
  conversationContext?: AgentPlannerConversationContext;
}): PlannerMessage {
  const referenceSummaries = input.selectedReferences.map((reference, index) =>
    formatReferenceSummary(reference, index, input.supportsVision)
  );
  const requestedOutputCount = requestedOutputCountFromUserText(input.userText);
  const selectedReferenceIntent = selectedReferenceEditIntent(input.userText, input.selectedReferences.length);
  const contextSummary = formatConversationContextSummary(input.conversationContext);
  const clarificationSummary = formatClarificationFollowUpSummary(input.userText, input.conversationContext);
  const text = [
    `User request:\n${input.userText.trim()}`,
    `Current Agent defaults:\n${JSON.stringify(input.defaults)}`,
    `supportsVision: ${input.supportsVision ? "true" : "false"}`,
    contextSummary,
    clarificationSummary,
    'Allowed quality values: "auto", "low", "medium", "high". Allowed outputFormat values: "png", "jpeg", "webp". Omit job quality/outputFormat when using defaults.',
    referenceSummaries.length > 0
      ? `Selected canvas references, capped at ${MAX_AGENT_SELECTED_REFERENCES}:\n${referenceSummaries.join("\n")}`
      : "Selected canvas references: none",
    referenceSummaries.length > 0
      ? 'When a job uses a selected_canvas_image reference, set assetId to one of the listed handles such as "ref1", the listed id, or the listed assetId.'
      : "Do not create selected_canvas_image references because no canvas references are selected.",
    requestedOutputCount
      ? `Detected explicit requested final output count: ${requestedOutputCount}. The plan must produce at least ${requestedOutputCount} final output image(s), unless that would exceed the 16-image cap or conflict with a safety/user-input gate. Do not collapse a request for ${requestedOutputCount} variants/prompts/images into a single selected-image edit job with count 1.`
      : "",
    referenceSummaries.length > 0 && selectedReferenceIntent.requiresSelectedImageEdit
      ? selectedReferencePlannerGuidance(selectedReferenceIntent)
      : "",
    referenceSummaries.length === 0 && selectedReferenceIntent.requiresSelectedImageEdit
      ? 'The request appears to depend on original/selected canvas images, but none are selected. Return an AgentUserQuestion with code "missing_selected_canvas_reference".'
      : "",
    input.supportsVision
      ? "Vision mode: image data may be attached below when dataUrl is available."
      : "No-vision mode: selected images are reference handles only. Do not claim visual inspection or describe unseen image contents.",
    "Return only the strict JSON object described by the planning skill."
  ].filter(Boolean).join("\n\n");

  const imageBlocks = input.supportsVision
    ? input.selectedReferences
        .filter((reference) => typeof reference.dataUrl === "string" && reference.dataUrl.trim().length > 0)
        .map((reference) => ({
          type: "image_url" as const,
          image_url: {
            url: reference.dataUrl as string
          }
        }))
    : [];

  if (imageBlocks.length === 0) {
    return {
      role: "user",
      content: text
    };
  }

  return {
    role: "user",
    content: [
      {
        type: "text",
        text
      },
      ...imageBlocks
    ]
  };
}

function selectedReferencePlannerGuidance(intent: SelectedReferenceIntent): string {
  const jobStructureGuidance =
    "Create jobs with selected_canvas_image references; for each/every selected image, create one final_image job per ref with count 1 and exactly one selected_canvas_image reference. If the user explicitly requests multiple variants/prompts/output images, preserve that output count.";
  if (intent.promptMode === "creative_reference") {
    return [
      "Selected-image creative reference mode: the user is asking to use the selected/original image(s) as references for new image(s), variants, or style changes rather than a literal retouch.",
      jobStructureGuidance,
      'For child, person, portrait, photoshoot, avatar, or identity-reference work, each selected_canvas_image reference must use usage "subject" unless the user explicitly needs a reusable character; do not use usage "other" for identity references.',
      'Prompts must say to use the selected image as a subject/identity/style reference and create a new image. Do not use wording such as "Edit the original image", "preserve the pose", "preserve the composition", or "preserve the original scene" unless the user explicitly asks for exact preservation.',
      "Allow pose, action, clothing, background, lighting, composition, and scene to change when the user allows it or the requested style needs it. Do not replace the referenced subject with an unrelated subject."
    ].join(" ");
  }

  return [
    "Selected-image direct edit mode: the user is asking to work on the selected/original image(s). Preserve those images as the source.",
    jobStructureGuidance,
    "Prompts must say to edit the original directly and must forbid blank poster templates, generic geometric backgrounds, or unrelated replacement images."
  ].join(" ");
}

function buildPlannerReflectionUserMessage(input: {
  failure: AgentPlannerFailure;
  previousOutput: string;
}): PlannerMessage {
  const issues = input.failure.issues
    ?.slice(0, PLANNER_REFLECTION_ISSUE_LIMIT)
    .map((feedbackIssue, index) => {
      const path = feedbackIssue.path ? ` path=${JSON.stringify(feedbackIssue.path)}` : "";
      return `${index + 1}. code=${feedbackIssue.code}${path}: ${feedbackIssue.message}`;
    });
  const issueSummary = issues && issues.length > 0 ? `Evaluator feedback:\n${issues.join("\n")}` : "";
  const previousOutput = input.previousOutput.trim()
    ? truncate(input.previousOutput.trim(), PLANNER_REFLECTION_OUTPUT_PREVIEW_LIMIT)
    : "(empty output)";
  const text = [
    "Self-reflection retry request.",
    "Your previous response was not accepted by the app evaluator.",
    `Evaluator code: ${input.failure.code}`,
    `Evaluator message: ${input.failure.message}`,
    issueSummary,
    "Review the original user request, the current Agent defaults, selected references, and your previous output.",
    "Think privately about what needs to change, then revise your previous response into a corrected complete response.",
    "Do not merely patch the named error; re-check the whole plan, including image count limits, references, dependencies, user intent, and output shape.",
    "Return exactly one JSON object. The first non-whitespace character must be { and the last non-whitespace character must be }.",
    'Do not include markdown, code fences, commentary, labels such as "Here is the plan", or trailing text.',
    "If the safe response is an AgentUserQuestion, return it as that single JSON object.",
    `Previous response for reflection:\n${previousOutput}`
  ].filter(Boolean).join("\n\n");

  return {
    role: "user",
    content: text
  };
}

export function parseGenerationPlanModelOutput(
  outputText: string,
  context: GenerationPlanValidationContext
): GenerationPlanValidationResult {
  const parsed = parseStrictJsonObject(outputText);
  if (!parsed.ok) {
    return {
      ok: false,
      code: "invalid_plan_json",
      message: parsed.message,
      issues: [
        {
          code: "invalid_plan_json",
          message: parsed.message
        }
      ]
    };
  }

  return validateGenerationPlan(parsed.value, context);
}

function parsePlannerUserQuestionModelOutput(outputText: string): AgentPlannerFailure | undefined {
  const parsed = parseStrictJsonObject(outputText);
  if (!parsed.ok || !isRecord(parsed.value)) {
    return undefined;
  }

  const kind = normalizedOptionToken(parsed.value.kind ?? parsed.value.type);
  if (kind !== "agentuserquestion" && kind !== "userquestion" && kind !== "requiresuserinput") {
    return undefined;
  }

  const rawCode = stringValue(parsed.value.code);
  const code =
    rawCode === "missing_selected_canvas_reference" || rawCode === "agent_requires_user_input"
      ? rawCode
      : "agent_requires_user_input";
  const message =
    stringValue(parsed.value.message ?? parsed.value.question ?? parsed.value.prompt) ??
    defaultAgentUserInputMessage(code);

  return {
    ok: false,
    code,
    message
  };
}

function createSelectedReferenceEditFallbackPlan(input: {
  userText: string;
  defaults: GenerationPlanDefaults;
  selectedReferences: AgentSelectedCanvasReference[];
  now: Date;
  planId: string;
}): GenerationPlan | undefined {
  const intent = selectedReferenceEditIntent(input.userText, input.selectedReferences.length);
  if (!intent.requiresSelectedImageEdit || input.selectedReferences.length === 0) {
    return undefined;
  }

  const timestamp = input.now.toISOString();
  const references = input.selectedReferences.slice(0, MAX_AGENT_SELECTED_REFERENCES);
  const requestedOutputCount = requestedOutputCountFromUserText(input.userText);
  const referenceUsage: GenerationReferenceUsage = intent.promptMode === "creative_reference" ? "subject" : "scene";
  if (intent.allowsCombinedReferences && intent.requiresSingleCombinedOutput && references.length > MAX_REFERENCE_IMAGES) {
    return undefined;
  }

  let jobs: GenerationJob[] | undefined;
  if (requestedOutputCount && requestedOutputCount > 1) {
    if (
      intent.requiresEverySelectedReference &&
      !intent.allowsCombinedReferences &&
      references.length * requestedOutputCount <= MAX_GENERATION_PLAN_IMAGES
    ) {
      jobs = references.map((reference, index) => ({
        id: `edit_selected_${index + 1}`,
        role: "final_image",
        prompt: selectedReferenceFallbackPrompt(
          input.userText,
          intent.promptMode === "creative_reference"
            ? `Use selected canvas image ref${index + 1} as the subject reference and create ${requestedOutputCount} distinct new images`
            : `Edit selected canvas image ref${index + 1} directly and create ${requestedOutputCount} distinct variants`,
          intent.promptMode
        ),
        count: requestedOutputCount,
        references: [selectedReferenceForFallbackJob(reference, referenceUsage)],
        status: "queued",
        outputs: [],
        visible: true
      }));
    } else if (references.length <= MAX_REFERENCE_IMAGES) {
      jobs = Array.from({ length: requestedOutputCount }, (_, index) => ({
        id: `edit_selected_variant_${index + 1}`,
        role: "final_image",
        prompt: selectedReferenceVariantFallbackPrompt(
          input.userText,
          index + 1,
          requestedOutputCount,
          intent.promptMode
        ),
        count: 1,
        references: references.map((reference) => selectedReferenceForFallbackJob(reference, referenceUsage)),
        status: "queued",
        outputs: [],
        visible: true
      }));
    }
  }

  jobs ??= intent.allowsCombinedReferences && references.length <= MAX_REFERENCE_IMAGES
    ? [
        {
          id: "edit_selected_combined",
          role: "final_image",
          prompt: selectedReferenceFallbackPrompt(
            input.userText,
            intent.promptMode === "creative_reference"
              ? "Use the selected canvas images together as references for a new image"
              : "Edit the selected canvas images together",
            intent.promptMode
          ),
          count: 1,
          references: references.map((reference) => selectedReferenceForFallbackJob(reference, referenceUsage)),
          status: "queued",
          outputs: [],
          visible: true
        }
      ]
    : references.map((reference, index) => ({
        id: `edit_selected_${index + 1}`,
        role: "final_image",
        prompt: selectedReferenceFallbackPrompt(
          input.userText,
          intent.promptMode === "creative_reference"
            ? `Use selected canvas image ref${index + 1} as the subject reference for a new image`
            : `Edit selected canvas image ref${index + 1} directly`,
          intent.promptMode
        ),
        count: 1,
        references: [selectedReferenceForFallbackJob(reference, referenceUsage)],
        status: "queued",
        outputs: [],
        visible: true
      }));

  return {
    schemaVersion: GENERATION_PLAN_SCHEMA_VERSION,
    id: input.planId,
    title: requestedOutputCount && requestedOutputCount > 1
      ? `${requestedOutputCount} Selected Image Variations`
      : references.length > 1
        ? "Edit selected images"
        : "Edit selected image",
    status: "awaiting_confirmation",
    defaults: input.defaults,
    jobs,
    edges: [],
    createdBy: "agent",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function validateSelectedReferenceEditRequest(
  userText: string,
  selectedReferences: AgentSelectedCanvasReference[]
): AgentPlannerFailure | undefined {
  const intent = selectedReferenceEditIntent(userText, selectedReferences.length);
  if (
    !intent.requiresSelectedImageEdit ||
    !intent.allowsCombinedReferences ||
    !intent.requiresSingleCombinedOutput ||
    selectedReferences.length <= MAX_REFERENCE_IMAGES
  ) {
    return undefined;
  }

  return {
    ok: false,
    code: "agent_requires_user_input",
    message: `This request asks to combine ${selectedReferences.length} selected images into one output, but each edit job supports at most ${MAX_REFERENCE_IMAGES} reference images. Select ${MAX_REFERENCE_IMAGES} or fewer images, or ask the Agent to split them into multiple outputs.`
  };
}

function selectedReferenceForFallbackJob(
  reference: AgentSelectedCanvasReference,
  usage: GenerationReferenceUsage = "scene"
): GenerationReference {
  return {
    kind: "selected_canvas_image",
    usage,
    assetId: reference.assetId,
    label: reference.label
  };
}

function selectedReferenceFallbackPrompt(
  userText: string,
  action: string,
  promptMode: SelectedReferencePromptMode = "direct_edit"
): string {
  if (promptMode === "creative_reference") {
    return [
      `${action} according to the user request: ${userText}`,
      "Create a new image from the reference instead of directly editing the original photo.",
      "Keep the referenced subject recognizable and preserve only user-requested identity or subject traits.",
      "Pose, action, clothing, background, lighting, composition, and scene may change to fit the requested style.",
      "Do not copy the original pose, original photo layout, or original scene unless the user explicitly asks for exact preservation.",
      "Do not replace the referenced subject with an unrelated subject."
    ].join(" ");
  }

  return [
    `${action} according to the user request: ${userText}`,
    "Preserve the original image content, composition, perspective, and main subjects.",
    "Add only the requested text/design treatment on top.",
    "Do not create a blank poster template, generic geometric background, or unrelated replacement image."
  ].join(" ");
}

function selectedReferenceVariantFallbackPrompt(
  userText: string,
  index: number,
  total: number,
  promptMode: SelectedReferencePromptMode = "direct_edit"
): string {
  if (promptMode === "creative_reference") {
    const direction =
      CREATIVE_REFERENCE_FALLBACK_VARIANT_DIRECTIONS[
        (index - 1) % CREATIVE_REFERENCE_FALLBACK_VARIANT_DIRECTIONS.length
      ];
    return [
      `Use the selected canvas image(s) as reference for new image variant ${index} of ${total}: ${userText}`,
      `Distinct variant direction: ${direction}.`,
      "Create a new image rather than editing the original photo directly.",
      "Keep the referenced subject recognizable and preserve only user-requested identity or subject traits.",
      "Pose, action, clothing, background, lighting, composition, and scene may change to fit the requested style.",
      "Do not copy the original pose, original photo layout, or original scene unless explicitly requested."
    ].join(" ");
  }

  const direction = DIRECT_EDIT_FALLBACK_VARIANT_DIRECTIONS[(index - 1) % DIRECT_EDIT_FALLBACK_VARIANT_DIRECTIONS.length];
  return [
    `Edit the selected canvas image(s) directly as requested variant ${index} of ${total}: ${userText}`,
    `Distinct variant direction: ${direction}.`,
    "Preserve the original image content, composition, perspective, and main subjects.",
    "Add only the requested text/design treatment on top.",
    "Do not create a blank poster template, generic geometric background, or unrelated replacement image."
  ].join(" ");
}

function validateSelectedReferenceEditPlan(
  plan: GenerationPlan,
  input: {
    userText: string;
    selectedReferences: AgentSelectedCanvasReference[];
  }
): AgentPlannerFailure | undefined {
  const intent = selectedReferenceEditIntent(input.userText, input.selectedReferences.length);
  if (!intent.requiresSelectedImageEdit) {
    return undefined;
  }

  if (input.selectedReferences.length === 0) {
    return {
      ok: false,
      code: "missing_selected_canvas_reference",
      message: defaultAgentUserInputMessage("missing_selected_canvas_reference")
    };
  }

  const finalSelectedReferenceAssetIds = selectedReferenceAssetIdsForFinalJobs(plan);
  if (finalSelectedReferenceAssetIds.size === 0) {
    return {
      ok: false,
      code: "agent_requires_user_input",
      message: defaultAgentUserInputMessage("agent_requires_user_input")
    };
  }

  if (intent.promptMode === "creative_reference") {
    const directEditJob = plan.jobs.find(
      (job) => job.role === "final_image" && jobHasSelectedReference(job) && creativeReferencePromptUsesDirectEditLanguage(job.prompt)
    );
    if (directEditJob) {
      return {
        ok: false,
        code: "agent_requires_user_input",
        message: `Job "${directEditJob.id}" uses direct-edit wording for a creative reference request. Use the selected image as a reference for a new image, and do not require preserving pose, composition, or the original scene unless the user asks for that.`
      };
    }
  }

  if (!intent.requiresEverySelectedReference || intent.allowsCombinedReferences) {
    return undefined;
  }

  const missingReferences = input.selectedReferences.filter(
    (reference) => !finalSelectedReferenceAssetIds.has(reference.assetId)
  );
  if (missingReferences.length === 0) {
    return undefined;
  }

  return {
    ok: false,
    code: "agent_requires_user_input",
    message: `Agent needs a plan that covers every selected image. Missing: ${missingReferences
      .map((reference, index) => reference.label ?? reference.assetId ?? `ref${index + 1}`)
      .join(", ")}.`
  };
}

function normalizeSelectedReferenceUsagesForIntent(
  plan: GenerationPlan,
  input: {
    userText: string;
    selectedReferences: AgentSelectedCanvasReference[];
  }
): GenerationPlan {
  const intent = selectedReferenceEditIntent(input.userText, input.selectedReferences.length);
  if (!intent.requiresSelectedImageEdit || input.selectedReferences.length === 0) {
    return plan;
  }

  let changed = false;
  const jobs = plan.jobs.map((job) => {
    let jobChanged = false;
    const targetUsage = selectedReferenceUsageForIntent(intent, `${input.userText}\n${job.prompt}`);
    const references = job.references.map((reference) => {
      if (reference.kind !== "selected_canvas_image") {
        return reference;
      }

      const usage = normalizedSelectedReferenceUsage(reference.usage, targetUsage, intent.promptMode);
      if (usage === reference.usage) {
        return reference;
      }

      changed = true;
      jobChanged = true;
      return {
        ...reference,
        usage
      };
    });

    return !jobChanged
      ? job
      : {
          ...job,
          references
        };
  });

  return changed
    ? {
        ...plan,
        jobs
      }
    : plan;
}

function selectedReferenceUsageForIntent(
  intent: SelectedReferenceIntent,
  text: string
): GenerationReferenceUsage {
  if (intent.promptMode === "direct_edit") {
    return "scene";
  }

  if (hasProductReferenceLanguage(text)) {
    return "product";
  }

  if (hasStyleReferenceLanguage(text) && !hasPortraitOrCharacterReferenceLanguage(text)) {
    return "style";
  }

  return "subject";
}

function normalizedSelectedReferenceUsage(
  usage: GenerationReferenceUsage,
  targetUsage: GenerationReferenceUsage,
  promptMode: SelectedReferencePromptMode
): GenerationReferenceUsage {
  if (promptMode === "direct_edit") {
    return usage === "other" ? "scene" : usage;
  }

  if (usage === "other") {
    return targetUsage;
  }

  if (targetUsage === "subject" && (usage === "scene" || usage === "composition")) {
    return "subject";
  }

  return usage;
}

function jobHasSelectedReference(job: GenerationJob): boolean {
  return job.references.some((reference) => reference.kind === "selected_canvas_image");
}

function creativeReferencePromptUsesDirectEditLanguage(prompt: string): boolean {
  const text = normalizeIntentText(prompt);
  return (
    /edit (?:the )?(?:original|selected|source|canvas)?\s*(?:image|photo|picture)/u.test(text) ||
    /(?:directly edit|edit .* directly|only enrich|only add|whimsical .* overlay)/u.test(text) ||
    /preserv(?:e|ing).{0,80}(?:pose|posture|composition|perspective|layout|scene|photo content|original photo)/u.test(text) ||
    /(?:strictly|must) preserv(?:e|ing).{0,80}(?:original|pose|posture|composition|scene|layout)/u.test(text) ||
    /do not replace (?:the )?(?:child|subject|person|product|photo|image).{0,80}only/u.test(text)
  );
}

function selectedReferenceAssetIdsForFinalJobs(plan: GenerationPlan): Set<string> {
  const assetIds = new Set<string>();
  for (const job of plan.jobs) {
    if (job.role !== "final_image") {
      continue;
    }
    for (const reference of job.references) {
      if (reference.kind === "selected_canvas_image" && reference.assetId) {
        assetIds.add(reference.assetId);
      }
    }
  }

  return assetIds;
}

function validateRequestedOutputCount(plan: GenerationPlan, userText: string): AgentPlannerFailure | undefined {
  const requestedOutputCount = requestedOutputCountFromUserText(userText);
  if (!requestedOutputCount) {
    return undefined;
  }

  const plannedOutputCount = finalOrVariationOutputCount(plan);
  if (plannedOutputCount >= requestedOutputCount) {
    return undefined;
  }

  return {
    ok: false,
    code: "agent_requires_user_input",
    message: `GenerationPlan produces ${plannedOutputCount} final output image(s), but the user explicitly requested at least ${requestedOutputCount}. Preserve the requested output count instead of collapsing variants into one image.`
  };
}

function planSatisfiesRequestedOutputCount(plan: GenerationPlan, userText: string): GenerationPlan | undefined {
  return validateRequestedOutputCount(plan, userText) ? undefined : plan;
}

function finalOrVariationOutputCount(plan: GenerationPlan): number {
  return plan.jobs.reduce(
    (total, job) => total + (job.role === "final_image" || job.role === "variation" ? job.count : 0),
    0
  );
}

function requestedOutputCountFromUserText(userText: string): number | undefined {
  const text = userText.trim();
  const digitPattern =
    /(\d{1,2})\s*(?:\u5f20|\u5f35|\u5e45|\u4e2a|\u500b|\u6b3e|\u7248|\u5957|images?|pictures?|photos?|outputs?|variations?|variants?|prompts?)/giu;
  const digitCount = firstValidRequestedOutputCount(text, digitPattern, (value) => positiveIntegerValue(value));
  if (digitCount) {
    return digitCount;
  }

  const descriptiveDigitPattern =
    /\b(\d{1,2})(?:\s+[\p{L}-]+){0,6}\s+(?:images?|pictures?|photos?|outputs?|variations?|variants?|prompts?)\b/giu;
  const descriptiveDigitCount = firstValidRequestedOutputCount(text, descriptiveDigitPattern, (value) =>
    positiveIntegerValue(value)
  );
  if (descriptiveDigitCount) {
    return descriptiveDigitCount;
  }

  const chinesePattern =
    /([\u4e00\u4e8c\u4e24\u5169\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]{1,3})\s*(?:\u5f20|\u5f35|\u5e45|\u4e2a|\u500b|\u6b3e|\u7248|\u5957)/gu;
  const chineseCount = firstValidRequestedOutputCount(text, chinesePattern, parseChineseCountToken);
  if (chineseCount) {
    return chineseCount;
  }

  const englishPattern =
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)(?:\s+[\p{L}-]+){0,6}\s+(?:images?|pictures?|photos?|outputs?|variations?|variants?|prompts?)\b/giu;
  return firstValidRequestedOutputCount(text, englishPattern, parseEnglishCountToken);
}

function firstValidRequestedOutputCount(
  text: string,
  pattern: RegExp,
  parseToken: (token: string) => number | undefined
): number | undefined {
  for (const match of text.matchAll(pattern)) {
    const count = parseToken(match[1] ?? "");
    if (count && count <= MAX_GENERATION_PLAN_IMAGES && !isLikelyReferenceCountMention(text, match)) {
      return count;
    }
  }

  return undefined;
}

function isLikelyReferenceCountMention(text: string, match: RegExpMatchArray): boolean {
  const matchedText = match[0]?.toLowerCase() ?? "";
  if (/\b(?:selected|source|reference|original|canvas)\s+(?:images?|pictures?|photos?)\b/u.test(matchedText)) {
    return true;
  }

  const start = match.index ?? 0;
  const end = start + matchedText.length;
  const followingText = text.slice(end, end + 64).toLowerCase();
  return (
    /\b(?:into|to|as)\s+(?:one|1|a single|single)\b/u.test(followingText) ||
    /(?:\u56fe|\u56fe\u7247)?\s*(?:\u7ec4\u5408|\u5408\u6210|\u62fc\u6210|\u505a\u6210)\s*\u4e00\s*(?:\u5f20|\u5f35|\u4e2a|\u500b)/u.test(
      followingText
    )
  );
}

function parseChineseCountToken(token: string): number | undefined {
  const digits: Record<string, number> = {
    "\u4e00": 1,
    "\u4e8c": 2,
    "\u4e24": 2,
    "\u5169": 2,
    "\u4e09": 3,
    "\u56db": 4,
    "\u4e94": 5,
    "\u516d": 6,
    "\u4e03": 7,
    "\u516b": 8,
    "\u4e5d": 9
  };
  if (token === "\u5341") {
    return 10;
  }

  const tenIndex = token.indexOf("\u5341");
  if (tenIndex >= 0) {
    const before = token.slice(0, tenIndex);
    const after = token.slice(tenIndex + 1);
    const tens = before ? digits[before] : 1;
    const ones = after ? digits[after] : 0;
    const count = typeof tens === "number" && typeof ones === "number" ? tens * 10 + ones : undefined;
    return count && count <= MAX_GENERATION_PLAN_IMAGES ? count : undefined;
  }

  return digits[token];
}

function parseEnglishCountToken(token: string): number | undefined {
  const counts: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16
  };
  return counts[token.toLowerCase()];
}

function selectedReferenceEditIntent(userText: string, selectedReferenceCount: number): SelectedReferenceIntent {
  const text = normalizeIntentText(userText);
  const hasSelectedContext =
    selectedReferenceCount > 0 || hasExplicitExistingImageTarget(text) || hasReferenceImageLanguage(text);
  const hasCreativeReferenceAction = hasCreativeSelectedReferenceIntent(text);
  const hasEditAction =
    /编辑|修改|调整|改成|改为|优化|润色|重绘|修图|保留|基于|基础上|加字|加上字|加文字|配字|配上字|配文字|配上文字|配文|文案|标题|字幕|字标|字体|排版|贴字|一致|统一|edit|modify|retouch|polish|redesign|based on|from the original|add text|text overlay|caption|title|typography|copy|font|consistent|unify/u.test(text);
  const requiresEverySelectedReference =
    /每张|每一张|每个|每一个|所有选中|全部选中|所有图|全部图|each image|every image|all selected|all images|for each/u.test(text);
  const allowsCombinedReferences =
    /组合|合成|拼贴|拼成|融合|放在一起|对比|一张海报|combine|merge|collage|montage|together|one poster|single poster|comparison/u.test(text);
  const requiresSingleCombinedOutput =
    /合成一张|拼成一张|做成一张|一张图|一张海报|one image|single image|one poster|single poster/u.test(text);

  return {
    requiresSelectedImageEdit: hasSelectedContext && (hasEditAction || allowsCombinedReferences || hasCreativeReferenceAction),
    requiresEverySelectedReference,
    allowsCombinedReferences,
    requiresSingleCombinedOutput,
    promptMode: hasCreativeReferenceAction ? "creative_reference" : "direct_edit"
  };
}

function hasExplicitExistingImageTarget(text: string): boolean {
  return /原图|原始图|原始图片|原本|选中|所选|当前图|当前图片|这张图|这张图片|这些图|这些图片|刚刚生成|刚才生成|上一轮|上次生成|之前生成|selected image|selected images|selected original|selected originals|original image|original images|source image|source images|current image|current images|this image|these images|previous output|previous outputs|latest output|latest outputs|generated output|generated outputs/u.test(
    text
  );
}

function hasCreativeSelectedReferenceIntent(text: string): boolean {
  const hasCreativeOutput =
    /generate|create|make|render|produce|new image|new images|portrait|photo shoot|photoshoot|variations?|variants?|different images?|\u751f\u6210|\u521b\u4f5c|\u521b\u5efa|\u505a\u6210|\u51fa\u56fe|\u5199\u771f|\u4eba\u50cf|\u8096\u50cf|\u5934\u50cf|\u4e0d\u540c/u.test(
      text
    );
  if (!hasCreativeOutput || hasDirectTextOrOverlayIntent(text)) {
    return false;
  }

  return (
    hasReferenceImageLanguage(text) ||
    hasLooseReferenceTransformationLanguage(text) ||
    hasPortraitOrCharacterReferenceLanguage(text)
  );
}

function hasDirectTextOrOverlayIntent(text: string): boolean {
  return /add text|text overlay|caption|title|typography|copy|font|headline|subtitle|\u52a0\u5b57|\u52a0\u6587\u5b57|\u914d\u5b57|\u914d\u6587|\u6807\u9898|\u5b57\u5e55|\u5b57\u4f53|\u6587\u6848|\u6392\u7248|\u8d34\u5b57/u.test(
    text
  );
}

function hasReferenceImageLanguage(text: string): boolean {
  return /based on|uploaded image|uploaded photo|reference image|source image|selected image|selected photo|original image|original photo|from (?:the )?(?:uploaded|selected|source|original|reference).{0,16}(?:image|photo|picture)|use (?:the )?.{0,24}as (?:a )?reference|\u57fa\u4e8e.{0,16}(?:\u56fe|\u7167|\u4e0a\u4f20|\u539f|\u9009\u4e2d)|\u53c2\u8003.{0,16}(?:\u56fe|\u7167|\u4e0a\u4f20|\u539f|\u9009\u4e2d)|\u4e0a\u4f20\u56fe|\u4e0a\u4f20\u7167/u.test(
    text
  );
}

function hasLooseReferenceTransformationLanguage(text: string): boolean {
  return /not constrained|do not be constrained|not bound|not limited|free to change|can change|may change|pose|posture|action|clothing|outfit|wardrobe|background|scene|composition|\u4e0d\u62d8\u6ce5|\u4e0d\u9650|\u4e0d\u8981\u4fdd\u7559|\u65e0\u9700\u4fdd\u7559|\u53ef\u4ee5.{0,12}(?:\u4e0d\u540c|\u6539|\u6362)|\u52a8\u4f5c|\u59ff\u52bf|\u670d\u9970|\u670d\u88c5|\u8863\u670d|\u80cc\u666f|\u573a\u666f|\u6784\u56fe/u.test(
    text
  );
}

function hasPortraitOrCharacterReferenceLanguage(text: string): boolean {
  return /portrait|photo shoot|photoshoot|headshot|avatar|character|children's artistic|\u5199\u771f|\u827a\u672f\u7167|\u4eba\u50cf|\u8096\u50cf|\u5934\u50cf|\u513f\u7ae5|\u5c0f\u5b69|\u5b69\u5b50/u.test(
    text
  );
}

function hasProductReferenceLanguage(text: string): boolean {
  return /product|sku|packshot|merchandise|goods|item|listing|marketplace|\u4ea7\u54c1|\u5546\u54c1|\u8d27\u54c1|\u5355\u54c1|\u4e3b\u56fe|\u8be6\u60c5/u.test(
    text
  );
}

function hasStyleReferenceLanguage(text: string): boolean {
  return /style|aesthetic|look and feel|moodboard|palette|visual direction|\u98ce\u683c|\u7f8e\u5b66|\u89c6\u89c9|\u8272\u5f69|\u914d\u8272/u.test(
    text
  );
}

function hasSelectedReferenceEditIntent(userText: string, selectedReferenceCount = 0): boolean {
  return selectedReferenceEditIntent(userText, selectedReferenceCount).requiresSelectedImageEdit;
}

function normalizeIntentText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function defaultAgentUserInputMessage(code: "missing_selected_canvas_reference" | "agent_requires_user_input"): string {
  return code === "missing_selected_canvas_reference"
    ? "Please select the original canvas image(s) to edit, then send the Agent request again."
    : "Please confirm whether the Agent should edit the selected original image(s) directly or generate a new design image.";
}

export function validateGenerationPlan(
  input: unknown,
  context: GenerationPlanValidationContext
): GenerationPlanValidationResult {
  const issues: GenerationPlanValidationIssue[] = [];
  const now = (context.now ?? new Date()).toISOString();

  if (!isRecord(input)) {
    return invalidPlan("invalid_plan_schema", "GenerationPlan must be a JSON object.");
  }

  if (input.schemaVersion !== GENERATION_PLAN_SCHEMA_VERSION) {
    issues.push(issue("invalid_plan_schema", `schemaVersion must be ${GENERATION_PLAN_SCHEMA_VERSION}.`, "schemaVersion"));
  }

  const title = stringValue(input.title);
  if (!title) {
    issues.push(issue("invalid_plan_schema", "Plan title is required.", "title"));
  }

  if (input.status !== "awaiting_confirmation") {
    issues.push(
      issue(
        "invalid_plan_schema",
        'Plan status must be "awaiting_confirmation" before user confirmation.',
        "status"
      )
    );
  }

  if (input.createdBy !== "agent") {
    issues.push(issue("invalid_plan_schema", 'createdBy must be "agent".', "createdBy"));
  }

  const defaults = parsePlanDefaultsFromPlan(input.defaults, context.defaults, issues);
  const jobs = parsePlanJobs(input.jobs, defaults, context, issues);
  const edges = parsePlanEdges(input.edges, issues);

  if (issues.length === 0) {
    validatePlanGraph(jobs, edges, context.selectedReferences ?? [], issues);
  }

  if (issues.length > 0) {
    return invalidPlan(issues[0]?.code ?? "invalid_plan_schema", issues[0]?.message ?? "Invalid GenerationPlan.", issues);
  }

  const plan: GenerationPlan = {
    schemaVersion: GENERATION_PLAN_SCHEMA_VERSION,
    id: context.planId ?? stringValue(input.id) ?? `plan-${randomUUID()}`,
    title: title ?? "Untitled plan",
    status: "awaiting_confirmation",
    defaults,
    jobs,
    edges,
    createdBy: "agent",
    createdAt: now,
    updatedAt: now
  };

  return {
    ok: true,
    plan
  };
}

export function extractTextFromAgentResult(result: unknown): string | undefined {
  if (typeof result === "string") {
    return nonEmptyString(result);
  }

  if (!isRecord(result)) {
    return undefined;
  }

  const directOutput = contentToText(result.output) ?? contentToText(result.structuredResponse);
  if (directOutput) {
    return directOutput;
  }

  if (Array.isArray(result.messages)) {
    for (let index = result.messages.length - 1; index >= 0; index -= 1) {
      const message = result.messages[index];
      if (!isRecord(message)) {
        continue;
      }
      const text = contentToText(message.content);
      if (text) {
        return text;
      }
    }
  }

  return undefined;
}

export function extractReasoningFromAgentResult(result: unknown): string | undefined {
  const chunks: string[] = [];
  const seen = new Set<string>();

  collectReasoningText(result, chunks, seen);
  if (isRecord(result) && Array.isArray(result.messages)) {
    for (const message of result.messages) {
      collectReasoningText(message, chunks, seen);
    }
  }

  return nonEmptyString(chunks.join("\n\n"));
}

function collectReasoningText(value: unknown, chunks: string[], seen: Set<string>): void {
  if (!isRecord(value)) {
    return;
  }

  for (const candidate of reasoningCandidates(value)) {
    const text = reasoningContentToText(candidate);
    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    chunks.push(text);
  }
}

function reasoningCandidates(value: Record<string, unknown>): unknown[] {
  return [
    value.reasoning_content,
    value.reasoning,
    isRecord(value.additional_kwargs) ? value.additional_kwargs.reasoning_content : undefined,
    isRecord(value.additional_kwargs) ? value.additional_kwargs.reasoning : undefined,
    isRecord(value.response_metadata) ? value.response_metadata.reasoning_content : undefined,
    isRecord(value.response_metadata) ? value.response_metadata.reasoning : undefined
  ];
}

function reasoningContentToText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return nonEmptyString(value);
  }

  if (Array.isArray(value)) {
    const text = value
      .map((item) => reasoningContentToText(item) ?? "")
      .filter(Boolean)
      .join("\n")
      .trim();
    return nonEmptyString(text);
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const direct = contentToText(value.text) ?? contentToText(value.content) ?? contentToText(value.summary);
  if (direct) {
    return direct;
  }

  return Array.isArray(value.summary) ? reasoningContentToText(value.summary) : undefined;
}

function parsePlanDefaultsFromPlan(
  input: unknown,
  fallback: GenerationPlanDefaults,
  issues: GenerationPlanValidationIssue[]
): GenerationPlanDefaults {
  if (input === undefined || input === null) {
    return fallback;
  }

  if (!isRecord(input)) {
    issues.push(issue("invalid_plan_defaults", "Plan defaults must be an object.", "defaults"));
    return fallback;
  }

  const size = parseOptionalImageSize(input.size) ?? fallback.size;
  const sizeValidation = validateSceneImageSize({ size });
  if (!sizeValidation.ok) {
    issues.push(issue("invalid_plan_defaults", sizeValidation.message, "defaults.size"));
  }

  const quality = parseQuality(input.quality);

  const outputFormat = parseOutputFormat(input.outputFormat);

  const count = parseGenerationCount(input.count);
  if (input.count !== undefined && !count) {
    issues.push(
      issue("invalid_plan_defaults", `Plan default count must be an integer from 1 to ${MAX_GENERATION_PLAN_IMAGES}.`, "defaults.count")
    );
  }

  const stylePresetId = parseStylePresetId(input.stylePresetId);
  if (input.stylePresetId !== undefined && !stylePresetId) {
    issues.push(issue("invalid_plan_defaults", "Plan default stylePresetId is unsupported.", "defaults.stylePresetId"));
  }

  return {
    size: sizeValidation.ok ? sizeValidation.size : fallback.size,
    quality: quality ?? fallback.quality,
    outputFormat: outputFormat ?? fallback.outputFormat,
    count: count ?? fallback.count,
    stylePresetId: stylePresetId ?? fallback.stylePresetId
  };
}

function parsePlanJobs(
  input: unknown,
  defaults: GenerationPlanDefaults,
  context: GenerationPlanValidationContext,
  issues: GenerationPlanValidationIssue[]
): GenerationJob[] {
  if (!Array.isArray(input) || input.length === 0) {
    issues.push(issue("invalid_plan_job", "GenerationPlan must include at least one job.", "jobs"));
    return [];
  }

  const jobs: GenerationJob[] = [];
  const seenJobIds = new Set<string>();
  for (const [index, rawJob] of input.entries()) {
    const path = `jobs.${index}`;
    if (!isRecord(rawJob)) {
      issues.push(issue("invalid_plan_job", "GenerationJob must be an object.", path));
      continue;
    }

    const id = stringValue(rawJob.id);
    if (!id) {
      issues.push(issue("invalid_plan_job", "GenerationJob id is required.", `${path}.id`));
      continue;
    }
    if (seenJobIds.has(id)) {
      issues.push(issue("invalid_plan_job", `Duplicate GenerationJob id "${id}".`, `${path}.id`));
      continue;
    }
    seenJobIds.add(id);

    const role = parseJobRole(rawJob.role);
    if (!role) {
      issues.push(issue("invalid_plan_job", "GenerationJob role is unsupported.", `${path}.role`));
    }

    const prompt = stringValue(rawJob.prompt);
    if (!prompt) {
      issues.push(issue("invalid_plan_job", "GenerationJob prompt is required.", `${path}.prompt`));
    }

    const count = parseGenerationCount(rawJob.count ?? defaults.count);
    if (!count) {
      issues.push(
        issue("invalid_plan_job", `GenerationJob count must be an integer from 1 to ${MAX_GENERATION_PLAN_IMAGES}.`, `${path}.count`)
      );
    }

    const status = rawJob.status === undefined ? "queued" : parseJobStatus(rawJob.status);
    if (!status || status !== "queued") {
      issues.push(issue("invalid_plan_job", 'GenerationJob status must be "queued" before execution.', `${path}.status`));
    }

    const size = isOmittedOptionalValue(rawJob.size) ? undefined : parseOptionalImageSize(rawJob.size);
    const resolvedSize = size ?? defaults.size;
    const sizeValidation = validateSceneImageSize({ size: resolvedSize });
    if (size && !sizeValidation.ok) {
      issues.push(issue("invalid_plan_job", sizeValidation.message, `${path}.size`));
    }

    const quality = rawJob.quality === undefined ? undefined : parseQuality(rawJob.quality);

    const outputFormat = rawJob.outputFormat === undefined ? undefined : parseOutputFormat(rawJob.outputFormat);

    const references = parseJobReferences(rawJob.references, `${path}.references`, context.selectedReferences ?? [], issues);
    const visible = rawJob.visible === undefined ? true : rawJob.visible === true;
    if (rawJob.visible !== undefined && typeof rawJob.visible !== "boolean") {
      issues.push(issue("invalid_plan_job", "GenerationJob visible must be boolean.", `${path}.visible`));
    }
    if (role && role.endsWith("_anchor") && !visible) {
      issues.push(issue("invalid_plan_job", "Generated anchor jobs must be visible.", `${path}.visible`));
    }

    if (rawJob.outputs !== undefined && (!Array.isArray(rawJob.outputs) || rawJob.outputs.length > 0)) {
      issues.push(issue("invalid_plan_job", "GenerationJob outputs must be empty before execution.", `${path}.outputs`));
    }

    jobs.push({
      id,
      role: role ?? "final_image",
      prompt: prompt ?? "",
      count: count ?? 1,
      size: sizeValidation.ok && size ? sizeValidation.size : undefined,
      quality,
      outputFormat,
      references,
      status: "queued",
      outputs: [],
      visible,
      error: stringValue(rawJob.error)
    });
  }

  const totalImageCount = jobs.reduce((total, job) => total + job.count, 0);
  if (totalImageCount > MAX_GENERATION_PLAN_IMAGES) {
    issues.push(
      issue(
        "generation_plan_limit_exceeded",
        `GenerationPlan requests ${totalImageCount} images; the cap is ${MAX_GENERATION_PLAN_IMAGES}.`,
        "jobs"
      )
    );
  }

  for (const [index, job] of jobs.entries()) {
    if (job.references.length > MAX_GENERATION_JOB_REFERENCES) {
      issues.push(
        issue(
          "generation_job_reference_limit_exceeded",
          `GenerationJob "${job.id}" uses ${job.references.length} references; the cap is ${MAX_GENERATION_JOB_REFERENCES}.`,
          `jobs.${index}.references`
        )
      );
    }
  }

  for (const [index, job] of jobs.entries()) {
    if (job.role === "character_anchor" && job.count !== 1) {
      issues.push(
        issue("invalid_dependency_source_count", "Character anchor jobs must generate exactly one visible image.", `jobs.${index}.count`)
      );
    }
  }

  return jobs;
}

function parseJobReferences(
  input: unknown,
  path: string,
  selectedReferences: AgentSelectedCanvasReference[],
  issues: GenerationPlanValidationIssue[]
): GenerationReference[] {
  if (input === undefined) {
    return [];
  }

  if (!Array.isArray(input)) {
    issues.push(issue("invalid_plan_reference", "GenerationJob references must be an array.", path));
    return [];
  }

  const references: GenerationReference[] = [];
  for (const [index, rawReference] of input.entries()) {
    const referencePath = `${path}.${index}`;
    if (!isRecord(rawReference)) {
      issues.push(issue("invalid_plan_reference", "GenerationReference must be an object.", referencePath));
      continue;
    }

    const normalizedSelectedReference = normalizeSelectedCanvasReference(rawReference, selectedReferences);
    const kind =
      parseReferenceKind(rawReference.kind ?? rawReference.type) ??
      inferReferenceKind(rawReference, normalizedSelectedReference);
    if (!kind) {
      issues.push(issue("invalid_plan_reference", "GenerationReference kind is unsupported.", `${referencePath}.kind`));
    }

    const usage = parseReferenceUsage(rawReference.usage) ?? "other";
    if (rawReference.usage !== undefined && !parseReferenceUsage(rawReference.usage)) {
      issues.push(issue("invalid_plan_reference", "GenerationReference usage is unsupported.", `${referencePath}.usage`));
    }

    const referenceKind = kind ?? "selected_canvas_image";
    const selectedReference = referenceKind === "selected_canvas_image" ? normalizedSelectedReference : undefined;
    if (referenceKind === "selected_canvas_image" && selectedReferences.length === 0 && !selectedReference) {
      continue;
    }

    references.push({
      kind: referenceKind,
      usage,
      assetId: selectedReference?.assetId ?? stringValue(rawReference.assetId ?? rawReference.id),
      jobId: stringValue(rawReference.jobId ?? rawReference.sourceJobId ?? rawReference.fromJobId),
      outputId: stringValue(rawReference.outputId),
      label: stringValue(rawReference.label) ?? selectedReference?.label
    });
  }

  return references;
}

function inferReferenceKind(
  rawReference: Record<string, unknown>,
  normalizedSelectedReference: AgentSelectedCanvasReference | undefined
): GenerationReferenceKind | undefined {
  if (
    stringValue(rawReference.jobId ?? rawReference.sourceJobId ?? rawReference.fromJobId) ||
    stringValue(rawReference.outputId)
  ) {
    return "generated_output";
  }

  if (normalizedSelectedReference || selectedReferenceAliasCandidates(rawReference).length > 0) {
    return "selected_canvas_image";
  }

  return undefined;
}

function normalizeSelectedCanvasReference(
  rawReference: Record<string, unknown>,
  selectedReferences: AgentSelectedCanvasReference[]
): AgentSelectedCanvasReference | undefined {
  if (selectedReferences.length === 0) {
    return undefined;
  }

  const aliases = createSelectedReferenceAliasMap(selectedReferences);
  for (const candidate of selectedReferenceAliasCandidates(rawReference)) {
    const aliasKey = normalizeReferenceAliasKey(candidate);
    const selectedReference = aliases.get(aliasKey);
    if (selectedReference) {
      return selectedReference;
    }
    if (isGenericSelectedReferenceAlias(aliasKey)) {
      return selectedReferences[0];
    }
  }

  return selectedReferences[0];
}

function createSelectedReferenceAliasMap(
  selectedReferences: AgentSelectedCanvasReference[]
): Map<string, AgentSelectedCanvasReference> {
  const aliases = new Map<string, AgentSelectedCanvasReference>();
  selectedReferences.forEach((reference, index) => {
    const position = index + 1;
    addSelectedReferenceAlias(aliases, reference, reference.id);
    addSelectedReferenceAlias(aliases, reference, reference.assetId);
    addSelectedReferenceAlias(aliases, reference, reference.label);
    addSelectedReferenceAlias(aliases, reference, `${position}`);
    addSelectedReferenceAlias(aliases, reference, `ref${position}`);
    addSelectedReferenceAlias(aliases, reference, `ref-${position}`);
    addSelectedReferenceAlias(aliases, reference, `ref_${position}`);
    addSelectedReferenceAlias(aliases, reference, `reference-${position}`);
    addSelectedReferenceAlias(aliases, reference, `reference_${position}`);
    addSelectedReferenceAlias(aliases, reference, `selected-${position}`);
    addSelectedReferenceAlias(aliases, reference, `selected_${position}`);
    addSelectedReferenceAlias(aliases, reference, `canvas-image-${position}`);
    addSelectedReferenceAlias(aliases, reference, `canvas_image_${position}`);
    addSelectedReferenceAlias(aliases, reference, `selected-canvas-image-${position}`);
    addSelectedReferenceAlias(aliases, reference, `selected_canvas_image_${position}`);
  });

  if (selectedReferences.length === 1) {
    const [reference] = selectedReferences;
    addSelectedReferenceAlias(aliases, reference, "ref");
    addSelectedReferenceAlias(aliases, reference, "reference");
    addSelectedReferenceAlias(aliases, reference, "selected");
    addSelectedReferenceAlias(aliases, reference, "selected image");
    addSelectedReferenceAlias(aliases, reference, "selected_image");
    addSelectedReferenceAlias(aliases, reference, "selected canvas image");
    addSelectedReferenceAlias(aliases, reference, "selected_canvas_image");
    addSelectedReferenceAlias(aliases, reference, "canvas reference");
    addSelectedReferenceAlias(aliases, reference, "canvas_reference");
  }

  return aliases;
}

function addSelectedReferenceAlias(
  aliases: Map<string, AgentSelectedCanvasReference>,
  reference: AgentSelectedCanvasReference,
  value: string | undefined
): void {
  const key = normalizeReferenceAliasKey(value);
  if (key && !aliases.has(key)) {
    aliases.set(key, reference);
  }
}

function selectedReferenceAliasCandidates(rawReference: Record<string, unknown>): string[] {
  const candidates = [
    stringValue(rawReference.assetId),
    stringValue(rawReference.id),
    stringValue(rawReference.referenceId),
    stringValue(rawReference.referenceAssetId),
    stringValue(rawReference.selectedReferenceId),
    stringValue(rawReference.selectedReferenceHandle),
    stringValue(rawReference.referenceHandle),
    stringValue(rawReference.handle),
    stringValue(rawReference.label),
    stringValue(rawReference.name)
  ];

  const index = positiveIntegerValue(rawReference.index ?? rawReference.position);
  if (index) {
    candidates.push(`${index}`);
    candidates.push(`ref${index}`);
  }

  return candidates.filter((candidate): candidate is string => Boolean(candidate));
}

function normalizeReferenceAliasKey(value: string | undefined): string {
  return value?.trim().replace(/\s+/gu, " ").toLowerCase() ?? "";
}

function isGenericSelectedReferenceAlias(value: string): boolean {
  return (
    value === "ref" ||
    value === "reference" ||
    value === "selected" ||
    value === "selected image" ||
    value === "selected_image" ||
    value === "selected canvas image" ||
    value === "selected_canvas_image" ||
    value === "canvas reference" ||
    value === "canvas_reference"
  );
}

function parsePlanEdges(input: unknown, issues: GenerationPlanValidationIssue[]): GenerationDependencyEdge[] {
  if (input === undefined) {
    return [];
  }

  if (!Array.isArray(input)) {
    issues.push(issue("invalid_plan_edge", "GenerationPlan edges must be an array.", "edges"));
    return [];
  }

  const edges: GenerationDependencyEdge[] = [];
  const seenEdges = new Set<string>();
  for (const [index, rawEdge] of input.entries()) {
    const path = `edges.${index}`;
    if (!isRecord(rawEdge)) {
      issues.push(issue("invalid_plan_edge", "GenerationDependencyEdge must be an object.", path));
      continue;
    }

    const fromJobId = stringValue(rawEdge.fromJobId ?? rawEdge.from ?? rawEdge.sourceJobId ?? rawEdge.source);
    const toJobId = stringValue(rawEdge.toJobId ?? rawEdge.to ?? rawEdge.targetJobId ?? rawEdge.target);
    if (!fromJobId || !toJobId) {
      issues.push(issue("invalid_plan_edge", "Dependency edge requires fromJobId and toJobId.", path));
      continue;
    }
    if (fromJobId === toJobId) {
      issues.push(issue("generation_dependency_cycle", "Dependency edge cannot point to the same job.", path));
      continue;
    }

    const edgeKey = `${fromJobId}->${toJobId}`;
    if (seenEdges.has(edgeKey)) {
      continue;
    }
    seenEdges.add(edgeKey);
    edges.push({ fromJobId, toJobId });
  }

  return edges;
}

function validatePlanGraph(
  jobs: GenerationJob[],
  edges: GenerationDependencyEdge[],
  selectedReferences: AgentSelectedCanvasReference[],
  issues: GenerationPlanValidationIssue[]
): void {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const selectedReferenceKeys = new Set<string>();
  for (const reference of selectedReferences) {
    selectedReferenceKeys.add(reference.id);
    selectedReferenceKeys.add(reference.assetId);
  }

  const downstreamSourceJobIds = new Set<string>();
  for (const [index, edge] of edges.entries()) {
    if (!jobsById.has(edge.fromJobId)) {
      issues.push(
        issue("unknown_generation_job_reference", `Dependency source job "${edge.fromJobId}" does not exist.`, `edges.${index}.fromJobId`)
      );
    }
    if (!jobsById.has(edge.toJobId)) {
      issues.push(
        issue("unknown_generation_job_reference", `Dependency target job "${edge.toJobId}" does not exist.`, `edges.${index}.toJobId`)
      );
    }
    downstreamSourceJobIds.add(edge.fromJobId);
  }

  for (const [jobIndex, job] of jobs.entries()) {
    for (const [referenceIndex, reference] of job.references.entries()) {
      const path = `jobs.${jobIndex}.references.${referenceIndex}`;
      if (reference.kind === "selected_canvas_image") {
        const selectedKey = reference.assetId;
        if (!selectedKey || !selectedReferenceKeys.has(selectedKey)) {
          issues.push(
            issue(
              "unknown_generation_job_reference",
              "selected_canvas_image reference must use one of the selected canvas reference handles.",
              path
            )
          );
        }
        continue;
      }

      const sourceJobId = reference.jobId;
      if (!sourceJobId || !jobsById.has(sourceJobId)) {
        issues.push(
          issue("unknown_generation_job_reference", "generated_output reference must point to a known source job.", path)
        );
        continue;
      }

      downstreamSourceJobIds.add(sourceJobId);
      if (!edges.some((edge) => edge.fromJobId === sourceJobId && edge.toJobId === job.id)) {
        issues.push(
          issue(
            "invalid_plan_edge",
            "generated_output references must include a matching dependency edge.",
            path
          )
        );
      }
    }
  }

  for (const sourceJobId of downstreamSourceJobIds) {
    const sourceJob = jobsById.get(sourceJobId);
    if (sourceJob && sourceJob.count !== 1) {
      issues.push(
        issue(
          "invalid_dependency_source_count",
          `Dependency source job "${sourceJobId}" must have count exactly 1.`,
          `jobs.${jobs.indexOf(sourceJob)}.count`
        )
      );
    }
  }

  if (hasDependencyCycle(jobs, edges)) {
    issues.push(issue("generation_dependency_cycle", "GenerationPlan dependencies must not contain a cycle.", "edges"));
  }
}

function hasDependencyCycle(jobs: GenerationJob[], edges: GenerationDependencyEdge[]): boolean {
  const graph = new Map<string, string[]>();
  for (const job of jobs) {
    graph.set(job.id, []);
  }
  for (const edge of edges) {
    graph.get(edge.fromJobId)?.push(edge.toJobId);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (jobId: string): boolean => {
    if (visiting.has(jobId)) {
      return true;
    }
    if (visited.has(jobId)) {
      return false;
    }
    visiting.add(jobId);
    for (const downstreamJobId of graph.get(jobId) ?? []) {
      if (visit(downstreamJobId)) {
        return true;
      }
    }
    visiting.delete(jobId);
    visited.add(jobId);
    return false;
  };

  return jobs.some((job) => visit(job.id));
}

function formatConversationContextSummary(context: AgentPlannerConversationContext | undefined): string {
  if (!context) {
    return "";
  }

  const lines: string[] = ["Current Agent conversation context:"];
  if (context.previousUserText?.trim()) {
    lines.push(`- Previous user request: ${truncate(context.previousUserText.trim(), 500)}`);
  }

  if (context.previousPlan) {
    lines.push(`- Previous plan: ${formatPlanSummary(context.previousPlan)}`);
  }

  if (context.previousOutputs?.length) {
    lines.push("- Previous successful Agent outputs:");
    for (const output of context.previousOutputs.slice(0, MAX_AGENT_SELECTED_REFERENCES)) {
      lines.push(`  ${formatConversationOutputSummary(output)}`);
    }
  }

  if (context.resolvedReferences?.length) {
    const source =
      context.referenceResolution === "previous_agent_outputs"
        ? "previous Agent outputs"
        : "current manual canvas selection";
    lines.push(`- Resolved follow-up image references from ${source}:`);
    for (const output of context.resolvedReferences.slice(0, MAX_AGENT_SELECTED_REFERENCES)) {
      lines.push(`  ${formatConversationOutputSummary(output)}`);
    }
    lines.push(
      "- The current user request is a follow-up. Use the resolved references as the image sources for any edit jobs unless the user explicitly asks for new unrelated images."
    );
  }

  return lines.length > 1 ? lines.join("\n") : "";
}

function formatClarificationFollowUpSummary(
  userText: string,
  context: AgentPlannerConversationContext | undefined
): string {
  const previousUserText = context?.previousUserText?.trim();
  if (!previousUserText) {
    return "";
  }

  const clarification = agentClarificationIntent(userText);
  if (!clarification) {
    return "";
  }

  const interpretation =
    clarification === "new_design"
      ? "Create a new standalone design image for the previous request. Do not require selected/original canvas images for this clarification."
      : "Edit the selected/original image sources for the previous request.";

  return [
    "Current message appears to answer a previous Agent clarification question.",
    "Use the previous user request together with this clarification instead of planning from the short answer alone.",
    `Clarification interpretation: ${interpretation}`
  ].join("\n");
}

function agentClarificationIntent(userText: string): "new_design" | "edit_original" | undefined {
  const text = normalizeIntentText(userText);
  if (
    /新的设计图|新设计图|生成新图|生成新的|重新生成|独立生成|文生图|不是编辑|不编辑原图|不用原图|不需要原图|无需原图|new design|new image|generate new|standalone|text to image/u.test(
      text
    )
  ) {
    return "new_design";
  }

  if (
    /编辑原图|直接编辑|改原图|修改原图|用原图|基于原图|选中的原图|edit original|edit selected|use selected|use original/u.test(
      text
    )
  ) {
    return "edit_original";
  }

  return undefined;
}

function formatPlanSummary(plan: GenerationPlan): string {
  const jobs = plan.jobs
    .slice(0, 8)
    .map((job) => `${job.id}:${job.role}:count=${job.count}:status=${job.status}`)
    .join(", ");
  const extra = plan.jobs.length > 8 ? `, +${plan.jobs.length - 8} more` : "";
  return `"${truncate(plan.title, 160)}" id=${plan.id} status=${plan.status} jobs=[${jobs}${extra}]`;
}

function formatConversationOutputSummary(output: AgentPlannerConversationOutput): string {
  const label = output.label ? ` label="${truncate(output.label, 120)}"` : "";
  const size = output.width && output.height ? ` size=${output.width}x${output.height}` : "";
  const mimeType = output.mimeType ? ` mimeType="${truncate(output.mimeType, 80)}"` : "";
  const origin = [
    output.planId ? `planId=${output.planId}` : "",
    output.jobId ? `jobId=${output.jobId}` : "",
    output.outputId ? `outputId=${output.outputId}` : ""
  ].filter(Boolean).join(" ");

  return `- output${output.index}: assetId="${output.assetId}"${label}${size}${mimeType}${origin ? ` ${origin}` : ""}`;
}

function formatReferenceSummary(
  reference: AgentSelectedCanvasReference,
  index: number,
  supportsVision: boolean
): string {
  const size = reference.width && reference.height ? `${reference.width}x${reference.height}` : "unknown-size";
  const label = reference.label ? ` label="${truncate(reference.label, 120)}"` : "";
  const mimeType = reference.mimeType ? ` mimeType="${truncate(reference.mimeType, 80)}"` : "";
  const vision = supportsVision && reference.dataUrl ? "visionAttachment=provided" : "visionAttachment=not_provided";

  return `- ref${index + 1}: id="${reference.id}" assetId="${reference.assetId}" size=${size}${label}${mimeType} ${vision}`;
}

function parseStrictJsonObject(input: string): { ok: true; value: unknown } | { ok: false; message: string } {
  const trimmed = input.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return {
      ok: false,
      message: "Agent output must be a single JSON object with no markdown or extra text."
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(trimmed) as unknown
    };
  } catch {
    return {
      ok: false,
      message: "Agent output was not valid JSON."
    };
  }
}

function invalidPlan(
  code: GenerationPlanValidationCode,
  message: string,
  issues?: GenerationPlanValidationIssue[]
): GenerationPlanValidationResult {
  return {
    ok: false,
    code,
    message,
    issues: issues ?? [issue(code, message)]
  };
}

function plannerRequestFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? sanitizePlannerErrorText(error.message) : "";
  return detail ? `Agent planner request failed: ${detail}` : "Agent planner request failed.";
}

function sanitizePlannerErrorText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gu, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9._~+/=-]+/gu, "sk-[redacted]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 360);
}

function issue(
  code: GenerationPlanValidationCode,
  message: string,
  path?: string
): GenerationPlanValidationIssue {
  return {
    code,
    message,
    path
  };
}

function parseOptionalImageSize(value: unknown): ImageSize | undefined {
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d+)\s*[xX×*]\s*(\d+)$/u);
    if (!match) {
      return undefined;
    }

    const width = positiveIntegerValue(match[1]);
    const height = positiveIntegerValue(match[2]);
    return width && height ? { width, height } : undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const width = positiveIntegerValue(value.width);
  const height = positiveIntegerValue(value.height);
  return width && height ? { width, height } : undefined;
}

function isOmittedOptionalValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function parseQuality(value: unknown): ImageQuality | undefined {
  const normalized = normalizedOptionToken(value);
  if (!normalized) {
    return undefined;
  }

  const qualityAliases: Record<string, ImageQuality> = {
    automatic: "auto",
    default: "auto",
    standard: "medium",
    normal: "medium",
    balanced: "medium",
    draft: "low",
    fast: "low",
    quick: "low",
    hd: "high",
    highquality: "high",
    best: "high",
    premium: "high"
  };
  const quality = qualityAliases[normalized] ?? normalized;
  return IMAGE_QUALITIES.includes(quality as ImageQuality) ? (quality as ImageQuality) : undefined;
}

function parseOutputFormat(value: unknown): OutputFormat | undefined {
  const normalized = normalizedOptionToken(value);
  if (!normalized) {
    return undefined;
  }

  const outputFormatAliases: Record<string, OutputFormat> = {
    jpg: "jpeg",
    imagejpeg: "jpeg",
    imagejpg: "jpeg",
    imagepng: "png",
    imagewebp: "webp"
  };
  const outputFormat = outputFormatAliases[normalized] ?? normalized;
  return OUTPUT_FORMATS.includes(outputFormat as OutputFormat) ? (outputFormat as OutputFormat) : undefined;
}

function parseGenerationCount(value: unknown): number | undefined {
  const count = positiveIntegerValue(value);
  return count && count <= MAX_GENERATION_PLAN_IMAGES ? count : undefined;
}

function normalizedOptionToken(value: unknown): string | undefined {
  if (isRecord(value)) {
    return normalizedOptionToken(value.value ?? value.id ?? value.name ?? value.label);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, "");
  return normalized || undefined;
}

function parseStylePresetId(value: unknown): StylePresetId | undefined {
  return typeof value === "string" && STYLE_PRESETS.some((preset) => preset.id === value)
    ? (value as StylePresetId)
    : undefined;
}

function parseJobRole(value: unknown): GenerationJobRole | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const exact = value.trim();
  if (GENERATION_JOB_ROLES.includes(exact as GenerationJobRole)) {
    return exact as GenerationJobRole;
  }

  const normalized = normalizedOptionToken(value);
  return normalized ? GENERATION_JOB_ROLE_ALIASES[normalized] : undefined;
}

function parseJobStatus(value: unknown): GenerationJobStatus | undefined {
  return typeof value === "string" && GENERATION_JOB_STATUSES.includes(value as GenerationJobStatus)
    ? (value as GenerationJobStatus)
    : undefined;
}

function parseReferenceKind(value: unknown): GenerationReferenceKind | undefined {
  const normalized = normalizedOptionToken(value);
  if (!normalized) {
    return undefined;
  }

  const kindAliases: Record<string, GenerationReferenceKind> = {
    selectedcanvasimage: "selected_canvas_image",
    selectedcanvasreference: "selected_canvas_image",
    selectedimage: "selected_canvas_image",
    selectedimagereference: "selected_canvas_image",
    canvasimage: "selected_canvas_image",
    canvasimagereference: "selected_canvas_image",
    canvasreference: "selected_canvas_image",
    referenceimage: "selected_canvas_image",
    generatedoutput: "generated_output",
    generatedimage: "generated_output",
    generatedimagereference: "generated_output",
    joboutput: "generated_output",
    sourcejoboutput: "generated_output",
    sourceoutput: "generated_output",
    upstreamoutput: "generated_output"
  };

  const kind = kindAliases[normalized] ?? normalized;
  return GENERATION_REFERENCE_KINDS.includes(kind as GenerationReferenceKind) ? (kind as GenerationReferenceKind) : undefined;
}

function parseReferenceUsage(value: unknown): GenerationReferenceUsage | undefined {
  return typeof value === "string" && GENERATION_REFERENCE_USAGES.includes(value as GenerationReferenceUsage)
    ? (value as GenerationReferenceUsage)
    : undefined;
}

function contentToText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return nonEmptyString(value);
  }

  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (isRecord(item) && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .join("\n")
      .trim();
    return nonEmptyString(text);
  }

  return undefined;
}

function nonEmptyString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveIntegerValue(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }

  if (typeof value !== "string" || !/^\d+$/u.test(value.trim())) {
    return undefined;
  }

  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
