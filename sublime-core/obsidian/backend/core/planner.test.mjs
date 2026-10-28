import test from "node:test";
import assert from "node:assert/strict";
import { isExecutablePlan, planObsidianCommand } from "./planner.mjs";

test("maps project inspection to a read-only action", () => {
  assert.equal(planObsidianCommand("inspect the active composition").action, "inspect_project");
});

test("maps selected-layer inspection", () => {
  assert.equal(planObsidianCommand("analyze selected layers").action, "inspect_selection");
});

test("plans only bounded proportional scale changes for the selected layers", () => {
  const up = planObsidianCommand("scale selected layers up by 10%");
  assert.equal(up.action, "scale_selected");
  assert.deepEqual(up.args, { value: 10 });
  assert.equal(isExecutablePlan(up), true);

  const down = planObsidianCommand("reduce the scale of the selection by 12.5%");
  assert.equal(down.action, "scale_selected");
  assert.deepEqual(down.args, { value: -12.5 });
  assert.equal(isExecutablePlan(down), true);

  for (const request of [
    "scale selected layers up by 0%",
    "scale selected layers down by 100%",
    "scale selected layers up by 101%",
    "scale selected layers up by 10% and 20%",
    "scale selected layers by 10%",
    "scale selected layers up",
    "scale selected layers up and down by 10%",
  ]) {
    const plan = planObsidianCommand(request);
    assert.equal(plan.status, "needs_clarification", request);
    assert.equal(isExecutablePlan(plan), false, request);
  }
});

test("parses opacity values and rejects values above 100", () => {
  assert.deepEqual(planObsidianCommand("set opacity to 45%").args, { value: 45 });
  assert.equal(planObsidianCommand("set opacity to 140%").status, "needs_clarification");
});

test("validates the complete opacity value without truncating or clamping it", () => {
  assert.equal(planObsidianCommand("set opacity to 1000%").status, "needs_clarification");
  assert.equal(planObsidianCommand("set opacity to -5%").status, "needs_clarification");
  assert.equal(planObsidianCommand("set opacity to 42.5%").args.value, 42.5);
  assert.equal(planObsidianCommand("set opacity to 42.5 9%").status, "needs_clarification");
  assert.equal(planObsidianCommand("set opacity").status, "needs_clarification");
});

test("recognized cinematic and neon Glow presets become executable plans", () => {
  const cinematic = planObsidianCommand("add a subtle cinematic glow");
  const neon = planObsidianCommand("add a bold neon bloom");
  assert.equal(cinematic.status, "planned");
  assert.equal(cinematic.action, "add_glow");
  assert.deepEqual(cinematic.args, { profile: "cinematic" });
  assert.equal(neon.status, "planned");
  assert.equal(neon.action, "add_glow");
  assert.deepEqual(neon.args, { profile: "attention" });
  assert.equal(isExecutablePlan(cinematic), true);
  assert.equal(isExecutablePlan(neon), true);
});

test("unspecified Glow requests ask for a profile and do not execute", () => {
  const plan = planObsidianCommand("add glow");
  assert.equal(plan.status, "needs_clarification");
  assert.deepEqual(plan.options, ["cinematic", "attention"]);
  assert.equal(isExecutablePlan(plan), false);
});

test("custom Glow parameter changes are not silently converted to presets", () => {
  const plan = planObsidianCommand("set neon bloom radius to 50");
  assert.equal(plan.status, "needs_clarification");
  assert.equal(isExecutablePlan(plan), false);
  assert.match(plan.question, /custom Glow parameter tuning is not supported/i);
});

test("uses knowledge cues for common visual language", () => {
  assert.equal(planObsidianCommand("give this title a dreamy bloom").args.profile, "cinematic");
  assert.equal(planObsidianCommand("make this title pop").args.profile, "attention");
});

test("answers basic motion-design questions without executing an edit", () => {
  const easing = planObsidianCommand("What is easing?");
  assert.equal(easing.status, "knowledge_answer");
  assert.match(easing.answer, /speed changes/i);
  assert.equal(isExecutablePlan(easing), false);

  const title = planObsidianCommand("How do I make this title pop?");
  assert.equal(title.status, "knowledge_answer");
  assert.match(title.answer, /contrast/i);
});

test("asks when Glow style cues conflict", () => {
  assert.equal(planObsidianCommand("add subtle but flashy dramatic glow").status, "needs_clarification");
});

test("explicit Glow removal becomes an executable host-verified plan", () => {
  const plan = planObsidianCommand("remove glow");
  assert.equal(plan.status, "planned");
  assert.equal(plan.action, "remove_glow");
  assert.equal(isExecutablePlan(plan), true);
});

test("turns a vibe request into a non-executable creative direction plan", () => {
  const plan = planObsidianCommand("Give this footage neon lighting like a dream city");
  assert.equal(plan.status, "style_plan");
  assert.equal(plan.recipe.id, "neon_dream_city");
  assert.equal(isExecutablePlan(plan), false);
  assert.equal(plan.executable, false);
  assert.equal(plan.readiness, "PROPOSED");
  assert.match(plan.explanation, /not an executed/i);
});

test("routes story-driven color requests to an input-aware non-executable plan", () => {
  const plan = planObsidianCommand("Use color to show emotional change across the story");
  assert.equal(plan.status, "style_plan");
  assert.equal(plan.recipe.id, "narrative_color_arc");
  assert.ok(plan.recipe.prerequisites.some((item) => /scene order/i.test(item)));
  assert.equal(plan.readiness, "PROPOSED");
  assert.equal(isExecutablePlan(plan), false);
});

test("does not treat unsupported natural language as executable", () => {
  const plan = planObsidianCommand("make this look like a premium SaaS ad");
  assert.equal(plan.status, "unsupported");
  assert.equal(isExecutablePlan(plan), false);
});

test("only approved actions are executable", () => {
  assert.equal(isExecutablePlan({ status: "planned", action: "add_glow" }), false);
  assert.equal(isExecutablePlan({ status: "planned", action: "add_glow", args: { profile: "cinematic" } }), true);
  assert.equal(isExecutablePlan({ status: "planned", action: "add_glow", args: { profile: "unspecified" } }), false);
  assert.equal(isExecutablePlan({ status: "planned", action: "remove_glow" }), true);
  assert.equal(isExecutablePlan({ status: "planned", action: "fade_in" }), true);
  assert.equal(isExecutablePlan({ status: "planned", action: "scale_selected" }), true);
  assert.equal(isExecutablePlan({ status: "planned", action: "run_shell" }), false);
});

test("plans a guarded fade-in from natural language", () => {
  assert.equal(planObsidianCommand("apply a fade up").action, "fade_in");
  assert.match(planObsidianCommand("apply a fade up").explanation, /existing opacity animation/i);
});

test("does not pretend to judge text readability from pixels", () => {
  const plan = planObsidianCommand("make this text more readable");
  assert.equal(plan.status, "needs_clarification");
  assert.equal(isExecutablePlan(plan), false);
});

test("style cues require whole words rather than matching inside unrelated words", () => {
  assert.equal(planObsidianCommand("add a popular glow").status, "needs_clarification");
  assert.equal(planObsidianCommand("add a software glow").status, "needs_clarification");
});
