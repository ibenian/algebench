// ============================================================
// plan-request.ts — asking the learning_plan expert for a plan.
//
// The request side (where the learner is, as ids the server accepts) and the
// reply side (the four outcomes, checked before anything is built from them).
// The reply comes over the network, so it is read like an imported file: only
// known kinds, plain-token ids, bounded text. A plan is then built from the
// refs in code; nothing in the reply is used as a link.
//
// Backend twin: backend/experts/handlers/learning_plan/.
// ============================================================

import { LESSON_ID, PLAN_SCHEMA_VERSION, TOKEN, refToView, validatePlan } from '/plan-core.js';
import type { ContentKind, ContentRef, ContentStep, LearningPlan } from '/plan-core.js';
import type { ViewState } from '/view-state.js';

export const PLAN_EXPERT = 'learning_plan';
/** Window event, `detail: { target }`: plan a path to `target` (glossary.ts fires it; plan-ui.ts listens). */
export const PLAN_REQUEST_EVENT = 'algebench:plan-request';
/** A plan takes 6–15 s; past this something is wrong. */
export const PLAN_TIMEOUT_MS = 90_000;

export interface PlanWhere {
    lesson?: string;
    sc?: string;
    st?: string;
    pf?: string;
    ps?: string;
}

export interface Clarification {
    question: string;
    answer: string;
}

export interface PlanRequest {
    target: string;
    where: PlanWhere;
    known?: string[];
    clarifications?: Clarification[];
}

export interface PlannedStep {
    kind: ContentKind;
    title: string;
    why: string;
    ref: ContentRef;
}

export type PlanReply =
    | { kind: 'result'; title: string; steps: PlannedStep[]; caveat: string }
    | { kind: 'question'; question: string }
    | { kind: 'reason'; reason: string }
    | { kind: 'chat' };

const MAX_TARGET = 500;
const MAX_TEXT = 600;
const MAX_STEPS = 8;
const KINDS: ReadonlySet<string> = new Set<ContentKind>(['scene', 'step', 'proof', 'proofStep', 'glossary']);

/** Where the learner is, keeping only ids the server's request model accepts. */
export function whereFromView(vs: ViewState | null | undefined): PlanWhere {
    const w: PlanWhere = {};
    if (!vs || typeof vs.builtin !== 'string' || !LESSON_ID.test(vs.builtin)) return w;
    w.lesson = vs.builtin;
    for (const k of ['sc', 'st', 'pf', 'ps'] as const) {
        const v = vs[k];
        if (typeof v === 'string' && TOKEN.test(v)) w[k] = v;
    }
    return w;
}

export function planRequest(target: string, vs: ViewState | null | undefined,
                            clarifications: Clarification[] = []): PlanRequest {
    const body: PlanRequest = { target: target.trim().slice(0, MAX_TARGET), where: whereFromView(vs) };
    if (clarifications.length) {
        body.clarifications = clarifications.map((c) => ({
            question: c.question.slice(0, 500), answer: c.answer.slice(0, 500),
        }));
    }
    return body;
}

const text = (v: unknown, max = MAX_TEXT): string =>
    typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

function readRef(raw: unknown, kind: ContentKind): ContentRef | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.lesson !== 'string' || !LESSON_ID.test(r.lesson)) return null;
    const ref: ContentRef = { lesson: r.lesson };
    for (const k of ['sc', 'st', 'pf', 'ps'] as const) {
        const v = r[k];
        if (v === undefined) continue;
        if (typeof v !== 'string' || !TOKEN.test(v)) return null;
        ref[k] = v;
    }
    if (kind === 'glossary') {
        const g = text(r.glossary, 200);
        if (!g) return null;
        ref.glossary = g;
    }
    // Each kind needs the ids that locate it, or the step can't be reached.
    const needs: Record<ContentKind, (keyof ContentRef)[]> = {
        scene: ['sc'], step: ['sc', 'st'], proof: ['pf'], proofStep: ['pf', 'ps'], glossary: ['glossary'],
    };
    return needs[kind].every((k) => ref[k]) ? ref : null;
}

/** The expert's reply, checked. Anything malformed reads as "no plan". */
export function readPlanReply(raw: unknown): PlanReply {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (r.result && typeof r.result === 'object') {
        const res = r.result as Record<string, unknown>;
        const steps: PlannedStep[] = [];
        for (const s of Array.isArray(res.steps) ? res.steps : []) {
            if (!s || typeof s !== 'object') continue;
            const o = s as Record<string, unknown>;
            if (typeof o.kind !== 'string' || !KINDS.has(o.kind)) continue;
            const kind = o.kind as ContentKind;
            const ref = readRef(o.ref, kind);
            const title = text(o.title, 200);
            if (!ref || !title) continue;
            steps.push({ kind, title, why: text(o.why), ref });
            if (steps.length === MAX_STEPS) break;
        }
        if (steps.length) return { kind: 'result', title: text(res.title, 200), steps, caveat: text(r.caveat) };
        return { kind: 'reason', reason: 'The plan that came back had no steps that could be used.' };
    }
    if (typeof r.question === 'string' && text(r.question)) return { kind: 'question', question: text(r.question) };
    if (r.fallback_to_chat === true) return { kind: 'chat' };
    return { kind: 'reason', reason: text(r.reason) || 'No plan came back.' };
}

/** A new plan from the expert's steps. Throws if the result isn't a valid plan. */
export function planFromReply(reply: Extract<PlanReply, { kind: 'result' }>, target: string,
                              origin: ViewState, at: number, newId: () => string): LearningPlan {
    const steps: ContentStep[] = reply.steps.map((s) => ({
        id: newId(), kind: s.kind, title: s.title, why: s.why, state: 'todo', source: 'ai',
        ref: s.ref, view: refToView(s.ref),
    }));
    const plan: LearningPlan = {
        schemaVersion: PLAN_SCHEMA_VERSION, id: newId(), title: reply.title || target,
        target: { text: target, origin }, steps, status: 'active', createdAt: at, updatedAt: at,
    };
    const errs = validatePlan(plan);
    if (errs.length) throw new Error(errs[0]);
    return plan;
}
