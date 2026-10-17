/**
 * OBSIDIAN command planner v1.
 *
 * This module is intentionally deterministic and side-effect free. It turns
 * common editing language into a typed proposal; it never edits an AE project.
 * Execution remains the responsibility of the guarded ExtendScript host bridge.
 */

const SUPPORTED_ACTIONS = new Set([
  "inspect_project",
  "inspect_selection",
  "set_opacity",
  "reduce_opacity",
  "add_glow",
  "remove_glow",
  "fade_in",
]);

function normalize(text) {
  return String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function result(action, args = {}, explanation, confidence = 1) {
  return { status: "planned", action, args, explanation, confidence };
}

export function planObsidianCommand(input) {
  const command = normalize(input);
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

  const opacity = command.match(/\b(?:set|change)\s+(?:the\s+)?opacity\s+(?:to\s+)?(\d{1,3})\s*%?/);
  if (opacity) {
    const value = Number(opacity[1]);
    if (value > 100) {
      return { status: "needs_clarification", question: "Opacity must be between 0% and 100%." };
    }
    return result("set_opacity", { value }, `Set selected-layer opacity to ${value}%.`);
  }

  if (/\b(reduce|lower|decrease)\s+(?:the\s+)?opacity\b/.test(command)) {
    return result("reduce_opacity", {}, "Reduce selected-layer opacity using the host's guarded default step.");
  }

  if (/\b(remove|delete)\s+(?:the\s+)?glow\b/.test(command)) {
    return result("remove_glow", {}, "Remove Glow from selected layers and verify the result.");
  }

  if (/\bglow\b/.test(command) && /\b(add|apply|use|put)\b/.test(command)) {
    const cinematic = /\b(cinematic|subtle|soft|restrained|atmospheric|film)\b/.test(command);
    const attention = /\b(bold|strong|intense|punchy|attention|pop|flashy|dramatic)\b/.test(command);
    if (cinematic && attention) {
      return {
        status: "needs_clarification",
        question: "Do you want a subtle cinematic glow or a bold attention-grabbing glow?",
      };
    }
    const profile = cinematic ? "cinematic" : attention ? "attention" : "unspecified";
    return {
      status: "planned",
      action: "add_glow",
      args: { profile },
      explanation: profile === "cinematic"
        ? "The request describes a restrained cinematic treatment. The current host supports only basic Glow, so this profile is a proposal—not a claim that calibrated glow settings are implemented."
        : profile === "attention"
          ? "The request describes a bold attention-grabbing treatment. The current host supports only basic Glow, so this profile is a proposal—not a claim that calibrated glow settings are implemented."
          : "Add basic Glow. The request does not specify a visual treatment.",
      confidence: profile === "unspecified" ? 0.65 : 0.8,
    };
  }

  if (/\bfade\s*in\b/.test(command)) {
    return result("fade_in", {}, "Apply the host's guarded fade-in only if existing animation can be preserved.");
  }

  return {
    status: "unsupported",
    question: "I can't safely map that request to a supported OBSIDIAN action yet. Inspect the project first or choose a supported operation: opacity, basic Glow, fade-in, or inspection.",
  };
}

export function isExecutablePlan(plan) {
  return Boolean(plan && plan.status === "planned" && SUPPORTED_ACTIONS.has(plan.action));
}
