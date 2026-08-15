//#region src/expert-client.js
var ExpertError = class extends Error {
	constructor(message, { status = 0, retryAfter = null, detail = null, timedOut = false } = {}) {
		super(message);
		this.name = "ExpertError";
		this.status = status;
		this.retryAfter = retryAfter;
		this.detail = detail;
		this.timedOut = timedOut;
	}
};
var DERIVE_TIMEOUT_MS = 36e4;
async function invokeExpert(name, body, { timeoutMs = 0 } = {}) {
	let res;
	const ctrl = timeoutMs > 0 ? new AbortController() : null;
	const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
	try {
		res = await fetch(`/api/expert/${encodeURIComponent(name)}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body || {}),
			signal: ctrl ? ctrl.signal : void 0
		});
	} catch (_e) {
		if (ctrl && ctrl.signal.aborted) throw new ExpertError("This derivation took too long and was stopped — try again.", {
			status: 0,
			timedOut: true
		});
		throw new ExpertError("Could not reach the server.", { status: 0 });
	} finally {
		if (timer) clearTimeout(timer);
	}
	let data = null;
	try {
		data = await res.json();
	} catch (_e) {}
	if (!res.ok) {
		if (res.status === 429) throw new ExpertError("Too many requests — please slow down and try again shortly.", {
			status: 429,
			retryAfter: Number(res.headers.get("Retry-After")) || null
		});
		const detail = data && data.detail;
		let msg = data && typeof data.error === "string" && data.error || `Request failed (${res.status}).`;
		if (res.status === 422 && Array.isArray(detail) && detail.length) {
			const d = detail[0];
			const loc = Array.isArray(d.loc) ? d.loc.filter((x) => x !== "body").join(".") : "";
			msg = loc ? `${loc}: ${d.msg}` : d.msg || msg;
		}
		throw new ExpertError(msg, {
			status: res.status,
			detail
		});
	}
	return data;
}
//#endregion
export { ExpertError as n, invokeExpert as r, DERIVE_TIMEOUT_MS as t };

//# sourceMappingURL=expert-client.js.map