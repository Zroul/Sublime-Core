import { promises as fs } from "node:fs";
import path from "node:path";
import type { MediaAsset } from "./abilities/media-types.js";

export interface MediaValidationResult {
  ok: boolean;
  errors: string[];
  checked: string[];
}

export async function validateMediaAsset(asset: MediaAsset | null | undefined): Promise<MediaValidationResult> {
  if (!asset) return { ok: false, errors: ["No media asset was produced."], checked: [] };

  const errors: string[] = [];
  const checked = [asset.path];
  try {
    const stat = await fs.stat(asset.path);
    if (!stat.isFile()) errors.push(`Media path is not a file: ${asset.path}`);
    if (stat.size === 0) errors.push(`Media file is empty: ${asset.path}`);
  } catch (error) {
    errors.push(`Media file is missing: ${asset.path}`);
    if (error instanceof Error) errors.push(error.message);
  }

  const extension = path.extname(asset.path).toLowerCase();
  if (asset.kind === "audio" && ![".wav", ".mp3", ".m4a", ".ogg"].includes(extension)) {
    errors.push(`Unexpected audio extension: ${extension || "none"}`);
  }
  if (asset.kind === "video" && ![".mp4", ".webm", ".mov"].includes(extension)) {
    errors.push(`Unexpected video extension: ${extension || "none"}`);
  }
  if (asset.kind === "caption" && ![".srt", ".vtt"].includes(extension)) {
    errors.push(`Unexpected caption extension: ${extension || "none"}`);
  }

  return { ok: errors.length === 0, errors, checked };
}

export async function validateOutputDirectory(directory: string): Promise<MediaValidationResult> {
  const required = ["manifest.json", "job.json", "quality_check.json"];
  const errors: string[] = [];
  const checked: string[] = [];

  for (const file of required) {
    const target = path.join(directory, file);
    checked.push(target);
    try {
      const stat = await fs.stat(target);
      if (!stat.isFile() || stat.size === 0) errors.push(`Required artifact is invalid: ${file}`);
    } catch {
      errors.push(`Required artifact is missing: ${file}`);
    }
  }

  return { ok: errors.length === 0, errors, checked };
}
