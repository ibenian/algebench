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
 * Which property on the parent node holds the target.
 *
 * Named for the PROPERTY, not its runtime type, because not every target is an
 * array: `proof` is `oneOf: [proof, proof[]]` in the schema and is a bare object
 * in 18 of the 30 published occurrences. `null` is the root itself (kind
 * 'lesson'), which has no container at all.
 */
export type PlacementField = 'scenes' | 'steps' | 'elements' | 'add' | 'proof' | null;

/**
 * WHERE a node goes. Positional, not id-based, for three reasons:
 *   1. a node being inserted has no id in the document yet (ids are minted
 *      server-side, never proposed by the model);
 *   2. position is itself meaningful — a step's index IS its pedagogy;
 *   3. ids are ambiguous anyway, since the same element id may appear in
 *      `scene.elements` and again in a `step.add[]` (a supported feature).
 *
 * `kind` deliberately does NOT live here — it is a discriminant on the op, so
 * TypeScript narrows `node` natively. Placement answers WHERE; kind answers WHAT.
 */
export interface Placement {
    /** Which scene, for step- and proof-level placements. */
    scene?: number;
    /** Which step, for a step-level proof. */
    step?: number;
    field: PlacementField;
    /** Present iff `field` holds an array. */
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
