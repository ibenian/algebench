// ============================================================
// JSON Browser — JSON Viewer panel with tree navigation,
// bidirectional sync, search, and Context Status popup.
// ============================================================

import { state } from '/state.js';

// ----- Scene Summary Helpers -----

function _computeSceneSummary(spec) {
    if (!spec) return null;
    const isLesson = Array.isArray(spec.scenes) && spec.scenes.length > 0;
    const scenes = isLesson ? spec.scenes : [spec];

    let totalSteps = 0, totalSliders = 0, totalAnimated = 0, totalStatic = 0,
        totalFunctions = 0, totalExpressions = 0, totalPrompts = 0;

    const ANIMATED_TYPES = new Set([
        'animated_vector','animated_point','animated_line','animated_cylinder','animated_polygon'
    ]);

    function countExpressions(el) {
        let n = 0;
        const exprFields = ['expr','fromExpr','toExpr','radiusExpr','x','y','z','fx','fy','fz'];
        for (const f of exprFields) {
            if (typeof el[f] === 'string') n++;
            else if (Array.isArray(el[f])) n += el[f].filter(v => typeof v === 'string').length;
        }
        if (Array.isArray(el.points)) n += el.points.filter(v => typeof v === 'string').length;
        if (Array.isArray(el.vertices)) n += el.vertices.filter(v => typeof v === 'string').length;
        return n;
    }

    for (const scene of scenes) {
        if (scene.prompt && scene.prompt.trim().length > 0) totalPrompts++;
        totalSteps += (scene.steps || []).length;

        const allElements = [...(scene.elements || [])];
        for (const step of (scene.steps || [])) {
            allElements.push(...(step.add || []));
            for (const sl of (step.sliders || [])) {
                if (sl.id) totalSliders++;
            }
        }
        for (const el of allElements) {
            if (!el || !el.type) continue;
            if (ANIMATED_TYPES.has(el.type)) {
                totalAnimated++;
                totalExpressions += countExpressions(el);
            } else {
                totalStatic++;
            }
        }
        totalFunctions += Object.keys(scene.functions || {}).length;
        for (const step of (scene.steps || [])) {
            if (step.prompt && step.prompt.trim().length > 0) totalPrompts++;
        }
    }

    const imports = Array.isArray(spec.import) ? spec.import.length : 0;

    const raw =
        totalSliders     * 10 +
        totalAnimated    * 6  +
        totalSteps       * 4  +
        totalExpressions * 1  +
        totalFunctions   * 6  +
        imports          * 12;
    const score = Math.floor(100 * (1 - Math.exp(-raw / 80)));

    const scoreLabel =
        score >= 80 ? 'Highly Interactive' :
        score >= 60 ? 'Rich' :
        score >= 40 ? 'Interactive' :
        score >= 20 ? 'Basic' : 'Static';

    const scoreColor =
        score >= 80 ? '#7cfc7c' :
        score >= 60 ? '#a0d4ff' :
        score >= 40 ? '#ffd070' :
        score >= 20 ? '#ff9966' : '#aaa';

    return {
        isLesson,
        sceneCount: scenes.length,
        description: spec.description || (isLesson ? '' : spec.title) || '',
        totalSteps,
        totalSliders,
        totalAnimated,
        totalStatic,
        totalFunctions,
        totalExpressions,
        totalPrompts,
        imports,
        score,
        scoreLabel,
        scoreColor,
    };
}

function _computeAgenticScore(spec) {
    if (!spec) return null;
    const isLesson = Array.isArray(spec.scenes) && spec.scenes.length > 0;
    const scenes = isLesson ? spec.scenes : [spec];

    let raw = 0;

    if (spec.description && spec.description.trim().length > 0) raw += 4;

    for (const scene of scenes) {
        if (scene.markdown && scene.markdown.trim().length > 0) {
            raw += 12;
            raw += Math.min(scene.markdown.length / 80, 20);
        }

        if (scene.prompt && scene.prompt.trim().length > 10) {
            raw += 15;
            raw += Math.min(scene.prompt.length / 120, 10);
        }

        if (scene.description && scene.description.trim().length > 0) raw += 3;

        for (const step of (scene.steps || [])) {
            if (step.caption && step.caption.trim().length > 0) raw += 3;
            if (step.title  && step.title.trim().length  > 0) raw += 1;
        }

        for (const step of (scene.steps || [])) {
            for (const sl of (step.sliders || [])) {
                if (sl.label && sl.label.trim() !== (sl.id || '').trim()) raw += 2;
            }
        }

        const elements = [...(scene.elements || [])];
        for (const step of (scene.steps || [])) elements.push(...(step.add || []));
        for (const el of elements) {
            if (!el) continue;
            if (el.id)    raw += 1;
            if (el.label) raw += 2;
        }

        if (scene.unsafe && scene.unsafeExplanation) raw += 4;
    }

    const imports = Array.isArray(spec.import) ? spec.import : [];
    raw += imports.length * 10;

    if (spec.unsafe && spec.unsafeExplanation) raw += 4;

    const score = Math.floor(100 * (1 - Math.exp(-raw / 80)));

    const label =
        score >= 80 ? 'Well Documented' :
        score >= 60 ? 'Good' :
        score >= 40 ? 'Moderate' :
        score >= 20 ? 'Sparse' : 'Minimal';

    const color =
        score >= 80 ? '#ffd700' :
        score >= 60 ? '#a0d4ff' :
        score >= 40 ? '#ffaa55' :
        score >= 20 ? '#ff9966' : '#aaa';

    return { score, label, color };
}

