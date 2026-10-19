#target aftereffects
#targetengine "CineBloomEngine_v111"

/*
    CineBloom v1.1.1
    Cross-platform After Effects ScriptUI panel (macOS / Windows)

    v1.1 redesign goals:
    - Camera-like, highlight-selective bloom and film halation.
    - SDR-friendlier output: lower energy and Screen glow operation.
    - Simplified Effect Controls: six clearly named user controls.
    - Three native Glow engine passes instead of four.
    - Automatic migration/rebuild from CineBloom v1.0 rigs.

    Uses only native After Effects effects and Expression Controls.
    No external plugins required.
*/

(function CineBloom(thisObj) {
    var SCRIPT_NAME = "CineBloom";
    var VERSION = "1.1.1";
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
        COLOR_A: 8,
        COLOR_B: 9
    };

    // Native Glow popup values used by AE's long-standing Glow implementation.
    // Based On: 1 = Alpha Channel, 2 = Color Channels
    // Composite Original: 1 = On Top, 2 = Behind, 3 = None
    // Glow Operation: Screen is the 10th transfer mode in the Glow menu.
    // Glow Colors: 1 = Original Colors, 2 = A & B Colors
    var GLOW_VALUE = {
        COLOR_CHANNELS: 2,
        COMPOSITE_ON_TOP: 1,
        OP_SCREEN: 10,
        ORIGINAL_COLORS: 1,
        AB_COLORS: 2
    };

    // Six user-facing controls. All engine detail lives in native Glow effects below.
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

    // Presets are intentionally restrained. User controls are percentages except Highlights.
    // The actual Glow intensity is capped by expressions at photographic ranges.
    var PRESET_ORDER = [
        "Subtle Film",
        "Clean Bloom",
        "Soft Diffusion",
        "Night Lights",
        "Film Halation",
        "Soft Commercial"
    ];

    var PRESETS = {
        "Subtle Film": {
            amount: 100,
            bloom: 28,
            halation: 12,
            spread: 100,
            highlights: 94,
            color: [0.90, 0.16, 0.05]
        },
        "Clean Bloom": {
            amount: 100,
            bloom: 36,
            halation: 3,
            spread: 90,
            highlights: 95,
            color: [0.92, 0.18, 0.06]
        },
        "Soft Diffusion": {
            amount: 100,
            bloom: 48,
            halation: 8,
            spread: 130,
            highlights: 90,
            color: [0.92, 0.18, 0.06]
        },
        "Night Lights": {
            amount: 100,
            bloom: 42,
            halation: 12,
            spread: 115,
            highlights: 96,
            color: [0.88, 0.12, 0.035]
        },
        "Film Halation": {
            amount: 100,
            bloom: 33,
            halation: 28,
            spread: 100,
            highlights: 93,
            color: [0.86, 0.10, 0.03]
        },
        "Soft Commercial": {
            amount: 100,
            bloom: 38,
            halation: 6,
            spread: 110,
            highlights: 92,
            color: [0.92, 0.20, 0.08]
        }
    };

    function activeComp() {
        var item = app.project ? app.project.activeItem : null;
        if (item && (item instanceof CompItem)) return item;
        return null;
    }

    function getEffects(layer) {
        try { return layer.property(MN.EFFECTS); } catch (e) { return null; }
    }

    function canReceiveEffects(layer) {
        return getEffects(layer) !== null;
    }

    function effectByName(layer, name) {
        var fx = getEffects(layer);
        if (!fx) return null;
        try { return fx.property(name); } catch (e) { return null; }
    }

    function removeCineBloom(layer) {
        var fx = getEffects(layer);
        if (!fx) return;
        for (var i = fx.numProperties; i >= 1; i--) {
            var p = fx.property(i);
            if (!p) continue;
            var n = "";
            try { n = p.name; } catch (e) { n = ""; }
            if (n.indexOf(PREFIX) === 0 ||
                n.indexOf(ENGINE_PREFIX) === 0 ||
                n.indexOf(LEGACY_PASS_PREFIX) === 0) {
                try { p.remove(); } catch (e2) {}
            }
        }
    }

    function addEffect(layer, matchName, displayName) {
        var fx = getEffects(layer);
        if (!fx) throw new Error("Layer cannot receive effects.");
        if (!fx.canAddProperty(matchName)) {
            throw new Error("Required After Effects effect is unavailable: " + matchName);
        }
        var p = fx.addProperty(matchName);
        var idx = p.propertyIndex;
        p = fx.property(idx);
        p.name = displayName;
        return idx;
    }

    function controlValueProp(effect) {
        if (!effect) return null;
        try {
            if (effect.matchName === MN.SLIDER) return effect.property("ADBE Slider Control-0001");
            if (effect.matchName === MN.COLOR) return effect.property("ADBE Color Control-0001");
        } catch (e) {}
        try { return effect.property(1); } catch (e2) { return null; }
    }

    function addSlider(layer, name, value) {
        var idx = addEffect(layer, MN.SLIDER, name);
        var e = getEffects(layer).property(idx);
        var p = controlValueProp(e);
        if (p) p.setValue(value);
        return idx;
    }

    function addColor(layer, name, value) {
        var idx = addEffect(layer, MN.COLOR, name);
        var e = getEffects(layer).property(idx);
        var p = controlValueProp(e);
        if (p) p.setValue(value);
        return idx;
    }

    function setControl(layer, name, value) {
        var e = effectByName(layer, name);
        if (!e) return false;
        var p = controlValueProp(e);
        if (!p) return false;
        try {
            p.setValue(value);
            return true;
        } catch (err) {
            return false;
        }
    }

    function glowProp(glow, fallbackIndex, englishCandidates, matchCandidates) {
        var i, p, n, m;
        if (!glow) return null;

        if (matchCandidates && matchCandidates.length) {
            for (i = 1; i <= glow.numProperties; i++) {
                p = glow.property(i);
                try { m = p.matchName; } catch (e0) { m = ""; }
                for (var j = 0; j < matchCandidates.length; j++) {
                    if (m === matchCandidates[j]) return p;
                }
            }
        }

        if (englishCandidates && englishCandidates.length) {
            for (i = 1; i <= glow.numProperties; i++) {
                p = glow.property(i);
                try { n = p.name.toLowerCase(); } catch (e1) { n = ""; }
                for (var k = 0; k < englishCandidates.length; k++) {
                    if (n === englishCandidates[k].toLowerCase()) return p;
                }
            }
        }

        try { return glow.property(fallbackIndex); } catch (e2) { return null; }
    }

    function setExpr(prop, expr) {
        if (!prop) return false;
        try {
            if (prop.canSetExpression) {
                prop.expression = expr;
                prop.expressionEnabled = true;
                return true;
            }
        } catch (e) {}
        return false;
    }

    function setStatic(prop, value) {
        if (!prop) return false;
        try {
            prop.setValue(value);
            return true;
        } catch (e) {
            return false;
        }
    }

    function exprSlider(name) {
        return 'effect("' + name + '")("Slider")';
    }

    function exprColor(name) {
        return 'effect("' + name + '")("Color")';
    }

    function configureGlow(layer, passName, kind) {
        var glow = effectByName(layer, passName);
        if (!glow) return;

        var pBasedOn = glowProp(glow, GLOW_PROP.BASED_ON, ["Glow Based On"], ["ADBE Glo2-0001"]);
        var pThreshold = glowProp(glow, GLOW_PROP.THRESHOLD, ["Glow Threshold"], ["ADBE Glo2-0002"]);
        var pRadius = glowProp(glow, GLOW_PROP.RADIUS, ["Glow Radius"], ["ADBE Glo2-0003"]);
        var pIntensity = glowProp(glow, GLOW_PROP.INTENSITY, ["Glow Intensity"], ["ADBE Glo2-0004"]);
        var pComposite = glowProp(glow, GLOW_PROP.COMPOSITE, ["Composite Original"], ["ADBE Glo2-0005"]);
        var pOperation = glowProp(glow, GLOW_PROP.OPERATION, ["Glow Operation"], ["ADBE Glo2-0006"]);
        var pColors = glowProp(glow, GLOW_PROP.COLORS, ["Glow Colors"], ["ADBE Glo2-0007"]);
        var pColorA = glowProp(glow, GLOW_PROP.COLOR_A, ["Color A"], ["ADBE Glo2-0008"]);
        var pColorB = glowProp(glow, GLOW_PROP.COLOR_B, ["Color B"], ["ADBE Glo2-0009"]);

        // Always derive from luminance/color highlights and composite optically on top.
        setStatic(pBasedOn, GLOW_VALUE.COLOR_CHANNELS);
        setStatic(pComposite, GLOW_VALUE.COMPOSITE_ON_TOP);

        // Screen is deliberately used instead of Add. Add can create very large HDR values
        // that later clip hard in an SDR/H.264 delivery. Screen is gentler and closer to
        // optical light superposition for this use case.
        setStatic(pOperation, GLOW_VALUE.OP_SCREEN);

        var amount = "Math.min(1.5,Math.max(0," + exprSlider(CTRL.AMOUNT) + "/100))";
        var bloom = "Math.min(1,Math.max(0," + exprSlider(CTRL.BLOOM) + "/100))";
        var halation = "Math.min(1,Math.max(0," + exprSlider(CTRL.HALATION) + "/100))";
        var spread = "Math.min(3,Math.max(0," + exprSlider(CTRL.SPREAD) + "/100))";
        var highlights = "Math.min(100,Math.max(0," + exprSlider(CTRL.HIGHLIGHTS) + "))";
        var compScale = "Math.max(0.35,thisComp.width/1920)";

        if (kind === "bloomCore") {
            setExpr(pThreshold, highlights);
            setExpr(pRadius, "Math.max(0,22*" + spread + "*" + compScale + ")");
            // Max at 100/100 is 0.22 — deliberately far below AE Glow's common default 1.0.
            setExpr(pIntensity, "Math.max(0,0.22*" + amount + "*" + bloom + ")");
            setStatic(pColors, GLOW_VALUE.ORIGINAL_COLORS);
        } else if (kind === "bloomWide") {
            setExpr(pThreshold, "Math.min(100," + highlights + "+2)");
            setExpr(pRadius, "Math.max(0,65*" + spread + "*" + compScale + ")");
            // Wide diffusion is intentionally lower energy than the core pass.
            setExpr(pIntensity, "Math.max(0,0.08*" + amount + "*" + bloom + ")");
            setStatic(pColors, GLOW_VALUE.ORIGINAL_COLORS);
        } else {
            // Halation should hug the brightest high-contrast areas instead of flooding the frame.
            setExpr(pThreshold, "Math.min(100," + highlights + "+1)");
            setExpr(pRadius, "Math.max(0,9*" + spread + "*" + compScale + ")");
            setExpr(pIntensity, "Math.max(0,0.16*" + amount + "*" + halation + ")");
            setStatic(pColors, GLOW_VALUE.AB_COLORS);

            // A single warm hue is more film-like than a visible two-color gradient/ring.
            setExpr(pColorA, exprColor(CTRL.HALATION_COLOR));
            setExpr(pColorB, exprColor(CTRL.HALATION_COLOR));
        }
    }

    function buildRig(layer, presetName) {
        var preset = PRESETS[presetName] || PRESETS["Subtle Film"];
        removeCineBloom(layer);

        // Simple front-end controls.
        addSlider(layer, CTRL.AMOUNT, preset.amount);
        addSlider(layer, CTRL.BLOOM, preset.bloom);
        addSlider(layer, CTRL.HALATION, preset.halation);
        addSlider(layer, CTRL.SPREAD, preset.spread);
        addSlider(layer, CTRL.HIGHLIGHTS, preset.highlights);
        addColor(layer, CTRL.HALATION_COLOR, preset.color);

        // Native render engine. Kept below user controls and clearly labeled Advanced.
        addEffect(layer, MN.GLOW, PASS.BLOOM_CORE);
        addEffect(layer, MN.GLOW, PASS.BLOOM_WIDE);
        addEffect(layer, MN.GLOW, PASS.HALATION);

        configureGlow(layer, PASS.BLOOM_CORE, "bloomCore");
        configureGlow(layer, PASS.BLOOM_WIDE, "bloomWide");
        configureGlow(layer, PASS.HALATION, "halation");
    }

    function hasCurrentRig(layer) {
        return effectByName(layer, CTRL.AMOUNT) !== null &&
               effectByName(layer, PASS.BLOOM_CORE) !== null;
    }

    function hasLegacyRig(layer) {
        return effectByName(layer, PREFIX + "Master Mix") !== null ||
               effectByName(layer, LEGACY_PASS_PREFIX + "Bloom Core]") !== null;
    }

    function applyPresetToExisting(layer, presetName) {
        var preset = PRESETS[presetName] || PRESETS["Subtle Film"];

        if (!hasCurrentRig(layer) || hasLegacyRig(layer)) {
            buildRig(layer, presetName);
            return;
        }

        setControl(layer, CTRL.AMOUNT, preset.amount);
        setControl(layer, CTRL.BLOOM, preset.bloom);
        setControl(layer, CTRL.HALATION, preset.halation);
        setControl(layer, CTRL.SPREAD, preset.spread);
        setControl(layer, CTRL.HIGHLIGHTS, preset.highlights);
        setControl(layer, CTRL.HALATION_COLOR, preset.color);

        // Reassert safe engine settings in case an Advanced property was changed manually.
        configureGlow(layer, PASS.BLOOM_CORE, "bloomCore");
        configureGlow(layer, PASS.BLOOM_WIDE, "bloomWide");
        configureGlow(layer, PASS.HALATION, "halation");
    }

    function selectedUsableLayers() {
        var comp = activeComp();
        if (!comp) return [];
        var result = [];
        var selected = comp.selectedLayers;
        for (var i = 0; i < selected.length; i++) {
            if (canReceiveEffects(selected[i])) result.push(selected[i]);
        }
        return result;
    }

    function applyToSelection(presetName, rebuild) {
        var comp = activeComp();
        if (!comp) {
            alert("Open a composition and select at least one layer.", SCRIPT_NAME);
            return;
        }

        var layers = selectedUsableLayers();
        if (layers.length === 0) {
            alert("Select one or more footage, solid, text, shape, precomp, or other effect-capable layers.", SCRIPT_NAME);
            return;
        }

        app.beginUndoGroup(SCRIPT_NAME + " - Apply");
        var ok = 0;
        var skipped = 0;
        var migrated = 0;
        var errors = [];

        for (var i = 0; i < layers.length; i++) {
            try {
                var wasLegacy = hasLegacyRig(layers[i]);
                if (rebuild || !hasCurrentRig(layers[i]) || wasLegacy) {
                    buildRig(layers[i], presetName);
                } else {
                    applyPresetToExisting(layers[i], presetName);
                }
                if (wasLegacy) migrated++;
                ok++;
            } catch (e) {
                skipped++;
                errors.push(layers[i].name + ": " + e.toString());
            }
        }
        app.endUndoGroup();

        if (errors.length > 0) {
            alert("Applied to " + ok + " layer(s).\n\nCould not process " + skipped + " layer(s):\n" + errors.join("\n"), SCRIPT_NAME);
        } else if (migrated > 0) {
            alert("CineBloom v1.0 rig migrated to v1.1 on " + migrated + " layer(s).", SCRIPT_NAME);
        }
    }

    function removeFromSelection() {
        var layers = selectedUsableLayers();
        if (layers.length === 0) {
            alert("Select one or more layers first.", SCRIPT_NAME);
            return;
        }
        app.beginUndoGroup(SCRIPT_NAME + " - Remove");
        for (var i = 0; i < layers.length; i++) removeCineBloom(layers[i]);
        app.endUndoGroup();
    }

    function set32BPC() {
        if (!app.project) return;
        app.beginUndoGroup(SCRIPT_NAME + " - 32 bpc");
        try {
            app.project.bitsPerChannel = 32;
        } catch (e) {
            alert("Could not set the project to 32 bpc: " + e.toString(), SCRIPT_NAME);
        }
        app.endUndoGroup();
    }

    function diagnostics() {
        var lines = [];
        lines.push(SCRIPT_NAME + " v" + VERSION);
        lines.push("After Effects: " + app.version);
        lines.push("OS: " + $.os);
        lines.push("Project BPC: " + (app.project ? app.project.bitsPerChannel : "No project"));

        if (app.project) {
            try { lines.push("Working space: " + app.project.workingSpace); } catch (e0) {}
            try { lines.push("Linear blending: " + (app.project.linearBlending ? "On" : "Off")); } catch (e1) {}
        }

        var comp = activeComp();
        lines.push("Active comp: " + (comp ? comp.name : "None"));

        var layers = selectedUsableLayers();
        lines.push("Effect-capable selected layers: " + layers.length);

        if (layers.length > 0) {
            lines.push("CineBloom v1.1 rig: " + (hasCurrentRig(layers[0]) ? "Yes" : "No"));
            lines.push("Legacy v1.0 rig: " + (hasLegacyRig(layers[0]) ? "Yes" : "No"));

            var fx = getEffects(layers[0]);
            var canGlow = false;
            try { canGlow = fx.canAddProperty(MN.GLOW); } catch (e2) {}
            lines.push("Native Glow available: " + (canGlow ? "Yes" : "No"));

            if (canGlow) {
                app.beginUndoGroup(SCRIPT_NAME + " Diagnostics");
                try {
                    var temp = fx.addProperty(MN.GLOW);
                    var idx = temp.propertyIndex;
                    temp = fx.property(idx);
                    lines.push("Glow property count: " + temp.numProperties);
                    for (var i = 1; i <= temp.numProperties; i++) {
                        var p = temp.property(i);
                        var pn = "";
                        var pm = "";
                        var pv = "";
                        try { pn = p.name; } catch (e3) {}
                        try { pm = p.matchName; } catch (e4) {}
                        try { pv = p.value; } catch (e5) {}
                        lines.push("  " + i + ": " + pn + "  [" + pm + "] value=" + pv);
                    }
                    temp.remove();
                } catch (err) {
                    lines.push("Glow probe error: " + err.toString());
                }
                app.endUndoGroup();
            }
        }

        lines.push("");
        lines.push("v1.1 engine: Screen blend + highlight-selective low-energy glows.");
        alert(lines.join("\n"), SCRIPT_NAME + " Diagnostics");
    }

    function buildUI(thisObj) {
        var pal = (thisObj instanceof Panel) ? thisObj : new Window("palette", SCRIPT_NAME + " " + VERSION, undefined, {resizeable: true});
        if (!pal) return pal;

        pal.orientation = "column";
        pal.alignChildren = ["fill", "top"];
        pal.spacing = 8;
        pal.margins = 10;

        var title = pal.add("statictext", undefined, "CineBloom  •  Optical Bloom + Halation");
        try { title.graphics.font = ScriptUI.newFont(title.graphics.font.name, "BOLD", 13); } catch (e) {}

        pal.add("statictext", undefined, "v1.1.1 • restrained highlights • SDR-friendlier Screen blend");

        var presetGroup = pal.add("panel", undefined, "Camera Look");
        presetGroup.orientation = "column";
        presetGroup.alignChildren = ["fill", "top"];
        presetGroup.margins = 10;

        var presetDropdown = presetGroup.add("dropdownlist", undefined, PRESET_ORDER);
        presetDropdown.selection = 0;

        var applyRow = presetGroup.add("group");
        applyRow.orientation = "row";
        applyRow.alignChildren = ["fill", "center"];
        var applyBtn = applyRow.add("button", undefined, "Apply / Update");
        var rebuildBtn = applyRow.add("button", undefined, "Rebuild");

        var controlInfo = pal.add("panel", undefined, "Simple Controls");
        controlInfo.orientation = "column";
        controlInfo.alignChildren = ["left", "top"];
        controlInfo.margins = 10;
        controlInfo.add("statictext", undefined,
            "Effect Controls only exposes:\n" +
            "Amount • Bloom • Halation • Spread • Highlights • Halation Color",
            {multiline: true}
        );

        var toolsPanel = pal.add("panel", undefined, "Tools");
        toolsPanel.orientation = "column";
        toolsPanel.alignChildren = ["fill", "top"];
        toolsPanel.margins = 10;

        var toolsRow = toolsPanel.add("group");
        toolsRow.orientation = "row";
        toolsRow.alignChildren = ["fill", "center"];
        var bpcBtn = toolsRow.add("button", undefined, "Set Project 32 bpc");
        var removeBtn = toolsRow.add("button", undefined, "Remove");
        var diagBtn = toolsPanel.add("button", undefined, "Diagnostics");

        var help = pal.add("statictext", undefined,
            "Start with Subtle Film. If too much of the frame glows, raise Highlights.\n" +
            "v1.0 rigs are removed and rebuilt automatically. The three 'CB Engine' effects are Advanced.",
            {multiline: true}
        );
        help.maximumSize.height = 55;

        applyBtn.onClick = function() {
            var name = presetDropdown.selection ? presetDropdown.selection.text : "Subtle Film";
            applyToSelection(name, false);
        };

        rebuildBtn.onClick = function() {
            var name = presetDropdown.selection ? presetDropdown.selection.text : "Subtle Film";
            applyToSelection(name, true);
        };

        removeBtn.onClick = function() { removeFromSelection(); };
        bpcBtn.onClick = function() { set32BPC(); };
        diagBtn.onClick = function() { diagnostics(); };

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
