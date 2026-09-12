import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { LocalBrain, NovaJob, NovaStage, NovaStageResult } from "./types.js";
import { NOVA_SYSTEM_PROMPT, buildStagePrompt } from "./prompt.js";
import { STAGE_CONTRACTS } from "./stage-contracts.js";
import { parseBrainOutput } from "./structured.js";
import { parseQualityReport } from "./quality.js";
import { createManifest, recordArtifact, recordManifestError, updateManifest } from "./manifest.js";
import type { NovaAbilities } from "./abilities/types.js";
import { createNovaAbilities } from "./abilities/registry.js";
import type { MediaAbilities, VideoTimeline } from "./abilities/media-types.js";
import { collectResearch } from "./research.js";
import { readControlState } from "./job-state.js";

const NOVA_WORKSPACE = path.resolve("workspace", "nova");
const MAX_CONTEXT_CHARS = 24_000;
const pipeline: NovaStage[] = ["trend_scout", "research", "rank", "script", "voice", "visuals", "video_build", "captions", "quality_check", "ready_to_review"];

export interface NovaOrchestratorOptions { abilities?: NovaAbilities; media?: MediaAbilities; }

export class NovaOrchestrator {
  private readonly abilities: NovaAbilities;
  private readonly media: MediaAbilities;

  constructor(private readonly brain: LocalBrain, options: NovaOrchestratorOptions = {}) {
    this.abilities = options.abilities ?? createNovaAbilities();
    this.media = options.media ?? {};
  }

  async createJob(topic: string): Promise<NovaJob> {
    const cleanTopic = topic.trim();
    if (!cleanTopic) throw new Error("NOVA needs a topic.");
    const id = randomUUID();
    const outputDir = path.join(NOVA_WORKSPACE, id);
    await fs.mkdir(outputDir, { recursive: true });
    const job: NovaJob = { id, topic: cleanTopic, createdAt: new Date().toISOString(), stage: "trend_scout", outputDir, status: "queued" };
    await this.writeJson(outputDir, "job.json", job);
    await createManifest(outputDir, { jobId: id, topic: cleanTopic, createdAt: job.createdAt, currentStage: job.stage, status: job.status });
    return job;
  }

  async run(job: NovaJob): Promise<NovaJob> {
    let current: NovaJob = { ...job, status: "running", error: undefined };
    await this.writeJson(current.outputDir, "job.json", current);
    await updateManifest(current.outputDir, { currentStage: current.stage, status: current.status });
    try {
      const startIndex = this.getResumeIndex(current);
      for (let index = startIndex; index < pipeline.length; index += 1) {
        await this.throwIfStopRequested(current);
        const stage = pipeline[index];
        current = { ...current, stage, failedFromStage: undefined };
        await this.writeJson(current.outputDir, "job.json", current);
        await updateManifest(current.outputDir, { currentStage: stage, status: "running" });
        const result = await this.runStage(current, stage);
        await this.throwIfStopRequested(current);
        const artifactFile = `${stage}.json`;
        await this.writeJson(current.outputDir, artifactFile, result);
        await recordArtifact(current.outputDir, { stage, file: artifactFile, createdAt: new Date().toISOString() });
        if (!result.ok) throw new Error(`${stage} failed: ${result.summary}`);
      }
      current = { ...current, stage: "ready_to_review", status: "completed", error: undefined, failedFromStage: undefined };
      await this.writeJson(current.outputDir, "job.json", current);
      await updateManifest(current.outputDir, { currentStage: "ready_to_review", status: "completed" });
      return current;
    } catch (error) {
      const failedStage = current.stage === "failed" ? undefined : current.stage;
      const message = error instanceof Error ? error.message : String(error);
      current = { ...current, stage: "failed", status: "failed", failedFromStage: failedStage, error: message };
      await this.writeJson(current.outputDir, "job.json", current);
      await updateManifest(current.outputDir, { currentStage: "failed", status: "failed" });
      await recordManifestError(current.outputDir, message);
      return current;
    }
  }

  private getResumeIndex(job: NovaJob): number {
    if (job.status !== "failed") return 0;
    const index = pipeline.indexOf(job.failedFromStage ?? job.stage);
    return index >= 0 ? index : 0;
  }

