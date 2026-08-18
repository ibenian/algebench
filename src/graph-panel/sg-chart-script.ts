/**
 * SgChartScript — fetches or retrieves mathjs scripts for semantic graph nodes.
 *
 * Isolates script generation (backend API calls, caching, pre-computed
 * lookups) from chart rendering.  The chart manager only ever sees
 * ``{ script, variables }`` results.
 *
 * Two paths:
 *   1. **Pre-computed** — node.chartScript is already populated (offline
 *      reports embed scripts at generation time).
 *   2. **Backend API** — POST /api/graph/generate-mathjs with the node's
 *      ``subexpr`` (LaTeX).  Backend handles relation detection, LHS−RHS
 *      construction, and SymPy→mathjs conversion.
 */

import type { Node as GraphNode } from '/types/semantic-graph.js';

/**
 * The pre-computed `chartScript` block. NOT part of
 * schemas/semantic-graph.schema.json — it is attached by the
 * expression-analysis backend and by the offline report generator.
 * graph-panel/d3-semantic-graph.ts carries the same field as `unknown` because
 * it only tests it for presence; this module is the one that reads inside it.
 */
export interface SgChartScriptBlock {
    script?: string;
    variables?: string[];
}

/** A semantic-graph node as this module reads one: the schema node plus the
 *  non-schema `chartScript` block above. */
export type SgScriptNode = GraphNode & { chartScript?: SgChartScriptBlock };

/** The graph this service indexes. Loose on purpose — offline reports hand it
 *  a plain `{nodes, edges}` object, and only `nodes` is read here. */
export interface SgScriptGraph {
    nodes?: SgScriptNode[];
}

/**
 * The outcome of a script lookup: EITHER `{script, variables}` on success or
 * `{error, detail?}` on failure. Modelled as one open shape rather than a
 * discriminated union because every consumer probes `.error` first and then
 * reads the success fields off the same object — exactly what the JavaScript
 * did, and what SgChartManager still does.
 */
export interface SgScriptOutcome {
    script?: string;
    variables?: string[];
    error?: string;
    detail?: string;
}

/** The JSON body of POST /api/graph/generate-mathjs. */
interface GenerateMathjsResponse {
    script?: string;
    variables?: string[];
    error?: string;
    detail?: string;
}

export class SgChartScript {
    /** nodeId → node data */
    _nodeById: Map<string, SgScriptNode>;
    /** nodeId → the resolved outcome, success or failure (both are cached). */
    _cache: Map<string, SgScriptOutcome>;

    /**
     * @param {Object} graph - Semantic graph JSON ({ nodes, edges })
     */
    constructor(graph: SgScriptGraph) {
        /** @type {Map<string, Object>} nodeId → node data */
        this._nodeById = new Map();
        for (const n of (graph.nodes || [])) {
            this._nodeById.set(n.id, n);
        }

        /** @type {Map<string, {script:string, variables:string[]}|{error:string}>} */
        this._cache = new Map();
    }

    /**
     * Check if a node can potentially produce a chart script.
     * @param {string} nodeId
     * @returns {boolean}
     */
    canChart(nodeId: string): boolean {
        const n = this._nodeById.get(nodeId);
        if (!n) return false;
        // Pre-computed script available?
        if (n.chartScript && n.chartScript.script) return true;
        // Has a subexpr we can send to the backend?
        if (n.subexpr) return true;
        return false;
    }

    /**
     * Get a mathjs script for the given node.
     *
     * @param {string} nodeId
     * @returns {Promise<{script:string, variables:string[]}|{error:string}>}
     */
    async getScript(nodeId: string): Promise<SgScriptOutcome> {
        // Return cached result if available.
        // `!` — guarded by the `has` on this same line.
        if (this._cache.has(nodeId)) return this._cache.get(nodeId)!;

        const n = this._nodeById.get(nodeId);
        if (!n) {
            const err: SgScriptOutcome = { error: `Node "${nodeId}" not found` };
            this._cache.set(nodeId, err);
            return err;
        }

        // Path 1: pre-computed (offline reports).
        if (n.chartScript && n.chartScript.script) {
            const result: SgScriptOutcome = {
                script: n.chartScript.script,
                variables: n.chartScript.variables || [],
            };
            this._cache.set(nodeId, result);
            return result;
        }

        // Path 2: backend API.
        const subexpr = n.subexpr;
        if (!subexpr) {
            const err: SgScriptOutcome = { error: 'Node has no subexpr' };
            this._cache.set(nodeId, err);
            return err;
        }

        try {
            const resp = await fetch('/api/graph/generate-mathjs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subexpr }),
            });

            const data = await resp.json() as GenerateMathjsResponse;

            if (!resp.ok || data.error) {
                const err: SgScriptOutcome = { error: data.error || `HTTP ${resp.status}`, detail: data.detail || '' };
                this._cache.set(nodeId, err);
                return err;
            }

            const result: SgScriptOutcome = { script: data.script, variables: data.variables || [] };
            this._cache.set(nodeId, result);
            return result;
        } catch (e) {
            const err: SgScriptOutcome = { error: `Network error: ${(e as Error).message}` };
            this._cache.set(nodeId, err);
            return err;
        }
    }
}
