import assert from "node:assert/strict";
import test from "node:test";
import type { Message, ToolCall, ToolResult } from "../core/ai/reasoning/types.js";
import { createLinexVerificationGate } from "./verification.js";

function toolCall(id: string, name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id, name, arguments: args };
}

function record(
  gate: ReturnType<typeof createLinexVerificationGate>,
  call: ToolCall,
  observation = "ok",
  isError = false,
): void {
  const assistant: Message = { role: "assistant", content: "", toolCalls: [call] };
  const result: ToolResult = { toolCallId: call.id, content: observation, isError };
  gate.recordToolResult(result, [assistant]);
}

test("blocks completion until a requested file change is made and exact content is read back", () => {
  const gate = createLinexVerificationGate("Add a helper function and verify it.");
  assert.equal(gate.beforeToolCall(toolCall("done-0", "task_done")).block, true);

  record(gate, toolCall("write-1", "obsidian_edit_file", {
    path: "src/helper.js",
    content: "export const answer = 42;\n",
  }));
  assert.equal(gate.beforeToolCall(toolCall("done-1", "task_done")).block, true);

  record(gate, toolCall("read-1", "obsidian_read_file", { path: "src/helper.js" }), "export const answer = 42;\n");
  assert.equal(gate.beforeToolCall(toolCall("done-2", "task_done")).block, false);
});

test("a second edit invalidates the previous read-back verification", () => {
  const gate = createLinexVerificationGate("Fix the helper.");
  record(gate, toolCall("write-1", "obsidian_edit_file", { path: "helper.js", content: "version one" }));
  record(gate, toolCall("read-1", "obsidian_read_file", { path: "helper.js" }), "version one");
  assert.equal(gate.beforeToolCall(toolCall("done-1", "task_done")).block, false);

  record(gate, toolCall("write-2", "obsidian_edit_file", { path: "helper.js", content: "version two" }));
  assert.equal(gate.beforeToolCall(toolCall("done-2", "task_done")).block, true);
});

test("mismatched read-back content does not satisfy verification", () => {
  const gate = createLinexVerificationGate("Create a helper file.");
  record(gate, toolCall("write", "obsidian_create_file", { path: "helper.js", content: "expected" }));
  record(gate, toolCall("read-wrong", "obsidian_read_file", { path: "helper.js" }), "different");
  assert.equal(gate.beforeToolCall(toolCall("done-wrong", "task_done")).block, true);

  record(gate, toolCall("read-right", "obsidian_read_file", { path: "helper.js" }), "expected");
  assert.equal(gate.beforeToolCall(toolCall("done-right", "task_done")).block, false);
});

test("read-only tasks block file writes and can finish without changes", () => {
  const gate = createLinexVerificationGate("Inspect the project and report findings. Do not edit files.");
  assert.equal(
    gate.beforeToolCall(toolCall("write", "obsidian_edit_file", { path: "app.js", content: "bad" })).block,
    true,
  );
  assert.equal(gate.beforeToolCall(toolCall("done", "task_done")).block, false);
});

test("failed writes do not count as successful changes", () => {
  const gate = createLinexVerificationGate("Create a new helper file.");
  record(gate, toolCall("write-fail", "obsidian_create_file", {
    path: "helper.js",
    content: "expected",
  }), "write failed", true);
  assert.equal(gate.beforeToolCall(toolCall("done", "task_done")).block, true);
});
