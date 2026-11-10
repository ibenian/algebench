// ============================================================
// knowledge-model.ts — the KNOWLEDGE GRAPH's own data model on top of the
// generic GraphEngine: concept nodes, typed relations, lesson references, and
// the validation + merge of a lesson's optional `knowledgeGraph` block.
// Import-free apart from the engine, so the Node suite loads it directly.
//
// Rules this file enforces (see docs/knowledge-graph-explorer.md):
//  - identity is the explicit concept `id` only. Two lessons that use the same
//    id describe the same concept and are merged; similar labels, glossary
//    aliases or shared glossary keys never merge anything.
//  - relations come only from authored data. Nothing is inferred.
//  - a malformed entry costs that entry (reported as an issue), never the lesson.
// ============================================================

import { GraphEngine, isValidId } from '/graph-explorer/graph-engine.js';

/** Where a concept is taught: one lesson, optionally specific scenes/steps. */
export interface LessonRef {
    lessonId: string;
    lessonTitle: string;
    draft: boolean;
    /** Scene / step positions (0-based, step -1 = the scene's base view). */
    places: { scene: number; step: number; label?: string }[];
}

/** A link from this node into ANOTHER graph type (future: expression graphs). */
export interface CrossGraphRef {
    graphType: string;
    nodeId: string;
    label?: string;
}

export interface ConceptData {
    label: string;
    category?: string;
    /** Markdown definition: the concept's own, else its linked glossary entry. */
    definition?: string;
    /** Explicit glossary key this concept is defined by (never inferred). */
    glossaryKey?: string;
    lessons: LessonRef[];
    links?: CrossGraphRef[];
    /** Set on nodes added at runtime (not from lesson files) — shown as such. */
    origin?: 'lesson' | 'runtime';
}

export interface RelationData {
    description?: string;
    /** Lesson ids that assert this relation. */
    lessons: string[];
    origin?: 'lesson' | 'runtime';
}

export type KnowledgeGraph = GraphEngine<ConceptData, RelationData>;

export function createKnowledgeGraph(): KnowledgeGraph {
    return new GraphEngine<ConceptData, RelationData>();
}

/**
 * The relation vocabulary. A relation reads "source <verb> target". Each type
 * names its inverse reading so the details panel can phrase incoming edges.
 * Unknown types are accepted (the vocabulary is open) and drawn neutrally.
 */
export interface RelationTypeInfo { verb: string; inverse: string; kind: 'structural' | 'dependency' | 'analysis' | 'association' }
export const RELATION_TYPES: Record<string, RelationTypeInfo> = {
    'prerequisite-of': { verb: 'is a prerequisite of', inverse: 'requires', kind: 'dependency' },
    'specializes':     { verb: 'specializes', inverse: 'is generalized by', kind: 'structural' },
    'part-of':         { verb: 'is part of', inverse: 'has part', kind: 'structural' },
    'uses':            { verb: 'uses', inverse: 'is used by', kind: 'dependency' },
    'maintains':       { verb: 'maintains', inverse: 'is maintained by', kind: 'structural' },
    'solves':          { verb: 'solves', inverse: 'is solved by', kind: 'dependency' },
    'analyzed-by':     { verb: 'is analyzed by', inverse: 'analyzes', kind: 'analysis' },
    'measured-by':     { verb: 'is measured by', inverse: 'measures', kind: 'analysis' },
    'related-to':      { verb: 'is related to', inverse: 'is related to', kind: 'association' },
};

export function relationInfo(type: string): RelationTypeInfo {
    return RELATION_TYPES[type] ?? { verb: type.replace(/-/g, ' '), inverse: `(${type.replace(/-/g, ' ')}) from`, kind: 'association' };
}

const RELATION_TYPE_RE = /^[a-z][a-z0-9-]{0,47}$/;

/** The stable id of a relation, derived from its endpoints and type. */
export function relationId(source: string, type: string, target: string): string {
    return `${source}|${type}|${target}`;
}

// ---------- lesson-block parsing ----------

/** The authored shape (schemas/lesson.schema.json `knowledgeGraph`). */
export interface RawKnowledgeGraph {
    focus?: unknown;
    concepts?: unknown;
    relations?: unknown;
}

export interface ParsedConcept { id: string; data: ConceptData }
export interface ParsedRelation { id: string; source: string; target: string; type: string; data: RelationData }
export interface ParsedLessonGraph {
    focus?: string;
    concepts: ParsedConcept[];
    relations: ParsedRelation[];
    issues: string[];
}

export interface LessonInfo {
    lessonId: string;
    lessonTitle: string;
    draft?: boolean;
    /** The lesson's glossary, for concepts that name a `glossary` key. */
    glossary?: Record<string, { term?: string; markdown?: string } | undefined>;
}

