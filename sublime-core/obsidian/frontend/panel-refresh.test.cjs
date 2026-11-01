const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const refreshContext = {
  module: { exports: {} },
  setTimeout,
  clearTimeout,
  AbortController,
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "panel-refresh.js"), "utf8"), refreshContext);
const { createRefreshController, createServiceProbe } = refreshContext.module.exports;

test("panel refresh shows a transient state, reloads once, and restores its state", async () => {
  let releaseWait;
  let reloadCount = 0;
  const states = [];
  const controller = createRefreshController({
    isBusy: () => false,
    wait: () => new Promise((resolve) => { releaseWait = resolve; }),
    reloadPanel: () => { reloadCount++; },
    onState: (refreshing) => states.push(refreshing),
  });

  const first = controller.refresh();
  assert.equal(controller.isRefreshing(), true);
  assert.deepEqual(states, [true]);
  assert.equal((await controller.refresh()).status, "duplicate");
  releaseWait();

  assert.equal((await first).status, "reloaded");
  assert.equal(controller.isRefreshing(), false);
  assert.equal(reloadCount, 1);
  assert.deepEqual(states, [true, false]);
});

test("panel refresh rejects active operations without reloading or changing UI state", async () => {
  let reloadCount = 0;
  const states = [];
  const controller = createRefreshController({
    isBusy: () => true,
    reloadPanel: () => { reloadCount++; },
    onState: (refreshing) => states.push(refreshing),
  });

  assert.equal((await controller.refresh()).status, "blocked");
  assert.equal(reloadCount, 0);
  assert.deepEqual(states, []);
  assert.equal(controller.isRefreshing(), false);
});

test("panel refresh rechecks active operations immediately before reloading", async () => {
  let releaseWait;
  let busy = false;
  let reloadCount = 0;
  const states = [];
  const controller = createRefreshController({
    isBusy: () => busy,
    wait: () => new Promise((resolve) => { releaseWait = resolve; }),
    reloadPanel: () => { reloadCount++; },
    onState: (refreshing) => states.push(refreshing),
  });

  const pending = controller.refresh();
  busy = true;
  releaseWait();

  assert.equal((await pending).status, "blocked");
  assert.equal(reloadCount, 0);
  assert.equal(controller.isRefreshing(), false);
  assert.deepEqual(states, [true, false]);
});

test("refresh controller restores normal state if panel reload fails", async () => {
  const states = [];
  const controller = createRefreshController({
    isBusy: () => false,
    wait: async () => {},
    reloadPanel: () => { throw new Error("reload denied"); },
    onState: (refreshing) => states.push(refreshing),
  });

  const result = await controller.refresh();
  assert.equal(result.status, "failed");
  assert.equal(result.error, "reload denied");
  assert.equal(controller.isRefreshing(), false);
  assert.deepEqual(states, [true, false]);
});

test("service probe reconnects to CORE health and transcription dependencies", async () => {
  const requested = [];
  const rendered = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url.endsWith("/health")) {
      return { ok: true, json: async () => ({ service: "available", ollama: { state: "ready", message: "Existing model ready." } }) };
    }
    if (url.endsWith("/dependencies")) {
      return { ok: true, json: async () => ({
        service: "available",
        captions: {
          python: { available: true },
          whisper: { installed: true, modelVerified: true },
          ffmpeg: { available: true },
          ffprobe: { available: true },
        },
      }) };
    }
    throw new Error("Unexpected endpoint: " + url);
  };
  const probe = createServiceProbe({ fetchImpl, onUpdate: (status) => rendered.push(status) });

  const statuses = await probe.refresh();

  assert.deepEqual(requested.sort(), ["http://127.0.0.1:43127/dependencies", "http://127.0.0.1:43127/health"]);
  assert.equal(statuses.core.state, "ready");
  assert.equal(statuses.whisper.state, "ready");
  assert.equal(rendered[0].core.state, "checking");
  assert.equal(rendered.at(-1).whisper.state, "ready");
});

test("service probe reports unavailable local services without throwing", async () => {
  const rendered = [];
  const probe = createServiceProbe({
    fetchImpl: async () => { throw new Error("connection refused"); },
    healthTimeoutMs: 50,
    dependenciesTimeoutMs: 50,
    onUpdate: (status) => rendered.push(status),
  });

  const statuses = await probe.refresh();

  assert.equal(statuses.core.state, "offline");
  assert.equal(statuses.whisper.state, "offline");
  assert.match(statuses.core.detail, /connection refused/);
  assert.equal(rendered.at(-1).core.state, "offline");
});
