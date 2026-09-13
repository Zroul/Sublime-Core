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

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the public web for current information. Use this for news, trends, research, recent events, and facts that may have changed. Return a small set of useful results.",
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
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Sublime Core NOVA)",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Web search failed with HTTP ${response.status}.`);
    }

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
  },
};
