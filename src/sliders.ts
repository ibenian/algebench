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

/** A registered slider, as registerSliders() builds it into sliderState.sceneSliders. */
export interface SceneSlider {
    value: number;
    min: number;
    max: number;
    step: number;
    label: string;
    default: number | undefined;
    animate: boolean;
    animateMode: string;
    autoplay: boolean;
    duration: number;
    _loopPlaying: boolean;
    _loopRaf: number | null;
    _valueExprString: string | null;
    _valueExprCompiled: CompiledExpr | null;
    /** Installed by buildSliderOverlay() for sliders that render a play button. */
    _onPlayStateChange?: () => void;
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
        }
        sliderState.sceneSliders[def.id] = {
            value: def.default !== undefined ? def.default : (def.min + def.max) / 2,
            min: def.min !== undefined ? def.min : 0,
            max: def.max !== undefined ? def.max : 1,
            step: def.step !== undefined ? def.step : 0.1,
            label: def.label || def.id,
            default: def.default,
            animate: def.animate || false,
            animateMode: String(def.animateMode || def.animationMode || 'loop').toLowerCase(),
            autoplay: def.autoplay !== false,
            duration: def.duration || 3000,
            _loopPlaying: false,
            _loopRaf: null,
            _valueExprString: def.valueExpr || null,
            _valueExprCompiled: null,
        };
        if (def.valueExpr) {
            // Non-null: the entry was assigned immediately above.
            try { sliderState.sceneSliders[def.id]!._valueExprCompiled = compileExpr(def.valueExpr); } catch (_e) {}
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
        row.appendChild(valSpan);

        input.addEventListener('input', () => {
            if (s._loopPlaying) stopSliderLoop(id);
            s.value = parseFloat(input.value);
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
    syncSliderState();
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
    const s: Record<string, number> = {};
    for (const [id, sl] of Object.entries(sliderState.sceneSliders)) {
        // Non-null: see the note in recompileActiveExprs() — Object.entries()
        // widens the value type, the record itself never holds undefined.
        s[id] = sl!.value;
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
    if (!s || !Number.isFinite(value)) return false;
    if (s._loopPlaying) stopSliderLoop(id);
    s.value = Math.max(s.min, Math.min(s.max, value));
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
        if (!slider) { resolve(false); return; }
        target = Math.max(slider.min, Math.min(slider.max, target));
        const start = slider.value;
        if (start === target) { syncSliderState(); resolve(true); return; }
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
                syncSliderState();
                resolve(true);
            }
        }
        requestAnimationFrame(tick);
    });
}
