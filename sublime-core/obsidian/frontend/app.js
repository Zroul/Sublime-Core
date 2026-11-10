const form = document.querySelector("#command-form");
const commandInput = document.querySelector("#command");
const voiceButton = document.querySelector("#voice");
const applicationShell = document.querySelector(".obsidian");
const welcomeOrb = document.querySelector(".welcome-mark");
const captionsOpenButton = document.querySelector("#captions-open");
const transitionsOpenButton = document.querySelector("#transitions-open");
const transitionsPanel = document.querySelector("#transitions-panel");
const transitionsCloseButton = document.querySelector("#transitions-close");
const shake01ApplyButton = document.querySelector("#shake-01-apply");
const shake01OutgoingDuration = document.querySelector("#shake-01-outgoing");
const shake01IncomingDuration = document.querySelector("#shake-01-incoming");
const captionWorkspace = document.querySelector("#caption-workspace");
const captionsCloseButton = document.querySelector("#captions-close");
const captionsCancelButton = document.querySelector("#captions-cancel");
const captionsTranscribeButton = document.querySelector("#captions-transcribe");
const captionsCreateButton = document.querySelector("#captions-create");
const captionMode = document.querySelector("#caption-mode");
const captionTranscript = document.querySelector("#caption-transcript");
const captionStatus = document.querySelector("#caption-status");
const captionSaveState = document.querySelector("#caption-save-state");
const captionSourceSummary = document.querySelector("#caption-source-summary");
const captionWorkingStatus = document.querySelector("#caption-working-status");
const captionWorkingLabel = document.querySelector("#caption-working-label");
const captionPipeline = document.querySelector("#caption-pipeline");
const captionProgressLine = document.querySelector("#caption-progress-line");
const captionPipelineError = document.querySelector("#caption-pipeline-error");
const captionReviewTab = document.querySelector("#caption-view-review");
const captionStudioTab = document.querySelector("#caption-view-studio");
const captionReviewSpace = document.querySelector("#caption-review-space");
const captionStyleStudio = document.querySelector("#caption-style-studio");
const captionStyleStatus = document.querySelector("#caption-style-status");
const captionStyleImplement = document.querySelector("#caption-style-implement");
const captionStylePreview = document.querySelector("#caption-style-generated");
const captionStylePreviewAnchor = document.querySelector("#caption-style-preview-anchor");
const captionStylePreviewText = document.querySelector("#caption-style-preview-text");
const captionStyleFitLabel = document.querySelector("#caption-style-fit-label");
const captionStylePalette = document.querySelector("#caption-style-palette");
const captionStyleInputs = {
  font: document.querySelector("#caption-style-font"),
  size: document.querySelector("#caption-style-size"),
  minSize: document.querySelector("#caption-style-min-size"),
  alignment: document.querySelector("#caption-style-align"),
  fill: document.querySelector("#caption-style-fill"),
  fillEnabled: document.querySelector("#caption-style-fill-enabled"),
  stroke: document.querySelector("#caption-style-stroke-color"),
  strokeEnabled: document.querySelector("#caption-style-stroke-enabled"),
  strokeWidth: document.querySelector("#caption-style-stroke-width"),
  x: document.querySelector("#caption-style-x"),
  y: document.querySelector("#caption-style-y"),
  duration: document.querySelector("#caption-style-duration")
};
const progress = document.querySelector("#progress");
const progressValue = document.querySelector("#progress-value");
const progressLabel = document.querySelector("#progress-label");
const result = document.querySelector("#result");
const resultText = document.querySelector("#result-text");
const panelRefreshButton = document.querySelector("#panel-refresh");
const ccRefreshButton = document.querySelector("#cc-refresh");
const coreServiceStatus = document.querySelector("#core-service-status");
const whisperServiceStatus = document.querySelector("#whisper-service-status");
const ccCoreServiceStatus = document.querySelector("#cc-core-service-status");
const ccWhisperServiceStatus = document.querySelector("#cc-whisper-service-status");
const coreServiceDetail = document.querySelector("#core-service-detail");
const whisperServiceDetail = document.querySelector("#whisper-service-detail");
const panelMenuButton = document.querySelector("#menu");
const panelMenu = document.querySelector("#panel-menu");
const themeOptions = Array.from(document.querySelectorAll("[data-aura-theme-option]"));


function setTransitionsPanelOpen(open) {
  const isOpen = Boolean(open);
  transitionsPanel.classList.toggle("hidden", !isOpen);
  transitionsOpenButton.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) shake01OutgoingDuration.focus();
  else transitionsOpenButton.focus();
}
transitionsOpenButton.addEventListener("click", () => setTransitionsPanelOpen(true));
transitionsCloseButton.addEventListener("click", () => setTransitionsPanelOpen(false));
shake01ApplyButton.addEventListener("click", () => {
  const outgoing = Number(shake01OutgoingDuration.value), incoming = Number(shake01IncomingDuration.value);
  if (!Number.isFinite(outgoing) || !Number.isFinite(incoming) || outgoing < 0.1 || outgoing > 2 || incoming < 0.1 || incoming > 2) {
    showResult("Each transition duration must be between 0.1 and 2 seconds.", true); return;
  }
  setTransitionsPanelOpen(false); resetStatus();
  runAE("shake 01 outgoing " + outgoing.toFixed(2) + " incoming " + incoming.toFixed(2));
});

let commandInFlight = false;
let proposalInFlight = false;
let hostOperationsInFlight = 0;
let microphonePermissionPending = false;
let selectedCaptionSource = null;
let activeCaptionRun = null;
let captionRunSequence = 0;
let selectedCaptionAnimation = "fade";
let mediaRecorder = null;
let microphoneStream = null;
let voiceStopTimer = null;
let captionReturnFocus = null;
let captionDraftSaveTimer = null;

const AVAILABLE_THEMES = ["mint", "ice", "violet", "ember", "rose"];
const THEME_STORAGE_KEY = "obsidian-aura-theme";
const CAPTION_DRAFT_STORAGE_KEY = "obsidian-caption-review-draft-v1";

function applyTheme(theme, persist) {
  const selected = AVAILABLE_THEMES.includes(theme) ? theme : "mint";
  document.documentElement.dataset.auraTheme = selected;
  themeOptions.forEach((option) => {
    const active = option.dataset.auraThemeOption === selected;
    option.setAttribute("aria-pressed", String(active));
  });
  if (persist) {
    try { window.localStorage.setItem(THEME_STORAGE_KEY, selected); } catch (error) { /* CEP storage can be unavailable; the current session still updates. */ }
  }
  return selected;
}

function setPanelMenuOpen(open, restoreFocus) {
  const isOpen = Boolean(open);
  panelMenu.classList.toggle("hidden", !isOpen);
  panelMenuButton.setAttribute("aria-expanded", String(isOpen));
  panelMenuButton.setAttribute("aria-label", isOpen ? "Close OBSIDIAN appearance menu" : "Open OBSIDIAN appearance menu");
  if (isOpen) {
    const selected = themeOptions.find((option) => option.getAttribute("aria-pressed") === "true");
    (selected || themeOptions[0] || panelMenuButton).focus();
  } else if (restoreFocus) {
    panelMenuButton.focus();
  }
}

let savedTheme = "mint";
try {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (AVAILABLE_THEMES.includes(storedTheme)) savedTheme = storedTheme;
} catch (error) { /* Keep the accessible default theme when CEP storage is unavailable. */ }
applyTheme(savedTheme, false);

panelMenuButton.addEventListener("click", () => {
  setPanelMenuOpen(panelMenu.classList.contains("hidden"), false);
});

themeOptions.forEach((option) => {
  option.addEventListener("click", () => {
    applyTheme(option.dataset.auraThemeOption, true);
    setPanelMenuOpen(false, true);
  });
});

