// validate-proof.ts — whitelist validation for proof-animation JSON.
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
// The model's declared claim for the transition into a step. Carried through
// (not dropped as an unknown key) because the stored proof is re-graded offline
// later, and without the claim every mislabel downgrade silently disappears —
// issue #542. Whitelisted against the DerivationStep enum: it is a grading input,
// so an arbitrary string has no business reaching the store.
const CHANGE_TYPES: ReadonlySet<unknown> = new Set(
  ["rewrite", "solve", "substitute", "approximate", "given"]);

/** The whitelisted `change_type` values — the DerivationStep enum. */
export type ChangeType = "rewrite" | "solve" | "substitute" | "approximate" | "given";

/** Hostile JSON, read key by key: every value is untrusted until coerced. */
type RawObject = Record<string, unknown>;

/** A sanitized confidence block: known keys only, primitives only. */
export interface CleanConfidence {
  tier?: string;
  label?: string;
  icon?: string;
  meaning?: string;
  relation?: string;
  reason?: string;
  type_consistent?: boolean;
  judged?: true;
  endpoint_reached?: boolean;
  counts?: Record<string, number>;
}

/** A sanitized proof step. */
export interface CleanStep {
  index: number;
  operation: string;
  justification: string;
  input_latex: string;
  latex: string;
  plain: string;
  confidence: CleanConfidence | undefined;
  change_type?: ChangeType;
  deeplink?: string;
}

/** A sanitized term-glossary entry. */
export interface CleanTerm {
  latex: string;
  name: string;
  description: string;
}

/** A followup/prerequisite chip carrying its own landing view. */
export interface CleanChip {
  text: string;
  deeplink?: string;
}

/** The clean object the ProofAnimator consumes. */
export interface CleanProof {
  title: string;
  domain: string;
  steps: CleanStep[];
  terms: Record<string, CleanTerm>;
  overall_confidence: CleanConfidence | undefined;
  goal?: string;
  followups?: Array<string | CleanChip>;
  prerequisites?: Array<string | CleanChip>;
  deeplink?: string;
}

/** Coerce a value to a bounded string (defends against huge / non-string fields). */
export function str(v: unknown): string {
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
export function cleanDeeplink(v: unknown): string | undefined {
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
export function cleanConfidence(c: unknown): CleanConfidence | undefined {
  if (!c || typeof c !== "object") return undefined;
  const src = c as RawObject;
  const out: CleanConfidence = {};
  for (const k of ["tier", "label", "icon", "meaning", "relation", "reason"] as const) {
    if (src[k] != null) out[k] = str(src[k]);
  }
  if (typeof src.type_consistent === "boolean") out.type_consistent = src.type_consistent;
  // Provenance: this tier came from the LM domain judge, not the CAS. Kept so an
  // offline re-grade preserves the step instead of demoting it (#542).
  if (src.judged === true) out.judged = true;
  if (typeof src.endpoint_reached === "boolean") out.endpoint_reached = src.endpoint_reached;
  if (src.counts && typeof src.counts === "object") {
    const counts: Record<string, number> = {};
    out.counts = counts;
    for (const [k, n] of Object.entries(src.counts as RawObject)) {
      if (typeof n === "number" && isFinite(n)) counts[str(k)] = n;
    }
  }
  return out;
}

/** Whether an untrusted value is one of the whitelisted change types. */
function isChangeType(v: unknown): v is ChangeType {
  return CHANGE_TYPES.has(v);
}

/**
 * Whitelist-validate a proof payload into a clean object the engine can consume.
 * Throws on anything structurally wrong. Unknown keys are simply dropped.
 */
export function validateProofData(data: unknown): CleanProof {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("proof must be a JSON object");
  }
  const raw = data as RawObject;
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new Error("proof has no steps");
  }
  if (raw.steps.length > MAX_STEPS) {
    throw new Error(`too many steps (${raw.steps.length} > ${MAX_STEPS})`);
  }
  const rawSteps: unknown[] = raw.steps;
  const steps = rawSteps.map((s, i): CleanStep => {
    if (!s || typeof s !== "object") throw new Error(`step ${i} is not an object`);
    const src = s as RawObject;
    const out: CleanStep = {
      index: typeof src.index === "number" && isFinite(src.index) ? src.index : i,
      operation: str(src.operation),
      justification: str(src.justification),
      input_latex: str(src.input_latex),
      latex: str(src.latex),
      plain: str(src.plain),
      confidence: cleanConfidence(src.confidence),
    };
    if (isChangeType(src.change_type)) out.change_type = src.change_type;
    // Optional per-step deeplink override (where an "Ask AI" on this step lands).
    const dl = cleanDeeplink(src.deeplink);
    if (dl) out.deeplink = dl;
    return out;
  });

  const terms: Record<string, CleanTerm> = {};
  if (raw.terms && typeof raw.terms === "object" && !Array.isArray(raw.terms)) {
    let n = 0;
    for (const [id, t] of Object.entries(raw.terms as RawObject)) {
      if (n++ >= MAX_TERMS) break;
      if (!t || typeof t !== "object") continue;
      const term = t as RawObject;
      terms[str(id)] = { latex: str(term.latex), name: str(term.name), description: str(term.description) };
    }
  }

  const out: CleanProof = {
    title: str(raw.title),
    domain: str(raw.domain),
    steps,
    terms,
    overall_confidence: cleanConfidence(raw.overall_confidence),
  };
  // Optional model-produced framing, prerequisites, and agentic follow-up prompts.
  if (raw.goal) out.goal = str(raw.goal);
  // Each entry is a plain string, or {text, deeplink} to give that chip its own
  // landing view (sanitized like the proof-level deeplink; dropped if malformed).
  const chipList = (v: unknown): Array<string | CleanChip> | undefined => {
    if (!Array.isArray(v)) return undefined;
    const items: Array<string | CleanChip> = [];
    for (const x of v as unknown[]) {
      if (items.length >= 8) break;
      if (typeof x === "string" && x.trim()) { items.push(str(x)); continue; }
      if (x && typeof x === "object") {
        const src = x as RawObject;
        if (typeof src.text === "string" && src.text.trim()) {
          const chip: CleanChip = { text: str(src.text) };
          const cdl = cleanDeeplink(src.deeplink);
          if (cdl) chip.deeplink = cdl;
          items.push(chip);
        }
      }
    }
    return items.length ? items : undefined;
  };
  const followups = chipList(raw.followups);
  if (followups) out.followups = followups;
  const prerequisites = chipList(raw.prerequisites);
  if (prerequisites) out.prerequisites = prerequisites;
  // Optional proof-level deeplink (where an "Ask AI" lands by default — overridden
  // per-step). Sanitized to a same-origin relative URL; dropped if malformed.
  const dl = cleanDeeplink(raw.deeplink);
  if (dl) out.deeplink = dl;
  return out;
}
