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
  assert.equal(studio.normalizeStyle({ ...defaultStyle, font: "x".repeat(129) }), null);
  assert.equal(studio.normalizeStyle({ ...defaultStyle, fillColor: [1, 1, 2] }), null);
  assert.equal(studio.normalizeStyle({ ...defaultStyle, animation: "execute_script" }), null);
  assert.equal(studio.normalizeStyle({ ...defaultStyle, positionY: 0.99 }), null);
});

test("long caption fitting chooses one shared font size for every caption", () => {
  const segments = [{ text: "Short", start: 0, end: 1 }, { text: "A much longer caption that defines the batch fit and leaves less safe width for every caption", start: 1, end: 2 }];
  const result = studio.fitStyle(defaultStyle, segments, 1920);
  assert.equal(result.ok, true);
  assert.ok(result.style.fontSize < defaultStyle.fontSize);
  assert.equal(result.style.fontSize, Math.round((1920 * 0.9 / (segments[1].text.length * 0.56)) * 10) / 10);
  assert.equal(result.longestCaptionLength, segments[1].text.length);
  assert.equal(studio.fitStyle(defaultStyle, [{ text: "x".repeat(140) }], 720).ok, false);
});

test("color conversion round trips palette values", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(studio.fromHex("#62e6f5"))), [98 / 255, 230 / 255, 245 / 255]);
  assert.equal(studio.toHex([98 / 255, 230 / 255, 245 / 255]), "#62e6f5");
  assert.equal(studio.fromHex("not-a-color"), null);
});
