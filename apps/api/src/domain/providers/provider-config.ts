import { eq } from "drizzle-orm";
import {
  IMAGE_MODEL,
  PROVIDER_SOURCE_IDS,
  type CodexAuthSessionView,
  type LocalOpenAIProviderConfigView,
  type MaskedSecret,
  type ProviderConfigResponse,
  type ProviderSourceId,
  type ProviderSourceSummary,
  type ProviderSourceView,
  type RuntimeImageProvider,
  type SaveLocalOpenAIProviderConfig,
  type SaveProviderConfigRequest
} from "../contracts.js";
import { db } from "../../infrastructure/database.js";
import {
  DEFAULT_OPENAI_IMAGE_TIMEOUT_MS,
  getConfiguredImageModel,
  getOpenAIImagePartialImages,
  getOpenAIImageTransport,
  getOpenAIResponsesReasoningEffort,
  getOpenAIResponsesModel,
  parseOpenAIImageTimeoutMs,
  type OpenAIImageProviderConfig
} from "../../infrastructure/providers/image-provider.js";
import { codexOAuthTokens, providerConfigs } from "../../infrastructure/schema.js";

const ACTIVE_PROVIDER_CONFIG_ID = "active";
const CODEX_TOKEN_ROW_ID = "default";

export const DEFAULT_PROVIDER_SOURCE_ORDER: ProviderSourceId[] = ["env-openai", "local-openai", "codex"];

type ProviderConfigRow = typeof providerConfigs.$inferSelect;
type CodexTokenRow = typeof codexOAuthTokens.$inferSelect;

interface ResolvedLocalConfig {
  localApiKey: string | null;
  localBaseUrl: string | null;
  localModel: string | null;
  localTimeoutMs: number | null;
}

export function getProviderConfig(): ProviderConfigResponse {
  const row = getProviderConfigRow();
  const sourceOrder = readSavedSourceOrder(row?.sourceOrderJson);
  const sourcesById = new Map(providerSources(row).map((source) => [source.id, source]));
  const sources = sourceOrder.map((sourceId) => sourcesById.get(sourceId)).filter(isDefined);
  const activeSource = sources.find((source) => source.available);

  return {
    sourceOrder,
    sources,
    localOpenAI: localOpenAIConfigView(row),
    activeSource: activeSource ? providerSourceSummary(activeSource) : undefined
  };
}

export function saveProviderConfig(input: SaveProviderConfigRequest): ProviderConfigResponse {
  if (!isProviderSourceOrder(input.sourceOrder)) {
    throw new Error("Provider source order is invalid.");
  }

  const now = new Date().toISOString();
  const existing = getProviderConfigRow();
  const local = resolveLocalConfigForSave(input.localOpenAI, existing);
  const row: ProviderConfigRow = {
    id: ACTIVE_PROVIDER_CONFIG_ID,
    sourceOrderJson: JSON.stringify(input.sourceOrder),
    localApiKey: local.localApiKey,
    localBaseUrl: local.localBaseUrl,
    localModel: local.localModel,
    localTimeoutMs: local.localTimeoutMs,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  db.insert(providerConfigs)
    .values(row)
    .onConflictDoUpdate({
      target: providerConfigs.id,
      set: {
        sourceOrderJson: row.sourceOrderJson,
        localApiKey: row.localApiKey,
        localBaseUrl: row.localBaseUrl,
        localModel: row.localModel,
        localTimeoutMs: row.localTimeoutMs,
        updatedAt: row.updatedAt
      }
    })
    .run();

  return getProviderConfig();
}

export function getProviderSourceOrder(): ProviderSourceId[] {
  return readSavedSourceOrder(getProviderConfigRow()?.sourceOrderJson);
}

export function getEnvironmentOpenAIImageProviderConfig(): OpenAIImageProviderConfig | undefined {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return undefined;
  }

  const baseURL = process.env.OPENAI_BASE_URL?.trim();
  return {
    apiKey,
    baseURL: baseURL || undefined,
    model: getConfiguredImageModel(),
    timeoutMs: parseOpenAIImageTimeoutMs(process.env.OPENAI_IMAGE_TIMEOUT_MS),
    transport: getOpenAIImageTransport(),
    responsesModel: getOpenAIResponsesModel(),
    responsesReasoningEffort: getOpenAIResponsesReasoningEffort(),
    partialImages: getOpenAIImagePartialImages()
  };
}

