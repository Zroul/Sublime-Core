import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../reasoning/types.js";

const WORKSPACE = path.resolve("workspace");
const MEMORY_PATH = path.join(WORKSPACE, "nova", "NOVA_MEMORY.md");

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export const novaMemoryTool: Tool = {
  name: "nova_memory",
  description:
    "Read or append durable project memory for NOVA. Store only useful project facts, decisions, constraints, and verified lessons. Never store secrets, credentials, or transient chatter.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["read", "append"],
        description: "Read the current memory or append a durable memory entry.",
      },
      entry: {
        type: "string",
        description: "Durable project fact, decision, constraint, or verified lesson.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },

  async handler(input) {
    const action = String(input.action ?? "read");
    await fs.mkdir(path.dirname(MEMORY_PATH), { recursive: true });

    if (action === "read") {
      try {
        const content = await fs.readFile(MEMORY_PATH, "utf8");
        return content || "# NOVA Memory\n";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return "# NOVA Memory\n\nNo durable memory recorded yet.\n";
        }
        throw error;
      }
    }

    if (action !== "append") {
      return {
        toolCallId: "",
        content: "nova_memory action must be read or append.",
        isError: true,
      };
    }

    const entry = normalize(String(input.entry ?? ""));
    if (!entry) {
      return {
        toolCallId: "",
        content: "nova_memory append requires a non-empty entry.",
        isError: true,
      };
    }

    if (/(?:api[_ -]?key|secret|password|token|private[_ -]?key)/i.test(entry)) {
      return {
        toolCallId: "",
        content: "Refused to store a credential or secret in NOVA memory.",
        isError: true,
      };
    }

    let existing = "";
    try {
      existing = await fs.readFile(MEMORY_PATH, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (!existing) existing = "# NOVA Memory\n";

    const timestamp = new Date().toISOString();
    const section = "\n- [" + timestamp + "] " + entry + "\n";
    await fs.writeFile(MEMORY_PATH, existing.trimEnd() + section, "utf8");

    return JSON.stringify({ saved: true, path: "nova/NOVA_MEMORY.md", entry });
  },
};
