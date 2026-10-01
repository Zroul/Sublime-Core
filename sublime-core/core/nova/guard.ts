import type { ToolCall } from "../ai/reasoning/types.js";

export interface NovaGuard {
  beforeToolCall(call: ToolCall): { block: boolean; reason?: string };
  recordResult(
    toolName: string,
    isError: boolean,
    toolArguments?: Record<string, unknown>,
  ): void;
}

export interface NovaGuardLimits {
  maxWebSearches: number;
  maxSourceFetches: number;
  maxCommands: number;
  maxFileWrites: number;
  maxIdenticalToolCalls: number;
  maxContentJobs: number;
  maxContentArtifactWrites: number;
  maxVideoEngineRuns: number;
}

const DEFAULT_LIMITS: NovaGuardLimits = {
  maxWebSearches: 6,
  maxSourceFetches: 8,
  maxCommands: 4,
  maxFileWrites: 20,
  maxIdenticalToolCalls: 3,
  maxContentJobs: 10,
  maxContentArtifactWrites: 20,
  maxVideoEngineRuns: 3,
};

function toolSignature(call: ToolCall): string {
  return JSON.stringify({
    name: call.name,
    arguments: call.arguments,
  });
}

function extractRequestedPaths(task: string): Set<string> {
  const matches = task.match(
    /(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+|[A-Za-z0-9_.-]+\.[A-Za-z0-9]+/g,
  );

  return new Set(
    (matches ?? []).map((value) => value.replaceAll("\\", "/")),
  );
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

export function createNovaGuard(
  task: string,
  limits: NovaGuardLimits = DEFAULT_LIMITS,
): NovaGuard {
  const taskText = task.toLowerCase();
  const requiresCreation =
    /\b(create|write|generate|build|make)\b/.test(taskText);
  const requiresVerification =
    /\b(verify|confirm|check|test|validate)\b/.test(taskText);

  const requestedPaths = extractRequestedPaths(task);

  const counts = new Map<string, number>();
  const successful = new Map<string, number>();
  const changedPaths = new Set<string>();
  const verifiedPaths = new Set<string>();
  const identical = new Map<string, number>();
  let successfulCreations = 0;
  let successfulVerifications = 0;
  let successfulEditingTimelines = 0;

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
            "NOVA guard blocked this action because the exact same tool call has already repeated too many times.",
        };
      }

      const requestsTimelineRender =
        /\b(render|timeline|scene|scenes|scene order|text overlay|background)\b/.test(taskText) &&
        /\b(video|mp4|movie|clip)\b/.test(taskText);

      if (
        requestsTimelineRender &&
        call.name === "video_engine" &&
        call.arguments?.action === "create_test"
      ) {
        return {
          block: true,
          reason:
            "NOVA guard blocked create_test because this task explicitly requests a rendered timeline/video with scenes, text, or backgrounds. Use video_engine action='render' and pass the requested scenes exactly.",
        };
      }

      if (
        requestsTimelineRender &&
        call.name === "video_engine" &&
        call.arguments?.action === "render" &&
        successfulEditingTimelines === 0
      ) {
        return {
          block: true,
          reason:
            "NOVA guard blocked video_engine render because this timeline task has not produced a successful editing_module timeline yet. Build and validate the timeline first.",
        };
      }

      if (call.name === "content_job" && count > limits.maxContentJobs) {
        return {
          block: true,
          reason: `NOVA guard: maximum content-job operations per run is ${limits.maxContentJobs}.`,
        };
      }

      if (call.name === "video_engine" && count > limits.maxVideoEngineRuns) {
        return {
          block: true,
          reason: `NOVA guard: maximum video-engine operations per run is ${limits.maxVideoEngineRuns}.`,
        };
      }

      if (call.name === "content_artifact" && count > limits.maxContentArtifactWrites) {
        return {
          block: true,
          reason: `NOVA guard: maximum content-artifact operations per run is ${limits.maxContentArtifactWrites}.`,
        };
      }

      if (call.name === "task_done") {
        const successfulWrites =
          (successful.get("create_file") ?? 0) +
          (successful.get("edit_file") ?? 0);

        if (requiresCreation && successfulWrites === 0 && successfulCreations === 0) {
          return {
            block: true,
            reason:
              "NOVA guard: the task asks for creation, but no file change has succeeded yet.",
          };
        }

        if (requestedPaths.size > 0) {
          const missingChanges = [...requestedPaths].filter(
            (filePath) => !changedPaths.has(normalizePath(filePath)),
          );

          if (missingChanges.length > 0) {
            return {
              block: true,
              reason:
                "NOVA guard: these requested file paths have not been successfully changed: " +
                missingChanges.join(", "),
            };
          }

          if (requiresVerification) {
            const missingVerification = [...requestedPaths].filter(
              (filePath) => !verifiedPaths.has(normalizePath(filePath)),
            );

            if (missingVerification.length > 0) {
              return {
                block: true,
                reason:
                  "NOVA guard: these requested file paths have not been individually verified: " +
                  missingVerification.join(", "),
              };
            }
          }
        } else if (
          requiresVerification &&
          verifiedPaths.size === 0 &&
          successfulVerifications === 0 &&
          (successful.get("list_files") ?? 0) === 0
        ) {
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

    recordResult(toolName, isError, toolArguments) {
      if (isError) return;

      successful.set(toolName, (successful.get(toolName) ?? 0) + 1);

      const filePath =
        typeof toolArguments?.path === "string"
          ? normalizePath(toolArguments.path)
          : undefined;

      if (
        filePath &&
        (toolName === "create_file" || toolName === "edit_file")
      ) {
        changedPaths.add(filePath);
      }

      if (filePath && (toolName === "read_file" || toolName === "verify_artifact")) {
        verifiedPaths.add(filePath);
        successfulVerifications += 1;
      }

      if (toolName === "editing_module" && toolArguments?.action === "build_timeline") {
        successfulEditingTimelines += 1;
      }

      if (toolName === "video_engine") {
        const action = toolArguments?.action;
        if (action === "create_test" || action === "render") {
          successfulCreations += 1;
        }
        if (action === "probe") {
          successfulVerifications += 1;
        }
      }

      if (toolName === "list_files") {
        successful.set("list_files", successful.get("list_files") ?? 0);
      }
    },
  };
}
