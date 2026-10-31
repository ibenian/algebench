//#region src/language.ts
var DEFAULT_LANGUAGE = "English (US)";
var HEADER = "X-AlgeBench-Language";
var STORAGE_KEY = "algebench.language";
var LANGUAGES = [
	"English (US)",
	"English (UK)",
	"Spanish",
	"Chinese (Simplified)",
	"Hindi",
	"Arabic",
	"French",
	"Bengali",
	"Portuguese",
	"Russian",
	"Urdu",
	"Indonesian",
	"German",
	"Japanese",
	"Turkish",
	"Korean",
	"Vietnamese",
	"Italian",
	"Persian",
	"Polish",
	"Dutch",
	"Swedish",
	"Norwegian",
	"Finnish",
	"Hungarian",
	"Hebrew"
];
/** ``raw`` as a language name: trimmed, single-spaced, at most LANGUAGE_MAX_CHARS characters; the default if empty. */
function cleanLanguage(raw) {
	const text = (raw ?? "").replace(/[^\p{L}\p{N}\s().,'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 20).trim();
	if (!text) return DEFAULT_LANGUAGE;
	return LANGUAGES.find((l) => l.toLowerCase() === text.toLowerCase()) ?? text;
}
var current = DEFAULT_LANGUAGE;
try {
	current = cleanLanguage(localStorage.getItem(STORAGE_KEY));
} catch {}
var listeners = /* @__PURE__ */ new Set();
function getLanguage() {
	return current;
}
/** Make ``raw`` the language (saved, and sent from the next request on); returns the cleaned name. */
function setLanguage(raw) {
	const lang = cleanLanguage(raw);
	if (lang === current) return lang;
	current = lang;
	try {
		localStorage.setItem(STORAGE_KEY, lang);
	} catch {}
	listeners.forEach((fn) => fn(lang));
	return lang;
}
function onLanguageChange(fn) {
	listeners.add(fn);
	return () => listeners.delete(fn);
}
function isApiRequest(url) {
	try {
		const u = new URL(url, location.href);
		return u.origin === location.origin && u.pathname.startsWith("/api/");
	} catch {
		return false;
	}
}
function installLanguageHeader() {
	const w = window;
	if (w.__algebenchLanguageFetch) return;
	w.__algebenchLanguageFetch = true;
	const original = window.fetch.bind(window);
	window.fetch = (input, init) => {
		if (!isApiRequest(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)) return original(input, init);
		const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : void 0));
		headers.set(HEADER, encodeURIComponent(current));
		return original(input, {
			...init,
			headers
		});
	};
}
if (typeof window !== "undefined" && typeof window.fetch === "function") installLanguageHeader();
//#endregion
//#region src/expert-client.ts
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
		const bodyData = data;
		const detail = bodyData && bodyData.detail;
		let msg = bodyData && typeof bodyData.error === "string" && bodyData.error || `Request failed (${res.status}).`;
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
export { getLanguage as a, LANGUAGES as i, ExpertError as n, onLanguageChange as o, invokeExpert as r, setLanguage as s, DERIVE_TIMEOUT_MS as t };

//# sourceMappingURL=expert-client.js.map