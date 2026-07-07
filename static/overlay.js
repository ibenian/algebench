// ============================================================
// Overlay — explanation panel, title bar, legend, info overlays,
// settings panel, status bar, and scene description drag.
// ============================================================

import { state } from '/state.js';
import { renderMarkdown, renderKaTeX, parseColor, colorToCSS, injectAskButtons, makeAiAskButton } from '/labels.js';
import { compileExpr, evalExpr, _getMathNamesAndValues, EXTENSION_NAMES } from '/expr.js';
import { getSliderIds, syncSliderState } from '/sliders.js';
import { worldCameraToData } from '/coords.js';
import { createDockablePanel } from '/dockable-panel.js';

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
        if (!isHidden && typeof window.refreshProofPanel === 'function') {
            window.refreshProofPanel();
        }
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
    legend.innerHTML = '';
    for (const it of items) {
        const clickableIds = (it.ids || []).filter(id => state.elementRegistry[id]);
        const hidden = clickableIds.length > 0 && clickableIds.every(id => state.legendToggledOff.has(id));

        const div = document.createElement('div');
        div.className = 'legend-item' + (clickableIds.length ? ' legend-clickable' : '') + (hidden ? ' legend-hidden' : '');
        if (clickableIds.length) div.dataset.elementIds = clickableIds.join(',');

        const swatch = document.createElement('div');
        swatch.className = 'legend-swatch';
        swatch.style.background = colorToCSS(it.color);
        if (hidden) swatch.style.opacity = '0.3';
        div.appendChild(swatch);

        const span = document.createElement('span');
        span.innerHTML = renderKaTeX(it.label, false);
        div.appendChild(span);

        legend.appendChild(div);
    }

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

// Info-overlay state. Each item is rendered either as a free-floating dockable
// panel or as a section inside the shared info drawer; `placement` (persisted
// per id) is the authoritative location so manual dock/pop-out survives step
// navigation and reloads.
const infoState = {
    forcedMode: null,               // null = auto ( >3 items => drawer ), else 'free' | 'drawer'
    mode: 'free',                   // resolved this route
    items: {},                      // id -> item record
    drawerPanel: null,              // dockable-panel handle for the drawer, or null
    drawerBodyEl: null,             // accordion container inside the drawer
    _routeScheduled: false,
    _pendingDrawerCorner: null,     // corner to inherit on lazy drawer creation
};

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
        // Unknown slider/function (e.g. a tutor-injected overlay referencing a
        // slider that isn't on the current step): degrade to the same '?'
        // marker used for eval failures rather than leaking raw template text.
        return '?';
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
    for (const item of Object.values(infoState.items)) {
        if (!item.contentEl) continue;
        const resolved = resolveInfoContent(item.content);
        // KaTeX-only (not full markdown) keeps overlay/section layout clean.
        item.contentEl.innerHTML = renderKaTeX(resolved, false);
        const titleHtml = _titleHtml(item);
        if (item.panel) item.panel.setTitle(titleHtml);
        if (item.sectionTitleEl) item.sectionTitleEl.innerHTML = titleHtml;
    }
    _updateDrawerHeader();
}

// Register the info overlay updater as a window shim so sliders.js can call it
// without a circular import.
window._algebenchUpdateInfoOverlays = updateInfoOverlays;

// ----- helpers -----

function _infoContainer() { return document.getElementById('info-overlays'); }

