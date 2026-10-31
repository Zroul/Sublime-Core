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
class FootageItem {}
const ParagraphJustification = { CENTER_JUSTIFY: "center" };

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
      return matchName === "ADBE Glo2" || matchName === "ADBE Brightness & Contrast 2";
    },
    addProperty(matchName) {
      const group = this;
      const parameters = matchName === "ADBE Glo2"
        ? [scalarProperty(0), scalarProperty(50), scalarProperty(50), scalarProperty(1)]
        : [
            Object.assign(scalarProperty(0), { name: "Brightness", matchName: matchName + "-0001" }),
            Object.assign(scalarProperty(0), { name: "Contrast", matchName: matchName + "-0002" }),
          ];
      const effect = {
        name: matchName === "ADBE Glo2" ? "Glow" : "Brightness & Contrast",
        matchName,
        property(key) {
          if (typeof key === "number") return parameters[key - 1] || null;
          return null;
        },
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
    Object.assign(scale, {
      name: "Scale",
      matchName: "ADBE Scale",
      propertyValueType: scale.value && scale.value.length === 3 ? "ThreeD" : "TwoD",
    }),
    Object.assign(rotation, { name: "Rotation", matchName: "ADBE Rotation" }),
  ]);
  const textProperties = propertyGroup([
    Object.assign(textDocument, { name: "Text Document", matchName: "ADBE Text Document" }),
  ]);
  const effects = propertyGroup([]);
  const layer = {
    name, index, enabled: true, threeDLayer: scale.value && scale.value.length === 3, shy: false, locked: false,
    inPoint: 0, outPoint: 5,
    _opacity: opacity,
    _scale: scale,
    _position: position,
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
      version: "mock-host-version",
      beginUndoGroup() {},
      endUndoGroup() {},
    },
    PropertyValueType: { TwoD: 2, ThreeD: 3 },
    CompItem, TextLayer, ShapeLayer, AVLayer, SolidSource, FootageItem, ParagraphJustification,
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "host.jsx"), "utf8");
  vm.runInContext(source, context, { filename: "host.jsx" });
  return { context, layer, comp, project };
}

function makeCaptionContext() {
  const { context, comp } = makeContext();
  const file = { fsName: "C:/mock/clip.mp4", exists: true };
  const footage = new FootageItem();
  footage.file = file;
  const sourceLayer = {
    name: "Interview Footage",
    id: 9001,
    index: 1,
    source: footage,
    inPoint: 0,
    outPoint: 5,
    startTime: 0,
    stretch: 100,
    timeRemapEnabled: false,
    enabled: true,
    shy: false,
    locked: false,
  };
  Object.setPrototypeOf(sourceLayer, AVLayer.prototype);
  comp.selectedLayers = [sourceLayer];
  const generated = [];
  comp.layers = {
    addText(text) {
      const group = propertyGroup([]);
      const position = scalarProperty([0, 0]);
      const transform = propertyGroup([Object.assign(position, { name: "Position", matchName: "ADBE Position" })]);
      const textDoc = scalarProperty({ text, font: "ArialMT", fontSize: 48 });
      const textProperties = propertyGroup([Object.assign(textDoc, {
        name: "Text Document",
        matchName: "ADBE Text Document",
        setValue(value) { this.value = Object.assign({}, value); },
      })]);
      const layer = {
        name: "",
        index: generated.length + 2,
        inPoint: 0,
        outPoint: comp.duration,
        enabled: true,
        shy: false,
        locked: false,
        removed: false,
        property(key) {
          if (key === "ADBE Text Properties") return textProperties;
          if (key === "ADBE Transform Group") return transform;
          return null;
        },
        remove() { this.removed = true; },
      };
      Object.setPrototypeOf(layer, TextLayer.prototype);
      generated.push(layer);
      return layer;
    },
  };
  return { context, comp, sourceLayer, file, generated };
}

function enableKeyframes(opacity) {
  const keys = [];
  Object.defineProperty(opacity, "numKeys", {
    configurable: true,
    get() { return keys.length; },
  });
  opacity.setValueAtTime = function (time, value) {
    const existing = keys.find((key) => key.time === time);
    if (existing) existing.value = value;
    else keys.push({ time, value });
    keys.sort((left, right) => left.time - right.time);
  };
  opacity.nearestKeyIndex = function (time) {
    let closest = 0;
    for (let index = 1; index < keys.length; index++) {
      if (Math.abs(keys[index].time - time) < Math.abs(keys[closest].time - time)) closest = index;
    }
    return closest + 1;
  };
  opacity.keyTime = (index) => keys[index - 1] && keys[index - 1].time;
  opacity.keyValue = (index) => keys[index - 1] && keys[index - 1].value;
  opacity.removeKey = (index) => keys.splice(index - 1, 1);
  return keys;
}

function keyframeSnapshots(keys) {
  return Array.from(keys, ({ time, value }) => ({
    time,
    value: value && typeof value !== "number" && typeof value.length === "number"
      ? Array.from(value)
      : value,
  }));
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
  assert.match(result, /^REJECTED\|No active composition/);
});

test("unsupported commands are rejected instead of silently claiming success", () => {
  const { context } = makeContext();
  const result = context.OBSIDIAN_executePlan("run_shell", null, "");
  assert.match(result, /^REJECTED\|Unsupported planned action: run_shell/);
});

