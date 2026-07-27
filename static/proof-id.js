// Submission-id and size rules for the /prove Submit dialog.
//
// These MIRROR the server, which is the authority:
//   * `normalize_id` in backend/proof_api/store.py — _SEG, _DOMAIN_MIN/MAX,
//     _NAME_MIN/MAX, _RESERVED_NAMES
//   * `MAX_PROOF_BYTES` in the same module
// Keep the two in step; anything these let through the server still rejects.
//
// They live in their own module for two reasons: the dialog needs to STATE the
// rules up front rather than only fail them, and the failure messages need to be
// SPECIFIC. The server answers every rule violation with the same opaque
// `{reason: "invalid"}`, so the dialog used to render a length problem, a bad
// character and a genuine collision all as "taken or reserved" — which told a
// user whose name was too long to go pick a different one.

export const ID_DOMAIN_MIN = 2, ID_DOMAIN_MAX = 32;
export const ID_NAME_MIN = 3, ID_NAME_MAX = 64;
export const ID_RESERVED = ["index", "new", "admin", "api", "null", "undefined"];
export const MAX_PROOF_BYTES = 2_000_000;

const SEG = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

// Whitespace and other invisibles get NAMED. Listing them literally is useless —
// a pasted "my proof" reported its offending character as an empty gap, which is
// the one case where the user most needs to be told what is wrong.
const CHAR_NAMES = {
    " ": "space", "\t": "tab", "\n": "line break", "\r": "line break",
    " ": "non-breaking space",
};

/** The distinct not-allowed characters in `s`, rendered so each is visible. */
function illegalChars(s) {
    const seen = [...new Set(s.replace(/[a-z0-9-]/g, ""))];
    return seen.map((c) => CHAR_NAMES[c] || `“${c}”`).join(", ");
}

/**
 * The SPECIFIC reason `raw` is not a usable id, or "" when it is well-formed.
 * `raw` is expected already trimmed and lowercased (the server lowercases too).
 */
export function idProblem(raw) {
    const parts = String(raw || "").split("/");
    if (parts.length !== 2) {
        return parts.length < 2
            ? "Include the domain: <domain>/<name>, e.g. algebra/quadratic-roots."
            : "Use exactly one “/” — <domain>/<name>.";
    }
    const [domain, name] = parts;

    for (const [label, value, min, max] of [
        ["Domain", domain, ID_DOMAIN_MIN, ID_DOMAIN_MAX],
        ["Name", name, ID_NAME_MIN, ID_NAME_MAX],
    ]) {
        if (!value) return `${label} is empty — use <domain>/<name>.`;
        const illegal = illegalChars(value);
        if (illegal) {
            return `${label} has characters that aren't allowed: ${illegal} — `
                 + "only lowercase letters, digits and hyphens.";
        }
        if (value.length < min) {
            return `${label} is too short — at least ${min} characters.`;
        }
        if (value.length > max) {
            return `${label} is too long — at most ${max} characters `
                 + `(yours is ${value.length}).`;
        }
        // Only a leading/trailing hyphen can still fail SEG at this point.
        if (!SEG.test(value)) return `${label} can't start or end with a hyphen.`;
    }
    if (ID_RESERVED.includes(name)) return `“${name}” is a reserved name — pick another.`;
    return "";
}

/** Bytes the proof occupies once serialized as UTF-8, as the server measures it. */
export function proofBytes(proof) {
    try {
        return new TextEncoder().encode(JSON.stringify(proof || {})).length;
    } catch (e) {
        return 0;            // circular / unserializable — the POST fails anyway
    }
}

/** DECIMAL units (1 KB = 1000 B). The cap is a round 2,000,000, so binary units
 *  would render the limit as a puzzling "1.91 MB". */
export function formatBytes(n) {
    if (n < 1000) return `${n} B`;
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)} KB`;
    return `${(n / 1_000_000).toFixed(2)} MB`;
}
