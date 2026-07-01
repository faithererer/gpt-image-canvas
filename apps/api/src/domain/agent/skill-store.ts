import { randomUUID } from "node:crypto";
import { asc, desc, eq, ne } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import {
  createCorePlanningSkill,
  createEcommercePlanningSkill,
  type PlanningSkillLoadout,
  type PlanningSkillLoadoutSkill
} from "./planning-skill.js";
import type {
  AgentSkillDetail,
  AgentSkillErrorCode,
  AgentSkillFile,
  AgentSkillListResponse,
  AgentSkillSummary,
  AgentSkillTriggerMode,
  ImportAgentSkillResponse,
  SaveAgentSkillRequest,
  SaveAgentSkillResponse
} from "../contracts.js";
import { db } from "../../infrastructure/database.js";
import { agentSkills } from "../../infrastructure/schema.js";

const MAX_SKILL_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_TOTAL_TEXT_BYTES = 768 * 1024;
const MAX_SKILL_FILE_TEXT_BYTES = 256 * 1024;
const MAX_SKILL_FILES = 64;
const SKILL_MARKDOWN_FILE = "SKILL.md";

type AgentSkillRow = typeof agentSkills.$inferSelect;
type SkillFiles = Record<string, string>;

interface BuiltInAgentSkillDefinition {
  slug: string;
  name: string;
  description: string;
  version?: string;
  source?: string;
  enabled: boolean;
  required: boolean;
  triggerMode: AgentSkillTriggerMode;
  triggerKeywords: string[];
  files: SkillFiles;
}

interface ParsedSkillMarkdownMetadata {
  name?: string;
  description?: string;
  version?: string;
  source?: string;
}

interface ImportUploadInput {
  fileName: string;
  mediaType?: string;
  bytes: Uint8Array;
}

export class AgentSkillError extends Error {
  readonly code: AgentSkillErrorCode;

  constructor(code: AgentSkillErrorCode, message: string) {
    super(message);
    this.name = "AgentSkillError";
    this.code = code;
  }
}

export function listAgentSkills(): AgentSkillListResponse {
  ensureBuiltInAgentSkills();
  return {
    skills: db
      .select()
      .from(agentSkills)
      .orderBy(desc(agentSkills.required), desc(agentSkills.builtIn), asc(agentSkills.name))
      .all()
      .map(toAgentSkillSummary)
  };
}

export function getAgentSkill(idOrSlug: string): AgentSkillDetail | undefined {
  ensureBuiltInAgentSkills();
  const row = getAgentSkillRow(idOrSlug);
  return row ? toAgentSkillDetail(row) : undefined;
}

export function createAgentSkill(input: SaveAgentSkillRequest): SaveAgentSkillResponse {
  ensureBuiltInAgentSkills();
  const now = new Date().toISOString();
  const normalized = normalizeSaveInput(input, undefined);
  assertUniqueSlug(normalized.slug);

  db.insert(agentSkills)
    .values({
      id: `agent-skill-${randomUUID()}`,
      slug: normalized.slug,
      name: normalized.name,
      description: normalized.description,
      version: normalized.version,
      source: normalized.source,
      enabled: normalized.enabled ? 1 : 0,
      builtIn: 0,
      required: 0,
      triggerMode: normalized.triggerMode,
      triggerKeywordsJson: JSON.stringify(normalized.triggerKeywords),
      filesJson: JSON.stringify(normalized.files),
      createdAt: now,
      updatedAt: now
    })
    .run();

  return { skill: requireAgentSkillDetail(normalized.slug) };
}

