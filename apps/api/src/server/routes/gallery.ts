import type { Hono } from "hono";
import type { GalleryAssetDeleteRequest, GalleryBatchDeleteRequest, GalleryExportRequest } from "../../domain/contracts.js";
import { createZipStream, prepareZipFiles, type ZipFileInput } from "../../domain/assets/zip.js";
import { getStoredAssetFile } from "../../domain/generation/image-generation.js";
import {
  deleteGalleryOutput,
  deleteGalleryOutputs,
  deleteGalleryOutputsByAssetIds,
  getGalleryExportAssets,
  getGalleryImages
} from "../../domain/project/project-store.js";
import { downloadFileName, errorResponse } from "../http/errors.js";

export function registerGalleryRoutes(app: Hono): void {
  app.get("/api/gallery", (c) => c.json(getGalleryImages()));

  app.post("/api/gallery/export", async (c) => {
    const parsed = await parseGalleryExportRequest(c.req.raw);
    if (!parsed.ok) {
      return c.json(errorResponse(parsed.code, parsed.message), 400);
    }

    const exportAssets = getGalleryExportAssets(parsed.outputIds);
    if (exportAssets.length !== parsed.outputIds.length) {
      return c.json(errorResponse("gallery_export_not_found", "One or more Gallery images were not found."), 404);
    }

    const zipInputs: ZipFileInput[] = [];
    for (const [index, exportAsset] of exportAssets.entries()) {
      const file = getStoredAssetFile(exportAsset.assetId);
      if (!file) {
        return c.json(errorResponse("gallery_export_asset_unavailable", "One or more Gallery assets are unavailable."), 404);
      }

      zipInputs.push({
        filePath: file.filePath,
        name: `${String(index + 1).padStart(3, "0")}-${downloadFileName(file.fileName)}`
      });
    }

    try {
      const zipFiles = await prepareZipFiles(zipInputs);
      return new Response(createZipStream(zipFiles), {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${galleryExportFileName()}"`,
          "Content-Type": "application/zip"
        }
      });
    } catch {
      return c.json(errorResponse("gallery_export_asset_unavailable", "One or more Gallery assets are unavailable."), 404);
    }
  });

  app.delete("/api/gallery/batch", async (c) => {
    const parsed = await parseGalleryOutputIdsRequest(c.req.raw, {
      emptyCode: "gallery_delete_empty",
      emptyMessage: "Gallery delete requires at least one image.",
      invalidMessage: "Gallery delete requires outputIds."
    });
    if (!parsed.ok) {
      return c.json(errorResponse(parsed.code, parsed.message), 400);
    }

    const deletedOutputIds = deleteGalleryOutputs(parsed.outputIds);
    if (deletedOutputIds.length === 0) {
      return c.json(errorResponse("not_found", "Gallery image records not found."), 404);
    }

    return c.json({
      ok: true,
      deletedOutputIds
    });
  });

  app.delete("/api/gallery/assets", async (c) => {
    const parsed = await parseGalleryAssetIdsRequest(c.req.raw);
    if (!parsed.ok) {
      return c.json(errorResponse(parsed.code, parsed.message), 400);
    }

    return c.json({
      ok: true,
      deletedOutputIds: deleteGalleryOutputsByAssetIds(parsed.assetIds)
    });
  });

  app.delete("/api/gallery/:outputId", (c) => {
    const deleted = deleteGalleryOutput(c.req.param("outputId"));
    if (!deleted) {
      return c.json(errorResponse("not_found", "Gallery image record not found."), 404);
    }

    return c.json({
      ok: true
    });
  });
}

type GalleryOutputIdsParseResult =
  | {
      ok: true;
      outputIds: string[];
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

type GalleryAssetIdsParseResult =
  | {
      ok: true;
      assetIds: string[];
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

async function parseGalleryExportRequest(request: Request): Promise<GalleryOutputIdsParseResult> {
  return parseGalleryOutputIdsRequest(request, {
    emptyCode: "gallery_export_empty",
    emptyMessage: "Gallery export requires at least one image.",
    invalidMessage: "Gallery export requires outputIds."
  });
}

async function parseGalleryAssetIdsRequest(request: Request): Promise<GalleryAssetIdsParseResult> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      code: "invalid_json",
      message: "Request body must be valid JSON."
    };
  }

  if (!isRecord(body) || !Array.isArray(body.assetIds)) {
    return {
      ok: false,
      code: "invalid_gallery_asset_delete_request",
      message: "Gallery asset delete requires assetIds."
    };
  }

  const assetIdsRequest: GalleryAssetDeleteRequest = {
    assetIds: body.assetIds.filter((assetId): assetId is string => typeof assetId === "string")
  };
  const assetIds = normalizeIds(assetIdsRequest.assetIds);
  if (assetIds.length === 0) {
    return {
      ok: false,
      code: "gallery_asset_delete_empty",
      message: "Gallery asset delete requires at least one asset."
    };
  }

  return {
    ok: true,
    assetIds
  };
}

async function parseGalleryOutputIdsRequest(
  request: Request,
  messages: { emptyCode: string; emptyMessage: string; invalidMessage: string }
): Promise<GalleryOutputIdsParseResult> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      code: "invalid_json",
      message: "Request body must be valid JSON."
    };
  }

  if (!isRecord(body) || !Array.isArray(body.outputIds)) {
    return {
      ok: false,
      code: "invalid_gallery_export_request",
      message: messages.invalidMessage
    };
  }

  const outputIdsRequest: GalleryExportRequest | GalleryBatchDeleteRequest = {
    outputIds: body.outputIds.filter((outputId): outputId is string => typeof outputId === "string")
  };
  const outputIds = normalizeIds(outputIdsRequest.outputIds);
  if (outputIds.length === 0) {
    return {
      ok: false,
      code: messages.emptyCode,
      message: messages.emptyMessage
    };
  }

  return {
    ok: true,
    outputIds
  };
}

function normalizeIds(value: unknown[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const outputId = item.trim();
    if (!outputId || seen.has(outputId)) {
      continue;
    }

    seen.add(outputId);
    ids.push(outputId);
  }

  return ids;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function galleryExportFileName(now = new Date()): string {
  const parts = [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
    "-",
    pad2(now.getHours()),
    pad2(now.getMinutes()),
    pad2(now.getSeconds())
  ];
  return `gpt-image-canvas-gallery-${parts.join("")}.zip`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
