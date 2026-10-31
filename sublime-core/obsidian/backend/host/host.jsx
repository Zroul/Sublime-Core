/* OBSIDIAN After Effects host tools.
 * Loaded into After Effects by CEP through ScriptPath.
 * Keep this file ExtendScript-compatible (ES3-era JavaScript).
 * Inspect commands are read-only. Editing commands use undo groups and verify read-back.
 */

function OBSIDIAN_getActiveComp() {
    var item = app.project ? app.project.activeItem : null;
    return item && item instanceof CompItem ? item : null;
}

function OBSIDIAN_getSelectedLayers() {
    var comp = OBSIDIAN_getActiveComp();
    if (!comp || !comp.selectedLayers || comp.selectedLayers.length === 0) {
        return [];
    }
    return comp.selectedLayers;
}

function OBSIDIAN_cleanText(value) {
    return String(value === undefined || value === null ? "" : value)
        .replace(/[|\r\n]+/g, " ")
        .replace(/\s+/g, " ");
}

function OBSIDIAN_layerType(layer) {
    if (layer instanceof TextLayer) return "Text";
    if (layer instanceof ShapeLayer) return "Shape";
    if (layer instanceof AVLayer) {
        try {
            if (layer.source && layer.source instanceof CompItem) return "Precomp";
            if (layer.source && layer.source.mainSource && layer.source.mainSource instanceof SolidSource) return "Solid/Footage";
        } catch (ignored) {}
        return "AV";
    }
    return "Other";
}

function OBSIDIAN_escapeCaptionField(value) {
    return escape(String(value === undefined || value === null ? "" : value));
}

/* Read-only media handoff: only one selected, local footage layer is accepted. */
function OBSIDIAN_inspectCaptionSource() {
    var comp = OBSIDIAN_getActiveComp();
    if (!comp) return "REJECTED|Open a composition and select one footage layer first.";
    var layers = OBSIDIAN_getSelectedLayers();
    if (layers.length !== 1) return "REJECTED|Select exactly one footage layer to generate captions.";
    var layer = layers[0];
    if (!(layer instanceof AVLayer) || !layer.source || !(layer.source instanceof FootageItem)) {
        return "REJECTED|Caption transcription requires one selected footage layer with a local media file.";
    }
    var file = layer.source.file;
    if (!file || !file.fsName || !file.exists) {
        return "REJECTED|The selected footage is offline or does not expose a local media file.";
    }
    var inPoint = Number(layer.inPoint);
    var outPoint = Number(layer.outPoint);
    var startTime = Number(layer.startTime);
    var stretch = Number(layer.stretch);
    var frameRate = Number(comp.frameRate);
    if (layer.timeRemapEnabled || !isFinite(inPoint) || !isFinite(outPoint) || outPoint <= inPoint ||
        !isFinite(startTime) || !isFinite(stretch) || stretch <= 0 || !isFinite(frameRate) || frameRate <= 0) {
        return "REJECTED|Caption transcription needs a footage layer with forward time and a valid duration; time-remapped or reversed footage is unsupported.";
    }
    if (inPoint < -0.001 || outPoint > Number(comp.duration) + 0.001) {
        return "REJECTED|The selected footage timing falls outside the active composition.";
    }
    return "OK|CAPTION_SOURCE|" + OBSIDIAN_escapeCaptionField(file.fsName) + "|" +
        OBSIDIAN_escapeCaptionField(layer.name) + "|" + OBSIDIAN_escapeCaptionField(layer.id) + "|" +
        Number(layer.index) + "|" + inPoint + "|" + outPoint + "|" + startTime + "|" + stretch + "|" +
        frameRate + "|" + Number(comp.duration) + "|" + Number(comp.width) + "|" + Number(comp.height) + "|" +
        OBSIDIAN_escapeCaptionField(comp.name);
}

function OBSIDIAN_captionStyle(style, comp) {
    var normalized = String(style || "");
    if (normalized !== "clean" && normalized !== "bold" && normalized !== "yellow") return null;
    var fill = normalized === "yellow" ? [1, 0.86, 0.08] : [1, 1, 1];
    return {
        name: normalized,
        font: normalized === "bold" ? "Arial-BoldMT" : "ArialMT",
        fontSize: Math.max(24, Math.min(100, Math.round(Number(comp.height) * (normalized === "bold" ? 0.052 : 0.046)))),
        fillColor: fill,
        strokeColor: [0, 0, 0],
        strokeWidth: Math.max(2, Math.round(Number(comp.height) * 0.003)),
        x: Number(comp.width) / 2,
        y: Number(comp.height) * 0.86
    };
}

function OBSIDIAN_applyCaptionStyle(layer, caption, style, comp) {
    var textProperties = layer.property("ADBE Text Properties");
    var textProperty = textProperties ? textProperties.property("ADBE Text Document") : null;
    var transform = layer.property("ADBE Transform Group");
    var position = transform ? transform.property("ADBE Position") : null;
    if (!textProperty || !position || typeof textProperty.setValue !== "function" || typeof position.setValue !== "function") {
        throw new Error("Text layer styling properties were unavailable.");
    }
    var styleValues = OBSIDIAN_captionStyle(style, comp);
    if (!styleValues) throw new Error("Unsupported caption style.");
    var document = textProperty.value;
    document.text = caption.text;
    document.font = styleValues.font;
    document.fontSize = styleValues.fontSize;
    document.applyFill = true;
    document.fillColor = styleValues.fillColor;
    document.applyStroke = true;
    document.strokeColor = styleValues.strokeColor;
    document.strokeWidth = styleValues.strokeWidth;
    document.strokeOverFill = true;
    document.justification = ParagraphJustification.CENTER_JUSTIFY;
    textProperty.setValue(document);
    position.setValue([styleValues.x, styleValues.y]);
    return { textProperty: textProperty, position: position, style: styleValues };
}

function OBSIDIAN_restoreCreatedCaptionLayers(layers) {
    var restored = 0;
    for (var i = layers.length - 1; i >= 0; i--) {
        try {
            layers[i].remove();
            restored++;
        } catch (ignored) {}
    }
    return restored;
}

