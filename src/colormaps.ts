/**
 * Colormaps — turn a scalar in [0,1] into an RGB triple.
 *
 * One implementation serves two callers that would otherwise drift: `polygon`'s
 * static `gradient.stops`, and the per-cell colour of a `tensor`. Keeping them
 * on the same interpolator is the point — a two-stop colormap and a two-stop
 * gradient must produce the same colour, or an author who reaches for one after
 * the other gets a silent mismatch.
 *
 * Colours are normalized RGB (0-1), which is what `parseColor` returns and what
 * `THREE.Color.setRGB` wants, so nothing converts on the way through.
 */

import { parseColor } from '/labels.js';

/** A colour ramp: `u` in [0,1] → `[r,g,b]` in [0,1]. */
export type ColorMapFn = (u: number) => number[];

/** One stop on a ramp. `t` is the position; `color` is anything parseColor takes. */
export interface ColorStop {
    t: number;
    color: unknown;
}

/**
 * Build a ramp from stops.
 *
 * Stops are sorted by `t`, so an author may list them in any order. Values
 * outside the stop range **clamp** to the terminal stops rather than
 * extrapolating — extrapolating an RGB ramp produces out-of-gamut colours that
 * three.js silently saturates, which reads as "the heatmap has a flat top".
 */
export function buildStopsFn(stops: ColorStop[]): ColorMapFn {
    const sorted = stops.slice().sort((a, b) => a.t - b.t);
    const parsed = sorted.map(s => ({ t: s.t, c: parseColor(s.color) }));
    // A single stop is a constant colour, not a ramp; guarding here keeps the
    // interpolation loop below free of a length-1 special case.
    if (parsed.length === 1) {
        const only = parsed[0]!.c;
        return () => only.slice();
    }
    return (u: number) => {
        if (!(u > parsed[0]!.t)) return parsed[0]!.c.slice();
        const last = parsed[parsed.length - 1]!;
        if (u >= last.t) return last.c.slice();
        for (let i = 0; i < parsed.length - 1; i++) {
            const hi = parsed[i + 1]!;
            if (u <= hi.t) {
                const lo = parsed[i]!;
                const span = hi.t - lo.t;
                // Coincident stops are a hard colour break, not a divide-by-zero.
                const f = span === 0 ? 0 : (u - lo.t) / span;
                return [
                    lo.c[0]! + f * (hi.c[0]! - lo.c[0]!),
                    lo.c[1]! + f * (hi.c[1]! - lo.c[1]!),
                    lo.c[2]! + f * (hi.c[2]! - lo.c[2]!),
                ];
            }
        }
        return last.c.slice();
    };
}

/**
 * Named ramps, as 9 evenly-spaced stops each.
 *
 * `viridis` and `magma` are perceptually uniform and stay legible in both
 * themes — the default choice for a non-negative quantity. `blueRed` is
 * diverging and is correct **only** for signed data; using it for something
 * non-negative (an attention weight, a probability) implies a sign that isn't
 * there.
 */
const NAMED_STOPS: Record<string, string[]> = {
    viridis: ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'],
    magma: ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55964', '#fb8761', '#fec287', '#fcfdbf'],
    blueRed: ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b'],
};

const DEFAULT_MAP = 'viridis';

function namedMap(name: string): ColorMapFn {
    const hexes = NAMED_STOPS[name] || NAMED_STOPS[DEFAULT_MAP]!;
    return buildStopsFn(hexes.map((color, i) => ({ t: i / (hexes.length - 1), color })));
}

/**
 * Resolve a `colorMap` value into a ramp.
 *
 * Accepts a name, a `{stops:[…]}` object, or nothing (→ the default). An
 * unknown name falls back rather than throwing: a misspelled colormap should
 * cost the author the palette they wanted, not the whole scene.
 */
export function buildColorMap(spec: unknown): ColorMapFn {
    if (spec && typeof spec === 'object') {
        const stops = (spec as { stops?: unknown }).stops;
        if (Array.isArray(stops) && stops.length > 0) {
            return buildStopsFn(stops as ColorStop[]);
        }
    }
    if (typeof spec === 'string' && spec) {
        if (!NAMED_STOPS[spec]) {
            console.warn(`Unknown colorMap "${spec}" — falling back to ${DEFAULT_MAP}`);
        }
        return namedMap(spec);
    }
    return namedMap(DEFAULT_MAP);
}

/**
 * Normalize a raw cell value onto [0,1] over `domain`, or `null` when it
 * is not a usable number.
 *
 * Returning `null` rather than 0 for a bad value matters: 0 is a legitimate
 * colour at the cold end of the ramp, so a caller that cannot distinguish
 * "black because the value is low" from "black because the expression returned
 * a matrix" has no way to keep the previous frame's colour instead.
 */
export function normalizeColorValue(raw: unknown, domain: unknown): number | null {
    const v = Number(raw);
    if (!Number.isFinite(v)) return null;
    let lo = 0;
    let hi = 1;
    if (Array.isArray(domain) && domain.length >= 2) {
        const a = Number(domain[0]);
        const b = Number(domain[1]);
        if (Number.isFinite(a) && Number.isFinite(b)) {
            lo = a;
            hi = b;
        }
    }
    // A zero-width domain has no meaningful position within it; pin to the cold
    // end rather than producing NaN.
    if (hi === lo) return 0;
    const u = (v - lo) / (hi - lo);
    return u < 0 ? 0 : u > 1 ? 1 : u;
}
