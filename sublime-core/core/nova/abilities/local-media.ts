import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { MediaAbilities, MediaAsset, VideoTimeline } from "./media-types.js";

export interface LocalMediaOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  ttsCommand?: string;
  ttsArgs?: (textFile: string, outputPath: string) => string[];
}

/**
 * Local-only media adapters. Nothing here calls a cloud API.
 * Missing executables are reported clearly so NOVA can stop/recover instead
 * of pretending media was created.
 */
export function createLocalMediaAbilities(options: LocalMediaOptions = {}): MediaAbilities {
  const ffmpeg = options.ffmpegPath ?? "ffmpeg";
  const ffprobe = options.ffprobePath ?? "ffprobe";

  return {
    textToSpeech: options.ttsCommand
      ? async (text, outputPath) => {
          const textFile = `${outputPath}.txt`;
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(textFile, text, "utf8");
          try {
            await run(options.ttsCommand!, options.ttsArgs?.(textFile, outputPath) ?? [textFile, outputPath]);
            return asset("audio", outputPath, guessMime(outputPath), "local-tts");
          } finally {
            await fs.rm(textFile, { force: true });
          }
        }
      : undefined,
    probe: async (filePath) => {
      await run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath]);
      return asset("video", filePath, guessMime(filePath), "local-ffprobe");
    },
    render: async (timeline, outputPath) => {
      await renderPlaceholderTimeline(ffmpeg, timeline, outputPath);
      return asset("video", outputPath, guessMime(outputPath), "local-ffmpeg");
    },
  };
}

async function renderPlaceholderTimeline(
  ffmpeg: string,
  timeline: VideoTimeline,
  outputPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const duration = Math.max(0.1, timeline.durationMs / 1000);
  await run(ffmpeg, [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=black:s=${timeline.width}x${timeline.height}:r=${timeline.fps}`,
    "-t", duration.toFixed(3),
    "-pix_fmt", "yuv420p",
    outputPath,
  ]);
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });
    child.on("error", (error) => reject(new Error(`${command} could not start: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${command} failed with exit code ${code ?? "unknown"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

function asset(kind: MediaAsset["kind"], filePath: string, mimeType?: string, source?: string): MediaAsset {
  return { id: `local-${kind}-${path.basename(filePath)}`, kind, path: filePath, mimeType, source };
}

function guessMime(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".mp4": "video/mp4",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".srt": "application/x-subrip",
    ".vtt": "text/vtt",
  };
  return map[ext];
}