const str = (v: unknown, max = 4000): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function parsePlaces(raw: unknown, issues: string[], where: string): LessonRef['places'] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) { issues.push(`${where}: "refs" must be an array`); return []; }
    const out: LessonRef['places'] = [];
    for (const r of raw) {
        if (!isObj(r) || !Number.isInteger(r.scene) || (r.scene as number) < 0) {
            issues.push(`${where}: ref needs a non-negative integer "scene"`); continue;
        }
        const step = r.step === undefined ? -1 : r.step;
        if (!Number.isInteger(step) || (step as number) < -1) { issues.push(`${where}: bad ref "step"`); continue; }
        const label = str(r.label, 200);
        out.push({ scene: r.scene as number, step: step as number, ...(label ? { label } : {}) });
    }
    return out;
}

function parseConcepts(raw: unknown, lesson: LessonInfo, issues: string[], seen: Set<string>): ParsedConcept[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) { issues.push('"concepts" must be an array'); return []; }
    const out: ParsedConcept[] = [];
    for (const c of raw) {
        if (!isObj(c)) { issues.push('concept entry is not an object'); continue; }
        const id = c.id;
        if (!isValidId(id)) { issues.push(`concept with invalid id ${JSON.stringify(id)}`); continue; }
        if (seen.has(id)) { issues.push(`duplicate concept id "${id}" in one lesson (first kept)`); continue; }
        const label = str(c.label, 200);
        if (!label) { issues.push(`concept "${id}": missing label`); continue; }
        seen.add(id);
        const glossaryKey = str(c.glossary, 200);
        let definition = str(c.definition);
        if (!definition && glossaryKey) {
            const entry = lesson.glossary?.[glossaryKey];
            if (entry && typeof entry.markdown === 'string') definition = entry.markdown;
            else issues.push(`concept "${id}": glossary key "${glossaryKey}" not found`);
        }
        const category = str(c.category, 80);
        const data: ConceptData = {
            label,
            lessons: [{ lessonId: lesson.lessonId, lessonTitle: lesson.lessonTitle, draft: !!lesson.draft,
                        places: parsePlaces(c.refs, issues, `concept "${id}"`) }],
            origin: 'lesson',
        };
        if (category) data.category = category;
        if (definition) data.definition = definition;
        if (glossaryKey) data.glossaryKey = glossaryKey;
        out.push({ id, data });
    }
    return out;
}

function parseRelations(raw: unknown, lesson: LessonInfo, known: (id: string) => boolean, issues: string[]): ParsedRelation[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) { issues.push('"relations" must be an array'); return []; }
    const out: ParsedRelation[] = [];
    const seen = new Set<string>();
    for (const r of raw) {
        if (!isObj(r)) { issues.push('relation entry is not an object'); continue; }
        const { source, target, type } = r;
        if (!isValidId(source) || !isValidId(target)) { issues.push('relation needs string "source" and "target" ids'); continue; }
        if (typeof type !== 'string' || !RELATION_TYPE_RE.test(type)) {
            issues.push(`relation ${source} → ${target}: "type" must be a lowercase-kebab relation type`); continue;
        }
        if (source === target) { issues.push(`relation ${source} → ${target}: a concept cannot relate to itself`); continue; }
        if (!known(source) || !known(target)) {
            issues.push(`relation ${source} -${type}-> ${target}: unknown concept id (relations never create concepts)`); continue;
        }
        const id = relationId(source, type, target);
        if (seen.has(id)) { issues.push(`duplicate relation ${id}`); continue; }
        seen.add(id);
        const description = str(r.description, 1000);
        out.push({ id, source, target, type,
                   data: { lessons: [lesson.lessonId], origin: 'lesson', ...(description ? { description } : {}) } });
    }
    return out;
}

/**
 * Validate a lesson's `knowledgeGraph` block. Never throws; anything malformed
 * is dropped and described in `issues`. `known` lets relations point at
 * concepts defined by OTHER lessons already in the store.
 */
export function parseLessonKnowledgeGraph(raw: unknown, lesson: LessonInfo,
                                          known: (id: string) => boolean = () => false): ParsedLessonGraph {
    const issues: string[] = [];
    if (raw === undefined || raw === null) return { concepts: [], relations: [], issues };
    if (!isObj(raw)) return { concepts: [], relations: [], issues: ['"knowledgeGraph" must be an object'] };
    const seen = new Set<string>();
    const concepts = parseConcepts(raw.concepts, lesson, issues, seen);
    const has = (id: string) => seen.has(id) || known(id);
    const relations = parseRelations(raw.relations, lesson, has, issues);
    const result: ParsedLessonGraph = { concepts, relations, issues };
    const focus = raw.focus;
    if (focus !== undefined) {
        if (isValidId(focus) && has(focus)) result.focus = focus;
        else issues.push(`focus "${String(focus)}" is not a known concept`);
    }
    return result;
}

