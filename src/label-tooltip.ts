/**
 * KaTeX tooltips for expression-label rows. A label's `tooltipExpr` evaluates
 * (on state changes, in step-marker.ts) to LaTeX; hovering its row shows it in
 * the same floating tooltip the semantic graph uses for node expressions.
 *
 * When a label's value is recalculated as the lesson steps, its formula also
 * appears unprompted as a callout beside its row for a few seconds.
 */
import type { Label3D } from '/labels.js';

let tip: HTMLElement | null = null;
let owner: Label3D | null = null;
let shown = '';
// A code tooltip with an Ask-AI button waits a moment before hiding, so the pointer can reach the button.
let hideTimer: ReturnType<typeof setTimeout> | undefined, overTip = false;

function element(): HTMLElement {
    if (!tip?.isConnected) {
        tip = document.createElement('div');
        tip.className = 'graph-panel-tooltip label-row-tooltip';
        tip.setAttribute('role', 'tooltip');
        tip.addEventListener('pointerenter', () => { overTip = true; clearTimeout(hideTimer); });
        tip.addEventListener('pointerleave', () => { overTip = false; if (tip?.classList.contains('code-doc-askable')) hideCode(); });
        document.body.append(tip);
        shown = '';
    }
    return tip;
}
function renderInto(tex: string, el: HTMLElement): void {
    const katex = (window as unknown as { katex?: { render(t: string, e: HTMLElement, o: object): void } }).katex;
    if (katex) katex.render(tex, el, { displayMode: true, throwOnError: false, strict: false });
    else el.textContent = tex;
}
function render(tex: string): void {
    if (tex === shown) return;
    const el = element();
    el.classList.remove('code-doc-tooltip', 'code-doc-askable');
    renderInto(tex, el);
    shown = tex;
}
function hide(): void { owner = null; tip?.classList.remove('visible'); }

/** Show `label`'s tooltip while the pointer is over this row. Rows are rebuilt as values change; each new row is wired again. */
export function wireRowTooltip(row: HTMLElement, label: Label3D): void {
    if (label.annotation?.tooltip === undefined) return;
    row.addEventListener('pointerenter', () => {
        owner = label;
        render(label.annotation?.tooltip ?? '');
        // An empty tooltip (a placeholder state such as "compare: —") stays hidden.
        element().classList.toggle('visible', !!label.annotation?.tooltip);
    });
    row.addEventListener('pointermove', (event) => {
        const el = element();
        // The row's own buttons (Ask AI, pin) sit where the tooltip would cover them.
        const overButton = (event.target as Element | null)?.closest('button');
        el.classList.toggle('visible', owner === label && !overButton && !!label.annotation?.tooltip);
        // Just below the row, so the tooltip never covers the box it explains.
        el.style.left = `${event.clientX + 12}px`;
        el.style.top = `${row.getBoundingClientRect().bottom + 6}px`;
    });
    row.addEventListener('pointerleave', () => { if (owner === label) hide(); });
}

/** A code tooltip's Ask-AI button: `key` names what it asks about, so hovering the same thing keeps the button. */
export interface CodeTooltipAsk { key: string; make: () => HTMLElement }

function hideCode(): void { if (!owner) tip?.classList.remove('visible', 'code-doc-askable'); }

/** Hide a code tooltip now, as its Ask-AI button is clicked. */
export function hideCodeTooltip(): void { clearTimeout(hideTimer); hideTimer = undefined; overTip = false; hideCode(); }

/**
 * The same tooltip for a code symbol: hovering a variable in the Code panel shows what the scene's labels say
 * about it (their formula, or their value), just under the symbol, and under that the file's documentation for it
 * (docHtml, rendered markdown) with an Ask-AI button (ask). A tooltip with only the button shows the symbol's name
 * (title). Nothing to show hides it. The anchor may be a region (a block of lines): the tooltip goes under or over
 * all of it, never on it.
 */
