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
import { STAGE_CONTRACTS } from "./stage-contracts.js";
import { parseBrainOutput } from "./structured.js";
import {
  createManifest,
  recordArtifact,
  recordManifestError,
  updateManifest,
} from "./manifest.js";

const NOVA_WORKSPACE = path.resolve("workspace", "nova");
const MAX_CONTEXT_CHARS = 24_000;

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
    await createManifest(outputDir, {
      jobId: id,
      topic: cleanTopic,
      createdAt: job.createdAt,
      currentStage: job.stage,
      status: job.status,
    });

    return job;
  }

  async run(job: NovaJob): Promise<NovaJob> {
    let current: NovaJob = { ...job, status: "running", error: undefined };
    await this.writeJson(current.outputDir, "job.json", current);
    await updateManifest(current.outputDir, {
      currentStage: current.stage,
      status: current.status,
    });

    try {
      const startIndex = this.getResumeIndex(current);

      for (let index = startIndex; index < pipeline.length; index += 1) {
        const stage = pipeline[index];
        current = { ...current, stage, failedFromStage: undefined };
        await this.writeJson(current.outputDir, "job.json", current);
        await updateManifest(current.outputDir, {
          currentStage: stage,
          status: "running",
        });

        const result = await this.runStage(current, stage);
        const artifactFile = `${stage}.json`;
        await this.writeJson(current.outputDir, artifactFile, result);
        await recordArtifact(current.outputDir, {
          stage,
          file: artifactFile,
          createdAt: new Date().toISOString(),
        });

        if (!result.ok) {
          throw new Error(`${stage} failed: ${result.summary}`);
        }
      }

      current = {
        ...current,
        stage: "ready_to_review",
        status: "completed",
        error: undefined,
        failedFromStage: undefined,
      };
      await this.writeJson(current.outputDir, "job.json", current);
      await updateManifest(current.outputDir, {
        currentStage: "ready_to_review",
        status: "completed",
      });
      return current;
    } catch (error) {
      const failedStage = current.stage === "failed" ? undefined : current.stage;
      const message = error instanceof Error ? error.message : String(error);

      current = {
        ...current,
        stage: "failed",
        status: "failed",
        failedFromStage: failedStage,
        error: message,
      };
      await this.writeJson(current.outputDir, "job.json", current);
      await updateManifest(current.outputDir, {
        currentStage: "failed",
        status: "failed",
      });
      await recordManifestError(current.outputDir, message);
      return current;
    }
  }

  private getResumeIndex(job: NovaJob): number {
    if (job.status !== "failed") {
      return 0;
    }

    const resumeStage = job.failedFromStage ?? job.stage;
    const failedStageIndex = pipeline.indexOf(resumeStage);
    return failedStageIndex >= 0 ? failedStageIndex : 0;
  }

  private async runStage(
    job: NovaJob,
    stage: NovaStage,
  ): Promise<NovaStageResult> {
    if (stage === "ready_to_review") {
      const quality = await this.readStageResult(job.outputDir, "quality_check");
      const output = quality?.data?.output;

      if (typeof output !== "string" || output.trim().length === 0) {
        return {
          stage,
          ok: false,
          summary: "Quality check produced no usable result.",
        };
      }

      const decision = extractDecision(output);
      if (decision !== "PASS") {
        return {
          stage,
          ok: false,
          summary: `Quality check decision was ${decision ?? "unresolved"}.`,
          data: { qualityCheck: output, decision },
        };
      }

      return {
        stage,
        ok: true,
        summary: "Quality check passed. Job is ready for human review.",
        data: { qualityCheck: output, decision: "PASS" },
      };
    }

    if (stage === "failed") {
      return {
        stage,
        ok: false,
        summary: "Pipeline entered the failure state.",
      };
    }

    const context = await this.buildContext(job.outputDir, stage);
    const prompt = buildStagePrompt(stage, job.topic, context);
    const output = await this.brain.complete({
      system: NOVA_SYSTEM_PROMPT,
      prompt,
    });

    const parsed = parseBrainOutput(output);
    const cleanOutput = parsed.raw;

    return {
      stage,
      ok: cleanOutput.length > 0,
      summary:
        cleanOutput.length > 0
          ? "Stage completed."
          : "Brain returned no output.",
      data:
        parsed.format === "json"
          ? { output: cleanOutput, parsed: parsed.parsed, format: parsed.format }
          : { output: cleanOutput, format: parsed.format },
    };
  }

  private async buildContext(
    directory: string,
    stage: NovaStage,
  ): Promise<string> {
    const contract = STAGE_CONTRACTS[stage];
    const chunks: string[] = [];

    for (const file of contract.inputFiles) {
      try {
        const raw = await fs.readFile(path.join(directory, file), "utf8");
        chunks.push(`--- ${file} ---\n${raw}`);
      } catch {
        chunks.push(`--- ${file} ---\n[MISSING INPUT]`);
      }
    }

    const context = chunks.join("\n\n");
    if (context.length <= MAX_CONTEXT_CHARS) {
      return context || "No previous stage output is required for this stage.";
    }

    return `${context.slice(0, MAX_CONTEXT_CHARS)}\n\n[Context truncated by NOVA.]`;
  }

  private async readStageResult(
    directory: string,
    stage: NovaStage,
  ): Promise<NovaStageResult | null> {
    try {
      const raw = await fs.readFile(
        path.join(directory, `${stage}.json`),
        "utf8",
      );
      return JSON.parse(raw) as NovaStageResult;
    } catch {
      return null;
    }
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

function extractDecision(
  output: string,
): "PASS" | "NEEDS_REVIEW" | "FAIL" | null {
  const explicit = output.match(
    /(?:^|\n)\s*(?:decision|result)\s*:\s*(PASS|NEEDS_REVIEW|FAIL)\b/i,
  );
  if (explicit) {
    return explicit[1].toUpperCase() as "PASS" | "NEEDS_REVIEW" | "FAIL";
  }

  const normalized = output.toUpperCase();
  if (/\bNEEDS_REVIEW\b/.test(normalized)) return "NEEDS_REVIEW";
  if (/\bFAIL\b/.test(normalized)) return "FAIL";
  if (/\bPASS\b/.test(normalized)) return "PASS";

  return null;
}
