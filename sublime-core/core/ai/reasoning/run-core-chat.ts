import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFile } from "node:fs/promises";
import { OllamaProvider } from "../providers/ollama.js";

const memoryPath = new URL("../../../CORE_MEMORY.md", import.meta.url);
const memory = await readFile(memoryPath, "utf8");

const model = new OllamaProvider();

const system = `
You are CORE, the local AI brain of Sublime Core.

Use the following project memory as persistent context:

--- CORE MEMORY ---
${memory}
--- END CORE MEMORY ---

You are a chat brain, not NOVA and not an autonomous agent.
Answer the user directly.
Do not expose hidden chain-of-thought.
`;

const rl = createInterface({ input, output });

console.log("CORE online. Type /exit to quit.");

while (true) {
  const user = await rl.question("You: ");

  if (user.trim() === "/exit") {
    break;
  }

  if (!user.trim()) {
    continue;
  }

  try {
    const result = await model.complete({
      system,
      messages: [{ role: "user", content: user }],
      tools: [],
    });

    console.log(`CORE: ${result.text ?? ""}\n`);
  } catch (error) {
    console.error(
      "CORE error:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

rl.close();
