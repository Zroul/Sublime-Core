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
    add_glow: true,
    remove_glow: true,
    fade_in: true
  };

  var KNOWLEDGE = root.OBSIDIANKnowledge || { concepts: [], answers: [], guardrails: [] };

  function normalize(text) {
    return String(text === undefined || text === null ? "" : text)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9%\s-]/g, " ")
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

    var cinematic = concept("cinematic_glow");
    var attention = concept("attention_glow");
    var cinematicCue = cinematic && hasCue(cinematic.cues, command);
    var attentionCue = attention && hasCue(attention.cues, command);
    var glowVerb = /\b(add|apply|use|put|give|create|make)\b/.test(command);
    var glowMention = /\bglow\b|\bbloom\b/.test(command);
    var titlePopIntent = /\b(make|give|help)\b/.test(command) &&
      /\b(title|text|subject|this)\b/.test(command) &&
      /\b(pop|stand out|eye catching|eye-catching)\b/.test(command);

    if ((glowMention && (glowVerb || cinematicCue || attentionCue)) ||
        (titlePopIntent && attentionCue)) {
      if (cinematicCue && attentionCue) {
        return {
          status: "needs_clarification",
          question: "Do you want a restrained cinematic Glow or a bold attention-grabbing Glow?"
        };
      }
      var profile = cinematicCue ? "cinematic" : attentionCue ? "attention" : "unspecified";
      var note = profile === "cinematic" && cinematic.note
        ? cinematic.note
        : profile === "attention" && attention.note
          ? attention.note
          : "Use the basic Glow effect without assuming a specific visual treatment.";
      return {
        status: "planned",
        action: "add_glow",
        args: { profile: profile },
        explanation: (profile === "cinematic"
          ? "Cinematic intent detected. This is a proposal—not a claim of calibrated execution; calibrated Glow settings are not implemented, and the host currently adds basic Glow only. "
          : profile === "attention"
            ? "Attention-grabbing intent detected. This is a proposal—not a claim of calibrated execution; calibrated Glow settings are not implemented, and the host currently adds basic Glow only. "
            : "Add basic Glow. The request does not specify a visual treatment. ") + note,
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
          explanation: stylePlan.note,
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
