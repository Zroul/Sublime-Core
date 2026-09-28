import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../reasoning/types.js";

const WORKSPACE = path.resolve("workspace");
const DOSSIER_DIR = path.join(WORKSPACE, "nova", "research");

function safeName(value: string): string {
  const name = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return name.slice(0, 80) || "research";
}

export const researchDossierTool: Tool = {
  name: "research_dossier",
  description:
    "Create or read a durable research dossier inside the workspace. Store the research question, sourced findings, source URLs, uncertainty, and next actions. This is a research artifact, not a claim of truth.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["read", "write"] },
      name: { type: "string", description: "Short dossier name." },
      content: { type: "string", description: "Research dossier content in Markdown." },
    },
    required: ["action", "name"],
    additionalProperties: false,
  },
  async handler(input) {
    const action = String(input.action ?? "read");
    const name = safeName(String(input.name ?? ""));
    await fs.mkdir(DOSSIER_DIR, { recursive: true });
    const file = path.join(DOSSIER_DIR, name + ".md");

    if (action === "read") {
      try {
        return await fs.readFile(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { toolCallId: "", content: "Research dossier not found: " + name, isError: true };
        }
        throw error;
      }
    }

    if (action !== "write") {
      return { toolCallId: "", content: "research_dossier action must be read or write.", isError: true };
    }

    const content = String(input.content ?? "").trim();
    if (!content) {
      return { toolCallId: "", content: "Research dossier content cannot be empty.", isError: true };
    }

    await fs.writeFile(file, content + "\n", "utf8");
    return JSON.stringify({ saved: true, path: "nova/research/" + name + ".md", characters: content.length });
  },
};
