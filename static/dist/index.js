import { C as USER_ICON, S as TRASH_ICON, _ as NEXT_ICON, a as wireThemeToggle, b as PREV_ICON, c as AI_ICON, f as FIRST_ICON, g as LAST_ICON, h as GEAR_ICON, l as ANGLE_LOCK_ICON, m as FUNCTION_ANALYSIS_ICON, n as applyTheme, o as validateProofData, r as initialTheme, s as ProofAnimator, u as BRACES_ICON, v as PAUSE_ICON, x as SHARE_VIEW_ICON, y as PLAY_ICON } from "./theme.js";
import { n as ExpertError, r as invokeExpert, t as DERIVE_TIMEOUT_MS } from "./expert-client.js";
//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region src/state.ts
var state = {
	mathbox: null,
	three: null,
	camera: null,
	controls: null,
	renderer: null,
	currentSpec: null,
	labels: [],
	animationFrameId: null,
	cameraAnimating: false,
	currentProjection: "perspective",
	perspCamera: null,
	arrowMeshes: [],
	axisLineNodes: [],
	vectorLineNodes: [],
	lineNodes: [],
	planeMeshes: [],
	pointNodes: [],
	worldStarfield: null,
	worldSkybox: null,
	_planeMeshSerial: 0,
	currentRange: [
		[-5, 5],
		[-5, 5],
		[-5, 5]
	],
	currentScale: [
		1,
		1,
		1
	],
	declaredScale: [
		1,
		1,
		1
	],
	sceneView: null,
	mainDirLight: null,
	lessonSpec: null,
	currentSceneIndex: -1,
	currentStepIndex: -1,
	autoPlayTimer: null,
	visitedSteps: /* @__PURE__ */ new Set(),
	stepTrackers: [],
	elementRegistry: {},
	sceneSliders: {},
	sceneUp: [
		0,
		1,
		0
	],
	rollDrag: null,
	arcballMomentum: .5,
	arcballInertiaId: null,
	arcballInertiaQ: null,
	arcballLastMoveTime: 0,
	followCamState: null,
	followCamStartTime: 0,
	followCamAngleLock: false,
	followCamSavedControls: null,
	cameraExprState: null,
	cameraExprStartTime: 0,
	CAMERA_VIEWS: {},
	camPopupPinned: false,
	animatedElementPos: {},
	activeAnimUpdaters: [],
	sceneStartTime: 0,
	activeAnimExprs: [],
	activeVirtualTimeExpr: null,
	activeVirtualTimeCompiled: null,
	activeSceneExprFunctions: {},
	activeSceneFunctionDefs: [],
	_activeDomainFunctions: {},
	_activeExprEvalFrame: null,
	_sceneJsTrustState: null,
	_sceneJsIssues: [],
	_sceneIsUnsafe: false,
	_sceneUnsafeExplanation: "",
	videoRecorder: null,
	videoRecordedChunks: [],
	videoRecordingStream: null,
	videoRecordingExt: "webm",
	videoRecordingMime: "video/webm",
	videoExportFormatPreference: "auto",
	displayParams: {
		labelScale: 1,
		arrowScale: 1,
		axisWidth: 1,
		vectorWidth: 1,
		labelOpacity: 1,
		arrowOpacity: 1,
		axisOpacity: 1,
		vectorOpacity: 1,
		lineWidth: 1,
		lineOpacity: 1,
		planeScale: 1,
		planeOpacity: .2,
		captionScale: 1,
		overlayOpacity: 1,
		labelDeclutterMode: "shade",
		labelDeclutterGap: 4,
		labelDeclutterMaxStack: 5,
		labelDeclutterAlpha: .25,
		labelDimBase: .7,
		labelDimFloor: .4,
		labelDimDepthScale: .5,
		labelDimAlpha: .2,
		labelDimHideThreshold: 4,
		labelDimHideLevel: .1
	},
	legendToggledOff: /* @__PURE__ */ new Set(),
	currentSceneSourceLabel: "",
	currentSceneSourcePath: "",
	proofSpec: null,
	proofAllSpecs: null,
	proofActiveIndex: 0,
	proofStepIndex: -1,
	proofStepMemory: {},
	proofViewMode: "slide",
	proofSyncEnabled: true,
	proofExpanded: false,
	_proofSyncInProgress: false,
	_graphSyncInProgress: false,
	_proofTabMode: "context",
	_proofPreRendered: null,
	_proofPreRenderedAll: {},
	sceneData: {},
	_sliderDrag: {
		active: false,
		startX: 0,
		startY: 0,
		startLeft: 0,
		startBottom: 0
	}
};
//#endregion
//#region src/coords.ts
var range = () => state.currentRange;
var scale = () => state.currentScale;
var declaredScale = () => state.declaredScale;
/**
* The `scale` a range implies when the scene does not choose one.
*
* `dataToWorld` normalises each axis by its OWN range onto [-1, 1] and then
* multiplies by `scale[i]`, so `scale` IS the world half-extent of that axis.
* A constant `[1, 1, 1]` therefore gives every axis the same world size however
* many data units it spans — and a vector `(0,0,0) -> (5,1,0)` in a `[6, 2, 2]`
* range is drawn at about 45° instead of 11°. Its direction is the one thing a
* vector is for.
*
* Widths normalised by the LONGEST axis make one data unit the same distance
* everywhere, so a circle is round, a right angle is square and a slope is the
* slope it says — while keeping world coordinates in [-1, 1] as before. Raw
* widths would not: a 2200-unit range would put the scene at ±2200 in world
* space, which the camera transform and `getAbstractWidthScale` do not expect.
*
* This is the corpus's own isotropic convention where it chooses one — Cislunar
* Scale has widths [1, 0.48, 0.16] and scale [1, 0.48, 0.16].
*
* A scene that WANTS anisotropy still says so: an explicit `scale` always wins.
* That is a real editorial choice — a sine of amplitude 1 plotted over x ∈ [0,12]
* is a nearly flat line rendered isotropically, so a graph legitimately stretches
* its y axis to fill the frame.
*/
/**
* Is this the legacy default rather than a decision?
*
* 37 of the 41 published scenes that "declare" a scale declare exactly
* [1, 1, 1] — the pre-isotropy default written out — and 27 of those are
* visibly distorted by it, including a unit circle drawn 2.8x taller than wide.
* The 4 scenes that declare a genuinely different scale (artemis-ii, e.g.
* [25, 12, 4] against widths [50, 24, 8]) are ALREADY isotropic at 1 world unit
* per data unit. So nothing in the corpus wants the stretch, and a literal
* [1, 1, 1] is far more likely to mean "never thought about it".
*
* Reading it as unspecified costs nothing elsewhere: the camera keeps its own
* `declaredScale`, which is [1, 1, 1] for exactly these scenes either way.
*/
function isDefaultScale(scale) {
	return Array.isArray(scale) && scale.length === 3 && scale.every((v) => Number(v) === 1);
}
function isotropicScale(range) {
	const fallback = [
		1,
		1,
		1
	];
	if (!Array.isArray(range) || range.length !== 3) return fallback;
	const widths = range.map((pair) => {
		if (!Array.isArray(pair) || pair.length !== 2) return NaN;
		return Number(pair[1]) - Number(pair[0]);
	});
	if (!widths.every((w) => Number.isFinite(w) && w > 0)) return fallback;
	const longest = Math.max(...widths);
	return widths.map((w) => w / longest);
}
function dataToWorld(pos) {
	const r = range();
	const s = scale();
	const [rx, ry, rz] = r ?? [];
	if (!rx || !ry || !rz) return [
		0,
		0,
		0
	];
	return [
		((pos[0] - rx[0]) / (rx[1] - rx[0]) * 2 - 1) * s[0],
		((pos[1] - ry[0]) / (ry[1] - ry[0]) * 2 - 1) * s[1],
		((pos[2] - rz[0]) / (rz[1] - rz[0]) * 2 - 1) * s[2]
	];
}
function dataCameraToWorld$1(pos) {
	const r = range();
	const s = declaredScale();
	const [rx, ry, rz] = r ?? [];
	if (!rx || !ry || !rz) return [
		0,
		0,
		0
	];
	const hx = (rx[1] - rx[0]) / 2;
	const hy = (ry[1] - ry[0]) / 2;
	const hz = (rz[1] - rz[0]) / 2;
	const maxH = Math.max(hx, hy, hz, .001);
	const cx = (rx[0] + rx[1]) / 2;
	const cy = (ry[0] + ry[1]) / 2;
	const cz = (rz[0] + rz[1]) / 2;
	return [
		(pos[0] - cx) / maxH * s[0],
		(pos[1] - cy) / maxH * s[1],
		(pos[2] - cz) / maxH * s[2]
	];
}
function worldCameraToData$1(pos) {
	const r = range();
	const s = declaredScale();
	const [rx, ry, rz] = r ?? [];
	if (!rx || !ry || !rz) return [
		0,
		0,
		0
	];
	const hx = (rx[1] - rx[0]) / 2;
	const hy = (ry[1] - ry[0]) / 2;
	const hz = (rz[1] - rz[0]) / 2;
	const maxH = Math.max(hx, hy, hz, .001);
	const cx = (rx[0] + rx[1]) / 2;
	const cy = (ry[0] + ry[1]) / 2;
	const cz = (rz[0] + rz[1]) / 2;
	return [
		pos[0] * maxH / s[0] + cx,
		pos[1] * maxH / s[1] + cy,
		pos[2] * maxH / s[2] + cz
	];
}
function dataLenToWorld(len) {
	const r = range();
	const s = scale();
	const sx = 2 * s[0] / (r[0][1] - r[0][0]);
	const sy = 2 * s[1] / (r[1][1] - r[1][0]);
	const sz = 2 * s[2] / (r[2][1] - r[2][0]);
	return len * (sx + sy + sz) / 3;
}
//#endregion
//#region src/expr.ts
var exprState = state;
var _mathjs = math.create(math.all);
var _MATHJS_EXTENSIONS = {
	toFixed: (val, decimals) => Number(val).toFixed(Number(decimals)),
	concat: (...args) => args.map((a) => String(a)).join(""),
	bar: (val, w = 20) => {
		const n = Math.round(Math.max(0, Math.min(1, Number(val))) * Number(w));
		return "█".repeat(n) + "░".repeat(Number(w) - n);
	},
	dataTable: (table, rowIndex, column) => {
		const t = exprState.sceneData && exprState.sceneData[String(table)];
		if (!Array.isArray(t)) return 0;
		const row = t[Math.max(0, Math.min(t.length - 1, Math.round(Number(rowIndex))))];
		if (!row) return 0;
		const val = row[String(column)];
		return val != null ? val : 0;
	},
	binomial: (n, k) => _mathjs.combinations(n, k),
	erfc: (x) => 1 - _mathjs.erf(x),
	beta: (a, b) => _mathjs.gamma(a) * _mathjs.gamma(b) / _mathjs.gamma(a + b),
	conjugate: (x) => _mathjs.conj(x)
};
_mathjs.import({
	..._MATHJS_EXTENSIONS,
	import: function() {
		throw new Error("import disabled");
	},
	createUnit: function() {
		throw new Error("createUnit disabled");
	}
}, { override: true });
var _JS_ONLY_RE = /\blet\b|\bconst\b|\bvar\b|\breturn\b|\bfor\s*\(|\bwhile\s*\(|=>|\bfunction\b|\bMath\.|\.([a-zA-Z_]\w*)\s*\(|\bnew\b|\bthis\b|\btypeof\b|\binstanceof\b|\bdelete\b|\bclass\b|\basync\b|\bawait\b|\byield\b|\bthrow\b|\btry\b|\bcatch\b|\bimport\b|\bdebugger\b|\bif\b|\belse\b|\bswitch\b|\bcase\b|\bdo\b|\bbreak\b|\bcontinue\b|\bwith\s*\(|\bvoid\b|\[\s*['"`]/;
var _EXPR_HELPERS = { ..._MATHJS_EXTENSIONS };
var EXTENSION_NAMES = Object.keys(_MATHJS_EXTENSIONS);
var _CORE_MATH_NAMES = [
	"sin",
	"cos",
	"tan",
	"asin",
	"acos",
	"atan",
	"atan2",
	"sinh",
	"cosh",
	"tanh",
	"asinh",
	"acosh",
	"atanh",
	"abs",
	"sqrt",
	"cbrt",
	"pow",
	"exp",
	"log",
	"log2",
	"log10",
	"floor",
	"ceil",
	"round",
	"trunc",
	"min",
	"max",
	"sign",
	"hypot",
	"PI",
	"E"
];
var _MATH_SCOPE = Object.fromEntries(_CORE_MATH_NAMES.map((n) => [n, Object.prototype.hasOwnProperty.call(_EXPR_HELPERS, n) ? _EXPR_HELPERS[n] : Math[n]]));
function _normalizeSingleQuotes(str) {
	return str.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, content) => JSON.stringify(content.replace(/\\'/g, "'")));
}
var _SCENE_FN_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function _isValidSceneFunctionName(name) {
	return typeof name === "string" && _SCENE_FN_NAME_RE.test(name);
}
function _getMathNamesAndValues() {
	const names = _CORE_MATH_NAMES.slice();
	const vals = names.map((n) => Object.prototype.hasOwnProperty.call(_EXPR_HELPERS, n) ? _EXPR_HELPERS[n] : Math[n]);
	for (const src of [exprState._activeDomainFunctions, exprState.activeSceneExprFunctions]) for (const [name, fn] of Object.entries(src || {})) {
		if (typeof fn !== "function") continue;
		if (names.includes(name)) continue;
		names.push(name);
		vals.push(fn);
	}
	return {
		names,
		vals
	};
}
function _buildScope(extras, overrides) {
	const scope = {
		..._MATH_SCOPE,
		..._EXPR_HELPERS,
		...exprState._activeDomainFunctions,
		...exprState.activeSceneExprFunctions || {},
		...extras
	};
	for (const [id, s] of Object.entries(exprState.sceneSliders)) scope[id] = s ? s.value : 0;
	return overrides ? {
		...scope,
		...overrides
	} : scope;
}
function _loadDomainScript(name) {
	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = `/domains/${name}/index.js`;
		script.onload = resolve;
		script.onerror = () => reject(/* @__PURE__ */ new Error(`Failed to load domain: ${name}`));
		document.head.appendChild(script);
	});
}
async function importDomains(importList) {
	exprState._activeDomainFunctions = {};
	if (!Array.isArray(importList) || importList.length === 0) return;
	for (const name of importList) {
		if (typeof name !== "string") continue;
		if (!window.AlgeBenchDomains._registry[name]) try {
			await _loadDomainScript(name);
		} catch (err) {
			console.warn(`[domains] could not load domain "${name}":`, err);
			continue;
		}
		const fns = window.AlgeBenchDomains._registry[name];
		if (fns) {
			if (typeof fns._init === "function") fns._init({ getSlider(id, fallback = 0) {
				const s = exprState.sceneSliders[id];
				if (!s) return fallback;
				const v = Number(s.value);
				return Number.isFinite(v) ? v : fallback;
			} });
			const { _init, ...publicFns } = fns;
			Object.assign(exprState._activeDomainFunctions, publicFns);
		}
	}
}
function setActiveSceneFunctions(scene) {
	exprState.activeSceneExprFunctions = {};
	exprState.activeSceneFunctionDefs = [];
	const defs = scene && Array.isArray(scene.functions) ? scene.functions : [];
	if (!defs.length) return;
	const used = /* @__PURE__ */ new Set();
	const normalized = [];
	for (const rawEntry of defs) {
		if (!rawEntry || typeof rawEntry !== "object") continue;
		const raw = rawEntry;
		const name = typeof raw.name === "string" ? raw.name : raw.id;
		if (!_isValidSceneFunctionName(name)) {
			console.warn("scene.functions entry skipped (invalid name):", raw);
			continue;
		}
		if (_CORE_MATH_NAMES.includes(name) || Object.prototype.hasOwnProperty.call(_EXPR_HELPERS, name) || Object.prototype.hasOwnProperty.call(exprState._activeDomainFunctions, name)) {
			console.warn("scene.functions entry skipped (reserved name):", name);
			continue;
		}
		if (used.has(name)) {
			console.warn("scene.functions entry skipped (duplicate name):", name);
			continue;
		}
		const expr = typeof raw.expr === "string" ? raw.expr : raw.expression;
		if (typeof expr !== "string" || !expr.trim()) {
			console.warn("scene.functions entry skipped (missing expr):", name);
			continue;
		}
		const argsRaw = Array.isArray(raw.args) ? raw.args : [];
		const args = [];
		let badArgs = false;
		for (const a of argsRaw) {
			if (!_isValidSceneFunctionName(a)) {
				badArgs = true;
				break;
			}
			if (args.includes(a)) {
				badArgs = true;
				break;
			}
			args.push(a);
		}
		if (badArgs) {
			console.warn("scene.functions entry skipped (invalid args):", name);
			continue;
		}
		normalized.push({
			name,
			args,
			expr
		});
		used.add(name);
	}
	for (const def of normalized) exprState.activeSceneExprFunctions[def.name] = () => 0;
	for (const def of normalized) {
		let compiled;
		try {
			compiled = compileExpr(def.expr);
		} catch (err) {
			console.warn("scene.functions compile error:", def.name, err);
			compiled = _mathjs.compile("0");
		}
		exprState.activeSceneFunctionDefs.push({
			...def,
			compiled
		});
	}
	for (const def of exprState.activeSceneFunctionDefs) exprState.activeSceneExprFunctions[def.name] = (...callArgs) => {
		const frame = exprState._activeExprEvalFrame || null;
		const scope = frame && frame.extraScope && typeof frame.extraScope === "object" ? { ...frame.extraScope } : {};
		for (let i = 0; i < def.args.length; i++) scope[def.args[i]] = i < callArgs.length ? callArgs[i] : 0;
		if (frame && Number.isFinite(frame.t)) scope.t = frame.t;
		if (frame && Number.isFinite(frame.u)) scope.u = frame.u;
		if (frame && Number.isFinite(frame.v)) scope.v = frame.v;
		const tEval = frame && Number.isFinite(frame.t) ? frame.t : 0;
		return evalExpr(def.compiled, tEval, {
			useVirtualTime: false,
			extraScope: scope
		});
	};
}
function recompileActiveSceneFunctions() {
	if (!Array.isArray(exprState.activeSceneFunctionDefs) || !exprState.activeSceneFunctionDefs.length) return;
	for (const def of exprState.activeSceneFunctionDefs) try {
		def.compiled = compileExpr(def.expr);
	} catch (err) {
		console.warn("scene.functions recompile error:", def.name, err);
		def.compiled = _mathjs.compile("0");
	}
}
function _normalizeVirtualTimeExpr(spec) {
	if (typeof spec === "string") return spec;
	const o = spec;
	if (o && o.options) {
		if (typeof o.options.expr === "string") return o.options.expr;
		if (typeof o.options.scale === "number") return `${Number(o.options.scale)}*t`;
	}
	if (o && typeof o.expr === "string") return o.expr;
	return null;
}
function setActiveVirtualTimeExpr(scene, stepIdx) {
	const sceneExpr = _normalizeVirtualTimeExpr(scene && scene.virtualTime);
	let stepExpr = null;
	if (scene && Array.isArray(scene.steps) && stepIdx >= 0 && scene.steps[stepIdx]) stepExpr = _normalizeVirtualTimeExpr(scene.steps[stepIdx].virtualTime);
	exprState.activeVirtualTimeExpr = stepExpr || sceneExpr || null;
	if (!exprState.activeVirtualTimeExpr) {
		exprState.activeVirtualTimeCompiled = null;
		return;
	}
	try {
		exprState.activeVirtualTimeCompiled = compileExpr(exprState.activeVirtualTimeExpr);
	} catch (err) {
		console.warn("virtualTime compile error:", err);
		exprState.activeVirtualTimeCompiled = null;
	}
}
function resolveVirtualAnimTime(rawT) {
	if (!exprState.activeVirtualTimeCompiled) return rawT;
	const tauSlider = exprState.sceneSliders.tau;
	const tau = tauSlider ? Number(tauSlider.value) : rawT;
	try {
		const mapped = evalExpr(exprState.activeVirtualTimeCompiled, rawT, {
			useVirtualTime: false,
			extraScope: { tau }
		});
		return Number.isFinite(mapped) ? mapped : rawT;
	} catch (_err) {
		return rawT;
	}
}
function compileExpr(exprStr) {
	exprStr = _normalizeSingleQuotes(exprStr);
	if (_JS_ONLY_RE.test(exprStr)) {
		if (exprState._sceneJsTrustState === "trusted") {
			const fn = Function("scope", "with (scope) { return (" + exprStr + "); }");
			fn._isFallback = true;
			return fn;
		}
		return _mathjs.compile("0");
	}
	try {
		return _mathjs.compile(exprStr);
	} catch (_e) {
		if (exprState._sceneJsTrustState === "trusted") {
			const fn = Function("scope", "with (scope) { return (" + exprStr + "); }");
			fn._isFallback = true;
			return fn;
		}
		return _mathjs.compile("0");
	}
}
function evalExpr(compiled, t, opts = {}) {
	const evalT = opts.useVirtualTime !== false ? resolveVirtualAnimTime(t) : t;
	const extraScope = opts && typeof opts.extraScope === "object" && opts.extraScope ? opts.extraScope : null;
	const overrideScope = opts && typeof opts.overrideScope === "object" && opts.overrideScope ? opts.overrideScope : null;
	const prevFrame = exprState._activeExprEvalFrame;
	exprState._activeExprEvalFrame = {
		t: evalT,
		extraScope
	};
	try {
		if (compiled && compiled._isFallback) return compiled(_buildScope({
			t: evalT,
			...extraScope || {}
		}, overrideScope));
		return compiled.evaluate(_buildScope({
			t: evalT,
			...extraScope || {}
		}, overrideScope));
	} finally {
		exprState._activeExprEvalFrame = prevFrame;
	}
}
function compileSurfaceExpr(exprStr) {
	exprStr = _normalizeSingleQuotes(exprStr);
	if (_JS_ONLY_RE.test(exprStr)) {
		if (exprState._sceneJsTrustState === "trusted") {
			const fn = Function("scope", "with (scope) { return (" + exprStr + "); }");
			fn._isFallback = true;
			return fn;
		}
		return _mathjs.compile("0");
	}
	try {
		return _mathjs.compile(exprStr);
	} catch (_e) {
		if (exprState._sceneJsTrustState === "trusted") {
			const fn = Function("scope", "with (scope) { return (" + exprStr + "); }");
			fn._isFallback = true;
			return fn;
		}
		return _mathjs.compile("0");
	}
}
function evalSurfaceExpr(compiled, u, v) {
	const prevFrame = exprState._activeExprEvalFrame;
	exprState._activeExprEvalFrame = {
		t: prevFrame && Number.isFinite(prevFrame.t) ? prevFrame.t : 0,
		u,
		v,
		extraScope: prevFrame && prevFrame.extraScope ? prevFrame.extraScope : null
	};
	try {
		if (compiled && compiled._isFallback) return compiled(_buildScope({
			u,
			v
		}));
		return compiled.evaluate(_buildScope({
			u,
			v
		}));
	} finally {
		exprState._activeExprEvalFrame = prevFrame;
	}
}
//#endregion
//#region src/follow-cam.ts
var followState = state;
function findElementSpecById(id) {
	if (!followState.currentSpec) return null;
	for (const el of followState.currentSpec.elements || []) if (el.id === id) return el;
	for (const step of followState.currentSpec.steps || []) for (const el of step.add || []) if (el.id === id) return el;
	for (const scene of followState.lessonSpec && followState.lessonSpec.scenes || []) {
		for (const el of scene.elements || []) if (el.id === id) return el;
		for (const step of scene.steps || []) for (const el of step.add || []) if (el.id === id) return el;
	}
	return null;
}
function _normalizeExprTriplet(triplet) {
	if (!Array.isArray(triplet) || triplet.length !== 3) return null;
	return triplet.map((v) => typeof v === "number" ? String(v) : v);
}
function _getElementPosExprTriplet(el) {
	if (!el) return null;
	return _normalizeExprTriplet(el.expr || el.toExpr || el.centerExpr) || (Array.isArray(el.center) && el.center.length === 3 ? _normalizeExprTriplet(el.center) : null) || (Array.isArray(el.points) && el.points.length > 0 ? _normalizeExprTriplet(el.points[0]) : null);
}
function _getElementFromExprTriplet(el) {
	if (!el) return null;
	return _normalizeExprTriplet(el.fromExpr) || (Array.isArray(el.points) && el.points.length > 1 ? _normalizeExprTriplet(el.points[1]) : null);
}
function activateFollowCam(viewSpec) {
	const followTargets = Array.isArray(viewSpec.follow) ? viewSpec.follow : [viewSpec.follow];
	const offset = viewSpec.offset || [
		0,
		0,
		30
	];
	let el = null;
	for (const tid of followTargets) {
		const candidate = findElementSpecById(tid);
		if (!candidate) continue;
		if (_getElementPosExprTriplet(candidate) !== null) {
			el = candidate;
			break;
		}
	}
	if (!el) {
		console.warn("follow-cam: no element with a valid expression found for targets:", followTargets);
		return;
	}
	let exprStrings = _getElementPosExprTriplet(el);
	let fromExprStrings = _getElementFromExprTriplet(el);
	if (!exprStrings) {
		console.warn("follow-cam: element has no expr:", el.id);
		return;
	}
	let compiledExprs, compiledFromExprs = null;
	try {
		compiledExprs = exprStrings.map((e) => compileExpr(e));
	} catch (err) {
		console.warn("follow-cam: expr compile error", err);
		return;
	}
	if (Array.isArray(fromExprStrings) && fromExprStrings.length === 3) try {
		compiledFromExprs = fromExprStrings.map((e) => compileExpr(e));
	} catch (err) {
		console.warn("follow-cam: fromExpr compile error", err);
	}
	const up = Array.isArray(viewSpec.up) ? viewSpec.up.slice(0, 3) : followState.sceneUp.slice(0, 3);
	const viewAxis = viewSpec.angleLockAxis;
	const sceneAxis = followState.currentSpec && followState.currentSpec.angleLockAxis;
	const angleLockAxisData = Array.isArray(viewAxis) && viewAxis.length === 3 ? viewAxis.slice(0, 3) : Array.isArray(sceneAxis) && sceneAxis.length === 3 ? sceneAxis.slice(0, 3) : followState.sceneUp.slice(0, 3);
	const angleLockDirectionTargets = Array.isArray(viewSpec.angleLockDirection) && viewSpec.angleLockDirection.length === 2 ? viewSpec.angleLockDirection.slice(0, 2) : null;
	const angleLockDirectionVectorTargets = typeof viewSpec.angleLockDirection === "string" && viewSpec.angleLockDirection.trim() ? [viewSpec.angleLockDirection.trim()] : null;
	let resolvedAngleLockVectorTargets = (Array.isArray(viewSpec.angleLockVector) ? viewSpec.angleLockVector.slice() : typeof viewSpec.angleLockVector === "string" && viewSpec.angleLockVector.trim() ? [viewSpec.angleLockVector.trim()] : null) || angleLockDirectionVectorTargets;
	if (!resolvedAngleLockVectorTargets && el && (el.type === "animated_vector" || el.type === "vector")) resolvedAngleLockVectorTargets = [el.id];
	let initDataPos;
	const freshEntry = _getFreshAnimEntry(followTargets);
	if (freshEntry) initDataPos = freshEntry.pos;
	else try {
		initDataPos = compiledExprs.map((fn) => evalExpr(fn, 0));
	} catch (err) {
		initDataPos = [
			0,
			0,
			0
		];
	}
	const initTargetWorld = dataToWorld(initDataPos);
	const initCamWorld = dataToWorld([
		initDataPos[0] + offset[0],
		initDataPos[1] + offset[1],
		initDataPos[2] + offset[2]
	]);
	if (followState.camera && followState.controls) {
		followState.camera.position.set(initCamWorld[0], initCamWorld[1], initCamWorld[2]);
		followState.controls.target.set(initTargetWorld[0], initTargetWorld[1], initTargetWorld[2]);
		followState.camera.up.copy(_normalizeUpVector(up));
		followState.camera.lookAt(followState.controls.target);
		followState.controls.update();
	}
	let directionEval = null;
	if (resolvedAngleLockVectorTargets) for (const vid of resolvedAngleLockVectorTargets) {
		const vel = findElementSpecById(vid);
		if (!vel) continue;
		const toStr = _getElementPosExprTriplet(vel);
		const fromStr = _getElementFromExprTriplet(vel) || [
			"0",
			"0",
			"0"
		];
		if (!toStr) continue;
		try {
			const toFns = toStr.map((e) => compileExpr(e));
			const fromFns = fromStr.map((e) => compileExpr(e));
			directionEval = { evalDir(tSec) {
				const to = toFns.map((fn) => evalExpr(fn, tSec));
				const from = fromFns.map((fn) => evalExpr(fn, tSec));
				const d = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
				const len = d.length();
				return len > 1e-8 ? d.multiplyScalar(1 / len) : null;
			} };
			break;
		} catch (err) {}
	}
	if (!directionEval && angleLockDirectionTargets) {
		const aEl = findElementSpecById(angleLockDirectionTargets[0]);
		const bEl = findElementSpecById(angleLockDirectionTargets[1]);
		const aStr = aEl ? _getElementPosExprTriplet(aEl) : null;
		const bStr = bEl ? _getElementPosExprTriplet(bEl) : null;
		if (aStr && bStr) try {
			const aFns = aStr.map((e) => compileExpr(e));
			const bFns = bStr.map((e) => compileExpr(e));
			directionEval = { evalDir(tSec) {
				const a = aFns.map((fn) => evalExpr(fn, tSec));
				const b = bFns.map((fn) => evalExpr(fn, tSec));
				const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
				const len = d.length();
				return len > 1e-8 ? d.multiplyScalar(1 / len) : null;
			} };
		} catch (err) {}
	}
	followState.followCamState = {
		followTargets,
		offset,
		compiledExprs,
		compiledFromExprs,
		up,
		exprStrings,
		fromExprStrings: fromExprStrings || null,
		lastTargetWorld: new THREE.Vector3(...initTargetWorld),
		axisWorld: _normalizeUpVector(angleLockAxisData).clone().normalize(),
		axisCenterWorld: new THREE.Vector3(...dataToWorld([
			0,
			0,
			0
		])),
		vectorTargets: resolvedAngleLockVectorTargets,
		directionTargets: angleLockDirectionTargets,
		lastDirectionWorld: _getDirectionWorldFromVectorTargets(resolvedAngleLockVectorTargets) || _getDirectionWorldFromTargets(angleLockDirectionTargets) || _computeDerivedDirectionWorld(followTargets),
		directionEval,
		refStartTime: freshEntry && Number.isFinite(freshEntry.startTime) ? freshEntry.startTime : performance.now(),
		viewKey: viewSpec && viewSpec._viewKey ? viewSpec._viewKey : null
	};
	followState.followCamStartTime = performance.now();
	console.log("🎥 follow-cam activated for targets:", followTargets);
	if (followState.controls && Object.prototype.hasOwnProperty.call(followState.controls, "enableDamping")) {
		followState.followCamSavedControls = {
			enableDamping: !!followState.controls.enableDamping,
			dampingFactor: Number.isFinite(followState.controls.dampingFactor) ? followState.controls.dampingFactor : 0
		};
		followState.controls.enableDamping = false;
	}
	updateFollowAngleLockButtonState();
}
function deactivateFollowCam() {
	if (!followState.followCamState) return;
	followState.followCamState = null;
	if (followState.controls && followState.followCamSavedControls) {
		if (Object.prototype.hasOwnProperty.call(followState.controls, "enableDamping")) {
			followState.controls.enableDamping = followState.followCamSavedControls.enableDamping;
			if (Number.isFinite(followState.followCamSavedControls.dampingFactor)) followState.controls.dampingFactor = followState.followCamSavedControls.dampingFactor;
		}
	}
	followState.followCamSavedControls = null;
	console.log("🎥 follow-cam deactivated");
	updateFollowAngleLockButtonState();
}
function _getFreshAnimEntry(targets) {
	let best = null;
	for (const tid of targets) {
		const entry = followState.animatedElementPos[tid];
		if (entry && performance.now() - entry.time < 500) {
			if (!best || entry.time > best.time) best = entry;
		}
	}
	return best;
}
function _getLatestAnimEntry(targets) {
	let best = null;
	for (const tid of targets) {
		const entry = followState.animatedElementPos[tid];
		if (entry) {
			if (!best || entry.time > best.time) best = entry;
		}
	}
	return best;
}
function _computeDerivedDirectionWorld(targets) {
	if (!Array.isArray(targets) || targets.length < 2) return null;
	const first = followState.animatedElementPos[targets[0]];
	const last = followState.animatedElementPos[targets[targets.length - 1]];
	if (!first || !last) return null;
	const firstIsVec = first.from !== void 0;
	const lastIsVec = last.from !== void 0;
	let fromPos, toPos;
	if (!firstIsVec && !lastIsVec) {
		fromPos = first.pos;
		toPos = last.pos;
	} else if (firstIsVec && !lastIsVec) {
		fromPos = first.from;
		toPos = last.pos;
	} else if (!firstIsVec && lastIsVec) {
		fromPos = first.pos;
		toPos = last.pos;
	} else {
		const v1d = [
			first.pos[0] - first.from[0],
			first.pos[1] - first.from[1],
			first.pos[2] - first.from[2]
		];
		const v2d = [
			last.pos[0] - last.from[0],
			last.pos[1] - last.from[1],
			last.pos[2] - last.from[2]
		];
		fromPos = first.from;
		toPos = [
			first.from[0] + v1d[0] + v2d[0],
			first.from[1] + v1d[1] + v2d[1],
			first.from[2] + v1d[2] + v2d[2]
		];
	}
	const fromW = new THREE.Vector3(...dataToWorld(fromPos));
	const dir = new THREE.Vector3(...dataToWorld(toPos)).sub(fromW);
	return dir.length() > 1e-6 ? dir.normalize() : null;
}
function _getDirectionWorldFromTargets(targetPair) {
	if (!Array.isArray(targetPair) || targetPair.length !== 2) return null;
	const fromEntry = _getFreshAnimEntry([targetPair[0]]);
	const toEntry = _getFreshAnimEntry([targetPair[1]]);
	if (!fromEntry || !toEntry) return null;
	const fromWorld = new THREE.Vector3(...dataToWorld(fromEntry.pos));
	const dir = new THREE.Vector3(...dataToWorld(toEntry.pos)).sub(fromWorld);
	const len = dir.length();
	if (len < 1e-8) return null;
	return dir.multiplyScalar(1 / len);
}
function _getDirectionWorldFromVectorTargets(vectorTargets) {
	if (!Array.isArray(vectorTargets) || vectorTargets.length === 0) return null;
	for (const vid of vectorTargets) {
		const entry = _getFreshAnimEntry([vid]);
		if (!entry) continue;
		if (Array.isArray(entry.from) && entry.from.length === 3 && Array.isArray(entry.to) && entry.to.length === 3) {
			const fromWorld = new THREE.Vector3(...dataToWorld(entry.from));
			const dir = new THREE.Vector3(...dataToWorld(entry.to)).sub(fromWorld);
			const len = dir.length();
			if (len > 1e-8) return dir.multiplyScalar(1 / len);
		}
	}
	return null;
}
function updateFollowCam() {
	if (!followState.followCamState || !followState.camera || !followState.controls) return;
	const { followTargets, compiledExprs } = followState.followCamState;
	let targetDataPos;
	const tSecRef = (performance.now() - (followState.followCamState.refStartTime || followState.followCamStartTime)) / 1e3;
	const latest = _getLatestAnimEntry(followTargets);
	if (!followState.followCamAngleLock && latest) targetDataPos = latest.pos;
	if (!targetDataPos && followState.followCamAngleLock && compiledExprs) try {
		targetDataPos = compiledExprs.map((fn) => evalExpr(fn, tSecRef));
	} catch (err) {
		targetDataPos = null;
	}
	if (!targetDataPos && latest) targetDataPos = latest.pos;
	if (!targetDataPos) {
		let staleEntry = null;
		for (const tid of followTargets) if (followState.animatedElementPos[tid]) {
			staleEntry = followState.animatedElementPos[tid];
			break;
		}
		if (staleEntry && compiledExprs) {
			const tSec = (performance.now() - staleEntry.startTime) / 1e3;
			try {
				targetDataPos = compiledExprs.map((fn) => evalExpr(fn, tSec));
			} catch (err) {
				return;
			}
		} else if (compiledExprs) {
			const tSec = (performance.now() - followState.followCamStartTime) / 1e3;
			try {
				targetDataPos = compiledExprs.map((fn) => evalExpr(fn, tSec));
			} catch (err) {
				return;
			}
		} else return;
	}
	const newTargetWorld = new THREE.Vector3(...dataToWorld(targetDataPos));
	const oldTargetWorld = followState.followCamState.lastTargetWorld.clone();
	const delta = newTargetWorld.clone().sub(oldTargetWorld);
	followState.camera.position.add(delta);
	followState.controls.target.copy(newTargetWorld);
	if (followState.followCamAngleLock) {
		const axis = followState.followCamState.axisWorld;
		const center = followState.followCamState.axisCenterWorld;
		const oldDir = followState.followCamState.lastDirectionWorld ? followState.followCamState.lastDirectionWorld.clone() : null;
		const newDir = followState.followCamState.directionEval && typeof followState.followCamState.directionEval.evalDir === "function" ? followState.followCamState.directionEval.evalDir(tSecRef) : _computeDerivedDirectionWorld(followTargets) || _getDirectionWorldFromVectorTargets(followState.followCamState.vectorTargets) || _getDirectionWorldFromTargets(followState.followCamState.directionTargets);
		const prevBase = oldDir || oldTargetWorld.clone().sub(center);
		const nextBase = newDir || newTargetWorld.clone().sub(center);
		const prevProj = prevBase.sub(axis.clone().multiplyScalar(prevBase.dot(axis)));
		const nextProj = nextBase.sub(axis.clone().multiplyScalar(nextBase.dot(axis)));
		const prevLen = prevProj.length();
		const nextLen = nextProj.length();
		if (prevLen > 1e-6 && nextLen > 1e-6) {
			prevProj.multiplyScalar(1 / prevLen);
			nextProj.multiplyScalar(1 / nextLen);
			const cross = new THREE.Vector3().crossVectors(prevProj, nextProj);
			const sinA = axis.dot(cross);
			const cosA = THREE.MathUtils.clamp(prevProj.dot(nextProj), -1, 1);
			const dAngle = Math.atan2(sinA, cosA);
			if (Number.isFinite(dAngle) && Math.abs(dAngle) > 1e-7) {
				const offset = followState.camera.position.clone().sub(newTargetWorld);
				offset.applyAxisAngle(axis, dAngle);
				followState.camera.position.copy(newTargetWorld).add(offset);
				followState.camera.up.applyAxisAngle(axis, dAngle).normalize();
			}
		}
		if (newDir) followState.followCamState.lastDirectionWorld = newDir;
	}
	followState.camera.lookAt(followState.controls.target);
	followState.followCamState.lastTargetWorld.copy(newTargetWorld);
}
function updateFollowAngleLockButtonState() {
	const btn = document.getElementById("follow-angle-lock-toggle");
	if (!btn) return;
	btn.classList.toggle("active", !!followState.followCamAngleLock);
	btn.classList.toggle("cam-active", !!followState.followCamState);
	if (followState.followCamState) btn.title = followState.followCamAngleLock ? "Angle-lock ON: camera rotates with followed object" : "Angle-lock OFF: camera follows position only";
	else btn.title = followState.followCamAngleLock ? "Angle-lock armed (applies in follow-cam views)" : "Toggle angle-lock for follow camera";
}
function setupFollowAngleLockToggle() {
	const btn = document.getElementById("follow-angle-lock-toggle");
	if (!btn) return;
	btn.innerHTML = ANGLE_LOCK_ICON;
	btn.style.display = "flex";
	btn.addEventListener("click", () => {
		followState.followCamAngleLock = !followState.followCamAngleLock;
		updateFollowAngleLockButtonState();
	});
	updateFollowAngleLockButtonState();
}
function _normalizeUpVector(up) {
	const raw = Array.isArray(up) && up.length === 3 ? up : [
		0,
		1,
		0
	];
	const v = new THREE.Vector3(raw[0], raw[1], raw[2]);
	if (v.lengthSq() < 1e-12) return new THREE.Vector3(0, 1, 0);
	return v.normalize();
}
//#endregion
//#region src/labels.ts
var AI_SPARKLE_SVG = "<svg viewBox=\"0 0 16 16\" fill=\"currentColor\" width=\"11\" height=\"11\"><path d=\"M8 1c0 4-3 6.5-7 7 4 .5 7 3 7 7 0-4 3-6.5 7-7-4-.5-7-3-7-7z\"/></svg>";
function escapeHtml$2(s) {
	const d = document.createElement("div");
	d.textContent = s;
	return d.innerHTML;
}
function stripLatex(text) {
	if (!text) return "";
	return text.replace(/\$\$([^$]*)\$\$/g, "$1").replace(/\$([^$]*)\$/g, "$1");
}
var _HTML_MACROS = [
	"htmlClass",
	"htmlData",
	"htmlId",
	"htmlStyle"
];
/** Strip KaTeX \htmlClass/\htmlData/\htmlId/\htmlStyle wrappers, keeping their
*  inner content (recursively). Leaves malformed wrappers intact. */
function stripHtmlMacros(s) {
	if (!s) return s ?? "";
	const str = String(s);
	const skipBalanced = (k) => {
		let depth = 0;
		for (; k < str.length; k++) if (str[k] === "{") depth++;
		else if (str[k] === "}" && --depth === 0) return k + 1;
		return -1;
	};
	let out = "";
	let i = 0;
	while (i < str.length) {
		const m = str[i] === "\\" && _HTML_MACROS.find((x) => str.startsWith("\\" + x, i));
		if (!m) {
			out += str[i++];
			continue;
		}
		let k = i + 1 + m.length;
		while (k < str.length && /\s/.test(str[k])) k++;
		let c = str[k] === "{" ? skipBalanced(k) : -1;
		if (c > 0) while (c < str.length && /\s/.test(str[c])) c++;
		const contentEnd = c > 0 && str[c] === "{" ? skipBalanced(c) : -1;
		if (contentEnd < 0) {
			out += str[i++];
			continue;
		}
		out += stripHtmlMacros(str.slice(c + 1, contentEnd - 1));
		i = contentEnd;
	}
	return out;
}
/** Loose LaTeX normalization for equality comparison: drop \text{}/\mathrm{}
*  wrappers, braces, whitespace, and normalize \le/\ge spelling — so e.g.
*  \gamma_{steep} compares equal to \gamma_{\text{steep}}. */
function normLatex(s) {
	return (s || "").replace(/\\(?:text|mathrm|mathbf|operatorname)\s*\{([^{}]*)\}/g, "$1").replace(/\\le(?![a-zA-Z])/g, "\\leq").replace(/\\ge(?![a-zA-Z])/g, "\\geq").replace(/[\s{}]/g, "");
}
function renderKaTeX$1(text, displayMode) {
	if (!text) return "";
	const tables = [];
	const withTables = text.replace(/^(\|.+\|)\n(\|[\s:?-]+(?:\|[\s:?-]+)+\|)\n((?:\|.+\|\n?)+)/gm, (_match, headerLine, _sepLine, bodyBlock) => {
		const parseRow = (row) => {
			const content = row.replace(/^\|/, "").replace(/\|$/, "");
			const cells = [];
			let current = "";
			let inMath = false, inDisplayMath = false;
			for (let ci = 0; ci < content.length; ci++) {
				const ch = content[ci], next = content[ci + 1];
				if (ch === "\\" && ci + 1 < content.length) {
					current += ch + content[++ci];
					continue;
				}
				if (ch === "$") {
					if (next === "$") {
						inDisplayMath = !inDisplayMath;
						current += "$$";
						ci++;
						continue;
					}
					if (!inDisplayMath) inMath = !inMath;
					current += ch;
					continue;
				}
				if (ch === "|" && !inMath && !inDisplayMath) {
					cells.push(current.trim());
					current = "";
					continue;
				}
				current += ch;
			}
			cells.push(current.trim());
			return cells;
		};
		const headers = parseRow(headerLine);
		const rows = bodyBlock.trim().split("\n").map((r) => parseRow(r));
		const tableStyle = "border-collapse:collapse;margin:6px 0;font-size:0.9em";
		const cellStyle = "padding:3px 8px;border:1px solid rgba(255,255,255,0.15)";
		const thStyle = "padding:3px 8px;border:1px solid rgba(255,255,255,0.15);font-weight:bold;background:rgba(255,255,255,0.06)";
		let html = `<table style="${tableStyle}"><thead><tr>`;
		html += headers.map((h) => `<th style="${thStyle}">${renderKaTeX$1(h, false)}</th>`).join("");
		html += "</tr></thead><tbody>";
		for (const row of rows) html += "<tr>" + row.map((c) => `<td style="${cellStyle}">${renderKaTeX$1(c, false)}</td>`).join("") + "</tr>";
		html += "</tbody></table>";
		tables.push(html);
		return `\x01T${tables.length - 1}\x01`;
	});
	const headings = [];
	let prepped = withTables.replace(/^(#{1,3})\s+(.+)$/gm, (_m, hashes, content) => {
		const sz = [
			"1.05em",
			"0.95em",
			"0.88em"
		][hashes.length - 1];
		headings.push(`<div style="font-size:${sz};font-weight:bold;margin:3px 0 1px">${renderKaTeX$1(content, false)}</div>`);
		return `\x01H${headings.length - 1}\x01`;
	});
	const codeSpans = [];
	prepped = prepped.replace(/`(.+?)`/g, (_m, inner) => {
		codeSpans.push(inner);
		return `\x01C${codeSpans.length - 1}\x01`;
	});
	const mathSpans = [];
	prepped = prepped.replace(/(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g, (match) => {
		mathSpans.push(match);
		return `\x01M${mathSpans.length - 1}\x01`;
	});
	const boldSpans = [];
	prepped = prepped.replace(/\*\*(.+?)\*\*/g, (_m, inner) => {
		boldSpans.push(inner);
		return `\x01B${boldSpans.length - 1}\x01`;
	});
	const italicSpans = [];
	prepped = prepped.replace(/\*(.+?)\*/g, (_m, inner) => {
		italicSpans.push(inner);
		return `\x01I${italicSpans.length - 1}\x01`;
	});
	const restoreMath = (str) => str.replace(/\x01M(\d+)\x01/g, (_m, idx) => mathSpans[+idx]);
	prepped = restoreMath(prepped);
	for (let i = 0; i < boldSpans.length; i++) boldSpans[i] = restoreMath(boldSpans[i]);
	for (let i = 0; i < italicSpans.length; i++) italicSpans[i] = restoreMath(italicSpans[i]);
	return prepped.split(/(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g).map((seg, i) => {
		if (i % 2 === 0) {
			const lines = escapeHtml$2(seg).split(/\\n|\n/);
			return lines.map((line, li) => {
				const t = line.trim();
				const hIdx = t.match(/^\x01H(\d+)\x01$/);
				if (hIdx) return headings[+hIdx[1]];
				const tIdx = t.match(/^\x01T(\d+)\x01$/);
				if (tIdx) return tables[+tIdx[1]];
				const hm = t.match(/^(#{1,3})\s+(.*)/);
				if (hm) return `<div style="font-size:${[
					"1.05em",
					"0.95em",
					"0.88em"
				][hm[1].length - 1]};font-weight:bold;margin:3px 0 1px">${hm[2]}</div>`;
				if (t === "---") return "<hr style=\"border:none;border-top:1px solid rgba(255,255,255,0.2);margin:4px 0\">";
				const inline = line.replace(/\x01B(\d+)\x01/g, (_m, idx) => `<strong>${renderKaTeX$1(boldSpans[+idx], false)}</strong>`).replace(/\x01I(\d+)\x01/g, (_m, idx) => `<em>${renderKaTeX$1(italicSpans[+idx], false)}</em>`).replace(/\x01C(\d+)\x01/g, (_m, idx) => `<code>${codeSpans[+idx]}</code>`).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/`(.+?)`/g, "<code>$1</code>");
				return li < lines.length - 1 ? inline + "<br>" : inline;
			}).join("");
		} else if (seg.startsWith("$$")) {
			const tex = seg.slice(2, -2);
			try {
				return katex.renderToString(tex, {
					throwOnError: false,
					strict: false,
					displayMode: true,
					trust: (ctx) => ctx.command === "\\htmlClass"
				});
			} catch (_e) {
				return escapeHtml$2(seg);
			}
		} else {
			const tex = seg.slice(1, -1);
			try {
				return katex.renderToString(tex, {
					throwOnError: false,
					strict: false,
					displayMode: false,
					trust: (ctx) => ctx.command === "\\htmlClass"
				});
			} catch (_e) {
				return escapeHtml$2(seg);
			}
		}
	}).join("");
}
function renderMarkdown$1(md) {
	if (!md) return "";
	const mathBlocks = [];
	let safe = md.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => {
		mathBlocks.push({
			tex: tex.trim(),
			display: true
		});
		return "%%MATH_BLOCK_" + (mathBlocks.length - 1) + "%%";
	});
	safe = safe.replace(/\$([^$\n]+)\$/g, (_m, tex) => {
		mathBlocks.push({
			tex: tex.trim(),
			display: false
		});
		return "%%MATH_BLOCK_" + (mathBlocks.length - 1) + "%%";
	});
	let html = marked.parse(safe);
	html = html.replace(/%%MATH_BLOCK_(\d+)%%/g, (_m, idx) => {
		const block = mathBlocks[parseInt(idx)];
		try {
			return katex.renderToString(block.tex, {
				throwOnError: false,
				strict: false,
				displayMode: block.display,
				trust: (ctx) => ctx.command === "\\htmlClass"
			});
		} catch (_e) {
			return block.tex;
		}
	});
	return html;
}
function parseColor(c) {
	if (!c) return [
		.5,
		.5,
		1
	];
	if (typeof c === "string") {
		if (c.startsWith("#")) {
			const hex = c.slice(1);
			return [
				parseInt(hex.substr(0, 2), 16) / 255,
				parseInt(hex.substr(2, 2), 16) / 255,
				parseInt(hex.substr(4, 2), 16) / 255
			];
		}
		return {
			"red": [
				1,
				.2,
				.2
			],
			"green": [
				.2,
				.9,
				.2
			],
			"blue": [
				.3,
				.4,
				1
			],
			"yellow": [
				1,
				1,
				.2
			],
			"cyan": [
				.2,
				1,
				1
			],
			"magenta": [
				1,
				.2,
				1
			],
			"orange": [
				1,
				.6,
				.1
			],
			"purple": [
				.7,
				.3,
				1
			],
			"white": [
				1,
				1,
				1
			],
			"gray": [
				.5,
				.5,
				.5
			],
			"grey": [
				.5,
				.5,
				.5
			],
			"pink": [
				1,
				.5,
				.7
			]
		}[c.toLowerCase()] || [
			.5,
			.5,
			1
		];
	}
	if (Array.isArray(c)) return c.map((v) => v > 1 ? v / 255 : v);
	return [
		.5,
		.5,
		1
	];
}
function colorToCSS(c) {
	const rgb = parseColor(c);
	return `rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`;
}
var labelsState = state;
var _labelSeq = 0;
function addLabel3D(text, dataPos, color, opts) {
	const o = typeof opts === "string" ? { cssClass: opts } : opts || {};
	const container = document.getElementById("labels-container");
	const el = document.createElement("div");
	el.className = o.cssClass || "label-3d";
	el.innerHTML = renderKaTeX$1(text, false);
	if (color) el.style.color = colorToCSS(color);
	container.appendChild(el);
	const align = o.align || "center";
	const entry = {
		el,
		dataPos: dataPos.slice(),
		screenX: null,
		screenY: null,
		forceHidden: false,
		align,
		boxW: null,
		boxH: null,
		boxScale: null,
		offsetY: 0,
		targetOffsetY: 0,
		depth: 0,
		dim: 1,
		targetDim: 1,
		fade: 1,
		targetFade: 1,
		seq: _labelSeq++,
		lastDataPos: null,
		moveCooldown: 0
	};
	labelsState.labels.push(entry);
	return entry;
}
function clearLabels() {
	const container = document.getElementById("labels-container");
	container.innerHTML = "";
	labelsState.labels = [];
}
var _labelsContainer = null;
var _appliedLabelScale = null;
function updateLabels() {
	const camera = labelsState.camera;
	const renderer = labelsState.renderer;
	if (!camera || !renderer) return;
	const w = renderer.domElement.clientWidth;
	const h = renderer.domElement.clientHeight;
	const s = labelsState.displayParams.labelScale;
	if (_appliedLabelScale !== s) {
		if (!_labelsContainer) _labelsContainer = document.getElementById("labels-container");
		if (_labelsContainer) _labelsContainer.style.setProperty("--label-scale", String(s));
		_appliedLabelScale = s;
	}
	for (const lbl of labelsState.labels) {
		const dp = lbl.dataPos;
		const prev = lbl.lastDataPos;
		if (prev && (Math.abs(dp[0] - prev[0]) > 1e-6 || Math.abs(dp[1] - prev[1]) > 1e-6 || Math.abs(dp[2] - prev[2]) > 1e-6)) lbl.moveCooldown = 20;
		else if (lbl.moveCooldown > 0) lbl.moveCooldown--;
		lbl.lastDataPos = [
			dp[0],
			dp[1],
			dp[2]
		];
		lbl.moving = lbl.moveCooldown > 0;
		const world = dataToWorld(dp);
		const v = new THREE.Vector3(world[0], world[1], world[2]);
		lbl.depth = camera.position.distanceTo(v);
		const projected = v.project(camera);
		const targetX = (projected.x * .5 + .5) * w;
		const targetY = (-projected.y * .5 + .5) * h;
		lbl.visible = !lbl.forceHidden && projected.z < 1 && targetX > -50 && targetX < w + 50 && targetY > -50 && targetY < h + 50;
		if (lbl.screenX == null || lbl.screenY == null) {
			lbl.screenX = targetX;
			lbl.screenY = targetY;
		} else {
			const alpha = .3;
			lbl.screenX += (targetX - lbl.screenX) * alpha;
			lbl.screenY += (targetY - lbl.screenY) * alpha;
		}
		if (lbl.visible && (lbl.boxW == null || lbl.boxScale !== s)) {
			lbl.boxW = lbl.el.offsetWidth;
			lbl.boxH = lbl.el.offsetHeight;
			lbl.boxScale = s;
		}
	}
	resolveLabelOffsets();
	resolveDepthDimming();
	const declutterAlpha = state.displayParams.labelDeclutterAlpha;
	const dimAlpha = state.displayParams.labelDimAlpha;
	for (const lbl of labelsState.labels) {
		lbl.offsetY += (lbl.targetOffsetY - lbl.offsetY) * declutterAlpha;
		lbl.dim += (lbl.targetDim - lbl.dim) * dimAlpha;
		lbl.fade += (lbl.targetFade - lbl.fade) * dimAlpha;
		const ax = lbl.align === "right" ? "-100%" : lbl.align === "left" ? "0%" : "-50%";
		const y = lbl.screenY + lbl.offsetY;
		lbl.el.style.transform = `translate(${lbl.screenX}px, ${y}px) translate(${ax}, -50%)`;
		lbl.el.style.opacity = lbl.visible ? (labelsState.displayParams.labelOpacity * lbl.fade).toFixed(3) : "0";
		lbl.el.style.filter = lbl.dim < .999 ? `brightness(${lbl.dim.toFixed(3)})` : "";
	}
	const ordered = labelsState.labels.filter((l) => l.visible).sort(frontToBack);
	for (let i = 0; i < ordered.length; i++) {
		const zi = ordered.length - i;
		const o = ordered[i];
		if (o._zi !== zi) {
			o.el.style.zIndex = String(zi);
			o._zi = zi;
		}
	}
}
function frontToBack(a, b) {
	if (Math.abs(a.depth - b.depth) > .01) return a.depth - b.depth;
	if (a.moving !== b.moving) return a.moving ? -1 : 1;
	return b.seq - a.seq;
}
function resolveDepthDimming() {
	const active = [];
	for (const lbl of labelsState.labels) {
		lbl.targetDim = 1;
		lbl.targetFade = 1;
		if (lbl.visible && lbl.boxW != null) active.push(lbl);
	}
	if (state.displayParams.labelDeclutterMode !== "shade" || active.length < 2) return;
	const dimBase = state.displayParams.labelDimBase;
	const dimFloor = state.displayParams.labelDimFloor;
	const relScale = state.displayParams.labelDimDepthScale;
	const hideThreshold = Math.round(state.displayParams.labelDimHideThreshold);
	const hideLevel = Math.min(1, Math.max(0, state.displayParams.labelDimHideLevel));
	const boxes = new Map(active.map((l) => [l, labelBox(l)]));
	const overlaps = (a, b) => {
		const A = boxes.get(a), B = boxes.get(b);
		return A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom;
	};
	for (const cluster of clusterByOverlap(active)) {
		if (cluster.length < 2) continue;
		const hidden = /* @__PURE__ */ new Set();
		if (hideThreshold >= 2 && cluster.length >= hideThreshold) {
			const byDepth = cluster.slice().sort(frontToBack);
			for (let r = hideThreshold - 1; r < byDepth.length; r++) {
				const far = byDepth[r];
				far.targetFade = hideLevel;
				hidden.add(far);
			}
		}
		for (const lbl of cluster) {
			if (hidden.has(lbl)) continue;
			let covered = false, nearestDepth = Infinity;
			for (const other of cluster) {
				if (other === lbl || !overlaps(lbl, other)) continue;
				if (frontToBack(other, lbl) < 0) {
					covered = true;
					if (other.depth < nearestDepth) nearestDepth = other.depth;
				}
			}
			if (covered) {
				const gap = Math.max(0, lbl.depth - nearestDepth);
				lbl.targetDim = dimBase - Math.min(1, gap / nearestDepth / relScale) * (dimBase - dimFloor);
			}
		}
	}
}
function resolveLabelOffsets() {
	const active = [];
	for (const lbl of labelsState.labels) {
		lbl.targetOffsetY = 0;
		if (lbl.visible && lbl.boxW != null && !lbl.moving) active.push(lbl);
	}
	if (state.displayParams.labelDeclutterMode !== "position" || active.length < 2) return;
	const gap = state.displayParams.labelDeclutterGap;
	const maxStack = state.displayParams.labelDeclutterMaxStack;
	for (const cluster of clusterByOverlap(active)) {
		if (cluster.length < 2) continue;
		cluster.sort((a, b) => a.screenY - b.screenY);
		resolveVerticalStack(cluster, gap, maxStack);
	}
}
function resolveVerticalStack(cluster, gap, maxStack) {
	const n = cluster.length;
	let i = 0;
	while (i < n) {
		let j = i;
		while (j + 1 < n && cluster[j + 1].screenY - cluster[j].screenY < (cluster[j].boxH + cluster[j + 1].boxH) / 2) j++;
		if (j > i) resolveRun(cluster, i, j, gap, maxStack);
		i = j + 1;
	}
}
function resolveRun(cluster, start, end, gap, maxStack) {
	const n = end - start + 1;
	const S = new Array(n);
	S[0] = 0;
	for (let k = 1; k < n; k++) S[k] = S[k - 1] + (cluster[start + k - 1].boxH + cluster[start + k].boxH) / 2 + gap;
	const desired = [];
	for (let k = 0; k < n; k++) desired[k] = cluster[start + k].screenY - S[k];
	const blocks = [];
	for (let k = 0; k < n; k++) {
		let b = {
			sum: desired[k],
			size: 1,
			k0: k
		};
		while (blocks.length && blocks[blocks.length - 1].sum / blocks[blocks.length - 1].size > b.sum / b.size) {
			const prev = blocks.pop();
			b = {
				sum: prev.sum + b.sum,
				size: prev.size + b.size,
				k0: prev.k0
			};
		}
		blocks.push(b);
	}
	for (const b of blocks) {
		const mean = b.sum / b.size;
		const scale = Math.min(1, maxStack / Math.max(1, b.size - 1));
		let sAvg = 0;
		for (let k = b.k0; k < b.k0 + b.size; k++) sAvg += S[k];
		sAvg /= b.size;
		for (let k = b.k0; k < b.k0 + b.size; k++) {
			const finalY = mean + sAvg + (S[k] - sAvg) * scale;
			const lbl = cluster[start + k];
			lbl.targetOffsetY = finalY - lbl.screenY;
		}
	}
}
function labelBox(l) {
	const left = l.align === "right" ? l.screenX - l.boxW : l.align === "left" ? l.screenX : l.screenX - l.boxW / 2;
	return {
		left,
		right: left + l.boxW,
		top: l.screenY - l.boxH / 2,
		bottom: l.screenY + l.boxH / 2
	};
}
function clusterByOverlap(labels) {
	const n = labels.length;
	const boxes = labels.map(labelBox);
	const parent = labels.map((_, i) => i);
	const find = (i) => {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	};
	for (let i = 0; i < n; i++) {
		const a = boxes[i];
		for (let j = i + 1; j < n; j++) {
			const b = boxes[j];
			if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) parent[find(i)] = find(j);
		}
	}
	const groups = /* @__PURE__ */ new Map();
	for (let i = 0; i < n; i++) {
		const r = find(i);
		if (!groups.has(r)) groups.set(r, []);
		groups.get(r).push(labels[i]);
	}
	return [...groups.values()];
}
function openChatPanel() {
	const panel = document.getElementById("explanation-panel");
	const handle = document.getElementById("panel-resize-handle");
	const toggle = document.getElementById("explain-toggle");
	if (panel && panel.classList.contains("hidden")) {
		panel.classList.remove("hidden");
		if (handle) handle.style.display = "block";
		if (toggle) {
			toggle.style.display = "block";
			toggle.classList.add("active");
		}
		setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
	}
	if (typeof switchPanelTab === "function") switchPanelTab("chat");
}
/** Build an AI ask-button. `getMessage` may return null/'' when there is nothing
*  to ask about (e.g. the proof step-ask chip before it is anchored to a step);
*  the click is then a complete no-op — no chat panel, no input text, no send —
*  matching the proof engine's own routed ask button. */
function makeAiAskButton(className, title, getMessage) {
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = className;
	btn.title = title + "\n\nClick to send · ⌘-click (Ctrl on Windows) to edit";
	btn.setAttribute("aria-label", title);
	btn.innerHTML = AI_SPARKLE_SVG;
	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		const message = getMessage();
		if (!message) return;
		openChatPanel();
		if (e.metaKey || e.ctrlKey) {
			const input = document.getElementById("chat-input");
			if (input) {
				input.value = message;
				input.focus();
				input.dispatchEvent(new Event("input"));
			}
			return;
		}
		if (typeof sendChatMessage !== "function") return;
		sendChatMessage(message);
	});
	return btn;
}
var DERIVE_SVG = "<svg viewBox=\"0 0 16 16\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 3h7\"/><path d=\"M3 8h10\"/><path d=\"M3 13h6\"/><path d=\"M12.5 11l2 2-2 2\" transform=\"translate(-1 -3.5)\"/></svg>";
/** Build a Derive icon button (matches the AI ask-button styling). `onClick`
*  fires on click; propagation is stopped so it never triggers row handlers. */
function makeDeriveButton(className, title, onClick) {
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = className;
	btn.title = title;
	btn.setAttribute("aria-label", title);
	btn.innerHTML = DERIVE_SVG;
	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		onClick(e);
	});
	return btn;
}
function elementToMarkdown(el) {
	const clone = el.cloneNode(true);
	clone.querySelectorAll(".katex-display").forEach((dispEl) => {
		const ann = dispEl.querySelector("annotation[encoding=\"application/x-tex\"]");
		if (ann) dispEl.replaceWith(`$$${ann.textContent.trim()}$$`);
	});
	clone.querySelectorAll(".katex").forEach((inlineEl) => {
		const ann = inlineEl.querySelector("annotation[encoding=\"application/x-tex\"]");
		if (ann) inlineEl.replaceWith(`$${ann.textContent.trim()}$`);
	});
	return clone.textContent.trim();
}
function injectAskButtons(contentEl) {
	contentEl.querySelectorAll("h1, h2, h3, p, li").forEach((el) => {
		const markdown = el.dataset.markdown || elementToMarkdown(el);
		if (!markdown || markdown.length < 10) return;
		const btn = makeAiAskButton("ai-ask-btn", "Explain this", () => "Can you explain this:\n" + markdown.trim());
		while (el.lastChild && el.lastChild.nodeType === 3 && !el.lastChild.textContent.trim()) el.removeChild(el.lastChild);
		const lastEl = el.lastElementChild;
		if (lastEl && lastEl.classList && lastEl.classList.contains("katex-display")) {
			const mathRow = document.createElement("span");
			mathRow.className = "doc-ai-math-row";
			btn.classList.add("ai-ask-btn--math-side");
			lastEl.replaceWith(mathRow);
			mathRow.appendChild(lastEl);
			mathRow.appendChild(btn);
			return;
		}
		el.appendChild(btn);
	});
}
//#endregion
//#region src/sliders.ts
var sliderState = state;
function getSliderIds() {
	const ids = Object.keys(sliderState.sceneSliders);
	const launchIdx = ids.indexOf("h");
	const injectionIdx = ids.indexOf("h_target");
	if (launchIdx >= 0 && injectionIdx >= 0 && launchIdx !== injectionIdx - 1) {
		ids.splice(launchIdx, 1);
		const newInjectionIdx = ids.indexOf("h_target");
		ids.splice(newInjectionIdx, 0, "h");
	}
	return ids;
}
function _formatSliderValue(s) {
	if (s._valueExprCompiled) try {
		const result = evalExpr(s._valueExprCompiled, 0, { useVirtualTime: false });
		return String(result);
	} catch (_e) {}
	return Number(s.value).toFixed(1);
}
function startSliderLoop(id) {
	const slider = sliderState.sceneSliders[id];
	if (!slider) return;
	slider._loopPlaying = true;
	if (typeof slider._onPlayStateChange === "function") slider._onPlayStateChange();
	const range = slider.max - slider.min;
	const period = slider.duration;
	const mode = slider.animateMode || "loop";
	const rawResumeT = range > 0 ? Math.max(0, Math.min(1, (slider.value - slider.min) / range)) : 0;
	const resumeT = mode === "once" && rawResumeT >= 1 ? 0 : rawResumeT;
	const startTime = performance.now() - resumeT * period;
	function tick(now) {
		if (!slider._loopPlaying || !sliderState.sceneSliders[id]) return;
		const elapsed = (now - startTime) / period;
		let tNorm;
		if (mode === "loop") tNorm = elapsed % 1;
		else if (mode === "once") {
			tNorm = Math.min(elapsed, 1);
			if (tNorm >= 1) {
				slider._loopPlaying = false;
				if (typeof slider._onPlayStateChange === "function") slider._onPlayStateChange();
			}
		} else {
			const phase = elapsed % 2;
			tNorm = phase < 1 ? phase : 2 - phase;
		}
		slider.value = slider.min + tNorm * range;
		const input = document.querySelector(`input[data-slider-id="${id}"]`);
		if (input) {
			input.value = String(slider.value);
			const valSpan = input.parentElement && input.parentElement.querySelector(".slider-value");
			if (valSpan) valSpan.textContent = _formatSliderValue(slider);
		}
		refreshActiveExprsForSliderValueChange();
		if (slider._loopPlaying) slider._loopRaf = requestAnimationFrame(tick);
		else slider._loopRaf = null;
	}
	slider._loopRaf = requestAnimationFrame(tick);
}
function stopSliderLoop(id) {
	const slider = sliderState.sceneSliders[id];
	if (!slider) return;
	slider._loopPlaying = false;
	if (slider._loopRaf) {
		cancelAnimationFrame(slider._loopRaf);
		slider._loopRaf = null;
	}
	if (typeof slider._onPlayStateChange === "function") slider._onPlayStateChange();
}
function stopAllSliderLoops() {
	for (const id of Object.keys(sliderState.sceneSliders)) stopSliderLoop(id);
}
function setupSliderDrag(e, overlay) {
	e.preventDefault();
	const parent = overlay.offsetParent || document.body;
	const parentH = parent.clientHeight;
	const rect = overlay.getBoundingClientRect();
	const parentRect = parent.getBoundingClientRect();
	sliderState._sliderDrag.active = true;
	sliderState._sliderDrag.startX = e.clientX;
	sliderState._sliderDrag.startY = e.clientY;
	sliderState._sliderDrag.startLeft = rect.left - parentRect.left;
	sliderState._sliderDrag.startBottom = parentRect.bottom - rect.bottom;
	overlay.classList.add("dragging");
	const onMove = (me) => {
		if (!sliderState._sliderDrag.active) return;
		const dx = me.clientX - sliderState._sliderDrag.startX;
		const dy = me.clientY - sliderState._sliderDrag.startY;
		let newLeft = sliderState._sliderDrag.startLeft + dx;
		let newBottom = sliderState._sliderDrag.startBottom - dy;
		newLeft = Math.max(0, Math.min(newLeft, parent.clientWidth - overlay.offsetWidth));
		newBottom = Math.max(0, Math.min(newBottom, parentH - overlay.offsetHeight));
		overlay.style.left = newLeft + "px";
		overlay.style.bottom = newBottom + "px";
	};
	const onUp = () => {
		sliderState._sliderDrag.active = false;
		overlay.classList.remove("dragging");
		document.removeEventListener("mousemove", onMove);
		document.removeEventListener("mouseup", onUp);
		const newLeft = parseFloat(overlay.style.left) || 0;
		const newBottom = parseFloat(overlay.style.bottom) || 0;
		try {
			localStorage.setItem("slider-overlay-pos", JSON.stringify({
				left: newLeft,
				bottom: newBottom
			}));
		} catch (e) {}
	};
	document.addEventListener("mousemove", onMove);
	document.addEventListener("mouseup", onUp);
}
function registerSliders(sliderDefs) {
	if (!sliderDefs || !Array.isArray(sliderDefs)) return {
		ids: [],
		prevStates: {}
	};
	const ids = [];
	const prevStates = {};
	for (const def of sliderDefs) {
		const prev = sliderState.sceneSliders[def.id];
		if (prev) {
			stopSliderLoop(def.id);
			if (def.reset) prevStates[def.id] = { ...prev };
		}
		sliderState.sceneSliders[def.id] = {
			value: def.default !== void 0 ? def.default : (def.min + def.max) / 2,
			min: def.min !== void 0 ? def.min : 0,
			max: def.max !== void 0 ? def.max : 1,
			step: def.step !== void 0 ? def.step : .1,
			label: def.label || def.id,
			default: def.default,
			animate: def.animate || false,
			animateMode: String(def.animateMode || def.animationMode || "loop").toLowerCase(),
			autoplay: def.autoplay !== false,
			duration: def.duration || 3e3,
			_loopPlaying: false,
			_loopRaf: null,
			_valueExprString: def.valueExpr || null,
			_valueExprCompiled: null
		};
		if (def.valueExpr) try {
			sliderState.sceneSliders[def.id]._valueExprCompiled = compileExpr(def.valueExpr);
		} catch (_e) {}
		ids.push(def.id);
	}
	for (const id of ids) {
		const s = sliderState.sceneSliders[id];
		if (s && s.animate && s.autoplay) startSliderLoop(id);
	}
	return {
		ids,
		prevStates
	};
}
function removeSliderIds(ids) {
	for (const id of ids) {
		stopSliderLoop(id);
		delete sliderState.sceneSliders[id];
	}
	if (sliderState.activeVirtualTimeExpr) try {
		sliderState.activeVirtualTimeCompiled = compileExpr(sliderState.activeVirtualTimeExpr);
	} catch (err) {
		console.warn("virtualTime recompile error:", err);
		sliderState.activeVirtualTimeCompiled = null;
	}
	syncSliderState();
}
function buildSliderOverlay() {
	const overlay = document.getElementById("slider-overlay");
	if (!overlay) return;
	const ids = getSliderIds();
	if (ids.length === 0) {
		overlay.classList.add("hidden");
		overlay.innerHTML = "";
		return;
	}
	overlay.innerHTML = "";
	try {
		const saved = JSON.parse(localStorage.getItem("slider-overlay-pos") || "null");
		if (saved && saved.left != null && saved.bottom != null) {
			overlay.style.left = saved.left + "px";
			overlay.style.bottom = saved.bottom + "px";
		}
	} catch (e) {}
	const dragHandle = document.createElement("div");
	dragHandle.className = "slider-drag-handle";
	dragHandle.textContent = "⠿ ⠿ ⠿";
	dragHandle.addEventListener("mousedown", (e) => setupSliderDrag(e, overlay));
	overlay.appendChild(dragHandle);
	for (const id of ids) {
		const s = sliderState.sceneSliders[id];
		const row = document.createElement("div");
		row.className = "slider-row";
		const labelSpan = document.createElement("span");
		labelSpan.className = "slider-label";
		labelSpan.innerHTML = renderKaTeX$1(s.label || id, false);
		labelSpan.title = stripLatex(s.label || id);
		row.appendChild(labelSpan);
		const input = document.createElement("input");
		input.type = "range";
		input.className = "slider-range";
		input.dataset.sliderId = id;
		input.min = String(s.min);
		input.max = String(s.max);
		input.step = String(s.step);
		input.value = String(s.value);
		row.appendChild(input);
		const valSpan = document.createElement("span");
		valSpan.className = "slider-value";
		valSpan.textContent = _formatSliderValue(s);
		row.appendChild(valSpan);
		input.addEventListener("input", () => {
			if (s._loopPlaying) stopSliderLoop(id);
			s.value = parseFloat(input.value);
			valSpan.textContent = _formatSliderValue(s);
			recompileActiveExprs();
			syncSliderState();
			try {
				window.dispatchEvent(new CustomEvent("algebench:sliderchange"));
			} catch (_) {}
		});
		if (s.animate) {
			const playBtn = document.createElement("button");
			playBtn.className = "slider-play-btn";
			playBtn.dataset.sliderId = id;
			const updatePlayBtn = () => {
				playBtn.textContent = s._loopPlaying ? "⏸" : "▶";
				playBtn.title = s._loopPlaying ? "Pause animation" : "Play animation";
			};
			s._onPlayStateChange = updatePlayBtn;
			updatePlayBtn();
			playBtn.addEventListener("click", () => {
				if (s._loopPlaying) stopSliderLoop(id);
				else startSliderLoop(id);
				updatePlayBtn();
			});
			row.appendChild(playBtn);
		}
		overlay.appendChild(row);
	}
	overlay.classList.remove("hidden");
	syncSliderState();
}
function unregisterAnimExpr(animState) {
	sliderState.activeAnimExprs = sliderState.activeAnimExprs.filter((e) => e.animState !== animState);
}
function unregisterAnimUpdater(animState) {
	sliderState.activeAnimUpdaters = sliderState.activeAnimUpdaters.filter((e) => e.animState !== animState);
}
function runAnimUpdaters(nowMs) {
	if (!sliderState.activeAnimUpdaters.length) return;
	const next = [];
	for (const entry of sliderState.activeAnimUpdaters) {
		if (!entry || !entry.animState || entry.animState.stopped) continue;
		try {
			entry.updateFrame(nowMs);
			next.push(entry);
		} catch (err) {
			console.warn("Animation updater error:", err);
		}
	}
	sliderState.activeAnimUpdaters = next;
}
function refreshActiveExprsForSliderValueChange() {
	for (const entry of sliderState.activeAnimExprs) {
		if (!entry || !entry.animState || entry.animState.stopped) continue;
		if (typeof entry._rebuildFn === "function") try {
			entry._rebuildFn();
		} catch (err) {
			console.warn("Slider reactive rebuild error:", err);
		}
	}
	if (typeof window._algebenchUpdateInfoOverlays === "function") window._algebenchUpdateInfoOverlays();
}
function recompileActiveExprs() {
	recompileActiveSceneFunctions();
	for (const s of Object.values(sliderState.sceneSliders)) if (s._valueExprString) try {
		s._valueExprCompiled = compileExpr(s._valueExprString);
	} catch (_e) {}
	for (const entry of sliderState.activeAnimExprs) {
		if (entry.animState.stopped) continue;
		if (typeof entry._rebuildFn === "function") {
			try {
				entry._rebuildFn();
			} catch (err) {
				console.warn("Slider parametric recompile error:", err);
			}
			continue;
		}
		try {
			entry.compiledFns = entry.exprStrings.map((e) => compileExpr(e));
		} catch (err) {
			console.warn("Slider recompile error:", err);
		}
		if (entry.fromExprStrings) try {
			entry.fromExprFns = entry.fromExprStrings.map((e) => compileExpr(e));
		} catch (err) {
			console.warn("Slider fromExpr recompile error:", err);
		}
		if (entry.radiusExprString) try {
			entry.radiusFn = compileExpr(entry.radiusExprString);
		} catch (err) {
			console.warn("Slider radiusExpr recompile error:", err);
		}
		if (entry.visibleExprString) try {
			entry.visibleFn = compileExpr(entry.visibleExprString);
		} catch (err) {
			console.warn("Slider visibleExpr recompile error:", err);
		}
		if (entry._isAnimatedPolygon && entry._vertexExprs) try {
			entry._compiledVerts = entry._vertexExprs.map((v) => v.map((e) => compileExpr(e)));
		} catch (err) {
			console.warn("Slider animated_polygon recompile error:", err);
		}
		if (entry._isRegularPolygon && entry._regExprs) try {
			const [nE, rE, cxE, cyE, czE, rotE] = entry._regExprs;
			entry._regState.cN = compileExpr(nE);
			entry._regState.cR = compileExpr(rE);
			entry._regState.cCx = compileExpr(cxE);
			entry._regState.cCy = compileExpr(cyE);
			entry._regState.cCz = compileExpr(czE);
			entry._regState.cRot = compileExpr(rotE);
		} catch (err) {
			console.warn("Slider regular polygon recompile error:", err);
		}
		if (entry._isAnimatedLine && entry._pointExprs) try {
			entry._compiledPoints = entry._pointExprs.map((p) => p.map((e) => compileExpr(e)));
		} catch (err) {
			console.warn("Slider animated_line recompile error:", err);
		}
	}
	if (sliderState.followCamState && sliderState.followCamState.exprStrings) {
		try {
			sliderState.followCamState.compiledExprs = sliderState.followCamState.exprStrings.map((e) => compileExpr(e));
		} catch (err) {
			console.warn("Follow-cam recompile error:", err);
		}
		if (sliderState.followCamState.fromExprStrings) try {
			sliderState.followCamState.compiledFromExprs = sliderState.followCamState.fromExprStrings.map((e) => compileExpr(e));
		} catch (err) {
			console.warn("Follow-cam fromExpr recompile error:", err);
		}
	}
	if (sliderState.activeVirtualTimeExpr) try {
		sliderState.activeVirtualTimeCompiled = compileExpr(sliderState.activeVirtualTimeExpr);
	} catch (err) {
		console.warn("virtualTime recompile error:", err);
		sliderState.activeVirtualTimeCompiled = null;
	}
	if (typeof window._algebenchUpdateInfoOverlays === "function") window._algebenchUpdateInfoOverlays();
}
function syncSliderState() {
	const s = {};
	for (const [id, sl] of Object.entries(sliderState.sceneSliders)) s[id] = sl.value;
	try {
		localStorage.setItem("algebench-sliders", JSON.stringify(s));
	} catch (e) {}
	if (typeof window._algebenchUpdateStatusBar === "function") window._algebenchUpdateStatusBar();
}
function setSliderValue(id, value) {
	const s = sliderState.sceneSliders[id];
	if (!s || !Number.isFinite(value)) return false;
	if (s._loopPlaying) stopSliderLoop(id);
	s.value = Math.max(s.min, Math.min(s.max, value));
	const input = document.querySelector(`input[data-slider-id="${id}"]`);
	if (input) {
		input.value = String(s.value);
		const valSpan = input.parentElement && input.parentElement.querySelector(".slider-value");
		if (valSpan) valSpan.textContent = _formatSliderValue(s);
	}
	recompileActiveExprs();
	syncSliderState();
	return true;
}
function animateSlider$1(id, target, duration) {
	return new Promise((resolve) => {
		const slider = sliderState.sceneSliders[id];
		if (!slider) {
			resolve(false);
			return;
		}
		target = Math.max(slider.min, Math.min(slider.max, target));
		const start = slider.value;
		if (start === target) {
			syncSliderState();
			resolve(true);
			return;
		}
		const startTime = performance.now();
		function tick(now) {
			const t = Math.min((now - startTime) / duration, 1);
			const eased = t < 1 ? t * (2 - t) : 1;
			slider.value = start + (target - start) * eased;
			const input = document.querySelector(`input[data-slider-id="${id}"]`);
			if (input) {
				input.value = String(slider.value);
				const valSpan = input.parentElement && input.parentElement.querySelector(".slider-value");
				if (valSpan) valSpan.textContent = _formatSliderValue(slider);
			}
			recompileActiveExprs();
			if (t < 1) requestAnimationFrame(tick);
			else {
				syncSliderState();
				resolve(true);
			}
		}
		requestAnimationFrame(tick);
	});
}
//#endregion
//#region src/dockable-panel.ts
var CORNERS = [
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right",
	"top-center",
	"bottom-center"
];
function _clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v));
}
/** Create a dockable panel. */
function createDockablePanel(opts) {
	const { persistKey, corner = "top-left", title = "", bodyEl, container, headerButtons = [], resizable = true, titleAlwaysVisible = false, minWidth = 120, minHeight = 36, opacity = 1, legacyMigrate = null, onCollapseChange = null } = opts;
	const KEY = "dockable-panel-" + persistKey;
	function loadGeom() {
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) return JSON.parse(raw);
		} catch {}
		if (legacyMigrate) try {
			const migrated = legacyMigrate();
			if (migrated) {
				saveGeom(migrated);
				return migrated;
			}
		} catch {}
		return null;
	}
	function saveGeom(g) {
		try {
			localStorage.setItem(KEY, JSON.stringify(g));
		} catch {}
	}
	const saved = loadGeom();
	const geom = {
		corner: saved && CORNERS.includes(saved.corner) ? saved.corner : CORNERS.includes(corner) ? corner : "top-left",
		h: saved && saved.h != null ? saved.h : null,
		v: saved && saved.v != null ? saved.v : null,
		w: saved && saved.w != null ? saved.w : null,
		ht: saved && saved.ht != null ? saved.ht : null,
		collapsed: !!(saved && saved.collapsed)
	};
	const el = document.createElement("div");
	el.className = "dockable-panel";
	if (titleAlwaysVisible) el.classList.add("title-always");
	el.style.opacity = String(opacity);
	const header = document.createElement("div");
	header.className = "dockable-panel-header";
	const caret = document.createElement("button");
	caret.type = "button";
	caret.className = "dp-collapse";
	caret.title = "Expand / collapse";
	caret.addEventListener("mousedown", (e) => e.stopPropagation());
	caret.addEventListener("click", (e) => {
		e.stopPropagation();
		setCollapsed(!geom.collapsed);
	});
	header.appendChild(caret);
	const titleEl = document.createElement("span");
	titleEl.className = "dp-title";
	titleEl.innerHTML = title || "";
	header.appendChild(titleEl);
	const btnWrap = document.createElement("span");
	btnWrap.className = "dp-buttons";
	for (const b of headerButtons) {
		b.addEventListener("mousedown", (e) => e.stopPropagation());
		btnWrap.appendChild(b);
	}
	header.appendChild(btnWrap);
	el.appendChild(header);
	const bodyContainer = document.createElement("div");
	bodyContainer.className = "dockable-panel-body";
	if (bodyEl) bodyContainer.appendChild(bodyEl);
	el.appendChild(bodyContainer);
	let grip = null;
	if (resizable) {
		grip = document.createElement("div");
		grip.className = "dp-resize";
		grip.title = "Resize";
		grip.addEventListener("mousedown", beginResize);
		el.appendChild(grip);
	}
	(container || document.body).appendChild(el);
	function applyGeom() {
		for (const c of CORNERS) el.classList.remove("pos-" + c);
		for (const c of CORNERS) el.classList.remove("anchor-" + c);
		el.style.left = el.style.right = el.style.top = el.style.bottom = el.style.transform = "";
		el.classList.add("anchor-" + geom.corner);
		el.style.width = geom.w ? geom.w + "px" : "";
		el.style.height = geom.ht && !geom.collapsed ? geom.ht + "px" : "";
		if (geom.h == null && geom.v == null) el.classList.add("pos-" + geom.corner);
		else {
			const isRight = geom.corner.includes("right");
			const isBottom = geom.corner.includes("bottom");
			if (isRight) el.style.right = geom.h + "px";
			else el.style.left = geom.h + "px";
			if (isBottom) el.style.bottom = geom.v + "px";
			else el.style.top = geom.v + "px";
		}
		el.classList.toggle("collapsed", !!geom.collapsed);
	}
	header.addEventListener("mousedown", (e) => {
		if (e.button !== 0) return;
		if (e.target.closest("button, .dp-resize")) return;
		beginDrag(e);
	});
	function pickCornerByProximity() {
		const parentRect = (container || el.offsetParent || document.body).getBoundingClientRect();
		const rect = el.getBoundingClientRect();
		const cx = rect.left + rect.width / 2 - parentRect.left;
		const cy = rect.top + rect.height / 2 - parentRect.top;
		const horiz = cx > parentRect.width / 2 ? "right" : "left";
		return (cy > parentRect.height / 2 ? "bottom" : "top") + "-" + horiz;
	}
	function beginDrag(e) {
		e.preventDefault();
		const parent = container || el.offsetParent || document.body;
		const startX = e.clientX, startY = e.clientY;
		const DRAG_THRESHOLD = 4;
		let moved = false;
		let isRight, isBottom, startH, startV, parentRect;
		function initDrag() {
			if (geom.corner.includes("center")) {
				const r = el.getBoundingClientRect();
				const isB = geom.corner.includes("bottom");
				geom.corner = (isB ? "bottom" : "top") + "-" + (r.left + r.width / 2 > window.innerWidth / 2 ? "right" : "left");
			}
			isRight = geom.corner.includes("right");
			isBottom = geom.corner.includes("bottom");
			const rect = el.getBoundingClientRect();
			parentRect = parent.getBoundingClientRect();
			startH = isRight ? parentRect.right - rect.right : rect.left - parentRect.left;
			startV = isBottom ? parentRect.bottom - rect.bottom : rect.top - parentRect.top;
			geom.h = startH;
			geom.v = startV;
			applyGeom();
			el.classList.add("dragging");
		}
		const onMove = (me) => {
			const dx = me.clientX - startX, dy = me.clientY - startY;
			if (!moved) {
				if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
				moved = true;
				initDrag();
			}
			let newH = isRight ? startH - dx : startH + dx;
			let newV = isBottom ? startV - dy : startV + dy;
			newH = _clamp(newH, 0, Math.max(0, parentRect.width - el.offsetWidth));
			newV = _clamp(newV, 0, Math.max(0, parentRect.height - el.offsetHeight));
			geom.h = newH;
			geom.v = newV;
			if (isRight) el.style.right = newH + "px";
			else el.style.left = newH + "px";
			if (isBottom) el.style.bottom = newV + "px";
			else el.style.top = newV + "px";
		};
		const onUp = () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			if (!moved) {
				setCollapsed(!geom.collapsed);
				return;
			}
			el.classList.remove("dragging");
			const newCorner = pickCornerByProximity();
			geom.corner = newCorner;
			const nowRight = newCorner.includes("right");
			const nowBottom = newCorner.includes("bottom");
			const rect = el.getBoundingClientRect();
			const pr = parent.getBoundingClientRect();
			geom.h = Math.max(0, nowRight ? pr.right - rect.right : rect.left - pr.left);
			geom.v = Math.max(0, nowBottom ? pr.bottom - rect.bottom : rect.top - pr.top);
			applyGeom();
			saveGeom(geom);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	}
	function beginResize(e) {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		if (geom.collapsed) return;
		const isRight = geom.corner.includes("right");
		const isBottom = geom.corner.includes("bottom");
		const rect = el.getBoundingClientRect();
		const startW = rect.width, startHt = rect.height;
		const startX = e.clientX, startY = e.clientY;
		const capW = () => Math.min(window.innerWidth * .9, 1e3);
		const capH = () => window.innerHeight * .9;
		el.classList.add("resizing");
		const onMove = (me) => {
			const dx = me.clientX - startX, dy = me.clientY - startY;
			let newW = isRight ? startW - dx : startW + dx;
			let newHt = isBottom ? startHt - dy : startHt + dy;
			newW = _clamp(newW, minWidth, capW());
			newHt = _clamp(newHt, minHeight, capH());
			geom.w = Math.round(newW);
			geom.ht = Math.round(newHt);
			el.style.width = geom.w + "px";
			el.style.height = geom.ht + "px";
		};
		const onUp = () => {
			el.classList.remove("resizing");
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			saveGeom(geom);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	}
	function setCollapsed(c) {
		geom.collapsed = !!c;
		el.classList.toggle("collapsed", geom.collapsed);
		el.style.height = !geom.collapsed && geom.ht ? geom.ht + "px" : "";
		saveGeom(geom);
		if (onCollapseChange) onCollapseChange(geom.collapsed);
	}
	applyGeom();
	return {
		el,
		bodyContainer,
		headerEl: header,
		setTitle(html) {
			titleEl.innerHTML = html || "";
		},
		setCollapsed,
		isCollapsed() {
			return !!geom.collapsed;
		},
		getCorner() {
			return geom.corner;
		},
		setOpacity(o) {
			el.style.opacity = String(o);
		},
		destroy() {
			el.remove();
		}
	};
}
//#endregion
//#region src/overlay.ts
var overlayState = state;
function updateExplanationPanel(spec) {
	const panel = document.getElementById("explanation-panel");
	const content = document.getElementById("explanation-content");
	const handle = document.getElementById("panel-resize-handle");
	const toggle = document.getElementById("explain-toggle");
	if (spec && spec.markdown) {
		content.innerHTML = renderMarkdown$1(spec.markdown);
		content.dataset.markdown = spec.markdown;
		injectAskButtons(content);
	} else content.innerHTML = "<p style=\"color: rgba(180,180,200,0.5); font-style: italic;\">No explanation available for this scene.</p>";
	panel.classList.remove("hidden");
	handle.style.display = "block";
	toggle.style.display = "block";
	toggle.classList.add("active");
	const savedWidth = localStorage.getItem("algebench-panel-width");
	if (savedWidth) {
		const w = parseInt(savedWidth);
		if (w >= 250 && w <= 600) panel.style.width = w + "px";
	}
	setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
}
function setupPanelResize() {
	const handle = document.getElementById("panel-resize-handle");
	const panel = document.getElementById("explanation-panel");
	let dragging = false;
	let startX, startWidth;
	handle.addEventListener("mousedown", (e) => {
		e.preventDefault();
		dragging = true;
		startX = e.clientX;
		startWidth = panel.offsetWidth;
		handle.classList.add("dragging");
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
	});
	document.addEventListener("mousemove", (e) => {
		if (!dragging) return;
		const dx = startX - e.clientX;
		let newWidth = Math.max(250, Math.min(600, startWidth + dx));
		panel.style.width = newWidth + "px";
		window.dispatchEvent(new Event("resize"));
	});
	document.addEventListener("mouseup", () => {
		if (!dragging) return;
		dragging = false;
		handle.classList.remove("dragging");
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
		localStorage.setItem("algebench-panel-width", String(panel.offsetWidth));
	});
}
function setupExplainToggle() {
	const toggle = document.getElementById("explain-toggle");
	const panel = document.getElementById("explanation-panel");
	const handle = document.getElementById("panel-resize-handle");
	toggle.addEventListener("click", () => {
		const isHidden = panel.classList.toggle("hidden");
		toggle.classList.toggle("active", !isHidden);
		handle.style.display = isHidden ? "none" : "block";
		if (!isHidden && typeof window.refreshProofPanel === "function") window.refreshProofPanel();
		setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
	});
	document.addEventListener("keydown", (e) => {
		const target = e.target;
		if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
		if (e.key === "e" && !e.ctrlKey && !e.metaKey && !e.altKey) {
			if (overlayState.currentSpec && overlayState.currentSpec.markdown && toggle.style.display !== "none") toggle.click();
		}
	});
}
function setupDocSpeakButtons() {
	const speakBtn = document.getElementById("doc-speak-btn");
	const commentateBtn = document.getElementById("doc-commentate-btn");
	if (!speakBtn || !commentateBtn) return;
	if (document.body.dataset.debugMode !== "true") speakBtn.style.display = "none";
	function resetSpeakBtn() {
		speakBtn.textContent = "🔊 Speak";
		speakBtn.classList.remove("active");
	}
	speakBtn.addEventListener("click", () => {
		if (speakBtn.classList.contains("active")) {
			if (typeof window.algebenchStopTTS === "function") window.algebenchStopTTS();
			resetSpeakBtn();
			return;
		}
		const contentEl = document.getElementById("explanation-content");
		const text = overlayState.currentSpec && overlayState.currentSpec.markdown ? overlayState.currentSpec.markdown : contentEl.dataset.markdown || contentEl.textContent;
		if (!text || !text.trim()) return;
		if (typeof window.algebenchSpeakText === "function") {
			speakBtn.textContent = "⏹ Stop";
			speakBtn.classList.add("active");
			window.algebenchSpeakText(text, resetSpeakBtn);
		}
	});
	commentateBtn.addEventListener("click", () => {
		if (typeof sendChatMessage !== "function") return;
		if (speakBtn.classList.contains("active")) {
			if (typeof window.algebenchStopTTS === "function") window.algebenchStopTTS();
			resetSpeakBtn();
		}
		const panel = document.getElementById("explanation-panel");
		const handle = document.getElementById("panel-resize-handle");
		const toggle = document.getElementById("explain-toggle");
		if (panel.classList.contains("hidden")) {
			panel.classList.remove("hidden");
			handle.style.display = "block";
			toggle.style.display = "block";
			toggle.classList.add("active");
			setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
		}
		if (typeof switchPanelTab === "function") switchPanelTab("chat");
		sendChatMessage("Please commentate on the Documentation of this scene. Specifically go into the details of how the visualization ties to the equations that we see in the Documentation.");
	});
}
function updateTitle(spec) {
	const titleEl = document.getElementById("scene-title");
	const descEl = document.getElementById("scene-description");
	const sourceEl = document.getElementById("scene-source-file");
	if (spec && spec.title) titleEl.innerHTML = renderKaTeX$1(spec.title, false);
	else titleEl.innerHTML = "AlgeBench";
	if (spec && spec.description) {
		descEl.innerHTML = renderKaTeX$1(spec.description, false);
		descEl.dataset.markdown = spec.description;
		const descText = spec.description;
		const btn = makeAiAskButton("ai-ask-btn", "Ask AI to explain this scene", () => "Can you explain this scene:\n" + descText.trim());
		descEl.appendChild(btn);
		resetSceneDescPosition(descEl);
	} else if (spec && spec.title) descEl.innerHTML = "";
	else descEl.innerHTML = "Load a scene to begin";
	if (sourceEl) {
		sourceEl.textContent = overlayState.currentSceneSourceLabel ? `- ${overlayState.currentSceneSourceLabel}` : "- no file";
		sourceEl.title = overlayState.currentSceneSourcePath || "";
	}
}
function buildLegend(elements) {
	const legend = document.getElementById("legend");
	const grouped = /* @__PURE__ */ new Map();
	for (const el of elements) {
		if (el.type === "axis" || el.type === "grid") continue;
		const groupLabel = el.legendGroup || el.label;
		if (!groupLabel || !el.color) continue;
		const key = `${groupLabel}__${colorToCSS(el.color)}`;
		if (!grouped.has(key)) grouped.set(key, {
			label: el.label || null,
			color: el.color,
			ids: []
		});
		if (el.label && !grouped.get(key).label) grouped.get(key).label = el.label;
		if (el.id) grouped.get(key).ids.push(el.id);
	}
	for (const [key, val] of grouped) if (!val.label) grouped.delete(key);
	const items = [...grouped.values()];
	if (items.length === 0) {
		legend.classList.add("hidden");
		return;
	}
	legend.classList.remove("hidden");
	legend.innerHTML = "";
	for (const it of items) {
		const clickableIds = (it.ids || []).filter((id) => overlayState.elementRegistry[id]);
		const hidden = clickableIds.length > 0 && clickableIds.every((id) => overlayState.legendToggledOff.has(id));
		const div = document.createElement("div");
		div.className = "legend-item" + (clickableIds.length ? " legend-clickable" : "") + (hidden ? " legend-hidden" : "");
		if (clickableIds.length) div.dataset.elementIds = clickableIds.join(",");
		const swatch = document.createElement("div");
		swatch.className = "legend-swatch";
		swatch.style.background = colorToCSS(it.color);
		if (hidden) swatch.style.opacity = "0.3";
		div.appendChild(swatch);
		const span = document.createElement("span");
		span.innerHTML = renderKaTeX$1(it.label, false);
		div.appendChild(span);
		legend.appendChild(div);
	}
	for (const div of legend.querySelectorAll(".legend-clickable")) div.addEventListener("click", () => {
		const elIds = (div.dataset.elementIds || "").split(",").map((s) => s.trim()).filter(Boolean).filter((id) => overlayState.elementRegistry[id]);
		if (elIds.length === 0) return;
		if (elIds.every((id) => overlayState.legendToggledOff.has(id))) {
			for (const elId of elIds) {
				overlayState.legendToggledOff.delete(elId);
				if (typeof window._algebenchShowElementById === "function") window._algebenchShowElementById(elId);
			}
			div.classList.remove("legend-hidden");
			div.querySelector(".legend-swatch").style.opacity = "";
		} else {
			for (const elId of elIds) {
				overlayState.legendToggledOff.add(elId);
				if (typeof window._algebenchHideElementById === "function") window._algebenchHideElementById(elId);
			}
			div.classList.add("legend-hidden");
			div.querySelector(".legend-swatch").style.opacity = "0.3";
		}
	});
	for (const id of [...state.legendToggledOff]) if (!overlayState.elementRegistry[id]) overlayState.legendToggledOff.delete(id);
	else if (!overlayState.elementRegistry[id].hidden) {
		if (typeof window._algebenchHideElementById === "function") window._algebenchHideElementById(id);
	}
}
var infoState = {
	forcedMode: null,
	mode: "free",
	items: {},
	drawerPanel: null,
	drawerBodyEl: null,
	_routeScheduled: false,
	_pendingDrawerCorner: null
};
function _fmtNum(val) {
	if (typeof val === "string") return val;
	if (!isFinite(val)) return String(val);
	const n = Number(val);
	if (Number.isInteger(n)) return String(n);
	return parseFloat(n.toFixed(3)).toString();
}
function _isKnownInfoExprIdentifier(name) {
	if (!name) return false;
	if (Object.prototype.hasOwnProperty.call(overlayState.sceneSliders, name)) return true;
	if (Object.prototype.hasOwnProperty.call(overlayState.activeSceneExprFunctions, name)) return true;
	if (window.agentMemoryValues && Object.prototype.hasOwnProperty.call(window.agentMemoryValues, name)) return true;
	if (name === "t" || name === "u" || name === "v") return true;
	if (name === "pi" || name === "e" || name === "PI" || name === "E") return true;
	if (name === "true" || name === "false" || name === "Infinity" || name === "NaN") return true;
	if (EXTENSION_NAMES.includes(name)) return true;
	return _getMathNamesAndValues().names.includes(name);
}
function _exprHasUnknownIdentifiers(expr) {
	const matches = String(expr).replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ").match(/[A-Za-z_][A-Za-z0-9_]*/g);
	if (!matches) return false;
	for (const id of matches) if (!_isKnownInfoExprIdentifier(id)) return true;
	return false;
}
function _evalInfoExpr(expr) {
	const trimmed = String(expr || "").trim();
	if (!trimmed) return "";
	if (_exprHasUnknownIdentifiers(trimmed)) return "?";
	const memScope = window.agentMemoryValues && typeof window.agentMemoryValues === "object" ? window.agentMemoryValues : null;
	try {
		return _fmtNum(evalExpr(compileExpr(trimmed), 0, { extraScope: memScope }));
	} catch {
		if (overlayState._sceneJsTrustState === "trusted") try {
			const ids = getSliderIds();
			const memNames = memScope ? Object.keys(memScope) : [];
			const { names, vals: mathVals } = _getMathNamesAndValues();
			const fn = Function("t", ...ids, ...memNames, ...names, "return (" + trimmed + ")");
			const sliderVals = ids.map((id) => {
				const s = overlayState.sceneSliders[id];
				return s ? s.value : 0;
			});
			const memVals = memNames.map((k) => memScope[k]);
			return _fmtNum(fn(0, ...sliderVals, ...memVals, ...mathVals));
		} catch {}
		return "?";
	}
}
function _replaceDoubleBraceExprs(template, evaluator) {
	if (typeof template !== "string" || template.indexOf("{{") === -1) return template;
	return template.replace(/\{\{([\s\S]*?)\}\}/g, (_m, expr) => {
		const v = evaluator(expr);
		return v == null ? _m : String(v);
	});
}
function resolveInfoContent(template) {
	return _replaceDoubleBraceExprs(template, (expr) => _evalInfoExpr(expr));
}
function updateInfoOverlays$1() {
	for (const item of Object.values(infoState.items)) {
		if (!item.contentEl) continue;
		const resolved = resolveInfoContent(item.content);
		item.contentEl.innerHTML = renderKaTeX$1(resolved, false);
		const titleHtml = _titleHtml(item);
		if (item.panel) item.panel.setTitle(titleHtml);
		if (item.sectionTitleEl) item.sectionTitleEl.innerHTML = titleHtml;
	}
	_updateDrawerHeader();
}
window._algebenchUpdateInfoOverlays = updateInfoOverlays$1;
function _infoContainer() {
	return document.getElementById("info-overlays");
}
function _deriveTitle(content) {
	const lines = String(content || "").split("\n");
	for (let ln of lines) {
		ln = ln.trim();
		if (!ln) continue;
		ln = ln.replace(/^#{1,6}\s*/, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^[*_>\s-]+/, "").replace(/[*_]+$/, "").trim();
		if (ln) return ln;
	}
	return "Info";
}
function _titleHtml(item) {
	return renderKaTeX$1(resolveInfoContent(item.explicitTitle ? item.title : _deriveTitle(item.content)), false);
}
function _loadPlacement(id) {
	try {
		const v = localStorage.getItem("info-item-placement-" + id);
		return v === "free" || v === "drawer" ? v : null;
	} catch {
		return null;
	}
}
function _savePlacement(id, placement) {
	try {
		localStorage.setItem("info-item-placement-" + id, placement);
	} catch {}
}
function _loadSectionCollapsed() {
	try {
		return JSON.parse(localStorage.getItem("info-drawer-sections") || "{}") || {};
	} catch {
		return {};
	}
}
function _saveSectionCollapsed(map) {
	try {
		localStorage.setItem("info-drawer-sections", JSON.stringify(map));
	} catch {}
}
function _migrateOldOverlayKeys(id) {
	let geom = null;
	try {
		const raw = localStorage.getItem("info-overlay-pos-" + id);
		const saved = raw ? JSON.parse(raw) : null;
		if (saved && saved.pos && saved.h != null && saved.v != null) geom = {
			corner: saved.pos,
			h: saved.h,
			v: saved.v
		};
		else if (saved && saved.left && saved.top) geom = {
			corner: "top-left",
			h: parseFloat(saved.left) || 0,
			v: parseFloat(saved.top) || 0
		};
	} catch {}
	try {
		if (localStorage.getItem("info-overlay-collapsed-" + id) === "1") {
			geom = geom || { corner: "top-left" };
			geom.collapsed = true;
		}
	} catch {}
	return geom;
}
function _makeItemAiBtn(item) {
	return makeAiAskButton("info-overlay-ai-btn", "Ask AI about this", () => "Can you explain this:\n" + resolveInfoContent(item.content).trim());
}
function _makeDockBtn(item) {
	const b = document.createElement("button");
	b.type = "button";
	b.className = "info-dock-btn";
	b.title = "Move into drawer";
	b.textContent = "⤵";
	b.addEventListener("mousedown", (e) => e.stopPropagation());
	b.addEventListener("click", (e) => {
		e.stopPropagation();
		const corner = item.panel ? item.panel.getCorner() : item.position;
		_setItemPlacement(item.id, "drawer", corner);
	});
	return b;
}
function _makePopBtn(item) {
	const b = document.createElement("button");
	b.type = "button";
	b.className = "info-dock-btn";
	b.title = "Pop out of drawer";
	b.textContent = "⤴";
	b.addEventListener("mousedown", (e) => e.stopPropagation());
	b.addEventListener("click", (e) => {
		e.stopPropagation();
		_setItemPlacement(item.id, "free", null);
	});
	return b;
}
function _setItemPlacement(id, placement, inheritCorner) {
	if (!infoState.items[id]) return;
	_savePlacement(id, placement);
	if (placement === "drawer" && inheritCorner) infoState._pendingDrawerCorner = inheritCorner;
	_route();
}
function _mountFree(item) {
	if (item.panel) {
		if (item.contentEl.parentElement !== item.freeInner) item.freeInner.appendChild(item.contentEl);
		return;
	}
	const inner = document.createElement("div");
	inner.className = "info-overlay";
	inner.appendChild(item.contentEl);
	item.freeInner = inner;
	item.panel = createDockablePanel({
		persistKey: "info-" + item.id,
		corner: item.position,
		title: _titleHtml(item),
		bodyEl: inner,
		container: _infoContainer(),
		headerButtons: [_makeItemAiBtn(item), _makeDockBtn(item)],
		titleAlwaysVisible: !!item.explicitTitle,
		opacity: overlayState.displayParams.overlayOpacity,
		legacyMigrate: () => _migrateOldOverlayKeys(item.id)
	});
}
function _unmountFree(item) {
	if (!item.panel) return;
	if (item.contentEl.parentElement) item.contentEl.parentElement.removeChild(item.contentEl);
	item.panel.destroy();
	item.panel = null;
	item.freeInner = null;
}
function _chooseDrawerCorner(items) {
	if (infoState._pendingDrawerCorner) return infoState._pendingDrawerCorner;
	const counts = {};
	let best = "top-right", bestN = 0;
	for (const it of items) {
		if (it.placement !== "drawer") continue;
		const c = it.position || "top-right";
		counts[c] = (counts[c] || 0) + 1;
		if (counts[c] > bestN) {
			bestN = counts[c];
			best = c;
		}
	}
	return best;
}
var _CHEVRON_UP = "<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"17 12 12 7 7 12\"/><polyline points=\"17 18 12 13 7 18\"/></svg>";
var _CHEVRON_DOWN = "<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"7 12 12 17 17 12\"/><polyline points=\"7 6 12 11 17 6\"/></svg>";
function _makeDrawerIconBtn(glyph, title, onClick) {
	const b = document.createElement("button");
	b.type = "button";
	b.className = "info-dock-btn";
	b.title = title;
	if (glyph.trimStart().startsWith("<")) b.innerHTML = glyph;
	else b.textContent = glyph;
	b.addEventListener("mousedown", (e) => e.stopPropagation());
	b.addEventListener("click", (e) => {
		e.stopPropagation();
		onClick();
	});
	return b;
}
function _setAllSectionsCollapsed(collapsed) {
	const map = _loadSectionCollapsed();
	for (const item of Object.values(infoState.items)) if (item.placement === "drawer" && item.sectionEl) {
		item.sectionEl.classList.toggle("collapsed", collapsed);
		map[item.id] = collapsed;
	}
	_saveSectionCollapsed(map);
}
function _ensureDrawer(corner) {
	if (infoState.drawerPanel) return;
	const body = document.createElement("div");
	body.className = "info-drawer";
	infoState.drawerBodyEl = body;
	const collapseAllBtn = _makeDrawerIconBtn(_CHEVRON_UP, "Collapse all sections", () => _setAllSectionsCollapsed(true));
	const expandAllBtn = _makeDrawerIconBtn(_CHEVRON_DOWN, "Expand all sections", () => _setAllSectionsCollapsed(false));
	const dissolveBtn = _makeDrawerIconBtn("⤴", "Pop all overlays out of the drawer", () => _dissolveDrawer());
	infoState.drawerPanel = createDockablePanel({
		persistKey: "info-drawer",
		corner: corner || "top-right",
		title: "Info",
		bodyEl: body,
		container: _infoContainer(),
		headerButtons: [
			collapseAllBtn,
			expandAllBtn,
			dissolveBtn
		],
		titleAlwaysVisible: true,
		opacity: overlayState.displayParams.overlayOpacity
	});
	infoState.drawerPanel.el.classList.add("dp-drawer");
}
function _destroyDrawerIfEmpty() {
	if (!infoState.drawerPanel) return;
	if (Object.values(infoState.items).some((it) => it.placement === "drawer")) return;
	infoState.drawerPanel.destroy();
	infoState.drawerPanel = null;
	infoState.drawerBodyEl = null;
}
function _dissolveDrawer() {
	for (const item of Object.values(infoState.items)) if (item.placement === "drawer") _savePlacement(item.id, "free");
	_route();
}
function _mountSection(item) {
	if (item.sectionEl) {
		if (item.contentEl.parentElement !== item.sectionBodyEl) item.sectionBodyEl.appendChild(item.contentEl);
		if (item.sectionEl.parentElement !== infoState.drawerBodyEl) infoState.drawerBodyEl.appendChild(item.sectionEl);
		return;
	}
	const section = document.createElement("div");
	section.className = "info-drawer-section";
	if (item.explicitTitle) section.classList.add("title-always");
	const header = document.createElement("div");
	header.className = "info-drawer-section-header";
	const caret = document.createElement("button");
	caret.type = "button";
	caret.className = "dp-collapse";
	caret.title = "Expand / collapse";
	const titleEl = document.createElement("span");
	titleEl.className = "info-drawer-section-title";
	titleEl.innerHTML = _titleHtml(item);
	const btns = document.createElement("span");
	btns.className = "info-drawer-section-buttons";
	btns.appendChild(_makeItemAiBtn(item));
	btns.appendChild(_makePopBtn(item));
	header.appendChild(caret);
	header.appendChild(titleEl);
	header.appendChild(btns);
	const sBody = document.createElement("div");
	sBody.className = "info-drawer-section-body";
	sBody.appendChild(item.contentEl);
	const collapsed = !!_loadSectionCollapsed()[item.id];
	section.classList.toggle("collapsed", collapsed);
	header.addEventListener("click", (e) => {
		if (e.target.closest(".info-dock-btn, .info-overlay-ai-btn")) return;
		const nowCollapsed = !section.classList.contains("collapsed");
		section.classList.toggle("collapsed", nowCollapsed);
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
	const n = Object.values(infoState.items).filter((it) => it.placement === "drawer").length;
	infoState.drawerPanel.setTitle("Info <span class=\"info-drawer-count\">" + n + "</span>");
}
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
	const mode = infoState.forcedMode || (count > 3 ? "drawer" : "free");
	infoState.mode = mode;
	let anyDrawer = false;
	for (const item of items) {
		item.placement = _loadPlacement(item.id) || (mode === "drawer" ? "drawer" : "free");
		if (item.placement === "drawer") anyDrawer = true;
	}
	if (anyDrawer) _ensureDrawer(_chooseDrawerCorner(items));
	infoState._pendingDrawerCorner = null;
	for (const item of items) if (item.placement === "drawer") {
		_unmountFree(item);
		_mountSection(item);
	} else {
		_unmountSection(item);
		_mountFree(item);
	}
	_destroyDrawerIfEmpty();
	updateInfoOverlays$1();
}
function removeStepInfoOverlays() {
	let changed = false;
	for (const id of Object.keys(infoState.items)) {
		const item = infoState.items[id];
		if (item.stepDefined && !item.keep) {
			_disposeItem(item);
			changed = true;
		}
	}
	if (changed) _scheduleRoute();
}
function addInfoOverlay$1(id, content, position, stepDefined = false, keep = false, title = null) {
	if (!_infoContainer()) return;
	if (!id) {
		const preview = typeof content === "string" ? content.length > 80 ? content.slice(0, 80) + "…" : content : void 0;
		console.warn("addInfoOverlay: id is required; ignoring overlay", {
			position,
			contentPreview: preview
		});
		return;
	}
	let item = infoState.items[id];
	if (!item) {
		const contentEl = document.createElement("div");
		contentEl.className = "info-overlay-content";
		item = infoState.items[id] = {
			id,
			contentEl,
			panel: null,
			freeInner: null,
			sectionEl: null,
			sectionBodyEl: null,
			sectionTitleEl: null,
			placement: "free"
		};
	}
	item.content = content;
	item.title = title || null;
	item.explicitTitle = !!title;
	item.position = position || "top-left";
	item.stepDefined = stepDefined;
	item.keep = keep;
	_scheduleRoute();
}
function _disposeItem(item) {
	_unmountFree(item);
	_unmountSection(item);
	delete infoState.items[item.id];
}
function removeInfoOverlay(id) {
	const item = infoState.items[id];
	if (!item) return;
	_disposeItem(item);
	_scheduleRoute();
}
function removeAllInfoOverlays$1() {
	for (const id of Object.keys(infoState.items)) _disposeItem(infoState.items[id]);
	if (infoState.drawerPanel) {
		infoState.drawerPanel.destroy();
		infoState.drawerPanel = null;
		infoState.drawerBodyEl = null;
	}
}
function getAllElements$1(scene, stepIdx) {
	let elements = [...scene.elements || []];
	const removedIds = /* @__PURE__ */ new Set();
	const removedTypes = /* @__PURE__ */ new Set();
	let removeAll = false;
	if (scene.steps) for (let i = 0; i <= stepIdx; i++) {
		const step = scene.steps[i];
		if (step.remove) {
			for (const item of step.remove) if (item.id === "*" || item.type === "*") removeAll = true;
			else if (item.id) removedIds.add(item.id);
			else if (item.type) removedTypes.add(item.type);
		}
		if (removeAll || removedIds.size > 0 || removedTypes.size > 0) {
			elements = elements.filter((el) => {
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
	return elements;
}
function updateStatusBar() {
	if (!document.getElementById("status-bar")) return;
	if (typeof window._algebenchUpdateJsTrustPill === "function") window._algebenchUpdateJsTrustPill();
	const pill = document.getElementById("slider-status");
	const countEl = pill && pill.querySelector(".slider-status-count");
	const tooltipEl = pill && pill.querySelector(".slider-status-tooltip");
	const ids = Object.keys(overlayState.sceneSliders);
	if (pill) {
		if (ids.length > 0) {
			if (countEl) countEl.textContent = String(ids.length);
			if (tooltipEl) tooltipEl.textContent = ids.map((id) => {
				const s = overlayState.sceneSliders[id];
				return `${(s.label || id).replace(/\$|\\[a-z]+\{?|\}|_|\^/gi, "").trim() || id} (${id}) = ${Number(s.value).toFixed(2)}  [${s.min} … ${s.max}]`;
			}).join("\n");
			pill.classList.remove("hidden");
		} else pill.classList.add("hidden");
	}
	const camPopup = document.getElementById("cam-popup-content");
	const camPopupText = document.getElementById("cam-popup-text");
	if (camPopup && overlayState.camera && overlayState.controls) {
		const pw = overlayState.camera.position;
		const tw = overlayState.controls.target;
		const u = overlayState.camera.up;
		const p = worldCameraToData$1([
			pw.x,
			pw.y,
			pw.z
		]);
		const t = worldCameraToData$1([
			tw.x,
			tw.y,
			tw.z
		]);
		const dist = Math.sqrt((p[0] - t[0]) ** 2 + (p[1] - t[1]) ** 2 + (p[2] - t[2]) ** 2);
		const fov = overlayState.camera.isPerspectiveCamera ? overlayState.camera.fov : null;
		const fmt = (v) => v.toFixed(3);
		const activeViewBtn = document.querySelector(".cam-btn.active");
		const viewName = activeViewBtn ? activeViewBtn.dataset.view : null;
		let txt = "";
		if (viewName) txt += `view ${viewName}\n`;
		txt += `pos  x: ${fmt(p[0])}  y: ${fmt(p[1])}  z: ${fmt(p[2])}\ntgt  x: ${fmt(t[0])}  y: ${fmt(t[1])}  z: ${fmt(t[2])}\nup   x: ${fmt(u.x)}  y: ${fmt(u.y)}  z: ${fmt(u.z)}\ndist ${dist.toFixed(3)}`;
		if (fov != null) txt += `\nfov  ${Math.round(fov)}°`;
		if (camPopupText) camPopupText.textContent = txt;
		else camPopup.textContent = txt;
	}
	const debugText = document.getElementById("debug-status-text");
	if (debugText) {
		const sceneNum = overlayState.currentSceneIndex + 1;
		const totalScenes = overlayState.lessonSpec && overlayState.lessonSpec.scenes ? overlayState.lessonSpec.scenes.length : "?";
		const stepNum = overlayState.currentStepIndex + 1;
		const scene = overlayState.lessonSpec && overlayState.lessonSpec.scenes ? overlayState.lessonSpec.scenes[overlayState.currentSceneIndex] : null;
		debugText.textContent = `scene ${sceneNum}/${totalScenes}  step ${stepNum}/${scene && scene.steps ? scene.steps.length : 0}`;
	}
}
window._algebenchUpdateStatusBar = updateStatusBar;
function setupSettingsPanel() {
	const toggle = document.getElementById("settings-toggle");
	const panel = document.getElementById("settings-panel");
	toggle.innerHTML = GEAR_ICON;
	toggle.addEventListener("click", () => {
		panel.classList.toggle("hidden");
		toggle.classList.toggle("active");
	});
	const paletteSel = document.getElementById("palette-select");
	const PALETTE_KEY = "algebench-palette";
	const PALETTES = [
		"blueprint",
		"sepia",
		"plum",
		"cerulean",
		"graphite",
		"contrast"
	];
	if (paletteSel) {
		paletteSel.value = document.documentElement.dataset.palette || "slate";
		paletteSel.addEventListener("change", () => {
			const v = paletteSel.value;
			if (PALETTES.includes(v)) {
				document.documentElement.dataset.palette = v;
				try {
					localStorage.setItem(PALETTE_KEY, v);
				} catch (e) {}
			} else {
				delete document.documentElement.dataset.palette;
				try {
					localStorage.removeItem(PALETTE_KEY);
				} catch (e) {}
			}
			applyCanvasClearColor();
		});
	}
	const momentumSlider = document.getElementById("momentum-slider");
	const valMomentum = document.getElementById("val-momentum");
	const MOMENTUM_KEY = "algebench-momentum";
	const savedMomentum = parseFloat(String(localStorage.getItem(MOMENTUM_KEY)));
	if (!isNaN(savedMomentum)) overlayState.arcballMomentum = Math.max(0, Math.min(1, savedMomentum));
	if (momentumSlider) {
		momentumSlider.value = String(Math.round(overlayState.arcballMomentum * 100));
		if (valMomentum) valMomentum.textContent = Math.round(overlayState.arcballMomentum * 100) + "%";
		momentumSlider.addEventListener("input", () => {
			overlayState.arcballMomentum = Number(momentumSlider.value) / 100;
			if (valMomentum) valMomentum.textContent = Math.round(overlayState.arcballMomentum * 100) + "%";
			localStorage.setItem(MOMENTUM_KEY, String(overlayState.arcballMomentum));
		});
	}
	for (const [key, val] of Object.entries(overlayState.displayParams)) {
		const el = document.getElementById("val-" + key);
		if (el) el.textContent = val.toFixed(1);
	}
	const _iniOp = overlayState.displayParams.overlayOpacity;
	const _sliderOv = document.getElementById("slider-overlay");
	const _legend = document.getElementById("legend");
	if (_sliderOv) _sliderOv.style.opacity = String(_iniOp);
	if (_legend) _legend.style.opacity = String(_iniOp);
	const isOpacity = (p) => p.endsWith("Opacity");
	panel.querySelectorAll(".sp-btn").forEach((btn) => {
		btn.addEventListener("click", () => {
			const param = btn.dataset.param;
			const dir = btn.dataset.dir === "+" ? 1 : -1;
			const step = isOpacity(param) ? .1 : .2;
			const min = isOpacity(param) ? 0 : .2;
			const max = isOpacity(param) ? 1 : 5;
			let val = overlayState.displayParams[param] + dir * step;
			val = Math.round(Math.max(min, Math.min(max, val)) * 10) / 10;
			overlayState.displayParams[param] = val;
			document.getElementById("val-" + param).textContent = val.toFixed(1);
			if (param === "labelOpacity") document.querySelectorAll(".label-3d").forEach((el) => {
				el.style.opacity = String(val);
			});
			else if (param === "arrowScale") {
				if (typeof window._algebenchApplyArrowScale === "function") window._algebenchApplyArrowScale(val);
			} else if (param === "arrowOpacity") for (const entry of overlayState.arrowMeshes) {
				if (entry.isShaft) continue;
				const baseOp = entry.mesh && entry.mesh.userData && typeof entry.mesh.userData.baseOpacity === "number" ? entry.mesh.userData.baseOpacity : 1;
				const targetOp = Math.max(0, Math.min(1, baseOp * val));
				entry.mesh.material.opacity = targetOp;
				entry.mesh.material.transparent = targetOp < 1;
			}
			else if (param === "axisWidth") {
				if (typeof window._algebenchApplyLineWidth === "function") for (const entry of overlayState.axisLineNodes) window._algebenchApplyLineWidth(entry);
			} else if (param === "axisOpacity") for (const entry of overlayState.axisLineNodes) {
				const baseOp = entry && typeof entry.baseOpacity === "number" ? entry.baseOpacity : 1;
				entry.node.set("opacity", baseOp * val);
			}
			else if (param === "vectorWidth") {
				if (typeof window._algebenchApplyShaftThickness === "function" && typeof window._algebenchApplyLineWidth === "function") {
					for (const entry of overlayState.arrowMeshes) {
						if (!window._algebenchIsShaftEntry || !window._algebenchIsShaftEntry(entry)) continue;
						if (entry.mesh && entry.mesh.userData && entry.mesh.userData.dynamicVector) continue;
						window._algebenchApplyShaftThickness(entry.mesh);
					}
					for (const entry of overlayState.vectorLineNodes) window._algebenchApplyLineWidth(entry);
				}
			} else if (param === "vectorOpacity") for (const entry of overlayState.arrowMeshes) {
				if (typeof window._algebenchIsShaftEntry === "function" && !window._algebenchIsShaftEntry(entry)) continue;
				const baseOp = entry.mesh && entry.mesh.userData && typeof entry.mesh.userData.baseOpacity === "number" ? entry.mesh.userData.baseOpacity : 1;
				const targetOp = Math.max(0, Math.min(1, baseOp * val));
				entry.mesh.material.opacity = targetOp;
				entry.mesh.material.transparent = targetOp < 1;
			}
			else if (param === "lineWidth") {
				if (typeof window._algebenchApplyLineWidth === "function") for (const entry of overlayState.lineNodes) window._algebenchApplyLineWidth(entry);
			} else if (param === "lineOpacity") for (const entry of overlayState.lineNodes) {
				const baseOp = entry && typeof entry.baseOpacity === "number" ? entry.baseOpacity : 1;
				entry.node.set("opacity", baseOp * val);
			}
			else if (param === "planeScale") for (const m of overlayState.planeMeshes) {
				if (m._hiddenByRemove) continue;
				if (m.userData.buildSlab) {
					const newPositions = m.userData.buildSlab(m.userData.baseHalf * val);
					m.geometry.setAttribute("position", new THREE.Float32BufferAttribute(newPositions, 3));
					m.geometry.computeVertexNormals();
					m.geometry.attributes.position.needsUpdate = true;
				}
			}
			else if (param === "planeOpacity") for (const m of overlayState.planeMeshes) {
				if (m._hiddenByRemove) continue;
				if (m.isSprite) continue;
				if (m.userData && m.userData.ignorePlaneOpacity) {
					const baseOp = typeof m.userData.targetOpacity === "number" ? m.userData.targetOpacity : 1;
					m.visible = baseOp > .001;
					m.material.opacity = baseOp;
					m.material.transparent = baseOp < 1;
					m.material.needsUpdate = true;
					continue;
				}
				const baseOp = m.userData && typeof m.userData.targetOpacity === "number" ? m.userData.targetOpacity : 1;
				const targetOp = Math.max(0, Math.min(1, baseOp * val));
				m.visible = targetOp > .001;
				m.material.opacity = targetOp;
				m.material.transparent = targetOp < 1;
				m.material.depthWrite = targetOp >= .999;
				m.material.needsUpdate = true;
			}
			else if (param === "captionScale") {
				const cap = document.getElementById("step-caption");
				if (cap) {
					const dragged = cap.style.left && cap.style.left.endsWith("px");
					cap.style.transformOrigin = dragged ? "left bottom" : "";
					cap.style.transform = (dragged ? "" : "translateX(-50%) ") + "scale(" + val + ")";
					clampCaptionIntoView(cap);
				}
			} else if (param === "overlayOpacity") {
				const cap = document.getElementById("step-caption");
				if (cap && !cap.classList.contains("hidden")) cap.style.opacity = String(val);
				const sliderOv = document.getElementById("slider-overlay");
				if (sliderOv) sliderOv.style.opacity = String(val);
				const legend = document.getElementById("legend");
				if (legend) legend.style.opacity = String(val);
				document.querySelectorAll("#info-overlays .dockable-panel").forEach((el) => {
					el.style.opacity = String(val);
				});
			}
		});
	});
	const declutterMode = document.getElementById("declutter-mode");
	if (declutterMode) {
		declutterMode.value = overlayState.displayParams.labelDeclutterMode;
		declutterMode.addEventListener("change", () => {
			overlayState.displayParams.labelDeclutterMode = declutterMode.value;
		});
	}
}
function initLightControls() {
	const azEl = document.getElementById("light-az");
	const elEl = document.getElementById("light-el");
	const intEl = document.getElementById("light-int");
	if (!azEl || !overlayState.mainDirLight) return;
	function applyLight() {
		const azDeg = parseFloat(azEl.value);
		const elDeg = parseFloat(elEl.value);
		const intensity = parseFloat(intEl.value) / 100;
		const az = azDeg * Math.PI / 180;
		const el = elDeg * Math.PI / 180;
		const dist = 20;
		overlayState.mainDirLight.position.set(dist * Math.cos(el) * Math.sin(az), dist * Math.sin(el), dist * Math.cos(el) * Math.cos(az));
		overlayState.mainDirLight.intensity = intensity;
		document.getElementById("val-light-az").textContent = azDeg + "°";
		document.getElementById("val-light-el").textContent = elDeg + "°";
		document.getElementById("val-light-int").textContent = intensity.toFixed(2);
	}
	azEl.addEventListener("input", applyLight);
	elEl.addEventListener("input", applyLight);
	intEl.addEventListener("input", applyLight);
	applyLight();
}
function updateStepCaption(scene, stepIdx) {
	const el = document.getElementById("step-caption");
	if (!el) return;
	let text = null;
	if (stepIdx >= 0 && scene.steps && scene.steps[stepIdx] && scene.steps[stepIdx].description) text = scene.steps[stepIdx].description;
	else if (stepIdx === -1 && scene.description) text = scene.description;
	if (text) {
		el.innerHTML = renderMarkdown$1(text);
		el.dataset.markdown = text;
		const btn = makeAiAskButton("ai-ask-btn caption-ai-btn", "Ask AI to explain this", () => `Can you explain the step description: "${text}"`);
		el.appendChild(btn);
		el.style.opacity = String(overlayState.displayParams.overlayOpacity);
		resetCaptionPosition(el);
		el.classList.remove("hidden");
	} else el.classList.add("hidden");
}
/** `bottom` and `left` are CSS lengths ('64px', '50%'), not numbers — the
*  '50%' default and the `endsWith('px')` test below both depend on that. */
function _applyBottomPos(el, bottom, left) {
	el.style.bottom = bottom;
	el.style.left = left || "50%";
	el.style.top = "auto";
	el.style.right = "auto";
	el.style.width = "";
	const scale = "scale(" + (overlayState.displayParams.captionScale || 1) + ")";
	if (left && left.endsWith("px")) {
		el.style.transform = scale;
		el.style.transformOrigin = "left bottom";
	} else {
		el.style.transform = "translateX(-50%) " + scale;
		el.style.transformOrigin = "";
	}
}
function _defaultCaptionPos(el) {
	_applyBottomPos(el, "64px", "50%");
}
function clampCaptionIntoView(el) {
	el = el || document.getElementById("step-caption");
	if (!el || el.classList.contains("hidden")) return;
	if (!el.style.left || !el.style.left.endsWith("px")) return;
	const p = (el.offsetParent || document.body).getBoundingClientRect();
	const r = el.getBoundingClientRect();
	const m = 8;
	let left = parseFloat(el.style.left) || 0;
	let bottom = parseFloat(el.style.bottom) || 0;
	if (r.left < p.left + m) left += p.left + m - r.left;
	else if (r.right > p.right - m) left -= r.right - (p.right - m);
	if (r.bottom > p.bottom - m) bottom += r.bottom - (p.bottom - m);
	else if (r.top < p.top + m) bottom -= p.top + m - r.top;
	el.style.left = left + "px";
	el.style.bottom = Math.max(0, bottom) + "px";
}
function resetCaptionPosition(el) {
	try {
		const saved = JSON.parse(localStorage.getItem("caption-pos") || "null");
		if (saved && typeof saved.bottom === "string" && saved.bottom.endsWith("px")) {
			if (saved.width) el.style.width = saved.width;
			_applyBottomPos(el, saved.bottom, saved.left);
			requestAnimationFrame(() => {
				const parent = el.offsetParent || document.body;
				const b = parseFloat(el.style.bottom) || 0;
				if (b < 0 || b > parent.clientHeight - 20) {
					localStorage.removeItem("caption-pos");
					_defaultCaptionPos(el);
				}
			});
			return;
		}
	} catch {}
	_defaultCaptionPos(el);
}
function setupCaptionDrag() {
	const el = document.getElementById("step-caption");
	if (!el) return;
	let dragging = false, startX = 0, startY = 0, startLeft = 0, startBottom = 0;
	let parentW = 0, parentH = 0, dragW = 0, dragH = 0;
	const EDGE_MARGIN = 8;
	el.addEventListener("mousedown", (e) => {
		if (e.target.closest(".ai-ask-btn")) return;
		dragging = true;
		startX = e.clientX;
		startY = e.clientY;
		const parentRect = (el.offsetParent || document.body).getBoundingClientRect();
		const elRect = el.getBoundingClientRect();
		const s = overlayState.displayParams.captionScale || 1;
		startLeft = elRect.left - parentRect.left;
		startBottom = parentRect.bottom - elRect.bottom;
		const cs = getComputedStyle(el);
		let frozenW = el.offsetWidth;
		if (cs.boxSizing !== "border-box") frozenW -= parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
		el.style.transformOrigin = "left bottom";
		el.style.width = frozenW + "px";
		el.style.left = startLeft + "px";
		el.style.bottom = startBottom + "px";
		el.style.top = "auto";
		el.style.right = "auto";
		el.style.transform = "scale(" + s + ")";
		parentW = parentRect.width;
		parentH = parentRect.height;
		const box = el.getBoundingClientRect();
		dragW = box.width;
		dragH = box.height;
		e.preventDefault();
	});
	document.addEventListener("mousemove", (e) => {
		if (!dragging) return;
		const m = EDGE_MARGIN;
		let left = startLeft + (e.clientX - startX);
		let bottom = startBottom - (e.clientY - startY);
		left = Math.max(m, Math.min(left, Math.max(m, parentW - dragW - m)));
		bottom = Math.max(m, Math.min(bottom, Math.max(m, parentH - dragH - m)));
		el.style.left = left + "px";
		el.style.bottom = bottom + "px";
	});
	document.addEventListener("mouseup", () => {
		if (!dragging) return;
		dragging = false;
		clampCaptionIntoView(el);
		try {
			localStorage.setItem("caption-pos", JSON.stringify({
				bottom: el.style.bottom,
				left: el.style.left,
				width: el.style.width
			}));
		} catch {}
	});
	window.addEventListener("resize", () => clampCaptionIntoView(el));
	resetCaptionPosition(el);
	setupOverlayHoverBoost();
}
var _overlayHoverWired = false;
var _overlayZ = 10;
function bringOverlayToFront(panel) {
	panel.style.zIndex = String(++_overlayZ);
}
function setupOverlayHoverBoost() {
	if (_overlayHoverWired) return;
	_overlayHoverWired = true;
	const SEL = "#step-caption, #scene-description, #slider-overlay, #legend, #info-overlays .dockable-panel";
	document.addEventListener("mouseover", (e) => {
		const target = e.target;
		const t = target.closest && target.closest(SEL);
		if (!t) return;
		const panel = target.closest("#info-overlays .dockable-panel");
		if (panel) bringOverlayToFront(panel);
		if (t._hoverBoosted) return;
		t._hoverBoosted = true;
		t._preHoverOp = t.style.opacity;
		const base = parseFloat(getComputedStyle(t).opacity);
		t._boostedOp = String(Math.min(1, (isNaN(base) ? 1 : base) * 2));
		t.style.opacity = t._boostedOp;
	});
	document.addEventListener("mousedown", (e) => {
		const target = e.target;
		const panel = target.closest && target.closest("#info-overlays .dockable-panel");
		if (panel) bringOverlayToFront(panel);
	}, true);
	document.addEventListener("mouseout", (e) => {
		const target = e.target;
		const t = target.closest && target.closest(SEL);
		if (!t || !t._hoverBoosted) return;
		if (e.relatedTarget && t.contains(e.relatedTarget)) return;
		t._hoverBoosted = false;
		if (t.style.opacity === t._boostedOp) t.style.opacity = t._preHoverOp || "";
	});
}
function resetSceneDescPosition(el) {
	if (!el) el = document.getElementById("scene-description");
	if (!el) return;
	try {
		const saved = JSON.parse(localStorage.getItem("scene-desc-pos") || "null");
		if (saved && typeof saved.bottom === "string" && saved.bottom.endsWith("px")) {
			const left = saved.left || "50%";
			if (saved.width) el.style.width = saved.width;
			el.style.bottom = saved.bottom;
			el.style.left = left;
			el.style.top = "auto";
			el.style.transform = left.endsWith("px") ? "none" : "translateX(-50%)";
			requestAnimationFrame(() => {
				const parent = el.offsetParent || document.body;
				const b = parseFloat(el.style.bottom) || 0;
				if (b < 0 || b > parent.clientHeight - 20) {
					localStorage.removeItem("scene-desc-pos");
					el.style.bottom = "64px";
					el.style.left = "50%";
					el.style.top = "auto";
					el.style.transform = "translateX(-50%)";
				}
			});
			return;
		}
	} catch {}
	el.style.bottom = "64px";
	el.style.left = "50%";
	el.style.top = "auto";
	el.style.transform = "translateX(-50%)";
}
function setupSceneDescDrag() {
	const el = document.getElementById("scene-description");
	if (!el) return;
	let dragging = false, startX = 0, startY = 0, startLeft = 0, startBottom = 0;
	el.addEventListener("mousedown", (e) => {
		if (e.target.closest(".ai-ask-btn")) return;
		dragging = true;
		startX = e.clientX;
		startY = e.clientY;
		const parentRect = (el.offsetParent || document.body).getBoundingClientRect();
		const elRect = el.getBoundingClientRect();
		startLeft = elRect.left - parentRect.left;
		startBottom = parentRect.bottom - elRect.bottom;
		el.style.width = elRect.width + "px";
		el.style.left = startLeft + "px";
		el.style.bottom = startBottom + "px";
		el.style.top = "auto";
		el.style.transform = "none";
		el.classList.add("dragging");
		e.preventDefault();
	});
	document.addEventListener("mousemove", (e) => {
		if (!dragging) return;
		el.style.left = startLeft + (e.clientX - startX) + "px";
		el.style.bottom = Math.max(0, startBottom - (e.clientY - startY)) + "px";
	});
	document.addEventListener("mouseup", () => {
		if (!dragging) return;
		dragging = false;
		el.classList.remove("dragging");
		try {
			localStorage.setItem("scene-desc-pos", JSON.stringify({
				bottom: el.style.bottom,
				left: el.style.left,
				width: el.style.width
			}));
		} catch {}
	});
	resetSceneDescPosition(el);
}
function setCamPopupPinned(pinned, suppressHover = false) {
	const camStatus = document.getElementById("cam-status");
	if (!camStatus) return;
	overlayState.camPopupPinned = !!pinned;
	camStatus.classList.toggle("pinned", overlayState.camPopupPinned);
	if (overlayState.camPopupPinned) camStatus.classList.remove("suppress-hover");
	else if (suppressHover) camStatus.classList.add("suppress-hover");
}
function setupCamStatusPopup() {
	const camStatus = document.getElementById("cam-status");
	const closeBtn = document.getElementById("cam-popup-close");
	const copyBtn = document.getElementById("cam-popup-copy");
	const popupText = document.getElementById("cam-popup-text");
	if (!camStatus) return;
	camStatus.addEventListener("click", (e) => {
		if (e.target && e.target.closest("#cam-popup-close")) return;
		if (e.target && e.target.closest("#cam-popup-copy")) return;
		if (e.target && e.target.closest(".cam-status-popup")) return;
		setCamPopupPinned(!overlayState.camPopupPinned, overlayState.camPopupPinned);
	});
	camStatus.addEventListener("mouseleave", () => {
		camStatus.classList.remove("suppress-hover");
	});
	if (closeBtn) closeBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		setCamPopupPinned(false, true);
	});
	if (copyBtn && popupText) copyBtn.addEventListener("click", async (e) => {
		e.stopPropagation();
		const txt = popupText.textContent || "";
		if (!txt) return;
		try {
			await navigator.clipboard.writeText(txt);
			const prev = copyBtn.textContent;
			copyBtn.textContent = "Copied";
			setTimeout(() => {
				copyBtn.textContent = prev;
			}, 900);
		} catch (_err) {}
	});
}
function setupAboutPopup() {
	const about = document.getElementById("about-status");
	if (!about) return;
	const versionStr = `v${document.body.dataset.appVersion || "dev"}`;
	const pillVersion = about.querySelector(".about-status-version");
	if (pillVersion) pillVersion.textContent = versionStr;
	const popupVersion = document.getElementById("about-popup-version");
	if (popupVersion) popupVersion.textContent = versionStr;
	const closeBtn = document.getElementById("about-popup-close");
	const setPinned = (pinned, suppressHover) => {
		about.classList.toggle("pinned", pinned);
		about.setAttribute("aria-expanded", pinned ? "true" : "false");
		if (pinned) about.classList.remove("suppress-hover");
		else if (suppressHover) about.classList.add("suppress-hover");
	};
	about.addEventListener("click", (e) => {
		if (e.target && e.target.closest("#about-popup-close")) return;
		if (e.target && e.target.closest(".about-status-popup")) return;
		const pinned = about.classList.contains("pinned");
		setPinned(!pinned, pinned);
	});
	about.addEventListener("keydown", (e) => {
		if (e.target && e.target.closest(".about-status-popup")) return;
		if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
			e.preventDefault();
			setPinned(!about.classList.contains("pinned"), true);
		} else if (e.key === "Escape" && about.classList.contains("pinned")) {
			setPinned(false, true);
			about.focus();
		}
	});
	about.addEventListener("mouseleave", () => {
		about.classList.remove("suppress-hover");
	});
	if (closeBtn) closeBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		setPinned(false, true);
	});
}
//#endregion
//#region src/camera.ts
var cameraState = state;
var ABSTRACT_LINE_THICKNESS_FACTOR = 1 / 20;
var ARROW_HEAD_MIN_FACTOR = .004;
var ARROW_HEAD_MAX_FACTOR = .012;
var ARROW_HEAD_RADIUS_RATIO = .35;
var SHAFT_RADIUS_TO_HEAD_RADIUS_RATIO = .35;
var SMALL_VECTOR_AUTOSCALE_MIN = .05;
var DEFAULT_CAMERA = {
	position: [
		2.5,
		1.8,
		2.5
	],
	target: [
		0,
		0,
		0
	]
};
var VIEW_EPSILON = .05;
var DEFAULT_VIEWS = [
	{
		name: "Iso",
		position: [
			2.5,
			1.8,
			2.5
		],
		target: [
			0,
			0,
			0
		],
		description: "Isometric perspective — balanced 3D view showing all axes"
	},
	{
		name: "Front",
		position: [
			0,
			0,
			4.5
		],
		target: [
			0,
			0,
			0
		],
		description: "Front view along Z axis — see the XY plane directly"
	},
	{
		name: "Top",
		position: [
			0,
			4.5,
			.01
		],
		target: [
			0,
			0,
			0
		],
		description: "Top view along Y axis — look straight down at the XZ plane"
	},
	{
		name: "Right",
		position: [
			4.5,
			0,
			0
		],
		target: [
			0,
			0,
			0
		],
		description: "Right view along X axis — see the YZ plane from the right"
	}
];
var CONTROL_CLASS = typeof THREE !== "undefined" && THREE.OrbitControls ? THREE.OrbitControls : typeof THREE !== "undefined" ? THREE.TrackballControls : null;
/** `abstract` is not in schemas/lesson.schema.json — it is a renderer-level
*  opt-in some elements carry — so the parameter admits a lesson Element too. */
function getAbstractWidthScale(el) {
	return el && el.abstract === true ? ABSTRACT_LINE_THICKNESS_FACTOR : 1;
}
function resolveLineWidth(entry) {
	const scale = cameraState.displayParams[entry.widthParam || "lineWidth"] ?? 1;
	return Math.max(entry.baseWidth * scale, .1);
}
function resolveShaftThicknessScale(mesh) {
	const base = mesh?.userData?.baseThicknessScale ?? 1;
	const auto = mesh?.userData?.autoThicknessScale ?? 1;
	return Math.max(base * auto * (cameraState.displayParams.vectorWidth || 1) * 1, .05);
}
function applyShaftThickness(mesh) {
	if (!mesh) return;
	const thickness = resolveShaftThicknessScale(mesh);
	const baseShaftRadius = mesh.userData && typeof mesh.userData.baseShaftRadius === "number" ? Math.max(mesh.userData.baseShaftRadius, 1e-6) : 1;
	const maxRadiusFromHead = mesh.userData && typeof mesh.userData.maxRadiusFromHead === "number" ? mesh.userData.maxRadiusFromHead : Infinity;
	const maxThicknessScale = Number.isFinite(maxRadiusFromHead) ? maxRadiusFromHead / baseShaftRadius : Infinity;
	const cappedThickness = Math.min(thickness, maxThicknessScale);
	const lengthScale = mesh.userData && typeof mesh.userData.lengthScale === "number" ? mesh.userData.lengthScale : 1;
	mesh.scale.set(cappedThickness, lengthScale, cappedThickness);
}
function resolveArrowSizeScale(localScale) {
	return (localScale || 1) * 2;
}
function resolveSmallVectorAutoScale(vectorLen, coneLen) {
	if (vectorLen <= 0 || coneLen <= 0) return 1;
	const limit = 3 * coneLen;
	if (vectorLen > limit) return 1;
	return Math.max(vectorLen / Math.max(limit, 1e-6), SMALL_VECTOR_AUTOSCALE_MIN);
}
function updateControlsHint() {
	const hint = document.getElementById("controls-hint");
	if (hint) hint.innerHTML = "Drag: rotate &middot; Shift+drag or 2-finger scroll: pan &middot; Pinch/wheel: zoom &middot; &#8997;+drag: roll";
}
function configureControlsInstance(ctrl, target) {
	if (!ctrl) return;
	if (target) ctrl.target.copy(target);
	if (ctrl instanceof THREE.TrackballControls) {
		ctrl.rotateSpeed = 3.5;
		ctrl.zoomSpeed = 1.2;
		ctrl.panSpeed = .9;
		ctrl.staticMoving = false;
		ctrl.dynamicDampingFactor = .1;
		ctrl.noRotate = true;
		ctrl.noZoom = false;
		ctrl.noPan = false;
	} else if (THREE.MOUSE && THREE.TOUCH) {
		ctrl.enableDamping = true;
		ctrl.dampingFactor = .06;
		ctrl.enableZoom = true;
		ctrl.screenSpacePanning = true;
		ctrl.mouseButtons = {
			LEFT: THREE.MOUSE.PAN,
			MIDDLE: THREE.MOUSE.DOLLY,
			RIGHT: THREE.MOUSE.PAN
		};
		ctrl.touches = {
			ONE: THREE.TOUCH.PAN,
			TWO: THREE.TOUCH.DOLLY_PAN
		};
	}
	ctrl.update();
}
function screenToArcball(clientX, clientY) {
	if (!cameraState.renderer) return new THREE.Vector3(0, 0, 1);
	const rect = cameraState.renderer.domElement.getBoundingClientRect();
	const nx = (clientX - rect.left - rect.width * .5) / (rect.width * .5);
	const ny = -(clientY - rect.top - rect.height * .5) / (rect.height * .5);
	const r2 = nx * nx + ny * ny;
	if (r2 <= 1) return new THREE.Vector3(nx, ny, Math.sqrt(1 - r2));
	const r = Math.sqrt(r2);
	return new THREE.Vector3(nx / r, ny / r, 0);
}
function applyArcballOrbit(prevPt, currPt) {
	if (!cameraState.camera || !cameraState.controls) return;
	if (prevPt.distanceToSquared(currPt) < 1e-10) return;
	const q = new THREE.Quaternion().setFromUnitVectors(currPt.clone().normalize(), prevPt.clone().normalize());
	const camQ = cameraState.camera.quaternion.clone();
	const worldQ = camQ.clone().multiply(q).multiply(camQ.clone().conjugate());
	const target = cameraState.controls.target.clone();
	const offset = cameraState.camera.position.clone().sub(target);
	offset.applyQuaternion(worldQ);
	cameraState.camera.up.applyQuaternion(worldQ).normalize();
	cameraState.camera.position.copy(target).add(offset);
	cameraState.camera.lookAt(target);
	cameraState.controls.update();
	cameraState.arcballLastMoveTime = performance.now();
	cameraState.arcballInertiaQ = cameraState.arcballInertiaQ ? cameraState.arcballInertiaQ.slerp(worldQ, .5) : worldQ.clone();
}
function startArcballInertia() {
	if (cameraState.arcballInertiaId) {
		cancelAnimationFrame(cameraState.arcballInertiaId);
		cameraState.arcballInertiaId = null;
	}
	const identity = new THREE.Quaternion();
	if (!cameraState.arcballInertiaQ || cameraState.arcballMomentum < .01 || performance.now() - cameraState.arcballLastMoveTime > 80 || cameraState.arcballInertiaQ.angleTo(identity) < 2e-4) {
		cameraState.arcballInertiaQ = null;
		return;
	}
	const slerpT = Math.pow(.01, cameraState.arcballMomentum);
	function step() {
		if (!cameraState.arcballInertiaQ || !cameraState.camera || !cameraState.controls) {
			cameraState.arcballInertiaId = null;
			return;
		}
		if (cameraState.arcballInertiaQ.angleTo(identity) < 5e-5) {
			cameraState.arcballInertiaQ = null;
			cameraState.arcballInertiaId = null;
			return;
		}
		const tgt = cameraState.controls.target.clone();
		const offset = cameraState.camera.position.clone().sub(tgt);
		offset.applyQuaternion(cameraState.arcballInertiaQ);
		cameraState.camera.up.applyQuaternion(cameraState.arcballInertiaQ).normalize();
		cameraState.camera.position.copy(tgt).add(offset);
		cameraState.camera.lookAt(tgt);
		cameraState.controls.update();
		cameraState.arcballInertiaQ.slerp(identity, slerpT);
		cameraState.arcballInertiaId = requestAnimationFrame(step);
	}
	cameraState.arcballInertiaId = requestAnimationFrame(step);
}
function applyCameraRoll(deltaAngle) {
	if (!cameraState.camera || !cameraState.controls) return;
	const viewDir = new THREE.Vector3().subVectors(cameraState.controls.target, cameraState.camera.position);
	if (viewDir.lengthSq() < 1e-12) return;
	viewDir.normalize();
	const q = new THREE.Quaternion().setFromAxisAngle(viewDir, deltaAngle);
	cameraState.camera.up.applyQuaternion(q).normalize();
	cameraState.camera.lookAt(cameraState.controls.target);
	cameraState.controls.update();
}
function setupRollDrag(container) {
	if (!container) return;
	const inputSurface = container;
	let orbitDrag = null;
	inputSurface.addEventListener("mousedown", (e) => {
		if (e.button !== 0) return;
		if (e.altKey) {
			e.preventDefault();
			e.stopImmediatePropagation();
			cameraState.rollDrag = {
				x: e.clientX,
				awaitingMouseUp: false
			};
			document.body.classList.add("rotating");
			if (cameraState.controls) cameraState.controls.enabled = false;
			return;
		}
		if (e.shiftKey) return;
		if (e.ctrlKey || e.metaKey) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		if (cameraState.arcballInertiaId) {
			cancelAnimationFrame(cameraState.arcballInertiaId);
			cameraState.arcballInertiaId = null;
		}
		cameraState.arcballInertiaQ = null;
		orbitDrag = { pt: screenToArcball(e.clientX, e.clientY) };
		document.body.classList.add("rotating");
		if (cameraState.controls) cameraState.controls.enabled = false;
	}, { capture: true });
	window.addEventListener("mousemove", (e) => {
		if (orbitDrag) {
			e.preventDefault();
			e.stopImmediatePropagation();
			if ((e.buttons & 1) === 0) return endOrbitDrag();
			const currPt = screenToArcball(e.clientX, e.clientY);
			applyArcballOrbit(orbitDrag.pt, currPt);
			orbitDrag.pt = currPt;
			return;
		}
		if (!cameraState.rollDrag) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		if (!e.altKey) {
			cameraState.rollDrag.awaitingMouseUp = true;
			return;
		}
		if ((e.buttons & 1) === 0) return endRollDrag();
		if (cameraState.rollDrag.awaitingMouseUp) return;
		const dx = e.clientX - cameraState.rollDrag.x;
		cameraState.rollDrag.x = e.clientX;
		applyCameraRoll(-dx * .0045);
	});
	function endOrbitDrag() {
		if (!orbitDrag) return;
		orbitDrag = null;
		document.body.classList.remove("rotating");
		if (cameraState.controls) {
			cameraState.controls.enabled = true;
			cameraState.controls.update();
		}
		startArcballInertia();
	}
	function endRollDrag() {
		document.body.classList.remove("rotating");
		if (cameraState.controls) {
			cameraState.controls.enabled = true;
			cameraState.controls.update();
		}
		if (!cameraState.rollDrag) return;
		cameraState.rollDrag = null;
	}
	window.addEventListener("keyup", (e) => {
		if (e.key === "Alt" && cameraState.rollDrag) cameraState.rollDrag.awaitingMouseUp = true;
	});
	window.addEventListener("mouseup", (e) => {
		if (cameraState.rollDrag || orbitDrag) {
			e.preventDefault();
			e.stopImmediatePropagation();
		}
		endOrbitDrag();
		endRollDrag();
	}, { capture: true });
	window.addEventListener("pointerup", () => {
		endOrbitDrag();
		endRollDrag();
	}, { capture: true });
	document.addEventListener("mouseup", () => {
		endOrbitDrag();
		endRollDrag();
	}, true);
	window.addEventListener("mouseleave", () => {
		endOrbitDrag();
		endRollDrag();
	});
	window.addEventListener("blur", () => {
		endOrbitDrag();
		endRollDrag();
	});
	document.addEventListener("visibilitychange", () => {
		if (document.hidden) {
			endOrbitDrag();
			endRollDrag();
		}
	});
	window.addEventListener("mousedown", () => {
		if (!cameraState.rollDrag && !orbitDrag && cameraState.controls && !cameraState.controls.enabled) cameraState.controls.enabled = true;
	}, { capture: true });
}
function activateExprCamera(viewSpec, key) {
	const posExpr = Array.isArray(viewSpec.positionExpr) && viewSpec.positionExpr.length === 3 ? viewSpec.positionExpr : null;
	const tgtExpr = Array.isArray(viewSpec.targetExpr) && viewSpec.targetExpr.length === 3 ? viewSpec.targetExpr : null;
	if (!posExpr || !tgtExpr || !cameraState.camera || !cameraState.controls) return;
	let posFns, tgtFns;
	try {
		posFns = posExpr.map((e) => compileExpr(typeof e === "number" ? String(e) : e));
		tgtFns = tgtExpr.map((e) => compileExpr(typeof e === "number" ? String(e) : e));
	} catch (err) {
		console.warn("expr-camera compile error:", err);
		return;
	}
	cameraState.cameraExprState = {
		posFns,
		tgtFns,
		up: Array.isArray(viewSpec.up) ? viewSpec.up.slice(0, 3) : cameraState.sceneUp.slice(0, 3),
		viewKey: key || null
	};
	cameraState.cameraExprStartTime = performance.now();
	updateExprCamera();
}
function deactivateExprCamera() {
	cameraState.cameraExprState = null;
}
function updateExprCamera() {
	if (!cameraState.cameraExprState || !cameraState.camera || !cameraState.controls) return;
	const tSec = (performance.now() - cameraState.cameraExprStartTime) / 1e3;
	let posData, tgtData;
	try {
		posData = cameraState.cameraExprState.posFns.map((fn) => evalExpr(fn, tSec));
		tgtData = cameraState.cameraExprState.tgtFns.map((fn) => evalExpr(fn, tSec));
	} catch (err) {
		return;
	}
	const posWorld = dataCameraToWorld$1(posData);
	const tgtWorld = dataCameraToWorld$1(tgtData);
	cameraState.camera.position.set(posWorld[0], posWorld[1], posWorld[2]);
	cameraState.controls.target.set(tgtWorld[0], tgtWorld[1], tgtWorld[2]);
	cameraState.camera.up.copy(normalizeUpVector(cameraState.cameraExprState.up));
	cameraState.camera.lookAt(cameraState.controls.target);
}
/** Paint the WebGL clear color from the --canvas-bg token (a slate board in
*  both themes — see tokens.css). Called at init and on every theme toggle. */
function applyCanvasClearColor() {
	if (!cameraState.renderer) return;
	const v = getComputedStyle(document.documentElement).getPropertyValue("--canvas-bg").trim();
	cameraState.renderer.setClearColor(new THREE.Color(v || "#0a0a0f"), 1);
}
function initMathBox() {
	const container = document.getElementById("mathbox-container");
	const w = container.clientWidth;
	const h = container.clientHeight;
	cameraState.mathbox = MathBox.mathBox({
		element: container,
		plugins: [
			"core",
			"controls",
			"cursor"
		],
		controls: { klass: CONTROL_CLASS },
		camera: { fov: 75 },
		renderer: { antialias: true }
	});
	cameraState.three = cameraState.mathbox.three;
	cameraState.camera = cameraState.three.camera;
	cameraState.perspCamera = cameraState.camera;
	cameraState.renderer = cameraState.three.renderer;
	cameraState.controls = cameraState.three.controls;
	applyCanvasClearColor();
	cameraState.renderer.setPixelRatio(window.devicePixelRatio);
	cameraState.renderer.setSize(w, h);
	const ambientLight = new THREE.AmbientLight(16777215, .5);
	cameraState.three.scene.add(ambientLight);
	cameraState.mainDirLight = new THREE.DirectionalLight(16777215, .8);
	cameraState.mainDirLight.position.set(5, 10, 7);
	cameraState.three.scene.add(cameraState.mainDirLight);
	const dirLight2 = new THREE.DirectionalLight(16777215, .3);
	dirLight2.position.set(-3, -5, -4);
	cameraState.three.scene.add(dirLight2);
	const initPos = dataToWorld(DEFAULT_CAMERA.position);
	const initTgt = dataToWorld(DEFAULT_CAMERA.target);
	cameraState.camera.position.set(initPos[0], initPos[1], initPos[2]);
	cameraState.camera.lookAt(initTgt[0], initTgt[1], initTgt[2]);
	if (cameraState.controls) {
		const target = new THREE.Vector3(initTgt[0], initTgt[1], initTgt[2]);
		configureControlsInstance(cameraState.controls, target);
	}
	updateControlsHint();
	window.addEventListener("resize", () => {
		const w2 = container.clientWidth;
		const h2 = container.clientHeight;
		cameraState.renderer.setSize(w2, h2);
		if (cameraState.camera.isOrthographicCamera) {
			const aspect2 = w2 / h2;
			const halfH = (cameraState.camera.top - cameraState.camera.bottom) / 2;
			cameraState.camera.left = -halfH * aspect2;
			cameraState.camera.right = halfH * aspect2;
		} else cameraState.camera.aspect = w2 / h2;
		cameraState.camera.updateProjectionMatrix();
	});
	let _statusFrameTick = 0;
	function updateLoop() {
		cameraState.animationFrameId = requestAnimationFrame(updateLoop);
		runAnimUpdaters(performance.now());
		if (cameraState.cameraExprState) updateExprCamera();
		else if (cameraState.followCamState) updateFollowCam();
		else if (cameraState.controls && typeof cameraState.controls.update === "function") cameraState.controls.update();
		updateLabels();
		if (++_statusFrameTick % 6 === 0) updateStatusBar();
	}
	updateLoop();
}
function switchProjection(mode) {
	if (mode === cameraState.currentProjection) return;
	cameraState.currentProjection = mode;
	const container = document.getElementById("mathbox-container");
	const aspect = container.clientWidth / container.clientHeight;
	const pos = cameraState.camera.position.clone();
	const target = cameraState.controls ? cameraState.controls.target.clone() : new THREE.Vector3();
	let newCamera;
	if (mode === "orthographic") {
		const frustumHeight = Math.max(pos.distanceTo(target), .001) * Math.tan(cameraState.perspCamera.fov / 2 * Math.PI / 180) * 2;
		const frustumWidth = frustumHeight * aspect;
		newCamera = new THREE.OrthographicCamera(-frustumWidth / 2, frustumWidth / 2, frustumHeight / 2, -frustumHeight / 2, -1e3, 1e3);
		newCamera.updateProjectionMatrix();
	} else newCamera = cameraState.perspCamera;
	newCamera.up.copy(cameraState.camera.up);
	newCamera.position.copy(pos);
	newCamera.lookAt(target);
	cameraState.three.camera = newCamera;
	cameraState.camera = newCamera;
	if (!cameraState.renderer._origRender) cameraState.renderer._origRender = cameraState.renderer.render.bind(cameraState.renderer);
	cameraState.renderer.render = function(scene, cam) {
		cameraState.renderer._origRender(scene, cameraState.camera);
	};
	if (cameraState.controls) cameraState.controls.dispose();
	cameraState.controls = new CONTROL_CLASS(cameraState.camera, cameraState.renderer.domElement);
	configureControlsInstance(cameraState.controls, target);
	cameraState.three.controls = cameraState.controls;
	document.querySelectorAll(".proj-btn").forEach((btn) => {
		btn.classList.toggle("active", btn.dataset.proj === mode);
	});
}
function setupProjectionToggle() {
	document.querySelectorAll(".proj-btn").forEach((btn) => {
		btn.addEventListener("click", () => switchProjection(btn.dataset.proj));
	});
}
function setupTrackpadPan() {
	const canvas = cameraState.renderer && cameraState.renderer.domElement;
	if (!canvas) return;
	canvas.addEventListener("wheel", (e) => {
		if (e.ctrlKey || e.deltaMode !== 0) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		if (!cameraState.camera || !cameraState.controls) return;
		const panFactor = cameraState.camera.position.distanceTo(cameraState.controls.target) / canvas.clientHeight * .8;
		const right = new THREE.Vector3().setFromMatrixColumn(cameraState.camera.matrix, 0);
		const up = new THREE.Vector3().setFromMatrixColumn(cameraState.camera.matrix, 1);
		const panOffset = new THREE.Vector3().addScaledVector(right, e.deltaX * panFactor).addScaledVector(up, -e.deltaY * panFactor);
		cameraState.camera.position.add(panOffset);
		cameraState.controls.target.add(panOffset);
		cameraState.controls.update();
	}, {
		capture: true,
		passive: false
	});
}
function normalizeUpVector(up) {
	const raw = Array.isArray(up) && up.length === 3 ? up : [
		0,
		1,
		0
	];
	const v = new THREE.Vector3(raw[0], raw[1], raw[2]);
	if (v.lengthSq() < 1e-12) return new THREE.Vector3(0, 1, 0);
	return v.normalize();
}
function resolveEffectiveStepCamera(scene, stepIdx) {
	if (!scene) return null;
	const baseUp = scene.camera && Array.isArray(scene.camera.up) && scene.camera.up.length === 3 ? scene.camera.up.slice(0, 3) : [
		0,
		1,
		0
	];
	const effective = {
		position: scene.camera && Array.isArray(scene.camera.position) && scene.camera.position.length === 3 ? scene.camera.position.slice(0, 3) : DEFAULT_CAMERA.position.slice(0, 3),
		target: scene.camera && Array.isArray(scene.camera.target) && scene.camera.target.length === 3 ? scene.camera.target.slice(0, 3) : DEFAULT_CAMERA.target.slice(0, 3),
		up: baseUp
	};
	if (stepIdx >= 0 && Array.isArray(scene.steps)) {
		const last = Math.min(stepIdx, scene.steps.length - 1);
		for (let i = 0; i <= last; i++) {
			const step = scene.steps[i];
			const cam = step && step.camera;
			if (!cam) continue;
			if (Array.isArray(cam.position) && cam.position.length === 3) effective.position = cam.position.slice(0, 3);
			if (Array.isArray(cam.target) && cam.target.length === 3) effective.target = cam.target.slice(0, 3);
			if (Array.isArray(cam.up) && cam.up.length === 3) effective.up = cam.up.slice(0, 3);
		}
	}
	return effective;
}
function animateCamera$1(view, duration) {
	duration = duration == null ? 800 : duration;
	deactivateFollowCam();
	deactivateExprCamera();
	const targetView = cameraState.CAMERA_VIEWS[view];
	if (!targetView || !cameraState.camera || !cameraState.controls) return;
	const startPos = cameraState.camera.position.clone();
	const endPos = new THREE.Vector3(...targetView.position);
	const startTarget = cameraState.controls.target.clone();
	const endTarget = new THREE.Vector3(...targetView.target);
	const startUp = cameraState.camera.up.clone();
	let endUp = normalizeUpVector(targetView.up);
	const offset = endPos.clone().sub(endTarget);
	if (offset.clone().sub(endUp.clone().multiplyScalar(offset.dot(endUp))).length() < VIEW_EPSILON) {
		const helper = Math.abs(endUp.dot(new THREE.Vector3(0, 0, 1))) < .9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
		const nudge = new THREE.Vector3().crossVectors(endUp, helper).normalize();
		const nudgeMag = Math.min(VIEW_EPSILON, Math.max(5e-4, offset.length() * .01));
		endPos.addScaledVector(nudge, nudgeMag);
	}
	const viewDir = endTarget.clone().sub(endPos).normalize();
	if (Math.abs(viewDir.dot(endUp)) > .995) {
		const helper = Math.abs(viewDir.dot(new THREE.Vector3(0, 1, 0))) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
		endUp = helper.clone().sub(viewDir.clone().multiplyScalar(helper.dot(viewDir))).normalize();
	}
	const startTime = performance.now();
	document.querySelectorAll(".cam-btn").forEach((b) => b.classList.remove("active"));
	const activeBtn = document.querySelector(`.cam-btn[data-view="${view}"]`);
	if (activeBtn) activeBtn.classList.add("active");
	cameraState.cameraAnimating = true;
	if (duration === 0) {
		cameraState.camera.position.copy(endPos);
		cameraState.controls.target.copy(endTarget);
		cameraState.camera.up.copy(endUp);
		cameraState.camera.lookAt(cameraState.controls.target);
		cameraState.cameraAnimating = false;
		return;
	}
	function step(now) {
		const elapsed = now - startTime;
		let t = Math.min(elapsed / duration, 1);
		t = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
		cameraState.camera.position.lerpVectors(startPos, endPos, t);
		cameraState.controls.target.lerpVectors(startTarget, endTarget, t);
		cameraState.camera.up.lerpVectors(startUp, endUp, t).normalize();
		cameraState.camera.lookAt(cameraState.controls.target);
		cameraState.controls.update();
		if (t < 1) requestAnimationFrame(step);
		else cameraState.cameraAnimating = false;
	}
	requestAnimationFrame(step);
}
function buildCameraButtons(spec) {
	const container = document.getElementById("camera-buttons");
	container.innerHTML = "";
	cameraState.CAMERA_VIEWS = {};
	cameraState.sceneUp = spec && spec.camera && Array.isArray(spec.camera.up) && spec.camera.up.length === 3 ? spec.camera.up.slice(0, 3) : [
		0,
		1,
		0
	];
	(spec && spec.views ? spec.views : DEFAULT_VIEWS).forEach((v) => {
		const key = v.name.toLowerCase().replace(/\s+/g, "-");
		const btn = document.createElement("button");
		btn.className = "cam-btn";
		btn.dataset.view = key;
		btn.title = v.description || v.name;
		btn.innerHTML = renderKaTeX$1(v.name, false);
		if (v.follow) {
			btn.classList.add("cam-btn-follow");
			btn.addEventListener("click", () => {
				deactivateExprCamera();
				if (cameraState.followCamState && cameraState.followCamState.viewKey === key) {
					deactivateFollowCam();
					document.querySelectorAll(".cam-btn").forEach((b) => b.classList.remove("active"));
					return;
				}
				document.querySelectorAll(".cam-btn").forEach((b) => b.classList.remove("active"));
				btn.classList.add("active");
				activateFollowCam({
					...v,
					_viewKey: key
				});
			});
		} else if (Array.isArray(v.positionExpr) && Array.isArray(v.targetExpr)) {
			btn.classList.add("cam-btn-follow");
			btn.addEventListener("click", () => {
				deactivateFollowCam();
				if (cameraState.cameraExprState && cameraState.cameraExprState.viewKey === key) {
					deactivateExprCamera();
					document.querySelectorAll(".cam-btn").forEach((b) => b.classList.remove("active"));
					return;
				}
				document.querySelectorAll(".cam-btn").forEach((b) => b.classList.remove("active"));
				btn.classList.add("active");
				activateExprCamera(v, key);
			});
		} else {
			cameraState.CAMERA_VIEWS[key] = {
				position: dataCameraToWorld$1(v.position),
				target: dataCameraToWorld$1(v.target || [
					0,
					0,
					0
				]),
				up: Array.isArray(v.up) ? v.up.slice(0, 3) : cameraState.sceneUp.slice(0, 3)
			};
			btn.addEventListener("click", (e) => {
				deactivateFollowCam();
				deactivateExprCamera();
				if (e.shiftKey) animateCamera$1(key, 0);
				else if (e.altKey) animateCamera$1(key, 200);
				else animateCamera$1(key, 800);
			});
		}
		container.appendChild(btn);
	});
	const resetBtn = document.createElement("button");
	resetBtn.className = "cam-btn";
	resetBtn.dataset.view = "reset";
	resetBtn.title = "Reset camera";
	resetBtn.textContent = "Reset";
	resetBtn.addEventListener("click", (e) => {
		deactivateFollowCam();
		deactivateExprCamera();
		const camSpec = resolveEffectiveStepCamera(cameraState.lessonSpec && cameraState.currentSceneIndex >= 0 && cameraState.lessonSpec.scenes ? cameraState.lessonSpec.scenes[cameraState.currentSceneIndex] : cameraState.currentSpec, cameraState.currentStepIndex) || cameraState.currentSpec && cameraState.currentSpec.camera || null;
		const pos = dataCameraToWorld$1(camSpec && camSpec.position || DEFAULT_CAMERA.position);
		const tgt = dataCameraToWorld$1(camSpec && camSpec.target || DEFAULT_CAMERA.target);
		cameraState.CAMERA_VIEWS.reset = {
			position: pos,
			target: tgt,
			up: camSpec && Array.isArray(camSpec.up) ? camSpec.up.slice(0, 3) : [
				0,
				1,
				0
			]
		};
		if (e.shiftKey) animateCamera$1("reset", 0);
		else if (e.altKey) animateCamera$1("reset", 200);
		else animateCamera$1("reset", 800);
	});
	container.appendChild(resetBtn);
	updateFollowAngleLockButtonState();
}
//#endregion
//#region src/objects/skybox.ts
var skyboxState = state;
function clearWorldStarfield() {
	if (skyboxState._starfieldAnimId) {
		cancelAnimationFrame(skyboxState._starfieldAnimId);
		skyboxState._starfieldAnimId = null;
	}
	if (!skyboxState.worldStarfield || !skyboxState.three || !skyboxState.three.scene) return;
	skyboxState.three.scene.remove(skyboxState.worldStarfield);
	if (skyboxState.worldStarfield.geometry) skyboxState.worldStarfield.geometry.dispose();
	if (skyboxState.worldStarfield.material) skyboxState.worldStarfield.material.dispose();
	skyboxState.worldStarfield = null;
}
function clearWorldSkybox() {
	if (!skyboxState.three || !skyboxState.three.scene) return;
	if (skyboxState.worldSkybox && skyboxState.worldSkybox.texture && typeof skyboxState.worldSkybox.texture.dispose === "function") skyboxState.worldSkybox.texture.dispose();
	skyboxState.worldSkybox = null;
	skyboxState.three.scene.background = null;
}
function _makeGradientSkyboxTexture(topHex, bottomHex, starCount = 0, starColor = "#e6efff", starMin = .5, starMax = 2) {
	const canvas = document.createElement("canvas");
	canvas.width = 2048;
	canvas.height = 1024;
	const ctx = canvas.getContext("2d");
	const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
	grad.addColorStop(0, topHex || "#070b18");
	grad.addColorStop(1, bottomHex || "#010205");
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	const n = Math.max(0, Math.floor(starCount || 0));
	if (n > 0) {
		ctx.fillStyle = starColor || "#e6efff";
		for (let i = 0; i < n; i++) {
			const x = Math.random() * canvas.width;
			const y = Math.random() * canvas.height;
			const r = (starMin || .5) + Math.random() * Math.max(.05, (starMax || 2) - (starMin || .5));
			ctx.globalAlpha = .35 + Math.random() * .65;
			ctx.beginPath();
			ctx.arc(x, y, r, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.globalAlpha = 1;
	}
	const tex = new THREE.CanvasTexture(canvas);
	tex.mapping = THREE.EquirectangularReflectionMapping;
	return tex;
}
function configureWorldStarfield(spec) {
	clearWorldStarfield();
	const cfg = spec && spec.starfield;
	if (!cfg || cfg.enabled === false) return;
	const currentRange = skyboxState.currentRange;
	skyboxState.currentScale;
	const spanX = Math.abs(currentRange[0][1] - currentRange[0][0]);
	const spanY = Math.abs(currentRange[1][1] - currentRange[1][0]);
	const spanZ = Math.abs(currentRange[2][1] - currentRange[2][0]);
	const halfMaxSpan = Math.max(spanX, spanY, spanZ, 1) / 2;
	const count = Math.max(50, Math.floor(cfg.count || 900));
	const radiusMin = Number.isFinite(cfg.radiusMin) ? cfg.radiusMin : halfMaxSpan * 3;
	const radiusMax = Number.isFinite(cfg.radiusMax) ? cfg.radiusMax : halfMaxSpan * 7;
	const size = Number.isFinite(cfg.size) ? cfg.size : 2.1;
	const opacity = Number.isFinite(cfg.opacity) ? cfg.opacity : .9;
	const twinkle = Number.isFinite(cfg.twinkle) ? Math.max(0, Math.min(1, cfg.twinkle)) : .25;
	const baseColor = new THREE.Color(cfg.color || "#d9e6ff");
	const positions = new Float32Array(count * 3);
	const colors = new Float32Array(count * 3);
	const sizes = new Float32Array(count);
	const phases = new Float32Array(count);
	for (let i = 0; i < count; i++) {
		const z = Math.random() * 2 - 1;
		const theta = Math.random() * Math.PI * 2;
		const rXY = Math.sqrt(Math.max(0, 1 - z * z));
		const dirX = rXY * Math.cos(theta);
		const dirY = rXY * Math.sin(theta);
		const dirZ = z;
		const u = Math.random();
		const radius = radiusMin + (radiusMax - radiusMin) * Math.pow(u, .6);
		const w = dataToWorld([
			dirX * radius,
			dirY * radius,
			dirZ * radius
		]);
		const pi = i * 3;
		positions[pi] = w[0];
		positions[pi + 1] = w[1];
		positions[pi + 2] = w[2];
		const r = Math.random();
		sizes[i] = r < .6 ? size * (.8 + Math.random() * .6) : r < .85 ? size * (1.5 + Math.random() * 1) : r < .95 ? size * (2.5 + Math.random() * 1.5) : size * (4 + Math.random() * 2);
		phases[i] = Math.random() * Math.PI * 2;
		const f = 1 - twinkle * Math.random();
		colors[pi] = baseColor.r * f;
		colors[pi + 1] = baseColor.g * f;
		colors[pi + 2] = baseColor.b * f;
	}
	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
	geom.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
	geom.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
	const mat = new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uOpacity: { value: opacity },
			uTwinkle: { value: twinkle }
		},
		vertexShader: `
            attribute float size;
            attribute float phase;
            varying vec3 vColor;
            varying float vPhase;
            uniform float uTime;
            uniform float uTwinkle;
            void main() {
                vColor = color;
                vPhase = phase;
                float flicker = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (1.0 + fract(vPhase) * 3.0) + vPhase));
                gl_PointSize = size * max(flicker, 0.1);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
		fragmentShader: `
            uniform float uOpacity;
            varying vec3 vColor;
            varying float vPhase;
            uniform float uTime;
            uniform float uTwinkle;
            void main() {
                float d = length(gl_PointCoord - 0.5) * 2.0;
                float flicker = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (1.0 + fract(vPhase) * 3.0) + vPhase));
                float alpha = smoothstep(1.0, 0.3, d) * uOpacity * max(flicker, 0.1);
                gl_FragColor = vec4(vColor, alpha);
            }
        `,
		transparent: true,
		depthWrite: false,
		vertexColors: true
	});
	skyboxState.worldStarfield = new THREE.Points(geom, mat);
	skyboxState.worldStarfield.renderOrder = -1e3;
	skyboxState.worldStarfield.frustumCulled = false;
	skyboxState.three.scene.add(skyboxState.worldStarfield);
	skyboxState._starfieldAnimId = null;
	if (twinkle > 0) {
		const thisStarfield = skyboxState.worldStarfield;
		const startTime = performance.now();
		function animateStarfield() {
			if (!skyboxState.worldStarfield || skyboxState.worldStarfield !== thisStarfield) return;
			mat.uniforms.uTime.value = (performance.now() - startTime) / 1e3;
			skyboxState._starfieldAnimId = requestAnimationFrame(animateStarfield);
		}
		animateStarfield();
	}
}
function renderSkybox(el) {
	if (!skyboxState.three || !skyboxState.three.scene) return null;
	clearWorldSkybox();
	const style = (el.style || el.mode || "solid").toLowerCase();
	if (style === "none" || style === "off") return {
		type: "skybox",
		style
	};
	if (style === "solid" || style === "color") {
		skyboxState.three.scene.background = new THREE.Color(el.color || "#02040b");
		return {
			type: "skybox",
			style
		};
	}
	if (style === "gradient") {
		const tex = _makeGradientSkyboxTexture(el.topColor || el.top, el.bottomColor || el.bottom, el.starCount || 0, el.starColor || "#e6efff", el.starMinSize || .5, el.starMaxSize || 2);
		skyboxState.three.scene.background = tex;
		skyboxState.worldSkybox = { texture: tex };
		return {
			type: "skybox",
			style
		};
	}
	if (style === "cubemap" && Array.isArray(el.urls) && el.urls.length === 6) try {
		const tex = new THREE.CubeTextureLoader().load(el.urls);
		skyboxState.three.scene.background = tex;
		skyboxState.worldSkybox = { texture: tex };
		return {
			type: "skybox",
			style
		};
	} catch (err) {
		console.warn("skybox cubemap load failed:", err);
		skyboxState.three.scene.background = new THREE.Color("#02040b");
		return {
			type: "skybox",
			style: "fallback-solid"
		};
	}
	console.warn("Unknown skybox style:", style);
	skyboxState.three.scene.background = new THREE.Color(el.color || "#02040b");
	return {
		type: "skybox",
		style: "fallback-solid"
	};
}
//#endregion
//#region src/objects/axis.ts
var axisState = state;
function renderAxis(el, view) {
	const axis = el.axis || "x";
	const range = el.range || [-5, 5];
	const color = parseColor(el.color || (axis === "x" ? "#ff4444" : axis === "y" ? "#44ff44" : "#4488ff"));
	const width = el.width || 2;
	const opacity = el.opacity !== void 0 ? Number(el.opacity) : 1;
	const baseOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
	const label = el.label || axis;
	const showTicks = el.showTicks !== false;
	const span = Math.abs((range[1] || 0) - (range[0] || 0));
	const defaultTickStep = span > 0 ? Math.max(1, Math.ceil(span / 24)) : 1;
	const tickStep = Math.max(1e-9, Number(el.tickStep || defaultTickStep));
	const dir = {
		x: [
			1,
			0,
			0
		],
		y: [
			0,
			1,
			0
		],
		z: [
			0,
			0,
			1
		]
	}[axis] || [
		1,
		0,
		0
	];
	const start = dir.map((d) => d * range[0]);
	const end = dir.map((d) => d * range[1]);
	const axisEntry = {
		node: null,
		baseWidth: width,
		baseOpacity,
		widthParam: "axisWidth",
		anchorDataPos: [
			(start[0] + end[0]) / 2,
			(start[1] + end[1]) / 2,
			(start[2] + end[2]) / 2
		]
	};
	const axisW = resolveLineWidth(axisEntry);
	axisEntry.node = view.array({
		channels: 3,
		width: 2,
		data: [start, end]
	}).line({
		color: new THREE.Color(...color),
		width: axisW,
		opacity: baseOpacity * (axisState.displayParams.axisOpacity || 1)
	});
	axisState.axisLineNodes.push(axisEntry);
	if (showTicks) {
		const ticks = [];
		const startTick = Math.ceil(range[0] / tickStep) * tickStep;
		const endTick = range[1];
		for (let i = startTick; i <= endTick + tickStep * 1e-6; i += tickStep) {
			if (Math.abs(i) < tickStep * .5) continue;
			ticks.push(dir.map((d) => d * i));
		}
		if (ticks.length > 0) view.array({
			channels: 3,
			width: ticks.length,
			data: ticks
		}).point({
			color: new THREE.Color(...color),
			size: 6
		});
	}
	if (label) addLabel3D(label, dir.map((d) => d * (range[1] + .3)), color, "label-3d label-axis");
}
//#endregion
//#region src/objects/grid.ts
/**
* For each grid plane: which scene-range axes it spans (indices into
* `[[xMin,xMax],[yMin,yMax],[zMin,zMax]]`) and the MathBox axis ids that
* `area` wants for the same pair.
*/
var PLANE_AXES = {
	xy: {
		scene: [0, 1],
		mathbox: [1, 2]
	},
	xz: {
		scene: [0, 2],
		mathbox: [1, 3]
	},
	yz: {
		scene: [1, 2],
		mathbox: [2, 3]
	}
};
var gridState = state;
/**
* One numeric component: a finite number, or a string that is entirely one.
*
* `Number()` alone is too permissive to guard with — it reads `''`, `'  '`,
* `null`, `false` and `[]` as 0, so a malformed range would resolve to a real
* interval of zero extent rather than being rejected. Everything this returns
* null for falls back to the scene's own range, which is the whole point of
* the guard.
*/
function toNumber(v) {
	if (typeof v === "number") return Number.isFinite(v) ? v : null;
	if (typeof v !== "string" || v.trim() === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}
/** Coerce `[a, b]` to a non-degenerate numeric interval, or null if it isn't one. */
function toInterval(v) {
	if (!Array.isArray(v) || v.length < 2) return null;
	const a = toNumber(v[0]);
	const b = toNumber(v[1]);
	return a !== null && b !== null && a !== b ? [a, b] : null;
}
/** Division counts are whole numbers of cells; anything else falls back to 10. */
function toDivisions(v) {
	const n = toNumber(v);
	return n !== null && Number.isInteger(n) && n >= 1 ? n : 10;
}
/**
* Resolve a grid element's two-axis extent and cell counts.
*
* `range` is accepted in three forms, in plane order — for `xz` the first
* entry is x and the second is z:
*
*   - omitted           inherit `sceneRange` for the plane's two axes, which
*                       is nearly always what the author meant;
*   - `[a, b]`          one interval shared by both axes (the historical form,
*                       correct only where the two axes span the same extent);
*   - `[[a,b], [c,d]]`  one interval per axis;
*   - `[[a,b], [c,d], [e,f]]`  a full 3D range, of which the plane's two axes
*                       are taken — so a scene's own `range` can be pasted in.
*
* `divisions` is either one count for both axes or `[nx, ny]`. Splitting the
* two matters because a single count cannot put grid lines on integer
* positions along two axes of different extent.
*/
function resolveGridArea(el, sceneRange) {
	const spec = PLANE_AXES[el.plane || "xy"] || PLANE_AXES["xy"];
	/** The scene's own extent for the i-th axis of this plane. */
	const inherited = (i) => toInterval(sceneRange && sceneRange[spec.scene[i]]) || [-5, 5];
	const raw = el.range;
	let rangeX;
	let rangeY;
	if (Array.isArray(raw) && Array.isArray(raw[0])) {
		const pick = raw.length >= 3 ? (i) => raw[spec.scene[i]] : (i) => raw[i];
		rangeX = toInterval(pick(0)) || inherited(0);
		rangeY = toInterval(pick(1)) || inherited(1);
	} else {
		const shared = toInterval(raw);
		rangeX = shared || inherited(0);
		rangeY = shared || inherited(1);
	}
	const divs = el.divisions;
	const perAxis = Array.isArray(divs);
	const divideX = toDivisions(perAxis ? divs[0] : divs);
	const divideY = toDivisions(perAxis ? divs[1] : divs);
	return {
		rangeX,
		rangeY,
		width: divideX + 1,
		height: divideY + 1,
		axes: spec.mathbox
	};
}
function renderGrid(el, view) {
	const color = parseColor(el.color || [
		.3,
		.3,
		.5
	]);
	const opacity = el.opacity !== void 0 ? el.opacity : .15;
	const area = resolveGridArea(el, gridState.currentRange);
	view.area({
		rangeX: area.rangeX,
		rangeY: area.rangeY,
		width: area.width,
		height: area.height,
		axes: area.axes,
		channels: 3
	}).surface({
		shaded: false,
		fill: false,
		lineX: true,
		lineY: true,
		color: new THREE.Color(...color),
		opacity,
		width: 1,
		zBias: -1
	});
}
//#endregion
//#region src/objects/vector.ts
var vectorState = state;
function makeArrowMesh(from, to, color, sizeScale, shaftBaseScale, baseOpacity = 1) {
	sizeScale = resolveArrowSizeScale(sizeScale);
	shaftBaseScale = shaftBaseScale || 1;
	const tipWorld = dataToWorld(to);
	const fromWorld = dataToWorld(from);
	const wdx = tipWorld[0] - fromWorld[0], wdy = tipWorld[1] - fromWorld[1], wdz = tipWorld[2] - fromWorld[2];
	const wLen = Math.sqrt(wdx * wdx + wdy * wdy + wdz * wdz);
	if (wLen < 1e-4) return;
	const currentScale = vectorState.currentScale;
	const worldSceneSize = Math.min(currentScale[0], currentScale[1]) * 2;
	const baseHeadLen = Math.max(Math.min(wLen * .25, worldSceneSize * ARROW_HEAD_MAX_FACTOR), worldSceneSize * ARROW_HEAD_MIN_FACTOR) * sizeScale;
	const autoScale = resolveSmallVectorAutoScale(wLen, baseHeadLen);
	const wHeadLen = baseHeadLen * autoScale;
	const wHeadRadius = wHeadLen * ARROW_HEAD_RADIUS_RATIO;
	const overlapLen = Math.max(wHeadLen * 0, 0);
	const shaftLen = Math.max(wLen - wHeadLen + overlapLen, 1e-4);
	const shaftRadius = wHeadRadius * SHAFT_RADIUS_TO_HEAD_RADIUS_RATIO;
	const dir = new THREE.Vector3(wdx / wLen, wdy / wLen, wdz / wLen);
	const up = new THREE.Vector3(0, 1, 0);
	const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
	const shaftGeom = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLen, 16);
	const shaftOpacity = Math.max(0, Math.min(1, Number.isFinite(baseOpacity) ? baseOpacity : 1));
	const shaftMat = new THREE.MeshPhongMaterial({
		color: new THREE.Color(...color),
		shininess: 60,
		transparent: shaftOpacity < .999,
		opacity: shaftOpacity
	});
	const shaft = new THREE.Mesh(shaftGeom, shaftMat);
	shaft.position.set(fromWorld[0] + dir.x * shaftLen / 2, fromWorld[1] + dir.y * shaftLen / 2, fromWorld[2] + dir.z * shaftLen / 2);
	shaft.setRotationFromQuaternion(quat);
	shaft.userData.baseThicknessScale = shaftBaseScale;
	shaft.userData.autoThicknessScale = autoScale;
	shaft.userData.lengthScale = 1;
	shaft.userData.baseShaftRadius = shaftRadius;
	shaft.userData.maxRadiusFromHead = wHeadRadius * .75;
	applyShaftThickness(shaft);
	vectorState.three.scene.add(shaft);
	const arrowPair = {
		fromWorld: new THREE.Vector3(...fromWorld),
		tipWorld: new THREE.Vector3(...tipWorld),
		dir: dir.clone(),
		baseHeadLen: wHeadLen,
		baseShaftLen: shaftLen,
		dynamic: false
	};
	shaft.userData.arrowPair = arrowPair;
	shaft.userData.baseOpacity = shaftOpacity;
	vectorState.arrowMeshes.push({
		mesh: shaft,
		tipWorld: new THREE.Vector3(fromWorld[0] + dir.x * shaftLen, fromWorld[1] + dir.y * shaftLen, fromWorld[2] + dir.z * shaftLen),
		dir: dir.clone(),
		wLen: shaftLen,
		isShaft: true
	});
	const coneGeom = new THREE.ConeGeometry(wHeadRadius, wHeadLen, 16);
	const coneOpacity = Math.max(0, Math.min(1, Number.isFinite(baseOpacity) ? baseOpacity : 1));
	const coneMat = new THREE.MeshPhongMaterial({
		color: new THREE.Color(...color),
		shininess: 60,
		transparent: coneOpacity < .999,
		opacity: coneOpacity
	});
	const cone = new THREE.Mesh(coneGeom, coneMat);
	cone.position.set(tipWorld[0] - dir.x * wHeadLen / 2, tipWorld[1] - dir.y * wHeadLen / 2, tipWorld[2] - dir.z * wHeadLen / 2);
	cone.setRotationFromQuaternion(quat);
	cone.userData.arrowPair = arrowPair;
	cone.userData.baseOpacity = coneOpacity;
	arrowPair.shaft = shaft;
	arrowPair.cone = cone;
	vectorState.three.scene.add(cone);
	vectorState.arrowMeshes.push({
		mesh: cone,
		tipWorld: new THREE.Vector3(...tipWorld),
		dir: dir.clone(),
		wLen: wHeadLen
	});
}
function renderVector(el, view) {
	const from = el.origin || el.from || [
		0,
		0,
		0
	];
	const to = el.to || [
		1,
		0,
		0
	];
	const color = parseColor(el.color || "#ff6644");
	const label = el.label;
	const elementOpacity = typeof el.opacity === "number" && isFinite(el.opacity) ? Math.max(0, Math.min(1, el.opacity)) : 1;
	makeArrowMesh(from, to, color, vectorState.displayParams.arrowScale, 1, elementOpacity);
	if (label) {
		const lo = Array.isArray(el.labelOffset) && el.labelOffset.length === 3 ? [
			Number(el.labelOffset[0]) || 0,
			Number(el.labelOffset[1]) || 0,
			Number(el.labelOffset[2]) || 0
		] : null;
		if (el.labelPosition) addLabel3D(label, el.labelPosition, color);
		else addLabel3D(label, [
			(from[0] + to[0]) / 2 + (lo ? lo[0] : 0),
			(from[1] + to[1]) / 2 + .15 + (lo ? lo[1] : 0),
			(from[2] + to[2]) / 2 + (lo ? lo[2] : 0)
		], color);
	}
	return {
		type: "vector",
		color,
		label
	};
}
//#endregion
//#region src/objects/vectors.ts
var vectorsState = state;
function renderVectors(el, view) {
	const tos = el.tos || [];
	const froms = el.froms || tos.map(() => [
		0,
		0,
		0
	]);
	const color = parseColor(el.color || "#ff8800");
	const shaftBaseScale = 1;
	const elementOpacity = typeof el.opacity === "number" && isFinite(el.opacity) ? Math.max(0, Math.min(1, el.opacity)) : 1;
	for (let i = 0; i < tos.length; i++) {
		const from = froms[i] || [
			0,
			0,
			0
		];
		const to = tos[i];
		if (!to) continue;
		makeArrowMesh(from, to, color, vectorsState.displayParams.arrowScale, shaftBaseScale, elementOpacity);
	}
	return {
		type: "vectors",
		color
	};
}
//#endregion
//#region src/objects/point.ts
var pointState = state;
function renderPoint(el, view) {
	const pos = el.position || el.at || [
		0,
		0,
		0
	];
	const color = parseColor(el.color || "#ffcc00");
	const size = el.size || 12;
	const label = el.label;
	const positions = el.positions || [pos];
	const pointNode = view.array({
		channels: 3,
		width: positions.length,
		data: positions
	}).point({
		color: new THREE.Color(...color),
		size,
		zBias: 5
	});
	pointState.pointNodes.push({ node: pointNode });
	if (label && positions.length === 1) addLabel3D(label, [
		positions[0][0],
		positions[0][1] + .2,
		positions[0][2]
	], color);
	return {
		type: "point",
		color,
		label
	};
}
//#endregion
//#region src/objects/line.ts
var lineState = state;
function renderLine(el, view) {
	const points = el.points || el.data || (el.from && el.to ? [el.from, el.to] : null) || [[
		0,
		0,
		0
	], [
		1,
		1,
		1
	]];
	const color = parseColor(el.color || "#88aaff");
	const width = el.width || 3;
	const opacity = el.opacity !== void 0 ? Number(el.opacity) : 1;
	const baseOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
	const label = el.label;
	const lineEntry = {
		node: null,
		baseWidth: width,
		baseOpacity,
		widthParam: "lineWidth",
		anchorDataPos: points[Math.floor(points.length / 2)] || [
			0,
			0,
			0
		]
	};
	const lineW = resolveLineWidth(lineEntry);
	lineEntry.node = view.array({
		channels: 3,
		width: points.length,
		data: points
	}).line({
		color: new THREE.Color(...color),
		width: lineW,
		zBias: 1,
		opacity: baseOpacity * (lineState.displayParams.lineOpacity || 1)
	});
	lineState.lineNodes.push(lineEntry);
	if (label) {
		const mid = points[Math.floor(points.length / 2)];
		addLabel3D(label, mid, color);
	}
	return {
		type: "line",
		color,
		label
	};
}
//#endregion
//#region src/objects/surface.ts
var surfaceState = state;
function renderSurface(el, view) {
	const color = parseColor(el.color || "#4488ff");
	const opacity = el.opacity !== void 0 ? el.opacity : .6;
	const rangeX = el.rangeX || [-2, 2];
	const rangeY = el.rangeY || [-2, 2];
	const expr = el.expression || el.expr || "x + y";
	const res = el.resolution || 32;
	const label = el.label;
	const data = [];
	const dx = (rangeX[1] - rangeX[0]) / res;
	const dy = (rangeY[1] - rangeY[0]) / res;
	for (let j = 0; j <= res; j++) for (let i = 0; i <= res; i++) {
		const x = rangeX[0] + i * dx;
		const y = rangeY[0] + j * dy;
		let z;
		try {
			if (_JS_ONLY_RE.test(expr) && surfaceState._sceneJsTrustState === "trusted") z = new Function("x", "y", "return " + expr)(x, y);
			else if (_JS_ONLY_RE.test(expr)) z = 0;
			else z = _mathjs.evaluate(expr, {
				x,
				y
			});
		} catch (e) {
			z = 0;
		}
		data.push([
			x,
			z,
			y
		]);
	}
	view.matrix({
		channels: 3,
		width: res + 1,
		height: res + 1,
		data
	}).surface({
		shaded: true,
		color: new THREE.Color(...color),
		opacity,
		zBias: 0
	});
	return {
		type: "surface",
		color,
		label
	};
}
//#endregion
//#region src/objects/curve-range.ts
/** The interval a parametric curve is sampled over: `rangeExpr`, else `range`,
*  else `[0, 2π]`. Each end may be a number or a math.js string.
*
* `rangeExpr` FIRST, which `animated-curve.ts` has always done and this module
* had never done. A curve's interval goes to `rangeExpr` the moment either end
* is an expression — `0` to `4*pi`, or an end naming a slider — so reading only
* `range` silently fell back to [0, 2π] and drew a shorter curve than the scene
* asked for. No error and no warning: the endpoints it ignored were still
* schema-legal, and subtracting the fallback's gives a perfectly good number.
*
* Observed on a DNA double helix whose strands ran `0` to `4*pi`. They stopped
* half way up a ladder of rungs that spanned the whole length, because the rungs
* were `line`s placed from the very numbers the curve discarded. Nothing in the
* corpus writes `rangeExpr` on a parametric curve, which is why it survived —
* the in-app scene builder is the first thing to emit one.
*
* `evaluate` is injected so this stays testable without math.js, and so the
* caller can compile once and re-evaluate per build.
*/
function resolveCurveRange(el, evaluate) {
	const spec = el.rangeExpr || el.range || [0, 2 * Math.PI];
	const end = (raw, fallback) => {
		let v;
		try {
			v = typeof raw === "string" ? evaluate(raw) : Number(raw);
		} catch {
			return fallback;
		}
		return Number.isFinite(v) ? v : fallback;
	};
	return [end(spec[0], 0), end(spec[1], 2 * Math.PI)];
}
//#endregion
//#region src/objects/parametric-curve.ts
var parametricCurveState = state;
function renderParametricCurve(el, view) {
	const color = parseColor(el.color || "#ff88aa");
	const width = el.width || 3;
	const samples = el.samples || 128;
	const opacity = el.opacity !== void 0 ? Number(el.opacity) : 1;
	const baseOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
	const label = el.label;
	const labelOffset = Array.isArray(el.labelOffset) && el.labelOffset.length === 3 ? [
		Number(el.labelOffset[0]) || 0,
		Number(el.labelOffset[1]) || 0,
		Number(el.labelOffset[2]) || 0
	] : [
		0,
		.3,
		0
	];
	const exprX = el.x || "Math.cos(t)";
	const exprY = el.y || "Math.sin(t)";
	const exprZ = el.z || "0";
	const compiled = /* @__PURE__ */ new Map();
	const evaluate = (expr) => {
		let c = compiled.get(expr);
		if (!c) {
			c = compileExpr(expr);
			compiled.set(expr, c);
		}
		return Number(evalExpr(c, 0, { useVirtualTime: false }));
	};
	function buildPoints(fnX, fnY, fnZ) {
		const pts = [];
		const range = resolveCurveRange(el, evaluate);
		const dt = (range[1] - range[0]) / samples;
		const opts = {
			useVirtualTime: false,
			extraScope: { u: 0 }
		};
		for (let i = 0; i <= samples; i++) {
			const t = range[0] + i * dt;
			opts.extraScope.u = t;
			try {
				const x = evalExpr(fnX, t, opts);
				const y = evalExpr(fnY, t, opts);
				const z = evalExpr(fnZ, t, opts);
				pts.push([
					isFinite(x) ? x : 0,
					isFinite(y) ? y : 0,
					isFinite(z) ? z : 0
				]);
			} catch (e) {
				pts.push([
					0,
					0,
					0
				]);
			}
		}
		return pts;
	}
	let fnX = compileExpr(exprX);
	let fnY = compileExpr(exprY);
	let fnZ = compileExpr(exprZ);
	const points = buildPoints(fnX, fnY, fnZ);
	const curveEntry = {
		node: null,
		baseWidth: width,
		baseOpacity,
		widthParam: "lineWidth",
		anchorDataPos: points[Math.floor(points.length / 2)] || [
			0,
			0,
			0
		]
	};
	const lineW = resolveLineWidth(curveEntry);
	const curveData = view.array({
		channels: 3,
		width: points.length,
		data: points,
		live: true
	});
	curveEntry.node = curveData.line({
		color: new THREE.Color(...color),
		width: lineW,
		opacity: baseOpacity * (parametricCurveState.displayParams.lineOpacity || 1)
	});
	parametricCurveState.lineNodes.push(curveEntry);
	let labelEl = null;
	if (label) {
		const mid = points[Math.floor(points.length / 2)];
		labelEl = addLabel3D(label, [
			mid[0] + labelOffset[0],
			mid[1] + labelOffset[1],
			mid[2] + labelOffset[2]
		], color);
	}
	const animState = { stopped: false };
	const animExprEntry = {
		exprStrings: [
			exprX,
			exprY,
			exprZ
		],
		animState,
		compiledFns: [
			fnX,
			fnY,
			fnZ
		],
		_isParametricCurve: true,
		_rebuildFn() {
			const pts = buildPoints(compileExpr(exprX), compileExpr(exprY), compileExpr(exprZ));
			curveData.set("data", pts);
			if (labelEl) {
				const mid = pts[Math.floor(pts.length / 2)];
				labelEl.dataPos[0] = mid[0] + labelOffset[0];
				labelEl.dataPos[1] = mid[1] + labelOffset[1];
				labelEl.dataPos[2] = mid[2] + labelOffset[2];
			}
		}
	};
	parametricCurveState.activeAnimExprs.push(animExprEntry);
	return {
		type: "parametric_curve",
		color,
		label,
		_animState: animState,
		_animExprEntry: animExprEntry
	};
}
//#endregion
//#region src/objects/parametric-surface.ts
var parametricSurfaceState = state;
function renderParametricSurface(el, view) {
	const color = parseColor(el.color || "#66aaff");
	const opacity = el.opacity !== void 0 ? el.opacity : .6;
	const rangeU = el.rangeU || el.uRange || [0, 2 * Math.PI];
	const rangeV = el.rangeV || el.vRange || [0, 2 * Math.PI];
	const resU = el.resolutionU || el.uSamples || el.resolution || 32;
	const resV = el.resolutionV || el.vSamples || el.resolution || 32;
	const label = el.label;
	const exprX = el.x || "Math.sin(v) * Math.cos(u)";
	const exprY = el.y || "Math.sin(v) * Math.sin(u)";
	const exprZ = el.z || "Math.cos(v)";
	function buildPositions(fnX, fnY, fnZ) {
		const numVerts = (resU + 1) * (resV + 1);
		const pos = new Float32Array(numVerts * 3);
		const du = (rangeU[1] - rangeU[0]) / resU;
		const dv = (rangeV[1] - rangeV[0]) / resV;
		let idx = 0;
		for (let j = 0; j <= resV; j++) for (let i = 0; i <= resU; i++) {
			const u = rangeU[0] + i * du;
			const v = rangeV[0] + j * dv;
			let x = 0, y = 0, z = 0;
			try {
				x = evalSurfaceExpr(fnX, u, v);
				y = evalSurfaceExpr(fnY, u, v);
				z = evalSurfaceExpr(fnZ, u, v);
			} catch (e) {}
			const w = dataToWorld([
				isFinite(x) ? x : 0,
				isFinite(y) ? y : 0,
				isFinite(z) ? z : 0
			]);
			pos[idx++] = w[0];
			pos[idx++] = w[1];
			pos[idx++] = w[2];
		}
		return pos;
	}
	function buildIndices() {
		const indices = new Uint32Array(resU * resV * 6);
		let idx = 0;
		for (let j = 0; j < resV; j++) for (let i = 0; i < resU; i++) {
			const a = j * (resU + 1) + i;
			const b = a + 1;
			const c = a + (resU + 1);
			const d = c + 1;
			indices[idx++] = a;
			indices[idx++] = b;
			indices[idx++] = d;
			indices[idx++] = a;
			indices[idx++] = d;
			indices[idx++] = c;
		}
		return indices;
	}
	const fnX = compileSurfaceExpr(exprX);
	const fnY = compileSurfaceExpr(exprY);
	const fnZ = compileSurfaceExpr(exprZ);
	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.Float32BufferAttribute(buildPositions(fnX, fnY, fnZ), 3));
	geom.setIndex(new THREE.BufferAttribute(buildIndices(), 1));
	geom.computeVertexNormals();
	const mat = new THREE.MeshPhongMaterial({
		color: new THREE.Color(...color),
		opacity,
		transparent: true,
		side: THREE.DoubleSide,
		depthWrite: false,
		shininess: 40
	});
	const mesh = new THREE.Mesh(geom, mat);
	mesh.userData.targetOpacity = opacity;
	mesh.userData.isParametricSurface = true;
	mesh.renderOrder = parametricSurfaceState._planeMeshSerial;
	mesh.position.z = parametricSurfaceState._planeMeshSerial * 2e-4;
	parametricSurfaceState._planeMeshSerial++;
	parametricSurfaceState.three.scene.add(mesh);
	parametricSurfaceState.planeMeshes.push(mesh);
	const animState = { stopped: false };
	const animExprEntry = {
		exprStrings: [
			exprX,
			exprY,
			exprZ
		],
		animState,
		compiledFns: [
			fnX,
			fnY,
			fnZ
		],
		_isParametricSurface: true,
		_rebuildFn() {
			const pos = buildPositions(compileSurfaceExpr(exprX), compileSurfaceExpr(exprY), compileSurfaceExpr(exprZ));
			geom.attributes.position.array.set(pos);
			geom.attributes.position.needsUpdate = true;
			geom.computeVertexNormals();
		}
	};
	parametricSurfaceState.activeAnimExprs.push(animExprEntry);
	return {
		type: "parametric_surface",
		color,
		label,
		_animState: animState,
		_animExprEntry: animExprEntry
	};
}
//#endregion
//#region src/objects/sphere.ts
var sphereState = state;
function _makeSurfaceMaterial(el, color, opacity, defaults = {}) {
	const matType = el.shader && el.shader.type === "basic" ? THREE.MeshBasicMaterial : THREE.MeshPhongMaterial;
	const matOpts = {
		color: new THREE.Color(...color),
		transparent: true,
		opacity,
		side: THREE.DoubleSide
	};
	const sh = el.shader || {};
	matOpts.depthWrite = sh.depthWrite !== void 0 ? !!sh.depthWrite : !(opacity < 1);
	if (sh.depthTest !== void 0) matOpts.depthTest = !!sh.depthTest;
	if (matType === THREE.MeshPhongMaterial) {
		matOpts.shininess = sh.shininess !== void 0 ? sh.shininess : defaults.shininess !== void 0 ? defaults.shininess : 40;
		if (sh.emissive) matOpts.emissive = new THREE.Color(sh.emissive);
		if (sh.specular) matOpts.specular = new THREE.Color(sh.specular);
		if (sh.flatShading) matOpts.flatShading = true;
	}
	return new matType(matOpts);
}
function _dataAxisScaleFromCenter(centerData, rx, ry, rz) {
	const centerW = new THREE.Vector3(...dataToWorld(centerData));
	const xW = new THREE.Vector3(...dataToWorld([
		centerData[0] + rx,
		centerData[1],
		centerData[2]
	]));
	const yW = new THREE.Vector3(...dataToWorld([
		centerData[0],
		centerData[1] + ry,
		centerData[2]
	]));
	const zW = new THREE.Vector3(...dataToWorld([
		centerData[0],
		centerData[1],
		centerData[2] + rz
	]));
	return {
		centerW,
		sx: Math.max(centerW.distanceTo(xW), 1e-4),
		sy: Math.max(centerW.distanceTo(yW), 1e-4),
		sz: Math.max(centerW.distanceTo(zW), 1e-4)
	};
}
function renderSphere(el, view) {
	const color = parseColor(el.color || "#66aaff");
	const opacity = el.opacity !== void 0 ? el.opacity : .8;
	const label = el.label;
	const widthSegments = el.widthSegments || el.segments || 32;
	const heightSegments = el.heightSegments || el.rings || 20;
	const centerExpr = Array.isArray(el.centerExpr) && el.centerExpr.length === 3 ? el.centerExpr : (Array.isArray(el.center) && el.center.length === 3 ? el.center : Array.isArray(el.position) ? el.position : [
		0,
		0,
		0
	]).map((v) => String(v));
	const radiusExpr = typeof el.radiusExpr === "string" ? el.radiusExpr : String(el.radius !== void 0 ? el.radius : 1);
	let centerFns, radiusFn;
	try {
		centerFns = centerExpr.map((e) => compileExpr(e));
		radiusFn = compileExpr(radiusExpr);
	} catch (err) {
		console.warn("sphere expr compile error:", err);
		return null;
	}
	function evalState() {
		return {
			center: centerFns.map((fn) => evalExpr(fn, 0)),
			radius: Math.max(Math.abs(evalExpr(radiusFn, 0)), 1e-4)
		};
	}
	const geom = new THREE.SphereGeometry(1, widthSegments, heightSegments);
	const mat = _makeSurfaceMaterial(el, color, opacity, { shininess: 50 });
	const mesh = new THREE.Mesh(geom, mat);
	mesh.userData.targetOpacity = opacity;
	sphereState.three.scene.add(mesh);
	sphereState.planeMeshes.push(mesh);
	let labelEl = null;
	if (label) labelEl = addLabel3D(label, [
		0,
		0,
		0
	], color);
	const animState = { stopped: false };
	const animExprEntry = {
		exprStrings: [...centerExpr, radiusExpr],
		animState,
		_rebuildFn() {
			const s = evalState();
			const world = _dataAxisScaleFromCenter(s.center, s.radius, s.radius, s.radius);
			mesh.position.copy(world.centerW);
			mesh.scale.set(world.sx, world.sy, world.sz);
			if (labelEl) {
				labelEl.dataPos[0] = s.center[0];
				labelEl.dataPos[1] = s.center[1] + s.radius * 1.05;
				labelEl.dataPos[2] = s.center[2];
			}
		}
	};
	sphereState.activeAnimExprs.push(animExprEntry);
	animExprEntry._rebuildFn();
	return {
		type: "sphere",
		color,
		label,
		_animState: animState,
		_animExprEntry: animExprEntry
	};
}
//#endregion
//#region src/objects/ellipsoid.ts
var ellipsoidState = state;
function renderEllipsoid(el, view) {
	const color = parseColor(el.color || "#66aaff");
	const opacity = el.opacity !== void 0 ? el.opacity : .8;
	const label = el.label;
	const widthSegments = el.widthSegments || el.segments || 32;
	const heightSegments = el.heightSegments || el.rings || 20;
	const centerExpr = Array.isArray(el.centerExpr) && el.centerExpr.length === 3 ? el.centerExpr : (Array.isArray(el.center) && el.center.length === 3 ? el.center : Array.isArray(el.position) ? el.position : [
		0,
		0,
		0
	]).map((v) => String(v));
	const radiiExpr = Array.isArray(el.radiiExpr) && el.radiiExpr.length === 3 ? el.radiiExpr : (() => {
		if (Array.isArray(el.radii) && el.radii.length === 3) return el.radii.map((v) => String(v));
		const rx = el.rx !== void 0 ? el.rx : el.xRadius !== void 0 ? el.xRadius : 1;
		const ry = el.ry !== void 0 ? el.ry : el.yRadius !== void 0 ? el.yRadius : rx;
		const rz = el.rz !== void 0 ? el.rz : el.zRadius !== void 0 ? el.zRadius : rx;
		return [
			String(rx),
			String(ry),
			String(rz)
		];
	})();
	let centerFns, radiiFns;
	try {
		centerFns = centerExpr.map((e) => compileExpr(e));
		radiiFns = radiiExpr.map((e) => compileExpr(e));
	} catch (err) {
		console.warn("ellipsoid expr compile error:", err);
		return null;
	}
	function evalState() {
		return {
			center: centerFns.map((fn) => evalExpr(fn, 0)),
			rx: Math.max(Math.abs(evalExpr(radiiFns[0], 0)), 1e-4),
			ry: Math.max(Math.abs(evalExpr(radiiFns[1], 0)), 1e-4),
			rz: Math.max(Math.abs(evalExpr(radiiFns[2], 0)), 1e-4)
		};
	}
	const geom = new THREE.SphereGeometry(1, widthSegments, heightSegments);
	const mat = _makeSurfaceMaterial(el, color, opacity, { shininess: 50 });
	const mesh = new THREE.Mesh(geom, mat);
	mesh.userData.targetOpacity = opacity;
	ellipsoidState.three.scene.add(mesh);
	ellipsoidState.planeMeshes.push(mesh);
	let labelEl = null;
	if (label) labelEl = addLabel3D(label, [
		0,
		0,
		0
	], color);
	const animState = { stopped: false };
	const animExprEntry = {
		exprStrings: [...centerExpr, ...radiiExpr],
		animState,
		_rebuildFn() {
			const s = evalState();
			const world = _dataAxisScaleFromCenter(s.center, s.rx, s.ry, s.rz);
			mesh.position.copy(world.centerW);
			mesh.scale.set(world.sx, world.sy, world.sz);
			if (labelEl) {
				labelEl.dataPos[0] = s.center[0];
				labelEl.dataPos[1] = s.center[1] + s.ry * 1.05;
				labelEl.dataPos[2] = s.center[2];
			}
		}
	};
	ellipsoidState.activeAnimExprs.push(animExprEntry);
	animExprEntry._rebuildFn();
	return {
		type: "ellipsoid",
		color,
		label,
		_animState: animState,
		_animExprEntry: animExprEntry
	};
}
//#endregion
//#region src/objects/vector-field.ts
var vectorFieldState = state;
function renderVectorField(el, view) {
	const color = parseColor(el.color || "#88ccff");
	const opacity = el.opacity !== void 0 ? el.opacity : .6;
	const range = el.range || [
		[-2, 2],
		[-2, 2],
		[-2, 2]
	];
	const density = el.density || 3;
	const scale = el.scale || .3;
	const label = el.label;
	const exprX = el.fx || "y";
	const exprY = el.fy || "-x";
	const exprZ = el.fz || "0";
	const _compileVF = (e) => {
		if (_JS_ONLY_RE.test(e)) {
			if (vectorFieldState._sceneJsTrustState === "trusted") return new Function("x", "y", "z", "return " + e);
			return null;
		}
		return _mathjs.compile(e);
	};
	const _evalVF = (compiled, x, y, z) => {
		if (!compiled) return 0;
		if (typeof compiled === "function") return compiled(x, y, z);
		return compiled.evaluate({
			x,
			y,
			z
		});
	};
	const compiledX = _compileVF(exprX);
	const compiledY = _compileVF(exprY);
	const compiledZ = _compileVF(exprZ);
	const starts = [];
	const ends = [];
	const rangeX = range[0], rangeY = range[1], rangeZ = range[2];
	const dxStep = (rangeX[1] - rangeX[0]) / density;
	const dyStep = (rangeY[1] - rangeY[0]) / density;
	const dzStep = (rangeZ[1] - rangeZ[0]) / density;
	for (let xi = 0; xi <= density; xi++) for (let yi = 0; yi <= density; yi++) for (let zi = 0; zi <= density; zi++) {
		const x = rangeX[0] + xi * dxStep;
		const y = rangeY[0] + yi * dyStep;
		const z = rangeZ[0] + zi * dzStep;
		try {
			const vx = _evalVF(compiledX, x, y, z);
			const vy = _evalVF(compiledY, x, y, z);
			const vz = _evalVF(compiledZ, x, y, z);
			starts.push([
				x,
				y,
				z
			]);
			ends.push([
				x + vx * scale,
				y + vy * scale,
				z + vz * scale
			]);
		} catch (e) {}
	}
	for (let i = 0; i < starts.length; i++) view.array({
		channels: 3,
		width: 2,
		data: [starts[i], ends[i]]
	}).line({
		color: new THREE.Color(...color),
		width: 2,
		opacity
	});
	if (starts.length > 0) view.array({
		channels: 3,
		width: ends.length,
		data: ends
	}).point({
		color: new THREE.Color(...color),
		size: 4,
		opacity
	});
	return {
		type: "vector_field",
		color,
		label
	};
}
//#endregion
//#region src/objects/plane.ts
function renderPlane(el, view) {
	const color = parseColor(el.color || "#4466aa");
	const opacity = el.opacity !== void 0 ? el.opacity : .5;
	const normal = el.normal || [
		0,
		1,
		0
	];
	const point = el.point || [
		0,
		0,
		0
	];
	const size = el.size || 4;
	const label = el.label;
	const n = new THREE.Vector3(...normal).normalize();
	let t1;
	if (Math.abs(n.x) < .9) t1 = new THREE.Vector3(1, 0, 0).cross(n).normalize();
	else t1 = new THREE.Vector3(0, 1, 0).cross(n).normalize();
	const t2 = n.clone().cross(t1).normalize();
	const half = size / 2;
	const res = 2;
	const data = [];
	for (let j = 0; j <= res; j++) for (let i = 0; i <= res; i++) {
		const u = (i / res * 2 - 1) * half;
		const v = (j / res * 2 - 1) * half;
		data.push([
			point[0] + t1.x * u + t2.x * v,
			point[1] + t1.y * u + t2.y * v,
			point[2] + t1.z * u + t2.z * v
		]);
	}
	view.matrix({
		channels: 3,
		width: 3,
		height: 3,
		data
	}).surface({
		shaded: false,
		color: new THREE.Color(...color),
		opacity,
		zBias: -2
	});
	if (label) addLabel3D(label, point, color);
	return {
		type: "plane",
		color,
		label
	};
}
//#endregion
//#region src/objects/text.ts
var textState = state;
function renderText(el, view) {
	const text = el.text || el.value || "";
	const color = parseColor(el.color || "#ffffff");
	const exprStrings = el.positionExpr || (Array.isArray(el.position) && el.position.length === 3 ? el.position.map((v) => String(v)) : null) || (Array.isArray(el.at) && el.at.length === 3 ? el.at.map((v) => String(v)) : null);
	if (Array.isArray(exprStrings) && exprStrings.length === 3) {
		let exprFns;
		let initPos;
		try {
			exprFns = exprStrings.map((e) => compileExpr(e));
			initPos = exprFns.map((fn) => evalExpr(fn, 0));
		} catch (err) {
			console.warn("text positionExpr compile/eval error:", err);
			return null;
		}
		const labelOpts = {
			align: el.align,
			cssClass: el.cssClass
		};
		const labelEl = addLabel3D(text, initPos, color, labelOpts);
		const startTime = textState.sceneStartTime;
		let textExprFn = null;
		const textFormat = el.textFormat || "%d";
		if (el.textExpr) try {
			textExprFn = compileExpr(el.textExpr);
		} catch (_e) {}
		let prevTextVal = null;
		let visibleFn = null;
		if (typeof el.visibleExpr === "string" && el.visibleExpr.trim()) try {
			visibleFn = compileExpr(el.visibleExpr.trim());
		} catch (err) {
			console.warn("text visibleExpr compile error:", err);
		}
		let prevVisible = null;
		textState.activeAnimUpdaters.push({
			animState: { stopped: false },
			updateFrame(nowMs) {
				const tSec = (nowMs - startTime) / 1e3;
				try {
					const p = exprFns.map((fn) => evalExpr(fn, tSec));
					labelEl.dataPos[0] = p[0];
					labelEl.dataPos[1] = p[1];
					labelEl.dataPos[2] = p[2];
				} catch (_err) {}
				if (visibleFn) try {
					const vis = !!evalExpr(visibleFn, tSec);
					if (vis !== prevVisible) {
						prevVisible = vis;
						labelEl.el.style.visibility = vis ? "" : "hidden";
					}
				} catch (_err) {}
				if (textExprFn) try {
					const raw = evalExpr(textExprFn, tSec);
					if (!Number.isFinite(raw)) return;
					const rounded = Math.round(raw);
					if (rounded !== prevTextVal) {
						prevTextVal = rounded;
						const formatted = textFormat.replace("%d", rounded);
						labelEl.el.innerHTML = renderKaTeX$1(formatted, false);
					}
				} catch (_err) {}
			}
		});
		return {
			type: "text",
			color,
			label: text
		};
	}
	addLabel3D(text, el.position || el.at || [
		0,
		0,
		0
	], color, {
		align: el.align,
		cssClass: el.cssClass
	});
	return {
		type: "text",
		color,
		label: text
	};
}
//#endregion
//#region src/objects/animated-vector.ts
var animatedVectorState = state;
function renderAnimatedVector(el, view) {
	const ownerToken = {};
	const color = parseColor(el.color || "#ff8844");
	const shader = el.shader || {};
	const emissive = parseColor(shader.emissive || "#000000");
	const specular = parseColor(shader.specular || "#111111");
	const shininess = typeof shader.shininess === "number" && isFinite(shader.shininess) ? shader.shininess : 60;
	const label = el.label;
	const elementOpacity = typeof el.opacity === "number" && isFinite(el.opacity) ? Math.max(0, Math.min(1, el.opacity)) : 1;
	const depthWrite = shader.depthWrite !== void 0 ? !!shader.depthWrite : elementOpacity >= .999;
	const depthTest = shader.depthTest !== void 0 ? !!shader.depthTest : true;
	const renderOrder = typeof el.renderOrder === "number" && isFinite(el.renderOrder) ? el.renderOrder : null;
	const labelOffset = Array.isArray(el.labelOffset) && el.labelOffset.length === 3 ? [
		Number(el.labelOffset[0]) || 0,
		Number(el.labelOffset[1]) || 0,
		Number(el.labelOffset[2]) || 0
	] : [
		0,
		.3,
		0
	];
	const keyframes = el.keyframes || [];
	const duration = el.duration || 2e3;
	const loop = el.loop !== false;
	const exprStrings = el.expr || el.toExpr || (Array.isArray(el.to) && el.to.length === 3 ? el.to.map((v) => String(v)) : null);
	const fromExprStrings = el.fromExpr;
	const visibleExprString = typeof el.visibleExpr === "string" && el.visibleExpr.trim() ? el.visibleExpr.trim() : null;
	const labelExprString = typeof el.labelExpr === "string" && el.labelExpr.trim() ? el.labelExpr.trim() : null;
	const trailOpts = el.trail;
	const panelOpts = el.panels && typeof el.panels === "object" ? el.panels : null;
	const widthScale = typeof el.width === "number" && isFinite(el.width) ? Math.max(.01, el.width) : 1.3;
	const widthHeadScale = Math.max(.4, Math.sqrt(widthScale));
	const localArrowScale = (el.arrowScale !== void 0 ? el.arrowScale : 1) * widthHeadScale;
	const localArrowMinFactor = el.arrowMinFactor !== void 0 ? el.arrowMinFactor : ARROW_HEAD_MIN_FACTOR;
	const localArrowMaxFactor = el.arrowMaxFactor !== void 0 ? el.arrowMaxFactor : ARROW_HEAD_MAX_FACTOR;
	const shaftBaseScale = typeof el.shaftScale === "number" && isFinite(el.shaftScale) ? Math.max(.01, widthScale * el.shaftScale) : widthScale * 1;
	const useExpr = Array.isArray(exprStrings) && exprStrings.length === 3;
	const useFromExpr = Array.isArray(fromExprStrings) && fromExprStrings.length === 3;
	if (!useExpr && keyframes.length === 0) return null;
	const initFrom = el.origin || el.from || (keyframes.length > 0 ? keyframes[0].origin || keyframes[0].from || [
		0,
		0,
		0
	] : [
		0,
		0,
		0
	]);
	let initTo;
	if (useExpr) try {
		initTo = exprStrings.map((e) => evalExpr(compileExpr(e), 0));
	} catch (err) {
		console.warn("animated_vector expr eval error:", err);
		initTo = [
			1,
			0,
			0
		];
	}
	else initTo = keyframes[0].to || [
		1,
		0,
		0
	];
	if (useFromExpr) try {
		const evalFrom = fromExprStrings.map((e) => evalExpr(compileExpr(e), 0));
		initFrom[0] = evalFrom[0];
		initFrom[1] = evalFrom[1];
		initFrom[2] = evalFrom[2];
	} catch (err) {
		console.warn("animated_vector fromExpr eval error:", err);
	}
	const vecScale = typeof el.scale === "number" && isFinite(el.scale) ? el.scale : 1;
	initFrom.slice();
	let currentTo = initTo.slice();
	function applyVecScale(from, to) {
		if (vecScale === 1) return to;
		return [
			from[0] + (to[0] - from[0]) * vecScale,
			from[1] + (to[1] - from[1]) * vecScale,
			from[2] + (to[2] - from[2]) * vecScale
		];
	}
	function computeArrowParams(from, to) {
		to = applyVecScale(from, to);
		const tipWorld = dataToWorld(to);
		const fromWorld = dataToWorld(from);
		const wdx = tipWorld[0] - fromWorld[0], wdy = tipWorld[1] - fromWorld[1], wdz = tipWorld[2] - fromWorld[2];
		const wLen = Math.sqrt(wdx * wdx + wdy * wdy + wdz * wdz);
		const currentScale = animatedVectorState.currentScale;
		const worldSceneSize = Math.min(currentScale[0], currentScale[1]) * 2;
		const effectiveArrowScale = resolveArrowSizeScale(localArrowScale * (animatedVectorState.displayParams.arrowScale || 1));
		const baseHeadLen = Math.max(Math.min(wLen * .25, worldSceneSize * localArrowMaxFactor), worldSceneSize * localArrowMinFactor) * effectiveArrowScale;
		const autoScale = resolveSmallVectorAutoScale(wLen, baseHeadLen);
		const wHeadLen = baseHeadLen * autoScale;
		const wHeadRadius = wHeadLen * ARROW_HEAD_RADIUS_RATIO;
		const overlapLen = Math.max(wHeadLen * 0, 0);
		return {
			tipWorld,
			fromWorld,
			wLen,
			wHeadLen,
			wHeadRadius,
			shaftLen: Math.max(wLen - wHeadLen + overlapLen, 1e-4),
			shaftRadius: wHeadRadius * SHAFT_RADIUS_TO_HEAD_RADIUS_RATIO,
			dir: wLen < 1e-4 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(wdx / wLen, wdy / wLen, wdz / wLen),
			autoScale
		};
	}
	function computeShaftThicknessMul(autoScale) {
		const base = (shaftBaseScale || 1) * (animatedVectorState.displayParams.vectorWidth || 1) * (autoScale || 1);
		return Math.max(.01, base);
	}
	function createCone(from, to) {
		const { tipWorld, wLen, wHeadLen, wHeadRadius, dir } = computeArrowParams(from, to);
		if (wLen < 1e-4) return null;
		const geom = new THREE.ConeGeometry(1, 1, 16);
		const mat = new THREE.MeshPhongMaterial({
			color: new THREE.Color(...color),
			emissive: new THREE.Color(...emissive),
			specular: new THREE.Color(...specular),
			shininess,
			transparent: elementOpacity < .999,
			opacity: elementOpacity,
			depthWrite,
			depthTest
		});
		const cone = new THREE.Mesh(geom, mat);
		cone.userData.baseOpacity = elementOpacity;
		cone.userData.dynamicVector = true;
		if (renderOrder !== null) cone.renderOrder = renderOrder;
		cone.scale.set(wHeadRadius, wHeadLen, wHeadRadius);
		cone.position.set(tipWorld[0] - dir.x * wHeadLen / 2, tipWorld[1] - dir.y * wHeadLen / 2, tipWorld[2] - dir.z * wHeadLen / 2);
		const up = new THREE.Vector3(0, 1, 0);
		cone.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
		animatedVectorState.three.scene.add(cone);
		animatedVectorState.arrowMeshes.push({
			mesh: cone,
			tipWorld: new THREE.Vector3(...tipWorld),
			dir: dir.clone(),
			wLen: wHeadLen,
			owner: ownerToken
		});
		return cone;
	}
	function createShaft(from, to) {
		const { fromWorld, wLen, wHeadRadius, shaftLen, shaftRadius, dir, autoScale } = computeArrowParams(from, to);
		if (wLen < 1e-4) return null;
		const geom = new THREE.CylinderGeometry(1, 1, 1, 16);
		const mat = new THREE.MeshPhongMaterial({
			color: new THREE.Color(...color),
			emissive: new THREE.Color(...emissive),
			specular: new THREE.Color(...specular),
			shininess,
			transparent: elementOpacity < .999,
			opacity: elementOpacity,
			depthWrite,
			depthTest
		});
		const shaft = new THREE.Mesh(geom, mat);
		shaft.userData.baseOpacity = elementOpacity;
		shaft.userData.dynamicVector = true;
		if (renderOrder !== null) shaft.renderOrder = renderOrder;
		shaft.position.set(fromWorld[0] + dir.x * shaftLen / 2, fromWorld[1] + dir.y * shaftLen / 2, fromWorld[2] + dir.z * shaftLen / 2);
		const up = new THREE.Vector3(0, 1, 0);
		shaft.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
		const shaftRadiusScaled = Math.min(shaftRadius * computeShaftThicknessMul(autoScale), wHeadRadius * .75);
		shaft.scale.set(shaftRadiusScaled, shaftLen, shaftRadiusScaled);
		animatedVectorState.three.scene.add(shaft);
		animatedVectorState.arrowMeshes.push({
			mesh: shaft,
			tipWorld: new THREE.Vector3(fromWorld[0] + dir.x * shaftLen, fromWorld[1] + dir.y * shaftLen, fromWorld[2] + dir.z * shaftLen),
			dir: dir.clone(),
			wLen: shaftLen,
			isShaft: true,
			owner: ownerToken
		});
		return shaft;
	}
	function computePanelLayout(from, to) {
		const { fromWorld, wLen, dir } = computeArrowParams(from, to);
		if (wLen < 1e-4) return null;
		const panelLength = Math.max(.01, Number(panelOpts && panelOpts.length) || .12);
		const panelWidth = Math.max(.005, Number(panelOpts && panelOpts.width) || .028);
		const panelThickness = Math.max(.001, Number(panelOpts && panelOpts.thickness) || .01);
		const panelGap = Math.max(0, Number(panelOpts && panelOpts.gap) || .012);
		const segments = Math.max(1, Math.min(2, Math.round(Number(panelOpts && panelOpts.segments) || 2)));
		const panelNormal = new THREE.Vector3(-dir.y, dir.x, 0);
		if (panelNormal.lengthSq() < 1e-8) panelNormal.set(0, 1, 0);
		panelNormal.normalize();
		return {
			fromWorld,
			panelLength,
			panelWidth,
			panelThickness,
			panelGap,
			segments,
			panelNormal,
			angle: Math.atan2(dir.y, dir.x) + Math.PI / 2
		};
	}
	function createPanels(from, to) {
		if (!panelOpts) return [];
		const layout = computePanelLayout(from, to);
		if (!layout) return [];
		const colorPanels = parseColor(panelOpts.color || "#7dd3fc");
		const opacityPanels = Number.isFinite(Number(panelOpts.opacity)) ? Math.max(0, Math.min(1, Number(panelOpts.opacity))) : elementOpacity;
		const panelRenderOrder = typeof panelOpts.renderOrder === "number" && isFinite(panelOpts.renderOrder) ? panelOpts.renderOrder : renderOrder;
		const meshes = [];
		for (const side of [-1, 1]) for (let seg = 0; seg < layout.segments; seg++) {
			const geom = new THREE.BoxGeometry(1, 1, 1);
			const mat = new THREE.MeshBasicMaterial({
				color: new THREE.Color(...colorPanels),
				transparent: opacityPanels < .999,
				opacity: opacityPanels,
				depthWrite,
				depthTest
			});
			const mesh = new THREE.Mesh(geom, mat);
			mesh.userData.baseOpacity = opacityPanels;
			mesh.userData.dynamicVector = true;
			if (panelRenderOrder !== null) mesh.renderOrder = panelRenderOrder;
			const centerDist = layout.panelGap + (seg + .5) * layout.panelLength;
			mesh.position.copy(layout.fromWorld).addScaledVector(layout.panelNormal, side * centerDist);
			mesh.rotation.z = layout.angle;
			mesh.scale.set(layout.panelLength, layout.panelWidth, layout.panelThickness);
			animatedVectorState.three.scene.add(mesh);
			animatedVectorState.arrowMeshes.push({
				mesh,
				tipWorld: mesh.position.clone(),
				dir: layout.panelNormal.clone(),
				wLen: layout.panelLength,
				isShaft: true,
				owner: ownerToken
			});
			meshes.push(mesh);
		}
		return meshes;
	}
	function updateArrow(cone, shaft, from, to) {
		const { tipWorld, fromWorld, wLen, wHeadLen, wHeadRadius, shaftLen, shaftRadius, dir, autoScale } = computeArrowParams(from, to);
		const visible = wLen >= 1e-4;
		const up = new THREE.Vector3(0, 1, 0);
		const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
		if (cone) {
			cone.visible = visible;
			if (visible) {
				cone.scale.set(wHeadRadius, wHeadLen, wHeadRadius);
				cone.position.set(tipWorld[0] - dir.x * wHeadLen / 2, tipWorld[1] - dir.y * wHeadLen / 2, tipWorld[2] - dir.z * wHeadLen / 2);
				cone.setRotationFromQuaternion(quat);
				const entry = animatedVectorState.arrowMeshes.find((e) => e.mesh === cone);
				if (entry) {
					entry.wLen = wHeadLen;
					entry.tipWorld.set(...tipWorld);
					entry.dir.copy(dir);
				}
			}
		}
		if (shaft) {
			shaft.visible = visible;
			if (visible) {
				shaft.position.set(fromWorld[0] + dir.x * shaftLen / 2, fromWorld[1] + dir.y * shaftLen / 2, fromWorld[2] + dir.z * shaftLen / 2);
				shaft.setRotationFromQuaternion(quat);
				const shaftRadiusScaled = Math.min(shaftRadius * computeShaftThicknessMul(autoScale), wHeadRadius * .75);
				shaft.scale.set(shaftRadiusScaled, shaftLen, shaftRadiusScaled);
				const entry = animatedVectorState.arrowMeshes.find((e) => e.mesh === shaft);
				if (entry) {
					entry.wLen = shaftLen;
					entry.tipWorld.set(fromWorld[0] + dir.x * shaftLen, fromWorld[1] + dir.y * shaftLen, fromWorld[2] + dir.z * shaftLen);
					entry.dir.copy(dir);
				}
			}
		}
	}
	function updatePanels(meshes, from, to) {
		if (!Array.isArray(meshes) || meshes.length === 0) return;
		const layout = computePanelLayout(from, to);
		const visible = !!layout;
		let idx = 0;
		for (const side of [-1, 1]) for (let seg = 0; seg < (layout ? layout.segments : 2); seg++) {
			const mesh = meshes[idx++];
			if (!mesh) continue;
			mesh.visible = visible;
			if (!visible) continue;
			const centerDist = layout.panelGap + (seg + .5) * layout.panelLength;
			mesh.position.copy(layout.fromWorld).addScaledVector(layout.panelNormal, side * centerDist);
			mesh.rotation.z = layout.angle;
			mesh.scale.set(layout.panelLength, layout.panelWidth, layout.panelThickness);
			const entry = animatedVectorState.arrowMeshes.find((e) => e.mesh === mesh);
			if (entry) {
				entry.tipWorld.copy(mesh.position);
				entry.dir.copy(layout.panelNormal);
				entry.wLen = layout.panelLength;
			}
		}
	}
	let arrowCone = null;
	let arrowShaft = createShaft(initFrom, initTo);
	let panelMeshes = createPanels(initFrom, initTo);
	if (el.arrow !== false) arrowCone = createCone(initFrom, initTo);
	let trailData = null;
	let trailLine = null;
	let trailBuffer = [];
	const trailMaxLen = trailOpts && trailOpts.length || 200;
	if (trailOpts) {
		const trailColor = parseColor(trailOpts.color || el.color || "#ff8844");
		const trailOpacityRaw = trailOpts && trailOpts.opacity !== void 0 ? Number(trailOpts.opacity) : 1;
		const trailBaseOpacity = Math.max(0, Math.min(1, Number.isFinite(trailOpacityRaw) ? trailOpacityRaw : 1));
		const trailEntry = {
			node: null,
			baseWidth: trailOpts.width || 1,
			baseOpacity: trailBaseOpacity,
			widthParam: "lineWidth",
			anchorDataPosFn: () => currentTo
		};
		const trailWidth = resolveLineWidth(trailEntry);
		trailBuffer = [initTo.slice(), initTo.slice()];
		trailData = view.array({
			channels: 3,
			width: 2,
			data: trailBuffer,
			live: true
		});
		trailLine = trailData.line({
			color: new THREE.Color(...trailColor),
			width: trailWidth,
			zBias: 1,
			opacity: trailBaseOpacity * (animatedVectorState.displayParams.lineOpacity || 1)
		});
		trailEntry.node = trailLine;
		animatedVectorState.lineNodes.push(trailEntry);
	}
	let labelExprFn = null;
	if (labelExprString) try {
		labelExprFn = compileExpr(labelExprString);
	} catch (err) {
		console.warn("animated_vector labelExpr compile error:", err);
	}
	let labelEl = null;
	if (label || labelExprFn) {
		const labelPos = el.labelPosition || [
			(initFrom[0] + initTo[0]) / 2 + labelOffset[0],
			(initFrom[1] + initTo[1]) / 2 + labelOffset[1],
			(initFrom[2] + initTo[2]) / 2 + labelOffset[2]
		];
		labelEl = addLabel3D(label || "", labelPos, color);
		if (labelExprFn) try {
			const txt = String(evalExpr(labelExprFn, 0));
			labelEl.el.innerHTML = renderKaTeX$1(txt, false);
			labelEl._lastDynamicText = txt;
		} catch (_e) {}
	}
	let exprFns = null;
	let fromExprFns = null;
	let visibleFn = null;
	const animExprEntry = {
		exprStrings,
		fromExprStrings,
		visibleExprString,
		animState: null,
		compiledFns: null,
		fromExprFns: null,
		visibleFn: null
	};
	if (useExpr) try {
		exprFns = exprStrings.map((e) => compileExpr(e));
		animExprEntry.compiledFns = exprFns;
	} catch (err) {
		console.warn("animated_vector expr compile error:", err);
	}
	if (useFromExpr) try {
		fromExprFns = fromExprStrings.map((e) => compileExpr(e));
		animExprEntry.fromExprFns = fromExprFns;
	} catch (err) {
		console.warn("animated_vector fromExpr compile error:", err);
	}
	if (visibleExprString) try {
		visibleFn = compileExpr(visibleExprString);
		animExprEntry.visibleFn = visibleFn;
	} catch (err) {
		console.warn("animated_vector visibleExpr compile error:", err);
	}
	const animState = { stopped: false };
	animExprEntry.animState = animState;
	if (useExpr) animatedVectorState.activeAnimExprs.push(animExprEntry);
	const startTime = animatedVectorState.sceneStartTime;
	animatedVectorState.activeAnimUpdaters.push({
		animState,
		updateFrame(nowMs) {
			if (arrowCone && !arrowCone.visible && arrowCone._hiddenByRemove) return;
			const elapsed = nowMs - startTime;
			const tSec = elapsed / 1e3;
			let cf, ct;
			if (useExpr && (animExprEntry.compiledFns || exprFns)) {
				const fromFns = animExprEntry.fromExprFns || fromExprFns;
				if (fromFns) try {
					cf = fromFns.map((fn) => evalExpr(fn, tSec));
				} catch (err) {
					cf = initFrom.slice();
				}
				else cf = initFrom.slice();
				const fns = animExprEntry.compiledFns || exprFns;
				try {
					ct = fns.map((fn) => evalExpr(fn, tSec));
				} catch (err) {
					ct = initTo;
				}
			} else if (keyframes.length > 1) {
				const totalDur = duration * (keyframes.length - 1);
				let t = elapsed % (loop ? totalDur || 1 : Infinity) / duration;
				if (!loop && elapsed > totalDur) t = keyframes.length - 1;
				const idx = Math.min(Math.floor(t), keyframes.length - 2);
				const frac = t - idx;
				const kf0 = keyframes[idx];
				const kf1 = keyframes[Math.min(idx + 1, keyframes.length - 1)];
				const f0 = kf0.origin || kf0.from || [
					0,
					0,
					0
				];
				const t0 = kf0.to || [
					1,
					0,
					0
				];
				const f1 = kf1.origin || kf1.from || [
					0,
					0,
					0
				];
				const t1 = kf1.to || [
					1,
					0,
					0
				];
				cf = f0.map((v, i) => v + (f1[i] - v) * frac);
				ct = t0.map((v, i) => v + (t1[i] - v) * frac);
			} else return;
			currentTo = ct;
			let isVisible = true;
			const curVisibleFn = animExprEntry.visibleFn || visibleFn;
			if (curVisibleFn) try {
				isVisible = !!evalExpr(curVisibleFn, tSec);
			} catch (_err) {
				isVisible = true;
			}
			if (!isVisible) {
				if (arrowCone) arrowCone.visible = false;
				if (arrowShaft) arrowShaft.visible = false;
				if (labelEl) labelEl.forceHidden = true;
				return;
			}
			if (!arrowShaft) arrowShaft = createShaft(cf, ct);
			if ((!panelMeshes || panelMeshes.length === 0) && panelOpts) panelMeshes = createPanels(cf, ct);
			if (el.arrow !== false && !arrowCone) arrowCone = createCone(cf, ct);
			updateArrow(arrowCone, arrowShaft, cf, ct);
			updatePanels(panelMeshes, cf, ct);
			if (trailOpts && trailData) {
				trailBuffer.push(ct.slice());
				if (trailBuffer.length > trailMaxLen) trailBuffer.shift();
				trailData.set("width", trailBuffer.length);
				trailData.set("data", trailBuffer);
			}
			if (labelEl) {
				labelEl.dataPos[0] = (cf[0] + ct[0]) / 2 + labelOffset[0];
				labelEl.dataPos[1] = (cf[1] + ct[1]) / 2 + labelOffset[1];
				labelEl.dataPos[2] = (cf[2] + ct[2]) / 2 + labelOffset[2];
				labelEl.forceHidden = false;
				if (labelExprFn) try {
					const txt = String(evalExpr(labelExprFn, tSec));
					if (labelEl._lastDynamicText !== txt) {
						labelEl.el.innerHTML = renderKaTeX$1(txt, false);
						labelEl._lastDynamicText = txt;
					}
				} catch (_e) {}
			}
			if (el.id) animatedVectorState.animatedElementPos[el.id] = {
				pos: ct,
				from: cf,
				to: ct,
				startTime,
				time: nowMs
			};
		}
	});
	return {
		type: "animated_vector",
		color,
		label,
		_animState: animState,
		_animExprEntry: animExprEntry,
		_arrowOwner: ownerToken
	};
}
//#endregion
//#region src/colormaps.ts
/**
* Colormaps — turn a scalar in [0,1] into an RGB triple.
*
* One implementation serves two callers that used to be unrelated: `polygon`'s
* static `gradient.stops`, and the `colorExpr` per-frame colour on animated
* elements. Keeping them on the same interpolator is the point — a two-stop
* colormap and a two-stop gradient must produce the same colour, or an author
* who reaches for one after the other gets a silent mismatch.
*
* Colours are normalized RGB (0-1), which is what `parseColor` returns and what
* `THREE.Color.setRGB` wants, so nothing converts on the way through.
*/
/**
* Build a ramp from stops.
*
* Stops are sorted by `t`, so an author may list them in any order. Values
* outside the stop range **clamp** to the terminal stops rather than
* extrapolating — extrapolating an RGB ramp produces out-of-gamut colours that
* three.js silently saturates, which reads as "the heatmap has a flat top".
*/
function buildStopsFn(stops) {
	const parsed = stops.slice().sort((a, b) => a.t - b.t).map((s) => ({
		t: s.t,
		c: parseColor(s.color)
	}));
	if (parsed.length === 1) {
		const only = parsed[0].c;
		return () => only.slice();
	}
	return (u) => {
		if (!(u > parsed[0].t)) return parsed[0].c.slice();
		const last = parsed[parsed.length - 1];
		if (u >= last.t) return last.c.slice();
		for (let i = 0; i < parsed.length - 1; i++) {
			const hi = parsed[i + 1];
			if (u <= hi.t) {
				const lo = parsed[i];
				const span = hi.t - lo.t;
				const f = span === 0 ? 0 : (u - lo.t) / span;
				return [
					lo.c[0] + f * (hi.c[0] - lo.c[0]),
					lo.c[1] + f * (hi.c[1] - lo.c[1]),
					lo.c[2] + f * (hi.c[2] - lo.c[2])
				];
			}
		}
		return last.c.slice();
	};
}
/**
* Named ramps, as 9 evenly-spaced stops each.
*
* `viridis` and `magma` are perceptually uniform and stay legible in both
* themes — the default choice for a non-negative quantity. `blueRed` is
* diverging and is correct **only** for signed data; using it for something
* non-negative (an attention weight, a probability) implies a sign that isn't
* there.
*/
var NAMED_STOPS = {
	viridis: [
		"#440154",
		"#472d7b",
		"#3b528b",
		"#2c728e",
		"#21918c",
		"#28ae80",
		"#5ec962",
		"#addc30",
		"#fde725"
	],
	magma: [
		"#000004",
		"#1c1044",
		"#4f127b",
		"#812581",
		"#b5367a",
		"#e55964",
		"#fb8761",
		"#fec287",
		"#fcfdbf"
	],
	blueRed: [
		"#2166ac",
		"#4393c3",
		"#92c5de",
		"#d1e5f0",
		"#f7f7f7",
		"#fddbc7",
		"#f4a582",
		"#d6604d",
		"#b2182b"
	]
};
var DEFAULT_MAP = "viridis";
function namedMap(name) {
	const hexes = NAMED_STOPS[name] || NAMED_STOPS[DEFAULT_MAP];
	return buildStopsFn(hexes.map((color, i) => ({
		t: i / (hexes.length - 1),
		color
	})));
}
/**
* Resolve a `colorMap` value into a ramp.
*
* Accepts a name, a `{stops:[…]}` object, or nothing (→ the default). An
* unknown name falls back rather than throwing: a misspelled colormap should
* cost the author the palette they wanted, not the whole scene.
*/
function buildColorMap(spec) {
	if (spec && typeof spec === "object") {
		const stops = spec.stops;
		if (Array.isArray(stops) && stops.length > 0) return buildStopsFn(stops);
	}
	if (typeof spec === "string" && spec) {
		if (!NAMED_STOPS[spec]) console.warn(`Unknown colorMap "${spec}" — falling back to ${DEFAULT_MAP}`);
		return namedMap(spec);
	}
	return namedMap(DEFAULT_MAP);
}
/**
* Normalize a raw `colorExpr` value onto [0,1] over `domain`, or `null` when it
* is not a usable number.
*
* Returning `null` rather than 0 for a bad value matters: 0 is a legitimate
* colour at the cold end of the ramp, so a caller that cannot distinguish
* "black because the value is low" from "black because the expression returned
* a matrix" has no way to keep the previous frame's colour instead.
*/
function normalizeColorValue(raw, domain) {
	const v = Number(raw);
	if (!Number.isFinite(v)) return null;
	let lo = 0;
	let hi = 1;
	if (Array.isArray(domain) && domain.length >= 2) {
		const a = Number(domain[0]);
		const b = Number(domain[1]);
		if (Number.isFinite(a) && Number.isFinite(b)) {
			lo = a;
			hi = b;
		}
	}
	if (hi === lo) return 0;
	const u = (v - lo) / (hi - lo);
	return u < 0 ? 0 : u > 1 ? 1 : u;
}
//#endregion
//#region src/objects/polygon.ts
var polygonState = state;
var _noiseTexture$1 = null;
function _getNoiseTexture$1() {
	if (_noiseTexture$1) return _noiseTexture$1;
	const size = 256;
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext("2d");
	const img = ctx.createImageData(size, size);
	for (let i = 0; i < img.data.length; i += 4) {
		const v = 205 + Math.floor(Math.random() * 50);
		img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
		img.data[i + 3] = 255;
	}
	ctx.putImageData(img, 0, 0);
	_noiseTexture$1 = new THREE.CanvasTexture(canvas);
	_noiseTexture$1.wrapS = _noiseTexture$1.wrapT = THREE.RepeatWrapping;
	return _noiseTexture$1;
}
function _computePlaneUVs$1(wVerts, normal) {
	const n = normal.clone().normalize();
	const v0 = new THREE.Vector3(wVerts[0][0], wVerts[0][1], wVerts[0][2]);
	const tang = new THREE.Vector3(wVerts[1][0] - wVerts[0][0], wVerts[1][1] - wVerts[0][1], wVerts[1][2] - wVerts[0][2]);
	tang.addScaledVector(n, -tang.dot(n));
	if (tang.length() < 1e-9) return wVerts.map(() => [0, 0]);
	tang.normalize();
	const bitang = new THREE.Vector3().crossVectors(n, tang);
	const proj = wVerts.map((v) => {
		const dx = v[0] - v0.x, dy = v[1] - v0.y, dz = v[2] - v0.z;
		return [dx * tang.x + dy * tang.y + dz * tang.z, dx * bitang.x + dy * bitang.y + dz * bitang.z];
	});
	const minU = Math.min(...proj.map((p) => p[0]));
	const minV = Math.min(...proj.map((p) => p[1]));
	const maxU = Math.max(...proj.map((p) => p[0]));
	const maxV = Math.max(...proj.map((p) => p[1]));
	const scale = Math.max(maxU - minU, maxV - minV) || 1;
	return proj.map(([u, v]) => [(u - minU) / scale, (v - minV) / scale]);
}
function _buildGradientColorFn(gradient) {
	if (gradient.stops && gradient.stops.length > 0) return buildStopsFn(gradient.stops);
	const c0 = parseColor(gradient.from || "#ff0000");
	const c1 = parseColor(gradient.to || "#0000ff");
	return (t) => [
		c0[0] + t * (c1[0] - c0[0]),
		c0[1] + t * (c1[1] - c0[1]),
		c0[2] + t * (c1[2] - c0[2])
	];
}
function _buildGradientSlab(wVerts, gradient, halfThick, normal) {
	const dir = gradient.direction || "y";
	const axis = dir === "x" ? 0 : dir === "z" ? 2 : 1;
	const segments = gradient.segments || 64;
	const getColor = _buildGradientColorFn(gradient);
	const tValues = wVerts.map((v) => v[axis]);
	const tMin = Math.min(...tValues);
	const tMax = Math.max(...tValues);
	if (tMax - tMin < 1e-9) return null;
	const tRange = tMax - tMin;
	const n = wVerts.length;
	const edges = [];
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		edges.push({
			w0: wVerts[i],
			w1: wVerts[j],
			t0: (tValues[i] - tMin) / tRange,
			t1: (tValues[j] - tMin) / tRange
		});
	}
	function sliceAt(t) {
		const pts = [];
		for (const e of edges) {
			const lo = Math.min(e.t0, e.t1), hi = Math.max(e.t0, e.t1);
			if (t < lo - 1e-9 || t > hi + 1e-9) continue;
			const dt = e.t1 - e.t0;
			if (Math.abs(dt) < 1e-9) pts.push(e.w0.slice(), e.w1.slice());
			else {
				const f = (t - e.t0) / dt;
				pts.push([
					e.w0[0] + f * (e.w1[0] - e.w0[0]),
					e.w0[1] + f * (e.w1[1] - e.w0[1]),
					e.w0[2] + f * (e.w1[2] - e.w0[2])
				]);
			}
		}
		const unique = [];
		for (const p of pts) if (!unique.some((u) => Math.abs(u[0] - p[0]) < 1e-9 && Math.abs(u[1] - p[1]) < 1e-9 && Math.abs(u[2] - p[2]) < 1e-9)) unique.push(p);
		const sa = axis === 0 ? 1 : 0;
		unique.sort((a, b) => a[sa] - b[sa]);
		return unique;
	}
	const positions = [];
	const vertColors = [];
	const off = (v, s) => [
		v[0] + normal.x * halfThick * s,
		v[1] + normal.y * halfThick * s,
		v[2] + normal.z * halfThick * s
	];
	for (let s = 0; s < segments; s++) {
		const tBot = s / segments;
		const tTop = (s + 1) / segments;
		const bp = sliceAt(tBot);
		const tp = sliceAt(tTop);
		if (bp.length < 2 || tp.length < 2) continue;
		const cB = getColor(tBot);
		const cT = getColor(tTop);
		const bL = bp[0], bR = bp[bp.length - 1];
		const tL = tp[0], tR = tp[tp.length - 1];
		for (const sign of [1, -1]) {
			const o = (v) => off(v, sign);
			if (sign === 1) {
				positions.push(...o(bL), ...o(bR), ...o(tR));
				positions.push(...o(bL), ...o(tR), ...o(tL));
			} else {
				positions.push(...o(bL), ...o(tR), ...o(bR));
				positions.push(...o(bL), ...o(tL), ...o(tR));
			}
			vertColors.push(...cB, ...cB, ...cT);
			vertColors.push(...cB, ...cT, ...cT);
		}
	}
	return {
		positions,
		colors: vertColors
	};
}
function renderPolygon(el, view) {
	const color = parseColor(el.color || "#aa66ff");
	const opacity = el.opacity !== void 0 ? el.opacity : .5;
	const thickness = el.thickness || .02;
	let vertices;
	if (el.regular && typeof el.regular === "object") {
		const reg = el.regular;
		const N = Math.max(3, Math.round(Number(reg.n) || 3));
		const r = Number(reg.radius != null ? reg.radius : 1);
		const cx = Array.isArray(reg.center) ? Number(reg.center[0] ?? 0) : 0;
		const cy = Array.isArray(reg.center) ? Number(reg.center[1] ?? 0) : 0;
		const cz = Array.isArray(reg.center) ? Number(reg.center[2] ?? 0) : 0;
		const rot = Number(reg.rotation ?? 0);
		const plane = (reg.plane || "xy").toLowerCase();
		vertices = [];
		for (let k = 0; k < N; k++) {
			const angle = rot + 2 * Math.PI * k / N;
			const a = r * Math.cos(angle), b = r * Math.sin(angle);
			if (plane === "xz") vertices.push([
				cx + a,
				cy,
				cz + b
			]);
			else if (plane === "yz") vertices.push([
				cx,
				cy + a,
				cz + b
			]);
			else vertices.push([
				cx + a,
				cy + b,
				cz
			]);
		}
	} else vertices = el.vertices || el.points || [
		[
			0,
			0,
			0
		],
		[
			1,
			0,
			0
		],
		[
			1,
			1,
			0
		],
		[
			0,
			1,
			0
		]
	];
	const label = el.label;
	const wVerts = vertices.map((v) => dataToWorld(v));
	const a = new THREE.Vector3(wVerts[1][0] - wVerts[0][0], wVerts[1][1] - wVerts[0][1], wVerts[1][2] - wVerts[0][2]);
	const b = new THREE.Vector3(wVerts[2][0] - wVerts[0][0], wVerts[2][1] - wVerts[0][1], wVerts[2][2] - wVerts[0][2]);
	const normal = a.cross(b).normalize();
	const baseHalf = dataLenToWorld(thickness / 2);
	const sh = el.shader || {};
	const isStandard = sh.type === "standard";
	const planeUVs = isStandard ? _computePlaneUVs$1(wVerts, normal) : null;
	function buildSlabGeometry(halfThick) {
		const positions = [];
		const uvData = isStandard ? [] : null;
		const top = wVerts.map((v) => [
			v[0] + normal.x * halfThick,
			v[1] + normal.y * halfThick,
			v[2] + normal.z * halfThick
		]);
		const bot = wVerts.map((v) => [
			v[0] - normal.x * halfThick,
			v[1] - normal.y * halfThick,
			v[2] - normal.z * halfThick
		]);
		for (let i = 1; i < top.length - 1; i++) {
			positions.push(...top[0], ...top[i], ...top[i + 1]);
			if (uvData) uvData.push(...planeUVs[0], ...planeUVs[i], ...planeUVs[i + 1]);
		}
		for (let i = 1; i < bot.length - 1; i++) {
			positions.push(...bot[0], ...bot[i + 1], ...bot[i]);
			if (uvData) uvData.push(...planeUVs[0], ...planeUVs[i + 1], ...planeUVs[i]);
		}
		for (let i = 0; i < wVerts.length; i++) {
			const j = (i + 1) % wVerts.length;
			positions.push(...top[i], ...bot[i], ...top[j]);
			positions.push(...top[j], ...bot[i], ...bot[j]);
			if (uvData) uvData.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
		}
		return {
			positions,
			uvData
		};
	}
	const geom = new THREE.BufferGeometry();
	const gradResult = el.gradient ? _buildGradientSlab(wVerts, el.gradient, baseHalf * polygonState.displayParams.planeScale, normal) : null;
	const hasGradient = !!gradResult;
	if (hasGradient) {
		geom.setAttribute("position", new THREE.Float32BufferAttribute(gradResult.positions, 3));
		geom.setAttribute("color", new THREE.Float32BufferAttribute(gradResult.colors, 3));
	} else {
		const { positions, uvData } = buildSlabGeometry(baseHalf * polygonState.displayParams.planeScale);
		geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
		if (uvData) geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvData, 2));
	}
	geom.computeVertexNormals();
	const baseMatOpts = {
		color: hasGradient ? new THREE.Color(1, 1, 1) : new THREE.Color(...color),
		opacity: polygonState.displayParams.planeOpacity,
		transparent: true,
		side: THREE.DoubleSide,
		depthWrite: false
	};
	if (hasGradient) baseMatOpts.vertexColors = true;
	let mat;
	if (sh.type === "basic") mat = new THREE.MeshBasicMaterial(baseMatOpts);
	else if (sh.type === "standard") {
		const repeat = sh.textureRepeat !== void 0 ? sh.textureRepeat : 5;
		const noiseTex = _getNoiseTexture$1();
		noiseTex.repeat.set(repeat, repeat);
		Object.assign(baseMatOpts, {
			roughness: sh.roughness !== void 0 ? sh.roughness : .85,
			metalness: sh.metalness !== void 0 ? sh.metalness : .08,
			map: noiseTex
		});
		if (sh.emissive) baseMatOpts.emissive = new THREE.Color(sh.emissive);
		mat = new THREE.MeshStandardMaterial(baseMatOpts);
	} else {
		baseMatOpts.shininess = sh.shininess !== void 0 ? sh.shininess : 30;
		if (sh.emissive) baseMatOpts.emissive = new THREE.Color(sh.emissive);
		if (sh.specular) baseMatOpts.specular = new THREE.Color(sh.specular);
		if (sh.flatShading) baseMatOpts.flatShading = true;
		mat = new THREE.MeshPhongMaterial(baseMatOpts);
	}
	const mesh = new THREE.Mesh(geom, mat);
	mesh.userData.targetOpacity = opacity;
	mesh.userData.baseHalf = baseHalf;
	mesh.userData.wVerts = wVerts;
	mesh.userData.normal = normal.clone();
	mesh.userData.buildSlab = hasGradient ? (halfThick) => {
		const g = _buildGradientSlab(wVerts, el.gradient, halfThick, normal);
		return g ? g.positions : buildSlabGeometry(halfThick).positions;
	} : (halfThick) => buildSlabGeometry(halfThick).positions;
	const _serial = el.renderOrder !== void 0 ? el.renderOrder : polygonState._planeMeshSerial++;
	mesh.renderOrder = _serial;
	mesh.position.z = el.depthZ !== void 0 ? el.depthZ : _serial * 2e-4;
	polygonState.three.scene.add(mesh);
	polygonState.planeMeshes.push(mesh);
	if (label) addLabel3D(label, [
		vertices.reduce((s, v) => s + v[0], 0) / vertices.length,
		vertices.reduce((s, v) => s + v[1], 0) / vertices.length,
		vertices.reduce((s, v) => s + v[2], 0) / vertices.length
	], color);
	const outlineWidthVal = el.outlineWidth != null ? Number(el.outlineWidth) : el.regular ? 1.5 : 0;
	if (outlineWidthVal > 0 && view) {
		const outlineColor = parseColor(el.outlineColor || el.color || "#aa66ff");
		const outlineOpacity = el.outlineOpacity != null ? Number(el.outlineOpacity) : Math.min(1, opacity * 2);
		const pts = vertices.slice();
		pts.push(pts[0]);
		view.array({
			channels: 3,
			width: pts.length,
			data: pts
		}).line({
			color: new THREE.Color(...outlineColor),
			width: outlineWidthVal,
			opacity: outlineOpacity,
			zBias: 2
		});
	}
	return {
		type: "polygon",
		color,
		label
	};
}
//#endregion
//#region src/objects/animated-line.ts
var animatedLineState = state;
function renderAnimatedLine(el, view) {
	const color = parseColor(el.color || "#88aaff");
	const width = (el.width || 3) * getAbstractWidthScale(el);
	const opacity = el.opacity !== void 0 ? Number(el.opacity) : 1;
	const baseOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
	const label = el.label;
	const labelExprString = typeof el.labelExpr === "string" && el.labelExpr.trim() ? el.labelExpr.trim() : null;
	const pointExprs = el.points;
	if (!Array.isArray(pointExprs) || pointExprs.length < 2) return null;
	let compiledPoints = pointExprs.map((p) => p.map((e) => compileExpr(e)));
	function evalPoints(fns, tSec) {
		return fns.map((pfns) => pfns.map((fn) => evalExpr(fn, tSec)));
	}
	let currentPoints;
	try {
		currentPoints = evalPoints(compiledPoints, 0);
	} catch (err) {
		console.warn("animated_line eval error:", err);
		return null;
	}
	const lineEntry = {
		node: null,
		baseWidth: width,
		baseOpacity,
		widthParam: "lineWidth",
		anchorDataPosFn: () => currentPoints[Math.floor(currentPoints.length / 2)] || [
			0,
			0,
			0
		]
	};
	const lineW = resolveLineWidth(lineEntry);
	const lineData = view.array({
		channels: 3,
		width: currentPoints.length,
		data: currentPoints,
		live: true
	});
	lineEntry.node = lineData.line({
		color: new THREE.Color(...color),
		width: lineW,
		zBias: 1,
		opacity: baseOpacity * (animatedLineState.displayParams.lineOpacity || 1)
	});
	animatedLineState.lineNodes.push(lineEntry);
	let labelExprFn = null;
	if (labelExprString) try {
		labelExprFn = compileExpr(labelExprString);
	} catch (err) {
		console.warn("animated_line labelExpr compile error:", err);
	}
	let labelEl = null;
	if (label || labelExprFn) {
		const p0 = currentPoints[0];
		const pN = currentPoints[currentPoints.length - 1];
		const mid = [
			(p0[0] + pN[0]) / 2,
			(p0[1] + pN[1]) / 2,
			(p0[2] + pN[2]) / 2
		];
		labelEl = addLabel3D(label || "", mid, color);
		if (labelExprFn) try {
			const txt = String(evalExpr(labelExprFn, 0));
			labelEl.el.innerHTML = renderKaTeX$1(txt, false);
			labelEl._lastDynamicText = txt;
		} catch (_e) {}
	}
	const animState = { stopped: false };
	const animExprEntry = {
		exprStrings: pointExprs.flat(),
		animState,
		compiledFns: compiledPoints.flat(),
		_isAnimatedLine: true,
		_pointExprs: pointExprs,
		_compiledPoints: compiledPoints
	};
	animatedLineState.activeAnimExprs.push(animExprEntry);
	const startTime = animatedLineState.sceneStartTime;
	animatedLineState.activeAnimUpdaters.push({
		animState,
		updateFrame(nowMs) {
			const tSec = (nowMs - startTime) / 1e3;
			const fns = animExprEntry._compiledPoints;
			try {
				const pts = evalPoints(fns, tSec);
				lineData.set("data", pts);
				if (labelEl) {
					const lp0 = pts[0];
					const lpN = pts[pts.length - 1];
					labelEl.dataPos[0] = (lp0[0] + lpN[0]) / 2;
					labelEl.dataPos[1] = (lp0[1] + lpN[1]) / 2 + .3;
					labelEl.dataPos[2] = (lp0[2] + lpN[2]) / 2;
					if (labelExprFn) try {
						const txt = String(evalExpr(labelExprFn, tSec));
						if (labelEl._lastDynamicText !== txt) {
							labelEl.el.innerHTML = renderKaTeX$1(txt, false);
							labelEl._lastDynamicText = txt;
						}
					} catch (_e) {}
				}
			} catch (err) {}
		}
	});
	return {
		type: "animated_line",
		color,
		label,
		_animState: animState,
		_animExprEntry: animExprEntry
	};
}
//#endregion
//#region src/objects/animated-point.ts
var animatedPointState = state;
var _haloTexture = null;
function getHaloTexture() {
	if (_haloTexture) return _haloTexture;
	const c = document.createElement("canvas");
	c.width = c.height = 256;
	const ctx = c.getContext("2d");
	const ray = (rot, len, width, alpha) => {
		ctx.save();
		ctx.translate(128, 128);
		ctx.rotate(rot);
		ctx.scale(len, width);
		const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
		g.addColorStop(0, `rgba(255,255,255,${alpha})`);
		g.addColorStop(.35, `rgba(255,255,255,${alpha * .3})`);
		g.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc(0, 0, 1, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	};
	ray(0, 40, 40, 1);
	ray(0, 40, 40, 1);
	ray(0, 110, 110, .35);
	ray(0, 127, 9, 1);
	ray(Math.PI / 2, 127, 9, 1);
	ray(Math.PI / 4, 95, 5, .55);
	ray(-Math.PI / 4, 95, 5, .55);
	_haloTexture = new THREE.CanvasTexture(c);
	return _haloTexture;
}
function renderAnimatedPoint(el, view) {
	const color = parseColor(el.color || "#ffdd00");
	const shader = el.shader || {};
	const size = Number(el.size);
	const opacity = Number.isFinite(Number(el.opacity)) ? Math.max(0, Math.min(1, Number(el.opacity))) : 1;
	const radius = el.radius !== void 0 ? el.radius : Number.isFinite(size) ? Math.max(size, 0) / 50 : .25;
	const label = el.label;
	const exprStrings = el.expr || el.positionExpr || el.toExpr || (Array.isArray(el.position) && el.position.length === 3 ? el.position.map((v) => String(v)) : null);
	const visibleExprString = typeof el.visibleExpr === "string" && el.visibleExpr.trim() ? el.visibleExpr.trim() : null;
	const sizeExprString = typeof el.sizeExpr === "string" && el.sizeExpr.trim() ? el.sizeExpr.trim() : null;
	const opacityExprString = typeof el.opacityExpr === "string" && el.opacityExpr.trim() ? el.opacityExpr.trim() : null;
	const labelExprString = typeof el.labelExpr === "string" && el.labelExpr.trim() ? el.labelExpr.trim() : null;
	const labelOffset = Array.isArray(el.labelOffset) && el.labelOffset.length === 3 ? [
		Number(el.labelOffset[0]) || 0,
		Number(el.labelOffset[1]) || 0,
		Number(el.labelOffset[2]) || 0
	] : [
		0,
		0,
		.15
	];
	if (!Array.isArray(exprStrings) || exprStrings.length !== 3) return null;
	let exprFns;
	let visibleFn = null;
	let sizeFn = null;
	let opacityFn = null;
	let initPos;
	try {
		exprFns = exprStrings.map((e) => compileExpr(e));
		initPos = exprFns.map((fn) => evalExpr(fn, 0));
		if (visibleExprString) visibleFn = compileExpr(visibleExprString);
		if (sizeExprString) sizeFn = compileExpr(sizeExprString);
		if (opacityExprString) opacityFn = compileExpr(opacityExprString);
	} catch (err) {
		console.warn("animated_point expr compile/eval error:", err);
		return null;
	}
	const initWorld = dataToWorld(initPos);
	const geom = new THREE.SphereGeometry(1, 20, 16);
	const matOpts = {
		color: new THREE.Color(...color),
		transparent: opacity < .999 || !!opacityFn,
		opacity
	};
	if (shader.depthWrite !== void 0) matOpts.depthWrite = !!shader.depthWrite;
	if (shader.depthTest !== void 0) matOpts.depthTest = !!shader.depthTest;
	let mat;
	if (shader.type === "basic") mat = new THREE.MeshBasicMaterial(matOpts);
	else {
		matOpts.shininess = shader.shininess !== void 0 ? shader.shininess : 50;
		if (shader.emissive) matOpts.emissive = new THREE.Color(shader.emissive);
		if (shader.specular) matOpts.specular = new THREE.Color(shader.specular);
		if (shader.flatShading) matOpts.flatShading = true;
		mat = new THREE.MeshPhongMaterial(matOpts);
	}
	const mesh = new THREE.Mesh(geom, mat);
	const glowOnly = !!el.glow;
	if (glowOnly) {
		mat.transparent = true;
		mat.opacity = 0;
		mesh.visible = false;
	}
	mesh.position.set(initWorld[0], initWorld[1], initWorld[2]);
	const initWorldRadius = Math.max(dataLenToWorld(radius), 5e-4);
	mesh.scale.setScalar(initWorldRadius);
	mesh.userData.targetOpacity = glowOnly ? 0 : opacity;
	mesh.userData.ignorePlaneOpacity = !!shader.ignorePlaneOpacity;
	animatedPointState.three.scene.add(mesh);
	animatedPointState.planeMeshes.push(mesh);
	let halo = null;
	const glowScale = Number.isFinite(Number(el.glowScale)) ? Number(el.glowScale) : 2;
	if (el.glow) {
		const haloMat = new THREE.SpriteMaterial({
			map: getHaloTexture(),
			color: new THREE.Color(...color),
			transparent: true,
			opacity,
			blending: THREE.AdditiveBlending,
			depthWrite: false
		});
		halo = new THREE.Sprite(haloMat);
		halo.position.copy(mesh.position);
		halo.scale.setScalar(initWorldRadius * glowScale * 2);
		halo.userData.targetOpacity = opacity;
		halo.userData.ignorePlaneOpacity = !!shader.ignorePlaneOpacity;
		animatedPointState.three.scene.add(halo);
		animatedPointState.planeMeshes.push(halo);
	}
	let labelExprFn = null;
	if (labelExprString) try {
		labelExprFn = compileExpr(labelExprString);
	} catch (err) {
		console.warn("animated_point labelExpr compile error:", err);
	}
	let labelEl = null;
	if (label || labelExprFn) {
		labelEl = addLabel3D(label || "", [
			initPos[0] + labelOffset[0],
			initPos[1] + labelOffset[1],
			initPos[2] + labelOffset[2]
		], color);
		if (labelExprFn) try {
			const txt = String(evalExpr(labelExprFn, 0));
			labelEl.el.innerHTML = renderKaTeX$1(txt, false);
			labelEl._lastDynamicText = txt;
		} catch (_e) {}
	}
	const animState = { stopped: false };
	const animExprEntry = {
		exprStrings,
		animState,
		compiledFns: exprFns,
		visibleExprString,
		visibleFn
	};
	animatedPointState.activeAnimExprs.push(animExprEntry);
	const startTime = animatedPointState.sceneStartTime;
	animatedPointState.activeAnimUpdaters.push({
		animState,
		updateFrame(nowMs) {
			if (mesh._hiddenByRemove) {
				if (el.id) delete animatedPointState.animatedElementPos[el.id];
				return;
			}
			const tSec = (nowMs - startTime) / 1e3;
			const fns = animExprEntry.compiledFns || exprFns;
			let p = initPos;
			try {
				p = fns.map((fn) => evalExpr(fn, tSec));
			} catch (err) {}
			if (el.id) animatedPointState.animatedElementPos[el.id] = {
				pos: p,
				startTime,
				time: nowMs
			};
			let isVisible = true;
			const curVisibleFn = animExprEntry.visibleFn || visibleFn;
			if (curVisibleFn) try {
				isVisible = !!evalExpr(curVisibleFn, tSec);
			} catch (_err) {
				isVisible = true;
			}
			mesh.visible = glowOnly ? false : isVisible;
			const w = dataToWorld(p);
			mesh.position.set(w[0], w[1], w[2]);
			let radiusNow = radius;
			if (sizeFn) try {
				const rv = evalExpr(sizeFn, tSec);
				if (Number.isFinite(rv)) radiusNow = Math.max(rv, 0) / 50;
			} catch (_err) {}
			const worldRadius = Math.max(dataLenToWorld(radiusNow), 5e-4);
			mesh.scale.setScalar(worldRadius);
			let opacityNow = null;
			if (opacityFn) try {
				const ov = evalExpr(opacityFn, tSec);
				if (Number.isFinite(ov)) {
					opacityNow = Math.max(0, Math.min(1, ov));
					if (!halo) {
						mesh.material.opacity = opacityNow;
						mesh.userData.targetOpacity = opacityNow;
					}
				}
			} catch (_err) {}
			if (halo && !halo._hiddenByRemove) {
				halo.visible = isVisible;
				halo.position.copy(mesh.position);
				halo.scale.setScalar(worldRadius * glowScale * 2);
				if (opacityNow !== null) {
					halo.material.opacity = opacityNow;
					halo.userData.targetOpacity = opacityNow;
				}
			}
			if (labelEl) {
				labelEl.dataPos[0] = p[0] + labelOffset[0];
				labelEl.dataPos[1] = p[1] + labelOffset[1];
				labelEl.dataPos[2] = p[2] + labelOffset[2];
				labelEl.forceHidden = !isVisible;
				if (labelExprFn) try {
					const txt = String(evalExpr(labelExprFn, tSec));
					if (labelEl._lastDynamicText !== txt) {
						labelEl.el.innerHTML = renderKaTeX$1(txt, false);
						labelEl._lastDynamicText = txt;
					}
				} catch (_e) {}
			}
		}
	});
	return {
		type: "animated_point",
		color,
		label,
		_animState: animState,
		_animExprEntry: animExprEntry
	};
}
//#endregion
//#region src/objects/cylinder.ts
var cylinderState = state;
function _axisToDataDir(axis) {
	if (axis === "x") return [
		1,
		0,
		0
	];
	if (axis === "y") return [
		0,
		1,
		0
	];
	return [
		0,
		0,
		1
	];
}
function _resolveCylinderDataEndpoints(el) {
	const from = Array.isArray(el.from) ? el.from.slice(0, 3) : null;
	const to = Array.isArray(el.to) ? el.to.slice(0, 3) : null;
	if (from && to) return {
		from,
		to
	};
	const center = Array.isArray(el.center) ? el.center.slice(0, 3) : Array.isArray(el.position) ? el.position.slice(0, 3) : [
		0,
		0,
		0
	];
	const h = el.height !== void 0 ? el.height : 1;
	const dir = _axisToDataDir(el.axis || "z");
	const half = h / 2;
	return {
		from: [
			center[0] - dir[0] * half,
			center[1] - dir[1] * half,
			center[2] - dir[2] * half
		],
		to: [
			center[0] + dir[0] * half,
			center[1] + dir[1] * half,
			center[2] + dir[2] * half
		]
	};
}
function _setCylinderTransformFromData(mesh, fromData, toData, radiusData) {
	const fromW = new THREE.Vector3(...dataToWorld(fromData));
	const toW = new THREE.Vector3(...dataToWorld(toData));
	const delta = new THREE.Vector3().subVectors(toW, fromW);
	const len = Math.max(delta.length(), 1e-4);
	const dir = delta.clone().normalize();
	const up = new THREE.Vector3(0, 1, 0);
	const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
	const center = new THREE.Vector3().addVectors(fromW, toW).multiplyScalar(.5);
	const dx = toData[0] - fromData[0];
	const dy = toData[1] - fromData[1];
	const dz = toData[2] - fromData[2];
	const dataDir = new THREE.Vector3(dx, dy, dz);
	if (dataDir.lengthSq() < 1e-12) dataDir.set(0, 0, 1);
	dataDir.normalize();
	const basis = Math.abs(dataDir.z) < .9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
	const perpData = new THREE.Vector3().crossVectors(dataDir, basis).normalize();
	const radiusDataSafe = isFinite(radiusData) ? Number(radiusData) : 0;
	const sampleData = [
		fromData[0] + perpData.x * radiusDataSafe,
		fromData[1] + perpData.y * radiusDataSafe,
		fromData[2] + perpData.z * radiusDataSafe
	];
	const sampleW = new THREE.Vector3(...dataToWorld(sampleData));
	const rWorld = Math.max(sampleW.distanceTo(fromW), 5e-4);
	mesh.position.copy(center);
	mesh.setRotationFromQuaternion(quat);
	mesh.scale.set(rWorld, len, rWorld);
}
function renderCylinder(el, view) {
	const color = parseColor(el.color || "#88aaff");
	const opacity = el.opacity !== void 0 ? el.opacity : .35;
	const radius = el.radius !== void 0 ? el.radius : 1;
	const radialSegments = el.radialSegments || 32;
	const openEnded = !!el.openEnded;
	const label = el.label;
	const { from, to } = _resolveCylinderDataEndpoints(el);
	const geom = new THREE.CylinderGeometry(1, 1, 1, radialSegments, 1, openEnded);
	const matType = el.shader && el.shader.type === "basic" ? THREE.MeshBasicMaterial : THREE.MeshPhongMaterial;
	const matOpts = {
		color: new THREE.Color(...color),
		transparent: true,
		opacity,
		side: THREE.DoubleSide
	};
	const sh = el.shader || {};
	if (sh.depthWrite !== void 0) matOpts.depthWrite = !!sh.depthWrite;
	if (sh.depthTest !== void 0) matOpts.depthTest = !!sh.depthTest;
	if (matType === THREE.MeshPhongMaterial) {
		matOpts.shininess = sh.shininess !== void 0 ? sh.shininess : 40;
		if (sh.emissive) matOpts.emissive = new THREE.Color(sh.emissive);
		if (sh.specular) matOpts.specular = new THREE.Color(sh.specular);
		if (sh.flatShading) matOpts.flatShading = true;
	}
	const mat = new matType(matOpts);
	const mesh = new THREE.Mesh(geom, mat);
	mesh.userData.targetOpacity = opacity;
	_setCylinderTransformFromData(mesh, from, to, radius);
	cylinderState.three.scene.add(mesh);
	cylinderState.planeMeshes.push(mesh);
	if (label) addLabel3D(label, [
		(from[0] + to[0]) / 2,
		(from[1] + to[1]) / 2,
		(from[2] + to[2]) / 2
	], color);
	return {
		type: "cylinder",
		color,
		label
	};
}
//#endregion
//#region src/objects/animated-cylinder.ts
var animatedCylinderState = state;
function renderAnimatedCylinder(el, view) {
	const color = parseColor(el.color || "#88aaff");
	const opacity = el.opacity !== void 0 ? el.opacity : .35;
	const radialSegments = el.radialSegments || 32;
	const openEnded = !!el.openEnded;
	const label = el.label;
	const labelExprString = typeof el.labelExpr === "string" && el.labelExpr.trim() ? el.labelExpr.trim() : null;
	const radius = typeof el.radius === "number" ? el.radius : 1;
	const radiusExpr = typeof el.radiusExpr === "string" ? el.radiusExpr : typeof el.radius === "string" ? el.radius : null;
	const fromExpr = Array.isArray(el.fromExpr) && el.fromExpr.length === 3 ? el.fromExpr : Array.isArray(el.from) && el.from.length === 3 ? el.from.map((v) => String(v)) : null;
	const toExpr = Array.isArray(el.expr) && el.expr.length === 3 ? el.expr : Array.isArray(el.toExpr) && el.toExpr.length === 3 ? el.toExpr : Array.isArray(el.to) && el.to.length === 3 ? el.to.map((v) => String(v)) : null;
	if (!fromExpr || !toExpr) return null;
	let fromFns, toFns, radiusFn = null;
	try {
		fromFns = fromExpr.map((e) => compileExpr(e));
		toFns = toExpr.map((e) => compileExpr(e));
		if (radiusExpr) radiusFn = compileExpr(radiusExpr);
	} catch (err) {
		console.warn("animated_cylinder expr compile error:", err);
		return null;
	}
	function evalTriplet(fns, tSec) {
		return fns.map((fn) => evalExpr(fn, tSec));
	}
	let initFrom, initTo;
	try {
		initFrom = evalTriplet(fromFns, 0);
		initTo = evalTriplet(toFns, 0);
	} catch (err) {
		console.warn("animated_cylinder expr eval error:", err);
		return null;
	}
	const geom = new THREE.CylinderGeometry(1, 1, 1, radialSegments, 1, openEnded);
	const matType = el.shader && el.shader.type === "basic" ? THREE.MeshBasicMaterial : THREE.MeshPhongMaterial;
	const matOpts = {
		color: new THREE.Color(...color),
		transparent: true,
		opacity,
		side: THREE.DoubleSide
	};
	const sh = el.shader || {};
	if (sh.depthWrite !== void 0) matOpts.depthWrite = !!sh.depthWrite;
	if (sh.depthTest !== void 0) matOpts.depthTest = !!sh.depthTest;
	if (matType === THREE.MeshPhongMaterial) {
		matOpts.shininess = sh.shininess !== void 0 ? sh.shininess : 40;
		if (sh.emissive) matOpts.emissive = new THREE.Color(sh.emissive);
		if (sh.specular) matOpts.specular = new THREE.Color(sh.specular);
		if (sh.flatShading) matOpts.flatShading = true;
	}
	const mat = new matType(matOpts);
	const mesh = new THREE.Mesh(geom, mat);
	mesh.userData.targetOpacity = opacity;
	let initRadius = radius;
	if (radiusFn) try {
		initRadius = evalExpr(radiusFn, 0);
	} catch (err) {}
	_setCylinderTransformFromData(mesh, initFrom, initTo, initRadius);
	animatedCylinderState.three.scene.add(mesh);
	animatedCylinderState.planeMeshes.push(mesh);
	let labelExprFn = null;
	if (labelExprString) try {
		labelExprFn = compileExpr(labelExprString);
	} catch (err) {
		console.warn("animated_cylinder labelExpr compile error:", err);
	}
	let labelEl = null;
	if (label || labelExprFn) {
		const mid = [
			(initFrom[0] + initTo[0]) / 2,
			(initFrom[1] + initTo[1]) / 2,
			(initFrom[2] + initTo[2]) / 2
		];
		labelEl = addLabel3D(label || "", mid, color);
		if (labelExprFn) try {
			const txt = String(evalExpr(labelExprFn, 0));
			labelEl.el.innerHTML = renderKaTeX$1(txt, false);
			labelEl._lastDynamicText = txt;
		} catch (_e) {}
	}
	const animState = { stopped: false };
	const animExprEntry = {
		exprStrings: toExpr,
		fromExprStrings: fromExpr,
		radiusExprString: radiusExpr || null,
		animState,
		compiledFns: toFns,
		fromExprFns: fromFns,
		radiusFn
	};
	animatedCylinderState.activeAnimExprs.push(animExprEntry);
	const startTime = animatedCylinderState.sceneStartTime;
	animatedCylinderState.activeAnimUpdaters.push({
		animState,
		updateFrame(nowMs) {
			const tSec = (nowMs - startTime) / 1e3;
			const curFromFns = animExprEntry.fromExprFns || fromFns;
			const curToFns = animExprEntry.compiledFns || toFns;
			const curRadiusFn = animExprEntry.radiusFn || radiusFn;
			let fromData = initFrom;
			let toData = initTo;
			let curRadius = radius;
			try {
				fromData = evalTriplet(curFromFns, tSec);
				toData = evalTriplet(curToFns, tSec);
				if (curRadiusFn) curRadius = evalExpr(curRadiusFn, tSec);
			} catch (err) {}
			_setCylinderTransformFromData(mesh, fromData, toData, curRadius);
			if (labelEl) {
				labelEl.dataPos[0] = (fromData[0] + toData[0]) / 2;
				labelEl.dataPos[1] = (fromData[1] + toData[1]) / 2;
				labelEl.dataPos[2] = (fromData[2] + toData[2]) / 2;
				if (labelExprFn) try {
					const txt = String(evalExpr(labelExprFn, tSec));
					if (labelEl._lastDynamicText !== txt) {
						labelEl.el.innerHTML = renderKaTeX$1(txt, false);
						labelEl._lastDynamicText = txt;
					}
				} catch (_e) {}
			}
		}
	});
	return {
		type: "animated_cylinder",
		color,
		label,
		_animState: animState,
		_animExprEntry: animExprEntry
	};
}
//#endregion
//#region src/objects/animated-polygon.ts
var animatedPolygonState = state;
var _noiseTexture = null;
function _getNoiseTexture() {
	if (_noiseTexture) return _noiseTexture;
	const size = 256;
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext("2d");
	const img = ctx.createImageData(size, size);
	for (let i = 0; i < img.data.length; i += 4) {
		const v = 205 + Math.floor(Math.random() * 50);
		img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
		img.data[i + 3] = 255;
	}
	ctx.putImageData(img, 0, 0);
	_noiseTexture = new THREE.CanvasTexture(canvas);
	_noiseTexture.wrapS = _noiseTexture.wrapT = THREE.RepeatWrapping;
	return _noiseTexture;
}
function _computePlaneUVs(wVerts, normal) {
	const n = normal.clone().normalize();
	const v0 = new THREE.Vector3(wVerts[0][0], wVerts[0][1], wVerts[0][2]);
	const tang = new THREE.Vector3(wVerts[1][0] - wVerts[0][0], wVerts[1][1] - wVerts[0][1], wVerts[1][2] - wVerts[0][2]);
	tang.addScaledVector(n, -tang.dot(n));
	if (tang.length() < 1e-9) return wVerts.map(() => [0, 0]);
	tang.normalize();
	const bitang = new THREE.Vector3().crossVectors(n, tang);
	const proj = wVerts.map((v) => {
		const dx = v[0] - v0.x, dy = v[1] - v0.y, dz = v[2] - v0.z;
		return [dx * tang.x + dy * tang.y + dz * tang.z, dx * bitang.x + dy * bitang.y + dz * bitang.z];
	});
	const minU = Math.min(...proj.map((p) => p[0]));
	const minV = Math.min(...proj.map((p) => p[1]));
	const maxU = Math.max(...proj.map((p) => p[0]));
	const maxV = Math.max(...proj.map((p) => p[1]));
	const scale = Math.max(maxU - minU, maxV - minV) || 1;
	return proj.map(([u, v]) => [(u - minU) / scale, (v - minV) / scale]);
}
function renderAnimatedPolygon(el, view) {
	const color = parseColor(el.color || "#aa66ff");
	const opacityRaw = el.opacity !== void 0 ? el.opacity : .3;
	const opacityExpr = typeof opacityRaw === "string" ? compileExpr(opacityRaw) : null;
	const colorExprFn = typeof el.colorExpr === "string" && el.colorExpr.trim() ? compileExpr(el.colorExpr.trim()) : null;
	const colorMapFn = colorExprFn ? buildColorMap(el.colorMap) : null;
	const opacity = opacityExpr ? .3 : opacityRaw;
	const thickness = el.thickness || .02;
	const label = el.label;
	const labelExprString = typeof el.labelExpr === "string" && el.labelExpr.trim() ? el.labelExpr.trim() : null;
	const sh = el.shader || {};
	const animState = { stopped: false };
	const isRegular = el.regular && typeof el.regular === "object";
	let getVerts;
	let animExprEntry;
	if (isRegular) {
		const reg = el.regular;
		const nExpr = String(reg.n != null ? reg.n : "3");
		const rExpr = String(reg.radius != null ? reg.radius : "1");
		const cxExpr = String(Array.isArray(reg.center) && reg.center[0] != null ? reg.center[0] : "0");
		const cyExpr = String(Array.isArray(reg.center) && reg.center[1] != null ? reg.center[1] : "0");
		const czExpr = String(Array.isArray(reg.center) && reg.center[2] != null ? reg.center[2] : "0");
		const rotExpr = String(reg.rotation != null ? reg.rotation : "0");
		const regExprs = [
			nExpr,
			rExpr,
			cxExpr,
			cyExpr,
			czExpr,
			rotExpr
		];
		const regState = {
			cN: compileExpr(nExpr),
			cR: compileExpr(rExpr),
			cCx: compileExpr(cxExpr),
			cCy: compileExpr(cyExpr),
			cCz: compileExpr(czExpr),
			cRot: compileExpr(rotExpr)
		};
		const plane = (reg.plane || "xy").toLowerCase();
		getVerts = (tSec) => {
			const N = Math.max(3, Math.round(evalExpr(regState.cN, tSec)));
			const r = evalExpr(regState.cR, tSec);
			const cx = evalExpr(regState.cCx, tSec);
			const cy = evalExpr(regState.cCy, tSec);
			const cz = evalExpr(regState.cCz, tSec);
			const rot = evalExpr(regState.cRot, tSec);
			const verts = [];
			for (let k = 0; k < N; k++) {
				const angle = rot + 2 * Math.PI * k / N;
				const a = r * Math.cos(angle), b = r * Math.sin(angle);
				if (plane === "xz") verts.push([
					cx + a,
					cy,
					cz + b
				]);
				else if (plane === "yz") verts.push([
					cx,
					cy + a,
					cz + b
				]);
				else verts.push([
					cx + a,
					cy + b,
					cz
				]);
			}
			return verts;
		};
		animExprEntry = {
			exprStrings: regExprs,
			animState,
			compiledFns: Object.values(regState),
			_isRegularPolygon: true,
			_regExprs: regExprs,
			_regState: regState
		};
	} else {
		const vertexExprs = el.vertices;
		if (!Array.isArray(vertexExprs) || vertexExprs.length < 3) return null;
		let compiledVerts = vertexExprs.map((v) => v.map((e) => compileExpr(e)));
		getVerts = (tSec) => animExprEntry._compiledVerts.map((vfns) => vfns.map((fn) => evalExpr(fn, tSec)));
		animExprEntry = {
			exprStrings: vertexExprs.flat(),
			animState,
			compiledFns: compiledVerts.flat(),
			_isAnimatedPolygon: true,
			_vertexExprs: vertexExprs,
			_compiledVerts: compiledVerts
		};
	}
	let currentDataVerts;
	try {
		currentDataVerts = getVerts(0);
	} catch (err) {
		console.warn("animated_polygon eval error:", err);
		return null;
	}
	function rebuildGeometry(dataVerts) {
		const wVerts = dataVerts.map((v) => dataToWorld(v));
		const a = new THREE.Vector3(wVerts[1][0] - wVerts[0][0], wVerts[1][1] - wVerts[0][1], wVerts[1][2] - wVerts[0][2]);
		const b = new THREE.Vector3(wVerts[2][0] - wVerts[0][0], wVerts[2][1] - wVerts[0][1], wVerts[2][2] - wVerts[0][2]);
		const normal = a.cross(b).normalize();
		const halfThick = dataLenToWorld(thickness / 2) * (animatedPolygonState.displayParams.planeScale || 1);
		const positions = [];
		const top = wVerts.map((v) => [
			v[0] + normal.x * halfThick,
			v[1] + normal.y * halfThick,
			v[2] + normal.z * halfThick
		]);
		const bot = wVerts.map((v) => [
			v[0] - normal.x * halfThick,
			v[1] - normal.y * halfThick,
			v[2] - normal.z * halfThick
		]);
		for (let i = 1; i < top.length - 1; i++) positions.push(...top[0], ...top[i], ...top[i + 1]);
		for (let i = 1; i < bot.length - 1; i++) positions.push(...bot[0], ...bot[i + 1], ...bot[i]);
		for (let i = 0; i < wVerts.length; i++) {
			const j = (i + 1) % wVerts.length;
			positions.push(...top[i], ...bot[i], ...top[j]);
			positions.push(...top[j], ...bot[i], ...bot[j]);
		}
		return new Float32Array(positions);
	}
	const isStandard = sh.type === "standard";
	const FILL_MAX_FLOATS = 18432;
	const UV_MAX_FLOATS = 12288;
	const fillAttr = new THREE.Float32BufferAttribute(new Float32Array(FILL_MAX_FLOATS), 3);
	fillAttr.setUsage(THREE.DynamicDrawUsage);
	const uvAttr = isStandard ? new THREE.Float32BufferAttribute(new Float32Array(UV_MAX_FLOATS), 2) : null;
	if (uvAttr) uvAttr.setUsage(THREE.DynamicDrawUsage);
	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", fillAttr);
	if (uvAttr) geom.setAttribute("uv", uvAttr);
	function applyGeomVerts(dataVerts) {
		const arr = rebuildGeometry(dataVerts);
		fillAttr.array.set(arr);
		fillAttr.needsUpdate = true;
		geom.setDrawRange(0, arr.length / 3);
		geom.computeVertexNormals();
		if (uvAttr) {
			const wV = dataVerts.map((v) => dataToWorld(v));
			const a2 = new THREE.Vector3(wV[1][0] - wV[0][0], wV[1][1] - wV[0][1], wV[1][2] - wV[0][2]);
			const b2 = new THREE.Vector3(wV[2][0] - wV[0][0], wV[2][1] - wV[0][1], wV[2][2] - wV[0][2]);
			const planeUVs = _computePlaneUVs(wV, a2.clone().cross(b2).normalize());
			const uvData = [];
			for (let i = 1; i < wV.length - 1; i++) uvData.push(...planeUVs[0], ...planeUVs[i], ...planeUVs[i + 1]);
			for (let i = 1; i < wV.length - 1; i++) uvData.push(...planeUVs[0], ...planeUVs[i + 1], ...planeUVs[i]);
			for (let i = 0; i < wV.length; i++) uvData.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
			uvAttr.array.set(uvData);
			uvAttr.needsUpdate = true;
		}
	}
	applyGeomVerts(currentDataVerts);
	const baseMatOpts = {
		color: new THREE.Color(...color),
		opacity: animatedPolygonState.displayParams.planeOpacity * (opacity / .5),
		transparent: true,
		side: THREE.DoubleSide,
		depthWrite: false
	};
	let mat;
	if (sh.type === "basic") mat = new THREE.MeshBasicMaterial(baseMatOpts);
	else if (sh.type === "standard") {
		const repeat = sh.textureRepeat !== void 0 ? sh.textureRepeat : 5;
		const noiseTex = _getNoiseTexture();
		noiseTex.repeat.set(repeat, repeat);
		Object.assign(baseMatOpts, {
			roughness: sh.roughness !== void 0 ? sh.roughness : .85,
			metalness: sh.metalness !== void 0 ? sh.metalness : .08,
			map: noiseTex
		});
		if (sh.emissive) baseMatOpts.emissive = new THREE.Color(sh.emissive);
		mat = new THREE.MeshStandardMaterial(baseMatOpts);
	} else {
		baseMatOpts.shininess = sh.shininess !== void 0 ? sh.shininess : 30;
		if (sh.emissive) baseMatOpts.emissive = new THREE.Color(sh.emissive);
		if (sh.specular) baseMatOpts.specular = new THREE.Color(sh.specular);
		mat = new THREE.MeshPhongMaterial(baseMatOpts);
	}
	const mesh = new THREE.Mesh(geom, mat);
	mesh.userData.targetOpacity = opacity;
	mesh.userData.ignorePlaneOpacity = !!sh.ignorePlaneOpacity;
	if (colorExprFn && colorMapFn) try {
		const u0 = normalizeColorValue(evalExpr(colorExprFn, 0), el.colorDomain);
		if (u0 !== null) {
			const rgb0 = colorMapFn(u0);
			mat.color.setRGB(rgb0[0], rgb0[1], rgb0[2]);
		}
	} catch (_err) {}
	const _serialA = el.renderOrder !== void 0 ? el.renderOrder : animatedPolygonState._planeMeshSerial++;
	mesh.renderOrder = _serialA;
	mesh.position.z = el.depthZ !== void 0 ? el.depthZ : _serialA * 2e-4;
	animatedPolygonState.three.scene.add(mesh);
	animatedPolygonState.planeMeshes.push(mesh);
	let outlineArrayNode = null;
	let outlineLineNode = null;
	let outlineWidthExpr = null;
	let outlineOpacityExpr = null;
	const OUTLINE_MAX_PTS = 513;
	function buildOutlinePts(dataVerts) {
		const pts = dataVerts.slice();
		pts.push(pts[0]);
		const last = pts[pts.length - 1];
		while (pts.length < OUTLINE_MAX_PTS) pts.push(last);
		return pts;
	}
	const outlineWidthRaw = el.outlineWidth != null ? el.outlineWidth : isRegular ? 1.5 : 0;
	const outlineOpacityRaw = el.outlineOpacity != null ? el.outlineOpacity : null;
	const outlineWidthInit = typeof outlineWidthRaw === "string" ? evalExpr(compileExpr(outlineWidthRaw), 0) || 1.5 : outlineWidthRaw;
	if (outlineWidthInit > 0 || typeof outlineWidthRaw === "string") {
		if (typeof outlineWidthRaw === "string") outlineWidthExpr = compileExpr(outlineWidthRaw);
		if (outlineOpacityRaw != null && typeof outlineOpacityRaw === "string") outlineOpacityExpr = compileExpr(String(outlineOpacityRaw));
		const outlineColor = parseColor(el.outlineColor || el.color || "#aa66ff");
		const outlineOpacityInit = outlineOpacityRaw != null ? typeof outlineOpacityRaw === "string" ? evalExpr(compileExpr(String(outlineOpacityRaw)), 0) : Number(outlineOpacityRaw) : Math.min(1, opacity * 2);
		outlineArrayNode = view.array({
			channels: 3,
			width: OUTLINE_MAX_PTS,
			data: buildOutlinePts(currentDataVerts),
			live: true
		});
		outlineLineNode = outlineArrayNode.line({
			color: new THREE.Color(...outlineColor),
			width: outlineWidthInit,
			opacity: outlineOpacityInit,
			zBias: 2
		});
	}
	let labelExprFn = null;
	if (labelExprString) try {
		labelExprFn = compileExpr(labelExprString);
	} catch (err) {
		console.warn("animated_polygon labelExpr compile error:", err);
	}
	let labelEl = null;
	if (label || labelExprFn) {
		const cx = currentDataVerts.reduce((s, v) => s + v[0], 0) / currentDataVerts.length;
		const cy = currentDataVerts.reduce((s, v) => s + v[1], 0) / currentDataVerts.length;
		const cz = currentDataVerts.reduce((s, v) => s + v[2], 0) / currentDataVerts.length;
		labelEl = addLabel3D(label || "", [
			cx,
			cy,
			cz
		], color);
		if (labelExprFn) try {
			const txt = String(evalExpr(labelExprFn, 0));
			labelEl.el.innerHTML = renderKaTeX$1(txt, false);
			labelEl._lastDynamicText = txt;
		} catch (_e) {}
	}
	animatedPolygonState.activeAnimExprs.push(animExprEntry);
	const startTime = animatedPolygonState.sceneStartTime;
	animatedPolygonState.activeAnimUpdaters.push({
		animState,
		updateFrame(nowMs) {
			if (!mesh.visible) return;
			const tSec = (nowMs - startTime) / 1e3;
			try {
				const verts = getVerts(tSec);
				applyGeomVerts(verts);
				if (opacityExpr) {
					const op = evalExpr(opacityExpr, tSec);
					mat.opacity = animatedPolygonState.displayParams.planeOpacity * (op / .5);
					if (outlineLineNode && !outlineOpacityExpr) outlineLineNode.set("opacity", Math.min(1, op * 2));
				}
				if (colorExprFn && colorMapFn) try {
					const u = normalizeColorValue(evalExpr(colorExprFn, tSec), el.colorDomain);
					if (u !== null) {
						const rgb = colorMapFn(u);
						mat.color.setRGB(rgb[0], rgb[1], rgb[2]);
					}
				} catch (_err) {}
				if (outlineArrayNode) outlineArrayNode.set("data", buildOutlinePts(verts));
				if (outlineLineNode && outlineWidthExpr) outlineLineNode.set("width", evalExpr(outlineWidthExpr, tSec));
				if (outlineLineNode && outlineOpacityExpr) outlineLineNode.set("opacity", evalExpr(outlineOpacityExpr, tSec));
				if (labelEl) {
					labelEl.dataPos[0] = verts.reduce((s, v) => s + v[0], 0) / verts.length;
					labelEl.dataPos[1] = verts.reduce((s, v) => s + v[1], 0) / verts.length + .3;
					labelEl.dataPos[2] = verts.reduce((s, v) => s + v[2], 0) / verts.length;
					if (labelExprFn) try {
						const txt = String(evalExpr(labelExprFn, tSec));
						if (labelEl._lastDynamicText !== txt) {
							labelEl.el.innerHTML = renderKaTeX$1(txt, false);
							labelEl._lastDynamicText = txt;
						}
					} catch (_e) {}
				}
			} catch (err) {}
		}
	});
	return {
		type: "animated_polygon",
		color,
		label,
		_animState: animState,
		_animExprEntry: animExprEntry
	};
}
//#endregion
//#region src/objects/animated-curve.ts
var animatedCurveState = state;
function renderAnimatedCurve(el, view) {
	const color = parseColor(el.color || "#ff8844");
	const width = el.width != null ? el.width : 3;
	const opacityRaw = el.opacity != null ? el.opacity : 1;
	const opacityExpr = typeof opacityRaw === "string" ? compileExpr(opacityRaw) : null;
	const lineOpacity = opacityExpr ? evalExpr(opacityExpr, 0) : Number(opacityRaw);
	const label = el.label;
	const labelExprString = typeof el.labelExpr === "string" && el.labelExpr.trim() ? el.labelExpr.trim() : null;
	const labelOffset = Array.isArray(el.labelOffset) && el.labelOffset.length === 3 ? [
		Number(el.labelOffset[0]) || 0,
		Number(el.labelOffset[1]) || 0,
		Number(el.labelOffset[2]) || 0
	] : [
		0,
		.3,
		0
	];
	const samples = el.samples || 200;
	let rangeLExpr = null, rangeRExpr = null;
	let rangeL = -1, rangeR = 1;
	const rangeSpec = el.rangeExpr || el.range || [-1, 1];
	const rSpec0 = rangeSpec[0], rSpec1 = rangeSpec[1];
	if (typeof rSpec0 === "string") {
		rangeLExpr = compileExpr(rSpec0);
		rangeL = evalExpr(rangeLExpr, 0);
	} else rangeL = Number(rSpec0) || 0;
	if (typeof rSpec1 === "string") {
		rangeRExpr = compileExpr(rSpec1);
		rangeR = evalExpr(rangeRExpr, 0);
	} else rangeR = Number(rSpec1) || 1;
	const exprStr = el.expr || "0";
	const cCurve = compileExpr(exprStr);
	function evalRange(tSec) {
		return [rangeLExpr ? evalExpr(rangeLExpr, tSec) : rangeL, rangeRExpr ? evalExpr(rangeRExpr, tSec) : rangeR];
	}
	function evalAtX(x, tSec) {
		try {
			const y = evalExpr(cCurve, tSec, { extraScope: { x } });
			return isFinite(y) ? y : 0;
		} catch (e) {
			return 0;
		}
	}
	if (el.plane !== void 0 && el.plane !== "xy" && el.plane !== "xz") console.warn(`animated_curve "${el.id || ""}": plane "${el.plane}" is not supported (use 'xy' or 'xz'); falling back to 'xy'.`);
	const curvePlane = el.plane === "xz" ? "xz" : "xy";
	function buildCurvePoints(tSec) {
		const [rL, rR] = evalRange(tSec);
		const pts = [];
		for (let i = 0; i <= samples; i++) {
			const x = rL + (rR - rL) * (i / samples);
			const v = evalAtX(x, tSec);
			pts.push(curvePlane === "xz" ? [
				x,
				0,
				v
			] : [
				x,
				v,
				0
			]);
		}
		return pts;
	}
	const initPts = buildCurvePoints(0);
	const curveEntry = {
		node: null,
		baseWidth: width,
		baseOpacity: lineOpacity,
		widthParam: "lineWidth",
		anchorDataPos: initPts[Math.floor(initPts.length / 2)] || [
			0,
			0,
			0
		]
	};
	const lineW = resolveLineWidth(curveEntry);
	const curveData = view.array({
		channels: 3,
		width: initPts.length,
		data: initPts,
		live: true
	});
	const curveNode = curveData.line({
		color: new THREE.Color(...color),
		width: lineW,
		opacity: lineOpacity * (animatedCurveState.displayParams.lineOpacity || 1),
		visible: el.showCurve !== false
	});
	curveEntry.node = curveNode;
	animatedCurveState.lineNodes.push(curveEntry);
	let labelExprFn = null;
	if (labelExprString) try {
		labelExprFn = compileExpr(labelExprString);
	} catch (err) {
		console.warn("animated_curve labelExpr compile error:", err);
	}
	let labelEl = null;
	if (label || labelExprFn) {
		const mid = initPts[Math.floor(initPts.length / 2)] || [
			0,
			0,
			0
		];
		labelEl = addLabel3D(label || "", [
			mid[0] + labelOffset[0],
			mid[1] + labelOffset[1],
			mid[2] + labelOffset[2]
		], color);
		if (labelExprFn) try {
			const txt = String(evalExpr(labelExprFn, 0));
			labelEl.el.innerHTML = renderKaTeX$1(txt, false);
			labelEl._lastDynamicText = txt;
		} catch (_e) {}
	}
	if (curvePlane === "xz" && Array.isArray(el.fillRegions) && el.fillRegions.length) console.warn(`animated_curve "${el.id || ""}": fillRegions are ignored when plane is "xz"`);
	const fillRegions = curvePlane === "xz" ? [] : Array.isArray(el.fillRegions) ? el.fillRegions : [];
	const FILL_MAX_FLOATS = 18432;
	const fillEntries = fillRegions.map((fr) => {
		const frColor = parseColor(fr.color || el.color || "#ff8844");
		const frOpacityRaw = fr.opacity != null ? fr.opacity : .35;
		const frOpacityExpr = typeof frOpacityRaw === "string" ? compileExpr(frOpacityRaw) : null;
		const frOpacity = frOpacityExpr ? evalExpr(frOpacityExpr, 0) : Number(frOpacityRaw);
		const cAbove = fr.above != null ? compileExpr(String(fr.above)) : null;
		const cBelow = fr.below != null ? compileExpr(String(fr.below)) : null;
		const cRightOf = fr.rightOf != null ? compileExpr(String(fr.rightOf)) : null;
		const cLeftOf = fr.leftOf != null ? compileExpr(String(fr.leftOf)) : null;
		const fillAttr = new THREE.Float32BufferAttribute(new Float32Array(FILL_MAX_FLOATS), 3);
		fillAttr.setUsage(THREE.DynamicDrawUsage);
		const fillGeom = new THREE.BufferGeometry();
		fillGeom.setAttribute("position", fillAttr);
		const fillMat = new THREE.MeshBasicMaterial({
			color: new THREE.Color(...frColor),
			opacity: animatedCurveState.displayParams.planeOpacity * (frOpacity / .5),
			transparent: true,
			side: THREE.DoubleSide,
			depthWrite: false
		});
		const fillMesh = new THREE.Mesh(fillGeom, fillMat);
		const _ser = animatedCurveState._planeMeshSerial++;
		fillMesh.renderOrder = _ser;
		fillMesh.position.z = el.depthZ !== void 0 ? el.depthZ : _ser * 2e-4;
		animatedCurveState.three.scene.add(fillMesh);
		animatedCurveState.planeMeshes.push(fillMesh);
		let outlineArrayNode = null, outlineLineNode = null;
		let outlineWidthExpr = null, outlineOpacityExpr = null;
		const outlineWidthRaw = fr.outlineWidth != null ? fr.outlineWidth : null;
		const outlineOpacityRaw = fr.outlineOpacity != null ? fr.outlineOpacity : null;
		const cBoundary = cAbove || cBelow || null;
		if (outlineWidthRaw != null) {
			if (typeof outlineWidthRaw === "string") outlineWidthExpr = compileExpr(outlineWidthRaw);
			if (outlineOpacityRaw != null && typeof outlineOpacityRaw === "string") outlineOpacityExpr = compileExpr(String(outlineOpacityRaw));
			const outlineColor = parseColor(fr.outlineColor || fr.color || el.color || "#ff8844");
			const outlineWidthInit = typeof outlineWidthRaw === "string" ? evalExpr(compileExpr(outlineWidthRaw), 0) || 2 : outlineWidthRaw;
			const outlineOpacityInit = outlineOpacityRaw != null ? typeof outlineOpacityRaw === "string" ? evalExpr(compileExpr(String(outlineOpacityRaw)), 0) : Number(outlineOpacityRaw) : Math.min(1, frOpacity * 2);
			const OUTLINE_MAX_PTS = 2 * (samples + 1) + 4;
			const initBndPts = Array(OUTLINE_MAX_PTS).fill([
				0,
				0,
				0
			]);
			outlineArrayNode = view.array({
				channels: 3,
				width: OUTLINE_MAX_PTS,
				data: initBndPts,
				live: true
			});
			outlineLineNode = outlineArrayNode.line({
				color: new THREE.Color(...outlineColor),
				width: outlineWidthInit,
				opacity: outlineOpacityInit,
				zBias: 2
			});
		}
		return {
			fr,
			frOpacityExpr,
			frOpacity,
			cAbove,
			cBelow,
			cRightOf,
			cLeftOf,
			fillAttr,
			fillGeom,
			fillMat,
			cBoundary,
			outlineArrayNode,
			outlineLineNode,
			outlineWidthExpr,
			outlineOpacityExpr,
			outlineOpacityRaw
		};
	});
	function evalBound(compiled, x, tSec) {
		try {
			const v = evalExpr(compiled, tSec, { extraScope: { x } });
			return isFinite(v) ? v : 0;
		} catch (e) {
			return 0;
		}
	}
	function updateFillMesh(entry, tSec, pts) {
		const { cAbove, cBelow, cRightOf, cLeftOf, fillAttr, fillGeom } = entry;
		const rightOfX = cRightOf ? evalExpr(cRightOf, tSec) : null;
		const leftOfX = cLeftOf ? evalExpr(cLeftOf, tSec) : null;
		const floats = fillAttr.array;
		let idx = 0;
		for (let i = 0; i < pts.length - 1; i++) {
			const x0 = pts[i][0], x1 = pts[i + 1][0];
			const cy0 = pts[i][1], cy1 = pts[i + 1][1];
			if (rightOfX != null && x1 < rightOfX) continue;
			if (leftOfX != null && x0 > leftOfX) continue;
			const aboveY0 = cAbove ? evalBound(cAbove, x0, tSec) : null;
			const aboveY1 = cAbove ? evalBound(cAbove, x1, tSec) : null;
			const belowY0 = cBelow ? evalBound(cBelow, x0, tSec) : null;
			const belowY1 = cBelow ? evalBound(cBelow, x1, tSec) : null;
			let yTop0, yBot0, yTop1, yBot1, show0, show1;
			if (cAbove != null && cBelow != null) {
				yBot0 = aboveY0;
				yTop0 = belowY0;
				yBot1 = aboveY1;
				yTop1 = belowY1;
				show0 = yTop0 > yBot0;
				show1 = yTop1 > yBot1;
			} else if (cAbove != null) {
				show0 = cy0 >= aboveY0;
				show1 = cy1 >= aboveY1;
				yTop0 = cy0;
				yBot0 = aboveY0;
				yTop1 = cy1;
				yBot1 = aboveY1;
			} else if (cBelow != null) {
				show0 = cy0 <= belowY0;
				show1 = cy1 <= belowY1;
				yTop0 = belowY0;
				yBot0 = cy0;
				yTop1 = belowY1;
				yBot1 = cy1;
			} else {
				show0 = show1 = true;
				yTop0 = Math.max(0, cy0);
				yBot0 = Math.min(0, cy0);
				yTop1 = Math.max(0, cy1);
				yBot1 = Math.min(0, cy1);
			}
			if (!show0 && !show1) continue;
			if (idx + 18 > FILL_MAX_FLOATS) break;
			const w00 = dataToWorld([
				x0,
				yBot0,
				0
			]);
			const w01 = dataToWorld([
				x0,
				yTop0,
				0
			]);
			const w10 = dataToWorld([
				x1,
				yBot1,
				0
			]);
			const w11 = dataToWorld([
				x1,
				yTop1,
				0
			]);
			floats[idx++] = w00[0];
			floats[idx++] = w00[1];
			floats[idx++] = w00[2];
			floats[idx++] = w10[0];
			floats[idx++] = w10[1];
			floats[idx++] = w10[2];
			floats[idx++] = w01[0];
			floats[idx++] = w01[1];
			floats[idx++] = w01[2];
			floats[idx++] = w01[0];
			floats[idx++] = w01[1];
			floats[idx++] = w01[2];
			floats[idx++] = w10[0];
			floats[idx++] = w10[1];
			floats[idx++] = w10[2];
			floats[idx++] = w11[0];
			floats[idx++] = w11[1];
			floats[idx++] = w11[2];
		}
		fillAttr.needsUpdate = true;
		fillGeom.setDrawRange(0, idx / 3);
	}
	function buildOutlinePts(entry, tSec, pts) {
		const { cAbove, cBelow, cRightOf, cLeftOf } = entry;
		const rightOfX = cRightOf ? evalExpr(cRightOf, tSec) : null;
		const leftOfX = cLeftOf ? evalExpr(cLeftOf, tSec) : null;
		const clipped = [];
		for (const p of pts) {
			const x = p[0], cy = p[1];
			if (rightOfX != null && x < rightOfX - 1e-9) continue;
			if (leftOfX != null && x > leftOfX + 1e-9) continue;
			let topY, botY;
			if (cAbove != null && cBelow != null) {
				topY = evalBound(cBelow, x, tSec);
				botY = evalBound(cAbove, x, tSec);
			} else if (cAbove != null) {
				topY = cy;
				botY = evalBound(cAbove, x, tSec);
			} else if (cBelow != null) {
				topY = evalBound(cBelow, x, tSec);
				botY = cy;
			} else {
				topY = Math.max(0, cy);
				botY = Math.min(0, cy);
			}
			clipped.push({
				x,
				topY,
				botY
			});
		}
		if (clipped.length === 0) return [[
			0,
			0,
			0
		]];
		const perimeter = [];
		for (const s of clipped) perimeter.push([
			s.x,
			s.topY,
			0
		]);
		const last = clipped[clipped.length - 1];
		perimeter.push([
			last.x,
			last.botY,
			0
		]);
		for (let i = clipped.length - 1; i >= 0; i--) perimeter.push([
			clipped[i].x,
			clipped[i].botY,
			0
		]);
		perimeter.push([
			clipped[0].x,
			clipped[0].topY,
			0
		]);
		perimeter.push(perimeter[0]);
		const OUTLINE_MAX_PTS = 2 * (samples + 1) + 4;
		const padPt = perimeter[perimeter.length - 1];
		while (perimeter.length < OUTLINE_MAX_PTS) perimeter.push(padPt);
		return perimeter;
	}
	for (const entry of fillEntries) updateFillMesh(entry, 0, initPts);
	for (const entry of fillEntries) if (entry.outlineArrayNode) entry.outlineArrayNode.set("data", buildOutlinePts(entry, 0, initPts));
	const animState = { stopped: false };
	const animExprEntry = {
		exprStrings: [exprStr],
		animState,
		compiledFns: [cCurve],
		_isAnimatedCurve: true
	};
	animatedCurveState.activeAnimExprs.push(animExprEntry);
	const startTime = animatedCurveState.sceneStartTime;
	animatedCurveState.activeAnimUpdaters.push({
		animState,
		updateFrame(nowMs) {
			const tSec = (nowMs - startTime) / 1e3;
			try {
				const pts = buildCurvePoints(tSec);
				curveData.set("data", pts);
				if (labelEl) {
					const mid = pts[Math.floor(pts.length / 2)] || [
						0,
						0,
						0
					];
					labelEl.dataPos[0] = mid[0] + labelOffset[0];
					labelEl.dataPos[1] = mid[1] + labelOffset[1];
					labelEl.dataPos[2] = mid[2] + labelOffset[2];
					if (labelExprFn) try {
						const txt = String(evalExpr(labelExprFn, tSec));
						if (labelEl._lastDynamicText !== txt) {
							labelEl.el.innerHTML = renderKaTeX$1(txt, false);
							labelEl._lastDynamicText = txt;
						}
					} catch (_e) {}
				}
				if (opacityExpr) curveNode.set("opacity", evalExpr(opacityExpr, tSec) * (animatedCurveState.displayParams.lineOpacity || 1));
				for (const entry of fillEntries) {
					updateFillMesh(entry, tSec, pts);
					if (entry.frOpacityExpr) entry.fillMat.opacity = animatedCurveState.displayParams.planeOpacity * (evalExpr(entry.frOpacityExpr, tSec) / .5);
					if (entry.outlineArrayNode) entry.outlineArrayNode.set("data", buildOutlinePts(entry, tSec, pts));
					if (entry.outlineLineNode && entry.outlineWidthExpr) entry.outlineLineNode.set("width", evalExpr(entry.outlineWidthExpr, tSec));
					if (entry.outlineLineNode && entry.outlineOpacityExpr) entry.outlineLineNode.set("opacity", evalExpr(entry.outlineOpacityExpr, tSec));
				}
			} catch (err) {}
		}
	});
	return {
		type: "animated_curve",
		color,
		label: el.label,
		_animState: animState,
		_animExprEntry: animExprEntry
	};
}
//#endregion
//#region src/objects/index.ts
var objects_exports = /* @__PURE__ */ __exportAll({ renderElement: () => renderElement });
/**
* Dispatch one scene element to its renderer.
*
* Returns whatever the chosen renderer returns — a small descriptor object for
* most types, `undefined` for the two that render purely for side effects
* (`axis`, `grid`), and `null` when the type is unknown.
*/
function renderElement(el, view) {
	switch (el.type) {
		case "skybox": return renderSkybox(el);
		case "axis": return renderAxis(el, view);
		case "grid": return renderGrid(el, view);
		case "vector": return renderVector(el, view);
		case "point": return renderPoint(el, view);
		case "line": return renderLine(el, view);
		case "surface": return renderSurface(el, view);
		case "parametric_curve": return renderParametricCurve(el, view);
		case "parametric_surface": return renderParametricSurface(el, view);
		case "sphere": return renderSphere(el, view);
		case "ellipsoid": return renderEllipsoid(el, view);
		case "vectors": return renderVectors(el, view);
		case "vector_field": return renderVectorField(el, view);
		case "plane": return renderPlane(el, view);
		case "polygon": return renderPolygon(el, view);
		case "cylinder": return renderCylinder(el, view);
		case "text": return renderText(el, view);
		case "animated_vector": return renderAnimatedVector(el, view);
		case "animated_line": return renderAnimatedLine(el, view);
		case "animated_point": return renderAnimatedPoint(el, view);
		case "animated_cylinder": return renderAnimatedCylinder(el, view);
		case "animated_polygon": return renderAnimatedPolygon(el, view);
		case "animated_curve": return renderAnimatedCurve(el, view);
		default:
			console.warn("Unknown element type:", el.type);
			return null;
	}
}
//#endregion
//#region src/trust.ts
var trustState = state;
var _issuesPanelToggleFn = null;
function scanSpecForUnsafeJs(spec) {
	const issues = [];
	const EXPR_KEYS = /* @__PURE__ */ new Set([
		"expr",
		"x",
		"y",
		"z",
		"expression",
		"fx",
		"fy",
		"fz"
	]);
	const NESTED_COORD_KEYS = /* @__PURE__ */ new Set(["points", "vertices"]);
	const _TEMPLATE_RE = /\{\{([\s\S]*?)\}\}/g;
	function _isExprKey(k) {
		return EXPR_KEYS.has(k) || k.endsWith("Expr") && k.length > 4;
	}
	/** Whether a key's value may CONTAIN math.js at any depth. */
	function _carriesExpressions(k) {
		return _isExprKey(k) || NESTED_COORD_KEYS.has(k);
	}
	function walk(obj, parentKey, path) {
		if (typeof obj === "string") {
			if (parentKey && _carriesExpressions(parentKey) && _JS_ONLY_RE.test(obj)) issues.push({
				path,
				expr: obj,
				type: "expr"
			});
			return;
		}
		if (Array.isArray(obj)) {
			obj.forEach((item, i) => walk(item, parentKey, `${path}[${i}]`));
			return;
		}
		if (obj && typeof obj === "object") Object.entries(obj).forEach(([k, v]) => {
			const childPath = path ? `${path}.${k}` : k;
			if (k === "content" && typeof v === "string") {
				let m;
				_TEMPLATE_RE.lastIndex = 0;
				while ((m = _TEMPLATE_RE.exec(v)) !== null) {
					const inner = m[1];
					if (_JS_ONLY_RE.test(inner)) issues.push({
						path: childPath,
						expr: inner.trim(),
						type: "template"
					});
				}
			}
			walk(v, k, childPath);
		});
	}
	walk(spec, null, "");
	trustState._sceneJsIssues = issues;
	return issues.length > 0;
}
function showTrustDialog(explanation, imports) {
	return new Promise((resolve) => {
		const overlay = document.getElementById("trust-dialog-overlay");
		const body = document.getElementById("trust-dialog-body");
		const allowBtn = document.getElementById("trust-btn-allow");
		const denyBtn = document.getElementById("trust-btn-deny");
		if (!overlay) {
			resolve(false);
			return;
		}
		const bodyEl = body;
		const allow = allowBtn;
		const deny = denyBtn;
		bodyEl.innerHTML = "";
		const explanationEl = document.createElement("p");
		explanationEl.textContent = explanation;
		bodyEl.appendChild(explanationEl);
		if (Array.isArray(imports) && imports.length > 0) {
			const domainNote = document.createElement("div");
			domainNote.className = "trust-dialog-domains";
			const label = document.createElement("span");
			label.textContent = "Built-in domain libraries loaded:";
			domainNote.appendChild(label);
			const pills = document.createElement("span");
			pills.className = "trust-dialog-domain-pills";
			imports.forEach((name) => {
				const pill = document.createElement("span");
				pill.className = "trust-dialog-domain-pill";
				pill.textContent = name;
				pills.appendChild(pill);
			});
			domainNote.appendChild(pills);
			bodyEl.appendChild(domainNote);
		}
		overlay.classList.remove("hidden");
		function cleanup(result) {
			overlay.classList.add("hidden");
			allow.removeEventListener("click", onAllow);
			deny.removeEventListener("click", onDeny);
			resolve(result);
		}
		function onAllow() {
			cleanup(true);
		}
		function onDeny() {
			cleanup(false);
		}
		allow.addEventListener("click", onAllow);
		deny.addEventListener("click", onDeny);
	});
}
function updateJsTrustPill() {
	const pill = document.getElementById("js-trust-pill");
	const icon = document.getElementById("js-trust-pill-icon");
	const label = document.getElementById("js-trust-pill-label");
	if (!pill) return;
	if (trustState._sceneJsTrustState === "trusted") {
		pill.className = "js-trusted";
		icon.textContent = "⚡";
		label.textContent = "Native JS";
		pill.classList.remove("hidden");
	} else if (trustState._sceneJsTrustState === "untrusted") {
		pill.className = "js-untrusted";
		icon.textContent = "⚠";
		label.textContent = "JS disabled";
		pill.classList.remove("hidden");
	} else pill.classList.add("hidden");
	const pillClickable = trustState._sceneIsUnsafe || trustState._sceneJsIssues.length > 0;
	pill.onclick = pillClickable ? () => {
		document.getElementById("btn-show-json").click();
		if (_issuesPanelToggleFn) _issuesPanelToggleFn(document.getElementById("json-viewer-issues"));
	} : null;
	pill.style.cursor = pillClickable ? "pointer" : "";
}
//#endregion
//#region src/context-browser.ts
var contextState = state;
var _navigateFn = null;
function setNavigateFn(fn) {
	_navigateFn = fn;
}
function buildSceneTree$1(spec) {
	const tree = document.getElementById("scene-tree");
	tree.innerHTML = "";
	if (!spec || !spec.scenes) return;
	spec.scenes.forEach((scene, i) => {
		const sceneTitle = scene.title || "Scene " + (i + 1);
		const sceneDiv = document.createElement("div");
		sceneDiv.className = "tree-scene";
		sceneDiv.dataset.sceneIdx = String(i);
		const header = document.createElement("div");
		header.className = "tree-scene-header";
		header.title = sceneTitle;
		const arrow = document.createElement("span");
		arrow.className = "tree-scene-arrow";
		arrow.textContent = "▶";
		header.appendChild(arrow);
		const title = document.createElement("span");
		title.innerHTML = renderKaTeX$1(sceneTitle, false);
		title.title = sceneTitle;
		header.appendChild(title);
		header.addEventListener("click", (e) => {
			const rect = arrow.getBoundingClientRect();
			if (e.clientX < rect.right + 4) sceneDiv.classList.toggle("expanded");
			else {
				sceneDiv.classList.add("expanded");
				if (_navigateFn) _navigateFn(i, -1);
			}
		});
		sceneDiv.appendChild(header);
		if (scene.steps && scene.steps.length > 0) {
			const stepsDiv = document.createElement("div");
			stepsDiv.className = "tree-steps";
			scene.steps.forEach((step, j) => {
				const stepTitle = step.title || "Step " + (j + 1);
				const stepDiv = document.createElement("div");
				stepDiv.className = "tree-step";
				stepDiv.dataset.sceneIdx = String(i);
				stepDiv.dataset.stepIdx = String(j);
				stepDiv.title = stepTitle;
				stepDiv.innerHTML = renderKaTeX$1(stepTitle, false);
				stepDiv.addEventListener("click", () => {
					if (_navigateFn) _navigateFn(i, j);
				});
				stepsDiv.appendChild(stepDiv);
			});
			sceneDiv.appendChild(stepsDiv);
		}
		tree.appendChild(sceneDiv);
	});
}
function updateTreeHighlight$1() {
	document.querySelectorAll(".tree-scene").forEach((el) => {
		const idx = parseInt(el.dataset.sceneIdx);
		el.classList.toggle("active", idx === contextState.currentSceneIndex);
		if (idx === contextState.currentSceneIndex) el.classList.add("expanded");
	});
	document.querySelectorAll(".tree-step").forEach((el) => {
		const si = parseInt(el.dataset.sceneIdx);
		const sti = parseInt(el.dataset.stepIdx);
		el.classList.toggle("active", si === contextState.currentSceneIndex && sti === contextState.currentStepIndex);
		el.classList.toggle("visited", contextState.visitedSteps.has(si + ":" + sti) && !(si === contextState.currentSceneIndex && sti === contextState.currentStepIndex));
	});
}
//#endregion
//#region src/proof-animation/dock-seq.ts
var _seq = 0;
var nextDockSeq = () => ++_seq;
//#endregion
//#region src/proof-animation/sg-proof.ts
var _DERIVE_CACHE = /* @__PURE__ */ new Map();
var _cacheKey$1 = (p) => JSON.stringify({
	t: p.target_latex || "",
	s: p.start_latex || "",
	d: p.domain || "",
	g: p.goal || "",
	gv: p.givens || [],
	i: p.intent || "",
	c: p.context || null,
	ps: p.previous_steps || []
});
/** Drop all cached derivations (call on a new lesson — step keys/context change). */
function clearDeriveCache() {
	_DERIVE_CACHE.clear();
}
var GRID_COLS$1 = 8;
var GRID_ROWS$1 = 8;
var GRID_GAP$1 = 8;
var DEFAULT_COLSPAN = 4;
var DEFAULT_ROWSPAN = 3;
var SgProofManager = class {
	constructor(container, opts = {}) {
		this.container = container;
		this.katex = opts.katex || typeof window !== "undefined" && window.katex;
		this.boxes = /* @__PURE__ */ new Map();
		this._byKey = /* @__PURE__ */ new Map();
		this._transform = {
			x: 0,
			y: 0,
			k: 1
		};
		this._renderer = null;
		this._rafId = null;
		this._resizeObserver = null;
		this._destroyed = false;
		this._seq = 0;
		this._z = 30;
		this._stepKey = null;
		this._apprCache = /* @__PURE__ */ new Map();
		this._apprCacheGraph = null;
		this._hoverNodeId = null;
		this._selectedNodeIds = /* @__PURE__ */ new Set();
		this._selectedTermKeys = /* @__PURE__ */ new Set();
		this._onBackgroundDeselect = typeof opts.onBackgroundDeselect === "function" ? opts.onBackgroundDeselect : null;
	}
	setTransform(t) {
		this._transform = t || {
			x: 0,
			y: 0,
			k: 1
		};
		this._updatePositions();
	}
	setRenderer(renderer) {
		this._renderer = renderer;
		this._startTransformPolling();
		this._observeResize();
	}
	_card() {
		return this.container.querySelector(".d3-graph-card") || this.container;
	}
	setCurrentStep(stepKey) {
		this._stepKey = stepKey;
		this._syncStep();
	}
	_syncStep() {
		if (this._destroyed) return;
		const card = this._card();
		if (!card) return;
		for (const entry of this.boxes.values()) if (entry.stepKey === this._stepKey) {
			const dest = entry.docked ? this._sharedPinnedPanel() : card;
			if (entry.box.parentNode !== dest) dest.appendChild(entry.box);
		} else if (entry.box.parentNode) {
			entry.box.parentNode.removeChild(entry.box);
			if (entry.animator && entry.animator.hidePopups) entry.animator.hidePopups();
		}
		if (this._resizeObserver) {
			try {
				this._resizeObserver.disconnect();
			} catch (_e) {}
			this._resizeObserver = null;
		}
		this._observeResize();
		this._updatePositions();
	}
	_startTransformPolling() {
		if (this._rafId) return;
		const poll = () => {
			this._rafId = requestAnimationFrame(poll);
			if (!this._renderer) return;
			const rt = this._renderer._currentTransform;
			if (!rt) return;
			const cur = this._transform;
			if (rt.x !== cur.x || rt.y !== cur.y || rt.k !== cur.k) {
				this._transform = {
					x: rt.x,
					y: rt.y,
					k: rt.k
				};
				this._updatePositions();
			}
		};
		this._rafId = requestAnimationFrame(poll);
	}
	_observeResize() {
		if (this._resizeObserver) return;
		this._resizeObserver = new ResizeObserver(() => {
			for (const entry of this.boxes.values()) this._applyGridSize(entry);
			this._updatePositions();
		});
		this._resizeObserver.observe(this._card());
	}
	_getGridSteps() {
		const rect = this._card().getBoundingClientRect();
		const availW = rect.width - 16;
		const availH = rect.height - 16;
		return {
			w: Math.floor((availW - 56) / GRID_COLS$1),
			h: Math.floor((availH - 56) / GRID_ROWS$1)
		};
	}
	_applyGridSize(entry) {
		const step = this._getGridSteps();
		const w = entry.colSpan * step.w + (entry.colSpan - 1) * GRID_GAP$1;
		const h = entry.rowSpan * step.h + (entry.rowSpan - 1) * GRID_GAP$1;
		entry.box.style.width = `${w}px`;
		entry.box.style.height = `${h}px`;
	}
	_updatePositions() {
		const rect = this._card().getBoundingClientRect();
		const { x: tx, y: ty, k } = this._transform;
		const placed = [];
		for (const entry of this.boxes.values()) {
			if (entry.docked || entry.stepKey !== this._stepKey) continue;
			const w = entry.box.offsetWidth;
			const h = entry.box.offsetHeight;
			let left = entry.graphX * k + tx;
			let top = entry.graphY * k + ty;
			left = Math.max(4, Math.min(left, rect.width - w - 4));
			top = Math.max(4, Math.min(top, rect.height - h - 4));
			for (let attempt = 0; attempt < 4; attempt++) {
				let collision = false;
				for (const p of placed) if (left < p.right && left + w > p.left && top < p.bottom && top + h > p.top) {
					collision = true;
					top = p.bottom + 4;
					if (top + h > rect.height - 4) {
						top = 4;
						left = p.right + 4;
					}
					break;
				}
				if (!collision) break;
				left = Math.max(4, Math.min(left, rect.width - w - 4));
				top = Math.max(4, Math.min(top, rect.height - h - 4));
			}
			placed.push({
				left,
				top,
				right: left + w,
				bottom: top + h
			});
			entry.box.style.left = `${left}px`;
			entry.box.style.top = `${top}px`;
		}
	}
	openProof(nodeId, anchorEl, payload, prebaked, opts = {}) {
		if (this._destroyed) return;
		const dedupKey = `${this._stepKey}|${nodeId}`;
		const existingId = this._byKey.get(dedupKey);
		if (existingId && this.boxes.has(existingId)) {
			const e = this.boxes.get(existingId);
			e.box.style.zIndex = String(++this._z);
			if (e.state === "error") {
				if (prebaked) this._mountPrebaked(e, payload, prebaked);
				else this._runDerivation(e, payload);
			}
			if (opts.dock && !e.docked) this._dock(e);
			return;
		}
		const card = this._card();
		const box = document.createElement("div");
		box.className = "sgc-chart-box sgp-proof-box";
		box.dataset.dockOrder = String(nextDockSeq());
		const header = document.createElement("div");
		header.className = "sgc-chart-header";
		const titleEl = document.createElement("span");
		titleEl.className = "sgc-chart-title";
		titleEl.textContent = "Derivation";
		const controls = document.createElement("div");
		controls.className = "sgc-chart-controls";
		const dockBtn = document.createElement("button");
		dockBtn.className = "sgc-btn sgc-pin-btn";
		dockBtn.type = "button";
		dockBtn.title = "Pin to overlay";
		dockBtn.innerHTML = "&#x1F4CC;";
		const closeBtn = document.createElement("button");
		closeBtn.className = "sgc-btn sgc-close-btn";
		closeBtn.type = "button";
		closeBtn.title = "Close";
		closeBtn.textContent = "×";
		controls.append(dockBtn, closeBtn);
		header.append(titleEl, controls);
		const body = document.createElement("div");
		body.className = "sgp-body";
		box.append(header, body);
		card.appendChild(box);
		const entry = {
			boxId: `proof_${++this._seq}`,
			nodeId,
			stepKey: this._stepKey,
			box,
			body,
			titleEl,
			header,
			dockBtn,
			paWrap: null,
			colSpan: Math.max(2, Math.min(GRID_COLS$1, opts.colSpan || DEFAULT_COLSPAN)),
			rowSpan: Math.max(2, Math.min(GRID_ROWS$1, opts.rowSpan || DEFAULT_ROWSPAN)),
			startStep: Number.isFinite(opts.step) ? opts.step : void 0,
			graphX: 0,
			graphY: 0,
			pinned: false,
			docked: false,
			state: "loading",
			animator: null
		};
		this._applyGridSize(entry);
		const cardRect = card.getBoundingClientRect();
		let left = 4, top = 4;
		if (anchorEl) {
			const r = anchorEl.getBoundingClientRect();
			left = r.right - cardRect.left + 8;
			top = r.top - cardRect.top;
		}
		const w = box.offsetWidth || 300;
		const h = box.offsetHeight || 200;
		left = Math.max(4, Math.min(left, cardRect.width - w - 4));
		top = Math.max(4, Math.min(top, cardRect.height - h - 4));
		box.style.position = "absolute";
		box.style.left = `${left}px`;
		box.style.top = `${top}px`;
		box.style.zIndex = String(++this._z);
		const { x: tx, y: ty, k } = this._transform;
		entry.graphX = (left - tx) / k;
		entry.graphY = (top - ty) / k;
		this.boxes.set(entry.boxId, entry);
		this._byKey.set(dedupKey, entry.boxId);
		closeBtn.addEventListener("click", () => this.closeBox(entry.boxId));
		dockBtn.addEventListener("click", () => this._toggleDock(entry.boxId));
		this._makeDraggable(entry, header);
		this._addResizeHandle(entry);
		if (prebaked) this._mountPrebaked(entry, payload, prebaked);
		else this._runDerivation(entry, payload);
		if (opts.dock) this._dock(entry);
		this._updatePositions();
	}
	_mountPrebaked(entry, payload, data) {
		entry.payload = payload;
		if (data && data.title) this._renderInlineMath(entry.titleEl, data.title);
		this._mountAnimator(entry, data);
		entry.state = "ready";
	}
	async _runDerivation(entry, payload) {
		entry.payload = payload;
		if (!payload || !payload.target_latex || !String(payload.target_latex).trim()) {
			entry.state = "error";
			this._renderError(entry, /* @__PURE__ */ new Error("This node has no expression to derive."));
			return;
		}
		const key = _cacheKey$1(payload);
		const cached = _DERIVE_CACHE.get(key);
		if (cached) {
			if (cached.title) this._renderInlineMath(entry.titleEl, cached.title);
			this._mountAnimator(entry, cached);
			entry.state = "ready";
			return;
		}
		entry.state = "loading";
		this._renderLoading(entry, payload);
		const pill = this._showPill();
		try {
			const data = await invokeExpert("proof_animation", payload, { timeoutMs: DERIVE_TIMEOUT_MS });
			if (this._destroyed || !this.boxes.has(entry.boxId)) return;
			_DERIVE_CACHE.set(key, data);
			if (data && data.title) this._renderInlineMath(entry.titleEl, data.title);
			this._mountAnimator(entry, data);
			entry.state = "ready";
		} catch (err) {
			if (this._destroyed || !this.boxes.has(entry.boxId)) return;
			entry.state = "error";
			this._renderError(entry, err, payload);
		} finally {
			this._removePill(pill);
		}
	}
	_mountAnimator(entry, data) {
		entry.body.innerHTML = "";
		entry.paWrap = null;
		entry.data = data;
		if (!data || !Array.isArray(data.steps) || data.steps.length === 0) {
			this._renderError(entry, /* @__PURE__ */ new Error("The derivation produced no steps."));
			return;
		}
		const paWrap = document.createElement("div");
		paWrap.className = "sgp-pa";
		entry.body.appendChild(paWrap);
		entry.paWrap = paWrap;
		try {
			entry.animator = new ProofAnimator(paWrap, data, {
				katex: this.katex || void 0,
				aiAskButton: makeAiAskButton,
				deriveButton: makeDeriveButton,
				onDerive: (p, anchorEl) => this._deriveFromAnimator(entry, p, anchorEl),
				fitHeight: true,
				startStep: entry.startStep,
				liveTerms: true,
				onTermHover: (chain, _el) => this._onTermHover(chain),
				onTermClick: (chain, _el, ev) => this._onTermClick(chain, ev),
				enableExplore: true,
				onExplore: ({ message }) => {
					try {
						openChatPanel();
					} catch (e) {}
					if (typeof window !== "undefined" && typeof window.sendChatMessage === "function") window.sendChatMessage(message);
				},
				enableTermAsk: true,
				onTermAsk: ({ message }) => {
					try {
						openChatPanel();
					} catch (e) {}
					if (typeof window !== "undefined" && typeof window.sendChatMessage === "function") window.sendChatMessage(message);
				},
				onBuildTermAskMessage: (focus) => this._buildTermAskMessage(entry, focus),
				onFunctionAnalysis: ({ latex }) => {
					const g = typeof window !== "undefined" && window.__algebenchGraph;
					if (g && typeof g.openFunctionAnalysis === "function") g.openFunctionAnalysis({ latex });
				},
				onAfterRender: () => this._refreshTermClasses(entry),
				onTermBackgroundClick: () => this._deselectAll()
			});
		} catch (e) {
			entry.paWrap = null;
			this._renderError(entry, e);
			return;
		}
		this._updatePositions();
	}
	_deriveFromAnimator(parentEntry, payload, anchorEl) {
		if (this._destroyed || !payload || !payload.target_latex) return;
		if (!payload.context && parentEntry && parentEntry.payload && parentEntry.payload.context) payload = {
			...payload,
			context: parentEntry.payload.context
		};
		const key = String(payload.target_latex).replace(/\s+/g, "");
		const parentId = parentEntry ? parentEntry.nodeId : "anim";
		this.openProof(`${parentId}::sub::${key}`, anchorEl, payload);
	}
	_apprKey(text) {
		const k = (text || "").replace(/[\s\u200B-\u200F\u2060\uFEFF]/g, "");
		return !k || /^[\d.,/+\-]+$/.test(k) ? "" : k;
	}
	_resolveChain(chain) {
		const r = this._renderer;
		if (!r || r._destroyed || typeof r.resolveTermNodeId !== "function") return null;
		if (this._apprCacheGraph !== r._graph) {
			this._apprCache = /* @__PURE__ */ new Map();
			this._apprCacheGraph = r._graph;
		}
		const present = (id) => id && typeof r.getNode === "function" && r.getNode(id) ? id : null;
		for (const c of chain || []) {
			const k = this._apprKey(c.text);
			if (k && this._apprCache.has(k)) {
				const id = present(this._apprCache.get(k));
				if (id) return id;
			}
		}
		const isOpGlyph = (id) => /__(?:op\d*|exp|one|m\d+)$/.test(id || "");
		for (const c of chain || []) {
			const id = r.resolveTermNodeId(c.id, c.text);
			if (id) {
				const k = this._apprKey(c.text);
				if (k && !isOpGlyph(c.id)) this._apprCache.set(k, id);
				return id;
			}
		}
		return null;
	}
	_onTermHover(chain) {
		const r = this._renderer;
		const id = r && !r._destroyed ? this._resolveChain(chain) : null;
		this._setHoverNode(id);
	}
	_onTermClick(chain, ev) {
		const r = this._renderer;
		const additive = !!(ev && ev.additive);
		const id = r && !r._destroyed && typeof r.selectNodeById === "function" ? this._resolveChain(chain) : null;
		if (id) {
			r.selectNodeById(id, { additive });
			return;
		}
		const key = this._apprKey(chain && chain[0] && chain[0].text || "");
		if (!key) return;
		if (additive) {
			if (this._selectedTermKeys.has(key)) this._selectedTermKeys.delete(key);
			else this._selectedTermKeys.add(key);
			this._applyAllBoxes();
		} else {
			this._deselectAll();
			this._selectedTermKeys = /* @__PURE__ */ new Set([key]);
			this._applyAllBoxes();
		}
	}
	/** The expression element of a box, or null. */
	_termExpr(entry) {
		if (!entry || !entry.box) return null;
		return entry.box.querySelector(".pa-stage .pa-line-current > .pa-expr") || entry.box.querySelector(".pa-stage > .pa-expr");
	}
	/** Resolve ONE term element's data-n to a scene-graph node id (cached by
	*  appearance for stability across steps), or null. */
	_resolveTermEl(el) {
		const r = this._renderer;
		if (!r || r._destroyed || typeof r.resolveTermNodeId !== "function") return null;
		const text = el.textContent || "";
		const k = this._apprKey(text);
		if (k && this._apprCache.has(k)) {
			const cid = this._apprCache.get(k);
			if (cid && typeof r.getNode === "function" && r.getNode(cid)) return cid;
		}
		const nid = r.resolveTermNodeId(el.getAttribute("data-n"), text);
		if (nid && k) this._apprCache.set(k, nid);
		return nid;
	}
	/** (Re)build a box's element → {nodeId, key} map — call after each (re)render,
	*  since a morph replaces the term elements. `key` is the appearance key, used
	*  to select terms that have NO scene-graph node (off-graph proof symbols). */
	_buildTermNodeMap(entry) {
		const r = this._renderer;
		if (r && this._apprCacheGraph !== r._graph) {
			this._apprCache = /* @__PURE__ */ new Map();
			this._apprCacheGraph = r._graph;
		}
		const map = /* @__PURE__ */ new Map();
		const expr = this._termExpr(entry);
		if (expr) for (const el of expr.querySelectorAll("[data-n]")) {
			const nid = this._resolveTermEl(el);
			const key = this._apprKey(el.textContent || "");
			if (nid || key) map.set(el, {
				nid,
				key
			});
		}
		entry._termNodes = map;
		return map;
	}
	/** Apply the shared hover/selection state as term classes for one box. */
	_applyTermClasses(entry) {
		const map = entry._termNodes || this._buildTermNodeMap(entry);
		for (const [el, info] of map) {
			const { nid, key } = info;
			const selected = nid && this._selectedNodeIds.has(nid) || key && this._selectedTermKeys.has(key);
			el.classList.toggle("pa-term-selected", !!selected);
			el.classList.toggle("pa-term-linked", !selected && !!nid && nid === this._hoverNodeId);
		}
	}
	/** After a (re)render: rebuild the map, then re-apply (the morph wiped classes). */
	_refreshTermClasses(entry) {
		this._buildTermNodeMap(entry);
		this._applyTermClasses(entry);
	}
	_applyAllBoxes() {
		for (const entry of this.boxes.values()) this._applyTermClasses(entry);
	}
	_buildTermAskMessage(entry, focus) {
		const r = this._renderer;
		const graph = r && r._graph;
		const getNode = (id) => r && typeof r.getNode === "function" ? r.getNode(id) : graph && Array.isArray(graph.nodes) ? graph.nodes.find((n) => n.id === id) : null;
		const title = entry && entry.data && entry.data.title ? ` "${entry.data.title}"` : "";
		const focusNid = focus && focus.chain ? this._resolveChain(focus.chain) : null;
		const focusNode = focusNid ? getNode(focusNid) : null;
		const focusLabel = focusNode ? focusNode.label || focusNode.id : focus && focus.text || "";
		const focusKey = focus ? this._apprKey(focus.text || "") : "";
		const ctxNodeIds = [...this._selectedNodeIds].filter((id) => id !== focusNid);
		const ctxTermKeys = [...this._selectedTermKeys].filter((k) => k !== focusKey);
		const ctx = [];
		for (const id of ctxNodeIds) {
			const n = getNode(id);
			if (n) {
				let line = `- ${n.label || n.id}`;
				if (n.type) line += ` (${n.type})`;
				if (n.description) line += ` — ${n.description}`;
				ctx.push(line);
			} else ctx.push(`- ${id}`);
		}
		for (const key of ctxTermKeys) ctx.push(`- "${key}"`);
		if (!focusLabel && !ctx.length) return "";
		let head = `In the derivation${title}, explain the term "${focusLabel}"`;
		if (focusNode && focusNode.description) head += ` (${focusNode.description})`;
		if (!ctx.length) return head + " — what it represents and its role here.";
		return head + " and how it relates to:\n" + ctx.join("\n");
	}
	/** Shared hover node (set by a term hover OR a graph-node hover). Lights the
	*  node on the graph and the matching term(s) in every box. */
	_setHoverNode(nodeId) {
		this._hoverNodeId = nodeId || null;
		const r = this._renderer;
		if (r && !r._destroyed && typeof r.highlightNodeById === "function") r.highlightNodeById(this._hoverNodeId);
		this._applyAllBoxes();
	}
	/** Graph node hovered (graph-view → here). */
	highlightTermsForNode(nodeId) {
		this._setHoverNode(nodeId);
	}
	/** The graph's selection changed (graph-view → here, after any node/term click).
	*  Mirror it onto the terms so selected terms are gold everywhere. */
	syncSelectionFromGraph(selectedIds, additive) {
		this._selectedNodeIds = new Set(selectedIds || []);
		if (!additive || this._selectedNodeIds.size === 0) this._selectedTermKeys.clear();
		this._applyAllBoxes();
	}
	/** A click on empty space in a proof box — deselect everything: the local
	*  off-graph term selection AND (via the host) the graph selection + info panel
	*  (which calls back through syncSelectionFromGraph([]) to re-apply). */
	_deselectAll() {
		this._selectedTermKeys.clear();
		if (this._onBackgroundDeselect) this._onBackgroundDeselect();
		else this._applyAllBoxes();
	}
	_renderLoading(entry, payload) {
		entry.paWrap = null;
		entry.body.innerHTML = "";
		const wrap = document.createElement("div");
		wrap.className = "sgp-status";
		wrap.innerHTML = "<span class=\"sgp-dots\"><span></span><span></span><span></span></span>";
		const label = document.createElement("span");
		label.className = "sgp-status-label";
		const target = payload && payload.target_latex;
		if (target && String(target).trim()) {
			label.appendChild(document.createTextNode("Deriving "));
			const m = document.createElement("span");
			try {
				this.katex.render(String(target), m, {
					throwOnError: false,
					displayMode: false
				});
			} catch (_e) {
				m.textContent = String(target);
			}
			label.appendChild(m);
			label.appendChild(document.createTextNode("…"));
		} else label.textContent = "Deriving proof…";
		wrap.appendChild(label);
		entry.body.appendChild(wrap);
	}
	_renderError(entry, err, payload) {
		entry.paWrap = null;
		const msg = (err ? err.message : void 0) || "Derivation failed.";
		entry.body.innerHTML = "";
		const wrap = document.createElement("div");
		wrap.className = "sgp-error";
		const m = document.createElement("div");
		m.className = "sgp-error-msg";
		this._renderInlineMath(m, msg);
		wrap.appendChild(m);
		if (payload) {
			const retry = document.createElement("button");
			retry.className = "sgp-retry";
			retry.type = "button";
			retry.textContent = "Retry";
			retry.addEventListener("click", () => this._runDerivation(entry, payload));
			wrap.appendChild(retry);
		}
		entry.body.appendChild(wrap);
	}
	closeBox(boxId) {
		const entry = this.boxes.get(boxId);
		if (!entry) return;
		try {
			entry.animator && entry.animator.destroy && entry.animator.destroy();
		} catch (_e) {}
		if (entry.box.parentNode) entry.box.parentNode.removeChild(entry.box);
		this.boxes.delete(boxId);
		const k = `${entry.stepKey}|${entry.nodeId}`;
		if (this._byKey.get(k) === boxId) this._byKey.delete(k);
	}
	_makeDraggable(entry, handle) {
		let startX = 0, startY = 0, baseLeft = 0, baseTop = 0;
		const onMove = (ev) => {
			const card = this._card().getBoundingClientRect();
			let left = baseLeft + (ev.clientX - startX);
			let top = baseTop + (ev.clientY - startY);
			left = Math.max(4, Math.min(left, card.width - entry.box.offsetWidth - 4));
			top = Math.max(4, Math.min(top, card.height - entry.box.offsetHeight - 4));
			entry.box.style.left = `${left}px`;
			entry.box.style.top = `${top}px`;
		};
		const onUp = () => {
			const { x: tx, y: ty, k } = this._transform;
			entry.graphX = (parseFloat(entry.box.style.left) - tx) / k;
			entry.graphY = (parseFloat(entry.box.style.top) - ty) / k;
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		handle.addEventListener("pointerdown", (ev) => {
			if (entry.docked) return;
			if (ev.target.closest("button")) return;
			ev.preventDefault();
			entry.box.style.zIndex = String(++this._z);
			startX = ev.clientX;
			startY = ev.clientY;
			baseLeft = parseFloat(entry.box.style.left) || 0;
			baseTop = parseFloat(entry.box.style.top) || 0;
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
		});
	}
	_addResizeHandle(entry) {
		const handle = document.createElement("div");
		handle.className = "sgc-resize-handle";
		handle.title = "Resize";
		entry.box.appendChild(handle);
		let startX = 0, startY = 0, startCol = 0, startRow = 0;
		const onMove = (ev) => {
			const step = this._getGridSteps();
			const unitW = step.w + GRID_GAP$1;
			const unitH = step.h + GRID_GAP$1;
			const col = Math.max(2, Math.min(GRID_COLS$1, startCol + Math.round((ev.clientX - startX) / unitW)));
			const row = Math.max(2, Math.min(GRID_ROWS$1, startRow + Math.round((ev.clientY - startY) / unitH)));
			if (col !== entry.colSpan || row !== entry.rowSpan) {
				entry.colSpan = col;
				entry.rowSpan = row;
				this._applyGridSize(entry);
				if (!entry.docked) this._updatePositions();
			}
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		handle.addEventListener("pointerdown", (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			entry.box.style.zIndex = String(++this._z);
			startX = ev.clientX;
			startY = ev.clientY;
			startCol = entry.colSpan;
			startRow = entry.rowSpan;
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
		});
	}
	_sharedPinnedPanel() {
		const card = this._card();
		let panel = card.querySelector(".sgc-pinned-panel");
		if (!panel) {
			panel = document.createElement("div");
			panel.className = "sgc-pinned-panel";
			card.appendChild(panel);
		}
		return panel;
	}
	_toggleDock(boxId) {
		const entry = this.boxes.get(boxId);
		if (!entry) return;
		entry.docked ? this._undock(entry) : this._dock(entry);
	}
	_dock(entry) {
		entry.docked = true;
		entry.box.classList.add("sgc-pinned");
		entry.box.style.position = "";
		entry.box.style.left = "";
		entry.box.style.top = "";
		entry.box.style.zIndex = "";
		this._sharedPinnedPanel().appendChild(entry.box);
		this._applyGridSize(entry);
		if (entry.dockBtn) {
			entry.dockBtn.classList.add("sgc-pin-active");
			entry.dockBtn.title = "Unpin from overlay";
		}
	}
	_undock(entry) {
		entry.docked = false;
		entry.box.classList.remove("sgc-pinned");
		this._card().appendChild(entry.box);
		entry.box.style.position = "absolute";
		entry.box.style.zIndex = String(++this._z);
		this._applyGridSize(entry);
		if (entry.dockBtn) {
			entry.dockBtn.classList.remove("sgc-pin-active");
			entry.dockBtn.title = "Pin to overlay";
		}
		this._updatePositions();
	}
	_renderInlineMath(el, text) {
		el.innerHTML = "";
		if (!text) {
			el.textContent = "Derivation";
			return;
		}
		for (const part of String(text).split(/(\$[^$]+\$)/g)) if (part.length > 1 && part.startsWith("$") && part.endsWith("$") && this.katex) {
			const span = document.createElement("span");
			try {
				this.katex.render(part.slice(1, -1), span, {
					throwOnError: false,
					displayMode: false
				});
			} catch (_e) {
				span.textContent = part;
			}
			el.appendChild(span);
		} else if (part) el.appendChild(document.createTextNode(part));
	}
	_showPill() {
		const vp = document.getElementById("graph-viewport");
		if (!vp) return null;
		let stack = vp.querySelector(".graph-enrich-indicator-stack");
		if (!stack) {
			stack = document.createElement("div");
			stack.className = "graph-enrich-indicator-stack";
			vp.appendChild(stack);
		}
		const el = document.createElement("div");
		el.className = "sgp-derive-indicator";
		el.setAttribute("role", "status");
		el.innerHTML = "<span class=\"gei-dots\"><span></span><span></span><span></span></span><span class=\"gei-text\">Deriving proof…</span>";
		stack.appendChild(el);
		document.dispatchEvent(new CustomEvent("sgc:legend-change"));
		return el;
	}
	_removePill(pill) {
		if (pill && pill.parentNode) {
			pill.parentNode.removeChild(pill);
			document.dispatchEvent(new CustomEvent("sgc:legend-change"));
		}
	}
	destroy() {
		this._destroyed = true;
		if (this._rafId) {
			cancelAnimationFrame(this._rafId);
			this._rafId = null;
		}
		if (this._resizeObserver) {
			try {
				this._resizeObserver.disconnect();
			} catch (_e) {}
			this._resizeObserver = null;
		}
		for (const boxId of Array.from(this.boxes.keys())) this.closeBox(boxId);
	}
};
//#endregion
//#region src/proof-animation/derive-payload.ts
var derivePayloadState = state;
function buildEnrichContext(step) {
	const lesson = derivePayloadState.lessonSpec || null;
	const entry = derivePayloadState.proofSpec && derivePayloadState.proofSpec[derivePayloadState.proofActiveIndex];
	if (!lesson && !entry) return null;
	const scene = lesson && lesson.scenes && entry ? lesson.scenes[entry.sceneIndex] : null;
	const proof = entry && entry.proof || null;
	const ctx = {};
	if (lesson) {
		if (lesson.title) ctx.lessonTitle = lesson.title;
		if (lesson.description) ctx.lessonDescription = lesson.description;
	}
	if (scene) {
		if (scene.title) ctx.sceneTitle = scene.title;
		if (scene.description) ctx.sceneDescription = scene.description;
	}
	if (proof) {
		if (proof.title) ctx.proofTitle = proof.title;
		if (proof.goal) ctx.proofGoal = proof.goal;
		if (proof.technique) ctx.proofTechnique = proof.technique;
	}
	if (step) {
		if (step.label) ctx.stepLabel = step.label;
		if (step.math) ctx.stepMath = step.math;
		if (step.justification) ctx.stepJustification = step.justification;
		if (step.explanation) ctx.stepExplanation = step.explanation;
	}
	return Object.keys(ctx).length ? ctx : null;
}
/** Givens for a proof — its `type: 'given'` steps as `{math, label}`. */
function _proofGivens(proof) {
	return (proof.steps || []).filter((s) => s && s.type === "given" && s.math).map((s) => ({
		math: stripHtmlMacros(s.math),
		label: s.label || null
	})).filter((g) => g.math);
}
/**
* Choose the START expression for deriving proof step `index`, preferring the
* previous step whenever possible (issue #382):
*   1. the previous step's `math` (index-1) — the common case,
*   2. else a proof given that isn't equal to the target,
*   3. else the proof goal (if usable),
* always avoiding a start equal to the target. Returns the START LaTeX, or
* null to let the expert infer one.
*/
function _chooseStartLatex(proof, index, target, givens) {
	const steps = proof.steps || [];
	const tnorm = normLatex(target);
	const usable = (m) => {
		const s = stripHtmlMacros(m);
		return s && s.trim() && normLatex(s) !== tnorm ? s : null;
	};
	if (index > 0 && steps[index - 1]) {
		const prev = usable(steps[index - 1].math);
		if (prev) return prev;
	}
	const given = givens.find((g) => normLatex(g.math) !== tnorm);
	if (given) return given.math;
	if (proof.goal) {
		const goal = usable(proof.goal);
		if (goal) return goal;
	}
	return null;
}
/**
* Describe WHERE deriving proof step `index` starts from — `'previous step'`,
* `'givens'`, `'goal'`, or `'inferred'` (no usable start; the expert infers one).
* Returns null when the step has no derivable expression. Used to word the
* proof-card Derive button's tooltip so the learner knows what it will do.
*/
function describeDeriveStart(proof, index) {
	if (!proof || !Array.isArray(proof.steps)) return null;
	const step = proof.steps[index];
	if (!step) return null;
	const target = stripHtmlMacros(step.math || "").trim();
	if (!target) return null;
	const givens = _proofGivens(proof);
	const start = _chooseStartLatex(proof, index, target, givens);
	if (!start) return "inferred";
	const sn = normLatex(start);
	if (index > 0 && proof.steps[index - 1] && normLatex(stripHtmlMacros(proof.steps[index - 1].math || "")) === sn) return "previous step";
	if (givens.some((g) => normLatex(g.math) === sn)) return "givens";
	if (proof.goal && normLatex(stripHtmlMacros(proof.goal)) === sn) return "goal";
	return "previous step";
}
/**
* Build the full `proof_animation` derive payload for proof step `index`.
* Mirrors the graph-node payload but anchors on a proof step: target = the
* step's `math`, start preferring the previous step, plus givens, goal, title,
* domain, ALL previous steps, lesson/scene/proof context, and an intent hint.
* Returns null when the step has no derivable expression.
*/
function buildProofStepDerivePayload(proof, index, opts = {}) {
	if (!proof || !Array.isArray(proof.steps)) return null;
	const step = proof.steps[index];
	if (!step) return null;
	const target = stripHtmlMacros(step.math || "").trim();
	if (!target) return null;
	const payload = { target_latex: target };
	const domain = opts.domain || proof.domain || proof.meta && proof.meta.domain;
	if (domain) payload.domain = domain;
	if (proof.title) payload.title = stripHtmlMacros(proof.title);
	if (proof.goal) payload.goal = stripHtmlMacros(proof.goal);
	const givens = _proofGivens(proof);
	if (givens.length) payload.givens = givens;
	const start = _chooseStartLatex(proof, index, target, givens);
	if (start) payload.start_latex = start;
	const prior = proof.steps.slice(0, index).map((s, i) => ({
		step: i + 1,
		label: s.label || null,
		math: stripHtmlMacros(s.math || "")
	})).filter((s) => s.math && s.math.trim());
	if (prior.length) payload.previous_steps = prior;
	const ctx = buildEnrichContext(step);
	if (ctx) payload.context = ctx;
	const intent = (step.label || step.justification || "").trim();
	if (intent) payload.intent = intent;
	return payload;
}
//#endregion
//#region src/proof.ts
var proofState = state;
var proofTechniques = {
	direct: "Direct Proof",
	contradiction: "Proof by Contradiction",
	contrapositive: "Proof by Contrapositive",
	cases: "Proof by Cases",
	induction: "Mathematical Induction",
	strongInduction: "Strong Induction",
	wellOrdering: "Well-Ordering Principle",
	construction: "Proof by Construction",
	nonConstructive: "Non-constructive Proof",
	counterexample: "Counterexample (Disproof)",
	exhaustion: "Proof by Exhaustion",
	equivalence: "Proof by Equivalence (↔)",
	invariant: "Proof by Invariant",
	probabilistic: "Probabilistic Method",
	existence: "Existence Proof",
	uniqueness: "Uniqueness Proof"
};
/** Sanitize a string for use as a CSS class name token. */
function sanitizeClassName(s) {
	if (typeof s !== "string") return "";
	return s.replace(/[^a-zA-Z0-9_-]/g, "");
}
/** Return an HTML badge string for a proof technique, or '' if none. */
function techniqueBadgeHTML(proof) {
	const t = proof && proof.technique;
	if (typeof t !== "string" || !t || t === "derivation") return "";
	const safeClass = sanitizeClassName(t);
	const label = proofTechniques[t] || escapeHtml$1(t.charAt(0).toUpperCase() + t.slice(1));
	const hint = proof.techniqueHint;
	return `<span class="proof-technique-badge technique-${safeClass}"${hint ? ` title="${escapeHtml$1(hint)}"` : ""}>${label}</span>`;
}
/** Normalize a proof field (single object or array) into an array. */
function normalizeProofs(proofField) {
	if (proofField == null) return [];
	return Array.isArray(proofField) ? proofField : [proofField];
}
/** Collect all proofs from the entire lesson spec. */
function collectAllProofs(lessonSpec) {
	const all = [];
	if (!lessonSpec) return all;
	for (const p of normalizeProofs(lessonSpec.proof)) all.push({
		level: "file",
		proof: p
	});
	(lessonSpec.scenes || (lessonSpec.elements ? [lessonSpec] : [])).forEach((scene, si) => {
		for (const p of normalizeProofs(scene.proof)) all.push({
			level: "scene",
			sceneIndex: si,
			proof: p
		});
		if (scene.steps) scene.steps.forEach((step, sti) => {
			for (const p of normalizeProofs(step.proof)) all.push({
				level: "step",
				sceneIndex: si,
				stepIndex: sti,
				proof: p
			});
		});
	});
	return all;
}
/** Check if a proof entry is visible in the current context. */
function _isProofInContext(entry, sceneIndex, stepIndex) {
	if (entry.level === "file") return true;
	if (entry.level === "scene") return entry.sceneIndex === sceneIndex;
	if (entry.level === "step") return entry.sceneIndex === sceneIndex && entry.stepIndex <= stepIndex;
	return false;
}
/** Pre-render all steps for a proof, returning an array of DOM nodes. */
function preRenderProofSteps(proof) {
	if (!proof || !proof.steps) return [];
	return proof.steps.map((step, i) => {
		const div = document.createElement("div");
		div.className = "proof-step";
		div.dataset.proofStepIndex = String(i);
		const type = step.type || "step";
		const typeClass = `type-${sanitizeClassName(type)}`;
		let contentHtml = `<div class="proof-step-header">
            <span class="proof-step-number">${i + 1}</span>
            <span class="proof-step-type ${typeClass}">${escapeHtml$1(type)}</span>
            <span class="proof-step-label">${renderKaTeX$1(step.label, false)}</span>
            <span class="proof-step-status"></span>
        </div>`;
		if (step.math) contentHtml += `<div class="proof-step-math-row">
                <div class="proof-step-math">${renderKaTeX$1("$$" + step.math + "$$", true)}</div>
                <div class="proof-step-actions"></div>
            </div>`;
		if (step.justification) contentHtml += `<div class="proof-step-justification">
                <span class="proof-justification-text">${renderKaTeX$1(step.justification, false)}</span>
            </div>`;
		if (step.explanation) contentHtml += `<div class="proof-step-explanation">${renderMarkdown$1(step.explanation)}</div>`;
		if (step.tags && step.tags.length) contentHtml += `<div class="proof-step-tags">${step.tags.map((t) => `<span class="proof-tag">${escapeHtml$1(t)}</span>`).join("")}</div>`;
		div.innerHTML = contentHtml;
		_injectProofAskButtons(div, step, proof);
		div.addEventListener("click", () => navigateProof$1(i));
		return div;
	});
}
/** Inject AI ask + Derive buttons into the actions strip of a proof step. */
function _injectProofAskButtons(stepEl, step, proof) {
	const actionsEl = stepEl.querySelector(".proof-step-actions");
	if (!actionsEl) return;
	const btn = makeAiAskButton("proof-ask-btn", "Explain this step", () => {
		let msg = `Explain this proof step: "${step.label}"`;
		if (step.justification) msg += `. Justification: "${step.justification}"`;
		return msg;
	});
	actionsEl.appendChild(btn);
	if (step.math && step.type !== "given") {
		const idx = Number(stepEl.dataset.proofStepIndex);
		const deriveBtn = makeDeriveButton("proof-ask-btn proof-step-derive-btn", _deriveTooltip(proof, idx), () => _onDeriveStep(idx));
		actionsEl.appendChild(deriveBtn);
	}
}
var _proofDeriveManager = null;
/** Stable key for the active proof + step, scoping derivation boxes per step. */
function _proofStepKey() {
	if (!proofState.proofSpec || proofState.proofActiveIndex < 0) return null;
	const entry = proofState.proofSpec[proofState.proofActiveIndex];
	return `${_proofKey(entry, proofState.proofActiveIndex)}#${proofState.proofStepIndex}`;
}
/** Get (or lazily create) the proof-panel derivation manager + its host. */
function _ensureProofDeriveManager() {
	if (_proofDeriveManager && !_proofDeriveManager._destroyed) return _proofDeriveManager;
	const panel = document.getElementById("proof-panel");
	if (!panel) return null;
	let host = panel.querySelector("#proof-derive-host");
	if (!host) {
		host = document.createElement("div");
		host.id = "proof-derive-host";
		panel.appendChild(host);
	}
	_proofDeriveManager = new SgProofManager(host);
	_proofDeriveManager.setCurrentStep(_proofStepKey());
	return _proofDeriveManager;
}
/** Tear down the derivation manager (called on scene change — boxes are scene-scoped). */
function _destroyProofDeriveManager() {
	if (_proofDeriveManager) {
		try {
			_proofDeriveManager.destroy();
		} catch (_e) {}
		_proofDeriveManager = null;
	}
	const host = document.getElementById("proof-derive-host");
	if (host && host.parentNode) host.parentNode.removeChild(host);
}
/** Keep the manager's visible boxes in sync with the active proof step. */
function _syncProofDeriveStep() {
	if (_proofDeriveManager && !_proofDeriveManager._destroyed) _proofDeriveManager.setCurrentStep(_proofStepKey());
}
/** Word the Derive button's tooltip by where the derivation starts, so the
*  learner knows it fills the gap from the previous line (the common case). */
function _deriveTooltip(proof, index) {
	switch (describeDeriveStart(proof, index)) {
		case "previous step": return "Derive: fill in the steps from the previous line to here";
		case "givens": return "Derive: fill in the steps from the givens to here";
		case "goal": return "Derive: fill in the steps from the goal to here";
		default: return "Derive: fill in the intermediate steps to here";
	}
}
/** Launch a derivation for proof step `index`: animate the micro-steps from a
*  sensible start (preferring step index-1) to this step's expression.
*
*  Docks in the roomy semantic-graph canvas (switching to the Math view) when
*  the step has a graph; falls back to an in-panel box for the rare graph-less
*  step so the button always does something. */
async function _onDeriveStep(index) {
	const proof = _activeProof$1();
	if (!proof) return;
	if (proofState.proofStepIndex !== index) navigateProof$1(index);
	const payload = buildProofStepDerivePayload(proof, index);
	if (!payload) return;
	if (typeof window.algebenchDeriveProofPayload === "function") try {
		if (await window.algebenchDeriveProofPayload(payload)) return;
	} catch (e) {
		console.warn("proof derive → graph view failed:", e);
	}
	const mgr = _ensureProofDeriveManager();
	if (!mgr) return;
	mgr.setCurrentStep(_proofStepKey());
	const container = _activeContainer();
	const anchor = container && container.querySelector(".proof-step.active .proof-step-derive-btn") || null;
	mgr.openProof(`step:${index}`, anchor, payload);
}
/** Render the goal block for a proof. */
function renderGoalHTML(proof) {
	if (!proof || !proof.goal) return "";
	return `<div class="proof-goal">
        <div class="proof-goal-label">Goal</div>
        <div class="proof-goal-row">
            <div class="proof-goal-math">${renderKaTeX$1(proof.goal, false)}</div>
            <div class="proof-goal-actions"></div>
        </div>
    </div>`;
}
/** Inject AI ask button into the goal block. */
function _injectGoalAskButton(container, proof) {
	if (!proof || !proof.goal) return;
	const actionsEl = container.querySelector(".proof-goal-actions");
	if (!actionsEl) return;
	const btn = makeAiAskButton("proof-ask-btn", "Explain this proof goal", () => `Explain the goal of this proof: "${proof.title || ""}". Goal: ${proof.goal}`);
	actionsEl.appendChild(btn);
}
/** Simple HTML escaper. */
function escapeHtml$1(s) {
	if (!s) return "";
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
/** Activate highlights for a proof step, deactivate all others. */
function activateHighlights(stepEl, step) {
	const panel = document.getElementById("proof-panel");
	if (panel) panel.querySelectorAll(".hl-active").forEach((el) => el.classList.remove("hl-active"));
	if (!stepEl || !step || !step.highlights) return;
	stepEl.querySelectorAll(".proof-hl-annotation").forEach((el) => el.remove());
	const highlights = step.highlights;
	for (const [name, spec] of Object.entries(highlights)) stepEl.querySelectorAll(`.hl-${name}`).forEach((el) => {
		const colorName = spec.color || "cyan";
		const [r, g, b] = _highlightColorRGB(colorName);
		el.style.backgroundColor = _hlRGBA(colorName, .22);
		el.style.setProperty("--hl-r", String(r));
		el.style.setProperty("--hl-g", String(g));
		el.style.setProperty("--hl-b", String(b));
		if (spec.label) el.title = spec.label;
		if (spec.label) {
			el.style.cursor = "pointer";
			el.addEventListener("click", (e) => {
				e.stopPropagation();
				_toggleHighlightAnnotation(stepEl, name, spec);
			});
		}
		el.classList.add("hl-active");
	});
}
/** Toggle a highlight annotation label below the math block. */
function _toggleHighlightAnnotation(stepEl, name, spec) {
	const existing = stepEl.querySelector(`.proof-hl-annotation[data-hl="${name}"]`);
	if (existing) {
		existing.remove();
		return;
	}
	const annotation = document.createElement("div");
	annotation.className = "proof-hl-annotation";
	annotation.dataset.hl = name;
	const colorName = spec.color || "cyan";
	annotation.style.borderLeftColor = _hlRGBA(colorName, .6);
	annotation.style.color = _hlRGBA(colorName, .9);
	const labelHtml = renderKaTeX$1(spec.label);
	annotation.innerHTML = `<span class="proof-hl-annotation-dot" style="background:${_hlRGBA(colorName, .7)}"></span>${labelHtml}`;
	annotation.addEventListener("click", (e) => {
		e.stopPropagation();
		annotation.remove();
	});
	const mathRow = stepEl.querySelector(".proof-step-math-row");
	if (mathRow && mathRow.nextSibling) mathRow.parentNode.insertBefore(annotation, mathRow.nextSibling);
	else if (mathRow) mathRow.parentNode.appendChild(annotation);
	else stepEl.appendChild(annotation);
}
function _highlightColorRGB(color) {
	const colors = {
		cyan: [
			0,
			200,
			255
		],
		yellow: [
			255,
			220,
			50
		],
		green: [
			80,
			220,
			120
		],
		orange: [
			255,
			160,
			50
		],
		magenta: [
			220,
			80,
			255
		],
		red: [
			255,
			80,
			80
		],
		blue: [
			80,
			120,
			255
		],
		pink: [
			255,
			120,
			180
		],
		white: [
			255,
			255,
			255
		],
		gray: [
			160,
			170,
			185
		],
		gold: [
			255,
			200,
			50
		],
		silver: [
			200,
			210,
			220
		],
		purple: [
			170,
			100,
			220
		],
		teal: [
			60,
			200,
			200
		],
		lime: [
			180,
			230,
			80
		]
	};
	return colors[color] || colors.cyan;
}
/** Build rgba string from color name at a given opacity. */
function _hlRGBA(color, opacity) {
	const [r, g, b] = _highlightColorRGB(color);
	return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
/** Navigate to a specific proof step. -1 = goal overview. */
function navigateProof$1(index) {
	const proof = _activeProof$1();
	if (!proof) return;
	const steps = proof.steps || [];
	index = Math.max(-1, Math.min(index, steps.length - 1));
	proofState.proofStepIndex = index;
	if (!proofState.proofExpanded) _toggleProofPanel(true);
	const activeSection = document.querySelector(`.proof-section[data-proof-idx="${proofState.proofActiveIndex}"]`);
	if (activeSection && activeSection.classList.contains("collapsed")) activeSection.classList.remove("collapsed");
	_saveProofStepToMemory();
	if (proofState.proofViewMode === "list") _renderList();
	else _renderSlide();
	_updateCounter();
	_updateNavButtons();
	if (index >= 0 && proofState._proofPreRendered && proofState._proofPreRendered[index]) activateHighlights(proofState._proofPreRendered[index], steps[index]);
	_syncProofDeriveStep();
	try {
		window.dispatchEvent(new CustomEvent("algebench:stepchange", { detail: {
			proof,
			proofActiveIndex: proofState.proofActiveIndex,
			stepIndex: index,
			sceneIndex: proofState.currentSceneIndex
		} }));
	} catch (_) {}
	try {
		window.dispatchEvent(new CustomEvent("algebench:proofchange"));
	} catch (_) {}
	if (proofState.proofSyncEnabled && !proofState._proofSyncInProgress) {
		const sceneStep = index >= 0 ? steps[index] && steps[index].sceneStep : proof.sceneStep;
		if (sceneStep != null) {
			proofState._proofSyncInProgress = true;
			try {
				if (typeof sceneStep === "string" && sceneStep.includes(":")) {
					const [si, sti] = sceneStep.split(":").map(Number);
					if (typeof window.navigateTo === "function") window.navigateTo(si, sti);
				} else if (typeof window.navigateTo === "function") window.navigateTo(proofState.currentSceneIndex, Number(sceneStep));
			} finally {
				proofState._proofSyncInProgress = false;
			}
		}
	}
}
/** Reverse sync: scene step changed, update proof to match. */
function syncProofFromSceneStep(stepIdx) {
	if (!proofState.proofSyncEnabled || proofState._proofSyncInProgress) return;
	const proof = _activeProof$1();
	if (!proof || !proof.steps) return;
	const matchIdx = proof.steps.findIndex((s) => {
		if (s.sceneStep == null) return false;
		const sceneStep = s.sceneStep;
		if (typeof sceneStep === "string" && sceneStep.includes(":")) {
			const [siStr, stiStr] = sceneStep.split(":");
			const si = Number(siStr);
			const sti = Number(stiStr);
			if (Number.isNaN(si) || Number.isNaN(sti)) return false;
			return si === proofState.currentSceneIndex && sti === stepIdx;
		}
		const n = Number(sceneStep);
		if (Number.isNaN(n)) return false;
		return n === stepIdx;
	});
	if (matchIdx >= 0 && matchIdx !== proofState.proofStepIndex) {
		proofState._proofSyncInProgress = true;
		try {
			navigateProof$1(matchIdx);
		} finally {
			proofState._proofSyncInProgress = false;
		}
	}
}
/**
* Scroll the active proof step into full visibility within its scrollable
* ancestor (.proof-tab-content).  Priority: show the entire step; if the
* step is taller than the viewport, show its top edge instead.
*/
function _scrollActiveIntoView(container) {
	const activeEl = container && container.querySelector(".proof-step.active");
	if (!activeEl) return;
	let scrollParent = activeEl.parentElement;
	while (scrollParent && !scrollParent.classList.contains("proof-tab-content")) scrollParent = scrollParent.parentElement;
	if (!scrollParent) return;
	const sRect = scrollParent.getBoundingClientRect();
	const eRect = activeEl.getBoundingClientRect();
	if (eRect.height > sRect.height) scrollParent.scrollTop += eRect.top - sRect.top;
	else if (eRect.bottom > sRect.bottom) scrollParent.scrollTop += eRect.bottom - sRect.bottom;
	else if (eRect.top < sRect.top) scrollParent.scrollTop += eRect.top - sRect.top;
}
function _renderSlide() {
	const container = _activeContainer();
	if (!container) return;
	const proof = _activeProof$1();
	if (!proof) return;
	const nodes = proofState._proofPreRendered || [];
	const idx = proofState.proofStepIndex;
	container.innerHTML = "";
	nodes.forEach((node, i) => {
		const clone = node.cloneNode(true);
		clone.addEventListener("click", () => navigateProof$1(i));
		clone.querySelectorAll(".proof-ask-btn").forEach((b) => b.remove());
		_injectProofAskButtons(clone, proof.steps[i], proof);
		if (i < idx) {
			clone.classList.add("collapsed", "visited");
			clone.classList.remove("active", "dimmed");
		} else if (i === idx) {
			clone.classList.add("active");
			clone.classList.remove("collapsed", "dimmed");
		} else {
			clone.classList.add("dimmed");
			clone.classList.remove("collapsed", "active");
			clone.style.display = "none";
		}
		container.appendChild(clone);
	});
	if (idx >= 0) {
		const activeEl = container.querySelector(".proof-step.active");
		if (activeEl) activateHighlights(activeEl, proof.steps[idx]);
	}
	_scrollActiveIntoView(container);
}
function _renderList() {
	const container = _activeContainer();
	if (!container) return;
	const proof = _activeProof$1();
	if (!proof) return;
	const nodes = proofState._proofPreRendered || [];
	const idx = proofState.proofStepIndex;
	container.innerHTML = "";
	nodes.forEach((node, i) => {
		const clone = node.cloneNode(true);
		clone.addEventListener("click", () => navigateProof$1(i));
		clone.querySelectorAll(".proof-ask-btn").forEach((b) => b.remove());
		_injectProofAskButtons(clone, proof.steps[i], proof);
		clone.classList.remove("collapsed");
		if (i <= idx) {
			clone.classList.add("visited");
			clone.classList.remove("dimmed");
		}
		if (i === idx) clone.classList.add("active");
		else clone.classList.remove("active");
		if (i > idx) {
			clone.classList.add("dimmed");
			clone.classList.remove("visited");
		}
		container.appendChild(clone);
	});
	const activeEl = container.querySelector(".proof-step.active");
	if (activeEl) activateHighlights(activeEl, proof.steps[idx]);
	_scrollActiveIntoView(container);
}
function _updateCounter() {
	const counter = document.getElementById("proof-counter");
	if (!counter) return;
	const proof = _activeProof$1();
	if (!proof || !proof.steps) {
		counter.textContent = "";
		return;
	}
	const idx = proofState.proofStepIndex;
	if (idx < 0) counter.textContent = `Goal · ${proof.steps.length} steps`;
	else counter.textContent = `Step ${idx + 1} of ${proof.steps.length}`;
}
function _updateNavButtons() {
	const proof = _activeProof$1();
	const idx = proofState.proofStepIndex;
	const maxIdx = proof && proof.steps ? proof.steps.length - 1 : -1;
	const hasProof = !!proof;
	const firstBtn = document.getElementById("proof-first");
	const prevBtn = document.getElementById("proof-prev");
	const nextBtn = document.getElementById("proof-next");
	const lastBtn = document.getElementById("proof-last");
	if (firstBtn) firstBtn.disabled = !hasProof || idx <= -1;
	if (prevBtn) prevBtn.disabled = !hasProof || idx <= -1;
	if (nextBtn) nextBtn.disabled = !hasProof || idx >= maxIdx;
	if (lastBtn) lastBtn.disabled = !hasProof || idx >= maxIdx;
}
function _activeProof$1() {
	if (!proofState.proofSpec || proofState.proofSpec.length === 0) return null;
	if (proofState.proofActiveIndex < 0) return null;
	const idx = Math.min(proofState.proofActiveIndex, proofState.proofSpec.length - 1);
	return proofState.proofSpec[idx]?.proof || null;
}
function _activeContainer() {
	const stepsContainer = document.getElementById("proof-steps-container");
	if (stepsContainer) return stepsContainer;
	return document.getElementById("proof-context-content");
}
/** Get a stable key for a proof entry (uses proof.id or falls back to index). */
function _proofKey(entry, index) {
	return entry?.proof?.id || `_idx_${index}`;
}
/** Save current proof step index to memory before switching away. */
function _saveProofStepToMemory() {
	if (_activeProof$1()) {
		const key = _proofKey(proofState.proofSpec[proofState.proofActiveIndex], proofState.proofActiveIndex);
		proofState.proofStepMemory[key] = proofState.proofStepIndex;
	}
}
/** Restore proof step index from memory when switching to a proof. */
function _restoreProofStepFromMemory(entry, index) {
	const key = _proofKey(entry, index);
	return proofState.proofStepMemory[key] != null ? proofState.proofStepMemory[key] : -1;
}
/** Switch the active proof, preserving step state for both old and new. */
function switchActiveProof(newIndex) {
	if (newIndex === proofState.proofActiveIndex) return;
	_saveProofStepToMemory();
	const oldIndex = proofState.proofActiveIndex;
	proofState.proofActiveIndex = newIndex;
	const entry = proofState.proofSpec[newIndex];
	proofState.proofStepIndex = _restoreProofStepFromMemory(entry, newIndex);
	const proof = _activeProof$1();
	proofState._proofPreRendered = proof ? _getOrPreRender(entry, newIndex) : [];
	const container = document.getElementById("proof-context-content");
	if (container) container.querySelectorAll(".proof-section[data-proof-idx]").forEach((section) => {
		const idx = parseInt(section.dataset.proofIdx);
		const header = section.querySelector(".proof-section-header");
		if (idx === oldIndex) {
			section.classList.add("collapsed");
			if (header) header.classList.remove("active");
			const oldSteps = section.querySelector("#proof-steps-container");
			if (oldSteps) oldSteps.remove();
			const hintEl = section.querySelector(".proof-section-step-hint");
			if (hintEl) {
				const oldEntry = proofState.proofSpec[oldIndex];
				const memStep = _restoreProofStepFromMemory(oldEntry, oldIndex);
				const oldProof = oldEntry?.proof;
				hintEl.textContent = memStep >= 0 && oldProof?.steps ? `(step ${memStep + 1}/${oldProof.steps.length})` : "";
			}
		}
		if (idx === newIndex) {
			section.classList.remove("collapsed");
			if (header) header.classList.add("active");
			const body = section.querySelector(".proof-section-body");
			if (body && !body.querySelector("#proof-steps-container")) {
				const stepsContainer = document.createElement("div");
				stepsContainer.id = "proof-steps-container";
				body.appendChild(stepsContainer);
			}
			const hintEl = section.querySelector(".proof-section-step-hint");
			if (hintEl) hintEl.textContent = "";
		}
	});
	_updateCounter();
	_updateNavButtons();
	if (proof) navigateProof$1(proofState.proofStepIndex);
}
/**
* Public: activate a proof by index (deeplink / AI jump). Clamps to range and
* reuses switchActiveProof so step memory + DOM stay consistent. No-op if the
* proof is already active.
*/
function setActiveProof(index) {
	if (!proofState.proofSpec || !proofState.proofSpec.length) return;
	switchActiveProof(Math.max(0, Math.min(index | 0, proofState.proofSpec.length - 1)));
}
/** Get cached pre-rendered steps or create them. */
function _getOrPreRender(entry, index) {
	const key = _proofKey(entry, index);
	if (!proofState._proofPreRenderedAll[key]) {
		const proof = entry?.proof;
		proofState._proofPreRenderedAll[key] = proof ? preRenderProofSteps(proof) : [];
	}
	return proofState._proofPreRenderedAll[key];
}
/** Load proofs for the current context. Called on scene/step change. */
function loadProof(lessonSpec, sceneIndex, stepIndex) {
	const allProofs = collectAllProofs(lessonSpec);
	if (proofState._proofLastScene !== sceneIndex || !proofState.proofAllSpecs || proofState.proofAllSpecs.length !== allProofs.length) {
		_saveProofStepToMemory();
		_destroyProofDeriveManager();
		const prevProofId = proofState.proofSpec?.[proofState.proofActiveIndex]?.proof?.id;
		proofState.proofAllSpecs = allProofs;
		proofState.proofSpec = allProofs;
		proofState._proofLastScene = sceneIndex;
		proofState._proofLastStep = stepIndex;
		proofState._proofPreRenderedAll = {};
		allProofs.forEach((entry, i) => _getOrPreRender(entry, i));
		let newActiveIndex = -1;
		if (prevProofId) {
			const match = allProofs.findIndex((e) => e.proof?.id === prevProofId && _isProofInContext(e, sceneIndex, stepIndex));
			if (match >= 0) newActiveIndex = match;
		}
		if (newActiveIndex < 0) newActiveIndex = allProofs.findIndex((e) => _isProofInContext(e, sceneIndex, stepIndex));
		proofState.proofActiveIndex = newActiveIndex;
		const activeEntry = allProofs[newActiveIndex];
		proofState.proofStepIndex = activeEntry ? _restoreProofStepFromMemory(activeEntry, newActiveIndex) : -1;
		proofState._proofPreRendered = activeEntry ? _getOrPreRender(activeEntry, newActiveIndex) : [];
		_buildContextTab(allProofs);
	}
	proofState._proofLastStep = stepIndex;
	_updateContextVisibility(sceneIndex, stepIndex);
	const hasVisible = allProofs.some((e) => _isProofInContext(e, sceneIndex, stepIndex));
	const toggleBtn = document.getElementById("proof-toggle-btn");
	if (toggleBtn) toggleBtn.style.display = hasVisible ? "" : "none";
	_updateCounter();
	_updateNavButtons();
	if (_activeProof$1() && !proofState._proofSyncInProgress) {
		proofState._proofSyncInProgress = true;
		try {
			navigateProof$1(proofState.proofStepIndex);
		} finally {
			proofState._proofSyncInProgress = false;
		}
	}
	if (!hasVisible && proofState.proofExpanded) _toggleProofPanel(false);
	const savedExpanded = localStorage.getItem("algebench-proof-expanded");
	if (hasVisible && savedExpanded === "true" && !proofState.proofExpanded) _toggleProofPanel(true);
	try {
		window.dispatchEvent(new CustomEvent("algebench:proofload", { detail: {
			sceneIndex,
			stepIndex,
			proofCount: allProofs.length
		} }));
	} catch (_) {}
}
/** Build the "In Context" tab DOM once with all proofs. Visibility is toggled by _updateContextVisibility. */
function _buildContextTab(allProofs) {
	const container = document.getElementById("proof-context-content");
	if (!container) return;
	container.innerHTML = "";
	if (allProofs.length === 0) {
		container.innerHTML = "<p style=\"color: rgba(150,150,200,0.5); font-style: italic; font-size: 0.8em; padding: 8px;\">No proofs in this lesson.</p>";
		return;
	}
	allProofs.forEach((entry, i) => {
		const section = document.createElement("div");
		const isActive = i === proofState.proofActiveIndex;
		section.className = "proof-section" + (isActive ? "" : " collapsed");
		section.dataset.proofIdx = String(i);
		section.dataset.proofLevel = entry.level;
		if (entry.sceneIndex != null) section.dataset.proofScene = String(entry.sceneIndex);
		if (entry.stepIndex != null) section.dataset.proofStep = String(entry.stepIndex);
		const proof = entry.proof;
		const title = proof.title || proof.goal || "Untitled proof";
		const badge = techniqueBadgeHTML(proof);
		section.innerHTML = `<div class="proof-section-header${isActive ? " active" : ""}" data-proof-index="${i}">
            <span class="proof-section-arrow">&#9660;</span>
            <span class="proof-section-title">Proof: ${renderKaTeX$1(title)}</span>
            ${badge}
            <span class="proof-section-step-hint"></span>
        </div>`;
		const body = document.createElement("div");
		body.className = "proof-section-body";
		body.innerHTML = renderGoalHTML(proof);
		_injectGoalAskButton(body, proof);
		if (isActive) {
			const stepsContainer = document.createElement("div");
			stepsContainer.id = "proof-steps-container";
			body.appendChild(stepsContainer);
		}
		section.appendChild(body);
		section.querySelector(".proof-section-header").addEventListener("click", () => {
			if (i !== proofState.proofActiveIndex) switchActiveProof(i);
			else section.classList.toggle("collapsed");
		});
		container.appendChild(section);
	});
}
/** Update visibility of context proof sections based on current scene/step. No DOM rebuild. */
function _updateContextVisibility(sceneIndex, stepIndex) {
	const container = document.getElementById("proof-context-content");
	if (!container) return;
	const showAll = proofState._proofTabMode === "all";
	container.querySelectorAll(".proof-section[data-proof-idx]").forEach((section) => {
		const idx = parseInt(section.dataset.proofIdx);
		const entry = proofState.proofSpec[idx];
		if (!entry) {
			section.style.display = "none";
			return;
		}
		const isActive = idx === proofState.proofActiveIndex;
		const inContext = _isProofInContext(entry, sceneIndex, stepIndex);
		const visible = showAll || inContext;
		section.style.display = visible ? "" : "none";
		const hintEl = section.querySelector(".proof-section-step-hint");
		if (hintEl) {
			if (!isActive) {
				const memStep = _restoreProofStepFromMemory(entry, idx);
				const proof = entry.proof;
				if (memStep >= 0 && proof && proof.steps) hintEl.textContent = `(step ${memStep + 1}/${proof.steps.length})`;
				else hintEl.textContent = "";
			} else hintEl.textContent = "";
		}
	});
}
function _toggleProofPanel(show) {
	const panel = document.getElementById("proof-panel");
	const handle = document.getElementById("proof-resize-handle");
	const btn = document.getElementById("proof-toggle-btn");
	if (!panel) return;
	proofState.proofExpanded = show;
	if (show) {
		panel.classList.remove("hidden");
		if (handle) handle.classList.remove("hidden");
		if (btn) btn.classList.add("active");
		const savedHeight = localStorage.getItem("algebench-proof-split");
		if (savedHeight) {
			const h = parseInt(savedHeight);
			if (h >= 100 && h <= 600) panel.style.height = h + "px";
		} else panel.style.height = "250px";
	} else {
		panel.classList.add("hidden");
		if (handle) handle.classList.add("hidden");
		if (btn) btn.classList.remove("active");
	}
	localStorage.setItem("algebench-proof-expanded", show ? "true" : "false");
	try {
		window.dispatchEvent(new CustomEvent("algebench:panelchange"));
	} catch (_) {}
}
/**
* Public: open/close the proof panel (deeplink / AI jump). Opening is a no-op
* when there's no active proof in context (nothing to show).
*/
function setProofPanelOpen(show) {
	if (show && !_activeProof$1()) return;
	if (!!show === !!proofState.proofExpanded) return;
	_toggleProofPanel(!!show);
}
function _setupProofResize() {
	const handle = document.getElementById("proof-resize-handle");
	const panel = document.getElementById("proof-panel");
	if (!handle || !panel) return;
	let startY, startHeight;
	handle.addEventListener("mousedown", (e) => {
		e.preventDefault();
		startY = e.clientY;
		startHeight = panel.offsetHeight;
		const onMove = (e2) => {
			const delta = e2.clientY - startY;
			const newH = Math.max(100, Math.min(600, startHeight + delta));
			panel.style.height = newH + "px";
		};
		const onUp = () => {
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
			localStorage.setItem("algebench-proof-split", panel.offsetHeight.toString());
		};
		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
	});
}
function _setupProofTabs() {
	document.querySelectorAll(".proof-tab").forEach((tab) => {
		tab.addEventListener("click", () => {
			document.querySelectorAll(".proof-tab").forEach((t) => t.classList.toggle("active", t === tab));
			proofState._proofTabMode = tab.dataset.proofTab || "context";
			_updateContextVisibility(proofState._proofLastScene ?? 0, proofState._proofLastStep ?? 0);
		});
	});
}
function refreshProofPanel$1() {
	if (!_activeProof$1() || !proofState.proofExpanded) return;
	if (proofState.proofViewMode === "list") _renderList();
	else _renderSlide();
	_updateCounter();
	_updateNavButtons();
}
function setupProofPanel() {
	const toggleBtn = document.getElementById("proof-toggle-btn");
	if (toggleBtn) toggleBtn.addEventListener("click", () => {
		_toggleProofPanel(!proofState.proofExpanded);
	});
	const firstBtn = document.getElementById("proof-first");
	const prevBtn = document.getElementById("proof-prev");
	const nextBtn = document.getElementById("proof-next");
	const lastBtn = document.getElementById("proof-last");
	if (firstBtn) {
		firstBtn.innerHTML = FIRST_ICON;
		firstBtn.addEventListener("click", () => navigateProof$1(-1));
	}
	if (prevBtn) {
		prevBtn.innerHTML = PREV_ICON;
		prevBtn.addEventListener("click", () => navigateProof$1(proofState.proofStepIndex - 1));
	}
	if (nextBtn) {
		nextBtn.innerHTML = NEXT_ICON;
		nextBtn.addEventListener("click", () => navigateProof$1(proofState.proofStepIndex + 1));
	}
	if (lastBtn) {
		lastBtn.innerHTML = LAST_ICON;
		lastBtn.addEventListener("click", () => {
			const proof = _activeProof$1();
			if (proof && proof.steps) navigateProof$1(proof.steps.length - 1);
		});
	}
	const savedViewMode = localStorage.getItem("algebench-proof-view-mode");
	if (savedViewMode === "list" || savedViewMode === "slide") proofState.proofViewMode = savedViewMode;
	const modeBtn = document.getElementById("proof-mode-toggle");
	if (modeBtn) {
		modeBtn.textContent = proofState.proofViewMode === "slide" ? "Progressive" : "Verbose";
		modeBtn.addEventListener("click", () => {
			proofState.proofViewMode = proofState.proofViewMode === "slide" ? "list" : "slide";
			modeBtn.textContent = proofState.proofViewMode === "slide" ? "Progressive" : "Verbose";
			localStorage.setItem("algebench-proof-view-mode", proofState.proofViewMode);
			navigateProof$1(proofState.proofStepIndex);
		});
	}
	const syncBtn = document.getElementById("proof-sync-btn");
	if (syncBtn) syncBtn.addEventListener("click", () => {
		proofState.proofSyncEnabled = !proofState.proofSyncEnabled;
		syncBtn.classList.toggle("active", proofState.proofSyncEnabled);
		if (proofState.proofSyncEnabled) navigateProof$1(proofState.proofStepIndex);
	});
	document.addEventListener("keydown", (e) => {
		if (!proofState.proofExpanded || !_activeProof$1()) return;
		const target = e.target;
		if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
		if (e.key === "ArrowLeft") {
			e.preventDefault();
			navigateProof$1(proofState.proofStepIndex - 1);
		} else if (e.key === "ArrowRight") {
			e.preventDefault();
			navigateProof$1(proofState.proofStepIndex + 1);
		}
	});
	_setupProofTabs();
	_setupProofResize();
}
/** Get proof context for the chat system prompt. */
function getProofContext$1() {
	const proof = _activeProof$1();
	if (!proof) return null;
	const stripHlClass = (m) => m ? stripHtmlMacros(m) : null;
	const steps = proof.steps || [];
	const idx = proofState.proofStepIndex;
	const ctx = {
		title: proof.title || null,
		technique: proof.technique || null,
		techniqueHint: proof.techniqueHint || null,
		goal: proof.goal || null,
		stepCount: steps.length,
		currentStepIndex: idx,
		proofPrompt: proof.prompt || null,
		expanded: proofState.proofExpanded
	};
	if (idx > 0) ctx.previousSteps = steps.slice(0, idx).map((s, i) => ({
		step: i + 1,
		label: s.label,
		math: stripHlClass(s.math)
	}));
	if (idx >= 0 && steps[idx]) {
		const step = steps[idx];
		ctx.currentStep = {
			step: idx + 1,
			id: step.id,
			label: step.label,
			math: stripHlClass(step.math),
			justification: step.justification || null,
			explanation: step.explanation || null,
			stepPrompt: step.prompt || null
		};
	}
	if (idx + 1 < steps.length) ctx.upcomingSteps = steps.slice(idx + 1).map((s, i) => ({
		step: idx + 2 + i,
		label: s.label
	}));
	return ctx;
}
//#endregion
//#region \0vite/preload-helper.js
var scriptRel = /* @__PURE__ */ (function detectScriptRel() {
	const relList = typeof document !== "undefined" && document.createElement("link").relList;
	return relList && relList.supports && relList.supports("modulepreload") ? "modulepreload" : "preload";
})();
var assetsURL = function(dep) {
	return "/" + dep;
};
var seen = {};
var __vitePreload = function preload(baseModule, deps, importerUrl) {
	let promise = Promise.resolve();
	if (deps && deps.length > 0) {
		const links = document.getElementsByTagName("link");
		const cspNonceMeta = document.querySelector("meta[property=csp-nonce]");
		const cspNonce = cspNonceMeta?.nonce || cspNonceMeta?.getAttribute("nonce");
		function allSettled(promises) {
			return Promise.all(promises.map((p) => Promise.resolve(p).then((value) => ({
				status: "fulfilled",
				value
			}), (reason) => ({
				status: "rejected",
				reason
			}))));
		}
		function importMetaResolve(specifier) {
			if (import.meta.resolve) return import.meta.resolve(specifier);
			return new URL(
				specifier,
				/** #__KEEP__ */
				import.meta.url
			).href;
		}
		promise = allSettled(deps.map((dep) => {
			dep = assetsURL(dep, importerUrl);
			dep = importMetaResolve(dep);
			if (dep in seen) return;
			seen[dep] = true;
			const isCss = dep.endsWith(".css");
			for (let i = links.length - 1; i >= 0; i--) {
				const link = links[i];
				if (link.href === dep && (!isCss || link.rel === "stylesheet")) return;
			}
			const link = document.createElement("link");
			link.rel = isCss ? "stylesheet" : scriptRel;
			if (!isCss) link.as = "script";
			link.crossOrigin = "";
			link.href = dep;
			if (cspNonce) link.setAttribute("nonce", cspNonce);
			document.head.appendChild(link);
			if (isCss) return new Promise((res, rej) => {
				link.addEventListener("load", res);
				link.addEventListener("error", () => rej(/* @__PURE__ */ new Error(`Unable to preload CSS for ${dep}`)));
			});
		}));
	}
	function handlePreloadError(err) {
		const e = new Event("vite:preloadError", { cancelable: true });
		e.payload = err;
		window.dispatchEvent(e);
		if (!e.defaultPrevented) throw err;
	}
	return promise.then((res) => {
		for (const item of res || []) {
			if (item.status !== "rejected") continue;
			handlePreloadError(item.reason);
		}
		return baseModule().catch(handlePreloadError);
	});
};
//#endregion
//#region src/scene-loader.ts
var sceneState = state;
var AUTO_PLAY_DEFAULT_DURATION = 3e3;
setNavigateFn((si, sti) => navigateTo$1(si, sti));
function snapshotBefore() {
	return {
		arrows: sceneState.arrowMeshes.length,
		labels: sceneState.labels.length,
		planes: sceneState.planeMeshes.length,
		lines: sceneState.lineNodes.length,
		vecLines: sceneState.vectorLineNodes.length,
		axisLines: sceneState.axisLineNodes.length,
		points: sceneState.pointNodes.length
	};
}
function buildSubTracker(group, before) {
	return {
		group,
		arrowMeshes: sceneState.arrowMeshes.slice(before.arrows),
		labels: sceneState.labels.slice(before.labels),
		planeMeshes: sceneState.planeMeshes.slice(before.planes),
		lineNodes: sceneState.lineNodes.slice(before.lines),
		vectorLineNodes: sceneState.vectorLineNodes.slice(before.vecLines),
		axisLineNodes: sceneState.axisLineNodes.slice(before.axisLines),
		pointNodes: sceneState.pointNodes.slice(before.points)
	};
}
function elementDisplayName(el) {
	if (el.labelExpr || el.textExpr) return null;
	return el.label || (el.type === "text" ? el.text || el.value : null) || null;
}
function elementHasLabelSource(el) {
	return !!(elementDisplayName(el) || el.labelExpr || el.textExpr);
}
function renderStepAdd(elements, sliderDefs) {
	const { ids: sliderIds, prevStates: prevSliderStates } = registerSliders(sliderDefs);
	if (sliderIds.length > 0) {
		buildSliderOverlay();
		recompileActiveExprs();
	}
	const before = snapshotBefore();
	const group = sceneState.sceneView.group();
	let autoIdCounter = 0;
	const renderResults = [];
	const addedElementIds = [];
	let replacedElements = null;
	for (const el of elements) {
		if (!el.id && (el.prompt || elementHasLabelSource(el) && el.type !== "axis" && el.type !== "grid")) el.id = "__auto_" + autoIdCounter++ + "_" + Date.now();
		if (el.id && sceneState.elementRegistry[el.id]) {
			if (!replacedElements) replacedElements = {};
			replacedElements[el.id] = sceneState.elementRegistry[el.id];
			if (!sceneState.elementRegistry[el.id].hidden) hideElementById(el.id);
		}
		const elBefore = el.id ? snapshotBefore() : null;
		const elGroup = el.id ? group.group() : group;
		let result = null;
		try {
			result = renderElement(el, elGroup);
		} catch (e) {
			console.error("Error rendering step element:", el, e);
		}
		if (result) renderResults.push(result);
		if (el.id) {
			addedElementIds.push(el.id);
			const subTracker = buildSubTracker(elGroup, elBefore);
			sceneState.elementRegistry[el.id] = {
				tracker: subTracker,
				hidden: false,
				type: el.type,
				prompt: el.prompt || null,
				label: elementDisplayName(el)
			};
		}
	}
	const tracker = buildSubTracker(group, before);
	tracker.removedIds = [];
	tracker.removedSliders = {};
	tracker.replacedElements = replacedElements;
	tracker.sliderIds = sliderIds;
	tracker.prevSliderStates = prevSliderStates;
	tracker.elementIds = addedElementIds;
	tracker.renderResults = renderResults;
	fadeInTracker(tracker);
	return tracker;
}
/**
* Apply info overlays for a step and track them on the tracker.
* Non-kept overlays from previous steps are removed first.
* Kept overlays persist until the tracker is popped (backward nav).
*/
function applyTrackerInfoOverlays(tracker, step) {
	removeStepInfoOverlays();
	tracker.infoIds = [];
	tracker.infoDefs = step.info || [];
	const infoDefs = step.info;
	if (!infoDefs || !infoDefs.length) return;
	for (const def of infoDefs) {
		addInfoOverlay$1(def.id, def.content, def.position || "top-left", true, def.keep || false);
		tracker.infoIds.push(def.id);
	}
}
/** Remove info overlays that were added by this tracker (backward navigation). */
function undoTrackerInfoOverlays(tracker) {
	if (!tracker.infoIds) return;
	for (const id of tracker.infoIds) removeInfoOverlay(id);
}
function hideElementById(id) {
	const reg = sceneState.elementRegistry[id];
	if (!reg || reg.hidden) return;
	reg.hidden = true;
	const t = reg.tracker;
	fadeOutTracker(t, 200, () => {
		for (const entry of t.arrowMeshes) {
			entry.mesh.visible = false;
			entry.mesh._hiddenByRemove = true;
		}
		for (const m of t.planeMeshes) {
			m.visible = false;
			m._hiddenByRemove = true;
		}
		for (const lbl of t.labels) lbl.el.style.display = "none";
		for (const entry of t.pointNodes) try {
			entry.node.set("visible", false);
		} catch (e) {}
		if (t.group) try {
			t.group.set("visible", false);
		} catch (e) {}
	});
	for (const entry of t.arrowMeshes) {
		entry.mesh.visible = false;
		entry.mesh._hiddenByRemove = true;
	}
	for (const m of t.planeMeshes) {
		m.visible = false;
		m._hiddenByRemove = true;
	}
	for (const entry of t.pointNodes || []) try {
		entry.node.set("visible", false);
	} catch (e) {}
}
function showElementById(id) {
	const reg = sceneState.elementRegistry[id];
	if (!reg || !reg.hidden) return;
	reg.hidden = false;
	const t = reg.tracker;
	for (const entry of t.arrowMeshes) entry.mesh._hiddenByRemove = false;
	for (const m of t.planeMeshes) m._hiddenByRemove = false;
	for (const entry of t.arrowMeshes) entry.mesh.visible = true;
	for (const m of t.planeMeshes) m.visible = true;
	for (const lbl of t.labels) lbl.el.style.display = "";
	for (const entry of t.pointNodes || []) try {
		entry.node.set("visible", true);
	} catch (e) {}
	if (t.group) try {
		t.group.set("visible", true);
	} catch (e) {}
	fadeInTracker(t);
}
window._algebenchHideElementById = hideElementById;
window._algebenchShowElementById = showElementById;
function removeTrackSliders(tracker) {
	const ownIds = new Set(tracker.sliderIds || []);
	let changed = false;
	for (const id of Object.keys(sceneState.sceneSliders)) {
		if (ownIds.has(id)) continue;
		if (!tracker.removedSliders[id]) {
			stopSliderLoop(id);
			tracker.removedSliders[id] = { ...sceneState.sceneSliders[id] };
			delete sceneState.sceneSliders[id];
			changed = true;
		}
	}
	if (changed) {
		buildSliderOverlay();
		recompileActiveExprs();
	}
}
function removeTrackSliderById(id, tracker) {
	if (tracker.sliderIds && tracker.sliderIds.includes(id)) return false;
	if (sceneState.sceneSliders[id] && !tracker.removedSliders[id]) {
		stopSliderLoop(id);
		tracker.removedSliders[id] = { ...sceneState.sceneSliders[id] };
		delete sceneState.sceneSliders[id];
		return true;
	}
	return false;
}
function processStepRemoves(removeList, tracker) {
	if (!removeList || !Array.isArray(removeList)) return;
	const ownIds = new Set(tracker.elementIds || []);
	let slidersChanged = false;
	for (const item of removeList) {
		if (item.id === "*" || item.type === "*") {
			for (const id of Object.keys(sceneState.elementRegistry)) {
				if (ownIds.has(id)) continue;
				if (!sceneState.elementRegistry[id].hidden) {
					hideElementById(id);
					tracker.removedIds.push(id);
				}
			}
			removeTrackSliders(tracker);
			continue;
		}
		if (item.type === "info") {
			if (item.id) removeInfoOverlay(item.id);
			else removeAllInfoOverlays$1();
			continue;
		}
		if (item.id) {
			if (!ownIds.has(item.id) && sceneState.elementRegistry[item.id] && !sceneState.elementRegistry[item.id].hidden) {
				hideElementById(item.id);
				tracker.removedIds.push(item.id);
			}
			if (removeTrackSliderById(item.id, tracker)) slidersChanged = true;
			removeInfoOverlay(item.id);
			continue;
		}
		if (item.type === "slider") {
			removeTrackSliders(tracker);
			continue;
		}
		if (item.type) for (const [id, reg] of Object.entries(sceneState.elementRegistry)) {
			if (ownIds.has(id)) continue;
			if (reg.type === item.type && !reg.hidden) {
				hideElementById(id);
				tracker.removedIds.push(id);
			}
		}
	}
	if (slidersChanged) {
		buildSliderOverlay();
		recompileActiveExprs();
	}
}
function undoStepRemoves(tracker) {
	if (!tracker.removedIds) return;
	const stillRemoved = /* @__PURE__ */ new Set();
	const stillRemovedSliders = /* @__PURE__ */ new Set();
	for (const t of sceneState.stepTrackers) {
		if (t === tracker) break;
		if (t.removedIds) for (const id of t.removedIds) stillRemoved.add(id);
		if (t.removedSliders) for (const id of Object.keys(t.removedSliders)) stillRemovedSliders.add(id);
	}
	for (const id of tracker.removedIds) if (!stillRemoved.has(id)) showElementById(id);
	if (tracker.removedSliders) {
		let slidersChanged = false;
		for (const [id, def] of Object.entries(tracker.removedSliders)) if (!stillRemovedSliders.has(id) && !sceneState.sceneSliders[id]) {
			sceneState.sceneSliders[id] = def;
			slidersChanged = true;
		}
		if (slidersChanged) {
			buildSliderOverlay();
			recompileActiveExprs();
		}
	}
}
function removeStepTracker(tracker) {
	if (tracker.sliderIds && tracker.sliderIds.length > 0) {
		const stillNeeded = new Set(sceneState.stepTrackers.flatMap((t) => t.sliderIds || []));
		const toRemove = tracker.sliderIds.filter((id) => !stillNeeded.has(id));
		if (tracker.prevSliderStates) {
			for (const [id, prev] of Object.entries(tracker.prevSliderStates)) if (!toRemove.includes(id) && sceneState.sceneSliders[id]) Object.assign(sceneState.sceneSliders[id], prev);
		}
		if (toRemove.length > 0) removeSliderIds(toRemove);
		buildSliderOverlay();
		recompileActiveExprs();
		syncSliderState();
	}
	if (tracker.renderResults) for (const r of tracker.renderResults) {
		if (r && r._animState) r._animState.stopped = true;
		if (r && r._animExprEntry) unregisterAnimExpr(r._animExprEntry.animState);
		if (r && r._animState) unregisterAnimUpdater(r._animState);
	}
	if (tracker.replacedElements) {
		const stillRemoved = /* @__PURE__ */ new Set();
		for (const t of sceneState.stepTrackers) if (t.removedIds) for (const id of t.removedIds) stillRemoved.add(id);
		for (const [id, savedReg] of Object.entries(tracker.replacedElements)) {
			sceneState.elementRegistry[id] = savedReg;
			if (!stillRemoved.has(id)) showElementById(id);
		}
	}
	if (tracker.elementIds) for (const id of tracker.elementIds) {
		if (tracker.replacedElements && tracker.replacedElements[id]) continue;
		delete sceneState.elementRegistry[id];
		sceneState.legendToggledOff.delete(id);
	}
	fadeOutTracker(tracker, 200, () => {
		if (tracker.group) try {
			tracker.group.remove();
		} catch (e) {}
		for (const entry of tracker.arrowMeshes) {
			sceneState.three.scene.remove(entry.mesh);
			entry.mesh.geometry.dispose();
			entry.mesh.material.dispose();
			const idx = sceneState.arrowMeshes.indexOf(entry);
			if (idx >= 0) sceneState.arrowMeshes.splice(idx, 1);
		}
		for (const r of tracker.renderResults || []) {
			if (!r || !r._arrowOwner) continue;
			for (let i = sceneState.arrowMeshes.length - 1; i >= 0; i--) {
				const entry = sceneState.arrowMeshes[i];
				if (entry.owner === r._arrowOwner) {
					sceneState.three.scene.remove(entry.mesh);
					entry.mesh.geometry.dispose();
					entry.mesh.material.dispose();
					sceneState.arrowMeshes.splice(i, 1);
				}
			}
		}
		for (const lbl of tracker.labels) {
			if (lbl.el.parentNode) lbl.el.parentNode.removeChild(lbl.el);
			const idx = sceneState.labels.indexOf(lbl);
			if (idx >= 0) sceneState.labels.splice(idx, 1);
		}
		for (const m of tracker.planeMeshes) {
			sceneState.three.scene.remove(m);
			m.geometry.dispose();
			m.material.dispose();
			const idx = sceneState.planeMeshes.indexOf(m);
			if (idx >= 0) sceneState.planeMeshes.splice(idx, 1);
		}
		for (const entry of tracker.lineNodes) {
			const idx = sceneState.lineNodes.indexOf(entry);
			if (idx >= 0) sceneState.lineNodes.splice(idx, 1);
		}
		for (const entry of tracker.vectorLineNodes) {
			const idx = sceneState.vectorLineNodes.indexOf(entry);
			if (idx >= 0) sceneState.vectorLineNodes.splice(idx, 1);
		}
		for (const entry of tracker.axisLineNodes) {
			const idx = sceneState.axisLineNodes.indexOf(entry);
			if (idx >= 0) sceneState.axisLineNodes.splice(idx, 1);
		}
		for (const entry of tracker.pointNodes || []) {
			const idx = sceneState.pointNodes.indexOf(entry);
			if (idx >= 0) sceneState.pointNodes.splice(idx, 1);
		}
	});
}
function fadeInTracker(tracker, duration) {
	duration = duration || 350;
	const startTime = performance.now();
	for (const entry of tracker.arrowMeshes) {
		entry.mesh.material.transparent = true;
		entry.mesh.material.opacity = 0;
	}
	for (const m of tracker.planeMeshes) {
		m.material.transparent = true;
		m.material.opacity = 0;
	}
	for (const lbl of tracker.labels) {
		lbl.el.style.transition = "none";
		lbl.el.style.opacity = "0";
	}
	for (const entry of tracker.lineNodes) try {
		entry.node.set("opacity", 0);
	} catch (e) {}
	for (const entry of tracker.vectorLineNodes) try {
		entry.node.set("opacity", 0);
	} catch (e) {}
	for (const entry of tracker.pointNodes || []) try {
		entry.node.set("opacity", 0);
	} catch (e) {}
	function step(now) {
		const t = Math.min((now - startTime) / duration, 1);
		const ease = t * t * (3 - 2 * t);
		for (const entry of tracker.arrowMeshes) {
			const baseOp = entry.mesh && entry.mesh.userData && typeof entry.mesh.userData.baseOpacity === "number" ? entry.mesh.userData.baseOpacity : 1;
			const globalOp = entry.isShaft ? sceneState.displayParams.vectorOpacity : sceneState.displayParams.arrowOpacity;
			entry.mesh.material.opacity = ease * Math.max(0, Math.min(1, baseOp * globalOp));
		}
		for (const m of tracker.planeMeshes) {
			const targetOp = m.userData.targetOpacity !== void 0 ? m.userData.targetOpacity : sceneState.displayParams.planeOpacity;
			m.material.opacity = ease * targetOp;
		}
		for (const lbl of tracker.labels) lbl.el.style.opacity = String(ease * sceneState.displayParams.labelOpacity);
		for (const entry of tracker.lineNodes) {
			const baseOp = entry && typeof entry.baseOpacity === "number" ? entry.baseOpacity : 1;
			try {
				entry.node.set("opacity", ease * baseOp * sceneState.displayParams.lineOpacity);
			} catch (e) {}
		}
		for (const entry of tracker.vectorLineNodes) {
			const baseOp = entry && typeof entry.baseOpacity === "number" ? entry.baseOpacity : 1;
			try {
				entry.node.set("opacity", ease * baseOp * sceneState.displayParams.vectorOpacity);
			} catch (e) {}
		}
		for (const entry of tracker.pointNodes || []) try {
			entry.node.set("opacity", ease);
		} catch (e) {}
		if (t < 1) requestAnimationFrame(step);
		else for (const lbl of tracker.labels) lbl.el.style.transition = "";
	}
	requestAnimationFrame(step);
}
function fadeOutTracker(tracker, duration, onComplete) {
	duration = duration || 200;
	const startTime = performance.now();
	const arrowOps = tracker.arrowMeshes.map((e) => e.mesh.material.opacity);
	const planeOps = tracker.planeMeshes.map((m) => m.material.opacity);
	function step(now) {
		const t = Math.min((now - startTime) / duration, 1);
		const ease = 1 - t * t;
		for (let i = 0; i < tracker.arrowMeshes.length; i++) tracker.arrowMeshes[i].mesh.material.opacity = arrowOps[i] * ease;
		for (let i = 0; i < tracker.planeMeshes.length; i++) tracker.planeMeshes[i].material.opacity = planeOps[i] * ease;
		for (const lbl of tracker.labels) lbl.el.style.opacity = String(parseFloat(lbl.el.style.opacity || String(1)) * ease);
		for (const entry of tracker.lineNodes) try {
			entry.node.set("opacity", (entry.node.get("opacity") || 1) * ease);
		} catch (e) {}
		for (const entry of tracker.vectorLineNodes) try {
			entry.node.set("opacity", (entry.node.get("opacity") || 1) * ease);
		} catch (e) {}
		for (const entry of tracker.pointNodes || []) try {
			entry.node.set("opacity", (entry.node.get("opacity") || 1) * ease);
		} catch (e) {}
		if (t < 1) requestAnimationFrame(step);
		else if (onComplete) onComplete();
	}
	requestAnimationFrame(step);
}
async function loadScene(spec) {
	const root = sceneState.mathbox.select("*");
	if (root) root.remove();
	for (const entry of sceneState.arrowMeshes) {
		sceneState.three.scene.remove(entry.mesh);
		entry.mesh.geometry.dispose();
		entry.mesh.material.dispose();
	}
	sceneState.arrowMeshes = [];
	sceneState.axisLineNodes = [];
	sceneState.vectorLineNodes = [];
	sceneState.lineNodes = [];
	for (const m of sceneState.planeMeshes) {
		sceneState.three.scene.remove(m);
		m.geometry.dispose();
		m.material.dispose();
	}
	sceneState.planeMeshes = [];
	sceneState.pointNodes = [];
	sceneState._planeMeshSerial = 0;
	clearLabels();
	sceneState.followCamState = null;
	sceneState.cameraExprState = null;
	sceneState.cameraExprStartTime = 0;
	if (sceneState.controls && sceneState.followCamSavedControls) {
		if (Object.prototype.hasOwnProperty.call(sceneState.controls, "enableDamping")) {
			sceneState.controls.enableDamping = sceneState.followCamSavedControls.enableDamping;
			if (Number.isFinite(sceneState.followCamSavedControls.dampingFactor)) sceneState.controls.dampingFactor = sceneState.followCamSavedControls.dampingFactor;
		}
	}
	sceneState.followCamSavedControls = null;
	updateFollowAngleLockButtonState();
	for (const k in sceneState.animatedElementPos) delete sceneState.animatedElementPos[k];
	sceneState.activeAnimExprs = [];
	sceneState.activeAnimUpdaters = [];
	sceneState.sceneStartTime = performance.now();
	clearWorldStarfield();
	clearWorldSkybox();
	sceneState.currentSpec = spec;
	const lessonData = sceneState.lessonSpec && sceneState.lessonSpec.data || {};
	const sceneData = spec && spec.data || {};
	sceneState.sceneData = {
		...lessonData,
		...sceneData
	};
	setActiveSceneFunctions(spec);
	setActiveVirtualTimeExpr(spec, -1);
	updateTitle(spec);
	updateExplanationPanel(spec);
	loadProof(sceneState.lessonSpec || spec, sceneState.currentSceneIndex, -1);
	const emptyState = document.getElementById("empty-state");
	if (!spec || !spec.elements || spec.elements.length === 0) {
		sceneState.currentRange = [
			[-5, 5],
			[-5, 5],
			[-5, 5]
		];
		sceneState.currentScale = [
			1,
			1,
			1
		];
		sceneState.declaredScale = [
			1,
			1,
			1
		];
		buildCameraButtons(spec);
		emptyState.style.display = "block";
		const view = sceneState.mathbox.cartesian({
			range: sceneState.currentRange,
			scale: sceneState.currentScale
		});
		sceneState.sceneView = view;
		const { renderGrid, renderAxis } = await _importDefaultRenderers();
		renderGrid({
			plane: "xz",
			color: [
				.3,
				.3,
				.5
			],
			opacity: .1,
			divisions: 10
		}, view);
		renderAxis({
			axis: "x",
			range: [-5, 5],
			color: [
				.5,
				.2,
				.2
			],
			label: "x",
			width: 1
		}, view);
		renderAxis({
			axis: "y",
			range: [-5, 5],
			color: [
				.2,
				.5,
				.2
			],
			label: "y",
			width: 1
		}, view);
		renderAxis({
			axis: "z",
			range: [-5, 5],
			color: [
				.2,
				.2,
				.5
			],
			label: "z",
			width: 1
		}, view);
		buildLegend([]);
		return;
	}
	emptyState.style.display = "none";
	sceneState.currentRange = spec.range || [
		[-5, 5],
		[-5, 5],
		[-5, 5]
	];
	sceneState.currentScale = (spec.scale && !isDefaultScale(spec.scale) ? spec.scale : null) || isotropicScale(sceneState.currentRange);
	sceneState.declaredScale = spec.scale || [
		1,
		1,
		1
	];
	configureWorldStarfield(spec);
	buildCameraButtons(spec);
	const view = sceneState.mathbox.cartesian({
		range: sceneState.currentRange,
		scale: sceneState.currentScale
	});
	sceneState.sceneView = view;
	let baseAutoIdCounter = 0;
	for (const el of spec.elements) {
		const dn = elementDisplayName(el);
		if (!el.id && (el.prompt || elementHasLabelSource(el) && el.type !== "axis" && el.type !== "grid")) el.id = "__auto_" + baseAutoIdCounter++ + "_" + Date.now();
		const elBefore = el.id ? snapshotBefore() : null;
		const elGroup = el.id ? view.group() : view;
		try {
			renderElement(el, elGroup);
			if (el.id) {
				const subTracker = buildSubTracker(elGroup, elBefore);
				sceneState.elementRegistry[el.id] = {
					tracker: subTracker,
					hidden: false,
					type: el.type,
					prompt: el.prompt || null,
					label: dn
				};
			}
		} catch (e) {
			console.error("Error rendering element:", el, e);
		}
	}
	buildLegend(spec.elements);
	if (spec.camera) {
		const up = spec.camera && Array.isArray(spec.camera.up) && spec.camera.up.length === 3 ? spec.camera.up : [
			0,
			1,
			0
		];
		sceneState.camera.up.set(up[0], up[1], up[2]);
		const pos = dataCameraToWorld$1(spec.camera.position || DEFAULT_CAMERA.position);
		const tgt = dataCameraToWorld$1(spec.camera.target || DEFAULT_CAMERA.target);
		sceneState.camera.position.set(pos[0], pos[1], pos[2]);
		if (sceneState.controls) {
			sceneState.controls.target.set(tgt[0], tgt[1], tgt[2]);
			sceneState.controls.update();
		}
	}
}
var _defaultRenderersCache = null;
async function _importDefaultRenderers() {
	if (_defaultRenderersCache) return _defaultRenderersCache;
	const mod = await __vitePreload(() => Promise.resolve().then(() => objects_exports), void 0);
	_defaultRenderersCache = {
		renderGrid: (el, view) => mod.renderElement({
			...el,
			type: "grid"
		}, view),
		renderAxis: (el, view) => mod.renderElement({
			...el,
			type: "axis"
		}, view)
	};
	return _defaultRenderersCache;
}
function isLessonFormat(spec) {
	const s = spec;
	return s && Array.isArray(s.scenes) && s.scenes.length > 0;
}
async function loadLesson(spec) {
	sceneState._sceneJsTrustState = null;
	sceneState._sceneJsIssues = [];
	sceneState._sceneIsUnsafe = false;
	sceneState._sceneUnsafeExplanation = "";
	if (spec) {
		sceneState._sceneIsUnsafe = spec.unsafe === true;
		sceneState._sceneUnsafeExplanation = spec.unsafeExplanation || "";
		const scanned = scanSpecForUnsafeJs(spec);
		if (sceneState._sceneIsUnsafe || scanned) sceneState._sceneJsTrustState = await showTrustDialog(spec.unsafeExplanation || "This scene contains native JavaScript expressions that execute in your browser.\nAllow execution only if you trust the source of this file.", Array.isArray(spec.import) ? spec.import : []) ? "trusted" : "untrusted";
	}
	updateJsTrustPill();
	window._algebenchUpdateJsTrustPill = updateJsTrustPill;
	if (typeof setPresetPrompts === "function") {
		if (spec) setPresetPrompts([
			"Explain this scene",
			"Walk me through this",
			"What's the key insight?"
		]);
		else setPresetPrompts([]);
	}
	if (!isLessonFormat(spec)) {
		sceneState.lessonSpec = null;
		sceneState.currentSceneIndex = -1;
		sceneState.currentStepIndex = -1;
		sceneState.visitedSteps = /* @__PURE__ */ new Set();
		stopAutoPlay();
		sceneState._activeDomainFunctions = {};
		await importDomains(spec && spec.import);
		updateDockVisibility$1();
		loadScene(spec);
		return;
	}
	sceneState.lessonSpec = spec;
	sceneState.currentSceneIndex = -1;
	sceneState.currentStepIndex = -1;
	sceneState.visitedSteps = /* @__PURE__ */ new Set();
	stopAutoPlay();
	await importDomains(spec.import);
	buildSceneTree$1(spec);
	updateDockVisibility$1();
	navigateTo$1(0, -1);
}
var _PROOF_ID_RE = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;
var _PROOF_MAX_BYTES$1 = 524288;
/** Convert a pre-baked proof-animation file (proofs/domains/<id>.json) into a
*  minimal in-memory LESSON: one empty scene (no 3D elements) whose `proof` is the
*  reconstructed derivation. Feeding this through the normal lesson loader gives a
*  scene-less /prove proof the full app experience — real proof panel, per-step
*  semantic-graph derivation, and proof↔scene step sync — instead of a bespoke
*  standalone dock. The proof-file step shape (operation / input_latex /
*  justification) maps onto the lesson proofStep shape (label / math /
*  justification); per-step graphs are derived on demand from `math`. */
function proofFileToLesson(proof, id) {
	const steps = (Array.isArray(proof.steps) ? proof.steps : []).map((s, i) => ({
		id: s.id || `step-${i}`,
		type: i === 0 ? "given" : s.type || "step",
		label: s.operation || s.label || `Step ${i + 1}`,
		math: s.plain || s.input_latex || s.math || "",
		justification: s.justification || "",
		sceneStep: 0
	}));
	const title = proof.title || (id ? id.split("/")[1] : "Proof");
	return {
		title,
		scenes: [{
			title,
			markdown: typeof proof.goal === "string" ? proof.goal : "",
			proof: {
				id: id || "proof",
				title,
				goal: proof.goal || "",
				technique: "derivation",
				steps
			}
		}]
	};
}
/** Fetch a pre-baked proof by id (<domain>/<name>), reconstruct an in-memory
*  lesson from it (see proofFileToLesson), and load it through the normal lesson
*  pipeline. Returns true on success. Best-effort/validated: a bad id or malformed
*  proof is a no-op returning false, so a deeplink never breaks. */
async function loadProofAsLesson(id) {
	if (typeof id !== "string" || id.includes("..") || !_PROOF_ID_RE.test(id)) return false;
	let proof;
	try {
		const resp = await fetch(`/proofs/domains/${id}.json`, { cache: "no-store" });
		if (!resp.ok) return false;
		const len = Number(resp.headers.get("content-length") || 0);
		if (len && len > _PROOF_MAX_BYTES$1) return false;
		const text = await resp.text();
		if (text.length > _PROOF_MAX_BYTES$1) return false;
		proof = validateProofData(JSON.parse(text));
	} catch (e) {
		return false;
	}
	if (!proof || !Array.isArray(proof.steps) || !proof.steps.length) return false;
	await loadLesson(proofFileToLesson(proof, id));
	return true;
}
function navigateTo$1(sceneIdx, stepIdx) {
	if (!sceneState.lessonSpec || !sceneState.lessonSpec.scenes) return;
	const scene = sceneState.lessonSpec.scenes[sceneIdx];
	if (!scene) return;
	const maxStep = (scene.steps ? scene.steps.length : 0) - 1;
	stepIdx = Math.max(-1, Math.min(stepIdx, maxStep));
	if (sceneIdx === sceneState.currentSceneIndex && stepIdx === sceneState.currentStepIndex) return;
	const sceneChanged = sceneIdx !== sceneState.currentSceneIndex;
	if (sceneChanged) {
		sceneState.stepTrackers = [];
		sceneState.elementRegistry = {};
		sceneState.legendToggledOff = /* @__PURE__ */ new Set();
		stopAllSliderLoops();
		sceneState.sceneSliders = {};
		removeAllInfoOverlays$1();
		buildSliderOverlay();
		loadScene({
			title: scene.title,
			description: scene.description,
			markdown: scene.markdown,
			range: scene.range,
			scale: scene.scale,
			camera: scene.camera,
			views: scene.views,
			functions: scene.functions,
			elements: scene.elements || [],
			starfield: scene.starfield
		});
		for (let i = 0; i <= stepIdx; i++) if (scene.steps && scene.steps[i]) {
			const step = scene.steps[i];
			const tracker = renderStepAdd(step.add || [], step.sliders);
			processStepRemoves(step.remove, tracker);
			applyTrackerInfoOverlays(tracker, step);
			sceneState.stepTrackers.push(tracker);
			sceneState.visitedSteps.add(sceneIdx + ":" + i);
		}
		buildLegend(getAllElements$1(scene, stepIdx));
	} else {
		if (stepIdx > sceneState.currentStepIndex) {
			for (let i = sceneState.currentStepIndex + 1; i <= stepIdx; i++) if (scene.steps && scene.steps[i]) {
				const step = scene.steps[i];
				const tracker = renderStepAdd(step.add || [], step.sliders);
				processStepRemoves(step.remove, tracker);
				applyTrackerInfoOverlays(tracker, step);
				sceneState.stepTrackers.push(tracker);
				sceneState.visitedSteps.add(sceneIdx + ":" + i);
			}
		} else {
			while (sceneState.stepTrackers.length > stepIdx + 1) {
				const tracker = sceneState.stepTrackers.pop();
				undoStepRemoves(tracker);
				undoTrackerInfoOverlays(tracker);
				removeStepTracker(tracker);
			}
			const landingTracker = sceneState.stepTrackers[sceneState.stepTrackers.length - 1];
			if (landingTracker && landingTracker.infoDefs && landingTracker.infoDefs.length > 0) {
				removeStepInfoOverlays();
				for (const def of landingTracker.infoDefs) addInfoOverlay$1(def.id, def.content, def.position || "top-left", true, def.keep || false);
				landingTracker.infoIds = landingTracker.infoDefs.map((d) => d.id);
			}
		}
		buildLegend(getAllElements$1(scene, stepIdx));
	}
	if (!sceneState.followCamState && !sceneState.cameraExprState && stepIdx >= 0 && scene.steps) {
		const cam = resolveEffectiveStepCamera(scene, stepIdx);
		if (cam) {
			const pos = dataCameraToWorld$1(cam.position || DEFAULT_CAMERA.position);
			const tgt = dataCameraToWorld$1(cam.target || DEFAULT_CAMERA.target);
			sceneState.CAMERA_VIEWS["_step"] = {
				position: pos,
				target: tgt,
				up: Array.isArray(cam.up) ? cam.up.slice(0, 3) : [
					0,
					1,
					0
				]
			};
			animateCamera$1("_step", 600);
		}
	}
	sceneState.currentSceneIndex = sceneIdx;
	sceneState.currentStepIndex = stepIdx;
	setActiveVirtualTimeExpr(scene, stepIdx);
	scene.steps && scene.steps[stepIdx];
	updateTreeHighlight$1();
	updateStepCaption(scene, stepIdx);
	updateStatusBar();
	loadProof(sceneState.lessonSpec || scene, sceneIdx, stepIdx);
	if (!sceneChanged && sceneState.proofSyncEnabled && sceneState.proofSpec && sceneState.proofSpec.length > 0) syncProofFromSceneStep(stepIdx);
	if (sceneChanged) setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
	try {
		window.dispatchEvent(new CustomEvent("algebench:navchange"));
	} catch (_) {}
}
function updateDockVisibility$1() {
	const dock = document.getElementById("scene-dock");
	const toggle = document.getElementById("scene-dock-toggle");
	if (sceneState.lessonSpec) {
		dock.classList.add("visible");
		if (toggle) toggle.style.display = "";
	} else {
		dock.classList.remove("visible");
		if (toggle) toggle.style.display = "none";
	}
}
function showSceneDockScenesTab() {
	const dock = document.getElementById("scene-dock");
	const panel = document.getElementById("scene-dock-panel");
	const toggle = document.getElementById("scene-dock-toggle");
	if (!dock || !panel || !dock.classList.contains("visible")) return;
	panel.classList.add("open");
	if (toggle) toggle.classList.add("active");
	localStorage.setItem("algebench-dock-open", "true");
	window.dispatchEvent(new Event("resize"));
	const graph = window.__algebenchGraph;
	if (graph && typeof graph.showSceneView === "function") graph.showSceneView();
	else {
		document.querySelectorAll(".dock-tab").forEach((b) => b.classList.toggle("active", b.dataset.dockTab === "scenes"));
		document.querySelectorAll(".dock-tab-content").forEach((c) => c.classList.toggle("active", c.id === "dock-tab-scenes"));
	}
}
function getCurrentStepDuration() {
	const scene = sceneState.lessonSpec && sceneState.lessonSpec.scenes[sceneState.currentSceneIndex];
	if (!scene || !scene.steps) return AUTO_PLAY_DEFAULT_DURATION;
	const step = scene.steps[sceneState.currentStepIndex];
	if (step && step.duration != null) return step.duration;
	if (sceneState.currentStepIndex === -1 && scene.duration != null) return scene.duration;
	return AUTO_PLAY_DEFAULT_DURATION;
}
function scheduleNextAutoPlay() {
	if (!sceneState.autoPlayTimer) return;
	const scene = sceneState.lessonSpec && sceneState.lessonSpec.scenes[sceneState.currentSceneIndex];
	if (!scene) {
		stopAutoPlay();
		return;
	}
	const maxStep = (scene.steps ? scene.steps.length : 0) - 1;
	if (sceneState.currentSceneIndex >= sceneState.lessonSpec.scenes.length - 1 && sceneState.currentStepIndex >= maxStep) {
		stopAutoPlay();
		return;
	}
	const step = scene.steps && scene.steps[sceneState.currentStepIndex];
	if (step && Array.isArray(step.sliders) && step.sliders.length > 0 && step.duration == null) {
		stopAutoPlay();
		return;
	}
	const dur = getCurrentStepDuration();
	sceneState.autoPlayTimer = setTimeout(() => {
		stepNext();
		scheduleNextAutoPlay();
	}, dur);
}
function startAutoPlay() {
	if (sceneState.autoPlayTimer) return;
	sceneState.autoPlayTimer = true;
	scheduleNextAutoPlay();
	const playBtn = document.getElementById("nav-play");
	if (playBtn) {
		playBtn.classList.add("playing");
		playBtn.innerHTML = PAUSE_ICON;
	}
}
function stopAutoPlay() {
	if (sceneState.autoPlayTimer) {
		clearTimeout(sceneState.autoPlayTimer);
		sceneState.autoPlayTimer = null;
	}
	const playBtn = document.getElementById("nav-play");
	if (playBtn) {
		playBtn.classList.remove("playing");
		playBtn.innerHTML = PLAY_ICON;
	}
}
function toggleAutoPlay() {
	if (sceneState.autoPlayTimer) stopAutoPlay();
	else startAutoPlay();
}
function stepNext() {
	if (!sceneState.lessonSpec || !sceneState.lessonSpec.scenes) return;
	const scene = sceneState.lessonSpec.scenes[sceneState.currentSceneIndex];
	if (!scene) return;
	const maxStep = (scene.steps ? scene.steps.length : 0) - 1;
	if (sceneState.currentStepIndex < maxStep) navigateTo$1(sceneState.currentSceneIndex, sceneState.currentStepIndex + 1);
	else if (sceneState.currentSceneIndex < sceneState.lessonSpec.scenes.length - 1) navigateTo$1(sceneState.currentSceneIndex + 1, -1);
	else stopAutoPlay();
}
function stepPrev() {
	if (!sceneState.lessonSpec || !sceneState.lessonSpec.scenes) return;
	if (sceneState.currentStepIndex > -1) navigateTo$1(sceneState.currentSceneIndex, sceneState.currentStepIndex - 1);
	else if (sceneState.currentSceneIndex > 0) {
		const prevScene = sceneState.lessonSpec.scenes[sceneState.currentSceneIndex - 1];
		const prevMaxStep = (prevScene.steps ? prevScene.steps.length : 0) - 1;
		navigateTo$1(sceneState.currentSceneIndex - 1, prevMaxStep);
	}
}
function setupSceneDock() {
	const toggle = document.getElementById("scene-dock-toggle");
	const panel = document.getElementById("scene-dock-panel");
	const prevBtn = document.getElementById("nav-prev");
	const playBtn = document.getElementById("nav-play");
	const nextBtn = document.getElementById("nav-next");
	if (prevBtn) prevBtn.innerHTML = PREV_ICON;
	if (playBtn) playBtn.innerHTML = PLAY_ICON;
	if (nextBtn) nextBtn.innerHTML = NEXT_ICON;
	if (localStorage.getItem("algebench-dock-open") !== "false") {
		panel.classList.add("open");
		toggle.classList.add("active");
	}
	toggle.addEventListener("click", () => {
		const isOpen = panel.classList.toggle("open");
		toggle.classList.toggle("active", isOpen);
		localStorage.setItem("algebench-dock-open", String(isOpen));
		setTimeout(() => window.dispatchEvent(new Event("resize")), 250);
	});
	prevBtn.addEventListener("click", () => stepPrev());
	playBtn.addEventListener("click", () => toggleAutoPlay());
	nextBtn.addEventListener("click", () => stepNext());
	document.addEventListener("keydown", (e) => {
		const target = e.target;
		if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
		if (!sceneState.lessonSpec) return;
		if (e.key === "ArrowDown" || e.key === "ArrowRight") {
			e.preventDefault();
			stepNext();
		} else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
			e.preventDefault();
			stepPrev();
		} else if (e.key === " ") {
			e.preventDefault();
			toggleAutoPlay();
		} else if (e.key === "t" && !e.ctrlKey && !e.metaKey && !e.altKey) toggle.click();
	});
}
//#endregion
//#region src/view-state.ts
var CAM_DECIMALS = 4;
var DEFAULT_UP = [
	0,
	1,
	0
];
/** Round to `dp` decimals and stringify, dropping trailing zeros. */
function fmtNum(n, dp = CAM_DECIMALS) {
	if (!Number.isFinite(n)) return "0";
	const f = Math.pow(10, dp);
	return String(Math.round(n * f) / f);
}
function encMin(v) {
	return encodeURIComponent(String(v)).replace(/%2C/gi, ",").replace(/%7E/gi, "~");
}
function buildQuery(pairs) {
	return pairs.filter(([, v]) => v !== void 0 && v !== null && v !== "").map(([k, v]) => `${k}=${encMin(v)}`).join("&");
}
/**
* Stable slug from a human title: lowercase, non-alphanumerics -> '-',
* collapse/trim hyphens. Empty input yields ''.
*/
function slugify(title) {
	return String(title == null ? "" : title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
/** Encode camera to compact `px,py,pz,tx,ty,tz[,ux,uy,uz]` (data-space). */
function encodeCamera(cam) {
	if (!cam || !Array.isArray(cam.position) || !Array.isArray(cam.target)) return "";
	const p = cam.position, t = cam.target;
	const nums = [
		p[0],
		p[1],
		p[2],
		t[0],
		t[1],
		t[2]
	];
	const up = Array.isArray(cam.up) ? cam.up : null;
	if (up && !(up[0] === DEFAULT_UP[0] && up[1] === DEFAULT_UP[1] && up[2] === DEFAULT_UP[2])) nums.push(up[0], up[1], up[2]);
	return nums.map((n) => fmtNum(Number(n))).join(",");
}
/** Decode `px,py,pz,tx,ty,tz[,ux,uy,uz]` back to a camera object, or null. */
function decodeCamera(str) {
	if (!str) return null;
	const segs = String(str).split(",");
	if (segs.length !== 6 && segs.length !== 9) return null;
	if (segs.some((s) => s.trim() === "")) return null;
	const parts = segs.map(Number);
	if (parts.some((n) => !Number.isFinite(n))) return null;
	const cam = {
		position: [
			parts[0],
			parts[1],
			parts[2]
		],
		target: [
			parts[3],
			parts[4],
			parts[5]
		]
	};
	if (parts.length === 9) cam.up = [
		parts[6],
		parts[7],
		parts[8]
	];
	return cam;
}
/** Serialize a ViewState to a query string (no leading '?'). */
function serializeViewState(vs) {
	if (!vs) return "";
	const pairs = [];
	if (vs.builtin) pairs.push(["builtin", vs.builtin]);
	else if (vs.scene) pairs.push(["scene", vs.scene]);
	if (vs.view && vs.view !== "scene") pairs.push(["view", vs.view]);
	if (vs.panel && vs.panel !== "doc") pairs.push(["panel", vs.panel]);
	if (vs.pp) pairs.push(["pp", "1"]);
	if (vs.dock === true) pairs.push(["dock", "1"]);
	if (vs.sc != null && vs.sc !== "") pairs.push(["sc", vs.sc]);
	if (vs.st != null && vs.st !== "") pairs.push(["st", vs.st]);
	if (vs.pf != null && vs.pf !== "") pairs.push(["pf", vs.pf]);
	if (vs.ps != null && vs.ps !== "") pairs.push(["ps", vs.ps]);
	if (vs.fa != null && vs.fa !== "") pairs.push(["fa", vs.fa]);
	if (Array.isArray(vs.nodes) && vs.nodes.length) pairs.push(["nodes", vs.nodes.map((id) => String(id)).join(",")]);
	if (vs.sliders && typeof vs.sliders === "object") {
		const packed = Object.entries(vs.sliders).filter(([, val]) => Number.isFinite(Number(val))).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, val]) => `${id}~${fmtNum(Number(val))}`).join(",");
		if (packed) pairs.push(["sl", packed]);
	}
	if (vs.cv) pairs.push(["cv", vs.cv]);
	if (vs.proj && vs.proj !== "perspective") pairs.push(["proj", vs.proj]);
	if (Number.isFinite(vs.oz)) pairs.push(["oz", fmtNum(vs.oz)]);
	if (vs.cam) {
		const enc = encodeCamera(vs.cam);
		if (enc) pairs.push(["cam", enc]);
	}
	return buildQuery(pairs);
}
/** Parse a query string (or URLSearchParams) into a ViewState. */
function parseViewState(search) {
	let params;
	if (search instanceof URLSearchParams) params = search;
	else {
		const s = String(search == null ? "" : search).replace(/^\?/, "");
		params = new URLSearchParams(s);
	}
	const vs = {};
	const builtin = params.get("builtin");
	const scene = params.get("scene");
	if (builtin) vs.builtin = builtin;
	else if (scene) vs.scene = scene;
	const view = params.get("view");
	if (view) vs.view = view;
	const panel = params.get("panel");
	if (panel) vs.panel = panel;
	const aa = params.get("aa");
	if (aa) vs.aa = String(aa).slice(0, 2e3);
	const pa = params.get("pa");
	if (pa && /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(pa)) vs.pa = pa;
	const pas = params.get("pas");
	if (pas != null && /^\d{1,4}$/.test(pas)) vs.pas = Number(pas);
	const pp = params.get("pp");
	if (pp === "1" || pp === "true") vs.pp = true;
	const dock = params.get("dock");
	if (dock === "1" || dock === "true") vs.dock = true;
	else if (dock === "0" || dock === "false") vs.dock = false;
	const sc = params.get("sc");
	const st = params.get("st");
	const pf = params.get("pf");
	const ps = params.get("ps");
	if (sc) vs.sc = sc;
	if (st) vs.st = st;
	if (pf) vs.pf = pf;
	if (ps) vs.ps = ps;
	const fa = params.get("fa");
	if (fa) vs.fa = String(fa).slice(0, 200);
	const fax = params.get("fax");
	if (fax) vs.fax = String(fax).slice(0, 1e3);
	const nodes = params.get("nodes");
	if (nodes) {
		const ids = nodes.split(",").map((s) => s.trim()).filter(Boolean);
		if (ids.length) vs.nodes = ids;
	}
	const sl = params.get("sl");
	if (sl) {
		const sliders = {};
		for (const pair of sl.split(",")) {
			const idx = pair.indexOf("~");
			if (idx <= 0) continue;
			const id = pair.slice(0, idx);
			const val = Number(pair.slice(idx + 1));
			if (id && Number.isFinite(val)) sliders[id] = val;
		}
		if (Object.keys(sliders).length) vs.sliders = sliders;
	}
	const cv = params.get("cv");
	if (cv) vs.cv = cv;
	const proj = params.get("proj");
	if (proj) vs.proj = proj;
	const oz = params.get("oz");
	if (oz != null && oz !== "") {
		const n = Number(oz);
		if (Number.isFinite(n)) vs.oz = n;
	}
	const cam = decodeCamera(params.get("cam"));
	if (cam) vs.cam = cam;
	return vs;
}
//#endregion
//#region src/ui.ts
var _sceneLoadingCount = 0;
function showSceneLoading() {
	_sceneLoadingCount++;
	const el = document.getElementById("scene-loading");
	if (el) {
		el.classList.add("active");
		el.setAttribute("aria-busy", "true");
	}
}
function hideSceneLoading() {
	_sceneLoadingCount = Math.max(0, _sceneLoadingCount - 1);
	if (_sceneLoadingCount > 0) return;
	const el = document.getElementById("scene-loading");
	if (el) {
		el.classList.remove("active");
		el.setAttribute("aria-busy", "false");
	}
}
async function loadBuiltinScenesList() {
	try {
		const data = await (await fetch("/api/scenes", { cache: "no-store" })).json();
		const menu = document.getElementById("scenes-menu");
		menu.innerHTML = "";
		if (data.scenes && data.scenes.length > 0) for (const name of data.scenes) {
			const item = document.createElement("div");
			item.className = "scene-item";
			item.textContent = name.replace(/-/g, " ");
			item.addEventListener("click", async (e) => {
				e.stopPropagation();
				if (await loadBuiltinScene(name)) showSceneDockScenesTab();
			});
			menu.appendChild(item);
		}
		else {
			const item = document.createElement("div");
			item.className = "scene-item";
			item.textContent = "(no scenes available)";
			item.style.opacity = "0.5";
			menu.appendChild(item);
		}
	} catch (e) {
		console.error("Failed to load scenes list:", e);
	}
}
async function loadBuiltinScene(name) {
	showSceneLoading();
	try {
		const resp = await fetch("/scenes/" + encodeURIComponent(name), { cache: "no-store" });
		if (!resp.ok) throw new Error(`HTTP ${resp.status} loading scene '${name}'`);
		const spec = await resp.json();
		state.currentSceneSourceLabel = `${name}.json`;
		state.currentSceneSourcePath = `/scenes/${name}`;
		stopAutoPlay();
		await loadLesson(spec);
		updateSceneUrl({ builtin: name });
		document.getElementById("scenes-menu").classList.remove("open");
		return true;
	} catch (e) {
		console.error("Failed to load scene:", name, e);
		return false;
	} finally {
		hideSceneLoading();
	}
}
async function loadSceneFromPath(path) {
	showSceneLoading();
	try {
		const resp = await fetch("/api/scene_file?path=" + encodeURIComponent(path), { cache: "no-store" });
		if (!resp.ok) throw new Error(`HTTP ${resp.status} loading scene file`);
		const data = await resp.json();
		if (!data || !data.spec || typeof data.spec !== "object") throw new Error("Invalid scene payload");
		state.currentSceneSourceLabel = data.label || path.split(/[\\/]/).pop() || path;
		state.currentSceneSourcePath = data.path || path;
		stopAutoPlay();
		await loadLesson(data.spec);
		updateSceneUrl({ path: state.currentSceneSourcePath });
	} finally {
		hideSceneLoading();
	}
}
function updateSceneUrl(opts = {}) {
	const url = new URL(window.location.href);
	if (opts.builtin) {
		url.searchParams.set("builtin", opts.builtin);
		url.searchParams.delete("scene");
	} else if (opts.path) {
		url.searchParams.set("scene", opts.path);
		url.searchParams.delete("builtin");
	} else {
		url.searchParams.delete("scene");
		url.searchParams.delete("builtin");
	}
	window.history.replaceState({}, "", url.toString());
}
async function loadInitialSceneFromQuery() {
	const vs = parseViewState(window.location.search);
	const hasDeeplink = !!(vs.view || vs.panel || vs.pp || vs.sc || vs.st || vs.pf || vs.ps || vs.nodes || vs.sliders || vs.cv || vs.proj || Number.isFinite(vs.oz) || vs.cam || vs.aa || vs.pa || Number.isFinite(vs.pas));
	const applyRest = async () => {
		if (hasDeeplink && typeof window.applyViewState === "function") try {
			await window.applyViewState(vs);
		} catch (e) {
			console.error("applyViewState failed:", e);
		}
	};
	if (vs.builtin) {
		if (await loadBuiltinScene(vs.builtin)) {
			await applyRest();
			return;
		}
	}
	if (!vs.scene) {
		showSceneLoading();
		try {
			const res = await fetch("/api/scene", { cache: "no-store" });
			if (res.ok) {
				const spec = await res.json();
				if (spec && Array.isArray(spec.scenes) && spec.scenes.length) {
					await loadLesson(spec);
					await applyRest();
					return;
				}
			}
		} catch {} finally {
			hideSceneLoading();
		}
		loadScene(null);
		await applyRest();
		return;
	}
	try {
		await loadSceneFromPath(vs.scene);
		await applyRest();
	} catch (e) {
		console.error("Failed to load initial scene:", vs.scene, e);
		loadScene(null);
	}
}
function setupDragDrop() {
	const viewport = document.getElementById("viewport");
	const overlay = document.getElementById("drop-overlay");
	viewport.addEventListener("dragover", (e) => {
		e.preventDefault();
		overlay.classList.add("active");
	});
	viewport.addEventListener("dragleave", (e) => {
		if (e.relatedTarget && viewport.contains(e.relatedTarget)) return;
		overlay.classList.remove("active");
	});
	viewport.addEventListener("drop", (e) => {
		e.preventDefault();
		overlay.classList.remove("active");
		const file = e.dataTransfer.files[0];
		if (file && file.name.endsWith(".json")) {
			const reader = new FileReader();
			reader.onload = async (ev) => {
				try {
					const spec = JSON.parse(ev.target.result);
					state.currentSceneSourceLabel = file.name || "";
					state.currentSceneSourcePath = file.path || file.webkitRelativePath || file.name || "";
					await loadLesson(spec);
					if (state.currentSceneSourcePath) updateSceneUrl({ path: state.currentSceneSourcePath });
					showSceneDockScenesTab();
				} catch (err) {
					console.error("Invalid JSON:", err);
				}
			};
			reader.readAsText(file);
		}
	});
}
function setupFilePicker() {
	const btn = document.getElementById("btn-load");
	const input = document.getElementById("file-input");
	btn.addEventListener("click", () => input.click());
	input.addEventListener("change", (e) => {
		const file = e.target.files[0];
		if (file) {
			const reader = new FileReader();
			reader.onload = async (ev) => {
				try {
					const spec = JSON.parse(ev.target.result);
					state.currentSceneSourceLabel = file.name || "";
					state.currentSceneSourcePath = file.path || file.webkitRelativePath || file.name || "";
					await loadLesson(spec);
					if (state.currentSceneSourcePath) updateSceneUrl({ path: state.currentSceneSourcePath });
					showSceneDockScenesTab();
				} catch (err) {
					console.error("Invalid JSON:", err);
				}
			};
			reader.readAsText(file);
		}
		input.value = "";
	});
}
function setupScenesDropdown() {
	const btn = document.getElementById("btn-scenes");
	const menu = document.getElementById("scenes-menu");
	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		menu.classList.toggle("open");
	});
	document.addEventListener("click", () => {
		menu.classList.remove("open");
	});
}
function pickVideoRecorderFormat() {
	const webmOptions = [
		"video/webm;codecs=vp9,opus",
		"video/webm;codecs=vp8,opus",
		"video/webm"
	];
	const mp4Options = [
		"video/mp4;codecs=avc3,mp4a.40.2",
		"video/mp4;codecs=h264,aac",
		"video/mp4;codecs=avc1,mp4a.40.2",
		"video/mp4"
	];
	const preference = state.videoExportFormatPreference;
	const candidates = [];
	if (preference === "webm") candidates.push({
		options: webmOptions,
		containerMime: "video/webm",
		ext: "webm"
	});
	else if (preference === "mp4") candidates.push({
		options: mp4Options,
		containerMime: "video/mp4",
		ext: "mp4"
	});
	else candidates.push({
		options: webmOptions,
		containerMime: "video/webm",
		ext: "webm"
	}, {
		options: mp4Options,
		containerMime: "video/mp4",
		ext: "mp4"
	});
	for (const candidate of candidates) for (const mimeType of candidate.options) if (MediaRecorder.isTypeSupported(mimeType)) return {
		mimeType,
		containerMime: candidate.containerMime,
		ext: candidate.ext
	};
	return null;
}
function sanitizeFilename(name) {
	return (name || "algebench").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "algebench";
}
function updateVideoExportFormatUI() {
	const selected = state.videoExportFormatPreference;
	const label = document.getElementById("video-export-format-label");
	if (label) label.textContent = `(${selected === "auto" ? "Auto" : selected.toUpperCase()})`;
	document.querySelectorAll("#video-export-format-menu .toolbar-menu-item").forEach((item) => {
		item.classList.toggle("active", item.dataset.format === selected);
	});
}
function getExportBaseName() {
	return sanitizeFilename(state.lessonSpec && state.lessonSpec.title || state.currentSpec && state.currentSpec.title || "algebench-export");
}
function cleanupVideoRecording() {
	if (state.videoRecordingStream) {
		state.videoRecordingStream.getTracks().forEach((track) => track.stop());
		state.videoRecordingStream = null;
	}
}
function updateVideoRecordButtonUI() {
	const btn = document.getElementById("btn-video-record");
	if (!btn) return;
	updateVideoExportFormatUI();
	if (state.videoRecorder && state.videoRecorder.state === "recording") {
		btn.classList.add("active");
		btn.title = "Stop recording";
	} else {
		btn.classList.remove("active");
		btn.title = "Record current tab video with TTS audio";
	}
}
async function startVideoExport() {
	if (!document.getElementById("btn-video-record")) return;
	if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || typeof MediaRecorder === "undefined") {
		alert("Screen recording is not supported in this browser.");
		return;
	}
	try {
		const displayStream = await navigator.mediaDevices.getDisplayMedia({
			video: {
				displaySurface: "browser",
				cursor: "never"
			},
			audio: true,
			preferCurrentTab: true
		});
		const tracks = [...displayStream.getTracks()];
		const getTTSStream = window.algebenchGetTTSAudioStream;
		if (typeof getTTSStream === "function" && displayStream.getAudioTracks().length === 0) {
			const ttsStream = getTTSStream();
			if (ttsStream) tracks.push(...ttsStream.getAudioTracks());
		}
		const combinedStream = new MediaStream(tracks);
		state.videoRecordingStream = displayStream;
		const selected = pickVideoRecorderFormat();
		if (!selected) throw new Error("No supported recorder format");
		state.videoRecordingMime = selected.containerMime;
		state.videoRecordingExt = selected.ext;
		state.videoRecordedChunks = [];
		state.videoRecorder = new MediaRecorder(combinedStream, {
			mimeType: selected.mimeType,
			videoBitsPerSecond: 3e6
		});
		state.videoRecorder.ondataavailable = (event) => {
			if (event.data && event.data.size > 0) state.videoRecordedChunks.push(event.data);
		};
		state.videoRecorder.onerror = (event) => {
			const error = event?.error || event;
			console.error("Video recorder error:", error);
		};
		state.videoRecorder.onstop = () => {
			const blob = new Blob(state.videoRecordedChunks, { type: state.videoRecordingMime });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${getExportBaseName()}_${Date.now()}.${state.videoRecordingExt}`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			cleanupVideoRecording();
			state.videoRecorder = null;
			updateVideoRecordButtonUI();
		};
		displayStream.getVideoTracks()[0].onended = () => {
			if (state.videoRecorder && state.videoRecorder.state === "recording") state.videoRecorder.stop();
		};
		state.videoRecorder.start(150);
		updateVideoRecordButtonUI();
	} catch (err) {
		cleanupVideoRecording();
		state.videoRecorder = null;
		updateVideoRecordButtonUI();
		console.error("Video export failed:", err);
		alert("Failed to start video export. Select the current browser tab when prompted.");
	}
}
function setupVideoExportControls() {
	const btn = document.getElementById("btn-video-record");
	const menu = document.getElementById("video-export-format-menu");
	if (!btn || !menu) return;
	updateVideoRecordButtonUI();
	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		if (state.videoRecorder && state.videoRecorder.state === "recording") {
			state.videoRecorder.stop();
			return;
		}
		menu.classList.toggle("open");
	});
	menu.querySelectorAll(".toolbar-menu-item").forEach((item) => {
		item.addEventListener("click", async (e) => {
			e.stopPropagation();
			state.videoExportFormatPreference = item.dataset.format || "auto";
			updateVideoRecordButtonUI();
			menu.classList.remove("open");
			await startVideoExport();
		});
	});
	document.addEventListener("click", () => {
		menu.classList.remove("open");
	});
}
//#endregion
//#region src/json-browser.ts
var browserState = state;
function _computeSceneSummary(spec) {
	if (!spec) return null;
	const isLesson = Array.isArray(spec.scenes) && spec.scenes.length > 0;
	const scenes = isLesson ? spec.scenes : [spec];
	let totalSteps = 0, totalSliders = 0, totalAnimated = 0, totalStatic = 0, totalFunctions = 0, totalExpressions = 0, totalPrompts = 0;
	const ANIMATED_TYPES = /* @__PURE__ */ new Set([
		"animated_vector",
		"animated_point",
		"animated_line",
		"animated_cylinder",
		"animated_polygon"
	]);
	function countExpressions(el) {
		let n = 0;
		for (const f of [
			"expr",
			"fromExpr",
			"toExpr",
			"radiusExpr",
			"x",
			"y",
			"z",
			"fx",
			"fy",
			"fz"
		]) if (typeof el[f] === "string") n++;
		else if (Array.isArray(el[f])) n += el[f].filter((v) => typeof v === "string").length;
		if (Array.isArray(el.points)) n += el.points.filter((v) => typeof v === "string").length;
		if (Array.isArray(el.vertices)) n += el.vertices.filter((v) => typeof v === "string").length;
		return n;
	}
	for (const scene of scenes) {
		if (scene.prompt && scene.prompt.trim().length > 0) totalPrompts++;
		totalSteps += (scene.steps || []).length;
		const allElements = [...scene.elements || []];
		for (const step of scene.steps || []) {
			allElements.push(...step.add || []);
			for (const sl of step.sliders || []) if (sl.id) totalSliders++;
		}
		for (const el of allElements) {
			if (!el || !el.type) continue;
			if (ANIMATED_TYPES.has(el.type)) {
				totalAnimated++;
				totalExpressions += countExpressions(el);
			} else totalStatic++;
		}
		totalFunctions += Object.keys(scene.functions || {}).length;
		for (const step of scene.steps || []) if (step.prompt && step.prompt.trim().length > 0) totalPrompts++;
	}
	const imports = Array.isArray(spec.import) ? spec.import.length : 0;
	const raw = totalSliders * 10 + totalAnimated * 6 + totalSteps * 4 + totalExpressions * 1 + totalFunctions * 6 + imports * 12;
	const score = Math.floor(100 * (1 - Math.exp(-raw / 80)));
	const scoreLabel = score >= 80 ? "Highly Interactive" : score >= 60 ? "Rich" : score >= 40 ? "Interactive" : score >= 20 ? "Basic" : "Static";
	const scoreColor = score >= 80 ? "#7cfc7c" : score >= 60 ? "#a0d4ff" : score >= 40 ? "#ffd070" : score >= 20 ? "#ff9966" : "#aaa";
	return {
		isLesson,
		sceneCount: scenes.length,
		description: spec.description || (isLesson ? "" : spec.title) || "",
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
		scoreColor
	};
}
function _computeAgenticScore(spec) {
	if (!spec) return null;
	const scenes = Array.isArray(spec.scenes) && spec.scenes.length > 0 ? spec.scenes : [spec];
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
		for (const step of scene.steps || []) {
			if (step.caption && step.caption.trim().length > 0) raw += 3;
			if (step.title && step.title.trim().length > 0) raw += 1;
		}
		for (const step of scene.steps || []) for (const sl of step.sliders || []) if (sl.label && sl.label.trim() !== (sl.id || "").trim()) raw += 2;
		const elements = [...scene.elements || []];
		for (const step of scene.steps || []) elements.push(...step.add || []);
		for (const el of elements) {
			if (!el) continue;
			if (el.id) raw += 1;
			if (el.label) raw += 2;
		}
		if (scene.unsafe && scene.unsafeExplanation) raw += 4;
	}
	const imports = Array.isArray(spec.import) ? spec.import : [];
	raw += imports.length * 10;
	if (spec.unsafe && spec.unsafeExplanation) raw += 4;
	const score = Math.floor(100 * (1 - Math.exp(-raw / 80)));
	return {
		score,
		label: score >= 80 ? "Well Documented" : score >= 60 ? "Good" : score >= 40 ? "Moderate" : score >= 20 ? "Sparse" : "Minimal",
		color: score >= 80 ? "#ffd700" : score >= 60 ? "#a0d4ff" : score >= 40 ? "#ffaa55" : score >= 20 ? "#ff9966" : "#aaa"
	};
}
function _toggleJsIssuesPanel(panel) {
	if (!panel) return;
	if (!panel.classList.contains("hidden")) {
		panel.classList.add("hidden");
		return;
	}
	const trusted = browserState._sceneJsTrustState === "trusted";
	const stateLabel = trusted ? "⚡ JS Trusted — expressions are running natively" : "⚠ JS Disabled — expressions are no-ops (returning 0 / \"?\")";
	const stateClass = trusted ? "js-issues-state-trusted" : "js-issues-state-untrusted";
	const explanationBlock = browserState._sceneUnsafeExplanation ? `<div class="ji-explanation"><span class="ji-explanation-label">Scene-declared explanation:</span> ${_escHtml$1(browserState._sceneUnsafeExplanation)}</div>` : "";
	const unsafeBanner = browserState._sceneIsUnsafe ? `<div class="ji-unsafe-banner">⚠ This scene sets <code>unsafe: true</code> — all expressions execute as native JavaScript regardless of pattern matching.</div>` : "";
	const rows = browserState._sceneJsIssues.map(({ path, expr, type }) => {
		const truncExpr = expr.length > 60 ? expr.slice(0, 57) + "…" : expr;
		const typeLabel = type === "template" ? "{{…}} template" : "expr field";
		const action = trusted ? "✅ Running" : "🚫 Disabled";
		return `<tr>
            <td class="ji-path" title="${_escHtml$1(path)}">${_escHtml$1(path)}</td>
            <td class="ji-expr" title="${_escHtml$1(expr)}"><code>${_escHtml$1(truncExpr)}</code></td>
            <td class="ji-type">${typeLabel}</td>
            <td class="ji-action ${trusted ? "ji-running" : "ji-disabled"}">${action}</td>
        </tr>`;
	}).join("");
	const noRows = browserState._sceneJsIssues.length === 0 ? `<tr><td colspan="4" class="ji-empty">No specific JS patterns detected — scene uses <code>unsafe: true</code> to opt in globally.</td></tr>` : "";
	panel.innerHTML = `<div class="ji-header ${stateClass}">${stateLabel}</div>` + explanationBlock + unsafeBanner + `<div class="ji-scroll"><table class="ji-table"><thead><tr><th>JSON Path</th><th>Expression</th><th>Type</th><th>Action</th></tr></thead><tbody>${rows || noRows}</tbody></table></div>`;
	panel.classList.remove("hidden");
}
function _escHtml$1(str) {
	return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
var _JT_TYPE_ICONS = {
	point: {
		icon: "●",
		cls: "jti-point"
	},
	animated_point: {
		icon: "◉",
		cls: "jti-anim"
	},
	vector: {
		icon: "↗",
		cls: "jti-vector"
	},
	animated_vector: {
		icon: "⇗",
		cls: "jti-anim"
	},
	line: {
		icon: "─",
		cls: "jti-line"
	},
	animated_line: {
		icon: "≈",
		cls: "jti-anim"
	},
	axis: {
		icon: "↔",
		cls: "jti-axis"
	},
	grid: {
		icon: "⊞",
		cls: "jti-grid"
	},
	sphere: {
		icon: "◎",
		cls: "jti-sphere"
	},
	surface: {
		icon: "▦",
		cls: "jti-surface"
	},
	parametric_surface: {
		icon: "▦",
		cls: "jti-surface"
	},
	parametric_curve: {
		icon: "∿",
		cls: "jti-curve"
	},
	animated_curve: {
		icon: "≋",
		cls: "jti-anim"
	},
	polygon: {
		icon: "⬡",
		cls: "jti-polygon"
	},
	animated_polygon: {
		icon: "⬡",
		cls: "jti-anim"
	},
	cylinder: {
		icon: "⌭",
		cls: "jti-sphere"
	},
	animated_cylinder: {
		icon: "⌭",
		cls: "jti-anim"
	},
	text: {
		icon: "Ａ",
		cls: "jti-text"
	},
	slider: {
		icon: "⊝",
		cls: "jti-slider"
	},
	skybox: {
		icon: "◌",
		cls: "jti-skybox"
	}
};
var _JT_KEY_ICONS = {
	title: {
		icon: "◆",
		cls: "jti-title"
	},
	description: {
		icon: "¶",
		cls: "jti-desc"
	},
	markdown: {
		icon: "¶",
		cls: "jti-desc"
	},
	prompt: {
		icon: "◈",
		cls: "jti-prompt"
	},
	elements: {
		icon: "◻",
		cls: "jti-elements"
	},
	steps: {
		icon: "⋮",
		cls: "jti-steps"
	},
	sliders: {
		icon: "⊝",
		cls: "jti-slider"
	},
	functions: {
		icon: "λ",
		cls: "jti-fn"
	},
	import: {
		icon: "⬆",
		cls: "jti-import"
	},
	scenes: {
		icon: "▣",
		cls: "jti-scenes"
	},
	show: {
		icon: "◑",
		cls: "jti-show"
	},
	hide: {
		icon: "◐",
		cls: "jti-hide"
	},
	remove: {
		icon: "✕",
		cls: "jti-remove"
	},
	caption: {
		icon: "✶",
		cls: "jti-caption"
	},
	color: {
		icon: "◔",
		cls: "jti-color"
	},
	label: {
		icon: "◎",
		cls: "jti-label"
	},
	type: {
		icon: "▸",
		cls: "jti-type-key"
	},
	axis: {
		icon: "↔",
		cls: "jti-axis"
	},
	camera: {
		icon: "⌖",
		cls: "jti-camera"
	},
	range: {
		icon: "⇔",
		cls: "jti-range"
	},
	info: {
		icon: "ℹ",
		cls: "jti-info"
	}
};
function _getTreeIcon(key, value) {
	const rec = value;
	if (value !== null && typeof value === "object" && !Array.isArray(value) && typeof rec.type === "string") {
		const ti = _JT_TYPE_ICONS[rec.type];
		if (ti) return ti;
	}
	if (key === "type" && typeof value === "string") {
		const ti = _JT_TYPE_ICONS[value];
		if (ti) return ti;
	}
	if (key.startsWith("unsafe")) return {
		icon: "⚠",
		cls: "jti-unsafe"
	};
	return _JT_KEY_ICONS[key] || null;
}
function _buildJsonWithLineMap(obj) {
	const lines = [""];
	function append(str) {
		lines[lines.length - 1] += str;
	}
	function newline(indent) {
		lines.push("  ".repeat(indent));
	}
	const pathLineMap = {};
	function serialize(val, path, indent) {
		if (val === null) {
			append("null");
			return;
		}
		if (typeof val === "string") {
			append(JSON.stringify(val));
			return;
		}
		if (typeof val === "number" || typeof val === "boolean") {
			append(String(val));
			return;
		}
		pathLineMap[path] = lines.length - 1;
		if (Array.isArray(val)) {
			if (val.length === 0) {
				append("[]");
				return;
			}
			append("[");
			val.forEach((item, i) => {
				newline(indent + 1);
				const cp = path ? `${path}[${i}]` : `[${i}]`;
				pathLineMap[cp] = lines.length - 1;
				serialize(item, cp, indent + 1);
				if (i < val.length - 1) append(",");
			});
			newline(indent);
			append("]");
		} else {
			const rec = val;
			const keys = Object.keys(rec);
			if (keys.length === 0) {
				append("{}");
				return;
			}
			append("{");
			keys.forEach((key, i) => {
				newline(indent + 1);
				const cp = path ? `${path}.${key}` : key;
				pathLineMap[cp] = lines.length - 1;
				append(JSON.stringify(key) + ": ");
				serialize(rec[key], cp, indent + 1);
				if (i < keys.length - 1) append(",");
			});
			newline(indent);
			append("}");
		}
	}
	serialize(obj, "", 0);
	return {
		text: lines.join("\n"),
		pathLineMap
	};
}
function _jsonTreeSummary(val) {
	if (Array.isArray(val)) return `[${val.length}]`;
	if (val && typeof val === "object") {
		const rec = val;
		const keys = Object.keys(rec);
		return `{ ${keys.slice(0, 3).map((k) => {
			const v = rec[k];
			if (typeof v === "string") return `${k}: "${v.length > 12 ? v.slice(0, 12) + "…" : v}"`;
			if (typeof v === "number" || typeof v === "boolean") return `${k}: ${v}`;
			return k;
		}).join(", ")}${keys.length > 3 ? ", …" : ""} }`;
	}
	return "";
}
function _buildTreeNodes(ul, val, path, depth) {
	const isArray = Array.isArray(val);
	const entries = isArray ? val.map((v, i) => [i, v]) : Object.entries(val);
	for (const [key, value] of entries) {
		const childPath = path ? isArray ? `${path}[${key}]` : `${path}.${key}` : String(key);
		const li = document.createElement("li");
		li.className = "jt-item";
		li.dataset.path = childPath;
		const row = document.createElement("div");
		row.className = "jt-row";
		const isPrimitive = value === null || typeof value !== "object";
		const iconInfo = _getTreeIcon(String(key), value);
		function makeIcon(info) {
			const ic = document.createElement("span");
			ic.className = "jt-icon " + info.cls;
			ic.textContent = info.icon;
			return ic;
		}
		if (!isPrimitive) {
			const toggle = document.createElement("span");
			toggle.className = "jt-toggle";
			const collapsed = depth >= 1;
			toggle.textContent = collapsed ? "▶" : "▼";
			const keyEl = document.createElement("span");
			keyEl.className = "jt-key";
			keyEl.textContent = isArray ? `[${key}]` : String(key);
			const summary = document.createElement("span");
			summary.className = "jt-summary";
			summary.textContent = " " + _jsonTreeSummary(value);
			row.appendChild(toggle);
			if (iconInfo) row.appendChild(makeIcon(iconInfo));
			row.appendChild(keyEl);
			row.appendChild(summary);
			const children = document.createElement("ul");
			children.className = "jt-children" + (collapsed ? " jt-collapsed" : "");
			_buildTreeNodes(children, value, childPath, depth + 1);
			toggle.addEventListener("click", (e) => {
				e.stopPropagation();
				const nowCollapsed = children.classList.toggle("jt-collapsed");
				toggle.textContent = nowCollapsed ? "▶" : "▼";
			});
			li.appendChild(row);
			li.appendChild(children);
		} else {
			const indent = document.createElement("span");
			indent.className = "jt-indent";
			const keyEl = document.createElement("span");
			keyEl.className = "jt-key";
			keyEl.textContent = isArray ? `[${key}]` : String(key);
			const colon = document.createElement("span");
			colon.className = "jt-colon";
			colon.textContent = ": ";
			const valEl = document.createElement("span");
			valEl.className = "jt-val jt-val-" + (value === null ? "null" : typeof value);
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
	treePanel.innerHTML = "";
	if (!obj || typeof obj !== "object") {
		treePanel.innerHTML = "<div class=\"jt-empty\">No scene loaded</div>";
		return;
	}
	const ul = document.createElement("ul");
	ul.className = "jt-root";
	_buildTreeNodes(ul, obj, "", 0);
	treePanel.appendChild(ul);
}
function _getParentPath(path) {
	if (!path) return null;
	const dot = path.lastIndexOf(".");
	if (dot > 0) return path.substring(0, dot);
	const bracket = path.lastIndexOf("[");
	if (bracket > 0) return path.substring(0, bracket);
	return null;
}
function _findPathAtLine(line, pathLineMap) {
	let bestPath = "";
	let bestLine = -1;
	for (const [p, ln] of Object.entries(pathLineMap)) if (ln <= line && ln > bestLine) {
		bestLine = ln;
		bestPath = p;
	}
	return bestPath;
}
function setupJsonViewer() {
	const btn = document.getElementById("btn-show-json");
	const overlay = document.getElementById("json-viewer-overlay");
	const content = document.getElementById("json-viewer-content");
	const treePanel = document.getElementById("json-tree-panel");
	const importsBar = document.getElementById("json-viewer-imports");
	const summaryBar = document.getElementById("json-viewer-summary");
	const closeBtn = document.getElementById("json-viewer-close");
	const copyBtn = document.getElementById("json-viewer-copy");
	const issuesPanel = document.getElementById("json-viewer-issues");
	if (!btn || !overlay) return;
	btn.innerHTML = BRACES_ICON;
	btn.classList.add("icon-only");
	btn.setAttribute("aria-label", "Show current scene JSON");
	let _pathLineMap = {};
	let _jsonScrollAnimFrame = null;
	let _jsonScrollProgrammatic = false;
	let _jsonLineHeight = 0;
	function getLineHeight() {
		if (!_jsonLineHeight) _jsonLineHeight = parseFloat(window.getComputedStyle(content).lineHeight) || 20;
		return _jsonLineHeight;
	}
	function animateJsonScrollTo(targetTop, duration = 160) {
		if (_jsonScrollAnimFrame != null) {
			cancelAnimationFrame(_jsonScrollAnimFrame);
			_jsonScrollAnimFrame = null;
		}
		const startTop = content.scrollTop;
		const delta = targetTop - startTop;
		if (Math.abs(delta) < 2) {
			content.scrollTop = targetTop;
			return;
		}
		const startTime = performance.now();
		_jsonScrollProgrammatic = true;
		function step(now) {
			const t = Math.min(1, (now - startTime) / duration);
			const eased = 1 - Math.pow(1 - t, 3);
			content.scrollTop = startTop + delta * eased;
			if (t < 1) _jsonScrollAnimFrame = requestAnimationFrame(step);
			else {
				_jsonScrollAnimFrame = null;
				content.scrollTop = targetTop;
				setTimeout(() => {
					_jsonScrollProgrammatic = false;
				}, 60);
			}
		}
		_jsonScrollAnimFrame = requestAnimationFrame(step);
	}
	let _treeScrollAnimFrame = null;
	function scrollTreeIntoView(el, duration = 160) {
		if (!treePanel || !el) return;
		const elRect = el.getBoundingClientRect();
		const ctRect = treePanel.getBoundingClientRect();
		const elTop = treePanel.scrollTop + (elRect.top - ctRect.top);
		const elBottom = elTop + elRect.height;
		const ctTop = treePanel.scrollTop;
		const ctBottom = ctTop + treePanel.clientHeight;
		let target = ctTop;
		if (elTop < ctTop + 8) target = elTop - 8;
		else if (elBottom > ctBottom - 8) target = elBottom - treePanel.clientHeight + 8;
		if (target === ctTop) return;
		if (_treeScrollAnimFrame != null) {
			cancelAnimationFrame(_treeScrollAnimFrame);
			_treeScrollAnimFrame = null;
		}
		const startTop = treePanel.scrollTop;
		const delta = target - startTop;
		if (Math.abs(delta) < 2) {
			treePanel.scrollTop = target;
			return;
		}
		const startTime = performance.now();
		function step(now) {
			const t = Math.min(1, (now - startTime) / duration);
			const eased = 1 - Math.pow(1 - t, 3);
			treePanel.scrollTop = startTop + delta * eased;
			if (t < 1) _treeScrollAnimFrame = requestAnimationFrame(step);
			else {
				_treeScrollAnimFrame = null;
				treePanel.scrollTop = target;
			}
		}
		_treeScrollAnimFrame = requestAnimationFrame(step);
	}
	function setActiveTreeItem(path) {
		if (!treePanel) return;
		treePanel.querySelectorAll(".jt-active").forEach((el) => el.classList.remove("jt-active"));
		let target = path;
		let el = null;
		while (target !== null) {
			const found = [...treePanel.querySelectorAll(".jt-item")].find((e) => e.dataset.path === target);
			if (found) {
				el = found;
				break;
			}
			target = _getParentPath(target);
		}
		if (!el) return;
		let parent = el.parentElement;
		while (parent && parent !== treePanel) {
			if (parent.classList.contains("jt-children") && parent.classList.contains("jt-collapsed")) {
				parent.classList.remove("jt-collapsed");
				const row = parent.previousElementSibling;
				if (row) {
					const t = row.querySelector(".jt-toggle");
					if (t) t.textContent = "▼";
				}
			}
			parent = parent.parentElement;
		}
		el.classList.add("jt-active");
		scrollTreeIntoView(el);
	}
	function getContentPaddingTop() {
		return parseFloat(window.getComputedStyle(content).paddingTop) || 0;
	}
	let _lineOffsets = [];
	function buildLineOffsets(text) {
		_lineOffsets = [0];
		for (let i = 0; i < text.length; i++) if (text[i] === "\n") _lineOffsets.push(i + 1);
	}
	function lineToScrollTop(lineNum) {
		const textNode = content.firstChild;
		if (!textNode || textNode.nodeType !== Node.TEXT_NODE || !_lineOffsets.length) return getContentPaddingTop() + lineNum * getLineHeight();
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
		setActiveTreeItem(_findPathAtLine(Math.floor(Math.max(0, content.scrollTop - pt + lh * .5) / lh), _pathLineMap));
	}
	function selectJsonLine(lineNum) {
		const textNode = content.firstChild;
		if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;
		const lines = textNode.textContent.split("\n");
		let offset = 0;
		for (let i = 0; i < lineNum; i++) offset += lines[i].length + 1;
		const lineText = (lines[lineNum] || "").trimStart();
		const start = offset + (lines[lineNum] || "").length - lineText.length;
		const end = offset + (lines[lineNum] || "").length;
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
		if (line === void 0) return;
		const lh = getLineHeight();
		animateJsonScrollTo(Math.max(0, lineToScrollTop(line) - lh * 1.5));
		setActiveTreeItem(path);
		if (select) selectJsonLine(line);
	}
	window.algebenchOpenJsonBrowserAtPath = function(path) {
		btn.click();
		if (_pathLineMap[path] === void 0) return false;
		syncJsonFromTreeClick(path, { select: true });
		return true;
	};
	if (treePanel) {
		treePanel.addEventListener("click", (e) => {
			const item = e.target.closest(".jt-item");
			if (!item || e.target.classList.contains("jt-toggle")) return;
			syncJsonFromTreeClick(item.dataset.path);
		});
		const savedWidth = localStorage.getItem("jsonTreePanelWidth");
		if (savedWidth) treePanel.style.width = savedWidth + "px";
		const resizeHandle = document.getElementById("json-tree-resize-handle");
		if (resizeHandle) {
			let startX = 0;
			let startWidth = 0;
			resizeHandle.addEventListener("mousedown", (e) => {
				e.preventDefault();
				startX = e.clientX;
				startWidth = treePanel.offsetWidth;
				resizeHandle.classList.add("dragging");
				document.body.style.cursor = "col-resize";
				document.body.style.userSelect = "none";
				function onMove(e) {
					const newWidth = Math.min(520, Math.max(120, startWidth + (e.clientX - startX)));
					treePanel.style.width = newWidth + "px";
				}
				function onUp() {
					resizeHandle.classList.remove("dragging");
					document.body.style.cursor = "";
					document.body.style.userSelect = "";
					localStorage.setItem("jsonTreePanelWidth", String(treePanel.offsetWidth));
					document.removeEventListener("mousemove", onMove);
					document.removeEventListener("mouseup", onUp);
				}
				document.addEventListener("mousemove", onMove);
				document.addEventListener("mouseup", onUp);
			});
		}
	}
	content.addEventListener("scroll", syncTreeFromJsonScroll);
	document.addEventListener("selectionchange", () => {
		if (overlay.classList.contains("hidden")) return;
		const sel = window.getSelection();
		if (!sel.rangeCount) return;
		const range = sel.getRangeAt(0);
		if (!content.contains(range.startContainer)) return;
		const textNode = content.firstChild;
		if (!textNode) return;
		const offset = range.startContainer === textNode ? range.startOffset : 0;
		setActiveTreeItem(_findPathAtLine(content.textContent.substring(0, offset).split("\n").length - 1, _pathLineMap));
	});
	btn.addEventListener("click", () => {
		if (issuesPanel) issuesPanel.classList.add("hidden");
		let json;
		if (browserState.lessonSpec) json = browserState.lessonSpec;
		else if (browserState.currentSpec) json = browserState.currentSpec;
		_jsonLineHeight = 0;
		if (json) {
			const { text, pathLineMap } = _buildJsonWithLineMap(json);
			content.textContent = text;
			buildLineOffsets(text);
			_pathLineMap = pathLineMap;
			if (treePanel) _renderJsonTree(treePanel, json);
		} else {
			content.textContent = "// No scene loaded";
			buildLineOffsets("// No scene loaded");
			_pathLineMap = {};
			if (treePanel) treePanel.innerHTML = "<div class=\"jt-empty\">No scene loaded</div>";
		}
		const imports = json && Array.isArray(json.import) ? json.import : [];
		if (imports.length > 0 && importsBar) {
			importsBar.innerHTML = "<span class=\"imports-label\">Imports</span>" + imports.map((name) => `<a href="/api/domains/${encodeURIComponent(String(name))}" target="_blank" rel="noopener">${_escHtml$1(name)} ↗</a>`).join("");
			importsBar.classList.remove("hidden");
		} else if (importsBar) importsBar.classList.add("hidden");
		const s = _computeSceneSummary(json);
		const ag = _computeAgenticScore(json);
		if (s && summaryBar) {
			const stats = [];
			if (s.isLesson) stats.push({
				label: "Scenes",
				value: s.sceneCount,
				tip: "Number of scenes in this lesson"
			});
			stats.push({
				label: "Steps",
				value: s.totalSteps,
				tip: "Total progressive reveal steps across all scenes"
			});
			stats.push({
				label: "Sliders",
				value: s.totalSliders,
				tip: "Total interactive sliders defined across all steps"
			});
			stats.push({
				label: "Animated",
				value: s.totalAnimated,
				tip: "Elements re-evaluated every frame — respond to sliders and animation time"
			});
			stats.push({
				label: "Static",
				value: s.totalStatic,
				tip: "Elements built once at load — fixed geometry, zero per-frame cost"
			});
			if (s.totalExpressions > 0) stats.push({
				label: "Expressions",
				value: s.totalExpressions,
				tip: "Individual math expression strings driving animated elements"
			});
			if (s.totalFunctions > 0) stats.push({
				label: "Functions",
				value: s.totalFunctions,
				tip: "Scene-level reusable expression helper functions (scene.functions)"
			});
			if (s.totalPrompts > 0) stats.push({
				label: "Prompts",
				value: s.totalPrompts,
				tip: "Scenes/steps with a prompt field — agent-specific teaching instructions injected into the AI system prompt"
			});
			if (s.imports > 0) stats.push({
				label: "Domains",
				value: s.imports,
				tip: "Built-in domain libraries imported (e.g. astrodynamics)"
			});
			summaryBar.innerHTML = `<span class="summary-score" title="Interactiveness Score (0–99)

raw = Sliders × 10 + Animated × 6 + Steps × 4
    + Expressions × 1 + Functions × 6 + Domains × 12

score = floor(100 × (1 − e^(−raw / 80)))

Approaches 100 asymptotically — floor() ensures 100 is never displayed.
raw ≈ 40 → score 39
raw ≈ 80 → score 63
raw ≈ 160 → score 86
raw ≈ 280 → score 97" style="--score-color:${s.scoreColor}"><span class="summary-score-value">${s.score}</span><span class="summary-score-label">${s.scoreLabel}</span></span>` + (ag ? `<span class="summary-score summary-score-agentic" title="Agentic Score (0–99) — how AI-agent-friendly this scene is

Markdown presence + length (up to 32)
Prompt field per scene (up to 25 each)
Step captions + titles (3 + 1 each)
Slider labels — descriptive vs bare id (2 each)
Element ids + labels (1 + 2 each)
Scene/lesson description (3–4)
Domain imports with docs (10 each)

score = floor(100 × (1 − e^(−raw / 80)))" style="--score-color:${ag.color}"><span class="summary-score-value">${ag.score}</span><span class="summary-score-label">${ag.label}</span></span>` : "") + `<span class="summary-divider"></span>` + stats.map((st) => `<span class="summary-stat" title="${st.tip}"><span class="summary-stat-value">${st.value}</span><span class="summary-stat-label">${st.label}</span></span>`).join("");
			if (s.description) {
				const desc = document.createElement("span");
				desc.className = "summary-description";
				desc.textContent = s.description;
				summaryBar.appendChild(desc);
			}
			const existingBadge = summaryBar.querySelector(".summary-stat-js-issues");
			if (existingBadge) existingBadge.remove();
			if (browserState._sceneIsUnsafe || browserState._sceneJsIssues.length > 0) {
				const trusted = browserState._sceneJsTrustState === "trusted";
				const count = browserState._sceneIsUnsafe && browserState._sceneJsIssues.length === 0 ? "!" : browserState._sceneJsIssues.length;
				const badge = document.createElement("span");
				badge.className = "summary-stat summary-stat-js-issues" + (trusted ? " js-trusted" : " js-untrusted");
				badge.title = "Click to view detected JavaScript expressions and trust status";
				badge.innerHTML = `<span class="summary-stat-value">${count}</span><span class="summary-stat-label">JS ${trusted ? "⚡" : "⚠"}</span>`;
				summaryBar.appendChild(badge);
				badge.addEventListener("click", () => _toggleJsIssuesPanel(issuesPanel));
			} else if (issuesPanel) issuesPanel.classList.add("hidden");
			summaryBar.classList.remove("hidden");
		} else if (summaryBar) summaryBar.classList.add("hidden");
		overlay.classList.remove("hidden");
	});
	closeBtn.addEventListener("click", () => overlay.classList.add("hidden"));
	overlay.addEventListener("click", (e) => {
		if (e.target === overlay) overlay.classList.add("hidden");
	});
	copyBtn.addEventListener("click", () => {
		navigator.clipboard.writeText(content.textContent).then(() => {
			copyBtn.textContent = "Copied!";
			setTimeout(() => {
				copyBtn.textContent = "Copy";
			}, 1500);
		});
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !overlay.classList.contains("hidden")) overlay.classList.add("hidden");
	});
	const keyInput = document.getElementById("json-search-key");
	const valInput = document.getElementById("json-search-val");
	const keyCount = document.getElementById("json-search-key-count");
	const valCount = document.getElementById("json-search-val-count");
	const prevBtn = document.getElementById("json-search-prev");
	const nextBtn = document.getElementById("json-search-next");
	if (!keyInput || !valInput) return;
	let _matchItems = [];
	let _matchIndex = -1;
	function applyTreeSearch() {
		if (!treePanel) return;
		const focused = document.activeElement;
		const keyTerm = keyInput.value.trim().toLowerCase();
		const valTerm = valInput.value.trim().toLowerCase();
		const items = [...treePanel.querySelectorAll(".jt-item")];
		items.forEach((el) => el.classList.remove("jt-dim", "jt-match"));
		[keyInput, valInput].forEach((inp) => inp.classList.remove("jsb-has-results", "jsb-no-results"));
		if (keyCount) keyCount.textContent = "";
		if (valCount) valCount.textContent = "";
		_matchItems = [];
		_matchIndex = -1;
		if (!keyTerm && !valTerm) return;
		items.forEach((el) => {
			const keyEl = el.querySelector(":scope > .jt-row .jt-key");
			const valEl = el.querySelector(":scope > .jt-row .jt-val");
			const keyText = keyEl ? keyEl.textContent.toLowerCase() : "";
			const valText = valEl ? valEl.textContent.toLowerCase() : "";
			const keyOk = !keyTerm || keyText.includes(keyTerm);
			const valOk = !valTerm || valText.includes(valTerm);
			if (keyOk && valOk) el.classList.add("jt-match");
			else el.classList.add("jt-dim");
		});
		treePanel.querySelectorAll(".jt-item.jt-match").forEach((matchEl) => {
			let ancestor = matchEl.parentElement;
			while (ancestor && ancestor !== treePanel) {
				if (ancestor.classList.contains("jt-item")) ancestor.classList.remove("jt-dim");
				if (ancestor.classList.contains("jt-children") && ancestor.classList.contains("jt-collapsed")) {
					ancestor.classList.remove("jt-collapsed");
					const row = ancestor.previousElementSibling;
					if (row) {
						const t = row.querySelector(".jt-toggle");
						if (t) t.textContent = "▼";
					}
				}
				ancestor = ancestor.parentElement;
			}
		});
		_matchItems = [...treePanel.querySelectorAll(".jt-item.jt-match")];
		const n = _matchItems.length;
		if (keyTerm) {
			keyInput.classList.toggle("jsb-has-results", n > 0);
			keyInput.classList.toggle("jsb-no-results", n === 0);
		}
		if (valTerm) {
			valInput.classList.toggle("jsb-has-results", n > 0);
			valInput.classList.toggle("jsb-no-results", n === 0);
		}
		if (keyCount) keyCount.textContent = n ? String(n) : keyTerm ? "none" : "";
		if (valCount) valCount.textContent = n ? `1/${n}` : valTerm ? "none" : "";
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
		if (focused === keyInput || focused === valInput) setTimeout(() => focused.focus(), 0);
		const label = `${_matchIndex + 1}/${_matchItems.length}`;
		if (valCount) valCount.textContent = label;
		if (keyCount) keyCount.textContent = label;
	}
	keyInput.addEventListener("input", applyTreeSearch);
	valInput.addEventListener("input", applyTreeSearch);
	[keyInput, valInput].forEach((inp) => {
		inp.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				navigateMatch(e.shiftKey ? -1 : 1);
			}
		});
	});
	nextBtn.addEventListener("click", () => navigateMatch(1));
	prevBtn.addEventListener("click", () => navigateMatch(-1));
	const clearBtn = document.getElementById("json-search-clear");
	if (clearBtn) clearBtn.addEventListener("click", () => {
		keyInput.value = "";
		valInput.value = "";
		applyTreeSearch();
	});
}
function setupContextStatusPopup() {
	const pill = document.getElementById("context-status");
	const popup = document.getElementById("context-popup");
	const meta = document.getElementById("context-popup-meta");
	const nav = document.getElementById("context-popup-nav");
	const body = document.getElementById("context-popup-body");
	const closeBtn = document.getElementById("context-popup-close");
	const copyBtn = document.getElementById("context-popup-copy");
	const toggleBtn = document.getElementById("context-popup-toggle");
	const topResizeHandle = document.getElementById("context-popup-top-resize");
	const rightResizeHandle = document.getElementById("context-popup-right-resize");
	if (!pill || !popup || !meta || !nav || !body || !closeBtn || !copyBtn || !toggleBtn || !topResizeHandle || !rightResizeHandle) return;
	if (document.body.dataset.debugMode !== "true") {
		pill.classList.add("hidden");
		popup.classList.add("hidden");
		return;
	}
	let currentPromptText = "";
	let sectionEls = [];
	let navButtons = [];
	let programmaticScrollIndex = -1;
	let programmaticScrollTimer = null;
	let contextScrollAnimFrame = null;
	let contextRefreshTimer = null;
	let contextCollapsed = true;
	let popupResizeCleanup = null;
	const CONTEXT_POPUP_SIZE_KEY = "algebench-context-popup-size";
	const CONTEXT_POPUP_STATE_KEY = "algebench-context-popup-state";
	function readStoredContextPopupState() {
		try {
			const raw = localStorage.getItem(CONTEXT_POPUP_STATE_KEY);
			if (!raw) return {};
			const parsed = JSON.parse(raw);
			return { collapsed: typeof parsed?.collapsed === "boolean" ? parsed.collapsed : null };
		} catch (_err) {
			return {};
		}
	}
	function storeContextPopupState({ collapsed }) {
		const current = readStoredContextPopupState();
		const next = { collapsed: typeof collapsed === "boolean" ? collapsed : current.collapsed };
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
				height: Number.isFinite(parsed?.height) ? parsed.height : null
			};
		} catch (_err) {
			return {};
		}
	}
	function storeContextPopupSize({ width, height }) {
		const current = readStoredContextPopupSize();
		const next = {
			width: Number.isFinite(width) ? Math.round(width) : current.width,
			height: Number.isFinite(height) ? Math.round(height) : current.height
		};
		try {
			localStorage.setItem(CONTEXT_POPUP_SIZE_KEY, JSON.stringify(next));
		} catch (_err) {}
	}
	function getContextPopupSizeCaps() {
		const sideGap = window.innerWidth <= 900 ? 8 : 12;
		return {
			maxWidth: Math.max(272, window.innerWidth - sideGap * 2),
			maxHeight: Math.max(220, window.innerHeight - 48)
		};
	}
	function applyStoredContextPopupSize() {
		const stored = readStoredContextPopupSize();
		const caps = getContextPopupSizeCaps();
		const width = Number.isFinite(stored.width) ? Math.min(stored.width, caps.maxWidth) : null;
		const height = Number.isFinite(stored.height) ? Math.min(stored.height, caps.maxHeight) : null;
		if (contextCollapsed) {
			popup.style.right = "";
			popup.style.width = "";
		} else if (width != null) {
			popup.style.right = window.innerWidth <= 900 ? "8px" : "12px";
			popup.style.width = `${Math.round(width)}px`;
		} else {
			popup.style.right = "";
			popup.style.width = "";
		}
		if (height != null) popup.style.height = `${Math.round(height)}px`;
		else popup.style.height = "";
	}
	function updateContextPopupMode() {
		popup.classList.toggle("collapsed", contextCollapsed);
		toggleBtn.textContent = contextCollapsed ? "☰" : "☰";
		toggleBtn.title = contextCollapsed ? "Expand text pane" : "Collapse text pane";
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
		const startHeight = popup.getBoundingClientRect().height;
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
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp, { once: true });
		popupResizeCleanup = () => {
			window.removeEventListener("mousemove", onMove);
		};
	}
	function beginContextWidthResize(startEvent) {
		if (contextCollapsed) return;
		startEvent.preventDefault();
		startEvent.stopPropagation();
		clearPopupResizeHandlers();
		const startX = startEvent.clientX;
		const startWidth = popup.getBoundingClientRect().width;
		const { maxWidth } = getContextPopupSizeCaps();
		const minWidth = 320;
		popup.style.right = window.innerWidth <= 900 ? "8px" : "12px";
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
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp, { once: true });
		popupResizeCleanup = () => {
			window.removeEventListener("mousemove", onMove);
		};
	}
	function parsePromptSections(text) {
		const lines = String(text || "").split("\n");
		const sections = [];
		let current = {
			title: "Prelude",
			body: []
		};
		function flushCurrent() {
			const content = current.body.join("\n").trim();
			if (!content) return;
			sections.push({
				title: current.title,
				content
			});
		}
		for (const line of lines) {
			const match = line.match(/^##\s+(.*)$/);
			if (match) {
				flushCurrent();
				current = {
					title: match[1].trim(),
					body: []
				};
			} else current.body.push(line);
		}
		flushCurrent();
		if (!sections.length) return [{
			title: "Prompt",
			content: String(text || "").trim() || "(empty prompt)"
		}];
		return sections;
	}
	function setActiveSection(index) {
		navButtons.forEach((btn, i) => btn.classList.toggle("active", i === index));
	}
	function getContextScrollLeadRows(rowCount = 3) {
		const lineHeight = parseFloat(window.getComputedStyle(body).lineHeight);
		return Math.round((Number.isFinite(lineHeight) ? lineHeight : 20) * rowCount);
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
	function scheduleContextRefresh(_reason = "context-change") {
		if (popup.classList.contains("hidden")) return;
		if (contextRefreshTimer) clearTimeout(contextRefreshTimer);
		contextRefreshTimer = setTimeout(async () => {
			contextRefreshTimer = null;
			meta.textContent = "Refreshing live prompt context…";
			try {
				await loadPromptContext();
				console.log(`%c📋 Prompt context refreshed%c (${currentPromptText.length} chars)`, "color: #aa88ff; font-weight: bold", "color: #ccc");
			} catch (err) {
				body.innerHTML = "";
				const empty = document.createElement("div");
				empty.className = "context-popup-empty";
				empty.textContent = `Unable to build prompt context: ${err.message || err}`;
				body.appendChild(empty);
				meta.textContent = "Prompt context unavailable";
			}
		}, 120);
	}
	function scheduleProgrammaticScrollRelease() {
		if (programmaticScrollTimer) clearTimeout(programmaticScrollTimer);
		programmaticScrollTimer = setTimeout(() => {
			if (programmaticScrollIndex >= 0) setActiveSection(programmaticScrollIndex);
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
			if (t < 1) contextScrollAnimFrame = requestAnimationFrame(step);
			else {
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
		for (let i = 0; i < sectionEls.length; i++) if (sectionEls[i].offsetTop <= scrollTop) activeIndex = i;
		else break;
		setActiveSection(activeIndex);
	}
	function renderPrompt(text) {
		const sections = parsePromptSections(text);
		sectionEls = [];
		navButtons = [];
		nav.innerHTML = "";
		body.innerHTML = "";
		sections.forEach((section, index) => {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "context-nav-btn";
			btn.textContent = section.title;
			btn.addEventListener("click", () => {
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
			const sec = document.createElement("section");
			sec.className = "context-section";
			const heading = document.createElement("div");
			heading.className = "context-section-heading";
			heading.textContent = section.title;
			sec.appendChild(heading);
			const pre = document.createElement("pre");
			pre.className = "context-section-pre";
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
		if (typeof contextBuilder !== "function") throw new Error("Chat context builder is not available yet.");
		const res = await fetch("/api/debug/system_prompt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ context: contextBuilder() })
		});
		if (!res.ok) {
			let message = `HTTP ${res.status}`;
			try {
				const data = await res.json();
				if (data && data.error) message = data.error;
			} catch (_err) {}
			throw new Error(message);
		}
		currentPromptText = (await res.json()).systemPrompt || "";
		renderPrompt(currentPromptText);
	}
	body.addEventListener("scroll", syncActiveSectionFromScroll);
	window.algebenchRefreshPromptContext = (reason = "manual") => {
		scheduleContextRefresh(reason);
	};
	const refreshBtn = document.getElementById("context-popup-refresh");
	if (refreshBtn) refreshBtn.addEventListener("click", () => scheduleContextRefresh("manual"));
	pill.classList.remove("hidden");
	{
		const storedState = readStoredContextPopupState();
		if (typeof storedState.collapsed === "boolean") contextCollapsed = storedState.collapsed;
	}
	updateContextPopupMode();
	pill.addEventListener("click", async () => {
		if (!popup.classList.contains("hidden")) {
			popup.classList.add("hidden");
			return;
		}
		popup.classList.remove("hidden");
		currentPromptText = "";
		clearProgrammaticScroll();
		applyStoredContextPopupSize();
		nav.innerHTML = "";
		body.innerHTML = "<div class=\"context-popup-empty\">Building current system prompt…</div>";
		meta.textContent = "Fetching live prompt context…";
		try {
			await loadPromptContext();
			console.log(`%c📋 Prompt context loaded%c (${currentPromptText.length} chars)`, "color: #aa88ff; font-weight: bold", "color: #ccc");
		} catch (err) {
			body.innerHTML = "";
			const empty = document.createElement("div");
			empty.className = "context-popup-empty";
			empty.textContent = `Unable to build prompt context: ${err.message || err}`;
			body.appendChild(empty);
			meta.textContent = "Prompt context unavailable";
		}
	});
	toggleBtn.addEventListener("click", () => {
		contextCollapsed = !contextCollapsed;
		updateContextPopupMode();
	});
	closeBtn.addEventListener("click", () => {
		clearProgrammaticScroll();
		clearPopupResizeHandlers();
		popup.classList.add("hidden");
	});
	copyBtn.addEventListener("click", async () => {
		if (!currentPromptText) return;
		try {
			await navigator.clipboard.writeText(currentPromptText);
			const prev = copyBtn.textContent;
			copyBtn.textContent = "Copied";
			setTimeout(() => {
				copyBtn.textContent = prev;
			}, 900);
		} catch (_err) {}
	});
	topResizeHandle.addEventListener("mousedown", beginContextHeightResize);
	rightResizeHandle.addEventListener("mousedown", beginContextWidthResize);
	window.addEventListener("resize", () => {
		applyStoredContextPopupSize();
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !popup.classList.contains("hidden")) {
			clearProgrammaticScroll();
			clearPopupResizeHandlers();
			popup.classList.add("hidden");
		}
	});
}
var NavStack = class {
	constructor(max = 100) {
		this.max = Math.max(1, max | 0);
		this.entries = [];
		this.cursor = -1;
	}
	/**
	* Push a new entry after the cursor. Truncates any forward history
	* (classic browser behavior). No-op if equal to the current entry.
	* Enforces the max size by dropping the oldest entries.
	* @returns true if an entry was added.
	*/
	push(entry) {
		if (this.cursor >= 0 && this.entries[this.cursor] === entry) return false;
		this.entries.length = this.cursor + 1;
		this.entries.push(entry);
		this.cursor = this.entries.length - 1;
		if (this.entries.length > this.max) {
			const overflow = this.entries.length - this.max;
			this.entries.splice(0, overflow);
			this.cursor -= overflow;
		}
		return true;
	}
	/** Replace the current entry in place (or seed the stack if empty). */
	replace(entry) {
		if (this.cursor < 0) {
			this.entries = [entry];
			this.cursor = 0;
		} else this.entries[this.cursor] = entry;
	}
	canBack() {
		return this.cursor > 0;
	}
	canForward() {
		return this.cursor >= 0 && this.cursor < this.entries.length - 1;
	}
	/** Move cursor back one; returns the new current entry or null. */
	back() {
		if (!this.canBack()) return null;
		this.cursor -= 1;
		return this.entries[this.cursor];
	}
	/** Move cursor forward one; returns the new current entry or null. */
	forward() {
		if (!this.canForward()) return null;
		this.cursor += 1;
		return this.entries[this.cursor];
	}
	/**
	* Sync the cursor to a known entry (used on popstate where the browser,
	* not us, moved). Picks the nearest matching index to the current cursor.
	* @returns true if found.
	*/
	syncTo(entry) {
		if (this.cursor >= 0 && this.entries[this.cursor] === entry) return true;
		let best = -1, bestDist = Infinity;
		for (let i = 0; i < this.entries.length; i++) if (this.entries[i] === entry) {
			const d = Math.abs(i - this.cursor);
			if (d < bestDist) {
				bestDist = d;
				best = i;
			}
		}
		if (best >= 0) {
			this.cursor = best;
			return true;
		}
		return false;
	}
	current() {
		return this.cursor >= 0 ? this.entries[this.cursor] : null;
	}
	getStack() {
		return this.entries.slice();
	}
	getCursor() {
		return this.cursor;
	}
	get size() {
		return this.entries.length;
	}
};
//#endregion
//#region src/nav-history.ts
var stack = new NavStack(100);
var _applyingFromHistory = false;
/** True while a popstate-driven apply is in flight (guards push loops). */
function isApplyingFromHistory() {
	return _applyingFromHistory;
}
function urlFor(query) {
	const path = window.location.pathname;
	const hash = window.location.hash || "";
	return path + (query ? "?" + query : "") + hash;
}
/**
* Push a new history entry for a discrete navigation (scene/step/proof step).
* No-op while applying from history, or when identical to the current URL.
*/
function pushView(vs) {
	if (_applyingFromHistory) return;
	const query = serializeViewState(vs);
	if (query === window.location.search.replace(/^\?/, "")) return;
	stack.push(query);
	try {
		window.history.pushState({ vs: query }, "", urlFor(query));
	} catch (_) {}
}
/**
* Rewrite the current URL in place (selection / sliders / camera capture).
* Does not create a history entry.
*/
function replaceView(vs) {
	if (_applyingFromHistory) return;
	const query = serializeViewState(vs);
	if (query === window.location.search.replace(/^\?/, "")) return;
	stack.replace(query);
	try {
		window.history.replaceState({ vs: query }, "", urlFor(query));
	} catch (_) {}
}
/**
* Install the browser back/forward handler. `applyFn(vs, {fromHistory:true})`
* is invoked with the parsed ViewState for the URL the browser navigated to.
*/
function setupPopstateListener(applyFn) {
	window.addEventListener("popstate", (e) => {
		const query = e.state && e.state.vs != null ? e.state.vs : window.location.search.replace(/^\?/, "");
		stack.syncTo(query);
		const vs = parseViewState(query);
		_applyingFromHistory = true;
		Promise.resolve().then(() => applyFn(vs, { fromHistory: true })).catch((err) => console.error("popstate apply failed:", err)).finally(() => {
			_applyingFromHistory = false;
		});
	});
}
//#endregion
//#region src/view-state-bridge.ts
var bridgeState = state;
var _applying = false;
var _sceneMapCache = /* @__PURE__ */ new WeakMap();
var _autoAskFired = false;
/** True while applyViewState is driving the app (suppresses outbound sync). */
function isApplyingViewState() {
	return _applying || isApplyingFromHistory();
}
function buildIds(items, titleKey) {
	const used = /* @__PURE__ */ new Set();
	return (items || []).map((it, i) => {
		let base = it && it.id ? String(it.id) : slugify(it && it[titleKey]);
		if (!base) base = String(i);
		let id = base, n = 2;
		while (used.has(id)) id = `${base}-${n++}`;
		used.add(id);
		return id;
	});
}
function sceneMaps(lesson) {
	if (!lesson || !Array.isArray(lesson.scenes)) return {
		sceneIds: [],
		stepIds: []
	};
	let cached = _sceneMapCache.get(lesson);
	if (cached) return cached;
	cached = {
		sceneIds: buildIds(lesson.scenes, "title"),
		stepIds: lesson.scenes.map((sc) => buildIds(sc.steps || [], "title"))
	};
	_sceneMapCache.set(lesson, cached);
	return cached;
}
function resolveIndex(token, ids) {
	if (token == null) return -1;
	const direct = ids.indexOf(token);
	if (direct >= 0) return direct;
	if (/^\d+$/.test(token)) {
		const n = Number(token);
		if (n >= 0 && n < ids.length) return n;
	}
	return -1;
}
function proofId(entry, index) {
	return entry && entry.proof && entry.proof.id || slugify(entry && entry.proof && entry.proof.title) || `_idx_${index}`;
}
function proofStepIds(proof) {
	return buildIds(proof && proof.steps || [], "label");
}
function currentBuiltin() {
	const p = bridgeState.currentSceneSourcePath || "";
	const m = /^\/scenes\/(.+)$/.exec(p);
	return m ? decodeURIComponent(m[1]) : null;
}
function captureViewState({ includeCamera = false } = {}) {
	const vs = {};
	const cur = parseViewState(window.location.search);
	if (cur.builtin) vs.builtin = cur.builtin;
	else if (cur.scene) vs.scene = cur.scene;
	const lesson = bridgeState.lessonSpec;
	if (lesson && Array.isArray(lesson.scenes) && bridgeState.currentSceneIndex >= 0) {
		const maps = sceneMaps(lesson);
		vs.sc = maps.sceneIds[bridgeState.currentSceneIndex];
		if (bridgeState.currentStepIndex >= 0) {
			const stepIds = maps.stepIds[bridgeState.currentSceneIndex] || [];
			if (stepIds[bridgeState.currentStepIndex] != null) vs.st = stepIds[bridgeState.currentStepIndex];
		}
	}
	if (Array.isArray(bridgeState.proofSpec) && bridgeState.proofSpec.length && bridgeState.proofActiveIndex >= 0) {
		const entry = bridgeState.proofSpec[bridgeState.proofActiveIndex];
		if (entry && entry.proof) {
			vs.pf = proofId(entry, bridgeState.proofActiveIndex);
			if (bridgeState.proofStepIndex >= 0) {
				const sIds = proofStepIds(entry.proof);
				if (sIds[bridgeState.proofStepIndex] != null) vs.ps = sIds[bridgeState.proofStepIndex];
			}
		}
	}
	const view = window.__algebenchGraph && window.__algebenchGraph.getCurrentView ? window.__algebenchGraph.getCurrentView() : "scene";
	if (view === "math") vs.view = "math";
	if (view === "math" && window.__algebenchGraph && typeof window.__algebenchGraph.isDocked === "function" && window.__algebenchGraph.isDocked()) vs.dock = true;
	const tab = document.querySelector(".panel-tab.active");
	if (tab && tab.dataset.tab === "chat") vs.panel = "chat";
	if (bridgeState.proofExpanded) vs.pp = true;
	const sel = window.__algebenchGraph && window.__algebenchGraph.getSelection ? window.__algebenchGraph.getSelection() : [];
	if (sel && sel.length) vs.nodes = sel;
	if (window.__algebenchGraph && typeof window.__algebenchGraph.getFunctionAnalysisId === "function") {
		const faId = window.__algebenchGraph.getFunctionAnalysisId();
		if (faId) vs.fa = faId;
	}
	const sliders = {};
	for (const [id, s] of Object.entries(bridgeState.sceneSliders || {})) {
		if (!s || !Number.isFinite(s.value)) continue;
		const def = Number.isFinite(s.default) ? s.default : null;
		if (def == null || Math.abs(s.value - def) > 1e-6) sliders[id] = Number(fmtNum(s.value));
	}
	if (Object.keys(sliders).length) vs.sliders = sliders;
	if (includeCamera) {
		const activeBtn = document.querySelector(".cam-btn.active");
		if (activeBtn && activeBtn.dataset.view) vs.cv = activeBtn.dataset.view;
		if (bridgeState.currentProjection === "orthographic") {
			vs.proj = "orthographic";
			const c = bridgeState.camera;
			if (c && c.isOrthographicCamera) {
				const halfH = Math.abs((c.top - c.bottom) / (2 * (c.zoom || 1)));
				if (halfH > 0) vs.oz = halfH;
			}
		}
		if (bridgeState.camera && bridgeState.controls) vs.cam = {
			position: worldCameraToData$1([
				bridgeState.camera.position.x,
				bridgeState.camera.position.y,
				bridgeState.camera.position.z
			]),
			target: worldCameraToData$1([
				bridgeState.controls.target.x,
				bridgeState.controls.target.y,
				bridgeState.controls.target.z
			]),
			up: [
				bridgeState.camera.up.x,
				bridgeState.camera.up.y,
				bridgeState.camera.up.z
			]
		};
	}
	return vs;
}
async function applyViewState(vs, opts = {}) {
	if (!vs) return;
	_applying = true;
	try {
		let paLesson = false;
		if (vs.builtin && vs.builtin !== currentBuiltin()) await loadBuiltinScene(vs.builtin);
		else if (vs.scene && vs.scene !== bridgeState.currentSceneSourcePath) await loadSceneFromPath(vs.scene);
		else if (vs.pa && !vs.builtin && !vs.scene && !opts.fromHistory) paLesson = await loadProofAsLesson(vs.pa);
		const lesson = bridgeState.lessonSpec;
		if (lesson && Array.isArray(lesson.scenes)) {
			const maps = sceneMaps(lesson);
			let sceneIdx = vs.sc != null ? resolveIndex(vs.sc, maps.sceneIds) : -1;
			if (sceneIdx < 0 && (vs.sc != null || vs.st != null)) sceneIdx = bridgeState.currentSceneIndex >= 0 ? bridgeState.currentSceneIndex : 0;
			if (sceneIdx >= 0) {
				const stepIds = maps.stepIds[sceneIdx] || [];
				const stepIdx = vs.st != null ? resolveIndex(vs.st, stepIds) : -1;
				navigateTo$1(sceneIdx, stepIdx);
			}
		}
		if (vs.pf != null && Array.isArray(bridgeState.proofSpec) && bridgeState.proofSpec.length) {
			const ids = bridgeState.proofSpec.map((e, i) => proofId(e, i));
			const pIdx = resolveIndex(vs.pf, ids);
			if (pIdx >= 0) {
				const prevLatch = bridgeState._proofSyncInProgress;
				bridgeState._proofSyncInProgress = true;
				try {
					setActiveProof(pIdx);
					const sIds = proofStepIds(bridgeState.proofSpec[pIdx] && bridgeState.proofSpec[pIdx].proof);
					navigateProof$1(vs.ps != null ? resolveIndex(vs.ps, sIds) : -1);
				} finally {
					bridgeState._proofSyncInProgress = prevLatch;
				}
			}
		}
		if (paLesson && Array.isArray(bridgeState.proofSpec) && bridgeState.proofSpec.length) {
			vs.pp = true;
			const prevLatch = bridgeState._proofSyncInProgress;
			bridgeState._proofSyncInProgress = true;
			try {
				setActiveProof(0);
				navigateProof$1(Number.isFinite(vs.pas) ? vs.pas : 0);
			} finally {
				bridgeState._proofSyncInProgress = prevLatch;
			}
		}
		if (vs.sliders) {
			for (const [id, val] of Object.entries(vs.sliders)) if (bridgeState.sceneSliders && bridgeState.sceneSliders[id]) setSliderValue(id, Number(val));
		}
		if (window.__algebenchGraph && window.__algebenchGraph.applyDeeplinkSelection) window.__algebenchGraph.applyDeeplinkSelection(vs.nodes || []);
		const wantGraph = vs.view === "math" || vs.dock === true || Array.isArray(vs.nodes) && vs.nodes.length || !!vs.pa;
		const g = window.__algebenchGraph;
		if (g) {
			if (vs.dock !== void 0 && typeof g.setDocked === "function") try {
				g.setDocked(vs.dock);
			} catch (_) {}
			try {
				if (wantGraph && g.showGraphView) await g.showGraphView();
				else if (g.showSceneView) await g.showSceneView();
			} catch (_) {}
		}
		if (vs.pa && !opts.fromHistory && g && typeof g.dockProofAnimation === "function") {
			const anchorNode = Array.isArray(vs.nodes) && vs.nodes.length ? vs.nodes[vs.nodes.length - 1] : null;
			try {
				await g.dockProofAnimation(vs.pa, anchorNode, vs.pas);
			} catch (_) {}
		}
		if (g && typeof g.openFunctionAnalysis === "function") {
			if (vs.fa || vs.fax) try {
				g.openFunctionAnalysis({
					id: vs.fa || null,
					latex: vs.fax || null
				});
			} catch (_) {}
			else if (typeof g.closeFunctionAnalysis === "function") try {
				g.closeFunctionAnalysis();
			} catch (_) {}
		}
		if (typeof window.switchPanelTab === "function") window.switchPanelTab(vs.panel === "chat" ? "chat" : "doc");
		setProofPanelOpen(!!vs.pp);
		if (vs.aa && !opts.fromHistory && !_autoAskFired) {
			_autoAskFired = true;
			try {
				if (typeof window.switchPanelTab === "function") window.switchPanelTab("chat");
			} catch (_e) {}
			try {
				openChatPanel();
			} catch (_e) {}
			const _ask = String(vs.aa);
			setTimeout(() => {
				try {
					if (typeof window.sendChatMessage === "function") window.sendChatMessage(_ask);
				} catch (_e) {}
			}, 0);
		}
		if (vs.proj || vs.cam) {
			switchProjection(vs.proj === "orthographic" ? "orthographic" : "perspective");
			if (vs.proj === "orthographic" && Number.isFinite(vs.oz) && bridgeState.camera && bridgeState.camera.isOrthographicCamera) {
				const cont = document.getElementById("mathbox-container");
				const aspect = cont ? cont.clientWidth / Math.max(cont.clientHeight, 1) : 1;
				const c = bridgeState.camera;
				c.top = vs.oz;
				c.bottom = -vs.oz;
				c.left = -vs.oz * aspect;
				c.right = vs.oz * aspect;
				c.zoom = 1;
				c.updateProjectionMatrix();
			}
		}
		const cvBtn = vs.cv ? document.querySelector(`.cam-btn[data-view="${vs.cv}"]`) : null;
		const cvDynamic = !!(cvBtn && cvBtn.classList.contains("cam-btn-follow"));
		if (cvBtn && cvDynamic && !cvBtn.classList.contains("active")) cvBtn.click();
		const dynamicCam = bridgeState.followCamState || bridgeState.cameraExprState;
		const camOk = vs.cam && Array.isArray(vs.cam.position) && Array.isArray(vs.cam.target);
		if (camOk && dynamicCam && bridgeState.camera && bridgeState.controls) {
			const wPos = dataCameraToWorld$1(vs.cam.position);
			const wTgt = dataCameraToWorld$1(vs.cam.target);
			const up = Array.isArray(vs.cam.up) ? vs.cam.up.slice(0, 3) : [
				0,
				1,
				0
			];
			const offset = [
				wPos[0] - wTgt[0],
				wPos[1] - wTgt[1],
				wPos[2] - wTgt[2]
			];
			const dom = bridgeState.renderer && bridgeState.renderer.domElement;
			let stop = false, frames = 0, stable = 0, lastKey = null;
			const release = () => {
				stop = true;
				if (dom) {
					dom.removeEventListener("pointerdown", release);
					dom.removeEventListener("wheel", release);
				}
			};
			if (dom) {
				dom.addEventListener("pointerdown", release, { once: true });
				dom.addEventListener("wheel", release, {
					once: true,
					passive: true
				});
			}
			const pin = () => {
				const fc = bridgeState.followCamState;
				if (stop || !fc && !bridgeState.cameraExprState) {
					release();
					return;
				}
				const t = bridgeState.controls.target;
				bridgeState.camera.position.set(t.x + offset[0], t.y + offset[1], t.z + offset[2]);
				bridgeState.camera.up.set(up[0], up[1], up[2]);
				bridgeState.camera.lookAt(t);
				if (fc) fc.lastTargetWorld = t.clone();
				const key = `${t.x.toFixed(4)},${t.y.toFixed(4)},${t.z.toFixed(4)}`;
				stable = key === lastKey ? stable + 1 : 0;
				lastKey = key;
				if (frames >= 30 && stable >= 45 || ++frames > 1800) {
					release();
					return;
				}
				requestAnimationFrame(pin);
			};
			requestAnimationFrame(pin);
		} else if (camOk && !dynamicCam) {
			const wPos = dataCameraToWorld$1(vs.cam.position);
			const wTgt = dataCameraToWorld$1(vs.cam.target);
			const up = Array.isArray(vs.cam.up) ? vs.cam.up.slice(0, 3) : [
				0,
				1,
				0
			];
			bridgeState.CAMERA_VIEWS = bridgeState.CAMERA_VIEWS || {};
			bridgeState.CAMERA_VIEWS["__deeplink"] = {
				position: wPos,
				target: wTgt,
				up
			};
			animateCamera$1("__deeplink", 600);
		}
		if (cvBtn && !cvDynamic) {
			if (camOk) {
				document.querySelectorAll(".cam-btn").forEach((b) => b.classList.remove("active"));
				cvBtn.classList.add("active");
			} else cvBtn.click();
		}
	} finally {
		_applying = false;
		if (_pushTimer) {
			clearTimeout(_pushTimer);
			_pushTimer = null;
		}
		if (!opts.fromHistory) try {
			replaceView(vs);
		} catch (_) {}
	}
}
var _sliderTimer = null;
var _pushTimer = null;
function setupViewSync() {
	const schedulePush = () => {
		if (isApplyingViewState()) return;
		if (_pushTimer) return;
		_pushTimer = setTimeout(() => {
			_pushTimer = null;
			if (!isApplyingViewState()) pushView(captureViewState());
		}, 0);
	};
	const replace = () => {
		if (!isApplyingViewState()) replaceView(captureViewState());
	};
	window.addEventListener("algebench:navchange", schedulePush);
	window.addEventListener("algebench:fachange", (e) => {
		if (e && e.detail && e.detail.replace) replace();
		else schedulePush();
	});
	window.addEventListener("algebench:proofchange", schedulePush);
	window.addEventListener("algebench:selectionchange", schedulePush);
	window.addEventListener("algebench:viewchange", schedulePush);
	window.addEventListener("algebench:panelchange", schedulePush);
	window.addEventListener("algebench:sliderchange", () => {
		if (isApplyingViewState()) return;
		if (_sliderTimer) clearTimeout(_sliderTimer);
		_sliderTimer = setTimeout(replace, 300);
	});
}
/**
* Wire the "Copy link" button. This is the ONLY path that pins the camera into
* the URL — capturing the exact viewport so a recipient lands on the same view.
*/
function setupShareButton() {
	const btn = document.getElementById("nav-share");
	if (!btn) return;
	btn.innerHTML = SHARE_VIEW_ICON;
	let toast = null;
	let toastTimer = null;
	function flashToast(message) {
		if (!toast) {
			toast = document.createElement("div");
			toast.id = "share-copied-toast";
			(btn.parentElement || document.body).appendChild(toast);
		}
		toast.textContent = message;
		toast.classList.remove("show");
		toast.offsetWidth;
		toast.classList.add("show");
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => toast.classList.remove("show"), 3e3);
	}
	async function copyText(text) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch (_) {
			try {
				const ta = document.createElement("textarea");
				ta.value = text;
				ta.style.position = "fixed";
				ta.style.top = "-1000px";
				ta.style.opacity = "0";
				document.body.appendChild(ta);
				ta.focus();
				ta.select();
				const ok = document.execCommand("copy");
				document.body.removeChild(ta);
				return ok;
			} catch (_) {
				return false;
			}
		}
	}
	btn.addEventListener("click", async (e) => {
		e.stopPropagation();
		replaceView(captureViewState({ includeCamera: true }));
		if (await copyText(window.location.href)) {
			btn.classList.add("copied");
			const prevTitle = btn.title;
			btn.title = "Shareable link copied";
			flashToast("Shareable link to this camera view copied — you can now share it with others");
			setTimeout(() => {
				btn.classList.remove("copied");
				btn.title = prevTitle;
			}, 3e3);
		} else flashToast("Couldn’t copy automatically — the shareable link is in your address bar");
	});
}
//#endregion
//#region src/object-picker.ts
var PICK_PX = 20;
var HIDE_DELAY = 600;
var MAX_NEIGHBORS = 12;
var _raycaster = null;
var _canvas = null;
var _btn = null;
var _hideTimer = null;
var _hoveredId = null;
var _rafPending = false;
var _lastEvt = null;
var _trackRaf = null;
var _hoverPoint = null;
var _hoverLabelEl = null;
/** Build a `Map<THREE.Mesh, elementId>` by walking the per-element trackers.
*  Cheap enough to rebuild on demand (a scene holds few registered elements),
*  and always current with the live registry — no invalidation bookkeeping. */
function buildMeshIdMap() {
	const map = /* @__PURE__ */ new Map();
	for (const [id, reg] of Object.entries(state.elementRegistry)) {
		if (!reg || reg.hidden || !reg.tracker) continue;
		const t = reg.tracker;
		for (const e of t.arrowMeshes || []) if (e && e.mesh) map.set(e.mesh, id);
		for (const m of t.planeMeshes || []) if (m) map.set(m, id);
	}
	return map;
}
/** All currently-visible, raycastable meshes across every registered element. */
function pickableMeshes() {
	const meshes = [];
	for (const e of state.arrowMeshes) if (e && e.mesh && e.mesh.visible) meshes.push(e.mesh);
	for (const m of state.planeMeshes) if (m && m.visible) meshes.push(m);
	return meshes;
}
function isHidden(id) {
	const reg = state.elementRegistry[id];
	return !reg || reg.hidden || state.legendToggledOff.has(id);
}
var STRUCTURAL_TYPES = /* @__PURE__ */ new Set([
	"axis",
	"grid",
	"skybox"
]);
/** Pickable if the author opted in with a `prompt`, or it's a content object that
*  renders a label — static (`reg.label`) or dynamic (a live label entry on its
*  tracker, e.g. an animated point's `labelExpr` "6.3 km/s"). */
function isPickable(id) {
	const reg = state.elementRegistry[id];
	if (!reg || isHidden(id)) return false;
	if (reg.prompt) return true;
	if (STRUCTURAL_TYPES.has(reg.type)) return false;
	if (reg.label) return true;
	const t = reg.tracker;
	return !!(t && t.labels && t.labels.length);
}
/** A representative world-space anchor for an element, tried in order:
*  live animated position → its label → a mesh centroid/tip → a line anchor. */
function worldAnchor(id, reg) {
	const t = reg && reg.tracker || {};
	const ap = state.animatedElementPos[id];
	if (ap && ap.pos) return new THREE.Vector3(...dataToWorld(ap.pos));
	if (t.labels && t.labels.length && t.labels[0].dataPos) return new THREE.Vector3(...dataToWorld(t.labels[0].dataPos));
	for (const e of t.arrowMeshes || []) if (e && e.tipWorld) return e.tipWorld.clone();
	for (const m of t.planeMeshes || []) {
		if (!m) continue;
		const c = new THREE.Vector3();
		const box = new THREE.Box3().setFromObject(m);
		if (!box.isEmpty()) {
			box.getCenter(c);
			return c;
		}
	}
	for (const e of t.lineNodes || []) if (e && e.anchorDataPos) return new THREE.Vector3(...dataToWorld(e.anchorDataPos));
	return null;
}
/** Project a world point to canvas-local pixels. Returns null if behind camera. */
function projectToScreen(world, rect) {
	const v = world.clone().project(state.camera);
	if (v.z >= 1) return null;
	return {
		x: (v.x * .5 + .5) * rect.width,
		y: (-v.y * .5 + .5) * rect.height,
		ndc: v,
		onScreen: v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1
	};
}
/** Is the cursor over a pickable object's label element? Labels are
*  `pointer-events:none`, so the canvas still gets the move and we test their
*  bounding boxes directly — this catches hovering the text/name tag itself
*  (e.g. anywhere along "Orion"), which a point-anchor proximity test misses. */
function labelHitTest(clientX, clientY) {
	for (const [id, reg] of Object.entries(state.elementRegistry)) {
		if (!isPickable(id)) continue;
		const t = reg.tracker;
		if (!t || !t.labels) continue;
		for (const lbl of t.labels) {
			if (!lbl.el || lbl.visible === false || lbl.forceHidden) continue;
			const br = lbl.el.getBoundingClientRect();
			if (!br.width && !br.height) continue;
			if (clientX >= br.left && clientX <= br.right && clientY >= br.top && clientY <= br.bottom) return {
				id,
				el: lbl.el
			};
		}
	}
	return null;
}
/** Resolve the element under a client-space point: raycast first, then fall back
*  to the nearest projected anchor within PICK_PX. Returns `{ id, point }` (point
*  = the world hit location for a raycast hit, so the button can appear right
*  where the user hovered rather than at a possibly-distant label; null for a
*  screen-anchor fallback) or null if nothing is under the cursor. */
function pickAt(clientX, clientY) {
	if (!state.camera || !_canvas) return null;
	const rect = _canvas.getBoundingClientRect();
	if (!rect.width || !rect.height) return null;
	const localX = clientX - rect.left;
	const localY = clientY - rect.top;
	const lh = labelHitTest(clientX, clientY);
	if (lh) return {
		id: lh.id,
		point: null,
		labelEl: lh.el
	};
	const ndc = {
		x: localX / rect.width * 2 - 1,
		y: -(localY / rect.height * 2 - 1)
	};
	_raycaster.setFromCamera(ndc, state.camera);
	const hits = _raycaster.intersectObjects(pickableMeshes(), false);
	if (hits.length) {
		const map = buildMeshIdMap();
		for (const h of hits) {
			const id = map.get(h.object);
			if (id && isPickable(id)) return {
				id,
				point: h.point.clone(),
				labelEl: null
			};
		}
	}
	let best = null, bestD = PICK_PX;
	for (const [id, reg] of Object.entries(state.elementRegistry)) {
		if (!isPickable(id)) continue;
		const anchor = worldAnchor(id, reg);
		if (!anchor) continue;
		const p = projectToScreen(anchor, rect);
		if (!p) continue;
		const d = Math.hypot(p.x - localX, p.y - localY);
		if (d < bestD) {
			bestD = d;
			best = id;
		}
	}
	return best ? {
		id: best,
		point: null,
		labelEl: null
	} : null;
}
function ensureBtn() {
	if (_btn) return _btn;
	const btn = makeAiAskButton("ai-ask-btn object-ai-btn", "Ask AI about this object", () => buildObjectAskMessage(_hoveredId));
	btn.style.position = "fixed";
	btn.style.margin = "0";
	btn.style.opacity = "0";
	btn.style.pointerEvents = "none";
	btn.style.zIndex = "950";
	btn.addEventListener("mouseenter", () => {
		if (_hideTimer) {
			clearTimeout(_hideTimer);
			_hideTimer = null;
		}
	});
	btn.addEventListener("mouseleave", () => hideBtn());
	document.body.appendChild(btn);
	_btn = btn;
	return btn;
}
/** Place the button next to where the user actually hovered on the object — the
*  raycast hit point (`_hoverPoint`) — so it stays snug to the geometry even when
*  the object's label is offset far away (e.g. a vector whose "Orion" tag sits
*  across the view). Falls back to the object's own anchor (label/point) for
*  screen-anchor picks that have no hit point. Returns false if not visible. */
function positionBtn(id, rect) {
	const reg = state.elementRegistry[id];
	if (!reg || isHidden(id)) return false;
	if (_hoverLabelEl) {
		const br = _hoverLabelEl.getBoundingClientRect();
		if (br.width || br.height) {
			const btn = ensureBtn();
			btn.style.left = br.right - 6 + "px";
			btn.style.top = br.top - 16 + "px";
			return true;
		}
	}
	const world = _hoverPoint || worldAnchor(id, reg);
	const p = world && projectToScreen(world, rect);
	if (!p) return false;
	const btn = ensureBtn();
	btn.style.left = rect.left + p.x + 10 + "px";
	btn.style.top = rect.top + p.y - 26 + "px";
	return true;
}
function showBtnFor(hit) {
	if (!_canvas) return;
	const id = hit.id;
	if (id !== _hoveredId) {
		_hoverPoint = hit.point || null;
		_hoverLabelEl = hit.labelEl || null;
	}
	if (!positionBtn(id, _canvas.getBoundingClientRect())) {
		hideBtn();
		return;
	}
	const btn = ensureBtn();
	if (_hideTimer) {
		clearTimeout(_hideTimer);
		_hideTimer = null;
	}
	_hoveredId = id;
	btn.style.opacity = "1";
	btn.style.pointerEvents = "auto";
	startTrack();
}
function retrack() {
	_trackRaf = null;
	if (!_btn || _btn.style.opacity === "0" || !_hoveredId) return;
	const rect = _canvas.getBoundingClientRect();
	if (!positionBtn(_hoveredId, rect)) {
		hideBtn();
		return;
	}
	_trackRaf = requestAnimationFrame(retrack);
}
function startTrack() {
	if (_trackRaf == null) _trackRaf = requestAnimationFrame(retrack);
}
function hideBtn() {
	if (!_btn) return;
	if (_hideTimer) {
		clearTimeout(_hideTimer);
		_hideTimer = null;
	}
	const btn = _btn;
	_hideTimer = setTimeout(() => {
		btn.style.opacity = "0";
		btn.style.pointerEvents = "none";
		_hoveredId = null;
		_hoverPoint = null;
		_hoverLabelEl = null;
	}, HIDE_DELAY);
}
/** Hide the button right away (no grace delay) — used while dragging/orbiting so
*  it never lingers over the scene mid-gesture. */
function hideBtnNow() {
	if (_hideTimer) {
		clearTimeout(_hideTimer);
		_hideTimer = null;
	}
	if (!_btn) return;
	_btn.style.opacity = "0";
	_btn.style.pointerEvents = "none";
	_hoveredId = null;
	_hoverPoint = null;
	_hoverLabelEl = null;
}
function viewportLabel(ndc) {
	const col = ndc.x < -.33 ? "left" : ndc.x > .33 ? "right" : "center";
	const row = ndc.y > .33 ? "upper" : ndc.y < -.33 ? "lower" : "middle";
	if (row === "middle" && col === "center") return "the center of the frame";
	if (col === "center") return `the ${row} middle`;
	if (row === "middle") return `the ${col} side`;
	return `the ${row}-${col}`;
}
/** Clean text for a live label entry: the raw dynamic string if the renderer kept
*  one (`_lastDynamicText`), else the DOM text with each KaTeX span collapsed back
*  to its `$…$` source (plain textContent triples the math and reads as garbage). */
function liveLabelText(lbl) {
	if (!lbl) return null;
	if (lbl._lastDynamicText) return String(lbl._lastDynamicText).trim() || null;
	if (!lbl.el) return null;
	const clone = lbl.el.cloneNode(true);
	clone.querySelectorAll(".katex").forEach((k) => {
		const ann = k.querySelector("annotation[encoding=\"application/x-tex\"]");
		k.replaceWith(ann ? `$${ann.textContent.trim()}$` : k.textContent || "");
	});
	return (clone.textContent || "").trim().replace(/\s+/g, " ") || null;
}
function elementName(id, reg) {
	if (reg && reg.label) return reg.label;
	const t = reg && reg.tracker;
	if (t && t.labels && t.labels.length) {
		const name = liveLabelText(t.labels[0]);
		if (name) return name;
	}
	if (id && !id.startsWith("__auto_")) return id;
	return reg && reg.type || id;
}
/** Approximate on-screen extent (px) of an element's meshes, or null. */
function screenExtentPx(reg, rect) {
	const t = reg && reg.tracker || {};
	const meshes = [];
	for (const e of t.arrowMeshes || []) if (e && e.mesh) meshes.push(e.mesh);
	for (const m of t.planeMeshes || []) if (m) meshes.push(m);
	if (!meshes.length) return null;
	const box = new THREE.Box3();
	for (const m of meshes) box.expandByObject(m);
	if (box.isEmpty()) return null;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, anyFront = false;
	const c = box.min, d = box.max;
	for (let i = 0; i < 8; i++) {
		const p = projectToScreen(new THREE.Vector3(i & 1 ? d.x : c.x, i & 2 ? d.y : c.y, i & 4 ? d.z : c.z), rect);
		if (!p) continue;
		anyFront = true;
		minX = Math.min(minX, p.x);
		maxX = Math.max(maxX, p.x);
		minY = Math.min(minY, p.y);
		maxY = Math.max(maxY, p.y);
	}
	if (!anyFront) return null;
	return {
		w: maxX - minX,
		h: maxY - minY
	};
}
function sizeWord(extent, rect) {
	if (!extent) return null;
	const frac = Math.max(extent.w, extent.h) / Math.min(rect.width, rect.height);
	if (frac > .6) return "large — it fills much of the view";
	if (frac > .25) return "medium-sized in the view";
	return "small in the view";
}
/** What (if anything) occludes `anchor` along the camera ray. Returns null (not
*  occluded), `{ name }` for a resolved element, or `{ generic: true }` when a
*  closer mesh can't be mapped back to an element id (still a real occluder). */
function occluderOf(id, anchor) {
	const origin = state.camera.position;
	const dir = anchor.clone().sub(origin).normalize();
	_raycaster.set(origin, dir);
	const hits = _raycaster.intersectObjects(pickableMeshes(), false);
	if (!hits.length) return null;
	const map = buildMeshIdMap();
	const distToAnchor = origin.distanceTo(anchor);
	for (const h of hits) {
		if (h.distance >= distToAnchor - .05) break;
		const hid = map.get(h.object);
		if (hid === id) return null;
		if (hid && isHidden(hid)) continue;
		return hid ? { name: elementName(hid, state.elementRegistry[hid]) } : { generic: true };
	}
	return null;
}
/** Snapshot every visible element's viewport geometry (for the target + layout). */
function collectVisible(rect) {
	const out = [];
	for (const [id, reg] of Object.entries(state.elementRegistry)) {
		if (isHidden(id)) continue;
		const anchor = worldAnchor(id, reg);
		if (!anchor) continue;
		const p = projectToScreen(anchor, rect);
		out.push({
			id,
			reg,
			anchor,
			name: elementName(id, reg),
			type: reg.type || "object",
			screen: p,
			depth: state.camera.position.distanceTo(anchor)
		});
	}
	out.sort((a, b) => a.depth - b.depth);
	return out;
}
function depthPhrase(rank, total) {
	if (total <= 1) return null;
	if (rank === 0) return "nearest the camera";
	if (rank === total - 1) return "the farthest object from the camera";
	return `at mid-depth (${rank + 1} of ${total} front-to-back)`;
}
/** The deterministic, camera-relative context block for the clicked object —
*  attached to the author's prompt so the model knows what is actually on screen. */
function buildViewContext(id, reg) {
	if (!_canvas) return "";
	const rect = _canvas.getBoundingClientRect();
	const visible = collectVisible(rect);
	const idx = visible.findIndex((v) => v.id === id);
	const me = idx >= 0 ? visible[idx] : null;
	const name = elementName(id, reg);
	const type = reg.type || "object";
	const lines = [];
	lines.push("[Context — I clicked this object in the 3D view. From my current camera view:]");
	const facts = [`the object "${name}" (type \`${type}\`)`];
	if (me && me.screen) {
		facts.push(`appears at ${viewportLabel(me.screen.ndc)}`);
		const xPct = Math.round((me.screen.ndc.x * .5 + .5) * 100);
		const yPct = Math.round((1 - (me.screen.ndc.y * .5 + .5)) * 100);
		facts.push(`~${xPct}% from the left and ~${yPct}% from the top`);
		if (!me.screen.onScreen) facts.push("currently off the visible frame");
	} else facts.push("is currently behind the camera / not visible in this view");
	const dp = me ? depthPhrase(idx, visible.length) : null;
	if (dp) facts.push(dp);
	const sw = sizeWord(screenExtentPx(reg, rect), rect);
	if (sw) facts.push(sw);
	if (me) {
		const occ = occluderOf(id, me.anchor);
		if (occ) facts.push(occ.generic ? "partially behind another object" : `partially behind "${occ.name}"`);
	}
	lines.push("- " + facts.join(", ") + ".");
	const others = visible.filter((v) => v.id !== id && v.screen && v.screen.onScreen).slice(0, MAX_NEIGHBORS);
	if (others.length) {
		lines.push("Other objects currently in view (nearest first):");
		for (const o of others) lines.push(`- "${o.name}" (${o.type}) — ${viewportLabel(o.screen.ndc)}`);
	}
	lines.push("Ground your answer in what I am actually looking at from this viewpoint.");
	return lines.join("\n");
}
/** Default ask for a labeled object with no author `prompt` — generated at click
*  time from the label, never written back to the scene JSON. */
function autoPromptFor(id, reg) {
	return `Explain what ${elementName(id, reg)} represents here and how it relates to the other objects in this scene.`;
}
/** The message sent on click: the author's per-object `prompt` if set, otherwise
*  an auto-generated ask from the label — with the camera-relative view context
*  appended. */
function buildObjectAskMessage(id) {
	const reg = id && state.elementRegistry[id];
	if (!reg) return "Explain this object in the 3D scene.";
	const ask = (reg.prompt || "").trim() || autoPromptFor(id, reg);
	const ctx = buildViewContext(id, reg);
	return ctx ? `${ask}\n\n${ctx}` : ask;
}
function onPointerMove(e) {
	if (e.buttons !== 0) {
		hideBtnNow();
		return;
	}
	_lastEvt = e;
	if (_rafPending) return;
	_rafPending = true;
	requestAnimationFrame(() => {
		_rafPending = false;
		const ev = _lastEvt;
		if (!ev) return;
		const hit = pickAt(ev.clientX, ev.clientY);
		if (hit) showBtnFor(hit);
		else hideBtn();
	});
}
function setupObjectPicker() {
	if (!state.renderer || !state.renderer.domElement) return;
	_canvas = state.renderer.domElement;
	_raycaster = new THREE.Raycaster();
	_canvas.addEventListener("pointermove", onPointerMove, { passive: true });
	_canvas.addEventListener("pointerleave", () => hideBtn(), { passive: true });
	_canvas.addEventListener("pointerdown", () => hideBtnNow(), { passive: true });
}
//#endregion
//#region src/main.ts
window.algebenchIcons = {
	ai: AI_ICON,
	user: USER_ICON
};
window.AlgeBenchDomains = window.AlgeBenchDomains || {
	_registry: {},
	register(name, functions) {
		this._registry[name] = functions;
		console.log(`[domains] registered: ${name} (${Object.keys(functions).join(", ")})`);
	}
};
document.addEventListener("DOMContentLoaded", async () => {
	applyTheme(initialTheme());
	wireThemeToggle(document.getElementById("btn-theme"), { onChange: () => applyCanvasClearColor() });
	initMathBox();
	setupObjectPicker();
	setupRollDrag(document.getElementById("mathbox-container"));
	setupTrackpadPan();
	setupDragDrop();
	setupFilePicker();
	setupScenesDropdown();
	setupVideoExportControls();
	setupSettingsPanel();
	initLightControls();
	setupProjectionToggle();
	setupPanelResize();
	setupExplainToggle();
	setupFollowAngleLockToggle();
	setupDocSpeakButtons();
	setupProofPanel();
	setupSceneDock();
	setupCaptionDrag();
	setupSceneDescDrag();
	setupJsonViewer();
	setupContextStatusPopup();
	setupCamStatusPopup();
	setupAboutPopup();
	setupViewSync();
	setupShareButton();
	setupPopstateListener(applyViewState);
	loadBuiltinScenesList();
	await loadInitialSceneFromQuery();
});
window.renderMarkdown = renderMarkdown$1;
window.renderKaTeX = renderKaTeX$1;
window.navigateTo = navigateTo$1;
window.animateCamera = animateCamera$1;
window.buildSceneTree = buildSceneTree$1;
window.addInfoOverlay = addInfoOverlay$1;
window.removeAllInfoOverlays = removeAllInfoOverlays$1;
window.updateInfoOverlays = updateInfoOverlays$1;
window.getAllElements = getAllElements$1;
window.loadLesson = loadLesson;
window.loadScene = loadScene;
window.isLessonFormat = isLessonFormat;
window.updateDockVisibility = updateDockVisibility$1;
window.animateSlider = animateSlider$1;
window.dataCameraToWorld = dataCameraToWorld$1;
window.worldCameraToData = worldCameraToData$1;
window.captureViewState = captureViewState;
window.applyViewState = applyViewState;
window.navigateProof = navigateProof$1;
window.loadProof = loadProof;
window.getProofContext = getProofContext$1;
window.refreshProofPanel = refreshProofPanel$1;
Object.defineProperties(window, {
	lessonSpec: {
		get() {
			return state.lessonSpec;
		},
		set(v) {
			state.lessonSpec = v;
		},
		configurable: true
	},
	currentSpec: {
		get() {
			return state.currentSpec;
		},
		set(v) {
			state.currentSpec = v;
		},
		configurable: true
	},
	currentSceneIndex: {
		get() {
			return state.currentSceneIndex;
		},
		set(v) {
			state.currentSceneIndex = v;
		},
		configurable: true
	},
	currentStepIndex: {
		get() {
			return state.currentStepIndex;
		},
		set(v) {
			state.currentStepIndex = v;
		},
		configurable: true
	},
	sceneSliders: {
		get() {
			return state.sceneSliders;
		},
		set(v) {
			state.sceneSliders = v;
		},
		configurable: true
	},
	CAMERA_VIEWS: {
		get() {
			return state.CAMERA_VIEWS;
		},
		set(v) {
			state.CAMERA_VIEWS = v;
		},
		configurable: true
	},
	camera: {
		get() {
			return state.camera;
		},
		configurable: true
	},
	controls: {
		get() {
			return state.controls;
		},
		configurable: true
	},
	currentProjection: {
		get() {
			return state.currentProjection;
		},
		set(v) {
			state.currentProjection = v;
		},
		configurable: true
	},
	elementRegistry: {
		get() {
			return state.elementRegistry;
		},
		configurable: true
	},
	proofStepIndex: {
		get() {
			return state.proofStepIndex;
		},
		set(v) {
			state.proofStepIndex = v;
		},
		configurable: true
	}
});
//#endregion
//#region src/graph-panel/term-resolve.ts
var NOISE_COMMANDS = /* @__PURE__ */ new Set([
	"left",
	"right",
	"cdot",
	"limits",
	"displaystyle",
	"mathrm",
	"operatorname",
	"big",
	"bigl",
	"bigr",
	"bigg",
	"biggl",
	"biggr",
	"quad",
	"qquad"
]);
var GLYPH_TOKENS = {
	"π": "pi",
	"σ": "sigma",
	"μ": "mu",
	"θ": "theta",
	"λ": "lambda",
	"α": "alpha",
	"β": "beta",
	"γ": "gamma",
	"δ": "delta",
	"ε": "epsilon",
	"ρ": "rho",
	"τ": "tau",
	"φ": "phi",
	"ω": "omega",
	"Δ": "delta",
	"Ω": "omega",
	"Γ": "gamma",
	"√": "sqrt",
	"∞": "infty",
	"∫": "int",
	"ℏ": "hbar",
	"∂": "partial",
	"⁰": "0",
	"¹": "1",
	"²": "2",
	"³": "3",
	"⁴": "4",
	"⁵": "5",
	"⁶": "6",
	"⁷": "7",
	"⁸": "8",
	"⁹": "9",
	"₀": "0",
	"₁": "1",
	"₂": "2",
	"₃": "3",
	"₄": "4",
	"₅": "5",
	"₆": "6",
	"₇": "7",
	"₈": "8",
	"₉": "9"
};
/**
* Reduce a rendered term text OR a node's latex/subexpr to a sorted token
* skeleton. Order-insensitive by design: a node's `subexpr` carries sympy's
* canonical ordering (`\sqrt{\pi} \sigma C \sqrt{2}`) while the term renders
* in display order (`C·√2·σ·√π`) — same content, different order, so the
* skeleton compares the token MULTISET, not the sequence.
*/
function apprSkeleton(s) {
	if (!s) return "";
	const tokens = [];
	const str = String(s);
	const cmdRe = /\\([a-zA-Z]+)/g;
	let m;
	while ((m = cmdRe.exec(str)) !== null) {
		const name = m[1].toLowerCase();
		if (!NOISE_COMMANDS.has(name)) tokens.push(name);
	}
	for (const ch of str.replace(/\\[a-zA-Z]+/g, "")) if (/[a-zA-Z0-9]/.test(ch)) tokens.push(ch.toLowerCase());
	else if (ch === "-" || ch === "−") tokens.push("-");
	else if (GLYPH_TOKENS[ch]) tokens.push(GLYPH_TOKENS[ch]);
	return tokens.sort().join(" ");
}
/** Does this graph node's stored content look like the term's rendered text? */
function contentAgrees(node, termText) {
	const want = apprSkeleton(termText);
	if (!want) return false;
	return apprSkeleton(node && node.subexpr) === want || apprSkeleton(node && node.latex) === want || apprSkeleton(node && node.label) === want;
}
/**
* Resolve a proof-animation term id (its `data-n`) + rendered text to a node
* id in `graph`, or null if the term has no selectable node there.
*
* Ladder: exact/affix-stripped id (named ids trusted as-is; structural ids
* only when the node's content agrees with the term's rendered text — see the
* module docstring for why); then the canonical symbol (occurrence suffix
* `__<parent>` stripped) against node ids' own canonical symbols; then a loose
* label/latex match on the rendered glyph text.
*/
function resolveTermId(graph, termId, termText) {
	if (!termId || !graph || !Array.isArray(graph.nodes)) return null;
	const nodes = graph.nodes;
	const byId = (id) => nodes.find((n) => n.id === id) || null;
	const noGlyph = termId.replace(/__(?:op\d*|exp|one|m\d+)$/, "");
	const cands = [
		termId,
		noGlyph,
		noGlyph.replace(/^_r\d+_/, "")
	];
	for (const c of cands) {
		const n = byId(c);
		if (!n) continue;
		if (!c.startsWith("__")) return c;
		if (contentAgrees(n, termText)) return c;
	}
	const base = termId.split("__")[0];
	if (base) {
		if (byId(base)) return base;
		const m = nodes.find((n) => n.id.split("__")[0] === base);
		if (m) return m.id;
	}
	const t = (termText || "").trim();
	if (t) {
		const norm = (s) => (s || "").replace(/\\cdot|\\[a-zA-Z]+|[{}\\$\s^*·]/g, "").trim();
		const nt = norm(t);
		if (nt && !/^[\d.,/]+$/.test(nt)) {
			const m = nodes.find((n) => norm(n.subexpr) === nt || norm(n.latex) === nt || norm(n.label) === nt) || nodes.find((n) => contentAgrees(n, t));
			if (m) return m.id;
		}
	}
	return null;
}
//#endregion
//#region src/graph-panel/d3-semantic-graph.ts
/**
* D3SemanticGraphRenderer — renders a semantic graph model directly with D3.
*
* Consumes the flat {nodes, edges} semantic graph model and uses dagre for
* DAG layout (shared nodes appear once with multiple edges). Renders with
* D3 keyed joins (enter/update/exit), supporting collapse/expand, KaTeX
* labels via foreignObject, and edge-semantic coloring.
*
* This renderer does NOT touch the Mermaid path — it exists as an alternative.
*/
var D3_CDN_URL = "https://cdn.jsdelivr.net/npm/d3@7/+esm";
var DAGRE_CDN_URL = "https://cdn.jsdelivr.net/npm/@dagrejs/dagre@1.1.4/dist/dagre.min.js";
var UI_BTN_SIZE = 18;
var UI_BTN_MAX_SCALE = 6;
var SUPERSCRIPT_MAP = {
	"0": "⁰",
	"1": "¹",
	"2": "²",
	"3": "³",
	"4": "⁴",
	"5": "⁵",
	"6": "⁶",
	"7": "⁷",
	"8": "⁸",
	"9": "⁹",
	"+": "⁺",
	"-": "⁻",
	"−": "⁻",
	"n": "ⁿ",
	"i": "ⁱ"
};
function toSuperscript(s) {
	return String(s).split("").map((c) => SUPERSCRIPT_MAP[c] || c).join("");
}
var _d3 = null;
var _d3LoadPromise = null;
function loadD3() {
	if (_d3) return Promise.resolve(_d3);
	if (_d3LoadPromise) return _d3LoadPromise;
	_d3LoadPromise = __vitePreload(() => import(D3_CDN_URL).then((mod) => {
		_d3 = mod;
		return mod;
	}), []);
	_d3LoadPromise.catch(() => {
		_d3LoadPromise = null;
	});
	return _d3LoadPromise;
}
var _dagre = null;
var _dagreLoadPromise = null;
function loadDagre() {
	if (_dagre) return Promise.resolve(_dagre);
	if (_dagreLoadPromise) return _dagreLoadPromise;
	_dagreLoadPromise = new Promise((resolve, reject) => {
		if (typeof window !== "undefined" && window.dagre) {
			_dagre = window.dagre;
			resolve(_dagre);
			return;
		}
		const script = document.createElement("script");
		script.src = DAGRE_CDN_URL;
		script.onload = () => {
			_dagre = window.dagre;
			resolve(_dagre);
		};
		script.onerror = reject;
		document.head.appendChild(script);
	});
	_dagreLoadPromise.catch(() => {
		_dagreLoadPromise = null;
	});
	return _dagreLoadPromise;
}
var DEFAULT_EDGE_COLORS = {
	direct: "#e74c3c",
	inverse: "#5b8fc7",
	neutral: "#7e8aa3"
};
var EDGE_SEMANTIC_LABELS$1 = [
	["direct", "Proportional"],
	["inverse", "Inversely proportional"],
	["neutral", "Structural"]
];
var DEFAULT_EDGE_WIDTHS = {
	direct: 2.5,
	inverse: 1.8,
	neutral: 1.4
};
var DEFAULT_NODE_STYLES = {
	scalar: {
		fill: "#1b3a1e",
		stroke: "#66bb6a",
		color: "#c8e6c9"
	},
	vector: {
		fill: "#1b3a1e",
		stroke: "#66bb6a",
		color: "#c8e6c9"
	},
	constant: {
		fill: "#1b3a1e",
		stroke: "#66bb6a",
		color: "#c8e6c9"
	},
	number: {
		fill: "#1b3a1e",
		stroke: "#66bb6a",
		color: "#c8e6c9"
	},
	relation: {
		fill: "#2e1b33",
		stroke: "#ab47bc",
		color: "#e1bee7"
	},
	expression: {
		fill: "#1b3a1e",
		stroke: "#66bb6a",
		color: "#c8e6c9"
	},
	text: {
		fill: "#1b3a1e",
		stroke: "#66bb6a",
		color: "#c8e6c9"
	},
	annotation: {
		fill: "#2a2518",
		stroke: "#8d6e63",
		color: "#d7ccc8"
	}
};
var DEFAULT_NODE_STYLES_LIGHT = {
	scalar: {
		fill: "#e8f2e9",
		stroke: "#4c8a52",
		color: "#26492a"
	},
	vector: {
		fill: "#e8f2e9",
		stroke: "#4c8a52",
		color: "#26492a"
	},
	constant: {
		fill: "#e8f2e9",
		stroke: "#4c8a52",
		color: "#26492a"
	},
	number: {
		fill: "#e8f2e9",
		stroke: "#4c8a52",
		color: "#26492a"
	},
	relation: {
		fill: "#f1e7f3",
		stroke: "#8e4a9e",
		color: "#4c2456"
	},
	expression: {
		fill: "#e8f2e9",
		stroke: "#4c8a52",
		color: "#26492a"
	},
	text: {
		fill: "#e8f2e9",
		stroke: "#4c8a52",
		color: "#26492a"
	},
	annotation: {
		fill: "#f2ede6",
		stroke: "#7d675e",
		color: "#43352e"
	}
};
var _themeCache = Object.create(null);
async function fetchTheme(name) {
	if (_themeCache[name]) return _themeCache[name];
	try {
		const res = await fetch(`/api/graph/theme/${encodeURIComponent(name)}`);
		if (!res.ok) return null;
		const theme = await res.json();
		_themeCache[name] = theme;
		return theme;
	} catch {
		return null;
	}
}
function inferEdgeSemantic(edge, nodeById) {
	if (edge.semantic) return edge.semantic;
	const src = nodeById[edge.from];
	const dst = nodeById[edge.to];
	if (src && src.op === "power") {
		const raw = src.exponent;
		const n = parseFloat(raw);
		if (Number.isFinite(n)) {
			if (n < 0) return "inverse";
			if (Math.abs(n) > 1) return "direct";
		} else if (typeof raw === "string" && raw.trimStart().startsWith("-")) return "inverse";
	}
	if (dst && dst.op === "multiply") return "direct";
	return "neutral";
}
var OPERATOR_GLYPHS = {
	equals: "=",
	congruent: "≡",
	divides: "∣",
	asymptotic: "∼",
	approximately: "≈",
	proportional: "∝",
	maps_to: "→",
	greater_than: ">",
	less_than: "<",
	greater_equal: "≥",
	less_equal: "≤",
	not_equal: "≠",
	multiply: "×",
	add: "+",
	subtract: "−",
	divide: "÷",
	integral: "∫",
	closed_integral: "∮",
	implies: "⇒",
	iff: "⇔",
	negation: "−",
	neg: "¬(·)",
	not: "¬",
	logical_not: "¬",
	forall: "∀(·)",
	exists: "∃(·)",
	conjunction: "∧",
	disjunction: "∨",
	intersection: "∩",
	union: "∪",
	set_difference: "∖",
	sum: "∑",
	product: "∏",
	limit: "lim",
	factorial: "(·)!",
	sqrt: "√(·)",
	log: "log(·)",
	logarithm: "log(·)",
	exp: "exp(·)",
	sin: "sin(·)",
	cos: "cos(·)",
	tan: "tan(·)",
	Abs: "|·|",
	abs: "|·|",
	function: "f(·)"
};
var OPERATOR_LATEX = {
	equals: "=",
	congruent: "\\equiv",
	divides: "\\mid",
	asymptotic: "\\sim",
	approximately: "\\approx",
	proportional: "\\propto",
	maps_to: "\\to",
	greater_than: ">",
	less_than: "<",
	greater_equal: "\\geq",
	less_equal: "\\leq",
	not_equal: "\\neq",
	element_of: "\\in",
	not_element_of: "\\notin",
	multiply: "\\times",
	add: "+",
	subtract: "-",
	divide: "\\div",
	integral: "\\int",
	closed_integral: "\\oint",
	tends_to: "\\to",
	implies: "\\Rightarrow",
	iff: "\\Leftrightarrow",
	negation: "-",
	neg: "\\lnot(\\cdot)",
	not: "\\lnot",
	logical_not: "\\lnot",
	forall: "\\forall(\\cdot)",
	exists: "\\exists(\\cdot)",
	conjunction: "\\land",
	disjunction: "\\lor",
	intersection: "\\cap",
	union: "\\cup",
	set_difference: "\\setminus",
	sum: "\\sum",
	product: "\\prod",
	limit: "\\lim",
	factorial: "(\\cdot)!",
	sqrt: "\\sqrt{\\cdot}",
	log: "\\log(\\cdot)",
	logarithm: "\\log(\\cdot)",
	exp: "\\exp(\\cdot)",
	sin: "\\sin(\\cdot)",
	cos: "\\cos(\\cdot)",
	tan: "\\tan(\\cdot)",
	Abs: "\\lvert\\cdot\\rvert",
	abs: "\\lvert\\cdot\\rvert",
	function: "f(\\cdot)"
};
var OP_KINDS = /* @__PURE__ */ new Set([
	"operator",
	"relation",
	"function"
]);
var OPERATOR_KINDS = {
	add: "arithmetic",
	subtract: "arithmetic",
	multiply: "arithmetic",
	divide: "arithmetic",
	power: "arithmetic",
	negation: "arithmetic",
	Abs: "function",
	abs: "function",
	sqrt: "function",
	factorial: "function",
	sin: "function",
	cos: "function",
	tan: "function",
	log: "function",
	logarithm: "function",
	exp: "function",
	equals: "comparison",
	not_equal: "comparison",
	approximately: "comparison",
	proportional: "comparison",
	maps_to: "comparison",
	greater_than: "comparison",
	less_than: "comparison",
	greater_equal: "comparison",
	less_equal: "comparison",
	element_of: "comparison",
	not_element_of: "comparison",
	implies: "logical",
	iff: "logical",
	neg: "logical",
	not: "logical",
	logical_not: "logical",
	forall: "logical",
	exists: "logical",
	conjunction: "logical",
	disjunction: "logical",
	intersection: "set",
	union: "set",
	set_difference: "set",
	sum: "aggregate",
	product: "aggregate",
	integral: "aggregate",
	closed_integral: "aggregate",
	limit: "aggregate",
	derivative: "aggregate",
	partial_derivative: "aggregate",
	inner_product: "quantum"
};
var OPERATOR_KIND_STYLES = {
	arithmetic: {
		fill: "#0f2540",
		stroke: "#42a5f5",
		color: "#bbdefb"
	},
	function: {
		fill: "#0f3340",
		stroke: "#29b6f6",
		color: "#b3e5fc"
	},
	comparison: {
		fill: "#1a2240",
		stroke: "#7e57c2",
		color: "#d1c4e9"
	},
	logical: {
		fill: "#0f2a30",
		stroke: "#26c6da",
		color: "#b2ebf2"
	},
	set: {
		fill: "#1a2a20",
		stroke: "#66bb6a",
		color: "#c8e6c9"
	},
	aggregate: {
		fill: "#1d2540",
		stroke: "#5c6bc0",
		color: "#c5cae9"
	},
	quantum: {
		fill: "#2d1530",
		stroke: "#ab47bc",
		color: "#e1bee7"
	}
};
var OPERATOR_KIND_STYLES_LIGHT = {
	arithmetic: {
		fill: "#e7eef4",
		stroke: "#3a7ca8",
		color: "#1c4562"
	},
	function: {
		fill: "#e3f0f5",
		stroke: "#1f89ad",
		color: "#10485c"
	},
	comparison: {
		fill: "#ebe8f4",
		stroke: "#6a51b0",
		color: "#372a63"
	},
	logical: {
		fill: "#e2f1f3",
		stroke: "#1b9aab",
		color: "#0e4f58"
	},
	set: {
		fill: "#e9f2ea",
		stroke: "#4c8a52",
		color: "#26492a"
	},
	aggregate: {
		fill: "#e8eaf5",
		stroke: "#4f5da8",
		color: "#2a3260"
	},
	quantum: {
		fill: "#f1e7f3",
		stroke: "#8e4a9e",
		color: "#4c2456"
	}
};
function operatorKind(node) {
	if (!node || !OP_KINDS.has(node.type)) return null;
	const op = node.op;
	if (op && OPERATOR_KINDS[op]) return OPERATOR_KINDS[op];
	return node.type === "function" ? "function" : "arithmetic";
}
function operatorGlyph(node) {
	if (!node) return null;
	const op = node.op;
	if (!op) return null;
	if (op === "power") {
		if (node.exponent != null && String(node.exponent) === "-1") return "1/(·)";
		return node.exponent ? `(·)${toSuperscript(node.exponent)}` : "(·)˙";
	}
	return OPERATOR_GLYPHS[op] || null;
}
/**
* Build the arity-dot string for a function label.
* When ``hasCondition`` is true, the last argument is separated
* by ``|`` (conditional probability) instead of ``, ``.
*
* @param arity  Number of arguments.
* @param hasCondition  Whether the function has a condition edge.
* @param dot  The dot character (``·`` for text, ``\\cdot`` for LaTeX).
*/
function _arityDots(arity, hasCondition, hasAssertion, dot) {
	if (hasCondition && arity >= 2) {
		const sep = dot === "·" ? "|" : "\\mid ";
		return `${Array(arity - 1).fill(dot).join(", ")}${sep}${dot}`;
	}
	if (hasAssertion) return dot === "·" ? "…" : "\\ldots";
	return Array(arity).fill(dot).join(", ");
}
/**
* Compact symbol shown on the graph node itself.
* ``\cos``, ``⟨0|·⟩``, ``|·|``, ``(·)²``, ``+``, ``=``…
*/
function nodeShortLabel(node) {
	if (!node) return "";
	if (OP_KINDS.has(node.type)) {
		if (node.latex) {
			if (node.type === "function" && !node.latex.includes("\\cdot") && !node.latex.includes("·")) {
				const dots = _arityDots((node._childIds || []).length || 1, node._hasConditionEdge, node._hasAssertionEdge, "·");
				return `${node.latex}(${dots})`;
			}
			return node.latex;
		}
		const g = operatorGlyph(node);
		if (g) return g;
		const name = node.op || node.id || "";
		if (node.type === "function" && name && !name.includes("·")) return `${name}(${_arityDots((node._childIds || []).length || 1, node._hasConditionEdge, node._hasAssertionEdge, "·")})`;
		return name;
	}
	return node.latex || node.label || node.id || "";
}
/**
* Full applied form shown in the details panel / hover / TTS.
* ``\cos(θ/2)``, ``⟨0|ψ⟩``, ``|⟨0|ψ⟩|²``…
*/
function nodeLongLabel(node) {
	if (!node) return "";
	return node.subexpr || node.latex || nodeShortLabel(node);
}
/**
* Get the display label for a node, respecting label detail level.
* Thin wrapper around ``nodeShortLabel`` that adds the emoji prefix
* for ``minimal`` label mode on data nodes.
*
*/
function getNodeLabel(node, labelMode) {
	const short = nodeShortLabel(node);
	if (OP_KINDS.has(node.type)) return short;
	if (labelMode === "minimal" && node.emoji) return node.emoji;
	if (node.emoji && short !== node.emoji) return node.emoji + " " + short;
	return short;
}
var D3SemanticGraphRenderer = class {
	/**
	* @param container — the DOM element to render into
	* @param opts.katex — KaTeX instance for label rendering
	* @param opts.onNodeClick — callback(nodeId, nodeData)
	* @param opts.onNodeHover — callback(nodeId|null, nodeData|null, nodeEl|null)
	* @param opts.onBackgroundClick — callback()
	*/
	constructor(container, opts = {}) {
		this.container = container;
		this.katex = opts.katex || typeof window !== "undefined" && window.katex;
		this.direction = opts.direction || "left-right";
		this.labels = opts.labels || "description";
		this.themeName = opts.theme || "default-dark";
		this.onNodeClick = opts.onNodeClick || null;
		this.onNodeHover = opts.onNodeHover || null;
		this.onBackgroundClick = opts.onBackgroundClick || null;
		this.onZoomChange = opts.onZoomChange || null;
		this.onTransformChange = opts.onTransformChange || null;
		this.onChartClick = opts.onChartClick || null;
		this.onFaClick = opts.onFaClick || null;
		this._graph = null;
		this._theme = null;
		this._collapsed = /* @__PURE__ */ new Set();
		this._svg = null;
		this._viewport = null;
		this._zoomBehavior = null;
		this._currentTransform = null;
		this._needsInitialFit = true;
		this._d3 = null;
		this._dagre = null;
		this._positionById = /* @__PURE__ */ new Map();
		this._lastInteractionId = null;
		this._activeNodeId = null;
		this._selectedNodeIds = /* @__PURE__ */ new Set();
		this._highlightTimer = null;
		this._destroyed = false;
	}
	async render(graph) {
		if (this._destroyed) return;
		this._graph = graph;
		const [d3, dagre] = await Promise.all([loadD3(), loadDagre()]);
		if (this._destroyed) return;
		this._d3 = d3;
		this._dagre = dagre;
		this._theme = await fetchTheme(this.themeName);
		if (this._destroyed) return;
		if (!graph.nodes || !graph.nodes.length) {
			this.container.innerHTML = "<div style=\"color:#7e8aa3;padding:2rem;text-align:center;\">No renderable graph structure.</div>";
			return;
		}
		this._lastInteractionId = graph.nodes[0].id;
		this._setupSvg();
		this._renderGraph();
	}
	async update(opts = {}) {
		if (opts.direction) this.direction = opts.direction;
		if (opts.labels) this.labels = opts.labels;
		if (opts.theme && opts.theme !== this.themeName) {
			this.themeName = opts.theme;
			this._theme = await fetchTheme(this.themeName);
		}
		if (this._d3 && this._dagre && this._graph) this._renderGraph();
	}
	selectNode(nodeId) {
		this._activeNodeId = nodeId;
		this._selectedNodeIds.clear();
		if (nodeId) this._selectedNodeIds.add(nodeId);
		this._applyHighlight();
	}
	/**
	* Restore an ordered multi-selection (deeplink / AI jump). The last id in
	* the array becomes the active node — matching Cmd+Click semantics, where
	* the most recently added node is active. JS Set preserves insertion order.
	*/
	setSelection(orderedIds) {
		const ids = (orderedIds || []).filter(Boolean);
		this._selectedNodeIds = new Set(ids);
		this._activeNodeId = ids.length ? ids[ids.length - 1] : null;
		this._applyHighlight();
		this._scheduleHighlightReapply();
	}
	_scheduleHighlightReapply(delay = 420) {
		clearTimeout(this._highlightTimer);
		this._highlightTimer = setTimeout(() => {
			if (!this._destroyed && this._selectedNodeIds.size) this._applyHighlight();
		}, delay);
	}
	clearSelection() {
		this._activeNodeId = null;
		this._selectedNodeIds.clear();
		this._applyHighlight();
	}
	get activeNode() {
		return this._activeNodeId;
	}
	get selectedNodes() {
		return new Set(this._selectedNodeIds);
	}
	/**
	* Resolve a proof-animation term id (its `data-n`) to a node id in THIS
	* graph, or null if the term has no selectable node here. The animation is
	* derived independently, but node ids are deterministic slugs of the symbol
	* name (see backend id_utils._slug_id), so a *named* term shares this graph's
	* id-space. Try, in order: the exact id; the canonical symbol (occurrence
	* suffix `__<parent>` stripped) against node ids' own canonical symbols; then
	* a loose label/latex match on the rendered glyph text.
	*/
	resolveTermNodeId(termId, termText) {
		return resolveTermId(this._graph, termId, termText);
	}
	/** The node datum for an id (label, description, latex, …), or null. */
	getNode(nodeId) {
		if (!nodeId || !this._graph || !Array.isArray(this._graph.nodes)) return null;
		return this._graph.nodes.find((n) => n.id === nodeId) || null;
	}
	/** Toggle a transient hover halo on the node with this id (null clears all). */
	highlightNodeById(nodeId) {
		if (!this._svg || !this._nodeLayer) return;
		this._nodeLayer.selectAll("g.d3sg-node").classed("d3sg-live-hover", (d) => !!nodeId && d.data.id === nodeId);
	}
	/**
	* Select a node by id as though it were clicked — reuses _handleNodeClick's
	* exact single/multi-select semantics (additive = Cmd/Ctrl-click) and fires
	* onNodeClick, so the info panel and `algebench:selectionchange` event happen
	* identically to a real click. No-op if the id isn't in this graph.
	*/
	selectNodeById(nodeId, opts = {}) {
		if (!this._graph || !Array.isArray(this._graph.nodes)) return;
		const node = this._graph.nodes.find((n) => n.id === nodeId);
		if (!node) return;
		this._handleNodeClick({ data: node }, {
			metaKey: !!opts.additive,
			ctrlKey: false
		});
	}
	saveState() {
		return {
			collapsed: new Set(this._collapsed),
			activeNodeId: this._activeNodeId,
			selectedNodeIds: new Set(this._selectedNodeIds),
			positionById: new Map(this._positionById),
			zoomTransform: this._currentTransform
		};
	}
	restoreState(snapshot) {
		if (!snapshot) return;
		this._collapsed = new Set(snapshot.collapsed);
		this._activeNodeId = snapshot.activeNodeId;
		this._selectedNodeIds = new Set(snapshot.selectedNodeIds || []);
		this._positionById = new Map(snapshot.positionById);
		if (snapshot.zoomTransform) this._currentTransform = snapshot.zoomTransform;
		this._needsInitialFit = false;
		if (this._svg) this._applyHighlight();
	}
	destroy() {
		this._destroyed = true;
		clearTimeout(this._highlightTimer);
		if (this._svg && this._zoomBehavior) {
			this._svg.on(".zoom", null);
			if (this._wheelPanHandler) this._svg.node().removeEventListener("wheel", this._wheelPanHandler);
		}
		this.container.innerHTML = "";
		this._svg = null;
		this._viewport = null;
		this._zoomBehavior = null;
		this._graph = null;
		this._positionById.clear();
	}
	_nodeStyle(nodeOrType) {
		const isNode = nodeOrType && typeof nodeOrType === "object";
		const nodeType = isNode ? nodeOrType.type : nodeOrType;
		const op = isNode ? nodeOrType.op : null;
		const ts = this._theme?.nodeStyles;
		if (op && ts && ts[op]) return ts[op];
		const kind = isNode ? operatorKind(nodeOrType) : null;
		if (kind && ts && ts[kind]) return ts[kind];
		if (ts && ts[nodeType]) return ts[nodeType];
		const light = this._theme?.mode === "light";
		const kindStyles = light ? OPERATOR_KIND_STYLES_LIGHT : OPERATOR_KIND_STYLES;
		const defaults = light ? DEFAULT_NODE_STYLES_LIGHT : DEFAULT_NODE_STYLES;
		if (kind && kindStyles[kind]) return kindStyles[kind];
		return defaults[nodeType] || defaults.scalar;
	}
	_edgeColor(semantic) {
		const es = this._theme?.edgeStyles;
		if (es && es[semantic]) return es[semantic].stroke;
		const single = this._theme?.edgeStyle;
		if (single?.stroke && !this._theme?.paintBySemantic) return single.stroke;
		return DEFAULT_EDGE_COLORS[semantic] || DEFAULT_EDGE_COLORS.neutral;
	}
	_edgeWidth(semantic) {
		const es = this._theme?.edgeStyles;
		if (es && es[semantic]) return es[semantic].strokeWidth || DEFAULT_EDGE_WIDTHS.neutral;
		const single = this._theme?.edgeStyle;
		if (single?.strokeWidth && !this._theme?.paintBySemantic) return single.strokeWidth;
		return DEFAULT_EDGE_WIDTHS[semantic] || DEFAULT_EDGE_WIDTHS.neutral;
	}
	_setupSvg() {
		const d3 = this._d3;
		this.container.innerHTML = "";
		const card = document.createElement("div");
		card.className = "gv-card d3-graph-card";
		card.style.position = "relative";
		this.container.appendChild(card);
		this._svg = d3.select(card).append("svg").attr("class", "d3-semantic-graph").attr("width", "100%").attr("height", "100%");
		const overlay = document.createElement("div");
		overlay.className = "d3sg-annotation-overlay";
		card.appendChild(overlay);
		this._annotationOverlay = overlay;
		const legend = document.createElement("div");
		legend.className = "d3sg-edge-legend hidden";
		card.appendChild(legend);
		this._edgeLegend = legend;
		this._svg.append("defs").append("marker").attr("id", "d3sg-arrow-role").attr("viewBox", "0 0 10 10").attr("refX", 8).attr("refY", 5).attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto").append("path").attr("d", "M0,0 L10,5 L0,10 Z").attr("fill", "var(--d3sg-role-arrow, #888)");
		this._viewport = this._svg.append("g").attr("class", "d3sg-viewport");
		this._linkLayer = this._viewport.append("g").attr("class", "d3sg-links");
		this._labelLayer = this._viewport.append("g").attr("class", "d3sg-edge-labels");
		this._nodeLayer = this._viewport.append("g").attr("class", "d3sg-nodes");
		this._setupZoom(d3);
		this._svg.on("contextmenu", (event) => event.preventDefault());
		this._svg.on("click", (event) => {
			if (event.defaultPrevented) return;
			if (event.target === this._svg.node() || event.target.tagName === "svg") {
				this._activeNodeId = null;
				this._selectedNodeIds.clear();
				this._applyHighlight();
				if (this.onBackgroundClick) this.onBackgroundClick();
			}
		});
		this._svg.on("dblclick.zoom", null);
		this._svg.on("dblclick", (event) => {
			if (event.target === this._svg.node() || event.target.tagName === "svg") {
				event.preventDefault();
				this.zoomToFit();
			}
		});
	}
	_setupZoom(d3) {
		const ZOOM_MIN = .15;
		const ZOOM_MAX = 5;
		this._zoomBehavior = d3.zoom().scaleExtent([ZOOM_MIN, ZOOM_MAX]).filter((event) => {
			if (event.type === "wheel") return event.ctrlKey || event.deltaMode !== 0;
			return !event.ctrlKey && (event.button == null || event.button === 0 || event.button === 2);
		}).on("zoom", (event) => {
			this._currentTransform = event.transform;
			this._viewport.attr("transform", String(event.transform));
			this._rescaleUiBtns();
			if (this.onZoomChange) this.onZoomChange(Math.round(event.transform.k * 100));
			if (this.onTransformChange) this.onTransformChange(event.transform);
		});
		this._svg.call(this._zoomBehavior);
		this._wheelPanHandler = (event) => {
			if (event.ctrlKey || event.deltaMode !== 0) return;
			event.preventDefault();
			const t = this._currentTransform || d3.zoomIdentity;
			const nt = d3.zoomIdentity.translate(t.x - event.deltaX, t.y - event.deltaY).scale(t.k);
			this._svg.call(this._zoomBehavior.transform, nt);
		};
		this._svg.node().addEventListener("wheel", this._wheelPanHandler, { passive: false });
		if (this._currentTransform) {
			const t = this._currentTransform;
			this._svg.call(this._zoomBehavior.transform, d3.zoomIdentity.translate(t.x, t.y).scale(t.k));
		}
	}
	resetZoom() {
		this._currentTransform = null;
		this._needsInitialFit = true;
	}
	zoomBy(factor) {
		if (!this._svg || !this._zoomBehavior || !this._d3) return;
		this._svg.transition().duration(200).call(this._zoomBehavior.scaleBy, factor);
	}
	zoomToFit(animate = true) {
		if (!this._svg || !this._zoomBehavior || !this._d3) return;
		const d3 = this._d3;
		const svgNode = this._svg.node();
		const { width: svgW, height: svgH } = svgNode.getBoundingClientRect();
		if (!svgW || !svgH) return;
		const vpNode = this._viewport.node();
		const btns = this._viewport.selectAll(".d3sg-ui-btn");
		btns.attr("display", "none");
		const bbox = vpNode.getBBox();
		btns.attr("display", null);
		if (!bbox.width || !bbox.height) return;
		const card = svgNode.parentNode;
		const pinned = card && card.querySelector(".sgc-pinned-panel");
		let topInset = 0;
		if (pinned && pinned.offsetParent !== null) {
			const cardTop = card.getBoundingClientRect().top;
			const pinnedRect = pinned.getBoundingClientRect();
			topInset = Math.max(0, pinnedRect.bottom - cardTop);
		}
		const availH = svgH - topInset;
		const scale = Math.min((svgW - 80) / bbox.width, (availH - 80) / bbox.height, 5);
		const tx = svgW / 2 - scale * (bbox.x + bbox.width / 2);
		const ty = topInset + availH / 2 - scale * (bbox.y + bbox.height / 2);
		const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
		if (animate) this._svg.transition().duration(400).ease(d3.easeCubicOut).call(this._zoomBehavior.transform, t);
		else this._svg.call(this._zoomBehavior.transform, t);
	}
	get zoomLevel() {
		return this._currentTransform ? Math.round(this._currentTransform.k * 100) : 100;
	}
	_isHorizontal() {
		return this.direction === "left-right" || this.direction === "right-left";
	}
	_layoutGraph() {
		const dagre = this._dagre;
		const graph = this._graph;
		const nodes = graph.nodes || [];
		const edges = graph.edges || [];
		const nodeById = Object.create(null);
		for (const n of nodes) nodeById[n.id] = n;
		const childrenOf = Object.create(null);
		const conditionEdgeTargets = /* @__PURE__ */ new Set();
		const assertionEdgeTargets = /* @__PURE__ */ new Set();
		const differentialChildTargets = /* @__PURE__ */ new Set();
		for (const e of edges) {
			if (!childrenOf[e.to]) childrenOf[e.to] = [];
			childrenOf[e.to].push(e.from);
			if (e.role === "condition") conditionEdgeTargets.add(e.to);
			if (e.role === "assertion") assertionEdgeTargets.add(e.to);
			if (e.role === "wrt" && nodeById[e.from]?.type === "differential") differentialChildTargets.add(e.to);
		}
		const annoIds = new Set(nodes.filter((n) => n.type === "annotation").map((n) => n.id));
		const hasOutgoing = new Set(edges.map((e) => e.from));
		const roots = nodes.filter((n) => !hasOutgoing.has(n.id));
		const visible = /* @__PURE__ */ new Set();
		const queue = roots.map((r) => r.id);
		while (queue.length) {
			const id = queue.shift();
			if (visible.has(id)) continue;
			if (annoIds.has(id)) continue;
			visible.add(id);
			if (this._collapsed.has(id)) continue;
			for (const child of childrenOf[id] || []) queue.push(child);
		}
		const rankdir = this.direction === "top-down" ? "TB" : this.direction === "bottom-up" ? "BT" : this.direction === "left-right" ? "LR" : "RL";
		const g = new dagre.graphlib.Graph({ multigraph: true });
		g.setGraph({
			rankdir,
			nodesep: 60,
			ranksep: 80,
			marginx: 40,
			marginy: 40
		});
		g.setDefaultEdgeLabel(() => ({}));
		for (const n of nodes) {
			if (!visible.has(n.id)) continue;
			if (n.type === "annotation") continue;
			const isCollapsed = this._collapsed.has(n.id);
			const isOp = n.type === "operator" || n.type === "relation" || n.type === "function";
			let w, h;
			if (isCollapsed) {
				const label = n.subexpr || n.label || n.id || "";
				w = Math.max(100, Math.min(260, label.length * 7 + 30));
				h = 48;
			} else if (isOp) {
				w = 56;
				h = 56;
			} else {
				w = 52;
				h = 52;
			}
			g.setNode(n.id, {
				width: w,
				height: h
			});
		}
		const edgeSemanticMap = Object.create(null);
		for (const e of edges) {
			if (!visible.has(e.from) || !visible.has(e.to)) continue;
			const key = `${e.from}->${e.to}`;
			edgeSemanticMap[key] = inferEdgeSemantic(e, nodeById);
			g.setEdge(e.to, e.from, {}, key);
		}
		dagre.layout(g);
		const boundLabel = (ref) => {
			if (!ref) return "";
			const b = nodeById[ref];
			return b ? b.latex || b.label || b.subexpr || ref : ref;
		};
		const nodeWrappers = Object.create(null);
		const layoutNodes = [];
		for (const id of g.nodes()) {
			const pos = g.node(id);
			const src = nodeById[id];
			const wrapper = {
				data: {
					...src,
					_collapsed: this._collapsed.has(id),
					_childIds: childrenOf[id] || [],
					_hasConditionEdge: conditionEdgeTargets.has(id),
					_hasAssertionEdge: assertionEdgeTargets.has(id),
					_hasDifferentialChild: differentialChildTargets.has(id),
					_lowerBoundLabel: boundLabel(src.lower_bound),
					_upperBoundLabel: boundLabel(src.upper_bound)
				},
				x: pos.x,
				y: pos.y
			};
			nodeWrappers[id] = wrapper;
			layoutNodes.push(wrapper);
		}
		const layoutEdges = [];
		for (const e of edges) {
			if (!visible.has(e.from) || !visible.has(e.to)) continue;
			const src = nodeWrappers[e.to];
			const tgt = nodeWrappers[e.from];
			if (!src || !tgt) continue;
			layoutEdges.push({
				source: src,
				target: tgt,
				id: `${e.from}->${e.to}`,
				semantic: edgeSemanticMap[`${e.from}->${e.to}`] || "neutral",
				role: e.role || null
			});
		}
		return {
			nodes: layoutNodes,
			edges: layoutEdges
		};
	}
	_renderGraph(interactionId) {
		const d3 = this._d3;
		if (interactionId) this._lastInteractionId = interactionId;
		const oldPos = interactionId ? this._positionById.get(interactionId) : null;
		const layout = this._layoutGraph();
		if (!layout) return;
		const { nodes, edges: links } = layout;
		if (oldPos && interactionId) {
			const anchor = nodes.find((n) => n.data.id === interactionId);
			if (anchor) {
				const dx = oldPos.x - anchor.x;
				const dy = oldPos.y - anchor.y;
				for (const n of nodes) {
					n.x += dx;
					n.y += dy;
				}
			}
		}
		const initialFit = this._needsInitialFit;
		if (initialFit) this._needsInitialFit = false;
		const duration = initialFit ? 0 : 360;
		const transition = this._svg.transition().duration(duration).ease(d3.easeCubicOut);
		this._renderLinks(links, transition, d3);
		this._renderEdgeLabels(links, transition, d3);
		this._renderNodes(nodes, transition, d3);
		this._renderAnnotationOverlay();
		this._renderEdgeLegend(layout.edges);
		for (const n of nodes) this._positionById.set(n.data.id, {
			x: n.x,
			y: n.y
		});
		if (this._selectedNodeIds.size) {
			this._applyHighlight();
			if (duration > 0) this._scheduleHighlightReapply(duration + 40);
		}
		if (initialFit) requestAnimationFrame(() => this.zoomToFit(false));
	}
	_nodeShape(d) {
		if (!d || !d.data) return {
			type: "circle",
			r: 26
		};
		const style = this._nodeStyle(d.data);
		const invisible = (!style.fill || style.fill === "none") && (!style.stroke || style.stroke === "none");
		if (d.data._collapsed) {
			const label = d.data.subexpr || d.data.label || d.data.id || "";
			return {
				type: "rect",
				hw: Math.max(100, Math.min(260, label.length * 7 + 30)) / 2,
				hh: 24
			};
		}
		if (invisible) return {
			type: "rect",
			hw: 28,
			hh: 18
		};
		const isOp = d.data.type === "operator" || d.data.type === "relation" || d.data.type === "function";
		const fallback = isOp ? "hexagon" : "circle";
		switch (style.shape || fallback) {
			case "rect":
			case "rectangle": return {
				type: "rect",
				hw: 32,
				hh: 22
			};
			case "stadium": return {
				type: "stadium",
				hw: 36,
				hh: 20
			};
			case "diamond": return {
				type: "diamond",
				r: 32
			};
			case "octagon": return {
				type: "polygon",
				r: 28
			};
			case "hexagon": return {
				type: "polygon",
				r: 28
			};
			default: return {
				type: "circle",
				r: isOp ? 28 : 26
			};
		}
	}
	_boundaryPoint(center, other, shape) {
		const dx = other.x - center.x;
		const dy = other.y - center.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < 1) return {
			x: center.x,
			y: center.y
		};
		if (shape.type === "rect" || shape.type === "stadium") {
			const nx = dx / dist, ny = dy / dist;
			const tx = shape.hw / Math.max(Math.abs(nx), 1e-6);
			const ty = shape.hh / Math.max(Math.abs(ny), 1e-6);
			const t = Math.min(tx, ty);
			return {
				x: center.x + nx * t,
				y: center.y + ny * t
			};
		}
		if (shape.type === "diamond") {
			const nx = dx / dist, ny = dy / dist;
			const t = shape.r / Math.max(Math.abs(nx) + Math.abs(ny), 1e-6);
			return {
				x: center.x + nx * t,
				y: center.y + ny * t
			};
		}
		const ratio = (shape.r || 26) / dist;
		return {
			x: center.x + dx * ratio,
			y: center.y + dy * ratio
		};
	}
	_diagonal(d3, source, target, sourceNode, targetNode) {
		const ss = sourceNode ? this._nodeShape(sourceNode) : null;
		const ts = targetNode ? this._nodeShape(targetNode) : null;
		const s = ss ? this._boundaryPoint(source, target, ss) : source;
		const t = ts ? this._boundaryPoint(target, source, ts) : target;
		if (this._isHorizontal()) {
			const midX = (s.x + t.x) / 2;
			return `M${s.x},${s.y} C${midX},${s.y} ${midX},${t.y} ${t.x},${t.y}`;
		}
		const midY = (s.y + t.y) / 2;
		return `M${s.x},${s.y} C${s.x},${midY} ${t.x},${midY} ${t.x},${t.y}`;
	}
	_startPos(id) {
		return this._positionById.get(id) || this._positionById.get(this._lastInteractionId) || {
			x: 0,
			y: 0
		};
	}
	_renderLinks(links, transition, d3) {
		const showArrows = this._theme?.paintBySemantic;
		const markerEnd = (d) => showArrows && d.role ? "url(#d3sg-arrow-role)" : null;
		const VISUAL_REVERSE_ROLES = /* @__PURE__ */ new Set([]);
		const linkPath = (d) => {
			if (VISUAL_REVERSE_ROLES.has(d.role)) return this._diagonal(d3, d.target, d.source, d.target, d.source);
			return this._diagonal(d3, d.source, d.target, d.source, d.target);
		};
		const link = this._linkLayer.selectAll("path.d3sg-link").data(links, (d) => d.id);
		link.enter().append("path").attr("class", (d) => `d3sg-link d3sg-edge-${d.semantic}${d.role ? ` d3sg-role-${d.role}` : ""}`).attr("fill", "none").attr("stroke", (d) => this._edgeColor(d.semantic)).attr("stroke-width", (d) => this._edgeWidth(d.semantic)).attr("stroke-linecap", "round").attr("marker-end", markerEnd).attr("d", (d) => {
			const p = this._startPos(d.target.data.id);
			return this._diagonal(d3, p, p, null, null);
		}).style("opacity", 0).transition(transition).style("opacity", 1).attr("d", linkPath);
		link.transition(transition).attr("class", (d) => `d3sg-link d3sg-edge-${d.semantic}${d.role ? ` d3sg-role-${d.role}` : ""}`).attr("stroke", (d) => this._edgeColor(d.semantic)).attr("stroke-width", (d) => this._edgeWidth(d.semantic)).attr("marker-end", markerEnd).style("opacity", 1).attr("d", linkPath);
		link.exit().transition(transition).style("opacity", 0).attr("d", () => {
			const p = this._startPos(this._lastInteractionId);
			return this._diagonal(d3, p, p, null, null);
		}).remove();
	}
	_renderEdgeLabels(links, transition, d3) {
		const showSemantic = this._theme?.paintBySemantic;
		const labeled = links.filter((d) => d.semantic && d.semantic !== "neutral" || showSemantic && d.role);
		const labelText = (d) => {
			const parts = [];
			if (d.role) parts.push(d.role);
			if (d.semantic && d.semantic !== "neutral") parts.push(d.semantic);
			return parts.join(" · ");
		};
		const label = this._labelLayer.selectAll("text.d3sg-edge-label").data(labeled, (d) => d.id);
		label.enter().append("text").attr("class", (d) => `d3sg-edge-label${d.role ? " d3sg-role-label" : ""}`).attr("text-anchor", "middle").attr("dominant-baseline", "middle").attr("x", (d) => this._startPos(d.target.data.id).x).attr("y", (d) => this._startPos(d.target.data.id).y).style("opacity", 0).text(labelText).transition(transition).style("opacity", 1).attr("x", (d) => (d.source.x + d.target.x) / 2).attr("y", (d) => (d.source.y + d.target.y) / 2 - 8);
		label.transition(transition).style("opacity", 1).attr("x", (d) => (d.source.x + d.target.x) / 2).attr("y", (d) => (d.source.y + d.target.y) / 2 - 8).text(labelText);
		label.exit().transition(transition).style("opacity", 0).remove();
	}
	_renderNodes(nodes, transition, d3) {
		const self = this;
		const node = this._nodeLayer.selectAll("g.d3sg-node").data(nodes, (d) => d.data.id);
		const nodeEnter = node.enter().append("g").attr("class", (d) => this._nodeClass(d)).attr("transform", (d) => {
			const p = this._startPos(d.data.id);
			return `translate(${p.x},${p.y}) scale(0.85)`;
		}).style("opacity", 0).style("cursor", "pointer").on("click", function(event, d) {
			event.stopPropagation();
			self._handleNodeClick(d, event);
		}).on("mouseenter", function(event, d) {
			if (self.onNodeHover) self.onNodeHover(d.data.id, d.data, this);
		}).on("mouseleave", function() {
			if (self.onNodeHover) self.onNodeHover(null, null, null);
		});
		nodeEnter.each(function(d) {
			self._drawNode(d3.select(this), d);
		});
		nodeEnter.transition(transition).attr("transform", (d) => `translate(${d.x},${d.y}) scale(1)`).style("opacity", 1);
		const nodeUpdate = node.merge(nodeEnter);
		nodeUpdate.attr("class", (d) => this._nodeClass(d));
		nodeUpdate.each(function(d) {
			self._drawNode(d3.select(this), d);
		});
		nodeUpdate.transition(transition).attr("transform", (d) => `translate(${d.x},${d.y}) scale(1)`).style("opacity", 1);
		node.exit().transition(transition).attr("transform", () => {
			const p = this._startPos(this._lastInteractionId);
			return `translate(${p.x},${p.y}) scale(0.85)`;
		}).style("opacity", 0).remove();
	}
	_groupKatexWords(base) {
		const text = base.textContent;
		base.innerHTML = "";
		const parts = text.split(/(\s+)/);
		for (const part of parts) if (/^\s+$/.test(part)) base.appendChild(document.createTextNode(" "));
		else if (part) {
			const span = document.createElement("span");
			span.textContent = part;
			span.style.whiteSpace = "nowrap";
			base.appendChild(span);
		}
	}
	_renderAnnotationOverlay() {
		const el = this._annotationOverlay;
		if (!el) return;
		el.innerHTML = "";
		const graph = this._graph;
		if (!graph || !graph.nodes) return;
		const annotations = graph.nodes.filter((n) => n.type === "annotation");
		if (!annotations.length) return;
		const style = this._nodeStyle("annotation");
		for (const ann of annotations) {
			const card = document.createElement("div");
			card.className = "d3sg-anno-card";
			card.style.background = style.fill || "rgba(42,37,24,0.85)";
			card.style.borderColor = style.stroke || "#8d6e63";
			card.style.color = style.color || "#d7ccc8";
			if (style.strokeWidth) card.style.borderWidth = style.strokeWidth + "px";
			if (style.fontSize) card.style.fontSize = style.fontSize + "px";
			const latex = ann.latex || ann.label || "";
			const content = document.createElement("span");
			content.className = "d3sg-anno-content";
			if (this.katex && latex) try {
				this.katex.render(latex, content, {
					throwOnError: false,
					displayMode: false
				});
			} catch (_) {
				content.textContent = latex;
			}
			else content.textContent = latex;
			card.appendChild(content);
			const aiBtn = makeAiAskButton("d3sg-anno-ai-btn", "Ask AI about this annotation", () => "Can you explain this annotation:\n" + latex);
			card.appendChild(aiBtn);
			el.appendChild(card);
		}
	}
	_renderEdgeLegend(layoutEdges) {
		const el = this._edgeLegend;
		if (!el) return;
		el.innerHTML = "";
		const theme = this._theme;
		const styled = theme?.edgeStyles && typeof theme.edgeStyles === "object" ? theme.edgeStyles : {};
		const present = /* @__PURE__ */ new Set();
		for (const e of layoutEdges || []) if (e.semantic) present.add(e.semantic);
		const rows = [];
		for (const [semantic, label] of EDGE_SEMANTIC_LABELS$1) {
			const s = styled[semantic];
			if (!s) continue;
			if (present.size > 0 && !present.has(semantic)) continue;
			rows.push({
				semantic,
				label,
				style: s
			});
		}
		if (!rows.length) {
			el.classList.add("hidden");
			return;
		}
		const title = document.createElement("div");
		title.className = "d3sg-edge-legend-title";
		title.textContent = "Edges";
		el.appendChild(title);
		for (const row of rows) {
			const item = document.createElement("div");
			item.className = "d3sg-edge-legend-item";
			const swatch = document.createElement("span");
			swatch.className = "d3sg-edge-legend-swatch";
			const stroke = row.style.stroke || "currentColor";
			const width = Number(row.style.strokeWidth || 2);
			const arrow = row.style.arrow || "-->";
			swatch.style.setProperty("--legend-stroke", stroke);
			swatch.style.setProperty("--legend-stroke-width", `${width}px`);
			swatch.dataset.arrow = arrow;
			item.appendChild(swatch);
			const lbl = document.createElement("span");
			lbl.className = "d3sg-edge-legend-label";
			lbl.textContent = row.label;
			item.appendChild(lbl);
			el.appendChild(item);
		}
		el.classList.remove("hidden");
	}
	_nodeClass(d) {
		const kind = d.data.type;
		return `d3sg-node d3sg-${kind === "operator" || kind === "relation" || kind === "function" ? "op" : "var"}${d.data._collapsed ? " collapsed" : ""}${this._selectedNodeIds.has(d.data.id) ? " selected" : ""}${d.data.id === this._activeNodeId ? " active" : ""}`;
	}
	_isCollapsible(d) {
		const kind = d.data.type;
		return (kind === "operator" || kind === "relation" || kind === "function") && d.data._childIds && d.data._childIds.length > 0;
	}
	_handleNodeClick(d, event) {
		const nodeId = d.data.id;
		const multiSelect = event && (event.metaKey || event.ctrlKey);
		if (multiSelect) {
			if (this._selectedNodeIds.has(nodeId)) {
				this._selectedNodeIds.delete(nodeId);
				this._activeNodeId = this._selectedNodeIds.size ? [...this._selectedNodeIds].at(-1) : null;
			} else {
				this._selectedNodeIds.add(nodeId);
				this._activeNodeId = nodeId;
			}
		} else if (this._selectedNodeIds.size <= 1 && this._activeNodeId === nodeId) {
			this._activeNodeId = null;
			this._selectedNodeIds.clear();
		} else {
			this._activeNodeId = nodeId;
			this._selectedNodeIds.clear();
			this._selectedNodeIds.add(nodeId);
		}
		this._applyHighlight();
		if (this.onNodeClick) this.onNodeClick(nodeId, d.data, new Set(this._selectedNodeIds), multiSelect);
	}
	_handleChevronClick(d) {
		const nodeId = d.data.id;
		if (this._collapsed.has(nodeId)) this._collapsed.delete(nodeId);
		else this._collapsed.add(nodeId);
		this._renderGraph(nodeId);
	}
	/** Anchor (in graph coordinates) for the chevron — the node-edge midpoint
	*  on the outgoing side of the flow. The button itself is centred on it. */
	_chevronAnchor(shape) {
		const dir = this.direction;
		if (shape.type === "rect" || shape.type === "stadium") {
			if (dir === "left-right") return {
				x: shape.hw,
				y: 0
			};
			if (dir === "right-left") return {
				x: -shape.hw,
				y: 0
			};
			if (dir === "bottom-up") return {
				x: 0,
				y: -shape.hh
			};
			return {
				x: 0,
				y: shape.hh
			};
		}
		const r = shape.r || 26;
		if (dir === "left-right") return {
			x: r,
			y: 0
		};
		if (dir === "right-left") return {
			x: -r,
			y: 0
		};
		if (dir === "bottom-up") return {
			x: 0,
			y: -r
		};
		return {
			x: 0,
			y: r
		};
	}
	/** Anchor for the chart / analysis buttons — the node-edge midpoint on the
	*  incoming side, i.e. opposite the chevron. */
	_chartBtnAnchor(shape) {
		const a = this._chevronAnchor(shape);
		return {
			x: -a.x,
			y: -a.y
		};
	}
	/** Transform for a node UI button: pinned at its graph-space anchor but
	*  counter-scaled by the zoom factor so it keeps a constant on-screen
	*  size (see UI_BTN_SIZE). `dy` stacks buttons in screen pixels. */
	_uiBtnTransform(ax, ay, dy) {
		const k = this._currentTransform && this._currentTransform.k || 1;
		let t = `translate(${ax},${ay}) scale(${Math.min(1 / k, UI_BTN_MAX_SCALE)})`;
		if (dy) t += ` translate(0,${dy})`;
		return t;
	}
	/** Create a zoom-invariant button group centred on (ax, ay). Returns an
	*  inner <g> whose coordinate system is the legacy 14×14 icon box with
	*  its origin at the box's top-left, so icon paths stay unchanged. */
	_uiBtnGroup(group, cls, ax, ay, dy, onClick) {
		const g = group.append("g").attr("class", `${cls} d3sg-ui-btn`).attr("data-ax", ax).attr("data-ay", ay).attr("data-dy", dy || 0).attr("transform", this._uiBtnTransform(ax, ay, dy)).on("click", onClick);
		return {
			g,
			box: g.append("g").attr("transform", `translate(-9,-9) scale(${UI_BTN_SIZE / 14})`)
		};
	}
	/** Re-apply the counter-scale to every node UI button. Called on zoom so
	*  the buttons never shrink out of reach at low zoom levels. */
	_rescaleUiBtns() {
		if (!this._viewport) return;
		const self = this;
		this._viewport.selectAll(".d3sg-ui-btn").attr("transform", function() {
			return self._uiBtnTransform(+this.getAttribute("data-ax") || 0, +this.getAttribute("data-ay") || 0, +this.getAttribute("data-dy") || 0);
		});
	}
	_appendChevron(group, d, isCollapsed) {
		const shape = this._nodeShape(d);
		const anchor = this._chevronAnchor(shape);
		const self = this;
		const sz = 14;
		const { g, box } = this._uiBtnGroup(group, "d3sg-chevron", anchor.x, anchor.y, 0, function(event) {
			event.stopPropagation();
			self._handleChevronClick(d);
		});
		box.append("rect").attr("x", 0).attr("y", 0).attr("width", sz).attr("height", sz).attr("rx", 2).attr("fill", "#1a2440").attr("stroke", "#a8c5ff").attr("stroke-width", 1);
		box.append("text").attr("x", sz / 2).attr("y", 8).attr("text-anchor", "middle").attr("dominant-baseline", "middle").attr("font-size", "11px").attr("fill", "#a8c5ff").text(isCollapsed ? "+" : "−");
		return g;
	}
	_appendChartBtn(group, d) {
		const shape = this._nodeShape(d);
		const anchor = this._chartBtnAnchor(shape);
		const self = this;
		const sz = 14;
		const { g, box } = this._uiBtnGroup(group, "d3sg-chart-btn", anchor.x, anchor.y, 0, function(event) {
			event.stopPropagation();
			if (self.onChartClick) self.onChartClick(d.data.id, d.data, this);
		});
		g.append("title").text("Plot this expression");
		box.append("rect").attr("x", 0).attr("y", 0).attr("width", sz).attr("height", sz).attr("rx", 2).attr("fill", "#1a2440").attr("stroke", "#42a5f5").attr("stroke-width", 1);
		box.append("path").attr("d", `M3,11 L5,5 L8,8 L11,3`).attr("fill", "none").attr("stroke", "#42a5f5").attr("stroke-width", 1.5).attr("stroke-linecap", "round").attr("stroke-linejoin", "round");
		return g;
	}
	/** Function-Analysis button (ƒ) — sits beside the chart button; opens
	*  the full-page expert analysis for this node's subexpr. */
	_appendFaBtn(group, d) {
		const shape = this._nodeShape(d);
		const anchor = this._chartBtnAnchor(shape);
		const self = this;
		const sz = 14;
		const { g, box } = this._uiBtnGroup(group, "d3sg-fa-btn", anchor.x, anchor.y, 22, function(event) {
			event.stopPropagation();
			if (self.onFaClick) self.onFaClick(d.data.id, d.data, this);
		});
		g.append("title").text("Function analysis");
		box.append("rect").attr("x", 0).attr("y", 0).attr("width", sz).attr("height", sz).attr("rx", 2).attr("fill", "#1a2440").attr("stroke", "#ffa726").attr("stroke-width", 1);
		box.append("path").attr("d", "M3.5,2.8 V10.5 H11.5").attr("fill", "none").attr("stroke", "#ffa726").attr("stroke-width", 1.2).attr("stroke-linecap", "square");
		box.append("path").attr("d", "M5.2,4 C5.9,8 7.2,9 10.6,9.2").attr("fill", "none").attr("stroke", "#ffa726").attr("stroke-width", 1.2).attr("stroke-linecap", "butt");
		return g;
	}
	_drawNode(group, d) {
		group.selectAll("*").remove();
		const data = d.data;
		const isOp = data.type === "operator" || data.type === "relation" || data.type === "function";
		const style = this._nodeStyle(data);
		const invisible = (!style.fill || style.fill === "none") && (!style.stroke || style.stroke === "none");
		if (data._collapsed) {
			const label = data.subexpr || data.label || data.id;
			const estimatedWidth = Math.max(100, Math.min(260, label.length * 7 + 30));
			const tile = group.append("rect").attr("class", invisible ? "d3sg-hit-target" : "d3sg-tile-bg").attr("x", -estimatedWidth / 2).attr("y", -24).attr("width", estimatedWidth).attr("height", 48).attr("rx", 6);
			if (invisible) tile.style("fill", "transparent").style("stroke", "none");
			else tile.attr("fill", style.fill || "").attr("stroke", style.stroke || "");
			const measured = this._renderLabel(group, data, estimatedWidth, true, style);
			if (measured) {
				const padX = 24, padY = 16;
				const tileW = Math.max(estimatedWidth, measured.width + padX);
				const tileH = Math.max(48, measured.height + padY);
				tile.attr("x", -tileW / 2).attr("width", tileW).attr("y", -tileH / 2).attr("height", tileH);
			}
			this._appendChevron(group, d, true);
			if (data.subexpr || data.chartScript) {
				this._appendChartBtn(group, d);
				if (data.subexpr) this._appendFaBtn(group, d);
			}
			return;
		}
		let labelWidth = 52;
		if (invisible) {
			group.append("rect").attr("class", "d3sg-hit-target").attr("x", -28).attr("y", -18).attr("width", 56).attr("height", 36).attr("rx", 4).style("fill", "transparent").style("stroke", "none");
			labelWidth = 56;
		} else {
			const shapeName = style.shape || (isOp ? "hexagon" : "circle");
			this._drawShape(group, shapeName, style, isOp);
			labelWidth = shapeName === "rect" || shapeName === "rectangle" ? 60 : shapeName === "stadium" ? 68 : 56;
		}
		this._renderLabel(group, data, labelWidth, false, style);
		if (isOp && data._childIds && data._childIds.length > 0) this._appendChevron(group, d, false);
		if (data.subexpr || data.chartScript) {
			this._appendChartBtn(group, d);
			if (data.subexpr) this._appendFaBtn(group, d);
		}
	}
	_drawShape(group, shapeName, style, isOp) {
		const fill = style.fill || "";
		const stroke = style.stroke || "";
		const cls = isOp ? "d3sg-op-bg" : "d3sg-var-bg";
		switch (shapeName) {
			case "hexagon": {
				const r = 28;
				const pts = Array.from({ length: 6 }, (_, i) => {
					const a = Math.PI / 3 * i - Math.PI / 6;
					return `${r * Math.cos(a)},${r * Math.sin(a)}`;
				}).join(" ");
				group.append("polygon").attr("class", cls).attr("points", pts).attr("fill", fill).attr("stroke", stroke);
				break;
			}
			case "octagon": {
				const r = 28;
				const pts = Array.from({ length: 8 }, (_, i) => {
					const a = Math.PI / 4 * i - Math.PI / 8;
					return `${r * Math.cos(a)},${r * Math.sin(a)}`;
				}).join(" ");
				group.append("polygon").attr("class", cls).attr("points", pts).attr("fill", fill).attr("stroke", stroke);
				break;
			}
			case "diamond": {
				const r = 32;
				const pts = `0,-32 ${r},0 0,${r} -32,0`;
				group.append("polygon").attr("class", cls).attr("points", pts).attr("fill", fill).attr("stroke", stroke);
				break;
			}
			case "rect":
			case "rectangle":
				group.append("rect").attr("class", cls).attr("x", -32).attr("y", -22).attr("width", 64).attr("height", 44).attr("rx", 4).attr("fill", fill).attr("stroke", stroke);
				break;
			case "stadium":
				group.append("rect").attr("class", cls).attr("x", -36).attr("y", -20).attr("width", 72).attr("height", 40).attr("rx", 20).attr("fill", fill).attr("stroke", stroke);
				break;
			default: {
				const r = isOp ? 28 : 26;
				group.append("circle").attr("class", cls).attr("r", r).attr("fill", fill).attr("stroke", stroke);
				break;
			}
		}
	}
	_operatorLatex(data) {
		const op = data.op;
		if (!op) return `\\text{${data.id || "?"}}`;
		if (OPERATOR_LATEX[op]) return OPERATOR_LATEX[op];
		if (op === "power") {
			const exp = data.exponent;
			if (exp != null && String(exp) === "-1") return `\\dfrac{1}{(\\cdot)}`;
			return exp ? `(\\cdot)^{${exp}}` : `(\\cdot)^{\\cdot}`;
		}
		if (op === "derivative" || op === "partial_derivative") {
			const d = op === "partial_derivative" ? "\\partial" : "d";
			const wrt = data.with_respect_to;
			if (wrt && (!data._childIds || data._childIds.length <= 1)) return `\\frac{${d}}{${d}${wrt}}`;
			return `\\frac{${d}}{${d}\\cdot}`;
		}
		if (op === "integral" || op === "closed_integral") {
			const cmd = OPERATOR_LATEX[op];
			const wrt = data.with_respect_to;
			const lb = data._lowerBoundLabel || "";
			const ub = data._upperBoundLabel || "";
			const diff = !data._hasDifferentialChild && wrt ? ` d${wrt}` : "";
			if (lb && ub) return `${cmd}_{${lb}}^{${ub}}${diff}`;
			return `${cmd}${diff}`;
		}
		if (op === "sum" || op === "product") {
			const cmd = OPERATOR_LATEX[op];
			const wrt = data.with_respect_to;
			if (wrt) return `${cmd}_{${wrt}}`;
			return cmd;
		}
		return `\\text{${op.replace(/\\/g, "\\\\").replace(/_/g, "\\_")}}`;
	}
	/**
	* Render a node label via KaTeX (or plain text fallback).
	*
	* Returns ``{width, height}`` of the measured KaTeX content so the
	* caller can resize the background shape to fit, or ``null`` when the
	* plain-text fallback was used.
	*/
	_renderLabel(group, data, maxWidth, isCollapsed, style = {}) {
		let latex = isCollapsed ? data.subexpr || data.latex || null : data.latex || null;
		const textColor = style.color || null;
		const isOp = OP_KINDS.has(data.type);
		if (!latex && isOp && this.katex) latex = this._operatorLatex(data);
		if (latex && data.type === "function" && !isCollapsed && !latex.includes("\\cdot") && !latex.includes("·")) {
			const dots = _arityDots((data._childIds || []).length || 1, data._hasConditionEdge, data._hasAssertionEdge, "\\cdot");
			latex = `${latex}(${dots})`;
		}
		if (latex && this.katex) {
			const span = document.createElement("span");
			let ok = false;
			try {
				this.katex.render("\\displaystyle " + latex, span, {
					throwOnError: false,
					displayMode: false
				});
				ok = true;
			} catch (_) {}
			let measuredW = maxWidth, measuredH = 28;
			if (ok) {
				span.style.position = "absolute";
				span.style.visibility = "hidden";
				span.style.whiteSpace = "nowrap";
				document.body.appendChild(span);
				const bbox = span.getBoundingClientRect();
				measuredW = bbox.width;
				measuredH = bbox.height;
				document.body.removeChild(span);
				span.style.position = "";
				span.style.visibility = "";
				span.style.whiteSpace = "";
			}
			const foW = Math.max(maxWidth, measuredW + 8);
			const foH = Math.max(28, measuredH + 4);
			const div = group.append("foreignObject").attr("x", -foW / 2).attr("y", -foH / 2).attr("width", foW).attr("height", foH).attr("class", "d3sg-label-fo").append("xhtml:div").attr("class", "d3sg-katex-host").style("display", "flex").style("justify-content", "center").style("align-items", "center").style("width", "100%").style("height", "100%");
			if (textColor) div.style("color", textColor);
			if (ok) {
				if (data.emoji && !isOp) {
					const emojiSpan = document.createElement("span");
					emojiSpan.textContent = data.emoji;
					emojiSpan.style.marginRight = "4px";
					div.node().appendChild(emojiSpan);
				}
				div.node().appendChild(span);
				return {
					width: measuredW,
					height: measuredH
				};
			} else {
				div.text(data.label || data.id);
				return null;
			}
		} else {
			const text = getNodeLabel(data, this.labels);
			const label = group.append("text").attr("class", "d3sg-label").attr("text-anchor", "middle").attr("dominant-baseline", "middle").attr("font-size", isCollapsed ? "14px" : "17px").text(text);
			if (textColor) label.attr("fill", textColor);
			return null;
		}
	}
	_applyHighlight() {
		if (!this._svg) return;
		this._nodeLayer.selectAll("g.d3sg-node").attr("class", (d) => this._nodeClass(d));
		if (!this._selectedNodeIds.size) {
			this._nodeLayer.selectAll("g.d3sg-node").style("opacity", 1);
			this._linkLayer.selectAll("path.d3sg-link").style("opacity", 1);
			this._labelLayer.selectAll("text.d3sg-edge-label").style("opacity", 1);
			return;
		}
		const upstream = /* @__PURE__ */ new Set();
		for (const id of this._selectedNodeIds) for (const n of this._getUpstream(id)) upstream.add(n);
		this._nodeLayer.selectAll("g.d3sg-node").style("opacity", (d) => upstream.has(d.data.id) ? 1 : .3);
		this._linkLayer.selectAll("path.d3sg-link").style("opacity", (d) => upstream.has(d.source.data.id) && upstream.has(d.target.data.id) ? 1 : .25);
		this._labelLayer.selectAll("text.d3sg-edge-label").style("opacity", (d) => upstream.has(d.source.data.id) && upstream.has(d.target.data.id) ? 1 : .25);
	}
	_getUpstream(nodeId) {
		const visited = /* @__PURE__ */ new Set();
		const edges = this._graph.edges || [];
		const queue = [nodeId];
		while (queue.length) {
			const cur = queue.shift();
			if (visited.has(cur)) continue;
			visited.add(cur);
			for (const e of edges) if (e.to === cur && !visited.has(e.from)) queue.push(e.from);
		}
		return visited;
	}
};
//#endregion
//#region src/graph-panel/graph-panel.ts
/**
* SemanticGraphPanel — reusable info panel + highlight + tooltip for semantic graph
* Mermaid diagrams.
*
* Usage (ES module):
*   import { SemanticGraphPanel } from './graph-panel/graph-panel.js';
*   const gp = new SemanticGraphPanel(graph, { container, katex });
*   // call gp.attach() after Mermaid has rendered the SVG
*   gp.attach();
*   // cleanup
*   gp.destroy();
*
* Usage (inline / render_math.py):
*   const gp = new SemanticGraphPanel(graph, { container, katex });
*   setTimeout(() => gp.attach(), 1000);
*/
var PANEL_FIELDS = [
	["label", "Label"],
	["type", "Type"],
	["role", "Role"],
	["quantity", "Quantity"],
	["dimension", "Dimension"],
	["unit", "Unit"],
	["value", "Value"],
	["op", "Operation"]
];
var SemanticGraphPanel = class SemanticGraphPanel {
	constructor(graph, opts = {}) {
		this.graph = graph;
		this.container = opts.container || document.body;
		this.katex = opts.katex || typeof window !== "undefined" && window.katex;
		this._buildNodeIndex();
		this._buildEdgeList();
		this.tooltip = opts.tooltip || this._createTooltip();
		this.panel = opts.panel || this._createPanel();
		if (!this.panel.querySelector(".graph-panel-ai-btn")) {
			this._ensurePanelHeader(this.panel);
			this._injectPanelAskButton(this.panel);
		}
		this._activeNode = null;
		this._handlers = [];
		this._nodeAskBtn = null;
	}
	_ensurePanelHeader(panelEl) {
		if (panelEl.querySelector(".gp-header")) return;
		const h3 = panelEl.querySelector("h3");
		if (!h3) return;
		const header = document.createElement("div");
		header.className = "gp-header";
		h3.replaceWith(header);
		header.appendChild(h3);
		const close = panelEl.querySelector(".gp-close");
		if (close) header.appendChild(close);
	}
	_buildNodeIndex() {
		this._nodeData = {};
		this._subexprs = {};
		const sanitize = SemanticGraphPanel.sanitizeId;
		for (const node of this.graph.nodes || []) {
			const sid = sanitize(node.id);
			const info = {};
			for (const key of [
				"id",
				"type",
				"label",
				"description",
				"emoji",
				"op",
				"quantity",
				"dimension",
				"unit",
				"value",
				"role",
				"latex",
				"subexpr",
				"exponent",
				"with_respect_to"
			]) if (node[key] !== void 0 && node[key] !== null) info[key] = node[key];
			this._nodeData[sid] = info;
			if (node.subexpr) this._subexprs[sid] = node.subexpr;
		}
	}
	_buildEdgeList() {
		const sanitize = SemanticGraphPanel.sanitizeId;
		this._edges = (this.graph.edges || []).map((e) => [sanitize(e.from), sanitize(e.to)]);
	}
	_createTooltip() {
		const el = document.createElement("div");
		el.className = "graph-panel-tooltip";
		document.body.appendChild(el);
		return el;
	}
	_createPanel() {
		const el = document.createElement("div");
		el.className = "graph-panel-info";
		el.innerHTML = "<div class=\"gp-header\"><h3>Node Details</h3><button class=\"gp-close\">&times;</button></div><div class=\"gp-symbol\"></div><div class=\"gp-fields\"></div>";
		el.querySelector(".gp-close").addEventListener("click", () => {
			el.classList.remove("open");
		});
		this._injectPanelAskButton(el);
		document.body.appendChild(el);
		return el;
	}
	_injectPanelAskButton(panelEl) {
		const header = panelEl.querySelector(".gp-header") || panelEl;
		const btn = makeAiAskButton("ai-ask-btn graph-panel-ai-btn", "Ask AI about this node", () => this._buildNodeAskMessage(this._activeNode));
		const close = header.querySelector(".gp-close");
		if (close) header.insertBefore(btn, close);
		else header.appendChild(btn);
		this._panelAskBtn = btn;
	}
	_buildNodeAskMessage(nodeId) {
		if (!nodeId) return "Explain this graph node.";
		const data = this._nodeData[nodeId] || {};
		const subexpr = this._subexprs[nodeId];
		const lines = ["Explain this semantic graph node:"];
		if (data.label) lines.push(`Label: ${data.label}`);
		if (data.type) lines.push(`Type: ${data.type}`);
		if (data.role) lines.push(`Role: ${data.role}`);
		if (data.quantity) lines.push(`Quantity: ${data.quantity}`);
		if (data.dimension) lines.push(`Dimension: ${data.dimension}`);
		if (data.unit) lines.push(`Unit: ${data.unit}`);
		if (data.value !== void 0) lines.push(`Value: ${data.value}`);
		if (data.op) lines.push(`Operation: ${data.op}`);
		if (subexpr) lines.push(`Expression: $${subexpr}$`);
		if (data.description) lines.push(`Description: ${data.description}`);
		const incoming = [];
		const outgoing = [];
		for (const [src, dst] of this._edges) {
			if (dst === nodeId && src !== nodeId) incoming.push(src);
			if (src === nodeId && dst !== nodeId) outgoing.push(dst);
		}
		if (incoming.length) lines.push(`Incoming: ${incoming.join(", ")}`);
		if (outgoing.length) lines.push(`Outgoing: ${outgoing.join(", ")}`);
		return lines.join("\n");
	}
	_getUpstream(nodeId) {
		const visited = /* @__PURE__ */ new Set();
		const queue = [nodeId];
		while (queue.length) {
			const cur = queue.shift();
			if (visited.has(cur)) continue;
			visited.add(cur);
			for (const [src, dst] of this._edges) if (dst === cur && !visited.has(src)) queue.push(src);
		}
		return visited;
	}
	_getUpstreamEdgeIndices(upstream) {
		const indices = /* @__PURE__ */ new Set();
		this._edges.forEach(([src, dst], i) => {
			if (upstream.has(src) && upstream.has(dst)) indices.add(i);
		});
		return indices;
	}
	_highlight(nodeId) {
		const svg = this.container.querySelector("svg");
		if (!svg) return;
		const upstream = this._getUpstream(nodeId);
		const upEdges = this._getUpstreamEdgeIndices(upstream);
		svg.querySelectorAll(".node").forEach((el) => {
			const id = el.id.replace(/^flowchart-/, "").replace(/-\d+$/, "");
			el.style.opacity = upstream.has(id) ? "1" : "0.15";
		});
		svg.querySelectorAll(".edgePath, .flowchart-link").forEach((el, i) => {
			el.style.opacity = upEdges.has(i) ? "1" : "0.1";
		});
		svg.querySelectorAll(".edgeLabel").forEach((el, i) => {
			el.style.opacity = upEdges.has(i) ? "1" : "0.1";
		});
	}
	_clearHighlight() {
		const svg = this.container.querySelector("svg");
		if (!svg) return;
		svg.querySelectorAll(".node, .edgePath, .flowchart-link, .edgeLabel").forEach((el) => {
			el.style.opacity = "1";
		});
	}
	_showPanel(nodeId) {
		const data = this._nodeData[nodeId];
		if (!data) {
			this.panel.classList.remove("open");
			return;
		}
		const symbolEl = this.panel.querySelector(".gp-symbol");
		const fieldsEl = this.panel.querySelector(".gp-fields");
		const emoji = data.emoji || "";
		this._subexprs[nodeId];
		const isOp = data.type === "operator" || data.type === "relation" || data.type === "function";
		const titleLatex = nodeLongLabel(data) || null;
		const titleText = data.id || "";
		const showEmoji = emoji && !isOp;
		if (titleLatex && this.katex) try {
			const mathSpan = document.createElement("span");
			this.katex.render(titleLatex, mathSpan, {
				displayMode: false,
				throwOnError: false
			});
			symbolEl.innerHTML = "";
			if (showEmoji) symbolEl.appendChild(document.createTextNode(emoji));
			symbolEl.appendChild(mathSpan);
		} catch (_) {
			symbolEl.textContent = (showEmoji ? emoji + " " : "") + titleText;
		}
		else symbolEl.textContent = (showEmoji ? emoji + " " : "") + titleText;
		fieldsEl.innerHTML = "";
		for (const [key, label] of PANEL_FIELDS) {
			if (!data[key]) continue;
			if (key === "label" && data.label === titleLatex) continue;
			const row = document.createElement("div");
			row.className = "gp-field";
			const keyEl = document.createElement("span");
			keyEl.className = "gp-key";
			keyEl.textContent = label;
			const valEl = document.createElement("span");
			valEl.className = "gp-val";
			if (key === "label" && typeof window !== "undefined" && typeof window.renderKaTeX === "function") valEl.innerHTML = window.renderKaTeX(data.label, false);
			else valEl.textContent = String(data[key]);
			row.append(keyEl, valEl);
			fieldsEl.appendChild(row);
		}
		if (data.description) {
			const desc = document.createElement("div");
			desc.className = "gp-description";
			if (typeof window !== "undefined" && typeof window.renderKaTeX === "function") desc.innerHTML = window.renderKaTeX(data.description, false);
			else desc.textContent = data.description;
			fieldsEl.appendChild(desc);
		}
		this.panel.classList.add("open");
	}
	_ensureNodeAskBtn() {
		if (this._nodeAskBtn) return this._nodeAskBtn;
		const btn = makeAiAskButton("ai-ask-btn graph-node-ai-btn", "Ask AI about this node", () => this._buildNodeAskMessage(this._hoveredAskNodeId || this._activeNode));
		btn.style.position = "fixed";
		btn.style.opacity = "0";
		btn.style.pointerEvents = "none";
		btn.style.zIndex = "950";
		btn.addEventListener("mouseenter", () => this._cancelNodeAskHide());
		btn.addEventListener("mouseleave", () => this._hideNodeAskBtn());
		document.body.appendChild(btn);
		this._nodeAskBtn = btn;
		return btn;
	}
	_showNodeAskBtnFor(nodeEl) {
		const btn = this._ensureNodeAskBtn();
		this._cancelNodeAskHide();
		const r = nodeEl.getBoundingClientRect();
		btn.style.left = r.right - 6 + "px";
		btn.style.top = r.top - 10 + "px";
		btn.style.opacity = "1";
		btn.style.pointerEvents = "auto";
	}
	_cancelNodeAskHide() {
		if (this._nodeAskHideTimer) {
			clearTimeout(this._nodeAskHideTimer);
			this._nodeAskHideTimer = null;
		}
	}
	_hideNodeAskBtn() {
		if (!this._nodeAskBtn) return;
		const btn = this._nodeAskBtn;
		this._cancelNodeAskHide();
		this._nodeAskHideTimer = setTimeout(() => {
			btn.style.opacity = "0";
			btn.style.pointerEvents = "none";
		}, 220);
	}
	attach() {
		const svg = this.container.querySelector("svg");
		if (!svg) return;
		this._askNodeEls = [];
		svg.querySelectorAll(".node").forEach((el) => {
			const id = el.id.replace(/^flowchart-/, "").replace(/-\d+$/, "");
			const expr = this._subexprs[id];
			el.style.cursor = "pointer";
			if (expr && this.katex) {
				const katexLib = this.katex;
				const onEnter = (e) => {
					katexLib.render(expr, this.tooltip, {
						displayMode: true,
						throwOnError: false
					});
					this.tooltip.classList.add("visible");
				};
				const onMove = (e) => {
					this.tooltip.style.left = e.clientX + 16 + "px";
					this.tooltip.style.top = e.clientY - 40 + "px";
				};
				const onLeave = () => {
					this.tooltip.classList.remove("visible");
				};
				el.addEventListener("mouseenter", onEnter);
				el.addEventListener("mousemove", onMove);
				el.addEventListener("mouseleave", onLeave);
				this._handlers.push([
					el,
					"mouseenter",
					onEnter
				]);
				this._handlers.push([
					el,
					"mousemove",
					onMove
				]);
				this._handlers.push([
					el,
					"mouseleave",
					onLeave
				]);
			}
			const onClick = (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (this._activeNode === id) {
					this._activeNode = null;
					this._clearHighlight();
					this.panel.classList.remove("open");
					this._hideNodeAskBtn();
				} else {
					this._activeNode = id;
					this._highlight(id);
					this._showPanel(id);
				}
				this._emitSelectionChange();
			};
			el.addEventListener("click", onClick);
			this._handlers.push([
				el,
				"click",
				onClick
			]);
			this._askNodeEls = this._askNodeEls || [];
			this._askNodeEls.push({
				id,
				el
			});
		});
		const onDocClick = (e) => {
			if (this._activeNode === null) return;
			if (this.panel.contains(e.target)) return;
			if (!this.container.contains(e.target)) return;
			if (e.target.closest && e.target.closest(".node")) return;
			this._activeNode = null;
			this._clearHighlight();
			this.panel.classList.remove("open");
			this._hideNodeAskBtn();
			this._emitSelectionChange();
		};
		document.addEventListener("click", onDocClick);
		this._handlers.push([
			document,
			"click",
			onDocClick
		]);
		const onPointerMove = (e) => {
			const x = e.clientX;
			const y = e.clientY;
			const btn = this._nodeAskBtn;
			if (btn) {
				const br = btn.getBoundingClientRect();
				const padded = (r, pad) => x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
				if (btn.style.opacity === "1" && padded(br, 12)) {
					this._cancelNodeAskHide();
					return;
				}
			}
			let bestEl = null;
			let bestId = null;
			let bestDist = Infinity;
			for (const { id, el } of this._askNodeEls || []) {
				const op = el.style.opacity;
				if (op && parseFloat(op) < .9) continue;
				const r = el.getBoundingClientRect();
				const padX = 24;
				const padY = 18;
				if (x >= r.left - padX && x <= r.right + padX && y >= r.top - padY && y <= r.bottom + padY) {
					const cx = (r.left + r.right) / 2;
					const cy = (r.top + r.bottom) / 2;
					const d = Math.hypot(x - cx, y - cy);
					if (d < bestDist) {
						bestDist = d;
						bestEl = el;
						bestId = id;
					}
				}
			}
			if (bestEl) {
				this._hoveredAskNodeId = bestId;
				this._showNodeAskBtnFor(bestEl);
			} else this._hideNodeAskBtn();
		};
		document.addEventListener("pointermove", onPointerMove);
		this._handlers.push([
			document,
			"pointermove",
			onPointerMove
		]);
	}
	/**
	* Programmatically activate a node — same effect as a user click.
	* No-op (returns false) if the id isn't in this graph's node index, so
	* callers can safely pass a stale id from a previous render without
	* having to check first. Returns true on successful selection.
	*/
	selectNode(nodeId) {
		if (!nodeId || !this._nodeData[nodeId]) return false;
		this._activeNode = nodeId;
		this._highlight(nodeId);
		this._showPanel(nodeId);
		this._emitSelectionChange();
		return true;
	}
	/** Currently active node id, or null. */
	get activeNode() {
		return this._activeNode;
	}
	/**
	* Return a serializable payload for a node id (sanitized id form),
	* including immediate edge neighbors. Used by chat-context builders to
	* tell the AI assistant which node the user has selected.
	*/
	getNodePayload(nodeId) {
		if (!nodeId || !this._nodeData[nodeId]) return null;
		const data = this._nodeData[nodeId];
		const subexpr = this._subexprs[nodeId] || null;
		const incoming = [];
		const outgoing = [];
		for (const [src, dst] of this._edges) {
			if (dst === nodeId && src !== nodeId) incoming.push(src);
			if (src === nodeId && dst !== nodeId) outgoing.push(dst);
		}
		return {
			...data,
			subexpr,
			neighbors: {
				incoming,
				outgoing
			}
		};
	}
	_emitSelectionChange() {
		if (typeof window === "undefined") return;
		try {
			window.dispatchEvent(new CustomEvent("algebench:graphselectionchange", { detail: {
				activeNode: this._activeNode,
				payload: this._activeNode ? this.getNodePayload(this._activeNode) : null
			} }));
		} catch {}
	}
	destroy() {
		for (const [el, evt, fn] of this._handlers) el.removeEventListener(evt, fn);
		this._handlers = [];
		if (this.tooltip.parentNode) this.tooltip.remove();
		if (this.panel.parentNode) this.panel.remove();
		if (this._nodeAskBtn && this._nodeAskBtn.parentNode) this._nodeAskBtn.remove();
		this._nodeAskBtn = null;
	}
	static sanitizeId(nodeId) {
		let out = String(nodeId);
		for (const ch of "-. {}()*") out = out.replaceAll(ch, "_");
		if (!out || !/^[A-Za-z_]/.test(out)) out = `n_${out}`;
		return out;
	}
};
//#endregion
//#region src/graph-panel/sg-chart-script.ts
var SgChartScript = class {
	/**
	* @param {Object} graph - Semantic graph JSON ({ nodes, edges })
	*/
	constructor(graph) {
		/** @type {Map<string, Object>} nodeId → node data */
		this._nodeById = /* @__PURE__ */ new Map();
		for (const n of graph.nodes || []) this._nodeById.set(n.id, n);
		/** @type {Map<string, {script:string, variables:string[]}|{error:string}>} */
		this._cache = /* @__PURE__ */ new Map();
	}
	/**
	* Check if a node can potentially produce a chart script.
	* @param {string} nodeId
	* @returns {boolean}
	*/
	canChart(nodeId) {
		const n = this._nodeById.get(nodeId);
		if (!n) return false;
		if (n.chartScript && n.chartScript.script) return true;
		if (n.subexpr) return true;
		return false;
	}
	/**
	* Get a mathjs script for the given node.
	*
	* @param {string} nodeId
	* @returns {Promise<{script:string, variables:string[]}|{error:string}>}
	*/
	async getScript(nodeId) {
		if (this._cache.has(nodeId)) return this._cache.get(nodeId);
		const n = this._nodeById.get(nodeId);
		if (!n) {
			const err = { error: `Node "${nodeId}" not found` };
			this._cache.set(nodeId, err);
			return err;
		}
		if (n.chartScript && n.chartScript.script) {
			const result = {
				script: n.chartScript.script,
				variables: n.chartScript.variables || []
			};
			this._cache.set(nodeId, result);
			return result;
		}
		const subexpr = n.subexpr;
		if (!subexpr) {
			const err = { error: "Node has no subexpr" };
			this._cache.set(nodeId, err);
			return err;
		}
		try {
			const resp = await fetch("/api/graph/generate-mathjs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ subexpr })
			});
			const data = await resp.json();
			if (!resp.ok || data.error) {
				const err = {
					error: data.error || `HTTP ${resp.status}`,
					detail: data.detail || ""
				};
				this._cache.set(nodeId, err);
				return err;
			}
			const result = {
				script: data.script,
				variables: data.variables || []
			};
			this._cache.set(nodeId, result);
			return result;
		} catch (e) {
			const err = { error: `Network error: ${e.message}` };
			this._cache.set(nodeId, err);
			return err;
		}
	}
};
//#endregion
//#region src/graph-panel/sg-chart.ts
/**
* SgChartManager — interactive Chart.js plots for semantic graph nodes.
*
* Expression evaluation is handled by the backend (SymPy→mathjs pipeline)
* and evaluated client-side via expr.ts.  Chart.js renders the results.
*
* Slider panel sits bottom-left, legend bottom-right (matching the 3D
* viewport layout convention).
*/
var CHART_JS_CDN = "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js";
var NUM_POINTS$1 = 200;
var CHART_PALETTE = [
	"#42a5f5",
	"#66bb6a",
	"#ef5350",
	"#ab47bc",
	"#ffa726",
	"#26c6da",
	"#ec407a",
	"#8d6e63"
];
var GRID_COLS = 8;
var GRID_ROWS = 8;
var GRID_GAP = 8;
var _GREEK_UNICODE = /* @__PURE__ */ new Map([
	["alpha", "α"],
	["beta", "β"],
	["gamma", "γ"],
	["delta", "δ"],
	["epsilon", "ε"],
	["zeta", "ζ"],
	["eta", "η"],
	["theta", "θ"],
	["iota", "ι"],
	["kappa", "κ"],
	["lambda", "λ"],
	["mu", "μ"],
	["nu", "ν"],
	["xi", "ξ"],
	["pi", "π"],
	["rho", "ρ"],
	["sigma", "σ"],
	["tau", "τ"],
	["upsilon", "υ"],
	["phi", "φ"],
	["chi", "χ"],
	["psi", "ψ"],
	["omega", "ω"],
	["Gamma", "Γ"],
	["Delta", "Δ"],
	["Theta", "Θ"],
	["Lambda", "Λ"],
	["Pi", "Π"],
	["Sigma", "Σ"],
	["Phi", "Φ"],
	["Psi", "Ψ"],
	["Omega", "Ω"],
	["nabla", "∇"],
	["partial", "∂"],
	["infty", "∞"],
	["hbar", "ℏ"],
	["ell", "ℓ"]
]);
var _GREEK_LATEX = /* @__PURE__ */ new Map([
	["alpha", "\\alpha"],
	["beta", "\\beta"],
	["gamma", "\\gamma"],
	["delta", "\\delta"],
	["epsilon", "\\epsilon"],
	["zeta", "\\zeta"],
	["eta", "\\eta"],
	["theta", "\\theta"],
	["iota", "\\iota"],
	["kappa", "\\kappa"],
	["lambda", "\\lambda"],
	["mu", "\\mu"],
	["nu", "\\nu"],
	["xi", "\\xi"],
	["pi", "\\pi"],
	["rho", "\\rho"],
	["sigma", "\\sigma"],
	["tau", "\\tau"],
	["upsilon", "\\upsilon"],
	["phi", "\\phi"],
	["chi", "\\chi"],
	["psi", "\\psi"],
	["omega", "\\omega"],
	["Gamma", "\\Gamma"],
	["Delta", "\\Delta"],
	["Theta", "\\Theta"],
	["Lambda", "\\Lambda"],
	["Pi", "\\Pi"],
	["Sigma", "\\Sigma"],
	["Phi", "\\Phi"],
	["Psi", "\\Psi"],
	["Omega", "\\Omega"],
	["nabla", "\\nabla"],
	["partial", "\\partial"],
	["infty", "\\infty"],
	["hbar", "\\hbar"],
	["ell", "\\ell"],
	["vec", "\\vec{v}"]
]);
function _displayVar(name) {
	let out = name.replace(/_tprime$/, "'''").replace(/_dprime$/, "''").replace(/_prime$/, "'");
	if (_GREEK_UNICODE.has(out)) return _GREEK_UNICODE.get(out);
	const uIdx = out.indexOf("_");
	if (uIdx > 0) {
		const base = out.slice(0, uIdx);
		const sub = out.slice(uIdx + 1);
		const greek = _GREEK_UNICODE.get(base);
		if (greek) return `${greek}_${sub}`;
	}
	return out;
}
function _latexVar(name) {
	let out = name.replace(/_tprime$/, "'''").replace(/_dprime$/, "''").replace(/_prime$/, "'");
	if (_GREEK_LATEX.has(out)) return _GREEK_LATEX.get(out);
	const uIdx = out.indexOf("_");
	if (uIdx > 0) {
		const base = out.slice(0, uIdx);
		const sub = out.slice(uIdx + 1);
		const greek = _GREEK_LATEX.get(base);
		if (greek) return `${greek}_{${sub}}`;
	}
	return out;
}
var _RELATION_RE = /(?:^|[^\\])=|\\(?:leq|geq|neq|lt|gt|le|ge)\b|[<>]/;
function _relationToLhsMinusRhs(latex) {
	const m = /(?:^|[^\\])(=)|\\(leq|geq|neq|lt|gt|le|ge)\b|([<>])/.exec(latex);
	if (m) {
		const op = m[0];
		const opIdx = m.index;
		let sepStart = opIdx;
		let sepEnd = opIdx + op.length;
		if (m[1] && op.length > 1) sepStart = opIdx + op.length - 1;
		const lhs = latex.slice(0, sepStart).trim();
		const rhs = latex.slice(sepEnd).trim();
		if (lhs && rhs) return `${lhs} - \\left(${rhs}\\right)`;
	}
	return latex;
}
var _chartJsLoaded = false;
var _chartJsPromise = null;
function loadChartJs() {
	if (_chartJsLoaded) return Promise.resolve();
	if (_chartJsPromise) return _chartJsPromise;
	_chartJsPromise = new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = CHART_JS_CDN;
		s.onload = () => {
			_chartJsLoaded = true;
			resolve();
		};
		s.onerror = reject;
		document.head.appendChild(s);
	});
	_chartJsPromise.catch(() => {
		_chartJsPromise = null;
	});
	return _chartJsPromise;
}
function autoRange(varName) {
	const lower = varName.toLowerCase();
	if (lower.includes("angle") || lower === "θ" || lower === "theta" || lower === "φ" || lower === "phi" || lower === "α" || lower === "β") return {
		min: 0,
		max: 2 * Math.PI,
		step: .01,
		default: Math.PI / 4
	};
	if (lower === "t" || lower === "time") return {
		min: 0,
		max: 10,
		step: .01,
		default: 1
	};
	if (lower === "r" || lower === "radius") return {
		min: 0,
		max: 5,
		step: .01,
		default: 1
	};
	if (lower === "n" || lower === "k") return {
		min: 0,
		max: 20,
		step: 1,
		default: 1
	};
	return {
		min: -5,
		max: 5,
		step: .01,
		default: 1
	};
}
var _chartIdCounter = 0;
var SgChartManager = class {
	constructor(container, graph, opts = {}) {
		this.container = container;
		this.graph = graph;
		this.katex = opts.katex || typeof window !== "undefined" && window.katex;
		this.charts = /* @__PURE__ */ new Map();
		this.pinnedCharts = [];
		this.sliderValues = {};
		this._allVariables = /* @__PURE__ */ new Set();
		this._ready = false;
		this._sliderPanel = null;
		this._pinnedPanel = null;
		this._legendPanel = null;
		this._transform = {
			x: 0,
			y: 0,
			k: 1
		};
		this._renderer = null;
		this._rafId = null;
		this._resizeObserver = null;
		this._destroyed = false;
		this._scriptService = new SgChartScript(graph);
		this._compiledScripts = /* @__PURE__ */ new Map();
		this._crosshairPlugin = this._createCrosshairPlugin();
		this._buildNodeIndex();
	}
	_buildNodeIndex() {
		this._nodeById = Object.create(null);
		for (const n of this.graph.nodes) this._nodeById[n.id] = n;
		this._childrenOf = Object.create(null);
		for (const e of this.graph.edges) {
			if (!this._childrenOf[e.to]) this._childrenOf[e.to] = [];
			this._childrenOf[e.to].push(e.from);
		}
	}
	setTransform(t) {
		this._transform = t || {
			x: 0,
			y: 0,
			k: 1
		};
		this._updateUnpinnedPositions();
	}
	/** Point this (per-step, persistent) manager at the step's current graph
	*  object — it may be replaced across re-renders (e.g. by enrichment). */
	setGraph(graph) {
		if (!graph || graph === this.graph) return;
		this.graph = graph;
		this._buildNodeIndex();
		try {
			this._scriptService = new SgChartScript(graph);
		} catch (_e) {}
	}
	/** The renderer recreates .d3-graph-card (and wipes our overlays) on every
	*  render. Re-create overlays in the fresh card and re-attach this step's
	*  open charts, so charts persist across navigation/re-renders. */
	reattach() {
		if (this._destroyed || !this._ready) return;
		this._sliderPanel = null;
		this._pinnedPanel = null;
		this._legendPanel = null;
		this._ensureOverlays();
		const card = this.container.querySelector(".d3-graph-card") || this.container;
		for (const entry of this.charts.values()) {
			const dest = entry.pinned ? this._pinnedPanel : card;
			if (dest && entry.box.parentNode !== dest) dest.appendChild(entry.box);
			this._applyGridSize(entry);
		}
		this._updateSliders();
		this._updateLegend();
		this._updateUnpinnedPositions();
		if (this._resizeObserver) {
			try {
				this._resizeObserver.disconnect();
			} catch (_e) {}
			this._resizeObserver = null;
		}
		this._observeContainerResize();
		const redraw = () => {
			if (this._destroyed) return;
			for (const entry of this.charts.values()) if (entry.chart) try {
				entry.chart.resize();
				entry.chart.update("none");
			} catch (_e) {}
		};
		requestAnimationFrame(() => {
			redraw();
			requestAnimationFrame(redraw);
		});
	}
	/**
	* Connect to a D3SemanticGraphRenderer so the chart manager can poll
	* its _currentTransform on every animation frame.  This catches ALL
	* transform sources (drag-pan, trackpad, scrollbar, zoomToFit, …)
	* regardless of whether the callback chain fires.
	*/
	setRenderer(renderer) {
		this._renderer = renderer;
		this._startTransformPolling();
		this._observeContainerResize();
	}
	_startTransformPolling() {
		if (this._rafId) return;
		const poll = () => {
			this._rafId = requestAnimationFrame(poll);
			if (!this._renderer) return;
			const rt = this._renderer._currentTransform;
			if (!rt) return;
			const cur = this._transform;
			if (rt.x !== cur.x || rt.y !== cur.y || rt.k !== cur.k) {
				this._transform = {
					x: rt.x,
					y: rt.y,
					k: rt.k
				};
				this._updateUnpinnedPositions();
			}
		};
		this._rafId = requestAnimationFrame(poll);
	}
	_stopTransformPolling() {
		if (this._rafId) {
			cancelAnimationFrame(this._rafId);
			this._rafId = null;
		}
	}
	/** Watch the graph card for size changes and realign all charts. */
	_observeContainerResize() {
		if (this._resizeObserver) return;
		const card = this.container.querySelector(".d3-graph-card") || this.container;
		this._resizeObserver = new ResizeObserver(() => {
			for (const entry of this.charts.values()) {
				this._applyGridSize(entry);
				if (entry.chart) entry.chart.resize();
			}
			this._updateUnpinnedPositions();
		});
		this._resizeObserver.observe(card);
	}
	_updateUnpinnedPositions() {
		const rect = (this.container.querySelector(".d3-graph-card") || this.container).getBoundingClientRect();
		const { x: tx, y: ty, k } = this._transform;
		const placed = [];
		for (const entry of this.charts.values()) {
			if (entry.pinned) continue;
			const boxW = entry.box.offsetWidth;
			const boxH = entry.box.offsetHeight;
			let left = entry.graphX * k + tx;
			let top = entry.graphY * k + ty;
			left = Math.max(4, Math.min(left, rect.width - boxW - 4));
			top = Math.max(4, Math.min(top, rect.height - boxH - 4));
			for (let attempt = 0; attempt < 4; attempt++) {
				let collision = false;
				for (const p of placed) if (left < p.right && left + boxW > p.left && top < p.bottom && top + boxH > p.top) {
					collision = true;
					top = p.bottom + 4;
					if (top + boxH > rect.height - 4) {
						top = 4;
						left = p.right + 4;
					}
					break;
				}
				if (!collision) break;
				left = Math.max(4, Math.min(left, rect.width - boxW - 4));
				top = Math.max(4, Math.min(top, rect.height - boxH - 4));
			}
			placed.push({
				left,
				top,
				right: left + boxW,
				bottom: top + boxH
			});
			entry.box.style.left = `${left}px`;
			entry.box.style.top = `${top}px`;
		}
	}
	async init() {
		await loadChartJs();
		this._ready = true;
		this._ensureOverlays();
	}
	_ensureOverlays() {
		const card = this.container.querySelector(".d3-graph-card") || this.container;
		if (!this._sliderPanel) {
			this._sliderPanel = document.createElement("div");
			this._sliderPanel.className = "sgc-slider-panel";
			card.appendChild(this._sliderPanel);
		}
		if (!this._pinnedPanel) {
			this._pinnedPanel = card.querySelector(".sgc-pinned-panel");
			if (!this._pinnedPanel) {
				this._pinnedPanel = document.createElement("div");
				this._pinnedPanel.className = "sgc-pinned-panel";
				card.appendChild(this._pinnedPanel);
			}
		}
		if (!this._legendPanel) {
			this._legendPanel = document.createElement("div");
			this._legendPanel.className = "sgc-legend-panel";
			card.appendChild(this._legendPanel);
		}
	}
	hasExpression(nodeId) {
		return this._scriptService.canChart(nodeId);
	}
	canChart(nodeId) {
		return this._scriptService.canChart(nodeId);
	}
	/** Return all chart entries belonging to a given node. */
	_chartsForNode(nodeId) {
		const result = [];
		for (const entry of this.charts.values()) if (entry.nodeId === nodeId) result.push(entry);
		return result;
	}
	async openChart(nodeId, anchorEl) {
		if (!this._ready) await this.init();
		if (this._destroyed) return;
		const n = this._nodeById[nodeId];
		if (!n) return;
		const result = await this._scriptService.getScript(nodeId);
		if (this._destroyed) return;
		const hasError = !result || result.error;
		const vars = hasError ? [] : result.variables;
		const scriptText = hasError ? null : result.script;
		let compiled = null;
		if (scriptText) try {
			compiled = compileExpr(scriptText);
			this._compiledScripts.set(nodeId, compiled);
		} catch (e) {
			console.warn(`[SgChart] compile error for "${nodeId}":`, e);
		}
		const chartId = `sgc-${++_chartIdCounter}`;
		const xVar = vars.length > 0 ? vars[0] : null;
		if (this._chartsForNode(nodeId).some((e) => e.xVar === xVar)) return;
		for (const v of vars) {
			this._allVariables.add(v);
			if (this.sliderValues[v] == null) {
				const range = autoRange(v);
				this.sliderValues[v] = range.default != null ? range.default : (range.min + range.max) / 2;
			}
		}
		const card = this.container.querySelector(".d3-graph-card") || this.container;
		const box = document.createElement("div");
		box.className = "sgc-chart-box";
		box.id = chartId;
		box.dataset.nodeId = nodeId;
		box.dataset.dockOrder = String(nextDockSeq());
		const header = document.createElement("div");
		header.className = "sgc-chart-header";
		const title = document.createElement("span");
		title.className = "sgc-chart-title";
		let exprLabel = n.subexpr || n.latex || n.label || n.id;
		const isRelation = (n.subexpr || n.latex) && _RELATION_RE.test(exprLabel);
		if (isRelation) exprLabel = _relationToLhsMinusRhs(exprLabel);
		this._renderTitle(title, exprLabel, xVar, isRelation);
		const controls = document.createElement("div");
		controls.className = "sgc-chart-controls";
		const xSelect = document.createElement("select");
		xSelect.className = "sgc-x-select";
		xSelect.title = "X-axis variable";
		for (const v of vars) {
			const opt = document.createElement("option");
			opt.value = v;
			opt.textContent = _displayVar(v);
			if (v === xVar) opt.selected = true;
			xSelect.appendChild(opt);
		}
		const codeBtn = document.createElement("button");
		codeBtn.className = "sgc-btn sgc-code-btn";
		codeBtn.title = "Show mathjs script";
		codeBtn.textContent = "{ }";
		codeBtn.addEventListener("click", () => this._toggleScriptTooltip(chartId, codeBtn));
		const pinBtn = document.createElement("button");
		pinBtn.className = "sgc-btn sgc-pin-btn";
		pinBtn.title = "Pin chart to overlay";
		pinBtn.innerHTML = "&#x1F4CC;";
		const closeBtn = document.createElement("button");
		closeBtn.className = "sgc-btn sgc-close-btn";
		closeBtn.title = "Close chart";
		closeBtn.textContent = "×";
		controls.appendChild(xSelect);
		controls.appendChild(codeBtn);
		controls.appendChild(pinBtn);
		controls.appendChild(closeBtn);
		header.appendChild(title);
		header.appendChild(controls);
		box.appendChild(header);
		const canvasWrap = document.createElement("div");
		canvasWrap.className = "sgc-canvas-wrap";
		let chart = null;
		if (hasError || !compiled) {
			canvasWrap.classList.add("sgc-chart-error");
			const errMsg = document.createElement("div");
			errMsg.className = "sgc-error-message";
			errMsg.textContent = result?.error || result?.detail || "Could not generate expression";
			canvasWrap.appendChild(errMsg);
			xSelect.style.display = "none";
			codeBtn.style.display = "none";
		} else {
			const canvas = document.createElement("canvas");
			canvasWrap.appendChild(canvas);
			const { data } = this._computeData(nodeId, xVar, vars);
			const chartColor = CHART_PALETTE[_chartIdCounter % CHART_PALETTE.length];
			chart = new Chart(canvas, {
				type: "line",
				plugins: [this._crosshairPlugin],
				data: {
					labels: data.map((p) => p.x),
					datasets: [{
						label: exprLabel,
						data: data.map((p) => p.y),
						borderColor: chartColor,
						backgroundColor: chartColor + "22",
						borderWidth: 2,
						pointRadius: 0,
						pointHitRadius: 6,
						fill: true,
						tension: .3,
						spanGaps: false
					}]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					animation: { duration: 200 },
					plugins: {
						legend: { display: false },
						tooltip: {
							backgroundColor: "rgba(10, 12, 26, 0.9)",
							titleColor: "#dde6ff",
							bodyColor: "#aebbd1",
							borderColor: "rgba(110, 124, 180, 0.35)",
							borderWidth: 1,
							callbacks: {
								label: (ctx) => `y = ${ctx.parsed.y?.toFixed(4)}`,
								title: (items) => `${_displayVar(xVar)} = ${items[0]?.parsed.x?.toFixed(4)}`
							}
						}
					},
					scales: {
						x: {
							type: "linear",
							title: {
								display: true,
								text: _displayVar(xVar),
								color: "#8fa8c8"
							},
							ticks: {
								color: "#7e8aa3",
								maxTicksLimit: 8,
								callback: (v) => +v.toFixed(3)
							},
							grid: { color: "rgba(110, 124, 180, 0.12)" }
						},
						y: {
							title: {
								display: true,
								text: isRelation ? "LHS − RHS" : "f(" + _displayVar(xVar) + ")",
								color: "#8fa8c8"
							},
							ticks: {
								color: "#7e8aa3",
								maxTicksLimit: 6,
								callback: (v) => +v.toFixed(3)
							},
							grid: { color: "rgba(110, 124, 180, 0.12)" }
						}
					},
					interaction: {
						mode: "index",
						intersect: false
					}
				}
			});
		}
		box.appendChild(canvasWrap);
		card.appendChild(box);
		const step = this._getGridSteps();
		const boxW = 2 * step.w + GRID_GAP;
		const boxH = 2 * step.h + GRID_GAP;
		let left = 4, top = 4;
		{
			const containerRect = card.getBoundingClientRect();
			if (anchorEl) {
				const rect = anchorEl.getBoundingClientRect();
				left = rect.right - containerRect.left + 8;
				top = rect.top - containerRect.top;
			}
			left = Math.max(4, Math.min(left, containerRect.width - boxW - 4));
			top = Math.max(4, Math.min(top, containerRect.height - boxH - 4));
			const occupied = [];
			for (const existing of this.charts.values()) {
				if (existing.pinned) continue;
				const er = existing.box.getBoundingClientRect();
				occupied.push({
					left: er.left - containerRect.left,
					top: er.top - containerRect.top,
					right: er.right - containerRect.left,
					bottom: er.bottom - containerRect.top
				});
			}
			for (let attempt = 0; attempt < 6; attempt++) {
				const myRight = left + boxW;
				const myBottom = top + boxH;
				let collision = false;
				for (const o of occupied) if (left < o.right && myRight > o.left && top < o.bottom && myBottom > o.top) {
					collision = true;
					top = o.bottom + 4;
					if (top + boxH > containerRect.height - 4) {
						top = 4;
						left = o.right + 4;
					}
					break;
				}
				if (!collision) break;
				left = Math.max(4, Math.min(left, containerRect.width - boxW - 4));
				top = Math.max(4, Math.min(top, containerRect.height - boxH - 4));
			}
			box.style.position = "absolute";
			box.style.left = `${left}px`;
			box.style.top = `${top}px`;
			box.style.zIndex = "20";
		}
		const { x: tx, y: ty, k } = this._transform;
		const _graphX = (left - tx) / k;
		const _graphY = (top - ty) / k;
		const chartColor = CHART_PALETTE[_chartIdCounter % CHART_PALETTE.length];
		const entry = {
			chartId,
			nodeId,
			chart,
			box,
			canvas: box.querySelector("canvas"),
			titleEl: title,
			exprLabel,
			xVar,
			vars,
			scriptText,
			color: chartColor,
			pinned: false,
			graphX: _graphX,
			graphY: _graphY,
			colSpan: 3,
			rowSpan: 3,
			isRelation
		};
		this.charts.set(chartId, entry);
		this._applyGridSize(entry);
		this._makeDraggable(entry);
		this._addResizeHandle(entry);
		xSelect.addEventListener("change", () => {
			entry.xVar = xSelect.value;
			this._updateChart(entry);
			this._updateSliders();
		});
		pinBtn.addEventListener("click", () => {
			const e = this.charts.get(chartId);
			if (!e) return;
			if (e.pinned) this._unpinAndRestore(chartId);
			else this._pinChart(chartId);
		});
		closeBtn.addEventListener("click", () => this.closeChart(chartId));
		this._updateSliders();
		this._updateLegend();
	}
	_toggleScriptTooltip(chartId, btnEl) {
		const existing = btnEl.parentElement?.querySelector(".sgc-script-tooltip");
		if (existing) {
			existing.remove();
			return;
		}
		const text = this.charts.get(chartId)?.scriptText || "(no script)";
		const tip = document.createElement("div");
		tip.className = "sgc-script-tooltip";
		tip.textContent = text;
		btnEl.parentElement.appendChild(tip);
		const close = (e) => {
			if (!tip.contains(e.target) && e.target !== btnEl) {
				tip.remove();
				document.removeEventListener("click", close, true);
			}
		};
		setTimeout(() => document.addEventListener("click", close, true), 0);
	}
	closeChart(chartId) {
		const entry = this.charts.get(chartId);
		if (!entry) return;
		if (entry._dragCleanup) entry._dragCleanup();
		if (entry._resizeCleanup) entry._resizeCleanup();
		if (entry.chart) entry.chart.destroy();
		entry.box.remove();
		this.charts.delete(chartId);
		if (this._chartsForNode(entry.nodeId).length === 0) this._compiledScripts.delete(entry.nodeId);
		this._unpinChart(chartId);
		this._rebuildVariableSet();
		this._updateSliders();
		this._updateLegend();
	}
	_pinChart(chartId) {
		const entry = this.charts.get(chartId);
		if (!entry || entry.pinned) return;
		entry.pinned = true;
		if (entry._dragCleanup) {
			entry._dragCleanup();
			entry._dragCleanup = null;
		}
		entry.box.classList.add("sgc-pinned");
		entry.box.style.position = "";
		entry.box.style.left = "";
		entry.box.style.top = "";
		entry.box.style.zIndex = "";
		this._pinnedPanel.appendChild(entry.box);
		this._applyGridSize(entry);
		this._addResizeHandle(entry);
		const pinBtn = entry.box.querySelector(".sgc-pin-btn");
		if (pinBtn) {
			pinBtn.innerHTML = "&#x1F4CC;";
			pinBtn.title = "Unpin from overlay";
			pinBtn.classList.add("sgc-pin-active");
		}
		this.pinnedCharts.push(chartId);
		if (entry.chart) entry.chart.resize();
	}
	_unpinChart(chartId) {
		const idx = this.pinnedCharts.indexOf(chartId);
		if (idx >= 0) this.pinnedCharts.splice(idx, 1);
	}
	_unpinAndRestore(chartId) {
		const entry = this.charts.get(chartId);
		if (!entry) return;
		entry.pinned = false;
		entry.box.classList.remove("sgc-pinned");
		const card = this.container.querySelector(".d3-graph-card") || this.container;
		card.appendChild(entry.box);
		entry.box.style.position = "absolute";
		entry.box.style.zIndex = "20";
		this._applyGridSize(entry);
		const rect = card.getBoundingClientRect();
		const boxW = entry.box.offsetWidth;
		const boxH = entry.box.offsetHeight;
		const { x: tx, y: ty, k } = this._transform;
		let left = entry.graphX * k + tx;
		let top = entry.graphY * k + ty;
		left = Math.max(4, Math.min(left, rect.width - boxW - 4));
		top = Math.max(4, Math.min(top, rect.height - boxH - 4));
		entry.box.style.left = `${left}px`;
		entry.box.style.top = `${top}px`;
		const pinBtn = entry.box.querySelector(".sgc-pin-btn");
		if (pinBtn) {
			pinBtn.innerHTML = "&#x1F4CC;";
			pinBtn.title = "Pin chart to overlay";
			pinBtn.classList.remove("sgc-pin-active");
		}
		this._unpinChart(chartId);
		this._makeDraggable(entry);
		if (entry.chart) entry.chart.resize();
	}
	_makeDraggable(entry) {
		const header = entry.box.querySelector(".sgc-chart-header");
		if (!header) return;
		let startX, startY, startLeft, startTop;
		const onMouseDown = (e) => {
			if (e.target.closest(".sgc-chart-controls")) return;
			e.preventDefault();
			const card = this.container.querySelector(".d3-graph-card") || this.container;
			const boxRect = entry.box.getBoundingClientRect();
			const cardRect = card.getBoundingClientRect();
			startX = e.clientX;
			startY = e.clientY;
			startLeft = boxRect.left - cardRect.left;
			startTop = boxRect.top - cardRect.top;
			document.addEventListener("mousemove", onMouseMove);
			document.addEventListener("mouseup", onMouseUp);
			header.style.cursor = "grabbing";
		};
		const onMouseMove = (e) => {
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			const cardRect = (this.container.querySelector(".d3-graph-card") || this.container).getBoundingClientRect();
			const boxW = entry.box.offsetWidth;
			const boxH = entry.box.offsetHeight;
			const newLeft = Math.max(4, Math.min(startLeft + dx, cardRect.width - boxW - 4));
			const newTop = Math.max(4, Math.min(startTop + dy, cardRect.height - boxH - 4));
			entry.box.style.left = `${newLeft}px`;
			entry.box.style.top = `${newTop}px`;
			const { x: tx, y: ty, k } = this._transform;
			entry.graphX = (newLeft - tx) / k;
			entry.graphY = (newTop - ty) / k;
		};
		const onMouseUp = () => {
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
			header.style.cursor = "";
		};
		header.addEventListener("mousedown", onMouseDown);
		entry._dragCleanup = () => header.removeEventListener("mousedown", onMouseDown);
	}
	_getGridSteps() {
		const rect = (this.container.querySelector(".d3-graph-card") || this.container).getBoundingClientRect();
		const availW = rect.width - 16;
		const availH = rect.height - 16;
		return {
			w: Math.floor((availW - 56) / GRID_COLS),
			h: Math.floor((availH - 56) / GRID_ROWS)
		};
	}
	_applyGridSize(entry) {
		const step = this._getGridSteps();
		const w = entry.colSpan * step.w + (entry.colSpan - 1) * GRID_GAP;
		const h = entry.rowSpan * step.h + (entry.rowSpan - 1) * GRID_GAP;
		entry.box.style.width = `${w}px`;
		entry.box.style.height = `${h}px`;
		const header = entry.box.querySelector(".sgc-chart-header");
		const headerH = header ? header.offsetHeight : 36;
		const wrap = entry.box.querySelector(".sgc-canvas-wrap");
		if (wrap) wrap.style.height = `${h - headerH - 2}px`;
	}
	_addResizeHandle(entry) {
		if (entry.box.querySelector(".sgc-resize-handle")) return;
		const handle = document.createElement("div");
		handle.className = "sgc-resize-handle";
		entry.box.appendChild(handle);
		let startX, startY, startColSpan, startRowSpan;
		const onMouseDown = (e) => {
			e.preventDefault();
			e.stopPropagation();
			startX = e.clientX;
			startY = e.clientY;
			startColSpan = entry.colSpan;
			startRowSpan = entry.rowSpan;
			document.addEventListener("mousemove", onMouseMove);
			document.addEventListener("mouseup", onMouseUp);
		};
		const onMouseMove = (e) => {
			const step = this._getGridSteps();
			const unitW = step.w + GRID_GAP;
			const unitH = step.h + GRID_GAP;
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			const colSpan = Math.max(1, Math.min(GRID_COLS, startColSpan + Math.round(dx / unitW)));
			const rowSpan = Math.max(1, Math.min(GRID_ROWS, startRowSpan + Math.round(dy / unitH)));
			if (colSpan !== entry.colSpan || rowSpan !== entry.rowSpan) {
				entry.colSpan = colSpan;
				entry.rowSpan = rowSpan;
				this._applyGridSize(entry);
				if (entry.chart) entry.chart.resize();
			}
		};
		const onMouseUp = () => {
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
		};
		handle.addEventListener("mousedown", onMouseDown);
		entry._resizeCleanup = () => {
			handle.removeEventListener("mousedown", onMouseDown);
			handle.remove();
		};
	}
	/**
	* Render the chart header title as ``f(xVar) = expression`` so the
	* user can see what the vertical axis represents.  Uses KaTeX when
	* available.
	*/
	_renderTitle(el, exprLabel, xVar, _isRelation) {
		const fullLatex = `f(${_latexVar(xVar)}) = ${exprLabel}`;
		if (this.katex) try {
			this.katex.render(fullLatex, el, {
				throwOnError: false,
				displayMode: false
			});
			return;
		} catch (_) {}
		el.textContent = `f(${_displayVar(xVar)}) = ${exprLabel}`;
	}
	_computeData(nodeId, xVar, _vars) {
		const compiled = this._compiledScripts.get(nodeId);
		if (!compiled) return {
			data: [],
			xLabel: xVar
		};
		const range = autoRange(xVar);
		const points = [];
		const step = (range.max - range.min) / NUM_POINTS$1;
		for (let i = 0; i <= NUM_POINTS$1; i++) {
			const xVal = range.min + step * i;
			const scope = { ...this.sliderValues };
			scope[xVar] = xVal;
			try {
				const y = evalExpr(compiled, 0, { extraScope: scope });
				if (Number.isFinite(y)) points.push({
					x: +xVal.toFixed(6),
					y: +y.toFixed(6)
				});
				else points.push({
					x: +xVal.toFixed(6),
					y: null
				});
			} catch (_) {
				points.push({
					x: +xVal.toFixed(6),
					y: null
				});
			}
		}
		return {
			data: points,
			xLabel: xVar
		};
	}
	_updateChart(entry) {
		if (!entry.chart) return;
		const { data } = this._computeData(entry.nodeId, entry.xVar, entry.vars);
		entry.chart.data.labels = data.map((p) => p.x);
		entry.chart.data.datasets[0].data = data.map((p) => p.y);
		const dv = _displayVar(entry.xVar);
		entry.chart.options.scales.x.title.text = dv;
		entry.chart.options.scales.y.title.text = entry.isRelation ? "LHS − RHS" : `f(${dv})`;
		entry.chart.options.plugins.tooltip.callbacks.title = (items) => `${dv} = ${items[0]?.parsed.x?.toFixed(4)}`;
		entry.chart.update("none");
		if (entry.titleEl) this._renderTitle(entry.titleEl, entry.exprLabel, entry.xVar, entry.isRelation);
	}
	_updateAllCharts() {
		for (const entry of this.charts.values()) this._updateChart(entry);
	}
	_rebuildVariableSet() {
		this._allVariables.clear();
		for (const entry of this.charts.values()) for (const v of entry.vars) this._allVariables.add(v);
	}
	_updateSliders() {
		if (!this._sliderPanel) return;
		this._sliderPanel.innerHTML = "";
		const activeVars = /* @__PURE__ */ new Set();
		for (const entry of this.charts.values()) for (const v of entry.vars) if (v !== entry.xVar) activeVars.add(v);
		if (activeVars.size === 0) {
			this._sliderPanel.classList.add("hidden");
			return;
		}
		this._sliderPanel.classList.remove("hidden");
		const title = document.createElement("div");
		title.className = "sgc-slider-title";
		title.textContent = "PARAMETERS";
		this._sliderPanel.appendChild(title);
		for (const v of [...activeVars].sort()) {
			const range = autoRange(v);
			if (this.sliderValues[v] == null) this.sliderValues[v] = range.default != null ? range.default : (range.min + range.max) / 2;
			const row = document.createElement("div");
			row.className = "sgc-slider-row";
			const label = document.createElement("span");
			label.className = "sgc-slider-label";
			if (this.katex) try {
				this.katex.render(_latexVar(v), label, {
					throwOnError: false,
					displayMode: false
				});
			} catch (_) {
				label.textContent = _displayVar(v);
			}
			else label.textContent = _displayVar(v);
			const input = document.createElement("input");
			input.type = "range";
			input.className = "sgc-slider";
			input.min = String(range.min);
			input.max = String(range.max);
			input.step = String(range.step);
			input.value = String(this.sliderValues[v]);
			const val = document.createElement("span");
			val.className = "sgc-slider-value";
			val.textContent = (+this.sliderValues[v]).toFixed(2);
			input.addEventListener("input", () => {
				this.sliderValues[v] = parseFloat(input.value);
				val.textContent = (+input.value).toFixed(2);
				this._updateAllCharts();
			});
			row.appendChild(label);
			row.appendChild(input);
			row.appendChild(val);
			this._sliderPanel.appendChild(row);
		}
	}
	_createCrosshairPlugin() {
		const mgr = this;
		return {
			id: "sgcCrosshair",
			afterEvent(chart, args) {
				const event = args.event;
				if (event.type === "mousemove") {
					const elements = chart.getElementsAtEventForMode(event, "index", { intersect: false }, false);
					if (elements.length > 0) mgr._syncCrosshair(chart, elements[0].index);
				} else if (event.type === "mouseout") mgr._clearCrosshair(chart);
			},
			afterDraw(chart) {
				if (chart._sgcSyncIndex == null) return;
				const meta = chart.getDatasetMeta(0);
				if (!meta || !meta.data) return;
				const point = meta.data[chart._sgcSyncIndex];
				if (!point) return;
				const { top, bottom } = chart.chartArea;
				const ctx = chart.ctx;
				ctx.save();
				ctx.strokeStyle = "rgba(150, 170, 220, 0.4)";
				ctx.lineWidth = 1;
				ctx.setLineDash([4, 4]);
				ctx.beginPath();
				ctx.moveTo(point.x, top);
				ctx.lineTo(point.x, bottom);
				ctx.stroke();
				ctx.restore();
			}
		};
	}
	_syncCrosshair(sourceChart, index) {
		let sourceXVar = null;
		for (const entry of this.charts.values()) if (entry.chart === sourceChart) {
			sourceXVar = entry.xVar;
			break;
		}
		for (const entry of this.charts.values()) {
			if (!entry.chart || entry.chart === sourceChart) continue;
			if (entry.xVar !== sourceXVar) continue;
			if (index >= (entry.chart.data.datasets[0]?.data?.length || 0)) continue;
			entry.chart._sgcSyncIndex = index;
			entry.chart.setActiveElements([{
				datasetIndex: 0,
				index
			}]);
			entry.chart.tooltip.setActiveElements([{
				datasetIndex: 0,
				index
			}], {
				x: 0,
				y: 0
			});
			entry.chart.update("none");
		}
	}
	_clearCrosshair(sourceChart) {
		for (const entry of this.charts.values()) {
			if (!entry.chart || entry.chart === sourceChart) continue;
			if (entry.chart._sgcSyncIndex == null) continue;
			entry.chart._sgcSyncIndex = null;
			entry.chart.setActiveElements([]);
			entry.chart.tooltip.setActiveElements([], {
				x: 0,
				y: 0
			});
			entry.chart.update("none");
		}
	}
	_updateLegend() {
		if (!this._legendPanel) return;
		this._legendPanel.innerHTML = "";
		if (this.charts.size < 2) {
			this._legendPanel.classList.add("hidden");
			this._emitLegendChange();
			return;
		}
		this._legendPanel.classList.remove("hidden");
		const parent = this._legendPanel.parentElement;
		const edgeLegend = parent ? parent.querySelector(".d3sg-edge-legend") : null;
		const edgeVisible = edgeLegend && !edgeLegend.classList.contains("hidden") && edgeLegend.offsetParent !== null;
		this._legendPanel.style.right = edgeVisible ? `${edgeLegend.offsetWidth + 16}px` : "8px";
		const title = document.createElement("div");
		title.className = "sgc-legend-title";
		title.textContent = "CHARTS";
		this._legendPanel.appendChild(title);
		for (const entry of this.charts.values()) {
			const item = document.createElement("div");
			item.className = "sgc-legend-item";
			const swatch = document.createElement("span");
			swatch.className = "sgc-legend-swatch";
			swatch.style.background = entry.color;
			const name = document.createElement("span");
			name.className = "sgc-legend-name";
			const n = this._nodeById[entry.nodeId];
			const lbl = n?.label || n?.latex || entry.nodeId;
			if (this.katex && (n?.latex || n?.subexpr)) try {
				this.katex.render(n.latex || n.subexpr, name, {
					throwOnError: false,
					displayMode: false
				});
			} catch (_) {
				name.textContent = lbl;
			}
			else name.textContent = lbl;
			item.appendChild(swatch);
			item.appendChild(name);
			this._legendPanel.appendChild(item);
		}
		this._emitLegendChange();
	}
	_emitLegendChange() {
		try {
			document.dispatchEvent(new CustomEvent("sgc:legend-change"));
		} catch (_) {}
	}
	destroy() {
		this._destroyed = true;
		this._stopTransformPolling();
		if (this._resizeObserver) {
			this._resizeObserver.disconnect();
			this._resizeObserver = null;
		}
		for (const entry of this.charts.values()) {
			if (entry._dragCleanup) entry._dragCleanup();
			if (entry._resizeCleanup) entry._resizeCleanup();
			if (entry.chart) entry.chart.destroy();
			entry.box.remove();
		}
		this.charts.clear();
		this._compiledScripts.clear();
		this.pinnedCharts = [];
		if (this._sliderPanel) this._sliderPanel.remove();
		if (this._pinnedPanel) this._pinnedPanel.remove();
		if (this._legendPanel) this._legendPanel.remove();
	}
};
//#endregion
//#region src/graph-panel/fa-page.ts
var REQUEST_TIMEOUT_MS = 18e4;
var NUM_POINTS = 220;
var TAU = Math.PI * 2;
var SERIES_COLORS = [
	"#42a5f5",
	"#ffa726",
	"#66bb6a",
	"#ab47bc"
];
var ANNOTATION_COLOR = "rgba(239, 83, 80, 0.75)";
var BAND_FILL = "rgba(66, 165, 245, 0.10)";
var _FA_CACHE = /* @__PURE__ */ new Map();
var _FA_CACHE_MAX = 32;
var _cacheKey = (p) => JSON.stringify({
	l: p.latex,
	v: p.variable || "",
	c: p.context || ""
});
/** Insert with oldest-first eviction (Map preserves insertion order). */
function _cacheSet(key, data) {
	_FA_CACHE.set(key, data);
	while (_FA_CACHE.size > _FA_CACHE_MAX) _FA_CACHE.delete(_FA_CACHE.keys().next().value);
}
/** Drop every cached analysis — call on a new lesson, whose steps and
*  context no longer match anything stored (see clearDeriveCache). */
function clearAnalysisCache() {
	_FA_CACHE.clear();
}
var _idCounter = 0;
/** Greek-ish LaTeX → readable text for the PLAIN contexts only: view-tab
*  captions, `title` tooltips, and the Chart.js `dataset.label` fallback.
*  Anything that must LOOK like math goes through KaTeX instead (the HTML
*  legend, tooltip, axis titles) — this is a degradation, not a renderer.
*  Text-ish wrappers are unwrapped BEFORE braces are stripped, or
*  `\text{rad/s}` degrades into the literal `\text rad/s`. */
function detex(s) {
	return String(s || "").replace(/\\(?:text|textrm|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, "$1").replace(/\\(?:quad|qquad)|\\[,;:! ]/g, " ").replace(/\\cdot(?![a-zA-Z])/g, "·").replace(/\\(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Pi|Sigma|Phi|Psi|Omega)/g, (_, name) => ({
		alpha: "α",
		beta: "β",
		gamma: "γ",
		delta: "δ",
		epsilon: "ε",
		zeta: "ζ",
		eta: "η",
		theta: "θ",
		iota: "ι",
		kappa: "κ",
		lambda: "λ",
		mu: "μ",
		nu: "ν",
		xi: "ξ",
		pi: "π",
		rho: "ρ",
		sigma: "σ",
		tau: "τ",
		upsilon: "υ",
		phi: "φ",
		chi: "χ",
		psi: "ψ",
		omega: "ω",
		Gamma: "Γ",
		Delta: "Δ",
		Theta: "Θ",
		Lambda: "Λ",
		Pi: "Π",
		Sigma: "Σ",
		Phi: "Φ",
		Psi: "Ψ",
		Omega: "Ω"
	})[name] || name).replace(/[{}$]/g, "").replace(/\s+/g, " ").trim();
}
var FunctionAnalysisManager = class {
	/**
	* @param {Object} opts
	*   getViewport      () => #graph-viewport element
	*   katex            window.katex
	*   onArtifactsChanged (step) => void   — rebuild the Math tab tree
	*   onPageClosed     () => void         — restore the graph view
	*   onActiveChanged  () => void         — the shown artifact (or its id) changed
	*   buildContext     (step) => string   — lesson/step context for the expert
	*/
	constructor(opts = {}) {
		this.katex = opts.katex || typeof window !== "undefined" && window.katex;
		this.getViewport = opts.getViewport || (() => document.getElementById("graph-viewport"));
		this.onArtifactsChanged = opts.onArtifactsChanged || (() => {});
		this.onPageClosed = opts.onPageClosed || (() => {});
		this.onActiveChanged = opts.onActiveChanged || (() => {});
		this.buildContext = opts.buildContext || (() => "");
		this.pageEl = null;
		this.activeArtifact = null;
		this._charts = [];
		this._hiddenEls = [];
		this._hiddenGroups = /* @__PURE__ */ new Set();
		this._hiddenMarks = /* @__PURE__ */ new Set();
		this._hiddenSeries = /* @__PURE__ */ new Set();
		this._pinnedTip = null;
		this._pinnedChart = null;
		this._pinnedPoints = null;
		this._byStep = /* @__PURE__ */ new WeakMap();
	}
	/** Artifacts attached to a step (render order). */
	listFor(step) {
		return step && this._byStep.get(step) || [];
	}
	/** The artifact with `id` on `step`, or null. Ids are session-scoped: the
	*  expert assigns one on success, replacing the `fa-pending-N` placeholder
	*  the artifact was born with. BOTH stay matchable (the placeholder is kept
	*  as `pendingId`) so a URL captured mid-analysis still resolves after the
	*  id settles. */
	findById(step, id) {
		if (!id) return null;
		return this.listFor(step).find((a) => a.id === id || a.pendingId === id) || null;
	}
	/** Start a new analysis for a node's subexpr, attached to `step`.
	*  Re-clicking a node whose analysis already exists re-focuses it
	*  (same dedup contract as SgProofManager) — multiple artifacts per
	*  step are for DIFFERENT expressions, not accidental double-clicks. */
	open(nodeData, step) {
		if (!step) return;
		const latex = nodeData.subexpr || nodeData.latex;
		if (!latex) return;
		const existing = this.listFor(step).find((a) => a.nodeId === nodeData.id && a.latex === latex);
		if (existing) {
			this.show(existing);
			return;
		}
		const pendingId = `fa-pending-${++_idCounter}`;
		const artifact = {
			id: pendingId,
			pendingId,
			title: "",
			status: "loading",
			latex,
			nodeId: nodeData.id,
			step,
			data: null,
			error: null
		};
		const list = this._byStep.get(step) || [];
		list.push(artifact);
		this._byStep.set(step, list);
		this.onArtifactsChanged(step);
		this.show(artifact);
		this._run(artifact);
	}
	async _run(artifact) {
		const payload = {
			latex: artifact.latex,
			context: String(this.buildContext(artifact.step) || "").slice(0, 2e3)
		};
		const key = _cacheKey(payload);
		artifact.cacheKey = key;
		try {
			let data = _FA_CACHE.get(key);
			if (!data) {
				data = await invokeExpert("expression_analysis", payload, { timeoutMs: REQUEST_TIMEOUT_MS });
				if (data && data.characteristics && !data.characteristics.error) _cacheSet(key, data);
			}
			if (data && data.characteristics && data.characteristics.error) throw new Error(data.characteristics.error);
			artifact.status = "ready";
			artifact.data = data;
			artifact.id = data.id || artifact.id;
			artifact.title = data.title || data.proposal && data.proposal.title || "Function analysis";
		} catch (e) {
			artifact.status = "error";
			artifact.error = e && e.message || "Analysis failed.";
		}
		this.onArtifactsChanged(artifact.step);
		if (this.activeArtifact === artifact) this.show(artifact, { replace: true });
	}
	retry(artifact) {
		artifact.status = "loading";
		artifact.error = null;
		this.onArtifactsChanged(artifact.step);
		this.show(artifact, { replace: true });
		this._run(artifact);
	}
	/** Delete an artifact: drop it from its step, evict its cached response
	*  (so re-triggering the same node genuinely re-analyzes), and close
	*  the page if it is the one showing. */
	remove(artifact) {
		const list = this._byStep.get(artifact.step);
		if (Array.isArray(list)) {
			const i = list.indexOf(artifact);
			if (i >= 0) list.splice(i, 1);
		}
		if (artifact.cacheKey) _FA_CACHE.delete(artifact.cacheKey);
		if (this.activeArtifact === artifact) this.close();
		this.onArtifactsChanged(artifact.step);
	}
	_ensurePage() {
		if (this.pageEl && this.pageEl.isConnected) return this.pageEl;
		const vp = this.getViewport();
		if (!vp) return null;
		const el = document.createElement("div");
		el.id = "fa-page-container";
		vp.appendChild(el);
		this.pageEl = el;
		return el;
	}
	/** Show the page for an artifact (loading, error, or ready).
	*  `opts.replace` marks this as a re-show of the artifact already on screen
	*  (an id settling, a retry) rather than a new view — see onActiveChanged. */
	show(artifact, opts = {}) {
		const page = this._ensurePage();
		if (!page) return;
		this.activeArtifact = artifact;
		this._hideGraphChrome();
		page.classList.add("open");
		this._render(artifact);
		this.onArtifactsChanged(artifact.step);
		this.onActiveChanged({ replace: !!opts.replace });
	}
	/** Close the page and restore the graph view. */
	close() {
		this.activeArtifact = null;
		this._destroyCharts();
		if (this.pageEl) this.pageEl.classList.remove("open");
		this._restoreGraphChrome();
		this.onPageClosed();
		this.onActiveChanged({ replace: false });
	}
	isOpen() {
		return !!(this.pageEl && this.pageEl.classList.contains("open"));
	}
	_hideGraphChrome() {
		if (this._hiddenEls.length) return;
		const vp = this.getViewport();
		if (!vp) return;
		for (const child of vp.children) {
			if (child === this.pageEl) continue;
			if (!child.classList.contains("hidden")) {
				child.classList.add("fa-hidden");
				this._hiddenEls.push(child);
			}
		}
	}
	_restoreGraphChrome() {
		for (const el of this._hiddenEls) el.classList.remove("fa-hidden");
		this._hiddenEls = [];
	}
	_destroyCharts() {
		this._unpinTip();
		for (const c of this._charts) try {
			c.destroy();
		} catch (_e) {}
		this._charts = [];
	}
	_render(artifact) {
		const page = this.pageEl;
		this._destroyCharts();
		this._hiddenGroups = /* @__PURE__ */ new Set();
		this._hiddenMarks = /* @__PURE__ */ new Set();
		this._hiddenSeries = /* @__PURE__ */ new Set();
		page.innerHTML = "";
		page.appendChild(this._renderHeader(artifact));
		if (artifact.status === "loading") {
			page.appendChild(this._renderLoading(artifact));
			return;
		}
		if (artifact.status === "error") {
			page.appendChild(this._renderErrorCard(artifact));
			return;
		}
		const proposal = artifact.data && artifact.data.proposal || {};
		const chars = artifact.data && artifact.data.characteristics || {};
		if (proposal.abstain) {
			if (proposal.failed) {
				artifact.error = "The analysis request failed before a proposal could be made.";
				page.appendChild(this._renderErrorCard(artifact));
				return;
			}
			const card = document.createElement("div");
			card.className = "fa-card fa-abstain";
			const badge = document.createElement("span");
			badge.className = "fa-ai-badge";
			badge.title = "AI-generated";
			badge.innerHTML = AI_ICON;
			const text = document.createElement("span");
			this._inlineMath(text, " " + (proposal.abstain_reason || "Nothing behaviorally interesting to visualize here."));
			card.append(badge, text);
			page.appendChild(card);
			return;
		}
		if (proposal.story) page.appendChild(this._renderStory(artifact, proposal));
		page.appendChild(this._renderViews(artifact, chars, proposal));
		page.appendChild(this._renderQuiz(artifact, chars, proposal));
		page.appendChild(this._renderJsonPanel(artifact));
	}
	_renderHeader(artifact) {
		const head = document.createElement("div");
		head.className = "fa-header";
		const back = document.createElement("button");
		back.className = "fa-btn fa-back";
		back.title = "Back to semantic graph";
		back.innerHTML = "&#8592;";
		back.addEventListener("click", () => this.close());
		const title = document.createElement("span");
		title.className = "fa-title";
		title.textContent = artifact.title || "Function analysis";
		const expr = document.createElement("span");
		expr.className = "fa-expr";
		this._katex(expr, artifact.latex);
		head.append(back, title, expr);
		if (artifact.status === "ready") {
			const jsonBtn = document.createElement("button");
			jsonBtn.className = "fa-btn fa-json-btn";
			jsonBtn.title = "Show the raw analysis JSON";
			jsonBtn.innerHTML = BRACES_ICON;
			jsonBtn.addEventListener("click", () => {
				const overlay = this.pageEl.querySelector(".fa-json-overlay");
				if (overlay) overlay.classList.toggle("open");
			});
			head.appendChild(jsonBtn);
		}
		const del = document.createElement("button");
		del.className = "fa-btn fa-delete-btn";
		del.title = "Delete this analysis";
		del.innerHTML = TRASH_ICON;
		del.addEventListener("click", () => this.remove(artifact));
		head.appendChild(del);
		return head;
	}
	_renderLoading(artifact) {
		const wrap = document.createElement("div");
		wrap.className = "fa-card fa-status";
		wrap.innerHTML = "<span class=\"sgp-dots\"><span></span><span></span><span></span></span>";
		const label = document.createElement("span");
		label.className = "fa-status-label";
		label.appendChild(document.createTextNode("Analyzing "));
		const m = document.createElement("span");
		this._katex(m, artifact.latex);
		label.appendChild(m);
		label.appendChild(document.createTextNode("…"));
		wrap.appendChild(label);
		return wrap;
	}
	_renderErrorCard(artifact) {
		const wrap = document.createElement("div");
		wrap.className = "fa-card fa-error";
		const msg = document.createElement("div");
		msg.textContent = artifact.error || "Analysis failed.";
		const retry = document.createElement("button");
		retry.className = "fa-btn fa-retry";
		retry.textContent = "Retry";
		retry.addEventListener("click", () => this.retry(artifact));
		wrap.append(msg, retry);
		return wrap;
	}
	_renderStory(artifact, proposal) {
		const card = document.createElement("div");
		card.className = "fa-card fa-story";
		const badge = document.createElement("span");
		badge.className = "fa-ai-badge";
		badge.title = "AI-generated";
		badge.innerHTML = AI_ICON;
		const text = document.createElement("span");
		this._inlineMath(text, " " + proposal.story);
		card.append(badge, text);
		this._attachHoverAsk(card, () => `About $${artifact.latex}$ — the analysis says: "${proposal.story}". Can you explain this behavior in more depth?`);
		return card;
	}
	_renderViews(artifact, chars, proposal) {
		const card = document.createElement("div");
		card.className = "fa-card fa-views";
		const views = (proposal.views || []).filter((v) => !v.unknown_symbols);
		if (!views.length) {
			card.textContent = "No renderable viewport was proposed.";
			return card;
		}
		const tabs = document.createElement("div");
		tabs.className = "fa-view-tabs";
		const rationale = document.createElement("div");
		rationale.className = "fa-view-rationale";
		const legend = document.createElement("div");
		legend.className = "fa-ann-legend";
		const canvasWrap = document.createElement("div");
		canvasWrap.className = "fa-canvas-wrap";
		const exprPanel = document.createElement("div");
		exprPanel.className = "fa-expr-panel";
		const featPanel = document.createElement("div");
		featPanel.className = "fa-feat-panel";
		const sliders = document.createElement("div");
		sliders.className = "fa-sliders";
		const exprBtn = document.createElement("button");
		exprBtn.className = "fa-btn fa-expr-btn";
		exprBtn.title = "Show the expressions plotted in this chart";
		exprBtn.textContent = "ƒ(x)";
		exprBtn.addEventListener("click", () => {
			exprPanel.classList.toggle("open");
			exprBtn.classList.toggle("open");
		});
		const featBtn = document.createElement("button");
		featBtn.className = "fa-btn fa-feat-btn";
		featBtn.title = "Show every feature the analysis detected";
		featBtn.textContent = "features";
		featBtn.addEventListener("click", () => {
			featPanel.classList.toggle("open");
			featBtn.classList.toggle("open");
		});
		card.append(tabs, rationale, legend, canvasWrap, exprPanel, featPanel, sliders);
		const state = {
			viewIdx: 0,
			pins: {}
		};
		const activate = (idx) => {
			state.viewIdx = idx;
			const view = views[idx];
			state.pins = { ...view.pinned || {} };
			this._hiddenGroups = /* @__PURE__ */ new Set();
			this._hiddenMarks = /* @__PURE__ */ new Set();
			this._hiddenSeries = /* @__PURE__ */ new Set();
			[...tabs.querySelectorAll(".fa-view-tab")].forEach((b, i) => b.classList.toggle("active", i === idx));
			this._renderExprPanel(exprPanel, chars, view);
			const nFeat = this._renderFeaturePanel(featPanel, artifact, chars, view, state);
			featBtn.textContent = nFeat ? `features (${nFeat})` : "features";
			if (view.rationale) {
				rationale.innerHTML = "";
				const badge = document.createElement("span");
				badge.className = "fa-ai-badge";
				badge.title = "AI-generated";
				badge.innerHTML = AI_ICON;
				const rtext = document.createElement("span");
				this._inlineMath(rtext, " " + view.rationale);
				rationale.append(badge, rtext);
				this._attachHoverAsk(rationale, () => `For $${artifact.latex}$, the analysis chose this view: "${view.rationale}". Walk me through the whole chart: why this range is interesting, and what its features mean.\n` + this._configSummary(chars, view, state));
			} else rationale.textContent = "";
			const chart = this._renderChart(artifact, chars, view, canvasWrap, legend, state);
			this._renderAxisTitles(canvasWrap, chars, proposal, view, state);
			const update = () => this._updateChartData(chart, chars, view, state);
			this._renderSliders(artifact, chars, proposal, view, sliders, state, update);
		};
		views.forEach((view, i) => {
			const b = document.createElement("button");
			b.className = "fa-btn fa-view-tab";
			const xv = this._varText(chars, view.x_var);
			b.textContent = `View ${i + 1}: ${xv} ∈ [${(view.x_range || []).join(", ")}]`;
			b.addEventListener("click", () => activate(i));
			tabs.appendChild(b);
		});
		const actions = document.createElement("div");
		actions.className = "fa-view-actions";
		actions.append(exprBtn, featBtn);
		tabs.appendChild(actions);
		loadChartJs().then(() => activate(0)).catch(() => {
			canvasWrap.textContent = "Chart library failed to load.";
		});
		return card;
	}
	/** What this chart actually plots: each curve's expression (LaTeX) and
	*  the mathjs script evaluated for it, plus any annotation positions.
	*  Every script here is SymPy-generated server-side. */
	_renderExprPanel(host, chars, view) {
		host.innerHTML = "";
		const row = (color, label, latex, script) => {
			const r = document.createElement("div");
			r.className = "fa-expr-row";
			const swatch = document.createElement("span");
			swatch.className = "fa-expr-swatch";
			if (color) swatch.style.background = color;
			else swatch.classList.add("fa-expr-swatch-ann");
			const name = document.createElement("span");
			name.className = "fa-expr-label";
			this._inlineMath(name, label);
			const math = document.createElement("span");
			math.className = "fa-expr-math";
			if (/\$/.test(latex)) this._inlineMath(math, latex);
			else this._katex(math, latex);
			const code = document.createElement("code");
			code.className = "fa-expr-code";
			code.textContent = script;
			r.append(swatch, name, math, code);
			host.appendChild(r);
		};
		const main = chars.chartScript;
		if (main && main.script) {
			const shown = chars.dependentLatex ? `${chars.dependentLatex} = ${chars.expression}` : chars.expression || "";
			row(SERIES_COLORS[0], "curve", shown, main.script);
		}
		(view.plots || []).forEach((p, i) => {
			if (!p.script) return;
			row(SERIES_COLORS[(i + 1) % SERIES_COLORS.length], p.label || "companion", p.latex || "", p.script);
		});
		for (const a of view.annotations || []) {
			const at = a.at && a.at.latex ? a.at.latex : "";
			const to = a.to && a.to.latex ? ` … ${a.to.latex}` : "";
			row(null, a.label || a.kind, at + to, (a.at && a.at.script ? a.at.script : "") + (a.to && a.to.script ? `  …  ${a.to.script}` : ""));
		}
		if (!host.children.length) host.textContent = "No evaluable expression for this view.";
	}
	/** All evaluable series for a view: main curve + companion plots.
	*
	*  `label` is a DISPLAY SOURCE in the app's inline-math convention —
	*  prose with `$…$` spans, which is how the LM writes plot labels
	*  ("Faster spin ($\omega = 0.2\ \text{rad/s}$)"). A bare LaTeX
	*  expression is `$`-wrapped here so one renderer (labels.js
	*  renderKaTeX) covers both the LM's prose and the CAS's expressions. */
	_seriesFor(chars, view) {
		const out = [];
		const main = chars.chartScript;
		if (main && main.script) {
			const f = chars.dependentLatex || chars.expression || "f";
			out.push({
				label: `$${f}$`,
				script: main.script,
				main: true
			});
		}
		for (const p of view.plots || []) {
			if (!p.script) continue;
			out.push({
				label: p.label || (p.latex ? `$${p.latex}$` : "companion"),
				script: p.script
			});
		}
		return out;
	}
	_scopeFor(chars, view, pins, xValue) {
		const scope = {};
		for (const name of chars.variables || []) scope[name] = 1;
		Object.assign(scope, pins);
		scope[view.x_var] = xValue;
		return scope;
	}
	_renderChart(artifact, chars, view, canvasWrap, legend, state) {
		this._destroyCharts();
		canvasWrap.innerHTML = "";
		const canvas = document.createElement("canvas");
		canvasWrap.appendChild(canvas);
		const labelLayer = document.createElement("div");
		labelLayer.className = "fa-chart-labels";
		canvasWrap.appendChild(labelLayer);
		const [xa, xb] = view.x_range && view.x_range.length === 2 ? view.x_range : [-5, 5];
		const series = this._seriesFor(chars, view);
		const compiled = series.map((s) => {
			try {
				return compileExpr(s.script);
			} catch (_e) {
				return null;
			}
		});
		const xs = [];
		for (let i = 0; i <= NUM_POINTS; i++) xs.push(xa + (xb - xa) * i / NUM_POINTS);
		const datasets = series.map((s, si) => ({
			label: detex(s.label),
			$faLabel: s.label,
			data: xs.map((x) => {
				if (!compiled[si]) return null;
				try {
					const y = evalExpr(compiled[si], 0, { overrideScope: this._scopeFor(chars, view, state.pins, x) });
					return Number.isFinite(y) ? y : null;
				} catch (_e) {
					return null;
				}
			}),
			borderColor: SERIES_COLORS[si % SERIES_COLORS.length],
			backgroundColor: SERIES_COLORS[si % SERIES_COLORS.length] + "22",
			borderWidth: s.main ? 2 : 1.5,
			borderDash: s.main ? [] : [6, 4],
			pointRadius: 0,
			pointHitRadius: 6,
			pointHoverRadius: 4,
			pointHoverBackgroundColor: SERIES_COLORS[si % SERIES_COLORS.length],
			pointHoverBorderColor: SERIES_COLORS[si % SERIES_COLORS.length],
			fill: false,
			tension: .25,
			spanGaps: false
		}));
		const annotations = this._evalAnnotations(chars, view, state.pins);
		const marks = this._marksFor(chars, view);
		this._hiddenMarks = new Set(marks);
		const chart = new Chart(canvas, {
			type: "line",
			plugins: [{
				id: "faFeatures",
				afterDraw: (chart) => {
					const fa = chart.$fa;
					if (!fa) return;
					const visible = chart.isDatasetVisible(0) ? new Set([...fa.marks].filter((k) => !this._hiddenMarks.has(k))) : /* @__PURE__ */ new Set();
					this._drawOverlays(chart, chart.data.datasets[0], fa.xs, visible, fa.anns);
					if (this._pinnedPoints) this._drawPinnedPoints(chart, this._pinnedPoints);
				}
			}],
			data: {
				labels: xs.map((x) => +x.toFixed(6)),
				datasets
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				plugins: {
					legend: { display: false },
					tooltip: {
						enabled: false,
						external: this._makeTooltipHandler(artifact, chars, view, state)
					}
				},
				layout: { padding: {
					left: 20,
					right: 6,
					top: 4,
					bottom: 14
				} },
				scales: {
					x: {
						type: "linear",
						ticks: {
							color: "#7e8aa3",
							maxTicksLimit: 9,
							callback: (v) => +Number(v).toFixed(3)
						},
						grid: {
							color: (c) => c.tick && c.tick.value === 0 ? "rgba(174, 187, 209, 0.85)" : "rgba(110, 124, 180, 0.12)",
							lineWidth: (c) => c.tick && c.tick.value === 0 ? 1.6 : 1
						}
					},
					y: {
						ticks: {
							color: "#7e8aa3",
							maxTicksLimit: 7,
							callback: function(v) {
								if (v === this.min || v === this.max) return null;
								return +Number(v).toFixed(3);
							}
						},
						grid: {
							color: (c) => c.tick && c.tick.value === 0 ? "rgba(174, 187, 209, 0.85)" : "rgba(110, 124, 180, 0.12)",
							lineWidth: (c) => c.tick && c.tick.value === 0 ? 1.6 : 1
						}
					}
				},
				interaction: {
					mode: "index",
					intersect: false
				}
			}
		});
		const yb = this._yBounds(datasets);
		chart.options.scales.y.min = yb.min;
		chart.options.scales.y.max = yb.max;
		canvas.addEventListener("click", (e) => {
			if (this._snapFromAxisClick(e, chart, artifact, chars, view, state)) return;
			if (this._pinnedTip) {
				this._unpinTip();
				return;
			}
			const tip = canvasWrap.querySelector(".fa-chart-tip");
			if (tip && tip.classList.contains("show")) this._pinTip(tip, chart, artifact, chars, view, state);
		});
		canvas.addEventListener("mousemove", (e) => {
			canvas.style.cursor = this._overAxisTick(e, chart) ? "pointer" : "";
		});
		this._renderSeriesLegend(legend, chart);
		this._renderMarkerLegend(legend, marks, chart);
		chart.$fa = {
			xs,
			marks,
			compiled,
			yb,
			xLatex: this._varLatex(chars, view.x_var),
			exprLatex: chars.dependentLatex || chars.expression || "f",
			anns: annotations.filter((a) => !this._hiddenGroups.has(a.group || ""))
		};
		this._renderAnnLegend(legend, view, annotations, () => this._updateChartData(chart, chars, view, state));
		chart.update("none");
		this._charts.push(chart);
		return chart;
	}
	/** In-place data refresh for slider moves / group toggles — no rebuild. */
	_updateChartData(chart, chars, view, state) {
		const fa = chart && chart.$fa;
		if (!fa) return;
		chart.data.datasets.forEach((ds, si) => {
			ds.data = fa.xs.map((x) => {
				if (!fa.compiled[si]) return null;
				try {
					const y = evalExpr(fa.compiled[si], 0, { overrideScope: this._scopeFor(chars, view, state.pins, x) });
					return Number.isFinite(y) ? y : null;
				} catch (_e) {
					return null;
				}
			});
		});
		fa.anns = this._evalAnnotations(chars, view, state.pins).filter((a) => !this._hiddenGroups.has(a.group || ""));
		const b = this._yBounds(chart.data.datasets);
		if (b.min < fa.yb.min || b.max > fa.yb.max) {
			fa.yb.min = Math.min(fa.yb.min, b.min);
			fa.yb.max = Math.max(fa.yb.max, b.max);
			chart.options.scales.y.min = fa.yb.min;
			chart.options.scales.y.max = fa.yb.max;
		}
		if (this._pinnedTip) this._refreshPinnedValues(chart);
		chart.update("none");
	}
	/** Axis titles as KaTeX: the swept variable under the x-axis, the
	*  analyzed expression rotated along the y-axis. Both carry the AI's
	*  glossary description on hover where one exists. */
	_renderAxisTitles(canvasWrap, chars, proposal, view, state) {
		for (const el of canvasWrap.querySelectorAll(".fa-axis-title")) el.remove();
		const expr = chars.expression || "";
		const xLatex = this._varLatex(chars, view.x_var);
		const range = (view.x_range || []).join(" to ");
		const xTitle = document.createElement("div");
		xTitle.className = "fa-axis-title fa-axis-x";
		this._katex(xTitle, xLatex);
		const xDesc = (proposal.variable_glossary || {})[view.x_var];
		if (xDesc) this._attachVarTooltip(xTitle, xDesc);
		this._attachHoverAsk(xTitle, () => `In $${expr}$, the chart sweeps $${xLatex}$ across ${range}` + (xDesc ? ` (${xDesc})` : "") + ". What should I notice about how the expression responds to it?\n" + this._configSummary(chars, view, state));
		const yTitle = document.createElement("div");
		yTitle.className = "fa-axis-title fa-axis-y";
		this._katex(yTitle, chars.dependentLatex || expr || "f");
		if (proposal.title) this._attachVarTooltip(yTitle, proposal.title);
		this._attachHoverAsk(yTitle, () => `The vertical axis of this chart plots $${expr}$` + (proposal.title ? ` ("${proposal.title}")` : "") + ". What does this quantity mean physically, and what is the most important thing its shape reveals?\n" + this._configSummary(chars, view, state));
		canvasWrap.append(xTitle, yTitle);
	}
	/** HTML hover tooltip (Chart.js `external`) so the hovered x-value and
	*  every series label render as KaTeX rather than canvas text. Clicking
	*  it pins it — see `_pinTip`. */
	_makeTooltipHandler(artifact, chars, view, state) {
		this._varLatex(chars, view.x_var);
		return (ctx) => {
			const { chart, tooltip } = ctx;
			const wrap = chart.canvas.parentNode;
			if (!wrap) return;
			let el = wrap.querySelector(".fa-chart-tip");
			if (!el) {
				el = document.createElement("div");
				el.className = "fa-chart-tip";
				this._wireTip(el);
				wrap.appendChild(el);
			}
			if (el.classList.contains("pinned")) return;
			if (!tooltip || tooltip.opacity === 0) {
				el.classList.remove("show");
				return;
			}
			this._fillTip(el, chart, chars, view, state, +(tooltip.dataPoints?.[0]?.parsed?.x ?? 0));
			el.style.left = `${tooltip.caretX}px`;
			el.style.top = `${tooltip.caretY}px`;
			el.classList.add("show");
		};
	}
	/** One series' value at an arbitrary x, off the same compiled script the
	*  curve itself was plotted from — so a readout is not limited to the
	*  NUM_POINTS samples. Falls back to the plotted array before the chart's
	*  `$fa` state exists. */
	_seriesValueAt(chart, chars, view, state, di, x) {
		const compiled = (chart.$fa || {}).compiled;
		if (compiled && compiled[di]) {
			try {
				const y = evalExpr(compiled[di], 0, { overrideScope: this._scopeFor(chars, view, state.pins, x) });
				if (Number.isFinite(y)) return y;
			} catch (_e) {}
			return null;
		}
		const i = this._indexNearestX(chart, x);
		const y = chart.data.datasets[di].data[i];
		return Number.isFinite(y) ? y : null;
	}
	/** The readout's contents at an exact x: every visible series with its
	*  value there. Shared by the pointer (hover) and by an axis-label snap,
	*  so the two can never build a different-looking note.
	*
	*  Keyed by the x VALUE, not a sample index: a y-axis snap solves for a
	*  crossing that almost never falls on a sample, and rounding it to the
	*  nearest one would quietly answer a slightly different question. */
	_fillTip(el, chart, chars, view, state, x) {
		el.innerHTML = "";
		const xLatex = this._varLatex(chars, view.x_var);
		const values = [], datasets = [];
		const head = document.createElement("div");
		head.className = "fa-tip-head";
		const xv = document.createElement("span");
		xv.className = "fa-tip-x";
		this._katex(xv, xLatex);
		const xValue = (+x).toPrecision(4);
		xv.appendChild(document.createTextNode(" = " + xValue));
		head.appendChild(xv);
		el.appendChild(head);
		chart.data.datasets.forEach((ds, di) => {
			if (!chart.isDatasetVisible(di)) return;
			const row = document.createElement("div");
			row.className = "fa-tip-row";
			const sw = document.createElement("span");
			sw.className = "fa-tip-swatch";
			sw.style.background = ds.borderColor;
			const name = document.createElement("span");
			name.className = "fa-tip-name";
			const label = ds.$faLabel || ds.label || "";
			name.innerHTML = renderKaTeX$1(label, false);
			const val = document.createElement("span");
			val.className = "fa-tip-val";
			const y = this._seriesValueAt(chart, chars, view, state, di, x);
			val.textContent = Number.isFinite(y) ? (+y).toPrecision(5) : "—";
			row.append(sw, name, val);
			el.appendChild(row);
			values.push({
				label,
				value: val.textContent
			});
			datasets.push(di);
		});
		el.$fa = {
			xLatex,
			xValue,
			values,
			datasets,
			x,
			chars,
			view,
			state
		};
	}
	/** Drag, wired once per tip element. Pinning itself is a click on the
	*  CHART (see `_renderChart`); an unpinned tip is pointer-transparent, so
	*  that click reaches the canvas even though the tip is sitting over it.
	*  Once pinned the tip takes pointer events, which is both what makes it
	*  draggable and what stops a click on the note counting as a click on
	*  the chart — so the note is never its own dismiss target. */
	_wireTip(el) {
		el.addEventListener("mousedown", (e) => {
			if (!el.classList.contains("pinned")) return;
			if (e.target.closest(".ai-ask-btn")) return;
			e.preventDefault();
			const wrapR = el.parentNode.getBoundingClientRect();
			const r = el.getBoundingClientRect();
			const dx = e.clientX - r.left, dy = e.clientY - r.top;
			const move = (ev) => {
				el.style.left = `${ev.clientX - wrapR.left - dx}px`;
				el.style.top = `${ev.clientY - wrapR.top - dy}px`;
			};
			const up = () => {
				document.removeEventListener("mousemove", move);
				document.removeEventListener("mouseup", up);
			};
			document.addEventListener("mousemove", move);
			document.addEventListener("mouseup", up);
		});
	}
	/** The tick value nearest `pixel` along `scale`, or null if the click
	*  landed between ticks. `TICK_TOL` is generous: tick labels are wider
	*  than the tick itself, and the learner is aiming at the number. */
	_nearestTick(scale, pixel, tol = 18) {
		let best = null, bestD = Infinity;
		(scale.ticks || []).forEach((t, i) => {
			if (t.label == null || t.label === "") return;
			const d = Math.abs(scale.getPixelForTick(i) - pixel);
			if (d < bestD) {
				bestD = d;
				best = t.value;
			}
		});
		return bestD <= tol ? best : null;
	}
	/** The main curve: dataset 0 when it is showing, else the first that is.
	*  A y-axis snap solves against whatever curve the learner can see. */
	_mainDatasetIndex(chart) {
		if (chart.isDatasetVisible(0)) return 0;
		return chart.data.datasets.findIndex((_d, i) => chart.isDatasetVisible(i));
	}
	/** Sample index whose x is nearest `value`. */
	_indexNearestX(chart, value) {
		let best = 0, bestD = Infinity;
		chart.data.labels.forEach((x, i) => {
			const d = Math.abs(x - value);
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		});
		return best;
	}
	/** The x where the ANALYZED curve reaches `value` — the inverse question
	*  the y axis asks ("where is $a = 3$?").
	*
	*  Only the main curve answers. The axis is shared with the companions,
	*  but the learner clicking `3` means "put $a$ at 3"; solving against a
	*  companion instead would land on a point where the note reads
	*  `a = 0.75` next to a companion reading 3, which looks like a bug.
	*  Everything else in the note is then read FORWARD at the x this
	*  returns — x is the shared coordinate, so a y-axis click is inverted
	*  once and every other series follows from it.
	*
	*  The plotted samples only bracket the crossing; the answer is refined
	*  against the compiled expression so the note reads `1.0000` rather
	*  than whichever nearby sample happened to be closest. Null when the
	*  curve does not reach that value in this window — see `_saySnapFailed`
	*  for what the chart says instead. */
	_solveForY(chart, chars, view, state, value) {
		const di = this._mainDatasetIndex(chart);
		if (di < 0) return null;
		const data = chart.data.datasets[di].data;
		const xs = chart.data.labels;
		const brackets = [];
		for (let i = 0; i < data.length; i++) {
			const y = data[i];
			if (!Number.isFinite(y)) continue;
			if (y === value) {
				brackets.push([xs[i], xs[i]]);
				continue;
			}
			const next = data[i + 1];
			if (Number.isFinite(next) && (y - value) * (next - value) < 0) brackets.push([xs[i], xs[i + 1]]);
		}
		if (!brackets.length) return null;
		const from = this._pinnedTip && this._pinnedTip.$fa ? this._pinnedTip.$fa.x : null;
		const [lo, hi] = from == null ? brackets[0] : brackets.reduce((p, c) => Math.abs(c[0] - from) < Math.abs(p[0] - from) ? c : p);
		return this._refineCrossing(chart, chars, view, state, di, lo, hi, value);
	}
	/** Bisect `[lo, hi]` — one plotted sample apart, straddling the crossing
	*  — down to float precision on the compiled expression. Fifty steps is
	*  nothing next to the redraw it precedes, and it is what turns "works
	*  approximately" into an exact answer. */
	_refineCrossing(chart, chars, view, state, di, lo, hi, value) {
		if (lo === hi) return lo;
		const f = (x) => {
			const y = this._seriesValueAt(chart, chars, view, state, di, x);
			return Number.isFinite(y) ? y - value : null;
		};
		let a = lo, b = hi;
		const fa = f(a);
		if (fa == null) return (lo + hi) / 2;
		if (fa === 0) return a;
		for (let i = 0; i < 50 && b - a > Math.abs(hi - lo) * 1e-12; i++) {
			const m = (a + b) / 2, fm = f(m);
			if (fm == null) break;
			if (fm === 0) return m;
			if (fa < 0 === fm < 0) a = m;
			else b = m;
		}
		return (a + b) / 2;
	}
	/** A y-axis click the curve cannot answer, said out loud and briefly.
	*  Reports the range the curve actually covers, so the learner can see
	*  how far off the ask was — and, since the pins are live, that moving a
	*  slider may well bring the value into reach. */
	_saySnapFailed(chart, chars, view, value) {
		const wrap = chart.canvas.parentNode;
		let el = wrap.querySelector(".fa-snap-miss");
		if (!el) {
			el = document.createElement("div");
			el.className = "fa-snap-miss";
			wrap.appendChild(el);
		}
		const di = this._mainDatasetIndex(chart);
		const ys = di < 0 ? [] : chart.data.datasets[di].data.filter(Number.isFinite);
		const y = chars.dependentLatex || chars.expression || "f";
		el.innerHTML = renderKaTeX$1(`$${y}$ does not reach ${this._fmt(value)} here` + (ys.length ? ` — it runs from ${this._fmt(Math.min(...ys))} to ${this._fmt(Math.max(...ys))} over this range.` : "."), false);
		el.classList.add("show");
		clearTimeout(this._snapMissTimer);
		this._snapMissTimer = setTimeout(() => el.classList.remove("show"), 2600);
	}
	/** Is the pointer over a tick label? Drives the cursor only. */
	_overAxisTick(e, chart) {
		const area = chart.chartArea;
		if (!area || !chart.scales.x || !chart.scales.y) return false;
		const r = chart.canvas.getBoundingClientRect();
		const px = e.clientX - r.left, py = e.clientY - r.top;
		if (py > area.bottom) return this._nearestTick(chart.scales.x, px) != null;
		if (px < area.left) return this._nearestTick(chart.scales.y, py) != null;
		return false;
	}
	/** A click in an axis's tick band snaps the note to that value: the x
	*  axis reads forwards ("put me at $R = 40$"), the y axis backwards
	*  ("put me where $a = 3$"). Returns whether it handled the click. */
	_snapFromAxisClick(e, chart, artifact, chars, view, state) {
		const area = chart.chartArea;
		if (!area || !chart.scales.x || !chart.scales.y) return false;
		const r = chart.canvas.getBoundingClientRect();
		const px = e.clientX - r.left, py = e.clientY - r.top;
		let x = null;
		if (py > area.bottom) {
			x = this._nearestTick(chart.scales.x, px);
			if (x == null) return false;
		} else if (px < area.left) {
			const v = this._nearestTick(chart.scales.y, py);
			if (v == null) return false;
			x = this._solveForY(chart, chars, view, state, v);
			if (x == null) {
				this._saySnapFailed(chart, chars, view, v);
				return true;
			}
		} else return false;
		const el = chart.canvas.parentNode.querySelector(".fa-chart-tip");
		if (!el) return false;
		this._unpinTip();
		this._fillTip(el, chart, chars, view, state, x);
		const di = this._mainDatasetIndex(chart);
		const y = di < 0 ? null : this._seriesValueAt(chart, chars, view, state, di, x);
		el.style.left = `${chart.scales.x.getPixelForValue(x)}px`;
		el.style.top = `${Number.isFinite(y) ? chart.scales.y.getPixelForValue(y) : area.top + 20}px`;
		el.classList.add("show");
		this._pinTip(el, chart, artifact, chars, view, state);
		return true;
	}
	/** Pin the hover readout as a sticky note: it stops following the
	*  pointer, can be dragged anywhere, and grows an ask button for the
	*  exact set of values it froze. Clicking off it puts it away. */
	_pinTip(el, chart, artifact, chars, view, state) {
		this._unpinTip();
		const wrapR = el.parentNode.getBoundingClientRect();
		const r = el.getBoundingClientRect();
		el.style.left = `${Math.max(0, Math.min(r.left - wrapR.left, wrapR.width - r.width))}px`;
		el.style.top = `${Math.max(0, r.top - wrapR.top)}px`;
		el.classList.add("pinned");
		this._pinnedTip = el;
		this._pinnedChart = chart;
		this._pinnedPoints = el.$fa && el.$fa.datasets ? el.$fa : null;
		chart.update("none");
		const head = el.querySelector(".fa-tip-head");
		if (head) head.appendChild(makeAiAskButton("ai-ask-btn fa-tip-ask", "Ask the AI about these values", () => {
			const d = el.$fa || { values: [] };
			const vals = d.values.map((v) => `${v.label} = ${v.value}`).join(", ");
			return `On the chart of $${artifact.latex}$ I have pinned the point where $${d.xLatex} = ${d.xValue}$` + (vals ? `, where the curves read ${vals}` : "") + ". What do these values tell me, and how do they relate to each other here?\n" + this._configSummary(chars, view, state);
		}));
	}
	/** Put the sticky note away and hand the tip back to the pointer. */
	_unpinTip() {
		const el = this._pinnedTip;
		const chart = this._pinnedChart;
		this._pinnedTip = null;
		this._pinnedChart = null;
		this._pinnedPoints = null;
		if (chart) try {
			chart.update("none");
		} catch (_e) {}
		if (!el) return;
		el.classList.remove("pinned", "show");
		el.style.left = "";
		el.style.top = "";
		const ask = el.querySelector(".fa-tip-ask");
		if (ask) ask.remove();
	}
	/** The hovered points, kept on screen for a pinned note. Positions are
	*  recomputed from the LIVE data each draw, so a slider move slides the
	*  markers along with the curves instead of stranding them. */
	_drawPinnedPoints(chart, pinned) {
		const { ctx, scales, chartArea } = chart;
		if (!chartArea || !scales.x || !scales.y) return;
		const { x, datasets, chars, view, state } = pinned;
		ctx.save();
		for (const di of datasets) {
			if (!chart.isDatasetVisible(di)) continue;
			const ds = chart.data.datasets[di];
			const y = this._seriesValueAt(chart, chars, view, state, di, x);
			if (!Number.isFinite(y)) continue;
			const px = scales.x.getPixelForValue(x);
			const py = scales.y.getPixelForValue(y);
			if (px < chartArea.left || px > chartArea.right) continue;
			ctx.beginPath();
			ctx.arc(px, py, 4, 0, TAU);
			ctx.fillStyle = "#0a0c1a";
			ctx.fill();
			ctx.lineWidth = 2;
			ctx.strokeStyle = ds.borderColor;
			ctx.stroke();
		}
		ctx.restore();
	}
	/** A pinned note is pinned in x, not frozen in time: when a slider moves
	*  the curves, its numbers follow, or it would sit there quoting values
	*  that no longer match the curve underneath it. */
	_refreshPinnedValues(chart) {
		const el = this._pinnedTip;
		const d = el && el.$fa;
		if (!d || !d.datasets) return;
		const cells = el.querySelectorAll(".fa-tip-row .fa-tip-val");
		d.datasets.forEach((di, i) => {
			const y = this._seriesValueAt(chart, d.chars, d.view, d.state, di, d.x);
			const text = Number.isFinite(y) ? (+y).toPrecision(5) : "—";
			if (cells[i]) cells[i].textContent = text;
			if (d.values[i]) d.values[i].value = text;
		});
	}
	_fmt(v) {
		return Number.isFinite(+v) ? String(+(+v).toPrecision(4)) : "?";
	}
	/** Which CAS feature kinds this view draws. Roots, extrema and
	*  singularities are CAS facts, not AI opinions: draw them whenever the
	*  report found any. `view.mark` stays as an additive hint (the LM
	*  regularly forgets to list them, and a learner asking "where are the
	*  roots" deserves an answer). */
	_marksFor(chars, view) {
		const marks = new Set(view.mark || []);
		for (const kind of [
			"zeros",
			"extrema",
			"singularities"
		]) {
			const f = (chars.features || {})[kind];
			if (f && (f.points || []).length) marks.add(kind);
		}
		return marks;
	}
	/** Every finding in the CAS report, flattened to one row each, in the
	*  order the chart reads. One walk of the report shape feeds BOTH the
	*  ask messages (`_featureSummary`) and the expandable panel
	*  (`_renderFeaturePanel`), so the two can never drift apart.
	*
	*  Each row: `{kind, group, label, math, detail, off, family, prose}`
	*    kind    report key — 'zeros' … 'domain'
	*    group   plural name of the kind ('roots', 'critical points')
	*    label   what THIS row is ('root', 'maximum', 'vertical asymptote')
	*    math    LaTeX for the location/value, without `$`
	*    detail  secondary LaTeX — an extremum's value, a limit's direction
	*    off     the point lies outside the swept range, so nothing is drawn
	*    family  `math` is a solution SET, not a single point
	*    prose   the row as a sentence fragment, for prompts
	*  Point lists are bounded server-side (features.MAX_POINTS). */
	_featureRows(chars, view) {
		const feats = chars.features || {};
		const fv = chars.variable || view.x_var;
		const xL = this._varLatex(chars, fv);
		const [xa, xb] = (view.x_range || []).length === 2 ? view.x_range : [-Infinity, Infinity];
		const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
		const sameAxis = fv === view.x_var;
		const isOff = (p) => sameAxis && !(p && Number.isFinite(p.approx) && p.approx >= lo && p.approx <= hi);
		const rows = [];
		const push = (r) => {
			const head = r.at || r.article ? `${/^[aeiou]/i.test(r.label) ? "an" : "a"} ${r.label}` : r.label;
			if (r.family) r.prose = `${r.group} form the set $${r.math}$`;
			else if (!r.math) r.prose = r.label;
			else if (r.at) r.prose = `${head} at $${r.math}$` + (r.detail ? ` (value $${r.detail}$)` : "") + (r.off ? " (off-chart)" : "");
			else r.prose = `${head} $${r.math}$` + (r.detail ? ` as $${r.detail}$` : "");
			rows.push(r);
		};
		const points = (kind, group, describe) => {
			const f = feats[kind] || {};
			for (const p of f.points || []) push({
				kind,
				group,
				at: true,
				...describe(p)
			});
			if (!(f.points || []).length && f.family) push({
				kind,
				group,
				label: group,
				math: f.family,
				family: true
			});
		};
		points("zeros", "roots", (p) => ({
			label: "root",
			math: `${xL} = ${p.latex}`,
			off: isOff(p)
		}));
		points("extrema", "critical points", (p) => ({
			label: !p.kind || p.kind === "critical" ? "critical point" : p.kind,
			math: `${xL} = ${p.location.latex}`,
			detail: p.value && p.value.latex || "",
			off: isOff(p.location)
		}));
		points("singularities", "singularities", (p) => ({
			label: p.vertical_asymptote ? "vertical asymptote" : "singularity",
			math: `${xL} = ${p.location.latex}`,
			off: isOff(p.location)
		}));
		points("inflections", "inflection points", (p) => ({
			label: "inflection point",
			math: `${xL} = ${p.latex}`,
			off: isOff(p)
		}));
		for (const d of (feats.limits_at_infinity || {}).directions || []) {
			const to = `${xL} \\to ${d.direction === "-inf" ? "-" : "+"}\\infty`;
			const kind = "limits_at_infinity", group = "limits at infinity";
			const o = d.oblique_asymptote;
			if (o && o.slope && o.intercept) {
				const b = String(o.intercept.latex || "").trim();
				const term = b.startsWith("-") ? `- ${b.slice(1)}` : `+ ${b}`;
				push({
					kind,
					group,
					label: "oblique asymptote",
					article: true,
					math: `y = ${o.slope.latex} ${xL} ${term}`,
					detail: to
				});
			} else if (d.horizontal_asymptote && d.limit) push({
				kind,
				group,
				label: "horizontal asymptote",
				article: true,
				math: `y = ${d.limit.latex}`,
				detail: to
			});
			else if (d.limit) push({
				kind,
				group,
				label: "limit",
				math: typeof d.limit === "string" ? d.limit : d.limit.latex,
				detail: to
			});
		}
		if (feats.periodicity && feats.periodicity.latex) push({
			kind: "periodicity",
			group: "period",
			label: "period",
			math: feats.periodicity.latex
		});
		if (typeof feats.parity === "string") push({
			kind: "parity",
			group: "symmetry",
			label: `${feats.parity} symmetry`
		});
		if (typeof feats.domain === "string") push({
			kind: "domain",
			group: "domain",
			label: "domain",
			math: feats.domain
		});
		return rows;
	}
	/** Feature kinds the CAS ran out of time on. The guard returns
	*  `{status: 'unresolved'}` per kind rather than failing the whole
	*  report, and those carry no points — so without this they are
	*  indistinguishable from "the curve has none", which is a different
	*  and much stronger claim. */
	_unresolvedKinds(chars) {
		const feats = chars.features || {};
		const NAMES = {
			zeros: "roots",
			extrema: "critical points",
			singularities: "singularities",
			inflections: "inflection points",
			limits_at_infinity: "limits at infinity",
			periodicity: "periodicity",
			parity: "symmetry",
			domain: "domain"
		};
		return Object.keys(NAMES).filter((k) => feats[k] && feats[k].status === "unresolved").map((k) => NAMES[k]);
	}
	/** The CAS report opened up: every detected feature as its own row, with
	*  a hover-revealed ask button on each so any single finding can be taken
	*  to chat on its own. Returns the row count for the toggle's caption. */
	_renderFeaturePanel(host, artifact, chars, view, state) {
		host.innerHTML = "";
		const rows = this._featureRows(chars, view);
		const stalled = this._unresolvedKinds(chars);
		if (!rows.length) {
			host.textContent = stalled.length ? `The CAS ran out of time on ${stalled.join(", ")}, so this expression has no resolved features to show.` : "The analysis detected no features for this expression.";
			return 0;
		}
		if (stalled.length) {
			const note = document.createElement("div");
			note.className = "fa-feat-row fa-feat-stalled";
			note.textContent = `The CAS ran out of time on ${stalled.join(", ")} — those are unknown here, not absent.`;
			host.appendChild(note);
		}
		for (const r of rows) {
			const row = document.createElement("div");
			row.className = "fa-feat-row";
			const label = document.createElement("span");
			label.className = "fa-feat-label";
			label.textContent = r.label;
			row.append(label);
			if (r.family) {
				const note = document.createElement("span");
				note.className = "fa-feat-note";
				note.textContent = "solution set";
				row.append(note);
			}
			if (r.math) {
				const math = document.createElement("span");
				math.className = "fa-feat-math";
				this._katex(math, r.math);
				row.append(math);
			}
			if (r.detail) {
				const detail = document.createElement("span");
				detail.className = "fa-feat-detail";
				this._katex(detail, r.at ? `= ${r.detail}` : r.detail);
				row.append(detail);
			}
			if (r.off) {
				const tag = document.createElement("span");
				tag.className = "fa-feat-off";
				tag.textContent = "outside this view";
				tag.title = "This point lies outside the plotted range, so nothing is drawn for it here.";
				row.append(tag);
			}
			this._attachHoverAsk(row, () => `In $${artifact.latex}$, the analysis reports: ${r.prose}. What does this feature mean here, and how would I find it myself?\n` + this._configSummary(chars, view, state));
			host.appendChild(row);
		}
		return rows.length;
	}
	/** The CAS report in words, for the ask messages.
	*
	*  Nothing is dropped: the tutor needs the WHOLE report to explain the
	*  chart, so every finding is listed and the ones the learner cannot
	*  currently see are flagged instead — `(hidden)` for a legend key
	*  switched off, `(off-chart)` for a point outside the swept range. */
	_featureSummary(chars, view) {
		const rows = this._featureRows(chars, view);
		const marked = [
			"zeros",
			"extrema",
			"singularities"
		];
		const drawn = [], extra = [];
		for (let i = 0; i < rows.length;) {
			const kind = rows[i].kind;
			const run = [];
			while (i < rows.length && rows[i].kind === kind) run.push(rows[i++]);
			const { group } = run[0];
			const uniform = !run[0].family && !run.some((r) => r.detail) && run.every((r) => r.group === r.label + "s");
			const body = uniform ? run.map((r) => `$${r.math}$` + (r.off ? " (off-chart)" : "")).join(", ") : run.map((r) => r.prose).join(", ");
			if (!marked.includes(kind)) extra.push(uniform ? `${group} at ${body}` : body);
			else if (this._hiddenMarks.has(kind)) drawn.push(`${group} (hidden): ${body}`);
			else drawn.push(uniform ? `${group} at ${body}` : body);
		}
		const out = [];
		if (drawn.length) out.push(`Marked on the chart: ${drawn.join("; ")}.`);
		if (extra.length) out.push(`Also detected (not drawn): ${extra.join("; ")}.`);
		const found = new Set(rows.map((r) => r.kind));
		const feats = chars.features || {};
		const empty = [...this._marksFor(chars, view)].filter((k) => !found.has(k) && (feats[k] || {}).status !== "unresolved");
		if (empty.length) out.push(`No ${empty.join(" or ")} were found.`);
		const stalled = this._unresolvedKinds(chars);
		if (stalled.length) out.push(`The CAS ran out of time on ${stalled.join(", ")}, so those are unknown here rather than absent.`);
		return out.join(" ");
	}
	/** Everything else drawn beside the main curve — companion plots and the
	*  annotation lines, by the labels the learner reads in the legend. All
	*  of them, with the ones switched off flagged `(hidden)`. */
	_overlaySummary(chars, view) {
		const parts = [];
		const offset = chars.chartScript && chars.chartScript.script ? 1 : 0;
		const plots = (view.plots || []).filter((p) => p.script).map((p, i) => (p.label && p.latex ? `${p.label} — $${p.latex}$` : p.label || (p.latex ? `$${p.latex}$` : "companion")) + (this._hiddenSeries.has(i + offset) ? " (hidden)" : ""));
		if (plots.length) parts.push(`companion curves: ${plots.join("; ")}`);
		const anns = (view.annotations || []).map((a) => (a.label || a.kind) + (a.at && a.at.latex ? ` at $${a.at.latex}$` : "") + (this._hiddenGroups.has(a.group || "") ? " (hidden)" : ""));
		if (anns.length) parts.push(`marker lines: ${anns.join("; ")}`);
		return parts.length ? `Other curves and markers on this view — ${parts.join(", and ")}.` : "";
	}
	/** The chart's current state in words, appended to every ask so the
	*  tutor answers about what the learner is actually looking at rather
	*  than the expression in the abstract — the full CAS report and every
	*  extra curve, with whatever is currently off-screen flagged. */
	_configSummary(chars, view, state) {
		const pins = Object.entries(state.pins || {}).map(([k, v]) => `$${this._varLatex(chars, k)}$ = ${this._fmt(v)}`);
		const range = (view.x_range || []).map((v) => this._fmt(v)).join(" to ");
		const parts = [`the chart sweeps $${this._varLatex(chars, view.x_var)}$` + (range ? ` from ${range}` : "")];
		if (pins.length) parts.push(`with ${pins.join(", ")}`);
		return [
			`(Current chart settings: ${parts.join(", ")}.`,
			this._featureSummary(chars, view),
			this._overlaySummary(chars, view)
		].filter(Boolean).join(" ") + ")";
	}
	/** Hovering an annotation reports the values AT that marker — the same
	*  readout the plot hover gives, but pinned to the point of interest. */
	_showAnnotationTip(chart, l) {
		const wrap = chart.canvas.parentNode;
		if (!wrap) return;
		let el = wrap.querySelector(".fa-chart-tip");
		if (!el) {
			el = document.createElement("div");
			el.className = "fa-chart-tip";
			wrap.appendChild(el);
		}
		el.innerHTML = "";
		const a = l.ann;
		const fa = chart.$fa || {};
		const num = (v) => Number.isFinite(v) ? +(+v).toPrecision(5) : "—";
		const head = document.createElement("div");
		head.className = "fa-tip-head";
		if (a.kind === "vline") {
			const sym = document.createElement("span");
			this._katex(sym, fa.xLatex || "x");
			head.append(sym, document.createTextNode(" = " + num(a.atValue)));
		} else this._inlineMath(head, a.label || a.kind);
		el.appendChild(head);
		const row = (name, value, color) => {
			const r = document.createElement("div");
			r.className = "fa-tip-row";
			const sw = document.createElement("span");
			sw.className = "fa-tip-swatch";
			sw.style.background = color || ANNOTATION_COLOR;
			const n = document.createElement("span");
			n.className = "fa-tip-name";
			if (typeof name === "string") this._katex(n, name);
			else n.appendChild(name);
			const v = document.createElement("span");
			v.className = "fa-tip-val";
			v.textContent = value;
			r.append(sw, n, v);
			el.appendChild(r);
		};
		if (a.kind === "vline") {
			const xs = fa.xs || [];
			let idx = 0, best = Infinity;
			xs.forEach((x, i) => {
				const d = Math.abs(x - a.atValue);
				if (d < best) {
					best = d;
					idx = i;
				}
			});
			for (const ds of chart.data.datasets) row(ds.label === "f" ? fa.exprLatex || "f" : ds.label, num(ds.data[idx]), ds.borderColor);
		} else if (a.kind === "hline") row("y", num(a.atValue));
		else if (a.kind === "band") row(fa.xLatex || "x", `${num(Math.min(a.atValue, a.toValue))} … ${num(Math.max(a.atValue, a.toValue))}`);
		el.style.left = `${l.left}px`;
		el.style.top = `${l.top}px`;
		el.classList.add("show");
	}
	/** Place annotation labels as KaTeX-rendered HTML over the canvas.
	*  Called from the draw plugin, so positions follow every slider move
	*  and resize. Canvas text can't render math; this layer can. */
	_syncLabels(chart, labels) {
		const layer = chart.canvas.parentNode && chart.canvas.parentNode.querySelector(".fa-chart-labels");
		if (!layer) return;
		layer.innerHTML = "";
		const placed = [];
		for (const l of labels) {
			const el = document.createElement("span");
			el.className = "fa-chart-label" + (l.band ? " band" : "");
			el.style.left = `${l.left}px`;
			el.style.top = `${l.top}px`;
			this._inlineMath(el, l.text);
			if (l.ann) {
				el.classList.add("probe");
				el.addEventListener("mouseenter", () => this._showAnnotationTip(chart, l));
				el.addEventListener("mouseleave", () => {
					const tip = chart.canvas.parentNode.querySelector(".fa-chart-tip");
					if (tip) tip.classList.remove("show");
				});
			}
			layer.appendChild(el);
			placed.push({
				el,
				l
			});
		}
		const wide = layer.clientWidth;
		const rows = [];
		for (const { el, l } of placed) {
			const w = el.offsetWidth, h = el.offsetHeight || 14;
			let left = l.left;
			if (left + w > wide - 3) left = Math.max(3, l.left - w - 8);
			let top = l.top;
			while (rows.some((r) => Math.abs(r.top - top) < h && left < r.right && left + w > r.left)) top += h + 2;
			el.style.left = `${left}px`;
			el.style.top = `${top}px`;
			rows.push({
				top,
				left,
				right: left + w
			});
		}
	}
	/** Padded finite y-extent across all datasets. */
	_yBounds(datasets) {
		const ys = [];
		for (const ds of datasets) for (const y of ds.data) if (Number.isFinite(y)) ys.push(y);
		if (!ys.length) return {
			min: -1,
			max: 1
		};
		let min = Math.min(...ys), max = Math.max(...ys);
		if (min === max) {
			min -= 1;
			max += 1;
		}
		const pad = (max - min) * .06;
		return {
			min: min - pad,
			max: max + pad
		};
	}
	_evalAnnotations(chars, view, pins) {
		const out = [];
		for (const ann of view.annotations || []) {
			const val = this._evalPos(chars, view, pins, ann.at);
			if (val == null) continue;
			const entry = {
				...ann,
				atValue: val
			};
			if (ann.kind === "band") {
				const to = this._evalPos(chars, view, pins, ann.to);
				if (to == null) continue;
				entry.toValue = to;
			}
			out.push(entry);
		}
		return out;
	}
	_evalPos(chars, view, pins, pos) {
		if (!pos || !pos.script) return null;
		try {
			const v = evalExpr(compileExpr(pos.script), 0, { overrideScope: this._scopeFor(chars, view, pins, 1) });
			return Number.isFinite(v) ? v : null;
		} catch (_e) {
			return null;
		}
	}
	/** Which curve is which, as HTML so the labels render as KaTeX —
	*  Chart.js paints its own legend with canvas fillText, which leaves
	*  `\text{rad/s}` on screen as source (same constraint that put the
	*  annotation labels and the tooltip in HTML layers).
	*
	*  Behaviour matches the built-in legend it replaces: one chip per
	*  dataset, clicking toggles that dataset, an off chip is struck
	*  through, and the swatch carries the curve's real stroke — solid for
	*  the analyzed expression, dashed for a companion plot. */
	_renderSeriesLegend(legend, chart) {
		for (const el of legend.querySelectorAll(".fa-series-key")) el.remove();
		this._hiddenSeries.clear();
		const datasets = chart.data.datasets;
		if (datasets.length < 2) return;
		datasets.forEach((ds, i) => {
			const source = ds.$faLabel || ds.label || "";
			const chip = document.createElement("button");
			chip.className = "fa-btn fa-series-key";
			chip.title = `Show or hide ${detex(source)}`;
			const swatch = document.createElement("span");
			swatch.className = "fa-series-swatch" + ((ds.borderDash || []).length ? " dashed" : "");
			swatch.style.borderTopColor = ds.borderColor;
			const text = document.createElement("span");
			text.innerHTML = renderKaTeX$1(source, false);
			chip.append(swatch, text);
			chip.addEventListener("click", () => {
				const wasVisible = chart.isDatasetVisible(i);
				if (wasVisible) chart.hide(i);
				else chart.show(i);
				chip.classList.toggle("off", wasVisible);
				if (wasVisible) this._hiddenSeries.add(i);
				else this._hiddenSeries.delete(i);
			});
			legend.appendChild(chip);
		});
	}
	/** Legend for the drawn markers — and the switch that hides them.
	*  Lists only the kinds this chart actually has. */
	_renderMarkerLegend(legend, marks, chart) {
		for (const el of legend.querySelectorAll(".fa-mark-key")) el.remove();
		for (const [kind, cls, label] of [
			[
				"zeros",
				"fa-key-zero",
				"roots"
			],
			[
				"extrema",
				"fa-key-extremum",
				"max / min"
			],
			[
				"singularities",
				"fa-key-sing",
				"singularity"
			]
		]) {
			if (!marks.has(kind)) continue;
			const chip = document.createElement("button");
			chip.className = "fa-btn fa-mark-key" + (this._hiddenMarks.has(kind) ? " off" : "");
			chip.title = `Show or hide the ${label} markers`;
			const glyph = document.createElement("span");
			glyph.className = `fa-key-glyph ${cls}`;
			chip.append(glyph, document.createTextNode(label));
			chip.addEventListener("click", () => {
				if (this._hiddenMarks.has(kind)) this._hiddenMarks.delete(kind);
				else this._hiddenMarks.add(kind);
				chip.classList.toggle("off", this._hiddenMarks.has(kind));
				chart.update("none");
			});
			legend.appendChild(chip);
		}
	}
	_renderAnnLegend(legend, view, annotations, redraw) {
		for (const el of legend.querySelectorAll(".fa-ann-chip")) el.remove();
		const groups = /* @__PURE__ */ new Map();
		for (const a of annotations) {
			const g = a.group || "";
			groups.set(g, (groups.get(g) || 0) + 1);
		}
		if (!annotations.length) return;
		for (const [g] of groups) {
			const chip = document.createElement("button");
			chip.className = "fa-btn fa-ann-chip" + (this._hiddenGroups.has(g) ? " off" : "");
			chip.textContent = g || "markers";
			chip.title = "Toggle these markers";
			chip.addEventListener("click", () => {
				if (this._hiddenGroups.has(g)) this._hiddenGroups.delete(g);
				else this._hiddenGroups.add(g);
				redraw();
			});
			legend.appendChild(chip);
		}
	}
	/** Numeric feature markers (from the main dataset) + AI annotations. */
	_drawOverlays(chart, mainDataset, xs, marks, annotations) {
		const { ctx, chartArea, scales } = chart;
		if (!chartArea || !scales.x || !scales.y) return;
		ctx.save();
		ctx.beginPath();
		ctx.rect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
		ctx.clip();
		ctx.strokeStyle = "rgba(174, 187, 209, 0.7)";
		ctx.lineWidth = 1.4;
		if (scales.y.min < 0 && scales.y.max > 0) {
			const py = scales.y.getPixelForValue(0);
			ctx.beginPath();
			ctx.moveTo(chartArea.left, py);
			ctx.lineTo(chartArea.right, py);
			ctx.stroke();
		}
		if (scales.x.min < 0 && scales.x.max > 0) {
			const px = scales.x.getPixelForValue(0);
			ctx.beginPath();
			ctx.moveTo(px, chartArea.top);
			ctx.lineTo(px, chartArea.bottom);
			ctx.stroke();
		}
		ctx.lineWidth = 1;
		const labels = [];
		for (const a of annotations) if (a.kind === "vline") {
			const px = scales.x.getPixelForValue(a.atValue);
			ctx.strokeStyle = ANNOTATION_COLOR;
			ctx.setLineDash([5, 4]);
			ctx.beginPath();
			ctx.moveTo(px, chartArea.top);
			ctx.lineTo(px, chartArea.bottom);
			ctx.stroke();
			ctx.setLineDash([]);
			if (a.label) labels.push({
				text: a.label,
				left: px + 5,
				top: chartArea.top + 3,
				ann: a
			});
		} else if (a.kind === "hline") {
			const py = scales.y.getPixelForValue(a.atValue);
			ctx.strokeStyle = ANNOTATION_COLOR;
			ctx.setLineDash([5, 4]);
			ctx.beginPath();
			ctx.moveTo(chartArea.left, py);
			ctx.lineTo(chartArea.right, py);
			ctx.stroke();
			ctx.setLineDash([]);
			if (a.label) labels.push({
				text: a.label,
				left: chartArea.left + 6,
				top: py - 17,
				ann: a
			});
		} else if (a.kind === "band") {
			const p0 = scales.x.getPixelForValue(Math.min(a.atValue, a.toValue));
			const p1 = scales.x.getPixelForValue(Math.max(a.atValue, a.toValue));
			ctx.fillStyle = BAND_FILL;
			ctx.fillRect(p0, chartArea.top, p1 - p0, chartArea.bottom - chartArea.top);
			if (a.label) labels.push({
				text: a.label,
				left: p0 + 5,
				top: chartArea.bottom - 20,
				band: true,
				ann: a
			});
		}
		this._syncLabels(chart, labels);
		if (mainDataset) {
			const ys = mainDataset.data;
			if (marks.has("zeros")) {
				ctx.fillStyle = "#dde6ff";
				for (let i = 1; i < ys.length; i++) {
					if (ys[i - 1] == null || ys[i] == null) continue;
					if (Math.sign(ys[i - 1]) !== Math.sign(ys[i]) && Math.abs(ys[i - 1]) < 1e6) {
						const x = (xs[i - 1] + xs[i]) / 2;
						ctx.beginPath();
						ctx.arc(scales.x.getPixelForValue(x), scales.y.getPixelForValue(0), 3.5, 0, TAU);
						ctx.fill();
					}
				}
			}
			if (marks.has("extrema")) for (let i = 2; i < ys.length - 2; i++) {
				const w = ys.slice(i - 2, i + 3);
				if (w.some((y) => y == null)) continue;
				const c = ys[i];
				const isMax = w.every((y) => y <= c) && ys[i - 2] < c && ys[i + 2] < c;
				const isMin = w.every((y) => y >= c) && ys[i - 2] > c && ys[i + 2] > c;
				if (!isMax && !isMin) continue;
				const px = scales.x.getPixelForValue(xs[i]);
				const py = scales.y.getPixelForValue(c);
				ctx.fillStyle = "#ffa726";
				ctx.beginPath();
				ctx.arc(px, py, 4, 0, TAU);
				ctx.fill();
				ctx.fillStyle = "#ffcc80";
				ctx.font = "10px ui-monospace, Menlo, monospace";
				ctx.fillText(isMax ? "max" : "min", px + 6, isMax ? py - 6 : py + 14);
			}
			if (marks.has("singularities")) {
				ctx.strokeStyle = ANNOTATION_COLOR;
				ctx.setLineDash([3, 3]);
				for (let i = 1; i < ys.length; i++) if (ys[i - 1] == null !== (ys[i] == null)) {
					const x = (xs[i - 1] + xs[i]) / 2;
					const px = scales.x.getPixelForValue(x);
					ctx.beginPath();
					ctx.moveTo(px, chartArea.top);
					ctx.lineTo(px, chartArea.bottom);
					ctx.stroke();
				}
				ctx.setLineDash([]);
			}
		}
		ctx.restore();
	}
	_renderSliders(artifact, chars, proposal, view, host, state, onChange) {
		host.innerHTML = "";
		const pins = view.pinned || {};
		const names = Object.keys(pins);
		if (!names.length) return;
		for (const name of names) {
			const row = document.createElement("div");
			row.className = "fa-slider-row";
			const sym = document.createElement("span");
			sym.className = "fa-var";
			this._katex(sym, this._varLatex(chars, name));
			const desc = (proposal.variable_glossary || {})[name];
			if (desc) this._attachVarTooltip(sym, desc);
			const ask = makeAiAskButton("ai-ask-btn fa-hover-ask fa-var-ask", "Ask the AI about this variable", () => `In $${artifact.latex}$, what does the variable $${this._varLatex(chars, name)}$ represent` + (desc ? ` — the analysis says "${desc}"` : "") + `? I currently have it set to ${this._fmt(state.pins[name])}. Why does it matter here, and what changes as I move it?\n` + this._configSummary(chars, view, state));
			sym.appendChild(ask);
			row.classList.add("fa-askable");
			const v0 = Number(pins[name]) || 0;
			const lo = v0 === 0 ? -10 : Math.min(0, v0 * 3);
			const hi = v0 === 0 ? 10 : Math.max(v0 * 3, .001);
			const input = document.createElement("input");
			input.type = "range";
			input.min = String(lo);
			input.max = String(hi);
			input.step = String((hi - lo) / 200);
			input.value = String(state.pins[name] != null ? state.pins[name] : v0);
			const val = document.createElement("span");
			val.className = "fa-slider-val";
			val.textContent = (+input.value).toFixed(2);
			input.addEventListener("input", () => {
				state.pins[name] = parseFloat(input.value);
				val.textContent = (+input.value).toFixed(2);
				onChange();
			});
			row.append(sym, input, val);
			host.appendChild(row);
		}
	}
	_renderQuiz(artifact, chars, proposal) {
		const card = document.createElement("div");
		card.className = "fa-card fa-quiz";
		const label = document.createElement("div");
		label.className = "fa-sect-label";
		label.textContent = "Quiz";
		card.appendChild(label);
		const list = document.createElement("div");
		list.className = "fa-quiz-list";
		card.appendChild(list);
		const appendProbes = (probes) => {
			const startIdx = list.querySelectorAll(".fa-probe").length;
			probes.forEach((p, i) => {
				list.appendChild(this._renderProbe(artifact, p, startIdx + i + 1));
			});
		};
		appendProbes(proposal.probes || []);
		const more = document.createElement("button");
		more.className = "fa-btn fa-more";
		more.textContent = "More…";
		const moreStatus = document.createElement("span");
		moreStatus.className = "fa-more-status";
		more.addEventListener("click", async () => {
			more.disabled = true;
			moreStatus.innerHTML = "<span class=\"sgp-dots\"><span></span><span></span><span></span></span>";
			const asked = [...list.querySelectorAll(".fa-probe .fa-probe-q")].map((el) => el.dataset.question || "");
			try {
				const res = await invokeExpert("expression_analysis", {
					verb: "more_probes",
					latex: artifact.latex,
					characteristics: chars,
					context: String(this.buildContext(artifact.step) || "").slice(0, 2e3),
					asked
				}, { timeoutMs: REQUEST_TIMEOUT_MS });
				const probes = res && res.probes || [];
				if (probes.length) {
					appendProbes(probes);
					proposal.probes = [...proposal.probes || [], ...probes];
					const pre = this.pageEl.querySelector(".fa-json-modal pre");
					if (pre) pre.textContent = JSON.stringify(artifact.data, null, 2);
				}
				moreStatus.textContent = probes.length ? "" : "No new questions.";
			} catch (e) {
				moreStatus.textContent = e && e.message || "Failed.";
			}
			more.disabled = false;
		});
		card.append(more, moreStatus);
		return card;
	}
	_renderProbe(artifact, probe, number) {
		const div = document.createElement("div");
		div.className = "fa-probe";
		const q = document.createElement("div");
		q.className = "fa-probe-q";
		q.dataset.question = probe.question || "";
		const badge = document.createElement("span");
		badge.className = "fa-ai-badge";
		badge.title = "AI-generated";
		badge.innerHTML = AI_ICON;
		q.appendChild(badge);
		q.appendChild(document.createTextNode(`${number}. `));
		this._inlineMath(q, probe.question || "");
		this._attachHoverAsk(q, () => `I'm working on a quiz question about $${artifact.latex}$ and I have NOT answered it yet.\nQuestion: "${probe.question}"\nIMPORTANT: do NOT tell me the answer and do NOT identify or hint at which option is correct. Give me ONE guiding hint or a leading question that helps me reason it out myself — think Socratic tutor.`);
		div.appendChild(q);
		const opts = document.createElement("div");
		opts.className = "fa-probe-opts";
		const exp = document.createElement("div");
		exp.className = "fa-probe-exp";
		this._inlineMath(exp, probe.explanation || "");
		(probe.options || []).forEach((o, i) => {
			const b = document.createElement("button");
			b.className = "fa-btn fa-probe-chip";
			this._inlineMath(b, o);
			b.addEventListener("click", () => {
				for (const c of opts.children) c.disabled = true;
				const right = i === probe.correct_index;
				b.classList.add(right ? "right" : "wrong");
				if (!right && opts.children[probe.correct_index]) opts.children[probe.correct_index].classList.add("right");
				exp.classList.add("show");
				const correct = (probe.options || [])[probe.correct_index] || "";
				const ask = makeAiAskButton("ai-ask-btn fa-hover-ask", "Talk to the AI about your answer", () => `I just answered a quiz question about $${artifact.latex}$.\nQuestion: "${probe.question}"\nOptions: ${(probe.options || []).join(" | ")}\nThe correct answer is "${correct}". I chose "${o}" — ` + (right ? "I got it RIGHT." : "I got it WRONG.") + "\n" + (probe.explanation ? `The given explanation: "${probe.explanation}"\n` : "") + (right ? "Congratulate me briefly, then deepen my understanding with one extra insight about this behavior." : "Encourage me — no scolding — and help me see why the correct answer is right, building from what my choice got partially right if anything.") + "\nFirst verify the quiz against the expression itself: if the marked correct answer is mathematically wrong for this expression, say so plainly and teach the true answer instead.");
				exp.appendChild(ask);
				div.classList.add("fa-askable");
			}, { once: true });
			opts.appendChild(b);
		});
		div.append(opts, exp);
		return div;
	}
	_renderJsonPanel(artifact) {
		const overlay = document.createElement("div");
		overlay.className = "fa-json-overlay";
		overlay.addEventListener("click", (e) => {
			if (e.target === overlay) overlay.classList.remove("open");
		});
		const modal = document.createElement("div");
		modal.className = "fa-json-modal";
		const head = document.createElement("div");
		head.className = "fa-json-modal-head";
		const label = document.createElement("span");
		label.textContent = "Function analysis — raw JSON";
		const copy = document.createElement("button");
		copy.className = "fa-btn fa-json-copy";
		copy.textContent = "Copy";
		const close = document.createElement("button");
		close.className = "fa-btn fa-json-close";
		close.setAttribute("aria-label", "Close");
		close.textContent = "×";
		close.addEventListener("click", () => overlay.classList.remove("open"));
		head.append(label, copy, close);
		const pre = document.createElement("pre");
		pre.textContent = JSON.stringify(artifact.data, null, 2);
		copy.addEventListener("click", () => {
			navigator.clipboard.writeText(pre.textContent).then(() => {
				copy.textContent = "Copied!";
				setTimeout(() => {
					copy.textContent = "Copy";
				}, 1200);
			}).catch(() => {
				copy.textContent = "Copy failed";
			});
		});
		modal.append(head, pre);
		overlay.appendChild(modal);
		return overlay;
	}
	_varLatex(chars, name) {
		return (chars.variables_latex || {})[name] || name;
	}
	_varText(chars, name) {
		return detex(this._varLatex(chars, name));
	}
	_katex(el, latex) {
		if (this.katex) try {
			this.katex.render(String(latex), el, {
				throwOnError: false,
				displayMode: false
			});
			return;
		} catch (_e) {}
		el.textContent = String(latex);
	}
	/** Render text with inline $…$ math the same way as the rest of the
	*  app (labels.js renderKaTeX — used by tree labels, proof titles). */
	_inlineMath(el, text) {
		const span = document.createElement("span");
		span.innerHTML = renderKaTeX$1(String(text || ""), false);
		el.appendChild(span);
	}
	/** Instant styled tooltip with the variable's AI-written description
	*  (native `title` is too slow/subtle for a teaching surface). */
	_attachVarTooltip(el, desc) {
		el.addEventListener("mouseenter", () => {
			let tip = this.pageEl.querySelector(".fa-tooltip");
			if (!tip) {
				tip = document.createElement("div");
				tip.className = "fa-tooltip";
				this.pageEl.appendChild(tip);
			}
			tip.innerHTML = `<span class="fa-ai-badge">${AI_ICON}</span> ` + renderKaTeX$1(desc, false);
			const r = el.getBoundingClientRect();
			const host = this.pageEl.getBoundingClientRect();
			tip.style.left = `${r.left - host.left}px`;
			tip.style.top = `${r.top - host.top + this.pageEl.scrollTop - 8}px`;
			tip.classList.add("show");
		});
		el.addEventListener("mouseleave", () => {
			const tip = this.pageEl.querySelector(".fa-tooltip");
			if (tip) tip.classList.remove("show");
		});
	}
	/** Hover-revealed AI ask button beside the element (app-wide pattern). */
	_attachHoverAsk(el, getMessage) {
		const btn = makeAiAskButton("ai-ask-btn fa-hover-ask", "Ask the AI about this", getMessage);
		el.classList.add("fa-askable");
		el.appendChild(btn);
	}
	destroy() {
		this._destroyCharts();
		if (this.pageEl && this.pageEl.parentNode) this.pageEl.parentNode.removeChild(this.pageEl);
		this.pageEl = null;
		this.activeArtifact = null;
		this._restoreGraphChrome();
	}
};
//#endregion
//#region src/graph-view.ts
var _currentGraphPanel = null;
var _currentSemanticKey = null;
var _activeStepForPanel = null;
var _initDone = false;
var _currentD3Renderer = null;
var _currentChartManager = null;
var _chartManagers = /* @__PURE__ */ new Map();
var _currentProofManager = null;
var _faManager = null;
/** Function-analysis page manager — created on first use so the module can
*  hook rebuildProofTree/currentProofStep, which are declared later. */
function getFaManager() {
	if (_faManager) return _faManager;
	_faManager = new FunctionAnalysisManager({
		katex: window.katex,
		getViewport: () => document.getElementById("graph-viewport"),
		buildContext: (step) => {
			const ctx = buildEnrichContext(step) || {};
			const entry = state.proofSpec && state.proofSpec[state.proofActiveIndex];
			const domain = entry && entry.proof && entry.proof.domain;
			if (domain) ctx.mathDomain = domain;
			return Object.entries(ctx).map(([k, v]) => `${k}: ${v}`).join("\n");
		},
		onArtifactsChanged: () => rebuildProofTree(),
		onPageClosed: () => {},
		onActiveChanged: ({ replace = false } = {}) => {
			try {
				window.dispatchEvent(new CustomEvent("algebench:fachange", { detail: { replace: !!replace } }));
			} catch (_) {}
		}
	});
	return _faManager;
}
var _faOrphanStep = {};
/** The id of the artifact whose Function Analysis page is showing, else null. */
function getFunctionAnalysisId() {
	if (!_faManager || !_faManager.isOpen()) return null;
	const a = _faManager.activeArtifact;
	return a && a.id || null;
}
/**
* Open the Function Analysis page from a deeplink.
*   `id`    — an artifact already attached to the current proof step (this
*             session): re-focus it, no expert call.
*   `latex` — an expression to analyze. `open()` dedups on (node, expression),
*             so arriving twice with the same expression re-focuses the first
*             analysis instead of stacking duplicates or re-billing the LM.
* Node-less by construction: the producer is a proof step (or an agent), not a
* semantic-graph node, so the artifact carries `nodeId: null`.
*/
function openFunctionAnalysis({ id = null, latex = null } = {}) {
	const step = currentProofStep() || _faOrphanStep;
	const mgr = getFaManager();
	const existing = mgr.findById(step, id);
	if (existing) {
		mgr.show(existing);
		return true;
	}
	if (!latex) return false;
	mgr.open({
		id: null,
		subexpr: String(latex)
	}, step);
	return true;
}
/** Close the Function Analysis page if it is showing (no-op otherwise). */
function closeFunctionAnalysis() {
	if (_faManager && _faManager.isOpen()) _faManager.close();
}
var _d3NodeAskBtn = null;
var _d3NodeAskHideTimer = null;
var _d3HoveredNodeId = null;
var _d3ActiveGraph = null;
var _d3StepStates = /* @__PURE__ */ new Map();
var _d3LastStepKey = null;
var _pendingDeeplinkSelection = null;
/** Current selection as an ordered array, active node last. */
function getGraphSelection() {
	if (!_currentD3Renderer || _currentD3Renderer._destroyed) return [];
	const sel = [..._currentD3Renderer.selectedNodes];
	const active = _currentD3Renderer.activeNode;
	if (active && sel.includes(active)) return [...sel.filter((id) => id !== active), active];
	return sel;
}
/** Stash a deeplink selection; applied on the next/current step render. */
function applyDeeplinkSelection(ids) {
	_pendingDeeplinkSelection = Array.isArray(ids) ? ids.slice() : [];
	if (_currentD3Renderer && !_currentD3Renderer._destroyed && _d3ActiveGraph) _applyPendingDeeplinkSelection(_d3ActiveGraph);
}
function _applyPendingDeeplinkSelection(graph) {
	if (_pendingDeeplinkSelection == null) return;
	const want = _pendingDeeplinkSelection;
	_pendingDeeplinkSelection = null;
	if (!_currentD3Renderer || _currentD3Renderer._destroyed) return;
	const valid = want.filter((id) => (graph.nodes || []).some((n) => n.id === id));
	_currentD3Renderer.setSelection(valid);
	if (valid.length > 1) _showD3MultiInfoPanel(new Set(valid), graph);
	else if (valid.length === 1) {
		const node = (graph.nodes || []).find((n) => n.id === valid[0]);
		_showD3InfoPanel(valid[0], node, graph);
	} else _hideD3InfoPanel();
}
/** 'math' when the Math tab is active, else 'scene'. (Internal dock id is 'graph'.) */
function getCurrentView() {
	const active = document.querySelector(".dock-tab.active");
	return active && active.dataset.dockTab === "graph" ? "math" : "scene";
}
/** Switch to the Math (graph) view; resolves when the graph has rendered. */
function showGraphView() {
	return setDockTab("graph");
}
/** Switch to the Scenes (3D) view. */
function showSceneView() {
	return setDockTab("scenes");
}
if (typeof window !== "undefined") window.__algebenchGraph = {
	getSelection: getGraphSelection,
	applyDeeplinkSelection,
	getCurrentView,
	showGraphView,
	showSceneView,
	dockProofAnimation,
	getFunctionAnalysisId,
	openFunctionAnalysis,
	closeFunctionAnalysis,
	isDocked: () => _docked,
	setDocked: (on) => toggleDockMode(!!on, false)
};
var LS_KEYS = {
	theme: "algebench.graph.theme",
	direction: "algebench.graph.direction",
	labels: "algebench.graph.labels",
	zoom: "algebench.graph.zoom",
	renderer: "algebench.graph.renderer",
	docked: "algebench.graph.docked",
	dockRatio: "algebench.graph.dockRatio"
};
var _lsGet$1 = (key, fallback) => {
	try {
		return localStorage.getItem(key) ?? fallback;
	} catch {
		return fallback;
	}
};
var _lsSet$1 = (key, value) => {
	try {
		localStorage.setItem(key, value);
	} catch {}
};
var _currentTheme = _lsGet$1(LS_KEYS.theme, "linalg-dark");
var _appMode = () => document.documentElement.dataset.theme === "light" ? "light" : "dark";
var _currentMode = _appMode();
var DIRECTION_TO_MERMAID = Object.assign(Object.create(null), {
	"top-down": "BT",
	"left-right": "RL",
	"right-left": "LR",
	"bottom-up": "TB"
});
var LEGACY_DIRECTION_MAP = Object.assign(Object.create(null), {
	TB: "bottom-up",
	BT: "top-down",
	LR: "right-left",
	RL: "left-right"
});
{
	const stored = _lsGet$1(LS_KEYS.direction, null);
	if (stored && LEGACY_DIRECTION_MAP[stored]) _lsSet$1(LS_KEYS.direction, LEGACY_DIRECTION_MAP[stored]);
}
var _currentDirection = _lsGet$1(LS_KEYS.direction, "left-right");
var LABEL_PRESETS = Object.assign(Object.create(null), {
	minimal: null,
	description: [
		"emoji",
		"description",
		"label"
	],
	full: [
		"emoji",
		"description",
		"label",
		"unit",
		"role",
		"quantity",
		"dimension"
	]
});
var _currentLabels = _lsGet$1(LS_KEYS.labels, "description");
if (!(_currentLabels in LABEL_PRESETS)) _currentLabels = "description";
var _currentRenderer = _lsGet$1(LS_KEYS.renderer, "d3");
if (_currentRenderer !== "mermaid" && _currentRenderer !== "d3") _currentRenderer = "d3";
var _docked = _lsGet$1(LS_KEYS.docked, "false") === "true";
var _dockRatio = (() => {
	const v = Number(_lsGet$1(LS_KEYS.dockRatio, "0.5"));
	return Number.isFinite(v) && v > 0 && v < 1 ? v : .5;
})();
var _allThemes = [];
var _activeMermaidMode = null;
var ZOOM_BASELINE = .7;
var ZOOM_MIN = .4;
var ZOOM_MAX = 4;
var ZOOM_STEP = .1;
function _normalizeZoom(v) {
	const n = Number(v);
	if (!Number.isFinite(n)) return 1;
	return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
}
var _zoom = _normalizeZoom(_lsGet$1(LS_KEYS.zoom, "1.0"));
var MERMAID_CDN_URL = "https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.min.js";
var _mermaidLoadPromise = null;
function loadMermaidLib() {
	if (_mermaidLoadPromise) return _mermaidLoadPromise;
	if (typeof window.mermaid !== "undefined") {
		_mermaidLoadPromise = Promise.resolve(window.mermaid);
		return _mermaidLoadPromise;
	}
	_mermaidLoadPromise = new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = MERMAID_CDN_URL;
		s.async = true;
		s.onload = () => {
			if (typeof window.mermaid === "undefined") {
				reject(/* @__PURE__ */ new Error("mermaid script loaded but window.mermaid is undefined"));
				return;
			}
			resolve(window.mermaid);
		};
		s.onerror = () => reject(/* @__PURE__ */ new Error(`failed to load mermaid from ${MERMAID_CDN_URL}`));
		document.head.appendChild(s);
	});
	_mermaidLoadPromise.catch(() => {
		_mermaidLoadPromise = null;
	});
	return _mermaidLoadPromise;
}
function initMermaidForMode(mode) {
	if (typeof window.mermaid === "undefined") return false;
	const isDark = mode === "dark";
	const cfg = {
		startOnLoad: false,
		theme: isDark ? "dark" : "base",
		securityLevel: "loose",
		flowchart: {
			htmlLabels: true,
			curve: "basis"
		},
		themeVariables: isDark ? {
			background: "transparent",
			lineColor: "#a9b3dc",
			textColor: "#e8eeff",
			mainBkg: "transparent",
			nodeBorder: "#8e9ad8",
			clusterBkg: "transparent"
		} : {
			background: "#f7f8fb",
			lineColor: "#555",
			textColor: "#222",
			nodeBorder: "#888"
		}
	};
	window.mermaid.initialize(cfg);
	_activeMermaidMode = mode;
	return true;
}
async function ensureMermaid(mode = "dark") {
	try {
		await loadMermaidLib();
	} catch (err) {
		console.error("[graph-view]", err);
		return false;
	}
	if (_activeMermaidMode !== mode) initMermaidForMode(mode);
	return true;
}
async function fetchMermaidFromGraph(graph, theme, direction, show) {
	const mermaidDir = DIRECTION_TO_MERMAID[direction] || direction;
	const res = await fetch("/api/graph/mermaid", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			graph,
			theme,
			direction: mermaidDir,
			show
		})
	});
	if (!res.ok) throw new Error(`mermaid render failed: HTTP ${res.status}`);
	const data = await res.json();
	if (data.error) throw new Error(data.error);
	return {
		mermaid: data.mermaid,
		mode: data.mode || "dark",
		edgeStyles: data.edgeStyles || {}
	};
}
/**
* Walk every rendered node label and replace ``$...$`` spans with KaTeX
* HTML. Mermaid's own KaTeX integration runs only on display-math
* (``$$..$$``) and emits MathML-only, which the browser renders with
* tight accent placement and without KaTeX's hand-tuned glyph metrics —
* we avoid that path entirely by emitting inline ``$..$`` everywhere
* and rendering it here with KaTeX's HTML output. Also keeps the
* per-line layout of auto-derived graphs.
*/
function renderInlineLatexInNodes(container) {
	const katex = window.katex;
	if (!katex || !container) return;
	const INLINE_MATH = /\$([^$\n]+)\$/g;
	container.querySelectorAll("foreignObject span, foreignObject div, foreignObject p, .nodeLabel").forEach((host) => {
		if (!host.textContent || host.textContent.indexOf("$") === -1) return;
		const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null);
		const textNodes = [];
		while (walker.nextNode()) textNodes.push(walker.currentNode);
		textNodes.forEach((tn) => {
			const src = tn.nodeValue;
			if (!src || src.indexOf("$") === -1) return;
			INLINE_MATH.lastIndex = 0;
			if (!INLINE_MATH.test(src)) return;
			INLINE_MATH.lastIndex = 0;
			const frag = document.createDocumentFragment();
			let last = 0;
			let m;
			while ((m = INLINE_MATH.exec(src)) !== null) {
				if (m.index > last) frag.appendChild(document.createTextNode(src.slice(last, m.index)));
				const span = document.createElement("span");
				try {
					katex.render(m[1], span, {
						throwOnError: false,
						displayMode: false
					});
				} catch (_err) {
					span.textContent = m[0];
				}
				frag.appendChild(span);
				last = m.index + m[0].length;
			}
			if (last < src.length) frag.appendChild(document.createTextNode(src.slice(last)));
			tn.parentNode.replaceChild(frag, tn);
		});
	});
}
/**
* Center each node's label content horizontally inside its Mermaid-sized
* ``foreignObject``.
*
* Why this is needed: Mermaid sizes the ``foreignObject`` + parent shape
* from the *raw* label string (``$\hat{H}$`` measures ~64px as plain
* text). Our post-Mermaid walker then replaces that string with KaTeX
* HTML — which is often much narrower. Mermaid's outer ``<div>`` uses
* ``display: table-cell`` with auto width, so the shrunken content sits
* flush-left inside the oversized box, leaving a fat right gutter.
*
* We fix the visual asymmetry by wrapping the existing label div in a
* flex-centered box that fills the foreignObject. The shape and the
* foreignObject itself are left untouched so every Mermaid-computed
* edge keeps terminating at the correct stroke boundary.
*/
function centerLabelsInNodes(container) {
	const svg = container && container.querySelector("svg");
	if (!svg) return;
	const NS = "http://www.w3.org/1999/xhtml";
	svg.querySelectorAll("g.node foreignObject").forEach((fo) => {
		const outer = fo.firstElementChild;
		if (!outer || outer.nodeType !== 1) return;
		if (outer.dataset && outer.dataset.gvCentered === "wrapper") return;
		if (outer.parentElement !== fo) return;
		const wrapper = document.createElementNS(NS, "div");
		wrapper.setAttribute("style", "display:flex;justify-content:center;align-items:center;width:100%;height:100%;");
		wrapper.dataset.gvCentered = "wrapper";
		fo.insertBefore(wrapper, outer);
		wrapper.appendChild(outer);
	});
}
function isGraphModeActive() {
	const tab = document.querySelector(".dock-tab.active");
	return tab && tab.dataset.dockTab === "graph";
}
function setupDockTabs() {
	document.querySelectorAll(".dock-tab").forEach((btn) => {
		btn.addEventListener("click", () => {
			if (btn.classList.contains("active")) return;
			setDockTab(btn.dataset.dockTab);
		});
	});
}
function setDockTab(name) {
	document.querySelectorAll(".dock-tab").forEach((b) => {
		b.classList.toggle("active", b.dataset.dockTab === name);
	});
	document.querySelectorAll(".dock-tab-content").forEach((c) => {
		c.classList.toggle("active", c.id === `dock-tab-${name}`);
	});
	const graphVp = document.getElementById("graph-viewport");
	const mathWrap = document.getElementById("mathbox-wrapper");
	if (!graphVp || !mathWrap) return Promise.resolve();
	let rendered = Promise.resolve();
	if (name === "graph") {
		graphVp.classList.remove("hidden");
		if (_docked) _applyDockedLayout();
		else mathWrap.style.visibility = "hidden";
		loadMermaidLib().catch(() => {});
		rebuildProofTree();
		rendered = renderCurrentStepGraph(true);
	} else {
		graphVp.classList.add("hidden");
		mathWrap.style.visibility = "";
		_removeDockedLayout();
	}
	_syncDockButton();
	try {
		window.dispatchEvent(new CustomEvent("algebench:viewchange"));
	} catch (_) {}
	return rendered;
}
function _applyDockedLayout() {
	const viewport = document.getElementById("viewport");
	const mathWrap = document.getElementById("mathbox-wrapper");
	if (!viewport) return;
	viewport.classList.add("graph-docked");
	if (mathWrap) mathWrap.style.visibility = "";
	_applyDockRatio();
	setTimeout(() => {
		window.dispatchEvent(new Event("resize"));
		if (_currentD3Renderer && !_currentD3Renderer._destroyed) _currentD3Renderer.zoomToFit();
	}, 80);
}
function _removeDockedLayout() {
	const viewport = document.getElementById("viewport");
	if (!viewport) return;
	viewport.classList.remove("graph-docked");
	const wrapper = document.getElementById("mathbox-wrapper");
	if (wrapper) wrapper.style.width = "";
	setTimeout(() => {
		window.dispatchEvent(new Event("resize"));
		if (_currentD3Renderer && !_currentD3Renderer._destroyed) _currentD3Renderer.zoomToFit();
	}, 80);
}
function _applyDockRatio() {
	const wrapper = document.getElementById("mathbox-wrapper");
	if (!wrapper) return;
	wrapper.style.width = (_dockRatio * 100).toFixed(1) + "%";
}
function _syncDockButton() {
	const btn = document.getElementById("graph-dock-toggle");
	if (!btn) return;
	const active = _docked && isGraphModeActive();
	btn.classList.toggle("active", active);
	btn.title = active ? "Undock graph to full viewport (D)" : "Dock graph alongside 3D viewport (D)";
}
function toggleDockMode(forceDocked, persist = true) {
	const next = typeof forceDocked === "boolean" ? forceDocked : !_docked;
	if (next === _docked) return;
	_docked = next;
	if (persist) _lsSet$1(LS_KEYS.docked, String(_docked));
	if (!isGraphModeActive()) {
		_syncDockButton();
		return;
	}
	const mathWrap = document.getElementById("mathbox-wrapper");
	if (_docked) _applyDockedLayout();
	else {
		_removeDockedLayout();
		if (mathWrap) mathWrap.style.visibility = "hidden";
	}
	_syncDockButton();
}
function setupDockToggle() {
	const btn = document.getElementById("graph-dock-toggle");
	if (!btn) return;
	btn.addEventListener("click", () => toggleDockMode());
	_syncDockButton();
}
function setupDockResize() {
	const handle = document.getElementById("graph-dock-resize-handle");
	const viewport = document.getElementById("viewport");
	if (!handle || !viewport) return;
	let dragging = false;
	let startX, startWidth, startRatio;
	handle.addEventListener("mousedown", (e) => {
		if (!viewport.classList.contains("graph-docked")) return;
		e.preventDefault();
		dragging = true;
		startX = e.clientX;
		startWidth = viewport.offsetWidth;
		startRatio = _dockRatio;
		handle.classList.add("dragging");
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
	});
	document.addEventListener("mousemove", (e) => {
		if (!dragging) return;
		const dx = e.clientX - startX;
		const minPx = 160;
		const raw = startWidth * startRatio + dx;
		_dockRatio = Math.max(minPx, Math.min(startWidth - 200, raw)) / startWidth;
		_applyDockRatio();
		window.dispatchEvent(new Event("resize"));
	});
	document.addEventListener("mouseup", () => {
		if (!dragging) return;
		dragging = false;
		handle.classList.remove("dragging");
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
		_lsSet$1(LS_KEYS.dockRatio, _dockRatio.toFixed(4));
	});
}
function getAllProofEntries() {
	if (state.proofAllSpecs && state.proofAllSpecs.length) return state.proofAllSpecs;
	return [];
}
function sceneTitleForIndex(si) {
	if (state.lessonSpec && state.lessonSpec.scenes && state.lessonSpec.scenes[si]) return state.lessonSpec.scenes[si].title || `Scene ${si + 1}`;
	if (state.currentSpec && state.currentSpec.title) return state.currentSpec.title;
	return `Scene ${si + 1}`;
}
function groupEntriesByScene(entries) {
	const bySi = /* @__PURE__ */ new Map();
	for (const e of entries) {
		const si = e.sceneIndex != null ? e.sceneIndex : -1;
		if (!bySi.has(si)) bySi.set(si, []);
		bySi.get(si).push(e);
	}
	const out = [];
	for (const [si, group] of bySi) out.push({
		sceneIndex: si,
		sceneTitle: si < 0 ? "Lesson-level proofs" : sceneTitleForIndex(si),
		entries: group
	});
	return out;
}
function rebuildProofTree() {
	const root = document.getElementById("graph-proof-tree");
	if (!root) return;
	const entries = getAllProofEntries();
	if (!entries.length) {
		root.innerHTML = "<div class=\"gp-tree-scene-title\" style=\"padding:12px\">No proofs in this lesson.</div>";
		return;
	}
	const groups = groupEntriesByScene(entries);
	root.innerHTML = "";
	const multiScene = groups.length > 1;
	groups.forEach((group) => {
		const groupEl = document.createElement("div");
		groupEl.className = "gp-tree-scene";
		if (multiScene) {
			const ttl = document.createElement("div");
			ttl.className = "gp-tree-scene-title";
			ttl.innerHTML = renderKaTeX$1(group.sceneTitle, false);
			groupEl.appendChild(ttl);
		}
		group.entries.forEach((entry) => {
			const proof = entry.proof;
			if (!proof || !proof.steps) return;
			const specIdx = state.proofSpec ? state.proofSpec.indexOf(entry) : -1;
			entry._entryId = _proofEntryId(entry, specIdx);
			const proofEl = document.createElement("div");
			proofEl.className = "gp-tree-proof";
			const header = document.createElement("div");
			header.className = "gp-tree-proof-header";
			const arrow = document.createElement("span");
			arrow.className = "gp-tree-proof-arrow";
			arrow.textContent = "▶";
			const title = document.createElement("span");
			title.innerHTML = renderKaTeX$1(proof.title || proof.id || "Proof", false);
			header.append(arrow, title);
			proofEl.appendChild(header);
			const stepsEl = document.createElement("div");
			stepsEl.className = "gp-tree-steps";
			(proof.steps || []).forEach((step, sIdx) => {
				const hasGraph = !!(step && step.semanticGraph && step.semanticGraph.graph);
				const hasError = !!(step && step.semanticGraph && step.semanticGraph.error);
				let cls = "gp-tree-step";
				if (!hasGraph) cls += " no-graph";
				if (hasError) cls += " has-error";
				const stepEl = document.createElement("div");
				stepEl.className = cls;
				stepEl.dataset.sceneIdx = entry.sceneIndex != null ? String(entry.sceneIndex) : "";
				stepEl.dataset.proofId = entry._entryId;
				stepEl.dataset.stepIdx = String(sIdx);
				const idxEl = document.createElement("span");
				idxEl.className = "gp-tree-step-idx";
				idxEl.textContent = String(sIdx + 1);
				const labelEl = document.createElement("span");
				labelEl.className = "gp-tree-step-label";
				labelEl.innerHTML = renderKaTeX$1(step.label || step.justification || step.math || `Step ${sIdx + 1}`, false);
				stepEl.append(idxEl, labelEl);
				if (hasGraph) {
					const dot = document.createElement("span");
					dot.className = "gp-tree-step-has-graph";
					dot.title = "Has semantic graph";
					dot.textContent = "●";
					stepEl.appendChild(dot);
				} else if (hasError) {
					const warn = document.createElement("span");
					warn.className = "gp-tree-step-has-error";
					warn.title = step.semanticGraph.error.message || "Graph could not be derived for this step";
					warn.textContent = "⚠";
					stepEl.appendChild(warn);
				}
				stepEl.addEventListener("click", (e) => {
					e.stopPropagation();
					handleTreeStepClick(entry, sIdx);
				});
				stepsEl.appendChild(stepEl);
				for (const fa of getFaManager().listFor(step)) stepsEl.appendChild(_buildFaTreeRow(entry, sIdx, fa));
			});
			header.addEventListener("click", () => proofEl.classList.toggle("expanded"));
			proofEl.appendChild(stepsEl);
			if (specIdx === state.proofActiveIndex) proofEl.classList.add("expanded");
			groupEl.appendChild(proofEl);
		});
		root.appendChild(groupEl);
	});
	updateTreeHighlight();
}
/** One Math-tree child row for a function-analysis artifact. Clicking
*  navigates to the owning step, then opens the artifact's page. */
function _buildFaTreeRow(entry, stepIdx, fa) {
	const row = document.createElement("div");
	row.className = "gp-tree-fa" + (_faManager && _faManager.activeArtifact === fa ? " active" : "");
	const glyph = document.createElement("span");
	glyph.className = "fa-glyph";
	glyph.innerHTML = FUNCTION_ANALYSIS_ICON;
	const label = document.createElement("span");
	if (fa.status === "loading") {
		label.className = "fa-loading";
		label.textContent = "Analyzing…";
	} else if (fa.status === "error") {
		label.className = "fa-err";
		label.textContent = fa.title || "Analysis failed";
	} else label.textContent = fa.title || "Function analysis";
	row.append(glyph, label);
	row.addEventListener("click", (e) => {
		e.stopPropagation();
		handleTreeStepClick(entry, stepIdx);
		getFaManager().show(fa);
	});
	return row;
}
/** Stable identifier for a proof spec entry — uses the real proof id when
*  present, otherwise synthesises one from the spec-array position so that
*  every entry is matchable even when the lesson JSON omits the id field. */
function _proofEntryId(entry, specIdx) {
	return entry.proof && entry.proof.id || `__proof_${specIdx}`;
}
function handleTreeStepClick(entry, stepIdx) {
	const proof = entry.proof;
	const step = proof && proof.steps && proof.steps[stepIdx];
	if (!step) return;
	state._graphSyncInProgress = true;
	try {
		const sceneStep = step.sceneStep;
		if (sceneStep != null && typeof window.navigateTo === "function") {
			if (typeof sceneStep === "string" && sceneStep.includes(":")) {
				const [si, sti] = sceneStep.split(":").map(Number);
				if (!Number.isNaN(si) && !Number.isNaN(sti)) {
					window.navigateTo(si, sti);
					_forceActivateProofStep(entry, stepIdx);
					return;
				}
			} else if (entry.sceneIndex != null) {
				window.navigateTo(entry.sceneIndex, Number(sceneStep));
				_forceActivateProofStep(entry, stepIdx);
				return;
			}
		}
		if (entry.sceneIndex != null && typeof window.navigateTo === "function" && entry.sceneIndex !== state.currentSceneIndex) window.navigateTo(entry.sceneIndex, state.currentStepIndex);
		_forceActivateProofStep(entry, stepIdx);
	} finally {
		state._graphSyncInProgress = false;
		if (isGraphModeActive()) renderCurrentStepGraph();
	}
}
function _forceActivateProofStep(entry, stepIdx) {
	if (!state.proofSpec) return;
	const targetIdx = state.proofSpec.findIndex((e, idx) => _proofEntryId(e, idx) === entry._entryId && e.sceneIndex === entry.sceneIndex);
	if (targetIdx < 0) return;
	if (targetIdx !== state.proofActiveIndex) {
		const header = document.querySelector(`.proof-section[data-proof-idx="${targetIdx}"] .proof-section-header`);
		if (header) header.click();
	}
	if (typeof window.navigateProof === "function") window.navigateProof(stepIdx);
}
function updateTreeHighlight() {
	const activeEntry = state.proofSpec && state.proofSpec[state.proofActiveIndex];
	const activeId = activeEntry ? _proofEntryId(activeEntry, state.proofActiveIndex) : null;
	const activeStep = state.proofStepIndex;
	document.querySelectorAll("#graph-proof-tree .gp-tree-step").forEach((el) => {
		const match = el.dataset.proofId === activeId && Number(el.dataset.stepIdx) === activeStep;
		el.classList.toggle("active", match);
		if (match) {
			const parent = el.closest(".gp-tree-proof");
			if (parent) parent.classList.add("expanded");
			try {
				el.scrollIntoView({ block: "nearest" });
			} catch {}
		}
	});
}
function clearGraph() {
	const container = document.getElementById("graph-mermaid-container");
	if (container) container.innerHTML = "";
	if (_currentGraphPanel) {
		try {
			_currentGraphPanel.destroy();
		} catch {}
		_currentGraphPanel = null;
	}
	if (_currentD3Renderer) {
		try {
			_currentD3Renderer.destroy();
		} catch {}
		_currentD3Renderer = null;
		_d3LastStepKey = null;
	}
	if (_d3NodeAskBtn && _d3NodeAskBtn.parentNode) _d3NodeAskBtn.remove();
	_d3NodeAskBtn = null;
	if (_d3NodeAskHideTimer) {
		clearTimeout(_d3NodeAskHideTimer);
		_d3NodeAskHideTimer = null;
	}
	_d3HoveredNodeId = null;
	_d3ActiveGraph = null;
	const infoHost = document.getElementById("graph-info-panel-host");
	if (infoHost) infoHost.innerHTML = "";
	const legend = document.getElementById("graph-edge-legend");
	if (legend) {
		legend.classList.add("hidden");
		legend.innerHTML = "";
	}
	hideErrorState();
	_currentSemanticKey = null;
}
function showErrorState(err) {
	const host = document.getElementById("graph-error-state");
	if (!host) return;
	const reason = err && err.reason === "parse_crashed" ? "Parser error" : "Unsupported expression";
	const message = err && err.message || "Parser could not derive a semantic graph.";
	host.innerHTML = "<div class=\"gv-err-title\"><span aria-hidden=\"true\">&#9888;&#65039;</span><span>" + escapeHtml(reason) + "</span></div><div class=\"gv-err-message\">" + escapeHtml(message) + "</div>" + (err && err.math ? "<code class=\"gv-err-math\">" + escapeHtml(err.math) + "</code>" : "");
	host.classList.remove("hidden");
	const empty = document.getElementById("graph-empty-state");
	if (empty) empty.style.display = "none";
}
function hideErrorState() {
	const host = document.getElementById("graph-error-state");
	if (host) {
		host.classList.add("hidden");
		host.innerHTML = "";
	}
	const empty = document.getElementById("graph-empty-state");
	if (empty) empty.style.display = "";
}
async function _renderWithD3(container, graph, step, key) {
	const viewport = document.getElementById("graph-viewport");
	if (viewport) {
		viewport.classList.toggle("gv-theme-light", _currentMode === "light");
		viewport.classList.toggle("gv-theme-dark", _currentMode !== "light");
	}
	if (_currentGraphPanel) {
		try {
			_currentGraphPanel.destroy();
		} catch {}
		_currentGraphPanel = null;
	}
	const infoHost = document.getElementById("graph-info-panel-host");
	if (infoHost) infoHost.innerHTML = "";
	_d3ActiveGraph = graph;
	{
		const ckey = stableStepKey(step);
		let cm = _chartManagers.get(ckey);
		if (!cm || cm._destroyed) {
			cm = new SgChartManager(container, graph, { katex: window.katex });
			_chartManagers.set(ckey, cm);
		} else cm.setGraph(graph);
		_currentChartManager = cm;
	}
	if (!_currentProofManager || _currentProofManager._destroyed) _currentProofManager = new SgProofManager(container, {
		katex: window.katex,
		onBackgroundDeselect: () => {
			if (_currentD3Renderer && typeof _currentD3Renderer.clearSelection === "function") _currentD3Renderer.clearSelection();
			_hideD3InfoPanel();
			if (_currentProofManager) _currentProofManager.syncSelectionFromGraph(/* @__PURE__ */ new Set());
			try {
				window.dispatchEvent(new CustomEvent("algebench:selectionchange"));
			} catch (_) {}
		}
	});
	if (!_currentD3Renderer || _currentD3Renderer._destroyed) _currentD3Renderer = new D3SemanticGraphRenderer(container, {
		katex: window.katex,
		direction: _currentDirection,
		labels: _currentLabels,
		theme: _currentTheme,
		onNodeClick: (nodeId, nodeData, selectedIds, additive) => {
			if (!selectedIds || selectedIds.size === 0) _hideD3InfoPanel();
			else if (selectedIds.size > 1) _showD3MultiInfoPanel(selectedIds, _d3ActiveGraph);
			else _showD3InfoPanel(nodeId, nodeData, _d3ActiveGraph);
			if (_currentProofManager) _currentProofManager.syncSelectionFromGraph(selectedIds, additive);
			try {
				window.dispatchEvent(new CustomEvent("algebench:selectionchange"));
			} catch (_) {}
		},
		onBackgroundClick: () => {
			_hideD3InfoPanel();
			if (_currentProofManager) _currentProofManager.syncSelectionFromGraph(/* @__PURE__ */ new Set());
		},
		onNodeHover: (nodeId, nodeData, nodeEl) => {
			if (nodeId && nodeEl) {
				_d3HoveredNodeId = nodeId;
				_showD3NodeAskBtn(nodeEl);
			} else _hideD3NodeAskBtn();
			if (_currentProofManager) _currentProofManager.highlightTermsForNode(nodeId || null);
		},
		onZoomChange: (pct) => {
			const label = document.getElementById("graph-zoom-level");
			if (label) label.textContent = `${pct}%`;
		},
		onTransformChange: (t) => {
			if (_currentChartManager) _currentChartManager.setTransform(t);
			if (_currentProofManager) _currentProofManager.setTransform(t);
		},
		onChartClick: (nodeId, nodeData, btnEl) => {
			if (!_currentChartManager) return;
			_currentChartManager.openChart(nodeId, btnEl);
		},
		onFaClick: (nodeId, nodeData) => {
			const step = currentProofStep();
			if (step) getFaManager().open(nodeData, step);
		}
	});
	else await _currentD3Renderer.update({
		direction: _currentDirection,
		labels: _currentLabels,
		theme: _currentTheme
	});
	if (_currentChartManager && _currentD3Renderer) _currentChartManager.setRenderer(_currentD3Renderer);
	if (_currentProofManager && _currentD3Renderer) _currentProofManager.setRenderer(_currentD3Renderer);
	const stepKey = stableStepKey(step);
	if (_currentD3Renderer && _d3LastStepKey && _d3LastStepKey !== stepKey) _d3StepStates.set(_d3LastStepKey, _currentD3Renderer.saveState());
	const saved = _d3StepStates.get(stepKey);
	if (saved) _currentD3Renderer.restoreState(saved);
	else if (_d3LastStepKey !== stepKey) _currentD3Renderer.resetZoom();
	await _currentD3Renderer.render(graph);
	_d3LastStepKey = stepKey;
	_currentSemanticKey = key;
	_applyPendingDeeplinkSelection(graph);
	if (_currentChartManager) try {
		_currentChartManager.reattach();
	} catch {}
	if (_currentProofManager) _currentProofManager.setCurrentStep(stepKey);
	const dock = container.querySelector(".d3-graph-card .sgc-pinned-panel");
	if (dock && dock.children.length > 1) [...dock.children].sort((a, b) => (+a.dataset.dockOrder || 0) - (+b.dataset.dockOrder || 0)).forEach((c) => dock.appendChild(c));
	enrichGraphInBackground(graph, key, step);
}
function _buildD3NodeAskMessage(nodeId, graph, otherSelectedIds) {
	if (!nodeId || !graph) return "Explain this graph node.";
	const node = (graph.nodes || []).find((n) => n.id === nodeId);
	if (!node) return "Explain this graph node.";
	const lines = ["Explain this semantic graph node:"];
	if (node.label) lines.push(`Label: ${node.label}`);
	if (node.type) lines.push(`Type: ${node.type}`);
	if (node.role) lines.push(`Role: ${node.role}`);
	if (node.quantity) lines.push(`Quantity: ${node.quantity}`);
	if (node.dimension) lines.push(`Dimension: ${node.dimension}`);
	if (node.unit) lines.push(`Unit: ${node.unit}`);
	if (node.value !== void 0) lines.push(`Value: ${node.value}`);
	if (node.op) lines.push(`Operation: ${node.op}`);
	if (node.subexpr) lines.push(`Expression: $${node.subexpr}$`);
	if (node.description) lines.push(`Description: ${node.description}`);
	const incoming = [], outgoing = [];
	for (const e of graph.edges || []) {
		if (e.to === nodeId && e.from !== nodeId) incoming.push(e.from);
		if (e.from === nodeId && e.to !== nodeId) outgoing.push(e.to);
	}
	if (incoming.length) lines.push(`Incoming: ${incoming.join(", ")}`);
	if (outgoing.length) lines.push(`Outgoing: ${outgoing.join(", ")}`);
	if (otherSelectedIds && otherSelectedIds.length) {
		const others = (graph.nodes || []).filter((n) => otherSelectedIds.includes(n.id));
		lines.push("");
		lines.push("Also selected in the graph:");
		for (const o of others) {
			const parts = [`- ${o.label || o.id}`];
			if (o.type) parts.push(`(${o.type})`);
			if (o.description) parts.push(`— ${o.description}`);
			lines.push(parts.join(" "));
		}
		lines.push("");
		lines.push("Explain this node and how it relates to the other selected nodes.");
	}
	return lines.join("\n");
}
function _getOtherContextNodes(targetNodeId) {
	const selected = _currentD3Renderer?.selectedNodes;
	if (selected && selected.size > 1) return [...selected].filter((id) => id !== targetNodeId);
	const active = _currentD3Renderer?.activeNode;
	if (active && active !== targetNodeId) return [active];
	return [];
}
function _ensureD3NodeAskBtn() {
	if (_d3NodeAskBtn) return _d3NodeAskBtn;
	const btn = makeAiAskButton("ai-ask-btn graph-node-ai-btn", "Ask AI about this node", () => {
		const others = _getOtherContextNodes(_d3HoveredNodeId);
		return _buildD3NodeAskMessage(_d3HoveredNodeId, _d3ActiveGraph, others);
	});
	btn.style.position = "fixed";
	btn.style.margin = "0";
	btn.style.opacity = "0";
	btn.style.pointerEvents = "none";
	btn.style.zIndex = "950";
	btn.addEventListener("mouseenter", () => {
		if (_d3NodeAskHideTimer) {
			clearTimeout(_d3NodeAskHideTimer);
			_d3NodeAskHideTimer = null;
		}
	});
	btn.addEventListener("mouseleave", () => _hideD3NodeAskBtn());
	document.body.appendChild(btn);
	_d3NodeAskBtn = btn;
	return btn;
}
function _showD3NodeAskBtn(nodeEl) {
	const btn = _ensureD3NodeAskBtn();
	if (_d3NodeAskHideTimer) {
		clearTimeout(_d3NodeAskHideTimer);
		_d3NodeAskHideTimer = null;
	}
	const r = (nodeEl.querySelector("polygon, circle, rect") || nodeEl).getBoundingClientRect();
	const bRect = btn.getBoundingClientRect();
	const btnW = bRect.width || btn.offsetWidth || 24;
	const btnH = bRect.height || btn.offsetHeight || 24;
	const ncx = r.left + r.width / 2, ncy = r.top + r.height / 2;
	const chevron = nodeEl.querySelector(".d3sg-chevron");
	if (chevron) {
		const cr = (chevron.querySelector("rect") || chevron).getBoundingClientRect();
		const ccx = cr.left + cr.width / 2, ccy = cr.top + cr.height / 2;
		const gap = 3;
		if (Math.abs(ccx - ncx) >= Math.abs(ccy - ncy)) {
			btn.style.left = ccx - btnW / 2 + "px";
			btn.style.top = cr.bottom + gap + "px";
		} else {
			btn.style.left = cr.right + gap + "px";
			btn.style.top = ccy - btnH / 2 + "px";
		}
	} else {
		btn.style.left = r.right - btnW / 2 + "px";
		btn.style.top = ncy - btnH / 2 + "px";
	}
	btn.style.opacity = "1";
	btn.style.pointerEvents = "auto";
}
var _D3_NODE_ASK_HIDE_DELAY = 600;
function _hideD3NodeAskBtn() {
	if (!_d3NodeAskBtn) return;
	if (_d3NodeAskHideTimer) {
		clearTimeout(_d3NodeAskHideTimer);
		_d3NodeAskHideTimer = null;
	}
	const btn = _d3NodeAskBtn;
	_d3NodeAskHideTimer = setTimeout(() => {
		btn.style.opacity = "0";
		btn.style.pointerEvents = "none";
	}, _D3_NODE_ASK_HIDE_DELAY);
}
/** Find a rendered node's SVG <g> element by id (d3 binds the datum to it). */
function _d3NodeElById(nodeId) {
	const layer = document.querySelector("#graph-viewport .d3sg-nodes");
	if (!layer) return null;
	for (const g of layer.querySelectorAll(":scope > g")) {
		const d = g.__data__;
		if (d && d.data && d.data.id === nodeId) return g;
	}
	return null;
}
/** The active proof in scope (graph-view proof tree), or null. */
function _activeProof() {
	const spec = state.proofSpec;
	if (!spec || !spec.length) return null;
	const entry = spec[state.proofActiveIndex] || spec[0];
	return entry && entry.proof || null;
}
/** Proof-context portion of a DeriveProofRequest (everything except target):
*  domain + the active proof's title/goal/givens + lesson/scene/proof context.
*
*  NOTE: this path deliberately does NOT pin ``start_latex``. A graph node isn't
*  tied to a position in the proof's step sequence, so forcing the first given
*  as the start is arbitrary; instead we send the givens and let the backend
*  infer the most sensible starting expression for the node's own expression.
*  (The proof-card per-step Derive button is different — it prefers the previous
*  step as the start; see buildProofStepDerivePayload.) Shared by the node Derive
*  button and the agent's derive tool. */
function _proofContextPayload(graph) {
	const payload = {};
	const domain = graph && (graph.domain || graph.meta && graph.meta.domain);
	if (domain) payload.domain = domain;
	const proof = _activeProof();
	if (proof) {
		if (proof.title) payload.title = stripHtmlMacros(proof.title);
		if (proof.goal) payload.goal = stripHtmlMacros(proof.goal);
		const givens = (proof.steps || []).filter((s) => s && s.type === "given" && s.math).map((s) => ({
			math: stripHtmlMacros(s.math),
			label: s.label || null
		})).filter((g) => g.math);
		if (givens.length) payload.givens = givens;
	}
	const ctx = buildEnrichContext(typeof currentProofStep === "function" ? currentProofStep() : null);
	if (ctx) payload.context = ctx;
	return payload;
}
/** Assemble the DeriveProofRequest payload for a clicked node.
*  Target = the node's expression; the rest comes from the active proof. */
function _buildDerivePayload(nodeId, fullNode, graph) {
	const target = stripHtmlMacros(nodeLongLabel(fullNode) || fullNode.subexpr || fullNode.label || "");
	return {
		..._proofContextPayload(graph),
		target_latex: target
	};
}
var _PROOF_PATH_RE = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;
var _PROOF_MAX_BYTES = 2e6;
/** Dock a PRE-BAKED proof animation (no LM derivation) — called from a deeplink's
*  ?pa=<domain>/<name>. Fetches /proofs/domains/<path>.json, validates it with the
*  same whitelist the standalone /renderproof page uses, and mounts it on the graph
*  anchored to `nodeId` (the deeplink's selected node). Best-effort: a missing /
*  malformed proof is a silent no-op so it never breaks the rest of the deeplink. */
async function dockProofAnimation(proofPath, nodeId, step) {
	if (!_currentProofManager || _currentProofManager._destroyed) return;
	if (typeof proofPath !== "string" || proofPath.includes("..") || !_PROOF_PATH_RE.test(proofPath)) return;
	let data;
	try {
		const resp = await fetch(`/proofs/domains/${proofPath}.json`, { cache: "no-store" });
		if (!resp.ok) return;
		const len = Number(resp.headers.get("content-length") || 0);
		if (len && len > _PROOF_MAX_BYTES) return;
		const text = await resp.text();
		if (text.length > _PROOF_MAX_BYTES) return;
		data = validateProofData(JSON.parse(text));
	} catch (e) {
		return;
	}
	const anchor = nodeId && _d3NodeElById(nodeId) || null;
	const payload = _proofContextPayload(_d3ActiveGraph);
	_currentProofManager.openProof(nodeId || `prebaked::${proofPath}`, anchor, payload, data, {
		colSpan: 8,
		rowSpan: 6,
		step: Number.isFinite(step) ? step : void 0,
		dock: true
	});
}
/** Find a graph node whose displayed expression matches ``target`` (loose
*  compare), so an agent-initiated derivation can anchor to it like the Derive
*  button. Returns the node id, or null when nothing matches. */
function _findNodeIdByLatex(graph, target) {
	if (!graph || !Array.isArray(graph.nodes) || !target) return null;
	const t = normLatex(target);
	for (const n of graph.nodes) {
		const lbl = stripHtmlMacros(nodeLongLabel(n) || n.subexpr || n.label || "");
		if (lbl && normLatex(lbl) === t) return n.id;
	}
	return null;
}
/** Anchor + dock an already-built derive payload into the (assumed-visible)
*  graph proof manager. Anchors beside a matching node when one exists, else
*  uses a synthetic id keyed on the target so re-deriving the same expression on
*  the same step re-focuses its box instead of stacking duplicates. */
function _openDerivationBox(payload) {
	const graph = _d3ActiveGraph;
	const target = payload.target_latex;
	const matchedId = _findNodeIdByLatex(graph, target);
	const nodeId = matchedId || "derive::" + normLatex(target);
	const anchor = matchedId ? _d3NodeElById(matchedId) : null;
	_currentProofManager.openProof(nodeId, anchor, payload);
}
/** Dock a fully-assembled DeriveProofRequest payload into the semantic-graph
*  canvas — switching to the Math view and rendering the current step's graph
*  first. Used by the proof-card per-step Derive button (issue #382), which
*  builds the payload itself (previous-step start + previous_steps). Returns
*  false when the current step has no semantic graph to dock onto, so the caller
*  can fall back. */
window.algebenchDeriveProofPayload = async function(payload) {
	const target = stripHtmlMacros(payload && payload.target_latex || "").trim();
	if (!target) {
		console.warn("algebenchDeriveProofPayload: target_latex is required");
		return false;
	}
	payload = {
		...payload,
		target_latex: target
	};
	await window.algebenchEnsureGraphVisible();
	if (!_currentProofManager || _currentProofManager._destroyed) return false;
	_openDerivationBox(payload);
	return true;
};
/** Agent entry point — initiate a proof derivation on the CURRENT step's graph,
*  exactly as if the user clicked a node's Derive button. Fire-and-forget: the
*  SgProofManager runs the (verified) derivation and docks it; it persists on
*  this step across navigation. ``args`` = { target_latex, start_latex?, prompt? }. */
window.algebenchDeriveProof = async function(args) {
	const target = stripHtmlMacros(args && args.target_latex || "").trim();
	if (!target) {
		console.warn("algebenchDeriveProof: target_latex is required");
		return false;
	}
	await window.algebenchEnsureGraphVisible();
	if (!_currentProofManager) {
		console.warn("algebenchDeriveProof: no semantic graph to derive into");
		return false;
	}
	const payload = {
		..._proofContextPayload(_d3ActiveGraph),
		target_latex: target
	};
	const start = (args && args.start_latex || "").trim();
	if (start) payload.start_latex = start;
	const prompt = (args && args.prompt || "").trim();
	if (prompt) payload.intent = prompt;
	_openDerivationBox(payload);
	return true;
};
/** After an agent-driven navigation, make sure the 3D scene is actually visible.
*  If the user is on the full-screen Math (semantic graph) view, switch back to
*  the Scenes tab so they see the scene they were moved to. In split/docked mode
*  the scene is already shown alongside the graph, so leave the view untouched.
*  Returns true if it switched tabs. */
window.algebenchEnsureSceneVisible = function() {
	if (isGraphModeActive() && !_docked) {
		setDockTab("scenes");
		return true;
	}
	return false;
};
/** Counterpart for derivations: make the semantic graph visible. Only relevant
*  for the agent-initiated path (the Derive button is already on the graph).
*  Switches to the Math view ONLY when the current step actually has a semantic
*  graph that's just hidden behind the active 3D viewport — never yanks the user
*  to an empty Math view. Awaits the render so the proof manager is ready to dock
*  onto. No-op when the graph is already visible or the step has no graph.
*  Returns true if it switched. */
window.algebenchEnsureGraphVisible = async function() {
	const step = typeof currentProofStep === "function" ? currentProofStep() : null;
	if (!!!(step && step.semanticGraph && step.semanticGraph.graph)) return false;
	let forcedD3 = false;
	if (_currentRenderer !== "d3") {
		_currentRenderer = "d3";
		_lsSet$1(LS_KEYS.renderer, "d3");
		const sel = document.getElementById("graph-renderer-select");
		if (sel) sel.value = "d3";
		_updateFitControls();
		forcedD3 = true;
	}
	if (!isGraphModeActive()) {
		await setDockTab("graph");
		return true;
	}
	if (forcedD3 || !_currentProofManager || _currentProofManager._destroyed) await renderCurrentStepGraph(true);
	return forcedD3;
};
function _showD3InfoPanel(nodeId, nodeData, graph) {
	const infoHost = document.getElementById("graph-info-panel-host");
	if (!infoHost) return;
	if (!nodeId) {
		_hideD3InfoPanel();
		return;
	}
	const fullNode = (graph.nodes || []).find((n) => n.id === nodeId) || nodeData;
	infoHost.innerHTML = "";
	const panel = buildInlineInfoPanel(infoHost);
	if (!panel) return;
	const h3 = panel.querySelector("h3");
	if (h3 && !panel.querySelector(".graph-panel-ai-btn")) {
		const header = document.createElement("div");
		header.className = "gp-header";
		h3.replaceWith(header);
		header.appendChild(h3);
		const askBtn = makeAiAskButton("ai-ask-btn graph-panel-ai-btn", "Ask AI about this node", () => {
			return _buildD3NodeAskMessage(nodeId, graph, _getOtherContextNodes(nodeId));
		});
		header.appendChild(askBtn);
		const deriveBtn = makeDeriveButton("ai-ask-btn graph-panel-derive-btn", "Derive this expression (proof animation)", () => {
			if (!_currentProofManager) return;
			const payload = _buildDerivePayload(nodeId, fullNode, graph);
			const anchor = _d3NodeElById(nodeId) || deriveBtn;
			_currentProofManager.openProof(nodeId, anchor, payload);
		});
		header.appendChild(deriveBtn);
		if (fullNode.subexpr) {
			const faBtn = document.createElement("button");
			faBtn.type = "button";
			faBtn.className = "ai-ask-btn graph-panel-fa-btn";
			faBtn.title = "Function analysis for this expression";
			faBtn.setAttribute("aria-label", "Function analysis for this expression");
			faBtn.innerHTML = FUNCTION_ANALYSIS_ICON;
			faBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				const step = currentProofStep();
				if (step) getFaManager().open(fullNode, step);
			});
			header.appendChild(faBtn);
		}
	}
	const symbolEl = panel.querySelector(".gp-symbol");
	const fieldsEl = panel.querySelector(".gp-fields");
	if (!symbolEl || !fieldsEl) return;
	const latex = nodeLongLabel(fullNode);
	const isOp = fullNode.type === "operator" || fullNode.type === "relation" || fullNode.type === "function";
	const showEmoji = fullNode.emoji && !isOp;
	if (latex && window.katex) try {
		const span = document.createElement("span");
		window.katex.render(latex, span, {
			displayMode: false,
			throwOnError: false
		});
		symbolEl.innerHTML = "";
		if (showEmoji) symbolEl.appendChild(document.createTextNode(fullNode.emoji + " "));
		symbolEl.appendChild(span);
	} catch (_) {
		symbolEl.textContent = (showEmoji ? fullNode.emoji + " " : "") + (fullNode.label || fullNode.id);
	}
	else symbolEl.textContent = (showEmoji ? fullNode.emoji + " " : "") + (fullNode.label || fullNode.id);
	symbolEl.style.opacity = "1";
	symbolEl.style.fontSize = "";
	const FIELDS = [
		["label", "Label"],
		["type", "Type"],
		["role", "Role"],
		["quantity", "Quantity"],
		["dimension", "Dimension"],
		["unit", "Unit"],
		["value", "Value"],
		["op", "Operation"]
	];
	fieldsEl.innerHTML = "";
	for (const [fkey, flabel] of FIELDS) {
		if (!fullNode[fkey]) continue;
		const row = document.createElement("div");
		row.className = "gp-field";
		const k = document.createElement("span");
		k.className = "gp-key";
		k.textContent = flabel;
		const v = document.createElement("span");
		v.className = "gp-val";
		v.textContent = String(fullNode[fkey]);
		row.append(k, v);
		fieldsEl.appendChild(row);
	}
	if (fullNode.description) {
		const desc = document.createElement("div");
		desc.className = "gp-description";
		if (typeof window.renderKaTeX === "function") desc.innerHTML = window.renderKaTeX(fullNode.description, false);
		else desc.textContent = fullNode.description;
		fieldsEl.appendChild(desc);
	}
}
function _hideD3InfoPanel() {
	const infoHost = document.getElementById("graph-info-panel-host");
	if (!infoHost) return;
	infoHost.innerHTML = "";
}
function _buildD3MultiNodeAskMessage(selectedIds, graph) {
	if (!selectedIds || !selectedIds.size || !graph) return "Explain these graph nodes.";
	const nodes = (graph.nodes || []).filter((n) => selectedIds.has(n.id));
	if (!nodes.length) return "Explain these graph nodes.";
	const lines = [`Explain the relationship between these ${nodes.length} semantic graph nodes:`];
	for (const node of nodes) {
		const parts = [`- ${node.label || node.id}`];
		if (node.type) parts.push(`(${node.type})`);
		if (node.description) parts.push(`— ${node.description}`);
		lines.push(parts.join(" "));
	}
	const connected = [];
	for (const e of graph.edges || []) if (selectedIds.has(e.from) && selectedIds.has(e.to)) connected.push(`${e.from} → ${e.to}`);
	if (connected.length) lines.push("Direct connections: " + connected.join(", "));
	return lines.join("\n");
}
function _showD3MultiInfoPanel(selectedIds, graph) {
	const infoHost = document.getElementById("graph-info-panel-host");
	if (!infoHost) return;
	if (!selectedIds || !selectedIds.size) {
		_hideD3InfoPanel();
		return;
	}
	const nodes = (graph.nodes || []).filter((n) => selectedIds.has(n.id));
	infoHost.innerHTML = "";
	const panel = buildInlineInfoPanel(infoHost);
	if (!panel) return;
	const h3 = panel.querySelector("h3");
	if (h3 && !panel.querySelector(".graph-panel-ai-btn")) {
		const header = document.createElement("div");
		header.className = "gp-header";
		h3.replaceWith(header);
		header.appendChild(h3);
		const askBtn = makeAiAskButton("ai-ask-btn graph-panel-ai-btn", "Ask AI about selected nodes", () => _buildD3MultiNodeAskMessage(selectedIds, graph));
		header.appendChild(askBtn);
	}
	const symbolEl = panel.querySelector(".gp-symbol");
	const fieldsEl = panel.querySelector(".gp-fields");
	if (!symbolEl || !fieldsEl) return;
	symbolEl.textContent = `${nodes.length} nodes selected`;
	symbolEl.style.opacity = "0.8";
	symbolEl.style.fontSize = "0.9em";
	fieldsEl.innerHTML = "";
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		if (i > 0) {
			const sep = document.createElement("hr");
			sep.className = "gp-separator";
			fieldsEl.appendChild(sep);
		}
		const symLine = document.createElement("div");
		symLine.className = "gp-symbol";
		const latex = nodeLongLabel(node);
		if (latex && window.katex) try {
			window.katex.render(latex, symLine, {
				displayMode: false,
				throwOnError: false
			});
		} catch (_) {
			symLine.textContent = node.label || node.id;
		}
		else symLine.textContent = node.label || node.id;
		fieldsEl.appendChild(symLine);
		for (const [fkey, flabel] of [
			["label", "Label"],
			["type", "Type"],
			["role", "Role"],
			["quantity", "Quantity"],
			["dimension", "Dimension"],
			["unit", "Unit"],
			["value", "Value"],
			["op", "Operation"]
		]) {
			if (!node[fkey]) continue;
			const row = document.createElement("div");
			row.className = "gp-field";
			const k = document.createElement("span");
			k.className = "gp-key";
			k.textContent = flabel;
			const v = document.createElement("span");
			v.className = "gp-val";
			v.textContent = String(node[fkey]);
			row.append(k, v);
			fieldsEl.appendChild(row);
		}
		if (node.description) {
			const desc = document.createElement("div");
			desc.className = "gp-description";
			if (typeof window.renderKaTeX === "function") desc.innerHTML = window.renderKaTeX(node.description, false);
			else desc.textContent = node.description;
			fieldsEl.appendChild(desc);
		}
	}
}
async function renderCurrentStepGraph(force = false) {
	const container = document.getElementById("graph-mermaid-container");
	if (!container) return;
	if (_faManager && _faManager.isOpen()) _faManager.close();
	const step = currentProofStep();
	const sg = step && step.semanticGraph;
	const graph = sg && sg.graph;
	if (!graph) {
		const err = sg && sg.error;
		if (err) {
			clearGraph();
			showErrorState(err);
			return;
		}
		if (step && typeof step.math === "string" && step.math && !step.__sgDeriving) {
			step.__sgDeriving = true;
			clearGraph();
			container.innerHTML = "<div style=\"color:#9aa4ad; padding:2rem;\">Deriving graph…</div>";
			try {
				const resp = await fetch("/api/graph/from-latex", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						latex: step.math,
						highlights: step.highlights || null
					})
				});
				if (!resp.ok) step.semanticGraph = { error: {
					reason: "derive_request_failed",
					message: `On-demand graph derivation failed (HTTP ${resp.status}).`,
					math: step.math
				} };
				else {
					const data = await resp.json();
					if (data && data.graph) step.semanticGraph = { graph: data.graph };
					else step.semanticGraph = { error: {
						reason: "parse_failed",
						message: "Parser could not derive a semantic graph for this expression (on-demand).",
						math: step.math
					} };
				}
			} catch (e) {
				console.warn("[graph-view] on-demand graph derivation failed:", e);
				step.semanticGraph = { error: {
					reason: "derive_request_failed",
					message: "On-demand graph derivation request failed: " + (e && e.message ? e.message : e),
					math: step.math
				} };
			} finally {
				delete step.__sgDeriving;
			}
			if (currentProofStep() === step) await renderCurrentStepGraph(true);
			return;
		}
		clearGraph();
		return;
	}
	const key = stableStepKey(step) + "|" + _currentTheme + "|" + _currentDirection + "|" + _currentLabels + "|" + _currentRenderer;
	if (key === _currentSemanticKey && !force) return;
	if (_currentRenderer === "d3") {
		await _renderWithD3(container, graph, step, key);
		return;
	}
	let mermaidCode;
	let mode = "dark";
	let edgeStyles = {};
	try {
		const showFields = LABEL_PRESETS[_currentLabels] || null;
		const res = await fetchMermaidFromGraph(graph, _currentTheme, _currentDirection, showFields);
		mermaidCode = res.mermaid;
		mode = res.mode;
		edgeStyles = res.edgeStyles || {};
	} catch (err) {
		console.error("[graph-view] failed to build mermaid source:", err);
		container.innerHTML = `<div style="color:#f88; padding:2rem;">Failed to build graph source.<br><small>${escapeHtml(err.message || String(err))}</small></div>`;
		return;
	}
	const viewport = document.getElementById("graph-viewport");
	if (viewport) {
		viewport.classList.toggle("gv-theme-light", mode === "light");
		viewport.classList.toggle("gv-theme-dark", mode !== "light");
	}
	if (!await ensureMermaid(mode)) {
		container.innerHTML = `<div style="color:#f88; padding:2rem;">Failed to load Mermaid.<br><small>Check your network connection and reopen the Math tab.</small></div>`;
		return;
	}
	try {
		const svgId = "gp-svg-" + Math.random().toString(36).slice(2, 8);
		const { svg } = await window.mermaid.render(svgId, mermaidCode);
		const card = document.createElement("div");
		card.className = "gv-card";
		card.innerHTML = svg;
		container.innerHTML = "";
		container.appendChild(card);
		const svgEl = card.querySelector("svg");
		if (svgEl) {
			svgEl.style.removeProperty("max-width");
			svgEl.style.removeProperty("max-height");
			svgEl.removeAttribute("width");
			svgEl.removeAttribute("height");
			if (!svgEl.getAttribute("preserveAspectRatio")) svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
			applyZoom();
		}
		renderInlineLatexInNodes(container);
		centerLabelsInNodes(container);
	} catch (err) {
		console.error("[graph-view] mermaid render failed:", err);
		container.innerHTML = `<div style="color:#f88; padding:2rem;">Failed to render graph.<br><small>${escapeHtml(err.message || String(err))}</small></div>`;
		return;
	}
	let preservedActiveNode = null;
	if (_currentGraphPanel) {
		if (_activeStepForPanel === step) preservedActiveNode = _currentGraphPanel.activeNode || null;
		try {
			_currentGraphPanel.destroy();
		} catch {}
		_currentGraphPanel = null;
	}
	const infoHost = document.getElementById("graph-info-panel-host");
	if (infoHost) infoHost.innerHTML = "";
	if (graph) {
		_currentGraphPanel = new SemanticGraphPanel(graph, {
			container,
			katex: window.katex,
			panel: buildInlineInfoPanel(infoHost)
		});
		_currentGraphPanel.attach();
		_activeStepForPanel = step;
		if (preservedActiveNode) _currentGraphPanel.selectNode(preservedActiveNode);
	}
	renderEdgeLegend(edgeStyles, graph);
	_currentSemanticKey = key;
	refreshEnrichmentIndicatorVisibility();
	enrichGraphInBackground(graph, key, step);
}
function allNodesHaveDescriptions(graph) {
	const nodes = graph && graph.nodes;
	if (!Array.isArray(nodes) || nodes.length === 0) return false;
	for (const n of nodes) if (!n || typeof n.description !== "string" || !n.description.trim()) return false;
	return true;
}
var ENRICH_DWELL_MS = 400;
var _enrichDwellTimers = /* @__PURE__ */ new WeakMap();
var _enrichInFlight = /* @__PURE__ */ new WeakSet();
function enrichGraphInBackground(graph, keyAtFetch, stepAtFetch) {
	if (!graph || graph.__enriched) return;
	if (_enrichInFlight.has(graph)) return;
	if (graph.enrichment && typeof graph.enrichment === "object" && !Array.isArray(graph.enrichment)) {
		try {
			Object.defineProperty(graph, "__enriched", {
				value: true,
				writable: true,
				configurable: true,
				enumerable: false
			});
		} catch {
			graph.__enriched = true;
		}
		return;
	}
	if (allNodesHaveDescriptions(graph)) {
		try {
			Object.defineProperty(graph, "__enriched", {
				value: true,
				writable: true,
				configurable: true,
				enumerable: false
			});
		} catch {
			graph.__enriched = true;
		}
		return;
	}
	const prev = _enrichDwellTimers.get(graph);
	if (prev) clearTimeout(prev);
	const handle = setTimeout(() => {
		_enrichDwellTimers.delete(graph);
		if (currentProofStep() !== stepAtFetch) return;
		_runEnrichmentFetch(graph, keyAtFetch, stepAtFetch);
	}, ENRICH_DWELL_MS);
	_enrichDwellTimers.set(graph, handle);
}
function _runEnrichmentFetch(graph, keyAtFetch, stepAtFetch) {
	if (graph.__enriched || _enrichInFlight.has(graph)) return;
	_enrichInFlight.add(graph);
	const context = buildEnrichContext(stepAtFetch);
	const indicator = showEnrichmentIndicator(stepAtFetch);
	const cleanup = () => {
		_enrichInFlight.delete(graph);
		if (indicator && indicator.parentNode) indicator.parentNode.removeChild(indicator);
	};
	const markEnriched = (g) => {
		try {
			Object.defineProperty(g, "__enriched", {
				value: true,
				writable: true,
				configurable: true,
				enumerable: false
			});
		} catch {
			g.__enriched = true;
		}
	};
	fetch("/api/graph/enrich", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(context ? {
			graph,
			context
		} : { graph })
	}).then(async (res) => {
		if (!res.ok) {
			console.warn("[graph-view] enrich failed:", res.status);
			return;
		}
		const data = await res.json();
		const enriched = data && data.enriched;
		if (!enriched || !Array.isArray(enriched.nodes)) return;
		markEnriched(enriched);
		if (stepAtFetch && stepAtFetch.semanticGraph) stepAtFetch.semanticGraph.graph = enriched;
		markEnriched(graph);
		if (currentProofStep() !== stepAtFetch) return;
		_currentSemanticKey = null;
		renderCurrentStepGraph(true);
	}).catch((err) => {
		console.warn("[graph-view] enrich error:", err);
	}).finally(cleanup);
}
function showEnrichmentIndicator(step) {
	const viewport = document.getElementById("graph-viewport");
	if (!viewport) return null;
	let stack = viewport.querySelector(".graph-enrich-indicator-stack");
	if (!stack) {
		stack = document.createElement("div");
		stack.className = "graph-enrich-indicator-stack";
		viewport.appendChild(stack);
	}
	const el = document.createElement("div");
	el.className = "graph-enrich-indicator";
	el.setAttribute("role", "status");
	el.setAttribute("aria-live", "polite");
	el.dataset.stepKey = stableStepKey(step);
	const dots = document.createElement("span");
	dots.className = "gei-dots";
	dots.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
	const text = document.createElement("span");
	text.className = "gei-text";
	text.textContent = "Enriching graph…";
	el.append(dots, text);
	stack.appendChild(el);
	positionEnrichmentStack();
	refreshEnrichmentIndicatorVisibility();
	return el;
}
function positionEnrichmentStack() {
	const viewport = document.getElementById("graph-viewport");
	if (!viewport) return;
	const stack = viewport.querySelector(".graph-enrich-indicator-stack");
	if (!stack) return;
	const vpRect = viewport.getBoundingClientRect();
	let reach = 0;
	let rightGap = null;
	for (const sel of [".d3sg-edge-legend", ".sgc-legend-panel"]) {
		const el = viewport.querySelector(sel);
		if (!el || el.classList.contains("hidden") || el.offsetParent === null) continue;
		const r = el.getBoundingClientRect();
		reach = Math.max(reach, vpRect.bottom - r.top);
		const gap = vpRect.right - r.right;
		rightGap = rightGap === null ? gap : Math.min(rightGap, gap);
	}
	const TOP_PAD = 14;
	stack.style.bottom = reach > 0 ? `${Math.round(reach) + TOP_PAD}px` : "8px";
	stack.style.right = rightGap !== null ? `${Math.round(rightGap)}px` : "8px";
}
document.addEventListener("sgc:legend-change", positionEnrichmentStack);
function refreshEnrichmentIndicatorVisibility() {
	const viewport = document.getElementById("graph-viewport");
	if (!viewport) return;
	const step = currentProofStep();
	const currentKey = step ? stableStepKey(step) : null;
	const stack = viewport.querySelector(".graph-enrich-indicator-stack");
	if (!stack) return;
	stack.querySelectorAll(".graph-enrich-indicator").forEach((el) => {
		el.classList.toggle("hidden", el.dataset.stepKey !== currentKey);
	});
}
var EDGE_SEMANTIC_LABELS = [
	["direct", "Proportional"],
	["inverse", "Inversely proportional"],
	["neutral", "Structural"]
];
var LEGEND_DEFAULT_ARROW = "-->";
/**
* Paint the edge-semantics legend from the theme's ``edgeStyles`` map.
*
* Only renders rows for semantics that (a) the theme actually styles and
* (b) appear in the current graph — no point telling the user about
* "inversely proportional" when nothing in the diagram is tagged that way.
* If neither condition holds for any semantic, the legend is hidden. This
* keeps the viewport uncluttered on themes that don't differentiate
* edge semantics visually.
*/
function renderEdgeLegend(edgeStyles, graph) {
	const host = document.getElementById("graph-edge-legend");
	if (!host) return;
	const styled = edgeStyles && typeof edgeStyles === "object" ? edgeStyles : {};
	const nodeById = Object.create(null);
	for (const n of graph && graph.nodes || []) if (n && n.id) nodeById[n.id] = n;
	const present = /* @__PURE__ */ new Set();
	let hasUntagged = false;
	for (const e of graph && graph.edges || []) {
		if (!e) continue;
		if (e.semantic) {
			present.add(e.semantic);
			continue;
		}
		const src = nodeById[e.from];
		const dst = nodeById[e.to];
		if (src && src.op === "power") {
			const raw = src.exponent;
			const n = parseFloat(raw);
			if (Number.isFinite(n)) {
				if (n < 0) {
					present.add("inverse");
					continue;
				}
				if (Math.abs(n) > 1) {
					present.add("direct");
					continue;
				}
			} else if (typeof raw === "string" && raw.trimStart().startsWith("-")) {
				present.add("inverse");
				continue;
			}
		}
		if (dst && dst.op === "multiply") {
			present.add("direct");
			continue;
		}
		hasUntagged = true;
	}
	if (hasUntagged) present.add("neutral");
	const noneTagged = present.size === 0;
	const rows = [];
	for (const [semantic, label] of EDGE_SEMANTIC_LABELS) {
		const s = styled[semantic];
		if (!s) continue;
		if (!noneTagged && !present.has(semantic)) continue;
		rows.push({
			semantic,
			label,
			style: s
		});
	}
	if (!rows.length) {
		host.classList.add("hidden");
		host.innerHTML = "";
		return;
	}
	host.innerHTML = "";
	const title = document.createElement("div");
	title.className = "graph-edge-legend-title";
	title.textContent = "Edges";
	host.appendChild(title);
	for (const row of rows) {
		const item = document.createElement("div");
		item.className = "graph-edge-legend-item";
		item.dataset.semantic = row.semantic;
		const swatch = document.createElement("span");
		swatch.className = "graph-edge-legend-swatch";
		swatch.setAttribute("aria-hidden", "true");
		const stroke = row.style.stroke || "currentColor";
		const width = Number(row.style.strokeWidth || 2);
		const arrow = row.style.arrow || LEGEND_DEFAULT_ARROW;
		swatch.style.setProperty("--legend-stroke", stroke);
		swatch.style.setProperty("--legend-stroke-width", `${width}px`);
		swatch.dataset.arrow = arrow;
		swatch.textContent = "";
		item.appendChild(swatch);
		const lbl = document.createElement("span");
		lbl.className = "graph-edge-legend-label";
		lbl.textContent = row.label;
		item.appendChild(lbl);
		host.appendChild(item);
	}
	host.classList.remove("hidden");
}
function buildInlineInfoPanel(host) {
	if (!host) return null;
	const el = document.createElement("div");
	el.className = "graph-panel-info open";
	el.innerHTML = "<h3>Node Details</h3><div class=\"gp-symbol\" style=\"opacity:.55;font-size:.85rem\">Click a node</div><div class=\"gp-fields\"></div><button class=\"gp-close\" style=\"display:none\">&times;</button>";
	host.appendChild(el);
	return el;
}
function currentProofStep() {
	const entry = state.proofSpec && state.proofSpec[state.proofActiveIndex];
	if (!entry || !entry.proof || !entry.proof.steps) return null;
	const i = state.proofStepIndex;
	if (i < 0 || i >= entry.proof.steps.length) return null;
	return entry.proof.steps[i];
}
function currentSemanticGraphJsonPath() {
	const lesson = state.lessonSpec;
	const entry = state.proofSpec && state.proofSpec[state.proofActiveIndex];
	const stepIdx = state.proofStepIndex;
	if (!lesson || !entry || stepIdx < 0) return null;
	const singleSceneRoot = !lesson.scenes && !!lesson.elements;
	function containerToPath(container, basePath, needle) {
		if (!container) return null;
		if (Array.isArray(container)) {
			const i = container.indexOf(needle);
			return i === -1 ? null : `${basePath}[${i}]`;
		}
		return container === needle ? basePath : null;
	}
	let proofPath = null;
	if (entry.level === "file") proofPath = containerToPath(lesson.proof, "proof", entry.proof);
	else if (entry.level === "scene") {
		if (singleSceneRoot) proofPath = containerToPath(lesson.proof, "proof", entry.proof);
		else {
			const scene = lesson.scenes && lesson.scenes[entry.sceneIndex];
			proofPath = containerToPath(scene && scene.proof, `scenes[${entry.sceneIndex}].proof`, entry.proof);
		}
	} else if (entry.level === "step") {
		if (singleSceneRoot) {
			const step = lesson.steps && lesson.steps[entry.stepIndex];
			proofPath = containerToPath(step && step.proof, `steps[${entry.stepIndex}].proof`, entry.proof);
		} else {
			const step = lesson.scenes && lesson.scenes[entry.sceneIndex] && lesson.scenes[entry.sceneIndex].steps && lesson.scenes[entry.sceneIndex].steps[entry.stepIndex];
			proofPath = containerToPath(step && step.proof, `scenes[${entry.sceneIndex}].steps[${entry.stepIndex}].proof`, entry.proof);
		}
	}
	if (!proofPath) return null;
	return `${proofPath}.steps[${stepIdx}].semanticGraph`;
}
function updateShowJsonButtonState() {
	const btn = document.getElementById("graph-show-json");
	if (!btn) return;
	const step = currentProofStep();
	btn.disabled = !!!(step && step.semanticGraph && step.semanticGraph.graph);
}
function setupShowJsonButton() {
	const btn = document.getElementById("graph-show-json");
	if (!btn) return;
	btn.innerHTML = BRACES_ICON;
	btn.classList.add("icon-only");
	btn.addEventListener("click", () => {
		const path = currentSemanticGraphJsonPath();
		if (!path || typeof window.algebenchOpenJsonBrowserAtPath !== "function") return;
		window.algebenchOpenJsonBrowserAtPath(path);
	});
	updateShowJsonButtonState();
}
function stableStepKey(step) {
	return `${state.proofActiveIndex}:${state.proofStepIndex}:${step.id || ""}`;
}
function escapeHtml(s) {
	return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function onStepChange() {
	updateTreeHighlight();
	updateShowJsonButtonState();
	if (state._graphSyncInProgress) return;
	if (isGraphModeActive()) renderCurrentStepGraph();
}
function onGraphSelectionChange(e) {
	if (state._graphSyncInProgress) return;
	if (!e.detail || !e.detail.activeNode) return;
}
var _lastLessonSpec = null;
function onProofLoad() {
	if (state.lessonSpec !== _lastLessonSpec) {
		_resetGraphSession();
		_lastLessonSpec = state.lessonSpec;
	}
	_d3StepStates.clear();
	_d3LastStepKey = null;
	rebuildProofTree();
	onStepChange();
}
function _resetGraphSession() {
	for (const cm of _chartManagers.values()) try {
		cm.destroy();
	} catch {}
	_chartManagers.clear();
	_currentChartManager = null;
	if (_currentProofManager) {
		try {
			_currentProofManager.destroy();
		} catch {}
		_currentProofManager = null;
	}
	clearDeriveCache();
	clearAnalysisCache();
	if (_faManager) {
		try {
			_faManager.destroy();
		} catch {}
		_faManager = null;
	}
}
function counterpartTheme(name, targetMode) {
	const suffix = `-${targetMode === "dark" ? "light" : "dark"}`;
	if (!name.endsWith(suffix)) return null;
	const candidate = `${name.slice(0, -suffix.length)}-${targetMode}`;
	return _allThemes.some((t) => t.name === candidate && t.mode === targetMode) ? candidate : null;
}
function refreshThemeDropdown() {
	const themeSel = document.getElementById("graph-theme-select");
	if (!themeSel) return;
	const matching = _allThemes.filter((t) => t.mode === _currentMode);
	const pool = matching.length ? matching : _allThemes;
	if (!pool.some((t) => t.name === _currentTheme)) {
		_currentTheme = pool.length ? pool[0].name : "default";
		_lsSet$1(LS_KEYS.theme, _currentTheme);
	}
	themeSel.innerHTML = "";
	pool.forEach(({ name }) => {
		const opt = document.createElement("option");
		opt.value = name;
		opt.textContent = prettyThemeName(name);
		if (name === _currentTheme) opt.selected = true;
		themeSel.appendChild(opt);
	});
}
function watchAppTheme() {
	new MutationObserver(() => {
		const mode = _appMode();
		if (mode === _currentMode) return;
		_currentMode = mode;
		const twin = counterpartTheme(_currentTheme, _currentMode);
		if (twin) _currentTheme = twin;
		refreshThemeDropdown();
		_lsSet$1(LS_KEYS.theme, _currentTheme);
		renderCurrentStepGraph(true);
	}).observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"]
	});
}
async function setupGraphControls() {
	try {
		const res = await fetch("/api/graph/themes");
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		const raw = data && data.themes || [];
		if (!raw.length) throw new Error("empty themes list");
		_allThemes = raw.map((item) => typeof item === "string" ? {
			name: item,
			mode: "light"
		} : {
			name: item.name,
			mode: item.mode || "light"
		});
	} catch (e) {
		console.warn("[graph-view] could not load themes:", e);
		_allThemes = [];
	}
	_currentMode = _appMode();
	const twin = counterpartTheme(_currentTheme, _currentMode);
	if (twin) _currentTheme = twin;
	refreshThemeDropdown();
	_lsSet$1(LS_KEYS.theme, _currentTheme);
	watchAppTheme();
	const themeSel = document.getElementById("graph-theme-select");
	if (themeSel) themeSel.addEventListener("change", () => {
		_currentTheme = themeSel.value || "default";
		_lsSet$1(LS_KEYS.theme, _currentTheme);
		renderCurrentStepGraph(true);
	});
	const dirSel = document.getElementById("graph-direction-select");
	if (dirSel) {
		dirSel.value = _currentDirection;
		dirSel.addEventListener("change", () => {
			_currentDirection = dirSel.value || "left-right";
			_lsSet$1(LS_KEYS.direction, _currentDirection);
			renderCurrentStepGraph(true);
		});
	}
	const labelsSel = document.getElementById("graph-labels-select");
	if (labelsSel) {
		labelsSel.value = _currentLabels;
		labelsSel.addEventListener("change", () => {
			_currentLabels = labelsSel.value in LABEL_PRESETS ? labelsSel.value : "description";
			_lsSet$1(LS_KEYS.labels, _currentLabels);
			renderCurrentStepGraph(true);
		});
	}
	const rendererSel = document.getElementById("graph-renderer-select");
	if (rendererSel) {
		rendererSel.value = _currentRenderer;
		rendererSel.addEventListener("change", () => {
			_currentRenderer = rendererSel.value === "d3" ? "d3" : "mermaid";
			_lsSet$1(LS_KEYS.renderer, _currentRenderer);
			_updateFitControls();
			clearGraph();
			renderCurrentStepGraph(true);
		});
	}
}
function prettyThemeName(name) {
	return String(name).split(/[-_]/).map((p) => p.length ? p[0].toUpperCase() + p.slice(1) : p).join(" ");
}
function applyZoom() {
	if (_currentD3Renderer && !_currentD3Renderer._destroyed) {
		const label = document.getElementById("graph-zoom-level");
		if (label) label.textContent = `${_currentD3Renderer.zoomLevel}%`;
		return;
	}
	const target = document.querySelector("#graph-mermaid-container .gv-card") || document.querySelector("#graph-mermaid-container svg");
	if (target) target.style.transform = `scale(${(ZOOM_BASELINE * _zoom).toFixed(3)})`;
	const label = document.getElementById("graph-zoom-level");
	if (label) label.textContent = `${Math.round(_zoom * 100)}%`;
}
function _updateFitControls() {
	const isD3 = _currentRenderer === "d3";
	const fitBtn = document.getElementById("graph-zoom-fit");
	const zoomLabel = document.getElementById("graph-zoom-level");
	if (fitBtn) {
		fitBtn.disabled = !isD3;
		fitBtn.title = isD3 ? "Zoom to fit" : "Zoom to fit (D3 only)";
	}
	if (zoomLabel) {
		zoomLabel.style.cursor = isD3 ? "pointer" : "default";
		zoomLabel.title = isD3 ? "Double-click to fit" : "";
	}
}
function setupZoomControls() {
	const inBtn = document.getElementById("graph-zoom-in");
	const outBtn = document.getElementById("graph-zoom-out");
	const fitBtn = document.getElementById("graph-zoom-fit");
	if (inBtn) inBtn.addEventListener("click", () => {
		if (_currentD3Renderer && !_currentD3Renderer._destroyed) {
			_currentD3Renderer.zoomBy(1.2);
			return;
		}
		_zoom = Math.min(ZOOM_MAX, +(_zoom + ZOOM_STEP).toFixed(2));
		_lsSet$1(LS_KEYS.zoom, String(_zoom));
		applyZoom();
	});
	if (outBtn) outBtn.addEventListener("click", () => {
		if (_currentD3Renderer && !_currentD3Renderer._destroyed) {
			_currentD3Renderer.zoomBy(1 / 1.2);
			return;
		}
		_zoom = Math.max(ZOOM_MIN, +(_zoom - ZOOM_STEP).toFixed(2));
		_lsSet$1(LS_KEYS.zoom, String(_zoom));
		applyZoom();
	});
	if (fitBtn) fitBtn.addEventListener("click", () => {
		if (_currentD3Renderer && !_currentD3Renderer._destroyed) _currentD3Renderer.zoomToFit();
	});
	const zoomLabel = document.getElementById("graph-zoom-level");
	if (zoomLabel) zoomLabel.addEventListener("dblclick", () => {
		if (_currentD3Renderer && !_currentD3Renderer._destroyed) _currentD3Renderer.zoomToFit();
	});
	applyZoom();
	_updateFitControls();
}
/**
* Watch the graph viewport + its two floating control clusters and toggle
* ``gv-controls-stacked`` on the viewport whenever the left/right groups
* would collide at the current width. Only ``top`` changes between the
* two modes, so horizontal bounds stay valid either way and we can just
* compare ``left.right`` against ``right.left`` directly.
*/
function setupControlsOverflowWatcher() {
	const viewport = document.getElementById("graph-viewport");
	const left = document.getElementById("graph-controls-left");
	const right = document.getElementById("graph-controls-right");
	if (!viewport || !left || !right) return;
	const GAP = 12;
	const update = () => {
		const l = left.getBoundingClientRect();
		const r = right.getBoundingClientRect();
		if (!l.width || !r.width) return;
		const overlap = l.right + GAP > r.left;
		viewport.classList.toggle("gv-controls-stacked", overlap);
	};
	update();
	const ro = new ResizeObserver(update);
	ro.observe(viewport);
	ro.observe(left);
	ro.observe(right);
	window.addEventListener("resize", update);
}
function init$1() {
	if (_initDone) return;
	_initDone = true;
	setupDockTabs();
	setupGraphControls();
	setupZoomControls();
	setupShowJsonButton();
	setupDockToggle();
	setupDockResize();
	setupControlsOverflowWatcher();
	window.addEventListener("algebench:stepchange", onStepChange);
	window.addEventListener("algebench:proofload", onProofLoad);
	window.addEventListener("algebench:graphselectionchange", onGraphSelectionChange);
	document.addEventListener("keydown", (e) => {
		const target = e.target;
		if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
		if (e.key === "d" && !e.ctrlKey && !e.metaKey && !e.altKey) {
			if (isGraphModeActive()) toggleDockMode();
		}
	});
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init$1);
else init$1();
window.graphView = {
	setDockTab,
	rebuildProofTree,
	renderCurrentStepGraph,
	toggleDockMode
};
/**
* Read-only snapshot of the semantic-graph dock state, for chat context
* (issue #124). Returns null only when the graph dock is inactive AND the
* current step has no graph. When the dock is active, returns a state
* object even if `hasGraph` is false — so callers can tell the user is
* looking at the (empty) Math view.
*/
function getGraphPanelState() {
	const dockActive = isGraphModeActive();
	const step = typeof currentProofStep === "function" ? currentProofStep() : null;
	const sg = step && step.semanticGraph;
	const graph = sg && sg.graph;
	if (!graph && !dockActive) return null;
	const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
	const edges = graph && Array.isArray(graph.edges) ? graph.edges : [];
	const out = {
		open: dockActive,
		docked: _docked && dockActive,
		hasGraph: !!graph,
		source: graph ? "step-embedded" : null,
		stepNumber: state && typeof state.proofStepIndex === "number" ? state.proofStepIndex + 1 : null,
		theme: _currentTheme,
		labelMode: _currentLabels,
		direction: _currentDirection,
		zoom: _currentD3Renderer && !_currentD3Renderer._destroyed ? _currentD3Renderer.zoomLevel : Math.round(_zoom * 100),
		nodeCount: nodes.length,
		edgeCount: edges.length
	};
	if (sg && sg.error) out.parseError = sg.error.message || String(sg.error);
	if (graph) {
		const NODE_CAP = 60, EDGE_CAP = 80, DESC_CAP = 120;
		out.nodes = nodes.slice(0, NODE_CAP).map((n) => {
			const e = { id: n.id };
			if (n.type) e.type = n.type;
			if (n.op) e.op = n.op;
			if (n.label) e.label = n.label;
			if (n.role) e.role = n.role;
			if (n.description) e.description = n.description.length > DESC_CAP ? n.description.slice(0, 119) + "…" : n.description;
			return e;
		});
		if (nodes.length > NODE_CAP) out.nodesTruncated = nodes.length - NODE_CAP;
		out.edges = edges.slice(0, EDGE_CAP).map((e) => {
			const o = {
				from: e.from,
				to: e.to
			};
			if (e.semantic) o.semantic = e.semantic;
			return o;
		});
		if (edges.length > EDGE_CAP) out.edgesTruncated = edges.length - EDGE_CAP;
	}
	if (graph) {
		const payloads = _selectedNodeIdsForContext().map((id) => _buildGraphNodePayload(graph, id)).filter(Boolean);
		if (payloads.length) {
			out.selectedNode = payloads[payloads.length - 1];
			out.selectedNodes = payloads;
		}
	}
	return out;
}
/**
* Ordered list of currently selected node ids (active node last), read from
* whichever renderer is live. Empty when nothing is selected.
*/
function _selectedNodeIdsForContext() {
	if (_currentRenderer === "d3" && _currentD3Renderer && !_currentD3Renderer._destroyed) return getGraphSelection();
	if (_currentGraphPanel && _currentGraphPanel.activeNode) return [_currentGraphPanel.activeNode];
	return [];
}
/**
* Build a serializable payload for a node id straight from the graph JSON,
* including immediate edge neighbors. Renderer-agnostic — both the D3 and
* Mermaid paths share the same graph structure.
*/
function _buildGraphNodePayload(graph, nodeId) {
	if (!graph || !nodeId) return null;
	const node = (graph.nodes || []).find((n) => n.id === nodeId);
	if (!node) return null;
	const incoming = [], outgoing = [];
	for (const e of graph.edges || []) {
		if (e.to === nodeId && e.from !== nodeId) incoming.push(e.from);
		if (e.from === nodeId && e.to !== nodeId) outgoing.push(e.to);
	}
	return {
		...node,
		subexpr: node.subexpr || null,
		neighbors: {
			incoming,
			outgoing
		}
	};
}
window.algebenchGetGraphPanelState = getGraphPanelState;
//#endregion
//#region src/lesson-placement.ts
/** Thrown when an op cannot be applied. Callers discard and clear history. */
var PlacementError = class extends Error {};
/**
* Guarantee a `LessonFormat` to build into, promoting a displayed single scene.
*
* Extracted from the lesson-wrapper bootstrap in src/chat.ts, and now called by
* `runBuildSceneTool` there. It is simultaneously the empty-app case AND the
* SingleSceneFormat -> LessonFormat normalization — one function, not two.
*/
function ensureLessonFormat(lesson, displayedScene) {
	if (lesson && Array.isArray(lesson.scenes)) return {
		lesson,
		bootstrap: {
			previousLesson: lesson,
			promotedScene: null,
			bootstrapped: false
		}
	};
	const source = displayedScene || (lesson && !lesson.scenes ? lesson : null);
	let promoted = source;
	const rootOnly = {};
	if (source) {
		const { import: imports, unsafe, unsafeExplanation, ...sceneOnly } = source;
		if (imports !== void 0) rootOnly.import = imports;
		if (unsafe !== void 0) rootOnly.unsafe = unsafe;
		if (unsafeExplanation !== void 0) rootOnly.unsafeExplanation = unsafeExplanation;
		promoted = sceneOnly;
	}
	return {
		lesson: {
			title: "Lesson",
			...rootOnly,
			scenes: promoted ? [promoted] : []
		},
		bootstrap: {
			previousLesson: null,
			promotedScene: source || null,
			bootstrapped: true
		}
	};
}
/**
* Resolve the container a node of `kind` lives in.
*
* The container is DERIVED from the kind rather than named by the placement, so
* a mismatched pair (a Scene addressed into a step's array, say) cannot be
* expressed at all — see the note on `Placement`.
*
* `proof` is `oneOf: [proof, proof[]]` in the schema and is a bare object in
* most published occurrences, so it is normalized to a one-element array here
* and collapsed back by `collapseProof` on write. Without that collapse the
* model round-trip test fails on every bare-object lesson.
*/
function resolveContainer(lesson, kind, at) {
	if (kind === "scene") return lesson.scenes;
	if (kind === "proof" && at.scene == null && at.step != null) throw new PlacementError("a step-level proof placement needs a scene");
	if (kind === "proof" && at.scene == null) {
		const root = lesson;
		if (root.proof == null) root.proof = [];
		else if (!Array.isArray(root.proof)) root.proof = [root.proof];
		return root.proof;
	}
	const scene = at.scene != null ? lesson.scenes[at.scene] : void 0;
	if (!scene) throw new PlacementError(`placement names scene ${at.scene}, which does not exist`);
	if (kind === "step") {
		if (!Array.isArray(scene.steps)) scene.steps = [];
		return scene.steps;
	}
	if (kind === "proof") {
		const holder = at.step != null ? (scene.steps || [])[at.step] : scene;
		if (!holder) throw new PlacementError(`placement names step ${at.step}, which does not exist`);
		if (holder.proof == null) holder.proof = [];
		else if (!Array.isArray(holder.proof)) holder.proof = [holder.proof];
		return holder.proof;
	}
	throw new PlacementError(`no container is defined for kind '${kind}'`);
}
/**
* Collapse a one-element `proof` array back to a bare object.
*
* The published corpus writes `proof` as a bare object far more often than as an
* array; preserving that is required for lossless round-tripping.
*/
function tidyContainer(lesson, kind, at, arrivedAsArray) {
	if (kind === "step" && at.scene != null) {
		const scene = lesson.scenes[at.scene];
		if (scene && Array.isArray(scene.steps) && scene.steps.length === 0) delete scene.steps;
		return;
	}
	if (kind !== "proof") return;
	const holder = proofHolder(lesson, at);
	if (!holder) return;
	if (!Array.isArray(holder.proof)) return;
	if (holder.proof.length === 0) {
		delete holder.proof;
		return;
	}
	if (holder.proof.length === 1 && !arrivedAsArray) holder.proof = holder.proof[0];
}
/** The object holding a `proof` for this placement, or undefined. */
function proofHolder(lesson, at) {
	if (at.scene == null) return lesson;
	const scene = lesson.scenes[at.scene];
	if (!scene) return void 0;
	return at.step != null ? (scene.steps || [])[at.step] : scene;
}
/**
* Snapshot a container field so a REFUSED op leaves no trace of itself.
*
* `resolveContainer` has two side effects: it creates a missing `steps` array,
* and it normalizes a bare `proof` object into a one-element array. If the op is
* then rejected, those changes have already landed with no inverse to undo them
* — the lesson is quietly reshaped by an operation the caller was told did not
* apply, which makes the all-or-nothing guarantee false even for a single op.
*/
function captureContainerShape(lesson, kind, at) {
	let holder;
	let key;
	if (kind === "proof") {
		holder = proofHolder(lesson, at);
		key = "proof";
	} else if (kind === "step") {
		holder = at.scene != null ? lesson.scenes[at.scene] : void 0;
		key = "steps";
	} else return () => {};
	if (!holder) return () => {};
	const had = key in holder;
	const original = holder[key];
	return () => {
		if (!had) delete holder[key];
		else holder[key] = original;
	};
}
/** Assert the node at `index` is still the one the op was computed against. */
function verifyIdentity(node, at) {
	if (at.id === void 0) return;
	const actual = node?.id;
	if (actual !== at.id) throw new PlacementError(`stale placement: expected id ${at.id} at index ${at.index}, found ${String(actual)}`);
}
function requireIndex(at) {
	if (typeof at.index !== "number" || !Number.isInteger(at.index) || at.index < 0) throw new PlacementError(`placement needs a non-negative integer index, got ${String(at.index)}`);
	return at.index;
}
/**
* Apply build ops in order, returning the INVERSE ops.
*
* The inverse list is REVERSED: applying several ops shifts indices, so each
* captured inverse is only valid in the frame it was captured. Unwinding in
* reverse order restores that frame. Without it, a two-insert result undoes to
* the wrong positions.
*
* Redo needs no special case — applying an inverse returns the forward ops,
* reconstructed against live state.
*/
function applyBuildOps(lesson, ops) {
	const inverse = [];
	try {
		return applyEach(lesson, ops, inverse);
	} catch (err) {
		for (const undo of [...inverse].reverse()) try {
			applyEach(lesson, [undo], []);
		} catch {}
		throw err;
	}
}
function applyEach(lesson, ops, inverse) {
	for (const op of ops) {
		const index = requireIndex(op.at);
		const restoreShape = captureContainerShape(lesson, op.kind, op.at);
		const proofWasArray = op.kind === "proof" && Array.isArray((proofHolder(lesson, op.at) || {}).proof);
		let arr;
		try {
			arr = resolveContainer(lesson, op.kind, op.at);
		} catch (err) {
			restoreShape();
			throw err;
		}
		if (op.op === "insert") {
			if (op.at.id !== void 0) {
				restoreShape();
				throw new PlacementError("an insert placement must not carry an id — there is nothing yet to verify");
			}
			if (index > arr.length) {
				restoreShape();
				throw new PlacementError(`insert index ${index} is past the end (${arr.length})`);
			}
			arr.splice(index, 0, op.node);
			const insertedId = op.node?.id;
			inverse.push({
				op: "delete",
				kind: op.kind,
				at: {
					...op.at,
					id: insertedId
				}
			});
		} else if (op.op === "replace") {
			const old = arr[index];
			if (old === void 0) {
				restoreShape();
				throw new PlacementError(`replace index ${index} does not exist`);
			}
			try {
				verifyIdentity(old, op.at);
			} catch (e) {
				restoreShape();
				throw e;
			}
			const replacementId = op.node?.id;
			inverse.push({
				op: "replace",
				kind: op.kind,
				at: {
					...op.at,
					id: replacementId
				},
				node: old
			});
			arr[index] = op.node;
		} else {
			const old = arr[index];
			if (old === void 0) {
				restoreShape();
				throw new PlacementError(`delete index ${index} does not exist`);
			}
			try {
				verifyIdentity(old, op.at);
			} catch (e) {
				restoreShape();
				throw e;
			}
			inverse.push({
				op: "insert",
				kind: op.kind,
				at: op.at,
				node: old
			});
			arr.splice(index, 1);
		}
		tidyContainer(lesson, op.kind, op.at, proofWasArray);
	}
	return inverse.reverse();
}
var MAX_INTENT_CHARS = 2e3;
function scenesOf(lesson) {
	const l = lesson;
	if (l && Array.isArray(l.scenes)) return l.scenes.filter((s) => s && typeof s === "object");
	return l && (l.title || l.elements) ? [l] : [];
}
function elementsOf(scene) {
	const out = (scene.elements || []).filter(Boolean);
	for (const step of scene.steps || []) for (const el of step.add || []) if (el) out.push(el);
	return out;
}
function firstLine(text, limit = 200) {
	if (typeof text !== "string" || !text.trim()) return "";
	return text.trim().split("\n")[0].slice(0, limit);
}
function deriveConventions(scenes) {
	const colors = [];
	let latex = 0, labelled = 0, prompts = 0;
	for (const scene of scenes) for (const el of elementsOf(scene)) {
		const c = el.color;
		if (typeof c === "string" && c.startsWith("#") && !colors.includes(c)) colors.push(c);
		const label = el.label;
		if (typeof label === "string" && label) {
			labelled++;
			if (label.includes("$")) latex++;
		}
		if (el.prompt) prompts++;
	}
	return {
		colors: colors.slice(0, 12),
		labelsAreLatex: labelled > 0 && latex * 2 > labelled,
		elementsCarryPrompts: prompts > 0
	};
}
function collectSliderIds(scenes) {
	const ids = [];
	for (const scene of scenes) for (const step of scene.steps || []) for (const s of step.sliders || []) if (typeof s?.id === "string" && s.id && !ids.includes(s.id)) ids.push(s.id);
	return ids;
}
/** Deterministically decide what the builder sees. No I/O, no mutation. */
function assembleBuildSceneRequest(opts) {
	const scenes = scenesOf(opts.lesson);
	const omitted = [];
	let target;
	if (opts.op === "replace") {
		if (opts.sceneIndex == null || opts.sceneIndex < 0 || opts.sceneIndex >= scenes.length) throw new Error(`replace needs an existing scene index, got ${opts.sceneIndex}`);
		target = opts.sceneIndex;
	} else target = opts.sceneIndex == null ? scenes.length : Math.max(0, Math.min(opts.sceneIndex, scenes.length));
	const intent = (opts.intent || "").trim().slice(0, MAX_INTENT_CHARS);
	if (!intent) throw new Error("a build needs an intent; got an empty one");
	const summarised = scenes.slice(0, 40);
	if (scenes.length > 40) omitted.push(`${scenes.length - 40} scene summaries`);
	const right = opts.op === "replace" ? target + 1 : target;
	const around = [target - 1, right].filter((i) => i >= 0 && i < scenes.length);
	const lesson = opts.lesson || {};
	return {
		op: opts.op,
		sceneIndex: target,
		intent,
		clarifications: opts.clarifications || [],
		lesson: {
			title: typeof lesson.title === "string" ? lesson.title : "",
			description: firstLine(lesson.description),
			sceneSummaries: summarised.map((s, index) => ({
				index,
				title: typeof s.title === "string" ? s.title : "",
				description: firstLine(s.description)
			}))
		},
		conventions: deriveConventions(scenes),
		neighbours: around.map((i) => scenes[i]),
		current: opts.op === "replace" ? scenes[target] : null,
		memory: opts.memory || [],
		sliderVocabulary: collectSliderIds(scenes),
		omitted,
		messages: (opts.messages || []).slice(-12).map((m) => ({
			role: String(m && m.role || "user"),
			text: String(m && m.text || "")
		}))
	};
}
//#endregion
//#region src/build-scene-tool.ts
/**
* Translate the agent's 1-based scene number into a 0-based index.
*
* The agent's whole world is 1-based — `navigate_to` takes "scene 2" and means
* the second scene — while the wire contract and `applyBuildOps` are 0-based.
* Converting here, once, is why nothing downstream has to remember which
* convention it is holding. `undefined` stays `undefined`: on insert that means
* "append", which is a different instruction from "insert at 0".
*/
function sceneIndexFromArgs(scene) {
	if (scene == null || scene === "") return void 0;
	const n = typeof scene === "number" ? scene : parseInt(String(scene), 10);
	if (!Number.isFinite(n)) return void 0;
	const idx = Math.trunc(n);
	return idx === 0 ? 0 : idx - 1;
}
/** Build the request body for a `build_scene` tool call. Throws on a hopeless one. */
function buildSceneRequestFromToolCall(args, lesson, thread = [], memory = []) {
	const op = args.op === "replace" ? "replace" : "insert";
	return assembleBuildSceneRequest({
		lesson,
		intent: typeof args.intent === "string" ? args.intent : "",
		op,
		sceneIndex: sceneIndexFromArgs(args.scene),
		memory,
		messages: thread
	});
}
/** One line naming what landed, for the chat log. */
function summarise(ops) {
	if (!ops.length) return "Nothing to apply.";
	const op = ops[0];
	const title = op.op === "delete" ? "" : op.node?.title;
	const name = typeof title === "string" && title.trim() ? `“${title.trim()}”` : "a scene";
	return op.op === "replace" ? `Rebuilt ${name}.` : `Added ${name}.`;
}
/**
* Read the handler's reply into the contract's tagged union.
*
* The four outcomes are mutually exclusive on the wire, so this reads them in
* the order the handler produces them and never merges two. An unrecognized
* reply becomes `refused` rather than `passthrough`: a reply we cannot read is
* a bug to surface, not a question to hand back to the tutor as if the user had
* asked something conversational.
*/
function interpretBuildSceneReply(reply) {
	const r = reply || {};
	const focusIndex = typeof r.focus === "number" && Number.isInteger(r.focus) && r.focus >= 0 ? r.focus : null;
	const focus = focusIndex == null ? void 0 : { index: focusIndex };
	if (r.fallback_to_chat) return { kind: "passthrough" };
	if (typeof r.question === "string" && r.question.trim()) return {
		kind: "question",
		question: r.question.trim(),
		focus
	};
	if (typeof r.reason === "string" && r.reason.trim()) return {
		kind: "refused",
		reason: r.reason.trim(),
		focus
	};
	const ops = r.result && Array.isArray(r.result.ops) ? r.result.ops : null;
	if (ops && ops.length) return {
		kind: "result",
		result: {
			ops,
			summary: summarise(ops),
			focus: focus || null
		}
	};
	return {
		kind: "refused",
		reason: "The scene builder returned nothing usable.",
		focus
	};
}
//#endregion
//#region src/build-progress.ts
/** Ids are minted here so `at.id` can verify the slot is still ours. */
var seq = 0;
/**
* A scene that says "this is being built", and where.
*
* Deliberately EMPTY rather than a guess at what is coming: a placeholder that
* draws axes and a vector reads as a finished scene that came out wrong. The
* caption carries the intent, so the slot explains itself while it waits.
*/
function placeholderScene(intent) {
	seq += 1;
	const asked = (intent || "").trim().replace(/\s+/g, " ");
	return {
		id: `building-${seq}`,
		title: "Building…",
		description: asked ? `Building: ${asked}` : "Building a new scene…",
		elements: []
	};
}
/**
* The step to arrive on: the first one that HAS something.
*
* Sliders first, because a scene whose interactive part is the point renders
* inert without them; then the first step that adds any element; then the root.
*
* Not `steps[0]`. `_pull_sliders_forward` in compose.py deliberately puts a
* slider on the step that first USES it, which is routinely step 1 or later — so
* checking only step 0 landed the reader on an empty root and the scene they had
* just asked for appeared to render nothing. That is the exact symptom this
* feature kept producing for other reasons; it must not be reintroduced by the
* navigation.
*/
function landingStep(scene) {
	const steps = scene && Array.isArray(scene.steps) ? scene.steps : [];
	const withSliders = steps.findIndex((s) => Array.isArray(s?.sliders) && s.sliders.length);
	if (withSliders >= 0) return withSliders;
	const withContent = steps.findIndex((s) => Array.isArray(s?.add) && s.add.length);
	return withContent >= 0 ? withContent : -1;
}
/**
* The slot turned into a REPORT of why the build failed.
*
* A refused build used to take its placeholder with it: the scene vanished from
* the tree, one sentence went past in chat, and there was nothing left to look
* at. The reason is the most useful thing the expert produces when it cannot
* build — it names the element and the field — so it should sit where the scene
* would have been, not scroll away.
*
* It is an ordinary scene, so it appears in the tree, can be navigated to, and
* can be deleted like any other. Deliberately NOT a special UI state: a state
* has to be dismissed, remembered and rendered somewhere, and the thing the
* reader wants is simply to read what went wrong at their own pace.
*/
function failedScene(intent, reason) {
	seq += 1;
	const asked = (intent || "").trim().replace(/\s+/g, " ");
	return {
		id: `unbuilt-${seq}`,
		title: "Couldn’t build this scene",
		description: `**${reason}**\n\nAsked for: ${asked || "(nothing)"}`,
		elements: []
	};
}
/** True for a scene this module put in the lesson — a placeholder or a report. */
function isPlaceholder(scene) {
	const id = scene?.id;
	return typeof id === "string" && (id.startsWith("building-") || id.startsWith("unbuilt-"));
}
/**
* Where the placeholder is NOW, or -1 if it is gone.
*
* Not the index it was reserved at. A build takes tens of seconds and the lesson
* can move under it — another build landing, the user deleting a scene. Both
* finishing moves address the slot by IDENTITY and only then by position, so a
* shifted lesson relocates the slot instead of operating on its old neighbour.
*/
function slotIndex(scenes, placeholder) {
	const id = placeholder.id;
	return scenes.findIndex((s) => s?.id === id);
}
/** The op that puts a placeholder at `index`. */
function reserveOp(index, placeholder) {
	return {
		op: "insert",
		kind: "scene",
		at: { index },
		node: placeholder
	};
}
/**
* Turn the expert's op into one that lands ON the reserved slot.
*
* The expert does not know a placeholder exists — it answers the request it was
* sent, which for an insert is "insert at N". Applying that verbatim after
* reserving N would leave TWO scenes: the real one and the placeholder pushed
* down beside it. So an insert becomes a replace of the slot we made.
*
* `at.id` carries the placeholder's id, so if anything moved the lesson while
* the build was in flight the replace is REFUSED rather than overwriting a
* scene the user meant to keep.
*/
function landOnSlot(op, placeholder, index) {
	const id = placeholder.id;
	if (index < 0 || op.op === "delete") return op;
	return {
		op: "replace",
		kind: op.kind,
		at: {
			index,
			id
		},
		node: op.node
	};
}
/**
* The op that takes the placeholder away again when nothing was built.
*
* `null` when the slot is already gone — there is nothing to remove, and an op
* addressing a vanished index would delete a scene that is not ours.
*/
function releaseOp(index, placeholder) {
	const id = placeholder.id;
	if (index < 0) return null;
	return {
		op: "delete",
		kind: "scene",
		at: {
			index,
			id
		}
	};
}
/**
* Show the in-flight pill over the 3D viewport.
*
* Same markup and classes as the proof-derivation pill so the two read as one
* idea rather than two indicators that happen to spin. Returns its own remover:
* a caller that forgets to call it leaves a pill spinning over a finished scene,
* so there is exactly one thing to remember and no id to look up.
*/
function showBuildPill(text = "Building scene…") {
	const vp = typeof document !== "undefined" ? document.getElementById("viewport") : null;
	if (!vp) return () => {};
	let stack = vp.querySelector(".build-indicator-stack");
	if (!stack) {
		stack = document.createElement("div");
		stack.className = "graph-enrich-indicator-stack build-indicator-stack";
		vp.appendChild(stack);
	}
	const el = document.createElement("div");
	el.className = "graph-enrich-indicator";
	el.setAttribute("role", "status");
	const dots = document.createElement("span");
	dots.className = "gei-dots";
	for (let i = 0; i < 3; i += 1) dots.appendChild(document.createElement("span"));
	const label = document.createElement("span");
	label.className = "gei-text";
	label.textContent = text;
	el.appendChild(dots);
	el.appendChild(label);
	stack.appendChild(el);
	const empty = document.getElementById("empty-state");
	const store = stack;
	if (empty && store._emptyWas === void 0) store._emptyWas = empty.style.display;
	if (empty) empty.style.display = "none";
	let removed = false;
	return () => {
		if (removed) return;
		removed = true;
		if (el.parentNode) el.parentNode.removeChild(el);
		if (stack && !stack.childNodes.length) {
			if (empty && store._emptyWas !== void 0) empty.style.display = store._emptyWas;
			if (stack.parentNode) stack.parentNode.removeChild(stack);
		}
	};
}
//#endregion
//#region src/chat.ts
/**
* How long to wait for a scene build.
*
* Shorter than DERIVE_TIMEOUT_MS: a build is ONE LM call with no verify-and-retry
* loop behind it, so the 6-minute derivation budget would leave a user staring at
* a dead chat for minutes after the request had already failed.
*/
var BUILD_SCENE_TIMEOUT_MS = 9e4;
var chatHistory = [];
var chatAvailable$1 = false;
var chatSending = false;
var activeSpeakBtn = null;
var welcomeInFlight = false;
var memorySnapshot = null;
var ttsCharacterPicker = null;
var selectedTtsCharacter = "joker";
var selectedTtsVoice = "Charon";
var selectedTtsMode = "read";
var CHAT_HISTORY_MAX = Infinity;
function _escHtml(s) {
	const d = document.createElement("div");
	d.textContent = s;
	return d.innerHTML;
}
var _presetPrompts = [];
var _lastFocusedSurface = null;
function _classifyFocusTarget(target) {
	const el = target;
	if (!el || !el.closest) return null;
	if (el.closest("#graph-viewport, #dock-tab-graph, .graph-panel-info, .graph-panel-tooltip")) return "graph";
	if (el.closest("#mathbox-container, #mathbox-overlay, canvas")) return "viewport";
	if (el.closest(".explanation-panel, .panel-tab, .tab-content, #chat-input, #preset-prompts")) return "panel";
	return null;
}
if (typeof window !== "undefined") window.addEventListener("pointerdown", (e) => {
	const surface = _classifyFocusTarget(e.target);
	if (surface) _lastFocusedSurface = surface;
}, true);
function setPresetPrompts$1(prompts) {
	_presetPrompts = prompts || [];
	const container = document.getElementById("preset-prompts");
	if (!container) return;
	container.innerHTML = "";
	if (!_presetPrompts.length) {
		container.classList.add("hidden");
		return;
	}
	container.classList.remove("hidden");
	for (const text of _presetPrompts) {
		const btn = document.createElement("button");
		btn.className = "preset-prompt-btn";
		btn.textContent = text;
		btn.title = text + "\n\nClick to send · ⌘/Ctrl-click to edit";
		btn.addEventListener("click", (e) => {
			if (e.metaKey || e.ctrlKey) {
				const input = document.getElementById("chat-input");
				if (input) {
					input.value = text;
					input.focus();
					input.dispatchEvent(new Event("input"));
				}
			} else if (!chatSending) sendChatMessage$1(text);
		});
		container.appendChild(btn);
	}
}
function shouldSkipWelcome() {
	return chatHistory.length > 0 || chatSending;
}
function buildChatContext() {
	const ctx = {};
	if (typeof lessonSpec !== "undefined" && lessonSpec && lessonSpec.title) ctx.lessonTitle = lessonSpec.title;
	if (typeof lessonSpec !== "undefined" && lessonSpec && lessonSpec.scenes) {
		ctx.totalScenes = lessonSpec.scenes.length;
		const idx = typeof currentSceneIndex !== "undefined" ? currentSceneIndex : 0;
		ctx.sceneNumber = idx + 1;
		const scene = lessonSpec.scenes[idx];
		if (scene) ctx.currentScene = scene;
		ctx.sceneTree = lessonSpec.scenes.map((s, i) => {
			const entry = {
				sceneNumber: i + 1,
				title: s.title || "Scene " + (i + 1)
			};
			if (s.steps && s.steps.length > 0) entry.steps = s.steps.map((st, j) => ({
				stepNumber: j + 1,
				title: st.title || "Step " + (j + 1),
				description: st.description || ""
			}));
			return entry;
		});
	}
	const runtime = {};
	runtime.stepNumber = (typeof currentStepIndex !== "undefined" ? currentStepIndex : -1) + 1;
	if (typeof camera !== "undefined" && camera) runtime.cameraPosition = {
		x: +camera.position.x.toFixed(2),
		y: +camera.position.y.toFixed(2),
		z: +camera.position.z.toFixed(2)
	};
	if (typeof controls !== "undefined" && controls && controls.target) runtime.cameraTarget = {
		x: +controls.target.x.toFixed(2),
		y: +controls.target.y.toFixed(2),
		z: +controls.target.z.toFixed(2)
	};
	if (typeof CAMERA_VIEWS !== "undefined") {
		const viewNames = Object.keys(CAMERA_VIEWS).filter((k) => k !== "__agent" && k !== "_step" && k !== "reset");
		if (viewNames.length > 0) runtime.cameraViews = viewNames;
	}
	if (typeof lessonSpec !== "undefined" && lessonSpec && lessonSpec.scenes && typeof getAllElements === "function") {
		const scene = lessonSpec.scenes[currentSceneIndex];
		if (scene) {
			const els = getAllElements(scene, currentStepIndex);
			const NON_VISUAL_TYPES = /* @__PURE__ */ new Set([
				"slider",
				"info",
				"preset_prompts"
			]);
			runtime.visibleElements = els.filter((el) => {
				if (NON_VISUAL_TYPES.has(el.type)) return false;
				if (typeof elementRegistry !== "undefined" && el.id && elementRegistry[el.id]) return !elementRegistry[el.id].hidden;
				return true;
			}).map((el) => ({
				label: el.label || el.id || el.type,
				type: el.type
			}));
		}
	}
	if (typeof sceneSliders !== "undefined" && sceneSliders) {
		const sliders = {};
		for (const [id, s] of Object.entries(sceneSliders)) sliders[id] = {
			value: s.value,
			min: s.min,
			max: s.max,
			step: s.step,
			label: s.label || id
		};
		if (Object.keys(sliders).length > 0) runtime.sliders = sliders;
	}
	const captionEl = document.getElementById("step-caption");
	if (captionEl && !captionEl.classList.contains("hidden")) runtime.currentCaption = (captionEl.dataset.markdown || captionEl.textContent).trim();
	const activeTab = document.querySelector(".tab-content.active");
	if (activeTab) runtime.activeTab = activeTab.id.replace("tab-", "");
	if (typeof currentProjection !== "undefined") runtime.projection = currentProjection;
	if (typeof getProofContext === "function") {
		const proofCtx = getProofContext();
		if (proofCtx) runtime.proof = proofCtx;
	}
	if (typeof window.algebenchGetGraphPanelState === "function") try {
		const gp = window.algebenchGetGraphPanelState();
		if (gp) runtime.graphPanel = gp;
	} catch (e) {
		console.warn("[chat] failed to read graph panel state:", e);
	}
	if (_lastFocusedSurface) runtime.lastFocusedSurface = _lastFocusedSurface;
	const viewing = [];
	const graphActive = runtime.graphPanel && runtime.graphPanel.open;
	viewing.push(graphActive ? "semantic graph" : "scene");
	if (runtime.activeTab === "chat") {
		viewing.push("chat");
		const proofPanel = document.getElementById("proof-panel");
		if (proofPanel && !proofPanel.classList.contains("hidden")) viewing.push("proof");
	} else if (runtime.activeTab === "doc") viewing.push("doc");
	runtime.userViewing = viewing;
	try {
		const coachEngine = window.AlgeBenchCoach && window.AlgeBenchCoach.engine;
		if (coachEngine && typeof coachEngine.status === "function") runtime.coach = coachEngine.status();
	} catch {}
	ctx.runtime = runtime;
	return ctx;
}
window.algebenchBuildChatContext = buildChatContext;
function switchPanelTab$1(tabName) {
	document.querySelectorAll(".panel-tab").forEach((btn) => {
		btn.classList.toggle("active", btn.dataset.tab === tabName);
	});
	document.querySelectorAll(".tab-content").forEach((el) => {
		el.classList.toggle("active", el.id === "tab-" + tabName);
	});
	try {
		window.dispatchEvent(new CustomEvent("algebench:panelchange"));
	} catch (_) {}
	if (tabName === "chat") {
		if (typeof refreshProofPanel === "function") refreshProofPanel();
		const input = document.getElementById("chat-input");
		if (input) setTimeout(() => input.focus(), 50);
		if (chatAvailable$1 && !welcomeInFlight && !shouldSkipWelcome()) setTimeout(() => {
			if (!welcomeInFlight && !shouldSkipWelcome()) sendWelcomeMessage();
		}, 800);
	}
}
function setupChat() {
	fetch("/api/chat/available").then((r) => r.json()).then((data) => {
		chatAvailable$1 = data.available;
		if (!chatAvailable$1) {
			const msg = document.getElementById("chat-unavailable-msg");
			const tab = document.getElementById("tab-chat");
			if (msg) msg.classList.remove("hidden");
			if (tab) tab.classList.add("unavailable");
		}
	}).catch(() => {
		chatAvailable$1 = false;
		const msg = document.getElementById("chat-unavailable-msg");
		const tab = document.getElementById("tab-chat");
		if (msg) msg.classList.remove("hidden");
		if (tab) tab.classList.add("unavailable");
	});
	document.querySelectorAll(".panel-tab").forEach((btn) => {
		btn.addEventListener("click", () => {
			switchPanelTab$1(btn.dataset.tab);
		});
	});
	document.addEventListener("keydown", (e) => {
		const target = e.target;
		if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
		if (e.key === "c" && !e.ctrlKey && !e.metaKey && !e.altKey) {
			const panel = document.getElementById("explanation-panel");
			const toggle = document.getElementById("explain-toggle");
			const handle = document.getElementById("panel-resize-handle");
			if (panel.classList.contains("hidden")) {
				panel.classList.remove("hidden");
				handle.style.display = "block";
				toggle.style.display = "block";
				toggle.classList.add("active");
				setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
			}
			switchPanelTab$1("chat");
		}
	});
	const input = document.getElementById("chat-input");
	const sendBtn = document.getElementById("chat-send");
	initChatTtsControls();
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			const text = input.value.trim();
			if (text && !chatSending) {
				input.value = "";
				input.style.height = "auto";
				sendChatMessage$1(text);
			}
		}
	});
	input.addEventListener("input", () => {
		input.style.height = "auto";
		input.style.height = Math.min(input.scrollHeight, 120) + "px";
	});
	sendBtn.addEventListener("click", () => {
		const text = input.value.trim();
		if (text && !chatSending) {
			input.value = "";
			input.style.height = "auto";
			sendChatMessage$1(text);
		}
	});
}
function initChatTtsControls() {
	const lib = window.GeminiVoiceCharacterSelector;
	if (!lib) return;
	const characterBtn = document.getElementById("chatCharacterBtn");
	const characterPalette = document.getElementById("chatCharacterPalette");
	const characterSearch = document.getElementById("chatCharacterSearch");
	const characterList = document.getElementById("chatCharacterList");
	const characterBackdrop = document.getElementById("chatCharacterBackdrop");
	const voiceSelect = document.getElementById("chatVoiceSelect");
	if (!characterBtn || !characterPalette || !characterSearch || !characterList || !characterBackdrop || !voiceSelect) return;
	if (characterPalette.parentElement !== document.body) document.body.appendChild(characterPalette);
	if (characterBackdrop.parentElement !== document.body) document.body.appendChild(characterBackdrop);
	selectedTtsVoice = lib.setupVoiceSelect(voiceSelect, {
		includeSystem: false,
		storageKey: "algebenchTtsVoice",
		defaultValue: "Charon"
	});
	ttsCharacterPicker = new lib.CharacterPicker({
		buttonEl: characterBtn,
		paletteEl: characterPalette,
		searchEl: characterSearch,
		listEl: characterList,
		backdropEl: characterBackdrop,
		options: lib.CHARACTER_OPTIONS,
		groupMap: lib.CHARACTER_GROUPS,
		groupOrder: lib.CHARACTER_GROUP_ORDER,
		storageKey: "algebenchTtsCharacter",
		recentsKey: "algebenchTtsCharacterRecents",
		defaultId: "joker",
		hotkey: "k",
		onChange: (characterId) => {
			selectedTtsCharacter = characterId;
			const opt = lib.CHARACTER_OPTIONS.find((o) => o.id === characterId);
			if (opt && opt.defaultVoice && voiceSelect) {
				voiceSelect.value = opt.defaultVoice;
				selectedTtsVoice = opt.defaultVoice;
				localStorage.setItem("algebenchTtsVoice", opt.defaultVoice);
			}
		}
	});
	selectedTtsCharacter = ttsCharacterPicker.init();
	voiceSelect.addEventListener("change", () => {
		selectedTtsVoice = voiceSelect.value || "Charon";
	});
	const ttsModeSelect = document.getElementById("chatTtsModeSelect");
	if (ttsModeSelect) {
		selectedTtsMode = localStorage.getItem("algebenchTtsMode") || "read";
		ttsModeSelect.value = selectedTtsMode;
		ttsModeSelect.addEventListener("change", () => {
			selectedTtsMode = ttsModeSelect.value;
			localStorage.setItem("algebenchTtsMode", selectedTtsMode);
		});
	}
}
/**
* Run one `build_scene` tool call: assemble, ask the expert, apply, navigate.
*
* Returns the assistant text that must join `chatHistory`, or '' when there is
* nothing to record. The CALLER pushes it, after the agent's own reply — order
* matters. A clarifying question is recovered next turn by pairing an assistant
* turn ending in '?' with the user's next turn, so a question filed BEFORE the
* agent's reply has that reply sitting between it and the answer, the pair is
* never made, and the expert asks the same question forever.
*/
async function runBuildSceneTool(tc) {
	const args = tc.args || {};
	let body;
	try {
		body = buildSceneRequestFromToolCall(args, typeof lessonSpec !== "undefined" && lessonSpec ? lessonSpec : null, chatHistory, memoryRefs());
	} catch (e) {
		const why = e instanceof Error ? e.message : String(e);
		console.warn("build_scene: not sent —", why);
		const said = `I couldn't build that: ${why}`;
		addChatMessage("assistant", said);
		return said;
	}
	console.log("%c🎬 build_scene:", "color: #ffaa00; font-weight: bold", body.op, "at index", body.sceneIndex, "|", body.intent.slice(0, 120));
	const { lesson, bootstrap } = ensureLessonFormat(typeof lessonSpec !== "undefined" && lessonSpec ? lessonSpec : null, typeof currentSpec !== "undefined" && currentSpec ? currentSpec : null);
	const target = body.sceneIndex;
	const placeholder = body.op === "insert" ? placeholderScene(body.intent) : null;
	let reserveFailure = "";
	if (placeholder) try {
		applyBuildOps(lesson, [reserveOp(target, placeholder)]);
	} catch (e) {
		console.error("build_scene: could not reserve a slot", e);
		reserveFailure = `I couldn't make room for that scene: ${String(e)}`;
		addChatMessage("assistant", reserveFailure);
	}
	if (reserveFailure) return reserveFailure;
	lessonSpec = lesson;
	if (bootstrap.bootstrapped && bootstrap.promotedScene) {
		currentSceneIndex = 0;
		currentStepIndex = -1;
	}
	showBuiltScene(lesson, target, -1);
	const hidePill = showBuildPill(body.op === "replace" ? "Rebuilding scene…" : "Building scene…");
	/**
	* Leave the reason WHERE THE SCENE WOULD HAVE BEEN.
	*
	* A failed build used to release its slot: the scene vanished from the tree,
	* one sentence went past in chat, and there was nothing left to inspect. The
	* expert's reason names the element and the field it objected to, which is
	* the most useful thing it produces when it cannot build — so the slot
	* becomes a report the reader can navigate to and read at their own pace,
	* and delete like any other scene.
	*
	* Returns false when there was no slot to convert — a `replace`, which
	* reserves nothing because the reader is already looking at the scene being
	* rebuilt, and which leaves that scene untouched on failure.
	*/
	const reportFailure = (reason) => {
		if (!placeholder) return false;
		const at = slotIndex(lesson.scenes, placeholder);
		if (at < 0) return false;
		try {
			applyBuildOps(lesson, [{
				op: "replace",
				kind: "scene",
				at: {
					index: at,
					id: placeholder.id
				},
				node: failedScene(body.intent, reason)
			}]);
		} catch (e) {
			console.error("build_scene: could not report the failure in place", e);
			return false;
		}
		showBuiltScene(lesson, at, -1);
		return true;
	};
	/** Undo the reservation, for outcomes that are not failures. */
	const release = () => {
		if (!placeholder) return;
		const at = releaseOp(slotIndex(lesson.scenes, placeholder), placeholder);
		if (!at) return;
		try {
			applyBuildOps(lesson, [at]);
			showBuiltScene(lesson, Math.max(0, (at.at.index ?? 1) - 1), -1);
		} catch (e) {
			console.error("build_scene: could not release the reserved slot", e);
		}
	};
	let reply;
	try {
		reply = await invokeExpert("build_scene", body, { timeoutMs: BUILD_SCENE_TIMEOUT_MS });
	} catch (e) {
		hidePill();
		const msg = e instanceof ExpertError ? e.message : "The scene builder could not be reached.";
		console.error("build_scene: request failed", e);
		reportFailure(msg);
		addChatMessage("assistant", msg);
		return msg;
	}
	hidePill();
	const outcome = interpretBuildSceneReply(reply);
	if (outcome.kind === "passthrough") {
		console.log("build_scene: not a build → chat");
		release();
		const said = "That reads more like a question than a scene to build — tell me what should be visible and I'll build it.";
		addChatMessage("assistant", said);
		return said;
	}
	if (outcome.kind === "question") {
		console.log("build_scene: asking —", outcome.question);
		release();
		addChatMessage("assistant", outcome.question);
		return outcome.question;
	}
	if (outcome.kind === "refused") {
		console.warn("build_scene: refused —", outcome.reason);
		reportFailure(outcome.reason);
		const said = `I couldn't build that: ${outcome.reason}`;
		addChatMessage("assistant", said);
		return said;
	}
	const { ops, summary } = outcome.result;
	const at = placeholder ? slotIndex(lesson.scenes, placeholder) : -1;
	const landed = placeholder ? ops.map((op) => landOnSlot(op, placeholder, at)) : ops;
	try {
		applyBuildOps(lesson, landed);
	} catch (e) {
		const why = e instanceof PlacementError ? e.message : String(e);
		console.error("build_scene: could not apply", e);
		const said = `The scene was built but wouldn't fit the lesson: ${why}`;
		reportFailure(said);
		addChatMessage("assistant", said);
		return said;
	}
	showBuiltScene(lesson, landed[0].at.index ?? target);
	console.log("%c🎬 build_scene complete", "color: #44ff44; font-weight: bold", summary);
	addChatMessage("assistant", summary);
	return summary;
}
/**
* Agent-memory KEYS and their shapes — never their values.
*
* `MemoryRef` is `extra="forbid"` on the backend precisely so a ref carrying its
* `value` is refused at the door: a computed 400-point array must not reach a
* prompt. The builder only needs to know a key EXISTS and roughly what is in it
* to reference one.
*
* Without this the field was always `[]` in the real client flow, so the whole
* design was inert — the expert could never mention a stored value.
*/
function memoryRefs() {
	if (!memorySnapshot) return [];
	return Object.entries(memorySnapshot).map(([key, entry]) => ({
		key,
		shape: entry && typeof entry.summary === "string" ? entry.summary : ""
	}));
}
/**
* Rebuild the scene tree and put the user on scene `index`.
*
* `step` defaults to "whichever step carries the sliders", because a scene whose
* interactive part IS the point renders inert at its root view. Pass an explicit
* step for the placeholder, which has none.
*/
function showBuiltScene(lesson, index, step) {
	const scene = lesson.scenes[index];
	const targetStep = step !== void 0 ? step : landingStep(scene);
	try {
		if (typeof buildSceneTree === "function") buildSceneTree(lessonSpec);
		if (typeof updateDockVisibility === "function") updateDockVisibility();
		if (index === currentSceneIndex) currentSceneIndex = -1;
		if (typeof navigateTo === "function") navigateTo(index, targetStep);
		if (isPlaceholder(lesson.scenes[index])) {
			const empty = document.getElementById("empty-state");
			if (empty) empty.style.display = "none";
		}
		if (typeof window.algebenchEnsureSceneVisible === "function") window.algebenchEnsureSceneVisible();
	} catch (e) {
		console.error("build_scene: navigation/render failed:", e);
	}
}
async function sendChatMessage$1(text, { silent = false } = {}) {
	chatSending = true;
	if (!silent) addChatMessage("user", text);
	const loadingEl = addChatLoading();
	const context = buildChatContext();
	console.log("%c🤖 Chat send: %c" + text.substring(0, 60), "color: #8888ff; font-weight: bold", "color: #ccc");
	const payload = {
		message: text,
		history: silent ? chatHistory : chatHistory.slice(0, -1),
		context
	};
	try {
		const res = await fetch("/api/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
		loadingEl.remove();
		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: "Request failed" }));
			const rawMsg = err.detail ?? err.error;
			const msg = typeof rawMsg === "string" ? rawMsg : rawMsg != null ? JSON.stringify(rawMsg) : "";
			console.error("%c🤖 Chat error: %c" + res.status + " — " + (msg || "unknown"), "color: #ff4444; font-weight: bold", "color: #ccc");
			addChatMessage("assistant", msg || "Something went wrong. Please try again.");
			if (chatHistory.length && chatHistory[chatHistory.length - 1].role === "user") chatHistory.pop();
			chatSending = false;
			return;
		}
		const data = await res.json();
		const tcNames = (data.toolCalls || []).map((tc) => tc.name).join(", ");
		console.log("%c🤖 Chat response: %c" + data.response.length + " chars" + (tcNames ? " | tools: " + tcNames : ""), "color: #88ff88; font-weight: bold", "color: #ccc");
		if (data.toolCalls && data.toolCalls.length > 0) for (const tc of data.toolCalls) {
			console.groupCollapsed("%c🔧 TOOL CALL: " + tc.name, "color: #ff8844; font-weight: bold");
			console.log("%cRequest rawArgs:", "color: #aaa; font-weight: bold", tc.rawArgs || tc.args);
			console.log("%cRequest exec args:", "color: #aaa; font-weight: bold", tc.args);
			console.log("%cResult:", "color: #aaa; font-weight: bold", tc.result);
			console.groupEnd();
		}
		if (data.debug) {
			const contents = data.debug.contents || [];
			const modelParts = [{ text: data.response }];
			if (data.toolCalls && data.toolCalls.length > 0) for (const tc of data.toolCalls) modelParts.push({ functionCall: {
				name: tc.name,
				args: tc.rawArgs || tc.args
			} });
			contents.push({
				role: "model",
				parts: modelParts
			});
			window.geminiChatHistory = {
				systemPrompt: data.debug.systemPrompt,
				contents
			};
			try {
				localStorage.setItem("geminiChatHistory", JSON.stringify(window.geminiChatHistory));
			} catch (e) {}
			console.log("%c📋 geminiChatHistory: %c" + (window.geminiChatHistory.systemPrompt || "").length + " char prompt, " + contents.length + " messages (window.geminiChatHistory)", "color: #ffaa44; font-weight: bold", "color: #ccc");
		}
		if (data.toolCalls && data.toolCalls.length > 0) {
			const messagesEl = document.getElementById("chat-messages");
			for (const tc of data.toolCalls) messagesEl.appendChild(renderToolCallChip(tc));
			messagesEl.scrollTop = messagesEl.scrollHeight;
		}
		let assistantMsg = null;
		if (data.response) assistantMsg = addChatMessage("assistant", data.response);
		const builderTurns = [];
		if (data.toolCalls && data.toolCalls.length > 0) {
			for (const tc of data.toolCalls) if (tc.name === "navigate_to") {
				const agentScene = Math.round(Number(tc.args.scene) || 1);
				const agentStep = tc.args.step !== void 0 ? Math.round(Number(tc.args.step)) : 0;
				const internalScene = agentScene - 1;
				const internalStep = agentStep - 1;
				const totalScenes = typeof lessonSpec !== "undefined" && lessonSpec && lessonSpec.scenes ? lessonSpec.scenes.length : 0;
				const beforeScene = currentSceneIndex;
				const beforeStep = currentStepIndex;
				console.log("%c📍 navigate_to: %cagent: scene=" + agentScene + " step=" + agentStep + " → internal: scene=" + internalScene + " step=" + internalStep + " | before: scene=" + (beforeScene + 1) + " step=" + (beforeStep + 1) + " | totalScenes=" + totalScenes, "color: #ff8844; font-weight: bold", "color: #ccc");
				if (internalScene < 0 || internalScene >= totalScenes) console.error("📍 navigate_to REJECTED: scene " + agentScene + " out of bounds (1-" + totalScenes + ")");
				else if (typeof navigateTo === "function") {
					navigateTo(internalScene, internalStep);
					if (typeof window.algebenchEnsureSceneVisible === "function") window.algebenchEnsureSceneVisible();
					console.log("%c📍 navigate_to result: %cnow at scene " + (currentSceneIndex + 1) + " step " + (currentStepIndex + 1) + (currentSceneIndex === beforeScene && currentStepIndex === beforeStep ? " ⚠️ NO CHANGE" : ""), "color: #ff8844; font-weight: bold", "color: #ccc");
				}
			} else if (tc.name === "set_camera") {
				const viewName = tc.args.view;
				if (viewName && typeof CAMERA_VIEWS !== "undefined") {
					const key = viewName.toLowerCase().replace(/\s+/g, "-");
					if (CAMERA_VIEWS[key]) animateCamera(key, 800);
					else {
						const btn = document.querySelector(`.cam-btn[data-view="${key}"]`);
						if (btn) btn.click();
					}
				} else if (tc.args.position || tc.args.target) {
					const tgt = tc.args.target || [
						0,
						0,
						0
					];
					let pos = tc.args.position;
					const zoom = tc.args.zoom;
					if (!pos && typeof camera !== "undefined" && typeof controls !== "undefined" && typeof worldCameraToData === "function") {
						const curPosData = worldCameraToData([
							camera.position.x,
							camera.position.y,
							camera.position.z
						]);
						const curTgtData = worldCameraToData([
							controls.target.x,
							controls.target.y,
							controls.target.z
						]);
						pos = [
							tgt[0] + (curPosData[0] - curTgtData[0]),
							tgt[1] + (curPosData[1] - curTgtData[1]),
							tgt[2] + (curPosData[2] - curTgtData[2])
						];
					} else if (!pos) pos = [
						tgt[0],
						tgt[1] + 50,
						tgt[2] + 50
					];
					if (pos) {
						const dx = pos[0] - tgt[0], dy = pos[1] - tgt[1], dz = pos[2] - tgt[2];
						Math.sqrt(dx * dx + dy * dy + dz * dz);
						if (zoom != null && zoom > 0) {
							const s = 1 / zoom;
							pos = [
								tgt[0] + dx * s,
								tgt[1] + dy * s,
								tgt[2] + dz * s
							];
						}
					}
					if (typeof CAMERA_VIEWS !== "undefined" && typeof animateCamera === "function") {
						const wPos = typeof dataCameraToWorld === "function" ? dataCameraToWorld(pos) : pos;
						const wTgt = typeof dataCameraToWorld === "function" ? dataCameraToWorld(tgt) : tgt;
						const sceneUp = typeof camera !== "undefined" && camera ? [
							camera.up.x,
							camera.up.y,
							camera.up.z
						] : [
							0,
							1,
							0
						];
						CAMERA_VIEWS["__agent"] = {
							position: wPos,
							target: wTgt,
							up: sceneUp
						};
						animateCamera("__agent", 800);
					}
				}
			} else if (tc.name === "build_scene") {
				if (tc.result && tc.result.status === "error") console.log("build_scene: skipped —", tc.result.error || "refused by the server");
				else {
					const said = await runBuildSceneTool(tc);
					if (said) builderTurns.push(said);
				}
			} else if (tc.name === "set_sliders") {
				const values = tc.args.values || {};
				const promises = Object.entries(values).map(([id, target]) => typeof animateSlider === "function" ? animateSlider(id, parseFloat(String(target)), 800) : Promise.resolve(false));
				await Promise.all(promises);
			} else if (tc.name === "set_preset_prompts") setPresetPrompts$1(tc.args.prompts || []);
			else if (tc.name === "set_info_overlay") {
				if (tc.args.id) {
					if (typeof addInfoOverlay === "function") addInfoOverlay(tc.args.id, tc.args.content || "", tc.args.position || "top-left");
				} else console.warn("set_info_overlay: tool call missing required `id`; dropping", { args: tc.args });
			} else if (tc.name === "clear_info_overlays") {
				if (typeof removeAllInfoOverlays === "function") removeAllInfoOverlays();
			} else if (tc.name === "navigate_proof") {
				const proofStep = parseInt(String(tc.result?.step ?? tc.args?.step ?? 0));
				if (typeof navigateProof === "function") navigateProof(proofStep - 1);
			} else if (tc.name === "derive_proof_animation") {
				if (tc.result && tc.result.status !== "success") console.log("derive_proof_animation: skipped —", tc.result.error || "not permitted");
				else if (typeof window.algebenchDeriveProof === "function") window.algebenchDeriveProof(tc.args || {});
				else console.warn("derive_proof_animation: graph view not ready to derive");
			} else if (tc.name === "control_coach") {
				const engine = window.AlgeBenchCoach && window.AlgeBenchCoach.engine;
				if (engine && typeof engine.control === "function") engine.control(tc.args?.action, { step: tc.args?.step });
				else console.warn("control_coach: coach engine not available");
			}
		}
		chatHistory.push({
			role: "assistant",
			text: data.response
		});
		for (const said of builderTurns) chatHistory.push({
			role: "assistant",
			text: said
		});
		while (chatHistory.length > CHAT_HISTORY_MAX) chatHistory.shift();
		const memToolNames = [
			"eval_math",
			"mem_get",
			"mem_set"
		];
		if ((data.toolCalls || []).some((tc) => memToolNames.includes(tc.name))) updateMemoryStatus();
		if (assistantMsg && typeof assistantMsg._startSpeak === "function" && data.response && selectedTtsMode !== "silent") assistantMsg._startSpeak();
		if (typeof window.algebenchRefreshPromptContext === "function") window.algebenchRefreshPromptContext("chat-turn");
	} catch (err) {
		loadingEl.remove();
		console.error("%c🤖 Chat error: %c" + err, "color: #ff4444; font-weight: bold", "color: #ccc", err);
		addChatMessage("assistant", err instanceof TypeError && /fetch|network|connect/i.test(err.message) ? "Failed to reach AI service. Check your connection." : "Error processing response: " + err.message);
		if (chatHistory.length && chatHistory[chatHistory.length - 1].role === "user") chatHistory.pop();
	}
	chatSending = false;
}
function addChatMessage(role, content, toolCalls) {
	const messagesEl = document.getElementById("chat-messages");
	const msgDiv = document.createElement("div");
	msgDiv.className = "chat-msg " + role;
	const avatar = document.createElement("div");
	avatar.className = "msg-avatar";
	const _icons = window.algebenchIcons;
	if (_icons) avatar.innerHTML = role === "user" ? _icons.user : _icons.ai;
	else avatar.textContent = role === "user" ? "👤" : "🤖";
	msgDiv.appendChild(avatar);
	const body = document.createElement("div");
	body.className = "msg-body";
	if (typeof renderKaTeX === "function" && typeof renderMarkdown === "function") body.innerHTML = role === "user" ? renderKaTeX(content, false) : renderMarkdown(content);
	else body.textContent = content;
	body.dataset.markdown = content;
	msgDiv.appendChild(body);
	if (role === "assistant") {
		const SVG_SPEAKER = "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" width=\"12\" height=\"12\"><path d=\"M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z\"/></svg>";
		const speakBtn = document.createElement("button");
		speakBtn.className = "msg-speak-btn";
		speakBtn.title = "Read aloud";
		speakBtn.innerHTML = SVG_SPEAKER;
		const setBtnState = (state) => {
			speakBtn.classList.remove("active", "loading", "idle");
			if (state) speakBtn.classList.add(state);
			else speakBtn.classList.add("idle");
			msgDiv.classList.remove("tts-speaking", "tts-loading");
			if (state === "active") msgDiv.classList.add("tts-speaking");
			if (state === "loading") msgDiv.classList.add("tts-loading");
			if (state === "loading") {
				speakBtn.textContent = "...";
				speakBtn.title = "Loading audio (click to cancel)";
			} else if (state === "active") {
				speakBtn.innerHTML = SVG_SPEAKER;
				speakBtn.title = "Playing (click to stop, double-click to restart)";
			} else {
				speakBtn.innerHTML = SVG_SPEAKER;
				speakBtn.title = "Read aloud (click to play)";
			}
		};
		const stopOtherBtn = () => {
			if (activeSpeakBtn && activeSpeakBtn !== speakBtn) {
				if (activeSpeakBtn._ttsLoadPoll) {
					clearInterval(activeSpeakBtn._ttsLoadPoll);
					activeSpeakBtn._ttsLoadPoll = null;
				}
				if (activeSpeakBtn._ttsStatePoll) {
					clearInterval(activeSpeakBtn._ttsStatePoll);
					activeSpeakBtn._ttsStatePoll = null;
				}
				if (typeof activeSpeakBtn._setBtnState === "function") activeSpeakBtn._setBtnState(null);
				if (activeSpeakBtn._downloadBtn) activeSpeakBtn._downloadBtn.style.display = "none";
				activeSpeakBtn = null;
			}
		};
		const stopAndReset = () => {
			if (typeof window.algebenchStopTTS === "function") window.algebenchStopTTS();
			if (speakBtn._ttsStatePoll) {
				clearInterval(speakBtn._ttsStatePoll);
				speakBtn._ttsStatePoll = null;
			}
			setBtnState(null);
			if (activeSpeakBtn === speakBtn) activeSpeakBtn = null;
		};
		const startPlay = () => {
			stopOtherBtn();
			if (typeof window.algebenchSpeakText !== "function") return;
			if (speakBtn._ttsStatePoll) {
				clearInterval(speakBtn._ttsStatePoll);
				speakBtn._ttsStatePoll = null;
			}
			setBtnState("loading");
			activeSpeakBtn = speakBtn;
			window.algebenchSpeakText(body.dataset.markdown || content, () => {
				if (speakBtn._ttsStatePoll) {
					clearInterval(speakBtn._ttsStatePoll);
					speakBtn._ttsStatePoll = null;
				}
				setBtnState(null);
				if (activeSpeakBtn === speakBtn) activeSpeakBtn = null;
			});
			speakBtn._ttsStatePoll = setInterval(() => {
				if (activeSpeakBtn !== speakBtn) {
					clearInterval(speakBtn._ttsStatePoll);
					speakBtn._ttsStatePoll = null;
					return;
				}
				const p = typeof _ensureTTSPlayer === "function" ? _ensureTTSPlayer() : null;
				if (!p) return;
				const playerState = p._state;
				if (playerState === "loading") {
					if (!speakBtn.classList.contains("loading")) setBtnState("loading");
				} else if (playerState === "playing") {
					if (!speakBtn.classList.contains("active")) setBtnState("active");
				}
			}, 80);
		};
		speakBtn._setBtnState = setBtnState;
		msgDiv._startSpeak = startPlay;
		speakBtn.addEventListener("click", () => {
			if (speakBtn._ignoreNextClick) {
				speakBtn._ignoreNextClick = false;
				return;
			}
			if (activeSpeakBtn === speakBtn) {
				stopAndReset();
				return;
			}
			startPlay();
		});
		speakBtn.addEventListener("dblclick", (e) => {
			e.preventDefault();
			speakBtn._ignoreNextClick = true;
			stopAndReset();
			startPlay();
		});
		const downloadBtn = document.createElement("a");
		downloadBtn.className = "tts-download-btn";
		downloadBtn.href = "/api/tts/download";
		downloadBtn.download = "";
		downloadBtn.title = "Download audio";
		downloadBtn.innerHTML = "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" width=\"11\" height=\"11\"><path d=\"M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 7h14v2H5v-2z\"/></svg>";
		downloadBtn.style.display = "none";
		speakBtn._downloadBtn = downloadBtn;
		const speakCol = document.createElement("div");
		speakCol.className = "tts-speak-col";
		speakCol.appendChild(speakBtn);
		speakCol.appendChild(downloadBtn);
		msgDiv.appendChild(speakCol);
	}
	messagesEl.appendChild(msgDiv);
	messagesEl.scrollTop = messagesEl.scrollHeight;
	if (role === "user") chatHistory.push({
		role: "user",
		text: content
	});
	return msgDiv;
}
function addChatLoading() {
	const messagesEl = document.getElementById("chat-messages");
	const loadingDiv = document.createElement("div");
	loadingDiv.className = "chat-msg assistant";
	const avatar = document.createElement("div");
	avatar.className = "msg-avatar";
	if (window.algebenchIcons) avatar.innerHTML = window.algebenchIcons.ai;
	else avatar.textContent = "🤖";
	loadingDiv.appendChild(avatar);
	const body = document.createElement("div");
	body.className = "msg-body chat-loading";
	body.innerHTML = "<span></span><span></span><span></span>";
	loadingDiv.appendChild(body);
	messagesEl.appendChild(loadingDiv);
	messagesEl.scrollTop = messagesEl.scrollHeight;
	return loadingDiv;
}
function renderToolCallChip(tc) {
	const chip = document.createElement("div");
	chip.className = "chat-tool-call";
	const rawArgs = tc.rawArgs || tc.args;
	const e = _escHtml;
	let friendlyText = e(tc.name);
	if (tc.name === "navigate_to") {
		const reason = tc.args.reason || "";
		const agentScene = Math.round(Number(tc.args.scene) || 1);
		const agentStep = tc.args.step !== void 0 ? Math.round(Number(tc.args.step)) : 0;
		let sceneTitle = "Scene " + agentScene;
		let stepTitle = "";
		if (typeof lessonSpec !== "undefined" && lessonSpec && lessonSpec.scenes) {
			const s = lessonSpec.scenes[agentScene - 1];
			if (s) {
				sceneTitle = s.title || sceneTitle;
				if (agentStep >= 1 && s.steps && s.steps[agentStep - 1]) stepTitle = s.steps[agentStep - 1].title || "Step " + agentStep;
				else if (agentStep === 0) stepTitle = "Root";
			}
		}
		friendlyText = "📍 Navigated to \"" + e(sceneTitle) + "\"";
		if (stepTitle) friendlyText += ", " + e(stepTitle);
		if (reason) friendlyText += " — " + e(reason);
	} else if (tc.name === "set_camera") {
		const reason = tc.args.reason || "better viewing angle";
		friendlyText = "🎥 Camera adjusted" + (tc.args.view ? " (" + e(tc.args.view) + ")" : "") + " — " + e(reason);
	} else if (tc.name === "build_scene") friendlyText = "🎬 " + (tc.args.op === "replace" ? "Rebuilding scene" : "Building a scene") + " — " + e(String(tc.args.intent || "new visualization"));
	else if (tc.name === "set_sliders") {
		const vals = tc.args.values || {};
		const parts = Object.entries(vals).map(([id, v]) => e(id) + "→" + e(String(v)));
		friendlyText = "🎚️ Set " + (parts.length > 0 ? parts.join(", ") : "sliders");
	} else if (tc.name === "eval_math") {
		const expr = tc.args.expression || "";
		const result = tc.result && tc.result.result !== void 0 ? tc.result.result : null;
		const storedAs = tc.result && tc.result.stored_as;
		const err = tc.result && tc.result.error;
		if (err) friendlyText = "🧮 eval: " + e(expr) + " → ❌ " + e(err);
		else if (storedAs) {
			const summary = tc.result && tc.result.summary || "";
			friendlyText = "🧮 " + e(expr) + " → 💾 memory['" + e(storedAs) + "'] " + e(summary);
		} else if (Array.isArray(result) && result.length > 3) friendlyText = "🧮 " + e(expr) + " → [" + result.length + " points]";
		else {
			const val = typeof result === "number" ? Number.isInteger(result) ? result : +result.toFixed(6) : JSON.stringify(result);
			friendlyText = "🧮 " + e(expr) + " = " + e(String(val));
		}
	} else if (tc.name === "mem_get") {
		const key = tc.args.key || "";
		const err = tc.result && tc.result.error;
		if (key === "?") {
			const keys = tc.result && tc.result.keys;
			friendlyText = "🗂️ memory keys: " + e(keys && typeof keys === "object" ? Object.keys(keys).join(", ") : "(empty)");
		} else if (err) friendlyText = "🗂️ memory['" + e(key) + "'] → ❌ not found";
		else {
			const summary = tc.result && tc.result.summary || "";
			friendlyText = "🗂️ memory['" + e(key) + "'] → " + e(summary);
		}
	} else if (tc.name === "mem_set") {
		const key = tc.args.key || "";
		const err = tc.result && tc.result.error;
		if (err) friendlyText = "💾 mem_set['" + e(key) + "'] → ❌ " + e(err);
		else {
			const summary = tc.result && tc.result.summary || "";
			friendlyText = "💾 memory['" + e(key) + "'] = " + e(summary);
		}
	} else if (tc.name === "set_preset_prompts") {
		const count = (tc.args.prompts || []).length;
		friendlyText = count === 0 ? "💬 Cleared preset prompts" : "💬 Set " + count + " preset prompt" + (count === 1 ? "" : "s");
	} else if (tc.name === "set_info_overlay") {
		if (tc.args.clear) friendlyText = "🖼️ Cleared info overlays";
		else {
			const id = tc.args.id || "overlay";
			const pos = tc.args.position || "top-left";
			friendlyText = "🖼️ Info overlay \"" + e(id) + "\" @ " + e(pos);
		}
	} else if (tc.name === "navigate_proof") {
		const step = tc.args.step || 0;
		const reason = tc.args.reason || "";
		friendlyText = step === 0 ? "📐 Proof: showing goal overview" : "📐 Proof: step " + step + (reason ? " — " + e(reason) : "");
	} else if (tc.name === "control_coach") {
		const action = tc.args.action || "status";
		const step = tc.args.step ? " → " + e(String(tc.args.step)) : "";
		friendlyText = "🧭 Tour: " + e(action) + step;
	}
	const header = document.createElement("div");
	header.style.cssText = "display:flex;align-items:flex-start;justify-content:space-between;gap:8px;";
	chip.appendChild(header);
	const summary = document.createElement("div");
	summary.className = "tool-call-summary";
	summary.style.flex = "1";
	if (typeof renderMarkdown === "function") summary.innerHTML = renderMarkdown(friendlyText);
	else summary.textContent = friendlyText;
	header.appendChild(summary);
	const resolvedBtn = document.createElement("button");
	resolvedBtn.type = "button";
	resolvedBtn.title = "View resolved args/result";
	resolvedBtn.textContent = "ⓘ";
	resolvedBtn.style.cssText = "border:1px solid rgba(255,255,255,0.2);background:transparent;color:#9aa0a6;border-radius:999px;width:18px;height:18px;line-height:16px;font-size:11px;cursor:pointer;padding:0;flex-shrink:0;";
	header.appendChild(resolvedBtn);
	const details = document.createElement("div");
	details.className = "tool-call-details hidden";
	details.textContent = JSON.stringify({ functionCall: {
		name: tc.name,
		args: rawArgs
	} }, null, 2);
	chip.appendChild(details);
	const resultPreview = document.createElement("div");
	resultPreview.className = "tool-call-details hidden";
	resultPreview.style.cssText = "margin-top:4px;font-size:11px;color:#7f8790;";
	const r = tc.result || {};
	if (typeof r.message === "string" && r.message.trim()) resultPreview.textContent = r.message.trim();
	else if (typeof r.error === "string" && r.error.trim()) resultPreview.textContent = "Error: " + r.error.trim();
	else if (typeof r.summary === "string" && r.summary.trim()) resultPreview.textContent = r.summary.trim();
	else if (r.status) resultPreview.textContent = "Status: " + r.status;
	chip.appendChild(resultPreview);
	const resolvedBackdrop = document.createElement("div");
	resolvedBackdrop.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:none;align-items:center;justify-content:center;padding:16px;";
	const resolvedPanel = document.createElement("div");
	resolvedPanel.style.cssText = "width:min(760px,92vw);max-height:82vh;overflow:auto;background:#11161d;border:1px solid rgba(255,255,255,0.18);border-radius:10px;padding:10px 12px;";
	resolvedBackdrop.appendChild(resolvedPanel);
	const resolvedHeader = document.createElement("div");
	resolvedHeader.style.cssText = "position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;margin:-10px -12px 8px -12px;padding:10px 12px;background:#11161d;border-bottom:1px solid rgba(255,255,255,0.12);color:#cfd6df;font-size:12px;";
	resolvedHeader.textContent = "Resolved args/result";
	resolvedPanel.appendChild(resolvedHeader);
	const closeBtn = document.createElement("button");
	closeBtn.type = "button";
	closeBtn.textContent = "✕";
	closeBtn.style.cssText = "border:1px solid rgba(255,255,255,0.25);background:transparent;color:#cfd6df;border-radius:6px;padding:1px 6px;cursor:pointer;";
	resolvedHeader.appendChild(closeBtn);
	const resolvedBody = document.createElement("pre");
	resolvedBody.style.cssText = "margin:0;font-size:12px;line-height:1.35;white-space:pre-wrap;word-break:break-word;color:#c9d1d9;";
	resolvedBody.textContent = JSON.stringify({
		functionCall: {
			name: tc.name,
			args: tc.args
		},
		result: tc.result
	}, null, 2);
	resolvedPanel.appendChild(resolvedBody);
	document.body.appendChild(resolvedBackdrop);
	summary.addEventListener("click", () => {
		details.classList.toggle("hidden");
		resultPreview.classList.toggle("hidden");
	});
	const hideResolvedPopup = () => {
		resolvedBackdrop.style.display = "none";
	};
	const onResolvedPopupKeydown = (e) => {
		if (e.key === "Escape" && resolvedBackdrop.style.display !== "none") hideResolvedPopup();
	};
	resolvedBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		resolvedBackdrop.style.display = "flex";
	});
	closeBtn.addEventListener("click", hideResolvedPopup);
	resolvedBackdrop.addEventListener("click", (e) => {
		if (e.target === resolvedBackdrop) hideResolvedPopup();
	});
	document.addEventListener("keydown", onResolvedPopupKeydown);
	return chip;
}
var _SVG_UNMUTED = "<svg viewBox=\"0 0 16 16\" width=\"14\" height=\"14\" fill=\"currentColor\"><path d=\"M8 1.3L4.63 4H2.5A1.5 1.5 0 001 5.5v5A1.5 1.5 0 002.5 12h2.13L8 14.7V1.3zm3.74 2.04a4.5 4.5 0 010 9.32l-.55-.96a3.5 3.5 0 000-7.4l.55-.96zm-.93 2.17a2.5 2.5 0 010 4.98l-.55-.96a1.5 1.5 0 000-3.06l.55-.96z\"/></svg>";
var _SVG_MUTED = "<svg viewBox=\"0 0 16 16\" width=\"14\" height=\"14\" fill=\"currentColor\"><path d=\"M8 1.3L4.63 4H2.5A1.5 1.5 0 001 5.5v5A1.5 1.5 0 002.5 12h2.13L8 14.7V1.3zm3 4.2l1.5 1.5L14 5.5l.7.7L13.2 7.7l1.5 1.5-.7.7L12.5 8.4 11 9.9l-.7-.7 1.5-1.5L10.3 6.2l.7-.7z\"/></svg>";
var ttsRequestId = 0;
var ttsPausedByUser = false;
var ttsPlayer = null;
var ttsHasOutputFile = false;
var ttsAbortController = null;
function _ensureTTSPlayer() {
	if (!ttsPlayer && window.GeminiTTSPlayer) {
		ttsPlayer = new window.GeminiTTSPlayer.TTSAudioPlayer({
			volume: .5,
			persistKey: "algebenchTTS",
			onVolumeChange(vol, muted) {
				const slider = document.getElementById("ttsVolumeSlider");
				const icon = document.getElementById("ttsVolumeIcon");
				if (slider) slider.value = String(muted ? 0 : vol);
				if (icon) icon.innerHTML = muted ? _SVG_MUTED : _SVG_UNMUTED;
			}
		});
		const slider = document.getElementById("ttsVolumeSlider");
		const icon = document.getElementById("ttsVolumeIcon");
		if (slider) {
			slider.value = String(ttsPlayer.isMuted() ? 0 : ttsPlayer.getVolume());
			slider.addEventListener("input", () => ttsPlayer.setVolume(parseFloat(slider.value)));
		}
		if (icon) {
			icon.innerHTML = ttsPlayer.isMuted() ? _SVG_MUTED : _SVG_UNMUTED;
			icon.addEventListener("click", () => ttsPlayer.toggleMute());
		}
	}
	return ttsPlayer;
}
window.algebenchGetTTSAudioStream = function() {
	const p = _ensureTTSPlayer();
	return p ? p.getMediaStream() : null;
};
window.algebenchIsTTSSpeaking = function() {
	if (ttsPausedByUser) return false;
	const p = _ensureTTSPlayer();
	return p ? p._state === "playing" : false;
};
window.algebenchIsTTSPaused = function() {
	return ttsPausedByUser;
};
window.algebenchIsTTSLoading = function() {
	const p = _ensureTTSPlayer();
	return p ? p._state === "loading" : false;
};
window.algebenchPauseTTS = function() {
	const p = _ensureTTSPlayer();
	if (!p || !p._ctx) return;
	ttsPausedByUser = true;
	p._ctx.suspend().catch(() => {});
};
window.algebenchResumeTTS = function() {
	const p = _ensureTTSPlayer();
	if (!p || !p._ctx) return;
	ttsPausedByUser = false;
	p._ctx.resume().catch(() => {});
};
window.algebenchStopTTS = function() {
	++ttsRequestId;
	ttsPausedByUser = false;
	ttsHasOutputFile = false;
	if (ttsAbortController) {
		ttsAbortController.abort();
		ttsAbortController = null;
	}
	const p = _ensureTTSPlayer();
	if (p) p.stop();
	fetch("/api/tts/kill", { method: "POST" }).catch(() => {});
};
window.algebenchSpeakText = function(text, onEnd) {
	const expectedId = ttsRequestId + 1;
	speakText(text, { explicit: true });
	if (typeof onEnd !== "function") return;
	const startTime = Date.now();
	let hasStarted = false;
	let sawNonIdle = false;
	const poll = setInterval(() => {
		if (ttsRequestId !== expectedId) {
			clearInterval(poll);
			onEnd();
			return;
		}
		const p = _ensureTTSPlayer();
		if (p && p._state !== "idle") sawNonIdle = true;
		if (p && p.isPlaying()) hasStarted = true;
		if (hasStarted && p && !p.isPlaying()) {
			clearInterval(poll);
			onEnd();
			return;
		}
		if (!hasStarted && sawNonIdle && p && p._state === "idle") {
			clearInterval(poll);
			onEnd();
			return;
		}
		if (Date.now() - startTime > 6e4) {
			clearInterval(poll);
			onEnd();
		}
	}, 80);
};
async function speakText(text, { explicit = false } = {}) {
	if (selectedTtsMode === "silent" && !explicit) return;
	const clean = text.replace(/```[\s\S]*?```/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[📍🤖👤]/gu, "").replace(/\s{2,}/g, " ").trim();
	if (!clean) return;
	const myId = ++ttsRequestId;
	ttsPausedByUser = false;
	ttsHasOutputFile = false;
	if (activeSpeakBtn && activeSpeakBtn._downloadBtn) activeSpeakBtn._downloadBtn.style.display = "none";
	const myDownloadBtn = activeSpeakBtn ? activeSpeakBtn._downloadBtn : null;
	const player = _ensureTTSPlayer();
	if (!player) return;
	if (ttsAbortController) {
		ttsAbortController.abort();
		ttsAbortController = null;
	}
	const abort = new AbortController();
	ttsAbortController = abort;
	let response;
	try {
		response = await fetch("/api/tts/stream", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			signal: abort.signal,
			body: JSON.stringify({
				text: clean,
				character: selectedTtsCharacter || "joker",
				voice: selectedTtsVoice || "Charon",
				mode: selectedTtsMode === "silent" ? "perform" : selectedTtsMode || "read"
			})
		});
		if (!response.ok || ttsRequestId !== myId) return;
		ttsHasOutputFile = response.headers.get("X-TTS-Has-Output-File") === "1";
		await player.playStreamWithAbort(response, abort);
		if (ttsRequestId === myId && ttsHasOutputFile && myDownloadBtn) myDownloadBtn.style.display = "flex";
	} catch (err) {
		return;
	} finally {
		if (ttsAbortController === abort) ttsAbortController = null;
	}
}
(function _initTTSKillListener() {
	let es = null;
	function connect() {
		es = new EventSource("/api/tts/events");
		es.addEventListener("kill", () => {
			++ttsRequestId;
			ttsPausedByUser = false;
			ttsHasOutputFile = false;
			if (ttsAbortController) {
				ttsAbortController.abort();
				ttsAbortController = null;
			}
			const p = _ensureTTSPlayer();
			if (p) p.stop();
		});
		es.onerror = () => {
			es.close();
			setTimeout(connect, 3e3);
		};
	}
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", connect);
	else connect();
})();
var _lastContextJson = "";
function logContextIfChanged() {
	const context = buildChatContext();
	const json = JSON.stringify(context, null, 2);
	if (json === _lastContextJson) return;
	_lastContextJson = json;
	localStorage.setItem("algebench-chat-context", json);
	window.dispatchEvent(new CustomEvent("algebench-context-changed", { detail: {
		context,
		json
	} }));
	const scene = context.currentScene || {};
	const rt = context.runtime || {};
	const sceneParts = [
		scene.title ? `"${scene.title}"` : null,
		scene.steps ? `${scene.steps.length} steps` : null,
		scene.prompt ? "has prompt" : null
	].filter(Boolean).join(", ");
	const rtParts = [
		rt.stepNumber !== void 0 ? `step ${rt.stepNumber}` : null,
		rt.sliders ? `${Object.keys(rt.sliders).length} sliders` : null,
		rt.activeTab || null
	].filter(Boolean).join(", ");
	if (document.body.dataset.debugMode === "true") console.log(`%c🤖 Chat context updated: %cscene=[${sceneParts}] runtime=[${rtParts}] (${json.length} chars)`, "color: #8888ff; font-weight: bold", "color: #ccc");
}
var _contextPollId = null;
function startContextPolling() {
	if (_contextPollId) return;
	_contextPollId = setInterval(logContextIfChanged, 1e3);
}
function sendWelcomeMessage() {
	if (!chatAvailable$1 || shouldSkipWelcome() || welcomeInFlight) return;
	welcomeInFlight = true;
	sendChatMessage$1("**LENGTH OVERRIDE FOR THIS REPLY ONLY:** the usual brevity rule does NOT apply to this welcome. Subsequent replies revert to normal brevity.\n\nThe user just switched to the Chat tab. Read the **USER VIEWING** line in Current State and ground your welcome in exactly that surface. *Actually explain what is on screen* — do not just acknowledge it. Structure:\n\n1. ONE short sentence acknowledging the surface (e.g. \"You are looking at the semantic graph for step 3\" or \"You are on the 3D scene of …\").\n2. A SUBSTANTIVE explanation (3–6 sentences) of what is on screen right now:\n   - If a graph node is selected: explain that node — what the symbol means in context, what role it plays in the equation, and how it relates to the surrounding nodes (use the incoming/outgoing neighbors from Active Semantic Graph).\n   - If the semantic graph is open with no node selected: walk through the structure of the graph (root operator, key operands, the relationship the graph encodes).\n   - If on the 3D scene: explain the visible elements and what the current step is demonstrating.\n3. End with ONE concrete follow-up question the user is most likely to ask next, phrased as an offer (e.g. \"Want me to walk through how … relates to … ?\").\n\nDo not be generic. Do not list capabilities. Use the specific names, symbols, and relationships from the Active Semantic Graph / Active Proof Step / Current Scene Definition sections of the system prompt.", { silent: true }).finally(() => {
		welcomeInFlight = false;
	});
}
function renderMemoryPopup(mem, queryText) {
	const body = document.getElementById("memory-popup-body");
	if (!body) return;
	body.innerHTML = "";
	if (!mem || Object.keys(mem).length === 0) {
		const empty = document.createElement("div");
		empty.id = "memory-popup-empty";
		empty.textContent = "No keys stored yet.";
		body.appendChild(empty);
		return;
	}
	const q = (queryText || "").trim().toLowerCase();
	let matchCount = 0;
	for (const key of Object.keys(mem)) {
		const entry = mem[key] || {};
		const summary = entry.summary || "";
		const val = entry.value;
		let previewText = "";
		if (val !== null && val !== void 0) {
			previewText = JSON.stringify(val);
			if (previewText.length > 120) previewText = previewText.slice(0, 120) + "…";
		}
		if (q) {
			if (!`${key}\n${summary}\n${previewText}`.toLowerCase().includes(q)) continue;
		}
		matchCount++;
		const div = document.createElement("div");
		div.className = "memory-entry";
		const keyEl = document.createElement("span");
		keyEl.className = "memory-entry-key";
		keyEl.textContent = key;
		div.appendChild(keyEl);
		const sep = document.createElement("span");
		sep.style.color = "rgba(120,200,255,0.4)";
		sep.textContent = " → ";
		div.appendChild(sep);
		const summaryEl = document.createElement("span");
		summaryEl.className = "memory-entry-summary";
		summaryEl.textContent = summary;
		div.appendChild(summaryEl);
		if (previewText) {
			const preview = document.createElement("div");
			preview.className = "memory-entry-preview";
			preview.textContent = previewText;
			div.appendChild(preview);
		}
		body.appendChild(div);
	}
	if (matchCount === 0) {
		const noRes = document.createElement("div");
		noRes.id = "memory-popup-no-results";
		noRes.textContent = "No matching memory entries.";
		body.appendChild(noRes);
	}
}
function updateMemoryStatus() {
	fetch("/api/memory").then((r) => r.ok ? r.json() : null).then((mem) => {
		if (!mem) return;
		memorySnapshot = mem;
		window.agentMemoryValues = Object.fromEntries(Object.entries(mem).map(([k, v]) => [k, v && Object.prototype.hasOwnProperty.call(v, "value") ? v.value : void 0]));
		if (typeof updateInfoOverlays === "function") try {
			updateInfoOverlays();
		} catch (_e) {}
		const keys = Object.keys(mem);
		const pill = document.getElementById("memory-status");
		const countEl = pill && pill.querySelector(".memory-status-count");
		const searchInput = document.getElementById("memory-popup-search");
		if (!pill) return;
		if (keys.length === 0) {
			pill.classList.add("hidden");
			const popup = document.getElementById("memory-popup");
			if (popup) popup.classList.add("hidden");
			return;
		}
		if (countEl) countEl.textContent = String(keys.length);
		pill.classList.remove("hidden");
		const bar = document.getElementById("status-bar");
		if (bar) bar.classList.remove("hidden");
		renderMemoryPopup(mem, searchInput ? searchInput.value : "");
	}).catch(() => {});
}
document.addEventListener("DOMContentLoaded", () => {
	setupChat();
	startContextPolling();
	const memPill = document.getElementById("memory-status");
	const memPopup = document.getElementById("memory-popup");
	const memClose = document.getElementById("memory-popup-close");
	const memSearch = document.getElementById("memory-popup-search");
	if (memPill && memPopup) memPill.addEventListener("click", () => {
		memPopup.classList.toggle("hidden");
	});
	if (memClose && memPopup) memClose.addEventListener("click", () => {
		memPopup.classList.add("hidden");
	});
	if (memSearch) memSearch.addEventListener("input", () => {
		renderMemoryPopup(memorySnapshot, memSearch.value);
	});
});
window._escHtml = _escHtml;
window._classifyFocusTarget = _classifyFocusTarget;
window.setPresetPrompts = setPresetPrompts$1;
window.shouldSkipWelcome = shouldSkipWelcome;
window.buildChatContext = buildChatContext;
window.switchPanelTab = switchPanelTab$1;
window.setupChat = setupChat;
window.initChatTtsControls = initChatTtsControls;
window.sendChatMessage = sendChatMessage$1;
window.addChatMessage = addChatMessage;
window.addChatLoading = addChatLoading;
window.renderToolCallChip = renderToolCallChip;
window._ensureTTSPlayer = _ensureTTSPlayer;
window.speakText = speakText;
window.logContextIfChanged = logContextIfChanged;
window.startContextPolling = startContextPolling;
window.sendWelcomeMessage = sendWelcomeMessage;
window.renderMemoryPopup = renderMemoryPopup;
window.updateMemoryStatus = updateMemoryStatus;
//#endregion
//#region src/coach/registry.ts
var coach = window.AlgeBenchCoach = window.AlgeBenchCoach || {
	_steps: [],
	register(s) {
		if (Array.isArray(s)) this._steps.push(...s);
		else if (s) this._steps.push(s);
	},
	get() {
		return this._steps.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	}
};
//#endregion
//#region src/coach/steps/core.ts
coach.register([
	{
		id: "scenes-nav",
		order: 10,
		group: "core",
		target: "#btn-scenes",
		title: "Pick a lesson",
		narration: "Start here. This menu lists built-in lessons — each one is an interactive scene you can step through at your own pace.",
		position: "bottom-start"
	},
	{
		id: "scenes-panel",
		order: 15,
		group: "core",
		target: () => {
			const tree = document.getElementById("scene-tree");
			if (tree && tree.getBoundingClientRect().width > 0) return tree;
			return document.getElementById("scene-dock") || tree;
		},
		title: "Your map of the lesson",
		narration: "This panel is the lesson outline. Each lesson has several scenes, and each scene has steps — click any one to jump straight there. It’s how you move around at your own pace.",
		position: "right",
		when: (ctx) => ctx.hasScene,
		optional: true,
		action: async (ctx) => {
			ctx.clickDockTab("scenes");
			await ctx.delay(150);
		}
	},
	{
		id: "chat-window",
		order: 20,
		group: "core",
		target: "#explanation-panel",
		title: "Ask the AI anything",
		narration: "This is the AI chat. It already knows what’s on your screen, so you can ask it about the current scene, a step, or what to try next.",
		position: "left",
		examplePrompts: ["What is this scene about?", "Walk me through this step."],
		action: async (ctx) => ctx.openChatTab()
	},
	{
		id: "voice-controls",
		order: 25,
		group: "core",
		target: "#chat-tts-controls",
		title: "Give the AI a voice",
		narration: "The AI can read its answers aloud. Up here you can pick a character and its voice, choose how it speaks — Read for word-for-word, Perform to let the character act it out, or Silent for no audio — and set the volume to taste.",
		position: "left",
		when: (ctx) => ctx.chatAvailable,
		optional: true,
		action: async (ctx) => {
			ctx.openChatTab();
			await ctx.delay(150);
		}
	},
	{
		id: "ask-math",
		order: 30,
		group: "core",
		target: "#chat-input",
		title: "Go as deep as you want",
		narration: "You can ask about the math itself — definitions, why a step is valid, or how a formula is derived. Type your own question, or tap an example.",
		position: "left",
		examplePrompts: ["Why is this step valid?", "Explain the math behind this."],
		action: async (ctx) => ctx.openChatTab()
	},
	{
		id: "ai-ask-buttons",
		order: 35,
		group: "core",
		target: () => [...document.querySelectorAll(".ai-ask-btn")].find((b) => {
			const r = b.getBoundingClientRect();
			return r.width > 0 && r.height > 0;
		}) || null,
		title: "The ✦ Ask-AI buttons",
		narration: "See the little sparkle buttons dotted around? Each one asks the AI about that exact thing — a value, a symbol, a proof step, or a graph node. Click it to send the question straight to chat, or hold Command (or Ctrl) and click to edit the question first.",
		position: "top",
		when: (ctx) => ctx.hasScene,
		optional: true,
		action: async (ctx) => {
			ctx.clickDockTab("scenes");
			await ctx.delay(150);
		}
	},
	{
		id: "math-tab",
		order: 38,
		group: "core",
		target: "#graph-proof-tree",
		title: "The MATH tab",
		narration: "Switch to the MATH tab and you get the full proof for this scene, step by step. It’s synchronized — pick a step here and the graph below and the proof panel on the right all jump to the same place.",
		position: "right",
		when: (ctx) => ctx.hasScene,
		optional: true,
		action: async (ctx) => {
			ctx.clickDockTab("graph");
			await ctx.delay(300);
			ctx.selectFirstGraphStep();
			await ctx.delay(300);
		}
	},
	{
		id: "math-graph",
		order: 40,
		group: "core",
		target: "#graph-viewport",
		title: "The semantic graph",
		narration: "Here’s the selected step drawn as a semantic graph — the structure of the math laid out visually, not just the symbols.",
		position: "left",
		when: (ctx) => ctx.hasScene,
		action: async (ctx) => {
			ctx.clickDockTab("graph");
			await ctx.delay(300);
			ctx.selectFirstGraphStep();
			await ctx.delay(350);
		}
	},
	{
		id: "graph-interactive",
		order: 50,
		group: "core",
		target: () => document.getElementById("graph-mermaid-container") || document.getElementById("graph-viewport"),
		title: "Every piece is clickable",
		narration: "The graph is interactive. Hover over any node and a ✦ button appears — click it to ask the AI about that exact sub-expression, or hold Command (or Ctrl) and click to edit the question first. And clicking a node opens its details, which we’ll look at next.",
		position: "left",
		when: (ctx) => ctx.hasScene,
		optional: true,
		action: async (ctx) => {
			ctx.clickDockTab("graph");
			await ctx.delay(200);
			ctx.selectFirstGraphStep();
			await ctx.delay(300);
		}
	},
	{
		id: "node-details",
		order: 51,
		group: "core",
		target: "#graph-info-panel-host",
		title: "Node details",
		narration: "Click a node and this panel shows what it is — the expression, a plain-language description, and how it connects to the rest of the proof. From here you can ask the AI about it or derive it further.",
		position: "right",
		when: (ctx) => ctx.hasScene,
		optional: true,
		action: async (ctx) => {
			ctx.clickDockTab("graph");
			await ctx.delay(300);
			ctx.selectFirstGraphStep();
			await ctx.delay(500);
			ctx.selectFirstGraphNode();
			await ctx.delay(400);
		}
	},
	{
		id: "derive-button",
		order: 52,
		group: "core",
		target: () => document.querySelector(".graph-panel-derive-btn"),
		title: "Derive it step by step",
		narration: "The Derive button — the stacked-lines icon next to ✦ — derives this expression. It builds a verified, step-by-step derivation and docks it right onto the graph, so you can watch how the result is reached rather than just being told.",
		position: "bottom",
		when: (ctx) => ctx.hasScene,
		optional: true,
		action: async (ctx) => {
			ctx.clickDockTab("graph");
			await ctx.delay(300);
			ctx.selectFirstGraphStep();
			await ctx.delay(500);
			ctx.selectFirstGraphNode();
			await ctx.delay(400);
		}
	},
	{
		id: "chart-button",
		order: 53,
		group: "core",
		target: () => [...document.querySelectorAll(".d3sg-chart-btn")].find((b) => {
			const r = b.getBoundingClientRect();
			return r.width > 0 && r.height > 0;
		}) || null,
		title: "Plot it as a chart",
		narration: "Nodes whose expression can be plotted show a small chart button. Click it to open an interactive Chart.js plot of that expression — handy for seeing how a function behaves, not just its formula.",
		position: "right",
		when: (ctx) => ctx.hasScene,
		optional: true,
		action: async (ctx) => {
			ctx.clickDockTab("graph");
			await ctx.delay(250);
			ctx.selectFirstGraphStep();
			await ctx.delay(350);
		}
	},
	{
		id: "graph-controls",
		order: 54,
		group: "core",
		target: () => document.getElementById("graph-controls-left") || document.getElementById("graph-viewport"),
		title: "Make the graph yours",
		narration: "This toolbar controls the graph itself. Switch the renderer between D3 and Mermaid, change the theme and how much detail the labels show, flip the layout direction, zoom in and out, or dock the graph right beside the 3D view so you can see both at once.",
		position: "bottom",
		when: (ctx) => ctx.hasScene,
		optional: true,
		action: async (ctx) => {
			ctx.clickDockTab("graph");
			await ctx.delay(250);
		}
	},
	{
		id: "proof-panel",
		order: 55,
		group: "core",
		target: "#proof-panel",
		title: "The proof, in words",
		narration: "Over on the right, the proof panel walks the very same steps in plain language and equations. Use the arrows at the bottom to step through it — it stays in sync with the MATH tab and the graph.",
		position: "left",
		when: (ctx) => ctx.hasScene,
		optional: true,
		action: async (ctx) => {
			ctx.gotoProofStep();
			await ctx.delay(400);
			ctx.openProofPanel();
			await ctx.delay(500);
			ctx.ensureProofStep();
			await ctx.delay(200);
		}
	},
	{
		id: "viewport-3d",
		order: 60,
		group: "core",
		target: () => document.getElementById("mathbox-container"),
		title: "Play with the 3D view",
		narration: "This is the 3D viewport, and it’s hands-on. Drag to rotate, scroll to zoom, and shift-drag to pan. Everything here is live — the visualization updates as you explore.",
		position: "top",
		when: (ctx) => ctx.hasScene,
		action: async (ctx) => {
			ctx.clickDockTab("scenes");
			await ctx.delay(150);
		}
	},
	{
		id: "camera-views",
		order: 62,
		group: "core",
		target: "#camera-buttons",
		title: "Jump to the best angle",
		narration: "These camera buttons snap you to hand-picked viewpoints for the scene — an overview, close-ups, or a follow/ride-along view that tracks the motion. Reset returns you to the default angle whenever you get lost.",
		position: "left",
		when: (ctx) => ctx.hasScene,
		optional: true,
		action: async (ctx) => {
			ctx.clickDockTab("scenes");
			await ctx.delay(200);
		}
	},
	{
		id: "viewport-sliders",
		order: 64,
		group: "core",
		target: () => {
			const so = document.getElementById("slider-overlay");
			if (so && !so.classList.contains("hidden") && so.children.length) return so;
			return document.getElementById("mathbox-container");
		},
		title: "Move the sliders",
		narration: "Many steps add sliders. Drag one and the 3D scene, the equations, and the labels all update together in real time — it’s the best way to build intuition for how each quantity shapes the result.",
		position: "top",
		when: (ctx) => ctx.hasScene,
		optional: true,
		action: async (ctx) => {
			ctx.clickDockTab("scenes");
			ctx.gotoSliderStep();
			await ctx.delay(400);
		}
	}
]);
//#endregion
//#region src/coach/coach.ts
var STEP_VERSION = 1;
var LS = {
	version: "algebench.coach.version",
	completed: "algebench.coach.completed",
	position: "algebench.coach.position",
	dismissed: "algebench.coach.dismissed",
	lastHintDate: "algebench.coach.lastHintDate",
	firstVisitDone: "algebench.coach.firstVisitDone",
	tts: "algebench.coach.tts",
	debug: "algebench.coach.debug"
};
var _lsGet = (k, f = null) => {
	try {
		return localStorage.getItem(k) ?? f;
	} catch {
		return f;
	}
};
var _lsSet = (k, v) => {
	try {
		localStorage.setItem(k, v);
	} catch {}
};
var _lsJSON = (k, f) => {
	try {
		return JSON.parse(localStorage.getItem(k)) ?? f;
	} catch {
		return f;
	}
};
var today = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
var delay = (ms) => new Promise((r) => setTimeout(r, ms));
var DEBUG = false;
function log(...args) {
	if (!DEBUG) return;
	try {
		console.log("%c[coach]", "color:#8c96ff;font-weight:bold", ...args);
	} catch {}
}
function initDebug() {
	try {
		const p = new URLSearchParams(location.search);
		if (p.has("coachdebug")) {
			DEBUG = p.get("coachdebug") !== "0";
			_lsSet(LS.debug, DEBUG ? "1" : "0");
			return;
		}
	} catch {}
	if (_lsGet(LS.debug) === "1") {
		DEBUG = true;
		return;
	}
	try {
		DEBUG = !!(document.body && document.body.dataset && document.body.dataset.debugMode === "true");
	} catch {}
}
function tourSkipped() {
	try {
		const p = new URLSearchParams(location.search);
		if (p.has("skiptour")) return p.get("skiptour") !== "0";
	} catch {}
	try {
		return !!(document.body && document.body.dataset && document.body.dataset.skipTour === "true");
	} catch {}
	return false;
}
var S = {
	completed: /* @__PURE__ */ new Set(),
	steps: [],
	idx: 0,
	active: false,
	target: null,
	position: "right",
	ttsOn: true,
	lastNarration: "",
	cardMoved: false,
	justOpened: false,
	seekIncomplete: false,
	spotlitEl: null,
	userGestured: false,
	pendingNarration: ""
};
var REOPEN_TIP = " By the way — you can jump back into this tour anytime: just click the Tour button at the top right.";
function speak(text) {
	if (!text) return;
	S.lastNarration = text;
	if (!S.ttsOn) return;
	if (!S.userGestured) {
		S.pendingNarration = text;
		return;
	}
	if (typeof window.algebenchSpeakText === "function") try {
		window.algebenchSpeakText(text);
	} catch {}
}
function setupAudioUnlock() {
	const onGesture = () => {
		if (S.userGestured) return;
		S.userGestured = true;
		window.removeEventListener("pointerdown", onGesture, true);
		window.removeEventListener("keydown", onGesture, true);
		const t = S.pendingNarration;
		S.pendingNarration = "";
		if (t && S.ttsOn && typeof window.algebenchSpeakText === "function") try {
			window.algebenchSpeakText(t);
		} catch {}
	};
	window.addEventListener("pointerdown", onGesture, true);
	window.addEventListener("keydown", onGesture, true);
}
function stopTTS() {
	if (typeof window.algebenchStopTTS === "function") try {
		window.algebenchStopTTS();
	} catch {}
}
function updateTTSIcon() {
	if (!els.ttsToggle) return;
	els.ttsToggle.textContent = S.ttsOn ? "🔊" : "🔇";
	els.ttsToggle.title = S.ttsOn ? "Narration on — click to mute" : "Narration off — click to enable";
	els.ttsToggle.classList.toggle("coach-tts-off", !S.ttsOn);
}
function toggleTTS() {
	S.ttsOn = !S.ttsOn;
	_lsSet(LS.tts, S.ttsOn ? "1" : "0");
	log("toggle narration →", S.ttsOn ? "on" : "off");
	updateTTSIcon();
	if (!S.ttsOn) stopTTS();
	else if (S.lastNarration && typeof window.algebenchSpeakText === "function") try {
		window.algebenchSpeakText(S.lastNarration);
	} catch {}
}
function hasScene() {
	return !!(window.lessonSpec && window.lessonSpec.scenes && window.lessonSpec.scenes.length);
}
function chatAvailable() {
	const msg = document.getElementById("chat-unavailable-msg");
	return !(msg && !msg.classList.contains("hidden"));
}
function openChatTab() {
	const panel = document.getElementById("explanation-panel");
	if (panel && panel.classList.contains("hidden")) {
		panel.classList.remove("hidden");
		const handle = document.getElementById("panel-resize-handle");
		const toggle = document.getElementById("explain-toggle");
		if (handle) handle.style.display = "block";
		if (toggle) {
			toggle.style.display = "block";
			toggle.classList.add("active");
		}
		setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
	}
	document.querySelector(".panel-tab[data-tab=\"chat\"]")?.click();
}
function clickDockTab(name) {
	document.querySelector(`.dock-tab[data-dock-tab="${name}"]`)?.click();
}
function openProofPanel() {
	openChatTab();
	const panel = document.getElementById("proof-panel");
	const toggle = document.getElementById("proof-toggle-btn");
	if (panel && panel.classList.contains("hidden") && toggle && toggle.style.display !== "none") toggle.click();
	return !!(panel && !panel.classList.contains("hidden"));
}
function gotoProofStep() {
	const toggle = document.getElementById("proof-toggle-btn");
	if (toggle && toggle.style.display !== "none") return true;
	const spec = window.lessonSpec;
	if (!spec || typeof window.navigateTo !== "function") return false;
	if (spec.proof != null) return true;
	const scenes = spec.scenes || [];
	for (let si = 0; si < scenes.length; si++) {
		const sc = scenes[si] || {};
		if (sc.proof != null) {
			window.navigateTo(si, -1);
			return true;
		}
		const steps = sc.steps || [];
		for (let ti = 0; ti < steps.length; ti++) if (steps[ti].proof != null) {
			window.navigateTo(si, ti);
			return true;
		}
	}
	return false;
}
function ensureProofStep() {
	if (typeof window.navigateProof !== "function") return;
	const idx = window.proofStepIndex;
	if (typeof idx !== "number" || idx < 0) try {
		window.navigateProof(0);
		log("ensureProofStep → navigate to step 0");
	} catch {}
	else log(`ensureProofStep: step ${idx} already selected`);
}
function selectFirstGraphStep() {
	if (document.querySelector("#graph-mermaid-container svg")) return true;
	const tree = document.getElementById("graph-proof-tree");
	if (!tree) return false;
	const steps = [...tree.querySelectorAll(".gp-tree-step")];
	const node = steps.find((s) => s.querySelector(".gp-tree-step-has-graph")) || steps[0];
	if (node) {
		node.click();
		return true;
	}
	return false;
}
function selectFirstGraphNode() {
	const host = document.getElementById("graph-info-panel-host");
	if (document.querySelector("#graph-mermaid-container .d3sg-node.selected, #graph-mermaid-container .d3sg-node.active") && host && host.innerHTML.trim()) return true;
	const node = document.querySelector("#graph-mermaid-container .d3sg-nodes .d3sg-node:not(.selected):not(.active)") || document.querySelector("#graph-mermaid-container .d3sg-nodes .d3sg-node");
	if (node) {
		node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		return true;
	}
	return false;
}
function gotoSliderStep() {
	const so = document.getElementById("slider-overlay");
	if (so && !so.classList.contains("hidden") && so.children.length) return true;
	const spec = window.lessonSpec;
	if (!spec || !Array.isArray(spec.scenes) || typeof window.navigateTo !== "function") return false;
	for (let si = 0; si < spec.scenes.length; si++) {
		const sc = spec.scenes[si] || {};
		if (Array.isArray(sc.sliders) && sc.sliders.length) {
			window.navigateTo(si, -1);
			return true;
		}
		const steps = sc.steps || [];
		for (let ti = 0; ti < steps.length; ti++) if (Array.isArray(steps[ti].sliders) && steps[ti].sliders.length) {
			window.navigateTo(si, ti);
			return true;
		}
	}
	return false;
}
function handToChat(text, examples) {
	openChatTab();
	if (!chatAvailable()) return false;
	const input = document.getElementById("chat-input");
	if (input && text) {
		input.value = text;
		input.dispatchEvent(new Event("input"));
	}
	document.getElementById("chat-send")?.click();
	return true;
}
function buildCtx() {
	return {
		hasScene: hasScene(),
		chatAvailable: chatAvailable(),
		openChatTab,
		clickDockTab,
		selectFirstGraphStep,
		selectFirstGraphNode,
		gotoSliderStep,
		gotoProofStep,
		openProofPanel,
		ensureProofStep,
		handToChat,
		delay,
		speak
	};
}
function safeWhen(step, ctx) {
	if (typeof step.when !== "function") return true;
	try {
		return !!step.when(ctx);
	} catch {
		return true;
	}
}
function relevantSteps() {
	const ctx = buildCtx();
	return coach.get().filter((s) => safeWhen(s, ctx));
}
function pendingSteps() {
	return coach.get().filter((s) => !S.completed.has(s.id));
}
function firstPendingIdx() {
	return S.steps.findIndex((s) => !S.completed.has(s.id));
}
function nextStepIdx(i) {
	if (S.seekIncomplete) {
		for (let j = i + 1; j < S.steps.length; j++) if (!S.completed.has(S.steps[j].id)) return j;
		return -1;
	}
	return i + 1 < S.steps.length ? i + 1 : -1;
}
function markComplete(id) {
	if (!id || S.completed.has(id)) return;
	S.completed.add(id);
	_lsSet(LS.completed, JSON.stringify([...S.completed]));
	log(`mark complete: "${id}" (${S.completed.size}/${coach.get().length})`);
	updateDot();
}
function updateDot() {
	const dot = btnEl && btnEl.querySelector(".coach-dot");
	if (!dot) return;
	dot.style.display = pendingSteps().length ? "" : "none";
}
var layerEl;
var spotlightEl;
var cardEl;
var btnEl;
var els = {};
function injectCSS() {
	if (document.getElementById("coach-css")) return;
	const link = document.createElement("link");
	link.id = "coach-css";
	link.rel = "stylesheet";
	link.href = "/coach/coach.css";
	document.head.appendChild(link);
}
function buildButton() {
	const toolbar = document.getElementById("toolbar");
	if (!toolbar || document.getElementById("btn-coach")) return;
	btnEl = document.createElement("button");
	btnEl.className = "tb-btn";
	btnEl.id = "btn-coach";
	btnEl.title = "Quick guided tour";
	btnEl.innerHTML = "<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\" style=\"vertical-align:-2px;margin-right:4px\"><path d=\"M2 9.5L12 5l10 4.5L12 14z\"/><path d=\"M6.5 11.8V16c0 1.2 2.5 2.5 5.5 2.5s5.5-1.3 5.5-2.5v-4.2\"/></svg>Tour<span class=\"coach-dot\"></span>";
	btnEl.addEventListener("click", () => {
		if (S.active) dismiss();
		else openTour();
	});
	const explainToggle = document.getElementById("explain-toggle");
	if (explainToggle && explainToggle.parentElement === toolbar) toolbar.insertBefore(btnEl, explainToggle);
	else toolbar.appendChild(btnEl);
}
function buildLayer() {
	if (document.getElementById("coach-layer")) return;
	layerEl = document.createElement("div");
	layerEl.id = "coach-layer";
	spotlightEl = document.createElement("div");
	spotlightEl.id = "coach-spotlight";
	cardEl = document.createElement("div");
	cardEl.id = "coach-card";
	cardEl.innerHTML = `
        <div class="coach-card-head">
            <div class="coach-card-title"></div>
            <span class="coach-card-counter"></span>
            <button class="coach-icon-btn coach-tts-toggle" title="Narration on — click to mute">\u{1F50A}</button>
            <button class="coach-icon-btn coach-close" title="Dismiss">✕</button>
        </div>
        <div class="coach-card-body"></div>
        <div class="coach-examples"></div>
        <div class="coach-prompt-row">
            <input id="coach-prompt-input" type="text" placeholder="Ask your own question..." />
            <button id="coach-prompt-send" title="Ask">➜</button>
        </div>
        <div class="coach-card-foot">
            <button class="coach-btn coach-prev">‹ Back</button>
            <div class="coach-foot-spacer"></div>
            <button class="coach-btn coach-secondary"></button>
            <button class="coach-btn coach-btn-primary coach-next">Next ›</button>
        </div>`;
	layerEl.appendChild(spotlightEl);
	layerEl.appendChild(cardEl);
	document.body.appendChild(layerEl);
	els = {
		head: cardEl.querySelector(".coach-card-head"),
		title: cardEl.querySelector(".coach-card-title"),
		counter: cardEl.querySelector(".coach-card-counter"),
		ttsToggle: cardEl.querySelector(".coach-tts-toggle"),
		close: cardEl.querySelector(".coach-close"),
		body: cardEl.querySelector(".coach-card-body"),
		examples: cardEl.querySelector(".coach-examples"),
		promptRow: cardEl.querySelector(".coach-prompt-row"),
		promptInput: cardEl.querySelector("#coach-prompt-input"),
		promptSend: cardEl.querySelector("#coach-prompt-send"),
		foot: cardEl.querySelector(".coach-card-foot"),
		prev: cardEl.querySelector(".coach-prev"),
		secondary: cardEl.querySelector(".coach-secondary"),
		next: cardEl.querySelector(".coach-next")
	};
	els.close.addEventListener("click", () => dismiss());
	els.ttsToggle.addEventListener("click", () => toggleTTS());
	updateTTSIcon();
	const submitPrompt = () => {
		const v = els.promptInput.value.trim();
		if (v) engagePrompt(v);
	};
	els.promptSend.addEventListener("click", submitPrompt);
	els.promptInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			submitPrompt();
		}
	});
	setupCardDrag();
}
function setupCardDrag() {
	let drag = null;
	let raf = 0;
	let pending = null;
	const flush = () => {
		raf = 0;
		if (!pending) return;
		cardEl.style.left = pending.left + "px";
		cardEl.style.top = pending.top + "px";
		pending = null;
	};
	els.head.addEventListener("pointerdown", (e) => {
		if (e.target.closest(".coach-icon-btn")) return;
		const r = cardEl.getBoundingClientRect();
		drag = {
			dx: e.clientX - r.left,
			dy: e.clientY - r.top,
			w: r.width,
			h: r.height
		};
		S.cardMoved = true;
		try {
			els.head.setPointerCapture(e.pointerId);
		} catch {}
		e.preventDefault();
		log("card drag start");
	});
	els.head.addEventListener("pointermove", (e) => {
		if (!drag) return;
		const m = 4;
		let left = e.clientX - drag.dx;
		let top = e.clientY - drag.dy;
		left = Math.max(m, Math.min(left, window.innerWidth - drag.w - m));
		top = Math.max(m, Math.min(top, window.innerHeight - drag.h - m));
		pending = {
			left,
			top
		};
		if (!raf) raf = requestAnimationFrame(flush);
	});
	const endDrag = (e) => {
		if (!drag) return;
		drag = null;
		if (raf) {
			cancelAnimationFrame(raf);
			raf = 0;
		}
		flush();
		try {
			els.head.releasePointerCapture(e.pointerId);
		} catch {}
		log("card drag end", {
			left: cardEl.style.left,
			top: cardEl.style.top
		});
	};
	els.head.addEventListener("pointerup", endDrag);
	els.head.addEventListener("pointercancel", endDrag);
}
function resolveTarget(step) {
	if (!step) return null;
	const t = step.target;
	try {
		const el = typeof t === "function" ? t() : t ? document.querySelector(t) : null;
		if (el && el.getBoundingClientRect().width > 0) return el;
		return el || null;
	} catch {
		return null;
	}
}
function positionSpotlight(el) {
	if (!el) {
		spotlightEl.style.display = "none";
		return;
	}
	const r = el.getBoundingClientRect();
	if (r.width === 0 && r.height === 0) {
		spotlightEl.style.display = "none";
		return;
	}
	spotlightEl.style.display = "block";
	spotlightEl.style.left = r.left - 6 + "px";
	spotlightEl.style.top = r.top - 6 + "px";
	spotlightEl.style.width = r.width + 12 + "px";
	spotlightEl.style.height = r.height + 12 + "px";
}
function markSpotlit(el) {
	if (S.spotlitEl && S.spotlitEl !== el) S.spotlitEl.classList.remove("coach-spotlit");
	if (el) el.classList.add("coach-spotlit");
	S.spotlitEl = el || null;
}
function placeCard(el, position) {
	const m = 14;
	cardEl.style.visibility = "hidden";
	cardEl.style.display = "block";
	const cw = cardEl.offsetWidth, ch = cardEl.offsetHeight;
	let left, top;
	const r = el ? el.getBoundingClientRect() : null;
	if (!r || position === "center" || r.width === 0 && r.height === 0) {
		left = (window.innerWidth - cw) / 2;
		top = (window.innerHeight - ch) / 2;
	} else if (position === "bottom" || position === "bottom-start") {
		top = r.bottom + m;
		left = position === "bottom-start" ? r.left : r.left + r.width / 2 - cw / 2;
	} else if (position === "top") {
		top = r.top - ch - m;
		left = r.left + r.width / 2 - cw / 2;
	} else if (position === "left") {
		left = r.left - cw - m;
		top = r.top + r.height / 2 - ch / 2;
	} else {
		left = r.right + m;
		top = r.top + r.height / 2 - ch / 2;
	}
	left = Math.max(m, Math.min(left, window.innerWidth - cw - m));
	top = Math.max(m, Math.min(top, window.innerHeight - ch - m));
	cardEl.style.left = left + "px";
	cardEl.style.top = top + "px";
	cardEl.style.visibility = "visible";
}
var _repositionRaf = 0;
function reposition() {
	if (_repositionRaf) return;
	_repositionRaf = requestAnimationFrame(() => {
		_repositionRaf = 0;
		if (!S.active) return;
		positionSpotlight(S.target);
		if (S.cardMoved) return;
		placeCard(S.target, S.position);
	});
}
function autoPlace(el, position) {
	S.cardMoved = false;
	placeCard(el, position);
}
function show(el, on) {
	el.classList.toggle("coach-hidden", !on);
}
function renderStep(step, idx) {
	const total = S.steps.length;
	els.title.textContent = step.title || "AlgeBench";
	els.counter.textContent = `${idx + 1} / ${total}`;
	show(els.counter, true);
	els.body.textContent = step.narration || "";
	els.examples.innerHTML = "";
	const examples = chatAvailable() ? step.examplePrompts || [] : [];
	for (const ex of examples) {
		const chip = document.createElement("button");
		chip.className = "coach-chip";
		chip.textContent = ex;
		chip.addEventListener("click", () => engagePrompt(ex));
		els.examples.appendChild(chip);
	}
	show(els.examples, examples.length > 0);
	show(els.promptRow, chatAvailable());
	if (!chatAvailable() && examples.length === 0) {}
	show(els.foot, true);
	show(els.prev, true);
	els.prev.disabled = idx === 0;
	els.prev.onclick = () => gotoPrev();
	show(els.secondary, false);
	els.secondary.onclick = null;
	els.next.textContent = idx === total - 1 ? "Done ✓" : "Next ›";
	els.next.onclick = () => gotoNext();
}
function renderOffer({ title, message, primaryLabel, onPrimary, secondaryLabel, onSecondary }) {
	markSpotlit(null);
	els.title.textContent = title;
	show(els.counter, false);
	els.body.textContent = message;
	els.examples.innerHTML = "";
	show(els.examples, false);
	show(els.promptRow, false);
	show(els.foot, true);
	show(els.prev, false);
	show(els.secondary, !!secondaryLabel);
	els.secondary.textContent = secondaryLabel || "";
	els.secondary.onclick = onSecondary || null;
	els.next.textContent = primaryLabel;
	els.next.onclick = onPrimary;
}
var _repoOpts = {
	capture: true,
	passive: true
};
function attachReposition() {
	window.addEventListener("resize", reposition, _repoOpts);
	window.addEventListener("scroll", reposition, _repoOpts);
}
function detachReposition() {
	window.removeEventListener("resize", reposition, _repoOpts);
	window.removeEventListener("scroll", reposition, _repoOpts);
	if (_repositionRaf) {
		cancelAnimationFrame(_repositionRaf);
		_repositionRaf = 0;
	}
}
function openPlayer() {
	S.active = true;
	btnEl?.classList.add("active");
	cardEl.style.display = "block";
	attachReposition();
}
function closePlayer() {
	stopTTS();
	S.active = false;
	btnEl?.classList.remove("active");
	cardEl.style.display = "none";
	spotlightEl.style.display = "none";
	markSpotlit(null);
	detachReposition();
}
function dismiss() {
	ensureReady();
	_lsSet(LS.dismissed, "1");
	log("dismiss (will switch to once-a-day hints)");
	closePlayer();
}
async function showStep(i) {
	stopTTS();
	const step = S.steps[i];
	if (!step) {
		finish();
		return;
	}
	S.idx = i;
	log(`showStep ${i + 1}/${S.steps.length}: "${step.id}"`);
	if (typeof step.action === "function") {
		try {
			await step.action(buildCtx());
		} catch (e) {
			log(`step "${step.id}" action error:`, e);
		}
		await delay(120);
	}
	const el = resolveTarget(step);
	if (!el && step.optional) {
		log(`step "${step.id}" optional + no target → skip`);
		markComplete(step.id);
		const nxt = nextStepIdx(i);
		if (nxt >= 0) return showStep(nxt);
		return finish();
	}
	if (!el) log(`step "${step.id}" target not found → centered card, no spotlight`);
	S.target = el;
	S.position = step.position || "right";
	let narration = step.narration || "";
	if (S.justOpened) {
		S.justOpened = false;
		narration += REOPEN_TIP;
	}
	renderStep(step, i);
	if (narration !== step.narration) els.body.textContent = narration;
	positionSpotlight(el);
	markSpotlit(el);
	autoPlace(el, S.position);
	_lsSet(LS.position, step.id);
	speak(narration);
}
function gotoNext() {
	const step = S.steps[S.idx];
	if (step) markComplete(step.id);
	const next = nextStepIdx(S.idx);
	if (next < 0) {
		finish();
		return;
	}
	showStep(next);
}
function gotoPrev() {
	if (S.idx > 0) showStep(S.idx - 1);
}
function finish() {
	renderOffer({
		title: "You’re all set 🎉",
		message: "That’s the tour! Open it again anytime from the Tour button. Now explore — drag the 3D view, switch steps, and ask the AI anything.",
		primaryLabel: "Done",
		onPrimary: () => closePlayer()
	});
	spotlightEl.style.display = "none";
	autoPlace(null, "center");
	speak("That’s the tour! You’re all set. Now explore on your own, and ask the AI whenever you’re curious.");
}
function engagePrompt(text) {
	stopTTS();
	const step = S.steps[S.idx];
	const ok = handToChat(text, step?.examplePrompts);
	log("engagePrompt → main chat", {
		text,
		chatAvailable: ok
	});
	if (step) markComplete(step.id);
	markComplete("chat-window");
	markComplete("ask-math");
	renderOffer({
		title: "This is the main chat",
		message: ok ? "I’ve moved your question into the main AI chat on the right — keep the conversation going there. Ask about any step, symbol, or sub-expression; the AI sees exactly what’s on your screen." : "The AI chat lives on the right. It needs a Gemini API key to answer — once that’s set you can ask about any step, symbol, or sub-expression.",
		primaryLabel: "Got it",
		onPrimary: () => closePlayer()
	});
	spotlightEl.style.display = "none";
	autoPlace(document.getElementById("explanation-panel"), "left");
}
async function autoPickLesson() {
	try {
		const names = (await (await fetch("/api/scenes", { cache: "no-store" })).json()).scenes || [];
		if (!names.length) return false;
		const pick = [
			"artemis-ii-mission-simulation",
			"quantum-states",
			"atmospheric-entry-physics",
			"vector-operations"
		].find((p) => names.includes(p)) || names[0];
		log("autoPickLesson →", pick);
		return await loadBuiltinScene(pick);
	} catch (e) {
		log("autoPickLesson failed:", e);
		return false;
	}
}
async function openTour(startId) {
	ensureReady();
	log("openTour", {
		startId,
		hasScene: hasScene()
	});
	_lsSet(LS.dismissed, "0");
	if (!hasScene()) {
		await autoPickLesson();
		await delay(400);
	}
	S.steps = relevantSteps();
	log("openTour relevant steps:", S.steps.map((s) => s.id));
	if (!S.steps.length) {
		log("openTour: no relevant steps");
		return;
	}
	openPlayer();
	let start = 0;
	let explicit = false;
	if (startId) {
		const i = S.steps.findIndex((s) => s.id === startId);
		if (i >= 0) {
			start = i;
			explicit = true;
		}
	}
	const firstPending = firstPendingIdx();
	if ((!explicit || S.completed.has(S.steps[start].id)) && firstPending >= 0) {
		start = firstPending;
		S.seekIncomplete = true;
	} else S.seekIncomplete = false;
	S.justOpened = true;
	showStep(start);
}
function loadState() {
	if ((parseInt(_lsGet(LS.version, "0"), 10) || 0) < STEP_VERSION) _lsSet(LS.version, String(STEP_VERSION));
	const rawCompleted = _lsJSON(LS.completed, []);
	S.completed = new Set(Array.isArray(rawCompleted) ? rawCompleted : []);
	S.ttsOn = _lsGet(LS.tts, "1") !== "0";
	updateTTSIcon();
}
function showWelcome(firstTime) {
	openPlayer();
	spotlightEl.style.display = "none";
	const all = coach.get();
	const doneCount = all.filter((s) => S.completed.has(s.id)).length;
	if (firstTime) {
		renderOffer({
			title: "Welcome to AlgeBench 👋",
			message: "I’m your guide. In a quick tour I’ll show you how to browse interactive lessons, ask the AI anything, dive into the semantic graph of a proof, and play with the 3D viewport. Ready?",
			primaryLabel: "Start tour",
			onPrimary: () => openTour(),
			secondaryLabel: "Not now",
			onSecondary: () => closePlayer()
		});
		speak("Welcome to AlgeBench! I’m your guide. Let me give you a quick tour of what you can do here — from browsing lessons to asking the AI about the math.");
	} else {
		renderOffer({
			title: "Welcome back 👋",
			message: `Good to see you again. You’ve explored ${doneCount} of ${all.length} things so far — want to pick up where you left off?`,
			primaryLabel: "Continue",
			onPrimary: () => openTour(_lsGet(LS.position)),
			secondaryLabel: "Not now",
			onSecondary: () => closePlayer()
		});
		speak("Welcome back! Want to pick up the tour where you left off?");
	}
	autoPlace(null, "center");
}
function showDailyHint(step) {
	openPlayer();
	spotlightEl.style.display = "none";
	renderOffer({
		title: "A quick tip 💡",
		message: `There’s more to discover: ${step.title}. Want me to show you?`,
		primaryLabel: "Show me",
		onPrimary: () => openTour(step.id),
		secondaryLabel: "Not now",
		onSecondary: () => closePlayer()
	});
	autoPlace(null, "center");
}
function decide() {
	if (tourSkipped()) {
		log("decide: --skip-tour / ?skiptour set → no auto offer");
		return;
	}
	loadState();
	if (S.active) {
		log("decide: tour already active → skip auto offer");
		return;
	}
	const pending = pendingSteps();
	log("decide:", {
		firstVisit: _lsGet(LS.firstVisitDone) !== "1",
		dismissed: _lsGet(LS.dismissed) === "1",
		completed: [...S.completed],
		pending: pending.map((s) => s.id),
		lastHintDate: _lsGet(LS.lastHintDate),
		today: today()
	});
	if (_lsGet(LS.firstVisitDone) !== "1") {
		_lsSet(LS.firstVisitDone, "1");
		log("→ first visit: welcome offer");
		showWelcome(true);
		return;
	}
	if (pending.length === 0) {
		log("→ all steps complete: nothing automatic");
		return;
	}
	if (_lsGet(LS.dismissed) === "1") {
		if (_lsGet(LS.lastHintDate) !== today()) {
			_lsSet(LS.lastHintDate, today());
			log("→ daily hint:", pending[0].id);
			showDailyHint(pending[0]);
		} else log("→ dismissed + already hinted today: stay quiet");
		return;
	}
	log("→ returning, not dismissed: welcome back");
	showWelcome(false);
}
function resolveStepId(step) {
	if (step == null || step === "") return void 0;
	const all = coach.get();
	const n = Number(step);
	if (Number.isFinite(n) && String(step).trim() !== "" && !/[a-z]/i.test(String(step))) {
		const i = Math.max(0, Math.min(all.length - 1, Math.round(n) - 1));
		return all[i] && all[i].id;
	}
	const key = String(step).toLowerCase().trim();
	let s = all.find((x) => x.id.toLowerCase() === key);
	if (!s) s = all.find((x) => x.id.toLowerCase().includes(key) || (x.title || "").toLowerCase().includes(key));
	return s && s.id;
}
function coachStatus() {
	const all = coach.get();
	return {
		active: S.active,
		currentStepId: S.active && S.steps[S.idx] ? S.steps[S.idx].id : null,
		currentStepNumber: S.active ? S.idx + 1 : null,
		total: all.length,
		completed: [...S.completed],
		remaining: all.filter((s) => !S.completed.has(s.id)).map((s) => s.id),
		dismissed: _lsGet(LS.dismissed) === "1",
		narration: S.ttsOn ? "on" : "off",
		steps: all.map((s) => ({
			id: s.id,
			title: s.title
		}))
	};
}
function coachControl(action, opts = {}) {
	ensureReady();
	action = String(action || "").toLowerCase().trim();
	const step = opts.step;
	log("control_coach", {
		action,
		step
	});
	switch (action) {
		case "start":
		case "activate":
		case "open":
		case "resume":
		case "show":
			openTour(resolveStepId(step));
			return {
				ok: true,
				action,
				status: coachStatus()
			};
		case "goto":
		case "step":
		case "jump": {
			const id = resolveStepId(step);
			if (!id) return {
				ok: false,
				action,
				error: `No step matches "${step}".`,
				status: coachStatus()
			};
			openTour(id);
			return {
				ok: true,
				action,
				stepId: id,
				status: coachStatus()
			};
		}
		case "next":
			if (S.active) gotoNext();
			else openTour();
			return {
				ok: true,
				action,
				status: coachStatus()
			};
		case "prev":
		case "back":
			if (S.active) gotoPrev();
			else openTour();
			return {
				ok: true,
				action,
				status: coachStatus()
			};
		case "stop":
		case "deactivate":
		case "close":
		case "dismiss":
		case "hide":
			dismiss();
			return {
				ok: true,
				action,
				status: coachStatus()
			};
		case "reset":
		case "restart":
			window.AlgeBenchCoach.engine.reset();
			_lsSet(LS.dismissed, "0");
			openTour();
			return {
				ok: true,
				action,
				status: coachStatus()
			};
		case "status":
		case "info":
		case "": return {
			ok: true,
			action: "status",
			status: coachStatus()
		};
		default: return {
			ok: false,
			action,
			error: `Unknown action "${action}".`,
			status: coachStatus()
		};
	}
}
var _ready = false;
function ensureReady() {
	if (_ready) return;
	_ready = true;
	initDebug();
	injectCSS();
	buildButton();
	buildLayer();
	loadState();
	setupAudioUnlock();
}
function init() {
	ensureReady();
	log("init (debug logging on)");
	try {
		decide();
	} catch (e) {
		console.error("[coach] init failed:", e);
	}
	updateDot();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
window.AlgeBenchCoach.engine = {
	openTour,
	dismiss,
	control: coachControl,
	status: coachStatus,
	state: () => ({
		...S,
		completed: [...S.completed]
	}),
	setDebug(on) {
		DEBUG = !!on;
		_lsSet(LS.debug, on ? "1" : "0");
		log("debug logging", on ? "enabled" : "disabled");
	},
	reset() {
		[
			LS.completed,
			LS.position,
			LS.dismissed,
			LS.lastHintDate,
			LS.firstVisitDone,
			LS.version
		].forEach((k) => {
			try {
				localStorage.removeItem(k);
			} catch {}
		});
		S.completed = /* @__PURE__ */ new Set();
		log("reset tour progress");
	}
};
//#endregion

//# sourceMappingURL=index.js.map