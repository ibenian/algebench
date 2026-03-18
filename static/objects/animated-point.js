import { state } from '/state.js';
import { parseColor, addLabel3D } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import { dataToWorld, dataLenToWorld } from '/coords.js';

export function renderAnimatedPoint(el, view) {
    const color = parseColor(el.color || '#ffdd00');
    const radius = el.radius !== undefined ? el.radius : 0.25;
    const label = el.label;
    const exprStrings = el.expr || el.positionExpr || el.toExpr
        || (Array.isArray(el.position) && el.position.length === 3 ? el.position.map(v => String(v)) : null);
    const visibleExprString = (typeof el.visibleExpr === 'string' && el.visibleExpr.trim()) ? el.visibleExpr.trim() : null;

    if (!Array.isArray(exprStrings) || exprStrings.length !== 3) return null;

    let exprFns;
    let visibleFn = null;
    let initPos;
    try {
        exprFns = exprStrings.map(e => compileExpr(e));
        initPos = exprFns.map(fn => evalExpr(fn, 0));
        if (visibleExprString) visibleFn = compileExpr(visibleExprString);
    } catch (err) {
        console.warn('animated_point expr compile/eval error:', err);
        return null;
    }

    const initWorld = dataToWorld(initPos);
    const geom = new THREE.SphereGeometry(1, 20, 16);
    const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(...color),
        shininess: 50,
        transparent: true,
        opacity: 1,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(initWorld[0], initWorld[1], initWorld[2]);
    const initWorldRadius = Math.max(dataLenToWorld(radius), 0.0005);
    mesh.scale.setScalar(initWorldRadius);
    state.three.scene.add(mesh);
    state.planeMeshes.push(mesh);

    let labelEl = null;
    if (label) {
        labelEl = addLabel3D(label, [initPos[0], initPos[1], initPos[2] + 0.3], color);
    }

    const animState = { stopped: false };
    const animExprEntry = {
        exprStrings,
        animState,
        compiledFns: exprFns,
        visibleExprString,
        visibleFn,
    };
    state.activeAnimExprs.push(animExprEntry);

    const startTime = state.sceneStartTime;
    state.activeAnimUpdaters.push({
        animState,
        updateFrame(nowMs) {
            const tSec = (nowMs - startTime) / 1000;
            const fns = animExprEntry.compiledFns || exprFns;
            let p = initPos;
            try {
                p = fns.map(fn => evalExpr(fn, tSec));
            } catch (err) {
                // keep previous position
            }

            if (el.id) {
                state.animatedElementPos[el.id] = { pos: p, startTime, time: nowMs };
            }

            if (mesh._hiddenByRemove) return;

            let isVisible = true;
            const curVisibleFn = animExprEntry.visibleFn || visibleFn;
            if (curVisibleFn) {
                try {
                    isVisible = !!evalExpr(curVisibleFn, tSec);
                } catch (_err) {
                    isVisible = true;
                }
            }
            mesh.visible = isVisible;

            const w = dataToWorld(p);
            mesh.position.set(w[0], w[1], w[2]);
            const worldRadius = Math.max(dataLenToWorld(radius), 0.0005);
            mesh.scale.setScalar(worldRadius);

            if (labelEl) {
                labelEl.dataPos[0] = p[0];
                labelEl.dataPos[1] = p[1];
                labelEl.dataPos[2] = p[2] + 0.3;
                labelEl.forceHidden = !isVisible;
            }
        },
    });

    return { type: 'animated_point', color, label, _animState: animState, _animExprEntry: animExprEntry };
}
