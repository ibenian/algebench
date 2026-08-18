// ============================================================
// coach/registry.ts — the Coach step registry (singleton).
//
// Mirrors the window.AlgeBenchDomains pattern in main.ts: a tiny
// self-registering collection that decouples step *definitions*
// (steps/*.ts modules) from the *engine* (coach.ts). Features push
// steps; the engine reads them. Adding a new feature's hint is a new
// self-registering module + one import line in steps/index.ts — no
// engine, app, or index.html changes.
// ============================================================

/**
 * The context object the engine hands to every `step.when` / `step.action`.
 * Built by `buildCtx()` in coach.ts.
 */
export interface CoachContext {
    /** True when a lesson with at least one scene is loaded. */
    hasScene: boolean;
    /** True when the AI chat is usable (no "unavailable" banner). */
    chatAvailable: boolean;
    openChatTab: () => void;
    clickDockTab: (name: string) => void;
    selectFirstGraphStep: () => boolean;
    selectFirstGraphNode: () => boolean;
    gotoSliderStep: () => boolean;
    gotoProofStep: () => boolean;
    openProofPanel: () => boolean;
    ensureProofStep: () => void;
    handToChat: (text: string, examples?: string[]) => boolean;
    delay: (ms: number) => Promise<void>;
    speak: (text: string) => void;
}

/** One tour stop, as registered by a steps/*.ts module. */
export interface CoachStep {
    /** STABLE id — drives completion tracking; never rename/reuse. */
    id: string;
    /** Sparse sort key (default 0). */
    order?: number;
    group?: string;
    /** CSS selector, or a resolver returning the element to spotlight. */
    target?: string | (() => Element | null);
    title?: string;
    narration?: string;
    /** 'right' (default) | 'left' | 'top' | 'bottom' | 'bottom-start' | 'center'. */
    position?: string;
    /** Gate: the step is only relevant when this returns truthy. */
    when?: (ctx: CoachContext) => boolean;
    /** Optional steps are silently skipped when their target is missing. */
    optional?: boolean;
    /** Pre-show setup (switch tabs, navigate, …). */
    action?: (ctx: CoachContext) => void | Promise<void>;
    /** Chips offered under the card, handed off to the main chat. */
    examplePrompts?: string[];
}

/** The singleton published at `window.AlgeBenchCoach`. */
export interface CoachRegistry {
    _steps: CoachStep[];
    register(s: CoachStep | CoachStep[] | null | undefined): void;
    get(): CoachStep[];
    /** Attached by coach.ts once the engine module has loaded. */
    engine?: import('./coach.js').CoachEngine;
}

const coach = (window.AlgeBenchCoach = window.AlgeBenchCoach || {
    _steps: [],
    // register(step | step[]) — called by steps/*.ts modules at import time.
    register(s: CoachStep | CoachStep[] | null | undefined) {
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
