const defaultBaseUrl = "http://127.0.0.1:11434";

function normalizedModelName(value) {
  const name = String(value || "core").trim();
  return name.includes(":") ? name : `${name}:latest`;
}

export async function checkOllamaStatus({
  baseUrl = process.env.OLLAMA_BASE_URL || defaultBaseUrl,
  model = process.env.OLLAMA_MODEL || "core",
  fetchImpl = fetch,
  timeoutMs = 2_000,
} = {}) {
  const url = String(baseUrl || defaultBaseUrl).replace(/\/$/, "");
  const expectedModel = normalizedModelName(model);
  let response;
  try {
    response = await fetchImpl(`${url}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    return {
      state: "stopped",
      running: false,
      model,
      modelAvailable: false,
      message: `Ollama's local API is not reachable at ${url}; start the existing Ollama service and retry. OBSIDIAN did not try to launch another instance. ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!response.ok) {
    return {
      state: "unhealthy",
      running: true,
      model,
      modelAvailable: false,
      message: `Ollama is reachable but /api/tags returned HTTP ${response.status}.`,
    };
  }
  let data;
  try { data = await response.json(); } catch {
    return { state: "unhealthy", running: true, model, modelAvailable: false, message: "Ollama returned invalid model-list JSON." };
  }
  const installedModels = Array.isArray(data?.models)
    ? data.models.map((entry) => String(entry?.name || "")).filter(Boolean)
    : [];
  const modelAvailable = installedModels.includes(expectedModel);
  return {
    state: modelAvailable ? "ready" : "model_missing",
    running: true,
    model,
    modelAvailable,
    installedModels,
    message: modelAvailable
      ? `Ollama is reachable and model '${expectedModel}' is available.`
      : `Ollama is reachable, but configured model '${model}' is not installed. Available models: ${installedModels.join(", ") || "none"}.`,
  };
}
