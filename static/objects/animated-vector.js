import { state } from '/state.js';
import { parseColor, addLabel3D, renderKaTeX } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import { dataToWorld } from '/coords.js';
import { resolveLineWidth,
    resolveArrowSizeScale, resolveSmallVectorAutoScale,
    ARROW_HEAD_MIN_FACTOR, ARROW_HEAD_MAX_FACTOR, ARROW_HEAD_RADIUS_RATIO,
    SHAFT_RADIUS_TO_HEAD_RADIUS_RATIO, SHAFT_CONE_OVERLAP_HEAD_RATIO,
} from '/camera.js';

export function renderAnimatedVector(el, view) {
    const color = parseColor(el.color || '#ff8844');
    const label = el.label;
    const elementOpacity = (typeof el.opacity === 'number' && isFinite(el.opacity))
        ? Math.max(0, Math.min(1, el.opacity))
        : 1;
    const labelOffset = (Array.isArray(el.labelOffset) && el.labelOffset.length === 3)
        ? [Number(el.labelOffset[0]) || 0, Number(el.labelOffset[1]) || 0, Number(el.labelOffset[2]) || 0]
        : [0, 0.3, 0];
    const keyframes = el.keyframes || [];
    const duration = el.duration || 2000;
    const loop = el.loop !== false;
    const exprStrings = el.expr || el.toExpr
        || (Array.isArray(el.to) && el.to.length === 3 ? el.to.map(v => String(v)) : null);
    const fromExprStrings = el.fromExpr;
    const visibleExprString = (typeof el.visibleExpr === 'string' && el.visibleExpr.trim()) ? el.visibleExpr.trim() : null;
    const labelExprString = (typeof el.labelExpr === 'string' && el.labelExpr.trim()) ? el.labelExpr.trim() : null;
    const trailOpts = el.trail;
    const hasExplicitWidth = (typeof el.width === 'number' && isFinite(el.width));
    const widthScale = hasExplicitWidth ? Math.max(0.01, el.width) : 1.3;
    const widthHeadScale = Math.max(0.4, Math.sqrt(widthScale));
    const localArrowScale = (el.arrowScale !== undefined ? el.arrowScale : 1) * widthHeadScale;
    const localArrowMinFactor = el.arrowMinFactor !== undefined ? el.arrowMinFactor : ARROW_HEAD_MIN_FACTOR;
    const localArrowMaxFactor = el.arrowMaxFactor !== undefined ? el.arrowMaxFactor : ARROW_HEAD_MAX_FACTOR;
    const defaultAnimatedShaftMul = 1;
    const shaftBaseScale = (typeof el.shaftScale === 'number' && isFinite(el.shaftScale))
        ? Math.max(0.01, widthScale * el.shaftScale)
        : (widthScale * defaultAnimatedShaftMul);

    const useExpr = Array.isArray(exprStrings) && exprStrings.length === 3;
    const useFromExpr = Array.isArray(fromExprStrings) && fromExprStrings.length === 3;
    if (!useExpr && keyframes.length === 0) return null;

    const initFrom = el.origin || el.from || (keyframes.length > 0 ? (keyframes[0].origin || keyframes[0].from || [0,0,0]) : [0,0,0]);
    let initTo;
    if (useExpr) {
        try {
            initTo = exprStrings.map(e => evalExpr(compileExpr(e), 0));
        } catch (err) {
            console.warn('animated_vector expr eval error:', err);
            initTo = [1, 0, 0];
        }
    } else {
        initTo = keyframes[0].to || [1, 0, 0];
    }
    if (useFromExpr) {
        try {
            const evalFrom = fromExprStrings.map(e => evalExpr(compileExpr(e), 0));
            initFrom[0] = evalFrom[0]; initFrom[1] = evalFrom[1]; initFrom[2] = evalFrom[2];
        } catch (err) {
            console.warn('animated_vector fromExpr eval error:', err);
        }
    }

    let currentFrom = initFrom.slice();
    let currentTo = initTo.slice();

    function computeArrowParams(from, to) {
        const tipWorld = dataToWorld(to);
        const fromWorld = dataToWorld(from);
        const wdx = tipWorld[0]-fromWorld[0], wdy = tipWorld[1]-fromWorld[1], wdz = tipWorld[2]-fromWorld[2];
        const wLen = Math.sqrt(wdx*wdx + wdy*wdy + wdz*wdz);
        const currentScale = state.currentScale;
        const worldSceneSize = Math.min(currentScale[0], currentScale[1]) * 2;
        const effectiveArrowScale = resolveArrowSizeScale(localArrowScale * (state.displayParams.arrowScale || 1));
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

    function computeShaftThicknessMul(autoScale) {
        const base = (shaftBaseScale || 1) * (state.displayParams.vectorWidth || 1) * (autoScale || 1);
        return Math.max(0.01, base);
    }

    function createCone(from, to) {
        const { tipWorld, wLen, wHeadLen, wHeadRadius, dir } = computeArrowParams(from, to);
        if (wLen < 0.0001) return null;

        const geom = new THREE.ConeGeometry(1, 1, 16);
        const mat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(...color),
            shininess: 60,
            transparent: elementOpacity < 0.999,
            opacity: elementOpacity,
        });
        const cone = new THREE.Mesh(geom, mat);
        cone.userData.baseOpacity = elementOpacity;
        cone.userData.dynamicVector = true;
        cone.scale.set(wHeadRadius, wHeadLen, wHeadRadius);

        cone.position.set(
            tipWorld[0] - dir.x * wHeadLen / 2,
            tipWorld[1] - dir.y * wHeadLen / 2,
            tipWorld[2] - dir.z * wHeadLen / 2,
        );
        const up = new THREE.Vector3(0, 1, 0);
        cone.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));

        state.three.scene.add(cone);
        state.arrowMeshes.push({ mesh: cone, tipWorld: new THREE.Vector3(...tipWorld), dir: dir.clone(), wLen: wHeadLen });
        return cone;
    }

    function createShaft(from, to) {
        const { fromWorld, wLen, wHeadRadius, shaftLen, shaftRadius, dir, autoScale } = computeArrowParams(from, to);
        if (wLen < 0.0001) return null;

        const geom = new THREE.CylinderGeometry(1, 1, 1, 16);
        const mat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(...color),
            shininess: 60,
            transparent: elementOpacity < 0.999,
            opacity: elementOpacity,
        });
        const shaft = new THREE.Mesh(geom, mat);
        shaft.userData.baseOpacity = elementOpacity;
        shaft.userData.dynamicVector = true;

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

        state.three.scene.add(shaft);
        state.arrowMeshes.push({ mesh: shaft, tipWorld: new THREE.Vector3(fromWorld[0] + dir.x*shaftLen, fromWorld[1] + dir.y*shaftLen, fromWorld[2] + dir.z*shaftLen), dir: dir.clone(), wLen: shaftLen, isShaft: true });
        return shaft;
    }

    function updateArrow(cone, shaft, from, to) {
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
                const entry = state.arrowMeshes.find(e => e.mesh === cone);
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
                const entry = state.arrowMeshes.find(e => e.mesh === shaft);
                if (entry) {
                    entry.wLen = shaftLen;
                    entry.tipWorld.set(fromWorld[0] + dir.x*shaftLen, fromWorld[1] + dir.y*shaftLen, fromWorld[2] + dir.z*shaftLen);
                    entry.dir.copy(dir);
                }
            }
        }
    }

    let arrowCone = null;
    let arrowShaft = createShaft(initFrom, initTo);
    if (el.arrow !== false) {
        arrowCone = createCone(initFrom, initTo);
    }

    // Trail setup
    let trailData = null;
    let trailLine = null;
    let trailBuffer = [];
    const trailMaxLen = (trailOpts && trailOpts.length) || 200;
    if (trailOpts) {
        const trailColor = parseColor(trailOpts.color || el.color || '#ff8844');
        const trailOpacityRaw = (trailOpts && trailOpts.opacity !== undefined) ? Number(trailOpts.opacity) : 1;
        const trailBaseOpacity = Math.max(0, Math.min(1, Number.isFinite(trailOpacityRaw) ? trailOpacityRaw : 1));
        const trailEntry = {
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
            opacity: trailBaseOpacity * (state.displayParams.lineOpacity || 1),
        });
        trailEntry.node = trailLine;
        state.lineNodes.push(trailEntry);
    }

    // Label
    let labelExprFn = null;
    if (labelExprString) {
        try { labelExprFn = compileExpr(labelExprString); } catch (err) { console.warn('animated_vector labelExpr compile error:', err); }
    }

    let labelEl = null;
    if (label || labelExprFn) {
        const labelPos = el.labelPosition || [
            (initFrom[0] + initTo[0]) / 2 + labelOffset[0],
            (initFrom[1] + initTo[1]) / 2 + labelOffset[1],
            (initFrom[2] + initTo[2]) / 2 + labelOffset[2]
        ];
        labelEl = addLabel3D(label || '', labelPos, color);
        if (labelExprFn) {
            try {
                const txt = String(evalExpr(labelExprFn, 0));
                labelEl.el.innerHTML = renderKaTeX(txt, false);
                labelEl._lastDynamicText = txt;
            } catch (_e) {}
        }
    }

    // Compiled expr functions
    let exprFns = null;
    let fromExprFns = null;
    let visibleFn = null;
    const animExprEntry = { exprStrings, fromExprStrings, visibleExprString, animState: null, compiledFns: null, fromExprFns: null, visibleFn: null };
    if (useExpr) {
        try {
            exprFns = exprStrings.map(e => compileExpr(e));
            animExprEntry.compiledFns = exprFns;
        } catch (err) {
            console.warn('animated_vector expr compile error:', err);
        }
    }
    if (useFromExpr) {
        try {
            fromExprFns = fromExprStrings.map(e => compileExpr(e));
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
    if (useExpr) state.activeAnimExprs.push(animExprEntry);

    const startTime = state.sceneStartTime;
    state.activeAnimUpdaters.push({
        animState,
        updateFrame(nowMs) {
            if (arrowCone && !arrowCone.visible && arrowCone._hiddenByRemove) return;

            const elapsed = nowMs - startTime;
            const tSec = elapsed / 1000;
            let cf, ct;

            if (useExpr && (animExprEntry.compiledFns || exprFns)) {
                const fromFns = animExprEntry.fromExprFns || fromExprFns;
                if (fromFns) {
                    try {
                        cf = fromFns.map(fn => evalExpr(fn, tSec));
                    } catch (err) {
                        cf = initFrom.slice();
                    }
                } else {
                    cf = initFrom.slice();
                }
                const fns = animExprEntry.compiledFns || exprFns;
                try {
                    ct = fns.map(fn => evalExpr(fn, tSec));
                } catch (err) {
                    ct = initTo;
                }
            } else if (keyframes.length > 1) {
                const totalDur = duration * (keyframes.length - 1);
                let t = (elapsed % (loop ? totalDur || 1 : Infinity)) / duration;
                if (!loop && elapsed > totalDur) t = keyframes.length - 1;

                const idx = Math.min(Math.floor(t), keyframes.length - 2);
                const frac = t - idx;
                const kf0 = keyframes[idx];
                const kf1 = keyframes[Math.min(idx + 1, keyframes.length - 1)];

                const f0 = kf0.origin || kf0.from || [0,0,0];
                const t0 = kf0.to || [1,0,0];
                const f1 = kf1.origin || kf1.from || [0,0,0];
                const t1 = kf1.to || [1,0,0];

                cf = f0.map((v, i) => v + (f1[i] - v) * frac);
                ct = t0.map((v, i) => v + (t1[i] - v) * frac);
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
            if (el.arrow !== false && !arrowCone) arrowCone = createCone(cf, ct);

            updateArrow(arrowCone, arrowShaft, cf, ct);

            if (trailOpts && trailData) {
                trailBuffer.push(ct.slice());
                if (trailBuffer.length > trailMaxLen) {
                    trailBuffer.shift();
                }
                trailData.set('width', trailBuffer.length);
                trailData.set('data', trailBuffer);
            }

            if (labelEl) {
                labelEl.dataPos[0] = (cf[0] + ct[0]) / 2 + labelOffset[0];
                labelEl.dataPos[1] = (cf[1] + ct[1]) / 2 + labelOffset[1];
                labelEl.dataPos[2] = (cf[2] + ct[2]) / 2 + labelOffset[2];
                labelEl.forceHidden = false;
                if (labelExprFn) {
                    try {
                        const txt = String(evalExpr(labelExprFn, tSec));
                        if (labelEl._lastDynamicText !== txt) {
                            labelEl.el.innerHTML = renderKaTeX(txt, false);
                            labelEl._lastDynamicText = txt;
                        }
                    } catch (_e) {}
                }
            }

            if (el.id) {
                state.animatedElementPos[el.id] = {
                    pos: ct,
                    from: cf,
                    to: ct,
                    startTime,
                    time: nowMs,
                };
            }
        },
    });

    return { type: 'animated_vector', color, label, _animState: animState, _animExprEntry: animExprEntry };
}
