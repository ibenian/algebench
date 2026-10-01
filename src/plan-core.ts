// ============================================================
// plan-core.ts — Pure model + navigator for Learning Plans.
//
// A learning plan is a PROGRESS KEEPER over existing lesson content: an
// ordered list of steps, each pointing at a scene / step / proof / proof step
// / glossary term by stable id, or holding a sub-plan. It knows how far the
// learner has got, where the learner is right now — possibly several
// sub-plans deep — and how to get back to where each level was entered.
//
// "Where the learner is" is a stack of frames (`nav.frames`), outermost plan
// first. Each frame walks one plan and remembers `cameFrom`: the view the
// learner left to enter it. Return pops a frame and lands on its `cameFrom`
// without completing anything.
//
// A sub-plan is either NESTED (lives inside its step, stored in the parent's
// record) or REFERENCED (`planId` of another saved plan, whose progress is
// shared by every plan that links it).
//
// This module is intentionally PURE: no DOM, no storage, no app state — the
// navigator functions take the plan being walked plus a lookup for referenced
// plans and return edited COPIES and the view to go to. Unit-tested under
// `node --test` (plan-core.test.ts). Design: docs/proposals/learning-plan-proposal.md
// ============================================================

import type { ViewState } from '/view-state.js';

export const PLAN_SCHEMA_VERSION = 1;
/** Frames deeper than this are refused, to keep the breadcrumb readable. */
export const MAX_PLAN_DEPTH = 4;

export type StepState = 'todo' | 'visited' | 'done' | 'skipped';
export type ContentKind = 'scene' | 'step' | 'proof' | 'proofStep' | 'glossary';

export interface ContentRef {
    lesson: string;          // builtin id
    sc?: string;
    st?: string;
    pf?: string;
    ps?: string;
    glossary?: string;       // key, resolved in the lesson + its domain glossaries
}

interface StepBase {
    id: string;
    title: string;
    why: string;
    state: StepState;
    source: 'ai' | 'learner';
}

export interface ContentStep extends StepBase {
    kind: ContentKind;
    ref: ContentRef;
    view: ViewState;
    /** Where the learner last was while on this step; resuming lands here. */
    lastView?: ViewState;
}

export interface SubplanStep extends StepBase {
    kind: 'subplan';
    sub: { nested: LearningPlan } | { planId: string };
}

export type PlanStep = ContentStep | SubplanStep;

export interface NavFrame {
    planId: string;
    stepId: string;
    /** The view the learner left to enter this frame; Return lands here. */
    cameFrom: ViewState;
}

export interface LearningPlan {
    schemaVersion: number;
    id: string;
    title: string;
    target: { text: string; origin: ViewState };
    steps: PlanStep[];
    status: 'active' | 'complete';
    nav?: { frames: NavFrame[] };
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
}

/** Finds a saved (top-level) plan by id — how referenced sub-plans resolve. */
export type PlanLookup = (id: string) => LearningPlan | undefined;

/**
 * What a navigator action produced: the edited plans to save (copies — the
 * inputs are never mutated), and the view to go to, if any.
 */
export interface NavResult {
    changed: LearningPlan[];
    go: ViewState | null;
    /** Set when the action was refused; `changed` is then empty. */
    error?: string;
    /** Forward on the outermost plan's last step: offer "mark plan complete". */
    finished?: boolean;
}

// ----- Refs and views -----

/**
 * The deep link for a content ref. A proof opens the proof panel, which lives
 * inside the Chat tab — so it also selects that tab, or the jump would land on
 * Doc with the proof panel open but out of sight.
 */
export function refToView(ref: ContentRef): ViewState {
    const vs: ViewState = { builtin: ref.lesson };
    if (ref.sc) vs.sc = ref.sc;
    if (ref.st) vs.st = ref.st;
    if (ref.pf) {
        vs.pf = ref.pf;
        vs.pp = true;
        vs.panel = 'chat';
        if (ref.ps) vs.ps = ref.ps;
    }
    return vs;
}

/**
 * True when `view` is at the ref's location: same lesson, and every id the
 * ref names matches. A ref without `st` is satisfied by any step of its scene,
 * and a glossary ref by anywhere in its lesson.
 */
export function viewMatchesRef(view: ViewState | null | undefined, ref: ContentRef): boolean {
    if (!view || view.builtin !== ref.lesson) return false;
    for (const k of ['sc', 'st', 'pf', 'ps'] as const) {
        if (ref[k] && view[k] !== ref[k]) return false;
    }
    return true;
}

/**
 * Deep-link fields that DO something rather than say where the learner is:
 * the fire-once boot directives (send a chat message, run an analysis, load a
 * proof animation) and a custom scene file path. The app never serializes
 * them, so a plan made here never has them — but an imported one could, and
 * opening a shared plan must not launch AI work.
 */
export const VIEW_DIRECTIVES = ['aa', 'fax', 'pa', 'pas', 'scene'] as const;

/** Ids and enum-ish values that end up in selectors and lookups: a plain token. */
const TOKEN = /^[A-Za-z0-9_.:-]{1,200}$/;
/** Longest camera-view key kept — the same bound parseViewState applies to `cv`. */
const CV_MAX_LEN = 64;
/** A built-in lesson id: plain-token path segments, e.g. "eigenvalues" or
 *  "draft/chart-demo" — no empty, dot-leading or traversal segments. */
