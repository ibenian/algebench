// ============================================================
// Overlay — explanation panel, title bar, legend, info overlays,
// settings panel, status bar, and scene description drag.
// ============================================================

import { state } from '/state.js';
import { renderMarkdown, renderKaTeX, parseColor, colorToCSS, injectAskButtons, makeAiAskButton } from '/labels.js';
import { compileExpr, evalExpr, _getMathNamesAndValues, EXTENSION_NAMES } from '/expr.js';
import { getSliderIds, syncSliderState } from '/sliders.js';
import { worldCameraToData } from '/coords.js';

// Forward reference for buildSceneTree — assigned by context-browser.js via
// setBuildSceneTreeFn() to avoid a circular import.
let _buildSceneTreeFn = null;
export function setBuildSceneTreeFn(fn) { _buildSceneTreeFn = fn; }

// ----- Explanation Panel -----

export function updateExplanationPanel(spec) {
    const panel = document.getElementById('explanation-panel');
    const content = document.getElementById('explanation-content');
    const handle = document.getElementById('panel-resize-handle');
    const toggle = document.getElementById('explain-toggle');

    if (spec && spec.markdown) {
        content.innerHTML = renderMarkdown(spec.markdown);
        content.dataset.markdown = spec.markdown;
        injectAskButtons(content);
    } else {
        content.innerHTML = '<p style="color: rgba(180,180,200,0.5); font-style: italic;">No explanation available for this scene.</p>';
    }

    panel.classList.remove('hidden');
    handle.style.display = 'block';
    toggle.style.display = 'block';
    toggle.classList.add('active');

    // Restore saved width
    const savedWidth = localStorage.getItem('algebench-panel-width');
    if (savedWidth) {
        const w = parseInt(savedWidth);
        if (w >= 250 && w <= 600) panel.style.width = w + 'px';
    }

    // Trigger resize so MathBox/Three.js adapts to new viewport width
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
}

export function setupPanelResize() {
    const handle = document.getElementById('panel-resize-handle');
    const panel = document.getElementById('explanation-panel');
    let dragging = false;
    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        // Handle is to the left of the panel, so dragging left = wider panel
        const dx = startX - e.clientX;
        let newWidth = Math.max(250, Math.min(600, startWidth + dx));
        panel.style.width = newWidth + 'px';
        window.dispatchEvent(new Event('resize'));
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('algebench-panel-width', panel.offsetWidth);
    });
}

export function setupExplainToggle() {
    const toggle = document.getElementById('explain-toggle');
    const panel = document.getElementById('explanation-panel');
    const handle = document.getElementById('panel-resize-handle');

    toggle.addEventListener('click', () => {
        const isHidden = panel.classList.toggle('hidden');
        toggle.classList.toggle('active', !isHidden);
        handle.style.display = isHidden ? 'none' : 'block';
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    });

    // Keyboard shortcut: 'e' to toggle
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'e' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Only toggle if there's markdown content
            if (state.currentSpec && state.currentSpec.markdown && toggle.style.display !== 'none') {
                toggle.click();
            }
        }
    });
}

// ----- Doc Panel Speak / Commentate Buttons -----

export function setupDocSpeakButtons() {
    const speakBtn = document.getElementById('doc-speak-btn');
    const commentateBtn = document.getElementById('doc-commentate-btn');
    if (!speakBtn || !commentateBtn) return;

    // Speak button is only shown in debug mode — feature is not yet user-ready
    if (document.body.dataset.debugMode !== 'true') speakBtn.style.display = 'none';

    function resetSpeakBtn() {
        speakBtn.textContent = '🔊 Speak';
        speakBtn.classList.remove('active');
    }

    // --- Speak: read the doc content aloud ---
    speakBtn.addEventListener('click', () => {
        if (speakBtn.classList.contains('active')) {
            if (typeof window.algebenchStopTTS === 'function') window.algebenchStopTTS();
            resetSpeakBtn();
            return;
        }

        const contentEl = document.getElementById('explanation-content');
        const text = (state.currentSpec && state.currentSpec.markdown)
            ? state.currentSpec.markdown
            : (contentEl.dataset.markdown || contentEl.textContent);

        if (!text || !text.trim()) return;

        if (typeof window.algebenchSpeakText === 'function') {
            speakBtn.textContent = '⏹ Stop';
            speakBtn.classList.add('active');
            window.algebenchSpeakText(text, resetSpeakBtn);
        }
    });

    // --- Commentate: send as a chat message ---
    commentateBtn.addEventListener('click', () => {
        if (typeof sendChatMessage !== 'function') return;

        // Stop any doc speak in progress
        if (speakBtn.classList.contains('active')) {
            if (typeof window.algebenchStopTTS === 'function') window.algebenchStopTTS();
            resetSpeakBtn();
        }

        // Open panel and switch to Chat tab so the exchange is visible
        const panel = document.getElementById('explanation-panel');
        const handle = document.getElementById('panel-resize-handle');
        const toggle = document.getElementById('explain-toggle');
        if (panel.classList.contains('hidden')) {
            panel.classList.remove('hidden');
            handle.style.display = 'block';
            toggle.style.display = 'block';
            toggle.classList.add('active');
            setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
        }
        if (typeof switchPanelTab === 'function') switchPanelTab('chat');

        sendChatMessage('Please commentate on the Documentation of this scene. Specifically go into the details of how the visualization ties to the equations that we see in the Documentation.');
    });
}

// ----- Title Bar Update -----

