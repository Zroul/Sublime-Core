import type { LocalBrain } from "./types.js";

const decisions = ["PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS"];

export class NovaFakeBrain implements LocalBrain {
  private calls = 0;

  constructor(private readonly failAtCall?: number) {}

  async complete(input: { system: string; prompt: string }): Promise<string> {
    this.calls += 1;

    if (this.failAtCall === this.calls) {
      throw new Error(`Fake brain failure at call ${this.calls}.`);
    }

    const stage = input.prompt.match(/NOVA stage:\s*([^\n]+)/)?.[1]?.trim() ?? "unknown";

    if (stage === "quality_check") {
      return JSON.stringify({ decision: decisions[Math.min(this.calls - 1, decisions.length - 1)] ?? "PASS", issues: [], score: 100 });
    }

    return JSON.stringify({
      stage,
      topic: input.prompt.match(/Topic:\s*([^\n]+)/)?.[1]?.trim() ?? "",
      result: `Deterministic test output for ${stage}.`,
    });
  }
}
