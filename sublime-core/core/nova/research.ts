import type {
  NovaAbilityContext,
  NovaAbilities,
  SourceDocument,
  WebSearchResult,
} from "./abilities/types.js";
import { withRetry } from "./retry.js";

export interface ResearchRecord {
  query: string;
  searchedAt: string;
  results: WebSearchResult[];
  sources: SourceDocument[];
  errors: string[];
  provenance: ResearchProvenance[];
}

export interface ResearchProvenance {
  url: string;
  title: string;
  snippet: string;
  fetchedAt?: string;
  status: "search_result" | "fetched" | "fetch_failed";
  error?: string;
}

export async function collectResearch(
  query: string,
  abilities: NovaAbilities,
  context: NovaAbilityContext,
): Promise<ResearchRecord> {
  const cleanQuery = query.trim();
  if (!cleanQuery) throw new Error("Research query cannot be empty.");

  const searchedAt = new Date().toISOString();
  const results: WebSearchResult[] = [];
  const sources: SourceDocument[] = [];
  const errors: string[] = [];
  const provenance: ResearchProvenance[] = [];

  if (!abilities.webSearch) {
    errors.push("Web search ability is not configured.");
  } else {
    try {
      results.push(...(await withRetry(
        () => abilities.webSearch!(cleanQuery, context),
        { attempts: 2, baseDelayMs: 400, maxDelayMs: 2_000 },
      )));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const result of results) {
    provenance.push({
      url: result.url,
      title: result.title,
      snippet: result.snippet,
      status: "search_result",
    });
  }

  if (!abilities.sourceFetch) {
    errors.push("Source fetch ability is not configured.");
  } else {
    const uniqueUrls = [...new Set(results.map((result) => result.url))];
    for (const url of uniqueUrls) {
      const result = results.find((item) => item.url === url);
      try {
        const source = await withRetry(
          () => abilities.sourceFetch!(url, context),
          { attempts: 2, baseDelayMs: 500, maxDelayMs: 2_500 },
        );
        sources.push(source);
        const item = provenance.find((entry) => entry.url === url);
        if (item) {
          item.status = "fetched";
          item.fetchedAt = source.fetchedAt;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${url}: ${message}`);
        provenance.push({
          url,
          title: result?.title ?? url,
          snippet: result?.snippet ?? "",
          status: "fetch_failed",
          error: message,
        });
      }
    }
  }

  return { query: cleanQuery, searchedAt, results, sources, errors, provenance };
}
