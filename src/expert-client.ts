// Generic client for the backend expert/handler endpoint.
//
//   POST /api/expert/{name}   body: JSON   ->   parsed JSON
//
// Mirrors the generic backend dispatcher: any registered expert or handler is
// callable by name with no per-feature fetch code. Throws ExpertError (with
// .status and .retryAfter) on a non-2xx response.

/** The extras an ExpertError carries beyond its message. */
export interface ExpertErrorOptions {
    status?: number;
    retryAfter?: number | null;
    detail?: unknown;
    timedOut?: boolean;
}

export class ExpertError extends Error {
    status: number;
    retryAfter: number | null;
    detail: unknown;
    timedOut: boolean;

    constructor(message: string, { status = 0, retryAfter = null, detail = null, timedOut = false }: ExpertErrorOptions = {}) {
        super(message);
        this.name = 'ExpertError';
        this.status = status;
        this.retryAfter = retryAfter;   // seconds, from a 429 Retry-After header
        this.detail = detail;
        this.timedOut = timedOut;       // true when aborted by the client timeout
    }
}

// How long a caller should wait for a DERIVATION before giving up.
//
// This is a CONTRACT WITH THE BACKEND, not a free choice. The proof-completion
// refine loop budgets itself against it (`_TIME_BUDGET`, default 240s, in
// backend/experts/modules/proof_completion/module.py): it declines to START a
// retry past that mark, but never interrupts an attempt already running, and the
// animation build still has to happen afterwards. So the client must allow the
// budget PLUS a full in-flight attempt PLUS the build — hence the wide margin.
//
// Every derivation caller must use this. /prove used to abort at 150s, BELOW the
// backend's own budget, so a derivation that the server was still legitimately
// working on was killed and reported as "took too long" — the work was thrown
// away at the moment it was most likely to finish.
export const DERIVE_TIMEOUT_MS = 360_000;

/** The error body this client reads, as far as it reads it. */
interface ExpertErrorBody {
    error?: unknown;
    detail?: unknown;
}

/** One FastAPI validation error, as far as the 422 message formatting reads it. */
interface ValidationErrorDetail {
    loc?: unknown;
    msg?: string;
}

// ``opts.timeoutMs`` (>0) aborts the request after that many ms so a hung or
// pathologically slow handler (e.g. an LM derivation that never returns) fails
// with a clear, retryable error instead of spinning forever. 0 = no timeout.
export async function invokeExpert(name: string, body: unknown, { timeoutMs = 0 }: { timeoutMs?: number } = {}): Promise<unknown> {
    let res: Response;
    const ctrl = timeoutMs > 0 ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
        res = await fetch(`/api/expert/${encodeURIComponent(name)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body || {}),
            signal: ctrl ? ctrl.signal : undefined,
        });
    } catch (_e) {
        if (ctrl && ctrl.signal.aborted) {
            throw new ExpertError('This derivation took too long and was stopped — try again.',
                                  { status: 0, timedOut: true });
        }
        throw new ExpertError('Could not reach the server.', { status: 0 });
    } finally {
        if (timer) clearTimeout(timer);
    }

    let data: unknown = null;
    try { data = await res.json(); } catch (_e) { /* tolerate non-JSON bodies */ }

    if (!res.ok) {
        if (res.status === 429) {
            const retryAfter = Number(res.headers.get('Retry-After')) || null;
            throw new ExpertError('Too many requests — please slow down and try again shortly.',
                                  { status: 429, retryAfter });
        }
        const bodyData = data as ExpertErrorBody | null;
        const detail = bodyData && bodyData.detail;
        let msg = (bodyData && typeof bodyData.error === 'string' && bodyData.error) || `Request failed (${res.status}).`;
        // For a 422 (validation), surface the first field error so it's debuggable.
        if (res.status === 422 && Array.isArray(detail) && detail.length) {
            const d = detail[0] as ValidationErrorDetail;
            const loc = Array.isArray(d.loc) ? d.loc.filter((x: unknown) => x !== 'body').join('.') : '';
            msg = loc ? `${loc}: ${d.msg}` : (d.msg || msg);
        }
        throw new ExpertError(msg, { status: res.status, detail });
    }
    return data;
}
