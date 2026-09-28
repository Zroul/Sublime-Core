import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { OllamaProvider } from "../ai/providers/ollama.js";
import { runReActLoop } from "../ai/reasoning/loop.js";
import type { Turn } from "../ai/reasoning/types.js";
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
import { verifyArtifactTool } from "../ai/tools/verify-artifact.js";
import { novaMemoryTool } from "../ai/tools/nova-memory.js";
import { researchDossierTool } from "../ai/tools/research-dossier.js";
import { createNovaGuard } from "./guard.js";
import { NOVA_SYSTEM_PROMPT } from "./system.js";
import {
  createRunId,
  finalizeRunState,
  saveNovaRunState,
  stateFromTurn,
} from "./run-state.js";

const MAX_TURNS = 18;
const workspace = path.resolve("workspace");
const logPath = path.join(workspace, "nova", "NOVA_RUN_LOG.md");

async function appendLog(text: string): Promise<void> {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, text, "utf8");
}

async function runTask(task: string): Promise<void> {
  const provider = new OllamaProvider("core");
  const guard = createNovaGuard(task);
  const runId = createRunId();
  const startedAt = new Date().toISOString();

  await appendLog(
    `\n## Run ${startedAt}\n\n**Run ID:** ${runId}\n\n**Task:** ${task}\n\n`,
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
      verifyArtifactTool,
      novaMemoryTool,
      researchDossierTool,
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
      onToolResult(result, state) {
        const assistant = [...state.messages]
          .reverse()
          .find((message) => message.role === "assistant");
        const call = assistant?.toolCalls?.find(
          (item) => item.id === result.toolCallId,
        );

        if (call) {
          guard.recordResult(
            call.name,
            Boolean(result.isError),
            call.arguments,
          );
        }

        const preview = result.content.replace(/\s+/g, " ").slice(0, 240);
        console.log(
          `[OBSERVE] ${result.isError ? "ERROR " : ""}${preview}`,
        );
      },
      persistTurn(turn: Turn) {
        const toolCalls = turn.assistant.toolCalls ?? [];
        const toolNames = toolCalls.map((call) => call.name);
        const errors = turn.toolResults.filter((item) => item.isError).length;
        const checkpoint = stateFromTurn(
          runId,
          task,
          startedAt,
          turn,
          state.messages,
        );

        return Promise.all([
          appendLog(
            `- Turn ${turn.index}: tools=${toolNames.join(", ") || "none"}; errors=${errors}\n`,
          ),
          saveNovaRunState(checkpoint),
        ]).then(() => undefined);
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
    `\n**Stopped:** ${result.stopped}  \\
**Turns:** ${result.turns}  \\
**Result:** ${finalText}\n`,
  );

  const finalState = finalizeRunState(
    stateFromTurn(
      runId,
      task,
      startedAt,
      {
        index: result.turns,
        assistant: { role: "assistant", content: finalText },
        toolResults: [],
      },
      result.messages,
    ),
    result,
  );

  await saveNovaRunState(finalState);
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
