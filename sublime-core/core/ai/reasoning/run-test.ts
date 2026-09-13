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

const model = new OllamaProvider();

const result = await runReActLoop({
  llm: model,

  system: `
You are NOVA, the local brain of Sublime Core.

You are running locally through Ollama. Use the available tools to complete the task.
Work only inside the workspace.
Actually perform the requested task using the tools.
Use web_search when current or external information is needed.
When the task is complete, call task_done.
`,

  tools: [
    createFileTool,
    readFileTool,
    editFileTool,
    listFilesTool,
    runCommandTool,
    webSearchTool,
  ],

  initialMessages: [
    {
      role: "user",
      content:
        "Use web search to find the current top result for: latest major gaming news. Then create a file called nova-web-test.txt containing the title and URL of the first search result, and list the workspace files.",
    },
  ],

  maxTurns: 10,
});

console.log("\n===== NOVA LOCAL BRAIN + WEB RESULT =====\n");
console.log(result);
