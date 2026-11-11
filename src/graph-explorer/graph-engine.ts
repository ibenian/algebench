// ============================================================
// graph-engine.ts — the graph MODEL: AlgeBench-owned graph data and the
// operations on it. Renderer-agnostic and graph-type-agnostic: it knows
// nothing about Cytoscape, the DOM, or what a "concept" is. Import-free, so
// the Node test suite loads it directly.
//
// Storage is ID-indexed: one Map for nodes, one for edges, and two adjacency
// indexes (node id → outgoing / incoming edge ids). Lookups and neighbour
// queries are O(1) per hop; a mutation touches only the records involved —
// nothing copies the whole graph.
//
// Every mutation publishes a GraphPatch to subscribers. Mutations made inside
// batch() are coalesced into ONE patch delivered when the outermost batch ends,
// so a lesson merge of 200 records costs one notification, not 200.
// ============================================================

/** A node record. `data` is the graph type's own payload (opaque here). */
export interface GraphNode<N> {
    readonly id: string;
    data: N;
}

/** A directed, typed edge record. */
export interface GraphEdge<E> {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    /** Relationship type: "uses", "specializes", ... — meaning is the graph type's. */
    readonly type: string;
    data: E;
}

/**
 * What changed, by id. Removed records are carried whole: once removed they
 * are no longer in the engine, and a subscriber (a renderer) may still need
 * their endpoints to clean up.
 */
export interface GraphPatch<N, E> {
    nodesAdded: string[];
    nodesUpdated: string[];
    nodesRemoved: GraphNode<N>[];
    edgesAdded: string[];
    edgesUpdated: string[];
    edgesRemoved: GraphEdge<E>[];
}

export type GraphListener<N, E> = (patch: GraphPatch<N, E>) => void;
export type Direction = 'out' | 'in' | 'both';

export class GraphValidationError extends Error {}

const ID_MAX = 256;

/** A stable id: non-empty, trimmed, bounded, no control characters. */
export function isValidId(id: unknown): id is string {
    return typeof id === 'string' && id.length > 0 && id.length <= ID_MAX
        && id.trim() === id && !/[\u0000-\u001f\u007f]/.test(id);
}

/** The in-flight accumulator: Sets/Maps so a 1,000-record batch stays linear. */
interface PendingPatch<N, E> {
    nodesAdded: Set<string>;
    nodesUpdated: Set<string>;
    nodesRemoved: Map<string, GraphNode<N>>;
    edgesAdded: Set<string>;
    edgesUpdated: Set<string>;
    edgesRemoved: Map<string, GraphEdge<E>>;
}

function emptyPending<N, E>(): PendingPatch<N, E> {
    return { nodesAdded: new Set(), nodesUpdated: new Set(), nodesRemoved: new Map(),
             edgesAdded: new Set(), edgesUpdated: new Set(), edgesRemoved: new Map() };
}

export function isEmptyPatch(p: GraphPatch<unknown, unknown>): boolean {
    return !p.nodesAdded.length && !p.nodesUpdated.length && !p.nodesRemoved.length
        && !p.edgesAdded.length && !p.edgesUpdated.length && !p.edgesRemoved.length;
}

export class GraphEngine<N, E> {
    private readonly nodes = new Map<string, GraphNode<N>>();
    private readonly edges = new Map<string, GraphEdge<E>>();
    private readonly outIdx = new Map<string, Set<string>>();
    private readonly inIdx = new Map<string, Set<string>>();
    private readonly listeners = new Set<GraphListener<N, E>>();
    private pending: PendingPatch<N, E> | null = null;
    private batchDepth = 0;
    /** Bumped on every mutation — a cheap "has anything changed" token. */
    revision = 0;

    // ---------- reads ----------

    get nodeCount(): number { return this.nodes.size; }
    get edgeCount(): number { return this.edges.size; }
    hasNode(id: string): boolean { return this.nodes.has(id); }
    hasEdge(id: string): boolean { return this.edges.has(id); }
    getNode(id: string): GraphNode<N> | undefined { return this.nodes.get(id); }
    getEdge(id: string): GraphEdge<E> | undefined { return this.edges.get(id); }
    /** Live iterators — do not mutate the engine while iterating. */
    allNodes(): IterableIterator<GraphNode<N>> { return this.nodes.values(); }
    allEdges(): IterableIterator<GraphEdge<E>> { return this.edges.values(); }