export function saveAgentSkill(idOrSlug: string, input: SaveAgentSkillRequest): SaveAgentSkillResponse {
  ensureBuiltInAgentSkills();
  const existing = getRequiredAgentSkillRow(idOrSlug);

  if (input.resetToFactory === true) {
    return { skill: resetBuiltInAgentSkill(existing) };
  }

  const normalized = normalizeSaveInput(input, existing);
  if (normalized.slug !== existing.slug) {
    if (existing.builtIn === 1) {
      throw new AgentSkillError("invalid_agent_skill", "Built-in Agent skill slugs cannot be changed.");
    }
    assertUniqueSlug(normalized.slug, existing.id);
  }

  if (existing.required === 1 && !normalized.enabled) {
    throw new AgentSkillError("agent_skill_required", "The core Agent planning skill cannot be disabled.");
  }

  db.update(agentSkills)
    .set({
      slug: normalized.slug,
      name: normalized.name,
      description: normalized.description,
      version: normalized.version,
      source: normalized.source,
      enabled: normalized.enabled || existing.required === 1 ? 1 : 0,
      triggerMode: existing.required === 1 ? "always" : normalized.triggerMode,
      triggerKeywordsJson: JSON.stringify(normalized.triggerKeywords),
      filesJson: JSON.stringify(normalized.files),
      updatedAt: new Date().toISOString()
    })
    .where(eq(agentSkills.id, existing.id))
    .run();

  return { skill: requireAgentSkillDetail(normalized.slug) };
}

export function importAgentSkillFromUpload(input: ImportUploadInput): ImportAgentSkillResponse {
  ensureBuiltInAgentSkills();
  if (input.bytes.byteLength > MAX_SKILL_UPLOAD_BYTES) {
    throw new AgentSkillError("agent_skill_import_failed", "Agent skill upload is too large.");
  }

  const imported = isZipUpload(input) ? parseZipSkillUpload(input) : parseMarkdownSkillUpload(input);
  const metadata = parseSkillMarkdownMetadata(imported.files[SKILL_MARKDOWN_FILE] ?? "");
  const fallbackName = fileBaseName(input.fileName) || "Imported Agent skill";
  const name = normalizedText(metadata.name) ?? fallbackName;
  const slug = uniqueSlug(slugify(name) || slugify(fallbackName) || "imported-skill");

  return createAgentSkill({
    slug,
    name,
    description: normalizedText(metadata.description) ?? "",
    version: normalizedText(metadata.version),
    source: normalizedText(metadata.source),
    enabled: true,
    triggerMode: "auto",
    triggerKeywords: [],
    files: filesToList(imported.files)
  });
}

export function resolveAvailablePlanningSkillLoadout(): PlanningSkillLoadout {
  ensureBuiltInAgentSkills();
  const rows = db.select().from(agentSkills).orderBy(desc(agentSkills.required), desc(agentSkills.builtIn), asc(agentSkills.name)).all();
  const skills = rows.flatMap((row) => {
    if (row.required === 1) {
      return [toPlanningSkill(row)];
    }

    if (row.enabled !== 1) {
      return [];
    }

    return [toPlanningSkill(row)];
  });

  return { skills };
}

export function ensureBuiltInAgentSkills(): void {
  for (const definition of builtInSkillDefinitions()) {
    const existing = db.select().from(agentSkills).where(eq(agentSkills.slug, definition.slug)).get();
    if (!existing) {
      insertBuiltInAgentSkill(definition);
      continue;
    }

    const isRequired = definition.required ? 1 : 0;
    const shouldForceEnabled = definition.required && existing.enabled !== 1;
    db.update(agentSkills)
      .set({
        builtIn: 1,
        required: isRequired,
        enabled: shouldForceEnabled ? 1 : existing.enabled,
        triggerMode: definition.required ? "always" : existing.triggerMode,
        updatedAt: existing.updatedAt
      })
      .where(eq(agentSkills.id, existing.id))
      .run();
  }
}

