// Interactive proof editing — natural-language step operations on an open proof.
//
// The user describes an operation ("add 3x to both sides"); the server proposes
// it, sympy verifies it, and the alternatives come back as compact step ops. This
// module owns the whole interaction: the editing lock, routing, clarification
// rounds, variant assembly, the picker, and undo. `prove.js` only wires it up.
//
// THERE IS DELIBERATELY NO KEYWORD MATCHING HERE. It was tried and removed: no
// word list can separate "move c to the right" (an instruction) from "why did
// they move c to the right?" (a question), because the difference is in the
// sentence, not the vocabulary. The chat agent decides instead, by calling its
// `edit_step` tool with the whole conversation in view, and the resulting
// variants ride back on the chat reply. This module trusts that decision.
//
// Three other things it deliberately does NOT do:
//   * expose any free-text LaTeX field — math changes only through a verified op;
//   * mutate the caller's proof before Done — preview and committed state stay
//     separate, so Submit can never see a candidate the user did not accept;
//   * render anything that has not been through `validateProofData`.

import { validateProofData } from './proof-animation/validate-proof.js';

const UNDO_WORD = /^\s*(undo|revert)\s*$/i;

const UNDO_MAX = 20;

const VARIANT_LABELS = {
    insert: 'Just my step',
    glue: 'My step + bridge',
    // The repair for a global operation: the same change carried through the
    // rest of the derivation, so it stays consistent instead of reverting to
    // the old form on the next line.
    propagate: 'My step, applied to the rest',
    supersede: 'My step, replacing what follows',
};

/** Deep clone via JSON — proofs are plain data by construction. */
const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * Reassemble a full proof from the compact wire format.
 *
 * Mirrored by `assemble()` in tests/backend/experts/test_proof_edit_patch.py,
 * which asserts the result matches the server's own rebuild field-for-field —
 * keep the two in step.
 *
 * `step_updates` is keyed by ORIGINAL index, so it is applied before renumbering.
 */
export function assembleVariant(original, newSteps, variant) {
    const { at, take, delete_count: del } = variant;
    const steps = original.steps || [];

    const head = steps.slice(0, at + 1).map((s) => ({ ...s }));
    const inserted = newSteps.slice(0, take).map((s) => ({ ...s }));
    const tail = steps.slice(at + 1 + del).map((s) => ({ ...s }));

    for (const [key, changed] of Object.entries(variant.step_updates || {})) {
        const origIndex = Number(key);
        if (origIndex <= at) {
            if (head[origIndex]) Object.assign(head[origIndex], changed);
        } else {
            const pos = origIndex - (at + 1 + del);
            if (pos >= 0 && pos < tail.length) Object.assign(tail[pos], changed);
        }
    }

    const out = { ...original, steps: [...head, ...inserted, ...tail] };
    out.steps.forEach((s, i) => { s.index = i; });
    out.terms = { ...(original.terms || {}), ...(variant.terms_added || {}) };
    if (variant.overall_confidence) out.overall_confidence = variant.overall_confidence;
    return out;
}

/**
 * @param {object} deps
 * @param {() => object|null} deps.getProof        the committed proof
 * @param {() => number}      deps.getCurrentStep  step the user is viewing
 * @param {(proof, startStep) => void} deps.onMount   remount the animator
 * @param {(proof) => void}   deps.onCommit        adopt a proof as committed
 * @param {(pending: boolean) => void} deps.setEditPending  gate Submit/Rederive
 * @param {(role, text) => void} deps.addBubble    write to the chat log
 */
