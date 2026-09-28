import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../reasoning/types.js";

const WORKSPACE = path.resolve("workspace");
const MAX_FILES_IN_RESPONSE = 20;

async function walk(
  directory: string,
  root: string,
  results: string[],
  directories: Set<string>,
): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      const relativeDirectory = path.relative(root, fullPath);
      directories.add(relativeDirectory || ".");
      await walk(fullPath, root, results, directories);
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
    "Inspect the current Sublime Core workspace at a high level. Returns the total file count, directories, and a bounded sample of file metadata. It does not read file contents. Use read_file or list_files when you need exact artifact contents or a specific directory.",
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
    const directories = new Set<string>();
    await walk(WORKSPACE, WORKSPACE, files, directories);

    if (files.length === 0) {
      return "Workspace exists but is empty.";
    }

    files.sort();

    return JSON.stringify({
      workspace: WORKSPACE,
      fileCount: files.length,
      directoryCount: directories.size,
      directories: [...directories].sort(),
      files: files.slice(0, MAX_FILES_IN_RESPONSE),
      filesShown: Math.min(files.length, MAX_FILES_IN_RESPONSE),
      truncated: files.length > MAX_FILES_IN_RESPONSE,
      note:
        files.length > MAX_FILES_IN_RESPONSE
          ? "File metadata is truncated. Use list_files for a specific directory when exact contents are needed."
          : "All file metadata is shown.",
    });
  },
};
