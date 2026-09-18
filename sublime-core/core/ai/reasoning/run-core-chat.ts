import { appendFile, readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { OllamaProvider } from "../providers/ollama.js";

const memoryPath = new URL("../../../CORE_MEMORY.md", import.meta.url);
const chatLogPath = new URL("../../../CORE_CHAT_LOG.md", import.meta.url);

const model = new OllamaProvider();
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
    const memory = await readFile(memoryPath, "utf8");

    let chatLog = "";
    try {
      chatLog = await readFile(chatLogPath, "utf8");
    } catch {
      chatLog = "";
    }

    const history = [];
    const entries = chatLog.split(/\n## User\n/).slice(1);

    for (const entry of entries.slice(-20)) {
      const parts = entry.split(/\n\n## CORE\n/);
      if (parts.length !== 2) continue;

      const previousUser = parts[0].trim();
      const previousCore = parts[1].trim();

      if (previousUser) {
        history.push({
          role: "user" as const,
          content: previousUser,
        });
      }

      if (previousCore) {
        history.push({
          role: "assistant" as const,
          content: previousCore,
        });
      }
    }

    const result = await model.complete({
      system: `You are CORE, the local AI brain of Sublime Core.

Use this persistent project memory:

--- CORE MEMORY ---
${memory}
--- END CORE MEMORY ---

You are a chat brain, not NOVA and not an autonomous agent.
Answer the user directly.
Do not expose hidden chain-of-thought.
Treat the supplied conversation history as real previous conversation.
Do not invent memories.`,
      messages: [
        ...history,
        {
          role: "user",
          content: user,
        },
      ],
      tools: [],
    });

    const answer = result.text ?? "";

    console.log(`CORE: ${answer}\n`);

    await appendFile(
      chatLogPath,
      `\n## User\n${user}\n\n## CORE\n${answer}\n`,
      "utf8",
    );
  } catch (error) {
    console.error(
      "CORE error:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

rl.close();
