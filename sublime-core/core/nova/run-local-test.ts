import { OllamaBrain } from "./local-brain.js";
import { NovaOrchestrator } from "./nova.js";

const brain = new OllamaBrain();
const nova = new NovaOrchestrator(brain);

const topic = process.argv.slice(2).join(" ") || "3 underrated free tools for students";

console.log(`NOVA local test topic: ${topic}`);
console.log(`Local model: ${brain.getModel()}`);
console.log("Using local brain only. No cloud model is involved.\n");

if (!(await brain.isReady())) {
  console.error("Ollama is not reachable at the configured local address.");
  console.error("Start Ollama, then run this test again.");
  process.exit(1);
}

if (!(await brain.hasModel())) {
  console.error(`The local model '${brain.getModel()}' is not installed in Ollama.`);
  console.error(`Install that model locally, or set NOVA_OLLAMA_MODEL to an installed model.`);
  process.exit(1);
}

const job = await nova.createJob(topic);
const result = await nova.run(job);

console.log("===== NOVA RESULT =====");
console.log(JSON.stringify(result, null, 2));
