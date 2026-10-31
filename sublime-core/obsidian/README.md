# OBSIDIAN

OBSIDIAN is the After Effects motion-design assistant in Sublime Core. It currently runs as a lightweight CEP panel with a deterministic planner, a small local motion-design knowledge base, and a guarded ExtendScript host bridge.

## Layout

- `frontend/` — CEP panel UI, local knowledge, command planner, and browser-side interaction.
- `backend/host/` — ExtendScript host bridge loaded by After Effects, including project/layer inspection and guarded Glow/Opacity actions.
- `backend/core/` — Node-testable facade for the shared browser planner and optional local CORE/caption service.
- `backend/captions/` — local media extraction and optional cached Whisper transcription.
- `CSXS/manifest.xml` — Adobe CEP extension manifest; it must remain at the extension root.

## Working small-knowledge model

The current knowledge brain is explicit JavaScript data in `frontend/knowledge.js`, consumed by `frontend/planner.shared.js`. It can answer a small set of direct motion-design questions and map familiar language to supported edits.

- **Cinematic Glow:** cinematic, subtle, soft, restrained, atmospheric, dreamy, filmic.
- **Attention Glow:** bold, strong, punchy, dramatic, neon, pop, stand out.
- **Motion basics:** easing, visual hierarchy, fades, and text readability.
- **Editing knowledge:** retrieved concise principles for pacing/storytelling, color/contrast, typography/captions, transitions/motion, composition, and audio/synchronization.
- **Commands:** inspect project/layers; set or reduce opacity; apply bounded Brightness/Contrast; use guarded fades, scale-in, slide-up, and two-layer crossfades; apply supported Glow presets and fixed Cinematic Glow, Dark and Dramatic, High Contrast, and Gentle Entrance recipes.
- **Creative recipes:** 32 proposal-only style recipes across film, neon/cyberpunk, horror, energetic/anime, dreamy/nostalgic, visual storytelling, typography, transitions, and motion design. Four fixed recipes have guarded host execution paths.

Examples to try in the panel:
- `What is easing?` — returns a short knowledge answer; does not edit the composition.
- `How do I make this title pop?` — returns design guidance; does not edit the composition.
- `Add a subtle cinematic glow` — applies the restrained cinematic preset and verifies the effect settings in the host.
- `Add a bold neon bloom` — applies the attention preset and verifies the effect settings in the host.
- `Set opacity to 45%` — requests the guarded opacity action.
- `Make a gentle title entrance` — applies a verified 0.5-second fade and 95%-to-current-scale animation as one host-validated recipe.
- `Set brightness to -10 and contrast to 15` — applies the native effect with bounded values after checking selected layers; existing effect instances are preserved.
- `Give it a dark and dramatic look` — applies Brightness -12 and Contrast +14, then verifies both values.
- `Make it high contrast` — applies neutral Brightness and Contrast +20, then verifies both values.
- `Apply a cinematic glow look` — adds the restrained Glow preset after checking for existing Glow effects.

Conflicting Glow styles prompt a question. Unsupported requests are not executed by the deterministic planner. Knowledge answers are local and deterministic.

**AI proposals:** OBSIDIAN can optionally ask the existing local CORE/Qwen model (through the shared Ollama provider) to interpret creative requests and return a structured proposal. Start Ollama with the configured model (default model name `core`), then from `sublime-core/` (the directory containing `package.json`) run `npm run obsidian:ai` before using the panel. Set `OLLAMA_MODEL` or `OLLAMA_BASE_URL` in the local environment when needed; `.env` is git-ignored. No hosted provider or API key is used.

The model endpoint is proposal-only: it has no tools and accepts no executable action schema. OBSIDIAN bounds and validates its response, labels it `PROPOSED`, and renders it as text. The deterministic planner handles executable actions, unsupported custom Glow tuning, and clarifications; only recognized recipe proposals and otherwise unsupported requests are sent to CORE. If the local service/model is unavailable, existing deterministic recipe proposals remain available and unsupported requests show setup guidance. Model output is never passed to the After Effects host bridge.

CORE proposals interpret the text request only. They do not inspect project state or rendered pixels, verify visual results, or learn a user's style. They do not claim any edit was applied.

## Current host capabilities

