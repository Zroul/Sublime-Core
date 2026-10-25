/**
 * Shared OBSIDIAN command planner.
 *
 * Uses a tiny, explicit local knowledge base to answer basic motion-design
 * questions and map familiar language to a narrow set of approved host actions.
 * It does not use an LLM, inspect pixels, or invent unsupported edits.
 */
(function (root) {
  "use strict";

  var SUPPORTED_ACTIONS = {
    inspect_project: true,
    inspect_selection: true,
    set_opacity: true,
    reduce_opacity: true,
    scale_selected: true,
    fade_in: true
  };

  var KNOWLEDGE = root.OBSIDIANKnowledge || { concepts: [], answers: [], guardrails: [] };

  function normalize(text) {
    return String(text === undefined || text === null ? "" : text)
      .trim()
      .toLowerCase()
      .replace(/(\d)\.(\d)/g, "$1~$2")
      .replace(/[^a-z0-9%\s~-]/g, " ")
      .replace(/~/g, ".")
      .replace(/\s+/g, " ");
  }

  function hasCue(cues, command) {
    var paddedCommand = " " + command + " ";
    for (var i = 0; i < cues.length; i++) {
      var cue = normalize(cues[i]);
      if (cue && paddedCommand.indexOf(" " + cue + " ") !== -1) return true;
    }
    return false;
  }

  function concept(name) {
    var concepts = KNOWLEDGE.concepts || [];
    for (var i = 0; i < concepts.length; i++) {
      if (concepts[i].name === name || concepts[i].id === name) return concepts[i];
    }
    return null;
  }

  function findKnowledgeAnswer(command) {
    var isQuestion = /^(what|why|how|when|explain|tell me|teach me)\b/.test(command) ||
      /\?$/.test(command);
    if (!isQuestion) return null;
    var answers = KNOWLEDGE.answers || [];
    for (var i = 0; i < answers.length; i++) {
      if (hasCue(answers[i].cues || [], command)) return answers[i].answer;
    }
    return null;
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

    var answer = findKnowledgeAnswer(command);
    if (answer) {
      return { status: "knowledge_answer", answer: answer, confidence: 0.9 };
    }

    if (/\b(inspect|show|analyze|analyse|check)\b/.test(command) &&
        /\b(project|composition|comp)\b/.test(command)) {
      return result("inspect_project", {}, "Read the active composition and project state.");
    }

    if (/\b(inspect|show|analyze|analyse|check)\b/.test(command) &&
        /\b(selected|selection|layer|layers)\b/.test(command)) {
      return result("inspect_selection", {}, "Read the selected layers and their current properties.");
    }

    var scaleIntent = /\b(scale|resize)\b/.test(command) &&
      (/\bselected layers?\b/.test(command) || /\bselection\b/.test(command));
    if (scaleIntent) {
      var scaleUp = /\b(up|increase|grow|bigger|larger)\b/.test(command);
      var scaleDown = /\b(down|decrease|reduce|lower|shrink|smaller)\b/.test(command);
      var scaleAmounts = command.match(/-?\d+(?:\.\d+)?\s*%/g) || [];
      var scaleMatch = command.match(/\bby\s+(-?\d+(?:\.\d+)?)\s*%/);
      if (scaleUp === scaleDown || scaleAmounts.length !== 1 || !scaleMatch) {
        return {
          status: "needs_clarification",
          question: "Specify whether to scale the selected layers up or down, and by one percentage from 1% to 100%. Downward changes must be less than 100%."
        };
      }
      var scalePercent = Number(scaleMatch[1]);
      if (!isFinite(scalePercent) || scalePercent < 1 || scalePercent > 100 ||
          (scaleDown && scalePercent >= 100)) {
        return {
          status: "needs_clarification",
          question: "Scale change must be 1% to 100% up, or 1% to less than 100% down."
        };
      }
      var signedScalePercent = scaleUp ? scalePercent : -scalePercent;
      return result(
        "scale_selected",
        { value: signedScalePercent },
        "Scale every selected layer proportionally by " + scalePercent + "% " + (scaleUp ? "up" : "down") + ". Existing scale keyframes and expressions are preserved by refusing the edit."
      );
    }

    var opacityIntent = /\b(?:set|change)\s+(?:the\s+)?opacity\b/.test(command);
    var opacity = command.match(/\b(?:set|change)\s+(?:the\s+)?opacity\s+(?:to\s+)?(-?\d+(?:\.\d+)?)(?:\s*%)?(?=\s|$)/);
    if (opacity) {
      var value = Number(opacity[1]);
      var opacityRemainder = command.slice(opacity.index + opacity[0].length);
      if (/^\s+\d/.test(opacityRemainder) || !isFinite(value) || value < 0 || value > 100) {
        return { status: "needs_clarification", question: "Opacity must be between 0% and 100%." };
      }
      return result("set_opacity", { value: value }, "Set selected-layer opacity to " + value + "%.");
    }
    if (opacityIntent) {
      return { status: "needs_clarification", question: "Enter one opacity value between 0% and 100%." };
    }

    if (/\b(reduce|lower|decrease)\s+(?:the\s+)?opacity\b/.test(command)) {
      return result("reduce_opacity", {}, "Reduce selected-layer opacity using the host's guarded default step.");
    }

    if (/\b(remove|delete)\s+(?:the\s+)?glow\b/.test(command)) {
      return {
        status: "blocked",
        readiness: "BLOCKED",
        action: "remove_glow",
        executable: false,
        explanation: "Glow mutations are disabled during the After Effects crash investigation. No changes were made."
      };
    }

    var cinematic = concept("cinematic_glow");
    var attention = concept("attention_glow");
    var cinematicCue = cinematic && hasCue(cinematic.cues, command);
    var attentionCue = attention && hasCue(attention.cues, command);
    var glowVerb = /\b(add|apply|use|put|give|create|make|set|change|adjust|tune|increase|decrease|reduce|tweak)\b|\bturn\s+(up|down)\b/.test(command);
    var glowMention = /\bglow\b|\bbloom\b/.test(command);
    var titlePopIntent = /\b(make|give|help)\b/.test(command) &&
      /\b(title|text|subject|this)\b/.test(command) &&
      /\b(pop|stand out|eye catching|eye-catching)\b/.test(command);

    if ((glowMention && (glowVerb || cinematicCue || attentionCue)) ||
        (titlePopIntent && attentionCue)) {
      if (cinematicCue && attentionCue) {
        return {
          status: "needs_clarification",
          question: "Do you want a restrained cinematic Glow or a bold neon/attention bloom?",
          options: ["cinematic", "attention"]
        };
      }
      var profile = cinematicCue ? "cinematic" : attentionCue ? "attention" : "unspecified";
      var note = profile === "cinematic" && cinematic.note
        ? cinematic.note
        : profile === "attention" && attention.note
          ? attention.note
          : "The desired Glow treatment is unspecified.";
      return {
        status: "blocked",
        action: "add_glow",
        readiness: "BLOCKED",
        executable: false,
        args: { profile: profile },
        explanation: (profile === "cinematic"
          ? "Restrained cinematic Glow intent detected. "
          : profile === "attention"
            ? "Bold neon/attention bloom intent detected. "
            : "Glow intent detected without a visual profile. ") +
          "Glow mutations are blocked during the crash investigation; no change was made. " + note,
        confidence: profile === "unspecified" ? 0.65 : 0.85
      };
    }

    var fade = concept("fade_in");
    if (/\bfade\s*in\b/.test(command) ||
        (fade && hasCue(fade.cues, command) &&
         /\b(add|apply|make|give|create|use)\b/.test(command))) {
      return result(
        "fade_in",
        {},
        "Apply the guarded fade-in only if existing opacity animation can be preserved.",
        0.85
      );
    }

    var readability = concept("readability");
    if (readability && hasCue(readability.cues, command)) {
      return {
        status: "needs_clarification",
        question: "I can inspect the selected layers, but I cannot judge visual readability from pixels yet. Want me to inspect the selected layers first?"
      };
    }

    var stylePlanner = root.OBSIDIANStyleRecipes;
    if (stylePlanner && typeof stylePlanner.planStyle === "function") {
      var stylePlan = stylePlanner.planStyle(command);
      if (stylePlan.status === "style_plan") {
        return {
          status: "style_plan",
          recipe: stylePlan.recipe,
          readiness: stylePlan.readiness,
          executable: false,
          explanation: "A creative direction plan, not an executed or visually verified edit.",
          confidence: 0.75
        };
      }
      if (stylePlan.status === "needs_clarification") return stylePlan;
    }

    return {
      status: "unsupported",
      question: "I don't know a safe edit for that request yet. I understand project/layer inspection, opacity, Glow, and fade-in. Try one of those, or ask me a basic motion-design question."
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
