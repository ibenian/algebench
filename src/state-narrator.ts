/**
 * State narration: while on, the tutor says what is happening at the current execution state in one short
 * sentence, and again each time the state changes. The request is sent silently (no user bubble); the reply
 * shows in the chat and is spoken like any other. Changes are coalesced: speech for the old state stops at
 * once, the request waits for the state to settle (adaptive-settle: almost at once after a pause, longer and
 * longer while the learner steps quickly or scrubs back and forth), and only one request is ever in flight,
 * re-sent after it if the state moved meanwhile.
 */
import { createSettler } from '/adaptive-settle.js';

/** The request names where the learner is, so a move to another scene is never answered from the history. */
function prompt(where: string): string {
    return `Narrate the current execution state in ONE short sentence. The learner is now at: ${where}. `
        + "Describe what is happening at exactly this state, using the specific values on screen for it. If this is a "
        + "different scene or step from your previous narration, describe this one fresh and do not repeat earlier "
        + "narration; otherwise say only what is new. Do not restate the general idea, do not elaborate, and do not ask a question.";
}
// A new scene or step needs longer than a new state to finish rendering its labels: a floor on its wait.
const NEW_VIEW_MS = 1200, RETRY_MS = 700, AFTER_TURN_MS = 100;

export interface Narrator { readonly on: boolean; set(on: boolean): void; stateChanged(): void }

/**
 * `stateKey` names the state shown as `view:position` (view = scene and step), or null when there is nothing to
 * narrate; `describe` says the same for the tutor ("scene …, step …, state 3 of 25").
 */
export function createNarrator(stateKey: () => string | null, describe: () => string): Narrator {
    let on = false, sentKey: string | null = null, inFlight = false;
    const stopSpeech = () => window.algebenchStopTTS?.();
    const settle = createSettler(() => send());
    function send(): void {
        const key = stateKey();
        if (!on || inFlight || key === null || key === sentKey) return;
        inFlight = true; sentKey = key;
        void window.sendChatMessage(prompt(describe()), {silent: true}).then(sent => {
            inFlight = false;
            if (!sent) { sentKey = null; if (on) settle.after(RETRY_MS); return; }   // another turn was in flight
            if (on && stateKey() !== sentKey) settle.after(AFTER_TURN_MS);           // the state moved while we waited
        }, () => { inFlight = false; sentKey = null; });
    }
    return {
        get on() { return on; },
        set(next: boolean) {
            on = next;
            settle.cancel();
            sentKey = null;
            if (on) send(); else stopSpeech();
        },
        stateChanged() {
            if (!on) return;
            const key = stateKey();
            // Every move counts towards the burst, even back to the state already narrated (scrubbing back and
            // forth); only a move away stops the speech, which is still about the state on screen otherwise.
            if (key !== sentKey) stopSpeech();
            const view = (k: string | null) => k?.slice(0, k.lastIndexOf(':'));
            settle.poke(view(key) === view(sentKey) ? 0 : NEW_VIEW_MS);
        },
    };
}
