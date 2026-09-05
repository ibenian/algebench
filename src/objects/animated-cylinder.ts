import { state } from '/state.js';
import { parseColor, addLabel3D, renderKaTeX } from '/labels.js';
import type { Label3D } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import type { CompiledExpr } from '/expr.js';
import { _resolveCylinderDataEndpoints, _setCylinderTransformFromData } from '/objects/cylinder.js';
import type { Vec3 } from '/coords.js';
import type { Element } from '/types/lesson.js';
import type { MeshPhongMaterialParameters, Object3D, Scene } from 'three';

/** parseColor returns `number[]`; spreading into `new THREE.Color(...)` needs a tuple. */
type Rgb3 = [number, number, number];

/** A label whose text is driven by `labelExpr`, memoising its last rendered value. */
type DynamicLabel = Label3D & { _lastDynamicText?: string };

/** A live expression-driven element, as the scene loader's rebuild pass expects it. */
interface AnimExprEntry {
    exprStrings: string[];
    fromExprStrings: string[];
    radiusExprString: string | null;
    animState: { stopped: boolean };
    compiledFns: CompiledExpr[];
    fromExprFns: CompiledExpr[];
    radiusFn: CompiledExpr | null;
}

/** A per-frame updater, as the scene loader's animation loop expects it. */
interface AnimUpdater {
    animState: { stopped: boolean };
    updateFrame(nowMs: number): void;
}

/** The slice of the shared state object this module touches. */
interface AnimatedCylinderState {
    three: { scene: Scene };
    planeMeshes: Object3D[];
    activeAnimExprs: AnimExprEntry[];
    activeAnimUpdaters: AnimUpdater[];
    sceneStartTime: number;
}
const animatedCylinderState = state as unknown as AnimatedCylinderState;

