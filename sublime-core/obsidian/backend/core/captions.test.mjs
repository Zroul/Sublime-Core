import test from "node:test";
import assert from "node:assert/strict";
import { isExecutablePlan, planCaptionCreation, planObsidianCommand } from "./planner.mjs";

const source = {
  path: "C:/local/clip.mp4",
  layerName: "Interview",
  layerId: "42",
  layerIndex: 1,
  inPoint: 0,
  outPoint: 5,
  startTime: 0,
  stretch: 100,
  frameRate: 30,
  compName: "Interview edit",
  compDuration: 5,
  compWidth: 1920,
  compHeight: 1080,
};

test("caption requests open a review workflow without creating an executable host edit", () => {
  const phrase = planObsidianCommand("Generate captions for this video");
  const word = planObsidianCommand("Make captions appear word by word");
  assert.equal(phrase.status, "caption_workflow");
  assert.equal(phrase.captionMode, "phrase");
  assert.equal(word.status, "caption_workflow");
  assert.equal(word.captionMode, "word");
  assert.equal(isExecutablePlan(phrase), false);
});

test("caption source inspection is a typed read-only planner action", () => {
  const plan = planObsidianCommand("inspect caption source for selected footage");
  assert.equal(plan.status, "planned");
  assert.equal(plan.action, "inspect_caption_source");
  assert.equal(isExecutablePlan(plan), true);
});

test("local word timestamps map to readable phrase captions and editable SRT", () => {
  const transcript = {
    segments: [{
      text: "Hello there. How are you?",
      start: 0.1,
      end: 1.9,
      words: [
        { text: "Hello", start: 0.1, end: 0.4 },
        { text: "there.", start: 0.4, end: 0.8 },
        { text: "How", start: 1.2, end: 1.3 },
        { text: "are", start: 1.3, end: 1.5 },
        { text: "you?", start: 1.5, end: 1.9 },
      ],
    }],
  };
  const phrases = globalThis.OBSIDIANCaptions.toCaptionSegments(transcript, source, "phrase", 30);
  assert.equal(phrases.ok, true);
  assert.deepEqual(phrases.segments.map((segment) => segment.text), ["Hello there.", "How are you?"]);
  const srt = globalThis.OBSIDIANCaptions.formatSrt(phrases.segments);
  const edited = srt.replace("Hello there.", "Hello, there.");
  const parsed = globalThis.OBSIDIANCaptions.parseSrt(edited);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.segments[0].text, "Hello, there.");
  assert.equal(parsed.segments[0].start, phrases.segments[0].start);
});

test("word by word captions keep individual timings and map source offset and stretch", () => {
  const timedSource = { ...source, inPoint: 1, startTime: 0, stretch: 50, outPoint: 4 };
  const transcript = { segments: [{
    text: "Keep this",
    start: 2,
    end: 4,
    words: [
      { text: "Keep", start: 2, end: 2.5 },
      { text: "this", start: 2.5, end: 3 },
    ],
  }] };
  const result = globalThis.OBSIDIANCaptions.toCaptionSegments(transcript, timedSource, "word", 30);
  assert.equal(result.ok, true);
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].start, 1);
  assert.equal(result.segments[0].end, 1.2666666666666666);
  assert.equal(result.segments[1].start, result.segments[0].end);
});

test("caption parser rejects overlapping, out of range, and excessive segments", () => {
  const invalid = globalThis.OBSIDIANCaptions.parseSrt("1\n00:00:01,000 --> 00:00:02,000\nCaption");
  assert.equal(invalid.ok, true);
  assert.equal(globalThis.OBSIDIANCaptions.validateSegments([
    { text: "A", start: 1, end: 2 },
    { text: "B", start: 1.9, end: 2.5 },
  ], 5).ok, false);
  assert.equal(globalThis.OBSIDIANCaptions.validateSegments([{ text: "A", start: 0, end: 6 }], 5).ok, false);
  assert.equal(globalThis.OBSIDIANCaptions.validateSegments(
    Array.from({ length: 401 }, (_, index) => ({ text: "A", start: index, end: index + 0.5 })), 500
  ).ok, false);
});

test("planner creates caption edits only from validated timestamps, source identity, and fixed styles", () => {
  const created = planCaptionCreation([{ text: "Reviewed line.", start: 0.2, end: 1.1 }], source, "bold");
  assert.equal(created.action, "create_captions");
  assert.equal(isExecutablePlan(created), true);
  assert.equal(isExecutablePlan({ ...created, args: { ...created.args, style: "glow" } }), false);
  assert.equal(isExecutablePlan({ ...created, args: { ...created.args, segments: [{ text: "bad", start: 0, end: 9 }] } }), false);
  assert.equal(isExecutablePlan({ ...created, args: { ...created.args, source: { ...source, path: "" } } }), false);
  assert.equal(planCaptionCreation([{ text: "Bad time", start: 1.1, end: 0.2 }], source, "clean").status, "needs_clarification");
});
