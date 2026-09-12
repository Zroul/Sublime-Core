import { NovaFakeBrain } from "./fake-brain.js";
import { NovaOrchestrator } from "./nova.js";

const topic = "3 underrated free tools for students";

const brain = new NovaFakeBrain();
const nova = new NovaOrchestrator(brain);
const job = await nova.createJob(topic);
const result = await nova.run(job);

console.log(`NOVA fake test: ${result.status}`);
console.log(`Stage: ${result.stage}`);
console.log(`Job: ${result.id}`);
console.log(`Artifacts: ${result.outputDir}`);

if (result.status !== "completed") {
  console.error(`Error: ${result.error ?? "unknown failure"}`);
  process.exitCode = 1;
}
