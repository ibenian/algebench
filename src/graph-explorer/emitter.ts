// ============================================================
// emitter.ts — a minimal typed event emitter for the graph explorer.
//
// AlgeBench has no store library: app state is plain module singletons
// (src/state.ts) and cross-module signals are window CustomEvents. Neither
// fits here — window events are untyped and global, while a graph view model
// needs per-instance, typed, unsubscribable notifications. This ~30-line
// emitter is the smallest thing that does that; see
// docs/knowledge-graph-explorer.md "State management decision".
// ============================================================

export class Emitter<Events extends Record<string, unknown>> {
    private readonly handlers = new Map<keyof Events, Set<(payload: never) => void>>();

    on<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): () => void {
        let set = this.handlers.get(event);
        if (!set) this.handlers.set(event, set = new Set());
        set.add(fn as (payload: never) => void);
        return () => { set!.delete(fn as (payload: never) => void); }; // ! — set captured above
    }

    emit<K extends keyof Events>(event: K, payload: Events[K]): void {
        const set = this.handlers.get(event);
        if (!set) return;
        for (const fn of [...set]) {
            try { (fn as (p: Events[K]) => void)(payload); } catch (err) { console.error('[graph-explorer] handler failed', err); }
        }
    }

    listenerCount(event?: keyof Events): number {
        if (event !== undefined) return this.handlers.get(event)?.size ?? 0;
        let n = 0;
        for (const s of this.handlers.values()) n += s.size;
        return n;
    }

    clear(): void { this.handlers.clear(); }
}
