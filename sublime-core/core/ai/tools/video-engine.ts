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
import { discoverMediaCapabilities } from "./media-environment.js";
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
  visual?: string;
  visual_type?: "card" | "flow" | "network" | "diagram";
  accent_color?: string;
  asset_path?: string;
  asset_media_type?: "image" | "video";
  asset_fit?: "cover" | "contain";
  procedural_kind?: "generic" | "ai_video" | "sky_scattering" | "cpu_architecture";
  caption_segments?: Array<{ text: string; start: number; end: number }>;
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
  const capabilities = await discoverMediaCapabilities();
  const executable = command === "ffmpeg"
    ? capabilities.ffmpegPath
    : command === "ffprobe"
      ? capabilities.ffprobePath
      : undefined;
  if (!executable) {
    throw new Error(`Dependency unavailable: ${command} was not found on PATH. NOVA will not suggest an installation command for another operating system.`);
  }
  return execFileAsync(executable, args, {
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

function safeTextLayout(scene: Scene, width = 1280, height = 720) {
  const raw = String(scene.text ?? "").trim().slice(0, 500);
  if (!raw) return null;

  const requestedSize = Number(scene.text_size ?? 54);
  const maxWidth = Math.max(180, Math.min(width - 48, Number(scene.text_max_width ?? Math.min(1050, width - 96))));
  const size = Math.max(24, Math.min(72, Number.isFinite(requestedSize) ? requestedSize : 54));

  // Approximate character capacity from font size so long captions wrap before they leave the frame.
  const charsPerLine = Math.max(18, Math.floor(maxWidth / Math.max(12, size * 0.55)));
  const wrapped = wrapText(raw, charsPerLine);
  const position = scene.text_position ?? "center";
  const y =
    position === "top"
      ? String(Math.round(height * 0.12))
      : position === "bottom"
        ? `(h-text_h-${Math.round(height * 0.1)})`
        : "(h-text_h)/2";

  return { text: wrapped, size, maxWidth, y };
}

function topicalOverlay(kind: Scene["procedural_kind"], accent: string): string {
  if (kind === "ai_video") {
    return `,drawbox=x=iw*0.12:y=ih*0.25:w=iw*0.2:h=ih*0.32:color=${accent}:t=3` +
      `,drawbox=x=iw*0.4:y=ih*0.2:w=iw*0.2:h=ih*0.42:color=${accent}:t=3` +
      `,drawbox=x=iw*0.7:y=ih*0.18:w=iw*0.16:h=ih*0.14:color=${accent}:t=3` +
      `,drawbox=x=iw*0.7:y=ih*0.43:w=iw*0.16:h=ih*0.14:color=${accent}:t=3` +
      `,drawbox=x=iw*0.7:y=ih*0.68:w=iw*0.16:h=ih*0.14:color=${accent}:t=3` +
      `,drawbox=x=iw*0.32:y=ih*0.41:w=iw*0.08:h=3:color=${accent}:t=fill` +
      `,drawbox=x=iw*0.6:y=ih*0.41:w=iw*0.1:h=3:color=${accent}:t=fill` +
      `,drawbox=x=iw*(0.42+0.12*sin(t*2)):y=ih*0.35:w=iw*0.04:h=ih*0.04:color=${accent}:t=fill`;
  }
  if (kind === "sky_scattering") {
    return `,drawbox=x=iw*0.08:y=ih*0.18:w=iw*0.1:h=ih*0.1:color=0xffd166:t=fill` +
      `,drawbox=x=iw*0.18:y=ih*0.23:w=iw*0.44:h=3:color=0xffd166:t=fill` +
      `,drawbox=x=iw*0.28:y=ih*0.35:w=iw*0.5:h=3:color=0x38c7ff:t=fill` +
      `,drawbox=x=iw*0.35:y=ih*0.48:w=iw*0.46:h=3:color=0x38c7ff:t=fill` +
      `,drawbox=x=iw*0.18:y=ih*0.62:w=iw*0.7:h=ih*0.15:color=0x1f6f9e@0.55:t=fill` +
      `,drawbox=x=iw*(0.34+0.08*sin(t*2)):y=ih*0.31:w=iw*0.025:h=ih*0.025:color=0x38c7ff:t=fill` +
      `,drawbox=x=iw*0.77:y=ih*0.58:w=iw*0.035:h=ih*0.11:color=${accent}:t=fill`;
  }
  if (kind === "cpu_architecture") {
    return `,drawbox=x=iw*0.38:y=ih*0.24:w=iw*0.24:h=ih*0.38:color=${accent}:t=4` +
      `,drawbox=x=iw*0.43:y=ih*0.31:w=iw*0.14:h=ih*0.12:color=${accent}:t=2` +
      `,drawbox=x=iw*0.43:y=ih*0.47:w=iw*0.14:h=ih*0.08:color=${accent}:t=2` +
      `,drawbox=x=iw*0.22:y=ih*0.4:w=iw*0.16:h=3:color=${accent}:t=fill` +
      `,drawbox=x=iw*0.62:y=ih*0.4:w=iw*0.16:h=3:color=${accent}:t=fill` +
      `,drawbox=x=iw*(0.24+0.1*sin(t*2)):y=ih*0.37:w=iw*0.03:h=ih*0.05:color=${accent}:t=fill`;
  }
  return "";
}

async function resolveSceneAsset(scene: Scene): Promise<{ path: string; mediaType: "image" | "video"; fit: "cover" | "contain" } | undefined> {
  if (!scene.asset_path) return undefined;
  const normalized = scene.asset_path.replace(/\\/g, "/");
  if (!normalized.startsWith("assets/") || normalized.includes("../") || normalized.startsWith("/") || /^[a-z]:/i.test(normalized)) {
    throw new Error("Scene asset_path must remain inside workspace/assets.");
  }
  if (scene.asset_media_type !== "image" && scene.asset_media_type !== "video") {
    throw new Error("Scene asset_path requires asset_media_type image or video.");
  }
  const assetPath = await resolveWorkspacePath(normalized);
  const stat = await fs.stat(assetPath);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`Scene asset is missing or empty: ${normalized}`);
  return { path: assetPath, mediaType: scene.asset_media_type, fit: scene.asset_fit === "contain" ? "contain" : "cover" };
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
      aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"] },
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
            visual: { type: "string", maxLength: 500 },
            visual_type: { type: "string", enum: ["card", "flow", "network", "diagram"] },
            accent_color: { type: "string" },
            asset_path: { type: "string", maxLength: 500 },
            asset_media_type: { type: "string", enum: ["image", "video"] },
            asset_fit: { type: "string", enum: ["cover", "contain"] },
            procedural_kind: { type: "string", enum: ["generic", "ai_video", "sky_scattering", "cpu_architecture"] },
            caption_segments: {
              type: "array",
              maxItems: 12,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  text: { type: "string", minLength: 1, maxLength: 180 },
                  start: { type: "number", minimum: 0 },
                  end: { type: "number", minimum: 0 },
                },
                required: ["text", "start", "end"],
              },
            },
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
        const stat = await fs.stat(output);
        if (!stat.isFile() || stat.size <= 0) throw new Error("FFmpeg exited without producing a non-empty output file.");
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
        const stat = await fs.stat(target);
        if (!stat.isFile() || stat.size <= 0) {
          const invalid: VideoProbeResult = {
            ok: false,
            valid: false,
            outputPath: relativeWorkspacePath(target),
            error: "The output file is missing, is not a regular file, or is empty.",
          };
          return { toolCallId: "", content: JSON.stringify(invalid), isError: true };
        }
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
          (stream) => stream.codec_type === "video" &&
            Number(stream.width) > 0 && Number(stream.height) > 0,
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

        const aspectRatio = String(input.aspect_ratio ?? "16:9");
        const dimensions = aspectRatio === "9:16"
          ? { width: 720, height: 1280 }
          : aspectRatio === "1:1"
            ? { width: 1080, height: 1080 }
            : aspectRatio === "16:9"
              ? { width: 1280, height: 720 }
              : undefined;
        if (!dimensions) throw new Error("aspect_ratio must be 16:9, 9:16, or 1:1.");

        const validScenes = await Promise.all(scenes.map(async (scene, index) => {
          const duration = Number(scene.duration);
          if (!Number.isFinite(duration) || duration <= 0 || duration > 120) throw new Error("Scene " + (index + 1) + " has an invalid duration.");
          const captionSegments = (scene.caption_segments ?? []).map((caption, captionIndex) => {
            const start = Number(caption.start);
            const end = Number(caption.end);
            const text = String(caption.text ?? "").trim().slice(0, 180);
            if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration) {
              throw new Error(`Scene ${index + 1} caption ${captionIndex + 1} has invalid timing or text.`);
            }
            return { text, start, end };
          });
          const asset = await resolveSceneAsset(scene);
          const proceduralKind = scene.procedural_kind;
          if (proceduralKind !== undefined && !["generic", "ai_video", "sky_scattering", "cpu_architecture"].includes(proceduralKind)) {
            throw new Error(`Scene ${index + 1} has an unsupported procedural_kind.`);
          }
          return {
            index: scene.index ?? index + 1,
            duration,
            text: String(scene.text ?? "").slice(0, 500),
            background: color(scene.background),
            text_size: Number(scene.text_size ?? 54),
            text_position: scene.text_position ?? "center",
            text_max_width: Number(scene.text_max_width ?? 1050),
            visual: String(scene.visual ?? "").slice(0, 500),
            visual_type: scene.visual_type ?? "card",
            accent_color: color(scene.accent_color ?? "26d9c8"),
            caption_segments: captionSegments,
            ...(asset ? { asset } : {}),
            procedural_kind: proceduralKind ?? "generic",
          };
        }));

        const id = safeId(String(input.id ?? "render"));
        const output = await resolveWorkspacePath(String(input.output ?? ("nova/videos/" + id + ".mp4")));
        await fs.mkdir(path.dirname(output), { recursive: true });

        const inputs: string[] = [];
        const filters: string[] = [];

        validScenes.forEach((scene, index) => {
          if (scene.asset) {
            if (scene.asset.mediaType === "image") {
              inputs.push("-loop", "1", "-framerate", "30", "-t", String(scene.duration), "-i", scene.asset.path);
            } else {
              inputs.push("-stream_loop", "-1", "-t", String(scene.duration), "-i", scene.asset.path);
            }
          } else {
            inputs.push("-f", "lavfi", "-t", String(scene.duration), "-i", "color=c=0x" + scene.background + `:s=${dimensions.width}x${dimensions.height}:r=30`);
          }
          let filter = "[" + index + ":v]";
          if (scene.asset) {
            if (scene.asset.fit === "contain") {
              filter += `scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=decrease,pad=${dimensions.width}:${dimensions.height}:(ow-iw)/2:(oh-ih)/2:color=0x${scene.background},setsar=1`;
            } else {
              filter += `scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=increase,crop=${dimensions.width}:${dimensions.height},setsar=1`;
            }
            const fadeDuration = Math.min(0.25, Math.max(0.1, scene.duration / 5));
            const fadeOutStart = Math.max(0, scene.duration - fadeDuration).toFixed(3);
            filter += `,trim=duration=${scene.duration},setpts=PTS-STARTPTS,fade=t=in:st=0:d=${fadeDuration.toFixed(3)},fade=t=out:st=${fadeOutStart}:d=${fadeDuration.toFixed(3)},format=yuv420p`;
          } else {
            filter += "format=yuv420p";
          }

          const accent = "0x" + scene.accent_color + "@0.85";
          if (!scene.asset && scene.procedural_kind !== "generic") {
            filter += topicalOverlay(scene.procedural_kind, accent);
          } else if (scene.visual_type === "network") {
            filter += `,drawbox=x=iw*0.12:y=ih*0.2:w=iw*0.76:h=ih*0.58:color=${accent}:t=3`;
            filter += `,drawbox=x=iw*0.2:y=ih*0.36:w=iw*0.6:h=3:color=${accent}:t=fill`;
            filter += `,drawbox=x=iw*0.34:y=ih*0.24:w=3:h=ih*0.4:color=${accent}:t=fill`;
          } else if (scene.visual_type === "flow") {
            filter += `,drawbox=x=iw*0.08:y=ih*0.25:w=iw*0.84:h=ih*0.5:color=${accent}:t=3`;
            filter += `,drawbox=x=iw*0.34:y=ih*0.25:w=3:h=ih*0.5:color=${accent}:t=fill`;
            filter += `,drawbox=x=iw*0.66:y=ih*0.25:w=3:h=ih*0.5:color=${accent}:t=fill`;
          } else if (scene.visual_type === "diagram") {
            filter += `,drawbox=x=iw*0.16:y=ih*0.2:w=iw*0.68:h=ih*0.6:color=${accent}:t=3`;
            filter += `,drawbox=x=iw*0.24:y=ih*0.32:w=iw*0.52:h=3:color=${accent}:t=fill`;
          } else {
            filter += `,drawbox=x=iw*0.08:y=ih*0.12:w=iw*0.84:h=ih*0.76:color=${accent}:t=3`;
          }

          // Give procedural scenes actual visual motion and depth instead of a static card.
          if (!scene.asset) {
            filter += `,drawbox=x=0:y=0:w=iw:h=ih:color=0x000000@0.10:t=fill`;
            filter += `,drawbox=x=iw*(0.04+0.02*sin(t)):y=ih*0.08:w=iw*0.18:h=4:color=${accent}:t=fill`;
            filter += `,drawbox=x=iw*0.78:y=ih*(0.14+0.06*sin(t*1.4)):w=iw*0.12:h=3:color=${accent}:t=fill`;
            filter += `,drawbox=x=iw*(0.12+0.08*sin(t*0.7)):y=ih*0.68:w=iw*0.05:h=ih*0.05:color=${accent}:t=fill`;
            filter += `,drawbox=x=iw*(0.72+0.06*cos(t*0.9)):y=ih*0.3:w=iw*0.025:h=ih*0.025:color=${accent}:t=fill`;
          }

          const layout = safeTextLayout(scene, dimensions.width, dimensions.height);
          if (layout) {
            filter += ",drawtext=text='" + escapeDrawtext(layout.text) +
              "':fontcolor=white:fontsize=" + layout.size +
              ":x=(w-text_w)/2:y=" + layout.y +
              ":box=1:boxcolor=black@0.45:boxborderw=24";
          }

          for (const caption of scene.caption_segments) {
            const captionText = wrapText(caption.text, Math.max(12, Math.floor((dimensions.width - 96) / 22)));
            filter += ",drawtext=text='" + escapeDrawtext(captionText) +
              "':fontcolor=white:fontsize=" + Math.min(42, Math.max(24, Math.round(dimensions.width * 0.032))) +
              ":x=(w-text_w)/2:y=h*0.78:box=1:boxcolor=black@0.72:boxborderw=18" +
              ":enable='between(t," + caption.start + "," + caption.end + ")'";
          }

          filter += "[v" + index + "]";
          filters.push(filter);
        });

        const concatInputs = validScenes.map((_, index) => "[v" + index + "]").join("");
        const filterComplex = filters.join(";") + ";" + concatInputs + "concat=n=" + validScenes.length + ":v=1:a=0[v]";

        await runCommand("ffmpeg", [
          "-y", ...inputs, "-filter_complex", filterComplex, "-map", "[v]",
          "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", output,
        ]);
        const stat = await fs.stat(output);
        if (!stat.isFile() || stat.size <= 0) throw new Error("FFmpeg exited without producing a non-empty output file.");

        const durationSeconds = validScenes.reduce((sum, scene) => sum + scene.duration, 0);
        const outputPath = relativeWorkspacePath(output);
        const specification: VideoSpecification = {
          width: dimensions.width,
          height: dimensions.height,
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
        return JSON.stringify({ ...result, action, aspectRatio });
      }

      return { toolCallId: "", content: "video_engine action must be create_test, render, or probe.", isError: true };
    } catch (error) {
      return { toolCallId: "", content: "video_engine failed: " + (error instanceof Error ? error.message : String(error)), isError: true };
    }
  },
  };
}

export const videoEngineTool = createVideoEngineTool();
