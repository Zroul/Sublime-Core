import type { AgentState, Tool, ToolResult } from "../reasoning/types.js";

type EditScene = {
  duration: number;
  background?: string;
  text?: string;
};

const COLORS = new Set([
  "black",
  "white",
  "red",
  "green",
  "blue",
  "yellow",
  "cyan",
  "magenta",
  "gray",
  "grey",
]);

function isHexColor(value: string): boolean {
  return /^[0-9a-fA-F]{6}$/.test(value);
}

function validateBackground(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (COLORS.has(normalized) || isHexColor(normalized)) return normalized;
  throw new Error(
    `Unsupported background "${value}". Use a named color or a 6-digit hex color.`,
  );
}

function asFiniteNumber(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return number;
}

export const editingModuleTool: Tool = {
  name: "editing_module",
  description:
    "Builds a deterministic, normalized timeline for NOVA's faceless AI/tech video workflow. Use this before video_engine for multi-scene videos. It validates scene order, durations, backgrounds, text overlays, total duration, and aspect ratio, then returns a render-ready timeline. This is the editing planning layer, not the final renderer.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "string",
        enum: ["build_timeline"],
        description: "Build a normalized editing timeline.",
      },
      aspect_ratio: {
        type: "string",
        enum: ["16:9", "9:16", "1:1"],
        description: "Output framing for the content.",
      },
      scenes: {
        type: "array",
        minItems: 1,
        maxItems: 60,
        description:
          "Ordered scenes. Each scene has duration in seconds and may include a background and text overlay.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            duration: {
              type: "number",
              minimum: 0.1,
              maximum: 120,
            },
            background: {
              type: "string",
            },
            text: {
              type: "string",
              maxLength: 500,
            },
          },
          required: ["duration"],
        },
      },
    },
    required: ["action", "scenes"],
  },

  handler(args: Record<string, unknown>, _ctx: AgentState): ToolResult | string {
    try {
      if (args.action !== "build_timeline") {
        throw new Error("Unsupported editing_module action.");
      }

      if (!Array.isArray(args.scenes) || args.scenes.length === 0) {
        throw new Error("scenes must contain at least one scene.");
      }

      const aspectRatio =
        typeof args.aspect_ratio === "string" ? args.aspect_ratio : "16:9";

      if (!["16:9", "9:16", "1:1"].includes(aspectRatio)) {
        throw new Error("aspect_ratio must be 16:9, 9:16, or 1:1.");
      }

      let totalDuration = 0;

      const scenes = args.scenes.map((rawScene, index) => {
        if (!rawScene || typeof rawScene !== "object" || Array.isArray(rawScene)) {
          throw new Error(`Scene ${index + 1} must be an object.`);
        }

        const scene = rawScene as Record<string, unknown>;
        const duration = asFiniteNumber(scene.duration, `Scene ${index + 1} duration`);

        if (duration <= 0 || duration > 120) {
          throw new Error(`Scene ${index + 1} duration must be > 0 and <= 120 seconds.`);
        }

        const background =
          typeof scene.background === "string"
            ? validateBackground(scene.background)
            : undefined;

        const text =
          typeof scene.text === "string" && scene.text.trim()
            ? scene.text.trim()
            : undefined;

        totalDuration += duration;

        return {
          index: index + 1,
          duration,
          ...(background ? { background } : {}),
          ...(text ? { text } : {}),
        };
      });

      if (totalDuration > 1800) {
        throw new Error("Timeline duration cannot exceed 30 minutes.");
      }

      return JSON.stringify({
        ok: true,
        action: "build_timeline",
        aspect_ratio: aspectRatio,
        scene_count: scenes.length,
        total_duration: Number(totalDuration.toFixed(3)),
        timeline: {
          type: "nova_timeline_v1",
          aspect_ratio: aspectRatio,
          scenes,
        },
        next_step:
          "Pass timeline.scenes in the same order to video_engine action='render', then probe the exact output.",
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
