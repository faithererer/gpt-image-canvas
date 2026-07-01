export const IMAGE_MODEL = "gpt-image-2" as const;

export type ImageModel = string;
export type ImageMode = "generate" | "edit";
export type ImageQuality = "auto" | "low" | "medium" | "high";
export type OutputFormat = "png" | "jpeg" | "webp";
export type GenerationStatus = "pending" | "running" | "succeeded" | "partial" | "failed" | "cancelled";
export type OutputStatus = "succeeded" | "failed";
export type CloudStorageProvider = "cos" | "s3";
export type AssetCloudUploadStatus = "uploaded" | "failed";

export interface SizePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  description: string;
}

export const SIZE_PRESETS: SizePreset[] = [
  { id: "square-1k", label: "Square 1K", width: 1024, height: 1024, description: "Avatar and social image" },
  { id: "poster-portrait", label: "Portrait poster", width: 1024, height: 1536, description: "Poster, cover, and mobile vertical image" },
  { id: "poster-landscape", label: "Landscape poster", width: 1536, height: 1024, description: "Wide cover and desktop image" },
  { id: "story-9-16", label: "Story 9:16", width: 1024, height: 1824, description: "Short video cover and story image" },
  { id: "video-16-9", label: "Video 16:9", width: 1824, height: 1024, description: "Video cover and presentation image" },
  { id: "ratio-4-3-1k", label: "4:3 1K", width: 1360, height: 1024, description: "Classic landscape 1K image" },
  { id: "ratio-3-4-1k", label: "3:4 1K", width: 1024, height: 1360, description: "Classic portrait 1K image" },
  { id: "wide-2k", label: "Wide 2K", width: 2048, height: 1152, description: "Display page and wide composition" },
  { id: "portrait-2k", label: "Portrait 2K", width: 1152, height: 2048, description: "High-resolution portrait image" },
  { id: "square-2k", label: "Square 2K", width: 2048, height: 2048, description: "High-resolution square image" },
  { id: "ratio-4-3-2k", label: "4:3 2K", width: 2048, height: 1536, description: "Classic landscape 2K image" },
  { id: "ratio-3-4-2k", label: "3:4 2K", width: 1536, height: 2048, description: "Classic portrait 2K image" },
  { id: "ratio-3-2-2k", label: "3:2 2K", width: 2016, height: 1344, description: "Photo landscape 2K image" },
  { id: "ratio-2-3-2k", label: "2:3 2K", width: 1344, height: 2016, description: "Photo portrait 2K image" },
  { id: "square-4k", label: "Square 4K", width: 2880, height: 2880, description: "Large square display image" },
  { id: "portrait-4k", label: "Portrait 4K", width: 2160, height: 3840, description: "Large portrait display image" },
  { id: "wide-4k", label: "Wide 4K", width: 3840, height: 2160, description: "Large display image" },
  { id: "ratio-4-3-4k", label: "4:3 4K", width: 2880, height: 2160, description: "Classic landscape 4K image" },
  { id: "ratio-3-4-4k", label: "3:4 4K", width: 2160, height: 2880, description: "Classic portrait 4K image" },
  { id: "ratio-3-2-4k", label: "3:2 4K", width: 3264, height: 2176, description: "Photo landscape 4K image" },
  { id: "ratio-2-3-4k", label: "2:3 4K", width: 2176, height: 3264, description: "Photo portrait 4K image" }
];

export const STYLE_PRESETS = [
  {
    id: "none",
    label: "None",
    prompt: ""
  },
  {
    id: "photoreal",
    label: "Photoreal",
    prompt: "photorealistic, natural lighting, high detail, realistic materials"
  },
  {
    id: "product",
    label: "Product",
    prompt: "premium product photography, clean studio lighting, sharp focus, commercial composition"
  },
  {
    id: "illustration",
    label: "Illustration",
    prompt: "polished editorial illustration, clear shapes, rich but balanced colors, professional finish"
  },
  {
    id: "poster",
    label: "Poster",
    prompt: "bold poster composition, strong focal point, refined typography space, cinematic color grading"
  },
  {
    id: "avatar",
    label: "Avatar",
    prompt: "character portrait, expressive face, clean background, high quality avatar style"
  }
] as const;

export type StylePresetId = (typeof STYLE_PRESETS)[number]["id"];

export const IMAGE_QUALITIES: ImageQuality[] = ["auto", "low", "medium", "high"];
export const OUTPUT_FORMATS: OutputFormat[] = ["png", "jpeg", "webp"];
export const GENERATION_COUNTS = [1, 2, 4, 8, 16] as const;
export type GenerationCount = (typeof GENERATION_COUNTS)[number];

export interface ImageSize {
  width: number;
  height: number;
}

export type ResolutionTier = "1K" | "2K" | "4K";

export interface AssetMetadataResponse extends ImageSize {
  id: string;
}

export function resolutionTierForSize(size: ImageSize): ResolutionTier {
  const matchingPreset = SIZE_PRESETS.find((preset) => preset.width === size.width && preset.height === size.height);
  if (matchingPreset?.label.includes("4K")) {
    return "4K";
  }
  if (matchingPreset?.label.includes("2K")) {
    return "2K";
  }

  const longestSide = Math.max(size.width, size.height);
  const shortestSide = Math.min(size.width, size.height);
  if (longestSide >= 2880 || shortestSide >= 2160) {
    return "4K";
  }
  if (longestSide >= 1920 || shortestSide >= 1440) {
    return "2K";
  }
  return "1K";
}

export const CUSTOM_SIZE_PRESET_ID = "custom" as const;
export type ImageSizePresetId = (typeof SIZE_PRESETS)[number]["id"] | typeof CUSTOM_SIZE_PRESET_ID;

export interface AppConfig {
  model: ImageModel;
  models: ImageModel[];
  sizePresets: SizePreset[];
  stylePresets: typeof STYLE_PRESETS;
  qualities: ImageQuality[];
  outputFormats: OutputFormat[];
  counts: readonly GenerationCount[];
}

export function composePrompt(prompt: string, presetId: string): string {
  const trimmedPrompt = prompt.trim();
  const preset = STYLE_PRESETS.find((item) => item.id === presetId);
  if (!preset || preset.id === "none" || !preset.prompt) {
    return trimmedPrompt;
  }
  return `${trimmedPrompt}\n\nStyle direction: ${preset.prompt}`;
}
