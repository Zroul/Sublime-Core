const root = document.querySelector(".vanta");
const form = document.querySelector("#command-form");
const commandInput = document.querySelector("#command");
const voiceButton = document.querySelector("#voice");
const progress = document.querySelector("#progress");
const progressBar = document.querySelector("#progress-bar");
const progressValue = document.querySelector("#progress-value");
const progressLabel = document.querySelector("#progress-label");
const result = document.querySelector("#result");
const resultText = document.querySelector("#result-text");

let progressTimer = null;

function resetStatus() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }

  progress.classList.add("hidden");
  result.classList.add("hidden");
  progressBar.style.width = "0%";
  progressValue.textContent = "0%";
}

function demoCommand(command) {
  resetStatus();

  progress.classList.remove("hidden");
  progressLabel.textContent = "Working...";
  result.classList.add("hidden");

  let value = 0;

  progressTimer = setInterval(() => {
    value += Math.floor(Math.random() * 9) + 4;

    if (value >= 100) {
      value = 100;
      clearInterval(progressTimer);
      progressTimer = null;

      progressLabel.textContent = "Applied";
      resultText.textContent = command || "Command completed";
      result.classList.remove("hidden");
    }

    progressBar.style.width = value + "%";
    progressValue.textContent = value + "%";
  }, 75);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const command = commandInput.value.trim();
  if (!command) {
    commandInput.focus();
    return;
  }

  demoCommand(command);
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
    resultText.textContent = "Voice input will be wired to the bot next.";
    result.classList.remove("hidden");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  voiceButton.classList.add("listening");
  result.classList.add("hidden");

  recognition.onresult = (event) => {
    commandInput.value = event.results[0][0].transcript;
    commandInput.dispatchEvent(new Event("input"));
    commandInput.focus();
  };

  recognition.onerror = () => {
    resultText.textContent = "Voice input unavailable.";
    result.classList.remove("hidden");
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
