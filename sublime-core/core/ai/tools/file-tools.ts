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
  },

  async handler(args) {
    const filePath = String(args.path);
    const content = String(args.content);
    const fullPath = safePath(filePath);

    await fs.mkdir(path.dirname(fullPath), {
      recursive: true,
    });

    await fs.writeFile(fullPath, content, "utf8");

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
  },

  async handler(args) {
    const filePath = String(args.path);
    const fullPath = safePath(filePath);

    try {
      return await fs.readFile(fullPath, "utf8");
    } catch {
      return `File not found: ${filePath}`;
    }
  },
};