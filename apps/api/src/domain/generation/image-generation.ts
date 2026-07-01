import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import type {
  AssetMetadataResponse,
  GeneratedAsset,
  GeneratedAssetCloudInfo,
  GenerationOutput,
  GenerationRecord,
  GenerationResponse,
  GenerationStatus,
  ImageMode,
  ImageQuality,
  ImageSize,
  OutputStatus,
  OutputFormat,
  ReferenceImageInput
} from "../contracts.js";
import { db } from "../../infrastructure/database.js";
import {
  ProviderError,
  type EditImageProviderInput,
  type ImageProvider,
  type ImageProviderInput,
  type ProviderImage
} from "../../infrastructure/providers/image-provider.js";
import {
  CosAssetStorageAdapter,
  LocalAssetStorageAdapter,
  S3CompatibleAssetStorageAdapter,
  buildCloudObjectKey,
  storageErrorMessage,
  type CosAssetLocation,
  type S3AssetLocation
} from "../../infrastructure/storage/asset-storage.js";
import { runtimePaths } from "../../infrastructure/runtime.js";
import { assets, generationOutputs, generationRecords, generationReferenceAssets } from "../../infrastructure/schema.js";
import { getActiveCloudStorageConfig } from "../storage/storage-config.js";

const BATCH_CONCURRENCY = 2;
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_REFERENCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const TRANSIENT_PROVIDER_RETRY_DELAYS_MS = [1500, 4000] as const;
const INTERRUPTED_GENERATION_ERROR = "Generation was interrupted by an API restart. Rerun it from history.";
const CANCELLED_GENERATION_ERROR = "This generation was cancelled.";
const localAssetStorage = new LocalAssetStorageAdapter();

export interface StoredAssetFile {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  cloud?: StoredCloudAssetLocation;
}

interface BatchOutputResult {
  id: string;
  status: "succeeded" | "failed";
  asset?: GeneratedAsset;
  cloudStorage?: AssetCloudStorageRecord;
  error?: string;
}

interface SavedProviderImage {
  asset: GeneratedAsset;
  cloudStorage?: AssetCloudStorageRecord;
}

interface AssetCloudStorageRecord {
  provider: "cos" | "s3";
  bucket: string;
  region: string;
  objectKey: string;
  status: "uploaded" | "failed";
  endpoint?: string;
  forcePathStyle?: boolean;
  error?: string;
  uploadedAt?: string;
  etag?: string;
  requestId?: string;
}

type StoredCloudAssetLocation =
  | ({
      provider: "cos";
    } & CosAssetLocation)
  | ({
      provider: "s3";
    } & S3AssetLocation);

type PersistedGenerationInput = ImageProviderInput & {
  mode: "generate" | "edit";
  referenceAssetIds?: string[];
  referenceAssetId?: string;
};

const mimeTypes: Record<OutputFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

export async function runTextToImageGeneration(input: ImageProviderInput, provider: ImageProvider, signal?: AbortSignal): Promise<GenerationResponse> {
  const outputs = await mapWithConcurrency(
    Array.from({ length: input.count }, (_, index) => index),
    BATCH_CONCURRENCY,
    async () => generateSingleOutput(input, provider, signal)
  );

  const record = saveCompletedGenerationRecord(
    randomUUID(),
    {
      ...input,
      mode: "generate"
    },
    outputs
  );

  return {
    record
  };
}

export async function runReferenceImageGeneration(
  input: EditImageProviderInput,
  provider: ImageProvider,
  signal?: AbortSignal
): Promise<GenerationResponse> {
  const referenceAssetIds = await ensureReferenceAssetIds(input);
  const inputWithReferenceAssets: EditImageProviderInput = {
    ...input,
    referenceAssetIds,
    referenceAssetId: referenceAssetIds[0]
  };

  const outputs = await mapWithConcurrency(
    Array.from({ length: inputWithReferenceAssets.count }, (_, index) => index),
    BATCH_CONCURRENCY,
    async () => editSingleOutput(inputWithReferenceAssets, provider, signal)
  );

  const record = saveCompletedGenerationRecord(
    randomUUID(),
    {
      ...inputWithReferenceAssets,
      mode: "edit"
    },
    outputs
  );

  return {
    record
  };
}

