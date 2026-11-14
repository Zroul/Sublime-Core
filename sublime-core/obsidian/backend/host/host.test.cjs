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
const ParagraphJustification = { LEFT_JUSTIFY: "left", CENTER_JUSTIFY: "center", RIGHT_JUSTIFY: "right" };
const KeyframeInterpolationType = { LINEAR: "linear", BEZIER: "bezier", HOLD: "hold" };
class KeyframeEase { constructor(speed, influence) { this.speed = speed; this.influence = influence; } }

function scalarProperty(value) {
  return {
    value,
    setValue(next) { this.value = next; },
  };
}

function keyedProperty(value) {
  const property = scalarProperty(value);
  const keys = [];
  Object.defineProperty(property, "numKeys", { configurable: true, get() { return keys.length; } });
  property._keys = keys;
  property.setValueAtTime = function (time, next) {
    const found = keys.find((entry) => Math.abs(entry.time - time) < 1e-8);
    if (found) found.value = next;
    else keys.push({ time, value: next, interpolation: null });
    keys.sort((a, b) => a.time - b.time);
    this.value = keys[keys.length - 1].value;
  };
  property.setInterpolationTypeAtKey = (index, incoming, outgoing) => {
    if (keys[index - 1]) keys[index - 1].interpolation = { incoming, outgoing };
  };
  property.setTemporalEaseAtKey = () => {};
  property.keyTime = (index) => keys[index - 1] && keys[index - 1].time;
  property.keyValue = (index) => keys[index - 1] && keys[index - 1].value;
  property.keyInInterpolationType = (index) => keys[index - 1] && keys[index - 1].interpolation && keys[index - 1].interpolation.incoming;
  property.keyOutInterpolationType = (index) => keys[index - 1] && keys[index - 1].interpolation && keys[index - 1].interpolation.outgoing;
  property.keyInTemporalEase = () => [{ influence: 65 }];
  property.valueAtTime = (time) => {
    let result = value;
    for (const key of keys) if (key.time <= time) result = key.value;
    return result;
  };
  return property;
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
  const anchor = scalarProperty([0, 0]);
  const rotation = scalarProperty(0);
  const textDocument = scalarProperty({ text: "Launch faster", font: "ArialMT", fontStyle: "Regular", fontSize: 64,
    applyFill: true, fillColor: [1, 1, 1], applyStroke: false, strokeColor: [0, 0, 0], strokeWidth: 0, justification: "center" });
  const transform = propertyGroup([
    Object.assign(opacity, { name: "Opacity", matchName: "ADBE Opacity" }),
    Object.assign(position, { name: "Position", matchName: "ADBE Position" }),
    Object.assign(scale, {
      name: "Scale",
      matchName: "ADBE Scale",
      propertyValueType: scale.value && scale.value.length === 3 ? "ThreeD" : "TwoD",
    }),
    Object.assign(anchor, { name: "Anchor Point", matchName: "ADBE Anchor Point" }),
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
  const undoEvents = [];
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
      beginUndoGroup(label) { undoEvents.push(["begin", label]); },
      endUndoGroup() { undoEvents.push(["end"]); },
    },
    PropertyValueType: { OneD: 1, TwoD: 2, ThreeD: 3 },
    KeyframeInterpolationType, KeyframeEase,
    CompItem, TextLayer, ShapeLayer, AVLayer, SolidSource, FootageItem, ParagraphJustification,
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "host.jsx"), "utf8");
  vm.runInContext(source, context, { filename: "host.jsx" });
  return { context, layer, comp, project, undoEvents };
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
  const timelineOrder = [sourceLayer];
  function updateTimelineIndexes() { timelineOrder.forEach((layer, index) => { layer.index = index + 1; }); }
  const generated = [];
  function addCaptionTextLayer(text, boxSize) {
      const group = propertyGroup([]);
      const position = keyedProperty([0, 0]);
      const opacity = keyedProperty(100);
      const scale = keyedProperty([100, 100]);
      const anchor = scalarProperty([0, 0]);
      const transform = propertyGroup([
        Object.assign(position, { name: "Position", matchName: "ADBE Position" }),
        Object.assign(opacity, { name: "Opacity", matchName: "ADBE Opacity" }),
        Object.assign(scale, { name: "Scale", matchName: "ADBE Scale" }),
        Object.assign(anchor, { name: "Anchor Point", matchName: "ADBE Anchor Point" }),
      ]);
      const textDoc = keyedProperty({ text, font: "ArialMT", fontSize: 48, applyFill: true, fillColor: [1, 1, 1],
        applyStroke: false, strokeColor: [0, 0, 0], strokeWidth: 0, justification: "center",
        boxText: Boolean(boxSize), boxTextSize: boxSize ? Array.from(boxSize) : undefined, boxTextPos: [0, 0],
        autoLeading: true, leading: 58, boxOverflow: false, composedLineCount: 1 });
      const textProperties = propertyGroup([Object.assign(textDoc, {
        name: "Text Document",
        matchName: "ADBE Text Document",
        setValue(value) {
          this.value = Object.assign({}, value);
          if (this.value.boxText) {
            const wordWidths = context.OBSIDIAN_captionWordWidths(this.value.text);
            const metrics = context.OBSIDIAN_captionWrapMetrics(wordWidths, this.value.boxTextSize[0], this.value.fontSize);
            this.value.composedLineCount = metrics.lineCount;
            this.value.boxOverflow = !metrics.ok || metrics.lineCount * this.value.leading > this.value.boxTextSize[1] + 0.01;
          }
        },
      })]);
      const layer = {
        name: "",
        index: 1,
        inPoint: 0,
        outPoint: comp.duration,
        enabled: true,
        shy: false,
        locked: false,
        removed: false,
        moveToBeginning() {
          const index = timelineOrder.indexOf(this);
          if (index >= 0) timelineOrder.splice(index, 1);
          timelineOrder.unshift(this);
          updateTimelineIndexes();
        },
        property(key) {
          if (key === "ADBE Text Properties") return textProperties;
          if (key === "ADBE Transform Group") return transform;
          return null;
        },
        remove() { this.removed = true; },
      };
      Object.setPrototypeOf(layer, TextLayer.prototype);
      generated.push(layer);
      timelineOrder.unshift(layer);
      updateTimelineIndexes();
      return layer;
  }
  comp.layers = {
    addText(text) { return addCaptionTextLayer(text, null); },
    addBoxText(size) { return addCaptionTextLayer("", size); },
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

function enableAnimationProperty(property, faults = {}) {
  const keys = [];
  let setCalls = 0;
  let removeCalls = 0;
  Object.defineProperty(property, "numKeys", { configurable: true, get() { return keys.length; } });
  property._animationKeys = keys;
  property.setValue = function (value) { this.value = Array.isArray(value) ? Array.from(value) : value; };
  property.setValueAtTime = function (time, value) {
    setCalls++;
    if (faults.throwBeforeSetAt === setCalls) throw new Error("mock failure before key write");
    const found = keys.find((entry) => Math.abs(entry.time - time) < 1e-8);
    if (found) found.value = Array.isArray(value) ? Array.from(value) : value;
    else keys.push({ time, value: Array.isArray(value) ? Array.from(value) : value, interpolation: null, easeIn: null, easeOut: null });
    keys.sort((left, right) => left.time - right.time);
    this.value = keys[keys.length - 1].value;
    if (faults.throwAfterSetAt === setCalls) throw new Error("mock failure after key write");
  };
  property.setInterpolationTypeAtKey = function (index, incoming, outgoing) {
    if (faults.throwInterpolation) throw new Error("mock interpolation failure");
    if (keys[index - 1]) keys[index - 1].interpolation = { incoming, outgoing };
  };
  property.setTemporalEaseAtKey = function (index, easeIn, easeOut) {
    if (faults.throwEase) throw new Error("mock ease failure");
    if (keys[index - 1]) {
      keys[index - 1].easeIn = easeIn.map((ease) => ({ speed: ease.speed, influence: ease.influence }));
      keys[index - 1].easeOut = easeOut.map((ease) => ({ speed: ease.speed, influence: ease.influence }));
    }
  };
  property.keyTime = (index) => keys[index - 1] && keys[index - 1].time;
  property.keyValue = (index) => {
    const value = keys[index - 1] && keys[index - 1].value;
    if (faults.corruptReadBackAt === index) return Array.isArray(value) ? value.map((item, itemIndex) => itemIndex === 0 ? item + 1 : item) : value + 1;
    return value;
  };
  property.keyInInterpolationType = (index) => keys[index - 1] && keys[index - 1].interpolation && keys[index - 1].interpolation.incoming;
  property.keyOutInterpolationType = (index) => keys[index - 1] && keys[index - 1].interpolation && keys[index - 1].interpolation.outgoing;
  property.keyInTemporalEase = (index) => keys[index - 1] && keys[index - 1].easeIn;
  property.keyOutTemporalEase = (index) => keys[index - 1] && keys[index - 1].easeOut;
  property.removeKey = function (index) {
    removeCalls++;
    if (faults.throwRemove || faults.throwRemoveAt === removeCalls) throw new Error("mock cleanup failure");
    return keys.splice(index - 1, 1);
  };
  if (faults.invalidInterpolation) property.isInterpolationTypeValid = (type) => type !== faults.invalidInterpolation;
  return { keys, setCalls: () => setCalls, removeCalls: () => removeCalls };
}

function makeAnimationDefinition(overrides = {}) {
  const definition = {
    id: "test_shared_motion",
    version: 1,
    compatibility: { minLayers: 1, maxLayers: 1, layerTypes: ["Text"], dimensions: ["2d"] },
    timing: { anchor: "layer.inPoint", offset: { value: 0, unit: "frames" }, duration: { value: 30, unit: "frames" } },
    parameters: [],
    tracks: [{
      property: "opacity",
      keyframes: [
        { at: { value: 0, unit: "frames" }, value: { kind: "literal", value: 0 }, interpolation: "linear" },
        { at: { value: 30, unit: "frames" }, value: { kind: "literal", value: 100 }, interpolation: "linear" },
      ],
    }],
  };
  return Object.assign(definition, overrides);
}

function registerAnimation(context, definition = makeAnimationDefinition()) {
  context.OBSIDIAN_ANIMATION_DEFINITIONS[definition.id] = definition;
  return definition;
}

function keyframeSnapshots(keys) {
  return Array.from(keys, ({ time, value }) => ({
    time,
    value: value && typeof value !== "number" && typeof value.length === "number"
      ? Array.from(value)
      : value,
  }));
}

test("Phase 1 animation definitions validate stable IDs, schemas, parameters, and approved properties", () => {
  const { context, comp } = makeContext();
  const valid = makeAnimationDefinition({
    parameters: [{ name: "opacityPeak", minimum: 0, maximum: 100, defaultValue: 85 }],
  });
  assert.equal(context.OBSIDIAN_validateAnimationDefinition(valid, comp.frameRate).ok, true);

  for (const invalid of [
    makeAnimationDefinition({ id: "Unstable ID" }),
    makeAnimationDefinition({ tracks: [{ property: "ADBE Opacity", keyframes: [] }] }),
    makeAnimationDefinition({ tracks: [{ property: "opacity", keyframes: [
      { at: { value: 0, unit: "frames" }, value: { kind: "literal", value: 0 }, interpolation: "spring" },
      { at: { value: 30, unit: "frames" }, value: { kind: "literal", value: 100 }, interpolation: "linear" },
    ] }] }),
    makeAnimationDefinition({ tracks: [{ property: "opacity", keyframes: [
      { at: { value: 0, unit: "frames" }, value: { kind: "literal", value: 0 }, interpolation: "bezier",
        easeIn: { speed: 0, influence: 0 }, easeOut: { speed: 0, influence: 50 } },
      { at: { value: 30, unit: "frames" }, value: { kind: "literal", value: 100 }, interpolation: "linear" },
    ] }] }),
    makeAnimationDefinition({ parameters: [{ name: "x", minimum: 10, maximum: 1 }] }),
  ]) assert.equal(context.OBSIDIAN_validateAnimationDefinition(invalid, comp.frameRate).ok, false);
});

test("shared animation foundation writes and verifies multiple ordered keys on one property", () => {
  const { context, layer, undoEvents } = makeContext();
  layer._opacity.propertyValueType = "OneD";
  const mock = enableAnimationProperty(layer._opacity);
  const definition = makeAnimationDefinition({ tracks: [{
    property: "opacity",
    keyframes: [0, 10, 20, 30].map((frame, index) => ({
      at: { value: frame, unit: "frames" }, value: { kind: "literal", value: [0, 35, 70, 100][index] }, interpolation: "linear",
    })),
  }] });
  registerAnimation(context, definition);

  const result = context.OBSIDIAN_executeAnimationDefinition(definition.id, {});
  assert.match(result, /^OK\|Verified animation/);
  assert.deepEqual(mock.keys.map(({ time, value }) => [time, value]), [
    [0, 0], [10 / 30, 35], [20 / 30, 70], [1, 100],
  ]);
  assert.deepEqual(undoEvents.map(([kind]) => kind), ["begin", "end"]);
});

test("shared animation foundation coordinates multiple approved property tracks in one undo group", () => {
  const { context, layer, undoEvents } = makeContext();
  layer._opacity.propertyValueType = "OneD";
  const opacity = enableAnimationProperty(layer._opacity);
  const scale = enableAnimationProperty(layer._scale);
  const definition = makeAnimationDefinition({ tracks: [
    { property: "opacity", keyframes: [
      { at: { value: 0, unit: "frames" }, value: { kind: "literal", value: 25 }, interpolation: "linear" },
      { at: { value: 30, unit: "frames" }, value: { kind: "literal", value: 100 }, interpolation: "linear" },
    ] },
    { property: "scale", keyframes: [
      { at: { value: 0, unit: "frames" }, value: { kind: "literal", value: [100, 100] }, interpolation: "bezier",
        easeIn: { speed: 0, influence: 65 }, easeOut: { speed: 12, influence: 70 } },
      { at: { value: 30, unit: "frames" }, value: { kind: "literal", value: [120, 120] }, interpolation: "bezier",
        easeIn: { speed: 2, influence: 50 }, easeOut: { speed: 0, influence: 65 } },
    ] },
  ] });
  registerAnimation(context, definition);

  const result = context.OBSIDIAN_executeAnimationDefinition(definition.id, {});
  assert.match(result, /2 track\(s\), and 4 keyframe\(s\)/);
  assert.equal(opacity.keys.length, 2);
  assert.equal(scale.keys.length, 2);
  assert.equal(scale.keys[0].easeIn[0].influence, 65);
  assert.deepEqual(undoEvents.map(([kind]) => kind), ["begin", "end"]);
});

test("shared animation timing resolves frame offsets against the selected layer and composition frame rate", () => {
  const { context, layer, comp } = makeContext();
  layer.inPoint = 1;
  layer._opacity.propertyValueType = "OneD";
  const mock = enableAnimationProperty(layer._opacity);
  const definition = makeAnimationDefinition({
    timing: { anchor: "layer.inPoint", offset: { value: 2, unit: "frames" }, duration: { value: 12, unit: "frames" } },
    tracks: [{ property: "opacity", keyframes: [
      { at: { value: 0, unit: "frames" }, value: { kind: "current" }, interpolation: "hold" },
      { at: { value: 12, unit: "frames" }, value: { kind: "add_current", amount: -20 }, interpolation: "hold" },
    ] }],
  });
  registerAnimation(context, definition);
  assert.match(context.OBSIDIAN_executeAnimationDefinition(definition.id, {}), /^OK\|/);
  assert.ok(Math.abs(mock.keys[0].time - (1 + 2 / comp.frameRate)) < 1e-9);
  assert.ok(Math.abs(mock.keys[1].time - (1 + 14 / comp.frameRate)) < 1e-9);
  assert.deepEqual(mock.keys.map((key) => key.value), [100, 80]);
});

test("shared animation accepts exact layer and composition boundaries at different frame rates", () => {
  for (const frameRate of [23.976, 24, 29.97, 30, 59.94, 60]) {
    const layerBoundaries = makeContext();
    layerBoundaries.comp.frameRate = frameRate;
    layerBoundaries.comp.duration = 120 / frameRate;
    layerBoundaries.layer.inPoint = 24 / frameRate;
    layerBoundaries.layer.outPoint = 96 / frameRate;
    layerBoundaries.layer._opacity.propertyValueType = "OneD";
    const layerProperty = enableAnimationProperty(layerBoundaries.layer._opacity);
    const layerDefinition = makeAnimationDefinition({
      timing: { anchor: "layer.inPoint", offset: { value: 0, unit: "frames" }, duration: { value: 72, unit: "frames" } },
      tracks: [{ property: "opacity", keyframes: [
        { at: { value: 0, unit: "frames" }, value: { kind: "literal", value: 0 }, interpolation: "linear" },
        { at: { value: 72, unit: "frames" }, value: { kind: "literal", value: 100 }, interpolation: "linear" },
      ] }],
    });
    registerAnimation(layerBoundaries.context, layerDefinition);
    assert.match(layerBoundaries.context.OBSIDIAN_executeAnimationDefinition(layerDefinition.id, {}), /^OK\|/, String(frameRate));
    assert.ok(Math.abs(layerProperty.keys[0].time - layerBoundaries.layer.inPoint) < 1e-9);
    assert.ok(Math.abs(layerProperty.keys[1].time - layerBoundaries.layer.outPoint) < 1e-9);

    const compositionBoundaries = makeContext();
    compositionBoundaries.comp.frameRate = frameRate;
    compositionBoundaries.comp.duration = 120 / frameRate;
    compositionBoundaries.layer.inPoint = 0;
    compositionBoundaries.layer.outPoint = compositionBoundaries.comp.duration;
    compositionBoundaries.layer._opacity.propertyValueType = "OneD";
    const compositionProperty = enableAnimationProperty(compositionBoundaries.layer._opacity);
    const compositionDefinition = makeAnimationDefinition({
      id: "composition_edge_" + String(frameRate).replace(".", "_"),
      timing: { anchor: "composition.absolute", offset: { value: 0, unit: "frames" }, duration: { value: 120, unit: "frames" } },
      tracks: [{ property: "opacity", keyframes: [
        { at: { value: 0, unit: "frames" }, value: { kind: "literal", value: 0 }, interpolation: "linear" },
        { at: { value: 120, unit: "frames" }, value: { kind: "literal", value: 100 }, interpolation: "linear" },
      ] }],
    });
    registerAnimation(compositionBoundaries.context, compositionDefinition);
    assert.match(compositionBoundaries.context.OBSIDIAN_executeAnimationDefinition(compositionDefinition.id, {}), /^OK\|/, String(frameRate));
    assert.ok(Math.abs(compositionProperty.keys[0].time) < 1e-9);
    assert.ok(Math.abs(compositionProperty.keys[1].time - compositionBoundaries.comp.duration) < 1e-9);
  }
});

test("shared animation rejects keyframes just outside layer and composition boundaries", () => {
  const cases = [
    { name: "before layer and composition start", offset: { value: -0.0005, unit: "seconds" }, duration: { value: 1, unit: "seconds" },
      layerIn: 0, layerOut: 5, compDuration: 5, end: { value: 1, unit: "seconds" } },
    { name: "after layer out point", offset: { value: 0, unit: "seconds" }, duration: { value: 2, unit: "seconds" },
      layerIn: 0, layerOut: 1, compDuration: 5, end: { value: 1.0005, unit: "seconds" } },
    { name: "after composition duration", offset: { value: 0, unit: "seconds" }, duration: { value: 1.1, unit: "seconds" },
      layerIn: 0, layerOut: 1.5, compDuration: 1, end: { value: 1.0005, unit: "seconds" } },
  ];
  for (const [index, scenario] of cases.entries()) {
    const { context, layer, comp, undoEvents } = makeContext();
    comp.duration = scenario.compDuration;
    layer.inPoint = scenario.layerIn;
    layer.outPoint = scenario.layerOut;
    layer._opacity.propertyValueType = "OneD";
    const property = enableAnimationProperty(layer._opacity);
    const definition = makeAnimationDefinition({
      id: "outside_boundary_" + index,
      timing: { anchor: "composition.absolute", offset: scenario.offset, duration: scenario.duration },
      tracks: [{ property: "opacity", keyframes: [
        { at: { value: 0, unit: "seconds" }, value: { kind: "literal", value: 0 }, interpolation: "linear" },
        { at: scenario.end, value: { kind: "literal", value: 100 }, interpolation: "linear" },
      ] }],
    });
    registerAnimation(context, definition);
    assert.match(context.OBSIDIAN_executeAnimationDefinition(definition.id, {}), /exceeds selected layer or composition timing/, scenario.name);
    assert.equal(property.keys.length, 0, scenario.name);
    assert.deepEqual(undoEvents, [], scenario.name);
  }
});

test("shared animation scale tracks resolve current-value-relative strategies without changing dimensions", () => {
  const { context, layer } = makeContext();
  const mock = enableAnimationProperty(layer._scale);
  const definition = makeAnimationDefinition({ tracks: [{ property: "scale", keyframes: [
    { at: { value: 0, unit: "frames" }, value: { kind: "current" }, interpolation: "linear" },
    { at: { value: 30, unit: "frames" }, value: { kind: "multiply_current", factor: 1.1 }, interpolation: "linear" },
  ] }] });
  registerAnimation(context, definition);
  assert.match(context.OBSIDIAN_executeAnimationDefinition(definition.id, {}), /^OK\|/);
  assert.deepEqual(Array.from(mock.keys[0].value), [100, 100]);
  assert.ok(Array.from(mock.keys[1].value).every((value) => Math.abs(value - 110) < 0.000001));
});

test("shared animation Scale adapter verifies genuine 3D vectors and rejects incompatible dimensionality", () => {
  const { context, layer } = makeContext();
  layer.threeDLayer = true;
  layer._scale.value = [100, 100, 72];
  layer._scale.propertyValueType = "ThreeD";
  const mock = enableAnimationProperty(layer._scale);
  const definition = makeAnimationDefinition({
    compatibility: { minLayers: 1, maxLayers: 1, layerTypes: ["Text"], dimensions: ["3d"] },
    tracks: [{ property: "scale", keyframes: [
      { at: { value: 0, unit: "frames" }, value: { kind: "current" }, interpolation: "linear" },
      { at: { value: 30, unit: "frames" }, value: { kind: "literal", value: [110, 110, 80] }, interpolation: "linear" },
    ] }],
  });
  registerAnimation(context, definition);
  assert.match(context.OBSIDIAN_executeAnimationDefinition(definition.id, {}), /^OK\|/);
  assert.deepEqual(mock.keys.map((key) => Array.from(key.value)), [[100, 100, 72], [110, 110, 80]]);

  const incompatible = makeContext();
  incompatible.layer.threeDLayer = true;
  incompatible.layer._scale.propertyValueType = "TwoD";
  enableAnimationProperty(incompatible.layer._scale);
  const incompatibleDefinition = makeAnimationDefinition({
    compatibility: { minLayers: 1, maxLayers: 1, layerTypes: ["Text"], dimensions: ["3d"] },
    tracks: [{ property: "scale", keyframes: [
      { at: { value: 0, unit: "frames" }, value: { kind: "literal", value: [100, 100, 100] }, interpolation: "linear" },
      { at: { value: 30, unit: "frames" }, value: { kind: "literal", value: [110, 110, 110] }, interpolation: "linear" },
    ] }],
  });
  registerAnimation(incompatible.context, incompatibleDefinition);
  assert.match(incompatible.context.OBSIDIAN_executeAnimationDefinition(incompatibleDefinition.id, {}), /dimensions or value type do not match/);
});

test("shared animation rejects invalid timing, unknown properties, and unsupported interpolation before mutation", () => {
  const { context, layer, undoEvents } = makeContext();
  layer._opacity.propertyValueType = "OneD";
  const opacity = enableAnimationProperty(layer._opacity);
  const invalidTime = makeAnimationDefinition({ tracks: [{ property: "opacity", keyframes: [
    { at: { value: 0, unit: "frames" }, value: { kind: "literal", value: 0 }, interpolation: "linear" },
    { at: { value: 31, unit: "frames" }, value: { kind: "literal", value: 100 }, interpolation: "linear" },
  ] }] });
  registerAnimation(context, invalidTime);
  assert.match(context.OBSIDIAN_executeAnimationDefinition(invalidTime.id, {}), /^REJECTED\|/);
  assert.equal(opacity.keys.length, 0);

  const unknownProperty = makeAnimationDefinition({ id: "unknown_property", tracks: [{ property: "ADBE Opacity", keyframes: [] }] });
  registerAnimation(context, unknownProperty);
  assert.match(context.OBSIDIAN_executeAnimationDefinition(unknownProperty.id, {}), /unsupported property/);

  const invalidInterpolation = makeAnimationDefinition({ id: "unsupported_interpolation" });
  registerAnimation(context, invalidInterpolation);
  layer._opacity.isInterpolationTypeValid = () => false;
  assert.match(context.OBSIDIAN_executeAnimationDefinition(invalidInterpolation.id, {}), /does not support the requested interpolation/);
  assert.equal(opacity.keys.length, 0);
  assert.deepEqual(undoEvents, []);
  assert.match(context.OBSIDIAN_executeAnimationDefinition("missing_definition", {}), /^REJECTED\|Unknown trusted animation definition/);

  const outOfRange = makeContext();
  outOfRange.layer._opacity.propertyValueType = "OneD";
  const outOfRangeProperty = enableAnimationProperty(outOfRange.layer._opacity);
  outOfRange.layer.outPoint = 1;
  const longSequence = makeAnimationDefinition({
    timing: { anchor: "layer.inPoint", offset: { value: 0, unit: "seconds" }, duration: { value: 60, unit: "frames" } },
    tracks: [{ property: "opacity", keyframes: [
      { at: { value: 0, unit: "frames" }, value: { kind: "literal", value: 0 }, interpolation: "linear" },
      { at: { value: 60, unit: "frames" }, value: { kind: "literal", value: 100 }, interpolation: "linear" },
    ] }],
  });
  registerAnimation(outOfRange.context, longSequence);
  assert.match(outOfRange.context.OBSIDIAN_executeAnimationDefinition(longSequence.id, {}), /exceeds selected layer or composition timing/);
  assert.equal(outOfRangeProperty.keys.length, 0);
  assert.deepEqual(outOfRange.undoEvents, []);
});

test("shared animation enforces parameter bounds before opening an undo group", () => {
  const { context, layer, undoEvents } = makeContext();
  layer._opacity.propertyValueType = "OneD";
  const opacity = enableAnimationProperty(layer._opacity);
  const definition = makeAnimationDefinition({
    parameters: [{ name: "peak", minimum: 0, maximum: 100 }],
    tracks: [{ property: "opacity", keyframes: [
      { at: { value: 0, unit: "frames" }, value: { kind: "parameter", name: "peak" }, interpolation: "linear" },
      { at: { value: 30, unit: "frames" }, value: { kind: "literal", value: 100 }, interpolation: "linear" },
    ] }],
  });
  registerAnimation(context, definition);
  assert.match(context.OBSIDIAN_executeAnimationDefinition(definition.id, { peak: 101 }), /must be from 0 to 100/);
  assert.equal(opacity.keys.length, 0);
  assert.deepEqual(undoEvents, []);
});

test("shared animation preserves existing keyframes and expressions", () => {
  const keyed = makeContext();
  keyed.layer._opacity.propertyValueType = "OneD";
  const keyedMock = enableAnimationProperty(keyed.layer._opacity);
  keyed.layer._opacity.setValueAtTime(0.25, 45);
  const keyedDefinition = registerAnimation(keyed.context);
  assert.match(keyed.context.OBSIDIAN_executeAnimationDefinition(keyedDefinition.id, {}), /existing keyframes or expression/);
  assert.equal(keyedMock.keys.length, 1);
  assert.deepEqual(keyed.undoEvents, []);

  const expressed = makeContext();
  expressed.layer._opacity.propertyValueType = "OneD";
  enableAnimationProperty(expressed.layer._opacity);
  expressed.layer._opacity.expression = "value * 0.5";
  const expressionDefinition = registerAnimation(expressed.context);
  assert.match(expressed.context.OBSIDIAN_executeAnimationDefinition(expressionDefinition.id, {}), /existing keyframes or expression/);
  assert.deepEqual(expressed.undoEvents, []);
});

test("shared animation rejects unsupported layer compatibility before mutation", () => {
  const { context, layer, undoEvents } = makeContext();
  layer._opacity.propertyValueType = "OneD";
  const opacity = enableAnimationProperty(layer._opacity);
  const definition = makeAnimationDefinition({ compatibility: { minLayers: 1, maxLayers: 1, layerTypes: ["Shape"], dimensions: ["2d"] } });
  registerAnimation(context, definition);
  assert.match(context.OBSIDIAN_executeAnimationDefinition(definition.id, {}), /layer type or 2D\/3D state is not supported/);
  assert.equal(opacity.keys.length, 0);
  assert.deepEqual(undoEvents, []);
});

test("shared animation rolls back keys and restores original static values after partial execution failure", () => {
  const { context, layer, undoEvents } = makeContext();
  layer._opacity.propertyValueType = "OneD";
  const opacity = enableAnimationProperty(layer._opacity);
  const scale = enableAnimationProperty(layer._scale, { throwAfterSetAt: 1 });
  const definition = makeAnimationDefinition({ tracks: [
    { property: "opacity", keyframes: [
      { at: { value: 0, unit: "frames" }, value: { kind: "literal", value: 0 }, interpolation: "linear" },
      { at: { value: 30, unit: "frames" }, value: { kind: "literal", value: 100 }, interpolation: "linear" },
    ] },
    { property: "scale", keyframes: [
      { at: { value: 0, unit: "frames" }, value: { kind: "literal", value: [80, 80] }, interpolation: "linear" },
      { at: { value: 30, unit: "frames" }, value: { kind: "literal", value: [100, 100] }, interpolation: "linear" },
    ] },
  ] });
  registerAnimation(context, definition);

  const result = context.OBSIDIAN_executeAnimationDefinition(definition.id, {});
  assert.match(result, /failed and generated keyframes were removed/);
  assert.equal(opacity.keys.length, 0);
  assert.equal(scale.keys.length, 0);
  assert.equal(layer._opacity.value, 100);
  assert.deepEqual(Array.from(layer._scale.value), [100, 100]);
  assert.deepEqual(undoEvents.map(([kind]) => kind), ["begin", "end"]);
});

test("shared animation read-back mismatch triggers cleanup and does not report success", () => {
  const { context, layer } = makeContext();
  layer._opacity.propertyValueType = "OneD";
  const opacity = enableAnimationProperty(layer._opacity, { corruptReadBackAt: 2 });
  const definition = registerAnimation(context);
  const result = context.OBSIDIAN_executeAnimationDefinition(definition.id, {});
  assert.match(result, /failed and generated keyframes were removed/);
  assert.match(result, /read-back: key 2 value requested "100", actual "101"/);
  assert.equal(opacity.keys.length, 0);
  assert.equal(layer._opacity.value, 100);
});

test("shared animation reports incomplete cleanup when a generated key cannot be removed", () => {
  const { context, layer, undoEvents } = makeContext();
  layer._opacity.propertyValueType = "OneD";
  const opacity = enableAnimationProperty(layer._opacity, { throwAfterSetAt: 1, throwRemove: true });
  const definition = registerAnimation(context);
  const result = context.OBSIDIAN_executeAnimationDefinition(definition.id, {});
  assert.match(result, /cleanup left 1 generated keyframe/);
  assert.equal(opacity.keys.length, 1);
  assert.deepEqual(undoEvents.map(([kind]) => kind), ["begin", "end"]);
});

test("shared animation balances one undo group on success and reports close failures without retrying", () => {
  const successful = makeContext();
  successful.layer._opacity.propertyValueType = "OneD";
  enableAnimationProperty(successful.layer._opacity);
  const definition = registerAnimation(successful.context);
  assert.match(successful.context.OBSIDIAN_executeAnimationDefinition(definition.id, {}), /^OK\|/);
  assert.deepEqual(successful.undoEvents.map(([kind]) => kind), ["begin", "end"]);

  const closing = makeContext();
  closing.layer._opacity.propertyValueType = "OneD";
  const property = enableAnimationProperty(closing.layer._opacity);
  const closeDefinition = registerAnimation(closing.context);
  closing.context.app.endUndoGroup = () => { closing.undoEvents.push(["end"]); throw new Error("mock close failure"); };
  const result = closing.context.OBSIDIAN_executeAnimationDefinition(closeDefinition.id, {});
  assert.match(result, /could not close its undo group/);
  assert.equal(property.keys.length, 0);
  assert.deepEqual(closing.undoEvents.map(([kind]) => kind), ["begin", "end"]);
});

test("shared animation reports both operation and undo-close failures when cleanup succeeds", () => {
  const { context, layer, undoEvents } = makeContext();
  layer._opacity.propertyValueType = "OneD";
  const property = enableAnimationProperty(layer._opacity, { throwAfterSetAt: 1 });
  const definition = registerAnimation(context);
  context.app.endUndoGroup = () => { undoEvents.push(["end"]); throw new Error("mock close failure"); };

  const result = context.OBSIDIAN_executeAnimationDefinition(definition.id, {});
  assert.match(result, /failed and generated keyframes were removed/);
  assert.match(result, /mock failure after key write/);
  assert.match(result, /Undo-group close failed: Error: mock close failure/);
  assert.equal(property.keys.length, 0);
  assert.deepEqual(undoEvents.map(([kind]) => kind), ["begin", "end"]);
});

test("shared animation reports operation, cleanup, and undo-close failures separately", () => {
  const { context, layer, undoEvents } = makeContext();
  layer._opacity.propertyValueType = "OneD";
  const property = enableAnimationProperty(layer._opacity, { throwAfterSetAt: 1, throwRemove: true });
  const definition = registerAnimation(context);
  context.app.endUndoGroup = () => { undoEvents.push(["end"]); throw new Error("mock close failure"); };

  const result = context.OBSIDIAN_executeAnimationDefinition(definition.id, {});
  assert.match(result, /failed; cleanup left 1 generated keyframe/);
  assert.match(result, /mock failure after key write/);
  assert.match(result, /Undo-group close failed: Error: mock close failure/);
  assert.equal(property.keys.length, 1);
  assert.deepEqual(undoEvents.map(([kind]) => kind), ["begin", "end"]);
});

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

function manyCaptionPayload(count) {
  const duration = count * 0.03 + 1;
  const base = captionPayload();
  return captionPayload({
    source: { ...base.source, outPoint: duration, compDuration: duration },
    segments: Array.from({ length: count }, (_, index) => ({
      text: "Caption " + (index + 1),
      start: index * 0.03,
      end: (index + 1) * 0.03,
    })),
  });
}

function simulateAeThreeComponentScaleReadBack(comp, options) {
  const { layer3D = false, z = 100, corruptKey = 0, corruptComponent = 2, corruptDelta = -1 } = options || {};
  const addText = comp.layers.addBoxText.bind(comp.layers);
  comp.layers.addBoxText = (size) => {
    const layer = addText(size);
    layer.threeDLayer = layer3D;
    const scale = layer.property("ADBE Transform Group").property("ADBE Scale");
    scale.propertyValueType = "ThreeD";
    scale.value = [100, 100, z];
    const setValueAtTime = scale.setValueAtTime;
    let writeIndex = 0;
    scale.setValueAtTime = function (time, value) {
      writeIndex++;
      const actualValue = [Number(value[0]), Number(value[1]), z];
      if (writeIndex === corruptKey) actualValue[corruptComponent] += corruptDelta;
      return setValueAtTime.call(this, time, actualValue);
    };
    return layer;
  };
}

function studioStyle(overrides) {
  return Object.assign({
    version: 1,
    font: "Montserrat-Bold",
    fontSize: 64,
    minFontSize: 20,
    fillColor: [0.38, 0.9, 0.96],
    fillEnabled: true,
    strokeEnabled: true,
    strokeColor: [0.02, 0.03, 0.08],
    strokeWidth: 3,
    alignment: "center",
    positionX: 0.46,
    positionY: 0.82,
    animation: "smooth_scale",
    animationDuration: 0.4,
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

test("caption style inspection reads text typography, layout, effects, and animation without edits", () => {
  const { context, layer } = makeContext();
  const result = context.OBSIDIAN_executePlan("inspect_caption_style", { readOnly: true }, "");
  const fields = result.split("|");
  assert.equal(fields.length, 23);
  assert.equal(fields[0], "OK");
  assert.equal(fields[1], "CAPTION_STYLE");
  assert.equal(unescape(fields[2]), "Headline");
  assert.equal(unescape(fields[3]), "ArialMT");
  assert.equal(unescape(fields[4]), "Regular");
  assert.equal(fields[15], "center");
  assert.match(unescape(fields[21]), /No effects detected/);
  assert.match(unescape(fields[22]), /Opacity: static/);
  assert.equal(layer._opacity.value, 100);

  const footage = makeCaptionContext();
  assert.match(footage.context.OBSIDIAN_executePlan("inspect_caption_style", null, ""), /Select exactly one After Effects text layer/);
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

test("a Studio font-size increase reaches the After Effects text document and read-back", () => {
  const sizes = [64, 240].map((fontSize) => {
    const { context, generated } = makeCaptionContext();
    const result = context.OBSIDIAN_executePlan("create_captions", captionPayload({
      style: studioStyle({ fontSize, minFontSize: 20, animation: "none" }),
      segments: [{ text: "Hi.", start: 0.2, end: 1.1 }],
    }), "");
    assert.match(result, /^OK\|Verified 1 timed caption layer/);
    const document = generated[0].property("ADBE Text Properties").property("ADBE Text Document").value;
    assert.equal(document.fontSize, fontSize);
    return document.fontSize;
  });
  assert.ok(sizes[1] > sizes[0]);
});

test("font sizes outside After Effects' supported range are rejected before layer creation", () => {
  for (const style of [
    studioStyle({ fontSize: 0.09, minFontSize: 0.09 }),
    studioStyle({ fontSize: 1296.1, minFontSize: 20 }),
    studioStyle({ fontSize: 64, minFontSize: 64.1 }),
  ]) {
    const { context, generated } = makeCaptionContext();
    const result = context.OBSIDIAN_executePlan("create_captions", captionPayload({ style }), "");
    assert.match(result, /approved caption style is invalid/);
    assert.equal(generated.length, 0);
  }
});

test("caption host wraps long captions in paragraph boxes and preserves the exact source text", () => {
  const { context, generated } = makeCaptionContext();
  const text = "A full caption must wrap while every spoken word remains available. ".repeat(35).trim();
  const payload = captionPayload({
    style: studioStyle({ minFontSize: 10, animation: "none" }),
    segments: [{ text, start: 0.2, end: 2.4 }],
  });
  const result = context.OBSIDIAN_executePlan("create_captions", payload, "");
  assert.match(result, /^OK\|Verified 1 timed caption layer/);
  assert.equal(generated.length, 1);
  const document = generated[0].property("ADBE Text Properties").property("ADBE Text Document").value;
  assert.equal(document.text, text);
  assert.equal(document.boxText, true);
  assert.deepEqual(Array.from(document.boxTextSize), [Math.floor(2 * Math.min(1920 * (0.46 - 0.02), 1920 * (0.98 - 0.46))), document.boxTextSize[1]]);
  assert.ok(document.boxTextSize[1] > document.leading);
  assert.ok(document.fontSize < 64);
  assert.equal(document.boxOverflow, false);
});

test("caption host lowers one shared font size when AE reports paragraph-box overflow", () => {
  const { context, comp, generated } = makeCaptionContext();
  const originalAddBoxText = comp.layers.addBoxText.bind(comp.layers);
  const fontSizeAssignments = [];
  comp.layers.addBoxText = (size) => {
    const layer = originalAddBoxText(size);
    const property = layer.property("ADBE Text Properties").property("ADBE Text Document");
    const originalSetValue = property.setValue.bind(property);
    property.setValue = (value) => {
      fontSizeAssignments.push(Number(value.fontSize));
      originalSetValue(value);
      property.value.boxOverflow = Number(value.fontSize) > 30;
    };
    return layer;
  };
  const result = context.OBSIDIAN_executePlan("create_captions", captionPayload({
    style: studioStyle({ minFontSize: 20, animation: "none" }),
    segments: [
      { text: "First complete line", start: 0.2, end: 1.1 },
      { text: "Second complete line", start: 1.1, end: 2.2 },
    ],
  }), "");
  assert.match(result, /^OK\|Verified 2 timed caption layer\(s\)/);
  const documents = generated.map((layer) => layer.property("ADBE Text Properties").property("ADBE Text Document").value);
  assert.ok(documents.every((document) => document.fontSize === 30));
  assert.equal(fontSizeAssignments[0], 64);
  assert.equal(fontSizeAssignments.at(-1), 30);
  assert.ok(fontSizeAssignments.some((fontSize) => fontSize < 64 && fontSize > 30));
  assert.ok(documents.every((document) => document.text.indexOf("complete") !== -1));
  assert.ok(documents.every((document) => document.boxOverflow === false));
});

test("caption host reports auto-fit-floor overflow and rolls back its generated captions", () => {
  const { context, comp, generated } = makeCaptionContext();
  const originalAddBoxText = comp.layers.addBoxText.bind(comp.layers);
  comp.layers.addBoxText = (size) => {
    const layer = originalAddBoxText(size);
    const property = layer.property("ADBE Text Properties").property("ADBE Text Document");
    const originalSetValue = property.setValue.bind(property);
    property.setValue = (value) => {
      originalSetValue(value);
      property.value.boxOverflow = true;
    };
    return layer;
  };
  const result = context.OBSIDIAN_executePlan("create_captions", captionPayload({
    style: studioStyle({ minFontSize: 20, animation: "none" }),
    segments: [{ text: "Text that remains intact", start: 0.2, end: 1.1 }],
  }), "");
  assert.match(result, /still overflows the composition text area at the selected auto-fit floor of 20 px/);
  assert.match(result, /1 generated caption layer\(s\) were removed/);
  assert.equal(generated.length, 1);
  assert.equal(generated[0].removed, true);
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

test("caption host accepts 400, 401, and 1,000 segments and rejects 1,001 before editing", () => {
  for (const count of [400, 401, 1000]) {
    const { context, comp, sourceLayer, generated } = makeCaptionContext();
    const payload = manyCaptionPayload(count);
    comp.duration = payload.source.compDuration;
    sourceLayer.outPoint = payload.source.outPoint;
    let undoGroupsStarted = 0;
    let undoGroupsEnded = 0;
    context.app.beginUndoGroup = () => { undoGroupsStarted++; };
    context.app.endUndoGroup = () => { undoGroupsEnded++; };

    const result = context.OBSIDIAN_executePlan("create_captions", payload, "");
    assert.equal(result, "OK|Verified " + count + " timed caption layer(s) using the clean style.");
    assert.equal(generated.length, count);
    assert.equal(generated[0].property("ADBE Text Properties").property("ADBE Text Document").value.text, "Caption 1");
    assert.equal(generated[count - 1].property("ADBE Text Properties").property("ADBE Text Document").value.text, "Caption " + count);
    assert.equal(generated[count - 1].outPoint, count * 0.03);
    assert.equal(undoGroupsStarted, 1);
    assert.equal(undoGroupsEnded, 1);
  }

  const rejected = makeCaptionContext();
  const oversized = manyCaptionPayload(1001);
  rejected.comp.duration = oversized.source.compDuration;
  rejected.sourceLayer.outPoint = oversized.source.outPoint;
  const response = rejected.context.OBSIDIAN_executePlan("create_captions", oversized, "");
  assert.match(response, /1 to 1,000 timed captions/);
  assert.equal(rejected.generated.length, 0);
});

test("caption host rolls back all 1,000 generated layers when final read-back verification fails", () => {
  const { context, comp, sourceLayer, generated } = makeCaptionContext();
  const payload = manyCaptionPayload(1000);
  comp.duration = payload.source.compDuration;
  sourceLayer.outPoint = payload.source.outPoint;
  const originalAddText = comp.layers.addBoxText.bind(comp.layers);
  let addedCount = 0;
  comp.layers.addBoxText = (size) => {
    const layer = originalAddText(size);
    if (++addedCount === 1000) {
      const property = layer.property("ADBE Text Properties").property("ADBE Text Document");
      const originalSetValue = property.setValue.bind(property);
      property.setValue = (value) => originalSetValue(Object.assign({}, value, { text: "read-back mismatch" }));
    }
    return layer;
  };

  const result = context.OBSIDIAN_executePlan("create_captions", payload, "");
  assert.match(result, /failed and 1000 generated caption layer\(s\) were removed/);
  assert.match(result, /Caption 1000 read-back mismatch/);
  assert.equal(generated.length, 1000);
  assert.ok(generated.every((layer) => layer.removed));
  assert.equal(sourceLayer.removed, undefined);
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
  const originalAddText = comp.layers.addBoxText.bind(comp.layers);
  comp.layers.addBoxText = (size) => {
    const layer = originalAddText(size);
    const property = layer.property("ADBE Text Properties").property("ADBE Text Document");
    property.setValue = (value) => { property.value = Object.assign({}, value, { text: "read-back mismatch" }); };
    return layer;
  };
  const result = context.OBSIDIAN_executePlan("create_captions", captionPayload(), "");
  assert.match(result, /failed and 2 generated caption layer\(s\) were removed/);
  assert.match(result, /text requested "A local caption\.", actual "read-back mismatch"/);
  assert.equal(generated.length, 2);
  assert.ok(generated.every((layer) => layer.removed));
});

test("Caption Style Studio applies one fitted style consistently and preserves reviewed text and timing", () => {
  const { context, generated } = makeCaptionContext();
  const segments = [
    { text: "Brief caption", start: 0.2, end: 1.1 },
    { text: "A deliberately longer caption that determines the one shared font size", start: 1.1, end: 2.4 },
    { text: "Final line", start: 2.4, end: 3.1 },
  ];
  const payload = captionPayload({ style: studioStyle({ animation: "none" }), segments });
  const result = context.OBSIDIAN_executePlan("create_captions", payload, "");
  assert.match(result, /Verified 3 timed caption layer\(s\) using Caption Style Studio/);
  assert.equal(generated.length, segments.length);
  const documents = generated.map((layer) => layer.property("ADBE Text Properties").property("ADBE Text Document").value);
  const positions = generated.map((layer) => layer.property("ADBE Transform Group").property("ADBE Position").value);
  assert.deepEqual(documents.map((document) => document.text), segments.map((segment) => segment.text));
  assert.ok(documents.every((document) => document.font === "Montserrat-Bold"));
  assert.ok(documents.every((document) => document.fontSize === documents[0].fontSize));
  assert.ok(documents.every((document) => document.fillColor.join(",") === "0.38,0.9,0.96"));
  assert.ok(positions.every((position) => position.join(",") === positions[0].join(",")));
  assert.deepEqual(generated.map((layer) => [layer.inPoint, layer.outPoint]), segments.map(({ start, end }) => [start, end]));
  assert.deepEqual(generated.map((layer) => layer.index), [1, 2, 3]);
});

test("Caption Style Studio applies and verifies each deterministic animation preset", () => {
  const expected = { none: 0, fade: 2, pop: 3, smooth_scale: 2, slide: 2, typewriter: 9, word_emphasis: 3 };
  for (const [animation, keyCount] of Object.entries(expected)) {
    const { context, generated } = makeCaptionContext();
    const payload = captionPayload({
      style: studioStyle({ animation }),
      segments: [{ text: "Type test", start: 0.2, end: 1.1 }],
    });
    const result = context.OBSIDIAN_executePlan("create_captions", payload, "");
    assert.match(result, /^OK\|Verified 1 timed caption layer/ , animation);
    const layer = generated[0];
    const transform = layer.property("ADBE Transform Group");
    const property = animation === "fade" ? transform.property("ADBE Opacity")
      : animation === "slide" ? transform.property("ADBE Position")
        : animation === "typewriter" ? layer.property("ADBE Text Properties").property("ADBE Text Document")
          : transform.property("ADBE Scale");
    assert.equal(Number(property.numKeys) || 0, keyCount, animation);
    if (animation === "typewriter") {
      assert.equal(property.valueAtTime(1.1, false).text, "Type test");
      assert.ok(property._keys.every((key) => key.interpolation.incoming === "hold"));
    }
  }
});

test("Typewriter preserves Source Text native Hold interpolation instead of reassigning an unsupported enum", () => {
  const { context, comp, generated } = makeCaptionContext();
  const addText = comp.layers.addBoxText.bind(comp.layers);
  comp.layers.addBoxText = (size) => {
    const layer = addText(size);
    const sourceText = layer.property("ADBE Text Properties").property("ADBE Text Document");
    const setValueAtTime = sourceText.setValueAtTime;
    let interpolationAssignments = 0;
    sourceText.setValueAtTime = function (time, value) {
      setValueAtTime.call(this, time, value);
      const key = this._keys.find((entry) => Math.abs(entry.time - time) < 1e-8);
      key.interpolation = {
        incoming: context.KeyframeInterpolationType.HOLD,
        outgoing: context.KeyframeInterpolationType.HOLD,
      };
    };
    sourceText.isInterpolationTypeValid = (type) => type !== context.KeyframeInterpolationType.HOLD;
    sourceText.setInterpolationTypeAtKey = () => {
      interpolationAssignments++;
      throw new Error("Invalid interpolation type for this property.");
    };
    layer._interpolationAssignments = () => interpolationAssignments;
    return layer;
  };

  const result = context.OBSIDIAN_executePlan("create_captions", captionPayload({
    style: studioStyle({ animation: "typewriter" }),
    segments: [{ text: "Stepped text", start: 0.2, end: 1.1 }],
  }), "");

  assert.match(result, /^OK\|Verified 1 timed caption layer/);
  const sourceText = generated[0].property("ADBE Text Properties").property("ADBE Text Document");
  assert.equal(generated[0]._interpolationAssignments(), 0);
  assert.ok(sourceText._keys.every((key) =>
    key.interpolation.incoming === context.KeyframeInterpolationType.HOLD &&
    key.interpolation.outgoing === context.KeyframeInterpolationType.HOLD));
  assert.equal(sourceText.valueAtTime(1.1, false).text, "Stepped text");
});

test("Caption Scale animation verifies X/Y when AE returns an extra hidden Z component for a 2D layer", () => {
  const { context, comp, generated } = makeCaptionContext();
  simulateAeThreeComponentScaleReadBack(comp, { layer3D: false, z: 100 });
  const result = context.OBSIDIAN_executePlan("create_captions", captionPayload({
    style: studioStyle({ animation: "pop" }),
    segments: [{ text: "2D scale", start: 0.2, end: 1.1 }],
  }), "");

  assert.match(result, /^OK\|Verified 1 timed caption layer/);
  const scale = generated[0].property("ADBE Transform Group").property("ADBE Scale");
  assert.deepEqual(scale._keys.map(({ value }) => Array.from(value)), [
    [78, 78, 100], [108, 108, 100], [100, 100, 100],
  ]);
});

test("Caption Scale animation verifies X/Y and preserved Z independently on a genuine 3D layer", () => {
  const { context, comp, generated } = makeCaptionContext();
  simulateAeThreeComponentScaleReadBack(comp, { layer3D: true, z: 63 });
  const result = context.OBSIDIAN_executePlan("create_captions", captionPayload({
    style: studioStyle({ animation: "pop" }),
    segments: [{ text: "3D scale", start: 0.2, end: 1.1 }],
  }), "");

  assert.match(result, /^OK\|Verified 1 timed caption layer/);
  const scale = generated[0].property("ADBE Transform Group").property("ADBE Scale");
  assert.deepEqual(scale._keys.map(({ value }) => Array.from(value)), [
    [78, 78, 63], [108, 108, 63], [100, 100, 63],
  ]);
});

test("Caption Scale animation rejects a changed 3D Z read-back and rolls back generated captions", () => {
  const { context, comp, generated } = makeCaptionContext();
  simulateAeThreeComponentScaleReadBack(comp, { layer3D: true, z: 63, corruptKey: 2 });
  const result = context.OBSIDIAN_executePlan("create_captions", captionPayload({
    style: studioStyle({ animation: "pop" }),
    segments: [{ text: "3D scale", start: 0.2, end: 1.1 }],
  }), "");

  assert.match(result, /failed and 1 generated caption layer\(s\) were removed/);
  assert.match(result, /animation\.key\[2\]\.value\[2\] requested preserved Z "63", actual "62"/);
  assert.equal(generated.length, 1);
  assert.equal(generated[0].removed, true);
});

test("Caption Scale animation still rejects an X/Y mismatch after normalizing the extra Z component", () => {
  const { context, comp, generated } = makeCaptionContext();
  simulateAeThreeComponentScaleReadBack(comp, { layer3D: false, z: 100, corruptKey: 2, corruptComponent: 0, corruptDelta: 1 });
  const result = context.OBSIDIAN_executePlan("create_captions", captionPayload({
    style: studioStyle({ animation: "pop" }),
    segments: [{ text: "2D scale", start: 0.2, end: 1.1 }],
  }), "");

  assert.match(result, /failed and 1 generated caption layer\(s\) were removed/);
  assert.match(result, /animation\.key\[2\]\.value\[0\] requested "108", actual "109"/);
  assert.equal(generated[0].removed, true);
});

test("Caption Style Studio rejects unsupported styling before creating layers", () => {
  const { context, generated } = makeCaptionContext();
  const result = context.OBSIDIAN_executePlan("create_captions", captionPayload({
    style: studioStyle({ animation: "raw_jsx" }),
  }), "");
  assert.match(result, /approved caption style is invalid/);
  assert.equal(generated.length, 0);
});


function makeShakeClips(context, outgoingOutPoint = 3, incomingInPoint = 2) {
  const outgoing = makeTextLayer("Outgoing clip", 1, 100);
  const incoming = makeTextLayer("Incoming clip", 2, 100);
  for (const [layer, inPoint, outPoint] of [[outgoing, 0, outgoingOutPoint], [incoming, incomingInPoint, 5]]) {
    Object.setPrototypeOf(layer, AVLayer.prototype);
    layer.source = new FootageItem();
    layer.inPoint = inPoint;
    layer.outPoint = outPoint;
    layer.threeDLayer = false;
    layer.locked = false;
  }
  const properties = [];
  for (const layer of [outgoing, incoming]) {
    const transform = layer.property("ADBE Transform Group");
    const positionProperty = transform.property("ADBE Position");
    const rotationProperty = transform.property("ADBE Rotation");
    const scaleProperty = transform.property("ADBE Scale");
    const position = enableAnimationProperty(positionProperty);
    const rotation = enableAnimationProperty(rotationProperty);
    const scale = enableAnimationProperty(scaleProperty);
    position.property = positionProperty;
    rotation.property = rotationProperty;
    scale.property = scaleProperty;
    properties.push({ position, rotation, scale });
  }
  context.app.project.activeItem.selectedLayers = [incoming, outgoing]; // Deliberately reverse selection order.
  return { outgoing, incoming, properties };
}

test("Shake 01 supplies AE temporal-ease arrays by property type, not Position vector length", () => {
  const { context } = makeContext();
  const clips = makeShakeClips(context);
  const observed = [];
  for (const entry of clips.properties) {
    for (const [channel, track] of Object.entries(entry)) {
      const property = track.property;
      property.setTemporalEaseAtKey = (index, easeIn, easeOut) => {
        const normalizedChannel = channel.toUpperCase();
        observed.push({ channel: normalizedChannel, index, inLength: easeIn.length, outLength: easeOut.length });
        const expected = normalizedChannel === "SCALE" ? 2 : 1;
        if (easeIn.length !== expected || easeOut.length !== expected) {
          throw new Error("Value array does not have " + expected + " elements.");
        }
      };
    }
  }

  const result = context.OBSIDIAN_shakeTransition(0.4, 0.4, "shake_01");
  assert.match(result, /^OK\\|Applied and verified Shake 01/);
  assert.equal(observed.length, 30);
  assert.ok(observed.filter((entry) => entry.channel === "POSITION")
    .every((entry) => entry.inLength === 1 && entry.outLength === 1));
  assert.ok(observed.filter((entry) => entry.channel === "ROTATION")
    .every((entry) => entry.inLength === 1 && entry.outLength === 1));
  assert.ok(observed.filter((entry) => entry.channel === "SCALE")
    .every((entry) => entry.inLength === 2 && entry.outLength === 2));
});

test("Shake 01 applies verified Position, Rotation, and Scale keys without changing clip timing", () => {
  const { context, comp, undoEvents } = makeContext();
  const clips = makeShakeClips(context);
  const before = clips.properties.map((entry) => Object.values(entry).map((track) => track.keys.length));
  const result = context.OBSIDIAN_shakeTransition(0.4, 0.4, "shake_01");
  assert.match(result, /^OK\\|Applied and verified Shake 01/);
  assert.deepEqual(clips.properties.map((entry) => Object.values(entry).map((track) => track.keys.length)),
    [[5, 5, 5], [5, 5, 5]]);
  assert.deepEqual(before, [[0, 0, 0], [0, 0, 0]]);
  assert.equal(clips.outgoing.inPoint, 0);
  assert.equal(clips.outgoing.outPoint, 3);
  assert.equal(clips.incoming.inPoint, 2);
  assert.equal(clips.incoming.outPoint, 5);
  assert.deepEqual(undoEvents.map(([kind]) => kind), ["begin", "end"]);
  assert.equal(comp.selectedLayers.length, 2);
});

test("Shake 01 accepts AE TwoD Position metadata with a three-component read-back and preserves hidden Z", () => {
  const { context } = makeContext();
  const clips = makeShakeClips(context);
  for (const entry of clips.properties) {
    const property = entry.position.property;
    property.value = [640, 360, 0];
    property.propertyValueType = context.PropertyValueType.TwoD;
    property.dimensionsSeparated = false;
    property.isSeparationLeader = true;
  }

  const result = context.OBSIDIAN_shakeTransition(0.4, 0.4, "shake_01");
  assert.match(result, /^OK\\|Applied and verified Shake 01/);
  for (const entry of clips.properties) {
    assert.equal(entry.position.keys.length, 5);
    assert.ok(entry.position.keys.every(({ value }) => value.length === 3 && value[2] === 0));
  }
});

test("Shake 01 accepts AE numeric TwoD enum 6413 when host enum globals do not match", () => {
  const { context } = makeContext();
  const clips = makeShakeClips(context);
  for (const entry of clips.properties) {
    const property = entry.position.property;
    property.value = [640, 360, 0];
    property.propertyValueType = 6413;
    property.dimensionsSeparated = false;
    property.isSeparationLeader = true;
  }

  const result = context.OBSIDIAN_shakeTransition(0.4, 0.4, "shake_01");
  assert.match(result, /^OK\\|Applied and verified Shake 01/);
  for (const entry of clips.properties) {
    assert.equal(entry.position.keys.length, 5);
    assert.ok(entry.position.keys.every(({ value }) => value.length === 3 && value[2] === 0));
  }
});

test("Shake 01 reports both selected layers' Position metadata when Position is not a 2D vector", () => {
  const { context } = makeContext();
  const clips = makeShakeClips(context);
  clips.properties[0].position.property.value = [960, 540, 0];
  clips.properties[0].position.property.propertyValueType = 3;
  clips.properties[0].position.property.dimensionsSeparated = false;
  clips.properties[0].position.property.isSeparationLeader = false;

  const result = context.OBSIDIAN_shakeTransition(0.4, 0.4, "shake_01");
  assert.match(result, /Shake 01 requires a unified 2D Position property/);
  assert.match(result, /layer='Outgoing clip' valueLength=3 propertyValueType=ThreeD dimensionsSeparated=false isSeparationLeader=false layer3D=false value=\[960, 540, 0\]/);
  assert.match(result, /layer='Incoming clip' valueLength=2/);
  for (const entry of clips.properties) for (const track of Object.values(entry)) assert.equal(track.keys.length, 0);
});

test("Shake 01 reports separated Position metadata without changing either clip", () => {
  const { context } = makeContext();
  const clips = makeShakeClips(context);
  clips.properties[1].position.property.dimensionsSeparated = true;
  clips.properties[1].position.property.isSeparationLeader = true;

  const result = context.OBSIDIAN_shakeTransition(0.4, 0.4, "shake_01");
  assert.match(result, /layer='Outgoing clip' valueLength=2/);
  assert.match(result, /layer='Incoming clip' valueLength=2 propertyValueType=undefined dimensionsSeparated=true isSeparationLeader=true/);
  for (const entry of clips.properties) for (const track of Object.values(entry)) assert.equal(track.keys.length, 0);
});

test("Shake 01 supports AE 2D Scale read-back with a preserved third component", () => {
  const { context } = makeContext();
  const clips = makeShakeClips(context);
  for (const entry of clips.properties) {
    const property = entry.scale.property;
    property.value = [100, 100, 73];
    const originalSetValueAtTime = property.setValueAtTime.bind(property);
    property.setValueAtTime = (time, value) => originalSetValueAtTime(time, [value[0], value[1], 73]);
  }

  const result = context.OBSIDIAN_shakeTransition(0.4, 0.4, "shake_01");
  assert.match(result, /^OK\\|Applied and verified Shake 01/);
  for (const entry of clips.properties) {
    assert.equal(entry.scale.keys.length, 5);
    assert.ok(entry.scale.keys.every(({ value }) => value.length === 3 && value[2] === 73));
  }
});

test("Shake 01 rollback restores the full three-component Scale snapshot on a 2D layer", () => {
  const { context } = makeContext();
  const clips = makeShakeClips(context);
  const scaleProperty = clips.outgoing.property("ADBE Transform Group").property("ADBE Scale");
  scaleProperty.value = [100, 100, 73];
  const failingScale = enableAnimationProperty(scaleProperty, { throwBeforeSetAt: 3 });
  clips.properties[0].scale = failingScale;

  const result = context.OBSIDIAN_shakeTransition(0.4, 0.4, "shake_01");
  assert.match(result, /Shake 01 failed; generated keyframes were removed/);
  assert.deepEqual(Array.from(scaleProperty.value), [100, 100, 73]);
  assert.equal(failingScale.keys.length, 0);
});

test("Shake 01 rejects clips without overlap before writing transform keys", () => {
  const { context } = makeContext();
  const clips = makeShakeClips(context, 2, 2);
  const result = context.OBSIDIAN_shakeTransition(0.4, 0.4, "shake_01");
  assert.match(result, /^REJECTED\\|The selected clips need at least four frames of overlap/);
  for (const entry of clips.properties) for (const track of Object.values(entry)) assert.equal(track.keys.length, 0);
});

test("Shake 01 preserves pre-existing transform animation", () => {
  const { context } = makeContext();
  const clips = makeShakeClips(context);
  clips.properties[0].scale.property.setValueAtTime(0.5, [110, 110]);
  const result = context.OBSIDIAN_shakeTransition(0.4, 0.4, "shake_01");
  assert.match(result, /^REJECTED\\|Existing transform keyframes/);
  assert.equal(clips.properties[0].scale.keys.length, 1);
  assert.equal(clips.properties[0].position.keys.length, 0);
  assert.equal(clips.properties[1].position.keys.length, 0);
});

test("Shake 01 rolls back every generated key when a transform write fails", () => {
  const { context, undoEvents } = makeContext();
  const clips = makeShakeClips(context);
  const transform = clips.outgoing.property("ADBE Transform Group");
  const failing = enableAnimationProperty(transform.property("ADBE Position"), { throwBeforeSetAt: 3 });
  clips.properties[0].position = failing;
  const result = context.OBSIDIAN_shakeTransition(0.4, 0.4, "shake_01");
  assert.match(result, /^ERROR\\|Shake 01 failed; generated keyframes were removed/);
  for (const entry of clips.properties) for (const track of Object.values(entry)) assert.equal(track.keys.length, 0);
  for (const layer of [clips.outgoing, clips.incoming]) {
    const transform = layer.property("ADBE Transform Group");
    assert.deepEqual(transform.property("ADBE Position").value, [960, 540]);
    assert.equal(transform.property("ADBE Rotation").value, 0);
    assert.deepEqual(transform.property("ADBE Scale").value, [100, 100]);
  }
  assert.deepEqual(undoEvents.map(([kind]) => kind), ["begin", "end"]);
});

test("Shake 01 rejects durations outside its supported range", () => {
  const { context } = makeContext();
  const clips = makeShakeClips(context);
  const result = context.OBSIDIAN_shakeTransition(2.1, 0.4, "shake_01");
  assert.match(result, /^REJECTED\\|Each Shake 01 duration must be between 0.1 and 2 seconds/);
  for (const entry of clips.properties) for (const track of Object.values(entry)) assert.equal(track.keys.length, 0);
});
