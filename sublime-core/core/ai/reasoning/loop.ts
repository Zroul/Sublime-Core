/**
 * The ReAct loop: Think -> Act -> Observe
 */

import { ToolRegistry } from "./tool-registry.js";

import type {
  AgentHooks,
  AgentRunResult,
  AgentState,
  LlmClient,
  Message,
  Tool,
  ToolCall,
  ToolResult,
  Turn,
} from "./types.js";

export interface RunReActLoopOptions<Ctx = unknown> {
  llm: LlmClient;
  tools: Tool<Ctx>[] | ToolRegistry<Ctx>;
  system: string;
  initialMessages?: Message[];
  hooks?: AgentHooks<Ctx>;
  maxTurns?: number;
  stopToolName?: string;
  context?: Ctx;
}

export function createTaskDoneTool<Ctx = unknown>(
  name = "task_done",
): Tool<Ctx> {
  return {
    name,

    description:
      "Call this when the task is complete. Provide a concise summary of what " +
      "was accomplished. Calling this ends the run.",

    parameters: {
      type: "object",

      properties: {
        summary: {
          type: "string",
          description: "A concise summary of what was accomplished.",
        },
      },

      required: ["summary"],
      additionalProperties: false,
    },

    handler: (args, state) => {
      const summary =
        typeof args.summary === "string" ? args.summary : "";

      state.finalSummary = summary;

      return {
        toolCallId: "",
        content: summary
          ? `Task complete: ${summary}`
          : "Task complete.",
      };
    },
  };
}

function normalizeResult(
  raw: ToolResult | string,
  toolCallId: string,
): ToolResult {
  if (typeof raw === "string") {
    return {
      toolCallId,
      content: raw,
    };
  }

  return {
    ...raw,
    toolCallId,
  };
}

export async function runReActLoop<Ctx = unknown>(
  options: RunReActLoopOptions<Ctx>,
): Promise<AgentRunResult> {
  const {
    llm,
    tools,
    system,
    initialMessages = [],
    hooks = {},
    maxTurns = 25,
    stopToolName = "task_done",
    context,
  } = options;

  const registry = new ToolRegistry<Ctx>(
    tools instanceof ToolRegistry ? tools.list() : tools,
  );

  if (!registry.has(stopToolName)) {
    registry.register(createTaskDoneTool<Ctx>(stopToolName));
  }

  const state: AgentState<Ctx> = {
    messages: [...initialMessages],
    turn: 0,
    system,
    context,
  };

  const finish = (
    stopped: string,
    turns: number,
  ): AgentRunResult => ({
    stopped,
    turns,
    messages: state.messages,
    finalSummary: state.finalSummary,
  });

  for (let turn = 1; turn <= maxTurns; turn++) {
    state.turn = turn;

    await hooks.buildContext?.(state);
    await hooks.onTurnStart?.(state);

    const response = await llm.complete({
      system,
      messages: state.messages,
      tools: registry.toSpecs(),
    });

    const assistant: Message = {
      role: "assistant",
      content: response.text ?? "",
      ...(response.toolCalls &&
      response.toolCalls.length > 0
        ? {
            toolCalls: response.toolCalls,
          }
        : {}),
    };

    state.messages.push(assistant);

    const toolResults: ToolResult[] = [];
    let stopViaTool = false;

    const calls: ToolCall[] = response.toolCalls ?? [];

    for (const call of calls) {
      const decision =
        await hooks.beforeToolCall?.(call, state);

      let result: ToolResult;

      if (decision && decision.block) {
        result = {
          toolCallId: call.id,
          content:
            decision.reason ??
            `Tool "${call.name}" was blocked by a guard.`,
          isError: true,
        };
      } else {
        const tool = registry.get(call.name);

        if (!tool) {
          result = {
            toolCallId: call.id,
            content: `Unknown tool: ${call.name}`,
            isError: true,
          };
        } else {
          try {
            const raw = await tool.handler(
              call.arguments,
              state,
            );

            result = normalizeResult(raw, call.id);
          } catch (err) {
            result = {
              toolCallId: call.id,
              content: `Tool "${call.name}" threw: ${
                err instanceof Error
                  ? err.message
                  : String(err)
              }`,
              isError: true,
            };
          }

          if (call.name === stopToolName) {
            stopViaTool = true;
          }
        }
      }

      state.messages.push({
        role: "tool",
        content: result.content,
        toolCallId: call.id,
        name: call.name,
      });

      toolResults.push(result);

      await hooks.onToolResult?.(result, state);
    }

    const completedTurn: Turn = {
      index: turn,
      assistant,
      toolResults,
    };

    await hooks.persistTurn?.(completedTurn, state);
    await hooks.onTurnEnd?.(state);

    if (stopViaTool) {
      return finish(stopToolName, turn);
    }

    if (await hooks.shouldStop?.(state)) {
      return finish("shouldStop", turn);
    }
  }

  return finish("maxTurns", maxTurns);
}