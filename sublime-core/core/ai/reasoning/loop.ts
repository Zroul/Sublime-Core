/**
 * The ReAct loop: **Think -> Act -> Observe** (Reasoning + Acting), repeated
 * until the agent signals completion, a guard stops it, or the turn budget is
 * spent.
 *
 * Architecture distilled from the MIT-licensed Conway-Research/automaton agent
 * loop, then freshly authored as a small dependency-injected core: bring your
 * own {@link LlmClient}, register {@link Tool}s, and drop in {@link AgentHooks}
 * for guardrails. No SQLite, no orchestration, no provider SDK — just the
 * control flow.
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

/** Options for {@link runReActLoop}. */
export interface RunReActLoopOptions<Ctx = unknown> {
  /** Your LLM adapter. */
  llm: LlmClient;
  /** Tools the agent may call — either a list or a prebuilt {@link ToolRegistry}. */
  tools: Tool<Ctx>[] | ToolRegistry<Ctx>;
  /** The system prompt for the run. */
  system: string;
  /** Seed conversation (e.g. the user's request). Defaults to `[]`. */
  initialMessages?: Message[];
  /** Lifecycle hooks for context injection, guardrails, and persistence. */
  hooks?: AgentHooks<Ctx>;
  /** Hard ceiling on turns before the loop force-stops. Defaults to `25`. */
  maxTurns?: number;
  /** Name of the tool that signals completion. Defaults to `"task_done"`. */
  stopToolName?: string;
  /** Arbitrary context passed to hooks and tool handlers via `state.context`. */
  context?: Ctx;
}

/**
 * Build the default stop tool. Its handler records a final summary on the
 * agent state; the loop stops once it is called.
 */
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
    },
    handler: (args, state) => {
      const summary = typeof args.summary === "string" ? args.summary : "";
      state.finalSummary = summary;
      return {
        toolCallId: "",
        content: summary ? `Task complete: ${summary}` : "Task complete.",
      };
    },
  };
}

/** Coerce a handler's return (string or {@link ToolResult}) into a ToolResult. */
function normalizeResult(
  raw: ToolResult | string,
  toolCallId: string,
): ToolResult {
  if (typeof raw === "string") {
    return { toolCallId, content: raw };
  }
  // Always stamp the real call id so handlers don't have to.
  return { ...raw, toolCallId };
}

/**
 * Run the ReAct (Reasoning + Acting) agent loop.
 *
 * Each turn:
 * 1. **Build context** — {@link AgentHooks.buildContext} may mutate messages.
 * 2. **Think** — call {@link LlmClient.complete}; append the assistant message.
 * 3. **Act** — for every requested tool call, run {@link AgentHooks.beforeToolCall}
 *    (a blocked call records an error observation and is skipped), otherwise
 *    execute the tool handler.
 * 4. **Observe** — append each result as a `tool` message and fire
 *    {@link AgentHooks.onToolResult}.
 * 5. **Persist** — hand the completed {@link Turn} to {@link AgentHooks.persistTurn}.
 *
 * The loop stops when the `stopToolName` tool is called, when
 * {@link AgentHooks.shouldStop} returns true, or when `maxTurns` is reached.
 *
 * @returns the stop reason, turn count, full message history, and final summary.
 */
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

  // Build a fresh registry so we never mutate a caller-owned one, and register
  // the built-in stop tool unless the caller already provided one by that name.
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

  const finish = (stopped: string, turns: number): AgentRunResult => ({
    stopped,
    turns,
    messages: state.messages,
    finalSummary: state.finalSummary,
  });

  for (let turn = 1; turn <= maxTurns; turn++) {
    state.turn = turn;

    // ── Build context (Think, prep) ──
    await hooks.buildContext?.(state);
    await hooks.onTurnStart?.(state);

    // ── Think ──
    const response = await llm.complete({
      system,
      messages: state.messages,
      tools: registry.toSpecs(),
    });

    const assistant: Message = {
      role: "assistant",
      content: response.text ?? "",
      ...(response.toolCalls && response.toolCalls.length > 0
        ? { toolCalls: response.toolCalls }
        : {}),
    };
    state.messages.push(assistant);

    // ── Act + Observe ──
    const toolResults: ToolResult[] = [];
    let stopViaTool = false;
    const calls: ToolCall[] = response.toolCalls ?? [];

    for (const call of calls) {
      const decision = await hooks.beforeToolCall?.(call, state);

      let result: ToolResult;
      if (decision && decision.block) {
        result = {
          toolCallId: call.id,
          content:
            decision.reason ?? `Tool "${call.name}" was blocked by a guard.`,
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
          if (call.name === stopToolName) stopViaTool = true;
        }
      }

      // Observe: append the result as a tool message for the next Think step.
      state.messages.push({
        role: "tool",
        content: result.content,
        toolCallId: call.id,
        name: call.name,
      });
      toolResults.push(result);
      await hooks.onToolResult?.(result, state);
    }

    // ── Persist ──
    const completedTurn: Turn = { index: turn, assistant, toolResults };
    await hooks.persistTurn?.(completedTurn);
    await hooks.onTurnEnd?.(state);

    // ── Stop conditions ──
    if (stopViaTool) return finish(stopToolName, turn);
    if (await hooks.shouldStop?.(state)) return finish("shouldStop", turn);
  }

  return finish("maxTurns", maxTurns);
}