function OBSIDIAN_createCaptionLayers(payload) {
    if (!payload || typeof payload !== "object" || Object.prototype.toString.call(payload) === "[object Array]") {
        return "REJECTED|Caption data must be received as a structured object.";
    }
    if (!payload.source || typeof payload.source !== "object" || Object.prototype.toString.call(payload.source) === "[object Array]" || !payload.source.path ||
        !/^(clean|bold|yellow)$/.test(String(payload.style || "")) ||
        !payload.segments || Object.prototype.toString.call(payload.segments) !== "[object Array]" ||
        payload.segments.length < 1 || payload.segments.length > 400) {
        return "REJECTED|Caption data must contain a supported style, one source, and 1 to 400 timed captions.";
    }

    var comp = OBSIDIAN_getActiveComp();
    var layers = OBSIDIAN_getSelectedLayers();
    if (!comp || layers.length !== 1) return "REJECTED|Select the original footage layer in its active composition before creating captions.";
    var sourceLayer = layers[0];
    if (!(sourceLayer instanceof AVLayer) || !sourceLayer.source || !(sourceLayer.source instanceof FootageItem) ||
        !sourceLayer.source.file || !sourceLayer.source.file.fsName) {
        return "REJECTED|The selected layer is no longer the caption source footage.";
    }
    var sourcePath = String(sourceLayer.source.file.fsName);
    var sourceId = sourceLayer.id === undefined || sourceLayer.id === null ? "" : String(sourceLayer.id);
    var expectedId = payload.source.layerId === undefined || payload.source.layerId === null ? "" : String(payload.source.layerId);
    if (sourcePath !== String(payload.source.path) ||
        (expectedId && sourceId && expectedId !== sourceId) ||
        Number(sourceLayer.index) !== Number(payload.source.layerIndex) ||
        String(sourceLayer.name) !== String(payload.source.layerName)) {
        return "REJECTED|The selected footage changed after transcription. Select the original layer and generate captions again.";
    }
    if (sourceLayer.timeRemapEnabled || Number(sourceLayer.stretch) <= 0 ||
        Math.abs(Number(sourceLayer.startTime) - Number(payload.source.startTime)) > 0.001 ||
        Math.abs(Number(sourceLayer.inPoint) - Number(payload.source.inPoint)) > 0.001 ||
        Math.abs(Number(sourceLayer.outPoint) - Number(payload.source.outPoint)) > 0.001) {
        return "REJECTED|The source layer timing changed after transcription. Generate captions again for the current timing.";
    }

    var expectedComp = payload.source.compName;
    if (String(comp.name) !== String(expectedComp) ||
        Math.abs(Number(comp.frameRate) - Number(payload.source.frameRate)) > 0.001 ||
        Math.abs(Number(comp.width) - Number(payload.source.compWidth)) > 0.01 ||
        Math.abs(Number(comp.height) - Number(payload.source.compHeight)) > 0.01) {
        return "REJECTED|The active composition changed after transcription.";
    }

    var styleValues = OBSIDIAN_captionStyle(payload.style, comp);
    if (!styleValues || !comp.layers || typeof comp.layers.addText !== "function") {
        return "REJECTED|After Effects text-layer creation is unavailable.";
    }

    var prepared = [];
    var previousEnd = Number(sourceLayer.inPoint);
    for (var i = 0; i < payload.segments.length; i++) {
        var segment = payload.segments[i];
        if (!segment || typeof segment.text !== "string") return "REJECTED|Caption " + (i + 1) + " has invalid text.";
        var text = segment.text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
        var start = Number(segment.start);
        var end = Number(segment.end);
        if (!text || text.length > 140 || !isFinite(start) || !isFinite(end) || start < Number(sourceLayer.inPoint) - 0.001 ||
            end <= start || end > Number(sourceLayer.outPoint) + 0.001 || start < previousEnd - 0.001 ||
            end > Number(comp.duration) + 0.001) {
            return "REJECTED|Caption " + (i + 1) + " has invalid or overlapping timing for the selected footage.";
        }
        prepared.push({ text: text, start: start, end: end });
        previousEnd = end;
    }

    var created = [];
    var createdProperties = [];
    var editError = null;
    app.beginUndoGroup("OBSIDIAN - Create Captions");
    try {
        for (var j = 0; j < prepared.length; j++) {
            var caption = prepared[j];
            var textLayer = comp.layers.addText(caption.text);
            if (!textLayer) throw new Error("After Effects did not create caption layer " + (j + 1) + ".");
            created.push(textLayer);
            textLayer.name = "OBSIDIAN Caption " + (j + 1);
            var props = OBSIDIAN_applyCaptionStyle(textLayer, caption, payload.style, comp);
            textLayer.inPoint = caption.start;
            textLayer.outPoint = caption.end;
            textLayer.enabled = true;
            textLayer.shy = false;
            textLayer.locked = false;
            createdProperties.push(props);
        }

        for (var verifyIndex = 0; verifyIndex < prepared.length; verifyIndex++) {
            var checkLayer = created[verifyIndex];
            var check = prepared[verifyIndex];
            var checkProps = createdProperties[verifyIndex];
            var textValue = checkProps.textProperty.value;
            var positionValue = checkProps.position.value;
            if (!textValue || textValue.text !== check.text ||
                Math.abs(Number(checkLayer.inPoint) - check.start) > 0.001 ||
                Math.abs(Number(checkLayer.outPoint) - check.end) > 0.001 ||
                !positionValue || Math.abs(Number(positionValue[0]) - checkProps.style.x) > 0.01 ||
                Math.abs(Number(positionValue[1]) - checkProps.style.y) > 0.01 ||
                Math.abs(Number(textValue.fontSize) - checkProps.style.fontSize) > 0.01) {
                throw new Error("Caption " + (verifyIndex + 1) + " did not match the requested text, timing, or style on read-back.");
            }
        }
    } catch (error) {
        editError = error;
    }

    if (editError) {
        var removed = OBSIDIAN_restoreCreatedCaptionLayers(created);
        app.endUndoGroup();
        if (removed === created.length) {
            return "ERROR|Caption creation failed and " + removed + " generated caption layer(s) were removed. " + editError.toString();
        }
        return "ERROR|Caption creation failed; only " + removed + " of " + created.length + " generated layer(s) could be removed. Use After Effects Undo and inspect the active composition. " + editError.toString();
    }

    app.endUndoGroup();
    return "OK|Verified " + created.length + " timed caption layer(s) using the " + payload.style + " style.";
}

function OBSIDIAN_getOpacity(layer) {
    try {
        var prop = layer.property("ADBE Transform Group").property("ADBE Opacity");
        return prop ? Math.round(Number(prop.value) * 100) / 100 : null;
    } catch (ignored) {
        return null;
    }
}

/* Never overwrite opacity keyframes or expressions (including loop expressions). */
function OBSIDIAN_opacityEditBlockReason(layers) {
    for (var i = 0; i < layers.length; i++) {
        var transform = layers[i].property("ADBE Transform Group");
        var opacity = transform ? transform.property("ADBE Opacity") : null;
        if (opacity && (Number(opacity.numKeys) > 0 || opacity.expressionEnabled)) {
            return "REJECTED|Opacity edit cancelled: existing opacity animation or expression on '" +
                OBSIDIAN_cleanText(layers[i].name) + "' was preserved.";
        }
    }
    return "";
}

function OBSIDIAN_getEffectNames(layer) {
    var names = [];
    try {
        var effects = layer.property("ADBE Effect Parade");
        if (!effects) return names;
        for (var i = 1; i <= effects.numProperties; i++) {
            var effect = effects.property(i);
            names.push(OBSIDIAN_cleanText(effect.name || effect.matchName));
        }
    } catch (ignored) {
        names.push("[effects unavailable]");
    }
    return names;
}

