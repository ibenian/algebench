// ============================================================
// Slider System — build slider UI, loop animation, drag,
// animated-expression registry, and programmatic animation.
// ============================================================

import { state } from '/state.js';
import { compileExpr, evalExpr, recompileActiveSceneFunctions, _getMathNamesAndValues,
         type CompiledExpr } from '/expr.js';
import { renderKaTeX, stripLatex } from '/labels.js';
import type { Slider } from '/types/lesson.js';

/**
 * A slider definition as it appears in lesson JSON, plus `animationMode` —
 * a legacy spelling of `animateMode` that registerSliders still honours but
 * the schema never documented. Kept because scenes in the wild use it.
 */
export interface SliderDef extends Slider {
    animationMode?: string;
}

/** A registered slider, as registerSliders() builds it into sliderState.sceneSliders.
 *  A tensor slider (`kind: 'tensor'`) keeps its table in `values` (flat,
 *  row-major, `shape` long) and leaves `value` NaN, so every scalar path
 *  (deep links, the status pill, animation) treats it as absent. */
export interface SceneSlider {
    value: number;
    min: number;
    max: number;
    step: number;
    label: string;
    default: number | undefined;
    kind: 'scalar' | 'tensor';
    shape: number[] | null;
    values: number[] | null;
    defaults: number[] | null;
    /** The nested table handed to expressions; rebuilt lazily after an edit. */
    _nested: number[] | number[][] | null;
    animate: boolean;
    animateMode: string;
    autoplay: boolean;
    duration: number;
    _loopPlaying: boolean;
    _loopRaf: number | null;
    _valueExprString: string | null;
    _valueExprCompiled: CompiledExpr | null;
    /** Bounds an author wrote as expressions, so a selector can be bounded by
     *  the configuration it indexes into (`demo_h` by `tfHeads() - 1`) instead
     *  of by a number fixed when the scene was written. Null when the author
     *  gave plain numbers, which is the common case. */
    _minExprString: string | null;
    _maxExprString: string | null;
    _minExprCompiled: CompiledExpr | null;
    _maxExprCompiled: CompiledExpr | null;
    /** The bounds as declared. `value` is clamped into the live range, but the
     *  readout width is reserved from these, so a moving bound cannot shrink
     *  the track and reintroduce the drag jitter #649 fixed. */
    _staticMin: number;
    _staticMax: number;
    /** Where the user last put this slider, before any clamping. A shrinking
     *  range clamps what expressions see; widening it again restores this, so
     *  a configuration change does not quietly discard the chosen position. */
    _desired: number;
    /** True while animateSlider() is tweening this slider. Distinct from
     *  `_loopPlaying`, which is the looping sweep: both mean "the position on
     *  screen belongs to an animation, not to a request", but they start and
     *  stop independently. */
    _tweening?: boolean;
    /** Installed by buildSliderOverlay() for sliders that render a play button. */
    _onPlayStateChange?: () => void;
    /** Installed by buildSliderOverlay() so refreshSliderBounds() can push new
     *  bounds into the row without rebuilding the whole panel. */
    _onBoundsChange?: () => void;
}

/** The compiled regular-polygon expressions an animated_polygon entry carries. */
interface RegularPolygonState {
    cN: CompiledExpr;
    cR: CompiledExpr;
    cCx: CompiledExpr;
    cCy: CompiledExpr;
    cCz: CompiledExpr;
    cRot: CompiledExpr;
}

/**
 * A live expression-driven element. Each object renderer in src/objects/
 * declares its own narrow view of this record and pushes only the fields it
 * uses; this module is the one place that sees the union of all of them, so
 * everything but `animState` is optional here.
 */
export interface AnimExprEntry {
    animState: { stopped: boolean } | null;
    exprStrings?: string[];
    compiledFns?: CompiledExpr[] | null;
    _rebuildFn?: () => void;
    fromExprStrings?: string[] | null;
    fromExprFns?: CompiledExpr[] | null;
    radiusExprString?: string | null;
    radiusFn?: CompiledExpr | null;
    visibleExprString?: string | null;
    visibleFn?: CompiledExpr | null;
    _isAnimatedPolygon?: boolean;
    _vertexExprs?: string[][];
    _compiledVerts?: CompiledExpr[][];
    _isRegularPolygon?: boolean;
    _regExprs?: string[];
    _regState?: RegularPolygonState;
    _isAnimatedLine?: boolean;
    _pointExprs?: string[][];
    _compiledPoints?: CompiledExpr[][];
}

/** A per-frame updater, driven by the scene loader's animation loop. */
export interface AnimUpdater {
    animState: { stopped: boolean } | null;
    updateFrame(nowMs: number): void;
}

/** Follow-cam expression state, recompiled here when the slider set changes. */
interface FollowCamState {
    exprStrings?: string[] | null;
    compiledExprs?: CompiledExpr[];
    fromExprStrings?: string[] | null;
    compiledFromExprs?: CompiledExpr[];
}

// state.js is still untyped JavaScript, so its fields infer from their
// initializers. Describe the slice this module owns rather than spreading
// `any`; the cast goes away when state.js is converted.
interface SliderState {
    sceneSliders: Record<string, SceneSlider | undefined>;
    activeAnimExprs: AnimExprEntry[];
    activeAnimUpdaters: AnimUpdater[];
    activeVirtualTimeExpr: string | null;
    activeVirtualTimeCompiled: CompiledExpr | null;
    followCamState: FollowCamState | null;
    _sliderDrag: {
        active: boolean;
        startX: number;
        startY: number;
        startLeft: number;
        startBottom: number;
    };
}
const sliderState = state as unknown as SliderState;

// ----- Slider helpers -----

/** Flatten a tensor slider's `default` (nested or flat) to `shape` numbers,
 *  clamped to [min, max]; a missing or malformed table reads as all zeros
 *  (clamped), and a short one is padded the same way. */
