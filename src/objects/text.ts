import { parseColor, addLabel3D, renderKaTeX } from '/labels.js';
import type { Label3DOptions } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import type { CompiledExpr } from '/expr.js';
import { state } from '/state.js';
import type { Element } from '/types/lesson.js';

/** parseColor returns `number[]`; addLabel3D takes it as the label color. */
type Rgb3 = [number, number, number];

/** A per-frame updater, as the scene loader's animation loop expects it. */
interface AnimUpdater {
    animState: { stopped: boolean };
    updateFrame(nowMs: number): void;
}

/** The slice of the shared state object this module touches. */
interface TextState {
    sceneStartTime: number;
    activeAnimUpdaters: AnimUpdater[];
}
const textState = state as unknown as TextState;

export function renderText(el: Element, view: MathBoxNode) {
    const text = el.text || el.value || '';
    const color = parseColor(el.color || '#ffffff') as Rgb3;
    const exprStrings = el.positionExpr
        || (Array.isArray(el.position) && el.position.length === 3 ? el.position.map(v => String(v)) : null)
        || (Array.isArray(el.at) && el.at.length === 3 ? el.at.map(v => String(v)) : null);

    if (Array.isArray(exprStrings) && exprStrings.length === 3) {
        let exprFns: CompiledExpr[];
        let initPos: number[];
        try {
            exprFns = exprStrings.map(e => compileExpr(e));
            initPos = exprFns.map(fn => evalExpr(fn, 0) as number);
        } catch (err) {
            console.warn('text positionExpr compile/eval error:', err);
            return null;
        }

        const labelOpts: Label3DOptions = { align: el.align, cssClass: el.cssClass };
        const labelEl = addLabel3D(text, initPos, color, labelOpts);
        const startTime = textState.sceneStartTime;

        let textExprFn: CompiledExpr | null = null;
        const textFormat = el.textFormat || '%d';
        if (el.textExpr) {
            try { textExprFn = compileExpr(el.textExpr); } catch (_e) { /* ignore */ }
        }
        let prevTextVal: number | null = null;

        let visibleFn: CompiledExpr | null = null;
        if (typeof el.visibleExpr === 'string' && el.visibleExpr.trim()) {
            try { visibleFn = compileExpr(el.visibleExpr.trim()); } catch (err) {
                console.warn('text visibleExpr compile error:', err);
            }
        }
        let prevVisible: boolean | null = null;

        textState.activeAnimUpdaters.push({
            animState: { stopped: false },
            updateFrame(nowMs) {
                const tSec = (nowMs - startTime) / 1000;
                try {
                    const p = exprFns.map(fn => evalExpr(fn, tSec) as number);
                    labelEl.dataPos[0] = p[0]!;
                    labelEl.dataPos[1] = p[1]!;
                    labelEl.dataPos[2] = p[2]!;
                } catch (_err) {}
                if (visibleFn) {
                    try {
                        const vis = !!evalExpr(visibleFn, tSec);
                        if (vis !== prevVisible) {
                            prevVisible = vis;
                            labelEl.el.style.visibility = vis ? '' : 'hidden';
                        }
                    } catch (_err) {}
                }
                if (textExprFn) {
                    try {
                        const raw = evalExpr(textExprFn, tSec);
                        if (!Number.isFinite(raw)) return;
                        const rounded = Math.round(raw as number);
                        if (rounded !== prevTextVal) {
                            prevTextVal = rounded;
                            // String.replace types the replacement as a string; the
                            // original relied on JS coercing the number, and the
                            // emitted call is unchanged.
                            const formatted = textFormat.replace('%d', rounded as unknown as string);
                            labelEl.el.innerHTML = renderKaTeX(formatted, false);
                        }
                    } catch (_err) {}
                }
            },
        });

        return { type: 'text', color, label: text };
    }

    const position = (el.position || el.at || [0, 0, 0]) as number[];

    const labelOpts: Label3DOptions = { align: el.align, cssClass: el.cssClass };
    addLabel3D(text, position, color, labelOpts);

    return { type: 'text', color, label: text };
}