export function createRunningTextToImageGeneration(input: ImageProviderInput): GenerationRecord {
  return createRunningGenerationRecord({
    ...input,
    mode: "generate"
  });
}

export async function createRunningReferenceImageGeneration(
  input: EditImageProviderInput
): Promise<{ record: GenerationRecord; input: EditImageProviderInput }> {
  const referenceAssetIds = await ensureReferenceAssetIds(input);
  const inputWithReferenceAssets: EditImageProviderInput = {
    ...input,
    referenceAssetIds,
    referenceAssetId: referenceAssetIds[0]
  };

  return {
    record: createRunningGenerationRecord({
      ...inputWithReferenceAssets,
      mode: "edit"
    }),
    input: inputWithReferenceAssets
  };
}

export async function finishTextToImageGeneration(
  generationId: string,
  input: ImageProviderInput,
  provider: ImageProvider,
  signal?: AbortSignal
): Promise<GenerationRecord> {
  const outputs = await mapWithConcurrency(
    Array.from({ length: input.count }, (_, index) => index),
    BATCH_CONCURRENCY,
    async () => generateSingleOutput(input, provider, signal)
  );
  throwIfAborted(signal);

  return completeGenerationRecord(
    generationId,
    {
      ...input,
      mode: "generate"
    },
    outputs
  );
}

export async function finishReferenceImageGeneration(
  generationId: string,
  input: EditImageProviderInput,
  provider: ImageProvider,
  signal?: AbortSignal
): Promise<GenerationRecord> {
  const outputs = await mapWithConcurrency(
    Array.from({ length: input.count }, (_, index) => index),
    BATCH_CONCURRENCY,
    async () => editSingleOutput(input, provider, signal)
  );
  throwIfAborted(signal);

  return completeGenerationRecord(
    generationId,
    {
      ...input,
      mode: "edit"
    },
    outputs
  );
}

export function getGenerationRecord(generationId: string): GenerationRecord | undefined {
  return readGenerationRecord(generationId);
}

export function cancelGenerationRecord(generationId: string): GenerationRecord | undefined {
  return updateGenerationRecordStatus(generationId, "cancelled", CANCELLED_GENERATION_ERROR);
}

export function failGenerationRecord(generationId: string, error: string): GenerationRecord | undefined {
  return updateGenerationRecordStatus(generationId, "failed", sanitizeGenerationErrorMessage(error));
}

export function markInterruptedGenerationRecordsFailed(): void {
  db.update(generationRecords)
    .set({
      status: "failed",
      error: INTERRUPTED_GENERATION_ERROR
    })
    .where(inArray(generationRecords.status, ["pending", "running"]))
    .run();
}

async function ensureReferenceAssetIds(input: EditImageProviderInput): Promise<string[]> {
  return Promise.all(
    input.referenceImages.map(async (referenceImage, index) => {
      const existingAssetId = persistedReferenceAssetId(input.referenceAssetIds?.[index]);
      if (existingAssetId) {
        return existingAssetId;
      }

      const savedReferenceAsset = await saveReferenceImageInput(referenceImage);
      return savedReferenceAsset.id;
    })
  );
}

function persistedReferenceAssetId(assetId: string | undefined): string | undefined {
  if (!assetId) {
    return undefined;
  }

  for (const candidateAssetId of persistedReferenceAssetIdCandidates(assetId)) {
    const asset = db.select({ id: assets.id }).from(assets).where(eq(assets.id, candidateAssetId)).get();
    if (asset?.id) {
      return asset.id;
    }
  }

  return undefined;
}

