/**
 * KaTeX tooltips for expression-label rows. A label's `tooltipExpr` evaluates
 * (on state changes, in step-marker.ts) to LaTeX; hovering its row shows it in
 * the same floating tooltip the semantic graph uses for node expressions.
 */
import type { Label3D } from '/labels.js';

let tip: HTMLElement | null = null;
let owner: Label3D | null = null;
let shown = '';

function element(): HTMLElement {
    if (!tip?.isConnected) {
        tip = document.createElement('div');
        tip.className = 'graph-panel-tooltip label-row-tooltip';
        tip.setAttribute('role', 'tooltip');
        document.body.append(tip);
        shown = '';
    }
    return tip;
}
function render(tex: string): void {
    if (tex === shown) return;
    const el = element();
    const katex = (window as unknown as { katex?: { render(t: string, e: HTMLElement, o: object): void } }).katex;
    if (katex) katex.render(tex, el, { displayMode: true, throwOnError: false, strict: false });
    else el.textContent = tex;
    shown = tex;
}
function hide(): void { owner = null; tip?.classList.remove('visible'); }

/** Show `label`'s tooltip while the pointer is over this row. Rows are rebuilt as values change; each new row is wired again. */
export function wireRowTooltip(row: HTMLElement, label: Label3D): void {
    if (label.annotation?.tooltip === undefined) return;
    row.addEventListener('pointerenter', () => {
        owner = label;
        render(label.annotation?.tooltip ?? '');
        element().classList.add('visible');
    });
    row.addEventListener('pointermove', (event) => {
        const el = element();
        el.style.left = `${event.clientX + 16}px`;
        el.style.top = `${event.clientY - 40}px`;
    });
    row.addEventListener('pointerleave', () => { if (owner === label) hide(); });
}

/** Called with the label layout each frame: follow value changes while open, and close when the row goes away. */
export function refreshLabelTooltip(): void {
    if (!owner) return;
    const tex = owner.annotation?.tooltip;
    if (tex === undefined || !owner.el.isConnected || owner.forceHidden || owner.visible === false) { hide(); return; }
    render(tex);
}
