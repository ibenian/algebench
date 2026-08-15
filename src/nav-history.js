// ============================================================
// nav-history.js — Browser History API bridge for deeplinking.
//
// Wraps the pure NavStack core with the URL rewriting + popstate handling.
//   - pushView(vs):    new history entry (scene/step/proof-step transitions)
//   - replaceView(vs): rewrite the current URL in place (node selection,
//                      slider overrides, camera capture) — no history spam
//   - setupPopstateListener(applyFn): browser back/forward -> applyFn(vs)
//
// Camera is deliberately NOT part of pushView entries: the 3D viewport must
// not jump when the user presses back/forward. Camera only rides along on
// replaceView (explicit Copy-link capture).
// ============================================================

import { serializeViewState, parseViewState } from '/view-state.js';
import { NavStack } from '/nav-history-core.js';

const stack = new NavStack(100);
let _applyingFromHistory = false;

/** True while a popstate-driven apply is in flight (guards push loops). */
export function isApplyingFromHistory() {
    return _applyingFromHistory;
}

function urlFor(query) {
    const path = window.location.pathname;
    const hash = window.location.hash || '';
    return path + (query ? '?' + query : '') + hash;
}

/** Read the current view state from the live URL. */
export function currentUrlViewState() {
    return parseViewState(window.location.search);
}

/**
 * Push a new history entry for a discrete navigation (scene/step/proof step).
 * No-op while applying from history, or when identical to the current URL.
 */
export function pushView(vs) {
    if (_applyingFromHistory) return;
    const query = serializeViewState(vs);
    const currentQuery = window.location.search.replace(/^\?/, '');
    if (query === currentQuery) return;
    stack.push(query);
    try {
        window.history.pushState({ vs: query }, '', urlFor(query));
    } catch (_) { /* pushState can throw in sandboxed contexts */ }
}

/**
 * Rewrite the current URL in place (selection / sliders / camera capture).
 * Does not create a history entry.
 */
export function replaceView(vs) {
    if (_applyingFromHistory) return;
    const query = serializeViewState(vs);
    const currentQuery = window.location.search.replace(/^\?/, '');
    if (query === currentQuery) return;
    stack.replace(query);
    try {
        window.history.replaceState({ vs: query }, '', urlFor(query));
    } catch (_) { /* ignore */ }
}

/**
 * Install the browser back/forward handler. `applyFn(vs, {fromHistory:true})`
 * is invoked with the parsed ViewState for the URL the browser navigated to.
 */
export function setupPopstateListener(applyFn) {
    window.addEventListener('popstate', (e) => {
        const query = (e.state && e.state.vs != null)
            ? e.state.vs
            : window.location.search.replace(/^\?/, '');
        stack.syncTo(query);
        const vs = parseViewState(query);
        _applyingFromHistory = true;
        Promise.resolve()
            .then(() => applyFn(vs, { fromHistory: true }))
            .catch((err) => console.error('popstate apply failed:', err))
            .finally(() => { _applyingFromHistory = false; });
    });
}

// Reusable accessors for future breadcrumb UI.
export function getStack() { return stack.getStack(); }
export function getCursor() { return stack.getCursor(); }
