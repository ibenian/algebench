// ============================================================
// coach/registry.js — the Coach step registry (singleton).
//
// Mirrors the window.AlgeBenchDomains pattern in main.js: a tiny
// self-registering collection that decouples step *definitions*
// (steps/*.js modules) from the *engine* (coach.js). Features push
// steps; the engine reads them. Adding a new feature's hint is a new
// self-registering module + one import line in steps/index.js — no
// engine, app, or index.html changes.
// ============================================================

const coach = (window.AlgeBenchCoach = window.AlgeBenchCoach || {
    _steps: [],
    // register(step | step[]) — called by steps/*.js modules at import time.
    register(s) {
        if (Array.isArray(s)) this._steps.push(...s);
        else if (s) this._steps.push(s);
    },
    // get() — all registered steps, sorted by sparse `order` (default 0).
    get() {
        return this._steps
            .slice()
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    },
});

export { coach };
