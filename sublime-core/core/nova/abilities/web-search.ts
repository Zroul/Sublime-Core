import type {
  NovaAbilityContext,
  WebSearchResult,
} from "./types.js";

const SEARCH_URL = "https://html.duckduckgo.com/html/";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESULTS = 8;

/**
 * Lightweight search ability for NOVA.
 *
 * This is deliberately not an LLM or paid API. It retrieves public search
 * result pages, extracts result metadata, and leaves source verification to
 * sourceFetch(). Keep request volume low and respect the search provider's
 * terms and robots/rate-limit requirements.
 */
export async function webSearch(
  query: string,
  _context: NovaAbilityContext,
): Promise<WebSearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    throw new Error("Web search query cannot be empty.");
  }

  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", cleanQuery);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Sublime-Core-NOVA/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Web search failed with HTTP ${response.status}.`);
    }

    const html = await response.text();
    return parseResults(html).slice(0, MAX_RESULTS);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Web search timed out after ${REQUEST_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const pattern = /<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    const rawUrl = decodeEntities(match[1]);
    const title = cleanText(match[2]);
    const resultUrl = normalizeResultUrl(rawUrl);

    if (!resultUrl || !title) continue;

    results.push({
      title,
      url: resultUrl,
      snippet: findSnippet(html, match.index ?? 0),
    });
  }

  return dedupe(results);
}

function findSnippet(html: string, start: number): string {
  const tail = html.slice(start, start + 4000);
  const match = tail.match(/<a[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  return match ? cleanText(match[1]) : "";
}

function normalizeResultUrl(value: string): string | null {
  try {
    const parsed = new URL(value, SEARCH_URL);
    if (parsed.hostname.endsWith("duckduckgo.com")) {
      const target = parsed.searchParams.get("uddg");
      if (target) return new URL(target).toString();
    }
    return /^https?:$/.test(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function dedupe(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });
}

function cleanText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}