function persistedReferenceAssetIdCandidates(assetId: string): string[] {
  const trimmedAssetId = assetId.trim();
  const candidates = [trimmedAssetId];
  const tldrawAssetMatch = /^asset:(.+)$/u.exec(trimmedAssetId);
  if (tldrawAssetMatch?.[1]) {
    candidates.push(tldrawAssetMatch[1]);
  }

  return candidates.filter((candidate, index, values) => candidate && values.indexOf(candidate) === index);
}

export async function saveReferenceImageInput(input: ReferenceImageInput): Promise<GeneratedAsset> {
  const parsed = referenceDataUrlToBytes(input);
  const imageSize = await readImageSize(parsed.bytes);
  if (!imageSize) {
    throw new ProviderError("unsupported_provider_behavior", "Reference image dimensions could not be read.", 400);
  }

  const assetId = randomUUID();
  const extension = extensionForMimeType(parsed.mimeType);
  const fileName = `${assetId}.${extension}`;
  const relativePath = `assets/${fileName}`;
  const filePath = resolve(runtimePaths.dataDir, relativePath);
  const createdAt = new Date().toISOString();

  await localAssetStorage.putObject({ filePath, bytes: parsed.bytes });
  db.insert(assets)
    .values({
      id: assetId,
      fileName,
      relativePath,
      mimeType: parsed.mimeType,
      width: imageSize.width,
      height: imageSize.height,
      createdAt
    })
    .run();

  return {
    id: assetId,
    url: `/api/assets/${assetId}`,
    fileName,
    mimeType: parsed.mimeType,
    width: imageSize.width,
    height: imageSize.height
  };
}

function referenceDataUrlToBytes(input: ReferenceImageInput): { bytes: Buffer; mimeType: string } {
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(input.dataUrl);
  if (!match) {
    throw new ProviderError("unsupported_provider_behavior", "参考图像格式不受支持。", 400);
  }

  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType)) {
    throw new ProviderError("unsupported_provider_behavior", "参考图像必须是 PNG、JPEG 或 WebP 格式。", 400);
  }

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new ProviderError("unsupported_provider_behavior", "参考图像不能超过 50MB。", 400);
  }

  return {
    bytes,
    mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType
  };
}

function extensionForMimeType(mimeType: string): string {
  return mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] || "png";
}

export function getStoredAssetFile(assetId: string): StoredAssetFile | undefined {
  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset) {
    return undefined;
  }

  const filePath = resolve(runtimePaths.dataDir, asset.relativePath);
  if (!isInsideDirectory(filePath, runtimePaths.assetsDir)) {
    return undefined;
  }

  return {
    id: asset.id,
    fileName: asset.fileName,
    filePath,
    mimeType: asset.mimeType,
    cloud: toCloudAssetLocation(asset)
  };
}

export async function readStoredAsset(assetId: string): Promise<{ file: StoredAssetFile; bytes: Buffer } | undefined> {
  const file = getStoredAssetFile(assetId);
  if (!file) {
    return undefined;
  }

  try {
    return {
      file,
      bytes: await localAssetStorage.getObject({ filePath: file.filePath })
    };
  } catch {
    const bytes = await readCloudAsset(file.cloud);
    if (!bytes) {
      return undefined;
    }

    void localAssetStorage.putObject({ filePath: file.filePath, bytes }).catch(() => undefined);
    return {
      file,
      bytes
    };
  }
}

export async function readStoredAssetMetadata(assetId: string): Promise<AssetMetadataResponse | undefined> {
  const asset = await readStoredAsset(assetId);
  if (!asset) {
    return undefined;
  }

  const size = await readImageSize(asset.bytes);
  if (!size) {
    return undefined;
  }

  return {
    id: asset.file.id,
    width: size.width,
    height: size.height
  };
}

