import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { PassThrough } from "node:stream";
import {
  MAX_MEDIA_SECONDS,
  MAX_VOICE_AUDIO_BYTES,
  TranscriptionError,
  createLocalTranscriber,
  handleTranscriptionRequest,
  resolveLocalExecutable,
  validateWhisperOutput,
} from "../captions/transcription.mjs";
import { isCepPanelRequest, isCepTranscriptionPreflight } from "../captions/cep-auth.mjs";

function request(url, payload, options = {}) {
  const input = Readable.from([Buffer.from(payload)]);
  input.method = options.method || "POST";
  input.url = url;
  input.headers = {
    "content-type": options.contentType || "application/json",
    origin: options.origin === undefined ? "null" : options.origin,
    "user-agent": options.userAgent === undefined ? "Mozilla/5.0 Chrome/99.0.4844.84 AdobeCEP/12.0.1" : options.userAgent,
    "sec-fetch-mode": options.fetchMode === undefined ? "cors" : options.fetchMode,
    "x-obsidian-cep-extension-id": options.extensionId === undefined ? "com.zroul.obsidian.panel" : options.extensionId,
  };
  return input;
}

function responseCapture() {
  return {
    status: 0,
    body: null,
    send(_response, status, body) {
      this.status = status;
      this.body = body;
    },
  };
}

function streamingResponseCapture() {
  const events = new EventEmitter();
  return {
    status: 0,
    headers: null,
    chunks: [],
    destroyed: false,
    writableEnded: false,
    once: events.once.bind(events),
    removeListener: events.removeListener.bind(events),
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    write(chunk) { this.chunks.push(String(chunk)); return true; },
    end() { this.writableEnded = true; },
    send(_response, status, body) { this.status = status; this.body = body; },
    get bodyText() { return this.chunks.join(""); },
  };
}

test("local transcription bounds media duration and microphone upload size", () => {
  assert.equal(MAX_MEDIA_SECONDS, 1800);
  assert.equal(MAX_VOICE_AUDIO_BYTES, 10 * 1024 * 1024);
});

test("Whisper output is normalized and invalid timestamps are discarded", () => {
  const result = validateWhisperOutput({
    duration: 4,
    segments: [
      { text: " Hello. ", start: 0.2, end: 1.1, words: [{ text: "Hello.", start: 0.2, end: 1.1 }] },
      { text: "", start: 1.2, end: 1.4, words: [] },
      { text: "invalid", start: 3, end: 2, words: [] },
    ],
  });
  assert.equal(result.duration, 4);
  assert.deepEqual(result.segments, [{
    text: "Hello.", start: 0.2, end: 1.1,
    words: [{ text: "Hello.", start: 0.2, end: 1.1 }],
  }]);
  assert.throws(() => validateWhisperOutput({ segments: [] }), TranscriptionError);
  assert.throws(() => validateWhisperOutput({ segments: new Array(5001) }), /oversized transcript/);
});

test("transcription request returns local results from the injected local engine", async () => {
  const response = responseCapture();
  let pathValue;
  await handleTranscriptionRequest(
    request("/transcribe", JSON.stringify({ path: "C:/local/clip.mp4" })),
    response,
    {
      send: response.send.bind(response),
      transcriber: {
        async transcribeVideoPath(value) {
          pathValue = value;
          return { segments: [{ text: "Local speech.", start: 0, end: 1, words: [] }], duration: 1 };
        },
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.processing, "local");
  assert.equal(response.body.transcript.segments[0].text, "Local speech.");
  assert.equal(pathValue, "C:/local/clip.mp4");
});

test("video transcription streams ordered stage starts/completions and its local transcript as NDJSON", async () => {
  const response = streamingResponseCapture();
  await handleTranscriptionRequest(
    request("/transcribe", JSON.stringify({ path: "C:/local/clip.mp4" }), {
      origin: "file://",
      extensionId: "com.zroul.obsidian.smoketest.5611c73bb73c4b11bf3128ca8e64519e.panel",
    }),
    response,
    {
      send: response.send.bind(response),
      transcriber: {
        async transcribeVideoPath(_value, { signal, onProgress }) {
          assert.equal(signal.aborted, false);
          onProgress({ type: "stage", phase: "start", stage: "preparing", description: "Preparing local worker." });
          onProgress({ type: "stage", phase: "complete", stage: "preparing" });
          onProgress({ type: "stage", phase: "start", stage: "transcribing", description: "Whisper is processing locally." });
          onProgress({ type: "progress", stage: "transcribing", current: 25, total: 100 });
          onProgress({ type: "stage", phase: "complete", stage: "transcribing" });
          onProgress({ type: "stage", phase: "start", stage: "processing_results", description: "Parsing timestamps." });
          onProgress({ type: "stage", phase: "complete", stage: "processing_results" });
          onProgress({ type: "stage", phase: "start", stage: "validating_captions", description: "Validating captions." });
          onProgress({ type: "stage", phase: "complete", stage: "validating_captions" });
          return { segments: [{ text: "Local speech.", start: 0, end: 1, words: [] }], duration: 1 };
        },
      },
    },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers["Content-Type"], /application\/x-ndjson/);
  assert.equal(response.headers["Access-Control-Allow-Origin"], "file://");
  assert.match(response.headers["Access-Control-Allow-Headers"], /X-Obsidian-CEP-Extension-Id/i);
  assert.equal(response.writableEnded, true);
  const events = response.bodyText.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.type === "stage" ? `${event.phase}:${event.stage}` : event.type), [
    "start:validating", "complete:validating", "start:preparing", "complete:preparing",
    "start:transcribing", "progress", "complete:transcribing", "start:processing_results",
    "complete:processing_results", "start:validating_captions", "complete:validating_captions", "result",
  ]);
  assert.deepEqual(events[5], { type: "progress", stage: "transcribing", current: 25, total: 100 });
  assert.equal(events.at(-1).processing, "local");
  assert.equal(events.at(-1).transcript.segments[0].text, "Local speech.");
});

