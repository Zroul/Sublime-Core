import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../reasoning/types.js";

const WORKSPACE = path.resolve("workspace");
const JOB_DIR = path.join(WORKSPACE, "nova", "jobs");

const STAGES = [
  "research",
  "script",
  "script_check",
  "assets",
  "render",
  "video_check",
] as const;

type Stage = (typeof STAGES)[number];

interface ContentJob {
  id: string;
  title: string;
  status: "active" | "completed" | "blocked";
  currentStage: Stage;
  createdAt: string;
  updatedAt: string;
  notes: string[];
}

function safeId(value: string): string {
  const id = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return id.slice(0, 80) || "job";
}

function jobPath(id: string): string {
  return path.join(JOB_DIR, safeId(id) + ".json");
}

async function readJob(id: string): Promise<ContentJob | undefined> {

  try {
    return JSON.parse(await fs.readFile(jobPath(id), "utf8")) as ContentJob;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function artifactExists(jobId: string, kind: string): Promise<boolean> {
  const file = path.join(JOB_DIR, safeId(jobId), kind + ".md");
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function requiredArtifact(stage: Stage, id: string): Promise<string | undefined> {
  const required: Partial<Record<Stage, string>> = {
    script_check: "script_qa",
    assets: "qa",
  };
  const kind = required[stage];
  if (!kind) return undefined;
  return (await artifactExists(id, kind)) ? undefined : kind;
}

export const contentJobTool: Tool = {
  name: "content_job",
  description:
    "Manage a durable faceless-content production job. Stages are research, script, script_check, assets, render, video_check. This tool tracks workflow state only; it does not publish or render media by itself.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "read", "advance", "block", "complete"],
      },
      id: { type: "string", description: "Job ID." },
      title: { type: "string", description: "Title when creating a job." },
      note: { type: "string", description: "Optional durable note." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  async handler(input) {
    const action = String(input.action ?? "read");
    await fs.mkdir(JOB_DIR, { recursive: true });
    const id = safeId(String(input.id ?? input.title ?? ""));
    if (!id) {
      return { toolCallId: "", content: "content_job requires an id or title.", isError: true };
    }

    if (action === "create") {
      const title = String(input.title ?? "").trim();
      if (!title) {
        return { toolCallId: "", content: "Creating a content job requires a title.", isError: true };
      }
      const existingJob = await readJob(id);
      if (existingJob) {
        return JSON.stringify({
          ...existingJob,
          notes: [
            ...existingJob.notes,
            "Idempotent create: this job already existed, so the existing workflow state was returned.",
          ],
        });
      }
      const now = new Date().toISOString();
      const job: ContentJob = {
        id,
        title,
        status: "active",
        currentStage: "research",
        createdAt: now,
        updatedAt: now,
        notes: [],
      };
      await fs.writeFile(jobPath(id), JSON.stringify(job, null, 2), "utf8");
      return JSON.stringify(job);
    }

    const job = await readJob(id);
    if (!job) {
      return { toolCallId: "", content: "Content job not found: " + id, isError: true };
    }

    if (action === "read") return JSON.stringify(job);

    if (action === "advance") {
      if (job.status !== "active") {
        return { toolCallId: "", content: "Only active jobs can advance.", isError: true };
      }
      const missingArtifact = await requiredArtifact(job.currentStage, id);
      if (missingArtifact) {
        return {
          toolCallId: "",
          content: `Cannot advance from ${job.currentStage}: required ${missingArtifact} artifact is missing.`,
          isError: true,
        };
      }

      const index = STAGES.indexOf(job.currentStage);
      if (index === STAGES.length - 1) {
        job.status = "completed";
        job.notes.push(
          "Video production completed and handed off. Publishing is handled manually outside NOVA.",
        );
      } else {
        job.currentStage = STAGES[index + 1];
      }
    } else if (action === "block") {
      job.status = "blocked";
      const note = String(input.note ?? "").trim();
      if (note) job.notes.push(note);
    } else if (action === "complete") {
      if (job.currentStage !== "video_check") {
        return { toolCallId: "", content: "A job can only be completed after video_check.", isError: true };
      }
      job.status = "completed";
    } else {
      return { toolCallId: "", content: "content_job action must be create, read, advance, block, or complete.", isError: true };
    }

    const note = String(input.note ?? "").trim();
    if (note && action === "advance") job.notes.push(note);
    job.updatedAt = new Date().toISOString();
    await fs.writeFile(jobPath(id), JSON.stringify(job, null, 2), "utf8");
    return JSON.stringify(job);
  },
};
