# OBSIDIAN command planning and execution

The command planner is shared by the CEP frontend and Node tests through `frontend/planner.shared.js`. The `planner.mjs` module is a test-facing ES module facade over that single implementation.

## Request path

1. The CEP frontend plans the user's natural-language request.
2. Requests that need clarification or are unsupported are shown to the user and never sent to After Effects.
3. The frontend checks the action against the planner allowlist.
4. The frontend sends only a typed action and its narrow arguments through CEP's existing `evalScript` bridge.
5. `host.jsx` validates the action and arguments again, runs an existing guarded handler, and returns its verification result.

There is no new server, dependency, or model loaded by this integration. The current planner is deterministic; it is not CORE/Qwen integration.

## Safety and current limits

- The host does not parse free-form natural language. It accepts only the fixed action allowlist.
- Opacity must be between 0% and 100%; the host rejects out-of-range values instead of silently clamping them.
- Proportional Scale changes are limited to a single 1–100% adjustment on selected layers; every selected Scale property must be static, unlocked, and a supported 2D/3D vector before any write begins.
- Existing host edit handlers retain their undo groups and read-back verification.
- Cinematic versus bold neon Glow intent is classified for explanation, but all Glow mutations are blocked during the host crash investigation and excluded from the executable planner allowlist.
- The 32-recipe catalog is descriptive only. Each recipe remains `PROPOSED`; it does not execute or claim a visual result.
- This is a first integrated vertical slice, not yet a context-aware creative editor. CORE reasoning, composition-aware effect parameter selection, and visual outcome analysis remain future work.

## Tests

Run from the repository's `sublime-core` directory:

```powershell
node --test obsidian/backend/core/planner.test.mjs
node --test obsidian/backend/host/host.test.cjs
```
