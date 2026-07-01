import { createHash } from "node:crypto";
import { readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { and, desc, eq, inArray } from "drizzle-orm";
import type {
  GeneratedAsset,
  GalleryImageItem,
  GalleryResponse,
  GenerationRecord as ApiGenerationRecord,
  GenerationStatus,
  ImageMode,
  ImageQuality,
  OutputFormat,
  OutputStatus,
  ProjectState
} from "../contracts.js";
import { db } from "../../infrastructure/database.js";
import { runtimePaths } from "../../infrastructure/runtime.js";
import { assets, generationOutputs, generationRecords, generationReferenceAssets, projects } from "../../infrastructure/schema.js";

export const DEFAULT_PROJECT_ID = "default";
const DEFAULT_PROJECT_NAME = "Default Project";
const PROJECT_SNAPSHOT_BACKUP_COUNT_LIMIT = readPositiveIntegerEnv("PROJECT_SNAPSHOT_BACKUP_MAX_COUNT", 20);
const PROJECT_SNAPSHOT_BACKUP_TOTAL_BYTES_LIMIT = readPositiveIntegerEnv(
  "PROJECT_SNAPSHOT_BACKUP_MAX_BYTES",
  256 * 1024 * 1024
);
const PROJECT_SNAPSHOT_BACKUP_MIN_COUNT = Math.min(
  readPositiveIntegerEnv("PROJECT_SNAPSHOT_BACKUP_MIN_COUNT", 3),
  PROJECT_SNAPSHOT_BACKUP_COUNT_LIMIT
);
const PROJECT_SNAPSHOT_BACKUP_MIN_INTERVAL_MS = readPositiveIntegerEnv(
  "PROJECT_SNAPSHOT_BACKUP_MIN_INTERVAL_MS",
  5 * 60 * 1000
);
const LARGE_PROJECT_SNAPSHOT_BYTES = 1024 * 1024;
const EMPTY_PROJECT_OVERWRITE_BYTES = 16 * 1024;
const EMPTY_PROJECT_STORE_RECORDS = 2;
const fallbackWarnings = new Set<string>();

interface ProjectSnapshotInput {
  name?: string;
  snapshotJson: string;
}

export interface GalleryExportAsset {
  outputId: string;
  assetId: string;
  fileName: string;
  mimeType: string;
}

export class ProjectStoreUnavailableError extends Error {
  readonly code = "project_unavailable";
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ProjectStoreUnavailableError";
    this.cause = cause;
  }
}

export class ProjectSnapshotOverwriteRejectedError extends Error {
  readonly code = "project_snapshot_overwrite_rejected";
}

interface EnsureDefaultProjectOptions {
  backupExisting: boolean;
}

interface SnapshotStats {
  bytes: number;
  storeRecords: number;
  shapeRecords: number;
  assetRecords: number;
  meaningful: boolean;
}

