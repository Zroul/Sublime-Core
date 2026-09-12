import { runReActLoop } from "./loop.js";
import { OpenAIProvider } from "../providers/openai.js";

import {
  createFileTool,
  readFileTool,
  editFileTool,
  listFilesTool,
} from "../tools/file-tools.js";

import { runCommandTool } from "../tools/command-tools.js";

const model = new OpenAIProvider();

const result = await runReActLoop({
  llm: model,

  system: `
You are Sublime Core, a private AI website builder.

Use the available tools to complete the user's task.
Work only inside the workspace.
Actually perform the requested task using the tools.
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
        "Create a file called live-test.txt containing exactly: Sublime Core is alive. Then list the files in the workspace.",
    },
  ],

  maxTurns: 10,
});

console.log("\n===== SUBLIME CORE RESULT =====\n");
console.log(result);