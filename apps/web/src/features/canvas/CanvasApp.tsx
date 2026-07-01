import {
  AlertTriangle,
  Bot,
  Bookmark,
  BookmarkCheck,
  BookOpenCheck,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  FileText,
  History,
  ImageIcon,
  KeyRound,
  Loader2,
  LogOut,
  MapPin,
  MessageCirclePlus,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  DefaultSnapIndicator,
  Tldraw,
  type Editor,
  type TLAsset,
  type TLAssetContext,
  type TLAssetId,
  type TLAssetStore,
  type TLEditorSnapshot,
  type TLImageShape,
  type TLShapePartial,
  type TLShapeId,
  type TLStoreSnapshot,
  type TLComponents,
  type TldrawOptions,
  type TLUserPreferences,
  type TLSnapIndicatorProps,
  useIsDarkMode,
  useEditor,
  useTldrawUser,
  useValue
} from "tldraw";
import {
  GENERATION_PLACEHOLDER_TYPE,
  GenerationPlaceholderShapeUtil,
  type GenerationPlaceholderShape
} from "./GenerationPlaceholderShape";
import {
  AGENT_PLAN_NODE_TYPE,
  AgentPlanNodeShapeUtil,
  hasFailedPlanJob,
  isAgentPlanNodeShape,
  isGenerationPlan,
  summarizeGenerationPlanOutputs
} from "../agent/AgentPlanNodeShape";
import { AgentSkillDialog } from "../agent/AgentSkillDialog";
import { HomePage } from "../home/HomePage";
import { ProviderConfigDialog } from "../provider-config/ProviderConfigDialog";
import {
  CUSTOM_SIZE_PRESET_ID,
  GENERATION_COUNTS,
  IMAGE_SIZE_MULTIPLE,
  IMAGE_QUALITIES,
  MAX_AGENT_SELECTED_REFERENCES,
  MAX_IMAGE_ASPECT_RATIO,
  MAX_IMAGE_DIMENSION,
  MAX_REFERENCE_IMAGES,
  MAX_TOTAL_PIXELS,
  MIN_IMAGE_DIMENSION,
  MIN_TOTAL_PIXELS,
  OUTPUT_FORMATS,
  SIZE_PRESETS,
  STYLE_PRESETS,
  resolutionTierForSize,
  validateImageSize,
  type AgentConversation,
  type AgentConversationListResponse,
  type AgentConversationMessage,
  type AgentConversationSummary,
  type AgentLlmConfigView,
  type AgentPlannerOptions,
  type AgentReasoningEffort,
  type AgentSelectedCanvasReference,
  type AgentServerEvent,
  type AgentThinkingType,
  type AgentTraceEntry,
  type AuthStatusResponse,
  type AssetMetadataResponse,
  type CloudStorageProvider,
  type CodexDevicePollResponse,
  type CodexDeviceStartResponse,
  type CodexLogoutResponse,
  type GalleryImageItem,
  type GenerationCount,
  type GenerationJob,
  type GenerationPlan,
  type GenerationRecord,
  type GenerationReference,
  type GenerationResponse,
  type GenerationStatus,
  type GeneratedAsset,
  type ImageQuality,
  type ImageSize,
  type ImageSizeValidationReason,
  type OutputFormat,
  type ProjectState,
  type PromptFavoriteGroup,
  type PromptFavoriteItem,
  type PromptPoolItem,
  type ReferenceImageInput,
  type ResolutionTier,
  type SaveStorageConfigRequest,
  type S3EndpointMode,
  type SizePreset,
  type StorageConfigResponse,
  type StorageTestResult,
  type StylePresetId
} from "@gpt-image-canvas/shared";
import { LOCALES, localizedApiErrorMessage, useI18n, type Locale, type Translate } from "../../shared/i18n";
import { assetDownloadUrl, assetInlineUrl, assetPreviewUrl } from "../../shared/api/assets";
import {
  deletePromptFavorite,
  fetchPromptFavorites,
  markPromptFavoriteUsed
} from "../prompt-favorites/promptFavoritesApi";

const AUTOSAVE_DEBOUNCE_MS = 1200;
const GENERATION_POLL_INTERVAL_MS = 1500;
const AGENT_SOCKET_PING_INTERVAL_MS = 15_000;
const AGENT_SOCKET_RECONNECT_INITIAL_MS = 500;
const AGENT_SOCKET_RECONNECT_MAX_MS = 10_000;
const AGENT_SOCKET_RECONNECT_WINDOW_MS = 2 * 60 * 60 * 1000;
const AGENT_HISTORY_SAVE_DEBOUNCE_MS = 600;
const AGENT_TRACE_ENTRY_LIMIT = 1000;
const AGENT_TRACE_VISIBLE_LIMIT = 80;
const AGENT_TRACE_MAX_STRING_LENGTH = 120_000;
const AGENT_TRACE_DEBUG_ENABLED = import.meta.env.VITE_AGENT_TRACE_DEBUG !== "false";
const HISTORY_COLLAPSED_LIMIT = 3;
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
const MOBILE_DRAWER_MEDIA_QUERY = "(max-width: 1023px)";
const PROMPT_POOL_CANVAS_HANDOFF_QUERY_PARAM = "poolPromptHandoff";
const PROMPT_POOL_CANVAS_HANDOFF_STORAGE_PREFIX = "gpt-image-canvas.prompt-pool-handoff.";
const PROMPT_POOL_CANVAS_HANDOFF_TTL_MS = 5 * 60 * 1000;
const ASSET_PREVIEW_WIDTHS = [256, 512, 1024, 2048] as const;
type AssetPreviewWidth = (typeof ASSET_PREVIEW_WIDTHS)[number];
const GENERATED_ASSET_INITIAL_PREVIEW_WIDTH: AssetPreviewWidth = 2048;
const SUPPORTED_REFERENCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const initialCanvasPreviewWidths = new Map<string, AssetPreviewWidth>();
const assetMetadataCache = new Map<string, ImageSize>();
const assetMetadataRequests = new Map<string, Promise<ImageSize | undefined>>();
const RESOLUTION_BADGE_BASE_OFFSET = 7;
const RESOLUTION_BADGE_MIN_SCALE = 0.52;
const RESOLUTION_BADGE_SMALL_IMAGE_SIDE = 32;
const RESOLUTION_BADGE_FULL_SIZE_IMAGE_SIDE = 220;
const CANVAS_DEFAULT_SNAP_MODE = true;
const shapeUtils = [GenerationPlaceholderShapeUtil, AgentPlanNodeShapeUtil];
const tldrawOptions = {
  debouncedZoomThreshold: 80
} satisfies Partial<TldrawOptions>;
const TLDRAW_LICENSE_KEY =
  "tldraw-2026-08-08/WyJ3dGU4bldjRyIsWyIqIl0sMTYsIjIwMjYtMDgtMDgiXQ.Xt7lTydUhMnKfHfp+g8Mrs9gtJjlB8uPyYMniFEfRfruCYdYEl9J0uZl0lMAf6o7GdDB1zXOVhWLFAipssI6Cw";
const TLDRAW_USER_ID = "gpt-image-canvas-local-user";

function tldrawLocaleForLocale(locale: Locale): NonNullable<TLUserPreferences["locale"]> {
  return locale === "zh-CN" ? "zh-cn" : "en";
}

function localeForTldrawLocale(locale: TLUserPreferences["locale"]): Locale | undefined {
  if (locale === "zh-cn") {
    return "zh-CN";
  }

  if (locale === "en") {
    return "en";
  }

  return undefined;
}

function isDeepSeekAgentConfigView(config: Pick<AgentLlmConfigView, "baseUrl" | "model"> | null | undefined): boolean {
  if (!config) {
    return false;
  }

  const model = config.model.trim().toLowerCase();
  const baseUrl = config.baseUrl.trim().toLowerCase();
  return model.startsWith("deepseek-") || baseUrl.includes("deepseek.");
}

function agentThinkingSummaryText(locale: Locale): string {
  return locale === "zh-CN"
    ? "正在分析任务，整理生图计划与确认节点。"
    : "Reviewing the request and shaping a generation plan with confirmation steps.";
}

function agentThinkingChipLabel(locale: Locale, thinkingType: AgentThinkingType, effort: AgentReasoningEffort): string {
  if (locale === "zh-CN") {
    return thinkingType === "disabled" ? "思考 Off" : `思考 ${effort === "max" ? "Max" : "High"}`;
  }

  return thinkingType === "disabled" ? "Thinking Off" : `Thinking ${effort === "max" ? "Max" : "High"}`;
}

function agentThinkingModeLabel(locale: Locale): string {
  return locale === "zh-CN" ? "思考模式" : "Thinking mode";
}

function agentThinkingEffortLabel(locale: Locale): string {
  return locale === "zh-CN" ? "思考强度" : "Reasoning effort";
}

function agentThinkingEnabledLabel(locale: Locale): string {
  return locale === "zh-CN" ? "开启" : "On";
}

function agentThinkingDisabledLabel(locale: Locale): string {
  return locale === "zh-CN" ? "关闭" : "Off";
}

function agentThinkingRawToggleLabel(locale: Locale, expanded: boolean): string {
  if (locale === "zh-CN") {
    return expanded ? "收起推理摘要" : "查看推理摘要";
  }

  return expanded ? "Hide reasoning summary" : "Show reasoning summary";
}

function agentThinkingDetailsSummary(locale: Locale, characterCount: number): string {
  return locale === "zh-CN"
    ? `已收到 ${characterCount} 个字符的推理流。普通对话只保留当前进度，调试事件可在 Agent 调试记录中导出。`
    : `Received ${characterCount} characters of reasoning stream. The conversation only keeps current progress; debug events can be exported from Agent debug trace.`;
}

function reasoningDetailsCharacterCount(details: string | undefined): number {
  if (!details) {
    return 0;
  }

  const match = details.match(/(?:已收到|Received)\s+(\d+)/u);
  return match?.[1] ? Number.parseInt(match[1], 10) || 0 : 0;
}

function agentPreviewDisclosureLabel(locale: Locale, count: number): string {
  if (locale === "zh-CN") {
    return `${count} 张缩略图`;
  }

  return `${count} ${count === 1 ? "thumbnail" : "thumbnails"}`;
}

const defaultStorageConfigForm: StorageConfigFormState = {
  enabled: false,
  provider: "cos",
  cos: {
    secretId: "",
    secretKey: "",
    bucket: "source-1253253332",
    region: "ap-nanjing",
    keyPrefix: "gpt-image-canvas/assets"
  },
  s3: {
    accessKeyId: "",
    secretAccessKey: "",
    bucket: "",
    region: "auto",
    keyPrefix: "gpt-image-canvas/assets",
    endpointMode: "r2-account",
    accountId: "",
    endpoint: "",
    forcePathStyle: false
  }
};

const canvasAssetStore: TLAssetStore = {
  async upload(_asset, file) {
    const uploaded = await uploadCanvasAsset(file);
    return {
      src: uploaded.url
    };
  },
  resolve(asset, context) {
    return resolveCanvasAssetUrl(asset, context);
  }
};

async function uploadCanvasAsset(file: File): Promise<GeneratedAsset> {
  const response = await fetch("/api/assets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      dataUrl: await blobToDataUrl(file),
      fileName: file.name
    })
  });

  const body = (await response.json().catch(() => undefined)) as { asset?: GeneratedAsset; error?: { message?: string } } | undefined;
  if (!response.ok || !body?.asset) {
    throw new Error(body?.error?.message ?? "Asset upload failed.");
  }

  rememberAssetMetadata(body.asset.id, {
    width: body.asset.width,
    height: body.asset.height
  });
  return body.asset;
}

const promptStarters = [
  {
    labelKey: "promptStarterProductLabel",
    promptKey: "promptStarterProductPrompt"
  },
  {
    labelKey: "promptStarterInteriorLabel",
    promptKey: "promptStarterInteriorPrompt"
  },
  {
    labelKey: "promptStarterAvatarLabel",
    promptKey: "promptStarterAvatarPrompt"
  },
  {
    labelKey: "promptStarterCityLabel",
    promptKey: "promptStarterCityPrompt"
  }
] as const;
const DEFAULT_SIZE_PRESET_ID = "portrait-4k";
const DEFAULT_IMAGE_QUALITY: ImageQuality = "high";
const RESOLUTION_PRESETS = [
  { id: "1k", label: "1K" },
  { id: "2k", label: "2K" },
  { id: "4k", label: "4K" }
] as const;
type ResolutionPresetId = (typeof RESOLUTION_PRESETS)[number]["id"];

const ASPECT_RATIO_PRESETS = [
  { id: "1-1", label: "1:1" },
  { id: "16-9", label: "16:9" },
  { id: "9-16", label: "9:16" },
  { id: "4-3", label: "4:3" },
  { id: "3-4", label: "3:4" },
  { id: "3-2", label: "3:2" },
  { id: "2-3", label: "2:3" }
] as const;
type AspectRatioPresetId = (typeof ASPECT_RATIO_PRESETS)[number]["id"];

const SIZE_MATRIX: Record<ResolutionPresetId, Record<AspectRatioPresetId, { width: number; height: number; presetId: string }>> = {
  "1k": {
    "1-1": { width: 1024, height: 1024, presetId: "square-1k" },
    "16-9": { width: 1824, height: 1024, presetId: "video-16-9" },
    "9-16": { width: 1024, height: 1824, presetId: "story-9-16" },
    "4-3": { width: 1360, height: 1024, presetId: "ratio-4-3-1k" },
    "3-4": { width: 1024, height: 1360, presetId: "ratio-3-4-1k" },
    "3-2": { width: 1536, height: 1024, presetId: "poster-landscape" },
    "2-3": { width: 1024, height: 1536, presetId: "poster-portrait" }
  },
  "2k": {
    "1-1": { width: 2048, height: 2048, presetId: "square-2k" },
    "16-9": { width: 2048, height: 1152, presetId: "wide-2k" },
    "9-16": { width: 1152, height: 2048, presetId: "portrait-2k" },
    "4-3": { width: 2048, height: 1536, presetId: "ratio-4-3-2k" },
    "3-4": { width: 1536, height: 2048, presetId: "ratio-3-4-2k" },
    "3-2": { width: 2016, height: 1344, presetId: "ratio-3-2-2k" },
    "2-3": { width: 1344, height: 2016, presetId: "ratio-2-3-2k" }
  },
  "4k": {
    "1-1": { width: 2880, height: 2880, presetId: "square-4k" },
    "16-9": { width: 3840, height: 2160, presetId: "wide-4k" },
    "9-16": { width: 2160, height: 3840, presetId: "portrait-4k" },
    "4-3": { width: 2880, height: 2160, presetId: "ratio-4-3-4k" },
    "3-4": { width: 2160, height: 2880, presetId: "ratio-3-4-4k" },
    "3-2": { width: 3264, height: 2176, presetId: "ratio-3-2-4k" },
    "2-3": { width: 2176, height: 3264, presetId: "ratio-2-3-4k" }
  }
};
const DEFAULT_RESOLUTION_PRESET_ID: ResolutionPresetId = "4k";
const DEFAULT_ASPECT_RATIO_PRESET_ID: AspectRatioPresetId = "9-16";
const DEFAULT_SIZE = SIZE_MATRIX[DEFAULT_RESOLUTION_PRESET_ID][DEFAULT_ASPECT_RATIO_PRESET_ID];
const DEFAULT_SIZE_PRESET = SIZE_PRESETS.find((preset) => preset.id === DEFAULT_SIZE_PRESET_ID) ?? SIZE_PRESETS[0];
const quickSizePresetIds = new Set([
  "square-1k",
  "poster-portrait",
  "poster-landscape",
  "story-9-16",
  "video-16-9",
  "wide-2k",
  DEFAULT_SIZE_PRESET_ID
]);
const quickSizePresets = SIZE_PRESETS.filter((preset) => quickSizePresetIds.has(preset.id));
const PRIMARY_GENERATION_COUNTS: readonly GenerationCount[] = [1, 2, 4];
const EXTENDED_GENERATION_COUNTS: readonly GenerationCount[] = [8, 16];

type GalleryPageModule = { default: typeof import("../gallery/GalleryPage").GalleryPage };
let galleryPageModulePromise: Promise<GalleryPageModule> | undefined;

function loadGalleryPageModule(): Promise<GalleryPageModule> {
  galleryPageModulePromise ??= import("../gallery/GalleryPage").then((module) => ({ default: module.GalleryPage }));
  return galleryPageModulePromise;
}

const LazyGalleryPage = lazy(loadGalleryPageModule);

function preloadGalleryPage(): void {
  void loadGalleryPageModule();
}

type PromptPoolPageModule = { default: typeof import("../pool/PromptPoolPage").PromptPoolPage };
let promptPoolPageModulePromise: Promise<PromptPoolPageModule> | undefined;

function loadPromptPoolPageModule(): Promise<PromptPoolPageModule> {
  promptPoolPageModulePromise ??= import("../pool/PromptPoolPage").then((module) => ({ default: module.PromptPoolPage }));
  return promptPoolPageModulePromise;
}

const LazyPromptPoolPage = lazy(loadPromptPoolPageModule);

function preloadPromptPoolPage(): void {
  void loadPromptPoolPageModule();
}

type PersistedSnapshot = TLEditorSnapshot | TLStoreSnapshot;
type AppRoute = "home" | "canvas" | "pool" | "gallery";
type SaveStatus = "loading" | "saved" | "pending" | "saving" | "error";
type GenerationMode = "text" | "reference";
type PanelTab = "manual" | "agent";
type PromptPoolCanvasHandoffItem = Pick<PromptPoolItem, "aspectRatio" | "id" | "imageHeight" | "imageWidth" | "mediaType" | "prompt">;
type PromptPoolCanvasHandoff = {
  createdAt: number;
  item: PromptPoolCanvasHandoffItem;
};
type PanelStatusTone = "progress" | "success" | "warning" | "error";
type CodexLoginStatus = "idle" | "starting" | "pending" | "authorized" | "expired" | "denied" | "error";
type AgentRunStatus = "idle" | "connecting" | "running";
type AgentChatMessageRole = "user" | "assistant" | "thinking" | "system" | "error" | "question" | "plan";
type AgentPlanAction = "execute" | "cancel" | "retry_failed";

function isCopyableAgentMessageRole(role: AgentChatMessageRole): boolean {
  return role === "user" || role === "assistant" || role === "thinking";
}

function isAgentUserInputErrorCode(code: string | undefined): boolean {
  return code === "missing_selected_canvas_reference" || code === "agent_requires_user_input";
}

interface PanelStatus {
  tone: PanelStatusTone;
  message: string;
  testId: "generation-progress" | "generation-message" | "generation-warning" | "validation-message" | "generation-error";
}

interface AgentChatAssetPreview {
  id: string;
  assetId: string;
  jobId: string;
  outputId?: string;
  planId?: string;
  shapeId?: TLShapeId;
  url: string;
}

interface AgentChatMessage {
  id: string;
  role: AgentChatMessageRole;
  content: string;
  details?: string;
  timestamp: string;
  runId?: string;
  plan?: unknown;
  previews?: AgentChatAssetPreview[];
}

const agentChatMessageRoles = new Set<AgentChatMessageRole>(["user", "assistant", "thinking", "system", "error", "question", "plan"]);

function isAgentChatMessageRole(value: unknown): value is AgentChatMessageRole {
  return typeof value === "string" && agentChatMessageRoles.has(value as AgentChatMessageRole);
}

function createAgentConversationId(): string {
  return `agent-conversation-${crypto.randomUUID()}`;
}

function agentConversationTitle(messages: AgentChatMessage[]): string | undefined {
  const firstUserMessage = messages.find((message) => message.role === "user" && message.content.trim());
  const title = firstUserMessage?.content.trim().replace(/\s+/gu, " ");
  if (!title) {
    return undefined;
  }

  return title.length > 120 ? `${title.slice(0, 119)}...` : title;
}

function conversationMessagesFromAgentChat(messages: AgentChatMessage[]): AgentConversationMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    details: message.details,
    timestamp: message.timestamp,
    runId: message.runId,
    plan: message.plan,
    previews: message.previews?.map((preview) => ({
      id: preview.id,
      assetId: preview.assetId,
      jobId: preview.jobId,
      outputId: preview.outputId,
      planId: preview.planId,
      shapeId: preview.shapeId,
      url: preview.url
    }))
  }));
}

function agentChatMessagesFromConversation(messages: AgentConversationMessage[]): AgentChatMessage[] {
  return messages.flatMap((message) => {
    if (!isAgentChatMessageRole(message.role)) {
      return [];
    }

    return [
      {
        id: message.id,
        role: message.role,
        content: message.content,
        details: message.details,
        timestamp: message.timestamp,
        runId: message.runId,
        plan: message.plan,
        previews: message.previews?.map((preview) => ({
          id: preview.id,
          assetId: preview.assetId,
          jobId: preview.jobId,
          outputId: preview.outputId,
          planId: preview.planId,
          shapeId: preview.shapeId as TLShapeId | undefined,
          url: preview.url
        }))
      }
    ];
  });
}

function copyableThinkingMessageText(message: Pick<AgentChatMessage, "content" | "details">): string {
  if (!AGENT_TRACE_DEBUG_ENABLED || !message.details) {
    return message.content;
  }

  return reasoningDetailsCharacterCount(message.details) > 0 ? `${message.content}\n\n${message.details}` : message.content;
}

interface GenerationSubmitInput {
  prompt: string;
  presetId: StylePresetId;
  sizePresetId: string;
  size: {
    width: number;
    height: number;
  };
  quality: ImageQuality;
  outputFormat: OutputFormat;
  count: GenerationCount;
}

interface GenerationReferenceInput {
  referenceImages: ReferenceImageInput[];
  referenceAssetIds?: string[];
}

interface GenerationPlaceholderPlacement {
  id: TLShapeId;
  x: number;
  y: number;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
}

interface AgentOutputPlacementLayout {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
}

interface ActiveGenerationPlaceholders {
  requestId: string;
  placements: GenerationPlaceholderPlacement[];
}

interface AgentJobPlaceholderSet {
  planId: string;
  jobId: string;
  runId?: string;
  placeholderSet: ActiveGenerationPlaceholders;
  outputSlots: Map<string, number>;
}

interface ActiveGenerationTask {
  requestId: string;
  controller: AbortController;
  placeholderSet: ActiveGenerationPlaceholders;
}

interface StorageConfigFormState {
  enabled: boolean;
  provider: CloudStorageProvider;
  cos: {
    secretId: string;
    secretKey: string;
    bucket: string;
    region: string;
    keyPrefix: string;
  };
  s3: {
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    region: string;
    keyPrefix: string;
    endpointMode: S3EndpointMode;
    accountId: string;
    endpoint: string;
    forcePathStyle: boolean;
  };
}

interface StorageSecretTouchedState {
  cos: boolean;
  s3: boolean;
}

interface ReferenceSelectionItem {
  assetId: TLAssetId | null;
  localAssetId?: string;
  name: string;
  sourceUrl: string;
  width: number;
  height: number;
  canvasX: number;
  canvasY: number;
  canvasWidth: number;
  canvasHeight: number;
}

type ReferenceSelection =
  | {
      status: "none" | "too-many" | "non-image" | "unreadable";
      hint: string;
    }
  | {
      status: "ready";
      references: ReferenceSelectionItem[];
      hint: string;
    };

interface AgentReferenceSelection {
  references: ReferenceSelectionItem[];
  selectedImageCount: number;
  totalSelectedCount: number;
  hint: string;
  warning?: string;
}

function missingReferenceSelection(t: Translate): ReferenceSelection {
  return {
    status: "none",
    hint: t("generationReferenceNeed", { max: MAX_REFERENCE_IMAGES })
  };
}

function emptyAgentReferenceSelection(t: Translate): AgentReferenceSelection {
  return {
    references: [],
    selectedImageCount: 0,
    totalSelectedCount: 0,
    hint: t("agentReferenceEmpty")
  };
}

const historyStatusStyles: Record<GenerationStatus, string> = {
  pending: "history-status--pending",
  running: "history-status--running",
  succeeded: "history-status--succeeded",
  partial: "history-status--partial",
  failed: "history-status--failed",
  cancelled: "history-status--cancelled"
};

function sizePresetLabel(preset: SizePreset, t: Translate): string {
  return t("sizePresetLabel", { presetId: preset.id, fallback: preset.label });
}

function sizePresetOptionLabel(preset: SizePreset, t: Translate): string {
  return `${sizePresetLabel(preset, t)} - ${preset.width} x ${preset.height}`;
}

function normalizeDimension(value: string): number {
  return Number.parseInt(value, 10);
}

function sizeValidationMessage(width: number, height: number, t: Translate, locale: Locale): string {
  const result = validateImageSize({ width, height });

  if (result.ok) {
    return "";
  }

  return imageSizeValidationMessage(result.reason, t, locale);
}

function generationValidationMessage(promptValue: string, widthValue: number, heightValue: number, t: Translate, locale: Locale): string {
  return promptValue.trim() ? sizeValidationMessage(widthValue, heightValue, t, locale) : t("promptRequired");
}

function imageSizeValidationMessage(reason: ImageSizeValidationReason | undefined, t: Translate, locale: Locale): string {
  const numberFormat = new Intl.NumberFormat(locale);

  switch (reason) {
    case "non_integer":
      return t("imageSizeNonInteger");
    case "too_small":
      return t("imageSizeTooSmall", { min: MIN_IMAGE_DIMENSION });
    case "too_large":
      return t("imageSizeTooLarge", { max: MAX_IMAGE_DIMENSION });
    case "not_multiple":
      return t("imageSizeNotMultiple", { multiple: IMAGE_SIZE_MULTIPLE });
    case "aspect_ratio":
      return t("imageSizeAspectRatio", { maxRatio: MAX_IMAGE_ASPECT_RATIO });
    case "total_pixels_too_small":
      return t("imageSizeTotalTooSmall", { minPixels: numberFormat.format(MIN_TOTAL_PIXELS) });
    case "total_pixels_too_large":
      return t("imageSizeTotalTooLarge", { maxPixels: numberFormat.format(MAX_TOTAL_PIXELS) });
    case "unsupported_preset":
      return t("imageSizeUnsupportedPreset");
    default:
      return t("imageSizeUnsupportedPreset");
  }
}

function routeFromLocation(): AppRoute {
  if (window.location.pathname === "/canvas") {
    return "canvas";
  }

  if (window.location.pathname === "/pool") {
    return "pool";
  }

  return window.location.pathname === "/gallery" ? "gallery" : "home";
}

function pathForRoute(route: AppRoute): string {
  if (route === "canvas") {
    return "/canvas";
  }

  if (route === "pool") {
    return "/pool";
  }

  return route === "gallery" ? "/gallery" : "/";
}

function promptPoolCanvasHandoffStorageKey(token: string): string {
  return `${PROMPT_POOL_CANVAS_HANDOFF_STORAGE_PREFIX}${token}`;
}

