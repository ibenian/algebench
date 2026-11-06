/**
 * Type-along scoring (code-practice.ts): how closely what a learner types matches the lesson's code, line by
 * line, section by section and over the whole running block. Pure, so the rules are testable on their own.
 *
 * A typed line is paired with a reference line by an alignment that keeps both in order, so a skipped or an
 * extra line costs only itself. A pair scores its similarity: 1 for the same code, spacing aside, else the
 * edit-distance ratio. A reference line the learner could see in the Code panel while
 * practising counts for at most PEEK_FACTOR of that, one written in pair programming (Pair with me: the assistant
 * started it, the learner finished it) for the share of it the learner typed, and one the AI assistant typed (Help
 * me) for at most ASSIST_FACTOR: typing it from memory is what scores in full.
 */
import type { CodeSection } from '/code-sections.js';

/** The most a line seen in the Code panel can score. */
export const PEEK_FACTOR = 0.5;
/** The most a line the AI assistant typed can score. */
export const ASSIST_FACTOR = 0.1;
/** Less alike than this, a typed line is not taken for the reference line. */
export const MIN_MATCH = 0.4;

/** Blank and comment-only lines carry no score: nobody has to type them. */
export function isNeutral(text: string): boolean {
    const t = text.trim();
    return !t || t.startsWith('#') || t.startsWith('//');
}

