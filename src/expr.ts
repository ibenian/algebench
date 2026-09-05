// ============================================================
// Expression sandbox — math.js setup, compile/eval, scene
// functions, virtual time, and domain library imports.
// ============================================================

import { state } from '/state.js';

/**
 * A scope handed to a compiled expression: slider values, scene functions,
 * domain functions and math helpers, keyed by identifier. Values are `unknown`
 * because math.js evaluates to numbers, strings, matrices or units depending
 * on the expression.
 */
export type ExprScope = Record<string, unknown>;

/**
 * The trusted-JS fallback: a `Function('scope', 'with (scope) …')` produced
 * when an expression needs native JS and the scene has been trusted. The
 * `_isFallback` brand is how evalExpr tells it apart from a math.js node.
 */
export interface ExprFallbackFn {
    (scope: ExprScope): unknown;
    _isFallback?: true;
}

/** A compiled math.js node (`math` is a CDN global, so borrow the type). */
type MathEvalFunction = import('mathjs').EvalFunction;

/** Either a compiled math.js node or the trusted-JS fallback. */
export type CompiledExpr = MathEvalFunction | ExprFallbackFn;

/** The evaluation frame pushed for the duration of one evalExpr call. */
interface ExprEvalFrame {
    t: number;
    u?: number;
    v?: number;
    extraScope: ExprScope | null;
}

/** A validated scene function, before and after compilation. */
interface SceneFunctionDef {
    name: string;
    args: string[];
    expr: string;
    compiled: CompiledExpr;
}

// state.js is still untyped JavaScript, so its fields infer from their
// initializers. Describe the slice this module owns rather than spreading
// `any`; the cast goes away when state.js is converted.
interface ExprState {
    sceneData: Record<string, unknown> | null;
    sceneSliders: Record<string, { value: unknown } | undefined>;
    _activeDomainFunctions: Record<string, unknown>;
    activeSceneExprFunctions: Record<string, (...args: unknown[]) => unknown>;
    activeSceneFunctionDefs: SceneFunctionDef[];
    activeVirtualTimeExpr: string | null;
    activeVirtualTimeCompiled: CompiledExpr | null;
    _activeExprEvalFrame: ExprEvalFrame | null;
    _sceneJsTrustState: string | null;
}
const exprState = state as unknown as ExprState;

// Sandboxed math.js instance — no browser API access from expressions.
// `math` is loaded as a plain <script> tag in index.html.
// `math.all` is typed optional upstream but is always present on the bundle
// the CDN serves; `!` keeps a missing one throwing rather than silently
// creating an empty instance.
const _mathjs = math.create(math.all!);

