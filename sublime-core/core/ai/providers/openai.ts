import OpenAI from "openai";
import type {
  LlmClient,
  Message,
  ToolSpec,
} from "../reasoning/types.js";

export class OpenAIProvider implements LlmClient {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "gpt-5.6-luna") {
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
        role: message.role === "tool" ? "user" : message.role,
        content: message.content ?? "",
      })),
    });

    return {
      text: response.output_text,
      toolCalls: [],
    };
  }
}