/* VANTA After Effects host tools.
 * Loaded into After Effects by CEP through ScriptPath.
 * Keep this file ExtendScript-compatible.
 */

function VANTA_getSelectedLayers() {
    var comp = app.project.activeItem;

    if (!(comp instanceof CompItem)) {
        return null;
    }

    if (!comp.selectedLayers || comp.selectedLayers.length === 0) {
        return null;
    }

    return comp.selectedLayers;
}

function VANTA_addGlow() {
    var layers = VANTA_getSelectedLayers();

    if (!layers) {
        return "ERROR|Open a composition and select at least one layer.";
    }

    var changed = 0;
    app.beginUndoGroup("VANTA - Add Glow");

    try {
        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i];
            var effects = layer.property("ADBE Effect Parade");

            if (!effects || !effects.canAddProperty("ADBE Glo2")) {
                continue;
            }

            var alreadyHasGlow = false;

            for (var j = 1; j <= effects.numProperties; j++) {
                if (effects.property(j).matchName === "ADBE Glo2") {
                    alreadyHasGlow = true;
                    break;
                }
            }

            if (!alreadyHasGlow) {
                effects.addProperty("ADBE Glo2");
                changed++;
            }
        }
    } catch (error) {
        app.endUndoGroup();
        return "ERROR|" + error.toString();
    }

    app.endUndoGroup();

    if (changed === 0) {
        return "OK|Glow is already on the selected layer(s), or the selected layer type cannot accept Glow.";
    }

    return "OK|Added Glow to " + changed + " selected layer(s).";
}

function VANTA_removeGlow() {
    var layers = VANTA_getSelectedLayers();

    if (!layers) {
        return "ERROR|Open a composition and select at least one layer.";
    }

    var removed = 0;
    app.beginUndoGroup("VANTA - Remove Glow");

    try {
        for (var i = 0; i < layers.length; i++) {
            var effects = layers[i].property("ADBE Effect Parade");

            if (!effects) {
                continue;
            }

            for (var j = effects.numProperties; j >= 1; j--) {
                if (effects.property(j).matchName === "ADBE Glo2") {
                    effects.property(j).remove();
                    removed++;
                }
            }
        }
    } catch (error) {
        app.endUndoGroup();
        return "ERROR|" + error.toString();
    }

    app.endUndoGroup();
    return "OK|Removed Glow from " + removed + " effect instance(s).";
}

function VANTA_setOpacity(value) {
    var layers = VANTA_getSelectedLayers();

    if (!layers) {
        return "ERROR|Open a composition and select at least one layer.";
    }

    value = Number(value);

    if (isNaN(value)) {
        return "ERROR|Opacity must be a number.";
    }

    value = Math.max(0, Math.min(100, value));

    app.beginUndoGroup("VANTA - Set Opacity");

    try {
        for (var i = 0; i < layers.length; i++) {
            var opacity = layers[i]
                .property("ADBE Transform Group")
                .property("ADBE Opacity");

            if (opacity) {
                opacity.setValue(value);
            }
        }
    } catch (error) {
        app.endUndoGroup();
        return "ERROR|" + error.toString();
    }

    app.endUndoGroup();
    return "OK|Set opacity to " + value + "% on " + layers.length + " selected layer(s).";
}

function VANTA_reduceOpacity() {
    var layers = VANTA_getSelectedLayers();

    if (!layers) {
        return "ERROR|Open a composition and select at least one layer.";
    }

    app.beginUndoGroup("VANTA - Reduce Opacity");

    try {
        for (var i = 0; i < layers.length; i++) {
            var opacity = layers[i]
                .property("ADBE Transform Group")
                .property("ADBE Opacity");

            if (opacity) {
                var current = Number(opacity.value);
                opacity.setValue(Math.max(0, current - 20));
            }
        }
    } catch (error) {
        app.endUndoGroup();
        return "ERROR|" + error.toString();
    }

    app.endUndoGroup();
    return "OK|Reduced opacity by 20% on " + layers.length + " selected layer(s).";
}

function VANTA_executeCommand(command) {
    var text = String(command || "").toLowerCase();

    if (text.indexOf("remove") !== -1 && text.indexOf("glow") !== -1) {
        return VANTA_removeGlow();
    }

    if (text.indexOf("glow") !== -1) {
        return VANTA_addGlow();
    }

    var opacityMatch = text.match(/(?:opacity|opaque)[^0-9]*(\d{1,3})\s*%?/);

    if (opacityMatch) {
        return VANTA_setOpacity(Number(opacityMatch[1]));
    }

    if (text.indexOf("reduce opacity") !== -1 ||
        text.indexOf("lower opacity") !== -1 ||
        text.indexOf("decrease opacity") !== -1) {
        return VANTA_reduceOpacity();
    }

    return "ERROR|I don't have a VANTA action for that command yet.";
}
