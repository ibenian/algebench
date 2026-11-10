// ============================================================
// cy-elements.ts — the pure conversion from AlgeBench graph records to
// Cytoscape element definitions. No Cytoscape import: it produces plain
// objects in Cytoscape's ElementDefinition shape, so it is unit-tested in Node
// and the lesson schema never has to look like Cytoscape's format.
// ============================================================

import type { GraphEdge, GraphNode } from '/graph-explorer/graph-engine.js';
import type { GraphTypeAdapter } from '/graph-explorer/graph-type.js';
import { classToken } from '/graph-explorer/graph-type.js';

export interface CyNodeDef {
    group: 'nodes';
    /** `display` is what is drawn: the label plus a "+N hidden neighbours" badge. */
    data: { id: string; label: string; display: string };
    classes: string;
    position?: { x: number; y: number };
}

export interface CyEdgeDef {
    group: 'edges';
    data: { id: string; source: string; target: string; label: string; relType: string };
    classes: string;
}

export function toCyNode<N, E>(node: GraphNode<N>, adapter: GraphTypeAdapter<N, E>,
                               position?: { x: number; y: number }): CyNodeDef {
    const label = adapter.nodeLabel(node);
    const def: CyNodeDef = {
        group: 'nodes',
        data: { id: node.id, label, display: label },
        classes: ['node', ...adapter.nodeClasses(node).map(classToken)].join(' '),
    };
    if (position) def.position = { x: position.x, y: position.y };
    return def;
}

/** The drawn label: the concept name, plus "＋N" when N neighbours are hidden. */
export function displayLabel(label: string, hidden: number): string {
    return hidden > 0 ? `${label}  ＋${hidden}` : label;
}

export function toCyEdge<N, E>(edge: GraphEdge<E>, adapter: GraphTypeAdapter<N, E>): CyEdgeDef {
    return {
        group: 'edges',
        data: { id: edge.id, source: edge.source, target: edge.target,
                label: adapter.edgeLabel(edge), relType: edge.type },
        classes: ['edge', ...adapter.edgeClasses(edge).map(classToken)].join(' '),
    };
}

/**
 * Place `count` new nodes around `anchor` without landing on existing ones:
 * candidate slots on growing rings, skipping any within `minGap` of an
 * occupied point. Existing nodes never move — this is what keeps incremental
 * expansion stable instead of re-running a force layout.
 */
export function ringPlacement(anchor: { x: number; y: number }, count: number,
                              occupied: { x: number; y: number }[],
                              opts: { radius?: number; minGap?: number; startAngle?: number } = {}): { x: number; y: number }[] {
    const radius = opts.radius ?? 130;
    const minGap = opts.minGap ?? 90;
    const taken = occupied.slice();
    const out: { x: number; y: number }[] = [];
    for (let ring = 1; out.length < count && ring <= 12; ring++) {
        const r = radius * ring;
        const slots = Math.max(6, Math.floor((2 * Math.PI * r) / minGap));
        const start = (opts.startAngle ?? -Math.PI / 2) + (ring % 2 ? 0 : Math.PI / slots);
        for (let i = 0; i < slots && out.length < count; i++) {
            const a = start + (2 * Math.PI * i) / slots;
            const p = { x: anchor.x + r * Math.cos(a), y: anchor.y + r * Math.sin(a) * 0.8 };
            if (taken.some((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < minGap * minGap)) continue;
            taken.push(p);
            out.push(p);
        }
    }
    // Pathologically crowded: stack the rest below, still never overlapping the anchor.
    while (out.length < count) out.push({ x: anchor.x, y: anchor.y + radius * (13 + out.length) });
    return out;
}
