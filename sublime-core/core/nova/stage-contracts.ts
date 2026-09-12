import type { NovaStage } from "./types.js";

export interface StageContract {
  stage: NovaStage;
  goal: string;
  inputFiles: string[];
  outputFile: string;
  instructions: string[];
}

export const STAGE_CONTRACTS: Record<NovaStage, StageContract> = {
  trend_scout: {
    stage: "trend_scout",
    goal: "Identify promising content angles without pretending that live trend data was collected.",
    inputFiles: [],
    outputFile: "trend_scout.json",
    instructions: [
      "Return 3 to 5 candidate angles.",
      "Separate ideas from verified facts.",
      "Mark missing live-data requirements clearly.",
    ],
  },
  research: {
    stage: "research",
    goal: "Turn available research material into verified facts and source requirements.",
    inputFiles: ["trend_scout.json"],
    outputFile: "research.json",
    instructions: [
      "Use only supplied research data.",
      "Never invent sources or statistics.",
      "List claims that still need external verification.",
    ],
  },
  rank: {
    stage: "rank",
    goal: "Rank candidates using relevance, novelty, evidence quality, and audience value.",
    inputFiles: ["trend_scout.json", "research.json"],
    outputFile: "rank.json",
    instructions: [
      "Give each candidate a transparent score.",
      "Explain the strongest and weakest factor briefly.",
    ],
  },
  script: {
    stage: "script",
    goal: "Write a concise original short-form script from the selected idea and evidence.",
    inputFiles: ["rank.json", "research.json"],
    outputFile: "script.json",
    instructions: [
      "Use a strong opening hook.",
      "Keep claims tied to supplied evidence.",
      "Do not fabricate quotations.",
      "Return narration plus on-screen text suggestions.",
    ],
  },
  voice: {
    stage: "voice",
    goal: "Prepare narration-ready text and voice settings.",
    inputFiles: ["script.json"],
    outputFile: "voice.json",
    instructions: [
      "Preserve the script meaning.",
      "Add pacing and pronunciation notes only when useful.",
    ],
  },
  visuals: {
    stage: "visuals",
    goal: "Create a shot plan using original, licensed, public-domain, or user-provided assets.",
    inputFiles: ["script.json", "research.json"],
    outputFile: "visuals.json",
    instructions: [
      "Describe each shot and its purpose.",
      "Flag assets that require sourcing or licensing.",
      "Do not request copyrighted clips as if they were automatically safe to use.",
    ],
  },
  video_build: {
    stage: "video_build",
    goal: "Convert the approved script and visual plan into an executable edit plan.",
    inputFiles: ["script.json", "voice.json", "visuals.json"],
    outputFile: "video_build.json",
    instructions: [
      "Return a timeline plan with durations, layers, and transitions.",
      "Do not claim a video file was rendered unless a renderer actually ran.",
    ],
  },
  captions: {
    stage: "captions",
    goal: "Prepare readable timed captions from the final narration.",
    inputFiles: ["script.json", "voice.json"],
    outputFile: "captions.json",
    instructions: [
      "Keep caption chunks short and readable.",
      "Return timing as a plan unless actual audio timing exists.",
    ],
  },
  quality_check: {
    stage: "quality_check",
    goal: "Check factual integrity, completeness, originality, and production readiness.",
    inputFiles: ["research.json", "script.json", "visuals.json", "video_build.json", "captions.json"],
    outputFile: "quality_check.json",
    instructions: [
      "Return PASS, NEEDS_REVIEW, or FAIL.",
      "List concrete issues instead of vague warnings.",
      "Block unsupported factual claims.",
    ],
  },
  ready_to_review: {
    stage: "ready_to_review",
    goal: "Mark the job as ready for human review.",
    inputFiles: ["quality_check.json"],
    outputFile: "job.json",
    instructions: ["Never skip a failed quality check."],
  },
  failed: {
    stage: "failed",
    goal: "Record a recoverable pipeline failure.",
    inputFiles: [],
    outputFile: "job.json",
    instructions: ["Preserve the error message."],
  },
};