test("Glow can be added and removed with host verification", () => {
  const { context, layer } = makeContext();
  const effects = layer.property("ADBE Effect Parade");

  const added = context.OBSIDIAN_executePlan("add_glow", null, "unspecified");
  assert.equal(added, "OK|Verified Glow on 1 selected layer(s); added 1 new effect(s).");
  assert.equal(effects.numProperties, 1);

  const removed = context.OBSIDIAN_executePlan("remove_glow", null, "");
  assert.equal(removed, "OK|Verified Glow removed from selected layers. Removed 1 effect instance(s).");
  assert.equal(effects.numProperties, 0);
});
test("Glow presets apply and verify the requested parameter values", () => {
  const { context, layer } = makeContext();
  const effects = layer.property("ADBE Effect Parade");

  const cinematic = context.OBSIDIAN_executePlan("add_glow", null, "cinematic");
  assert.match(cinematic, /Applied and verified cinematic preset on 1 layer/);
  let glow = effects.property(1);
  assert.equal(glow.property(2).value, 76);
  assert.equal(glow.property(3).value, 24);
  assert.equal(glow.property(4).value, 0.25);

  const overwrite = context.OBSIDIAN_executePlan("add_glow", null, "attention");
  assert.match(overwrite, /already has Glow; existing effect settings were preserved/);
  assert.equal(glow.property(2).value, 76);
  assert.equal(glow.property(3).value, 24);
  assert.equal(glow.property(4).value, 0.25);

  const attentionContext = makeContext();
  const attentionEffects = attentionContext.layer.property("ADBE Effect Parade");
  const attention = attentionContext.context.OBSIDIAN_executePlan("add_glow", null, "attention");
  assert.match(attention, /Applied and verified attention preset on 1 layer/);
  glow = attentionEffects.property(1);
  assert.equal(glow.property(2).value, 52);
  assert.equal(glow.property(3).value, 78);
  assert.equal(glow.property(4).value, 1.35);
});

test("Glow preset preflights all selected layers and cleans up unsupported layouts", () => {
  const { context, layer, comp } = makeContext();
  const unavailable = makeTextLayer("Unavailable", 2, 100);
  unavailable.property("ADBE Effect Parade").canAddProperty = () => false;
  comp.selectedLayers.push(unavailable);
  let result = context.OBSIDIAN_executePlan("add_glow", null, "cinematic");
  assert.match(result, /Glow is unavailable on a selected layer/);
  assert.equal(layer.property("ADBE Effect Parade").numProperties, 0);

  comp.selectedLayers.pop();
  const effects = layer.property("ADBE Effect Parade");
  const addProperty = effects.addProperty.bind(effects);
  effects.addProperty = (matchName) => {
    const effect = addProperty(matchName);
    effect.property(2).value = "unexpected";
    return effect;
  };
  result = context.OBSIDIAN_executePlan("add_glow", null, "cinematic");
  assert.match(result, /preset parameters were unsupported; the temporary effects were removed/);
  assert.equal(effects.numProperties, 0);
});
test("Glow removal removes every existing Glow instance and verifies the result", () => {
  const { context, layer } = makeContext();
  const effects = layer.property("ADBE Effect Parade");
  effects.addProperty("ADBE Glo2");
  effects.addProperty("ADBE Glo2");

  const result = context.OBSIDIAN_executePlan("remove_glow", null, "");
  assert.equal(result, "OK|Verified Glow removed from selected layers. Removed 2 effect instance(s).");
  assert.equal(effects.numProperties, 0);
});
test("reduce opacity verifies the target value for each selected layer", () => {
  const { context, layer } = makeContext();
  const result = context.OBSIDIAN_executePlan("reduce_opacity", null, "");
  assert.equal(result, "OK|Verified opacity reduction on 1 selected layer(s).");
  assert.equal(layer._opacity.value, 80);
});

test("proportionally scales selected 2D and 3D layers and verifies the result", () => {
  const { context, layer, comp } = makeContext();
  let result = context.OBSIDIAN_executePlan("scale_selected", 10, "");
  assert.equal(result, "OK|Verified proportional scale change on 1 selected layer(s).");
  assert.ok(Array.from(layer._scale.value).every((value) => Math.abs(value - 110) < 0.01));

  layer._scale.value = [100, 80, 50];
  layer.threeDLayer = true;
  layer._scale.propertyValueType = "ThreeD";
  result = context.OBSIDIAN_executePlan("scale_selected", -10, "");
  assert.equal(result, "OK|Verified proportional scale change on 1 selected layer(s).");
  assert.ok(Array.from(layer._scale.value).every((value, index) => Math.abs(value - [90, 72, 45][index]) < 0.01));

  const second = makeTextLayer("Caption", 2, 100);
  comp.selectedLayers.push(second);
  result = context.OBSIDIAN_executePlan("scale_selected", 5, "");
  assert.equal(result, "OK|Verified proportional scale change on 2 selected layer(s).");
  assert.ok(Array.from(layer._scale.value).every((value, index) => Math.abs(value - [94.5, 75.6, 47.25][index]) < 0.01));
  assert.ok(Array.from(second._scale.value).every((value) => Math.abs(value - 105) < 0.01));
});

