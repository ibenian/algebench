// ============================================================
// What a builder expert is allowed to see.
//
// Assembled HERE, in the client, and sent as the request — rather than shipping
// the lesson and letting the backend slice it. The lesson is the client's
// authoritative copy and can be large: the biggest published lesson is 549KB,
// while the context derived from it is 87KB. Sending the whole thing to produce
// a few summaries and a colour palette is ~6x waste on every build request.
//
// The chat tool still carries only intent and scope — the conversational AGENT
// chooses nothing about context. Selection is deterministic code; it just runs on
// the side that already holds the lesson.
//
// SENT AS NAMED DATA, NOT AS ONE `context` BAG AND NOT AS PROMPT TEXT.
// Each field below feeds exactly one `dspy.InputField`, via one formatter in
// backend/experts/handlers/build_scene/format.py, so the request keys say what
// the model will be told. The VALUES stay raw — `neighbours` is scene objects as
// they appear in the lesson, because the far side only ever renders them.
//
// Rendering deliberately stays on the backend: prompt wording changes when the
// MODEL changes, and putting it here would make every tweak a frontend deploy
// with cached browsers still sending last month's format.
// ============================================================

import type { LessonFormat, Scene } from '/types/lesson.js';

/**
 * Bounds on what the client SELECTS. The backend re-applies its own
 * ceilings while formatting (format.py) — these two sets are defence in
 * depth, not a mirror: the client's job is to send a sensible context, the
 * backend's is to survive one that isn't.
 */
export const MAX_SCENES_SUMMARISED = 40;
export const MAX_SUMMARY_CHARS = 200;
export const MAX_INTENT_CHARS = 2000;

/** One line about a scene — cheap enough to include for every one. */
export interface SceneSummary { index: number; title: string; description: string }

/**
 * House style, DERIVED by scanning rather than asked of the model.
 *
 * A model told "match the lesson's style" invents one; handed the palette
 * actually in use, it reuses it. Scanning is also the only way to be right about
 * a lesson nobody described in prose.
 */
export interface Conventions {
    colors: string[];
    labelsAreLatex: boolean;
    elementsCarryPrompts: boolean;
}

/** An agent-memory key and its SHAPE — never its value. */
export interface MemoryRef { key: string; shape: string }

/** Title, blurb, and one line per scene — the map, not the territory. */
export interface LessonOutline {
    title: string;
    description: string;
    sceneSummaries: SceneSummary[];
}

/**
 * The body of `POST /api/expert/build_scene`, mirroring `BuildSceneRequest`
 * in models.py. Names carry the structure; values are raw lesson data.
 */
export interface BuildSceneRequestBody {
    op: 'insert' | 'replace';
    sceneIndex: number;
    intent: string;
    lesson: LessonOutline;
    /** The scenes either side — enough to match tone, not the whole lesson. */
    neighbours: Scene[];
    /** The full scene, and ONLY on replace: this is what makes regenerate-with-context work. */
    current: Scene | null;
    conventions: Conventions;
    clarifications: Array<{ question: string; answer: string }>;
    memory: MemoryRef[];
    /** Slider ids already in use, so the model cannot collide and binding can be checked. */
    sliderVocabulary: string[];
    /** What bounding dropped. A silent truncation reads as "the model saw everything". */
    omitted: string[];
}

type LooseScene = Scene & { steps?: Array<Record<string, unknown>>; elements?: unknown[] };

function scenesOf(lesson: unknown): LooseScene[] {
    const l = lesson as { scenes?: unknown; title?: unknown; elements?: unknown } | null;
    if (l && Array.isArray(l.scenes)) return l.scenes.filter((s) => s && typeof s === 'object') as LooseScene[];
    // SingleSceneFormat: the lesson IS the scene.
    return l && (l.title || l.elements) ? [l as unknown as LooseScene] : [];
}

function elementsOf(scene: LooseScene): Array<Record<string, unknown>> {
    const out = ((scene.elements || []) as Array<Record<string, unknown>>).filter(Boolean);
    for (const step of scene.steps || []) {
        for (const el of ((step.add || []) as Array<Record<string, unknown>>)) if (el) out.push(el);
    }
    return out;
}

function firstLine(text: unknown, limit = MAX_SUMMARY_CHARS): string {
    if (typeof text !== 'string' || !text.trim()) return '';
    return text.trim().split('\n')[0]!.slice(0, limit);
}

