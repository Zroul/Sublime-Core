import type { LlmClient, Message, ToolCall, ToolSpec } from "../reasoning/types.js";

interface OllamaResponse {
  message?: {
    content?: string;
    tool_calls?: Array<{
      function: {
        name: string;
        arguments: Record<string, unknown> | string;
      };
    }>;
  };
  error?: string;
}

export class OllamaProvider implements LlmClient {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(
    model = process.env.OLLAMA_MODEL ?? "qwen3:8b",
    baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  ) {
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async complete(input: {
    system: string;
    messages: Message[];
    tools: ToolSpec[];
  }): Promise<{ text?: string; toolCalls?: ToolCall[] }> {
    const messages = [
      { role: "system", content: input.system },
      ...input.messages.map((message) => {
        if (message.role === "assistant") {
          return {
            role: "assistant",
            content: message.content ?? "",
            ...(message.toolCalls?.length
              ? {
                  tool_calls: message.toolCalls.map((call) => ({
                    function: {
                      name: call.name,
                      arguments: call.arguments,
                    },
                  })),
                }
              : {}),
          };
        }

        if (message.role === "tool") {
          return {
            role: "tool",
            content: message.content ?? "",
          };
        }

        return {
          role: message.role,
          content: message.content ?? "",
        };
      }),
    ];

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages,
        tools: input.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
      }),
    });

    const data = (await response.json()) as OllamaResponse;

    if (!response.ok) {
      throw new Error(
        data.error ?? `Ollama request failed with HTTP ${response.status}.`,
      );
    }

    const calls: ToolCall[] = (data.message?.tool_calls ?? []).map(
      (call, index) => ({
        id: `ollama-${Date.now()}-${index}`,
        name: call.function.name,
        arguments:
          typeof call.function.arguments === "string"
            ? JSON.parse(call.function.arguments)
            : call.function.arguments,
      }),
    );

    return {
      text: data.message?.content ?? "",
      toolCalls: calls,
    };
  }
}
