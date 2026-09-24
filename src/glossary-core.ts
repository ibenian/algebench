// Glossary core — term resolution and matching over the markdown SOURCE
// (issue #665). Import-free so the Node test suite can load it without the
// render stack; the browser half (loading, tooltip) lives in glossary.ts.
//
// Matching runs on the original markdown, before it is rendered. Math, code,
// raw HTML tags, links and existing render sentinels are protected regions the
// matcher never sees, so a term can't be matched inside `\mathrm{MAD}`, a
// `code span` or an attribute. Each matched term is swapped for a
// `%%GLOSSARY_<tag>_n%%` sentinel, which survives both renderMarkdown (marked)
// and renderKaTeX, and restoreGlossaryTerms() turns the sentinels into term
// spans in the finished HTML. The tag is random per pass, so text that merely
// looks like a sentinel is never mistaken for one.

import type { GlossaryEntry } from '/types/lesson.js';
export type { GlossaryEntry };

export type Glossary = Record<string, GlossaryEntry>;

/** `{{glossary:KEY}}` or `{{glossary:KEY|shown text}}`. */
export const GLOSSARY_MARKER_RE = /\{\{glossary:([^{}|]+?)(?:\|([^{}]+?))?\}\}/g;

/** A run of source text: plain, or a term linked to a glossary key. */
export interface GlossarySegment {
    text: string;
    key?: string;
}

interface Candidate {
    key: string;
    text: string;
    caseSensitive: boolean;
}

/** A compiled auto-matcher over one glossary at one length threshold. */
export interface GlossaryMatcher {
    re: RegExp;
    byLower: Map<string, Candidate[]>;
}

/** Keep only well-formed entries: an object per key, with string `term`,
 *  `markdown` and `prompt` and a string-only `aliases`. Glossaries come from
 *  lesson JSON and from every imported domain's docs.json, so a malformed
 *  entry must cost that entry, not the render of every scene using it. */
export function sanitizeGlossary(raw: unknown): Glossary {
    const out: Glossary = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [key, e] of Object.entries(raw as Record<string, unknown>)) {
        if (!key.trim() || !e || typeof e !== 'object' || Array.isArray(e)) continue;
        const src = e as Record<string, unknown>;
        const entry: GlossaryEntry = {};
        if (typeof src.term === 'string') entry.term = src.term;
        if (Array.isArray(src.aliases)) entry.aliases = src.aliases.filter((a): a is string => typeof a === 'string');
        if (typeof src.markdown === 'string') entry.markdown = src.markdown;
        if (typeof src.prompt === 'string') entry.prompt = src.prompt;
        out[key] = entry;
    }
    return out;
}

/** Display name of an entry: its `term`, else the key. */
export function glossaryTermName(key: string, entry: GlossaryEntry | undefined): string {
    return (entry && entry.term) || key;
}

/** Resolve an explicit marker's key: exact key first, then any key, term or
 *  alias case-insensitively. Returns the canonical key, or null. */
export function resolveGlossaryKey(glossary: Glossary, raw: string): string | null {
    const name = raw.trim();
    if (!name) return null;
    if (Object.prototype.hasOwnProperty.call(glossary, name)) return name;
    const lower = name.toLowerCase();
    for (const [key, entry] of Object.entries(glossary)) {
        if (!entry || typeof entry !== 'object') continue;
        const names = [key, entry.term, ...(Array.isArray(entry.aliases) ? entry.aliases : [])];
        if (names.some((n) => typeof n === 'string' && n.toLowerCase() === lower)) return key;
    }
    return null;
}

/** Replace every marker with the text it displays — for speech, AI prompts
 *  and anything else that reads the source rather than the rendered page. */
export function stripGlossaryMarkers(text: string): string {
    if (typeof text !== 'string' || text.indexOf('{{glossary:') === -1) return text;
    return text.replace(GLOSSARY_MARKER_RE, (_m, key: string, shown?: string) => (shown || key).trim());
}

// An acronym (no lowercase letter, at least one uppercase) matches its exact
// case only, so `MAD` the estimator never fires on "mad".
function isAcronym(s: string): boolean {
    return !/\p{Ll}/u.test(s) && /\p{Lu}/u.test(s);
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compile the auto-matcher: every key, term and alias at least `threshold`
 *  characters long, longest first so `Gaussian RBF kernel` beats `RBF`.
 *  Returns null when nothing qualifies. */
export function buildGlossaryMatcher(glossary: Glossary, threshold: number): GlossaryMatcher | null {
    const byLower = new Map<string, Candidate[]>();
    for (const [key, entry] of Object.entries(glossary)) {
        if (!entry || typeof entry !== 'object') continue;
        const names = new Set([key, entry.term, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]);
        for (const n of names) {
            if (typeof n !== 'string') continue;
            const text = n.trim();
            if ([...text].length < threshold) continue;
            const lower = text.toLowerCase();
            const list = byLower.get(lower) || [];
            list.push({ key, text, caseSensitive: isAcronym(text) });
            byLower.set(lower, list);
        }
    }
    if (byLower.size === 0) return null;
    const alts = [...byLower.values()]
        .map((list) => list[0]!.text)
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp);
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alts.join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
    return { re, byLower };
}

