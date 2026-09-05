import { state } from '/state.js';
import { parseColor, addLabel3D, renderKaTeX } from '/labels.js';
import type { Label3D } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import type { CompiledExpr } from '/expr.js';
import { dataToWorld } from '/coords.js';
import type { Vec3 } from '/coords.js';
import { resolveLineWidth,
    resolveArrowSizeScale, resolveSmallVectorAutoScale,
    ARROW_HEAD_MIN_FACTOR, ARROW_HEAD_MAX_FACTOR, ARROW_HEAD_RADIUS_RATIO,
    SHAFT_RADIUS_TO_HEAD_RADIUS_RATIO, SHAFT_CONE_OVERLAP_HEAD_RATIO,
} from '/camera.js';
import type { Element } from '/types/lesson.js';
import type { Material, Mesh, Vector3, Scene } from 'three';

/** parseColor returns `number[]`; spreading into `new THREE.Color(...)` needs a tuple. */
type Rgb3 = [number, number, number];

/** A label whose text is driven by `labelExpr`, memoising its last rendered value. */
type DynamicLabel = Label3D & { _lastDynamicText?: string };

/** Meshes the step system hides carry this flag; the updater skips them. */
type RemovableMesh = Mesh<import('three').BufferGeometry, Material> & { _hiddenByRemove?: boolean };

/** One keyframe of the non-expression animation form. */
interface VectorKeyframe {
    origin?: Vec3;
    from?: Vec3;
    to?: Vec3;
}

/** One registered arrow mesh, as camera.js's arrow manager expects it. */
interface ArrowMeshEntry {
    mesh: Mesh;
    tipWorld: Vector3;
    dir: Vector3;
    wLen: number;
    isShaft?: boolean;
    owner?: object;
}

/** A registered line, as camera.js's width/opacity manager expects it. */
interface LineEntry {
    node: MathBoxNode | null;
    baseWidth: number;
    baseOpacity: number;
    widthParam: string;
    anchorDataPosFn: () => number[];
}

/** A live expression-driven element, as the scene loader's rebuild pass expects it. */
interface AnimExprEntry {
    exprStrings: string[] | null;
    fromExprStrings: string[] | undefined;
    visibleExprString: string | null;
    animState: { stopped: boolean } | null;
    compiledFns: CompiledExpr[] | null;
    fromExprFns: CompiledExpr[] | null;
    visibleFn: CompiledExpr | null;
}

/** A per-frame updater, as the scene loader's animation loop expects it. */
interface AnimUpdater {
    animState: { stopped: boolean };
    updateFrame(nowMs: number): void;
}

/** The slice of the shared state object this module touches. */
interface AnimatedVectorState {
    currentScale: Vec3;
    displayParams: { arrowScale: number; vectorWidth: number; lineOpacity: number };
    three: { scene: Scene };
    arrowMeshes: ArrowMeshEntry[];
    lineNodes: LineEntry[];
    activeAnimExprs: AnimExprEntry[];
    activeAnimUpdaters: AnimUpdater[];
    animatedElementPos: Record<string, { pos: number[]; from: number[]; to: number[]; startTime: number; time: number }>;
    sceneStartTime: number;
}
const animatedVectorState = state as unknown as AnimatedVectorState;

