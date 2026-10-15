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

function runAE(command) {
  if (!window.__adobe_cep__ || typeof window.__adobe_cep__.evalScript !== "function") {
    showResult("AE bridge is unavailable.", true);
    return;
  }

  setProgress(55, "Waiting for After Effects...");

  // JSON.stringify safely escapes quotes, backslashes and newlines for the JSX call.
  const encodedCommand = JSON.stringify(String(command));

  window.__adobe_cep__.evalScript(
    "OBSIDIAN_executeCommand(" + encodedCommand + ")",
    (response) => {
      const isError = !response || response.indexOf("ERROR|") === 0 || response === "EvalScript error.";
      setProgress(100, isError ? "Failed" : "Host responded");
      const message = response === "EvalScript error."
        ? "After Effects could not execute the host script. Check the CEP host script path and ExtendScript errors."
        : response ? response.replace(/^(ERROR|OK)\|/, "") : "After Effects returned no result.";

      showResult(message, isError);
    }
  );
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
