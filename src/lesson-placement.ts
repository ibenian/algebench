// ============================================================
// Applying build ops to the lesson model.
//
// The authoritative lesson lives in the browser (`state.lessonSpec`); the
// backend is stateless. This module is the ONLY place that mutates it in
// response to a builder, and it is pure with respect to rendering — callers
// re-render afterwards by dispatching on the op's `kind`.
//
// Capture-then-mutate: every apply records what it displaces and returns the
// INVERSE ops, so undo needs no diffing and no lesson snapshot.
// ============================================================

import type { LessonFormat, Scene, Step, Proof } from '/types/lesson.js';
import type { BuildOp, Placement } from '/placement.js';

/** Thrown when an op cannot be applied. Callers discard and clear history. */
export class PlacementError extends Error {}

/**
 * The lesson as it exists DURING a build.
 *
 * The schema requires `minItems: 1` on `scenes`, so the generated `LessonFormat`
 * types it as `[Scene, ...Scene[]]`. That constraint is about PERSISTED data: a
 * freshly bootstrapped wrapper legitimately holds zero scenes for the moment
 * between creating it and inserting the first one. Validation on commit/export
 * is what enforces the schema; this type just declines to lie about the
 * intermediate state.
 */
export type MutableLesson = Omit<LessonFormat, 'scenes'> & { scenes: Scene[] };

/** The lesson shapes this module accepts before normalization. */
type MaybeLesson = MutableLesson | LessonFormat | (Scene & { scenes?: undefined }) | null | undefined;

/** What `ensureLessonFormat` displaced, so a bootstrapping insert can be undone. */
export interface BootstrapRecord {
    /** The value `lessonSpec` held before — null when there was no lesson at all. */
    previousLesson: MutableLesson | null;
    /** The single scene that was promoted into `scenes[0]`, if any. */
    promotedScene: Scene | null;
    /** True when this call created the wrapper (so undo must restore, not just splice). */
    bootstrapped: boolean;
}

/**
 * Guarantee a `LessonFormat` to build into, promoting a displayed single scene.
 *
 * Extracted from the `add_scene` branch of src/chat.ts (the lesson-wrapper
 * bootstrap). It is simultaneously the empty-app case AND the
 * SingleSceneFormat -> LessonFormat normalization — one function, not two.
 */
export function ensureLessonFormat(
    lesson: MaybeLesson,
    displayedScene: Scene | null | undefined,
): { lesson: MutableLesson; bootstrap: BootstrapRecord } {
    if (lesson && Array.isArray((lesson as MutableLesson).scenes)) {
        return {
            lesson: lesson as MutableLesson,
            bootstrap: { previousLesson: lesson as MutableLesson, promotedScene: null, bootstrapped: false },
        };
    }
    // No lesson (or a single-scene spec): wrap it. A displayed scene becomes scenes[0]
    // so the user does not lose what they were looking at.
    const promoted = displayedScene || (lesson && !(lesson as MutableLesson).scenes ? (lesson as Scene) : null);
    const wrapper: MutableLesson = {
        title: 'Lesson',
        scenes: promoted ? [promoted] : [],
    };
    return {
        lesson: wrapper,
        bootstrap: { previousLesson: null, promotedScene: promoted || null, bootstrapped: true },
    };
}

/**
 * Resolve a placement's target array.
 *
 * `proof` is `oneOf: [proof, proof[]]` in the schema and is a bare object in most
 * published occurrences, so it is normalized to a one-element array here and
 * collapsed back by `collapseProof` on write. Without that collapse the model
 * round-trip test fails on every bare-object lesson.
 */
