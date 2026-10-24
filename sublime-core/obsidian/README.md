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
- **Commands:** inspect project/layers, set or reduce opacity, and request a guarded fade-in. Glow requests are classified but blocked.
- **Creative recipes:** 30 descriptive recipes across film, neon/cyberpunk, horror, energetic/anime, dreamy/nostalgic, typography, transitions, and motion design.

Examples to try in the panel:
- `What is easing?` — returns a short knowledge answer; does not edit the composition.
- `How do I make this title pop?` — returns design guidance; does not edit the composition.
- `Add a subtle cinematic glow` — identifies restrained cinematic intent, then reports that Glow is blocked; no edit is sent to After Effects.
- `Add a bold neon bloom` — identifies bold neon intent, then reports that Glow is blocked; no edit is sent to After Effects.
- `Set opacity to 45%` — requests the guarded opacity action.

Conflicting Glow styles prompt a question. Unsupported requests are not executed. Knowledge answers are local and deterministic, so this is a small knowledge-backed model rather than a general conversational AI.

**Boundary:** CORE/Qwen is not connected to this planner yet. It does not understand arbitrary requests, see rendered pixels, learn a user's style, or research trends. Its knowledge can be expanded without adding dependencies or starting another model/server.

## Current host capabilities

- Read-only inspection of the active composition and selected layers.
- Composition dimensions, frame rate, duration, playhead time, layer count and selection count.
- Selected-layer type, enabled/3D/locked/shy state, in/out points, opacity, transform values and effect names.
- Text content, font name and font size where the host exposes them.
- Glow add/remove handlers are blocked during the RenderTaskManager crash investigation. Glow actions are excluded from the planner's executable allowlist.
- Opacity set/reduce actions have property read-back checks and refuse to overwrite existing opacity keyframes or enabled expressions.
- A guarded 0.5-second opacity fade-in for selected layers. It checks locked layers, short durations, and existing opacity keyframes/expressions before editing, then reads keyframes back to verify the result.
- Protection against directly changing opacity where keyframes or an enabled expression already exists.

## Creative recipe boundary

The local recipe catalog describes intent, natural-language cues, qualitative parameters, prerequisites, ordered readiness-labeled steps, compatibility, and safe fallbacks. Each recipe is `PROPOSED`; recipe planning never runs a host edit. `IMPLEMENTED` marks an existing supported host capability, `BLOCKED` marks a disabled or unsafe operation, and `REQUIRES_INPUT` marks a decision the editor must provide. Color grading, generated atmosphere, grain, transitions, and other motion-design effects remain proposals until OBSIDIAN has tested host support and read-back verification for them.

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