function createPromptPoolCanvasHandoffToken(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isPromptPoolCanvasHandoff(value: unknown): value is PromptPoolCanvasHandoff {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const handoff = value as Partial<PromptPoolCanvasHandoff>;
  const item = handoff.item as Partial<PromptPoolCanvasHandoffItem> | undefined;
  return (
    typeof handoff.createdAt === "number" &&
    typeof item?.id === "string" &&
    typeof item?.prompt === "string" &&
    (item?.mediaType === "image" || item?.mediaType === "video")
  );
}

function writePromptPoolCanvasHandoff(item: PromptPoolItem): string | null {
  const token = createPromptPoolCanvasHandoffToken();
  const handoff: PromptPoolCanvasHandoff = {
    createdAt: Date.now(),
    item: {
      aspectRatio: item.aspectRatio,
      id: item.id,
      imageHeight: item.imageHeight,
      imageWidth: item.imageWidth,
      mediaType: item.mediaType,
      prompt: item.prompt
    }
  };

  try {
    window.localStorage.setItem(promptPoolCanvasHandoffStorageKey(token), JSON.stringify(handoff));
    return token;
  } catch {
    return null;
  }
}

function createPromptPoolCanvasHandoffUrl(item: PromptPoolItem): string | null {
  const token = writePromptPoolCanvasHandoff(item);
  if (!token) {
    return null;
  }

  const url = new URL("/canvas", window.location.origin);
  url.searchParams.set(PROMPT_POOL_CANVAS_HANDOFF_QUERY_PARAM, token);
  return url.toString();
}

function clearPromptPoolCanvasHandoffUrl(url: URL): void {
  url.searchParams.delete(PROMPT_POOL_CANVAS_HANDOFF_QUERY_PARAM);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function consumePromptPoolCanvasHandoffFromLocation(): PromptPoolCanvasHandoffItem | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get(PROMPT_POOL_CANVAS_HANDOFF_QUERY_PARAM);
  if (!token) {
    return null;
  }

  clearPromptPoolCanvasHandoffUrl(url);

  try {
    const storageKey = promptPoolCanvasHandoffStorageKey(token);
    const rawHandoff = window.localStorage.getItem(storageKey);
    window.localStorage.removeItem(storageKey);
    if (!rawHandoff) {
      return null;
    }

    const handoff = JSON.parse(rawHandoff) as unknown;
    if (!isPromptPoolCanvasHandoff(handoff) || Date.now() - handoff.createdAt > PROMPT_POOL_CANVAS_HANDOFF_TTL_MS) {
      return null;
    }

    return handoff.item;
  } catch {
    return null;
  }
}

function isPersistedSnapshot(value: unknown): value is PersistedSnapshot {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGenerationResponse(value: unknown): value is GenerationResponse {
  return typeof value === "object" && value !== null && "record" in value;
}

function failedOutputMessages(record: GenerationRecord): string[] {
  const seen = new Set<string>();
  const messages: string[] = [];

  for (const output of record.outputs) {
    if (output.status !== "failed") {
      continue;
    }

    const message = output.error?.trim();
    if (!message || seen.has(message)) {
      continue;
    }

    seen.add(message);
    messages.push(message);
  }

  return messages;
}

function generationFailureMessage(record: GenerationRecord, t: Translate): string {
  const summary = record.error?.trim();
  const firstFailure = failedOutputMessages(record)[0];

  if (firstFailure) {
    return summary && summary !== firstFailure ? t("generationFailureReason", { summary, reason: firstFailure }) : firstFailure;
  }

  return summary || t("generationNoSuccessfulImage");
}

function generationWarningMessage(record: GenerationRecord, insertedCount: number, failedCount: number, cloudFailedCount: number, t: Translate): string {
  const parts = [t("generationImageInsertedPart", { count: insertedCount })];
  if (failedCount > 0) {
    parts.push(t("generationFailedCount", { count: failedCount }));
  }
  if (cloudFailedCount > 0) {
    parts.push(t("generationCloudSavedButFailed", { count: cloudFailedCount }));
  }

  const firstFailure = failedOutputMessages(record)[0];
  const message = parts.join(t("commonListSeparator"));
  return firstFailure
    ? t("generationFailureReason", { summary: `${message}${t("commonSentenceEnd")}`, reason: firstFailure })
    : `${message}${t("commonSentenceEnd")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoadingGenerationPlaceholderRecord(value: unknown): boolean {
  const props = isRecord(value) && isRecord(value.props) ? value.props : undefined;
  const requestId = typeof props?.requestId === "string" ? props.requestId : "";

  return (
    isRecord(value) &&
    value.typeName === "shape" &&
    value.type === GENERATION_PLACEHOLDER_TYPE &&
    props !== undefined &&
    props.status === "loading" &&
    (requestId.startsWith("agent-") || /^\d+$/u.test(requestId))
  );
}

function isAgentPlanNodeSnapshotRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.typeName === "shape" && value.type === AGENT_PLAN_NODE_TYPE;
}

function filterLoadingPlaceholdersFromStoreSnapshot<TSnapshot>(snapshot: TSnapshot): TSnapshot {
  if (!isRecord(snapshot) || !isRecord(snapshot.store)) {
    return snapshot;
  }

  let changed = false;
  const nextStore: Record<string, unknown> = {};
  for (const [id, record] of Object.entries(snapshot.store)) {
    if (isLoadingGenerationPlaceholderRecord(record)) {
      changed = true;
      continue;
    }

    if (isAgentPlanNodeSnapshotRecord(record)) {
      changed = true;
      continue;
    }

    nextStore[id] = record;
  }

  return changed ? ({ ...snapshot, store: nextStore } as TSnapshot) : snapshot;
}

function filterLoadingPlaceholdersFromSnapshot<TSnapshot>(snapshot: TSnapshot): TSnapshot {
  if (!isRecord(snapshot)) {
    return snapshot;
  }

  if (isRecord(snapshot.document)) {
    const document = filterLoadingPlaceholdersFromStoreSnapshot(snapshot.document);
    return document === snapshot.document ? snapshot : ({ ...snapshot, document } as TSnapshot);
  }

  return filterLoadingPlaceholdersFromStoreSnapshot(snapshot);
}

function coerceStylePresetId(value: string): StylePresetId {
  return STYLE_PRESETS.some((preset) => preset.id === value) ? (value as StylePresetId) : "none";
}

function coerceGenerationCount(value: number): GenerationCount {
  return GENERATION_COUNTS.includes(value as GenerationCount) ? (value as GenerationCount) : 1;
}

function sizePresetIdForSize(widthValue: number, heightValue: number): string {
  return (
    SIZE_PRESETS.find((preset) => preset.width === widthValue && preset.height === heightValue)?.id ?? CUSTOM_SIZE_PRESET_ID
  );
}

function promptLikeSizePreset(item: {
  mediaType: "image" | "video";
  aspectRatio?: string;
  imageWidth?: number;
  imageHeight?: number;
}): SizePreset {
  if (item.mediaType === "video" && item.aspectRatio === "16:9") {
    return SIZE_PRESETS.find((preset) => preset.id === "video-16-9") ?? DEFAULT_SIZE_PRESET;
  }

  if (!item.imageWidth || !item.imageHeight) {
    return DEFAULT_SIZE_PRESET;
  }

  const targetRatio = item.imageWidth / item.imageHeight;
  return SIZE_PRESETS.reduce((best, preset) => {
    const bestDelta = Math.abs(best.width / best.height - targetRatio);
    const presetDelta = Math.abs(preset.width / preset.height - targetRatio);
    if (presetDelta < bestDelta) {
      return preset;
    }

    return best;
  }, DEFAULT_SIZE_PRESET);
}

function promptFavoriteSizePreset(item: PromptFavoriteItem): SizePreset {
  return promptLikeSizePreset(item);
}

function sizeSelectionForSize(
  widthValue: number,
  heightValue: number
): { resolutionPresetId: ResolutionPresetId; aspectRatioPresetId: AspectRatioPresetId; sizePresetId: string } | undefined {
  for (const resolution of RESOLUTION_PRESETS) {
    for (const aspectRatio of ASPECT_RATIO_PRESETS) {
      const size = SIZE_MATRIX[resolution.id][aspectRatio.id];
      if (size.width === widthValue && size.height === heightValue) {
        return {
          resolutionPresetId: resolution.id,
          aspectRatioPresetId: aspectRatio.id,
          sizePresetId: size.presetId
        };
      }
    }
  }

  return undefined;
}

function firstDownloadableAsset(record: GenerationRecord): GeneratedAsset | undefined {
  return record.outputs.find((output) => output.status === "succeeded" && output.asset)?.asset;
}

function successfulOutputCount(record: GenerationRecord): number {
  return record.outputs.filter((output) => output.status === "succeeded" && output.asset).length;
}

function cloudFailureCount(record: GenerationRecord): number {
  return record.outputs.filter((output) => output.asset?.cloud?.status === "failed").length;
}

function firstCloudFailureMessage(record: GenerationRecord): string | undefined {
  return record.outputs.find((output) => output.asset?.cloud?.status === "failed")?.asset?.cloud?.lastError;
}

function generationModeToRecordMode(mode: GenerationMode): GenerationRecord["mode"] {
  return mode === "reference" ? "edit" : "generate";
}

function referenceAssetIdsForRecord(record: GenerationRecord): string[] {
  if (record.referenceAssetIds?.length) {
    return record.referenceAssetIds;
  }

  return record.referenceAssetId ? [record.referenceAssetId] : [];
}

function referenceAssetIdsForSelection(selection: Extract<ReferenceSelection, { status: "ready" }>): string[] | undefined {
  const referenceAssetIds = selection.references.map((reference) => reference.localAssetId);
  return referenceAssetIds.every((referenceAssetId): referenceAssetId is string => Boolean(referenceAssetId))
    ? referenceAssetIds
    : undefined;
}

function createTemporaryGenerationRecord(input: {
  requestId: string;
  submitInput: GenerationSubmitInput;
  requestMode: GenerationMode;
  referenceAssetIds?: string[];
  referenceAssetId?: string;
}): GenerationRecord {
  const promptValue = input.submitInput.prompt.trim();
  const referenceAssetIds = input.referenceAssetIds ?? (input.referenceAssetId ? [input.referenceAssetId] : undefined);

  return {
    id: input.requestId,
    mode: generationModeToRecordMode(input.requestMode),
    prompt: promptValue,
    effectivePrompt: promptValue,
    presetId: input.submitInput.presetId,
    size: input.submitInput.size,
    quality: input.submitInput.quality,
    outputFormat: input.submitInput.outputFormat,
    count: input.submitInput.count,
    status: "running",
    referenceAssetIds,
    referenceAssetId: referenceAssetIds?.[0] ?? input.referenceAssetId,
    createdAt: new Date().toISOString(),
    outputs: []
  };
}

function promptExcerpt(promptValue: string): string {
  const compact = promptValue.replace(/\s+/gu, " ").trim();
  return compact.length > 72 ? `${compact.slice(0, 72)}...` : compact;
}

function countPromptFavoritesByGroup(favorites: PromptFavoriteItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const favorite of favorites) {
    counts.set(favorite.groupId, (counts.get(favorite.groupId) ?? 0) + 1);
  }

  return counts;
}

function filterPromptFavorites(favorites: PromptFavoriteItem[], query: string, groupId: string): PromptFavoriteItem[] {
  const needle = query.trim().toLowerCase();
  return favorites
    .filter((favorite) => {
      if (groupId !== "all" && favorite.groupId !== groupId) {
        return false;
      }

      if (!needle) {
        return true;
      }

      const haystack = `${favorite.title} ${favorite.prompt} ${favorite.model}`.toLowerCase();
      return haystack.includes(needle);
    })
    .sort((left, right) => promptFavoriteSortTime(right) - promptFavoriteSortTime(left));
}

function promptFavoriteSortTime(favorite: PromptFavoriteItem): number {
  const value = favorite.lastUsedAt ?? favorite.updatedAt ?? favorite.createdAt;
  return Date.parse(value) || 0;
}

function promptFavoriteMeta(favorite: PromptFavoriteItem, t: Translate): string {
  const mediaLabel = favorite.mediaType === "video" ? t("poolMediaVideo") : t("poolMediaImage");
  const sizeLabel =
    favorite.imageWidth && favorite.imageHeight ? `${favorite.imageWidth}x${favorite.imageHeight}` : mediaLabel;
  return `${favorite.model} · ${sizeLabel}`;
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea fallback for browser contexts that expose
      // the Clipboard API but reject writes without an explicit permission grant.
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.readOnly = true;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.append(textArea);
  textArea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Copy command was not accepted.");
    }
  } finally {
    textArea.remove();
  }
}

function formatCreatedTime(value: string, formatDateTime: (value: string) => string): string {
  return formatDateTime(value);
}

function formatCodexExpiry(value: string, formatDateTime: (value: string, options?: Intl.DateTimeFormatOptions) => string, t: Translate): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t("timeFallback15Minutes");
  }

  return formatDateTime(value, {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function createTldrawAssetId(assetId: string): TLAssetId {
  return `asset:${assetId}` as TLAssetId;
}

function createTldrawShapeId(): TLShapeId {
  return `shape:${crypto.randomUUID()}` as TLShapeId;
}

function displaySize(size: ImageSize): { width: number; height: number } {
  const scale = Math.min(1, 340 / size.width, 300 / size.height);
  return {
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale)
  };
}

function createCenteredPlacements(editor: Editor, countValue: GenerationCount, size: ImageSize): GenerationPlaceholderPlacement[] {
  const placeholderSize = displaySize(size);
  const columns = countValue >= 8 ? 4 : countValue === 1 ? 1 : 2;
  const rows = Math.ceil(countValue / columns);
  const gap = 48;
  const cellWidth = placeholderSize.width;
  const cellHeight = placeholderSize.height;
  const gridWidth = columns * cellWidth + (columns - 1) * gap;
  const gridHeight = rows * cellHeight + (rows - 1) * gap;
  const viewport = editor.getViewportPageBounds();
  const originX = viewport.center.x - gridWidth / 2;
  const originY = viewport.center.y - gridHeight / 2;

  return Array.from({ length: countValue }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);

    return {
      id: createTldrawShapeId(),
      x: originX + column * (cellWidth + gap),
      y: originY + row * (cellHeight + gap),
      width: placeholderSize.width,
      height: placeholderSize.height,
      targetWidth: size.width,
      targetHeight: size.height
    };
  });
}

function createReferenceAdjacentPlacements(
  references: ReferenceSelectionItem[],
  countValue: GenerationCount,
  size: ImageSize
): GenerationPlaceholderPlacement[] {
  if (references.length === 0) {
    return [];
  }

  const placeholderSize = displaySize(size);
  const columns = countValue >= 8 ? 4 : countValue === 1 ? 1 : 2;
  const rows = Math.ceil(countValue / columns);
  const gap = 48;
  const cellWidth = placeholderSize.width;
  const cellHeight = placeholderSize.height;
  const gridHeight = rows * cellHeight + (rows - 1) * gap;
  const referenceRight = Math.max(...references.map((reference) => reference.canvasX + reference.canvasWidth));
  const referenceTop = Math.min(...references.map((reference) => reference.canvasY));
  const referenceBottom = Math.max(...references.map((reference) => reference.canvasY + reference.canvasHeight));
  const originX = referenceRight + gap;
  const originY = (referenceTop + referenceBottom) / 2 - gridHeight / 2;

  return Array.from({ length: countValue }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);

    return {
      id: createTldrawShapeId(),
      x: originX + column * (cellWidth + gap),
      y: originY + row * (cellHeight + gap),
      width: placeholderSize.width,
      height: placeholderSize.height,
      targetWidth: size.width,
      targetHeight: size.height
    };
  });
}

function createGenerationPlaceholdersFromPlacements(
  editor: Editor,
  placements: GenerationPlaceholderPlacement[],
  requestId: string,
  options: { selectPlaceholders?: boolean } = {}
): ActiveGenerationPlaceholders {
  const placeholderIds = placements.map((placement) => placement.id);

  editor.createShapes<GenerationPlaceholderShape>(
    placements.map((placement, index) => ({
      id: placement.id,
      type: GENERATION_PLACEHOLDER_TYPE,
      x: placement.x,
      y: placement.y,
      props: {
        w: placement.width,
        h: placement.height,
        targetWidth: placement.targetWidth,
        targetHeight: placement.targetHeight,
        status: "loading",
        error: "",
        requestId: String(requestId),
        outputIndex: index
      }
    }))
  );
  editor.bringToFront(placeholderIds);
  if (options.selectPlaceholders ?? true) {
    editor.select(...placeholderIds);
  }

  return {
    requestId,
    placements
  };
}

function createGenerationPlaceholders(
  editor: Editor,
  input: GenerationSubmitInput,
  requestId: string,
  options: { references?: ReferenceSelectionItem[]; selectPlaceholders?: boolean } = {}
): ActiveGenerationPlaceholders {
  const placements = options.references?.length
    ? createReferenceAdjacentPlacements(options.references, input.count, input.size)
    : createCenteredPlacements(editor, input.count, input.size);
  return createGenerationPlaceholdersFromPlacements(editor, placements, requestId, options);
}

function deleteAgentPlanNodes(editor: Editor): number {
  const planNodeIds = editor.getCurrentPageShapes().flatMap((shape) => (isAgentPlanNodeShape(shape) ? [shape.id] : []));
  if (planNodeIds.length > 0) {
    editor.deleteShapes(planNodeIds);
  }

  return planNodeIds.length;
}

function agentPlanOutputLayout(plan: GenerationPlan): AgentOutputPlacementLayout {
  const totalCount = Math.max(1, plan.jobs.reduce((total, job) => total + Math.max(0, job.count), 0));
  const columns = totalCount >= 8 ? 4 : totalCount === 1 ? 1 : 2;
  const rows = Math.ceil(totalCount / columns);
  const displaySizes = plan.jobs.map((job) => displaySize(job.size ?? plan.defaults.size));
  const cellWidth = Math.max(...displaySizes.map((size) => size.width), 1);
  const cellHeight = Math.max(...displaySizes.map((size) => size.height), 1);

  return {
    columns,
    rows,
    cellWidth,
    cellHeight
  };
}

function agentOutputPlacementForSize(
  editor: Editor,
  targetSize: ImageSize,
  index: number,
  layout?: AgentOutputPlacementLayout
): GenerationPlaceholderPlacement {
  const size = displaySize(targetSize);
  const gap = 28;
  const columns = layout?.columns ?? 2;
  const cellWidth = layout?.cellWidth ?? size.width;
  const cellHeight = layout?.cellHeight ?? size.height;
  const rows = layout?.rows ?? Math.max(1, Math.ceil((index + 1) / columns));
  const viewport = editor.getViewportPageBounds();
  const gridWidth = columns * cellWidth + (columns - 1) * gap;
  const gridHeight = rows * cellHeight + (rows - 1) * gap;
  const baseX = viewport.center.x - gridWidth / 2;
  const baseY = viewport.center.y - gridHeight / 2;
  const column = index % columns;
  const row = Math.floor(index / columns);

  return {
    id: createTldrawShapeId(),
    x: baseX + column * (cellWidth + gap) + (cellWidth - size.width) / 2,
    y: baseY + row * (cellHeight + gap) + (cellHeight - size.height) / 2,
    width: size.width,
    height: size.height,
    targetWidth: targetSize.width,
    targetHeight: targetSize.height
  };
}

function agentOutputPlacement(
  editor: Editor,
  _planId: string | undefined,
  asset: GeneratedAsset,
  index: number
): GenerationPlaceholderPlacement {
  return agentOutputPlacementForSize(
    editor,
    {
      width: asset.width,
      height: asset.height
    },
    index
  );
}

function isGenerationPlaceholderShape(shape: unknown): shape is GenerationPlaceholderShape {
  return isRecord(shape) && shape.type === GENERATION_PLACEHOLDER_TYPE;
}

function livePlacement(editor: Editor, placement: GenerationPlaceholderPlacement): GenerationPlaceholderPlacement {
  const shape = editor.getShape(placement.id);
  if (!isGenerationPlaceholderShape(shape)) {
    return placement;
  }

  return {
    ...placement,
    x: shape.x,
    y: shape.y,
    width: shape.props.w,
    height: shape.props.h
  };
}

function createImageAsset(asset: GeneratedAsset): TLAsset {
  initialCanvasPreviewWidths.set(asset.id, GENERATED_ASSET_INITIAL_PREVIEW_WIDTH);
  rememberAssetMetadata(asset.id, {
    width: asset.width,
    height: asset.height
  });

  return {
    id: createTldrawAssetId(asset.id),
    typeName: "asset",
    type: "image",
    props: {
      src: asset.url,
      w: asset.width,
      h: asset.height,
      name: asset.fileName,
      mimeType: asset.mimeType,
      isAnimated: false
    },
    meta: {
      localAssetId: asset.id
    }
  };
}

function createImageShape(
  asset: GeneratedAsset,
  placement: GenerationPlaceholderPlacement,
  promptValue: string
): Partial<TLImageShape> & { id: TLShapeId; type: "image" } {
  const assetId = createTldrawAssetId(asset.id);

  return {
    id: createTldrawShapeId(),
    type: "image",
    x: placement.x,
    y: placement.y,
    props: {
      assetId,
      w: placement.width,
      h: placement.height,
      url: asset.url,
      playing: true,
      crop: null,
      flipX: false,
      flipY: false,
      altText: promptValue
    }
  };
}

function replaceGenerationPlaceholders(editor: Editor, placeholderSet: ActiveGenerationPlaceholders, record: GenerationRecord, t: Translate): number {
  const assets: TLAsset[] = [];
  const imageShapes: Array<Partial<TLImageShape> & { id: TLShapeId; type: "image" }> = [];
  const replacedPlaceholderIds: TLShapeId[] = [];
  const failedUpdates: Array<TLShapePartial<GenerationPlaceholderShape>> = [];

  placeholderSet.placements.forEach((placement, index) => {
    const placeholderShape = editor.getShape(placement.id);
    if (!isGenerationPlaceholderShape(placeholderShape)) {
      return;
    }

    const output = record.outputs[index];
    if (output?.status === "succeeded" && output.asset) {
      const resolvedPlacement = livePlacement(editor, placement);
      assets.push(createImageAsset(output.asset));
      imageShapes.push(createImageShape(output.asset, resolvedPlacement, record.prompt));
      replacedPlaceholderIds.push(placement.id);
      return;
    }

    failedUpdates.push({
      id: placement.id,
      type: GENERATION_PLACEHOLDER_TYPE,
      props: {
        status: "failed",
        error: output?.error || record.error || t("generationErrorDefault")
      }
    });
  });

  editor.run(() => {
    if (replacedPlaceholderIds.length > 0) {
      editor.deleteShapes(replacedPlaceholderIds);
    }
    if (assets.length > 0) {
      editor.createAssets(assets);
    }
    if (imageShapes.length > 0) {
      editor.createShapes(imageShapes);
    }
    if (failedUpdates.length > 0) {
      editor.updateShapes<GenerationPlaceholderShape>(failedUpdates);
    }
  });

  if (imageShapes.length > 0) {
    editor.select(...imageShapes.map((shape) => shape.id));
  }

  return imageShapes.length;
}

function generatedAssetsForRecord(record: GenerationRecord): GeneratedAsset[] {
  return record.outputs.flatMap((output) => (output.status === "succeeded" && output.asset ? [output.asset] : []));
}

async function preloadGenerationRecordPreviews(record: GenerationRecord, signal: AbortSignal): Promise<void> {
  await Promise.all(generatedAssetsForRecord(record).map((asset) => preloadGeneratedAssetPreview(asset, signal)));
}

async function preloadGeneratedAssetPreview(asset: GeneratedAsset, signal: AbortSignal): Promise<void> {
  try {
    await preloadImageUrl(assetPreviewUrl(asset.id, GENERATED_ASSET_INITIAL_PREVIEW_WIDTH), signal);
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
  }
}

function preloadImageUrl(url: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Image preload was aborted.", "AbortError"));
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";

    function cleanup(): void {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
    }
    function complete(): void {
      cleanup();
      resolve();
    }
    function fail(): void {
      cleanup();
      reject(new Error(`Image preload failed for ${url}`));
    }
    function abort(): void {
      cleanup();
      image.src = "";
      reject(new DOMException("Image preload was aborted.", "AbortError"));
    }

    image.onload = complete;
    image.onerror = fail;
    signal.addEventListener("abort", abort, { once: true });
    image.src = url;
  });
}

function waitForGenerationPollInterval(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Generation polling was aborted.", "AbortError"));
  }

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, GENERATION_POLL_INTERVAL_MS);

    function cleanup(): void {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }

    function abort(): void {
      cleanup();
      reject(new DOMException("Generation polling was aborted.", "AbortError"));
    }

    signal.addEventListener("abort", abort, { once: true });
  });
}

function markGenerationPlaceholdersFailed(editor: Editor, placeholderSet: ActiveGenerationPlaceholders, error: string): void {
  const updates = placeholderSet.placements.flatMap((placement) => {
    const shape = editor.getShape(placement.id);
    if (!isGenerationPlaceholderShape(shape) || shape.props.status !== "loading") {
      return [];
    }

    return [
      {
        id: placement.id,
        type: GENERATION_PLACEHOLDER_TYPE,
        props: {
          status: "failed",
          error
        }
      } satisfies TLShapePartial<GenerationPlaceholderShape>
    ];
  });

  if (updates.length > 0) {
    editor.updateShapes<GenerationPlaceholderShape>(updates);
  }
}

function deleteLoadingGenerationPlaceholders(editor: Editor, placeholderSet: ActiveGenerationPlaceholders): void {
  const loadingPlaceholderIds = placeholderSet.placements.flatMap((placement) => {
    const shape = editor.getShape(placement.id);
    return isGenerationPlaceholderShape(shape) && shape.props.status === "loading" ? [placement.id] : [];
  });

  if (loadingPlaceholderIds.length > 0) {
    editor.deleteShapes(loadingPlaceholderIds);
  }
}

function hasLoadingGenerationPlaceholders(editor: Editor, placeholderSet: ActiveGenerationPlaceholders): boolean {
  return placeholderSet.placements.some((placement) => {
    const shape = editor.getShape(placement.id);
    return isGenerationPlaceholderShape(shape) && shape.props.status === "loading";
  });
}

function firstLiveGenerationPlaceholder(editor: Editor, placeholderSet: ActiveGenerationPlaceholders): TLShapeId | undefined {
  return placeholderSet.placements.find((placement) => isGenerationPlaceholderShape(editor.getShape(placement.id)))?.id;
}

function isActiveGenerationRecord(record: GenerationRecord): boolean {
  return record.status === "pending" || record.status === "running";
}

function isTerminalGenerationRecord(record: GenerationRecord): boolean {
  return record.status === "succeeded" || record.status === "partial" || record.status === "failed" || record.status === "cancelled";
}

function placeholderSetForGenerationRecord(editor: Editor, record: GenerationRecord): ActiveGenerationPlaceholders | undefined {
  const placements = editor
    .getCurrentPageShapes()
    .flatMap((shape) => {
      if (!isGenerationPlaceholderShape(shape) || shape.props.requestId !== record.id) {
        return [];
      }

      return [
        {
          id: shape.id,
          x: shape.x,
          y: shape.y,
          width: shape.props.w,
          height: shape.props.h,
          targetWidth: shape.props.targetWidth,
          targetHeight: shape.props.targetHeight
        } satisfies GenerationPlaceholderPlacement
      ];
    })
    .sort((left, right) => {
      const leftShape = editor.getShape(left.id);
      const rightShape = editor.getShape(right.id);
      const leftIndex = isGenerationPlaceholderShape(leftShape) ? leftShape.props.outputIndex : 0;
      const rightIndex = isGenerationPlaceholderShape(rightShape) ? rightShape.props.outputIndex : 0;
      return leftIndex - rightIndex;
    });

  return placements.length > 0
    ? {
        requestId: record.id,
        placements
      }
    : undefined;
}

function resolveReferenceSelection(editor: Editor, t: Translate): ReferenceSelection {
  const selectedShapes = editor.getSelectedShapes();

  if (selectedShapes.length === 0) {
    return missingReferenceSelection(t);
  }

  if (selectedShapes.some((shape) => shape.type !== "image")) {
    return {
      status: "non-image",
      hint: t("generationSelectionNonImage", { max: MAX_REFERENCE_IMAGES })
    };
  }

  if (selectedShapes.length > MAX_REFERENCE_IMAGES) {
    return {
      status: "too-many",
      hint: t("generationSelectionTooMany", { count: selectedShapes.length, max: MAX_REFERENCE_IMAGES })
    };
  }

  const references: Array<ReferenceSelectionItem & { sortX: number; sortY: number }> = [];
  for (const shape of selectedShapes) {
    const imageShape = shape as TLImageShape;
    const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined;
    const sourceUrl = getImageSourceUrl(imageShape, asset);

    if (!sourceUrl) {
      return {
        status: "unreadable",
        hint: t("generationSelectionMissingSource")
      };
    }

    if (!isReadableReferenceSource(sourceUrl, asset)) {
      return {
        status: "unreadable",
        hint: t("generationSelectionUnreadable")
      };
    }

    const bounds = editor.getShapePageBounds(imageShape);
    references.push({
      assetId: imageShape.props.assetId,
      localAssetId: getLocalAssetId(asset, sourceUrl),
      name: getReferenceName(asset, sourceUrl),
      sourceUrl,
      width: asset?.type === "image" ? asset.props.w : imageShape.props.w,
      height: asset?.type === "image" ? asset.props.h : imageShape.props.h,
      canvasX: bounds?.x ?? imageShape.x,
      canvasY: bounds?.y ?? imageShape.y,
      canvasWidth: bounds?.w ?? imageShape.props.w,
      canvasHeight: bounds?.h ?? imageShape.props.h,
      sortX: bounds?.x ?? 0,
      sortY: bounds?.y ?? 0
    });
  }

  const sortedReferences = references
    .sort((left, right) => (left.sortY === right.sortY ? left.sortX - right.sortX : left.sortY - right.sortY))
    .map(({ sortX: _sortX, sortY: _sortY, ...reference }) => reference);

  return {
    status: "ready",
    references: sortedReferences,
    hint:
      sortedReferences.length === 1
        ? t("generationSelectedReferenceOne")
        : t("generationSelectedReferenceMany", { count: sortedReferences.length })
  };
}

function resolveAgentReferenceSelection(editor: Editor, t: Translate): AgentReferenceSelection {
  const selectedShapes = editor.getSelectedShapes();
  const selectedImages = selectedShapes
    .flatMap((shape) => (shape.type === "image" ? [shape as TLImageShape] : []))
    .map((imageShape) => ({
      imageShape,
      bounds: editor.getShapePageBounds(imageShape)
    }))
    .sort((left, right) => {
      const leftY = left.bounds?.y ?? 0;
      const rightY = right.bounds?.y ?? 0;
      return leftY === rightY ? (left.bounds?.x ?? 0) - (right.bounds?.x ?? 0) : leftY - rightY;
    });

  if (selectedImages.length === 0) {
    return {
      ...emptyAgentReferenceSelection(t),
      totalSelectedCount: selectedShapes.length
    };
  }

  const warnings: string[] = [];
  if (selectedImages.length > MAX_AGENT_SELECTED_REFERENCES) {
    warnings.push(t("agentReferenceTooMany", { count: selectedImages.length, max: MAX_AGENT_SELECTED_REFERENCES }));
  }
  const nonImageCount = selectedShapes.length - selectedImages.length;
  if (nonImageCount > 0) {
    warnings.push(t("agentReferenceIgnoredNonImages", { count: nonImageCount }));
  }

  const references: ReferenceSelectionItem[] = [];
  let unreadableCount = 0;
  for (const { imageShape, bounds } of selectedImages.slice(0, MAX_AGENT_SELECTED_REFERENCES)) {
    const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined;
    const sourceUrl = getImageSourceUrl(imageShape, asset);
    if (!sourceUrl || !isReadableReferenceSource(sourceUrl, asset)) {
      unreadableCount += 1;
      continue;
    }

    references.push({
      assetId: imageShape.props.assetId,
      localAssetId: getLocalAssetId(asset, sourceUrl),
      name: getReferenceName(asset, sourceUrl),
      sourceUrl,
      width: asset?.type === "image" ? asset.props.w : imageShape.props.w,
      height: asset?.type === "image" ? asset.props.h : imageShape.props.h,
      canvasX: bounds?.x ?? imageShape.x,
      canvasY: bounds?.y ?? imageShape.y,
      canvasWidth: bounds?.w ?? imageShape.props.w,
      canvasHeight: bounds?.h ?? imageShape.props.h
    });
  }

  if (unreadableCount > 0) {
    warnings.push(t("agentReferenceUnreadableSkipped", { count: unreadableCount }));
  }

  return {
    references,
    selectedImageCount: selectedImages.length,
    totalSelectedCount: selectedShapes.length,
    hint:
      references.length > 0
        ? t("agentReferenceReady", { count: references.length, max: MAX_AGENT_SELECTED_REFERENCES })
        : t("agentReferenceEmpty"),
    warning: warnings.join(t("commonListSeparator")) || undefined
  };
}

function areReferenceSelectionsEqual(left: ReferenceSelection, right: ReferenceSelection): boolean {
  if (left.status !== right.status) {
    return false;
  }

  if (left.status !== "ready" || right.status !== "ready") {
    return left.hint === right.hint;
  }

  return (
    left.hint === right.hint &&
    left.references.length === right.references.length &&
    left.references.every((leftReference, index) => {
      const rightReference = right.references[index];
      return (
        rightReference !== undefined &&
        leftReference.assetId === rightReference.assetId &&
        leftReference.localAssetId === rightReference.localAssetId &&
        leftReference.name === rightReference.name &&
        leftReference.sourceUrl === rightReference.sourceUrl &&
        leftReference.width === rightReference.width &&
        leftReference.height === rightReference.height &&
        leftReference.canvasX === rightReference.canvasX &&
        leftReference.canvasY === rightReference.canvasY &&
        leftReference.canvasWidth === rightReference.canvasWidth &&
        leftReference.canvasHeight === rightReference.canvasHeight
      );
    })
  );
}

function areAgentReferenceSelectionsEqual(left: AgentReferenceSelection, right: AgentReferenceSelection): boolean {
  return (
    left.hint === right.hint &&
    left.warning === right.warning &&
    left.selectedImageCount === right.selectedImageCount &&
    left.totalSelectedCount === right.totalSelectedCount &&
    left.references.length === right.references.length &&
    left.references.every((leftReference, index) => {
      const rightReference = right.references[index];
      return (
        rightReference !== undefined &&
        leftReference.assetId === rightReference.assetId &&
        leftReference.localAssetId === rightReference.localAssetId &&
        leftReference.name === rightReference.name &&
        leftReference.sourceUrl === rightReference.sourceUrl &&
        leftReference.width === rightReference.width &&
        leftReference.height === rightReference.height &&
        leftReference.canvasX === rightReference.canvasX &&
        leftReference.canvasY === rightReference.canvasY &&
        leftReference.canvasWidth === rightReference.canvasWidth &&
        leftReference.canvasHeight === rightReference.canvasHeight
      );
    })
  );
}

function getImageSourceUrl(shape: TLImageShape, asset: TLAsset | undefined): string | undefined {
  const assetSrc = asset?.type === "image" && typeof asset.props.src === "string" ? asset.props.src : undefined;
  return assetSrc || shape.props.url || undefined;
}

function getAssetMimeType(asset: TLAsset | undefined): string | undefined {
  return asset?.type === "image" && typeof asset.props.mimeType === "string" ? asset.props.mimeType : undefined;
}

function isReadableReferenceSource(sourceUrl: string, asset: TLAsset | undefined): boolean {
  const assetMimeType = getAssetMimeType(asset);
  if (assetMimeType && !isSupportedReferenceImageType(assetMimeType)) {
    return false;
  }

  if (sourceUrl.startsWith("data:")) {
    const mimeType = /^data:([^;,]+)/iu.exec(sourceUrl)?.[1];
    return Boolean(mimeType && isSupportedReferenceImageType(mimeType));
  }

  if (sourceUrl.startsWith("blob:")) {
    return true;
  }

  try {
    return new URL(sourceUrl, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

function getReferenceName(asset: TLAsset | undefined, sourceUrl: string): string {
  if (asset?.type === "image" && asset.props.name) {
    return asset.props.name;
  }

  try {
    const pathname = new URL(sourceUrl, window.location.origin).pathname;
    return pathname.split("/").filter(Boolean).at(-1) || "reference-image";
  } catch {
    return "reference-image";
  }
}

function getLocalAssetId(asset: TLAsset | undefined, sourceUrl?: string): string | undefined {
  const localAssetId = asset?.meta && typeof asset.meta.localAssetId === "string" ? asset.meta.localAssetId : undefined;
  if (localAssetId) {
    return localAssetId;
  }

  if (!sourceUrl) {
    return undefined;
  }

  try {
    const url = new URL(sourceUrl, window.location.origin);
    if (url.origin === window.location.origin) {
      const match = /^\/api\/assets\/([^/?#]+)(?:\/(?:download|preview))?$/u.exec(url.pathname);
      return match?.[1];
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function getCanvasImageAssetIds(editor: Editor): Set<string> {
  const assetIds = new Set<string>();
  for (const record of editor.store.allRecords()) {
    if (!isRecord(record) || record.typeName !== "shape" || record.type !== "image") {
      continue;
    }

    const imageShape = record as TLImageShape;
    const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined;
    const localAssetId = getLocalAssetId(asset, getImageSourceUrl(imageShape, asset));
    if (localAssetId) {
      assetIds.add(localAssetId);
    }
  }

  return assetIds;
}

function resolveCanvasAssetUrl(asset: TLAsset, context: TLAssetContext): string | null {
  if (asset.type !== "image") {
    return "src" in asset.props && typeof asset.props.src === "string" ? asset.props.src : null;
  }

  const sourceUrl = asset.props.src;
  if (!sourceUrl || context.shouldResolveToOriginal) {
    return sourceUrl || null;
  }

  const localAssetId = getLocalAssetId(asset, sourceUrl);
  if (!localAssetId) {
    return sourceUrl;
  }

  const previewWidth = Math.max(
    previewWidthForAssetContext(asset, context),
    initialCanvasPreviewWidths.get(localAssetId) ?? ASSET_PREVIEW_WIDTHS[0]
  );
  return assetPreviewUrl(localAssetId, previewWidth);
}

function previewWidthForAssetContext(asset: Extract<TLAsset, { type: "image" }>, context: TLAssetContext): AssetPreviewWidth {
  const dpr = Number.isFinite(context.dpr) && context.dpr > 0 ? context.dpr : window.devicePixelRatio || 1;
  const requestedWidth = Math.max(1, Math.ceil(asset.props.w * context.screenScale * dpr));
  return ASSET_PREVIEW_WIDTHS.find((widthValue) => widthValue >= requestedWidth) ?? ASSET_PREVIEW_WIDTHS[ASSET_PREVIEW_WIDTHS.length - 1];
}

interface CanvasResolutionBadgeTarget {
  localAssetId?: string;
  fallbackSize: ImageSize;
  badgeScale: number;
  screenX: number;
  screenY: number;
}

interface CanvasImageOpenTarget {
  url: string;
  screenX: number;
  screenY: number;
}

interface ClientPoint {
  x: number;
  y: number;
}

function CanvasResolutionBadgeOverlay() {
  const editor = useEditor();
  const pointerClientPoint = usePointerClientPoint(editor);
  const target = useValue("canvas resolution badge target", () => getCanvasResolutionBadgeTarget(editor, pointerClientPoint), [
    editor,
    pointerClientPoint?.x,
    pointerClientPoint?.y
  ]);
  const [loadedMetadata, setLoadedMetadata] = useState<{ assetId: string; size: ImageSize } | undefined>();

  const localAssetId = target?.localAssetId;
  const cachedMetadata = localAssetId ? assetMetadataCache.get(localAssetId) : undefined;
  const loadedSize = loadedMetadata && loadedMetadata.assetId === localAssetId ? loadedMetadata.size : undefined;
  const resolvedSize = localAssetId ? (cachedMetadata ?? loadedSize) : target?.fallbackSize;

  useEffect(() => {
    if (!localAssetId || assetMetadataCache.has(localAssetId)) {
      return;
    }

    let isActive = true;
    void fetchAssetMetadata(localAssetId).then((size) => {
      if (isActive && size) {
        setLoadedMetadata({ assetId: localAssetId, size });
      }
    });

    return () => {
      isActive = false;
    };
  }, [localAssetId]);

  if (!target || !resolvedSize) {
    return null;
  }

  const tier: ResolutionTier = resolutionTierForSize(resolvedSize);

  return (
    <span
      aria-hidden="true"
      className="canvas-resolution-badge"
      data-resolution-tier={tier}
      data-testid="canvas-resolution-badge"
      style={{
        transform: `translate3d(${Math.round(target.screenX + resolutionBadgeOffset(target.badgeScale))}px, ${Math.round(
          target.screenY + resolutionBadgeOffset(target.badgeScale)
        )}px, 0) scale(${target.badgeScale})`
      }}
    >
      {tier}
    </span>
  );
}

function CanvasSnapIndicator({ className, ...props }: TLSnapIndicatorProps) {
  const snapIndicatorClassName = className ? `canvas-snap-indicator ${className}` : "canvas-snap-indicator";
  return <DefaultSnapIndicator {...props} className={snapIndicatorClassName} />;
}

function CanvasImageOpenOverlay() {
  const editor = useEditor();
  const { t } = useI18n();
  const target = useValue("selected canvas image open target", () => getSelectedImageOpenTarget(editor), [editor]);

  if (!target) {
    return null;
  }

  return (
    <button
      aria-label={t("canvasOpenOriginalImage")}
      className="canvas-image-open-button"
      data-testid="canvas-image-open-button"
      style={{
        transform: `translate3d(${Math.round(target.screenX)}px, ${Math.round(target.screenY)}px, 0)`
      }}
      title={t("canvasOpenOriginalImage")}
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        window.open(target.url, "_blank", "noopener,noreferrer");
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <ExternalLink className="size-4" aria-hidden="true" />
    </button>
  );
}

function usePointerClientPoint(editor: Editor): ClientPoint | undefined {
  const [point, setPoint] = useState<ClientPoint | undefined>();
  const frameRef = useRef<number | undefined>();
  const latestPointRef = useRef<ClientPoint | undefined>();

  useEffect(() => {
    const ownerWindow = editor.getContainer().ownerDocument.defaultView ?? window;

    const updatePoint = (nextPoint: ClientPoint | undefined) => {
      latestPointRef.current = nextPoint;
      if (frameRef.current !== undefined) {
        return;
      }

      frameRef.current = ownerWindow.requestAnimationFrame(() => {
        frameRef.current = undefined;
        setPoint(latestPointRef.current);
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      updatePoint({
        x: event.clientX,
        y: event.clientY
      });
    };
    const handlePointerLeave = () => updatePoint(undefined);

    ownerWindow.addEventListener("pointermove", handlePointerMove, { passive: true });
    ownerWindow.addEventListener("pointerleave", handlePointerLeave);
    ownerWindow.addEventListener("blur", handlePointerLeave);

    return () => {
      ownerWindow.removeEventListener("pointermove", handlePointerMove);
      ownerWindow.removeEventListener("pointerleave", handlePointerLeave);
      ownerWindow.removeEventListener("blur", handlePointerLeave);
      if (frameRef.current !== undefined) {
        ownerWindow.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [editor]);

  return point;
}

function getCanvasResolutionBadgeTarget(editor: Editor, pointerClientPoint: ClientPoint | undefined): CanvasResolutionBadgeTarget | undefined {
  const imageShape = getImageShapeUnderPointer(editor, pointerClientPoint);
  if (!imageShape) {
    return undefined;
  }

  const bounds = editor.getShapePageBounds(imageShape);
  if (!bounds) {
    return undefined;
  }

  const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined;
  const sourceUrl = getImageSourceUrl(imageShape, asset);
  const localAssetId = getLocalAssetId(asset, sourceUrl);
  const topLeft = editor.pageToScreen({ x: bounds.x, y: bounds.y });
  const bottomRight = editor.pageToScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h });
  const containerRect = editor.getContainer().getBoundingClientRect();
  const screenWidth = Math.abs(bottomRight.x - topLeft.x);
  const screenHeight = Math.abs(bottomRight.y - topLeft.y);

  return {
    localAssetId,
    fallbackSize: fallbackImageSize(imageShape, asset),
    badgeScale: resolutionBadgeScale(screenWidth, screenHeight, containerRect.width),
    screenX: topLeft.x - containerRect.left,
    screenY: topLeft.y - containerRect.top
  };
}

function getSelectedImageOpenTarget(editor: Editor): CanvasImageOpenTarget | undefined {
  const selectedShapes = editor.getSelectedShapes();
  if (selectedShapes.length !== 1 || selectedShapes[0]?.type !== "image") {
    return undefined;
  }

  const imageShape = selectedShapes[0] as TLImageShape;
  const bounds = editor.getShapePageBounds(imageShape);
  if (!bounds) {
    return undefined;
  }

  const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined;
  const sourceUrl = getImageSourceUrl(imageShape, asset);
  const localAssetId = getLocalAssetId(asset, sourceUrl);
  const url = localAssetId
    ? assetInlineUrl(localAssetId)
    : typeof imageShape.props.url === "string" && imageShape.props.url.trim()
      ? imageShape.props.url
      : sourceUrl;
  if (!url) {
    return undefined;
  }

  const topRight = editor.pageToScreen({ x: bounds.x + bounds.w, y: bounds.y });
  const containerRect = editor.getContainer().getBoundingClientRect();

  return {
    url,
    screenX: topRight.x - containerRect.left + 8,
    screenY: topRight.y - containerRect.top - 8
  };
}

function resolutionBadgeScale(screenWidth: number, screenHeight: number, canvasWidth: number): number {
  const imageShortSide = Math.max(0, Math.min(screenWidth, screenHeight));
  const imageScale =
    imageShortSide >= RESOLUTION_BADGE_FULL_SIZE_IMAGE_SIDE
      ? 1
      : RESOLUTION_BADGE_MIN_SCALE +
        ((Math.max(imageShortSide, RESOLUTION_BADGE_SMALL_IMAGE_SIDE) - RESOLUTION_BADGE_SMALL_IMAGE_SIDE) /
          (RESOLUTION_BADGE_FULL_SIZE_IMAGE_SIDE - RESOLUTION_BADGE_SMALL_IMAGE_SIDE)) *
          (1 - RESOLUTION_BADGE_MIN_SCALE);
  const canvasScale = canvasWidth < 520 ? 0.78 : canvasWidth < 760 ? 0.88 : 1;

  return Math.max(RESOLUTION_BADGE_MIN_SCALE, Math.min(1, imageScale, canvasScale));
}

function resolutionBadgeOffset(scale: number): number {
  return Math.max(4, RESOLUTION_BADGE_BASE_OFFSET * scale);
}

function getImageShapeUnderPointer(editor: Editor, pointerClientPoint: ClientPoint | undefined): TLImageShape | undefined {
  if (!pointerClientPoint || !isPointerOverCanvas(editor, pointerClientPoint)) {
    return undefined;
  }

  const shapeAtPoint = editor.getShapeAtPoint(editor.screenToPage(pointerClientPoint), {
    hitInside: true,
    renderingOnly: true,
    filter: (shape) => shape.type === "image"
  });

  return shapeAtPoint?.type === "image" ? (shapeAtPoint as TLImageShape) : undefined;
}

function isPointerOverCanvas(editor: Editor, pointerClientPoint: ClientPoint): boolean {
  const target = editor.getContainer().ownerDocument.elementFromPoint(pointerClientPoint.x, pointerClientPoint.y);
  return Boolean(target?.closest(".tl-canvas"));
}

function fallbackImageSize(imageShape: TLImageShape, asset: TLAsset | undefined): ImageSize {
  if (asset?.type === "image" && isUsableImageSize(asset.props)) {
    return {
      width: asset.props.w,
      height: asset.props.h
    };
  }

  return {
    width: imageShape.props.w,
    height: imageShape.props.h
  };
}

function isUsableImageSize(size: { width?: unknown; height?: unknown; w?: unknown; h?: unknown }): boolean {
  const width = typeof size.width === "number" ? size.width : size.w;
  const height = typeof size.height === "number" ? size.height : size.h;
  return typeof width === "number" && typeof height === "number" && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

function rememberAssetMetadata(assetId: string, size: ImageSize): void {
  if (isUsableImageSize(size)) {
    assetMetadataCache.set(assetId, size);
  }
}

async function fetchAssetMetadata(assetId: string): Promise<ImageSize | undefined> {
  const cached = assetMetadataCache.get(assetId);
  if (cached) {
    return cached;
  }

  const existingRequest = assetMetadataRequests.get(assetId);
  if (existingRequest) {
    return existingRequest;
  }

  const request = fetch(`/api/assets/${encodeURIComponent(assetId)}/metadata`)
    .then(async (response) => {
      if (!response.ok) {
        return undefined;
      }

      const body = (await response.json()) as AssetMetadataResponse;
      const size = {
        width: body.width,
        height: body.height
      };

      if (body.id !== assetId || !isUsableImageSize(size)) {
        return undefined;
      }

      rememberAssetMetadata(assetId, size);
      return size;
    })
    .catch(() => undefined)
    .finally(() => {
      assetMetadataRequests.delete(assetId);
    });

  assetMetadataRequests.set(assetId, request);
  return request;
}

function findCanvasImageShape(editor: Editor, record: GenerationRecord): TLShapeId | undefined {
  const assetIds = new Set(
    record.outputs.flatMap((output) => (output.status === "succeeded" && output.asset ? [output.asset.id] : []))
  );
  if (assetIds.size === 0) {
    return undefined;
  }

  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== "image") {
      continue;
    }

    const imageShape = shape as TLImageShape;
    const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined;
    const sourceUrl = getImageSourceUrl(imageShape, asset);
    const localAssetId = getLocalAssetId(asset, sourceUrl);

    if (localAssetId && assetIds.has(localAssetId)) {
      return imageShape.id;
    }
  }

  return undefined;
}

function findCanvasImageShapeByAssetId(editor: Editor, assetId: string, shapeId?: TLShapeId): TLShapeId | undefined {
  if (shapeId && editor.getShape(shapeId)?.type === "image") {
    return shapeId;
  }

  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== "image") {
      continue;
    }

    const imageShape = shape as TLImageShape;
    const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined;
    const sourceUrl = getImageSourceUrl(imageShape, asset);
    const localAssetId = getLocalAssetId(asset, sourceUrl);
    if (localAssetId === assetId || imageShape.props.assetId === assetId || asset?.id === assetId) {
      return imageShape.id;
    }
  }

  return undefined;
}

function fileNameWithImageExtension(name: string, mimeType: string): string {
  if (/\.(png|jpe?g|webp|gif)$/iu.test(name)) {
    return name;
  }

  const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return `${name}.${extension}`;
}

function isSupportedReferenceImageType(mimeType: string): boolean {
  return SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType.toLowerCase());
}

async function blobToDataUrl(blob: Blob, t?: Translate): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t ? t("readReferenceDataFailed") : "Unable to read reference image data."));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error(t ? t("readReferenceDataFailed") : "Unable to read reference image data."));
    };
    reader.readAsDataURL(blob);
  });
}

async function readReferenceImage(selection: ReferenceSelectionItem, signal: AbortSignal, t: Translate): Promise<{
  dataUrl: string;
  fileName: string;
  mimeType: string;
}> {
  let response: Response;

  try {
    response = await fetch(selection.sourceUrl, { signal });
  } catch {
    throw new Error(t("readReferenceFailed"));
  }

  if (!response.ok) {
    throw new Error(t("readReferenceMissingFile"));
  }

  const blob = await response.blob();
  if (!isSupportedReferenceImageType(blob.type)) {
    throw new Error(t("referenceInvalidType"));
  }
  if (blob.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(t("referenceFileTooLarge"));
  }

  return {
    dataUrl: await blobToDataUrl(blob, t),
    fileName: fileNameWithImageExtension(selection.name, blob.type),
    mimeType: blob.type
  };
}

async function readStoredReferenceImage(assetId: string, signal: AbortSignal, t: Translate): Promise<ReferenceImageInput> {
  const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}`, { signal });
  if (!response.ok) {
    throw new Error(t("readStoredReferenceFailed"));
  }

  const blob = await response.blob();
  if (!isSupportedReferenceImageType(blob.type)) {
    throw new Error(t("referenceHistoryInvalidType"));
  }
  if (blob.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(t("referenceHistoryFileTooLarge"));
  }

  return {
    dataUrl: await blobToDataUrl(blob, t),
    fileName: fileNameWithImageExtension(assetId, blob.type)
  };
}

function agentWebSocketUrl(connectionId?: string | null, runId?: string | null, conversationId?: string | null): string {
  const url = new URL("/api/agent/ws", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (connectionId) {
    url.searchParams.set("connectionId", connectionId);
  }
  if (runId) {
    url.searchParams.set("runId", runId);
  }
  if (conversationId) {
    url.searchParams.set("conversationId", conversationId);
  }
  return url.toString();
}

function agentReferenceAssetId(reference: ReferenceSelectionItem, index: number): string {
  return reference.localAssetId ?? reference.assetId ?? `selected-canvas-image-${index + 1}`;
}

function agentReferenceLabel(reference: ReferenceSelectionItem, index: number, t: Translate): string {
  const name = reference.name.trim();
  if (name && name !== "reference-image") {
    return name;
  }

  return t("agentReferenceFallbackLabel", { index: index + 1 });
}

async function buildAgentSelectedReferences(input: {
  references: ReferenceSelectionItem[];
  t: Translate;
}): Promise<AgentSelectedCanvasReference[]> {
  const controller = new AbortController();
  return Promise.all(
    input.references.slice(0, MAX_AGENT_SELECTED_REFERENCES).map(async (reference, index) => {
      const readableReference = await readReferenceImage(reference, controller.signal, input.t);
      const selectedReference: AgentSelectedCanvasReference = {
        id: `selected-${index + 1}`,
        assetId: agentReferenceAssetId(reference, index),
        label: agentReferenceLabel(reference, index, input.t),
        width: Math.round(reference.width),
        height: Math.round(reference.height),
        mimeType: readableReference.mimeType,
        dataUrl: readableReference.dataUrl
      };

      return selectedReference;
    })
  );
}

function parseAgentServerEvent(data: MessageEvent["data"]): AgentServerEvent | undefined {
  if (typeof data !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(data) as unknown;
    return isRecord(parsed) && typeof parsed.type === "string" ? (parsed as unknown as AgentServerEvent) : undefined;
  } catch {
    return undefined;
  }
}

function agentTracePhaseForServerEvent(event: AgentServerEvent): AgentTraceEntry["phase"] {
  switch (event.type) {
    case "assistant_delta":
    case "assistant_thinking_delta":
      return "stream";
    case "tool_call":
      return "tool_call";
    case "plan_created":
    case "plan_updated":
      return "planning";
    case "job_started":
    case "job_completed":
    case "job_failed":
    case "job_blocked":
    case "asset_preview":
    case "run_done":
    case "run_cancelled":
      return "execution";
    case "error":
      return "error";
    case "connected":
    case "pong":
      return "connection";
    case "context_resolved":
    default:
      return "system";
  }
}

function agentTracePhaseForClientMessage(message: Record<string, unknown>): AgentTraceEntry["phase"] {
  switch (message.type) {
    case "user_message":
    case "revise_plan":
      return "planning";
    case "execute_plan":
    case "retry_failed":
    case "cancel_run":
      return "execution";
    case "ping":
      return "connection";
    default:
      return "system";
  }
}

function agentServerTraceLabel(event: AgentServerEvent): string {
  if (event.type === "tool_call") {
    return `${event.toolName} ${event.phase}`;
  }

  if ("jobId" in event && typeof event.jobId === "string") {
    return `${event.type} ${event.jobId}`;
  }

  return event.type;
}

function agentServerTraceSummary(event: AgentServerEvent): string | undefined {
  switch (event.type) {
    case "assistant_delta":
    case "assistant_thinking_delta":
      return `${event.delta.length} streamed characters`;
    case "tool_call":
      return event.error || (event.durationMs !== undefined ? `${event.durationMs} ms` : undefined);
    case "plan_created":
    case "plan_updated":
      return `${event.plan.title} (${event.plan.jobs.length} jobs)`;
    case "job_completed":
      return `${event.outputs?.length ?? 0} outputs`;
    case "job_failed":
      return event.error;
    case "job_blocked":
      return event.reason;
    case "asset_preview":
      return event.asset.fileName;
    case "run_done":
      return event.status;
    case "run_cancelled":
      return event.reason;
    case "error":
      return event.message;
    case "context_resolved":
      return `${event.referenceCount} references`;
    default:
      return undefined;
  }
}

function agentClientTraceLabel(message: Record<string, unknown>): string {
  return typeof message.type === "string" ? message.type : "client_message";
}

function sanitizeAgentTracePayload(input: unknown, depth = 0): unknown {
  if (input === undefined) {
    return undefined;
  }

  if (input === null || typeof input === "number" || typeof input === "boolean") {
    return input;
  }

  if (typeof input === "string") {
    return input.length > AGENT_TRACE_MAX_STRING_LENGTH ? `${input.slice(0, AGENT_TRACE_MAX_STRING_LENGTH - 1)}...` : input;
  }

  if (depth >= 8) {
    return "[truncated]";
  }

  if (Array.isArray(input)) {
    return input.slice(0, 100).map((item) => sanitizeAgentTracePayload(item, depth + 1));
  }

  if (!isRecord(input)) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input).slice(0, 100)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === "dataurl" ||
      normalizedKey === "bytes" ||
      normalizedKey.includes("apikey") ||
      normalizedKey.includes("secret") ||
      normalizedKey.includes("token") ||
      normalizedKey === "authorization"
    ) {
      sanitized[key] = "[redacted]";
      continue;
    }

    sanitized[key] = sanitizeAgentTracePayload(value, depth + 1);
  }

  return sanitized;
}

