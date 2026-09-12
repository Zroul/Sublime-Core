import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { MediaAbilities, MediaAsset, VideoTimeline } from "./media-types.js";

export interface LocalMediaOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  ttsCommand?: string;
  ttsArgs?: (textFile: string, outputPath: string) => string[];
  commandTimeoutMs?: number;
}

/** Local-only media adapters. No cloud API is used. */
export function createLocalMediaAbilities(options: LocalMediaOptions = {}): MediaAbilities {
  const ffmpeg = options.ffmpegPath ?? "ffmpeg";
  const ffprobe = options.ffprobePath ?? "ffprobe";
  const timeoutMs = options.commandTimeoutMs ?? 120_000;

  return {
    textToSpeech: options.ttsCommand
      ? async (text, outputPath) => {
          const textFile = `${outputPath}.txt`;
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(textFile, text, "utf8");
          try {
            await run(options.ttsCommand!, options.ttsArgs?.(textFile, outputPath) ?? [textFile, outputPath], timeoutMs);
            return asset("audio", outputPath, guessMime(outputPath), "local-tts");
          } finally {
            await fs.rm(textFile, { force: true });
          }
        }
      : undefined,

    probe: async (filePath) => {
      await run(
        ffprobe,
        ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
        timeoutMs,
      );
      return asset("video", filePath, guessMime(filePath), "local-ffprobe");
    },

    render: async (timeline, outputPath) => {
      await renderTimeline(ffmpeg, timeline, outputPath, timeoutMs);
      return asset("video", outputPath, guessMime(outputPath), "local-ffmpeg");
    },

    generateCaptions: async (audioPath, outputPath) => {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(
        outputPath,
        `1\n00:00:00,000 --> 00:00:01,000\n[LOCAL CAPTION ALIGNMENT REQUIRED]\n`,
        "utf8",
      );
      return asset("caption", outputPath, "application/x-subrip", audioPath);
    },
  };
}

async function renderTimeline(
  ffmpeg: string,
  timeline: VideoTimeline,
  outputPath: string,
  timeoutMs: number,
): Promise<void> {
  if (!Number.isFinite(timeline.width) || timeline.width <= 0) throw new Error("Invalid video width.");
  if (!Number.isFinite(timeline.height) || timeline.height <= 0) throw new Error("Invalid video height.");
  if (!Number.isFinite(timeline.fps) || timeline.fps <= 0) throw new Error("Invalid video FPS.");
  if (!Number.isFinite(timeline.durationMs) || timeline.durationMs <= 0) throw new Error("Invalid video duration.");

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const duration = timeline.durationMs / 1000;
  const filters: string[] = [];

  for (const clip of timeline.clips) {
    if (typeof clip.text !== "string" || !clip.text.trim()) continue;
    const start = Math.max(0, clip.startMs / 1000);
    const end = Math.min(duration, clip.endMs / 1000);
    if (end <= start) continue;

    const escaped = escapeDrawtext(clip.text);
    const fontSize = Math.max(24, Math.round(timeline.width / 24));
    filters.push(
      `drawtext=text='${escaped}':fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`,
    );
  }

  const videoFilter = filters.join(",");
  const args = [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=black:s=${Math.round(timeline.width)}x${Math.round(timeline.height)}:r=${Math.round(timeline.fps)}`,
    "-t", duration.toFixed(3),
    ...(videoFilter ? ["-vf", videoFilter] : []),
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ];

  await run(ffmpeg, args, timeoutMs);
}

function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%");
}

function run(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`${command} could not start: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`${command} failed with exit code ${code ?? "unknown"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

function asset(kind: MediaAsset["kind"], filePath: string, mimeType?: string, source?: string): MediaAsset {
  return { id: `local-${kind}-${path.basename(filePath)}`, kind, path: filePath, mimeType, source };
}

function guessMime(filePath: string): string | undefined {
  const map: Record<string, string> = {
    ".mp4": "video/mp4",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".srt": "application/x-subrip",
    ".vtt": "text/vtt",
  };
  return map[path.extname(filePath).toLowerCase()];
}