async function generateSingleOutput(input: ImageProviderInput, provider: ImageProvider, signal?: AbortSignal): Promise<BatchOutputResult> {
  const outputId = randomUUID();

  try {
    throwIfAborted(signal);
    const result = await callProviderWithRetry(
      () =>
        provider.generate(
          {
            ...input,
            count: 1
          },
          signal
        ),
      signal
    );
    throwIfAborted(signal);

    const providerImage = result.images[0];
    if (!providerImage) {
      throw new ProviderError("unsupported_provider_behavior", "上游图像服务没有返回图像结果。", 502);
    }

    const saved = await saveProviderImage(providerImage, input, signal);

    return {
      id: outputId,
      status: "succeeded",
      asset: saved.asset,
      cloudStorage: saved.cloudStorage
    };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw error;
    }

    return {
      id: outputId,
      status: "failed",
      error: errorToMessage(error)
    };
  }
}

async function editSingleOutput(input: EditImageProviderInput, provider: ImageProvider, signal?: AbortSignal): Promise<BatchOutputResult> {
  const outputId = randomUUID();

  try {
    throwIfAborted(signal);
    const result = await callProviderWithRetry(
      () =>
        provider.edit(
          {
            ...input,
            count: 1
          },
          signal
        ),
      signal
    );
    throwIfAborted(signal);

    const providerImage = result.images[0];
    if (!providerImage) {
      throw new ProviderError("unsupported_provider_behavior", "上游图像服务没有返回图像结果。", 502);
    }

    const saved = await saveProviderImage(providerImage, input, signal);

    return {
      id: outputId,
      status: "succeeded",
      asset: saved.asset,
      cloudStorage: saved.cloudStorage
    };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw error;
    }

    return {
      id: outputId,
      status: "failed",
      error: errorToMessage(error)
    };
  }
}

async function saveProviderImage(image: ProviderImage, input: ImageProviderInput, _signal?: AbortSignal): Promise<SavedProviderImage> {
  const assetId = randomUUID();
  const fileName = `${assetId}.${input.outputFormat === "jpeg" ? "jpg" : input.outputFormat}`;
  const relativePath = `assets/${fileName}`;
  const filePath = resolve(runtimePaths.dataDir, relativePath);
  const mimeType = mimeTypes[input.outputFormat];
  const bytes = Buffer.from(image.b64Json, "base64");
  const imageSize = await readImageSize(bytes);

  if (!imageSize) {
    throw new ProviderError("unsupported_provider_behavior", "Generated image dimensions could not be read.", 502);
  }

  await localAssetStorage.putObject({ filePath, bytes });
  const cloudStorage = await saveAssetToConfiguredCloud({
    fileName,
    bytes,
    mimeType,
    createdAt: new Date().toISOString()
  });

  return {
    asset: {
      id: assetId,
      url: `/api/assets/${assetId}`,
      fileName,
      mimeType,
      width: imageSize.width,
      height: imageSize.height,
      cloud: toGeneratedAssetCloud(cloudStorage)
    },
    cloudStorage
  };
}

async function readImageSize(bytes: Buffer): Promise<ImageSize | undefined> {
  try {
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height) {
      return undefined;
    }

    return {
      width: metadata.width,
      height: metadata.height
    };
  } catch {
    return undefined;
  }
}

function createRunningGenerationRecord(input: PersistedGenerationInput): GenerationRecord {
  const createdAt = new Date().toISOString();
  const generationId = input.clientRequestId || randomUUID();
  const existing = readGenerationRecord(generationId);
  if (existing) {
    return existing;
  }

  const referenceAssetIds = input.referenceAssetIds ?? (input.referenceAssetId ? [input.referenceAssetId] : []);
  const primaryReferenceAssetId = referenceAssetIds[0] ?? input.referenceAssetId;

  db.insert(generationRecords)
    .values({
      id: generationId,
      mode: input.mode,
      prompt: input.originalPrompt,
      effectivePrompt: input.prompt,
      presetId: input.presetId,
      width: input.size.width,
      height: input.size.height,
      quality: input.quality,
      outputFormat: input.outputFormat,
      count: input.count,
      status: "running",
      error: null,
      referenceAssetId: primaryReferenceAssetId ?? null,
      createdAt
    })
    .run();

  referenceAssetIds.forEach((assetId, position) => {
    db.insert(generationReferenceAssets)
      .values({
        generationId,
        assetId,
        position,
        createdAt
      })
      .run();
  });

  return {
    id: generationId,
    mode: input.mode,
    prompt: input.originalPrompt,
    effectivePrompt: input.prompt,
    presetId: input.presetId,
    size: input.size,
    quality: input.quality,
    outputFormat: input.outputFormat,
    count: input.count,
    status: "running",
    referenceAssetIds: referenceAssetIds.length > 0 ? referenceAssetIds : undefined,
    referenceAssetId: primaryReferenceAssetId,
    createdAt,
    outputs: []
  };
}

