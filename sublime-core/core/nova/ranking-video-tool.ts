import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool, AgentState } from "../ai/reasoning/types.js";
import { videoEngineTool } from "../ai/tools/video-engine.js";
import { resolveWorkspacePath } from "../ai/tools/workspace-path.js";
import {
  createRankingEditPlan,
  toRankingRenderInput,
  type RankingCategory,
  type RankingClip,
} from "./ranking-edit.js";

type EngineResult = Record<string, unknown>;

function parseEngineResult(result: unknown, operation: string): EngineResult {
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result) as EngineResult;
      if (parsed.ok === false) throw new Error(String(parsed.error ?? operation + " failed."));
      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("video_engine returned invalid JSON for " + operation + ".");
      throw error;
    }
  }
  if (result && typeof result === "object") {
    const toolResult = result as { content?: unknown; isError?: boolean };
    if (toolResult.isError) throw new Error(String(toolResult.content ?? operation + " failed."));
    if (typeof toolResult.content === "string") return parseEngineResult(toolResult.content, operation);
  }
  throw new Error("video_engine returned an unsupported result for " + operation + ".");
}

function safeJobId(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 64) || "ranking-" + Date.now().toString(36);
}

function validateAssetPath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Every clip needs a workspace asset path.");
  const normalized = value.split(String.fromCharCode(92)).join("/");
  const segments = normalized.split("/");
  if (
    !normalized.startsWith("assets/") ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Ranking clips must use paths inside workspace/assets, such as assets/cats/clip-01.mp4.");
  }
  return normalized;
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v"]);

function inferCategory(relativePath: string): RankingCategory {
  const normalized = relativePath.toLowerCase().replace(/[\s_]+/g, "-");
  if (/\b(fight|fighting|battle|brawl)\b/.test(normalized)) return "fighting";
  if (/\b(bath|bathing|shower|wash)\b/.test(normalized)) return "bath";
  if (/\b(vet|veterinary|clinic)\b/.test(normalized)) return "vet";
  if (/\b(angry|anger|mad|hiss|hissing)\b/.test(normalized)) return "angry";
  if (/\b(funny|funniest|chaos|silly|fail)\b/.test(normalized)) return "funny";
  return "other";
}

async function discoverAssetClips(folderValue: unknown): Promise<Array<{ id: string; path: string; category: RankingCategory }>> {
  const folder = validateAssetPath(folderValue);
  const absoluteFolder = await resolveWorkspacePath(folder);
  const folderStat = await fs.stat(absoluteFolder);
  if (!folderStat.isDirectory()) throw new Error("asset_folder must point to a directory inside workspace/assets.");

  const discoveredPaths: string[] = [];
  let visitedEntries = 0;
  async function walk(relativeDirectory: string): Promise<void> {
    const absoluteDirectory = await resolveWorkspacePath(relativeDirectory);
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > 1000) throw new Error("asset_folder contains too many entries; keep a folder scan under 1000 entries.");
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(relativePath);
      } else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        discoveredPaths.push(relativePath);
        if (discoveredPaths.length > 30) throw new Error("asset_folder contains more than 30 video clips; split it into smaller ranking jobs.");
      }
    }
  }

  await walk(folder);
  discoveredPaths.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  if (discoveredPaths.length === 0) throw new Error("asset_folder contains no supported video files.");
  return discoveredPaths.map((clipPath, index) => ({
    id: "clip-" + String(index + 1).padStart(2, "0"),
    path: clipPath,
    category: inferCategory(clipPath),
  }));
}

/**
 * End-to-end ranking-video tool: probes supplied source files, builds a plan,
 * renders with the existing local video engine, then probes the final MP4.
 */
