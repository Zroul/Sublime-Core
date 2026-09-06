import { runReActLoop } from "./loop.js";
import { TestModel } from "./test-model.js";
import { createFileTool } from "../tools/file-tools.js";

const model = new TestModel();

const result = await runReActLoop({
  llm: model,
  system: "You are Sublime Core.",
  tools: [createFileTool],
  initialMessages: [
    {
      role: "user",
      content: "Create a file called hello.txt containing Hello Sublime Core.",
    },
  ],
});

console.log(result);