document.addEventListener("click", (event) => {
  if (!panelMenu.classList.contains("hidden") && !panelMenu.contains(event.target) && !panelMenuButton.contains(event.target)) {
    setPanelMenuOpen(false, false);
  }
});

function activePanelOperationMessage() {
  if (activeCaptionRun && !activeCaptionRun.cancelled) return "local caption transcription";
  if (commandInFlight) return "an OBSIDIAN command or caption operation";
  if (proposalInFlight) return "a CORE proposal";
  if (hostOperationsInFlight > 0) return "an After Effects host operation";
  if (microphonePermissionPending || (mediaRecorder && mediaRecorder.state === "recording")) return "a microphone recording";
  return "another active operation";
}

function isPanelOperationActive() {
  return Boolean(commandInFlight || proposalInFlight || hostOperationsInFlight > 0 ||
    (activeCaptionRun && !activeCaptionRun.cancelled) || microphonePermissionPending ||
    (mediaRecorder && mediaRecorder.state === "recording"));
}

function resetStatus() {
  result.classList.add("hidden");
  workingStatusController.clear();
}

function renderWorkingStatus(state) {
  const nodes = [
    { root: progress, label: progressLabel },
    { root: captionWorkingStatus, label: captionWorkingLabel },
  ];
  if (!state) {
    nodes.forEach(({ root, label }) => {
      root.classList.add("hidden");
      root.removeAttribute("data-state");
      root.removeAttribute("data-stage");
      label.textContent = "";
    });
    welcomeOrb.removeAttribute("data-state");
    progressValue.textContent = "";
    return;
  }
  const terminal = state.stage === "completed" || state.stage === "failed";
  const displayState = state.stage === "completed" ? "complete" : state.stage === "failed" ? "error" : "working";
  nodes.forEach(({ root, label }) => {
    root.classList.remove("hidden");
    root.dataset.state = displayState;
    root.dataset.stage = state.stage;
    label.textContent = state.label;
    label.setAttribute("aria-label", state.label);
    label.style.animation = "none";
    void label.offsetWidth;
    label.style.animation = "";
  });
  welcomeOrb.dataset.state = terminal ? displayState : "working";
  progressValue.textContent = "";
}

const workingStatusController = window.OBSIDIANWorkingStatus.createController(renderWorkingStatus);

function setProgress(stage) {
  if (stage === null || stage === undefined || stage === "") {
    workingStatusController.clear();
    return;
  }
  workingStatusController.set(stage);
}

function showResult(message, isError, state) {
  const visibleState = ["success", "warning", "error"].includes(state)
    ? state
    : isError ? "error" : "success";
  resultText.textContent = message;
  result.classList.remove("hidden");
  result.dataset.state = visibleState;
  result.setAttribute("aria-label", visibleState === "error" ? "OBSIDIAN error" : visibleState === "warning" ? "OBSIDIAN warning" : "OBSIDIAN result");
  result.querySelector(".result-mark").textContent = visibleState === "error" ? "!" : visibleState === "warning" ? "·" : "✓";
}

function setCaptionStatus(message, isError) {
  captionStatus.textContent = message || "";
  captionStatus.classList.toggle("error", Boolean(isError));
}

function renderCaptionSourceSummary(source) {
  if (!source) {
    captionSourceSummary.textContent = "No footage inspected";
    captionSourceSummary.dataset.state = "empty";
    return;
  }
  const start = Number(source.inPoint).toFixed(2);
  const end = Number(source.outPoint).toFixed(2);
  captionSourceSummary.textContent = String(source.layerName) + " · " + start + "–" + end + " s · " + String(source.compName);
  captionSourceSummary.dataset.state = "ready";
}

function setCaptionSaveState(state, label) {
  captionSaveState.dataset.state = state;
  captionSaveState.textContent = label;
}

