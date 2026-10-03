/**
 * A tiny registry mapping tool names to {@link Tool} definitions. Distilled
 * from the automaton's tool-catalog pattern (register / lookup / serialize),
 * with all project-specific coupling removed.
 */

import type { Tool, ToolSpec } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertSchema(schema: unknown, label: string): asserts schema is Record<string, unknown> {
  if (!isRecord(schema)) throw new Error(`${label} must be a JSON Schema object.`);

  const validTypes = new Set([
    "object", "array", "string", "number", "integer", "boolean", "null",
  ]);
  if (typeof schema.type === "string" && !validTypes.has(schema.type)) {
    throw new Error(`${label}.type is unsupported: ${schema.type}.`);
  }
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
    throw new Error(`${label}.enum must be an array.`);
  }
  if (schema.required !== undefined && !Array.isArray(schema.required)) {
    throw new Error(`${label}.required must be an array.`);
  }
  if (schema.properties !== undefined && !isRecord(schema.properties)) {
    throw new Error(`${label}.properties must be an object.`);
  }
  if (schema.items !== undefined) assertSchema(schema.items, `${label}.items`);

  if (isRecord(schema.properties)) {
    for (const [key, property] of Object.entries(schema.properties)) {
      assertSchema(property, `${label}.properties.${key}`);
    }
    for (const required of Array.isArray(schema.required) ? schema.required : []) {
      if (typeof required !== "string" || !(required in schema.properties)) {
        throw new Error(`${label}.required references an undefined property.`);
      }
    }
  }
}

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
    if (!tool.name.trim()) throw new Error("Tool name cannot be empty.");
    if (!tool.description.trim()) throw new Error(`Tool "${tool.name}" needs a description.`);
    if (typeof tool.handler !== "function") throw new Error(`Tool "${tool.name}" needs a handler.`);
    assertSchema(tool.parameters, `Tool "${tool.name}" parameters`);
    if (tool.parameters.type !== "object" || !isRecord(tool.parameters.properties)) {
      throw new Error(`Tool "${tool.name}" parameters must define an object schema with properties.`);
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
