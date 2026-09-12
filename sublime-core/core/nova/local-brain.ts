import type { LocalBrain } from "./types.js";

export interface OllamaBrainOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

interface OllamaResponse {
  response?: string;
  error?: string;
}

export class OllamaBrain implements LocalBrain {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: OllamaBrainOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:11434").replace(/\/$/, "");
    this.model = options.model ?? "qwen3:8b";
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async complete(input: {
    system: string;
    prompt: string;
  }): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          system: input.system,
          prompt: input.prompt,
          stream: false,
        }),
        signal: controller.signal,
      });

      const data = (await response.json()) as OllamaResponse;

      if (!response.ok) {
        throw new Error(
          data.error ?? `Local brain request failed (${response.status}).`,
        );
      }

      if (typeof data.response !== "string") {
        throw new Error("Local brain returned no text response.");
      }

      return data.response;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Local brain timed out after ${this.timeoutMs}ms.`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