/** A line without its trailing comment: nobody types those from memory. */
export const codeOf = (s: string) => s.replace(/\s+(#|\/\/).*$/, '').trimEnd();
const squeeze = (s: string) => s.replace(/\s+/g, '');

/** Levenshtein distance, two rows at a time. */
function distance(a: string, b: string): number {
    let prev = Array.from({length: b.length + 1}, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = row;
    }
    return prev[b.length]!;
}

/**
 * How alike a typed line is to a reference line, 0 to 1. Whitespace is ignored, as are trailing comments: 1 means
 * the same code. Nesting is judged by alignLines, by depth rather than spaces.
 */
export function similarity(typed: string, reference: string): number {
    const a = squeeze(codeOf(typed)), b = squeeze(codeOf(reference));
    if (!a || !b) return 0;
    if (a === b) return 1;
    return Math.min(0.95, 1 - distance(a, b) / Math.max(a.length, b.length));
}

export interface Pair { typed: number; reference: number; similarity: number }

/** A line typed right but at another nesting depth (`return False` inside the `if`, not after the loop) is not exact. */
export const OTHER_DEPTH = 0.9;

const indentOf = (s: string) => s.replace(/\t/g, '    ').search(/\S/);
/**
 * Each line's nesting depth, read the way Python reads blocks: a line indented past the one above opens a level,
 * a line indented less closes levels until it fits. Depth so counts levels, not spaces, so the learner may indent
 * by another width (2 spaces against 4), or one line a space off, and still nest the same way. Neutral lines
 * (blank, comment) neither open nor close a level.
 */
function depths(lines: readonly string[]): number[] {
    const open = [0];
    return lines.map(l => {
        if (isNeutral(l)) return open.length - 1;
        const indent = Math.max(0, indentOf(l));
        while (indent < open[open.length - 1]!) open.pop();
        if (indent > open[open.length - 1]!) open.push(indent);
        return open.length - 1;
    });
}

/**
 * The best in-order pairing of typed lines with reference lines (indices into each list), skipping neutral
 * lines on both sides: the most total similarity, each pair at least MIN_MATCH alike. A pair at different
 * nesting depths counts OTHER_DEPTH of its similarity, so it is never exact and a pairing that nests alike wins.
 */
export function alignLines(reference: readonly string[], typed: readonly string[]): Pair[] {
    // Absolute depths: the block is a top-level function (the Code panel's running block), typed from column 0.
    const rd = depths(reference), td = depths(typed);
    const r = reference.map((t, i) => [t, i] as const).filter(([t]) => !isNeutral(t));
    const u = typed.map((t, i) => [t, i] as const).filter(([t]) => !isNeutral(t));
    const best = Array.from({length: r.length + 1}, () => new Array<number>(u.length + 1).fill(0));
    const sim = r.map(([a, i]) => u.map(([b, j]) => similarity(b, a) * (rd[i] === td[j] ? 1 : OTHER_DEPTH)));
    for (let i = 1; i <= r.length; i++) for (let j = 1; j <= u.length; j++) {
        const s = sim[i - 1]![j - 1]!;
        best[i]![j] = Math.max(best[i - 1]![j]!, best[i]![j - 1]!, s >= MIN_MATCH ? best[i - 1]![j - 1]! + s : -1);
    }
    const pairs: Pair[] = [];
    for (let i = r.length, j = u.length; i > 0 && j > 0;) {
        const s = sim[i - 1]![j - 1]!;
        if (s >= MIN_MATCH && best[i]![j] === best[i - 1]![j - 1]! + s) { pairs.push({typed: u[j - 1]![1], reference: r[i - 1]![1], similarity: s}); i--; j--; }
        else if (best[i]![j] === best[i - 1]![j]) i--;
        else j--;
    }
    return pairs.reverse();
}

/** `share`: for a line written in pair programming, the part of it the learner typed (0..1); 1 otherwise. */
export interface LineScore { line: number; typed: number | null; similarity: number; peeked: boolean; assisted: boolean; paired: boolean; share: number; score: number }
export interface TypedLine { reference: number | null; similarity: number; exact: boolean; neutral: boolean }
export interface SectionScore { id: string; title: string; from: number; to: number; score: number; lines: number }
/** `renamed`: the learner's own names for the code's were read as the code's (see ownNames). */
export interface PracticeScore { lines: LineScore[]; typed: TypedLine[]; sections: SectionScore[]; total: number; typedAll: boolean; renamed: boolean }

const mean = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;

/**
 * Score what was typed against the block of reference code starting at file line `first`. `peeked` holds the
 * file lines that were on screen, `assisted` those the AI assistant typed, `paired` those written in pair
 * programming, each with the share of it the learner typed; `sections` are the file's, and those inside the block
 * are scored too. An AI-typed line scores ASSIST_FACTOR; a paired one its share (or, seen too, the lower of the two).
 * `typedAll` says every line was typed exactly, seen or not.
 */
export function scorePractice(reference: string, first: number, typedText: string, peeked: ReadonlySet<number>, sections: readonly CodeSection[] = [],
    assisted: ReadonlySet<number> = new Set(), paired: ReadonlyMap<number, number> = new Map()): PracticeScore {
    const own = ownNames(reference, typedText);
    const ref = reference.split('\n'), typed = own.text.split('\n');
    const pairs = alignLines(ref, typed);
    const byRef = new Map(pairs.map(p => [p.reference, p]));
    const lines: LineScore[] = [];
    ref.forEach((text, i) => {
        if (isNeutral(text)) return;
        const pair = byRef.get(i), line = first + i, helped = assisted.has(line), together = !helped && paired.has(line);
        const share = together ? Math.max(0, Math.min(1, paired.get(line)!)) : 1;
        const seen = !helped && !together && peeked.has(line);
        const s = pair?.similarity ?? 0;
        const factor = helped ? ASSIST_FACTOR : together ? Math.min(share, peeked.has(line) ? PEEK_FACTOR : 1) : seen ? PEEK_FACTOR : 1;
        lines.push({line, typed: pair ? pair.typed : null, similarity: s, peeked: seen, assisted: helped, paired: together, share,
            score: Math.round(100 * s * factor)});
    });
    const byTyped = new Map(pairs.map(p => [p.typed, p]));
    const typedLines: TypedLine[] = typed.map((text, j) => {
        const pair = byTyped.get(j);
        return {reference: pair ? first + pair.reference : null, similarity: pair?.similarity ?? 0, exact: pair?.similarity === 1, neutral: isNeutral(text)};
    });
    const last = first + ref.length - 1;
    const scored = sections.filter(s => s.from >= first && s.to <= last).map(s => {
        const inside = lines.filter(l => l.line >= s.from && l.line <= s.to);
        return {id: s.id, title: s.title, from: s.from, to: s.to, score: mean(inside.map(l => l.score)), lines: inside.length};
    }).filter(s => s.lines > 0);
    return {lines, typed: typedLines, sections: scored, total: mean(lines.map(l => l.score)), typedAll: lines.length > 0 && lines.every(l => l.similarity === 1),
        renamed: own.renamed};
}

/**
 * The section the learner is on: the one holding the reference line paired with the cursor's line, else the
 * one after the last paired line above the cursor (where they will go next), else the first.
 */
export function focusSection(score: PracticeScore, cursor: number, sections: readonly CodeSection[]): CodeSection | null {
    const within = (line: number) => sections.find(s => line >= s.from && line <= s.to) ?? null;
    const here = score.typed[cursor]?.reference;
    if (here != null) return within(here);
    let above: number | null = null;
    for (let j = Math.min(cursor, score.typed.length - 1); j >= 0 && above == null; j--) above = score.typed[j]?.reference ?? null;
    const next = score.lines.find(l => (above == null || l.line > above) && within(l.line));
    return next ? within(next.line) : null;
}

/**
 * Finish this line, with the cursor on typed line `j` of `typedText`: the text with that line as the reference
 * (`reference`, from file line `first`) has it, indentation and all; null when there is no line to finish. On a
 * blank or unrecognised line, the line to finish is the first one not yet right; when the learner already has an
 * attempt at it on another line, that attempt is what gets finished, and the blank line the cursor sat on goes, so
 * the fix lands on their line instead of beside it.
 */
export function finishLine(reference: string, first: number, typedText: string, j: number, score: PracticeScore): string | null {
    const ref = reference.split('\n'), lines = typedText.split('\n'), paired = score.typed[j]?.reference;
    if (paired != null) {
        const want = ref[paired - first];
        if (want == null) return null;
        lines[j] = want;
        return lines.join('\n');
    }
    const next = score.lines.find(l => l.similarity < 1), want = next ? ref[next.line - first] : undefined;
    if (!next || want == null) return null;
    if (next.typed != null && next.typed !== j) {
        lines[next.typed] = want;
        if (!lines[j]?.trim()) lines.splice(j, 1);
    } else lines[j] = want;
    return lines.join('\n');
}

// Names that are the language's, not the code's: a learner writing `max` for `min` is not renaming.
const RESERVED = new Set(('and as assert async await break class continue def del elif else except finally for from global if '
    + 'import in is lambda nonlocal not or pass raise return try while with yield None True False self cls print len range '
    + 'enumerate zip map filter sorted reversed sum min max abs any all int float str bool list dict set tuple type '
    + 'isinstance iter next round divmod pow ord chr hex bin repr hash object super open input heapq collections deque '
    + 'defaultdict Counter math inf function let const var new this typeof instanceof case switch default do of null '
    + 'undefined true false console Math Array Object Map Set String Number JSON Infinity NaN').split(' '));
const TOKEN = /[A-Za-z_]\w*|\d+(?:\.\d+)?|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S/g;
const NAME = /^[A-Za-z_]\w*$/;
interface Tok { text: string; at: number; line: number; renamable: boolean }
function tokens(code: string): Tok[] {
    const out: Tok[] = [];
    code.split('\n').forEach((raw, line) => {
        if (isNeutral(raw)) return;
        const text = codeOf(raw);
        for (const m of text.matchAll(TOKEN)) out.push({text: m[0], at: m.index!, line, renamable: false});
    });
    // A name may be the learner's own unless it is the language's, an attribute (`.append`), or a call to something
    // the code does not define itself (`bisect_left(`): those are typed as they are.
    const defined = new Set<string>();
    out.forEach((t, k) => { if (NAME.test(t.text) && ['def', 'class', 'function'].includes(out[k - 1]?.text ?? '')) defined.add(t.text); });
    out.forEach((t, k) => {
        t.renamable = NAME.test(t.text) && !RESERVED.has(t.text) && out[k - 1]?.text !== '.'
            && (out[k + 1]?.text !== '(' || defined.has(t.text) || ['def', 'class', 'function'].includes(out[k - 1]?.text ?? ''));
    });
    return out;
}

/**
 * The learner's code read with the code's own names: names they chose themselves (`num` for `x`, `singleNumber` for
 * `single_number`), one for one and consistently, are put back so the lines score as the code. The names are read off
 * the lines that are the code so far, token for token, up to the first that isn't: a later line being wrong takes
 * nothing from the lines before it. A code name they renamed and then used anyway isn't the code's: it won't match.
 */
export function ownNames(reference: string, typed: string): {text: string; renamed: boolean} {
    const want = tokens(reference), have = tokens(typed);
    if (!have.length) return {text: typed, renamed: false};
    let to = new Map<string, string>(), from = new Map<string, string>();
    let whole = new Map<string, string>(), line = have[0]!.line;
    for (let k = 0; k < have.length; k++) {
        const a = have[k]!, b = want[k];
        if (a.line !== line) { whole = new Map(to);line = a.line; }
        if (b && a.text === b.text && !b.renamable) continue;
        const fits = !!b && b.renamable && NAME.test(a.text) && !RESERVED.has(a.text)
            && (to.get(a.text) ?? b.text) === b.text && (from.get(b.text) ?? a.text) === a.text;
        if (!fits) {
            // The last token may be a name still being typed: the code before it is what counts. Elsewhere this
            // line isn't the code, and what it seemed to say about names goes with it.
            if (k !== have.length - 1) to = whole;
            break;
        }
        to.set(a.text, b!.text);from.set(b!.text, a.text);
    }
    if ([...to].every(([a, b]) => a === b)) return {text: typed, renamed: false};
    const away = new Set([...to].filter(([a, b]) => a !== b).map(([, b]) => b));
    // Put the code's names in, right to left on each line so the positions stay true.
    const lines = typed.split('\n');
    for (const t of [...have].reverse()) {
        const name = to.get(t.text) ?? (t.renamable && away.has(t.text) ? `${t.text}\u2032` : undefined);
        if (name === undefined || name === t.text || !NAME.test(t.text)) continue;
        const l = lines[t.line]!;
        lines[t.line] = l.slice(0, t.at) + name + l.slice(t.at + t.text.length);
    }
    return {text: lines.join('\n'), renamed: true};
}

/**
 * The empty lines at the end of the code, tidied while pairing: only the one the cursor is on stays, with its
 * indentation, for the line being written; with the cursor higher up, none do. Returns the range to replace, what
 * goes there and where the cursor lands, or null when there is nothing to tidy.
 */
export function trimTrailingBlanks(text: string, caret: number): {from: number; to: number; insert: string; caret: number} | null {
    const lines = text.split('\n');
    let first = lines.length;
    while (first > 0 && !lines[first - 1]!.trim()) first--;
    const run = lines.length - first;
    if (!run) return null;
    const at = text.slice(0, caret).split('\n').length - 1;
    const head = lines.slice(0, first).join('\n');
    const from = head.length, to = text.length;
    if (at < first) return {from, to, insert: '', caret};
    const column = caret - (text.lastIndexOf('\n', caret - 1) + 1);
    const insert = (first ? '\n' : '') + lines[at]!;
    if (run === 1) return null;
    return {from, to, insert, caret: from + (first ? 1 : 0) + column};
}

