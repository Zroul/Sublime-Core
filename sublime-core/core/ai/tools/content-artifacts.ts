import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../reasoning/types.js";
import { resolveWorkspacePath } from "./workspace-path.js";

const WORKSPACE = path.resolve("workspace");

export type ArtifactKind =
  | "request" | "research" | "script" | "script_data" | "script_qa" | "qa"
  | "visual_plan" | "asset_manifest" | "audio" | "timeline"
  | "render" | "validation" | "final" | "review";

const JSON_ARTIFACTS = new Set<ArtifactKind>([
  "request", "script_data", "visual_plan", "asset_manifest", "audio", "timeline", "render", "validation", "final",
]);

function safeId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function artifactPath(jobId: string, kind: ArtifactKind): string {
  const extension = JSON_ARTIFACTS.has(kind) ? ".json" : ".md";
  return path.join("nova", "jobs", safeId(jobId), kind + extension);
}

export async function readContentArtifact(jobId: string, kind: ArtifactKind): Promise<string> {
  const file = await resolveWorkspacePath(artifactPath(jobId, kind));
  return fs.readFile(file, "utf8");
}

export async function writeContentArtifact(
  jobId: string,
  kind: ArtifactKind,
  content: string,
): Promise<string> {
  const safeJobId = safeId(jobId);
  if (!safeJobId) throw new Error("A valid job ID is required.");
  if (!content.trim()) throw new Error("Artifact content cannot be empty.");
  const file = await resolveWorkspacePath(artifactPath(safeJobId, kind));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content.trimEnd() + "\n", "utf8");
  return path.relative(WORKSPACE, file).replaceAll("\\", "/");
}

export const contentArtifactTool: Tool = {
  name: "content_artifact",
  description:
    "Read or write durable content-production artifacts for a job, including request, research, script, QA, visual plan, assets, timeline, render, validation, and final records. This tool does not publish or claim validation without evidence.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["read", "write"] },
      jobId: { type: "string", description: "Existing content job ID." },
      kind: {
        type: "string",
        enum: ["request", "research", "script", "script_data", "script_qa", "qa", "visual_plan", "asset_manifest", "audio", "timeline", "render", "validation", "final", "review"],
      },
      content: { type: "string", description: "Markdown artifact content when writing." },
    },
    required: ["action", "jobId", "kind"],
    additionalProperties: false,
  },
  async handler(input) {
    const action = String(input.action ?? "read");
    const jobId = safeId(String(input.jobId ?? ""));
    const kind = String(input.kind ?? "") as ArtifactKind;

    if (!jobId || ![
      "request", "research", "script", "script_data", "script_qa", "qa", "visual_plan",
      "asset_manifest", "audio", "timeline", "render", "validation", "final", "review",
    ].includes(kind)) {
      return { toolCallId: "", content: "content_artifact requires a valid jobId and kind.", isError: true };
    }

    if (action === "read") {
      try {
        return await readContentArtifact(jobId, kind);
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

    const savedPath = await writeContentArtifact(jobId, kind, content);
    return JSON.stringify({
      saved: true,
      path: savedPath,
      kind,
      characters: content.length,
    });
  },
};
