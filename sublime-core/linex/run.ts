import "dotenv/config";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { OllamaProvider } from "../core/ai/providers/ollama.js";
import { runReActLoop } from "../core/ai/reasoning/loop.js";
import type { Message } from "../core/ai/reasoning/types.js";
import { createLinexTools } from "./agent.js";

const MAX_TURNS = 8;
const SYSTEM_PROMPT = `
You are LINEX, a restricted coding agent using the user's existing local CORE model.
Your job is to help develop OBSIDIAN, not to start unrelated projects.
Think carefully, then use tools to inspect the repository and verify any claimed changes.
Only operate within the OBSIDIAN project using the provided tools.
Never claim a file was changed unless a tool confirms it. Never claim tests passed unless the test tool ran successfully.
Prefer the smallest change that directly advances the user's task. Read relevant files before editing.
After editing, run the provided host tests when relevant. If a test fails, diagnose from its actual output and make at most two repair attempts.
Do not request or expose secrets. Do not attempt arbitrary shell execution, package installation, external publication, Git commits, pushes, merges, or deletion.
If a task asks for something outside the available tools, explain the limitation rather than inventing a result.
When finished, call task_done with a concise evidence-based summary, including files changed and test status.
`.trim();

export async function runLinexTask(task: string): Promise<void> {
  const repositoryRoot = process.cwd();
  const projectRoot = path.join(repositoryRoot, "obsidian");
  try {
    const stat = await import("node:fs/promises").then((fs) => fs.stat(projectRoot));
    if (!stat.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`OBSIDIAN directory not found at ${projectRoot}. Run LINEX from the sublime-core repository root.`);
  }

  const provider = new OllamaProvider();
  const messages: Message[] = [{ role: "user", content: task }];
  console.log(`LINEX online. CORE model: ${process.env.OLLAMA_MODEL ?? "core"}`);
  console.log(`Scope: ${projectRoot}`);
  console.log(`Task budget: ${MAX_TURNS} turns\n`);

  const result = await runReActLoop({
    llm: provider,
    system: SYSTEM_PROMPT,
    initialMessages: messages,
    tools: createLinexTools(projectRoot),
    maxTurns: MAX_TURNS,
    hooks: {
      beforeToolCall(call) {
        console.log(`[TOOL] ${call.name}`);
        return { block: false };
      },
      onToolResult(result) {
        const preview = result.content.replace(/\s+/g, " ").slice(0, 220);
        console.log(`[${result.isError ? "ERROR" : "OBSERVE"}] ${preview}`);
      },
    },
  });

  const finalMessage = [...result.messages].reverse().find((message) => message.role === "assistant");
  console.log("\nLINEX result:");
  console.log(result.finalSummary ?? finalMessage?.content ?? "No final summary returned.");
  console.log(`\n[RUN] stopped=${result.stopped}; turns=${result.turns}; successful=${Boolean(result.successfulStop)}`);
  if (result.stopped === "maxTurns" || result.stopped === "model_error" || result.stopped === "invalid_response") {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(" ").trim();
  if (!task) {
    console.error('Usage: npm run linex -- "Describe one bounded OBSIDIAN coding task"');
    process.exitCode = 2;
    return;
  }
  await runLinexTask(task);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`LINEX stopped safely: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
