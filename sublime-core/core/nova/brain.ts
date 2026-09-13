import type { LlmClient } from "../ai/reasoning/types.js";
import { OllamaProvider } from "../ai/providers/ollama.js";

export function createNovaBrain(): LlmClient {
  return new OllamaProvider();
}
