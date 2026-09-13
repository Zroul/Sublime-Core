import { OllamaProvider } from "../providers/ollama.js";
import { generateValidatedScript } from "../../nova/script-pipeline.js";

const model = new OllamaProvider();

const result = await generateValidatedScript(model, {
  topic: "5 game mechanics that make players keep coming back",
  format: "short",
  targetSeconds: 60,
  tone: "fast, punchy, informative",
});

console.log("\n===== NOVA VALIDATED SCRIPT PIPELINE =====\n");
console.log(JSON.stringify(result, null, 2));
