import type { MediaAsset, TimelineClip, VideoTimeline } from "./media-types.js";

export interface TimelineAssetMap {
  assets: MediaAsset[];
  clips: TimelineClip[];
}

/**
 * Resolves asset IDs in a NOVA timeline against locally available media.
 * The resolver is deliberately strict: missing assets are errors rather than
 * silently producing an empty video.
 */
export function resolveTimelineAssets(
  timeline: VideoTimeline,
  assets: MediaAsset[],
): TimelineAssetMap {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const resolved: TimelineClip[] = [];
  const used: MediaAsset[] = [];
  const usedIds = new Set<string>();

  for (const clip of timeline.clips) {
    const asset = byId.get(clip.assetId);
    if (!asset) {
      throw new Error(`Timeline references missing media asset: ${clip.assetId}`);
    }
    if (clip.endMs <= clip.startMs) {
      throw new Error(`Timeline clip has invalid timing: ${clip.assetId}`);
    }
    resolved.push(clip);
    if (!usedIds.has(asset.id)) {
      usedIds.add(asset.id);
      used.push(asset);
    }
  }

  return { assets: used, clips: resolved };
}

export function validateTimeline(timeline: VideoTimeline): string[] {
  const errors: string[] = [];
  if (timeline.width <= 0 || timeline.height <= 0) errors.push("Timeline dimensions must be positive.");
  if (timeline.fps <= 0) errors.push("Timeline FPS must be positive.");
  if (timeline.durationMs <= 0) errors.push("Timeline duration must be positive.");

  for (const clip of timeline.clips) {
    if (clip.startMs < 0) errors.push(`Clip starts before zero: ${clip.assetId}`);
    if (clip.endMs <= clip.startMs) errors.push(`Clip ends before or at its start: ${clip.assetId}`);
    if (clip.endMs > timeline.durationMs) errors.push(`Clip exceeds timeline duration: ${clip.assetId}`);
    if (clip.track < 0) errors.push(`Clip track cannot be negative: ${clip.assetId}`);
  }

  return errors;
}
