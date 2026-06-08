import { state } from '/state.js';
import { parseColor, addLabel3D } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import { resolveLineWidth } from '/camera.js';

export function renderParametricCurve(el, view) {
    const color = parseColor(el.color || '#ff88aa');
    const width = el.width || 3;
    const range = el.range || [0, 2 * Math.PI];
    const samples = el.samples || 128;
    const opacity = (el.opacity !== undefined) ? Number(el.opacity) : 1;
    const baseOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
    const label = el.label;
    const labelOffset = (Array.isArray(el.labelOffset) && el.labelOffset.length === 3)
        ? [Number(el.labelOffset[0]) || 0, Number(el.labelOffset[1]) || 0, Number(el.labelOffset[2]) || 0]
        : [0, 0.3, 0];

    const exprX = el.x || 'Math.cos(t)';
    const exprY = el.y || 'Math.sin(t)';
    const exprZ = el.z || '0';

    function buildPoints(fnX, fnY, fnZ) {
        const pts = [];
        const dt = (range[1] - range[0]) / samples;
        for (let i = 0; i <= samples; i++) {
            const t = range[0] + i * dt;
            try {
                const x = evalExpr(fnX, t, { useVirtualTime: false });
                const y = evalExpr(fnY, t, { useVirtualTime: false });
                const z = evalExpr(fnZ, t, { useVirtualTime: false });
                pts.push([isFinite(x) ? x : 0, isFinite(y) ? y : 0, isFinite(z) ? z : 0]);
            } catch(e) {
                pts.push([0, 0, 0]);
            }
        }
        return pts;
    }

    let fnX = compileExpr(exprX);
    let fnY = compileExpr(exprY);
    let fnZ = compileExpr(exprZ);
    const points = buildPoints(fnX, fnY, fnZ);

    const curveMid = points[Math.floor(points.length / 2)] || [0, 0, 0];
    const curveEntry = {
        node: null,
        baseWidth: width,
        baseOpacity,
        widthParam: 'lineWidth',
        anchorDataPos: curveMid,
    };
    const lineW = resolveLineWidth(curveEntry);
    const curveData = view
        .array({ channels: 3, width: points.length, data: points, live: true });
    const curveNode = curveData.line({ color: new THREE.Color(...color), width: lineW, opacity: baseOpacity * (state.displayParams.lineOpacity || 1) });
    curveEntry.node = curveNode;
    state.lineNodes.push(curveEntry);

    let labelEl = null;
    if (label) {
        const mid = points[Math.floor(points.length / 2)];
        labelEl = addLabel3D(label, [
            mid[0] + labelOffset[0],
            mid[1] + labelOffset[1],
            mid[2] + labelOffset[2],
        ], color);
    }

    const animState = { stopped: false };
    const animExprEntry = {
        exprStrings: [exprX, exprY, exprZ],
        animState,
        compiledFns: [fnX, fnY, fnZ],
        _isParametricCurve: true,
        _rebuildFn() {
            const newFnX = compileExpr(exprX);
            const newFnY = compileExpr(exprY);
            const newFnZ = compileExpr(exprZ);
            const pts = buildPoints(newFnX, newFnY, newFnZ);
            curveData.set('data', pts);
            if (labelEl) {
                const mid = pts[Math.floor(pts.length / 2)];
                labelEl.dataPos[0] = mid[0] + labelOffset[0];
                labelEl.dataPos[1] = mid[1] + labelOffset[1];
                labelEl.dataPos[2] = mid[2] + labelOffset[2];
            }
        },
    };
    state.activeAnimExprs.push(animExprEntry);

    return { type: 'parametric_curve', color, label, _animState: animState, _animExprEntry: animExprEntry };
}