function completeGenerationRecord(generationId: string, input: PersistedGenerationInput, outputs: BatchOutputResult[]): GenerationRecord {
  const existing = readGenerationRecord(generationId);
  if (existing && isTerminalGenerationStatus(existing.status)) {
    return existing;
  }

  const successCount = outputs.filter((output) => output.status === "succeeded").length;
  const failureCount = outputs.length - successCount;
  const status = resolveGenerationStatus(successCount, failureCount);
  const error = failureCount > 0 ? `${failureCount} images failed.` : undefined;
  const referenceAssetIds = input.referenceAssetIds ?? (input.referenceAssetId ? [input.referenceAssetId] : []);
  const primaryReferenceAssetId = referenceAssetIds[0] ?? input.referenceAssetId;

  db.update(generationRecords)
    .set({
      status,
      error: error ?? null,
      referenceAssetId: primaryReferenceAssetId ?? null
    })
    .where(eq(generationRecords.id, generationId))
    .run();

  db.delete(generationOutputs).where(eq(generationOutputs.generationId, generationId)).run();

  insertGenerationOutputs(generationId, outputs);

  return readGenerationRecord(generationId) ?? {
    id: generationId,
    mode: input.mode,
    prompt: input.originalPrompt,
    effectivePrompt: input.prompt,
    presetId: input.presetId,
    size: input.size,
    quality: input.quality,
    outputFormat: input.outputFormat,
    count: input.count,
    status,
    error,
    referenceAssetIds: referenceAssetIds.length > 0 ? referenceAssetIds : undefined,
    referenceAssetId: primaryReferenceAssetId,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    outputs: outputs.map(toGenerationOutput)
  };
}

function saveCompletedGenerationRecord(generationId: string, input: PersistedGenerationInput, outputs: BatchOutputResult[]): GenerationRecord {
  const createdAt = new Date().toISOString();
  const successCount = outputs.filter((output) => output.status === "succeeded").length;
  const failureCount = outputs.length - successCount;
  const status = resolveGenerationStatus(successCount, failureCount);
  const error = failureCount > 0 ? `${failureCount} 张图像生成失败。` : undefined;

  const referenceAssetIds = input.referenceAssetIds ?? (input.referenceAssetId ? [input.referenceAssetId] : []);
  const primaryReferenceAssetId = referenceAssetIds[0] ?? input.referenceAssetId;

  db.insert(generationRecords)
    .values({
      id: generationId,
      mode: input.mode,
      prompt: input.originalPrompt,
      effectivePrompt: input.prompt,
      presetId: input.presetId,
      width: input.size.width,
      height: input.size.height,
      quality: input.quality,
      outputFormat: input.outputFormat,
      count: input.count,
      status,
      error,
      referenceAssetId: primaryReferenceAssetId ?? null,
      createdAt
    })
    .run();

  referenceAssetIds.forEach((assetId, position) => {
    db.insert(generationReferenceAssets)
      .values({
        generationId,
        assetId,
        position,
        createdAt
      })
      .run();
  });

  for (const output of outputs) {
    if (output.asset) {
      db.insert(assets)
        .values({
          id: output.asset.id,
          fileName: output.asset.fileName,
          relativePath: `assets/${output.asset.fileName}`,
          mimeType: output.asset.mimeType,
          width: output.asset.width,
          height: output.asset.height,
          cloudProvider: output.cloudStorage?.provider ?? null,
          cloudBucket: output.cloudStorage?.bucket ?? null,
          cloudRegion: output.cloudStorage?.region ?? null,
          cloudObjectKey: output.cloudStorage?.objectKey ?? null,
          cloudStatus: output.cloudStorage?.status ?? null,
          cloudError: output.cloudStorage?.error ?? null,
          cloudUploadedAt: output.cloudStorage?.uploadedAt ?? null,
          cloudEtag: output.cloudStorage?.etag ?? null,
          cloudRequestId: output.cloudStorage?.requestId ?? null,
          cloudEndpoint: output.cloudStorage?.endpoint ?? null,
          cloudForcePathStyle: output.cloudStorage?.provider === "s3" ? (output.cloudStorage.forcePathStyle ? 1 : 0) : null,
          createdAt
        })
        .run();
    }

    db.insert(generationOutputs)
      .values({
        id: output.id,
        generationId,
        status: output.status,
        assetId: output.asset?.id ?? null,
        error: output.error ?? null,
        createdAt
      })
      .run();
  }

  return {
    id: generationId,
    mode: input.mode,
    prompt: input.originalPrompt,
    effectivePrompt: input.prompt,
    presetId: input.presetId,
    size: input.size,
    quality: input.quality,
    outputFormat: input.outputFormat,
    count: input.count,
    status,
    error,
    referenceAssetIds: referenceAssetIds.length > 0 ? referenceAssetIds : undefined,
    referenceAssetId: primaryReferenceAssetId,
    createdAt,
    outputs: outputs.map(toGenerationOutput)
  };
}

