// ============================================================
// Tensor cell pop — the one slider that edits one cell of a
// tensor slider. It opens beside whatever the cursor is on: a
// readout in the slider panel's grid, or a cell of a `tensor`
// element bound to the slider on the 3D plane. One DOM node,
// reused; it hides shortly after the cursor leaves both the
// cell and the pop, so the user can travel into it.
// ============================================================

import { state } from '/state.js';
import { renderKaTeX } from '/labels.js';
import { isTensorSlider, tensorCellIndex, tensorCellName, setTensorSliderCell,
         formatTensorCell, setTensorCellPopHandler, type SceneSlider } from '/sliders.js';

interface PopState { sceneSliders: Record<string, SceneSlider | undefined>; }
const popState = state as unknown as PopState;

// Long enough to cross from the cell into the pop without it closing.
const HIDE_DELAY_MS = 450;
// The pop overlaps the cell's edge by this much: no dead strip between them
// where the cursor is on neither and the hide timer would run.
const OVERLAP_PX = 2;

let _el: HTMLElement | null = null;
let _range: HTMLInputElement | null = null;
let _num: HTMLInputElement | null = null;
let _title: HTMLElement | null = null;
let _reset: HTMLButtonElement | null = null;
let _hideTimer: ReturnType<typeof setTimeout> | null = null;
let _cur: { id: string; r: number; c: number } | null = null;

type Anchor = DOMRect | { left: number; top: number; right: number; bottom: number };

function ensure(): HTMLElement {
    if (_el) return _el;
    const el = document.createElement('div');
    el.id = 'tslider-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Edit one cell');
    el.style.display = 'none';

    const head = document.createElement('div');
    head.className = 'tslider-pop-head';
    _title = document.createElement('span');
    _title.className = 'tslider-pop-title';
    head.appendChild(_title);
    _reset = document.createElement('button');
    _reset.type = 'button';
    _reset.className = 'tslider-pop-reset';
    _reset.textContent = '↺';
    _reset.title = 'Reset this cell';
    _reset.setAttribute('aria-label', 'Reset this cell');
    _reset.addEventListener('click', () => {
        if (!_cur) return;
        const s = popState.sceneSliders[_cur.id];
        if (!isTensorSlider(s) || !s.defaults) return;
        const i = tensorCellIndex(s, _cur.r, _cur.c);
        if (i >= 0) { setTensorSliderCell(_cur.id, _cur.r, _cur.c, s.defaults[i]!); sync(); }
    });
    head.appendChild(_reset);
    el.appendChild(head);

    const body = document.createElement('div');
    body.className = 'tslider-pop-body';
    _range = document.createElement('input');
    _range.type = 'range';
    _range.className = 'slider-range';
    _range.addEventListener('input', () => {
        if (!_cur || !_range) return;
        setTensorSliderCell(_cur.id, _cur.r, _cur.c, parseFloat(_range.value));
        if (_num) _num.value = String(currentValue());
    });
    body.appendChild(_range);
    _num = document.createElement('input');
    _num.type = 'number';
    _num.className = 'tslider-pop-num';
    _num.addEventListener('change', () => {
        if (!_cur || !_num) return;
        const v = parseFloat(_num.value);
        if (Number.isFinite(v)) setTensorSliderCell(_cur.id, _cur.r, _cur.c, v);
        sync();
    });
    _num.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideNow(); });
    body.appendChild(_num);
    el.appendChild(body);

    // The cursor may travel from the cell into the pop: cancel the pending
    // hide on entry, re-arm it on exit.
    el.addEventListener('mouseenter', cancelHide);
    el.addEventListener('mouseleave', scheduleHide);
    el.addEventListener('focusin', cancelHide);
    el.addEventListener('focusout', (e) => {
        if (e.relatedTarget && el.contains(e.relatedTarget as Node)) return;
        scheduleHide();
    });
    // The pop sits over the 3D canvas; a drag on its track must not orbit.
    el.addEventListener('pointerdown', e => e.stopPropagation());
    el.addEventListener('mousedown', e => e.stopPropagation());
    el.addEventListener('wheel', e => e.stopPropagation());

    document.body.appendChild(el);
    _el = el;
    return el;
}

function currentValue(): number {
    if (!_cur) return NaN;
    const s = popState.sceneSliders[_cur.id];
    if (!isTensorSlider(s)) return NaN;
    const i = tensorCellIndex(s, _cur.r, _cur.c);
    return i >= 0 ? s.values[i]! : NaN;
}

/** Copy the cell's value into both inputs (after a reset or a typed value). */
function sync(): void {
    const v = currentValue();
    if (_range) _range.value = String(v);
    if (_num) _num.value = String(v);
}

