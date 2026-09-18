import { appendFile, readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { OllamaProvider } from "../providers/ollama.js";

const memoryPath = new URL("../../../CORE_MEMORY.md", import.meta.url);
const userMemoryPath = new URL("../../../CORE_USER_MEMORY.md", import.meta.url);
const chatLogPath = new URL("../../../CORE_CHAT_LOG.md", import.meta.url);

const model = new OllamaProvider();
const rl = createInterface({ input, output });

console.log("CORE online. Type /exit to quit.");

async function loadMemory(): Promise<string> {
  const baseMemory = await readFile(memoryPath, "utf8");

  let userMemory = "";
  try {
    userMemory = await readFile(userMemoryPath, "utf8");
  } catch {}

  return [baseMemory, userMemory].filter(Boolean).join("\n\n");
}

while (true) {
  const user = await rl.question("You: ");

  if (user.trim() === "/exit") {
    break;
  }

  if (user.trim() === "/memory") {
    try {
      console.log("\n--- CORE MEMORY ---");
      console.log(await loadMemory());
      console.log("--- END MEMORY ---\n");
    } catch (error) {
      console.error(
        "CORE memory error:",
        error instanceof Error ? error.message : String(error),
      );
    }
    continue;
  }

  if (!user.trim()) continue;

  try {
    const lower = user.toLowerCase().trim();

    const wantsMemorySave =
      /^(remember|save|store)\b/i.test(lower) ||
      /\b(remember this|save this|store this)\b/i.test(lower);

    if (wantsMemorySave) {
      const cleaned = user
        .replace(/^\s*(remember|save|store)\s+(this\s*:\s*)?/i, "")
        .replace(/\s*(please\s+)?remember\s+this\.?\s*$/i, "")
        .replace(/\s*(please\s+)?save\s+this\.?\s*$/i, "")
        .trim();

      if (cleaned) {
        await appendFile(
          userMemoryPath,
          "\n- " + cleaned + "\n",
          "utf8",
        );
        console.log("CORE: Saved to persistent memory.\n");
      } else {
        console.log("CORE: Tell me what you want me to remember.\n");
      }

      continue;
    }

    const memory = await loadMemory();

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

    const historyText = history
      .map((m) => m.role.toUpperCase() + ": " + m.content)
      .join("\n");

    const result = await model.complete({
      system:
        "You are CORE, the local AI brain of Sublime Core.\n\n" +
        "Persistent memory:\n--- MEMORY ---\n" +
        memory +
        "\n--- END MEMORY ---\n\n" +
        "Previous conversation:\n--- HISTORY ---\n" +
        historyText +
        "\n--- END HISTORY ---\n\n" +
        "Answer directly and accurately.\n" +
        "IMPORTANT MEMORY RULES:\n" +
        "1. The PERSISTENT MEMORY section is information you are explicitly allowed to use.\n" +
        "2. Before answering, actively scan PERSISTENT MEMORY for facts relevant to the user's question.\n" +
        "3. If the requested fact appears in PERSISTENT MEMORY, use it as the answer even if the conversation HISTORY contains a different answer. PERSISTENT MEMORY has priority over HISTORY.\n" +
        "4. Never say you do not have access to memory when the requested fact is present below.\n" +
        "5. Never guess a fact that is not present in memory or history.\n" +
        "6. Do not expose hidden chain-of-thought.",
      messages: [
        ...history,
        { role: "user", content: user },
      ],
      tools: [],
    });

    const answer = result.text ?? "";
    console.log("CORE: " + answer + "\n");

    await appendFile(
      chatLogPath,
      "\n## User\n" + user + "\n\n## CORE\n" + answer + "\n",
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