- Read-only inspection of the active composition and selected layers.
- Composition dimensions, frame rate, duration, playhead time, layer count and selection count.
- Selected-layer type, enabled/3D/locked/shy state, in/out points, opacity, transform values and effect names.
- Text content, font name and font size where the host exposes them.
- Glow add/remove actions use the native `ADBE Glo2` effect and verify the effect and supported preset settings after editing.
- The fixed Cinematic Glow recipe applies Glow threshold 76, radius 24, and intensity 0.25. Existing Glow is preserved by refusing the edit; failed additions are removed where verifiable.
- Opacity set/reduce actions have property read-back checks and refuse to overwrite existing opacity keyframes or enabled expressions.
- Guarded 0.5-second opacity fades, scale-ins, and slide-ups for selected layers. They check locks, durations, property shapes, and existing keyframes/expressions before editing, read keys back, and remove generated keys when verification fails.
- A two-layer crossfade requires overlapping layers with distinguishable start times and static opacity. Both curves are preflighted and written in one undo group.
- The fixed Gentle Entrance recipe combines fade-in and scale-in. It declares its operations, bounds, prerequisites, compatibility, expected result, verification, and failure handling; both operations are preflighted and verified in one undo group.
- Brightness/Contrast supports explicit values from -25 to 25. The host checks the native effect and parameter layout, refuses to overwrite an existing instance, reads both values back, and removes newly added effects if verification fails.
- Fixed Dark and Dramatic (Brightness -12, Contrast +14) and High Contrast (Brightness 0, Contrast +20) recipes use that same guarded effect path. They do not add color tinting.
- Guarded Scale changes distinguish absolute targets (`scale to 10%`) from relative changes (`scale up by 10%`). Both preflight every selected layer, preserve keyframes and expressions by refusing the edit, validate 2D/3D vector dimensions and Scale property types, read values back, and restore originals on mismatch.
- Captions inspect one selected local footage layer read-only, transcribe audio through optional local Whisper, map timestamps to composition time, and present editable SRT before a separate user action creates styled text layers. The host revalidates source and timing and rolls back only generated caption layers if verification fails.
- Voice input records locally for up to 60 seconds and transcribes through the same local Whisper service. Recognized text is placed in the command box for review; sending it still uses the normal planner and guarded host path.
- Protection against directly changing opacity where keyframes or an enabled expression already exists.

## Creative recipe boundary

The 32-item local style catalog describes intent, natural-language cues, qualitative parameters, prerequisites, ordered readiness-labeled steps, compatibility, and safe fallbacks. Those style plans remain `PROPOSED`. Separately, the fixed creative recipe catalog defines four executable recipes with exact inputs, bounds, compatibility, verification, and failure handling. Full neon, vintage/film, horror, anime, dreamy color looks, and generated atmosphere remain proposals because the available host actions do not provide those distinct treatments.

## Capability matrix

| Capability | Examples | OBSIDIAN behavior |
| --- | --- | --- |
| **Executable — read-only** | Inspect the active composition/project; inspect selected layers, text, transforms, and effect names | Sends a typed inspection action to the host. It reads metadata and does not change the project. |
| **Executable — guarded edits** | Set/reduce opacity; bounded Brightness/Contrast; fade-in/out; scale-in; slide-up; crossfade two overlapping layers; apply/remove Glow; Cinematic Glow, Dark and Dramatic, High Contrast, and Gentle Entrance recipes | Host validates inputs, preflights all affected layers, reads back properties/keyframes/effect settings, and cleans up changes created by a failed operation. Existing animation and effect instances are preserved by refusing edits. These paths are Node-mock-tested and have not been smoke-tested in After Effects. |
| **Caption workflow** | Transcribe selected footage; review/edit timed SRT; choose phrase or word timing and a basic style | Processing is local. Creating layers requires an explicit button, passes planner validation, and uses a guarded host action. Requires FFmpeg, Python `openai-whisper`, and a separately cached model; After Effects caption behavior has not been live-verified. |
| **Voice input** | Speak a natural-language command | Local microphone capture and Whisper transcription populate the command box; the user reviews and sends it through the existing planner. CEP microphone support and local Whisper setup are runtime dependencies. |
| **Proposal-only** | The 32 style recipes, including full neon treatments, vintage/film, horror, anime, dreamy color looks, narrative color arcs, typography, transitions, and movement | Returns qualitative parameters and ordered steps. Recipe plans are never sent to the host as edits, even when a step refers to an implemented inspection or guarded action. |
| **Clarification required** | Ambiguous Glow styles or unsupported custom Glow parameter tuning | Planner asks which supported Glow preset to use or explains the supported presets; no ambiguous or custom tuning request is executed. |
| **Unsupported** | Arbitrary scripts, unrecognized edits, or a style request with no matching recipe | Returns an unsupported response and does not call the host. A matched recipe that needs a decision may instead ask for clarification or label a step `REQUIRES_INPUT`. |

