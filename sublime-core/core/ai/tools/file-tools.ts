import { promises as fs } from "fs";
import path from "path";
import type { Tool } from "../reasoning/types.js";

const WORKSPACE = path.resolve("workspace");

function safePath(filePath: string): string {
  const fullPath = path.resolve(WORKSPACE, filePath);

  if (
    fullPath !== WORKSPACE &&
    !fullPath.startsWith(WORKSPACE + path.sep)
  ) {
    throw new Error("File path is outside the Sublime Core workspace.");
  }

  return fullPath;
}

export const createFileTool: Tool = {
  name: "create_file",
  description: "Create a file inside the Sublime Core workspace.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path of the file.",
      },
      content: {
        type: "string",
        description: "Content of the file.",
      },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },

  async handler(args) {
    const filePath = String(args.path);
    const content = String(args.content);
    const fullPath = safePath(filePath);

    await fs.mkdir(path.dirname(fullPath), {
      recursive: true,
    });

    try {
      await fs.writeFile(fullPath, content, "utf8");
    } catch (error) {
      return {
        toolCallId: "",
        content: `Failed to create ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }

    return `Created ${filePath} successfully.`;
  },
};

export const readFileTool: Tool = {
  name: "read_file",
  description: "Read a file inside the Sublime Core workspace.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path of the file.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },

  async handler(args) {
    const filePath = String(args.path);
    const fullPath = safePath(filePath);

    try {
      return await fs.readFile(fullPath, "utf8");
    } catch (error) {
      return {
        toolCallId: "",
        content: `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  },
};

export const editFileTool: Tool = {
  name: "edit_file",
  description:
    "Replace the contents of an existing file inside the Sublime Core workspace.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path of the file to edit.",
      },
      content: {
        type: "string",
        description: "The new complete content for the file.",
      },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },

  async handler(args) {
    const filePath = String(args.path);
    const content = String(args.content);
    const fullPath = safePath(filePath);

    try {
      await fs.access(fullPath);
    } catch {
      return {
        toolCallId: "",
        content: `File not found: ${filePath}`,
        isError: true,
      };
    }

    try {
      await fs.writeFile(fullPath, content, "utf8");
    } catch (error) {
      return {
        toolCallId: "",
        content: `Failed to edit ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }

    return `Edited ${filePath} successfully.`;
  },
};

export const listFilesTool: Tool = {
  name: "list_files",
  description: "List all files inside the Sublime Core workspace.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },

  async handler() {
    async function walk(directory: string): Promise<string[]> {
      const entries = await fs.readdir(directory, {
        withFileTypes: true,
      });

      const results: string[] = [];

      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          results.push(...(await walk(fullPath)));
        } else {
          results.push(path.relative(WORKSPACE, fullPath));
        }
      }

      return results;
    }

    try {
      const files = await walk(WORKSPACE);

      if (files.length === 0) {
        return "Workspace is empty.";
      }

      return files.join("\n");
    } catch (error) {
      return {
        toolCallId: "",
        content: `Failed to list workspace files: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  },
};