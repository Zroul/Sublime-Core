import type { AgentState, Tool, ToolResult } from "../reasoning/types.js";

type VisualScene = {
  duration: number;
  purpose: string;
  visual: string;
  source_query?: string;
  narration?: string;
  caption?: string;
};

export const visualPlannerTool: Tool = {
  name: "visual_planner",
  description:
    "Converts a script into a concrete, meaningful visual plan for faceless AI/tech videos. Each scene must explain what the viewer should see, why it is there, and optionally what asset/search query is needed. Use this before editing_module for real content production. It plans visuals; it does not download or render media.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "string",
        enum: ["build_visual_plan"],
      },
      scenes: {
        type: "array",
        minItems: 1,
        maxItems: 60,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            duration: { type: "number", minimum: 0.5, maximum: 120 },
            purpose: { type: "string", minLength: 1, maxLength: 240 },
            visual: { type: "string", minLength: 1, maxLength: 500 },
            source_query: { type: "string", maxLength: 300 },
            narration: { type: "string", maxLength: 1200 },
            caption: { type: "string", maxLength: 300 },
          },
          required: ["duration", "purpose", "visual"],
        },
      },
    },
    required: ["action", "scenes"],
  },

  handler(args: Record<string, unknown>, _ctx: AgentState): ToolResult | string {
    try {
      if (args.action !== "build_visual_plan") {
        throw new Error("Unsupported visual_planner action.");
      }

      if (!Array.isArray(args.scenes) || args.scenes.length === 0) {
        throw new Error("scenes must contain at least one scene.");
      }

      let totalDuration = 0;
      const scenes = args.scenes.map((raw, index) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          throw new Error(`Scene ${index + 1} must be an object.`);
        }

        const scene = raw as Record<string, unknown>;
        const duration = Number(scene.duration);
        const purpose = String(scene.purpose ?? "").trim();
        const visual = String(scene.visual ?? "").trim();

        if (!Number.isFinite(duration) || duration < 0.5 || duration > 120) {
          throw new Error(`Scene ${index + 1} duration must be 0.5-120 seconds.`);
        }
        if (!purpose || !visual) {
          throw new Error(`Scene ${index + 1} requires purpose and visual.`);
        }

        totalDuration += duration;

        const result: Record<string, unknown> = {
          index: index + 1,
          duration,
          purpose,
          visual,
        };

        for (const key of ["source_query", "narration", "caption"]) {
          const value = typeof scene[key] === "string" ? scene[key].trim() : "";
          if (value) result[key] = value;
        }

        return result;
      });

      if (totalDuration > 1800) {
        throw new Error("Visual plan cannot exceed 30 minutes.");
      }

      return JSON.stringify({
        ok: true,
        action: "build_visual_plan",
        scene_count: scenes.length,
        total_duration: Number(totalDuration.toFixed(3)),
        visual_plan: {
          type: "nova_visual_plan_v1",
          scenes,
        },
        next_step:
          "Resolve source_query assets with web research/search where needed, then pass meaningful scene decisions into editing_module.",
      });
    } catch (error) {
      return {
        toolCallId: "",
        isError: true,
        content: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
