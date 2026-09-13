import { promises as fs } from "fs";
import path from "path";
import { OllamaProvider } from "../ai/providers/ollama.js";

const WORKSPACE = path.resolve("workspace");

export interface ScriptResult {
  title: string;
  hook: string;
  script: string;
  visualPlan: string[];
  sources: string[];
}

function extractJson(text: string): ScriptResult {
  const cleaned = text.replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model did not return valid JSON.");
  return JSON.parse(cleaned.slice(start, end + 1)) as ScriptResult;
}

export async function generateScript(research: string, topic: string): Promise<ScriptResult> {
  const model = new OllamaProvider();

  const response = await model.complete({
    system: `You are NOVA's original short-form video scriptwriter.
Use only the supplied research as factual grounding.
Do not invent facts, quotes, statistics, dates, or events.
Write an original, engaging faceless-video script.
Do not copy source wording.
If the research is uncertain or conflicting, say so briefly.
Return ONLY valid JSON with this shape:
{"title":"...","hook":"...","script":"...","visualPlan":["..."],"sources":["..."]}
The script should be concise and narration-ready, with a strong hook, clear progression, and memorable ending.`,
    messages: [{
      role: "user",
      content: `Topic: ${topic}\n\nResearch:\n${research.slice(0, 30000)}`,
    }],
    tools: [],
  });

  return extractJson(response.text ?? "");
}

const researchPath = path.join(WORKSPACE, "research", "latest-gaming-research.md");
const scriptDir = path.join(WORKSPACE, "scripts");

if (process.argv[1]?.replace(/\\/g, "/").endsWith("script-generator.ts")) {
  const research = await fs.readFile(researchPath, "utf8");
  const result = await generateScript(research, "Latest major gaming news");

  await fs.mkdir(scriptDir, { recursive: true });
  await fs.writeFile(
    path.join(scriptDir, "latest-gaming-news-script.json"),
    JSON.stringify(result, null, 2),
    "utf8",
  );

  console.log("\n===== NOVA SCRIPT GENERATED =====\n");
  console.log(JSON.stringify(result, null, 2));
}
