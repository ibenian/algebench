import { state } from '/state.js';
import { parseColor, addLabel3D, renderKaTeX } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import { resolveLineWidth, getAbstractWidthScale } from '/camera.js';

export function renderAnimatedLine(el, view) {
    const color = parseColor(el.color || '#88aaff');
    const width = (el.width || 3) * getAbstractWidthScale(el);
    const opacity = (el.opacity !== undefined) ? Number(el.opacity) : 1;
    const baseOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
    const label = el.label;
    const labelExprString = (typeof el.labelExpr === 'string' && el.labelExpr.trim()) ? el.labelExpr.trim() : null;
    const pointExprs = el.points;

    if (!Array.isArray(pointExprs) || pointExprs.length < 2) return null;

    let compiledPoints = pointExprs.map(p => p.map(e => compileExpr(e)));

    function evalPoints(fns, tSec) {
        return fns.map(pfns => pfns.map(fn => evalExpr(fn, tSec)));
    }

    let currentPoints;
    try {
        currentPoints = evalPoints(compiledPoints, 0);
    } catch(err) {
        console.warn('animated_line eval error:', err);
        return null;
    }

    const lineEntry = {
        node: null,
        baseWidth: width,
        baseOpacity,
        widthParam: 'lineWidth',
        anchorDataPosFn: () => (currentPoints[Math.floor(currentPoints.length / 2)] || [0, 0, 0]),
    };
    const lineW = resolveLineWidth(lineEntry);
    const lineData = view
        .array({ channels: 3, width: currentPoints.length, data: currentPoints, live: true });
    const lineNode = lineData.line({ color: new THREE.Color(...color), width: lineW, zBias: 1, opacity: baseOpacity * (state.displayParams.lineOpacity || 1) });
    lineEntry.node = lineNode;
    state.lineNodes.push(lineEntry);

    let labelExprFn = null;
    if (labelExprString) {
        try { labelExprFn = compileExpr(labelExprString); } catch (err) { console.warn('animated_line labelExpr compile error:', err); }
    }

    let labelEl = null;
    if (label || labelExprFn) {
        const mid = currentPoints[Math.floor(currentPoints.length / 2)];
        labelEl = addLabel3D(label || '', mid, color);
        if (labelExprFn) {
            try {
                const txt = String(evalExpr(labelExprFn, 0));
                labelEl.el.innerHTML = renderKaTeX(txt, false);
                labelEl._lastDynamicText = txt;
            } catch (_e) {}
        }
    }

    const animState = { stopped: false };
    const animExprEntry = {
        exprStrings: pointExprs.flat(),
        animState,
        compiledFns: compiledPoints.flat(),
        _isAnimatedLine: true,
        _pointExprs: pointExprs,
        _compiledPoints: compiledPoints,
    };
    state.activeAnimExprs.push(animExprEntry);

    const startTime = state.sceneStartTime;
    state.activeAnimUpdaters.push({
        animState,
        updateFrame(nowMs) {
            const tSec = (nowMs - startTime) / 1000;
            const fns = animExprEntry._compiledPoints;
            try {
                const pts = evalPoints(fns, tSec);
                lineData.set('data', pts);

                if (labelEl) {
                    const mid = pts[Math.floor(pts.length / 2)];
                    labelEl.dataPos[0] = mid[0];
                    labelEl.dataPos[1] = mid[1] + 0.3;
                    labelEl.dataPos[2] = mid[2];
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
            } catch(err) { /* keep last frame */ }
        },
    });

    return { type: 'animated_line', color, label, _animState: animState, _animExprEntry: animExprEntry };
}