function insertGenerationOutputs(generationId: string, outputs: BatchOutputResult[]): void {
  const createdAt = new Date().toISOString();

  for (const output of outputs) {
    if (output.asset) {
      db.insert(assets)
        .values({
          id: output.asset.id,
          fileName: output.asset.fileName,
          relativePath: `assets/${output.asset.fileName}`,
          mimeType: output.asset.mimeType,
          width: output.asset.width,
          height: output.asset.height,
          cloudProvider: output.cloudStorage?.provider ?? null,
          cloudBucket: output.cloudStorage?.bucket ?? null,
          cloudRegion: output.cloudStorage?.region ?? null,
          cloudObjectKey: output.cloudStorage?.objectKey ?? null,
          cloudStatus: output.cloudStorage?.status ?? null,
          cloudError: output.cloudStorage?.error ?? null,
          cloudUploadedAt: output.cloudStorage?.uploadedAt ?? null,
          cloudEtag: output.cloudStorage?.etag ?? null,
          cloudRequestId: output.cloudStorage?.requestId ?? null,
          cloudEndpoint: output.cloudStorage?.endpoint ?? null,
          cloudForcePathStyle: output.cloudStorage?.provider === "s3" ? (output.cloudStorage.forcePathStyle ? 1 : 0) : null,
          createdAt
        })
        .run();
    }

    db.insert(generationOutputs)
      .values({
        id: output.id,
        generationId,
        status: output.status,
        assetId: output.asset?.id ?? null,
        error: output.error ?? null,
        createdAt
      })
      .run();
  }
}

function updateGenerationRecordStatus(
  generationId: string,
  status: Extract<GenerationStatus, "cancelled" | "failed">,
  error: string
): GenerationRecord | undefined {
  const existing = readGenerationRecord(generationId);
  if (!existing) {
    return undefined;
  }

  if (isTerminalGenerationStatus(existing.status)) {
    return existing;
  }

  db.update(generationRecords)
    .set({
      status,
      error
    })
    .where(eq(generationRecords.id, generationId))
    .run();

  return readGenerationRecord(generationId);
}

function isTerminalGenerationStatus(status: GenerationStatus): boolean {
  return status === "succeeded" || status === "partial" || status === "failed" || status === "cancelled";
}

