import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { videoEngineTool } from "../ai/tools/video-engine.js";

const jobId = "nova-audio-cue-test-" + Date.now().toString(36);
const relativeJobPath = "nova/jobs/" + jobId;
const outputPath = relativeJobPath + "/final.mp4";
const absoluteJobPath = path.join(process.cwd(), "workspace", "nova", "jobs", jobId);
const context = { messages: [], turn: 1, system: "NOVA audio cue integration test" };

function parseResult(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === "object") {
    const result = value as { content?: unknown; isError?: boolean };
    if (result.isError) throw new Error(String(result.content ?? "video engine failed"));
    if (typeof result.content === "string") return JSON.parse(result.content) as Record<string, unknown>;
  }
  throw new Error("video_engine returned an unsupported test result");
}

try {
  const rendered = parseResult(await videoEngineTool.handler({
    action: "render",
    id: jobId,
    output: outputPath,
    aspect_ratio: "9:16",
    scenes: [
      { duration: 2, text: "AUDIO CUE TEST", background: "202020" },
    ],
    sound_cues: [
      { kind: "hook_pop", at_seconds: 0 },
      { kind: "rank_sting", at_seconds: 1 },
    ],
  }, context));

  assert.equal(rendered.ok, true);
  assert.equal(rendered.audioTrackPresent, true);
  assert.equal(rendered.soundCueCount, 2);

  const probe = parseResult(await videoEngineTool.handler({
    action: "probe",
    path: outputPath,
  }, context));
  assert.equal(probe.ok, true);
  assert.equal(probe.valid, true);
  const metadata = probe.metadata as { streams?: Array<{ type?: string }> };
  assert.ok(metadata.streams?.some((stream) => stream.type === "audio"), "rendered MP4 must contain the synthesized cue audio track");

  console.log("NOVA synthesized audio cue integration test passed.");
} finally {
  await fs.rm(absoluteJobPath, { recursive: true, force: true });
}