export function renderAnimatedVector(el: Element, view: MathBoxNode) {
    // Identity token tying every arrow mesh this element ever creates back to
    // this render. Meshes can be created LAZILY by the anim updater (a vector
    // that starts at zero length has no mesh at render time), so step trackers
    // can't rely on their creation-time snapshot — they sweep by owner instead.
    const ownerToken = {};
    const color = parseColor(el.color || '#ff8844') as Rgb3;
    const shader = el.shader || {};
    const emissive = parseColor(shader.emissive || '#000000') as Rgb3;
    const specular = parseColor(shader.specular || '#111111') as Rgb3;
    const shininess = (typeof shader.shininess === 'number' && isFinite(shader.shininess))
        ? shader.shininess
        : 60;
    const label = el.label;
    const elementOpacity = (typeof el.opacity === 'number' && isFinite(el.opacity))
        ? Math.max(0, Math.min(1, el.opacity))
        : 1;
    const depthWrite = shader.depthWrite !== undefined ? !!shader.depthWrite : elementOpacity >= 0.999;
    const depthTest = shader.depthTest !== undefined ? !!shader.depthTest : true;
    const renderOrder = (typeof el.renderOrder === 'number' && isFinite(el.renderOrder))
        ? el.renderOrder
        : null;
    const labelOffset = (Array.isArray(el.labelOffset) && el.labelOffset.length === 3)
        ? [Number(el.labelOffset[0]) || 0, Number(el.labelOffset[1]) || 0, Number(el.labelOffset[2]) || 0]
        : [0, 0.3, 0];
    const keyframes = (el.keyframes || []) as VectorKeyframe[];
    const duration = (el.duration as number | undefined) || 2000;
    const loop = el.loop !== false;
    const exprStrings = (el.expr || el.toExpr
        || (Array.isArray(el.to) && el.to.length === 3 ? el.to.map(v => String(v)) : null)) as string[] | null;
    const fromExprStrings = el.fromExpr as string[] | undefined;
    const visibleExprString = (typeof el.visibleExpr === 'string' && el.visibleExpr.trim()) ? el.visibleExpr.trim() : null;
    const labelExprString = (typeof el.labelExpr === 'string' && el.labelExpr.trim()) ? el.labelExpr.trim() : null;
    const trailOpts = el.trail;
    const panelOpts = (el.panels && typeof el.panels === 'object') ? el.panels : null;
    const hasExplicitWidth = (typeof el.width === 'number' && isFinite(el.width));
    const widthScale = hasExplicitWidth ? Math.max(0.01, el.width!) : 1.3;
    const widthHeadScale = Math.max(0.4, Math.sqrt(widthScale));
    const localArrowScale = ((el.arrowScale !== undefined ? el.arrowScale : 1)) * widthHeadScale;
    const localArrowMinFactor = (el.arrowMinFactor !== undefined ? el.arrowMinFactor : ARROW_HEAD_MIN_FACTOR) as number;
    const localArrowMaxFactor = (el.arrowMaxFactor !== undefined ? el.arrowMaxFactor : ARROW_HEAD_MAX_FACTOR) as number;
    const defaultAnimatedShaftMul = 1;
    const shaftBaseScale = (typeof el.shaftScale === 'number' && isFinite(el.shaftScale))
        ? Math.max(0.01, widthScale * el.shaftScale)
        : (widthScale * defaultAnimatedShaftMul);

    const useExpr = Array.isArray(exprStrings) && exprStrings.length === 3;
    const useFromExpr = Array.isArray(fromExprStrings) && fromExprStrings.length === 3;
    if (!useExpr && keyframes.length === 0) return null;

    // `!` not `?.`: guarded by the `keyframes.length` checks, exactly as before.
    const initFrom = (el.origin || el.from || (keyframes.length > 0 ? (keyframes[0]!.origin || keyframes[0]!.from || [0,0,0]) : [0,0,0])) as Vec3;
    let initTo: Vec3;
    if (useExpr) {
        try {
            initTo = exprStrings!.map(e => evalExpr(compileExpr(e), 0) as number) as Vec3;
        } catch (err) {
            console.warn('animated_vector expr eval error:', err);
            initTo = [1, 0, 0];
        }
    } else {
        initTo = (keyframes[0]!.to || [1, 0, 0]) as Vec3;
    }
    if (useFromExpr) {
        try {
            const evalFrom = fromExprStrings!.map(e => evalExpr(compileExpr(e), 0) as number);
            initFrom[0] = evalFrom[0]!; initFrom[1] = evalFrom[1]!; initFrom[2] = evalFrom[2]!;
        } catch (err) {
            console.warn('animated_vector fromExpr eval error:', err);
        }
    }

    const vecScale = (typeof el.scale === 'number' && isFinite(el.scale)) ? el.scale : 1;

    let currentFrom = initFrom.slice() as Vec3;
    let currentTo = initTo.slice() as Vec3;

    function applyVecScale(from: Vec3, to: Vec3): Vec3 {
        if (vecScale === 1) return to;
        return [
            from[0] + (to[0] - from[0]) * vecScale,
            from[1] + (to[1] - from[1]) * vecScale,
            from[2] + (to[2] - from[2]) * vecScale,
        ];
    }

    function computeArrowParams(from: Vec3, to: Vec3) {
        to = applyVecScale(from, to);
        const tipWorld = dataToWorld(to);
        const fromWorld = dataToWorld(from);
        const wdx = tipWorld[0]-fromWorld[0], wdy = tipWorld[1]-fromWorld[1], wdz = tipWorld[2]-fromWorld[2];
        const wLen = Math.sqrt(wdx*wdx + wdy*wdy + wdz*wdz);
        const currentScale = animatedVectorState.currentScale;
        const worldSceneSize = Math.min(currentScale[0], currentScale[1]) * 2;
        const effectiveArrowScale = resolveArrowSizeScale(localArrowScale * (animatedVectorState.displayParams.arrowScale || 1));
        const baseHeadLen = Math.max(Math.min(wLen * 0.25, worldSceneSize * localArrowMaxFactor), worldSceneSize * localArrowMinFactor) * effectiveArrowScale;
        const autoScale = resolveSmallVectorAutoScale(wLen, baseHeadLen);
        const wHeadLen = baseHeadLen * autoScale;
        const wHeadRadius = wHeadLen * ARROW_HEAD_RADIUS_RATIO;
        const overlapLen = Math.max(wHeadLen * SHAFT_CONE_OVERLAP_HEAD_RATIO, 0.0);
        const shaftLen = Math.max(wLen - wHeadLen + overlapLen, 0.0001);
        const shaftRadius = wHeadRadius * SHAFT_RADIUS_TO_HEAD_RADIUS_RATIO;
        const dir = wLen < 0.0001 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(wdx/wLen, wdy/wLen, wdz/wLen);
        return { tipWorld, fromWorld, wLen, wHeadLen, wHeadRadius, shaftLen, shaftRadius, dir, autoScale };
    }

    function computeShaftThicknessMul(autoScale: number) {
        const base = (shaftBaseScale || 1) * (animatedVectorState.displayParams.vectorWidth || 1) * (autoScale || 1);
        return Math.max(0.01, base);
    }

    function createCone(from: Vec3, to: Vec3): RemovableMesh | null {
        const { tipWorld, wLen, wHeadLen, wHeadRadius, dir } = computeArrowParams(from, to);
        if (wLen < 0.0001) return null;

        const geom = new THREE.ConeGeometry(1, 1, 16);
        const mat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(...color),
            emissive: new THREE.Color(...emissive),
            specular: new THREE.Color(...specular),
            shininess,
            transparent: elementOpacity < 0.999,
            opacity: elementOpacity,
            depthWrite,
            depthTest,
        });
        const cone = new THREE.Mesh(geom, mat);
        cone.userData.baseOpacity = elementOpacity;
        cone.userData.dynamicVector = true;
        if (renderOrder !== null) cone.renderOrder = renderOrder;
        cone.scale.set(wHeadRadius, wHeadLen, wHeadRadius);

        cone.position.set(
            tipWorld[0] - dir.x * wHeadLen / 2,
            tipWorld[1] - dir.y * wHeadLen / 2,
            tipWorld[2] - dir.z * wHeadLen / 2,
        );
        const up = new THREE.Vector3(0, 1, 0);
        cone.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));

        animatedVectorState.three.scene.add(cone);
        animatedVectorState.arrowMeshes.push({ mesh: cone, tipWorld: new THREE.Vector3(...tipWorld), dir: dir.clone(), wLen: wHeadLen, owner: ownerToken });
        return cone;
    }

    function createShaft(from: Vec3, to: Vec3): RemovableMesh | null {
        const { fromWorld, wLen, wHeadRadius, shaftLen, shaftRadius, dir, autoScale } = computeArrowParams(from, to);
        if (wLen < 0.0001) return null;

        const geom = new THREE.CylinderGeometry(1, 1, 1, 16);
        const mat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(...color),
            emissive: new THREE.Color(...emissive),
            specular: new THREE.Color(...specular),
            shininess,
            transparent: elementOpacity < 0.999,
            opacity: elementOpacity,
            depthWrite,
            depthTest,
        });
        const shaft = new THREE.Mesh(geom, mat);
        shaft.userData.baseOpacity = elementOpacity;
        shaft.userData.dynamicVector = true;
        if (renderOrder !== null) shaft.renderOrder = renderOrder;

        shaft.position.set(
            fromWorld[0] + dir.x * shaftLen / 2,
            fromWorld[1] + dir.y * shaftLen / 2,
            fromWorld[2] + dir.z * shaftLen / 2,
        );
        const up = new THREE.Vector3(0, 1, 0);
        shaft.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
        const shaftRadiusScaled = Math.min(
            shaftRadius * computeShaftThicknessMul(autoScale),
            wHeadRadius * 0.75
        );
        shaft.scale.set(shaftRadiusScaled, shaftLen, shaftRadiusScaled);

        animatedVectorState.three.scene.add(shaft);
        animatedVectorState.arrowMeshes.push({ mesh: shaft, tipWorld: new THREE.Vector3(fromWorld[0] + dir.x*shaftLen, fromWorld[1] + dir.y*shaftLen, fromWorld[2] + dir.z*shaftLen), dir: dir.clone(), wLen: shaftLen, isShaft: true, owner: ownerToken });
        return shaft;
    }

    function computePanelLayout(from: Vec3, to: Vec3) {
        const { fromWorld, wLen, dir } = computeArrowParams(from, to);
        if (wLen < 0.0001) return null;
        const panelLength = Math.max(0.01, Number(panelOpts && panelOpts.length) || 0.12);
        const panelWidth = Math.max(0.005, Number(panelOpts && panelOpts.width) || 0.028);
        const panelThickness = Math.max(0.001, Number(panelOpts && panelOpts.thickness) || 0.01);
        const panelGap = Math.max(0, Number(panelOpts && panelOpts.gap) || 0.012);
        const segments = Math.max(1, Math.min(2, Math.round(Number(panelOpts && panelOpts.segments) || 2)));
        const panelNormal = new THREE.Vector3(-dir.y, dir.x, 0);
        if (panelNormal.lengthSq() < 1e-8) panelNormal.set(0, 1, 0);
        panelNormal.normalize();
        const angle = Math.atan2(dir.y, dir.x) + Math.PI / 2;
        return {
            fromWorld,
            panelLength,
            panelWidth,
            panelThickness,
            panelGap,
            segments,
            panelNormal,
            angle,
        };
    }

    function createPanels(from: Vec3, to: Vec3): Mesh[] {
        if (!panelOpts) return [];
        const layout = computePanelLayout(from, to);
        if (!layout) return [];
        const colorPanels = parseColor(panelOpts.color || '#7dd3fc') as Rgb3;
        const opacityPanels = Number.isFinite(Number(panelOpts.opacity))
            ? Math.max(0, Math.min(1, Number(panelOpts.opacity)))
            : elementOpacity;
        const panelRenderOrder = (typeof panelOpts.renderOrder === 'number' && isFinite(panelOpts.renderOrder))
            ? panelOpts.renderOrder
            : renderOrder;
        const meshes: Mesh[] = [];
        for (const side of [-1, 1]) {
            for (let seg = 0; seg < layout.segments; seg++) {
                const geom = new THREE.BoxGeometry(1, 1, 1);
                const mat = new THREE.MeshBasicMaterial({
                    color: new THREE.Color(...colorPanels),
                    transparent: opacityPanels < 0.999,
                    opacity: opacityPanels,
                    depthWrite,
                    depthTest,
                });
                const mesh = new THREE.Mesh(geom, mat);
                mesh.userData.baseOpacity = opacityPanels;
                mesh.userData.dynamicVector = true;
                if (panelRenderOrder !== null) mesh.renderOrder = panelRenderOrder;
                const centerDist = layout.panelGap + (seg + 0.5) * layout.panelLength;
                // KNOWN BUG — issue #579. fromWorld is a [x,y,z] array, and
                // Vector3.copy() reads .x/.y/.z, so this yields NaN. The cast
                // silences a TRUE positive: preserved here only because the
                // migration ports behaviour verbatim. Remove it when #579 is
                // fixed — do not "tidy" the cast away on its own.
                mesh.position.copy(layout.fromWorld as unknown as Vector3).addScaledVector(layout.panelNormal, side * centerDist);
                mesh.rotation.z = layout.angle;
                mesh.scale.set(layout.panelLength, layout.panelWidth, layout.panelThickness);
                animatedVectorState.three.scene.add(mesh);
                animatedVectorState.arrowMeshes.push({
                    mesh,
                    tipWorld: mesh.position.clone(),
                    dir: layout.panelNormal.clone(),
                    wLen: layout.panelLength,
                    isShaft: true,
                    owner: ownerToken,
                });
                meshes.push(mesh);
            }
        }
        return meshes;
    }

    function updateArrow(cone: RemovableMesh | null, shaft: RemovableMesh | null, from: Vec3, to: Vec3) {
        const { tipWorld, fromWorld, wLen, wHeadLen, wHeadRadius, shaftLen, shaftRadius, dir, autoScale } = computeArrowParams(from, to);
        const visible = wLen >= 0.0001;

        const up = new THREE.Vector3(0, 1, 0);
        const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);

        if (cone) {
            cone.visible = visible;
            if (visible) {
                cone.scale.set(wHeadRadius, wHeadLen, wHeadRadius);
                cone.position.set(
                    tipWorld[0] - dir.x * wHeadLen / 2,
                    tipWorld[1] - dir.y * wHeadLen / 2,
                    tipWorld[2] - dir.z * wHeadLen / 2,
                );
                cone.setRotationFromQuaternion(quat);
                const entry = animatedVectorState.arrowMeshes.find(e => e.mesh === cone);
                if (entry) { entry.wLen = wHeadLen; entry.tipWorld.set(...tipWorld); entry.dir.copy(dir); }
            }
        }

        if (shaft) {
            shaft.visible = visible;
            if (visible) {
                shaft.position.set(
                    fromWorld[0] + dir.x * shaftLen / 2,
                    fromWorld[1] + dir.y * shaftLen / 2,
                    fromWorld[2] + dir.z * shaftLen / 2,
                );
                shaft.setRotationFromQuaternion(quat);
                const shaftRadiusScaled = Math.min(
                    shaftRadius * computeShaftThicknessMul(autoScale),
                    wHeadRadius * 0.75
                );
                shaft.scale.set(shaftRadiusScaled, shaftLen, shaftRadiusScaled);
                const entry = animatedVectorState.arrowMeshes.find(e => e.mesh === shaft);
                if (entry) {
                    entry.wLen = shaftLen;
                    entry.tipWorld.set(fromWorld[0] + dir.x*shaftLen, fromWorld[1] + dir.y*shaftLen, fromWorld[2] + dir.z*shaftLen);
                    entry.dir.copy(dir);
                }
            }
        }
    }

    function updatePanels(meshes: Mesh[] | null, from: Vec3, to: Vec3) {
        if (!Array.isArray(meshes) || meshes.length === 0) return;
        const layout = computePanelLayout(from, to);
        const visible = !!layout;
        let idx = 0;
        for (const side of [-1, 1]) {
            for (let seg = 0; seg < (layout ? layout.segments : 2); seg++) {
                const mesh = meshes[idx++];
                if (!mesh) continue;
                mesh.visible = visible;
                if (!visible) continue;
                const centerDist = layout!.panelGap + (seg + 0.5) * layout!.panelLength;
                // KNOWN BUG — issue #579, same as the layout path above. The
                // cast hides a real defect; it stays only to keep this port
                // behaviour-identical. Remove it when #579 is fixed.
                mesh.position.copy(layout!.fromWorld as unknown as Vector3).addScaledVector(layout!.panelNormal, side * centerDist);
                mesh.rotation.z = layout!.angle;
                mesh.scale.set(layout!.panelLength, layout!.panelWidth, layout!.panelThickness);
                const entry = animatedVectorState.arrowMeshes.find(e => e.mesh === mesh);
                if (entry) {
                    entry.tipWorld.copy(mesh.position);
                    entry.dir.copy(layout!.panelNormal);
                    entry.wLen = layout!.panelLength;
                }
            }
        }
    }

    let arrowCone: RemovableMesh | null = null;
    let arrowShaft = createShaft(initFrom, initTo);
    let panelMeshes = createPanels(initFrom, initTo);
    if (el.arrow !== false) {
        arrowCone = createCone(initFrom, initTo);
    }

    // Trail setup
    let trailData: MathBoxNode | null = null;
    let trailLine: MathBoxNode | null = null;
    let trailBuffer: number[][] = [];
    const trailMaxLen = (trailOpts && trailOpts.length) || 200;
    if (trailOpts) {
        const trailColor = parseColor(trailOpts.color || el.color || '#ff8844') as Rgb3;
        const trailOpacityRaw = (trailOpts && trailOpts.opacity !== undefined) ? Number(trailOpts.opacity) : 1;
        const trailBaseOpacity = Math.max(0, Math.min(1, Number.isFinite(trailOpacityRaw) ? trailOpacityRaw : 1));
        const trailEntry: LineEntry = {
            node: null,
            baseWidth: trailOpts.width || 1,
            baseOpacity: trailBaseOpacity,
            widthParam: 'lineWidth',
            anchorDataPosFn: () => currentTo,
        };
        const trailWidth = resolveLineWidth(trailEntry);
        trailBuffer = [initTo.slice(), initTo.slice()];
        trailData = view
            .array({ channels: 3, width: 2, data: trailBuffer, live: true });
        trailLine = trailData.line({
            color: new THREE.Color(...trailColor),
            width: trailWidth,
            zBias: 1,
            opacity: trailBaseOpacity * (animatedVectorState.displayParams.lineOpacity || 1),
        });
        trailEntry.node = trailLine;
        animatedVectorState.lineNodes.push(trailEntry);
    }

    // Label
    let labelExprFn: CompiledExpr | null = null;
    if (labelExprString) {
        try { labelExprFn = compileExpr(labelExprString); } catch (err) { console.warn('animated_vector labelExpr compile error:', err); }
    }

    let labelEl: DynamicLabel | null = null;
    if (label || labelExprFn) {
        const labelPos = (el.labelPosition || [
            (initFrom[0] + initTo[0]) / 2 + labelOffset[0]!,
            (initFrom[1] + initTo[1]) / 2 + labelOffset[1]!,
            (initFrom[2] + initTo[2]) / 2 + labelOffset[2]!
        ]) as number[];
        labelEl = addLabel3D(label || '', labelPos, color);
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

    // Compiled expr functions
    let exprFns: CompiledExpr[] | null = null;
    let fromExprFns: CompiledExpr[] | null = null;
    let visibleFn: CompiledExpr | null = null;
    const animExprEntry: AnimExprEntry = { exprStrings, fromExprStrings, visibleExprString, animState: null, compiledFns: null, fromExprFns: null, visibleFn: null };
    if (useExpr) {
        try {
            exprFns = exprStrings!.map(e => compileExpr(e));
            animExprEntry.compiledFns = exprFns;
        } catch (err) {
            console.warn('animated_vector expr compile error:', err);
        }
    }
    if (useFromExpr) {
        try {
            fromExprFns = fromExprStrings!.map(e => compileExpr(e));
            animExprEntry.fromExprFns = fromExprFns;
        } catch (err) {
            console.warn('animated_vector fromExpr compile error:', err);
        }
    }
    if (visibleExprString) {
        try {
            visibleFn = compileExpr(visibleExprString);
            animExprEntry.visibleFn = visibleFn;
        } catch (err) {
            console.warn('animated_vector visibleExpr compile error:', err);
        }
    }

    const animState = { stopped: false };
    animExprEntry.animState = animState;
    if (useExpr) animatedVectorState.activeAnimExprs.push(animExprEntry);

    const startTime = animatedVectorState.sceneStartTime;
    animatedVectorState.activeAnimUpdaters.push({
        animState,
        updateFrame(nowMs) {
            if (arrowCone && !arrowCone.visible && arrowCone._hiddenByRemove) return;

            const elapsed = nowMs - startTime;
            const tSec = elapsed / 1000;
            let cf: Vec3, ct: Vec3;

            if (useExpr && (animExprEntry.compiledFns || exprFns)) {
                const fromFns = animExprEntry.fromExprFns || fromExprFns;
                if (fromFns) {
                    try {
                        cf = fromFns.map(fn => evalExpr(fn, tSec) as number) as Vec3;
                    } catch (err) {
                        cf = initFrom.slice() as Vec3;
                    }
                } else {
                    cf = initFrom.slice() as Vec3;
                }
                const fns = animExprEntry.compiledFns || exprFns;
                try {
                    ct = fns!.map(fn => evalExpr(fn, tSec) as number) as Vec3;
                } catch (err) {
                    ct = initTo;
                }
            } else if (keyframes.length > 1) {
                const totalDur = duration * (keyframes.length - 1);
                let t = (elapsed % (loop ? totalDur || 1 : Infinity)) / duration;
                if (!loop && elapsed > totalDur) t = keyframes.length - 1;

                const idx = Math.min(Math.floor(t), keyframes.length - 2);
                const frac = t - idx;
                // `!` not `?.`: idx is clamped into range just above.
                const kf0 = keyframes[idx]!;
                const kf1 = keyframes[Math.min(idx + 1, keyframes.length - 1)]!;

                const f0 = kf0.origin || kf0.from || [0,0,0];
                const t0 = kf0.to || [1,0,0];
                const f1 = kf1.origin || kf1.from || [0,0,0];
                const t1 = kf1.to || [1,0,0];

                cf = f0.map((v, i) => v + (f1[i]! - v) * frac) as Vec3;
                ct = t0.map((v, i) => v + (t1[i]! - v) * frac) as Vec3;
            } else {
                return;
            }

            currentFrom = cf;
            currentTo = ct;

            let isVisible = true;
            const curVisibleFn = animExprEntry.visibleFn || visibleFn;
            if (curVisibleFn) {
                try {
                    isVisible = !!evalExpr(curVisibleFn, tSec);
                } catch (_err) {
                    isVisible = true;
                }
            }
            if (!isVisible) {
                if (arrowCone) arrowCone.visible = false;
                if (arrowShaft) arrowShaft.visible = false;
                if (labelEl) labelEl.forceHidden = true;
                return;
            }

            if (!arrowShaft) arrowShaft = createShaft(cf, ct);
            if ((!panelMeshes || panelMeshes.length === 0) && panelOpts) panelMeshes = createPanels(cf, ct);
            if (el.arrow !== false && !arrowCone) arrowCone = createCone(cf, ct);

            updateArrow(arrowCone, arrowShaft, cf, ct);
            updatePanels(panelMeshes, cf, ct);

            if (trailOpts && trailData) {
                trailBuffer.push(ct.slice());
                if (trailBuffer.length > trailMaxLen) {
                    trailBuffer.shift();
                }
                trailData.set('width', trailBuffer.length);
                trailData.set('data', trailBuffer);
            }

            if (labelEl) {
                labelEl.dataPos[0] = (cf[0] + ct[0]) / 2 + labelOffset[0]!;
                labelEl.dataPos[1] = (cf[1] + ct[1]) / 2 + labelOffset[1]!;
                labelEl.dataPos[2] = (cf[2] + ct[2]) / 2 + labelOffset[2]!;
                labelEl.forceHidden = false;
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

            if (el.id) {
                animatedVectorState.animatedElementPos[el.id] = {
                    pos: ct,
                    from: cf,
                    to: ct,
                    startTime,
                    time: nowMs,
                };
            }
        },
    });

    return { type: 'animated_vector', color, label, _animState: animState, _animExprEntry: animExprEntry, _arrowOwner: ownerToken };
}
