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
const progress = document.querySelector("#progress");
const progressBar = document.querySelector("#progress-bar");
const progressValue = document.querySelector("#progress-value");
const progressLabel = document.querySelector("#progress-label");
const result = document.querySelector("#result");
const resultText = document.querySelector("#result-text");
const welcomeMessage = document.querySelector("#welcome-message");

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
let phraseTimer;
let selectedCaptionSource = null;
let activeCaptionRun = null;
let captionRunSequence = 0;
let mediaRecorder = null;
let microphoneStream = null;
let voiceStopTimer = null;

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

function requestTranscription(path, onEvent) {
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
    xhr.send(JSON.stringify({ path }));
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
  return window.OBSIDIANHostBridge.execute(
    window.__adobe_cep__.evalScript.bind(window.__adobe_cep__),
    expression
  );
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
  setCaptionStatus("Checking the selected footage in After Effects…");
  try {
    const sourceResult = await evalHostAction("inspect_caption_source", null);
    if (run.cancelled) return;
    if (sourceResult.status !== "verified") throw new Error(sourceResult.message);
    selectedCaptionSource = parseCaptionSource(sourceResult.raw);
    await emitCaptionProgress(run, { type: "stage", phase: "complete", stage: "analyzing_footage" });
    await emitCaptionProgress(run, { type: "stage", phase: "start", stage: "connecting_service" });
    setCaptionStatus("Transcribing locally with the cached Whisper model. The project is not being edited.");
    const request = requestTranscription(selectedCaptionSource.path, (event) => {
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
    setCaptionStatus("Local transcript ready: " + mapped.segments.length + " " + (captionMode.value === "word" ? "word" : "phrase") + " caption(s). Review and edit before creating layers.");
    await completeCaptionPipeline(run);
    captionTranscript.focus();
  } catch (error) {
    if (run.cancelled) return;
    const detail = error instanceof Error ? error.message : String(error);
    await failCaptionPipeline(error, run.stage, run);
    setCaptionStatus(detail + (detail.indexOf("127.0.0.1") !== -1 || detail.indexOf("fetch") !== -1
      ? " Start the local service with `npm run obsidian:ai`."
      : ""), true);
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
    setCaptionStatus("Transcribe the selected footage before creating captions.", true);
    return;
  }
  const parsed = captions.parseSrt(captionTranscript.value);
  if (!parsed.ok) {
    setCaptionStatus(parsed.error, true);
    return;
  }
  const plan = planner.planCaptionCreation(parsed.segments, selectedCaptionSource, captionStyle.value);
  if (!plan || !planner.isExecutablePlan(plan)) {
    setCaptionStatus(plan && plan.question ? plan.question : "The caption plan did not pass planner validation.", true);
    return;
  }

  commandInFlight = true;
  captionsCreateButton.disabled = true;
  captionsTranscribeButton.disabled = true;
  setCaptionStatus("Creating the reviewed captions as new text layers…");
  try {
    const result = await evalHostAction("create_captions", plan.args);
    const verified = result.status === "verified";
    setCaptionStatus(result.message + (plan.explanation ? " " + plan.explanation : ""), !verified);
    if (verified) {
      captionsCreateButton.disabled = true;
      showResult(result.message, false);
    } else {
      captionsCreateButton.disabled = false;
    }
  } catch (error) {
    setCaptionStatus(error instanceof Error ? error.message : String(error), true);
    captionsCreateButton.disabled = false;
  } finally {
    commandInFlight = false;
    captionsTranscribeButton.disabled = false;
  }
}

captionsTranscribeButton.addEventListener("click", transcribeSelectedFootage);
captionsCreateButton.addEventListener("click", createCaptionLayers);

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
  window.OBSIDIANHostBridge.execute(
    window.__adobe_cep__.evalScript.bind(window.__adobe_cep__),
    expression
  ).then((hostResult) => {
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
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
