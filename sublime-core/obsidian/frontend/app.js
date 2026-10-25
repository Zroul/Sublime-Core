const form = document.querySelector("#command-form");
const commandInput = document.querySelector("#command");
const voiceButton = document.querySelector("#voice");
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

function showRecipePlan(plan) {
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
  setProgress(45, "Asking local CORE for a proposal...");
  try {
    const response = await fetch("http://127.0.0.1:43127/proposal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: command })
    });
    const data = await response.json();
    if (!response.ok || !data.proposal || data.proposal.executionReadiness !== "PROPOSED" || data.proposal.executable !== false) {
      throw new Error(data.error || "CORE returned an invalid proposal.");
    }
    showCoreProposal(data.proposal);
    setProgress(100, "Proposal prepared; no edit applied");
  } catch (error) {
    if (fallbackPlan && fallbackPlan.status === "style_plan") {
      showRecipePlan(fallbackPlan);
      setProgress(100, "Local proposal; CORE unavailable");
      return;
    }
    setProgress(100, "CORE unavailable; deterministic fallback");
    const detail = error instanceof Error ? error.message : String(error);
    showResult("Local CORE is not connected. Start Ollama and run `npm run obsidian:ai` to enable AI proposals. " + detail + "\n\n" + ((fallbackPlan && fallbackPlan.question) || "No safe deterministic plan was found. No changes were made."), true);
  } finally {
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

  if (!window.__adobe_cep__ || typeof window.__adobe_cep__.evalScript !== "function") {
    setProgress(100, "Unavailable");
    showResult("After Effects bridge is unavailable. The request was planned but not executed.", true);
    return;
  }

  const args = plan.args || {};
  const valueArgument = typeof args.value === "number" ? String(args.value) : "null";
  const profileArgument = JSON.stringify(typeof args.profile === "string" ? args.profile : "");
  const expression = "OBSIDIAN_executePlan(" +
    JSON.stringify(plan.action) + "," + valueArgument + "," + profileArgument + ")";

  commandInFlight = true;
  setProgress(55, "Executing approved action...");
  window.__adobe_cep__.evalScript(expression, (response) => {
    commandInFlight = false;
    const isError = typeof response !== "string" ||
      response.indexOf("OK|") !== 0 ||
      response === "EvalScript error.";
    setProgress(100, isError ? "Failed" : "Verified by host");

    const message = response === "EvalScript error."
      ? "After Effects could not execute the host script. Check the CEP host script path and ExtendScript errors."
      : typeof response === "string" && response
        ? response.replace(/^(ERROR|OK)\|/, "")
        : "After Effects returned no result.";

    const explanation = plan.explanation ? "\n\nPlan: " + plan.explanation : "";
    showResult(message + explanation, isError);
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

voiceButton.addEventListener("click", () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    showResult("Voice input is not available in this CEP runtime yet.", true);
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  voiceButton.classList.add("listening");

  recognition.onresult = (event) => {
    commandInput.value = event.results[0][0].transcript;
    commandInput.dispatchEvent(new Event("input"));
    commandInput.focus();
  };

  recognition.onerror = () => showResult("Voice input unavailable.", true);
  recognition.onend = () => voiceButton.classList.remove("listening");
  recognition.start();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") commandInput.blur();
});
