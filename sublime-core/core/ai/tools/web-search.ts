import type { Tool } from "../reasoning/types.js";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;

  const message = error.message.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("socket")
  );
}

async function fetchWithRetry(url: string): Promise<Response> {
  const attempts = 3;
  const timeoutMs = 12_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Sublime Core NOVA)",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) return response;

      if (response.status >= 500 && attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        continue;
      }

      throw new Error(`Web search failed with HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt === attempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Web search failed after retries.");
}

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the public web for current information. Use this for news, trends, research, recent events, and facts that may have changed. Return a small set of useful results. Network failures should be reported cleanly so NOVA can continue with other searches.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The web search query.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const query = typeof args.query === "string" ? args.query.trim() : "";

    if (!query) {
      throw new Error("web_search requires a non-empty query.");
    }

    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    try {
      const response = await fetchWithRetry(url);
      const html = await response.text();
      const results: SearchResult[] = [];
      const pattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

      for (const match of html.matchAll(pattern)) {
        results.push({
          title: decodeHtml(match[2]),
          url: decodeHtml(match[1]),
          snippet: decodeHtml(match[3]),
        });

        if (results.length >= 8) break;
      }

      return JSON.stringify({
        query,
        resultCount: results.length,
        results,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        toolCallId: "",
        content: JSON.stringify({
          query,
          resultCount: 0,
          results: [],
          failed: true,
          error: `Web search temporarily unavailable: ${message}`,
        }),
        isError: true,
      };
    }
  },
};
