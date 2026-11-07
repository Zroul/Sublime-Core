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

function createCaptionPanelHarness(initialTheme, initialStorage = {}) {
  const elements = new Map();
  const requests = [];
  const actions = [];
  const createdPayloads = [];
  const storedValues = new Map(Object.entries(initialStorage));
  if (initialTheme) storedValues.set("obsidian-aura-theme", initialTheme);
  let panelReloads = 0;
  let documentActiveElement = null;
  const documentListeners = new Map();
  const windowListeners = new Map();
  const defaults = {
    "#caption-mode": "phrase",
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
      this.attributes = {};
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
      if (["#panel-menu", "#caption-workspace", "#caption-style-studio", "#caption-pipeline", "#caption-working-status", "#progress", "#result"].includes(selector)) {
        this.classList.add("hidden");
      }
      if (selector === "#caption-view-review") this.attributes["aria-selected"] = "true";
      if (selector === "[data-caption-animation=fade]") {
        this.classList.add("selected");
        this.attributes["aria-pressed"] = "true";
      }
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
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] || null; }
    removeAttribute(name) { delete this.attributes[name]; }
    focus() { documentActiveElement = this; }
    blur() {}
    querySelector(selector) { return getElement(`${this.selector} ${selector}`); }
    querySelectorAll(selector) {
      if (this.selector === "#caption-workspace" && selector.indexOf("button:not") === 0) {
        return ["#cc-refresh", "#captions-close", "#caption-view-review", "#caption-view-studio", "#captions-transcribe", "#captions-cancel", "#captions-create"]
          .map(getElement);
      }
      return [];
    }
    contains(element) { return element === this || Boolean(element && String(element.selector || "").startsWith(`${this.selector} `)); }
    closest(selector) { return selector === ".hidden" && this.classList.contains("hidden") ? this : null; }
    requestSubmit() {}
    dispatchEvent(event) { this.dispatch(event.type, event); return true; }
  }
  function getElement(selector) {
    if (!elements.has(selector)) elements.set(selector, new MockElement(selector));
    return elements.get(selector);
  }

  const document = {
    querySelector: getElement,
    documentElement: { dataset: { auraTheme: "mint" } },
    get activeElement() { return documentActiveElement; },
    addEventListener(type, handler) {
      const handlers = documentListeners.get(type) || [];
      handlers.push(handler);
      documentListeners.set(type, handlers);
    },
    querySelectorAll(selector) {
      if (selector === "[data-caption-animation]") {
        return ["none", "fade", "pop", "smooth_scale", "slide", "typewriter", "word_emphasis"].map((animation) => {
          const button = getElement(`[data-caption-animation=${animation}]`);
          button.dataset.captionAnimation = animation;
          return button;
        });
      }
      if (selector === "[data-aura-theme-option]") {
        return ["mint", "ice", "violet", "ember", "rose"].map((theme) => {
          const button = getElement(`[data-aura-theme-option=${theme}]`);
          button.dataset.auraThemeOption = theme;
          button.attributes["aria-pressed"] = "false";
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
      if (delay === 170 || delay === 180 || delay === 350) queueMicrotask(callback);
    return 1;
  };
  const context = {
    document,
    window: null,
    localStorage: {
      getItem(key) { return storedValues.has(key) ? storedValues.get(key) : null; },
      setItem(key, value) { storedValues.set(key, String(value)); },
    },
    __adobe_cep__: cep,
    XMLHttpRequest: MockXMLHttpRequest,
    addEventListener(type, handler) {
      const handlers = windowListeners.get(type) || [];
      handlers.push(handler);
      windowListeners.set(type, handlers);
    },
    setTimeout,
    clearTimeout() {},
    AbortController,
    location: { reload() { panelReloads++; } },
    escape: globalThis.escape,
    unescape: globalThis.unescape,
    console,
  };
  context.window = context;
  const sandbox = vm.createContext(context);
  const frontend = fileURLToPath(new URL("../../frontend/", import.meta.url));
  for (const script of [
    "knowledge.js", "style-recipes.js", "creative-recipes.js", "captions.js",
    "caption-style-studio.js", "caption-progress.js", "working-status.js", "planner.shared.js", "host-bridge.js", "panel-refresh.js", "app.js",
  ]) {
    vm.runInContext(readFileSync(`${frontend}/${script}`, "utf8"), sandbox, { filename: script });
  }
  return {
    elements,
    requests,
    actions,
    createdPayloads,
    document,
    storedValues,
    get panelReloads() { return panelReloads; },
    dispatchDocument(type, event) {
      return Promise.all((documentListeners.get(type) || []).map((handler) => handler(event)));
    },
    dispatchWindow(type, event) {
      return Promise.all((windowListeners.get(type) || []).map((handler) => handler(event)));
    },
    sandbox,
  };
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
  const hostTimeouts = [];
  const executeHost = panel.sandbox.OBSIDIANHostBridge.execute;
  panel.sandbox.OBSIDIANHostBridge.execute = function (evalScript, expression, timeoutMs) {
    hostTimeouts.push(timeoutMs);
    return executeHost(evalScript, expression, timeoutMs);
  };
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
  assert.equal(payload.style.fontSize, 64);
  assert.equal(payload.style.minFontSize, 20);
  assert.deepEqual(payload.segments.map((segment) => segment.text), ["Hello there."]);
  assert.deepEqual(payload.segments, [{ text: "Hello there.", start: 2.267, end: 3.267 }]);
  assert.deepEqual(hostTimeouts, [undefined, 5 * 60 * 1000]);
  assert.match(panel.elements.get("#caption-status").textContent, /Verified 1 timed caption layer/);
});

test("Base Size reaches the host payload from both caption creation actions", async () => {
  for (const actionSelector of ["#caption-style-implement", "#captions-create"]) {
    const panel = createCaptionPanelHarness();
    await panel.elements.get("#captions-transcribe").dispatch("click");
    const size = panel.elements.get("#caption-style-size");
    size.value = "240";
    await size.dispatch("input");
    assert.match(panel.elements.get("#caption-style-fit-label").textContent, /BATCH SIZE 240PX/);
    await panel.elements.get(actionSelector).dispatch("click");
    assert.equal(panel.createdPayloads.length, 1);
    assert.equal(panel.createdPayloads[0].style.fontSize, 240, actionSelector);
    assert.equal(panel.createdPayloads[0].style.minFontSize, 20, actionSelector);
  }
});

test("auto-fit preview remains separate from the Base Size sent for caption creation", async () => {
  const panel = createCaptionPanelHarness();
  await panel.elements.get("#captions-transcribe").dispatch("click");
  panel.elements.get("#caption-style-size").value = "360";
  await panel.elements.get("#caption-style-size").dispatch("input");
  assert.match(panel.elements.get("#caption-style-fit-label").textContent, /^FIT \d+PX FROM 360PX$/);
  await panel.elements.get("#captions-create").dispatch("click");
  assert.equal(panel.createdPayloads[0].style.fontSize, 360);
  assert.equal(panel.createdPayloads[0].style.minFontSize, 20);
});

test("caption workspace has no Reference or Quick Style UI and retains phrase and word timing choices", () => {
  const frontend = fileURLToPath(new URL("../../frontend/", import.meta.url));
  const html = readFileSync(`${frontend}/index.html`, "utf8");
  const app = readFileSync(`${frontend}/app.js`, "utf8");
  const css = readFileSync(`${frontend}/styles.css`, "latin1");

  assert.match(html, /Readable phrases/);
  assert.match(html, /Word by word/);
  assert.doesNotMatch(html, /reference|quick style|bold white|yellow emphasis/i);
  assert.doesNotMatch(html, /caption-style-(?:reference|file|sample-frame|import-ae|analysis)/i);
  assert.doesNotMatch(app, /captionStyleTouched|captionStyleImportAe|captionStyleReference|captionStyleFile|captionStyleSampleFrame|parseCaptionStyleReference|extractLocalPalette|caption-style-(?:reference|file|sample-frame|import-ae|analysis)/i);
  assert.doesNotMatch(css, /style-(?:file-button|sample-button|import-row|reference-frame|empty-reference|ae-text-reference|analysis-details)/i);
});

test("Studio font-size limits match After Effects and invalid entries get actionable feedback", async () => {
  const panel = createCaptionPanelHarness();
  const size = panel.elements.get("#caption-style-size");
  const floor = panel.elements.get("#caption-style-min-size");
  size.value = "1296.1";
  await size.dispatch("input");
  assert.match(panel.elements.get("#caption-style-status").textContent, /Base size must be between 0\.1 and 1,296 px/);

  size.value = "64";
  floor.value = "64.1";
  await floor.dispatch("input");
  assert.match(panel.elements.get("#caption-style-status").textContent, /Auto-fit floor must be at least 0\.1 px and no larger than the base size/);

  floor.value = "20";
  await floor.dispatch("input");
  assert.equal(panel.elements.get("#caption-style-status").textContent, "");

  size.value = "360";
  await size.dispatch("input");
  assert.match(panel.elements.get("#caption-style-fit-label").textContent, /^FIT \d+PX FROM 360PX$/);

  const html = readFileSync(fileURLToPath(new URL("../../frontend/index.html", import.meta.url)), "utf8");
  assert.doesNotMatch(html, /Minimum font size \(px\)/);
  assert.match(html, /Auto-fit floor \(px\)/);
  assert.match(html, /id="caption-style-size" type="number" min="0\.1" max="1296" step="0\.1"/);
});

test("all five themes can be selected from the menu and persist across panel reloads", async () => {
  for (const theme of ["mint", "ice", "violet", "ember", "rose"]) {
    const panel = createCaptionPanelHarness("rose");
    const menu = panel.elements.get("#menu");
    const popover = panel.elements.get("#panel-menu");
    const choice = panel.elements.get(`[data-aura-theme-option=${theme}]`);

    assert.equal(panel.document.documentElement.dataset.auraTheme, "rose");
    await menu.dispatch("click");
    assert.equal(menu.getAttribute("aria-expanded"), "true");
    assert.equal(popover.classList.contains("hidden"), false);
    await choice.dispatch("click");

    assert.equal(panel.document.documentElement.dataset.auraTheme, theme);
    assert.equal(panel.storedValues.get("obsidian-aura-theme"), theme);
    assert.equal(choice.getAttribute("aria-pressed"), "true");
    assert.equal(menu.getAttribute("aria-expanded"), "false");
    assert.equal(panel.document.activeElement, menu);

    const afterReload = createCaptionPanelHarness(panel.storedValues.get("obsidian-aura-theme"));
    assert.equal(afterReload.document.documentElement.dataset.auraTheme, theme);
  }
});

test("menu closes with Escape and caption tabs support arrow-key navigation and focus containment", async () => {
  const panel = createCaptionPanelHarness();
  const menu = panel.elements.get("#menu");
  const popover = panel.elements.get("#panel-menu");
  await menu.dispatch("click");
  let prevented = false;
  await panel.dispatchWindow("keydown", { key: "Escape", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(popover.classList.contains("hidden"), true);
  assert.equal(menu.getAttribute("aria-expanded"), "false");

  await menu.dispatch("click");
  const commandInput = panel.elements.get("#command");
  commandInput.focus();
  await panel.dispatchDocument("click", { target: commandInput });
  assert.equal(popover.classList.contains("hidden"), true);

  panel.sandbox.openCaptionWorkspace("phrase");
  const review = panel.elements.get("#caption-view-review");
  const studio = panel.elements.get("#caption-view-studio");
  await review.dispatch("keydown", { key: "ArrowRight", preventDefault() {} });
  assert.equal(studio.getAttribute("aria-selected"), "true");
  assert.equal(studio.tabIndex, 0);
  assert.equal(review.tabIndex, -1);

  const first = panel.elements.get("#cc-refresh");
  const last = panel.elements.get("#captions-create");
  panel.elements.get("#command").focus();
  let tabPrevented = false;
  await panel.dispatchWindow("keydown", { key: "Tab", preventDefault() { tabPrevented = true; } });
  assert.equal(tabPrevented, true);
  assert.equal(panel.document.activeElement, first);
  first.focus();
  await panel.dispatchWindow("keydown", { key: "Tab", shiftKey: true, preventDefault() {} });
  assert.equal(panel.document.activeElement, last);
  await panel.dispatchWindow("keydown", { key: "Escape", preventDefault() {} });
  assert.equal(panel.elements.get("#caption-workspace").classList.contains("hidden"), true);
  assert.equal(panel.document.activeElement, commandInput);
});

test("assistant status uses stage text without a numeric percentage and differentiates failures", () => {
  const panel = createCaptionPanelHarness();
  const { setProgress, showResult, renderPanelServiceStatus } = panel.sandbox;
  setProgress("planning");
  assert.equal(panel.elements.get("#progress").dataset.state, "working");
  assert.equal(panel.elements.get("#progress-label").textContent, "PLANNING");
  assert.equal(panel.elements.get("#progress-value").textContent, "");

  showResult("Verified action.", false);
  assert.equal(panel.elements.get("#result").dataset.state, "success");
  assert.equal(panel.elements.get("#result").getAttribute("aria-label"), "OBSIDIAN result");
  showResult("Action rejected.", true);
  assert.equal(panel.elements.get("#result").dataset.state, "error");
  assert.equal(panel.elements.get("#result").getAttribute("aria-label"), "OBSIDIAN error");
  showResult("Choose a creative direction.", false, "warning");
  assert.equal(panel.elements.get("#result").dataset.state, "warning");
  assert.equal(panel.elements.get("#result").getAttribute("aria-label"), "OBSIDIAN warning");

  renderPanelServiceStatus(panel.elements.get("#core-service-status"), {
    state: "warning", label: "CORE model missing", detail: "Install the configured model in the existing Ollama service.",
  });
  assert.equal(panel.elements.get("#core-service-status").getAttribute("aria-label"), "CORE service status: CORE model missing");
  assert.equal(panel.elements.get("#core-service-detail").textContent, "Install the configured model in the existing Ollama service.");
  assert.equal(panel.elements.get("#cc-core-service-status").textContent, "CORE model missing");
});

test("the active operation label replaces its predecessor in both main and CC views", () => {
  const panel = createCaptionPanelHarness();
  panel.sandbox.setProgress("analyzing");
  assert.equal(panel.elements.get("#progress-label").textContent, "ANALYZING");
  assert.equal(panel.elements.get("#caption-working-label").textContent, "ANALYZING");
  panel.sandbox.setProgress("validating");
  assert.equal(panel.elements.get("#progress-label").textContent, "VALIDATING");
  assert.equal(panel.elements.get("#caption-working-label").textContent, "VALIDATING");
  panel.sandbox.setProgress("completed");
  assert.equal(panel.elements.get("#progress-label").textContent, "COMPLETED");
  assert.equal(panel.elements.get("#caption-working-label").textContent, "COMPLETED");
  panel.sandbox.setProgress(null);
  assert.equal(panel.elements.get("#progress").classList.contains("hidden"), true);
  assert.equal(panel.elements.get("#caption-working-status").classList.contains("hidden"), true);
});

test("CC opens as a blurred overlay and restores the main orb when closed", async () => {
  const panel = createCaptionPanelHarness();
  const shell = panel.document.querySelector(".obsidian");
  await panel.elements.get("#captions-open").dispatch("click");
  assert.equal(shell.classList.contains("caption-open"), true);
  assert.equal(panel.elements.get("#caption-workspace").classList.contains("hidden"), false);
  await panel.elements.get("#captions-close").dispatch("click");
  assert.equal(shell.classList.contains("caption-open"), false);
  assert.equal(panel.elements.get("#caption-workspace").classList.contains("hidden"), true);
});

test("CC service refresh reloads once when idle and rejects refresh during transcription", async () => {
  const idle = createCaptionPanelHarness();
  await idle.elements.get("#cc-refresh").dispatch("click");
  assert.equal(idle.panelReloads, 1);

  const busy = createCaptionPanelHarness();
  busy.sandbox.openCaptionWorkspace("phrase");
  const transcription = busy.elements.get("#captions-transcribe").dispatch("click");
  await busy.elements.get("#cc-refresh").dispatch("click");
  assert.equal(busy.panelReloads, 0);
  assert.match(busy.elements.get("#caption-status").textContent, /Refresh unavailable while local caption transcription is running/);
  await transcription;
});

test("caption transcript edits persist locally with the inspected source and restore after panel reload", async () => {
  const panel = createCaptionPanelHarness();
  await panel.elements.get("#captions-transcribe").dispatch("click");
  const transcript = panel.elements.get("#caption-transcript");
  transcript.value = "1\n00:00:00,250 --> 00:00:01,250\nReviewed locally.";
  panel.elements.get("#caption-mode").value = "word";
  await transcript.dispatch("input");
  const draftKey = "obsidian-caption-review-draft-v1";
  const draft = JSON.parse(panel.storedValues.get(draftKey));
  assert.equal(panel.elements.get("#caption-save-state").textContent, "SAVED LOCALLY");
  assert.equal(draft.text, transcript.value);
  assert.equal(draft.mode, "word");
  assert.equal(draft.source.layerName, "Podcast");

  const restored = createCaptionPanelHarness(null, Object.fromEntries(panel.storedValues));
  assert.equal(restored.elements.get("#caption-transcript").value, transcript.value);
  assert.equal(restored.elements.get("#caption-mode").value, "word");
  assert.equal(restored.elements.get("#caption-save-state").textContent, "SAVED LOCALLY");
  assert.match(restored.elements.get("#caption-source-summary").textContent, /Podcast.*Smoke Comp/);
  assert.equal(restored.elements.get("#captions-create").disabled, false);
});

test("main prompt grows to its expanded limit and keeps keyboard submit behavior", async () => {
  const panel = createCaptionPanelHarness();
  const prompt = panel.elements.get("#command");
  prompt.scrollHeight = 284;
  await prompt.dispatch("input");
  assert.equal(prompt.style.height, "200px");
  const html = readFileSync(fileURLToPath(new URL("../../frontend/index.html", import.meta.url)), "utf8");
  const css = readFileSync(fileURLToPath(new URL("../../frontend/styles.css", import.meta.url)), "utf8");
  assert.match(html, /<textarea id="command" rows="1"/);
  assert.match(html, /<svg class="voice-icon"/);
  assert.match(css, /#command \{[\s\S]*?resize: none/);
  assert.match(css, /#command \{[\s\S]*?max-height: 200px/);
});

test("microphone records and transcribes locally, inserts reviewable command text, and waits for Send", async () => {
  const panel = createCaptionPanelHarness();
  let recorder;
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  class MockMediaRecorder {
    static isTypeSupported() { return true; }
    constructor(_stream, options) { this.mimeType = options.mimeType; this.state = "inactive"; this.listeners = new Map(); }
    addEventListener(name, handler) {
      const entries = this.listeners.get(name) || [];
      entries.push(handler);
      this.listeners.set(name, entries);
    }
    emit(name, event = {}) { (this.listeners.get(name) || []).forEach((handler) => handler(event)); }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.emit("stop"); }
  }
  class MockFileReader {
    readAsDataURL() {
      this.result = "data:audio/webm;base64,AQID";
      queueMicrotask(() => this.onload());
    }
  }
  panel.sandbox.navigator = { mediaDevices: { async getUserMedia() { return { getTracks: () => tracks }; } } };
  panel.sandbox.window.MediaRecorder = class extends MockMediaRecorder {
    constructor(stream, options) { super(stream, options); recorder = this; }
  };
  panel.sandbox.Blob = Blob;
  panel.sandbox.FileReader = MockFileReader;
  panel.sandbox.Event = class { constructor(type) { this.type = type; } };
  let request;
  panel.sandbox.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, async json() { return { processing: "local", transcript: { segments: [{ text: "Make a fade", start: 0, end: 1 }] } }; } };
  };

  await panel.elements.get("#voice").dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(recorder.state, "recording");
  assert.equal(panel.elements.get("#progress-label").textContent, "RECORDING");
  recorder.emit("dataavailable", { data: new Blob(["audio"], { type: "audio/webm;codecs=opus" }) });
  await panel.elements.get("#voice").dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(request.url, "http://127.0.0.1:43127/transcribe-voice");
  assert.equal(request.options.headers["X-Obsidian-CEP-Extension-Id"], "com.zroul.obsidian.smoketest.5611c73bb73c4b11bf3128ca8e64519e.panel");
  assert.equal(JSON.parse(request.options.body).audioBase64, "AQID");
  assert.equal(panel.elements.get("#command").value, "Make a fade");
  assert.equal(panel.elements.get("#progress-label").textContent, "COMPLETED");
  assert.deepEqual(tracks.map((track) => track.stopped), [true]);
  assert.deepEqual(panel.actions, [], "voice text waits for the user's normal Send action");
});

test("microphone timeout reports the local transcription failure and releases the operation state", async () => {
  const panel = createCaptionPanelHarness();
  let recorder;
  let fireVoiceTimeout;
  const tracks = [{ stop() {} }];
  class MockMediaRecorder {
    static isTypeSupported() { return true; }
    constructor(_stream, options) { this.mimeType = options.mimeType; this.state = "inactive"; this.listeners = new Map(); }
    addEventListener(name, handler) {
      const entries = this.listeners.get(name) || [];
      entries.push(handler);
      this.listeners.set(name, entries);
    }
    emit(name, event = {}) { (this.listeners.get(name) || []).forEach((handler) => handler(event)); }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.emit("stop"); }
  }
  class MockFileReader {
    readAsDataURL() {
      this.result = "data:audio/webm;base64,AQID";
      queueMicrotask(() => this.onload());
    }
  }
  panel.sandbox.navigator = { mediaDevices: { async getUserMedia() { return { getTracks: () => tracks }; } } };
  panel.sandbox.window.MediaRecorder = class extends MockMediaRecorder {
    constructor(stream, options) { super(stream, options); recorder = this; }
  };
  panel.sandbox.Blob = Blob;
  panel.sandbox.FileReader = MockFileReader;
  panel.sandbox.setTimeout = (callback, delay) => {
    if (delay === 22 * 60 * 1000) fireVoiceTimeout = callback;
    else if (delay === 170 || delay === 180 || delay === 350) queueMicrotask(callback);
    return 1;
  };
  panel.sandbox.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
  });

  await panel.elements.get("#voice").dispatch("click");
  recorder.emit("dataavailable", { data: new Blob(["audio"], { type: "audio/webm;codecs=opus" }) });
  await panel.elements.get("#voice").dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof fireVoiceTimeout, "function", "the local request timeout is armed");
  fireVoiceTimeout();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(panel.elements.get("#progress-label").textContent, "FAILED");
  assert.match(panel.elements.get("#result-text").textContent, /Local voice transcription timed out.*Whisper service status/);
  assert.equal(panel.elements.get("#result").dataset.state, "error");
});