    /** Edge ids incident to `id` in the given direction. */
    edgeIdsOf(id: string, dir: Direction = 'both'): string[] {
        const out = dir !== 'in' ? this.outIdx.get(id) : undefined;
        const inn = dir !== 'out' ? this.inIdx.get(id) : undefined;
        const ids: string[] = [];
        if (out) for (const e of out) ids.push(e);
        // A self-loop sits in both indexes; list it once.
        if (inn) for (const e of inn) if (!out || !out.has(e)) ids.push(e);
        return ids;
    }

    edgesOf(id: string, dir: Direction = 'both'): GraphEdge<E>[] {
        return this.edgeIdsOf(id, dir).map((e) => this.edges.get(e)!); // ! — indexes only hold live edge ids
    }

    degree(id: string): number {
        return (this.outIdx.get(id)?.size ?? 0) + (this.inIdx.get(id)?.size ?? 0);
    }

    /** Distinct neighbour ids one hop away. */
    neighbors(id: string, dir: Direction = 'both'): string[] {
        const seen = new Set<string>();
        for (const e of this.edgesOf(id, dir)) {
            const other = e.source === id ? e.target : e.source;
            if (other !== id) seen.add(other);
        }
        return [...seen];
    }

    /**
     * Breadth-first neighbourhood: every node within `depth` hops of any seed,
     * mapped to its hop distance. Cycles and shared neighbours are visited once.
     * Stops adding nodes at `limit` (returned `truncated` says so) so a caller
     * can bound what it renders on a dense graph.
     */
    neighborhood(seeds: Iterable<string>, depth: number,
                 opts: { dir?: Direction; limit?: number; edgeFilter?: (e: GraphEdge<E>) => boolean } = {}):
        { nodes: Map<string, number>; truncated: boolean } {
        const dir = opts.dir ?? 'both';
        const limit = opts.limit ?? Infinity;
        const dist = new Map<string, number>();
        let frontier: string[] = [];
        let truncated = false;
        for (const s of seeds) {
            if (!this.nodes.has(s) || dist.has(s)) continue;
            if (dist.size >= limit) { truncated = true; break; }
            dist.set(s, 0);
            frontier.push(s);
        }
        for (let d = 1; d <= depth && frontier.length && !truncated; d++) {
            const next: string[] = [];
            for (const id of frontier) {
                for (const e of this.edgesOf(id, dir)) {
                    if (opts.edgeFilter && !opts.edgeFilter(e)) continue;
                    const other = e.source === id ? e.target : e.source;
                    if (dist.has(other)) continue;
                    if (dist.size >= limit) { truncated = true; break; }
                    dist.set(other, d);
                    next.push(other);
                }
                if (truncated) break;
            }
            frontier = next;
        }
        return { nodes: dist, truncated };
    }

    // ---------- subscriptions ----------

    /** Listen for patches. Returns the unsubscribe function. */
    subscribe(fn: GraphListener<N, E>): () => void {
        this.listeners.add(fn);
        return () => { this.listeners.delete(fn); };
    }

    get listenerCount(): number { return this.listeners.size; }

    /** Run `fn` with all its mutations delivered as one patch. Nests. */
    batch<T>(fn: () => T): T {
        this.batchDepth++;
        try {
            return fn();
        } finally {
            this.batchDepth--;
            if (this.batchDepth === 0) this.flush();
        }
    }

    private patch(): PendingPatch<N, E> {
        if (!this.pending) this.pending = emptyPending();
        return this.pending;
    }

    private flush(): void {
        const q = this.pending;
        this.pending = null;
        if (!q) return;
        const p: GraphPatch<N, E> = {
            nodesAdded: [...q.nodesAdded], nodesUpdated: [...q.nodesUpdated], nodesRemoved: [...q.nodesRemoved.values()],
            edgesAdded: [...q.edgesAdded], edgesUpdated: [...q.edgesUpdated], edgesRemoved: [...q.edgesRemoved.values()],
        };
        if (isEmptyPatch(p)) return;
        // Snapshot: a listener may unsubscribe (or subscribe) while we deliver.
        for (const fn of [...this.listeners]) {
            try { fn(p); } catch (err) { console.error('[graph-engine] listener failed', err); }
        }
    }

    private touched(): void {
        this.revision++;
        if (this.batchDepth === 0) this.flush();
    }

    // ---------- node mutations ----------

    /** Add a node. A duplicate id is an error — use upsertNode to merge. */
    addNode(id: string, data: N): GraphNode<N> {
        if (!isValidId(id)) throw new GraphValidationError(`invalid node id: ${JSON.stringify(id)}`);
        if (this.nodes.has(id)) throw new GraphValidationError(`duplicate node id: ${id}`);
        const node: GraphNode<N> = { id, data };
        this.nodes.set(id, node);
        this.notePatch('nodesAdded', id);
        this.touched();
        return node;
    }

