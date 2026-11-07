const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const context = { module: { exports: {} }, globalThis: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "working-status.js"), "utf8"), context);
const { LABELS, createController } = context.module.exports;

test("working status replaces the prior stage label instead of accumulating activity history", () => {
  const rendered = [];
  const status = createController((state) => rendered.push(state && state.label));

  assert.equal(status.set("analyzing"), true);
  assert.equal(status.set("scripting"), true);
  assert.equal(status.set("verifying"), true);
  assert.equal(status.set("completed"), true);

  assert.deepEqual(rendered, ["ANALYZING", "SCRIPTING", "VERIFYING", "COMPLETED"]);
  assert.deepEqual(JSON.parse(JSON.stringify(status.getState())), { stage: "completed", label: "COMPLETED" });
});

test("working status accepts actual caption backend stages and clears without retaining history", () => {
  const rendered = [];
  const status = createController((state) => rendered.push(state && state.label));

  for (const stage of ["analyzing_footage", "connecting_service", "preparing", "transcribing", "processing_results", "validating_captions", "reviewing", "completed"]) {
    assert.equal(status.set(stage), true, stage);
  }
  status.clear();

  assert.deepEqual(rendered, ["ANALYZING", "CONNECTING TO SERVICE", "PREPARING", "TRANSCRIBING", "PROCESSING", "VALIDATING", "REVIEWING", "COMPLETED", null]);
  assert.equal(status.getState(), null);
  assert.equal(LABELS.failed, "FAILED");
});
