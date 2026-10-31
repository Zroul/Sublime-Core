import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CEP_EXTENSION_ID_ALLOW_HEADER,
  cepAllowedOrigin,
  isCepPanelRequest,
} from "./cep-auth.mjs";

export const MAX_MEDIA_SECONDS = 30 * 60;
export const MAX_TRANSCRIPT_SEGMENTS = 5_000;
export const MAX_VOICE_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_TRANSCRIPTION_REQUEST_MS = 22 * 60 * 1000;

const ALLOWED_VIDEO_EXTENSIONS = new Set([".avi", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".mts", ".webm"]);
const ALLOWED_VOICE_TYPES = new Map([
  ["audio/webm", ".webm"],
  ["audio/ogg", ".ogg"],
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["audio/mp4", ".m4a"],
]);
const MODEL_NAMES = new Set(["tiny", "base", "small"]);
// A cold Windows import of PyTorch + Whisper can exceed 20 seconds on this setup.
const WHISPER_IMPORT_TIMEOUT_MS = 60_000;
const TRANSCRIBER_SCRIPT = fileURLToPath(new URL("./transcribe.py", import.meta.url));
const WINDOWS_FFMPEG = "C:\\BUILD\\ffmpeg.exe";
const WINDOWS_FFPROBE = "C:\\BUILD\\ffprobe.exe";

export class TranscriptionError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "TranscriptionError";
    this.status = status;
  }
}

export async function resolveLocalExecutable(name, { configuredPath, knownPaths = [], spawnProcess = spawn } = {}) {
  const configured = typeof configuredPath === "string" ? configuredPath.trim() : "";
  const candidates = configured ? [configured] : [...knownPaths, name];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      await runProcess(candidate, ["-version"], { timeoutMs: 15_000, outputLimit: 16_000, spawnProcess });
      return candidate;
    } catch (error) {
      lastError = error;
      if (configured) {
        throw new TranscriptionError(503, `Configured ${name} executable cannot run at '${configured}': ${error.message}`);
      }
    }
  }
  throw new TranscriptionError(503, `${name} was not found or failed its -version check. Configure OBSIDIAN_${name.toUpperCase()}_PATH. ${lastError instanceof Error ? lastError.message : ""}`.trim());
}