function _flattenTable(raw: unknown, shape: number[], min: number, max: number): number[] {
    const n = shape.reduce((a, b) => a * b, 1);
    const flat: number[] = [];
    const walk = (node: unknown) => {
        if (Array.isArray(node)) { for (const v of node) walk(v); return; }
        const x = Number(node);
        flat.push(Number.isFinite(x) ? x : 0);
    };
    if (raw !== undefined && raw !== null) walk(raw);
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
        const v = i < flat.length ? flat[i]! : 0;
        out[i] = Math.max(min, Math.min(max, v));
    }
    return out;
}

function _parseSliderShape(raw: unknown): number[] | null {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2) return null;
    const dims = raw.map(v => Number(v));
    return dims.every(d => Number.isInteger(d) && d >= 1) ? dims : null;
}

export function isTensorSlider(s: SceneSlider | undefined): s is SceneSlider & { shape: number[]; values: number[] } {
    return !!s && s.kind === 'tensor' && !!s.shape && !!s.values;
}

/** Rows and columns of a tensor slider's grid ([n] is one row of n). */
export function tensorSliderGrid(s: SceneSlider): { rows: number; cols: number } {
    const shape = s.shape || [1];
    return shape.length === 2 ? { rows: shape[0]!, cols: shape[1]! } : { rows: 1, cols: shape[0]! };
}

/** The cell's flat index, or -1 when (r, c) is off the grid. */
export function tensorCellIndex(s: SceneSlider, r: number, c: number): number {
    const { rows, cols } = tensorSliderGrid(s);
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= rows || c >= cols) return -1;
    return r * cols + c;
}

/** Display name of one cell: the label plus [r][c] (or [i] for a vector). */
export function tensorCellName(id: string, r: number, c: number): string {
    const s = sliderState.sceneSliders[id];
    const base = (s && s.label) || id;
    const shape = (s && s.shape) || [1];
    return shape.length === 2 ? `${base}[${r}][${c}]` : `${base}[${c}]`;
}

/** Set one cell of a tensor slider and re-evaluate everything that reads it.
 *  A fresh `values` array is written so an undo snapshot taken earlier keeps
 *  the old table. Returns false for an unknown slider or an off-grid cell. */
export function setTensorSliderCell(id: string, r: number, c: number, value: number): boolean {
    const s = sliderState.sceneSliders[id];
    if (!isTensorSlider(s) || !Number.isFinite(value)) return false;
    const i = tensorCellIndex(s, r, c);
    if (i < 0) return false;
    const v = Math.max(s.min, Math.min(s.max, value));
    if (s.values[i] === v) return true;
    const next = s.values.slice();
    next[i] = v;
    s.values = next;
    s._nested = null;
    _refreshTensorCells(id);
    recompileActiveExprs();
    syncSliderState();
    try { window.dispatchEvent(new CustomEvent('algebench:sliderchange')); } catch (_) { /* ignore */ }
    return true;
}

/** Put every cell of a tensor slider back to the step's default table. */
export function resetTensorSlider(id: string): boolean {
    const s = sliderState.sceneSliders[id];
    if (!isTensorSlider(s) || !s.defaults) return false;
    s.values = s.defaults.slice();
    s._nested = null;
    _refreshTensorCells(id);
    recompileActiveExprs();
    syncSliderState();
    try { window.dispatchEvent(new CustomEvent('algebench:sliderchange')); } catch (_) { /* ignore */ }
    return true;
}

export function formatTensorCell(v: number): string {
    if (!Number.isFinite(v)) return '·';
    const a = Math.abs(v);
    return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}

/** Rewrite the readouts of a tensor slider's grid on the panel. */
function _refreshTensorCells(id: string): void {
    const s = sliderState.sceneSliders[id];
    if (!isTensorSlider(s)) return;
    const cells = document.querySelectorAll<HTMLElement>(`.tslider-cell[data-slider-id="${id}"]`);
    for (const cell of cells) {
        const i = Number(cell.dataset.cell);
        const v = s.values[i];
        if (v === undefined) continue;
        cell.textContent = formatTensorCell(v);
        cell.classList.toggle('changed', !!s.defaults && Math.abs(v - s.defaults[i]!) > 1e-9);
    }
}

/** The hover editor for a tensor cell lives in tensor-slider-pop.ts; it
 *  registers itself here so this module does not import it (the pop module
 *  already imports this one). */
export interface TensorCellPopHandler {
    show(id: string, r: number, c: number, anchor: DOMRect | { left: number; top: number; right: number; bottom: number }): void;
    scheduleHide(): void;
    /** Press-and-drag editing from `startX`; see beginCellScrub in tensor-slider-pop.ts. */
    scrub?(id: string, r: number, c: number, startX: number, pointerId?: number, capture?: Element): void;
}
let _tensorPop: TensorCellPopHandler | null = null;
export function setTensorCellPopHandler(h: TensorCellPopHandler | null): void { _tensorPop = h; }
export function getTensorCellPopHandler(): TensorCellPopHandler | null { return _tensorPop; }

export function getSliderIds(): string[] {
    const ids = Object.keys(sliderState.sceneSliders);
    const launchIdx = ids.indexOf('h');
    const injectionIdx = ids.indexOf('h_target');
    if (launchIdx >= 0 && injectionIdx >= 0 && launchIdx !== injectionIdx - 1) {
        ids.splice(launchIdx, 1);
        const newInjectionIdx = ids.indexOf('h_target');
        ids.splice(newInjectionIdx, 0, 'h');
    }
    return ids;
}

export function _sliderValueNum(id: string, fallback = 0): number {
    const s = sliderState.sceneSliders[id];
    if (!s) return fallback;
    const v = Number(s.value);
    return Number.isFinite(v) ? v : fallback;
}

