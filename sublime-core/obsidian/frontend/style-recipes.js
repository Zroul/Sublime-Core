/* OBSIDIAN style recipes: descriptive plans only, not host-executable edits. */
(function (root) {
  "use strict";

  var RECIPES = [
    {
      id: "neon_dream_city",
      name: "Neon Dream City",
      cues: ["neon", "dream city", "dreamy city", "cyberpunk", "futuristic neon"],
      intent: ["futuristic", "dreamy", "surreal"],
      look: {
        palette: ["cyan", "magenta", "deep blue"],
        lighting: ["controlled glow on bright highlights", "selective bloom"],
        atmosphere: ["soft haze if source footage supports it"],
        contrast: "preserve dark detail; keep highlights from clipping"
      },
      steps: [
        { label: "Inspect footage and selected layers", status: "read_only_action_available" },
        { label: "Build cyan / magenta / deep-blue color grade", status: "not_implemented" },
        { label: "Apply selective Glow to suitable highlights", status: "blocked_pending_crash_investigation" },
        { label: "Add subtle atmospheric haze if appropriate", status: "not_implemented" },
        { label: "Verify highlight detail and readability", status: "not_implemented" }
      ],
      requirements: ["inspect footage and selected layers", "confirm suitable bright areas or light sources"],
      cautions: ["color grading and haze are not yet executable by OBSIDIAN", "Glow stays blocked pending the crash investigation", "avoid applying Glow blindly to every layer"]
    },
    {
      id: "cinematic",
      name: "Cinematic",
      cues: ["cinematic", "filmic", "movie look"],
      intent: ["restrained", "atmospheric", "film-inspired"],
      look: {
        palette: ["chosen to suit the footage"],
        lighting: ["restrained highlight bloom"],
        atmosphere: ["controlled contrast"],
        contrast: "retain texture and shadow detail"
      },
      requirements: ["inspect footage before choosing parameters"],
      cautions: ["a style label alone is not enough to choose calibrated effect values"]
    },
    {
      id: "high_energy",
      name: "High Energy",
      cues: ["punchy", "high energy", "aggressive edit", "intense"],
      intent: ["fast", "bold", "high contrast"],
      look: {
        palette: ["strong accent color"],
        lighting: ["selective emphasis"],
        motion: ["consider motion blur only where movement warrants it"],
        contrast: "keep the subject and text readable"
      },
      requirements: ["inspect motion and subject placement"],
      cautions: ["do not invent cuts, timing, or footage analysis without inspecting the media"]
    },
    {
      id: "nostalgic",
      name: "Nostalgic",
      cues: ["nostalgic", "retro", "vintage", "old film"],
      intent: ["warm", "softened", "era-inspired"],
      look: {
        palette: ["warm or faded tones chosen for the footage"],
        lighting: ["softened highlights"],
        texture: ["grain only if available and appropriate"],
        contrast: "avoid crushing detail"
      },
      requirements: ["inspect footage and ask which era if the reference is ambiguous"],
      cautions: ["specific film-stock emulation is not currently implemented"]
    }
  ];

  function normalize(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function matchesCue(command, cue) {
    return (" " + command + " ").indexOf(" " + cue + " ") !== -1;
  }

  function planStyle(input) {
    var command = normalize(input);
    if (!command) return { status: "needs_clarification", question: "Describe the look you want." };

    var matches = [];
    for (var i = 0; i < RECIPES.length; i++) {
      for (var j = 0; j < RECIPES[i].cues.length; j++) {
        if (matchesCue(command, normalize(RECIPES[i].cues[j]))) {
          matches.push(RECIPES[i]);
          break;
        }
      }
    }

    if (matches.length === 0) {
      return {
        status: "unsupported",
        question: "I don't have a tested style recipe for that description yet.",
        executable: false
      };
    }

    if (matches.length > 1) {
      return {
        status: "needs_clarification",
        question: "Your request matches multiple styles. Which should lead?",
        options: matches.map(function (item) { return item.id; }),
        executable: false
      };
    }

    return {
      status: "style_plan",
      recipe: matches[0],
      executable: false,
      note: "This is a creative direction plan, not an executed or visually verified edit."
    };
  }

  root.OBSIDIANStyleRecipes = {
    version: "0.1.0",
    list: function () { return RECIPES.slice(); },
    planStyle: planStyle
  };
}(typeof globalThis !== "undefined" ? globalThis : this));
