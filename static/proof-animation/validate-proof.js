// validate-proof.js — whitelist validation for proof-animation JSON.
//
// Shared by the standalone /renderproof page (renderproof.js) and the in-app
// pre-baked proof loader (graph-view.js → SgProofManager). Every proof JSON is
// treated as hostile input (hand-edited or third-party): this whitelists fields
// and caps sizes, returning a clean object the ProofAnimator can consume.
//
// No side effects on import (unlike renderproof.js, whose body calls main()), so
// it's safe to import from any module. Runtime is browser-only, though:
// cleanDeeplink() reads `location.origin` to resolve host-relative deeplinks, so a
// non-browser caller (e.g. a Node unit test) must polyfill `location`.

const MAX_STEPS = 300;
const MAX_TERMS = 2000;
const MAX_STR = 50000;          // generous per-field cap (annotated latex is long)

/** Coerce a value to a bounded string (defends against huge / non-string fields). */
export function str(v) {
  if (v == null) return "";
  return String(v).slice(0, MAX_STR);
}

/**
 * Sanitize a proof "deeplink" — the full-app view an "Ask AI" opens. Hostile
 * input, so allow ONLY a same-origin RELATIVE form: a leading "/" path or a bare
 * "?query". Reject any scheme (javascript:, data:, http:), protocol-relative
 * "//host", and off-origin URLs; drop the hash. Returns "pathname + search", or
 * undefined. (Origin = the CURRENT page's, so it validates against wherever this
 * runs — the renderproof page or the app, both same app origin.)
 */
export function cleanDeeplink(v) {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s || s.length > 1024) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return undefined;   // any scheme → reject
  if (s.startsWith("//")) return undefined;               // protocol-relative
  if (!(s.startsWith("/") || s.startsWith("?"))) return undefined;
  try {
    const u = new URL(s, location.origin);
    if (u.origin !== location.origin) return undefined;
    return u.pathname + u.search;                         // normalized, hash dropped
  } catch (e) { return undefined; }
}

/** Shallow-sanitize a confidence object: keep known keys, primitives only. */
export function cleanConfidence(c) {
  if (!c || typeof c !== "object") return undefined;
  const out = {};
  for (const k of ["tier", "label", "icon", "meaning", "relation", "reason"]) {
    if (c[k] != null) out[k] = str(c[k]);
  }
  if (typeof c.type_consistent === "boolean") out.type_consistent = c.type_consistent;
  if (typeof c.endpoint_reached === "boolean") out.endpoint_reached = c.endpoint_reached;
  if (c.counts && typeof c.counts === "object") {
    out.counts = {};
    for (const [k, n] of Object.entries(c.counts)) {
      if (typeof n === "number" && isFinite(n)) out.counts[str(k)] = n;
    }
  }
  return out;
}

/**
 * Whitelist-validate a proof payload into a clean object the engine can consume.
 * Throws on anything structurally wrong. Unknown keys are simply dropped.
 */
export function validateProofData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("proof must be a JSON object");
  }
  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    throw new Error("proof has no steps");
  }
  if (data.steps.length > MAX_STEPS) {
    throw new Error(`too many steps (${data.steps.length} > ${MAX_STEPS})`);
  }
  const steps = data.steps.map((s, i) => {
    if (!s || typeof s !== "object") throw new Error(`step ${i} is not an object`);
    const out = {
      index: typeof s.index === "number" && isFinite(s.index) ? s.index : i,
      operation: str(s.operation),
      justification: str(s.justification),
      input_latex: str(s.input_latex),
      latex: str(s.latex),
      plain: str(s.plain),
      confidence: cleanConfidence(s.confidence),
    };
    // Optional per-step deeplink override (where an "Ask AI" on this step lands).
    const dl = cleanDeeplink(s.deeplink);
    if (dl) out.deeplink = dl;
    return out;
  });

  const terms = {};
  if (data.terms && typeof data.terms === "object" && !Array.isArray(data.terms)) {
    let n = 0;
    for (const [id, t] of Object.entries(data.terms)) {
      if (n++ >= MAX_TERMS) break;
      if (!t || typeof t !== "object") continue;
      terms[str(id)] = { latex: str(t.latex), name: str(t.name), description: str(t.description) };
    }
  }

  const out = {
    title: str(data.title),
    domain: str(data.domain),
    steps,
    terms,
    overall_confidence: cleanConfidence(data.overall_confidence),
  };
  // Optional model-produced framing, prerequisites, and agentic follow-up prompts.
  if (data.goal) out.goal = str(data.goal);
  const strList = (v) => Array.isArray(v)
    ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, 8).map(str) : undefined;
  if (strList(data.followups)) out.followups = strList(data.followups);
  if (strList(data.prerequisites)) out.prerequisites = strList(data.prerequisites);
  // Optional proof-level deeplink (where an "Ask AI" lands by default — overridden
  // per-step). Sanitized to a same-origin relative URL; dropped if malformed.
  const dl = cleanDeeplink(data.deeplink);
  if (dl) out.deeplink = dl;
  return out;
}
