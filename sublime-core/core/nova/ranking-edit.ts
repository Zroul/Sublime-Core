import type { VideoProductionRequest } from "./request-understanding.js";

/**
 * NOVA's deterministic ranking-edit planner.
 *
 * Plans edits from clips the user owns or has permission to use. It does not
 * download media, generate narration, or assume a sound-effects provider exists.
 */
export type RankingCategory = "angry" | "bath" | "vet" | "fighting" | "funny" | "other";

export interface RankingClip {
  id: string;
  path: string;
  category: RankingCategory;
  durationSeconds: number;
  /** Optional reviewed score; 1 is least entertaining and 100 is most entertaining. */
  entertainmentScore?: number;
  title?: string;
  sourceNote?: string;
}

export interface RankingEditSegment {
  rank: number;
  clipId: string;
  path: string;
  category: RankingCategory;
  sourceDurationSeconds: number;
  entertainmentScore?: number;
  /** In/out points in the rendered output timeline. */
  startSeconds: number;
  endSeconds: number;
  /** In/out points within the source media. */
  sourceStartSeconds: number;
  sourceEndSeconds: number;
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
  if (!clip || typeof clip.id !== "string" || !clip.id.trim()) {
    throw new Error("Every ranking clip needs a non-empty id.");
  }
  if (typeof clip.path !== "string" || !clip.path.trim()) {
    throw new Error(`Ranking clip "${clip.id}" needs a media path.`);
  }
  if (!Object.hasOwn(CATEGORY_LABELS, clip.category)) {
    throw new Error(`Ranking clip "${clip.id}" has an unsupported category.`);
  }
  if (!Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0) {
    throw new Error(`Ranking clip "${clip.id}" must have a positive duration.`);
  }
  if (clip.entertainmentScore !== undefined &&
      (!Number.isFinite(clip.entertainmentScore) || clip.entertainmentScore < 1 || clip.entertainmentScore > 100)) {
    throw new Error(`Ranking clip "${clip.id}" entertainmentScore must be between 1 and 100.`);
  }
}

/** Allocate the target fairly without ever asking for more source footage than exists. */
function allocateDurations(capacitySeconds: number[], targetSeconds: number): number[] {
  const targetMs = Math.round(targetSeconds * 1000);
  // video_engine currently limits each rendered scene to 120 seconds.
  const capacitiesMs = capacitySeconds.map((duration) => Math.floor(Math.min(duration, 120) * 1000 + 1e-6));
  if (capacitiesMs.reduce((sum, value) => sum + value, 0) < targetMs) {
    throw new Error("The supplied clips do not contain enough usable footage for the requested duration (maximum 120 seconds per rendered clip).");
  }

  const allocated = capacitiesMs.map(() => 0);
  let remaining = targetMs;
  let active = capacitiesMs.map((_, index) => index);
  while (remaining > 0 && active.length > 0) {
    const share = Math.max(1, Math.floor(remaining / active.length));
    const nextActive: number[] = [];
    for (const index of active) {
      if (remaining === 0) break;
      const available = capacitiesMs[index] - allocated[index];
      const amount = Math.min(available, share, remaining);
      allocated[index] += amount;
      remaining -= amount;
      if (allocated[index] < capacitiesMs[index]) nextActive.push(index);
    }
    active = nextActive;
  }
  if (remaining !== 0) throw new Error("Could not allocate the requested ranking duration.");
  return allocated.map((milliseconds) => milliseconds / 1000);
}

