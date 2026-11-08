/**
 * Question: the learner points at code and asks about it, in place. With the tool on, a click picks a line, a
 * shift-click stretches that to more lines, and a drag draws a box round any part (and whatever the agent drew
 * there). What was picked stays marked, and a box for their words opens beside it; sent, the mark stays until the
 * answer is done. One layer per surface: the editor, and Compare's two sides.
 */
export interface QuestionRow {
    /** Which code it is: the editor has one side, Compare has 'original' and 'yours'. */
    side: string;
    line: number;
    /** Where the line's text starts. */
    el: HTMLElement;
    /** The whole line, for hit testing a click. */
    hit: HTMLElement;
    text: string;
}
export interface QuestionPick {
    side: string;
    from: number;
    to: number;
    /** A box: the columns it spans (from 0, end excluded), when it doesn't take the lines whole. */
    cols?: [number, number];
    /** What was picked, as text. */
    excerpt: string;
    /** A box: the agent's marks inside it, as the agent is told them. */
    marks: string[];
}
type Box = {left: number; top: number; right: number; bottom: number};

const DRAG_PX = 5;
const BOX_W = 300;

/** The words of a question about `pick`, within `limit` characters: where it is, the code, then theirs. */
export function questionRequest(pick: QuestionPick, words: string, limit: number, sideName: (side: string) => string): string {
    const span = pick.from === pick.to ? `line ${pick.from}` : `lines ${pick.from}-${pick.to}`;
    const bare = !pick.excerpt.trim();
    const where = bare ? `About what I boxed beside ${span} of ${sideName(pick.side)}` : `About ${pick.cols ? 'the part I boxed of ' : ''}${span} of ${sideName(pick.side)}`;
    const marks = pick.marks.length ? `\nWhat you drew in my box: ${pick.marks.join('; ')}` : '';
    const room = Math.max(0, limit - where.length - words.length - 8);
    const tail = marks.slice(0, Math.max(0, Math.floor(room / 3)));
    const left = room - tail.length;
    const code = pick.excerpt.trim();
    const shown = !code || left < 12 ? '' : code.length <= left ? code : `${code.slice(0, left - 1)}…`;
    return `${where}${shown ? ` (\`${shown}\`)` : ''}:${tail}\n${words}`.slice(0, limit);
}

export function createQuestionLayer(o: {
    host: HTMLElement;
    /** What scrolls the host into view: the host itself for the editor, Compare's pane for its grid. */
    view: HTMLElement;
    rows: () => QuestionRow[];
    charWidth: () => number;
    /** The agent's marks inside a box, in client pixels. */
    marksWithin: (box: Box) => string[];
    send: (pick: QuestionPick, words: string) => Promise<void>;
    /** The picking ended without a question (Esc, ✕). */
    cancelled: () => void;
    placeholder: string;
    maxLength: number;
    /** How far left of a line a click still picks it (the editor's line numbers). */
    slack?: number;
}) {
    const capture = document.createElement('div');capture.className = 'cq-capture';capture.hidden = true;
    const layer = document.createElement('div');layer.className = 'cq-layer';
    o.host.append(layer, capture);
    let on = false, pick: QuestionPick | null = null, anchor: {side: string; line: number} | null = null, pending = false;
    let form: HTMLFormElement | null = null;

    /** Client pixels to the host's own, which scroll with what it holds. */
    const local = (x: number, y: number) => { const h = o.host.getBoundingClientRect();return {x: x - h.left + o.host.scrollLeft, y: y - h.top + o.host.scrollTop}; };
    const rowAt = (x: number, y: number, side?: string) => o.rows().find(r => (!side || r.side === side) && (() => {
        const b = r.hit.getBoundingClientRect();return y >= b.top && y < b.bottom && x >= b.left - (o.slack ?? 0) && x <= b.right;
    })());
    function markBox(cls: string, b: Box) {
        const m = document.createElement('div');m.className = cls;
        const a = local(b.left, b.top);
        Object.assign(m.style, {left: `${a.x}px`, top: `${a.y}px`, width: `${b.right - b.left}px`, height: `${b.bottom - b.top}px`});
        return m;
    }
    /** The lines picked, from where their text starts to where the longest ends. */
    function linesBox(p: QuestionPick): Box | null {
        const rows = o.rows().filter(r => r.side === p.side && r.line >= p.from && r.line <= p.to);
        if (!rows.length) return null;
        const cw = o.charWidth(), first = rows[0]!.el.getBoundingClientRect(), last = rows[rows.length - 1]!.el.getBoundingClientRect();
        const left = Math.min(...rows.map(r => r.el.getBoundingClientRect().left));
        const width = Math.max(4, ...rows.map(r => r.text.replace(/\s+$/, '').length)) * cw;
        return {left: left - 4, top: first.top, right: left + width + 6, bottom: last.bottom};
    }
    /** A box the learner drew, kept in the host's pixels so it scrolls with the code. */
    let drawn: Box | null = null;
    const toLocal = (b: Box): Box => { const a = local(b.left, b.top), z = local(b.right, b.bottom);return {left: a.x, top: a.y, right: z.x, bottom: z.y}; };
    const toClient = (b: Box): Box => { const h = o.host.getBoundingClientRect(), dx = h.left - o.host.scrollLeft, dy = h.top - o.host.scrollTop;return {left: b.left + dx, top: b.top + dy, right: b.right + dx, bottom: b.bottom + dy}; };
    function paint() {
        layer.replaceChildren();
        if (!pick) return;
        const b = drawn ? toClient(drawn) : linesBox(pick);
        if (!b) return;
        const m = markBox(`cq-mark${pending ? ' cq-pending' : ''}`, b);
        layer.append(m);
        if (form) place(b);
    }
    /** The words' box: beside the pick, its top on the pick's top; below it when there is no room to the right. */
    function place(b: Box) {
        if (!form) return;
        const a = local(b.right, b.top), view = o.view.getBoundingClientRect();
        let x = a.x + 10, y = a.y;
        if (view.right - b.right - 12 < BOX_W) {
            // Below the pick, kept inside what shows of the pane.
            const lo = local(b.left, b.bottom), edge = local(view.right - BOX_W - 8, 0).x, start = local(view.left + 6, 0).x;
            x = Math.max(start, Math.min(lo.x, edge));y = lo.y + 6;
        }
        Object.assign(form.style, {left: `${x}px`, top: `${y}px`, width: `${BOX_W}px`});
    }
    function openForm() {
        form?.remove();
        form = document.createElement('form');form.className = 'cq-form';
        const words = document.createElement('textarea');words.className = 'cq-words';words.rows = 2;
        words.placeholder = o.placeholder;words.maxLength = o.maxLength;
        const send = document.createElement('button');send.type = 'submit';send.className = 'cq-send';send.textContent = 'Ask';send.title = 'Send (Enter) · Shift+Enter for a new line';
        const close = document.createElement('button');close.type = 'button';close.className = 'cq-close';close.textContent = '✕';close.title = 'Cancel (Esc)';
        const bar = document.createElement('div');bar.className = 'cq-bar';bar.append(close, send);
        form.append(words, bar);
        o.host.append(form);
        form.addEventListener('pointerdown', e => e.stopPropagation());
        words.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault();cancel(); }
            else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault();form?.requestSubmit(); }
        });
        close.addEventListener('click', cancel);
        form.addEventListener('submit', e => {
            e.preventDefault();
            const text = words.value.trim();
            if (!text || !pick) return;
            void submit(pick, text);
        });
        paint();
        // The box in sight in its pane: scrolled to, not the page.
        const f = form.getBoundingClientRect(), v = o.view.getBoundingClientRect();
        if (f.bottom > v.bottom) o.view.scrollTop += Math.min(f.bottom - v.bottom + 6, f.top - v.top - 4);
        words.focus({preventScroll: true});
    }
    let asked = 0;
    async function submit(p: QuestionPick, text: string) {
        form?.remove();form = null;pending = true;stop(false);paint();
        const mine = ++asked;
        try { await o.send(p, text); } finally { if (mine === asked) answered(); }
    }
    /** The answer is over (or never came): the mark goes. */
    function answered() { if (!pending) return;pending = false;pick = null;drawn = null;anchor = null;paint(); }
    function cancel() { form?.remove();form = null;pick = null;drawn = null;anchor = null;paint();stop(false);o.cancelled(); }
    function pickLines(side: string, from: number, to: number) {
        [from, to] = [Math.min(from, to), Math.max(from, to)];
        const text = o.rows().filter(r => r.side === side && r.line >= from && r.line <= to).map(r => r.text).join('\n');
        pick = {side, from, to, excerpt: text, marks: []};drawn = null;
        openForm();
    }
    function pickBox(b: Box, side: string) {
        const rows = o.rows().filter(r => {
            if (r.side !== side) return false;
            const h = r.el.getBoundingClientRect(), mid = (h.top + h.bottom) / 2;
            return mid > b.top && mid < b.bottom;
        });
        const marks = o.marksWithin(b);
        let from = rows[0]?.line ?? 0, to = rows[rows.length - 1]?.line ?? 0, cols: [number, number] | undefined, excerpt = '';
        if (rows.length) {
            const cw = o.charWidth(), start = rows[0]!.el.getBoundingClientRect().left;
            let c0 = Math.max(0, Math.round((b.left - start) / cw)), c1 = Math.max(c0, Math.round((b.right - start) / cw));
            // A box's edges cut through words as a hand draws it: they take the words they cut, on one line.
            if (rows.length === 1) {
                const t = rows[0]!.text, word = /[\w.]/;
                while (c0 > 0 && word.test(t[c0 - 1] ?? '') && word.test(t[c0] ?? '')) c0--;
                while (c1 < t.length && word.test(t[c1] ?? '') && word.test(t[c1 - 1] ?? '')) c1++;
            }
            const whole = rows.every(r => c0 <= r.text.search(/\S|$/) && c1 >= r.text.replace(/\s+$/, '').length);
            if (!whole) cols = [c0, c1];
            excerpt = rows.map(r => whole ? r.text : r.text.slice(c0, c1)).join('\n');
        } else {
            // Nothing of the code inside: only what was drawn, at the lines beside it.
            const near = rowAt(o.rows().find(r => r.side === side)?.hit.getBoundingClientRect().left ?? b.left, (b.top + b.bottom) / 2, side);
            from = to = near?.line ?? 1;
        }
        if (!rows.length && !marks.length) { cancel();return; }
        pick = {side, from, to, cols, excerpt, marks};drawn = toLocal(b);
        openForm();
    }

    capture.addEventListener('pointerdown', e => {
        if (!on || e.button !== 0) return;
        e.preventDefault();capture.setPointerCapture(e.pointerId);
        const x0 = e.clientX, y0 = e.clientY;
        const startRow = rowAt(x0, y0);
        let live: HTMLElement | null = null, dragging = false;
        const boxOf = (x: number, y: number): Box => ({left: Math.min(x0, x), top: Math.min(y0, y), right: Math.max(x0, x), bottom: Math.max(y0, y)});
        const move = (ev: PointerEvent) => {
            if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_PX) return;
            if (!dragging) { dragging = true;form?.remove();form = null;pick = null;drawn = null;layer.replaceChildren(); }
            live?.remove();live = markBox('cq-mark cq-drawing', boxOf(ev.clientX, ev.clientY));layer.append(live);
        };
        const up = (ev: PointerEvent) => {
            capture.removeEventListener('pointermove', move);
            live?.remove();
            if (dragging) {
                // A box belongs to the side it was begun on (Compare); else to the side most of it covers.
                const side = startRow?.side ?? rowAt(ev.clientX, ev.clientY)?.side ?? o.rows()[0]?.side ?? '';
                pickBox(boxOf(ev.clientX, ev.clientY), side);
                return;
            }
            if (!startRow) return;
            if (ev.shiftKey && anchor && anchor.side === startRow.side) pickLines(startRow.side, anchor.line, startRow.line);
            else { anchor = {side: startRow.side, line: startRow.line};pickLines(startRow.side, startRow.line, startRow.line); }
        };
        capture.addEventListener('pointermove', move);
        capture.addEventListener('pointerup', up, {once: true});
        capture.addEventListener('pointercancel', () => { capture.removeEventListener('pointermove', move);live?.remove(); }, {once: true});
    });
    /** The capture covers all the host holds, scrolled or not. */
    function start() {
        on = true;capture.hidden = false;o.host.classList.add('cq-on');
        Object.assign(capture.style, {width: `${o.host.scrollWidth}px`, height: `${o.host.scrollHeight}px`});
    }
    function stop(clearPick = true) {
        on = false;capture.hidden = true;o.host.classList.remove('cq-on');
        if (clearPick && !pending) { form?.remove();form = null;pick = null;drawn = null;anchor = null;paint(); }
    }
    return {
        get on() { return on; },
        get busy() { return pending || !!form; },
        /** A pick waiting for its words (the tool already put down by a pick made before it was taken up). */
        get picking() { return !!form; },
        start,
        stop,
        /** Pick these lines at once (a selection made before the tool was taken up). */
        pickLines(side: string, from: number, to: number) { start();anchor = {side, line: from};pickLines(side, from, to); },
        cancel,
        answered,
        redraw: paint,
    };
}