function _formatSliderValue(s: SceneSlider): string {
    if (s._valueExprCompiled) {
        try {
            const result = evalExpr(s._valueExprCompiled, 0, { useVirtualTime: false });
            return String(result);
        } catch (_e) { /* fall through */ }
    }
    return Number(s.value).toFixed(1);
}

/** Snap `v` to this slider's step grid, measured from its low bound. */
function _snapToStep(v: number, lo: number, step: number): number {
    if (!(step > 0)) return v;
    return lo + Math.round((v - lo) / step) * step;
}

/**
 * Re-evaluate every expression-driven bound and re-clamp the sliders that have
 * one. This is what lets a selector be bounded by the thing it indexes into:
 * `demo_h` with `maxExpr: "tfHeads() - 1"` cannot address a head that does not
 * exist, so no element downstream has to guard against one.
 *
 * One pass, no fixpoint. Bounds are evaluated against the values sliders hold
 * right now, so a bound reading another slider sees that slider's current
 * position and nothing iterates. A cycle therefore settles rather than hangs,
 * at the cost of taking one refresh to catch up -- the trade this makes on
 * purpose, since the alternative is an unbounded loop inside an input handler.
 *
 * Returns true when any value moved, so the caller knows to recompile the
 * expressions that read it.
 */
export function refreshSliderBounds(): boolean {
    let valueMoved = false;
    for (const id of Object.keys(sliderState.sceneSliders)) {
        const s = sliderState.sceneSliders[id];
        if (!s || (!s._minExprCompiled && !s._maxExprCompiled)) continue;
        if (isTensorSlider(s)) continue;   // a tensor's cells clamp on edit, not here

        const prevMin = s.min, prevMax = s.max, prevValue = s.value;
        // A bound that throws, or yields something that is not a finite
        // number, leaves the declared one in force. The alternative -- a NaN
        // bound -- makes every clamp below produce NaN and takes the slider
        // out of service for the rest of the scene.
        if (s._minExprCompiled) {
            try {
                const v = Number(evalExpr(s._minExprCompiled, 0, { useVirtualTime: false }));
                s.min = Number.isFinite(v) ? v : s._staticMin;
            } catch (_e) { s.min = s._staticMin; }
        }
        if (s._maxExprCompiled) {
            try {
                const v = Number(evalExpr(s._maxExprCompiled, 0, { useVirtualTime: false }));
                s.max = Number.isFinite(v) ? v : s._staticMax;
            } catch (_e) { s.max = s._staticMax; }
        }
        // An inverted range would let the clamp below pick either end
        // depending on which comparison ran first; collapse it to a point so
        // the slider is at least well defined while the configuration is.
        if (s.max < s.min) s.max = s.min;

        // `_desired` is where the slider was last asked to be; `value` is what
        // expressions see. They differ only while the range excludes the
        // choice, which is what makes the restore work: widen the range and
        // the clamp stops biting, with no memory of having bitten.
        //
        // A slider mid-animation is the exception, sweep or tween alike. Its
        // position belongs to the animation, not to a request, so `_desired`
        // is the wrong answer here in opposite ways: a sweep would be yanked
        // back to a pre-sweep position, and a tween -- whose `_desired` is
        // already its destination -- would jump straight to the end, dropping
        // the frames it exists to show. That is reachable now that a settling
        // tween runs this pass, so one of several sliders `set_sliders`
        // animates together would collapse the rest as it landed. While a
        // slider is animating, its current position is what it wants; the
        // clamp below still applies.
        const animating = !!s._loopPlaying || !!s._tweening;
        const want = (!animating && Number.isFinite(s._desired)) ? s._desired : s.value;
        // Snap FIRST, then clamp -- not only when the clamp bites. A range
        // input lays its step lattice out from `min`, so a moving `min` moves
        // the grid under a value that never left the range: the control would
        // then represent a different number than `s.value`, and the DOM and
        // the expressions would disagree about where the slider is.
        let next = _snapToStep(want, s.min, s.step);
        // Snapping can round outward past either end. Coming back must land on
        // the grid too, so the top end steps down to the last lattice point
        // inside the range rather than sitting off-grid at `max`.
        if (next > s.max) {
            const step = s.step > 0 ? s.step : 0;
            next = step > 0 ? s.min + Math.floor((s.max - s.min) / step) * step : s.max;
        }
        if (next < s.min) next = s.min;
        if (next !== prevValue) { s.value = next; valueMoved = true; }
        if (s.min !== prevMin || s.max !== prevMax || s.value !== prevValue) {
            if (typeof s._onBoundsChange === 'function') s._onBoundsChange();
        }
    }
    return valueMoved;
}

/** How many monospace characters the widest readout of `s` needs. Plain
 *  readouts are bounded by the two ends of the range. A formatted one
 *  (valueExpr) is measured by evaluating the format at every reachable
 *  value when the range is a small grid of steps -- the category sliders
 *  ("LayerNorm", "post-norm") are exactly that -- and otherwise by the
 *  longer of the two ends plus a little slack. Reserving it up front keeps
 *  the track from shrinking when the text changes length. */
function _widestReadoutCh(s: SceneSlider): number {
    // The DECLARED bounds, not the live ones. A slider whose max is an
    // expression narrows and widens as the configuration changes; measuring
    // the live range would resize the readout with it, and the track --
    // `flex: 1` -- would absorb the difference, which is the drag jitter #649
    // removed. The declared range is the widest this readout can ever be.
    const loB = Number(s._staticMin ?? s.min);
    const hiB = Number(s._staticMax ?? s.max);
    if (!s._valueExprCompiled) {
        return Math.max(loB.toFixed(1).length, hiB.toFixed(1).length);
    }
    const step = s.step > 0 ? s.step : 0.1;
    const steps = Math.round((hiB - loB) / step);
    const probe = (v: number): number => {
        const saved = s.value;
        s.value = v;
        try { return _formatSliderValue(s).length; } finally { s.value = saved; }
    };
    let widest = _formatSliderValue(s).length;
    if (steps >= 0 && steps <= 64) {
        for (let k = 0; k <= steps; k++) widest = Math.max(widest, probe(loB + k * step));
    } else {
        widest = Math.max(widest, probe(loB), probe(hiB)) + 1;
    }
    return widest;
}

