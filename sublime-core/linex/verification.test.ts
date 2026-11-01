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
  content = "ok",
  isError = false,
): void {
  const assistant: Message = { role: "assistant", content: "", toolCalls: [call] };
  const result: ToolResult = { toolCallId: call.id, content, isError };
  gate.recordToolResult(result, [assistant]);
}

test("blocks completion until a requested file change is made and read back", () => {
  const gate = createLinexVerificationGate("Add a helper function and verify it.");
  assert.equal(gate.beforeToolCall(toolCall("done-0", "task_done")).block, true);

  record(gate, toolCall("write-1", "obsidian_edit_file", { path: "src/helper.js" }));
  assert.equal(gate.beforeToolCall(toolCall("done-1", "task_done")).block, true);

  record(gate, toolCall("read-1", "obsidian_read_file", { path: "src/helper.js" }));
  assert.equal(gate.beforeToolCall(toolCall("done-2", "task_done")).block, false);
});

test("a second edit invalidates the previous read-back verification", () => {
  const gate = createLinexVerificationGate("Fix the helper.");
  record(gate, toolCall("write-1", "obsidian_edit_file", { path: "helper.js" }));
  record(gate, toolCall("read-1", "obsidian_read_file", { path: "helper.js" }));
  assert.equal(gate.beforeToolCall(toolCall("done-1", "task_done")).block, false);

  record(gate, toolCall("write-2", "obsidian_edit_file", { path: "helper.js" }));
  assert.equal(gate.beforeToolCall(toolCall("done-2", "task_done")).block, true);
});

test("read-only tasks can finish without writing files", () => {
  const gate = createLinexVerificationGate("Inspect the project and report findings. Do not edit files.");
  assert.equal(gate.beforeToolCall(toolCall("done", "task_done")).block, false);
});

test("failed writes do not count as successful changes", () => {
  const gate = createLinexVerificationGate("Create a new helper file.");
  record(gate, toolCall("write-fail", "obsidian_create_file", { path: "helper.js" }), "write failed", true);
  assert.equal(gate.beforeToolCall(toolCall("done", "task_done")).block, true);
});
