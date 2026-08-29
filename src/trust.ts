// ============================================================
// Expression trust system — scan scenes for unsafe JS,
// show the trust dialog, and update the trust pill.
// ============================================================

import { state } from '/state.js';
import { _JS_ONLY_RE } from '/expr.js';

/** A JS-only expression found while scanning a scene spec. */
export interface TrustIssue {
    /** Dotted/indexed path to the offending value within the spec. */
    path: string;
    expr: string;
    type: 'expr' | 'template';
}

// state.js is still untyped JavaScript, so its fields infer from their
// initializers (`_sceneJsIssues: []` reads back as never[]). Describe just the
// slice this module touches instead of spreading `any` through the file; the
// cast goes away when state.js itself is converted.
interface TrustState {
    _sceneJsIssues: TrustIssue[];
    _sceneJsTrustState: string | null;
    _sceneIsUnsafe: boolean;
}
const trustState = state as unknown as TrustState;

// Callback registered by json-browser.js via setIssuesPanelToggle()
// to avoid a circular import (trust ↔ json-browser).
type IssuesPanelToggle = (el: HTMLElement | null) => void;
let _issuesPanelToggleFn: IssuesPanelToggle | null = null;
export function setIssuesPanelToggle(fn: IssuesPanelToggle): void {
    _issuesPanelToggleFn = fn;
}

export function scanSpecForUnsafeJs(spec: unknown): boolean {
    const issues: TrustIssue[] = [];
    const EXPR_KEYS = new Set(['expr', 'x', 'y', 'z', 'expression', 'fx', 'fy', 'fz']);
    // Coordinate arrays holding math.js ONE LEVEL DOWN: `points: [["ax","ay","0"], …]`.
    // `animated_line` compiles every one of those strings through `compileExpr`
    // (src/objects/animated-line.ts), exactly as it would an `expr`, and neither
    // name follows the `*Expr` convention that would have caught them.
    //
    // Leaving them out was never an execution bypass — `compileExpr` gates on
    // trust itself and returns `compile('0')` when the scene is untrusted. It
    // meant the dialog was never OFFERED, so such a scene silently drew those
    // points at the origin instead of asking the reader whether to run it.
    //
    // Mirrors NESTED_COORD_KEYS in backend/expression_fields.py, which is the
    // definition; tests/test_expression_keys_sync.py fails if the two drift.
    const NESTED_COORD_KEYS = new Set(['points', 'vertices']);
    const _TEMPLATE_RE = /\{\{([\s\S]*?)\}\}/g;

    function _isExprKey(k: string): boolean {
        return EXPR_KEYS.has(k) || (k.endsWith('Expr') && k.length > 4);
    }

    /** Whether a key's value may CONTAIN math.js at any depth. */
    function _carriesExpressions(k: string): boolean {
        return _isExprKey(k) || NESTED_COORD_KEYS.has(k);
    }

    function walk(obj: unknown, parentKey: string | null, path: string): void {
        if (typeof obj === 'string') {
            if (parentKey && _carriesExpressions(parentKey) && _JS_ONLY_RE.test(obj)) {
                issues.push({ path, expr: obj, type: 'expr' });
            }
            return;
        }
        if (Array.isArray(obj)) {
            obj.forEach((item: unknown, i: number) => walk(item, parentKey, `${path}[${i}]`));
            return;
        }
        if (obj && typeof obj === 'object') {
            Object.entries(obj as Record<string, unknown>).forEach(([k, v]) => {
                const childPath = path ? `${path}.${k}` : k;
                if (k === 'content' && typeof v === 'string') {
                    let m: RegExpExecArray | null;
                    _TEMPLATE_RE.lastIndex = 0;
                    while ((m = _TEMPLATE_RE.exec(v)) !== null) {
                        // The pattern has exactly one capture group, so a match
                        // always carries m[1]; `!` keeps that assumption where
                        // the JavaScript had it implicitly.
                        const inner = m[1]!;
                        if (_JS_ONLY_RE.test(inner)) {
                            issues.push({ path: childPath, expr: inner.trim(), type: 'template' });
                        }
                    }
                }
                walk(v, k, childPath);
            });
        }
    }

    walk(spec, null, '');
    trustState._sceneJsIssues = issues;
    return issues.length > 0;
}

export function showTrustDialog(explanation: string, imports?: string[]): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const overlay = document.getElementById('trust-dialog-overlay');
        const body = document.getElementById('trust-dialog-body');
        const allowBtn = document.getElementById('trust-btn-allow');
        const denyBtn = document.getElementById('trust-btn-deny');
        if (!overlay) { resolve(false); return; }
        // Only `overlay` was ever guarded: a missing body/allow/deny button
        // threw here before and still must, rather than silently opening a
        // dialog with no content or no way to answer it.
        const bodyEl = body!;
        const allow = allowBtn!;
        const deny = denyBtn!;

        bodyEl.innerHTML = '';
        const explanationEl = document.createElement('p');
        explanationEl.textContent = explanation;
        bodyEl.appendChild(explanationEl);

        if (Array.isArray(imports) && imports.length > 0) {
            const domainNote = document.createElement('div');
            domainNote.className = 'trust-dialog-domains';
            const label = document.createElement('span');
            label.textContent = 'Built-in domain libraries loaded:';
            domainNote.appendChild(label);
            const pills = document.createElement('span');
            pills.className = 'trust-dialog-domain-pills';
            imports.forEach((name: string) => {
                const pill = document.createElement('span');
                pill.className = 'trust-dialog-domain-pill';
                pill.textContent = name;
                pills.appendChild(pill);
            });
            domainNote.appendChild(pills);
            bodyEl.appendChild(domainNote);
        }

        overlay.classList.remove('hidden');
        function cleanup(result: boolean): void {
            overlay!.classList.add('hidden');
            allow.removeEventListener('click', onAllow);
            deny.removeEventListener('click', onDeny);
            resolve(result);
        }
        function onAllow() { cleanup(true); }
        function onDeny() { cleanup(false); }
        allow.addEventListener('click', onAllow);
        deny.addEventListener('click', onDeny);
    });
}

export function updateJsTrustPill(): void {
    const pill = document.getElementById('js-trust-pill');
    const icon = document.getElementById('js-trust-pill-icon');
    const label = document.getElementById('js-trust-pill-label');
    if (!pill) return;

    // As above: only `pill` was guarded, so a missing icon/label still throws.
    if (trustState._sceneJsTrustState === 'trusted') {
        pill.className = 'js-trusted';
        icon!.textContent = '⚡';
        label!.textContent = 'Native JS';
        pill.classList.remove('hidden');
    } else if (trustState._sceneJsTrustState === 'untrusted') {
        pill.className = 'js-untrusted';
        icon!.textContent = '⚠';
        label!.textContent = 'JS disabled';
        pill.classList.remove('hidden');
    } else {
        pill.classList.add('hidden');
    }

    const pillClickable = trustState._sceneIsUnsafe || trustState._sceneJsIssues.length > 0;
    pill.onclick = pillClickable ? () => {
        (document.getElementById('btn-show-json') as HTMLElement).click();
        if (_issuesPanelToggleFn) {
            _issuesPanelToggleFn(document.getElementById('json-viewer-issues'));
        }
    } : null;
    (pill as HTMLElement).style.cursor = pillClickable ? 'pointer' : '';
}
