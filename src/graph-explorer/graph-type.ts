// ============================================================
// graph-type.ts — the seam between the reusable explorer and one KIND of
// graph. The explorer, view model and Cytoscape view are generic; everything
// that knows what a node *means* lives behind this interface.
//
// Only the knowledge-graph adapter exists today (knowledge-adapter.ts). A
// future expression / code / lesson-structure graph supplies its own adapter
// and its own engine payload types — they are NOT forced into one shared
// semantic schema. Cross-graph navigation goes through `crossLinks`.
// ============================================================

import type { GraphEdge, GraphEngine, GraphNode } from '/graph-explorer/graph-engine.js';

/** Actions a details panel can ask the explorer (and its host) to perform. */
export interface DetailsActions {
    /** Lesson navigation is only ever triggered by an explicit button. */
    openLesson?: (lessonId: string, scene: number, step: number) => void;
    /** Future: drill into another graph type at a node. */
    openCrossLink?: (graphType: string, nodeId: string) => void;
}

/** What the explorer currently shows — read when Ask AI is clicked. */
export interface VisibleGraph {
    focus: string | null;
    nodes: ReadonlySet<string>;
    edges: ReadonlySet<string>;
}

/** One reference out of this graph into another graph type. */
export interface CrossLink { graphType: string; nodeId: string; label: string }

export interface GraphTypeAdapter<N, E> {
    /** Stable type key: "knowledge" (future: "expression", "code", "lesson"). */
    readonly type: string;
    /** Human name for tabs / headings: "Knowledge Graph". */
    readonly title: string;
    nodeLabel(node: GraphNode<N>): string;
    /** Extra CSS-ish classes for styling (lowercase kebab tokens). */
    nodeClasses(node: GraphNode<N>): string[];
    edgeLabel(edge: GraphEdge<E>): string;
    edgeClasses(edge: GraphEdge<E>): string[];
    searchText(node: GraphNode<N>): string;
    /** Short secondary line for search results ("data structure · 2 lessons"). */
    nodeSubtitle(node: GraphNode<N>): string;
    /** Details-panel HTML. Interactive bits carry data-kg-* attributes the explorer wires. */
    nodeDetailsHtml(node: GraphNode<N>, engine: GraphEngine<N, E>, ctx: { expanded: boolean; isFocus: boolean; hidden?: number }): string;
    edgeDetailsHtml(edge: GraphEdge<E>, engine: GraphEngine<N, E>): string;
    crossLinks?(node: GraphNode<N>): CrossLink[];
    /** The question an "Ask AI" button sends about a node / edge, with the
     *  graph context: its own relationships plus what is on screen right now. */
    askPrompt?(node: GraphNode<N>, engine: GraphEngine<N, E>, view: VisibleGraph): string;
    askEdgePrompt?(edge: GraphEdge<E>, engine: GraphEngine<N, E>, view: VisibleGraph): string;
    /** Legend rows: [class, label]. */
    legend(): { nodes: [string, string][]; edges: [string, string][] };
}

/** A class token Cytoscape (and CSS) can take: lowercase, kebab, bounded. */
export function classToken(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
}