const LESSON_ID = /^(?=.{1,200}$)[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/;
/** A name safe to use as a plain-object key: not one Object.prototype answers
 *  to (`__proto__`, `constructor`, …) — applyViewState looks sliders up by it. */
const safeKey = (k: string): boolean => TOKEN.test(k) && !(k in Object.prototype);

/**
 * `view` reduced to a location the app can apply safely: only the known,
 * non-directive fields, each of the right type — ids as plain tokens,
 * numbers finite, the camera three finite triples. `cv` is the exception: a
 * camera-view key is a scene-authored name (`side-(yz)`, `ride:-chased-ship`)
 * that the app matches exactly, never as selector syntax (findCamButton), so
 * any string is kept, bounded like parseViewState bounds it. Everything the navigator hands out goes through this, so
 * a stored or imported view can't carry a directive or a malformed value
 * into applyViewState.
 */
export function navigableView(view: ViewState): ViewState {
    const src = (isObject(view) ? view : {}) as Record<string, unknown>;
    const v: ViewState = {};
    if (typeof src.builtin === 'string' && LESSON_ID.test(src.builtin)) v.builtin = src.builtin;
    for (const k of ['view', 'panel', 'sc', 'st', 'pf', 'ps', 'proj', 'fa'] as const) {
        const val = src[k];
        if (typeof val === 'string' && TOKEN.test(val)) v[k] = val;
    }
    if (typeof src.cv === 'string' && src.cv.length > 0 && src.cv.length <= CV_MAX_LEN) v.cv = src.cv;
    if (typeof src.pp === 'boolean') v.pp = src.pp;
    if (typeof src.dock === 'boolean') v.dock = src.dock;
    // An orthographic scale is a half-height: zero or negative collapses or flips the view.
    if (Number.isFinite(src.oz) && (src.oz as number) > 0) v.oz = src.oz as number;
    if (Array.isArray(src.nodes)) {
        const nodes = src.nodes.filter((n): n is string => typeof n === 'string' && TOKEN.test(n));
        if (nodes.length) v.nodes = nodes;
    }
    if (isObject(src.sliders)) {
        const sl = Object.entries(src.sliders as Record<string, unknown>)
            .filter(([id, n]) => safeKey(id) && Number.isFinite(n));
        if (sl.length) v.sliders = Object.fromEntries(sl) as Record<string, number>;
    }
    const cam = src.cam as Record<string, unknown> | undefined;
    // By index, not every(): every() skips the holes of a sparse array.
    const triple = (t: unknown): t is [number, number, number] =>
        Array.isArray(t) && t.length === 3 && [0, 1, 2].every((i) => Number.isFinite(t[i]));
    if (isObject(cam) && triple(cam!.position) && triple(cam!.target)) {
        const copy = (t: [number, number, number]): [number, number, number] => [t[0], t[1], t[2]];
        v.cam = { position: copy(cam!.position), target: copy(cam!.target) };
        if (triple(cam!.up)) v.cam.up = copy(cam!.up);
    }
    return v;
}

/**
 * Whether the view shows its proof. Views carry the selected proof (`pf`/`ps`)
 * whether or not anyone is reading it — a scene keeps one selected, and some
 * open the proof panel behind the Doc tab — so the proof is on screen only on
 * the Math page (the step's equation as a graph), or when the proof panel is
 * open AND the Chat tab that holds it is showing.
 */
export function proofOnScreen(view: ViewState): boolean {
    return view.view === 'math' || (!!view.pp && view.panel === 'chat');
}

/** `view` is at `ref`, and if `ref` is a proof, the proof is actually on screen. */
function showsRef(view: ViewState, ref: ContentRef): boolean {
    return viewMatchesRef(view, ref) && (!ref.pf || proofOnScreen(view));
}

/**
 * Whether `view` shows the plan's current step — the on-screen match alone,
 * nothing recorded or moved (after a reload, say). A sub-plan or glossary
 * step has no location of its own, so it counts as shown.
 */
export function viewShowsCurrentStep(plan: LearningPlan, lookup: PlanLookup, view: ViewState): boolean {
    const s = new Session(plan, lookup);
    if (!s.frames.length) return false;
    const chain = s.tryChain();
    if (!chain) return false;
    const step = stepById(chain[chain.length - 1]!, s.frames[s.frames.length - 1]!.stepId);
    if (!step) return false;
    if (step.kind === 'subplan' || step.kind === 'glossary') return true;
    return showsRef(view, step.ref);
}

/** Where resuming a content step lands: where the learner left it, else its start. */
export function resumeView(step: PlanStep): ViewState | null {
    if (step.kind === 'subplan') return null;
    const v = navigableView(step.lastView ?? step.view);
    // A proof step's promise is its proof on screen: outside the Math page that
    // means the proof panel open in the Chat tab, whatever the stored view says
    // (an imported one may omit `pp` or say `panel: 'doc'`). Other steps keep
    // their view exactly as recorded.
    if ((step.kind === 'proof' || step.kind === 'proofStep') && v.view !== 'math') { v.pp = true; v.panel = 'chat'; }
    return v;
}

// ----- Walking the frame stack -----

function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * A working copy of the plan being walked plus any referenced plans the
 * action touches, so an action edits copies and reports exactly what changed.
 */
class Session {
    root: LearningPlan;
    private refs = new Map<string, LearningPlan>();
    private dirty = new Set<string>();
    private lookup: PlanLookup;

    constructor(root: LearningPlan, lookup: PlanLookup) {
        this.root = clone(root);
        this.lookup = lookup;
    }

    get frames(): NavFrame[] {
        return this.root.nav?.frames ?? [];
    }

    /** The top-level record a plan lives in (itself when referenced/root). */
    private recordOf: Map<string, string> = new Map();

    /** A referenced plan's working copy, loaded on first use. */
    ref(id: string): LearningPlan | undefined {
        if (id === this.root.id) return this.root;
        let p = this.refs.get(id);
        if (!p) {
            const found = this.lookup(id);
            if (!found) return undefined;
            p = clone(found);
            this.refs.set(id, p);
        }
        return p;
    }

    /**
     * The plan a sub-plan step of `parent` holds: the nested object (saved as
     * part of whatever record holds `parent`), or the referenced copy.
     */
    subOf(step: SubplanStep, parent: LearningPlan): LearningPlan | undefined {
        if ('nested' in step.sub) {
            this.recordOf.set(step.sub.nested.id, this.recordOf.get(parent.id) ?? parent.id);
            return step.sub.nested;
        }
        const p = this.ref(step.sub.planId);
        if (p) this.recordOf.set(p.id, p.id);
        return p;
    }

    /**
     * The plans the frames walk, resolved down the chain: frame 0 is the
     * root; frame k is the sub-plan held by frame k-1's current step.
     */
    chain(): LearningPlan[] {
        const out: LearningPlan[] = [];
        this.recordOf.set(this.root.id, this.root.id);
        let plan: LearningPlan | undefined = this.root;
        this.frames.forEach((f, i) => {
            if (i > 0) {
                const parent = out[i - 1];
                const holder = parent && stepById(parent, this.frames[i - 1]!.stepId);
                plan = holder && holder.kind === 'subplan' ? this.subOf(holder, parent!) : undefined;
            }
            if (!plan || plan.id !== f.planId || !stepById(plan, f.stepId)) {
                throw new Error(`plan frame ${i} does not resolve`);
            }
            out.push(plan);
        });
        return out;
    }

    /**
     * `chain()`, or null when the saved position no longer resolves — a step
     * removed, a linked plan changed or deleted, a corrupt import. Navigator
     * actions refuse in that case instead of throwing.
     */
    tryChain(): LearningPlan[] | null {
        try { return this.chain(); } catch { return null; }
    }

    /** Record that `plan` (or the top-level record holding it) changed. Every
     *  navigator action also moves the frame stack, which lives on the root —
     *  so the root is stamped too, keeping the store's recent-first order. */
    touch(plan: LearningPlan, now: number): void {
        plan.updatedAt = now;
        this.root.updatedAt = now;
        const record = this.recordOf.get(plan.id) ?? plan.id;
        this.dirty.add(record);
        if (record !== plan.id) {
            const top = record === this.root.id ? this.root : this.refs.get(record);
            if (top) top.updatedAt = now;
        }
    }

    result(go: ViewState | null, extra: Partial<NavResult> = {}): NavResult {
        this.dirty.add(this.root.id);   // nav lives on the root
        const changed = [...this.dirty].map((id) => (id === this.root.id ? this.root : this.refs.get(id)!))
            .filter(Boolean);
        return { changed, go: go && navigableView(go), ...extra };
    }
}

export function stepById(plan: LearningPlan, id: string): PlanStep | undefined {
    return plan.steps.find((s) => s.id === id);
}

function stepIndex(plan: LearningPlan, id: string): number {
    return plan.steps.findIndex((s) => s.id === id);
}

function firstUnfinished(plan: LearningPlan): PlanStep | undefined {
    return plan.steps.find((s) => s.state === 'todo' || s.state === 'visited') ?? plan.steps[0];
}

/** The refusal for a saved position that no longer resolves. */
const STALE = 'this plan\'s saved position no longer matches its steps — start it again';

function refused(error: string): NavResult {
    return { changed: [], go: null, error };
}

function markVisited(step: PlanStep): void {
    if (step.state === 'todo') step.state = 'visited';
}

// ----- Navigator actions -----

/**
 * Start (or resume) walking `plan`. A plan already being walked resumes where
 * the learner is; otherwise it starts at its first unfinished step, and Return
 * from the outermost frame will land on `from` (default: the plan's origin).
 */
export function startPlan(plan: LearningPlan, lookup: PlanLookup, now: number, from?: ViewState): NavResult {
    const s = new Session(plan, lookup);
    if (s.frames.length) {
        const chain = s.tryChain();
        if (chain) {
            const top = chain[chain.length - 1]!;
            const step = stepById(top, s.frames[s.frames.length - 1]!.stepId);
            return { changed: [], go: step ? resumeView(step) : null };   // resuming changes nothing
        }
        // The saved position no longer resolves: drop it and start afresh.
        delete s.root.nav;
    }
    const first = firstUnfinished(s.root);
    if (!first) return refused('this plan has no steps');
    s.root.nav = { frames: [{ planId: s.root.id, stepId: first.id, cameFrom: from ?? s.root.target.origin }] };
    if (s.root.status === 'complete') { s.root.status = 'active'; delete s.root.completedAt; }
    markVisited(first);
    s.touch(s.root, now);
    return s.result(resumeView(first));
}

/** Forward ›: finish the current step and move to the next one. */
export function forward(plan: LearningPlan, lookup: PlanLookup, now: number): NavResult {
    const s = new Session(plan, lookup);
    if (!s.frames.length) return refused('this plan is not being walked');
    const chain = s.tryChain();
    if (!chain) return refused(STALE);
    const depth = chain.length - 1;
    const cur = chain[depth]!;
    const frame = s.frames[depth]!;
    const i = stepIndex(cur, frame.stepId);
    const step = cur.steps[i];
    if (step && step.state !== 'skipped') step.state = 'done';
    s.touch(cur, now);

    const next = cur.steps[i + 1];
    if (next) {
        frame.stepId = next.id;
        markVisited(next);
        return s.result(resumeView(next));
    }
    if (depth === 0) return s.result(null, { finished: true });

    // Last step of a sub-plan: it is complete; back to where it was entered,
    // with the parent parked on its sub-plan step, now done.
    cur.status = 'complete';
    cur.completedAt = now;
    delete cur.nav;   // complete means not being walked (as markComplete)
    s.frames.pop();
    const parent = chain[depth - 1]!;
    const holder = stepById(parent, s.frames[depth - 1]!.stepId);
    if (holder && holder.state !== 'skipped') holder.state = 'done';   // as Forward: a skip stays a skip
    s.touch(parent, now);
    return s.result(frame.cameFrom);
}

/** ‹ Back: the previous step of the current plan. Changes no step state. */
export function back(plan: LearningPlan, lookup: PlanLookup, now: number): NavResult {
    const s = new Session(plan, lookup);
    if (!s.frames.length) return refused('this plan is not being walked');
    const chain = s.tryChain();
    if (!chain) return refused(STALE);
    const cur = chain[chain.length - 1]!;
    const frame = s.frames[s.frames.length - 1]!;
    const i = stepIndex(cur, frame.stepId);
    if (i <= 0) return refused('already at the first step');
    const prev = cur.steps[i - 1]!;
    frame.stepId = prev.id;
    s.touch(s.root, now);
    return s.result(resumeView(prev));
}

/** Jump to a step of the current plan (a click in the step list). */
export function jumpTo(plan: LearningPlan, lookup: PlanLookup, stepId: string, now: number): NavResult {
    const s = new Session(plan, lookup);
    if (!s.frames.length) return refused('this plan is not being walked');
    const chain = s.tryChain();
    if (!chain) return refused(STALE);
    const cur = chain[chain.length - 1]!;
    const step = stepById(cur, stepId);
    if (!step) return refused(`no step ${stepId} in "${cur.title}"`);
    s.frames[s.frames.length - 1]!.stepId = stepId;
    markVisited(step);
    s.touch(cur, now);
    return s.result(resumeView(step));
}

/**
 * Enter ↘: go into the current step's sub-plan. `from` is where the learner
 * is now; Return from the sub-plan lands back there.
 */
export function enter(plan: LearningPlan, lookup: PlanLookup, from: ViewState, now: number): NavResult {
    const s = new Session(plan, lookup);
    if (!s.frames.length) return refused('this plan is not being walked');
    const chain = s.tryChain();
    if (!chain) return refused(STALE);
    const cur = chain[chain.length - 1]!;
    const step = stepById(cur, s.frames[s.frames.length - 1]!.stepId);
    if (!step || step.kind !== 'subplan') return refused('the current step is not a sub-plan');
    if (s.frames.length >= MAX_PLAN_DEPTH) return refused(`sub-plans can nest at most ${MAX_PLAN_DEPTH} deep`);
    const sub = s.subOf(step, cur);
    if (!sub) return refused('the linked plan was deleted');
    if (chain.some((p) => p.id === sub.id)) return refused(`"${sub.title}" is already open further up`);
    const first = firstUnfinished(sub);
    if (!first) return refused(`"${sub.title}" has no steps`);
    s.frames.push({ planId: sub.id, stepId: first.id, cameFrom: from });
    markVisited(step);
    markVisited(first);
    if (sub.status === 'complete') { sub.status = 'active'; delete sub.completedAt; }
    s.touch(cur, now);
    s.touch(sub, now);
    return s.result(resumeView(first));
}

/**
 * Return ⤴: leave the current plan without completing anything, back to
 * where it was entered. From the outermost plan, the walk ends (the plan
 * stays active and resumable) and the learner lands where they started it.
 */
export function returnUp(plan: LearningPlan, lookup: PlanLookup, now: number): NavResult {
    const s = new Session(plan, lookup);
    if (!s.frames.length) return refused('this plan is not being walked');
    const frame = s.frames.pop()!;
    if (!s.frames.length) delete s.root.nav;
    s.touch(s.root, now);
    return s.result(frame.cameFrom);
}

/** How precisely a ref pins a location: the number of ids it names. */
function refSpecificity(ref: ContentRef): number {
    return (['sc', 'st', 'pf', 'ps'] as const).filter((k) => ref[k]).length;
}

/**
 * The learner is now at `view` — however they got there: the plan, the scene
 * tree, the proof panel, the Math view. The plan follows:
 *
 * - On the current content step: it counts as visited and remembers the view
 *   as its resume point.
 * - On another content step of the plan being walked, or of a plan further
 *   out on the frame stack: the plan moves there (leaving any sub-plans above
 *   that level the way Return does — nothing is completed) and marks it
 *   visited. The innermost level with a match wins; within it, the most
 *   specific ref (a proof step over its scene), then the nearest step after
 *   the current one.
 * - Anywhere else (wandering off): nothing changes.
 *
 * Glossary steps never match — their ref names only a lesson, so they would
 * claim every view in it. A sub-plan the learner hasn't entered isn't entered
 * for them. `onStep` says whether the view is on (now) the current step;
 * `moved` whether the plan's position changed to follow the learner.
 */
export function recordView(plan: LearningPlan, lookup: PlanLookup, view: ViewState, now: number): NavResult & { onStep: boolean; moved: boolean } {
    const s = new Session(plan, lookup);
    const none = { changed: [], go: null, onStep: false, moved: false };
    if (!s.frames.length) return none;
    const chain = s.tryChain();
    if (!chain) return none;   // saved position no longer resolves
    const depth = chain.length - 1;
    const cur = chain[depth]!;
    const hereId = s.frames[depth]!.stepId;

    for (let d = depth; d >= 0; d--) {
        const p = chain[d]!;
        const at = stepIndex(p, s.frames[d]!.stepId);
        let best: { step: ContentStep; score: number; dist: number } | null = null;
        p.steps.forEach((step, i) => {
            if (step.kind === 'subplan' || step.kind === 'glossary' || !showsRef(view, step.ref)) return;
            const score = refSpecificity(step.ref);
            // The current step first among equals (-1), then steps after it
            // (1, 2 …), then those before it. It is ranked with the rest, so a
            // broad current step (a scene) yields to a more specific one (a
            // step or proof of that scene) the learner has moved to.
            const dist = i === at ? -1 : i > at ? i - at : p.steps.length + (at - i);
            if (!best || score > best.score || (score === best.score && dist < best.dist)) best = { step, score, dist };
        });
        if (!best) continue;
        const { step } = best as { step: ContentStep };
        if (d === depth && step.id === hereId) {
            // Still on the current step: it counts as visited and remembers the view.
            markVisited(step);
            step.lastView = clone(view);
            s.touch(p, now);
            return { ...s.result(null), onStep: true, moved: false };
        }
        s.frames.length = d + 1;   // leave the sub-plans above this level, completing nothing
        s.frames[d]!.stepId = step.id;
        markVisited(step);
        step.lastView = clone(view);
        s.touch(p, now);
        return { ...s.result(null), onStep: true, moved: true };
    }
    return none;
}

// ----- Progress, breadcrumb, lifecycle -----

export interface Progress {
    /** Weighted: a sub-plan step contributes its sub-plan's fraction. */
    done: number;
    total: number;
    fraction: number;
}

/**
 * How far through `plan` the learner is. A content step counts 1 once done or
 * skipped; a sub-plan step counts its sub-plan's fraction (a referenced plan
 * contributes its own, shared progress; a missing one counts 0) — even when
 * the step itself is marked done, since a linked plan reopened or edited
 * since has less to show. A skipped sub-plan counts 1. A complete plan is 100%.
 */
export function progress(plan: LearningPlan, lookup: PlanLookup, seen: Set<string> = new Set()): Progress {
    const total = plan.steps.length;
    if (plan.status === 'complete') return { done: total, total, fraction: 1 };
    if (!total) return { done: 0, total: 0, fraction: 0 };
    seen.add(plan.id);
    let done = 0;
    for (const step of plan.steps) {
        if (step.state === 'skipped') { done += 1; continue; }
        if (step.kind !== 'subplan') { if (step.state === 'done') done += 1; continue; }
        const sub = 'nested' in step.sub ? step.sub.nested : lookup(step.sub.planId);
        if (!sub) continue;                                   // deleted: counts 0
        // A cycle, or a sub-plan with nothing in it: the step's own mark.
        if (seen.has(sub.id) || !sub.steps.length) { if (step.state === 'done') done += 1; continue; }
        done += progress(sub, lookup, new Set(seen)).fraction;
    }
    return { done, total, fraction: done / total };
}

export interface Crumb {
    planId: string;
    title: string;
    stepId: string;
    stepTitle: string;
    /** 1-based position of the current step. */
    stepNumber: number;
    stepCount: number;
}

/** "Understand terminal velocity › Newton's second law › step 1 of 2". */
export function breadcrumb(plan: LearningPlan, lookup: PlanLookup): Crumb[] {
    const s = new Session(plan, lookup);
    if (!s.frames.length) return [];
    const chain = s.tryChain();
    if (!chain) return [];
    return chain.map((p, i) => {
        const stepId = s.frames[i]!.stepId;
        const idx = stepIndex(p, stepId);
        return {
            planId: p.id, title: p.title, stepId,
            stepTitle: p.steps[idx]?.title ?? '',
            stepNumber: idx + 1, stepCount: p.steps.length,
        };
    });
}

/** The step the learner is on (innermost frame), or null when not walking. */
export function currentStep(plan: LearningPlan, lookup: PlanLookup): PlanStep | null {
    const s = new Session(plan, lookup);
    if (!s.frames.length) return null;
    const chain = s.tryChain();
    if (!chain) return null;
    return stepById(chain[chain.length - 1]!, s.frames[s.frames.length - 1]!.stepId) ?? null;
}

/**
 * `plan` with its walk stepped out of `deletedId`, or null if it isn't inside
 * it. Deleting a linked plan the learner is walking inside would leave the
 * frame stack pointing at nothing; instead the stack is cut back to the frame
 * that holds the link, so the parent rests on its (now dangling) sub-plan step
 * — where the UI offers Remove or Import. Nothing is completed.
 */
export function leaveDeletedPlan(plan: LearningPlan, deletedId: string, now: number): LearningPlan | null {
    const frames = plan.nav?.frames ?? [];
    const i = frames.findIndex((f) => f.planId === deletedId);
    if (i <= 0) return null;   // not inside it (or it is this plan, deleted itself)
    const p = clone(plan);
    p.nav!.frames = p.nav!.frames.slice(0, i);
    p.updatedAt = now;
    return p;
}

/** Mark the plan complete. Step states stay as history; the walk ends. */
export function markComplete(plan: LearningPlan, now: number): LearningPlan {
    const p = clone(plan);
    p.status = 'complete';
    p.completedAt = now;
    delete p.nav;
    p.updatedAt = now;
    return p;
}

/**
 * Restart: the plan's progress back to the beginning — every step not
 * started, resume points forgotten, nested sub-plans reset too, the walk
 * ended. Linked plans are left alone: they're separate plans, and their
 * progress is shared with whatever else links them.
 */
export function restartPlan(plan: LearningPlan, now: number): LearningPlan {
    const reset = (p: LearningPlan): void => {
        p.status = 'active';
        delete p.completedAt;
        delete p.nav;
        p.updatedAt = now;
        for (const s of p.steps) {
            s.state = 'todo';
            if (s.kind === 'subplan') { if ('nested' in s.sub) reset(s.sub.nested); }
            else delete s.lastView;
        }
    };
    const p = clone(plan);
    reset(p);
    return p;
}

/** Reopen a complete plan. */
export function reopen(plan: LearningPlan, now: number): LearningPlan {
    const p = clone(plan);
    p.status = 'active';
    delete p.completedAt;
    p.updatedAt = now;
    return p;
}

/** Saved plans with a step that links to `planId` (shown "plan deleted" after a delete). */
export function plansReferencing(plans: LearningPlan[], planId: string): LearningPlan[] {
    const links = (p: LearningPlan): boolean => p.steps.some((s) =>
        s.kind === 'subplan' && ('nested' in s.sub ? links(s.sub.nested) : s.sub.planId === planId));
    return plans.filter((p) => p.id !== planId && links(p));
}

// ----- Validation (imports and loads) -----

const CONTENT_KINDS = new Set<string>(['scene', 'step', 'proof', 'proofStep', 'glossary']);
/** The ref ids each kind needs to land where it promises. */
const KIND_IDS: Record<string, ReadonlyArray<keyof ContentRef>> = {
    scene: ['sc'], step: ['sc', 'st'], proof: ['pf'], proofStep: ['pf', 'ps'], glossary: ['glossary'],
};
const STATES = new Set<string>(['todo', 'visited', 'done', 'skipped']);

/** Structural problems with a plan (e.g. an imported file); empty when valid. */
/** How deep nested plans may go before validation stops descending. Far more
 *  than the navigator can walk (MAX_PLAN_DEPTH); it only bounds the recursion
 *  so a deep import or a cyclic IndexedDB record is reported, not a stack overflow. */
const MAX_NESTING = 32;

export function validatePlan(plan: unknown, path = 'plan', planIds: Set<string> = new Set(),
                             ancestors: Set<object> = new Set()): string[] {
    const errs: string[] = [];
    const p = plan as Partial<LearningPlan> | null;
    if (!p || typeof p !== 'object') return [`${path}: not an object`];
    const outermost = ancestors.size === 0;
    // Structured clone keeps cycles, so a stored record can contain itself.
    if (ancestors.has(p)) return [`${path}: a plan that contains itself`];
    if (ancestors.size >= MAX_NESTING) return [`${path}: nested more than ${MAX_NESTING} deep`];
    ancestors = new Set(ancestors).add(p);
    // The navigator tells plans apart by id (cycles, frames): one id per plan in the tree.
    if (typeof p.id === 'string' && p.id) {
        if (planIds.has(p.id)) errs.push(`${path}: plan id "${p.id}" is used twice in this plan`);
        planIds.add(p.id);
    }
    if (p.schemaVersion !== PLAN_SCHEMA_VERSION) errs.push(`${path}: unsupported schemaVersion ${String(p.schemaVersion)}`);
    if (typeof p.id !== 'string' || !p.id) errs.push(`${path}: missing id`);
    if (typeof p.title !== 'string') errs.push(`${path}: missing title`);
    if (!p.target || typeof p.target.text !== 'string' || !isObject(p.target.origin)) errs.push(`${path}: missing target`);
    if (p.status !== 'active' && p.status !== 'complete') errs.push(`${path}: bad status`);
    // The store lists most recently updated first; a missing time breaks that order.
    if (!Number.isFinite(p.createdAt) || !Number.isFinite(p.updatedAt)) errs.push(`${path}: createdAt and updatedAt must be numbers`);
    if (p.completedAt !== undefined && !Number.isFinite(p.completedAt)) errs.push(`${path}: bad completedAt`);
    if (!Array.isArray(p.steps)) return [...errs, `${path}: steps is not a list`];
    const ids = new Set<string>();
    // Array.from: forEach skips a sparse array's holes; a hole must be reported.
    Array.from(p.steps).forEach((step, i) => {
        const at = `${path}.steps[${i}]`;
        if (!step || typeof step.id !== 'string' || !step.id) { errs.push(`${at}: missing id`); return; }
        if (ids.has(step.id)) errs.push(`${at}: duplicate id "${step.id}"`);
        ids.add(step.id);
        if (!STATES.has(step.state)) errs.push(`${at}: bad state`);
        if (typeof step.title !== 'string' || typeof step.why !== 'string') errs.push(`${at}: needs a title and a why`);
        if (step.source !== 'ai' && step.source !== 'learner') errs.push(`${at}: bad source`);
        if (step.kind === 'subplan') {
            const sub = (step as SubplanStep).sub as unknown;
            // Exactly one of the two: every consumer checks `nested` first and would ignore the link.
            if (isObject(sub) && 'nested' in (sub as object) && 'planId' in (sub as object)) errs.push(`${at}: sub-plan has both a nested plan and a planId`);
            else if (isObject(sub) && 'nested' in (sub as object)) errs.push(...validatePlan((sub as { nested: unknown }).nested, `${at}.sub.nested`, planIds, ancestors));
            else if (!isObject(sub) || !nonEmpty((sub as { planId?: unknown }).planId)) errs.push(`${at}: sub-plan has neither nested plan nor planId`);
        } else if (CONTENT_KINDS.has(step.kind)) {
            const ref = (step as ContentStep).ref;
            const refOk = isObject(ref) && typeof ref.lesson === 'string' && LESSON_ID.test(ref.lesson);
            if (!refOk) errs.push(`${at}: missing ref.lesson`);
            else {
                const missing = KIND_IDS[step.kind]!.filter((k) => typeof ref[k] !== 'string' || !ref[k]);
                if (missing.length) errs.push(`${at}: a ${step.kind} ref needs ${missing.join(' and ')}`);
                // Location ids must survive navigableView, or the step would
                // validate but open somewhere else (a glossary key is text, not a location).
                const bad = (['sc', 'st', 'pf', 'ps'] as const)
                    .filter((k) => ref[k] !== undefined && (typeof ref[k] !== 'string' || !TOKEN.test(ref[k]!)));
                if (bad.length) errs.push(`${at}: ref ${bad.join(', ')} not a plain id`);
            }
            // The ref is the source of truth; a stored view must land on it
            // (resumeView opens lastView before view).
            const view = (step as ContentStep).view;
            if (!isObject(view)) errs.push(`${at}: missing view`);
            else if (refOk && !viewMatchesRef(view, ref)) errs.push(`${at}: view is not at its ref`);
            const last = (step as ContentStep).lastView;
            if (last !== undefined && !isObject(last)) errs.push(`${at}: bad lastView`);
            else if (last !== undefined && refOk && !viewMatchesRef(last, ref)) errs.push(`${at}: lastView is not at its ref`);
        } else {
            errs.push(`${at}: unknown kind "${String((step as { kind?: unknown }).kind)}"`);
        }
    });
    // Where the learner is. Only the outermost frame can be checked here —
    // deeper ones name nested or linked plans; the navigator refuses a
    // position that doesn't resolve (see Session.tryChain).
    if (p.nav !== undefined && p.status === 'complete') errs.push(`${path}: a complete plan is not being walked, but has a saved position`);
    if (p.nav !== undefined) {
        const frames = isObject(p.nav) ? (p.nav as { frames?: unknown }).frames : undefined;
        if (!Array.isArray(frames) || !frames.length) errs.push(`${path}.nav: frames is not a non-empty list`);
        else if (frames.length > MAX_PLAN_DEPTH) errs.push(`${path}.nav: deeper than ${MAX_PLAN_DEPTH} frames`);
        else {
            Array.from(frames).forEach((f, i) => {
                const fr = f as Partial<NavFrame> | null;
                if (!isObject(fr) || !nonEmpty(fr!.planId) || !nonEmpty(fr!.stepId) || !isObject(fr!.cameFrom)) {
                    errs.push(`${path}.nav.frames[${i}]: needs planId, stepId and a cameFrom view`);
                }
            });
            // The navigator never enters a plan it is already in (no cycles).
            const seen = new Set<string>();
            Array.from(frames).forEach((f, i) => {
                const id = isObject(f) ? (f as Partial<NavFrame>).planId : undefined;
                if (typeof id !== 'string') return;
                if (seen.has(id)) errs.push(`${path}.nav.frames[${i}]: plan "${id}" is already on the stack`);
                seen.add(id);
            });
            const f0 = frames[0] as Partial<NavFrame>;
            if (isObject(f0) && (f0.planId !== p.id || !ids.has(String(f0.stepId)))) {
                errs.push(`${path}.nav.frames[0]: must be this plan, on one of its steps`);
            }
        }
    }
    // Plans are JSON documents: the navigator clones them through JSON and
    // export writes them as JSON. A cycle anywhere else (a view that points
    // back at itself, from a structured-clone record) would pass every check
    // above and throw on first use, so a plan must also serialize.
    if (outermost && !errs.length) {
        try { JSON.stringify(p); } catch { errs.push(`${path}: not a JSON document (it contains a cycle)`); }
    }
    return errs;
}

function nonEmpty(v: unknown): boolean {
    return typeof v === 'string' && v.length > 0;
}

function isObject(v: unknown): boolean {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

// ----- Export / import -----

export const PLAN_FILE_FORMAT = 'algebench-learning-plans';

export interface PlanFile {
    format: typeof PLAN_FILE_FORMAT;
    version: 1;
    exportedAt: number;
    plans: LearningPlan[];
}

/**
 * A file holding `plans` plus every plan they reference, transitively, so an
 * import on another browser keeps the links working. Walks are dropped: where
 * the learner was is not portable.
 */
export function exportPlans(plans: LearningPlan[], lookup: PlanLookup, now: number): PlanFile {
    const out = new Map<string, LearningPlan>();
    const visit = (p: LearningPlan): void => {
        for (const s of p.steps) {
            if (s.kind !== 'subplan') continue;
            if ('nested' in s.sub) { visit(s.sub.nested); continue; }
            const ref = lookup(s.sub.planId);
            if (ref && !out.has(ref.id)) add(ref);
        }
    };
    // Where the learner was is not portable — nested plans included.
    const dropWalk = (p: LearningPlan): void => {
        delete p.nav;
        for (const s of p.steps) if (s.kind === 'subplan' && 'nested' in s.sub) dropWalk(s.sub.nested);
    };
    const add = (p: LearningPlan): void => {
        const c = clone(p);
        dropWalk(c);
        out.set(c.id, c);
        visit(c);
    };
    for (const p of plans) if (!out.has(p.id)) add(p);
    return { format: PLAN_FILE_FORMAT, version: 1, exportedAt: now, plans: [...out.values()] };
}

/** Every stored view in `plan` (nested plans included) reduced to `navigableView`. */
function withNavigableViews(plan: LearningPlan): LearningPlan {
    const p = clone(plan);
    const walk = (q: LearningPlan): void => {
        q.target.origin = navigableView(q.target.origin);
        for (const f of q.nav?.frames ?? []) f.cameFrom = navigableView(f.cameFrom);
        for (const st of q.steps) {
            if (st.kind === 'subplan') { if ('nested' in st.sub) walk(st.sub.nested); continue; }
            st.view = navigableView(st.view);
            if (st.lastView) st.lastView = navigableView(st.lastView);
        }
    };
    walk(p);
    return p;
}

/** Every plan id in `plan`'s tree: its own and its nested plans'. */
export function planTreeIds(plan: LearningPlan): Set<string> {
    const ids = new Set<string>();
    const walk = (p: LearningPlan): void => {
        ids.add(p.id);
        for (const s of p.steps) if (s.kind === 'subplan' && 'nested' in s.sub) walk(s.sub.nested);
    };
    walk(plan);
    return ids;
}

/**
 * Which parsed plans can join the stored ones. A plan replaces the stored
 * record with its id; otherwise every id in its tree must be new to the
 * stored forest (minus the records being replaced) — plan ids are identity to
 * the navigator, and Export all must stay a file parsePlanFile accepts.
 */
export function mergeImport(stored: LearningPlan[], incoming: LearningPlan[]): { plans: LearningPlan[]; errors: string[] } {
    const replaced = new Set(incoming.map((p) => p.id));
    const taken = new Set<string>();
    for (const p of stored) if (!replaced.has(p.id)) for (const id of planTreeIds(p)) taken.add(id);
    const plans: LearningPlan[] = [];
    const errors: string[] = [];
    // Updates to stored records first: a new plan mustn't claim an id that a
    // record being re-imported (its own newer copy) still uses.
    const storedById = new Map(stored.map((p) => [p.id, p]));
    const ordered = [...incoming.filter((p) => storedById.has(p.id)), ...incoming.filter((p) => !storedById.has(p.id))];
    for (const p of ordered) {
        const ids = planTreeIds(p);
        const clash = [...ids].filter((id) => taken.has(id));
        if (clash.length) {
            errors.push(`plan id "${clash[0]}" in “${p.title}” is already used by another saved plan`);
            // A rejected replacement leaves the stored record as it was: its
            // ids stay taken, so nothing later in the file can claim them.
            const kept = storedById.get(p.id);
            if (kept) for (const id of planTreeIds(kept)) taken.add(id);
            continue;
        }
        for (const id of ids) taken.add(id);
        plans.push(p);
    }
    return { plans, errors };
}

/** Parse an exported file: the plans that are valid, and why the others are not. */
export function parsePlanFile(text: string): { plans: LearningPlan[]; errors: string[] } {
    let data: unknown;
    try { data = JSON.parse(text); } catch { return { plans: [], errors: ['not a JSON file'] }; }
    const file = data as Partial<PlanFile> | null;
    if (!file || file.format !== PLAN_FILE_FORMAT || !Array.isArray(file.plans)) {
        return { plans: [], errors: ['not an AlgeBench learning-plans file'] };
    }
    if (file.version !== 1) return { plans: [], errors: [`unsupported file version ${String(file.version)}`] };
    const plans: LearningPlan[] = [];
    const errors: string[] = [];
    // Every plan id in the file — records and the plans nested in them — is
    // identity to the navigator (frames, the cycle guard) and a repeated
    // record id would overwrite the first in the store: one of each.
    const ids = new Set<string>();
    file.plans.forEach((p, i) => {
        const treeIds = new Set<string>();
        const errs = validatePlan(p, `plans[${i}]`, treeIds);
        if (!errs.length) {
            if (ids.has(p.id)) errs.push(`plans[${i}]: duplicate id "${p.id}"`);
            else {
                const clash = [...treeIds].filter((id) => ids.has(id));
                if (clash.length) errs.push(`plans[${i}]: nested plan id ${clash.map((c) => `"${c}"`).join(', ')} already used in this file`);
            }
        }
        if (errs.length) errors.push(...errs);
        else {
            // Sanitizing must leave a plan the store accepts; if not, report it here.
            const clean = withNavigableViews(p);
            const after = validatePlan(clean, `plans[${i}]`);
            if (after.length) { errors.push(...after); return; }
            for (const id of treeIds) ids.add(id);
            plans.push(clean);
        }
    });
    return { plans, errors };
}
