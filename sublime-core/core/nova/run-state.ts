import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentRunResult, Message, Turn } from "../ai/reasoning/types.js";

const WORKSPACE = path.resolve("workspace");
const STATE_DIR = path.join(WORKSPACE, "nova", "runs");

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

function filePath(runId: string): string {
  const safe = runId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(STATE_DIR, safe + ".json");
}

export async function saveNovaRunState(state: NovaRunState): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  const target = filePath(state.runId);
  const temp = target + ".tmp";
  await fs.writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temp, target);
}

export async function loadNovaRunState(runId: string): Promise<NovaRunState | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath(runId), "utf8")) as NovaRunState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function listNovaRunStates(): Promise<NovaRunState[]> {
  try {
    const entries = await fs.readdir(STATE_DIR, { withFileTypes: true });
    const states: NovaRunState[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        states.push(JSON.parse(await fs.readFile(path.join(STATE_DIR, entry.name), "utf8")) as NovaRunState);
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
  return {
    ...state,
    status: result.stopped === "task_done" ? "completed" : "failed",
    updatedAt: new Date().toISOString(),
    turn: result.turns,
    stopped: result.stopped,
    finalSummary: result.finalSummary,
    messages: result.messages,
  };
}