function autoSegments(text: string, matcher: GlossaryMatcher | null, used: Set<string>): GlossarySegment[] {
    if (!matcher || !text) return text ? [{ text }] : [];
    const out: GlossarySegment[] = [];
    let last = 0;
    matcher.re.lastIndex = 0;
    for (let m = matcher.re.exec(text); m; m = matcher.re.exec(text)) {
        const hit = m[0];
        const cand = (matcher.byLower.get(hit.toLowerCase()) || [])
            .find((c) => !c.caseSensitive || c.text === hit);
        if (!cand || used.has(cand.key)) continue;
        used.add(cand.key);
        if (m.index > last) out.push({ text: text.slice(last, m.index) });
        out.push({ text: hit, key: cand.key });
        last = m.index + hit.length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
}

/** Split one unprotected run of source into plain and term segments.
 *  Explicit markers always link (or fall back to their plain text when
 *  unresolved); automatic matches link only a key's first appearance in
 *  the paragraph, tracked in `used`. */
export function segmentGlossaryText(
    text: string,
    glossary: Glossary,
    matcher: GlossaryMatcher | null,
    used: Set<string>,
): GlossarySegment[] {
    const out: GlossarySegment[] = [];
    let last = 0;
    GLOSSARY_MARKER_RE.lastIndex = 0;
    for (let m = GLOSSARY_MARKER_RE.exec(text); m; m = GLOSSARY_MARKER_RE.exec(text)) {
        out.push(...autoSegments(text.slice(last, m.index), matcher, used));
        const raw = m[1]!;
        const key = resolveGlossaryKey(glossary, raw);
        const shown = (m[2] || raw).trim();
        out.push(key ? { text: shown, key } : { text: shown });
        if (key) used.add(key);
        last = m.index + m[0].length;
    }
    out.push(...autoSegments(text.slice(last), matcher, used));
    return out;
}

// ----- Source pass -----

// Regions of markdown source the matcher must never touch, in priority order:
// fenced code, display math, inline code, inline math, render sentinels
// (`%%MATH_BLOCK_n%%` and friends), images/links (text and URL), autolinks
// and raw HTML tags, reference-style links and definitions, and bare URLs
// (marked autolinks them). A marker inside any of these is left verbatim. Links and
// tags may span lines (`<abbr\n title="MAD">`), so they run to their closing
// delimiter across newlines.
const PROTECTED_RE = new RegExp([
    '```[\\s\\S]*?```',
    '~~~[\\s\\S]*?~~~',
    '\\$\\$[\\s\\S]+?\\$\\$',
    '`+[^`]*?`+',
    '\\$[^$\\n]+\\$',
    '%%[A-Z_]+\\d+%%',
    // inline link or image; the URL may hold one level of balanced parens
    '!?\\[[^\\]]*\\]\\((?:[^()]|\\([^()]*\\))*\\)',
    // reference-style link, and a link reference definition line
    '!?\\[[^\\]]*\\]\\[[^\\]]*\\]',
    '^[ \\t]*\\[[^\\]]+\\]:[^\\n]*',
    '<[a-zA-Z/!][^>]*>',
    // bare URLs, which marked autolinks into an href
    '(?:https?://|www\\.)[^\\s<>]+',
].join('|'), 'gm');

// A paragraph boundary in markdown source: a blank line, or a line break
// before a heading, list item or table row — each renders as its own block,
// so each gets its own first appearance of a term.
const PARAGRAPH_BREAK_RE = /(\n[ \t]*\n\s*|\n(?=[ \t]*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\|)))/;