Knowledge answers are educational text, not project actions. “Executable” describes the tested code path and its guards; the Node host mock does not establish After Effects compatibility or runtime stability.

## Local proposal service

From `sublime-core/`, run `npm run obsidian:ai` in a terminal to start the loopback-only proposal endpoint at `http://127.0.0.1:43127/proposal`. It reuses the existing Ollama provider and its `OLLAMA_MODEL` / `OLLAMA_BASE_URL` settings. Install and start Ollama and make the local model available under the configured name (default `core`) before requesting a proposal. If the service is stopped, deterministic planning continues; requests are bounded to 90 seconds and malformed or unsafe proposals are rejected.

The same service provides `/transcribe` and `/transcribe-voice` for the CEP panel. They require CEP's `AdobeCEP` CEF request metadata and the extension ID returned by `__adobe_cep__.getExtensionId()`, allow only the registered OBSIDIAN panel IDs, and support CEP's observed `file://` origin (plus the opaque `null` origin used by other CEP builds). Ordinary browser origins and unmarked local clients are rejected. The routes return `processing: "local"` and invoke local FFmpeg and Whisper; no media is sent to Ollama or a hosted speech API. OBSIDIAN does not install Whisper or download model files automatically. To enable captions, install `openai-whisper` in a local Python environment with FFmpeg/ffprobe available, then cache a `tiny`, `base` (default), or `small` model separately. For example, from that Python environment, `python -c "import whisper; whisper.load_model('base', device='cpu')"` downloads/caches the model before OBSIDIAN is used. Configure `OBSIDIAN_PYTHON`, `OBSIDIAN_WHISPER_MODEL`, `OBSIDIAN_WHISPER_MODEL_DIR`, `OBSIDIAN_FFMPEG_PATH`, or `OBSIDIAN_FFPROBE_PATH` when defaults do not match the machine. Transcription is limited to 30-minute media and temporary extracted audio is removed after processing.

`GET /health` reports whether the configured Ollama API is reachable and whether its configured model is present; it never starts Ollama. `GET /dependencies` also verifies the selected Python environment, cached model SHA-256, and that both FFmpeg tools run. On the development machine, `.env` points at a dedicated Python 3.13 venv and the existing `C:/BUILD/ffmpeg.exe` and `C:/BUILD/ffprobe.exe` binaries. The full outstanding dependency and live-test ledger is [DEPENDENCY_TRACKER.md](DEPENDENCY_TRACKER.md).

In the panel, select one local footage layer and choose **CC** or ask to generate captions. Review/edit the SRT, choose readable phrase or word-by-word timing and a basic style, then use **Create caption layers** to add new text layers. Voice requests are recorded locally for at most 60 seconds; the transcript is inserted into the command box and is not submitted until the user presses Send. Unsupported CEP microphone APIs and missing local dependencies report errors without using cloud speech recognition.

The proposal endpoint has no After Effects connection, tools, or credentials. Its structured proposal is presentation data only. Caption creation is a separate explicit planner/typed-host action and does not accept model output. Do not route model output directly to ExtendScript.

## After Effects validation

The Node tests use a mocked host and do not prove CEP/ExtendScript compatibility or rule out After Effects undo crashes. Validate the actual extension inside After Effects before treating host behavior as production-safe.

Host outcomes are labeled separately as verified, rejected, failed, or timed out. A timed-out edit has an unknown result; inspect the selected layers before retrying. CORE and recipe responses remain proposal-only.

From the repository root, the combined command is:

```sh
npm run obsidian:test
```

The test runner is Node's built-in test runner; it adds no dependencies.

## Shared runtime boundary

The existing shared `../core` runtime contains code used by other Sublime Core features, including NOVA. Keep that runtime intact and integrate OBSIDIAN through explicit interfaces so unrelated tools remain unaffected.