function persistCaptionDraft() {
  captionDraftSaveTimer = null;
  const draft = {
    text: captionTranscript.value,
    source: selectedCaptionSource,
    mode: captionMode.value,
    savedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(CAPTION_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    setCaptionSaveState(captionTranscript.value ? "saved" : "empty", captionTranscript.value ? "SAVED LOCALLY" : "NO DRAFT");
  } catch (error) {
    setCaptionSaveState("error", "NOT SAVED");
  }
}

function scheduleCaptionDraftSave() {
  setCaptionSaveState("unsaved", "UNSAVED");
  if (captionDraftSaveTimer !== null) window.clearTimeout(captionDraftSaveTimer);
  captionDraftSaveTimer = window.setTimeout(persistCaptionDraft, 350);
}

function restoreCaptionDraft() {
  try {
    const raw = window.localStorage.getItem(CAPTION_DRAFT_STORAGE_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (!draft || typeof draft.text !== "string") return;
    captionTranscript.value = draft.text;
    if (draft.mode === "phrase" || draft.mode === "word") captionMode.value = draft.mode;
    const source = draft.source;
    if (source && typeof source.path === "string" && typeof source.layerName === "string" &&
        typeof source.compName === "string" && [source.layerIndex, source.inPoint, source.outPoint, source.startTime,
          source.stretch, source.frameRate, source.compDuration, source.compWidth, source.compHeight].every(Number.isFinite)) {
      selectedCaptionSource = source;
      renderCaptionSourceSummary(source);
      const parsed = window.OBSIDIANCaptions.parseSrt(draft.text);
      captionsCreateButton.disabled = !parsed.ok;
    }
    setCaptionSaveState(draft.text ? "saved" : "empty", draft.text ? "SAVED LOCALLY" : "NO DRAFT");
    updateCaptionStylePreview();
  } catch (error) {
    setCaptionSaveState("error", "DRAFT UNAVAILABLE");
  }
}

function setCaptionStyleStatus(message, isError) {
  captionStyleStatus.textContent = message || "";
  captionStyleStatus.classList.toggle("error", Boolean(isError));
}

function setCaptionStyleValidation(message) {
  if (message) {
    captionStyleStatus.dataset.validation = "font-size";
    setCaptionStyleStatus(message, true);
  } else if (captionStyleStatus.dataset.validation === "font-size") {
    delete captionStyleStatus.dataset.validation;
    setCaptionStyleStatus("");
  }
}

function captionFontSizeValidationError() {
  const baseSize = Number(captionStyleInputs.size.value);
  const fitFloor = Number(captionStyleInputs.minSize.value);
  if (!Number.isFinite(baseSize) || baseSize < 0.1 || baseSize > 1296) {
    return "Base size must be between 0.1 and 1,296 px, the range supported by After Effects.";
  }
  if (!Number.isFinite(fitFloor) || fitFloor < 0.1 || fitFloor > baseSize) {
    return "Auto-fit floor must be at least 0.1 px and no larger than the base size.";
  }
  return "";
}

function switchCaptionWorkspace(view) {
  const studio = view === "studio";
  captionReviewSpace.classList.toggle("hidden", studio);
  captionStyleStudio.classList.toggle("hidden", !studio);
  captionReviewTab.classList.toggle("selected", !studio);
  captionStudioTab.classList.toggle("selected", studio);
  captionReviewTab.setAttribute("aria-selected", String(!studio));
  captionStudioTab.setAttribute("aria-selected", String(studio));
  captionReviewTab.setAttribute("aria-pressed", String(!studio));
  captionStudioTab.setAttribute("aria-pressed", String(studio));
  captionReviewTab.tabIndex = studio ? -1 : 0;
  captionStudioTab.tabIndex = studio ? 0 : -1;
  if (studio) updateCaptionStylePreview();
}

function getCaptionStyleDraft() {
  const studio = window.OBSIDIANCaptionStyleStudio;
  if (!studio) return null;
  return studio.normalizeStyle({
    version: 1,
    font: captionStyleInputs.font.value.trim(),
    fontSize: Number(captionStyleInputs.size.value),
    minFontSize: Number(captionStyleInputs.minSize.value),
    fillColor: studio.fromHex(captionStyleInputs.fill.value),
    fillEnabled: captionStyleInputs.fillEnabled.checked,
    strokeEnabled: captionStyleInputs.strokeEnabled.checked,
    strokeColor: studio.fromHex(captionStyleInputs.stroke.value),
    strokeWidth: Number(captionStyleInputs.strokeWidth.value),
    alignment: captionStyleInputs.alignment.value,
    positionX: Number(captionStyleInputs.x.value) / 100,
    positionY: Number(captionStyleInputs.y.value) / 100,
    animation: selectedCaptionAnimation,
    animationDuration: Number(captionStyleInputs.duration.value)
  });
}

function getCaptionPreviewSegments() {
  const parsed = window.OBSIDIANCaptions.parseSrt(captionTranscript.value);
  if (parsed.ok) return parsed.segments;
  return [{ text: captionStylePreviewText.textContent || "THE STORY BEGINS HERE", start: 0, end: 2 }];
}

function updateCaptionStylePreview() {
  const studio = window.OBSIDIANCaptionStyleStudio;
  const sizeError = captionFontSizeValidationError();
  const style = getCaptionStyleDraft();
  if (sizeError) setCaptionStyleValidation(sizeError);
  else setCaptionStyleValidation("");
  if (!studio || !style) {
    captionStyleFitLabel.textContent = "CHECK STYLE VALUES";
    captionStyleImplement.disabled = true;
    return;
  }
  const segments = getCaptionPreviewSegments();
  const width = selectedCaptionSource && selectedCaptionSource.compWidth || 1920;
  const height = selectedCaptionSource && selectedCaptionSource.compHeight || 1080;
  const fit = studio.fitStyle(style, segments, width, height);
  const text = segments[0] && segments[0].text || "THE STORY BEGINS HERE";
  captionStylePreviewText.textContent = text;
  captionStyleFitLabel.textContent = fit.ok
    ? Math.abs(fit.style.fontSize - style.fontSize) > 0.05
      ? "FIT " + Math.round(fit.style.fontSize) + "PX FROM " + Math.round(style.fontSize) + "PX"
      : "BATCH SIZE " + Math.round(fit.style.fontSize) + "PX · UP TO " + fit.maxLines + " LINES"
    : "FIT NEEDS REVIEW";
  const hex = studio.toHex(style.fillColor);
  const stroke = studio.toHex(style.strokeColor);
  captionStylePreviewAnchor.style.left = (style.positionX * 100) + "%";
  captionStylePreviewAnchor.style.top = (style.positionY * 100) + "%";
  captionStylePreviewAnchor.style.textAlign = style.alignment;
  const horizontalAnchor = style.alignment === "left" ? "0%" : style.alignment === "right" ? "-100%" : "-50%";
  const verticalAnchor = style.positionY >= 0.5 ? "-100%" : "0%";
  captionStylePreviewAnchor.style.transform = "translate(" + horizontalAnchor + "," + verticalAnchor + ")";
  captionStylePreviewAnchor.style.width = (fit.ok ? fit.boxWidth / width * 100 : 96) + "%";
  captionStylePreviewText.style.color = style.fillEnabled ? hex : "transparent";
  captionStylePreviewText.style.fontFamily = '"' + style.font.replace(/["\\]/g, "") + '", Arial, sans-serif';
  const previewSize = fit.ok ? fit.style.fontSize : style.fontSize;
  captionStylePreviewText.style.fontSize = Math.max(7, Math.min(28, previewSize * captionStylePreview.clientHeight / 600)) + "px";
  captionStylePreviewText.style.webkitTextStroke = style.strokeEnabled ? Math.max(0.4, style.strokeWidth * 0.28) + "px " + stroke : "0 transparent";
  captionStylePreviewText.style.textShadow = style.strokeEnabled ? "0 1px 4px " + stroke : "0 1px 4px rgba(0,0,0,.75)";
  const animationNames = {
    fade: "style-preview-fade",
    pop: "style-preview-pop",
    smooth_scale: "style-preview-smooth",
    slide: "style-preview-slide",
    typewriter: "style-preview-typewriter",
    word_emphasis: "style-preview-emphasis"
  };
  captionStylePreviewText.style.animation = "none";
  void captionStylePreviewText.offsetWidth;
  captionStylePreviewText.style.animation = animationNames[style.animation]
    ? animationNames[style.animation] + " " + style.animationDuration + "s " + (style.animation === "typewriter" ? "steps(12,end)" : "ease") + " both"
    : "none";
  captionStyleImplement.disabled = !captionTranscript.value.trim() || !fit.ok || !selectedCaptionSource;
  captionStyleInputs.x.nextElementSibling.textContent = Math.round(style.positionX * 100) + "%";
  captionStyleInputs.y.nextElementSibling.textContent = Math.round(style.positionY * 100) + "%";
  if (!fit.ok && captionTranscript.value.trim()) setCaptionStyleStatus(fit.error, true);
}

function renderCaptionPalette() {
  const colors = ["#ffffff", "#ffe16b", "#68e4d2", "#b7a4ff", "#ff8fa3", "#111827"];
  captionStylePalette.textContent = "";
  colors.forEach((color) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "style-palette-chip";
    chip.style.setProperty("--chip-color", color);
    chip.title = "Use " + color + " as caption fill";
    chip.setAttribute("aria-label", "Use caption color " + color);
    chip.addEventListener("click", () => {
      captionStyleInputs.fill.value = color;
      refreshCaptionStylePreview();
    });
    captionStylePalette.appendChild(chip);
  });
}

renderCaptionPalette();
captionReviewTab.addEventListener("click", () => switchCaptionWorkspace("review"));
captionStudioTab.addEventListener("click", () => switchCaptionWorkspace("studio"));

function handleCaptionTabKeydown(event, activeTab) {
  const tabs = [captionReviewTab, captionStudioTab];
  const current = tabs.indexOf(activeTab);
  let next = current;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % tabs.length;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current + tabs.length - 1) % tabs.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = tabs.length - 1;
  else return;
  event.preventDefault();
  tabs[next].focus();
  switchCaptionWorkspace(next === 1 ? "studio" : "review");
}

captionReviewTab.addEventListener("keydown", (event) => handleCaptionTabKeydown(event, captionReviewTab));
captionStudioTab.addEventListener("keydown", (event) => handleCaptionTabKeydown(event, captionStudioTab));
function refreshCaptionStylePreview() {
  updateCaptionStylePreview();
}
captionStyleInputs.font.addEventListener("input", refreshCaptionStylePreview);
captionStyleInputs.size.addEventListener("input", refreshCaptionStylePreview);
captionStyleInputs.minSize.addEventListener("input", refreshCaptionStylePreview);
captionStyleInputs.alignment.addEventListener("change", refreshCaptionStylePreview);
captionStyleInputs.fill.addEventListener("input", refreshCaptionStylePreview);
captionStyleInputs.fillEnabled.addEventListener("change", refreshCaptionStylePreview);
captionStyleInputs.stroke.addEventListener("input", refreshCaptionStylePreview);
captionStyleInputs.strokeEnabled.addEventListener("change", refreshCaptionStylePreview);
captionStyleInputs.strokeWidth.addEventListener("input", refreshCaptionStylePreview);
captionStyleInputs.x.addEventListener("input", refreshCaptionStylePreview);
captionStyleInputs.y.addEventListener("input", refreshCaptionStylePreview);
captionStyleInputs.duration.addEventListener("input", refreshCaptionStylePreview);
document.querySelectorAll("[data-caption-animation]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedCaptionAnimation = button.dataset.captionAnimation;
    document.querySelectorAll("[data-caption-animation]").forEach((choice) => {
      const selected = choice === button;
      choice.classList.toggle("selected", selected);
      choice.setAttribute("aria-pressed", String(selected));
    });
    updateCaptionStylePreview();
  });
});
captionStyleImplement.addEventListener("click", () => createCaptionLayers());

