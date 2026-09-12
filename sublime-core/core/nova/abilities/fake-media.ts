import { promises as fs } from "node:fs";
import path from "node:path";
import type { MediaAbilities, MediaAsset, VideoTimeline } from "./media-types.js";

export function createFakeMediaAbilities(): MediaAbilities {
  return {
    textToSpeech: async (text, outputPath) => {
      await ensureFile(outputPath, `FAKE AUDIO\n${text}\n`);
      return asset("audio", outputPath, "audio/wav");
    },
    probe: async (filePath) => asset("video", filePath),
    render: async (timeline, outputPath) => {
      await ensureFile(outputPath, JSON.stringify({ fakeRender: true, timeline }, null, 2));
      return asset("video", outputPath, "application/json");
    },
    generateCaptions: async (audioPath, outputPath) => {
      await ensureFile(outputPath, `1\n00:00:00,000 --> 00:00:01,000\n[FAKE CAPTION]\n`);
      return asset("caption", outputPath, "text/srt", audioPath);
    },
  };
}

export async function writeFakeTimeline(
  timeline: VideoTimeline,
  outputPath: string,
): Promise<MediaAsset> {
  await ensureFile(outputPath, JSON.stringify(timeline, null, 2));
  return asset("video", outputPath, "application/json");
}

async function ensureFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

function asset(
  kind: MediaAsset["kind"],
  filePath: string,
  mimeType?: string,
  source?: string,
): MediaAsset {
  return {
    id: `fake-${kind}-${path.basename(filePath)}`,
    kind,
    path: filePath,
    mimeType,
    source,
    license: "test-fixture",
  };
}
