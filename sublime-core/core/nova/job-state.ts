import { promises as fs } from "node:fs";
import path from "node:path";

export interface NovaControlState {
  stopRequested: boolean;
  updatedAt: string;
}

export async function readControlState(directory: string): Promise<NovaControlState> {
  try {
    const raw = await fs.readFile(path.join(directory, "control.json"), "utf8");
    return JSON.parse(raw) as NovaControlState;
  } catch {
    return { stopRequested: false, updatedAt: new Date().toISOString() };
  }
}

export async function requestStop(directory: string): Promise<void> {
  const state: NovaControlState = {
    stopRequested: true,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(
    path.join(directory, "control.json"),
    JSON.stringify(state, null, 2),
    "utf8",
  );
}

export async function clearStopRequest(directory: string): Promise<void> {
  const state: NovaControlState = {
    stopRequested: false,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(
    path.join(directory, "control.json"),
    JSON.stringify(state, null, 2),
    "utf8",
  );
}
