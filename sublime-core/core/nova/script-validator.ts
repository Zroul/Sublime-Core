import type { VideoScript } from "./script-generator.js";

export interface ScriptValidationResult {
  valid: boolean;
  score: number;
  errors: string[];
  warnings: string[];
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateScript(
  script: VideoScript,
  targetSeconds = 60,
): ScriptValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isNonEmpty(script.title)) errors.push("Title is missing.");
  if (!isNonEmpty(script.hook)) errors.push("Hook is missing.");
  if (!isNonEmpty(script.ending)) errors.push("Ending is missing.");
  if (!Array.isArray(script.sections) || script.sections.length === 0) {
    errors.push("Script must contain at least one section.");
  }

  let narrationWords = wordCount(script.hook) + wordCount(script.ending);

  for (const [index, section] of (script.sections ?? []).entries()) {
    if (!isNonEmpty(section?.heading)) {
      errors.push(`Section ${index + 1} has no heading.`);
    }
    if (!isNonEmpty(section?.narration)) {
      errors.push(`Section ${index + 1} has no narration.`);
    } else {
      narrationWords += wordCount(section.narration);
    }
    if (!isNonEmpty(section?.visualDirection)) {
      warnings.push(`Section ${index + 1} has no visual direction.`);
    }
  }

  if (!Number.isFinite(script.estimatedSeconds) || script.estimatedSeconds <= 0) {
    errors.push("Estimated duration must be a positive number.");
  }

  const estimatedFromWords = Math.round((narrationWords / 150) * 60);
  const durationDifference = Math.abs(estimatedFromWords - targetSeconds);

  if (durationDifference > Math.max(8, targetSeconds * 0.2)) {
    warnings.push(
      `Narration length suggests about ${estimatedFromWords}s, while the target is ${targetSeconds}s.`,
    );
  }

  if (Math.abs(script.estimatedSeconds - targetSeconds) > Math.max(10, targetSeconds * 0.25)) {
    warnings.push(
      `Model-estimated duration (${script.estimatedSeconds}s) is far from the target (${targetSeconds}s).`,
    );
  }

  if (narrationWords < 35 && targetSeconds >= 45) {
    warnings.push("The script is probably too short for the requested runtime.");
  }

  if (narrationWords > 220 && targetSeconds <= 60) {
    warnings.push("The script may be too dense for the requested runtime.");
  }

  const score = Math.max(
    0,
    Math.min(100, 100 - errors.length * 30 - warnings.length * 10),
  );

  return {
    valid: errors.length === 0,
    score,
    errors,
    warnings,
  };
}
