import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { OllamaProvider } from "../ai/providers/ollama.js";
import { runReActLoop } from "../ai/reasoning/loop.js";
import type { AgentState, ToolCall, Turn } from "../ai/reasoning/types.js";
import {
  createFileTool,
  editFileTool,
  listFilesTool,
  readFileTool,
} from "../ai/tools/file-tools.js";
import { runCommandTool } from "../ai/tools/command-tools.js";
import { sourceFetchTool } from "../ai/tools/source-fetch.js";
import { webSearchTool } from "../ai/tools/web-search.js";
import { workspaceStatusTool } from "../ai/tools/workspace-status.js";
import { NOVA_SYSTEM_PROMPT } from "./system.js";

const MAX_TURNS = 18;
const MAX_WEB_SEARCHES = 6;
const MAX_SOURCE_FETCHES = 8;
const MAX_COMMANDS = 4;
const MAX_FILE_WRITES = 20;
const MAX_IDENTICAL_TOOL_CALLS = 2;

const workspace = path.resolve("workspace");
const logPath = path.join(workspace, "nova", "NOVA_RUN_LOG.md");

function toolSignature(call: ToolCall): string {
  return JSON.stringify({
    name: call.name,
    arguments: call.arguments,
  });
}

function createGuard(task: string) {
  const taskText = task.toLowerCase();
  const requiresCreation =
    taskText.includes("create") ||
    taskText.includes("write") ||
    taskText.includes("generate");
  const requiresVerification =
    taskText.includes("verify") ||
    taskText.includes("confirm") ||
    taskText.includes("check");
  const counts = new Map<string, number>();
  const identical = new Map<string, number>();

  return {
    beforeToolCall(call: ToolCall): { block: boolean; reason?: string } {
      const count = (counts.get(call.name) ?? 0) + 1;
      counts.set(call.name, count);

      const signature = toolSignature(call);
      const sameCount = (identical.get(signature) ?? 0) + 1;
      identical.set(signature, sameCount);

      if (sameCount > MAX_IDENTICAL_TOOL_CALLS) {
        return {
          block: true,
          reason:
            "NOVA guard blocked this action because the exact same tool call has already failed or repeated too many times.",
        };
      }

      if (call.name === "task_done") {
        const hasFileChange =
          (counts.get("create_file") ?? 0) +
            (counts.get("edit_file") ?? 0) >
          0;
        const hasVerification =
          (counts.get("read_file") ?? 0) +
            (counts.get("list_files") ?? 0) >
          0;

        if (requiresCreation && !hasFileChange) {
          return {
            block: true,
            reason:
              "NOVA guard: the task asks for creation, but no file change has happened yet.",
          };
        }

        if (requiresVerification && !hasVerification) {
          return {
            block: true,
            reason:
              "NOVA guard: the task asks for verification, but NOVA has not inspected the result yet.",
          };
        }
      }

      if (call.name === "web_search" && count > MAX_WEB_SEARCHES) {
        return {
          block: true,
          reason: `NOVA guard: maximum web searches per run is ${MAX_WEB_SEARCHES}.`,
        };
      }

      if (call.name === "source_fetch" && count > MAX_SOURCE_FETCHES) {
        return {
          block: true,
          reason: `NOVA guard: maximum source fetches per run is ${MAX_SOURCE_FETCHES}.`,
        };
      }

      if (call.name === "run_command" && count > MAX_COMMANDS) {
        return {
          block: true,
          reason: `NOVA guard: maximum commands per run is ${MAX_COMMANDS}.`,
        };
      }

      if (
        (call.name === "create_file" || call.name === "edit_file") &&
        count > MAX_FILE_WRITES
      ) {
        return {
          block: true,
          reason: `NOVA guard: maximum file writes per run is ${MAX_FILE_WRITES}.`,
        };
      }

      return { block: false };
    },
  };
}

async function appendLog(text: string): Promise<void> {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, text, "utf8");
}

async function runTask(task: string): Promise<void> {
  const provider = new OllamaProvider("core");
  const guard = createGuard(task);

  await appendLog(
    `\n## Run ${new Date().toISOString()}\n\n**Task:** ${task}\n\n`,
  );

  const result = await runReActLoop({
    llm: provider,
    system: NOVA_SYSTEM_PROMPT,
    initialMessages: [
      {
        role: "user",
        content: task,
      },
    ],
    tools: [
      webSearchTool,
      sourceFetchTool,
      createFileTool,
      readFileTool,
      editFileTool,
      listFilesTool,
      workspaceStatusTool,
      runCommandTool,
    ],
    maxTurns: MAX_TURNS,
    hooks: {
      beforeToolCall(call) {
        const decision = guard.beforeToolCall(call);
        if (decision.block) {
          console.log(`[BLOCKED] ${call.name}: ${decision.reason}`);
        } else {
          console.log(`[TOOL] ${call.name}`);
        }
        return decision;
      },
      onToolResult(result) {
        const preview = result.content.replace(/\s+/g, " ").slice(0, 240);
        console.log(
          `[OBSERVE] ${result.isError ? "ERROR " : ""}${preview}`,
        );
      },
      persistTurn(turn: Turn) {
        const toolCalls = turn.assistant.toolCalls ?? [];
        const toolNames = toolCalls.map((call) => call.name);
        const errors = turn.toolResults.filter((item) => item.isError).length;
        return appendLog(
          `- Turn ${turn.index}: tools=${toolNames.join(", ") || "none"}; errors=${errors}\n`,
        );
      },
    },
  });

  const lastAssistant = [...result.messages]
    .reverse()
    .find((message) => message.role === "assistant");

  const finalText =
    result.finalSummary ??
    lastAssistant?.content ??
    "NOVA finished without a final summary.";

  console.log("\nNOVA:");
  console.log(finalText);
  console.log(
    `\n[RUN] stopped=${result.stopped}, turns=${result.turns}\n`,
  );

  await appendLog(
    `\n**Stopped:** ${result.stopped}  \n**Turns:** ${result.turns}  \n**Result:** ${finalText}\n`,
  );
}

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(" ").trim();

  if (task) {
    await runTask(task);
    return;
  }

  const rl = createInterface({ input, output });

  console.log("NOVA online. Local brain: CORE. Type /exit to stop.\n");

  try {
    while (true) {
      const message = (await rl.question("You: ")).trim();

      if (!message) continue;
      if (message === "/exit") break;

      await runTask(message);
      console.log("");
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