function builtInSkillDefinitions(): BuiltInAgentSkillDefinition[] {
  const core = createCorePlanningSkill();
  const ecommerce = createEcommercePlanningSkill();
  return [
    {
      slug: "canvas-image-planning",
      name: "canvas-image-planning",
      description: "Turn a creator image request into strict GenerationPlan JSON for the canvas.",
      version: core.version,
      enabled: true,
      required: true,
      triggerMode: "always",
      triggerKeywords: [],
      files: filesFromPlanningSkill(core)
    },
    {
      slug: "ecommerce-visual-copywriting",
      name: "ecommerce-visual-copywriting",
      description: "Optimize ecommerce main-image and product-detail-page generation plans with compliant visual copywriting.",
      version: ecommerce.version,
      source: "https://github.com/feichanggege/ecommerce-visual-copywriting-skill",
      enabled: true,
      required: false,
      triggerMode: "auto",
      triggerKeywords: [
        "ecommerce",
        "marketplace",
        "listing",
        "product detail",
        "\u7535\u5546",
        "\u6dd8\u5b9d",
        "\u5929\u732b",
        "\u4eac\u4e1c",
        "\u4e3b\u56fe",
        "\u8be6\u60c5\u9875",
        "\u5408\u89c4"
      ],
      files: filesFromPlanningSkill(ecommerce)
    }
  ];
}

function insertBuiltInAgentSkill(definition: BuiltInAgentSkillDefinition): void {
  const now = new Date().toISOString();
  db.insert(agentSkills)
    .values({
      id: `agent-skill-${definition.slug}`,
      slug: definition.slug,
      name: definition.name,
      description: definition.description,
      version: definition.version,
      source: definition.source,
      enabled: definition.enabled ? 1 : 0,
      builtIn: 1,
      required: definition.required ? 1 : 0,
      triggerMode: definition.triggerMode,
      triggerKeywordsJson: JSON.stringify(definition.triggerKeywords),
      filesJson: JSON.stringify(definition.files),
      createdAt: now,
      updatedAt: now
    })
    .run();
}

function resetBuiltInAgentSkill(row: AgentSkillRow): AgentSkillDetail {
  if (row.builtIn !== 1) {
    throw new AgentSkillError("invalid_agent_skill", "Only built-in Agent skills can be reset.");
  }

  const definition = builtInSkillDefinitions().find((item) => item.slug === row.slug);
  if (!definition) {
    throw new AgentSkillError("invalid_agent_skill", "Built-in Agent skill factory content is unavailable.");
  }

  db.update(agentSkills)
    .set({
      name: definition.name,
      description: definition.description,
      version: definition.version,
      source: definition.source,
      enabled: definition.enabled ? 1 : 0,
      required: definition.required ? 1 : 0,
      triggerMode: definition.triggerMode,
      triggerKeywordsJson: JSON.stringify(definition.triggerKeywords),
      filesJson: JSON.stringify(definition.files),
      updatedAt: new Date().toISOString()
    })
    .where(eq(agentSkills.id, row.id))
    .run();

  return requireAgentSkillDetail(row.slug);
}

function normalizeSaveInput(input: SaveAgentSkillRequest, existing: AgentSkillRow | undefined): {
  slug: string;
  name: string;
  description: string;
  version?: string;
  source?: string;
  enabled: boolean;
  triggerMode: AgentSkillTriggerMode;
  triggerKeywords: string[];
  files: SkillFiles;
} {
  const existingFiles = existing ? parseFilesJson(existing.filesJson) : undefined;
  const name = requiredText(input.name ?? existing?.name, "Agent skill name");
  const slug = normalizeSlug(input.slug ?? existing?.slug ?? slugify(name));
  const files = normalizeSkillFiles(input.files ? listToFiles(input.files) : existingFiles);
  const enabled = input.enabled ?? (existing ? existing.enabled === 1 : true);
  return {
    slug,
    name,
    description: normalizedText(input.description ?? existing?.description) ?? "",
    version: normalizedText(input.version ?? existing?.version),
    source: normalizedText(input.source ?? existing?.source),
    enabled,
    triggerMode: normalizeTriggerMode(input.triggerMode ?? existing?.triggerMode),
    triggerKeywords: normalizeKeywords(input.triggerKeywords ?? parseKeywordsJson(existing?.triggerKeywordsJson)),
    files
  };
}

