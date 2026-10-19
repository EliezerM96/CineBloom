#target aftereffects
#targetengine "CineBloomEngine_v121"

/*
    CineBloom v1.2.1
    Camera-style bloom + halation rig for After Effects 2026 / macOS + Windows.

    Changes vs 1.2.0:
    - CRITICAL FIX: Color A/B are discovered by PropertyValueType.COLOR instead of wrong numeric indices.
    - Prevents RGBA color expressions from being assigned to scalar Color Looping/Color Loops properties.
    - Atomic build: failed rigs are removed automatically instead of leaving partial effects behind.
    - Diagnostics reports discovered Glow color properties for verification.
    - Keeps Color Channels source + camera-style restrained calibration from v1.2.0.
*/

(function CineBloom(thisObj) {
    var SCRIPT_NAME = "CineBloom";
    var VERSION = "1.2.1";
    var PREFIX = "CB - ";
    var ENGINE_PREFIX = "CB Engine - ";
    var LEGACY_PASS_PREFIX = "CB [";

    var MN = {
        EFFECTS: "ADBE Effect Parade",
        SLIDER: "ADBE Slider Control",
        COLOR: "ADBE Color Control",
        GLOW: "ADBE Glo2"
    };

    var GLOW_PROP = {
        BASED_ON: 1,
        THRESHOLD: 2,
        RADIUS: 3,
        INTENSITY: 4,
        COMPOSITE: 5,
        OPERATION: 6,
        COLORS: 7,
        COLOR_A: 12,
        COLOR_B: 13
    };

    var GLOW_VALUE = {
        COLOR_CHANNELS: 1,
        COMPOSITE_ON_TOP: 1,
        OP_SCREEN: 10,
        ORIGINAL_COLORS: 1,
        AB_COLORS: 2
    };

    var CTRL = {
        AMOUNT: PREFIX + "Amount",
        BLOOM: PREFIX + "Bloom",
        HALATION: PREFIX + "Halation",
        SPREAD: PREFIX + "Spread",
        HIGHLIGHTS: PREFIX + "Highlights",
        HALATION_COLOR: PREFIX + "Halation Color"
    };

    var PASS = {
        BLOOM_CORE: ENGINE_PREFIX + "Bloom Core (Advanced)",
        BLOOM_WIDE: ENGINE_PREFIX + "Bloom Wide (Advanced)",
        HALATION: ENGINE_PREFIX + "Halation (Advanced)"
    };

    var PRESET_ORDER = [
        "Subtle Film",
        "Clean Bloom",
        "Soft Diffusion",
        "Night Lights",
        "Film Halation",
        "Soft Commercial"
    ];

    var PRESETS = {
        "Subtle Film":      {amount:100, bloom:28, halation:8,  spread:88,  highlights:92, color:[0.92,0.18,0.055,1]},
        "Clean Bloom":      {amount:100, bloom:34, halation:2,  spread:78,  highlights:95, color:[0.94,0.20,0.065,1]},
        "Soft Diffusion":   {amount:100, bloom:42, halation:5,  spread:112, highlights:88, color:[0.94,0.20,0.065,1]},
        "Night Lights":     {amount:100, bloom:40, halation:9,  spread:102, highlights:93, color:[0.90,0.13,0.035,1]},
        "Film Halation":    {amount:100, bloom:28, halation:18, spread:86,  highlights:91, color:[0.88,0.11,0.03,1]},
        "Soft Commercial":  {amount:100, bloom:32, halation:4,  spread:92,  highlights:91, color:[0.95,0.22,0.08,1]}
    };

    var statusLabel = null;

    function setStatus(message) {
        if (statusLabel) {
            try {
                statusLabel.text = "Status: " + message;
                statusLabel.parent.layout.layout(true);
            } catch (e) {}
        }
    }

    function errText(e) {
        var s = "Unknown error";
        try { s = e.toString(); } catch (ignore) {}
        try {
            if (e.line) s += " (line " + e.line + ")";
        } catch (ignore2) {}
        return s;
    }

    function activeComp() {
        var item = app.project ? app.project.activeItem : null;
        if (item && (item instanceof CompItem)) return item;
        return null;
    }

    function getEffects(layer) {
        try { return layer.property(MN.EFFECTS); } catch (e) { return null; }
    }

    function canReceiveEffects(layer) {
        var fx = getEffects(layer);
        if (!fx) return false;
        try { return fx.canAddProperty(MN.SLIDER); } catch (e) { return false; }
    }

    // Explicit iteration is slower but more reliable across AE versions/localizations.
    function effectByName(layer, name) {
        var fx = getEffects(layer);
        if (!fx) return null;
        var i, p, n;
        for (i = 1; i <= fx.numProperties; i++) {
            p = fx.property(i);
            if (!p) continue;
            try { n = p.name; } catch (e) { n = ""; }
            if (n === name) return p;
        }
        return null;
    }

    function removeCineBloom(layer) {
        var fx = getEffects(layer);
        if (!fx) return 0;
        var removed = 0;
        var i, p, n;
        for (i = fx.numProperties; i >= 1; i--) {
            p = fx.property(i);
            if (!p) continue;
            try { n = p.name; } catch (e) { n = ""; }
            if (n.indexOf(PREFIX) === 0 || n.indexOf(ENGINE_PREFIX) === 0 || n.indexOf(LEGACY_PASS_PREFIX) === 0) {
                try { p.remove(); removed++; } catch (e2) {}
            }
        }
        return removed;
    }

    function addEffect(layer, matchName, displayName) {
        var fx = getEffects(layer);
        if (!fx) throw new Error("The selected layer cannot receive effects.");

        var canAdd = false;
        try { canAdd = fx.canAddProperty(matchName); } catch (e0) { canAdd = false; }
        if (!canAdd) throw new Error("After Effects cannot add required effect: " + matchName);

        var p = null;
        try { p = fx.addProperty(matchName); } catch (e1) {
            throw new Error("Could not add " + matchName + ": " + errText(e1));
        }
        if (!p) throw new Error("After Effects returned no effect after adding " + matchName);

        var idx = p.propertyIndex;
        p = getEffects(layer).property(idx);
        try { p.name = displayName; } catch (e2) {
            throw new Error("Could not rename effect to '" + displayName + "': " + errText(e2));
        }
        return idx;
    }

    function valueProp(effect) {
        if (!effect) return null;
        try { return effect.property(1); } catch (e) { return null; }
    }

    function addSlider(layer, name, value) {
        var idx = addEffect(layer, MN.SLIDER, name);
        var e = getEffects(layer).property(idx);
        var p = valueProp(e);
        if (!p) throw new Error("Controller has no value property: " + name);
        p.setValue(value);
        return idx;
    }

    function addColor(layer, name, value) {
        var idx = addEffect(layer, MN.COLOR, name);
        var e = getEffects(layer).property(idx);
        var p = valueProp(e);
        if (!p) throw new Error("Color controller has no value property: " + name);
        p.setValue(value);
        return idx;
    }

    function setControl(layer, name, value) {
        var e = effectByName(layer, name);
        if (!e) return false;
        var p = valueProp(e);
        if (!p) return false;
        try { p.setValue(value); return true; } catch (err) { return false; }
    }

    function glowProp(glow, fallbackIndex, matchName) {
        if (!glow) return null;
        var i, p, m;
        // Prefer stable matchName when available.
        for (i = 1; i <= glow.numProperties; i++) {
            p = glow.property(i);
            try { m = p.matchName; } catch (e0) { m = ""; }
            if (m === matchName) return p;
        }
        try { return glow.property(fallbackIndex); } catch (e1) { return null; }
    }

    // Glow has several scalar color-related controls (Color Looping, Color Loops, etc.)
    // before the actual Color A / Color B properties. Numeric indices have changed across
    // builds and are easy to mis-map, so discover true color-valued properties by type.
    function glowColorPair(glow) {
        var colors = [];
        var i, p, vt;
        if (!glow) return {a:null, b:null};
        for (i = 1; i <= glow.numProperties; i++) {
            p = glow.property(i);
            if (!p) continue;
            try { vt = p.propertyValueType; } catch (e0) { vt = null; }
            try {
                if (vt === PropertyValueType.COLOR) colors.push(p);
            } catch (e1) {}
        }
        // Native Glow exposes exactly two actual color-value properties: Color A and Color B.
        if (colors.length >= 2) return {a:colors[colors.length-2], b:colors[colors.length-1]};

        // Conservative fallback for current native Glow ordering. Validate dimension before use.
        var a = glowProp(glow, GLOW_PROP.COLOR_A, "ADBE Glo2-0012");
        var b = glowProp(glow, GLOW_PROP.COLOR_B, "ADBE Glo2-0013");
        try { if (a && a.propertyValueType !== PropertyValueType.COLOR) a = null; } catch (e2) { a = null; }
        try { if (b && b.propertyValueType !== PropertyValueType.COLOR) b = null; } catch (e3) { b = null; }
        return {a:a, b:b};
    }

    function setExpr(prop, expr, label) {
        if (!prop) throw new Error("Missing Glow property: " + label);
        if (!prop.canSetExpression) throw new Error("Glow property cannot accept expression: " + label);
        try {
            prop.expression = expr;
            prop.expressionEnabled = true;
            try {
                if (prop.expressionError && prop.expressionError.length > 0) {
                    throw new Error(prop.expressionError);
                }
            } catch (exprCheck) {
                if (exprCheck && exprCheck.message) throw exprCheck;
            }
        } catch (e) {
            throw new Error("Expression failed on " + label + ": " + errText(e));
        }
    }

    function setStatic(prop, value) {
        if (!prop) return false;
        try { prop.setValue(value); return true; } catch (e) { return false; }
    }

    // Controller value is property 1 for both Slider Control and Color Control.
    // Referencing by index keeps expressions portable across localized AE installations.
    function exprSlider(name) {
        return 'effect("' + name + '")(1)';
    }

    function exprColor(name) {
        return 'effect("' + name + '")(1)';
    }

    function configureGlow(layer, passName, kind) {
        var glow = effectByName(layer, passName);
        if (!glow) throw new Error("Could not find engine pass: " + passName);

        var pBasedOn   = glowProp(glow, GLOW_PROP.BASED_ON,  "ADBE Glo2-0001");
        var pThreshold = glowProp(glow, GLOW_PROP.THRESHOLD, "ADBE Glo2-0002");
        var pRadius    = glowProp(glow, GLOW_PROP.RADIUS,    "ADBE Glo2-0003");
        var pIntensity = glowProp(glow, GLOW_PROP.INTENSITY, "ADBE Glo2-0004");
        var pComposite = glowProp(glow, GLOW_PROP.COMPOSITE, "ADBE Glo2-0005");
        var pOperation = glowProp(glow, GLOW_PROP.OPERATION, "ADBE Glo2-0006");
        var pColors    = glowProp(glow, GLOW_PROP.COLORS,    "ADBE Glo2-0007");
        var colorPair  = glowColorPair(glow);
        var pColorA    = colorPair.a;
        var pColorB    = colorPair.b;

        setStatic(pBasedOn, GLOW_VALUE.COLOR_CHANNELS);
        setStatic(pComposite, GLOW_VALUE.COMPOSITE_ON_TOP);
        // If AE's enum differs, this safely fails and leaves AE's current operation intact.
        setStatic(pOperation, GLOW_VALUE.OP_SCREEN);

        var amount = "Math.min(1,Math.max(0," + exprSlider(CTRL.AMOUNT) + "/100))";
        var bloom = "Math.min(1,Math.max(0," + exprSlider(CTRL.BLOOM) + "/100))";
        var halation = "Math.min(1,Math.max(0," + exprSlider(CTRL.HALATION) + "/100))";
        var spread = "Math.min(2.5,Math.max(0," + exprSlider(CTRL.SPREAD) + "/100))";
        var highlights = "Math.min(100,Math.max(0," + exprSlider(CTRL.HIGHLIGHTS) + "))";
        var compScale = "Math.max(0.5,thisComp.width/1920)";

        if (kind === "bloomCore") {
            setExpr(pThreshold, highlights, "Bloom Core Threshold");
            setExpr(pRadius, "Math.max(0,12*" + spread + "*" + compScale + ")", "Bloom Core Radius");
            setExpr(pIntensity, "Math.max(0,0.55*" + amount + "*" + bloom + ")", "Bloom Core Intensity");
            setStatic(pColors, GLOW_VALUE.ORIGINAL_COLORS);
        } else if (kind === "bloomWide") {
            setExpr(pThreshold, "Math.min(100," + highlights + "+2)", "Bloom Wide Threshold");
            setExpr(pRadius, "Math.max(0,52*" + spread + "*" + compScale + ")", "Bloom Wide Radius");
            setExpr(pIntensity, "Math.max(0,0.15*" + amount + "*" + bloom + ")", "Bloom Wide Intensity");
            setStatic(pColors, GLOW_VALUE.ORIGINAL_COLORS);
        } else {
            setExpr(pThreshold, "Math.min(100," + highlights + "+3)", "Halation Threshold");
            setExpr(pRadius, "Math.max(0,5*" + spread + "*" + compScale + ")", "Halation Radius");
            setExpr(pIntensity, "Math.max(0,0.28*" + amount + "*" + halation + ")", "Halation Intensity");
            setStatic(pColors, GLOW_VALUE.AB_COLORS);
            if (!pColorA || !pColorB) throw new Error("Could not locate native Glow Color A / Color B properties safely.");
            setExpr(pColorA, exprColor(CTRL.HALATION_COLOR), "Halation Color A");
            setExpr(pColorB, exprColor(CTRL.HALATION_COLOR), "Halation Color B");
        }
    }

    function buildRig(layer, presetName) {
        var preset = PRESETS[presetName] || PRESETS["Subtle Film"];
        removeCineBloom(layer);
        try {
            addSlider(layer, CTRL.AMOUNT, preset.amount);
            addSlider(layer, CTRL.BLOOM, preset.bloom);
            addSlider(layer, CTRL.HALATION, preset.halation);
            addSlider(layer, CTRL.SPREAD, preset.spread);
            addSlider(layer, CTRL.HIGHLIGHTS, preset.highlights);
            addColor(layer, CTRL.HALATION_COLOR, preset.color);

            // Halation first so it is extracted from the original highlights,
            // not from bloom that has already been created by an earlier pass.
            addEffect(layer, MN.GLOW, PASS.HALATION);
            addEffect(layer, MN.GLOW, PASS.BLOOM_CORE);
            addEffect(layer, MN.GLOW, PASS.BLOOM_WIDE);

            configureGlow(layer, PASS.HALATION, "halation");
            configureGlow(layer, PASS.BLOOM_CORE, "bloomCore");
            configureGlow(layer, PASS.BLOOM_WIDE, "bloomWide");
        } catch (e) {
            // Never leave a half-built CineBloom stack on the user's layer.
            removeCineBloom(layer);
            throw e;
        }
    }

    function hasCurrentRig(layer) {
        return effectByName(layer, CTRL.AMOUNT) !== null &&
               effectByName(layer, PASS.BLOOM_CORE) !== null;
    }

    function hasLegacyRig(layer) {
        return effectByName(layer, PREFIX + "Master Mix") !== null ||
               effectByName(layer, LEGACY_PASS_PREFIX + "Bloom Core]") !== null;
    }

    function updateRig(layer, presetName) {
        var preset = PRESETS[presetName] || PRESETS["Subtle Film"];
        setControl(layer, CTRL.AMOUNT, preset.amount);
        setControl(layer, CTRL.BLOOM, preset.bloom);
        setControl(layer, CTRL.HALATION, preset.halation);
        setControl(layer, CTRL.SPREAD, preset.spread);
        setControl(layer, CTRL.HIGHLIGHTS, preset.highlights);
        setControl(layer, CTRL.HALATION_COLOR, preset.color);
        configureGlow(layer, PASS.BLOOM_CORE, "bloomCore");
        configureGlow(layer, PASS.BLOOM_WIDE, "bloomWide");
        configureGlow(layer, PASS.HALATION, "halation");
    }

    function selectedUsableLayers() {
        var comp = activeComp();
        var result = [];
        if (!comp) return result;
        var selected = comp.selectedLayers;
        var i;
        for (i = 0; i < selected.length; i++) {
            if (canReceiveEffects(selected[i])) result.push(selected[i]);
        }
        return result;
    }

    function applyToSelection(presetName, rebuild) {
        var comp = activeComp();
        if (!comp) throw new Error("Open a composition first.");

        var layers = selectedUsableLayers();
        if (layers.length === 0) throw new Error("Select at least one effect-capable layer.");

        var ok = 0;
        var errors = [];
        app.beginUndoGroup(SCRIPT_NAME + " - " + (rebuild ? "Rebuild" : "Apply"));
        try {
            var i, layer;
            for (i = 0; i < layers.length; i++) {
                layer = layers[i];
                try {
                    if (rebuild || !hasCurrentRig(layer) || hasLegacyRig(layer)) {
                        buildRig(layer, presetName);
                    } else {
                        updateRig(layer, presetName);
                    }
                    ok++;
                } catch (eLayer) {
                    errors.push(layer.name + ": " + errText(eLayer));
                }
            }
        } finally {
            app.endUndoGroup();
        }

        if (errors.length > 0) {
            throw new Error("Applied to " + ok + " layer(s). Failed on " + errors.length + ":\n" + errors.join("\n"));
        }
        return ok;
    }

    function removeFromSelection() {
        var layers = selectedUsableLayers();
        if (layers.length === 0) throw new Error("Select at least one effect-capable layer.");
        var removed = 0;
        app.beginUndoGroup(SCRIPT_NAME + " - Remove");
        try {
            var i;
            for (i = 0; i < layers.length; i++) removed += removeCineBloom(layers[i]);
        } finally {
            app.endUndoGroup();
        }
        return removed;
    }

    function set32BPC() {
        if (!app.project) throw new Error("No project is open.");
        app.beginUndoGroup(SCRIPT_NAME + " - 32 bpc");
        try { app.project.bitsPerChannel = 32; }
        finally { app.endUndoGroup(); }
    }

    // Read-only diagnostics: deliberately DOES NOT add a Glow.
    function diagnostics() {
        var lines = [];
        lines.push(SCRIPT_NAME + " v" + VERSION);
        lines.push("After Effects: " + app.version);
        lines.push("OS: " + $.os);
        lines.push("Project BPC: " + (app.project ? app.project.bitsPerChannel : "No project"));

        var comp = activeComp();
        lines.push("Active comp: " + (comp ? comp.name : "None"));
        if (comp) lines.push("Selected layers: " + comp.selectedLayers.length);

        var layers = selectedUsableLayers();
        lines.push("Effect-capable selected layers: " + layers.length);
        if (layers.length > 0) {
            var layer = layers[0];
            lines.push("First layer: " + layer.name);
            lines.push("Current CineBloom rig: " + (hasCurrentRig(layer) ? "Yes" : "No"));
            lines.push("Legacy CineBloom rig: " + (hasLegacyRig(layer) ? "Yes" : "No"));
            var fx = getEffects(layer);
            var canSlider = false, canColor = false, canGlow = false;
            try { canSlider = fx.canAddProperty(MN.SLIDER); } catch (e1) {}
            try { canColor = fx.canAddProperty(MN.COLOR); } catch (e2) {}
            try { canGlow = fx.canAddProperty(MN.GLOW); } catch (e3) {}
            lines.push("Can add Slider Control: " + (canSlider ? "Yes" : "No"));
            lines.push("Can add Color Control: " + (canColor ? "Yes" : "No"));
            lines.push("Can add native Glow: " + (canGlow ? "Yes" : "No"));
            lines.push("Existing effects: " + fx.numProperties);

            if (hasCurrentRig(layer)) {
                var g = effectByName(layer, PASS.BLOOM_CORE);
                if (g) {
                    var dBased = glowProp(g, GLOW_PROP.BASED_ON, "ADBE Glo2-0001");
                    var dThr = glowProp(g, GLOW_PROP.THRESHOLD, "ADBE Glo2-0002");
                    var dRad = glowProp(g, GLOW_PROP.RADIUS, "ADBE Glo2-0003");
                    var dInt = glowProp(g, GLOW_PROP.INTENSITY, "ADBE Glo2-0004");
                    try { lines.push("Bloom Core - Glow Based On value: " + dBased.value + " (expected 1 = Color Channels)"); } catch (ed1) {}
                    try { lines.push("Bloom Core - Threshold now: " + dThr.value); } catch (ed2) {}
                    try { lines.push("Bloom Core - Radius now: " + dRad.value); } catch (ed3) {}
                    try { lines.push("Bloom Core - Intensity now: " + dInt.value); } catch (ed4) {}
                    try { if (dThr.expressionError) lines.push("Threshold expression error: " + dThr.expressionError); } catch (ed5) {}
                    try { if (dRad.expressionError) lines.push("Radius expression error: " + dRad.expressionError); } catch (ed6) {}
                    try { if (dInt.expressionError) lines.push("Intensity expression error: " + dInt.expressionError); } catch (ed7) {}
                    var cp = glowColorPair(g);
                    try { lines.push("Glow color property A: " + (cp.a ? cp.a.name + " / " + cp.a.matchName : "NOT FOUND")); } catch (ed8) {}
                    try { lines.push("Glow color property B: " + (cp.b ? cp.b.name + " / " + cp.b.matchName : "NOT FOUND")); } catch (ed9) {}
                }
            }
        }
        lines.push("");
        lines.push("Diagnostics is read-only in v1.2.1.");
        alert(lines.join("\n"), SCRIPT_NAME + " Diagnostics");
    }

    function presetNameFromDropdown(dropdown) {
        var idx = 0;
        try {
            if (dropdown.selection !== null && dropdown.selection !== undefined) {
                idx = dropdown.selection.index;
            }
        } catch (e) { idx = 0; }
        if (idx < 0 || idx >= PRESET_ORDER.length) idx = 0;
        return PRESET_ORDER[idx];
    }

    function safeAction(label, fn) {
        setStatus(label + "...");
        try {
            var result = fn();
            setStatus(label + " OK" + ((result !== undefined && result !== null) ? " — " + result : ""));
        } catch (e) {
            var msg = errText(e);
            setStatus("ERROR — " + msg);
            alert(msg, SCRIPT_NAME + " " + VERSION);
        }
    }

    function buildUI(thisObj) {
        var pal = (thisObj instanceof Panel) ? thisObj : new Window("palette", SCRIPT_NAME + " " + VERSION, undefined, {resizeable:true});
        if (!pal) return pal;

        pal.orientation = "column";
        pal.alignChildren = ["fill", "top"];
        pal.spacing = 8;
        pal.margins = 10;

        var title = pal.add("statictext", undefined, "CineBloom  •  Bloom + Halation");
        try { title.graphics.font = ScriptUI.newFont(title.graphics.font.name, "BOLD", 13); } catch (e0) {}
        pal.add("statictext", undefined, "v1.2.1 • Glow color-map fix • atomic build");

        var presetGroup = pal.add("panel", undefined, "Look");
        presetGroup.orientation = "column";
        presetGroup.alignChildren = ["fill", "top"];
        presetGroup.margins = 10;

        var presetDropdown = presetGroup.add("dropdownlist", undefined, PRESET_ORDER);
        presetDropdown.selection = 0;

        var row = presetGroup.add("group");
        row.orientation = "row";
        row.alignChildren = ["fill", "center"];
        var applyBtn = row.add("button", undefined, "Apply / Update");
        var rebuildBtn = row.add("button", undefined, "Rebuild");

        var info = pal.add("panel", undefined, "Effect Controls");
        info.orientation = "column";
        info.alignChildren = ["left", "top"];
        info.margins = 10;
        info.add("statictext", undefined, "Amount • Bloom • Halation • Spread • Highlights • Halation Color", {multiline:true});

        var tools = pal.add("panel", undefined, "Tools");
        tools.orientation = "column";
        tools.alignChildren = ["fill", "top"];
        tools.margins = 10;
        var toolsRow = tools.add("group");
        toolsRow.orientation = "row";
        var bpcBtn = toolsRow.add("button", undefined, "Set 32 bpc");
        var removeBtn = toolsRow.add("button", undefined, "Remove");
        var diagBtn = tools.add("button", undefined, "Diagnostics (read-only)");

        statusLabel = pal.add("statictext", undefined, "Status: ready");

        applyBtn.onClick = function() {
            safeAction("Apply", function() {
                var presetName = presetNameFromDropdown(presetDropdown);
                var n = applyToSelection(presetName, false);
                return n + " layer(s), " + presetName;
            });
        };

        rebuildBtn.onClick = function() {
            safeAction("Rebuild", function() {
                var presetName = presetNameFromDropdown(presetDropdown);
                var n = applyToSelection(presetName, true);
                return n + " layer(s), " + presetName;
            });
        };

        removeBtn.onClick = function() {
            safeAction("Remove", function() {
                var n = removeFromSelection();
                return n + " CineBloom effect(s) removed";
            });
        };

        bpcBtn.onClick = function() {
            safeAction("32 bpc", function() { set32BPC(); return "project set to 32 bpc"; });
        };

        diagBtn.onClick = function() {
            safeAction("Diagnostics", function() { diagnostics(); return "completed, no effects added"; });
        };

        pal.onResizing = pal.onResize = function() { this.layout.resize(); };
        pal.layout.layout(true);
        return pal;
    }

    var panel = buildUI(thisObj);
    if (panel instanceof Window) {
        panel.center();
        panel.show();
    }
})(this);