function _deriveTitle(content) {
    const lines = String(content || '').split('\n');
    for (let ln of lines) {
        ln = ln.trim();
        if (!ln) continue;
        ln = ln.replace(/^#{1,6}\s*/, '').replace(/^[*_>\s-]+/, '').replace(/[*_]+$/, '').trim();
        if (ln) return ln;
    }
    return 'Info';
}

function _titleHtml(item) {
    const raw = item.explicitTitle ? item.title : _deriveTitle(item.content);
    return renderKaTeX(resolveInfoContent(raw), false);
}

function _loadPlacement(id) {
    try { const v = localStorage.getItem('info-item-placement-' + id); return (v === 'free' || v === 'drawer') ? v : null; } catch { return null; }
}
function _savePlacement(id, placement) {
    try { localStorage.setItem('info-item-placement-' + id, placement); } catch {}
}

function _loadSectionCollapsed() {
    try { return JSON.parse(localStorage.getItem('info-drawer-sections') || '{}') || {}; } catch { return {}; }
}
function _saveSectionCollapsed(map) {
    try { localStorage.setItem('info-drawer-sections', JSON.stringify(map)); } catch {}
}

// Translate the pre-refactor persistence keys into a dockable-panel geometry blob.
function _migrateOldOverlayKeys(id) {
    let geom = null;
    try {
        const raw = localStorage.getItem('info-overlay-pos-' + id);
        const saved = raw ? JSON.parse(raw) : null;
        if (saved && saved.pos && saved.h != null && saved.v != null) {
            geom = { corner: saved.pos, h: saved.h, v: saved.v };
        } else if (saved && saved.left && saved.top) {
            // Legacy absolute {left,top} -> approximate as a top-left offset.
            geom = { corner: 'top-left', h: parseFloat(saved.left) || 0, v: parseFloat(saved.top) || 0 };
        }
    } catch {}
    try {
        if (localStorage.getItem('info-overlay-collapsed-' + id) === '1') {
            geom = geom || { corner: 'top-left' };
            geom.collapsed = true;
        }
    } catch {}
    return geom;
}

function _makeItemAiBtn(item) {
    return makeAiAskButton('info-overlay-ai-btn', 'Ask AI about this',
        () => 'Can you explain this:\n' + resolveInfoContent(item.content).trim());
}

function _makeDockBtn(item) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'info-dock-btn';
    b.title = 'Move into drawer';
    b.textContent = '⤵';
    b.addEventListener('mousedown', e => e.stopPropagation());
    b.addEventListener('click', (e) => {
        e.stopPropagation();
        const corner = item.panel ? item.panel.getCorner() : item.position;
        _setItemPlacement(item.id, 'drawer', corner);
    });
    return b;
}

function _makePopBtn(item) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'info-dock-btn';
    b.title = 'Pop out of drawer';
    b.textContent = '⤴';
    b.addEventListener('mousedown', e => e.stopPropagation());
    b.addEventListener('click', (e) => {
        e.stopPropagation();
        _setItemPlacement(item.id, 'free', null);
    });
    return b;
}

function _setItemPlacement(id, placement, inheritCorner) {
    const item = infoState.items[id];
    if (!item) return;
    _savePlacement(id, placement);
    if (placement === 'drawer' && inheritCorner) infoState._pendingDrawerCorner = inheritCorner;
    _route();
}

// ----- free-floating overlay -----

function _mountFree(item) {
    if (item.panel) {
        if (item.contentEl.parentElement !== item.freeInner) item.freeInner.appendChild(item.contentEl);
        return;
    }
    const inner = document.createElement('div');
    inner.className = 'info-overlay';
    inner.appendChild(item.contentEl);
    item.freeInner = inner;
    item.panel = createDockablePanel({
        persistKey: 'info-' + item.id,
        corner: item.position,
        title: _titleHtml(item),
        bodyEl: inner,
        container: _infoContainer(),
        headerButtons: [_makeItemAiBtn(item), _makeDockBtn(item)],
        titleAlwaysVisible: !!item.explicitTitle,
        opacity: state.displayParams.overlayOpacity,
        legacyMigrate: () => _migrateOldOverlayKeys(item.id),
    });
}

function _unmountFree(item) {
    if (!item.panel) return;
    if (item.contentEl.parentElement) item.contentEl.parentElement.removeChild(item.contentEl);
    item.panel.destroy();
    item.panel = null;
    item.freeInner = null;
}

// ----- drawer -----

function _chooseDrawerCorner(items) {
    if (infoState._pendingDrawerCorner) return infoState._pendingDrawerCorner;
    const counts = {};
    let best = 'top-right', bestN = 0;
    for (const it of items) {
        if (it.placement !== 'drawer') continue;
        const c = it.position || 'top-right';
        counts[c] = (counts[c] || 0) + 1;
        if (counts[c] > bestN) { bestN = counts[c]; best = c; }
    }
    return best;
}

// Thin double-chevron icons (VS Code style) for collapse/expand all.
const _CHEVRON_UP = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 12 12 7 7 12"/><polyline points="17 18 12 13 7 18"/></svg>';
const _CHEVRON_DOWN = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 12 12 17 17 12"/><polyline points="7 6 12 11 17 6"/></svg>';