function normalizeSkillFiles(files: SkillFiles | undefined): SkillFiles {
  if (!files || Object.keys(files).length === 0) {
    throw new AgentSkillError("invalid_agent_skill", "Agent skill files must include SKILL.md.");
  }

  const normalized: SkillFiles = {};
  let totalBytes = 0;
  for (const [rawPath, rawContent] of Object.entries(files)) {
    const path = normalizeSkillFilePath(rawPath);
    if (path !== SKILL_MARKDOWN_FILE && !path.startsWith("references/")) {
      throw new AgentSkillError("agent_skill_invalid_file", "Agent skill files may only include SKILL.md and references/*.");
    }

    if (typeof rawContent !== "string") {
      throw new AgentSkillError("agent_skill_invalid_file", "Agent skill file content must be text.");
    }

    const contentBytes = Buffer.byteLength(rawContent, "utf8");
    if (contentBytes > MAX_SKILL_FILE_TEXT_BYTES || !isTextContent(rawContent)) {
      throw new AgentSkillError("agent_skill_invalid_file", "Agent skill files must be readable text and under the size limit.");
    }

    totalBytes += contentBytes;
    if (totalBytes > MAX_SKILL_TOTAL_TEXT_BYTES) {
      throw new AgentSkillError("agent_skill_invalid_file", "Agent skill files are too large.");
    }

    normalized[path] = rawContent;
  }

  if (!normalized[SKILL_MARKDOWN_FILE]?.trim()) {
    throw new AgentSkillError("invalid_agent_skill", "Agent skill files must include a non-empty SKILL.md.");
  }

  if (Object.keys(normalized).length > MAX_SKILL_FILES) {
    throw new AgentSkillError("agent_skill_invalid_file", "Agent skill bundles may not include more than 64 text files.");
  }

  return normalized;
}

function parseMarkdownSkillUpload(input: ImportUploadInput): { files: SkillFiles } {
  const text = decodeSkillText(input.bytes);
  return {
    files: normalizeSkillFiles({
      [SKILL_MARKDOWN_FILE]: text
    })
  };
}

function parseZipSkillUpload(input: ImportUploadInput): { files: SkillFiles } {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(input.bytes);
  } catch {
    throw new AgentSkillError("agent_skill_import_failed", "Agent skill zip could not be read.");
  }

  const fileEntries = Object.entries(entries).filter(([path]) => !path.endsWith("/"));
  const skillMarkdownEntries = fileEntries.filter(([path]) => normalizeZipPath(path).endsWith(`/${SKILL_MARKDOWN_FILE}`) || normalizeZipPath(path) === SKILL_MARKDOWN_FILE);
  if (skillMarkdownEntries.length !== 1) {
    throw new AgentSkillError("agent_skill_import_failed", "Agent skill zip must include exactly one SKILL.md.");
  }

  const skillPath = normalizeZipPath(skillMarkdownEntries[0]?.[0] ?? "");
  const basePrefix = skillPath === SKILL_MARKDOWN_FILE ? "" : skillPath.slice(0, -SKILL_MARKDOWN_FILE.length);
  const files: SkillFiles = {};
  for (const [rawPath, bytes] of fileEntries) {
    const normalizedPath = normalizeZipPath(rawPath);
    if (basePrefix && !normalizedPath.startsWith(basePrefix)) {
      continue;
    }

    const relativePath = basePrefix ? normalizedPath.slice(basePrefix.length) : normalizedPath;
    if (!relativePath || (relativePath !== SKILL_MARKDOWN_FILE && !relativePath.startsWith("references/"))) {
      continue;
    }

    files[relativePath] = decodeSkillText(bytes);
  }

  return {
    files: normalizeSkillFiles(files)
  };
}

