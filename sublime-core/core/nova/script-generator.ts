import type { LlmClient, Message } from "../ai/reasoning/types.js";

export interface ScriptRequest {
  topic: string;
  format?: "short" | "long";
  targetSeconds?: number;
  tone?: string;
  audience?: string;
}

export interface VideoScript {
  title: string;
  hook: string;
  sections: Array<{
    heading: string;
    narration: string;
    visualDirection: string;
  }>;
  ending: string;
  estimatedSeconds: number;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);

  throw new Error("Script generator could not find a JSON object in the model response.");
}

export async function generateScript(
  llm: LlmClient,
  request: ScriptRequest,
): Promise<VideoScript> {
  const targetSeconds = request.targetSeconds ?? (request.format === "long" ? 240 : 60);
  const tone = request.tone ?? "fast, engaging, informative";
  const audience = request.audience ?? "general internet audience";

  const messages: Message[] = [
    {
      role: "user",
      content: `Create a video script about: ${request.topic}\n\nTarget length: about ${targetSeconds} seconds.\nTone: ${tone}.\nAudience: ${audience}.\n\nReturn ONLY valid JSON with this exact shape:\n{\n  "title": "...",\n  "hook": "...",\n  "sections": [{"heading":"...","narration":"...","visualDirection":"..."}],\n  "ending": "...",\n  "estimatedSeconds": 60\n}\n\nRules:\n- Write original narration, not copied text.\n- Keep factual claims grounded in the supplied topic/context.\n- Make the hook strong without clickbait that promises something the video does not deliver.\n- Visual directions must be practical for a later video-production stage.`,
    },
  ];

  const response = await llm.complete({
    system:
      "You are NOVA's script-writing module. Produce concise, original, production-ready scripts. Never add commentary outside the requested JSON.",
    messages,
    tools: [],
  });

  const parsed = JSON.parse(extractJson(response.text ?? "")) as VideoScript;

  if (
    typeof parsed.title !== "string" ||
    typeof parsed.hook !== "string" ||
    !Array.isArray(parsed.sections) ||
    typeof parsed.ending !== "string" ||
    typeof parsed.estimatedSeconds !== "number"
  ) {
    throw new Error("Generated script failed the required structure validation.");
  }

  return parsed;
}
