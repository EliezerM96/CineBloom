# CineBloom — Technical Handoff for Claude

## 1. Product goal

Build a cross-platform Adobe After Effects tool called **CineBloom** that can be installed as a ScriptUI panel and applied to essentially any layer that can receive effects (footage, precomp, shape, text, solid, etc.). It must run on both **macOS and Windows**.

The tool should provide a convincing, restrained approximation of **camera/film bloom and halation**, not a stylized neon glow. The user should be able to apply a preset and get a useful result immediately, while advanced users can still inspect/tune the native engine effects if needed.

### UX goal

A novice should not see a huge list of technical controls. The target is about **5–6 user-facing controls maximum**, ideally:

- Amount / Mix
- Bloom
- Halation
- Spread / Radius
- Highlights / Threshold
- Optional halation warmth/color only if truly necessary

Presets should be usable out of the box and should not destroy highlights or saturation.

### Portability goal

Prefer a setup based on native After Effects effects and Expression Controls so that the AEP continues to render even on a machine where the CineBloom panel itself is not installed.

Do not require third-party plugins.

## 2. Real-world behavior desired

This should not behave like a generic Outer Glow.

### Bloom

Approximate optical diffusion around very bright areas:

- mostly neutral/white energy
- concentrated around highlights
- a tighter core plus a very faint wide tail can be useful
- should not dramatically alter saturated midtones
- should not turn whites into giant clipped blobs

### Halation

Approximate film halation:

- generated mainly from very bright highlights
- warmer/red-orange contamination around highlights
- usually tighter and subtler than bloom
- should not create a giant magenta outline around saturated blue graphics
- ideally red channel dominates, some green, little/no blue

A physically perfect film simulation is not required, but the effect should feel optical rather than graphic.

## 3. Important delivery/color constraint

The first prototype could be made to look somewhat workable in a **32 bpc** project but rendered MP4/H.264 still showed blown highlights and exaggerated colors. Therefore:

- Do not assume that simply working in 32 bpc solves SDR delivery.
- The effect itself should be restrained enough that normal Rec.709 / SDR export does not depend on values far above display white.
- Presets should be judged on actual SDR-looking frames, not only on floating-point headroom.

The main stress-test frame is a graphic animation with:

- almost/pure white background
- very saturated electric/royal blue shapes
- white typography
- sharp high-contrast edges

This frame immediately exposes bad bloom/halation behavior.

## 4. User environment observed

- Adobe After Effects **2026**
- macOS during testing
- final script must still be Mac + Windows compatible
- ScriptUI panel installed under `Scripts/ScriptUI Panels`

## 5. Development history / changelog

### v1.0.0 — first working concept

Architecture:

- ScriptUI panel
- 4 sequential native Glow passes:
  - Bloom Core
  - Bloom Wide
  - Halation Core
  - Halation Wide
- ~16 visible Expression Controls, including:
  - master mix
  - bloom enable/amount/threshold/radius/spread/core balance
  - halation enable/amount/threshold/radius/spread/core balance
  - inner/outer colors
  - organic flicker/amount/speed

Observed result:

- It did visibly work.
- `Subtle Film` was far too strong.
- Whites and saturation were heavily pushed.
- On a blue/white animation it created huge blue/magenta halos.
- Even after getting a workable preview in 32 bpc, MP4 export still looked blown out.
- UI in Effect Controls was much too complicated for a novice.

Likely architectural weakness:

- Four Glow effects run sequentially on the same layer, so later passes can operate on results already modified by earlier passes instead of independent highlight extractions.
- This can create glow-on-glow feedback/energy buildup.

### v1.1.0 — intended simplification

Intended changes:

- reduce from 4 passes to 3:
  - Bloom Core
  - Bloom Wide
  - Halation
- reduce visible controls to 6
- remove flicker
- calmer presets
- attempted Screen-like optical philosophy / lower energy
- halation smaller than bloom
- resolution-aware radii

Important packaging/history note:

The file delivered to the user apparently still behaved/looked like v1.0. The Effect Controls screenshot still showed the full old 16-control rig and four passes. So there was a packaging/version mismatch or stale-engine problem in the delivered build.

### v1.1.1 — engine/name hotfix

- new JSX filename
- new `#targetengine`
- intended to avoid stale ScriptUI engine/version collision

Result:

- Apply/Rebuild appeared to do nothing.
- Diagnostics changed something because it created a temporary Glow.

### v1.1.2 — robust apply hotfix

Changes:

- explicit status line
- try/catch around Apply/Rebuild
- Diagnostics made read-only
- localization-resistant access attempts

Result:

- no meaningful visual change after Apply/Rebuild

### v1.2.0 — Color Channels fix attempt

Reasoning at the time:

- earlier code had apparently set `Glow Based On` to Alpha Channel via an assumed numeric enum.
- on full-frame footage/precomps with solid alpha, this could produce little useful highlight response.
- changed intent to Color Channels and recalibrated intensities upward.

