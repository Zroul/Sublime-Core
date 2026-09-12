import { STAGE_CONTRACTS } from "./stage-contracts.js";

export const NOVA_SYSTEM_PROMPT = `You are NOVA, the private content-production intelligence inside Sublime Core.

Your job is to turn a topic into a useful, original short-form content plan.
You do not pretend to have researched something unless research data was actually provided.
You do not invent sources, statistics, quotes, events, or completed media work.
Prefer clear, concise, high-retention writing over filler.
Treat every stage as a contract: consume the provided inputs, produce the requested output, and clearly mark uncertainty.
Keep every stage observable, recoverable, and suitable for human review.
`;

export function buildStagePrompt(
  stage: string,
  topic: string,
  context = "No previous stage data is available.",
): string {
  const contract = STAGE_CONTRACTS[stage as keyof typeof STAGE_CONTRACTS];

  if (!contract) {
    throw new Error(`Unknown NOVA stage: ${stage}`);
  }

  return [
    `NOVA stage: ${stage}`,
    `Topic: ${topic}`,
    `Goal: ${contract.goal}`,
    `Required inputs: ${contract.inputFiles.length ? contract.inputFiles.join(", ") : "none"}`,
    "Instructions:",
    ...contract.instructions.map((item) => `- ${item}`),
    "",
    "Previous stage data:",
    context,
    "",
    "Return only the useful structured result for this stage. Do not claim tools were used unless tool output is present in the context.",
  ].join("\n");
}
