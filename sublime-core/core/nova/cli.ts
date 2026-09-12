import { promises as fs } from "node:fs";
import path from "node:path";
import { NovaFakeBrain } from "./fake-brain.js";
import { NovaOrchestrator } from "./nova.js";
import { clearStopRequest, requestStop } from "./job-state.js";
import { readManifest } from "./manifest.js";

const WORKSPACE = path.resolve("workspace", "nova");
const command = process.argv[2];

async function main(): Promise<void> {
  switch (command) {
    case "create": {
      const topic = process.argv.slice(3).join(" ").trim();
      if (!topic) throw new Error("Usage: nova create <topic>");
      const nova = new NovaOrchestrator(new NovaFakeBrain());
      const job = await nova.createJob(topic);
      console.log(JSON.stringify(job, null, 2));
      return;
    }
    case "run": {
      const id = requireId();
      const job = await readJob(id);
      await clearStopRequest(job.outputDir);
      const nova = new NovaOrchestrator(new NovaFakeBrain());
      const result = await nova.run(job);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case "stop": {
      const id = requireId();
      const job = await readJob(id);
      await requestStop(job.outputDir);
      console.log(`Stop requested for ${id}`);
      return;
    }
    case "status": {
      const id = requireId();
      const job = await readJob(id);
      const manifest = await readManifest(job.outputDir);
      console.log(JSON.stringify({ job, manifest }, null, 2));
      return;
    }
    case "resume": {
      const id = requireId();
      const job = await readJob(id);
      await clearStopRequest(job.outputDir);
      const nova = new NovaOrchestrator(new NovaFakeBrain());
      const result = await nova.run(job);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    default:
      console.log("NOVA CLI: create | run | stop | status | resume");
  }
}

function requireId(): string {
  const id = process.argv[3]?.trim();
  if (!id) throw new Error("A NOVA job id is required.");
  return id;
}

async function readJob(id: string) {
  const file = path.join(WORKSPACE, id, "job.json");
  return JSON.parse(await fs.readFile(file, "utf8")) as Parameters<NovaOrchestrator["run"]>[0];
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