function runProcess(binary, args, {
  timeoutMs = 15 * 60 * 1000,
  outputLimit = 8 * 1024 * 1024,
  spawnProcess = spawn,
  signal,
  onProgress,
} = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(new TranscriptionError(499, "Local transcription was cancelled."));
      return;
    }
    let child;
    try {
      child = spawnProcess(binary, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      rejectPromise(new TranscriptionError(503, `${binary} could not be started: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }

    let stdout = "";
    let stdoutLineBuffer = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new TranscriptionError(504, "Local speech recognition exceeded its time limit."));
    }, timeoutMs);

    const onAbort = () => {
      child.kill();
      finish(signal.reason instanceof TranscriptionError
        ? signal.reason
        : new TranscriptionError(499, "Local transcription was cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) rejectPromise(error);
      else resolvePromise(value);
    }

    function addResultLine(line) {
      if (line) stdout += line + "\n";
      if (Buffer.byteLength(stdout, "utf8") > outputLimit) {
        child.kill();
        finish(new TranscriptionError(502, "Local speech recognition returned too much transcript data."));
      }
    }

    function consumeWorkerLine(line) {
      if (!line.trim()) return;
      if (onProgress) {
        try {
          const event = JSON.parse(line);
          if (event && (event.type === "stage" || event.type === "progress")) {
            onProgress(event);
            return;
          }
        } catch {
          // Keep non-event output so malformed worker output fails JSON validation below.
        }
      }
      addResultLine(line);
    }

    child.stdout.on("data", (chunk) => {
      if (settled) return;
      if (!onProgress) {
        stdout += chunk.toString("utf8");
        if (Buffer.byteLength(stdout, "utf8") > outputLimit) {
          child.kill();
          finish(new TranscriptionError(502, "Local speech recognition returned too much transcript data."));
        }
        return;
      }
      stdoutLineBuffer += chunk.toString("utf8");
      if (Buffer.byteLength(stdoutLineBuffer, "utf8") > outputLimit) {
        child.kill();
        finish(new TranscriptionError(502, "Local speech recognition returned an oversized progress event."));
        return;
      }
      let newline;
      while ((newline = stdoutLineBuffer.indexOf("\n")) !== -1 && !settled) {
        const line = stdoutLineBuffer.slice(0, newline).replace(/\r$/, "");
        stdoutLineBuffer = stdoutLineBuffer.slice(newline + 1);
        consumeWorkerLine(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16_000) stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => finish(new TranscriptionError(503, `${binary} is unavailable: ${error.message}`)));
    child.once("close", (code) => {
      if (settled) return;
      if (onProgress && stdoutLineBuffer.trim()) consumeWorkerLine(stdoutLineBuffer.replace(/\r$/, ""));
      stdoutLineBuffer = "";
      if (settled) return;
      if (code !== 0) {
        const detail = stderr.trim().slice(-1_000);
        finish(new TranscriptionError(503, detail || `${binary} exited with code ${code}.`));
        return;
      }
      finish(null, { stdout, stderr });
    });
  });
}

export function validateWhisperOutput(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.segments) || value.segments.length > MAX_TRANSCRIPT_SEGMENTS) {
    throw new TranscriptionError(502, "Local speech recognition returned an invalid or oversized transcript.");
  }
  const segments = [];
  for (const raw of value.segments) {
    if (!raw || typeof raw !== "object") continue;
    const start = Number(raw.start);
    const end = Number(raw.end);
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!text || text.length > 2_000 || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue;
    const words = Array.isArray(raw.words) ? raw.words.map((word) => ({
      text: typeof word?.text === "string" ? word.text.trim() : "",
      start: Number(word?.start),
      end: Number(word?.end),
    })).filter((word) => word.text && word.text.length <= 100 && Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= start && word.end > word.start && word.end <= end + 0.25) : [];
    segments.push({ text, start, end, words });
  }
  if (segments.length === 0) throw new TranscriptionError(422, "No speech was recognized in the selected audio.");
  return { segments, duration: Number.isFinite(Number(value.duration)) ? Number(value.duration) : segments[segments.length - 1].end };
}

export function createLocalTranscriber({ env = process.env, spawnProcess = spawn } = {}) {
  const python = env.OBSIDIAN_PYTHON || "python";
  const model = env.OBSIDIAN_WHISPER_MODEL || "base";
  const modelDirectory = resolve(env.OBSIDIAN_WHISPER_MODEL_DIR || join(homedir(), ".cache", "whisper"));
  let ffmpegPromise;
  let ffprobePromise;
  let activeTranscription = false;

  function reportStage(onProgress, phase, stage, description) {
    if (typeof onProgress === "function") onProgress({ type: "stage", phase, stage, description });
  }

  async function withTranscriptionLock(signal, operation) {
    if (activeTranscription) throw new TranscriptionError(409, "Another local transcription is already running.");
    activeTranscription = true;
    try {
      if (signal?.aborted) {
        throw signal.reason instanceof TranscriptionError ? signal.reason : new TranscriptionError(499, "Local transcription was cancelled.");
      }
      return await operation();
    } finally {
      activeTranscription = false;
    }
  }

  function getFfmpeg() {
    if (!ffmpegPromise) ffmpegPromise = resolveLocalExecutable("ffmpeg", {
      configuredPath: env.OBSIDIAN_FFMPEG_PATH,
      knownPaths: process.platform === "win32" ? [WINDOWS_FFMPEG] : [],
      spawnProcess,
    });
    return ffmpegPromise;
  }

  function getFfprobe() {
    if (!ffprobePromise) ffprobePromise = resolveLocalExecutable("ffprobe", {
      configuredPath: env.OBSIDIAN_FFPROBE_PATH,
      knownPaths: process.platform === "win32" ? [WINDOWS_FFPROBE] : [],
      spawnProcess,
    });
    return ffprobePromise;
  }

  async function pythonVersion() {
    const result = await runProcess(python, ["--version"], { timeoutMs: 15_000, outputLimit: 4_096, spawnProcess });
    return (result.stdout + result.stderr).trim();
  }

  async function assertLocalWhisperReady({ signal, onProgress } = {}) {
    if (!MODEL_NAMES.has(model)) throw new TranscriptionError(503, "OBSIDIAN_WHISPER_MODEL must be tiny, base, or small.");
    reportStage(onProgress, "start", "preparing", "Checking the isolated Python and Whisper installation.");
    try {
      await runProcess(python, ["-c", "import whisper"], { timeoutMs: WHISPER_IMPORT_TIMEOUT_MS, outputLimit: 4_096, spawnProcess, signal });
    } catch (error) {
      if (error instanceof TranscriptionError && error.status === 503) {
        throw new TranscriptionError(503, `Local Whisper could not be imported in the configured Python environment: ${error.message} Install openai-whisper and its local dependencies there; OBSIDIAN will not send media to an online service.`);
      }
      throw error;
    }
    try {
      await stat(join(modelDirectory, `${model}.pt`));
    } catch {
      throw new TranscriptionError(503, `The local Whisper '${model}' model is not cached in ${modelDirectory}. Download it separately; OBSIDIAN will not fetch model files automatically.`);
    }
    await runProcess(python, [TRANSCRIBER_SCRIPT, "--check", model, modelDirectory], { timeoutMs: 90_000, outputLimit: 4_096, spawnProcess, signal });
    reportStage(onProgress, "complete", "preparing");
  }

  async function assertAudioTrack(inputPath, { signal, onProgress } = {}) {
    reportStage(onProgress, "start", "validating", "Checking media accessibility, audio track, and duration limits.");
    const ffprobe = await getFfprobe();
    const probe = await runProcess(ffprobe, [
      "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", inputPath,
    ], { timeoutMs: 30_000, outputLimit: 256_000, spawnProcess, signal });
    let details;
    try { details = JSON.parse(probe.stdout); } catch {
      throw new TranscriptionError(415, "ffprobe could not read the selected media.");
    }
    if (!Array.isArray(details.streams) || !details.streams.some((stream) => stream.codec_type === "audio")) {
      throw new TranscriptionError(415, "The selected media has no readable audio track.");
    }
    const duration = Number(details.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new TranscriptionError(415, "The selected media has no usable duration.");
    if (duration > MAX_MEDIA_SECONDS) throw new TranscriptionError(413, "Local captioning currently supports media up to 30 minutes.");
    return duration;
  }

  async function transcribeAudioFile(inputPath, inputDuration = null, { signal, onProgress } = {}) {
    const duration = inputDuration ?? await assertAudioTrack(inputPath, { signal, onProgress });
    await assertLocalWhisperReady({ signal, onProgress });
    const directory = await mkdtemp(join(tmpdir(), "obsidian-captions-"));
    const wavPath = join(directory, "audio-16khz-mono.wav");
    try {
      reportStage(onProgress, "start", "extracting_audio", "Extracting mono 16 kHz audio locally with FFmpeg.");
      const ffmpeg = await getFfmpeg();
      await runProcess(ffmpeg, ["-nostdin", "-v", "error", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", wavPath], {
        timeoutMs: 3 * 60 * 1000,
        outputLimit: 32_000,
        spawnProcess,
        signal,
      });
      reportStage(onProgress, "complete", "extracting_audio");
      reportStage(onProgress, "start", "loading_model", "Starting the local Python worker and loading the verified model.");
      const workerArgs = onProgress
        ? [TRANSCRIBER_SCRIPT, "--progress", wavPath, model, modelDirectory]
        : [TRANSCRIBER_SCRIPT, wavPath, model, modelDirectory];
      const result = await runProcess(python, workerArgs, {
        spawnProcess,
        signal,
        onProgress,
      });
      reportStage(onProgress, "start", "processing_results", "Parsing Whisper output and word timestamps.");
      let parsed;
      try { parsed = JSON.parse(result.stdout); } catch {
        throw new TranscriptionError(502, "Local Whisper returned malformed transcript data.");
      }
      reportStage(onProgress, "complete", "processing_results");
      reportStage(onProgress, "start", "validating_captions", "Validating transcript text, phrase timing, and word timestamps.");
      const transcript = validateWhisperOutput(parsed);
      reportStage(onProgress, "complete", "validating_captions");
      return { ...transcript, duration };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  return {
    async checkDependencies() {
      const status = { python: { configured: python, available: false, version: null }, whisper: { installed: false, model: null, modelVerified: false }, ffmpeg: { path: null, available: false }, ffprobe: { path: null, available: false } };
      try {
        status.python.version = await pythonVersion();
        status.python.available = true;
      } catch (error) { status.python.error = error.message; }
      if (status.python.available) {
        try {
          await runProcess(python, ["-c", "import whisper"], { timeoutMs: WHISPER_IMPORT_TIMEOUT_MS, outputLimit: 4_096, spawnProcess });
          status.whisper.installed = true;
          status.whisper.model = model;
          await stat(join(modelDirectory, `${model}.pt`));
          const checked = await runProcess(python, [TRANSCRIBER_SCRIPT, "--check", model, modelDirectory], { timeoutMs: 90_000, outputLimit: 4_096, spawnProcess });
          status.whisper.modelVerified = JSON.parse(checked.stdout).verified === true;
        } catch (error) { status.whisper.error = error.message; }
      }
      try { status.ffmpeg.path = await getFfmpeg(); status.ffmpeg.available = true; }
      catch (error) { status.ffmpeg.error = error.message; }
      try { status.ffprobe.path = await getFfprobe(); status.ffprobe.available = true; }
      catch (error) { status.ffprobe.error = error.message; }
      return status;
    },
    async transcribeVideoPath(pathValue, { signal, onProgress } = {}) {
      return withTranscriptionLock(signal, async () => {
        reportStage(onProgress, "start", "validating", "Validating the selected local media path and request limits.");
        if (typeof pathValue !== "string" || !pathValue.trim() || pathValue.length > 4_096) {
          throw new TranscriptionError(400, "Select one After Effects footage layer before generating captions.");
        }
        const extension = extname(pathValue).toLowerCase();
        if (!ALLOWED_VIDEO_EXTENSIONS.has(extension)) throw new TranscriptionError(415, "This media type is not supported for local captioning.");
        let sourcePath;
        try {
          sourcePath = await realpath(pathValue);
          const file = await stat(sourcePath);
          if (!file.isFile()) throw new Error("not a file");
        } catch {
          throw new TranscriptionError(404, "The selected footage file is unavailable on this computer.");
        }
        const duration = await assertAudioTrack(sourcePath, { signal, onProgress });
        reportStage(onProgress, "complete", "validating");
        return transcribeAudioFile(sourcePath, duration, { signal, onProgress });
      });
    },

    async transcribeVoiceBase64(mimeType, encoded, { signal, onProgress } = {}) {
      return withTranscriptionLock(signal, async () => {
        const extension = ALLOWED_VOICE_TYPES.get(String(mimeType || "").split(";")[0].trim().toLowerCase());
        if (!extension) throw new TranscriptionError(415, "The microphone recording format is not supported by local captioning.");
        if (typeof encoded !== "string" || encoded.length === 0 || encoded.length > Math.ceil(MAX_VOICE_AUDIO_BYTES * 4 / 3) + 8) {
          throw new TranscriptionError(413, "The microphone recording is empty or exceeds the 10 MB limit.");
        }
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.length === 0 || bytes.length > MAX_VOICE_AUDIO_BYTES || bytes.toString("base64") !== encoded.replace(/\s/g, "")) {
          throw new TranscriptionError(413, "The microphone recording is invalid or exceeds the 10 MB limit.");
        }
        const directory = await mkdtemp(join(tmpdir(), "obsidian-voice-"));
        const audioPath = join(directory, `voice${extension}`);
        try {
          await writeFile(audioPath, bytes, { flag: "wx" });
          const duration = await assertAudioTrack(audioPath, { signal, onProgress });
          reportStage(onProgress, "complete", "validating");
          return await transcribeAudioFile(audioPath, duration, { signal, onProgress });
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      });
    },
  };
}

async function readJsonBody(request, limit) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > limit) throw new TranscriptionError(413, "The transcription request is too large.");
  }
  try { return JSON.parse(body); } catch {
    throw new TranscriptionError(400, "The transcription request must be valid JSON.");
  }
}

export async function handleTranscriptionRequest(request, response, { send, transcriber }) {
  if (!isCepPanelRequest(request)) {
    return send(response, 403, { error: "Local transcription is available only to the OBSIDIAN CEP panel." });
  }
  if (request.method !== "POST") return send(response, 405, { error: "Use POST for local transcription." });
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
    return send(response, 415, { error: "Send a JSON request to local transcription." });
  }
  try {
    const voice = request.url === "/transcribe-voice";
    if (!voice && request.url !== "/transcribe") return send(response, 404, { error: "Not found." });
    const input = await readJsonBody(request, voice ? 14 * 1024 * 1024 : 8_192);
    const streaming = !voice && typeof response.writeHead === "function" && typeof response.write === "function" && typeof response.end === "function";
    let streamStarted = false;
    let currentStage = null;
    const controller = new AbortController();
    const writeRawEvent = (event) => {
      if (streaming && streamStarted && !response.destroyed && !response.writableEnded) response.write(JSON.stringify(event) + "\n");
    };
    const writeEvent = (event) => {
      if (event.type === "stage") {
        if (event.phase === "start") {
          if (currentStage === event.stage) return;
          if (currentStage) writeRawEvent({ type: "stage", phase: "complete", stage: currentStage });
          currentStage = event.stage;
        } else if (event.phase === "complete") {
          if (currentStage !== event.stage) return;
          currentStage = null;
        } else {
          return;
        }
      } else if (event.type === "progress" && (event.stage !== currentStage || currentStage !== "transcribing")) {
        return;
      }
      writeRawEvent(event);
    };
    const onResponseClose = () => {
      if (!response.writableEnded && !controller.signal.aborted) {
        controller.abort(new TranscriptionError(499, "Local transcription was cancelled because the client disconnected."));
      }
    };
    if (typeof response.once === "function") response.once("close", onResponseClose);
    if (streaming) {
      response.writeHead(200, {
        "Access-Control-Allow-Origin": cepAllowedOrigin(request),
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": CEP_EXTENSION_ID_ALLOW_HEADER,
        "Vary": "Origin",
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      streamStarted = true;
      writeEvent({ type: "stage", phase: "start", stage: "validating", description: "Checking the selected media path and request limits." });
    }
    const timeout = streaming ? setTimeout(() => {
      controller.abort(new TranscriptionError(504, "The local transcription request exceeded its 22-minute limit."));
    }, MAX_TRANSCRIPTION_REQUEST_MS) : null;
    try {
      const options = { signal: controller.signal, onProgress: streaming ? writeEvent : undefined };
      const transcript = voice
        ? await transcriber.transcribeVoiceBase64(input?.mimeType, input?.audioBase64, options)
        : await transcriber.transcribeVideoPath(input?.path, options);
      if (streaming) {
        writeEvent({ type: "result", transcript, processing: "local" });
        if (!response.destroyed && !response.writableEnded) response.end();
        return;
      }
      return send(response, 200, { transcript, processing: "local" });
    } catch (error) {
      const status = error instanceof TranscriptionError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      if (streaming && streamStarted) {
        writeEvent({
          type: "error",
          stage: currentStage,
          status,
          message: status === 500 ? "Local transcription failed safely. No project edits were made." : message,
        });
        if (!response.destroyed && !response.writableEnded) response.end();
        return;
      }
      return send(response, status, { error: status === 500 ? "Local transcription failed safely. No project edits were made." : message });
    } finally {
      if (timeout) clearTimeout(timeout);
      if (typeof response.removeListener === "function") response.removeListener("close", onResponseClose);
    }
  } catch (error) {
    const status = error instanceof TranscriptionError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    return send(response, status, { error: status === 500 ? "Local transcription failed safely. No project edits were made." : message });
  }
}
