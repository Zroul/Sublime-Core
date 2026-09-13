import { runReActLoop } from "./loop.js";
import { OllamaProvider } from "../providers/ollama.js";

import {
  createFileTool,
  readFileTool,
  editFileTool,
  listFilesTool,
} from "../tools/file-tools.js";

import { runCommandTool } from "../tools/command-tools.js";
import { webSearchTool } from "../tools/web-search.js";
import { sourceFetchTool } from "../tools/source-fetch.js";

const model = new OllamaProvider();

const result = await runReActLoop({
  llm: model,

  system: `
You are NOVA, the local brain of Sublime Core.

You are running locally through Ollama. Use the available tools to complete the task.
Work only inside the workspace.
Actually perform the requested task using the tools.
Use web_search when current or external information is needed.
Use source_fetch to inspect useful webpages returned by web_search.
Prefer checking the actual source instead of relying only on search snippets.
When the task is complete, call task_done.
`,

  tools: [
    createFileTool,
    readFileTool,
    editFileTool,
    listFilesTool,
    runCommandTool,
    webSearchTool,
    sourceFetchTool,
  ],

  initialMessages: [
    {
      role: "user",
      content:
        "Research the current latest major gaming news. First use web search to find useful results. Then fetch the first useful result and inspect its source text. Create a file called nova-source-test.txt containing the source title/URL if available and a concise summary of what the source says. Finally list the workspace files.",
    },
  ],

  maxTurns: 12,
});

console.log("\n===== NOVA LOCAL BRAIN + SOURCE RESEARCH RESULT =====\n");
console.log(result);
