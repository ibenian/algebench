/**
 * Real KaTeX on a canvas.
 *
 * On-plane text (tensor cells and axis labels, chart paper) is painted into
 * a canvas texture, and a canvas cannot host KaTeX's HTML. Instead of
 * flattening the LaTeX to a string of glyphs -- which loses fractions,
 * radicals, sub/superscripts, everything KaTeX lays out -- this module lets
 * KaTeX do the layout in a hidden DOM host and then *replays* that layout
 * onto the canvas: every text run is drawn with `fillText` in the font and
 * at the baseline the browser laid it out with, every rule (fraction bars,
 * overlines) is a `fillRect` from its border, and every stretchy glyph KaTeX
 * draws as inline SVG (radicals, wide arrows) is a `Path2D`.
 *
 * Fonts come from the page's own KaTeX stylesheet through `document.fonts`,
 * so nothing is fetched or inlined, and no `<foreignObject>` image is
 * involved -- WebKit taints a canvas drawn from one, which would break the
 * WebGL upload. The first use of a KaTeX face starts its load; rasters made
 * while a face is still loading are laid out in the fallback font, so the
 * cache is dropped and `onLatexFontsReady` listeners are told to repaint
 * once the load settles.
 */

import { renderKaTeX } from '/labels.js';

/** A rendered snippet: `w`/`h` are CSS pixels at the requested font size; the canvas is supersampled. */
export interface LatexRaster {
    canvas: HTMLCanvasElement | null;
    w: number;
    h: number;
}

export interface DrawLatexOptions {
    fontPx: number;
    color: string;
    align?: 'left' | 'center' | 'right';
    vAlign?: 'top' | 'middle' | 'bottom';
    /** Radians, clockwise on the canvas; `-Math.PI / 2` reads bottom-to-top. */
    rotate?: number;
}

const SUPERSAMPLE = 2;
const FAMILY = 'system-ui, sans-serif';
const CACHE_MAX = 512;
const cache = new Map<string, LatexRaster>();
const listeners = new Set<() => void>();
let host: HTMLDivElement | null = null;
let probe: HTMLSpanElement | null = null;
let fontsHooked = false;

function hasDom(): boolean {
    return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

function getHost(): HTMLDivElement {
    if (host && host.isConnected) return host;
    host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    // Off-screen but laid out and painted: `visibility:hidden` or `display:none`
    // would skip the font loads that make the layout right.
    host.style.cssText = 'position:absolute;left:-100000px;top:0;white-space:nowrap;pointer-events:none;line-height:normal';
    document.body.appendChild(host);
    probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    return host;
}

/** When a KaTeX face is still loading, drop the rasters laid out without it and tell listeners to repaint. */
function watchFonts(): void {
    if (fontsHooked || typeof document === 'undefined' || !document.fonts) return;
    fontsHooked = true;
    document.fonts.ready.then(() => {
        fontsHooked = false;
        cache.clear();
        for (const cb of Array.from(listeners)) { try { cb(); } catch (_e) { /* one listener must not stop the rest */ } }
    }).catch(() => { fontsHooked = false; });
}

/**
 * Subscribe to "the KaTeX fonts finished loading, repaint". Returns the
 * unsubscribe; call it when the element that painted is torn down.
 */
export function onLatexFontsReady(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
}

function remember(key: string, r: LatexRaster): LatexRaster {
    if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, r);
    return r;
}

/**
 * Lay `src` out with KaTeX (markdown-lite plus `$...$`, the way every label
 * in the app is written) at `fontPx` in `color`, and replay it onto a
 * canvas. Cached by (size, colour, source).
 */
