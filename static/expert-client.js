// Generic client for the backend expert/handler endpoint.
//
//   POST /api/expert/{name}   body: JSON   ->   parsed JSON
//
// Mirrors the generic backend dispatcher: any registered expert or handler is
// callable by name with no per-feature fetch code. Throws ExpertError (with
// .status and .retryAfter) on a non-2xx response.

export class ExpertError extends Error {
    constructor(message, { status = 0, retryAfter = null, detail = null } = {}) {
        super(message);
        this.name = 'ExpertError';
        this.status = status;
        this.retryAfter = retryAfter;   // seconds, from a 429 Retry-After header
        this.detail = detail;
    }
}

export async function invokeExpert(name, body) {
    let res;
    try {
        res = await fetch(`/api/expert/${encodeURIComponent(name)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body || {}),
        });
    } catch (_e) {
        throw new ExpertError('Could not reach the server.', { status: 0 });
    }

    let data = null;
    try { data = await res.json(); } catch (_e) { /* tolerate non-JSON bodies */ }

    if (!res.ok) {
        if (res.status === 429) {
            const retryAfter = Number(res.headers.get('Retry-After')) || null;
            throw new ExpertError('Too many requests — please slow down and try again shortly.',
                                  { status: 429, retryAfter });
        }
        const detail = data && data.detail;
        let msg = (data && typeof data.error === 'string' && data.error) || `Request failed (${res.status}).`;
        // For a 422 (validation), surface the first field error so it's debuggable.
        if (res.status === 422 && Array.isArray(detail) && detail.length) {
            const d = detail[0];
            const loc = Array.isArray(d.loc) ? d.loc.filter(x => x !== 'body').join('.') : '';
            msg = loc ? `${loc}: ${d.msg}` : (d.msg || msg);
        }
        throw new ExpertError(msg, { status: res.status, detail });
    }
    return data;
}