// ---------- runtime updates ----------

/** The authored shape a runtime update uses — the same as a lesson block's
 *  concepts/relations, so one validator guards both doors. */
export interface RuntimeUpdate { concepts?: unknown; relations?: unknown }

/**
 * Validate and merge a runtime update (a tutor/Expert proposal, a personal
 * graph, a dev check) into the store in ONE batch, so every view gets one
 * incremental patch. Same validation as lesson content: malformed entries are
 * dropped with an issue, relations may only join concepts that exist (already
 * in the store or in this update), nothing is inferred. Runtime records carry
 * no lesson reference and are tagged `origin: "runtime"`.
 *
 * An existing concept id is merged, not replaced (lesson-authored label and
 * definition win; a runtime update can fill what is missing).
 */
export function applyRuntimeUpdate(kg: KnowledgeGraph, update: RuntimeUpdate): MergeResult & { parseIssues: string[] } {
    const p = parseLessonKnowledgeGraph(update, { lessonId: 'runtime', lessonTitle: 'Runtime update' },
                                        (id) => kg.hasNode(id));
    for (const c of p.concepts) { c.data.lessons = []; c.data.origin = 'runtime'; }
    for (const r of p.relations) { r.data.lessons = []; r.data.origin = 'runtime'; }
    const res = mergeIntoGraph(kg, p);
    return { ...res, parseIssues: p.issues };
}

// ---------- merging into the store ----------

function mergeLessonRefs(a: LessonRef[], b: LessonRef[]): LessonRef[] {
    const out = a.slice();
    for (const ref of b) {
        const i = out.findIndex((r) => r.lessonId === ref.lessonId);
        if (i < 0) { out.push(ref); continue; }
        const cur = out[i]!;
        const places = cur.places.slice();
        for (const p of ref.places) {
            if (!places.some((q) => q.scene === p.scene && q.step === p.step)) places.push(p);
        }
        out[i] = { ...cur, places };
    }
    return out;
}

/** Combine two records of the SAME concept id. The first definition and label win. */
export function mergeConcept(existing: ConceptData, incoming: ConceptData): ConceptData {
    const lessons = mergeLessonRefs(existing.lessons, incoming.lessons);
    const changed = lessons.length !== existing.lessons.length
        || lessons.some((l, i) => l.places.length !== existing.lessons[i]!.places.length)
        || (!existing.definition && !!incoming.definition)
        || (!existing.category && !!incoming.category);
    if (!changed) return existing;
    return {
        ...existing,
        lessons,
        definition: existing.definition ?? incoming.definition,
        category: existing.category ?? incoming.category,
        glossaryKey: existing.glossaryKey ?? incoming.glossaryKey,
    };
}

export function mergeRelation(existing: RelationData, incoming: RelationData): RelationData {
    const add = incoming.lessons.filter((l) => !existing.lessons.includes(l));
    if (!add.length && (existing.description || !incoming.description)) return existing;
    return { ...existing, lessons: [...existing.lessons, ...add], description: existing.description ?? incoming.description };
}

export interface MergeResult { conceptsAdded: number; conceptsMerged: number; relationsAdded: number; issues: string[] }

/**
 * Merge parsed concepts/relations into the store in ONE engine batch (one
 * patch to subscribers). A concept already present (same id) is merged; a
 * label disagreement between lessons is reported, not silently overwritten.
 */
export function mergeIntoGraph(kg: KnowledgeGraph, parsed: { concepts: ParsedConcept[]; relations: ParsedRelation[] }): MergeResult {
    const res: MergeResult = { conceptsAdded: 0, conceptsMerged: 0, relationsAdded: 0, issues: [] };
    kg.batch(() => {
        for (const c of parsed.concepts) {
            const cur = kg.getNode(c.id);
            if (cur && cur.data.label !== c.data.label) {
                res.issues.push(`concept "${c.id}" is labelled "${cur.data.label}" elsewhere; keeping that label`);
            }
            const r = kg.upsertNode(c.id, c.data, mergeConcept);
            if (r === 'added') res.conceptsAdded++; else res.conceptsMerged++;
        }
        for (const r of parsed.relations) {
            if (!kg.hasNode(r.source) || !kg.hasNode(r.target)) {
                res.issues.push(`relation ${r.id}: endpoint missing`); continue;
            }
            if (kg.upsertEdge(r, mergeRelation) === 'added') res.relationsAdded++;
        }
    });
    return res;
}

/** Text a search matches against: label, id, category. */
export function conceptSearchText(id: string, c: ConceptData): string {
    return `${c.label} ${id} ${c.category ?? ''}`.toLowerCase();
}
