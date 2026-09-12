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

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

export class OllamaBrain implements LocalBrain {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: OllamaBrainOptions = {}) {
    this.baseUrl = (
      options.baseUrl ?? process.env.NOVA_OLLAMA_URL ?? "http://127.0.0.1:11434"
    ).replace(/\/$/, "");
    this.model = options.model ?? process.env.NOVA_OLLAMA_MODEL ?? "qwen3:8b";
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  getModel(): string {
    return this.model;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async isReady(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async hasModel(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Ollama is not ready (HTTP ${response.status}).`);
      }

      const data = (await response.json()) as OllamaTagsResponse;
      return (data.models ?? []).some((model) => model.name === this.model);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Ollama is not ready")) throw error;
      throw new Error(`Cannot reach Ollama at ${this.baseUrl}: ${formatNetworkError(error)}`);
    }
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
        throw new Error(data.error ?? `Local brain request failed (HTTP ${response.status}).`);
      }

      if (typeof data.response !== "string") {
        throw new Error("Local brain returned no text response.");
      }

      return data.response;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Local brain timed out after ${this.timeoutMs}ms.`);
      }

      throw new Error(`Local brain request to ${this.baseUrl} failed: ${formatNetworkError(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function formatNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) return `${error.message} (${cause.message})`;
  return error.message || error.name;
}