function _makeDrawerIconBtn(glyph, title, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'info-dock-btn';
    b.title = title;
    if (glyph.trimStart().startsWith('<')) b.innerHTML = glyph; else b.textContent = glyph;
    b.addEventListener('mousedown', e => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
}

function _setAllSectionsCollapsed(collapsed) {
    const map = _loadSectionCollapsed();
    for (const item of Object.values(infoState.items)) {
        if (item.placement === 'drawer' && item.sectionEl) {
            item.sectionEl.classList.toggle('collapsed', collapsed);
            map[item.id] = collapsed;
        }
    }
    _saveSectionCollapsed(map);
}

function _ensureDrawer(corner) {
    if (infoState.drawerPanel) return;
    const body = document.createElement('div');
    body.className = 'info-drawer';
    infoState.drawerBodyEl = body;
    const collapseAllBtn = _makeDrawerIconBtn(_CHEVRON_UP, 'Collapse all sections', () => _setAllSectionsCollapsed(true));
    const expandAllBtn = _makeDrawerIconBtn(_CHEVRON_DOWN, 'Expand all sections', () => _setAllSectionsCollapsed(false));
    const dissolveBtn = _makeDrawerIconBtn('⤴', 'Pop all overlays out of the drawer', () => _dissolveDrawer());
    infoState.drawerPanel = createDockablePanel({
        persistKey: 'info-drawer',
        corner: corner || 'top-right',
        title: 'Info',
        bodyEl: body,
        container: _infoContainer(),
        headerButtons: [collapseAllBtn, expandAllBtn, dissolveBtn],
        titleAlwaysVisible: true,
        opacity: state.displayParams.overlayOpacity,
    });
    infoState.drawerPanel.el.classList.add('dp-drawer');
}

function _destroyDrawerIfEmpty() {
    if (!infoState.drawerPanel) return;
    const hasSection = Object.values(infoState.items).some(it => it.placement === 'drawer');
    if (hasSection) return;
    infoState.drawerPanel.destroy();
    infoState.drawerPanel = null;
    infoState.drawerBodyEl = null;
}

function _dissolveDrawer() {
    for (const item of Object.values(infoState.items)) {
        if (item.placement === 'drawer') _savePlacement(item.id, 'free');
    }
    _route();
}

function _mountSection(item) {
    if (item.sectionEl) {
        if (item.contentEl.parentElement !== item.sectionBodyEl) item.sectionBodyEl.appendChild(item.contentEl);
        if (item.sectionEl.parentElement !== infoState.drawerBodyEl) infoState.drawerBodyEl.appendChild(item.sectionEl);
        return;
    }
    const section = document.createElement('div');
    section.className = 'info-drawer-section';
    // Derived titles duplicate the content's own heading, so show them only
    // when the section is collapsed; explicit titles stay visible always.
    if (item.explicitTitle) section.classList.add('title-always');

    const header = document.createElement('div');
    header.className = 'info-drawer-section-header';

    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'dp-collapse';
    caret.title = 'Expand / collapse';

    const titleEl = document.createElement('span');
    titleEl.className = 'info-drawer-section-title';
    titleEl.innerHTML = _titleHtml(item);

    const btns = document.createElement('span');
    btns.className = 'info-drawer-section-buttons';
    btns.appendChild(_makeItemAiBtn(item));
    btns.appendChild(_makePopBtn(item));

    header.appendChild(caret);
    header.appendChild(titleEl);
    header.appendChild(btns);

    const sBody = document.createElement('div');
    sBody.className = 'info-drawer-section-body';
    sBody.appendChild(item.contentEl);

    const collapsedMap = _loadSectionCollapsed();
    const collapsed = !!collapsedMap[item.id];
    section.classList.toggle('collapsed', collapsed);

    // Clicking anywhere on the header (not the action buttons) toggles the section.
    header.addEventListener('click', (e) => {
        if (e.target.closest('.info-dock-btn, .info-overlay-ai-btn')) return;
        const nowCollapsed = !section.classList.contains('collapsed');
        section.classList.toggle('collapsed', nowCollapsed);
        const map = _loadSectionCollapsed();
        map[item.id] = nowCollapsed;
        _saveSectionCollapsed(map);
    });

    section.appendChild(header);
    section.appendChild(sBody);
    infoState.drawerBodyEl.appendChild(section);

    item.sectionEl = section;
    item.sectionBodyEl = sBody;
    item.sectionTitleEl = titleEl;
}

function _unmountSection(item) {
    if (!item.sectionEl) return;
    if (item.contentEl.parentElement) item.contentEl.parentElement.removeChild(item.contentEl);
    item.sectionEl.remove();
    item.sectionEl = null;
    item.sectionBodyEl = null;
    item.sectionTitleEl = null;
}

function _updateDrawerHeader() {
    if (!infoState.drawerPanel) return;
    const n = Object.values(infoState.items).filter(it => it.placement === 'drawer').length;
    infoState.drawerPanel.setTitle('Info <span class="info-drawer-count">' + n + '</span>');
}

// ----- routing -----

function _scheduleRoute() {
    if (infoState._routeScheduled) return;
    infoState._routeScheduled = true;
    Promise.resolve().then(() => {
        infoState._routeScheduled = false;
        _route();
    });
}

function _route() {
    const items = Object.values(infoState.items);
    const count = items.length;
    const mode = infoState.forcedMode || (count > 3 ? 'drawer' : 'free');
    infoState.mode = mode;

    let anyDrawer = false;
    for (const item of items) {
        const persisted = _loadPlacement(item.id);
        item.placement = persisted || (mode === 'drawer' ? 'drawer' : 'free');
        if (item.placement === 'drawer') anyDrawer = true;
    }

    if (anyDrawer) _ensureDrawer(_chooseDrawerCorner(items));
    infoState._pendingDrawerCorner = null;

    for (const item of items) {
        if (item.placement === 'drawer') { _unmountFree(item); _mountSection(item); }
        else { _unmountSection(item); _mountFree(item); }
    }

    _destroyDrawerIfEmpty();
    updateInfoOverlays();
}

// ----- public API -----

export function removeStepInfoOverlays() {
    let changed = false;
    for (const id of Object.keys(infoState.items)) {
        const item = infoState.items[id];
        if (item.stepDefined && !item.keep) { _disposeItem(item); changed = true; }
    }
    if (changed) _scheduleRoute();
}

export function applyStepInfoOverlays(infoDefs) {
    removeStepInfoOverlays();
    if (infoDefs && infoDefs.length) {
        for (const def of infoDefs) {
            addInfoOverlay(def.id, def.content, def.position || def.pos || 'top-left', true, def.keep || false, def.title);
        }
    } else {
        _scheduleRoute();
    }
}

export function addInfoOverlay(id, content, position, stepDefined = false, keep = false, title = null) {
    if (!_infoContainer()) return;
    if (!id) {
        const preview = typeof content === 'string'
            ? (content.length > 80 ? content.slice(0, 80) + '…' : content) : undefined;
        console.warn('addInfoOverlay: id is required; ignoring overlay', { position, contentPreview: preview });
        return;
    }
    let item = infoState.items[id];
    if (!item) {
        const contentEl = document.createElement('div');
        contentEl.className = 'info-overlay-content';
        item = infoState.items[id] = {
            id, contentEl,
            panel: null, freeInner: null,
            sectionEl: null, sectionBodyEl: null, sectionTitleEl: null,
            placement: 'free',
        };
    }
    item.content = content;
    item.title = title || null;
    item.explicitTitle = !!title;
    item.position = position || 'top-left';
    item.stepDefined = stepDefined;
    item.keep = keep;
    _scheduleRoute();
}

function _disposeItem(item) {
    _unmountFree(item);
    _unmountSection(item);
    delete infoState.items[item.id];
}

export function removeInfoOverlay(id) {
    const item = infoState.items[id];
    if (!item) return;
    _disposeItem(item);
    _scheduleRoute();
}

export function removeAllInfoOverlays() {
    for (const id of Object.keys(infoState.items)) _disposeItem(infoState.items[id]);
    if (infoState.drawerPanel) { infoState.drawerPanel.destroy(); infoState.drawerPanel = null; infoState.drawerBodyEl = null; }
}

/** Master toggle: 'free' | 'drawer' | null (auto). Clears per-item overrides. */
export function setInfoDrawerMode(mode) {
    infoState.forcedMode = (mode === 'free' || mode === 'drawer') ? mode : null;
    for (const id of Object.keys(infoState.items)) {
        try { localStorage.removeItem('info-item-placement-' + id); } catch {}
    }
    _route();
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
                    // Glow-halo sprites manage their own opacity/visibility per
                    // frame, and additive sprites must never write depth.
                    if (m.isSprite) continue;
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
                if (cap) {
                    // Preserve a dragged caption's anchor/origin; only re-center it
                    // when it hasn't been dragged (still at left:50%).
                    const dragged = cap.style.left && cap.style.left.endsWith('px');
                    cap.style.transformOrigin = dragged ? 'left bottom' : '';
                    cap.style.transform = (dragged ? '' : 'translateX(-50%) ') + 'scale(' + val + ')';
                    clampCaptionIntoView(cap); // resizing may push it off-screen
                }
            } else if (param === 'overlayOpacity') {
                const cap = document.getElementById('step-caption');
                if (cap && !cap.classList.contains('hidden')) cap.style.opacity = val;
                const sliderOv = document.getElementById('slider-overlay');
                if (sliderOv) sliderOv.style.opacity = val;
                const legend = document.getElementById('legend');
                if (legend) legend.style.opacity = val;
                document.querySelectorAll('#info-overlays .dockable-panel').forEach(el => { el.style.opacity = val; });
            }
        });
    });

    const declutterMode = document.getElementById('declutter-mode');
    if (declutterMode) {
        declutterMode.value = state.displayParams.labelDeclutterMode;
        declutterMode.addEventListener('change', () => {
            state.displayParams.labelDeclutterMode = declutterMode.value;
        });
    }
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
    if (left && left.endsWith('px')) {
        // Dragged: anchor the scale to the bottom-left corner so left/bottom and
        // the scaled box agree (no drift when zoomed).
        el.style.transform = scale;
        el.style.transformOrigin = 'left bottom';
    } else {
        el.style.transform = 'translateX(-50%) ' + scale;
        el.style.transformOrigin = '';
    }
}

