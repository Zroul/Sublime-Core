/* Local transcription result shaping and editable SRT parsing for OBSIDIAN. */
(function (root) {
  "use strict";

  var MAX_CAPTIONS = 400;
  var STYLES = ["clean", "bold", "yellow"];

  function timestamp(seconds) {
    var milliseconds = Math.max(0, Math.round(Number(seconds) * 1000));
    var hours = Math.floor(milliseconds / 3600000);
    var minutes = Math.floor(milliseconds / 60000) % 60;
    var wholeSeconds = Math.floor(milliseconds / 1000) % 60;
    var remainder = milliseconds % 1000;
    function pad(value, count) {
      var text = String(value);
      while (text.length < count) text = "0" + text;
      return text;
    }
    return pad(hours, 2) + ":" + pad(minutes, 2) + ":" + pad(wholeSeconds, 2) + "," + pad(remainder, 3);
  }

  function formatSrt(segments) {
    return segments.map(function (segment, index) {
      return (index + 1) + "\n" + timestamp(segment.start) + " --> " + timestamp(segment.end) + "\n" + segment.text;
    }).join("\n\n");
  }

  function parseSrt(value) {
    var source = String(value === undefined || value === null ? "" : value).replace(/\r/g, "").trim();
    if (!source) return { ok: false, error: "The transcript is empty." };
    var blocks = source.split(/\n\s*\n/);
    if (blocks.length > MAX_CAPTIONS) return { ok: false, error: "A maximum of " + MAX_CAPTIONS + " caption segments can be created at once." };
    var segments = [];
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].split("\n");
      var timingIndex = lines.length > 1 && /^\s*\d+\s*$/.test(lines[0]) ? 1 : 0;
      var timing = lines[timingIndex] && lines[timingIndex].match(/^\s*(\d{2,}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{2,}):(\d{2}):(\d{2})[,.](\d{1,3})\s*$/);
      if (!timing) return { ok: false, error: "Caption " + (i + 1) + " needs an SRT time range (HH:MM:SS,mmm --> HH:MM:SS,mmm)." };
      var start = Number(timing[1]) * 3600 + Number(timing[2]) * 60 + Number(timing[3]) + Number((timing[4] + "00").slice(0, 3)) / 1000;
      var end = Number(timing[5]) * 3600 + Number(timing[6]) * 60 + Number(timing[7]) + Number((timing[8] + "00").slice(0, 3)) / 1000;
      var text = lines.slice(timingIndex + 1).join(" ").replace(/\s+/g, " ").trim();
      if (!text) return { ok: false, error: "Caption " + (i + 1) + " has no text." };
      segments.push({ text: text, start: start, end: end });
    }
    return { ok: true, segments: segments };
  }

  function validateSegments(segments, duration) {
    if (!Array.isArray(segments) || segments.length === 0) return { ok: false, error: "No timed captions were provided." };
    if (segments.length > MAX_CAPTIONS) return { ok: false, error: "A maximum of " + MAX_CAPTIONS + " caption segments can be created at once." };
    var maxDuration = Number(duration);
    var normalized = [];
    var previousEnd = -1;
    for (var i = 0; i < segments.length; i++) {
      var item = segments[i];
      var text = item && typeof item.text === "string" ? item.text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim() : "";
      var start = Number(item && item.start);
      var end = Number(item && item.end);
      if (!text || text.length > 140 || !isFinite(start) || !isFinite(end) || start < 0 || end <= start || end > maxDuration + 0.001) {
        return { ok: false, error: "Caption " + (i + 1) + " has invalid text or timing." };
      }
      if (start < previousEnd - 0.001) return { ok: false, error: "Caption " + (i + 1) + " overlaps the previous caption." };
      previousEnd = end;
      normalized.push({ text: text, start: start, end: end });
    }
    return { ok: true, segments: normalized };
  }

  function getWords(transcript) {
    var words = [];
    (transcript.segments || []).forEach(function (segment) {
      if (Array.isArray(segment.words) && segment.words.length) {
        segment.words.forEach(function (word) {
          words.push({ text: String(word.text || "").trim(), start: Number(word.start), end: Number(word.end) });
        });
      } else if (String(segment.text || "").trim()) {
        words.push({ text: String(segment.text).trim(), start: Number(segment.start), end: Number(segment.end) });
      }
    });
    return words.filter(function (word) {
      return word.text && isFinite(word.start) && isFinite(word.end) && word.end > word.start;
    }).sort(function (left, right) { return left.start - right.start; });
  }

  function mapTime(seconds, source, frameRate) {
    var compTime = Number(source.startTime) + Number(seconds) * Number(source.stretch) / 100;
    var start = Math.max(Number(source.inPoint), compTime);
    var endLimit = Number(source.outPoint);
    if (start >= endLimit) return null;
    var frame = 1 / frameRate;
    return Math.round(start / frame) * frame;
  }

  function toCaptionSegments(transcript, source, mode, frameRate) {
    if (!transcript || !Array.isArray(transcript.segments) || !source) return { ok: false, error: "The transcription or selected footage information is incomplete." };
    var fps = Number(frameRate || source.frameRate);
    var stretch = Number(source.stretch);
    if (!isFinite(fps) || fps <= 0 || !isFinite(stretch) || stretch <= 0) return { ok: false, error: "The selected footage has an unsupported frame rate or reverse time stretch." };
    var words = getWords(transcript);
    var raw = [];
    if (mode === "word") {
      raw = words.map(function (word) { return { text: word.text, start: word.start, end: word.end }; });
    } else {
      var group = [];
      var groupText = "";
      function flushGroup() {
        if (!group.length) return;
        raw.push({ text: groupText, start: group[0].start, end: group[group.length - 1].end });
        group = [];
        groupText = "";
      }
      words.forEach(function (word) {
        var text = word.text;
        var nextText = groupText ? groupText + " " + text : text;
        var pause = group.length && word.start - group[group.length - 1].end > 0.65;
        if (group.length && (group.length >= 8 || nextText.length > 52 || pause)) flushGroup();
        group.push(word);
        groupText = groupText ? groupText + " " + text : text;
        if (/[.!?][\"'”’)]*$/.test(text)) flushGroup();
      });
      flushGroup();
    }
    if (!raw.length) {
      return { ok: false, error: "The local speech model did not return usable word timestamps. Enable word timestamps or use another cached Whisper model." };
    }

    var result = [];
    var previousEnd = Number(source.inPoint);
    for (var i = 0; i < raw.length; i++) {
      var item = raw[i];
      var mediaStart = Math.max(0, Number(item.start));
      var mediaEnd = Number(item.end);
      var scale = stretch / 100;
      var compStart = Math.max(Number(source.inPoint), Number(source.startTime) + mediaStart * scale);
      var compEnd = Math.min(Number(source.outPoint), Number(source.startTime) + mediaEnd * scale);
      var start = Math.max(previousEnd, Math.round(compStart * fps) / fps);
      var end = Math.min(Number(source.outPoint), Math.round(compEnd * fps) / fps);
      if (end - start < 0.5 / fps) continue;
      result.push({ text: item.text, start: start, end: end });
      previousEnd = end;
    }
    return validateSegments(result, Number(source.outPoint));
  }

  root.OBSIDIANCaptions = {
    MAX_CAPTIONS: MAX_CAPTIONS,
    STYLES: STYLES.slice(),
    formatSrt: formatSrt,
    parseSrt: parseSrt,
    validateSegments: validateSegments,
    toCaptionSegments: toCaptionSegments,
    isStyle: function (style) { return STYLES.indexOf(style) !== -1; }
  };
}(typeof globalThis !== "undefined" ? globalThis : this));
