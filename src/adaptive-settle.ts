/**
 * Adaptive settle: run an action once a stream of transitions settles, waiting longer the faster they come.
 *
 * Each `poke()` records a transition and (re)starts the wait. A transition after a quiet spell (no other in
 * the last `idleMs`) fires almost at once (`minMs`): someone who paused, then stepped, gets an answer
 * immediately. Transitions in quick succession form a burst, and the wait grows with it: `factor` times the
 * mean gap between the burst's transitions, plus `stepMs` for each transition in the burst, capped at
 * `maxMs`. Someone scrubbing back and forth is waited out until they stop, however fast they go.
 *
 * Used by the state narrator so stepping quickly does not send a tutor request per state; nothing in it is
 * specific to narration.
 */
export interface SettleOptions {
    /** Wait after a quiet spell (and the floor for any wait), ms. */
    minMs?: number;
    /** Longest wait, however fast the transitions come, ms. */
    maxMs?: number;
    /** A gap at least this long ends a burst, ms. */
    idleMs?: number;
    /** How many recent gaps the mean looks at. */
    window?: number;
    /** Wait = factor × mean burst gap + stepMs × burst length. */
    factor?: number;
    stepMs?: number;
    /** Clock, ms; tests inject one. */
    now?: () => number;
}

export interface Settler {
    /** A transition happened: restart the wait, sized by the recent transitions. `atLeast` raises the floor. */
    poke(atLeast?: number): void;
    /** Run the action after `ms` without recording a transition (a retry), unless a run is already pending:
     *  a burst's longer wait is never cut short by a retry. */
    after(ms: number): void;
    /** Drop any pending run and forget the burst. */
    cancel(): void;
    readonly pending: boolean;
    /** The wait a poke made now would use (before any `atLeast`). */
    nextDelay(): number;
}

export function createSettler(action: () => void, options: SettleOptions = {}): Settler {
    const {minMs = 100, maxMs = 2500, idleMs = 1500, window = 6, factor = 1.5, stepMs = 150, now = () => Date.now()} = options;
    let last: number | null = null, timer: ReturnType<typeof setTimeout> | null = null;
    const gaps: number[] = [];
    const run = () => { timer = null; action(); };
    const arm = (ms: number) => { if (timer) clearTimeout(timer); timer = setTimeout(run, ms); };
    /** The wait for a transition at time t, given the burst so far (gaps holds only the burst's gaps). */
    const delayAt = (t: number, burst: readonly number[]) => {
        if (last === null || t - last >= idleMs) return minMs;
        const recent = [...burst, t - last].slice(-window);
        const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
        return Math.min(maxMs, Math.max(minMs, factor * mean + stepMs * recent.length));
    };
    return {
        poke(atLeast = 0) {
            const t = now(), wait = delayAt(t, gaps);
            if (last !== null && t - last < idleMs) gaps.push(t - last); else gaps.length = 0;
            if (gaps.length > window) gaps.shift();
            last = t;
            arm(Math.max(wait, atLeast));
        },
        after(ms: number) {
            if (!timer) arm(ms);
        },
        cancel() { if (timer) clearTimeout(timer); timer = null; gaps.length = 0; last = null; },
        get pending() { return timer !== null; },
        nextDelay() { return delayAt(now(), gaps); },
    };
}
