import { promises as fs } from "node:fs";
import path from "node:path";
import type { MediaAsset } from "./media-types.js";

const MEDIA_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".webm", ".wav", ".mp3",
]);

export async function scanLocalAssets(directory: string): Promise<MediaAsset[]> {
  const assets: MediaAsset[] = [];
  await walk(directory, assets);
  return assets;
}

async function walk(directory: string, assets: MediaAsset[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, assets);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!MEDIA_EXTENSIONS.has(extension)) continue;

    assets.push({
      id: `catalog-${Buffer.from(fullPath).toString("hex").slice(0, 24)}`,
      kind: kindFor(extension),
      path: fullPath,
      mimeType: mimeFor(extension),
      source: "local-catalog",
      license: "unknown-local-asset",
    });
  }
}

function kindFor(extension: string): MediaAsset["kind"] {
  if ([".wav", ".mp3"].includes(extension)) return "audio";
  if ([".mp4", ".mov", ".webm"].includes(extension)) return "video";
  return "image";
}

function mimeFor(extension: string): string | undefined {
  const map: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
    ".wav": "audio/wav", ".mp3": "audio/mpeg",
  };
  return map[extension];
}
