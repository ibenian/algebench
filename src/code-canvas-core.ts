/**
 * The code canvas: what the agent draws on the code in Type along's focus mode with the presenter on, on its turn. Marks name the code
 * itself (a line, a run of lines, a piece of text on a line) and are laid out here into strokes and words, in the
 * editor's own coordinates. It knows only the code, nothing of the 3D view. Pure, so it is testable; code-canvas.ts paints it.
 */
import { findSelection } from '/code-assist-play.js';
import { edgePoint, shapeStroke, smoothPath } from '/drawing-layout.js';
import { markGeometry } from '/ink-marks.js';

export const MARK_KINDS = ['circle', 'underline', 'box', 'check', 'cross', 'arrow', 'note', 'shape'] as const;
export type MarkKind = typeof MARK_KINDS[number];
export interface CodeMark {
    kind: MarkKind;
    /** What it is on: a line from 1, up to `end_line`, or `text` on that line (a name, a parameter, a sub-expression). */
    line?: number; end_line?: number; text?: string;
    /** An arrow's other end: as above, or the `id` of a shape. */
    to_line?: number; to_end_line?: number; to_text?: string; to_id?: string;
    /** A note's words, or what a shape holds. */
    label?: string;
    /** Its name on the board, given when drawn: how the agent asks for it to go. */
    mid?: string;
    /** A shape's own name and form. */
    id?: string; shape?: string;
    color?: string;
}
export interface Span { fromLine: number; fromCol: number; toLine: number; toCol: number }
export interface Box { left: number; top: number; width: number; height: number; bottom: number }
/** The editor's measures: one character's width, and each line's place (from 0). */
export interface CanvasMetrics { charWidth: number; row(line: number): {left: number; top: number; height: number} | null }
export interface LaidMark {
    /** Which mark it is, from 0. */
    source: number;
    /** Strokes in the order a hand draws them. */
    paths: string[];
    /** A shape's fill behind its strokes (a box round lines). */
    fill?: string;
    /** Words: a note beside the code, or a shape's label in it. */
    text?: {x: number; y: number; words: string; centred: boolean};
    color: string;
}
export interface CanvasLayout { marks: LaidMark[]; width: number; height: number; firstTop: number | null }

/** A mark as the agent is told it is on the board: its name, then what it is and where. */
export function describeMark(mark: CodeMark): string {
    const place = (line?: number, end?: number, text?: string) => [line ? `line ${line}${end && end !== line ? `-${end}` : ''}` : '', text ? `"${text}"` : ''].filter(Boolean).join(' ');
    const to = mark.to_id ? `shape ${mark.to_id}` : place(mark.to_line, mark.to_end_line, mark.to_text);
    return [`${mark.mid ?? '?'}:`, mark.kind === 'shape' ? `${mark.shape || 'rectangle'} shape${mark.id ? ` ${mark.id}` : ''}` : mark.kind,
        place(mark.line, mark.end_line, mark.text), to ? `to ${to}` : '', mark.label ? `"${mark.label}"` : ''].filter(Boolean).join(' ');
}

/** What a mark names: `text` on `line` when both are there, else the lines, from their indentation to their end. */
export function resolveSpan(lines: readonly string[], line = 0, endLine = 0, text = ''): Span | null {
    const source = lines.join('\n');
    if (text.trim()) {
        const at = findSelection(source, text, 0, line);
        if (at) {
            const where = (offset: number) => { const before = source.slice(0, offset).split('\n');return [before.length - 1, before[before.length - 1]!.length] as const; };
            const [fromLine, fromCol] = where(at[0]), [toLine, toCol] = where(at[1]);
            return {fromLine, fromCol, toLine, toCol};
        }
    }
    if (line < 1 || line > lines.length) return null;
    const last = Math.max(line, Math.min(endLine || line, lines.length));
    const first = lines[line - 1]!;
    return {fromLine: line - 1, fromCol: first.length - first.trimStart().length, toLine: last - 1, toCol: lines[last - 1]!.trimEnd().length};
}

/** The box round a span: across its lines from the leftmost start to the rightmost end. */
export function spanBox(span: Span, lines: readonly string[], m: CanvasMetrics): Box | null {
    const top = m.row(span.fromLine), bottom = m.row(span.toLine);
    if (!top || !bottom) return null;
    let fromCol = span.fromCol, toCol = span.toCol;
    for (let k = span.fromLine; k <= span.toLine; k++) {
        const text = lines[k] ?? '';
        if (k > span.fromLine) fromCol = Math.min(fromCol, text.length - text.trimStart().length);
        if (k < span.toLine) toCol = Math.max(toCol, text.trimEnd().length);
    }
    const left = top.left + fromCol * m.charWidth, width = Math.max(m.charWidth, (toCol - fromCol) * m.charWidth), height = bottom.top + bottom.height - top.top;
    return {left, top: top.top, width, height, bottom: top.top + height};
}

