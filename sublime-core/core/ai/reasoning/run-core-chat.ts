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

    const memoryLines = memory
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "));

    const stopWords = new Set([
      "what", "is", "my", "the", "a", "an", "do", "does", "did",
      "i", "you", "me", "about", "tell", "know", "remember", "can",
      "please", "this", "that", "of", "to", "in", "for", "and",
    ]);

    const questionWords = new Set(
      lower
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 1 && !stopWords.has(word)),
    );

    let directMemoryMatch = "";

    if (questionWords.size > 0) {
      let bestScore = 0;

      for (const line of memoryLines) {
        const memoryWords = new Set(
          line
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((word) => word.length > 1 && !stopWords.has(word)),
        );

        let score = 0;
        for (const word of questionWords) {
          if (memoryWords.has(word)) score += 1;
        }

        if (score >= 2 && score > bestScore) {
          bestScore = score;
          directMemoryMatch = line.slice(2).trim();
        }
      }
    }

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
        "DIRECT MEMORY MATCH:\n" +
        (directMemoryMatch || "NONE") +
        "\n--- END DIRECT MEMORY MATCH ---\n\n" +
        "Previous conversation:\n--- HISTORY ---\n" +
        historyText +
        "\n--- END HISTORY ---\n\n" +
        "Answer directly and accurately.\n" +
        "IMPORTANT MEMORY RULES:\n" +
        "1. The PERSISTENT MEMORY section is information you are explicitly allowed to use.\n" +
        "2. Before answering, actively scan PERSISTENT MEMORY for facts relevant to the user's question.\n" +
        "3. If a DIRECT MEMORY MATCH is provided below, it is the answer source. Use it instead of saying you do not know.\n" +
        "4. PERSISTENT MEMORY has priority over HISTORY.\n" +
        "5. Never say you do not have access to memory when the requested fact is present.\n" +
        "6. Never guess a fact that is not present in memory or history.\n" +
        "7. Do not expose hidden chain-of-thought.",
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
