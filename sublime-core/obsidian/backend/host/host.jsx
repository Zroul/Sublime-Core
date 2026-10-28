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
            return "ERROR|Opacity edit cancelled: existing opacity animation or expression on '" +
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
    if (!app.project) return "ERROR|No After Effects project is open.";
    var comp = OBSIDIAN_getActiveComp();
    if (!comp) return "ERROR|No active composition. Open or select a composition, then inspect again.";

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
    if (!layers.length) return "ERROR|Open a composition and select at least one layer.";
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
    if (!thresholdProp || !radiusProp || !intensityProp) {
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
    if (!layers.length) return "ERROR|Open a composition and select at least one layer.";
    profile = String(profile || "unspecified");
    if (profile !== "cinematic" && profile !== "attention" && profile !== "unspecified") {
        return "ERROR|Unsupported Glow profile.";
    }

    var changed = 0;
    var verified = 0;
    var configured = 0;
    app.beginUndoGroup("OBSIDIAN - Add Glow");
    try {
        for (var i = 0; i < layers.length; i++) {
            var effects = layers[i].property("ADBE Effect Parade");
            if (!effects) continue;
            var glow = null;
            for (var j = 1; j <= effects.numProperties; j++) {
                if (effects.property(j).matchName === "ADBE Glo2") {
                    glow = effects.property(j);
                    break;
                }
            }
            if (!glow && effects.canAddProperty("ADBE Glo2")) {
                effects.addProperty("ADBE Glo2");
                changed++;
                /* AE can invalidate an effect-group reference after addProperty. Reacquire it. */
                effects = layers[i].property("ADBE Effect Parade");
                if (effects) {
                    for (var k = 1; k <= effects.numProperties; k++) {
                        if (effects.property(k).matchName === "ADBE Glo2") {
                            glow = effects.property(k);
                            break;
                        }
                    }
                }
            }
            if (glow && (profile === "cinematic" || profile === "attention")) {
                OBSIDIAN_applyGlowProfile(glow, profile);
                configured++;
            }
        }
        for (var n = 0; n < layers.length; n++) {
            var verifyEffects = layers[n].property("ADBE Effect Parade");
            if (!verifyEffects) continue;
            for (var m = 1; m <= verifyEffects.numProperties; m++) {
                if (verifyEffects.property(m).matchName === "ADBE Glo2") {
                    verified++;
                    break;
                }
            }
        }
    } catch (error) {
        app.endUndoGroup();
        return "ERROR|Add Glow failed: " + error.toString();
    }
    app.endUndoGroup();

    if (verified === 0) return "ERROR|Glow was not found after the edit. No successful result could be verified.";
    var message = "OK|Verified Glow on " + verified + " selected layer(s); added " + changed + " new effect(s).";
    if (profile === "cinematic" || profile === "attention") {
        if (configured !== verified) return "ERROR|Glow exists, but its requested preset was not configured on every selected layer.";
        message += " Applied and verified " + profile + " preset on " + configured + " layer(s).";
    }
    return message;
}