// ----- Slider Loop Animation -----

export function startSliderLoop(id: string): void {
    // The `if (!slider) return` below is the real guard. The cast exists only
    // because TypeScript does not carry that narrowing into the hoisted `tick`
    // function declaration further down, and hoisting is worth preserving.
    const slider = sliderState.sceneSliders[id] as SceneSlider;
    if (!slider) return;
    slider._loopPlaying = true;
    if (typeof slider._onPlayStateChange === 'function') slider._onPlayStateChange();
    const range = slider.max - slider.min;
    const period = slider.duration;
    const mode = (slider.animateMode || 'loop');
    // Resume from current position; for 'once' mode already at end, restart from beginning.
    const rawResumeT = range > 0 ? Math.max(0, Math.min(1, (slider.value - slider.min) / range)) : 0;
    const resumeT = (mode === 'once' && rawResumeT >= 1) ? 0 : rawResumeT;
    const startTime = performance.now() - resumeT * period;

    function tick(now: number): void {
        if (!slider._loopPlaying || !sliderState.sceneSliders[id]) return;
        const elapsed = (now - startTime) / period;
        let tNorm: number;
        if (mode === 'loop') {
            tNorm = elapsed % 1;                            // sawtooth 0→1 loop
        } else if (mode === 'once') {
            tNorm = Math.min(elapsed, 1);                   // one-shot 0→1 then stop
            if (tNorm >= 1) {
                slider._loopPlaying = false;
                if (typeof slider._onPlayStateChange === 'function') slider._onPlayStateChange();
            }
        } else {
            const phase = elapsed % 2;                      // 0–2 repeating
            tNorm = phase < 1 ? phase : 2 - phase;         // triangle wave 0→1→0
        }
        slider.value = slider.min + tNorm * range;
        const input = document.querySelector<HTMLInputElement>(`input[data-slider-id="${id}"]`);
        if (input) {
            // `input.value` is a string; assigning the number relied on the DOM's
            // own ToString coercion, so String() here is the same conversion made
            // explicit — not a behaviour change. Same at the two call sites below.
            input.value = String(slider.value);
            const valSpan = input.parentElement && input.parentElement.querySelector('.slider-value');
            if (valSpan) valSpan.textContent = _formatSliderValue(slider);
        }
        refreshActiveExprsForSliderValueChange();
        if (slider._loopPlaying) {
            slider._loopRaf = requestAnimationFrame(tick);
        } else {
            slider._loopRaf = null;
        }
    }
    slider._loopRaf = requestAnimationFrame(tick);
}

export function stopSliderLoop(id: string): void {
    const slider = sliderState.sceneSliders[id];
    if (!slider) return;
    slider._loopPlaying = false;
    if (slider._loopRaf) {
        cancelAnimationFrame(slider._loopRaf);
        slider._loopRaf = null;
    }
    if (typeof slider._onPlayStateChange === 'function') slider._onPlayStateChange();
}

export function stopAllSliderLoops(): void {
    for (const id of Object.keys(sliderState.sceneSliders)) stopSliderLoop(id);
}

// ----- Shared drag utility -----

/** After restoring a saved position, clamp element so at least `margin` px remains visible. */
export function clampToParent(el: HTMLElement, margin = 40): void {
    const parent = el.offsetParent || document.body;
    const pw = parent.clientWidth;
    const ph = parent.clientHeight;
    const ew = el.offsetWidth  || margin;
    const eh = el.offsetHeight || margin;
    let left = parseFloat(el.style.left) || 0;
    let top  = parseFloat(el.style.top)  || 0;
    left = Math.max(margin - ew, Math.min(left, pw - margin));
    top  = Math.max(0,           Math.min(top,  ph - margin));
    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
}

// ----- Slider drag -----

export function setupSliderDrag(e: MouseEvent, overlay: HTMLElement): void {
    e.preventDefault();
    const parent = overlay.offsetParent || document.body;
    const parentH = parent.clientHeight;
    const rect = overlay.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();

    // Capture starting state in bottom-left coordinate space
    sliderState._sliderDrag.active   = true;
    sliderState._sliderDrag.startX   = e.clientX;
    sliderState._sliderDrag.startY   = e.clientY;
    sliderState._sliderDrag.startLeft   = rect.left - parentRect.left;
    sliderState._sliderDrag.startBottom = parentRect.bottom - rect.bottom;

    overlay.classList.add('dragging');

    const onMove = (me: MouseEvent) => {
        if (!sliderState._sliderDrag.active) return;
        const dx = me.clientX - sliderState._sliderDrag.startX;
        const dy = me.clientY - sliderState._sliderDrag.startY;  // positive = moved down

        let newLeft   = sliderState._sliderDrag.startLeft   + dx;
        let newBottom = sliderState._sliderDrag.startBottom - dy; // subtract: moving down reduces bottom offset

        // Clamp so panel stays within parent
        newLeft   = Math.max(0, Math.min(newLeft,   parent.clientWidth  - overlay.offsetWidth));
        newBottom = Math.max(0, Math.min(newBottom, parentH - overlay.offsetHeight));

        overlay.style.left   = newLeft   + 'px';
        overlay.style.bottom = newBottom + 'px';
    };

    const onUp = () => {
        sliderState._sliderDrag.active = false;
        overlay.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);

        // Persist position
        const newLeft   = parseFloat(overlay.style.left)   || 0;
        const newBottom = parseFloat(overlay.style.bottom) || 0;
        try {
            localStorage.setItem('slider-overlay-pos', JSON.stringify({ left: newLeft, bottom: newBottom }));
        } catch (e) { /* ignore */ }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
}

// ----- Slider registration -----

