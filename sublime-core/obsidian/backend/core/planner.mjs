/**
 * Node-testable facade for the same planner loaded by the CEP frontend.
 * Keep one implementation so browser behavior and unit tests cannot drift.
 */
import "../../frontend/knowledge.js";
import "../../frontend/style-recipes.js";
import "../../frontend/planner.shared.js";

const planner = globalThis.OBSIDIANPlanner;

export const planObsidianCommand = planner.planObsidianCommand;
export const isExecutablePlan = planner.isExecutablePlan;
