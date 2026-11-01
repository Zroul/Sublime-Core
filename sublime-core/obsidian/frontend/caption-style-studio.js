/* Bounded, deterministic caption style validation and fitting shared with the planner. */
(function (root) {
  "use strict";

  var ANIMATIONS = ["none", "fade", "pop", "smooth_scale", "slide", "typewriter", "word_emphasis"];
  var ALIGNMENTS = ["left", "center", "right"];
  var MIN_FONT_SIZE = 10;
  var MAX_FONT_SIZE = 180;

  function color(value) {
    if (!Array.isArray(value) || value.length !== 3) return null;
    var result = value.map(Number);
    return result.every(function (channel) { return isFinite(channel) && channel >= 0 && channel <= 1; }) ? result : null;
  }

  function normalizeStyle(style) {
    if (!style || typeof style !== "object" || Array.isArray(style) || Number(style.version) !== 1) return null;
    var font = String(style.font || "").trim();
    var fontSize = Number(style.fontSize);
    var minFontSize = Number(style.minFontSize);
    var fillColor = color(style.fillColor);
    var strokeColor = color(style.strokeColor);
    var strokeWidth = Number(style.strokeWidth);
    var positionX = Number(style.positionX);
    var positionY = Number(style.positionY);
    var duration = Number(style.animationDuration);
    if (!font || font.length > 128 || !isFinite(fontSize) || fontSize < MIN_FONT_SIZE || fontSize > MAX_FONT_SIZE ||
        !isFinite(minFontSize) || minFontSize < MIN_FONT_SIZE || minFontSize > fontSize ||
        !fillColor || !strokeColor || typeof style.fillEnabled !== "boolean" || typeof style.strokeEnabled !== "boolean" ||
        !isFinite(strokeWidth) || strokeWidth < 0 || strokeWidth > 20 ||
        ALIGNMENTS.indexOf(style.alignment) === -1 ||
        !isFinite(positionX) || positionX < 0.02 || positionX > 0.98 ||
        !isFinite(positionY) || positionY < 0.02 || positionY > 0.98 ||
        ANIMATIONS.indexOf(style.animation) === -1 || !isFinite(duration) || duration < 0.08 || duration > 2) return null;
    return {
      version: 1,
      font: font,
      fontSize: fontSize,
      minFontSize: minFontSize,
      fillColor: fillColor,
      fillEnabled: style.fillEnabled,
      strokeEnabled: style.strokeEnabled,
      strokeColor: strokeColor,
      strokeWidth: strokeWidth,
      alignment: style.alignment,
      positionX: positionX,
      positionY: positionY,
      animation: style.animation,
      animationDuration: duration
    };
  }

  /* One batch-wide size is chosen from its longest caption so layer styling stays uniform. */
  function fitStyle(style, segments, compWidth) {
    var normalized = normalizeStyle(style);
    var width = Number(compWidth);
    if (!normalized || !Array.isArray(segments) || !isFinite(width) || width <= 0) {
      return { ok: false, error: "Caption style or composition width is invalid." };
    }
    var longest = 0;
    for (var i = 0; i < segments.length; i++) {
      var text = segments[i] && typeof segments[i].text === "string" ? segments[i].text : "";
      longest = Math.max(longest, text.length);
    }
    if (!longest) return { ok: false, error: "No caption text is available for style fitting." };
    var fittedSize = Math.min(normalized.fontSize, (width * 0.9) / (longest * 0.56));
    if (fittedSize < normalized.minFontSize) {
      return { ok: false, error: "The longest caption cannot fit the composition at the approved minimum font size. Shorten the caption text or lower the minimum size." };
    }
    normalized.fontSize = Math.round(fittedSize * 10) / 10;
    return { ok: true, style: normalized, longestCaptionLength: longest };
  }

  function fromHex(hex) {
    var value = String(hex || "").trim();
    var match = value.match(/^#?([0-9a-f]{6})$/i);
    if (!match) return null;
    return [0, 2, 4].map(function (offset) {
      return parseInt(match[1].slice(offset, offset + 2), 16) / 255;
    });
  }

  function toHex(rgb) {
    var normalized = color(rgb);
    if (!normalized) return null;
    return "#" + normalized.map(function (channel) {
      var value = Math.round(channel * 255).toString(16);
      return value.length < 2 ? "0" + value : value;
    }).join("");
  }

  root.OBSIDIANCaptionStyleStudio = {
    ANIMATIONS: ANIMATIONS.slice(),
    ALIGNMENTS: ALIGNMENTS.slice(),
    normalizeStyle: normalizeStyle,
    fitStyle: fitStyle,
    fromHex: fromHex,
    toHex: toHex
  };
}(typeof globalThis !== "undefined" ? globalThis : this));
