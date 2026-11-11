// ============================================================
// knowledge-adapter.ts — the Knowledge Graph's GraphTypeAdapter: labels,
// style classes, search text and details-panel HTML for concept nodes and
// relation edges. Pure (no DOM, no Cytoscape); the markdown renderer is
// injected so the Node suite can test it without the render stack.
// ============================================================

import type { GraphEdge, GraphNode } from '/graph-explorer/graph-engine.js';
import type { GraphTypeAdapter, VisibleGraph } from '/graph-explorer/graph-type.js';
import { classToken } from '/graph-explorer/graph-type.js';
import { conceptSearchText, relationInfo, RELATION_TYPES, type ConceptData, type KnowledgeGraph,
         type RelationData } from '/graph-explorer/knowledge-model.js';

export function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Categories with a dedicated colour; anything else is drawn neutrally. */
export const CONCEPT_CATEGORIES: [string, string][] = [
    ['problem', 'Problem'],
    ['data-structure', 'Data structure'],
    ['technique', 'Technique'],
    ['invariant', 'Invariant / property'],
    ['analysis', 'Analysis'],
];

const placeLabel = (p: { scene: number; step: number; label?: string }): string =>
    `Scene ${p.scene + 1}${p.step >= 0 ? ` · Step ${p.step + 1}` : ''}${p.label ? ` — ${p.label}` : ''}`;

