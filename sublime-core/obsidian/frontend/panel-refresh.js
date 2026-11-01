(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OBSIDIANPanelRefresh = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createRefreshController(options) {
    options = options || {};
    var refreshing = false;
    var isBusy = options.isBusy || function () { return false; };
    var reloadPanel = options.reloadPanel || function () {};
    var onState = options.onState || function () {};
    var wait = options.wait || function (duration) {
      return new Promise(function (resolve) { setTimeout(resolve, duration); });
    };

    return {
      async refresh() {
        if (refreshing) return { status: "duplicate" };
        if (isBusy()) return { status: "blocked" };
        refreshing = true;
        onState(true);
        try {
          await wait(180);
          if (isBusy()) return { status: "blocked" };
          await reloadPanel();
          return { status: "reloaded" };
        } catch (error) {
          return { status: "failed", error: error && error.message ? String(error.message) : String(error) };
        } finally {
          refreshing = false;
          onState(false);
        }
      },
      isRefreshing() { return refreshing; }
    };
  }

  function createServiceProbe(options) {
    options = options || {};
    var baseUrl = String(options.baseUrl || "http://127.0.0.1:43127").replace(/\/$/, "");
    var fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch.bind(typeof window !== "undefined" ? window : globalThis) : null);
    var onUpdate = options.onUpdate || function () {};
    var healthTimeoutMs = Number(options.healthTimeoutMs) || 4_000;
    var dependenciesTimeoutMs = Number(options.dependenciesTimeoutMs) || 160_000;
    var sequence = 0;

    async function getJson(path, timeoutMs) {
      if (!fetchImpl || typeof AbortController !== "function") throw new Error("Local service checks are unavailable in this CEP runtime.");
      var controller = new AbortController();
      var timeout = setTimeout(function () { controller.abort(); }, timeoutMs);
      try {
        var response = await fetchImpl(baseUrl + path, { method: "GET", cache: "no-store", signal: controller.signal });
        if (!response || !response.ok) throw new Error("Local service returned HTTP " + (response && response.status || "error") + ".");
        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    }

    function coreStatus(result) {
      if (result.status !== "fulfilled" || !result.value || result.value.service !== "available") {
        return { state: "offline", label: "CORE offline", detail: result.reason && result.reason.message || "The local CORE service could not be reached." };
      }
      var ollama = result.value.ollama || {};
      if (ollama.state === "ready") return { state: "ready", label: "CORE ready", detail: ollama.message || "CORE and its configured local model are ready." };
      if (ollama.state === "model_missing") return { state: "warning", label: "CORE model missing", detail: ollama.message || "The local model is not installed in the existing Ollama service." };
      if (ollama.state === "stopped") return { state: "offline", label: "CORE offline", detail: ollama.message || "The existing Ollama service is stopped." };
      return { state: "warning", label: "CORE unavailable", detail: ollama.message || "The local CORE model is not ready." };
    }

    function whisperStatus(result) {
      if (result.status !== "fulfilled" || !result.value || result.value.service !== "available") {
        return { state: "offline", label: "Whisper offline", detail: result.reason && result.reason.message || "The local OBSIDIAN service could not report transcription dependencies." };
      }
      var captions = result.value.captions || {};
      var ready = Boolean(captions.python && captions.python.available && captions.whisper &&
        captions.whisper.installed && captions.whisper.modelVerified && captions.ffmpeg && captions.ffmpeg.available &&
        captions.ffprobe && captions.ffprobe.available);
      if (ready) return { state: "ready", label: "Whisper ready", detail: "Python, cached model, FFmpeg, and FFprobe are available locally." };
      var detail = captions.whisper && captions.whisper.error || captions.python && captions.python.error ||
        captions.ffmpeg && captions.ffmpeg.error || captions.ffprobe && captions.ffprobe.error ||
        "One or more local transcription dependencies are unavailable or unverified.";
      return { state: "warning", label: "Whisper unavailable", detail: detail };
    }

    return {
      async refresh() {
        var requestId = ++sequence;
        onUpdate({
          core: { state: "checking", label: "CORE checking", detail: "Checking the existing local CORE service." },
          whisper: { state: "checking", label: "Whisper checking", detail: "Checking local transcription dependencies." }
        });
        if (!fetchImpl) {
          var unavailable = {
            core: { state: "offline", label: "CORE offline", detail: "Fetch is unavailable in this CEP runtime." },
            whisper: { state: "offline", label: "Whisper offline", detail: "Fetch is unavailable in this CEP runtime." }
          };
          if (requestId === sequence) onUpdate(unavailable);
          return unavailable;
        }
        var results = await Promise.allSettled([
          getJson("/health", healthTimeoutMs),
          getJson("/dependencies", dependenciesTimeoutMs)
        ]);
        var statuses = { core: coreStatus(results[0]), whisper: whisperStatus(results[1]) };
        if (requestId === sequence) onUpdate(statuses);
        return statuses;
      },
      cancelPending() { sequence++; }
    };
  }

  return { createRefreshController: createRefreshController, createServiceProbe: createServiceProbe };
}));
