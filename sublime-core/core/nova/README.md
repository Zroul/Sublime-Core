# NOVA

NOVA is the private local content-production layer built on top of Sublime Core.

## Current architecture

```text
Topic
  ↓
Trend Scout
  ↓
Research
  ↓
Rank
  ↓
Script
  ↓
Voice
  ↓
Visuals
  ↓
Video Build
  ↓
Captions
  ↓
Quality Check
  ↓
Ready to Review
```

The intelligence layer is local through Ollama. No cloud model is required by NOVA.

Each stage writes a JSON checkpoint inside `workspace/nova/<job-id>/`, so a run leaves an inspectable trail instead of being a single opaque request.

## Local brain

Default model: `qwen3:8b`

Optional environment variables:

- `NOVA_OLLAMA_URL` for the local Ollama address
- `NOVA_OLLAMA_MODEL` for an installed local model

## Test

From the repository root:

```text
npm.cmd run nova:test
```

Or pass a topic:

```text
npm.cmd run nova:test -- "3 underrated free tools for students"
```

NOVA checks that Ollama is reachable and that the configured model exists before starting a job.