Observed hard failure:

After Effects displayed:

> Expression failed on Halation Color A: Error: Expression Disabled. Error at line 1 in property 'Color Looping' ... expression result must be of dimension 1, not 4

This proved an internal Glow child-property index assumption was wrong. The script thought a property was Color A, but it was actually `Color Looping`, a scalar.

The layer was left with a partially created rig and a giant magenta halo.

### v1.2.1 — Color property / atomic cleanup attempt

Intended changes:

- stop blindly assuming Color A/B indices
- identify color properties by type where possible
- remove partial rig on failure

Observed result:

- user reported that it again did absolutely nothing, including Rebuild

### v1.3.0 — current “Safe Engine” rewrite

This is the current JSX being handed off.

Architecture:

- 5 visible controls:
  - `CB - Amount`
  - `CB - Bloom`
  - `CB - Halation`
  - `CB - Spread`
  - `CB - Highlights`
- 3 native Glow passes:
  - `CB Engine - Halation (Advanced)`
  - `CB Engine - Bloom Core (Advanced)`
  - `CB Engine - Bloom Wide (Advanced)`

Design rule:

- do NOT set `Glow Based On`
- do NOT set `Composite Original`
- do NOT set `Glow Operation`
- leave those popup/enums at native AE defaults
- only expression-drive numeric properties believed to be stable:
  - Threshold
  - Radius
  - Intensity

Current Glow match names in code:

```js
THRESHOLD: "ADBE Glo2-0002"
RADIUS: "ADBE Glo2-0003"
INTENSITY: "ADBE Glo2-0004"
COLORS: "ADBE Glo2-0007"
COLOR_A: "ADBE Glo2-0012"
COLOR_B: "ADBE Glo2-0013"
```

Current code still optionally sets `Glow Colors` to `2` and Color A/B values for halation. This is a remaining risk because `Glow Colors` is itself a popup/enum and the overall goal of v1.3 was to avoid brittle popup assumptions.

The current build has NOT yet been proven reliable in the user's AE 2026 environment.

## 6. Current v1.3.0 preset values

```text
Subtle Film      Amount 100  Bloom 24  Halation 7   Spread 90   Highlights 91
Clean Bloom      Amount 100  Bloom 30  Halation 2   Spread 78   Highlights 94
Soft Diffusion   Amount 100  Bloom 38  Halation 5   Spread 112  Highlights 87
Night Lights     Amount 100  Bloom 34  Halation 8   Spread 105  Highlights 94
Film Halation    Amount 100  Bloom 24  Halation 16  Spread 88   Highlights 92
Soft Commercial  Amount 100  Bloom 28  Halation 4   Spread 94   Highlights 90
```

Current expression mapping:

### Bloom Core

- threshold = Highlights
- radius = `14 * spread * resolutionScale`
- intensity = `0.80 * masterAmount * bloom`

### Bloom Wide

- threshold = Highlights + 2
- radius = `48 * spread * resolutionScale`
- intensity = `0.22 * masterAmount * bloom`

### Halation

- threshold = Highlights + 3
- radius = `7 * spread * resolutionScale`
- intensity = `0.42 * masterAmount * halation`

`resolutionScale = max(0.5, thisComp.width / 1920)`

## 7. Major technical concern with all same-layer Glow versions

Even if all match names and enums are fixed, sequential Glow effects on a single layer are **not independent optical passes**. Pass 2 sees pass 1's rendered result, and pass 3 sees the previous result.

Claude should explicitly evaluate whether this architecture can ever produce the desired predictable film-like behavior.

A more robust native-AE architecture may be:

- keep a single controller on the source layer or a dedicated controller/null
- generate independent helper layers or precomps for:
  - bloom core
  - bloom wide
  - halation
- each helper should derive from the original source before other CineBloom passes
- composite helpers back over/around the original with carefully chosen blending
- mark generated helper layers as shy/locked/clearly named to keep the comp clean
- keep the whole setup removable/rebuildable from one script

However, portability and performance should be considered.

## 8. What Claude should do FIRST — before rewriting effects

Do **not** guess Glow child indices, popup enum values, or localized display names again.

First create a tiny diagnostic ExtendScript specifically for the user's After Effects 2026 install that:

1. Adds one native `ADBE Glo2` Glow to a selected disposable layer.
2. Iterates through every child property of the Glow.
3. Reports for each child:
   - propertyIndex
   - `name`
   - `matchName`
   - `propertyValueType`
   - current `value` when readable
   - `minValue` / `maxValue` where available
   - whether `canSetExpression`
   - whether it is a popup/menu, color, scalar, etc. where discoverable
4. Does not modify any other properties.
5. Either removes the temporary Glow afterward or creates it only on an explicitly disposable test layer.

The point is to build an **observed property map from the actual AE 2026 runtime**, not another assumed map.

