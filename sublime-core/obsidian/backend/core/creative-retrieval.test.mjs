import test from "node:test";
import assert from "node:assert/strict";
import { formatCreativeGuides, retrieveCreativeGuides } from "../knowledge/creative-retrieval.mjs";

test("creative retrieval returns compact, relevant editing principles", () => {
  const guides = retrieveCreativeGuides("Improve the pacing and storytelling; trim repetitive shots", 2);
  assert.equal(guides.length, 1);
  assert.equal(guides[0].id, "story_pacing");
  assert.ok(guides[0].principles.length <= 3);
  assert.ok(guides[0].cautions.length <= 1);
  const promptSection = formatCreativeGuides(guides);
  assert.match(promptSection, /Pacing and storytelling/);
  assert.match(promptSection, /shot duration/i);
  assert.ok(promptSection.length < 1_000);
});

test("creative retrieval ranks specific guides and caps injected material", () => {
  const guides = retrieveCreativeGuides("Improve caption typography readability and safe margins", 50);
  assert.equal(guides.length, 1);
  assert.equal(guides[0].id, "typography_and_captions");
  assert.deepEqual(retrieveCreativeGuides("unrelated request", 2), []);
});
