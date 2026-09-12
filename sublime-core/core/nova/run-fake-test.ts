import { NovaFakeBrain } from "./fake-brain.js";
import { NovaOrchestrator } from "./nova.js";

const brain = new NovaFakeBrain();
const nova = new NovaOrchestrator(brain);

const topic = process.argv.slice(2).join(" ").trim() || "3 underrated free tools for students";
const job = await nova.createJob(topic);
const result = await nova.run(job);

console.log(`NOVA fake test topic: ${topic}`);
console.log(`Job: ${result.id}`);
console.log(`Status: ${result.status}`);
console.log(`Stage: ${result.stage}`);
console.log(`Artifacts: ${result.outputDir}`);

if (result.error) {
  console.error(`Error: ${result.error}`);
  process.exitCode = 1;
}