export function deriveConventions(scenes: LooseScene[]): Conventions {
    const colors: string[] = [];
    let latex = 0, labelled = 0, prompts = 0;
    for (const scene of scenes) {
        for (const el of elementsOf(scene)) {
            const c = el.color;
            if (typeof c === 'string' && c.startsWith('#') && !colors.includes(c)) colors.push(c);
            const label = el.label;
            if (typeof label === 'string' && label) {
                labelled++;
                if (label.includes('$')) latex++;
            }
            if (el.prompt) prompts++;
        }
    }
    return {
        colors: colors.slice(0, 12),
        // A MAJORITY, not "any": one stray `$a$` must not make the builder wrap
        // every plain word in dollars.
        labelsAreLatex: labelled > 0 && latex * 2 > labelled,
        elementsCarryPrompts: prompts > 0,
    };
}

export function collectSliderIds(scenes: LooseScene[]): string[] {
    const ids: string[] = [];
    for (const scene of scenes) {
        for (const step of scene.steps || []) {
            for (const s of ((step.sliders || []) as Array<{ id?: unknown }>)) {
                if (typeof s?.id === 'string' && s.id && !ids.includes(s.id)) ids.push(s.id);
            }
        }
    }
    return ids;
}

/** Deterministically decide what the builder sees. No I/O, no mutation. */
export function assembleBuildSceneRequest(opts: {
    lesson: LessonFormat | Scene | null | undefined;
    intent: string;
    op: 'insert' | 'replace';
    sceneIndex?: number;
    clarifications?: Array<{ question: string; answer: string }>;
    memory?: MemoryRef[];
}): BuildSceneRequestBody {
    const scenes = scenesOf(opts.lesson);
    const omitted: string[] = [];

    let target: number;
    if (opts.op === 'replace') {
        // "Replace something" is not an instruction — refuse rather than guess.
        if (opts.sceneIndex == null || opts.sceneIndex < 0 || opts.sceneIndex >= scenes.length) {
            throw new Error(`replace needs an existing scene index, got ${opts.sceneIndex}`);
        }
        target = opts.sceneIndex;
    } else {
        target = opts.sceneIndex == null
            ? scenes.length
            : Math.max(0, Math.min(opts.sceneIndex, scenes.length));
    }

    // The wire contract requires a non-empty intent (`min_length=1`). Rejecting
    // here turns an avoidable 422 into a clear local failure — and "build
    // something" with no ask is not a request the backend could serve anyway.
    const intent = (opts.intent || '').trim().slice(0, MAX_INTENT_CHARS);
    if (!intent) throw new Error('a build needs an intent; got an empty one');

    const summarised = scenes.slice(0, MAX_SCENES_SUMMARISED);
    if (scenes.length > MAX_SCENES_SUMMARISED) {
        omitted.push(`${scenes.length - MAX_SCENES_SUMMARISED} scene summaries`);
    }

    // On REPLACE the scene at `target` is `current`, so its neighbours sit either
    // side of it. On INSERT the new scene BECOMES `target`, displacing whatever is
    // there — so its right-hand neighbour is the scene currently AT `target`, not
    // the one after it. Getting this wrong showed the builder the scene it was
    // about to be separated from and hid the one it would sit beside.
    const right = opts.op === 'replace' ? target + 1 : target;
    const around = [target - 1, right].filter((i) => i >= 0 && i < scenes.length);
    const lesson = (opts.lesson || {}) as { title?: unknown; description?: unknown };

    return {
        op: opts.op,
        sceneIndex: target,
        intent,
        clarifications: opts.clarifications || [],
        lesson: {
            title: typeof lesson.title === 'string' ? lesson.title : '',
            description: firstLine(lesson.description),
            sceneSummaries: summarised.map((s, index) => ({
                index,
                title: typeof s.title === 'string' ? s.title : '',
                description: firstLine((s as { description?: unknown }).description),
            })),
        },
        conventions: deriveConventions(scenes),
        neighbours: around.map((i) => scenes[i]!) as Scene[],
        current: opts.op === 'replace' ? (scenes[target]! as Scene) : null,
        memory: opts.memory || [],
        sliderVocabulary: collectSliderIds(scenes),
        omitted,
    };
}