const CAPTION_PIPELINE_STAGES = window.OBSIDIANCaptionProgress.STAGES;
const CAPTION_REQUEST_TIMEOUT_MS = 22 * 60 * 1000;
const captionProgressController = window.OBSIDIANCaptionProgress.createController((state) => {
  if (state.mode === "running") setProgress(state.stage);
  else if (state.mode === "error") setProgress("failed");
  else if (state.mode === "hidden") setProgress(null);
  captionPipeline.dataset.mode = state.mode;
  captionPipelineError.classList.toggle("hidden", state.mode !== "error");
  captionPipelineError.textContent = state.mode === "error"
    ? "Caption transcription failed during " + String(state.stage || "the local pipeline").replace(/_/g, " ") + ": " + state.message
    : "";
  if (state.mode === "hidden") {
    captionPipeline.classList.add("hidden");
    captionProgressLine.classList.remove("hidden");
    captionProgressLine.removeAttribute("aria-valuenow");
    captionProgressLine.removeAttribute("aria-valuetext");
    return;
  }
  captionPipeline.classList.remove("hidden");
  captionProgressLine.classList.toggle("hidden", state.mode === "error");
  captionProgressLine.setAttribute("aria-busy", state.mode === "running" || state.mode === "leaving" ? "true" : "false");
  if (state.mode === "running") {
    const stageName = String(state.stage || "local caption processing").replace(/_/g, " ");
    if (Number.isFinite(state.current) && Number.isFinite(state.total) && state.total > 0) {
      const percent = Math.floor(state.current * 100 / state.total);
      captionProgressLine.setAttribute("aria-valuenow", String(Math.max(0, Math.min(100, percent))));
      captionProgressLine.setAttribute("aria-valuetext", "Whisper processed " + state.current + " of " + state.total + " audio frames.");
    } else {
      captionProgressLine.removeAttribute("aria-valuenow");
      captionProgressLine.setAttribute("aria-valuetext", "Current operation: " + stageName + ".");
    }
  }
});

function emitCaptionProgress(run, event) {
  if (!run || run.cancelled || activeCaptionRun !== run) return Promise.resolve();
  if (event && event.type === "stage" && event.phase === "start") run.stage = event.stage;
  return captionProgressController.handle(event, run.id);
}

function startCaptionPipeline() {
  const run = { id: ++captionRunSequence, stage: "analyzing_footage", cancelled: false, request: null };
  activeCaptionRun = run;
  captionProgressController.begin(run.id);
  emitCaptionProgress(run, { type: "stage", phase: "start", stage: "analyzing_footage" });
  return run;
}

async function failCaptionPipeline(error, fallbackStage, run) {
  const targetRun = run || activeCaptionRun;
  if (!targetRun || targetRun.cancelled) return;
  const stage = error && error.stage || targetRun.stage || fallbackStage;
  const readable = error instanceof Error ? error.message : String(error || "Unknown transcription error.");
  await captionProgressController.fail(stage, readable, targetRun.id);
}

async function completeCaptionPipeline(run) {
  if (!run || run.cancelled) return;
  await emitCaptionProgress(run, { type: "stage", phase: "start", stage: "completed" });
  await emitCaptionProgress(run, { type: "stage", phase: "complete", stage: "completed" });
  await captionProgressController.finish(run.id);
  setProgress("completed");
}

function getCepPanelExtensionId() {
  const cep = window.__adobe_cep__;
  if (!cep || typeof cep.getExtensionId !== "function") {
    throw new Error("Local transcription is available only inside the OBSIDIAN CEP panel.");
  }
  const extensionId = String(cep.getExtensionId() || "").trim();
  if (!extensionId) throw new Error("After Effects did not identify the OBSIDIAN CEP panel.");
  return extensionId;
}

function requestTranscription(path, range, onEvent) {
  const xhr = new XMLHttpRequest();
  let responseOffset = 0;
  let lineBuffer = "";
  let result = null;
  let failure = null;
  let lastProgressWork = Promise.resolve();
  const promise = new Promise((resolve, reject) => {
    let extensionId;
    try {
      extensionId = getCepPanelExtensionId();
    } catch (error) {
      reject(error);
      return;
    }
    const consume = (text) => {
      lineBuffer += text;
      let newline;
      while ((newline = lineBuffer.indexOf("\n")) !== -1) {
        const line = lineBuffer.slice(0, newline).replace(/\r$/, "");
        lineBuffer = lineBuffer.slice(newline + 1);
        if (line) consumeEvent(line);
      }
    };
    const consumeEvent = (line) => {
      let event;
      try { event = JSON.parse(line); } catch {
        failure = new Error("The local transcription service sent an invalid progress event.");
        return;
      }
      if (event.type === "stage") {
        if (!CAPTION_PIPELINE_STAGES.includes(event.stage) || (event.phase !== "start" && event.phase !== "complete") ||
            (event.description !== undefined && typeof event.description !== "string")) {
          failure = new Error("The local transcription service sent an invalid stage lifecycle event.");
          return;
        }
        lastProgressWork = Promise.resolve(onEvent(event));
      } else if (event.type === "progress") {
        if (event.stage !== "transcribing" || typeof event.current !== "number" || typeof event.total !== "number" ||
            !Number.isFinite(event.current) || !Number.isFinite(event.total) || event.total <= 0 || event.current < 0 || event.current > event.total) {
          failure = new Error("The local transcription service sent invalid measured progress data.");
          return;
        }
        lastProgressWork = Promise.resolve(onEvent(event));
      } else if (event.type === "result") {
        result = event;
      } else if (event.type === "error") {
        failure = new Error(event.message || "Local transcription failed.");
        failure.stage = CAPTION_PIPELINE_STAGES.includes(event.stage) ? event.stage : (activeCaptionRun && activeCaptionRun.stage);
        failure.status = event.status;
      } else {
        failure = new Error("The local transcription service returned an unknown event.");
      }
    };
    xhr.open("POST", "http://127.0.0.1:43127/transcribe", true);
    xhr.timeout = CAPTION_REQUEST_TIMEOUT_MS;
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("X-Obsidian-CEP-Extension-Id", extensionId);
    xhr.onprogress = () => {
      const text = xhr.responseText.slice(responseOffset);
      responseOffset = xhr.responseText.length;
      consume(text);
    };
    xhr.onload = () => {
      if ((xhr.getResponseHeader("Content-Type") || "").toLowerCase().indexOf("application/json") !== -1) {
        let json;
        try { json = JSON.parse(xhr.responseText); } catch { json = null; }
        if (xhr.status < 200 || xhr.status >= 300 || !json || !json.transcript) {
          const error = new Error(json && json.error || "The local transcription service returned an invalid response.");
          error.stage = activeCaptionRun && activeCaptionRun.stage;
          reject(error);
          return;
        }
        Promise.resolve(lastProgressWork).then(() => resolve(json));
        return;
      }
      const text = xhr.responseText.slice(responseOffset);
      if (text) consume(text);
      if (lineBuffer.trim()) consumeEvent(lineBuffer.trim());
      if (xhr.status < 200 || xhr.status >= 300) {
        if (!failure) {
          let message = "The local transcription service returned HTTP " + xhr.status + ".";
          try { message = JSON.parse(xhr.responseText).error || message; } catch { /* NDJSON errors are handled above. */ }
          failure = new Error(message);
        }
      }
      Promise.resolve(lastProgressWork).then(() => {
        if (failure) reject(failure);
        else if (!result || result.processing !== "local" || !result.transcript || !Array.isArray(result.transcript.segments)) reject(new Error("The local transcription service returned an incomplete result."));
        else resolve(result);
      });
    };
    xhr.onerror = () => {
      const error = new Error("The local transcription service could not be reached at 127.0.0.1:43127.");
      error.stage = activeCaptionRun && activeCaptionRun.stage || "connecting_service";
      reject(error);
    };
    xhr.ontimeout = () => {
      const error = new Error("Local transcription exceeded its 22-minute request limit.");
      error.stage = activeCaptionRun && activeCaptionRun.stage;
      reject(error);
    };
    xhr.onabort = () => {
      const error = new Error("Transcription was cancelled.");
      error.stage = activeCaptionRun && activeCaptionRun.stage;
      reject(error);
    };
    xhr.send(JSON.stringify({ path, range }));
  });
  return { promise, abort: () => xhr.abort() };
}

