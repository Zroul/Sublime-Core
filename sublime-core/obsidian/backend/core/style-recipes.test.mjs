import test from "node:test";
import assert from "node:assert/strict";
import "../frontend/style-recipes.js";

const recipes = globalThis.OBSIDIANStyleRecipes;

test("style recipe library has unique stable IDs and useful direction", () => {
  const all = recipes.list();
  assert.ok(all.length >= 4);
  const ids = all.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of all) {
    assert.ok(item.name);
    assert.ok(item.cues.length);
    assert.ok(item.look);
    assert.ok(item.cautions.length);
  }
});

test("interprets neon dream city as a creative direction plan", () => {
  const plan = recipes.planStyle("Give it neon lighting like it's in a dream city");
  assert.equal(plan.status, "style_plan");
  assert.equal(plan.recipe.id, "neon_dream_city");
  assert.ok(plan.recipe.look.palette.includes("cyan"));
  assert.equal(plan.executable, false);
});

test("does not confuse partial words with style cues", () => {
  assert.equal(recipes.planStyle("make it retroactive").status, "unsupported");
});

test("asks for clarification when style cues conflict", () => {
  const plan = recipes.planStyle("make it cinematic but cyberpunk neon");
  assert.equal(plan.status, "needs_clarification");
  assert.equal(plan.executable, false);
});

test("unknown style requests are not executable", () => {
  const plan = recipes.planStyle("make it like a moon made of glass");
  assert.equal(plan.status, "unsupported");
  assert.equal(plan.executable, false);
});
