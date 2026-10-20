/**
 * Which value is which between two states of an array or graph, so a value that moves (a swap, a heap's
 * sift, a pop moving the last value to the front) can glide to its new cell instead of being redrawn in
 * place. Without explicit ids, values are matched: a value still in its cell keeps its identity, then each
 * remaining cell takes the nearest unused cell that held an equal value; anything left over is new. Equal
 * values only blur which of two identical values moved, which looks the same.
 */
export function matchIdentities(prevKeys: readonly string[], prevIds: readonly string[], keys: readonly string[], fresh: () => string): string[] {
    const used = new Set<number>(), ids: (string | undefined)[] = keys.map(() => undefined);
    keys.forEach((k, j) => {
        if (j < prevKeys.length && prevKeys[j] === k && prevIds[j] !== undefined) { ids[j] = prevIds[j]; used.add(j); }
    });
    keys.forEach((k, j) => {
        if (ids[j] !== undefined) return;
        let best = -1;
        prevKeys.forEach((p, i) => {
            if (used.has(i) || prevIds[i] === undefined || p !== k) return;
            if (best < 0 || Math.abs(i - j) < Math.abs(best - j)) best = i;
        });
        if (best >= 0) { ids[j] = prevIds[best]; used.add(best); }
    });
    return ids.map(id => id ?? fresh());
}

/** For each cell whose identity sat in another cell before: new cell → old cell. */
export function identityMoves(prevIds: readonly string[], ids: readonly string[]): Map<number, number> {
    const was = new Map(prevIds.map((id, i) => [id, i]));
    const moves = new Map<number, number>();
    ids.forEach((id, i) => { const p = was.get(id); if (p !== undefined && p !== i) moves.set(i, p); });
    return moves;
}

/**
 * Tracks identities across an object's states: `next` takes the new state's value keys (or explicit ids)
 * and returns the moves since the last state.
 */
export function identityTracker(prefix: string) {
    let keys: string[] = [], ids: string[] = [], seq = 0;
    return {
        next(nextKeys: string[], explicit?: string[]): Map<number, number> {
            const nextIds = explicit ?? matchIdentities(keys, ids, nextKeys, () => `${prefix}${seq++}`);
            const moves = identityMoves(ids, nextIds);
            keys = nextKeys; ids = nextIds;
            return moves;
        },
    };
}
