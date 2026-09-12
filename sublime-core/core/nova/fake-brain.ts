import type { LocalBrain } from "./types.js";

const OUTPUTS: Record<string, Record<string, unknown>> = {
  trend_scout: {
    candidates: [
      { angle: "Three underrated free tools for students", score: 86 },
      { angle: "Free tools that replace paid student apps", score: 81 },
      { angle: "Hidden productivity tools students overlook", score: 78 },
    ],
  },
  research: {
    facts: [
      "Candidate ideas require verification before publication.",
      "No external source is claimed by this deterministic test brain.",
    ],
    claimsNeedingVerification: ["Tool availability and current pricing"],
  },
  rank: {
    primary: "Three underrated free tools for students",
    score: 86,
    alternatives: ["Free tools that replace paid student apps"],
  },
  script: {
    hook: "Three free tools students should know about.",
    narration: "Here are three useful free tools worth testing for study and productivity.",
    onScreenText: ["FREE TOOLS", "FOR STUDENTS"],
  },
  voice: {
    narration: "Here are three useful free tools worth testing for study and productivity.",
    pace: "natural",
  },
  visuals: {
    shots: [
      { durationMs: 2500, description: "Title card with the topic" },
      { durationMs: 5000, description: "Original screen-style graphics for each tool" },
    ],
    assetPolicy: "Use original, licensed, public-domain, or user-provided assets.",
  },
  video_build: {
    width: 1080,
    height: 1920,
    fps: 30,
    durationMs: 7500,
    clips: [],
  },
  captions: {
    chunks: [
      { startMs: 0, endMs: 3500, text: "Here are three useful free tools" },
      { startMs: 3500, endMs: 7500, text: "worth testing for study and productivity." },
    ],
  },
  quality_check: {
    decision: "PASS",
    issues: [],
    score: 100,
  },
};

export class NovaFakeBrain implements LocalBrain {
  async complete(input: { system: string; prompt: string }): Promise<string> {
    void input.system;
    const match = input.prompt.match(/NOVA stage:\s*([^\n]+)/i);
    const stage = match?.[1]?.trim() ?? "";
    const output = OUTPUTS[stage];

    if (!output) {
      return JSON.stringify({ message: "No fixture exists for this stage." });
    }

    return JSON.stringify(output, null, 2);
  }
}
