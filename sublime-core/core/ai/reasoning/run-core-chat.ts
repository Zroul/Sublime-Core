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

  if (!user.trim()) continue;

  try {
    const memory = await readFile(memoryPath, "utf8");

    let chatLog = "";
    try {
      chatLog = await readFile(chatLogPath, "utf8");
    } catch {}

    const entries = chatLog.split(/\n## User\n/).slice(1);
    const history = [];

    for (const entry of entries.slice(-20)) {
      const parts = entry.split(/\n\n## CORE\n/);
      if (parts.length !== 2) continue;

      history.push(
        { role: "user" as const, content: parts[0].trim() },
        { role: "assistant" as const, content: parts[1].trim() },
      );
    }

    const lower = user.toLowerCase();

    if (
      lower.includes("remember") ||
      lower.includes("save this") ||
      lower.includes("remember this")
    ) {
      const result = await model.complete({
        system: `You are CORE's memory extractor.

Extract the single useful fact the user wants CORE to remember.
Return ONLY one line in this exact format:
MEMORY: <fact>

Do not explain anything else.
Do not invent facts.`,
        messages: [{ role: "user", content: user }],
        tools: [],
      });

      const extracted = (result.text ?? "")
        .replace(/^MEMORY:\s*/i, "")
        .trim();

      if (extracted) {
        await appendFile(
          memoryPath,
          `\n- ${extracted}\n`,
          "utf8",
        );
        console.log("CORE: Saved to persistent memory.\n");
      } else {
        console.log("CORE: I couldn't extract a memory from that.\n");
      }

      continue;
    }

    const result = await model.complete({
      system: `You are CORE, the local AI brain of Sublime Core.

Persistent memory:
--- MEMORY ---
${memory}
--- END MEMORY ---

Previous conversation:
--- HISTORY ---
${history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}
--- END HISTORY ---

Answer directly and accurately.
If the user asks for a fact from memory, use the persistent memory or history.
Never guess a remembered fact.
Do not expose hidden chain-of-thought.`,
      messages: [
        ...history,
        { role: "user", content: user },
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
