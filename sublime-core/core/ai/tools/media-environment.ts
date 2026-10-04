import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../reasoning/types.js";

const execFileAsync = promisify(execFile);

export interface MediaCapabilities {
  platform: NodeJS.Platform;
  ffmpegAvailable: boolean;
  ffprobeAvailable: boolean;
  ffmpegPath?: string;
  ffprobePath?: string;
  rendering: string[];
}

export type ExecutableFinder = (name: string) => Promise<string | undefined>;

async function findExecutable(name: string): Promise<string | undefined> {
  const overrideName = name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH";
  const override = process.env[overrideName]?.trim();
  if (override) {
    const candidate = path.resolve(override);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      return undefined;
    }
  }

  const locator = process.platform === "win32" ? "where.exe" : "which";
  try {
    const { stdout } = await execFileAsync(locator, [name], {
      timeout: 3000,
      windowsHide: true,
    });
    for (const line of stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
      const candidate = path.resolve(line);
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Keep checking locator results, if it returned more than one.
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export async function discoverMediaCapabilities(
  finder: ExecutableFinder = findExecutable,
): Promise<MediaCapabilities> {
  const [ffmpegPath, ffprobePath] = await Promise.all([
    finder("ffmpeg"),
    finder("ffprobe"),
  ]);
  const rendering = ["procedural-color", "drawbox", "drawtext", "mp4", "h264"];

  return {
    platform: process.platform,
    ffmpegAvailable: Boolean(ffmpegPath),
    ffprobeAvailable: Boolean(ffprobePath),
    ...(ffmpegPath ? { ffmpegPath } : {}),
    ...(ffprobePath ? { ffprobePath } : {}),
    rendering,
  };
}

export const mediaCapabilitiesTool: Tool = {
  name: "media_capabilities",
  description: "Report only NOVA-relevant local media capabilities, including platform and FFmpeg/ffprobe availability.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  async handler() {
    return JSON.stringify(await discoverMediaCapabilities());
  },
};
