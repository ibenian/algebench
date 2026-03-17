// ============================================================
// Slider System — build slider UI, loop animation, drag,
// animated-expression registry, and programmatic animation.
// ============================================================

import { state } from '/state.js';
import { compileExpr, recompileActiveSceneFunctions, _getMathNamesAndValues } from '/expr.js';
import { renderKaTeX, stripLatex } from '/labels.js';

// ----- Slider helpers -----

export function getSliderIds() {
    const ids = Object.keys(state.sceneSliders);
    const launchIdx = ids.indexOf('h');
    const injectionIdx = ids.indexOf('h_target');
    if (launchIdx >= 0 && injectionIdx >= 0 && launchIdx !== injectionIdx - 1) {
        ids.splice(launchIdx, 1);
        const newInjectionIdx = ids.indexOf('h_target');
        ids.splice(newInjectionIdx, 0, 'h');
    }
    return ids;
}

export function _sliderValueNum(id, fallback = 0) {
    const s = state.sceneSliders[id];
    if (!s) return fallback;
    const v = Number(s.value);
    return Number.isFinite(v) ? v : fallback;
}

// ----- Slider Loop Animation -----

export function startSliderLoop(id) {
    const slider = state.sceneSliders[id];
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

    function tick(now) {
        if (!slider._loopPlaying || !state.sceneSliders[id]) return;
        const elapsed = (now - startTime) / period;
        let tNorm;
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
        const input = document.querySelector(`input[data-slider-id="${id}"]`);
        if (input) {
            input.value = slider.value;
            const valSpan = input.parentElement && input.parentElement.querySelector('.slider-value');
            if (valSpan) valSpan.textContent = Number(slider.value).toFixed(2);
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

export function stopSliderLoop(id) {
    const slider = state.sceneSliders[id];
    if (!slider) return;
    slider._loopPlaying = false;
    if (slider._loopRaf) {
        cancelAnimationFrame(slider._loopRaf);
        slider._loopRaf = null;
    }
    if (typeof slider._onPlayStateChange === 'function') slider._onPlayStateChange();
}

export function stopAllSliderLoops() {
    for (const id of Object.keys(state.sceneSliders)) stopSliderLoop(id);
}

// ----- Shared drag utility -----

/** After restoring a saved position, clamp element so at least `margin` px remains visible. */
export function clampToParent(el, margin = 40) {
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

export function setupSliderDrag(e, overlay) {
    e.preventDefault();
    const parent = overlay.offsetParent || document.body;
    const parentH = parent.clientHeight;
    const rect = overlay.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();

    // Capture starting state in bottom-left coordinate space
    state._sliderDrag.active   = true;
    state._sliderDrag.startX   = e.clientX;
    state._sliderDrag.startY   = e.clientY;
    state._sliderDrag.startLeft   = rect.left - parentRect.left;
    state._sliderDrag.startBottom = parentRect.bottom - rect.bottom;

    overlay.classList.add('dragging');

    const onMove = (me) => {
        if (!state._sliderDrag.active) return;
        const dx = me.clientX - state._sliderDrag.startX;
        const dy = me.clientY - state._sliderDrag.startY;  // positive = moved down

        let newLeft   = state._sliderDrag.startLeft   + dx;
        let newBottom = state._sliderDrag.startBottom - dy; // subtract: moving down reduces bottom offset

        // Clamp so panel stays within parent
        newLeft   = Math.max(0, Math.min(newLeft,   parent.clientWidth  - overlay.offsetWidth));
        newBottom = Math.max(0, Math.min(newBottom, parentH - overlay.offsetHeight));

        overlay.style.left   = newLeft   + 'px';
        overlay.style.bottom = newBottom + 'px';
    };

    const onUp = () => {
        state._sliderDrag.active = false;
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

export function registerSliders(sliderDefs) {
    if (!sliderDefs || !Array.isArray(sliderDefs)) return [];
    const ids = [];
    for (const def of sliderDefs) {
        // Stop any existing loop for this id before overwriting the slider state.
        if (state.sceneSliders[def.id]) stopSliderLoop(def.id);
        state.sceneSliders[def.id] = {
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
        };
        ids.push(def.id);
    }
    // Auto-start animated sliders unless explicitly disabled.
    for (const id of ids) {
        const s = state.sceneSliders[id];
        if (s && s.animate && s.autoplay) startSliderLoop(id);
    }
    return ids;
}

export function removeSliderIds(ids) {
    for (const id of ids) {
        stopSliderLoop(id);
        delete state.sceneSliders[id];
    }
    if (state.activeVirtualTimeExpr) {
        try {
            state.activeVirtualTimeCompiled = compileExpr(state.activeVirtualTimeExpr);
        } catch (err) {
            console.warn('virtualTime recompile error:', err);
            state.activeVirtualTimeCompiled = null;
        }
    }
    syncSliderState();
}

// ----- Build slider overlay UI -----

export function buildSliders(sliderDefs) {
    return registerSliders(sliderDefs);
}

export function buildSliderOverlay() {
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
        const saved = JSON.parse(localStorage.getItem('slider-overlay-pos') || 'null');
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
        const s = state.sceneSliders[id];
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
        input.min = s.min;
        input.max = s.max;
        input.step = s.step;
        input.value = s.value;
        row.appendChild(input);

        const valSpan = document.createElement('span');
        valSpan.className = 'slider-value';
        valSpan.textContent = Number(s.value).toFixed(1);
        row.appendChild(valSpan);

        input.addEventListener('input', () => {
            s.value = parseFloat(input.value);
            valSpan.textContent = Number(s.value).toFixed(1);
            recompileActiveExprs();
            syncSliderState();
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

export function registerAnimExpr(entry) {
    state.activeAnimExprs.push(entry);
}

export function unregisterAnimExpr(animState) {
    state.activeAnimExprs = state.activeAnimExprs.filter(e => e.animState !== animState);
}

export function registerAnimUpdater(entry) {
    state.activeAnimUpdaters.push(entry);
}

export function unregisterAnimUpdater(animState) {
    state.activeAnimUpdaters = state.activeAnimUpdaters.filter(e => e.animState !== animState);
}

export function runAnimUpdaters(nowMs) {
    if (!state.activeAnimUpdaters.length) return;
    // Compact the updater list as we run it so stopped animators are removed
    // without requiring a separate cleanup pass.
    const next = [];
    for (const entry of state.activeAnimUpdaters) {
        if (!entry || !entry.animState || entry.animState.stopped) continue;
        try {
            entry.updateFrame(nowMs);
            next.push(entry);
        } catch (err) {
            console.warn('Animation updater error:', err);
        }
    }
    state.activeAnimUpdaters = next;
}

export function refreshActiveExprsForSliderValueChange() {
    for (const entry of state.activeAnimExprs) {
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

export function recompileActiveExprs() {
    recompileActiveSceneFunctions();
    for (const entry of state.activeAnimExprs) {
        if (entry.animState.stopped) continue;
        if (typeof entry._rebuildFn === 'function') {
            try {
                entry._rebuildFn();
            } catch (err) {
                console.warn('Slider parametric recompile error:', err);
            }
            continue;
        }
        try {
            entry.compiledFns = entry.exprStrings.map(e => compileExpr(e));
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
                const [nE, rE, cxE, cyE, czE, rotE] = entry._regExprs;
                entry._regState.cN   = compileExpr(nE);
                entry._regState.cR   = compileExpr(rE);
                entry._regState.cCx  = compileExpr(cxE);
                entry._regState.cCy  = compileExpr(cyE);
                entry._regState.cCz  = compileExpr(czE);
                entry._regState.cRot = compileExpr(rotE);
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
    if (state.followCamState && state.followCamState.exprStrings) {
        try {
            state.followCamState.compiledExprs = state.followCamState.exprStrings.map(e => compileExpr(e));
        } catch (err) {
            console.warn('Follow-cam recompile error:', err);
        }
        if (state.followCamState.fromExprStrings) {
            try {
                state.followCamState.compiledFromExprs = state.followCamState.fromExprStrings.map(e => compileExpr(e));
            } catch (err) {
                console.warn('Follow-cam fromExpr recompile error:', err);
            }
        }
    }
    if (state.activeVirtualTimeExpr) {
        try {
            state.activeVirtualTimeCompiled = compileExpr(state.activeVirtualTimeExpr);
        } catch (err) {
            console.warn('virtualTime recompile error:', err);
            state.activeVirtualTimeCompiled = null;
        }
    }
    if (typeof window._algebenchUpdateInfoOverlays === 'function') {
        window._algebenchUpdateInfoOverlays();
    }
}

// ----- Slider state persistence -----

export function syncSliderState() {
    // Persist current slider values to localStorage
    const s = {};
    for (const [id, sl] of Object.entries(state.sceneSliders)) {
        s[id] = sl.value;
    }
    try { localStorage.setItem('algebench-sliders', JSON.stringify(s)); } catch(e) {}
    // Update status bar pill — call via window shim to avoid circular import
    if (typeof window._algebenchUpdateStatusBar === 'function') {
        window._algebenchUpdateStatusBar();
    }
}

// ----- Animate Slider Programmatically -----

export function animateSlider(id, target, duration) {
    return new Promise(resolve => {
        const slider = state.sceneSliders[id];
        if (!slider) { resolve(false); return; }
        target = Math.max(slider.min, Math.min(slider.max, target));
        const start = slider.value;
        if (start === target) { syncSliderState(); resolve(true); return; }
        const startTime = performance.now();
        function tick(now) {
            const t = Math.min((now - startTime) / duration, 1);
            const eased = t < 1 ? t * (2 - t) : 1;  // ease-out quad
            slider.value = start + (target - start) * eased;
            // Update the HTML range input and value display to match
            const input = document.querySelector(`input[data-slider-id="${id}"]`);
            if (input) {
                input.value = slider.value;
                const valSpan = input.parentElement && input.parentElement.querySelector('.slider-value');
                if (valSpan) valSpan.textContent = Number(slider.value).toFixed(1);
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