test("Python worker progress lines are parsed and forwarded with the final transcript", async () => {
  const directory = await mkdtemp(join(tmpdir(), "obsidian-progress-test-"));
  const mediaPath = join(directory, "clip.mp4");
  const modelDirectory = join(directory, "models");
  await writeFile(mediaPath, "disposable media fixture");
  await mkdir(modelDirectory);
  await writeFile(join(modelDirectory, "base.pt"), "cached model fixture");
  const calls = [];
  const spawnProcess = (binary, args) => {
    calls.push({ binary, args });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    let stdout = "";
    if (args[0] === "-version") stdout = `${binary} version test`;
    else if (binary === "ffprobe-test") stdout = JSON.stringify({ format: { duration: "1" }, streams: [{ codec_type: "audio" }] });
    else if (binary === "python-test" && args[0] === "-c") stdout = "";
    else if (binary === "python-test" && args[1] === "--check") stdout = JSON.stringify({ verified: true });
    else if (binary === "ffmpeg-test") writeFileSync(args[args.length - 1], "wav fixture");
    else if (binary === "python-test" && args[1] === "--progress") {
      stdout = [
        JSON.stringify({ type: "stage", phase: "complete", stage: "loading_model" }),
        JSON.stringify({ type: "stage", phase: "start", stage: "transcribing", description: "Whisper is processing." }),
        JSON.stringify({ type: "progress", stage: "transcribing", current: 37, total: 100 }),
        JSON.stringify({ type: "stage", phase: "complete", stage: "transcribing" }),
        JSON.stringify({ duration: 1, segments: [{ text: "Local speech.", start: 0, end: 1, words: [] }] }),
      ].join("\n") + "\n";
    }
    process.nextTick(() => {
      child.stdout.end(stdout);
      child.stderr.end();
      setImmediate(() => child.emit("close", 0));
    });
    return child;
  };
  try {
    const transcriber = createLocalTranscriber({
      env: {
        OBSIDIAN_PYTHON: "python-test",
        OBSIDIAN_WHISPER_MODEL: "base",
        OBSIDIAN_WHISPER_MODEL_DIR: modelDirectory,
        OBSIDIAN_FFMPEG_PATH: "ffmpeg-test",
        OBSIDIAN_FFPROBE_PATH: "ffprobe-test",
      },
      spawnProcess,
    });
    const events = [];
    const result = await transcriber.transcribeVideoPath(mediaPath, { onProgress: (event) => events.push(event) });
    assert.equal(result.segments[0].text, "Local speech.");
    assert.deepEqual(events.filter((event) => event.type === "progress"), [
      { type: "progress", stage: "transcribing", current: 37, total: 100 },
    ]);
    assert.ok(calls.some(({ binary, args }) => binary === "python-test" && args[1] === "--progress"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("streaming transcription reports the actual failing stage and readable error", async () => {
  const response = streamingResponseCapture();
  await handleTranscriptionRequest(
    request("/transcribe", JSON.stringify({ path: "C:/local/clip.mp4" })),
    response,
    {
      send: response.send.bind(response),
      transcriber: {
        async transcribeVideoPath(_value, { onProgress }) {
          onProgress({ type: "stage", phase: "start", stage: "preparing", description: "Loading cached Whisper." });
          throw new TranscriptionError(503, "Cached Whisper model is unavailable.");
        },
      },
    },
  );
  const events = response.bodyText.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.at(-1), {
    type: "error", stage: "preparing", status: 503, message: "Cached Whisper model is unavailable.",
  });
  assert.equal(response.writableEnded, true);
});

test("microphone transcription accepts only the bounded local audio request", async () => {
  const response = responseCapture();
  let received;
  await handleTranscriptionRequest(
    request("/transcribe-voice", JSON.stringify({ mimeType: "audio/webm;codecs=opus", audioBase64: "AQID" })),
    response,
    {
      send: response.send.bind(response),
      transcriber: {
        async transcribeVoiceBase64(mimeType, audioBase64) {
          received = { mimeType, audioBase64 };
          return { segments: [{ text: "Set scale to fifty percent.", start: 0, end: 1, words: [] }], duration: 1 };
        },
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(received.mimeType, "audio/webm;codecs=opus");
  assert.equal(received.audioBase64, "AQID");
});

test("transcription endpoint rejects invalid methods, content types, malformed JSON, and oversized bodies", async () => {
  const transcriber = { async transcribeVideoPath() { throw new Error("must not run"); } };
  for (const [input, expectedStatus] of [
    [request("/transcribe", "{}", { method: "GET" }), 405],
    [request("/transcribe", "{}", { contentType: "text/plain" }), 415],
    [request("/transcribe", "not-json"), 400],
    [request("/transcribe", " ".repeat(8193)), 413],
  ]) {
    const response = responseCapture();
    await handleTranscriptionRequest(input, response, { send: response.send.bind(response), transcriber });
    assert.equal(response.status, expectedStatus);
  }
});

test("transcription endpoint rejects browser origins outside the CEP panel before invoking speech recognition", async () => {
  const response = responseCapture();
  let called = false;
  await handleTranscriptionRequest(request("/transcribe", "{}", { origin: "https://example.com" }), response, {
    send: response.send.bind(response),
    transcriber: { async transcribeVideoPath() { called = true; } },
  });
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test("CEP 12 file-origin requests are accepted only with the runtime extension identity", async () => {
  const requestValue = request("/transcribe", "{}", {
    origin: "file://",
    extensionId: "com.zroul.obsidian.smoketest.5611c73bb73c4b11bf3128ca8e64519e.panel",
  });
  assert.equal(isCepPanelRequest(requestValue), true);

  const response = responseCapture();
  let called = false;
  await handleTranscriptionRequest(requestValue, response, {
    send: response.send.bind(response),
    transcriber: { async transcribeVideoPath() { called = true; return { segments: [] }; } },
  });
  assert.equal(called, true);
  assert.notEqual(response.status, 403);
});

test("CEP-only authorization rejects unmarked local callers and unregistered extension IDs", () => {
  assert.equal(isCepPanelRequest(request("/transcribe", "{}", {
    origin: "file://", userAgent: "Mozilla/5.0 Chrome/99.0.4844.84 AdobeCEP/12.0.1", extensionId: "",
  })), false);
  assert.equal(isCepPanelRequest(request("/transcribe", "{}", {
    origin: "file://", userAgent: "Mozilla/5.0 Chrome/99.0.4844.84 AdobeCEP/12.0.1", extensionId: "com.example.other.panel",
  })), false);
  assert.equal(isCepPanelRequest(request("/transcribe", "{}", {
    origin: "http://localhost:43127", userAgent: "Mozilla/5.0 Chrome/99.0.4844.84 AdobeCEP/12.0.1",
  })), false);
  assert.equal(isCepPanelRequest(request("/transcribe", "{}", {
    origin: "file://", userAgent: "Mozilla/5.0 Chrome/99.0.4844.84", extensionId: "com.zroul.obsidian.panel",
  })), false);
});

test("CEP transcription preflight is restricted to the measured file origin, CEF runtime, and required headers", () => {
  const preflight = request("/transcribe", "{}", { method: "OPTIONS", origin: "file://" });
  preflight.headers["access-control-request-method"] = "POST";
  preflight.headers["access-control-request-headers"] = "content-type, x-obsidian-cep-extension-id";
  assert.equal(isCepTranscriptionPreflight(preflight), true);

  preflight.headers.origin = "https://example.com";
  assert.equal(isCepTranscriptionPreflight(preflight), false);
});

test("tool discovery prefers configured paths and checks that the executable starts", async () => {
  const calls = [];
  const spawnProcess = (binary, args) => {
    calls.push({ binary, args });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    process.nextTick(() => {
      child.stdout.end("ffmpeg version test");
      child.stderr.end();
      child.emit("close", 0);
    });
    return child;
  };
  const resolved = await resolveLocalExecutable("ffmpeg", {
    configuredPath: "C:/BUILD/ffmpeg.exe",
    knownPaths: ["C:/other/ffmpeg.exe"],
    spawnProcess,
  });
  assert.equal(resolved, "C:/BUILD/ffmpeg.exe");
  assert.deepEqual(calls, [{ binary: "C:/BUILD/ffmpeg.exe", args: ["-version"] }]);
});

test("invalid configured tool path fails clearly instead of silently falling back", async () => {
  const spawnProcess = () => { throw new Error("file not found"); };
  await assert.rejects(() => resolveLocalExecutable("ffprobe", {
    configuredPath: "C:/missing/ffprobe.exe",
    knownPaths: ["C:/BUILD/ffprobe.exe"],
    spawnProcess,
  }), /Configured ffprobe executable cannot run/);
});

test("video transcription rejects missing local media before starting external tools", async () => {
  const transcriber = createLocalTranscriber({ env: { OBSIDIAN_PYTHON: "not-run" } });
  await assert.rejects(() => transcriber.transcribeVideoPath("C:/missing/clip.mp4"), (error) => {
    assert.equal(error.status, 404);
    return true;
  });
  await assert.rejects(() => transcriber.transcribeVideoPath("C:/missing/clip.jsx"), /not supported/);
});
