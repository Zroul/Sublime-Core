/**
 * A tiny registry mapping tool names to {@link Tool} definitions. Distilled
 * from the automaton's tool-catalog pattern (register / lookup / serialize),
 * with all project-specific coupling removed.
 */

import type { Tool, ToolSpec } from "./types.js";

/**
 * Holds the set of tools available to the agent and serializes them into
 * {@link ToolSpec}s for the model.
 *
 * @typeParam Ctx - Type of the context passed to tool handlers.
 */
export class ToolRegistry<Ctx = unknown> {
  private readonly tools = new Map<string, Tool<Ctx>>();

  /** Optionally seed the registry with an initial list of tools. */
  constructor(tools?: Iterable<Tool<Ctx>>) {
    if (tools) {
      for (const tool of tools) this.register(tool);
    }
  }

  /**
   * Register a tool. Throws if a tool with the same name already exists —
   * duplicate names confuse tool-calling models, so this fails loudly.
   */
  register(tool: Tool<Ctx>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  /** Look up a tool by name. */
  get(name: string): Tool<Ctx> | undefined {
    return this.tools.get(name);
  }

  /** Whether a tool with the given name is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** All registered tools, in registration order. */
  list(): Tool<Ctx>[] {
    return [...this.tools.values()];
  }

  /** Serialize every tool into the {@link ToolSpec} form passed to the model. */
  toSpecs(): ToolSpec[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }
}