test("redesign retains narrow and short panel layouts, visible keyboard focus, and reduced-motion rules", () => {
  const frontend = fileURLToPath(new URL("../../frontend/", import.meta.url));
  const html = readFileSync(`${frontend}/index.html`, "utf8");
  const css = readFileSync(`${frontend}/styles.css`, "utf8");
  const app = readFileSync(`${frontend}/app.js`, "utf8");
  const markupIds = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
  const queriedIds = Array.from(app.matchAll(/document\.querySelector\("#([^\"]+)"\)/g), (match) => match[1]);
  assert.equal(new Set(markupIds).size, markupIds.length, "markup IDs remain unique");
  assert.deepEqual(queriedIds.filter((id) => !markupIds.includes(id)), []);
  assert.equal((html.match(/data-caption-animation=/g) || []).length, 7);
  assert.deepEqual(Array.from(html.matchAll(/data-aura-theme-option="([^"]+)"/g), (match) => match[1]), ["mint", "ice", "violet", "ember", "rose"]);
  assert.match(html, /id="caption-style-implement"[^>]*>IMPLEMENT/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /@media \(max-width: 285px\)/);
  assert.match(css, /@media \(max-height: 420px\)/);
  assert.match(css, /\.style-preview-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.style-controls-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /overflow-x: hidden; overflow-y: auto/);
  assert.match(css, /button:focus-visible[\s\S]*?outline: 2px solid var\(--focus\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(html, /id="caption-working-status"/);
  assert.match(html, /id="cc-core-service-status"/);
  assert.match(html, /id="cc-whisper-service-status"/);
  assert.match(html, /id="cc-refresh"/);
  assert.match(css, /\.caption-workspace \{[\s\S]*?backdrop-filter: blur/);
  assert.match(css, /\.obsidian\.caption-open \.welcome-mark/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.caption-progress-wave \{ animation: none !important; \}/);
  assert.match(css, /#command \{[\s\S]*?max-height: 200px/);
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

test("caption parser rejects overlapping and out of range segments", () => {
  const invalid = globalThis.OBSIDIANCaptions.parseSrt("1\n00:00:01,000 --> 00:00:02,000\nCaption");
  assert.equal(invalid.ok, true);
  assert.equal(globalThis.OBSIDIANCaptions.validateSegments([
    { text: "A", start: 1, end: 2 },
    { text: "B", start: 1.9, end: 2.5 },
  ], 5).ok, false);
  assert.equal(globalThis.OBSIDIANCaptions.validateSegments([{ text: "A", start: 0, end: 6 }], 5).ok, false);
});

test("caption review and planner preserve complete text beyond the former 140-character cap", () => {
  const text = "spoken words remain available for careful review ".repeat(15).trim();
  const formatted = globalThis.OBSIDIANCaptions.formatSrt([{ text, start: 0.2, end: 4.2 }]);
  const parsed = globalThis.OBSIDIANCaptions.parseSrt(formatted);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.segments[0].text, text);
  const styled = {
    version: 1,
    font: "Arial-BoldMT",
    fontSize: 64,
    minFontSize: 10,
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
  const plan = planCaptionCreation(parsed.segments, source, styled);
  assert.equal(plan.action, "create_captions");
  assert.equal(plan.args.segments[0].text, text);
  assert.equal(isExecutablePlan(plan), true);
});

test("caption review and planner accept 400, 401, and 1,000 segments but reject 1,001", () => {
  const captions = globalThis.OBSIDIANCaptions;
  assert.equal(captions.MAX_CAPTIONS, 1000);
  for (const count of [400, 401, 1000]) {
    const segments = Array.from({ length: count }, (_, index) => ({
      text: "Caption " + (index + 1),
      start: index * 0.5,
      end: index * 0.5 + 0.4,
    }));
    const parsed = captions.parseSrt(captions.formatSrt(segments));
    assert.equal(parsed.ok, true, "SRT parse at " + count);
    assert.equal(parsed.segments.length, count);
    assert.equal(captions.validateSegments(parsed.segments, count + 1).segments.length, count);
    const selectedSource = { ...source, outPoint: count + 1, compDuration: count + 1 };
    const plan = planCaptionCreation(parsed.segments, selectedSource, "clean");
    assert.equal(plan.action, "create_captions", "planner action at " + count);
    assert.equal(plan.args.segments.length, count);
    assert.equal(isExecutablePlan(plan), true, "executable plan at " + count);
  }

  const tooMany = Array.from({ length: 1001 }, (_, index) => ({
    text: "Caption " + (index + 1),
    start: index * 0.5,
    end: index * 0.5 + 0.4,
  }));
  const parsedTooMany = captions.parseSrt(captions.formatSrt(tooMany));
  assert.equal(parsedTooMany.ok, false);
  assert.match(parsedTooMany.error, /maximum of 1000/);
  assert.equal(captions.validateSegments(tooMany, 1002).ok, false);
  assert.equal(planCaptionCreation(tooMany, { ...source, outPoint: 1002, compDuration: 1002 }, "clean").status, "needs_clarification");
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
  assert.equal(plan.args.style.fontSize, 64);
  assert.equal(plan.args.style.animation, "smooth_scale");
  assert.deepEqual(plan.args.segments, segments);
  assert.deepEqual(planCaptionCreation(segments, source, { ...style, animation: "raw_jsx" }).status, "needs_clarification");
  assert.equal(planCaptionCreation([{ text: "x".repeat(140), start: 0.25, end: 0.75 }], { ...source, compWidth: 720 }, style).status, "needs_clarification");
});
