import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLinexTools, resolveObsidianPath } from "./agent.js";

test("rejects traversal and protected paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linex-path-test-"));
  try {
    await assert.rejects(resolveObsidianPath(root, "../outside.txt"));
    await assert.rejects(resolveObsidianPath(root, ".git/config"));
    await assert.rejects(resolveObsidianPath(root, "node_modules/pkg/index.js"));
    await assert.rejects(resolveObsidianPath(root, path.join(root, "absolute.txt")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("creates a new file inside nested directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linex-create-test-"));
  try {
    const target = await resolveObsidianPath(root, "new/nested/result.txt", true);
    assert.equal(target, path.join(root, "new", "nested", "result.txt"));

    const createTool = createLinexTools(root).find((tool) => tool.name === "obsidian_create_file");
    assert.ok(createTool);
    const result = await createTool.handler(
      { path: "new/nested/result.txt", content: "LINEX nested-create test" },
      { messages: [], turn: 1, system: "test" },
    );

    assert.equal(typeof result, "string");
    assert.equal(
      await readFile(path.join(root, "new", "nested", "result.txt"), "utf8"),
      "LINEX nested-create test",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