export function showCodeSymbolTooltip(anchor: { getBoundingClientRect(): DOMRect } | null, tex: string | null, docHtml: string | null = null,
    ask: CodeTooltipAsk | null = null, title: string | null = null): void {
    if (!anchor || (!tex && !docHtml && !ask)) {
        if (tip?.classList.contains('code-doc-askable')) {
            if (hideTimer === undefined && !overTip) hideTimer = setTimeout(() => { hideTimer = undefined; if (!overTip) hideCode(); }, 300);
        } else hideCode();
        return;
    }
    clearTimeout(hideTimer); hideTimer = undefined;
    owner = null;
    const el = element();
    if (docHtml || ask) {
        const key = `${tex ?? ''}\0${docHtml ?? ''}\0${ask?.key ?? ''}\0${title ?? ''}`;
        if (key !== shown) {
            el.replaceChildren();
            if (tex) { const math = document.createElement('div'); el.append(math); renderInto(tex, math); }
            const doc = document.createElement('div'); doc.className = 'code-doc-text';
            if (docHtml) doc.innerHTML = docHtml;
            else if (title && !tex) { const name = document.createElement('code'); name.className = 'code-doc-name'; name.textContent = title; doc.append(name); }
            // The ✦ floats at the top right of the explanation, the text wrapping round it.
            if (ask) doc.prepend(ask.make());
            el.append(doc);
            shown = key;
        }
    } else render(tex!);
    const r = anchor.getBoundingClientRect();
    el.classList.toggle('code-doc-tooltip', !!(docHtml || ask));
    el.classList.toggle('code-doc-askable', !!ask);
    // Under the symbol, or over it when there is no room below; kept on screen sideways.
    const h = el.offsetHeight, w = el.offsetWidth, gap = 2, margin = 8;
    const below = r.bottom + gap + h <= innerHeight - margin || r.top - gap - h < margin;
    el.style.left = `${Math.max(margin, Math.min(r.left, innerWidth - w - margin))}px`;
    // With room on neither side (a block taller than the screen), it stays on screen over the anchor.
    el.style.top = `${Math.max(margin, Math.min(below ? r.bottom + gap : r.top - gap - h, innerHeight - h - margin))}px`;
    el.classList.add('visible');
}

/** Called with the label layout each frame: follow value changes while open, and close when the row goes away. */
export function refreshLabelTooltip(): void {
    if (callouts.size) placeCallouts();
    if (!owner) return;
    const tex = owner.annotation?.tooltip;
    if (tex === undefined || !owner.el.isConnected || owner.forceHidden || owner.visible === false) { hide(); return; }
    render(tex);
    tip?.classList.toggle('visible', !!tex);
}

// ── Change callouts ──
const CALLOUT_MS = 2500;
interface Callout { el: HTMLElement; until: number; tex: string }
const callouts = new Map<Label3D, Callout>();

function calloutRender(c: Callout, tex: string): void {
    if (c.tex === tex) return;
    const katex = (window as unknown as { katex?: { render(t: string, e: HTMLElement, o: object): void } }).katex;
    if (katex) katex.render(tex, c.el, { displayMode: true, throwOnError: false, strict: false });
    else c.el.textContent = tex;
    c.tex = tex;
}

/** Show `label`'s formula beside its row for a few seconds, restarting the timer on each recalculation. */
export function announceLabelChange(label: Label3D): void {
    let c = callouts.get(label);
    if (!c || !c.el.isConnected) {
        const el = document.createElement('div');
        el.className = 'graph-panel-tooltip label-row-tooltip label-change-callout';
        el.setAttribute('role', 'status');
        document.body.append(el);
        c = { el, until: 0, tex: '' };
        callouts.set(label, c);
    }
    calloutRender(c, label.annotation?.tooltip ?? '');
    c.until = performance.now() + CALLOUT_MS;
}

/** Each frame: keep callouts beside their rows (boxes move with the camera and drags), and retire expired ones. */
function placeCallouts(): void {
    const now = performance.now();
    for (const [label, c] of callouts) {
        const row = document.querySelector<HTMLElement>(`.annotation-row[data-label-seq="${label.seq}"]`);
        const gone = !label.el.isConnected || label.forceHidden || label.visible === false || !row?.offsetParent;
        if (gone || now > c.until || owner === label) {
            c.el.classList.remove('visible');
            if (gone || now > c.until + 400) { c.el.remove(); callouts.delete(label); }
            continue;
        }
        calloutRender(c, label.annotation?.tooltip ?? c.tex);
        const box = row.closest('.annotation-badge')!.getBoundingClientRect(), r = row.getBoundingClientRect();
        const width = c.el.offsetWidth, roomRight = window.innerWidth - box.right - 8 >= width;
        c.el.style.left = `${roomRight ? box.right + 8 : Math.max(8, box.left - 8 - width)}px`;
        c.el.style.top = `${(r.top + r.bottom) / 2 - c.el.offsetHeight / 2}px`;
        c.el.classList.add('visible');
    }
}