function agentServerEventPayloadForTrace(event: AgentServerEvent): unknown {
  if (event.type !== "assistant_thinking_delta") {
    return event;
  }

  return {
    ...event,
    delta: "[redacted_reasoning_delta]",
    deltaCharacters: event.delta.length
  };
}

function agentTraceEntryFromServerEvent(event: AgentServerEvent): AgentTraceEntry {
  return {
    id: `agent-trace-${crypto.randomUUID()}`,
    timestamp: event.timestamp || new Date().toISOString(),
    direction: "server",
    phase: agentTracePhaseForServerEvent(event),
    eventType: event.type,
    label: agentServerTraceLabel(event),
    requestId: event.requestId,
    runId: event.runId,
    toolName: event.type === "tool_call" ? event.toolName : undefined,
    status: event.type === "tool_call" ? event.phase : undefined,
    durationMs: event.type === "tool_call" ? event.durationMs : undefined,
    summary: agentServerTraceSummary(event),
    payload: sanitizeAgentTracePayload(agentServerEventPayloadForTrace(event))
  };
}

function agentTraceEntryFromClientMessage(message: Record<string, unknown>, label = agentClientTraceLabel(message)): AgentTraceEntry {
  return {
    id: `agent-trace-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    direction: "client",
    phase: agentTracePhaseForClientMessage(message),
    eventType: typeof message.type === "string" ? message.type : "client_message",
    label,
    requestId: typeof message.requestId === "string" ? message.requestId : undefined,
    runId: typeof message.runId === "string" ? message.runId : undefined,
    summary: typeof message.type === "string" ? `Sent ${message.type}` : undefined,
    payload: sanitizeAgentTracePayload(message)
  };
}

function isMergeableStreamTraceEntry(entry: AgentTraceEntry, nextEntry: AgentTraceEntry): boolean {
  return (
    entry.direction === "server" &&
    nextEntry.direction === "server" &&
    entry.phase === "stream" &&
    nextEntry.phase === "stream" &&
    entry.eventType === nextEntry.eventType &&
    entry.runId === nextEntry.runId
  );
}

function mergeStreamTraceEntry(entry: AgentTraceEntry, nextEntry: AgentTraceEntry): AgentTraceEntry {
  const currentPayload = isRecord(entry.payload) ? entry.payload : {};
  const nextPayload = isRecord(nextEntry.payload) ? nextEntry.payload : {};
  if (entry.eventType === "assistant_thinking_delta") {
    const currentCount =
      typeof currentPayload.accumulatedCharacters === "number"
        ? currentPayload.accumulatedCharacters
        : typeof currentPayload.deltaCharacters === "number"
          ? currentPayload.deltaCharacters
          : 0;
    const nextCount = typeof nextPayload.deltaCharacters === "number" ? nextPayload.deltaCharacters : 0;
    const characterCount = currentCount + nextCount;

    return {
      ...entry,
      timestamp: nextEntry.timestamp,
      summary: `${characterCount} streamed characters`,
      payload: {
        ...currentPayload,
        ...nextPayload,
        delta: "[redacted_reasoning_delta]",
        accumulatedCharacters: characterCount
      }
    };
  }

  const currentDelta = typeof currentPayload.delta === "string" ? currentPayload.delta : "";
  const nextDelta = typeof nextPayload.delta === "string" ? nextPayload.delta : "";
  const delta = sanitizeAgentTracePayload(`${currentDelta}${nextDelta}`);
  const characterCount = typeof delta === "string" ? delta.length : currentDelta.length + nextDelta.length;

  return {
    ...entry,
    timestamp: nextEntry.timestamp,
    summary: `${characterCount} streamed characters`,
    payload: {
      ...currentPayload,
      ...nextPayload,
      delta,
      accumulatedCharacters: characterCount
    }
  };
}

function agentTraceExport(input: {
  conversationId?: string | null;
  title?: string;
  messages: AgentConversationMessage[];
  trace: AgentTraceEntry[];
}): string {
  return JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString(),
      conversationId: input.conversationId ?? undefined,
      title: input.title,
      note: "Trace includes client messages, server events, tool calls, and safety-visible reasoning summaries. It does not expose private hidden chain-of-thought.",
      messages: agentMessagesForTraceExport(input.messages),
      trace: input.trace
    },
    null,
    2
  );
}

function agentMessagesForTraceExport(messages: AgentConversationMessage[]): AgentConversationMessage[] {
  return messages.map((message) => {
    if (message.role !== "thinking" || !message.details) {
      return message;
    }

    return {
      ...message,
      details: `Reasoning details omitted from trace export (${message.details.length} characters).`
    };
  });
}

function optionalShapeIdFromEvent(event: AgentServerEvent): TLShapeId | undefined {
  return isRecord(event) && typeof event.shapeId === "string" ? (event.shapeId as TLShapeId) : undefined;
}

function planJobDependencies(plan: GenerationPlan, job: GenerationJob): string[] {
  return plan.edges.filter((edge) => edge.toJobId === job.id).map((edge) => edge.fromJobId);
}

function planReferenceLabel(reference: GenerationReference, t: Translate): string {
  const usage = t("agentPlanReferenceUsageLabel", { usage: reference.usage });
  if (reference.kind === "generated_output") {
    return `${usage}: ${t("agentPlanReferenceGenerated", { jobId: reference.jobId ?? "?" })}`;
  }

  return `${usage}: ${t("agentPlanReferenceSelected", { label: reference.label ?? reference.assetId ?? "?" })}`;
}

function planReferenceCount(plan: GenerationPlan): number {
  return plan.jobs.reduce((count, job) => count + job.references.length, 0);
}

function AgentPlanReviewNodes({ plan, t }: { plan: GenerationPlan; t: Translate }) {
  const summary = summarizeGenerationPlanOutputs(plan);
  const nodes = [
    t("agentPlanReviewScope", { total: summary.totalImageCount, jobs: summary.jobCount }),
    t("agentPlanReviewReferences", { count: planReferenceCount(plan) }),
    t("agentPlanReviewDependencies", { count: plan.edges.length }),
    t("agentPlanReviewConfirm")
  ];

  return (
    <section className="agent-plan-card__review" aria-label={t("agentPlanReviewTitle")}>
      <span className="agent-plan-card__section-title">{t("agentPlanReviewTitle")}</span>
      <div className="agent-plan-card__review-nodes">
        {nodes.map((node, index) => (
          <span className="agent-plan-card__review-node" data-step={index + 1} key={`${index}-${node}`}>
            {node}
          </span>
        ))}
      </div>
    </section>
  );
}

function AgentPlanJobDetails({ plan, t }: { plan: GenerationPlan; t: Translate }) {
  return (
    <section className="agent-plan-card__details" aria-label={t("agentPlanDetailsTitle")}>
      <span className="agent-plan-card__section-title">{t("agentPlanDetailsTitle")}</span>
      <div className="agent-plan-card__job-list">
        {plan.jobs.map((job) => {
          const dependencies = planJobDependencies(plan, job);
          const references = job.references.map((reference) => planReferenceLabel(reference, t));
          return (
            <article className="agent-plan-card__job" data-status={job.status} key={job.id}>
              <span className="agent-plan-card__job-title">
                {t("agentPlanJobLine", {
                  id: job.id,
                  role: t("agentPlanRoleLabel", { role: job.role }),
                  count: job.count,
                  status: t("agentPlanJobStatusLabel", { status: job.status })
                })}
              </span>
              <p>
                <strong>{t("agentPlanJobPrompt")}</strong>
                {job.prompt}
              </p>
              {dependencies.length > 0 ? <span>{t("agentPlanJobDependsOn", { ids: dependencies.join(", ") })}</span> : null}
              <span>
                {references.length > 0
                  ? t("agentPlanJobReferences", { references: references.join(", ") })
                  : t("agentPlanJobNoReferences")}
              </span>
              {job.error ? <span>{job.error}</span> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AgentPlanCard({
  isAgentConfigured,
  isAgentRunning,
  onAction,
  plan,
  readOnly = false,
  t
}: {
  isAgentConfigured: boolean;
  isAgentRunning: boolean;
  onAction: (plan: GenerationPlan, action: AgentPlanAction) => void;
  plan: unknown;
  readOnly?: boolean;
  t: Translate;
}) {
  if (!isGenerationPlan(plan)) {
    return (
      <div className="agent-plan-card agent-plan-card--invalid" data-state="invalid" data-testid="agent-plan-card" role="status">
        <strong>{t("agentPlanUnreadableTitle")}</strong>
        <span>{t("agentPlanUnreadableCard")}</span>
      </div>
    );
  }

  const summary = summarizeGenerationPlanOutputs(plan);
  const canExecute = (plan.status === "awaiting_confirmation" || plan.status === "confirmed") && isAgentConfigured && !isAgentRunning;
  const showConfirmationHint = plan.status === "awaiting_confirmation" || plan.status === "confirmed";
  const showRetry = hasFailedPlanJob(plan);
  const canRetry = showRetry && isAgentConfigured && !isAgentRunning;
  const showCancel = plan.status === "running";
  const canCancel = showCancel && isAgentRunning;

  return (
    <article
      className="agent-plan-card"
      data-testid="agent-plan-card"
    >
      <span className="agent-plan-card__heading">
        <strong>{plan.title}</strong>
        <span className="agent-plan-card__status">{t("agentPlanStatus", { status: plan.status })}</span>
      </span>
      <span className="agent-plan-card__summary">
        {t("agentPlanSummary", {
          finalOutputs: summary.finalImageCount,
          jobs: summary.jobCount,
          supportOutputs: summary.supportImageCount
        })}
      </span>
      {showConfirmationHint ? <span className="agent-plan-card__hint">{t("agentPlanConfirmationHint")}</span> : null}
      <AgentPlanReviewNodes plan={plan} t={t} />
      <AgentPlanJobDetails plan={plan} t={t} />
      {readOnly ? null : <div className="agent-plan-card__actions">
        <button
          className="agent-plan-card__action agent-plan-card__action--primary"
          disabled={!canExecute}
          type="button"
          onClick={() => onAction(plan, "execute")}
        >
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
          {t("agentPlanExecute")}
        </button>
        {showRetry ? (
          <button
            className="agent-plan-card__action"
            disabled={!canRetry}
            type="button"
            onClick={() => onAction(plan, "retry_failed")}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {t("agentPlanRetryFailed")}
          </button>
        ) : null}
        {showCancel ? (
          <button
            className="agent-plan-card__action"
            disabled={!canCancel}
            type="button"
            onClick={() => onAction(plan, "cancel")}
          >
            <CircleStop className="size-3.5" aria-hidden="true" />
            {t("agentPlanCancel")}
          </button>
        ) : null}
      </div>}
    </article>
  );
}

function AgentHistoryDialog({
  conversation,
  error,
  formatDateTime,
  isDetailLoading,
  isLoading,
  isRestoringDisabled,
  onClose,
  onCopyTrace,
  onRestore,
  onSelectConversation,
  selectedConversationId,
  summaries,
  t
}: {
  conversation: AgentConversation | null;
  error: string;
  formatDateTime: (value: string, options?: Intl.DateTimeFormatOptions) => string;
  isDetailLoading: boolean;
  isLoading: boolean;
  isRestoringDisabled: boolean;
  onClose: () => void;
  onCopyTrace: (conversation: AgentConversation) => void;
  onRestore: (conversation: AgentConversation) => void;
  onSelectConversation: (conversationId: string) => void;
  selectedConversationId: string | null;
  summaries: AgentConversationSummary[];
  t: Translate;
}) {
  return (
    <div className="agent-history-backdrop app-modal-backdrop" data-testid="agent-history-dialog" role="presentation" onClick={onClose}>
      <section
        aria-labelledby="agent-history-title"
        aria-modal="true"
        className="agent-history-dialog app-modal-surface"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="agent-history-dialog__header">
          <div className="agent-history-dialog__title">
            <span className="agent-history-dialog__mark" aria-hidden="true">
              <History className="size-4" />
            </span>
            <div>
              <h2 id="agent-history-title">{t("agentHistoryTitle")}</h2>
              <p>{t("agentHistorySubtitle")}</p>
            </div>
          </div>
          <button aria-label={t("commonClose")} className="history-icon-action" type="button" onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        {error ? (
          <p className="agent-history-dialog__alert" role="alert">
            {error}
          </p>
        ) : null}

        <div className="agent-history-dialog__body">
          <aside className="agent-history-list" aria-label={t("agentHistoryListLabel")}>
            {isLoading ? (
              <div className="agent-history-empty" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>{t("agentHistoryLoading")}</span>
              </div>
            ) : summaries.length === 0 ? (
              <div className="agent-history-empty">
                <MessageCirclePlus className="size-5" aria-hidden="true" />
                <strong>{t("agentHistoryEmptyTitle")}</strong>
                <span>{t("agentHistoryEmptyCopy")}</span>
              </div>
            ) : (
              summaries.map((summary) => (
                <button
                  aria-pressed={summary.id === selectedConversationId}
                  className="agent-history-list__item"
                  data-selected={summary.id === selectedConversationId}
                  key={summary.id}
                  type="button"
                  onClick={() => onSelectConversation(summary.id)}
                >
                  <span className="agent-history-list__item-title">{summary.title}</span>
                  <span className="agent-history-list__item-preview">{summary.lastMessagePreview ?? t("agentHistoryNoPreview")}</span>
                  <span className="agent-history-list__item-meta">
                    {t("agentHistoryMessageCount", { count: summary.messageCount })}
                    <time dateTime={summary.updatedAt}>{formatDateTime(summary.updatedAt, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
                  </span>
                </button>
              ))
            )}
          </aside>

          <section className="agent-history-detail" aria-label={t("agentHistoryDetailLabel")}>
            {isDetailLoading ? (
              <div className="agent-history-empty" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>{t("agentHistoryDetailLoading")}</span>
              </div>
            ) : conversation ? (
              <>
                <div className="agent-history-detail__head">
                  <div>
                    <h3>{conversation.title}</h3>
                    <p>
                      <time dateTime={conversation.updatedAt}>
                        {formatDateTime(conversation.updatedAt, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </time>
                      <span>{t("agentHistoryMessageCount", { count: conversation.messages.length })}</span>
                    </p>
                  </div>
                  <div className="agent-history-detail__actions">
                    {AGENT_TRACE_DEBUG_ENABLED ? (
                      <button
                        className="agent-history-trace"
                        disabled={(conversation.trace?.length ?? 0) === 0}
                        type="button"
                        onClick={() => onCopyTrace(conversation)}
                      >
                        <FileText className="size-4" aria-hidden="true" />
                        {t("agentTraceCopy")}
                      </button>
                    ) : null}
                    <button
                      className="agent-history-restore"
                      disabled={isRestoringDisabled}
                      type="button"
                      onClick={() => onRestore(conversation)}
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                      {t("agentHistoryRestore")}
                    </button>
                  </div>
                </div>
                <div className="agent-history-transcript">
                  {conversation.messages.map((message) => (
                    <AgentHistoryMessage
                      formatDateTime={formatDateTime}
                      key={message.id}
                      message={message}
                      t={t}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="agent-history-empty">
                <History className="size-5" aria-hidden="true" />
                <strong>{t("agentHistorySelectTitle")}</strong>
                <span>{t("agentHistorySelectCopy")}</span>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function AgentHistoryMessage({
  formatDateTime,
  message,
  t
}: {
  formatDateTime: (value: string, options?: Intl.DateTimeFormatOptions) => string;
  message: AgentConversationMessage;
  t: Translate;
}) {
  const previewCount = message.previews?.length ?? 0;

  return (
    <article className={`agent-message agent-message--${message.role}`} data-message-role={message.role}>
      <div className={message.role === "system" || message.role === "error" ? "agent-status-line__meta" : "agent-message__meta"}>
        <span>{t("agentMessageRole", { role: message.role })}</span>
        <time dateTime={message.timestamp}>{formatDateTime(message.timestamp, { hour: "2-digit", minute: "2-digit" })}</time>
      </div>
      <p className="agent-message__content">{message.content}</p>
      {AGENT_TRACE_DEBUG_ENABLED && message.role === "thinking" && message.details ? (
        <details className="agent-thinking-details">
          <summary className="agent-thinking-details__toggle">{t("agentHistoryThinkingDetails")}</summary>
          <pre className="agent-thinking-details__content">{message.details}</pre>
        </details>
      ) : null}
      {message.plan ? (
        <AgentPlanCard
          isAgentConfigured={false}
          isAgentRunning={false}
          plan={message.plan}
          readOnly
          t={t}
          onAction={() => undefined}
        />
      ) : null}
      {previewCount > 0 && message.previews ? (
        <div className="agent-preview-list">
          {message.previews.map((preview) => (
            <figure className="agent-history-preview" key={preview.id}>
              <img alt="" src={preview.url} />
              <figcaption>{preview.jobId}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function AgentTracePanel({
  copied,
  entries,
  formatDateTime,
  onCopy,
  t
}: {
  copied: boolean;
  entries: AgentTraceEntry[];
  formatDateTime: (value: string, options?: Intl.DateTimeFormatOptions) => string;
  onCopy: () => void;
  t: Translate;
}) {
  const visibleEntries = entries.slice(-AGENT_TRACE_VISIBLE_LIMIT);

  return (
    <section className="agent-trace-panel" aria-label={t("agentTraceTitle")} data-testid="agent-trace-panel">
      <header className="agent-trace-panel__header">
        <div>
          <strong>{t("agentTraceTitle")}</strong>
          <span>{t("agentTraceSubtitle", { count: entries.length })}</span>
        </div>
        <button className="agent-trace-copy" data-copied={copied} type="button" onClick={onCopy}>
          {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
          {copied ? t("agentTraceCopied") : t("agentTraceCopy")}
        </button>
      </header>
      <p className="agent-trace-panel__note">{t("agentTracePrivacyNote")}</p>
      <div className="agent-trace-list">
        {visibleEntries.length > 0 ? (
          visibleEntries.map((entry) => (
            <article className="agent-trace-entry" data-direction={entry.direction} data-phase={entry.phase} key={entry.id}>
              <div className="agent-trace-entry__topline">
                <span>{entry.direction}</span>
                <strong>{entry.label}</strong>
                <time dateTime={entry.timestamp}>{formatDateTime(entry.timestamp, { hour: "2-digit", minute: "2-digit" })}</time>
              </div>
              <div className="agent-trace-entry__chips">
                <span>{entry.phase}</span>
                {entry.toolName ? <span>{entry.toolName}</span> : null}
                {entry.status ? <span>{entry.status}</span> : null}
                {entry.durationMs !== undefined ? <span>{entry.durationMs} ms</span> : null}
              </div>
              {entry.summary ? <p>{entry.summary}</p> : null}
            </article>
          ))
        ) : (
          <p className="agent-trace-empty">{t("agentTraceEmpty")}</p>
        )}
      </div>
    </section>
  );
}

async function readErrorMessage(response: Response, locale: Locale, t: Translate): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return localizedApiErrorMessage({
      code: body.error?.code,
      fallbackMessage: body.error?.message,
      fallbackText: t("errorFallback", { status: response.status }),
      locale,
      status: response.status
    });
  } catch {
    return t("errorFallback", { status: response.status });
  }
}

function storageConfigToForm(config: StorageConfigResponse | null): StorageConfigFormState {
  if (!config) {
    return cloneDefaultStorageConfigForm();
  }

  return {
    enabled: config.enabled,
    provider: config.provider,
    cos: {
      secretId: config.cos.secretId,
      secretKey: config.cos.secretKey.value ?? "",
      bucket: config.cos.bucket,
      region: config.cos.region,
      keyPrefix: config.cos.keyPrefix
    },
    s3: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey.value ?? "",
      bucket: config.s3.bucket,
      region: config.s3.region,
      keyPrefix: config.s3.keyPrefix,
      endpointMode: config.s3.endpointMode,
      accountId: config.s3.accountId,
      endpoint: config.s3.endpoint,
      forcePathStyle: config.s3.forcePathStyle
    }
  };
}

function storageConfigRequestBody(
  form: StorageConfigFormState,
  options: { preserveSecret: boolean; forceEnabled?: boolean }
): SaveStorageConfigRequest {
  const enabled = options.forceEnabled ?? form.enabled;
  if (form.provider === "s3") {
    return {
      enabled,
      provider: "s3",
      s3: {
        accessKeyId: form.s3.accessKeyId.trim(),
        secretAccessKey: options.preserveSecret ? undefined : form.s3.secretAccessKey,
        preserveSecret: options.preserveSecret,
        bucket: form.s3.bucket.trim(),
        region: form.s3.region.trim(),
        keyPrefix: form.s3.keyPrefix.trim(),
        endpointMode: form.s3.endpointMode,
        accountId: form.s3.accountId.trim(),
        endpoint: form.s3.endpoint.trim(),
        forcePathStyle: form.s3.forcePathStyle
      }
    };
  }

  return {
    enabled,
    provider: "cos",
    cos: {
      secretId: form.cos.secretId.trim(),
      secretKey: options.preserveSecret ? undefined : form.cos.secretKey,
      preserveSecret: options.preserveSecret,
      bucket: form.cos.bucket.trim(),
      region: form.cos.region.trim(),
      keyPrefix: form.cos.keyPrefix.trim()
    }
  };
}

function cloneDefaultStorageConfigForm(): StorageConfigFormState {
  return {
    ...defaultStorageConfigForm,
    cos: { ...defaultStorageConfigForm.cos },
    s3: { ...defaultStorageConfigForm.s3 }
  };
}

function shouldPreserveStorageSecret(
  form: StorageConfigFormState,
  config: StorageConfigResponse | null,
  touched: StorageSecretTouchedState
): boolean {
  return form.provider === "s3"
    ? !touched.s3 && Boolean(config?.s3.secretAccessKey.hasSecret)
    : !touched.cos && Boolean(config?.cos.secretKey.hasSecret);
}

function requestGenerationNotificationPermission(): void {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "default") {
    return;
  }

  void Notification.requestPermission().catch(() => undefined);
}

function showGenerationCompleteNotification(record: GenerationRecord, insertedCount: number, failedCount: number, t: Translate): void {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const isPartial = record.status === "partial" || failedCount > 0;
  const body = isPartial ? t("generationInsertedPartialBody", { inserted: insertedCount, failed: failedCount }) : t("generationImageInserted", { count: insertedCount });

  new Notification(isPartial ? t("generationNotificationPartialTitle") : t("generationNotificationTitle"), {
    body,
    icon: "/favicon.png",
    tag: `generation-${record.id}`
  });
}

function saveStatusLabel(status: SaveStatus, t: Translate): string {
  switch (status) {
    case "loading":
      return t("saveStatusLoading");
    case "pending":
      return t("saveStatusPending");
    case "saving":
      return t("saveStatusSaving");
    case "error":
      return t("saveStatusError");
    case "saved":
    default:
      return t("saveStatusSaved");
  }
}

function SaveStatusIcon({ status }: { status: SaveStatus }) {
  if (status === "saving" || status === "loading") {
    return <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />;
  }

  if (status === "error") {
    return <AlertTriangle className="size-3.5" aria-hidden="true" />;
  }

  if (status === "saved") {
    return <CheckCircle2 className="size-3.5" aria-hidden="true" />;
  }

  return <Cloud className="size-3.5" aria-hidden="true" />;
}

function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-mark ${className}`} aria-hidden="true">
      <img className="brand-mark__image" src="/brand-logo.png" alt="" draggable={false} />
    </span>
  );
}

