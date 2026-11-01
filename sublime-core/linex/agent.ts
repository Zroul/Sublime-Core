import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Tool } from "../core/ai/reasoning/types.js";

const BLOCKED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  ".env",
  ".linex-backups",
  "secrets",
  "credentials",
]);
const MAX_READ_BYTES = 160_000;
const MAX_WRITE_BYTES = 300_000;

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isBlockedSegment(part: string): boolean {
  const name = part.toLowerCase();
  return BLOCKED_SEGMENTS.has(name) || /^\.env(?:$|\.)/.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name) || /^(?:id_rsa|id_ed25519|credentials(?:\..*)?|secrets(?:\..*)?)$/.test(name) || name === ".npmrc";
}

function validateRelativePath(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("A non-empty relative project path is required.");
  }
  const normalizedInput = input.replace(/\\/g, "/");
  if (
    path.isAbsolute(input) ||
    normalizedInput.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalizedInput) ||
    normalizedInput.split("/").some((part) => part === ".." || isBlockedSegment(part))
  ) {
    throw new Error("Path rejected: use a relative path inside OBSIDIAN and avoid protected locations.");
  }
  return normalizedInput;
}

export async function resolveObsidianPath(root: string, input: unknown, allowMissing = false): Promise<string> {
  const relative = validateRelativePath(input);
  const realRoot = await fs.realpath(root);
  const candidate = path.resolve(realRoot, relative);
  if (!isInside(realRoot, candidate) || candidate === realRoot) {
    throw new Error("Path rejected: operation must stay inside the OBSIDIAN project.");
  }

  try {
    const realCandidate = await fs.realpath(candidate);
    if (!isInside(realRoot, realCandidate) || realCandidate === realRoot) {
      throw new Error("Path rejected: symlinks may not escape the OBSIDIAN project.");
    }
    return realCandidate;
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;

    // A new file may be several directories deep. Walk upward to the nearest
    // existing ancestor and verify its real path before allowing creation.
    let ancestor = path.dirname(candidate);
    while (true) {
      try {
        const realAncestor = await fs.realpath(ancestor);
        if (!isInside(realRoot, realAncestor)) {
          throw new Error("Path rejected: parent directory escapes OBSIDIAN.");
        }
        break;
      } catch (ancestorError) {
        if ((ancestorError as NodeJS.ErrnoException).code !== "ENOENT") throw ancestorError;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) {
          throw new Error("Path rejected: no existing parent inside OBSIDIAN was found.");
        }
        ancestor = parent;
      }
    }
    return candidate;
  }
}

export function createLinexTools(projectRoot: string): Tool[] {
  const root = path.resolve(projectRoot);
  const listFiles: Tool = {
    name: "obsidian_list_files",
    description: "List relative file paths in the OBSIDIAN project. Use this before guessing paths.",
    parameters: {
      type: "object",
      properties: { subdirectory: { type: "string", description: "Optional relative directory; use '.' for the project root." } },
      required: ["subdirectory"],
      additionalProperties: false,
    },
    async handler(args) {
      try {
        const input = args.subdirectory === "." ? "README.md" : args.subdirectory;
        let directory: string;
        if (args.subdirectory === ".") directory = root;
        else directory = await resolveObsidianPath(root, input);
        const stat = await fs.stat(directory);
        if (!stat.isDirectory()) return { toolCallId: "", content: "Requested path is not a directory.", isError: true };
        const found: string[] = [];
        async function walk(current: string, depth: number): Promise<void> {
          if (depth > 8 || found.length >= 500) return;
          const entries = await fs.readdir(current, { withFileTypes: true });
          for (const entry of entries) {
            if (isBlockedSegment(entry.name)) continue;
            const full = path.join(current, entry.name);
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) await walk(full, depth + 1);
            else found.push(path.relative(root, full).split(path.sep).join("/"));
            if (found.length >= 500) break;
          }
        }
        await walk(directory, 0);
        return found.length ? found.join("\n") : "No project files found in that directory.";
      } catch (error) {
        return { toolCallId: "", content: error instanceof Error ? error.message : String(error), isError: true };
      }
    },
  };

  const readFile: Tool = {
    name: "obsidian_read_file",
    description: "Read a UTF-8 text file inside OBSIDIAN. Do not use this for binary media.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative path inside OBSIDIAN." } },
      required: ["path"],
      additionalProperties: false,
    },
    async handler(args) {
      try {
        const target = await resolveObsidianPath(root, args.path);
        const stat = await fs.stat(target);
        if (!stat.isFile() || stat.size > MAX_READ_BYTES) throw new Error("File is not a regular text file or exceeds the 160 KB read limit.");
        const content = await fs.readFile(target, "utf8");
        if (content.includes("\u0000")) throw new Error("Binary files are not supported.");
        return content;
      } catch (error) {
        return { toolCallId: "", content: error instanceof Error ? error.message : String(error), isError: true };
      }
    },
  };

  const createFile: Tool = {
    name: "obsidian_create_file",
    description: "Create a new text file inside OBSIDIAN. Fails if the target already exists.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "New relative file path inside OBSIDIAN." },
        content: { type: "string", description: "Complete UTF-8 file contents." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    async handler(args) {
      try {
        const content = String(args.content ?? "");
        if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) throw new Error("File content exceeds the 300 KB limit.");
        const target = await resolveObsidianPath(root, args.path, true);
        await fs.mkdir(path.dirname(target), { recursive: true });
        const realRoot = await fs.realpath(root);
        const parent = await fs.realpath(path.dirname(target));
        if (!isInside(realRoot, parent)) throw new Error("Parent directory escapes OBSIDIAN.");
        await fs.writeFile(target, content, { encoding: "utf8", flag: "wx" });
        return `Created ${path.relative(realRoot, target)}.`;
      } catch (error) {
        return { toolCallId: "", content: error instanceof Error ? error.message : String(error), isError: true };
      }
    },
  };

  const editFile: Tool = {
    name: "obsidian_edit_file",
    description: "Replace an existing UTF-8 text file inside OBSIDIAN. A backup is saved before editing.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Existing relative file path inside OBSIDIAN." },
        content: { type: "string", description: "Complete replacement file contents." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    async handler(args) {
      try {
        const content = String(args.content ?? "");
        if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) throw new Error("File content exceeds the 300 KB limit.");
        const target = await resolveObsidianPath(root, args.path);
        const stat = await fs.stat(target);
        if (!stat.isFile() || stat.size > MAX_WRITE_BYTES) throw new Error("Only regular files up to 300 KB can be edited.");
        const oldContent = await fs.readFile(target);
        if (oldContent.includes(0)) throw new Error("Binary files are not supported.");
        const backupRoot = path.join(os.tmpdir(), "linex-backups", Date.now().toString());
        const backup = path.join(backupRoot, path.relative(root, target));
        await fs.mkdir(path.dirname(backup), { recursive: true });
        await fs.writeFile(backup, oldContent);
        await fs.writeFile(target, content, "utf8");
        return JSON.stringify({ edited: path.relative(root, target), backup });
      } catch (error) {
        return { toolCallId: "", content: error instanceof Error ? error.message : String(error), isError: true };
      }
    },
  };

  return [listFiles, readFile, createFile, editFile];
}
