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
import type { BuildOp, NodeKind, Placement } from '/placement.js';

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
    //
    // `import`, `unsafe` and `unsafeExplanation` are declared on singleSceneFormat
    // but NOT on scene, and `$defs.scene` is `additionalProperties: false` — so
    // carrying the whole object into scenes[0] produced a lesson that fails schema
    // validation. Worse, it was silent at runtime: loadLesson reads `spec.import`
    // and `spec.unsafe` at the ROOT, so domain imports stopped loading and trust
    // metadata was ignored. They are lifted to the wrapper instead.
    const source = displayedScene || (lesson && !(lesson as MutableLesson).scenes ? (lesson as Scene) : null);
    let promoted = source;
    const rootOnly: Record<string, unknown> = {};
    if (source) {
        const { import: imports, unsafe, unsafeExplanation, ...sceneOnly } =
            source as Scene & { import?: unknown; unsafe?: unknown; unsafeExplanation?: unknown };
        if (imports !== undefined) rootOnly.import = imports;
        if (unsafe !== undefined) rootOnly.unsafe = unsafe;
        if (unsafeExplanation !== undefined) rootOnly.unsafeExplanation = unsafeExplanation;
        promoted = sceneOnly as Scene;
    }
    const wrapper: MutableLesson = {
        title: 'Lesson',
        ...rootOnly,
        scenes: promoted ? [promoted] : [],
    };
    return {
        lesson: wrapper,
        // The bootstrap record keeps the ORIGINAL object, root-only fields and
        // all: it exists to restore the pre-lesson state on undo, and restoring a
        // stripped copy would quietly discard `import`/`unsafe` from the very
        // spec the user started with. `scenes[0]` gets the stripped version.
        bootstrap: { previousLesson: null, promotedScene: source || null, bootstrapped: true },
    };
}

/**
 * Resolve the container a node of `kind` lives in.
 *
 * The container is DERIVED from the kind rather than named by the placement, so
 * a mismatched pair (a Scene addressed into a step's array, say) cannot be
 * expressed at all — see the note on `Placement`.
 *
 * `proof` is `oneOf: [proof, proof[]]` in the schema and is a bare object in
 * most published occurrences, so it is normalized to a one-element array here
 * and collapsed back by `collapseProof` on write. Without that collapse the
 * model round-trip test fails on every bare-object lesson.
 */
function resolveContainer(lesson: MutableLesson, kind: NodeKind, at: Placement): unknown[] {
    if (kind === 'scene') return lesson.scenes as unknown[];

    if (kind === 'proof' && at.scene == null && at.step != null) {
        // `step` names a step WITHIN a scene, so a step-level proof without a
        // scene is malformed. Routing it to the lesson root would silently apply
        // the op somewhere the caller never asked for.
        throw new PlacementError('a step-level proof placement needs a scene');
    }

    if (kind === 'proof' && at.scene == null) {
        // The schema allows `proof` on LessonFormat itself, so a placement with
        // no scene addresses the lesson-level collection rather than being an error.
        const root = lesson as unknown as { proof?: Proof | Proof[] };
        if (root.proof == null) root.proof = [];
        else if (!Array.isArray(root.proof)) root.proof = [root.proof];
        return root.proof as unknown[];
    }

    const scene = at.scene != null ? lesson.scenes[at.scene] : undefined;
    if (!scene) throw new PlacementError(`placement names scene ${at.scene}, which does not exist`);

    if (kind === 'step') {
        if (!Array.isArray(scene.steps)) scene.steps = [];
        return scene.steps as unknown[];
    }

    if (kind === 'proof') {
        const holder = (at.step != null ? (scene.steps || [])[at.step] : scene) as
            { proof?: Proof | Proof[] } | undefined;
        if (!holder) throw new PlacementError(`placement names step ${at.step}, which does not exist`);
        if (holder.proof == null) holder.proof = [];
        else if (!Array.isArray(holder.proof)) holder.proof = [holder.proof];
        return holder.proof as unknown[];
    }

    throw new PlacementError(`no container is defined for kind '${kind}'`);
}

/**
 * Collapse a one-element `proof` array back to a bare object.
 *
 * The published corpus writes `proof` as a bare object far more often than as an
 * array; preserving that is required for lossless round-tripping.
 */
function collapseProof(lesson: MutableLesson, kind: NodeKind, at: Placement): void {
    if (kind !== 'proof') return;
    const holder = proofHolder(lesson, at);
    if (!holder) return;
    if (!Array.isArray(holder.proof)) return;
    // One proof collapses back to the bare object the corpus overwhelmingly uses;
    // ZERO means the field should not exist at all. Leaving `proof: []` behind
    // made deleting the last proof non-invertible — the inverse re-inserted the
    // node but could not remove the empty array the normalization had created.
    if (holder.proof.length === 1) holder.proof = holder.proof[0]!;
    else if (holder.proof.length === 0) delete holder.proof;
}

/** The object holding a `proof` for this placement, or undefined. */
function proofHolder(lesson: MutableLesson, at: Placement): { proof?: Proof | Proof[] } | undefined {
    if (at.scene == null) return lesson as unknown as { proof?: Proof | Proof[] };
    const scene = lesson.scenes[at.scene];
    if (!scene) return undefined;
    return (at.step != null ? (scene.steps || [])[at.step] : scene) as
        { proof?: Proof | Proof[] } | undefined;
}

/**
 * Snapshot a container field so a REFUSED op leaves no trace of itself.
 *
 * `resolveContainer` has two side effects: it creates a missing `steps` array,
 * and it normalizes a bare `proof` object into a one-element array. If the op is
 * then rejected, those changes have already landed with no inverse to undo them
 * — the lesson is quietly reshaped by an operation the caller was told did not
 * apply, which makes the all-or-nothing guarantee false even for a single op.
 */
