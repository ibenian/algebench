/**
 * The glide of values that moved between cells (or graph nodes): each moved cell is drawn on its way from
 * where its value was drawn to its own place, eased over `ms`. The owner calls `moved` after a state change
 * and draws through `at`; a frame loop runs only while something is moving. Cells, not values, own indexes,
 * markers and links, so only what is drawn for the value moves.
 */
type Vec3 = [number, number, number];

export function createCellGlide(opts: {ms: number; draw: () => void; stopped: () => boolean}) {
    let from = new Map<number, Vec3>(), start = 0, frame = 0;
    const progress = () => opts.ms > 0 ? Math.min(1, (performance.now() - start) / opts.ms) : 1;
    const ease = (t: number) => t * t * (3 - 2 * t);
    /** Where cell i's value is drawn now, given where the cell itself is. */
    const at = (i: number, home: Vec3): Vec3 => {
        const f = from.get(i);
        if (!f) return home;
        const e = ease(progress());
        return [f[0] + (home[0] - f[0]) * e, f[1] + (home[1] - f[1]) * e, f[2] + (home[2] - f[2]) * e];
    };
    const tick = () => {
        frame = 0;
        if (opts.stopped()) return;
        const done = progress() >= 1;
        if (done) from = new Map();
        opts.draw();
        if (!done) frame = requestAnimationFrame(tick);
    };
    return {
        at,
        get moving() { return from.size > 0; },
        /** moves: new cell → old cell; drawnBefore(old): where the old cell's value was drawn a moment ago. */
        moved(moves: Map<number, number>, drawnBefore: (old: number) => Vec3 | null) {
            const next = new Map<number, Vec3>();
            for (const [to, old] of moves) { const p = drawnBefore(old); if (p) next.set(to, p); }
            from = next; start = performance.now();
            if (from.size && !frame) frame = requestAnimationFrame(tick);
        },
        dispose() { cancelAnimationFrame(frame); frame = 0; },
    };
}