function cancelCaptionTranscription() {
  if (!activeCaptionRun || activeCaptionRun.cancelled) return;
  const run = activeCaptionRun;
  run.cancelled = true;
  captionProgressController.cancel(run.id);
  if (run.request) run.request.abort();
  setProgress(null);
  setCaptionStatus("Transcription was cancelled. No After Effects project changes were made.");
}

function openCaptionWorkspace(mode) {
  if (captionWorkspace.classList.contains("hidden")) captionReturnFocus = document.activeElement;
  applicationShell.classList.add("caption-open");
  captionWorkspace.classList.remove("hidden");
  if ((mode === "word" || mode === "phrase") && !captionTranscript.value.trim()) captionMode.value = mode;
  switchCaptionWorkspace("review");
  setCaptionStatus("");
  renderCaptionSourceSummary(selectedCaptionSource);
  captionsTranscribeButton.focus();
}

function closeCaptionWorkspace() {
  if (activeCaptionRun && !activeCaptionRun.cancelled) {
    cancelCaptionTranscription();
  }
  captionWorkspace.classList.add("hidden");
  applicationShell.classList.remove("caption-open");
  const returnTarget = captionReturnFocus;
  captionReturnFocus = null;
  if (returnTarget && typeof returnTarget.focus === "function") returnTarget.focus();
  else commandInput.focus();
}

captionsOpenButton.addEventListener("click", () => openCaptionWorkspace("phrase"));
captionsCloseButton.addEventListener("click", closeCaptionWorkspace);
captionsCancelButton.addEventListener("click", closeCaptionWorkspace);

function parseCaptionSource(raw) {
  const fields = String(raw || "").split("|");
  if (fields.length !== 15 || fields[0] !== "OK" || fields[1] !== "CAPTION_SOURCE") {
    throw new Error("After Effects returned incomplete selected footage information.");
  }
  const decode = (value) => window.unescape(value);
  const source = {
    path: decode(fields[2]),
    layerName: decode(fields[3]),
    layerId: decode(fields[4]),
    layerIndex: Number(fields[5]),
    inPoint: Number(fields[6]),
    outPoint: Number(fields[7]),
    startTime: Number(fields[8]),
    stretch: Number(fields[9]),
    frameRate: Number(fields[10]),
    compDuration: Number(fields[11]),
    compWidth: Number(fields[12]),
    compHeight: Number(fields[13]),
    compName: decode(fields[14])
  };
  if (!source.path || !source.layerName || !source.compName ||
      ![source.layerIndex, source.inPoint, source.outPoint, source.startTime, source.stretch,
        source.frameRate, source.compDuration, source.compWidth, source.compHeight].every(Number.isFinite)) {
    throw new Error("After Effects returned invalid footage timing information.");
  }
  return source;
}

function executeHostOperation(expression, timeoutMs) {
  hostOperationsInFlight++;
  let operation;
  try {
    operation = window.OBSIDIANHostBridge.execute(
      window.__adobe_cep__.evalScript.bind(window.__adobe_cep__),
      expression,
      timeoutMs
    );
  } catch (error) {
    hostOperationsInFlight--;
    return Promise.reject(error);
  }
  return Promise.resolve(operation).finally(() => {
    hostOperationsInFlight = Math.max(0, hostOperationsInFlight - 1);
  });
}

function evalHostAction(action, value) {
  if (!window.__adobe_cep__ || typeof window.__adobe_cep__.evalScript !== "function" ||
      !window.OBSIDIANHostBridge || typeof window.OBSIDIANHostBridge.execute !== "function") {
    return Promise.resolve({ status: "failed", message: "The After Effects host bridge is unavailable." });
  }
  let expression;
  try {
    expression = window.OBSIDIANHostBridge.buildExpression(action, value);
  } catch (error) {
    return Promise.resolve({ status: "rejected", message: error instanceof Error ? error.message : String(error) });
  }
  return executeHostOperation(expression, action === "create_captions"
    ? window.OBSIDIANHostBridge.CAPTION_CREATION_TIMEOUT_MS
    : undefined);
}

async function transcribeSelectedFootage() {
  if (commandInFlight || proposalInFlight || activeCaptionRun) {
    setCaptionStatus("Wait for the current OBSIDIAN request to finish.", true);
    return;
  }
  const run = startCaptionPipeline();
  const planner = window.OBSIDIANPlanner;
  let inspectionPlan;
  try {
    inspectionPlan = planner && planner.planObsidianCommand("inspect caption source for selected footage");
    if (!planner || !inspectionPlan || inspectionPlan.action !== "inspect_caption_source" || !planner.isExecutablePlan(inspectionPlan)) {
      throw new Error("OBSIDIAN could not prepare the read-only footage inspection.");
    }
  } catch (error) {
    await failCaptionPipeline(error, "analyzing_footage", run);
    setCaptionStatus(error instanceof Error ? error.message : String(error), true);
    activeCaptionRun = null;
    return;
  }

  commandInFlight = true;
  captionsTranscribeButton.disabled = true;
  captionsCreateButton.disabled = true;
  setCaptionStatus("");
  let inspectedSource = null;
  const previousCaptionSource = selectedCaptionSource;
  try {
    const sourceResult = await evalHostAction("inspect_caption_source", null);
    if (run.cancelled) return;
    if (sourceResult.status !== "verified") throw new Error(sourceResult.message);
    inspectedSource = parseCaptionSource(sourceResult.raw);
    renderCaptionSourceSummary(inspectedSource);
    const rangeResult = window.OBSIDIANCaptions.getTranscriptionRange(inspectedSource);
    if (!rangeResult.ok) {
      const error = new Error(rangeResult.error);
      error.stage = "validating";
      throw error;
    }
    await emitCaptionProgress(run, { type: "stage", phase: "complete", stage: "analyzing_footage" });
    await emitCaptionProgress(run, { type: "stage", phase: "start", stage: "connecting_service" });
    const request = requestTranscription(inspectedSource.path, rangeResult.range, (event) => {
      if (event.type === "stage" && event.phase === "start" && event.stage === "validating") {
        return emitCaptionProgress(run, { type: "stage", phase: "complete", stage: "connecting_service" })
          .then(() => emitCaptionProgress(run, event));
      }
      return emitCaptionProgress(run, event);
    });
    run.request = request;
    const data = await request.promise;
    if (run.cancelled) return;
    if (data.processing !== "local" || !data.transcript || !Array.isArray(data.transcript.segments)) {
      const error = new Error("Local transcription returned an invalid transcript response.");
      error.stage = run.stage;
      throw error;
    }
    await emitCaptionProgress(run, { type: "stage", phase: "start", stage: "reviewing" });
    const captions = window.OBSIDIANCaptions;
    const mapped = captions.toCaptionSegments(data.transcript, inspectedSource, captionMode.value, inspectedSource.frameRate);
    if (!mapped.ok) throw new Error(mapped.error);
    selectedCaptionSource = inspectedSource;
    renderCaptionSourceSummary(selectedCaptionSource);
    captionTranscript.value = captions.formatSrt(mapped.segments);
    await emitCaptionProgress(run, { type: "stage", phase: "complete", stage: "reviewing" });
    captionsCreateButton.disabled = false;
    updateCaptionStylePreview();
    setCaptionStatus("Local transcript ready: " + mapped.segments.length + " " + (captionMode.value === "word" ? "word" : "phrase") + " caption(s). Review and edit before creating layers.");
    scheduleCaptionDraftSave();
    await completeCaptionPipeline(run);
    captionTranscript.focus();
  } catch (error) {
    if (run.cancelled) {
      renderCaptionSourceSummary(previousCaptionSource);
      return;
    }
    const detail = error instanceof Error ? error.message : String(error);
    await failCaptionPipeline(error, error.stage || run.stage, run);
    setCaptionStatus(detail + (detail.indexOf("127.0.0.1") !== -1 || detail.indexOf("fetch") !== -1
      ? " Start the local service with `npm run obsidian:ai`."
      : ""), true);
    renderCaptionSourceSummary(previousCaptionSource);
    updateCaptionStylePreview();
  } finally {
    commandInFlight = false;
    captionsTranscribeButton.disabled = false;
    if (activeCaptionRun === run) activeCaptionRun = null;
  }
}