export function updateTitle(spec) {
    const titleEl = document.getElementById('scene-title');
    const descEl = document.getElementById('scene-description');
    const sourceEl = document.getElementById('scene-source-file');
    if (spec && spec.title) {
        titleEl.innerHTML = renderKaTeX(spec.title, false);
    } else {
        titleEl.innerHTML = 'AlgeBench';
    }
    if (spec && spec.description) {
        descEl.innerHTML = renderKaTeX(spec.description, false);
        descEl.dataset.markdown = spec.description;
        const descText = spec.description;
        const btn = makeAiAskButton('ai-ask-btn', 'Ask AI to explain this scene', () => 'Can you explain this scene:\n' + descText.trim());
        descEl.appendChild(btn);
        resetSceneDescPosition(descEl);
    } else if (spec && spec.title) {
        descEl.innerHTML = '';
    } else {
        descEl.innerHTML = 'Load a scene to begin';
    }
    if (sourceEl) {
        sourceEl.textContent = state.currentSceneSourceLabel ? `- ${state.currentSceneSourceLabel}` : '- no file';
        sourceEl.title = state.currentSceneSourcePath || '';
    }
}

// ----- Legend Builder -----

export function buildLegend(elements) {
    const legend = document.getElementById('legend');
    const grouped = new Map();
    for (const el of elements) {
        if (el.type === 'axis' || el.type === 'grid') continue;
        // legendGroup lets an element join a legend group without rendering its own label text.
        // The group key matches the label+color of the primary element.
        const groupLabel = el.legendGroup || el.label;
        if (!groupLabel || !el.color) continue;
        const key = `${groupLabel}__${colorToCSS(el.color)}`;
        if (!grouped.has(key)) {
            // Only create a visible legend entry if this element has a real label (not just legendGroup)
            grouped.set(key, { label: el.label || null, color: el.color, ids: [] });
        }
        // If this element has a real label and the group was created by a legendGroup-only element, upgrade it
        if (el.label && !grouped.get(key).label) {
            grouped.get(key).label = el.label;
        }
        if (el.id) grouped.get(key).ids.push(el.id);
    }
    // Remove groups that never got a real label (only legendGroup members, no primary)
    for (const [key, val] of grouped) {
        if (!val.label) grouped.delete(key);
    }
    const items = [...grouped.values()];
    if (items.length === 0) {
        legend.classList.add('hidden');
        return;
    }
    legend.classList.remove('hidden');
    legend.innerHTML = items.map(it => {
        const clickableIds = (it.ids || []).filter(id => state.elementRegistry[id]);
        const hidden = clickableIds.length > 0 && clickableIds.every(id => state.legendToggledOff.has(id));
        const cls = 'legend-item' + (clickableIds.length ? ' legend-clickable' : '') + (hidden ? ' legend-hidden' : '');
        const dataAttr = clickableIds.length ? ` data-element-ids="${clickableIds.join(',')}"` : '';
        const swatchStyle = hidden
            ? `background:${colorToCSS(it.color)}; opacity:0.3`
            : `background:${colorToCSS(it.color)}`;
        return `
        <div class="${cls}"${dataAttr}>
            <div class="legend-swatch" style="${swatchStyle}"></div>
            <span>${renderKaTeX(it.label, false)}</span>
        </div>`;
    }).join('');

    // Attach click handlers (only for elements currently in the registry)
    for (const div of legend.querySelectorAll('.legend-clickable')) {
        div.addEventListener('click', () => {
            const elIds = (div.dataset.elementIds || '')
                .split(',')
                .map(s => s.trim())
                .filter(Boolean)
                .filter(id => state.elementRegistry[id]);
            if (elIds.length === 0) return;
            // hideElementById / showElementById are injected at runtime via window shims
            const allHidden = elIds.every(id => state.legendToggledOff.has(id));
            if (allHidden) {
                for (const elId of elIds) {
                    state.legendToggledOff.delete(elId);
                    if (typeof window._algebenchShowElementById === 'function') window._algebenchShowElementById(elId);
                }
                div.classList.remove('legend-hidden');
                div.querySelector('.legend-swatch').style.opacity = '';
            } else {
                for (const elId of elIds) {
                    state.legendToggledOff.add(elId);
                    if (typeof window._algebenchHideElementById === 'function') window._algebenchHideElementById(elId);
                }
                div.classList.add('legend-hidden');
                div.querySelector('.legend-swatch').style.opacity = '0.3';
            }
        });
    }

    // Prune stale IDs and apply toggled-off state for elements hidden by user
    for (const id of [...state.legendToggledOff]) {
        if (!state.elementRegistry[id]) {
            state.legendToggledOff.delete(id);
        } else if (!state.elementRegistry[id].hidden) {
            if (typeof window._algebenchHideElementById === 'function') window._algebenchHideElementById(id);
        }
    }
}

// ----- Info Overlays -----

const activeInfoOverlays = {};  // id -> { content, el, contentEl, collapsed, stepDefined, pos }

function _fmtNum(val) {
    if (typeof val === 'string') return val;
    if (!isFinite(val)) return String(val);
    const n = Number(val);
    if (Number.isInteger(n)) return String(n);
    return parseFloat(n.toFixed(3)).toString();
}

function _isKnownInfoExprIdentifier(name) {
    if (!name) return false;
    if (Object.prototype.hasOwnProperty.call(state.sceneSliders, name)) return true;
    if (Object.prototype.hasOwnProperty.call(state.activeSceneExprFunctions, name)) return true;
    if (window.agentMemoryValues && Object.prototype.hasOwnProperty.call(window.agentMemoryValues, name)) return true;
    if (name === 't' || name === 'u' || name === 'v') return true;
    if (name === 'pi' || name === 'e' || name === 'PI' || name === 'E') return true;
    if (name === 'true' || name === 'false' || name === 'Infinity' || name === 'NaN') return true;
    if (EXTENSION_NAMES.includes(name)) return true;
    return _getMathNamesAndValues().names.includes(name);
}