function OBSIDIAN_inspectProject() {
    if (!app.project) return "REJECTED|No After Effects project is open.";
    var comp = OBSIDIAN_getActiveComp();
    if (!comp) return "REJECTED|No active composition. Open or select a composition, then inspect again.";

    var selected = OBSIDIAN_getSelectedLayers();
    var lines = [
        "OK|PROJECT INSPECTION",
        "Project: " + OBSIDIAN_cleanText(app.project.file ? app.project.file.fsName : "Unsaved project"),
        "Composition: " + OBSIDIAN_cleanText(comp.name),
        "Resolution: " + comp.width + " x " + comp.height,
        "Frame rate: " + comp.frameRate + " fps",
        "Duration: " + Math.round(comp.duration * 1000) / 1000 + " s",
        "Current time: " + Math.round(comp.time * 1000) / 1000 + " s",
        "Layers: " + comp.numLayers,
        "Selected layers: " + selected.length
    ];

    if (selected.length) {
        lines.push("SELECTED LAYERS");
        for (var i = 0; i < selected.length; i++) {
            var layer = selected[i];
            lines.push(
                "#" + layer.index + " " + OBSIDIAN_cleanText(layer.name) +
                " | Type: " + OBSIDIAN_layerType(layer) +
                " | Enabled: " + (layer.enabled ? "yes" : "no") +
                " | 3D: " + (layer.threeDLayer ? "yes" : "no") +
                " | Opacity: " + OBSIDIAN_getOpacity(layer) + "%" +
                " | Effects: " + (OBSIDIAN_getEffectNames(layer).join(", ") || "none")
            );
        }
    } else {
        lines.push("No layers are selected. Select one or more layers for detailed layer inspection.");
    }

    return lines.join("\n");
}

function OBSIDIAN_inspectSelection() {
    var layers = OBSIDIAN_getSelectedLayers();
    if (!layers.length) return "REJECTED|Open a composition and select at least one layer.";
    var lines = ["OK|SELECTION INSPECTION", "Selected layers: " + layers.length];

    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        var transform = layer.property("ADBE Transform Group");
        var position = null, scale = null, rotation = null;
        try { position = transform.property("ADBE Position").value; } catch (ignored1) {}
        try { scale = transform.property("ADBE Scale").value; } catch (ignored2) {}
        try { rotation = transform.property("ADBE Rotate Z") ? transform.property("ADBE Rotate Z").value : transform.property("ADBE Rotation").value; } catch (ignored3) {}

        lines.push("#" + layer.index + " " + OBSIDIAN_cleanText(layer.name) + " [" + OBSIDIAN_layerType(layer) + "]");
        lines.push("  Enabled: " + (layer.enabled ? "yes" : "no") + "; Shy: " + (layer.shy ? "yes" : "no") + "; Locked: " + (layer.locked ? "yes" : "no"));
        lines.push("  In/Out: " + Math.round(layer.inPoint * 1000) / 1000 + "s / " + Math.round(layer.outPoint * 1000) / 1000 + "s");
        lines.push("  Opacity: " + OBSIDIAN_getOpacity(layer) + "%");
        if (position !== null) lines.push("  Position: [" + position.join(", ") + "]");
        if (scale !== null) lines.push("  Scale: [" + scale.join(", ") + "]");
        if (rotation !== null) lines.push("  Rotation: " + rotation + " degrees");
        lines.push("  Effects (" + OBSIDIAN_getEffectNames(layer).length + "): " + (OBSIDIAN_getEffectNames(layer).join(", ") || "none"));
        if (layer instanceof TextLayer) {
            try {
                var textProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
                var doc = textProp.value;
                lines.push("  Text: " + OBSIDIAN_cleanText(doc.text));
                lines.push("  Font: " + OBSIDIAN_cleanText(doc.font) + "; Size: " + doc.fontSize);
            } catch (ignored4) {
                lines.push("  Text styling: unavailable");
            }
        }
    }
    return lines.join("\n");
}

function OBSIDIAN_applyGlowProfile(effect, profile) {
    // Keep cinematic bloom restrained; attention is intentionally broader/brighter.
    var threshold = profile === "cinematic" ? 76 : 52;
    var radius = profile === "cinematic" ? 24 : 78;
    var intensity = profile === "cinematic" ? 0.25 : 1.35;
    var thresholdProp = effect.property(2);
    var radiusProp = effect.property(3);
    var intensityProp = effect.property(4);
    if (!thresholdProp || !radiusProp || !intensityProp ||
        typeof thresholdProp.setValue !== "function" || typeof radiusProp.setValue !== "function" ||
        typeof intensityProp.setValue !== "function" || typeof thresholdProp.value !== "number" ||
        typeof radiusProp.value !== "number" || typeof intensityProp.value !== "number") {
        throw new Error("Glow parameter properties were unavailable; preset was not verified.");
    }
    thresholdProp.setValue(threshold);
    radiusProp.setValue(radius);
    intensityProp.setValue(intensity);
    if (Math.abs(Number(thresholdProp.value) - threshold) > 0.1 ||
        Math.abs(Number(radiusProp.value) - radius) > 0.1 ||
        Math.abs(Number(intensityProp.value) - intensity) > 0.01) {
        throw new Error("Glow preset read-back did not match the requested settings.");
    }
}

function OBSIDIAN_addGlow(profile) {
    var layers = OBSIDIAN_getSelectedLayers();
    if (!layers.length) return "REJECTED|Open a composition and select at least one layer.";
    profile = String(profile || "unspecified");
    if (profile !== "cinematic" && profile !== "attention" && profile !== "unspecified") {
        return "REJECTED|Unsupported Glow profile.";
    }

    var matchName = "ADBE Glo2";
    for (var i = 0; i < layers.length; i++) {
        if (layers[i].locked) return "REJECTED|Add Glow cancelled: unlock '" + OBSIDIAN_cleanText(layers[i].name) + "'.";
        var effects = layers[i].property("ADBE Effect Parade");
        if (!effects || typeof effects.canAddProperty !== "function" || !effects.canAddProperty(matchName)) {
            return "REJECTED|Glow is unavailable on a selected layer.";
        }
        if (OBSIDIAN_findEffect(layers[i], matchName)) {
            return "REJECTED|A selected layer already has Glow; existing effect settings were preserved.";
        }
    }

    var created = 0;
    var verified = 0;
    var configured = 0;
    var unsupportedLayout = false;
    var editError = null;
    app.beginUndoGroup("OBSIDIAN - Add Glow");
    try {
        for (var j = 0; j < layers.length; j++) {
            var parade = layers[j].property("ADBE Effect Parade");
            parade.addProperty(matchName);
            created++;
            var glow = OBSIDIAN_findEffect(layers[j], matchName);
            if (!glow) throw new Error("Glow was not available after adding the effect.");
            if (profile === "cinematic" || profile === "attention") {
                try {
                    OBSIDIAN_applyGlowProfile(glow, profile);
                    configured++;
                } catch (profileError) {
                    unsupportedLayout = true;
                    throw profileError;
                }
            }
        }
        for (var k = 0; k < layers.length; k++) {
            if (OBSIDIAN_findEffect(layers[k], matchName)) verified++;
        }
    } catch (error) {
        editError = error;
    }

    if (verified !== layers.length ||
        ((profile === "cinematic" || profile === "attention") && configured !== layers.length) || editError) {
        var removed = OBSIDIAN_removeAddedEffects(layers, matchName);
        app.endUndoGroup();
        if (removed === created) {
            if (unsupportedLayout) return "REJECTED|Glow preset parameters were unsupported; the temporary effects were removed.";
            return "ERROR|Add Glow could not be verified; newly added effects were removed." +
                (editError ? " " + editError.toString() : "");
        }
        return "ERROR|Add Glow failed; cleanup could not be verified. Use After Effects Undo and inspect the selected layers.";
    }

    app.endUndoGroup();
    if (profile === "unspecified") {
        return "OK|Verified Glow on " + verified + " selected layer(s); added " + created + " new effect(s).";
    }
    return "OK|Verified Glow on " + verified + " selected layer(s); added " + created + " new effect(s). Applied and verified " + profile + " preset on " + configured + " layer(s).";
}

