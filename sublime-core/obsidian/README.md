# OBSIDIAN

OBSIDIAN is the After Effects motion-design assistant in Sublime Core.

## Layout

- `frontend/` — CEP panel UI, styles, browser-side interaction, and UI assets.
- `backend/host/` — ExtendScript host bridge loaded by After Effects, including project/layer inspection and guarded Glow/Opacity actions.
- `backend/core/` — reserved for OBSIDIAN-specific orchestration and command planning.
- `backend/inspection/` — reserved for extracting inspection logic from the host bridge when the interface is stable.
- `backend/verification/` — reserved for richer post-edit verification.
- `backend/knowledge/` — reserved for searchable motion-design knowledge and reference metadata.
- `CSXS/manifest.xml` — Adobe CEP extension manifest; it must remain at the extension root.

## Current implemented capabilities

- Read-only inspection of the active composition and selected layers.
- Composition dimensions, frame rate, duration, playhead time, layer count and selection count.
- Selected-layer type, enabled/3D/locked/shy state, in/out points, opacity, transform values and effect names.
- Text content, font name and font size where the host exposes them.
- Glow add/remove and opacity set/reduce actions, with property read-back checks after edits.
- A guarded 0.5-second opacity fade-in for selected layers. It checks locked layers, short durations, and existing opacity keyframes/expressions before editing, then reads keyframes back to verify the result.
- Explicit rejection of commands that do not map to a supported action.

## Not implemented yet

- CORE/Qwen natural-language planning or tool calling.
- General-purpose motion-design editing, keyframe generation or complex multi-step edits.
- Visual render assessment, style learning, or current-trend research.
- A full in-After-Effects runtime test. The Node tests use a mock host and verify command logic; they do not prove CEP/ExtendScript compatibility.

## Run the host logic tests

From the repository root, run:

```sh
node --test sublime-core/obsidian/backend/host/host.test.cjs
```

The test harness uses Node's built-in test runner and a mocked After Effects host, so it needs no added dependencies.

## Manual After Effects smoke test

1. Confirm the CEP extension loads and its UI assets appear.
2. Open a project and composition; run `inspect project`.
3. Select a text layer and run `inspect selected layers`.
4. Set opacity to 50% and confirm the Timeline value.
5. Add Glow, inspect selected layers, remove Glow, and inspect again.
6. Select a layer with no existing opacity keyframes or expression and run `fade in`; verify two opacity keyframes appear over up to 0.5 seconds.
7. Try `fade in` on a layer with existing opacity animation; it should refuse instead of overwriting those keyframes.
8. Try an unsupported request and confirm OBSIDIAN returns an error without claiming it edited the project.

## Shared runtime boundary

The existing shared `../core` runtime contains code used by other Sublime Core features, including NOVA. Do not move it into this folder blindly. OBSIDIAN-specific orchestration should integrate through explicit, tested interfaces so unrelated tools remain intact.
