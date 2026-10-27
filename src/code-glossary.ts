/**
 * A code file's glossary: hyper-comments the Code panel shows on hover. An entry with a `name` documents a
 * variable, function, class or expression key wherever it appears; with `from`–`to` too it documents that name
 * only on those lines, overriding the file-wide entry (a local `cell` that hides the outer one). An entry without
 * a name documents a region: lines `from`–`to` (a block), or columns `col`–`endCol` of line `from` (an expression).
 */
import type { CodeGlossaryEntry } from '/types/lesson.js';
export type { CodeGlossaryEntry } from '/types/lesson.js';

const span = (e: CodeGlossaryEntry) => (e.to ?? e.from ?? 0) - (e.from ?? 0);
const holds = (e: CodeGlossaryEntry, line: number) => e.from !== undefined && line >= e.from && line <= (e.to ?? e.from);

/**
 * The entry documenting the first of `names` that has one at `line` (`g[cell]` before `g`): the narrowest range
 * holding the line, else the file-wide entry. Null when none does.
 */
export function glossaryFor(entries: readonly CodeGlossaryEntry[], names: readonly string[], line: number): CodeGlossaryEntry | null {
    for (const name of names) {
        const own = entries.filter(e => e.name === name);
        const scoped = own.filter(e => holds(e, line)).sort((a, b) => span(a) - span(b))[0];
        const found = scoped ?? own.find(e => e.from === undefined);
        if (found) return found;
    }
    return null;
}

/** Unnamed entries over a column range: expressions, wrapped in the line's code. */
export const glossaryExpressions = (entries: readonly CodeGlossaryEntry[]) =>
    entries.filter(e => !e.name && e.from !== undefined && e.col !== undefined && e.endCol !== undefined && e.endCol > e.col);

/** The narrowest unnamed whole-line entry (a block) holding `line`, or null. */
export function glossaryBlockAt(entries: readonly CodeGlossaryEntry[], line: number): CodeGlossaryEntry | null {
    return entries.filter(e => !e.name && e.col === undefined && holds(e, line)).sort((a, b) => span(a) - span(b))[0] ?? null;
}
