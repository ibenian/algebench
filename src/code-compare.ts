/**
 * Compare: two pieces of code side by side, each in its own order, the logical parts an expert matched joined across the
 * middle. A connector that crosses another is a part out of order. The agent points with the laser and draws on either
 * side (two code canvases) as it talks. Read only.
 *
 * The view only draws. What the two sides are, and what a part's verdict says, is its `CompareKind`: by default the
 * learner's code against the original (code_compare); code-alternatives.ts sets two alternative solutions side by side.
 * Internally the left side is "original" and the right "yours", whatever the kind calls them.
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

/** What a comparison is: its sides' names, and how a verdict reads (chip), looks (`cmp-<tone>`) and is asked about. */
export interface CompareKind {
    /** The column heads, left then right. */
    titles(): [string, string];
    /** Each side as a part is described: "original" and "your code" for the default kind. */
    sides(): [string, string];
    label(verdict: string): string;
    /** One of exact, equivalent, alternate, incorrect, missing, extra: the colour. */
    tone(verdict: string): string;
    /** A part the left has and the right doesn't: the placeholder's words on the right, or null for no placeholder. */
    gap(m: CompareMatch): string | null;
    askTitle(m: CompareMatch): string;
}

/** The learner's code against the original it was typed from. */
export const ORIGINAL_KIND: CompareKind = {
    titles: () => ['Original', 'Your code'],
    sides: () => ['original', 'your code'],
    label: verdict => LABELS[verdict] ?? verdict,
    tone: verdict => verdict,
    gap: m => m.verdict === 'missing' ? 'not in your code yet' : null,
    askTitle: m => m.yours_from ? 'Explain this difference' : 'Help with this part',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);e.className = cls;return e;
}

/** A part as the learner and the model read it: which lines on each side. */
export function describePart(m: CompareMatch, kind: CompareKind = ORIGINAL_KIND): string {
    const run = (name: string, a: number, b: number) => a ? `${name} ${a === b ? `line ${a}` : `lines ${a}-${b}`}` : '';
    const [left, right] = kind.sides();
    return [run(left, m.original_from, m.original_to), run(right, m.yours_from, m.yours_to)].filter(Boolean).join(', ');
}