interface ProjectSnapshotBackupFile {
  filePath: string;
  fileName: string;
  mtimeMs: number;
  size: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSnapshot(snapshotJson: string): unknown | null {
  try {
    return JSON.parse(snapshotJson) as unknown;
  } catch (error) {
    throw new ProjectStoreUnavailableError("Saved project snapshot could not be parsed.", error);
  }
}

export function ensureDefaultProject(): void {
  ensureDefaultProjectRow({ backupExisting: true });
}

function ensureDefaultProjectRow(options: EnsureDefaultProjectOptions): void {
  const existing = getDefaultProjectRow();

  if (existing) {
    if (options.backupExisting) {
      tryWriteProjectSnapshotBackup(existing.snapshotJson, existing.updatedAt);
    }
    return;
  }
  if (defaultProjectRowExists()) {
    return;
  }

  const createdAt = nowIso();
  db.insert(projects)
    .values({
      id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      snapshotJson: "null",
      createdAt,
      updatedAt: createdAt
    })
    .run();
}

export function saveProjectSnapshot(input: ProjectSnapshotInput): ProjectState {
  ensureDefaultProjectRow({ backupExisting: false });

  const updatedAt = nowIso();
  const current = getDefaultProjectRow();
  if (current && shouldRejectDestructiveSnapshotSave(current.snapshotJson, input.snapshotJson)) {
    throw new ProjectSnapshotOverwriteRejectedError(
      "Refusing to overwrite a non-empty saved canvas with an empty snapshot."
    );
  }

  tryWriteProjectSnapshotBackup(input.snapshotJson, updatedAt);

  db.update(projects)
    .set({
      name: input.name ?? current?.name ?? DEFAULT_PROJECT_NAME,
      snapshotJson: input.snapshotJson,
      updatedAt
    })
    .where(eq(projects.id, DEFAULT_PROJECT_ID))
    .run();

  return getProjectState();
}

export function getProjectState(): ProjectState {
  ensureDefaultProject();

  const project = getDefaultProjectRow();

  if (!project) {
    return {
      id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      snapshot: null,
      history: getGenerationHistory(),
      updatedAt: nowIso()
    };
  }

  return {
    id: project.id,
    name: project.name,
    snapshot: parseSnapshot(project.snapshotJson),
    history: getGenerationHistory(),
    updatedAt: project.updatedAt
  };
}

export function getGalleryImages(): GalleryResponse {
  const rows = db
    .select({
      output: generationOutputs,
      generation: generationRecords,
      asset: assets
    })
    .from(generationOutputs)
    .innerJoin(generationRecords, eq(generationOutputs.generationId, generationRecords.id))
    .innerJoin(assets, eq(generationOutputs.assetId, assets.id))
    .where(eq(generationOutputs.status, "succeeded"))
    .orderBy(desc(generationOutputs.createdAt))
    .all();

  return {
    items: rows.map(({ output, generation, asset }) => ({
      outputId: output.id,
      generationId: generation.id,
      mode: generation.mode as ImageMode,
      prompt: generation.prompt,
      effectivePrompt: generation.effectivePrompt,
      presetId: generation.presetId,
      size: {
        width: generation.width,
        height: generation.height
      },
      quality: generation.quality as ImageQuality,
      outputFormat: generation.outputFormat as OutputFormat,
      createdAt: output.createdAt,
      asset: toGeneratedAsset(asset)
    })).filter((item): item is GalleryImageItem => Boolean(item.asset))
  };
}

export function deleteGalleryOutput(outputId: string): boolean {
  const result = db.delete(generationOutputs).where(eq(generationOutputs.id, outputId)).run();
  return result.changes > 0;
}

export function deleteGalleryOutputs(outputIds: string[]): string[] {
  if (outputIds.length === 0) {
    return [];
  }

  const deletedOutputIds: string[] = [];
  for (const outputId of outputIds) {
    if (deleteGalleryOutput(outputId)) {
      deletedOutputIds.push(outputId);
    }
  }

  return deletedOutputIds;
}

export function deleteGalleryOutputsByAssetIds(assetIds: string[]): string[] {
  if (assetIds.length === 0) {
    return [];
  }

  const rows = db
    .select({
      outputId: generationOutputs.id
    })
    .from(generationOutputs)
    .where(and(inArray(generationOutputs.assetId, assetIds), eq(generationOutputs.status, "succeeded")))
    .all();

  return deleteGalleryOutputs(rows.map((row) => row.outputId));
}

export function getGalleryExportAssets(outputIds: string[]): GalleryExportAsset[] {
  if (outputIds.length === 0) {
    return [];
  }

  const rows = db
    .select({
      outputId: generationOutputs.id,
      assetId: assets.id,
      fileName: assets.fileName,
      mimeType: assets.mimeType
    })
    .from(generationOutputs)
    .innerJoin(assets, eq(generationOutputs.assetId, assets.id))
    .where(and(inArray(generationOutputs.id, outputIds), eq(generationOutputs.status, "succeeded")))
    .all();

  const rowByOutputId = new Map(rows.map((row) => [row.outputId, row]));
  return outputIds.flatMap((outputId) => {
    const row = rowByOutputId.get(outputId);
    return row ? [row] : [];
  });
}

function getDefaultProjectRow(): (typeof projects.$inferSelect) | undefined {
  try {
    return db.select().from(projects).where(eq(projects.id, DEFAULT_PROJECT_ID)).get();
  } catch (error) {
    throw new ProjectStoreUnavailableError("Saved project row could not be read.", error);
  }
}

function defaultProjectRowExists(): boolean {
  try {
    const row = db.select({ id: projects.id }).from(projects).where(eq(projects.id, DEFAULT_PROJECT_ID)).get();
    return Boolean(row);
  } catch (error) {
    throw new ProjectStoreUnavailableError("Saved project row existence could not be checked.", error);
  }
}

function getGenerationHistory(): ApiGenerationRecord[] {
  try {
    return readGenerationHistory();
  } catch (error) {
    warnOnce(
      "history-read-fallback",
      `Generation history could not be read; returning an empty history. ${formatErrorSummary(error)}`
    );
    return [];
  }
}

function warnOnce(key: string, message: string): void {
  if (fallbackWarnings.has(key)) {
    return;
  }

  fallbackWarnings.add(key);
  console.warn(message);
}

function formatErrorSummary(error: unknown): string {
  if (error instanceof Error) {
    const codeValue = (error as { code?: unknown }).code;
    const code = typeof codeValue === "string" ? `${codeValue}: ` : "";
    return `${code}${error.message}`;
  }

  return String(error);
}

function shouldRejectDestructiveSnapshotSave(currentSnapshotJson: string, nextSnapshotJson: string): boolean {
  const current = snapshotStats(currentSnapshotJson);
  const next = snapshotStats(nextSnapshotJson);

  return (
    current.meaningful &&
    current.bytes >= LARGE_PROJECT_SNAPSHOT_BYTES &&
    next.bytes <= EMPTY_PROJECT_OVERWRITE_BYTES &&
    next.storeRecords <= EMPTY_PROJECT_STORE_RECORDS &&
    next.shapeRecords === 0 &&
    next.assetRecords === 0
  );
}

function snapshotStats(snapshotJson: string): SnapshotStats {
  const bytes = Buffer.byteLength(snapshotJson, "utf8");
  const snapshot = parseSnapshot(snapshotJson);
  const store = snapshotStore(snapshot);
  const keys = store ? Object.keys(store) : [];
  const shapeRecords = keys.filter((key) => key.startsWith("shape:")).length;
  const assetRecords = keys.filter((key) => key.startsWith("asset:")).length;

  return {
    bytes,
    storeRecords: keys.length,
    shapeRecords,
    assetRecords,
    meaningful: bytes >= LARGE_PROJECT_SNAPSHOT_BYTES || shapeRecords > 0 || assetRecords > 0
  };
}

function snapshotStore(snapshot: unknown): Record<string, unknown> | undefined {
  if (!isRecord(snapshot)) {
    return undefined;
  }

  const document = snapshot.document;
  if (isRecord(document) && isRecord(document.store)) {
    return document.store;
  }

  return isRecord(snapshot.store) ? snapshot.store : undefined;
}

function tryWriteProjectSnapshotBackup(snapshotJson: string, updatedAt: string): void {
  try {
    writeProjectSnapshotBackup(snapshotJson, updatedAt);
  } catch (error) {
    warnOnce("project-snapshot-backup-write-failed", `Project snapshot backup write failed. ${formatErrorSummary(error)}`);
  }

  try {
    pruneProjectSnapshotBackups();
  } catch (error) {
    warnOnce("project-snapshot-backup-prune-failed", `Project snapshot backup prune failed. ${formatErrorSummary(error)}`);
  }
}

function writeProjectSnapshotBackup(snapshotJson: string, updatedAt: string): void {
  const stats = snapshotStats(snapshotJson);
  if (!stats.meaningful) {
    return;
  }

  const hash = createHash("sha256").update(snapshotJson).digest("hex");
  if (backupExists(hash)) {
    return;
  }
  if (shouldDelayProjectSnapshotBackup()) {
    return;
  }

  const timestamp = safeTimestamp(updatedAt);
  const hashPrefix = hash.slice(0, 16);
  const fileName = `${timestamp}-${hashPrefix}.json.gz`;
  const tempFileName = `.${fileName}.${process.pid}.tmp`;
  const finalPath = join(runtimePaths.projectSnapshotBackupsDir, fileName);
  const tempPath = join(runtimePaths.projectSnapshotBackupsDir, tempFileName);

  writeFileSync(tempPath, gzipSync(snapshotJson));
  renameSync(tempPath, finalPath);
}

function backupExists(hash: string): boolean {
  const hashPrefix = hash.slice(0, 16);
  return readdirSync(runtimePaths.projectSnapshotBackupsDir).some((fileName) =>
    fileName.endsWith(`${hashPrefix}.json.gz`)
  );
}

function shouldDelayProjectSnapshotBackup(): boolean {
  const latestBackup = readProjectSnapshotBackups()[0];
  if (!latestBackup) {
    return false;
  }

  return Date.now() - latestBackup.mtimeMs < PROJECT_SNAPSHOT_BACKUP_MIN_INTERVAL_MS;
}

function pruneProjectSnapshotBackups(): void {
  const backups = readProjectSnapshotBackups();
  let keptCount = 0;
  let keptBytes = 0;

  for (const backup of backups) {
    const keepForRecoveryFloor = keptCount < PROJECT_SNAPSHOT_BACKUP_MIN_COUNT;
    const keepWithinCountLimit = keptCount < PROJECT_SNAPSHOT_BACKUP_COUNT_LIMIT;
    const keepWithinBytesLimit = keptBytes + backup.size <= PROJECT_SNAPSHOT_BACKUP_TOTAL_BYTES_LIMIT;

    if (keepForRecoveryFloor || (keepWithinCountLimit && keepWithinBytesLimit)) {
      keptCount += 1;
      keptBytes += backup.size;
      continue;
    }

    rmSync(backup.filePath, { force: true });
  }
}

function readProjectSnapshotBackups(): ProjectSnapshotBackupFile[] {
  return readdirSync(runtimePaths.projectSnapshotBackupsDir)
    .flatMap((fileName): ProjectSnapshotBackupFile[] => {
      if (!fileName.endsWith(".json.gz")) {
        return [];
      }

      const filePath = join(runtimePaths.projectSnapshotBackupsDir, fileName);
      let stats: ReturnType<typeof statSync>;
      try {
        stats = statSync(filePath);
      } catch {
        return [];
      }
      if (!stats.isFile()) {
        return [];
      }

      return [
        {
          filePath,
          fileName,
          mtimeMs: stats.mtimeMs,
          size: stats.size
        }
      ];
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs || right.fileName.localeCompare(left.fileName));
}

function safeTimestamp(value: string): string {
  const date = new Date(value);
  const iso = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();

  return iso.replace(/[:.]/gu, "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readGenerationHistory(): ApiGenerationRecord[] {
  const records = db.select().from(generationRecords).orderBy(desc(generationRecords.createdAt)).limit(20).all();
  if (records.length === 0) {
    return [];
  }

  const generationIds = records.map((record) => record.id);
  const outputs = db
    .select()
    .from(generationOutputs)
    .where(inArray(generationOutputs.generationId, generationIds))
    .orderBy(generationOutputs.createdAt)
    .all();
  const referenceRows = db
    .select()
    .from(generationReferenceAssets)
    .where(inArray(generationReferenceAssets.generationId, generationIds))
    .all()
    .sort((left, right) =>
      left.generationId === right.generationId
        ? left.position - right.position
        : left.generationId.localeCompare(right.generationId)
    );

  const assetIds = outputs.flatMap((output) => (output.assetId ? [output.assetId] : []));
  const assetRows =
    assetIds.length > 0 ? db.select().from(assets).where(inArray(assets.id, assetIds)).all() : [];
  const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));

  const outputsByGenerationId = new Map<string, typeof outputs>();
  for (const output of outputs) {
    const existing = outputsByGenerationId.get(output.generationId) ?? [];
    existing.push(output);
    outputsByGenerationId.set(output.generationId, existing);
  }
  const referenceAssetIdsByGenerationId = new Map<string, string[]>();
  for (const referenceRow of referenceRows) {
    const existing = referenceAssetIdsByGenerationId.get(referenceRow.generationId) ?? [];
    existing.push(referenceRow.assetId);
    referenceAssetIdsByGenerationId.set(referenceRow.generationId, existing);
  }

  return records.map((record) => {
    const mappedOutputs = (outputsByGenerationId.get(record.id) ?? []).map((output) => ({
      id: output.id,
      status: output.status as OutputStatus,
      asset: output.assetId ? toGeneratedAsset(assetById.get(output.assetId)) : undefined,
      error: output.error ?? undefined
    }));

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
      referenceAssetIds: referenceAssetIdsByGenerationId.get(record.id) ?? (record.referenceAssetId ? [record.referenceAssetId] : undefined),
      referenceAssetId: record.referenceAssetId ?? undefined,
      createdAt: record.createdAt,
      outputs: mappedOutputs
    };
  });
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
