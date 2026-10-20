/**
 * Shared OBSIDIAN command planner.
 *
 * Kept as a plain browser script so CEP can load it without a Node backend or
 * browser-module/CORS assumptions. planner.mjs exposes the same implementation
 * to Node tests.
 */
(function (root) {
  "use strict";

  var SUPPORTED_ACTIONS = {
    inspect_project: true,
    inspect_selection: true,
    set_opacity: true,
    reduce_opacity: true,
    add_glow: true,
    remove_glow: true,
    fade_in: true
  };

  var KNOWLEDGE = root.OBSIDIANKnowledge || { concepts: [] };

  function hasCue(conceptName, fallbackCues, command) {
    var concepts = KNOWLEDGE.concepts || [];
    for (var i = 0; i < concepts.length; i++) {
      if (concepts[i].name === conceptName) {
        for (var j = 0; j < concepts[i].cues.length; j++) {
          if (command.indexOf(concepts[i].cues[j]) !== -1) return true;
        }
      }
    }
    for (var k = 0; k < fallbackCues.length; k++) {
      if (command.indexOf(fallbackCues[k]) !== -1) return true;
    }
    return false;
  }

  function normalize(text) {
    return String(text === undefined || text === null ? "" : text)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function result(action, args, explanation, confidence) {
    return {
      status: "planned",
      action: action,
      args: args || {},
      explanation: explanation,
      confidence: confidence === undefined ? 1 : confidence
    };
  }

  function planObsidianCommand(input) {
    var command = normalize(input);
    if (!command) {
      return { status: "needs_clarification", question: "What would you like OBSIDIAN to do?" };
    }

    if (/\b(inspect|show|analy[sz]e|check)\b/.test(command) &&
        /\b(project|composition|comp)\b/.test(command)) {
      return result("inspect_project", {}, "Read the active composition and project state.");
    }

    if (/\b(inspect|show|analy[sz]e|check)\b/.test(command) &&
        /\b(selected|selection|layer|layers)\b/.test(command)) {
      return result("inspect_selection", {}, "Read the selected layers and their current properties.");
    }

    var opacity = command.match(/\b(?:set|change)\s+(?:the\s+)?opacity\s+(?:to\s+)?(\d{1,3})\s*%?/);
    if (opacity) {
      var value = Number(opacity[1]);
      if (value > 100) {
        return { status: "needs_clarification", question: "Opacity must be between 0% and 100%." };
      }
      return result("set_opacity", { value: value }, "Set selected-layer opacity to " + value + "%.");
    }

    if (/\b(reduce|lower|decrease)\s+(?:the\s+)?opacity\b/.test(command)) {
      return result("reduce_opacity", {}, "Reduce selected-layer opacity using the host's guarded default step.");
    }

    if (/\b(remove|delete)\s+(?:the\s+)?glow\b/.test(command)) {
      return result("remove_glow", {}, "Remove Glow from selected layers and verify the result.");
    }

    var requestsGlow = /\b(add|apply|use|put|give|create|make)\b/.test(command) ||
      /\b(subtle|cinematic|soft|restrained|atmospheric|bold|strong|intense|punchy|flashy|dramatic)\b/.test(command);
    if (/\bglow\b/.test(command) && requestsGlow) {
      var cinematic = /\b(cinematic|subtle|soft|restrained|atmospheric|film)\b/.test(command);
      var attention = /\b(bold|strong|intense|punchy|attention|pop|flashy|dramatic)\b/.test(command);
      if (cinematic && attention) {
        return {
          status: "needs_clarification",
          question: "Do you want a subtle cinematic glow or a bold attention-grabbing glow?"
        };
      }
      var profile = cinematic ? "cinematic" : attention ? "attention" : "unspecified";
      return {
        status: "planned",
        action: "add_glow",
        args: { profile: profile },
        explanation: profile === "cinematic"
          ? "Cinematic intent detected. The host currently adds basic Glow only; calibrated cinematic settings are not implemented."
          : profile === "attention"
            ? "Attention-grabbing intent detected. The host currently adds basic Glow only; calibrated attention settings are not implemented."
            : "Add basic Glow. The request does not specify a visual treatment.",
        confidence: profile === "unspecified" ? 0.65 : 0.8
      };
    }

    if (/\bfade\s*in\b/.test(command)) {
      return result("fade_in", {}, "Apply the host's guarded fade-in only if existing animation can be preserved.");
    }

    return {
      status: "unsupported",
      question: "I can't safely map that request to a supported OBSIDIAN action yet. Supported operations: project/layer inspection, opacity, basic Glow, and fade-in."
    };
  }

  function isExecutablePlan(plan) {
    return Boolean(plan && plan.status === "planned" && SUPPORTED_ACTIONS[plan.action] === true);
  }

  root.OBSIDIANPlanner = {
    planObsidianCommand: planObsidianCommand,
    isExecutablePlan: isExecutablePlan
  };
}(typeof globalThis !== "undefined" ? globalThis : this));