function _exprHasUnknownIdentifiers(expr) {
    const sanitized = String(expr).replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ' ');
    const matches = sanitized.match(/[A-Za-z_][A-Za-z0-9_]*/g);
    if (!matches) return false;
    for (const id of matches) {
        if (!_isKnownInfoExprIdentifier(id)) return true;
    }
    return false;
}

function _evalInfoExpr(expr) {
    const trimmed = String(expr || '').trim();
    if (!trimmed) return '';
    if (_exprHasUnknownIdentifiers(trimmed)) {
        return null;
    }
    const memScope = (window.agentMemoryValues && typeof window.agentMemoryValues === 'object')
        ? window.agentMemoryValues
        : null;
    try {
        return _fmtNum(evalExpr(compileExpr(trimmed), 0, { extraScope: memScope }));
    } catch {
        // math.js failed (e.g. JS-only helpers/method calls)
        if (state._sceneJsTrustState === 'trusted') {
            try {
                const ids = getSliderIds();
                const memNames = memScope ? Object.keys(memScope) : [];
                const { names, vals: mathVals } = _getMathNamesAndValues();
                const fn = Function('t', ...ids, ...memNames, ...names, 'return (' + trimmed + ')');
                const sliderVals = ids.map(id => { const s = state.sceneSliders[id]; return s ? s.value : 0; });
                const memVals = memNames.map(k => memScope[k]);
                return _fmtNum(fn(0, ...sliderVals, ...memVals, ...mathVals));
            } catch { /* fall through */ }
        }
        return '?';
    }
}

function _replaceDoubleBraceExprs(template, evaluator) {
    if (typeof template !== 'string' || template.indexOf('{{') === -1) return template;
    return template.replace(/\{\{([\s\S]*?)\}\}/g, (_m, expr) => {
        const v = evaluator(expr);
        return v == null ? _m : String(v);
    });
}

function _replaceInlineExprs(template, evaluator) {
    if (typeof template !== 'string' || template.indexOf('{') === -1) return template;
    let out = '';
    let i = 0;
    while (i < template.length) {
        const ch = template[i];
        if (ch !== '{') {
            out += ch;
            i += 1;
            continue;
        }
        let j = i + 1;
        let depth = 1;
        let quote = null;
        let escaped = false;
        while (j < template.length && depth > 0) {
            const cj = template[j];
            if (quote) {
                if (escaped) {
                    escaped = false;
                } else if (cj === '\\') {
                    escaped = true;
                } else if (cj === quote) {
                    quote = null;
                }
            } else if (cj === '"' || cj === "'") {
                quote = cj;
            } else if (cj === '{') {
                depth += 1;
            } else if (cj === '}') {
                depth -= 1;
            }
            j += 1;
        }
        if (depth !== 0) {
            out += ch;
            i += 1;
            continue;
        }
        const expr = template.slice(i + 1, j - 1).trim();
        if (!expr) {
            out += '{}';
        } else {
            const prev = i > 0 ? template[i - 1] : '';
            // If this brace group is an argument to a LaTeX command, keep it literal.
            let isLatexCommandArg = false;
            const latexLiteralArgCmds = new Set([
                'begin', 'end', 'text', 'mathrm', 'mathbf', 'mathit', 'operatorname',
                'frac', 'dfrac', 'tfrac', 'cfrac', 'binom', 'sqrt', 'left', 'right',
                'overline', 'underline', 'hat', 'bar', 'vec', 'dot', 'ddot'
            ]);
            const latexSecondLiteralArgCmds = new Set([
                'frac', 'dfrac', 'tfrac', 'cfrac', 'binom'
            ]);
            {
                let k = i - 1;
                while (k >= 0 && /\s/.test(template[k])) k -= 1;
                let end = k;
                while (k >= 0 && /[A-Za-z]/.test(template[k])) k -= 1;
                if (end >= 0 && k >= 0 && template[k] === '\\' && end > k) {
                    const cmd = template.slice(k + 1, end + 1);
                    if (latexLiteralArgCmds.has(cmd)) isLatexCommandArg = true;
                }
                if (!isLatexCommandArg && end >= 0 && template[end] === '}') {
                    const prefix = template.slice(0, i);
                    const m = prefix.match(/\\([A-Za-z]+)\{[^{}]*\}\s*$/);
                    if (m && latexSecondLiteralArgCmds.has(m[1])) {
                        isLatexCommandArg = true;
                    }
                }
            }
            const isSimpleIdent = /^[A-Za-z_][A-Za-z0-9_]*$/.test(expr);
            const isSliderIdent = !!state.sceneSliders[expr];
            const shouldEval = !(isLatexCommandArg || (prev === '_' || prev === '^') || (isSimpleIdent && !isSliderIdent));
            out += shouldEval ? evaluator(expr) : ('{' + expr + '}');
        }
        i = j;
    }
    return out;
}

export function resolveInfoContent(template) {
    // Explicit bindings only: evaluate {{expr}} and leave all single-brace groups untouched.
    return _replaceDoubleBraceExprs(template, (expr) => _evalInfoExpr(expr));
}

export function updateInfoOverlays() {
    for (const ov of Object.values(activeInfoOverlays)) {
        const resolved = resolveInfoContent(ov.content);
        // Use renderKaTeX (not renderMarkdown) — markdown rendering breaks
        // the info overlay layout; KaTeX-only keeps it clean and compact.
        ov.contentEl.innerHTML = renderKaTeX(resolved, false);
    }
}

// Register the info overlay updater as a window shim so sliders.js can call it
// without a circular import.
window._algebenchUpdateInfoOverlays = updateInfoOverlays;