export function registerSliders(
    sliderDefs: SliderDef[] | null | undefined,
): { ids: string[]; prevStates: Record<string, SceneSlider> } {
    if (!sliderDefs || !Array.isArray(sliderDefs)) return { ids: [], prevStates: {} };
    const ids: string[] = [];
    const prevStates: Record<string, SceneSlider> = {};
    for (const def of sliderDefs) {
        // Snapshot previous state for undo on backward navigation (only when reset flag is set).
        const prev = sliderState.sceneSliders[def.id];
        if (prev) {
            stopSliderLoop(def.id);
            if (def.reset) {
                prevStates[def.id] = { ...prev };
            }
            // Re-insert so the panel follows THIS step's declared order. A
            // slider carried over from an earlier step otherwise keeps its old
            // slot in the record and lands above the ones declared before it.
            delete sliderState.sceneSliders[def.id];
        }
        const min = def.min !== undefined ? def.min : 0;
        const max = def.max !== undefined ? def.max : 1;
        const shape = def.kind === 'tensor' ? _parseSliderShape(def.shape) : null;
        const isTensor = !!shape;
        if (def.kind === 'tensor' && !shape) {
            console.warn(`slider "${def.id}": kind "tensor" needs a shape of one or two positive integers; got`, def.shape);
        }
        const defaults = shape ? _flattenTable(def.default, shape, min, max) : null;
        const scalarDefault = typeof def.default === 'number' ? def.default : undefined;
        sliderState.sceneSliders[def.id] = {
            value: isTensor ? NaN : (scalarDefault !== undefined ? scalarDefault : (min + max) / 2),
            min,
            max,
            step: def.step !== undefined ? def.step : 0.1,
            label: def.label || def.id,
            default: isTensor ? undefined : scalarDefault,
            kind: isTensor ? 'tensor' : 'scalar',
            shape,
            values: defaults ? defaults.slice() : null,
            defaults,
            _nested: null,
            animate: !isTensor && (def.animate || false),
            animateMode: String(def.animateMode || def.animationMode || 'loop').toLowerCase(),
            autoplay: def.autoplay !== false,
            duration: def.duration || 3000,
            _loopPlaying: false,
            _loopRaf: null,
            _valueExprString: def.valueExpr || null,
            _valueExprCompiled: null,
            _minExprString: def.minExpr || null,
            _maxExprString: def.maxExpr || null,
            _minExprCompiled: null,
            _maxExprCompiled: null,
            _staticMin: min,
            _staticMax: max,
            _desired: isTensor ? NaN : (scalarDefault !== undefined ? scalarDefault : (min + max) / 2),
        };
        if (def.valueExpr) {
            // Non-null: the entry was assigned immediately above.
            try { sliderState.sceneSliders[def.id]!._valueExprCompiled = compileExpr(def.valueExpr); } catch (_e) {}
        }
        if (def.minExpr) {
            try { sliderState.sceneSliders[def.id]!._minExprCompiled = compileExpr(def.minExpr); } catch (_e) {}
        }
        if (def.maxExpr) {
            try { sliderState.sceneSliders[def.id]!._maxExprCompiled = compileExpr(def.maxExpr); } catch (_e) {}
        }
        ids.push(def.id);
    }
    // Auto-start animated sliders unless explicitly disabled.
    for (const id of ids) {
        const s = sliderState.sceneSliders[id];
        if (s && s.animate && s.autoplay) startSliderLoop(id);
    }
    return { ids, prevStates };
}

export function removeSliderIds(ids: string[]): void {
    for (const id of ids) {
        stopSliderLoop(id);
        delete sliderState.sceneSliders[id];
    }
    if (sliderState.activeVirtualTimeExpr) {
        try {
            sliderState.activeVirtualTimeCompiled = compileExpr(sliderState.activeVirtualTimeExpr);
        } catch (err) {
            console.warn('virtualTime recompile error:', err);
            sliderState.activeVirtualTimeCompiled = null;
        }
    }
    syncSliderState();
}

// ----- Build slider overlay UI -----

export function buildSliders(
    sliderDefs: SliderDef[] | null | undefined,
): { ids: string[]; prevStates: Record<string, SceneSlider> } {
    return registerSliders(sliderDefs);
}

