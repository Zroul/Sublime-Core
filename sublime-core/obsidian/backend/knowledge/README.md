# OBSIDIAN Design Knowledge

## Current source of truth

The current lightweight knowledge library lives in `../../frontend/knowledge.js` because the CEP panel must load it directly without a build step. It is a curated rule-based library, **not an LLM**, and it cannot inspect pixels or infer what a composition looks like.

The library contains:

- **Concepts** — stable IDs, names, language cues, optional supported-action metadata, and guidance notes.
- **Answers** — stable IDs, whole-word/phrase cues, and concise educational explanations.
- **Guardrails** — constraints the planner and host must preserve.

## Adding an entry

1. Add a unique `id` and a concise, accurate explanation.
2. Add specific cues that a user is likely to type. Avoid overly broad cues such as `soft` or `pop` when they may create ambiguous matches.
3. Add a regression test in `../core/knowledge.test.mjs` for the question and expected answer.
4. Run `npm run obsidian:test` from the `sublime-core` directory, or let the OBSIDIAN GitHub Actions workflow run.
5. Do not turn an educational answer into an executable plan. Executable edits must remain on the explicit planner allowlist and be supported by the host.

## Safety and scope

- Do not claim visual analysis without an actual image-analysis pipeline.
- Do not claim a style preset is calibrated unless the host applies and verifies those settings.
- Existing opacity keyframes and enabled expressions must not be overwritten.
- Glow mutations remain disabled while the After Effects crash investigation is unresolved.
- Keep sourced/reference-heavy future material in this backend knowledge area; keep the current CEP-compatible runtime data simple and dependency-free.

This directory is reserved for a future searchable reference corpus, provenance metadata, and richer retrieval. It is not yet wired into runtime retrieval.
