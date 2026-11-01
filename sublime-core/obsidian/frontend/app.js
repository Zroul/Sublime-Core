const form = document.querySelector("#command-form");
const commandInput = document.querySelector("#command");
const voiceButton = document.querySelector("#voice");
const captionsOpenButton = document.querySelector("#captions-open");
const captionWorkspace = document.querySelector("#caption-workspace");
const captionsCloseButton = document.querySelector("#captions-close");
const captionsCancelButton = document.querySelector("#captions-cancel");
const captionsTranscribeButton = document.querySelector("#captions-transcribe");
const captionsCreateButton = document.querySelector("#captions-create");
const captionMode = document.querySelector("#caption-mode");
const captionStyle = document.querySelector("#caption-style");
const captionTranscript = document.querySelector("#caption-transcript");
const captionStatus = document.querySelector("#caption-status");
const captionPipeline = document.querySelector("#caption-pipeline");
const captionProgressLine = document.querySelector("#caption-progress-line");
const captionPipelineError = document.querySelector("#caption-pipeline-error");
const captionReviewTab = document.querySelector("#caption-view-review");
const captionStudioTab = document.querySelector("#caption-view-studio");
const captionReviewSpace = document.querySelector("#caption-review-space");
const captionStyleStudio = document.querySelector("#caption-style-studio");
const captionStyleImportAe = document.querySelector("#caption-style-import-ae");
const captionStyleFile = document.querySelector("#caption-style-file");
const captionStyleReference = document.querySelector("#caption-style-reference");
const captionStyleSampleFrame = document.querySelector("#caption-style-sample-frame");
const captionStyleAnalysis = document.querySelector("#caption-style-analysis");
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
const progressBar = document.querySelector("#progress-bar");
const progressValue = document.querySelector("#progress-value");
const progressLabel = document.querySelector("#progress-label");
const result = document.querySelector("#result");
const resultText = document.querySelector("#result-text");
const welcomeMessage = document.querySelector("#welcome-message");
const panelRefreshButton = document.querySelector("#panel-refresh");
const coreServiceStatus = document.querySelector("#core-service-status");
const whisperServiceStatus = document.querySelector("#whisper-service-status");

const welcomePhrases = [
  "READY WHEN U ARE",
  "Ask me to Edit",
  "Good to see you Editor",
  "Keep working, Keep Winning",
  "I can Edit In Your style",
  "I Adapt To Your Style"
];

let phraseIndex = 0;
let commandInFlight = false;
let proposalInFlight = false;
let hostOperationsInFlight = 0;
let microphonePermissionPending = false;
let phraseTimer;
let selectedCaptionSource = null;
let activeCaptionRun = null;
let captionRunSequence = 0;
let selectedCaptionAnimation = "fade";
let captionReferenceObjectUrl = null;
let captionReferenceMedia = null;
let captionReferenceName = "";
let mediaRecorder = null;
let microphoneStream = null;
let voiceStopTimer = null;

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

function typeWelcomePhrase() {
  window.clearTimeout(phraseTimer);
  const phrase = welcomePhrases[phraseIndex];
  let characterIndex = 0;

  welcomeMessage.textContent = "";
  welcomeMessage.classList.add("typing");

  function typeNextCharacter() {
    if (characterIndex < phrase.length) {
      welcomeMessage.textContent += phrase.charAt(characterIndex);
      characterIndex += 1;
      phraseTimer = window.setTimeout(typeNextCharacter, 68);
      return;
    }

    welcomeMessage.classList.remove("typing");
    phraseTimer = window.setTimeout(() => {
      phraseIndex = (phraseIndex + 1) % welcomePhrases.length;
      typeWelcomePhrase();
    }, 30000);
  }

  typeNextCharacter();
}

typeWelcomePhrase();

function resetStatus() {
  progress.classList.add("hidden");
  result.classList.add("hidden");
  progressBar.style.width = "0%";
  progressValue.textContent = "0%";
}

function setProgress(value, label) {
  progress.classList.remove("hidden");
  progressLabel.textContent = label;
  progressBar.style.width = value + "%";
  progressValue.textContent = value + "%";
}