function place(el: HTMLElement, anchor: Anchor): void {
    // Below the anchor by default, flipping above when the bottom edge would
    // leave the window; always kept inside horizontally.
    el.style.display = 'block';
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = anchor.left - 4;
    let top = anchor.bottom - OVERLAP_PX;
    if (top + h > vh - 4) top = anchor.top + OVERLAP_PX - h;
    if (left + w > vw - 4) left = vw - 4 - w;
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
}

export function showTensorCellPop(id: string, r: number, c: number, anchor: Anchor): void {
    const s = popState.sceneSliders[id];
    if (!isTensorSlider(s) || tensorCellIndex(s, r, c) < 0) return;
    const el = ensure();
    cancelHide();
    const same = _cur && _cur.id === id && _cur.r === r && _cur.c === c;
    _cur = { id, r, c };
    if (_title) _title.innerHTML = renderKaTeX(tensorCellName(id, r, c), false);
    if (_range) {
        _range.min = String(s.min);
        _range.max = String(s.max);
        _range.step = String(s.step);
        _range.setAttribute('aria-label', 'Value of ' + tensorCellName(id, r, c));
    }
    if (_num) {
        _num.min = String(s.min);
        _num.max = String(s.max);
        _num.step = String(s.step);
    }
    sync();
    // A pop already open on this cell stays put; anything else re-anchors.
    if (!same || el.style.display === 'none') place(el, anchor);
}

export function scheduleHide(): void {
    cancelHide();
    if (_scrubbing) return;   // a drag in progress keeps its pop
    _hideTimer = setTimeout(hideNow, HIDE_DELAY_MS);
}

function cancelHide(): void {
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
}

export function hideNow(): void {
    cancelHide();
    if (_el) _el.style.display = 'none';
    _cur = null;
}

// ----- scrubbing: press on a cell and drag sideways to change it -----

/** Pixels of horizontal travel that sweep the whole [min, max] range. */
const SCRUB_PX_PER_RANGE = 240;
let _scrubbing = false;

/** True while a press-and-drag on a cell is in progress. */
export function isScrubbing(): boolean { return _scrubbing; }

/** Start editing (id, r, c) by dragging sideways from `startX`. Moves are
 *  read from the window until the button lifts, so the cursor can leave the
 *  cell; the pop stays open and follows the value. `capture` may be the
 *  element to hold pointer capture on. */
export function beginCellScrub(id: string, r: number, c: number, startX: number, pointerId?: number, capture?: Element): void {
    const s = popState.sceneSliders[id];
    if (!isTensorSlider(s)) return;
    const i = tensorCellIndex(s, r, c);
    if (i < 0) return;
    const start = s.values[i]!;
    const range = s.max - s.min;
    const step = s.step > 0 ? s.step : 0.1;
    _scrubbing = true;
    _cur = { id, r, c };
    cancelHide();
    document.body.classList.add('tslider-scrubbing');
    if (capture && pointerId !== undefined && 'setPointerCapture' in capture) {
        try { (capture as HTMLElement).setPointerCapture(pointerId); } catch { /* ignore */ }
    }
    const onMove = (e: PointerEvent) => {
        if (pointerId !== undefined && e.pointerId !== pointerId) return;
        const raw = start + (e.clientX - startX) / SCRUB_PX_PER_RANGE * range;
        const v = Math.round(raw / step) * step;
        setTensorSliderCell(id, r, c, Number(v.toFixed(10)));
        if (_cur && _cur.id === id && _cur.r === r && _cur.c === c) sync();
    };
    const onUp = (e: PointerEvent) => {
        if (pointerId !== undefined && e.pointerId !== pointerId) return;
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onUp, true);
        _scrubbing = false;
        document.body.classList.remove('tslider-scrubbing');
        if (capture && pointerId !== undefined && 'releasePointerCapture' in capture) {
            try { (capture as HTMLElement).releasePointerCapture(pointerId); } catch { /* ignore */ }
        }
        // The cursor may have ended up anywhere; give it the usual grace.
        scheduleHide();
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
}

/** The cell the pop is editing, or null. */
export function tensorPopTarget(): { id: string; r: number; c: number } | null {
    return _cur ? { ..._cur } : null;
}

export function setupTensorCellPop(): void {
    setTensorCellPopHandler({ show: showTensorCellPop, scheduleHide, scrub: beginCellScrub });
    // A step change rebuilds the panel and may remove the slider: close the pop.
    window.addEventListener('algebench:navchange', hideNow);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _el && _el.style.display !== 'none') hideNow(); });
}

// Exported for the panel readouts, which format the same way.
export { formatTensorCell };
