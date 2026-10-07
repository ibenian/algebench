// ============================================================
// Labels, KaTeX/markdown rendering, color parsing, and the
// AI ask-button helpers.
// ============================================================

import { annotationGroups, annotationRows, annotationGroupAnchor, annotationInsertionIndex, annotationContainerTitle } from '/annotation-layout.js';
import type { AnnotationValue } from '/annotation-layout.js';

import { state } from '/state.js';
import { dataToWorld, worldToData } from '/coords.js';
import { extractActiveGlossaryTerms, restoreGlossaryTerms, stripGlossaryMarkers, stripGlossaryMath } from '/glossary-core.js';

export const AI_SPARKLE_SVG = '<svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11"><path d="M8 1c0 4-3 6.5-7 7 4 .5 7 3 7 7 0-4 3-6.5 7-7-4-.5-7-3-7-7z"/></svg>';

// ----- Utility -----

/** Escape text for use in HTML (element content or a quoted attribute).
 *  A plain string replace rather than a DOM round-trip: same result, no
 *  document needed, and static analysis can see it is a sanitizer. */
export function escapeHtml(s: string): string {
    return String(s).replace(/[&<>"']/g, (c) =>
        c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;');
}

export function stripLatex(text: string | null | undefined): string {
    if (!text) return '';
    return text.replace(/\$\$([^$]*)\$\$/g, '$1').replace(/\$([^$]*)\$/g, '$1');
}

// KaTeX html-macro wrappers that an expression carries for highlighting/metadata
// but the LaTeX→graph parser (and loose text comparison) can't read.
const _HTML_MACROS = ['htmlClass', 'htmlData', 'htmlId', 'htmlStyle'];

/** Strip KaTeX \htmlClass/\htmlData/\htmlId/\htmlStyle wrappers, keeping their
 *  inner content (recursively). Leaves malformed wrappers intact. */
export function stripHtmlMacros(s: string | null | undefined): string {
    if (!s) return s ?? '';
    const str = String(s);
    // Return the index just past the '}' matching the '{' at k, or -1 if unbalanced.
    const skipBalanced = (k: number): number => {
        let depth = 0;
        for (; k < str.length; k++) {
            if (str[k] === '{') depth++;
            else if (str[k] === '}' && --depth === 0) return k + 1;
        }
        return -1;
    };
    let out = '';
    let i = 0;
    while (i < str.length) {
        const m = str[i] === '\\' && _HTML_MACROS.find((x) => str.startsWith('\\' + x, i));
        if (!m) { out += str[i++]; continue; }
        let k = i + 1 + m.length;
        while (k < str.length && /\s/.test(str[k]!)) k++;      // ws before the class/data arg
        const arg1End = str[k] === '{' ? skipBalanced(k) : -1;
        let c = arg1End;
        if (c > 0) while (c < str.length && /\s/.test(str[c]!)) c++;  // ws before the content arg
        const contentEnd = (c > 0 && str[c] === '{') ? skipBalanced(c) : -1;
        if (contentEnd < 0) { out += str[i++]; continue; }     // malformed — leave intact, advance 1
        out += stripHtmlMacros(str.slice(c + 1, contentEnd - 1));   // recurse into the content
        i = contentEnd;
    }
    return out;
}

/** Loose LaTeX normalization for equality comparison: drop \text{}/\mathrm{}
 *  wrappers, braces, whitespace, and normalize \le/\ge spelling — so e.g.
 *  \gamma_{steep} compares equal to \gamma_{\text{steep}}. */
export function normLatex(s: string | null | undefined): string {
    return (s || '')
        .replace(/\\(?:text|mathrm|mathbf|operatorname)\s*\{([^{}]*)\}/g, '$1')
        .replace(/\\le(?![a-zA-Z])/g, '\\leq')
        .replace(/\\ge(?![a-zA-Z])/g, '\\geq')
        .replace(/[\s{}]/g, '');
}

// ----- KaTeX rendering -----

/** Render options shared by renderKaTeX and renderMarkdown. */
export interface RenderOptions {
    /** Link terms of the active lesson glossary — explicit `{{glossary:KEY}}`
     *  markers, plus automatic matches when the scene sets a threshold. On by
     *  default so every visible text surface gets it; pass `false` where the
     *  output is not interactive text (canvas rasters) or is itself a
     *  glossary definition — markers then render as their plain text. */
    glossary?: boolean;
    /** Text the lesson didn't write — an AI reply, which may echo imported
     *  plan text. Raw HTML in it is shown as text (escaped), and links keep
     *  only safe targets (http(s), mailto, relative, #anchors). */
    untrusted?: boolean;
}

export function renderKaTeX(text: string | null | undefined, displayMode?: boolean, opts?: RenderOptions): string {
    if (!text) return '';
    if (opts && opts.glossary === false) return _renderKaTeX(stripGlossaryMarkers(text), displayMode);
    // Terms are matched on the source, then restored into the output.
    const { text: src, terms } = extractActiveGlossaryTerms(text);
    return restoreGlossaryTerms(_renderKaTeX(src, displayMode), terms);
}

// Nested calls (table cells, headings, bold/italic runs) go straight here: the
// glossary pass already ran once over the whole source, so a term inside a
// cell is a sentinel by now and must not be re-matched as a block of its own.
function _renderKaTeX(text: string | null | undefined, displayMode?: boolean): string {
    if (!text) return '';
    // Pre-pass 1: extract markdown tables (before $ splitting, since cells contain LaTeX).
    // Each table is rendered independently (cells get renderKaTeX) and replaced with a sentinel.
    const tables: string[] = [];
    const withTables = text.replace(
        /^(\|.+\|)\n(\|[\s:?-]+(?:\|[\s:?-]+)+\|)\n((?:\|.+\|\n?)+)/gm,
        (_match: string, headerLine: string, _sepLine: string, bodyBlock: string) => {
            const parseRow = (row: string): string[] => {
                const content = row.replace(/^\|/, '').replace(/\|$/, '');
                const cells: string[] = [];
                let current = '';
                let inMath = false, inDisplayMath = false;
                for (let ci = 0; ci < content.length; ci++) {
                    const ch = content[ci], next = content[ci + 1];
                    if (ch === '\\' && ci + 1 < content.length) { current += ch + content[++ci]; continue; }
                    if (ch === '$') {
                        if (next === '$') { inDisplayMath = !inDisplayMath; current += '$$'; ci++; continue; }
                        if (!inDisplayMath) inMath = !inMath;
                        current += ch; continue;
                    }
                    if (ch === '|' && !inMath && !inDisplayMath) { cells.push(current.trim()); current = ''; continue; }
                    current += ch;
                }
                cells.push(current.trim());
                return cells;
            };
            const headers = parseRow(headerLine);
            const rows = bodyBlock.trim().split('\n').map((r: string) => parseRow(r));
            const tableStyle = 'border-collapse:collapse;margin:6px 0;font-size:0.9em';
            const cellStyle = 'padding:3px 8px;border:1px solid rgba(255,255,255,0.15)';
            const thStyle = cellStyle + ';font-weight:bold;background:rgba(255,255,255,0.06)';
            let html = `<table style="${tableStyle}"><thead><tr>`;
            html += headers.map((h: string) => `<th style="${thStyle}">${_renderKaTeX(h, false)}</th>`).join('');
            html += '</tr></thead><tbody>';
            for (const row of rows) {
                html += '<tr>' + row.map((c: string) => `<td style="${cellStyle}">${_renderKaTeX(c, false)}</td>`).join('') + '</tr>';
            }
            html += '</tbody></table>';
            tables.push(html);
            return `\x01T${tables.length - 1}\x01`;
        }
    );
    // Pre-pass 2: extract heading lines so LaTeX inside them isn't split apart.
    const headings: string[] = [];
    let prepped = withTables.replace(/^(#{1,3})\s+(.+)$/gm, (_m: string, hashes: string, content: string) => {
        const sz = ['1.05em', '0.95em', '0.88em'][hashes.length - 1];
        headings.push(`<div style="font-size:${sz};font-weight:bold;margin:3px 0 1px">${_renderKaTeX(content, false)}</div>`);
        return `\x01H${headings.length - 1}\x01`;
    });
    // Pre-pass 3: extract `code` spans so asterisks inside them
    // (e.g. `*args`) aren't consumed by the bold/italic pass.
    const codeSpans: string[] = [];
    prepped = prepped.replace(/`(.+?)`/g, (_m: string, inner: string) => {
        codeSpans.push(inner);
        return `\x01C${codeSpans.length - 1}\x01`;
    });
    // Pre-pass 4: extract $$ and $ math blocks so asterisks inside them
    // (e.g. $T^*$, $A*B$) aren't consumed by the bold/italic pass.
    const mathSpans: string[] = [];
    prepped = prepped.replace(/(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g, (match: string) => {
        mathSpans.push(match);
        return `\x01M${mathSpans.length - 1}\x01`;
    });
    // Pre-pass 4: extract **bold** and *italic* spans that may contain $math$ inside,
    // so the $ split doesn't break the markers apart.
    const boldSpans: string[] = [];
    prepped = prepped.replace(/\*\*(.+?)\*\*/g, (_m: string, inner: string) => {
        boldSpans.push(inner);
        return `\x01B${boldSpans.length - 1}\x01`;
    });
    const italicSpans: string[] = [];
    prepped = prepped.replace(/\*(.+?)\*/g, (_m: string, inner: string) => {
        italicSpans.push(inner);
        return `\x01I${italicSpans.length - 1}\x01`;
    });
    // Restore math sentinels everywhere before the $ split
    // Sentinels are generated a few lines above, so every index resolves; `!`
    // keeps a corrupted one throwing rather than splicing in "undefined".
    const restoreMath = (str: string): string =>
        str.replace(/\x01M(\d+)\x01/g, (_m: string, idx: string) => mathSpans[+idx]!);
    prepped = restoreMath(prepped);
    for (let i = 0; i < boldSpans.length; i++) boldSpans[i] = restoreMath(boldSpans[i]!);
    for (let i = 0; i < italicSpans.length; i++) italicSpans[i] = restoreMath(italicSpans[i]!);
    const segments = prepped.split(/(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g);
    return segments.map((seg: string, i: number) => {
        if (i % 2 === 0) {
            const lines = escapeHtml(seg).split(/\\n|\n/);
            return lines.map((line: string, li: number) => {
                const t = line.trim();
                // Restore heading sentinel
                const hIdx = t.match(/^\x01H(\d+)\x01$/);
                if (hIdx) return headings[+hIdx[1]!]!;
                // Restore table sentinel
                const tIdx = t.match(/^\x01T(\d+)\x01$/);
                if (tIdx) return tables[+tIdx[1]!]!;
                const hm = t.match(/^(#{1,3})\s+(.*)/);
                if (hm) {
                    const sz = ['1.05em', '0.95em', '0.88em'][hm[1]!.length - 1];
                    return `<div style="font-size:${sz};font-weight:bold;margin:3px 0 1px">${hm[2]}</div>`;
                }
                if (t === '---') return '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.2);margin:4px 0">';
                const inline = line
                    .replace(/\x01B(\d+)\x01/g, (_m: string, idx: string) => `<strong>${_renderKaTeX(boldSpans[+idx], false)}</strong>`)
                    .replace(/\x01I(\d+)\x01/g, (_m: string, idx: string) => `<em>${_renderKaTeX(italicSpans[+idx], false)}</em>`)
                    // Code spans were lifted out before the escape above: escape them here.
                    .replace(/\x01C(\d+)\x01/g, (_m: string, idx: string) => `<code>${escapeHtml(codeSpans[+idx]!)}</code>`)
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\*(.+?)\*/g, '<em>$1</em>')
                    .replace(/`(.+?)`/g, '<code>$1</code>');
                return li < lines.length - 1 ? inline + '<br>' : inline;
            }).join('');
        } else if (seg.startsWith('$$')) {
            const tex = seg.slice(2, -2);
            try { return katex.renderToString(tex, { throwOnError: false, strict: false, displayMode: true, trust: (ctx) => ctx.command === '\\htmlClass' }); }
            catch (_e) { return escapeHtml(seg); }
        } else {
            const tex = seg.slice(1, -1);
            try { return katex.renderToString(tex, { throwOnError: false, strict: false, displayMode: false, trust: (ctx) => ctx.command === '\\htmlClass' }); }
            catch (_e) { return escapeHtml(seg); }
        }
    }).join('');
}

// ----- Markdown rendering (LaTeX-safe two-pass) -----

export function renderMarkdown(md: string | null | undefined, opts?: RenderOptions): string {
    if (!md) return '';
    const untrusted = !!opts?.untrusted;
    if (opts && opts.glossary === false) return _renderMarkdown(stripGlossaryMarkers(md), untrusted);
    // Terms are matched on the source, then restored into the output.
    const { text, terms } = extractActiveGlossaryTerms(md);
    return restoreGlossaryTerms(_renderMarkdown(text, untrusted), terms);
}

/** A link target that can't run script: http(s), mailto, or scheme-less (relative, #anchor). */
function safeHref(href: string | null | undefined): boolean {
    const h = String(href ?? '').trim();
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(h);
    return !scheme || /^(https?|mailto)$/i.test(scheme[1]!);
}

type MarkedRenderer = InstanceType<typeof marked.Renderer>;
let _untrustedRenderer: MarkedRenderer | null = null;

/** marked's renderer for untrusted Markdown: raw HTML escaped, unsafe links dropped. */
function untrustedRenderer(): MarkedRenderer {
    if (_untrustedRenderer) return _untrustedRenderer;
    const r = new marked.Renderer();
    const link = r.link.bind(r);
    const image = r.image.bind(r);
    r.html = (html: string) => escapeHtml(html);
    r.link = (href: string, title: string | null | undefined, text: string) => (safeHref(href) ? link(href, title, text) : text);
    r.image = (href: string, title: string | null, text: string) => (safeHref(href) ? image(href, title, text) : escapeHtml(text));
    return (_untrustedRenderer = r);
}

function _renderMarkdown(md: string, untrusted = false): string {
    const mathBlocks: { tex: string; display: boolean }[] = [];

    let safe = md.replace(/\$\$([\s\S]+?)\$\$/g, (_m: string, tex: string) => {
        mathBlocks.push({ tex: tex.trim(), display: true });
        return '%%MATH_BLOCK_' + (mathBlocks.length - 1) + '%%';
    });
    safe = safe.replace(/\$([^$\n]+)\$/g, (_m: string, tex: string) => {
        mathBlocks.push({ tex: tex.trim(), display: false });
        return '%%MATH_BLOCK_' + (mathBlocks.length - 1) + '%%';
    });

    // marked.parse is typed string | Promise<string> because it supports async
    // extensions; none are registered here, so the sync string is what comes back.
    let html = (untrusted ? marked.parse(safe, { renderer: untrustedRenderer() }) : marked.parse(safe)) as string;
    html = html.replace(/%%MATH_BLOCK_(\d+)%%/g, (_m: string, idx: string) => {
        // Sentinel indices are generated just above, so this always resolves.
        const block = mathBlocks[parseInt(idx)]!;
        try {
            return katex.renderToString(block.tex, { throwOnError: false, strict: false, displayMode: block.display, trust: (ctx) => ctx.command === '\\htmlClass' });
        } catch (_e) { return block.tex; }
    });

    return html;
}

// ----- Color parsing -----

/** Normalized RGB, each channel in 0..1. */
export type Rgb = number[];

export function parseColor(c: unknown): Rgb {
    if (!c) return [0.5, 0.5, 1];
    if (typeof c === 'string') {
        if (c.startsWith('#')) {
            const hex = c.slice(1);
            return [
                parseInt(hex.substr(0,2), 16) / 255,
                parseInt(hex.substr(2,2), 16) / 255,
                parseInt(hex.substr(4,2), 16) / 255,
            ];
        }
        const named: Record<string, number[]> = {
            'red': [1,0.2,0.2], 'green': [0.2,0.9,0.2], 'blue': [0.3,0.4,1],
            'yellow': [1,1,0.2], 'cyan': [0.2,1,1], 'magenta': [1,0.2,1],
            'orange': [1,0.6,0.1], 'purple': [0.7,0.3,1], 'white': [1,1,1],
            'gray': [0.5,0.5,0.5], 'grey': [0.5,0.5,0.5], 'pink': [1,0.5,0.7],
        };
        return named[c.toLowerCase()] || [0.5, 0.5, 1];
    }
    // A caller-supplied array is passed through channel-wise, preserving its
    // length — hence Rgb is number[] rather than a 3-tuple.
    if (Array.isArray(c)) return (c as number[]).map((v) => (v > 1 ? v / 255 : v));
    return [0.5, 0.5, 1];
}

export function colorToCSS(c: unknown): string {
    const rgb = parseColor(c);
    // A short array yields NaN channels here, exactly as the JavaScript did.
    return `rgb(${Math.round(rgb[0]! * 255)}, ${Math.round(rgb[1]! * 255)}, ${Math.round(rgb[2]! * 255)})`;
}

// ----- Label system -----

/** Options accepted by addLabel3D; a bare string is shorthand for cssClass. */
export interface Label3DOptions {
    cssClass?: string;
    align?: string;
}

/** A live 3D label: its DOM node plus the per-frame projection/declutter state
 *  that updateLabels reads and writes. */
export interface Label3D {
    el: HTMLDivElement;
    dataPos: number[];
    /** Project a cell's corners to keep annotations outside its screen footprint. */
    snapToProjection?: boolean;
    cellAttachment?: {corners: number[][]; edge: 'top' | 'bottom'; gap: number};
    screenX: number | null;
    screenY: number | null;
    forceHidden: boolean;
    align: string;
    /** Cached DOM size, measured lazily, and the labelScale it was measured at. */
    boxW: number | null;
    boxH: number | null;
    boxScale: number | null;
    /** Vertical de-occlusion offset (position mode). */
    offsetY: number;
    targetOffsetY: number;
    /** World-space distance from the camera (smaller = nearer). */
    depth: number;
    /** Applied / target brightness (shade mode). */
    dim: number;
    targetDim: number;
    /** Applied / target opacity for near-hiding a big stack's farthest labels. */
    fade: number;
    targetFade: number;
    /** Paint order; higher = on top (depth tiebreak). */
    seq: number;
    lastDataPos: number[] | null;
    moveCooldown: number;
    /** Set each frame by updateLabels; absent until the first pass runs. */
    moving?: boolean;
    /** On-screen visibility for this frame (frustum + forceHidden). */
    visible?: boolean;
    /** Last z-index written to the DOM, so paint order only touches the style
     *  when the rank actually changes. */
    _zi?: number;
    /** Last presentation written; unchanged frames leave the DOM untouched. */
    _paint?: {transform?: string; opacity?: string; filter?: string; inert?: boolean; overlay?: boolean; overlayOpacity?: number};
    annotation?: AnnotationValue & {
        kind: 'marker' | 'label'; badge: HTMLElement; measure: HTMLElement;
        width: number; height: number; scale: number | null; rendered: string;
        startDrag?: (event:PointerEvent, members?:Label3D[])=>void;
    };
    annotationHidden?: boolean;
    annotationAnchor?: {x:number; y:number};
    /** User placement in viewport pixels, independent of the data anchor. */
    annotationPosition?: {x:number; y:number};
    annotationWorldPosition?: [number, number, number];
    annotationOrder?: number;
    annotationDragging?: boolean;
    annotationDocked?: boolean;
    annotationCoordinateMode?: 'world' | 'screen';
}

// state.js is still untyped JavaScript, so describe the slice this module uses
// rather than spreading `any`. The cast goes away when state.js is converted.
interface LabelsState {
    labels: Label3D[];
    camera: import('three').Camera | null;
    renderer: { domElement: HTMLCanvasElement } | null;
    displayParams: { labelScale: number; labelOpacity: number };
}
const labelsState = state as unknown as LabelsState;

let _labelSeq = 0; // monotonic; later = appended later = painted on top

export function addLabel3D(
    text: string,
    dataPos: number[],
    color?: unknown,
    opts?: Label3DOptions | string | null,
): Label3D {
    const o: Label3DOptions = typeof opts === 'string' ? { cssClass: opts } : (opts || {});
    const container = document.getElementById('labels-container');
    const el = document.createElement('div');
    el.className = o.cssClass || 'label-3d';
    el.innerHTML = renderKaTeX(text, false);
    if (color) el.style.color = colorToCSS(color);
    // Unguarded in the original: a missing container threw here and still must,
    // rather than silently creating labels that are never mounted.
    container!.appendChild(el);
    const align = o.align || 'center';
    const entry: Label3D = {
        el, dataPos: dataPos.slice(), screenX: null, screenY: null, forceHidden: false, align,
        boxW: null, boxH: null, // cached DOM size (measured lazily)
        boxScale: null,       // labelScale the cached size was measured at
        offsetY: 0, targetOffsetY: 0, // vertical de-occlusion offset (position mode)
        depth: 0,             // world-space distance from the camera (smaller = nearer)
        dim: 1, targetDim: 1, // applied / target brightness (shade mode)
        fade: 1, targetFade: 1, // applied / target opacity for near-hiding a big stack's farthest labels
        seq: _labelSeq++,     // paint order; higher = on top (depth tiebreak)
        lastDataPos: null,    // dataPos from the previous frame (motion detection)
        moveCooldown: 0,      // frames remaining while treated as "animating"
    };
    labelsState.labels.push(entry);
    return entry;
}

export function clearLabels(): void {
    const container = document.getElementById('labels-container');
    container!.innerHTML = '';
    labelsState.labels = [];
}

let _labelsContainer: HTMLElement | null = null;
let _appliedLabelScale: number | null = null;

export function updateLabels(): void {
    const camera = labelsState.camera;
    const renderer = labelsState.renderer;
    if (!camera || !renderer) return;
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    const s = labelsState.displayParams.labelScale;

    // Drive label size through a CSS variable so the font (and KaTeX) re-render
    // crisply at the new size, instead of resampling glyphs with transform scale.
    if (_appliedLabelScale !== s) {
        if (!_labelsContainer) _labelsContainer = document.getElementById('labels-container');
        if (_labelsContainer) _labelsContainer.style.setProperty('--label-scale', String(s));
        _appliedLabelScale = s;
    }

    // ----- Pass 1: project + measure (reads only) -----
    for (const lbl of labelsState.labels) {
        // A label whose data position is animating is "glued" to a moving marker
        // (a rider dot, an animated point). Exclude it from declutter so it stays
        // pinned to its marker instead of being nudged off it as it sweeps past
        // other labels. Gate on dataPos (not screen position) so camera-only
        // motion still declutters. The cooldown holds the exclusion through brief
        // pauses (e.g. a turnaround) so a slow stretch doesn't re-engage and
        // blip; once motion truly settles the label declutters again.
        const dp = lbl.annotationWorldPosition ?? lbl.dataPos;
        const prev = lbl.lastDataPos;
        const dataMoved = prev && (
            Math.abs(dp[0]! - prev[0]!) > 1e-6 ||
            Math.abs(dp[1]! - prev[1]!) > 1e-6 ||
            Math.abs(dp[2]! - prev[2]!) > 1e-6);
        if (dataMoved) lbl.moveCooldown = 20;
        else if (lbl.moveCooldown > 0) lbl.moveCooldown--;
        lbl.lastDataPos = [dp[0]!, dp[1]!, dp[2]!];
        lbl.moving = lbl.moveCooldown > 0;

        const world = dataToWorld(dp as [number, number, number]);
        const v = new THREE.Vector3(world[0], world[1], world[2]);
        // World-space distance to the camera (linear; smaller = nearer). NDC z is
        // useless here — a near-planar scene crushes every label to ~the same z.
        lbl.depth = camera.position.distanceTo(v);
        const projected = v.project(camera);
        let targetX = (projected.x * 0.5 + 0.5) * w;
        let targetY = (-projected.y * 0.5 + 0.5) * h;
        if (lbl.cellAttachment) {
            const attachment = lbl.cellAttachment;
            const corners = attachment.corners.map(point => {
                const world = dataToWorld(point as [number, number, number]);
                return new THREE.Vector3(...world).project(camera);
            });
            const xs = corners.map(p => (p.x * .5 + .5) * w);
            const ys = corners.map(p => (-p.y * .5 + .5) * h);
            targetX = (Math.min(...xs) + Math.max(...xs)) / 2;
            targetY = attachment.edge === 'top' ? Math.min(...ys) - attachment.gap : Math.max(...ys) + attachment.gap;
        }
        if (lbl.annotationPosition && lbl.annotationCoordinateMode === 'screen') {
            targetX = lbl.annotationPosition.x;
            targetY = lbl.annotationPosition.y;
        }
        lbl.visible = !lbl.forceHidden && ((lbl.annotationPosition && lbl.annotationCoordinateMode === 'screen') || projected.z < 1)
            && targetX > -50 && targetX < w + 50
            && targetY > -50 && targetY < h + 50;

        // Discrete index changes must update the badge and anchor atomically.
        // Keep camera smoothing, but never show a new index over the old cell.
        if (lbl.snapToProjection || lbl.cellAttachment || lbl.screenX == null || lbl.screenY == null || (dataMoved && lbl.annotation?.kind === 'marker')) {
            lbl.screenX = targetX;
            lbl.screenY = targetY;
        } else {
            const alpha = 0.3;
            lbl.screenX += (targetX - lbl.screenX) * alpha;
            lbl.screenY += (targetY - lbl.screenY) * alpha;
        }

        // Cache box size; re-measure when labelScale changes (the font-size, and
        // thus offsetWidth/Height, already reflects the scale — no extra factor).
        if (lbl.visible && (lbl.boxW == null || lbl.boxScale !== s)) {
            lbl.boxW = lbl.el.offsetWidth;
            lbl.boxH = lbl.el.offsetHeight;
            lbl.boxScale = s;
        }
    }

    groupAnnotations(s);

    // ----- Pass 2: resolve declutter (each resolver no-ops unless its mode is on)
    resolveLabelOffsets();  // position mode → targetOffsetY
    resolveDepthDimming();  // shade mode    → targetDim

    // ----- Pass 3: smooth offset + dim, then write transforms -----
    const declutterAlpha = state.displayParams.labelDeclutterAlpha;
    const dimAlpha = state.displayParams.labelDimAlpha;
    for (const lbl of labelsState.labels) {
        const paint = lbl._paint ??= {};
        lbl.offsetY += (lbl.targetOffsetY - lbl.offsetY) * declutterAlpha;
        lbl.dim += (lbl.targetDim - lbl.dim) * dimAlpha;
        lbl.fade += (lbl.targetFade - lbl.fade) * dimAlpha;
        const ax = lbl.align === 'right' ? '-100%' : lbl.align === 'left' ? '0%' : '-50%';
        const x = lbl.annotationAnchor?.x ?? lbl.screenX!;
        const y = (lbl.annotationAnchor?.y ?? lbl.screenY!) + lbl.offsetY;
        const ay = lbl.cellAttachment ? (lbl.cellAttachment.edge === 'top' ? '-100%' : '0%') : '-50%';
        const transform = `translate(${x}px, ${y}px) translate(${ax}, ${ay})`;
        if (paint.transform !== transform) { lbl.el.style.transform = transform; paint.transform = transform; }
        // Near-hidden far labels fade via opacity (fade); gentle recede uses brightness (dim).
        const overlay = lbl.annotationCoordinateMode === 'screen';
        if (paint.overlay !== overlay) {
            lbl.el.classList.toggle('annotation-overlay', overlay);
            paint.overlay = overlay;
            paint.overlayOpacity = overlay ? 0.82 : 1;
        }
        const opacity = lbl.visible && !lbl.annotationHidden ? (labelsState.displayParams.labelOpacity * lbl.fade * paint.overlayOpacity!).toFixed(3) : '0';
        if (paint.opacity !== opacity) { lbl.el.style.opacity = opacity; paint.opacity = opacity; }
        // Hidden members must not intercept a drag intended for a shared row.
        const inert = !lbl.visible || !!lbl.annotationHidden;
        if (lbl.annotation && paint.inert !== inert) {
            lbl.el.inert = inert;
            // Scene transition fades also write opacity. Visibility keeps a
            // merged-away empty badge hidden regardless of those fade writes.
            lbl.el.classList.toggle('annotation-suppressed', inert);
            paint.inert = inert;
        }
        const filter = lbl.dim < 0.999 ? `brightness(${lbl.dim.toFixed(3)})` : '';
        if (paint.filter !== filter) { lbl.el.style.filter = filter; paint.filter = filter; }
    }

    // Paint order: nearest the camera draws on top. Assign z-index by depth rank
    // using the SAME order the shade dimming uses, so the label drawn on top is
    // exactly the one kept bright.
    const ordered = labelsState.labels.filter((l) => l.visible).sort(frontToBack);
    for (let i = 0; i < ordered.length; i++) {
        const zi = ordered.length - i; // front (index 0) gets the highest z-index
        const o = ordered[i]!;
        if (o._zi !== zi) { o.el.style.zIndex = String(zi); o._zi = zi; }
    }
}

/** Group only annotation objects. Expressions are evaluated by bindings, never here.
 * Intrinsic measurement nodes keep collision geometry independent of merged content. */
let annotationLayoutKey = "";
function groupAnnotations(scale: number): void {
    const labels = labelsState.labels.filter(l => l.annotation && l.visible);
    const boxes = labels.map(l => {
        const a = l.annotation!; // Filtered above.
        if (a.scale !== scale) {
            a.width = a.measure.offsetWidth; a.height = a.measure.offsetHeight; a.scale = scale;
        }
        return {text:a.text, index:a.index, kind:a.kind, coordinateMode:l.annotationCoordinateMode ?? 'world', detached:!!l.annotationDragging && !l.annotationDocked, x:l.screenX!, y:l.screenY! + (l.cellAttachment?.edge === 'top' ? -(a.height + 11)/2 : a.kind === 'marker' ? -38 : 0), width:a.width, height:a.height};
    });
    const key = JSON.stringify(boxes.map((b,i) => [labels[i]!.seq, labels[i]!.annotationOrder, b.coordinateMode, b.detached, Math.round(b.x*10), Math.round(b.y*10), b.width, b.height, b.text, b.index]));
    if (key === annotationLayoutKey) return;
    annotationLayoutKey = key;
    for (const l of labelsState.labels) { l.annotationHidden = false; l.annotationAnchor = undefined; }
    for (const group of annotationGroups(boxes)) {
        if (boxes[group[0]!]!.kind === 'label') group.sort((i,j) => (labels[i]!.annotationOrder ?? labels[i]!.seq) - (labels[j]!.annotationOrder ?? labels[j]!.seq));
        const leader = labels[group[0]!]!;
        const a = leader.annotation!;
        const members = group.map(i => boxes[i]!);
        if (a.kind === 'label') leader.annotationAnchor = annotationGroupAnchor(members);
        const rows = annotationRows(members);
        const signature = JSON.stringify([rows, group.map(i => [labels[i]!.seq, labels[i]!.annotationCoordinateMode ?? 'world'])]);
        if (signature !== a.rendered) {
            a.badge.replaceChildren(...rows.map((text, rowIndex) => {
                const row = document.createElement('span'); row.className = 'annotation-row'; row.textContent = text;
                if (a.kind === 'label') {
                    row.dataset.labelSeq = String(labels[group[rowIndex]!]!.seq);
                    const drag = labels[group[rowIndex]!]!.annotation!.startDrag;
                    if (drag) { row.classList.add('annotation-row-draggable'); row.title='Drag to move this label'; row.addEventListener('pointerdown',drag); }
                }
                return row;
            }));
            if (a.kind === 'label') {
                const header = document.createElement('span');
                header.className = 'annotation-titlebar';
                header.textContent = `⠿ ${annotationContainerTitle(rows)} `;
                header.title = 'Drag to move all labels in this box';
                header.addEventListener('pointerdown', event => a.startDrag?.(event, group.map(i => labels[i]!)));
                const mode = document.createElement('button');
                mode.className = 'annotation-mode-toggle';
                mode.type = 'button';
                const members = group.map(i => labels[i]!);
                const updateMode = () => {
                    mode.textContent = members.every(member => member.annotationCoordinateMode === 'screen') ? 'Overlay' : '3D';
                    mode.title = mode.textContent === 'Overlay' ? 'Return labels to 3D world coordinates' : 'Pin labels to screen overlay coordinates';
                };
                updateMode();
                mode.addEventListener('pointerdown', event => { event.stopPropagation(); });
                mode.addEventListener('click', event => { event.stopPropagation(); toggleExpressionLabelMode(members[0]!, members); updateMode(); });
                header.append(mode);
                a.badge.prepend(header);
            }
            leader.el.setAttribute('aria-label', rows.join('; '));
            a.rendered = signature; leader.boxW = null; leader.boxH = null;
        }
        for (const i of group.slice(1)) labels[i]!.annotationHidden = true;
    }
}

/** Common presentation layer owns snapping and row order; renderers stay independent. */
export function placeExpressionLabel(label: Label3D, x: number, y: number, clientX: number, clientY: number): void {
    const targets = labelsState.labels.filter(l => l.visible && !l.annotationHidden && l.annotation?.kind === 'label' && (l.annotationCoordinateMode ?? 'world') === (label.annotationCoordinateMode ?? 'world'));
    for (const target of targets) {
        const rows = Array.from(target.annotation!.badge.querySelectorAll<HTMLElement>('.annotation-row'));
        const others = rows.filter(row => Number(row.dataset.labelSeq) !== label.seq);
        if (!others.length) continue;
        const rect = target.el.getBoundingClientRect();
        if (clientX < rect.left - 8 || clientX > rect.right + 8 || clientY < rect.top - 8 || clientY > rect.bottom + 8) continue;
        const anchor = target.annotationAnchor ?? {x:target.screenX!, y:target.screenY!};
        const members = others.map(row => labelsState.labels.find(l => l.seq === Number(row.dataset.labelSeq))!);
        const insertion = annotationInsertionIndex(others.map(row => {const r = row.getBoundingClientRect(); return (r.top+r.bottom)/2;}), clientY);
        members.splice(insertion, 0, label);
        label.annotationDocked = true;
        members.forEach((member, index) => {
            setExpressionLabelPosition(member, anchor.x, anchor.y);
            member.annotationOrder = index;
        });
        return;
    }
    label.annotationDocked = false;
    setExpressionLabelPosition(label, x, y);
}

/** Move in the current mode. World placement uses the camera-facing plane at the label's depth. */
export function setExpressionLabelPosition(label: Label3D, x: number, y: number): void {
    if (label.annotationCoordinateMode === 'screen') {
        label.annotationPosition = {x,y};
        return;
    }
    const camera = labelsState.camera, renderer = labelsState.renderer;
    if (!camera || !renderer) return;
    const anchor = dataToWorld((label.annotationWorldPosition ?? label.dataPos) as [number,number,number]);
    const depth = new THREE.Vector3(...anchor).project(camera).z;
    const world = new THREE.Vector3(x / renderer.domElement.clientWidth * 2 - 1, 1 - y / renderer.domElement.clientHeight * 2, depth).unproject(camera);
    label.annotationWorldPosition = worldToData([world.x,world.y,world.z]);
}

export function toggleExpressionLabelMode(label: Label3D, members: Label3D[] = [label]): void {
    const toScreen = label.annotationCoordinateMode !== 'screen';
    members.forEach(member => {
        member.annotationCoordinateMode = toScreen ? 'screen' : 'world';
        if (toScreen) member.annotationPosition = {x: member.screenX ?? 0, y: member.screenY ?? 0};
        else {
            if (member.annotationPosition) setExpressionLabelPosition(member, member.annotationPosition.x, member.annotationPosition.y);
            member.annotationPosition = undefined;
        }
    });
    annotationLayoutKey = '';
}

// Front-to-back order for paint (z-index): nearest the camera first. On a near
// tie the moving label wins (it sits on top of what it passes over), then the
// later-painted label.
function frontToBack(a: Label3D, b: Label3D): number {
    const overlayA = a.annotationCoordinateMode === 'screen';
    const overlayB = b.annotationCoordinateMode === 'screen';
    if (overlayA !== overlayB) return overlayA ? -1 : 1;
    if (Math.abs(a.depth - b.depth) > 0.01) return a.depth - b.depth;
    if (a.moving !== b.moving) return a.moving ? -1 : 1;
    return b.seq - a.seq;
}

// Depth-based de-occlusion: labels never move. A label is dimmed only in
// proportion to how far it sits *behind* the nearest label overlapping it, in
// real world-space distance. Coplanar labels (no real depth gap) stay bright —
// so a label that merely shares a plane with its neighbours reads normally; only
// a label genuinely deeper than what's drawn over it recedes.
function resolveDepthDimming() {
    const active = [];
    for (const lbl of labelsState.labels) {
        lbl.targetDim = 1;
        lbl.targetFade = 1;
        if (lbl.visible && !lbl.annotation && !lbl.cellAttachment && lbl.boxW != null) active.push(lbl);
    }
    if (state.displayParams.labelDeclutterMode !== 'shade' || active.length < 2) return;

    const dimBase = state.displayParams.labelDimBase;        // slight dim any covered label gets
    const dimFloor = state.displayParams.labelDimFloor;      // darkest a far label goes
    const relScale = state.displayParams.labelDimDepthScale; // relative gap to reach the floor
    // Coerce/clamp: hideThreshold indexes into a sorted array below, so it must be
    // an integer; hideLevel is used as an opacity, so keep it in [0,1]. Guards the
    // params against out-of-range values set via the console or a future UI.
    const hideThreshold = Math.round(state.displayParams.labelDimHideThreshold); // cluster size that triggers near-hiding
    const hideLevel = Math.min(1, Math.max(0, state.displayParams.labelDimHideLevel)); // opacity the farthest fade to
    const boxes = new Map<Label3D, LabelBox>(active.map((l) => [l, labelBox(l)]));
    // Every label in `active` is in the map by construction.
    const overlaps = (a: Label3D, b: Label3D): boolean => {
        const A = boxes.get(a)!, B = boxes.get(b)!;
        return A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom;
    };

    for (const cluster of clusterByOverlap(active)) {
        if (cluster.length < 2) continue;
        // Big stack: keep the (threshold-1) nearest, near-hide everything farther.
        // The front labels still get the gentle proportional dim below; the tail is
        // faded out via opacity (not brightness) so a deep pile-up doesn't smear
        // into an unreadable blur — transparent reads far better than dark text.
        const hidden = new Set();
        if (hideThreshold >= 2 && cluster.length >= hideThreshold) {
            const byDepth = cluster.slice().sort(frontToBack);
            for (let r = hideThreshold - 1; r < byDepth.length; r++) {
                const far = byDepth[r]!;
                far.targetFade = hideLevel;   // opacity, not brightness — no dark text
                hidden.add(far);
            }
        }
        for (const lbl of cluster) {
            if (hidden.has(lbl)) continue; // already near-hidden as a far label in this stack

            let covered = false, nearestDepth = Infinity;
            for (const other of cluster) {
                if (other === lbl || !overlaps(lbl, other)) continue;
                // Only labels drawn in front of lbl cover it — measure the gap to
                // the nearest of *those*, ignoring overlappers that sit behind it.
                if (frontToBack(other, lbl) < 0) {
                    covered = true;
                    if (other.depth < nearestDepth) nearestDepth = other.depth;
                }
            }
            // A label with anything drawn over it gets a slight baseline dim (so
            // even coplanar overlaps read front-vs-back), then dims further toward
            // the floor in proportion to how much *farther* it is than what covers
            // it (relative, so it's scale-invariant).
            if (covered) {
                const gap = Math.max(0, lbl.depth - nearestDepth);
                const f = Math.min(1, (gap / nearestDepth) / relScale);
                lbl.targetDim = dimBase - f * (dimBase - dimFloor);
            }
        }
    }
}

// Position-based de-occlusion: nudge overlapping static labels apart vertically.
// Targets are a pure function of the (offset-free) anchor positions, so there is
// no feedback into detection and therefore no oscillation.
function resolveLabelOffsets() {
    const active = [];
    for (const lbl of labelsState.labels) {
        lbl.targetOffsetY = 0;
        // Only labels holding still are moved. A label glued to a moving marker
        // stays pinned and passes over static text (a purely-vertical offset
        // can't smoothly dodge a marker crossing through it anyway). When playback
        // pauses the marker rejoins the declutter so everything separates at rest.
        if (lbl.visible && !lbl.annotation && !lbl.cellAttachment && lbl.boxW != null && !lbl.moving) active.push(lbl);
    }
    if (state.displayParams.labelDeclutterMode !== 'position' || active.length < 2) return;

    const gap = state.displayParams.labelDeclutterGap;
    const maxStack = state.displayParams.labelDeclutterMaxStack;

    // Cluster labels whose boxes *actually* overlap in 2D, then stack each cluster.
    for (const cluster of clusterByOverlap(active)) {
        if (cluster.length < 2) continue;
        cluster.sort((a, b) => a.screenY! - b.screenY!);
        resolveVerticalStack(cluster, gap, maxStack);
    }
}

// Split a cluster (sorted top→bottom) into runs of labels that *actually* overlap
// vertically, and resolve each independently. A pair engages only when its boxes
// truly overlap (centre distance < mean height, gap excluded); resolution then
// spreads them to mean height + gap. The gap between engage and resolved spacing
// is a deadband that stops boundary jitter.
function resolveVerticalStack(cluster: Label3D[], gap: number, maxStack: number): void {
    const n = cluster.length;
    let i = 0;
    while (i < n) {
        let j = i;
        // Indices stay inside the run by the loop bounds; screenY/boxH are
        // populated by pass 1 before any of this runs.
        while (j + 1 < n
            && cluster[j + 1]!.screenY! - cluster[j]!.screenY! < (cluster[j]!.boxH! + cluster[j + 1]!.boxH!) / 2) {
            j++;
        }
        if (j > i) resolveRun(cluster, i, j, gap, maxStack);
        i = j + 1;
    }
}

// Pool-Adjacent-Violators (isotonic regression) over one engaged run: minimal-
// displacement separation to mean height + gap, with compression past maxStack.
function resolveRun(cluster: Label3D[], start: number, end: number, gap: number, maxStack: number): void {
    const n = end - start + 1;
    const S: number[] = new Array(n);
    S[0] = 0;
    for (let k = 1; k < n; k++) {
        S[k] = S[k - 1]! + (cluster[start + k - 1]!.boxH! + cluster[start + k]!.boxH!) / 2 + gap;
    }
    const desired: number[] = [];
    for (let k = 0; k < n; k++) desired[k] = cluster[start + k]!.screenY! - S[k]!;

    /** One pooled block of the isotonic regression (mean = sum / size). */
    interface PavBlock { sum: number; size: number; k0: number; }
    const blocks: PavBlock[] = [];
    for (let k = 0; k < n; k++) {
        let b: PavBlock = { sum: desired[k]!, size: 1, k0: k };
        while (blocks.length && blocks[blocks.length - 1]!.sum / blocks[blocks.length - 1]!.size > b.sum / b.size) {
            const prev = blocks.pop()!;
            b = { sum: prev.sum + b.sum, size: prev.size + b.size, k0: prev.k0 };
        }
        blocks.push(b);
    }

    for (const b of blocks) {
        const mean = b.sum / b.size;
        const scale = Math.min(1, maxStack / Math.max(1, b.size - 1));
        let sAvg = 0;
        for (let k = b.k0; k < b.k0 + b.size; k++) sAvg += S[k]!;
        sAvg /= b.size;
        for (let k = b.k0; k < b.k0 + b.size; k++) {
            const finalY = mean + sAvg + (S[k]! - sAvg) * scale;
            const lbl = cluster[start + k]!;
            lbl.targetOffsetY = finalY - lbl.screenY!;
        }
    }
}

// Screen-space box of a label, honoring its anchor alignment (labels are
// vertically centered on screenY via the CSS translate(-50%)).
/** Screen-space bounds of a label. Only ever called on labels that pass 1 has
 *  projected and measured, so screenX/screenY/boxW/boxH are populated — `!`
 *  keeps a caller that skipped that failing loudly instead of silently
 *  comparing NaN boxes. */
interface LabelBox { left: number; right: number; top: number; bottom: number; }

function labelBox(l: Label3D): LabelBox {
    const left = l.align === 'right' ? l.screenX! - l.boxW!
        : l.align === 'left' ? l.screenX! : l.screenX! - l.boxW! / 2;
    return { left, right: left + l.boxW!, top: l.screenY! - l.boxH! / 2, bottom: l.screenY! + l.boxH! / 2 };
}

function clusterByOverlap(labels: Label3D[]): Label3D[][] {
    const n = labels.length;
    const boxes = labels.map(labelBox);
    const parent = labels.map((_, i) => i);
    // Union-find over indices in [0,n), so every lookup is in range.
    const find = (i: number): number => {
        while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; }
        return i;
    };
    for (let i = 0; i < n; i++) {
        const a = boxes[i]!;
        for (let j = i + 1; j < n; j++) {
            const b = boxes[j]!;
            // Real box intersection on both axes — no gap padding, so labels
            // resting a gap apart are not engaged (that gap is the deadband that
            // keeps boundary cases from flickering in and out of a cluster).
            if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
                parent[find(i)] = find(j);
            }
        }
    }
    const groups = new Map<number, Label3D[]>();
    for (let i = 0; i < n; i++) {
        const r = find(i);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r)!.push(labels[i]!);
    }
    return [...groups.values()];
}

// ----- AI ask-button helpers -----

export function openChatPanel() {
    const panel = document.getElementById('explanation-panel');
    const handle = document.getElementById('panel-resize-handle');
    const toggle = document.getElementById('explain-toggle');
    if (panel && panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        if (handle) handle.style.display = 'block';
        if (toggle) { toggle.style.display = 'block'; toggle.classList.add('active'); }
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    }
    if (typeof switchPanelTab === 'function') switchPanelTab('chat');
}

/** Build an AI ask-button. `getMessage` may return null/'' when there is nothing
 *  to ask about (e.g. the proof step-ask chip before it is anchored to a step);
 *  the click is then a complete no-op — no chat panel, no input text, no send —
 *  matching the proof engine's own routed ask button. */
export function makeAiAskButton(
    className: string,
    title: string,
    getMessage: () => string | null,
): HTMLButtonElement {
    return _makeAiAskButton(className, title, getMessage, false);
}

/**
 * makeAiAskButton, but the prompt is sent without being posted as the
 * learner's message — only the AI's reply shows, as the tour and the
 * learning-plan guide do. For prompts that are instructions to the tutor
 * rather than something the learner would type (the quiz's hint rules, say).
 * ⌘-click still puts the prompt in the input to edit.
 *
 * With no question visible in the chat, the wait for the reply would read as
 * nothing happening, so the button reports it: `aria-busy` is set while the
 * reply is pending, and an `ai-ask-pending` event (detail: boolean) fires when
 * that starts and ends — callers show a "thinking" indicator from it.
 */
export function makeSilentAiAskButton(
    className: string,
    title: string,
    getMessage: () => string | null,
): HTMLButtonElement {
    return _makeAiAskButton(className, title, getMessage, true);
}

/** True while a chat turn is in flight (chat.ts owns the state). */
function _chatBusy(): boolean {
    return typeof window.algebenchChatBusy === 'function' && window.algebenchChatBusy();
}

let _busyListening = false;
/**
 * Every Ask-AI button reflects the chat's single-flight state: disabled while
 * a turn is in flight, so no control offers a send the chat would turn away.
 * One listener for all of them, installed with the first button.
 */
function _followChatBusy(): void {
    if (_busyListening || typeof window.addEventListener !== 'function') return;
    _busyListening = true;
    window.addEventListener('algebench:chatbusy', (e) => {
        const busy = !!(e as CustomEvent<{ busy: boolean }>).detail?.busy;
        document.querySelectorAll<HTMLButtonElement>('button[data-ai-ask]').forEach((b) => { b.disabled = busy; });
    });
}

function _makeAiAskButton(
    className: string,
    title: string,
    getMessage: () => string | null,
    silent: boolean,
): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';   // never submit an enclosing form
    btn.className = className;
    btn.title = title + '\n\nClick to send · ⌘-click (Ctrl on Windows) to edit';
    btn.setAttribute('aria-label', title);
    btn.innerHTML = AI_SPARKLE_SVG;
    btn.setAttribute('data-ai-ask', '');
    btn.disabled = _chatBusy();   // created while a turn is in flight
    _followChatBusy();
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Messages are built from source text (labels, descriptions), so
        // glossary markers are stripped here once for every Ask AI button.
        const raw = getMessage();
        const message = raw ? stripGlossaryMarkers(raw) : raw;
        if (!message) return;
        openChatPanel();
        if (e.metaKey || e.ctrlKey) {
            const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
            if (input) {
                input.value = message;
                input.focus();
                input.dispatchEvent(new Event('input'));
            }
            return;
        }
        if (typeof sendChatMessage !== 'function') return;
        // Single-flight (chat.ts): a turn already in flight would turn this
        // one away — so don't send, and don't report a pending ask that
        // isn't happening (the quiz advances its hint ladder on that event).
        if (_chatBusy()) return;
        const sending = sendChatMessage(message, { silent });
        if (!silent) return;
        const pending = (on: boolean) => {
            btn.setAttribute('aria-busy', on ? 'true' : 'false');
            btn.dispatchEvent(new CustomEvent('ai-ask-pending', { detail: on }));
        };
        pending(true);
        void Promise.resolve(sending).catch(() => undefined).finally(() => pending(false));
    });
    return btn;
}