export function createProofEditTool(deps) {
    const {
        getProof, getCurrentStep, onMount, onCommit, setEditPending, addBubble,
    } = deps;

    let unlocked = false;          // locked is the default; see reset()
    let session = null;            // { original, newSteps, variants, cache, selected }
    let bar = null;                // the picker element, while open
    const undoStack = [];

    // ---- lock ------------------------------------------------------------- //

    /** Called on every fresh proof load: a new proof is never born unlocked. */
    function reset() {
        unlocked = false;
        undoStack.length = 0;
        closeBar();
    }

    function setUnlocked(next) {
        unlocked = !!next;
        if (!unlocked) closeBar();
    }

    /**
     * Claim a chat message BEFORE it is sent, for the few things that never need
     * the server. Returns true if consumed.
     *
     * Only undo lives here. Everything else — including deciding whether a
     * message is an edit at all — belongs to the chat agent.
     */
    function interceptLocal(rawMsg) {
        const msg = String(rawMsg || '').trim();
        if (!msg || !unlocked) return false;
        return UNDO_WORD.test(msg) ? undo() : false;
    }

    /**
     * Consume the `edit` block the chat reply carried, if any.
     *
     * The chat agent already decided this turn was an instruction to change the
     * derivation; by the time we get here the operation has been applied and
     * CAS-checked server-side. Returns true if an edit was presented.
     */
    function applyEditResult(res) {
        const edit = res && res.edit;
        if (!edit || !unlocked) return false;

        // A clarifying question, or a refusal: both are just things to say. The
        // agent keeps the thread, so an answer to the question flows back through
        // the normal chat turn with no client-side state to track.
        if (edit.question) { addBubble('bot', edit.question); return true; }

        // Anything that isn't a usable set of variants gets SAID. Two routers are
        // involved — the chat agent decided this turn was an instruction, and the
        // expert then decides whether it can act on it — and they can disagree
        // (`fallback_to_chat`). Staying silent there would leave the reader having
        // asked for an edit and received nothing at all.
        if (edit.reason || !edit.variants || !edit.variants.length) {
            addBubble('bot', edit.reason
                || "I couldn't turn that into a step operation on this proof.");
            return true;
        }

        const proof = getProof();
        if (!proof || !(proof.steps || []).length) {
            addBubble('bot', 'There is no derivation open to edit.');
            return true;
        }

        openBar(proof, edit);
        if (edit.summary) addBubble('bot', edit.summary);
        // The CAS neither confirmed nor disproved this. Say it in words: the
        // "Plausible" badge reads as mild approval, and the CAS returns exactly
        // that tier for an outright nonsense step, so the badge alone is not a
        // strong enough signal to rely on.
        if (edit.caveat) addBubble('bot', `⚠️ ${edit.caveat}`);
        return true;
    }

    // ---- variants --------------------------------------------------------- //

    function variantProof(index) {
        if (session.cache[index]) return session.cache[index];
        const raw = assembleVariant(session.original, session.newSteps,
                                    session.variants[index]);
        // Same trust boundary as a freshly derived proof: nothing reaches the
        // animator that has not been validated as a COMPLETE proof.
        const safe = validateProofData(raw);
        session.cache[index] = safe;
        return safe;
    }

    function select(index) {
        session.selected = index;
        onMount(variantProof(index), insertedStep(index));
        if (bar) {
            bar.querySelectorAll('[data-variant]').forEach((el) => {
                const on = Number(el.dataset.variant) === index;
                el.classList.toggle('is-selected', on);
                el.setAttribute('aria-checked', on ? 'true' : 'false');
            });
        }
    }

    /** The first step this variant inserts — what the user just asked for. */
    function insertedStep(index) {
        return (session.variants[index].at || 0) + 1;
    }

    function openBar(original, res) {
        const returnStep = getCurrentStep();
        closeBar();
        session = {
            original, newSteps: res.new_steps, variants: res.variants,
            cache: {}, selected: 0,
            returnStep,          // where to put the reader back if they cancel
        };

        bar = document.createElement('div');
        bar.className = 'edit-variants';
        bar.setAttribute('role', 'radiogroup');
        bar.setAttribute('aria-label', 'Ways to apply this edit');

        const title = document.createElement('span');
        title.className = 'edit-variants-title';
        title.textContent = res.variants.length > 1
            ? `${res.variants.length} ways to apply this` : 'Apply this';
        bar.appendChild(title);

        res.variants.forEach((v, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'edit-variant';
            btn.dataset.variant = String(i);
            btn.setAttribute('role', 'radio');

            const label = document.createElement('span');
            label.className = 'edit-variant-label';
            label.textContent = VARIANT_LABELS[v.kind] || v.kind;
            btn.appendChild(label);

            // badge_delta is what the CAS says; readability_note is what it
            // CANNOT say — an equivalent chain still reads wrong if a caption no
            // longer describes its move.
            const note = [v.badge_delta, v.readability_note].filter(Boolean).join(' · ');
            if (note) {
                const sub = document.createElement('span');
                sub.className = 'edit-variant-note';
                sub.textContent = note;
                btn.appendChild(sub);
            }
            btn.addEventListener('click', () => select(i));
            bar.appendChild(btn);
        });

        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'edit-done';
        done.textContent = 'Done';
        done.addEventListener('click', commit);

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'edit-cancel';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', cancelEdit);

        bar.append(done, cancel);
        deps.mountBar(bar);

        // While the bar is open the view shows a candidate but the committed
        // proof is still the original. Submitting now would ship the version the
        // user is NOT looking at, so those actions are gated until Done/Cancel.
        setEditPending(true);
        select(0);
    }

    function closeBar() {
        if (bar) { bar.remove(); bar = null; }
        session = null;
        setEditPending(false);
    }

    // Committing, cancelling and undoing all land the reader somewhere
    // deliberate. Step 0 would be wrong for every one of them: after an edit the
    // interesting step is the one just inserted — the thing they asked for — and
    // after a cancel or undo it is wherever they were before.

    function commit() {
        if (!session) return;
        const chosen = variantProof(session.selected);
        const landing = insertedStep(session.selected);
        pushUndo(session.original, session.returnStep);
        closeBar();
        onCommit(chosen);
        onMount(chosen, landing);
    }

    function cancelEdit() {
        if (!session) return;
        const { original, returnStep } = session;
        closeBar();
        onMount(original, returnStep);
    }

    // ---- undo ------------------------------------------------------------- //

    function pushUndo(proof, step) {
        // The step rides with the proof: an undone edit changes the numbering, so
        // the index the reader was on only means anything against its own proof.
        undoStack.push({ proof: clone(proof), step: step || 0 });
        if (undoStack.length > UNDO_MAX) undoStack.shift();
    }

    function undo() {
        if (!undoStack.length) {
            addBubble('bot', 'Nothing to undo.');
            return true;
        }
        const { proof: prev, step } = undoStack.pop();
        closeBar();
        onCommit(prev);
        onMount(prev, Math.min(step, (prev.steps || []).length - 1));
        addBubble('bot', 'Reverted the last edit.');
        return true;
    }

    return {
        interceptLocal,
        applyEditResult,
        undo,
        reset,
        setUnlocked,
        isUnlocked: () => unlocked,
        canUndo: () => undoStack.length > 0,
        // The Done / Cancel buttons call these; exposed so the landing behaviour
        // is testable without driving real DOM events.
        commitSelected: commit,
        cancelSelected: cancelEdit,
        dispose: closeBar,
    };
}