// Inside math only automatic matching runs, and only on a name set as a whole
// text-style group — `\mathrm{MAD}`, `\operatorname{LOF}`, `\text{base rate}`.
// Bare symbols (`x`, `\nu`) are never touched. A match is wrapped in
// `\htmlClass{glossary-term glossary-k-<tag>-N}{...}`, which KaTeX renders as an
// extra enclosing span without changing the layout; restoreGlossaryTerms()
// then turns the class into a term's attributes.
const MATH_NAME_RE = /\\(?:mathrm|operatorname|text|textrm|textsf|mathsf)\{([^{}]+)\}/g;
const MATH_TERM_CLASS_RE = /class="([^"]*?)\bglossary-term glossary-k-([a-z0-9]+)-(\d+)([^"]*)"/g;

function isMathRegion(region: string): boolean {
    return region.startsWith('$');
}

/** Terms pulled out of one source block, indexed by their sentinel number. */
export type GlossaryTerms = GlossarySegment[] & { tag: string };

/** A fresh, empty term list with its own random sentinel tag. */
export function newGlossaryTerms(tag = 'g' + Math.random().toString(36).slice(2, 10)): GlossaryTerms {
    return Object.assign([] as GlossarySegment[], { tag });
}

/** Replace glossary terms in markdown source with `%%GLOSSARY_n%%` sentinels
 *  (prose) or `\htmlClass` wrappers (names inside math). Automatic matches
 *  link a term once per paragraph; explicit markers are prose-only. */
export function extractGlossaryTerms(
    src: string,
    glossary: Glossary,
    matcher: GlossaryMatcher | null,
): { text: string; terms: GlossaryTerms } {
    const terms = newGlossaryTerms();
    if (!src || (!matcher && src.indexOf('{{glossary:') === -1)) return { text: src, terms };
    let used = new Set<string>();
    const subRun = (plain: string): string => segmentGlossaryText(plain, glossary, matcher, used)
        .map((s) => {
            if (!s.key) return s.text;
            terms.push(s);
            return `%%GLOSSARY_${terms.tag}_${terms.length - 1}%%`;
        })
        .join('');
    // Odd pieces of the split are the paragraph breaks themselves.
    const sub = (plain: string): string => plain.split(PARAGRAPH_BREAK_RE)
        .map((piece, i) => {
            if (i % 2 === 0) return subRun(piece);
            used = new Set<string>();
            return piece;
        })
        .join('');
    const subMath = (math: string): string => math.replace(MATH_NAME_RE, (whole, name: string) => {
        const text = name.trim();
        const cand = (matcher!.byLower.get(text.toLowerCase()) || [])
            .find((c) => !c.caseSensitive || c.text === text);
        if (!cand || used.has(cand.key)) return whole;
        used.add(cand.key);
        terms.push({ text, key: cand.key });
        return `\\htmlClass{glossary-term glossary-k-${terms.tag}-${terms.length - 1}}{${whole}}`;
    });
    let out = '';
    let last = 0;
    PROTECTED_RE.lastIndex = 0;
    for (let m = PROTECTED_RE.exec(src); m; m = PROTECTED_RE.exec(src)) {
        out += sub(src.slice(last, m.index));
        out += matcher && isMathRegion(m[0]) ? subMath(m[0]) : m[0];
        last = m.index + m[0].length;
    }
    out += sub(src.slice(last));
    return { text: out, terms };
}

function escapeHtmlText(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The HTML for one marked term. */
export function glossaryTermHtml(term: GlossarySegment): string {
    const key = escapeHtmlText(term.key || '');
    return `<span class="glossary-term" data-glossary-key="${key}" tabindex="0" role="button" `
        + `aria-haspopup="dialog">${escapeHtmlText(term.text)}</span>`;
}

/** Swap this pass's sentinels in rendered HTML for term spans, and give the
 *  spans KaTeX made for names inside math their term attributes. Only
 *  sentinels carrying `terms.tag` are touched. */
export function restoreGlossaryTerms(html: string, terms: GlossaryTerms): string {
    if (!terms.length) return html;
    const sentinel = new RegExp(`%%GLOSSARY_${terms.tag}_(\\d+)%%`, 'g');
    return html
        .replace(sentinel, (m, idx: string) => {
            const term = terms[+idx];
            return term ? glossaryTermHtml(term) : m;
        })
        .replace(MATH_TERM_CLASS_RE, (m, before: string, tag: string, idx: string, after: string) => {
            const term = tag === terms.tag ? terms[+idx] : undefined;
            if (!term) return m;
            return `class="${before}glossary-term${after}" data-glossary-key="${escapeHtmlText(term.key || '')}" `
                + 'tabindex="0" role="button" aria-haspopup="dialog"';
        });
}

/** Remove the math wrappers from TeX — for the TeX annotation KaTeX keeps,
 *  which is read back as source by speech and Ask AI. */
export function stripGlossaryMath(tex: string): string {
    return tex.replace(/\\htmlClass\{glossary-term glossary-k-[a-z0-9]+-\d+\}\{(\\[a-z]+\{[^{}]+\})\}/g, '$1');
}

// ----- Active glossary -----
//
// One glossary is active at a time — the loaded lesson's — with the current
// scene's match threshold. renderMarkdown / renderKaTeX consult it when a
// caller opts in with `{ glossary: true }`.

const active: { glossary: Glossary; threshold: number | null; matcher: GlossaryMatcher | null; dirty: boolean } = {
    glossary: {}, threshold: null, matcher: null, dirty: false,
};

export function setActiveGlossary(glossary: unknown): void {
    active.glossary = sanitizeGlossary(glossary);
    active.dirty = true;
}

/** `glossaryMatchThreshold` of the current scene. Absent or non-positive
 *  turns automatic matching off; explicit markers still render. */
export function setGlossaryThreshold(n: unknown): void {
    const t = typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
    if (t !== active.threshold) { active.threshold = t; active.dirty = true; }
}

export function getActiveGlossary(): Glossary {
    return active.glossary;
}

/** Extract terms from `src` against the active glossary. */
export function extractActiveGlossaryTerms(src: string): { text: string; terms: GlossaryTerms } {
    if (active.dirty) {
        active.matcher = active.threshold == null ? null : buildGlossaryMatcher(active.glossary, active.threshold);
        active.dirty = false;
    }
    return extractGlossaryTerms(src, active.glossary, active.matcher);
}
