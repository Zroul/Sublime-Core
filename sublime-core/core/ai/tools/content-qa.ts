import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../reasoning/types.js";

const WORKSPACE = path.resolve("workspace");

function safePath(value: string): string {
  const full = path.resolve(WORKSPACE, value);
  if (full !== WORKSPACE && !full.startsWith(WORKSPACE + path.sep)) {
    throw new Error("Path is outside the Sublime Core workspace.");
  }
  return full;
}

function checksFor(kind: string, content: string): string[] {
  const checks: string[] = [];
  if (kind === "script") {
    if (content.trim().length < 120) checks.push("Script is very short; review whether it contains enough substance.");
    if (!/[.!?]/.test(content)) checks.push("Script has no normal sentence punctuation.");
    if (/(TODO|TBD|INSERT|PLACEHOLDER)/i.test(content)) checks.push("Script contains unresolved placeholder text.");
  }
  if (kind === "asset_manifest") {
    if (!/(source|license|rights|original|public domain|permission)/i.test(content)) {
      checks.push("Asset manifest does not state an obvious source or rights field.");
    }
  }
  if (kind === "qa") {
    if (!/(pass|fail|issue|finding|check)/i.test(content)) checks.push("QA artifact does not contain an explicit check/result vocabulary.");
  }
  if (kind === "review") {
    if (!/(pass|fail|block|issue|check)/i.test(content)) {
      checks.push("Review does not contain an explicit check/result vocabulary.");
    }
  }
  return checks;
}

export const contentQaTool: Tool = {
  name: "content_qa",
  description:
    "Run deterministic sanity checks against a content artifact inside the workspace. It reports findings only; it does not certify quality, copyright status, factual accuracy, or publication readiness.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative artifact path." },
      kind: { type: "string", enum: ["script", "qa", "asset_manifest", "review"] },
    },
    required: ["path", "kind"],
    additionalProperties: false,
  },
  async handler(input) {
    const relative = String(input.path ?? "");
    const kind = String(input.kind ?? "");
    const file = safePath(relative);

    try {
      const content = await fs.readFile(file, "utf8");
      const findings = checksFor(kind, content);
      return JSON.stringify({
        path: relative.replaceAll("\\", "/"),
        passed: findings.length === 0,
        findings,
        bytes: Buffer.byteLength(content, "utf8"),
      });
    } catch (error) {
      return {
        toolCallId: "",
        content: "QA failed to inspect artifact: " + (error instanceof Error ? error.message : String(error)),
        isError: true,
      };
    }
  },
};
