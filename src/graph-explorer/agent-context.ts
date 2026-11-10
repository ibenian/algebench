// ============================================================
// agent-context.ts — what the AI tutor is told about the Knowledge Graph:
// a compact, bounded snapshot of the view the learner last looked at (focus,
// selection, visible concepts and relations, scope, recent foci). Pure — no
// DOM — so it is unit-tested in Node. knowledge-app.ts keeps the latest
// snapshot and src/chat.ts sends it as `runtime.knowledgeGraph`, where
// backend/agent_tools.py renders it into the system prompt.
//
// The snapshot outlives the explorer: closing the graph marks it `open:false`
// but keeps it, so the tutor still knows what the learner was exploring.
// ============================================================

import type { GraphViewModel } from '/graph-explorer/view-model.js';
import { relationInfo, type ConceptData, type KnowledgeGraph, type RelationData } from '/graph-explorer/knowledge-model.js';

export interface KGContextConcept {
    id: string;
    label: string;
    category?: string;
    /** Short definition (only for the focus / selection, to keep the prompt small). */
    definition?: string;
    role?: 'focus' | 'selected';
    expanded?: boolean;
    lessons?: string[];
}

export interface KnowledgeGraphContext {
    /** True while the explorer is on screen; false = last view before it closed. */
    open: boolean;
    /** Which explorer: "global" (status bar) or "lesson:<id>" (Doc tab). */
    context: string;
    presentation: string;
    scope: string;
    focus: KGContextConcept | null;
    selected: KGContextConcept | { kind: 'relation'; sentence: string; description?: string } | null;
    /** Visible concepts (focus first, then expanded, then the rest), bounded. */
    visibleConcepts: KGContextConcept[];
    /** Visible relations as "A uses B" sentences, bounded. */
    visibleRelations: string[];
    conceptsOmitted: number;
    relationsOmitted: number;
    /** Earlier foci, most recent first (labels). */
    recentFoci: string[];
    /** Concepts in the whole store vs. lessons covered (for "what exists beyond the view"). */
    totalConcepts: number;
    /** ISO time of the snapshot. */
    at: string;
}

export const CONTEXT_MAX_CONCEPTS = 40;
export const CONTEXT_MAX_RELATIONS = 60;
const DEF_MAX = 300;

const clip = (s: string | undefined, n: number): string | undefined =>
    s === undefined ? undefined : (s.length > n ? s.slice(0, n - 1) + '…' : s);

function concept(kg: KnowledgeGraph, id: string, extra: Partial<KGContextConcept> = {}): KGContextConcept | null {
    const n = kg.getNode(id);
    if (!n) return null;
    const c: KGContextConcept = { id, label: n.data.label, ...extra };
    if (n.data.category) c.category = n.data.category;
    if (n.data.lessons.length) c.lessons = n.data.lessons.map((l) => l.lessonTitle);
    return c;
}

/** One relation as a sentence, read source → target. */
export function relationSentence(kg: KnowledgeGraph, id: string): string | null {
    const e = kg.getEdge(id);
    if (!e) return null;
    const name = (n: string) => kg.getNode(n)?.data.label ?? n;
    return `${name(e.source)} ${relationInfo(e.type).verb} ${name(e.target)}`;
}

export function snapshotKnowledgeView(vm: GraphViewModel<ConceptData, RelationData>, open: boolean,
                                      now: Date = new Date()): KnowledgeGraphContext {
    const kg = vm.engine;
    const def = (id: string) => clip(kg.getNode(id)?.data.definition, DEF_MAX);
    const focus = vm.focus ? concept(kg, vm.focus, { role: 'focus', definition: def(vm.focus) }) : null;

    let selected: KnowledgeGraphContext['selected'] = null;
    const sel = vm.selection;
    if (sel?.kind === 'node' && sel.id !== vm.focus) {
        selected = concept(kg, sel.id, { role: 'selected', definition: def(sel.id) });
    } else if (sel?.kind === 'edge') {
        const sentence = relationSentence(kg, sel.id);
        if (sentence) {
            const d = kg.getEdge(sel.id)?.data.description;
            selected = { kind: 'relation', sentence, ...(d ? { description: clip(d, DEF_MAX) } : {}) };
        }
    }

    // Focus first, then expanded neighbourhoods, then the rest by label.
    const rank = (id: string) => (id === vm.focus ? 0 : vm.isExpanded(id) ? 1 : 2);
    const label = (id: string) => kg.getNode(id)?.data.label ?? id;
    const ids = [...vm.visibleNodes].sort((a, b) => rank(a) - rank(b) || label(a).localeCompare(label(b)));
    const visibleConcepts: KGContextConcept[] = [];
    for (const id of ids.slice(0, CONTEXT_MAX_CONCEPTS)) {
        const extra: Partial<KGContextConcept> = {};
        if (id === vm.focus) extra.role = 'focus';
        else if (sel?.kind === 'node' && sel.id === id) extra.role = 'selected';
        if (vm.isExpanded(id)) extra.expanded = true;
        const c = concept(kg, id, extra);
        if (c) { delete c.lessons; visibleConcepts.push(c); }
    }
    const rels = [...vm.visibleEdges].map((id) => relationSentence(kg, id)).filter((s): s is string => !!s).sort();

    return {
        open,
        context: vm.contextId,
        presentation: vm.presentation,
        scope: vm.scopeId,
        focus,
        selected,
        visibleConcepts,
        visibleRelations: rels.slice(0, CONTEXT_MAX_RELATIONS),
        conceptsOmitted: Math.max(0, ids.length - CONTEXT_MAX_CONCEPTS),
        relationsOmitted: Math.max(0, rels.length - CONTEXT_MAX_RELATIONS),
        recentFoci: vm.recentFoci(5).map(label),
        totalConcepts: kg.nodeCount,
        at: now.toISOString(),
    };
}
