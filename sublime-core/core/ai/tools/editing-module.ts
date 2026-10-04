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
  const hex = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  if (COLORS.has(normalized)) return normalized;
  if (isHexColor(hex)) return hex;
  throw new Error(`Unsupported background "${value}". Use a named color or a 6-digit hex color.`);
}

function asFiniteNumber(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
  return number;
}

function validateAssetPath(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty workspace asset path.`);
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized.startsWith("assets/") || normalized.includes("../") || normalized.startsWith("/") || /^[a-z]:/i.test(normalized)) {
    throw new Error(`${label} must remain inside workspace/assets.`);
  }
  return normalized;
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
            visual: { type: "string", maxLength: 500 },
            visual_type: { type: "string", enum: ["card", "flow", "network", "diagram"] },
            asset_path: { type: "string", maxLength: 500 },
            asset_media_type: { type: "string", enum: ["image", "video"] },
            asset_fit: { type: "string", enum: ["cover", "contain"] },
            procedural_kind: { type: "string", enum: ["generic", "ai_video", "sky_scattering", "cpu_architecture"] },
            accent_color: { type: "string" },
            background: { type: "string" },
            text: { type: "string", maxLength: 500 },
            text_size: { type: "number", minimum: 18, maximum: 120 },
            text_position: { type: "string", enum: ["top", "center", "bottom"] },
            text_max_width: { type: "number", minimum: 300, maximum: 1200 },
            caption_segments: {
              type: "array",
              maxItems: 12,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  text: { type: "string", minLength: 1, maxLength: 180 },
                  start: { type: "number", minimum: 0 },
                  end: { type: "number", minimum: 0 },
                },
                required: ["text", "start", "end"],
              },
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
        const visual = typeof scene.visual === "string" ? scene.visual.trim().slice(0, 500) : undefined;
        const visualType = scene.visual_type === undefined ? "card" : String(scene.visual_type);
        if (!["card", "flow", "network", "diagram"].includes(visualType)) {
          throw new Error(`Scene ${index + 1} visual_type is unsupported.`);
        }
        const accentColor = typeof scene.accent_color === "string"
          ? validateBackground(scene.accent_color)
          : undefined;
        const assetPath = validateAssetPath(scene.asset_path, `Scene ${index + 1} asset_path`);
        const assetMediaType = scene.asset_media_type === undefined ? undefined : String(scene.asset_media_type);
        if (assetMediaType !== undefined && !["image", "video"].includes(assetMediaType)) {
          throw new Error(`Scene ${index + 1} asset_media_type must be image or video.`);
        }
        if (assetPath && !assetMediaType) throw new Error(`Scene ${index + 1} asset_path requires asset_media_type.`);
        const assetFit = scene.asset_fit === undefined ? "cover" : String(scene.asset_fit);
        if (!["cover", "contain"].includes(assetFit)) {
          throw new Error(`Scene ${index + 1} asset_fit must be cover or contain.`);
        }
        const proceduralKind = scene.procedural_kind === undefined ? undefined : String(scene.procedural_kind);
        if (proceduralKind !== undefined && !["generic", "ai_video", "sky_scattering", "cpu_architecture"].includes(proceduralKind)) {
          throw new Error(`Scene ${index + 1} procedural_kind is unsupported.`);
        }
        const captionSegments = Array.isArray(scene.caption_segments)
          ? scene.caption_segments.map((rawCaption, captionIndex) => {
              if (!rawCaption || typeof rawCaption !== "object" || Array.isArray(rawCaption)) {
                throw new Error(`Scene ${index + 1} caption ${captionIndex + 1} must be an object.`);
              }
              const caption = rawCaption as Record<string, unknown>;
              const captionText = typeof caption.text === "string" ? caption.text.trim() : "";
              const start = asFiniteNumber(caption.start, `Scene ${index + 1} caption start`);
              const end = asFiniteNumber(caption.end, `Scene ${index + 1} caption end`);
              if (!captionText || captionText.length > 180 || start < 0 || end <= start || end > duration) {
                throw new Error(`Scene ${index + 1} caption ${captionIndex + 1} has invalid text or timing.`);
              }
              return { text: captionText, start, end };
            })
          : [];
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
          ...(visual ? { visual } : {}),
          visual_type: visualType as VideoSceneDefinition["visual_type"],
          ...(assetPath ? { asset_path: assetPath } : {}),
          ...(assetMediaType ? { asset_media_type: assetMediaType as "image" | "video" } : {}),
          ...(assetPath ? { asset_fit: assetFit as "cover" | "contain" } : {}),
          ...(proceduralKind ? { procedural_kind: proceduralKind as VideoSceneDefinition["procedural_kind"] } : {}),
          ...(accentColor ? { accent_color: accentColor } : {}),
          ...(background ? { background } : {}),
          ...(text ? { text } : {}),
          ...(captionSegments.length ? { caption_segments: captionSegments } : {}),
          ...(textSize !== undefined ? { text_size: textSize } : {}),
          ...(textPosition ? { text_position: textPosition } : {}),
          ...(textMaxWidth !== undefined ? { text_max_width: textMaxWidth } : {}),
        };
      });

      if (totalDuration > 1800) throw new Error("Timeline duration cannot exceed 30 minutes.");

      const dimensions = aspectRatio === "9:16"
        ? { width: 720, height: 1280 }
        : aspectRatio === "1:1"
          ? { width: 1080, height: 1080 }
          : { width: 1280, height: 720 };

      const timeline = {
        type: "nova_timeline_v2" as const,
        aspect_ratio: aspectRatio as "16:9" | "9:16" | "1:1",
        scenes,
        total_duration: Number(totalDuration.toFixed(3)),
        ...dimensions,
        frame_rate: 30,
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
