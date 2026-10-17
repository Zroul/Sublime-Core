# LINEX — local coding agent (v1)

LINEX is a tool runtime for the existing local CORE model. It does not include or install another model.

## What v1 does

- Uses the existing `OllamaProvider` and `runReActLoop` from CORE's AI infrastructure.
- Limits file tools to the `obsidian/` project directory under the current working directory.
- Lists and reads project files, creates new files, and edits existing files.
- Saves pre-edit copies to the operating system's temporary directory before replacing an existing file.
- Runs only the fixed OBSIDIAN host test command: `node --test obsidian/backend/host/host.test.cjs`.
- Limits each task to a small number of model turns and logs tool observations to the terminal.

## Run locally

From the `sublime-core` repository directory:

```powershell
npm run linex -- "Inspect the OBSIDIAN host tests and report the most important next improvement. Do not edit files."
```

For a task that changes code, state the requested scope clearly. LINEX cannot run arbitrary shell commands, install packages, modify files outside OBSIDIAN, or push to GitHub.

## Current limitations

This is a first local prototype, not an unrestricted overnight worker. The fixed test path must exist locally. Internet research, direct GitHub writes, persistent task queues, and unattended scheduling are intentionally not enabled in v1. Add these only after the local read/edit/test loop is verified.

## Safety model

- Project root is resolved at startup and must be an existing directory.
- Paths must be relative and remain inside OBSIDIAN, including through symlinks.
- Secret/config files, dependency folders, Git metadata, and LINEX backup folders are blocked.
- Existing files are copied to a timestamped backup before edits.
- No automatic commit, push, merge, or delete operation is provided.
