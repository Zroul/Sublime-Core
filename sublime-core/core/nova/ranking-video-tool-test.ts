import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../ai/reasoning/types.js";
import { createRankingVideoTool } from "./ranking-video-tool.js";

const calls: Array<Record<string, unknown>> = [];
const mockEngine: Tool = {
  name: "video_engine",
  description: "test double",
  parameters: { type: "object" },
  handler(args) {
    calls.push(args);
    if (args.action === "probe") {
      const source = String(args.path ?? "");
      const durationSeconds = source.endsWith("short.mp4") ? 8 : source.endsWith("long.mp4") ? 12 : 15;
      return JSON.stringify({
        ok: true,
        valid: true,
        outputPath: source,
        metadata: { formatName: "mov,mp4", durationSeconds, streams: [{ type: "video", codec: "h264" }] },
      });
    }
    if (args.action === "render") {
      return JSON.stringify({ ok: true, outputPath: String(args.output) });
    }
    return { toolCallId: "", content: "Unexpected action", isError: true };
  },
};

const tool = createRankingVideoTool(mockEngine);
const jobId = "ranking-tool-test";
const jobDirectory = path.join(process.cwd(), "workspace", "nova", "jobs", jobId);
const context = { messages: [], turn: 1, system: "test" };

try {
  const result = await tool.handler({
    job_id: jobId,
    target_seconds: 15,
    aspect_ratio: "9:16",
    title: "Tiny Cat Chaos",
    clips: [
      { id: "short", path: "assets/cats/short.mp4", category: "funny" },
      { id: "long", path: "assets/cats/long.mp4", category: "angry" },
    ],
  }, context);
  const parsed = JSON.parse(String(result));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.validated, true);
  assert.equal(parsed.narration, false);
  assert.equal(parsed.clipCount, 2);
  assert.equal(parsed.durationSeconds, 15);
  assert.equal(calls.filter((call) => call.action === "probe").length, 3);
  const render = calls.find((call) => call.action === "render");
  assert.ok(render);
  assert.equal(render.aspect_ratio, "9:16");
  const scenes = render.scenes as Array<Record<string, unknown>>;
  assert.deepEqual(scenes.map((scene) => scene.duration), [7.5, 7.5]);
  assert.equal(scenes[0].asset_path, "assets/cats/short.mp4");
  const savedPlan = JSON.parse(await fs.readFile(path.join(jobDirectory, "ranking-plan.json"), "utf8"));
  assert.equal(savedPlan.narration, false);
  assert.equal(savedPlan.segments.length, 2);

  const failed = await tool.handler({
    target_seconds: 30,
    clips: [{ id: "bad", path: "../outside.mp4", category: "funny" }],
  }, context);
  assert.equal((failed as { isError?: boolean }).isError, true);

  const disguisedTraversal = await tool.handler({
    target_seconds: 3,
    clips: [{ id: "bad", path: "assets/..", category: "funny" }],
  }, context);
  assert.equal((disguisedTraversal as { isError?: boolean }).isError, true);
  assert.ok(String((disguisedTraversal as { content?: string }).content).includes("workspace/assets"));

  const collision = await tool.handler({
    job_id: jobId,
    target_seconds: 3,
    clips: [{ id: "short", path: "assets/cats/short.mp4", category: "funny" }],
  }, context);
  assert.equal((collision as { isError?: boolean }).isError, true);
  assert.match(String((collision as { content?: string }).content), /already exists/i);
} finally {
  await fs.rm(jobDirectory, { recursive: true, force: true });
}

console.log("NOVA ranking video tool tests passed.");
