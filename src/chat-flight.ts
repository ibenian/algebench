// Single-flight chat sends — a second request never races the first on the
// same history. What happens to a call made while a turn is in flight depends
// on who sees it:
//   - a visible ask (the Commentate control, proof Explore, a deep-link ask)
//     is queued and sent once the chat is free, so a click is never lost; the
//     same text already in flight or waiting shares that turn (a double-click
//     sends once);
//   - a silent ask is turned away (resolves `false`), since its caller counts
//     only accepted asks (the quiz's hint ladder).
// Each call resolves `true` once its turn — queued or not — has finished.

/** `noTools`: a text-only turn — the server offers no tools and treats the
 *  message as nothing but a question (the learning plan's guide). */
export interface SendOptions { silent?: boolean; noTools?: boolean }
export type SendTurn = (text: string, opts: { silent: boolean; noTools: boolean }) => Promise<void>;
export type ChatSender = (text: string, opts?: SendOptions) => Promise<boolean>;

export function singleFlightSender(isBusy: () => boolean, sendTurn: SendTurn): ChatSender {
    // A turn is the same turn only with the same text AND the same tool
    // permission: a text-only (noTools) ask must never share, or be replayed
    // as, a turn that may act on the app.
    const queued: Array<{ text: string; noTools: boolean; done: Promise<boolean>; resolve: (ok: boolean) => void }> = [];
    let active: { text: string; noTools: boolean; done: Promise<boolean> } | null = null;   // the visible turn in flight

    function sendNext(): void {
        const next = queued.shift();
        if (next) void send(next.text, { noTools: next.noTools }).then(next.resolve, () => next.resolve(false));
    }

    function send(text: string, { silent = false, noTools = false }: SendOptions = {}): Promise<boolean> {
        if (isBusy()) {
            if (silent) return Promise.resolve(false);
            if (active && active.text === text && active.noTools === noTools) return active.done;
            const waiting = queued.find((q) => q.text === text && q.noTools === noTools);
            if (waiting) return waiting.done;
            let resolve!: (ok: boolean) => void;
            const done = new Promise<boolean>((r) => { resolve = r; });
            queued.push({ text, noTools, done, resolve });
            return done;
        }
        const turn = { text, noTools, done: Promise.resolve(false) };
        const settle = () => { if (active === turn) active = null; sendNext(); };
        turn.done = sendTurn(text, { silent, noTools }).then(
            () => { settle(); return true; },
            (err: unknown) => { settle(); throw err; },
        );
        if (!silent) active = turn;
        return turn.done;
    }

    return send;
}
