import OpenAI, { APIConnectionTimeoutError, APIError, APIUserAbortError, toFile } from "openai";
import type { ImageEditParamsNonStreaming, ImageGenerateParamsNonStreaming, ImagesResponse } from "openai/resources/images";
import {
  IMAGE_MODEL,
  type ImageQuality,
  type ImageSize,
  type OutputFormat,
  type ReferenceImageInput
} from "../../domain/contracts.js";

export interface ImageProviderInput {
  originalPrompt: string;
  clientRequestId?: string;
  presetId: string;
  prompt: string;
  size: ImageSize;
  sizeApiValue: string;
  quality: ImageQuality;
  outputFormat: OutputFormat;
  count: number;
}

export interface EditImageProviderInput extends ImageProviderInput {
  referenceImages: ReferenceImageInput[];
  referenceImage?: ReferenceImageInput;
  referenceAssetIds?: string[];
  referenceAssetId?: string;
}

export interface ProviderImage {
  b64Json: string;
}

export interface ProviderResult {
  model: string;
  size: string;
  images: ProviderImage[];
}

export interface ImageProvider {
  generate(input: ImageProviderInput, signal?: AbortSignal): Promise<ProviderResult>;
  edit(input: EditImageProviderInput, signal?: AbortSignal): Promise<ProviderResult>;
}

export type ProviderErrorCode = "missing_api_key" | "missing_provider" | "unsupported_provider_behavior" | "upstream_failure";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export interface OpenAIImageProviderConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  timeoutMs: number;
  transport: OpenAIImageTransport;
  responsesModel: string;
  responsesReasoningEffort?: string;
  partialImages: number;
}

export type OpenAIImageTransport = "images" | "responses";

export const DEFAULT_OPENAI_IMAGE_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_OPENAI_RESPONSES_MODEL = "gpt-5.5";
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_PROVIDER_IMAGE_BYTES = 100 * 1024 * 1024;
const SUPPORTED_REFERENCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

type FlexibleImageGenerateParams = Omit<ImageGenerateParamsNonStreaming, "size"> & {
  size: string;
};

type FlexibleImageEditParams = Omit<ImageEditParamsNonStreaming, "size"> & {
  size: string;
};

type ProviderImagesResponse = ImagesResponse | string;

export function getOpenAIImageProviderConfig():
  | {
      ok: true;
      config: OpenAIImageProviderConfig;
    }
  | {
      ok: false;
      error: ProviderError;
    } {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: new ProviderError("missing_api_key", "服务器缺少 OPENAI_API_KEY，无法生成图像。", 500)
    };
  }

  const baseURL = process.env.OPENAI_BASE_URL?.trim();

  return {
    ok: true,
    config: {
      apiKey,
      baseURL: baseURL || undefined,
      model: getConfiguredImageModel(),
      timeoutMs: parseOpenAIImageTimeoutMs(process.env.OPENAI_IMAGE_TIMEOUT_MS),
      transport: getOpenAIImageTransport(),
      responsesModel: getOpenAIResponsesModel(),
      responsesReasoningEffort: getOpenAIResponsesReasoningEffort(),
      partialImages: getOpenAIImagePartialImages()
    }
  };
}

export function getConfiguredImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL?.trim() || IMAGE_MODEL;
}

export function parseOpenAIImageTimeoutMs(value: string | undefined): number {
  return parsePositiveInteger(value, DEFAULT_OPENAI_IMAGE_TIMEOUT_MS);
}

export function getOpenAIImageTransport(): OpenAIImageTransport {
  return process.env.OPENAI_IMAGE_TRANSPORT?.trim().toLowerCase() === "responses" ? "responses" : "images";
}

export function getOpenAIResponsesModel(): string {
  return process.env.OPENAI_RESPONSES_MODEL?.trim() || process.env.CODEX_RESPONSES_MODEL?.trim() || DEFAULT_OPENAI_RESPONSES_MODEL;
}

export function getOpenAIResponsesReasoningEffort(): string | undefined {
  return trimToUndefined(process.env.OPENAI_RESPONSES_REASONING_EFFORT);
}

