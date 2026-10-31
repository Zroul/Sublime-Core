# OBSIDIAN command planning and execution

The command planner is shared by the CEP frontend and Node tests through `frontend/planner.shared.js`. The `planner.mjs` module is a test-facing ES module facade over that single implementation.

## Request path

1. The CEP frontend plans the user's natural-language request.
2. Requests that need clarification or are unsupported are shown to the user and never sent to After Effects.
3. The frontend checks the action against the planner allowlist.
4. The frontend sends only a typed action and its narrow arguments through CEP's existing `evalScript` bridge.
5. `host.jsx` validates the action and arguments again, runs an existing guarded handler, and returns its verification result.

The planner itself remains deterministic and loads no model. Separately, the optional CORE service runs on loopback, uses the existing Ollama provider for proposal-only text, and exposes local caption transcription routes that require an installed Python Whisper environment and cached model.

## Safety and current limits

- The host does not parse free-form natural language. It accepts only the fixed action allowlist.
- Opacity must be between 0% and 100%; the host rejects out-of-range values instead of silently clamping them.
- Relative Scale changes (`scale up/down by N%`) are distinct from absolute targets (`scale to N%`). Both require static, unlocked Scale values and validate vector dimensions against the layer's 2D/3D state and property type before writing; mismatches include requested, immediate, fresh, type, and host-version diagnostics, then attempt to restore original values.
- Opacity and Scale writes are checked by host read-back. Fade-in and fade-out require static opacity, reject existing keyframes and expressions, verify generated keys, and remove generated keys if verification fails.
- Cinematic and attention Glow presets are executable only for recognized profiles; existing Glow is preserved by refusing the edit, and failed new effects are cleaned up where verifiable.
- CEP host calls have a 30-second callback deadline. A timeout is reported as an unknown result, and late or duplicate callbacks are ignored.
- The host reports preflight rejections separately from execution failures; proposal-only plans remain outside the execution bridge.
- Four fixed creative recipes execute through host allowlisted handlers: Cinematic Glow, Dark and Dramatic, High Contrast, and Gentle Entrance. The entrance combines fade-in and scale-in in one preflight, undo group, verification pass, and generated-key cleanup path; the three look profiles use guarded effect handlers.
- Brightness/Contrast uses bounded values, checks the effect's runtime parameter labels and types, refuses existing instances, verifies both values, and removes any newly added instance if verification fails.
- The separate 32-item style catalog is descriptive only. Each style plan remains `PROPOSED`; full neon, vintage, horror, anime, and dreamy color treatments do not execute.
- Caption transcription is local: it extracts audio with FFmpeg, runs only a cached Whisper model, and returns timed segments for SRT review. Caption layer creation is a distinct typed host action with a narrow style allowlist, fresh source/timing checks, read-back, and cleanup of newly created caption layers on failure.
- Voice recording is local and bounded; its transcript is placed in the command input for user review and still uses the regular planner. Captions and voice do not send footage/audio to CORE/Ollama or a hosted speech service.
- This is a first integrated vertical slice, not yet a context-aware creative editor. CORE reasoning, composition-aware effect parameter selection, and visual outcome analysis remain future work.

The planner can execute bounded inspection, caption creation, opacity, scale, fade, Glow, Brightness/Contrast, and the four fixed creative recipes. Other style recipes and CORE model output remain proposals and cannot execute host actions. Caption transcription requires local Python/Whisper and FFmpeg dependencies plus a separately cached model.

## Tests

Run from the repository's `sublime-core` directory:

```powershell
node --test obsidian/backend/core/planner.test.mjs
npm run obsidian:test
```
