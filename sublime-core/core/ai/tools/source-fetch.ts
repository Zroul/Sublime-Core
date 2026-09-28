import type { Tool } from "../reasoning/types.js";

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMeta(html: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }

  return undefined;
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtml(match[1]) : undefined;
}

function extractPublishedAt(html: string): string | undefined {
  return (
    extractMeta(html, "article:published_time") ??
    extractMeta(html, "datePublished") ??
    extractMeta(html, "publish-date") ??
    extractMeta(html, "date")
  );
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

async function fetchWithRetry(url: URL): Promise<Response> {
  const attempts = 3;
  const timeoutMs = 15_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Sublime Core NOVA source reader)",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) return response;

      if (response.status >= 500 && attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        continue;
      }

      throw new Error(`Source fetch failed with HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Source fetch failed after retries.");
}

export const sourceFetchTool: Tool = {
  name: "source_fetch",
  description:
    "Fetch a public webpage and extract readable text plus metadata so NOVA can inspect and verify a research source. Network failures should be reported cleanly so NOVA can continue with other sources.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The public webpage URL to fetch.",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const url = typeof args.url === "string" ? args.url.trim() : "";

    if (!url) throw new Error("source_fetch requires a non-empty URL.");

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("source_fetch requires a valid URL.");
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("source_fetch only supports HTTP and HTTPS URLs.");
    }

    try {
      const response = await fetchWithRetry(parsed);
      const contentType = response.headers.get("content-type") ?? "";

      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
        return JSON.stringify({
          requestedUrl: url,
          finalUrl: response.url,
          status: response.status,
          failed: true,
          error: `Unsupported source content type: ${contentType || "unknown"}.`,
        });
      }

      const raw = await response.text();
      const text = contentType.includes("text/plain") ? raw.trim() : htmlToText(raw);
      const maxChars = 20_000;

      return JSON.stringify({
        requestedUrl: url,
        finalUrl: response.url,
        status: response.status,
        contentType,
        title: contentType.includes("text/html") ? extractTitle(raw) : undefined,
        publishedAt: contentType.includes("text/html") ? extractPublishedAt(raw) : undefined,
        truncated: text.length > maxChars,
        text: text.slice(0, maxChars),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        toolCallId: "",
        content: JSON.stringify({
          requestedUrl: url,
          failed: true,
          error: `Source fetch temporarily unavailable: ${message}`,
        }),
        isError: true,
      };
    }
  },
};