export function createCompareView(o: {host: HTMLElement; charWidth: () => number; hand: CanvasHand; ask: (m: CompareMatch, ownWords: boolean) => void; kind?: CompareKind}) {
    const kind = o.kind ?? ORIGINAL_KIND;
    const grid = el('div', 'cmp-grid');
    const leftCol = el('div', 'cmp-side'), mid = el('div', 'cmp-mid'), rightCol = el('div', 'cmp-side');
    const links = document.createElementNS(SVG, 'svg');links.classList.add('cmp-links');
    mid.append(links);grid.append(leftCol, mid, rightCol);o.host.append(grid);
    const laser = el('div', 'cp-ai-selection');
    let left: string[] = [], right: string[] = [], leftRows: HTMLElement[] = [], rightRows: HTMLElement[] = [], matches: CompareMatch[] = [];
    let pointing: ComparePoint | null = null;
    // The part being asked about stays lit once the pointer leaves.
    let pinned: string | null = null;
    let gaps = new Map<CompareMatch, HTMLElement>();
    const canvasOn = (side: () => string[], rows: () => HTMLElement[]) => createCodeCanvas({stack: grid, rowAt: k => rows()[k], editor: o.host, charWidth: o.charWidth, text: () => side().join('\n'), hand: o.hand});
    const leftInk = canvasOn(() => left, () => leftRows), rightInk = canvasOn(() => right, () => rightRows);
    grid.append(laser);

    function askButton(m: CompareMatch) {
        const ai = el('button', 'cmp-ask');ai.type = 'button';ai.textContent = '✦';
        ai.title = `${kind.askTitle(m)} (${describePart(m, kind)}). ⌘-click to ask your own question`;ai.setAttribute('aria-label', ai.title);
        ai.addEventListener('click', e => { pinned = String(matches.indexOf(m));hover(pinned);o.ask(m, e.metaKey || e.ctrlKey); });
        return ai;
    }
    function noteOf(m: CompareMatch) {
        const note = el('div', 'cmp-note'), chip = el('span', 'cmp-chip');
        chip.textContent = kind.label(m.verdict);
        note.append(chip, document.createTextNode(m.comment ? ` ${m.comment}` : ''));
        return note;
    }
    /** One side: its lines in their own order, each part's lines together with its verdict and comment under them. */
    function paintSide(col: HTMLElement, title: string, lines: string[], part: (m: CompareMatch) => [number, number], rows: HTMLElement[], noted: boolean) {
        const head = el('div', 'cmp-head');head.textContent = title;
        const parts = matches.filter(m => part(m)[0]).sort((a, b) => part(a)[0] - part(b)[0]);
        col.replaceChildren(head, ...parts.map(m => {
            const group = el('div', `cmp-part cmp-${kind.tone(m.verdict)}`);
            group.dataset.match = String(matches.indexOf(m));
            const [from, to] = part(m);
            for (let k = from; k <= to; k++) {
                const line = el('div', 'cmp-line'), n = el('span', 'cmp-n'), code = el('span', 'cmp-code');
                n.textContent = String(k);code.textContent = lines[k - 1] || ' ';
                rows[k - 1] = code;
                line.append(n, code);group.append(line);
                // Ask about this part: on its first line on their side. Blank lines have nothing to ask about; a part they
                // haven't written has it on its placeholder.
                if (k === from && noted && lines.slice(from - 1, to).some(text => text.trim())) line.append(askButton(m));
            }
            // Said once: under their code, or under the original's when theirs has nothing for it.
            if (kind.tone(m.verdict) !== 'exact' || m.comment) { if (noted || !m.yours_from) group.append(noteOf(m)); }
            return group;
        }));
    }
    /** A part they haven't written has a place on their side too: a gap after what they wrote just before it in the original. */
    function paintGaps() {
        gaps = new Map();
        const parts = [...matches].filter(m => m.original_from).sort((a, b) => a.original_from - b.original_from);
        let anchor: Element = rightCol.firstElementChild!;
        for (const m of parts) {
            if (m.yours_from) { anchor = rightRows[m.yours_to - 1]?.closest('.cmp-part') ?? anchor;continue; }
            const words = kind.gap(m);
            if (words == null) continue;
            const gap = el('div', `cmp-part cmp-${kind.tone(m.verdict)} cmp-gap`);
            gap.textContent = words;gap.dataset.match = String(matches.indexOf(m));
            gap.append(askButton(m));
            anchor.after(gap);anchor = gap;gaps.set(m, gap);
        }
    }
    /**
     * Matched parts side by side: each part's first line level with its other side's, the side that is ahead waiting
     * with space above, as a diff does. Only parts in the same order on both sides can all be level (the longest run of
     * them, by each side's order); a part moved out of order keeps its place, its ribbon crossing the others.
     */
    function align() {
        const parts = [...leftCol.querySelectorAll<HTMLElement>('.cmp-part'), ...rightCol.querySelectorAll<HTMLElement>('.cmp-part')];
        parts.forEach(p => { p.style.marginTop = ''; });
        const rightOrder = [...rightCol.children];
        const pairs = matches.filter(m => m.original_from).map(m => {
            const a = leftRows[m.original_from - 1]?.closest<HTMLElement>('.cmp-part');
            const b = m.yours_from ? rightRows[m.yours_from - 1]?.closest<HTMLElement>('.cmp-part') : gaps.get(m);
            return a && b ? {a, b, at: rightOrder.indexOf(b), from: m.original_from} : null;
        }).filter((p): p is {a: HTMLElement; b: HTMLElement; at: number; from: number} => !!p).sort((x, y) => x.from - y.from);
        // The longest run in the same order on both sides (longest increasing subsequence of the right side's order).
        const tails: number[] = [], back: number[] = [];
        pairs.forEach((p, k) => {
            let lo = 0, hi = tails.length;
            while (lo < hi) { const mid = (lo + hi) >> 1;if (pairs[tails[mid]!]!.at < p.at) lo = mid + 1;else hi = mid; }
            back[k] = lo ? tails[lo - 1]! : -1;tails[lo] = k;
        });
        const run: typeof pairs = [];
        for (let k = tails.length ? tails[tails.length - 1]! : -1; k >= 0; k = back[k]!) run.unshift(pairs[k]!);
        const base = (e: HTMLElement) => parseFloat(getComputedStyle(e).marginTop) || 0;
        for (const {a, b} of run) {
            const gap = a.offsetTop - b.offsetTop;
            if (gap > 0.5) b.style.marginTop = `${base(b) + gap}px`;
            else if (gap < -0.5) a.style.marginTop = `${base(a) - gap}px`;
        }
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
            if (!m.original_from) continue;
            const a = leftRows[m.original_from - 1], b = leftRows[m.original_to - 1];
            const c = m.yours_from ? rightRows[m.yours_from - 1] : gaps.get(m), d = m.yours_from ? rightRows[m.yours_to - 1] : gaps.get(m);
            if (!a || !b || !c || !d) continue;
            const y0 = a.offsetTop, y1 = b.offsetTop + b.offsetHeight, y2 = c.offsetTop, y3 = d.offsetTop + d.offsetHeight, h = width / 2;
            const path = document.createElementNS(SVG, 'path');
            path.setAttribute('d', `M0 ${y0} C${h} ${y0} ${h} ${y2} ${width} ${y2} L${width} ${y3} C${h} ${y3} ${h} ${y1} 0 ${y1} Z`);
            path.classList.add(`cmp-${kind.tone(m.verdict)}`);
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
        show(result: CompareResult, original: string[], typed: string[], language: string, blurred = false) {
            grid.classList.toggle('cmp-blurred', blurred);
            left = original;right = typed;matches = result.matches;leftRows = [];rightRows = [];pointing = null;pinned = null;
            leftInk.clear();rightInk.clear();laser.replaceChildren();
            const [leftTitle, rightTitle] = kind.titles();
            paintSide(leftCol, leftTitle, left, m => [m.original_from, m.original_to], leftRows, false);
            paintSide(rightCol, rightTitle, right, m => [m.yours_from, m.yours_to], rightRows, true);
            paintGaps();
            align();
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
                // Sideways too: the two columns are often wider than the panel, and what it points at must be seen.
                const left = mark.offsetLeft, right = left + mark.offsetWidth;
                if (left < o.host.scrollLeft + 20 || right > o.host.scrollLeft + o.host.clientWidth - 20)
                    o.host.scrollLeft = Math.max(0, Math.min(left - 40, right - o.host.clientWidth + 40));
                const b = mark.getBoundingClientRect();
                await o.hand.moveTo(b.left + b.width / 2, b.top + b.height);
                o.hand.done();
            }
            if (!drawing) return;
            await rightInk.play(step.draw ?? []);
            await leftInk.play(step.draw_original ?? []);
        },
        /** The grid the sides are laid out in, and each side's lines as drawn: what a question is asked over. */
        grid,
        rows() {
            const of = (side: string, rs: HTMLElement[], text: string[]) => rs.map((el, k) => el && {side, line: k + 1, el, hit: el.parentElement ?? el, text: text[k] ?? ''}).filter(Boolean);
            return [...of('original', leftRows, left), ...of('yours', rightRows, right)] as {side: string; line: number; el: HTMLElement; hit: HTMLElement; text: string}[];
        },
        /** What the agent drew inside this box (client pixels), on either side. */
        within(box: {left: number; top: number; right: number; bottom: number}) {
            const [leftName, rightName] = kind.sides();
            return [...leftInk.within(box).map(m => `on ${leftName === 'original' ? 'the original' : leftName}: ${m}`), ...rightInk.within(box).map(m => `on ${rightName}: ${m}`)];
        },
        /** The comparison as the model is told it, for a question about it. */
        describe() { return matches.map(m => `${describePart(m, kind)}: ${m.verdict}${m.comment ? `: ${m.comment}` : ''}`).join('\n'); },
        unpin() { pinned = null;hover(null); },
        /** The walk is over: the laser goes, the last marks stay. */
        endPointing() { pointing = null;laser.replaceChildren(); },
        redraw() { align();paintLinks();leftInk.redraw();rightInk.redraw();paintLaser(); },
        setVisible(on: boolean) { leftInk.setVisible(on);rightInk.setVisible(on); },
        clear() { leftInk.clear();rightInk.clear();pointing = null;pinned = null;laser.replaceChildren();leftCol.replaceChildren();rightCol.replaceChildren();links.replaceChildren(); },
    };
}