function OBSIDIAN_removeGlow() {
    var layers = OBSIDIAN_getSelectedLayers();
    if (!layers.length) return "REJECTED|Open a composition and select at least one layer.";

    var removed = 0;
    var remaining = 0;
    app.beginUndoGroup("OBSIDIAN - Remove Glow");
    try {
        for (var i = 0; i < layers.length; i++) {
            // Removing an effect can invalidate indexed-property references in AE.
            // Reacquire the Effect Parade after each removal before inspecting it again.
            var effects = layers[i].property("ADBE Effect Parade");
            if (!effects) continue;
            var j = effects.numProperties;
            while (j >= 1) {
                effects = layers[i].property("ADBE Effect Parade");
                if (!effects || j > effects.numProperties) {
                    j = effects ? effects.numProperties : 0;
                    continue;
                }
                var effect = effects.property(j);
                if (effect && effect.matchName === "ADBE Glo2") {
                    effect.remove();
                    removed++;
                    effects = layers[i].property("ADBE Effect Parade");
                    j = effects ? effects.numProperties : 0;
                } else {
                    j--;
                }
            }
        }
        for (var k = 0; k < layers.length; k++) {
            var check = layers[k].property("ADBE Effect Parade");
            if (!check) continue;
            for (var m = 1; m <= check.numProperties; m++) {
                if (check.property(m).matchName === "ADBE Glo2") { remaining++; break; }
            }
        }
    } catch (error) {
        app.endUndoGroup();
        return "ERROR|Remove Glow failed: " + error.toString();
    }
    app.endUndoGroup();
    if (remaining) return "ERROR|Glow removal could not be verified on every selected layer.";
    return "OK|Verified Glow removed from selected layers. Removed " + removed + " effect instance(s).";
}

function OBSIDIAN_findEffect(layer, matchName) {
    var effects = layer.property("ADBE Effect Parade");
    if (!effects) return null;
    for (var i = 1; i <= effects.numProperties; i++) {
        var effect = effects.property(i);
        if (effect && effect.matchName === matchName) return effect;
    }
    return null;
}

function OBSIDIAN_removeAddedEffects(layers, matchName) {
    var removed = 0;
    for (var i = 0; i < layers.length; i++) {
        try {
            var effects = layers[i].property("ADBE Effect Parade");
            if (!effects) continue;
            for (var j = effects.numProperties; j >= 1; j--) {
                effects = layers[i].property("ADBE Effect Parade");
                if (!effects || j > effects.numProperties) continue;
                var effect = effects.property(j);
                if (effect && effect.matchName === matchName) {
                    effect.remove();
                    removed++;
                }
            }
        } catch (ignored) {}
    }
    return removed;
}

function OBSIDIAN_adjustBrightnessContrast(brightness, contrast) {
    var matchName = "ADBE Brightness & Contrast 2";
    var layers = OBSIDIAN_getSelectedLayers();
    if (!layers.length) return "REJECTED|Open a composition and select at least one layer.";
    brightness = Number(brightness);
    contrast = Number(contrast);
    if (!isFinite(brightness) || !isFinite(contrast) ||
        brightness < -25 || brightness > 25 || contrast < -25 || contrast > 25) {
        return "REJECTED|Brightness and Contrast must each be between -25 and 25.";
    }

    for (var i = 0; i < layers.length; i++) {
        if (layers[i].locked) return "REJECTED|Brightness and Contrast cancelled: unlock '" + OBSIDIAN_cleanText(layers[i].name) + "'.";
        var effects = layers[i].property("ADBE Effect Parade");
        if (!effects || typeof effects.canAddProperty !== "function" || !effects.canAddProperty(matchName)) {
            return "REJECTED|Brightness & Contrast is unavailable on a selected layer.";
        }
        if (OBSIDIAN_findEffect(layers[i], matchName)) {
            return "REJECTED|A selected layer already has Brightness & Contrast; existing effect settings were preserved.";
        }
    }

    var unsupportedLayout = false;
    var editError = null;
    var verified = 0;
    var created = 0;
    app.beginUndoGroup("OBSIDIAN - Brightness and Contrast");
    try {
        for (var j = 0; j < layers.length; j++) {
            var parade = layers[j].property("ADBE Effect Parade");
            parade.addProperty(matchName);
            created++;
            var effect = OBSIDIAN_findEffect(layers[j], matchName);
            var brightnessProperty = effect ? effect.property(1) : null;
            var contrastProperty = effect ? effect.property(2) : null;
            if (!brightnessProperty || !contrastProperty ||
                brightnessProperty.name !== "Brightness" || contrastProperty.name !== "Contrast" ||
                typeof brightnessProperty.setValue !== "function" || typeof contrastProperty.setValue !== "function" ||
                typeof brightnessProperty.value !== "number" || typeof contrastProperty.value !== "number") {
                unsupportedLayout = true;
                throw new Error("Brightness & Contrast parameters were unavailable in the expected order.");
            }
            brightnessProperty.setValue(brightness);
            contrastProperty.setValue(contrast);
            if (Math.abs(Number(brightnessProperty.value) - brightness) < 0.01 &&
                Math.abs(Number(contrastProperty.value) - contrast) < 0.01) verified++;
        }
    } catch (error) {
        editError = error;
    }

    if (verified !== layers.length || editError) {
        var removed = OBSIDIAN_removeAddedEffects(layers, matchName);
        app.endUndoGroup();
        if (removed === created) {
            if (unsupportedLayout) return "REJECTED|Brightness & Contrast parameters were unsupported; the temporary effects were removed.";
            return "ERROR|Brightness and Contrast could not be verified; newly added effects were removed. " + editError.toString();
        }
        return "ERROR|Brightness and Contrast failed; cleanup could not be verified. Use After Effects Undo and inspect the selected layers.";
    }

    app.endUndoGroup();
    return "OK|Verified Brightness " + brightness + " and Contrast " + contrast + " on " + verified + " selected layer(s).";
}

function OBSIDIAN_setOpacity(value) {
    var layers = OBSIDIAN_getSelectedLayers();
    if (!layers.length) return "REJECTED|Open a composition and select at least one layer.";

    value = Number(value);
    if (isNaN(value)) return "REJECTED|Opacity must be a number.";
    value = Math.max(0, Math.min(100, value));

    var blockReason = OBSIDIAN_opacityEditBlockReason(layers);
    if (blockReason) return blockReason;

    var changed = 0;
    var verified = 0;
    app.beginUndoGroup("OBSIDIAN - Set Opacity");
    try {
        for (var i = 0; i < layers.length; i++) {
            var transform = layers[i].property("ADBE Transform Group");
            var opacity = transform ? transform.property("ADBE Opacity") : null;
            if (opacity) {
                opacity.setValue(value);
                changed++;
            }
        }
        for (var j = 0; j < layers.length; j++) {
            var verifyTransform = layers[j].property("ADBE Transform Group");
            var verifyOpacity = verifyTransform ? verifyTransform.property("ADBE Opacity") : null;
            if (verifyOpacity && Math.abs(Number(verifyOpacity.value) - value) < 0.01) verified++;
        }
    } catch (error) {
        app.endUndoGroup();
        return "ERROR|Set Opacity failed: " + error.toString();
    }
    app.endUndoGroup();

    if (changed === 0 || verified !== changed) {
        return "ERROR|Opacity verification failed. Changed " + changed + " layer(s); verified " + verified + ".";
    }
    return "OK|Verified opacity at " + value + "% on " + verified + " selected layer(s).";
}

