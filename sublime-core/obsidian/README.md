# OBSIDIAN

OBSIDIAN is the After Effects motion-design assistant in Sublime Core. It currently runs as a lightweight CEP panel with a deterministic planner, a small local motion-design knowledge base, and a guarded ExtendScript host bridge.

## Layout

- `frontend/` — CEP panel UI, local knowledge, command planner, and browser-side interaction.
- `backend/host/` — ExtendScript host bridge loaded by After Effects, including project/layer inspection and guarded Glow/Opacity actions.
- `backend/core/` — Node-testable facade for the shared browser planner.
- `CSXS/manifest.xml` — Adobe CEP extension manifest; it must remain at the extension root.

## Working small-knowledge model

The current knowledge brain is explicit JavaScript data in `frontend/knowledge.js`, consumed by `frontend/planner.shared.js`. It can answer a small set of direct motion-design questions and map familiar language to supported edits.

- **Cinematic Glow:** cinematic, subtle, soft, restrained, atmospheric, dreamy, filmic.
- **Attention Glow:** bold, strong, punchy, dramatic, neon, pop, stand out.
- **Motion basics:** easing, visual hierarchy, fade-ins, and text readability.
- **Commands:** inspect project/layers, set or reduce opacity, request a guarded fade-in, and scale selected layers proportionally. Glow requests are classified but blocked.
- **Creative recipes:** 32 descriptive recipes across film, neon/cyberpunk, horror, energetic/anime, dreamy/nostalgic, color grading, visual storytelling, typography, transitions, and motion design.

Examples to try in the panel:
- `What is easing?` — returns a short knowledge answer; does not edit the composition.
- `How do I make this title pop?` — returns design guidance; does not edit the composition.
- `Add a subtle cinematic glow` — identifies restrained cinematic intent, then reports that Glow is blocked; no edit is sent to After Effects.
- `Add a bold neon bloom` — identifies bold neon intent, then reports that Glow is blocked; no edit is sent to After Effects.
- `Set opacity to 45%` — requests the guarded opacity action.

Conflicting Glow styles prompt a question. Unsupported requests are not executed by the deterministic planner. Knowledge answers are local and deterministic.

**AI proposals:** OBSIDIAN can optionally ask the existing local CORE/Qwen model (through the shared Ollama provider) to interpret creative requests and return a structured proposal. Start Ollama with the configured model (default model name `core`), then run `npm run obsidian:ai` from the repository root before using the panel. Set `OLLAMA_MODEL`, `OLLAMA_BASE_URL`, or `OBSIDIAN_AI_PORT` in the local environment when needed; `.env` is git-ignored. No hosted provider or API key is used.

The model endpoint is proposal-only: it has no tools and accepts no executable action schema. OBSIDIAN bounds and validates its response, labels it `PROPOSED`, and renders it as text. The deterministic planner still handles executable actions, blocked Glow requests, and clarifications; only recognized recipe proposals and otherwise unsupported requests are sent to CORE. If the local service/model is unavailable, existing deterministic recipe proposals remain available and unsupported requests show setup guidance. Model output is never passed to the After Effects host bridge.

CORE proposals interpret the text request only. They do not inspect project state or rendered pixels, verify visual results, or learn a user's style. They do not claim any edit was applied.

## Current host capabilities

- Read-only inspection of the active composition and selected layers.
- Composition dimensions, frame rate, duration, playhead time, layer count and selection count.
- Selected-layer type, enabled/3D/locked/shy state, in/out points, opacity, transform values and effect names.
- Text content, font name and font size where the host exposes them.
- Glow add/remove handlers are blocked during the RenderTaskManager crash investigation. Glow actions are excluded from the planner's executable allowlist.
- Opacity set/reduce actions have property read-back checks and refuse to overwrite existing opacity keyframes or enabled expressions.
- A guarded 0.5-second opacity fade-in for selected layers. It checks locked layers, short durations, and existing opacity keyframes/expressions before editing, then reads keyframes back to verify the result.
- A guarded proportional Scale adjustment for selected layers. It preflights every layer, refuses locks, keyframes, expressions, unsupported value shapes, and excessive results, then verifies the static Scale values.
- Protection against directly changing opacity where keyframes or an enabled expression already exists.

