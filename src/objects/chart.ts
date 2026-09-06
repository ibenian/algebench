/**
 * `chart` — a 2D plot that lives in the 3D scene as a planar object.
 *
 * The split is the same one `tensor` makes, and for the same reason. The
 * DATA is geometry: every series is a MathBox line in data coordinates, so it
 * is crisp at any angle and zoom, depth-tested and occluded like everything
 * else in the viewport. The PAPER — axes, ticks, tick labels, titles, grid —
 * is one canvas mapped onto a quad lying just behind the series, the way a
 * tensor draws its cell text and axis labels: thin lines and short text,
 * where a raster costs nothing you can see, and where a DOM label would face
 * the camera and pile up with its neighbours instead of tilting with the plot.
 *
 * Bindings follow `tensor` too. A series is an expression evaluated once per
 * sample with `i` (0-based sample index), `n` (sample count) and `x` (that
 * sample's x) bound, so a sampled distribution, a running statistic or a
 * slider-driven curve is one string each. Literal `y` arrays are the static
 * path and cost nothing per frame. Horizontal lines and bands take the same
 * scope minus `i`, which is what a ±1 s.d. band is. Domains are fixed or
 * `"auto"`, and an auto domain is niced to round tick values.
 *
 * What this is NOT: a charting library on a texture. That was considered and
 * rejected — a rasterised series blurs the moment the plane tilts, and the
 * library's own colours, fonts and legends fight the lesson's colour
 * language. Everything here is drawn from the scene's own primitives.
 */

import { state } from '/state.js';
import { parseColor } from '/labels.js';
import { compileExpr, evalExpr, explainCompileDegrade } from '/expr.js';
import type { CompiledExpr } from '/expr.js';
import { resolveLineWidth } from '/camera.js';
import { dataToWorld } from '/coords.js';
import type { Vec3 } from '/coords.js';
import type { Element, Shader } from '/types/lesson.js';
import { drawLatex, fitLatexPx, measureLatex, onLatexFontsReady } from '/latex-raster.js';
import type { BufferAttribute, CanvasTexture, Mesh, MeshBasicMaterial, Object3D, Scene } from 'three';

type Rgb3 = [number, number, number];

/** A registered line, as camera.ts's width/opacity manager expects it. */
interface LineEntry {
    node: MathBoxNode | null;
    baseWidth: number;
    baseOpacity: number;
    widthParam: string;
    anchorDataPos: number[];
}

interface AnimUpdater {
    animState: { stopped: boolean };
    updateFrame(nowMs: number): void;
}

interface ChartAnimExprEntry {
    exprStrings: string[];
    animState: { stopped: boolean };
    compiledFns: CompiledExpr[];
    _rebuildFn?: () => void;
}

interface ChartState {
    displayParams: { planeOpacity: number; lineOpacity: number };
    _planeMeshSerial: number;
    three: { scene: Scene };
    planeMeshes: Object3D[];
    lineNodes: LineEntry[];
    pointNodes: { node: MathBoxNode | null }[];
    activeAnimExprs: ChartAnimExprEntry[];
    activeAnimUpdaters: AnimUpdater[];
    sceneStartTime: number;
    _sceneJsTrustState: string | null;
}
const chartState = state as unknown as ChartState;

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers — exported so they can be pinned by tests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Round tick values covering [lo, hi] with about `count` steps: the step is
 * 1, 2 or 5 times a power of ten, and the ticks are multiples of it. Returns
 * the ticks and the step so a caller can format labels to the right decimals.
 */
export function niceTicks(lo: number, hi: number, count = 5): { ticks: number[]; step: number } {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { ticks: [], step: 1 };
    if (hi < lo) [lo, hi] = [hi, lo];
    const span = hi - lo || Math.abs(hi) || 1;
    const rough = span / Math.max(1, count - 1);
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
    const ticks: number[] = [];
    const first = Math.ceil(lo / step - 1e-9) * step;
    for (let v = first; v <= hi + step * 1e-9 && ticks.length < 50; v += step) {
        // Snap away the floating-point dust so 0.30000000000000004 reads as 0.3.
        ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
    }
    return { ticks, step };
}

/**
 * The domain to show for a set of values: their extent, padded a little so
 * the extreme samples do not sit on the frame, then widened to the nearest
 * tick multiples so the axis ends on round numbers. A flat set gets a unit
 * of room so it is still a plot and not a line on the edge.
 */
