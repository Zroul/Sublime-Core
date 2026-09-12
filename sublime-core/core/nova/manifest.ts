import { promises as fs } from "node:fs";
import path from "node:path";

import type { NovaStage } from "./types.js";

export interface NovaArtifact {
  stage: NovaStage;
  file: string;
  createdAt: string;
}

export interface NovaManifest {
  jobId: string;
  topic: string;
  createdAt: string;
  updatedAt: string;
  currentStage: NovaStage;
  status: "queued" | "running" | "completed" | "failed";
  artifacts: NovaArtifact[];
  errors: string[];
}

export async function createManifest(
  directory: string,
  input: Omit<NovaManifest, "updatedAt" | "artifacts" | "errors">,
): Promise<NovaManifest> {
  const manifest: NovaManifest = {
    ...input,
    updatedAt: new Date().toISOString(),
    artifacts: [],
    errors: [],
  };

  await writeManifest(directory, manifest);
  return manifest;
}

export async function updateManifest(
  directory: string,
  patch: Partial<Pick<NovaManifest, "currentStage" | "status">>,
): Promise<NovaManifest> {
  const manifest = await readManifest(directory);

  const updated: NovaManifest = {
    ...manifest,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  await writeManifest(directory, updated);
  return updated;
}

export async function recordArtifact(
  directory: string,
  artifact: NovaArtifact,
): Promise<NovaManifest> {
  const manifest = await readManifest(directory);
  const artifacts = manifest.artifacts.filter((item) => item.file !== artifact.file);

  const updated: NovaManifest = {
    ...manifest,
    updatedAt: new Date().toISOString(),
    artifacts: [...artifacts, artifact],
  };

  await writeManifest(directory, updated);
  return updated;
}

export async function recordManifestError(
  directory: string,
  message: string,
): Promise<NovaManifest> {
  const manifest = await readManifest(directory);
  const updated: NovaManifest = {
    ...manifest,
    updatedAt: new Date().toISOString(),
    errors: [...manifest.errors, message],
  };

  await writeManifest(directory, updated);
  return updated;
}

export async function readManifest(directory: string): Promise<NovaManifest> {
  const raw = await fs.readFile(path.join(directory, "manifest.json"), "utf8");
  return JSON.parse(raw) as NovaManifest;
}

async function writeManifest(directory: string, manifest: NovaManifest): Promise<void> {
  await fs.writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
}