function readGenerationRecord(generationId: string): GenerationRecord | undefined {
  const record = db.select().from(generationRecords).where(eq(generationRecords.id, generationId)).get();
  if (!record) {
    return undefined;
  }

  const outputRows = db
    .select()
    .from(generationOutputs)
    .where(eq(generationOutputs.generationId, generationId))
    .orderBy(generationOutputs.createdAt)
    .all();
  const referenceRows = db
    .select()
    .from(generationReferenceAssets)
    .where(eq(generationReferenceAssets.generationId, generationId))
    .all()
    .sort((left, right) => left.position - right.position);
  const assetIds = outputRows.flatMap((output) => (output.assetId ? [output.assetId] : []));
  const assetRows = assetIds.length > 0 ? db.select().from(assets).where(inArray(assets.id, assetIds)).all() : [];
  const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));
  const referenceAssetIds = referenceRows.map((referenceRow) => referenceRow.assetId);

  return {
    id: record.id,
    mode: record.mode as ImageMode,
    prompt: record.prompt,
    effectivePrompt: record.effectivePrompt,
    presetId: record.presetId,
    size: {
      width: record.width,
      height: record.height
    },
    quality: record.quality as ImageQuality,
    outputFormat: record.outputFormat as OutputFormat,
    count: record.count,
    status: record.status as GenerationStatus,
    error: record.error ?? undefined,
    referenceAssetIds: referenceAssetIds.length > 0 ? referenceAssetIds : record.referenceAssetId ? [record.referenceAssetId] : undefined,
    referenceAssetId: record.referenceAssetId ?? undefined,
    createdAt: record.createdAt,
    outputs: outputRows.map((output) => ({
      id: output.id,
      status: output.status as OutputStatus,
      asset: output.assetId ? toGeneratedAsset(assetById.get(output.assetId)) : undefined,
      error: output.error ?? undefined
    }))
  };
}

function toGeneratedAsset(asset: (typeof assets.$inferSelect) | undefined): GeneratedAsset | undefined {
  if (!asset) {
    return undefined;
  }

  return {
    id: asset.id,
    url: `/api/assets/${asset.id}`,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    cloud:
      (asset.cloudProvider === "cos" || asset.cloudProvider === "s3") && (asset.cloudStatus === "uploaded" || asset.cloudStatus === "failed")
        ? {
            provider: asset.cloudProvider,
            status: asset.cloudStatus,
            lastError: asset.cloudError ?? undefined,
            uploadedAt: asset.cloudUploadedAt ?? undefined
          }
        : undefined
  };
}

function resolveGenerationStatus(successCount: number, failureCount: number): GenerationStatus {
  if (successCount > 0 && failureCount > 0) {
    return "partial";
  }
  if (successCount > 0) {
    return "succeeded";
  }
  return "failed";
}

function toGenerationOutput(output: BatchOutputResult): GenerationOutput {
  return {
    id: output.id,
    status: output.status,
    asset: output.asset,
    error: output.error
  };
}

async function saveAssetToConfiguredCloud(input: {
  fileName: string;
  bytes: Buffer;
  mimeType: string;
  createdAt: string;
}): Promise<AssetCloudStorageRecord | undefined> {
  const active = getActiveCloudStorageConfig();
  if (!active) {
    return undefined;
  }

  const objectKey = buildCloudObjectKey(active.config.keyPrefix, input.fileName, input.createdAt);

  try {
    const result =
      active.provider === "cos"
        ? await new CosAssetStorageAdapter(active.config).putObject({
            key: objectKey,
            bytes: input.bytes,
            mimeType: input.mimeType
          })
        : await new S3CompatibleAssetStorageAdapter(active.config).putObject({
            key: objectKey,
            bytes: input.bytes,
            mimeType: input.mimeType
          });

    return {
      provider: active.provider,
      bucket: active.config.bucket,
      region: active.config.region,
      objectKey,
      status: "uploaded",
      endpoint: active.provider === "s3" ? active.config.endpoint : undefined,
      forcePathStyle: active.provider === "s3" ? active.config.forcePathStyle : undefined,
      uploadedAt: new Date().toISOString(),
      etag: result.etag,
      requestId: result.requestId
    };
  } catch (error) {
    return {
      provider: active.provider,
      bucket: active.config.bucket,
      region: active.config.region,
      objectKey,
      status: "failed",
      endpoint: active.provider === "s3" ? active.config.endpoint : undefined,
      forcePathStyle: active.provider === "s3" ? active.config.forcePathStyle : undefined,
      error: storageErrorMessage(error)
    };
  }
}

