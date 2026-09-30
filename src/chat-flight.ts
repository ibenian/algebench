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

export type SendTurn = (text: string, silent: boolean) => Promise<void>;
export type ChatSender = (text: string, opts?: { silent?: boolean }) => Promise<boolean>;

export function singleFlightSender(isBusy: () => boolean, sendTurn: SendTurn): ChatSender {
    const queued: Array<{ text: string; done: Promise<boolean>; resolve: (ok: boolean) => void }> = [];
    let active: { text: string; done: Promise<boolean> } | null = null;   // the visible turn in flight

    function sendNext(): void {
        const next = queued.shift();
        if (next) void send(next.text).then(next.resolve, () => next.resolve(false));
    }

    function send(text: string, { silent = false }: { silent?: boolean } = {}): Promise<boolean> {
        if (isBusy()) {
            if (silent) return Promise.resolve(false);
            if (active && active.text === text) return active.done;
            const waiting = queued.find((q) => q.text === text);
            if (waiting) return waiting.done;
            let resolve!: (ok: boolean) => void;
            const done = new Promise<boolean>((r) => { resolve = r; });
            queued.push({ text, done, resolve });
            return done;
        }
        const turn = { text, done: Promise.resolve(false) };
        const settle = () => { if (active === turn) active = null; sendNext(); };
        turn.done = sendTurn(text, silent).then(
            () => { settle(); return true; },
            (err: unknown) => { settle(); throw err; },
        );
        if (!silent) active = turn;
        return turn.done;
    }

    return send;
}
