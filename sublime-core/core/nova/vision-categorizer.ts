import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../reasoning/types.js";
import { discoverMediaCapabilities } from "../ai/tools/media-environment.js";
import { resolveWorkspacePath } from "../ai/tools/workspace-path.js";

const execFileAsync = promisify(execFile);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v"]);
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const CONFIDENCE_THRESHOLD = 0.65;
const MAX_SCAN_FILES = 100;

type Animal = "cat" | "dog" | "pet";
type CategoryKey = "angry" | "bath" | "vet" | "fighting" | "funny" | "uncertain";

interface VisionClassification {
  category: CategoryKey;
  confidence: number;
  reason: string;
}

function cleanJobId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64)
    || "categorize-" + Date.now().toString(36);
}

function validateAssetFolder(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("source_folder is required, for example assets/INBOX.");
  }
  const normalized = value.trim().replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (!normalized.startsWith("assets/") || normalized.startsWith("/") ||
      /^[a-z]:/i.test(normalized) || segments.some((part) => !part || part === "." || part === "..")) {
    throw new Error("source_folder must be a folder inside workspace/assets, such as assets/INBOX.");
  }
  return normalized;
}

function categoryNames(animal: Animal): Record<CategoryKey, string> {
  const prefix = animal === "pet" ? "PET" : animal.toUpperCase();
  return {
    angry: prefix + " ANGRY",
    bath: prefix + " DURING BATH",
    vet: prefix + " AT VET",
    fighting: prefix + " FIGHTING",
    funny: prefix + " FUNNY",
    uncertain: prefix + " UNCERTAIN",
  };
}

async function listVideos(source: string, maxVideos: number): Promise<string[]> {
  const absoluteSource = await resolveWorkspacePath(source);
  const sourceStat = await fs.stat(absoluteSource);
  if (!sourceStat.isDirectory()) throw new Error("source_folder must point to a directory.");
  const found: string[] = [];
  let entriesVisited = 0;

  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      entriesVisited += 1;
      if (entriesVisited > 3000) throw new Error("Source folder has too many entries; split it into smaller batches.");
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        found.push(fullPath);
        if (found.length > maxVideos || found.length > MAX_SCAN_FILES) {
          throw new Error("This run supports up to " + Math.min(maxVideos, MAX_SCAN_FILES) + " videos. Split the inbox into smaller batches.");
        }
      }
    }
  }

  await walk(absoluteSource);
  return found.sort((a, b) => a.localeCompare(b));
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Vision model did not return a JSON classification.");
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

async function getDuration(videoPath: string, ffprobePath: string): Promise<number> {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath,
  ], { timeout: 30000, windowsHide: true });
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not read a valid duration.");
  return duration;
}

