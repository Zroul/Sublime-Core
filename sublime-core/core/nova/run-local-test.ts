import { OllamaBrain } from "./local-brain.js";
import { NovaOrchestrator } from "./nova.js";

const brain = new OllamaBrain();
const nova = new NovaOrchestrator(brain);

const topic = process.argv.slice(2).join(" ") || "3 underrated free tools for students";

console.log(`NOVA local test topic: ${topic}`);
console.log("Using local brain only. No cloud model is involved.\n");

const job = await nova.createJob(topic);
const result = await nova.run(job);

console.log("===== NOVA RESULT =====");
console.log(JSON.stringify(result, null, 2));