function resolveField(lesson: MutableLesson, at: Placement): unknown[] {
    if (at.field === 'scenes') return lesson.scenes as unknown[];

    const scene = at.scene != null ? (lesson.scenes || [])[at.scene] : undefined;
    if (!scene) throw new PlacementError(`placement names scene ${at.scene}, which does not exist`);

    if (at.field === 'steps') {
        if (!Array.isArray(scene.steps)) scene.steps = [];
        return scene.steps as unknown[];
    }
    if (at.field === 'elements') {
        if (!Array.isArray(scene.elements)) scene.elements = [];
        return scene.elements as unknown[];
    }
    if (at.field === 'add') {
        const step = at.step != null ? (scene.steps || [])[at.step] : undefined;
        if (!step) throw new PlacementError(`placement names step ${at.step}, which does not exist`);
        if (!Array.isArray(step.add)) step.add = [];
        return step.add as unknown[];
    }
    if (at.field === 'proof') {
        const holder = (at.step != null ? (scene.steps || [])[at.step] : scene) as
            { proof?: Proof | Proof[] } | undefined;
        if (!holder) throw new PlacementError(`placement names step ${at.step}, which does not exist`);
        if (holder.proof == null) holder.proof = [];
        else if (!Array.isArray(holder.proof)) holder.proof = [holder.proof];
        return holder.proof as unknown[];
    }
    throw new PlacementError(`placement field ${String(at.field)} has no array to resolve`);
}

/**
 * Collapse a one-element `proof` array back to a bare object.
 *
 * The published corpus writes `proof` as a bare object far more often than as an
 * array; preserving that is required for lossless round-tripping.
 */
function collapseProof(lesson: MutableLesson, at: Placement): void {
    if (at.field !== 'proof') return;
    const scene = at.scene != null ? (lesson.scenes || [])[at.scene] : undefined;
    const holder = (at.step != null && scene ? (scene.steps || [])[at.step] : scene) as
        { proof?: Proof | Proof[] } | undefined;
    if (!holder) return;
    if (Array.isArray(holder.proof) && holder.proof.length === 1) holder.proof = holder.proof[0]!;
}

/** Assert the node at `index` is still the one the op was computed against. */
function verifyIdentity(node: unknown, at: Placement): void {
    if (!at.id) return;
    const actual = (node as { id?: unknown } | null | undefined)?.id;
    if (actual !== at.id) {
        throw new PlacementError(
            `stale placement: expected id ${at.id} at index ${at.index}, found ${String(actual)}`,
        );
    }
}

function requireIndex(at: Placement): number {
    if (typeof at.index !== 'number' || at.index < 0) {
        throw new PlacementError(`placement on field ${String(at.field)} needs a non-negative index`);
    }
    return at.index;
}

/**
 * Apply build ops in order, returning the INVERSE ops.
 *
 * The inverse list is REVERSED: applying several ops shifts indices, so each
 * captured inverse is only valid in the frame it was captured. Unwinding in
 * reverse order restores that frame. Without it, a two-insert result undoes to
 * the wrong positions.
 *
 * Redo needs no special case — applying an inverse returns the forward ops,
 * reconstructed against live state.
 */
export function applyBuildOps(lesson: MutableLesson, ops: BuildOp[]): BuildOp[] {
    const inverse: BuildOp[] = [];

    for (const op of ops) {
        if (op.kind === 'lesson') {
            throw new PlacementError('whole-lesson ops are not supported in iteration 1');
        }
        const arr = resolveField(lesson, op.at);

        if (op.op === 'insert') {
            const index = requireIndex(op.at);
            if (index > arr.length) {
                throw new PlacementError(`insert index ${index} is past the end (${arr.length})`);
            }
            arr.splice(index, 0, op.node);
            inverse.push({ op: 'delete', kind: op.kind, at: op.at } as BuildOp);
        } else if (op.op === 'replace') {
            const index = requireIndex(op.at);
            const old = arr[index];
            if (old === undefined) throw new PlacementError(`replace index ${index} does not exist`);
            verifyIdentity(old, op.at);
            inverse.push({ op: 'replace', kind: op.kind, at: op.at, node: old } as BuildOp);
            arr[index] = op.node;
        } else {
            const index = requireIndex(op.at);
            const old = arr[index];
            if (old === undefined) throw new PlacementError(`delete index ${index} does not exist`);
            verifyIdentity(old, op.at);
            inverse.push({ op: 'insert', kind: op.kind, at: op.at, node: old } as BuildOp);
            arr.splice(index, 1);
        }

        collapseProof(lesson, op.at);
    }

    return inverse.reverse();
}