async function createCaptionLayers() {
  if (commandInFlight || proposalInFlight) {
    setCaptionStatus("Wait for the current OBSIDIAN request to finish.", true);
    return;
  }
  const captions = window.OBSIDIANCaptions;
  const planner = window.OBSIDIANPlanner;
  if (!captions || !planner || typeof planner.planCaptionCreation !== "function" || !selectedCaptionSource) {
    setProgress("failed");
    setCaptionStatus("Transcribe the selected footage before creating captions.", true);
    return;
  }
  setProgress("validating");
  const parsed = captions.parseSrt(captionTranscript.value);
  if (!parsed.ok) {
    setProgress("failed");
    setCaptionStatus(parsed.error, true);
    return;
  }
  const approvedStyle = getCaptionStyleDraft();
  const plan = planner.planCaptionCreation(parsed.segments, selectedCaptionSource, approvedStyle);
  if (!plan || !planner.isExecutablePlan(plan)) {
    setProgress("failed");
    const message = plan && plan.question ? plan.question : "The caption plan did not pass planner validation.";
    setCaptionStatus(message, true);
    setCaptionStyleStatus(message, true);
    return;
  }

  commandInFlight = true;
  captionsCreateButton.disabled = true;
  captionsTranscribeButton.disabled = true;
  captionStyleImplement.disabled = true;
  setCaptionStatus("");
  setCaptionStyleStatus("");
  setProgress("implementing");
  try {
    const result = await evalHostAction("create_captions", plan.args);
    const verified = result.status === "verified";
    setCaptionStatus(result.message + (plan.explanation ? " " + plan.explanation : ""), !verified);
    setCaptionStyleStatus(result.message, !verified);
    if (verified) {
      setProgress("completed");
      captionsCreateButton.disabled = true;
      captionStyleImplement.disabled = true;
      showResult(result.message, false);
    } else {
      setProgress("failed");
      captionsCreateButton.disabled = false;
      updateCaptionStylePreview();
    }
  } catch (error) {
    setProgress("failed");
    setCaptionStatus(error instanceof Error ? error.message : String(error), true);
    setCaptionStyleStatus(error instanceof Error ? error.message : String(error), true);
    captionsCreateButton.disabled = false;
  } finally {
    commandInFlight = false;
    captionsTranscribeButton.disabled = false;
    if (captionTranscript.value.trim()) updateCaptionStylePreview();
  }
}

captionsTranscribeButton.addEventListener("click", transcribeSelectedFootage);
captionsCreateButton.addEventListener("click", () => createCaptionLayers());
captionTranscript.addEventListener("input", () => {
  updateCaptionStylePreview();
  scheduleCaptionDraftSave();
});
captionMode.addEventListener("change", scheduleCaptionDraftSave);
restoreCaptionDraft();

function showRecipePlan(plan, note) {
  const recipe = plan.recipe;
  const look = recipe.look || {};
  const lines = [
    recipe.name + " direction",
    "Intent: " + (recipe.intent || []).join(", "),
    "Palette: " + (look.palette || []).join(", "),
    "Lighting: " + (look.lighting || []).join(", "),
    "Atmosphere: " + (look.atmosphere || []).join(", "),
    "Contrast: " + (look.contrast || "inspect footage before deciding"),
    "Parameters: " + JSON.stringify(recipe.parameters || {}),
    "Workflow: " + (recipe.steps || []).map((step) => step.order + ". " + step.label + " [" + step.status + "]").join(" → "),
    "Prerequisites: " + (recipe.prerequisites || []).join(", "),
    "Compatibility: " + (recipe.compatibility || "Confirm against the active project."),
    "Readiness: " + (recipe.executionReadiness || "PROPOSED"),
    "Safe fallback: " + (recipe.fallback || "Keep the project unchanged until a supported action is confirmed."),
    "Not applied: this is a proposal, not an executed edit."
  ];
  if (note) lines.push(note);
  showResult(lines.join("\n"), false, note ? "warning" : undefined);
}

function showCoreProposal(proposal) {
  const lines = [
    "CORE creative proposal (PROPOSED)",
    proposal.summary,
    "Intent: " + proposal.visualIntent,
    "Parameters: " + Object.entries(proposal.parameters || {}).map(([key, value]) => key + ": " + value).join("; "),
    "Prerequisites: " + proposal.prerequisites.join("; "),
    "Workflow: " + proposal.workflow.map((step, index) => (index + 1) + ". " + step).join(" → "),
    "Safety: " + proposal.safety,
    "Not applied: model output is proposal-only and cannot execute host actions."
  ];
  showResult(lines.join("\n"), false);
}

async function requestCoreProposal(command, fallbackPlan) {
  proposalInFlight = true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 95_000);
  setProgress("connecting_to_core");
  let ollamaStatus = null;
  try {
    const healthController = new AbortController();
    const healthTimeout = window.setTimeout(() => healthController.abort(), 3_000);
    let health;
    try {
      const healthResponse = await fetch("http://127.0.0.1:43127/health", { signal: healthController.signal });
      health = await healthResponse.json();
    } finally {
      window.clearTimeout(healthTimeout);
    }
    ollamaStatus = health && health.ollama;
    if (ollamaStatus && ollamaStatus.state !== "ready") throw new Error(ollamaStatus.message);
    setProgress("thinking");
    const response = await fetch("http://127.0.0.1:43127/proposal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: command }),
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok || !data.proposal || data.proposal.executionReadiness !== "PROPOSED" || data.proposal.executable !== false) {
      throw new Error(data.error || "CORE returned an invalid proposal.");
    }
    showCoreProposal(data.proposal);
    setProgress("completed");
  } catch (error) {
    const detail = controller.signal.aborted
      ? "CORE timed out while waiting for the local model. Check Ollama and the configured model."
      : error instanceof Error ? error.message : String(error);
    if (fallbackPlan && fallbackPlan.status === "style_plan") {
      const stopped = ollamaStatus && ollamaStatus.state === "stopped";
      showRecipePlan(fallbackPlan, stopped
        ? detail + " The OBSIDIAN service is available; retry after the existing Ollama service starts."
        : "CORE unavailable: " + detail + " Run `npm run obsidian:ai` if the OBSIDIAN proposal service is stopped.");
      setProgress("failed");
      return;
    }
    setProgress("failed");
    const availability = ollamaStatus && ollamaStatus.state === "stopped"
      ? detail + " The OBSIDIAN service remains available and did not launch another Ollama instance."
      : ollamaStatus && ollamaStatus.state === "model_missing"
        ? detail + " Install the configured model in the existing Ollama service, then retry."
        : "Local CORE could not prepare a proposal. " + detail;
    showResult(availability + "\n\n" + ((fallbackPlan && fallbackPlan.question) || "No safe deterministic plan was found. No changes were made."), true);
  } finally {
    window.clearTimeout(timeout);
    proposalInFlight = false;
  }
}