test("absolute Scale targets write every active 2D and 3D dimension", () => {
  const { context, layer, comp } = makeContext();
  const threeDLayer = makeTextLayer("Depth", 2, 100);
  threeDLayer.threeDLayer = true;
  threeDLayer._scale.value = [125, 80, 60];
  threeDLayer._scale.propertyValueType = "ThreeD";
  comp.selectedLayers.push(threeDLayer);

  const result = context.OBSIDIAN_executePlan("set_scale", 10, "");
  assert.equal(result, "OK|Verified absolute Scale 10% on every active dimension of 2 selected layer(s).");
  assert.deepEqual(Array.from(layer._scale.value), [10, 10]);
  assert.deepEqual(Array.from(threeDLayer._scale.value), [10, 10, 10]);
});

test("Scale uses vector length and the layer 3D state with AE Scale property types", () => {
  const { context, layer } = makeContext();
  // Some AE versions report ThreeD for a 2D Scale property while returning two values.
  layer._scale.propertyValueType = context.PropertyValueType.ThreeD;
  const result = context.OBSIDIAN_executePlan("scale_selected", 10, "");
  assert.equal(result, "OK|Verified proportional scale change on 1 selected layer(s).");
  assert.ok(Array.from(layer._scale.value).every((value) => Math.abs(value - 110) < 0.01));
});

test("absolute Scale refuses existing keys and expressions without changing values", () => {
  const { context, layer } = makeContext();
  layer._scale.numKeys = 1;
  let result = context.OBSIDIAN_executePlan("set_scale", 10, "");
  assert.match(result, /existing scale keyframes or expression/);
  assert.deepEqual(Array.from(layer._scale.value), [100, 100]);

  layer._scale.numKeys = 0;
  layer._scale.expressionEnabled = true;
  result = context.OBSIDIAN_executePlan("set_scale", 10, "");
  assert.match(result, /existing scale keyframes or expression/);
  assert.deepEqual(Array.from(layer._scale.value), [100, 100]);
});

test("scale writes and verifies fresh 2D and 3D property-value snapshots", () => {
  const { context, layer, comp } = makeContext();
  const threeDLayer = makeTextLayer("Depth", 2, 100);
  let live2D = [100, 100];
  let live3D = [125, 80, 60];
  let reads2D = 0;
  let reads3D = 0;

  function returnSnapshotForScale(targetLayer, dimensions, read, write) {
    const originalProperty = targetLayer.property;
    targetLayer.property = function (key) {
      if (key !== "ADBE Transform Group") return originalProperty.call(this, key);
      return {
        property(matchName) {
          if (matchName !== "ADBE Scale") return null;
          const snapshot = read();
          return {
            value: snapshot.value,
            propertyValueType: dimensions === 2 ? "TwoD" : "ThreeD",
            numKeys: 0,
            expressionEnabled: false,
            setValue(value) { write(Array.from(value)); },
          };
        },
      };
    };
  }

  const read2D = () => ({ value: live2D.slice(), count: ++reads2D });
  const read3D = () => ({ value: live3D.slice(), count: ++reads3D });
  threeDLayer.threeDLayer = true;
  returnSnapshotForScale(layer, 2, read2D, (value) => { live2D = value; });
  returnSnapshotForScale(threeDLayer, 3, read3D, (value) => { live3D = value; });
  comp.selectedLayers.push(threeDLayer);

  const result = context.OBSIDIAN_executePlan("scale_selected", 10, "");
  assert.equal(result, "OK|Verified proportional scale change on 2 selected layer(s).");
  assert.ok(live2D.every((value, index) => Math.abs(value - [110, 110][index]) <= 0.01));
  assert.ok(live3D.every((value, index) => Math.abs(value - [137.5, 88, 66][index]) <= 0.01));
  assert.ok(reads2D >= 3, "2D scale should be reacquired for preflight, write, and verification");
  assert.ok(reads3D >= 3, "3D scale should be reacquired for preflight, write, and verification");
});

test("scale mismatch diagnostics compare requested, immediate, and fresh 2D/3D values before rollback", () => {
  const { context, layer, comp } = makeContext();
  const threeDLayer = makeTextLayer("Depth", 2, 100);
  threeDLayer.threeDLayer = true;
  let live2D = [100, 100];
  let live3D = [125, 80, 60];

  function exposeSnapshotProperty(targetLayer, dimensions, readLive, writeLive, mismatchIndex) {
    const originalProperty = targetLayer.property;
    targetLayer.property = function (key) {
      if (key !== "ADBE Transform Group") return originalProperty.call(this, key);
      return {
        property(matchName) {
          if (matchName !== "ADBE Scale") return null;
          let immediate = null;
          return {
            propertyValueType: dimensions === 2 ? "TwoD" : "ThreeD",
            get value() { return immediate ? immediate.slice() : readLive().slice(); },
            numKeys: 0,
            expressionEnabled: false,
            setValue(value) {
              immediate = Array.from(value);
              const committed = Array.from(value);
              if (committed.length === dimensions && committed[0] !== 100 && committed[0] !== 125) {
                committed[mismatchIndex] += 2;
              }
              writeLive(committed);
            },
          };
        },
      };
    };
  }

  exposeSnapshotProperty(layer, 2, () => live2D, (value) => { live2D = value; }, 0);
  exposeSnapshotProperty(threeDLayer, 3, () => live3D, (value) => { live3D = value; }, 1);
  comp.selectedLayers.push(threeDLayer);

  const result = context.OBSIDIAN_executePlan("scale_selected", 10, "");
  assert.match(result, /failed and original Scale values were restored/);
  assert.match(result, /requested \[110(?:\.\d+)?, 110(?:\.\d+)?\] \(dimensions=2, propertyValueType=TwoD, layer3D=false\)/);
  assert.match(result, /immediate \[110(?:\.\d+)?, 110(?:\.\d+)?\] \(dimensions=2, propertyValueType=TwoD, layer3D=false\)/);
  assert.match(result, /fresh \[112(?:\.\d+)?, 110(?:\.\d+)?\] \(dimensions=2, propertyValueType=TwoD, layer3D=false\)/);
  assert.match(result, /requested \[137\.5, 88, 66\] \(dimensions=3, propertyValueType=ThreeD, layer3D=true\)/);
  assert.match(result, /fresh \[137\.5, 90, 66\] \(dimensions=3, propertyValueType=ThreeD, layer3D=true\)/);
  assert.deepEqual(live2D, [100, 100]);
  assert.deepEqual(live3D, [125, 80, 60]);
});