function showResult(message, isError) {
  resultText.textContent = message;
  result.classList.remove("hidden");
  result.querySelector(".result-mark").textContent = isError ? "!" : "✓";
}

function setCaptionStatus(message, isError) {
  captionStatus.textContent = message || "";
  captionStatus.classList.toggle("error", Boolean(isError));
}

function setCaptionStyleStatus(message, isError) {
  captionStyleStatus.textContent = message || "";
  captionStyleStatus.classList.toggle("error", Boolean(isError));
}

function switchCaptionWorkspace(view) {
  const studio = view === "studio";
  captionReviewSpace.classList.toggle("hidden", studio);
  captionStyleStudio.classList.toggle("hidden", !studio);
  captionReviewTab.classList.toggle("selected", !studio);
  captionStudioTab.classList.toggle("selected", studio);
  captionReviewTab.setAttribute("aria-pressed", String(!studio));
  captionStudioTab.setAttribute("aria-pressed", String(studio));
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
  const style = getCaptionStyleDraft();
  if (!studio || !style) {
    captionStyleFitLabel.textContent = "CHECK STYLE VALUES";
    return;
  }
  const segments = getCaptionPreviewSegments();
  const width = selectedCaptionSource && selectedCaptionSource.compWidth || 1920;
  const fit = studio.fitStyle(style, segments, width);
  const text = segments[0] && segments[0].text || "THE STORY BEGINS HERE";
  captionStylePreviewText.textContent = text;
  captionStyleFitLabel.textContent = fit.ok ? "BATCH SIZE " + Math.round(fit.style.fontSize) + "PX" : "FIT NEEDS REVIEW";
  const hex = studio.toHex(style.fillColor);
  const stroke = studio.toHex(style.strokeColor);
  captionStylePreviewAnchor.style.left = (style.positionX * 100) + "%";
  captionStylePreviewAnchor.style.top = (style.positionY * 100) + "%";
  captionStylePreviewAnchor.style.textAlign = style.alignment;
  captionStylePreviewAnchor.style.transform = style.alignment === "left" ? "translateY(-50%)" :
    style.alignment === "right" ? "translate(-100%,-50%)" : "translate(-50%,-50%)";
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

function renderCaptionPalette(colors) {
  const fixed = ["#ffffff", "#ffe16b", "#68e4d2", "#b7a4ff", "#ff8fa3", "#111827"];
  const unique = [];
  (colors || []).concat(fixed).forEach((color) => {
    const normalized = String(color).toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(normalized) && unique.indexOf(normalized) === -1) unique.push(normalized);
  });
  captionStylePalette.textContent = "";
  unique.slice(0, 10).forEach((color) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "style-palette-chip";
    chip.style.setProperty("--chip-color", color);
    chip.title = "Use " + color + " as caption fill";
    chip.setAttribute("aria-label", "Use caption color " + color);
    chip.addEventListener("click", () => {
      captionStyleInputs.fill.value = color;
      updateCaptionStylePreview();
    });
    captionStylePalette.appendChild(chip);
  });
}

function extractLocalPalette(media) {
  try {
    const width = media.naturalWidth || media.videoWidth;
    const height = media.naturalHeight || media.videoHeight;
    if (!width || !height) return [];
    const canvas = document.createElement("canvas");
    canvas.width = 36;
    canvas.height = 36;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(media, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const buckets = Object.create(null);
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 96) continue;
      const key = [pixels[i] >> 4, pixels[i + 1] >> 4, pixels[i + 2] >> 4].join(":");
      if (!buckets[key]) buckets[key] = { count: 0, r: 0, g: 0, b: 0 };
      buckets[key].count++;
      buckets[key].r += pixels[i]; buckets[key].g += pixels[i + 1]; buckets[key].b += pixels[i + 2];
    }
    return Object.keys(buckets).map((key) => buckets[key]).sort((a, b) => b.count - a.count).slice(0, 5).map((bucket) =>
      "#" + [bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count].map((value) => {
        const hex = Math.round(value).toString(16);
        return hex.length === 1 ? "0" + hex : hex;
      }).join("")
    );
  } catch (error) {
    setCaptionStyleStatus("The reference preview loaded, but color sampling is unavailable: " + error.message, true);
    return [];
  }
}

function useCaptionStyleReferenceFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type) && !/^video\//.test(file.type)) {
    setCaptionStyleStatus("Choose a supported image or video reference.", true);
    return;
  }
  if (file.size > 100 * 1024 * 1024) {
    setCaptionStyleStatus("Reference files must be 100 MB or smaller for local preview.", true);
    return;
  }
  const urlApi = window.URL || window.webkitURL;
  if (!urlApi || typeof urlApi.createObjectURL !== "function") {
    setCaptionStyleStatus("This CEP runtime cannot create a local reference preview.", true);
    return;
  }
  if (captionReferenceObjectUrl) urlApi.revokeObjectURL(captionReferenceObjectUrl);
  captionReferenceObjectUrl = urlApi.createObjectURL(file);
  const referenceUrl = captionReferenceObjectUrl;
  captionReferenceName = file.name;
  captionStyleReference.textContent = "";
  captionReferenceMedia = null;
  captionStyleSampleFrame.classList.add("hidden");
  if (/^image\//.test(file.type)) {
    const image = document.createElement("img");
    image.alt = "Local caption style reference";
    image.onload = () => {
      if (captionReferenceObjectUrl !== referenceUrl) return;
      captionReferenceMedia = image;
      renderCaptionPalette(extractLocalPalette(image));
      setCaptionStyleStatus("Image preview loaded locally. Sampled colors are suggestions; image pixels do not reveal font or animation.");
    };
    image.onerror = () => {
      if (captionReferenceObjectUrl === referenceUrl) setCaptionStyleStatus("This image format could not be previewed by the CEP browser.", true);
    };
    image.src = captionReferenceObjectUrl;
    captionStyleReference.appendChild(image);
    captionStyleAnalysis.textContent = "Image reference: " + file.name + ". Only a local color palette is sampled; typography, effects, and animation are not inferred from pixels.";
  } else {
    const video = document.createElement("video");
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      if (captionReferenceObjectUrl !== referenceUrl) return;
      if (!Number.isFinite(video.duration) || video.duration > 120) {
        video.pause();
        captionStyleReference.textContent = "";
        setCaptionStyleStatus("Reference videos must be 2 minutes or shorter. No video was uploaded.", true);
        return;
      }
      captionReferenceMedia = video;
      captionStyleSampleFrame.classList.remove("hidden");
      setCaptionStyleStatus("Short video preview loaded locally. Play it to review motion, then sample a frame color if useful.");
    };
    video.onerror = () => {
      if (captionReferenceObjectUrl === referenceUrl) setCaptionStyleStatus("This video format could not be previewed by the CEP browser.", true);
    };
    video.src = captionReferenceObjectUrl;
    captionStyleReference.appendChild(video);
    captionStyleAnalysis.textContent = "Video reference: " + file.name + ". Preview is local; OBSIDIAN does not infer font/effect metadata or extract animation curves from this video.";
  }
}