export function buildSliderOverlay(): void {
    const overlay = document.getElementById('slider-overlay');
    if (!overlay) return;

    const ids = getSliderIds();
    if (ids.length === 0) {
        overlay.classList.add('hidden');
        overlay.innerHTML = '';
        return;
    }

    overlay.innerHTML = '';

    // Restore saved position (bottom-left anchoring)
    try {
        const saved = JSON.parse(localStorage.getItem('slider-overlay-pos') || 'null') as
            { left?: number | null; bottom?: number | null } | null;
        if (saved && saved.left != null && saved.bottom != null) {
            overlay.style.left   = saved.left   + 'px';
            overlay.style.bottom = saved.bottom + 'px';
        }
    } catch (e) { /* ignore */ }

    // Drag handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'slider-drag-handle';
    dragHandle.textContent = '⠿ ⠿ ⠿';
    dragHandle.addEventListener('mousedown', (e) => setupSliderDrag(e, overlay));
    overlay.appendChild(dragHandle);

    for (const id of ids) {
        // Non-null: `ids` comes from getSliderIds(), i.e. the record's own keys.
        // A missing entry must still throw here, exactly as the JS did.
        const s = sliderState.sceneSliders[id]!;
        s._onBoundsChange = undefined;   // dropped with the row it was bound to
        if (isTensorSlider(s)) {
            overlay.appendChild(_buildTensorRow(id, s));
            continue;
        }
        const row = document.createElement('div');
        row.className = 'slider-row';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'slider-label';
        labelSpan.innerHTML = renderKaTeX(s.label || id, false);
        labelSpan.title = stripLatex(s.label || id);
        row.appendChild(labelSpan);

        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'slider-range';
        input.dataset.sliderId = id;
        // These four are string-valued DOM properties; the JS assigned numbers
        // and let the DOM coerce. String() is that same coercion, spelled out.
        input.min = String(s.min);
        input.max = String(s.max);
        input.step = String(s.step);
        input.value = String(s.value);
        row.appendChild(input);

        const valSpan = document.createElement('span');
        valSpan.className = 'slider-value';
        valSpan.textContent = _formatSliderValue(s);
        // Reserve the widest readout this slider can ever show. The track is
        // `flex: 1`, so without this it absorbs the readout's growth: dragging a
        // -180..180 slider past -100 adds a character, the track loses ~13px, and
        // the thumb moves out from under a stationary cursor -- which changes the
        // value, which can change the width back. The result is visible jitter.
        // `ch` is exact here because .slider-value is monospaced.
        valSpan.style.minWidth = `${_widestReadoutCh(s)}ch`;
        row.appendChild(valSpan);

        // Push new bounds into this row without rebuilding the panel: a
        // rebuild mid-drag would replace the input under the cursor and drop
        // the gesture.
        s._onBoundsChange = () => {
            input.min = String(s.min);
            input.max = String(s.max);
            if (String(s.value) !== input.value) input.value = String(s.value);
            valSpan.textContent = _formatSliderValue(s);
        };

        input.addEventListener('input', () => {
            if (s._loopPlaying) stopSliderLoop(id);
            s.value = parseFloat(input.value);
            // What the user asked for, before any clamp. Recorded on every
            // input so a later range change restores this position and not
            // some earlier clamped one.
            s._desired = s.value;
            // Bounds first: this slider may be the input to another's bound,
            // and expressions must recompile against the clamped values rather
            // than the ones a shrinking range has just invalidated.
            refreshSliderBounds();
            valSpan.textContent = _formatSliderValue(s);
            recompileActiveExprs();
            syncSliderState();
            try { window.dispatchEvent(new CustomEvent('algebench:sliderchange')); } catch (_) { /* ignore */ }
        });

        if (s.animate) {
            const playBtn = document.createElement('button');
            playBtn.className = 'slider-play-btn';
            playBtn.dataset.sliderId = id;
            const updatePlayBtn = () => {
                playBtn.textContent = s._loopPlaying ? '⏸' : '▶';
                playBtn.title = s._loopPlaying ? 'Pause animation' : 'Play animation';
            };
            s._onPlayStateChange = updatePlayBtn;
            updatePlayBtn();
            playBtn.addEventListener('click', () => {
                if (s._loopPlaying) {
                    stopSliderLoop(id);
                } else {
                    startSliderLoop(id);
                }
                updatePlayBtn();
            });
            row.appendChild(playBtn);
        }

        overlay.appendChild(row);
    }
    overlay.classList.remove('hidden');
    // Apply expression bounds once the rows exist, so a slider whose range
    // depends on the configuration opens already clamped rather than showing
    // an out-of-range position until the first drag. A clamp here moves a
    // value nothing else is about to recompile against -- the input handler
    // does that for a drag, but this runs without one -- so the scene would
    // render the pre-clamp position until the user next touched a slider.
    if (refreshSliderBounds()) {
        recompileActiveExprs();
        try { window.dispatchEvent(new CustomEvent('algebench:sliderchange')); } catch (_) { /* ignore */ }
    }
    syncSliderState();
}

/** One panel row for a tensor slider: a header (label, shape, reset) over a
 *  grid of readouts the shape of the value. Hovering a readout opens that
 *  cell's slider (see tensor-slider-pop.ts); clicking the header folds the grid. */
function _buildTensorRow(id: string, s: SceneSlider & { shape: number[]; values: number[] }): HTMLElement {
    const { rows, cols } = tensorSliderGrid(s);
    const row = document.createElement('div');
    row.className = 'slider-row slider-row-tensor';
    row.dataset.sliderId = id;

    const head = document.createElement('div');
    head.className = 'tslider-head';
    const caret = document.createElement('span');
    caret.className = 'tslider-caret';
    head.appendChild(caret);
    const labelSpan = document.createElement('span');
    labelSpan.className = 'slider-label';
    labelSpan.innerHTML = renderKaTeX(s.label || id, false);
    labelSpan.title = stripLatex(s.label || id);
    head.appendChild(labelSpan);
    const shapeSpan = document.createElement('span');
    shapeSpan.className = 'tslider-shape';
    shapeSpan.textContent = s.shape.join('×');
    head.appendChild(shapeSpan);
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'tslider-reset';
    reset.textContent = '↺';
    reset.title = 'Reset every cell to the default';
    reset.setAttribute('aria-label', reset.title);
    reset.addEventListener('mousedown', e => e.stopPropagation());
    reset.addEventListener('click', (e) => { e.stopPropagation(); resetTensorSlider(id); });
    head.appendChild(reset);
    row.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'tslider-grid';
    grid.style.gridTemplateColumns = `repeat(${cols}, auto)`;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const i = r * cols + c;
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'tslider-cell';
            cell.dataset.sliderId = id;
            cell.dataset.cell = String(i);
            cell.textContent = formatTensorCell(s.values[i]!);
            cell.title = stripLatex(tensorCellName(id, r, c));
            if (s.defaults && Math.abs(s.values[i]! - s.defaults[i]!) > 1e-9) cell.classList.add('changed');
            const open = () => { if (_tensorPop) _tensorPop.show(id, r, c, cell.getBoundingClientRect()); };
            cell.addEventListener('mouseenter', open);
            cell.addEventListener('focus', open);
            cell.addEventListener('click', open);
            // Press and drag sideways scrubs the value without visiting the pop.
            cell.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault(); e.stopPropagation();
                open();
                if (_tensorPop && _tensorPop.scrub) _tensorPop.scrub(id, r, c, e.clientX, e.pointerId, cell);
            });
            cell.addEventListener('mouseleave', () => { if (_tensorPop) _tensorPop.scheduleHide(); });
            cell.addEventListener('blur', () => { if (_tensorPop) _tensorPop.scheduleHide(); });
            grid.appendChild(cell);
        }
    }
    row.appendChild(grid);

    const KEY = 'tslider-collapsed-' + id;
    let collapsed = false;
    try { collapsed = localStorage.getItem(KEY) === '1'; } catch { /* ignore */ }
    row.classList.toggle('collapsed', collapsed);
    head.addEventListener('mousedown', e => e.stopPropagation());
    head.addEventListener('click', () => {
        collapsed = !row.classList.toggle('collapsed') ? false : true;
        try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
    });
    return row;
}

