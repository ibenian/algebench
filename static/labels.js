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

// ----- KaTeX rendering -----

export function renderKaTeX(text, displayMode) {
    if (!text) return '';
    // Pre-pass: extract heading lines so LaTeX inside them isn't split apart.
    // Each heading line is rendered independently and replaced with a sentinel.
    const headings = [];
    const prepped = text.replace(/^(#{1,3})\s+(.+)$/gm, (_, hashes, content) => {
        const sz = ['1.05em', '0.95em', '0.88em'][hashes.length - 1];
        headings.push(`<div style="font-size:${sz};font-weight:bold;margin:3px 0 1px">${renderKaTeX(content, false)}</div>`);
        return `\x01H${headings.length - 1}\x01`;
    });
    const segments = prepped.split(/(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g);
    return segments.map((seg, i) => {
        if (i % 2 === 0) {
            const lines = escapeHtml(seg).split(/\\n|\n/);
            return lines.map((line, li) => {
                const t = line.trim();
                // Restore heading (sentinel survives escapeHtml unchanged).
                const hIdx = t.match(/^\x01H(\d+)\x01$/);
                if (hIdx) return headings[+hIdx[1]];
                const hm = t.match(/^(#{1,3})\s+(.*)/);
                if (hm) {
                    const sz = ['1.05em', '0.95em', '0.88em'][hm[1].length - 1];
                    return `<div style="font-size:${sz};font-weight:bold;margin:3px 0 1px">${hm[2]}</div>`;
                }
                if (t === '---') return '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.2);margin:4px 0">';
                const inline = line
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

export function addLabel3D(text, dataPos, color, cssClass) {
    const container = document.getElementById('labels-container');
    const el = document.createElement('div');
    el.className = cssClass || 'label-3d';
    el.innerHTML = renderKaTeX(text, false);
    if (color) el.style.color = colorToCSS(color);
    container.appendChild(el);
    const entry = { el, dataPos: dataPos.slice(), screenX: null, screenY: null, forceHidden: false };
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

    for (const lbl of state.labels) {
        const world = dataToWorld(lbl.dataPos);
        const v = new THREE.Vector3(world[0], world[1], world[2]);
        const projected = v.project(state.camera);
        const targetX = (projected.x * 0.5 + 0.5) * w;
        const targetY = (-projected.y * 0.5 + 0.5) * h;
        const visible = !lbl.forceHidden && projected.z < 1
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
        const s = state.displayParams.labelScale;
        lbl.el.style.transform = `translate(${lbl.screenX}px, ${lbl.screenY}px) translate(-50%, -50%)${s !== 1 ? ' scale(' + s + ')' : ''}`;
        lbl.el.style.opacity = visible ? state.displayParams.labelOpacity : '0';
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
    btn.title = title;
    btn.innerHTML = AI_SPARKLE_SVG;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof sendChatMessage !== 'function') return;
        openChatPanel();
        sendChatMessage(getMessage());
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
            const mathRow = document.createElement('div');
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
