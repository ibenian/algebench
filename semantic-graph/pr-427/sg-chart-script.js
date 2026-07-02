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

export class SgChartScript {
    /**
     * @param {Object} graph - Semantic graph JSON ({ nodes, edges })
     */
    constructor(graph) {
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
    canChart(nodeId) {
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
    async getScript(nodeId) {
        // Return cached result if available.
        if (this._cache.has(nodeId)) return this._cache.get(nodeId);

        const n = this._nodeById.get(nodeId);
        if (!n) {
            const err = { error: `Node "${nodeId}" not found` };
            this._cache.set(nodeId, err);
            return err;
        }

        // Path 1: pre-computed (offline reports).
        if (n.chartScript && n.chartScript.script) {
            const result = {
                script: n.chartScript.script,
                variables: n.chartScript.variables || [],
            };
            this._cache.set(nodeId, result);
            return result;
        }

        // Path 2: backend API.
        const subexpr = n.subexpr;
        if (!subexpr) {
            const err = { error: 'Node has no subexpr' };
            this._cache.set(nodeId, err);
            return err;
        }

        try {
            const resp = await fetch('/api/graph/generate-mathjs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subexpr }),
            });

            const data = await resp.json();

            if (!resp.ok || data.error) {
                const err = { error: data.error || `HTTP ${resp.status}`, detail: data.detail || '' };
                this._cache.set(nodeId, err);
                return err;
            }

            const result = { script: data.script, variables: data.variables || [] };
            this._cache.set(nodeId, result);
            return result;
        } catch (e) {
            const err = { error: `Network error: ${e.message}` };
            this._cache.set(nodeId, err);
            return err;
        }
    }
}