// ----- Reactive expression tracking -----

export function registerAnimExpr(entry: AnimExprEntry): void {
    sliderState.activeAnimExprs.push(entry);
}

export function unregisterAnimExpr(animState: { stopped: boolean } | null): void {
    sliderState.activeAnimExprs = sliderState.activeAnimExprs.filter(e => e.animState !== animState);
}

export function registerAnimUpdater(entry: AnimUpdater): void {
    sliderState.activeAnimUpdaters.push(entry);
}

export function unregisterAnimUpdater(animState: { stopped: boolean } | null): void {
    sliderState.activeAnimUpdaters = sliderState.activeAnimUpdaters.filter(e => e.animState !== animState);
}

export function runAnimUpdaters(nowMs: number): void {
    if (!sliderState.activeAnimUpdaters.length) return;
    // Compact the updater list as we run it so stopped animators are removed
    // without requiring a separate cleanup pass.
    const next: AnimUpdater[] = [];
    for (const entry of sliderState.activeAnimUpdaters) {
        if (!entry || !entry.animState || entry.animState.stopped) continue;
        try {
            entry.updateFrame(nowMs);
            next.push(entry);
        } catch (err) {
            console.warn('Animation updater error:', err);
        }
    }
    sliderState.activeAnimUpdaters = next;
}

export function refreshActiveExprsForSliderValueChange(): void {
    for (const entry of sliderState.activeAnimExprs) {
        if (!entry || !entry.animState || entry.animState.stopped) continue;
        if (typeof entry._rebuildFn === 'function') {
            try {
                entry._rebuildFn();
            } catch (err) {
                console.warn('Slider reactive rebuild error:', err);
            }
        }
    }
    // updateInfoOverlays will be called via overlay.js when it imports this module
    if (typeof window._algebenchUpdateInfoOverlays === 'function') {
        window._algebenchUpdateInfoOverlays();
    }
}

export function recompileActiveExprs(): void {
    recompileActiveSceneFunctions();
    // Recompile valueExpr for all sliders
    for (const s of Object.values(sliderState.sceneSliders)) {
        // Non-null: Object.values() of a Record<string, T | undefined> widens to
        // include undefined, but the record never holds one. The JS dereferenced
        // it unguarded and must keep throwing if that ever stops being true.
        if (s!._valueExprString) {
            try { s!._valueExprCompiled = compileExpr(s!._valueExprString); } catch (_e) {}
        }
    }
    for (const entry of sliderState.activeAnimExprs) {
        // Non-null on purpose: unlike the loop in
        // refreshActiveExprsForSliderValueChange() above, this one never guarded
        // `animState`. An entry registered before its animState is attached
        // throws here — preserved verbatim.
        if (entry.animState!.stopped) continue;
        if (typeof entry._rebuildFn === 'function') {
            try {
                entry._rebuildFn();
            } catch (err) {
                console.warn('Slider parametric recompile error:', err);
            }
            continue;
        }
        try {
            // Non-null for the same reason as animState above: an entry without
            // exprStrings threw here in the JS and must keep doing so.
            entry.compiledFns = entry.exprStrings!.map(e => compileExpr(e));
        } catch (err) {
            console.warn('Slider recompile error:', err);
        }
        if (entry.fromExprStrings) {
            try {
                entry.fromExprFns = entry.fromExprStrings.map(e => compileExpr(e));
            } catch (err) {
                console.warn('Slider fromExpr recompile error:', err);
            }
        }
        if (entry.radiusExprString) {
            try {
                entry.radiusFn = compileExpr(entry.radiusExprString);
            } catch (err) {
                console.warn('Slider radiusExpr recompile error:', err);
            }
        }
        if (entry.visibleExprString) {
            try {
                entry.visibleFn = compileExpr(entry.visibleExprString);
            } catch (err) {
                console.warn('Slider visibleExpr recompile error:', err);
            }
        }
        if (entry._isAnimatedPolygon && entry._vertexExprs) {
            try {
                entry._compiledVerts = entry._vertexExprs.map(v => v.map(e => compileExpr(e)));
            } catch (err) {
                console.warn('Slider animated_polygon recompile error:', err);
            }
        }
        if (entry._isRegularPolygon && entry._regExprs) {
            try {
                // Non-null throughout: a short _regExprs or a missing _regState
                // threw in the JS, and the surrounding catch logged it. Keeping
                // the assertions keeps that path identical.
                const [nE, rE, cxE, cyE, czE, rotE] = entry._regExprs;
                entry._regState!.cN   = compileExpr(nE!);
                entry._regState!.cR   = compileExpr(rE!);
                entry._regState!.cCx  = compileExpr(cxE!);
                entry._regState!.cCy  = compileExpr(cyE!);
                entry._regState!.cCz  = compileExpr(czE!);
                entry._regState!.cRot = compileExpr(rotE!);
            } catch (err) {
                console.warn('Slider regular polygon recompile error:', err);
            }
        }
        if (entry._isAnimatedLine && entry._pointExprs) {
            try {
                entry._compiledPoints = entry._pointExprs.map(p => p.map(e => compileExpr(e)));
            } catch (err) {
                console.warn('Slider animated_line recompile error:', err);
            }
        }
    }
    // Recompile follow-cam expressions too (slider set may have changed)
    if (sliderState.followCamState && sliderState.followCamState.exprStrings) {
        try {
            sliderState.followCamState.compiledExprs = sliderState.followCamState.exprStrings.map(e => compileExpr(e));
        } catch (err) {
            console.warn('Follow-cam recompile error:', err);
        }
        if (sliderState.followCamState.fromExprStrings) {
            try {
                sliderState.followCamState.compiledFromExprs = sliderState.followCamState.fromExprStrings.map(e => compileExpr(e));
            } catch (err) {
                console.warn('Follow-cam fromExpr recompile error:', err);
            }
        }
    }
    if (sliderState.activeVirtualTimeExpr) {
        try {
            sliderState.activeVirtualTimeCompiled = compileExpr(sliderState.activeVirtualTimeExpr);
        } catch (err) {
            console.warn('virtualTime recompile error:', err);
            sliderState.activeVirtualTimeCompiled = null;
        }
    }
    if (typeof window._algebenchUpdateInfoOverlays === 'function') {
        window._algebenchUpdateInfoOverlays();
    }
}