    /** Replace a node's data. Returns false when the node does not exist. */
    updateNode(id: string, data: N): boolean {
        const node = this.nodes.get(id);
        if (!node) return false;
        node.data = data;
        this.notePatch('nodesUpdated', id);
        this.touched();
        return true;
    }

    /**
     * Add the node, or — when the id exists — combine via `merge(existing, incoming)`.
     * Returns 'added' | 'updated' | 'unchanged' (merge returned the same object).
     */
    upsertNode(id: string, data: N, merge: (existing: N, incoming: N) => N): 'added' | 'updated' | 'unchanged' {
        const node = this.nodes.get(id);
        if (!node) { this.addNode(id, data); return 'added'; }
        const merged = merge(node.data, data);
        if (merged === node.data) return 'unchanged';
        this.updateNode(id, merged);
        return 'updated';
    }

    /** Remove a node and every edge touching it. */
    removeNode(id: string): boolean {
        const node = this.nodes.get(id);
        if (!node) return false;
        this.batch(() => {
            for (const e of this.edgeIdsOf(id)) this.removeEdge(e);
            this.nodes.delete(id);
            this.outIdx.delete(id);
            this.inIdx.delete(id);
            const p = this.patch();
            // Added and removed inside one batch: the subscriber never saw it.
            if (!p.nodesAdded.delete(id)) p.nodesRemoved.set(id, node);
            p.nodesUpdated.delete(id);
            this.revision++;
        });
        return true;
    }

    // ---------- edge mutations ----------

    /** Add a directed edge. Both endpoints must exist; the id must be new. */
    addEdge(edge: { id: string; source: string; target: string; type: string; data: E }): GraphEdge<E> {
        const { id, source, target, type } = edge;
        if (!isValidId(id)) throw new GraphValidationError(`invalid edge id: ${JSON.stringify(id)}`);
        if (this.edges.has(id)) throw new GraphValidationError(`duplicate edge id: ${id}`);
        if (!this.nodes.has(source)) throw new GraphValidationError(`edge ${id}: unknown source ${source}`);
        if (!this.nodes.has(target)) throw new GraphValidationError(`edge ${id}: unknown target ${target}`);
        if (typeof type !== 'string' || !type) throw new GraphValidationError(`edge ${id}: missing type`);
        const rec: GraphEdge<E> = { id, source, target, type, data: edge.data };
        this.edges.set(id, rec);
        let o = this.outIdx.get(source); if (!o) this.outIdx.set(source, o = new Set());
        let i = this.inIdx.get(target); if (!i) this.inIdx.set(target, i = new Set());
        o.add(id); i.add(id);
        this.notePatch('edgesAdded', id);
        this.touched();
        return rec;
    }

    updateEdge(id: string, data: E): boolean {
        const edge = this.edges.get(id);
        if (!edge) return false;
        edge.data = data;
        this.notePatch('edgesUpdated', id);
        this.touched();
        return true;
    }

    upsertEdge(edge: { id: string; source: string; target: string; type: string; data: E },
               merge: (existing: E, incoming: E) => E): 'added' | 'updated' | 'unchanged' {
        const cur = this.edges.get(edge.id);
        if (!cur) { this.addEdge(edge); return 'added'; }
        if (cur.source !== edge.source || cur.target !== edge.target || cur.type !== edge.type) {
            throw new GraphValidationError(`edge ${edge.id}: id reused for a different relationship`);
        }
        const merged = merge(cur.data, edge.data);
        if (merged === cur.data) return 'unchanged';
        this.updateEdge(edge.id, merged);
        return 'updated';
    }

    removeEdge(id: string): boolean {
        const edge = this.edges.get(id);
        if (!edge) return false;
        this.edges.delete(id);
        this.outIdx.get(edge.source)?.delete(id);
        this.inIdx.get(edge.target)?.delete(id);
        const p = this.patch();
        if (!p.edgesAdded.delete(id)) p.edgesRemoved.set(id, edge);
        p.edgesUpdated.delete(id);
        this.touched();
        return true;
    }

    /** Drop everything (one patch). */
    clear(): void {
        this.batch(() => { for (const id of [...this.nodes.keys()]) this.removeNode(id); });
    }

    private notePatch(kind: 'nodesAdded' | 'nodesUpdated' | 'edgesAdded' | 'edgesUpdated', id: string): void {
        const p = this.patch();
        // An update to something added in this same batch is just the add.
        if (kind === 'nodesUpdated' && p.nodesAdded.has(id)) return;
        if (kind === 'edgesUpdated' && p.edgesAdded.has(id)) return;
        p[kind].add(id);
    }
}
