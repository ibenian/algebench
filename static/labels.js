// ============================================================
// Labels, KaTeX/markdown rendering, color parsing, and the
// AI ask-button helpers.
// ============================================================

import { state } from '/state.js';
import { dataToWorld } from '/coords.js';

export const AI_SPARKLE_SVG = '<svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11"><path d="M8 1c0 4-3 6.5-7 7 4 .5 7 3 7 7 0-4 3-6.5 7-7-4-.5-7-3-7-7z"/></svg>';

// ----- Utility -----

export function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

export function stripLatex(text) {
    if (!text) return '';
    return text.replace(/\$\$([^$]*)\$\$/g, '$1').replace(/\$([^$]*)\$/g, '$1');
}

// KaTeX html-macro wrappers that an expression carries for highlighting/metadata
// but the LaTeX→graph parser (and loose text comparison) can't read.
const _HTML_MACROS = ['htmlClass', 'htmlData', 'htmlId', 'htmlStyle'];

/** Strip KaTeX \htmlClass/\htmlData/\htmlId/\htmlStyle wrappers, keeping their
 *  inner content (recursively). Leaves malformed wrappers intact. */
export function stripHtmlMacros(s) {
    if (!s) return s;
    const str = String(s);
    // Return the index just past the '}' matching the '{' at k, or -1 if unbalanced.
    const skipBalanced = (k) => {
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
        const m = str[i] === '\\' && _HTML_MACROS.find(x => str.startsWith('\\' + x, i));
        if (!m) { out += str[i++]; continue; }
        let k = i + 1 + m.length;
        while (k < str.length && /\s/.test(str[k])) k++;       // ws before the class/data arg
        const arg1End = str[k] === '{' ? skipBalanced(k) : -1;
        let c = arg1End;
        if (c > 0) while (c < str.length && /\s/.test(str[c])) c++;   // ws before the content arg
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
export function normLatex(s) {
    return (s || '')
        .replace(/\\(?:text|mathrm|mathbf|operatorname)\s*\{([^{}]*)\}/g, '$1')
        .replace(/\\le(?![a-zA-Z])/g, '\\leq')
        .replace(/\\ge(?![a-zA-Z])/g, '\\geq')
        .replace(/[\s{}]/g, '');
}

// ----- KaTeX rendering -----

export function renderKaTeX(text, displayMode) {
    if (!text) return '';
    // Pre-pass 1: extract markdown tables (before $ splitting, since cells contain LaTeX).
    // Each table is rendered independently (cells get renderKaTeX) and replaced with a sentinel.
    const tables = [];
    const withTables = text.replace(
        /^(\|.+\|)\n(\|[\s:?-]+(?:\|[\s:?-]+)+\|)\n((?:\|.+\|\n?)+)/gm,
        (match, headerLine, sepLine, bodyBlock) => {
            const parseRow = (row) => {
                const content = row.replace(/^\|/, '').replace(/\|$/, '');
                const cells = [];
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
            const rows = bodyBlock.trim().split('\n').map(r => parseRow(r));
            const tableStyle = 'border-collapse:collapse;margin:6px 0;font-size:0.9em';
            const cellStyle = 'padding:3px 8px;border:1px solid rgba(255,255,255,0.15)';
            const thStyle = cellStyle + ';font-weight:bold;background:rgba(255,255,255,0.06)';
            let html = `<table style="${tableStyle}"><thead><tr>`;
            html += headers.map(h => `<th style="${thStyle}">${renderKaTeX(h, false)}</th>`).join('');
            html += '</tr></thead><tbody>';
            for (const row of rows) {
                html += '<tr>' + row.map(c => `<td style="${cellStyle}">${renderKaTeX(c, false)}</td>`).join('') + '</tr>';
            }
            html += '</tbody></table>';
            tables.push(html);
            return `\x01T${tables.length - 1}\x01`;
        }
    );
    // Pre-pass 2: extract heading lines so LaTeX inside them isn't split apart.
    const headings = [];
    let prepped = withTables.replace(/^(#{1,3})\s+(.+)$/gm, (_, hashes, content) => {
        const sz = ['1.05em', '0.95em', '0.88em'][hashes.length - 1];
        headings.push(`<div style="font-size:${sz};font-weight:bold;margin:3px 0 1px">${renderKaTeX(content, false)}</div>`);
        return `\x01H${headings.length - 1}\x01`;
    });
    // Pre-pass 3: extract `code` spans so asterisks inside them
    // (e.g. `*args`) aren't consumed by the bold/italic pass.
    const codeSpans = [];
    prepped = prepped.replace(/`(.+?)`/g, (match, inner) => {
        codeSpans.push(inner);
        return `\x01C${codeSpans.length - 1}\x01`;
    });
    // Pre-pass 4: extract $$ and $ math blocks so asterisks inside them
    // (e.g. $T^*$, $A*B$) aren't consumed by the bold/italic pass.
    const mathSpans = [];
    prepped = prepped.replace(/(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g, (match) => {
        mathSpans.push(match);
        return `\x01M${mathSpans.length - 1}\x01`;
    });
    // Pre-pass 4: extract **bold** and *italic* spans that may contain $math$ inside,
    // so the $ split doesn't break the markers apart.
    const boldSpans = [];
    prepped = prepped.replace(/\*\*(.+?)\*\*/g, (match, inner) => {
        boldSpans.push(inner);
        return `\x01B${boldSpans.length - 1}\x01`;
    });
    const italicSpans = [];
    prepped = prepped.replace(/\*(.+?)\*/g, (match, inner) => {
        italicSpans.push(inner);
        return `\x01I${italicSpans.length - 1}\x01`;
    });
    // Restore math sentinels everywhere before the $ split
    const restoreMath = s => s.replace(/\x01M(\d+)\x01/g, (m, idx) => mathSpans[+idx]);
    prepped = restoreMath(prepped);
    for (let i = 0; i < boldSpans.length; i++) boldSpans[i] = restoreMath(boldSpans[i]);
    for (let i = 0; i < italicSpans.length; i++) italicSpans[i] = restoreMath(italicSpans[i]);
    const segments = prepped.split(/(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g);
    return segments.map((seg, i) => {
        if (i % 2 === 0) {
            const lines = escapeHtml(seg).split(/\\n|\n/);
            return lines.map((line, li) => {
                const t = line.trim();
                // Restore heading sentinel
                const hIdx = t.match(/^\x01H(\d+)\x01$/);
                if (hIdx) return headings[+hIdx[1]];
                // Restore table sentinel
                const tIdx = t.match(/^\x01T(\d+)\x01$/);
                if (tIdx) return tables[+tIdx[1]];
                const hm = t.match(/^(#{1,3})\s+(.*)/);
                if (hm) {
                    const sz = ['1.05em', '0.95em', '0.88em'][hm[1].length - 1];
                    return `<div style="font-size:${sz};font-weight:bold;margin:3px 0 1px">${hm[2]}</div>`;
                }
                if (t === '---') return '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.2);margin:4px 0">';
                const inline = line
                    .replace(/\x01B(\d+)\x01/g, (m, idx) => `<strong>${renderKaTeX(boldSpans[+idx], false)}</strong>`)
                    .replace(/\x01I(\d+)\x01/g, (m, idx) => `<em>${renderKaTeX(italicSpans[+idx], false)}</em>`)
                    .replace(/\x01C(\d+)\x01/g, (m, idx) => `<code>${codeSpans[+idx]}</code>`)
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\*(.+?)\*/g, '<em>$1</em>')
                    .replace(/`(.+?)`/g, '<code>$1</code>');
                return li < lines.length - 1 ? inline + '<br>' : inline;
            }).join('');
        } else if (seg.startsWith('$$')) {
            const tex = seg.slice(2, -2);
            try { return katex.renderToString(tex, { throwOnError: false, strict: false, displayMode: true, trust: (ctx) => ctx.command === '\\htmlClass' }); }
            catch(e) { return escapeHtml(seg); }
        } else {
            const tex = seg.slice(1, -1);
            try { return katex.renderToString(tex, { throwOnError: false, strict: false, displayMode: false, trust: (ctx) => ctx.command === '\\htmlClass' }); }
            catch(e) { return escapeHtml(seg); }
        }
    }).join('');
}

// ----- Markdown rendering (LaTeX-safe two-pass) -----

export function renderMarkdown(md) {
    if (!md) return '';
    let mathBlocks = [];

    let safe = md.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => {
        mathBlocks.push({ tex: tex.trim(), display: true });
        return '%%MATH_BLOCK_' + (mathBlocks.length - 1) + '%%';
    });
    safe = safe.replace(/\$([^$\n]+)\$/g, (m, tex) => {
        mathBlocks.push({ tex: tex.trim(), display: false });
        return '%%MATH_BLOCK_' + (mathBlocks.length - 1) + '%%';
    });

    let html = marked.parse(safe);
    html = html.replace(/%%MATH_BLOCK_(\d+)%%/g, (m, idx) => {
        const block = mathBlocks[parseInt(idx)];
        try {
            return katex.renderToString(block.tex, { throwOnError: false, strict: false, displayMode: block.display, trust: (ctx) => ctx.command === '\\htmlClass' });
        } catch(e) { return block.tex; }
    });

    return html;
}

// ----- Color parsing -----

export function parseColor(c) {
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
        const named = {
            'red': [1,0.2,0.2], 'green': [0.2,0.9,0.2], 'blue': [0.3,0.4,1],
            'yellow': [1,1,0.2], 'cyan': [0.2,1,1], 'magenta': [1,0.2,1],
            'orange': [1,0.6,0.1], 'purple': [0.7,0.3,1], 'white': [1,1,1],
            'gray': [0.5,0.5,0.5], 'grey': [0.5,0.5,0.5], 'pink': [1,0.5,0.7],
        };
        return named[c.toLowerCase()] || [0.5, 0.5, 1];
    }
    if (Array.isArray(c)) return c.map(v => v > 1 ? v/255 : v);
    return [0.5, 0.5, 1];
}

export function colorToCSS(c) {
    const rgb = parseColor(c);
    return `rgb(${Math.round(rgb[0]*255)}, ${Math.round(rgb[1]*255)}, ${Math.round(rgb[2]*255)})`;
}

// ----- Label system -----

export function addLabel3D(text, dataPos, color, opts) {
    if (typeof opts === 'string') opts = { cssClass: opts };
    opts = opts || {};
    const container = document.getElementById('labels-container');
    const el = document.createElement('div');
    el.className = opts.cssClass || 'label-3d';
    el.innerHTML = renderKaTeX(text, false);
    if (color) el.style.color = colorToCSS(color);
    container.appendChild(el);
    const align = opts.align || 'center';
    const entry = {
        el, dataPos: dataPos.slice(), screenX: null, screenY: null, forceHidden: false, align,
        offsetY: 0,           // applied vertical de-occlusion offset (px)
        boxW: null, boxH: null, // cached DOM size (measured lazily)
        boxScale: null,       // labelScale the cached size was measured at
        lastDataPos: null,    // dataPos from the previous frame (motion detection)
        moveCooldown: 0,      // frames remaining while treated as "animating"
    };
    state.labels.push(entry);
    return entry;
}

export function clearLabels() {
    const container = document.getElementById('labels-container');
    container.innerHTML = '';
    state.labels = [];
}

export function updateLabels() {
    if (!state.camera || !state.renderer) return;
    const w = state.renderer.domElement.clientWidth;
    const h = state.renderer.domElement.clientHeight;
    const s = state.displayParams.labelScale;

    // ----- Pass 1: project + measure (reads only) -----
    for (const lbl of state.labels) {
        // A label whose data position is animating is "glued" to a moving marker
        // (a rider dot, an animated point). Exclude it from declutter so it stays
        // pinned to its marker instead of being nudged off it as it sweeps past
        // other labels. Gate on dataPos (not screen position) so camera-only
        // motion still declutters. The cooldown holds the exclusion through brief
        // pauses (e.g. a turnaround) so a slow stretch doesn't re-engage and
        // blip; once motion truly settles the label declutters again.
        const dp = lbl.dataPos;
        const dataMoved = lbl.lastDataPos && (
            Math.abs(dp[0] - lbl.lastDataPos[0]) > 1e-6 ||
            Math.abs(dp[1] - lbl.lastDataPos[1]) > 1e-6 ||
            Math.abs(dp[2] - lbl.lastDataPos[2]) > 1e-6);
        if (dataMoved) lbl.moveCooldown = 20;
        else if (lbl.moveCooldown > 0) lbl.moveCooldown--;
        lbl.lastDataPos = [dp[0], dp[1], dp[2]];
        lbl.moving = lbl.moveCooldown > 0;

        const world = dataToWorld(dp);
        const v = new THREE.Vector3(world[0], world[1], world[2]);
        const projected = v.project(state.camera);
        const targetX = (projected.x * 0.5 + 0.5) * w;
        const targetY = (-projected.y * 0.5 + 0.5) * h;
        lbl.visible = !lbl.forceHidden && projected.z < 1
            && targetX > -50 && targetX < w + 50
            && targetY > -50 && targetY < h + 50;

        if (lbl.screenX == null || lbl.screenY == null) {
            lbl.screenX = targetX;
            lbl.screenY = targetY;
        } else {
            const alpha = 0.3;
            lbl.screenX += (targetX - lbl.screenX) * alpha;
            lbl.screenY += (targetY - lbl.screenY) * alpha;
        }

        // Cache effective box size; re-measure only when labelScale changes.
        if (lbl.visible && (lbl.boxW == null || lbl.boxScale !== s)) {
            lbl.boxW = lbl.el.offsetWidth * s;
            lbl.boxH = lbl.el.offsetHeight * s;
            lbl.boxScale = s;
        }
    }

    // ----- Pass 2: resolve vertical de-occlusion offsets (pure compute) -----
    resolveLabelOffsets();

    // ----- Pass 3: smooth applied offset + write transforms -----
    for (const lbl of state.labels) {
        const target = lbl.targetOffsetY || 0;
        lbl.offsetY += (target - lbl.offsetY) * state.displayParams.labelDeclutterAlpha;
        const ax = lbl.align === 'right' ? '-100%' : lbl.align === 'left' ? '0%' : '-50%';
        const y = lbl.screenY + lbl.offsetY;
        lbl.el.style.transform = `translate(${lbl.screenX}px, ${y}px) translate(${ax}, -50%)${s !== 1 ? ' scale(' + s + ')' : ''}`;
        lbl.el.style.opacity = lbl.visible ? state.displayParams.labelOpacity : '0';
    }
}

// Compute a target vertical offset per label so overlapping labels stack apart.
// Targets are a pure function of the (offset-free) anchor positions, so there is
// no feedback into detection and therefore no oscillation.
function resolveLabelOffsets() {
    const items = [];
    for (const lbl of state.labels) {
        lbl.targetOffsetY = 0;
        // Animating labels (glued to a moving marker) participate as immovable
        // *obstacles* — static text slides around them — but are never offset
        // themselves (moving a glued label off its marker looks wrong and is hard
        // to track). Static labels are the only ones that actually move.
        if (lbl.visible && lbl.boxW != null) items.push(lbl);
    }
    if (!state.displayParams.labelDeclutter || items.length < 2) return;

    const gap = state.displayParams.labelDeclutterGap;
    const maxStack = state.displayParams.labelDeclutterMaxStack;

    // Cluster labels whose boxes *actually* overlap in 2D — a label only occludes
    // another when they intersect on BOTH axes. Clustering on x alone would drag
    // together labels that merely share a column (bridged by a wide neighbor) and
    // shove them apart vertically even though they never touch.
    const clusters = clusterByOverlap(items);
    for (const cluster of clusters) {
        if (cluster.length < 2) continue;
        // Nothing to do if every label in the cluster is a fixed obstacle.
        if (!cluster.some(l => !l.moving)) continue;
        cluster.sort((a, b) => a.screenY - b.screenY);
        resolveVerticalStack(cluster, gap, maxStack);
    }
    // Enforce the invariant: obstacle (moving) labels never carry an offset.
    for (const lbl of state.labels) if (lbl.moving) lbl.targetOffsetY = 0;
}

// Screen-space box of a label, honoring its anchor alignment (labels are
// vertically centered on screenY via the CSS translate(-50%)).
function labelBox(l) {
    const left = l.align === 'right' ? l.screenX - l.boxW
        : l.align === 'left' ? l.screenX : l.screenX - l.boxW / 2;
    return { left, right: left + l.boxW, top: l.screenY - l.boxH / 2, bottom: l.screenY + l.boxH / 2 };
}

function clusterByOverlap(labels) {
    const n = labels.length;
    const boxes = labels.map(labelBox);
    const parent = labels.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let i = 0; i < n; i++) {
        const a = boxes[i];
        for (let j = i + 1; j < n; j++) {
            const b = boxes[j];
            // Real box intersection on both axes — no gap padding, so labels
            // resting a gap apart are not engaged (that gap is the deadband that
            // keeps boundary cases from flickering in and out of a cluster).
            if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
                parent[find(i)] = find(j);
            }
        }
    }
    const groups = new Map();
    for (let i = 0; i < n; i++) {
        const r = find(i);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(labels[i]);
    }
    return [...groups.values()];
}

// Split a horizontal cluster (sorted top→bottom) into runs of labels that
// *actually* overlap vertically, and resolve each run independently. A pair is
// only "engaged" when its boxes truly overlap (center distance < mean height,
// gap excluded); resolution then spreads them to mean height + gap. Because the
// resolved spacing exceeds the engage threshold, resolved labels can't
// re-trigger, and labels merely sitting a gap apart are never touched — this
// deadband is what stops boundary jitter.
function resolveVerticalStack(cluster, gap, maxStack) {
    const n = cluster.length;
    let i = 0;
    while (i < n) {
        let j = i; // extend the run while consecutive boxes overlap
        while (j + 1 < n
            && cluster[j + 1].screenY - cluster[j].screenY < (cluster[j].boxH + cluster[j + 1].boxH) / 2) {
            j++;
        }
        if (j > i) resolveRun(cluster, i, j, gap, maxStack);
        i = j + 1;
    }
}

// Pool-Adjacent-Violators (isotonic regression) over one engaged run
// cluster[start..end]: minimal-displacement vertical separation to mean
// height + gap, with continuous compression past maxStack.
function resolveRun(cluster, start, end, gap, maxStack) {
    const n = end - start + 1;
    // S[k] = cumulative target separation from the run's first label down to k.
    // Subtracting it turns the non-overlap constraints into a monotonicity
    // constraint, so the least-squares fit is plain isotonic regression.
    const S = new Array(n);
    S[0] = 0;
    for (let k = 1; k < n; k++) {
        S[k] = S[k - 1] + (cluster[start + k - 1].boxH + cluster[start + k].boxH) / 2 + gap;
    }
    const desired = [];
    for (let k = 0; k < n; k++) desired[k] = cluster[start + k].screenY - S[k];

    // Fixed obstacles (moving labels) get an overwhelming weight so the weighted
    // least-squares fit leaves them essentially in place and pushes the static
    // labels around them instead.
    const OBSTACLE_W = 1e6;
    const wOf = (k) => cluster[start + k].moving ? OBSTACLE_W : 1;

    // Weighted PAVA: pool adjacent blocks whenever the previous block's weighted
    // mean exceeds the next's, producing a non-decreasing sequence of means.
    const blocks = []; // { wsum, w, size, k0, hasFixed }  (mean = wsum / w)
    for (let k = 0; k < n; k++) {
        const wk = wOf(k);
        let b = { wsum: wk * desired[k], w: wk, size: 1, k0: k, hasFixed: cluster[start + k].moving };
        while (blocks.length && blocks[blocks.length - 1].wsum / blocks[blocks.length - 1].w > b.wsum / b.w) {
            const prev = blocks.pop();
            b = { wsum: prev.wsum + b.wsum, w: prev.w + b.w, size: prev.size + b.size, k0: prev.k0, hasFixed: prev.hasFixed || b.hasFixed };
        }
        blocks.push(b);
    }

    // Final center of label k = block mean + S[k]. Compress overcrowded static
    // stacks past maxStack, but never compress a block pinned by an obstacle
    // (that would drag static labels back onto it).
    for (const b of blocks) {
        const mean = b.wsum / b.w;
        const scale = b.hasFixed ? 1 : Math.min(1, maxStack / Math.max(1, b.size - 1));
        let sAvg = 0;
        for (let k = b.k0; k < b.k0 + b.size; k++) sAvg += S[k];
        sAvg /= b.size;
        for (let k = b.k0; k < b.k0 + b.size; k++) {
            const lbl = cluster[start + k];
            const finalY = mean + sAvg + (S[k] - sAvg) * scale;
            let off = finalY - lbl.screenY;
            // Yield cap: a static label steps aside for a moving obstacle only up
            // to about its own height. A larger push means the obstacle is passing
            // *through* it (e.g. a rider lingering/reversing on its own worldline),
            // where the minimal-displacement side keeps flipping — so hold still
            // and let it briefly occlude instead of making a big, jumpy swing.
            if (b.hasFixed && !lbl.moving && Math.abs(off) > lbl.boxH) off = 0;
            lbl.targetOffsetY = off;
        }
    }
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

export function makeAiAskButton(className, title, getMessage) {
    const btn = document.createElement('button');
    btn.className = className;
    btn.title = title + '\n\nClick to send · ⌘-click (Ctrl on Windows) to edit';
    btn.innerHTML = AI_SPARKLE_SVG;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const message = getMessage();
        openChatPanel();
        if (e.metaKey || e.ctrlKey) {
            const input = document.getElementById('chat-input');
            if (input) {
                input.value = message;
                input.focus();
                input.dispatchEvent(new Event('input'));
            }
            return;
        }
        if (typeof sendChatMessage !== 'function') return;
        sendChatMessage(message);
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
export function makeDeriveButton(className, title, onClick) {
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

export function elementToMarkdown(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.katex-display').forEach(dispEl => {
        const ann = dispEl.querySelector('annotation[encoding="application/x-tex"]');
        if (ann) dispEl.replaceWith(`$$${ann.textContent.trim()}$$`);
    });
    clone.querySelectorAll('.katex').forEach(inlineEl => {
        const ann = inlineEl.querySelector('annotation[encoding="application/x-tex"]');
        if (ann) inlineEl.replaceWith(`$${ann.textContent.trim()}$`);
    });
    return clone.textContent.trim();
}

export function injectAskButtons(contentEl) {
    contentEl.querySelectorAll('h1, h2, h3, p, li').forEach(el => {
        const markdown = el.dataset.markdown || elementToMarkdown(el);
        if (!markdown || markdown.length < 10) return;
        const btn = makeAiAskButton('ai-ask-btn', 'Explain this', () => 'Can you explain this:\n' + markdown.trim());
        while (el.lastChild && el.lastChild.nodeType === 3 && !el.lastChild.textContent.trim()) {
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
