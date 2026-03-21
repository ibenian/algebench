// ============================================================
// Expression sandbox — math.js setup, compile/eval, scene
// functions, virtual time, and domain library imports.
// ============================================================

import { state } from '/state.js';

// Sandboxed math.js instance — no browser API access from expressions.
// `math` is loaded as a plain <script> tag in index.html.
const _mathjs = math.create(math.all);

// ── Math.js extensions ────────────────────────────────────────────────────────
// Add custom helper functions HERE ONLY. They are automatically imported into
// both the math.js evaluator (_mathjs.import) and the JS fallback scope
// (_EXPR_HELPERS), so both evaluators always stay consistent.
const _MATHJS_EXTENSIONS = {
    toFixed: (val, decimals) => Number(val).toFixed(Number(decimals)),
    concat: (...args) => args.map(a => String(a)).join(''),
    // bar(value, width=20) — Unicode block progress bar, e.g. bar(0.4) → "████████░░░░░░░░░░░░"
    bar: (val, w = 20) => {
        const n = Math.round(Math.max(0, Math.min(1, Number(val))) * Number(w));
        return '\u2588'.repeat(n) + '\u2591'.repeat(Number(w) - n);
    },
};

_mathjs.import({
    ..._MATHJS_EXTENSIONS,
    // Disable escape hatches — must come after custom functions
    import:     function() { throw new Error('import disabled'); },
    createUnit: function() { throw new Error('createUnit disabled'); },
}, { override: true });

