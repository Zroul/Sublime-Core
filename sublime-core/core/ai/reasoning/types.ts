/**
 * Core types for `react-agent-loop`.
 *
 * ReAct here means **Reasoning + Acting** (Think -> Act -> Observe) — the agent
 * design pattern, NOT React.js. This module has zero runtime dependencies and
 * no ties to any LLM SDK; you bring your own provider by implementing
 * {@link LlmClient}.
 */

/** Role of a conversation message, matching the common chat-completions shape. */
export type Role = "system" | "user" | "assistant" | "tool";

/**
 * A single conversation message.
 *
 * - `assistant` messages may carry {@link Message.toolCalls} when the model
 *   decided to act.
 * - `tool` messages carry {@link Message.toolCallId} identifying which call
 *   they answer (the "Observe" step).
 */
export interface Message {
  role: Role;
  /** Text content. Empty string when an assistant turn is pure tool calls. */
  content: string;
  /** Present on assistant messages that requested one or more tool calls. */
  toolCalls?: ToolCall[];
  /** Present on `tool` messages: the id of the {@link ToolCall} being answered. */
  toolCallId?: string;
  /** Optional tool name, convenient for `tool` messages and logging. */
  name?: string;
}

/** A request from the model to run a tool. */
export interface ToolCall {
  /** Provider-assigned id; echoed back on the matching {@link ToolResult}. */
  id: string;
  /** Name of the tool to invoke; must match a registered {@link Tool.name}. */
  name: string;
  /** Parsed arguments object (already JSON-decoded). */
  arguments: Record<string, unknown>;
}

/** The outcome of running a tool — the "Observe" input for the next turn. */
export interface ToolResult {
  /** Id of the {@link ToolCall} this answers. The loop fills this in for you. */
  toolCallId: string;
  /** Textual observation handed back to the model. */
  content: string;
  /** True when the tool failed or was blocked by a guard. */
  isError?: boolean;
}

/**
 * The JSON-schema-ish tool description passed to the model. This is what
 * {@link ToolRegistry.toSpecs} produces and what {@link LlmClient.complete}
 * receives — map it to your provider's tool/function-calling format.
 */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema object describing the tool's arguments. */
  parameters: Record<string, unknown>;
}

/**
 * A tool the agent can call.
 *
 * @typeParam Ctx - Type of the user-supplied context on {@link AgentState.context}.
 */
export interface Tool<Ctx = unknown> {
  name: string;
  description: string;
  /** JSON Schema object for the arguments the model must supply. */
  parameters: Record<string, unknown>;
  /**
   * Run the tool. Return either a {@link ToolResult} or a plain string
   * (wrapped into a successful result). The loop overrides `toolCallId`, so
   * you may leave it blank. Receives the live {@link AgentState} as context.
   */
  handler(
    args: Record<string, unknown>,
    ctx: AgentState<Ctx>,
  ): Promise<ToolResult | string> | ToolResult | string;
}

/**
 * The LLM adapter you implement over your provider of choice (OpenAI,
 * Anthropic, a local model, ...). The library never imports an SDK; it only
 * calls this one method.
 */
export interface LlmClient {
  /**
   * Produce the next assistant step from the current conversation.
   *
   * @returns `text` (the model's reasoning / reply) and/or `toolCalls` (the
   * actions it wants to take). Return neither to signal a natural pause.
   */
  complete(input: {
    system: string;
    messages: Message[];
    tools: ToolSpec[];
  }): Promise<{ text?: string; toolCalls?: ToolCall[] }>;
}

/** Live state threaded through hooks and tool handlers during a run. */
export interface AgentState<Ctx = unknown> {
  /** The growing conversation. Hooks may read or mutate this before a call. */
  messages: Message[];
  /** Current turn number, 1-based. */
  turn: number;
  /** The system prompt in effect for this run. */
  system: string;
  /** Set when the stop tool records a final summary. */
  finalSummary?: string;
  /** Arbitrary user context, passed straight through from run options. */
  context?: Ctx;
}

/** One completed iteration of the loop: the assistant step plus its observations. */
export interface Turn {
  /** 1-based turn number. */
  index: number;
  /** The assistant message produced this turn (may include tool calls). */
  assistant: Message;
  /** Results of every tool call in this turn (including blocked ones). */
  toolResults: ToolResult[];
}

/** Return value of {@link AgentHooks.beforeToolCall} to gate a tool call. */
export interface BeforeToolCallDecision {
  /** When true, the tool is not executed and a blocked result is recorded. */
  block: boolean;
  /** Optional explanation surfaced to the model as the blocked observation. */
  reason?: string;
}

/**
 * Optional lifecycle hooks. This is the seam for guardrails: plug a loop
 * detector, budget guard, or policy engine into {@link AgentHooks.beforeToolCall}.
 * Every hook may be sync or async.
 */
export interface AgentHooks<Ctx = unknown> {
  /** Runs before each LLM call. Mutate `state.messages` here to inject context. */
  buildContext?(state: AgentState<Ctx>): void | Promise<void>;
  /** Runs at the start of each turn, after context is built. */
  onTurnStart?(state: AgentState<Ctx>): void | Promise<void>;
  /**
   * Runs before each tool executes. Return `{ block: true, reason }` to skip
   * the call and record a blocked observation instead.
   */
  beforeToolCall?(
    call: ToolCall,
    state: AgentState<Ctx>,
  ):
    | BeforeToolCallDecision
    | void
    | Promise<BeforeToolCallDecision | void>;
  /** Runs after each tool result (or blocked result) is recorded. */
  onToolResult?(result: ToolResult, state: AgentState<Ctx>): void | Promise<void>;
  /** Runs at the end of each turn, after persistence. */
  onTurnEnd?(state: AgentState<Ctx>): void | Promise<void>;
  /** Return true to stop the loop after the current turn. */
  shouldStop?(state: AgentState<Ctx>): boolean | Promise<boolean>;
  /** Persist a completed turn (e.g. to a DB). Failures should be handled inside. */
  persistTurn?(turn: Turn): void | Promise<void>;
}

/** Why the loop stopped. */
export type StopReason = "task_done" | "shouldStop" | "maxTurns";

/** The result of a completed {@link runReActLoop} run. */
export interface AgentRunResult {
  /**
   * Reason the loop ended. When stopped via the stop tool this is the
   * `stopToolName` value (default `"task_done"`); otherwise `"shouldStop"`
   * or `"maxTurns"`.
   */
  stopped: StopReason | string;
  /** Number of turns actually executed. */
  turns: number;
  /** The full final conversation, including tool observations. */
  messages: Message[];
  /** Summary recorded by the stop tool, if any. */
  finalSummary?: string;
}
