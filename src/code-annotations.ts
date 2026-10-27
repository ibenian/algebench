/**
 * A code file's annotations: hyper-comments the Code panel shows on hover. An entry with a `name` documents a
 * variable, function, class or expression key wherever it appears; with `line`–`endLine` too it documents that name
 * only on those lines, overriding the file-wide entry (a local `cell` that hides the outer one). An entry without
 * a name documents a region: lines `line`–`endLine` (a block), or columns `col`–`endCol` of `line` (an expression).
 */
import type { CodeAnnotation } from '/types/lesson.js';
export type { CodeAnnotation } from '/types/lesson.js';

const span = (e: CodeAnnotation) => (e.endLine ?? e.line ?? 0) - (e.line ?? 0);
const holds = (e: CodeAnnotation, line: number) => e.line !== undefined && line >= e.line && line <= (e.endLine ?? e.line);

/**
 * The entry documenting the first of `names` that has one at `line` (`g[cell]` before `g`): the narrowest range
 * holding the line, else the file-wide entry. Null when none does.
 */
export function annotationFor(entries: readonly CodeAnnotation[], names: readonly string[], line: number): CodeAnnotation | null {
    for (const name of names) {
        const own = entries.filter(e => e.name === name);
        const scoped = own.filter(e => holds(e, line)).sort((a, b) => span(a) - span(b))[0];
        const found = scoped ?? own.find(e => e.line === undefined);
        if (found) return found;
    }
    return null;
}

/** Unnamed entries over a column range: expressions, wrapped in the line's code. */
export const annotatedExpressions = (entries: readonly CodeAnnotation[]) =>
    entries.filter(e => !e.name && e.line !== undefined && e.col !== undefined && e.endCol !== undefined && e.endCol > e.col);

/** The narrowest unnamed whole-line entry (a block) holding `line`, or null. */
export function annotatedBlockAt(entries: readonly CodeAnnotation[], line: number): CodeAnnotation | null {
    return entries.filter(e => !e.name && e.col === undefined && holds(e, line)).sort((a, b) => span(a) - span(b))[0] ?? null;
}
