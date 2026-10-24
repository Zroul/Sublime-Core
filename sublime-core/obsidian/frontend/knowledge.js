/* OBSIDIAN's local motion-design knowledge base.
 * This is explicit domain knowledge for the rule-based planner, not an LLM and
 * not a claim that OBSIDIAN can visually inspect the composition.
 */
(function (root) {
  "use strict";

  root.OBSIDIANKnowledge = {
    version: "0.4.0",
    concepts: [
      {
        id: "cinematic_glow",
        name: "cinematic glow",
        cues: ["cinematic", "subtle", "soft", "restrained", "atmospheric", "dreamy", "filmic", "diffused", "gentle halo"],
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
      },
      {
        id: "keyframes",
        name: "keyframes",
        cues: ["keyframe", "keyframes", "animate a property"],
        note: "Keyframes store property values at specific times; the software interpolates between them."
      },
      {
        id: "velocity",
        name: "animation velocity",
        cues: ["velocity", "speed over time", "motion speed"],
        note: "Velocity describes how quickly position changes over time; acceleration describes how velocity changes."
      },
      {
        id: "motion_blur",
        name: "motion blur",
        cues: ["motion blur", "blur moving objects", "blur during movement"],
        note: "Motion blur simulates exposure over time and can make fast movement feel smoother, but too much can reduce clarity."
      },
      {
        id: "parallax",
        name: "parallax",
        cues: ["parallax", "depth movement", "layered depth"],
        note: "Parallax creates a depth cue by moving foreground and background layers at different rates."
      },
      {
        id: "track_matte",
        name: "track matte",
        cues: ["track matte", "luma matte", "alpha matte", "mask reveal"],
        note: "A track matte uses another layer's alpha or luminance to control which parts of a layer are visible."
      },
      {
        id: "anticipation",
        name: "anticipation",
        cues: ["anticipation", "anticipate the move", "pre-movement"],
        note: "Anticipation is a preparatory motion that helps the viewer understand and feel the action that follows."
      },
      {
        id: "typography",
        name: "motion typography",
        cues: ["typography", "font pairing", "text animation", "kinetic type"],
        note: "Motion typography combines type hierarchy, readable timing, spacing, and movement that supports the message."
      },
      {
        id: "composition",
        name: "composition",
        cues: ["composition", "rule of thirds", "visual balance", "frame layout"],
        note: "Composition arranges elements to guide attention using hierarchy, spacing, alignment, contrast, and balance."
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
      },
      {
        id: "keyframes_basics",
        cues: ["what is a keyframe", "what are keyframes", "explain keyframes"],
        answer: "A keyframe records a property's value at a particular time, such as position at frame 1 and a new position later. After Effects calculates the in-between values; keyframe spacing and interpolation shape the timing and feel of the motion."
      },
      {
        id: "velocity_basics",
        cues: ["what is velocity", "velocity in animation", "how does velocity affect animation", "speed over time"],
        answer: "Velocity describes how quickly position changes over time. In animation, changing velocity makes movement accelerate or decelerate; easing shapes that change. Two moves can cover the same distance but feel very different if their velocity profiles differ."
      },
      {
        id: "motion_blur_basics",
        cues: ["what is motion blur", "explain motion blur", "why use motion blur"],
        answer: "Motion blur simulates the streaking captured when a moving subject changes position during a camera's exposure. It can make fast animation feel smoother and more natural, but excessive blur makes details harder to read."
      },
      {
        id: "parallax_basics",
        cues: ["what is parallax", "explain parallax", "parallax effect"],
        answer: "Parallax suggests depth by moving layers at different speeds: foreground elements usually shift more than distant background elements. Keep the offsets coherent with the implied camera movement to avoid a flat or distracting result."
      },
      {
        id: "track_matte_basics",
        cues: ["what is a track matte", "explain track matte", "alpha matte", "luma matte"],
        answer: "A track matte uses one layer to control another layer's visibility. An alpha matte uses transparency; a luma matte uses brightness. It is useful for reveals and shaped visibility without permanently erasing the source layer."
      },
      {
        id: "anticipation_basics",
        cues: ["what is anticipation", "anticipation in animation", "explain anticipation"],
        answer: "Anticipation is a small preparatory action before the main action, such as a slight pull-back before a fast move. It signals intent, improves readability, and makes the main motion feel more deliberate."
      },
      {
        id: "typography_basics",
        cues: ["what is kinetic typography", "motion typography", "text animation principles", "font pairing"],
        answer: "Good motion typography keeps the words readable while movement adds emphasis. Establish a clear type hierarchy, allow enough reading time, use consistent alignment and spacing, and animate to support meaning rather than decorate every word."
      },
      {
        id: "composition_basics",
        cues: ["what is composition", "explain composition", "visual balance", "rule of thirds"],
        answer: "Composition is how visual elements are arranged inside the frame. Use hierarchy, alignment, negative space, contrast, and balance to guide the eye; the rule of thirds is one useful guide, not a rule every shot must follow."
      }
    ],
    guardrails: [
      "Never overwrite existing opacity keyframes or enabled expressions.",
      "Only execute explicitly supported host actions.",
      "Ask a question when style cues conflict.",
      "Do not claim visual inspection without image-analysis evidence.",
      "Never silently turn a design suggestion into an After Effects edit.",
      "Knowledge answers are explanations, not permission to mutate a project.",
      "Treat Glow presets as unavailable while host Glow edits are disabled."
    ]
  };
}(typeof globalThis !== "undefined" ? globalThis : this));
