import OpenAI from "openai";
import "dotenv/config";

import type {
  LlmClient,
  Message,
  ToolSpec,
} from "../reasoning/types.js";

export class OpenAIProvider implements LlmClient {
  private client: OpenAI;
  private model: string;

  constructor(
    apiKey: string = process.env.OPENAI_API_KEY ?? "",
    model = "gpt-5.6-luna"
  ) {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is missing.");
    }

    this.client = new OpenAI({
      apiKey,
    });

    this.model = model;
  }

  async complete(input: {
    system: string;
    messages: Message[];
    tools: ToolSpec[];
  }) {
    const response = await this.client.responses.create({
      model: this.model,
      instructions: input.system,

      input: input.messages.map((message) => ({
        role:
          message.role === "tool"
            ? "user"
            : message.role,
        content: message.content ?? "",
      })),

      tools: input.tools.map((tool) => ({
        type: "function" as const,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: true,
      })),

    });

    const toolCalls = response.output
      .filter((item) => item.type === "function_call")
      .map((item) => {
        if (item.type !== "function_call") {
          throw new Error("Unexpected response item.");
        }

        return {
          id: item.call_id,
          name: item.name,
          arguments: JSON.parse(item.arguments),
        };
      });

    return {
      text: response.output_text,
      toolCalls,
    };
  }
}