export function removeStepInfoOverlays() {
    for (const id of Object.keys(activeInfoOverlays)) {
        const ov = activeInfoOverlays[id];
        if (ov.stepDefined && !ov.keep) removeInfoOverlay(id);
    }
}

export function applyStepInfoOverlays(infoDefs) {
    removeStepInfoOverlays();
    if (!infoDefs || !infoDefs.length) return;
    for (const def of infoDefs) {
        addInfoOverlay(def.id, def.content, def.position || 'top-left', true, def.keep || false);
    }
}

export function addInfoOverlay(id, content, position, stepDefined = false, keep = false) {
    const container = document.getElementById('info-overlays');
    if (!container) return;
    const pos = position || 'top-left';
    if (!id) {
        const preview = typeof content === 'string'
            ? (content.length > 80 ? content.slice(0, 80) + '…' : content)
            : undefined;
        console.warn('addInfoOverlay: id is required; ignoring overlay', {
            position: pos,
            contentLength: typeof content === 'string' ? content.length : undefined,
            contentPreview: preview,
        });
        return;
    }
    let existing = activeInfoOverlays[id];
    let el = existing && existing.el;
    let contentEl = existing && existing.contentEl;
    const isNew = !el;

    if (isNew) {
        el = document.createElement('div');
        el.id = 'info-overlay-' + id;

        // Toggle button (ⓘ) — always visible
        const toggle = document.createElement('button');
        toggle.className = 'info-overlay-toggle';
        toggle.type = 'button';
        toggle.title = 'Expand / collapse';
        toggle.textContent = 'ⓘ';
        toggle.addEventListener('mousedown', e => e.stopPropagation());
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            el.classList.toggle('collapsed');
            const collapsed = el.classList.contains('collapsed');
            const ov = activeInfoOverlays[id];
            if (ov) ov.collapsed = collapsed;
            try { localStorage.setItem('info-overlay-collapsed-' + id, collapsed ? '1' : '0'); } catch {}
        });
        el.appendChild(toggle);

        // AI ask button
        const aiBtn = makeAiAskButton('info-overlay-ai-btn', 'Ask AI about this',
            () => { const ov = activeInfoOverlays[id]; return 'Can you explain this:\n' + (ov ? resolveInfoContent(ov.content) : '').trim(); });
        aiBtn.addEventListener('mousedown', e => e.stopPropagation());
        el.appendChild(aiBtn);

        // Content area
        contentEl = document.createElement('div');
        contentEl.className = 'info-overlay-content';
        el.appendChild(contentEl);

        container.appendChild(el);

        // Drag-to-reposition
        el.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const currentPos = (activeInfoOverlays[id] && activeInfoOverlays[id].pos) || 'top-left';
            const isRight  = currentPos.includes('right');
            const isBottom = currentPos.includes('bottom');
            const rect = el.getBoundingClientRect();
            const parentRect = container.getBoundingClientRect();

            let startH = isRight  ? parentRect.right  - rect.right  : rect.left - parentRect.left;
            let startV = isBottom ? parentRect.bottom - rect.bottom : rect.top  - parentRect.top;
            if (isRight)  { el.style.right  = startH + 'px'; el.style.left   = ''; }
            else          { el.style.left   = startH + 'px'; el.style.right  = ''; }
            if (isBottom) { el.style.bottom = startV + 'px'; el.style.top    = ''; }
            else          { el.style.top    = startV + 'px'; el.style.bottom = ''; }
            el.style.transform = '';
            el.classList.remove(...[...el.classList].filter(c => c.startsWith('pos-')));

            const startX = e.clientX;
            const startY = e.clientY;
            el.classList.add('dragging');

            const onMove = (me) => {
                const dx = me.clientX - startX;
                const dy = me.clientY - startY;
                let newH = isRight  ? startH - dx : startH + dx;
                let newV = isBottom ? startV - dy : startV + dy;
                newH = Math.max(0, Math.min(newH, parentRect.width  - el.offsetWidth));
                newV = Math.max(0, Math.min(newV, parentRect.height - el.offsetHeight));
                if (isRight)  el.style.right  = newH + 'px';
                else          el.style.left   = newH + 'px';
                if (isBottom) el.style.bottom = newV + 'px';
                else          el.style.top    = newV + 'px';
            };
            const onUp = () => {
                el.classList.remove('dragging');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                const h = parseFloat(isRight  ? el.style.right  : el.style.left)  || 0;
                const v = parseFloat(isBottom ? el.style.bottom : el.style.top)   || 0;
                try { localStorage.setItem('info-overlay-pos-' + id, JSON.stringify({ pos: currentPos, h, v })); } catch {}
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // Determine collapsed state
    let collapsed = false;
    if (isNew) {
        try { collapsed = localStorage.getItem('info-overlay-collapsed-' + id) === '1'; } catch {}
    } else {
        collapsed = !!(existing && existing.collapsed);
    }

    const wasDragged = !isNew && (el.style.left || el.style.right || el.style.bottom);
    el.className = 'info-overlay pos-' + pos + (collapsed ? ' collapsed' : '');

    if (isNew) {
        try {
            const savedPos = JSON.parse(localStorage.getItem('info-overlay-pos-' + id) || 'null');
            if (savedPos && savedPos.pos != null && savedPos.h != null && savedPos.v != null) {
                const sr = savedPos.pos.includes('right');
                const sb = savedPos.pos.includes('bottom');
                el.style.left   = sr ? '' : savedPos.h + 'px';
                el.style.right  = sr ? savedPos.h + 'px' : '';
                el.style.top    = sb ? '' : savedPos.v + 'px';
                el.style.bottom = sb ? savedPos.v + 'px' : '';
                el.style.transform = '';
                el.classList.remove(...[...el.classList].filter(c => c.startsWith('pos-')));
            } else if (savedPos && savedPos.left && savedPos.top) {
                el.style.left = savedPos.left;
                el.style.top  = savedPos.top;
                el.style.right = '';
                el.style.bottom = '';
                el.style.transform = '';
                el.classList.remove(...[...el.classList].filter(c => c.startsWith('pos-')));
                requestAnimationFrame(() => {
                    const parent = el.offsetParent || document.body;
                    const pw = parent.clientWidth;
                    const ph = parent.clientHeight;
                    const ew = el.offsetWidth  || 40;
                    const eh = el.offsetHeight || 40;
                    let left = parseFloat(el.style.left) || 0;
                    let top  = parseFloat(el.style.top)  || 0;
                    left = Math.max(40 - ew, Math.min(left, pw - 40));
                    top  = Math.max(0,       Math.min(top,  ph - 40));
                    el.style.left = left + 'px';
                    el.style.top  = top  + 'px';
                });
            } else if (pos.includes('bottom')) {
                const sliderOv = document.getElementById('slider-overlay');
                if (sliderOv && !sliderOv.classList.contains('hidden')) {
                    const sliderBottom = parseFloat(sliderOv.style.bottom) || 56;
                    el.style.bottom = (sliderBottom + sliderOv.offsetHeight + 8) + 'px';
                    el.style.top = '';
                }
            }
        } catch {}
    }
    if (wasDragged) el.classList.remove(...[...el.classList].filter(c => c.startsWith('pos-')));

    el.style.opacity = state.displayParams.overlayOpacity;
    activeInfoOverlays[id] = { content, el, contentEl, collapsed, stepDefined, keep, pos };
    updateInfoOverlays();
}