export function autoDomain(values: number[], pad = 0.05): [number, number] {
    let lo = Infinity, hi = -Infinity;
    for (const v of values) {
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    if (lo === Infinity) return [0, 1];
    if (hi - lo < 1e-12) { lo -= 0.5; hi += 0.5; }
    const span = hi - lo;
    lo -= span * pad;
    hi += span * pad;
    const { step } = niceTicks(lo, hi);
    return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

/** Format a tick value to the decimals its step needs — no trailing noise. */
export function formatTick(v: number, step: number): string {
    const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
    const s = v.toFixed(decimals);
    return s === '-0' || /^-0\.0+$/.test(s) ? s.slice(1) : s;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Per-axis metadata, as an author supplies it. `axes[0]` is x, `axes[1]` is y. */
interface AxisSpec {
    title?: unknown;
    ticks?: unknown;
    labelExpr?: unknown;
    color?: unknown;
}

interface SeriesSpec {
    id?: unknown;
    label?: unknown;
    color?: unknown;
    n?: unknown;
    xExpr?: unknown;
    yExpr?: unknown;
    x?: unknown;
    y?: unknown;
    kind?: unknown;
    width?: unknown;
    opacity?: unknown;
}

interface LineSpec {
    y?: unknown;
    yExpr?: unknown;
    color?: unknown;
    width?: unknown;
    opacity?: unknown;
}

interface BandSpec {
    lo?: unknown;
    hi?: unknown;
    loExpr?: unknown;
    hiExpr?: unknown;
    color?: unknown;
    opacity?: unknown;
}

/** Longest side of the paper canvas, in pixels; the ceiling tensor uses for its label canvas. */
const MAX_PAPER_PX = 2048;

const PLANE_AXES: Record<string, [number, number, number]> = {
    xy: [0, 1, 2],
    xz: [0, 2, 1],
    yz: [1, 2, 0],
};

export function renderChart(el: Element, view: MathBoxNode) {
    const chart = el as Element & {
        size?: unknown; xDomain?: unknown; yDomain?: unknown;
        series?: unknown; hlines?: unknown; bands?: unknown; axes?: unknown;
        textColor?: unknown; grid?: unknown;
    };

    // ── Where the plot sits ──
    const originRaw = Array.isArray(el.origin) ? el.origin : [];
    const origin = [0, 1, 2].map(i => {
        const n = Number(originRaw[i]);
        return Number.isFinite(n) ? n : 0;
    }) as Vec3;
    const sizeRaw = Array.isArray(chart.size) ? chart.size : [];
    const W = Number(sizeRaw[0]) > 0 ? Number(sizeRaw[0]) : 6;
    const H = Number(sizeRaw[1]) > 0 ? Number(sizeRaw[1]) : 3;
    const plane = (typeof el.plane === 'string' && PLANE_AXES[el.plane]) ? el.plane : 'xy';
    const [hAxis, vAxis, nAxis] = PLANE_AXES[plane]!;
    /** Data-space point from in-plane offsets, lifted `nOff` off the plane. */
    const at = (h: number, v: number, nOff = 0): Vec3 => {
        const p: Vec3 = [0, 0, 0];
        p[hAxis] = origin[0] + h;
        p[vAxis] = origin[1] + v;
        p[nAxis] = origin[2] + nOff;
        return p;
    };

    const baseColor = parseColor(el.color || '#aabbcc') as Rgb3;
    const opacity = (typeof el.opacity === 'number' && isFinite(el.opacity)) ? Math.max(0, Math.min(1, el.opacity)) : 0.9;
    const sh = (el.shader || {}) as Shader;
    // The paper is mostly transparent already (thin lines, short text), so
    // the global Planes dimmer would erase it; a chart opts out unless told
    // otherwise, the way the demo lattices do.
    const ignoresPlaneOpacity = sh.ignorePlaneOpacity !== false;
    const showGrid = chart.grid !== false;
    // `textColor` is a colour in any of the app's spellings, or 'auto' / absent for the default ink.
    const fixedTextColor = (typeof chart.textColor === 'string' && chart.textColor.trim() && chart.textColor.trim().toLowerCase() !== 'auto')
        || Array.isArray(chart.textColor) ? parseColor(chart.textColor as string | number[]) as Rgb3 : null;

    // ── Expressions: compiled through the same gate tensor uses, so a string
    // the untrusted sandbox would turn into the constant 0 disables its
    // channel with a warning rather than drawing a flat line at zero. ──
    const compileOpt = (src: unknown, what: string): { src: string; fn: CompiledExpr } | null => {
        if (typeof src !== 'string' || !src.trim()) return null;
        const s = src.trim();
        const why = explainCompileDegrade(s);
        if (why) {
            console.warn(`chart${el.id ? ` "${el.id}"` : ''}: ${what} ${why}; it is left out.`);
            return null;
        }
        try { return { src: s, fn: compileExpr(s) }; } catch (err) {
            console.warn(`chart ${what} compile error:`, err);
            return null;
        }
    };

    // ── Series ──
    interface Series {
        color: Rgb3; n: number; kind: 'line' | 'points'; width: number; opacity: number;
        xs: number[] | null; ys: number[] | null;          // literal data
        xFn: { src: string; fn: CompiledExpr } | null;     // or expressions
        yFn: { src: string; fn: CompiledExpr } | null;
        xSrc: string | null; ySrc: string | null;
        px: number[]; py: number[];                        // current sample values (data units)
        node: MathBoxNode | null; data: MathBoxNode | null; entry: LineEntry | null;
    }
    const seriesSpecs = Array.isArray(chart.series) ? (chart.series as SeriesSpec[]) : [];
    const series: Series[] = [];
    seriesSpecs.forEach((sp, k) => {
        const ys = Array.isArray(sp.y) ? sp.y.map(Number) : null;
        const xs = Array.isArray(sp.x) ? sp.x.map(Number) : null;
        // An expression wins over its literal, as tensor's valueExpr wins over
        // values; the literal is the fallback while the expression is refused.
        const yFn = compileOpt(sp.yExpr, `series[${k}].yExpr`);
        if (!ys && !yFn) {
            console.warn(`chart${el.id ? ` "${el.id}"` : ''}: series[${k}] has neither y nor a usable yExpr; skipped.`);
            return;
        }
        const xFn = compileOpt(sp.xExpr, `series[${k}].xExpr`);
        const n = Number(sp.n) > 1 ? Math.max(2, Math.min(4096, Math.floor(Number(sp.n)))) : (ys ? ys.length : 64);
        series.push({
            color: parseColor(sp.color || el.color || '#ff88aa') as Rgb3,
            n, kind: sp.kind === 'points' ? 'points' : 'line',
            width: Number(sp.width) > 0 ? Number(sp.width) : 2.5,
            opacity: Number.isFinite(Number(sp.opacity)) ? Math.max(0, Math.min(1, Number(sp.opacity))) : 1,
            xs, ys, xFn, yFn,
            xSrc: typeof sp.xExpr === 'string' ? sp.xExpr.trim() || null : null,
            ySrc: typeof sp.yExpr === 'string' ? sp.yExpr.trim() || null : null,
            px: new Array(n).fill(0), py: new Array(n).fill(0),
            node: null, data: null, entry: null,
        });
    });

    // ── Horizontal lines and bands ──
    interface HLine { color: Rgb3; width: number; opacity: number; y: number; src: string | null; fn: { src: string; fn: CompiledExpr } | null; node: MathBoxNode | null; data: MathBoxNode | null; entry: LineEntry | null; }
    const hlines: HLine[] = (Array.isArray(chart.hlines) ? (chart.hlines as LineSpec[]) : []).map((sp, k) => ({
        color: parseColor(sp.color || el.color || '#aabbcc') as Rgb3,
        width: Number(sp.width) > 0 ? Number(sp.width) : 1.5,
        opacity: Number.isFinite(Number(sp.opacity)) ? Math.max(0, Math.min(1, Number(sp.opacity))) : 0.8,
        y: Number.isFinite(Number(sp.y)) ? Number(sp.y) : 0,
        // The source outlives a refused compile so a trust change can retry it.
        src: Number.isFinite(Number(sp.y)) || typeof sp.yExpr !== 'string' ? null : sp.yExpr.trim() || null,
        fn: Number.isFinite(Number(sp.y)) ? null : compileOpt(sp.yExpr, `hlines[${k}].yExpr`),
        node: null, data: null, entry: null,
    }));
    interface Band { color: Rgb3; opacity: number; lo: number; hi: number; loSrc: string | null; hiSrc: string | null; loFn: { src: string; fn: CompiledExpr } | null; hiFn: { src: string; fn: CompiledExpr } | null; mesh: Mesh | null; attr: BufferAttribute | null; }
    const bands: Band[] = (Array.isArray(chart.bands) ? (chart.bands as BandSpec[]) : []).map((sp, k) => ({
        color: parseColor(sp.color || el.color || '#aabbcc') as Rgb3,
        opacity: Number.isFinite(Number(sp.opacity)) ? Math.max(0, Math.min(1, Number(sp.opacity))) : 0.18,
        lo: Number.isFinite(Number(sp.lo)) ? Number(sp.lo) : 0,
        hi: Number.isFinite(Number(sp.hi)) ? Number(sp.hi) : 0,
        loSrc: Number.isFinite(Number(sp.lo)) || typeof sp.loExpr !== 'string' ? null : sp.loExpr.trim() || null,
        hiSrc: Number.isFinite(Number(sp.hi)) || typeof sp.hiExpr !== 'string' ? null : sp.hiExpr.trim() || null,
        loFn: Number.isFinite(Number(sp.lo)) ? null : compileOpt(sp.loExpr, `bands[${k}].loExpr`),
        hiFn: Number.isFinite(Number(sp.hi)) ? null : compileOpt(sp.hiExpr, `bands[${k}].hiExpr`),
        mesh: null, attr: null,
    }));

    // ── Axes ──
    const axes = Array.isArray(chart.axes) ? (chart.axes as AxisSpec[]) : [];
    const xAxis = axes[0], yAxis = axes[1];
    const xTitle = xAxis && xAxis.title ? String(xAxis.title) : null;
    const yTitle = yAxis && yAxis.title ? String(yAxis.title) : null;
    const xTickCount = Number(xAxis?.ticks) > 1 ? Math.floor(Number(xAxis!.ticks)) : 5;
    const yTickCount = Number(yAxis?.ticks) > 1 ? Math.floor(Number(yAxis!.ticks)) : 5;
    const xLabelSrc = typeof xAxis?.labelExpr === 'string' ? xAxis.labelExpr.trim() || null : null;
    const yLabelSrc = typeof yAxis?.labelExpr === 'string' ? yAxis.labelExpr.trim() || null : null;
    let xLabelFn = compileOpt(xLabelSrc, 'axes[0].labelExpr');
    let yLabelFn = compileOpt(yLabelSrc, 'axes[1].labelExpr');
    const xColor = parseColor((xAxis && xAxis.color) || '#aabbcc') as Rgb3;
    const yColor = parseColor((yAxis && yAxis.color) || '#aabbcc') as Rgb3;

    const xFixed = Array.isArray(chart.xDomain) && chart.xDomain.length === 2 && chart.xDomain.every(v => Number.isFinite(Number(v)))
        ? [Number(chart.xDomain[0]), Number(chart.xDomain[1])] as [number, number] : null;
    const yFixed = Array.isArray(chart.yDomain) && chart.yDomain.length === 2 && chart.yDomain.every(v => Number.isFinite(Number(v)))
        ? [Number(chart.yDomain[0]), Number(chart.yDomain[1])] as [number, number] : null;
    let xDom: [number, number] = xFixed || [0, 1];
    let yDom: [number, number] = yFixed || [0, 1];

    /** Plot-space (h, v) in data units for a data point (x, y) under the current domains. */
    const toPlane = (x: number, y: number): [number, number] => [
        ((x - xDom[0]) / ((xDom[1] - xDom[0]) || 1)) * W,
        ((y - yDom[0]) / ((yDom[1] - yDom[0]) || 1)) * H,
    ];

    // ── Evaluate everything at `tSec` into the sample arrays and domains ──
    // Declared, not compiled: a channel refused under the untrusted state
    // must still register the updater so a trust change can bring it back.
    const live = series.some(s => s.xSrc || s.ySrc) || hlines.some(l => l.src) || bands.some(b => b.loSrc || b.hiSrc) || !!xLabelSrc || !!yLabelSrc;
    function sample(tSec: number) {
        for (const s of series) {
            const scope = { i: 0, n: s.n, x: 0 };
            for (let i = 0; i < s.n; i++) {
                scope.i = i;
                let x: number;
                if (s.xFn) { try { x = Number(evalExpr(s.xFn.fn, tSec, { overrideScope: scope })); } catch (_e) { x = i; } }
                else if (s.xs) x = s.xs[i] ?? i;
                else x = i;
                if (!Number.isFinite(x)) x = i;
                scope.x = x;
                let y: number;
                if (s.yFn) { try { y = Number(evalExpr(s.yFn.fn, tSec, { overrideScope: scope })); } catch (_e) { y = NaN; } }
                else y = s.ys ? (s.ys[i] ?? 0) : NaN;
                s.px[i] = x;
                s.py[i] = Number.isFinite(y) ? y : NaN;
            }
        }
        // Reference lines and bands are one number each, so they see the
        // plain scene scope (sliders, t, domain functions) with no i/n/x.
        for (const l of hlines) {
            if (l.fn) { try { const v = Number(evalExpr(l.fn.fn, tSec, {})); if (Number.isFinite(v)) l.y = v; } catch (_e) { /* keep */ } }
        }
        for (const b of bands) {
            if (b.loFn) { try { const v = Number(evalExpr(b.loFn.fn, tSec, {})); if (Number.isFinite(v)) b.lo = v; } catch (_e) { /* keep */ } }
            if (b.hiFn) { try { const v = Number(evalExpr(b.hiFn.fn, tSec, {})); if (Number.isFinite(v)) b.hi = v; } catch (_e) { /* keep */ } }
        }
        if (!xFixed) {
            const xs: number[] = [];
            for (const s of series) for (const x of s.px) xs.push(x);
            xDom = autoDomain(xs, 0);
        }
        if (!yFixed) {
            const ys: number[] = [];
            for (const s of series) for (const y of s.py) ys.push(y);
            for (const l of hlines) ys.push(l.y);
            for (const b of bands) { ys.push(b.lo); ys.push(b.hi); }
            yDom = autoDomain(ys);
        }
    }

    // ── Geometry: series as MathBox lines (data coordinates, so MathBox maps
    // them), bands as quads on the paper, all just in front of the paper. ──
    const lift = Math.min(W, H) * 0.01;
    const seriesPoints = (s: Series): Vec3[] => {
        const pts: Vec3[] = [];
        for (let i = 0; i < s.n; i++) {
            const y = Number.isFinite(s.py[i]!) ? s.py[i]! : yDom[0];
            const [h, v] = toPlane(s.px[i]!, y);
            pts.push(at(h, v, lift * 3));
        }
        return pts;
    };

    try { sample(0); } catch (err) { console.warn('chart sample error:', err); }

    const lineOpacity = chartState.displayParams.lineOpacity || 1;
    for (const s of series) {
        const pts = seriesPoints(s);
        const entry: LineEntry = { node: null, baseWidth: s.width, baseOpacity: s.opacity, widthParam: 'lineWidth', anchorDataPos: pts[Math.floor(pts.length / 2)] || at(W / 2, H / 2) };
        const lineW = resolveLineWidth(entry);
        const data = view.array({ channels: 3, width: pts.length, data: pts, live: true });
        const node = s.kind === 'points'
            ? data.point({ color: new THREE.Color(...s.color), size: lineW * 3, opacity: s.opacity * lineOpacity, zBias: 2 })
            : data.line({ color: new THREE.Color(...s.color), width: lineW, opacity: s.opacity * lineOpacity, zBias: 2 });
        entry.node = node;
        s.node = node; s.data = data; s.entry = entry;
        // A point primitive has `size`, not `width`; it lives with the other
        // points, outside the line-width updater's reach.
        if (s.kind === 'points') chartState.pointNodes.push({ node }); else chartState.lineNodes.push(entry);
    }
    for (const l of hlines) {
        const [, v] = toPlane(0, l.y);
        const pts = [at(0, v, lift * 2), at(W, v, lift * 2)];
        const entry: LineEntry = { node: null, baseWidth: l.width, baseOpacity: l.opacity, widthParam: 'lineWidth', anchorDataPos: at(W / 2, v) };
        const lineW = resolveLineWidth(entry);
        const data = view.array({ channels: 3, width: 2, data: pts, live: true });
        const node = data.line({ color: new THREE.Color(...l.color), width: lineW, opacity: l.opacity * lineOpacity, zBias: 1 });
        entry.node = node;
        l.node = node; l.data = data; l.entry = entry;
        chartState.lineNodes.push(entry);
    }

    const serial = el.renderOrder !== undefined ? el.renderOrder : chartState._planeMeshSerial++;
    /** A quad mesh over plot-space rect, as the paper and bands need. */
    const makeQuad = (color: Rgb3, opac: number, order: number, dynamic: boolean) => {
        const pos = new Float32Array(6 * 3);
        const attr = new THREE.BufferAttribute(pos, 3);
        if (dynamic) attr.setUsage(THREE.DynamicDrawUsage);
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', attr);
        const mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(...color), transparent: true,
            opacity: ignoresPlaneOpacity ? opac : chartState.displayParams.planeOpacity * opac,
            side: THREE.DoubleSide, depthWrite: false,
        });
        const mesh = new THREE.Mesh(geom, mat);
        // The vertices are written after creation and, for a band, rewritten
        // every frame; two triangles are not worth a bounding sphere that
        // would go stale and cull the quad, so skip the frustum test.
        mesh.frustumCulled = false;
        mesh.userData.targetOpacity = opac;
        mesh.userData.ignorePlaneOpacity = ignoresPlaneOpacity;
        mesh.renderOrder = order;
        chartState.three.scene.add(mesh);
        chartState.planeMeshes.push(mesh);
        return { mesh, attr };
    };
    const writeQuad = (attr: BufferAttribute, h0: number, h1: number, v0: number, v1: number, nOff: number) => {
        const P = [at(h0, v0, nOff), at(h1, v0, nOff), at(h1, v1, nOff), at(h0, v1, nOff)].map(dataToWorld);
        const order = [0, 1, 2, 0, 2, 3];
        const a = attr.array as Float32Array;
        for (let i = 0; i < 6; i++) { const p = P[order[i]!]!; a[i * 3] = p[0]; a[i * 3 + 1] = p[1]; a[i * 3 + 2] = p[2]; }
        attr.needsUpdate = true;
    };
    /** A band's quad, clipped to the plot area; a band wholly outside it collapses to nothing. */
    const placeBand = (b: Band) => {
        if (!b.attr) return;
        const [, v0] = toPlane(0, Math.min(b.lo, b.hi)), [, v1] = toPlane(0, Math.max(b.lo, b.hi));
        writeQuad(b.attr, 0, W, Math.max(0, Math.min(H, v0)), Math.max(0, Math.min(H, v1)), lift);
    };
    for (const b of bands) {
        const q = makeQuad(b.color, b.opacity, serial + 1, true);
        b.mesh = q.mesh; b.attr = q.attr;
        placeBand(b);
    }

    // ── The paper: a canvas over the plot plus margins for tick labels and
    // titles, redrawn only when a tick label or title changes. ──
    const mL = yTitle ? 1.6 : 1.1;    // room for y tick labels (+ a rotated title)
    const mB = xTitle ? 1.1 : 0.7;    // room for x tick labels (+ a title)
    const mT = 0.25, mR = 0.35;
    // Pixel density from the paper's longer side so the canvas never exceeds
    // MAX_PAPER_PX a side, the same ceiling tensor puts on its label canvas
    // and comfortably under any GPU's texture limit; a huge chart just gets
    // coarser paper.
    const paperW = W + mL + mR, paperH = H + mB + mT;
    const pxPer = Math.max(1, Math.min(160, Math.floor(MAX_PAPER_PX / Math.max(paperW, paperH))));
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(MAX_PAPER_PX, Math.ceil(paperW * pxPer));
    canvas.height = Math.min(MAX_PAPER_PX, Math.ceil(paperH * pxPer));
    const ctx = canvas.getContext('2d');
    let tex: CanvasTexture | null = null;
    let paperKey = '';
    let lastT = 0;
    const css = (c: Rgb3, a = 1) => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;
    const inkRgb: Rgb3 = fixedTextColor || [0.86, 0.88, 0.92];
    if (ctx) {
        tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        const paper = makeQuad([1, 1, 1], opacity, serial, false);
        const paperMat = paper.mesh.material as MeshBasicMaterial;
        paperMat.map = tex;
        paperMat.color.set(0xffffff);
        paperMat.alphaTest = 0.02;
        // Disposing a material does not dispose its map; free the canvas
        // texture with the mesh the loader tears down.
        // KaTeX faces load on first use; a paper painted before they arrive
        // was laid out in the fallback font, so repaint when they settle.
        const offFonts = onLatexFontsReady(() => { paperKey = ''; try { paintPaper(lastT); } catch (_e) { /* next frame */ } });
        paperMat.addEventListener('dispose', () => { offFonts(); tex && tex.dispose(); });
        const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
        paper.mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        writeQuad(paper.attr, -mL, W + mR, -mB, H + mT, 0);
    }

    /** Tick label text: the axis's labelExpr with `value` bound, else the value to the step's decimals. */
    const tickText = (fn: { fn: CompiledExpr } | null, v: number, step: number, tSec: number): string => {
        if (fn) { try { const out = evalExpr(fn.fn, tSec, { overrideScope: { value: v } }); return (out === null || out === undefined) ? '' : String(out); } catch (_e) { return ''; } }
        return formatTick(v, step);
    };

    function paintPaper(tSec: number) {
        if (!ctx || !tex) return;
        lastT = tSec;
        const xt = niceTicks(xDom[0], xDom[1], xTickCount);
        const yt = niceTicks(yDom[0], yDom[1], yTickCount);
        const xLabels = xt.ticks.map(v => tickText(xLabelFn, v, xt.step, tSec));
        const yLabels = yt.ticks.map(v => tickText(yLabelFn, v, yt.step, tSec));
        const key = [xDom.join(','), yDom.join(','), xLabels.join(''), yLabels.join('')].join('');
        if (key === paperKey) return;
        paperKey = key;

        const cw = canvas.width, ch = canvas.height;
        ctx.clearRect(0, 0, cw, ch);
        // plot rect in canvas pixels (canvas y runs down)
        const X = (h: number) => (mL + h) * pxPer;
        const Y = (v: number) => ch - (mB + v) * pxPer;
        // a faint sheet behind the plot area so the series read against any background
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(X(0), Y(H), W * pxPer, H * pxPer);
        // grid
        if (showGrid) {
            ctx.strokeStyle = css(inkRgb, 0.14);
            ctx.lineWidth = Math.max(1, pxPer * 0.012);
            for (const v of xt.ticks) { const [h] = toPlane(v, 0); if (h < -1e-6 || h > W + 1e-6) continue; ctx.beginPath(); ctx.moveTo(X(h), Y(0)); ctx.lineTo(X(h), Y(H)); ctx.stroke(); }
            for (const v of yt.ticks) { const [, vv] = toPlane(0, v); if (vv < -1e-6 || vv > H + 1e-6) continue; ctx.beginPath(); ctx.moveTo(X(0), Y(vv)); ctx.lineTo(X(W), Y(vv)); ctx.stroke(); }
        }
        // zero lines, a shade stronger, when zero is inside a domain
        ctx.strokeStyle = css(inkRgb, 0.35);
        ctx.lineWidth = Math.max(1, pxPer * 0.02);
        if (yDom[0] < 0 && yDom[1] > 0) { const [, v0] = toPlane(0, 0); ctx.beginPath(); ctx.moveTo(X(0), Y(v0)); ctx.lineTo(X(W), Y(v0)); ctx.stroke(); }
        if (xDom[0] < 0 && xDom[1] > 0) { const [h0] = toPlane(0, 0); ctx.beginPath(); ctx.moveTo(X(h0), Y(0)); ctx.lineTo(X(h0), Y(H)); ctx.stroke(); }
        // axes
        ctx.strokeStyle = css(xColor, 0.9);
        ctx.lineWidth = Math.max(1, pxPer * 0.03);
        ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(W), Y(0)); ctx.stroke();
        ctx.strokeStyle = css(yColor, 0.9);
        ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(0), Y(H)); ctx.stroke();
        // tick marks and labels
        const tickLen = pxPer * 0.12;
        ctx.fillStyle = css(xColor); ctx.strokeStyle = css(xColor, 0.9);
        xt.ticks.forEach((v, k) => {
            const [h] = toPlane(v, 0); if (h < -1e-6 || h > W + 1e-6) return;
            ctx.beginPath(); ctx.moveTo(X(h), Y(0)); ctx.lineTo(X(h), Y(0) + tickLen); ctx.stroke();
            const txt = xLabels[k] || '';
            if (!txt) return;
            drawLatex(ctx, txt, X(h), Y(0) + tickLen + pxPer * 0.06, { fontPx: fitLatexPx(txt, pxPer * 0.9, pxPer * 0.42), color: css(xColor), align: 'center', vAlign: 'top' });
        });
        ctx.fillStyle = css(yColor); ctx.strokeStyle = css(yColor, 0.9);
        let yLabelW = 0;   // widest tick label, so the title sits right beside the numbers
        yt.ticks.forEach((v, k) => {
            const [, vv] = toPlane(0, v); if (vv < -1e-6 || vv > H + 1e-6) return;
            ctx.beginPath(); ctx.moveTo(X(0), Y(vv)); ctx.lineTo(X(0) - tickLen, Y(vv)); ctx.stroke();
            const txt = yLabels[k] || '';
            if (!txt) return;
            const fontPx = fitLatexPx(txt, pxPer * 0.85, pxPer * 0.42);
            yLabelW = Math.max(yLabelW, measureLatex(txt).w * fontPx / 100);
            drawLatex(ctx, txt, X(0) - tickLen - pxPer * 0.06, Y(vv), { fontPx, color: css(yColor), align: 'right', vAlign: 'middle' });
        });
        // titles
        if (xTitle) {
            drawLatex(ctx, xTitle, X(W / 2), Y(0) + pxPer * 0.82, { fontPx: fitLatexPx(xTitle, W * pxPer, pxPer * 0.5), color: css(xColor) });
        }
        if (yTitle) {
            const fontPx = fitLatexPx(yTitle, H * pxPer, pxPer * 0.5);
            const titleH = measureLatex(yTitle).h * fontPx / 100;
            const cx = Math.max(titleH / 2, X(0) - tickLen - pxPer * 0.16 - yLabelW - titleH / 2);
            drawLatex(ctx, yTitle, cx, Y(H / 2), { fontPx, color: css(yColor), rotate: -Math.PI / 2 });
        }
        tex.needsUpdate = true;
    }
    try { paintPaper(0); } catch (err) { console.warn('chart paper error:', err); }

    /** Push the current samples into the lines and bands. */
    function place() {
        for (const s of series) if (s.data) s.data.set('data', seriesPoints(s));
        for (const l of hlines) if (l.data) { const [, v] = toPlane(0, l.y); l.data.set('data', [at(0, v, lift * 2), at(W, v, lift * 2)]); }
        for (const b of bands) placeBand(b);
    }

    const animState = { stopped: false };
    const legendLabel = el.label || (series.length === 1 && seriesSpecs[0] && typeof seriesSpecs[0].label === 'string' ? seriesSpecs[0].label : undefined);
    if (!live) {
        return { type: 'chart', color: baseColor, label: legendLabel };
    }

    const exprStrings = [
        ...series.flatMap(s => [s.xSrc, s.ySrc]),
        ...hlines.map(l => l.src),
        ...bands.flatMap(b => [b.loSrc, b.hiSrc]),
        xLabelSrc, yLabelSrc,
    ].filter((x): x is string => !!x);
    let compiledUnderTrust = chartState._sceneJsTrustState;
    const fns = () => [
        ...series.flatMap(s => [s.xFn?.fn, s.yFn?.fn]),
        ...hlines.map(l => l.fn?.fn), ...bands.flatMap(b => [b.loFn?.fn, b.hiFn?.fn]),
        xLabelFn?.fn, yLabelFn?.fn,
    ].filter((x): x is CompiledExpr => !!x);
    const entry: ChartAnimExprEntry = {
        exprStrings, animState, compiledFns: fns(),
        _rebuildFn() {
            if (chartState._sceneJsTrustState === compiledUnderTrust) return;
            compiledUnderTrust = chartState._sceneJsTrustState;
            series.forEach((s, k) => {
                if (s.ySrc) s.yFn = compileOpt(s.ySrc, `series[${k}].yExpr`);
                if (s.xSrc) s.xFn = compileOpt(s.xSrc, `series[${k}].xExpr`);
            });
            hlines.forEach((l, k) => { if (l.src) l.fn = compileOpt(l.src, `hlines[${k}].yExpr`); });
            bands.forEach((b, k) => {
                if (b.loSrc) b.loFn = compileOpt(b.loSrc, `bands[${k}].loExpr`);
                if (b.hiSrc) b.hiFn = compileOpt(b.hiSrc, `bands[${k}].hiExpr`);
            });
            if (xLabelSrc) xLabelFn = compileOpt(xLabelSrc, 'axes[0].labelExpr');
            if (yLabelSrc) yLabelFn = compileOpt(yLabelSrc, 'axes[1].labelExpr');
            paperKey = '';   // tick labels may have changed with the recompile
            entry.compiledFns = fns();
        },
    };
    chartState.activeAnimExprs.push(entry);

    const startTime = chartState.sceneStartTime;
    chartState.activeAnimUpdaters.push({
        animState,
        updateFrame(nowMs) {
            const tSec = (nowMs - startTime) / 1000;
            try {
                sample(tSec);
                place();
                paintPaper(tSec);
            } catch (_err) { /* keep the last frame */ }
        },
    });

    return { type: 'chart', color: baseColor, label: legendLabel, _animState: animState, _animExprEntry: entry };
}
