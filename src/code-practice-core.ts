/**
 * Type-along scoring (code-practice.ts): how closely what a learner types matches the lesson's code, line by
 * line, section by section and over the whole running block. Pure, so the rules are testable on their own.
 *
 * A typed line is paired with a reference line by an alignment that keeps both in order, so a skipped or an
 * extra line costs only itself. A pair scores its similarity: 1 for the same code, spacing aside, else the
 * edit-distance ratio. A reference line the learner could see in the Code panel while
 * practising counts for at most PEEK_FACTOR of that, and one the AI assistant typed (Help me) for at most
 * ASSIST_FACTOR: typing it from memory is what scores in full.
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

export interface LineScore { line: number; typed: number | null; similarity: number; peeked: boolean; assisted: boolean; score: number }
export interface TypedLine { reference: number | null; similarity: number; exact: boolean; neutral: boolean }
export interface SectionScore { id: string; title: string; from: number; to: number; score: number; lines: number }
export interface PracticeScore { lines: LineScore[]; typed: TypedLine[]; sections: SectionScore[]; total: number; typedAll: boolean }

const mean = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;

/**
 * Score what was typed against the block of reference code starting at file line `first`. `peeked` holds the
 * file lines that were on screen, `assisted` those the AI assistant typed; `sections` are the file's, and those
 * inside the block are scored too.
 * `typedAll` says every line was typed exactly, seen or not.
 */
export function scorePractice(reference: string, first: number, typedText: string, peeked: ReadonlySet<number>, sections: readonly CodeSection[] = [],
    assisted: ReadonlySet<number> = new Set()): PracticeScore {
    const ref = reference.split('\n'), typed = typedText.split('\n');
    const pairs = alignLines(ref, typed);
    const byRef = new Map(pairs.map(p => [p.reference, p]));
    const lines: LineScore[] = [];
    ref.forEach((text, i) => {
        if (isNeutral(text)) return;
        const pair = byRef.get(i), line = first + i, helped = assisted.has(line), seen = !helped && peeked.has(line);
        const s = pair?.similarity ?? 0;
        lines.push({line, typed: pair ? pair.typed : null, similarity: s, peeked: seen, assisted: helped,
            score: Math.round(100 * s * (helped ? ASSIST_FACTOR : seen ? PEEK_FACTOR : 1))});
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
    return {lines, typed: typedLines, sections: scored, total: mean(lines.map(l => l.score)), typedAll: lines.length > 0 && lines.every(l => l.similarity === 1)};
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
