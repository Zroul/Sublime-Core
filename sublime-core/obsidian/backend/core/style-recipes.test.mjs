import test from "node:test";
import assert from "node:assert/strict";
import "../../frontend/style-recipes.js";

const recipes = globalThis.OBSIDIANStyleRecipes;
const validReadiness = new Set(["IMPLEMENTED", "PROPOSED", "BLOCKED", "REQUIRES_INPUT"]);

test("library contains 30 distinct production-shaped creative recipes", () => {
  const all = recipes.list();
  assert.equal(all.length, 30);
  const ids = all.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);

  for (const item of all) {
    assert.ok(item.name, item.id);
    assert.ok(item.category, item.id);
    assert.ok(item.intent.length, item.id);
    assert.ok(item.cues.length, item.id);
    assert.ok(Object.keys(item.parameters).length, item.id);
    assert.ok(item.prerequisites.length, item.id);
    assert.ok(item.compatibility, item.id);
    assert.ok(item.fallback, item.id);
    assert.equal(item.executionReadiness, "PROPOSED", item.id);
    assert.ok(item.steps.length >= 3, item.id);
    assert.deepEqual(item.steps.map((entry) => entry.order), item.steps.map((_, index) => index + 1), item.id);
    for (const entry of item.steps) assert.ok(validReadiness.has(entry.status), `${item.id}: ${entry.status}`);
  }
});

test("covers all requested creative families", () => {
  const categories = new Set(recipes.list().map((item) => item.category));
  for (const category of ["cinematic_film", "neon_cyberpunk", "horror_dark", "anime_energetic", "dreamy_ethereal", "typography_motion"]) {
    assert.ok(categories.has(category), category);
  }
});

test("matches specific looks and returns non-executable recipe plans", () => {
  const examples = [
    ["Give it a restrained cinematic film look", "cinematic_film"],
    ["Make this a neon dream city", "neon_dream_city"],
    ["Give the scene an analog horror look", "analog_horror"],
    ["Build shonen anime energy", "shonen_energy"],
    ["Use a pastel daydream palette", "pastel_daydream"],
    ["Plan a match cut transition", "match_cut_transition"],
  ];
  for (const [command, id] of examples) {
    const plan = recipes.planStyle(command);
    assert.equal(plan.status, "style_plan", command);
    assert.equal(plan.recipe.id, id, command);
    assert.equal(plan.executable, false);
    assert.equal(plan.readiness, "PROPOSED");
  }
});

test("normalizes whitespace and punctuation while keeping whole-word matching", () => {
  assert.equal(recipes.planStyle("Give it a neon   dream city!").recipe.id, "neon_dream_city");
  assert.equal(recipes.planStyle("make it retroactive").status, "unsupported");
});

test("asks for clarification when distinct looks are combined", () => {
  const plan = recipes.planStyle("make it cinematic but cyberpunk neon");
  assert.equal(plan.status, "needs_clarification");
  assert.ok(plan.options.includes("cinematic_film"));
  assert.ok(plan.options.includes("neon_dream_city"));
  assert.equal(plan.executable, false);
});

test("does not make up a recipe for unsupported descriptions", () => {
  const plan = recipes.planStyle("make it like a moon made of glass");
  assert.equal(plan.status, "unsupported");
  assert.equal(plan.executable, false);
});
