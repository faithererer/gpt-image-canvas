import type { Hono } from "hono";
import { parsePreviewWidth, readStoredAssetPreview } from "../../domain/assets/preview.js";
import { readStoredAsset, readStoredAssetMetadata, saveReferenceImageInput } from "../../domain/generation/image-generation.js";
import { downloadFileName, errorResponse } from "../http/errors.js";
import { readJson } from "../http/json.js";

export function registerAssetRoutes(app: Hono): void {
  app.post("/api/assets", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    if (!isAssetUploadPayload(payload.value)) {
      return c.json(errorResponse("invalid_asset_upload", "Asset upload must include a dataUrl."), 400);
    }

    try {
      return c.json({ asset: await saveReferenceImageInput(payload.value) });
    } catch (error) {
      return c.json(errorResponse("asset_upload_failed", errorToMessage(error)), 400);
    }
  });

  app.get("/api/assets/:id/preview", async (c) => {
    const parsedWidth = parsePreviewWidth(c.req.query("width"));
    if (!parsedWidth.ok) {
      return c.json(errorResponse(parsedWidth.code, parsedWidth.message), 400);
    }

    const preview = await readStoredAssetPreview(c.req.param("id"), parsedWidth.width);
    if (!preview) {
      return c.json(errorResponse("not_found", "Asset not found."), 404);
    }

    return new Response(new Uint8Array(preview.bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${downloadFileName(c.req.param("id"))}-${preview.width}.webp"`,
        "Content-Type": "image/webp"
      }
    });
  });

  app.get("/api/assets/:id/metadata", async (c) => {
    const metadata = await readStoredAssetMetadata(c.req.param("id"));
    if (!metadata) {
      return c.json(errorResponse("not_found", "Asset not found."), 404);
    }

    return c.json(metadata);
  });

  app.get("/api/assets/:id/download", async (c) => {
    const asset = await readStoredAsset(c.req.param("id"));
    if (!asset) {
      return c.json(errorResponse("not_found", "找不到请求的图像资源。"), 404);
    }

    return new Response(new Uint8Array(asset.bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `attachment; filename="${downloadFileName(asset.file.fileName)}"`,
        "Content-Type": asset.file.mimeType
      }
    });
  });

  app.get("/api/assets/:id", async (c) => {
    const asset = await readStoredAsset(c.req.param("id"));
    if (!asset) {
      return c.json(errorResponse("not_found", "找不到请求的图像资源。"), 404);
    }

    return new Response(new Uint8Array(asset.bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${asset.file.fileName}"`,
        "Content-Type": asset.file.mimeType
      }
    });
  });
}

function isAssetUploadPayload(input: unknown): input is { dataUrl: string; fileName?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }

  const record = input as Record<string, unknown>;
  return (
    typeof record.dataUrl === "string" &&
    record.dataUrl.trim().length > 0 &&
    (record.fileName === undefined || typeof record.fileName === "string")
  );
}

function errorToMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Asset upload failed.";
}