export function createKnowledgeAdapter(deps: { renderMarkdown: (md: string) => string }):
    GraphTypeAdapter<ConceptData, RelationData> {
    const nodeName = (kg: KnowledgeGraph, id: string): string => kg.getNode(id)?.data.label ?? id;

    const relationRow = (kg: KnowledgeGraph, e: GraphEdge<RelationData>, from: string): string => {
        const outgoing = e.source === from;
        const other = outgoing ? e.target : e.source;
        const info = relationInfo(e.type);
        const verb = outgoing ? info.verb : info.inverse;
        return `<li class="kg-rel-row">`
            + `<button type="button" class="kg-link kg-rel-verb" data-kg-edge="${escapeHtml(e.id)}" `
            + `title="Relationship details">${escapeHtml(verb)}</button> `
            + `<button type="button" class="kg-link kg-rel-node" data-kg-node="${escapeHtml(other)}" `
            + `title="Select ${escapeHtml(nodeName(kg, other))}">${escapeHtml(nodeName(kg, other))}</button>`
            + `</li>`;
    };

    return {
        type: 'knowledge',
        title: 'Knowledge Graph',
        nodeLabel: (n) => n.data.label,
        nodeClasses: (n) => [
            'concept',
            `cat-${classToken(n.data.category ?? 'other')}`,
            ...(n.data.origin === 'runtime' ? ['runtime'] : []),
        ],
        edgeLabel: (e) => relationInfo(e.type).verb,
        edgeClasses: (e) => [`kind-${relationInfo(e.type).kind}`, `rel-${classToken(e.type)}`,
                             ...(e.data.origin === 'runtime' ? ['runtime'] : [])],
        searchText: (n) => conceptSearchText(n.id, n.data),
        nodeSubtitle: (n) => {
            const cat = CONCEPT_CATEGORIES.find(([k]) => k === n.data.category)?.[1] ?? n.data.category ?? 'concept';
            const k = n.data.lessons.length;
            return `${cat} · ${k} lesson${k === 1 ? '' : 's'}`;
        },
        nodeDetailsHtml(node, kg, ctx) {
            const d = node.data;
            const cat = CONCEPT_CATEGORIES.find(([k]) => k === d.category)?.[1] ?? d.category;
            const out = kg.edgesOf(node.id, 'out');
            const inn = kg.edgesOf(node.id, 'in');
            let h = `<div class="kg-details-head">`
                + `<h3 class="kg-details-title">${escapeHtml(d.label)}</h3>`
                + (cat ? `<span class="kg-chip kg-cat-${escapeHtml(classToken(d.category ?? ''))}">${escapeHtml(cat)}</span>` : '')
                + (d.origin === 'runtime' ? `<span class="kg-chip kg-chip-runtime" title="Added while the app was running, not from a lesson file">live update</span>` : '')
                // Taught only in other lessons: say so up front, not just in the list below.
                + (ctx.currentLessonId && d.lessons.length && !d.lessons.some((l) => l.lessonId === ctx.currentLessonId)
                    ? `<span class="kg-chip kg-chip-external" title="Not taught in the open lesson">external</span>` : '')
                + `</div>`;
            h += `<div class="kg-details-actions">`
                + (ctx.isFocus ? '' : `<button type="button" class="kg-btn" data-kg-action="focus">Focus here</button>`)
                + (ctx.expanded
                    ? `<button type="button" class="kg-btn" data-kg-action="collapse" title="Or double-click the concept">Hide neighbours</button>`
                    : (ctx.hidden ?? 1) > 0
                        ? `<button type="button" class="kg-btn" data-kg-action="expand" title="Or double-click the concept">`
                          + `Show ${ctx.hidden ?? ''} hidden neighbour${ctx.hidden === 1 ? '' : 's'}`.replace('  ', ' ') + `</button>`
                        : `<span class="kg-details-note">All neighbours shown</span>`)
                + `</div>`;
            h += d.definition
                ? `<div class="kg-details-def">${deps.renderMarkdown(d.definition)}</div>`
                : `<p class="kg-details-empty">No definition authored for this concept.</p>`;
            if (out.length || inn.length) {
                h += `<h4 class="kg-details-sub">Relationships</h4>`;
                if (out.length) h += `<div class="kg-dir-label">Outgoing</div><ul class="kg-rel-list">${out.map((e) => relationRow(kg, e, node.id)).join('')}</ul>`;
                if (inn.length) h += `<div class="kg-dir-label">Incoming</div><ul class="kg-rel-list">${inn.map((e) => relationRow(kg, e, node.id)).join('')}</ul>`;
            } else {
                h += `<p class="kg-details-empty">No relationships recorded.</p>`;
            }
            h += `<h4 class="kg-details-sub">Lessons</h4>`;
            if (!d.lessons.length) h += `<p class="kg-details-empty">Not linked to a lesson.</p>`;
            else {
                // The open lesson first; every other lesson is marked EXTERNAL and
                // its buttons say they leave the current lesson.
                const cur = ctx.currentLessonId ?? null;
                const lessons = [...d.lessons].sort((a, b) => Number(b.lessonId === cur) - Number(a.lessonId === cur));
                h += `<ul class="kg-lesson-list">`;
                for (const l of lessons) {
                    const external = !!cur && l.lessonId !== cur;
                    const places = l.places.length ? l.places : [{ scene: 0, step: -1 }];
                    h += `<li class="${external ? 'kg-lesson-external' : 'kg-lesson-current'}">`
                        + `<span class="kg-lesson-title">${escapeHtml(l.lessonTitle)}</span>`
                        + (external ? ` <span class="kg-chip kg-chip-external" title="Taught in another lesson">external</span>`
                                    : cur ? ` <span class="kg-chip kg-chip-current">this lesson</span>` : '')
                        + (l.draft ? ` <span class="kg-chip kg-chip-draft">draft</span>` : '')
                        + `<div class="kg-lesson-places">`
                        + places.map((p) => `<button type="button" class="kg-btn kg-btn-nav${external ? ' kg-btn-external' : ''}" data-kg-lesson="${escapeHtml(l.lessonId)}" `
                            + `data-kg-scene="${p.scene}" data-kg-step="${p.step}" `
                            + `title="${external ? `Leaves this lesson and opens “${escapeHtml(l.lessonTitle)}”` : 'Go to this place in the lesson'}">`
                            + `${l.places.length ? escapeHtml(placeLabel(p)) : 'Open lesson'} ${external ? '⇱' : '↗'}</button>`).join('')
                        + `</div></li>`;
                }
                h += `</ul>`;
            }
            h += `<p class="kg-details-id" title="Stable concept id">${escapeHtml(node.id)}</p>`;
            return h;
        },
        edgeDetailsHtml(edge, kg, ctx) {
            const info = relationInfo(edge.type);
            const d = edge.data;
            let h = `<div class="kg-details-head"><h3 class="kg-details-title">Relationship</h3>`
                + `<span class="kg-chip">${escapeHtml(edge.type)}</span>`
                + (d.origin === 'runtime' ? `<span class="kg-chip kg-chip-runtime">live update</span>` : '')
                + `</div>`;
            h += `<p class="kg-edge-sentence">`
                + `<button type="button" class="kg-link" data-kg-node="${escapeHtml(edge.source)}">${escapeHtml(nodeName(kg, edge.source))}</button>`
                + ` <span class="kg-edge-verb">${escapeHtml(info.verb)}</span> `
                + `<button type="button" class="kg-link" data-kg-node="${escapeHtml(edge.target)}">${escapeHtml(nodeName(kg, edge.target))}</button></p>`;
            h += `<p class="kg-details-dir">Direction: ${escapeHtml(nodeName(kg, edge.source))} → ${escapeHtml(nodeName(kg, edge.target))}`
                + ` (read backwards: “${escapeHtml(nodeName(kg, edge.target))} ${escapeHtml(info.inverse)} ${escapeHtml(nodeName(kg, edge.source))}”)</p>`;
            if (d.description) h += `<div class="kg-details-def">${deps.renderMarkdown(d.description)}</div>`;
            if (d.lessons.length) {
                h += `<h4 class="kg-details-sub">Asserted by</h4><ul class="kg-lesson-list">`
                    + d.lessons.map((l) => {
                        const external = !!ctx?.currentLessonId && l !== ctx.currentLessonId;
                        return `<li>${escapeHtml(lessonTitleOf(kg, edge, l))}`
                            + (external ? ` <span class="kg-chip kg-chip-external" title="Taught in another lesson">external</span>` : '') + `</li>`;
                    }).join('') + `</ul>`;
            }
            return h;
        },
        askPrompt(node, kg, view) {
            const d = node.data;
            const rels = kg.edgesOf(node.id).map((e) => sentence(kg, e));
            let q = `Explain the concept "${d.label}".`;
            if (rels.length) q += `\nIts relationships in the knowledge graph: ${rels.slice(0, 12).join('; ')}.`;
            q += visibleContext(kg, view, node.id);
            q += `\nHow does "${d.label}" connect to the other concepts I'm looking at?`;
            return q;
        },
        askEdgePrompt(edge, kg, view) {
            const a = nodeName(kg, edge.source), b = nodeName(kg, edge.target);
            return `Explain why "${a}" ${relationInfo(edge.type).verb} "${b}".`
                + (edge.data.description ? ` (The lesson says: ${edge.data.description})` : '')
                + visibleContext(kg, view);
        },
        crossLinks: (n) => (n.data.links ?? []).map((l) => ({ graphType: l.graphType, nodeId: l.nodeId, label: l.label ?? l.nodeId })),
        legend: () => ({
            nodes: CONCEPT_CATEGORIES.map(([k, label]) => [`cat-${k}`, label]),
            edges: [
                ['kind-structural', 'structural (specializes, part of, maintains)'],
                ['kind-dependency', 'dependency (uses, solves, prerequisite of)'],
                ['kind-analysis', 'analysis (analyzed by, measured by)'],
                ['kind-association', 'association (related to)'],
            ],
        }),
    };
}

