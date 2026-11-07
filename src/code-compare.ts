/**
 * Compare: the learner's code beside the original, each side in its own order, the logical parts the code_compare expert
 * matched joined across the middle. A connector that crosses another is a part out of order. The agent points with
 * the laser and draws on either side (two code canvases) as it talks. Read only.
 */
import { createCodeCanvas } from '/code-canvas.js';
import type { CanvasHand } from '/code-canvas.js';
import { resolveSpan, spanBox } from '/code-canvas-core.js';
import type { CodeMark } from '/code-canvas-core.js';
import { lineTokens, paintTokens } from '/code-highlight.js';
import type { CodeToken } from '/code-highlight.js';

export interface CompareMatch { original_from: number; original_to: number; yours_from: number; yours_to: number; verdict: string; comment: string }
export interface ComparePoint { side: string; line: number; text: string }
export interface CompareStep { say: string; point?: ComparePoint; draw?: CodeMark[]; draw_original?: CodeMark[] }
export interface CompareResult { summary: string; same_behaviour: boolean; matches: CompareMatch[]; steps: CompareStep[]; debrief: string[]; closing: string }

const SVG = 'http://www.w3.org/2000/svg';
const LABELS: Record<string, string> = {exact: 'exact', equivalent: 'logically equivalent', alternate: 'alternate solution', incorrect: 'incorrect', missing: 'missing', extra: 'extra'};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);e.className = cls;return e;
}

/** A part as the learner and the model read it: which lines on each side. */
export function describePart(m: CompareMatch): string {
    const run = (name: string, a: number, b: number) => a ? `${name} ${a === b ? `line ${a}` : `lines ${a}-${b}`}` : '';
    return [run('original', m.original_from, m.original_to), run('your code', m.yours_from, m.yours_to)].filter(Boolean).join(', ');
}

