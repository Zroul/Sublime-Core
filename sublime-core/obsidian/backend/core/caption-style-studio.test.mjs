import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const filename = fileURLToPath(new URL("../../frontend/caption-style-studio.js", import.meta.url));
const sandbox = { globalThis: {} };
vm.runInNewContext(readFileSync(filename, "utf8"), sandbox);
const studio = sandbox.globalThis.OBSIDIANCaptionStyleStudio;

const defaultStyle = {
  version: 1,
  font: "Arial-BoldMT",
  fontSize: 64,
  minFontSize: 20,
  fillColor: [1, 1, 1],
  fillEnabled: true,
  strokeEnabled: true,
  strokeColor: [0, 0, 0],
  strokeWidth: 3,
  alignment: "center",
  positionX: 0.5,
  positionY: 0.86,
  animation: "fade",
  animationDuration: 0.4,
};

test("style normalization keeps only bounded typed styling and animation values", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(studio.normalizeStyle(defaultStyle))), defaultStyle);
  assert.equal(studio.normalizeStyle({ ...defaultStyle, fontSize: 0.1, minFontSize: 0.1 }).fontSize, 0.1);
  assert.equal(studio.normalizeStyle({ ...defaultStyle, fontSize: 1296, minFontSize: 1296 }).fontSize, 1296);
  assert.equal(studio.normalizeStyle({ ...defaultStyle, fontSize: 0.09, minFontSize: 0.09 }), null);
  assert.equal(studio.normalizeStyle({ ...defaultStyle, fontSize: 1296.1 }), null);
  assert.equal(studio.normalizeStyle({ ...defaultStyle, fontSize: 64, minFontSize: 64.1 }), null);
  assert.equal(studio.normalizeStyle({ ...defaultStyle, font: "x".repeat(129) }), null);
  assert.equal(studio.normalizeStyle({ ...defaultStyle, fillColor: [1, 1, 2] }), null);
  assert.equal(studio.normalizeStyle({ ...defaultStyle, animation: "execute_script" }), null);
  assert.equal(studio.normalizeStyle({ ...defaultStyle, positionY: 0.99 }), null);
});

test("caption fitting wraps long text and keeps one shared style for the batch", () => {
  const segments = [{ text: "Short", start: 0, end: 1 }, { text: "A much longer caption that defines the batch fit and leaves less safe width for every caption", start: 1, end: 2 }];
  const originalText = segments[1].text;
  const result = studio.fitStyle(defaultStyle, segments, 1920, 1080);
  assert.equal(result.ok, true);
  assert.equal(result.style.fontSize, defaultStyle.fontSize);
  assert.equal(result.boxWidth, Math.floor(1920 * 0.96));
  assert.equal(result.lineCounts.length, 2);
  assert.ok(result.lineCounts[1] > 1);
  assert.equal(result.longestCaptionLength, segments[1].text.length);
  assert.equal(segments[1].text, originalText);
});

test("caption box width follows available safe composition area for alignment and position", () => {
  const centered = studio.fitStyle(defaultStyle, [{ text: "Centered" }], 1920, 1080);
  const leftAtCenter = studio.fitStyle({ ...defaultStyle, alignment: "left", positionX: 0.5 }, [{ text: "Left" }], 1920, 1080);
  const rightAtCenter = studio.fitStyle({ ...defaultStyle, alignment: "right", positionX: 0.5 }, [{ text: "Right" }], 1920, 1080);
  const leftNearEdge = studio.fitStyle({ ...defaultStyle, alignment: "left", positionX: 0.1 }, [{ text: "Left" }], 1920, 1080);
  const impossible = studio.fitStyle({ ...defaultStyle, alignment: "left", positionX: 0.98 }, [{ text: "Edge" }], 1920, 1080);

  assert.equal(centered.boxWidth, Math.floor(1920 * 0.96));
  assert.equal(leftAtCenter.boxWidth, Math.floor(1920 * 0.48));
  assert.equal(rightAtCenter.boxWidth, Math.floor(1920 * 0.48));
  assert.equal(leftNearEdge.boxWidth, Math.floor(1920 * 0.88));
  assert.equal(impossible.ok, false);
  assert.match(impossible.error, /alignment and position leave no usable composition width/);
});

test("very long complete captions fit by wrapping and gradual shared size reduction", () => {
  const text = "storytelling words matter ".repeat(400);
  const segments = [{ text, start: 0, end: 10 }];
  const result = studio.fitStyle({ ...defaultStyle, minFontSize: 10 }, segments, 1920, 1080);
  assert.equal(result.ok, true);
  assert.ok(result.style.fontSize < defaultStyle.fontSize);
  assert.ok(result.style.fontSize >= 10);
  assert.ok(result.maxLines > 1);
  assert.equal(result.longestCaptionLength, text.length);
  assert.equal(segments[0].text, text);

  const portraitText = "storytelling words matter ".repeat(100);
  const portrait = studio.fitStyle({ ...defaultStyle, minFontSize: 10 }, [{ text: portraitText }], 720, 1280);
  assert.equal(portrait.ok, true);
  const landscape = studio.fitStyle({ ...defaultStyle, minFontSize: 10 }, [{ text: portraitText }], 1920, 1080);
  assert.ok(portrait.style.fontSize < landscape.style.fontSize);
});

test("configured auto-fit floor controls failure and never drops unfit text", () => {
  const text = "caption content ".repeat(400);
  const comfortable = studio.fitStyle({ ...defaultStyle, minFontSize: 10 }, [{ text }], 1920, 1080);
  const constrained = studio.fitStyle({ ...defaultStyle, minFontSize: 20 }, [{ text }], 1920, 1080);
  assert.equal(comfortable.ok, true);
  assert.equal(constrained.ok, false);
  assert.match(constrained.error, /selected auto-fit floor of 20 px/);
  assert.match(constrained.error, /No text was discarded/);
  assert.equal(text, "caption content ".repeat(400));

  const longToken = studio.fitStyle(defaultStyle, [{ text: "x".repeat(500) }], 1920, 1080);
  assert.equal(longToken.ok, false);
  assert.match(longToken.error, /available composition width/);
});

test("a 1,000-caption batch receives one fitted style and keeps every caption", () => {
  const segments = Array.from({ length: 1000 }, (_, index) => ({ text: "Reviewed caption " + index, start: index, end: index + 1 }));
  const fitted = studio.fitStyle(defaultStyle, segments, 1920, 1080);
  assert.equal(fitted.ok, true);
  assert.equal(fitted.lineCounts.length, 1000);
  assert.ok(fitted.lineCounts.every((count) => count === 1));
  assert.equal(segments.length, 1000);
  assert.equal(segments[999].text, "Reviewed caption 999");
});

test("one fitted size covers 1,000 captions without changing their text", () => {
  const segments = Array.from({ length: 1000 }, (_, index) => ({ text: "Caption " + (index + 1), start: index, end: index + 1 }));
  const fitted = studio.fitStyle(defaultStyle, segments, 1920, 1080);
  assert.equal(fitted.ok, true);
  assert.equal(fitted.lineCounts.length, 1000);
  assert.ok(fitted.lineCounts.every((lineCount) => lineCount === 1));
  assert.equal(segments[999].text, "Caption 1000");
});

test("color conversion round trips palette values", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(studio.fromHex("#62e6f5"))), [98 / 255, 230 / 255, 245 / 255]);
  assert.equal(studio.toHex([98 / 255, 230 / 255, 245 / 255]), "#62e6f5");
  assert.equal(studio.fromHex("not-a-color"), null);
});
