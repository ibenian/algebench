// Single-flight chat sends — a second request never races the first on the
// same history. What happens to a call made while a turn is in flight depends
// on who sees it:
//   - a visible ask (the Commentate control, proof Explore, a deep-link ask)
//     is queued and sent once the chat is free, so a click is never lost; the
//     same text already waiting is not queued twice;
//   - a silent ask is turned away (resolves `false`), since its caller counts
//     only accepted asks (the quiz's hint ladder).
// Each call resolves `true` once its turn — queued or not — has finished.

export type SendTurn = (text: string, silent: boolean) => Promise<void>;
export type ChatSender = (text: string, opts?: { silent?: boolean }) => Promise<boolean>;

export function singleFlightSender(isBusy: () => boolean, sendTurn: SendTurn): ChatSender {
    const queued: Array<{ text: string; done: Promise<boolean>; resolve: (ok: boolean) => void }> = [];

    function sendNext(): void {
        const next = queued.shift();
        if (next) void send(next.text).then(next.resolve, () => next.resolve(false));
    }

    function send(text: string, { silent = false }: { silent?: boolean } = {}): Promise<boolean> {
        if (isBusy()) {
            if (silent) return Promise.resolve(false);
            const waiting = queued.find((q) => q.text === text);
            if (waiting) return waiting.done;
            let resolve!: (ok: boolean) => void;
            const done = new Promise<boolean>((r) => { resolve = r; });
            queued.push({ text, done, resolve });
            return done;
        }
        return sendTurn(text, silent).then(
            () => { sendNext(); return true; },
            (err: unknown) => { sendNext(); throw err; },
        );
    }

    return send;
}