// ── Math.js extensions ────────────────────────────────────────────────────────
// Add custom helper functions HERE ONLY. They are automatically imported into
// both the math.js evaluator (_mathjs.import) and the JS fallback scope
// (_EXPR_HELPERS), so both evaluators always stay consistent.
//
// ALSO ADD THE NAME to EXTENSION_NAMES in backend/mathjs_extensions.py. That
// list is what tells the scene-building expert these functions exist — math.js's
// own library it already knows, but nothing here is inferable. A name missing
// there is a function the model never uses; a name only there is one it uses and
// that does not exist, which renders as nothing at all.
// tests/test_mathjs_extensions_sync.py fails if the two lists disagree.
const _MATHJS_EXTENSIONS = {
    toFixed: (val: unknown, decimals: unknown): string => Number(val).toFixed(Number(decimals)),
    concat: (...args: unknown[]): string => args.map((a) => String(a)).join(''),
    // bar(value, width=20) — Unicode block progress bar, e.g. bar(0.4) → "████████░░░░░░░░░░░░"
    bar: (val: unknown, w: number = 20): string => {
        const n = Math.round(Math.max(0, Math.min(1, Number(val))) * Number(w));
        return '\u2588'.repeat(n) + '\u2591'.repeat(Number(w) - n);
    },
    // dataTable(table, rowIndex, column) — look up a value from the scene's "data" tables.
    // Example: dataTable('capsules', s5_capsule, 'mass') → state.sceneData.capsules[2].mass
    dataTable: (table: unknown, rowIndex: unknown, column: unknown): unknown => {
        const t = exprState.sceneData && exprState.sceneData[String(table)];
        if (!Array.isArray(t)) return 0;
        const row = t[Math.max(0, Math.min(t.length - 1, Math.round(Number(rowIndex))))];
        if (!row) return 0;
        const val = (row as Record<string, unknown>)[String(column)];
        return val != null ? val : 0;
    },

    // ── SymPy jscode compatibility ──────────────────────────────────────
    // SymPy's jscode(strict=False) emits bare function names for functions
    // it can't map to Math.*. These aliases ensure mathjs can evaluate them.

    // binomial(n, k) — SymPy emits this; mathjs has combinations()
    binomial: (n: number, k: number): unknown => _mathjs.combinations(n, k),

    // erfc(x) — complementary error function: 1 − erf(x)
    erfc: (x: number): number => 1 - (_mathjs.erf(x) as number),

    // beta(a, b) — Euler beta function: Γ(a)Γ(b) / Γ(a+b)
    beta: (a: number, b: number): number =>
        (_mathjs.gamma(a) as number) * (_mathjs.gamma(b) as number) / (_mathjs.gamma(a + b) as number),

    // conjugate(x) — SymPy emits this; mathjs has conj()
    conjugate: (x: number): unknown => _mathjs.conj(x),
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
// \[\s*['"`] catches bracket-notation property access (e.g. obj['constructor']).
export const _JS_ONLY_RE = /\blet\b|\bconst\b|\bvar\b|\breturn\b|\bfor\s*\(|\bwhile\s*\(|=>|\bfunction\b|\bMath\.|\.([a-zA-Z_]\w*)\s*\(|\bnew\b|\bthis\b|\btypeof\b|\binstanceof\b|\bdelete\b|\bclass\b|\basync\b|\bawait\b|\byield\b|\bthrow\b|\btry\b|\bcatch\b|\bimport\b|\bdebugger\b|\bif\b|\belse\b|\bswitch\b|\bcase\b|\bdo\b|\bbreak\b|\bcontinue\b|\bwith\s*\(|\bvoid\b|\[\s*['"`]/;

// Populated from _MATHJS_EXTENSIONS — do not add helpers here directly.
const _EXPR_HELPERS: Record<string, unknown> = { ..._MATHJS_EXTENSIONS };

// Exported so overlay.js can recognise extension names as known identifiers.
export const EXTENSION_NAMES = Object.keys(_MATHJS_EXTENSIONS);

const _CORE_MATH_NAMES = ['sin','cos','tan','asin','acos','atan','atan2','sinh','cosh','tanh',
    'asinh','acosh','atanh',
    'abs','sqrt','cbrt','pow','exp','log','log2','log10','floor','ceil','round','trunc',
    'min','max','sign','hypot','PI','E'];

const _MATH_SCOPE: ExprScope = Object.fromEntries(
    _CORE_MATH_NAMES.map((n) => [
        n,
        Object.prototype.hasOwnProperty.call(_EXPR_HELPERS, n) ? _EXPR_HELPERS[n] : Math[n as keyof Math],
    ]),
);

function _normalizeSingleQuotes(str: string): string {
    return str.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match: string, content: string) =>
        JSON.stringify(content.replace(/\\'/g, "'"))
    );
}

const _SCENE_FN_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function _isValidSceneFunctionName(name: unknown): name is string {
    return typeof name === 'string' && _SCENE_FN_NAME_RE.test(name);
}

function _getMathNamesAndValues(): { names: string[]; vals: unknown[] } {
    const names = _CORE_MATH_NAMES.slice();
    const vals: unknown[] = names.map((n) =>
        Object.prototype.hasOwnProperty.call(_EXPR_HELPERS, n) ? _EXPR_HELPERS[n] : Math[n as keyof Math],
    );
    for (const src of [exprState._activeDomainFunctions, exprState.activeSceneExprFunctions]) {
        for (const [name, fn] of Object.entries(src || {})) {
            if (typeof fn !== 'function') continue;
            if (names.includes(name)) continue;
            names.push(name);
            vals.push(fn);
        }
    }
    return { names, vals };
}

function _buildScope(extras?: ExprScope | null, overrides?: ExprScope | null): ExprScope {
    const scope: ExprScope = {
        ..._MATH_SCOPE, ..._EXPR_HELPERS,
        ...exprState._activeDomainFunctions,
        ...(exprState.activeSceneExprFunctions || {}),
        ...extras,
    };
    for (const [id, s] of Object.entries(exprState.sceneSliders)) scope[id] = s ? s.value : 0;
    // ``overrides`` beat the scene sliders. Needed whenever the caller owns
    // the binding outright — e.g. a Function Analysis chart sweeping ``R``
    // over its own range in a scene that also has a slider named ``R`` (11
    // scenes do). ``extras`` deliberately still lose to sliders, preserving
    // the long-standing behaviour of scenes with a ``t`` slider.
    return overrides ? { ...scope, ...overrides } : scope;
}

function _loadDomainScript(name: string): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `/domains/${name}/index.js`;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load domain: ${name}`));
        document.head.appendChild(script);
    });
}

export async function importDomains(importList: unknown): Promise<void> {
    exprState._activeDomainFunctions = {};
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
                    getSlider(id: string, fallback: number = 0): number {
                        const s = exprState.sceneSliders[id];
                        if (!s) return fallback;
                        const v = Number(s.value);
                        return Number.isFinite(v) ? v : fallback;
                    },
                });
            }
            const { _init, ...publicFns } = fns;
            Object.assign(exprState._activeDomainFunctions, publicFns);
        }
    }
}

export function setActiveSceneFunctions(scene: { functions?: unknown } | null | undefined): void {
    exprState.activeSceneExprFunctions = {};
    exprState.activeSceneFunctionDefs = [];
    const defs: unknown[] = scene && Array.isArray(scene.functions) ? scene.functions : [];
    if (!defs.length) return;

    const used = new Set<string>();
    const normalized: Omit<SceneFunctionDef, 'compiled'>[] = [];
    for (const rawEntry of defs) {
        if (!rawEntry || typeof rawEntry !== 'object') continue;
        // Scene JSON is author-supplied, so every field is validated below
        // exactly as before; the cast only opens the object for reading.
        const raw = rawEntry as Record<string, unknown>;
        const name = typeof raw.name === 'string' ? raw.name : raw.id;
        if (!_isValidSceneFunctionName(name)) {
            console.warn('scene.functions entry skipped (invalid name):', raw);
            continue;
        }
        if (_CORE_MATH_NAMES.includes(name) || Object.prototype.hasOwnProperty.call(_EXPR_HELPERS, name)
                || Object.prototype.hasOwnProperty.call(exprState._activeDomainFunctions, name)) {
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
        const argsRaw: unknown[] = Array.isArray(raw.args) ? raw.args : [];
        const args: string[] = [];
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
        exprState.activeSceneExprFunctions[def.name] = () => 0;
    }

    for (const def of normalized) {
        let compiled: CompiledExpr;
        try {
            compiled = compileExpr(def.expr);
        } catch (err) {
            console.warn('scene.functions compile error:', def.name, err);
            compiled = _mathjs.compile('0');
        }
        exprState.activeSceneFunctionDefs.push({ ...def, compiled });
    }

    for (const def of exprState.activeSceneFunctionDefs) {
        exprState.activeSceneExprFunctions[def.name] = (...callArgs: unknown[]) => {
            const frame = exprState._activeExprEvalFrame || null;
            const scope: ExprScope = frame && frame.extraScope && typeof frame.extraScope === 'object'
                ? { ...frame.extraScope } : {};
            for (let i = 0; i < def.args.length; i++) {
                scope[def.args[i]!] = i < callArgs.length ? callArgs[i] : 0;
            }
            if (frame && Number.isFinite(frame.t)) scope.t = frame.t;
            if (frame && Number.isFinite(frame.u)) scope.u = frame.u;
            if (frame && Number.isFinite(frame.v)) scope.v = frame.v;
            const tEval = (frame && Number.isFinite(frame.t)) ? frame.t : 0;
            return evalExpr(def.compiled, tEval, { useVirtualTime: false, extraScope: scope });
        };
    }
}

export function recompileActiveSceneFunctions(): void {
    if (!Array.isArray(exprState.activeSceneFunctionDefs) || !exprState.activeSceneFunctionDefs.length) return;
    for (const def of exprState.activeSceneFunctionDefs) {
        try {
            def.compiled = compileExpr(def.expr);
        } catch (err) {
            console.warn('scene.functions recompile error:', def.name, err);
            def.compiled = _mathjs.compile('0');
        }
    }
}

function _normalizeVirtualTimeExpr(spec: unknown): string | null {
    if (typeof spec === 'string') return spec;
    const o = spec as { options?: { expr?: unknown; scale?: unknown }; expr?: unknown } | null;
    if (o && o.options) {
        if (typeof o.options.expr === 'string') return o.options.expr;
        if (typeof o.options.scale === 'number') return `${Number(o.options.scale)}*t`;
    }
    if (o && typeof o.expr === 'string') return o.expr;
    return null;
}

export function setActiveVirtualTimeExpr(
    scene: { virtualTime?: unknown; steps?: unknown } | null | undefined,
    stepIdx: number,
): void {
    const sceneExpr = _normalizeVirtualTimeExpr(scene && scene.virtualTime);
    let stepExpr: string | null = null;
    if (scene && Array.isArray(scene.steps) && stepIdx >= 0 && scene.steps[stepIdx]) {
        stepExpr = _normalizeVirtualTimeExpr((scene.steps[stepIdx] as { virtualTime?: unknown }).virtualTime);
    }
    exprState.activeVirtualTimeExpr = stepExpr || sceneExpr || null;
    if (!exprState.activeVirtualTimeExpr) {
        exprState.activeVirtualTimeCompiled = null;
        return;
    }
    try {
        exprState.activeVirtualTimeCompiled = compileExpr(exprState.activeVirtualTimeExpr);
    } catch (err) {
        console.warn('virtualTime compile error:', err);
        exprState.activeVirtualTimeCompiled = null;
    }
}

export function resolveVirtualAnimTime(rawT: number): number {
    if (!exprState.activeVirtualTimeCompiled) return rawT;
    const tauSlider = exprState.sceneSliders.tau;
    const tau = tauSlider ? Number(tauSlider.value) : rawT;
    try {
        const mapped = evalExpr(exprState.activeVirtualTimeCompiled, rawT, {
            useVirtualTime: false,
            extraScope: { tau },
        });
        return Number.isFinite(mapped) ? (mapped as number) : rawT;
    } catch (_err) {
        return rawT;
    }
}

/**
 * Why `compileExpr` would hand back the constant 0 for this string instead of
 * a real expression, or null if it would not. Mirrors compileExpr's own
 * decisions exactly -- same quote normalisation, same JS-only gate, same
 * parse -- so a caller that must NOT accept a silent zero (a channel where 0
 * has a meaning, like a cell's width) can refuse the expression up front and
 * say why, rather than discover it as a collapsed lattice.
 */
export function explainCompileDegrade(exprStr: string): string | null {
    if (exprState._sceneJsTrustState === 'trusted') return null;
    const src = _normalizeSingleQuotes(exprStr);
    if (_JS_ONLY_RE.test(src)) {
        return 'uses JavaScript-only syntax, which an untrusted scene compiles to 0';
    }
    try {
        _mathjs.parse(src);
        return null;
    } catch (e) {
        return `does not parse as math.js (${(e as Error).message}), which an untrusted scene compiles to 0`;
    }
}

export function compileExpr(exprStr: string): CompiledExpr {
    // Normalise single-quoted strings to double-quoted so math.js can parse them
    // without falling through to the JS fallback (which requires scene trust).
    exprStr = _normalizeSingleQuotes(exprStr);
    if (_JS_ONLY_RE.test(exprStr)) {
        if (exprState._sceneJsTrustState === 'trusted') {
            const fn: ExprFallbackFn = Function('scope', 'with (scope) { return (' + exprStr + '); }') as ExprFallbackFn;
            fn._isFallback = true;
            return fn;
        }
        return _mathjs.compile('0');
    }
    try {
        return _mathjs.compile(exprStr);
    } catch (_e) {
        if (exprState._sceneJsTrustState === 'trusted') {
            const fn: ExprFallbackFn = Function('scope', 'with (scope) { return (' + exprStr + '); }') as ExprFallbackFn;
            fn._isFallback = true;
            return fn;
        }
        return _mathjs.compile('0');
    }
}

export function evalExpr(
    compiled: CompiledExpr,
    t: number,
    opts: { useVirtualTime?: boolean; extraScope?: ExprScope | null; overrideScope?: ExprScope | null } = {},
): unknown {
    const useVirtualTime = opts.useVirtualTime !== false;
    const evalT = useVirtualTime ? resolveVirtualAnimTime(t) : t;
    const extraScope = (opts && typeof opts.extraScope === 'object' && opts.extraScope) ? opts.extraScope : null;
    // Bindings the caller owns outright — these beat scene sliders of the
    // same name (see _buildScope).
    const overrideScope = (opts && typeof opts.overrideScope === 'object' && opts.overrideScope)
        ? opts.overrideScope : null;
    const prevFrame = exprState._activeExprEvalFrame;
    exprState._activeExprEvalFrame = { t: evalT, extraScope };
    try {
        // The `_isFallback` brand is the discriminator between the two compiled
        // forms; math.js nodes expose `.evaluate` instead.
        if (compiled && (compiled as ExprFallbackFn)._isFallback) {
            return (compiled as ExprFallbackFn)(_buildScope({ t: evalT, ...(extraScope || {}) }, overrideScope));
        }
        return (compiled as MathEvalFunction).evaluate(
            _buildScope({ t: evalT, ...(extraScope || {}) }, overrideScope),
        );
    } finally {
        exprState._activeExprEvalFrame = prevFrame;
    }
}

export function compileSurfaceExpr(exprStr: string): CompiledExpr {
    exprStr = _normalizeSingleQuotes(exprStr);
    if (_JS_ONLY_RE.test(exprStr)) {
        if (exprState._sceneJsTrustState === 'trusted') {
            const fn: ExprFallbackFn = Function('scope', 'with (scope) { return (' + exprStr + '); }') as ExprFallbackFn;
            fn._isFallback = true;
            return fn;
        }
        return _mathjs.compile('0');
    }
    try {
        return _mathjs.compile(exprStr);
    } catch (_e) {
        if (exprState._sceneJsTrustState === 'trusted') {
            const fn: ExprFallbackFn = Function('scope', 'with (scope) { return (' + exprStr + '); }') as ExprFallbackFn;
            fn._isFallback = true;
            return fn;
        }
        return _mathjs.compile('0');
    }
}

export function evalSurfaceExpr(compiled: CompiledExpr, u: number, v: number): unknown {
    const prevFrame = exprState._activeExprEvalFrame;
    exprState._activeExprEvalFrame = {
        t: prevFrame && Number.isFinite(prevFrame.t) ? prevFrame.t : 0,
        u,
        v,
        extraScope: prevFrame && prevFrame.extraScope ? prevFrame.extraScope : null,
    };
    try {
        if (compiled && (compiled as ExprFallbackFn)._isFallback) {
            return (compiled as ExprFallbackFn)(_buildScope({ u, v }));
        }
        return (compiled as MathEvalFunction).evaluate(_buildScope({ u, v }));
    } finally {
        exprState._activeExprEvalFrame = prevFrame;
    }
}

// Exported for recompileActiveExprs in sliders.js
export { _getMathNamesAndValues, _mathjs };
