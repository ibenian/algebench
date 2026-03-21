import { state } from '/state.js';
import { parseColor, addLabel3D, renderKaTeX } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import { dataToWorld } from '/coords.js';
import { resolveLineWidth } from '/camera.js';

export function renderAnimatedCurve(el, view) {
    const color = parseColor(el.color || '#ff8844');
    const width = el.width != null ? el.width : 3;
    const opacityRaw = el.opacity != null ? el.opacity : 1;
    const opacityExpr = typeof opacityRaw === 'string' ? compileExpr(opacityRaw) : null;
    const lineOpacity = opacityExpr ? evalExpr(opacityExpr, 0) : Number(opacityRaw);
    const label = el.label;
    const labelExprString = (typeof el.labelExpr === 'string' && el.labelExpr.trim()) ? el.labelExpr.trim() : null;
    const labelOffset = (Array.isArray(el.labelOffset) && el.labelOffset.length === 3)
        ? [Number(el.labelOffset[0]) || 0, Number(el.labelOffset[1]) || 0, Number(el.labelOffset[2]) || 0]
        : [0, 0.3, 0];
    const samples = el.samples || 200;

    let rangeLExpr = null, rangeRExpr = null;
    let rangeL = -1, rangeR = 1;
    const rangeSpec = el.range_expr || el.range || [-1, 1];
    const rSpec0 = rangeSpec[0], rSpec1 = rangeSpec[1];
    if (typeof rSpec0 === 'string') { rangeLExpr = compileExpr(rSpec0); rangeL = evalExpr(rangeLExpr, 0); }
    else { rangeL = Number(rSpec0) || 0; }
    if (typeof rSpec1 === 'string') { rangeRExpr = compileExpr(rSpec1); rangeR = evalExpr(rangeRExpr, 0); }
    else { rangeR = Number(rSpec1) || 1; }

    const exprStr = el.expr || '0';
    const cCurve = compileExpr(exprStr);

    function evalRange(tSec) {
        const rL = rangeLExpr ? evalExpr(rangeLExpr, tSec) : rangeL;
        const rR = rangeRExpr ? evalExpr(rangeRExpr, tSec) : rangeR;
        return [rL, rR];
    }

    function evalAtX(x, tSec) {
        try {
            const y = evalExpr(cCurve, tSec, { extraScope: { x } });
            return isFinite(y) ? y : 0;
        } catch(e) { return 0; }
    }

    function buildCurvePoints(tSec) {
        const [rL, rR] = evalRange(tSec);
        const pts = [];
        for (let i = 0; i <= samples; i++) {
            const x = rL + (rR - rL) * (i / samples);
            pts.push([x, evalAtX(x, tSec), 0]);
        }
        return pts;
    }

    const initPts = buildCurvePoints(0);
    const curveEntry = {
        node: null,
        baseWidth: width,
        baseOpacity: lineOpacity,
        widthParam: 'lineWidth',
        anchorDataPos: initPts[Math.floor(initPts.length / 2)] || [0, 0, 0],
    };
    const lineW = resolveLineWidth(curveEntry);
    const curveData = view.array({ channels: 3, width: initPts.length, data: initPts, live: true });
    const curveNode = curveData.line({
        color: new THREE.Color(...color),
        width: lineW,
        opacity: lineOpacity * (state.displayParams.lineOpacity || 1),
        visible: el.showCurve !== false,
    });
    curveEntry.node = curveNode;
    state.lineNodes.push(curveEntry);

    // Label
    let labelExprFn = null;
    if (labelExprString) {
        try { labelExprFn = compileExpr(labelExprString); } catch (err) { console.warn('animated_curve labelExpr compile error:', err); }
    }

    let labelEl = null;
    if (label || labelExprFn) {
        const mid = initPts[Math.floor(initPts.length / 2)] || [0, 0, 0];
        labelEl = addLabel3D(label || '', [mid[0] + labelOffset[0], mid[1] + labelOffset[1], mid[2] + labelOffset[2]], color);
        if (labelExprFn) {
            try {
                const txt = String(evalExpr(labelExprFn, 0));
                labelEl.el.innerHTML = renderKaTeX(txt, false);
                labelEl._lastDynamicText = txt;
            } catch (_e) {}
        }
    }

    // Fill regions
    const fillRegions = Array.isArray(el.fill_regions) ? el.fill_regions : [];
    const FILL_MAX_FLOATS = 1024 * 18;

    const fillEntries = fillRegions.map(fr => {
        const frColor = parseColor(fr.color || el.color || '#ff8844');
        const frOpacityRaw = fr.opacity != null ? fr.opacity : 0.35;
        const frOpacityExpr = typeof frOpacityRaw === 'string' ? compileExpr(frOpacityRaw) : null;
        const frOpacity = frOpacityExpr ? evalExpr(frOpacityExpr, 0) : Number(frOpacityRaw);
        const cAbove   = fr.above   != null ? compileExpr(String(fr.above))   : null;
        const cBelow   = fr.below   != null ? compileExpr(String(fr.below))   : null;
        const cRightOf = fr.rightOf != null ? compileExpr(String(fr.rightOf)) : null;
        const cLeftOf  = fr.leftOf  != null ? compileExpr(String(fr.leftOf))  : null;

        const fillAttr = new THREE.Float32BufferAttribute(new Float32Array(FILL_MAX_FLOATS), 3);
        fillAttr.setUsage(THREE.DynamicDrawUsage);
        const fillGeom = new THREE.BufferGeometry();
        fillGeom.setAttribute('position', fillAttr);
        const fillMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(...frColor),
            opacity: state.displayParams.planeOpacity * (frOpacity / 0.5),
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const fillMesh = new THREE.Mesh(fillGeom, fillMat);
        const _ser = state._planeMeshSerial++;
        fillMesh.renderOrder = _ser;
        fillMesh.position.z = el.depthZ !== undefined ? el.depthZ : _ser * 0.0002;
        state.three.scene.add(fillMesh);
        state.planeMeshes.push(fillMesh);

        let outlineArrayNode = null, outlineLineNode = null;
        let outlineWidthExpr = null, outlineOpacityExpr = null;
        const outlineWidthRaw = fr.outlineWidth != null ? fr.outlineWidth : null;
        const outlineOpacityRaw = fr.outlineOpacity != null ? fr.outlineOpacity : null;
        const cBoundary = cAbove || cBelow || null;
        if (outlineWidthRaw != null) {
            if (typeof outlineWidthRaw === 'string') outlineWidthExpr = compileExpr(outlineWidthRaw);
            if (outlineOpacityRaw != null && typeof outlineOpacityRaw === 'string') outlineOpacityExpr = compileExpr(String(outlineOpacityRaw));
            const outlineColor = parseColor(fr.outlineColor || fr.color || el.color || '#ff8844');
            const outlineWidthInit = typeof outlineWidthRaw === 'string' ? (evalExpr(compileExpr(outlineWidthRaw), 0) || 2) : outlineWidthRaw;
            const outlineOpacityInit = outlineOpacityRaw != null
                ? (typeof outlineOpacityRaw === 'string' ? evalExpr(compileExpr(String(outlineOpacityRaw)), 0) : Number(outlineOpacityRaw))
                : Math.min(1, frOpacity * 2);
            const OUTLINE_MAX_PTS = 2 * (samples + 1) + 4;
            const initBndPts = Array(OUTLINE_MAX_PTS).fill([0, 0, 0]);
            outlineArrayNode = view.array({ channels: 3, width: OUTLINE_MAX_PTS, data: initBndPts, live: true });
            outlineLineNode = outlineArrayNode.line({
                color: new THREE.Color(...outlineColor),
                width: outlineWidthInit,
                opacity: outlineOpacityInit,
                zBias: 2,
            });
        }

        return { fr, frOpacityExpr, frOpacity, cAbove, cBelow, cRightOf, cLeftOf, fillAttr, fillGeom, fillMat,
                 cBoundary, outlineArrayNode, outlineLineNode, outlineWidthExpr, outlineOpacityExpr, outlineOpacityRaw, frOpacity };
    });

    function evalBound(compiled, x, tSec) {
        try {
            const v = evalExpr(compiled, tSec, { extraScope: { x } });
            return isFinite(v) ? v : 0;
        } catch(e) { return 0; }
    }

    function updateFillMesh(entry, tSec, pts) {
        const { cAbove, cBelow, cRightOf, cLeftOf, fillAttr, fillGeom } = entry;
        const rightOfX = cRightOf ? evalExpr(cRightOf, tSec) : null;
        const leftOfX  = cLeftOf  ? evalExpr(cLeftOf,  tSec) : null;
        const floats = fillAttr.array;
        let idx = 0;

        for (let i = 0; i < pts.length - 1; i++) {
            const x0 = pts[i][0],   x1 = pts[i + 1][0];
            const cy0 = pts[i][1],  cy1 = pts[i + 1][1];

            if (rightOfX != null && x1 < rightOfX) continue;
            if (leftOfX  != null && x0 > leftOfX)  continue;

            const aboveY0 = cAbove ? evalBound(cAbove, x0, tSec) : null;
            const aboveY1 = cAbove ? evalBound(cAbove, x1, tSec) : null;
            const belowY0 = cBelow ? evalBound(cBelow, x0, tSec) : null;
            const belowY1 = cBelow ? evalBound(cBelow, x1, tSec) : null;

            let yTop0, yBot0, yTop1, yBot1, show0, show1;
            if (cAbove != null && cBelow != null) {
                yBot0 = aboveY0; yTop0 = belowY0;
                yBot1 = aboveY1; yTop1 = belowY1;
                show0 = yTop0 > yBot0;
                show1 = yTop1 > yBot1;
            } else if (cAbove != null) {
                show0 = cy0 >= aboveY0; show1 = cy1 >= aboveY1;
                yTop0 = cy0; yBot0 = aboveY0; yTop1 = cy1; yBot1 = aboveY1;
            } else if (cBelow != null) {
                show0 = cy0 <= belowY0; show1 = cy1 <= belowY1;
                yTop0 = belowY0; yBot0 = cy0; yTop1 = belowY1; yBot1 = cy1;
            } else {
                show0 = show1 = true;
                yTop0 = Math.max(0, cy0); yBot0 = Math.min(0, cy0);
                yTop1 = Math.max(0, cy1); yBot1 = Math.min(0, cy1);
            }

            if (!show0 && !show1) continue;
            if (idx + 18 > FILL_MAX_FLOATS) break;

            const w00 = dataToWorld([x0, yBot0, 0]);
            const w01 = dataToWorld([x0, yTop0, 0]);
            const w10 = dataToWorld([x1, yBot1, 0]);
            const w11 = dataToWorld([x1, yTop1, 0]);

            floats[idx++] = w00[0]; floats[idx++] = w00[1]; floats[idx++] = w00[2];
            floats[idx++] = w10[0]; floats[idx++] = w10[1]; floats[idx++] = w10[2];
            floats[idx++] = w01[0]; floats[idx++] = w01[1]; floats[idx++] = w01[2];
            floats[idx++] = w01[0]; floats[idx++] = w01[1]; floats[idx++] = w01[2];
            floats[idx++] = w10[0]; floats[idx++] = w10[1]; floats[idx++] = w10[2];
            floats[idx++] = w11[0]; floats[idx++] = w11[1]; floats[idx++] = w11[2];
        }

        fillAttr.needsUpdate = true;
        fillGeom.setDrawRange(0, idx / 3);
    }

    function buildOutlinePts(entry, tSec, pts) {
        const { cAbove, cBelow, cRightOf, cLeftOf } = entry;
        const rightOfX = cRightOf ? evalExpr(cRightOf, tSec) : null;
        const leftOfX  = cLeftOf  ? evalExpr(cLeftOf,  tSec) : null;

        const clipped = [];
        for (const p of pts) {
            const x = p[0], cy = p[1];
            if (rightOfX != null && x < rightOfX - 1e-9) continue;
            if (leftOfX  != null && x > leftOfX  + 1e-9) continue;
            let topY, botY;
            if (cAbove != null && cBelow != null) {
                topY = evalBound(cBelow, x, tSec);
                botY = evalBound(cAbove, x, tSec);
            } else if (cAbove != null) {
                topY = cy; botY = evalBound(cAbove, x, tSec);
            } else if (cBelow != null) {
                topY = evalBound(cBelow, x, tSec); botY = cy;
            } else {
                topY = Math.max(0, cy); botY = Math.min(0, cy);
            }
            clipped.push({ x, topY, botY });
        }

        if (clipped.length === 0) return [[0, 0, 0]];

        const perimeter = [];
        for (const s of clipped) perimeter.push([s.x, s.topY, 0]);
        const last = clipped[clipped.length - 1];
        perimeter.push([last.x, last.botY, 0]);
        for (let i = clipped.length - 1; i >= 0; i--) perimeter.push([clipped[i].x, clipped[i].botY, 0]);
        perimeter.push([clipped[0].x, clipped[0].topY, 0]);
        perimeter.push(perimeter[0]);

        const OUTLINE_MAX_PTS = 2 * (samples + 1) + 4;
        const padPt = perimeter[perimeter.length - 1];
        while (perimeter.length < OUTLINE_MAX_PTS) perimeter.push(padPt);
        return perimeter;
    }

    for (const entry of fillEntries) updateFillMesh(entry, 0, initPts);
    for (const entry of fillEntries) {
        if (entry.outlineArrayNode) {
            entry.outlineArrayNode.set('data', buildOutlinePts(entry, 0, initPts));
        }
    }

    const animState = { stopped: false };
    const animExprEntry = {
        exprStrings: [exprStr],
        animState,
        compiledFns: [cCurve],
        _isAnimatedCurve: true,
    };
    state.activeAnimExprs.push(animExprEntry);

    const startTime = state.sceneStartTime;
    state.activeAnimUpdaters.push({
        animState,
        updateFrame(nowMs) {
            const tSec = (nowMs - startTime) / 1000;
            try {
                const pts = buildCurvePoints(tSec);
                curveData.set('data', pts);
                if (labelEl) {
                    const mid = pts[Math.floor(pts.length / 2)] || [0, 0, 0];
                    labelEl.dataPos[0] = mid[0] + labelOffset[0];
                    labelEl.dataPos[1] = mid[1] + labelOffset[1];
                    labelEl.dataPos[2] = mid[2] + labelOffset[2];
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
                if (opacityExpr) {
                    curveNode.set('opacity', evalExpr(opacityExpr, tSec) * (state.displayParams.lineOpacity || 1));
                }
                for (const entry of fillEntries) {
                    updateFillMesh(entry, tSec, pts);
                    if (entry.frOpacityExpr) {
                        entry.fillMat.opacity = state.displayParams.planeOpacity * (evalExpr(entry.frOpacityExpr, tSec) / 0.5);
                    }
                    if (entry.outlineArrayNode) {
                        entry.outlineArrayNode.set('data', buildOutlinePts(entry, tSec, pts));
                    }
                    if (entry.outlineLineNode && entry.outlineWidthExpr) {
                        entry.outlineLineNode.set('width', evalExpr(entry.outlineWidthExpr, tSec));
                    }
                    if (entry.outlineLineNode && entry.outlineOpacityExpr) {
                        entry.outlineLineNode.set('opacity', evalExpr(entry.outlineOpacityExpr, tSec));
                    }
                }
            } catch(err) { /* keep last frame */ }
        },
    });

    return { type: 'animated_curve', color, label: el.label, _animState: animState, _animExprEntry: animExprEntry };
}
