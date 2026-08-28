// ============================================================
// The `build_scene` chat tool — from a tool call to an applied scene.
//
// The agent decides WHETHER to build and says what for; everything else is
// deterministic code running here. That split is deliberate and mirrors
// `edit_step` on the proof side: no keyword matching separates "add a scene
// showing the tangent" from "what would a scene showing the tangent look
// like?", because the difference is in the sentence, not the vocabulary.
//
// This module is pure — no DOM, no globals, no fetch. It turns a tool call into
// a request body, and a reply into a `BuilderOutcome`. src/chat.ts does the I/O
// and the re-render. Written that way so both halves are testable without a
// browser, and because the interesting failures are all in the translation:
// 1-based scene numbers to 0-based indices, and a flat JSON reply to the
// contract's tagged union.
// ============================================================

import type { LessonFormat, Scene } from '/types/lesson.js';
import type { BuildOp, BuilderOutcome } from '/placement.js';
import {
    assembleBuildSceneRequest,
    type BuildSceneRequestBody, type MemoryRef, type ThreadTurn,
} from '/builder-context.js';

/** The arguments the agent supplies. Everything else is derived. */
export interface BuildSceneToolArgs {
    intent?: unknown;
    /** 'insert' (default) or 'replace'. */
    op?: unknown;
    /** 1-BASED scene number, as in `navigate_to`. Omitted on insert = append. */
    scene?: unknown;
}

/**
 * Translate the agent's 1-based scene number into a 0-based index.
 *
 * The agent's whole world is 1-based — `navigate_to` takes "scene 2" and means
 * the second scene — while the wire contract and `applyBuildOps` are 0-based.
 * Converting here, once, is why nothing downstream has to remember which
 * convention it is holding. `undefined` stays `undefined`: on insert that means
 * "append", which is a different instruction from "insert at 0".
 */
export function sceneIndexFromArgs(scene: unknown): number | undefined {
    if (scene == null || scene === '') return undefined;
    const n = typeof scene === 'number' ? scene : parseInt(String(scene), 10);
    if (!Number.isFinite(n)) return undefined;
    // Clamp at 0 rather than letting `scene: 0` become -1. A model that sent a
    // 0-based number anyway meant the first scene, and `assembleBuildSceneRequest`
    // would reject -1 on replace with a message about an index the agent never
    // wrote.
    return Math.max(0, Math.trunc(n) - 1);
}

/** Build the request body for a `build_scene` tool call. Throws on a hopeless one. */
export function buildSceneRequestFromToolCall(
    args: BuildSceneToolArgs,
    lesson: LessonFormat | Scene | null | undefined,
    thread: ThreadTurn[] = [],
    memory: MemoryRef[] = [],
): BuildSceneRequestBody {
    // Anything that is not the literal 'replace' is an insert. A model that
    // invents 'add' or 'append' means insert, and guessing wrong the other way
    // would OVERWRITE a scene the user still wanted.
    const op = args.op === 'replace' ? 'replace' : 'insert';
    return assembleBuildSceneRequest({
        lesson,
        intent: typeof args.intent === 'string' ? args.intent : '',
        op,
        sceneIndex: sceneIndexFromArgs(args.scene),
        memory,
        messages: thread,
    });
}

/** The reply shape `backend/experts/handlers/build_scene/handler.py` returns. */
interface BuildSceneReply {
    fallback_to_chat?: unknown;
    question?: unknown;
    reason?: unknown;
    result?: { ops?: unknown } | null;
    focus?: unknown;
}

/** One line naming what landed, for the chat log. */
export function summarise(ops: BuildOp[]): string {
    if (!ops.length) return 'Nothing to apply.';
    const op = ops[0]!;
    const title = op.op === 'delete' ? '' : (op.node as { title?: unknown } | null)?.title;
    const name = typeof title === 'string' && title.trim() ? `“${title.trim()}”` : 'a scene';
    return op.op === 'replace' ? `Rebuilt ${name}.` : `Added ${name}.`;
}

/**
 * Read the handler's reply into the contract's tagged union.
 *
 * The four outcomes are mutually exclusive on the wire, so this reads them in
 * the order the handler produces them and never merges two. An unrecognized
 * reply becomes `refused` rather than `passthrough`: a reply we cannot read is
 * a bug to surface, not a question to hand back to the tutor as if the user had
 * asked something conversational.
 */
export function interpretBuildSceneReply(reply: unknown): BuilderOutcome {
    const r = (reply || {}) as BuildSceneReply;
    // `focus` is a bare scene INDEX on the wire; `Placement` is the contract's
    // vocabulary. Converting here keeps the integer from leaking into callers.
    const focusIndex = typeof r.focus === 'number' && Number.isInteger(r.focus) && r.focus >= 0
        ? r.focus : null;
    const focus = focusIndex == null ? undefined : { index: focusIndex };

    if (r.fallback_to_chat) return { kind: 'passthrough' };
    if (typeof r.question === 'string' && r.question.trim()) {
        return { kind: 'question', question: r.question.trim(), focus };
    }
    if (typeof r.reason === 'string' && r.reason.trim()) {
        return { kind: 'refused', reason: r.reason.trim(), focus };
    }
    const ops = r.result && Array.isArray(r.result.ops) ? (r.result.ops as BuildOp[]) : null;
    // An EMPTY ops array is not a success. It applies cleanly, renders nothing,
    // and would be reported to the user as a scene that was built.
    if (ops && ops.length) {
        return { kind: 'result', result: { ops, summary: summarise(ops), focus: focus || null } };
    }
    return { kind: 'refused', reason: 'The scene builder returned nothing usable.', focus };
}
