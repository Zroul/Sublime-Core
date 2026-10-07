const form = document.querySelector("#command-form");
const commandInput = document.querySelector("#command");
const voiceButton = document.querySelector("#voice");
const progress = document.querySelector("#progress");
const progressBar = document.querySelector("#progress-bar");
const progressValue = document.querySelector("#progress-value");
const progressLabel = document.querySelector("#progress-label");
const result = document.querySelector("#result");
const resultText = document.querySelector("#result-text");

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

  const mark = result.querySelector(".result-mark");
  mark.textContent = isError ? "!" : "✓";
}

function runAE(command) {
  if (!window.__adobe_cep__ || typeof window.__adobe_cep__.evalScript !== "function") {
    showResult("AE bridge is unavailable.", true);
    return;
  }

  setProgress(20, "Thinking...");
  setProgress(55, "Editing After Effects...");

  const escaped = String(command)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\"")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");

  window.__adobe_cep__.evalScript(
    'VANTA_executeCommand("' + escaped + '")',
    (response) => {
      setProgress(100, response && response.indexOf("ERROR|") === 0 ? "Couldn't apply" : "Applied");

      const isError = !response || response.indexOf("ERROR|") === 0;
      const message = response
        ? response.replace(/^(ERROR|OK)\|/, "")
        : "After Effects returned no result.";

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
});

commandInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

commandInput.addEventListener("input", () => {
  commandInput.style.height = "auto";
  commandInput.style.height = Math.min(commandInput.scrollHeight, 100) + "px";
});

voiceButton.addEventListener("click", () => {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

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

  recognition.onerror = () => {
    showResult("Voice input unavailable.", true);
  };

  recognition.onend = () => {
    voiceButton.classList.remove("listening");
  };

  recognition.start();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    commandInput.blur();
  }
});
