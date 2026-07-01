import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { strToU8, zipSync } from "fflate";
import WebSocket, { type RawData } from "ws";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = resolve(repoRoot, ".codex-temp", `agent-smoke-${process.pid}-${Date.now()}`);
process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";

mkdirSync(dataDir, { recursive: true });

async function main(): Promise<void> {
  try {
    const [{ app, agentWebSocketServer }, { closeDatabase }, agentSession, agentConversationStore, agentSkillStore] = await Promise.all([
      import("../index.js"),
      import("../infrastructure/database.js"),
      import("../domain/agent/websocket-session.js"),
      import("../domain/agent/conversation-store.js"),
      import("../domain/agent/skill-store.js")
    ]);
    const { closeAllAgentSessions, resolveImplicitAgentContextReferences } = agentSession;
    const { getAgentConversationContext, saveAgentConversationContext } = agentConversationStore;
    const { resolveAvailablePlanningSkillLoadout } = agentSkillStore;

    let server: ReturnType<typeof serve> | undefined;
    const port = await new Promise<number>((resolvePort) => {
      server = serve(
        {
          fetch: app.fetch,
          hostname: "127.0.0.1",
          port: 0,
          websocket: { server: agentWebSocketServer }
        },
        (info) => {
          resolvePort(info.port);
        }
      );
    });

    try {
      smokeImplicitContextResolution(resolveImplicitAgentContextReferences);
      await smokeAgentWebSocket(port);
      await smokeAgentConversations(app, port, { getAgentConversationContext, saveAgentConversationContext });
      await smokeAgentConfig(app);
      await smokeAgentSkills(app, { resolveAvailablePlanningSkillLoadout });
    } finally {
      closeAllAgentSessions("agent_smoke_shutdown");
      agentWebSocketServer.close();
      await new Promise<void>((resolveClose) => {
        server?.close(() => resolveClose());
      });
      closeDatabase();
    }

    console.log("agent smoke checks passed");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function smokeAgentWebSocket(port: number): Promise<void> {
  const probe = await openWebSocketProbe(`ws://127.0.0.1:${port}/api/agent/ws`);
  try {
    const connected = await probe.next();
    expectEventType(connected, "connected");
    expect(typeof connected.connectionId === "string" && connected.connectionId.length > 0, "connected includes connectionId");
    const connectionId = String(connected.connectionId);

    probe.socket.send(JSON.stringify({ type: "ping", requestId: "ping-1" }));
    const pong = await probe.next();
    expectEventType(pong, "pong");
    expect(pong.requestId === "ping-1", "pong preserves requestId");

    probe.socket.send("{\"type\":");
    const jsonError = await probe.next();
    expectEventType(jsonError, "error");
    expect(jsonError.code === "invalid_json", "malformed WebSocket JSON returns invalid_json");

    probe.socket.send(JSON.stringify({ type: "ping", requestId: "ping-2" }));
    const pongAfterError = await probe.next();
    expectEventType(pongAfterError, "pong");
    expect(pongAfterError.requestId === "ping-2", "socket remains open after malformed JSON");

    probe.socket.send(JSON.stringify({ type: "user_message", requestId: "work-1", text: "make an image" }));
    const missingConfig = await probe.next();
    expectEventType(missingConfig, "error");
    expect(missingConfig.code === "missing_agent_config", "missing config returns user-facing error");

    probe.socket.send(JSON.stringify({ type: "cancel_run", requestId: "cancel-1", runId: "run-a" }));
    const firstCancel = await probe.next();
    expectEventType(firstCancel, "run_cancelled");
    expect(firstCancel.runId === "run-a", "cancel event includes requested runId");
    expect(firstCancel.alreadyCancelled === true, "cancel with no active run is idempotent");

    probe.socket.send(JSON.stringify({ type: "cancel_run", requestId: "cancel-2", runId: "run-a" }));
    const secondCancel = await probe.next();
    expectEventType(secondCancel, "run_cancelled");
    expect(secondCancel.alreadyCancelled === true, "repeated cancel remains idempotent");

    const resumedProbe = await openWebSocketProbe(
      `ws://127.0.0.1:${port}/api/agent/ws?connectionId=${encodeURIComponent(connectionId)}`
    );
    try {
      const resumedConnected = await resumedProbe.next();
      expectEventType(resumedConnected, "connected");
      expect(resumedConnected.connectionId === connectionId, "reconnect resumes the same Agent session");

      resumedProbe.socket.send(JSON.stringify({ type: "ping", requestId: "ping-resumed" }));
      const resumedPong = await resumedProbe.next();
      expectEventType(resumedPong, "pong");
      expect(resumedPong.requestId === "ping-resumed", "resumed socket remains interactive");
    } finally {
      resumedProbe.close();
    }
  } finally {
    probe.close();
  }
}

function smokeImplicitContextResolution(
  resolveImplicitAgentContextReferences: typeof import("../domain/agent/websocket-session.js").resolveImplicitAgentContextReferences
): void {
  const previousOutputs = Array.from({ length: 10 }, (_, index) => ({
    index: index + 1,
    assetId: `asset-output-${index + 1}`,
    label: `output-${index + 1}.png`,
    width: 1024,
    height: 1024,
    mimeType: "image/png"
  }));

  const third = resolveImplicitAgentContextReferences({
    userText: "Adjust image 3 text size.",
    previousOutputs
  });
  expect(third.ok, "image-number follow-up resolves");
  expect(third.resolvedOutputs.length === 1, "image-number follow-up resolves one output");
  expect(third.resolvedOutputs[0]?.assetId === "asset-output-3", "image-number follow-up uses the third output");

  const tenth = resolveImplicitAgentContextReferences({
    userText: "\u8c03\u6574\u7b2c\u5341\u5f20\u56fe\u7684\u6587\u5b57\u5927\u5c0f",
    previousOutputs
  });
  expect(tenth.ok, "Chinese ordinal follow-up resolves");
  expect(tenth.resolvedOutputs[0]?.assetId === "asset-output-10", "Chinese ordinal follows the tenth output");

  const all = resolveImplicitAgentContextReferences({
    userText: "Edit all previous outputs and make the title larger.",
    previousOutputs
  });
  expect(all.ok, "all-output follow-up resolves");
  expect(all.resolvedOutputs.length === 10, "all-output follow-up resolves every output");

  const outOfRange = resolveImplicitAgentContextReferences({
    userText: "Adjust output 11 text size.",
    previousOutputs
  });
  expect(!outOfRange.ok, "out-of-range output asks for user input");
  expect(outOfRange.code === "agent_context_reference_out_of_range", "out-of-range output uses stable code");

  const ambiguous = resolveImplicitAgentContextReferences({
    userText: "Make this image text bigger.",
    previousOutputs
  });
  expect(!ambiguous.ok, "ambiguous multi-output follow-up asks for clarification");
  expect(ambiguous.code === "agent_context_reference_ambiguous", "ambiguous output uses stable code");

  const freshRequest = resolveImplicitAgentContextReferences({
    userText: "Generate two new food images.",
    previousOutputs
  });
  expect(freshRequest.ok, "fresh generation request does not fail implicit context");
  expect(freshRequest.resolvedOutputs.length === 0, "fresh generation request does not attach previous outputs");
}

async function smokeAgentConversations(
  app: RequestApp,
  port: number,
  store: {
    getAgentConversationContext: typeof import("../domain/agent/conversation-store.js").getAgentConversationContext;
    saveAgentConversationContext: typeof import("../domain/agent/conversation-store.js").saveAgentConversationContext;
  }
): Promise<void> {
  const timestamp = new Date().toISOString();
  const save = await requestJson(app, "/api/agent-conversations/agent-conversation-smoke", {
    method: "PUT",
    body: {
      title: "Saved Agent smoke",
      messages: [
        {
          id: "agent-message-smoke-user",
          role: "user",
          content: "Generate a poster",
          timestamp,
          plan: {
            id: "data-url-probe",
            dataUrl: "data:image/png;base64,AAAA"
          }
        },
        {
          id: "agent-message-smoke-assistant",
          role: "assistant",
          content: "Plan ready",
          timestamp,
          previews: [
            {
              id: "preview-smoke",
              assetId: "asset-smoke",
              jobId: "job-smoke",
              outputId: "output-smoke",
              url: "/api/assets/asset-smoke/preview?width=256"
            }
          ]
        }
      ]
    }
  });
  expect(save.response.status === 200, "Agent conversation save returns 200");
  expect(isRecord(save.body.conversation), "Agent conversation save returns conversation");
  expect(!JSON.stringify(save.body).includes("data:image"), "Agent conversation save strips dataUrl");

  const list = await requestJson(app, "/api/agent-conversations");
  expect(list.response.status === 200, "Agent conversation list returns 200");
  expect(Array.isArray(list.body.conversations), "Agent conversation list includes conversations");
  expect(
    list.body.conversations.some((conversation) => isRecord(conversation) && conversation.id === "agent-conversation-smoke"),
    "Agent conversation list includes saved conversation"
  );

  const detail = await requestJson(app, "/api/agent-conversations/agent-conversation-smoke");
  expect(detail.response.status === 200, "Agent conversation detail returns 200");
  expect(detail.body.id === "agent-conversation-smoke", "Agent conversation detail returns requested id");
  expect(Array.isArray(detail.body.messages), "Agent conversation detail includes messages");
  expect(!JSON.stringify(detail.body).includes("data:image"), "Agent conversation detail does not expose dataUrl");

  store.saveAgentConversationContext("agent-conversation-context-smoke", {
    previousUserText: "Make the previous image warmer.",
    pendingUserText: "在原图上加一行标题。",
    previousPlan: {
      schemaVersion: 1,
      id: "context-plan-smoke",
      title: "Context plan smoke",
      status: "awaiting_confirmation",
      defaults: {
        size: {
          width: 1024,
          height: 1024
        },
        quality: "auto",
        outputFormat: "png"
      },
      jobs: [],
      edges: [],
      createdBy: "agent",
      createdAt: timestamp,
      updatedAt: timestamp,
      dataUrl: "data:image/png;base64,BBBB"
    },
    previousOutputs: [
      {
        index: 1,
        assetId: "asset-output-1",
        label: "output-1.png",
        width: 1024,
        height: 1024,
        mimeType: "image/png"
      }
    ]
  } as Parameters<typeof store.saveAgentConversationContext>[1]);
  const context = store.getAgentConversationContext("agent-conversation-context-smoke");
  expect(context?.previousUserText === "Make the previous image warmer.", "Agent conversation context readback keeps user text");
  expect(context?.pendingUserText === "在原图上加一行标题。", "Agent conversation context readback keeps pending user text");
  expect(context.previousOutputs[0]?.assetId === "asset-output-1", "Agent conversation context readback keeps output reference");
  expect(!JSON.stringify(context).includes("data:image"), "Agent conversation context strips dataUrl");

  const probe = await openWebSocketProbe(
    `ws://127.0.0.1:${port}/api/agent/ws?conversationId=${encodeURIComponent("agent-conversation-context-smoke")}`
  );
  try {
    const connected = await probe.next();
    expectEventType(connected, "connected");
    expect(connected.conversationId === "agent-conversation-context-smoke", "WebSocket connected event includes conversationId");
    expect(connected.restoredContext === true, "WebSocket restores Agent conversation context");
  } finally {
    probe.close();
  }
}

interface RequestApp {
  request(input: string | Request, init?: RequestInit): Response | Promise<Response>;
}

interface SecretView {
  hasSecret: boolean;
  value?: string;
}

async function smokeAgentConfig(app: RequestApp): Promise<void> {
  const initial = await requestJson(app, "/api/agent-config");
  expect(initial.response.status === 200, "initial config GET returns 200");
  expectEventShape(initial.body, "initial config body");
  expect(initial.body.configured === false, "initial config is not usable");
  expect(expectSecretView(initial.body.apiKey, "initial config API key").hasSecret === false, "initial config has no API key");
  expect(initial.body.supportsVision === false, "initial supportsVision defaults to false");

  const missingKey = await requestJson(app, "/api/agent-config", {
    method: "PUT",
    body: {
      baseUrl: "",
      model: "gpt-4.1-mini",
      timeoutMs: 12000,
      supportsVision: false
    }
  });
  expect(missingKey.response.status === 400, "saving without an API key is rejected");

  const invalidTimeout = await requestJson(app, "/api/agent-config", {
    method: "PUT",
    body: {
      apiKey: "sk-test-agent-secret",
      baseUrl: "",
      model: "gpt-4.1-mini",
      timeoutMs: 0,
      supportsVision: false
    }
  });
  expect(invalidTimeout.response.status === 400, "non-positive timeout is rejected");

  const saved = await requestJson(app, "/api/agent-config", {
    method: "PUT",
    body: {
      apiKey: "  sk-test-agent-secret  ",
      baseUrl: "  https://agent.example.test/v1  ",
      model: "  gpt-4.1-mini  ",
      timeoutMs: 12345,
      supportsVision: true
    }
  });
  expect(saved.response.status === 200, "valid config save returns 200");
  expectEventShape(saved.body, "saved config body");
  expect(saved.body.configured === true, "saved config is usable");
  expect(saved.body.baseUrl === "https://agent.example.test/v1", "base URL is trimmed");
  expect(saved.body.model === "gpt-4.1-mini", "model is trimmed");
  expect(saved.body.timeoutMs === 12345, "timeout is persisted");
  expect(saved.body.supportsVision === true, "supportsVision is persisted");
  const savedSecret = expectSecretView(saved.body.apiKey, "saved config API key");
  expect(savedSecret.hasSecret === true, "saved key is masked");
  expect(!JSON.stringify(saved.body).includes("sk-test-agent-secret"), "saved readback does not expose API key");

  const preserved = await requestJson(app, "/api/agent-config", {
    method: "PUT",
    body: {
      apiKey: "",
      preserveApiKey: true,
      baseUrl: "  https://agent-2.example.test/v1  ",
      model: "  gpt-4.1  ",
      timeoutMs: 23456,
      supportsVision: false
    }
  });
  expect(preserved.response.status === 200, "preserved API key save returns 200");
  expectEventShape(preserved.body, "preserved config body");
  const preservedSecret = expectSecretView(preserved.body.apiKey, "preserved config API key");
  expect(preservedSecret.hasSecret === true, "preserved config keeps API key");
  expect(preservedSecret.value === savedSecret.value, "preserved config keeps same masked key");
  expect(preserved.body.baseUrl === "https://agent-2.example.test/v1", "preserved save updates base URL");
  expect(preserved.body.model === "gpt-4.1", "preserved save updates model");
  expect(preserved.body.supportsVision === false, "preserved save updates supportsVision");
}

async function smokeAgentSkills(
  app: RequestApp,
  skillStore: {
    resolveAvailablePlanningSkillLoadout: typeof import("../domain/agent/skill-store.js").resolveAvailablePlanningSkillLoadout;
  }
): Promise<void> {
  const list = await requestJson(app, "/api/agent-skills");
  expect(list.response.status === 200, "Agent skill list returns 200");
  expect(Array.isArray(list.body.skills), "Agent skill list returns skills");
  const skills = list.body.skills.filter(isRecord);
  const core = skills.find((skill) => skill.slug === "canvas-image-planning");
  const ecommerce = skills.find((skill) => skill.slug === "ecommerce-visual-copywriting");
  expect(isRecord(core), "Agent skill list includes canvas planning skill");
  expect(core.required === true && core.enabled === true, "core Agent skill is required and enabled");
  expect(isRecord(ecommerce), "Agent skill list includes ecommerce skill");
  expect(ecommerce.enabled === true && ecommerce.triggerMode === "auto", "ecommerce Agent skill is enabled auto");

  const coreDetail = await requestJson(app, `/api/agent-skills/${String(core.id)}`);
  expect(coreDetail.response.status === 200, "Agent skill detail returns 200");
  expect(isRecord(coreDetail.body.skill) && Array.isArray(coreDetail.body.skill.files), "Agent skill detail includes files");

  const disableCore = await requestJson(app, `/api/agent-skills/${String(core.id)}`, {
    method: "PUT",
    body: {
      name: core.name,
      enabled: false
    }
  });
  expect(disableCore.response.status === 400, "required Agent skill cannot be disabled");
  expect(isRecord(disableCore.body.error) && disableCore.body.error.code === "agent_skill_required", "core disable uses stable code");

  const disableEcommerce = await requestJson(app, `/api/agent-skills/${String(ecommerce.id)}`, {
    method: "PUT",
    body: {
      name: ecommerce.name,
      enabled: false
    }
  });
  expect(disableEcommerce.response.status === 200, "ecommerce Agent skill can be disabled");
  expect(isRecord(disableEcommerce.body.skill) && disableEcommerce.body.skill.enabled === false, "ecommerce disable persists");

  const custom = await requestJson(app, "/api/agent-skills", {
    method: "POST",
    body: {
      slug: "smoke-brand-voice",
      name: "Smoke Brand Voice",
      description: "Smoke test custom skill.",
      enabled: true,
      triggerMode: "auto",
      triggerKeywords: ["brand-voice"],
      files: [
        {
          path: "SKILL.md",
          content: "---\nname: smoke-brand-voice\ndescription: Smoke test custom skill.\n---\n# Smoke Brand Voice"
        }
      ]
    }
  });
  expect(custom.response.status === 201, "custom Agent skill create returns 201");
  expect(isRecord(custom.body.skill) && custom.body.skill.slug === "smoke-brand-voice", "custom Agent skill slug persists");

  const customId = String(custom.body.skill.id);
  const edited = await requestJson(app, `/api/agent-skills/${customId}`, {
    method: "PUT",
    body: {
      name: "Smoke Brand Voice Edited",
      description: "Edited custom skill.",
      enabled: true,
      triggerMode: "auto",
      triggerKeywords: ["brand-voice", "catalog"],
      files: [
        {
          path: "SKILL.md",
          content: "---\nname: smoke-brand-voice\ndescription: Edited custom skill.\n---\n# Edited Brand Voice"
        },
        {
          path: "references/tone.md",
          content: "# Tone\nPlain and precise."
        }
      ]
    }
  });
  expect(edited.response.status === 200, "custom Agent skill edit returns 200");
  expect(isRecord(edited.body.skill) && edited.body.skill.fileCount === 2, "custom Agent skill file edit persists");

  const styleSkillDescription =
    "Extract reusable style prompts when the user asks to analyze style, reverse-engineer prompts, create prompt templates, or transfer an image aesthetic.";
  const styleSkill = await requestJson(app, "/api/agent-skills", {
    method: "POST",
    body: {
      slug: "image-style-prompt-extractor",
      name: "image-style-prompt-extractor",
      description: styleSkillDescription,
      enabled: true,
      triggerMode: "auto",
      triggerKeywords: [],
      files: [
        {
          path: "SKILL.md",
          content: `---\nname: image-style-prompt-extractor\ndescription: ${styleSkillDescription}\n---\n# Image Style Prompt Extractor`
        }
      ]
    }
  });
  expect(styleSkill.response.status === 201, "style metadata skill create returns 201");

  const kidsSkillDescription =
    "Generate safe, premium children portrait and kids campaign image prompts. Use when Codex is asked to create or refine prompts for children's portraits, kids fashion editorials, childhood campaign posters, Korean kids photography, kawaii scrapbook posters, playful studio portraits, anime-style child subject transformations, or child-brand visual art direction.";
  const kidsSkill = await requestJson(app, "/api/agent-skills", {
    method: "POST",
    body: {
      slug: "kids-portrait-generator",
      name: "kids-portrait-generator",
      description: kidsSkillDescription,
      enabled: true,
      triggerMode: "auto",
      triggerKeywords: [],
      files: [
        {
          path: "SKILL.md",
          content: `---\nname: kids-portrait-generator\ndescription: ${kidsSkillDescription}\n---\n# Kids Portrait Generator`
        }
      ]
    }
  });
  expect(kidsSkill.response.status === 201, "kids portrait metadata skill create returns 201");

  const availableLoadout = skillStore.resolveAvailablePlanningSkillLoadout();
  const availableSlugs = availableLoadout.skills.map((skill) => skill.slug);
  expect(
    availableSlugs.includes("kids-portrait-generator"),
    "DeepAgent runtime loadout exposes the kids portrait skill for model-side matching"
  );
  expect(
    availableSlugs.includes("image-style-prompt-extractor"),
    "DeepAgent runtime loadout exposes the style extractor skill for model-side matching"
  );

  const importedMarkdown = await requestMultipart(app, "/api/agent-skills/import", formDataWithFile(
    new File(
      ["---\nname: Imported Markdown Skill\ndescription: Imported from markdown.\nmetadata:\n  version: \"1\"\n---\n# Imported"],
      "imported-markdown-skill.md",
      { type: "text/markdown" }
    )
  ));
  expect(importedMarkdown.response.status === 201, "markdown Agent skill import returns 201");
  expect(isRecord(importedMarkdown.body.skill) && importedMarkdown.body.skill.slug === "imported-markdown-skill", "markdown import uses metadata slug");

  const zipBytes = zipSync({
    "zip-skill/SKILL.md": strToU8(
      "---\nname: Imported Zip Skill\ndescription: Imported from zip.\nmetadata:\n  version: \"1\"\n---\n# Imported Zip"
    ),
    "zip-skill/references/guide.md": strToU8("# Guide\nKeep it brief.")
  });
  const importedZip = await requestMultipart(app, "/api/agent-skills/import", formDataWithFile(
    new File([arrayBufferFromUint8(zipBytes)], "imported-zip-skill.zip", { type: "application/zip" })
  ));
  expect(importedZip.response.status === 201, "zip Agent skill import returns 201");
  expect(isRecord(importedZip.body.skill) && importedZip.body.skill.fileCount === 2, "zip import preserves reference files");

  const badZip = zipSync({
    "../SKILL.md": strToU8("# Bad Zip")
  });
  const rejected = await requestMultipart(app, "/api/agent-skills/import", formDataWithFile(
    new File([arrayBufferFromUint8(badZip)], "bad-skill.zip", { type: "application/zip" })
  ));
  expect(rejected.response.status === 400, "invalid Agent skill upload is rejected");
  expect(isRecord(rejected.body.error), "invalid upload returns error body");
}

async function requestJson(
  app: RequestApp,
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await app.request(path, {
    method: options?.method ?? "GET",
    headers: options?.body === undefined ? undefined : { "content-type": "application/json" },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const body = (await response.json()) as unknown;
  expect(isRecord(body), `${path} response body is an object`);
  return { response, body };
}

async function requestMultipart(
  app: RequestApp,
  path: string,
  formData: FormData
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await app.request(path, {
    method: "POST",
    body: formData
  });
  const body = (await response.json()) as unknown;
  expect(isRecord(body), `${path} multipart response body is an object`);
  return { response, body };
}

function formDataWithFile(file: File): FormData {
  const formData = new FormData();
  formData.set("file", file);
  return formData;
}

function arrayBufferFromUint8(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function openWebSocketProbe(url: string): Promise<WebSocketProbe> {
  const socket = new WebSocket(url);
  const probe = new WebSocketProbe(socket);
  await new Promise<void>((resolveOpen, rejectOpen) => {
    socket.once("open", () => resolveOpen());
    socket.once("error", rejectOpen);
  });
  return probe;
}

class WebSocketProbe {
  private readonly queue: Record<string, unknown>[] = [];
  private readonly waiters: Array<(value: Record<string, unknown>) => void> = [];

  constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const parsed = JSON.parse(rawDataToString(data)) as unknown;
      expect(isRecord(parsed), "WebSocket event is an object");
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(parsed);
        return;
      }
      this.queue.push(parsed);
    });
  }

  next(): Promise<Record<string, unknown>> {
    const queued = this.queue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }

    return new Promise((resolveNext, rejectNext) => {
      let waiter: (value: Record<string, unknown>) => void;
      const timeout = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        rejectNext(new Error("Timed out waiting for WebSocket event."));
      }, 2000);
      waiter = (value: Record<string, unknown>): void => {
        clearTimeout(timeout);
        resolveNext(value);
      };
      this.waiters.push(waiter);
    });
  }

  close(): void {
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
  }
}

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return Buffer.from(data).toString("utf8");
}

function expectEventShape(value: Record<string, unknown>, label: string): void {
  expect(isRecord(value.apiKey), `${label} includes apiKey`);
  expect(typeof value.baseUrl === "string", `${label} includes baseUrl`);
  expect(typeof value.model === "string", `${label} includes model`);
  expect(typeof value.timeoutMs === "number", `${label} includes timeoutMs`);
  expect(typeof value.supportsVision === "boolean", `${label} includes supportsVision`);
}

function expectSecretView(value: unknown, label: string): SecretView {
  expect(isRecord(value), `${label} is an object`);
  expect(typeof value.hasSecret === "boolean", `${label} includes hasSecret`);
  if (value.value !== undefined) {
    expect(typeof value.value === "string", `${label} value is a string`);
  }

  return value as unknown as SecretView;
}

function expectEventType(value: Record<string, unknown>, type: string): void {
  expect(value.type === type, `expected ${type} event`);
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

await main();