If Claude has access to current Adobe scripting documentation or web research, verify every match name/API assumption against documentation as well.

## 9. Debugging philosophy requested

Please do not keep issuing blind hotfixes.

For each change:

- identify the actual failing API/property first
- add runtime diagnostics
- make errors visible
- if build fails halfway, rollback the partial CineBloom rig
- preserve user layer state wherever possible
- use one undo group
- never let Diagnostics leave permanent effects behind

Test the smallest possible engine before rebuilding the full panel.

Suggested staged test:

### Stage A
One button adds exactly one native Glow and sets only Threshold, Radius and Intensity to literal numeric values. No expressions, no colors, no popup properties.

Verify visible result.

### Stage B
Connect those three properties to three simple Slider Controls through expressions.

Verify expressions report no `expressionError`.

### Stage C
Build two independent bloom passes.

Verify highlight behavior on blue/white stress-test.

### Stage D
Add halation separately.

Do not expose or automate color until the actual Glow property map is verified.

### Stage E
Only after rendering is correct, build presets and polished ScriptUI.

## 10. Requirements for final tool

### Functional

- macOS + Windows
- After Effects 2026 at minimum; ideally backwards-compatible where practical
- apply to footage, precomps, text, shapes, solids and other effect-capable layers
- multi-layer selection support
- Apply/Update
- Rebuild
- Remove
- one-click 32 bpc helper is acceptable but should not be required for basic correctness
- diagnostics must be read-only
- project remains usable if script panel is not installed later

### UI

Keep beginner-facing Effect Controls extremely simple.

Target:

1. Amount
2. Bloom
3. Halation
4. Spread
5. Highlights

Potential sixth control only if strongly justified.

Advanced implementation effects may remain underneath with `(Advanced)` in their names, or preferably live on generated hidden/shy helper layers.

### Preset philosophy

Presets should describe optical behavior rather than exaggerated social-media effects.

Keep these general categories if useful:

- Subtle Film — default, extremely safe
- Clean Bloom — little/no halation
- Soft Diffusion — more bloom, still controlled
- Night Lights — selective high threshold
- Film Halation — more warm halation but still physically believable
- Soft Commercial — clean premium diffusion

`Subtle Film` is the most important preset. It must be safe on pure white + saturated blue graphics.

## 11. Visual acceptance criteria

On the blue/white stress-test animation:

### Acceptable

- white remains visually white and does not become a giant clipped field
- blue remains recognizably the same blue
- a soft neutral bloom can appear around the brightest white areas
- halation is a thin/subtle warm contamination near strong highlights
- no giant pink/magenta outer-glow silhouette around blue shapes
- effect can be reduced smoothly with Amount/Bloom/Halation

### Unacceptable

- saturated blue expands into a large neon aura
- entire white background gains obvious glow
- magenta ring around the silhouette
- highlights visibly clip much harder after MP4/H.264 export
- applying a preset produces no visible result
- Rebuild silently fails
- Diagnostics modifies the artwork
- dozens of controls are exposed to novice users

## 12. Suggested architectural direction if native Glow remains unreliable

If `ADBE Glo2` is too brittle or sequential same-layer Glow remains visually wrong, consider a generated native-layer rig instead of forcing everything into three sequential Glows.

For example, conceptually:

### Bloom path

Original source -> highlight extraction -> neutral blur core -> neutral blur wide -> restrained composite

### Halation path

Original source -> strong highlight extraction -> red-biased channel treatment -> small blur/spread -> composite subtly around/behind source

Use only well-documented native effects with verified match names. A small number of generated shy helper layers is preferable to an unreliable one-layer rig.

Do not build a compiled C++ `.aex` unless the script/native approach proves incapable of the requested result; cross-platform compilation and distribution would significantly increase complexity.

## 13. Current file

The current source file is:

`CineBloom_1.3.0.jsx`

Please audit the current implementation before editing it. Pay particular attention to:

- `propByMatchName()` fallbacks to raw indices
- `configureHalationColor()` setting `Glow Colors = 2`
- whether `ADBE Glo2-0012/0013` are actually Color A/B in AE 2026
- whether Threshold/Radius/Intensity match names and units are correct
- whether sequential same-layer passes are producing feedback
- whether the expression scale/ranges make sense in 1080p/4K
- whether 32-bpc and SDR export behavior is being conflated
- whether removal/rebuild detects all legacy prefixes safely

## 14. Working style requested from Claude

Please act like a senior After Effects scripting/plugin engineer reviewing an unstable prototype.

Before producing a final rewritten JSX:

1. explain the likely root causes in the existing code
2. distinguish confirmed bugs from hypotheses
3. propose the smallest diagnostic test needed to confirm unknown AE behavior
4. avoid undocumented enum assumptions
5. then produce the next testable build

The next build should prioritize **correctness and observability over features**. A one-pass bloom that definitely works is more valuable than a beautiful panel hiding another brittle engine.