function parseCaptionStyleReference(raw) {
  const fields = String(raw || "").split("|");
  if (fields.length !== 23 || fields[0] !== "OK" || fields[1] !== "CAPTION_STYLE") {
    throw new Error("After Effects returned incomplete text-layer style information.");
  }
  const decode = (value) => window.unescape(value);
  const style = {
    version: 1,
    font: decode(fields[3]),
    fontSize: Number(fields[5]),
    minFontSize: Math.max(10, Math.min(48, Number(fields[5]))),
    fillColor: fields[6] === "1" ? fields.slice(7, 10).map(Number) : [1, 1, 1],
    strokeEnabled: fields[10] === "1",
    strokeColor: fields.slice(11, 14).map(Number),
    strokeWidth: Number(fields[14]),
    alignment: fields[15],
    positionX: Number(fields[16]),
    positionY: Number(fields[17]),
    animation: "none",
    animationDuration: 0.4
  };
  const summary = decode(fields[22]);
  if (/Opacity:\s*[1-9]\d* key/.test(summary)) style.animation = "fade";
  else if (/Scale:\s*[1-9]\d* key/.test(summary)) style.animation = "smooth_scale";
  else if (/Position:\s*[1-9]\d* key/.test(summary)) style.animation = "slide";
  const normalized = window.OBSIDIANCaptionStyleStudio.normalizeStyle(style);
  if (!normalized) throw new Error("The selected text layer has style values outside OBSIDIAN's supported ranges.");
  captionStyleInputs.font.value = normalized.font;
  captionStyleInputs.size.value = String(Math.round(normalized.fontSize));
  captionStyleInputs.minSize.value = String(Math.round(normalized.minFontSize));
  captionStyleInputs.fill.value = window.OBSIDIANCaptionStyleStudio.toHex(normalized.fillColor);
  captionStyleInputs.fillEnabled.checked = fields[6] === "1";
  captionStyleInputs.strokeEnabled.checked = normalized.strokeEnabled;
  captionStyleInputs.stroke.value = window.OBSIDIANCaptionStyleStudio.toHex(normalized.strokeColor);
  captionStyleInputs.strokeWidth.value = String(normalized.strokeWidth);
  captionStyleInputs.alignment.value = normalized.alignment;
  captionStyleInputs.x.value = String(Math.round(normalized.positionX * 100));
  captionStyleInputs.y.value = String(Math.round(normalized.positionY * 100));
  selectedCaptionAnimation = normalized.animation;
  captionStyleInputs.duration.value = String(normalized.animationDuration);
  document.querySelectorAll("[data-caption-animation]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.captionAnimation === selectedCaptionAnimation);
  });
  captionStyleReference.textContent = "";
  const reference = document.createElement("div");
  reference.className = "style-ae-text-reference";
  reference.textContent = decode(fields[20]) || "Selected AE text layer";
  reference.style.fontFamily = '"' + normalized.font.replace(/["\\]/g, "") + '", Arial, sans-serif';
  reference.style.fontSize = Math.max(9, Math.min(24, normalized.fontSize * 0.32)) + "px";
  reference.style.color = window.OBSIDIANCaptionStyleStudio.toHex(normalized.fillColor);
  reference.style.webkitTextStroke = normalized.strokeEnabled ? "1px " + window.OBSIDIANCaptionStyleStudio.toHex(normalized.strokeColor) : "0 transparent";
  reference.style.textAlign = normalized.alignment;
  captionStyleReference.appendChild(reference);
  const effects = decode(fields[21]);
  const fontWeight = decode(fields[4]);
  captionStyleAnalysis.textContent = "AE text layer: " + decode(fields[2]) + " • " + normalized.font + " (" + fontWeight + ") • " + normalized.fontSize + " px • fill " +
    window.OBSIDIANCaptionStyleStudio.toHex(normalized.fillColor) + " • " + (normalized.strokeEnabled ? "stroke " + normalized.strokeWidth + " px" : "no stroke") +
    " • position " + Math.round(normalized.positionX * 100) + "% / " + Math.round(normalized.positionY * 100) + "% • anchor " + fields[18] + ", " + fields[19] +
    ". Effects: " + effects + ". Animation: " + summary + ". Imported keyframes are summarized; custom reference curves are not cloned.";
  renderCaptionPalette([window.OBSIDIANCaptionStyleStudio.toHex(normalized.fillColor), window.OBSIDIANCaptionStyleStudio.toHex(normalized.strokeColor)]);
  setCaptionStyleStatus("Read-only After Effects style import complete. Review the preview and choose IMPLEMENT when ready.");
  updateCaptionStylePreview();
}

renderCaptionPalette();
captionReviewTab.addEventListener("click", () => switchCaptionWorkspace("review"));
captionStudioTab.addEventListener("click", () => switchCaptionWorkspace("studio"));
captionStyleInputs.font.addEventListener("input", updateCaptionStylePreview);
captionStyleInputs.size.addEventListener("input", updateCaptionStylePreview);
captionStyleInputs.minSize.addEventListener("input", updateCaptionStylePreview);
captionStyleInputs.alignment.addEventListener("change", updateCaptionStylePreview);
captionStyleInputs.fill.addEventListener("input", updateCaptionStylePreview);
captionStyleInputs.fillEnabled.addEventListener("change", updateCaptionStylePreview);
captionStyleInputs.stroke.addEventListener("input", updateCaptionStylePreview);
captionStyleInputs.strokeEnabled.addEventListener("change", updateCaptionStylePreview);
captionStyleInputs.strokeWidth.addEventListener("input", updateCaptionStylePreview);
captionStyleInputs.x.addEventListener("input", updateCaptionStylePreview);
captionStyleInputs.y.addEventListener("input", updateCaptionStylePreview);
captionStyleInputs.duration.addEventListener("input", updateCaptionStylePreview);
captionStyleFile.addEventListener("change", () => {
  const file = captionStyleFile.files && captionStyleFile.files[0];
  useCaptionStyleReferenceFile(file);
  captionStyleFile.value = "";
});
captionStyleSampleFrame.addEventListener("click", () => {
  const media = captionReferenceMedia;
  if (!media || !media.videoWidth) return;
  renderCaptionPalette(extractLocalPalette(media));
  setCaptionStyleStatus("Frame colors were sampled locally. The video itself was not uploaded or analyzed for AE keyframes.");
});
captionStyleImportAe.addEventListener("click", async () => {
  const planner = window.OBSIDIANPlanner;
  const plan = planner && planner.planCaptionStyleInspection();
  if (!plan || !planner.isExecutablePlan(plan)) {
    setCaptionStyleStatus("The read-only style inspection did not pass planner validation.", true);
    return;
  }
  captionStyleImportAe.disabled = true;
  setCaptionStyleStatus("Reading the selected After Effects text layer. No project edit will be made.");
  try {
    const result = await evalHostAction("inspect_caption_style", plan.args);
    if (result.status !== "verified") throw new Error(result.message);
    parseCaptionStyleReference(result.raw);
  } catch (error) {
    setCaptionStyleStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    captionStyleImportAe.disabled = false;
  }
});
document.querySelectorAll("[data-caption-animation]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedCaptionAnimation = button.dataset.captionAnimation;
    document.querySelectorAll("[data-caption-animation]").forEach((choice) => choice.classList.toggle("selected", choice === button));
    updateCaptionStylePreview();
  });
});
captionStyleImplement.addEventListener("click", () => createCaptionLayers(getCaptionStyleDraft()));

