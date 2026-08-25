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
// This is a WIRE SHAPE, mirrored by backend/experts/handlers/build_scene/context.py
// and pinned by scripts/validate_model_parity.py.
// ============================================================

import type { LessonFormat, Scene } from '/types/lesson.js';

/** Bounds. A 40-scene lesson must not become a 100KB prompt. */
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

export interface BuilderContext {
    op: 'insert' | 'replace';
    sceneIndex: number;
    intent: string;
    clarifications: Array<{ question: string; answer: string }>;
    lessonTitle: string;
    lessonDescription: string;
    conventions: Conventions;
    sceneSummaries: SceneSummary[];
    /** The scenes either side — enough to match tone, not the whole lesson. */
    neighbours: Scene[];
    /** The full scene, and ONLY on replace: this is what makes regenerate-with-context work. */
    current: Scene | null;
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
export function assembleBuilderContext(opts: {
    lesson: LessonFormat | Scene | null | undefined;
    intent: string;
    op: 'insert' | 'replace';
    sceneIndex?: number;
    clarifications?: Array<{ question: string; answer: string }>;
    memory?: MemoryRef[];
}): BuilderContext {
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

    const summarised = scenes.slice(0, MAX_SCENES_SUMMARISED);
    if (scenes.length > MAX_SCENES_SUMMARISED) {
        omitted.push(`${scenes.length - MAX_SCENES_SUMMARISED} scene summaries`);
    }

    const around = [target - 1, target + 1].filter((i) => i >= 0 && i < scenes.length);
    const lesson = (opts.lesson || {}) as { title?: unknown; description?: unknown };

    return {
        op: opts.op,
        sceneIndex: target,
        intent: (opts.intent || '').trim().slice(0, MAX_INTENT_CHARS),
        clarifications: opts.clarifications || [],
        lessonTitle: typeof lesson.title === 'string' ? lesson.title : '',
        lessonDescription: firstLine(lesson.description),
        conventions: deriveConventions(scenes),
        sceneSummaries: summarised.map((s, index) => ({
            index,
            title: typeof s.title === 'string' ? s.title : '',
            description: firstLine((s as { description?: unknown }).description),
        })),
        neighbours: around.map((i) => scenes[i]!) as Scene[],
        current: opts.op === 'replace' ? (scenes[target]! as Scene) : null,
        memory: opts.memory || [],
        sliderVocabulary: collectSliderIds(scenes),
        omitted,
    };
}
