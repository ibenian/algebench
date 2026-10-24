/**
 * The executing line's move, drawn in the code panel's gutter: when one marked line gives way to another in the
 * same file, an arrow arcs beside the line numbers from the old line to the new one, and both numbers light up
 * for a moment. Several marked lines, or none, on either side is not a move.
 *
 * A call into a function is different: its arrow, from the call site to the function's entry line, stays until
 * the call returns. A recursive call nests inside its caller, so each waiting call's arrow bows a little
 * further out than the one it was made from, and the gutter shows the call stack's depth.
 */

/** The move from one set of marked lines to the next: one line to a different one, or null. */
export function lineJump(previous: ReadonlySet<number>, next: ReadonlySet<number>): {from: number; to: number} | null {
    if (previous.size !== 1 || next.size !== 1) return null;
    const [from] = previous, [to] = next;
    return from === to ? null : {from: from!, to: to!};
}

/**
 * SVG path for the arrow from y1 down (or up) to y2, both ending at x: a curve that bows left in proportion to
 * its length (up to `bow` px), so adjacent lines get a small hook and arrows nest instead of crossing.
 */
export function jumpArrowPath(x: number, y1: number, y2: number, bow = 28): string {
    return arc(x, y1, y2, callBow(0, Math.abs(y2 - y1), bow));
}

/** The call-site lines of the calls still waiting to return, outermost first, from a callsExpr value. */
export function waitingCalls(value: unknown, lineCount: number): number[] {
    const matrix = value as {toArray?: () => unknown} | null;
    const raw = matrix && typeof matrix.toArray === 'function' ? matrix.toArray() : value;
    if (!Array.isArray(raw)) return [];
    return raw.filter((line): line is number => typeof line === 'number' && Number.isInteger(line) && line >= 1 && line <= lineCount);
}

/**
 * Bow of an arrow spanning `span` px: mostly its length, so a short arrow stays inside a longer one instead of
 * crossing it, plus a little per call depth to part arrows that share both lines. Capped at `max`.
 */
export function callBow(depth: number, span: number, max = 28): number {
    return Math.min(max, 4 + span / 8 + Math.min(depth, 3) * 2);
}

/**
 * How far an arrow's ends reach past their lines' centres, from its bow: an arrow that bows further also reaches
 * further at both ends, so arrows sharing a line nest like brackets instead of crossing, whatever their lengths.
 */
export function endReach(bow: number): number {
    return Math.max(-8, Math.min(8, bow - 16));
}

/** SVG path for a waiting call's arrow, from its call site to the entry line, nested by its bow. */
export function callArrowPath(x: number, y1: number, y2: number, depth: number): string {
    const bow = callBow(depth, Math.abs(y2 - y1)), out = endReach(bow) * Math.sign(y1 - y2);
    return arc(x, y1 + out, y2 - out, bow);
}

/** Bow left by `reach`, then run straight into x for the last LEAD px, so the arrowhead points level at the number. */
function arc(x: number, y1: number, y2: number, reach: number): string {
    const tip = x - LEAD;
    return `M ${x} ${y1} C ${x - reach} ${y1}, ${tip - reach} ${y2}, ${tip} ${y2} L ${x} ${y2}`;
}
const LEAD = 7;

/** Every distinct move between lines in a run's sequence of executing lines, in order of first appearance. */
export function lineTransitions(sequence: readonly number[]): {from: number; to: number}[] {
    const seen = new Set<string>(), out: {from: number; to: number}[] = [];
    for (let i = 1; i < sequence.length; i++) {
        const from = sequence[i - 1]!, to = sequence[i]!, key = `${from}>${to}`;
        if (from !== to && !seen.has(key)) { seen.add(key); out.push({from, to}); }
    }
    return out;
}

/** The moves into and out of one line. */
export function movesAt(moves: readonly {from: number; to: number}[], line: number) {
    return {incoming: moves.filter(m => m.to === line), outgoing: moves.filter(m => m.from === line)};
}

/** How long the arrow and the lit numbers hold before fading (ms). */
export const JUMP_HOLD_MS = 1000;
