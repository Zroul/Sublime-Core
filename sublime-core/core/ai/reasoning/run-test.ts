import { OllamaProvider } from "../providers/ollama.js";
import { runResearchAgent } from "../../nova/research-agent.js";

const model = new OllamaProvider();

const result = await runResearchAgent({
  llm: model,
  query: "current latest major gaming news and developments",
  outputFile: "research/latest-gaming-research.md",
  maxTurns: 18,
});

console.log("\n===== NOVA RESEARCH AGENT RESULT =====\n");
console.log(result);
