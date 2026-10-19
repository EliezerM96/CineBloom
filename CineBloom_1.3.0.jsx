#target aftereffects
#targetengine "CineBloomEngine_v130"

/*
    CineBloom v1.3.0 — Safe Engine
    Cross-platform After Effects ScriptUI panel (macOS + Windows)

    Design goals:
    - Stop relying on undocumented Glow enum values for Based On / Composite / Operation.
    - Use AE's native Glow defaults for those settings.
    - Only drive the stable Glow numeric properties: Threshold, Radius, Intensity.
    - Halation color is configured statically through the documented Glow Color A/B slots.
    - If halation color configuration is unavailable, bloom still builds and works.
    - Five user-facing controls only.
*/

(function CineBloom(thisObj) {
    var SCRIPT_NAME = "CineBloom";
    var VERSION = "1.3.0";
    var PREFIX = "CB - ";
    var ENGINE_PREFIX = "CB Engine - ";
    var LEGACY_PREFIX = "CB [";

    var MN = {
        EFFECTS: "ADBE Effect Parade",
        SLIDER: "ADBE Slider Control",
        GLOW: "ADBE Glo2"
    };

    // Native Glow child match names. These are stable in exported AE effect data.
    var GM = {
        THRESHOLD: "ADBE Glo2-0002",
        RADIUS: "ADBE Glo2-0003",
        INTENSITY: "ADBE Glo2-0004",
        COLORS: "ADBE Glo2-0007",
        COLOR_A: "ADBE Glo2-0012",
        COLOR_B: "ADBE Glo2-0013"
    };

    var CTRL = {
        AMOUNT: PREFIX + "Amount",
        BLOOM: PREFIX + "Bloom",
        HALATION: PREFIX + "Halation",
        SPREAD: PREFIX + "Spread",
        HIGHLIGHTS: PREFIX + "Highlights"
    };

    var PASS = {
        HALATION: ENGINE_PREFIX + "Halation (Advanced)",
        BLOOM_CORE: ENGINE_PREFIX + "Bloom Core (Advanced)",
        BLOOM_WIDE: ENGINE_PREFIX + "Bloom Wide (Advanced)"
    };

    var PRESET_ORDER = [
        "Subtle Film",
        "Clean Bloom",
        "Soft Diffusion",
        "Night Lights",
        "Film Halation",
        "Soft Commercial"
    ];

    // Calibrated intentionally low so whites survive SDR delivery better.
    var PRESETS = {
        "Subtle Film":     {amount:100, bloom:24, halation:7,  spread:90,  highlights:91},
        "Clean Bloom":     {amount:100, bloom:30, halation:2,  spread:78,  highlights:94},
        "Soft Diffusion":  {amount:100, bloom:38, halation:5,  spread:112, highlights:87},
        "Night Lights":    {amount:100, bloom:34, halation:8,  spread:105, highlights:94},
        "Film Halation":   {amount:100, bloom:24, halation:16, spread:88,  highlights:92},
        "Soft Commercial": {amount:100, bloom:28, halation:4,  spread:94,  highlights:90}
    };

    var statusLabel = null;

    function setStatus(s) {
        try {
            if (statusLabel) {
                statusLabel.text = "Status: " + s;
                statusLabel.parent.layout.layout(true);
            }
        } catch (e) {}
    }

    function errText(e) {
        var s = "Unknown error";
        try { s = e.toString(); } catch (x) {}
        try { if (e.line) s += " (line " + e.line + ")"; } catch (y) {}
        return s;
    }

    function activeComp() {
        var item = app.project ? app.project.activeItem : null;
        return (item && item instanceof CompItem) ? item : null;
    }

    function effects(layer) {
        try { return layer.property(MN.EFFECTS); } catch (e) { return null; }
    }

    function canReceiveEffects(layer) {
        var fx = effects(layer);
        if (!fx) return false;
        try { return fx.canAddProperty(MN.SLIDER) && fx.canAddProperty(MN.GLOW); }
        catch (e) { return false; }
    }

    function findEffect(layer, name) {
        var fx = effects(layer);
        if (!fx) return null;
        var i, p;
        for (i = 1; i <= fx.numProperties; i++) {
            p = fx.property(i);
            if (!p) continue;
            try { if (p.name === name) return p; } catch (e) {}
        }
        return null;
    }

    function removeRig(layer) {
        var fx = effects(layer);
        if (!fx) return 0;
        var removed = 0, i, p, n;
        for (i = fx.numProperties; i >= 1; i--) {
            p = fx.property(i);
            if (!p) continue;
            try { n = p.name; } catch (e) { n = ""; }
            if (n.indexOf(PREFIX) === 0 || n.indexOf(ENGINE_PREFIX) === 0 || n.indexOf(LEGACY_PREFIX) === 0) {
                try { p.remove(); removed++; } catch (e2) {}
            }
        }
        return removed;
    }

    function addEffect(layer, matchName, displayName) {
        var fx = effects(layer);
        if (!fx) throw new Error("Selected layer cannot receive effects.");
        if (!fx.canAddProperty(matchName)) throw new Error("After Effects cannot add required effect: " + matchName);
        var p = fx.addProperty(matchName);
        if (!p) throw new Error("After Effects did not return the added effect: " + matchName);
        var idx = p.propertyIndex;
        p = effects(layer).property(idx);
        p.name = displayName;
        return p;
    }

    function addSlider(layer, name, value) {
        var e = addEffect(layer, MN.SLIDER, name);
        var p = e.property(1);
        if (!p) throw new Error("Slider value property missing: " + name);
        p.setValue(value);
        return e;
    }

    function setSlider(layer, name, value) {
        var e = findEffect(layer, name);
        if (!e) return false;
        try { e.property(1).setValue(value); return true; } catch (x) { return false; }
    }

    function propByMatchName(effect, matchName, fallbackIndex) {
        if (!effect) return null;
        var i, p, mn;
        for (i = 1; i <= effect.numProperties; i++) {
            p = effect.property(i);
            try { mn = p.matchName; } catch (e) { mn = ""; }
            if (mn === matchName) return p;
        }
        try { return effect.property(fallbackIndex); } catch (x) { return null; }
    }

    function exprSlider(name) {
        return 'effect("' + name + '")(1)';
    }

    function setExpression(prop, expressionText, label) {
        if (!prop) throw new Error("Missing native Glow property: " + label);
        try {
            prop.expression = expressionText;
            prop.expressionEnabled = true;
        } catch (e) {
            throw new Error("Could not connect " + label + ": " + errText(e));
        }
        // Do not abort on the expressionError getter itself; only abort when AE reports text.
        try {
            var ee = prop.expressionError;
            if (ee && ee.length > 0) throw new Error(label + " expression: " + ee);
        } catch (e2) {
            if (String(e2).indexOf("expression:") >= 0) throw e2;
        }
    }

    function configureNumericGlow(layer, effectName, kind) {
        var glow = findEffect(layer, effectName);
        if (!glow) throw new Error("Missing engine pass: " + effectName);

        var pThreshold = propByMatchName(glow, GM.THRESHOLD, 2);
        var pRadius = propByMatchName(glow, GM.RADIUS, 3);
        var pIntensity = propByMatchName(glow, GM.INTENSITY, 4);

        var amount = "Math.max(0,Math.min(1," + exprSlider(CTRL.AMOUNT) + "/100))";
        var bloom = "Math.max(0,Math.min(1," + exprSlider(CTRL.BLOOM) + "/100))";
        var hal = "Math.max(0,Math.min(1," + exprSlider(CTRL.HALATION) + "/100))";
        var spread = "Math.max(0,Math.min(2.5," + exprSlider(CTRL.SPREAD) + "/100))";
        var hi = "Math.max(0,Math.min(100," + exprSlider(CTRL.HIGHLIGHTS) + "))";
        var scale = "Math.max(0.5,thisComp.width/1920)";

        if (kind === "core") {
            setExpression(pThreshold, hi, "Bloom Core Threshold");
            setExpression(pRadius, "Math.max(0,14*" + spread + "*" + scale + ")", "Bloom Core Radius");
            setExpression(pIntensity, "Math.max(0,0.80*" + amount + "*" + bloom + ")", "Bloom Core Intensity");
        } else if (kind === "wide") {
            setExpression(pThreshold, "Math.min(100," + hi + "+2)", "Bloom Wide Threshold");
            setExpression(pRadius, "Math.max(0,48*" + spread + "*" + scale + ")", "Bloom Wide Radius");
            setExpression(pIntensity, "Math.max(0,0.22*" + amount + "*" + bloom + ")", "Bloom Wide Intensity");
        } else {
            setExpression(pThreshold, "Math.min(100," + hi + "+3)", "Halation Threshold");
            setExpression(pRadius, "Math.max(0,7*" + spread + "*" + scale + ")", "Halation Radius");
            setExpression(pIntensity, "Math.max(0,0.42*" + amount + "*" + hal + ")", "Halation Intensity");
        }
    }

    // Optional halation color configuration. Failure here never destroys bloom.
    function configureHalationColor(layer) {
        var glow = findEffect(layer, PASS.HALATION);
        if (!glow) return "halation pass missing";

        var pColors = propByMatchName(glow, GM.COLORS, 7);
        var pA = propByMatchName(glow, GM.COLOR_A, 12);
        var pB = propByMatchName(glow, GM.COLOR_B, 13);

        try {
            // Glow Colors: 1 = Original Colors, 2 = A & B Colors in native Glow.
            if (pColors) pColors.setValue(2);
            // Warm, restrained film-like response. Static by design for reliability.
            if (pA) pA.setValue([1.0, 0.16, 0.035, 1.0]);
            if (pB) pB.setValue([1.0, 0.34, 0.075, 1.0]);
            return null;
        } catch (e) {
            // Fall back to native Original Colors and keep the rig usable.
            try { if (pColors) pColors.setValue(1); } catch (ignore) {}
            return errText(e);
        }
    }

    function buildRig(layer, presetName) {
        var preset = PRESETS[presetName] || PRESETS["Subtle Film"];
        removeRig(layer);

        // Controllers first: deliberately only five visible controls.
        addSlider(layer, CTRL.AMOUNT, preset.amount);
        addSlider(layer, CTRL.BLOOM, preset.bloom);
        addSlider(layer, CTRL.HALATION, preset.halation);
        addSlider(layer, CTRL.SPREAD, preset.spread);
        addSlider(layer, CTRL.HIGHLIGHTS, preset.highlights);

        // IMPORTANT: leave Glow Based On / Composite Original / Glow Operation at AE defaults.
        // v1.2.x broke compatibility by trying to script undocumented popup enums.
        addEffect(layer, MN.GLOW, PASS.HALATION);
        addEffect(layer, MN.GLOW, PASS.BLOOM_CORE);
        addEffect(layer, MN.GLOW, PASS.BLOOM_WIDE);

        configureNumericGlow(layer, PASS.HALATION, "halation");
        configureNumericGlow(layer, PASS.BLOOM_CORE, "core");
        configureNumericGlow(layer, PASS.BLOOM_WIDE, "wide");

        return configureHalationColor(layer);
    }

    function hasRig(layer) {
        return findEffect(layer, CTRL.AMOUNT) !== null && findEffect(layer, PASS.BLOOM_CORE) !== null;
    }

    function updateRig(layer, presetName) {
        var p = PRESETS[presetName] || PRESETS["Subtle Film"];
        setSlider(layer, CTRL.AMOUNT, p.amount);
        setSlider(layer, CTRL.BLOOM, p.bloom);
        setSlider(layer, CTRL.HALATION, p.halation);
        setSlider(layer, CTRL.SPREAD, p.spread);
        setSlider(layer, CTRL.HIGHLIGHTS, p.highlights);
        configureNumericGlow(layer, PASS.HALATION, "halation");
        configureNumericGlow(layer, PASS.BLOOM_CORE, "core");
        configureNumericGlow(layer, PASS.BLOOM_WIDE, "wide");
        return configureHalationColor(layer);
    }

    function selectedLayers() {
        var comp = activeComp();
        var out = [];
        if (!comp) return out;
        var s = comp.selectedLayers, i;
        for (i = 0; i < s.length; i++) if (canReceiveEffects(s[i])) out.push(s[i]);
        return out;
    }

    function applySelection(presetName, rebuild) {
        var comp = activeComp();
        if (!comp) throw new Error("Open a composition first.");
        var layers = selectedLayers();
        if (layers.length === 0) throw new Error("Select at least one layer that can receive effects.");

        var ok = 0, warnings = [], errors = [], i, layer, warning;
        app.beginUndoGroup(SCRIPT_NAME + " " + (rebuild ? "Rebuild" : "Apply"));
        try {
            for (i = 0; i < layers.length; i++) {
                layer = layers[i];
                try {
                    if (rebuild || !hasRig(layer)) warning = buildRig(layer, presetName);
                    else warning = updateRig(layer, presetName);
                    ok++;
                    if (warning) warnings.push(layer.name + ": halation color fallback — " + warning);
                } catch (e) {
                    // Do not silently remove a successfully-created bloom rig just because an optional step failed.
                    errors.push(layer.name + ": " + errText(e));
                }
            }
        } finally {
            app.endUndoGroup();
        }

        if (errors.length) throw new Error("Built " + ok + " layer(s); " + errors.length + " failed:\n" + errors.join("\n"));
        return {count:ok, warnings:warnings};
    }

    function removeSelection() {
        var layers = selectedLayers();
        if (!layers.length) throw new Error("Select at least one layer that can receive effects.");
        var n = 0, i;
        app.beginUndoGroup(SCRIPT_NAME + " Remove");
        try { for (i = 0; i < layers.length; i++) n += removeRig(layers[i]); }
        finally { app.endUndoGroup(); }
        return n;
    }

    function set32() {
        if (!app.project) throw new Error("No project is open.");
        app.beginUndoGroup(SCRIPT_NAME + " 32 bpc");
        try { app.project.bitsPerChannel = 32; } finally { app.endUndoGroup(); }
    }

    function diagnostics() {
        var lines = [];
        lines.push("CineBloom v" + VERSION + " — SAFE ENGINE");
        lines.push("After Effects: " + app.version);
        lines.push("OS: " + $.os);
        lines.push("Project BPC: " + (app.project ? app.project.bitsPerChannel : "none"));
        var comp = activeComp();
        lines.push("Active comp: " + (comp ? comp.name : "none"));
        if (!comp) { alert(lines.join("\n"), "CineBloom Diagnostics"); return; }
        lines.push("Selected layers: " + comp.selectedLayers.length);
        var layers = selectedLayers();
        lines.push("Usable selected layers: " + layers.length);
        if (layers.length) {
            var l = layers[0], fx = effects(l), g = findEffect(l, PASS.BLOOM_CORE);
            lines.push("First layer: " + l.name);
            lines.push("Rig present: " + (hasRig(l) ? "YES" : "NO"));
            lines.push("Effects on layer: " + fx.numProperties);
            if (g) {
                var t = propByMatchName(g, GM.THRESHOLD, 2);
                var r = propByMatchName(g, GM.RADIUS, 3);
                var it = propByMatchName(g, GM.INTENSITY, 4);
                try { lines.push("Core threshold: " + t.value); } catch (e1) {}
                try { lines.push("Core radius: " + r.value); } catch (e2) {}
                try { lines.push("Core intensity: " + it.value); } catch (e3) {}
                try { lines.push("Threshold expr error: " + (t.expressionError || "none")); } catch (e4) {}
                try { lines.push("Radius expr error: " + (r.expressionError || "none")); } catch (e5) {}
                try { lines.push("Intensity expr error: " + (it.expressionError || "none")); } catch (e6) {}
            }
        }
        lines.push("");
        lines.push("v1.3 does not alter Glow Based On, Composite Original, or Glow Operation.");
        alert(lines.join("\n"), "CineBloom Diagnostics");
    }

    function presetName(dropdown) {
        try {
            if (dropdown.selection && dropdown.selection.index >= 0) return PRESET_ORDER[dropdown.selection.index];
        } catch (e) {}
        return PRESET_ORDER[0];
    }

    function safe(label, fn) {
        setStatus(label + "...");
        try {
            var result = fn();
            if (result && result.count !== undefined) {
                var msg = label + " OK — " + result.count + " layer(s)";
                if (result.warnings && result.warnings.length) msg += " — halation fallback";
                setStatus(msg);
                if (result.warnings && result.warnings.length) alert(result.warnings.join("\n"), SCRIPT_NAME + " warning");
            } else {
                setStatus(label + " OK" + (result !== undefined ? " — " + result : ""));
            }
        } catch (e) {
            var msg2 = errText(e);
            setStatus("ERROR — " + msg2);
            alert(msg2, SCRIPT_NAME + " v" + VERSION);
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
        pal.add("statictext", undefined, "v1.3.0 • SAFE ENGINE • default-Glow compatible");

        var look = pal.add("panel", undefined, "Look");
        look.orientation = "column";
        look.alignChildren = ["fill", "top"];
        look.margins = 10;
        var dd = look.add("dropdownlist", undefined, PRESET_ORDER);
        dd.selection = 0;
        var row = look.add("group");
        row.orientation = "row";
        var applyBtn = row.add("button", undefined, "Apply / Update");
        var rebuildBtn = row.add("button", undefined, "Rebuild");

        var info = pal.add("panel", undefined, "Effect Controls");
        info.orientation = "column";
        info.alignChildren = ["left", "top"];
        info.margins = 10;
        info.add("statictext", undefined, "Amount • Bloom • Halation • Spread • Highlights", {multiline:true});

        var tools = pal.add("panel", undefined, "Tools");
        tools.orientation = "column";
        tools.alignChildren = ["fill", "top"];
        tools.margins = 10;
        var tr = tools.add("group");
        tr.orientation = "row";
        var bpc = tr.add("button", undefined, "Set 32 bpc");
        var remove = tr.add("button", undefined, "Remove");
        var diag = tools.add("button", undefined, "Diagnostics (read-only)");

        statusLabel = pal.add("statictext", undefined, "Status: ready");

        applyBtn.onClick = function() { safe("Apply", function() { return applySelection(presetName(dd), false); }); };
        rebuildBtn.onClick = function() { safe("Rebuild", function() { return applySelection(presetName(dd), true); }); };
        remove.onClick = function() { safe("Remove", function() { return removeSelection() + " effect(s) removed"; }); };
        bpc.onClick = function() { safe("32 bpc", function() { set32(); return "project set to 32 bpc"; }); };
        diag.onClick = function() { safe("Diagnostics", function() { diagnostics(); return "completed"; }); };

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