const middle = (b: Box) => ({x: b.left + b.width / 2, y: b.top + b.height / 2});
/** A bowed arrow between two points, its head at `b`: the shaft first, then the head. */
function arrowPaths(a: {x: number; y: number}, b: {x: number; y: number}): string[] {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(40, len * .18), mid = {x: (a.x + b.x) / 2 - dy / len * bow, y: (a.y + b.y) / 2 + dx / len * bow};
    const angle = Math.atan2(b.y - mid.y, b.x - mid.x), head = 9;
    const wing = (d: number) => `${b.x + head * Math.cos(angle + d)} ${b.y + head * Math.sin(angle + d)}`;
    return [smoothPath([a, mid, b]), `M${wing(2.6)} L${b.x} ${b.y} L${wing(-2.6)}`];
}
const placed = (g: {left: number; top: number}, d: string) => translatePath(d, g.left, g.top);
/** A stroke moved by (dx, dy): its absolute coordinates shifted (arcs keep their radii, flags and rotation). */
export function translatePath(d: string, dx: number, dy: number): string {
    return d.replace(/([MLQA])\s*([^MLQA]*)/g, (_all, cmd: string, rest: string) => {
        const n = rest.trim().split(/[\s,]+/).filter(Boolean).map(Number);
        if (cmd === 'A') {
            const out: (number | string)[] = [];
            for (let i = 0; i + 6 < n.length; i += 7) out.push(n[i]!, n[i + 1]!, n[i + 2]!, n[i + 3]!, n[i + 4]!, n[i + 5]! + dx, n[i + 6]! + dy);
            return `A${out.join(' ')} `;
        }
        return `${cmd}${n.map((v, i) => i % 2 ? v + dy : v + dx).join(' ')} `;
    }).trim();
}

const SIDE_GAP = 56;
/** A note's letters, as a share of the code's (style.css `.cp-canvas-text`). */
const NOTE_SCALE = .82;
/**
 * Every mark, laid out. Shapes stand in a column to the right of the code, each by its line (or under the one before
 * it), so an arrow can find them whichever order they come in. Marks naming code that isn't there are left out.
 */
