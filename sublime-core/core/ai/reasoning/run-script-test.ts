import { OllamaProvider } from "../providers/ollama.js";
import { generateScript } from "../../nova/script-generator.js";

const model = new OllamaProvider();

const script = await generateScript(model, {
  topic: "5 game mechanics that make players keep coming back",
  format: "short",
  targetSeconds: 60,
  tone: "fast, punchy, informative",
});

console.log("\n===== NOVA SCRIPT GENERATOR TEST =====\n");
console.log(JSON.stringify(script, null, 2));