export function removeInfoOverlay(id) {
    const ov = activeInfoOverlays[id];
    if (ov && ov.el) ov.el.remove();
    delete activeInfoOverlays[id];
}

export function removeAllInfoOverlays() {
    for (const id of Object.keys(activeInfoOverlays)) removeInfoOverlay(id);
}

export function getAllElements(scene, stepIdx) {
    let elements = [...(scene.elements || [])];
    const removedIds = new Set();
    const removedTypes = new Set();
    let removeAll = false;
    if (scene.steps) {
        for (let i = 0; i <= stepIdx; i++) {
            const step = scene.steps[i];
            if (step.remove) {
                for (const item of step.remove) {
                    if (item.id === '*' || item.type === '*') { removeAll = true; }
                    else if (item.id) removedIds.add(item.id);
                    else if (item.type) removedTypes.add(item.type);
                }
            }
            if (removeAll || removedIds.size > 0 || removedTypes.size > 0) {
                elements = elements.filter(el => {
                    if (removeAll) return false;
                    if (el.id && removedIds.has(el.id)) return false;
                    if (el.type && removedTypes.has(el.type)) return false;
                    return true;
                });
                removedIds.clear();
                removedTypes.clear();
                removeAll = false;
            }
            elements = elements.concat(step.add || []);
        }
    }
    return elements;
}

// ----- Status Bar -----

export function updateStatusBar() {
    const bar = document.getElementById('status-bar');
    if (!bar) return;

    // --- JS trust pill ---
    // Delegate to trust.js via window shim to avoid circular dependency
    if (typeof window._algebenchUpdateJsTrustPill === 'function') {
        window._algebenchUpdateJsTrustPill();
    }

    // --- Slider pill ---
    const pill = document.getElementById('slider-status');
    const countEl = pill && pill.querySelector('.slider-status-count');
    const tooltipEl = pill && pill.querySelector('.slider-status-tooltip');
    const ids = Object.keys(state.sceneSliders);
    if (pill) {
        if (ids.length > 0) {
            if (countEl) countEl.textContent = ids.length;
            if (tooltipEl) {
                tooltipEl.textContent = ids.map(id => {
                    const s = state.sceneSliders[id];
                    const label = (s.label || id).replace(/\$|\\[a-z]+\{?|\}|_|\^/gi, '').trim() || id;
                    return `${label} (${id}) = ${Number(s.value).toFixed(2)}  [${s.min} … ${s.max}]`;
                }).join('\n');
            }
            pill.classList.remove('hidden');
        } else {
            pill.classList.add('hidden');
        }
    }

    // --- Camera popup content ---
    const camPopup = document.getElementById('cam-popup-content');
    const camPopupText = document.getElementById('cam-popup-text');
    if (camPopup && state.camera && state.controls) {
        const pw = state.camera.position;
        const tw = state.controls.target;
        const u = state.camera.up;
        const p = worldCameraToData([pw.x, pw.y, pw.z]);
        const t = worldCameraToData([tw.x, tw.y, tw.z]);
        const dist = Math.sqrt((p[0]-t[0])**2 + (p[1]-t[1])**2 + (p[2]-t[2])**2);
        const fov = state.camera.isPerspectiveCamera ? state.camera.fov : null;
        const fmt = v => v.toFixed(3);
        const activeViewBtn = document.querySelector('.cam-btn.active');
        const viewName = activeViewBtn ? activeViewBtn.dataset.view : null;
        let txt = '';
        if (viewName) txt += `view ${viewName}\n`;
        txt += `pos  x: ${fmt(p[0])}  y: ${fmt(p[1])}  z: ${fmt(p[2])}\n`
             + `tgt  x: ${fmt(t[0])}  y: ${fmt(t[1])}  z: ${fmt(t[2])}\n`
             + `up   x: ${fmt(u.x)}  y: ${fmt(u.y)}  z: ${fmt(u.z)}\n`
             + `dist ${dist.toFixed(3)}`;
        if (fov != null) txt += `\nfov  ${Math.round(fov)}°`;
        if (camPopupText) camPopupText.textContent = txt;
        else camPopup.textContent = txt;
    }

    // --- Scene/step text ---
    const debugText = document.getElementById('debug-status-text');
    if (debugText) {
        const sceneNum = state.currentSceneIndex + 1;
        const totalScenes = (state.lessonSpec && state.lessonSpec.scenes) ? state.lessonSpec.scenes.length : '?';
        const stepNum = state.currentStepIndex + 1;
        const scene = (state.lessonSpec && state.lessonSpec.scenes) ? state.lessonSpec.scenes[state.currentSceneIndex] : null;
        const totalSteps = scene && scene.steps ? scene.steps.length : 0;
        debugText.textContent = `scene ${sceneNum}/${totalScenes}  step ${stepNum}/${totalSteps}`;
    }
}