export function getOpenAIImagePartialImages(): number {
  const parsed = Number.parseInt(process.env.OPENAI_IMAGE_PARTIAL_IMAGES ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 3 ? parsed : 0;
}

export function createOpenAIImageProvider(config: OpenAIImageProviderConfig): ImageProvider {
  return config.transport === "responses" ? new OpenAIResponsesImageProvider(config) : new OpenAIImageProvider(config);
}

class OpenAIImageProvider implements ImageProvider {
  private readonly client: OpenAI;

  constructor(private readonly config: OpenAIImageProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeoutMs
    });
  }

  async generate(input: ImageProviderInput, signal?: AbortSignal): Promise<ProviderResult> {
    try {
      const response = await this.client.images.generate(
        imageGenerateRequestBody({
          model: this.config.model,
          prompt: input.prompt,
          size: input.sizeApiValue,
          quality: input.quality,
          output_format: input.outputFormat,
          n: input.count
        }),
        { signal }
      );

      return await normalizeProviderResponse(response, input.sizeApiValue, this.config.model, signal);
    } catch (error) {
      throw toProviderError(error);
    }
  }

  async edit(input: EditImageProviderInput, signal?: AbortSignal): Promise<ProviderResult> {
    try {
      const references = await Promise.all(input.referenceImages.map((referenceImage) => dataUrlToFile(referenceImage)));
      const response = await this.client.images.edit(
        imageEditRequestBody({
          model: this.config.model,
          image: references,
          prompt: input.prompt,
          size: input.sizeApiValue,
          quality: input.quality,
          output_format: input.outputFormat,
          n: input.count
        }),
        { signal }
      );

      return await normalizeProviderResponse(response, input.sizeApiValue, this.config.model, signal);
    } catch (error) {
      throw toProviderError(error);
    }
  }
}

class OpenAIResponsesImageProvider implements ImageProvider {
  constructor(private readonly config: OpenAIImageProviderConfig) {}

  async generate(input: ImageProviderInput, signal?: AbortSignal): Promise<ProviderResult> {
    return this.requestImage(input, signal);
  }

  async edit(input: EditImageProviderInput, signal?: AbortSignal): Promise<ProviderResult> {
    return this.requestImage(input, signal);
  }

  private async requestImage(input: ImageProviderInput | EditImageProviderInput, signal?: AbortSignal): Promise<ProviderResult> {
    const timeout = timeoutSignal(signal, this.config.timeoutMs);

    try {
      const response = await fetch(openAIResponsesEndpoint(this.config.baseURL), {
        method: "POST",
        headers: openAIResponsesHeaders(this.config.apiKey),
        body: JSON.stringify(createOpenAIResponsesRequestBody(input, this.config)),
        signal: timeout.signal
      }).catch((error: unknown) => {
        throw toProviderError(error);
      });

      if (!response.ok) {
        throw await openAIResponsesHttpProviderError(response);
      }

      const images = await readOpenAIResponsesImages(response, this.config.partialImages > 0);
      if (images.length === 0) {
        throw new ProviderError("unsupported_provider_behavior", "OpenAI Responses image service did not return image data.", 502);
      }

      return {
        model: this.config.model,
        size: input.sizeApiValue,
        images: images.map((image) => ({
          b64Json: image
        }))
      };
    } finally {
      timeout.cleanup();
    }
  }
}

function imageGenerateRequestBody(body: FlexibleImageGenerateParams): ImageGenerateParamsNonStreaming {
  // The SDK's image size union can lag gpt-image-2's documented flexible-size support.
  return body as unknown as ImageGenerateParamsNonStreaming;
}

function imageEditRequestBody(body: FlexibleImageEditParams): ImageEditParamsNonStreaming {
  // The SDK's image size union can lag gpt-image-2's documented flexible-size support.
  return body as unknown as ImageEditParamsNonStreaming;
}

function toProviderError(error: unknown): Error {
  if (isAbortError(error)) {
    return error;
  }

  if (error instanceof ProviderError) {
    return error;
  }

  if (error instanceof APIConnectionTimeoutError) {
    return new ProviderError("upstream_failure", "OpenAI 图像服务请求超时，请稍后重试或降低分辨率。", 504);
  }

  if (error instanceof APIError) {
    return new ProviderError("upstream_failure", error.message || "OpenAI 图像服务请求失败。", providerHttpStatus(error.status));
  }

  if (error instanceof Error && error.message) {
    return new ProviderError("upstream_failure", error.message, 502);
  }

  return new ProviderError("upstream_failure", "OpenAI 图像服务请求失败。", 502);
}