function decodeSkillText(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_SKILL_FILE_TEXT_BYTES) {
    throw new AgentSkillError("agent_skill_invalid_file", "Agent skill file is too large.");
  }

  let text: string;
  try {
    text = strFromU8(bytes);
  } catch {
    throw new AgentSkillError("agent_skill_invalid_file", "Agent skill file must be UTF-8 text.");
  }

  if (!isTextContent(text)) {
    throw new AgentSkillError("agent_skill_invalid_file", "Agent skill file must be readable text.");
  }

  return text;
}

function toPlanningSkill(row: AgentSkillRow): PlanningSkillLoadoutSkill {
  return {
    slug: row.slug,
    name: row.name,
    version: normalizedText(row.version),
    required: row.required === 1,
    triggerMode: normalizeTriggerMode(row.triggerMode),
    files: filesToList(parseFilesJson(row.filesJson)).map((file) => ({
      path: `/skills/${row.slug}/${file.path}`,
      content: file.content
    }))
  };
}

function toAgentSkillSummary(row: AgentSkillRow): AgentSkillSummary {
  const files = parseFilesJson(row.filesJson);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    version: normalizedText(row.version),
    source: normalizedText(row.source),
    enabled: row.enabled === 1,
    builtIn: row.builtIn === 1,
    required: row.required === 1,
    triggerMode: normalizeTriggerMode(row.triggerMode),
    triggerKeywords: parseKeywordsJson(row.triggerKeywordsJson),
    fileCount: Object.keys(files).length,
    hasLocalChanges: hasLocalChanges(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function toAgentSkillDetail(row: AgentSkillRow): AgentSkillDetail {
  return {
    ...toAgentSkillSummary(row),
    files: filesToList(parseFilesJson(row.filesJson))
  };
}

function hasLocalChanges(row: AgentSkillRow): boolean {
  if (row.builtIn !== 1) {
    return false;
  }

  const definition = builtInSkillDefinitions().find((item) => item.slug === row.slug);
  return definition ? JSON.stringify(parseFilesJson(row.filesJson)) !== JSON.stringify(definition.files) : false;
}

function requireAgentSkillDetail(idOrSlug: string): AgentSkillDetail {
  const detail = getAgentSkill(idOrSlug);
  if (!detail) {
    throw new AgentSkillError("agent_skill_not_found", "Agent skill was not found.");
  }

  return detail;
}

function getRequiredAgentSkillRow(idOrSlug: string): AgentSkillRow {
  const row = getAgentSkillRow(idOrSlug);
  if (!row) {
    throw new AgentSkillError("agent_skill_not_found", "Agent skill was not found.");
  }

  return row;
}

function getAgentSkillRow(idOrSlug: string): AgentSkillRow | undefined {
  const trimmed = idOrSlug.trim();
  if (!trimmed) {
    return undefined;
  }

  return db.select().from(agentSkills).where(eq(agentSkills.id, trimmed)).get()
    ?? db.select().from(agentSkills).where(eq(agentSkills.slug, trimmed)).get();
}

function assertUniqueSlug(slug: string, currentId?: string): void {
  const query = currentId
    ? db.select().from(agentSkills).where(ne(agentSkills.id, currentId)).all()
    : db.select().from(agentSkills).all();
  if (query.some((row) => row.slug === slug)) {
    throw new AgentSkillError("agent_skill_duplicate_slug", "An Agent skill with this slug already exists.");
  }
}

function uniqueSlug(baseSlug: string): string {
  let candidate = normalizeSlug(baseSlug);
  for (let index = 2; db.select().from(agentSkills).where(eq(agentSkills.slug, candidate)).get(); index += 1) {
    candidate = normalizeSlug(`${baseSlug}-${index}`);
  }

  return candidate;
}

function filesFromPlanningSkill(skill: PlanningSkillLoadoutSkill): SkillFiles {
  const prefix = `/skills/${skill.slug}/`;
  const files: SkillFiles = {};
  for (const file of skill.files) {
    files[file.path.startsWith(prefix) ? file.path.slice(prefix.length) : normalizeSkillFilePath(file.path)] = file.content;
  }

  return normalizeSkillFiles(files);
}

function filesToList(files: SkillFiles): AgentSkillFile[] {
  return Object.entries(files)
    .sort(([left], [right]) => (left === SKILL_MARKDOWN_FILE ? -1 : right === SKILL_MARKDOWN_FILE ? 1 : left.localeCompare(right)))
    .map(([path, content]) => ({ path, content }));
}

function listToFiles(files: AgentSkillFile[]): SkillFiles {
  const result: SkillFiles = {};
  for (const file of files) {
    result[file.path] = file.content;
  }

  return result;
}

function parseFilesJson(value: string | null | undefined): SkillFiles {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
  } catch {
    return {};
  }
}

function parseKeywordsJson(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    return normalizeKeywords(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : [])))].slice(0, 32);
}