function _defaultCaptionPos(el) {
    _applyBottomPos(el, '64px', '50%');
}

// Nudge a dragged caption back inside the viewport (e.g. after it shrinks and
// its bottom-left anchor pulls it off-screen). No-op for a centered caption.
export function clampCaptionIntoView(el) {
    el = el || document.getElementById('step-caption');
    if (!el || el.classList.contains('hidden')) return;
    if (!el.style.left || !el.style.left.endsWith('px')) return; // only dragged (px) mode
    const parent = el.offsetParent || document.body;
    const p = parent.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const m = 8;
    let left = parseFloat(el.style.left) || 0;
    let bottom = parseFloat(el.style.bottom) || 0;
    // Horizontal — keep the left edge visible first (so text starts on-screen
    // even if the caption is wider than the viewport).
    if (r.left < p.left + m) left += (p.left + m) - r.left;
    else if (r.right > p.right - m) left -= r.right - (p.right - m);
    // Vertical — bottom is the distance from the parent's bottom edge.
    if (r.bottom > p.bottom - m) bottom += r.bottom - (p.bottom - m);
    else if (r.top < p.top + m) bottom -= (p.top + m) - r.top;
    el.style.left = left + 'px';
    el.style.bottom = Math.max(0, bottom) + 'px';
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
        const s = state.displayParams.captionScale || 1;
        startLeft   = elRect.left - parentRect.left;
        startBottom = parentRect.bottom - elRect.bottom;
        // Freeze the width at its current rendered value so the text doesn't
        // re-wrap when we switch from centered (only 50% available width) to px
        // positioning. offsetWidth is the unscaled border box (transform-
        // independent); convert to the value style.width expects for this box-
        // sizing so the content width is preserved exactly.
        const cs = getComputedStyle(el);
        let frozenW = el.offsetWidth;
        if (cs.boxSizing !== 'border-box') {
            frozenW -= parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
                     + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
        }
        // Anchor the scale to the bottom-left corner so left/bottom and the scaled
        // box agree (no drift when zoomed).
        el.style.transformOrigin = 'left bottom';
        el.style.width     = frozenW + 'px';
        el.style.left      = startLeft + 'px';
        el.style.bottom    = startBottom + 'px';
        el.style.top       = 'auto';
        el.style.right     = 'auto';
        el.style.transform = 'scale(' + s + ')';
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
        clampCaptionIntoView(el);
        try {
            localStorage.setItem('caption-pos', JSON.stringify({
                bottom: el.style.bottom,
                left:   el.style.left,
                width:  el.style.width,
            }));
        } catch {}
    });

    window.addEventListener('resize', () => clampCaptionIntoView(el));
    resetCaptionPosition(el);
    setupOverlayHoverBoost();
}