  private async runStage(job: NovaJob, stage: NovaStage): Promise<NovaStageResult> {
    await this.throwIfStopRequested(job);
    if (stage === "ready_to_review") {
      const quality = await this.readStageResult(job.outputDir, "quality_check");
      const output = quality?.data?.output;
      const report = parseQualityReport(quality?.data?.parsed);
      if (report) {
        return report.decision === "PASS"
          ? { stage, ok: true, summary: "Strict quality report passed. Job is ready for human review.", data: { qualityCheck: output, report } }
          : { stage, ok: false, summary: `Quality check decision was ${report.decision}.`, data: { qualityCheck: output, report } };
      }
      if (typeof output !== "string" || !output.trim()) return { stage, ok: false, summary: "Quality check produced no usable result." };
      const decision = extractDecision(output);
      return decision === "PASS"
        ? { stage, ok: true, summary: "Quality check passed. Job is ready for human review.", data: { qualityCheck: output, decision } }
        : { stage, ok: false, summary: `Quality check decision was ${decision ?? "unresolved"}.`, data: { qualityCheck: output, decision } };
    }
    if (stage === "failed") return { stage, ok: false, summary: "Pipeline entered the failure state." };

    const context = await this.buildContext(job.outputDir, stage);
    const output = await this.brain.complete({ system: NOVA_SYSTEM_PROMPT, prompt: buildStagePrompt(stage, job.topic, context) });
    await this.throwIfStopRequested(job);
    const parsed = parseBrainOutput(output);
    const cleanOutput = parsed.raw;
    const baseData: Record<string, unknown> = parsed.format === "json" ? { output: cleanOutput, parsed: parsed.parsed, format: parsed.format } : { output: cleanOutput, format: parsed.format };

    if (stage === "research") {
      const research = await collectResearch(job.topic, this.abilities, { jobId: job.id, topic: job.topic, outputDir: job.outputDir });
      return { stage, ok: !!cleanOutput, summary: cleanOutput ? "Research reasoning completed and tool evidence collected." : "Brain returned no research reasoning.", data: { ...baseData, toolResearch: { ...research, mediaCapabilities: this.mediaCapabilities() } } };
    }

    if (stage === "voice") {
      const narration = extractNarration(parsed.parsed) ?? cleanOutput;
      if (this.media.textToSpeech && narration) {
        const asset = await this.media.textToSpeech(narration, path.join(job.outputDir, "media", "narration.wav"));
        return { stage, ok: !!cleanOutput, summary: "Voice plan completed and local audio was generated.", data: { ...baseData, mediaAsset: asset } };
      }
      return { stage, ok: !!cleanOutput, summary: "Voice plan completed without generated audio.", data: { ...baseData, mediaAsset: null } };
    }

    if (stage === "video_build") {
      const timeline = extractTimeline(parsed.parsed, cleanOutput);
      if (this.media.render) {
        const asset = await this.media.render(timeline, path.join(job.outputDir, "media", "video.mp4"));
        return { stage, ok: !!cleanOutput, summary: "Video timeline built and local renderer produced a video.", data: { ...baseData, timeline, mediaAsset: asset } };
      }
      return { stage, ok: !!cleanOutput, summary: "Video timeline built without a renderer.", data: { ...baseData, timeline, mediaAsset: null } };
    }

    if (stage === "captions") {
      const voice = await this.readStageResult(job.outputDir, "voice");
      const audioPath = (voice?.data?.mediaAsset as { path?: string } | null | undefined)?.path;
      if (this.media.generateCaptions && audioPath) {
        const asset = await this.media.generateCaptions(audioPath, path.join(job.outputDir, "media", "captions.srt"));
        return { stage, ok: !!cleanOutput, summary: "Caption plan completed and local captions were generated.", data: { ...baseData, mediaAsset: asset } };
      }
      return { stage, ok: !!cleanOutput, summary: "Caption plan completed without generated caption timing.", data: { ...baseData, mediaAsset: null } };
    }

    return { stage, ok: !!cleanOutput, summary: cleanOutput ? "Stage completed." : "Brain returned no output.", data: baseData };
  }

  private mediaCapabilities(): string[] { return Object.keys(this.media).filter((key) => typeof this.media[key as keyof MediaAbilities] === "function"); }
  private async throwIfStopRequested(job: NovaJob): Promise<void> { if ((await readControlState(job.outputDir)).stopRequested) throw new Error("Stop requested by user."); }

  private async buildContext(directory: string, stage: NovaStage): Promise<string> {
    const chunks: string[] = [];
    for (const file of STAGE_CONTRACTS[stage].inputFiles) {
      try { chunks.push(`--- ${file} ---\n${await fs.readFile(path.join(directory, file), "utf8")}`); }
      catch { chunks.push(`--- ${file} ---\n[MISSING INPUT]`); }
    }
    const context = chunks.join("\n\n");
    return context.length <= MAX_CONTEXT_CHARS ? context || "No previous stage output is required for this stage." : `${context.slice(0, MAX_CONTEXT_CHARS)}\n\n[Context truncated by NOVA.]`;
  }

  private async readStageResult(directory: string, stage: NovaStage): Promise<NovaStageResult | null> {
    try { return JSON.parse(await fs.readFile(path.join(directory, `${stage}.json`), "utf8")) as NovaStageResult; }
    catch { return null; }
  }
  private async writeJson(directory: string, filename: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(path.join(directory, filename)), { recursive: true });
    await fs.writeFile(path.join(directory, filename), JSON.stringify(value, null, 2), "utf8");
  }
}

function extractNarration(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const value = (parsed as Record<string, unknown>).narration;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractTimeline(parsed: unknown, fallback: string): VideoTimeline {
  if (parsed && typeof parsed === "object") {
    const value = parsed as Record<string, unknown>;
    const clips = Array.isArray(value.clips) ? value.clips.filter((clip) => clip && typeof clip === "object") : [];
    return { width: numberOr(value.width, 1080), height: numberOr(value.height, 1920), fps: numberOr(value.fps, 30), durationMs: numberOr(value.durationMs, Math.max(1000, fallback.length * 45)), clips: clips as VideoTimeline["clips"] };
  }
  return { width: 1080, height: 1920, fps: 30, durationMs: Math.max(1000, fallback.length * 45), clips: [] };
}
function numberOr(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback; }
function extractDecision(output: string): "PASS" | "NEEDS_REVIEW" | "FAIL" | null {
  const explicit = output.match(/(?:^|\n)\s*(?:decision|result)\s*:\s*(PASS|NEEDS_REVIEW|FAIL)\b/i);
  if (explicit) return explicit[1].toUpperCase() as "PASS" | "NEEDS_REVIEW" | "FAIL";
  const normalized = output.toUpperCase();
  if (/\bNEEDS_REVIEW\b/.test(normalized)) return "NEEDS_REVIEW";
  if (/\bFAIL\b/.test(normalized)) return "FAIL";
  if (/\bPASS\b/.test(normalized)) return "PASS";
  return null;
}