export function rasterLatex(src: string, fontPx: number, color: string): LatexRaster {
    const size = Math.max(1, Math.round(fontPx));
    const key = `${size}${color}${src}`;
    const hit = cache.get(key);
    if (hit) return hit;
    if (!hasDom() || !src) {
        // No DOM (unit tests): a metrics-only estimate so layout code still runs.
        return remember(key, { canvas: null, w: src.length * size * 0.55, h: size * 1.2 });
    }
    const h = getHost();
    h.style.font = `${size}px ${FAMILY}`;
    h.style.color = color;
    h.innerHTML = renderKaTeX(src, false);
    for (const m of h.querySelectorAll('.katex-mathml')) m.remove();
    const box = h.getBoundingClientRect();
    const w = Math.ceil(box.width), ht = Math.ceil(box.height);
    if (w < 1 || ht < 1) return remember(key, { canvas: null, w: 0, h: 0 });

    const canvas = document.createElement('canvas');
    canvas.width = w * SUPERSAMPLE;
    canvas.height = ht * SUPERSAMPLE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return remember(key, { canvas: null, w, h: ht });
    ctx.scale(SUPERSAMPLE, SUPERSAMPLE);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    let pending = false;
    const fonts = document.fonts;
    // Text runs: font, colour and baseline straight from the layout.
    const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    const runs: Text[] = [];
    while ((node = walker.nextNode())) if ((node.textContent || '').trim()) runs.push(node as Text);
    for (const t of runs) {
        const el = t.parentElement;
        if (!el || !probe) continue;
        const cs = getComputedStyle(el);
        const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        el.insertBefore(probe, t);
        const baseline = probe.getBoundingClientRect().top - box.top;
        probe.remove();
        const range = document.createRange();
        range.selectNodeContents(t);
        const rr = range.getBoundingClientRect();
        ctx.font = font;
        ctx.fillStyle = cs.color;
        ctx.fillText(t.textContent || '', rr.left - box.left, baseline);
        if (fonts && !pending) { try { if (!fonts.check(font, t.textContent || '')) pending = true; } catch (_e) { /* ignore */ } }
    }
    // Rules: KaTeX draws fraction bars, over/underlines and \rule as borders.
    for (const el of Array.from(h.querySelectorAll<HTMLElement>('*'))) {
        const cs = getComputedStyle(el);
        const bw = parseFloat(cs.borderBottomWidth) || 0;
        if (bw > 0 && cs.borderBottomStyle !== 'none') {
            const r = el.getBoundingClientRect();
            ctx.fillStyle = cs.borderBottomColor;
            ctx.fillRect(r.left - box.left, r.bottom - box.top - bw, r.width, bw);
        }
        const bt = parseFloat(cs.borderTopWidth) || 0;
        if (bt > 0 && cs.borderTopStyle !== 'none') {
            const r = el.getBoundingClientRect();
            ctx.fillStyle = cs.borderTopColor;
            ctx.fillRect(r.left - box.left, r.top - box.top, r.width, bt);
        }
    }
    // Stretchy glyphs: radicals, wide accents and arrows are inline SVG paths
    // in a viewBox; scale the box onto its laid-out rectangle.
    for (const svg of Array.from(h.querySelectorAll('svg'))) {
        const r = svg.getBoundingClientRect();
        const vb = svg.viewBox.baseVal;
        if (!vb || vb.width <= 0 || vb.height <= 0 || r.width <= 0 || r.height <= 0) continue;
        const color = getComputedStyle(svg).color;
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.left - box.left, r.top - box.top, r.width, r.height);
        ctx.clip();
        ctx.translate(r.left - box.left, r.top - box.top);
        ctx.scale(r.width / vb.width, r.height / vb.height);
        ctx.translate(-vb.x, -vb.y);
        ctx.fillStyle = color;
        for (const p of Array.from(svg.querySelectorAll('path'))) {
            const d = p.getAttribute('d');
            if (d) ctx.fill(new Path2D(d));
        }
        ctx.restore();
    }
    h.innerHTML = '';
    if (fonts && (pending || fonts.status === 'loading')) watchFonts();
    return remember(key, { canvas, w, h: ht });
}

/** Width and height (CSS px) of `src` laid out at 100px; the ratio is what fitting needs. */
export function measureLatex(src: string): { w: number; h: number } {
    const r = rasterLatex(src, 100, '#ffffff');
    return { w: r.w, h: r.h };
}

/**
 * The largest font size at which `src` fits a `wPx` × `hPx` box. A plain
 * word's laid-out height is about 1.15× its font size, so this lands where
 * the older glyph-height rule did while letting a fraction be as tall as it
 * needs.
 */
export function fitLatexPx(src: string, wPx: number, hPx: number): number {
    const m = measureLatex(src);
    if (m.w <= 0 || m.h <= 0) return Math.max(1, Math.floor(hPx * 0.62));
    const byHeight = (hPx * 0.72) * 100 / m.h;
    const byWidth = (wPx * 0.9) * 100 / m.w;
    return Math.max(1, Math.floor(Math.min(byHeight, byWidth)));
}

/** Draw `src` on `ctx` at (x, y) per the alignment, in the raster cache's colour and size. */
export function drawLatex(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, o: DrawLatexOptions): void {
    if (!src) return;
    const r = rasterLatex(src, o.fontPx, o.color);
    if (!r.canvas || r.w <= 0) return;
    const align = o.align ?? 'center';
    const vAlign = o.vAlign ?? 'middle';
    const dx = align === 'left' ? 0 : align === 'right' ? -r.w : -r.w / 2;
    const dy = vAlign === 'top' ? 0 : vAlign === 'bottom' ? -r.h : -r.h / 2;
    ctx.save();
    ctx.translate(x, y);
    if (o.rotate) ctx.rotate(o.rotate);
    ctx.drawImage(r.canvas, dx, dy, r.w, r.h);
    ctx.restore();
}

/** Test hook: forget every raster. */
export function _clearLatexRasterCache(): void {
    cache.clear();
}