function providerHttpStatus(status: number | undefined): number {
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function trimToUndefined(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function createOpenAIResponsesRequestBody(
  input: ImageProviderInput | EditImageProviderInput,
  config: OpenAIImageProviderConfig
): Record<string, unknown> {
  const action = "referenceImages" in input ? "edit" : "generate";

  const body: Record<string, unknown> = {
    model: config.responsesModel,
    store: false,
    input: [
      {
        role: "user",
        content: createOpenAIResponsesInputContent(input)
      }
    ],
    tools: [
      {
        type: "image_generation",
        model: config.model,
        action,
        size: input.sizeApiValue,
        quality: input.quality,
        output_format: input.outputFormat,
        partial_images: config.partialImages
      }
    ],
    tool_choice: {
      type: "image_generation"
    },
    stream: true
  };

  if (config.responsesReasoningEffort) {
    body.reasoning = {
      effort: config.responsesReasoningEffort
    };
  }

  return body;
}

function createOpenAIResponsesInputContent(input: ImageProviderInput | EditImageProviderInput): Array<Record<string, string>> {
  const content: Array<Record<string, string>> = [
    {
      type: "input_text",
      text: input.prompt
    }
  ];

  if ("referenceImages" in input) {
    for (const referenceImage of input.referenceImages) {
      content.push({
        type: "input_image",
        image_url: normalizeReferenceImageDataUrl(referenceImage)
      });
    }
  }

  return content;
}

function normalizeReferenceImageDataUrl(input: ReferenceImageInput): string {
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(input.dataUrl);
  if (!match) {
    throw new ProviderError("unsupported_provider_behavior", "Reference image format is not supported.", 400);
  }

  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType)) {
    throw new ProviderError("unsupported_provider_behavior", "Reference image must be PNG, JPEG, or WebP.", 400);
  }

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new ProviderError("unsupported_provider_behavior", "Reference image cannot exceed 50MB.", 400);
  }

  const normalizedMimeType = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  return `data:${normalizedMimeType};base64,${match[2]}`;
}

function openAIResponsesEndpoint(baseURL: string | undefined): string {
  const rawBaseURL = baseURL?.trim() || "https://api.openai.com/v1";
  const trimmedBaseURL = rawBaseURL.replace(/\/+$/u, "");

  try {
    const url = new URL(trimmedBaseURL);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/v1";
    }
    return `${url.toString().replace(/\/+$/u, "")}/responses`;
  } catch {
    return `${trimmedBaseURL}/responses`;
  }
}

function openAIResponsesHeaders(apiKey: string): HeadersInit {
  return {
    Accept: "text/event-stream, application/json",
    Authorization: `Bearer ${apiKey}`,
    "Cache-Control": "no-cache",
    "Content-Type": "application/json"
  };
}

async function readOpenAIResponsesImages(response: Response, acceptPartialFallback: boolean): Promise<string[]> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = await response.json().catch(() => undefined);
    return json === undefined ? [] : extractImageBase64FromResponseEvents([json], acceptPartialFallback);
  }

  return readImageBase64FromResponsesSse(response.body, acceptPartialFallback);
}

async function readImageBase64FromResponsesSse(stream: ReadableStream<Uint8Array> | null, acceptPartialFallback: boolean): Promise<string[]> {
  if (!stream) {
    return [];
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const finalImages: string[] = [];
  const partialImages: string[] = [];
  const seenFinal = new Set<string>();
  const seenPartial = new Set<string>();
  let bufferedText = "";
  let dataLines: string[] = [];

  const pushUnique = (target: string[], seen: Set<string>, image: string): void => {
    if (!seen.has(image)) {
      seen.add(image);
      target.push(image);
    }
  };

  const recordEvent = (event: unknown): void => {
    for (const image of extractFinalImageBase64FromResponseEvent(event)) {
      pushUnique(finalImages, seenFinal, image);
    }
    for (const image of extractPartialImageBase64FromResponseEvent(event)) {
      pushUnique(partialImages, seenPartial, image);
    }
  };

  const flush = (): void => {
    if (dataLines.length === 0) {
      return;
    }

    const data = dataLines.join("\n").trim();
    dataLines = [];
    if (!data || data === "[DONE]") {
      return;
    }

    try {
      recordEvent(JSON.parse(data) as unknown);
    } catch {
      recordEvent(data);
    }
  };

  const consumeText = (text: string): void => {
    bufferedText += text;
    let newlineIndex = bufferedText.indexOf("\n");

    while (newlineIndex !== -1) {
      const line = bufferedText.slice(0, newlineIndex).replace(/\r$/u, "");
      bufferedText = bufferedText.slice(newlineIndex + 1);

      if (line.length === 0) {
        flush();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }

      newlineIndex = bufferedText.indexOf("\n");
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        consumeText(decoder.decode());
        break;
      }

      consumeText(decoder.decode(value, { stream: true }));
      if (finalImages.length > 0) {
        return finalImages;
      }
    }
  } catch (error) {
    if (acceptPartialFallback && partialImages.length > 0) {
      return [partialImages[partialImages.length - 1]];
    }

    throw toProviderError(error);
  } finally {
    reader.releaseLock();
  }

  if (bufferedText) {
    consumeText("\n");
  }
  flush();

  if (finalImages.length > 0) {
    return finalImages;
  }

  return acceptPartialFallback && partialImages.length > 0 ? [partialImages[partialImages.length - 1]] : [];
}