function OBSIDIAN_reduceOpacity() {
    var layers = OBSIDIAN_getSelectedLayers();
    if (!layers.length) return "REJECTED|Open a composition and select at least one layer.";
    var blockReason = OBSIDIAN_opacityEditBlockReason(layers);
    if (blockReason) return blockReason;
    var changed = 0;
    var verified = 0;
    var expectedValues = [];
    app.beginUndoGroup("OBSIDIAN - Reduce Opacity");
    try {
        for (var i = 0; i < layers.length; i++) {
            var opacity = layers[i].property("ADBE Transform Group").property("ADBE Opacity");
            if (opacity) {
                var target = Math.max(0, Number(opacity.value) - 20);
                opacity.setValue(target);
                expectedValues[i] = target;
                changed++;
            }
        }
        for (var j = 0; j < layers.length; j++) {
            var check = layers[j].property("ADBE Transform Group").property("ADBE Opacity");
            if (check && expectedValues[j] !== undefined && Math.abs(Number(check.value) - expectedValues[j]) < 0.01) verified++;
        }
    } catch (error) {
        app.endUndoGroup();
        return "ERROR|Reduce Opacity failed: " + error.toString();
    }
    app.endUndoGroup();
    if (changed === 0 || verified !== changed) return "ERROR|Opacity reduction could not be verified.";
    return "OK|Verified opacity reduction on " + verified + " selected layer(s).";
}

function OBSIDIAN_getScaleProperty(layer) {
    var transform = layer ? layer.property("ADBE Transform Group") : null;
    return transform ? transform.property("ADBE Scale") : null;
}

function OBSIDIAN_scaleSnapshot(property) {
    var snapshot = { dimensions: "unavailable", propertyValueType: "unknown", values: null };
    if (!property) return snapshot;
    try {
        var typeValue = property.propertyValueType;
        if (typeValue !== undefined) {
            snapshot.propertyValueType = String(typeValue);
            if (typeof PropertyValueType !== "undefined") {
                if (typeValue === PropertyValueType.TwoD) snapshot.propertyValueType = "TwoD";
                else if (typeValue === PropertyValueType.ThreeD) snapshot.propertyValueType = "ThreeD";
            }
        }
    } catch (ignored) {}
    try {
        var current = property.value;
        if (current && typeof current.length === "number") {
            snapshot.dimensions = current.length;
            snapshot.values = [];
            for (var i = 0; i < current.length; i++) snapshot.values.push(current[i]);
        }
    } catch (ignored2) {}
    return snapshot;
}

function OBSIDIAN_scaleVectorIsSupported(snapshot, layer) {
    if (!snapshot || !snapshot.values) return false;
    var is3DLayer = Boolean(layer && layer.threeDLayer);
    if (is3DLayer) {
        return snapshot.dimensions === 3 && snapshot.propertyValueType === "ThreeD";
    }
    // AE retains a 3D Scale vector when a layer is converted back to 2D. Its Z
    // component is hidden and ignored, so use the layer switch for active axes
    // while retaining the full vector for safe writes and verification.
    if (snapshot.propertyValueType === "ThreeD") return snapshot.dimensions === 2 || snapshot.dimensions === 3;
    return snapshot.dimensions === 2 && snapshot.propertyValueType === "TwoD";
}

function OBSIDIAN_scaleActiveDimensions(snapshot, layer) {
    return OBSIDIAN_scaleVectorIsSupported(snapshot, layer) ? (layer && layer.threeDLayer ? 3 : 2) : 0;
}

function OBSIDIAN_scaleSnapshotText(snapshot, layer) {
    var valueText = snapshot.values === null ? "unavailable" : "[" + snapshot.values.join(", ") + "]";
    return valueText + " (dimensions=" + snapshot.dimensions + ", propertyValueType=" + snapshot.propertyValueType +
        ", layer3D=" + Boolean(layer && layer.threeDLayer) + ")";
}

function OBSIDIAN_scaleSnapshotMatches(snapshot, expected, layer, expectedType) {
    if (!OBSIDIAN_scaleVectorIsSupported(snapshot, layer) || snapshot.propertyValueType !== expectedType) return false;
    var current = snapshot ? snapshot.values : null;
    if (!current || current.length !== expected.length) return false;
    for (var i = 0; i < expected.length; i++) {
        if (!isFinite(Number(current[i])) || Math.abs(Number(current[i]) - expected[i]) > 0.01) return false;
    }
    return true;
}

function OBSIDIAN_prepareScaleTargets(layers, factor, absoluteValue) {
    var prepared = [];
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (layer.locked) {
            return "REJECTED|Scale change cancelled: unlock '" + OBSIDIAN_cleanText(layer.name) + "'.";
        }
        var scale = OBSIDIAN_getScaleProperty(layer);
        var originalSnapshot = OBSIDIAN_scaleSnapshot(scale);
        if (!scale || typeof scale.setValue !== "function" || !OBSIDIAN_scaleVectorIsSupported(originalSnapshot, layer)) {
            return "REJECTED|Scale change cancelled: unsupported Scale type or dimensions on '" +
                OBSIDIAN_cleanText(layer.name) + "'. Found " + OBSIDIAN_scaleSnapshotText(originalSnapshot, layer) +
                "; expected a numeric 2D/3D Scale vector matching the layer's 3D state.";
        }
        if (Number(scale.numKeys) > 0 || scale.expressionEnabled) {
            return "REJECTED|Scale change cancelled: existing scale keyframes or expression on '" +
                OBSIDIAN_cleanText(layer.name) + "' were preserved.";
        }

        var original = [];
        var target = [];
        var activeDimensions = OBSIDIAN_scaleActiveDimensions(originalSnapshot, layer);
        for (var j = 0; j < originalSnapshot.values.length; j++) {
            var component = Number(originalSnapshot.values[j]);
            var nextComponent = j >= activeDimensions
                ? component
                : (factor === null ? absoluteValue : component * factor);
            if (!isFinite(component) || !isFinite(nextComponent) || Math.abs(nextComponent) > 1000) {
                return "REJECTED|Scale change cancelled: the resulting Scale value is outside the supported range.";
            }
            original.push(component);
            target.push(nextComponent);
        }
        prepared.push({
            layer: layer,
            original: original,
            target: target,
            propertyValueType: originalSnapshot.propertyValueType,
            dimensions: originalSnapshot.dimensions,
            activeDimensions: activeDimensions,
            is3DLayer: Boolean(layer.threeDLayer)
        });
    }
    return prepared;
}