// ----- Slider state persistence -----

export function syncSliderState(): void {
    // Persist current slider values to localStorage
    const s: Record<string, number | number[]> = {};
    for (const [id, sl] of Object.entries(sliderState.sceneSliders)) {
        // Non-null: see the note in recompileActiveExprs() — Object.entries()
        // widens the value type, the record itself never holds undefined.
        s[id] = isTensorSlider(sl) ? sl.values : sl!.value;
    }
    try { localStorage.setItem('algebench-sliders', JSON.stringify(s)); } catch(e) {}
    // Update status bar pill — call via window shim to avoid circular import
    if (typeof window._algebenchUpdateStatusBar === 'function') {
        window._algebenchUpdateStatusBar();
    }
}

// ----- Set Slider Value Instantly (deeplink / AI jump restore) -----

// Unlike animateSlider, this applies synchronously with no requestAnimationFrame
// — restoring a shared view must not depend on the tab actively rendering.
export function setSliderValue(id: string, value: number): boolean {
    const s = sliderState.sceneSliders[id];
    if (!s || s.kind === 'tensor' || !Number.isFinite(value)) return false;
    if (s._loopPlaying) stopSliderLoop(id);
    // A deeplink, a view-state restore or the tutor moving a slider is a
    // requested position, exactly as a drag is, so it records intent. The RAW
    // request is what is remembered: a value the current range excludes is
    // clamped for now and comes back if the range widens, which is the same
    // contract a drag gets. Without this the restore is invisible to
    // refreshSliderBounds, and a later widening would resurrect whatever
    // position preceded the deeplink.
    s._desired = value;
    s.value = Math.max(s.min, Math.min(s.max, value));
    // Bounds second: this slider may be the input to another's, and its own
    // range may exclude what was just asked for. Runs before the DOM write
    // below so the control shows the value that survived.
    refreshSliderBounds();
    const input = document.querySelector<HTMLInputElement>(`input[data-slider-id="${id}"]`);
    if (input) {
        input.value = String(s.value);
        const valSpan = input.parentElement && input.parentElement.querySelector('.slider-value');
        if (valSpan) valSpan.textContent = _formatSliderValue(s);
    }
    recompileActiveExprs();
    syncSliderState();
    return true;
}

// ----- Animate Slider Programmatically -----

export function animateSlider(id: string, target: number, duration: number): Promise<boolean> {
    return new Promise(resolve => {
        // Cast for the same reason as startSliderLoop(): the guard on the next
        // line is real, but it does not reach the hoisted `tick` below.
        const slider = sliderState.sceneSliders[id] as SceneSlider;
        if (!slider || slider.kind === 'tensor') { resolve(false); return; }
        target = Math.max(slider.min, Math.min(slider.max, target));
        // The target is the request; the frames between are not. Recording it
        // once here -- rather than per frame -- keeps a later range change
        // restoring where the animation was headed, and keeps
        // refreshSliderBounds out of the tween's per-frame path.
        slider._desired = target;
        // Settle the bounds even when nothing has to move: `target` was
        // clamped against this slider's CURRENT range a line above, and that
        // range may itself be an expression another slider has since
        // invalidated.
        const settle = (): void => {
            // Lowered before the pass, so this slider's own landing position
            // is clamped and snapped like any settled value.
            slider._tweening = false;
            if (refreshSliderBounds()) recompileActiveExprs();
            // The same event a drag emits. `set_sliders` drives this path, so
            // without it an AI-moved slider never reaches URL and view sync.
            try { window.dispatchEvent(new CustomEvent('algebench:sliderchange')); } catch (_) { /* ignore */ }
            syncSliderState();
        };
        const start = slider.value;
        if (start === target) { settle(); resolve(true); return; }
        slider._tweening = true;
        const startTime = performance.now();
        function tick(now: number): void {
            const t = Math.min((now - startTime) / duration, 1);
            const eased = t < 1 ? t * (2 - t) : 1;  // ease-out quad
            slider.value = start + (target - start) * eased;
            // Update the HTML range input and value display to match
            const input = document.querySelector<HTMLInputElement>(`input[data-slider-id="${id}"]`);
            if (input) {
                input.value = String(slider.value);
                const valSpan = input.parentElement && input.parentElement.querySelector('.slider-value');
                if (valSpan) valSpan.textContent = _formatSliderValue(slider);
            }
            recompileActiveExprs();
            if (t < 1) {
                requestAnimationFrame(tick);
            } else {
                // Once, on the final frame. A tween that lands somewhere its
                // own bounds exclude -- or that moves a slider another's
                // bounds read -- must leave the panel consistent, and a
                // per-frame pass would put an expression evaluation for every
                // bounded slider inside the animation loop.
                settle();
                resolve(true);
            }
        }
        requestAnimationFrame(tick);
    });
}