function OBSIDIAN_removeGlow() {
    var layers = OBSIDIAN_getSelectedLayers();
    if (!layers.length) return "ERROR|Open a composition and select at least one layer.";

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

function OBSIDIAN_setOpacity(value) {
    var layers = OBSIDIAN_getSelectedLayers();
    if (!layers.length) return "ERROR|Open a composition and select at least one layer.";

    value = Number(value);
    if (isNaN(value)) return "ERROR|Opacity must be a number.";
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
    if (!layers.length) return "ERROR|Open a composition and select at least one layer.";
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

function OBSIDIAN_scaleSnapshotText(snapshot) {
    var valueText = snapshot.values === null ? "unavailable" : "[" + snapshot.values.join(", ") + "]";
    return valueText + " (dimensions=" + snapshot.dimensions + ", propertyValueType=" + snapshot.propertyValueType + ")";
}

function OBSIDIAN_scaleSnapshotMatches(snapshot, expected) {
    var current = snapshot ? snapshot.values : null;
    if (!current || current.length !== expected.length) return false;
    for (var i = 0; i < expected.length; i++) {
        if (!isFinite(Number(current[i])) || Math.abs(Number(current[i]) - expected[i]) > 0.01) return false;
    }
    return true;
}

function OBSIDIAN_scaleSelected(signedPercent) {
    var layers = OBSIDIAN_getSelectedLayers();
    if (!layers.length) return "ERROR|Open a composition and select at least one layer.";

    signedPercent = Number(signedPercent);
    if (!isFinite(signedPercent) || signedPercent === 0 || signedPercent > 100 || signedPercent <= -100) {
        return "ERROR|Scale change must be 1% to 100% up, or 1% to less than 100% down.";
    }

    var prepared = [];
    var factor = 1 + signedPercent / 100;
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (layer.locked) {
            return "ERROR|Scale change cancelled: unlock '" + OBSIDIAN_cleanText(layer.name) + "'.";
        }
        var scale = OBSIDIAN_getScaleProperty(layer);
        if (!scale || !scale.value || typeof scale.value.length !== "number" ||
            (scale.value.length !== 2 && scale.value.length !== 3) || typeof scale.setValue !== "function") {
            return "ERROR|Scale change cancelled: a selected layer has no supported 2D or 3D Scale property.";
        }
        if (Number(scale.numKeys) > 0 || scale.expressionEnabled) {
            return "ERROR|Scale change cancelled: existing scale keyframes or expression on '" +
                OBSIDIAN_cleanText(layer.name) + "' were preserved.";
        }

        var original = [];
        var target = [];
        for (var j = 0; j < scale.value.length; j++) {
            var component = Number(scale.value[j]);
            var nextComponent = component * factor;
            if (!isFinite(component) || !isFinite(nextComponent) || Math.abs(nextComponent) > 1000) {
                return "ERROR|Scale change cancelled: the resulting Scale value is outside the supported range.";
            }
            original.push(component);
            target.push(nextComponent);
        }
        prepared.push({ layer: layer, original: original, target: target });
    }

    app.beginUndoGroup("OBSIDIAN - Scale Selected Layers");
    try {
        for (var k = 0; k < prepared.length; k++) {
            var writeProperty = OBSIDIAN_getScaleProperty(prepared[k].layer);
            if (!writeProperty || typeof writeProperty.setValue !== "function") {
                throw new Error("Scale property became unavailable before it could be written.");
            }
            writeProperty.setValue(prepared[k].target);
            prepared[k].immediate = OBSIDIAN_scaleSnapshot(writeProperty);
        }

        var verified = 0;
        var mismatchDetails = [];
        for (var n = 0; n < prepared.length; n++) {
            var freshProperty = OBSIDIAN_getScaleProperty(prepared[n].layer);
            var freshSnapshot = OBSIDIAN_scaleSnapshot(freshProperty);
            if (OBSIDIAN_scaleSnapshotMatches(freshSnapshot, prepared[n].target)) {
                verified++;
            } else {
                mismatchDetails.push(
                    "'" + OBSIDIAN_cleanText(prepared[n].layer.name) + "': requested [" + prepared[n].target.join(", ") +
                    "] (dimensions=" + prepared[n].target.length + "); immediate " + OBSIDIAN_scaleSnapshotText(prepared[n].immediate) +
                    "; fresh " + OBSIDIAN_scaleSnapshotText(freshSnapshot)
                );
            }
        }
        if (verified !== prepared.length) {
            throw new Error("Scale read-back did not match the requested values. Diagnostics: " + mismatchDetails.join(" | "));
        }
    } catch (error) {
        var restored = 0;
        for (var r = 0; r < prepared.length; r++) {
            try {
                var restoreProperty = OBSIDIAN_getScaleProperty(prepared[r].layer);
                if (!restoreProperty || typeof restoreProperty.setValue !== "function") continue;
                restoreProperty.setValue(prepared[r].original);
                var restoredSnapshot = OBSIDIAN_scaleSnapshot(OBSIDIAN_getScaleProperty(prepared[r].layer));
                if (OBSIDIAN_scaleSnapshotMatches(restoredSnapshot, prepared[r].original)) restored++;
            } catch (restoreError) {}
        }
        app.endUndoGroup();
        if (restored === prepared.length) {
            return "ERROR|Scale change failed and original Scale values were restored. " + error.toString();
        }
        return "ERROR|Scale change failed; restoration could not be verified for every layer. Use After Effects Undo and inspect the selected layers. " + error.toString();
    }
    app.endUndoGroup();
    return "OK|Verified proportional scale change on " + prepared.length + " selected layer(s).";
}

function OBSIDIAN_fadeIn() {
    var layers = OBSIDIAN_getSelectedLayers();
    if (!layers.length) return "ERROR|Open a composition and select at least one layer.";
    var prepared = [];
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (layer.locked) return "ERROR|Fade in cancelled: unlock '" + OBSIDIAN_cleanText(layer.name) + "'.";
        var group = layer.property("ADBE Transform Group");
        var opacity = group ? group.property("ADBE Opacity") : null;
        if (!opacity || typeof opacity.setValueAtTime !== "function") return "ERROR|Opacity keyframes unavailable.";
        if (opacity.numKeys > 0 || opacity.expressionEnabled) return "ERROR|Fade in cancelled: existing opacity animation or expression was preserved.";
        var start = Number(layer.inPoint);
        var end = Math.min(start + 0.5, Number(layer.outPoint));
        if (!isFinite(start) || !isFinite(end) || end - start < 0.05) return "ERROR|Selected layer is too short for a fade-in.";
        prepared.push({ opacity: opacity, start: start, end: end, target: Number(opacity.value) });
    }
    var verified = 0;
    app.beginUndoGroup("OBSIDIAN - Fade In");
    try {
        for (var j = 0; j < prepared.length; j++) {
            prepared[j].opacity.setValueAtTime(prepared[j].start, 0);
            prepared[j].opacity.setValueAtTime(prepared[j].end, prepared[j].target);
        }
        for (var k = 0; k < prepared.length; k++) {
            var item = prepared[k];
            var first = item.opacity.nearestKeyIndex(item.start);
            var last = item.opacity.nearestKeyIndex(item.end);
            if (item.opacity.numKeys === 2 &&
                Math.abs(item.opacity.keyTime(first) - item.start) < 0.001 &&
                Math.abs(item.opacity.keyTime(last) - item.end) < 0.001 &&
                Math.abs(Number(item.opacity.keyValue(first))) < 0.01 &&
                Math.abs(Number(item.opacity.keyValue(last)) - item.target) < 0.01) verified++;
        }
    } catch (error) {
        app.endUndoGroup();
        return "ERROR|Fade in failed: " + error.toString();
    }
    app.endUndoGroup();
    if (verified !== prepared.length) return "ERROR|Fade-in keyframes could not be verified on every selected layer.";
    return "OK|Verified fade-in keyframes on " + verified + " selected layer(s).";
}

