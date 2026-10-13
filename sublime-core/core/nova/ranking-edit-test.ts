import assert from "node:assert/strict";
import { createRankingEditPlan, toRankingRenderInput } from "./ranking-edit.js";

const plan = createRankingEditPlan({
  title: "Cats Losing Their Minds",
  targetSeconds: 30,
  clips: [
    { id: "bath-1", path: "assets/cats/bath-1.mp4", category: "bath", durationSeconds: 12 },
    { id: "angry-2", path: "assets/cats/angry-2.mp4", category: "angry", durationSeconds: 8 },
    { id: "vet-3", path: "assets/cats/vet-3.mp4", category: "vet", durationSeconds: 15 },
  ],
});

assert.equal(plan.type, "nova_ranking_edit_v1");
assert.equal(plan.narration, false);
assert.equal(plan.title, "Cats Losing Their Minds");
assert.equal(plan.segments.length, 3);
assert.deepEqual(plan.segments.map((segment) => segment.rank), [3, 2, 1]);
assert.deepEqual(plan.segments.map((segment) => segment.durationSeconds), [11, 8, 11]);
assert.deepEqual(plan.segments.map((segment) => segment.sourceEndSeconds), [11, 8, 11]);
assert.equal(plan.segments[0].soundCue, "hook_pop");
assert.equal(plan.segments[1].soundCue, "none");
assert.equal(plan.segments[2].soundCue, "rank_sting");
assert.equal(plan.segments.at(-1)?.endSeconds, 30);

assert.equal(plan.segments[0].onScreenLabel, "#3 BATH TIME");

const renderInput = toRankingRenderInput(plan, "ranking-test", "nova/jobs/ranking-test/final.mp4");
assert.equal(renderInput.action, "render");
assert.equal(renderInput.id, "ranking-test");
assert.equal(renderInput.aspect_ratio, "9:16");
const renderScenes = renderInput.scenes as Array<Record<string, unknown>>;
assert.equal(renderScenes.length, 3);
assert.equal(renderScenes[0].asset_path, "assets/cats/bath-1.mp4");
assert.equal(renderScenes[0].asset_media_type, "video");
assert.equal(renderScenes[0].text, "#3 BATH TIME");
assert.equal(renderScenes[0].duration, 11);
assert.deepEqual(renderInput.sound_cues, [
  { kind: "hook_pop", at_seconds: 0 },
  { kind: "rank_sting", at_seconds: 19 },
]);
assert.throws(() => toRankingRenderInput({
  ...plan,
  segments: [{ ...plan.segments[0], path: "../../outside.mp4" }],
}, "ranking-test", "final.mp4"), /inside workspace\/assets/);
assert.throws(() => toRankingRenderInput(plan, "", "final.mp4"), /non-empty job id/);


const redistributed = createRankingEditPlan({
  targetSeconds: 20,
  clips: [
    { id: "short", path: "short.mp4", category: "funny", durationSeconds: 2 },
    { id: "long-a", path: "long-a.mp4", category: "other", durationSeconds: 15 },
    { id: "long-b", path: "long-b.mp4", category: "angry", durationSeconds: 15 },
  ],
});
assert.deepEqual(redistributed.segments.map((segment) => segment.durationSeconds), [2, 9, 9]);
assert.ok(redistributed.segments.every((segment) => segment.sourceEndSeconds <= segment.sourceDurationSeconds));
assert.equal(redistributed.segments.at(-1)?.endSeconds, 20);

const scoredPlan = createRankingEditPlan({
  targetSeconds: 9,
  clips: [
    { id: "best", path: "assets/best.mp4", category: "funny", durationSeconds: 5, entertainmentScore: 90 },
    { id: "least", path: "assets/least.mp4", category: "other", durationSeconds: 5, entertainmentScore: 10 },
    { id: "middle", path: "assets/middle.mp4", category: "angry", durationSeconds: 5, entertainmentScore: 50 },
  ],
});
assert.deepEqual(scoredPlan.segments.map((segment) => segment.clipId), ["least", "middle", "best"]);
assert.deepEqual(scoredPlan.segments.map((segment) => segment.entertainmentScore), [10, 50, 90]);
assert.match(scoredPlan.notes[0], /sorted from least to most entertaining/);
assert.throws(() => createRankingEditPlan({
  targetSeconds: 9,
  clips: [
    { id: "scored", path: "a.mp4", category: "funny", durationSeconds: 5, entertainmentScore: 80 },
    { id: "unscored", path: "b.mp4", category: "other", durationSeconds: 5 },
  ],
}), /for every clip or for none/);
assert.throws(() => createRankingEditPlan({
  targetSeconds: 3,
  clips: [{ id: "invalid-score", path: "a.mp4", category: "funny", durationSeconds: 3, entertainmentScore: 101 }],
}), /between 1 and 100/);

assert.throws(() => createRankingEditPlan({ clips: [], targetSeconds: 30 }), /at least one/);
assert.throws(() => createRankingEditPlan({
  targetSeconds: 30,
  clips: [
    { id: "same", path: "a.mp4", category: "funny", durationSeconds: 15 },
    { id: "same", path: "b.mp4", category: "other", durationSeconds: 15 },
  ],
}), /Duplicate/);
assert.throws(() => createRankingEditPlan({
  targetSeconds: 0,
  clips: [{ id: "x", path: "x.mp4", category: "other", durationSeconds: 3 }],
}), /duration/);
assert.throws(() => createRankingEditPlan({
  targetSeconds: 30,
  clips: [{ id: "x", path: "x.mp4", category: "other", durationSeconds: 0 }],
}), /positive duration/);
assert.throws(() => createRankingEditPlan({
  targetSeconds: 30,
  clips: [{ id: "short", path: "short.mp4", category: "funny", durationSeconds: 5 }],
}), /not contain enough usable footage/);
assert.throws(() => createRankingEditPlan({
  targetSeconds: 3,
  clips: [{ id: "bad-category", path: "bad.mp4", category: "surprise", durationSeconds: 3 } as never],
}), /unsupported category/);

console.log("NOVA ranking edit planner tests passed.");
