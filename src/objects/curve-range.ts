// Where a parametric curve starts and stops.
//
// Its OWN module, with no imports that run: `parametric-curve.ts` reaches
// `overlay.ts` through `/labels.js`, which assigns to `window` at module scope,
// so importing the renderer under Node needs a DOM before it needs any of this.
// Splitting the pure part out is what `grid.ts` does for `resolveGridArea`, and
// it lets the test below run with no stubs at all.

import type { Element } from '/types/lesson.js';


/** The interval a parametric curve is sampled over: `rangeExpr`, else `range`,
 *  else `[0, 2π]`. Each end may be a number or a math.js string.
 *
 * `rangeExpr` FIRST, which `animated-curve.ts` has always done and this module
 * had never done. A curve's interval goes to `rangeExpr` the moment either end
 * is an expression — `0` to `4*pi`, or an end naming a slider — so reading only
 * `range` silently fell back to [0, 2π] and drew a shorter curve than the scene
 * asked for. No error and no warning: the endpoints it ignored were still
 * schema-legal, and subtracting the fallback's gives a perfectly good number.
 *
 * Observed on a DNA double helix whose strands ran `0` to `4*pi`. They stopped
 * half way up a ladder of rungs that spanned the whole length, because the rungs
 * were `line`s placed from the very numbers the curve discarded. Nothing in the
 * corpus writes `rangeExpr` on a parametric curve, which is why it survived —
 * the in-app scene builder is the first thing to emit one.
 *
 * `evaluate` is injected so this stays testable without math.js, and so the
 * caller can compile once and re-evaluate per build.
 */
export function resolveCurveRange(
    el: Element,
    evaluate: (expr: string) => number,
): [number, number] {
    const spec = (el.rangeExpr || el.range
        || [0, 2 * Math.PI]) as [number | string, number | string];
    // A non-finite end is the fallback's, not NaN: one bad expression would
    // otherwise make `dt` NaN and collapse every sample onto the origin.
    const end = (raw: number | string, fallback: number): number => {
        let v: number;
        try {
            v = typeof raw === 'string' ? evaluate(raw) : Number(raw);
        } catch { return fallback; }
        return Number.isFinite(v) ? v : fallback;
    };
    return [end(spec[0], 0), end(spec[1], 2 * Math.PI)];
}
