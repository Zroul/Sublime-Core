import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";

import { OllamaProvider } from "../ai/providers/ollama.js";
import { runReActLoop } from "../ai/reasoning/loop.js";
import type { AgentRunResult, LlmClient, Message, Tool, Turn } from "../ai/reasoning/types.js";
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
import { novaRunStateTool } from "../ai/tools/nova-run-state.js";
import { contentJobTool } from "../ai/tools/content-job.js";
import { contentArtifactTool } from "../ai/tools/content-artifacts.js";
import { contentQaTool } from "../ai/tools/content-qa.js";
import { videoEngineTool } from "../ai/tools/video-engine.js";
import { editingModuleTool } from "../ai/tools/editing-module.js";
import { visualPlannerTool } from "../ai/tools/visual-planner.js";
import { resolveWorkspacePath } from "../ai/tools/workspace-path.js";
import { createNovaGuard } from "./guard.js";
import { NOVA_SYSTEM_PROMPT } from "./system.js";
import {
  createRunId,
  finalizeRunState,
  saveNovaRunState,
  stateFromTurn,
} from "./run-state.js";

const MAX_TURNS = 18;

export interface RunTaskOptions {
  maxTurns?: number;
  videoEngine?: Tool;
}

async function appendLog(text: string): Promise<void> {
  const logPath = await resolveWorkspacePath("nova/NOVA_RUN_LOG.md");
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, text, "utf8");
}

export async function runTask(
  task: string,
  provider: LlmClient = new OllamaProvider("core"),
  options: RunTaskOptions = {},
): Promise<void> {
  const guard = createNovaGuard(task);
  const runId = createRunId();
  const startedAt = new Date().toISOString();

  await appendLog(
    `\n## Run ${startedAt}\n\n**Run ID:** ${runId}\n\n**Task:** ${task}\n\n`,
  );

  let lastVideoRender: string | null = null;
  let lastVideoProbe: string | null = null;
  const initialMessages: Message[] = [{ role: "user", content: task }];
  let lastMessages = initialMessages;
  let lastTurn = 0;

  let result: AgentRunResult;
  try {
    result = await runReActLoop({
    llm: provider,
    system: NOVA_SYSTEM_PROMPT,
    initialMessages,
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
      novaRunStateTool,
      contentJobTool,
      contentArtifactTool,
      contentQaTool,
      visualPlannerTool,
      editingModuleTool,
      options.videoEngine ?? videoEngineTool,
      runCommandTool,
    ],
    maxTurns: options.maxTurns ?? MAX_TURNS,
    hooks: {
      beforeToolCall(call, state) {
        lastMessages = [...state.messages];
        lastTurn = state.turn;
        const decision = guard.beforeToolCall(call);
        if (decision.block) {
          console.log(`[BLOCKED] ${call.name}: ${decision.reason}`);
        } else {
          console.log(`[TOOL] ${call.name}`);
        }
        return decision;
      },
      onToolResult(result, state) {
        lastMessages = [...state.messages];
        lastTurn = state.turn;
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
            result.content,
          );
        }

        const preview = result.content.replace(/\s+/g, " ").slice(0, 240);
        if (!result.isError && call?.name === "video_engine") {
          const action = call.arguments?.action;
          if (action === "render") {
            try {
              const data = JSON.parse(result.content);
              if (data.ok && typeof data.outputPath === "string") {
                lastVideoRender = normalizeVideoPath(data.outputPath);
                lastVideoProbe = null;
              }
            } catch {}
          }
          if (action === "probe") {
            try {
              const data = JSON.parse(result.content);
              const probedPath = typeof data.outputPath === "string"
                ? normalizeVideoPath(data.outputPath)
                : "";
              if (
                data.ok === true &&
                data.valid === true &&
                probedPath &&
                probedPath === lastVideoRender &&
                data.metadata?.formatName &&
                Number.isFinite(data.metadata.durationSeconds)
              ) {
                lastVideoProbe = `valid ${data.metadata.formatName} container, ${data.metadata.durationSeconds}s`;
              }
            } catch {}
          }
        }
        console.log(
          `[OBSERVE] ${result.isError ? "ERROR " : ""}${preview}`,
        );
      },
      shouldStop(state) {
        if (lastVideoRender && lastVideoProbe) {
          state.finalSummary = `Created and validated the requested video: ${lastVideoRender} (${lastVideoProbe}).`;
          state.successfulStop = true;
          return true;
        }
        return false;
      },
      persistTurn(turn: Turn, state) {
        lastMessages = [...state.messages];
        lastTurn = turn.index;
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = {
      stopped: "runner_error",
      turns: lastTurn,
      messages: [
        ...lastMessages,
        { role: "assistant", content: `NOVA orchestration failed: ${message}` },
      ],
      finalSummary: `NOVA orchestration failed: ${message}`,
    };
  }

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

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;

if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
}

function normalizeVideoPath(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/")).replace(/^\.\//, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