// Derivation ("∴") glyph — a small three-step icon for Derive buttons. Shared by
// the semantic-graph node Derive button and the proof-card per-step button so
// the two look identical.
export const DERIVE_SVG =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" '
    + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M3 3h7"/><path d="M3 8h10"/><path d="M3 13h6"/>'
    + '<path d="M12.5 11l2 2-2 2" transform="translate(-1 -3.5)"/></svg>';

/** Build a Derive icon button (matches the AI ask-button styling). `onClick`
 *  fires on click; propagation is stopped so it never triggers row handlers. */
export function makeDeriveButton(
    className: string,
    title: string,
    onClick: (e: MouseEvent) => void,
): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = DERIVE_SVG;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(e);
    });
    return btn;
}

export function elementToMarkdown(el: Element): string {
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll('.katex-display').forEach((dispEl) => {
        const ann = dispEl.querySelector('annotation[encoding="application/x-tex"]');
        // A KaTeX annotation always carries text; `!` keeps a malformed one
        // throwing rather than emitting the string "undefined" into the markdown.
        if (ann) dispEl.replaceWith(`$$${stripGlossaryMath(ann.textContent!.trim())}$$`);
    });
    clone.querySelectorAll('.katex').forEach((inlineEl) => {
        const ann = inlineEl.querySelector('annotation[encoding="application/x-tex"]');
        if (ann) inlineEl.replaceWith(`$${stripGlossaryMath(ann.textContent!.trim())}$`);
    });
    return clone.textContent!.trim();
}

export function injectAskButtons(contentEl: Element): void {
    contentEl.querySelectorAll<HTMLElement>('h1, h2, h3, p, li').forEach((el) => {
        const markdown = el.dataset.markdown || elementToMarkdown(el);
        if (!markdown || markdown.length < 10) return;
        const btn = makeAiAskButton('ai-ask-btn', 'Explain this', () => 'Can you explain this:\n' + markdown.trim());
        while (el.lastChild && el.lastChild.nodeType === 3 && !el.lastChild.textContent!.trim()) {
            el.removeChild(el.lastChild);
        }
        const lastEl = el.lastElementChild;
        if (lastEl && lastEl.classList && lastEl.classList.contains('katex-display')) {
            const mathRow = document.createElement('span');
            mathRow.className = 'doc-ai-math-row';
            btn.classList.add('ai-ask-btn--math-side');
            lastEl.replaceWith(mathRow);
            mathRow.appendChild(lastEl);
            mathRow.appendChild(btn);
            return;
        }
        el.appendChild(btn);
    });
}
