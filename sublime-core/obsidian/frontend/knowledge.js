/* Small, explicit motion-design knowledge for OBSIDIAN's rule-based planner.
 * This is guidance for choosing supported actions, not a visual model or a claim
 * that the composition has been inspected by an AI vision system.
 */
(function (root) {
  "use strict";
  root.OBSIDIANKnowledge = {
    version: "0.1.0",
    concepts: [
      { name: "cinematic glow", cues: ["cinematic", "subtle", "soft", "restrained", "atmospheric", "dreamy", "bloom"], profile: "cinematic",
        note: "Use a restrained halo; preserve texture and avoid washing out the image." },
      { name: "attention glow", cues: ["bold", "strong", "intense", "punchy", "attention", "pop", "flashy", "dramatic", "neon"], profile: "attention",
        note: "Use a wider, brighter halo to emphasize the selected subject." },
      { name: "readability", cues: ["readable", "legible", "hard to read", "text visibility"], profile: "readability",
        note: "A glow alone cannot guarantee readability; contrast, background separation, and text size matter." }
    ],
    guardrails: [
      "Never overwrite existing opacity keyframes or enabled expressions.",
      "Only execute explicitly supported host actions.",
      "Ask a question when style cues conflict.",
      "Do not claim visual inspection or calibrated results without evidence."
    ]
  };
}(typeof globalThis !== "undefined" ? globalThis : this));