export function layoutMarks(marks: readonly CodeMark[], lines: readonly string[], m: CanvasMetrics): CanvasLayout {
    const origin = m.row(0);
    const codeRight = (origin?.left ?? 0) + Math.max(0, ...lines.map(l => l.trimEnd().length)) * m.charWidth;
    const rowHeight = origin?.height ?? 20;
    const column = codeRight + SIDE_GAP;
    const shapes = new Map<string, {type: string; cx: number; cy: number; w: number; h: number; box: Box}>();
    let below = origin?.top ?? 0;
    const shapeOf = new Map<CodeMark, {type: string; cx: number; cy: number; w: number; h: number; box: Box}>();
    for (const mark of marks) {
        if (mark.kind !== 'shape') continue;
        const type = mark.shape === 'ellipse' || mark.shape === 'diamond' ? mark.shape : 'rectangle';
        const w = Math.max(rowHeight * 3, (mark.label ?? '').length * m.charWidth * .9 + rowHeight * 1.2), h = rowHeight * (type === 'rectangle' ? 1.5 : 2);
        const by = mark.line ? m.row(mark.line - 1)?.top ?? below : below, top = Math.max(by, below);
        const s = {type, cx: column + w / 2, cy: top + h / 2, w, h, box: {left: column, top, width: w, height: h, bottom: top + h}};
        below = top + h + rowHeight * .5;
        shapeOf.set(mark, s);
        if (mark.id) shapes.set(mark.id, s);
    }
    const out: LaidMark[] = [];
    let width = codeRight, height = 0, firstTop: number | null = null;
    // Where each line's notes have got to: a second note on a line goes after the first, not on top of it.
    const noteEnd = new Map<number, number>();
    const grow = (b: Box) => { width = Math.max(width, b.left + b.width + 16);height = Math.max(height, b.bottom + 8);firstTop ??= b.top; };
    for (const [index, mark] of marks.entries()) {
        const color = mark.color ?? (mark.kind === 'cross' ? 'red' : '');
        if (mark.kind === 'shape') {
            const s = shapeOf.get(mark)!;
            grow(s.box);
            out.push({source: index, paths: [shapeStroke(s.type, s.cx, s.cy, s.w, s.h)], color, ...(mark.label ? {text: {x: s.cx, y: s.cy, words: mark.label, centred: true}} : {})});
            continue;
        }
        const span = resolveSpan(lines, mark.line, mark.end_line, mark.text);
        const box = span && spanBox(span, lines, m);
        if (!box) continue;
        grow(box);
        if (mark.kind === 'note') {
            if (!mark.label) continue;
            const row = m.row(span!.fromLine)!, end = row.left + (lines[span!.fromLine] ?? '').trimEnd().length * m.charWidth;
            const x = Math.max(end, box.left + (span!.fromLine === span!.toLine ? box.width : 0), noteEnd.get(span!.fromLine) ?? 0) + m.charWidth * 2;
            noteEnd.set(span!.fromLine, x + mark.label.length * m.charWidth * NOTE_SCALE);
            grow({left: x, top: row.top, width: mark.label.length * m.charWidth, height: row.height, bottom: row.top + row.height});
            out.push({source: index, paths: [], color, text: {x, y: row.top + row.height / 2, words: mark.label, centred: false}});
        } else if (mark.kind === 'arrow') {
            const shape = mark.to_id ? shapes.get(mark.to_id) : undefined;
            const toSpan = shape ? null : resolveSpan(lines, mark.to_line, mark.to_end_line, mark.to_text);
            const toBox = shape?.box ?? (toSpan && spanBox(toSpan, lines, m));
            if (!toBox) continue;
            grow(toBox);
            // Sideways to a shape, out of the side of what it leaves. Between lines, from the edge of one to the edge of
            // the other that face each other, so it crosses as little code as it can.
            const down = !shape && toBox.top >= box.bottom, up = !shape && toBox.bottom <= box.top;
            const start = {x: down || up ? box.left + box.width / 2 : box.left + box.width + 4, y: down ? box.bottom : up ? box.top : box.top + box.height / 2};
            const end = shape ? edgePoint(shape.type, shape.cx, shape.cy, shape.w, shape.h, start, 4)
                : {x: down || up ? toBox.left + toBox.width / 2 : toBox.left + toBox.width + 4, y: down ? toBox.top : up ? toBox.bottom : toBox.top + toBox.height / 2};
            out.push({source: index, paths: arrowPaths(start, end), color});
        } else if (mark.kind === 'box') {
            const pad = 4, x = box.left - pad, y = box.top - 1, w = box.width + pad * 2, h = box.height + 2;
            const d = shapeStroke('rectangle', x + w / 2, y + h / 2, w, h);
            out.push({source: index, paths: [d], fill: `M${x} ${y} H${x + w} V${y + h} H${x} Z`, color});
        } else {
            // A tick or a cross goes just after what it judges, where it can be read with the code; the rest on it.
            const beside = mark.kind === 'check' || mark.kind === 'cross';
            const rowH = m.row(span!.fromLine)!.height;
            const target: Box = beside ? {left: box.left + box.width + rowH * .3, top: box.top + box.height / 2 - rowH / 2, width: rowH, height: rowH, bottom: box.top + box.height / 2 + rowH / 2} : box;
            const g = markGeometry(target, mark.kind as 'circle' | 'underline' | 'check' | 'cross');
            grow({left: g.left, top: g.top, width: g.w, height: g.h, bottom: g.top + g.h});
            out.push({source: index, paths: g.strokes.map(d => placed(g, d)), color});
        }
    }
    return {marks: out, width, height, firstTop};
}

/**
 * Where a line went when the code changed: the same place if it is still there; else the nearest line with its text;
 * else, with no line added or taken away (the one being typed on), the same place. Null when it has gone.
 */
export function remapLine(before: readonly string[], after: readonly string[], line: number): number | null {
    const text = before[line - 1];
    if (text === undefined) return null;
    if (after[line - 1] === text) return line;
    if (text.trim()) {
        let best = -1;
        after.forEach((t, k) => { if (t === text && (best < 0 || Math.abs(k + 1 - line) < Math.abs(best - line))) best = k + 1; });
        if (best > 0) return best;
    }
    return before.length === after.length ? line : null;
}

/**
 * Marks carried over an edit: each follows its lines, and goes if what it named has gone. A check or a cross also goes
 * when the code it judged changes: it was a verdict on what was there, and that code no longer is.
 */
export function remapMarks(marks: readonly CodeMark[], before: readonly string[], after: readonly string[]): CodeMark[] {
    const out: CodeMark[] = [];
    for (const mark of marks) {
        const next = {...mark};
        let gone = false;
        for (const key of ['line', 'end_line', 'to_line', 'to_end_line'] as const) {
            const at = mark[key];
            if (!at) continue;
            const moved = remapLine(before, after, at);
            if (moved == null) gone = true;
            else next[key] = moved;
        }
        if (!gone && (mark.kind === 'check' || mark.kind === 'cross') && mark.line) {
            const span = (lines: readonly string[], from: number, to: number) => lines.slice(from - 1, to).join('\n');
            if (span(before, mark.line, mark.end_line || mark.line) !== span(after, next.line!, next.end_line || next.line!)) gone = true;
        }
        if (!gone) out.push(next);
    }
    return out;
}
