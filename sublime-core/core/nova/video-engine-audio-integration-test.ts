import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createVideoEngineTool } from "../ai/tools/video-engine.js";
import { discoverMediaCapabilities } from "../ai/tools/media-environment.js";
import type { ToolResult } from "../ai/reasoning/types.js";

const execFileAsync = promisify(execFile);
const workspace = path.resolve("workspace");
const audioDirectory = path.join(workspace, "assets", "audio");
const outputDirectory = path.join(workspace, "nova", "videos");
const id = `nova-audio-integration-${process.pid}`;
const audioFilename = `${id}.wav`;
const audioPath = path.join(audioDirectory, audioFilename);
const outputPath = `nova/videos/${id}.mp4`;
const absoluteOutput = path.join(outputDirectory, `${id}.mp4`);

function resultContent(result: string | ToolResult): string {
  return typeof result === "string" ? result : result.content;
}

async function main(): Promise<void> {
  const capabilities = await discoverMediaCapabilities();
  if (!capabilities.ffmpegAvailable || !capabilities.ffprobeAvailable ||
      !capabilities.ffmpegPath || !capabilities.ffprobePath) {
    console.log("NOVA real FFmpeg audio integration test skipped: ffmpeg and/or ffprobe unavailable.");
    return;
  }

  await mkdir(audioDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });

  try {
    // Generate an original test tone locally; no downloaded or copyrighted audio is needed.
    await execFileAsync(capabilities.ffmpegPath, [
      "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000",
      "-t", "0.8", "-c:a", "pcm_s16le", audioPath,
    ], { timeout: 15000, windowsHide: true });

    const engine = createVideoEngineTool();
    const renderRaw = await engine.handler({
      action: "render",
      id,
      output: outputPath,
      aspect_ratio: "16:9",
      scenes: [{ duration: 2, text: "NOVA audio integration test", background: "101010" }],
      audio_cues: [{
        asset_path: `assets/audio/${audioFilename}`,
        start: 0.2,
        duration: 0.6,
        volume: 0.5,
      }],
    }, { messages: [], turn: 1, system: "real FFmpeg integration test" });

    const render = JSON.parse(resultContent(renderRaw)) as { ok?: boolean; outputPath?: string; error?: string };
    assert.equal(render.ok, true, `real FFmpeg render should succeed: ${JSON.stringify(render)}`);

    const probeRaw = await engine.handler({
      action: "probe",
      path: render.outputPath ?? outputPath,
    }, { messages: [], turn: 1, system: "real FFmpeg integration test" });
    const probe = JSON.parse(resultContent(probeRaw)) as {
      ok?: boolean;
      valid?: boolean;
      metadata?: { streams?: Array<{ type?: string; codec?: string }>; durationSeconds?: number };
      error?: string;
    };

    assert.equal(probe.ok, true, `ffprobe should read the rendered MP4: ${JSON.stringify(probe)}`);
    assert.equal(probe.valid, true);
    assert.ok(probe.metadata?.streams?.some((stream) => stream.type === "video"), "output contains a video stream");
    assert.ok(probe.metadata?.streams?.some((stream) => stream.type === "audio"), "scheduled sound effect becomes a real audio stream");
    assert.ok(Number(probe.metadata?.durationSeconds) >= 1.8, "rendered output has the expected non-trivial duration");

    console.log("NOVA real FFmpeg audio integration test passed: rendered MP4 contains video and audio streams.");
  } finally {
    await rm(audioPath, { force: true });
    await rm(absoluteOutput, { force: true });
  }
}

await main();
