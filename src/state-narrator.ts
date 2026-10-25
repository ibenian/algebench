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
// A reply's speech starts shortly after the reply itself: `busy` holds for SPEECH_START_MS past it.
const NEW_VIEW_MS = 1200, RETRY_MS = 700, AFTER_TURN_MS = 100, SPEECH_START_MS = 800;

export interface Narrator {
    readonly on: boolean;
    /** True until the state on screen has been narrated (answered, or given up on after an error), and briefly
     *  after, while its speech starts. Playback waits on this, and on the speech itself, before moving on. */
    readonly busy: boolean;
    set(on: boolean): void;
    stateChanged(): void;
}

/**
 * `stateKey` names the state shown as `view:position` (view = scene and step), or null when there is nothing to
 * narrate; `describe` says the same for the tutor ("scene …, step …, state 3 of 25"). `opening`, when it returns a
 * request, is sent for the state instead of its narration (a scene's first state introducing the problem).
 */
export function createNarrator(stateKey: () => string | null, describe: () => string,
    opening?: () => (() => Promise<boolean>) | null): Narrator {
    let on = false, sentKey: string | null = null, inFlight = false;
    // doneKey: the last state whose narration finished (answered or failed); answeredAt: when it did.
    let doneKey: string | null = null, answeredAt = 0;
    const stopSpeech = () => window.algebenchStopTTS?.();
    const settle = createSettler(() => send());
    function send(): void {
        const key = stateKey();
        if (!on || inFlight || key === null || key === sentKey) return;
        inFlight = true; sentKey = key;
        // No tools: a narration is one sentence; a tool call (navigate_to, set_sliders) would move the lesson
        // under the learner and stop playback.
        const request = opening?.() ?? (() => window.sendChatMessage(prompt(describe()), {silent: true, noTools: true}));
        void request().then(sent => {
            inFlight = false;
            if (!sent) { sentKey = null; if (on) settle.after(RETRY_MS); return; }   // another turn was in flight
            doneKey = key; answeredAt = Date.now();
            if (on && stateKey() !== sentKey) settle.after(AFTER_TURN_MS);           // the state moved while we waited
        }, () => { inFlight = false; sentKey = null; doneKey = key; answeredAt = 0; });  // failed: don't hold playback
    }
    return {
        get on() { return on; },
        get busy() {
            const key = stateKey();
            if (!on || key === null) return false;
            return inFlight || key !== doneKey || Date.now() - answeredAt < SPEECH_START_MS;
        },
        set(next: boolean) {
            on = next;
            settle.cancel();
            sentKey = null; doneKey = null;
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
