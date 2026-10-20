# OBSIDIAN

OBSIDIAN is the After Effects motion-design assistant in Sublime Core. It currently runs as a lightweight CEP panel with a deterministic planner, a small local motion-design knowledge base, and a guarded ExtendScript host bridge.

## Layout

- `frontend/` — CEP panel UI, local knowledge, command planner, and browser-side interaction.
- `backend/host/` — ExtendScript host bridge loaded by After Effects, including project/layer inspection and guarded Glow/Opacity actions.
- `backend/core/` — Node-testable facade for the shared browser planner.
- `CSXS/manifest.xml` — Adobe CEP extension manifest; it must remain at the extension root.

## Working command model

The current small knowledge brain is explicit JavaScript data in `frontend/knowledge.js`, consumed by `frontend/planner.shared.js`. It recognizes common motion-design intent such as:

- **Cinematic Glow:** subtle, soft, restrained, atmospheric, dreamy, bloom, filmic.
- **Attention Glow:** bold, strong, punchy, dramatic, neon, pop, stand out.
- **Fade-in:** fade up, appear gradually, reveal gradually, gentle entrance.
- **Readability:** recognizes readability requests and asks before claiming it can judge pixels.

The planner maps requests to a narrow allowlist: inspect project, inspect selected layers, set/reduce opacity, add/remove Glow, and fade-in. Conflicting Glow styles prompt a question. Unsupported requests are not executed.

**Boundary:** this is a small knowledge-backed rule planner, not yet the CORE/Qwen language model. It does not understand arbitrary requests, see the rendered composition, learn a user's style, or research trends. Its knowledge can be expanded without adding dependencies or starting another model/server.

## Current host capabilities

- Read-only inspection of the active composition and selected layers.
- Composition dimensions, frame rate, duration, playhead time, layer count and selection count.
- Selected-layer type, enabled/3D/locked/shy state, in/out points, opacity, transform values and effect names.
- Text content, font name and font size where the host exposes them.
- Glow add/remove and opacity set/reduce actions, with property read-back checks after edits.
- Cinematic and attention Glow profiles with parameter read-back verification.
- A guarded 0.5-second opacity fade-in for selected layers. It checks locked layers, short durations, and existing opacity keyframes/expressions before editing, then reads keyframes back to verify the result.
- Protection against directly changing opacity where keyframes or an enabled expression already exists.

## Next model stage

The intended next stage is to connect the existing local CORE model to OBSIDIAN for broader language understanding, while keeping the planner/host allowlist as the safety boundary. CORE may propose a plan; it must not directly execute arbitrary scripts. OBSIDIAN must validate the proposed action, execute through the host bridge, and report the host's actual result. No new model or dependency is required for the intended architecture.

## After Effects validation

The Node tests use a mocked host and do not prove CEP/ExtendScript compatibility or rule out After Effects undo crashes. Validate the actual extension inside After Effects before treating host behavior as production-safe.

From the repository root, the combined command is:

```sh
npm run obsidian:test
```

The test runner is Node's built-in test runner; it adds no dependencies.

## Shared runtime boundary

The existing shared `../core` runtime contains code used by other Sublime Core features, including NOVA. Keep that runtime intact and integrate OBSIDIAN through explicit interfaces so unrelated tools remain unaffected.
