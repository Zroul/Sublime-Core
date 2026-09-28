import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../reasoning/types.js";

const WORKSPACE = path.resolve("workspace");

async function walk(directory: string, root: string, results: string[]): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await walk(fullPath, root, results);
      continue;
    }

    const relative = path.relative(root, fullPath);
    const stat = await fs.stat(fullPath);
    results.push(
      `${relative} | ${stat.size} bytes | ${stat.mtime.toISOString()}`,
    );
  }
}

export const workspaceStatusTool: Tool = {
  name: "workspace_status",
  description:
    "Inspect the current Sublime Core workspace at a high level. Returns file paths, sizes, and modification times without reading file contents. Use this before planning edits when you need to understand what artifacts already exist.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },

  async handler() {
    try {
      await fs.access(WORKSPACE);
    } catch {
      return "Workspace does not exist yet.";
    }

    const files: string[] = [];
    await walk(WORKSPACE, WORKSPACE, files);

    if (files.length === 0) {
      return "Workspace exists but is empty.";
    }

    files.sort();

    return JSON.stringify({
      workspace: WORKSPACE,
      fileCount: files.length,
      files,
    });
  },
};
