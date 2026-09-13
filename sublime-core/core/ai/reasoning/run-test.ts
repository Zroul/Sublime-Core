import { runReActLoop } from "./loop.js";
import { OllamaProvider } from "../providers/ollama.js";

import {
  createFileTool,
  readFileTool,
  editFileTool,
  listFilesTool,
} from "../tools/file-tools.js";

import { runCommandTool } from "../tools/command-tools.js";

const model = new OllamaProvider();

const result = await runReActLoop({
  llm: model,

  system: `
You are NOVA, the local brain of Sublime Core.

You are running locally through Ollama. Use the available tools to complete the task.
Work only inside the workspace.
Actually perform the requested task using the tools.
When the task is complete, call task_done.
`,

  tools: [
    createFileTool,
    readFileTool,
    editFileTool,
    listFilesTool,
    runCommandTool,
  ],

  initialMessages: [
    {
      role: "user",
      content:
        "Create a file called nova-live-test.txt containing exactly: NOVA local brain is alive. Then list the files in the workspace.",
    },
  ],

  maxTurns: 10,
});

console.log("\n===== NOVA LOCAL BRAIN RESULT =====\n");
console.log(result);
