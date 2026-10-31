const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const sandbox = { module: { exports: {} }, setTimeout, clearTimeout, Promise, isFinite };
const source = fs.readFileSync(path.join(__dirname, "../../frontend/host-bridge.js"), "utf8");
vm.runInNewContext(source, sandbox, { filename: "host-bridge.js" });
const { buildExpression, execute } = sandbox.module.exports;

test("caption bridge embeds a structured payload and preserves timing and text", () => {
  const payload = {
    source: { path: "C:/mock/clip.mp4", layerIndex: 1 },
    style: "clean",
    segments: [
      { text: "phrase one", start: 0, end: 1.25 },
      { text: "word two", start: 1.25, end: 1.5 },
    ],
  };
  const expression = buildExpression("create_captions", payload);
  assert.match(expression, /^OBSIDIAN_executePlan\("create_captions",\{/);
  assert.equal(expression.includes(JSON.stringify(JSON.stringify(payload))), false);
  const host = { OBSIDIAN_executePlan: (action, args) => ({ action, args }) };
  const result = vm.runInNewContext(expression, host);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { action: "create_captions", args: payload });
});

test("caption bridge retains the one-megacharacter bound", () => {
  assert.throws(
    () => buildExpression("create_captions", { source: "x".repeat(1000001) }),
    /1,000,000-character safe transport limit/
  );
  assert.throws(() => buildExpression("create_captions", "{}"), /structured object/);
});

test("phrase and word caption modes transfer realistic ordered payloads without truncation", () => {
  const cases = [
    { mode: "phrase", count: 32 },
    { mode: "word", count: 240 },
  ];
  cases.forEach(({ mode, count }) => {
    const segmentDuration = mode === "word" ? 5 / 30 : 0.6;
    const payload = {
      source: { path: "C:/mock/clip.mp4", layerIndex: 1 },
      style: "yellow",
      segments: Array.from({ length: count }, (_, index) => ({
        text: mode + " caption " + (index + 1),
        start: index * segmentDuration,
        end: (index + 1) * segmentDuration,
      })),
    };
    const expression = buildExpression("create_captions", payload);
    const received = vm.runInNewContext(expression, {
      OBSIDIAN_executePlan: (action, args) => ({ action, args }),
    });
    assert.equal(expression.length < 1000000, true);
    assert.equal(received.args.segments.length, count);
    assert.equal(received.args.style, "yellow");
    assert.deepEqual(JSON.parse(JSON.stringify(received.args.segments)), payload.segments);
  });
});

test("maximum allowed caption payload stays within the existing safe transport bound", () => {
  const payload = {
    source: {
      path: "C:/mock/" + "p".repeat(4000) + ".mp4",
      layerName: "Interview Footage",
      layerId: "9001",
      layerIndex: 1,
      inPoint: 0,
      outPoint: 45,
      startTime: 0,
      stretch: 100,
      frameRate: 30,
      compName: "SaaS Hero",
      compDuration: 45,
      compWidth: 1920,
      compHeight: 1080,
    },
    style: "clean",
    segments: Array.from({ length: 400 }, (_, index) => ({
      text: "x".repeat(140),
      start: index * 0.1,
      end: (index + 1) * 0.1,
    })),
  };
  const expression = buildExpression("create_captions", payload);
  assert.ok(expression.length < 1000000);
  const received = vm.runInNewContext(expression, {
    OBSIDIAN_executePlan: (action, args) => ({ action, args }),
  });
  assert.equal(received.args.segments.length, 400);
  assert.equal(received.args.segments[399].text, "x".repeat(140));
  assert.equal(received.args.segments[399].end, 40);
});

test("caption bridge escapes legacy ExtendScript line-separator characters", () => {
  const payload = { segments: [{ text: "first\u2028second\u2029third", start: 0, end: 1 }] };
  const expression = buildExpression("create_captions", payload);
  assert.equal(expression.includes("\u2028"), false);
  assert.equal(expression.includes("\u2029"), false);
  const received = vm.runInNewContext(expression, { OBSIDIAN_executePlan: (action, args) => args });
  assert.equal(received.segments[0].text, payload.segments[0].text);
});

test("host bridge resolves success only for a non-empty verified response", async () => {
  const result = await execute((expression, callback) => callback("OK|Verified opacity at 50%."), "run");
  assert.equal(result.status, "verified");
  assert.equal(result.message, "Verified opacity at 50%.");
});

test("host errors and malformed responses are failures", async () => {
  const hostError = await execute((expression, callback) => callback("ERROR|No active composition."), "run");
  const malformed = await execute((expression, callback) => callback("OK|"), "run");
  const missing = await execute((expression, callback) => callback(null), "run");
  assert.equal(hostError.status, "failed");
  assert.equal(hostError.message, "No active composition.");
  assert.equal(malformed.status, "failed");
  assert.equal(missing.status, "failed");
});

test("host preflight rejections stay distinct from execution failures", async () => {
  const result = await execute((expression, callback) => callback("REJECTED|Unlock the selected layer."), "run");
  assert.equal(result.status, "rejected");
  assert.equal(result.message, "Unlock the selected layer.");
});

test("host bridge reports callbacks that never arrive as timed out", async () => {
  const result = await execute(() => {}, "run", 5);
  assert.equal(result.status, "timed_out");
});

test("host bridge ignores late and duplicate callbacks after settling", async () => {
  let callback;
  const resultPromise = execute((expression, next) => { callback = next; }, "run", 5);
  const result = await resultPromise;
  callback("OK|A late success.");
  callback("OK|A duplicate success.");
  assert.equal(result.status, "timed_out");
});

test("host bridge captures synchronous bridge exceptions", async () => {
  const result = await execute(() => { throw new Error("bridge unavailable"); }, "run");
  assert.equal(result.status, "failed");
  assert.equal(result.message, "bridge unavailable");
});