function _toggleJsIssuesPanel(panel) {
    if (!panel) return;
    if (!panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        return;
    }

    const trusted = state._sceneJsTrustState === 'trusted';
    const stateLabel = trusted
        ? '⚡ JS Trusted — expressions are running natively'
        : '⚠ JS Disabled — expressions are no-ops (returning 0 / "?")';
    const stateClass = trusted ? 'js-issues-state-trusted' : 'js-issues-state-untrusted';

    const explanationBlock = state._sceneUnsafeExplanation
        ? `<div class="ji-explanation"><span class="ji-explanation-label">Scene-declared explanation:</span> ${_escHtml(state._sceneUnsafeExplanation)}</div>`
        : '';

    const unsafeBanner = state._sceneIsUnsafe
        ? `<div class="ji-unsafe-banner">⚠ This scene sets <code>unsafe: true</code> — all expressions execute as native JavaScript regardless of pattern matching.</div>`
        : '';

    const rows = state._sceneJsIssues.map(({ path, expr, type }) => {
        const truncExpr = expr.length > 60 ? expr.slice(0, 57) + '…' : expr;
        const typeLabel = type === 'template' ? '{{…}} template' : 'expr field';
        const action = trusted ? '✅ Running' : '🚫 Disabled';
        return `<tr>
            <td class="ji-path" title="${_escHtml(path)}">${_escHtml(path)}</td>
            <td class="ji-expr" title="${_escHtml(expr)}"><code>${_escHtml(truncExpr)}</code></td>
            <td class="ji-type">${typeLabel}</td>
            <td class="ji-action ${trusted ? 'ji-running' : 'ji-disabled'}">${action}</td>
        </tr>`;
    }).join('');

    const noRows = state._sceneJsIssues.length === 0
        ? `<tr><td colspan="4" class="ji-empty">No specific JS patterns detected — scene uses <code>unsafe: true</code> to opt in globally.</td></tr>`
        : '';

    panel.innerHTML =
        `<div class="ji-header ${stateClass}">${stateLabel}</div>` +
        explanationBlock +
        unsafeBanner +
        `<div class="ji-scroll"><table class="ji-table">` +
        `<thead><tr><th>JSON Path</th><th>Expression</th><th>Type</th><th>Action</th></tr></thead>` +
        `<tbody>${rows || noRows}</tbody></table></div>`;
    panel.classList.remove('hidden');
}

function _escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── JSON tree helpers ────────────────────────────────────────────────────────

const _JT_TYPE_ICONS = {
    point:              { icon: '\u25CF', cls: 'jti-point' },
    animated_point:     { icon: '\u25C9', cls: 'jti-anim' },
    vector:             { icon: '\u2197', cls: 'jti-vector' },
    animated_vector:    { icon: '\u21D7', cls: 'jti-anim' },
    line:               { icon: '\u2500', cls: 'jti-line' },
    animated_line:      { icon: '\u2248', cls: 'jti-anim' },
    axis:               { icon: '\u2194', cls: 'jti-axis' },
    grid:               { icon: '\u229E', cls: 'jti-grid' },
    sphere:             { icon: '\u25CE', cls: 'jti-sphere' },
    surface:            { icon: '\u25A6', cls: 'jti-surface' },
    parametric_surface: { icon: '\u25A6', cls: 'jti-surface' },
    parametric_curve:   { icon: '\u223F', cls: 'jti-curve' },
    animated_curve:     { icon: '\u224B', cls: 'jti-anim' },
    polygon:            { icon: '\u2B21', cls: 'jti-polygon' },
    animated_polygon:   { icon: '\u2B21', cls: 'jti-anim' },
    cylinder:           { icon: '\u232D', cls: 'jti-sphere' },
    animated_cylinder:  { icon: '\u232D', cls: 'jti-anim' },
    text:               { icon: '\uFF21', cls: 'jti-text' },
    slider:             { icon: '\u229D', cls: 'jti-slider' },
    skybox:             { icon: '\u25CC', cls: 'jti-skybox' },
};

const _JT_KEY_ICONS = {
    title:       { icon: '\u25C6', cls: 'jti-title' },
    description: { icon: '\u00B6', cls: 'jti-desc' },
    markdown:    { icon: '\u00B6', cls: 'jti-desc' },
    prompt:      { icon: '\u25C8', cls: 'jti-prompt' },
    elements:    { icon: '\u25FB', cls: 'jti-elements' },
    steps:       { icon: '\u22EE', cls: 'jti-steps' },
    sliders:     { icon: '\u229D', cls: 'jti-slider' },
    functions:   { icon: '\u03BB', cls: 'jti-fn' },
    import:      { icon: '\u2B06', cls: 'jti-import' },
    scenes:      { icon: '\u25A3', cls: 'jti-scenes' },
    show:        { icon: '\u25D1', cls: 'jti-show' },
    hide:        { icon: '\u25D0', cls: 'jti-hide' },
    remove:      { icon: '\u2715', cls: 'jti-remove' },
    caption:     { icon: '\u2736', cls: 'jti-caption' },
    color:       { icon: '\u25D4', cls: 'jti-color' },
    label:       { icon: '\u25CE', cls: 'jti-label' },
    type:        { icon: '\u25B8', cls: 'jti-type-key' },
    axis:        { icon: '\u2194', cls: 'jti-axis' },
    camera:      { icon: '\u2316', cls: 'jti-camera' },
    range:       { icon: '\u21D4', cls: 'jti-range' },
    info:        { icon: '\u2139', cls: 'jti-info' },
};

function _getTreeIcon(key, value) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value.type === 'string') {
        const ti = _JT_TYPE_ICONS[value.type];
        if (ti) return ti;
    }
    if (key === 'type' && typeof value === 'string') {
        const ti = _JT_TYPE_ICONS[value];
        if (ti) return ti;
    }
    if (key.startsWith('unsafe')) return { icon: '\u26A0', cls: 'jti-unsafe' };
    return _JT_KEY_ICONS[key] || null;
}

function _buildJsonWithLineMap(obj) {
    const lines = [''];

    function append(str) { lines[lines.length - 1] += str; }
    function newline(indent) { lines.push('  '.repeat(indent)); }

    const pathLineMap = {};

    function serialize(val, path, indent) {
        if (val === null) { append('null'); return; }
        if (typeof val === 'string') { append(JSON.stringify(val)); return; }
        if (typeof val === 'number' || typeof val === 'boolean') { append(String(val)); return; }

        pathLineMap[path] = lines.length - 1;

        if (Array.isArray(val)) {
            if (val.length === 0) { append('[]'); return; }
            append('[');
            val.forEach((item, i) => {
                newline(indent + 1);
                const cp = path ? `${path}[${i}]` : `[${i}]`;
                pathLineMap[cp] = lines.length - 1;
                serialize(item, cp, indent + 1);
                if (i < val.length - 1) append(',');
            });
            newline(indent);
            append(']');
        } else {
            const keys = Object.keys(val);
            if (keys.length === 0) { append('{}'); return; }
            append('{');
            keys.forEach((key, i) => {
                newline(indent + 1);
                const cp = path ? `${path}.${key}` : key;
                pathLineMap[cp] = lines.length - 1;
                append(JSON.stringify(key) + ': ');
                serialize(val[key], cp, indent + 1);
                if (i < keys.length - 1) append(',');
            });
            newline(indent);
            append('}');
        }
    }

    serialize(obj, '', 0);
    return { text: lines.join('\n'), pathLineMap };
}

