import type {
  AssetCloudUploadStatus,
  CloudStorageProvider,
  GenerationCount,
  GenerationStatus,
  ImageMode,
  ImageQuality,
  ImageSize,
  OutputFormat,
  OutputStatus,
  StylePresetId
} from "./image.js";

export interface ReferenceImageInput {
  dataUrl: string;
  fileName?: string;
}

export const MAX_REFERENCE_IMAGES = 3;
export const GENERATION_PLAN_SCHEMA_VERSION = 1 as const;
export const MAX_GENERATION_PLAN_IMAGES = 16;
export const MAX_AGENT_SELECTED_REFERENCES = MAX_GENERATION_PLAN_IMAGES;
export const MAX_GENERATION_JOB_REFERENCES = MAX_REFERENCE_IMAGES;

export type GenerationPlanStatus =
  | "awaiting_confirmation"
  | "confirmed"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled";

export type GenerationJobStatus = "queued" | "running" | "succeeded" | "failed" | "blocked" | "cancelled";

export type GenerationJobRole =
  | "final_image"
  | "variation"
  | "character_anchor"
  | "style_anchor"
  | "reference_anchor";

export type GenerationReferenceKind = "selected_canvas_image" | "generated_output";

export type GenerationReferenceUsage =
  | "subject"
  | "character"
  | "style"
  | "composition"
  | "scene"
  | "product"
  | "other";

export interface AgentSelectedCanvasReference {
  id: string;
  assetId: string;
  label?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  dataUrl?: string;
}

export interface GenerationPlanDefaults {
  size: ImageSize;
  quality: ImageQuality;
  outputFormat: OutputFormat;
  count?: number;
  stylePresetId?: StylePresetId;
}

export interface GenerationReference {
  kind: GenerationReferenceKind;
  usage: GenerationReferenceUsage;
  assetId?: string;
  jobId?: string;
  outputId?: string;
  label?: string;
}

export interface GenerationJob {
  id: string;
  role: GenerationJobRole;
  prompt: string;
  count: number;
  size?: ImageSize;
  quality?: ImageQuality;
  outputFormat?: OutputFormat;
  references: GenerationReference[];
  status: GenerationJobStatus;
  outputs: GenerationOutput[];
  visible: boolean;
  error?: string;
}

export interface GenerationDependencyEdge {
  fromJobId: string;
  toJobId: string;
}

export interface GenerationPlan {
  schemaVersion: typeof GENERATION_PLAN_SCHEMA_VERSION;
  id: string;
  title: string;
  status: GenerationPlanStatus;
  defaults: GenerationPlanDefaults;
  jobs: GenerationJob[];
  edges: GenerationDependencyEdge[];
  createdBy: "agent";
  createdAt: string;
  updatedAt: string;
}

export type GenerationPlanValidationCode =
  | "invalid_plan_json"
  | "invalid_plan_schema"
  | "invalid_plan_defaults"
  | "invalid_plan_job"
  | "invalid_plan_reference"
  | "invalid_plan_edge"
  | "generation_plan_limit_exceeded"
  | "generation_job_reference_limit_exceeded"
  | "unknown_generation_job_reference"
  | "generation_dependency_cycle"
  | "invalid_dependency_source_count";

export interface GenerationPlanValidationIssue {
  code: GenerationPlanValidationCode;
  message: string;
  path?: string;
}

export type GenerationPlanValidationResult =
  | {
      ok: true;
      plan: GenerationPlan;
    }
  | {
      ok: false;
      code: GenerationPlanValidationCode;
      message: string;
      issues: GenerationPlanValidationIssue[];
    };

export interface GenerateImageRequest {
  prompt: string;
  clientRequestId?: string;
  presetId: StylePresetId;
  size: ImageSize;
  quality: ImageQuality;
  outputFormat: OutputFormat;
  outputCompression?: number;
  count: GenerationCount;
}

export interface EditImageRequest extends GenerateImageRequest {
  referenceImages: ReferenceImageInput[];
  referenceImage?: ReferenceImageInput;
  referenceAssetIds?: string[];
  referenceAssetId?: string;
}

export interface GeneratedAsset {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  cloud?: GeneratedAssetCloudInfo;
}

export interface GeneratedAssetCloudInfo {
  provider: CloudStorageProvider;
  status: AssetCloudUploadStatus;
  lastError?: string;
  uploadedAt?: string;
}

export interface GenerationOutput {
  id: string;
  status: OutputStatus;
  asset?: GeneratedAsset;
  error?: string;
}

export interface GenerationRecord {
  id: string;
  mode: ImageMode;
  prompt: string;
  effectivePrompt: string;
  presetId: string;
  size: ImageSize;
  quality: ImageQuality;
  outputFormat: OutputFormat;
  count: number;
  status: GenerationStatus;
  error?: string;
  referenceAssetIds?: string[];
  referenceAssetId?: string;
  createdAt: string;
  outputs: GenerationOutput[];
}

export interface GenerationResponse {
  record: GenerationRecord;
}

export interface GalleryImageItem {
  outputId: string;
  generationId: string;
  mode: ImageMode;
  prompt: string;
  effectivePrompt: string;
  presetId: string;
  size: ImageSize;
  quality: ImageQuality;
  outputFormat: OutputFormat;
  createdAt: string;
  asset: GeneratedAsset;
}

export interface GalleryResponse {
  items: GalleryImageItem[];
}

export interface GalleryExportRequest {
  outputIds: string[];
}

export interface GalleryBatchDeleteRequest {
  outputIds: string[];
}

export interface GalleryAssetDeleteRequest {
  assetIds: string[];
}
