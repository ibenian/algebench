// ============================================================
// Placement + build ops — the wire contract for builder experts.
//
// A builder returns a complete canonical NODE plus a PLACEMENT saying where it
// goes. Three ops cover everything a builder needs: a built node is put
// somewhere new, swapped for an existing one, or removed. Nothing finer,
// because a builder never produces anything finer than a node.
//
// Node payloads are the GENERATED lesson types (src/types/lesson.d.ts) — no
// shapes are restated here.
// ============================================================

import type { LessonFormat, Scene, Step, Proof, ProofStep } from '/types/lesson.js';

export type NodeKind = 'lesson' | 'scene' | 'step' | 'proof' | 'proof_step';

/**
 * WHERE a node goes. Positional, not id-based, for three reasons:
 *   1. a node being inserted has no id in the document yet (ids are minted
 *      server-side, never proposed by the model);
 *   2. position is itself meaningful — a step's index IS its pedagogy;
 *   3. ids are ambiguous anyway, since the same element id may appear in
 *      `scene.elements` and again in a `step.add[]` (a supported feature).
 *
 * There is deliberately NO `field` naming the target array. An earlier revision
 * had one, which made `kind` and `field` independent axes when only a few
 * pairings are legal: `{kind: 'scene', field: 'steps'}` type-checked, and
 * applying it would have spliced a Scene into a Step array. The container is a
 * function of the kind, so it is DERIVED rather than declared — the illegal
 * combinations stop being representable instead of being caught at runtime:
 *
 *     lesson      -> the root itself (replace only)
 *     scene       -> lesson.scenes
 *     step        -> lesson.scenes[scene].steps
 *     proof       -> scenes[scene].proof, or lesson.proof when `scene` is absent
 *     proof_step  -> scenes[scene].proof.steps
 *
 * `proof` is `oneOf: [proof, proof[]]` in the schema and is a bare object in 18
 * of its 30 published occurrences, so the applier normalizes on read and
 * collapses back on write.
 *
 * `kind` lives on the op, not here, so TypeScript narrows `node` natively.
 * Placement answers WHERE; kind answers WHAT.
 */
export interface Placement {
    /**
     * Which scene. Absent for a lesson-level placement — including
     * `LessonFormat.proof`, which the schema permits at the root.
     */
    scene?: number;
    /** Which step, for a step-level proof. */
    step?: number;
    /** Insert-before / replace-at position within the derived container. */
    index?: number;
    /**
     * NOT for lookup — for VERIFICATION. On replace/delete the target already
     * exists, so the applier asserts `arr[index].id === id` before mutating. If
     * another build landed in between, the index now points at a different node
     * and the op is stale: discard it rather than overwrite the wrong scene.
     */
    id?: string;
}

/** The node payload each kind carries. Generated types only. */
export interface NodePayload {
    lesson: LessonFormat;
    scene: Scene;
    step: Step;
    proof: Proof;
    proof_step: ProofStep;
}

/**
 * One build operation.
 *
 * Both discriminants — `op` and `kind` — are TOP-LEVEL, so TypeScript narrows
 * `node` natively:
 *
 *     if (op.kind === 'scene' && op.op !== 'delete') op.node.steps   // node: Scene
 *
 * Do NOT move `kind` down onto the placement. Narrowing through a nested
 * property is not reliable, and if `node` stays a union then typing it bought
 * nothing.
 */
export type BuildOp = {
    [K in NodeKind]:
        | { op: 'insert';  kind: K; at: Placement; node: NodePayload[K] }
        | { op: 'replace'; kind: K; at: Placement; node: NodePayload[K] }
        | { op: 'delete';  kind: K; at: Placement }
}[NodeKind];

/** What a builder returns on success. */
export interface BuildResult {
    ops: BuildOp[];
    summary: string;
    focus: Placement | null;
}

/** The four mutually exclusive outcomes every builder returns (mirrors proof_edit). */
export type BuilderOutcome =
    | { kind: 'result';   result: BuildResult; caveat?: string }
    | { kind: 'question'; question: string; focus?: Placement }
    | { kind: 'refused';  reason: string; focus?: Placement }
    | { kind: 'passthrough' };