// Register shim so sliders.js can call updateStatusBar without circular import
window._algebenchUpdateStatusBar = updateStatusBar;

// ----- Settings Panel -----

export function setupSettingsPanel() {
    const toggle = document.getElementById('settings-toggle');
    const panel = document.getElementById('settings-panel');
    toggle.addEventListener('click', () => {
        panel.classList.toggle('hidden');
        toggle.classList.toggle('active');
    });

    // Momentum slider
    const momentumSlider = document.getElementById('momentum-slider');
    const valMomentum    = document.getElementById('val-momentum');
    const MOMENTUM_KEY   = 'algebench-momentum';
    const savedMomentum  = parseFloat(localStorage.getItem(MOMENTUM_KEY));
    if (!isNaN(savedMomentum)) state.arcballMomentum = Math.max(0, Math.min(1, savedMomentum));
    if (momentumSlider) {
        momentumSlider.value = Math.round(state.arcballMomentum * 100);
        if (valMomentum) valMomentum.textContent = Math.round(state.arcballMomentum * 100) + '%';
        momentumSlider.addEventListener('input', () => {
            state.arcballMomentum = momentumSlider.value / 100;
            if (valMomentum) valMomentum.textContent = Math.round(state.arcballMomentum * 100) + '%';
            localStorage.setItem(MOMENTUM_KEY, state.arcballMomentum);
        });
    }

    // Sync displayed values with actual displayParams
    for (const [key, val] of Object.entries(state.displayParams)) {
        const el = document.getElementById('val-' + key);
        if (el) el.textContent = val.toFixed(1);
    }

    // Apply initial overlayOpacity to floating panels
    const _iniOp = state.displayParams.overlayOpacity;
    const _sliderOv = document.getElementById('slider-overlay');
    const _legend = document.getElementById('legend');
    if (_sliderOv) _sliderOv.style.opacity = _iniOp;
    if (_legend) _legend.style.opacity = _iniOp;

    const isOpacity = (p) => p.endsWith('Opacity');

    panel.querySelectorAll('.sp-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const param = btn.dataset.param;
            const dir = btn.dataset.dir === '+' ? 1 : -1;
            const step = isOpacity(param) ? 0.1 : 0.2;
            const min = isOpacity(param) ? 0.0 : 0.2;
            const max = isOpacity(param) ? 1.0 : 5.0;
            let val = state.displayParams[param] + dir * step;
            val = Math.round(Math.max(min, Math.min(max, val)) * 10) / 10;
            state.displayParams[param] = val;
            document.getElementById('val-' + param).textContent = val.toFixed(1);

            if (param === 'labelOpacity') {
                document.querySelectorAll('.label-3d').forEach(el => {
                    el.style.opacity = val;
                });
            } else if (param === 'arrowScale') {
                // Delegate complex arrow scaling to camera.js helpers via window shim
                if (typeof window._algebenchApplyArrowScale === 'function') window._algebenchApplyArrowScale(val);
            } else if (param === 'arrowOpacity') {
                for (const entry of state.arrowMeshes) {
                    if (entry.isShaft) continue;
                    const baseOp = (entry.mesh && entry.mesh.userData && typeof entry.mesh.userData.baseOpacity === 'number')
                        ? entry.mesh.userData.baseOpacity : 1;
                    const targetOp = Math.max(0, Math.min(1, baseOp * val));
                    entry.mesh.material.opacity = targetOp;
                    entry.mesh.material.transparent = targetOp < 1.0;
                }
            } else if (param === 'axisWidth') {
                if (typeof window._algebenchApplyLineWidth === 'function') {
                    for (const entry of state.axisLineNodes) window._algebenchApplyLineWidth(entry);
                }
            } else if (param === 'axisOpacity') {
                for (const entry of state.axisLineNodes) {
                    const baseOp = (entry && typeof entry.baseOpacity === 'number') ? entry.baseOpacity : 1;
                    entry.node.set('opacity', baseOp * val);
                }
            } else if (param === 'vectorWidth') {
                if (typeof window._algebenchApplyShaftThickness === 'function' && typeof window._algebenchApplyLineWidth === 'function') {
                    for (const entry of state.arrowMeshes) {
                        if (!window._algebenchIsShaftEntry || !window._algebenchIsShaftEntry(entry)) continue;
                        if (entry.mesh && entry.mesh.userData && entry.mesh.userData.dynamicVector) continue;
                        window._algebenchApplyShaftThickness(entry.mesh);
                    }
                    for (const entry of state.vectorLineNodes) window._algebenchApplyLineWidth(entry);
                }
            } else if (param === 'vectorOpacity') {
                for (const entry of state.arrowMeshes) {
                    if (typeof window._algebenchIsShaftEntry === 'function' && !window._algebenchIsShaftEntry(entry)) continue;
                    const baseOp = (entry.mesh && entry.mesh.userData && typeof entry.mesh.userData.baseOpacity === 'number')
                        ? entry.mesh.userData.baseOpacity : 1;
                    const targetOp = Math.max(0, Math.min(1, baseOp * val));
                    entry.mesh.material.opacity = targetOp;
                    entry.mesh.material.transparent = targetOp < 1.0;
                }
            } else if (param === 'lineWidth') {
                if (typeof window._algebenchApplyLineWidth === 'function') {
                    for (const entry of state.lineNodes) window._algebenchApplyLineWidth(entry);
                }
            } else if (param === 'lineOpacity') {
                for (const entry of state.lineNodes) {
                    const baseOp = (entry && typeof entry.baseOpacity === 'number') ? entry.baseOpacity : 1;
                    entry.node.set('opacity', baseOp * val);
                }
            } else if (param === 'planeScale') {
                for (const m of state.planeMeshes) {
                    if (m._hiddenByRemove) continue;
                    if (m.userData.buildSlab) {
                        const newPositions = m.userData.buildSlab(m.userData.baseHalf * val);
                        m.geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
                        m.geometry.computeVertexNormals();
                        m.geometry.attributes.position.needsUpdate = true;
                    }
                }
            } else if (param === 'planeOpacity') {
                for (const m of state.planeMeshes) {
                    if (m._hiddenByRemove) continue;
                    if (m.userData && m.userData.ignorePlaneOpacity) {
                        const baseOp = (typeof m.userData.targetOpacity === 'number') ? m.userData.targetOpacity : 1;
                        m.visible = baseOp > 0.001;
                        m.material.opacity = baseOp;
                        m.material.transparent = baseOp < 1;
                        m.material.needsUpdate = true;
                        continue;
                    }
                    const baseOp = (m.userData && typeof m.userData.targetOpacity === 'number')
                        ? m.userData.targetOpacity : 1;
                    const targetOp = Math.max(0, Math.min(1, baseOp * val));
                    const isVisible = targetOp > 0.001;
                    m.visible = isVisible;
                    m.material.opacity = targetOp;
                    m.material.transparent = targetOp < 1;
                    m.material.depthWrite = targetOp >= 0.999;
                    m.material.needsUpdate = true;
                }
            } else if (param === 'captionScale') {
                const cap = document.getElementById('step-caption');
                if (cap) cap.style.transform = 'translateX(-50%) scale(' + val + ')';
            } else if (param === 'overlayOpacity') {
                const cap = document.getElementById('step-caption');
                if (cap && !cap.classList.contains('hidden')) cap.style.opacity = val;
                const sliderOv = document.getElementById('slider-overlay');
                if (sliderOv) sliderOv.style.opacity = val;
                const legend = document.getElementById('legend');
                if (legend) legend.style.opacity = val;
                document.querySelectorAll('.info-overlay').forEach(el => { el.style.opacity = val; });
            }
        });
    });
}