function normalizeTriggerMode(value: unknown): AgentSkillTriggerMode {
  return value === "always" ? "always" : "auto";
}

function normalizeSlug(value: string): string {
  const slug = slugify(value);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(slug)) {
    throw new AgentSkillError("invalid_agent_skill", "Agent skill slug must use lowercase letters, numbers, and hyphens.");
  }

  return slug;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
}

function normalizeSkillFilePath(value: string): string {
  const path = value.replace(/\\/gu, "/").replace(/^\/+/u, "").trim();
  const parts = path.split("/");
  if (!path || path.includes(":") || parts.some((part) => !part || part === "." || part === "..")) {
    throw new AgentSkillError("agent_skill_invalid_file", "Agent skill file paths must stay inside the skill bundle.");
  }

  return path;
}

function normalizeZipPath(value: string): string {
  return normalizeSkillFilePath(value);
}

function requiredText(value: string | undefined, label: string): string {
  const text = normalizedText(value);
  if (!text) {
    throw new AgentSkillError("invalid_agent_skill", `${label} is required.`);
  }

  return text;
}

function normalizedText(value: string | null | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

function isTextContent(value: string): boolean {
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
}

function isZipUpload(input: ImportUploadInput): boolean {
  const mediaType = input.mediaType?.toLowerCase() ?? "";
  return input.fileName.toLowerCase().endsWith(".zip") || mediaType.includes("zip");
}

function parseSkillMarkdownMetadata(content: string): ParsedSkillMarkdownMetadata {
  const match = /^---\s*\r?\n(?<frontmatter>[\s\S]*?)\r?\n---/u.exec(content);
  const frontmatter = match?.groups?.frontmatter;
  if (!frontmatter) {
    return {};
  }

  const metadata: ParsedSkillMarkdownMetadata = {};
  let inMetadata = false;
  for (const line of frontmatter.split(/\r?\n/u)) {
    if (/^metadata:\s*$/u.test(line.trim())) {
      inMetadata = true;
      continue;
    }

    const propertyMatch = /^\s*([a-zA-Z][\w-]*)\s*:\s*(.*?)\s*$/u.exec(line);
    if (!propertyMatch) {
      continue;
    }

    const key = propertyMatch[1];
    const value = stripYamlString(propertyMatch[2] ?? "");
    if (!inMetadata && key === "name") {
      metadata.name = value;
    } else if (!inMetadata && key === "description") {
      metadata.description = value;
    } else if (inMetadata && key === "version") {
      metadata.version = value;
    } else if (inMetadata && key === "source") {
      metadata.source = value;
    }
  }

  return metadata;
}

function stripYamlString(value: string): string {
  return value.replace(/^["']|["']$/gu, "").trim();
}

function fileBaseName(fileName: string): string {
  const normalized = fileName.replace(/\\/gu, "/").split("/").pop() ?? "";
  return normalized.replace(/\.(md|zip)$/iu, "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
