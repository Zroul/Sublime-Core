import type { VideoProductionRequest } from "./request-understanding.js";

/**
 * NOVA's first deterministic ranking-edit planner.
 *
 * This module deliberately plans edits from clips the user already owns or has
 * permission to use. It does not download media, generate narration, or assume
 * a sound-effects provider is installed.
 */
export type RankingCategory =
  | "angry"
  | "bath"
  | "vet"
  | "fighting"
  | "funny"
  | "other";

export interface RankingClip {
  id: string;
  path: string;
  category: RankingCategory;
  durationSeconds: number;
  title?: string;
  sourceNote?: string;
}

export interface RankingEditSegment {
  rank: number;
  clipId: string;
  path: string;
  category: RankingCategory;
  sourceDurationSeconds: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  onScreenLabel: string;
  soundCue: "hook_pop" | "rank_sting" | "none";
}

export interface RankingEditPlan {
  type: "nova_ranking_edit_v1";
  title: string;
  aspectRatio: VideoProductionRequest["aspectRatio"];
  targetSeconds: number;
  narration: false;
  segments: RankingEditSegment[];
  notes: string[];
}

const CATEGORY_LABELS: Record<RankingCategory, string> = {
  angry: "ANGRY CAT",
  bath: "BATH TIME",
  vet: "VET VISIT",
  fighting: "CAT DRAMA",
  funny: "CHAOS MODE",
  other: "UNEXPECTED MOMENT",
};

function validateClip(clip: RankingClip): void {
  if (!clip.id.trim()) throw new Error("Every ranking clip needs a non-empty id.");
  if (!clip.path.trim()) throw new Error(`Ranking clip "${clip.id}" needs a media path.`);
  if (!Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0) {
    throw new Error(`Ranking clip "${clip.id}" must have a positive duration.`);
  }
}

function distributeDuration(total: number, count: number): number[] {
  const base = Math.floor((total / count) * 1000) / 1000;
  const durations = Array.from({ length: count }, () => base);
  durations[count - 1] = Number((total - base * (count - 1)).toFixed(3));
  return durations;
}

/**
 * Builds a stable, narration-free ranking plan. Input order is preserved so
 * callers can provide their own ranking after reviewing the source footage.
 */
export function createRankingEditPlan(input: {
  clips: RankingClip[];
  targetSeconds: number;
  aspectRatio?: VideoProductionRequest["aspectRatio"];
  title?: string;
}): RankingEditPlan {
  const { clips, targetSeconds } = input;
  if (!Array.isArray(clips) || clips.length === 0) {
    throw new Error("A ranking edit needs at least one approved source clip.");
  }
  if (!Number.isFinite(targetSeconds) || targetSeconds < 3 || targetSeconds > 600) {
    throw new Error("Ranking target duration must be between 3 and 600 seconds.");
  }

  const seen = new Set<string>();
  for (const clip of clips) {
    validateClip(clip);
    if (seen.has(clip.id)) throw new Error(`Duplicate ranking clip id: ${clip.id}`);
    seen.add(clip.id);
  }

  const durations = distributeDuration(targetSeconds, clips.length);
  let cursor = 0;
  const segments = clips.map((clip, index) => {
    const duration = durations[index];
    const startSeconds = Number(cursor.toFixed(3));
    const endSeconds = Number((cursor + duration).toFixed(3));
    cursor = endSeconds;
    return {
      rank: clips.length - index,
      clipId: clip.id,
      path: clip.path,
      category: clip.category,
      sourceDurationSeconds: clip.durationSeconds,
      startSeconds,
      endSeconds,
      durationSeconds: duration,
      onScreenLabel: `#${clips.length - index} ${CATEGORY_LABELS[clip.category]}`,
      soundCue: index === 0 ? "hook_pop" as const : index === clips.length - 1 ? "rank_sting" as const : "none" as const,
    };
  });

  return {
    type: "nova_ranking_edit_v1",
    title: input.title?.trim() || "FUNNIEST CAT MOMENTS",
    aspectRatio: input.aspectRatio ?? "9:16",
    targetSeconds,
    narration: false,
    segments,
    notes: [
      "Clip order is preserved; review the source footage and arrange clips from least to most entertaining before rendering.",
      "Sound cues are edit markers only; the renderer must confirm that a licensed/local sound asset exists before adding audio.",
      "Only use source clips you own or have permission to edit and publish.",
    ],
  };
}