async function readCloudAsset(location: StoredCloudAssetLocation | undefined): Promise<Buffer | undefined> {
  const active = getActiveCloudStorageConfig();
  if (!location || !active || location.provider !== active.provider) {
    return undefined;
  }

  try {
    if (active.provider === "cos" && location.provider === "cos") {
      return await new CosAssetStorageAdapter(active.config).getObject(location);
    }

    if (active.provider !== "s3" || location.provider !== "s3") {
      return undefined;
    }

    return await new S3CompatibleAssetStorageAdapter({
      ...active.config,
      bucket: location.bucket,
      region: location.region,
      endpoint: location.endpoint,
      forcePathStyle: location.forcePathStyle
    }).getObject(location);
  } catch {
    return undefined;
  }
}

function toCloudAssetLocation(asset: typeof assets.$inferSelect): StoredCloudAssetLocation | undefined {
  if (
    (asset.cloudProvider !== "cos" && asset.cloudProvider !== "s3") ||
    asset.cloudStatus !== "uploaded" ||
    !asset.cloudBucket ||
    !asset.cloudRegion ||
    !asset.cloudObjectKey
  ) {
    return undefined;
  }

  if (asset.cloudProvider === "cos") {
    return {
      provider: "cos",
      bucket: asset.cloudBucket,
      region: asset.cloudRegion,
      key: asset.cloudObjectKey
    };
  }

  if (!asset.cloudEndpoint) {
    return undefined;
  }

  return {
    provider: "s3",
    bucket: asset.cloudBucket,
    region: asset.cloudRegion,
    key: asset.cloudObjectKey,
    endpoint: asset.cloudEndpoint,
    forcePathStyle: asset.cloudForcePathStyle === 1
  };
}

function toGeneratedAssetCloud(cloudStorage: AssetCloudStorageRecord | undefined): GeneratedAssetCloudInfo | undefined {
  if (!cloudStorage) {
    return undefined;
  }

  return {
    provider: cloudStorage.provider,
    status: cloudStorage.status,
    lastError: cloudStorage.error,
    uploadedAt: cloudStorage.uploadedAt
  };
}

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function callProviderWithRetry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= TRANSIENT_PROVIDER_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      throwIfAborted(signal);
      return await operation();
    } catch (error) {
      if (isAbortError(error) || signal?.aborted || !isTransientProviderError(error)) {
        throw error;
      }

      lastError = error;
      const delayMs = TRANSIENT_PROVIDER_RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined) {
        break;
      }

      await delay(delayMs, signal);
    }
  }

  throw lastError;
}

function isTransientProviderError(error: unknown): boolean {
  if (!(error instanceof ProviderError)) {
    return false;
  }

  if (error.status === 429 || error.status === 503 || error.status === 504) {
    return true;
  }

  return (
    error.status === 502 &&
    /stream disconnected|connection|timeout|temporar|upstream/iu.test(error.message)
  );
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  await new Promise<void>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const abort = (): void => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", abort, { once: true });
  });
}

function errorToMessage(error: unknown): string {
  if (error instanceof ProviderError) {
    return sanitizeGenerationErrorMessage(error.message);
  }
  if (error instanceof Error && error.message) {
    return sanitizeGenerationErrorMessage(error.message);
  }
  return "图像生成失败，请重试。";
}

function sanitizeGenerationErrorMessage(message: string): string {
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[redacted]")
    .trim()
    .slice(0, 1200);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  const localPath = relative(directory, filePath);
  return Boolean(localPath) && !localPath.startsWith("..") && !isAbsolute(localPath);
}
