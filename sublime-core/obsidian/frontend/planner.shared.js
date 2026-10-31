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
    inspect_caption_source: true,
    create_captions: true,
    set_opacity: true,
    reduce_opacity: true,
    scale_selected: true,
    set_scale: true,
    scale_in: true,
    slide_up: true,
    crossfade: true,
    apply_recipe: true,
    set_brightness_contrast: true,
    fade_in: true,
    fade_out: true,
    add_glow: true,
    remove_glow: true
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

    if ((/\b(?:generate|create|make|transcribe|add)\b/.test(command) && /\b(?:captions?|subtitles?)\b/.test(command)) ||
        /\b(?:captions?|subtitles?)\s+(?:for|from)\s+(?:this|the)\s+(?:video|footage)\b/.test(command)) {
      return {
        status: "caption_workflow",
        captionMode: /\b(?:word[\s-]+by[\s-]+word|one word at a time)\b/.test(command) ? "word" : "phrase",
        explanation: "Transcribe the selected local footage for review. Nothing is added to the composition until you approve caption creation."
      };
    }

    if (/\b(inspect|show|analyze|analyse|check)\b/.test(command) &&
        /\b(project|composition|comp)\b/.test(command)) {
      return result("inspect_project", {}, "Read the active composition and project state.");
    }

    if (/\b(inspect|show|analyze|analyse|check)\b/.test(command) &&
        /\b(captions?|subtitles?|transcription|audio source)\b/.test(command)) {
      return result("inspect_caption_source", {}, "Read the selected local footage path and timing so its audio can be transcribed locally.");
    }

    if (/\b(inspect|show|analyze|analyse|check)\b/.test(command) &&
        /\b(selected|selection|layer|layers)\b/.test(command)) {
      return result("inspect_selection", {}, "Read the selected layers and their current properties.");
    }

    var brightnessIntent = /\b(?:set|change|increase|raise|boost|decrease|lower|reduce)\s+(?:the\s+)?brightness\b/.test(command);
    var contrastIntent = /\b(?:set|change|increase|raise|boost|decrease|lower|reduce)\s+(?:the\s+)?contrast\b/.test(command);
    if (brightnessIntent || contrastIntent) {
      var brightnessMatch = command.match(/\bbrightness\s+(?:(to|by)\s+)?(-?\d+(?:\.\d+)?)/);
      var contrastMatch = command.match(/\bcontrast\s+(?:(to|by)\s+)?(-?\d+(?:\.\d+)?)/);
      if ((brightnessIntent && !brightnessMatch) || (contrastIntent && !contrastMatch)) {
        return { status: "needs_clarification", question: "Set Brightness and/or Contrast to a value from -25 to 25." };
      }
      var decreaseBrightness = /\b(?:decrease|lower|reduce)\s+(?:the\s+)?brightness\b/.test(command);
      var increaseBrightness = /\b(?:increase|raise|boost)\s+(?:the\s+)?brightness\b/.test(command);
      var decreaseContrast = /\b(?:decrease|lower|reduce)\s+(?:the\s+)?contrast\b/.test(command);
      var increaseContrast = /\b(?:increase|raise|boost)\s+(?:the\s+)?contrast\b/.test(command);

      function adjustmentValue(match, decrease, increase) {
        if (!match) return 0;
        var value = Number(match[2]);
        if (match[1] === "by") {
          if (value < 0) return null;
          return decrease ? -value : value;
        }
        if (match[1] === "to") {
          if ((decrease && value > 0) || (increase && value < 0)) return null;
          return value;
        }
        if (decrease) return Math.abs(value) * -1;
        if (increase) return Math.abs(value);
        return value;
      }

      var brightnessValue = adjustmentValue(brightnessMatch, decreaseBrightness, increaseBrightness);
      var contrastValue = adjustmentValue(contrastMatch, decreaseContrast, increaseContrast);
      if (brightnessValue === null || contrastValue === null) {
        return { status: "needs_clarification", question: "The requested adjustment direction conflicts with its value." };
      }
      if (!isFinite(brightnessValue) || !isFinite(contrastValue) ||
          Math.abs(brightnessValue) > 25 || Math.abs(contrastValue) > 25) {
        return { status: "needs_clarification", question: "Brightness and Contrast must each be between -25 and 25." };
      }
      return result(
        "set_brightness_contrast",
        { brightness: brightnessValue, contrast: contrastValue },
        "Apply the native Brightness & Contrast effect with bounded values; existing effect instances are preserved by refusing the edit, and the host reads both values back."
      );
    }

    if (/\bcross[\s-]*fade\b/.test(command)) {
      return result(
        "crossfade",
        {},
        "Crossfade exactly two selected overlapping layers, preserving existing opacity animation by refusing the edit."
      );
    }

    if (/\b(?:scale[\s-]*in|pop[\s-]*in)\b/.test(command)) {
      return result(
        "scale_in",
        {},
        "Animate selected layers from 95% to their current Scale over 0.5 seconds; existing Scale animation is preserved by refusing the edit."
      );
    }

    if (/\bslide(?:[\s-]+up|\s+(?:the\s+)?(?:selected\s+)?layers?\s+(?:up|upwards))\b/.test(command)) {
      return result(
        "slide_up",
        {},
        "Move selected layers upward by 40 pixels over 0.5 seconds; existing Position animation is preserved by refusing the edit."
      );
    }

    var absoluteScale = command.match(/\b(?:set\s+(?:the\s+)?)?scale(?:\s+(?:of\s+)?(?:the\s+)?selected\s+layers?)?\s+(?:up\s+|down\s+)?to\s+(-?\d+(?:\.\d+)?)\s*%(?=\s|$)/);
    if (absoluteScale) {
      var absoluteAmounts = command.match(/-?\d+(?:\.\d+)?\s*%/g) || [];
      var absoluteValue = Number(absoluteScale[1]);
      if (absoluteAmounts.length !== 1 || !isFinite(absoluteValue) || absoluteValue < 0 || absoluteValue > 1000) {
        return { status: "needs_clarification", question: "Scale to a value from 0% to 1000%; provide one target value." };
      }
      return result(
        "set_scale",
        { value: absoluteValue },
        "Set every selected layer's Scale to exactly " + absoluteValue + "% on each supported dimension. This is an absolute target; use 'scale up by' or 'scale down by' for a relative change."
      );
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

    var creativeRecipes = root.OBSIDIANCreativeRecipes;
    var creativeRecipe = creativeRecipes && creativeRecipes.planCreativeRecipe(command);
    if (creativeRecipe && creativeRecipe.status === "IMPLEMENTED") {
      return result(
        "apply_recipe",
        { recipeId: creativeRecipe.id },
        creativeRecipe.expectedResult + " The host preflights and verifies each operation in order."
      );
    }

    if (/\b(remove|delete)\s+(?:the\s+)?glow\b/.test(command)) {
      return result(
        "remove_glow",
        {},
        "Remove Glow from the selected layer(s); the host must verify the result.",
        0.85
      );
    }

    // Resolve the user's direct answer to the Glow-style clarification.
    // Exact one-word choices are intentional; broader vibe requests remain proposals.
    if (command === "cinematic") {
      return result(
        "add_glow",
        { profile: "cinematic" },
        "Apply the restrained cinematic Glow preset; the host must verify the applied settings.",
        0.9
      );
    }
    if (command === "neon" || command === "attention") {
      return result(
        "add_glow",
        { profile: "attention" },
        "Apply the bold attention Glow bloom only; this does not create colored neon styling. The host must verify the applied settings.",
        0.9
      );
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
      if (profile === "unspecified") {
        return {
          status: "needs_clarification",
          question: "Which Glow treatment do you want: restrained cinematic Glow or bold neon/attention Glow?",
          options: ["cinematic", "attention"]
        };
      }
      var note = profile === "cinematic"
        ? (cinematic.note || "Use the restrained cinematic Glow preset.")
        : (attention.note || "Use the bold neon/attention Glow preset.");
      // Profile presets are the only Glow additions exposed as executable plans.
      // Requests for individual parameter tuning are not silently converted to presets.
      if (/\b(radius|threshold|intensity|strength|amount|spread)\b/.test(command)) {
        return {
          status: "needs_clarification",
          question: "I can apply the cinematic or attention Glow preset, but custom Glow parameter tuning is not supported yet."
        };
      }
      return result(
        "add_glow",
        { profile: profile },
        (profile === "cinematic"
          ? "Apply the recognized restrained cinematic Glow preset. "
          : "Apply the recognized bold attention Glow bloom only; this does not create colored neon styling. ") +
          "The host must verify the applied effect and parameter values. " + note,
        0.85
      );
    }

    if (/\bfade(?:[\s-]+(?:the[\s-]+)?(?:selected[\s-]+)?(?:layer[\s-]+)?)?out\b/.test(command)) {
      return result(
        "fade_out",
        {},
        "Apply the guarded fade-out only if existing opacity animation can be preserved.",
        0.85
      );
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
      question: "I don't know a safe edit for that request yet. I understand project/layer inspection, opacity, Brightness/Contrast, absolute and proportional Scale changes, Glow, fades, scale-in, slide-up, crossfade, and the Gentle Entrance recipe. Try one of those, or ask me a basic motion-design question."
    };
  }

  function planCaptionCreation(segments, source, style) {
    var captions = root.OBSIDIANCaptions;
    if (!captions || !source || typeof source !== "object" ||
        typeof source.path !== "string" || !source.path || source.path.length > 4096 ||
        typeof source.compName !== "string" || !source.compName || source.compName.length > 256 ||
        !isFinite(Number(source.layerIndex)) || Number(source.layerIndex) < 1 ||
        !isFinite(Number(source.inPoint)) || !isFinite(Number(source.outPoint)) ||
        !isFinite(Number(source.startTime)) || !isFinite(Number(source.stretch)) || Number(source.stretch) <= 0 ||
        !isFinite(Number(source.frameRate)) || Number(source.frameRate) <= 0 ||
        !isFinite(Number(source.compDuration)) || !isFinite(Number(source.compWidth)) ||
        !isFinite(Number(source.compHeight)) || !captions.isStyle(style)) {
      return { status: "needs_clarification", question: "The selected footage information or caption style is invalid. Inspect the source again before creating captions." };
    }
    var checked = captions.validateSegments(segments, Number(source.outPoint));
    if (!checked.ok) return { status: "needs_clarification", question: checked.error };
    for (var i = 0; i < checked.segments.length; i++) {
      if (checked.segments[i].start < Number(source.inPoint) - 0.001 ||
          checked.segments[i].end > Number(source.outPoint) + 0.001 ||
          checked.segments[i].end > Number(source.compDuration) + 0.001) {
        return { status: "needs_clarification", question: "Caption " + (i + 1) + " falls outside the selected footage layer." };
      }
    }
    return result(
      "create_captions",
      {
        source: {
          path: source.path,
          layerName: String(source.layerName || ""),
          layerId: source.layerId === undefined || source.layerId === null ? "" : String(source.layerId),
          layerIndex: Number(source.layerIndex),
          inPoint: Number(source.inPoint),
          outPoint: Number(source.outPoint),
          startTime: Number(source.startTime),
          stretch: Number(source.stretch),
          frameRate: Number(source.frameRate),
          compName: source.compName,
          compDuration: Number(source.compDuration),
          compWidth: Number(source.compWidth),
          compHeight: Number(source.compHeight)
        },
        segments: checked.segments,
        style: style
      },
      "Create " + checked.segments.length + " new timed caption text layer(s) in one undoable operation. The host rechecks the selected footage, validates every time range, applies the chosen fixed style, and reads each layer back."
    );
  }

  function isValidCaptionPlan(plan) {
    var args = plan && plan.args;
    if (!args || typeof args !== "object" || !args.source || typeof args.source !== "object" ||
        typeof args.source.path !== "string" || !args.source.path ||
        typeof args.source.compName !== "string" || !args.source.compName ||
        !isFinite(Number(args.source.layerIndex)) || Number(args.source.layerIndex) < 1 ||
        !isFinite(Number(args.source.inPoint)) || !isFinite(Number(args.source.outPoint)) ||
        !isFinite(Number(args.source.startTime)) || !isFinite(Number(args.source.stretch)) || Number(args.source.stretch) <= 0 ||
        !isFinite(Number(args.source.frameRate)) || !isFinite(Number(args.source.compDuration)) ||
        !isFinite(Number(args.source.compWidth)) || !isFinite(Number(args.source.compHeight)) ||
        !root.OBSIDIANCaptions || !root.OBSIDIANCaptions.isStyle(args.style)) return false;
    var checked = root.OBSIDIANCaptions.validateSegments(args.segments, Number(args.source.outPoint));
    if (!checked.ok) return false;
    return checked.segments.every(function (segment) {
      return segment.start >= Number(args.source.inPoint) - 0.001 &&
        segment.end <= Number(args.source.outPoint) + 0.001 &&
        segment.end <= Number(args.source.compDuration) + 0.001;
    });
  }

  function isExecutablePlan(plan) {
    if (!plan || plan.status !== "planned" || SUPPORTED_ACTIONS[plan.action] !== true) return false;
    if (plan.action === "apply_recipe") {
      var creativeRecipes = root.OBSIDIANCreativeRecipes;
      return Boolean(plan.args && creativeRecipes && creativeRecipes.isExecutableRecipe(plan.args.recipeId));
    }
    if (plan.action === "set_brightness_contrast") {
      return Boolean(plan.args && typeof plan.args.brightness === "number" &&
        typeof plan.args.contrast === "number" && Math.abs(plan.args.brightness) <= 25 &&
        Math.abs(plan.args.contrast) <= 25);
    }
    if (plan.action === "set_scale") {
      return Boolean(plan.args && typeof plan.args.value === "number" &&
        isFinite(plan.args.value) && plan.args.value >= 0 && plan.args.value <= 1000);
    }
    if (plan.action === "create_captions") return isValidCaptionPlan(plan);
    if (plan.action === "add_glow") {
      return Boolean(plan.args &&
        (plan.args.profile === "cinematic" || plan.args.profile === "attention"));
    }
    return true;
  }

  root.OBSIDIANPlanner = {
    planObsidianCommand: planObsidianCommand,
    isExecutablePlan: isExecutablePlan,
    planCaptionCreation: planCaptionCreation
  };
}(typeof globalThis !== "undefined" ? globalThis : this));
