export type RuntimeImageProvider = "openai" | "codex" | "none";

export const PROVIDER_SOURCE_IDS = ["env-openai", "local-openai", "codex"] as const;
export type ProviderSourceId = (typeof PROVIDER_SOURCE_IDS)[number];
export type ProviderSourceKind = "environment" | "local" | "codex";
export type ProviderSourceStatus = "available" | "missing_api_key" | "missing_codex_session";

export interface MaskedSecret {
  hasSecret: boolean;
  value?: string;
}

export interface CodexAuthSessionView {
  available: boolean;
  email?: string;
  accountId?: string;
  expiresAt?: string;
  refreshedAt?: string;
  unavailableReason?: string;
}

export interface ProviderSourceDetails {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  transport?: string;
  responsesModel?: string;
  responsesReasoningEffort?: string;
  partialImages?: number;
  codex?: CodexAuthSessionView;
}

export interface ProviderSourceView {
  id: ProviderSourceId;
  kind: ProviderSourceKind;
  label: string;
  available: boolean;
  status: ProviderSourceStatus;
  details: ProviderSourceDetails;
  secret: MaskedSecret;
}

export interface ProviderSourceSummary {
  id: ProviderSourceId;
  kind: ProviderSourceKind;
  label: string;
  provider: RuntimeImageProvider;
  available: boolean;
  status: ProviderSourceStatus;
}

export interface LocalOpenAIProviderConfigView {
  apiKey: MaskedSecret;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface ProviderConfigResponse {
  sourceOrder: ProviderSourceId[];
  sources: ProviderSourceView[];
  localOpenAI: LocalOpenAIProviderConfigView;
  activeSource?: ProviderSourceSummary;
}

export interface SaveLocalOpenAIProviderConfig {
  apiKey?: string;
  preserveApiKey?: boolean;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export interface SaveProviderConfigRequest {
  sourceOrder: ProviderSourceId[];
  localOpenAI?: SaveLocalOpenAIProviderConfig;
}

export interface AuthStatusResponse {
  provider: RuntimeImageProvider;
  openaiConfigured: boolean;
  codex: CodexAuthSessionView;
  activeSource?: ProviderSourceSummary;
}

export interface CodexDeviceStartResponse {
  deviceAuthId: string;
  userCode: string;
  verificationUrl: string;
  interval: number;
  expiresIn: number;
  expiresAt: string;
}

export type CodexDevicePollStatus = "authorized" | "pending" | "expired" | "denied";

export interface CodexDevicePollResponse {
  status: CodexDevicePollStatus;
  auth?: AuthStatusResponse;
  interval?: number;
  message?: string;
}

export interface CodexLogoutResponse {
  ok: true;
  auth: AuthStatusResponse;
}
