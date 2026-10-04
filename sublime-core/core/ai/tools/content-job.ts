import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../reasoning/types.js";
import { resolveWorkspacePath } from "./workspace-path.js";

export const CONTENT_JOB_STAGES = [
  "created",
  "planning",
  "research",
  "scripting",
  "qa",
  "visual_planning",
  "asset_resolution",
  "audio",
  "timeline",
  "rendering",
  "validation",
  "repair",
] as const;

export type ContentJobStage = (typeof CONTENT_JOB_STAGES)[number] |
  "script_check" | "assets" | "render" | "video_check" | "script";

export interface ContentJob {
  id: string;
  title: string;
  status: "active" | "completed" | "failed" | "blocked";
  currentStage: ContentJobStage;
  createdAt: string;
  updatedAt: string;
  notes: string[];
  outputPath?: string;
  error?: string;
}

function safeId(value: string): string {
  const id = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return id.slice(0, 80) || "job";
}

async function jobPath(id: string): Promise<string> {
  return resolveWorkspacePath(path.join("nova", "jobs", safeId(id) + ".json"));
}

async function saveJob(job: ContentJob): Promise<void> {
  const target = await jobPath(job.id);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = target + ".tmp";
  await fs.writeFile(temp, JSON.stringify(job, null, 2), "utf8");
  await fs.rename(temp, target);
}

async function readJob(id: string): Promise<ContentJob | undefined> {
  try {
    return JSON.parse(await fs.readFile(await jobPath(id), "utf8")) as ContentJob;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function loadContentJobRecord(id: string): Promise<ContentJob | undefined> {
  return readJob(id);
}

async function artifactExists(jobId: string, kind: string): Promise<boolean> {
  const file = await resolveWorkspacePath(
    path.join("nova", "jobs", safeId(jobId), kind + ".md"),
  );
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function requiredArtifact(stage: ContentJobStage, id: string): Promise<string | undefined> {
  const required: Partial<Record<ContentJobStage, string>> = {
    scripting: "research",
    qa: "script",
    visual_planning: "script_qa",
    asset_resolution: "visual_plan",
    timeline: "asset_manifest",
    rendering: "timeline",
    validation: "render",
    script_check: "script_qa",
    assets: "qa",
  };
  const kind = required[stage];
  if (!kind) return undefined;
  if (kind === "research" || kind === "script" || kind === "script_qa" || kind === "qa") {
    return (await artifactExists(id, kind)) ? undefined : kind;
  }
  const extension = kind === "render" || kind === "timeline" || kind === "visual_plan" || kind === "asset_manifest"
    ? ".json"
    : ".md";
  const file = await resolveWorkspacePath(path.join("nova", "jobs", safeId(id), kind + extension));
  try {
    await fs.access(file);
    return undefined;
  } catch {
    return kind;
  }
}

export async function createContentJobRecord(id: string, title: string): Promise<ContentJob> {
  const safe = safeId(id);
  const existing = await readJob(safe);
  if (existing) return existing;
  const now = new Date().toISOString();
  const job: ContentJob = {
    id: safe,
    title: title.trim(),
    status: "active",
    currentStage: "created",
    createdAt: now,
    updatedAt: now,
    notes: [],
  };
  await saveJob(job);
  return job;
}

export async function updateContentJobRecord(
  id: string,
  update: Partial<Pick<ContentJob, "status" | "currentStage" | "outputPath" | "error">> & { note?: string },
): Promise<ContentJob> {
  const job = await readJob(id);
  if (!job) throw new Error(`Content job not found: ${safeId(id)}`);
  if (update.currentStage && ![...CONTENT_JOB_STAGES, "script", "script_check", "assets", "render", "video_check"].includes(update.currentStage as never)) {
    throw new Error(`Unsupported content-job stage: ${update.currentStage}`);
  }
  if (update.status) job.status = update.status;
  if (update.currentStage) job.currentStage = update.currentStage;
  if (update.outputPath !== undefined) job.outputPath = update.outputPath;
  if (update.error !== undefined) job.error = update.error;
  if (update.note?.trim()) job.notes.push(update.note.trim());
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  return job;
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
        enum: ["create", "read", "advance", "set_stage", "block", "complete"],
      },
      id: { type: "string", description: "Job ID." },
      title: { type: "string", description: "Title when creating a job." },
      note: { type: "string", description: "Optional durable note." },
      stage: { type: "string", enum: [...CONTENT_JOB_STAGES] },
    },
    required: ["action"],
    additionalProperties: false,
  },
  async handler(input) {
    const action = String(input.action ?? "read");
    const jobDirectory = await resolveWorkspacePath(path.join("nova", "jobs"));
    await fs.mkdir(jobDirectory, { recursive: true });
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
      return JSON.stringify(await createContentJobRecord(id, title));
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

      const legacyNext: Partial<Record<ContentJobStage, ContentJobStage>> = {
        research: "script",
        script: "script_check",
        script_check: "assets",
        assets: "render",
        render: "video_check",
        created: "planning",
        planning: "research",
        scripting: "qa",
        qa: "visual_planning",
        visual_planning: "asset_resolution",
        asset_resolution: "audio",
        audio: "timeline",
        timeline: "rendering",
        rendering: "validation",
        repair: "rendering",
      };
      const next = legacyNext[job.currentStage];
      if (!next && job.currentStage !== "video_check" && job.currentStage !== "validation") {
        return { toolCallId: "", content: `No next stage is defined after ${job.currentStage}.`, isError: true };
      }
      if (job.currentStage === "video_check" || job.currentStage === "validation") {
        job.status = "completed";
      } else {
        job.currentStage = next!;
      }
    } else if (action === "set_stage") {
      const stage = String(input.stage ?? "") as ContentJobStage;
      if (![...CONTENT_JOB_STAGES].includes(stage as (typeof CONTENT_JOB_STAGES)[number])) {
        return { toolCallId: "", content: "content_job set_stage requires a valid production stage.", isError: true };
      }
      job.currentStage = stage;
    } else if (action === "block") {
      job.status = "blocked";
      const note = String(input.note ?? "").trim();
      if (note) job.notes.push(note);
    } else if (action === "complete") {
      if (job.currentStage !== "video_check" && job.currentStage !== "validation") {
        return { toolCallId: "", content: "A job can only be completed after validation.", isError: true };
      }
      const finalPath = await resolveWorkspacePath(path.join("nova", "jobs", safeId(id), "final.mp4"));
      const finalRecord = await resolveWorkspacePath(path.join("nova", "jobs", safeId(id), "final.json"));
      try {
        const stat = await fs.stat(finalPath);
        const record = JSON.parse(await fs.readFile(finalRecord, "utf8")) as { valid?: boolean };
        if (!stat.isFile() || stat.size <= 0 || record.valid !== true) throw new Error("The final video has not passed validation.");
      } catch (error) {
        return { toolCallId: "", content: `Cannot complete job: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
      job.status = "completed";
    } else {
      return { toolCallId: "", content: "content_job action must be create, read, advance, block, or complete.", isError: true };
    }

    const note = String(input.note ?? "").trim();
    if (note && action === "advance") job.notes.push(note);
    job.updatedAt = new Date().toISOString();
    await saveJob(job);
    return JSON.stringify(job);
  },
};