function captureContainerShape(lesson: MutableLesson, kind: NodeKind, at: Placement): () => void {
    let holder: Record<string, unknown> | undefined;
    let key: string;

    if (kind === 'proof') {
        holder = proofHolder(lesson, at) as Record<string, unknown> | undefined;
        key = 'proof';
    } else if (kind === 'step') {
        holder = (at.scene != null ? lesson.scenes[at.scene] : undefined) as
            Record<string, unknown> | undefined;
        key = 'steps';
    } else {
        return () => {};    // `scenes` always exists on a MutableLesson
    }

    if (!holder) return () => {};
    const had = key in holder;
    const original = holder[key];
    return () => {
        if (!had) delete holder![key];
        else holder![key] = original;
    };
}

/** Assert the node at `index` is still the one the op was computed against. */
function verifyIdentity(node: unknown, at: Placement): void {
    // `undefined` means "no verification requested"; an EMPTY STRING does not.
    // Ids are plain strings in the schema with no minLength, so a truthiness test
    // let `id: ""` skip stale-op checking entirely and replace or delete whatever
    // happened to be at that index.
    if (at.id === undefined) return;
    const actual = (node as { id?: unknown } | null | undefined)?.id;
    if (actual !== at.id) {
        throw new PlacementError(
            `stale placement: expected id ${at.id} at index ${at.index}, found ${String(actual)}`,
        );
    }
}

function requireIndex(at: Placement): number {
    // Integer, not merely non-negative. A fractional index passes a `>= 0` check
    // and then behaves DIFFERENTLY per op: `replace` writes `arr[1.5]`, a plain
    // property that no splice can see, while `insert`/`delete` coerce it. The
    // three ops would silently address different slots.
    if (typeof at.index !== 'number' || !Number.isInteger(at.index) || at.index < 0) {
        throw new PlacementError(`placement needs a non-negative integer index, got ${String(at.index)}`);
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

    try {
        return applyEach(lesson, ops, inverse);
    } catch (err) {
        // ALL OR NOTHING. Without this, a valid insert followed by a stale
        // replace left the insert applied while the caller — seeing a throw —
        // believed the whole build was refused, and the undo stack never
        // received the inverse that would have undone it. Unwind what did land,
        // in reverse, before rethrowing.
        for (const undo of [...inverse].reverse()) {
            try { applyEach(lesson, [undo], []); } catch { /* best effort; the throw below is the real signal */ }
        }
        throw err;
    }
}

function applyEach(lesson: MutableLesson, ops: BuildOp[], inverse: BuildOp[]): BuildOp[] {
    for (const op of ops) {
        // No runtime guard for `lesson`/`proof_step` here: `BuildOp` is built over
        // SupportedKind, so those cannot be constructed at all. tsc flags the old
        // check as unreachable, which is the point — the type carries the
        // constraint instead of a throw discovered at apply time.
        // Validate the address BEFORE resolving. resolveContainer materializes a
        // missing `steps`/`proof` array as a side effect, so resolving first meant
        // an op that was about to be REFUSED still left `steps: []` behind — and
        // for a bare `proof`, still converted it to an array with no inverse to
        // put it back. Both broke the all-or-nothing promise for a single op.
        const index = requireIndex(op.at);
        const restoreShape = captureContainerShape(lesson, op.kind, op.at);
        let arr: unknown[];
        try {
            arr = resolveContainer(lesson, op.kind, op.at);
        } catch (err) {
            restoreShape();
            throw err;
        }

        if (op.op === 'insert') {
            if (index > arr.length) {
                restoreShape();
                throw new PlacementError(`insert index ${index} is past the end (${arr.length})`);
            }
            arr.splice(index, 0, op.node);
            // The inverse must verify the node IT will remove — the one just
            // inserted. `op.at` carries no id (an insert has no pre-existing
            // target to check), so reusing it verbatim gave the undo no identity
            // check at all: if another build shifted this array in between, the
            // delete would remove whatever now sat at that index. That is exactly
            // the stale-placement protection every other op path has.
            const insertedId = (op.node as { id?: string } | null)?.id;
            inverse.push({ op: 'delete', kind: op.kind, at: { ...op.at, id: insertedId } } as BuildOp);
        } else if (op.op === 'replace') {
            const old = arr[index];
            if (old === undefined) { restoreShape(); throw new PlacementError(`replace index ${index} does not exist`); }
            try { verifyIdentity(old, op.at); } catch (e) { restoreShape(); throw e; }
            // The inverse must verify what will be THERE when it runs — the
            // replacement — not what was there for the forward op. Reusing
            // `op.at` verbatim carried the OLD node's id, so undoing a replace
            // threw `stale placement` whenever the new node had a different id
            // (or none), which is the ordinary case.
            // Same care as verifyIdentity: distinguish an absent id from an
            // empty one, so a replacement carrying `id: ""` is still verified.
            const replacementId = (op.node as { id?: string } | null)?.id;
            inverse.push({
                op: 'replace',
                kind: op.kind,
                at: { ...op.at, id: replacementId },
                node: old,
            } as BuildOp);
            arr[index] = op.node;
        } else {
            const old = arr[index];
            if (old === undefined) { restoreShape(); throw new PlacementError(`delete index ${index} does not exist`); }
            try { verifyIdentity(old, op.at); } catch (e) { restoreShape(); throw e; }
            inverse.push({ op: 'insert', kind: op.kind, at: op.at, node: old } as BuildOp);
            arr.splice(index, 1);
        }

        collapseProof(lesson, op.kind, op.at);
    }

    return inverse.reverse();
}
