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
          minLength: 1,
          description: "A concise summary of what was accomplished.",
        },
      },

      required: ["summary"],
      additionalProperties: false,
    },

    handler: (args, state) => {
      const summary = typeof args.summary === "string" ? args.summary.trim() : "";
      if (!summary) {
        return {
          toolCallId: "",
          content: "task_done requires a non-empty completion summary.",
          isError: true,
        };
      }

      state.finalSummary = summary;
      state.successfulStop = true;

      return {
        toolCallId: "",
        content: `Task complete: ${summary}`,
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
      content: raw.trim() ? raw : "Tool returned an empty observation.",
      ...(raw.trim() ? {} : { isError: true }),
    };
  }

  if (!raw || typeof raw !== "object" || typeof raw.content !== "string") {
    throw new Error("Tool returned an invalid result; expected a string observation.");
  }

  return {
    ...raw,
    toolCallId,
    content: raw.content.trim()
      ? raw.content
      : "Tool returned an empty observation.",
    ...(raw.content.trim() ? {} : { isError: true }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function schemaError(
  value: unknown,
  schema: Record<string, unknown>,
  label: string,
): string | undefined {
  const type = schema.type;
  const validType =
    type === undefined ||
    (type === "object" && isRecord(value)) ||
    (type === "array" && Array.isArray(value)) ||
    (type === "string" && typeof value === "string") ||
    (type === "number" && typeof value === "number" && Number.isFinite(value)) ||
    (type === "integer" && typeof value === "number" && Number.isSafeInteger(value)) ||
    (type === "boolean" && typeof value === "boolean") ||
    (type === "null" && value === null);

  if (!validType) return `${label} must be ${String(type)}.`;

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    return `${label} must be one of: ${schema.enum.map(String).join(", ")}.`;
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      return `${label} must contain at least ${schema.minLength} characters.`;
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      return `${label} must contain at most ${schema.maxLength} characters.`;
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      return `${label} must be at least ${schema.minimum}.`;
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      return `${label} must be at most ${schema.maximum}.`;
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      return `${label} must contain at least ${schema.minItems} items.`;
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      return `${label} must contain at most ${schema.maxItems} items.`;
    }
    if (isRecord(schema.items)) {
      for (const [index, item] of value.entries()) {
        const error = schemaError(item, schema.items, `${label}[${index}]`);
        if (error) return error;
      }
    }
  }

  const properties = schema.properties;
  if (isRecord(value) && isRecord(properties)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const property of required) {
      if (typeof property === "string" && !(property in value)) {
        return `${label}.${property} is required.`;
      }
    }

    if (schema.additionalProperties === false) {
      const unexpected = Object.keys(value).find((key) => !(key in properties));
      if (unexpected) return `${label}.${unexpected} is not allowed.`;
    }

    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!(key in value) || !isRecord(propertySchema)) continue;
      const error = schemaError(value[key], propertySchema, `${label}.${key}`);
      if (error) return error;
    }
  }

  return undefined;
}

function modelResponseError(value: unknown): string | undefined {
  if (!isRecord(value)) return "Model response must be an object.";
  if (value.text !== undefined && typeof value.text !== "string") {
    return "Model response text must be a string.";
  }
  if (value.toolCalls !== undefined && !Array.isArray(value.toolCalls)) {
    return "Model response toolCalls must be an array.";
  }
  if (Array.isArray(value.toolCalls)) {
    for (const [index, call] of value.toolCalls.entries()) {
      if (
        !isRecord(call) ||
        typeof call.id !== "string" ||
        !call.id.trim() ||
        typeof call.name !== "string" ||
        !call.name.trim() ||
        !isRecord(call.arguments)
      ) {
        return `Model response toolCalls[${index}] must include a non-empty id, name, and object arguments.`;
      }
    }
  }
  return undefined;
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

  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1) {
    throw new Error("maxTurns must be a positive integer.");
  }

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
    successfulStop: state.successfulStop,
  });

  for (let turn = 1; turn <= maxTurns; turn++) {
    state.turn = turn;

    await hooks.buildContext?.(state);
    await hooks.onTurnStart?.(state);

    let rawResponse: unknown;
    try {
      rawResponse = await llm.complete({
        system,
        messages: state.messages,
        tools: registry.toSpecs(),
      });
    } catch (error) {
      const assistant: Message = {
        role: "assistant",
        content: `Model request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
      state.messages.push(assistant);
      const failedTurn: Turn = { index: turn, assistant, toolResults: [] };
      await hooks.persistTurn?.(failedTurn, state);
      await hooks.onTurnEnd?.(state);
      return finish("model_error", turn);
    }

    const responseError = modelResponseError(rawResponse);
    if (responseError) {
      const assistant: Message = {
        role: "assistant",
        content: `Malformed model response: ${responseError}`,
      };
      state.messages.push(assistant);
      const failedTurn: Turn = { index: turn, assistant, toolResults: [] };
      await hooks.persistTurn?.(failedTurn, state);
      await hooks.onTurnEnd?.(state);
      return finish("invalid_response", turn);
    }

    const response = rawResponse as { text?: string; toolCalls?: ToolCall[] };

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
          const argumentError = schemaError(call.arguments, tool.parameters, "args");
          if (argumentError) {
            result = {
              toolCallId: call.id,
              content: `Tool arguments rejected: ${argumentError}`,
              isError: true,
            };
          } else {
            try {
              const raw = await tool.handler(call.arguments, state);
              result = normalizeResult(raw, call.id);
            } catch (err) {
              result = {
                toolCallId: call.id,
                content: `Tool "${call.name}" threw: ${
                  err instanceof Error ? err.message : String(err)
                }`,
                isError: true,
              };
            }
          }

          if (call.name === stopToolName && !result.isError) {
            stopViaTool = true;
          }
        }
      }

      state.messages.push({
        role: "tool",
        content: result.content,
        toolCallId: call.id,
        name: call.name,
        ...(result.isError ? { isError: true } : {}),
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