async function extractFrame(videoPath: string, timestamp: number, outputPath: string, ffmpegPath: string): Promise<boolean> {
  try {
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y", "-ss", String(Math.max(0, timestamp)),
      "-i", videoPath, "-frames:v", "1", "-vf", "scale=512:512:force_original_aspect_ratio=decrease",
      "-q:v", "5", outputPath,
    ], { timeout: 30000, windowsHide: true });
    const stat = await fs.stat(outputPath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function ensureVisionModel(baseUrl: string, model: string): Promise<void> {
  const response = await fetch(baseUrl + "/api/tags", { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Local Ollama returned HTTP " + response.status + " while checking installed models.");
  const payload = await response.json() as { models?: Array<{ name?: string; model?: string }> };
  const names = (payload.models ?? []).flatMap((entry) => [entry.name, entry.model].filter((name): name is string => Boolean(name)));
  if (!names.some((name) => name === model || name.startsWith(model + ":"))) {
    throw new Error("Vision model '" + model + "' is not installed in Ollama. Install a vision-capable model (for example llava), then set NOVA_VISION_MODEL to its exact installed name. No model was downloaded automatically.");
  }
}

async function classifyFrames(
  baseUrl: string,
  model: string,
  animal: Animal,
  imagePaths: string[],
): Promise<VisionClassification> {
  const images = await Promise.all(imagePaths.map((imagePath) => fs.readFile(imagePath, "base64")));
  const names = categoryNames(animal);
  const prompt = [
    "Classify this video using the provided frames in chronological order. The frames come from one video.",
    "Choose exactly one category key from: angry, bath, vet, fighting, funny, uncertain.",
    "Categories: angry = clear signs of an angry/agitated animal such as hissing, growling, defensive posture; bath = animal being bathed/washed; vet = at a veterinary clinic or receiving veterinary care; fighting = animals physically fighting or attempting to fight; funny = a clearly humorous/silly/odd moment not better matched above; uncertain = evidence is insufficient or none of these categories fits.",
    "Do not infer events that are not visible. If the frames are ambiguous, choose uncertain. Confidence must be a number from 0 to 1. Keep reason under 20 words.",
    "Return only JSON: {\"category\":\"angry|bath|vet|fighting|funny|uncertain\",\"confidence\":0.0,\"reason\":\"brief visible evidence\"}.",
    "Animal context: " + animal + ". Destination folder names: " + JSON.stringify(names) + ".",
  ].join("\n");
  const response = await fetch(baseUrl + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: "json",
      messages: [{ role: "user", content: prompt, images }],
      options: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(120000),
  });
  const payload = await response.json() as { message?: { content?: string }; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Vision model request failed with HTTP " + response.status + ".");
  const parsed = parseJsonObject(payload.message?.content ?? "");
  const allowed = new Set<CategoryKey>(["angry", "bath", "vet", "fighting", "funny", "uncertain"]);
  const category = parsed.category;
  const confidence = Number(parsed.confidence);
  const reason = typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 240) : "";
  if (typeof category !== "string" || !allowed.has(category as CategoryKey) ||
      !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("Vision model returned an invalid category or confidence score.");
  }
  return { category: category as CategoryKey, confidence, reason };
}

async function uniqueDestination(directory: string, originalName: string): Promise<string> {
  const parsed = path.parse(originalName);
  let candidate = path.join(directory, originalName);
  let index = 2;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(directory, parsed.name + "-" + index + parsed.ext);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

export function createVisionCategorizerTool(): Tool {
  return {
    name: "categorize_videos",
    description: "Use an installed local Ollama vision model to inspect sampled frames from user-provided videos, classify each clip, and COPY originals into category folders under workspace/assets. Uncertain or low-confidence results go to an UNCERTAIN folder. Requires FFmpeg, ffprobe, and an installed vision model (NOVA_VISION_MODEL defaults to llava); does not download, delete, or move source videos.",
    parameters: {
      type: "object",
      properties: {
        source_folder: { type: "string", minLength: 1, maxLength: 500 },
        animal: { type: "string", enum: ["cat", "dog", "pet"] },
        job_id: { type: "string", maxLength: 64 },
        max_videos: { type: "integer", minimum: 1, maximum: 100 },
        confidence_threshold: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["source_folder"],
      additionalProperties: false,
    },
    async handler(args) {
      try {
        const source = validateAssetFolder(args.source_folder);
        const animal = (args.animal === undefined ? "cat" : String(args.animal)) as Animal;
        if (!["cat", "dog", "pet"].includes(animal)) throw new Error("animal must be cat, dog, or pet.");
        const maxVideos = args.max_videos === undefined ? 30 : Number(args.max_videos);
        if (!Number.isInteger(maxVideos) || maxVideos < 1 || maxVideos > MAX_SCAN_FILES) {
          throw new Error("max_videos must be an integer from 1 to " + MAX_SCAN_FILES + ".");
        }
        const threshold = args.confidence_threshold === undefined ? CONFIDENCE_THRESHOLD : Number(args.confidence_threshold);
        if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
          throw new Error("confidence_threshold must be between 0 and 1.");
        }
        const model = (process.env.NOVA_VISION_MODEL ?? "llava").trim();
        const baseUrl = (process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_URL).replace(/\/$/, "");
        if (!model) throw new Error("NOVA_VISION_MODEL must name an installed vision model.");
        await ensureVisionModel(baseUrl, model);
        const capabilities = await discoverMediaCapabilities();
        if (!capabilities.ffmpegPath || !capabilities.ffprobePath) {
          throw new Error("Video categorization requires both FFmpeg and ffprobe on PATH (or configured FFMPEG_PATH / FFPROBE_PATH).");
        }
        const videos = await listVideos(source, maxVideos);
        if (videos.length === 0) throw new Error("No supported video files were found in " + source + ".");
        const jobId = cleanJobId(typeof args.job_id === "string" ? args.job_id : "categorize-" + Date.now().toString(36));
        const jobRoot = await resolveWorkspacePath("nova/jobs/" + jobId);
        const reportPath = path.join(jobRoot, "classification-report.json");
        await fs.mkdir(path.dirname(jobRoot), { recursive: true });
        await fs.mkdir(jobRoot, { recursive: false });
        const tempDirectory = path.join(jobRoot, "frames");
        await fs.mkdir(tempDirectory, { recursive: false });
        const names = categoryNames(animal);
        const results: Array<Record<string, unknown>> = [];

        try {
          for (let index = 0; index < videos.length; index += 1) {
            const videoPath = videos[index];
            const relativeSource = path.relative(await resolveWorkspacePath("assets"), videoPath).replaceAll("\\", "/");
            const duration = await getDuration(videoPath, capabilities.ffprobePath);
            const framePaths: string[] = [];
            for (const [frameIndex, fraction] of [0.15, 0.5, 0.85].entries()) {
              const framePath = path.join(tempDirectory, "clip-" + index + "-" + frameIndex + ".jpg");
              if (await extractFrame(videoPath, Math.min(duration * fraction, Math.max(0, duration - 0.05)), framePath, capabilities.ffmpegPath)) {
                framePaths.push(framePath);
              }
            }
            let classification: VisionClassification;
            if (framePaths.length === 0) {
              classification = { category: "uncertain", confidence: 0, reason: "Could not extract readable frames." };
            } else {
              try {
                classification = await classifyFrames(baseUrl, model, animal, framePaths);
              } catch (error) {
                classification = {
                  category: "uncertain",
                  confidence: 0,
                  reason: ("Vision analysis failed: " + (error instanceof Error ? error.message : String(error))).slice(0, 180),
                };
              }
            }
            const category: CategoryKey = classification.confidence < threshold ? "uncertain" : classification.category;
            const destinationName = names[category];
            const destinationDirectory = await resolveWorkspacePath("assets/" + destinationName);
            await fs.mkdir(destinationDirectory, { recursive: true });
            const destinationPath = await uniqueDestination(destinationDirectory, path.basename(videoPath));
            await fs.copyFile(videoPath, destinationPath, fsConstants.COPYFILE_EXCL);
            results.push({
              source: relativeSource,
              category: destinationName,
              modelCategory: names[classification.category],
              confidence: classification.confidence,
              reason: classification.reason,
              copiedTo: path.relative(await resolveWorkspacePath("assets"), destinationPath).replaceAll("\\", "/"),
            });
          }
        } finally {
          await fs.rm(tempDirectory, { recursive: true, force: true });
        }

        const report = {
          ok: true,
          animal,
          model,
          sourceFolder: source,
          videosSeen: videos.length,
          categorized: results.filter((item) => item.copiedTo !== null).length,
          needsReview: results.filter((item) => item.category === names.uncertain || item.copiedTo === null).length,
          originalFilesPreserved: true,
          results,
        };
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
        return JSON.stringify({ ...report, reportPath: path.relative(await resolveWorkspacePath("."), reportPath).replaceAll("\\", "/") });
      } catch (error) {
        return {
          toolCallId: "",
          content: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
          isError: true,
        };
      }
    },
  };
}
