/**
 * The code canvas's layer: the agent's marks painted over Type along's editor, scrolling with the code. It follows
 * the code as it changes and is drawn afresh at another font size. See code-canvas-core.ts for what marks are.
 */
import { describeMark, layoutMarks, remapMarks } from '/code-canvas-core.js';
import type { CodeMark, LaidMark } from '/code-canvas-core.js';

const WORD_MS = 16;
const INKS = new Set(['yellow', 'red', 'blue', 'purple', 'orange', 'pink']);
const SVG = 'http://www.w3.org/2000/svg';

export interface CodeCanvas {
    /** Draw these after what is there, one by one, as a hand would. Resolves when done, or when cleared. */
    play(marks: readonly CodeMark[]): Promise<void>;
    /** Lay everything out again as it is (another font size). */
    redraw(): void;
    /** The code changed: marks follow their lines. */
    edited(): void;
    /** Take these off the board, by name; 'all' for everything. Only the agent asks for this. */
    erase(names: readonly string[]): void;
    /** What is on the board, as the agent is told it. */
    describe(): string[];
    /** Show or hide the board, leaving what is on it. */
    setVisible(on: boolean): void;
    /** A new start (another block, Reset): the board goes with the code it was about. */
    clear(): void;
}

/** The hand that draws: the page's pointer, given by the caller, so this layer knows nothing of the 3D view. */
export interface CanvasHand { trace(path: SVGPathElement, live: () => boolean): Promise<void>; moveTo(x: number, y: number): Promise<void>; done(): void }

export function createCodeCanvas(o: {stack: HTMLElement; paint: HTMLElement; editor: HTMLElement; charWidth: () => number; text: () => string; hand: CanvasHand}): CodeCanvas {
    const layer = document.createElement('div');layer.className = 'cp-canvas';layer.setAttribute('aria-hidden', 'true');
    o.stack.append(layer);
    let marks: CodeMark[] = [], lines: string[] = [], shown = 0, run = 0, named = 0;
    const metrics = {get charWidth() { return o.charWidth(); }, row(k: number) {
        const row = o.paint.children[k] as HTMLElement | undefined;
        return row ? {left: row.offsetLeft, top: row.offsetTop, height: row.offsetHeight} : null;
    }};
    const inkOf = (color: string) => INKS.has(color) ? `ai-ink-${color}` : '';
    function paintMark(mark: LaidMark, svg: SVGSVGElement, animate: boolean, strokes: SVGPathElement[]): HTMLElement | null {
        const ink = inkOf(mark.color);
        const g = document.createElementNS(SVG, 'g');
        if (ink) g.classList.add(ink);
        if (mark.fill) { const f = document.createElementNS(SVG, 'path');f.setAttribute('d', mark.fill);f.classList.add('cp-canvas-fill');g.append(f); }
        for (const d of mark.paths) {
            const p = document.createElementNS(SVG, 'path');p.setAttribute('d', d);p.setAttribute('pathLength', '1');
            // Drawn by the hand, stroke by stroke (play).
            if (animate) { p.style.strokeDasharray = '1';p.style.strokeDashoffset = '1';strokes.push(p); }
            g.append(p);
        }
        svg.append(g);
        if (!mark.text) return null;
        const t = document.createElement('div');t.className = `cp-canvas-text${mark.text.centred ? ' centred' : ''} ${ink}`.trim();
        t.style.left = `${mark.text.x}px`;t.style.top = `${mark.text.y}px`;t.textContent = mark.text.words;
        layer.append(t);
        return t;
    }
    /** Everything up to the `shown`th mark; the last one being drawn, when `animate`. */
    function paint(animate = false) {
        layer.replaceChildren();
        if (!marks.length) { layer.style.width = layer.style.height = '0';return null; }
        const laid = layoutMarks(marks, lines, metrics);
        layer.style.width = `${laid.width}px`;layer.style.height = `${laid.height}px`;
        const svg = document.createElementNS(SVG, 'svg');layer.append(svg);
        let last: HTMLElement | null = null;
        const strokes: SVGPathElement[] = [];
        for (const mark of laid.marks) {
            if (mark.source >= shown) continue;
            const drawing = animate && mark.source === shown - 1;
            const words = paintMark(mark, svg, drawing, strokes);
            if (drawing) last = words;
        }
        return {last, strokes, firstTop: laid.firstTop};
    }
    return {
        async play(next) {
            if (!next.length) return;
            const mine = ++run;
            lines = o.text().split('\n');
            marks = [...marks, ...next.map(mark => ({...mark, mid: `m${++named}`}))];
            for (let k = 0; k < next.length; k++) {
                shown++;
                const at = paint(true);
                if (k === 0 && at?.firstTop != null) {
                    const view = o.editor, top = at.firstTop;
                    if (top < view.scrollTop || top > view.scrollTop + view.clientHeight - 60) view.scrollTop = Math.max(0, top - 40);
                }
                // One hand: every stroke of the mark, then its words.
                const live = () => mine === run;
                for (const stroke of at?.strokes ?? []) {
                    await o.hand.trace(stroke, live);
                    if (!live()) return o.hand.done();
                }
                const words = at?.last, whole = words?.textContent ?? '';
                if (words) {
                    words.textContent = '';
                    words.classList.add('writing');
                    const b = words.getBoundingClientRect();
                    await o.hand.moveTo(b.left, b.top + b.height / 2);
                    for (let c = 1; c <= whole.length; c++) {
                        words.textContent = whole.slice(0, c);
                        await new Promise(res => window.setTimeout(res, WORD_MS));
                        if (!live()) return o.hand.done();
                    }
                }
            }
            o.hand.done();
        },
        redraw() { if (marks.length) paint(); },
        edited() {
            const after = o.text().split('\n');
            if (!marks.length || after.join('\n') === lines.join('\n')) { lines = after;return; }
            const kept = remapMarks(marks.slice(0, shown), lines, after);
            marks = [...kept, ...marks.slice(shown)];shown = kept.length;lines = after;
            paint();
        },
        erase(names) {
            if (!names.length || !marks.length) return;
            run++;   // what is being drawn stops at what is whole
            const kept = names.includes('all') ? [] : marks.slice(0, shown).filter(mark => !names.includes(mark.mid ?? ''));
            marks = kept;shown = kept.length;
            paint();
        },
        describe() { return marks.slice(0, shown).map(describeMark); },
        setVisible(on) { layer.hidden = !on; },
        clear() { run++;marks = [];shown = 0;layer.replaceChildren();layer.style.width = layer.style.height = '0'; },
    };
}
