import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MediaAsset } from "./media-types.js";

export interface AssetIngestOptions {
  maxBytes?: number;
  allowedExtensions?: string[];
}

const DEFAULT_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".webm", ".wav", ".mp3"];

export async function ingestLocalAsset(
  inputPath: string,
  outputDir: string,
  options: AssetIngestOptions = {},
): Promise<MediaAsset> {
  const maxBytes = options.maxBytes ?? 100 * 1024 * 1024;
  const allowed = new Set((options.allowedExtensions ?? DEFAULT_EXTENSIONS).map((ext) => ext.toLowerCase()));
  const source = path.resolve(inputPath);
  const stat = await fs.stat(source);
  if (!stat.isFile()) throw new Error(`Asset is not a file: ${inputPath}`);
  if (stat.size > maxBytes) throw new Error(`Asset exceeds the ${maxBytes} byte limit: ${inputPath}`);

  const extension = path.extname(source).toLowerCase();
  if (!allowed.has(extension)) throw new Error(`Asset type is not allowed: ${extension || "none"}`);

  await fs.mkdir(outputDir, { recursive: true });
  const destination = path.join(outputDir, `${randomUUID()}${extension}`);
  await fs.copyFile(source, destination);

  return {
    id: `asset-${path.basename(destination, extension)}`,
    kind: mediaKind(extension),
    path: destination,
    mimeType: mimeType(extension),
    source: source,
    license: "user-provided",
  };
}

function mediaKind(extension: string): MediaAsset["kind"] {
  if ([".wav", ".mp3"].includes(extension)) return "audio";
  if ([".mp4", ".mov", ".webm"].includes(extension)) return "video";
  return "image";
}

function mimeType(extension: string): string | undefined {
  const map: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
    ".wav": "audio/wav", ".mp3": "audio/mpeg",
  };
  return map[extension];
}
