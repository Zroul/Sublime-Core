import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../reasoning/types.js";
import type {
  VideoProbeResult,
  VideoRenderResult,
  VideoSpecification,
} from "../../nova/video-contracts.js";
import { resolveWorkspacePath } from "./workspace-path.js";

const execFileAsync = promisify(execFile);
const WORKSPACE = path.resolve("workspace");

interface Scene {
  index?: number;
  duration: number;
  text?: string;
  background?: string;
  text_size?: number;
  text_position?: "top" | "center" | "bottom";
  text_max_width?: number;
}

type VideoCommandRunner = (
  command: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

function safeId(value: string): string {
  const id = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return id.slice(0, 80) || "video";
}

async function run(command: string, args: string[]) {
  return execFileAsync(command, args, {
    cwd: WORKSPACE, timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
  });
}

function relativeWorkspacePath(fullPath: string): string {
  return path.relative(WORKSPACE, fullPath).replaceAll("\\", "/");
}

function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\:")
    .replace(/\x27/g, "\\x27")
    .replace(/\n/g, "\\n");
}

function color(value: string | undefined): string {
  const raw = String(value ?? "202020").trim().toLowerCase();
  const named: Record<string, string> = {
    black: "000000", white: "ffffff", red: "ff0000", green: "00ff00",
    blue: "0000ff", yellow: "ffff00", cyan: "00ffff", magenta: "ff00ff",
    gray: "808080", grey: "808080",
  };
  const candidate = named[raw] ?? raw.replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(candidate) ? candidate : "202020";
}

