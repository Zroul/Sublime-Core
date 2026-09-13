import type { LlmClient } from "../ai/reasoning/types.js";
import { generateScript, type ScriptRequest, type VideoScript } from "./script-generator.js";
import { validateScript, type ScriptValidationResult } from "./script-validator.js";

export interface ScriptPipelineResult {
  script: VideoScript;
  validation: ScriptValidationResult;
  attempts: number;
}

export async function generateValidatedScript(
  llm: LlmClient,
  request: ScriptRequest,
  maxAttempts = 3,
): Promise<ScriptPipelineResult> {
  const targetSeconds = request.targetSeconds ?? (request.format === "long" ? 240 : 60);
  let script = await generateScript(llm, request);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const validation = validateScript(script, targetSeconds);

    if (validation.valid && validation.warnings.length === 0) {
      return { script, validation, attempts: attempt };
    }

    if (attempt === maxAttempts) {
      return { script, validation, attempts: attempt };
    }

    script = await repairScript(llm, script, validation, request);
  }

  throw new Error("Script pipeline reached an unexpected state.");
}

async function repairScript(
  llm: LlmClient,
  script: VideoScript,
  validation: ScriptValidationResult,
  request: ScriptRequest,
): Promise<VideoScript> {
  const targetSeconds = request.targetSeconds ?? (request.format === "long" ? 240 : 60);

  const response = await llm.complete({
    system:
      "You are NOVA's script repair module. Rewrite the supplied script to fix every validation issue. Return ONLY valid JSON matching the supplied script structure. Preserve the topic and useful ideas, but improve weak or undersized narration. Do not invent research facts.",
    messages: [
      {
        role: "user",
        content: `Repair this video script.\n\nTarget duration: ${targetSeconds} seconds.\n\nValidation errors:\n${validation.errors.join("\n") || "None"}\n\nValidation warnings:\n${validation.warnings.join("\n") || "None"}\n\nCurrent script:\n${JSON.stringify(script, null, 2)}\n\nReturn ONLY JSON with: title, hook, sections, ending, estimatedSeconds. Each section must contain heading, narration, and visualDirection.`,
      },
    ],
    tools: [],
  });

  const raw = response.text ?? "";
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const json = fenced?.[1]?.trim() ?? raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);

  if (!json || !json.startsWith("{") || !json.endsWith("}")) {
    throw new Error("Script repair module did not return a JSON object.");
  }

  return JSON.parse(json) as VideoScript;
}
