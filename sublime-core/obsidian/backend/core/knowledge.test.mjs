import test from "node:test";
import assert from "node:assert/strict";
import "../../frontend/knowledge.js";
import { planObsidianCommand, isExecutablePlan } from "./planner.mjs";

const knowledge = globalThis.OBSIDIANKnowledge;

test("knowledge library has a version, concepts, answers, and safety guardrails", () => {
  assert.match(knowledge.version, /^\d+\.\d+\.\d+$/);
  assert.ok(knowledge.concepts.length >= 8);
  assert.ok(knowledge.answers.length >= 10);
  assert.ok(knowledge.creativeGuides.length >= 6);
  assert.ok(knowledge.guardrails.length >= 4);

  for (const answer of knowledge.answers) {
    assert.ok(answer.id, "every answer needs a stable id");
    assert.ok(Array.isArray(answer.cues) && answer.cues.length > 0, answer.id);
    assert.ok(typeof answer.answer === "string" && answer.answer.length > 30, answer.id);
  }
});

test("knowledge answer IDs and concept IDs are unique", () => {
  const answerIds = knowledge.answers.map((item) => item.id);
  const conceptIds = knowledge.concepts.map((item) => item.id);
  assert.equal(new Set(answerIds).size, answerIds.length);
  assert.equal(new Set(conceptIds).size, conceptIds.length);
  const guideIds = knowledge.creativeGuides.map((item) => item.id);
  assert.equal(new Set(guideIds).size, guideIds.length);
});

const questions = [
  ["What is easing?", /speed changes/i],
  ["How do I make this title pop?", /contrast/i],
  ["What is a keyframe?", /particular time/i],
  ["How does velocity affect animation?", /position changes over time/i],
  ["Explain motion blur.", /moving subject|motion blur/i],
  ["What is parallax?", /different speeds/i],
  ["What is a track matte?", /transparency/i],
  ["What is anticipation in animation?", /preparatory action/i],
  ["How do I improve text readability?", /contrast/i],
];

for (const [question, expected] of questions) {
  test(`answers motion-design question: ${question}`, () => {
    const plan = planObsidianCommand(question);
    assert.equal(plan.status, "knowledge_answer");
    assert.match(plan.answer, expected);
    assert.equal(isExecutablePlan(plan), false);
  });
}

test("knowledge expansion does not turn unsupported edits into executable actions", () => {
  const plan = planObsidianCommand("rebuild this whole video in a premium cinematic style");
  assert.notEqual(plan.status, "planned");
  assert.equal(isExecutablePlan(plan), false);
});