function BrandName() {
  return (
    <p className="brand-name" title="gpt-image-canvas">
      <span className="brand-name__prefix">gpt</span>
      <span className="brand-name__dash">-</span>
      <span className="brand-name__image">image</span>
      <span className="brand-name__dash">-</span>
      <span className="brand-name__canvas">canvas</span>
    </p>
  );
}

function TopNavigation({
  onOpenProviderConfig,
  route,
  onNavigate,
  onPreloadGallery,
  onPreloadPool
}: {
  onOpenProviderConfig: () => void;
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  onPreloadGallery: () => void;
  onPreloadPool: () => void;
}) {
  const { t } = useI18n();

  return (
    <header className="top-navigation">
      <div className="top-navigation__inner">
        <div className="brand-lockup min-w-0">
          <BrandMark />
          <div className="min-w-0">
            <BrandName />
            <p className="brand-tagline">{t("appTagline")}</p>
          </div>
        </div>
        <div className="top-navigation__actions">
          <nav aria-label={t("navMainAria")} className="top-navigation__links">
            <a
              aria-current={route === "home" ? "page" : undefined}
              className="top-navigation__link"
              data-active={route === "home"}
              data-testid="nav-home"
              href="/"
              onClick={(event) => {
                event.preventDefault();
                onNavigate("home");
              }}
            >
              <Sparkles className="size-4" aria-hidden="true" />
              {t("navHome")}
            </a>
            <a
              aria-current={route === "canvas" ? "page" : undefined}
              className="top-navigation__link"
              data-active={route === "canvas"}
              data-testid="nav-canvas"
              href="/canvas"
              onClick={(event) => {
                event.preventDefault();
                onNavigate("canvas");
              }}
            >
              <Square className="size-4" aria-hidden="true" />
              {t("navCanvas")}
            </a>
            <a
              aria-current={route === "pool" ? "page" : undefined}
              className="top-navigation__link"
              data-active={route === "pool"}
              data-testid="nav-pool"
              href="/pool"
              onFocus={onPreloadPool}
              onMouseEnter={onPreloadPool}
              onClick={(event) => {
                event.preventDefault();
                onNavigate("pool");
              }}
            >
              <BookOpenCheck className="size-4" aria-hidden="true" />
              {t("navPool")}
            </a>
            <a
              aria-current={route === "gallery" ? "page" : undefined}
              className="top-navigation__link"
              data-active={route === "gallery"}
              data-testid="nav-gallery"
              href="/gallery"
              onFocus={onPreloadGallery}
              onMouseEnter={onPreloadGallery}
              onClick={(event) => {
                event.preventDefault();
                onNavigate("gallery");
              }}
            >
              <ImageIcon className="size-4" aria-hidden="true" />
              {t("navGallery")}
            </a>
          </nav>
          <LanguageSwitcher />
          <button
            aria-label={t("navOpenProviderConfig")}
            className="top-navigation__settings"
            data-testid="global-provider-settings"
            title={t("navProviderConfig")}
            type="button"
            onClick={onOpenProviderConfig}
          >
            <Settings className="size-4" aria-hidden="true" />
            <span>{t("navSettings")}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="language-switcher" aria-label={t("languageAria")} role="group">
      {LOCALES.map((item) => (
        <button
          aria-pressed={locale === item}
          className="language-switcher__button"
          data-active={locale === item}
          key={item}
          type="button"
          onClick={() => setLocale(item)}
        >
          {item === "zh-CN" ? t("languageZh") : t("languageEn")}
        </button>
      ))}
    </div>
  );
}

function CanvasThemeSync({ onChange }: { onChange: (isDarkMode: boolean) => void }) {
  const isDarkMode = useIsDarkMode();

  useEffect(() => {
    onChange(isDarkMode);
  }, [isDarkMode, onChange]);

  return null;
}

function providerStatusDetails(authStatus: AuthStatusResponse | null, isAuthLoading: boolean, t: Translate): {
  copy: string;
  provider: "openai" | "codex" | "loading" | "none";
  title: string;
} {
  if (authStatus?.provider === "openai") {
    if (authStatus.activeSource?.id === "local-openai") {
      return {
        copy: t("providerStatusLocalCopy"),
        provider: "openai",
        title: t("providerStatusLocalTitle")
      };
    }

    if (authStatus.activeSource?.id === "env-openai") {
      return {
        copy: t("providerStatusEnvCopy"),
        provider: "openai",
        title: t("providerStatusEnvTitle")
      };
    }

    return {
      copy: t("providerStatusGenericOpenAICopy"),
      provider: "openai",
      title: "OpenAI API"
    };
  }

  if (authStatus?.provider === "codex") {
    return {
      copy: authStatus.codex.email ?? authStatus.codex.accountId ?? t("providerStatusCodexCopy"),
      provider: "codex",
      title: t("providerStatusCodexTitle")
    };
  }

  if (isAuthLoading) {
    return {
      copy: t("providerStatusLoadingCopy"),
      provider: "loading",
      title: t("providerStatusLoadingTitle")
    };
  }

  return {
    copy: t("providerStatusNoneCopy"),
    provider: "none",
    title: t("providerStatusNoneTitle")
  };
}

function ProviderStatusPopover({
  authError,
  authStatus,
  codexLoginStatus,
  isAuthLoading,
  onLogoutCodex,
  onStartCodexLogin
}: {
  authError: string;
  authStatus: AuthStatusResponse | null;
  codexLoginStatus: CodexLoginStatus;
  isAuthLoading: boolean;
  onLogoutCodex: () => void;
  onStartCodexLogin: () => void;
}) {
  const { t } = useI18n();
  const details = providerStatusDetails(authStatus, isAuthLoading, t);
  const isCodexStarting = codexLoginStatus === "starting";

  return (
    <div className="provider-status-popover" data-provider={details.provider} data-testid="auth-provider-card">
      <button
        aria-label={t("providerStatusAria", { title: details.title })}
        className="provider-status-popover__trigger"
        type="button"
      >
        {details.provider === "openai" || details.provider === "codex" ? (
          <ShieldCheck className="size-4" aria-hidden="true" />
        ) : details.provider === "loading" ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <KeyRound className="size-4" aria-hidden="true" />
        )}
      </button>

      <div className="provider-status-popover__content">
        <span className="control-label">{t("providerStatusImageService")}</span>
        <p className="provider-status-popover__title">{details.title}</p>
        <p className="provider-status-popover__copy">{details.copy}</p>

        {authError ? (
          <p className="provider-status-popover__error" role="alert">
            {authError}
          </p>
        ) : null}

        {details.provider === "codex" ? (
          <button
            className="provider-status-popover__action"
            type="button"
            title={t("providerLogoutCodex")}
            data-testid="codex-logout-button"
            disabled={isAuthLoading}
            onClick={onLogoutCodex}
          >
            <LogOut className="size-4" aria-hidden="true" />
            {t("providerLogoutCodex")}
          </button>
        ) : details.provider === "openai" ? null : (
          <button
            className="provider-status-popover__action"
            type="button"
            data-testid="codex-login-button"
            disabled={isAuthLoading || isCodexStarting}
            onClick={onStartCodexLogin}
          >
            {isCodexStarting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="size-4" aria-hidden="true" />
            )}
            {t("providerLoginCodex")}
          </button>
        )}
      </div>
    </div>
  );
}

type PromptFavoriteTooltip = {
  arrowLeft: number;
  id: string;
  maxHeight: number;
  placement: "above" | "below";
  prompt: string;
  left: number;
  top: number;
  width: number;
};

