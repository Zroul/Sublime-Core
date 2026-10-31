import "../../frontend/knowledge.js";

const knowledge = globalThis.OBSIDIANKnowledge;

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function stem(word) {
  return word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word;
}

export function retrieveCreativeGuides(request, limit = 2) {
  const text = normalize(request);
  const tokens = new Set(text.split(" ").filter(Boolean).map(stem));
  const guides = Array.isArray(knowledge.creativeGuides) ? knowledge.creativeGuides : [];
  return guides.map((guide) => {
    let score = 0;
    for (const cue of guide.cues || []) {
      const normalizedCue = normalize(cue);
      if (!normalizedCue) continue;
      if (` ${text} `.includes(` ${normalizedCue} `)) score += 5 + normalizedCue.split(" ").length;
      else {
        const cueTokens = normalizedCue.split(" ").map(stem);
        const matches = cueTokens.filter((token) => tokens.has(token)).length;
        if (matches === cueTokens.length) score += 2 + matches;
        else if (matches > 0) score += matches;
      }
    }
    return { guide, score };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.guide.id.localeCompare(b.guide.id))
    .slice(0, Math.max(0, Math.min(3, Number(limit) || 0)))
    .map(({ guide }) => ({
      id: guide.id,
      domain: guide.domain,
      principles: guide.principles.slice(0, 3),
      cautions: guide.cautions.slice(0, 1),
    }));
}

export function formatCreativeGuides(guides) {
  if (!Array.isArray(guides) || guides.length === 0) return "";
  return guides.map((guide) => [
    guide.domain + ":",
    ...guide.principles.map((principle) => "- " + principle),
    ...guide.cautions.map((caution) => "- Caution: " + caution),
  ].join("\n")).join("\n");
}
