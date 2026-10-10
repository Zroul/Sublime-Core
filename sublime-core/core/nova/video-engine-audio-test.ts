import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createVideoEngineTool } from "../ai/tools/video-engine.js";
import type { ToolResult } from "../ai/reasoning/types.js";

const workspace = path.resolve("workspace");
const audioDirectory = path.join(workspace, "assets", "audio");
const outputDirectory = path.join(workspace, "nova", "videos");
const temporary = await mkdtemp(path.join(workspace, ".audio-cue-test-"));
const calls: Array<{ command: string; args: string[] }> = [];

try {
  await mkdir(audioDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(audioDirectory, "minecraft-pop.wav"), Buffer.from("test-audio-fixture"));

  const engine = createVideoEngineTool(async (command, args) => {
    calls.push({ command, args });
    if (command === "ffmpeg") {
      await writeFile(args.at(-1)!, Buffer.from("test-render-output"));
      return { stdout: "", stderr: "" };
    }
    throw new Error("Unexpected command in render-only test: " + command);
  });

  const result = await engine.handler({
    action: "render",
    id: "audio-cue-test",
    output: "nova/videos/audio-cue-test.mp4",
    aspect_ratio: "16:9",
    scenes: [{ duration: 3, text: "Cat ranking", background: "101010" }],
    audio_cues: [{
      asset_path: "assets/audio/minecraft-pop.wav",
      start: 1.25,
      duration: 0.5,
      volume: 0.7,
    }],
  }, { messages: [], turn: 1, system: "test" });

  const content = typeof result === "string" ? result : (result as ToolResult).content;
  assert.equal(JSON.parse(content).ok, true);
  assert.equal(calls.length, 1);
  const args = calls[0].args;
  assert.ok(args.includes("[aout]"), "render maps the mixed audio stream");
  assert.ok(args.includes("-c:a"), "render encodes audio");
  assert.ok(args.some((value) => value.includes("adelay=1250:all=1")), "audio cue starts at its requested timeline offset");
  assert.ok(args.some((value) => value.includes("amix=inputs=1")), "audio cues are mixed");
  assert.ok(args.some((value) => value.includes("apad[aout]")), "audio is padded so short effects do not truncate the video");

  const beforeTraversal = calls.length;
  const rejected = await engine.handler({
    action: "render",
    id: "audio-cue-traversal-test",
    output: "nova/videos/audio-cue-traversal-test.mp4",
    scenes: [{ duration: 2 }],
    audio_cues: [{ asset_path: "assets/audio/../../outside.wav", start: 0 }],
  }, { messages: [], turn: 1, system: "test" });
  assert.notEqual(typeof rejected === "string" ? JSON.parse(rejected).ok : (rejected as ToolResult).isError, false);
  assert.equal(calls.length, beforeTraversal, "invalid audio paths are rejected before FFmpeg runs");

  console.log("NOVA video-engine audio cue tests passed.");
} finally {
  await rm(temporary, { recursive: true, force: true });
  await rm(path.join(audioDirectory, "minecraft-pop.wav"), { force: true });
}
