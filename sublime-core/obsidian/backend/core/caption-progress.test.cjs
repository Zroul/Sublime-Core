const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const progressContext = { module: { exports: {} }, globalThis: {} };
vm.runInNewContext(fs.readFileSync(require.resolve("../../frontend/caption-progress.js"), "utf8"), progressContext);
const { createController } = progressContext.module.exports;

test("caption progress shows one active line per ordered stage and ignores duplicate or delayed events", async () => {
  const states = [];
  const progress = createController((state) => states.push({ ...state }), async () => {});
  const runId = progress.begin(41);

  await progress.handle({ type: "stage", phase: "start", stage: "analyzing_footage" }, runId);
  await progress.handle({ type: "stage", phase: "start", stage: "analyzing_footage" }, runId);
  assert.equal(states.filter((state) => state.mode === "running").length, 1);

  await progress.handle({ type: "stage", phase: "complete", stage: "analyzing_footage" }, runId);
  assert.equal(states.at(-1).mode, "hidden");
  await progress.handle({ type: "stage", phase: "start", stage: "validating" }, runId);
  await progress.handle({ type: "stage", phase: "start", stage: "analyzing_footage" }, runId);
  assert.deepEqual(JSON.parse(JSON.stringify(progress.getState())), { runId: 41, active: true, currentStage: "validating", highestStage: 2 });
  assert.equal(states.at(-1).stage, "validating");
});

test("caption progress accepts only measured Whisper frames and removes the final line on completion", async () => {
  const states = [];
  const progress = createController((state) => states.push({ ...state }), async () => {});
  const runId = progress.begin(9);
  await progress.handle({ type: "stage", phase: "start", stage: "transcribing" }, runId);
  await progress.handle({ type: "progress", stage: "transcribing", current: 38, total: 100 }, runId);
  assert.equal(states.at(-1).current, 38);
  assert.equal(states.at(-1).total, 100);
  await progress.handle({ type: "stage", phase: "complete", stage: "transcribing" }, runId);
  await progress.handle({ type: "stage", phase: "start", stage: "completed" }, runId);
  await progress.handle({ type: "stage", phase: "complete", stage: "completed" }, runId);
  await progress.finish(runId);
  assert.equal(states.at(-1).mode, "hidden");
  assert.equal(progress.getState().active, false);
});

test("caption progress clears its line and reports the exact failing stage", async () => {
  const states = [];
  const progress = createController((state) => states.push({ ...state }), async () => {});
  const runId = progress.begin(15);
  await progress.handle({ type: "stage", phase: "start", stage: "extracting_audio" }, runId);
  await progress.fail("extracting_audio", "FFmpeg could not read the selected audio track.", runId);
  assert.deepEqual(states.at(-1), {
    mode: "error", stage: "extracting_audio", message: "FFmpeg could not read the selected audio track.", runId: 15,
  });
  assert.equal(progress.getState().active, false);
});

test("an unavailable local service reports the connection stage instead of footage inspection", async () => {
  const states = [];
  const progress = createController((state) => states.push({ ...state }), async () => {});
  const runId = progress.begin(18);
  await progress.handle({ type: "stage", phase: "start", stage: "connecting_service" }, runId);
  await progress.fail("connecting_service", "The local transcription service could not be reached.", runId);
  assert.equal(states.at(-1).mode, "error");
  assert.equal(states.at(-1).stage, "connecting_service");
});

test("cancellation invalidates queued stage events so the line cannot reappear", async () => {
  const states = [];
  const progress = createController((state) => states.push({ ...state }), async () => {});
  const runId = progress.begin(27);
  await progress.handle({ type: "stage", phase: "start", stage: "validating" }, runId);
  progress.cancel(runId);
  await progress.handle({ type: "stage", phase: "start", stage: "preparing" }, runId);
  assert.equal(states.at(-1).mode, "hidden");
  assert.equal(progress.getState().active, false);
});
