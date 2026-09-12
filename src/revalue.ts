/**
 * When a slider-driven re-evaluation is allowed to run.
 *
 * Re-evaluating a lattice is cheap; REPAINTING one is not. A cell's text is
 * drawn into a canvas and uploaded as a texture, so a frame in which any value
 * changed costs tens of milliseconds where an idle frame costs under one. While
 * a slider is dragged every frame is such a frame, and a scene carrying a dozen
 * lattices spends its whole budget there -- the camera stalls with the numbers,
 * which is what makes a drag feel broken rather than merely behind.
 *
 * So changes are coalesced: at most one re-evaluation per `MAX_WAIT_MS` while
 * the slider keeps moving, and one more once it has been still for `QUIET_MS`,
 * which is the one that settles the exact value. Between them the frame does
 * nothing and the camera runs at the display's rate.
 *
 * Two things must never be throttled, and both bypass this gate:
 *   - a slider that is animating (`_loopPlaying` / `_tweening`) changes its
 *     value every frame WITHOUT emitting `algebench:sliderchange`, so a gate
 *     that waited for the event would freeze the sweep;
 *   - an expression that reads `t` is time-driven rather than slider-driven,
 *     and its element opts out by asking `alwaysLive` of its own sources.
 *
 * The decision is cached per frame. `runAnimUpdaters` hands every updater the
 * same `nowMs`, so caching on it means a frame cannot update half a scene.
 */
import { state } from '/state.js';

/** The longest a pending change may wait while the slider keeps moving. */
const MAX_WAIT_MS = 120;
/** No change for this long counts as stabilised, and earns the final pass. */
const QUIET_MS = 60;

interface AnimatableSlider { _loopPlaying?: boolean; _tweening?: boolean }
interface RevalueState { sceneSliders: Record<string, AnimatableSlider> }
const revalueState = state as unknown as RevalueState;

let pending = false;
let lastChange = 0;
let lastApply = 0;
let hooked = false;

let decidedAt = Number.NaN;
let decision = false;

function hook(): void {
    if (hooked) return;
    hooked = true;
    try {
        window.addEventListener('algebench:sliderchange', () => {
            pending = true;
            lastChange = performance.now();
        });
    } catch (_err) { /* no window: nothing drives a frame either */ }
}

/** Is some slider mid-sweep? Its value moves without an event, so it cannot wait. */
function sliderAnimating(): boolean {
    const sliders = revalueState.sceneSliders;
    if (!sliders) return false;
    for (const id in sliders) {
        const s = sliders[id];
        if (s && (s._loopPlaying || s._tweening)) return true;
    }
    return false;
}

/**
 * Does `src` read the time variable? Such an expression is driven by the frame
 * clock rather than by a slider, so its element must keep evaluating. Matched
 * on a word boundary, which `toFixed` and `tfQh` do not trip.
 */
export function readsTime(...src: (string | null | undefined)[]): boolean {
    for (const s of src) if (typeof s === 'string' && /\bt\b/.test(s)) return true;
    return false;
}

function decide(nowMs: number): boolean {
    if (sliderAnimating()) { pending = false; return true; }
    if (!pending) return false;
    const sinceChange = nowMs - lastChange;
    const sinceApply = nowMs - lastApply;
    if (sinceChange >= QUIET_MS || sinceApply >= MAX_WAIT_MS) {
        lastApply = nowMs;
        // Only the settling pass clears the flag; a mid-drag pass leaves it
        // set so the value the slider lands on still gets its own evaluation.
        if (sinceChange >= QUIET_MS) pending = false;
        return true;
    }
    return false;
}

/** May a slider-driven re-evaluation run on the frame stamped `nowMs`? */
export function shouldRevalue(nowMs: number): boolean {
    hook();
    if (nowMs === decidedAt) return decision;
    decidedAt = nowMs;
    decision = decide(nowMs);
    return decision;
}

/** Drop the coalescing state, so a new scene starts with nothing pending. */
export function resetRevalue(): void {
    pending = false;
    lastChange = 0;
    lastApply = 0;
    decidedAt = Number.NaN;
    decision = false;
}