function OBSIDIAN_applyScaleTargets(prepared, undoLabel, successMessage) {
    app.beginUndoGroup(undoLabel);
    try {
        for (var k = 0; k < prepared.length; k++) {
            var writeProperty = OBSIDIAN_getScaleProperty(prepared[k].layer);
            var writeSnapshot = OBSIDIAN_scaleSnapshot(writeProperty);
            if (!writeProperty || typeof writeProperty.setValue !== "function" ||
                !OBSIDIAN_scaleVectorIsSupported(writeSnapshot, prepared[k].layer) ||
                writeSnapshot.propertyValueType !== prepared[k].propertyValueType ||
                writeSnapshot.dimensions !== prepared[k].dimensions ||
                Boolean(prepared[k].layer.threeDLayer) !== prepared[k].is3DLayer) {
                throw new Error("Scale property type or dimensions changed before it could be written. Found " +
                    OBSIDIAN_scaleSnapshotText(writeSnapshot, prepared[k].layer) + ".");
            }
            writeProperty.setValue(prepared[k].target);
            prepared[k].immediate = OBSIDIAN_scaleSnapshot(writeProperty);
        }

        var verified = 0;
        var mismatchDetails = [];
        for (var n = 0; n < prepared.length; n++) {
            var freshProperty = OBSIDIAN_getScaleProperty(prepared[n].layer);
            var freshSnapshot = OBSIDIAN_scaleSnapshot(freshProperty);
            if (OBSIDIAN_scaleSnapshotMatches(
                freshSnapshot,
                prepared[n].target,
                prepared[n].layer,
                prepared[n].propertyValueType
            )) {
                verified++;
            } else {
                mismatchDetails.push(
                    "'" + OBSIDIAN_cleanText(prepared[n].layer.name) + "': requested [" + prepared[n].target.join(", ") +
                    "] (dimensions=" + prepared[n].dimensions + ", propertyValueType=" + prepared[n].propertyValueType +
                    ", layer3D=" + Boolean(prepared[n].layer.threeDLayer) + "); immediate " +
                    OBSIDIAN_scaleSnapshotText(prepared[n].immediate, prepared[n].layer) +
                    "; fresh " + OBSIDIAN_scaleSnapshotText(freshSnapshot, prepared[n].layer)
                );
            }
        }
        if (verified !== prepared.length) {
            throw new Error("Scale read-back did not match the requested values in After Effects " +
                OBSIDIAN_cleanText(app.version || "unknown version") + ". Diagnostics: " + mismatchDetails.join(" | "));
        }
    } catch (error) {
        var restored = 0;
        var restoreDetails = [];
        for (var r = 0; r < prepared.length; r++) {
            try {
                var restoreProperty = OBSIDIAN_getScaleProperty(prepared[r].layer);
                if (!restoreProperty || typeof restoreProperty.setValue !== "function") {
                    restoreDetails.push("'" + OBSIDIAN_cleanText(prepared[r].layer.name) + "': restore setter unavailable");
                    continue;
                }
                restoreProperty.setValue(prepared[r].original);
                var restoredSnapshot = OBSIDIAN_scaleSnapshot(OBSIDIAN_getScaleProperty(prepared[r].layer));
                var didRestore = OBSIDIAN_scaleSnapshotMatches(
                    restoredSnapshot,
                    prepared[r].original,
                    prepared[r].layer,
                    prepared[r].propertyValueType
                );
                if (didRestore) restored++;
                restoreDetails.push(
                    "'" + OBSIDIAN_cleanText(prepared[r].layer.name) + "': original [" +
                    prepared[r].original.join(", ") + "]; after restoration " +
                    OBSIDIAN_scaleSnapshotText(restoredSnapshot, prepared[r].layer)
                );
            } catch (restoreError) {
                restoreDetails.push("'" + OBSIDIAN_cleanText(prepared[r].layer.name) + "': restore error " + restoreError.toString());
            }
        }
        app.endUndoGroup();
        if (restored === prepared.length) {
            return "ERROR|Scale change failed and original Scale values were restored and verified. " +
                error.toString() + " Restoration diagnostics: " + restoreDetails.join(" | ");
        }
        return "ERROR|Scale change failed; restoration could not be verified for every layer. Use After Effects Undo and inspect the selected layers. " +
            error.toString() + " Restoration diagnostics: " + restoreDetails.join(" | ");
    }
    app.endUndoGroup();
    return "OK|" + successMessage;
}

function OBSIDIAN_scaleSelected(signedPercent) {
    var layers = OBSIDIAN_getSelectedLayers();
    if (!layers.length) return "REJECTED|Open a composition and select at least one layer.";

    signedPercent = Number(signedPercent);
    if (!isFinite(signedPercent) || signedPercent === 0 || signedPercent > 100 || signedPercent <= -100) {
        return "REJECTED|Scale change must be 1% to 100% up, or 1% to less than 100% down.";
    }

    var factor = 1 + signedPercent / 100;
    var prepared = OBSIDIAN_prepareScaleTargets(layers, factor, null);
    if (typeof prepared === "string") return prepared;
    return OBSIDIAN_applyScaleTargets(
        prepared,
        "OBSIDIAN - Scale Selected Layers",
        "Verified proportional scale change on " + prepared.length + " selected layer(s)."
    );
}

function OBSIDIAN_setScale(value) {
    var layers = OBSIDIAN_getSelectedLayers();
    if (!layers.length) return "REJECTED|Open a composition and select at least one layer.";
    value = Number(value);
    if (!isFinite(value) || value < 0 || value > 1000) {
        return "REJECTED|Scale target must be between 0% and 1000%.";
    }
    var prepared = OBSIDIAN_prepareScaleTargets(layers, null, value);
    if (typeof prepared === "string") return prepared;
    return OBSIDIAN_applyScaleTargets(
        prepared,
        "OBSIDIAN - Set Scale",
        "Verified absolute Scale " + value + "% on every active dimension of " + prepared.length + " selected layer(s)."
    );
}

function OBSIDIAN_keyframeMethodsAvailable(property) {
    return property && typeof property.setValueAtTime === "function" &&
        typeof property.nearestKeyIndex === "function" && typeof property.keyTime === "function" &&
        typeof property.keyValue === "function" && typeof property.removeKey === "function";
}

function OBSIDIAN_keyframeValueMatches(actual, expected) {
    if (expected && typeof expected !== "number" && typeof expected.length === "number") {
        if (!actual || typeof actual.length !== "number" || actual.length !== expected.length) return false;
        for (var i = 0; i < expected.length; i++) {
            if (!isFinite(Number(actual[i])) || Math.abs(Number(actual[i]) - Number(expected[i])) > 0.01) return false;
        }
        return true;
    }
    return isFinite(Number(actual)) && Math.abs(Number(actual) - Number(expected)) <= 0.01;
}

