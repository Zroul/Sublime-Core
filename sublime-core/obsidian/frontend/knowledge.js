/* OBSIDIAN's tiny local motion-design knowledge base.
 * This is explicit domain knowledge for the rule-based planner, not an LLM or
 * a claim that OBSIDIAN can visually inspect the composition.
 */
(function (root) {
  "use strict";

  root.OBSIDIANKnowledge = {
    version: "0.2.0",
    concepts: [
      {
        id: "cinematic_glow",
        name: "cinematic glow",
        cues: ["cinematic", "subtle", "soft", "restrained", "atmospheric", "dreamy", "bloom", "filmic", "diffused", "gentle halo"],
        profile: "cinematic",
        note: "Keep the halo restrained so highlights and image texture remain visible."
      },
      {
        id: "attention_glow",
        name: "attention glow",
        cues: ["bold", "strong", "intense", "punchy", "attention", "pop", "flashy", "dramatic", "neon", "stand out", "eye catching", "eye-catching"],
        profile: "attention",
        note: "Use a wider, brighter halo to make the selected subject stand out."
      },
      {
        id: "fade_in",
        name: "fade-in",
        cues: ["fade in", "fade-in", "fade up", "appear gradually", "reveal gradually", "gentle entrance"],
        action: "fade_in",
        note: "A fade-in is a temporal opacity animation; existing opacity animation must be preserved."
      },
      {
        id: "readability",
        name: "text readability",
        cues: ["readable", "legible", "hard to read", "text visibility", "improve readability"],
        note: "Readability depends on contrast, background separation, size, and typography; Glow alone cannot guarantee it."
      }
    ],
    guardrails: [
      "Never overwrite existing opacity keyframes or enabled expressions.",
      "Only execute explicitly supported host actions.",
      "Ask a question when style cues conflict.",
      "Do not claim visual inspection without image-analysis evidence.",
      "Never silently turn a design suggestion into an After Effects edit."
    ]
  };
}(typeof globalThis !== "undefined" ? globalThis : this));
