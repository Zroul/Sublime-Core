import type { LlmClient, Message } from "../ai/reasoning/types.js";

export interface VideoProductionRequest {
  topic: string;
  targetSeconds: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
  style: string;
  audience: string;
  captions: boolean;
  narration: boolean;
  title?: string;
  understoodBy: "local_model" | "local_rules";
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  throw new Error("Request understanding returned no JSON object.");
}

function parseDuration(text: string): number {
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*[- ]?(seconds?|secs?|minutes?|mins?)\b/i);
  if (!match) return 30;
  const amount = Number(match[1]);
  const seconds = /^(?:minutes?|mins?)$/i.test(match[2]) ? amount * 60 : amount;
  if (!Number.isFinite(seconds) || seconds < 3 || seconds > 600) return 30;
  return Math.round(seconds * 10) / 10;
}

function fallbackTopic(task: string): string {
  const match = task.match(/\b(?:explaining|explain|about|on)\s+(.+?)(?:[.!?]|$)/i);
  if (match?.[1]) return match[1].trim();
  return task
    .replace(/^\s*(?:please\s+)?(?:make|create|produce|build)\s+(?:a\s+)?/i, "")
    .replace(/\b\d+(?:\.\d+)?\s*[- ]?(?:seconds?|secs?|minutes?|mins?)\b/ig, "")
    .replace(/\b(?:faceless|video|mp4|clip)\b/ig, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .trim() || "General technology explainer";
}

function normalizeRequest(value: unknown, original: string): VideoProductionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request understanding must return an object.");
  }
  const data = value as Record<string, unknown>;
  const topic = typeof data.topic === "string" ? data.topic.trim().slice(0, 240) : "";
  const targetSeconds = Number(data.targetSeconds);
  const aspectRatio = data.aspectRatio;
  if (!topic) throw new Error("Request understanding did not identify a topic.");
  if (!Number.isFinite(targetSeconds) || targetSeconds < 3 || targetSeconds > 600) {
    throw new Error("Requested video duration must be between 3 and 600 seconds.");
  }
  if (aspectRatio !== "16:9" && aspectRatio !== "9:16" && aspectRatio !== "1:1") {
    throw new Error("Request understanding returned an unsupported aspect ratio.");
  }

  return {
    topic,
    targetSeconds,
    aspectRatio,
    style: typeof data.style === "string" && data.style.trim()
      ? data.style.trim().slice(0, 120)
      : "clean procedural motion graphics",
    audience: typeof data.audience === "string" && data.audience.trim()
      ? data.audience.trim().slice(0, 120)
      : "general audience",
    captions: data.captions !== false,
    narration: data.narration === true,
    ...(typeof data.title === "string" && data.title.trim()
      ? { title: data.title.trim().slice(0, 120) }
      : {}),
    understoodBy: "local_model",
  };
}

export async function understandVideoRequest(
  llm: LlmClient,
  task: string,
): Promise<VideoProductionRequest> {
  const messages: Message[] = [{
    role: "user",
    content: `Extract the production requirements from this video request. Do not add requirements the user did not state. Use defaults: aspectRatio 16:9, style "clean procedural motion graphics", audience "general audience", captions true, narration false. Return JSON only with keys topic, targetSeconds, aspectRatio, style, audience, captions, narration, and optional title. Duration must be between 3 and 600 seconds.\n\nRequest:\n${task}`,
  }];

  try {
    const response = await llm.complete({
      system: "You extract video-production requirements faithfully. Return one valid JSON object and no commentary.",
      messages,
      tools: [],
    });
    return normalizeRequest(JSON.parse(extractJson(response.text ?? "")), task);
  } catch {
    const lower = task.toLowerCase();
    const aspectRatio = /\b(?:9:16|vertical|portrait|reel|shorts|tiktok)\b/.test(lower)
      ? "9:16"
      : /\b(?:1:1|square)\b/.test(lower)
        ? "1:1"
        : "16:9";
    const audienceMatch = task.match(/\bfor\s+([^,.!?]+)/i);
    return {
      topic: fallbackTopic(task),
      targetSeconds: parseDuration(task),
      aspectRatio,
      style: /\b(?:tech|technology|ai)\b/i.test(task)
        ? "clean procedural technology graphics"
        : "clean procedural motion graphics",
      audience: audienceMatch?.[1]?.trim().slice(0, 120) || "general audience",
      captions: true,
      narration: /\b(?:narration|voiceover|voice-over|spoken)\b/i.test(task),
      understoodBy: "local_rules",
    };
  }
}
