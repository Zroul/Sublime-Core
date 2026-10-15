# OBSIDIAN

OBSIDIAN is the After Effects motion-design assistant in Sublime Core.

## Layout

- `frontend/` — CEP panel UI, styles, browser-side interaction, and UI assets.
- `backend/host/` — ExtendScript host bridge loaded by After Effects.
- `backend/core/` — OBSIDIAN-specific orchestration and command planning (add only when implemented).
- `backend/inspection/` — project/layer inspection tools (add only when implemented).
- `backend/verification/` — post-edit verification (add only when implemented).
- `backend/knowledge/` — searchable design knowledge and reference metadata (add only when implemented).
- `CSXS/manifest.xml` — Adobe CEP extension manifest; it must remain at the extension root.

## Important architecture boundary

The existing shared `../core` runtime contains code used by other Sublime Core features, including NOVA. Do not blindly move that shared runtime into this folder: doing so would break existing imports and couple unrelated products. OBSIDIAN-specific code belongs here; shared modules should be imported through explicit, tested interfaces.

## Current capability status

The CEP panel currently sends text commands to the ExtendScript host. The host supports a small allowlist of Glow and Opacity operations. It does not yet connect the prompt to the local CORE model, provide comprehensive project inspection, or verify visual quality. Those are future milestones, not existing capabilities.

## Smoke-test checklist

1. Confirm the CEP extension loads in After Effects.
2. Confirm the panel UI and CSS/JS assets load.
3. Select a layer in an open composition and test adding Glow.
4. Test setting opacity to a numeric percentage.
5. Confirm invalid commands return an error without modifying the project.
6. Confirm the moved JSX host loads and its command bridge remains callable.
