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
    const alreadyCreated = input.messages.some(
      (message) =>
        message.role === "tool" &&
        message.name === "create_file"
    );

    if (!alreadyCreated) {
      return {
        text: "I will create the requested file.",
        toolCalls: [
          {
            id: "test-create-file",
            name: "create_file",
            arguments: {
              path: "hello.txt",
              content: "Hello Sublime Core.",
            },
          },
        ],
      };
    }

    return {
      text: "The file has been created successfully.",
      toolCalls: [
        {
          id: "test-task-done",
          name: "task_done",
          arguments: {
            summary: "Created hello.txt successfully.",
          },
        },
      ],
    };
  }
}