function OBSIDIAN_applyKeyframeTransition(prepared, label, successMessage) {
    var verified = 0;
    var editError = null;
    app.beginUndoGroup("OBSIDIAN - " + label);
    try {
        for (var i = 0; i < prepared.length; i++) {
            prepared[i].property.setValueAtTime(prepared[i].start, prepared[i].startValue);
            prepared[i].property.setValueAtTime(prepared[i].end, prepared[i].endValue);
        }
        for (var j = 0; j < prepared.length; j++) {
            var item = prepared[j];
            var first = item.property.nearestKeyIndex(item.start);
            var last = item.property.nearestKeyIndex(item.end);
            if (Number(item.property.numKeys) === 2 &&
                Math.abs(Number(item.property.keyTime(first)) - item.start) < 0.001 &&
                Math.abs(Number(item.property.keyTime(last)) - item.end) < 0.001 &&
                OBSIDIAN_keyframeValueMatches(item.property.keyValue(first), item.startValue) &&
                OBSIDIAN_keyframeValueMatches(item.property.keyValue(last), item.endValue)) verified++;
        }
    } catch (error) {
        editError = error;
    }

    if (verified !== prepared.length || editError) {
        var restored = 0;
        for (var r = 0; r < prepared.length; r++) {
            try {
                var property = prepared[r].property;
                var keyCount = Number(property.numKeys);
                if (!isFinite(keyCount) || keyCount < 0 || keyCount > 2) continue;
                for (var keyIndex = keyCount; keyIndex >= 1; keyIndex--) property.removeKey(keyIndex);
                if (Number(property.numKeys) === 0) restored++;
            } catch (removeError) {}
        }
        app.endUndoGroup();
        if (restored === prepared.length) {
            return "ERROR|" + label + " failed and generated keyframes were removed." +
                (editError ? " " + editError.toString() : " Read-back did not match.");
        }
        return "ERROR|" + label + " failed; generated keyframes could not be fully removed. Use After Effects Undo and inspect the selected layers.";
    }

    app.endUndoGroup();
    return "OK|" + successMessage;
}

function OBSIDIAN_prepareFade(layers, direction) {
    var isFadeIn = direction === "in";
    var prepared = [];
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (layer.locked) return "REJECTED|Fade " + direction + " cancelled: unlock '" + OBSIDIAN_cleanText(layer.name) + "'.";
        var group = layer.property("ADBE Transform Group");
        var opacity = group ? group.property("ADBE Opacity") : null;
        if (!OBSIDIAN_keyframeMethodsAvailable(opacity)) {
            return "REJECTED|Opacity keyframes unavailable.";
        }
        if (Number(opacity.numKeys) > 0 || opacity.expressionEnabled) {
            return "REJECTED|Fade " + direction + " cancelled: existing opacity animation or expression was preserved.";
        }
        var inPoint = Number(layer.inPoint);
        var outPoint = Number(layer.outPoint);
        var start = isFadeIn ? inPoint : Math.max(inPoint, outPoint - 0.5);
        var end = isFadeIn ? Math.min(inPoint + 0.5, outPoint) : outPoint;
        var target = Number(opacity.value);
        if (!isFinite(inPoint) || !isFinite(outPoint) || !isFinite(start) || !isFinite(end) ||
            end - start < 0.05 || !isFinite(target) || target < 0 || target > 100) {
            return "REJECTED|Selected layer is too short or has an unsupported opacity value for fade " + direction + ".";
        }
        prepared.push({
            property: opacity,
            start: start,
            end: end,
            startValue: isFadeIn ? 0 : target,
            endValue: isFadeIn ? target : 0
        });
    }
    return prepared;
}

function OBSIDIAN_fade(direction) {
    var layers = OBSIDIAN_getSelectedLayers();
    if (!layers.length) return "REJECTED|Open a composition and select at least one layer.";
    var prepared = OBSIDIAN_prepareFade(layers, direction);
    if (typeof prepared === "string") return prepared;
    var label = direction === "in" ? "Fade-in" : "Fade-out";
    return OBSIDIAN_applyKeyframeTransition(
        prepared,
        label,
        "Verified fade-" + direction + " keyframes on " + layers.length + " selected layer(s)."
    );
}

function OBSIDIAN_fadeIn() {
    return OBSIDIAN_fade("in");
}

function OBSIDIAN_fadeOut() {
    return OBSIDIAN_fade("out");
}

function OBSIDIAN_prepareScaleIn(layers) {
    var prepared = [];
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (layer.locked) return "REJECTED|Scale-in cancelled: unlock '" + OBSIDIAN_cleanText(layer.name) + "'.";
        var transform = layer.property("ADBE Transform Group");
        var scale = transform ? transform.property("ADBE Scale") : null;
        var scaleSnapshot = OBSIDIAN_scaleSnapshot(scale);
        if (!OBSIDIAN_keyframeMethodsAvailable(scale) || !OBSIDIAN_scaleVectorIsSupported(scaleSnapshot, layer)) {
            return "REJECTED|Scale-in requires a numeric Scale vector whose dimensions and property type match the layer's 2D/3D state.";
        }
        if (Number(scale.numKeys) > 0 || scale.expressionEnabled) {
            return "REJECTED|Scale-in cancelled: existing Scale keyframes or expression was preserved.";
        }
        var start = Number(layer.inPoint);
        var end = Math.min(start + 0.5, Number(layer.outPoint));
        if (!isFinite(start) || !isFinite(end) || end - start < 0.05) {
            return "REJECTED|Selected layer is too short for a scale-in.";
        }
        var startScale = [];
        var endScale = [];
        var activeDimensions = OBSIDIAN_scaleActiveDimensions(scaleSnapshot, layer);
        for (var j = 0; j < scaleSnapshot.values.length; j++) {
            var component = Number(scaleSnapshot.values[j]);
            if (!isFinite(component) || Math.abs(component) > 1000) {
                return "REJECTED|Scale-in cancelled: a selected Scale value is outside the supported range.";
            }
            endScale.push(component);
            startScale.push(j >= activeDimensions ? component : component * 0.95);
        }
        prepared.push({ property: scale, start: start, end: end, startValue: startScale, endValue: endScale });
    }
    return prepared;
}

function OBSIDIAN_scaleIn() {
    var layers = OBSIDIAN_getSelectedLayers();
    if (!layers.length) return "REJECTED|Open a composition and select at least one layer.";
    var prepared = OBSIDIAN_prepareScaleIn(layers);
    if (typeof prepared === "string") return prepared;
    return OBSIDIAN_applyKeyframeTransition(
        prepared,
        "Scale In",
        "Verified 0.5-second scale-in keyframes on " + layers.length + " selected layer(s)."
    );
}

function OBSIDIAN_applyRecipe(recipeId) {
    var layers = OBSIDIAN_getSelectedLayers();
    if (!layers.length) return "REJECTED|Open a composition and select at least one layer.";
    if (String(recipeId || "") === "cinematic_glow") return OBSIDIAN_addGlow("cinematic");
    if (String(recipeId || "") === "dark_dramatic") return OBSIDIAN_adjustBrightnessContrast(-12, 14);
    if (String(recipeId || "") === "high_contrast") return OBSIDIAN_adjustBrightnessContrast(0, 20);
    if (String(recipeId || "") !== "gentle_entrance") return "REJECTED|Unsupported creative recipe.";
    var fade = OBSIDIAN_prepareFade(layers, "in");
    if (typeof fade === "string") return fade;
    var scale = OBSIDIAN_prepareScaleIn(layers);
    if (typeof scale === "string") return scale;
    var prepared = fade.concat(scale);
    return OBSIDIAN_applyKeyframeTransition(
        prepared,
        "Gentle Entrance",
        "Applied Gentle Entrance: verified fade-in and scale-in keyframes on " + layers.length + " selected layer(s)."
    );
}