// On hover, brighten the caption / overlays to 2x their resting opacity (capped
// at full). Hovering or clicking an info panel also raises it above the others.
// Delegated so dynamically-created info panels are covered too.
let _overlayHoverWired = false;
let _overlayZ = 10;
function bringOverlayToFront(panel) {
    panel.style.zIndex = String(++_overlayZ); // relative to the #info-overlays stacking context
}
function setupOverlayHoverBoost() {
    if (_overlayHoverWired) return;
    _overlayHoverWired = true;
    const SEL = '#step-caption, #scene-description, #slider-overlay, #legend, #info-overlays .dockable-panel';
    document.addEventListener('mouseover', (e) => {
        const t = e.target.closest && e.target.closest(SEL);
        if (!t) return;
        const panel = e.target.closest('#info-overlays .dockable-panel');
        if (panel) bringOverlayToFront(panel);
        if (t._hoverBoosted) return;
        t._hoverBoosted = true;
        t._preHoverOp = t.style.opacity;
        const base = parseFloat(getComputedStyle(t).opacity);
        t.style.opacity = Math.min(1, (isNaN(base) ? 1 : base) * 2);
    });
    document.addEventListener('mousedown', (e) => {
        const panel = e.target.closest && e.target.closest('#info-overlays .dockable-panel');
        if (panel) bringOverlayToFront(panel);
    }, true);
    document.addEventListener('mouseout', (e) => {
        const t = e.target.closest && e.target.closest(SEL);
        if (!t || !t._hoverBoosted) return;
        if (e.relatedTarget && t.contains(e.relatedTarget)) return; // still inside
        t._hoverBoosted = false;
        t.style.opacity = t._preHoverOp || '';
    });
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

// ----- About / version popup -----

export function setupAboutPopup() {
    const about = document.getElementById('about-status');
    if (!about) return;

    // Version is injected into <body data-app-version> by the server.
    const version = document.body.dataset.appVersion || 'dev';
    const versionStr = `v${version}`;
    const pillVersion = about.querySelector('.about-status-version');
    if (pillVersion) pillVersion.textContent = versionStr;
    const popupVersion = document.getElementById('about-popup-version');
    if (popupVersion) popupVersion.textContent = versionStr;

    const closeBtn = document.getElementById('about-popup-close');

    // Same interaction model as the camera pill: hover previews the popup,
    // a click pins it open (stays after the mouse leaves). Clicking a pinned
    // pill unpins and suppresses hover until the mouse leaves, so it closes.
    const setPinned = (pinned, suppressHover) => {
        about.classList.toggle('pinned', pinned);
        about.setAttribute('aria-expanded', pinned ? 'true' : 'false');
        if (pinned) about.classList.remove('suppress-hover');
        else if (suppressHover) about.classList.add('suppress-hover');
    };

    about.addEventListener('click', (e) => {
        // Clicks inside the popup body (links, close button) shouldn't toggle it.
        if (e.target && e.target.closest('#about-popup-close')) return;
        if (e.target && e.target.closest('.about-status-popup')) return;
        const pinned = about.classList.contains('pinned');
        setPinned(!pinned, pinned);
    });

    // Keyboard activation: the pill is role="button" tabindex="0", so Enter and
    // Space toggle the popup; Escape closes a pinned popup.
    about.addEventListener('keydown', (e) => {
        if (e.target && e.target.closest('.about-status-popup')) return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            setPinned(!about.classList.contains('pinned'), true);
        } else if (e.key === 'Escape' && about.classList.contains('pinned')) {
            setPinned(false, true);
            about.focus();
        }
    });

    about.addEventListener('mouseleave', () => {
        about.classList.remove('suppress-hover');
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setPinned(false, true);
        });
    }
}
