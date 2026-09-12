export interface NovaAbilityContext {
  jobId: string;
  topic: string;
  outputDir: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SourceDocument {
  url: string;
  title: string;
  text: string;
  fetchedAt: string;
}

export interface NovaAbilities {
  webSearch?(query: string, context: NovaAbilityContext): Promise<WebSearchResult[]>;
  sourceFetch?(url: string, context: NovaAbilityContext): Promise<SourceDocument>;
}
