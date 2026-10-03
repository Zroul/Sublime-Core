import type { AgentState, Tool, ToolResult } from "../reasoning/types.js";
import type { VideoEditingResult, VideoSceneDefinition } from "../../nova/video-contracts.js";

const COLORS = new Set([
  "black", "white", "red", "green", "blue", "yellow",
  "cyan", "magenta", "gray", "grey",
]);

function isHexColor(value: string): boolean {
  return /^[0-9a-fA-F]{6}$/.test(value);
}

function validateBackground(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (COLORS.has(normalized) || isHexColor(normalized)) return normalized;
  throw new Error(`Unsupported background "${value}". Use a named color or a 6-digit hex color.`);
}

function asFiniteNumber(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
  return number;
}

export const editingModuleTool: Tool = {
  name: "editing_module",
  description:
    "Builds a deterministic editing timeline for NOVA. This is the editing decision layer before video_engine. It controls scene timing, meaningful text overlays, text size, safe text positioning, and maximum text width so captions stay inside the frame. Do not invent filler text.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: ["build_timeline"], description: "Build a normalized editing timeline." },
      aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"], description: "Output framing." },
      scenes: {
        type: "array", minItems: 1, maxItems: 60,
        description: "Ordered scenes. Every scene should have a clear visual/story purpose. Text is optional and must be meaningful.",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            duration: { type: "number", minimum: 0.1, maximum: 120 },
            background: { type: "string" },
            text: { type: "string", maxLength: 500 },
            text_size: { type: "number", minimum: 18, maximum: 120 },
            text_position: { type: "string", enum: ["top", "center", "bottom"] },
            text_max_width: { type: "number", minimum: 300, maximum: 1200 },
          },
          required: ["duration"],
        },
      },
    },
    required: ["action", "scenes"],
  },

  handler(args: Record<string, unknown>, _ctx: AgentState): ToolResult | string {
    try {
      if (args.action !== "build_timeline") throw new Error("Unsupported editing_module action.");
      if (!Array.isArray(args.scenes) || args.scenes.length === 0) throw new Error("scenes must contain at least one scene.");

      const aspectRatio = typeof args.aspect_ratio === "string" ? args.aspect_ratio : "16:9";
      if (!["16:9", "9:16", "1:1"].includes(aspectRatio)) throw new Error("aspect_ratio must be 16:9, 9:16, or 1:1.");

      let totalDuration = 0;
      const scenes: VideoSceneDefinition[] = args.scenes.map((rawScene, index) => {
        if (!rawScene || typeof rawScene !== "object" || Array.isArray(rawScene)) {
          throw new Error(`Scene ${index + 1} must be an object.`);
        }
        const scene = rawScene as Record<string, unknown>;
        const duration = asFiniteNumber(scene.duration, `Scene ${index + 1} duration`);
        if (duration <= 0 || duration > 120) throw new Error(`Scene ${index + 1} duration must be > 0 and <= 120 seconds.`);

        const background = typeof scene.background === "string" ? validateBackground(scene.background) : undefined;
        const text = typeof scene.text === "string" && scene.text.trim() ? scene.text.trim() : undefined;
        const textSize = scene.text_size === undefined ? undefined : asFiniteNumber(scene.text_size, `Scene ${index + 1} text_size`);
        if (textSize !== undefined && (textSize < 18 || textSize > 120)) throw new Error(`Scene ${index + 1} text_size must be between 18 and 120.`);

        const textPositionValue = scene.text_position === undefined ? undefined : String(scene.text_position);
        if (textPositionValue !== undefined && !["top", "center", "bottom"].includes(textPositionValue)) {
          throw new Error(`Scene ${index + 1} text_position must be top, center, or bottom.`);
        }
        const textPosition = textPositionValue as "top" | "center" | "bottom" | undefined;

        const textMaxWidth = scene.text_max_width === undefined ? undefined : asFiniteNumber(scene.text_max_width, `Scene ${index + 1} text_max_width`);
        if (textMaxWidth !== undefined && (textMaxWidth < 300 || textMaxWidth > 1200)) {
          throw new Error(`Scene ${index + 1} text_max_width must be between 300 and 1200.`);
        }

        totalDuration += duration;
        return {
          index: index + 1,
          duration,
          ...(background ? { background } : {}),
          ...(text ? { text } : {}),
          ...(textSize !== undefined ? { text_size: textSize } : {}),
          ...(textPosition ? { text_position: textPosition } : {}),
          ...(textMaxWidth !== undefined ? { text_max_width: textMaxWidth } : {}),
        };
      });

      if (totalDuration > 1800) throw new Error("Timeline duration cannot exceed 30 minutes.");

      const timeline = {
        type: "nova_timeline_v2" as const,
        aspect_ratio: aspectRatio as "16:9" | "9:16" | "1:1",
        scenes,
        total_duration: Number(totalDuration.toFixed(3)),
      };
      const result: VideoEditingResult = {
        ok: true,
        action: "build_timeline",
        aspect_ratio: timeline.aspect_ratio,
        scene_count: scenes.length,
        total_duration: timeline.total_duration,
        timeline,
        next_step: "Pass timeline.scenes in the same order to video_engine render, then probe the exact output.",
      };

      return JSON.stringify(result);
    } catch (error) {
      return { toolCallId: "", isError: true, content: error instanceof Error ? error.message : String(error) };
    }
  },
};
