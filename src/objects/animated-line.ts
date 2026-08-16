import { state } from '/state.js';
import { parseColor, addLabel3D, renderKaTeX } from '/labels.js';
import type { Label3D } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import type { CompiledExpr } from '/expr.js';
import { resolveLineWidth, getAbstractWidthScale } from '/camera.js';
import type { Element } from '/types/lesson.js';

/** parseColor returns `number[]`; spreading into `new THREE.Color(...)` needs a tuple. */
type Rgb3 = [number, number, number];

/** A label whose text is driven by `labelExpr`, memoising its last rendered value. */
type DynamicLabel = Label3D & { _lastDynamicText?: string };

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
    exprStrings: string[];
    animState: { stopped: boolean };
    compiledFns: CompiledExpr[];
    _isAnimatedLine: boolean;
    _pointExprs: string[][];
    _compiledPoints: CompiledExpr[][];
}

/** A per-frame updater, as the scene loader's animation loop expects it. */
interface AnimUpdater {
    animState: { stopped: boolean };
    updateFrame(nowMs: number): void;
}

/** The slice of the shared state object this module touches. */
interface AnimatedLineState {
    lineNodes: LineEntry[];
    displayParams: { lineOpacity: number };
    activeAnimExprs: AnimExprEntry[];
    activeAnimUpdaters: AnimUpdater[];
    sceneStartTime: number;
}
const animatedLineState = state as unknown as AnimatedLineState;

export function renderAnimatedLine(el: Element, view: MathBoxNode) {
    const color = parseColor(el.color || '#88aaff') as Rgb3;
    const width = ((el.width || 3) as number) * getAbstractWidthScale(el);
    const opacity = (el.opacity !== undefined) ? Number(el.opacity) : 1;
    const baseOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
    const label = el.label;
    const labelExprString = (typeof el.labelExpr === 'string' && el.labelExpr.trim()) ? el.labelExpr.trim() : null;
    // animated_line's `points` are expression triples, not literals.
    const pointExprs = el.points as string[][] | undefined;

    if (!Array.isArray(pointExprs) || pointExprs.length < 2) return null;

    let compiledPoints = pointExprs.map(p => p.map(e => compileExpr(e)));

    function evalPoints(fns: CompiledExpr[][], tSec: number): number[][] {
        return fns.map(pfns => pfns.map(fn => evalExpr(fn, tSec) as number));
    }

    let currentPoints: number[][];
    try {
        currentPoints = evalPoints(compiledPoints, 0);
    } catch(err) {
        console.warn('animated_line eval error:', err);
        return null;
    }

    const lineEntry: LineEntry = {
        node: null,
        baseWidth: width,
        baseOpacity,
        widthParam: 'lineWidth',
        anchorDataPosFn: () => (currentPoints[Math.floor(currentPoints.length / 2)] || [0, 0, 0]),
    };
    const lineW = resolveLineWidth(lineEntry);
    const lineData = view
        .array({ channels: 3, width: currentPoints.length, data: currentPoints, live: true });
    const lineNode = lineData.line({ color: new THREE.Color(...color), width: lineW, zBias: 1, opacity: baseOpacity * (animatedLineState.displayParams.lineOpacity || 1) });
    lineEntry.node = lineNode;
    animatedLineState.lineNodes.push(lineEntry);

    let labelExprFn: CompiledExpr | null = null;
    if (labelExprString) {
        try { labelExprFn = compileExpr(labelExprString); } catch (err) { console.warn('animated_line labelExpr compile error:', err); }
    }

    let labelEl: DynamicLabel | null = null;
    if (label || labelExprFn) {
        // Compute true midpoint between first and last points
        // `!` not `?.`: the length check above guarantees both ends exist.
        const p0 = currentPoints[0]!;
        const pN = currentPoints[currentPoints.length - 1]!;
        const mid = [
            (p0[0]! + pN[0]!) / 2,
            (p0[1]! + pN[1]!) / 2,
            (p0[2]! + pN[2]!) / 2
        ];
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
    const animExprEntry: AnimExprEntry = {
        exprStrings: pointExprs.flat(),
        animState,
        compiledFns: compiledPoints.flat(),
        _isAnimatedLine: true,
        _pointExprs: pointExprs,
        _compiledPoints: compiledPoints,
    };
    animatedLineState.activeAnimExprs.push(animExprEntry);

    const startTime = animatedLineState.sceneStartTime;
    animatedLineState.activeAnimUpdaters.push({
        animState,
        updateFrame(nowMs) {
            const tSec = (nowMs - startTime) / 1000;
            const fns = animExprEntry._compiledPoints;
            try {
                const pts = evalPoints(fns, tSec);
                lineData.set('data', pts);

                if (labelEl) {
                    const lp0 = pts[0]!;
                    const lpN = pts[pts.length - 1]!;
                    labelEl.dataPos[0] = (lp0[0]! + lpN[0]!) / 2;
                    labelEl.dataPos[1] = (lp0[1]! + lpN[1]!) / 2 + 0.3;
                    labelEl.dataPos[2] = (lp0[2]! + lpN[2]!) / 2;
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
