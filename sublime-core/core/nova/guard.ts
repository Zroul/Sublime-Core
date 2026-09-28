import type { ToolCall } from "../ai/reasoning/types.js";

export interface NovaGuard {
  beforeToolCall(call: ToolCall): { block: boolean; reason?: string };
  recordResult(toolName: string, isError: boolean): void;
}

export interface NovaGuardLimits {
  maxWebSearches: number;
  maxSourceFetches: number;
  maxCommands: number;
  maxFileWrites: number;
  maxIdenticalToolCalls: number;
}

const DEFAULT_LIMITS: NovaGuardLimits = {
  maxWebSearches: 6,
  maxSourceFetches: 8,
  maxCommands: 4,
  maxFileWrites: 20,
  maxIdenticalToolCalls: 2,
};

function toolSignature(call: ToolCall): string {
  return JSON.stringify({
    name: call.name,
    arguments: call.arguments,
  });
}

export function createNovaGuard(
  task: string,
  limits: NovaGuardLimits = DEFAULT_LIMITS,
): NovaGuard {
  const taskText = task.toLowerCase();
  const requiresCreation =
    taskText.includes("create") ||
    taskText.includes("write") ||
    taskText.includes("generate");
  const requiresVerification =
    taskText.includes("verify") ||
    taskText.includes("confirm") ||
    taskText.includes("check");

  const counts = new Map<string, number>();
  const successful = new Map<string, number>();
  const identical = new Map<string, number>();

  return {
    beforeToolCall(call) {
      const count = (counts.get(call.name) ?? 0) + 1;
      counts.set(call.name, count);

      const signature = toolSignature(call);
      const sameCount = (identical.get(signature) ?? 0) + 1;
      identical.set(signature, sameCount);

      if (sameCount > limits.maxIdenticalToolCalls) {
        return {
          block: true,
          reason:
            "NOVA guard blocked this action because the exact same tool call has already failed or repeated too many times.",
        };
      }

      if (call.name === "task_done") {
        const hasFileChange =
          (successful.get("create_file") ?? 0) +
            (successful.get("edit_file") ?? 0) >
          0;
        const hasVerification =
          (successful.get("read_file") ?? 0) +
            (successful.get("list_files") ?? 0) >
          0;

        if (requiresCreation && !hasFileChange) {
          return {
            block: true,
            reason:
              "NOVA guard: the task asks for creation, but no file change has succeeded yet.",
          };
        }

        if (requiresVerification && !hasVerification) {
          return {
            block: true,
            reason:
              "NOVA guard: the task asks for verification, but no verification tool has succeeded yet.",
          };
        }
      }

      if (call.name === "web_search" && count > limits.maxWebSearches) {
        return {
          block: true,
          reason: `NOVA guard: maximum web searches per run is ${limits.maxWebSearches}.`,
        };
      }

      if (call.name === "source_fetch" && count > limits.maxSourceFetches) {
        return {
          block: true,
          reason: `NOVA guard: maximum source fetches per run is ${limits.maxSourceFetches}.`,
        };
      }

      if (call.name === "run_command" && count > limits.maxCommands) {
        return {
          block: true,
          reason: `NOVA guard: maximum commands per run is ${limits.maxCommands}.`,
        };
      }

      if (
        (call.name === "create_file" || call.name === "edit_file") &&
        count > limits.maxFileWrites
      ) {
        return {
          block: true,
          reason: `NOVA guard: maximum file writes per run is ${limits.maxFileWrites}.`,
        };
      }

      return { block: false };
    },

    recordResult(toolName, isError) {
      if (!isError) {
        successful.set(toolName, (successful.get(toolName) ?? 0) + 1);
      }
    },
  };
}
