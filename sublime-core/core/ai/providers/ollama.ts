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
    model = process.env.OLLAMA_MODEL ?? "core",
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
            content: message.isError
              ? `Tool error: ${message.content ?? ""}`
              : message.content ?? "",
            ...(message.name ? { tool_name: message.name } : {}),
          };
        }

        return {
          role: message.role,
          content: message.content ?? "",
        };
      }),
    ];

    const attempts = 3;
    const timeoutMs = 120_000;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            stream: false,
            think: false,
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
          signal: AbortSignal.timeout(timeoutMs),
        });

        const data = (await response.json()) as OllamaResponse;

        if (!response.ok) {
          throw new Error(
            data.error ??
              `Ollama request failed with HTTP ${response.status}.`,
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
      } catch (error) {
        lastError = error;

        if (attempt === attempts) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }

    const message =
      lastError instanceof Error
        ? lastError.message
        : String(lastError);

    throw new Error(
      `Local Ollama request failed after ${attempts} attempts: ${message}`,
    );
  }
}
