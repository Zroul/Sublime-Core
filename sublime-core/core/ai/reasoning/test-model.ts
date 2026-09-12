import type {
  LlmClient,
  Message,
  ToolSpec,
} from "./types.js";

export class TestModel implements LlmClient {
  async complete(input: {
    system: string;
    messages: Message[];
    tools: ToolSpec[];
  }) {
    const hasCreatedFile = input.messages.some(
      (message) =>
        message.role === "tool" &&
        message.name === "create_file"
    );

    const hasListedFiles = input.messages.some(
      (message) =>
        message.role === "tool" &&
        message.name === "list_files"
    );

    const hasRunCommand = input.messages.some(
      (message) =>
        message.role === "tool" &&
        message.name === "run_command"
    );

    if (!hasCreatedFile) {
      return {
        text: "I will create the website file.",
        toolCalls: [
          {
            id: "test-create-index",
            name: "create_file",
            arguments: {
              path: "test-site/index.html",
              content:
                "<!DOCTYPE html>\n<html>\n<head>\n<title>Sublime Core</title>\n</head>\n<body>\n<h1>Hello from Sublime Core</h1>\n</body>\n</html>",
            },
          },
        ],
      };
    }

    if (!hasListedFiles) {
      return {
        text: "The website file exists. I will inspect the workspace.",
        toolCalls: [
          {
            id: "test-list-files",
            name: "list_files",
            arguments: {},
          },
        ],
      };
    }

    if (!hasRunCommand) {
      return {
        text: "The files are present. I will run a command to verify the workspace.",
        toolCalls: [
          {
            id: "test-run-command",
            name: "run_command",
            arguments: {
              command: "node",
              args: [
                "-e",
                "console.log('Sublime Core command tool works!')",
              ],
            },
          },
        ],
      };
    }

    return {
      text: "The test website and command tool both work successfully.",
      toolCalls: [
        {
          id: "test-task-done",
          name: "task_done",
          arguments: {
            summary:
              "Created the test website, inspected the workspace, and successfully ran a Node command.",
          },
        },
      ],
    };
  }
}