function wrapText(text: string, maxChars: number): string {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (line && candidate.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function safeTextLayout(scene: Scene) {
  const raw = String(scene.text ?? "").trim().slice(0, 500);
  if (!raw) return null;

  const requestedSize = Number(scene.text_size ?? 54);
  const maxWidth = Math.max(300, Math.min(1200, Number(scene.text_max_width ?? 1050)));
  const size = Math.max(24, Math.min(72, Number.isFinite(requestedSize) ? requestedSize : 54));

  // Approximate character capacity from font size so long captions wrap before they leave the frame.
  const charsPerLine = Math.max(18, Math.floor(maxWidth / Math.max(12, size * 0.55)));
  const wrapped = wrapText(raw, charsPerLine);
  const position = scene.text_position ?? "center";
  const y =
    position === "top"
      ? "120"
      : position === "bottom"
        ? "(h-text_h-100)"
        : "(h-text_h)/2";

  return { text: wrapped, size, maxWidth, y };
}

export function createVideoEngineTool(
  runCommand: VideoCommandRunner = run,
): Tool {
  return {
  name: "video_engine",
  description:
    "Local video production engine using installed FFmpeg/ffprobe. Renders the normalized editing timeline from editing_module. Supports safe wrapped text, text sizing, and top/center/bottom caption positioning. Use render for real scene timelines and create_test only for generic tests.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create_test", "render", "probe"] },
      id: { type: "string" },
      output: { type: "string" },
      duration: { type: "number" },
      scenes: {
        type: "array",
        description: "Ordered render-ready timeline scenes. Preserve editing_module decisions.",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            index: { type: "integer", minimum: 1 },
            duration: { type: "number" },
            text: { type: "string" },
            background: { type: "string" },
            text_size: { type: "number" },
            text_position: { type: "string", enum: ["top", "center", "bottom"] },
            text_max_width: { type: "number" },
          },
          required: ["duration"],
        },
      },
      path: { type: "string" },
    },
    required: ["action"],
    additionalProperties: false,
  },

  async handler(input) {
    const action = String(input.action ?? "");
    try {
      if (action === "create_test") {
        const id = safeId(String(input.id ?? "test"));
        const duration = Math.max(1, Math.min(30, Number(input.duration ?? 5)));
        const output = await resolveWorkspacePath(String(input.output ?? ("nova/videos/" + id + ".mp4")));
        await fs.mkdir(path.dirname(output), { recursive: true });
        await runCommand("ffmpeg", [
          "-y", "-f", "lavfi", "-i", "color=c=202020:s=1280x720:r=30",
          "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
          "-t", String(duration), "-c:v", "libx264", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-shortest", output,
        ]);
        const result: VideoRenderResult = {
          ok: true,
          outputPath: relativeWorkspacePath(output),
          sceneCount: 1,
          specification: {
            width: 1280,
            height: 720,
            frameRate: 30,
            durationSeconds: duration,
            outputPath: relativeWorkspacePath(output),
          },
        };
        return JSON.stringify({ ...result, action });
      }

      if (action === "probe") {
        const relative = String(input.path ?? "");
        if (!relative) return { toolCallId: "", content: "video_engine probe requires path.", isError: true };
        const target = await resolveWorkspacePath(relative);
        const result = await runCommand("ffprobe", [
          "-v", "error",
          "-show_entries", "format=duration,size,format_name",
          "-show_entries", "stream=index,codec_type,codec_name,width,height,r_frame_rate",
          "-of", "json", target,
        ]);
        const parsed = JSON.parse(result.stdout) as {
          format?: { format_name?: unknown; duration?: unknown; size?: unknown };
          streams?: Array<{
            codec_type?: unknown;
            codec_name?: unknown;
            width?: unknown;
            height?: unknown;
            r_frame_rate?: unknown;
          }>;
        };
        const formatName = typeof parsed.format?.format_name === "string"
          ? parsed.format.format_name
          : "";
        const durationSeconds = Number(parsed.format?.duration);
        const hasVideoStream = (parsed.streams ?? []).some(
          (stream) => stream.codec_type === "video",
        );
        if (
          !formatName ||
          !Number.isFinite(durationSeconds) ||
          durationSeconds <= 0 ||
          !hasVideoStream
        ) {
          const result: VideoProbeResult = {
            ok: false,
            valid: false,
            outputPath: relativeWorkspacePath(target),
            error: "ffprobe metadata must include a format name, positive duration, and video stream.",
          };
          return { toolCallId: "", content: JSON.stringify(result), isError: true };
        }

        const sizeBytes = Number(parsed.format?.size);
        const probe: VideoProbeResult = {
          ok: true,
          valid: true,
          outputPath: relativeWorkspacePath(target),
          metadata: {
            formatName,
            durationSeconds,
            ...(Number.isFinite(sizeBytes) && sizeBytes >= 0 ? { sizeBytes } : {}),
            streams: (parsed.streams ?? []).map((stream) => ({
              ...(typeof stream.codec_type === "string" ? { type: stream.codec_type } : {}),
              ...(typeof stream.codec_name === "string" ? { codec: stream.codec_name } : {}),
              ...(typeof stream.width === "number" ? { width: stream.width } : {}),
              ...(typeof stream.height === "number" ? { height: stream.height } : {}),
              ...(typeof stream.r_frame_rate === "string" ? { frameRate: stream.r_frame_rate } : {}),
            })),
          },
        };
        return JSON.stringify(probe);
      }

      if (action === "render") {
        const scenes = Array.isArray(input.scenes) ? (input.scenes as Scene[]) : [];
        if (scenes.length === 0 || scenes.length > 30) return { toolCallId: "", content: "render requires 1-30 scenes.", isError: true };

        const validScenes = scenes.map((scene, index) => {
          const duration = Number(scene.duration);
          if (!Number.isFinite(duration) || duration <= 0 || duration > 120) throw new Error("Scene " + (index + 1) + " has an invalid duration.");
          return {
            index: scene.index ?? index + 1,
            duration,
            text: String(scene.text ?? "").slice(0, 500),
            background: color(scene.background),
            text_size: Number(scene.text_size ?? 54),
            text_position: scene.text_position ?? "center",
            text_max_width: Number(scene.text_max_width ?? 1050),
          };
        });

        const id = safeId(String(input.id ?? "render"));
        const output = await resolveWorkspacePath(String(input.output ?? ("nova/videos/" + id + ".mp4")));
        await fs.mkdir(path.dirname(output), { recursive: true });

        const inputs: string[] = [];
        const filters: string[] = [];

        validScenes.forEach((scene, index) => {
          inputs.push("-f", "lavfi", "-t", String(scene.duration), "-i", "color=c=0x" + scene.background + ":s=1280x720:r=30");
          let filter = "[" + index + ":v]format=yuv420p";

          const layout = safeTextLayout(scene);
          if (layout) {
            filter += ",drawtext=text='" + escapeDrawtext(layout.text) +
              "':fontcolor=white:fontsize=" + layout.size +
              ":x=(w-text_w)/2:y=" + layout.y +
              ":box=1:boxcolor=black@0.45:boxborderw=24";
          }

          filter += "[v" + index + "]";
          filters.push(filter);
        });

        const concatInputs = validScenes.map((_, index) => "[v" + index + "]").join("");
        const filterComplex = filters.join(";") + ";" + concatInputs + "concat=n=" + validScenes.length + ":v=1:a=0[v]";

        await runCommand("ffmpeg", [
          "-y", ...inputs, "-filter_complex", filterComplex, "-map", "[v]",
          "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output,
        ]);

        const durationSeconds = validScenes.reduce((sum, scene) => sum + scene.duration, 0);
        const outputPath = relativeWorkspacePath(output);
        const specification: VideoSpecification = {
          width: 1280,
          height: 720,
          frameRate: 30,
          durationSeconds,
          outputPath,
        };
        const result: VideoRenderResult = {
          ok: true,
          outputPath,
          sceneCount: validScenes.length,
          specification,
        };
        return JSON.stringify({ ...result, action });
      }

      return { toolCallId: "", content: "video_engine action must be create_test, render, or probe.", isError: true };
    } catch (error) {
      return { toolCallId: "", content: "video_engine failed: " + (error instanceof Error ? error.message : String(error)), isError: true };
    }
  },
  };
}

export const videoEngineTool = createVideoEngineTool();