function PromptFavoritesFloatingPanel({
  activeGroupId,
  copiedFavoriteId,
  favorites,
  groupCounts,
  groups,
  isMobile,
  isOpen,
  query,
  totalCount,
  onChangeGroup,
  onChangeQuery,
  onClose,
  onCopy,
  onRemove,
  onToggle,
  onUse,
  t
}: {
  activeGroupId: string;
  copiedFavoriteId: string | null;
  favorites: PromptFavoriteItem[];
  groupCounts: Map<string, number>;
  groups: PromptFavoriteGroup[];
  isMobile: boolean;
  isOpen: boolean;
  query: string;
  totalCount: number;
  onChangeGroup: (groupId: string) => void;
  onChangeQuery: (query: string) => void;
  onClose: () => void;
  onCopy: (favorite: PromptFavoriteItem) => void;
  onRemove: (favorite: PromptFavoriteItem) => void;
  onToggle: () => void;
  onUse: (favorite: PromptFavoriteItem) => void;
  t: Translate;
}) {
  const [promptTooltip, setPromptTooltip] = useState<PromptFavoriteTooltip | null>(null);
  const tooltipHideTimeoutRef = useRef<number | null>(null);

  const clearTooltipHideTimeout = useCallback(() => {
    if (tooltipHideTimeoutRef.current !== null) {
      window.clearTimeout(tooltipHideTimeoutRef.current);
      tooltipHideTimeoutRef.current = null;
    }
  }, []);

  const hidePromptTooltip = useCallback(() => {
    clearTooltipHideTimeout();
    setPromptTooltip(null);
  }, [clearTooltipHideTimeout]);

  const schedulePromptTooltipHide = useCallback(() => {
    clearTooltipHideTimeout();
    tooltipHideTimeoutRef.current = window.setTimeout(() => {
      setPromptTooltip(null);
      tooltipHideTimeoutRef.current = null;
    }, 120);
  }, [clearTooltipHideTimeout]);

  const showPromptTooltip = useCallback(
    (favorite: PromptFavoriteItem, target: HTMLElement) => {
      clearTooltipHideTimeout();

      const rect = target.getBoundingClientRect();
      const listRect = target.closest(".prompt-favorites-panel__list")?.getBoundingClientRect();
      const margin = 12;
      const gap = 8;
      const boundaryLeft = Math.max(margin, (listRect?.left ?? 0) + gap);
      const boundaryRight = Math.min(window.innerWidth - margin, (listRect?.right ?? window.innerWidth) - gap);
      const width = Math.min(isMobile ? 300 : 360, window.innerWidth - margin * 2, Math.max(220, boundaryRight - boundaryLeft));
      const left = Math.min(Math.max(rect.left, boundaryLeft), boundaryRight - width);
      const arrowLeft = Math.min(Math.max(rect.left + rect.width / 2 - left, 16), width - 16);
      const listTop = Math.max(margin, (listRect?.top ?? 0) + gap);
      const belowTop = rect.bottom + gap;
      const belowSpace = window.innerHeight - belowTop - margin;
      const aboveSpace = rect.top - listTop - gap;
      const placement: PromptFavoriteTooltip["placement"] =
        belowSpace >= 132 || belowSpace >= aboveSpace ? "below" : "above";
      const availableHeight = Math.max(88, placement === "below" ? belowSpace : aboveSpace);
      const maxHeight = Math.min(isMobile ? 188 : 224, availableHeight);
      const top = placement === "below" ? belowTop : Math.max(listTop, rect.top - maxHeight - gap);

      setPromptTooltip({
        arrowLeft,
        id: favorite.id,
        left,
        maxHeight,
        placement,
        prompt: favorite.prompt,
        top,
        width
      });
    },
    [clearTooltipHideTimeout, isMobile]
  );

  useEffect(() => clearTooltipHideTimeout, [clearTooltipHideTimeout]);

  useEffect(() => {
    if (!isOpen) {
      hidePromptTooltip();
    }
  }, [hidePromptTooltip, isOpen]);

  return (
    <div
      className="prompt-favorites-float"
      data-mobile={isMobile}
      data-open={isOpen}
      data-testid="prompt-favorites-floating-panel"
    >
      {isOpen ? (
        <section
          aria-label={t("favoritePanelTitle")}
          aria-modal={isMobile ? true : undefined}
          className="prompt-favorites-panel"
          data-testid="prompt-favorites-panel"
          id="prompt-favorites-panel"
          role={isMobile ? "dialog" : "region"}
        >
          <header className="prompt-favorites-panel__header">
            <div>
              <p>{t("favoritePanelTitle")}</p>
              <strong>{t("favoritePanelCount", { count: totalCount })}</strong>
            </div>
            <button className="history-icon-action" type="button" aria-label={t("favoritePanelClose")} onClick={onClose}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </header>

          <label className="prompt-favorites-panel__search">
            <Search className="size-4" aria-hidden="true" />
            <span className="sr-only">{t("favoritePanelSearch")}</span>
            <input
              value={query}
              aria-label={t("favoritePanelSearch")}
              placeholder={t("favoritePanelSearchPlaceholder")}
              type="search"
              onChange={(event) => onChangeQuery(event.currentTarget.value)}
            />
          </label>

          <div className="prompt-favorites-panel__groups" role="tablist" aria-label={t("favoriteGroupLabel")}>
            <button
              className="prompt-favorites-chip"
              data-active={activeGroupId === "all"}
              role="tab"
              type="button"
              aria-selected={activeGroupId === "all"}
              onClick={() => onChangeGroup("all")}
            >
              {t("poolAllMedia")}
              <span>{totalCount}</span>
            </button>
            {groups.map((group) => (
              <button
                className="prompt-favorites-chip"
                data-active={activeGroupId === group.id}
                key={group.id}
                role="tab"
                type="button"
                aria-selected={activeGroupId === group.id}
                onClick={() => onChangeGroup(group.id)}
              >
                {group.name}
                <span>{groupCounts.get(group.id) ?? 0}</span>
              </button>
            ))}
          </div>

          {favorites.length > 0 ? (
            <div className="prompt-favorites-panel__list" onScroll={hidePromptTooltip}>
              {favorites.map((favorite) => {
                const copied = copiedFavoriteId === favorite.id;
                const copyLabel = copied ? t("agentCopiedMessage") : t("commonCopy");
                return (
                  <article className="prompt-favorites-item" key={favorite.id}>
                    <div className="prompt-favorites-item__media">
                      <img alt="" loading="lazy" src={favorite.assetUrl} />
                    </div>
                    <div
                      className="prompt-favorites-item__body"
                      tabIndex={0}
                      aria-describedby={promptTooltip?.id === favorite.id ? "prompt-favorites-tooltip" : undefined}
                      onBlur={schedulePromptTooltipHide}
                      onFocus={(event) => showPromptTooltip(favorite, event.currentTarget)}
                      onPointerEnter={(event) => showPromptTooltip(favorite, event.currentTarget)}
                      onPointerLeave={schedulePromptTooltipHide}
                    >
                      <h3>{favorite.title}</h3>
                      <p>{promptExcerpt(favorite.prompt)}</p>
                      <span>{promptFavoriteMeta(favorite, t)}</span>
                    </div>
                    <div className="prompt-favorites-item__actions">
                      <button className="primary-action prompt-favorites-item__use" type="button" onClick={() => onUse(favorite)}>
                        <BookmarkCheck className="size-3.5" aria-hidden="true" />
                        {t("favoriteUse")}
                      </button>
                      <button
                        className="history-icon-action"
                        data-copied={copied}
                        type="button"
                        aria-label={copyLabel}
                        title={copyLabel}
                        onClick={() => onCopy(favorite)}
                      >
                        {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                      </button>
                      <button
                        className="history-icon-action prompt-favorites-item__remove"
                        type="button"
                        aria-label={t("favoriteCancel")}
                        title={t("favoriteCancel")}
                        onClick={() => onRemove(favorite)}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="prompt-favorites-panel__empty">
              <Bookmark className="size-5" aria-hidden="true" />
              <strong>{t("favoriteEmpty")}</strong>
              <p>{t("favoriteEmptyHint")}</p>
            </div>
          )}
        </section>
      ) : null}

      {promptTooltip
        ? createPortal(
            <div
              className="prompt-favorites-tooltip"
              data-placement={promptTooltip.placement}
              id="prompt-favorites-tooltip"
              role="tooltip"
              style={{
                "--tooltip-arrow-left": `${promptTooltip.arrowLeft}px`,
                left: promptTooltip.left,
                maxHeight: promptTooltip.maxHeight,
                top: promptTooltip.top,
                width: promptTooltip.width
              } as CSSProperties}
              onPointerEnter={clearTooltipHideTimeout}
              onPointerLeave={schedulePromptTooltipHide}
            >
              {promptTooltip.prompt}
            </div>,
            document.body
          )
        : null}

      <button
        aria-controls="prompt-favorites-panel"
        aria-expanded={isOpen}
        aria-label={isOpen ? t("favoritePanelClose") : t("favoritePanelOpen")}
        className="prompt-favorites-trigger"
        data-testid="prompt-favorites-trigger"
        type="button"
        onClick={onToggle}
      >
        <Bookmark className="size-4" aria-hidden="true" />
        <span>{t("favoritePanelTitle")}</span>
        <strong>{t("favoritePanelCount", { count: totalCount })}</strong>
      </button>
    </div>
  );
}

export function App() {
  const { formatDateTime, locale, setLocale, t } = useI18n();
  const tldrawLocale = tldrawLocaleForLocale(locale);
  const [tldrawUserPreferences, setTldrawUserPreferences] = useState<TLUserPreferences>(() => ({
    id: TLDRAW_USER_ID,
    isSnapMode: CANVAS_DEFAULT_SNAP_MODE,
    locale: tldrawLocale
  }));
  useEffect(() => {
    setTldrawUserPreferences((currentPreferences) =>
      currentPreferences.locale === tldrawLocale ? currentPreferences : { ...currentPreferences, locale: tldrawLocale }
    );
  }, [tldrawLocale]);
  const syncTldrawUserPreferences = useCallback(
    (preferences: TLUserPreferences) => {
      setTldrawUserPreferences({
        ...preferences,
        id: TLDRAW_USER_ID,
        isSnapMode: preferences.isSnapMode ?? CANVAS_DEFAULT_SNAP_MODE,
        locale: preferences.locale ?? tldrawLocale
      });

      const nextLocale = localeForTldrawLocale(preferences.locale);
      if (nextLocale && nextLocale !== locale) {
        setLocale(nextLocale);
      }
    },
    [locale, setLocale, tldrawLocale]
  );
  const tldrawUser = useTldrawUser({
    userPreferences: tldrawUserPreferences,
    setUserPreferences: syncTldrawUserPreferences
  });
  const [route, setRoute] = useState<AppRoute>(() => routeFromLocation());
  const shouldAutoOpenCanvasRef = useRef(route !== "gallery");
  const [panelTab, setPanelTab] = useState<PanelTab>("manual");
  const [generationMode, setGenerationMode] = useState<GenerationMode>("text");
  const [prompt, setPrompt] = useState("");
  const [stylePreset, setStylePreset] = useState<StylePresetId>("none");
  const [resolutionPresetId, setResolutionPresetId] = useState<ResolutionPresetId>(DEFAULT_RESOLUTION_PRESET_ID);
  const [aspectRatioPresetId, setAspectRatioPresetId] = useState<AspectRatioPresetId>(DEFAULT_ASPECT_RATIO_PRESET_ID);
  const [sizePresetId, setSizePresetId] = useState(DEFAULT_SIZE.presetId);
  const [width, setWidth] = useState(DEFAULT_SIZE.width);
  const [height, setHeight] = useState(DEFAULT_SIZE.height);
  const [count, setCount] = useState<GenerationCount>(1);
  const [quality, setQuality] = useState<ImageQuality>(DEFAULT_IMAGE_QUALITY);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("png");
  const [activeGenerationCount, setActiveGenerationCount] = useState(0);
  const [isProjectLoaded, setIsProjectLoaded] = useState(false);
  const [projectSnapshot, setProjectSnapshot] = useState<PersistedSnapshot | undefined>();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [saveError, setSaveError] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [generationMessage, setGenerationMessage] = useState("");
  const [generationWarning, setGenerationWarning] = useState("");
  const [generationHistory, setGenerationHistory] = useState<GenerationRecord[]>([]);
  const [promptFavoriteGroups, setPromptFavoriteGroups] = useState<PromptFavoriteGroup[]>([]);
  const [promptFavoriteItems, setPromptFavoriteItems] = useState<PromptFavoriteItem[]>([]);
  const [isFavoritePanelOpen, setIsFavoritePanelOpen] = useState(false);
  const [favoritePanelQuery, setFavoritePanelQuery] = useState("");
  const [favoritePanelGroupId, setFavoritePanelGroupId] = useState("all");
  const [copiedPromptFavoriteId, setCopiedPromptFavoriteId] = useState<string | null>(null);
  const generationHistoryRef = useRef<GenerationRecord[]>([]);
  generationHistoryRef.current = generationHistory;
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [isMobileDrawer, setIsMobileDrawer] = useState(false);
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [isStorageDialogOpen, setIsStorageDialogOpen] = useState(false);
  const [isProviderConfigDialogOpen, setIsProviderConfigDialogOpen] = useState(false);
  const [isAgentSkillDialogOpen, setIsAgentSkillDialogOpen] = useState(false);
  const [storageConfig, setStorageConfig] = useState<StorageConfigResponse | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [isCodexLoginOpen, setIsCodexLoginOpen] = useState(false);
  const [codexDevice, setCodexDevice] = useState<CodexDeviceStartResponse | null>(null);
  const [codexLoginStatus, setCodexLoginStatus] = useState<CodexLoginStatus>("idle");
  const [codexLoginMessage, setCodexLoginMessage] = useState("");
  const [storageForm, setStorageForm] = useState<StorageConfigFormState>(() => cloneDefaultStorageConfigForm());
  const [storageSecretTouched, setStorageSecretTouched] = useState<StorageSecretTouchedState>({ cos: false, s3: false });
  const [storageError, setStorageError] = useState("");
  const [storageMessage, setStorageMessage] = useState("");
  const [isStorageSaving, setIsStorageSaving] = useState(false);
  const [isStorageTesting, setIsStorageTesting] = useState(false);
  const [referenceSelection, setReferenceSelection] = useState<ReferenceSelection>(() => missingReferenceSelection(t));
  const [agentSizePresetId, setAgentSizePresetId] = useState(DEFAULT_SIZE_PRESET.id);
  const [agentWidth, setAgentWidth] = useState(DEFAULT_SIZE_PRESET.width);
  const [agentHeight, setAgentHeight] = useState(DEFAULT_SIZE_PRESET.height);
  const [agentQuality, setAgentQuality] = useState<ImageQuality>(DEFAULT_IMAGE_QUALITY);
  const [agentOutputFormat, setAgentOutputFormat] = useState<OutputFormat>("png");
  const [agentInput, setAgentInput] = useState("");
  const [agentConfig, setAgentConfig] = useState<AgentLlmConfigView | null>(null);
  const [isAgentConfigLoading, setIsAgentConfigLoading] = useState(true);
  const [agentConfigError, setAgentConfigError] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentChatMessage[]>([]);
  const [currentAgentConversationId, setCurrentAgentConversationId] = useState<string | null>(null);
  const [isAgentHistoryOpen, setIsAgentHistoryOpen] = useState(false);
  const [agentHistorySummaries, setAgentHistorySummaries] = useState<AgentConversationSummary[]>([]);
  const [selectedAgentHistoryId, setSelectedAgentHistoryId] = useState<string | null>(null);
  const [selectedAgentConversation, setSelectedAgentConversation] = useState<AgentConversation | null>(null);
  const [isAgentHistoryLoading, setIsAgentHistoryLoading] = useState(false);
  const [isAgentHistoryDetailLoading, setIsAgentHistoryDetailLoading] = useState(false);
  const [agentHistoryError, setAgentHistoryError] = useState("");
  const [copiedAgentMessageId, setCopiedAgentMessageId] = useState<string | null>(null);
  const [expandedThinkingMessageIds, setExpandedThinkingMessageIds] = useState<string[]>([]);
  const [agentTraceEntries, setAgentTraceEntries] = useState<AgentTraceEntry[]>([]);
  const [isAgentTraceOpen, setIsAgentTraceOpen] = useState(false);
  const [isAgentTraceCopied, setIsAgentTraceCopied] = useState(false);
  const [agentRunStatus, setAgentRunStatus] = useState<AgentRunStatus>("idle");
  const [agentReferenceSelection, setAgentReferenceSelection] = useState<AgentReferenceSelection>(() => emptyAgentReferenceSelection(t));
  const [agentThinkingType, setAgentThinkingType] = useState<AgentThinkingType>("enabled");
  const [agentReasoningEffort, setAgentReasoningEffort] = useState<AgentReasoningEffort>("high");
  const [isAgentSettingsOpen, setIsAgentSettingsOpen] = useState(false);
  const [isCanvasDarkMode, setIsCanvasDarkMode] = useState(false);
  const canvasShellRef = useRef<HTMLElement | null>(null);
  const panelCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const generationModeRef = useRef<GenerationMode>("text");
  const activeGenerationsRef = useRef<Map<string, ActiveGenerationTask>>(new Map());
  const agentRequestRef = useRef(0);
  const agentSocketRef = useRef<WebSocket | null>(null);
  const agentSocketOpenPromiseRef = useRef<Promise<WebSocket> | null>(null);
  const agentSocketPingTimerRef = useRef<number | undefined>();
  const agentSocketReconnectTimerRef = useRef<number | undefined>();
  const agentSocketReconnectDeadlineRef = useRef<number | undefined>();
  const agentSocketReconnectDelayRef = useRef(AGENT_SOCKET_RECONNECT_INITIAL_MS);
  const agentConnectionIdRef = useRef<string | null>(null);
  const activeAgentRunIdRef = useRef<string | null>(null);
  const currentAgentConversationIdRef = useRef<string | null>(null);
  currentAgentConversationIdRef.current = currentAgentConversationId;
  const agentTraceEntriesRef = useRef<AgentTraceEntry[]>([]);
  agentTraceEntriesRef.current = agentTraceEntries;
  const agentHistorySaveTimerRef = useRef<number | undefined>();
  const agentHistorySaveRequestRef = useRef(0);
  const agentTranscriptRef = useRef<HTMLElement | null>(null);
  const agentOutputPlacementCountsRef = useRef<Map<string, number>>(new Map());
  const agentJobPlaceholdersRef = useRef<Map<string, AgentJobPlaceholderSet>>(new Map());
  const pendingAgentSelectedReferencesRef = useRef<Map<string, AgentSelectedCanvasReference[]>>(new Map());
  const agentPlanSelectedReferencesRef = useRef<Map<string, AgentSelectedCanvasReference[]>>(new Map());
  const agentPlaceholderRequestRef = useRef(0);
  const agentCopyResetTimerRef = useRef<number | undefined>();
  const agentTraceCopyResetTimerRef = useRef<number | undefined>();
  const agentPlanCreatedRunIdsRef = useRef<Set<string>>(new Set());
  const agentUserInputRunIdsRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<number | undefined>();
  const codexPollTimerRef = useRef<number | undefined>();
  const favoriteCopyTimerRef = useRef<number | undefined>();
  const canvasGalleryAssetIdsRef = useRef<Set<string>>(new Set());
  const saveRequestRef = useRef(0);
  const isGenerating = activeGenerationCount > 0;
  const hasGenerationProvider = authStatus?.provider === "openai" || authStatus?.provider === "codex";
  const isAgentRunning = agentRunStatus === "connecting" || agentRunStatus === "running";
  const agentRunStatusLabel = t("agentRunStatus", { status: agentRunStatus });
  const agentCancelRunLabel = `${agentRunStatusLabel}: ${t("agentCancelRun")}`;
  const trimmedAgentInput = agentInput.trim();
  const isAgentConfigured = Boolean(agentConfig?.configured);
  const supportsAgentThinkingControls = isDeepSeekAgentConfigView(agentConfig);
  const agentDefaultsValidationMessage = sizeValidationMessage(agentWidth, agentHeight, t, locale);
  const canSendAgentMessage = Boolean(
    trimmedAgentInput && isAgentConfigured && !isAgentConfigLoading && !isAgentRunning && !agentDefaultsValidationMessage
  );
  const agentPlannerOptions = useMemo<AgentPlannerOptions>(
    () => ({
      thinking: {
        type: agentThinkingType
      },
      reasoningEffort: agentThinkingType === "enabled" ? agentReasoningEffort : undefined
    }),
    [agentReasoningEffort, agentThinkingType]
  );
  const agentDefaults = useMemo(
    () => ({
      size: {
        width: agentWidth,
        height: agentHeight
      },
      quality: agentQuality,
      outputFormat: agentOutputFormat
    }),
    [agentHeight, agentOutputFormat, agentQuality, agentWidth]
  );
  const agentSizeSummary = `${agentWidth} x ${agentHeight}`;
  const agentCompactSizeSummary = `${agentWidth}x${agentHeight}`;
  const agentQualitySummary = t("qualityLabel", { quality: agentQuality });
  const agentFormatSummary = t("outputFormatLabel", { format: agentOutputFormat });
  const agentThinkingSummary = agentThinkingChipLabel(locale, agentThinkingType, agentReasoningEffort);
  const agentReferenceCount = agentReferenceSelection.references.length;
  const agentReferenceSummary = t("agentParamReferences", {
    count: agentReferenceCount,
    max: MAX_AGENT_SELECTED_REFERENCES
  });
  const agentReferenceCompactSummary = `${agentReferenceCount}/${MAX_AGENT_SELECTED_REFERENCES}`;
  const agentSizePresetButtons = useMemo<SizePreset[]>(() => {
    const selectedPreset = SIZE_PRESETS.find((item) => item.id === agentSizePresetId);
    if (selectedPreset && !quickSizePresetIds.has(selectedPreset.id)) {
      return [...quickSizePresets, selectedPreset];
    }

    return quickSizePresets;
  }, [agentSizePresetId]);

  const trimmedPrompt = prompt.trim();
  const promptValidationMessage = prompt.trim() ? "" : t("promptRequired");
  const dimensionValidationMessage = sizeValidationMessage(width, height, t, locale);
  const isReferenceMode = generationMode === "reference";
  const isReferenceReady = isReferenceMode && referenceSelection.status === "ready";
  const referenceValidationMessage = isReferenceMode && !isReferenceReady ? referenceSelection.hint : "";
  const validationMessage = promptValidationMessage || dimensionValidationMessage || referenceValidationMessage;
  const shouldShowValidation = Boolean(validationMessage);
  const canGenerate = !validationMessage;
  const tldrawComponents = useMemo(
    () =>
      ({
        InFrontOfTheCanvas: () => (
          <>
            <CanvasThemeSync onChange={setIsCanvasDarkMode} />
            <CanvasResolutionBadgeOverlay />
            <CanvasImageOpenOverlay />
          </>
        ),
        SnapIndicator: CanvasSnapIndicator,
        StylePanel: null
      }) satisfies TLComponents,
    []
  );

  const navigateToRoute = useCallback((nextRoute: AppRoute, options: { replace?: boolean } = {}): void => {
    if (!options.replace) {
      shouldAutoOpenCanvasRef.current = false;
    }

    const nextPath = pathForRoute(nextRoute);
    if (window.location.pathname !== nextPath) {
      if (options.replace) {
        window.history.replaceState(null, "", nextPath);
      } else {
        window.history.pushState(null, "", nextPath);
      }
    }
    setRoute(nextRoute);
  }, []);

  const applyPromptPoolPromptToManualPanel = useCallback(
    (item: PromptPoolCanvasHandoffItem): void => {
      const nextPreset = promptLikeSizePreset(item);

      setPrompt(item.prompt);
      setStylePreset("none");
      setSizePresetId(nextPreset.id);
      setWidth(nextPreset.width);
      setHeight(nextPreset.height);
      setQuality(DEFAULT_IMAGE_QUALITY);
      setOutputFormat("png");
      setCount(1);
      setGenerationMode("text");
      setPanelTab("manual");
      setGenerationError("");
      setGenerationWarning("");
      setGenerationMessage(t("generationPoolReused"));
      setIsAiPanelOpen(true);
    },
    [t]
  );

  const visibleHistory = useMemo(
    () => (isHistoryExpanded ? generationHistory : generationHistory.slice(0, HISTORY_COLLAPSED_LIMIT)),
    [generationHistory, isHistoryExpanded]
  );
  const hiddenHistoryCount = Math.max(0, generationHistory.length - HISTORY_COLLAPSED_LIMIT);
  const hasAdditionalHistory = hiddenHistoryCount > 0;
  const isExtendedCountSelected = EXTENDED_GENERATION_COUNTS.includes(count);
  const deferredFavoritePanelQuery = useDeferredValue(favoritePanelQuery);
  const promptFavoriteGroupCounts = useMemo(
    () => countPromptFavoritesByGroup(promptFavoriteItems),
    [promptFavoriteItems]
  );
  const visiblePromptFavorites = useMemo(
    () => filterPromptFavorites(promptFavoriteItems, deferredFavoritePanelQuery, favoritePanelGroupId),
    [deferredFavoritePanelQuery, favoritePanelGroupId, promptFavoriteItems]
  );
  const loadAgentConfig = useCallback(async (signal?: AbortSignal): Promise<AgentLlmConfigView | null> => {
    setIsAgentConfigLoading(true);
    setAgentConfigError("");

    try {
      const response = await fetch("/api/agent-config", { signal });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const config = (await response.json()) as AgentLlmConfigView;
      if (!signal?.aborted) {
        setAgentConfig(config);
      }
      return config;
    } catch (error) {
      if (!signal?.aborted) {
        setAgentConfigError(error instanceof Error ? error.message : t("agentConfigLoadFailed"));
      }
      return null;
    } finally {
      if (!signal?.aborted) {
        setIsAgentConfigLoading(false);
      }
    }
  }, [locale, t]);
  const loadAuthStatus = useCallback(async (signal?: AbortSignal): Promise<AuthStatusResponse | null> => {
    setIsAuthLoading(true);
    setAuthError("");

    try {
      const response = await fetch("/api/auth/status", { signal });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const status = (await response.json()) as AuthStatusResponse;
      setAuthStatus(status);
      return status;
    } catch (error) {
      if (signal?.aborted) {
        return null;
      }

      setAuthError(error instanceof Error ? error.message : t("authStatusLoadFailed"));
      return null;
    } finally {
      if (!signal?.aborted) {
        setIsAuthLoading(false);
      }
    }
  }, [locale, t]);

  const saveProjectSnapshot = useCallback(async (editor: Editor): Promise<void> => {
    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    setSaveStatus("saving");
    setSaveError("");

    try {
      const response = await fetch("/api/project", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          snapshot: filterLoadingPlaceholdersFromSnapshot(editor.getSnapshot())
        })
      });

      if (!response.ok) {
        throw new Error(`Project save failed with ${response.status}`);
      }

      if (saveRequestRef.current === requestId) {
        setSaveStatus("saved");
      }
    } catch {
      if (saveRequestRef.current === requestId) {
        setSaveStatus("error");
        setSaveError(t("autosaveFailed"));
      }
    }
  }, [t]);

  const panelStatus = useMemo<PanelStatus | null>(() => {
    if (isGenerating) {
      return {
        tone: "progress",
        message: t("generationActiveTasks", { count: activeGenerationCount }),
        testId: "generation-progress"
      };
    }

    if (generationError) {
      return {
        tone: "error",
        message: generationError,
        testId: "generation-error"
      };
    }

    if (shouldShowValidation && validationMessage) {
      return {
        tone: "warning",
        message: validationMessage,
        testId: "validation-message"
      };
    }

    if (generationWarning) {
      return {
        tone: "warning",
        message: generationWarning,
        testId: "generation-warning"
      };
    }

    if (generationMessage) {
      return {
        tone: "success",
        message: generationMessage,
        testId: "generation-message"
      };
    }

    return null;
  }, [
    activeGenerationCount,
    generationError,
    generationMessage,
    generationWarning,
    isGenerating,
    shouldShowValidation,
    t,
    validationMessage
  ]);

  useEffect(() => {
    const updateRoute = (): void => {
      setRoute(routeFromLocation());
    };

    window.addEventListener("popstate", updateRoute);
    return () => {
      window.removeEventListener("popstate", updateRoute);
    };
  }, []);

  useEffect(() => {
    const handoffItem = consumePromptPoolCanvasHandoffFromLocation();
    if (!handoffItem) {
      return;
    }

    applyPromptPoolPromptToManualPanel(handoffItem);
    navigateToRoute("canvas", { replace: true });
  }, [applyPromptPoolPromptToManualPanel, navigateToRoute]);

  useEffect(() => {
    return () => {
      for (const task of activeGenerationsRef.current.values()) {
        task.controller.abort();
      }
      activeGenerationsRef.current.clear();
      agentSocketRef.current?.close();
      agentSocketRef.current = null;
      agentSocketOpenPromiseRef.current = null;
      window.clearInterval(agentSocketPingTimerRef.current);
      agentSocketPingTimerRef.current = undefined;
      window.clearTimeout(agentSocketReconnectTimerRef.current);
      agentSocketReconnectTimerRef.current = undefined;
      agentSocketReconnectDeadlineRef.current = undefined;
      agentSocketReconnectDelayRef.current = AGENT_SOCKET_RECONNECT_INITIAL_MS;
      agentConnectionIdRef.current = null;
      activeAgentRunIdRef.current = null;
      agentJobPlaceholdersRef.current.clear();
      agentOutputPlacementCountsRef.current.clear();
      window.clearTimeout(agentHistorySaveTimerRef.current);
      agentHistorySaveTimerRef.current = undefined;
      window.clearTimeout(agentCopyResetTimerRef.current);
      window.clearTimeout(agentTraceCopyResetTimerRef.current);
      window.clearTimeout(codexPollTimerRef.current);
      window.clearTimeout(favoriteCopyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadProject(): Promise<void> {
      setSaveStatus("loading");
      setSaveError("");

      try {
        const response = await fetch("/api/project", {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Project load failed with ${response.status}`);
        }

        const project = (await response.json()) as ProjectState;
        const snapshot = filterLoadingPlaceholdersFromSnapshot(project.snapshot);
        if (isPersistedSnapshot(snapshot)) {
          setProjectSnapshot(snapshot);
        }
        setGenerationHistory(project.history);
        setSaveStatus("saved");
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setSaveStatus("error");
        setSaveError(t("projectLoadFailed"));
      } finally {
        if (!controller.signal.aborted) {
          setIsProjectLoaded(true);
        }
      }
    }

    void loadProject();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void loadAuthStatus(controller.signal);

    return () => {
      controller.abort();
    };
  }, [loadAuthStatus]);

  useEffect(() => {
    const controller = new AbortController();

    void loadAgentConfig(controller.signal);

    return () => {
      controller.abort();
    };
  }, [loadAgentConfig]);

  useEffect(() => {
    const controller = new AbortController();

    void loadPromptFavoriteState(controller.signal);

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (route !== "canvas") {
      setIsFavoritePanelOpen(false);
    }
  }, [route]);

  useEffect(() => {
    if (
      favoritePanelGroupId !== "all" &&
      !promptFavoriteGroups.some((group) => group.id === favoritePanelGroupId)
    ) {
      setFavoritePanelGroupId("all");
    }
  }, [favoritePanelGroupId, promptFavoriteGroups]);

  useEffect(() => {
    const transcript = agentTranscriptRef.current;
    if (!transcript) {
      return;
    }

    transcript.scrollTop = transcript.scrollHeight;
  }, [agentMessages]);

  useEffect(() => {
    if (!currentAgentConversationId || agentMessages.length === 0) {
      return;
    }

    window.clearTimeout(agentHistorySaveTimerRef.current);
    agentHistorySaveTimerRef.current = window.setTimeout(() => {
      agentHistorySaveTimerRef.current = undefined;
      void saveAgentConversationNow(currentAgentConversationId, agentMessages, agentTraceEntriesRef.current);
    }, AGENT_HISTORY_SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(agentHistorySaveTimerRef.current);
      agentHistorySaveTimerRef.current = undefined;
    };
  }, [agentMessages, agentTraceEntries, currentAgentConversationId]);

  useEffect(() => {
    if (isAuthLoading || !authStatus || route === "gallery" || route === "pool") {
      return;
    }

    if (route === "home" && hasGenerationProvider && shouldAutoOpenCanvasRef.current) {
      shouldAutoOpenCanvasRef.current = false;
      navigateToRoute("canvas", { replace: true });
      return;
    }

    if (route === "canvas" && !hasGenerationProvider) {
      navigateToRoute("home", { replace: true });
    }
  }, [authStatus, hasGenerationProvider, isAuthLoading, navigateToRoute, route]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadStorageConfig(): Promise<void> {
      try {
        const response = await fetch("/api/storage/config", {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Storage config load failed with ${response.status}`);
        }

        const config = (await response.json()) as StorageConfigResponse;
        if (controller.signal.aborted) {
          return;
        }

        setStorageConfig(config);
        setStorageForm(storageConfigToForm(config));
        setStorageSecretTouched({ cos: false, s3: false });
      } catch {
        if (!controller.signal.aborted) {
          setStorageError(t("storageLoadFailed"));
        }
      }
    }

    void loadStorageConfig();

    return () => {
      controller.abort();
    };
  }, [t]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_DRAWER_MEDIA_QUERY);
    const updateDrawerMode = (): void => {
      setIsMobileDrawer(mediaQuery.matches);
    };

    updateDrawerMode();
    mediaQuery.addEventListener("change", updateDrawerMode);

    return () => {
      mediaQuery.removeEventListener("change", updateDrawerMode);
    };
  }, [t]);

  const closeAiPanel = useCallback((): void => {
    setIsAiPanelOpen(false);
    window.requestAnimationFrame(() => {
      canvasShellRef.current?.focus({ preventScroll: true });
    });
  }, []);

  function openStorageDialog(): void {
    setStorageForm(storageConfigToForm(storageConfig));
    setStorageSecretTouched({ cos: false, s3: false });
    setStorageError("");
    setStorageMessage("");
    setIsStorageDialogOpen(true);
  }

  function closeStorageDialog(): void {
    setIsStorageDialogOpen(false);
    setStorageError("");
    setStorageMessage("");
  }

  function closeProviderConfigDialog(): void {
    setIsProviderConfigDialogOpen(false);
  }

  async function startCodexLogin(): Promise<void> {
    window.clearTimeout(codexPollTimerRef.current);
    setIsCodexLoginOpen(true);
    setCodexDevice(null);
    setCodexLoginStatus("starting");
    setCodexLoginMessage("");
    setAuthError("");

    try {
      const response = await fetch("/api/auth/codex/device/start", {
        method: "POST"
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const device = (await response.json()) as CodexDeviceStartResponse;
      setCodexDevice(device);
      setCodexLoginStatus("pending");
      setCodexLoginMessage(t("codexPendingAuth"));
      scheduleCodexPoll(device, device.interval);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("codexLoginFailedToStart");
      setCodexLoginStatus("error");
      setCodexLoginMessage(message);
      setAuthError(message);
    }
  }

  async function pollCodexLogin(device: CodexDeviceStartResponse): Promise<void> {
    try {
      const response = await fetch("/api/auth/codex/device/poll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          deviceAuthId: device.deviceAuthId,
          userCode: device.userCode
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const result = (await response.json()) as CodexDevicePollResponse;
      if (result.status === "authorized") {
        setCodexLoginStatus("authorized");
        setCodexLoginMessage(t("codexLoginAuthorized"));
        if (result.auth) {
          setAuthStatus(result.auth);
        } else {
          void loadAuthStatus();
        }
        window.setTimeout(() => {
          setIsCodexLoginOpen(false);
          navigateToRoute("canvas");
        }, 700);
        return;
      }

      if (result.status === "pending") {
        setCodexLoginStatus("pending");
        scheduleCodexPoll(device, result.interval ?? device.interval);
        return;
      }

      setCodexLoginStatus(result.status);
      setCodexLoginMessage(result.message ?? t("codexLoginIncomplete"));
      void loadAuthStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("codexLoginPollingFailed");
      setCodexLoginStatus("error");
      setCodexLoginMessage(message);
      setAuthError(message);
    }
  }

  function scheduleCodexPoll(device: CodexDeviceStartResponse, intervalSeconds: number): void {
    window.clearTimeout(codexPollTimerRef.current);
    const delay = Math.max(1, intervalSeconds) * 1000;
    codexPollTimerRef.current = window.setTimeout(() => {
      void pollCodexLogin(device);
    }, delay);
  }

  function closeCodexLoginDialog(): void {
    window.clearTimeout(codexPollTimerRef.current);
    setIsCodexLoginOpen(false);
  }

  async function logoutCodexSession(): Promise<void> {
    window.clearTimeout(codexPollTimerRef.current);
    setIsAuthLoading(true);
    setAuthError("");

    try {
      const response = await fetch("/api/auth/codex/logout", {
        method: "POST"
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const result = (await response.json()) as CodexLogoutResponse;
      setAuthStatus(result.auth);
      setCodexDevice(null);
      setCodexLoginStatus("idle");
      setCodexLoginMessage("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : t("codexLogoutFailed"));
    } finally {
      setIsAuthLoading(false);
    }
  }

  async function copyCodexUserCode(): Promise<void> {
    if (!codexDevice) {
      return;
    }

    await writeClipboardText(codexDevice.userCode).catch(() => undefined);
  }

  function updateStorageForm(patch: Partial<StorageConfigFormState>): void {
    setStorageForm((current) => ({
      ...current,
      ...patch
    }));
    setStorageError("");
    setStorageMessage("");
  }

  function updateStorageProvider(provider: CloudStorageProvider): void {
    setStorageForm((current) => ({
      ...current,
      provider
    }));
    setStorageError("");
    setStorageMessage("");
  }

  function updateStorageCosForm(patch: Partial<StorageConfigFormState["cos"]>): void {
    setStorageForm((current) => ({
      ...current,
      cos: {
        ...current.cos,
        ...patch
      }
    }));
    setStorageError("");
    setStorageMessage("");
  }

  function updateStorageS3Form(patch: Partial<StorageConfigFormState["s3"]>): void {
    setStorageForm((current) => ({
      ...current,
      s3: {
        ...current.s3,
        ...patch
      }
    }));
    setStorageError("");
    setStorageMessage("");
  }

  async function testStorageSettings(): Promise<void> {
    setIsStorageTesting(true);
    setStorageError("");
    setStorageMessage("");

    try {
      const response = await fetch("/api/storage/config/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(
          storageConfigRequestBody(storageForm, {
            preserveSecret: shouldPreserveStorageSecret(storageForm, storageConfig, storageSecretTouched),
            forceEnabled: true
          })
        )
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const result = (await response.json()) as StorageTestResult;
      if (!result.ok) {
        setStorageError(result.message);
        return;
      }

      setStorageMessage(result.message);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : t("storageTestFailed"));
    } finally {
      setIsStorageTesting(false);
    }
  }

  async function saveStorageSettings(): Promise<void> {
    setIsStorageSaving(true);
    setStorageError("");
    setStorageMessage("");

    try {
      const response = await fetch("/api/storage/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(
          storageConfigRequestBody(storageForm, {
            preserveSecret: shouldPreserveStorageSecret(storageForm, storageConfig, storageSecretTouched)
          })
        )
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const config = (await response.json()) as StorageConfigResponse;
      setStorageConfig(config);
      setStorageForm(storageConfigToForm(config));
      setStorageSecretTouched({ cos: false, s3: false });
      setStorageMessage(t("storageSaved"));
      setGenerationMessage(config.enabled ? t("storageEnabledMessage") : t("storageDisabledMessage"));
      setGenerationWarning("");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : t("storageSaveFailed"));
    } finally {
      setIsStorageSaving(false);
    }
  }

  useEffect(() => {
    if (!isMobileDrawer || !isAiPanelOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAiPanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeAiPanel, isAiPanelOpen, isMobileDrawer]);

  useEffect(() => {
    if (!isMobileDrawer || !isAiPanelOpen) {
      return;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      panelCloseButtonRef.current?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
    };
  }, [isAiPanelOpen, isMobileDrawer]);

  useEffect(() => {
    generationModeRef.current = generationMode;

    const editor = editorRef.current;
    const nextAgentSelection = editor ? resolveAgentReferenceSelection(editor, t) : emptyAgentReferenceSelection(t);
    setAgentReferenceSelection((currentSelection) =>
      areAgentReferenceSelectionsEqual(currentSelection, nextAgentSelection) ? currentSelection : nextAgentSelection
    );

    if (generationMode === "reference" && editor) {
      const nextSelection = resolveReferenceSelection(editor, t);
      setReferenceSelection((currentSelection) =>
        areReferenceSelectionsEqual(currentSelection, nextSelection) ? currentSelection : nextSelection
      );
      return;
    }

    setReferenceSelection((currentSelection) =>
      areReferenceSelectionsEqual(currentSelection, missingReferenceSelection(t)) ? currentSelection : missingReferenceSelection(t)
    );
  }, [generationMode, t]);

  const handleEditorMount = useCallback((editor: Editor) => {
    editorRef.current = editor;
    if (!editor.user.getIsSnapMode()) {
      editor.user.updateUserPreferences({ isSnapMode: true });
    }

    let referenceSelectionFrame: number | undefined;
    const commitReferenceSelection = (): void => {
      const nextAgentSelection = resolveAgentReferenceSelection(editor, t);
      setAgentReferenceSelection((currentSelection) =>
        areAgentReferenceSelectionsEqual(currentSelection, nextAgentSelection) ? currentSelection : nextAgentSelection
      );

      if (generationModeRef.current !== "reference") {
        return;
      }

      const nextSelection = resolveReferenceSelection(editor, t);
      setReferenceSelection((currentSelection) =>
        areReferenceSelectionsEqual(currentSelection, nextSelection) ? currentSelection : nextSelection
      );
    };
    const updateReferenceSelection = (): void => {
      if (referenceSelectionFrame !== undefined) {
        return;
      }

      referenceSelectionFrame = window.requestAnimationFrame(() => {
        referenceSelectionFrame = undefined;
        commitReferenceSelection();
      });
    };
    const syncDeletedCanvasImagesToGallery = (): void => {
      const previousAssetIds = canvasGalleryAssetIdsRef.current;
      const currentAssetIds = getCanvasImageAssetIds(editor);
      canvasGalleryAssetIdsRef.current = currentAssetIds;

      const removedAssetIds = [...previousAssetIds].filter((assetId) => !currentAssetIds.has(assetId));
      if (removedAssetIds.length > 0) {
        void deleteGalleryRecordsForCanvasAssetIds(removedAssetIds);
      }
    };
    const handleEditorChange = (): void => {
      updateReferenceSelection();
      syncDeletedCanvasImagesToGallery();
    };

    const removeListener = editor.store.listen(
      () => {
        window.clearTimeout(saveTimerRef.current);
        setSaveStatus((status) => (status === "pending" ? status : "pending"));
        setSaveError((error) => (error ? "" : error));
        saveTimerRef.current = window.setTimeout(() => {
          void saveProjectSnapshot(editor);
        }, AUTOSAVE_DEBOUNCE_MS);
      },
      {
        source: "user",
        scope: "document"
      }
    );
    const removeReferenceStoreListener = editor.store.listen(updateReferenceSelection, {
      source: "all",
      scope: "all"
    });
    editor.on("change", handleEditorChange);
    deleteAgentPlanNodes(editor);
    canvasGalleryAssetIdsRef.current = getCanvasImageAssetIds(editor);
    commitReferenceSelection();
    recoverActiveGenerationPolling(editor);

    return () => {
      window.clearTimeout(saveTimerRef.current);
      if (referenceSelectionFrame !== undefined) {
        window.cancelAnimationFrame(referenceSelectionFrame);
      }
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
      editor.off("change", handleEditorChange);
      removeReferenceStoreListener();
      removeListener();
    };
  }, [saveProjectSnapshot, t]);

  function applySizeSelection(
    nextResolutionPresetId: ResolutionPresetId,
    nextAspectRatioPresetId: AspectRatioPresetId
  ): void {
    const nextSize = SIZE_MATRIX[nextResolutionPresetId][nextAspectRatioPresetId];
    setResolutionPresetId(nextResolutionPresetId);
    setAspectRatioPresetId(nextAspectRatioPresetId);
    setSizePresetId(nextSize.presetId);
    setWidth(nextSize.width);
    setHeight(nextSize.height);
  }

  function selectResolutionPreset(nextPresetId: string): void {
    const nextResolutionPreset = RESOLUTION_PRESETS.find((preset) => preset.id === nextPresetId);
    if (!nextResolutionPreset) {
      return;
    }

    applySizeSelection(nextResolutionPreset.id, aspectRatioPresetId);
  }

  function selectAspectRatioPreset(nextPresetId: string): void {
    const nextAspectRatioPreset = ASPECT_RATIO_PRESETS.find((preset) => preset.id === nextPresetId);
    if (!nextAspectRatioPreset) {
      return;
    }

    applySizeSelection(resolutionPresetId, nextAspectRatioPreset.id);
  }

  function syncSizeSelection(widthValue: number, heightValue: number): void {
    const selection = sizeSelectionForSize(widthValue, heightValue);
    if (!selection) {
      setSizePresetId(CUSTOM_SIZE_PRESET_ID);
      return;
    }

    setResolutionPresetId(selection.resolutionPresetId);
    setAspectRatioPresetId(selection.aspectRatioPresetId);
    setSizePresetId(selection.sizePresetId);
  }

  function updateWidth(value: string): void {
    const nextWidth = normalizeDimension(value);
    setWidth(nextWidth);
    syncSizeSelection(nextWidth, height);
  }

  function updateHeight(value: string): void {
    const nextHeight = normalizeDimension(value);
    setHeight(nextHeight);
    syncSizeSelection(width, nextHeight);
  }

  function applyPromptStarter(starter: string): void {
    setPrompt(starter);
    setGenerationError("");
    setGenerationMessage("");
    setGenerationWarning("");
  }

  function upsertGenerationHistoryRecord(record: GenerationRecord, options: { promote?: boolean } = {}): void {
    setGenerationHistory((history) => {
      const existingIndex = history.findIndex((item) => item.id === record.id);
      if (existingIndex >= 0 && !options.promote) {
        return history.map((item) => (item.id === record.id ? record : item));
      }

      return [record, ...history.filter((item) => item.id !== record.id)].slice(0, 20);
    });
  }

  async function fetchGenerationRecord(recordId: string, signal: AbortSignal): Promise<GenerationRecord> {
    const response = await fetch(`/api/generations/${encodeURIComponent(recordId)}`, {
      signal
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, locale, t));
    }

    const body = (await response.json()) as unknown;
    if (!isGenerationResponse(body)) {
      throw new Error(t("generationInvalidResponse"));
    }

    return body.record;
  }

  function finishPolledGeneration(record: GenerationRecord, placeholderSet: ActiveGenerationPlaceholders, notify: boolean): void {
    const editor = editorRef.current;
    const livePlaceholderSet = editor ? placeholderSetForGenerationRecord(editor, record) ?? placeholderSet : placeholderSet;
    const insertedCount = editor && livePlaceholderSet.placements.length > 0 ? replaceGenerationPlaceholders(editor, livePlaceholderSet, record, t) : 0;
    if (editor && livePlaceholderSet.placements.length > 0) {
      void saveProjectSnapshot(editor);
    }
    const failedCount =
      record.outputs.filter((output) => output.status === "failed").length +
      Math.max(0, livePlaceholderSet.placements.length - record.outputs.length);
    const cloudFailedCount = cloudFailureCount(record);

    if (!notify) {
      return;
    }

    if (insertedCount > 0) {
      if (cloudFailedCount > 0 || failedCount > 0) {
        setGenerationWarning(generationWarningMessage(record, insertedCount, failedCount, cloudFailedCount, t));
      } else {
        setGenerationMessage(t("generationImageInserted", { count: insertedCount }));
      }
      showGenerationCompleteNotification(record, insertedCount, failedCount, t);
      return;
    }

    if (record.status === "failed" || record.status === "cancelled") {
      setGenerationError(generationFailureMessage(record, t));
    }
  }

  function startGenerationPolling(
    record: GenerationRecord,
    placeholderSet: ActiveGenerationPlaceholders | undefined,
    options: { notify?: boolean } = {}
  ): void {
    if (!isActiveGenerationRecord(record) || activeGenerationsRef.current.has(record.id)) {
      return;
    }

    const editor = editorRef.current;
    const controller = new AbortController();
    activeGenerationsRef.current.set(record.id, {
      requestId: record.id,
      controller,
      placeholderSet: placeholderSet ?? (editor ? placeholderSetForGenerationRecord(editor, record) : undefined) ?? {
        requestId: record.id,
        placements: []
      }
    });
    setActiveGenerationCount(activeGenerationsRef.current.size);
    void pollGenerationUntilComplete(record.id, options.notify === true);
  }

  async function pollGenerationUntilComplete(recordId: string, notify: boolean): Promise<void> {
    while (true) {
      const task = activeGenerationsRef.current.get(recordId);
      if (!task) {
        return;
      }

      try {
        await waitForGenerationPollInterval(task.controller.signal);
        const record = await fetchGenerationRecord(recordId, task.controller.signal);
        upsertGenerationHistoryRecord(record);

        if (!isTerminalGenerationRecord(record)) {
          continue;
        }

        await preloadGenerationRecordPreviews(record, task.controller.signal);
        finishPolledGeneration(record, task.placeholderSet, notify);
        activeGenerationsRef.current.delete(recordId);
        setActiveGenerationCount(activeGenerationsRef.current.size);
        return;
      } catch (error) {
        if (task.controller.signal.aborted) {
          return;
        }

        if (notify) {
          setGenerationError(error instanceof Error ? error.message : t("generationErrorDefault"));
        }
      }
    }
  }

  function recoverActiveGenerationPolling(editor: Editor | null = editorRef.current): void {
    if (!editor) {
      return;
    }

    generationHistoryRef.current.forEach((record) => {
      const placeholderSet = placeholderSetForGenerationRecord(editor, record);
      if (isActiveGenerationRecord(record)) {
        startGenerationPolling(record, placeholderSet, { notify: false });
        return;
      }

      if (placeholderSet && isTerminalGenerationRecord(record)) {
        finishPolledGeneration(record, placeholderSet, false);
      }
    });
  }

  useEffect(() => {
    if (!isProjectLoaded) {
      return;
    }

    recoverActiveGenerationPolling();
  }, [generationHistory, isProjectLoaded]);

  async function executeGeneration(
    input: GenerationSubmitInput,
    requestMode: GenerationMode,
    resolveReference?: (signal: AbortSignal) => Promise<GenerationReferenceInput | undefined>,
    referenceAssetIds?: string[],
    references?: ReferenceSelectionItem[]
  ): Promise<void> {
    setGenerationError("");
    setGenerationMessage("");
    setGenerationWarning("");

    const inputValidationMessage = generationValidationMessage(input.prompt, input.size.width, input.size.height, t, locale);
    if (inputValidationMessage) {
      setGenerationWarning(inputValidationMessage);
      return;
    }

    const editor = editorRef.current;
    if (!editor) {
      setGenerationError(t("generationCanvasNotReady"));
      return;
    }

    requestGenerationNotificationPermission();

    const controller = new AbortController();
    const generationId = crypto.randomUUID();
    const placeholderSet = createGenerationPlaceholders(editor, input, generationId, {
      references: requestMode === "reference" ? references : undefined,
      selectPlaceholders: requestMode !== "reference"
    });
    const temporaryRecord = createTemporaryGenerationRecord({
      requestId: generationId,
      submitInput: input,
      requestMode,
      referenceAssetIds
    });

    activeGenerationsRef.current.set(generationId, {
      requestId: generationId,
      controller,
      placeholderSet
    });
    setActiveGenerationCount(activeGenerationsRef.current.size);
    upsertGenerationHistoryRecord(temporaryRecord, { promote: true });
    void saveProjectSnapshot(editor);

    try {
      const referenceForRequest = requestMode === "reference" ? await resolveReference?.(controller.signal) : undefined;
      if (requestMode === "reference" && (!referenceForRequest || referenceForRequest.referenceImages.length === 0)) {
        throw new Error(t("generationRequireReference", { max: MAX_REFERENCE_IMAGES }));
      }

      const requestBody: Record<string, unknown> = {
        clientRequestId: generationId,
        prompt: input.prompt.trim(),
        presetId: input.presetId,
        sizePresetId: input.sizePresetId,
        size: input.size,
        quality: input.quality,
        outputFormat: input.outputFormat,
        count: input.count
      };

      if (requestMode === "reference" && referenceForRequest) {
        requestBody.referenceImages = referenceForRequest.referenceImages;
        if (referenceForRequest.referenceAssetIds?.length) {
          requestBody.referenceAssetIds = referenceForRequest.referenceAssetIds;
        }
      }

      const response = await fetch(requestMode === "reference" ? "/api/images/edit" : "/api/images/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const body = (await response.json()) as unknown;
      if (!isGenerationResponse(body)) {
        throw new Error(t("generationInvalidResponse"));
      }

      if (controller.signal.aborted || !activeGenerationsRef.current.has(generationId)) {
        return;
      }

      upsertGenerationHistoryRecord(body.record);
      void saveProjectSnapshot(editor);
      if (isTerminalGenerationRecord(body.record)) {
        await preloadGenerationRecordPreviews(body.record, controller.signal);
        finishPolledGeneration(body.record, placeholderSet, true);
        if (activeGenerationsRef.current.delete(generationId)) {
          setActiveGenerationCount(activeGenerationsRef.current.size);
        }
        return;
      }

      void pollGenerationUntilComplete(generationId, true);
    } catch (error) {
      if (controller.signal.aborted || !activeGenerationsRef.current.has(generationId)) {
        return;
      }

      const message = error instanceof Error ? error.message : t("generationErrorDefault");
      try {
        const recoveredRecord = await fetchGenerationRecord(generationId, controller.signal);
        upsertGenerationHistoryRecord(recoveredRecord);
        if (isTerminalGenerationRecord(recoveredRecord)) {
          await preloadGenerationRecordPreviews(recoveredRecord, controller.signal);
          finishPolledGeneration(recoveredRecord, placeholderSet, true);
          if (activeGenerationsRef.current.delete(generationId)) {
            setActiveGenerationCount(activeGenerationsRef.current.size);
          }
          return;
        }

        void pollGenerationUntilComplete(generationId, true);
        return;
      } catch {
        if (controller.signal.aborted || !activeGenerationsRef.current.has(generationId)) {
          return;
        }
      }

      markGenerationPlaceholdersFailed(editor, placeholderSet, message);
      void saveProjectSnapshot(editor);
      setGenerationHistory((history) =>
        history.map((record) => (record.id === temporaryRecord.id ? { ...record, status: "failed", error: message } : record))
      );
      setGenerationError(message);
      if (activeGenerationsRef.current.delete(generationId)) {
        setActiveGenerationCount(activeGenerationsRef.current.size);
      }
    }
  }

  async function submitGeneration(): Promise<void> {
    const input: GenerationSubmitInput = {
      prompt: trimmedPrompt,
      presetId: stylePreset,
      sizePresetId,
      size: {
        width,
        height
      },
      quality,
      outputFormat,
      count
    };

    if (generationMode === "reference") {
      await executeGeneration(input, "reference", async (signal) => {
        if (referenceSelection.status !== "ready") {
          return undefined;
        }

        const referenceAssetIds = referenceAssetIdsForSelection(referenceSelection);

        return {
          referenceImages: await Promise.all(referenceSelection.references.map((reference) => readReferenceImage(reference, signal, t))),
          referenceAssetIds
        };
      }, referenceSelection.status === "ready"
        ? referenceAssetIdsForSelection(referenceSelection)
        : undefined, referenceSelection.status === "ready" ? referenceSelection.references : undefined);
      return;
    }

    await executeGeneration(input, "text");
  }

  function cancelReferenceSelection(): void {
    editorRef.current?.selectNone();
    setReferenceSelection(missingReferenceSelection(t));
    setGenerationError("");
    setGenerationMessage("");
    setGenerationWarning("");
  }

  function locateHistoryRecord(record: GenerationRecord): void {
    setGenerationError("");
    setGenerationMessage("");
    setGenerationWarning("");

    const editor = editorRef.current;
    if (!editor) {
      setGenerationError(t("generationCanvasNotReady"));
      return;
    }

    const shapeId = findCanvasImageShape(editor, record);
    if (!shapeId) {
      const activeTask = activeGenerationsRef.current.get(record.id);
      const recoveredPlaceholderSet = placeholderSetForGenerationRecord(editor, record);
      const placeholderId = activeTask
        ? firstLiveGenerationPlaceholder(editor, activeTask.placeholderSet)
        : recoveredPlaceholderSet
          ? firstLiveGenerationPlaceholder(editor, recoveredPlaceholderSet)
          : undefined;
      if (!placeholderId) {
        setGenerationError(t("generationHistoryImageMissing"));
        return;
      }

      const bounds = editor.getShapePageBounds(placeholderId);
      editor.select(placeholderId);
      if (bounds) {
        editor.zoomToBounds(bounds, {
          animation: { duration: 220 },
          inset: 96
        });
      } else {
        editor.zoomToSelection({ animation: { duration: 220 } });
      }
      setGenerationMessage(t("generationLocatePending"));
      return;
    }

    const bounds = editor.getShapePageBounds(shapeId);
    editor.select(shapeId);
    if (bounds) {
      editor.zoomToBounds(bounds, {
        animation: { duration: 220 },
        inset: 96
      });
    } else {
      editor.zoomToSelection({ animation: { duration: 220 } });
    }
    setGenerationMessage(t("generationLocateSucceeded"));
  }

  async function rerunHistoryRecord(record: GenerationRecord): Promise<void> {
    const nextPresetId = coerceStylePresetId(record.presetId);
    const nextSizePresetId = sizePresetIdForSize(record.size.width, record.size.height);
    const nextCount = coerceGenerationCount(record.count);

    setPrompt(record.prompt);
    setStylePreset(nextPresetId);
    setSizePresetId(nextSizePresetId);
    setWidth(record.size.width);
    setHeight(record.size.height);
    syncSizeSelection(record.size.width, record.size.height);
    setQuality(record.quality);
    setOutputFormat(record.outputFormat);
    setCount(nextCount);

    const referenceAssetIds = referenceAssetIdsForRecord(record);
    const nextGenerationMode: GenerationMode = referenceAssetIds.length > 0 ? "reference" : "text";
    setGenerationMode(nextGenerationMode);

    await executeGeneration(
      {
        prompt: record.prompt,
        presetId: nextPresetId,
        sizePresetId: nextSizePresetId,
        size: record.size,
        quality: record.quality,
        outputFormat: record.outputFormat,
        count: nextCount
      },
      nextGenerationMode,
      referenceAssetIds.length > 0
        ? async (signal) => ({
            referenceImages: await Promise.all(referenceAssetIds.map((referenceAssetId) => readStoredReferenceImage(referenceAssetId, signal, t))),
            referenceAssetIds
          })
        : undefined,
      referenceAssetIds.length > 0 ? referenceAssetIds : undefined
    );
  }

  function downloadHistoryRecord(record: GenerationRecord): void {
    const asset = firstDownloadableAsset(record);
    setGenerationWarning("");
    if (!asset) {
      setGenerationError(t("generationDownloadNoAsset"));
      return;
    }

    window.open(assetDownloadUrl(asset.id), "_blank", "noopener,noreferrer");
    setGenerationMessage(t("generationDownloadOpened"));
  }

  function reuseGalleryImage(item: GalleryImageItem): void {
    const nextPresetId = coerceStylePresetId(item.presetId);
    const nextSizePresetId = sizePresetIdForSize(item.size.width, item.size.height);

    setPrompt(item.prompt);
    setStylePreset(nextPresetId);
    setSizePresetId(nextSizePresetId);
    setWidth(item.size.width);
    setHeight(item.size.height);
    syncSizeSelection(item.size.width, item.size.height);
    setQuality(item.quality);
    setOutputFormat(item.outputFormat);
    setCount(1);
    setGenerationMode("text");
    setGenerationError("");
    setGenerationWarning("");
    setGenerationMessage(t("generationGalleryReused"));
    navigateToRoute("canvas");
    if (isMobileDrawer) {
      setIsAiPanelOpen(true);
    }
  }

  function removeGalleryOutputFromHistory(outputId: string): void {
    setGenerationHistory((history) =>
      history.flatMap((record) => {
        const nextOutputs = record.outputs.filter((output) => output.id !== outputId);
        if (nextOutputs.length === record.outputs.length) {
          return [record];
        }
        if (nextOutputs.length === 0) {
          return [];
        }
        return [
          {
            ...record,
            outputs: nextOutputs
          }
        ];
      })
    );
  }

  async function deleteGalleryRecordsForCanvasAssetIds(assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    try {
      const response = await fetch("/api/gallery/assets", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ assetIds })
      });

      if (!response.ok) {
        return;
      }

      const body = (await response.json()) as unknown;
      if (!isRecord(body) || !Array.isArray(body.deletedOutputIds)) {
        return;
      }

      body.deletedOutputIds
        .filter((outputId): outputId is string => typeof outputId === "string")
        .forEach(removeGalleryOutputFromHistory);
    } catch {
      // Canvas deletion should not be blocked if Gallery cleanup cannot be reached.
    }
  }

  async function copyHistoryPrompt(record: GenerationRecord): Promise<void> {
    const promptText = record.prompt.trim();
    setGenerationError("");
    setGenerationMessage("");
    setGenerationWarning("");

    if (!promptText) {
      setGenerationError(t("generationMissingPromptHistory"));
      return;
    }

    try {
      await writeClipboardText(promptText);
      setGenerationMessage(t("generationCopiedPrompt"));
    } catch {
      setGenerationError(t("generationCopyFailed"));
    }
  }

  async function cancelGeneration(requestId: string): Promise<void> {
    const task = activeGenerationsRef.current.get(requestId);
    if (!task) {
      return;
    }

    setGenerationError("");
    setGenerationWarning("");

    try {
      const response = await fetch(`/api/generations/${encodeURIComponent(requestId)}/cancel`, {
        method: "POST"
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const body = (await response.json()) as unknown;
      if (!isGenerationResponse(body)) {
        throw new Error(t("generationInvalidResponse"));
      }

      task.controller.abort();
      const editor = editorRef.current;
      if (editor) {
        markGenerationPlaceholdersFailed(editor, task.placeholderSet, body.record.error ?? t("generationUnknownCancel"));
        void saveProjectSnapshot(editor);
      }

      activeGenerationsRef.current.delete(requestId);
      setActiveGenerationCount(activeGenerationsRef.current.size);
      upsertGenerationHistoryRecord(body.record);
      setGenerationMessage(t("generationUnknownCancel"));
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : t("generationErrorDefault"));
    }
  }

  function ensureCurrentAgentConversationId(): string {
    const existingId = currentAgentConversationIdRef.current;
    if (existingId) {
      return existingId;
    }

    const conversationId = createAgentConversationId();
    currentAgentConversationIdRef.current = conversationId;
    setCurrentAgentConversationId(conversationId);
    return conversationId;
  }

  async function saveAgentConversationNow(
    conversationId: string,
    messages: AgentChatMessage[],
    trace = agentTraceEntriesRef.current
  ): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    const requestId = agentHistorySaveRequestRef.current + 1;
    agentHistorySaveRequestRef.current = requestId;

    try {
      const response = await fetch(`/api/agent-conversations/${encodeURIComponent(conversationId)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: agentConversationTitle(messages),
          messages: conversationMessagesFromAgentChat(messages),
          trace
        })
      });

      if (!response.ok) {
        throw new Error(`Agent conversation save failed with ${response.status}`);
      }

      if (isAgentHistoryOpen && agentHistorySaveRequestRef.current === requestId) {
        void loadAgentHistorySummaries();
      }
    } catch {
      if (isAgentHistoryOpen && agentHistorySaveRequestRef.current === requestId) {
        setAgentHistoryError(t("agentHistorySaveFailed"));
      }
    }
  }

  function reusePromptPoolItem(item: PromptPoolItem): string | null {
    return createPromptPoolCanvasHandoffUrl(item);
  }

  async function loadPromptFavoriteState(signal?: AbortSignal): Promise<void> {
    try {
      const nextFavorites = await fetchPromptFavorites(signal);
      if (!signal?.aborted) {
        setPromptFavoriteGroups(nextFavorites.groups);
        setPromptFavoriteItems(nextFavorites.favorites);
      }
    } catch {
      if (!signal?.aborted) {
        setGenerationWarning((current) => current || t("favoriteLoadFailed"));
      }
    }
  }

  function toggleFavoritePanel(): void {
    const nextOpen = !isFavoritePanelOpen;
    setIsFavoritePanelOpen(nextOpen);
    if (nextOpen && isMobileDrawer) {
      setIsAiPanelOpen(false);
    }
  }

  function upsertPromptFavorite(favorite: PromptFavoriteItem): void {
    setPromptFavoriteItems((current) => [
      favorite,
      ...current.filter((item) => item.id !== favorite.id && item.sourceId !== favorite.sourceId)
    ]);
  }

  function reusePromptFavoriteItem(favorite: PromptFavoriteItem): void {
    const nextPreset = promptFavoriteSizePreset(favorite);

    setPrompt(favorite.prompt);
    setStylePreset("none");
    setSizePresetId(nextPreset.id);
    setWidth(nextPreset.width);
    setHeight(nextPreset.height);
    setQuality(DEFAULT_IMAGE_QUALITY);
    setOutputFormat("png");
    setCount(1);
    setGenerationMode("text");
    setPanelTab("manual");
    setGenerationError("");
    setGenerationWarning("");
    setGenerationMessage(t("generationFavoriteReused"));
    navigateToRoute("canvas");
    if (isMobileDrawer) {
      setIsFavoritePanelOpen(false);
      setIsAiPanelOpen(true);
    }

    void markPromptFavoriteUsed(favorite.id)
      .then(upsertPromptFavorite)
      .catch(() => undefined);
  }

  async function copyPromptFavoriteItem(favorite: PromptFavoriteItem): Promise<void> {
    try {
      await writeClipboardText(favorite.prompt);
      setGenerationError("");
      setGenerationMessage(t("generationCopiedPrompt"));
      window.clearTimeout(favoriteCopyTimerRef.current);
      setCopiedPromptFavoriteId(favorite.id);
      favoriteCopyTimerRef.current = window.setTimeout(() => {
        setCopiedPromptFavoriteId((current) => (current === favorite.id ? null : current));
      }, 1500);
    } catch {
      setGenerationError(t("generationCopyFailed"));
    }
  }

  async function removePromptFavoriteItem(favorite: PromptFavoriteItem): Promise<void> {
    try {
      await deletePromptFavorite(favorite.id);
      setPromptFavoriteItems((current) => current.filter((item) => item.id !== favorite.id));
      setCopiedPromptFavoriteId((current) => (current === favorite.id ? null : current));
    } catch {
      setGenerationError(t("favoriteCancelFailed"));
    }
  }

  async function loadAgentHistorySummaries(signal?: AbortSignal): Promise<void> {
    setIsAgentHistoryLoading(true);
    setAgentHistoryError("");

    try {
      const response = await fetch("/api/agent-conversations", { signal });
      if (!response.ok) {
        throw new Error(`Agent history load failed with ${response.status}`);
      }

      const body = (await response.json()) as AgentConversationListResponse;
      const conversations = Array.isArray(body.conversations) ? body.conversations : [];
      setAgentHistorySummaries(conversations);
      if (conversations.length === 0) {
        setSelectedAgentHistoryId(null);
        setSelectedAgentConversation(null);
        return;
      }

      const selectedId = selectedAgentHistoryId && conversations.some((conversation) => conversation.id === selectedAgentHistoryId)
        ? selectedAgentHistoryId
        : conversations[0]?.id;
      if (selectedId) {
        setSelectedAgentHistoryId(selectedId);
        await loadAgentConversationDetail(selectedId, signal);
      }
    } catch {
      if (!signal?.aborted) {
        setAgentHistoryError(t("agentHistoryLoadFailed"));
      }
    } finally {
      if (!signal?.aborted) {
        setIsAgentHistoryLoading(false);
      }
    }
  }

  async function loadAgentConversationDetail(conversationId: string, signal?: AbortSignal): Promise<void> {
    setIsAgentHistoryDetailLoading(true);
    setAgentHistoryError("");

    try {
      const response = await fetch(`/api/agent-conversations/${encodeURIComponent(conversationId)}`, { signal });
      if (!response.ok) {
        throw new Error(`Agent conversation load failed with ${response.status}`);
      }

      setSelectedAgentConversation((await response.json()) as AgentConversation);
    } catch {
      if (!signal?.aborted) {
        setSelectedAgentConversation(null);
        setAgentHistoryError(t("agentHistoryDetailLoadFailed"));
      }
    } finally {
      if (!signal?.aborted) {
        setIsAgentHistoryDetailLoading(false);
      }
    }
  }

  function openAgentHistoryDialog(): void {
    setIsAgentHistoryOpen(true);
    if (currentAgentConversationId && agentMessages.length > 0) {
      void saveAgentConversationNow(currentAgentConversationId, agentMessages);
    }
    void loadAgentHistorySummaries();
  }

  function closeAgentHistoryDialog(): void {
    setIsAgentHistoryOpen(false);
  }

  function selectAgentHistoryConversation(conversationId: string): void {
    setSelectedAgentHistoryId(conversationId);
    void loadAgentConversationDetail(conversationId);
  }

  function resetAgentRuntimeForConversation(): void {
    const socket = agentSocketRef.current;
    stopAgentSocketHeartbeat(socket ?? undefined);
    resetAgentSocketReconnectState();
    activeAgentRunIdRef.current = null;
    agentConnectionIdRef.current = null;
    agentSocketRef.current = null;
    agentSocketOpenPromiseRef.current = null;

    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close(1000, "agent_conversation_reset");
    }

    pendingAgentSelectedReferencesRef.current.clear();
    agentPlanSelectedReferencesRef.current.clear();
    agentPlanCreatedRunIdsRef.current.clear();
    agentUserInputRunIdsRef.current.clear();
    agentOutputPlacementCountsRef.current.clear();
    deleteAgentJobLoadingPlaceholdersForRun();
    agentJobPlaceholdersRef.current.clear();
    clearCanvasAgentPlanNodes();
    setExpandedThinkingMessageIds([]);
    setCopiedAgentMessageId(null);
    setAgentTraceEntries([]);
    setIsAgentTraceOpen(false);
    setIsAgentTraceCopied(false);
    setAgentInput("");
    setIsAgentSettingsOpen(false);
    setAgentRunStatus("idle");
  }

  function restoreAgentConversation(conversation: AgentConversation): void {
    if (isAgentRunning) {
      return;
    }

    resetAgentRuntimeForConversation();
    currentAgentConversationIdRef.current = conversation.id;
    setCurrentAgentConversationId(conversation.id);
    setAgentMessages(agentChatMessagesFromConversation(conversation.messages));
    setAgentTraceEntries(conversation.trace ?? []);
    setIsAgentHistoryOpen(false);
  }

  function addAgentMessage(message: Omit<AgentChatMessage, "id" | "timestamp">): void {
    setAgentMessages((messages) => [
      ...messages,
      {
        ...message,
        id: `agent-message-${crypto.randomUUID()}`,
        timestamp: new Date().toISOString()
      }
    ]);
  }

  async function copyAgentMessage(message: AgentChatMessage): Promise<void> {
    const text = (message.role === "thinking" ? copyableThinkingMessageText(message) : message.content).trim();
    if (!text) {
      return;
    }

    try {
      await writeClipboardText(text);
      setCopiedAgentMessageId(message.id);
      if (agentCopyResetTimerRef.current !== undefined) {
        window.clearTimeout(agentCopyResetTimerRef.current);
      }
      agentCopyResetTimerRef.current = window.setTimeout(() => {
        setCopiedAgentMessageId((currentId) => (currentId === message.id ? null : currentId));
        agentCopyResetTimerRef.current = undefined;
      }, 1600);
    } catch {
      addAgentMessage({
        role: "error",
        content: t("agentCopyMessageFailed")
      });
    }
  }

  function recordAgentTraceEntry(entry: AgentTraceEntry): void {
    setAgentTraceEntries((currentEntries) => {
      const lastEntry = currentEntries[currentEntries.length - 1];
      const nextEntries =
        lastEntry && isMergeableStreamTraceEntry(lastEntry, entry)
          ? [...currentEntries.slice(0, -1), mergeStreamTraceEntry(lastEntry, entry)]
          : [...currentEntries, entry];
      const boundedEntries = nextEntries.slice(-AGENT_TRACE_ENTRY_LIMIT);
      agentTraceEntriesRef.current = boundedEntries;
      return boundedEntries;
    });
  }

  function recordAgentClientMessageTrace(message: Record<string, unknown>, label?: string): void {
    if (message.type === "ping") {
      return;
    }

    recordAgentTraceEntry(agentTraceEntryFromClientMessage(message, label));
  }

  function recordAgentServerEventTrace(event: AgentServerEvent): void {
    if (event.type === "pong") {
      return;
    }

    recordAgentTraceEntry(agentTraceEntryFromServerEvent(event));
  }

  async function copyAgentTrace(): Promise<void> {
    try {
      await writeClipboardText(
        agentTraceExport({
          conversationId: currentAgentConversationId,
          messages: conversationMessagesFromAgentChat(agentMessages),
          trace: agentTraceEntriesRef.current
        })
      );
      setIsAgentTraceCopied(true);
      window.clearTimeout(agentTraceCopyResetTimerRef.current);
      agentTraceCopyResetTimerRef.current = window.setTimeout(() => {
        setIsAgentTraceCopied(false);
        agentTraceCopyResetTimerRef.current = undefined;
      }, 1600);
    } catch {
      addAgentMessage({
        role: "error",
        content: t("agentTraceCopyFailed")
      });
    }
  }

  async function copyAgentConversationTrace(conversation: AgentConversation): Promise<void> {
    try {
      await writeClipboardText(
        agentTraceExport({
          conversationId: conversation.id,
          title: conversation.title,
          messages: conversation.messages,
          trace: conversation.trace ?? []
        })
      );
    } catch {
      setAgentHistoryError(t("agentTraceCopyFailed"));
    }
  }

  function toggleThinkingMessage(messageId: string): void {
    setExpandedThinkingMessageIds((currentIds) =>
      currentIds.includes(messageId) ? currentIds.filter((id) => id !== messageId) : [...currentIds, messageId]
    );
  }

  function isAgentStreamEventForActiveRun(event: Pick<AgentServerEvent, "runId">): boolean {
    const activeRunId = activeAgentRunIdRef.current;
    return Boolean(activeRunId && (!event.runId || event.runId === activeRunId));
  }

  function isStaleAgentRunEvent(event: Pick<AgentServerEvent, "runId">): boolean {
    const activeRunId = activeAgentRunIdRef.current;
    return Boolean(event.runId && (!activeRunId || event.runId !== activeRunId));
  }

  function runIdForAgentEvent(event: Pick<AgentServerEvent, "runId">): string | undefined {
    return event.runId ?? activeAgentRunIdRef.current ?? undefined;
  }

  function appendAgentStreamDelta(role: Extract<AgentChatMessageRole, "assistant" | "thinking">, delta: string, runId?: string): void {
    if (!delta) {
      return;
    }

    setAgentMessages((messages) => {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === role && !lastMessage.plan && lastMessage.runId === runId) {
        if (!lastMessage.content && !delta.trim()) {
          return messages;
        }

        return [
          ...messages.slice(0, -1),
          {
            ...lastMessage,
            content: `${lastMessage.content}${delta}`
          }
        ];
      }

      if (!delta.trim()) {
        return messages;
      }

      return [
        ...messages,
        {
          id: `agent-message-${crypto.randomUUID()}`,
          role,
          content: delta,
          timestamp: new Date().toISOString(),
          runId
        }
      ];
    });
  }

  function appendAgentAssistantDelta(delta: string, runId?: string): void {
    appendAgentStreamDelta("assistant", delta, runId);
  }

  function upsertAgentThinkingSummary(runId?: string): void {
    const content =
      locale === "zh-CN"
        ? "正在分析任务，整理生图计划与确认节点。"
        : "Reviewing the request and shaping a generation plan with confirmation steps.";
    setAgentMessages((messages) => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role !== "thinking" || message.plan || message.runId !== runId) {
          continue;
        }

        if (message.content === content) {
          return messages;
        }

        return messages.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                content
              }
            : item
        );
      }

      return [
        ...messages,
        {
          id: `agent-message-${crypto.randomUUID()}`,
          role: "thinking",
          content,
          timestamp: new Date().toISOString(),
          runId
        }
      ];
    });
  }

  function appendAgentThinkingDelta(delta: string, runId?: string): void {
    if (!delta.trim()) {
      return;
    }
    upsertAgentThinkingSummary(runId);
  }

  function appendAgentThinkingDetailsDelta(delta: string, runId?: string): void {
    if (!delta.trim()) {
      return;
    }

    if (!AGENT_TRACE_DEBUG_ENABLED) {
      upsertAgentThinkingSummary(runId);
      return;
    }

    const content = agentThinkingSummaryText(locale);
    const deltaLength = delta.length;
    setAgentMessages((messages) => {
      let existingIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role !== "thinking" || message.plan || message.runId !== runId) {
          continue;
        }

        existingIndex = index;
        break;
      }

      if (existingIndex >= 0) {
        return messages.map((message, index) =>
          index === existingIndex ? { ...message, content, details: agentThinkingDetailsSummary(locale, reasoningDetailsCharacterCount(message.details) + deltaLength) } : message
        );
      }

      return [
        ...messages,
        {
          id: `agent-message-${crypto.randomUUID()}`,
          role: "thinking",
          content,
          details: agentThinkingDetailsSummary(locale, deltaLength),
          timestamp: new Date().toISOString(),
          runId
        }
      ];
    });
  }

  function upsertAgentPlanAttachment(
    plan: GenerationPlan,
    fallbackContent: string,
    runId?: string,
    selectedReferences?: AgentSelectedCanvasReference[]
  ): void {
    setAgentMessages((messages) => {
      let existingIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const existingPlan = messages[index]?.plan;
        if (isGenerationPlan(existingPlan) && existingPlan.id === plan.id) {
          existingIndex = index;
          break;
        }
      }
      if (existingIndex >= 0) {
        return messages.map((message, index) =>
          index === existingIndex
            ? {
                ...message,
                role: "plan",
                content: fallbackContent,
                plan,
                runId: message.runId ?? runId
              }
            : message
        );
      }

      return [
        ...messages,
        {
          id: `agent-message-${crypto.randomUUID()}`,
          role: "plan",
          content: fallbackContent,
          timestamp: new Date().toISOString(),
          runId,
          plan
        }
      ];
    });
  }

  function agentJobPlaceholderKey(planId: string, jobId: string): string {
    return `${planId}::${jobId}`;
  }

  function createAgentJobPlaceholderSet(editor: Editor, plan: GenerationPlan, job: GenerationJob, runId?: string): AgentJobPlaceholderSet | undefined {
    if (job.count <= 0) {
      return undefined;
    }

    const placementKey = plan.id;
    const placementIndex = agentOutputPlacementCountsRef.current.get(placementKey) ?? 0;
    agentOutputPlacementCountsRef.current.set(placementKey, placementIndex + job.count);
    agentPlaceholderRequestRef.current += 1;

    const targetSize = job.size ?? plan.defaults.size;
    const layout = agentPlanOutputLayout(plan);
    const placements = Array.from({ length: job.count }, (_, index) => agentOutputPlacementForSize(editor, targetSize, placementIndex + index, layout));
    const placeholderSet = createGenerationPlaceholdersFromPlacements(editor, placements, `agent-${agentPlaceholderRequestRef.current}`, {
      selectPlaceholders: false
    });
    const agentPlaceholderSet: AgentJobPlaceholderSet = {
      planId: plan.id,
      jobId: job.id,
      runId,
      placeholderSet,
      outputSlots: new Map()
    };

    agentJobPlaceholdersRef.current.set(agentJobPlaceholderKey(plan.id, job.id), agentPlaceholderSet);
    return agentPlaceholderSet;
  }

  function ensureAgentJobPlaceholders(plan: GenerationPlan, job: GenerationJob, runId?: string): void {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const key = agentJobPlaceholderKey(plan.id, job.id);
    const existingSet = agentJobPlaceholdersRef.current.get(key);
    if (existingSet && hasLoadingGenerationPlaceholders(editor, existingSet.placeholderSet)) {
      return;
    }

    createAgentJobPlaceholderSet(editor, plan, job, runId);
  }

  function nextLiveAgentPlaceholderIndex(editor: Editor, agentPlaceholderSet: AgentJobPlaceholderSet): number | undefined {
    for (let index = 0; index < agentPlaceholderSet.placeholderSet.placements.length; index += 1) {
      const placement = agentPlaceholderSet.placeholderSet.placements[index];
      if (placement && isGenerationPlaceholderShape(editor.getShape(placement.id))) {
        return index;
      }
    }

    return undefined;
  }

  function replaceAgentPlaceholderAtIndex(
    editor: Editor,
    agentPlaceholderSet: AgentJobPlaceholderSet,
    index: number,
    asset: GeneratedAsset,
    altText: string
  ): TLShapeId | undefined {
    const placement = agentPlaceholderSet.placeholderSet.placements[index];
    if (!placement || !isGenerationPlaceholderShape(editor.getShape(placement.id))) {
      return undefined;
    }

    const imageShape = createImageShape(asset, livePlacement(editor, placement), altText);
    const assetRecordId = createTldrawAssetId(asset.id);

    editor.run(() => {
      editor.deleteShapes([placement.id]);
      if (!editor.getAsset(assetRecordId)) {
        editor.createAssets([createImageAsset(asset)]);
      }
      editor.createShapes([imageShape]);
      editor.bringToFront([imageShape.id]);
    });

    return imageShape.id;
  }

  function replaceAgentPlaceholderWithAsset(event: Extract<AgentServerEvent, { type: "asset_preview" }>): TLShapeId | undefined {
    const editor = editorRef.current;
    if (!editor) {
      return undefined;
    }

    const key = agentJobPlaceholderKey(event.planId, event.jobId);
    const agentPlaceholderSet = agentJobPlaceholdersRef.current.get(key);
    if (!agentPlaceholderSet) {
      return undefined;
    }

    const existingSlot = agentPlaceholderSet.outputSlots.get(event.outputId);
    const outputIndex = existingSlot ?? nextLiveAgentPlaceholderIndex(editor, agentPlaceholderSet);
    if (outputIndex === undefined) {
      return undefined;
    }

    agentPlaceholderSet.outputSlots.set(event.outputId, outputIndex);
    return replaceAgentPlaceholderAtIndex(editor, agentPlaceholderSet, outputIndex, event.asset, `${event.jobId}: ${event.asset.fileName}`);
  }

  function finishAgentJobPlaceholdersFromOutputs(event: Extract<AgentServerEvent, { type: "job_completed" }>): void {
    const editor = editorRef.current;
    if (!editor || !event.outputs) {
      return;
    }

    const key = agentJobPlaceholderKey(event.planId, event.jobId);
    const agentPlaceholderSet = agentJobPlaceholdersRef.current.get(key);
    if (!agentPlaceholderSet) {
      return;
    }

    event.outputs.forEach((output, index) => {
      if (output.status !== "succeeded" || !output.asset) {
        return;
      }

      const outputIndex = agentPlaceholderSet.outputSlots.get(output.id) ?? index;
      replaceAgentPlaceholderAtIndex(editor, agentPlaceholderSet, outputIndex, output.asset, `${event.jobId}: ${output.asset.fileName}`);
    });
    deleteLoadingGenerationPlaceholders(editor, agentPlaceholderSet.placeholderSet);
    agentJobPlaceholdersRef.current.delete(key);
  }

  function markAgentJobPlaceholdersFailed(planId: string, jobId: string, error: string): void {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const key = agentJobPlaceholderKey(planId, jobId);
    const agentPlaceholderSet = agentJobPlaceholdersRef.current.get(key);
    if (!agentPlaceholderSet) {
      return;
    }

    markGenerationPlaceholdersFailed(editor, agentPlaceholderSet.placeholderSet, error);
    agentJobPlaceholdersRef.current.delete(key);
  }

  function deleteAgentJobLoadingPlaceholdersForRun(runId?: string): void {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    agentJobPlaceholdersRef.current.forEach((agentPlaceholderSet, key) => {
      if (runId && agentPlaceholderSet.runId !== runId) {
        return;
      }

      deleteLoadingGenerationPlaceholders(editor, agentPlaceholderSet.placeholderSet);
      agentJobPlaceholdersRef.current.delete(key);
    });
  }

  function syncAgentJobPlaceholdersForPlan(plan: GenerationPlan, runId?: string): void {
    plan.jobs.forEach((job) => {
      if (job.status === "running") {
        ensureAgentJobPlaceholders(plan, job, runId);
        return;
      }

      if (job.status === "failed") {
        markAgentJobPlaceholdersFailed(plan.id, job.id, job.error ?? t("generationErrorDefault"));
        return;
      }

      if (job.status === "blocked") {
        markAgentJobPlaceholdersFailed(plan.id, job.id, job.error ?? t("agentPlanJobStatusLabel", { status: job.status }));
        return;
      }

      if (job.status === "cancelled") {
        const editor = editorRef.current;
        const key = agentJobPlaceholderKey(plan.id, job.id);
        const agentPlaceholderSet = agentJobPlaceholdersRef.current.get(key);
        if (editor && agentPlaceholderSet) {
          deleteLoadingGenerationPlaceholders(editor, agentPlaceholderSet.placeholderSet);
          agentJobPlaceholdersRef.current.delete(key);
        }
      }
    });
  }

  function addAgentOutputAssetToCanvas(event: Extract<AgentServerEvent, { type: "asset_preview" }>): TLShapeId | undefined {
    const editor = editorRef.current;
    if (!editor) {
      return undefined;
    }

    const existingShapeId = findCanvasImageShapeByAssetId(editor, event.assetId, optionalShapeIdFromEvent(event));
    if (existingShapeId) {
      return existingShapeId;
    }

    const placeholderShapeId = replaceAgentPlaceholderWithAsset(event);
    if (placeholderShapeId) {
      return placeholderShapeId;
    }

    const placementKey = event.planId || event.runId || "agent";
    const placementIndex = agentOutputPlacementCountsRef.current.get(placementKey) ?? 0;
    agentOutputPlacementCountsRef.current.set(placementKey, placementIndex + 1);

    const imageShape = createImageShape(
      event.asset,
      agentOutputPlacement(editor, event.planId, event.asset, placementIndex),
      `${event.jobId}: ${event.asset.fileName}`
    );
    const assetRecordId = createTldrawAssetId(event.asset.id);

    editor.run(() => {
      if (!editor.getAsset(assetRecordId)) {
        editor.createAssets([createImageAsset(event.asset)]);
      }
      editor.createShapes([imageShape]);
      editor.bringToFront([imageShape.id]);
    });

    return imageShape.id;
  }

  function addAgentAssetPreview(event: Extract<AgentServerEvent, { type: "asset_preview" }>): void {
    const shapeId = addAgentOutputAssetToCanvas(event);
    const preview: AgentChatAssetPreview = {
      id: `agent-preview-${event.jobId}-${event.assetId}-${crypto.randomUUID()}`,
      assetId: event.assetId,
      jobId: event.jobId,
      outputId: event.outputId,
      planId: event.planId,
      shapeId,
      url: event.url
    };

    setAgentMessages((messages) => {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === "assistant" && lastMessage.previews && lastMessage.runId === event.runId) {
        return [
          ...messages.slice(0, -1),
          {
            ...lastMessage,
            previews: [...lastMessage.previews, preview]
          }
        ];
      }

      return [
        ...messages,
        {
          id: `agent-message-${crypto.randomUUID()}`,
          role: "assistant",
          content: t("agentPreviewReady"),
          timestamp: new Date().toISOString(),
          runId: event.runId,
          previews: [preview]
        }
      ];
    });
  }

  function clearCanvasAgentPlanNodes(planId?: string): void {
    const editor = editorRef.current;
    if (planId) {
      agentOutputPlacementCountsRef.current.delete(planId);
    }
    if (editor) {
      deleteAgentPlanNodes(editor);
    }
  }

  function agentContextIndexesLabel(indexes: number[]): string {
    if (indexes.length === 0) {
      return "";
    }

    const isConsecutive = indexes.every((index, itemIndex) => itemIndex === 0 || index === indexes[itemIndex - 1] + 1);
    if (isConsecutive && indexes.length > 4) {
      return `${indexes[0]}-${indexes[indexes.length - 1]}`;
    }

    return indexes.length <= 4 ? indexes.join(", ") : `${indexes.slice(0, 4).join(", ")}...`;
  }

  function handleAgentServerEvent(event: AgentServerEvent): void {
    switch (event.type) {
      case "context_resolved":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        addAgentMessage({
          role: "system",
          content: t("agentContextResolvedPreviousOutputs", {
            count: event.referenceCount,
            indexes: agentContextIndexesLabel(event.referenceIndexes)
          }),
          runId: runIdForAgentEvent(event)
        });
        return;
      case "assistant_delta":
        if (!isAgentStreamEventForActiveRun(event)) {
          return;
        }
        appendAgentAssistantDelta(event.delta, runIdForAgentEvent(event));
        return;
      case "assistant_thinking_delta":
        if (!isAgentStreamEventForActiveRun(event)) {
          return;
        }
        appendAgentThinkingDetailsDelta(event.delta, runIdForAgentEvent(event));
        return;
      case "tool_call":
        return;
      case "plan_created":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        if (!isGenerationPlan(event.plan)) {
          addAgentMessage({
            role: "error",
            content: t("agentInvalidEvent"),
            runId: runIdForAgentEvent(event)
          });
          return;
        }
        {
          const eventRunId = runIdForAgentEvent(event);
          if (eventRunId) {
            agentPlanCreatedRunIdsRef.current.add(eventRunId);
          }
          const selectedReferences = event.runId ? pendingAgentSelectedReferencesRef.current.get(event.runId) : undefined;
          if (event.runId) {
            pendingAgentSelectedReferencesRef.current.delete(event.runId);
          }
          if (selectedReferences) {
            agentPlanSelectedReferencesRef.current.set(event.plan.id, selectedReferences);
          }
          clearCanvasAgentPlanNodes(event.plan.id);
          upsertAgentPlanAttachment(
            event.plan,
            t("agentPlanCreated", { title: event.plan.title }),
            eventRunId,
            selectedReferences ?? agentPlanSelectedReferencesRef.current.get(event.plan.id)
          );
        }
        return;
      case "plan_updated":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        if (!isGenerationPlan(event.plan)) {
          addAgentMessage({
            role: "error",
            content: t("agentInvalidEvent"),
            runId: runIdForAgentEvent(event)
          });
          return;
        }
        clearCanvasAgentPlanNodes();
        syncAgentJobPlaceholdersForPlan(event.plan, runIdForAgentEvent(event));
        upsertAgentPlanAttachment(
          event.plan,
          t("agentPlanUpdated", { title: event.plan.title }),
          runIdForAgentEvent(event),
          agentPlanSelectedReferencesRef.current.get(event.plan.id)
        );
        return;
      case "asset_preview":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        addAgentAssetPreview(event);
        return;
      case "job_started":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        addAgentMessage({
          role: "system",
          content: t("agentJobStarted", { jobId: event.jobId }),
          runId: runIdForAgentEvent(event)
        });
        return;
      case "job_completed":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        if (event.record) {
          setGenerationHistory((history) =>
            [event.record as GenerationRecord, ...history.filter((record) => record.id !== event.record?.id)].slice(0, 20)
          );
        }
        finishAgentJobPlaceholdersFromOutputs(event);
        addAgentMessage({
          role: "system",
          content: t("agentJobCompleted", { jobId: event.jobId }),
          runId: runIdForAgentEvent(event)
        });
        return;
      case "job_failed":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        markAgentJobPlaceholdersFailed(event.planId, event.jobId, event.error);
        addAgentMessage({
          role: "error",
          content: t("agentJobFailed", { jobId: event.jobId, error: event.error }),
          runId: runIdForAgentEvent(event)
        });
        return;
      case "job_blocked":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        markAgentJobPlaceholdersFailed(event.planId, event.jobId, event.reason);
        addAgentMessage({
          role: "error",
          content: t("agentJobBlocked", { jobId: event.jobId, reason: event.reason }),
          runId: runIdForAgentEvent(event)
        });
        return;
      case "error":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        if (event.runId) {
          pendingAgentSelectedReferencesRef.current.delete(event.runId);
        }
        {
          const eventRunId = runIdForAgentEvent(event);
          const shouldAskUser = event.recoverable && isAgentUserInputErrorCode(event.code);
          if (shouldAskUser && eventRunId) {
            agentUserInputRunIdsRef.current.add(eventRunId);
          }
        addAgentMessage({
          role: shouldAskUser ? "question" : "error",
          content: localizedApiErrorMessage({
            code: event.code,
            fallbackMessage: event.message,
            fallbackText: event.message,
            includeHttpSuffix: false,
            locale,
            status: 400
          }),
          runId: eventRunId
        });
        }
        deleteAgentJobLoadingPlaceholdersForRun(event.runId);
        if (event.runId && activeAgentRunIdRef.current === event.runId) {
          activeAgentRunIdRef.current = null;
          setAgentRunStatus("idle");
          resetAgentSocketReconnectState();
        }
        return;
      case "run_cancelled":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        if (event.runId) {
          pendingAgentSelectedReferencesRef.current.delete(event.runId);
        }
        activeAgentRunIdRef.current = null;
        setAgentRunStatus("idle");
        resetAgentSocketReconnectState();
        deleteAgentJobLoadingPlaceholdersForRun(event.runId);
        addAgentMessage({
          role: "system",
          content: event.alreadyCancelled ? t("agentRunAlreadyCancelled") : t("agentRunCancelled"),
          runId: runIdForAgentEvent(event)
        });
        return;
      case "run_done":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        if (event.runId) {
          pendingAgentSelectedReferencesRef.current.delete(event.runId);
        }
        if (!event.runId || activeAgentRunIdRef.current === event.runId) {
          activeAgentRunIdRef.current = null;
          setAgentRunStatus("idle");
          resetAgentSocketReconnectState();
        }
        if (event.status === "cancelled") {
          deleteAgentJobLoadingPlaceholdersForRun(event.runId);
        }
        {
          const eventRunId = runIdForAgentEvent(event);
          if (event.status === "succeeded" && eventRunId && agentPlanCreatedRunIdsRef.current.delete(eventRunId)) {
            return;
          }
          if (event.status === "failed" && eventRunId && agentUserInputRunIdsRef.current.delete(eventRunId)) {
            return;
          }
        addAgentMessage({
          role: event.status === "succeeded" ? "system" : "error",
          content: t("agentRunDone", { status: event.status }),
          runId: eventRunId
        });
        }
        return;
      case "connected":
        agentConnectionIdRef.current = event.connectionId;
        return;
      case "pong":
      default:
        return;
    }
  }

  function clearAgentSocketReconnectTimer(): void {
    window.clearTimeout(agentSocketReconnectTimerRef.current);
    agentSocketReconnectTimerRef.current = undefined;
  }

  function resetAgentSocketReconnectState(): void {
    clearAgentSocketReconnectTimer();
    agentSocketReconnectDeadlineRef.current = undefined;
    agentSocketReconnectDelayRef.current = AGENT_SOCKET_RECONNECT_INITIAL_MS;
  }

  function failAgentSocketReconnect(runId: string): void {
    if (activeAgentRunIdRef.current !== runId) {
      return;
    }

    activeAgentRunIdRef.current = null;
    setAgentRunStatus("idle");
    stopAgentSocketHeartbeat();
    resetAgentSocketReconnectState();
    deleteAgentJobLoadingPlaceholdersForRun(runId);
    addAgentMessage({
      role: "error",
      content: t("agentSocketClosed"),
      runId
    });
  }

  function scheduleAgentSocketReconnect(runId: string): void {
    clearAgentSocketReconnectTimer();
    if (activeAgentRunIdRef.current !== runId) {
      return;
    }

    const now = Date.now();
    const deadline = agentSocketReconnectDeadlineRef.current ?? now + AGENT_SOCKET_RECONNECT_WINDOW_MS;
    agentSocketReconnectDeadlineRef.current = deadline;
    const remainingMs = deadline - now;
    if (remainingMs <= 0) {
      failAgentSocketReconnect(runId);
      return;
    }

    setAgentRunStatus("connecting");
    const delayMs = Math.min(agentSocketReconnectDelayRef.current, remainingMs);
    agentSocketReconnectTimerRef.current = window.setTimeout(() => {
      agentSocketReconnectTimerRef.current = undefined;
      if (activeAgentRunIdRef.current !== runId) {
        return;
      }

      void ensureAgentSocket()
        .then(() => {
          if (activeAgentRunIdRef.current === runId) {
            setAgentRunStatus("running");
          }
        })
        .catch(() => {
          if (activeAgentRunIdRef.current !== runId) {
            return;
          }
          agentSocketReconnectDelayRef.current = Math.min(agentSocketReconnectDelayRef.current * 2, AGENT_SOCKET_RECONNECT_MAX_MS);
          scheduleAgentSocketReconnect(runId);
        });
    }, delayMs);
  }

  function ensureAgentSocket(): Promise<WebSocket> {
    const existingSocket = agentSocketRef.current;
    if (existingSocket?.readyState === WebSocket.OPEN) {
      startAgentSocketHeartbeat(existingSocket);
      return Promise.resolve(existingSocket);
    }
    if (existingSocket?.readyState === WebSocket.CONNECTING && agentSocketOpenPromiseRef.current) {
      return agentSocketOpenPromiseRef.current;
    }

    setAgentRunStatus("connecting");
    const socket = new WebSocket(
      agentWebSocketUrl(agentConnectionIdRef.current, activeAgentRunIdRef.current, currentAgentConversationIdRef.current)
    );
    agentSocketRef.current = socket;

    const openPromise = new Promise<WebSocket>((resolve, reject) => {
      let settled = false;

      socket.onopen = () => {
        resetAgentSocketReconnectState();
        startAgentSocketHeartbeat(socket);
        settled = true;
        resolve(socket);
      };
      socket.onmessage = (messageEvent) => {
        const event = parseAgentServerEvent(messageEvent.data);
        if (!event) {
          addAgentMessage({
            role: "error",
            content: t("agentInvalidEvent")
          });
          return;
        }

        recordAgentServerEventTrace(event);
        handleAgentServerEvent(event);
      };
      socket.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error(t("agentSocketFailed")));
        } else if (!activeAgentRunIdRef.current) {
          addAgentMessage({
            role: "error",
            content: t("agentSocketFailed")
          });
        }
      };
      socket.onclose = () => {
        const isCurrentSocket = agentSocketRef.current === socket;
        if (isCurrentSocket) {
          agentSocketRef.current = null;
          agentSocketOpenPromiseRef.current = null;
        }
        stopAgentSocketHeartbeat(socket);
        if (!isCurrentSocket) {
          return;
        }
        if (!settled) {
          settled = true;
          reject(new Error(t("agentSocketFailed")));
          return;
        }
        const activeRunId = activeAgentRunIdRef.current;
        if (activeRunId) {
          scheduleAgentSocketReconnect(activeRunId);
        }
      };
    });

    agentSocketOpenPromiseRef.current = openPromise;
    return openPromise;
  }

  function startAgentSocketHeartbeat(socket: WebSocket): void {
    stopAgentSocketHeartbeat();
    agentSocketPingTimerRef.current = window.setInterval(() => {
      if (agentSocketRef.current !== socket || socket.readyState !== WebSocket.OPEN) {
        stopAgentSocketHeartbeat(socket);
        return;
      }

      const runId = activeAgentRunIdRef.current;
      const pingMessage: { type: "ping"; requestId: string; runId?: string } = {
        type: "ping",
        requestId: `agent-heartbeat-${runId ?? "idle"}-${Date.now()}`
      };
      if (runId) {
        pingMessage.runId = runId;
      }

      // Keep the Agent channel warm even when the browser throttles inactive UI work.
      socket.send(JSON.stringify(pingMessage));
    }, AGENT_SOCKET_PING_INTERVAL_MS);
  }

  function stopAgentSocketHeartbeat(socket?: WebSocket): void {
    if (socket && agentSocketRef.current && agentSocketRef.current !== socket) {
      return;
    }

    window.clearInterval(agentSocketPingTimerRef.current);
    agentSocketPingTimerRef.current = undefined;
  }

  function startNewAgentConversation(): void {
    if (isAgentRunning) {
      return;
    }

    if (currentAgentConversationId && agentMessages.length > 0) {
      void saveAgentConversationNow(currentAgentConversationId, agentMessages);
    }

    resetAgentRuntimeForConversation();
    const nextConversationId = createAgentConversationId();
    currentAgentConversationIdRef.current = nextConversationId;
    setCurrentAgentConversationId(nextConversationId);
    setAgentMessages([]);
  }

  function selectAgentSizePreset(nextPresetId: string): void {
    if (nextPresetId === CUSTOM_SIZE_PRESET_ID) {
      setAgentSizePresetId(CUSTOM_SIZE_PRESET_ID);
      return;
    }

    const preset = SIZE_PRESETS.find((item) => item.id === nextPresetId);
    if (!preset) {
      return;
    }

    setAgentSizePresetId(preset.id);
    setAgentWidth(preset.width);
    setAgentHeight(preset.height);
  }

  function updateAgentWidth(value: string): void {
    setAgentWidth(normalizeDimension(value));
    setAgentSizePresetId(CUSTOM_SIZE_PRESET_ID);
  }

  function updateAgentHeight(value: string): void {
    setAgentHeight(normalizeDimension(value));
    setAgentSizePresetId(CUSTOM_SIZE_PRESET_ID);
  }

  async function submitAgentMessage(): Promise<void> {
    if (!trimmedAgentInput || isAgentRunning) {
      return;
    }

    if (!isAgentConfigured) {
      addAgentMessage({
        role: "error",
        content: t("agentConfigMissingCopy")
      });
      return;
    }

    if (agentDefaultsValidationMessage) {
      addAgentMessage({
        role: "error",
        content: agentDefaultsValidationMessage
      });
      return;
    }

    const requestId = `agent-request-${agentRequestRef.current + 1}`;
    const runId = `agent-run-${crypto.randomUUID()}`;
    agentRequestRef.current += 1;
    ensureCurrentAgentConversationId();
    activeAgentRunIdRef.current = runId;
    setAgentInput("");
    setIsAgentSettingsOpen(false);
    addAgentMessage({
      role: "user",
      content: trimmedAgentInput,
      runId
    });

    try {
      let selectedReferences: AgentSelectedCanvasReference[] = [];
      if (agentReferenceSelection.references.length > 0) {
        selectedReferences = await buildAgentSelectedReferences({
          references: agentReferenceSelection.references,
          t
        });
      }

      pendingAgentSelectedReferencesRef.current.set(runId, selectedReferences);
      const socket = await ensureAgentSocket();
      const message = {
        type: "user_message",
        requestId,
        runId,
        text: trimmedAgentInput,
        defaults: agentDefaults,
        plannerOptions: supportsAgentThinkingControls ? agentPlannerOptions : undefined,
        selectedReferences,
        selectedReferenceIds: selectedReferences.map((reference) => reference.assetId)
      };
      recordAgentClientMessageTrace(message);
      socket.send(JSON.stringify(message));
      setAgentRunStatus("running");
    } catch (error) {
      pendingAgentSelectedReferencesRef.current.delete(runId);
      activeAgentRunIdRef.current = null;
      setAgentRunStatus("idle");
      stopAgentSocketHeartbeat();
      resetAgentSocketReconnectState();
      addAgentMessage({
        role: "error",
        content: error instanceof Error ? error.message : t("agentSendFailed")
      });
    }
  }

  function cancelAgentRun(): void {
    const runId = activeAgentRunIdRef.current;
    const socket = agentSocketRef.current;
    if (!runId || !socket || socket.readyState !== WebSocket.OPEN) {
      activeAgentRunIdRef.current = null;
      setAgentRunStatus("idle");
      stopAgentSocketHeartbeat();
      resetAgentSocketReconnectState();
      addAgentMessage({
        role: "system",
        content: t("agentRunCancelled")
      });
      return;
    }

    const message = {
      type: "cancel_run",
      requestId: `agent-cancel-${crypto.randomUUID()}`,
      runId
    };
    recordAgentClientMessageTrace(message);
    socket.send(JSON.stringify(message));
  }

  async function sendAgentPlanAction(plan: GenerationPlan, action: AgentPlanAction): Promise<void> {
    if (action === "cancel") {
      try {
        const runId = activeAgentRunIdRef.current || undefined;
        const socket = agentSocketRef.current?.readyState === WebSocket.OPEN ? agentSocketRef.current : await ensureAgentSocket();
        const message = {
          type: "cancel_run",
          requestId: `agent-plan-cancel-${crypto.randomUUID()}`,
          runId
        };
        recordAgentClientMessageTrace(message, "cancel_plan_run");
        socket.send(JSON.stringify(message));
      } catch (error) {
        addAgentMessage({
          role: "error",
          content: error instanceof Error ? error.message : t("agentSocketFailed")
        });
      }
      return;
    }

    if (isAgentRunning) {
      addAgentMessage({
        role: "error",
        content: t("agentPlanActionBusy")
      });
      return;
    }

    if (!isAgentConfigured) {
      addAgentMessage({
        role: "error",
        content: t("agentConfigMissingCopy")
      });
      return;
    }

    const runId = `agent-plan-run-${crypto.randomUUID()}`;
    ensureCurrentAgentConversationId();
    activeAgentRunIdRef.current = runId;
    setAgentRunStatus("connecting");

    try {
      let selectedReferences = agentPlanSelectedReferencesRef.current.get(plan.id);
      if (!selectedReferences && agentReferenceSelection.references.length > 0) {
        selectedReferences = await buildAgentSelectedReferences({
          references: agentReferenceSelection.references,
          t
        });
      }
      const socket = await ensureAgentSocket();
      clearCanvasAgentPlanNodes();
      if (selectedReferences) {
        agentPlanSelectedReferencesRef.current.set(plan.id, selectedReferences);
      }
      const message = {
        type: action === "execute" ? "execute_plan" : "retry_failed",
        requestId: `agent-plan-action-${crypto.randomUUID()}`,
        runId,
        planId: plan.id,
        plan,
        selectedReferences
      };
      recordAgentClientMessageTrace(message);
      socket.send(JSON.stringify(message));
      setAgentRunStatus("running");
    } catch (error) {
      if (activeAgentRunIdRef.current === runId) {
        activeAgentRunIdRef.current = null;
      }
      setAgentRunStatus("idle");
      stopAgentSocketHeartbeat();
      resetAgentSocketReconnectState();
      addAgentMessage({
        role: "error",
        content: error instanceof Error ? error.message : t("agentSendFailed")
      });
    }
  }

  function locateAgentPreview(preview: AgentChatAssetPreview): void {
    const editor = editorRef.current;
    if (!editor) {
      addAgentMessage({
        role: "error",
        content: t("generationCanvasNotReady")
      });
      return;
    }

    const shapeId = findCanvasImageShapeByAssetId(editor, preview.assetId, preview.shapeId);
    if (!shapeId) {
      addAgentMessage({
        role: "system",
        content: t("agentPreviewShapePending")
      });
      return;
    }

    const bounds = editor.getShapePageBounds(shapeId);
    editor.select(shapeId);
    if (bounds) {
      editor.zoomToBounds(bounds, {
        animation: { duration: 220 },
        inset: 96
      });
    } else {
      editor.zoomToSelection({ animation: { duration: 220 } });
    }
  }

  return (
    <div className="app-root" data-canvas-theme={route !== "home" && route !== "pool" && isCanvasDarkMode ? "dark" : "light"}>
      <TopNavigation
        route={route}
        onNavigate={navigateToRoute}
        onOpenProviderConfig={() => setIsProviderConfigDialogOpen(true)}
        onPreloadGallery={preloadGalleryPage}
        onPreloadPool={preloadPromptPoolPage}
      />
      {route === "home" ? (
        <HomePage
          authError={authError}
          authStatus={authStatus}
          isAuthLoading={isAuthLoading}
          isCodexStarting={codexLoginStatus === "starting"}
          onOpenProviderConfig={() => setIsProviderConfigDialogOpen(true)}
          onOpenGallery={() => navigateToRoute("gallery")}
          onStartCodexLogin={startCodexLogin}
        />
      ) : null}
      <main className="app-shell app-view relative flex min-h-0 overflow-hidden bg-neutral-950 text-neutral-900" data-active-route={route} hidden={route !== "canvas"}>
      <section
        className="relative min-w-0 flex-1 bg-neutral-100 outline-none"
        aria-label={t("appCanvasAria")}
        data-testid="canvas-shell"
        ref={canvasShellRef}
        tabIndex={-1}
      >
        {isProjectLoaded ? (
          <Tldraw
            assets={canvasAssetStore}
            components={tldrawComponents}
            licenseKey={TLDRAW_LICENSE_KEY}
            options={tldrawOptions}
            snapshot={projectSnapshot}
            shapeUtils={shapeUtils}
            user={tldrawUser}
            onMount={handleEditorMount}
          />
        ) : (
          <div className="canvas-loading-state">
            <BrandMark className="brand-mark--large" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-800">{t("canvasLoadingTitle")}</p>
              <p className="mt-1 text-xs text-neutral-500">{t("appTagline")}</p>
            </div>
          </div>
        )}
      </section>

      {isMobileDrawer && isAiPanelOpen ? (
        <button
          aria-label={t("generationPanelClose")}
          className="ai-panel-backdrop"
          data-testid="ai-panel-backdrop"
          type="button"
          onClick={closeAiPanel}
        />
      ) : null}

      <button
        aria-controls="ai-panel"
        aria-expanded={isAiPanelOpen}
        aria-haspopup="dialog"
        className="mobile-ai-trigger"
        data-drawer-state={isAiPanelOpen ? "open" : "closed"}
        data-testid="open-ai-panel"
        type="button"
        onClick={() => setIsAiPanelOpen(true)}
      >
        <Sparkles className="size-4" aria-hidden="true" />
        {t("generationStartText")}
      </button>

      <PromptFavoritesFloatingPanel
        activeGroupId={favoritePanelGroupId}
        copiedFavoriteId={copiedPromptFavoriteId}
        favorites={visiblePromptFavorites}
        groupCounts={promptFavoriteGroupCounts}
        groups={promptFavoriteGroups}
        isMobile={isMobileDrawer}
        isOpen={isFavoritePanelOpen}
        query={favoritePanelQuery}
        totalCount={promptFavoriteItems.length}
        onChangeGroup={setFavoritePanelGroupId}
        onChangeQuery={setFavoritePanelQuery}
        onClose={() => setIsFavoritePanelOpen(false)}
        onCopy={(favorite) => void copyPromptFavoriteItem(favorite)}
        onRemove={(favorite) => void removePromptFavoriteItem(favorite)}
        onToggle={toggleFavoritePanel}
        onUse={reusePromptFavoriteItem}
        t={t}
      />

      <aside
        aria-label={t("generationPanelAria")}
        aria-modal={isMobileDrawer && isAiPanelOpen ? true : undefined}
        className="ai-panel fixed inset-y-0 right-0 z-20 flex flex-col border-l border-neutral-200 bg-white shadow-2xl shadow-neutral-950/15"
        data-drawer-state={isAiPanelOpen ? "open" : "closed"}
        data-testid="ai-panel"
        id="ai-panel"
        role={isMobileDrawer ? "dialog" : "complementary"}
        {...(isMobileDrawer && !isAiPanelOpen ? { inert: "" } : {})}
      >
        <div className="border-b border-neutral-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="brand-lockup">
              <BrandMark />
              <div className="min-w-0">
                <BrandName />
                <p className="brand-tagline">{t("appTagline")}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ProviderStatusPopover
                authError={authError}
                authStatus={authStatus}
                codexLoginStatus={codexLoginStatus}
                isAuthLoading={isAuthLoading}
                onLogoutCodex={logoutCodexSession}
                onStartCodexLogin={startCodexLogin}
              />
              <button
                aria-label={t("storageSettings")}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs transition focus:outline-none focus:ring-2 focus:ring-cyan-100 ${
                  storageConfig?.enabled
                    ? "border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100"
                    : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900"
                }`}
                data-testid="storage-settings-button"
                title={storageConfig?.enabled ? t("storageEnabledTitle") : t("storageSettings")}
                type="button"
                onClick={openStorageDialog}
              >
                <Cloud className="size-4" aria-hidden="true" />
              </button>
              <div
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium ${
                  saveStatus === "error" ? "bg-red-50 text-red-700" : "bg-neutral-100 text-neutral-600"
                }`}
                data-testid="save-status"
                role="status"
              >
                <SaveStatusIcon status={saveStatus} />
                {saveStatusLabel(saveStatus, t)}
              </div>
              <button
                aria-label={t("generationPanelClose")}
                className="ai-panel-close"
                ref={panelCloseButtonRef}
                type="button"
                onClick={closeAiPanel}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div
          className="panel-tab-switcher"
          data-active-tab={panelTab}
          data-testid="right-panel-tab-switcher"
          role="tablist"
          aria-label={t("panelTabAria")}
        >
          <button
            aria-selected={panelTab === "manual"}
            className={panelTab === "manual" ? "panel-tab-switcher__button is-active" : "panel-tab-switcher__button"}
            data-testid="panel-tab-manual"
            role="tab"
            type="button"
            onClick={() => setPanelTab("manual")}
          >
            {t("panelTabManual")}
          </button>
          <button
            aria-selected={panelTab === "agent"}
            className={panelTab === "agent" ? "panel-tab-switcher__button is-active" : "panel-tab-switcher__button"}
            data-testid="panel-tab-agent"
            role="tab"
            type="button"
            onClick={() => setPanelTab("agent")}
          >
            <Bot className="size-3.5" aria-hidden="true" />
            {t("panelTabAgent")}
          </button>
        </div>

        {panelTab === "manual" ? (
        <>
        <div className="ai-panel-body ai-panel-tab-panel ai-panel-tab-panel--body flex-1 space-y-5 overflow-y-auto px-5 py-5" data-tab="manual">
          {saveError ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="save-error">
              {saveError}
            </p>
          ) : null}

          <div data-testid="generation-mode-control">
            <span className="control-label">{t("generationModeLabel")}</span>
            <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label={t("generationModeAria")}>
              <button
                className={generationMode === "text" ? "segmented-control h-9 text-xs is-active" : "segmented-control h-9 text-xs"}
                type="button"
                aria-pressed={generationMode === "text"}
                data-testid="mode-text"
                onClick={() => setGenerationMode("text")}
              >
                {t("modeLabel", { mode: "generate" })}
              </button>
              <button
                className={
                  generationMode === "reference" ? "segmented-control h-9 text-xs is-active" : "segmented-control h-9 text-xs"
                }
                type="button"
                aria-pressed={generationMode === "reference"}
                data-testid="mode-reference"
                onClick={() => setGenerationMode("reference")}
              >
                {t("modeLabel", { mode: "edit" })}
              </button>
            </div>
          </div>

          <label className="block">
            <span className="control-label">{t("generationPromptLabel")}</span>
            <textarea
              aria-invalid={Boolean(promptValidationMessage)}
              className="prompt-textarea mt-2 h-32 w-full resize-none rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm leading-6 text-neutral-950 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
              id="prompt-input"
              name="prompt"
              placeholder={t("generationPromptPlaceholder")}
              value={prompt}
              data-testid="prompt-input"
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>

          {!trimmedPrompt ? (
            <div className="-mt-3 flex flex-wrap gap-2" data-testid="prompt-starters">
              {promptStarters.map((starter) => (
                <button
                  className="prompt-chip"
                  key={starter.labelKey}
                  type="button"
                  title={t(starter.promptKey)}
                  data-testid="prompt-starter-chip"
                  onClick={() => applyPromptStarter(t(starter.promptKey))}
                >
                  {t(starter.labelKey)}
                </button>
              ))}
            </div>
          ) : null}

          {isReferenceMode ? (
            <section
              className={`rounded-md border px-3 py-3 ${
                isReferenceReady ? "border-blue-200 bg-blue-50 text-blue-800" : "border-neutral-200 bg-neutral-50 text-neutral-600"
              }`}
              data-reference-state={referenceSelection.status}
              data-testid="reference-state"
            >
              <div className="flex items-start gap-2">
                <ImageIcon className={`mt-0.5 size-4 ${isReferenceReady ? "text-blue-600" : "text-neutral-400"}`} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {referenceSelection.status === "ready"
                      ? t("generationReferenceReady", { count: referenceSelection.references.length })
                      : t("generationReferenceNeed", { max: MAX_REFERENCE_IMAGES })}
                  </p>
                  <p className="mt-1 text-xs leading-5" data-testid="reference-hint">
                    {referenceSelection.hint}
                  </p>
                  {referenceSelection.status === "ready" ? (
                    <div className="reference-preview-list">
                      {referenceSelection.references.map((reference, index) => (
                        <div className="reference-preview-card" key={`${reference.sourceUrl}-${index}`}>
                          <span className="reference-preview-card__index">{index + 1}</span>
                          <img
                            alt={t("generationReferenceAlt", { index: index + 1, name: reference.name })}
                            className="reference-preview-card__image"
                            src={reference.sourceUrl}
                          />
                          <p className="min-w-0 flex-1 truncate text-xs font-medium" data-testid="reference-name">
                            {reference.name}
                            <span>{Math.round(reference.width)} x {Math.round(reference.height)}</span>
                          </p>
                        </div>
                      ))}
                      <button
                        className="secondary-action h-8 shrink-0 px-2 text-xs"
                        type="button"
                        data-testid="cancel-reference"
                        onClick={cancelReferenceSelection}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                        {t("generationCancelReference")}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          <label className="block">
            <span className="control-label">{t("generationStyleLabel")}</span>
            <select
              className="field-control"
              id="style-preset"
              name="stylePreset"
              value={stylePreset}
              data-testid="style-preset"
              onChange={(event) => setStylePreset(event.target.value as StylePresetId)}
            >
              {STYLE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {t("stylePresetLabel", { presetId: preset.id, fallback: preset.label })}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="control-label">{t("generationSizeLabel")}</span>
            <div className="size-selector-grid">
              <label>
                <span className="control-label control-label--subtle">{t("generationResolutionLabel")}</span>
                <select
                  className="field-control"
                  id="resolution-preset"
                  name="resolutionPreset"
                  value={resolutionPresetId}
                  data-testid="resolution-preset"
                  onChange={(event) => selectResolutionPreset(event.target.value)}
                >
                  {RESOLUTION_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="control-label control-label--subtle">{t("generationAspectRatioLabel")}</span>
                <select
                  className="field-control"
                  id="aspect-ratio-preset"
                  name="aspectRatioPreset"
                  value={aspectRatioPresetId}
                  data-testid="aspect-ratio-preset"
                  onChange={(event) => selectAspectRatioPreset(event.target.value)}
                >
                  {ASPECT_RATIO_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="size-summary" data-testid="computed-size">
              {t("generationComputedSize", {
                size:
                  Number.isNaN(width) || Number.isNaN(height)
                    ? t("customSize")
                    : `${width} x ${height}`
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="control-label">{t("generationWidthLabel")}</span>
              <input
                className="field-control"
                id="custom-width"
                min={MIN_IMAGE_DIMENSION}
                max={MAX_IMAGE_DIMENSION}
                name="width"
                step={1}
                type="number"
                value={Number.isNaN(width) ? "" : width}
                data-testid="custom-width"
                onChange={(event) => updateWidth(event.target.value)}
              />
            </label>
            <label>
              <span className="control-label">{t("generationHeightLabel")}</span>
              <input
                className="field-control"
                id="custom-height"
                min={MIN_IMAGE_DIMENSION}
                max={MAX_IMAGE_DIMENSION}
                name="height"
                step={1}
                type="number"
                value={Number.isNaN(height) ? "" : height}
                data-testid="custom-height"
                onChange={(event) => updateHeight(event.target.value)}
              />
            </label>
          </div>

          <div>
            <span className="control-label">{t("generationCountLabel")}</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {PRIMARY_GENERATION_COUNTS.map((item) => (
                <button
                  className={item === count ? "segmented-control is-active" : "segmented-control"}
                  key={item}
                  type="button"
                  onClick={() => setCount(item)}
                >
                  {item}
                </button>
              ))}
            </div>

            <details className="group mt-2 rounded-md border border-neutral-200 bg-neutral-50">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-neutral-800">
                <span>{isExtendedCountSelected ? t("generationMoreCountSelected", { count }) : t("generationMoreCount")}</span>
                <ChevronDown className="size-4 shrink-0 text-neutral-500 transition group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="grid grid-cols-2 gap-2 border-t border-neutral-200 px-3 py-3">
                {EXTENDED_GENERATION_COUNTS.map((item) => (
                  <button
                    className={item === count ? "segmented-control is-active" : "segmented-control"}
                    key={item}
                    type="button"
                    onClick={() => setCount(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </details>
          </div>

          <details className="rounded-md border border-neutral-200 bg-neutral-50">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-3 text-sm font-medium text-neutral-800">
              {t("generationAdvanced")}
              <ChevronDown className="size-4 text-neutral-500" aria-hidden="true" />
            </summary>
            <div className="space-y-4 border-t border-neutral-200 px-3 py-4">
              <label className="block">
                <span className="control-label">{t("generationQualityLabel")}</span>
                <select
                  className="field-control"
                  id="quality-select"
                  name="quality"
                  value={quality}
                  data-testid="quality-select"
                  onChange={(event) => setQuality(event.target.value as ImageQuality)}
                >
                  {IMAGE_QUALITIES.map((item) => (
                    <option key={item} value={item}>
                      {t("qualityLabel", { quality: item })}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="control-label">{t("generationOutputFormatLabel")}</span>
                <select
                  className="field-control"
                  id="format-select"
                  name="outputFormat"
                  value={outputFormat}
                  data-testid="format-select"
                  onChange={(event) => setOutputFormat(event.target.value as OutputFormat)}
                >
                  {OUTPUT_FORMATS.map((item) => (
                    <option key={item} value={item}>
                      {t("outputFormatLabel", { format: item })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>

          <section className="space-y-3" data-history-expanded={isHistoryExpanded} data-testid="generation-history">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-neutral-950">{t("generationHistoryTitle")}</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">{t("generationHistoryCount", { count: generationHistory.length })}</span>
                {hasAdditionalHistory ? (
                  <button
                    aria-expanded={isHistoryExpanded}
                    className="history-toggle"
                    data-testid="history-toggle"
                    type="button"
                    onClick={() => setIsHistoryExpanded((expanded) => !expanded)}
                  >
                    {isHistoryExpanded ? t("galleryToggleCollapse") : t("generationHistoryExpand", { count: hiddenHistoryCount })}
                    <ChevronDown className={`size-3.5 transition ${isHistoryExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>

            {generationHistory.length === 0 ? (
              <p className="rounded-md border border-dashed border-neutral-300 px-3 py-4 text-sm text-neutral-500">
                {t("generationEmptyHistory")}
              </p>
            ) : (
              <div className="history-list">
                {visibleHistory.map((record) => {
                  const downloadableAsset = firstDownloadableAsset(record);
                  const excerpt = promptExcerpt(record.prompt);
                  const totalOutputs = record.outputs.length || record.count;
                  const activeTask = activeGenerationsRef.current.get(record.id);
                  const isRecordRunning = isActiveGenerationRecord(record) && Boolean(activeTask);
                  const cloudFailedCount = cloudFailureCount(record);
                  const cloudFailureMessage = firstCloudFailureMessage(record);

                  return (
                    <article
                      className="history-item"
                      data-testid="history-record"
                      key={record.id}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={`history-status-pill ${historyStatusStyles[record.status]}`}>
                            {t("statusLabel", { status: record.status })}
                          </span>
                          <span className="truncate text-xs text-neutral-500">{t("modeLabel", { mode: record.mode })}</span>
                        </div>
                        <p className="mt-1 truncate text-sm font-medium leading-5 text-neutral-950" title={record.prompt}>
                          {excerpt}
                        </p>
                        <dl className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs leading-5 text-neutral-500">
                          <div className="inline-flex items-center gap-1">
                            <dt className="sr-only">{t("generationHistorySize")}</dt>
                            <dd>
                              {record.size.width} x {record.size.height}
                            </dd>
                          </div>
                          <div className="inline-flex items-center gap-1">
                            <dt className="sr-only">{t("generationHistoryOutputCount")}</dt>
                            <dd>
                              {t("generationImageOutputCount", { successful: successfulOutputCount(record), total: totalOutputs })}
                            </dd>
                          </div>
                          <div className="inline-flex items-center gap-1">
                            <dt className="sr-only">{t("generationHistoryCreatedAt")}</dt>
                            <dd>{formatCreatedTime(record.createdAt, formatDateTime)}</dd>
                          </div>
                          {cloudFailedCount > 0 ? (
                            <div className="inline-flex items-center gap-1 text-amber-700" title={cloudFailureMessage}>
                              <dt className="sr-only">{t("generationHistoryCloudBackup")}</dt>
                              <dd className="inline-flex items-center gap-1">
                                <Cloud className="size-3" aria-hidden="true" />
                                {t("generationCloudFailed", { count: cloudFailedCount })}
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                      </div>

                      <div className="history-actions">
                        <button
                          aria-label={t("generationHistoryCopyPrompt", { excerpt })}
                          className="history-icon-action"
                          type="button"
                          data-testid="history-copy-prompt"
                          title={t("galleryPromptLabel")}
                          onClick={() => void copyHistoryPrompt(record)}
                        >
                          <Copy className="size-4" aria-hidden="true" />
                        </button>
                        <button
                          aria-label={t("generationHistoryLocate", { excerpt })}
                          className="history-icon-action"
                          type="button"
                          data-testid="history-locate"
                          title={t("historyLocate")}
                          onClick={() => locateHistoryRecord(record)}
                        >
                          <MapPin className="size-4" aria-hidden="true" />
                        </button>
                        <button
                          aria-label={t("generationHistoryRerun", { excerpt })}
                          className="history-icon-action"
                          type="button"
                          data-testid="history-rerun"
                          disabled={isRecordRunning}
                          title={isRecordRunning ? t("generationRerunRunning") : t("historyRerun")}
                          onClick={() => void rerunHistoryRecord(record)}
                        >
                          <RotateCcw className="size-4" aria-hidden="true" />
                        </button>
                        {activeTask && isActiveGenerationRecord(record) ? (
                          <button
                            aria-label={t("historyCancelTask", { excerpt })}
                            className="history-icon-action"
                            type="button"
                            data-testid="history-cancel"
                            title={t("commonCancel")}
                            onClick={() => void cancelGeneration(activeTask.requestId)}
                          >
                            <XCircle className="size-4" aria-hidden="true" />
                          </button>
                        ) : (
                          <button
                            aria-label={t("generationHistoryDownload", { excerpt })}
                            className="history-icon-action"
                            type="button"
                            data-testid="history-download"
                            disabled={!downloadableAsset}
                            title={downloadableAsset ? t("commonDownload") : t("generationHistoryNoDownload")}
                            onClick={() => downloadHistoryRecord(record)}
                          >
                            <Download className="size-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="ai-panel-actions ai-panel-tab-panel ai-panel-tab-panel--actions grid grid-cols-1 gap-3 border-t border-neutral-200 bg-white px-5 py-4" data-tab="manual">
          {panelStatus ? (
            <div
              aria-live={panelStatus.tone === "progress" ? "polite" : "assertive"}
              className={`action-feedback panel-status-strip panel-status--${panelStatus.tone}`}
              data-testid={`action-${panelStatus.testId}`}
              role={panelStatus.tone === "success" || panelStatus.tone === "progress" ? "status" : "alert"}
            >
              {panelStatus.message}
            </div>
          ) : null}
          <button
            className="primary-action"
            disabled={!canGenerate}
            type="button"
            data-generation-mode={generationMode}
            data-reference-mode={isReferenceReady ? "edit" : "generate"}
            data-testid="generate-button"
            title={validationMessage || undefined}
            onClick={submitGeneration}
          >
            {isReferenceReady ? (
              <ImageIcon className="size-4" aria-hidden="true" />
            ) : (
              <Square className="size-4" aria-hidden="true" />
            )}
            {generationMode === "reference" ? t("generationStartReference") : t("generationStartText")}
          </button>
        </div>
        </>
        ) : (
        <>
        <div className="ai-panel-body ai-panel-tab-panel ai-panel-tab-panel--body agent-panel-body flex-1 px-5 py-4" data-tab="agent" data-testid="agent-tab-panel">
          {saveError ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="save-error">
              {saveError}
            </p>
          ) : null}

          <div className="agent-chat-head" data-testid="agent-config-state" data-configured={isAgentConfigured}>
            <button
              className="agent-model-pill"
              data-configured={isAgentConfigured}
              type="button"
              onClick={() => setIsProviderConfigDialogOpen(true)}
            >
              <span className="agent-model-pill__icon" data-state={isAgentConfigured ? "ready" : "missing"}>
                {isAgentConfigLoading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : isAgentConfigured ? (
                  <ShieldCheck className="size-4" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="size-4" aria-hidden="true" />
                )}
              </span>
              <span className="agent-model-pill__copy">
                <strong>
                  {isAgentConfigLoading
                    ? t("agentConfigLoading")
                    : isAgentConfigured
                      ? t(agentConfig?.supportsVision ? "agentVisionMode" : "agentTextOnlyMode")
                      : t("agentConfigMissingTitle")}
                </strong>
                <span>{agentConfigError || (isAgentConfigured ? t("agentConfigReadyCopy", { model: agentConfig?.model ?? "" }) : t("agentOpenModelConfig"))}</span>
              </span>
            </button>
            <div className="agent-chat-head__actions">
              <button
                aria-label={t("agentSkillsOpen")}
                className="agent-icon-button"
                data-testid="agent-skills-open"
                title={t("agentSkillsOpen")}
                type="button"
                onClick={() => setIsAgentSkillDialogOpen(true)}
              >
                <BookOpenCheck className="size-4" aria-hidden="true" />
              </button>
              <button
                aria-label={t("agentConfigRefresh")}
                className="agent-icon-button"
                data-testid="agent-config-refresh"
                disabled={isAgentConfigLoading}
                title={t("agentConfigRefresh")}
                type="button"
                onClick={() => void loadAgentConfig()}
              >
                {isAgentConfigLoading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
              </button>
              <button
                aria-label={t("agentHistoryOpen")}
                className="agent-icon-button"
                data-testid="agent-history-open"
                title={t("agentHistoryOpen")}
                type="button"
                onClick={openAgentHistoryDialog}
              >
                <History className="size-4" aria-hidden="true" />
              </button>
              {AGENT_TRACE_DEBUG_ENABLED ? (
                <button
                  aria-label={isAgentTraceOpen ? t("agentTraceClose") : t("agentTraceOpen")}
                  aria-pressed={isAgentTraceOpen}
                  className="agent-icon-button"
                  data-testid="agent-trace-toggle"
                  title={isAgentTraceOpen ? t("agentTraceClose") : t("agentTraceOpen")}
                  type="button"
                  onClick={() => setIsAgentTraceOpen((isOpen) => !isOpen)}
                >
                  <FileText className="size-4" aria-hidden="true" />
                </button>
              ) : null}
              <button
                aria-label={t("agentNewConversation")}
                className="agent-icon-button"
                data-testid="agent-new-conversation"
                disabled={isAgentRunning}
                title={t("agentNewConversation")}
                type="button"
                onClick={startNewAgentConversation}
              >
                <MessageCirclePlus className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {AGENT_TRACE_DEBUG_ENABLED && isAgentTraceOpen ? (
            <AgentTracePanel
              copied={isAgentTraceCopied}
              entries={agentTraceEntries}
              formatDateTime={formatDateTime}
              t={t}
              onCopy={() => void copyAgentTrace()}
            />
          ) : null}

          <section className="agent-transcript" aria-label={t("agentTranscriptLabel")} data-testid="agent-transcript" ref={agentTranscriptRef}>
            {agentMessages.length === 0 ? (
              <div className="agent-empty-state">
                <Bot className="size-5" aria-hidden="true" />
                <p>{t("agentEmptyTitle")}</p>
                <span>{t("agentEmptyCopy")}</span>
              </div>
            ) : (
              agentMessages.map((message) => {
                const canCopyAgentMessage = isCopyableAgentMessageRole(message.role) && message.content.trim().length > 0;
                const isAgentMessageCopied = copiedAgentMessageId === message.id;
                const copyMessageLabel = isAgentMessageCopied ? t("agentCopiedMessage") : t("agentCopyMessage");
                const hasThinkingDetails = AGENT_TRACE_DEBUG_ENABLED && message.role === "thinking" && Boolean(message.details?.trim());
                const isThinkingExpanded = hasThinkingDetails && expandedThinkingMessageIds.includes(message.id);
                const thinkingToggleLabel = hasThinkingDetails ? agentThinkingRawToggleLabel(locale, isThinkingExpanded) : "";
                const previewCount = message.previews?.length ?? 0;

                return (
                  <article
                    className={`agent-message agent-message--${message.role}`}
                    data-message-role={message.role}
                    data-run-id={message.runId}
                    data-testid="agent-message"
                    key={message.id}
                  >
                    {message.role === "system" || message.role === "error" ? (
                      <div className="agent-status-line__meta">
                        <span>{t("agentMessageRole", { role: message.role })}</span>
                        <time dateTime={message.timestamp}>{formatDateTime(message.timestamp, { hour: "2-digit", minute: "2-digit" })}</time>
                      </div>
                    ) : (
                      <div className="agent-message__meta">
                        <span>{t("agentMessageRole", { role: message.role })}</span>
                        <span className="agent-message__meta-actions">
                          <time dateTime={message.timestamp}>{formatDateTime(message.timestamp, { hour: "2-digit", minute: "2-digit" })}</time>
                          {canCopyAgentMessage ? (
                            <button
                              aria-label={copyMessageLabel}
                              className="agent-message-copy-button"
                              data-copied={isAgentMessageCopied}
                              title={copyMessageLabel}
                              type="button"
                              onClick={() => void copyAgentMessage(message)}
                            >
                              <span className="agent-message-copy-button__icon-stack" aria-hidden="true">
                                <Copy className="agent-message-copy-button__icon agent-message-copy-button__icon--copy size-3.5" />
                                <Check className="agent-message-copy-button__icon agent-message-copy-button__icon--check size-3.5" />
                              </span>
                            </button>
                          ) : null}
                        </span>
                      </div>
                    )}
                    <p className="agent-message__content">{message.content}</p>
                    {hasThinkingDetails ? (
                      <div className="agent-thinking-details">
                        <button
                          aria-expanded={isThinkingExpanded}
                          aria-label={thinkingToggleLabel}
                          className="agent-thinking-details__toggle"
                          data-testid="agent-thinking-toggle"
                          type="button"
                          onClick={() => toggleThinkingMessage(message.id)}
                        >
                          <span>{thinkingToggleLabel}</span>
                          <ChevronDown className="size-3.5" aria-hidden="true" data-expanded={isThinkingExpanded} />
                        </button>
                        {isThinkingExpanded ? (
                          <pre className="agent-thinking-details__content" data-testid="agent-thinking-content">
                            {message.details}
                          </pre>
                        ) : null}
                      </div>
                    ) : null}
                    {message.plan ? (
                      <AgentPlanCard
                        isAgentConfigured={isAgentConfigured}
                        isAgentRunning={isAgentRunning}
                        plan={message.plan}
                        t={t}
                        onAction={(plan, action) => void sendAgentPlanAction(plan, action)}
                      />
                    ) : null}
                    {previewCount > 0 && message.previews ? (
                      <details className="agent-preview-disclosure">
                        <summary className="agent-preview-disclosure__summary">
                          <span>{agentPreviewDisclosureLabel(locale, previewCount)}</span>
                          <ChevronDown className="agent-preview-disclosure__icon size-3.5" aria-hidden="true" />
                        </summary>
                        <div className="agent-preview-list">
                          {message.previews.map((preview) => (
                            <button
                              aria-label={t("agentPreviewLocate")}
                              className="agent-preview-button"
                              key={preview.id}
                              type="button"
                              onClick={() => locateAgentPreview(preview)}
                            >
                              <img alt="" src={preview.url} />
                              <MapPin className="size-3.5" aria-hidden="true" />
                            </button>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </article>
                );
              })
            )}
          </section>
        </div>

        <div className="ai-panel-actions ai-panel-tab-panel ai-panel-tab-panel--actions agent-panel-actions agent-composer-shell border-t border-neutral-200 bg-white px-5 py-4" data-tab="agent">
          <div className="agent-param-bar">
            <div className="agent-param-group">
              <button
                aria-expanded={isAgentSettingsOpen}
                aria-label={t("agentOpenParameters")}
                className="agent-param-chip agent-param-chip--primary"
                data-testid="agent-parameter-toggle"
                title={agentSizeSummary}
                type="button"
                onClick={() => setIsAgentSettingsOpen((isOpen) => !isOpen)}
              >
                <Settings className="size-3.5" aria-hidden="true" />
                <span>{agentCompactSizeSummary}</span>
              </button>
              <button
                aria-expanded={isAgentSettingsOpen}
                className="agent-param-chip"
                title={agentQualitySummary}
                type="button"
                onClick={() => setIsAgentSettingsOpen((isOpen) => !isOpen)}
              >
                <Sparkles className="size-3.5" aria-hidden="true" />
                <span>{agentQualitySummary}</span>
              </button>
              <button
                aria-expanded={isAgentSettingsOpen}
                className="agent-param-chip"
                title={agentFormatSummary}
                type="button"
                onClick={() => setIsAgentSettingsOpen((isOpen) => !isOpen)}
              >
                <ImageIcon className="size-3.5" aria-hidden="true" />
                <span>{agentFormatSummary}</span>
              </button>
              {supportsAgentThinkingControls ? (
                <button
                  aria-expanded={isAgentSettingsOpen}
                  className="agent-param-chip"
                  data-testid="agent-thinking-chip"
                  title={agentThinkingSummary}
                  type="button"
                  onClick={() => setIsAgentSettingsOpen((isOpen) => !isOpen)}
                >
                  <BrainCircuit className="size-3.5" aria-hidden="true" />
                  <span>{agentThinkingSummary}</span>
                </button>
              ) : null}
              <button
                aria-expanded={isAgentSettingsOpen}
                className="agent-param-chip"
                data-testid="agent-reference-state"
                title={agentReferenceSummary}
                type="button"
                onClick={() => setIsAgentSettingsOpen((isOpen) => !isOpen)}
              >
                <MapPin className="size-3.5" aria-hidden="true" />
                <span>{agentReferenceCompactSummary}</span>
              </button>
            </div>
          </div>

          {isAgentSettingsOpen ? (
            <section className="agent-parameter-popover" aria-label={t("agentDefaultsTitle")} data-testid="agent-parameter-popover">
              <div className="agent-parameter-popover__header">
                <div>
                  <strong>{t("agentDefaultsTitle")}</strong>
                  <span>
                    {agentSizeSummary} / {agentQualitySummary} / {agentFormatSummary}
                  </span>
                </div>
                <button className="agent-parameter-popover__close" type="button" aria-label={t("commonClose")} onClick={() => setIsAgentSettingsOpen(false)}>
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>

              <div className="agent-parameter-popover__section agent-parameter-popover__section--size">
                <div className="agent-parameter-popover__section-head">
                  <span className="control-label">{t("generationSizeLabel")}</span>
                  <strong>{agentSizeSummary}</strong>
                </div>
                <div className="agent-size-preset-grid" data-testid="agent-size-preset-buttons">
                  {agentSizePresetButtons.map((preset) => (
                    <button
                      aria-pressed={agentSizePresetId === preset.id}
                      className="agent-size-preset-button"
                      data-selected={agentSizePresetId === preset.id}
                      key={preset.id}
                      type="button"
                      onClick={() => selectAgentSizePreset(preset.id)}
                    >
                      <span>{sizePresetLabel(preset, t)}</span>
                      <small>
                        {preset.width} x {preset.height}
                      </small>
                    </button>
                  ))}
                  <button
                    aria-pressed={agentSizePresetId === CUSTOM_SIZE_PRESET_ID}
                    className="agent-size-preset-button"
                    data-selected={agentSizePresetId === CUSTOM_SIZE_PRESET_ID}
                    type="button"
                    onClick={() => selectAgentSizePreset(CUSTOM_SIZE_PRESET_ID)}
                  >
                    <span>{t("customSize")}</span>
                    <small>{t("customSizeManual")}</small>
                  </button>
                </div>
                <label className="agent-compact-field agent-compact-field--select">
                  <span className="control-label">{t("generationAllSizes")}</span>
                  <select
                    className="field-control"
                    data-testid="agent-size-preset"
                    value={agentSizePresetId}
                    onChange={(event) => selectAgentSizePreset(event.target.value)}
                  >
                    {SIZE_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {sizePresetOptionLabel(preset, t)}
                      </option>
                    ))}
                    <option value={CUSTOM_SIZE_PRESET_ID}>{t("customSizeOption")}</option>
                  </select>
                </label>
                <div className="agent-dimension-grid">
                  <label className="agent-compact-field">
                    <span className="control-label">{t("generationWidthLabel")}</span>
                    <input
                      className="field-control"
                      data-testid="agent-width"
                      max={MAX_IMAGE_DIMENSION}
                      min={MIN_IMAGE_DIMENSION}
                      step={1}
                      type="number"
                      value={Number.isNaN(agentWidth) ? "" : agentWidth}
                      onChange={(event) => updateAgentWidth(event.target.value)}
                    />
                  </label>
                  <label className="agent-compact-field">
                    <span className="control-label">{t("generationHeightLabel")}</span>
                    <input
                      className="field-control"
                      data-testid="agent-height"
                      max={MAX_IMAGE_DIMENSION}
                      min={MIN_IMAGE_DIMENSION}
                      step={1}
                      type="number"
                      value={Number.isNaN(agentHeight) ? "" : agentHeight}
                      onChange={(event) => updateAgentHeight(event.target.value)}
                    />
                  </label>
                </div>
              </div>

              <div className="agent-parameter-popover__section">
                <div className="agent-output-grid">
                  <label className="agent-compact-field">
                    <span className="control-label">{t("generationQualityLabel")}</span>
                    <select
                      className="field-control"
                      data-testid="agent-quality"
                      value={agentQuality}
                      onChange={(event) => setAgentQuality(event.target.value as ImageQuality)}
                    >
                      {IMAGE_QUALITIES.map((item) => (
                        <option key={item} value={item}>
                          {t("qualityLabel", { quality: item })}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="agent-compact-field">
                    <span className="control-label">{t("generationOutputFormatLabel")}</span>
                    <select
                      className="field-control"
                      data-testid="agent-format"
                      value={agentOutputFormat}
                      onChange={(event) => setAgentOutputFormat(event.target.value as OutputFormat)}
                    >
                      {OUTPUT_FORMATS.map((item) => (
                        <option key={item} value={item}>
                          {t("outputFormatLabel", { format: item })}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              {agentDefaultsValidationMessage ? (
                <p className="agent-inline-warning" role="alert">
                  {agentDefaultsValidationMessage}
                </p>
              ) : null}
              {supportsAgentThinkingControls ? (
                <section className="agent-thinking-controls" aria-label={agentThinkingModeLabel(locale)} data-testid="agent-thinking-controls">
                  <div className="agent-thinking-controls__header">
                    <div>
                      <strong>{agentThinkingModeLabel(locale)}</strong>
                      <span>{agentThinkingSummary}</span>
                    </div>
                  </div>
                  <div className="agent-thinking-controls__group" role="group" aria-label={agentThinkingModeLabel(locale)}>
                    <button
                      aria-pressed={agentThinkingType === "enabled"}
                      className="agent-thinking-controls__option"
                      data-selected={agentThinkingType === "enabled"}
                      data-testid="agent-thinking-enabled"
                      type="button"
                      onClick={() => setAgentThinkingType("enabled")}
                    >
                      {agentThinkingEnabledLabel(locale)}
                    </button>
                    <button
                      aria-pressed={agentThinkingType === "disabled"}
                      className="agent-thinking-controls__option"
                      data-selected={agentThinkingType === "disabled"}
                      data-testid="agent-thinking-disabled"
                      type="button"
                      onClick={() => setAgentThinkingType("disabled")}
                    >
                      {agentThinkingDisabledLabel(locale)}
                    </button>
                  </div>
                  <div className="agent-thinking-controls__effort">
                    <span className="control-label">{agentThinkingEffortLabel(locale)}</span>
                    <div className="agent-thinking-controls__group" role="group" aria-label={agentThinkingEffortLabel(locale)}>
                      <button
                        aria-pressed={agentReasoningEffort === "high"}
                        className="agent-thinking-controls__option"
                        data-selected={agentReasoningEffort === "high"}
                        data-testid="agent-thinking-effort-high"
                        disabled={agentThinkingType === "disabled"}
                        type="button"
                        onClick={() => setAgentReasoningEffort("high")}
                      >
                        High
                      </button>
                      <button
                        aria-pressed={agentReasoningEffort === "max"}
                        className="agent-thinking-controls__option"
                        data-selected={agentReasoningEffort === "max"}
                        data-testid="agent-thinking-effort-max"
                        disabled={agentThinkingType === "disabled"}
                        type="button"
                        onClick={() => setAgentReasoningEffort("max")}
                      >
                        Max
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}
              <div className="agent-reference-summary">
                <div>
                  <strong>{t("agentReferencesTitle")}</strong>
                  <span>{agentReferenceSelection.hint}</span>
                </div>
                <span>{agentReferenceSelection.references.length} / {MAX_AGENT_SELECTED_REFERENCES}</span>
              </div>
              {agentReferenceSelection.warning ? (
                <p className="agent-inline-warning" data-testid="agent-reference-warning" role="alert">
                  {agentReferenceSelection.warning}
                </p>
              ) : null}
              {agentReferenceSelection.references.length > 0 ? (
                <div className="agent-reference-list">
                  {agentReferenceSelection.references.map((reference, index) => (
                    <article className="agent-reference-item" data-testid="agent-reference-item" key={`${reference.sourceUrl}-${index}`}>
                      <img
                        alt={t("generationReferenceAlt", { index: index + 1, name: agentReferenceLabel(reference, index, t) })}
                        className="agent-reference-item__image"
                        src={reference.sourceUrl}
                      />
                      <div className="min-w-0">
                        <p>{agentReferenceLabel(reference, index, t)}</p>
                        <span>{Math.round(reference.width)} x {Math.round(reference.height)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="agent-composer-row">
            <label className="agent-composer-input">
              <span className="sr-only">{t("agentInputLabel")}</span>
              <textarea
                className="agent-input"
                data-testid="agent-message-input"
                disabled={isAgentRunning}
                placeholder={isAgentConfigured ? t("agentInputPlaceholder") : t("agentConfigMissingInputPlaceholder")}
                rows={2}
                value={agentInput}
                onChange={(event) => setAgentInput(event.target.value)}
              />
            </label>
            {isAgentRunning ? (
              <button
                aria-label={agentCancelRunLabel}
                className="agent-send-or-cancel"
                data-state={agentRunStatus}
                data-testid="agent-cancel-button"
                title={agentCancelRunLabel}
                type="button"
                onClick={cancelAgentRun}
              >
                <CircleStop className="size-4" aria-hidden="true" />
              </button>
            ) : (
              <button
                aria-label={t("agentSend")}
                className="agent-send-or-cancel"
                data-state={agentRunStatus}
                data-testid="agent-send-button"
                disabled={!canSendAgentMessage}
                title={!isAgentConfigured ? t("agentConfigMissingTitle") : agentDefaultsValidationMessage || undefined}
                type="button"
                onClick={() => void submitAgentMessage()}
              >
                <Send className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        </>
        )}
      </aside>

      {isAgentHistoryOpen ? (
        <AgentHistoryDialog
          conversation={selectedAgentConversation}
          error={agentHistoryError}
          formatDateTime={formatDateTime}
          isDetailLoading={isAgentHistoryDetailLoading}
          isLoading={isAgentHistoryLoading}
          isRestoringDisabled={isAgentRunning}
          selectedConversationId={selectedAgentHistoryId}
          summaries={agentHistorySummaries}
          t={t}
          onClose={closeAgentHistoryDialog}
          onCopyTrace={(conversation) => void copyAgentConversationTrace(conversation)}
          onRestore={restoreAgentConversation}
          onSelectConversation={selectAgentHistoryConversation}
        />
      ) : null}

      {isAgentSkillDialogOpen ? <AgentSkillDialog onClose={() => setIsAgentSkillDialogOpen(false)} /> : null}

      {isStorageDialogOpen ? (
        <div className="app-modal-backdrop fixed inset-0 z-[3000] flex items-center justify-center bg-neutral-950/45 px-4 py-6" data-testid="storage-dialog">
          <div
            aria-labelledby="storage-dialog-title"
            aria-modal="true"
            className="app-modal-surface flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-neutral-950" id="storage-dialog-title">
                  {t("storageSettings")}
                </h2>
                <p className="mt-1 text-xs leading-5 text-neutral-500">{t("storageSubtitle")}</p>
              </div>
              <button
                aria-label={t("storageClose")}
                className="history-icon-action"
                type="button"
                onClick={closeStorageDialog}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto px-5 py-5">
              {storageError ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700" role="alert">
                  {storageError}
                </p>
              ) : null}
              {storageMessage ? (
                <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm leading-5 text-emerald-700" role="status">
                  {storageMessage}
                </p>
              ) : null}

              <label className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 px-3 py-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-neutral-900">{t("storageEnabledLabel")}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-neutral-500">{t("storageEnabledCopy")}</span>
                </span>
                <input
                  checked={storageForm.enabled}
                  className="size-4 accent-amber-600"
                  data-testid="storage-enabled"
                  id="storage-enabled"
                  name="storageEnabled"
                  type="checkbox"
                  onChange={(event) => updateStorageForm({ enabled: event.target.checked })}
                />
              </label>

              <div className="space-y-2">
                <p className="control-label">{t("storageProviderLabel")}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    className={`rounded-md border px-3 py-3 text-left transition-colors ${
                      storageForm.provider === "cos"
                        ? "border-amber-500 bg-amber-50 text-neutral-950"
                        : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                    }`}
                    type="button"
                    onClick={() => updateStorageProvider("cos")}
                  >
                    <span className="block text-sm font-semibold">{t("storageProviderCosTitle")}</span>
                    <span className="mt-1 block text-xs leading-5 text-neutral-500">{t("storageProviderCosCopy")}</span>
                  </button>
                  <button
                    className={`rounded-md border px-3 py-3 text-left transition-colors ${
                      storageForm.provider === "s3"
                        ? "border-emerald-500 bg-emerald-50 text-neutral-950"
                        : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                    }`}
                    type="button"
                    onClick={() => updateStorageProvider("s3")}
                  >
                    <span className="block text-sm font-semibold">{t("storageProviderS3Title")}</span>
                    <span className="mt-1 block text-xs leading-5 text-neutral-500">{t("storageProviderS3Copy")}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {storageForm.provider === "cos" ? (
                  <>
                    <label className="block sm:col-span-2">
                      <span className="control-label">SecretId</span>
                      <input
                        className="field-control"
                        data-testid="storage-secret-id"
                        id="storage-secret-id"
                        name="storageSecretId"
                        value={storageForm.cos.secretId}
                        onChange={(event) => updateStorageCosForm({ secretId: event.target.value })}
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="control-label">SecretKey</span>
                      <input
                        className="field-control"
                        data-testid="storage-secret-key"
                        id="storage-secret-key"
                        name="storageSecretKey"
                        type={storageSecretTouched.cos ? "password" : "text"}
                        value={storageForm.cos.secretKey}
                        onChange={(event) => {
                          setStorageSecretTouched((current) => ({ ...current, cos: true }));
                          updateStorageCosForm({ secretKey: event.target.value });
                        }}
                      />
                    </label>
                    <label className="block">
                      <span className="control-label">{t("storageBucket")}</span>
                      <input
                        className="field-control"
                        data-testid="storage-bucket"
                        id="storage-bucket"
                        name="storageBucket"
                        value={storageForm.cos.bucket}
                        onChange={(event) => updateStorageCosForm({ bucket: event.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className="control-label">{t("storageRegion")}</span>
                      <input
                        className="field-control"
                        data-testid="storage-region"
                        id="storage-region"
                        name="storageRegion"
                        value={storageForm.cos.region}
                        onChange={(event) => updateStorageCosForm({ region: event.target.value })}
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="control-label">{t("storageKeyPrefix")}</span>
                      <input
                        className="field-control"
                        data-testid="storage-prefix"
                        id="storage-prefix"
                        name="storagePrefix"
                        value={storageForm.cos.keyPrefix}
                        onChange={(event) => updateStorageCosForm({ keyPrefix: event.target.value })}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="block sm:col-span-2">
                      <span className="control-label">{t("storageEndpointMode")}</span>
                      <select
                        className="field-control"
                        data-testid="storage-s3-endpoint-mode"
                        id="storage-s3-endpoint-mode"
                        name="storageS3EndpointMode"
                        value={storageForm.s3.endpointMode}
                        onChange={(event) => updateStorageS3Form({ endpointMode: event.target.value === "custom" ? "custom" : "r2-account" })}
                      >
                        <option value="r2-account">{t("storageEndpointModeR2")}</option>
                        <option value="custom">{t("storageEndpointModeCustom")}</option>
                      </select>
                    </label>
                    {storageForm.s3.endpointMode === "r2-account" ? (
                      <label className="block sm:col-span-2">
                        <span className="control-label">{t("storageAccountId")}</span>
                        <input
                          className="field-control"
                          data-testid="storage-s3-account-id"
                          id="storage-s3-account-id"
                          name="storageS3AccountId"
                          value={storageForm.s3.accountId}
                          onChange={(event) => updateStorageS3Form({ accountId: event.target.value })}
                        />
                      </label>
                    ) : (
                      <label className="block sm:col-span-2">
                        <span className="control-label">{t("storageEndpointUrl")}</span>
                        <input
                          className="field-control"
                          data-testid="storage-s3-endpoint"
                          id="storage-s3-endpoint"
                          name="storageS3Endpoint"
                          value={storageForm.s3.endpoint}
                          onChange={(event) => updateStorageS3Form({ endpoint: event.target.value })}
                        />
                      </label>
                    )}
                    <label className="block sm:col-span-2">
                      <span className="control-label">{t("storageAccessKeyId")}</span>
                      <input
                        className="field-control"
                        data-testid="storage-s3-access-key-id"
                        id="storage-s3-access-key-id"
                        name="storageS3AccessKeyId"
                        value={storageForm.s3.accessKeyId}
                        onChange={(event) => updateStorageS3Form({ accessKeyId: event.target.value })}
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="control-label">{t("storageSecretAccessKey")}</span>
                      <input
                        className="field-control"
                        data-testid="storage-s3-secret-access-key"
                        id="storage-s3-secret-access-key"
                        name="storageS3SecretAccessKey"
                        type={storageSecretTouched.s3 ? "password" : "text"}
                        value={storageForm.s3.secretAccessKey}
                        onChange={(event) => {
                          setStorageSecretTouched((current) => ({ ...current, s3: true }));
                          updateStorageS3Form({ secretAccessKey: event.target.value });
                        }}
                      />
                    </label>
                    <label className="block">
                      <span className="control-label">{t("storageBucket")}</span>
                      <input
                        className="field-control"
                        data-testid="storage-s3-bucket"
                        id="storage-s3-bucket"
                        name="storageS3Bucket"
                        value={storageForm.s3.bucket}
                        onChange={(event) => updateStorageS3Form({ bucket: event.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className="control-label">{t("storageRegion")}</span>
                      <input
                        className="field-control"
                        data-testid="storage-s3-region"
                        id="storage-s3-region"
                        name="storageS3Region"
                        value={storageForm.s3.region}
                        onChange={(event) => updateStorageS3Form({ region: event.target.value })}
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="control-label">{t("storageKeyPrefix")}</span>
                      <input
                        className="field-control"
                        data-testid="storage-s3-prefix"
                        id="storage-s3-prefix"
                        name="storageS3Prefix"
                        value={storageForm.s3.keyPrefix}
                        onChange={(event) => updateStorageS3Form({ keyPrefix: event.target.value })}
                      />
                    </label>
                    {storageForm.s3.endpointMode === "custom" ? (
                      <label className="flex items-center gap-2 sm:col-span-2">
                        <input
                          checked={storageForm.s3.forcePathStyle}
                          className="size-4 accent-emerald-600"
                          data-testid="storage-s3-force-path-style"
                          id="storage-s3-force-path-style"
                          name="storageS3ForcePathStyle"
                          type="checkbox"
                          onChange={(event) => updateStorageS3Form({ forcePathStyle: event.target.checked })}
                        />
                        <span className="text-sm text-neutral-700">{t("storageForcePathStyle")}</span>
                      </label>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-neutral-200 px-5 py-4">
              <button
                className="secondary-action h-10"
                data-testid="storage-test"
                disabled={isStorageTesting || isStorageSaving}
                type="button"
                onClick={() => void testStorageSettings()}
              >
                {isStorageTesting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Cloud className="size-4" aria-hidden="true" />}
                {t("storageTest")}
              </button>
              <button
                className="primary-action h-10"
                data-testid="storage-save"
                disabled={isStorageSaving || isStorageTesting}
                type="button"
                onClick={() => void saveStorageSettings()}
              >
                {isStorageSaving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
                {t("storageSave")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCodexLoginOpen ? createPortal(
        (
        <div className="app-modal-backdrop fixed inset-0 z-[3000] flex items-center justify-center bg-neutral-950/45 px-4 py-6" data-testid="codex-login-dialog">
          <div
            aria-labelledby="codex-login-title"
            aria-modal="true"
            className="codex-login-dialog app-modal-surface"
            role="dialog"
          >
            <div className="codex-login-dialog__header">
              <div className="min-w-0">
                <h2 id="codex-login-title">{t("codexLoginTitle")}</h2>
                <p>{t("codexLoginSubtitle")}</p>
              </div>
              <button
                aria-label={t("codexCloseLogin")}
                className="history-icon-action"
                type="button"
                onClick={closeCodexLoginDialog}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="codex-login-dialog__body">
              {codexLoginStatus === "starting" ? (
                <div className="codex-login-dialog__status" role="status">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {t("codexCreatingCode")}
                </div>
              ) : null}

              {codexDevice ? (
                <>
                  <div className="codex-device-code" data-testid="codex-user-code">
                    {codexDevice.userCode}
                  </div>
                  <div className="codex-login-dialog__actions">
                    <a className="primary-action h-10" href={codexDevice.verificationUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" aria-hidden="true" />
                      {t("codexOpenLoginPage")}
                    </a>
                    <button className="secondary-action h-10" type="button" onClick={() => void copyCodexUserCode()}>
                      <Copy className="size-4" aria-hidden="true" />
                      {t("codexCopyCode")}
                    </button>
                  </div>
                  <p className="codex-login-dialog__hint">
                    {t("codexCodeExpires", { time: formatCodexExpiry(codexDevice.expiresAt, formatDateTime, t) })}
                  </p>
                </>
              ) : null}

              {codexLoginMessage ? (
                <p
                  className={`codex-login-dialog__message codex-login-dialog__message--${codexLoginStatus}`}
                  data-testid="codex-login-message"
                  role={codexLoginStatus === "pending" || codexLoginStatus === "authorized" ? "status" : "alert"}
                >
                  {codexLoginStatus === "pending" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  {codexLoginMessage}
                </p>
              ) : null}

              {codexLoginStatus === "expired" || codexLoginStatus === "denied" || codexLoginStatus === "error" ? (
                <button className="secondary-action h-10" type="button" onClick={() => void startCodexLogin()}>
                  <KeyRound className="size-4" aria-hidden="true" />
                  {t("codexRestart")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        ),
        document.body
      ) : null}
      </main>
      {isProviderConfigDialogOpen ? (
        <ProviderConfigDialog
          isAuthLoading={isAuthLoading}
          isCodexStarting={codexLoginStatus === "starting"}
          onClose={closeProviderConfigDialog}
          onLogoutCodex={logoutCodexSession}
          onRefreshAgentConfig={loadAgentConfig}
          onRefreshAuthStatus={loadAuthStatus}
          onStartCodexLogin={startCodexLogin}
        />
      ) : null}
      {route === "pool" ? (
        <Suspense
          fallback={
            <main className="pool-page app-view" data-testid="pool-loading-page">
              <div className="pool-empty-state" role="status">
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                <p>{t("poolLoading")}</p>
              </div>
            </main>
          }
        >
          <LazyPromptPoolPage onUsePrompt={reusePromptPoolItem} />
        </Suspense>
      ) : null}
      {route === "gallery" ? (
        <Suspense
          fallback={
            <main className="gallery-page app-view" data-testid="gallery-loading-page">
              <div className="gallery-empty-state gallery-empty-state--boot" role="status">
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                <p>{t("galleryLoading")}</p>
              </div>
            </main>
          }
        >
          <LazyGalleryPage onDeleted={removeGalleryOutputFromHistory} onReuse={reuseGalleryImage} />
        </Suspense>
      ) : null}
    </div>
  );
}