function runAE(command) {
  if (commandInFlight || proposalInFlight) {
    showResult("An OBSIDIAN request is still running. Wait for its result before sending another request.", true);
    return;
  }
  const planner = window.OBSIDIANPlanner;
  if (!planner || typeof planner.planObsidianCommand !== "function" ||
      typeof planner.isExecutablePlan !== "function") {
    setProgress("failed");
    showResult("OBSIDIAN planner is unavailable. Reload the panel before trying again.", true);
    return;
  }

  setProgress("planning");
  const plan = planner.planObsidianCommand(command);

  if (plan && plan.status === "knowledge_answer") {
    setProgress("completed");
    showResult(plan.answer || "I don't have a useful answer for that topic yet.", false);
    return;
  }

  if (plan && plan.status === "caption_workflow") {
    setProgress(null);
    openCaptionWorkspace(plan.captionMode);
    setCaptionStatus("");
    return;
  }

  if (plan && plan.status === "blocked") {
    setProgress("failed");
    showResult(plan.explanation || "This request is currently blocked. No changes were made.", true);
    return;
  }

  if (plan && plan.status === "style_plan" && plan.recipe) {
    requestCoreProposal(command, plan);
    return;
  }

  if (!plan || plan.status !== "planned") {
    if (plan && plan.status === "unsupported") {
      requestCoreProposal(command, plan);
      return;
    }
    setProgress(plan && plan.status === "needs_clarification" ? "completed" : "failed");
    const clarification = Boolean(plan && plan.status === "needs_clarification");
    showResult(plan && plan.question ? plan.question : "OBSIDIAN could not create a safe action plan.", !clarification, clarification ? "warning" : undefined);
    return;
  }

  setProgress("validating");
  if (!planner.isExecutablePlan(plan)) {
    setProgress("failed");
    showResult("This action is not on OBSIDIAN's approved action list.", true);
    return;
  }

  if (!window.__adobe_cep__ || typeof window.__adobe_cep__.evalScript !== "function" ||
      !window.OBSIDIANHostBridge || typeof window.OBSIDIANHostBridge.execute !== "function") {
    setProgress("failed");
    showResult("After Effects bridge is unavailable. The request was planned but not executed.", true);
    return;
  }

  const args = plan.args || {};
  const valueArgument = typeof args.value === "number"
    ? String(args.value)
    : typeof args.brightness === "number" ? String(args.brightness) : "null";
  const profileArgument = JSON.stringify(typeof args.profile === "string"
    ? args.profile
    : typeof args.recipeId === "string" ? args.recipeId : "");
  const secondaryValueArgument = typeof args.secondaryValue === "number" ? String(args.secondaryValue) : typeof args.contrast === "number" ? String(args.contrast) : "null";
  let expression;
  try {
    expression = plan.action === "create_captions"
      ? window.OBSIDIANHostBridge.buildExpression(plan.action, args)
      : "OBSIDIAN_executePlan(" +
        JSON.stringify(plan.action) + "," + valueArgument + "," + profileArgument + "," + secondaryValueArgument + ")";
  } catch (error) {
    setProgress("failed");
    showResult("After Effects request was rejected: " + (error instanceof Error ? error.message : String(error)), true);
    return;
  }

  commandInFlight = true;
  setProgress("implementing");
  executeHostOperation(expression, plan.action === "create_captions"
    ? window.OBSIDIANHostBridge.CAPTION_CREATION_TIMEOUT_MS
    : undefined).then((hostResult) => {
    const isError = hostResult.status !== "verified";
    const timeoutNote = hostResult.status === "timed_out"
      ? " The edit may have completed; inspect the selected layers in After Effects before retrying."
      : "";
    const explanation = plan.explanation ? "\n\nPlan: " + plan.explanation : "";
    setProgress(isError ? "failed" : "completed");
    showResult(hostResult.message + timeoutNote + explanation, isError, hostResult.status === "timed_out" ? "warning" : undefined);
  }).catch((error) => {
    setProgress("failed");
    showResult("After Effects request failed: " + (error && error.message ? error.message : String(error)), true);
  }).finally(() => {
    commandInFlight = false;
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const command = commandInput.value.trim();
  if (!command) {
    commandInput.focus();
    return;
  }

  resetStatus();
  runAE(command);
  commandInput.value = "";
  commandInput.style.height = "auto";
});

commandInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
  // Shift+Enter is intentionally left untouched so the textarea inserts a newline.
});

commandInput.addEventListener("input", () => {
  commandInput.style.height = "auto";
  commandInput.style.height = Math.min(commandInput.scrollHeight, 200) + "px";
});

function transcribeVoiceRecording(blob) {
  if (!blob || blob.size === 0) {
    setProgress("failed");
    showResult("The microphone recording was empty. No command was sent.", true);
    return;
  }
  if (blob.size > 10 * 1024 * 1024) {
    setProgress("failed");
    showResult("The microphone recording exceeded the 10 MB local limit. No command was sent.", true);
    return;
  }
  if (commandInFlight || proposalInFlight) {
    showResult("Wait for the current OBSIDIAN request to finish before transcribing voice.", true);
    return;
  }

  commandInFlight = true;
  setProgress("transcribing");
  const reader = new FileReader();
  const controller = new AbortController();
  const voiceRequestTimeout = window.setTimeout(() => controller.abort(), CAPTION_REQUEST_TIMEOUT_MS);
  reader.onerror = () => {
    window.clearTimeout(voiceRequestTimeout);
    commandInFlight = false;
    setProgress("failed");
    showResult("Voice transcription could not read the local microphone recording. Record again and retry.", true);
  };
  reader.onload = async () => {
    try {
      const encoded = String(reader.result || "").split(",")[1] || "";
      const response = await fetch("http://127.0.0.1:43127/transcribe-voice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Obsidian-CEP-Extension-Id": getCepPanelExtensionId(),
        },
        body: JSON.stringify({ mimeType: blob.type, audioBase64: encoded }),
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok || data.processing !== "local" || !data.transcript || !Array.isArray(data.transcript.segments)) {
        throw new Error("Local Whisper transcription failed: " + (data.error || "the service returned an invalid response."));
      }
      const transcript = data.transcript.segments.map((segment) => String(segment.text || "").trim()).filter(Boolean).join(" ")
        .replace(/\s+([,.!?;:])/g, "$1");
      if (!transcript) throw new Error("No speech was recognized in the microphone recording.");
      commandInput.value = transcript;
      commandInput.dispatchEvent(new Event("input"));
      commandInput.focus();
      setProgress("completed");
      showResult("Voice was transcribed locally. Review the text, then press Send to pass it to the normal planner. No action runs while you are recording or transcribing.", false);
    } catch (error) {
      const detail = controller.signal.aborted
        ? "Local voice transcription timed out. Check the Whisper service status and retry."
        : error instanceof Error ? error.message : String(error);
      setProgress("failed");
      showResult(detail + (detail.indexOf("fetch") !== -1 ? " Start the local service with `npm run obsidian:ai`." : ""), true);
    } finally {
      window.clearTimeout(voiceRequestTimeout);
      commandInFlight = false;
    }
  };
  reader.readAsDataURL(blob);
}

