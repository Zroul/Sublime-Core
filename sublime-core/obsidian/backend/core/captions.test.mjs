import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { isExecutablePlan, planCaptionCreation, planObsidianCommand, planCaptionStyleInspection } from "./planner.mjs";

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

function createCaptionPanelHarness() {
  const elements = new Map();
  const requests = [];
  const actions = [];
  const createdPayloads = [];
  const defaults = {
    "#caption-mode": "phrase",
    "#caption-style": "clean",
    "#caption-style-font": "Arial-BoldMT",
    "#caption-style-size": "64",
    "#caption-style-min-size": "20",
    "#caption-style-align": "center",
    "#caption-style-fill": "#ffffff",
    "#caption-style-stroke-color": "#080b14",
    "#caption-style-stroke-width": "3",
    "#caption-style-x": "50",
    "#caption-style-y": "86",
    "#caption-style-duration": "0.4",
  };
  class MockElement {
    constructor(selector) {
      this.selector = selector;
      this.listeners = new Map();
      this.value = defaults[selector] || "";
      this.checked = selector === "#caption-style-fill-enabled" || selector === "#caption-style-stroke-enabled";
      this.disabled = false;
      this.textContent = "";
      this.style = { setProperty() {} };
      this.dataset = {};
      this.files = [];
      this.children = [];
      this.classList = {
        values: new Set(),
        add: (...names) => names.forEach((name) => this.classList.values.add(name)),
        remove: (...names) => names.forEach((name) => this.classList.values.delete(name)),
        contains: (name) => this.classList.values.has(name),
        toggle: (name, force) => {
          const enabled = force === undefined ? !this.classList.values.has(name) : Boolean(force);
          if (enabled) this.classList.values.add(name);
          else this.classList.values.delete(name);
          return enabled;
        },
      };
      this.nextElementSibling = { textContent: "" };
      this.clientHeight = 160;
      this.scrollHeight = 0;
    }
    addEventListener(type, handler) {
      const handlers = this.listeners.get(type) || [];
      handlers.push(handler);
      this.listeners.set(type, handlers);
    }
    async dispatch(type, event = { type, preventDefault() {} }) {
      return Promise.all((this.listeners.get(type) || []).map((handler) => handler(event)));
    }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute() {}
    removeAttribute() {}
    focus() {}
    blur() {}
    querySelector(selector) { return getElement(`${this.selector} ${selector}`); }
    requestSubmit() {}
  }
  function getElement(selector) {
    if (!elements.has(selector)) elements.set(selector, new MockElement(selector));
    return elements.get(selector);
  }

  const document = {
    querySelector: getElement,
    querySelectorAll(selector) {
      if (selector === "[data-caption-animation]") {
        return ["none", "fade", "pop", "smooth_scale", "slide", "typewriter", "word_emphasis"].map((animation) => {
          const button = getElement(`[data-caption-animation=${animation}]`);
          button.dataset.captionAnimation = animation;
          return button;
        });
      }
      return [];
    },
    createElement: (tag) => new MockElement(tag),
  };
  const inspection = [
    "OK", "CAPTION_SOURCE", encodeURIComponent("C:/local/podcast.mp4"), "Podcast", "42", "1",
    "2", "6", "0", "100", "30", "10", "1920", "1080", "Smoke%20Comp",
  ].join("|");
  class MockXMLHttpRequest {
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    getResponseHeader() { return "application/x-ndjson"; }
    send(body) {
      requests.push(JSON.parse(body));
      this.status = 200;
      this.responseText = JSON.stringify({
        type: "result",
        processing: "local",
        transcript: {
          duration: 4,
          segments: [{
            text: "Hello there.", start: 0.25, end: 1.25,
            words: [{ text: "Hello", start: 0.25, end: 0.65 }, { text: "there.", start: 0.65, end: 1.25 }],
          }],
        },
      }) + "\n";
      this.onload();
    }
    abort() { if (this.onabort) this.onabort(); }
  }
  const cep = {
    getExtensionId: () => "com.zroul.obsidian.smoketest.5611c73bb73c4b11bf3128ca8e64519e.panel",
    evalScript(expression, callback) {
      const actionMatch = expression.match(/^OBSIDIAN_executePlan\("([^\"]+)"/);
      const action = actionMatch && actionMatch[1];
      actions.push(action);
      if (action === "inspect_caption_source") {
        callback(inspection);
        return;
      }
      if (action === "create_captions") {
        const separator = expression.lastIndexOf(",\"\",null)");
        const argsStart = expression.indexOf(",") + 1;
        createdPayloads.push(JSON.parse(expression.slice(argsStart, separator)));
        callback("OK|Verified 1 timed caption layer(s) using the clean style.");
        return;
      }
      callback("REJECTED|Unexpected action in caption workflow test.");
    },
  };
  const setTimeout = (callback, delay) => {
    if (delay === 170) queueMicrotask(callback);
    return 1;
  };
  const context = {
    document,
    window: null,
    __adobe_cep__: cep,
    XMLHttpRequest: MockXMLHttpRequest,
    addEventListener() {},
    setTimeout,
    clearTimeout() {},
    escape: globalThis.escape,
    unescape: globalThis.unescape,
    console,
  };
  context.window = context;
  const sandbox = vm.createContext(context);
  const frontend = fileURLToPath(new URL("../../frontend/", import.meta.url));
  for (const script of [
    "knowledge.js", "style-recipes.js", "creative-recipes.js", "captions.js",
    "caption-style-studio.js", "caption-progress.js", "planner.shared.js", "host-bridge.js", "panel-refresh.js", "app.js",
  ]) {
    vm.runInContext(readFileSync(`${frontend}/${script}`, "utf8"), sandbox, { filename: script });
  }
  return { elements, requests, actions, createdPayloads };
}

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

test("caption style inspection is a typed read-only planner action", () => {
  const plan = planCaptionStyleInspection();
  assert.equal(plan.action, "inspect_caption_style");
  assert.equal(plan.args.readOnly, true);
  assert.equal(isExecutablePlan(plan), true);
  assert.equal(isExecutablePlan({ ...plan, args: { readOnly: false } }), false);
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

test("inspect, transcribe, generate, and CREATE CAPTION LAYERS preserves the selected source and style", async () => {
  const panel = createCaptionPanelHarness();
  await panel.elements.get("#captions-transcribe").dispatch("click");

  assert.deepEqual(panel.actions, ["inspect_caption_source"]);
  assert.deepEqual(panel.requests, [{
    path: "C:/local/podcast.mp4",
    range: { sourceStartSeconds: 2, sourceDurationSeconds: 4, timelineDurationSeconds: 4 },
  }]);
  const transcript = panel.elements.get("#caption-transcript").value;
  assert.match(transcript, /Hello there\./);
  assert.equal(panel.elements.get("#captions-create").disabled, false);

  const parsedTranscript = globalThis.OBSIDIANCaptions.parseSrt(transcript);
  assert.equal(parsedTranscript.ok, true);
  const inspectedSource = { ...source, inPoint: 2, outPoint: 6, compName: "Smoke Comp" };
  const clickEvent = { type: "click", preventDefault() {} };
  const reproducedFailure = planCaptionCreation(parsedTranscript.segments, inspectedSource, clickEvent);
  assert.equal(reproducedFailure.question, "The selected footage information or caption style is invalid. Inspect the source again before creating captions.");

  await panel.elements.get("#captions-create").dispatch("click", clickEvent);

  assert.deepEqual(panel.actions, ["inspect_caption_source", "create_captions"]);
  assert.equal(panel.createdPayloads.length, 1);
  const payload = panel.createdPayloads[0];
  assert.equal(payload.source.path, "C:/local/podcast.mp4");
  assert.equal(payload.source.layerId, "42");
  assert.equal(payload.source.layerIndex, 1);
  assert.deepEqual(
    [payload.source.inPoint, payload.source.outPoint, payload.source.startTime, payload.source.stretch],
    [2, 6, 0, 100],
  );
  assert.equal(payload.style, "clean");
  assert.deepEqual(payload.segments.map((segment) => segment.text), ["Hello there."]);
  assert.deepEqual(payload.segments, [{ text: "Hello there.", start: 2.267, end: 3.267 }]);
  assert.match(panel.elements.get("#caption-status").textContent, /Verified 1 timed caption layer/);
});

test("word by word captions keep individual timings and map source offset and stretch", () => {
  const timedSource = { ...source, inPoint: 1, startTime: 0, stretch: 50, outPoint: 4 };
  const transcript = { segments: [{
    text: "Keep this",
    start: 0,
    end: 1,
    words: [
      { text: "Keep", start: 0, end: 0.5 },
      { text: "this", start: 0.5, end: 1 },
    ],
  }] };
  const result = globalThis.OBSIDIANCaptions.toCaptionSegments(transcript, timedSource, "word", 30);
  assert.equal(result.ok, true);
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].start, 1);
  assert.equal(result.segments[0].end, 1.2666666666666666);
  assert.equal(result.segments[1].start, result.segments[0].end);
  assert.equal(result.segments[1].end, 1.5);
});

test("trimmed long-source ranges use selected layer timing and preserve composition alignment", () => {
  const trimmed = { ...source, inPoint: 45, outPoint: 90, startTime: 0, stretch: 100 };
  assert.deepEqual(globalThis.OBSIDIANCaptions.getTranscriptionRange(trimmed), {
    ok: true,
    range: { sourceStartSeconds: 45, sourceDurationSeconds: 45, timelineDurationSeconds: 45 },
  });
  const captions = globalThis.OBSIDIANCaptions.toCaptionSegments({ segments: [{
    text: "Selected audio",
    start: 0.5,
    end: 1.5,
    words: [{ text: "Selected", start: 0.5, end: 1 }, { text: "audio", start: 1, end: 1.5 }],
  }] }, trimmed, "word", 30);
  assert.equal(captions.ok, true);
  assert.deepEqual(captions.segments, [
    { text: "Selected", start: 45.5, end: 46 },
    { text: "audio", start: 46, end: 46.5 },
  ]);
});

test("layer stretch maps the selected composition range to source audio duration", () => {
  const slow = { ...source, inPoint: 120, outPoint: 165, startTime: 0, stretch: 50 };
  assert.deepEqual(globalThis.OBSIDIANCaptions.getTranscriptionRange(slow), {
    ok: true,
    range: { sourceStartSeconds: 240, sourceDurationSeconds: 90, timelineDurationSeconds: 45 },
  });
  const captions = globalThis.OBSIDIANCaptions.toCaptionSegments({ segments: [{
    text: "Later source range",
    start: 10,
    end: 12,
    words: [{ text: "Later", start: 10, end: 11 }, { text: "range", start: 11, end: 12 }],
  }] }, slow, "word", 30);
  assert.equal(captions.ok, true);
  assert.deepEqual(captions.segments, [
    { text: "Later", start: 125, end: 125.5 },
    { text: "range", start: 125.5, end: 126 },
  ]);
});

test("caption range validation rejects selected timeline or stretched audio over 30 minutes", () => {
  const longTimeline = { ...source, inPoint: 0, outPoint: 1800.01, startTime: 0, stretch: 100 };
  const longSourceAudio = { ...source, inPoint: 0, outPoint: 45, startTime: 0, stretch: 2 };
  assert.match(globalThis.OBSIDIANCaptions.getTranscriptionRange(longTimeline).error, /30-minute/);
  assert.match(globalThis.OBSIDIANCaptions.getTranscriptionRange(longSourceAudio).error, /more than 30 minutes/);
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

test("Caption Style Studio plans bounded, consistently fitted styles without changing caption timestamps", () => {
  const segments = [
    { text: "Short", start: 0.25, end: 0.75 },
    { text: "A longer reviewed caption that determines the shared font size", start: 0.75, end: 1.8 },
  ];
  const style = {
    version: 1,
    font: "Montserrat-Bold",
    fontSize: 64,
    minFontSize: 20,
    fillColor: [0.38, 0.9, 0.96],
    fillEnabled: true,
    strokeEnabled: true,
    strokeColor: [0, 0, 0],
    strokeWidth: 3,
    alignment: "center",
    positionX: 0.5,
    positionY: 0.86,
    animation: "smooth_scale",
    animationDuration: 0.5,
  };
  const plan = planCaptionCreation(segments, source, style);
  assert.equal(plan.action, "create_captions");
  assert.equal(isExecutablePlan(plan), true);
  assert.ok(plan.args.style.fontSize < 64);
  assert.equal(plan.args.style.animation, "smooth_scale");
  assert.deepEqual(plan.args.segments, segments);
  assert.deepEqual(planCaptionCreation(segments, source, { ...style, animation: "raw_jsx" }).status, "needs_clarification");
  assert.equal(planCaptionCreation([{ text: "x".repeat(140), start: 0.25, end: 0.75 }], { ...source, compWidth: 720 }, style).status, "needs_clarification");
});