/**
 * Builds a narration-free plan. When every clip has a reviewed entertainmentScore,
 * clips are sorted from least to most entertaining; otherwise input order is preserved.
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
  const aspectRatio = input.aspectRatio ?? "9:16";
  if (aspectRatio !== "16:9" && aspectRatio !== "9:16" && aspectRatio !== "1:1") {
    throw new Error("Ranking aspect ratio must be 16:9, 9:16, or 1:1.");
  }

  const seen = new Set<string>();
  for (const clip of clips) {
    validateClip(clip);
    if (seen.has(clip.id)) throw new Error(`Duplicate ranking clip id: ${clip.id}`);
    seen.add(clip.id);
  }

  const scoredCount = clips.filter((clip) => clip.entertainmentScore !== undefined).length;
  if (scoredCount > 0 && scoredCount !== clips.length) {
    throw new Error("Provide entertainmentScore for every clip or for none of them.");
  }
  const orderedClips = scoredCount > 0
    ? [...clips].sort((a, b) => (a.entertainmentScore as number) - (b.entertainmentScore as number))
    : clips;
  const durations = allocateDurations(orderedClips.map((clip) => clip.durationSeconds), targetSeconds);
  let cursorMs = 0;
  const segments = orderedClips.map((clip, index) => {
    const durationMs = Math.round(durations[index] * 1000);
    const startMs = cursorMs;
    const endMs = startMs + durationMs;
    cursorMs = endMs;
    const rank = clips.length - index;
    return {
      rank,
      clipId: clip.id,
      path: clip.path,
      category: clip.category,
      sourceDurationSeconds: clip.durationSeconds,
      ...(clip.entertainmentScore !== undefined ? { entertainmentScore: clip.entertainmentScore } : {}),
      startSeconds: startMs / 1000,
      endSeconds: endMs / 1000,
      sourceStartSeconds: 0,
      sourceEndSeconds: durationMs / 1000,
      durationSeconds: durationMs / 1000,
      onScreenLabel: `#${rank} ${CATEGORY_LABELS[clip.category]}`,
      soundCue: index === 0 ? "hook_pop" as const : index === clips.length - 1 ? "rank_sting" as const : "none" as const,
    };
  });

  return {
    type: "nova_ranking_edit_v1",
    title: input.title?.trim() || "FUNNIEST CAT MOMENTS",
    aspectRatio,
    targetSeconds,
    narration: false,
    segments,
    notes: [
      scoredCount > 0
        ? "Clips were sorted from least to most entertaining by the supplied reviewed entertainmentScore values."
        : "Clip order is preserved; arrange clips from least to most entertaining after reviewing the source footage.",
      "Hook and rank cues are short original synthesized tones; no external sound asset or narration is required.",
      "Only use source clips you own or have permission to edit and publish.",
    ],
  };
}


/**
 * Convert a validated plan into the existing video_engine render contract.
 * Clip paths must be workspace-relative paths inside workspace/assets.
 */
export function toRankingRenderInput(
  plan: RankingEditPlan,
  jobId: string,
  outputPath: string,
): Record<string, unknown> {
  if (plan.type !== "nova_ranking_edit_v1" || plan.narration !== false || plan.segments.length === 0) {
    throw new Error("Invalid or empty NOVA ranking edit plan.");
  }
  if (!jobId.trim()) throw new Error("A ranking render needs a non-empty job id.");
  if (!outputPath.trim()) throw new Error("A ranking render needs an output path.");

  const scenes = plan.segments.map((segment, index) => {
    const normalized = segment.path.split(String.fromCharCode(92)).join("/");
    const pathSegments = normalized.split("/");
    if (
      !normalized.startsWith("assets/") ||
      normalized.startsWith("/") ||
      /^[a-z]:/i.test(normalized) ||
      pathSegments.some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error(`Ranking clip "${segment.clipId}" must be inside workspace/assets.`);
    }
    if (segment.durationSeconds <= 0 || segment.durationSeconds > 120 || segment.sourceEndSeconds > segment.sourceDurationSeconds + 0.001) {
      throw new Error(`Ranking clip "${segment.clipId}" has invalid trim timing.`);
    }
    return {
      index: index + 1,
      duration: segment.durationSeconds,
      asset_path: normalized,
      asset_media_type: "video",
      asset_fit: "cover",
      text: segment.onScreenLabel,
      text_size: plan.aspectRatio === "9:16" ? 48 : 56,
      text_position: "top",
      text_max_width: plan.aspectRatio === "9:16" ? 620 : 1120,
      background: "080808",
      visual: `Ranking clip ${segment.rank}: ${segment.category}`,
    };
  });

  return {
    action: "render",
    id: jobId,
    output: outputPath,
    aspect_ratio: plan.aspectRatio,
    scenes,
    sound_cues: plan.segments
      .filter((segment) => segment.soundCue !== "none")
      .map((segment) => ({ kind: segment.soundCue, at_seconds: segment.startSeconds })),
  };
}