async function startLocalVoiceRecording() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function" || typeof window.MediaRecorder !== "function") {
    setProgress("failed");
    showResult("This CEP runtime does not provide local microphone recording. OBSIDIAN did not start a cloud speech-recognition service.", true);
    return;
  }
  if (commandInFlight || proposalInFlight) {
    showResult("Wait for the current OBSIDIAN request to finish before recording voice.", true);
    return;
  }
  if (microphonePermissionPending) return;
  microphonePermissionPending = true;
  voiceButton.disabled = true;
  setProgress("initializing");
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    microphonePermissionPending = false;
    voiceButton.disabled = false;
    const options = {};
    const supportedTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    if (typeof window.MediaRecorder.isTypeSupported === "function") {
      const supportedType = supportedTypes.find((type) => window.MediaRecorder.isTypeSupported(type));
      if (supportedType) options.mimeType = supportedType;
    }
    const recorder = new window.MediaRecorder(microphoneStream, options);
    const mimeType = String(recorder.mimeType || options.mimeType || "").toLowerCase();
    const mediaType = mimeType.split(";")[0];
    if (!["audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mp4"].includes(mediaType)) {
      throw new Error("The CEP recorder selected an audio format the local transcription service does not support: " + (mimeType || "unknown format") + ".");
    }
    const chunks = [];
    let recorderFailed = false;
    mediaRecorder = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener("error", () => {
      recorderFailed = true;
      if (microphoneStream) microphoneStream.getTracks().forEach((track) => track.stop());
      microphoneStream = null;
      mediaRecorder = null;
      voiceButton.classList.remove("listening");
      voiceButton.setAttribute("aria-label", "Voice command; record locally");
      voiceButton.title = "Record a voice request locally; review the transcript before sending";
      setProgress("failed");
      showResult("Local microphone recording failed because the recorder stopped unexpectedly. Check the CEP microphone permission and retry.", true);
    });
    recorder.addEventListener("stop", () => {
      window.clearTimeout(voiceStopTimer);
      voiceStopTimer = null;
      microphoneStream.getTracks().forEach((track) => track.stop());
      microphoneStream = null;
      mediaRecorder = null;
      voiceButton.classList.remove("listening");
      voiceButton.setAttribute("aria-label", "Voice command; record locally");
      voiceButton.title = "Record a voice request locally; review the transcript before sending";
      if (recorderFailed) return;
      const blob = new Blob(chunks, { type: mimeType });
      transcribeVoiceRecording(blob);
    });
    recorder.start(250);
    voiceButton.classList.add("listening");
    voiceButton.setAttribute("aria-label", "Stop local voice recording");
    voiceButton.title = "Stop recording; audio stays on this computer until local transcription";
    result.classList.add("hidden");
    setProgress("recording");
    voiceStopTimer = window.setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
    }, 60_000);
  } catch (error) {
    microphonePermissionPending = false;
    voiceButton.disabled = false;
    if (microphoneStream) microphoneStream.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
    mediaRecorder = null;
    voiceButton.classList.remove("listening");
    voiceButton.setAttribute("aria-label", "Voice command; record locally");
    voiceButton.title = "Record a voice request locally; review the transcript before sending";
    setProgress("failed");
    const detail = error instanceof Error ? error.message : String(error);
    showResult("Local microphone capture could not start. Check the CEP microphone permission. " + detail, true);
  }
}

voiceButton.setAttribute("aria-label", "Voice command; record locally");
voiceButton.title = "Record a voice request locally; review the transcript before sending";
voiceButton.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    return;
  }
  startLocalVoiceRecording();
});

function trapCaptionDialogFocus(event) {
  if (event.key !== "Tab" || captionWorkspace.classList.contains("hidden")) return;
  const focusable = Array.from(captionWorkspace.querySelectorAll(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.closest(".hidden") && element.getAttribute("aria-hidden") !== "true");
  if (!focusable.length) {
    event.preventDefault();
    captionWorkspace.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !captionWorkspace.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !captionWorkspace.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !panelMenu.classList.contains("hidden")) {
    event.preventDefault();
    setPanelMenuOpen(false, true);
    return;
  }
  if (event.key === "Escape") commandInput.blur();
  if (event.key === "Escape" && !captionWorkspace.classList.contains("hidden")) closeCaptionWorkspace();
  else trapCaptionDialogFocus(event);
});

function renderPanelServiceStatus(node, status) {
  if (!node || !status) return;
  const statusId = node.id || node.selector;
  const isCore = statusId === "core-service-status" || statusId === "#core-service-status" ||
    statusId === "cc-core-service-status" || statusId === "#cc-core-service-status";
  const statusNodes = isCore ? [coreServiceStatus, ccCoreServiceStatus] : [whisperServiceStatus, ccWhisperServiceStatus];
  statusNodes.forEach((statusNode) => {
    if (!statusNode) return;
    statusNode.textContent = status.label;
    statusNode.dataset.state = status.state;
    statusNode.setAttribute("aria-label", (isCore ? "CORE" : "Whisper") + " service status: " + status.label);
  });
  const detailNode = isCore ? coreServiceDetail : whisperServiceDetail;
  if (detailNode) detailNode.textContent = status.detail || status.label;
}

const panelServiceProbe = window.OBSIDIANPanelRefresh.createServiceProbe({
  onUpdate(statuses) {
    renderPanelServiceStatus(coreServiceStatus, statuses.core);
    renderPanelServiceStatus(whisperServiceStatus, statuses.whisper);
  }
});

const panelRefreshController = window.OBSIDIANPanelRefresh.createRefreshController({
  isBusy: isPanelOperationActive,
  reloadPanel: () => window.location.reload(),
  onState(refreshing) {
    [panelRefreshButton, ccRefreshButton].forEach((button) => {
      button.disabled = refreshing;
      button.setAttribute("aria-busy", String(refreshing));
      button.setAttribute("aria-label", refreshing ? "Refreshing OBSIDIAN" : "Refresh OBSIDIAN services and panel");
      button.title = refreshing ? "Refreshing OBSIDIAN" : "Reconnect and refresh service status";
      const label = button.querySelector(".refresh-label");
      if (label) label.textContent = refreshing ? "Refreshing" : "Refresh OBSIDIAN";
    });
  }
});

async function handlePanelRefreshClick() {
  const outcome = await panelRefreshController.refresh();
  if (outcome.status === "blocked") {
    const message = "Refresh unavailable while " + activePanelOperationMessage() + " is running. Wait for it to finish, then retry.";
    if (!captionWorkspace.classList.contains("hidden")) setCaptionStatus(message, true);
    else showResult(message, true);
  } else if (outcome.status === "failed") {
    const message = "OBSIDIAN panel refresh failed: " + outcome.error;
    if (!captionWorkspace.classList.contains("hidden")) setCaptionStatus(message, true);
    else showResult(message, true);
  }
}

panelRefreshButton.addEventListener("click", handlePanelRefreshClick);
ccRefreshButton.addEventListener("click", handlePanelRefreshClick);

panelServiceProbe.refresh().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  renderPanelServiceStatus(coreServiceStatus, { state: "offline", label: "CORE offline", detail: detail });
  renderPanelServiceStatus(whisperServiceStatus, { state: "offline", label: "Whisper offline", detail: detail });
});