export function getLocalOpenAIImageProviderConfig(): OpenAIImageProviderConfig | undefined {
  const row = getProviderConfigRow();
  const apiKey = trimToUndefined(row?.localApiKey);
  if (!apiKey) {
    return undefined;
  }

  return {
    apiKey,
    baseURL: trimToUndefined(row?.localBaseUrl),
    model: trimToUndefined(row?.localModel) ?? IMAGE_MODEL,
    timeoutMs: validTimeoutMs(row?.localTimeoutMs) ?? DEFAULT_OPENAI_IMAGE_TIMEOUT_MS,
    transport: getOpenAIImageTransport(),
    responsesModel: getOpenAIResponsesModel(),
    responsesReasoningEffort: getOpenAIResponsesReasoningEffort(),
    partialImages: getOpenAIImagePartialImages()
  };
}

export function isProviderSourceOrder(value: unknown): value is ProviderSourceId[] {
  return parseProviderSourceOrder(value) !== undefined;
}

export function isProviderSourceId(value: unknown): value is ProviderSourceId {
  return typeof value === "string" && (PROVIDER_SOURCE_IDS as readonly string[]).includes(value);
}

function getProviderConfigRow(): ProviderConfigRow | undefined {
  return db.select().from(providerConfigs).where(eq(providerConfigs.id, ACTIVE_PROVIDER_CONFIG_ID)).get();
}

function providerSources(row: ProviderConfigRow | undefined): ProviderSourceView[] {
  const envConfig = getEnvironmentOpenAIImageProviderConfig();
  const localConfig = getLocalOpenAIImageProviderConfig();
  const codex = codexSessionView(getCodexTokenRow());

  return [
    {
      id: "env-openai",
      kind: "environment",
      label: "Environment OpenAI API",
      available: Boolean(envConfig),
      status: envConfig ? "available" : "missing_api_key",
      details: {
        baseUrl: process.env.OPENAI_BASE_URL?.trim() || "",
        model: getConfiguredImageModel(),
        timeoutMs: parseOpenAIImageTimeoutMs(process.env.OPENAI_IMAGE_TIMEOUT_MS),
        transport: getOpenAIImageTransport(),
        responsesModel: getOpenAIResponsesModel(),
        responsesReasoningEffort: getOpenAIResponsesReasoningEffort(),
        partialImages: getOpenAIImagePartialImages()
      },
      secret: maskedSecret(process.env.OPENAI_API_KEY)
    },
    {
      id: "local-openai",
      kind: "local",
      label: "Custom OpenAI-compatible API",
      available: Boolean(localConfig),
      status: localConfig ? "available" : "missing_api_key",
      details: {
        baseUrl: row?.localBaseUrl ?? "",
        model: trimToUndefined(row?.localModel) ?? IMAGE_MODEL,
        timeoutMs: validTimeoutMs(row?.localTimeoutMs) ?? DEFAULT_OPENAI_IMAGE_TIMEOUT_MS,
        transport: getOpenAIImageTransport(),
        responsesModel: getOpenAIResponsesModel(),
        responsesReasoningEffort: getOpenAIResponsesReasoningEffort(),
        partialImages: getOpenAIImagePartialImages()
      },
      secret: maskedSecret(row?.localApiKey)
    },
    {
      id: "codex",
      kind: "codex",
      label: "Codex",
      available: codex.available,
      status: codex.available ? "available" : "missing_codex_session",
      details: {
        codex
      },
      secret: {
        hasSecret: false
      }
    }
  ];
}

function localOpenAIConfigView(row: ProviderConfigRow | undefined): LocalOpenAIProviderConfigView {
  return {
    apiKey: maskedSecret(row?.localApiKey),
    baseUrl: row?.localBaseUrl ?? "",
    model: trimToUndefined(row?.localModel) ?? IMAGE_MODEL,
    timeoutMs: validTimeoutMs(row?.localTimeoutMs) ?? DEFAULT_OPENAI_IMAGE_TIMEOUT_MS
  };
}

function providerSourceSummary(source: ProviderSourceView): ProviderSourceSummary {
  return {
    id: source.id,
    kind: source.kind,
    label: source.label,
    provider: runtimeProviderForSource(source.id),
    available: source.available,
    status: source.status
  };
}