function OBSIDIAN_slideUp() {
    var layers = OBSIDIAN_getSelectedLayers();
    if (!layers.length) return "REJECTED|Open a composition and select at least one layer.";
    var prepared = [];
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (layer.locked) return "REJECTED|Slide-up cancelled: unlock '" + OBSIDIAN_cleanText(layer.name) + "'.";
        var transform = layer.property("ADBE Transform Group");
        var position = transform ? transform.property("ADBE Position") : null;
        if (!OBSIDIAN_keyframeMethodsAvailable(position) || !position.value ||
            position.dimensionsSeparated || (position.value.length !== 2 && position.value.length !== 3)) {
            return "REJECTED|A unified 2D or 3D Position property is required for slide-up.";
        }
        if (Number(position.numKeys) > 0 || position.expressionEnabled) {
            return "REJECTED|Slide-up cancelled: existing Position keyframes or expression was preserved.";
        }
        var start = Number(layer.inPoint);
        var end = Math.min(start + 0.5, Number(layer.outPoint));
        if (!isFinite(start) || !isFinite(end) || end - start < 0.05) {
            return "REJECTED|Selected layer is too short for a slide-up.";
        }
        var startPosition = [];
        var endPosition = [];
        for (var j = 0; j < position.value.length; j++) {
            var component = Number(position.value[j]);
            if (!isFinite(component) || Math.abs(component) > 1000000) {
                return "REJECTED|Slide-up cancelled: a selected Position value is outside the supported range.";
            }
            endPosition.push(component);
            startPosition.push(component + (j === 1 ? 40 : 0));
        }
        prepared.push({ property: position, start: start, end: end, startValue: startPosition, endValue: endPosition });
    }
    return OBSIDIAN_applyKeyframeTransition(
        prepared,
        "Slide Up",
        "Verified 40-pixel slide-up keyframes on " + prepared.length + " selected layer(s)."
    );
}

function OBSIDIAN_crossfade() {
    var layers = OBSIDIAN_getSelectedLayers();
    if (layers.length !== 2) return "REJECTED|Crossfade requires exactly two selected overlapping layers.";
    if (Math.abs(Number(layers[0].inPoint) - Number(layers[1].inPoint)) < 0.001) {
        return "REJECTED|Crossfade could not identify an outgoing layer; the selected layers start together.";
    }
    var outgoing = Number(layers[0].inPoint) < Number(layers[1].inPoint) ? layers[0] : layers[1];
    var incoming = outgoing === layers[0] ? layers[1] : layers[0];
    var start = Math.max(Number(outgoing.inPoint), Number(incoming.inPoint));
    var end = Math.min(Number(outgoing.outPoint), Number(incoming.outPoint));
    if (!isFinite(start) || !isFinite(end) || end - start < 0.05) {
        return "REJECTED|The selected layers need at least 0.05 seconds of overlap for a crossfade.";
    }
    var prepared = [];
    var transitionLayers = [outgoing, incoming];
    for (var i = 0; i < transitionLayers.length; i++) {
        var layer = transitionLayers[i];
        if (layer.locked) return "REJECTED|Crossfade cancelled: unlock '" + OBSIDIAN_cleanText(layer.name) + "'.";
        var transform = layer.property("ADBE Transform Group");
        var opacity = transform ? transform.property("ADBE Opacity") : null;
        if (!OBSIDIAN_keyframeMethodsAvailable(opacity)) return "REJECTED|Opacity keyframes unavailable.";
        if (Number(opacity.numKeys) > 0 || opacity.expressionEnabled) {
            return "REJECTED|Crossfade cancelled: existing opacity keyframes or expression was preserved.";
        }
        var baseOpacity = Number(opacity.value);
        if (!isFinite(baseOpacity) || baseOpacity < 0 || baseOpacity > 100) {
            return "REJECTED|Crossfade cancelled: a selected opacity value is outside 0% to 100%.";
        }
        prepared.push({
            property: opacity,
            start: start,
            end: end,
            startValue: i === 0 ? baseOpacity : 0,
            endValue: i === 0 ? 0 : baseOpacity
        });
    }
    return OBSIDIAN_applyKeyframeTransition(
        prepared,
        "Crossfade",
        "Verified crossfade across " + prepared.length + " selected overlapping layers."
    );
}

/**
 * Execute only typed actions produced by the frontend planner.
 * Never parse free-form natural language inside ExtendScript.
 */
function OBSIDIAN_executePlan(action, value, profile, secondaryValue) {
    action = String(action || "");

    if (action === "inspect_project") return OBSIDIAN_inspectProject();
    if (action === "inspect_selection") return OBSIDIAN_inspectSelection();
    if (action === "inspect_caption_source") return OBSIDIAN_inspectCaptionSource();
    if (action === "create_captions") return OBSIDIAN_createCaptionLayers(value);

    if (action === "set_opacity") {
        if (value === null || value === undefined || value === "") {
            return "REJECTED|Opacity must be a number between 0 and 100.";
        }
        value = Number(value);
        if (!isFinite(value) || value < 0 || value > 100) {
            return "REJECTED|Opacity must be a number between 0 and 100.";
        }
        return OBSIDIAN_setOpacity(value);
    }

    if (action === "set_brightness_contrast") {
        return OBSIDIAN_adjustBrightnessContrast(value, secondaryValue);
    }

    if (action === "reduce_opacity") return OBSIDIAN_reduceOpacity();

    if (action === "scale_selected") {
        if (value === null || value === undefined || value === "") {
            return "REJECTED|Scale change must be 1% to 100% up, or 1% to less than 100% down.";
        }
        value = Number(value);
        if (!isFinite(value) || value === 0 || value > 100 || value <= -100) {
            return "REJECTED|Scale change must be 1% to 100% up, or 1% to less than 100% down.";
        }
        return OBSIDIAN_scaleSelected(value);
    }

    if (action === "set_scale") {
        if (value === null || value === undefined || value === "") {
            return "REJECTED|Scale target must be between 0% and 1000%.";
        }
        return OBSIDIAN_setScale(value);
    }

    if (action === "scale_in") return OBSIDIAN_scaleIn();
    if (action === "slide_up") return OBSIDIAN_slideUp();
    if (action === "crossfade") return OBSIDIAN_crossfade();
    if (action === "apply_recipe") return OBSIDIAN_applyRecipe(profile);

    if (action === "add_glow") {
        profile = String(profile || "unspecified");
        if (profile !== "cinematic" && profile !== "attention" && profile !== "unspecified") {
            return "REJECTED|Unsupported Glow profile.";
        }
        var glowResult = OBSIDIAN_addGlow(profile);
        return glowResult;
    }

    if (action === "remove_glow") return OBSIDIAN_removeGlow();
    if (action === "fade_in") return OBSIDIAN_fadeIn();
    if (action === "fade_out") return OBSIDIAN_fadeOut();

    return "REJECTED|Unsupported planned action: " + OBSIDIAN_cleanText(action) + ".";
}
