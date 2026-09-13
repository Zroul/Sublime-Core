import type { Tool } from "../reasoning/types.js";

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

export const sourceFetchTool: Tool = {
  name: "source_fetch",
  description:
    "Fetch a public webpage and extract readable text so NOVA can inspect and research a source returned by web_search.",
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

    if (!url) {
      throw new Error("source_fetch requires a non-empty URL.");
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("source_fetch requires a valid URL.");
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error("source_fetch only supports HTTP and HTTPS URLs.");
    }

    const response = await fetch(parsed, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Sublime Core NOVA source reader)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      throw new Error(`Source fetch failed with HTTP ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new Error(`Unsupported source content type: ${contentType || "unknown"}.`);
    }

    const raw = await response.text();
    const text = contentType.includes("text/plain") ? raw.trim() : htmlToText(raw);
    const maxChars = 20_000;

    return JSON.stringify({
      requestedUrl: url,
      finalUrl: response.url,
      status: response.status,
      contentType,
      truncated: text.length > maxChars,
      text: text.slice(0, maxChars),
    });
  },
};
