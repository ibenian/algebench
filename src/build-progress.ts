// ============================================================
// Showing a scene being built.
//
// A build is one LM call and takes tens of seconds. Before this, the whole
// interval looked like nothing happening: the agent said "I'm building it", the
// scene tree did not move, and the only evidence was a chat bubble that arrived
// when it was over.
//
// So the scene is added FIRST, empty and labelled, and the lesson navigates to
// it — the user watches the slot they asked for appear and then fill in. The
// pill is the same indicator a proof derivation shows, for the same reason: it
// says work is in flight without pretending to know how far along it is.
//
// The placeholder is a REAL scene in the lesson, not a UI state, because that is
// what makes it visible in the scene tree and navigable. Everything that puts
// one there is therefore responsible for taking it away again: `reserveOp` makes
// the slot, and exactly one of `landOnSlot` (the build arrived) or `releaseOp`
// (every other outcome) must finish it. Both address the slot by IDENTITY via
// `slotIndex`, because the lesson can move while a build is in flight.
// ============================================================

import type { Scene } from '/types/lesson.js';
import type { BuildOp } from '/placement.js';

/** Ids are minted here so `at.id` can verify the slot is still ours. */
let seq = 0;

/**
 * A scene that says "this is being built", and where.
 *
 * Deliberately EMPTY rather than a guess at what is coming: a placeholder that
 * draws axes and a vector reads as a finished scene that came out wrong. The
 * caption carries the intent, so the slot explains itself while it waits.
 */
export function placeholderScene(intent: string): Scene {
    seq += 1;
    const asked = (intent || '').trim().replace(/\s+/g, ' ');
    return {
        // `additionalProperties: false` on `$defs.scene`, so only real fields.
        id: `building-${seq}`,
        title: 'Building…',
        description: asked ? `Building: ${asked}` : 'Building a new scene…',
        elements: [],
    } as unknown as Scene;
}

/** True for a scene this module put in the lesson. */
export function isPlaceholder(scene: unknown): boolean {
    const id = (scene as { id?: unknown } | null)?.id;
    return typeof id === 'string' && id.startsWith('building-');
}

/**
 * Where the placeholder is NOW, or -1 if it is gone.
 *
 * Not the index it was reserved at. A build takes tens of seconds and the lesson
 * can move under it — another build landing, the user deleting a scene. Both
 * finishing moves address the slot by IDENTITY and only then by position, so a
 * shifted lesson relocates the slot instead of operating on its old neighbour.
 */
export function slotIndex(scenes: readonly unknown[], placeholder: Scene): number {
    const id = (placeholder as { id?: string }).id;
    return scenes.findIndex((s) => (s as { id?: unknown } | null)?.id === id);
}

/** The op that puts a placeholder at `index`. */
export function reserveOp(index: number, placeholder: Scene): BuildOp {
    return { op: 'insert', kind: 'scene', at: { index }, node: placeholder } as BuildOp;
}

/**
 * Turn the expert's op into one that lands ON the reserved slot.
 *
 * The expert does not know a placeholder exists — it answers the request it was
 * sent, which for an insert is "insert at N". Applying that verbatim after
 * reserving N would leave TWO scenes: the real one and the placeholder pushed
 * down beside it. So an insert becomes a replace of the slot we made.
 *
 * `at.id` carries the placeholder's id, so if anything moved the lesson while
 * the build was in flight the replace is REFUSED rather than overwriting a
 * scene the user meant to keep.
 */
export function landOnSlot(op: BuildOp, placeholder: Scene, index: number): BuildOp {
    const id = (placeholder as { id?: string }).id;
    // The slot is gone — the user deleted it while the build ran. Their delete
    // stands; the built scene still goes in where it was asked for, unverified,
    // because there is no longer an identity to verify against.
    if (index < 0 || op.op === 'delete') return op;
    return { op: 'replace', kind: op.kind, at: { index, id }, node: op.node } as BuildOp;
}

/**
 * The op that takes the placeholder away again when nothing was built.
 *
 * `null` when the slot is already gone — there is nothing to remove, and an op
 * addressing a vanished index would delete a scene that is not ours.
 */
export function releaseOp(index: number, placeholder: Scene): BuildOp | null {
    const id = (placeholder as { id?: string }).id;
    if (index < 0) return null;
    return { op: 'delete', kind: 'scene', at: { index, id } } as BuildOp;
}

/**
 * Show the in-flight pill over the 3D viewport.
 *
 * Same markup and classes as the proof-derivation pill so the two read as one
 * idea rather than two indicators that happen to spin. Returns its own remover:
 * a caller that forgets to call it leaves a pill spinning over a finished scene,
 * so there is exactly one thing to remember and no id to look up.
 */
export function showBuildPill(text = 'Building scene…'): () => void {
    const vp = typeof document !== 'undefined' ? document.getElementById('viewport') : null;
    if (!vp) return () => {};
    let stack = vp.querySelector('.build-indicator-stack');
    if (!stack) {
        stack = document.createElement('div');
        stack.className = 'graph-enrich-indicator-stack build-indicator-stack';
        vp.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = 'graph-enrich-indicator';
    el.setAttribute('role', 'status');
    const dots = document.createElement('span');
    dots.className = 'gei-dots';
    for (let i = 0; i < 3; i += 1) dots.appendChild(document.createElement('span'));
    const label = document.createElement('span');
    label.className = 'gei-text';
    // textContent, not innerHTML: `text` can carry the user's own words.
    label.textContent = text;
    el.appendChild(dots);
    el.appendChild(label);
    stack.appendChild(el);

    // A placeholder has no elements, and `loadScene` reads "no elements" as "no
    // scene loaded" — so the viewport tells the reader to drag & drop a JSON
    // file while a build they just asked for is running. Suppressed for the
    // duration and restored on removal; every path that removes the pill
    // navigates immediately afterwards, which re-decides this correctly.
    const empty = document.getElementById('empty-state');
    const wasShown = empty ? empty.style.display : null;
    if (empty) empty.style.display = 'none';

    let removed = false;
    return () => {
        if (removed) return;
        removed = true;
        if (empty && wasShown !== null) empty.style.display = wasShown;
        if (el.parentNode) el.parentNode.removeChild(el);
        // Take the stack with it once it is empty, so an absolutely-positioned
        // empty div is not left sitting over the canvas.
        if (stack && !stack.childNodes.length && stack.parentNode) {
            stack.parentNode.removeChild(stack);
        }
    };
}
