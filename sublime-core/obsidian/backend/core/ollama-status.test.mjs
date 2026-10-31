import test from "node:test";
import assert from "node:assert/strict";
import { checkOllamaStatus } from "./ollama-status.mjs";

test("Ollama status reports ready only when API and configured model are available", async () => {
  const status = await checkOllamaStatus({
    baseUrl: "http://127.0.0.1:11434/",
    model: "core",
    fetchImpl: async (url) => {
      assert.equal(url, "http://127.0.0.1:11434/api/tags");
      return { ok: true, async json() { return { models: [{ name: "core:latest" }, { name: "qwen3:8b" }] }; } };
    },
  });
  assert.equal(status.state, "ready");
  assert.equal(status.running, true);
  assert.equal(status.modelAvailable, true);
});

test("Ollama status distinguishes a running server with a missing model", async () => {
  const status = await checkOllamaStatus({
    model: "core",
    fetchImpl: async () => ({ ok: true, async json() { return { models: [{ name: "qwen3:8b" }] }; } }),
  });
  assert.equal(status.state, "model_missing");
  assert.equal(status.running, true);
  assert.equal(status.modelAvailable, false);
});

test("Ollama status reports a stopped or unreachable service without launching it", async () => {
  const status = await checkOllamaStatus({
    fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
  });
  assert.equal(status.state, "stopped");
  assert.equal(status.running, false);
  assert.match(status.message, /did not try to launch another instance/);
});