function _jsonTreeSummary(val) {
    if (Array.isArray(val)) return `[${val.length}]`;
    if (val && typeof val === 'object') {
        const keys = Object.keys(val);
        const preview = keys.slice(0, 3).map(k => {
            const v = val[k];
            if (typeof v === 'string') return `${k}: "${v.length > 12 ? v.slice(0, 12) + '\u2026' : v}"`;
            if (typeof v === 'number' || typeof v === 'boolean') return `${k}: ${v}`;
            return k;
        }).join(', ');
        return `{ ${preview}${keys.length > 3 ? ', \u2026' : ''} }`;
    }
    return '';
}

function _buildTreeNodes(ul, val, path, depth) {
    const isArray = Array.isArray(val);
    const entries = isArray ? val.map((v, i) => [i, v]) : Object.entries(val);

    for (const [key, value] of entries) {
        const childPath = path
            ? (isArray ? `${path}[${key}]` : `${path}.${key}`)
            : String(key);

        const li = document.createElement('li');
        li.className = 'jt-item';
        li.dataset.path = childPath;

        const row = document.createElement('div');
        row.className = 'jt-row';

        const isPrimitive = value === null || typeof value !== 'object';
        const iconInfo = _getTreeIcon(String(key), value);

        function makeIcon(info) {
            const ic = document.createElement('span');
            ic.className = 'jt-icon ' + info.cls;
            ic.textContent = info.icon;
            return ic;
        }

        if (!isPrimitive) {
            const toggle = document.createElement('span');
            toggle.className = 'jt-toggle';
            const collapsed = depth >= 1;
            toggle.textContent = collapsed ? '\u25B6' : '\u25BC';

            const keyEl = document.createElement('span');
            keyEl.className = 'jt-key';
            keyEl.textContent = isArray ? `[${key}]` : key;

            const summary = document.createElement('span');
            summary.className = 'jt-summary';
            summary.textContent = ' ' + _jsonTreeSummary(value);

            row.appendChild(toggle);
            if (iconInfo) row.appendChild(makeIcon(iconInfo));
            row.appendChild(keyEl);
            row.appendChild(summary);

            const children = document.createElement('ul');
            children.className = 'jt-children' + (collapsed ? ' jt-collapsed' : '');
            _buildTreeNodes(children, value, childPath, depth + 1);

            toggle.addEventListener('click', e => {
                e.stopPropagation();
                const nowCollapsed = children.classList.toggle('jt-collapsed');
                toggle.textContent = nowCollapsed ? '\u25B6' : '\u25BC';
            });

            li.appendChild(row);
            li.appendChild(children);
        } else {
            const indent = document.createElement('span');
            indent.className = 'jt-indent';

            const keyEl = document.createElement('span');
            keyEl.className = 'jt-key';
            keyEl.textContent = isArray ? `[${key}]` : key;

            const colon = document.createElement('span');
            colon.className = 'jt-colon';
            colon.textContent = ': ';

            const valEl = document.createElement('span');
            valEl.className = 'jt-val jt-val-' + (value === null ? 'null' : typeof value);
            valEl.textContent = JSON.stringify(value);

            row.appendChild(indent);
            if (iconInfo) row.appendChild(makeIcon(iconInfo));
            row.appendChild(keyEl);
            row.appendChild(colon);
            row.appendChild(valEl);
            li.appendChild(row);
        }

        ul.appendChild(li);
    }
}

function _renderJsonTree(treePanel, obj) {
    treePanel.innerHTML = '';
    if (!obj || typeof obj !== 'object') {
        treePanel.innerHTML = '<div class="jt-empty">No scene loaded</div>';
        return;
    }
    const ul = document.createElement('ul');
    ul.className = 'jt-root';
    _buildTreeNodes(ul, obj, '', 0);
    treePanel.appendChild(ul);
}

function _getParentPath(path) {
    if (!path) return null;
    const dot = path.lastIndexOf('.');
    if (dot > 0) return path.substring(0, dot);
    const bracket = path.lastIndexOf('[');
    if (bracket > 0) return path.substring(0, bracket);
    return null;
}

function _findPathAtLine(line, pathLineMap) {
    let bestPath = '';
    let bestLine = -1;
    for (const [p, ln] of Object.entries(pathLineMap)) {
        if (ln <= line && ln > bestLine) { bestLine = ln; bestPath = p; }
    }
    return bestPath;
}

// ─────────────────────────────────────────────────────────────────────────────

