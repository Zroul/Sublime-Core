import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentRunResult, Message, Turn } from "../ai/reasoning/types.js";
import { resolveWorkspacePath } from "../ai/tools/workspace-path.js";

const STATE_DIR = path.join("nova", "runs");

export interface NovaRunState {
  runId: string;
  task: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  updatedAt: string;
  turn: number;
  stopped?: string;
  finalSummary?: string;
  messages: Message[];
}

async function filePath(runId: string): Promise<string> {
  const safe = runId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return resolveWorkspacePath(path.join(STATE_DIR, safe + ".json"));
}

export async function saveNovaRunState(state: NovaRunState): Promise<void> {
  const directory = await resolveWorkspacePath(STATE_DIR);
  await fs.mkdir(directory, { recursive: true });
  const safeRunId = state.runId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const target = await filePath(state.runId);
  const temp = await resolveWorkspacePath(path.join(STATE_DIR, safeRunId + ".json.tmp"));
  await fs.writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temp, target);
}

export async function loadNovaRunState(runId: string): Promise<NovaRunState | undefined> {
  try {
    return JSON.parse(await fs.readFile(await filePath(runId), "utf8")) as NovaRunState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function listNovaRunStates(): Promise<NovaRunState[]> {
  try {
    const directory = await resolveWorkspacePath(STATE_DIR);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const states: NovaRunState[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) continue;
      try {
        const target = await resolveWorkspacePath(path.join(STATE_DIR, entry.name));
        states.push(JSON.parse(await fs.readFile(target, "utf8")) as NovaRunState);
      } catch {
        // Ignore one damaged checkpoint; other runs remain recoverable.
      }
    }
    return states.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function createRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function stateFromTurn(
  runId: string,
  task: string,
  startedAt: string,
  turn: Turn,
  messages: Message[],
  status: NovaRunState["status"] = "running",
): NovaRunState {
  return {
    runId,
    task,
    status,
    startedAt,
    updatedAt: new Date().toISOString(),
    turn: turn.index,
    messages,
  };
}

export function finalizeRunState(
  state: NovaRunState,
  result: AgentRunResult,
): NovaRunState {
  const completed = result.stopped === "task_done" || result.successfulStop === true;

  return {
    ...state,
    status: completed ? "completed" : "failed",
    updatedAt: new Date().toISOString(),
    turn: result.turns,
    stopped: result.stopped,
    finalSummary: result.finalSummary,
    messages: result.messages,
  };
}
