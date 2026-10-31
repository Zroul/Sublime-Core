(function (root) {
  "use strict";

  var RECIPES = [
    {
      id: "cinematic_glow",
      name: "Cinematic Glow",
      status: "IMPLEMENTED",
      cues: ["cinematic glow look", "restrained cinematic glow treatment"],
      requiredInputs: ["active composition", "one or more selected unlocked layers", "no selected layer already has Glow"],
      operations: [
        {
          order: 1,
          action: "add_glow",
          parameters: { profile: "cinematic", threshold: 76, radius: 24, intensity: 0.25 },
          verification: "Verify the Glow effect exists and read back threshold, radius, and intensity on every selected layer."
        }
      ],
      parameterBounds: { threshold: { min: 76, max: 76 }, radius: { min: 24, max: 24 }, intensity: { min: 0.25, max: 0.25 } },
      compatibility: ["Native ADBE Glo2 effect is available", "Existing Glow instances are preserved by refusing the edit"],
      expectedResult: "Add a restrained neutral Glow bloom; no color grade or neon treatment is implied.",
      failureHandling: "Preflight all selected layers; remove only Glow effects created by this operation if any property or read-back check fails."
    },
    {
      id: "dark_dramatic",
      name: "Dark and Dramatic",
      status: "IMPLEMENTED",
      cues: ["dark and dramatic look", "dark dramatic look", "dark dramatic grade"],
      requiredInputs: ["active composition", "one or more selected unlocked layers", "no selected layer already has Brightness & Contrast"],
      operations: [
        {
          order: 1,
          action: "set_brightness_contrast",
          parameters: { brightness: -12, contrast: 14 },
          verification: "Read back Brightness -12 and Contrast 14 on every selected layer."
        }
      ],
      parameterBounds: { brightness: { min: -25, max: 25 }, contrast: { min: -25, max: 25 } },
      compatibility: ["Native Brightness & Contrast effect is available", "Existing Brightness & Contrast instances are preserved by refusing the edit"],
      expectedResult: "Apply a bounded darker, moderately higher-contrast tonal treatment; no color tint is implied.",
      failureHandling: "Preflight all selected layers; remove newly added Brightness & Contrast effects if parameter validation or read-back fails."
    },
    {
      id: "high_contrast",
      name: "High Contrast",
      status: "IMPLEMENTED",
      cues: ["high contrast look", "apply high contrast", "make it high contrast"],
      requiredInputs: ["active composition", "one or more selected unlocked layers", "no selected layer already has Brightness & Contrast"],
      operations: [
        {
          order: 1,
          action: "set_brightness_contrast",
          parameters: { brightness: 0, contrast: 20 },
          verification: "Read back Brightness 0 and Contrast 20 on every selected layer."
        }
      ],
      parameterBounds: { brightness: { min: -25, max: 25 }, contrast: { min: -25, max: 25 } },
      compatibility: ["Native Brightness & Contrast effect is available", "Existing Brightness & Contrast instances are preserved by refusing the edit"],
      expectedResult: "Apply a bounded contrast increase while leaving Brightness at its neutral value; no color tint is implied.",
      failureHandling: "Preflight all selected layers; remove newly added Brightness & Contrast effects if parameter validation or read-back fails."
    },
    {
      id: "gentle_entrance",
      name: "Gentle Entrance",
      status: "IMPLEMENTED",
      cues: ["gentle entrance", "gentle title entrance", "fade and scale in", "soft entrance"],
      requiredInputs: ["active composition", "one or more selected unlocked layers"],
      operations: [
        {
          order: 1,
          action: "fade_in",
          parameters: { durationSeconds: 0.5, startOpacity: 0, endOpacity: "existing static value" },
          verification: "Read back two opacity keys at the requested times and values."
        },
        {
          order: 2,
          action: "scale_in",
          parameters: { durationSeconds: 0.5, startScalePercent: 95, endScale: "existing static value" },
          verification: "Read back two Scale keys at the requested times and values."
        }
      ],
      parameterBounds: { durationSeconds: { min: 0.5, max: 0.5 }, startScalePercent: { min: 95, max: 95 } },
      compatibility: ["Unified 2D or 3D Scale property", "Static opacity and Scale", "No existing opacity or Scale keys or expressions"],
      expectedResult: "Selected layers fade from zero opacity while scaling from 95% to their current Scale over 0.5 seconds.",
      failureHandling: "Preflight every selected layer before mutation; remove only the generated keys if either operation fails verification."
    }
  ];

  function normalize(text) {
    return String(text === undefined || text === null ? "" : text)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ");
  }

  function getRecipe(id) {
    for (var i = 0; i < RECIPES.length; i++) {
      if (RECIPES[i].id === id) return RECIPES[i];
    }
    return null;
  }

  function planCreativeRecipe(input) {
    var command = normalize(input);
    for (var i = 0; i < RECIPES.length; i++) {
      var recipe = RECIPES[i];
      for (var j = 0; j < recipe.cues.length; j++) {
        var cue = normalize(recipe.cues[j]);
        if (command === cue || (" " + command + " ").indexOf(" " + cue + " ") !== -1) {
          return recipe;
        }
      }
    }
    return null;
  }

  root.OBSIDIANCreativeRecipes = {
    getRecipe: getRecipe,
    planCreativeRecipe: planCreativeRecipe,
    isExecutableRecipe: function (id) {
      var recipe = getRecipe(id);
      return Boolean(recipe && recipe.status === "IMPLEMENTED");
    }
  };
}(typeof globalThis !== "undefined" ? globalThis : this));
