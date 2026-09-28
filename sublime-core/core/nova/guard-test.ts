import assert from "node:assert/strict";
import { createNovaGuard } from "./guard.js";

function call(name: string, id = name, args: Record<string, unknown> = {}) {
  return { id, name, arguments: args };
}

function expectBlocked(
  guard: ReturnType<typeof createNovaGuard>,
  toolName: string,
  message: string,
) {
  const result = guard.beforeToolCall(call(toolName, message));
  assert.equal(result.block, true, message);
}

function expectAllowed(
  guard: ReturnType<typeof createNovaGuard>,
  toolName: string,
  message: string,
) {
  const result = guard.beforeToolCall(call(toolName, message));
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
  guard.recordResult("create_file", true);

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
  guard.recordResult("create_file", false);

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
  guard.recordResult("read_file", false);

  expectAllowed(
    guard,
    "task_done",
    "task_done should be allowed after successful creation and verification",
  );
}

{
  const guard = createNovaGuard("Run a command.");
  expectAllowed(guard, "run_command", "first command");
  expectAllowed(guard, "run_command", "second command");
  expectAllowed(guard, "run_command", "third command");
  expectAllowed(guard, "run_command", "fourth command");
  expectBlocked(guard, "run_command", "fifth command must hit the command budget");
}

{
  const guard = createNovaGuard("Inspect the workspace.");
  const same = call("workspace_status", "same");
  assert.equal(guard.beforeToolCall(same).block, false);
  assert.equal(guard.beforeToolCall(same).block, false);
  assert.equal(
    guard.beforeToolCall(same).block,
    true,
    "third identical call must be blocked",
  );
}

console.log("NOVA guard self-test passed.");
