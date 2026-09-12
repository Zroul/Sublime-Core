import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  LocalBrain,
  NovaJob,
  NovaStage,
  NovaStageResult,
} from "./types.js";
import { NOVA_SYSTEM_PROMPT, buildStagePrompt } from "./prompt.js";

const NOVA_WORKSPACE = path.resolve("workspace", "nova");

const pipeline: NovaStage[] = [
  "trend_scout",
  "research",
  "rank",
  "script",
  "voice",
  "visuals",
  "video_build",
  "captions",
  "quality_check",
  "ready_to_review",
];

export class NovaOrchestrator {
  constructor(private readonly brain: LocalBrain) {}

  async createJob(topic: string): Promise<NovaJob> {
    const cleanTopic = topic.trim();

    if (!cleanTopic) {
      throw new Error("NOVA needs a topic.");
    }

    const id = randomUUID();
    const outputDir = path.join(NOVA_WORKSPACE, id);

    await fs.mkdir(outputDir, { recursive: true });

    const job: NovaJob = {
      id,
      topic: cleanTopic,
      createdAt: new Date().toISOString(),
      stage: "trend_scout",
      outputDir,
      status: "queued",
    };

    await this.writeJson(outputDir, "job.json", job);
    return job;
  }

  async run(job: NovaJob): Promise<NovaJob> {
    let current: NovaJob = { ...job, status: "running" };
    await this.writeJson(current.outputDir, "job.json", current);

    try {
      for (const stage of pipeline) {
        current = { ...current, stage };
        await this.writeJson(current.outputDir, "job.json", current);

        const result = await this.runStage(current, stage);
        await this.writeJson(
          current.outputDir,
          `${stage}.json`,
          result,
        );

        if (!result.ok) {
          throw new Error(`${stage} failed: ${result.summary}`);
        }
      }

      current = {
        ...current,
        stage: "ready_to_review",
        status: "completed",
      };
      await this.writeJson(current.outputDir, "job.json", current);
      return current;
    } catch (error) {
      current = {
        ...current,
        stage: "failed",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
      await this.writeJson(current.outputDir, "job.json", current);
      return current;
    }
  }

  private async runStage(
    job: NovaJob,
    stage: NovaStage,
  ): Promise<NovaStageResult> {
    if (stage === "ready_to_review" || stage === "failed") {
      return {
        stage,
        ok: true,
        summary: "Pipeline reached its review checkpoint.",
      };
    }

    const prompt = buildStagePrompt(stage, job.topic);
    const output = await this.brain.complete({
      system: NOVA_SYSTEM_PROMPT,
      prompt,
    });

    const cleanOutput = output.trim();

    return {
      stage,
      ok: cleanOutput.length > 0,
      summary: cleanOutput.length > 0 ? "Stage completed." : "Brain returned no output.",
      data: { output: cleanOutput },
    };
  }

  private async writeJson(
    directory: string,
    filename: string,
    value: unknown,
  ): Promise<void> {
    await fs.writeFile(
      path.join(directory, filename),
      JSON.stringify(value, null, 2),
      "utf8",
    );
  }
}
