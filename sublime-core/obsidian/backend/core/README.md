# OBSIDIAN command planning (v1)

`planner.mjs` is a side-effect-free first step toward contextual editing. It maps a small set of explicit requests to typed proposals and returns clarification/unsupported states instead of guessing.

## Current boundaries

- No project edits happen in this module.
- Only a fixed allowlist of existing host actions is considered executable.
- “Cinematic” and “attention” Glow are intent labels only. The current host applies basic Glow and does not yet tune effect parameters by profile.
- This is not CORE/Qwen integration. It is a deterministic baseline for testing the plan/execute boundary before connecting the model.
- Do not bypass host-side validation or verification when executing a plan.

## Test

`node --test sublime-core/obsidian/backend/core/planner.test.mjs`