export function setupJsonViewer() {
    const btn = document.getElementById('btn-show-json');
    const overlay = document.getElementById('json-viewer-overlay');
    const content = document.getElementById('json-viewer-content');
    const treePanel = document.getElementById('json-tree-panel');
    const importsBar = document.getElementById('json-viewer-imports');
    const summaryBar = document.getElementById('json-viewer-summary');
    const closeBtn = document.getElementById('json-viewer-close');
    const copyBtn = document.getElementById('json-viewer-copy');

    const issuesPanel = document.getElementById('json-viewer-issues');

    if (!btn || !overlay) return;

    let _pathLineMap = {};
    let _jsonScrollAnimFrame = null;
    let _jsonScrollProgrammatic = false;
    let _jsonLineHeight = 0;

    function getLineHeight() {
        if (!_jsonLineHeight) {
            _jsonLineHeight = parseFloat(window.getComputedStyle(content).lineHeight) || 20;
        }
        return _jsonLineHeight;
    }

    function animateJsonScrollTo(targetTop, duration = 160) {
        if (_jsonScrollAnimFrame != null) { cancelAnimationFrame(_jsonScrollAnimFrame); _jsonScrollAnimFrame = null; }
        const startTop = content.scrollTop;
        const delta = targetTop - startTop;
        if (Math.abs(delta) < 2) { content.scrollTop = targetTop; return; }
        const startTime = performance.now();
        _jsonScrollProgrammatic = true;
        function step(now) {
            const t = Math.min(1, (now - startTime) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            content.scrollTop = startTop + delta * eased;
            if (t < 1) {
                _jsonScrollAnimFrame = requestAnimationFrame(step);
            } else {
                _jsonScrollAnimFrame = null;
                content.scrollTop = targetTop;
                setTimeout(() => { _jsonScrollProgrammatic = false; }, 60);
            }
        }
        _jsonScrollAnimFrame = requestAnimationFrame(step);
    }

    let _treeScrollAnimFrame = null;
    function scrollTreeIntoView(el, duration = 160) {
        if (!treePanel || !el) return;
        const elRect  = el.getBoundingClientRect();
        const ctRect  = treePanel.getBoundingClientRect();
        const elTop    = treePanel.scrollTop + (elRect.top - ctRect.top);
        const elBottom = elTop + elRect.height;
        const ctTop    = treePanel.scrollTop;
        const ctBottom = ctTop + treePanel.clientHeight;
        let target = ctTop;
        if (elTop < ctTop + 8)           target = elTop - 8;
        else if (elBottom > ctBottom - 8) target = elBottom - treePanel.clientHeight + 8;
        if (target === ctTop) return;
        if (_treeScrollAnimFrame != null) { cancelAnimationFrame(_treeScrollAnimFrame); _treeScrollAnimFrame = null; }
        const startTop = treePanel.scrollTop;
        const delta    = target - startTop;
        if (Math.abs(delta) < 2) { treePanel.scrollTop = target; return; }
        const startTime = performance.now();
        function step(now) {
            const t = Math.min(1, (now - startTime) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            treePanel.scrollTop = startTop + delta * eased;
            if (t < 1) { _treeScrollAnimFrame = requestAnimationFrame(step); }
            else { _treeScrollAnimFrame = null; treePanel.scrollTop = target; }
        }
        _treeScrollAnimFrame = requestAnimationFrame(step);
    }

    function setActiveTreeItem(path) {
        if (!treePanel) return;
        treePanel.querySelectorAll('.jt-active').forEach(el => el.classList.remove('jt-active'));
        let target = path;
        let el = null;
        while (target !== null) {
            const found = [...treePanel.querySelectorAll('.jt-item')].find(e => e.dataset.path === target);
            if (found) { el = found; break; }
            target = _getParentPath(target);
        }
        if (!el) return;
        // Ensure collapsed ancestors are expanded
        let parent = el.parentElement;
        while (parent && parent !== treePanel) {
            if (parent.classList.contains('jt-children') && parent.classList.contains('jt-collapsed')) {
                parent.classList.remove('jt-collapsed');
                const row = parent.previousElementSibling;
                if (row) { const t = row.querySelector('.jt-toggle'); if (t) t.textContent = '\u25BC'; }
            }
            parent = parent.parentElement;
        }
        el.classList.add('jt-active');
        scrollTreeIntoView(el);
    }

    function getContentPaddingTop() {
        return parseFloat(window.getComputedStyle(content).paddingTop) || 0;
    }

    let _lineOffsets = [];
    function buildLineOffsets(text) {
        _lineOffsets = [0];
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '\n') _lineOffsets.push(i + 1);
        }
    }

    function lineToScrollTop(lineNum) {
        const textNode = content.firstChild;
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE || !_lineOffsets.length) {
            return getContentPaddingTop() + lineNum * getLineHeight();
        }
        const charOffset = _lineOffsets[lineNum] || 0;
        const range = document.createRange();
        range.setStart(textNode, charOffset);
        range.setEnd(textNode, charOffset);
        const charRect = range.getBoundingClientRect();
        const containerRect = content.getBoundingClientRect();
        return content.scrollTop + (charRect.top - containerRect.top);
    }

    function syncTreeFromJsonScroll() {
        if (_jsonScrollProgrammatic) return;
        const pt = getContentPaddingTop();
        const lh = getLineHeight();
        const topLine = Math.floor(Math.max(0, content.scrollTop - pt + lh * 0.5) / lh);
        setActiveTreeItem(_findPathAtLine(topLine, _pathLineMap));
    }

    function selectJsonLine(lineNum) {
        const textNode = content.firstChild;
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;
        const text = textNode.textContent;
        const lines = text.split('\n');
        let offset = 0;
        for (let i = 0; i < lineNum; i++) offset += lines[i].length + 1;
        const lineText = (lines[lineNum] || '').trimStart();
        const start = offset + (lines[lineNum] || '').length - lineText.length;
        const end = offset + (lines[lineNum] || '').length;
        if (start >= end) return;
        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, end);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    function syncJsonFromTreeClick(path, { select = true } = {}) {
        const line = _pathLineMap[path];
        if (line === undefined) return;
        const lh = getLineHeight();
        animateJsonScrollTo(Math.max(0, lineToScrollTop(line) - lh * 1.5));
        setActiveTreeItem(path);
        if (select) selectJsonLine(line);
    }

    // Wire up tree clicks (delegated)
    if (treePanel) {
        treePanel.addEventListener('click', e => {
            const item = e.target.closest('.jt-item');
            if (!item || e.target.classList.contains('jt-toggle')) return;
            syncJsonFromTreeClick(item.dataset.path);
        });

        // Restore saved width
        const savedWidth = localStorage.getItem('jsonTreePanelWidth');
        if (savedWidth) treePanel.style.width = savedWidth + 'px';

        // Resize handle
        const resizeHandle = document.getElementById('json-tree-resize-handle');
        if (resizeHandle) {
            let startX = 0;
            let startWidth = 0;
            resizeHandle.addEventListener('mousedown', e => {
                e.preventDefault();
                startX = e.clientX;
                startWidth = treePanel.offsetWidth;
                resizeHandle.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';

                function onMove(e) {
                    const newWidth = Math.min(520, Math.max(120, startWidth + (e.clientX - startX)));
                    treePanel.style.width = newWidth + 'px';
                }
                function onUp() {
                    resizeHandle.classList.remove('dragging');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    localStorage.setItem('jsonTreePanelWidth', treePanel.offsetWidth);
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                }
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        }
    }

    // Wire up JSON scroll → tree
    content.addEventListener('scroll', syncTreeFromJsonScroll);

    // Wire up selection/click in JSON → tree
    document.addEventListener('selectionchange', () => {
        if (overlay.classList.contains('hidden')) return;
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!content.contains(range.startContainer)) return;
        const textNode = content.firstChild;
        if (!textNode) return;
        const offset = range.startContainer === textNode ? range.startOffset : 0;
        const lineNum = content.textContent.substring(0, offset).split('\n').length - 1;
        setActiveTreeItem(_findPathAtLine(lineNum, _pathLineMap));
    });

    btn.addEventListener('click', () => {
        if (issuesPanel) issuesPanel.classList.add('hidden');
        let json;
        if (state.lessonSpec) {
            json = state.lessonSpec;
        } else if (state.currentSpec) {
            json = state.currentSpec;
        }
        // Build JSON text with line map and render tree
        _jsonLineHeight = 0; // reset cached line height
        if (json) {
            const { text, pathLineMap } = _buildJsonWithLineMap(json);
            content.textContent = text;
            buildLineOffsets(text);
            _pathLineMap = pathLineMap;
            if (treePanel) _renderJsonTree(treePanel, json);
        } else {
            content.textContent = '// No scene loaded';
            buildLineOffsets('// No scene loaded');
            _pathLineMap = {};
            if (treePanel) treePanel.innerHTML = '<div class="jt-empty">No scene loaded</div>';
        }

        // Imports section
        const imports = json && Array.isArray(json.import) ? json.import : [];
        if (imports.length > 0 && importsBar) {
            importsBar.innerHTML = '<span class="imports-label">Imports</span>' +
                imports.map(name =>
                    `<a href="/api/domains/${encodeURIComponent(name)}" target="_blank" rel="noopener">${name} ↗</a>`
                ).join('');
            importsBar.classList.remove('hidden');
        } else if (importsBar) {
            importsBar.classList.add('hidden');
        }

        // Summary section
        const s = _computeSceneSummary(json);
        const ag = _computeAgenticScore(json);
        if (s && summaryBar) {
            const stats = [];
            if (s.isLesson) stats.push({ label: 'Scenes',      value: s.sceneCount,       tip: 'Number of scenes in this lesson' });
            stats.push(      { label: 'Steps',       value: s.totalSteps,        tip: 'Total progressive reveal steps across all scenes' });
            stats.push(      { label: 'Sliders',     value: s.totalSliders,      tip: 'Total interactive sliders defined across all steps' });
            stats.push(      { label: 'Animated',    value: s.totalAnimated,     tip: 'Elements re-evaluated every frame — respond to sliders and animation time' });
            stats.push(      { label: 'Static',      value: s.totalStatic,       tip: 'Elements built once at load — fixed geometry, zero per-frame cost' });
            if (s.totalExpressions > 0) stats.push({ label: 'Expressions', value: s.totalExpressions, tip: 'Individual math expression strings driving animated elements' });
            if (s.totalFunctions > 0)   stats.push({ label: 'Functions',   value: s.totalFunctions,   tip: 'Scene-level reusable expression helper functions (scene.functions)' });
            if (s.totalPrompts > 0)     stats.push({ label: 'Prompts',     value: s.totalPrompts,     tip: 'Scenes/steps with a prompt field — agent-specific teaching instructions injected into the AI system prompt' });
            if (s.imports > 0)          stats.push({ label: 'Domains',     value: s.imports,           tip: 'Built-in domain libraries imported (e.g. astrodynamics)' });

            const interactTip = 'Interactiveness Score (0–99)\n\nraw = Sliders × 10 + Animated × 6 + Steps × 4\n    + Expressions × 1 + Functions × 6 + Domains × 12\n\nscore = floor(100 × (1 − e^(−raw / 80)))\n\nApproaches 100 asymptotically — floor() ensures 100 is never displayed.\nraw ≈ 40 → score 39\nraw ≈ 80 → score 63\nraw ≈ 160 → score 86\nraw ≈ 280 → score 97';

            const agenticTip = 'Agentic Score (0–99) — how AI-agent-friendly this scene is\n\nMarkdown presence + length (up to 32)\nPrompt field per scene (up to 25 each)\nStep captions + titles (3 + 1 each)\nSlider labels — descriptive vs bare id (2 each)\nElement ids + labels (1 + 2 each)\nScene/lesson description (3–4)\nDomain imports with docs (10 each)\n\nscore = floor(100 × (1 − e^(−raw / 80)))';

            summaryBar.innerHTML =
                `<span class="summary-score" title="${interactTip}" style="--score-color:${s.scoreColor}">` +
                    `<span class="summary-score-value">${s.score}</span>` +
                    `<span class="summary-score-label">${s.scoreLabel}</span>` +
                `</span>` +
                (ag ? `<span class="summary-score summary-score-agentic" title="${agenticTip}" style="--score-color:${ag.color}">` +
                    `<span class="summary-score-value">${ag.score}</span>` +
                    `<span class="summary-score-label">${ag.label}</span>` +
                `</span>` : '') +
                `<span class="summary-divider"></span>` +
                stats.map(st =>
                    `<span class="summary-stat" title="${st.tip}"><span class="summary-stat-value">${st.value}</span><span class="summary-stat-label">${st.label}</span></span>`
                ).join('');
            if (s.description) {
                const desc = document.createElement('span');
                desc.className = 'summary-description';
                desc.textContent = s.description;
                summaryBar.appendChild(desc);
            }
            // JS Issues badge — shown when trust dialog was triggered
            const existingBadge = summaryBar.querySelector('.summary-stat-js-issues');
            if (existingBadge) existingBadge.remove();
            if (state._sceneIsUnsafe || state._sceneJsIssues.length > 0) {
                const trusted = state._sceneJsTrustState === 'trusted';
                const count = state._sceneIsUnsafe && state._sceneJsIssues.length === 0 ? '!' : state._sceneJsIssues.length;
                const badge = document.createElement('span');
                badge.className = 'summary-stat summary-stat-js-issues' + (trusted ? ' js-trusted' : ' js-untrusted');
                badge.title = 'Click to view detected JavaScript expressions and trust status';
                badge.innerHTML =
                    `<span class="summary-stat-value">${count}</span>` +
                    `<span class="summary-stat-label">JS ${trusted ? '⚡' : '⚠'}</span>`;
                summaryBar.appendChild(badge);
                badge.addEventListener('click', () => _toggleJsIssuesPanel(issuesPanel));
            } else if (issuesPanel) {
                issuesPanel.classList.add('hidden');
            }

            summaryBar.classList.remove('hidden');
        } else if (summaryBar) {
            summaryBar.classList.add('hidden');
        }

        overlay.classList.remove('hidden');
    });

    closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.add('hidden');
    });

    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(content.textContent).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
            overlay.classList.add('hidden');
        }
    });

    // ── Search ──────────────────────────────────────────────────────────────

    const keyInput = document.getElementById('json-search-key');
    const valInput = document.getElementById('json-search-val');
    const keyCount = document.getElementById('json-search-key-count');
    const valCount = document.getElementById('json-search-val-count');
    const prevBtn  = document.getElementById('json-search-prev');
    const nextBtn  = document.getElementById('json-search-next');
    if (!keyInput || !valInput) return;

    let _matchItems = [];
    let _matchIndex = -1;

    function applyTreeSearch() {
        if (!treePanel) return;
        const focused = document.activeElement;
        const keyTerm = keyInput.value.trim().toLowerCase();
        const valTerm = valInput.value.trim().toLowerCase();
        const items   = [...treePanel.querySelectorAll('.jt-item')];

        items.forEach(el => el.classList.remove('jt-dim', 'jt-match'));
        [keyInput, valInput].forEach(inp =>
            inp.classList.remove('jsb-has-results', 'jsb-no-results'));
        if (keyCount) keyCount.textContent = '';
        if (valCount) valCount.textContent = '';
        _matchItems = [];
        _matchIndex = -1;

        if (!keyTerm && !valTerm) return;

        items.forEach(el => {
            const keyEl = el.querySelector(':scope > .jt-row .jt-key');
            const valEl = el.querySelector(':scope > .jt-row .jt-val');
            const keyText = keyEl ? keyEl.textContent.toLowerCase() : '';
            const valText = valEl ? valEl.textContent.toLowerCase() : '';

            const keyOk = !keyTerm || keyText.includes(keyTerm);
            const valOk = !valTerm || valText.includes(valTerm);

            if (keyOk && valOk) {
                el.classList.add('jt-match');
            } else {
                el.classList.add('jt-dim');
            }
        });

        treePanel.querySelectorAll('.jt-item.jt-match').forEach(matchEl => {
            let ancestor = matchEl.parentElement;
            while (ancestor && ancestor !== treePanel) {
                if (ancestor.classList.contains('jt-item')) {
                    ancestor.classList.remove('jt-dim');
                }
                if (ancestor.classList.contains('jt-children') && ancestor.classList.contains('jt-collapsed')) {
                    ancestor.classList.remove('jt-collapsed');
                    const row = ancestor.previousElementSibling;
                    if (row) { const t = row.querySelector('.jt-toggle'); if (t) t.textContent = '\u25BC'; }
                }
                ancestor = ancestor.parentElement;
            }
        });

        _matchItems = [...treePanel.querySelectorAll('.jt-item.jt-match')];
        const n = _matchItems.length;

        if (keyTerm) {
            keyInput.classList.toggle('jsb-has-results', n > 0);
            keyInput.classList.toggle('jsb-no-results',  n === 0);
        }
        if (valTerm) {
            valInput.classList.toggle('jsb-has-results', n > 0);
            valInput.classList.toggle('jsb-no-results',  n === 0);
        }
        if (keyCount) keyCount.textContent = n || (keyTerm ? 'none' : '');
        if (valCount) valCount.textContent = n ? `1/${n}` : (valTerm ? 'none' : '');

        if (n > 0) {
            _matchIndex = 0;
            navigateMatch(0);
        }
        if (focused === keyInput || focused === valInput) setTimeout(() => focused.focus(), 0);
    }

    function navigateMatch(delta) {
        if (!_matchItems.length) return;
        const focused = document.activeElement;
        _matchIndex = ((_matchIndex + delta) % _matchItems.length + _matchItems.length) % _matchItems.length;
        const el = _matchItems[_matchIndex];
        scrollTreeIntoView(el);
        syncJsonFromTreeClick(el.dataset.path, { select: false });
        if (focused === keyInput || focused === valInput) {
            setTimeout(() => focused.focus(), 0);
        }
        const label = `${_matchIndex + 1}/${_matchItems.length}`;
        if (valCount) valCount.textContent = label;
        if (keyCount) keyCount.textContent = label;
    }

    keyInput.addEventListener('input', applyTreeSearch);
    valInput.addEventListener('input', applyTreeSearch);

    [keyInput, valInput].forEach(inp => {
        inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                navigateMatch(e.shiftKey ? -1 : 1);
            }
        });
    });

    nextBtn.addEventListener('click', () => navigateMatch(1));
    prevBtn.addEventListener('click', () => navigateMatch(-1));

    const clearBtn = document.getElementById('json-search-clear');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            keyInput.value = '';
            valInput.value = '';
            applyTreeSearch();
        });
    }
}

