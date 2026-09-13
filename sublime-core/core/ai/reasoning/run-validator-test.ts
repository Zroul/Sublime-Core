import { OllamaProvider } from "../providers/ollama.js";
import { generateScript } from "../../nova/script-generator.js";
import { validateScript } from "../../nova/script-validator.js";

const model = new OllamaProvider();

const script = await generateScript(model, {
  topic: "5 game mechanics that make players keep coming back",
  format: "short",
  targetSeconds: 60,
  tone: "fast, punchy, informative",
});

const validation = validateScript(script, 60);

console.log("\n===== NOVA SCRIPT =====\n");
console.log(JSON.stringify(script, null, 2));
console.log("\n===== NOVA VALIDATION =====\n");
console.log(JSON.stringify(validation, null, 2));