// Detects expressions that require native JS execution.
// \.([a-zA-Z_]\w*)\s*\( catches method calls like .toFixed( .constructor( —
// prevents prototype-chain escapes (e.g. (0).constructor.constructor('return fetch(...)')()).
// Decimal numbers (3.14) are safe because digits follow the dot, not letters.
export const _JS_ONLY_RE = /\blet\b|\bconst\b|\bvar\b|\breturn\b|\bfor\s*\(|\bwhile\s*\(|=>|\bfunction\b|\bMath\.|\.([a-zA-Z_]\w*)\s*\(/;

// Populated from _MATHJS_EXTENSIONS — do not add helpers here directly.
const _EXPR_HELPERS = { ..._MATHJS_EXTENSIONS };

const _CORE_MATH_NAMES = ['sin','cos','tan','asin','acos','atan','atan2','sinh','cosh','tanh',
    'abs','sqrt','cbrt','pow','exp','log','log2','log10','floor','ceil','round','trunc',
    'min','max','sign','hypot','PI','E'];

const _MATH_SCOPE = Object.fromEntries(
    _CORE_MATH_NAMES.map(n => [n, Object.prototype.hasOwnProperty.call(_EXPR_HELPERS, n) ? _EXPR_HELPERS[n] : Math[n]])
);

const _SCENE_FN_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function _isValidSceneFunctionName(name) {
    return typeof name === 'string' && _SCENE_FN_NAME_RE.test(name);
}

function _getMathNamesAndValues() {
    const names = _CORE_MATH_NAMES.slice();
    const vals = names.map(n => (Object.prototype.hasOwnProperty.call(_EXPR_HELPERS, n) ? _EXPR_HELPERS[n] : Math[n]));
    for (const src of [state._activeDomainFunctions, state.activeSceneExprFunctions]) {
        for (const [name, fn] of Object.entries(src || {})) {
            if (typeof fn !== 'function') continue;
            if (names.includes(name)) continue;
            names.push(name);
            vals.push(fn);
        }
    }
    return { names, vals };
}

function _buildScope(extras) {
    const scope = {
        ..._MATH_SCOPE, ..._EXPR_HELPERS,
        ...state._activeDomainFunctions,
        ...(state.activeSceneExprFunctions || {}),
        ...extras,
    };
    for (const [id, s] of Object.entries(state.sceneSliders)) scope[id] = s ? s.value : 0;
    return scope;
}

function _loadDomainScript(name) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `/domains/${name}/index.js`;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load domain: ${name}`));
        document.head.appendChild(script);
    });
}

export async function importDomains(importList) {
    state._activeDomainFunctions = {};
    if (!Array.isArray(importList) || importList.length === 0) return;
    for (const name of importList) {
        if (typeof name !== 'string') continue;
        if (!window.AlgeBenchDomains._registry[name]) {
            try {
                await _loadDomainScript(name);
            } catch (err) {
                console.warn(`[domains] could not load domain "${name}":`, err);
                continue;
            }
        }
        const fns = window.AlgeBenchDomains._registry[name];
        if (fns) {
            if (typeof fns._init === 'function') {
                fns._init({
                    getSlider(id, fallback = 0) {
                        const s = state.sceneSliders[id];
                        if (!s) return fallback;
                        const v = Number(s.value);
                        return Number.isFinite(v) ? v : fallback;
                    },
                });
            }
            const { _init, ...publicFns } = fns;
            Object.assign(state._activeDomainFunctions, publicFns);
        }
    }
}

export function setActiveSceneFunctions(scene) {
    state.activeSceneExprFunctions = {};
    state.activeSceneFunctionDefs = [];
    const defs = scene && Array.isArray(scene.functions) ? scene.functions : [];
    if (!defs.length) return;

    const used = new Set();
    const normalized = [];
    for (const raw of defs) {
        if (!raw || typeof raw !== 'object') continue;
        const name = typeof raw.name === 'string' ? raw.name : raw.id;
        if (!_isValidSceneFunctionName(name)) {
            console.warn('scene.functions entry skipped (invalid name):', raw);
            continue;
        }
        if (_CORE_MATH_NAMES.includes(name) || Object.prototype.hasOwnProperty.call(_EXPR_HELPERS, name)
                || Object.prototype.hasOwnProperty.call(state._activeDomainFunctions, name)) {
            console.warn('scene.functions entry skipped (reserved name):', name);
            continue;
        }
        if (used.has(name)) {
            console.warn('scene.functions entry skipped (duplicate name):', name);
            continue;
        }
        const expr = typeof raw.expr === 'string' ? raw.expr : raw.expression;
        if (typeof expr !== 'string' || !expr.trim()) {
            console.warn('scene.functions entry skipped (missing expr):', name);
            continue;
        }
        const argsRaw = Array.isArray(raw.args) ? raw.args : [];
        const args = [];
        let badArgs = false;
        for (const a of argsRaw) {
            if (!_isValidSceneFunctionName(a)) { badArgs = true; break; }
            if (args.includes(a))              { badArgs = true; break; }
            args.push(a);
        }
        if (badArgs) {
            console.warn('scene.functions entry skipped (invalid args):', name);
            continue;
        }
        normalized.push({ name, args, expr });
        used.add(name);
    }

    // Reserve names first so JS fallback compilation can reference other scene functions.
    for (const def of normalized) {
        state.activeSceneExprFunctions[def.name] = () => 0;
    }

    for (const def of normalized) {
        let compiled;
        try {
            compiled = compileExpr(def.expr);
        } catch (err) {
            console.warn('scene.functions compile error:', def.name, err);
            compiled = _mathjs.compile('0');
        }
        state.activeSceneFunctionDefs.push({ ...def, compiled });
    }

    for (const def of state.activeSceneFunctionDefs) {
        state.activeSceneExprFunctions[def.name] = (...callArgs) => {
            const frame = state._activeExprEvalFrame || null;
            const scope = frame && frame.extraScope && typeof frame.extraScope === 'object'
                ? { ...frame.extraScope } : {};
            for (let i = 0; i < def.args.length; i++) {
                scope[def.args[i]] = i < callArgs.length ? callArgs[i] : 0;
            }
            if (frame && Number.isFinite(frame.t)) scope.t = frame.t;
            if (frame && Number.isFinite(frame.u)) scope.u = frame.u;
            if (frame && Number.isFinite(frame.v)) scope.v = frame.v;
            const tEval = (frame && Number.isFinite(frame.t)) ? frame.t : 0;
            return evalExpr(def.compiled, tEval, { useVirtualTime: false, extraScope: scope });
        };
    }
}

export function recompileActiveSceneFunctions() {
    if (!Array.isArray(state.activeSceneFunctionDefs) || !state.activeSceneFunctionDefs.length) return;
    for (const def of state.activeSceneFunctionDefs) {
        try {
            def.compiled = compileExpr(def.expr);
        } catch (err) {
            console.warn('scene.functions recompile error:', def.name, err);
            def.compiled = _mathjs.compile('0');
        }
    }
}

function _normalizeVirtualTimeExpr(spec) {
    if (typeof spec === 'string') return spec;
    if (spec && spec.options) {
        if (typeof spec.options.expr === 'string') return spec.options.expr;
        if (typeof spec.options.scale === 'number') return `${Number(spec.options.scale)}*t`;
    }
    if (spec && typeof spec.expr === 'string') return spec.expr;
    return null;
}

export function setActiveVirtualTimeExpr(scene, stepIdx) {
    const sceneExpr = _normalizeVirtualTimeExpr(scene && scene.virtualTime);
    let stepExpr = null;
    if (scene && Array.isArray(scene.steps) && stepIdx >= 0 && scene.steps[stepIdx]) {
        stepExpr = _normalizeVirtualTimeExpr(scene.steps[stepIdx].virtualTime);
    }
    state.activeVirtualTimeExpr = stepExpr || sceneExpr || null;
    if (!state.activeVirtualTimeExpr) {
        state.activeVirtualTimeCompiled = null;
        return;
    }
    try {
        state.activeVirtualTimeCompiled = compileExpr(state.activeVirtualTimeExpr);
    } catch (err) {
        console.warn('virtualTime compile error:', err);
        state.activeVirtualTimeCompiled = null;
    }
}

export function resolveVirtualAnimTime(rawT) {
    if (!state.activeVirtualTimeCompiled) return rawT;
    const tauSlider = state.sceneSliders.tau;
    const tau = tauSlider ? Number(tauSlider.value) : rawT;
    try {
        const mapped = evalExpr(state.activeVirtualTimeCompiled, rawT, {
            useVirtualTime: false,
            extraScope: { tau },
        });
        return Number.isFinite(mapped) ? mapped : rawT;
    } catch (_err) {
        return rawT;
    }
}

export function compileExpr(exprStr) {
    if (_JS_ONLY_RE.test(exprStr)) {
        if (state._sceneJsTrustState === 'trusted') {
            const fn = Function('scope', 'with (scope) { return (' + exprStr + '); }');
            fn._isFallback = true;
            return fn;
        }
        return _mathjs.compile('0');
    }
    try {
        return _mathjs.compile(exprStr);
    } catch (_e) {
        if (state._sceneJsTrustState === 'trusted') {
            const fn = Function('scope', 'with (scope) { return (' + exprStr + '); }');
            fn._isFallback = true;
            return fn;
        }
        return _mathjs.compile('0');
    }
}

export function evalExpr(compiled, t, opts = {}) {
    const useVirtualTime = opts.useVirtualTime !== false;
    const evalT = useVirtualTime ? resolveVirtualAnimTime(t) : t;
    const extraScope = (opts && typeof opts.extraScope === 'object' && opts.extraScope) ? opts.extraScope : null;
    const prevFrame = state._activeExprEvalFrame;
    state._activeExprEvalFrame = { t: evalT, extraScope };
    try {
        if (compiled && compiled._isFallback) {
            return compiled(_buildScope({ t: evalT, ...(extraScope || {}) }));
        }
        return compiled.evaluate(_buildScope({ t: evalT, ...(extraScope || {}) }));
    } finally {
        state._activeExprEvalFrame = prevFrame;
    }
}

export function compileSurfaceExpr(exprStr) {
    if (_JS_ONLY_RE.test(exprStr)) {
        if (state._sceneJsTrustState === 'trusted') {
            const fn = Function('scope', 'with (scope) { return (' + exprStr + '); }');
            fn._isFallback = true;
            return fn;
        }
        return _mathjs.compile('0');
    }
    try {
        return _mathjs.compile(exprStr);
    } catch (_e) {
        if (state._sceneJsTrustState === 'trusted') {
            const fn = Function('scope', 'with (scope) { return (' + exprStr + '); }');
            fn._isFallback = true;
            return fn;
        }
        return _mathjs.compile('0');
    }
}

export function evalSurfaceExpr(compiled, u, v) {
    const prevFrame = state._activeExprEvalFrame;
    state._activeExprEvalFrame = {
        t: prevFrame && Number.isFinite(prevFrame.t) ? prevFrame.t : 0,
        u,
        v,
        extraScope: prevFrame && prevFrame.extraScope ? prevFrame.extraScope : null,
    };
    try {
        if (compiled && compiled._isFallback) {
            return compiled(_buildScope({ u, v }));
        }
        return compiled.evaluate(_buildScope({ u, v }));
    } finally {
        state._activeExprEvalFrame = prevFrame;
    }
}

// Exported for recompileActiveExprs in sliders.js
export { _getMathNamesAndValues, _mathjs };
