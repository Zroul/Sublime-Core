export interface ParsedBrainOutput {
  raw: string;
  parsed?: unknown;
  format: "json" | "text";
}

export function parseBrainOutput(raw: string): ParsedBrainOutput {
  const clean = raw.trim();

  if (!clean) {
    return { raw: clean, format: "text" };
  }

  const candidates = [clean, extractFencedJson(clean), extractJsonObject(clean), extractJsonArray(clean)];

  for (const candidate of candidates) {
    if (!candidate) continue;

    try {
      return {
        raw: clean,
        parsed: JSON.parse(candidate),
        format: "json",
      };
    } catch {
      // Keep trying less strict extraction strategies.
    }
  }

  return { raw: clean, format: "text" };
}

function extractFencedJson(value: string): string | null {
  const match = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match?.[1]?.trim() ?? null;
}

function extractJsonObject(value: string): string | null {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  return start >= 0 && end > start ? value.slice(start, end + 1) : null;
}

function extractJsonArray(value: string): string | null {
  const start = value.indexOf("[");
  const end = value.lastIndexOf("]");
  return start >= 0 && end > start ? value.slice(start, end + 1) : null;
}
