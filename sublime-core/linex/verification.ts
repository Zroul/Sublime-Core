import type { Message, ToolCall, ToolResult } from "../core/ai/reasoning/types.js";

export interface LinexVerificationGate {
  beforeToolCall(call: ToolCall): { block: boolean; reason?: string };
  recordToolResult(result: ToolResult, messages: Message[]): void;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function createLinexVerificationGate(task: string): LinexVerificationGate {
  const explicitlyReadOnly =
    /\b(?:do not|don't|without|no)\s+(?:make\s+)?(?:edits?|editing|changes?|changing|modifications?|writes?|writing|creations?)\b/i.test(task);
  const requiresChanges =
    !explicitlyReadOnly &&
    /\b(add|create|write|edit|modify|update|fix|implement|build|refactor|replace|rewrite|extend)\b/i.test(task);

  const changedFiles = new Set<string>();
  const verifiedFiles = new Set<string>();

  return {
    beforeToolCall(call) {
      if (call.name !== "task_done") return { block: false };

      if (requiresChanges && changedFiles.size === 0) {
        return {
          block: true,
          reason: "Completion blocked: this task requests a code change, but no file write has succeeded yet.",
        };
      }

      const missing = [...changedFiles].filter((file) => !verifiedFiles.has(file));
      if (missing.length > 0) {
        return {
          block: true,
          reason: "Completion blocked: re-read every changed file before finishing: " + missing.join(", "),
        };
      }

      return { block: false };
    },

    recordToolResult(result, messages) {
      if (result.isError) return;

      const assistant = [...messages].reverse().find((message) => message.role === "assistant");
      const call = assistant?.toolCalls?.find((item) => item.id === result.toolCallId);
      if (!call) return;

      const filePath = typeof call.arguments.path === "string"
        ? normalizePath(call.arguments.path)
        : "";
      if (!filePath) return;

      if (call.name === "obsidian_create_file" || call.name === "obsidian_edit_file") {
        changedFiles.add(filePath);
        verifiedFiles.delete(filePath);
      } else if (call.name === "obsidian_read_file" && changedFiles.has(filePath)) {
        verifiedFiles.add(filePath);
      }
    },
  };
}
