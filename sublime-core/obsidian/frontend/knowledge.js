/* OBSIDIAN's tiny local motion-design knowledge base.
 * This is explicit domain knowledge for the rule-based planner, not an LLM or
 * a claim that OBSIDIAN can visually inspect the composition.
 */
(function (root) {
  "use strict";

  root.OBSIDIANKnowledge = {
    version: "0.3.1",
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
    answers: [
      {
        id: "cinematic_glow_basics",
        cues: ["cinematic glow", "what is glow", "what does glow do"],
        answer: "A cinematic Glow is a restrained halo around bright areas. Keep it subtle enough that texture and detail remain visible; too much radius or intensity can make the image look washed out."
      },
      {
        id: "attention_design",
        cues: ["make a title pop", "make title pop", "title pop", "attention grabbing", "attention-grabbing", "stand out"],
        answer: "To make a title stand out, use a clear contrast from the background, strong size hierarchy, clean spacing, and one deliberate accent. A bold Glow can help, but it should support the title rather than replace contrast."
      },
      {
        id: "readability_basics",
        cues: ["readable", "legible", "hard to read", "text readability", "make text readable", "improve readability"],
        answer: "For readable text, start with contrast against the background, sufficient size, clear type, and spacing. A subtle shadow or Glow may separate text from a busy background, but it cannot fix weak contrast or an unsuitable font by itself."
      },
      {
        id: "easing_basics",
        cues: ["what is easing", "explain easing", "motion easing"],
        answer: "Easing controls how speed changes during an animation. Ease-out starts quickly and settles gently; ease-in starts slowly and accelerates; ease-in-out starts and ends gently. Use easing to make motion feel intentional rather than mechanically linear."
      },
      {
        id: "hierarchy_basics",
        cues: ["visual hierarchy", "what is hierarchy", "design hierarchy"],
        answer: "Visual hierarchy tells the viewer what to notice first. Use relative scale, contrast, placement, spacing, and motion emphasis to establish a clear primary element and quieter supporting elements."
      },
      {
        id: "fade_basics",
        cues: ["what is a fade in", "what does fade in mean", "fade-in animation"],
        answer: "A fade-in gradually increases a layer's opacity so it enters gently. The timing should fit the scene; OBSIDIAN's current fade-in action is guarded and refuses to overwrite existing opacity keyframes or enabled expressions."
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