function parseResponsesEventsFromSse(text: string): unknown[] {
  const events: unknown[] = [];
  let dataLines: string[] = [];

  const flush = (): void => {
    if (dataLines.length === 0) {
      return;
    }

    const data = dataLines.join("\n").trim();
    dataLines = [];
    if (!data || data === "[DONE]") {
      return;
    }

    try {
      events.push(JSON.parse(data) as unknown);
    } catch {
      events.push(data);
    }
  };

  for (const line of text.split(/\r?\n/u)) {
    if (line.length === 0) {
      flush();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  flush();
  return events;
}

function extractImageBase64FromResponseEvents(events: unknown[], acceptPartialFallback = true): string[] {
  const finalImages: string[] = [];
  const partialImages: string[] = [];
  const seenFinal = new Set<string>();
  const seenPartial = new Set<string>();

  const pushUnique = (target: string[], seen: Set<string>, image: string): void => {
    if (!seen.has(image)) {
      seen.add(image);
      target.push(image);
    }
  };

  for (const event of events) {
    for (const image of extractFinalImageBase64FromResponseEvent(event)) {
      pushUnique(finalImages, seenFinal, image);
    }
    for (const image of extractPartialImageBase64FromResponseEvent(event)) {
      pushUnique(partialImages, seenPartial, image);
    }
  }

  return finalImages.length > 0 ? finalImages : acceptPartialFallback ? partialImages : [];
}

function extractFinalImageBase64FromResponseEvent(event: unknown): string[] {
  const record = objectValue(event);
  if (!record) {
    return [];
  }

  if (record.type === "response.output_item.done") {
    return extractImagesFromOutputItem(record.item ?? record.output_item);
  }

  if (record.type === "response.completed") {
    return extractImagesFromResponse(record.response);
  }

  return [...extractImagesFromResponse(record), ...extractImagesFromOutputItem(record)];
}

function extractPartialImageBase64FromResponseEvent(event: unknown): string[] {
  const record = objectValue(event);
  if (!record || record.type !== "response.image_generation_call.partial_image") {
    return [];
  }

  const image = normalizeImageBase64(record.partial_image_b64 ?? record.b64_json);
  return image ? [image] : [];
}

function extractImagesFromResponse(response: unknown): string[] {
  const record = objectValue(response);
  if (!record || !Array.isArray(record.output)) {
    return [];
  }

  return record.output.flatMap(extractImagesFromOutputItem);
}

function extractImagesFromOutputItem(item: unknown): string[] {
  const record = objectValue(item);
  if (!record || record.type !== "image_generation_call") {
    return [];
  }

  const image = normalizeImageBase64(record.result);
  return image ? [image] : [];
}

function normalizeImageBase64(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const trimmed = value.trim();
  const dataUrlMatch = /^data:image\/[^;,]+;base64,(.+)$/u.exec(trimmed);
  return dataUrlMatch?.[1] ?? trimmed;
}

async function openAIResponsesHttpProviderError(response: Response): Promise<ProviderError> {
  const detail = sanitizeProviderErrorDetail(await readOpenAIResponsesErrorDetail(response));
  const suffix = detail ? `: ${detail}` : "";
  return new ProviderError("upstream_failure", `OpenAI Responses image request failed (HTTP ${response.status})${suffix}`, providerHttpStatus(response.status));
}

async function readOpenAIResponsesErrorDetail(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await response.json().catch(() => undefined);
    return extractOpenAIResponsesErrorDetail(body);
  }

  return response.text().catch(() => undefined);
}

function extractOpenAIResponsesErrorDetail(value: unknown): string | undefined {
  const record = objectValue(value);
  if (!record) {
    return typeof value === "string" ? value : undefined;
  }

  const detail = record.detail ?? record.message;
  if (typeof detail === "string") {
    return detail;
  }

  const error = objectValue(record.error);
  return typeof error?.message === "string" ? error.message : undefined;
}

function sanitizeProviderErrorDetail(value: string | undefined): string | undefined {
  const sanitized = value
    ?.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[redacted]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500);

  return sanitized || undefined;
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal?.reason);

  if (signal?.aborted) {
    abort();
  } else if (signal) {
    signal.addEventListener("abort", abort, { once: true });
  }

  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isAbortError(error: unknown): error is Error {
  return error instanceof APIUserAbortError || (error instanceof DOMException && error.name === "AbortError");
}

