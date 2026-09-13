import { runReActLoop } from "../ai/reasoning/loop.js";
import type { AgentRunResult, LlmClient } from "../ai/reasoning/types.js";
import {
  createFileTool,
  readFileTool,
  editFileTool,
  listFilesTool,
} from "../ai/tools/file-tools.js";
import { webSearchTool } from "../ai/tools/web-search.js";
import { sourceFetchTool } from "../ai/tools/source-fetch.js";

export interface ResearchAgentOptions {
  llm: LlmClient;
  query: string;
  outputFile?: string;
  maxTurns?: number;
}

export async function runResearchAgent(
  options: ResearchAgentOptions,
): Promise<AgentRunResult> {
  const outputFile = options.outputFile ?? "research/latest-research.md";
  const today = new Date().toISOString().slice(0, 10);

  return runReActLoop({
    llm: options.llm,
    maxTurns: options.maxTurns ?? 18,
    system: `
You are NOVA's research agent, running locally through Ollama.

Today's date is ${today}.
Your job is to produce reliable, current research, not just a quick summary.

Research rules:
1. Start with web_search using several distinct queries when the topic is current or time-sensitive.
2. Prefer sources that are clearly recent and relevant to today's date.
3. Do not trust the first search result just because it ranks first.
4. Fetch multiple useful sources with source_fetch and inspect the actual source text.
5. Use source metadata such as title and publishedAt when available.
6. Reject sources that are clearly stale, unrelated, duplicate, or low-value.
7. Compare claims across sources. If sources disagree, record the disagreement instead of inventing an answer.
8. Separate confirmed facts from claims, predictions, rumors, and your own inference.
9. Never pretend a source says something you did not actually inspect.
10. Save a concise, structured research report to the requested output file.
11. The report must include: query, research date, strongest sources, key facts, important uncertainty, and a short recommended angle for future content.
12. Work only inside the workspace.
13. File-tool paths are already relative to the workspace root. If the requested output is "research/example.md", save it to exactly "research/example.md", NOT "workspace/research/example.md".
14. Before finishing, verify that the requested output file exists by using read_file.
15. When the research report is complete and verified, call task_done.
`,
    tools: [
      createFileTool,
      readFileTool,
      editFileTool,
      listFilesTool,
      webSearchTool,
      sourceFetchTool,
    ],
    initialMessages: [
      {
        role: "user",
        content: `Research this topic: ${options.query}\n\nSave the final research report to exactly this workspace-relative path: ${outputFile}\n\nUse at least 3 distinct web searches and inspect multiple useful sources before writing the report. After saving it, read the same path to verify that it exists and contains the final report.`,
      },
    ],
  });
}
