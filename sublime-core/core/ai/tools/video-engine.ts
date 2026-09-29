import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../reasoning/types.js";

const execFileAsync = promisify(execFile);
const WORKSPACE = path.resolve("workspace");
const VIDEO_DIR = path.join(WORKSPACE, "nova", "videos");

interface Scene { duration: number; text?: string; background?: string; }

function safeId(value: string): string {
  const id = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return id.slice(0, 80) || "video";
}

function workspacePath(relative: string): string {
  const resolved = path.resolve(WORKSPACE, relative);
  const relativeToWorkspace = path.relative(WORKSPACE, resolved);
  if (relativeToWorkspace.startsWith("..") || path.isAbsolute(relativeToWorkspace)) {
    throw new Error("Path must stay inside the workspace.");
  }
  return resolved;
}

async function run(command: string, args: string[]) {
  return execFileAsync(command, args, {
    cwd: WORKSPACE,
    timeout: 120000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
}

function escapeDrawtext(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/\x27/g, "\\x27");
}

function color(value: string | undefined): string {
  const raw = String(value ?? "202020").trim().toLowerCase();
  const named: Record<string, string> = {
    black: "000000",
    white: "ffffff",
    red: "ff0000",
    green: "00ff00",
    blue: "0000ff",
    yellow: "ffff00",
    cyan: "00ffff",
    magenta: "ff00ff",
    gray: "808080",
    grey: "808080",
  };
  const candidate = named[raw] ?? raw.replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(candidate) ? candidate : "202020";
}

export const videoEngineTool: Tool = {
  name: "video_engine",
  description:
    "Local video production engine. Uses installed FFmpeg/ffprobe to create deterministic test videos, render simple scene timelines, and inspect finished video files. It never publishes videos. IMPORTANT: use action='render' for any user request involving multiple scenes, a timeline, scene order, text overlays, or specified backgrounds. Use action='create_test' ONLY for a generic single-color test video with no scene-specific requirements. Use action='probe' to inspect an existing output file.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create_test", "render", "probe"],
        description:
          "Choose render for multi-scene/timeline requests. Choose create_test only for a generic single-color test. Choose probe to inspect an existing MP4.",
      },
      id: { type: "string", description: "Safe video job id." },
      output: { type: "string", description: "Optional workspace-relative output path." },
      duration: { type: "number", description: "Duration in seconds for create_test only." },
      scenes: {
        type: "array",
        description:
          "Required for render. Ordered scene timeline. Preserve the user's exact scene order and values exactly. Do not invent or replace scene durations/backgrounds. Each scene has duration, optional visible text, and background, which may be a common color name such as blue/green/red or a six-digit hex value. For example, three requested scenes of 3 seconds each MUST be passed as [{duration:3,background:\"blue\",text:\"SCENE 1\"},{duration:3,background:\"green\",text:\"SCENE 2\"},{duration:3,background:\"red\",text:\"SCENE 3\"}], producing 9 seconds total.",
        items: {
          type: "object",
          properties: {
            duration: { type: "number" },
            text: { type: "string" },
            background: { type: "string" },
          },
          required: ["duration"],
          additionalProperties: false,
        },
      },
      path: { type: "string", description: "Workspace-relative video path for probe." },
    },
    required: ["action"],
    additionalProperties: false,
  },

  async handler(input) {
    const action = String(input.action ?? "");
    try {
      await fs.mkdir(VIDEO_DIR, { recursive: true });

      if (action === "create_test") {
        const id = safeId(String(input.id ?? "test"));
        const duration = Math.max(1, Math.min(30, Number(input.duration ?? 5)));
        const output = workspacePath(String(input.output ?? ("nova/videos/" + id + ".mp4")));
        await fs.mkdir(path.dirname(output), { recursive: true });
        await run("ffmpeg", [
          "-y", "-f", "lavfi", "-i", "color=c=202020:s=1280x720:r=30",
          "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
          "-t", String(duration), "-c:v", "libx264", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-shortest", output,
        ]);
        return JSON.stringify({ ok: true, action, output: path.relative(WORKSPACE, output).replaceAll("\\", "/"), duration });
      }

      if (action === "probe") {
        const relative = String(input.path ?? "");
        if (!relative) return { toolCallId: "", content: "video_engine probe requires path.", isError: true };
        const target = workspacePath(relative);
        const result = await run("ffprobe", [
          "-v", "error",
          "-show_entries", "format=duration,size,format_name",
          "-show_entries", "stream=index,codec_type,codec_name,width,height,r_frame_rate",
          "-of", "json", target,
        ]);
        return result.stdout.trim() || "ffprobe returned no metadata.";
      }

      if (action === "render") {
        const scenes = Array.isArray(input.scenes) ? (input.scenes as Scene[]) : [];
        if (scenes.length === 0 || scenes.length > 30) return { toolCallId: "", content: "render requires 1-30 scenes.", isError: true };
        const validScenes = scenes.map((scene, index) => {
          const duration = Number(scene.duration);
          if (!Number.isFinite(duration) || duration <= 0 || duration > 120) throw new Error("Scene " + (index + 1) + " has an invalid duration.");
          return { duration, text: String(scene.text ?? "").slice(0, 500), background: color(scene.background) };
        });
        const id = safeId(String(input.id ?? "render"));
        const output = workspacePath(String(input.output ?? ("nova/videos/" + id + ".mp4")));
        await fs.mkdir(path.dirname(output), { recursive: true });
        const inputs: string[] = [];
        const filters: string[] = [];
        validScenes.forEach((scene, index) => {
          inputs.push("-f", "lavfi", "-t", String(scene.duration), "-i", "color=c=#" + scene.background + ":s=1280x720:r=30");
          let filter = "[" + index + ":v]format=yuv420p";
          if (scene.text) filter += ",drawtext=text=\x27" + escapeDrawtext(scene.text) + "\x27:fontcolor=white:fontsize=54:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.45:boxborderw=18";
          filter += "[v" + index + "]";
          filters.push(filter);
        });
        const concatInputs = validScenes.map((_, index) => "[v" + index + "]").join("");
        const filterComplex = filters.join(";") + ";" + concatInputs + "concat=n=" + validScenes.length + ":v=1:a=0[v]";
        await run("ffmpeg", ["-y", ...inputs, "-filter_complex", filterComplex, "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output]);
        return JSON.stringify({ ok: true, action, output: path.relative(WORKSPACE, output).replaceAll("\\", "/"), scenes: validScenes.length, duration: validScenes.reduce((sum, scene) => sum + scene.duration, 0) });
      }

      return { toolCallId: "", content: "video_engine action must be create_test, render, or probe.", isError: true };
    } catch (error) {
      return { toolCallId: "", content: "video_engine failed: " + (error instanceof Error ? error.message : String(error)), isError: true };
    }
  },
};