/** "A uses B" — a relation as a sentence, read source → target. */
function sentence(kg: KnowledgeGraph, e: GraphEdge<RelationData>): string {
    const name = (id: string) => kg.getNode(id)?.data.label ?? id;
    return `${name(e.source)} ${relationInfo(e.type).verb} ${name(e.target)}`;
}

const ASK_MAX_CONCEPTS = 30;
const ASK_MAX_RELATIONS = 40;

/**
 * The part of the graph on screen, for the tutor: the focus, every visible
 * concept and the visible relationships among them (bounded so a large view
 * can't flood the prompt; the cut is stated, not silent).
 */
export function visibleContext(kg: KnowledgeGraph, view: VisibleGraph, exclude?: string): string {
    const name = (id: string) => kg.getNode(id)?.data.label ?? id;
    const ids = [...view.nodes].filter((id) => id !== exclude && kg.hasNode(id));
    if (!ids.length) return '';
    // Focus first, then the rest in a stable order.
    ids.sort((x, y) => (x === view.focus ? -1 : y === view.focus ? 1 : name(x).localeCompare(name(y))));
    const shown = ids.slice(0, ASK_MAX_CONCEPTS).map((id) => (id === view.focus ? `${name(id)} (focus)` : name(id)));
    let s = `\nOther concepts visible in my knowledge graph: ${shown.join(', ')}`
        + (ids.length > ASK_MAX_CONCEPTS ? ` and ${ids.length - ASK_MAX_CONCEPTS} more` : '') + '.';
    const rels = [...view.edges].map((id) => kg.getEdge(id)).filter((e): e is GraphEdge<RelationData> => !!e);
    if (rels.length) {
        s += `\nVisible relationships: ${rels.slice(0, ASK_MAX_RELATIONS).map((e) => sentence(kg, e)).join('; ')}`
            + (rels.length > ASK_MAX_RELATIONS ? `; and ${rels.length - ASK_MAX_RELATIONS} more` : '') + '.';
    }
    return s;
}

/** The title of a lesson id, read off either endpoint's lesson refs. */
function lessonTitleOf(kg: KnowledgeGraph, edge: GraphEdge<RelationData>, lessonId: string): string {
    for (const id of [edge.source, edge.target]) {
        const ref = kg.getNode(id)?.data.lessons.find((l) => l.lessonId === lessonId);
        if (ref) return ref.lessonTitle;
    }
    return lessonId;
}

/** Relation types a legend/filter can offer: the known vocabulary. */
export const KNOWN_RELATION_TYPES = Object.keys(RELATION_TYPES);

export type { GraphNode };