// ----- Context Status Popup -----

export function setupContextStatusPopup() {
    const pill = document.getElementById('context-status');
    const popup = document.getElementById('context-popup');
    const meta = document.getElementById('context-popup-meta');
    const nav = document.getElementById('context-popup-nav');
    const body = document.getElementById('context-popup-body');
    const closeBtn = document.getElementById('context-popup-close');
    const copyBtn = document.getElementById('context-popup-copy');
    const toggleBtn = document.getElementById('context-popup-toggle');
    const topResizeHandle = document.getElementById('context-popup-top-resize');
    const rightResizeHandle = document.getElementById('context-popup-right-resize');
    if (!pill || !popup || !meta || !nav || !body || !closeBtn || !copyBtn || !toggleBtn || !topResizeHandle || !rightResizeHandle) return;

    if (document.body.dataset.debugMode !== 'true') {
        pill.classList.add('hidden');
        popup.classList.add('hidden');
        return;
    }

    let currentPromptText = '';
    let sectionEls = [];
    let navButtons = [];
    let programmaticScrollIndex = -1;
    let programmaticScrollTimer = null;
    let contextScrollAnimFrame = null;
    let contextRefreshTimer = null;
    let contextCollapsed = true;
    let popupResizeCleanup = null;
    const CONTEXT_POPUP_SIZE_KEY = 'algebench-context-popup-size';
    const CONTEXT_POPUP_STATE_KEY = 'algebench-context-popup-state';

    function readStoredContextPopupState() {
        try {
            const raw = localStorage.getItem(CONTEXT_POPUP_STATE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return {
                collapsed: typeof parsed?.collapsed === 'boolean' ? parsed.collapsed : null,
            };
        } catch (_err) {
            return {};
        }
    }

    function storeContextPopupState({ collapsed }) {
        const current = readStoredContextPopupState();
        const next = {
            collapsed: typeof collapsed === 'boolean' ? collapsed : current.collapsed,
        };
        try {
            localStorage.setItem(CONTEXT_POPUP_STATE_KEY, JSON.stringify(next));
        } catch (_err) {}
    }

    function readStoredContextPopupSize() {
        try {
            const raw = localStorage.getItem(CONTEXT_POPUP_SIZE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return {
                width: Number.isFinite(parsed?.width) ? parsed.width : null,
                height: Number.isFinite(parsed?.height) ? parsed.height : null,
            };
        } catch (_err) {
            return {};
        }
    }

    function storeContextPopupSize({ width, height }) {
        const current = readStoredContextPopupSize();
        const next = {
            width: Number.isFinite(width) ? Math.round(width) : current.width,
            height: Number.isFinite(height) ? Math.round(height) : current.height,
        };
        try {
            localStorage.setItem(CONTEXT_POPUP_SIZE_KEY, JSON.stringify(next));
        } catch (_err) {}
    }

    function getContextPopupSizeCaps() {
        const sideGap = window.innerWidth <= 900 ? 8 : 12;
        return {
            maxWidth: Math.max(272, window.innerWidth - sideGap * 2),
            maxHeight: Math.max(220, window.innerHeight - 48),
        };
    }

    function applyStoredContextPopupSize() {
        const stored = readStoredContextPopupSize();
        const caps = getContextPopupSizeCaps();
        const width = Number.isFinite(stored.width) ? Math.min(stored.width, caps.maxWidth) : null;
        const height = Number.isFinite(stored.height) ? Math.min(stored.height, caps.maxHeight) : null;

        if (contextCollapsed) {
            popup.style.right = '';
            popup.style.width = '';
        } else if (width != null) {
            popup.style.right = window.innerWidth <= 900 ? '8px' : '12px';
            popup.style.width = `${Math.round(width)}px`;
        } else {
            popup.style.right = '';
            popup.style.width = '';
        }

        if (height != null) {
            popup.style.height = `${Math.round(height)}px`;
        } else {
            popup.style.height = '';
        }
    }

    function updateContextPopupMode() {
        popup.classList.toggle('collapsed', contextCollapsed);
        toggleBtn.textContent = contextCollapsed ? '\u2630' : '\u2630';
        toggleBtn.title = contextCollapsed ? 'Expand text pane' : 'Collapse text pane';
        storeContextPopupState({ collapsed: contextCollapsed });
        applyStoredContextPopupSize();
    }

    function clearPopupResizeHandlers() {
        if (popupResizeCleanup) {
            popupResizeCleanup();
            popupResizeCleanup = null;
        }
    }

    function beginContextHeightResize(startEvent) {
        startEvent.preventDefault();
        startEvent.stopPropagation();
        clearPopupResizeHandlers();

        const startY = startEvent.clientY;
        const rect = popup.getBoundingClientRect();
        const startHeight = rect.height;
        const { maxHeight } = getContextPopupSizeCaps();
        const minHeight = 220;

        popup.style.height = `${Math.round(startHeight)}px`;

        const onMove = (moveEvt) => {
            const dy = moveEvt.clientY - startY;
            const nextHeight = Math.max(minHeight, Math.min(maxHeight, startHeight - dy));
            popup.style.height = `${Math.round(nextHeight)}px`;
            storeContextPopupSize({ height: nextHeight });
        };

        const onUp = () => {
            clearPopupResizeHandlers();
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp, { once: true });
        popupResizeCleanup = () => {
            window.removeEventListener('mousemove', onMove);
        };
    }

    function beginContextWidthResize(startEvent) {
        if (contextCollapsed) return;
        startEvent.preventDefault();
        startEvent.stopPropagation();
        clearPopupResizeHandlers();

        const startX = startEvent.clientX;
        const rect = popup.getBoundingClientRect();
        const startWidth = rect.width;
        const { maxWidth } = getContextPopupSizeCaps();
        const minWidth = 320;

        popup.style.right = window.innerWidth <= 900 ? '8px' : '12px';
        popup.style.width = `${Math.round(startWidth)}px`;

        const onMove = (moveEvt) => {
            const dx = moveEvt.clientX - startX;
            const nextWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + dx));
            popup.style.width = `${Math.round(nextWidth)}px`;
            storeContextPopupSize({ width: nextWidth });
        };

        const onUp = () => {
            clearPopupResizeHandlers();
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp, { once: true });
        popupResizeCleanup = () => {
            window.removeEventListener('mousemove', onMove);
        };
    }

    function parsePromptSections(text) {
        const lines = String(text || '').split('\n');
        const sections = [];
        let current = { title: 'Prelude', body: [] };

        function flushCurrent() {
            const content = current.body.join('\n').trim();
            if (!content) return;
            sections.push({
                title: current.title,
                content,
            });
        }

        for (const line of lines) {
            const match = line.match(/^##\s+(.*)$/);
            if (match) {
                flushCurrent();
                current = { title: match[1].trim(), body: [] };
            } else {
                current.body.push(line);
            }
        }
        flushCurrent();

        if (!sections.length) {
            return [{ title: 'Prompt', content: String(text || '').trim() || '(empty prompt)' }];
        }
        return sections;
    }

    function setActiveSection(index) {
        navButtons.forEach((btn, i) => btn.classList.toggle('active', i === index));
    }

    function getContextScrollLeadRows(rowCount = 3) {
        const lineHeight = parseFloat(window.getComputedStyle(body).lineHeight);
        const rowHeight = Number.isFinite(lineHeight) ? lineHeight : 20;
        return Math.round(rowHeight * rowCount);
    }

    function clearProgrammaticScroll() {
        programmaticScrollIndex = -1;
        if (contextScrollAnimFrame != null) {
            cancelAnimationFrame(contextScrollAnimFrame);
            contextScrollAnimFrame = null;
        }
        if (programmaticScrollTimer) {
            clearTimeout(programmaticScrollTimer);
            programmaticScrollTimer = null;
        }
    }

    function scheduleContextRefresh(_reason = 'context-change') {
        if (popup.classList.contains('hidden')) return;
        if (contextRefreshTimer) clearTimeout(contextRefreshTimer);
        contextRefreshTimer = setTimeout(async () => {
            contextRefreshTimer = null;
            meta.textContent = 'Refreshing live prompt context…';
            try {
                await loadPromptContext();
                console.log(`%c📋 Prompt context refreshed%c (${currentPromptText.length} chars)`, 'color: #aa88ff; font-weight: bold', 'color: #ccc');
            } catch (err) {
                body.innerHTML = '';
                const empty = document.createElement('div');
                empty.className = 'context-popup-empty';
                empty.textContent = `Unable to build prompt context: ${err.message || err}`;
                body.appendChild(empty);
                meta.textContent = 'Prompt context unavailable';
            }
        }, 120);
    }

    function scheduleProgrammaticScrollRelease() {
        if (programmaticScrollTimer) clearTimeout(programmaticScrollTimer);
        programmaticScrollTimer = setTimeout(() => {
            if (programmaticScrollIndex >= 0) {
                setActiveSection(programmaticScrollIndex);
            }
            clearProgrammaticScroll();
        }, 140);
    }

    function animateContextScrollTo(targetTop, duration = 160) {
        if (contextScrollAnimFrame != null) {
            cancelAnimationFrame(contextScrollAnimFrame);
            contextScrollAnimFrame = null;
        }
        const startTop = body.scrollTop;
        const delta = targetTop - startTop;
        if (Math.abs(delta) < 1) {
            body.scrollTop = targetTop;
            return;
        }
        const startTime = performance.now();

        function step(now) {
            const t = Math.min(1, (now - startTime) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            body.scrollTop = startTop + delta * eased;
            if (t < 1) {
                contextScrollAnimFrame = requestAnimationFrame(step);
            } else {
                contextScrollAnimFrame = null;
                body.scrollTop = targetTop;
            }
        }

        contextScrollAnimFrame = requestAnimationFrame(step);
    }

    function syncActiveSectionFromScroll() {
        if (!sectionEls.length) return;
        if (contextCollapsed) return;
        if (programmaticScrollIndex >= 0) {
            scheduleProgrammaticScrollRelease();
            return;
        }
        const scrollTop = body.scrollTop + 108;
        let activeIndex = 0;
        for (let i = 0; i < sectionEls.length; i++) {
            if (sectionEls[i].offsetTop <= scrollTop) activeIndex = i;
            else break;
        }
        setActiveSection(activeIndex);
    }

    function renderPrompt(text) {
        const sections = parsePromptSections(text);
        sectionEls = [];
        navButtons = [];
        nav.innerHTML = '';
        body.innerHTML = '';

        sections.forEach((section, index) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'context-nav-btn';
            btn.textContent = section.title;
            btn.addEventListener('click', () => {
                const target = sectionEls[index];
                if (!target) return;
                if (contextCollapsed) {
                    contextCollapsed = false;
                    updateContextPopupMode();
                }
                const targetTop = Math.max(0, target.offsetTop - getContextScrollLeadRows(5));
                programmaticScrollIndex = index;
                scheduleProgrammaticScrollRelease();
                animateContextScrollTo(targetTop);
                setActiveSection(index);
            });
            nav.appendChild(btn);
            navButtons.push(btn);

            const sec = document.createElement('section');
            sec.className = 'context-section';

            const heading = document.createElement('div');
            heading.className = 'context-section-heading';
            heading.textContent = section.title;
            sec.appendChild(heading);

            const pre = document.createElement('pre');
            pre.className = 'context-section-pre';
            pre.textContent = section.content;
            sec.appendChild(pre);

            body.appendChild(sec);
            sectionEls.push(sec);
        });

        meta.textContent = `${text.length} chars • ${sections.length} sections • built from live client context`;
        clearProgrammaticScroll();
        setActiveSection(0);
        body.scrollTop = 0;
    }

    async function loadPromptContext() {
        const contextBuilder = window.algebenchBuildChatContext;
        if (typeof contextBuilder !== 'function') {
            throw new Error('Chat context builder is not available yet.');
        }
        const res = await fetch('/api/debug/system_prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context: contextBuilder() }),
        });
        if (!res.ok) {
            let message = `HTTP ${res.status}`;
            try {
                const data = await res.json();
                if (data && data.error) message = data.error;
            } catch (_err) {}
            throw new Error(message);
        }
        const data = await res.json();
        currentPromptText = data.systemPrompt || '';
        renderPrompt(currentPromptText);
    }

    body.addEventListener('scroll', syncActiveSectionFromScroll);
    window.algebenchRefreshPromptContext = (reason = 'manual') => {
        scheduleContextRefresh(reason);
    };
    const refreshBtn = document.getElementById('context-popup-refresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => scheduleContextRefresh('manual'));
    }

    pill.classList.remove('hidden');
    {
        const storedState = readStoredContextPopupState();
        if (typeof storedState.collapsed === 'boolean') {
            contextCollapsed = storedState.collapsed;
        }
    }
    updateContextPopupMode();
    pill.addEventListener('click', async () => {
        const opening = popup.classList.contains('hidden');
        if (!opening) {
            popup.classList.add('hidden');
            return;
        }
        popup.classList.remove('hidden');
        currentPromptText = '';
        clearProgrammaticScroll();
        applyStoredContextPopupSize();
        nav.innerHTML = '';
        body.innerHTML = '<div class="context-popup-empty">Building current system prompt…</div>';
        meta.textContent = 'Fetching live prompt context…';
        try {
            await loadPromptContext();
            console.log(`%c📋 Prompt context loaded%c (${currentPromptText.length} chars)`, 'color: #aa88ff; font-weight: bold', 'color: #ccc');
        } catch (err) {
            body.innerHTML = '';
            const empty = document.createElement('div');
            empty.className = 'context-popup-empty';
            empty.textContent = `Unable to build prompt context: ${err.message || err}`;
            body.appendChild(empty);
            meta.textContent = 'Prompt context unavailable';
        }
    });

    toggleBtn.addEventListener('click', () => {
        contextCollapsed = !contextCollapsed;
        updateContextPopupMode();
    });

    closeBtn.addEventListener('click', () => {
        clearProgrammaticScroll();
        clearPopupResizeHandlers();
        popup.classList.add('hidden');
    });

    copyBtn.addEventListener('click', async () => {
        if (!currentPromptText) return;
        try {
            await navigator.clipboard.writeText(currentPromptText);
            const prev = copyBtn.textContent;
            copyBtn.textContent = 'Copied';
            setTimeout(() => { copyBtn.textContent = prev; }, 900);
        } catch (_err) {}
    });

    topResizeHandle.addEventListener('mousedown', beginContextHeightResize);
    rightResizeHandle.addEventListener('mousedown', beginContextWidthResize);

    window.addEventListener('resize', () => {
        applyStoredContextPopupSize();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !popup.classList.contains('hidden')) {
            clearProgrammaticScroll();
            clearPopupResizeHandlers();
            popup.classList.add('hidden');
        }
    });
}
