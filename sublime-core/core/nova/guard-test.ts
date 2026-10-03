import assert from "node:assert/strict";
import { createNovaGuard } from "./guard.js";

function call(name: string, id = name, args: Record<string, unknown> = {}) {
  return { id, name, arguments: args };
}

function expectBlocked(
  guard: ReturnType<typeof createNovaGuard>,
  toolName: string,
  message: string,
  args: Record<string, unknown> = {},
) {
  const result = guard.beforeToolCall(call(toolName, message, args));
  assert.equal(result.block, true, message);
}

function expectAllowed(
  guard: ReturnType<typeof createNovaGuard>,
  toolName: string,
  message: string,
  args: Record<string, unknown> = {},
) {
  const result = guard.beforeToolCall(call(toolName, message, args));
  assert.equal(result.block, false, message);
}

{
  const guard = createNovaGuard(
    "Create test.html and verify that the file exists.",
  );

  expectBlocked(
    guard,
    "task_done",
    "task_done must be blocked before creation",
  );

  expectAllowed(
    guard,
    "create_file",
    "creation should be allowed",
  );
  guard.recordResult("create_file", true, { path: "test.html" });

  expectBlocked(
    guard,
    "task_done",
    "failed creation must not satisfy the completion gate",
  );

  expectAllowed(
    guard,
    "create_file",
    "second creation attempt should be allowed",
  );
  guard.recordResult("create_file", false, { path: "test.html" });

  expectBlocked(
    guard,
    "task_done",
    "verification is still required after creation",
  );

  expectAllowed(
    guard,
    "read_file",
    "verification should be allowed",
  );
  guard.recordResult("read_file", false, { path: "test.html" });

  expectAllowed(
    guard,
    "task_done",
    "task_done should be allowed after successful creation and verification",
  );
}

{
  const guard = createNovaGuard("Run a command.");
  expectAllowed(guard, "run_command", "first command", { command: "node", args: ["1"] });
  expectAllowed(guard, "run_command", "second command", { command: "node", args: ["2"] });
  expectAllowed(guard, "run_command", "third command", { command: "node", args: ["3"] });
  expectAllowed(guard, "run_command", "fourth command", { command: "node", args: ["4"] });
  expectBlocked(guard, "run_command", "fifth command must hit the command budget", { command: "node", args: ["5"] });
}

{
  const guard = createNovaGuard("Inspect the workspace.");
  const same = call("workspace_status", "same", { path: "same" });
  assert.equal(guard.beforeToolCall(same).block, false);
  assert.equal(guard.beforeToolCall(same).block, false);
  assert.equal(
    guard.beforeToolCall(same).block,
    true,
    "third identical call must be blocked",
  );
}

console.log("NOVA guard self-test passed.");
