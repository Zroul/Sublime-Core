import { OllamaProvider } from "../providers/ollama.js";
import { runContentPipeline } from "../../nova/content-pipeline.js";

const model = new OllamaProvider();

const result = await runContentPipeline(model, {
  topic: "5 game mechanics that make players keep coming back",
  format: "short",
  targetSeconds: 60,
  tone: "fast, punchy, informative",
  researchOutputFile: "research/game-mechanics.md",
});

console.log("\n===== NOVA RESEARCH → SCRIPT PIPELINE =====\n");
console.log(`Research file: ${result.researchFile}`);
console.log(`Research stopped: ${result.researchRun.stopped}`);
console.log(`Research turns: ${result.researchRun.turns}`);
console.log(`Script attempts: ${result.script.attempts}`);
console.log("\n===== FINAL SCRIPT =====\n");
console.log(JSON.stringify(result.script.script, null, 2));
console.log("\n===== FINAL VALIDATION =====\n");
console.log(JSON.stringify(result.script.validation, null, 2));
