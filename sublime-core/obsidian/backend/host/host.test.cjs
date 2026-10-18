const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

class CompItem {}
class TextLayer {}
class ShapeLayer {}
class AVLayer {}
class SolidSource {}

function scalarProperty(value) {
  return {
    value,
    setValue(next) { this.value = next; },
  };
}

function propertyGroup(children) {
  return {
    _children: children || [],
    get numProperties() { return this._children.length; },
    property(key) {
      if (typeof key === "number") return this._children[key - 1] || null;
      return this._children.find((item) => item.matchName === key || item.name === key) || null;
    },
    canAddProperty(matchName) {
      return matchName === "ADBE Glo2";
    },
    addProperty(matchName) {
      const group = this;
      const effect = {
        name: "Glow",
        matchName,
        remove() {
          const index = group._children.indexOf(effect);
          if (index >= 0) group._children.splice(index, 1);
        },
      };
      this._children.push(effect);
      return effect;
    },
  };
}

function makeTextLayer(name, index, opacityValue) {
  const opacity = scalarProperty(opacityValue);
  const position = scalarProperty([960, 540]);
  const scale = scalarProperty([100, 100]);
  const rotation = scalarProperty(0);
  const textDocument = scalarProperty({ text: "Launch faster", font: "ArialMT", fontSize: 64 });
  const transform = propertyGroup([
    Object.assign(opacity, { name: "Opacity", matchName: "ADBE Opacity" }),
    Object.assign(position, { name: "Position", matchName: "ADBE Position" }),
    Object.assign(scale, { name: "Scale", matchName: "ADBE Scale" }),
    Object.assign(rotation, { name: "Rotation", matchName: "ADBE Rotation" }),
  ]);
  const textProperties = propertyGroup([
    Object.assign(textDocument, { name: "Text Document", matchName: "ADBE Text Document" }),
  ]);
  const effects = propertyGroup([]);
  const layer = {
    name, index, enabled: true, threeDLayer: false, shy: false, locked: false,
    inPoint: 0, outPoint: 5,
    _opacity: opacity,
    property(key) {
      if (key === "ADBE Transform Group") return transform;
      if (key === "ADBE Effect Parade") return effects;
      if (key === "ADBE Text Properties") return textProperties;
      return null;
    },
  };
  Object.setPrototypeOf(layer, TextLayer.prototype);
  return layer;
}

function makeContext() {
  const layer = makeTextLayer("Headline", 1, 100);
  const comp = {
    name: "SaaS Hero",
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 5,
    time: 1.25,
    numLayers: 1,
    selectedLayers: [layer],
  };
  Object.setPrototypeOf(comp, CompItem.prototype);
  const project = { file: { fsName: "C:/mock/saas.aep" }, activeItem: comp };
  const context = {
    app: {
      project,
      beginUndoGroup() {},
      endUndoGroup() {},
    },
    CompItem, TextLayer, ShapeLayer, AVLayer, SolidSource,
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "host.jsx"), "utf8");
  vm.runInContext(source, context, { filename: "host.jsx" });
  return { context, layer, comp, project };
}

test("project inspection reports the active composition and selected text layer", () => {
  const { context } = makeContext();
  const result = context.OBSIDIAN_executePlan("inspect_project", null, "");
  assert.match(result, /PROJECT INSPECTION/);
  assert.match(result, /Composition: SaaS Hero/);
  assert.match(result, /Resolution: 1920 x 1080/);
  assert.match(result, /Selected layers: 1/);
  assert.match(result, /Headline/);
});

test("selected-layer inspection includes text and transform details", () => {
  const { context } = makeContext();
  const result = context.OBSIDIAN_executePlan("inspect_selection", null, "");
  assert.match(result, /SELECTION INSPECTION/);
  assert.match(result, /Text: Launch faster/);
  assert.match(result, /Font: ArialMT; Size: 64/);
  assert.match(result, /Position: \[960, 540\]/);
});

test("opacity command reads back and verifies the applied value", () => {
  const { context, layer } = makeContext();
  const result = context.OBSIDIAN_executePlan("set_opacity", 50, "");
  assert.equal(result, "OK|Verified opacity at 50% on 1 selected layer(s).");
  assert.equal(layer._opacity.value, 50);
});

test("commands fail safely when there is no active composition", () => {
  const { context, project } = makeContext();
  project.activeItem = null;
  const result = context.OBSIDIAN_executePlan("inspect_project", null, "");
  assert.match(result, /^ERROR\|No active composition/);
});

test("unsupported commands are rejected instead of silently claiming success", () => {
  const { context } = makeContext();
  const result = context.OBSIDIAN_executePlan("run_shell", null, "");
  assert.match(result, /^ERROR\|Unsupported planned action: run_shell/);
});

test("Glow add and remove are verified against the selected layer", () => {
  const { context } = makeContext();
  const added = context.OBSIDIAN_executePlan("add_glow", null, "unspecified");
  assert.match(added, /^OK\|Verified Glow on 1 selected layer\(s\); added 1 new effect\(s\)\. Requested profile: unspecified\. Profile is intent-only; calibrated Glow settings were not applied\.$/);

  const inspected = context.OBSIDIAN_executePlan("inspect_selection", null, "");
  assert.match(inspected, /Effects \(1\): Glow/);

  const removed = context.OBSIDIAN_executePlan("remove_glow", null, "");
  assert.match(removed, /^OK\|Verified Glow removed from selected layers\./);

  const afterRemoval = context.OBSIDIAN_executePlan("inspect_selection", null, "");
  assert.match(afterRemoval, /Effects \(0\): none/);
});

test("Glow removal reacquires the effect group and removes repeated Glow instances", () => {
  const { context, layer } = makeContext();
  const effects = layer.property("ADBE Effect Parade");
  effects.addProperty("ADBE Glo2");
  effects.addProperty("ADBE Glo2");

  const result = context.OBSIDIAN_executePlan("remove_glow", null, "");
  assert.match(result, /^OK\\|Verified Glow removed from selected layers\\./);
  assert.equal(layer.property("ADBE Effect Parade").numProperties, 0);
});

test("reduce opacity verifies the target value for each selected layer", () => {
  const { context, layer } = makeContext();
  const result = context.OBSIDIAN_executePlan("reduce_opacity", null, "");
  assert.equal(result, "OK|Verified opacity reduction on 1 selected layer(s).");
  assert.equal(layer._opacity.value, 80);
});

test("fade in refuses to run when the host cannot create opacity keyframes", () => {
  const { context } = makeContext();
  const result = context.OBSIDIAN_executePlan("fade_in", null, "");
  assert.equal(result, "ERROR|Opacity keyframes unavailable.");
});


test("host rejects out-of-range opacity instead of silently clamping it", () => {
  const { context, layer } = makeContext();
  const result = context.OBSIDIAN_executePlan("set_opacity", 140, "");
  assert.equal(result, "ERROR|Opacity must be a number between 0 and 100.");
  assert.equal(layer._opacity.value, 100);
});

test("host rejects unknown Glow profiles before making an edit", () => {
  const { context, layer } = makeContext();
  const result = context.OBSIDIAN_executePlan("add_glow", null, "run_shell");
  assert.equal(result, "ERROR|Unsupported Glow profile.");
  assert.equal(context.OBSIDIAN_getEffectNames(layer).length, 0);
});


test("host rejects a missing opacity argument", () => {
  const { context, layer } = makeContext();
  const result = context.OBSIDIAN_executePlan("set_opacity", null, "");
  assert.equal(result, "ERROR|Opacity must be a number between 0 and 100.");
  assert.equal(layer._opacity.value, 100);
});
