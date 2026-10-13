import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { videoEngineTool } from "../ai/tools/video-engine.js";
import { createRankingVideoTool } from "./ranking-video-tool.js";

const suffix = Date.now().toString(36);
const jobId = "nova-ranking-e2e-" + suffix;
const sourcePaths = [
  "assets/cats/nova-ranking-e2e-a-" + suffix + ".mp4",
  "assets/cats/nova-ranking-e2e-b-" + suffix + ".mp4",
];
const absoluteSources = sourcePaths.map((relative) => path.join(process.cwd(), "workspace", ...relative.split("/")));
const absoluteJobDirectory = path.join(process.cwd(), "workspace", "nova", "jobs", jobId);
const context = { messages: [], turn: 1, system: "NOVA real ranking pipeline integration test" };

function parseResult(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === "object") {
    const result = value as { content?: unknown; isError?: boolean };
    if (result.isError) throw new Error(String(result.content ?? "tool failed"));
    if (typeof result.content === "string") return JSON.parse(result.content) as Record<string, unknown>;
  }
  throw new Error("Tool returned an unsupported integration-test result");
}

try {
  await fs.mkdir(path.dirname(absoluteSources[0]), { recursive: true });
  for (const source of sourcePaths) {
    const generated = parseResult(await videoEngineTool.handler({
      action: "create_test",
      id: "ranking-source-" + suffix,
      output: source,
      duration: 2,
    }, context));
    assert.equal(generated.ok, true, "test source clip should be generated");
  }

  const result = parseResult(await createRankingVideoTool().handler({
    job_id: jobId,
    title: "NOVA Ranking E2E",
    target_seconds: 3,
    aspect_ratio: "9:16",
    clips: [
      { id: "test-a", path: sourcePaths[0], category: "funny" },
      { id: "test-b", path: sourcePaths[1], category: "angry" },
    ],
  }, context));

  assert.equal(result.ok, true);
  assert.equal(result.validated, true);
  assert.equal(result.narration, false);
  assert.equal(result.soundCueCount, 2);
  assert.equal(result.durationSeconds, 3);
  assert.equal(typeof result.outputPath, "string");

  const finalProbe = parseResult(await videoEngineTool.handler({
    action: "probe",
    path: String(result.outputPath),
  }, context));
  const metadata = finalProbe.metadata as { streams?: Array<{ type?: string }> };
  assert.ok(metadata.streams?.some((stream) => stream.type === "video"), "final ranking MP4 must contain video");
  assert.ok(metadata.streams?.some((stream) => stream.type === "audio"), "final ranking MP4 must contain synthesized cue audio");

  console.log("NOVA real ranking-video end-to-end integration test passed.");
} finally {
  await Promise.all(absoluteSources.map((source) => fs.rm(source, { force: true })));
  await fs.rm(absoluteJobDirectory, { recursive: true, force: true });
}