test("3D Scale Z partial writes are diagnosed and fully restored", () => {
  const { context, layer } = makeContext();
  layer.threeDLayer = true;
  layer._scale.value = [100, 100, 100];
  layer._scale.propertyValueType = "ThreeD";
  const originalSetValue = layer._scale.setValue;
  let firstWrite = true;
  layer._scale.setValue = function (value) {
    if (firstWrite) {
      firstWrite = false;
      this.value = [value[0], value[1], 100];
      return;
    }
    originalSetValue.call(this, value);
  };

  const result = context.OBSIDIAN_executePlan("scale_selected", 10, "");
  assert.match(result, /failed and original Scale values were restored/);
  assert.match(result, /requested \[110(?:\.\d+)?, 110(?:\.\d+)?, 110(?:\.\d+)?\] \(dimensions=3, propertyValueType=ThreeD, layer3D=true\)/);
  assert.match(result, /immediate \[110(?:\.\d+)?, 110(?:\.\d+)?, 100\] \(dimensions=3, propertyValueType=ThreeD, layer3D=true\)/);
  assert.match(result, /fresh \[110(?:\.\d+)?, 110(?:\.\d+)?, 100\] \(dimensions=3, propertyValueType=ThreeD, layer3D=true\)/);
  assert.match(result, /original \[100, 100, 100\]; after restoration \[100, 100, 100\]/);
  assert.match(result, /After Effects mock-host-version/);
  assert.deepEqual(Array.from(layer._scale.value), [100, 100, 100]);
});

test("scale preflight refuses keyframes, expressions, and locked layers without partial edits", () => {
  const { context, layer, comp } = makeContext();
  const animated = makeTextLayer("Animated", 2, 100);
  animated._scale.numKeys = 2;
  comp.selectedLayers.push(animated);
  let result = context.OBSIDIAN_executePlan("scale_selected", 10, "");
  assert.match(result, /existing scale keyframes or expression/);
  assert.deepEqual(Array.from(layer._scale.value), [100, 100]);
  assert.deepEqual(Array.from(animated._scale.value), [100, 100]);

  comp.selectedLayers = [layer];
  layer._scale.expressionEnabled = true;
  layer._scale.expression = "value";
  result = context.OBSIDIAN_executePlan("scale_selected", 10, "");
  assert.match(result, /existing scale keyframes or expression/);
  assert.deepEqual(Array.from(layer._scale.value), [100, 100]);

  layer._scale.expressionEnabled = false;
  layer.locked = true;
  result = context.OBSIDIAN_executePlan("scale_selected", 10, "");
  assert.match(result, /unlock 'Headline'/);
  assert.deepEqual(Array.from(layer._scale.value), [100, 100]);
});