function runtimeProviderForSource(sourceId: ProviderSourceId): RuntimeImageProvider {
  if (sourceId === "codex") {
    return "codex";
  }

  return "openai";
}

function resolveLocalConfigForSave(
  input: SaveLocalOpenAIProviderConfig | undefined,
  existing: ProviderConfigRow | undefined
): ResolvedLocalConfig {
  if (!input) {
    return {
      localApiKey: existing?.localApiKey ?? null,
      localBaseUrl: existing?.localBaseUrl ?? null,
      localModel: existing?.localModel ?? null,
      localTimeoutMs: existing?.localTimeoutMs ?? null
    };
  }

  return {
    localApiKey: resolveLocalApiKey(input, existing),
    localBaseUrl: Object.hasOwn(input, "baseUrl") ? trimToNull(input.baseUrl) : (existing?.localBaseUrl ?? null),
    localModel: Object.hasOwn(input, "model") ? trimToNull(input.model) : (existing?.localModel ?? null),
    localTimeoutMs: Object.hasOwn(input, "timeoutMs")
      ? requiredPositiveInteger(input.timeoutMs, "Custom OpenAI timeout")
      : (existing?.localTimeoutMs ?? null)
  };
}

function resolveLocalApiKey(input: SaveLocalOpenAIProviderConfig, existing: ProviderConfigRow | undefined): string | null {
  if (typeof input.apiKey === "string") {
    const trimmed = input.apiKey.trim();
    if (trimmed) {
      return trimmed;
    }

    return input.preserveApiKey === true ? (existing?.localApiKey ?? null) : null;
  }

  return existing?.localApiKey ?? null;
}

function requiredPositiveInteger(value: number | undefined, label: string): number | null {
  if (value === undefined) {
    return null;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function readSavedSourceOrder(value: string | undefined): ProviderSourceId[] {
  if (!value) {
    return [...DEFAULT_PROVIDER_SOURCE_ORDER];
  }

  try {
    return parseProviderSourceOrder(JSON.parse(value) as unknown) ?? [...DEFAULT_PROVIDER_SOURCE_ORDER];
  } catch {
    return [...DEFAULT_PROVIDER_SOURCE_ORDER];
  }
}

function parseProviderSourceOrder(value: unknown): ProviderSourceId[] | undefined {
  if (!Array.isArray(value) || value.length !== PROVIDER_SOURCE_IDS.length) {
    return undefined;
  }

  if (!value.every(isProviderSourceId)) {
    return undefined;
  }

  const unique = new Set(value);
  if (unique.size !== PROVIDER_SOURCE_IDS.length) {
    return undefined;
  }

  return PROVIDER_SOURCE_IDS.every((sourceId) => unique.has(sourceId)) ? [...value] : undefined;
}

function getCodexTokenRow(): CodexTokenRow | undefined {
  return db.select().from(codexOAuthTokens).where(eq(codexOAuthTokens.id, CODEX_TOKEN_ROW_ID)).get();
}

function codexSessionView(row: CodexTokenRow | undefined): CodexAuthSessionView {
  const available = hasUsableTokenMaterial(row);

  return {
    available,
    email: row?.email ?? undefined,
    accountId: row?.accountId ?? undefined,
    expiresAt: row?.expiresAt ?? undefined,
    refreshedAt: row?.refreshedAt ?? undefined,
    unavailableReason: !available ? (row?.unavailableReason ?? undefined) : undefined
  };
}

function hasUsableTokenMaterial(row: CodexTokenRow | undefined): row is CodexTokenRow & {
  accessToken: string;
  refreshToken: string;
} {
  return Boolean(row?.accessToken?.trim() && row.refreshToken?.trim() && !row.unavailableAt);
}

function maskedSecret(value: string | null | undefined): MaskedSecret {
  const trimmed = trimToUndefined(value);
  return {
    hasSecret: Boolean(trimmed),
    value: trimmed ? maskSecret(trimmed) : undefined
  };
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}${"*".repeat(Math.min(8, Math.max(4, value.length - 8)))}${value.slice(-4)}`;
}

function trimToUndefined(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function trimToNull(value: string | undefined): string | null {
  return value?.trim() || null;
}

function validTimeoutMs(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