export function createRankingVideoTool(videoEngine: Tool = videoEngineTool): Tool {
  return {
    name: "ranking_video",
    description: "Create a narration-free cat/dog ranking edit from approved clips in workspace/assets. Supply clips explicitly or use asset_folder to discover up to 30 local videos and infer categories from folder names. Optional reviewed entertainment_score values (1-100) sort clips least-to-most entertaining. Probes real durations, renders synthesized hook/rank tones, saves the plan, and validates the final MP4. Does not download or publish footage.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: 120 },
        job_id: { type: "string", maxLength: 64 },
        target_seconds: { type: "number", minimum: 3, maximum: 600 },
        aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"] },
        asset_folder: { type: "string", minLength: 1, maxLength: 500 },
        clips: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1, maxLength: 80 },
              path: { type: "string", minLength: 1, maxLength: 500 },
              category: { type: "string", enum: ["angry", "bath", "vet", "fighting", "funny", "other"] },
              entertainment_score: { type: "number", minimum: 1, maximum: 100 },
            },
            required: ["id", "path", "category"],
          },
        },
      },
      required: ["target_seconds"],
      additionalProperties: false,
    },
    async handler(args: Record<string, unknown>, ctx: AgentState) {
      try {
        let rawClips: unknown = args.clips;
        if (rawClips === undefined && typeof args.asset_folder === "string") {
          rawClips = await discoverAssetClips(args.asset_folder);
        }
        if (!Array.isArray(rawClips) || rawClips.length === 0 || rawClips.length > 30) {
          throw new Error("Supply 1-30 approved clips or an asset_folder containing 1-30 videos.");
        }
        if (args.asset_folder !== undefined && args.clips !== undefined) {
          throw new Error("Supply either clips or asset_folder, not both.");
        }
        const jobId = safeJobId(typeof args.job_id === "string" ? args.job_id : "ranking-" + Date.now().toString(36));
        const targetSeconds = Number(args.target_seconds);
        if (!Number.isFinite(targetSeconds) || targetSeconds < 3 || targetSeconds > 600) {
          throw new Error("target_seconds must be between 3 and 600.");
        }
        const aspectRatio = args.aspect_ratio === undefined ? "9:16" : String(args.aspect_ratio);
        if (aspectRatio !== "16:9" && aspectRatio !== "9:16" && aspectRatio !== "1:1") {
          throw new Error("aspect_ratio must be 16:9, 9:16, or 1:1.");
        }

        const clips: RankingClip[] = [];
        for (const [index, raw] of rawClips.entries()) {
          if (!raw || typeof raw !== "object") throw new Error("Clip " + (index + 1) + " must be an object.");
          const item = raw as Record<string, unknown>;
          const id = typeof item.id === "string" ? item.id.trim() : "";
          const category = item.category as RankingCategory;
          const assetPath = validateAssetPath(item.path);
          if (!id) throw new Error("Clip " + (index + 1) + " needs a non-empty id.");
          const probe = parseEngineResult(
            await videoEngine.handler({ action: "probe", path: assetPath }, ctx),
            "source probe",
          );
          const metadata = probe.metadata as Record<string, unknown> | undefined;
          const durationSeconds = Number(metadata?.durationSeconds);
          if (probe.ok !== true || probe.valid !== true || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
            throw new Error("Source clip " + id + " did not pass media validation.");
          }
          const entertainmentScore = item.entertainment_score === undefined
            ? undefined
            : Number(item.entertainment_score);
          clips.push({
            id,
            path: assetPath,
            category,
            durationSeconds,
            ...(entertainmentScore !== undefined ? { entertainmentScore } : {}),
          });
        }

        const plan = createRankingEditPlan({
          clips,
          targetSeconds,
          aspectRatio,
          title: typeof args.title === "string" ? args.title : undefined,
        });
        const jobRoot = "nova/jobs/" + jobId;
        const jobDirectory = await resolveWorkspacePath(jobRoot);
        const planPath = await resolveWorkspacePath(path.join(jobRoot, "ranking-plan.json"));
        await fs.mkdir(path.dirname(jobDirectory), { recursive: true });
        try {
          await fs.mkdir(jobDirectory, { recursive: false });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new Error(`Ranking job "${jobId}" already exists; choose a new job_id to avoid overwriting its artifacts.`);
          }
          throw error;
        }
        await fs.writeFile(planPath, JSON.stringify(plan, null, 2) + String.fromCharCode(10), "utf8");

        const outputPath = jobRoot + "/final.mp4";
        const renderInput = toRankingRenderInput(plan, jobId, outputPath);
        const rendered = parseEngineResult(await videoEngine.handler(renderInput, ctx), "ranking render");
        if (rendered.ok !== true || typeof rendered.outputPath !== "string") {
          throw new Error("The video engine did not confirm a rendered output file.");
        }
        const expectedSoundCueCount = plan.segments.filter((segment) => segment.soundCue !== "none").length;
        if (Number(rendered.soundCueCount) !== expectedSoundCueCount ||
            (expectedSoundCueCount > 0 && rendered.audioTrackPresent !== true)) {
          throw new Error("The video engine did not confirm all requested sound cues were rendered.");
        }
        const finalPath = String(rendered.outputPath);
        const finalProbe = parseEngineResult(
          await videoEngine.handler({ action: "probe", path: finalPath }, ctx),
          "final MP4 probe",
        );
        if (finalProbe.ok !== true || finalProbe.valid !== true) {
          throw new Error("The rendered ranking MP4 did not pass final media validation.");
        }
        const finalMetadata = finalProbe.metadata as Record<string, unknown> | undefined;
        const finalStreams = Array.isArray(finalMetadata?.streams) ? finalMetadata.streams as Array<Record<string, unknown>> : [];
        if (expectedSoundCueCount > 0 && !finalStreams.some((stream) => stream.type === "audio")) {
          throw new Error("The final ranking MP4 is missing its expected sound-effects audio track.");
        }
        const actualDuration = Number(finalMetadata?.durationSeconds);
        if (!Number.isFinite(actualDuration) || Math.abs(actualDuration - plan.targetSeconds) > 0.75) {
          throw new Error(`Rendered duration ${actualDuration}s does not match the requested ${plan.targetSeconds}s target.`);
        }
        return JSON.stringify({
          ok: true,
          jobId,
          title: plan.title,
          outputPath: finalPath,
          planPath: path.join(jobRoot, "ranking-plan.json").split(String.fromCharCode(92)).join("/"),
          durationSeconds: actualDuration,
          clipCount: plan.segments.length,
          narration: false,
          soundCues: "original synthesized tones rendered; no narration",
          soundCueCount: expectedSoundCueCount,
          validated: true,
        });
      } catch (error) {
        return {
          toolCallId: "",
          content: JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
          isError: true,
        };
      }
    },
  };
}