test("scale rejects invalid percentages and unsupported vector shapes", () => {
  const { context, layer } = makeContext();
  for (const value of [0, -100, 100.01, NaN, Infinity]) {
    const result = context.OBSIDIAN_executePlan("scale_selected", value, "");
    assert.match(result, /Scale change must be/);
    assert.deepEqual(Array.from(layer._scale.value), [100, 100]);
  }
  layer._scale.value = [100];
  const unsupported = context.OBSIDIAN_executePlan("scale_selected", 10, "");
  assert.match(unsupported, /unsupported Scale type or dimensions/);
  assert.deepEqual(Array.from(layer._scale.value), [100]);

  layer._scale.value = [100, 100];
  layer.threeDLayer = true;
  const dimensionMismatch = context.OBSIDIAN_executePlan("scale_selected", 10, "");
  assert.match(dimensionMismatch, /expected a numeric 2D\/3D Scale vector matching the layer's 3D state/);
  assert.deepEqual(Array.from(layer._scale.value), [100, 100]);

  layer.threeDLayer = false;
  layer._scale.value = [900, 900];
  const excessive = context.OBSIDIAN_executePlan("scale_selected", 20, "");
  assert.match(excessive, /resulting Scale value is outside the supported range/);
  assert.deepEqual(Array.from(layer._scale.value), [900, 900]);
});

test("scale edits active X/Y and preserves hidden Z when a 3D Scale vector belongs to a 2D layer", () => {
  const { context, layer } = makeContext();
  // AE retains a 3D layer's Scale Z when converted back to 2D, but hides and ignores Z.
  layer.threeDLayer = false;
  layer._scale.value = [100, 100, 100];
  layer._scale.propertyValueType = "ThreeD";
  const writes = [];
  layer._scale.setValue = function (value) {
    writes.push(Array.from(value));
    this.value = [Number(value[0]), Number(value[1]), this.value[2]];
  };

  let result = context.OBSIDIAN_executePlan("scale_selected", 10, "");
  assert.equal(result, "OK|Verified proportional scale change on 1 selected layer(s).");
  assert.ok(Array.from(layer._scale.value).every((value, index) => Math.abs(value - [110, 110, 100][index]) <= 0.01));

  result = context.OBSIDIAN_executePlan("set_scale", 10, "");
  assert.equal(result, "OK|Verified absolute Scale 10% on every active dimension of 1 selected layer(s).");
  assert.deepEqual(Array.from(layer._scale.value), [10, 10, 100]);
  assert.equal(writes.length, 2);
  assert.ok(writes[0].slice(0, 2).every((value) => Math.abs(value - 110) <= 0.01));
  assert.equal(writes[0][2], 100);
  assert.deepEqual(writes[1], [10, 10, 100]);
});

test("scale read-back failure restores the original Scale values", () => {
  const { context, layer } = makeContext();
  const originalSetValue = layer._scale.setValue;
  let corruptFirstWrite = true;
  layer._scale.setValue = function (value) {
    if (corruptFirstWrite) {
      corruptFirstWrite = false;
      this.value = [value[0] + 1, value[1]];
      return;
    }
    originalSetValue.call(this, value);
  };
  const result = context.OBSIDIAN_executePlan("scale_selected", 10, "");
  assert.match(result, /failed and original Scale values were restored/);
  assert.deepEqual(Array.from(layer._scale.value), [100, 100]);
});

test("set opacity preserves existing opacity keyframes", () => {
  const { context, layer } = makeContext();
  layer._opacity.numKeys = 2;
  const result = context.OBSIDIAN_executePlan("set_opacity", 35, "");
  assert.match(result, /^REJECTED\|Opacity edit cancelled: existing opacity animation or expression/);
  assert.equal(layer._opacity.value, 100);
});

test("set opacity preserves an enabled loop expression", () => {
  const { context, layer } = makeContext();
  layer._opacity.expressionEnabled = true;
  layer._opacity.expression = "loopOut('cycle')";
  const result = context.OBSIDIAN_executePlan("set_opacity", 35, "");
  assert.match(result, /^REJECTED\|Opacity edit cancelled: existing opacity animation or expression/);
  assert.equal(layer._opacity.value, 100);
  assert.equal(layer._opacity.expressionEnabled, true);
});

test("reduce opacity preserves an enabled loop expression", () => {
  const { context, layer } = makeContext();
  layer._opacity.expressionEnabled = true;
  layer._opacity.expression = "loopOut('cycle')";
  const result = context.OBSIDIAN_executePlan("reduce_opacity", null, "");
  assert.match(result, /^REJECTED\|Opacity edit cancelled: existing opacity animation or expression/);
  assert.equal(layer._opacity.value, 100);
  assert.equal(layer._opacity.expressionEnabled, true);
});

test("fade in refuses to run when the host cannot create opacity keyframes", () => {
  const { context } = makeContext();
  const result = context.OBSIDIAN_executePlan("fade_in", null, "");
  assert.equal(result, "REJECTED|Opacity keyframes unavailable.");
});

test("fade in writes and verifies opacity keyframes", () => {
  const { context, layer } = makeContext();
  const keys = enableKeyframes(layer._opacity);
  const result = context.OBSIDIAN_executePlan("fade_in", null, "");
  assert.equal(result, "OK|Verified fade-in keyframes on 1 selected layer(s).");
  assert.deepEqual(keys, [{ time: 0, value: 0 }, { time: 0.5, value: 100 }]);
});

test("fade out writes and verifies opacity keyframes", () => {
  const { context, layer } = makeContext();
  const keys = enableKeyframes(layer._opacity);
  const result = context.OBSIDIAN_executePlan("fade_out", null, "");
  assert.equal(result, "OK|Verified fade-out keyframes on 1 selected layer(s).");
  assert.deepEqual(keys, [{ time: 4.5, value: 100 }, { time: 5, value: 0 }]);
});

test("failed fade read-back removes generated opacity keyframes", () => {
  const { context, layer } = makeContext();
  const keys = enableKeyframes(layer._opacity);
  layer._opacity.keyValue = () => 25;
  const result = context.OBSIDIAN_executePlan("fade_out", null, "");
  assert.match(result, /generated keyframes were removed/);
  assert.equal(keys.length, 0);
});

test("scale-in creates bounded 2D Scale keyframes and verifies them", () => {
  const { context, layer } = makeContext();
  const keys = enableKeyframes(layer._scale);
  const result = context.OBSIDIAN_executePlan("scale_in", null, "");
  assert.equal(result, "OK|Verified 0.5-second scale-in keyframes on 1 selected layer(s).");
  assert.deepEqual(keyframeSnapshots(keys), [
    { time: 0, value: [95, 95] },
    { time: 0.5, value: [100, 100] },
  ]);
});

test("slide-up animates a static 2D Position without changing its destination", () => {
  const { context, layer } = makeContext();
  const keys = enableKeyframes(layer._position);
  const result = context.OBSIDIAN_executePlan("slide_up", null, "");
  assert.equal(result, "OK|Verified 40-pixel slide-up keyframes on 1 selected layer(s).");
  assert.deepEqual(keyframeSnapshots(keys), [
    { time: 0, value: [960, 580] },
    { time: 0.5, value: [960, 540] },
  ]);
  assert.deepEqual(layer._position.value, [960, 540]);
});

test("crossfade requires exactly two overlapping layers and verifies both opacity curves", () => {
  const { context, layer, comp } = makeContext();
  const incoming = makeTextLayer("Incoming", 2, 80);
  layer.outPoint = 3;
  incoming.inPoint = 2.5;
  comp.selectedLayers.push(incoming);
  const outgoingKeys = enableKeyframes(layer._opacity);
  const incomingKeys = enableKeyframes(incoming._opacity);
  const result = context.OBSIDIAN_executePlan("crossfade", null, "");
  assert.equal(result, "OK|Verified crossfade across 2 selected overlapping layers.");
  assert.deepEqual(outgoingKeys, [
    { time: 2.5, value: 100 },
    { time: 3, value: 0 },
  ]);
  assert.deepEqual(incomingKeys, [
    { time: 2.5, value: 0 },
    { time: 3, value: 80 },
  ]);
});

test("crossfade rejects non-overlapping layers without changing either layer", () => {
  const { context, layer, comp } = makeContext();
  const next = makeTextLayer("Next", 2, 100);
  layer.outPoint = 2;
  next.inPoint = 2.5;
  comp.selectedLayers.push(next);
  const outgoingKeys = enableKeyframes(layer._opacity);
  const incomingKeys = enableKeyframes(next._opacity);
  const result = context.OBSIDIAN_executePlan("crossfade", null, "");
  assert.match(result, /need at least 0.05 seconds of overlap/);
  assert.equal(outgoingKeys.length, 0);
  assert.equal(incomingKeys.length, 0);
});

test("failed crossfade verification removes only the generated keys", () => {
  const { context, layer, comp } = makeContext();
  const incoming = makeTextLayer("Incoming", 2, 80);
  layer.outPoint = 3;
  incoming.inPoint = 2.5;
  comp.selectedLayers.push(incoming);
  const outgoingKeys = enableKeyframes(layer._opacity);
  const incomingKeys = enableKeyframes(incoming._opacity);
  incoming._opacity.keyValue = () => 20;
  const result = context.OBSIDIAN_executePlan("crossfade", null, "");
  assert.match(result, /Crossfade failed and generated keyframes were removed/);
  assert.equal(outgoingKeys.length, 0);
  assert.equal(incomingKeys.length, 0);
});

test("gentle entrance preflights and verifies fade and Scale as one recipe", () => {
  const { context, layer } = makeContext();
  const opacityKeys = enableKeyframes(layer._opacity);
  const scaleKeys = enableKeyframes(layer._scale);
  const result = context.OBSIDIAN_executePlan("apply_recipe", null, "gentle_entrance");
  assert.equal(result, "OK|Applied Gentle Entrance: verified fade-in and scale-in keyframes on 1 selected layer(s).");
  assert.deepEqual(keyframeSnapshots(opacityKeys), [
    { time: 0, value: 0 },
    { time: 0.5, value: 100 },
  ]);
  assert.deepEqual(keyframeSnapshots(scaleKeys), [
    { time: 0, value: [95, 95] },
    { time: 0.5, value: [100, 100] },
  ]);
});

test("gentle entrance rejects unsupported recipes and preserves existing Scale animation", () => {
  const { context, layer } = makeContext();
  const opacityKeys = enableKeyframes(layer._opacity);
  const scaleKeys = enableKeyframes(layer._scale);
  let result = context.OBSIDIAN_executePlan("apply_recipe", null, "run_shell");
  assert.equal(result, "REJECTED|Unsupported creative recipe.");
  assert.equal(opacityKeys.length, 0);
  assert.equal(scaleKeys.length, 0);

  layer._scale.expressionEnabled = true;
  result = context.OBSIDIAN_executePlan("apply_recipe", null, "gentle_entrance");
  assert.match(result, /existing Scale keyframes or expression was preserved/);
  assert.equal(opacityKeys.length, 0);
  assert.equal(scaleKeys.length, 0);
});

test("gentle entrance removes both properties' generated keys on verification failure", () => {
  const { context, layer } = makeContext();
  const opacityKeys = enableKeyframes(layer._opacity);
  const scaleKeys = enableKeyframes(layer._scale);
  layer._scale.keyValue = () => [50, 50];
  const result = context.OBSIDIAN_executePlan("apply_recipe", null, "gentle_entrance");
  assert.match(result, /Gentle Entrance failed and generated keyframes were removed/);
  assert.equal(opacityKeys.length, 0);
  assert.equal(scaleKeys.length, 0);
});

test("fixed creative looks execute guarded, distinct Brightness/Contrast values", () => {
  const dark = makeContext();
  const darkResult = dark.context.OBSIDIAN_executePlan("apply_recipe", null, "dark_dramatic");
  assert.equal(darkResult, "OK|Verified Brightness -12 and Contrast 14 on 1 selected layer(s).");

  const contrast = makeContext();
  const contrastResult = contrast.context.OBSIDIAN_executePlan("apply_recipe", null, "high_contrast");
  assert.equal(contrastResult, "OK|Verified Brightness 0 and Contrast 20 on 1 selected layer(s).");

  const unsupported = makeContext();
  assert.equal(
    unsupported.context.OBSIDIAN_executePlan("apply_recipe", null, "vintage_film"),
    "REJECTED|Unsupported creative recipe."
  );
  assert.equal(unsupported.layer.property("ADBE Effect Parade").numProperties, 0);
});

test("Brightness and Contrast applies bounded native values and verifies both properties", () => {
  const { context, layer } = makeContext();
  const result = context.OBSIDIAN_executePlan("set_brightness_contrast", -10, "", 15);
  assert.equal(result, "OK|Verified Brightness -10 and Contrast 15 on 1 selected layer(s).");
  const effects = layer.property("ADBE Effect Parade");
  assert.equal(effects.numProperties, 1);
  assert.equal(effects.property(1).matchName, "ADBE Brightness & Contrast 2");
  assert.equal(effects.property(1).property(1).value, -10);
  assert.equal(effects.property(1).property(2).value, 15);
});

test("Brightness and Contrast refuses existing effects and invalid values without edits", () => {
  const { context, layer } = makeContext();
  const effects = layer.property("ADBE Effect Parade");
  effects.addProperty("ADBE Brightness & Contrast 2");
  const preserved = effects.property(1);
  let result = context.OBSIDIAN_executePlan("set_brightness_contrast", 5, "", 10);
  assert.match(result, /already has Brightness & Contrast/);
  assert.equal(effects.numProperties, 1);
  assert.equal(preserved.property(1).value, 0);

  result = context.OBSIDIAN_executePlan("set_brightness_contrast", 26, "", 10);
  assert.match(result, /must each be between -25 and 25/);
  assert.equal(effects.numProperties, 1);
});

test("Brightness and Contrast removes a newly added effect when parameter layout is unsupported", () => {
  const { context, layer } = makeContext();
  const effects = layer.property("ADBE Effect Parade");
  const addProperty = effects.addProperty.bind(effects);
  effects.addProperty = (matchName) => {
    const effect = addProperty(matchName);
    effect.property(1).name = "Unexpected Parameter";
    return effect;
  };
  const result = context.OBSIDIAN_executePlan("set_brightness_contrast", 5, "", 10);
  assert.match(result, /parameters were unsupported/);
  assert.equal(effects.numProperties, 0);
});

test("Brightness and Contrast preflights every selected layer before adding effects", () => {
  const { context, layer, comp } = makeContext();
  const second = makeTextLayer("Unsupported", 2, 100);
  const secondEffects = second.property("ADBE Effect Parade");
  secondEffects.canAddProperty = () => false;
  comp.selectedLayers.push(second);
  const result = context.OBSIDIAN_executePlan("set_brightness_contrast", 5, "", 10);
  assert.match(result, /unavailable on a selected layer/);
  assert.equal(layer.property("ADBE Effect Parade").numProperties, 0);
  assert.equal(secondEffects.numProperties, 0);
});


test("host rejects out-of-range opacity instead of silently clamping it", () => {
  const { context, layer } = makeContext();
  const result = context.OBSIDIAN_executePlan("set_opacity", 140, "");
  assert.equal(result, "REJECTED|Opacity must be a number between 0 and 100.");
  assert.equal(layer._opacity.value, 100);
});

test("host rejects unknown Glow profiles before making an edit", () => {
  const { context, layer } = makeContext();
  const result = context.OBSIDIAN_executePlan("add_glow", null, "run_shell");
  assert.equal(result, "REJECTED|Unsupported Glow profile.");
  assert.equal(context.OBSIDIAN_getEffectNames(layer).length, 0);
});


test("host rejects a missing opacity argument", () => {
  const { context, layer } = makeContext();
  const result = context.OBSIDIAN_executePlan("set_opacity", null, "");
  assert.equal(result, "REJECTED|Opacity must be a number between 0 and 100.");
  assert.equal(layer._opacity.value, 100);
});

function captionPayload(overrides) {
  return Object.assign({
    source: {
      path: "C:/mock/clip.mp4",
      layerName: "Interview Footage",
      layerId: "9001",
      layerIndex: 1,
      inPoint: 0,
      outPoint: 5,
      startTime: 0,
      stretch: 100,
      frameRate: 30,
      compName: "SaaS Hero",
      compDuration: 5,
      compWidth: 1920,
      compHeight: 1080,
    },
    style: "clean",
    segments: [
      { text: "A local caption.", start: 0.2, end: 1.1 },
      { text: "Another caption.", start: 1.1, end: 2.2 },
    ],
  }, overrides || {});
}

test("caption source inspection returns local footage and timing without editing the project", () => {
  const { context, generated } = makeCaptionContext();
  const result = context.OBSIDIAN_executePlan("inspect_caption_source", null, "");
  const fields = result.split("|");
  assert.equal(fields.length, 15);
  assert.equal(fields[0], "OK");
  assert.equal(fields[1], "CAPTION_SOURCE");
  assert.equal(unescape(fields[2]), "C:/mock/clip.mp4");
  assert.equal(unescape(fields[3]), "Interview Footage");
  assert.deepEqual(fields.slice(4, 14), ["9001", "1", "0", "5", "0", "100", "30", "5", "1920", "1080"]);
  assert.equal(unescape(fields[14]), "SaaS Hero");
  assert.equal(generated.length, 0);
});

test("caption source inspection rejects multiple selections and offline footage", () => {
  const multiple = makeCaptionContext();
  multiple.comp.selectedLayers.push({});
  assert.match(multiple.context.OBSIDIAN_executePlan("inspect_caption_source", null, ""), /Select exactly one footage layer/);
  assert.equal(multiple.generated.length, 0);

  const offline = makeCaptionContext();
  offline.file.exists = false;
  assert.match(offline.context.OBSIDIAN_executePlan("inspect_caption_source", null, ""), /offline/);
  assert.equal(offline.generated.length, 0);
});

test("caption creation adds and verifies only styled, timed text layers", () => {
  const { context, generated, sourceLayer } = makeCaptionContext();
  const result = context.OBSIDIAN_executePlan("create_captions", captionPayload(), "");
  assert.equal(result, "OK|Verified 2 timed caption layer(s) using the clean style.");
  assert.equal(generated.length, 2);
  assert.equal(generated[0].name, "OBSIDIAN Caption 1");
  assert.equal(generated[0].property("ADBE Text Properties").property("ADBE Text Document").value.text, "A local caption.");
  assert.equal(generated[0].inPoint, 0.2);
  assert.equal(generated[0].outPoint, 1.1);
  assert.deepEqual(Array.from(generated[0].property("ADBE Transform Group").property("ADBE Position").value), [960, 928.8]);
  assert.equal(sourceLayer.name, "Interview Footage");
  assert.equal(sourceLayer.inPoint, 0);
  assert.equal(sourceLayer.outPoint, 5);
});

test("caption creation accepts bounded structured payloads without a host JSON global", () => {
  const { context, comp, sourceLayer, generated } = makeCaptionContext();
  context.JSON = undefined;
  let undoGroupsStarted = 0;
  let undoGroupsEnded = 0;
  context.app.beginUndoGroup = () => { undoGroupsStarted++; };
  context.app.endUndoGroup = () => { undoGroupsEnded++; };
  comp.duration = 45;
  sourceLayer.outPoint = 45;
  const payload = captionPayload({
    segments: Array.from({ length: 240 }, (_, index) => ({
      text: "word-" + (index + 1),
      start: index * (5 / 30),
      end: (index + 1) * (5 / 30),
    })),
  });
  payload.source.outPoint = 45;
  payload.source.compDuration = 45;
  const result = context.OBSIDIAN_executePlan("create_captions", payload, "");
  assert.equal(result, "OK|Verified 240 timed caption layer(s) using the clean style.");
  assert.equal(generated.length, 240);
  assert.equal(generated[0].property("ADBE Text Properties").property("ADBE Text Document").value.text, "word-1");
  assert.equal(generated[239].property("ADBE Text Properties").property("ADBE Text Document").value.text, "word-240");
  assert.equal(generated[239].inPoint, 239 * (5 / 30));
  assert.equal(generated[239].outPoint, 40);
  assert.equal(undoGroupsStarted, 1);
  assert.equal(undoGroupsEnded, 1);
});

test("caption host rejects string payloads instead of relying on ExtendScript JSON.parse", () => {
  const { context, generated } = makeCaptionContext();
  const result = context.OBSIDIAN_executePlan("create_captions", JSON.stringify(captionPayload()), "");
  assert.equal(result, "REJECTED|Caption data must be received as a structured object.");
  assert.equal(generated.length, 0);
});

test("caption creation rejects unsupported styles, overlaps, and stale selections before edits", () => {
  const unsupported = makeCaptionContext();
  assert.match(unsupported.context.OBSIDIAN_executePlan("create_captions", captionPayload({ style: "neon" }), ""), /supported style/);
  assert.equal(unsupported.generated.length, 0);

  const overlap = makeCaptionContext();
  assert.match(overlap.context.OBSIDIAN_executePlan("create_captions", captionPayload({
    segments: [{ text: "First", start: 0, end: 1 }, { text: "Overlaps", start: 0.9, end: 1.5 }],
  }), ""), /invalid or overlapping timing/);
  assert.equal(overlap.generated.length, 0);

  const stale = makeCaptionContext();
  stale.sourceLayer.name = "Different selection";
  assert.match(stale.context.OBSIDIAN_executePlan("create_captions", captionPayload(), ""), /changed after transcription/);
  assert.equal(stale.generated.length, 0);
});

test("caption creation removes only its generated layers when read-back fails", () => {
  const { context, comp, generated } = makeCaptionContext();
  const originalAddText = comp.layers.addText.bind(comp.layers);
  comp.layers.addText = (text) => {
    const layer = originalAddText(text);
    const property = layer.property("ADBE Text Properties").property("ADBE Text Document");
    property.setValue = (value) => { property.value = Object.assign({}, value, { text: "read-back mismatch" }); };
    return layer;
  };
  const result = context.OBSIDIAN_executePlan("create_captions", captionPayload(), "");
  assert.match(result, /failed and 2 generated caption layer\(s\) were removed/);
  assert.equal(generated.length, 2);
  assert.ok(generated.every((layer) => layer.removed));
});
