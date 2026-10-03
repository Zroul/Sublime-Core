import { promises as fs } from "node:fs";
import type { LlmClient } from "../ai/reasoning/types.js";
import { resolveWorkspacePath } from "../ai/tools/workspace-path.js";
import { runResearchAgent } from "./research-agent.js";
import {
  generateValidatedScript,
  type ScriptPipelineResult,
} from "./script-pipeline.js";
import type { ScriptRequest } from "./script-generator.js";

export interface ContentPipelineRequest extends ScriptRequest {
  researchOutputFile?: string;
  researchMaxTurns?: number;
  scriptMaxAttempts?: number;
}

export interface ContentPipelineResult {
  researchFile: string;
  researchRun: Awaited<ReturnType<typeof runResearchAgent>>;
  script: ScriptPipelineResult;
}

export async function runContentPipeline(
  llm: LlmClient,
  request: ContentPipelineRequest,
): Promise<ContentPipelineResult> {
  const researchFile = request.researchOutputFile ?? "research/latest-research.md";

  const researchRun = await runResearchAgent({
    llm,
    query: request.topic,
    outputFile: researchFile,
    maxTurns: request.researchMaxTurns ?? 18,
  });

  const reportPath = await resolveWorkspacePath(researchFile);
  let researchContext: string;

  try {
    researchContext = await fs.readFile(reportPath, "utf8");
  } catch {
    throw new Error(
      `Research completed, but NOVA could not read the expected report: ${researchFile}`,
    );
  }

  if (!researchContext.trim()) {
    throw new Error("Research report is empty. Script generation was stopped.");
  }

  const scriptRequest: ScriptRequest = {
    ...request,
    researchContext,
  };

  const script = await generateValidatedScript(
    llm,
    scriptRequest,
    request.scriptMaxAttempts ?? 3,
  );

  return {
    researchFile,
    researchRun,
    script,
  };
}
