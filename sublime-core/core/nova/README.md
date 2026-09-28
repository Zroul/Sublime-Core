# NOVA

NOVA is the orchestration layer of Sublime Core.

## Architecture

User -> NOVA -> CORE -> tools -> observations -> NOVA -> verified result

- **CORE**: local Qwen3 8B brain running through Ollama.
- **NOVA**: coordinator that plans, acts, observes, verifies, and stops.
- **Tools**: web search, source fetching, workspace files, and bounded development commands.
- **Workspace**: persistent local artifacts and run logs.

## Local-only model

NOVA uses the local Ollama model named `core`.

No hosted LLM API is used by the NOVA runtime.

## Current controls

Each run is bounded by:

- 18 reasoning turns
- 6 web searches
- 8 source fetches
- 4 development commands
- 20 file writes
- 2 identical attempts at the same tool call

NOVA must use new evidence after a failed action instead of blindly repeating it.

## Run

From the `sublime-core` directory:

```powershell
npm run nova
```

Or give a task directly:

```powershell
npm run nova -- "Research the current state of a topic and save a concise report to the workspace."
```

The run log is stored in:

```text
workspace/nova/NOVA_RUN_LOG.md
```

## Current scope

This is the first real NOVA orchestration layer.

It is intentionally not an autonomous publishing system yet. Research, verification, controlled workspace work, and development tasks come first. Video production, scheduling, publishing, and larger automation should be added as separate bounded modules later.