export function initLightControls() {
    const azEl  = document.getElementById('light-az');
    const elEl  = document.getElementById('light-el');
    const intEl = document.getElementById('light-int');
    if (!azEl || !state.mainDirLight) return;

    function applyLight() {
        const azDeg = parseFloat(azEl.value);
        const elDeg = parseFloat(elEl.value);
        const intensity = parseFloat(intEl.value) / 100;
        const az = azDeg * Math.PI / 180;
        const el = elDeg * Math.PI / 180;
        const dist = 20;
        state.mainDirLight.position.set(
            dist * Math.cos(el) * Math.sin(az),
            dist * Math.sin(el),
            dist * Math.cos(el) * Math.cos(az)
        );
        state.mainDirLight.intensity = intensity;
        document.getElementById('val-light-az').textContent  = azDeg  + '°';
        document.getElementById('val-light-el').textContent  = elDeg  + '°';
        document.getElementById('val-light-int').textContent = intensity.toFixed(2);
    }

    azEl.addEventListener('input',  applyLight);
    elEl.addEventListener('input',  applyLight);
    intEl.addEventListener('input', applyLight);
    applyLight();
}

// ----- Caption drag -----

export function updateStepCaption(scene, stepIdx) {
    const el = document.getElementById('step-caption');
    if (!el) return;
    let text = null;
    if (stepIdx >= 0 && scene.steps && scene.steps[stepIdx] && scene.steps[stepIdx].description) {
        text = scene.steps[stepIdx].description;
    } else if (stepIdx === -1 && scene.description) {
        text = scene.description;
    }
    if (text) {
        el.innerHTML = renderMarkdown(text);
        el.dataset.markdown = text;
        const btn = makeAiAskButton('ai-ask-btn caption-ai-btn', 'Ask AI to explain this', () => `Can you explain the step description: "${text}"`);
        el.appendChild(btn);
        el.style.opacity = state.displayParams.overlayOpacity;
        resetCaptionPosition(el);
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

function _applyBottomPos(el, bottom, left) {
    el.style.bottom = bottom;
    el.style.left   = left || '50%';
    el.style.top    = 'auto';
    el.style.right  = 'auto';
    el.style.width  = '';
    const scale = 'scale(' + (state.displayParams.captionScale || 1) + ')';
    el.style.transform = (left && left.endsWith('px')) ? scale : ('translateX(-50%) ' + scale);
}

function _defaultCaptionPos(el) {
    _applyBottomPos(el, '64px', '50%');
}

export function resetCaptionPosition(el) {
    try {
        const saved = JSON.parse(localStorage.getItem('caption-pos') || 'null');
        if (saved && typeof saved.bottom === 'string' && saved.bottom.endsWith('px')) {
            if (saved.width) el.style.width = saved.width;
            _applyBottomPos(el, saved.bottom, saved.left);
            requestAnimationFrame(() => {
                const parent = el.offsetParent || document.body;
                const b = parseFloat(el.style.bottom) || 0;
                if (b < 0 || b > parent.clientHeight - 20) {
                    localStorage.removeItem('caption-pos');
                    _defaultCaptionPos(el);
                }
            });
            return;
        }
    } catch {}
    _defaultCaptionPos(el);
}

export function setupCaptionDrag() {
    const el = document.getElementById('step-caption');
    if (!el) return;
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startBottom = 0;

    el.addEventListener('mousedown', (e) => {
        if (e.target.closest('.ai-ask-btn')) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const parent = el.offsetParent || document.body;
        const parentRect = parent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        startLeft   = elRect.left - parentRect.left;
        startBottom = parentRect.bottom - elRect.bottom;
        el.style.width     = elRect.width + 'px';
        el.style.left      = startLeft + 'px';
        el.style.bottom    = startBottom + 'px';
        el.style.top       = 'auto';
        el.style.right     = 'auto';
        el.style.transform = 'scale(' + state.displayParams.captionScale + ')';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        el.style.left   = (startLeft   + (e.clientX - startX)) + 'px';
        el.style.bottom = Math.max(0, startBottom - (e.clientY - startY)) + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        try {
            localStorage.setItem('caption-pos', JSON.stringify({
                bottom: el.style.bottom,
                left:   el.style.left,
                width:  el.style.width,
            }));
        } catch {}
    });

    resetCaptionPosition(el);
}

// ----- Scene Description Drag -----

export function resetSceneDescPosition(el) {
    if (!el) el = document.getElementById('scene-description');
    if (!el) return;
    try {
        const saved = JSON.parse(localStorage.getItem('scene-desc-pos') || 'null');
        if (saved && typeof saved.bottom === 'string' && saved.bottom.endsWith('px')) {
            const left = saved.left || '50%';
            if (saved.width) el.style.width = saved.width;
            el.style.bottom    = saved.bottom;
            el.style.left      = left;
            el.style.top       = 'auto';
            el.style.transform = left.endsWith('px') ? 'none' : 'translateX(-50%)';
            requestAnimationFrame(() => {
                const parent = el.offsetParent || document.body;
                const b = parseFloat(el.style.bottom) || 0;
                if (b < 0 || b > parent.clientHeight - 20) {
                    localStorage.removeItem('scene-desc-pos');
                    el.style.bottom    = '64px';
                    el.style.left      = '50%';
                    el.style.top       = 'auto';
                    el.style.transform = 'translateX(-50%)';
                }
            });
            return;
        }
    } catch {}
    el.style.bottom    = '64px';
    el.style.left      = '50%';
    el.style.top       = 'auto';
    el.style.transform = 'translateX(-50%)';
}

export function setupSceneDescDrag() {
    const el = document.getElementById('scene-description');
    if (!el) return;
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startBottom = 0;

    el.addEventListener('mousedown', (e) => {
        if (e.target.closest('.ai-ask-btn')) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const parent = el.offsetParent || document.body;
        const parentRect = parent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        startLeft   = elRect.left - parentRect.left;
        startBottom = parentRect.bottom - elRect.bottom;
        el.style.width     = elRect.width + 'px';
        el.style.left      = startLeft + 'px';
        el.style.bottom    = startBottom + 'px';
        el.style.top       = 'auto';
        el.style.transform = 'none';
        el.classList.add('dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        el.style.left   = (startLeft   + (e.clientX - startX)) + 'px';
        el.style.bottom = Math.max(0, startBottom - (e.clientY - startY)) + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        el.classList.remove('dragging');
        try {
            localStorage.setItem('scene-desc-pos', JSON.stringify({
                bottom: el.style.bottom,
                left:   el.style.left,
                width:  el.style.width,
            }));
        } catch {}
    });

    resetSceneDescPosition(el);
}

// ----- Cam status popup -----

export function setCamPopupPinned(pinned, suppressHover = false) {
    const camStatus = document.getElementById('cam-status');
    if (!camStatus) return;
    state.camPopupPinned = !!pinned;
    camStatus.classList.toggle('pinned', state.camPopupPinned);
    if (state.camPopupPinned) {
        camStatus.classList.remove('suppress-hover');
    } else if (suppressHover) {
        camStatus.classList.add('suppress-hover');
    }
}

export function setupCamStatusPopup() {
    const camStatus = document.getElementById('cam-status');
    const closeBtn = document.getElementById('cam-popup-close');
    const copyBtn = document.getElementById('cam-popup-copy');
    const popupText = document.getElementById('cam-popup-text');
    if (!camStatus) return;

    camStatus.addEventListener('click', (e) => {
        if (e.target && e.target.closest('#cam-popup-close')) return;
        if (e.target && e.target.closest('#cam-popup-copy')) return;
        if (e.target && e.target.closest('.cam-status-popup')) return;
        setCamPopupPinned(!state.camPopupPinned, state.camPopupPinned);
    });

    camStatus.addEventListener('mouseleave', () => {
        camStatus.classList.remove('suppress-hover');
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setCamPopupPinned(false, true);
        });
    }

    if (copyBtn && popupText) {
        copyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const txt = popupText.textContent || '';
            if (!txt) return;
            try {
                await navigator.clipboard.writeText(txt);
                const prev = copyBtn.textContent;
                copyBtn.textContent = 'Copied';
                setTimeout(() => { copyBtn.textContent = prev; }, 900);
            } catch (_err) {}
        });
    }
}
