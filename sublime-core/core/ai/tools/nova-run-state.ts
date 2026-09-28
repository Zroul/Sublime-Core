import type { Tool } from "../reasoning/types.js";
import {
  listNovaRunStates,
  loadNovaRunState,
} from "../../nova/run-state.js";

export const novaRunStateTool: Tool = {
  name: "nova_run_state",
  description:
    "Inspect durable NOVA run checkpoints. Use list to see recent runs or read to inspect one run by ID. Checkpoints are observational state, not permission to resume automatically.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "read"],
        description: "List recent run checkpoints or read one checkpoint.",
      },
      runId: {
        type: "string",
        description: "Exact run ID returned by list.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  async handler(input) {
    const action = String(input.action ?? "list");

    if (action === "list") {
      const states = await listNovaRunStates();
      return JSON.stringify(
        states.slice(0, 10).map((state) => ({
          runId: state.runId,
          status: state.status,
          turn: state.turn,
          updatedAt: state.updatedAt,
          task: state.task,
          stopped: state.stopped,
        })),
      );
    }

    if (action !== "read") {
      return {
        toolCallId: "",
        content: "nova_run_state action must be list or read.",
        isError: true,
      };
    }

    const runId = String(input.runId ?? "").trim();
    if (!runId) {
      return {
        toolCallId: "",
        content: "nova_run_state read requires an exact runId.",
        isError: true,
      };
    }

    const state = await loadNovaRunState(runId);
    if (!state) {
      return {
        toolCallId: "",
        content: "Run checkpoint not found: " + runId,
        isError: true,
      };
    }

    return JSON.stringify({
      runId: state.runId,
      task: state.task,
      status: state.status,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      turn: state.turn,
      stopped: state.stopped,
      finalSummary: state.finalSummary,
      messageCount: state.messages.length,
      lastMessages: state.messages.slice(-6),
    });
  },
};
