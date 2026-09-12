export type QualityDecision = "PASS" | "NEEDS_REVIEW" | "FAIL";

export interface QualityIssue {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface QualityReport {
  decision: QualityDecision;
  score: number;
  issues: QualityIssue[];
  checkedAt: string;
}

export function parseQualityReport(value: unknown): QualityReport | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const decision = record.decision;
  const score = record.score;
  const issues = record.issues;

  if (
    (decision !== "PASS" && decision !== "NEEDS_REVIEW" && decision !== "FAIL") ||
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 100 ||
    !Array.isArray(issues)
  ) {
    return null;
  }

  const normalizedIssues: QualityIssue[] = [];
  for (const item of issues) {
    if (!item || typeof item !== "object") return null;
    const issue = item as Record<string, unknown>;
    if (
      typeof issue.code !== "string" ||
      (issue.severity !== "info" &&
        issue.severity !== "warning" &&
        issue.severity !== "error") ||
      typeof issue.message !== "string"
    ) {
      return null;
    }
    normalizedIssues.push({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
    });
  }

  return {
    decision,
    score,
    issues: normalizedIssues,
    checkedAt: new Date().toISOString(),
  };
}
