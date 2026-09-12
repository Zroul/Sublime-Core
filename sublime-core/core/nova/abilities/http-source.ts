import type { NovaAbilityContext, SourceDocument } from "./types.js";

const MAX_SOURCE_CHARS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

export async function fetchSource(
  url: string,
  _context: NovaAbilityContext,
): Promise<SourceDocument> {
  const parsed = new URL(url);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Source fetch only supports HTTP and HTTPS URLs.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(parsed, {
      headers: {
        "User-Agent": "Sublime-Core-NOVA/1.0",
        Accept: "text/html,text/plain,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Source fetch failed with HTTP ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/") && !contentType.includes("html")) {
      throw new Error(`Unsupported source type: ${contentType || "unknown"}.`);
    }

    const html = await response.text();
    const text = htmlToText(html).slice(0, MAX_SOURCE_CHARS).trim();

    if (!text) {
      throw new Error("Source returned no readable text.");
    }

    return {
      url: parsed.toString(),
      title: extractTitle(html) || parsed.hostname,
      text,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Source fetch timed out after ${REQUEST_TIMEOUT_MS}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1].replace(/<[^>]+>/g, "").trim()) : "";
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>(?=.)/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );
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
