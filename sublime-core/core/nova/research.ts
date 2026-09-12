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
  failedUrls: Array<{ url: string; error: string }>;
}

export async function collectResearch(
  query: string,
  context: NovaAbilityContext,
  abilities: NovaAbilities,
): Promise<ResearchRecord> {
  const searchedAt = new Date().toISOString();
  const results = abilities.webSearch
    ? await abilities.webSearch(query, context)
    : [];

  const sources: SourceDocument[] = [];
  const failedUrls: Array<{ url: string; error: string }> = [];

  if (abilities.sourceFetch) {
    for (const result of results) {
      try {
        sources.push(await abilities.sourceFetch(result.url, context));
      } catch (error) {
        failedUrls.push({
          url: result.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { query, searchedAt, results, sources, failedUrls };
}
