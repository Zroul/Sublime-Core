import type {
  NovaAbilityContext,
  NovaAbilities,
  SourceDocument,
  WebSearchResult,
} from "./abilities/types.js";

export interface ResearchRecord {
  query: string;
  searchedAt: string;
  results: WebSearchResult[];
  sources: SourceDocument[];
  errors: string[];
}

export async function collectResearch(
  query: string,
  abilities: NovaAbilities,
  context: NovaAbilityContext,
): Promise<ResearchRecord> {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    throw new Error("Research query cannot be empty.");
  }

  const searchedAt = new Date().toISOString();
  const results: WebSearchResult[] = [];
  const sources: SourceDocument[] = [];
  const errors: string[] = [];

  if (!abilities.webSearch) {
    errors.push("Web search ability is not configured.");
  } else {
    try {
      results.push(...(await abilities.webSearch(cleanQuery, context)));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (!abilities.sourceFetch) {
    errors.push("Source fetch ability is not configured.");
  } else {
    const uniqueUrls = [...new Set(results.map((result) => result.url))];
    for (const url of uniqueUrls) {
      try {
        sources.push(await abilities.sourceFetch(url, context));
      } catch (error) {
        errors.push(
          `${url}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return {
    query: cleanQuery,
    searchedAt,
    results,
    sources,
    errors,
  };
}
