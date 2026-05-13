import { parseColor, addLabel3D, renderKaTeX } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import { state } from '/state.js';

export function renderText(el, view) {
    const text = el.text || el.value || '';
    const color = parseColor(el.color || '#ffffff');
    const exprStrings = el.positionExpr
        || (Array.isArray(el.position) && el.position.length === 3 ? el.position.map(v => String(v)) : null)
        || (Array.isArray(el.at) && el.at.length === 3 ? el.at.map(v => String(v)) : null);

    if (Array.isArray(exprStrings) && exprStrings.length === 3) {
        let exprFns;
        let initPos;
        try {
            exprFns = exprStrings.map(e => compileExpr(e));
            initPos = exprFns.map(fn => evalExpr(fn, 0));
        } catch (err) {
            console.warn('text positionExpr compile/eval error:', err);
            return null;
        }

        const labelOpts = { align: el.align };
        const labelEl = addLabel3D(text, initPos, color, labelOpts);
        const startTime = state.sceneStartTime;

        let textExprFn = null;
        const textFormat = el.textFormat || '%d';
        if (el.textExpr) {
            try { textExprFn = compileExpr(el.textExpr); } catch (_e) { /* ignore */ }
        }
        let prevTextVal = null;

        state.activeAnimUpdaters.push({
            animState: { stopped: false },
            updateFrame(nowMs) {
                const tSec = (nowMs - startTime) / 1000;
                try {
                    const p = exprFns.map(fn => evalExpr(fn, tSec));
                    labelEl.dataPos[0] = p[0];
                    labelEl.dataPos[1] = p[1];
                    labelEl.dataPos[2] = p[2];
                } catch (_err) {}
                if (textExprFn) {
                    try {
                        const raw = evalExpr(textExprFn, tSec);
                        const rounded = Math.round(raw);
                        if (rounded !== prevTextVal) {
                            prevTextVal = rounded;
                            const formatted = textFormat.replace('%d', rounded);
                            labelEl.el.innerHTML = renderKaTeX(formatted, false);
                        }
                    } catch (_err) {}
                }
            },
        });

        return { type: 'text', color, label: text };
    }

    const position = el.position || el.at || [0, 0, 0];

    const labelOpts = { align: el.align };
    addLabel3D(text, position, color, labelOpts);

    return { type: 'text', color, label: text };
}
