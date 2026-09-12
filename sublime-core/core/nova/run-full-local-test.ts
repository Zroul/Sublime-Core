import path from "node:path";
import { OllamaBrain } from "./local-brain.js";
import { NovaOrchestrator } from "./nova.js";
import { createLocalMediaAbilities } from "./abilities/local-media.js";

const topic = process.argv.slice(2).join(" ").trim() || "3 underrated free tools for students";
const nova = new NovaOrchestrator(new OllamaBrain(), {
  media: createLocalMediaAbilities(),
});

console.log("NOVA full local test");
console.log(`Topic: ${topic}`);
console.log("Brain: Ollama qwen3:8b");
console.log("Media: local FFmpeg + optional local TTS");
console.log("Cloud LLM: none");

try {
  const job = await nova.createJob(topic);
  const result = await nova.run(job);

  console.log(`Job: ${result.id}`);
  console.log(`Status: ${result.status}`);
  console.log(`Stage: ${result.stage}`);
  console.log(`Output: ${path.resolve(result.outputDir)}`);

  if (result.error) {
    console.error(`Error: ${result.error}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