export function createCompareView(o: {host: HTMLElement; charWidth: () => number; hand: CanvasHand; ask: (m: CompareMatch, ownWords: boolean) => void}) {
    const grid = el('div', 'cmp-grid');
    const leftCol = el('div', 'cmp-side'), mid = el('div', 'cmp-mid'), rightCol = el('div', 'cmp-side');
    const links = document.createElementNS(SVG, 'svg');links.classList.add('cmp-links');
    mid.append(links);grid.append(leftCol, mid, rightCol);o.host.append(grid);
    const laser = el('div', 'cp-ai-selection');
    let left: string[] = [], right: string[] = [], leftRows: HTMLElement[] = [], rightRows: HTMLElement[] = [], matches: CompareMatch[] = [];
    let pointing: ComparePoint | null = null;
    // The part being asked about stays lit once the pointer leaves.
    let pinned: string | null = null;
    const canvasOn = (side: () => string[], rows: () => HTMLElement[]) => createCodeCanvas({stack: grid, rowAt: k => rows()[k], editor: o.host, charWidth: o.charWidth, text: () => side().join('\n'), hand: o.hand});
    const leftInk = canvasOn(() => left, () => leftRows), rightInk = canvasOn(() => right, () => rightRows);
    grid.append(laser);

    function noteOf(m: CompareMatch) {
        const note = el('div', 'cmp-note'), chip = el('span', 'cmp-chip');
        chip.textContent = LABELS[m.verdict] ?? m.verdict;
        note.append(chip, document.createTextNode(m.comment ? ` ${m.comment}` : ''));
        return note;
    }
    /** One side: its lines in their own order, each part's lines together with its verdict and comment under them. */
    function paintSide(col: HTMLElement, title: string, lines: string[], part: (m: CompareMatch) => [number, number], rows: HTMLElement[], noted: boolean) {
        const head = el('div', 'cmp-head');head.textContent = title;
        const parts = matches.filter(m => part(m)[0]).sort((a, b) => part(a)[0] - part(b)[0]);
        col.replaceChildren(head, ...parts.map(m => {
            const group = el('div', `cmp-part cmp-${m.verdict}`);
            group.dataset.match = String(matches.indexOf(m));
            const [from, to] = part(m);
            for (let k = from; k <= to; k++) {
                const line = el('div', 'cmp-line'), n = el('span', 'cmp-n'), code = el('span', 'cmp-code');
                n.textContent = String(k);code.textContent = lines[k - 1] || ' ';
                rows[k - 1] = code;
                line.append(n, code);group.append(line);
                // Ask about this part: on its first line, on the side that says what it is.
                if (k === from && (noted || !m.yours_from)) {
                    const ai = el('button', 'cmp-ask');ai.type = 'button';ai.textContent = '✦';
                    ai.title = `Explain this difference (${describePart(m)}). ⌘-click to ask your own question`;ai.setAttribute('aria-label', ai.title);
                    ai.addEventListener('click', e => { pinned = String(matches.indexOf(m));hover(pinned);o.ask(m, e.metaKey || e.ctrlKey); });
                    line.append(ai);
                }
            }
            // Said once: under their code, or under the original's when theirs has nothing for it.
            if (m.verdict !== 'exact' || m.comment) { if (noted || !m.yours_from) group.append(noteOf(m)); }
            return group;
        }));
    }
    /** Pointed at, a part stands out with its other side and the ribbon between them; the rest step back. */
    function hover(match: string | null) {
        grid.classList.toggle('cmp-hovering', match != null);
        grid.querySelectorAll<HTMLElement | SVGElement>('[data-match]').forEach(e => e.classList.toggle('cmp-hot', e.dataset.match === match));
    }
    grid.addEventListener('mouseover', e => hover((e.target as Element).closest<HTMLElement | SVGElement>('[data-match]')?.dataset.match ?? pinned));
    grid.addEventListener('mouseleave', () => hover(pinned));
    /** A ribbon across the middle for each part both sides have: from its lines on the left to its lines on the right. */
    function paintLinks() {
        links.replaceChildren();
        const width = mid.offsetWidth;
        links.setAttribute('width', String(width));links.setAttribute('height', String(grid.scrollHeight));
        for (const m of matches) {
            if (!m.original_from || !m.yours_from) continue;
            const a = leftRows[m.original_from - 1], b = leftRows[m.original_to - 1], c = rightRows[m.yours_from - 1], d = rightRows[m.yours_to - 1];
            if (!a || !b || !c || !d) continue;
            const y0 = a.offsetTop, y1 = b.offsetTop + b.offsetHeight, y2 = c.offsetTop, y3 = d.offsetTop + d.offsetHeight, h = width / 2;
            const path = document.createElementNS(SVG, 'path');
            path.setAttribute('d', `M0 ${y0} C${h} ${y0} ${h} ${y2} ${width} ${y2} L${width} ${y3} C${h} ${y3} ${h} ${y1} 0 ${y1} Z`);
            path.classList.add(`cmp-${m.verdict}`);
            path.dataset.match = String(matches.indexOf(m));
            links.append(path);
        }
    }
    function paintLaser() {
        laser.replaceChildren();
        if (!pointing?.line) return null;
        const isLeft = pointing.side === 'original', lines = isLeft ? left : right, rows = isLeft ? leftRows : rightRows;
        const metrics = {charWidth: o.charWidth(), row(k: number) { const r = rows[k];return r ? {left: r.offsetLeft, top: r.offsetTop, height: r.offsetHeight} : null; }};
        const span = resolveSpan(lines, pointing.line, 0, pointing.text);
        const box = span && spanBox(span, lines, metrics);
        if (!box) return null;
        const mark = el('div', 'cp-ai-sel');
        Object.assign(mark.style, {left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`});
        laser.append(mark);
        return mark;
    }
    async function highlight(lines: string[], rows: HTMLElement[], language: string) {
        if (!language || !lines.join('').trim()) return;
        const res = await fetch('/api/code/highlight', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({language, source: lines.join('\n')})}).catch(() => null);
        const body = res?.ok ? await res.json() as {tokens?: CodeToken[]} : null;
        if (!Array.isArray(body?.tokens) || (rows !== leftRows && rows !== rightRows)) return;
        lines.forEach((text, k) => { if (text && rows[k]) paintTokens(rows[k]!, lineTokens(body!.tokens!, k + 1)); });
    }
    return {
        show(result: CompareResult, original: string[], typed: string[], language: string) {
            left = original;right = typed;matches = result.matches;leftRows = [];rightRows = [];pointing = null;pinned = null;
            leftInk.clear();rightInk.clear();laser.replaceChildren();
            paintSide(leftCol, 'Original', left, m => [m.original_from, m.original_to], leftRows, false);
            paintSide(rightCol, 'Your code', right, m => [m.yours_from, m.yours_to], rightRows, true);
            o.host.scrollTop = 0;
            paintLinks();
            void highlight(left, leftRows, language);void highlight(right, rightRows, language);
        },
        /** One point of the walk: the last point's marks go, the laser on what this one is about, then what it draws. */
        async step(step: CompareStep, drawing: boolean) {
            leftInk.erase(['all']);rightInk.erase(['all']);
            pointing = step.point?.line ? step.point : null;
            const mark = paintLaser();
            if (mark) {
                const top = mark.offsetTop;
                if (top < o.host.scrollTop + 30 || top > o.host.scrollTop + o.host.clientHeight - 60) o.host.scrollTop = Math.max(0, top - 80);
                const b = mark.getBoundingClientRect();
                await o.hand.moveTo(b.left + b.width / 2, b.top + b.height);
                o.hand.done();
            }
            if (!drawing) return;
            await rightInk.play(step.draw ?? []);
            await leftInk.play(step.draw_original ?? []);
        },
        /** The comparison as the model is told it, for a question about it. */
        describe() { return matches.map(m => `${describePart(m)}: ${m.verdict}${m.comment ? `: ${m.comment}` : ''}`).join('\n'); },
        unpin() { pinned = null;hover(null); },
        /** The walk is over: the laser goes, the last marks stay. */
        endPointing() { pointing = null;laser.replaceChildren(); },
        redraw() { paintLinks();leftInk.redraw();rightInk.redraw();paintLaser(); },
        setVisible(on: boolean) { leftInk.setVisible(on);rightInk.setVisible(on); },
        clear() { leftInk.clear();rightInk.clear();pointing = null;pinned = null;laser.replaceChildren();leftCol.replaceChildren();rightCol.replaceChildren();links.replaceChildren(); },
    };
}
