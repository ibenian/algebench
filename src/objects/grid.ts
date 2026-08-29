import { state } from '/state.js';
import { parseColor } from '/labels.js';
import type { Element } from '/types/lesson.js';

/** parseColor returns `number[]`; spreading into `new THREE.Color(...)` needs a tuple. */
type Rgb3 = [number, number, number];

/** One axis extent, `[min, max]`. */
type Interval = [number, number];

/**
 * For each grid plane: which scene-range axes it spans (indices into
 * `[[xMin,xMax],[yMin,yMax],[zMin,zMax]]`) and the MathBox axis ids that
 * `area` wants for the same pair.
 */
const PLANE_AXES: Record<string, { scene: [number, number]; mathbox: [number, number] }> = {
    xy: { scene: [0, 1], mathbox: [1, 2] },
    xz: { scene: [0, 2], mathbox: [1, 3] },
    yz: { scene: [1, 2], mathbox: [2, 3] },
};

/** The slice of the shared state object this module reads. */
interface GridState {
    currentRange: number[][];
}
const gridState = state as unknown as GridState;

/** The `area` parameters a grid resolves to, in MathBox's own terms. */
export interface GridArea {
    rangeX: Interval;
    rangeY: Interval;
    width: number;
    height: number;
    axes: [number, number];
}

/** Coerce `[a, b]` to a finite numeric interval, or null if it isn't one. */
function toInterval(v: unknown): Interval | null {
    if (!Array.isArray(v) || v.length < 2) return null;
    const a = Number(v[0]);
    const b = Number(v[1]);
    return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

/** Division counts are whole numbers of cells; anything else falls back to 10. */
function toDivisions(v: unknown): number {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 1 ? n : 10;
}

/**
 * Resolve a grid element's two-axis extent and cell counts.
 *
 * `range` is accepted in three forms, in plane order — for `xz` the first
 * entry is x and the second is z:
 *
 *   - omitted           inherit `sceneRange` for the plane's two axes, which
 *                       is nearly always what the author meant;
 *   - `[a, b]`          one interval shared by both axes (the historical form,
 *                       correct only where the two axes span the same extent);
 *   - `[[a,b], [c,d]]`  one interval per axis;
 *   - `[[a,b], [c,d], [e,f]]`  a full 3D range, of which the plane's two axes
 *                       are taken — so a scene's own `range` can be pasted in.
 *
 * `divisions` is either one count for both axes or `[nx, ny]`. Splitting the
 * two matters because a single count cannot put grid lines on integer
 * positions along two axes of different extent.
 */
export function resolveGridArea(el: Element, sceneRange: number[][] | null | undefined): GridArea {
    const plane = el.plane || 'xy';
    const spec = PLANE_AXES[plane] || PLANE_AXES['xy']!;

    /** The scene's own extent for the i-th axis of this plane. */
    const inherited = (i: number): Interval =>
        toInterval(sceneRange && sceneRange[spec.scene[i]!]) || [-5, 5];

    const raw = el.range as unknown;
    let rangeX: Interval;
    let rangeY: Interval;
    if (Array.isArray(raw) && Array.isArray(raw[0])) {
        // Per-axis. A 3-entry range is a full 3D one, so index it by axis;
        // a 2-entry range is already in plane order.
        const pick = raw.length >= 3 ? (i: number) => raw[spec.scene[i]!] : (i: number) => raw[i];
        rangeX = toInterval(pick(0)) || inherited(0);
        rangeY = toInterval(pick(1)) || inherited(1);
    } else {
        const shared = toInterval(raw);
        rangeX = shared || inherited(0);
        rangeY = shared || inherited(1);
    }

    const divs = el.divisions as unknown;
    const perAxis = Array.isArray(divs);
    const divideX = toDivisions(perAxis ? divs[0] : divs);
    const divideY = toDivisions(perAxis ? divs[1] : divs);

    return { rangeX, rangeY, width: divideX + 1, height: divideY + 1, axes: spec.mathbox };
}

export function renderGrid(el: Element, view: MathBoxNode) {
    const color = parseColor(el.color || [0.3, 0.3, 0.5]) as Rgb3;
    const opacity = el.opacity !== undefined ? el.opacity : 0.15;
    const area = resolveGridArea(el, gridState.currentRange);

    view
        .area({
            rangeX: area.rangeX,
            rangeY: area.rangeY,
            width: area.width,
            height: area.height,
            axes: area.axes,
            channels: 3,
        })
        .surface({
            shaded: false,
            fill: false,
            lineX: true,
            lineY: true,
            color: new THREE.Color(...color),
            opacity: opacity,
            width: 1,
            zBias: -1,
        });
}
