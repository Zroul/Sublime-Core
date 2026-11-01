# LINEX — local coding agent (v1)

LINEX is a restricted coding agent for the OBSIDIAN project. It reuses CORE's existing local Ollama model and the shared ReAct tool loop; it does not install or host another LLM.

## Run locally

From the `sublime-core` directory:

```powershell
npm install
npm run linex -- "Inspect the OBSIDIAN project and report the most important next improvement. Do not edit files."
```

For a bounded code task:

```powershell
npm run linex -- "Inspect the relevant files, fix one specific bug, then re-read every changed file and report test status."
```

Run LINEX's own path-safety and nested-file-creation tests:

```powershell
npm run linex:test
```

See [LEARNING_GUIDE.md](./LEARNING_GUIDE.md) for the intern's explanations of LLMs, HTTP APIs, tool calling, ReAct, RAG, testing, and Git.

## Tools and boundaries

- Lists and reads files under `obsidian/` only.
- Creates new files and edits existing text files under `obsidian/` only.
- Rejects absolute paths, parent traversal, protected directories, and symlink escapes.
- Saves a copy of an existing file to the operating system's temporary directory before replacing it.
- Has no arbitrary shell command, package installation, Git commit/push/merge, or delete tool.
- A completion gate requires every changed file to be read again and compares the read-back text with the exact content LINEX intended to write before it can call `task_done`.
- Each run is limited to 8 model turns.

## Testing honesty

The repository does not currently contain the OBSIDIAN host test file referenced by the original prototype. LINEX therefore does not advertise or invoke that nonexistent test command. `npm run linex:test` tests LINEX's own path handling and completion gate; it is not a substitute for an OBSIDIAN application test suite.

When changing OBSIDIAN code, LINEX must run relevant tests only if a real test suite is present and available. Otherwise it must re-read the changed files and clearly report that application tests were not run.

## Current limitations

This is a first local prototype, not an unattended worker. It has no RAG index, web research, direct GitHub access, persistent job queue, resume support, scheduling, or automatic commits. Add capabilities only after the local read/edit/verify loop is tested.