/**
 * Execute only typed actions produced by the frontend planner.
 * Never parse free-form natural language inside ExtendScript.
 */
function OBSIDIAN_executePlan(action, value, profile) {
    action = String(action || "");

    if (action === "inspect_project") return OBSIDIAN_inspectProject();
    if (action === "inspect_selection") return OBSIDIAN_inspectSelection();

    if (action === "set_opacity") {
        if (value === null || value === undefined || value === "") {
            return "ERROR|Opacity must be a number between 0 and 100.";
        }
        value = Number(value);
        if (!isFinite(value) || value < 0 || value > 100) {
            return "ERROR|Opacity must be a number between 0 and 100.";
        }
        return OBSIDIAN_setOpacity(value);
    }

    if (action === "reduce_opacity") return OBSIDIAN_reduceOpacity();

    if (action === "scale_selected") {
        if (value === null || value === undefined || value === "") {
            return "ERROR|Scale change must be 1% to 100% up, or 1% to less than 100% down.";
        }
        value = Number(value);
        if (!isFinite(value) || value === 0 || value > 100 || value <= -100) {
            return "ERROR|Scale change must be 1% to 100% up, or 1% to less than 100% down.";
        }
        return OBSIDIAN_scaleSelected(value);
    }

    if (action === "add_glow") {
        profile = String(profile || "unspecified");
        if (profile !== "cinematic" && profile !== "attention" && profile !== "unspecified") {
            return "ERROR|Unsupported Glow profile.";
        }
        var glowResult = OBSIDIAN_addGlow(profile);
        return glowResult;
    }

    if (action === "remove_glow") return OBSIDIAN_removeGlow();
    if (action === "fade_in") return OBSIDIAN_fadeIn();

    return "ERROR|Unsupported planned action: " + OBSIDIAN_cleanText(action) + ".";
}