const CAPTION_PIPELINE_STAGES = window.OBSIDIANCaptionProgress.STAGES;
const CAPTION_REQUEST_TIMEOUT_MS = 22 * 60 * 1000;
const captionProgressController = window.OBSIDIANCaptionProgress.createController((state) => {
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
  setCaptionStatus("Transcription was cancelled. No After Effects project changes were made.");
}

function openCaptionWorkspace(mode) {
  captionWorkspace.classList.remove("hidden");
  if (mode === "word" || mode === "phrase") captionMode.value = mode;
  switchCaptionWorkspace("review");
  setCaptionStatus("Select one local footage layer in the active composition, then transcribe.");
  captionsTranscribeButton.focus();
}

function closeCaptionWorkspace() {
  if (activeCaptionRun && !activeCaptionRun.cancelled) {
    cancelCaptionTranscription();
  }
  captionWorkspace.classList.add("hidden");
  commandInput.focus();
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

function executeHostOperation(expression) {
  hostOperationsInFlight++;
  let operation;
  try {
    operation = window.OBSIDIANHostBridge.execute(
      window.__adobe_cep__.evalScript.bind(window.__adobe_cep__),
      expression
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
  return executeHostOperation(expression);
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
  captionTranscript.value = "";
  selectedCaptionSource = null;
  updateCaptionStylePreview();
  setCaptionStatus("Checking the selected footage in After Effects…");
  try {
    const sourceResult = await evalHostAction("inspect_caption_source", null);
    if (run.cancelled) return;
    if (sourceResult.status !== "verified") throw new Error(sourceResult.message);
    selectedCaptionSource = parseCaptionSource(sourceResult.raw);
    const rangeResult = window.OBSIDIANCaptions.getTranscriptionRange(selectedCaptionSource);
    if (!rangeResult.ok) {
      const error = new Error(rangeResult.error);
      error.stage = "validating";
      throw error;
    }
    await emitCaptionProgress(run, { type: "stage", phase: "complete", stage: "analyzing_footage" });
    await emitCaptionProgress(run, { type: "stage", phase: "start", stage: "connecting_service" });
    setCaptionStatus("Transcribing locally with the cached Whisper model. The project is not being edited.");
    const request = requestTranscription(selectedCaptionSource.path, rangeResult.range, (event) => {
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
    const mapped = captions.toCaptionSegments(data.transcript, selectedCaptionSource, captionMode.value, selectedCaptionSource.frameRate);
    if (!mapped.ok) throw new Error(mapped.error);
    captionTranscript.value = captions.formatSrt(mapped.segments);
    await emitCaptionProgress(run, { type: "stage", phase: "complete", stage: "reviewing" });
    captionsCreateButton.disabled = false;
    updateCaptionStylePreview();
    setCaptionStyleStatus("Transcript ready. Review or correct it, approve a style, then press IMPLEMENT.");
    setCaptionStatus("Local transcript ready: " + mapped.segments.length + " " + (captionMode.value === "word" ? "word" : "phrase") + " caption(s). Review and edit before creating layers.");
    await completeCaptionPipeline(run);
    captionTranscript.focus();
  } catch (error) {
    if (run.cancelled) return;
    const detail = error instanceof Error ? error.message : String(error);
    await failCaptionPipeline(error, error.stage || run.stage, run);
    setCaptionStatus(detail + (detail.indexOf("127.0.0.1") !== -1 || detail.indexOf("fetch") !== -1
      ? " Start the local service with `npm run obsidian:ai`."
      : ""), true);
  } finally {
    commandInFlight = false;
    captionsTranscribeButton.disabled = false;
    if (activeCaptionRun === run) activeCaptionRun = null;
  }
}

async function createCaptionLayers(styleOverride) {
  if (commandInFlight || proposalInFlight) {
    setCaptionStatus("Wait for the current OBSIDIAN request to finish.", true);
    return;
  }
  const captions = window.OBSIDIANCaptions;
  const planner = window.OBSIDIANPlanner;
  if (!captions || !planner || typeof planner.planCaptionCreation !== "function" || !selectedCaptionSource) {
    setCaptionStatus("Transcribe the selected footage before creating captions.", true);
    return;
  }
  const parsed = captions.parseSrt(captionTranscript.value);
  if (!parsed.ok) {
    setCaptionStatus(parsed.error, true);
    return;
  }
  const approvedStyle = styleOverride || captionStyle.value;
  const plan = planner.planCaptionCreation(parsed.segments, selectedCaptionSource, approvedStyle);
  if (!plan || !planner.isExecutablePlan(plan)) {
    const message = plan && plan.question ? plan.question : "The caption plan did not pass planner validation.";
    setCaptionStatus(message, true);
    setCaptionStyleStatus(message, true);
    return;
  }

  commandInFlight = true;
  captionsCreateButton.disabled = true;
  captionsTranscribeButton.disabled = true;
  captionStyleImplement.disabled = true;
  setCaptionStatus("Creating the reviewed captions as new text layers…");
  setCaptionStyleStatus("Implementing the approved style through the guarded After Effects caption operation…");
  try {
    const result = await evalHostAction("create_captions", plan.args);
    const verified = result.status === "verified";
    setCaptionStatus(result.message + (plan.explanation ? " " + plan.explanation : ""), !verified);
    setCaptionStyleStatus(result.message, !verified);
    if (verified) {
      captionsCreateButton.disabled = true;
      captionStyleImplement.disabled = true;
      showResult(result.message, false);
    } else {
      captionsCreateButton.disabled = false;
      updateCaptionStylePreview();
    }
  } catch (error) {
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
captionTranscript.addEventListener("input", updateCaptionStylePreview);

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
  showResult(lines.join("\n"), false);
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
  setProgress(45, "Asking local CORE for a proposal...");
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
    setProgress(100, "Proposal prepared; no edit applied");
  } catch (error) {
    const detail = controller.signal.aborted
      ? "CORE timed out while waiting for the local model. Check Ollama and the configured model."
      : error instanceof Error ? error.message : String(error);
    if (fallbackPlan && fallbackPlan.status === "style_plan") {
      const stopped = ollamaStatus && ollamaStatus.state === "stopped";
      showRecipePlan(fallbackPlan, stopped
        ? detail + " The OBSIDIAN service is available; retry after the existing Ollama service starts."
        : "CORE unavailable: " + detail + " Run `npm run obsidian:ai` if the OBSIDIAN proposal service is stopped.");
      setProgress(100, "Local proposal; CORE unavailable");
      return;
    }
    setProgress(100, "CORE unavailable; deterministic fallback");
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
    showResult("OBSIDIAN planner is unavailable. Reload the panel before trying again.", true);
    return;
  }

  setProgress(20, "Understanding request...");
  const plan = planner.planObsidianCommand(command);

  if (plan && plan.status === "knowledge_answer") {
    setProgress(100, "Local motion-design knowledge");
    showResult(plan.answer || "I don't have a useful answer for that topic yet.", false);
    return;
  }

  if (plan && plan.status === "caption_workflow") {
    openCaptionWorkspace(plan.captionMode);
    setCaptionStatus(plan.explanation || "Review the selected footage's local transcript before creating caption layers.");
    return;
  }

  if (plan && plan.status === "blocked") {
    setProgress(100, "Blocked");
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
    setProgress(100, plan && plan.status === "needs_clarification" ? "Needs clarification" : "Not supported");
    showResult(plan && plan.question ? plan.question : "OBSIDIAN could not create a safe action plan.", true);
    return;
  }

  if (!planner.isExecutablePlan(plan)) {
    setProgress(100, "Blocked");
    showResult("This action is not on OBSIDIAN's approved action list.", true);
    return;
  }

  if (!window.__adobe_cep__ || typeof window.__adobe_cep__.evalScript !== "function" ||
      !window.OBSIDIANHostBridge || typeof window.OBSIDIANHostBridge.execute !== "function") {
    setProgress(100, "Unavailable");
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
  const secondaryValueArgument = typeof args.contrast === "number" ? String(args.contrast) : "null";
  let expression;
  try {
    expression = plan.action === "create_captions"
      ? window.OBSIDIANHostBridge.buildExpression(plan.action, args)
      : "OBSIDIAN_executePlan(" +
        JSON.stringify(plan.action) + "," + valueArgument + "," + profileArgument + "," + secondaryValueArgument + ")";
  } catch (error) {
    showResult("After Effects request was rejected: " + (error instanceof Error ? error.message : String(error)), true);
    return;
  }

  commandInFlight = true;
  setProgress(55, "Executing approved action...");
  executeHostOperation(expression).then((hostResult) => {
    const isError = hostResult.status !== "verified";
    const label = hostResult.status === "verified"
      ? "Verified by host"
      : hostResult.status === "timed_out"
        ? "Timed out; result unknown"
        : hostResult.status === "rejected"
          ? "Rejected by host"
          : "Execution failed";
    const timeoutNote = hostResult.status === "timed_out"
      ? " The edit may have completed; inspect the selected layers in After Effects before retrying."
      : "";
    const explanation = plan.explanation ? "\n\nPlan: " + plan.explanation : "";
    setProgress(100, label);
    showResult(hostResult.message + timeoutNote + explanation, isError);
  }).catch((error) => {
    setProgress(100, "Execution failed");
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
  commandInput.style.height = Math.min(commandInput.scrollHeight, 100) + "px";
});

function transcribeVoiceRecording(blob) {
  if (!blob || blob.size === 0) {
    showResult("The microphone recording was empty. No command was sent.", true);
    return;
  }
  if (blob.size > 10 * 1024 * 1024) {
    showResult("The microphone recording exceeded the 10 MB local limit. No command was sent.", true);
    return;
  }
  if (commandInFlight || proposalInFlight) {
    showResult("Wait for the current OBSIDIAN request to finish before transcribing voice.", true);
    return;
  }

  commandInFlight = true;
  setProgress(30, "Transcribing voice locally…");
  const reader = new FileReader();
  reader.onerror = () => {
    commandInFlight = false;
    setProgress(100, "Local voice transcription failed");
    showResult("The microphone recording could not be read on this computer.", true);
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
        body: JSON.stringify({ mimeType: blob.type || "audio/webm", audioBase64: encoded })
      });
      const data = await response.json();
      if (!response.ok || data.processing !== "local" || !data.transcript || !Array.isArray(data.transcript.segments)) {
        throw new Error(data.error || "Local voice transcription returned an invalid response.");
      }
      const transcript = data.transcript.segments.map((segment) => String(segment.text || "").trim()).filter(Boolean).join(" ")
        .replace(/\s+([,.!?;:])/g, "$1");
      if (!transcript) throw new Error("No speech was recognized in the microphone recording.");
      commandInput.value = transcript;
      commandInput.dispatchEvent(new Event("input"));
      commandInput.focus();
      setProgress(100, "Voice transcript ready; review before sending");
      showResult("Voice was transcribed locally. Review the text, then press Send to pass it to the normal planner. No action runs while you are recording or transcribing.", false);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setProgress(100, "Local voice transcription unavailable");
      showResult(detail + (detail.indexOf("fetch") !== -1 ? " Start the local service with `npm run obsidian:ai`." : ""), true);
    } finally {
      commandInFlight = false;
    }
  };
  reader.readAsDataURL(blob);
}

async function startLocalVoiceRecording() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function" || typeof window.MediaRecorder !== "function") {
    showResult("This CEP runtime does not provide local microphone recording. OBSIDIAN did not start a cloud speech-recognition service.", true);
    return;
  }
  if (commandInFlight || proposalInFlight) {
    showResult("Wait for the current OBSIDIAN request to finish before recording voice.", true);
    return;
  }
  microphonePermissionPending = true;
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    microphonePermissionPending = false;
    const options = {};
    if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
      options.mimeType = "audio/webm;codecs=opus";
    } else if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported("audio/webm")) {
      options.mimeType = "audio/webm";
    }
    const recorder = new window.MediaRecorder(microphoneStream, options);
    const chunks = [];
    mediaRecorder = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener("error", () => showResult("The local microphone recorder stopped unexpectedly.", true));
    recorder.addEventListener("stop", () => {
      window.clearTimeout(voiceStopTimer);
      voiceStopTimer = null;
      microphoneStream.getTracks().forEach((track) => track.stop());
      microphoneStream = null;
      mediaRecorder = null;
      voiceButton.classList.remove("listening");
      voiceButton.setAttribute("aria-label", "Voice command; record locally");
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      transcribeVoiceRecording(blob);
    });
    recorder.start(250);
    voiceButton.classList.add("listening");
    voiceButton.setAttribute("aria-label", "Stop local voice recording");
    showResult("Recording locally. Click the microphone again to stop. The recording stays on this computer and will not be sent until the local transcription service processes it.", false);
    voiceStopTimer = window.setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
    }, 60_000);
  } catch (error) {
    microphonePermissionPending = false;
    if (microphoneStream) microphoneStream.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
    mediaRecorder = null;
    voiceButton.classList.remove("listening");
    const detail = error instanceof Error ? error.message : String(error);
    showResult("Local microphone recording could not start. Check the CEP microphone permission. " + detail, true);
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

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") commandInput.blur();
  if (event.key === "Escape" && !captionWorkspace.classList.contains("hidden")) closeCaptionWorkspace();
});

function renderPanelServiceStatus(node, status) {
  if (!node || !status) return;
  node.textContent = status.label;
  node.title = status.detail || status.label;
  node.dataset.state = status.state;
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
    panelRefreshButton.disabled = refreshing;
    panelRefreshButton.setAttribute("aria-busy", String(refreshing));
    panelRefreshButton.textContent = refreshing ? "Refreshing…" : "↻ Refresh OBSIDIAN";
  }
});

panelRefreshButton.addEventListener("click", async () => {
  const outcome = await panelRefreshController.refresh();
  if (outcome.status === "blocked") {
    showResult("Cannot refresh while " + activePanelOperationMessage() + " is running. Wait for it to finish, then refresh again. No work was interrupted.", true);
  } else if (outcome.status === "failed") {
    showResult("OBSIDIAN could not refresh the panel: " + outcome.error, true);
  }
});

panelServiceProbe.refresh().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  renderPanelServiceStatus(coreServiceStatus, { state: "offline", label: "CORE offline", detail: detail });
  renderPanelServiceStatus(whisperServiceStatus, { state: "offline", label: "Whisper offline", detail: detail });
});
