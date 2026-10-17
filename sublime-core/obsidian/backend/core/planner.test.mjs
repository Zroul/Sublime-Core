import test from "node:test";
import assert from "node:assert/strict";
import { isExecutablePlan, planObsidianCommand } from "./planner.mjs";

test("maps project inspection to a read-only action", () => {
  assert.equal(planObsidianCommand("inspect the active composition").action, "inspect_project");
});

test("maps selected-layer inspection", () => {
  assert.equal(planObsidianCommand("analyze selected layers").action, "inspect_selection");
});

test("parses opacity values and rejects values above 100", () => {
  assert.deepEqual(planObsidianCommand("set opacity to 45%").args, { value: 45 });
  assert.equal(planObsidianCommand("set opacity to 140%").status, "needs_clarification");
});

test("distinguishes cinematic and attention glow requests without claiming calibrated execution", () => {
  assert.equal(planObsidianCommand("add a subtle cinematic glow").args.profile, "cinematic");
  assert.equal(planObsidianCommand("add a bold attention-grabbing glow").args.profile, "attention");
  assert.match(planObsidianCommand("add a subtle cinematic glow").explanation, /proposal—not a claim/i);
});

test("asks when glow style cues conflict", () => {
  assert.equal(planObsidianCommand("add subtle but flashy dramatic glow").status, "needs_clarification");
});

test("does not treat unsupported natural language as executable", () => {
  const plan = planObsidianCommand("make this look like a premium SaaS ad");
  assert.equal(plan.status, "unsupported");
  assert.equal(isExecutablePlan(plan), false);
});

test("only approved actions are executable", () => {
  assert.equal(isExecutablePlan({ status: "planned", action: "add_glow" }), true);
  assert.equal(isExecutablePlan({ status: "planned", action: "run_shell" }), false);
});
