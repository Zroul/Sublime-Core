# OBSIDIAN Backend

This folder contains OBSIDIAN-specific host integration and future backend modules.

- `host/host.jsx` — ExtendScript code loaded inside After Effects by CEP.
- `core/` — planned OBSIDIAN orchestration; create modules here only when implemented.
- `inspection/` — planned project and layer inspection.
- `verification/` — planned state/result verification.
- `knowledge/` — planned searchable design knowledge, typography guidance, and animation recipes.

The shared Sublime Core runtime remains under `../core` because other features depend on it. Reuse shared code through explicit interfaces rather than duplicating or relocating it in this structural change.