export function renderAnimatedCylinder(el: Element, view: MathBoxNode) {
    const color = parseColor(el.color || '#88aaff') as Rgb3;
    // `opacity` is `number | string` on the schema; animated_cylinder reads the
    // numeric form only (there is no opacityExpr on this element).
    const opacity = (el.opacity !== undefined ? el.opacity : 0.35) as number;
    const radialSegments = el.radialSegments || 32;
    const openEnded = !!el.openEnded;
    const label = el.label;
    const labelExprString = (typeof el.labelExpr === 'string' && el.labelExpr.trim()) ? el.labelExpr.trim() : null;
    const radius = (typeof el.radius === 'number') ? el.radius : 1;
    const radiusExpr = (typeof el.radiusExpr === 'string')
        ? el.radiusExpr
        : (typeof el.radius === 'string' ? el.radius : null);

    const fromExpr: string[] | null = Array.isArray(el.fromExpr) && el.fromExpr.length === 3
        ? el.fromExpr
        : (Array.isArray(el.from) && el.from.length === 3 ? el.from.map(v => String(v)) : null);
    const toExpr: string[] | null = Array.isArray(el.expr) && el.expr.length === 3
        ? el.expr
        : (Array.isArray(el.toExpr) && el.toExpr.length === 3
            ? el.toExpr
            : (Array.isArray(el.to) && el.to.length === 3 ? el.to.map(v => String(v)) : null));
    if (!fromExpr || !toExpr) return null;

    let fromFns: CompiledExpr[], toFns: CompiledExpr[], radiusFn: CompiledExpr | null = null;
    try {
        fromFns = fromExpr.map(e => compileExpr(e));
        toFns = toExpr.map(e => compileExpr(e));
        if (radiusExpr) radiusFn = compileExpr(radiusExpr);
    } catch (err) {
        console.warn('animated_cylinder expr compile error:', err);
        return null;
    }

    function evalTriplet(fns: CompiledExpr[], tSec: number): Vec3 {
        return fns.map(fn => evalExpr(fn, tSec) as number) as Vec3;
    }

    let initFrom: Vec3, initTo: Vec3;
    try {
        initFrom = evalTriplet(fromFns, 0);
        initTo = evalTriplet(toFns, 0);
    } catch (err) {
        console.warn('animated_cylinder expr eval error:', err);
        return null;
    }

    const geom = new THREE.CylinderGeometry(1, 1, 1, radialSegments, 1, openEnded);
    const matType = (el.shader && el.shader.type === 'basic') ? THREE.MeshBasicMaterial : THREE.MeshPhongMaterial;
    const matOpts: MeshPhongMaterialParameters = {
        color: new THREE.Color(...color),
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide,
    };
    const sh = el.shader || {};
    if (sh.depthWrite !== undefined) matOpts.depthWrite = !!sh.depthWrite;
    if (sh.depthTest !== undefined) matOpts.depthTest = !!sh.depthTest;
    if (matType === THREE.MeshPhongMaterial) {
        matOpts.shininess = sh.shininess !== undefined ? sh.shininess : 40;
        if (sh.emissive) matOpts.emissive = new THREE.Color(sh.emissive);
        if (sh.specular) matOpts.specular = new THREE.Color(sh.specular);
        if (sh.flatShading) matOpts.flatShading = true;
    }
    const mat = new matType(matOpts);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.targetOpacity = opacity;
    let initRadius = radius;
    if (radiusFn) {
        try { initRadius = evalExpr(radiusFn, 0) as number; } catch (err) {}
    }
    _setCylinderTransformFromData(mesh, initFrom, initTo, initRadius);
    animatedCylinderState.three.scene.add(mesh);
    animatedCylinderState.planeMeshes.push(mesh);

    let labelExprFn: CompiledExpr | null = null;
    if (labelExprString) {
        try { labelExprFn = compileExpr(labelExprString); } catch (err) { console.warn('animated_cylinder labelExpr compile error:', err); }
    }

    let labelEl: DynamicLabel | null = null;
    if (label || labelExprFn) {
        const mid = [(initFrom[0] + initTo[0]) / 2, (initFrom[1] + initTo[1]) / 2, (initFrom[2] + initTo[2]) / 2];
        labelEl = addLabel3D(label || '', mid, color);
        if (labelExprFn) {
            try {
                const txt = String(evalExpr(labelExprFn, 0));
                labelEl.el.innerHTML = renderKaTeX(txt, false);
                // The label system measures a box ONCE and caches it, re-measuring
                // only when boxW is null or the scale changed (labels.ts). Text that
                // changes LENGTH therefore keeps a stale width -- and that width is
                // what declutter and overlap avoidance read. Drop the cache so the
                // next frame measures the text actually on screen.
                labelEl.boxW = null;
                labelEl._lastDynamicText = txt;
            } catch (_e) {}
        }
    }

    const animState = { stopped: false };
    const animExprEntry: AnimExprEntry = {
        exprStrings: toExpr,
        fromExprStrings: fromExpr,
        radiusExprString: radiusExpr || null,
        animState,
        compiledFns: toFns,
        fromExprFns: fromFns,
        radiusFn,
    };
    animatedCylinderState.activeAnimExprs.push(animExprEntry);

    const startTime = animatedCylinderState.sceneStartTime;
    animatedCylinderState.activeAnimUpdaters.push({
        animState,
        updateFrame(nowMs) {
            const tSec = (nowMs - startTime) / 1000;
            const curFromFns = animExprEntry.fromExprFns || fromFns;
            const curToFns = animExprEntry.compiledFns || toFns;
            const curRadiusFn = animExprEntry.radiusFn || radiusFn;
            let fromData = initFrom;
            let toData = initTo;
            let curRadius = radius;
            try {
                fromData = evalTriplet(curFromFns, tSec);
                toData = evalTriplet(curToFns, tSec);
                if (curRadiusFn) curRadius = evalExpr(curRadiusFn, tSec) as number;
            } catch (err) {
                // keep last transform
            }

            _setCylinderTransformFromData(mesh, fromData, toData, curRadius);
            if (labelEl) {
                labelEl.dataPos[0] = (fromData[0] + toData[0]) / 2;
                labelEl.dataPos[1] = (fromData[1] + toData[1]) / 2;
                labelEl.dataPos[2] = (fromData[2] + toData[2]) / 2;
                if (labelExprFn) {
                    try {
                        const txt = String(evalExpr(labelExprFn, tSec));
                        if (labelEl._lastDynamicText !== txt) {
                            labelEl.el.innerHTML = renderKaTeX(txt, false);
                            labelEl.boxW = null;
                            labelEl._lastDynamicText = txt;
                        }
                    } catch (_e) {}
                }
            }
        },
    });

    return { type: 'animated_cylinder', color, label, _animState: animState, _animExprEntry: animExprEntry };
}
