const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const context = { globalThis: null };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../../frontend/creative-recipes.js"), "utf8"),
  context,
  { filename: "creative-recipes.js" }
);
const recipes = context.OBSIDIANCreativeRecipes;

test("implemented recipes declare ordered operations, bounds, verification, and failure handling", () => {
  const ids = ["cinematic_glow", "dark_dramatic", "high_contrast", "gentle_entrance"];
  for (const id of ids) {
    const recipe = recipes.getRecipe(id);
    assert.equal(recipe.status, "IMPLEMENTED", id);
    assert.deepEqual(
      Array.from(recipe.operations, (operation) => operation.order),
      Array.from(recipe.operations, (_, index) => index + 1),
      id
    );
    assert.ok(recipe.requiredInputs.length > 0, id);
    assert.ok(recipe.compatibility.length > 0, id);
    assert.ok(recipe.parameterBounds, id);
    assert.ok(recipe.operations.every((operation) => operation.verification), id);
    assert.match(recipe.failureHandling, /preflight/i, id);
  }
  assert.deepEqual([
    recipes.getRecipe("dark_dramatic").operations[0].parameters.brightness,
    recipes.getRecipe("dark_dramatic").operations[0].parameters.contrast,
  ], [-12, 14]);
  assert.deepEqual([
    recipes.getRecipe("high_contrast").operations[0].parameters.brightness,
    recipes.getRecipe("high_contrast").operations[0].parameters.contrast,
  ], [0, 20]);
  assert.equal(recipes.isExecutableRecipe("run_shell"), false);
});

test("creative recipe matching uses whole phrases and preserves unsupported looks", () => {
  assert.equal(recipes.planCreativeRecipe("make a gentle title entrance").id, "gentle_entrance");
  assert.equal(recipes.planCreativeRecipe("give me a dark and dramatic look").id, "dark_dramatic");
  assert.equal(recipes.planCreativeRecipe("make it high contrast").id, "high_contrast");
  assert.equal(recipes.planCreativeRecipe("cinematic glow look").id, "cinematic_glow");
  assert.equal(recipes.planCreativeRecipe("a genteel entrance"), null);
  assert.equal(recipes.planCreativeRecipe("make it cinematic"), null);
  assert.equal(recipes.planCreativeRecipe("complete neon treatment"), null);
});
