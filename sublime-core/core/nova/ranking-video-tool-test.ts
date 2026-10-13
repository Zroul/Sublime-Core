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
        metadata: { formatName: "mov,mp4", durationSeconds, streams: [{ type: "video", codec: "h264" }, ...(source.endsWith("final.mp4") ? [{ type: "audio", codec: "aac" }] : [])] },
      });
    }
    if (args.action === "render") {
      const soundCues = Array.isArray(args.sound_cues) ? args.sound_cues : [];
      return JSON.stringify({ ok: true, outputPath: String(args.output), audioTrackPresent: soundCues.length > 0, soundCueCount: soundCues.length });
    }
    return { toolCallId: "", content: "Unexpected action", isError: true };
  },
};

const tool = createRankingVideoTool(mockEngine);
const jobId = "ranking-tool-test";
const jobDirectory = path.join(process.cwd(), "workspace", "nova", "jobs", jobId);
const folderJobId = "ranking-folder-test";
const folderJobDirectory = path.join(process.cwd(), "workspace", "nova", "jobs", folderJobId);
const scoreJobId = "ranking-score-test";
const scoreJobDirectory = path.join(process.cwd(), "workspace", "nova", "jobs", scoreJobId);
const assetFolder = path.join(process.cwd(), "workspace", "assets", "NOVA-RANKING-FOLDER-TEST");
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
  assert.equal(parsed.soundCueCount, 2);
  assert.match(parsed.soundCues, /synthesized/);
  assert.equal(parsed.clipCount, 2);
  assert.equal(parsed.durationSeconds, 15);
  assert.equal(calls.filter((call) => call.action === "probe").length, 3);
  const render = calls.find((call) => call.action === "render");
  assert.ok(render);
  assert.equal(render.aspect_ratio, "9:16");
  assert.deepEqual(render.sound_cues, [
    { kind: "hook_pop", at_seconds: 0 },
    { kind: "rank_sting", at_seconds: 7.5 },
  ]);
  const scenes = render.scenes as Array<Record<string, unknown>>;
  assert.deepEqual(scenes.map((scene) => scene.duration), [7.5, 7.5]);
  assert.equal(scenes[0].asset_path, "assets/cats/short.mp4");
  const savedPlanText = await fs.readFile(path.join(jobDirectory, "ranking-plan.json"), "utf8");
  assert.ok(savedPlanText.endsWith("\n"), "saved ranking plan should end with a real newline");
  const savedPlan = JSON.parse(savedPlanText);
  assert.equal(savedPlan.narration, false);
  assert.equal(savedPlan.segments.length, 2);

  const probesBeforeInvalidDuration = calls.filter((call) => call.action === "probe").length;
  const invalidDuration = await tool.handler({
    target_seconds: 2,
    clips: [{ id: "short", path: "assets/cats/short.mp4", category: "funny" }],
  }, context);
  assert.equal((invalidDuration as { isError?: boolean }).isError, true);
  assert.equal(calls.filter((call) => call.action === "probe").length, probesBeforeInvalidDuration);

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

  const folderClips = [
    { folder: "CAT ANGRY", file: "angry.mp4", category: "angry" },
    { folder: "CAT DURING BATH", file: "bath.mp4", category: "bath" },
    { folder: "CAT FIGHTING", file: "fight.mp4", category: "fighting" },
  ];
  for (const clip of folderClips) {
    const directory = path.join(assetFolder, clip.folder);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, clip.file), "mock media placeholder", "utf8");
  }
  const folderResult = await tool.handler({
    job_id: folderJobId,
    target_seconds: 15,
    asset_folder: "assets/NOVA-RANKING-FOLDER-TEST",
  }, context);
  const folderParsed = JSON.parse(String(folderResult));
  assert.equal(folderParsed.ok, true);
  assert.equal(folderParsed.clipCount, 3);
  const folderPlan = JSON.parse(await fs.readFile(path.join(folderJobDirectory, "ranking-plan.json"), "utf8"));
  assert.deepEqual(folderPlan.segments.map((segment: { category: string }) => segment.category), ["angry", "bath", "fighting"]);
  assert.deepEqual(folderPlan.segments.map((segment: { path: string }) => path.basename(path.dirname(segment.path))), [
    "CAT ANGRY", "CAT DURING BATH", "CAT FIGHTING",
  ]);

  const scoredResult = await tool.handler({
    job_id: scoreJobId,
    target_seconds: 15,
    clips: [
      { id: "best", path: "assets/cats/long.mp4", category: "funny", entertainment_score: 90 },
      { id: "least", path: "assets/cats/short.mp4", category: "angry", entertainment_score: 10 },
    ],
  }, context);
  assert.equal(JSON.parse(String(scoredResult)).ok, true);
  const scoredSavedPlan = JSON.parse(await fs.readFile(path.join(scoreJobDirectory, "ranking-plan.json"), "utf8"));
  assert.deepEqual(scoredSavedPlan.segments.map((segment: { clipId: string }) => segment.clipId), ["least", "best"]);
  assert.deepEqual(scoredSavedPlan.segments.map((segment: { entertainmentScore: number }) => segment.entertainmentScore), [10, 90]);

  const bothInputs = await tool.handler({
    target_seconds: 15,
    asset_folder: "assets/NOVA-RANKING-FOLDER-TEST",
    clips: [{ id: "manual", path: "assets/cats/manual.mp4", category: "funny" }],
  }, context);
  assert.equal((bothInputs as { isError?: boolean }).isError, true);
  assert.match(String((bothInputs as { content?: string }).content), /either clips or asset_folder/i);
} finally {
  await fs.rm(jobDirectory, { recursive: true, force: true });
  await fs.rm(folderJobDirectory, { recursive: true, force: true });
  await fs.rm(scoreJobDirectory, { recursive: true, force: true });
  await fs.rm(assetFolder, { recursive: true, force: true });
}

console.log("NOVA ranking video tool tests passed.");
