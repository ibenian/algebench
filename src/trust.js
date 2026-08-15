// ============================================================
// Expression trust system — scan scenes for unsafe JS,
// show the trust dialog, and update the trust pill.
// ============================================================

import { state } from '/state.js';
import { _JS_ONLY_RE } from '/expr.js';

// Callback registered by json-browser.js via setIssuesPanelToggle()
// to avoid a circular import (trust ↔ json-browser).
let _issuesPanelToggleFn = null;
export function setIssuesPanelToggle(fn) {
    _issuesPanelToggleFn = fn;
}

export function scanSpecForUnsafeJs(spec) {
    const issues = [];
    const EXPR_KEYS = new Set(['expr', 'x', 'y', 'z', 'expression', 'fx', 'fy', 'fz']);
    const _TEMPLATE_RE = /\{\{([\s\S]*?)\}\}/g;

    function _isExprKey(k) {
        return EXPR_KEYS.has(k) || (k.endsWith('Expr') && k.length > 4);
    }

    function walk(obj, parentKey, path) {
        if (typeof obj === 'string') {
            if (parentKey && _isExprKey(parentKey) && _JS_ONLY_RE.test(obj)) {
                issues.push({ path, expr: obj, type: 'expr' });
            }
            return;
        }
        if (Array.isArray(obj)) {
            obj.forEach((item, i) => walk(item, parentKey, `${path}[${i}]`));
            return;
        }
        if (obj && typeof obj === 'object') {
            Object.entries(obj).forEach(([k, v]) => {
                const childPath = path ? `${path}.${k}` : k;
                if (k === 'content' && typeof v === 'string') {
                    let m;
                    _TEMPLATE_RE.lastIndex = 0;
                    while ((m = _TEMPLATE_RE.exec(v)) !== null) {
                        if (_JS_ONLY_RE.test(m[1])) {
                            issues.push({ path: childPath, expr: m[1].trim(), type: 'template' });
                        }
                    }
                }
                walk(v, k, childPath);
            });
        }
    }

    walk(spec, null, '');
    state._sceneJsIssues = issues;
    return issues.length > 0;
}

export function showTrustDialog(explanation, imports) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('trust-dialog-overlay');
        const body = document.getElementById('trust-dialog-body');
        const allowBtn = document.getElementById('trust-btn-allow');
        const denyBtn = document.getElementById('trust-btn-deny');
        if (!overlay) { resolve(false); return; }

        body.innerHTML = '';
        const explanationEl = document.createElement('p');
        explanationEl.textContent = explanation;
        body.appendChild(explanationEl);

        if (Array.isArray(imports) && imports.length > 0) {
            const domainNote = document.createElement('div');
            domainNote.className = 'trust-dialog-domains';
            const label = document.createElement('span');
            label.textContent = 'Built-in domain libraries loaded:';
            domainNote.appendChild(label);
            const pills = document.createElement('span');
            pills.className = 'trust-dialog-domain-pills';
            imports.forEach(name => {
                const pill = document.createElement('span');
                pill.className = 'trust-dialog-domain-pill';
                pill.textContent = name;
                pills.appendChild(pill);
            });
            domainNote.appendChild(pills);
            body.appendChild(domainNote);
        }

        overlay.classList.remove('hidden');
        function cleanup(result) {
            overlay.classList.add('hidden');
            allowBtn.removeEventListener('click', onAllow);
            denyBtn.removeEventListener('click', onDeny);
            resolve(result);
        }
        function onAllow() { cleanup(true); }
        function onDeny() { cleanup(false); }
        allowBtn.addEventListener('click', onAllow);
        denyBtn.addEventListener('click', onDeny);
    });
}

export function updateJsTrustPill() {
    const pill = document.getElementById('js-trust-pill');
    const icon = document.getElementById('js-trust-pill-icon');
    const label = document.getElementById('js-trust-pill-label');
    if (!pill) return;

    if (state._sceneJsTrustState === 'trusted') {
        pill.className = 'js-trusted';
        icon.textContent = '⚡';
        label.textContent = 'Native JS';
        pill.classList.remove('hidden');
    } else if (state._sceneJsTrustState === 'untrusted') {
        pill.className = 'js-untrusted';
        icon.textContent = '⚠';
        label.textContent = 'JS disabled';
        pill.classList.remove('hidden');
    } else {
        pill.classList.add('hidden');
    }

    const pillClickable = state._sceneIsUnsafe || state._sceneJsIssues.length > 0;
    pill.onclick = pillClickable ? () => {
        document.getElementById('btn-show-json').click();
        if (_issuesPanelToggleFn) {
            _issuesPanelToggleFn(document.getElementById('json-viewer-issues'));
        }
    } : null;
    pill.style.cursor = pillClickable ? 'pointer' : '';
}
