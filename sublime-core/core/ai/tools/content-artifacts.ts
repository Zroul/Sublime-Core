import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../reasoning/types.js";

const WORKSPACE = path.resolve("workspace");
const ROOT = path.join(WORKSPACE, "nova", "jobs");

type ArtifactKind = "script" | "qa" | "asset_manifest" | "review";

function safeId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function artifactPath(jobId: string, kind: ArtifactKind): string {
  return path.join(ROOT, safeId(jobId), kind + ".md");
}

export const contentArtifactTool: Tool = {
  name: "content_artifact",
  description:
    "Read or write durable content-production artifacts for a job: script, asset_manifest, or review. This creates inspectable workspace artifacts but does not render, publish, download copyrighted media, or claim an artifact passed review.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["read", "write"] },
      jobId: { type: "string", description: "Existing content job ID." },
      kind: { type: "string", enum: ["script", "qa", "asset_manifest", "review"] },
      content: { type: "string", description: "Markdown artifact content when writing." },
    },
    required: ["action", "jobId", "kind"],
    additionalProperties: false,
  },
  async handler(input) {
    const action = String(input.action ?? "read");
    const jobId = safeId(String(input.jobId ?? ""));
    const kind = String(input.kind ?? "") as ArtifactKind;

    if (!jobId || !["script", "asset_manifest", "review"].includes(kind)) {
      return { toolCallId: "", content: "content_artifact requires a valid jobId and kind.", isError: true };
    }

    const file = artifactPath(jobId, kind);
    if (action === "read") {
      try {
        return await fs.readFile(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { toolCallId: "", content: "Artifact not found: " + jobId + "/" + kind, isError: true };
        }
        throw error;
      }
    }

    if (action !== "write") {
      return { toolCallId: "", content: "content_artifact action must be read or write.", isError: true };
    }

    const content = String(input.content ?? "").trim();
    if (!content) {
      return { toolCallId: "", content: "Artifact content cannot be empty.", isError: true };
    }

    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content + "\n", "utf8");
    return JSON.stringify({
      saved: true,
      path: path.relative(WORKSPACE, file).replaceAll("\\", "/"),
      kind,
      characters: content.length,
    });
  },
};