## Creative recipe boundary

The local recipe catalog describes intent, natural-language cues, qualitative parameters, prerequisites, ordered readiness-labeled steps, compatibility, and safe fallbacks. Each recipe is `PROPOSED`; recipe planning never runs a host edit. `IMPLEMENTED` marks an existing supported host capability, `BLOCKED` marks a disabled or unsafe operation, and `REQUIRES_INPUT` marks a decision the editor must provide. Color grading, generated atmosphere, grain, transitions, and other motion-design effects remain proposals until OBSIDIAN has tested host support and read-back verification for them.

## Capability matrix

| Capability | Examples | OBSIDIAN behavior |
| --- | --- | --- |
| **Executable — read-only** | Inspect the active composition/project; inspect selected layers, text, transforms, and effect names | Sends a typed inspection action to the host. It reads metadata and does not change the project. |
| **Executable — guarded edits** | Set opacity to a value from 0–100%; reduce selected-layer opacity; fade selected layers in; scale selected layers proportionally up/down | Host validates arguments and reads back results. Opacity edits refuse existing opacity keyframes or enabled expressions. Fade-in is fixed at 0.5 seconds and refuses locked, too-short, animated, or expression-driven layers. Scale accepts one relative change from 1% to 100% up or less than 100% down; all selected layers must be unlocked, have a supported 2D/3D Scale vector, and have no Scale keyframes or enabled expression. Scale writes are preflighted and read back, with restoration attempted if verification fails. This scale path is Node-mock-tested but has not been smoke-tested in After Effects. |
| **Proposal-only** | All 32 creative recipes, including cinematic/color grades, neon, horror, anime, narrative color arcs, typography, transitions, and movement | Returns qualitative parameters and ordered steps. Recipe plans are never sent to the host as edits, even when a step refers to an implemented inspection or guarded action. |
| **Blocked** | Recognized requests to add, remove, or adjust Glow/bloom | Planner reports recognized Glow mutation requests as blocked; host Glow add/remove handlers also return without mutating. Glow is not in the executable allowlist. Other unrecognized phrasings remain non-executable. |
| **Unsupported** | Arbitrary scripts, unrecognized edits, or a style request with no matching recipe | Returns an unsupported response and does not call the host. A matched recipe that needs a decision may instead ask for clarification or label a step `REQUIRES_INPUT`. |

Knowledge answers are educational text, not project actions. “Executable” describes the tested code path and its guards; the Node host mock does not establish After Effects compatibility or runtime stability.

## Local proposal service

Run `npm run obsidian:ai` in a terminal to start the loopback-only proposal endpoint at `http://127.0.0.1:43127/proposal`. It reuses the existing Ollama provider and its `OLLAMA_MODEL` / `OLLAMA_BASE_URL` settings. Install and start Ollama and make the local model available under the configured name (default `core`) before requesting a proposal. If the service is stopped, deterministic planning continues.

The service has no After Effects connection, tools, or credentials. Its structured proposal is presentation data only. To implement future model-suggested edits, add explicit deterministic planner/host actions with validation, verification, rollback, and tests; do not route model output directly to ExtendScript.

## After Effects validation

The Node tests use a mocked host and do not prove CEP/ExtendScript compatibility or rule out After Effects undo crashes. Validate the actual extension inside After Effects before treating host behavior as production-safe.

From the repository root, the combined command is:

```sh
npm run obsidian:test
```

The test runner is Node's built-in test runner; it adds no dependencies.

## Shared runtime boundary

The existing shared `../core` runtime contains code used by other Sublime Core features, including NOVA. Keep that runtime intact and integrate OBSIDIAN through explicit interfaces so unrelated tools remain unaffected.
