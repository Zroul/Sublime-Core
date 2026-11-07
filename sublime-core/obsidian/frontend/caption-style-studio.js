/* Bounded, deterministic caption style validation and fitting shared with the planner. */
(function (root) {
  "use strict";

  var ANIMATIONS = ["none", "fade", "pop", "smooth_scale", "slide", "typewriter", "word_emphasis"];
  var ALIGNMENTS = ["left", "center", "right"];
  /* Match After Effects TextDocument.fontSize's supported pixel range. */
  var MIN_FONT_SIZE = 0.1;
  var MAX_FONT_SIZE = 1296;

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

  function characterWidthUnits(character) {
    if (/\s/.test(character)) return 0.32;
    if (/[ilI1|!.,'`:;]/.test(character)) return 0.31;
    if (/[MW@#%&]/.test(character)) return 0.88;
    var code = character.charCodeAt(0);
    if (code > 255) return 0.96;
    if (/[A-Z0-9]/.test(character)) return 0.66;
    return 0.55;
  }

  function prepareCaptionWords(text) {
    var words = String(text || "").trim().split(/\s+/);
    if (!words.length || !words[0]) return [];
    return words.map(function (word) {
      var units = 0;
      for (var i = 0; i < word.length; i++) units += characterWidthUnits(word.charAt(i));
      return units;
    });
  }

  function wrappedLineCount(words, width, fontSize) {
    var capacity = width / fontSize;
    var lines = 1;
    var used = 0;
    for (var i = 0; i < words.length; i++) {
      if (words[i] > capacity + 0.001) return { ok: false, lines: lines, reason: "word_width" };
      var next = used ? used + 0.32 + words[i] : words[i];
      if (used && next > capacity) {
        lines++;
        used = words[i];
      } else {
        used = next;
      }
    }
    return { ok: true, lines: lines };
  }

  function availableCaptionWidth(compWidth, positionX, alignment) {
    var left = Number(compWidth) * Number(positionX);
    var right = Number(compWidth) * (1 - Number(positionX));
    var safeMargin = Number(compWidth) * 0.02;
    if (alignment === "left") return Math.floor(right - safeMargin);
    if (alignment === "right") return Math.floor(left - safeMargin);
    return Math.floor(2 * Math.min(left - safeMargin, right - safeMargin));
  }

  /* Fit the complete batch as one style, wrapping at word boundaries before reducing size. */
  function fitStyle(style, segments, compWidth, compHeight) {
    var normalized = normalizeStyle(style);
    var width = Number(compWidth);
    var height = Number(compHeight);
    if (!isFinite(height) || height <= 0) height = width * 9 / 16;
    if (!normalized || !Array.isArray(segments) || !isFinite(width) || width <= 0 || !isFinite(height) || height <= 0) {
      return { ok: false, error: "Caption style or composition dimensions are invalid." };
    }
    var captions = [];
    var longest = 0;
    var failureIndex = -1;
    var failureReason = "";
    for (var i = 0; i < segments.length; i++) {
      var text = segments[i] && typeof segments[i].text === "string" ? segments[i].text : "";
      var words = prepareCaptionWords(text);
      if (!words.length) return { ok: false, error: "Caption " + (i + 1) + " has no text to fit." };
      longest = Math.max(longest, text.length);
      captions.push(words);
    }
    if (!captions.length) return { ok: false, error: "No caption text is available for style fitting." };

    var boxWidth = availableCaptionWidth(width, normalized.positionX, normalized.alignment);
    var availableHeight = Math.floor(Math.min(height * 0.38, height * (normalized.positionY >= 0.5 ? normalized.positionY - 0.02 : 0.98 - normalized.positionY)));
    if (boxWidth <= 0) return { ok: false, error: "The selected caption alignment and position leave no usable composition width." };
    function fitsAt(fontSize) {
      var lineCounts = [];
      var maxLines = 0;
      for (var captionIndex = 0; captionIndex < captions.length; captionIndex++) {
        var wrapped = wrappedLineCount(captions[captionIndex], boxWidth, fontSize);
        if (!wrapped.ok || wrapped.lines * fontSize * 1.2 > availableHeight + 0.01) {
          failureIndex = captionIndex;
          failureReason = wrapped.reason || "height";
          return null;
        }
        lineCounts.push(wrapped.lines);
        maxLines = Math.max(maxLines, wrapped.lines);
      }
      return { lineCounts: lineCounts, maxLines: maxLines };
    }

    var minimumFit = fitsAt(normalized.minFontSize);
    if (!minimumFit) {
      var reason = failureReason === "word_width" ? "A word in caption " + (failureIndex + 1) + " exceeds the available composition width" :
        "Caption " + (failureIndex + 1) + " exceeds the available composition height";
      return {
        ok: false,
        error: reason + " at the selected auto-fit floor of " + normalized.minFontSize + " px. Increase the composition area, move the caption position, or lower the auto-fit floor. No text was discarded."
      };
    }

    var fittedSize = normalized.fontSize;
    var fitted = fitsAt(fittedSize);
    if (!fitted) {
      var low = normalized.minFontSize;
      var high = normalized.fontSize;
      for (var iteration = 0; iteration < 20; iteration++) {
        var middle = (low + high) / 2;
        if (fitsAt(middle)) low = middle;
        else high = middle;
      }
      fittedSize = Math.max(normalized.minFontSize, Math.floor(low * 10) / 10);
      fitted = fitsAt(fittedSize) || minimumFit;
    }
    normalized.fontSize = fittedSize;
    return {
      ok: true,
      style: normalized,
      longestCaptionLength: longest,
      boxWidth: boxWidth,
      boxHeight: availableHeight,
      maxLines: fitted.maxLines,
      lineCounts: fitted.lineCounts,
      verticalAnchor: normalized.positionY >= 0.5 ? "bottom" : "top"
    };
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