async function normalizeProviderResponse(
  rawResponse: ProviderImagesResponse,
  sizeApiValue: string,
  model: string,
  signal?: AbortSignal
): Promise<ProviderResult> {
  const response = parseProviderImagesResponse(rawResponse);
  const data = isRecord(response) ? response.data : undefined;

  if (!Array.isArray(data) || data.length === 0) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像服务没有返回图像结果。", 502);
  }

  const images = await Promise.all(data.map((item) => providerImageFromResponseItem(item, signal)));

  if (images.some((image) => !image.b64Json)) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像服务没有返回 base64 图像数据。", 502);
  }

  return {
    model,
    size: sizeApiValue,
    images
  };
}

function parseProviderImagesResponse(response: ProviderImagesResponse): unknown {
  if (typeof response !== "string") {
    return response;
  }

  const responseText = response.trim();
  if (!responseText.startsWith("{") && !responseText.startsWith("[")) {
    return response;
  }

  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    return response;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function providerImageFromResponseItem(item: unknown, signal?: AbortSignal): Promise<ProviderImage> {
  if (!isRecord(item)) {
    return {
      b64Json: ""
    };
  }

  if (typeof item.b64_json === "string" && item.b64_json) {
    return {
      b64Json: item.b64_json
    };
  }

  if (typeof item.url === "string" && item.url) {
    return {
      b64Json: await downloadProviderImageUrl(item.url, signal)
    };
  }

  return {
    b64Json: ""
  };
}

async function downloadProviderImageUrl(url: string, signal?: AbortSignal): Promise<string> {
  const parsedUrl = parseProviderImageUrl(url);
  if (!parsedUrl) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像服务返回的图片 URL 不受支持。", 502);
  }

  if (parsedUrl.protocol === "data:") {
    return dataUrlToBase64(url);
  }

  const response = await fetch(parsedUrl, { signal });
  if (!response.ok) {
    throw new ProviderError("upstream_failure", "OpenAI 图像 URL 下载失败。", providerHttpStatus(response.status));
  }

  if (!isProviderImageContentType(response.headers.get("content-type"))) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像 URL 返回的内容不是图片。", 502);
  }

  const contentLength = parseContentLength(response.headers.get("content-length"));
  if (contentLength !== undefined && contentLength > MAX_PROVIDER_IMAGE_BYTES) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像 URL 返回的文件过大。", 502);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_PROVIDER_IMAGE_BYTES) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像 URL 返回的文件过大。", 502);
  }
  if (!isProviderImageBytes(bytes)) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像 URL 返回的内容不是可识别的图片。", 502);
  }

  return bytes.toString("base64");
}

function parseProviderImageUrl(url: string): URL | undefined {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:" || parsedUrl.protocol === "data:"
      ? parsedUrl
      : undefined;
  } catch {
    return undefined;
  }
}

function dataUrlToBase64(url: string): string {
  const match = /^data:image\/[^;,]+;base64,(.+)$/u.exec(url);
  if (!match) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像服务返回的 data URL 不受支持。", 502);
  }

  return match[1];
}

function isProviderImageContentType(value: string | null): boolean {
  if (!value) {
    return true;
  }

  const contentType = value.split(";")[0]?.trim().toLowerCase();
  return Boolean(contentType?.startsWith("image/") || contentType === "application/octet-stream");
}

function isProviderImageBytes(bytes: Buffer): boolean {
  return isPng(bytes) || isJpeg(bytes) || isWebp(bytes);
}

function isPng(bytes: Buffer): boolean {
  return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
}

function isWebp(bytes: Buffer): boolean {
  return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

async function dataUrlToFile(input: ReferenceImageInput): Promise<File> {
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

  const normalizedMimeType = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  const extension = normalizedMimeType === "image/jpeg" ? "jpg" : normalizedMimeType.split("/")[1] || "png";
  const fileName = sanitizeFileName(input.fileName) ?? `reference.${extension}`;
  return toFile(bytes, fileName, { type: normalizedMimeType });
}

function sanitizeFileName(fileName: string | undefined): string | undefined {
  const trimmed = fileName?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]/gu, "_");
}
