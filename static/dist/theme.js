//#region src/icons.ts
/** { } View proof JSON. */
var BRACES_ICON = "<svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1\"/><path d=\"M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1\"/></svg>";
/** < > Get embed script. */
var CODE_ICON = "<svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M8 6l-6 6 6 6\"/><path d=\"M16 6l6 6-6 6\"/></svg>";
/** ⛶ Open full screen (the embedded proof's pop-out control). */
var FULLSCREEN_ICON = "<svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3\"/></svg>";
/** AI — a bot/assistant head, for marking AI (chat) messages. Stroke outline in
*  the same 14×14 style as the toolbar icons; eyes + antenna tip are filled dots. */
var AI_ICON = "<svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"4.5\" y=\"7\" width=\"15\" height=\"12\" rx=\"3\"/><path d=\"M12 3v4\"/><circle cx=\"12\" cy=\"3\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"9.5\" cy=\"13\" r=\"1.2\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"14.5\" cy=\"13\" r=\"1.2\" fill=\"currentColor\" stroke=\"none\"/></svg>";
/** Function Analysis — x/y axes with a curve settling onto a dashed
*  asymptote: "study this function's behavior", deliberately distinct from
*  the chart button's plain plotted line. Used for the semantic-graph
*  node's button, the Math-tree artifact rows, and the analysis page.
*  The D3 node button mirrors this shape with SVG primitives (see
*  d3-semantic-graph.js _appendFaBtn) since it draws inside an <svg>. */
var FUNCTION_ANALYSIS_ICON = "<svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4 3v17h17\"/><path d=\"M4 17.5h17\" stroke-dasharray=\"2 2.5\" opacity=\"0.75\"/><path d=\"M7.5 5.5c0 7.5 3.5 11 12.5 11.7\" stroke-width=\"1.9\"/></svg>";
/** Trash — for discarding a generated artifact (e.g. a Function Analysis
*  page). Same 24×24 stroke style as the toolbar set. */
var TRASH_ICON = "<svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4 7h16M10 4h4M9 7v12M15 7v12M6 7l1 13h10l1-13\"/></svg>";
/** User — a filled person silhouette, for marking the user's (chat) messages. */
var USER_ICON = "<svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"currentColor\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z\"/></svg>";
/** Angle-lock toggle for the follow camera (a looping arrow). */
var ANGLE_LOCK_ICON = "<svg viewBox=\"0 0 24 24\" width=\"17\" height=\"17\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M14.22 5.89A6.5 6.5 0 1 1 9.78 5.89\"/><path d=\"M6.98 5.89 9.78 5.89 8.56 8.41\"/></svg>";
/** Share this exact view (an eye) — copies a camera-anchored deep link. */
var SHARE_VIEW_ICON = "<svg viewBox=\"0 0 24 24\" width=\"17\" height=\"17\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M2 12C5 6.5 19 6.5 22 12C19 17.5 5 17.5 2 12Z\"/><circle cx=\"12\" cy=\"12\" r=\"3.6\"/><circle cx=\"12\" cy=\"12\" r=\"1.4\" fill=\"currentColor\" stroke=\"none\"/></svg>";
/** ⚙ Display settings (a cog). */
var GEAR_ICON = "<svg viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"3.2\"/><path d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z\"/></svg>";
/** ‹ Previous (chevron-left) — one step back. */
var PREV_ICON = "<svg viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M14.5 5l-7 7 7 7\"/></svg>";
/** › Next (chevron-right) — one step forward. */
var NEXT_ICON = "<svg viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M9.5 5l7 7-7 7\"/></svg>";
/** ▶ Play (a filled triangle). */
var PLAY_ICON = "<svg viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M7 5l12 7-12 7z\"/></svg>";
/** ⏸ Pause (two filled bars). */
var PAUSE_ICON = "<svg viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" fill=\"currentColor\" aria-hidden=\"true\"><rect x=\"6.5\" y=\"5\" width=\"3.5\" height=\"14\" rx=\"1\"/><rect x=\"14\" y=\"5\" width=\"3.5\" height=\"14\" rx=\"1\"/></svg>";
/** |‹ First (skip to start) — a bar + a left triangle. */
var FIRST_ICON = "<svg viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" fill=\"currentColor\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M18 6l-8 6 8 6z\" stroke=\"none\"/><path d=\"M7 6v12\" fill=\"none\"/></svg>";
/** ›| Last (skip to end) — a right triangle + a bar. */
var LAST_ICON = "<svg viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" fill=\"currentColor\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M6 6l8 6-8 6z\" stroke=\"none\"/><path d=\"M17 6v12\" fill=\"none\"/></svg>";
//#endregion
//#region src/proof-animation/proof-animation.ts
var EASE = "cubic-bezier(0.42, 0, 0.58, 1)";
var DECORATIONS = [".frac-line", ".sqrt svg"];
var PAREN_RE = /^[()[\]|]$/;
var _parenChar = (s) => {
	const t = (s || "").replace(/[​-‍﻿]/g, "").trim();
	return PAREN_RE.test(t) ? t : null;
};
var SPEEDS = [
	.25,
	.5,
	1,
	2,
	4
];
var TIER_GLYPH = {
	grounded: "★",
	verified: "✓",
	domain: "✦",
	plausible: "◇",
	unchecked: "○",
	refuted: "✗"
};
var _tierGlyph = (tier, fallback) => TIER_GLYPH[tier] || fallback || "";
var INFO_ICON = "<svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v5M12 7.5h.01\"/></svg>";
var GOAL_ICON = "<svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><circle cx=\"12\" cy=\"12\" r=\"5\"/><circle cx=\"12\" cy=\"12\" r=\"1.4\" fill=\"currentColor\" stroke=\"none\"/></svg>";
var AI_SPARKLE_SVG = "<svg viewBox=\"0 0 16 16\" fill=\"currentColor\" width=\"11\" height=\"11\" aria-hidden=\"true\"><path d=\"M8 1c0 4-3 6.5-7 7 4 .5 7 3 7 7 0-4 3-6.5 7-7-4-.5-7-3-7-7z\"/></svg>";
var FUNCTION_ANALYSIS_SVG = "<svg viewBox=\"0 0 24 24\" width=\"12\" height=\"12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4 3v17h17\"/><path d=\"M4 17.5h17\" stroke-dasharray=\"2 2.5\" opacity=\"0.75\"/><path d=\"M7.5 5.5c0 7.5 3.5 11 12.5 11.7\" stroke-width=\"1.9\"/></svg>";
var _SPANNING_OP = /^(?:multiply|add|subtract|plus|minus|equals|not_equal|less_than|greater_than|less_equal|greater_equal|implies|iff|conjunction|disjunction)_\d+$/;
function _isSpanningWrapperId(id) {
	if (!id) return false;
	const core = id.replace(/^(?:_r\d+_|d\d+_)+/, "").replace(/^_+/, "");
	return _SPANNING_OP.test(core);
}
var _CAPTION_RE = /(\$[^$]+\$|`[^`]+`|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g;
var _speedLabel = (s) => ({
	.25: "¼×",
	.5: "½×"
})[s] || `${s}×`;
var ProofAnimator = class {
	constructor(container, data, opts = {}) {
		this._onVisibility = null;
		this._onStageMove = null;
		this._onStageLeave = null;
		this._onStageClick = null;
		this._onDocExplore = null;
		this._errChipCleanup = null;
		this._termTip = null;
		this._mathTip = null;
		this._mathTipFor = null;
		this._goalPop = null;
		this._explorePop = null;
		this.container = container;
		this.data = data;
		this.katex = opts.katex || typeof window !== "undefined" && window.katex;
		if (!this.katex) throw new Error("ProofAnimator: KaTeX not available");
		this._aiAsk = opts.aiAskButton || null;
		this._nextAskBtn = null;
		this._enableTermAsk = !!opts.enableTermAsk;
		this._onTermAsk = typeof opts.onTermAsk === "function" ? opts.onTermAsk : null;
		this._onBuildTermAskMessage = typeof opts.onBuildTermAskMessage === "function" ? opts.onBuildTermAskMessage : null;
		this._askSel = [];
		this._termAskBtnEl = null;
		this._askBtnFocus = null;
		this._askBtnHideTimer = null;
		this._askBtnFadeTimer = null;
		this._askBtnRelocateTimer = null;
		this._askBtnRelocateEl = null;
		this._stepAskBtnEl = null;
		this._stepAskIdx = null;
		this._stepAskHideTimer = null;
		this._stepAskFadeTimer = null;
		if (!this._aiAsk && this._enableTermAsk) this._aiAsk = (cls, title, getMessage, getIdx) => this._makeRoutedAskButton(cls, title, getMessage, getIdx);
		this._deriveBtnFactory = typeof opts.deriveButton === "function" ? opts.deriveButton : null;
		this._onDerive = typeof opts.onDerive === "function" ? opts.onDerive : null;
		this._onFunctionAnalysis = typeof opts.onFunctionAnalysis === "function" ? opts.onFunctionAnalysis : null;
		this._faBtnEl = null;
		this._onExplore = typeof opts.onExplore === "function" ? opts.onExplore : null;
		this._enableExplore = !!opts.enableExplore;
		this._askOrigin = null;
		if (typeof opts.askOrigin === "string" && opts.askOrigin) try {
			this._askOrigin = new URL(opts.askOrigin).origin;
		} catch (e) {}
		this._paId = typeof opts.paId === "string" && opts.paId ? opts.paId : null;
		this._deriveBtnEl = null;
		this._onRelayout = typeof opts.onRelayout === "function" ? opts.onRelayout : null;
		this._liveTerms = !!opts.liveTerms;
		this._onTermHover = typeof opts.onTermHover === "function" ? opts.onTermHover : null;
		this._onTermClick = typeof opts.onTermClick === "function" ? opts.onTermClick : null;
		this._onAfterRender = typeof opts.onAfterRender === "function" ? opts.onAfterRender : null;
		this._onTermBackgroundClick = typeof opts.onTermBackgroundClick === "function" ? opts.onTermBackgroundClick : null;
		this._hotTermEl = null;
		this._fitHeight = !!opts.fitHeight;
		this.mode = opts.mode || "parallel";
		this.stacked = !!opts.stacked;
		this._linesEl = null;
		this._baseDuration = opts.duration ?? 650;
		this._baseStagger = opts.staggerMs ?? 200;
		this._baseStepPause = opts.stepPause ?? 1e3;
		this._speedIdx = SPEEDS.indexOf(opts.speed ?? 1);
		if (this._speedIdx < 0) this._speedIdx = SPEEDS.indexOf(1);
		this.current = Math.max(0, Math.min(Number.isFinite(opts.startStep) ? Math.floor(opts.startStep) : 0, (this.data.steps ? this.data.steps.length : 1) - 1));
		this._running = [];
		this._ghosts = [];
		this._token = null;
		this._playId = null;
		this._paused = false;
		this._pauseGate = null;
		this._pauseOpen = null;
		this._destroyed = false;
		this._ro = null;
		this._applySpeed();
		this._build();
		this._baseFontPx = parseFloat(getComputedStyle(this.stage).fontSize) || 30;
		this._fixMetaSize();
		this._fit();
		this._renderStage();
		this._syncUI();
		this._capOverflow();
		this._fitControls();
		this._observeResize();
		this._bindLiveTerms();
		if (typeof document !== "undefined" && document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
			if (!this._destroyed) this._relayout();
		});
	}
	_fixMetaSize() {
		const meta = this.container.querySelector(".pa-meta");
		if (!meta) return;
		const probe = document.createElement("div");
		probe.className = "pa-meta";
		probe.style.cssText = `position:absolute; visibility:hidden; left:-9999px; top:0; width:${meta.clientWidth}px;`;
		const op = document.createElement("span");
		op.className = "pa-op";
		const just = document.createElement("span");
		just.className = "pa-just";
		const next = document.createElement("span");
		next.className = "pa-next-pill";
		const opHost = document.createElement("div");
		opHost.className = "pa-op-row";
		opHost.append(op);
		const badge = document.createElement("span");
		badge.className = "pa-conf-badge";
		badge.style.display = "inline-flex";
		opHost.append(badge);
		if (this._aiAsk) {
			probe.classList.add("pa-has-ask");
			next.classList.add("pa-has-ask");
			const ask = document.createElement("span");
			ask.className = "pa-ask-btn pa-ask-current";
			opHost.append(ask);
		}
		if (this._deriveBtnFactory && this._onDerive) {
			probe.classList.add("pa-has-ask");
			const der = document.createElement("span");
			der.className = "pa-ask-btn pa-derive-btn";
			opHost.append(der);
		}
		if (this._aiAsk) {
			const fa = document.createElement("span");
			fa.className = "pa-ask-btn pa-fa-btn";
			opHost.append(fa);
		}
		probe.append(opHost, just, next);
		this.container.appendChild(probe);
		let h = 0;
		this.data.steps.forEach((s, i) => {
			this._caption(op, this._opText(i));
			this._setConfBadge(i, badge);
			this._caption(just, s.justification || "");
			this._setNextPill(next, i);
			h = Math.max(h, probe.getBoundingClientRect().height);
		});
		probe.remove();
		if (h > 0) {
			const px = Math.ceil(h) + "px";
			meta.style.height = px;
			meta.style.minHeight = px;
		}
	}
	_fit() {
		const probe = document.createElement("span");
		probe.style.cssText = `position:absolute; visibility:hidden; left:-9999px; top:0; white-space:nowrap; font-size:${this._baseFontPx}px;`;
		this.stage.appendChild(probe);
		let w = 0, h = 0;
		for (const step of this.data.steps) {
			this._renderInto(probe, step.latex);
			const r = probe.getBoundingClientRect();
			w = Math.max(w, r.width);
			h = Math.max(h, r.height);
		}
		probe.remove();
		if (w <= 0 || h <= 0) return;
		this._maxExprW = w;
		const gutter = this.stacked ? this._lineGutterW() : 0;
		const availW = Math.max(40, this.stage.clientWidth - 16 - gutter);
		let scale = Math.min(1, availW / w);
		if (this._fitHeight) {
			const availH = Math.max(20, this.stage.clientHeight - 16);
			scale = Math.min(scale, availH / h);
		} else if (this.stacked) this.stage.style.height = "";
		else this.stage.style.height = `${Math.ceil(h * scale + 8)}px`;
		this.stage.style.fontSize = `${this._baseFontPx * scale}px`;
		this.stage.style.setProperty("--pa-expr-w", `${Math.ceil(w * scale)}px`);
	}
	_capOverflow() {
		this._capOverflowImpl();
		if (this._enableTermAsk && !this._onTermClick) try {
			this._applyAskClasses();
		} catch (e) {}
		if (this._onAfterRender) try {
			this._onAfterRender();
		} catch (e) {}
	}
	_capOverflowImpl() {
		if (this.stacked) return this._capOverflowStacked();
		const expr = this.stage.querySelector(".pa-expr");
		if (!expr) return;
		const k = expr.querySelector(".katex-display") || expr.querySelector(".katex");
		if (!k) return;
		const availW = Math.max(40, this.stage.clientWidth - 16);
		const r = k.getBoundingClientRect();
		let ratio = r.width > availW + .5 ? availW / r.width : 1;
		if (this._fitHeight) {
			const availH = Math.max(20, this.stage.clientHeight - 16);
			if (r.height > availH + .5) ratio = Math.min(ratio, availH / r.height);
		}
		if (ratio < 1) {
			const cur = parseFloat(getComputedStyle(this.stage).fontSize) || this._baseFontPx;
			this.stage.style.fontSize = `${cur * ratio}px`;
			this.stage.style.setProperty("--pa-expr-w", `${Math.ceil(r.width * ratio)}px`);
		}
	}
	_lineGutterW() {
		const cs = getComputedStyle(this.container);
		return (parseFloat(cs.getPropertyValue("--pa-pill-w")) || 26) + (parseFloat(cs.getPropertyValue("--pa-pill-gap")) || 16);
	}
	_capOverflowStacked() {
		if (!this._linesEl) return;
		const availW = Math.max(40, this.stage.clientWidth - 16 - this._lineGutterW());
		let ratio = 1, maxW = 0;
		for (const line of this._linesEl.children) {
			const k = line.querySelector(".katex-display") || line.querySelector(".katex");
			if (!k) continue;
			const w = k.getBoundingClientRect().width;
			maxW = Math.max(maxW, w);
			if (w > availW + .5) ratio = Math.min(ratio, availW / w);
		}
		if (ratio < 1) {
			const cur = parseFloat(getComputedStyle(this.stage).fontSize) || this._baseFontPx;
			this.stage.style.fontSize = `${cur * ratio}px`;
			this.stage.style.setProperty("--pa-expr-w", `${Math.ceil(maxW * ratio)}px`);
		}
	}
	_observeResize() {
		if (this._ro || typeof ResizeObserver === "undefined") return;
		this._lastFitW = this.container.clientWidth;
		this._lastFitH = this.container.clientHeight;
		this._ro = new ResizeObserver(() => {
			if (this._destroyed) return;
			this._repositionPopups();
			const w = this.container.clientWidth;
			const h = this.container.clientHeight;
			const widthChanged = Math.abs(w - this._lastFitW) >= 1;
			const heightChanged = this._fitHeight && Math.abs(h - this._lastFitH) >= 1;
			if (!widthChanged && !heightChanged) return;
			this._lastFitW = w;
			this._lastFitH = h;
			if (this._raf || typeof requestAnimationFrame === "undefined") {
				if (typeof requestAnimationFrame === "undefined") this._relayout();
				return;
			}
			this._raf = requestAnimationFrame(() => {
				this._raf = 0;
				if (!this._destroyed) this._relayout();
			});
		});
		this._ro.observe(this.container);
		if (typeof document !== "undefined") {
			this._onVisibility = () => {
				if (document.hidden && this._running.length) {
					this._cancel();
					this._renderStage();
					this._capOverflow();
					this._syncUI();
				}
			};
			document.addEventListener("visibilitychange", this._onVisibility);
		}
	}
	_relayout() {
		this._cancel();
		this._fixMetaSize();
		this._fit();
		this._renderStage();
		this._capOverflow();
		this._fitControls();
		this._updateNextTip();
		if (this._onRelayout) try {
			this._onRelayout();
		} catch (e) {}
	}
	destroy() {
		this._destroyed = true;
		this._cancel();
		if (this._raf && typeof cancelAnimationFrame !== "undefined") {
			cancelAnimationFrame(this._raf);
			this._raf = 0;
		}
		if (this._ro) {
			try {
				this._ro.disconnect();
			} catch (e) {}
			this._ro = null;
		}
		if (this._onVisibility) {
			try {
				document.removeEventListener("visibilitychange", this._onVisibility);
			} catch (e) {}
			this._onVisibility = null;
		}
		if (this._onDocExplore) {
			try {
				document.removeEventListener("mousedown", this._onDocExplore, true);
			} catch (e) {}
			this._onDocExplore = null;
		}
		if (this.stage && this._onStageMove) {
			this.stage.removeEventListener("mousemove", this._onStageMove);
			this.stage.removeEventListener("mouseleave", this._onStageLeave);
			this.stage.removeEventListener("click", this._onStageClick);
			this._onStageMove = this._onStageLeave = this._onStageClick = null;
		}
		if (this._errChipCleanup) this._errChipCleanup();
		if (this._askBtnHideTimer) {
			clearTimeout(this._askBtnHideTimer);
			this._askBtnHideTimer = null;
		}
		if (this._askBtnFadeTimer) {
			clearTimeout(this._askBtnFadeTimer);
			this._askBtnFadeTimer = null;
		}
		if (this._askBtnRelocateTimer) {
			clearTimeout(this._askBtnRelocateTimer);
			this._askBtnRelocateTimer = null;
		}
		if (this._stepAskHideTimer) {
			clearTimeout(this._stepAskHideTimer);
			this._stepAskHideTimer = null;
		}
		if (this._stepAskFadeTimer) {
			clearTimeout(this._stepAskFadeTimer);
			this._stepAskFadeTimer = null;
		}
		for (const k of [
			"_termTip",
			"_mathTip",
			"_goalPop",
			"_explorePop",
			"_termAskBtnEl",
			"_stepAskBtnEl"
		]) {
			const el = this[k];
			if (el && el.parentNode) el.parentNode.removeChild(el);
			this[k] = null;
		}
		if (this._onTermHover) try {
			this._onTermHover([], null);
		} catch (e) {}
	}
	_bindLiveTerms() {
		if (!this._liveTerms || !this.stage) return;
		this.container.classList.add("pa-live-terms");
		const tagOf = (t, x, y) => {
			const target = t;
			const el = target && target.closest ? target.closest("[data-n]") : null;
			if (!el || !this._liveRoot().contains(el)) return null;
			if (el.querySelector("[data-n]")) {
				if (x == null) return null;
				const leaf = this._nearestLeafTerm(el, x, y);
				if (leaf) return leaf;
				return _isSpanningWrapperId(el.getAttribute("data-n")) ? null : el;
			}
			return el;
		};
		this._onStageMove = (ev) => {
			const el = tagOf(ev.target, ev.clientX, ev.clientY);
			if (el && el !== this._hotTermEl) this._setHotTerm(el);
			else if (!el && this._enableTermAsk) this._cancelAskBtnRelocate();
		};
		this._onStageLeave = () => this._setHotTerm(null);
		this._onStageClick = (ev) => {
			const el = tagOf(ev.target, ev.clientX, ev.clientY);
			if (!el) {
				if (this._onTermBackgroundClick) this._onTermBackgroundClick();
				else if (this._enableTermAsk && !this._onTermClick) this._clearAskSel();
				return;
			}
			const additive = !!(ev.metaKey || ev.ctrlKey);
			if (this._onTermClick) this._onTermClick(this._termChain(el), el, { additive });
			else if (this._enableTermAsk) this._toggleAskTerm(el, additive);
		};
		this.stage.addEventListener("mousemove", this._onStageMove);
		this.stage.addEventListener("mouseleave", this._onStageLeave);
		this.stage.addEventListener("click", this._onStageClick);
	}
	_setHotTerm(el) {
		if (this._hotTermEl && this._hotTermEl !== el) this._hotTermEl.classList.remove("pa-term-hot");
		this._hotTermEl = el || null;
		if (el) el.classList.add("pa-term-hot");
		const chain = el ? this._termChain(el) : [];
		const desc = this._termDescription(chain);
		if (el && desc) this._showTermTip(el, desc);
		else this._hideTermTip();
		if (this._enableTermAsk) {
			if (el) this._requestTermAskBtn(el);
			else {
				this._cancelAskBtnRelocate();
				this._scheduleHideTermAskBtn();
			}
		}
		if (this._onTermHover) this._onTermHover(chain, el || null);
	}
	_termDescription(chain) {
		const terms = this.data && this.data.terms;
		if (!terms) return "";
		for (const c of chain || []) {
			const raw = c.id || "";
			const clean = raw.replace(/^_r\d+_/, "");
			const t = terms[raw] || terms[clean] || terms[clean.split("__")[0]];
			const d = t && (t.description || "").trim();
			if (d) return d;
		}
		return "";
	}
	_showTermTip(anchorEl, text) {
		let tip = this._termTip;
		if (!tip) {
			tip = document.createElement("div");
			tip.className = "pa-term-tip";
			tip.setAttribute("role", "tooltip");
			document.body.appendChild(tip);
			this._termTip = tip;
		}
		this._caption(tip, text);
		tip.style.display = "block";
		tip.style.visibility = "hidden";
		const r = anchorEl.getBoundingClientRect();
		const vh = window.innerHeight;
		const tw = tip.offsetWidth, th = tip.offsetHeight, GAP = 10;
		let left = r.left + r.width / 2 - tw / 2;
		left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
		let below = (r.top + r.bottom) / 2 > vh / 2;
		if (below && r.bottom + GAP + th > vh - 4) below = false;
		else if (!below && r.top - GAP - th < 4) below = true;
		const top = below ? r.bottom + GAP : r.top - th - GAP;
		tip.classList.toggle("pa-term-tip-below", below);
		tip.style.left = `${Math.round(left)}px`;
		tip.style.top = `${Math.round(Math.max(4, top))}px`;
		tip.style.visibility = "visible";
	}
	_hideTermTip() {
		if (this._termTip) this._termTip.style.display = "none";
	}
	_termChain(el) {
		const out = [];
		for (let n = el; n && this.stage.contains(n); n = n.parentElement) if (n.nodeType === 1 && n.hasAttribute && n.hasAttribute("data-n")) {
			const id = n.getAttribute("data-n");
			if (n !== el && _isSpanningWrapperId(id)) break;
			out.push({
				id,
				text: n.textContent || ""
			});
		}
		return out;
	}
	_nearestLeafTerm(wrapper, x, y) {
		let best = null, bestD = Infinity;
		for (const leaf of wrapper.querySelectorAll("[data-n]")) {
			if (leaf.querySelector("[data-n]")) continue;
			const r = leaf.getBoundingClientRect();
			if (!r.width || !r.height) continue;
			const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
			const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
			const d = dx * dx + dy * dy;
			if (d < bestD) {
				bestD = d;
				best = leaf;
			}
		}
		return best && bestD <= 196 ? best : null;
	}
	_apprKey(text) {
		const k = (text || "").replace(/[\s\u200B-\u200F\u2060\uFEFF]/g, "");
		return !k || /^[\d.,/+\-]+$/.test(k) ? "" : k;
	}
	_toggleAskTerm(el, additive) {
		const chain = this._termChain(el);
		const text = chain[0] && chain[0].text || el.textContent || "";
		const key = this._apprKey(text);
		if (!key) return;
		if (additive) {
			const at = this._askSel.findIndex((s) => s.key === key);
			if (at >= 0) this._askSel.splice(at, 1);
			else this._askSel.push({
				key,
				chain,
				text,
				desc: this._termDescription(chain)
			});
		} else this._askSel = [{
			key,
			chain,
			text,
			desc: this._termDescription(chain)
		}];
		this._applyAskClasses();
	}
	_clearAskSel() {
		if (!this._askSel.length) return;
		this._askSel = [];
		this._applyAskClasses();
	}
	_applyAskClasses() {
		const expr = this._exprEl();
		if (!expr) return;
		if (this.stacked && this._linesEl) {
			for (const node of this._linesEl.querySelectorAll(".pa-term-ask")) if (!expr.contains(node)) node.classList.remove("pa-term-ask");
		}
		const keys = new Set(this._askSel.map((s) => s.key));
		for (const node of expr.querySelectorAll("[data-n]")) {
			const k = this._apprKey(node.textContent || "");
			node.classList.toggle("pa-term-ask", !!k && keys.has(k));
		}
	}
	_buildTermAskButton() {
		if (!this._enableTermAsk) return;
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "pa-term-ask-btn";
		btn.innerHTML = AI_SPARKLE_SVG;
		btn.title = "Ask AI about this term";
		btn.setAttribute("aria-label", "Ask AI about this term");
		btn.style.position = "fixed";
		btn.style.opacity = "0";
		btn.style.pointerEvents = "none";
		btn.tabIndex = -1;
		btn.setAttribute("aria-hidden", "true");
		btn.style.zIndex = "10001";
		btn.addEventListener("mouseenter", () => {
			if (this._askBtnHideTimer) {
				clearTimeout(this._askBtnHideTimer);
				this._askBtnHideTimer = null;
			}
			this._cancelAskBtnRelocate();
		});
		btn.addEventListener("mouseleave", () => this._scheduleHideTermAskBtn());
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			this._termAskClick();
		});
		document.body.appendChild(btn);
		this._termAskBtnEl = btn;
	}
	_requestTermAskBtn(el) {
		const btn = this._termAskBtnEl;
		if (!(btn && btn.style.opacity === "1") || !this._askBtnFocus || this._askBtnFocus.el === el) {
			this._cancelAskBtnRelocate();
			this._showTermAskBtn(el);
			return;
		}
		if (this._askBtnRelocateEl === el) return;
		this._cancelAskBtnRelocate();
		this._askBtnRelocateEl = el;
		this._askBtnRelocateTimer = setTimeout(() => {
			this._askBtnRelocateTimer = null;
			this._askBtnRelocateEl = null;
			this._showTermAskBtn(el);
		}, 150);
	}
	_cancelAskBtnRelocate() {
		if (this._askBtnRelocateTimer) {
			clearTimeout(this._askBtnRelocateTimer);
			this._askBtnRelocateTimer = null;
		}
		this._askBtnRelocateEl = null;
	}
	_showTermAskBtn(el) {
		const btn = this._termAskBtnEl;
		if (!btn || !el) return;
		if (this._askBtnHideTimer) {
			clearTimeout(this._askBtnHideTimer);
			this._askBtnHideTimer = null;
		}
		const chain = this._termChain(el);
		this._askBtnFocus = {
			el,
			chain,
			text: chain[0] && chain[0].text || el.textContent || "",
			desc: this._termDescription(chain)
		};
		const r = el.getBoundingClientRect();
		const bRect = btn.getBoundingClientRect();
		const bw = bRect.width || btn.offsetWidth || 22;
		const bh = bRect.height || btn.offsetHeight || 22;
		const shift = r.height * 2 / 9;
		let left = r.right - bw / 3 + shift;
		let top = r.top - bh * (2 / 3) - shift;
		if (top < 4) top = r.bottom - bh / 3;
		left = Math.max(4, Math.min(left, window.innerWidth - bw - 4));
		top = Math.max(4, Math.min(top, window.innerHeight - bh - 4));
		btn.style.left = `${Math.round(left)}px`;
		btn.style.top = `${Math.round(top)}px`;
		btn.style.opacity = "1";
		btn.style.pointerEvents = "auto";
		btn.tabIndex = 0;
		btn.removeAttribute("aria-hidden");
	}
	_scheduleHideTermAskBtn() {
		if (!this._termAskBtnEl) return;
		if (this._askBtnHideTimer) clearTimeout(this._askBtnHideTimer);
		this._askBtnHideTimer = setTimeout(() => this._hideTermAskBtn(), 600);
	}
	_hideTermAskBtn() {
		if (this._askBtnHideTimer) {
			clearTimeout(this._askBtnHideTimer);
			this._askBtnHideTimer = null;
		}
		this._cancelAskBtnRelocate();
		const btn = this._termAskBtnEl;
		if (!btn) return;
		btn.style.opacity = "0";
		btn.tabIndex = -1;
		btn.setAttribute("aria-hidden", "true");
		if (this._askBtnFadeTimer) clearTimeout(this._askBtnFadeTimer);
		this._askBtnFadeTimer = setTimeout(() => {
			if (btn.style.opacity === "0") btn.style.pointerEvents = "none";
		}, 200);
	}
	_buildStepAskButton() {
		if (!this._aiAsk || this._stepAskBtnEl) return;
		const btn = this._aiAsk("pa-term-ask-btn pa-step-ask-btn", "Ask AI about this step", () => this._stepAskIdx == null ? null : this._askStepMessage(this._stepAskIdx), () => this._stepAskIdx == null ? this.current : this._stepAskIdx);
		btn.style.position = "fixed";
		btn.style.opacity = "0";
		btn.style.pointerEvents = "none";
		btn.tabIndex = -1;
		btn.setAttribute("aria-hidden", "true");
		btn.style.zIndex = "10001";
		btn.addEventListener("mouseenter", () => {
			if (this._stepAskHideTimer) {
				clearTimeout(this._stepAskHideTimer);
				this._stepAskHideTimer = null;
			}
		});
		btn.addEventListener("mouseleave", () => this._scheduleHideStepAskBtn());
		btn.addEventListener("click", () => this._hideStepAskBtn());
		document.body.appendChild(btn);
		this._stepAskBtnEl = btn;
	}
	_showStepAskBtn(pill, idx) {
		const btn = this._stepAskBtnEl;
		if (!btn) return;
		if (this._stepAskHideTimer) {
			clearTimeout(this._stepAskHideTimer);
			this._stepAskHideTimer = null;
		}
		this._stepAskIdx = idx;
		const r = pill.getBoundingClientRect();
		const bw = btn.offsetWidth || 22;
		const bh = btn.offsetHeight || 22;
		let left = r.right - bw / 3;
		let top = r.top - bh * (2 / 3);
		if (top < 4) top = r.bottom - bh / 3;
		left = Math.max(4, Math.min(left, window.innerWidth - bw - 4));
		top = Math.max(4, Math.min(top, window.innerHeight - bh - 4));
		btn.style.left = `${Math.round(left)}px`;
		btn.style.top = `${Math.round(top)}px`;
		btn.style.opacity = "1";
		btn.style.pointerEvents = "auto";
		btn.tabIndex = 0;
		btn.removeAttribute("aria-hidden");
	}
	_scheduleHideStepAskBtn() {
		if (!this._stepAskBtnEl) return;
		if (this._stepAskHideTimer) clearTimeout(this._stepAskHideTimer);
		this._stepAskHideTimer = setTimeout(() => this._hideStepAskBtn(), 600);
	}
	_hideStepAskBtn() {
		if (this._stepAskHideTimer) {
			clearTimeout(this._stepAskHideTimer);
			this._stepAskHideTimer = null;
		}
		const btn = this._stepAskBtnEl;
		if (!btn) return;
		btn.style.opacity = "0";
		btn.tabIndex = -1;
		btn.setAttribute("aria-hidden", "true");
		if (this._stepAskFadeTimer) clearTimeout(this._stepAskFadeTimer);
		this._stepAskFadeTimer = setTimeout(() => {
			if (btn.style.opacity === "0") btn.style.pointerEvents = "none";
		}, 200);
	}
	_stepDeeplink(idx) {
		const s = this.data && this.data.steps && this.data.steps[idx];
		return s && s.deeplink || this.data && this.data.deeplink || "";
	}
	_termAskClick() {
		const focus = this._askBtnFocus;
		let message = null;
		if (this._onBuildTermAskMessage) try {
			message = this._onBuildTermAskMessage(focus);
		} catch (e) {
			message = null;
		}
		if (!message) message = this._buildTermAskMessage(focus);
		if (!message) return;
		this._hideTermAskBtn();
		this._routeAsk(message, this._stepDeeplink(this.current));
	}
	_buildTermAskMessage(focus) {
		if (!focus || !focus.text) return "";
		const title = this.data && this.data.title ? ` "${this.data.title}"` : "";
		const goal = this.data && this.data.goal ? ` (${this.data.goal})` : "";
		const i = this.current;
		const others = this._askSel.filter((s) => s.key !== this._apprKey(focus.text));
		let head = `In the derivation${title}${goal}, at step ${i}, explain the term "${focus.text}"`;
		if (focus.desc) head += ` (${focus.desc})`;
		if (!others.length) return head + ` — what it represents and its role here.`;
		const lines = [head + ` and how it relates to:`];
		for (const t of others) lines.push(`- "${t.text}"${t.desc ? ` — ${t.desc}` : ""}`);
		return lines.join("\n");
	}
	_routeAsk(message, deeplink) {
		if (!message) return;
		if (this._onTermAsk) {
			this._onTermAsk({ message });
			return;
		}
		this._openAppUrl(this._askTargetUrl(deeplink, message), () => this._postToParent({
			type: "algebench-term-ask",
			message
		}), () => {
			try {
				navigator.clipboard.writeText(message);
			} catch (e) {}
		});
	}
	_openAppUrl(url, onEmbeddedFail, onStandaloneFail) {
		const embedded = typeof window !== "undefined" && window.self !== window.top;
		if (url) try {
			if (embedded) {
				if (window.open(url, "_blank", "noopener")) return;
			} else {
				window.location.assign(url);
				return;
			}
		} catch (e) {}
		const fail = embedded ? onEmbeddedFail : onStandaloneFail;
		if (fail) fail();
	}
	_postToParent(payload) {
		try {
			window.parent.postMessage({
				...payload,
				title: this.data && this.data.title || null
			}, "*");
		} catch (e) {}
	}
	_ownPaId() {
		if (this._paId) return this._paId;
		try {
			const d = this.data && this.data.deeplink;
			if (!d) return null;
			return new URL(d, this._askOrigin || window.location.origin).searchParams.get("pa");
		} catch (e) {
			return null;
		}
	}
	_askTargetUrl(deeplink, message) {
		try {
			const origin = this._askOrigin || window.location.origin;
			const raw = deeplink || "/";
			const u = new URL(raw, origin);
			if (u.origin !== origin) return null;
			u.searchParams.set("panel", "chat");
			u.searchParams.set("aa", String(message).slice(0, 1500));
			const sameApp = raw.startsWith("/");
			const ownPa = this._ownPaId();
			if (sameApp && ownPa && !u.searchParams.has("pa")) u.searchParams.set("pa", ownPa);
			if (u.searchParams.has("pa")) u.searchParams.set("pas", String(this.current));
			return u.href;
		} catch (e) {
			return null;
		}
	}
	_makeFaButton() {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "pa-ask-btn pa-fa-btn";
		btn.title = "Function analysis — plot and characterize this step's expression";
		btn.innerHTML = FUNCTION_ANALYSIS_SVG;
		btn.setAttribute("aria-label", "Function analysis for this step");
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			this._faClick();
		});
		return btn;
	}
	_faClick() {
		const i = this.current;
		const latex = this._stepExpr(i);
		if (!latex) return;
		if (this._onFunctionAnalysis) {
			this._onFunctionAnalysis({
				latex,
				step: i
			});
			return;
		}
		this._openAppUrl(this._faTargetUrl(this._stepDeeplink(i), latex), () => this._postToParent({
			type: "algebench-function-analysis",
			latex,
			step: i
		}), () => {
			try {
				navigator.clipboard.writeText(latex);
			} catch (e) {}
		});
	}
	_faTargetUrl(deeplink, latex) {
		try {
			const origin = this._askOrigin || window.location.origin;
			const raw = deeplink || "/";
			const u = new URL(raw, origin);
			if (u.origin !== origin) return null;
			u.searchParams.set("view", "math");
			u.searchParams.set("fax", String(latex).slice(0, 1e3));
			u.searchParams.delete("fa");
			const sameApp = raw.startsWith("/");
			const ownPa = this._ownPaId();
			if (sameApp && ownPa && !u.searchParams.has("pa")) u.searchParams.set("pa", ownPa);
			if (u.searchParams.has("pa")) u.searchParams.set("pas", String(this.current));
			return u.href;
		} catch (e) {
			return null;
		}
	}
	_makeRoutedAskButton(className, title, getMessage, getIdx) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = className;
		btn.title = title;
		btn.innerHTML = AI_SPARKLE_SVG;
		btn.setAttribute("aria-label", title);
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const message = getMessage();
			if (message) this._routeAsk(message, this._stepDeeplink(getIdx ? getIdx() : this.current));
		});
		return btn;
	}
	_applySpeed() {
		this.speed = SPEEDS[this._speedIdx];
		for (const a of this._running) try {
			a.playbackRate = this.speed;
		} catch (e) {}
		const btn = this.container.querySelector(".pa-speed");
		if (btn) btn.textContent = _speedLabel(this.speed);
	}
	_tween(el, keyframes, opts) {
		const a = el.animate(keyframes, opts);
		a.playbackRate = this.speed;
		if (this._paused) a.pause();
		return a;
	}
	_build() {
		this.container.classList.add("pa-root");
		this.container.innerHTML = `
      <div class="pa-goal-dock" hidden></div>
      <button class="pa-goal-pill" type="button" hidden aria-label="Goal"></button>
      <div class="pa-stage" aria-live="polite"></div>
      <span class="pa-overall"></span>
      <div class="pa-meta"><div class="pa-op-row"><span class="pa-op"></span><span class="pa-conf-badge"></span></div><span class="pa-just"></span><span class="pa-next-pill" role="button" tabindex="0"></span></div>
      <div class="pa-controls">
        <button type="button" class="pa-btn pa-prev" data-tip="Previous step" aria-label="Previous step">◀</button>
        <div class="pa-steps"></div>
        <button type="button" class="pa-btn pa-next" data-tip="Next step" aria-label="Next step">▶</button>
        <button type="button" class="pa-btn pa-play" data-tip="Play through" aria-label="Play through">▶ Play</button>
        <button type="button" class="pa-btn pa-speed" data-tip="Animation speed (click to cycle)" aria-label="Animation speed">${_speedLabel(this.speed)}</button>
        <button class="pa-btn pa-mode" type="button" data-tip="Sequential — stagger the moves" aria-label="Sequential — stagger the moves" aria-pressed="false">⇉</button>
        <button class="pa-btn pa-stack" type="button" data-tip="Stacked — keep previous steps visible" aria-label="Stacked — keep previous steps visible" aria-pressed="false">☰</button>
        <button class="pa-btn pa-info-pill" type="button" hidden aria-label="Prerequisites & follow-ups"></button>
      </div>`;
		this.stage = this.container.querySelector(".pa-stage");
		const steps = this.container.querySelector(".pa-steps");
		this.data.steps.forEach((s, i) => {
			const b = document.createElement("button");
			b.type = "button";
			b.className = "pa-step";
			b.textContent = String(i);
			let tip = `${i}. ${s.operation || `state ${i}`}`;
			const c = this._conf(i);
			if (c && c.tier) {
				b.classList.add(`pa-conf-${c.tier}`);
				tip += ` — ${c.label || c.tier}`;
			}
			this._attachMathTip(b, tip);
			b.addEventListener("click", () => this._userGoTo(i));
			steps.appendChild(b);
		});
		this._setOverall();
		this.container.querySelector(".pa-prev").onclick = () => this._userGoTo(this.current - 1);
		this.container.querySelector(".pa-next").onclick = () => this._userGoTo(this.current + 1);
		const nextPill = this.container.querySelector(".pa-next-pill");
		this._nextPillEl = nextPill;
		nextPill.onclick = () => this._userGoTo(this.current + 1);
		nextPill.onkeydown = (e) => {
			if (e.target !== nextPill) return;
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				this._userGoTo(this.current + 1);
			}
		};
		if (this._aiAsk) {
			const meta = this.container.querySelector(".pa-meta");
			meta.classList.add("pa-has-ask");
			meta.querySelector(".pa-op-row").appendChild(this._aiAsk("pa-ask-btn pa-ask-current", "Ask AI about this step", () => this._askCurrentMessage()));
			this._nextAskBtn = this._aiAsk("pa-ask-btn pa-ask-next", "Predict the next step with AI", () => this._askNextMessage());
			nextPill.classList.add("pa-has-ask");
		}
		if (this._deriveBtnFactory && this._onDerive) {
			const meta = this.container.querySelector(".pa-meta");
			meta.classList.add("pa-has-ask");
			this._deriveBtnEl = this._deriveBtnFactory("pa-ask-btn pa-derive-btn", "Derive this step — break it into finer sub-steps", () => this._deriveCurrent(this._deriveBtnEl));
			meta.querySelector(".pa-op-row").appendChild(this._deriveBtnEl);
		}
		if (this._aiAsk) {
			const meta = this.container.querySelector(".pa-meta");
			meta.classList.add("pa-has-ask");
			this._faBtnEl = this._makeFaButton();
			meta.querySelector(".pa-op-row").appendChild(this._faBtnEl);
		}
		this.container.querySelector(".pa-play").onclick = () => this._togglePlay();
		this.container.querySelector(".pa-speed").onclick = () => {
			this._speedIdx = (this._speedIdx + 1) % SPEEDS.length;
			this._applySpeed();
		};
		const modeBtn = this.container.querySelector(".pa-mode");
		modeBtn.classList.toggle("pa-active", this.mode === "sequential");
		modeBtn.setAttribute("aria-pressed", String(this.mode === "sequential"));
		modeBtn.onclick = () => {
			this.mode = this.mode === "sequential" ? "parallel" : "sequential";
			const on = this.mode === "sequential";
			modeBtn.classList.toggle("pa-active", on);
			modeBtn.setAttribute("aria-pressed", String(on));
		};
		const stackBtn = this.container.querySelector(".pa-stack");
		stackBtn.classList.toggle("pa-active", this.stacked);
		stackBtn.setAttribute("aria-pressed", String(this.stacked));
		stackBtn.onclick = () => this._setStacked(!this.stacked);
		this._renderGoal();
		this._renderExplore();
		this._buildTermAskButton();
		this._buildStepAskButton();
	}
	_renderGoal() {
		const pill = this.container.querySelector(".pa-goal-pill");
		const dock = this.container.querySelector(".pa-goal-dock");
		if (!pill) return;
		const goal = (this.data && this.data.goal || "").trim();
		this.container.classList.toggle("pa-has-goal", !!goal);
		if (!goal) {
			pill.hidden = true;
			if (dock) dock.hidden = true;
			return;
		}
		this._goalText = goal;
		this._goalDocked = false;
		pill.innerHTML = "";
		const icon = document.createElement("span");
		icon.className = "pa-goal-icon";
		icon.innerHTML = GOAL_ICON;
		const label = document.createElement("span");
		label.className = "pa-goal-label";
		this._caption(label, goal);
		pill.append(icon, label);
		pill.hidden = false;
		pill.addEventListener("click", () => this._toggleGoalDock());
		if (dock) dock.addEventListener("click", () => this._toggleGoalDock());
	}
	_toggleGoalDock() {
		const pill = this.container.querySelector(".pa-goal-pill");
		const dock = this.container.querySelector(".pa-goal-dock");
		if (!dock) return;
		this._goalDocked = !this._goalDocked;
		this._hideGoalPop();
		if (this._goalDocked) {
			dock.innerHTML = "";
			const label = document.createElement("span");
			label.className = "pa-goal-dock-label";
			label.textContent = "Goal";
			const txt = document.createElement("span");
			txt.className = "pa-goal-dock-text";
			this._caption(txt, this._goalText || "");
			dock.appendChild(label);
			dock.appendChild(txt);
			dock.hidden = false;
			pill.hidden = true;
		} else {
			dock.hidden = true;
			dock.innerHTML = "";
			pill.hidden = false;
		}
	}
	_showGoalPop() {
		let tip = this._goalPop;
		if (!tip) {
			tip = document.createElement("div");
			tip.className = "pa-goal-pop";
			tip.setAttribute("role", "tooltip");
			document.body.appendChild(tip);
			this._goalPop = tip;
		}
		this._caption(tip, this._goalText || "");
		tip.style.display = "block";
		tip.style.visibility = "hidden";
		const r = this.container.querySelector(".pa-goal-pill").getBoundingClientRect();
		const tw = tip.offsetWidth, th = tip.offsetHeight, GAP = 8;
		let left = Math.max(8, Math.min(r.left, window.innerWidth - tw - 8));
		let top = r.bottom + GAP;
		if (top + th > window.innerHeight - 4) top = r.top - th - GAP;
		tip.style.left = `${Math.round(left)}px`;
		tip.style.top = `${Math.round(Math.max(4, top))}px`;
		tip.style.visibility = "visible";
	}
	_hideGoalPop() {
		if (this._goalPop) this._goalPop.style.display = "none";
	}
	_renderExplore() {
		const pill = this.container.querySelector(".pa-info-pill");
		if (!pill) return;
		const clean = (v) => (Array.isArray(v) ? v : []).map((s) => typeof s === "string" ? { text: s } : s).filter((s) => s && typeof s.text === "string" && s.text.trim()).slice(0, 8);
		const tabs = [];
		const prereqs = clean(this.data && this.data.prerequisites);
		const followups = clean(this.data && this.data.followups);
		if (prereqs.length) tabs.push({
			key: "prerequisite",
			label: "Prerequisites",
			items: prereqs
		});
		if (followups.length) tabs.push({
			key: "followup",
			label: "Explore further",
			items: followups
		});
		if (!this._enableExplore || !tabs.length) {
			pill.hidden = true;
			return;
		}
		pill.classList.add("pa-icon-btn");
		pill.innerHTML = INFO_ICON;
		pill.title = "Prerequisites & follow-ups";
		pill.hidden = false;
		const pop = document.createElement("div");
		pop.className = "pa-explore-pop";
		pop.style.display = "none";
		const grip = document.createElement("div");
		grip.className = "pa-explore-resize";
		grip.title = "Drag to resize";
		const contentEl = document.createElement("div");
		contentEl.className = "pa-explore-panel";
		const tabsEl = document.createElement("div");
		tabsEl.className = "pa-explore-tabs";
		pop.appendChild(grip);
		pop.appendChild(contentEl);
		pop.appendChild(tabsEl);
		this.container.appendChild(pop);
		this._explorePop = pop;
		this._wireExploreResize(grip, pop);
		const select = (tab, btn) => {
			tabsEl.querySelectorAll(".pa-explore-tab").forEach((b) => b.classList.remove("pa-active"));
			btn.classList.add("pa-active");
			contentEl.innerHTML = "";
			for (const item of tab.items) {
				const chip = document.createElement("button");
				chip.type = "button";
				chip.className = "pa-explore-chip";
				const icon = document.createElement("span");
				icon.className = "pa-explore-chip-icon";
				icon.innerHTML = AI_SPARKLE_SVG;
				const text = document.createElement("span");
				text.className = "pa-explore-chip-text";
				this._caption(text, item.text);
				chip.append(icon, text);
				chip.addEventListener("click", () => this._exploreClick(tab.key, item));
				contentEl.appendChild(chip);
			}
		};
		let firstBtn = null;
		tabs.forEach((tab, i) => {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "pa-explore-tab";
			btn.textContent = tab.label;
			btn.addEventListener("click", () => select(tab, btn));
			tabsEl.appendChild(btn);
			if (i === 0) firstBtn = btn;
		});
		if (firstBtn) select(tabs[0], firstBtn);
		this._explorePinned = false;
		let hideT;
		const show = () => {
			clearTimeout(hideT);
			pop.style.display = "flex";
			this._positionExplorePop();
		};
		const hide = () => {
			pop.style.display = "none";
		};
		const scheduleHide = () => {
			if (this._explorePinned) return;
			clearTimeout(hideT);
			hideT = setTimeout(hide, 140);
		};
		pill.addEventListener("mouseenter", show);
		pill.addEventListener("mouseleave", scheduleHide);
		pop.addEventListener("mouseenter", () => clearTimeout(hideT));
		pop.addEventListener("mouseleave", scheduleHide);
		pill.addEventListener("click", () => {
			this._explorePinned = !this._explorePinned;
			pill.classList.toggle("pa-pinned", this._explorePinned);
			if (this._explorePinned) show();
			else hide();
		});
		if (this._onDocExplore) document.removeEventListener("mousedown", this._onDocExplore, true);
		this._onDocExplore = (ev) => {
			if (!this._explorePinned) return;
			if (pop.contains(ev.target) || pill.contains(ev.target)) return;
			this._explorePinned = false;
			pill.classList.remove("pa-pinned");
			hide();
		};
		document.addEventListener("mousedown", this._onDocExplore, true);
	}
	hidePopups() {
		this._hideGoalPop();
		if (this._termTip) this._termTip.style.display = "none";
		if (this._mathTip) this._mathTip.style.opacity = "0";
		this._hideTermAskBtn();
		this._hideStepAskBtn();
		if (this._explorePop) {
			this._explorePop.style.display = "none";
			this._explorePinned = false;
			const pill = this.container.querySelector(".pa-info-pill");
			if (pill) pill.classList.remove("pa-pinned");
		}
	}
	_repositionPopups() {
		if (this._explorePop && this._explorePop.style.display !== "none") this._positionExplorePop();
	}
	_positionExplorePop() {
		const pop = this._explorePop;
		const pill = this.container.querySelector(".pa-info-pill");
		if (!pop || !pill) return;
		pop.style.visibility = "hidden";
		pop.style.right = "auto";
		pop.style.top = "auto";
		const GAP = 8;
		const cr = this.container.getBoundingClientRect();
		const pr = pill.getBoundingClientRect();
		const pw = pop.offsetWidth;
		let left = pr.right - cr.left - pw;
		left = Math.max(4, Math.min(left, cr.width - pw - 4));
		pop.style.left = `${Math.round(left)}px`;
		pop.style.bottom = `${Math.round(cr.bottom - pr.top + GAP)}px`;
		pop.style.visibility = "visible";
	}
	_wireExploreResize(grip, pop) {
		let h0 = 0, y0 = 0;
		const onMove = (e) => {
			const max = Math.round(window.innerHeight * .7);
			const h = Math.min(Math.max(h0 + (y0 - e.clientY), 120), max);
			pop.style.height = `${h}px`;
		};
		const onUp = () => {
			document.removeEventListener("pointermove", onMove);
			document.removeEventListener("pointerup", onUp);
		};
		grip.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			h0 = pop.getBoundingClientRect().height;
			y0 = e.clientY;
			document.addEventListener("pointermove", onMove);
			document.addEventListener("pointerup", onUp);
		});
	}
	_exploreMessage(kind, text) {
		const title = this.data && this.data.title ? ` "${this.data.title}"` : "";
		const goal = this.data && this.data.goal ? ` (${this.data.goal})` : "";
		if (kind === "prerequisite") {
			if (/\?\s*$/.test(text)) return `In the derivation${title}${goal}: ${text}`;
			return `In the derivation${title}${goal}, explain the prerequisite "${text}" and how it's used here.`;
		}
		return `I'm exploring the derivation${title}${goal}.\n\n${text}`;
	}
	_exploreClick(kind, item) {
		const text = item.text;
		const message = this._exploreMessage(kind, text);
		if (!item.deeplink && this._onExplore) {
			this._onExplore({
				kind,
				text,
				message
			});
			return;
		}
		this._openAppUrl(this._askTargetUrl(item.deeplink || this.data && this.data.deeplink || "", message), () => this._postToParent({
			type: "algebench-explore",
			kind,
			text,
			message
		}), () => {
			try {
				navigator.clipboard.writeText(text);
			} catch (e) {}
		});
	}
	_renderInto(el, latex) {
		el.innerHTML = "";
		const host = document.createElement("span");
		host.className = "pa-expr";
		el.appendChild(host);
		this.katex.render(latex, host, {
			throwOnError: false,
			displayMode: true,
			strict: false,
			trust: (ctx) => ctx.command === "\\htmlData"
		});
		if (host.querySelector(".katex-error")) this._renderErrorChip(host, latex);
		return host;
	}
	_renderErrorChip(host, latex) {
		if (this._errChipCleanup) this._errChipCleanup();
		host.innerHTML = "";
		const src = String(latex || "");
		const wrap = document.createElement("span");
		wrap.className = "pa-expr-error-wrap";
		const chip = document.createElement("span");
		chip.className = "pa-expr-error";
		chip.textContent = "⚠ step could not be rendered";
		chip.setAttribute("role", "button");
		chip.setAttribute("tabindex", "0");
		chip.setAttribute("aria-expanded", "false");
		const panel = document.createElement("div");
		panel.className = "pa-expr-error-panel";
		panel.hidden = true;
		const copy = document.createElement("button");
		copy.type = "button";
		copy.className = "pa-expr-error-copy";
		copy.textContent = "Copy";
		const pre = document.createElement("pre");
		pre.className = "pa-expr-error-src";
		pre.textContent = src;
		panel.append(copy, pre);
		let pinned = false;
		const show = (on) => {
			panel.hidden = !on;
			chip.setAttribute("aria-expanded", String(on));
			if (this.stage) this.stage.classList.toggle("pa-stage-lift", on);
			if (on) document.addEventListener("pointerdown", onDocDown, true);
			else document.removeEventListener("pointerdown", onDocDown, true);
		};
		const unpin = () => {
			pinned = false;
			show(false);
		};
		const onDocDown = (e) => {
			if (!wrap.contains(e.target)) unpin();
		};
		chip.addEventListener("mouseenter", () => show(true));
		wrap.addEventListener("mouseleave", () => {
			if (!pinned) show(false);
		});
		chip.addEventListener("click", () => {
			pinned = !pinned;
			show(pinned);
		});
		chip.addEventListener("keydown", (e) => {
			if (e.key !== "Enter" && e.key !== " ") return;
			e.preventDefault();
			pinned = !pinned;
			show(pinned);
		});
		wrap.addEventListener("keydown", (e) => {
			if (e.key === "Escape") unpin();
		});
		copy.addEventListener("click", async () => {
			let ok = false;
			try {
				await navigator.clipboard.writeText(src);
				ok = true;
			} catch (e) {
				ok = this._selectContents(pre) && this._execCopy();
			}
			copy.textContent = ok ? "Copied" : "Press ⌘C";
			setTimeout(() => {
				copy.textContent = "Copy";
			}, 1200);
		});
		this._errChipCleanup = () => {
			document.removeEventListener("pointerdown", onDocDown, true);
			if (this.stage) this.stage.classList.remove("pa-stage-lift");
			this._errChipCleanup = null;
		};
		wrap.append(chip, panel);
		host.appendChild(wrap);
	}
	_selectContents(el) {
		try {
			const range = document.createRange();
			range.selectNodeContents(el);
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
			return true;
		} catch (e) {
			return false;
		}
	}
	_execCopy() {
		try {
			return document.execCommand("copy");
		} catch (e) {
			return false;
		}
	}
	_ensureLinesEl() {
		let el = this._linesEl;
		if (!el || el.parentElement !== this.stage) {
			this.stage.innerHTML = "";
			el = document.createElement("div");
			el.className = "pa-lines" + (this._fitHeight ? " pa-lines-scroll" : "");
			this.stage.appendChild(el);
			this._linesEl = el;
		}
		return el;
	}
	_renderLine(line, i) {
		line.dataset.step = String(i);
		delete line.dataset.dirty;
		line.style.visibility = "";
		line.style.opacity = "";
		line.style.display = "";
		line.style.fontSize = "";
		this._renderInto(line, this.data.steps[i].latex);
		const pill = document.createElement("button");
		pill.type = "button";
		pill.className = "pa-line-pill";
		pill.textContent = String(i);
		this._attachMathTip(pill, this._opText(i));
		pill.addEventListener("click", () => this._userGoTo(i));
		pill.addEventListener("mouseenter", () => this._showStepAskBtn(pill, i));
		pill.addEventListener("mouseleave", () => this._scheduleHideStepAskBtn());
		pill.addEventListener("focus", () => this._showStepAskBtn(pill, i));
		pill.addEventListener("blur", () => this._scheduleHideStepAskBtn());
		line.insertBefore(pill, line.firstChild);
	}
	_syncLines(count) {
		const linesEl = this._ensureLinesEl();
		linesEl.style.height = "";
		linesEl.style.overflow = "";
		while (linesEl.children.length > count) linesEl.lastElementChild.remove();
		for (let i = 0; i < count; i++) {
			let line = linesEl.children[i];
			if (!line) {
				line = document.createElement("div");
				line.className = "pa-line";
				linesEl.appendChild(line);
				this._renderLine(line, i);
			} else if (line.dataset.step !== String(i) || line.dataset.dirty) this._renderLine(line, i);
			else {
				line.style.visibility = "";
				line.style.opacity = "";
				line.style.display = "";
				line.style.fontSize = "";
			}
		}
		this._markCurrentLine();
		[...linesEl.children].forEach((el, i) => {
			const pill = el.querySelector(".pa-line-pill");
			if (pill) pill.classList.toggle("pa-pill-active", i === this.current);
		});
		if (this._mathTipFor && !this._mathTipFor.isConnected) this._hideMathTip();
		return linesEl;
	}
	_lineAt(i) {
		return this._linesEl ? this._linesEl.children[i] || null : null;
	}
	_markCurrentLine() {
		if (!this._linesEl) return;
		[...this._linesEl.children].forEach((el, i) => el.classList.toggle("pa-line-current", i === this.current));
	}
	_liveRoot() {
		return this.stacked && this._lineAt(this.current) || this.stage;
	}
	_exprEl() {
		const root = this._liveRoot();
		return root ? root.querySelector(".pa-expr") : null;
	}
	_renderStage() {
		this.stage.classList.toggle("pa-stacked", this.stacked);
		if (this.stacked) {
			this._syncLines(this.current + 1);
			this._scrollToCurrent(false);
		} else {
			this._linesEl = null;
			this._renderInto(this.stage, this.data.steps[this.current].latex);
		}
	}
	_scrollToCurrent(smooth) {
		if (!this._fitHeight || !this._linesEl) return;
		const el = this._linesEl;
		if (el.scrollHeight <= el.clientHeight + 1) return;
		const line = this._lineAt(this.current);
		const top = line ? Math.max(0, line.offsetTop + line.offsetHeight - el.clientHeight + 8) : el.scrollHeight;
		try {
			el.scrollTo({
				top,
				behavior: smooth ? "smooth" : "auto"
			});
		} catch (e) {
			el.scrollTop = top;
		}
	}
	_setStacked(on) {
		on = !!on;
		if (this.stacked === on) return;
		this._playId = null;
		this._paused = false;
		this._openPauseGate();
		this._syncPlayUI();
		this._token = {};
		this._cancel();
		this.stacked = on;
		const btn = this.container.querySelector(".pa-stack");
		if (btn) {
			btn.classList.toggle("pa-active", on);
			btn.setAttribute("aria-pressed", String(on));
		}
		this.stage.innerHTML = "";
		this._linesEl = null;
		this._fit();
		this._renderStage();
		this._capOverflow();
		if (this._onRelayout) try {
			this._onRelayout();
		} catch (e) {}
	}
	_untaggedGlyphs(root) {
		const html = root.querySelector(".katex-html");
		if (!html) return [];
		const out = [];
		html.querySelectorAll("*").forEach((el) => {
			if (el.firstElementChild) return;
			const t = (el.textContent || "").replace(/[​-‍﻿]/g, "").trim();
			if (!t) return;
			if (_parenChar(t) || el.closest(".delimsizing")) return;
			if (el.hasAttribute("data-n")) return;
			const p = el.closest("[data-n]");
			if (!p || p.querySelector("[data-n]")) out.push(el);
		});
		return out;
	}
	_parens(root) {
		const html = root.querySelector(".katex-html");
		if (!html) return [];
		const out = [];
		const seen = /* @__PURE__ */ new Set();
		html.querySelectorAll("*").forEach((el) => {
			if (el.firstElementChild) return;
			const ch = _parenChar(el.textContent);
			if (!ch) return;
			const delim = el.closest(".delimsizing");
			const unit = delim || el;
			if (seen.has(unit)) return;
			seen.add(unit);
			if (!delim) {
				if (el.hasAttribute("data-n")) return;
				const p = el.closest("[data-n]");
				if (p && !p.querySelector("[data-n]")) return;
			}
			out.push({
				char: ch,
				el: unit,
				delim: !!delim,
				content: this._parenContent(el, ch)
			});
		});
		return out;
	}
	_parenContent(el, ch) {
		const cell = el.closest(".mopen, .mclose") || el;
		const sib = (cell.classList ? cell.classList.contains("mopen") : ch !== ")") ? cell.nextElementSibling : cell.previousElementSibling;
		if (!sib) return "";
		let id = sib.getAttribute && sib.getAttribute("data-n");
		if (!id) {
			const inner = sib.querySelector && sib.querySelector("[data-n]");
			id = inner ? inner.getAttribute("data-n") : "";
		}
		return (id || "").replace(/^_r\d+_/, "");
	}
	_lcsPairs(a, b) {
		const n = a.length, m = b.length;
		const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
		for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		const pairs = [];
		let i = 0, j = 0;
		while (i < n && j < m) if (a[i] === b[j]) {
			pairs.push([i, j]);
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
		else j++;
		return pairs;
	}
	_lcsMatch(a, b) {
		const n = a.length, m = b.length;
		const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
		for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		const aKeep = /* @__PURE__ */ new Set(), bKeep = /* @__PURE__ */ new Set();
		let i = 0, j = 0;
		while (i < n && j < m) if (a[i] === b[j]) {
			aKeep.add(i);
			bKeep.add(j);
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
		else j++;
		return {
			aKeep,
			bKeep
		};
	}
	_leaves(root) {
		const map = /* @__PURE__ */ new Map();
		root.querySelectorAll(".katex-html [data-n]").forEach((el) => {
			if (el.querySelector("[data-n]")) return;
			map.set(el.getAttribute("data-n"), el);
		});
		return map;
	}
	_rects(map) {
		const r = /* @__PURE__ */ new Map();
		map.forEach((el, id) => r.set(id, el.getBoundingClientRect()));
		return r;
	}
	_canonicalTermId(id) {
		return String(id || "").replace(/^_r\d+_/, "").split("__")[0];
	}
	/**
	* Pair SOURCE leaves to TARGET leaves, bridging occurrence-scoped ids.
	* Returns `Map<sourceId, targetId[]>`.
	*
	* `latex_renderer` gives a node a bare id when it has ONE parent and a
	* `<id>__<parent>` id when it is shared, deciding per state. So the id of a
	* symbol is not stable across a step whose multiplicity changes:
	*
	*     (a-b)^2          -> a                            (one parent, bare)
	*     (a-b)·(a-b)      -> a____add_2, a____add_4       (two parents, scoped)
	*     a^2 - 2ab + b^2  -> a____power_3, a____multiply_6
	*
	* Keyed on raw ids, NONE of those pair — the last transition scores zero
	* matches even though both sides plainly hold two `a`s and two `b`s. So we
	* compare the CANONICAL name on BOTH sides. (An earlier version only looked
	* the canonical name up as a literal source id, which fixed the first
	* transition — where the source happens to be bare — and left the rest broken.)
	*
	* Exact ids win first and are never disturbed, so anything that already
	* animates keeps the identical pairing. What is left is grouped by canonical
	* name and paired IN OCCURRENCE ORDER: first `a` to first `a`, second to
	* second. When the target holds more copies than the source, the surplus all
	* splits from the LAST source — a term dividing should fly out of where it was,
	* not pop into existence.
	*/
	_pairLeaves(fromIds, toIds) {
		const pairs = /* @__PURE__ */ new Map();
		const claimedFrom = /* @__PURE__ */ new Set();
		const claimedTo = /* @__PURE__ */ new Set();
		const toSet = new Set(toIds);
		for (const id of fromIds) if (toSet.has(id)) {
			pairs.set(id, [id]);
			claimedFrom.add(id);
			claimedTo.add(id);
		}
		const group = (ids, skip) => {
			const m = /* @__PURE__ */ new Map();
			for (const id of ids) {
				if (skip.has(id)) continue;
				const c = this._canonicalTermId(id);
				if (!c) continue;
				if (!m.has(c)) m.set(c, []);
				m.get(c).push(id);
			}
			return m;
		};
		const srcByCanon = group(fromIds, claimedFrom);
		const tgtByCanon = group(toIds, claimedTo);
		for (const [canon, targets] of tgtByCanon) {
			const sources = srcByCanon.get(canon);
			if (!sources || !sources.length) continue;
			targets.forEach((t, i) => {
				const src = sources[Math.min(i, sources.length - 1)];
				if (!pairs.has(src)) pairs.set(src, []);
				pairs.get(src).push(t);
			});
		}
		return pairs;
	}
	/**
	* Bridge occurrence-scoped ids so a persistent term animates across the step.
	*
	* Gives every target that paired to a DIFFERENT source id that source's pose,
	* via :meth:`_pairLeaves`. Returns the set of source ids that were adopted by
	* some other id — the caller must not ghost those: they did not disappear,
	* they moved or divided.
	*
	* Only ever ADDS matches; a target that pairs exactly is untouched.
	*/
	_aliasOccurrences(fromRects, cloneOf, fromFontSize, toLeaves) {
		const origins = /* @__PURE__ */ new Set();
		const pairs = this._pairLeaves([...cloneOf.keys()], [...toLeaves.keys()]);
		for (const [src, targets] of pairs) {
			if (!fromRects.has(src)) continue;
			for (const t of targets) {
				if (t === src) continue;
				fromRects.set(t, fromRects.get(src));
				if (cloneOf.has(src)) cloneOf.set(t, cloneOf.get(src));
				if (fromFontSize.has(src)) fromFontSize.set(t, fromFontSize.get(src));
				origins.add(src);
			}
		}
		return origins;
	}
	_nodeRects(root) {
		const r = /* @__PURE__ */ new Map();
		root.querySelectorAll(".katex-html [data-n]").forEach((el) => r.set(el.getAttribute("data-n"), el.getBoundingClientRect()));
		return r;
	}
	_rigidBlocks(stage, fromRects, toRects, fromFontSize, changedIds = /* @__PURE__ */ new Set()) {
		const els = [...stage.querySelectorAll(".katex-html [data-n]")];
		const depth = (el) => {
			let d = 0, p = el.parentElement;
			while (p) {
				if (p.hasAttribute && p.hasAttribute("data-n")) d++;
				p = p.parentElement;
			}
			return d;
		};
		els.sort((a, b) => depth(a) - depth(b));
		const claimed = /* @__PURE__ */ new WeakSet();
		const blocks = [];
		for (const el of els) {
			if (claimed.has(el)) continue;
			const id = el.getAttribute("data-n");
			if (!fromRects.has(id) || !toRects.has(id) || changedIds.has(id)) continue;
			const fb = fromRects.get(id), tb = toRects.get(id);
			const inner = el.querySelectorAll("[data-n]");
			const leafEls = inner.length ? [...inner].filter((x) => !x.querySelector("[data-n]")) : [el];
			const leafIds = leafEls.map((x) => x.getAttribute("data-n"));
			if (!leafIds.every((lid) => fromRects.has(lid) && !changedIds.has(lid))) continue;
			let s = 1;
			const ffs = parseFloat(fromFontSize.get(leafIds[0]));
			const tfs = parseFloat(getComputedStyle(leafEls[0]).fontSize);
			if (ffs > 0 && tfs > 0) s = ffs / tfs;
			if (!(s > .02 && s < 50)) s = 1;
			if (Math.abs(s - 1) < .02) s = 1;
			const tol = 2 + .04 * Math.max(fb.width, fb.height);
			if (!leafIds.every((lid) => {
				const lf = fromRects.get(lid), lt = toRects.get(lid);
				const ex = fb.left + s * (lt.left - tb.left);
				const ey = fb.top + s * (lt.top - tb.top);
				return Math.abs(ex - lf.left) < tol && Math.abs(ey - lf.top) < tol;
			})) continue;
			blocks.push({
				el,
				dx: fb.left - tb.left,
				dy: fb.top - tb.top,
				scale: s,
				single: leafEls.length === 1
			});
			el.querySelectorAll("[data-n]").forEach((c) => claimed.add(c));
			claimed.add(el);
		}
		return { blocks };
	}
	_cancel() {
		this._running.forEach((a) => {
			try {
				a.cancel();
			} catch (e) {}
		});
		this._running = [];
		this._ghosts.forEach((g) => g.remove());
		this._ghosts = [];
		this._cancelMeta();
	}
	_snapTo(target) {
		this._cancel();
		this.current = target;
		this._renderStage();
		this._capOverflow();
		this._syncUI();
	}
	_morphSnapshot(root) {
		const leaves = this._leaves(root);
		const rects = this._nodeRects(root);
		const cloneOf = /* @__PURE__ */ new Map();
		const fontSize = /* @__PURE__ */ new Map();
		leaves.forEach((el, id) => {
			cloneOf.set(id, el.cloneNode(true));
			fontSize.set(id, getComputedStyle(el).fontSize);
		});
		const untagged = this._untaggedGlyphs(root).map((el) => ({
			text: el.textContent,
			clone: el.cloneNode(true),
			rect: el.getBoundingClientRect(),
			fontSize: getComputedStyle(el).fontSize
		}));
		const parens = this._parens(root).map((p) => ({
			char: p.char,
			delim: p.delim,
			content: p.content,
			clone: p.el.cloneNode(true),
			rect: p.el.getBoundingClientRect(),
			fontSize: getComputedStyle(p.el).fontSize
		}));
		const decos = [];
		for (const sel of DECORATIONS) root.querySelectorAll(sel).forEach((el) => {
			const o = el.closest("[data-n]");
			if (!o) return;
			const key = o.getAttribute("data-n") + "|" + sel;
			decos.push({
				key,
				clone: el.cloneNode(true),
				rect: el.getBoundingClientRect(),
				fontSize: getComputedStyle(el).fontSize
			});
		});
		return {
			leaves,
			rects,
			cloneOf,
			fontSize,
			untagged,
			parens,
			decos
		};
	}
	async goTo(target) {
		target = Math.max(0, Math.min(this.data.steps.length - 1, target));
		if (target === this.current && this._running.length === 0) return;
		const prev = this.current;
		if (typeof document !== "undefined" && document.hidden) {
			this._snapTo(target);
			return;
		}
		if (this.stacked) return this._stackedGoTo(target, prev);
		const token = this._token = {};
		const seq = this.mode === "sequential";
		const from = this._morphSnapshot(this.stage);
		this._cancel();
		this.current = target;
		let metaFinish = null;
		if (target === prev + 1) {
			this._updateStepButtons();
			metaFinish = this._beginMetaPromote(target);
		} else this._syncUI();
		this._renderInto(this.stage, this.data.steps[target].latex);
		if (await this._morphFlight(from, this.stage, {
			token,
			seq
		})) {
			this._running = [];
			this._renderInto(this.stage, this.data.steps[target].latex);
			this._capOverflow();
			if (metaFinish) metaFinish();
		}
	}
	async _morphFlight(from, toRoot, { token, seq, ghostHost = toRoot, deleteGhosts = true, onSetup = null } = {}) {
		const fromLeaves = from.leaves;
		const fromRects = from.rects;
		const stageRect = ghostHost.getBoundingClientRect();
		const cloneOf = from.cloneOf;
		const fromFontSize = from.fontSize;
		const fromUntagged = from.untagged;
		const fromParens = from.parens;
		const fromDecos = from.decos;
		const toLeaves = this._leaves(toRoot);
		const toRects = this._nodeRects(toRoot);
		const splitOrigins = this._aliasOccurrences(fromRects, cloneOf, fromFontSize, toLeaves);
		const changedIds = /* @__PURE__ */ new Set();
		toLeaves.forEach((el, id) => {
			const old = cloneOf.get(id);
			if (old && old.textContent !== el.textContent) changedIds.add(id);
		});
		const await_ = (anims) => Promise.all(anims.map((a) => a.finished.catch(() => {})));
		const { blocks } = this._rigidBlocks(toRoot, fromRects, toRects, fromFontSize, changedIds);
		const movers = [];
		for (const blk of blocks) {
			const moved = Math.abs(blk.dx) > .5 || Math.abs(blk.dy) > .5;
			const scaled = Math.abs(blk.scale - 1) > .01;
			if (!moved && !scaled) continue;
			blk.el.classList.add("pa-move");
			blk.el.style.transformOrigin = "0 0";
			blk.el.style.transform = `translate(${blk.dx}px, ${blk.dy}px) scale(${blk.scale})`;
			movers.push(blk);
		}
		const insertEls = [];
		toLeaves.forEach((el, id) => {
			if (!fromRects.has(id) || changedIds.has(id)) {
				el.style.opacity = "0";
				insertEls.push(el);
			}
		});
		const toUntagged = this._untaggedGlyphs(toRoot);
		const _uMatch = this._lcsMatch(fromUntagged.map((u) => u.text), toUntagged.map((el) => el.textContent));
		const _uFromKeep = _uMatch.aKeep;
		const untagInserts = [];
		toUntagged.forEach((el, j) => {
			if (!_uMatch.bKeep.has(j)) {
				el.style.opacity = "0";
				untagInserts.push(el);
			}
		});
		const decoEls = [];
		const decoMovers = [];
		const srcDecoByKey = /* @__PURE__ */ new Map();
		for (const d of fromDecos) {
			if (!srcDecoByKey.has(d.key)) srcDecoByKey.set(d.key, []);
			srcDecoByKey.get(d.key).push(d);
		}
		const matchedSrcDeco = /* @__PURE__ */ new Set();
		for (const sel of DECORATIONS) toRoot.querySelectorAll(sel).forEach((el) => {
			const owner = el.closest("[data-n]");
			const key = (owner ? owner.getAttribute("data-n") : "") + "|" + sel;
			const pool = srcDecoByKey.get(key);
			const src = pool && pool.find((s) => !matchedSrcDeco.has(s));
			if (!src) {
				el.style.opacity = "0";
				decoEls.push(el);
				return;
			}
			const tr = el.getBoundingClientRect();
			const dx = src.rect.left - tr.left, dy = src.rect.top - tr.top;
			const sx = tr.width > 0 ? src.rect.width / tr.width : 1;
			const sy = tr.height > 0 ? src.rect.height / tr.height : 1;
			const changed = Math.abs(dx) > 1 || Math.abs(dy) > 1 || Math.abs(sx - 1) > .02 || Math.abs(sy - 1) > .02;
			if (sel === ".sqrt svg") {
				if (changed) {
					el.style.opacity = "0";
					decoEls.push(el);
				} else matchedSrcDeco.add(src);
				return;
			}
			matchedSrcDeco.add(src);
			if (changed) {
				el.style.transformOrigin = "0 0";
				el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
				decoMovers.push({
					el,
					dx,
					dy,
					sx,
					sy
				});
			}
		});
		const removedDecos = fromDecos.filter((d) => !matchedSrcDeco.has(d));
		const toParens = this._parens(toRoot);
		const _pTok = (p) => p.char + " " + p.content;
		const parenPairs = this._lcsPairs(fromParens.map(_pTok), toParens.map(_pTok));
		const _pFromKeep = new Set(parenPairs.map((pr) => pr[0]));
		const _pToKeep = new Set(parenPairs.map((pr) => pr[1]));
		const parenMovers = [];
		for (const [si, ti] of parenPairs) {
			const src = fromParens[si], el = toParens[ti].el;
			const tr = el.getBoundingClientRect();
			const dx = src.rect.left - tr.left, dy = src.rect.top - tr.top;
			const isSvg = !!el.querySelector("svg");
			const sx = !isSvg && tr.width > 0 ? src.rect.width / tr.width : 1;
			const sy = !isSvg && tr.height > 0 ? src.rect.height / tr.height : 1;
			if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || Math.abs(sx - 1) > .02 || Math.abs(sy - 1) > .02) {
				el.classList.add("pa-move");
				el.style.transformOrigin = "0 0";
				el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
				parenMovers.push({
					el,
					dx,
					dy,
					sx,
					sy
				});
			}
		}
		const parenInserts = [];
		toParens.forEach((p, j) => {
			if (!_pToKeep.has(j)) {
				p.el.style.opacity = "0";
				parenInserts.push(p.el);
			}
		});
		const removedParens = fromParens.filter((p, i) => !_pFromKeep.has(i));
		const ghosts = [];
		if (deleteGhosts) fromLeaves.forEach((el, id) => {
			if (toRects.has(id) && !changedIds.has(id)) return;
			if (splitOrigins.has(id)) return;
			const f = fromRects.get(id);
			const host = document.createElement("span");
			host.className = "katex pa-ghost";
			Object.assign(host.style, {
				position: "absolute",
				margin: "0",
				left: f.left - stageRect.left + "px",
				top: f.top - stageRect.top + "px",
				fontSize: fromFontSize.get(id)
			});
			host.appendChild(cloneOf.get(id));
			ghostHost.appendChild(host);
			this._ghosts.push(host);
			ghosts.push(host);
		});
		const untagGhosts = [];
		if (deleteGhosts) fromUntagged.forEach((u, ui) => {
			if (!_uFromKeep.has(ui)) {
				const host = document.createElement("span");
				host.className = "katex pa-ghost";
				Object.assign(host.style, {
					position: "absolute",
					margin: "0",
					left: u.rect.left - stageRect.left + "px",
					top: u.rect.top - stageRect.top + "px",
					fontSize: u.fontSize
				});
				host.appendChild(u.clone);
				ghostHost.appendChild(host);
				this._ghosts.push(host);
				untagGhosts.push(host);
			}
		});
		if (deleteGhosts) for (const d of removedDecos) {
			const host = document.createElement("span");
			host.className = "katex pa-ghost";
			let left = d.rect.left - stageRect.left, top = d.rect.top - stageRect.top;
			Object.assign(host.style, {
				position: "absolute",
				margin: "0",
				lineHeight: "0",
				left: left + "px",
				top: top + "px",
				fontSize: d.fontSize
			});
			host.appendChild(d.clone);
			ghostHost.appendChild(host);
			const sr = ghostHost.getBoundingClientRect();
			const cr = d.clone.getBoundingClientRect();
			const dx = d.rect.left - stageRect.left - (cr.left - sr.left);
			const dy = d.rect.top - stageRect.top - (cr.top - sr.top);
			if (dx || dy) {
				host.style.left = left + dx + "px";
				host.style.top = top + dy + "px";
			}
			this._ghosts.push(host);
			untagGhosts.push(host);
		}
		if (deleteGhosts) for (const p of removedParens) {
			const host = document.createElement("span");
			host.className = "katex pa-ghost";
			let left = p.rect.left - stageRect.left, top = p.rect.top - stageRect.top;
			Object.assign(host.style, {
				position: "absolute",
				margin: "0",
				lineHeight: "0",
				left: left + "px",
				top: top + "px",
				fontSize: p.fontSize
			});
			host.appendChild(p.clone);
			ghostHost.appendChild(host);
			const sr = ghostHost.getBoundingClientRect();
			const cr = p.clone.getBoundingClientRect();
			const dx = p.rect.left - stageRect.left - (cr.left - sr.left);
			const dy = p.rect.top - stageRect.top - (cr.top - sr.top);
			if (dx || dy) {
				host.style.left = left + dx + "px";
				host.style.top = top + dy + "px";
			}
			this._ghosts.push(host);
			untagGhosts.push(host);
		}
		if (onSetup) onSetup();
		const D_OUT = this._baseDuration * .6;
		const delAnims = [];
		let di = 0;
		for (const host of ghosts) {
			const a = this._tween(host, [{ opacity: 1 }, { opacity: 0 }], {
				duration: D_OUT,
				delay: seq ? di++ * this._baseStagger : 0,
				easing: EASE,
				fill: "forwards"
			});
			a.onfinish = () => host.remove();
			delAnims.push(a);
		}
		const _outAfter = (seq ? di * this._baseStagger : 0) + D_OUT;
		let dk = 0;
		for (const host of untagGhosts) {
			const a = this._tween(host, [{ opacity: 1 }, { opacity: 0 }], {
				duration: D_OUT,
				delay: _outAfter + (seq ? dk++ * this._baseStagger : 0),
				easing: EASE,
				fill: "forwards"
			});
			a.onfinish = () => host.remove();
			delAnims.push(a);
		}
		this._running = delAnims;
		await await_(delAnims);
		if (this._token !== token) return false;
		const moveAnims = [];
		let mi = 0;
		for (const blk of movers) {
			const a = this._tween(blk.el, [{ transform: `translate(${blk.dx}px, ${blk.dy}px) scale(${blk.scale})` }, { transform: "translate(0px, 0px) scale(1)" }], {
				duration: this._baseDuration,
				delay: seq ? mi++ * this._baseStagger : 0,
				easing: EASE,
				fill: "both"
			});
			a.onfinish = () => {
				blk.el.style.transform = "";
				blk.el.style.transformOrigin = "";
				if (!blk.single) blk.el.classList.remove("pa-move");
			};
			moveAnims.push(a);
		}
		for (const dm of decoMovers) {
			const a = this._tween(dm.el, [{ transform: `translate(${dm.dx}px, ${dm.dy}px) scale(${dm.sx}, ${dm.sy})` }, { transform: "translate(0px, 0px) scale(1, 1)" }], {
				duration: this._baseDuration,
				delay: seq ? mi++ * this._baseStagger : 0,
				easing: EASE,
				fill: "both"
			});
			a.onfinish = () => {
				dm.el.style.transform = "";
				dm.el.style.transformOrigin = "";
			};
			moveAnims.push(a);
		}
		for (const pm of parenMovers) {
			const a = this._tween(pm.el, [{ transform: `translate(${pm.dx}px, ${pm.dy}px) scale(${pm.sx}, ${pm.sy})` }, { transform: "translate(0px, 0px) scale(1, 1)" }], {
				duration: this._baseDuration,
				delay: seq ? mi++ * this._baseStagger : 0,
				easing: EASE,
				fill: "both"
			});
			a.onfinish = () => {
				pm.el.style.transform = "";
				pm.el.style.transformOrigin = "";
				pm.el.classList.remove("pa-move");
			};
			moveAnims.push(a);
		}
		this._running = moveAnims;
		await await_(moveAnims);
		if (this._token !== token) return false;
		const D_IN = this._baseDuration * .7;
		const insAnims = [];
		let ii = 0;
		for (const el of insertEls) {
			el.classList.add("pa-move", "pa-insert");
			const a = this._tween(el, [{
				opacity: 0,
				transform: "scale(.6)"
			}, {
				opacity: 1,
				transform: "none"
			}], {
				duration: D_IN,
				delay: seq ? ii++ * this._baseStagger : 0,
				easing: EASE,
				fill: "both"
			});
			a.onfinish = () => el.style.opacity = "";
			insAnims.push(a);
		}
		const _inAfter = (seq ? ii * this._baseStagger : 0) + D_IN;
		let ik = 0;
		for (const el of [
			...decoEls,
			...untagInserts,
			...parenInserts
		]) {
			const a = this._tween(el, [{ opacity: 0 }, { opacity: 1 }], {
				duration: D_IN,
				delay: _inAfter + (seq ? ik++ * this._baseStagger : 0),
				easing: EASE,
				fill: "both"
			});
			a.onfinish = () => el.style.opacity = "";
			insAnims.push(a);
		}
		this._running = insAnims;
		await await_(insAnims);
		return this._token === token;
	}
	async _stackedGoTo(target, prev) {
		const token = this._token = {};
		const seq = this.mode === "sequential";
		this._cancel();
		this._hideStepAskBtn();
		this._syncLines(prev + 1);
		this.current = target;
		let metaFinish = null;
		if (target === prev + 1) {
			this._updateStepButtons();
			metaFinish = this._beginMetaPromote(target);
		} else this._syncUI();
		if ((target > prev ? await this._stackedAdvance(prev, target, token, seq) : await this._stackedRetreat(prev, target, token, seq)) && this.stacked) {
			this._running = [];
			this._syncLines(target + 1);
			if (target > prev) {
				const pill = this._lineAt(target) && this._lineAt(target).querySelector(".pa-line-pill");
				if (pill) this._tween(pill, [{ opacity: 0 }, { opacity: 1 }], {
					duration: this._baseDuration * .5,
					easing: EASE,
					fill: "backwards"
				});
			}
			this._scrollToCurrent(false);
			this._capOverflow();
			if (metaFinish) metaFinish();
		}
	}
	async _stackedAdvance(prev, target, token, seq) {
		const linesEl = this._linesEl;
		const h0 = linesEl.getBoundingClientRect().height;
		const faders = [];
		for (let i = prev + 1; i <= target; i++) {
			const line = document.createElement("div");
			line.className = "pa-line";
			linesEl.appendChild(line);
			this._renderLine(line, i);
			line.dataset.dirty = "1";
			if (i < target) {
				line.style.opacity = "0";
				faders.push(line);
			} else line.style.visibility = "hidden";
		}
		const targetLine = this._lineAt(target);
		const prevLine = this._lineAt(prev);
		const fullFs = prevLine ? parseFloat(getComputedStyle(prevLine).fontSize) : 0;
		this._markCurrentLine();
		const h1 = linesEl.getBoundingClientRect().height;
		const dimOp = getComputedStyle(this.container).getPropertyValue("--pa-hist-dim").trim() || "1";
		const D_EXP = this._baseDuration * .6;
		const expAnims = [];
		if (!this._fitHeight && h1 - h0 > 1) {
			linesEl.style.overflow = "hidden";
			expAnims.push(this._tween(linesEl, [{ height: `${h0}px` }, { height: `${h1}px` }], {
				duration: D_EXP,
				easing: EASE,
				fill: "both"
			}));
		}
		if (prevLine) {
			const smallFs = parseFloat(getComputedStyle(prevLine).fontSize);
			if (Math.abs(fullFs - smallFs) > .5 || Number(dimOp) < 1) expAnims.push(this._tween(prevLine, [{
				fontSize: `${fullFs}px`,
				opacity: 1
			}, {
				fontSize: `${smallFs}px`,
				opacity: dimOp
			}], {
				duration: D_EXP,
				easing: EASE,
				fill: "both"
			}));
		}
		for (const line of faders) {
			const a = this._tween(line, [{ opacity: 0 }, { opacity: dimOp }], {
				duration: D_EXP,
				easing: EASE,
				fill: "both"
			});
			a.onfinish = () => line.style.opacity = "";
			expAnims.push(a);
		}
		if (expAnims.length) {
			this._running = expAnims;
			await Promise.all(expAnims.map((a) => a.finished.catch(() => {})));
			if (this._token !== token) return false;
			expAnims.forEach((a) => {
				try {
					a.cancel();
				} catch (e) {}
			});
			for (const line of faders) line.style.opacity = "";
			linesEl.style.height = "";
			linesEl.style.overflow = "";
		}
		this._scrollToCurrent(false);
		const from = this._morphSnapshot(this._lineAt(prev));
		return this._morphFlight(from, targetLine, {
			token,
			seq,
			ghostHost: this.stage,
			deleteGhosts: false,
			onSetup: () => {
				targetLine.style.visibility = "";
				const pill = targetLine.querySelector(".pa-line-pill");
				if (pill) pill.style.opacity = "0";
			}
		});
	}
	async _stackedRetreat(prev, target, token, seq) {
		const linesEl = this._linesEl;
		const fromLine = this._lineAt(prev);
		const toLine = this._lineAt(target);
		if (!fromLine || !toLine) return this._token === token;
		const smallFs = parseFloat(getComputedStyle(toLine).fontSize);
		const smallOp = getComputedStyle(toLine).opacity;
		fromLine.style.fontSize = getComputedStyle(fromLine).fontSize;
		fromLine.style.opacity = "1";
		this._markCurrentLine();
		const fullFs = parseFloat(getComputedStyle(toLine).fontSize);
		if (Math.abs(fullFs - smallFs) > .5 || Number(smallOp) < 1) {
			const a = this._tween(toLine, [{
				fontSize: `${smallFs}px`,
				opacity: smallOp
			}, {
				fontSize: `${fullFs}px`,
				opacity: 1
			}], {
				duration: this._baseDuration * .5,
				easing: EASE,
				fill: "both"
			});
			this._running = [a];
			await a.finished.catch(() => {});
			if (this._token !== token) return false;
			try {
				a.cancel();
			} catch (e) {}
		}
		this._scrollToCurrent(false);
		const stageRect = this.stage.getBoundingClientRect();
		const fromLeaves = this._leaves(fromLine);
		const fromRects = this._nodeRects(fromLine);
		const toLeaves = this._leaves(toLine);
		const toRects = this._nodeRects(toLine);
		const toFontSize = /* @__PURE__ */ new Map();
		toLeaves.forEach((el, id) => toFontSize.set(id, getComputedStyle(el).fontSize));
		const pairs = this._pairLeaves([...fromLeaves.keys()], [...toLeaves.keys()]);
		const changedIds = /* @__PURE__ */ new Set();
		fromLeaves.forEach((el, id) => {
			const t = toLeaves.get(id);
			if (t && t.textContent !== el.textContent) changedIds.add(id);
		});
		const D = this._baseDuration;
		const flyAnims = [];
		let fi = 0;
		fromLeaves.forEach((el, id) => {
			if (changedIds.has(id)) return;
			const f = fromRects.get(id);
			for (const tid of pairs.get(id) || []) {
				const t = toRects.get(tid);
				if (!t) continue;
				const sfs = parseFloat(getComputedStyle(el).fontSize);
				const tfs = parseFloat(toFontSize.get(tid));
				let s = sfs > 0 && tfs > 0 ? tfs / sfs : 1;
				if (Math.abs(s - 1) < .02) s = 1;
				const host = document.createElement("span");
				host.className = "katex pa-ghost";
				Object.assign(host.style, {
					position: "absolute",
					margin: "0",
					left: f.left - stageRect.left + "px",
					top: f.top - stageRect.top + "px",
					fontSize: getComputedStyle(el).fontSize,
					transformOrigin: "0 0"
				});
				host.appendChild(el.cloneNode(true));
				this.stage.appendChild(host);
				this._ghosts.push(host);
				const a = this._tween(host, [{ transform: "translate(0px, 0px) scale(1)" }, { transform: `translate(${t.left - f.left}px, ${t.top - f.top}px) scale(${s})` }], {
					duration: D,
					delay: seq ? fi++ * this._baseStagger : 0,
					easing: EASE,
					fill: "both"
				});
				a.onfinish = () => host.remove();
				flyAnims.push(a);
			}
		});
		const drop = [];
		for (let i = target + 1; i <= prev; i++) {
			const l = this._lineAt(i);
			if (l) drop.push(l);
		}
		for (const line of drop) flyAnims.push(this._tween(line, [{ opacity: getComputedStyle(line).opacity }, { opacity: 0 }], {
			duration: D * .6,
			easing: EASE,
			fill: "both"
		}));
		this._running = flyAnims;
		await Promise.all(flyAnims.map((a) => a.finished.catch(() => {})));
		if (this._token !== token) return false;
		const h1 = linesEl.getBoundingClientRect().height;
		for (const line of drop) line.style.display = "none";
		const h0 = linesEl.getBoundingClientRect().height;
		if (!this._fitHeight && h1 - h0 > 1) {
			linesEl.style.overflow = "hidden";
			const a = this._tween(linesEl, [{ height: `${h1}px` }, { height: `${h0}px` }], {
				duration: this._baseDuration * .6,
				easing: EASE,
				fill: "both"
			});
			this._running = [a];
			await a.finished.catch(() => {});
			if (this._token !== token) return false;
			try {
				a.cancel();
			} catch (e) {}
			linesEl.style.overflow = "";
			linesEl.style.height = "";
		}
		return this._token === token;
	}
	_syncPlayUI() {
		const playing = !!this._playId && !this._paused;
		const b = this.container.querySelector(".pa-play");
		if (!b) return;
		b.textContent = playing ? "⏸ Pause" : "▶ Play";
		const tip = playing ? "Pause" : "Play through";
		b.setAttribute("data-tip", tip);
		b.setAttribute("aria-label", tip);
	}
	_togglePlay() {
		if (this._paused) return this._resume();
		if (this._playId) return this._pause();
		return this.play();
	}
	_openPauseGate() {
		if (this._pauseOpen) {
			this._pauseOpen();
			this._pauseOpen = null;
		}
		this._pauseGate = null;
	}
	_pause() {
		this._paused = true;
		this._pauseGate = new Promise((r) => this._pauseOpen = r);
		for (const a of this._running) try {
			a.pause();
		} catch (e) {}
		this._syncPlayUI();
	}
	_resume() {
		this._paused = false;
		this._openPauseGate();
		for (const a of this._running) try {
			a.play();
		} catch (e) {}
		this._syncPlayUI();
	}
	_userGoTo(target) {
		this._playId = null;
		this._paused = false;
		this._openPauseGate();
		this._syncPlayUI();
		return this.goTo(target);
	}
	async play() {
		const playId = this._playId = {};
		this._paused = false;
		this._openPauseGate();
		this._syncPlayUI();
		try {
			if (this.current >= this.data.steps.length - 1) await this.goTo(0);
			for (let t = this.current + 1; t < this.data.steps.length; t++) {
				while (this._paused && this._playId === playId) await this._pauseGate;
				if (this._playId !== playId) return;
				await this.goTo(t);
				if (this._playId !== playId) return;
				await new Promise((r) => setTimeout(r, this._baseStepPause / this.speed));
			}
			while (this._paused && this._playId === playId) await this._pauseGate;
		} finally {
			if (this._playId === playId) {
				this._playId = null;
				this._paused = false;
				this._syncPlayUI();
			}
		}
	}
	_caption(el, text) {
		el.innerHTML = "";
		const s = String(text);
		let last = 0, m;
		_CAPTION_RE.lastIndex = 0;
		while ((m = _CAPTION_RE.exec(s)) !== null) {
			if (m.index > last) el.appendChild(document.createTextNode(s.slice(last, m.index)));
			const tok = m[0];
			const inner = tok[0] === "$" || tok[0] === "`" ? tok.slice(1, -1) : tok.slice(2, -2);
			const span = document.createElement("span");
			try {
				this.katex.render(inner, span, {
					throwOnError: false,
					displayMode: false
				});
			} catch (e) {
				span.textContent = inner;
			}
			el.appendChild(span);
			last = m.index + tok.length;
		}
		if (last < s.length) el.appendChild(document.createTextNode(s.slice(last)));
	}
	_syncUI() {
		this._updateStepButtons();
		this._caption(this.container.querySelector(".pa-op"), this._opText(this.current));
		this._setConfBadge(this.current);
		this._caption(this.container.querySelector(".pa-just"), this.data.steps[this.current].justification || "");
		this._setNextPill(this.container.querySelector(".pa-next-pill"), this.current);
	}
	_conf(idx) {
		const s = this.data.steps[idx];
		return s && s.confidence && s.confidence.tier ? s.confidence : null;
	}
	_setConfBadge(idx, badge) {
		const el = badge || this.container.querySelector(".pa-conf-badge");
		if (!el) return;
		const c = this._conf(idx);
		el.className = "pa-conf-badge";
		el.textContent = "";
		el.removeAttribute("data-tip");
		el.removeAttribute("aria-label");
		if (!c) return;
		el.classList.add(`pa-conf-${c.tier}`);
		el.textContent = _tierGlyph(c.tier, c.icon);
		let tip = c.relation === "unknown" && c.tier !== "domain" ? `${c.label} — ${c.meaning || ""}${c.reason ? ` (${c.reason})` : ""}` : `${c.label} — ${c.reason || c.meaning || ""}`;
		this._attachMathTip(el, tip);
	}
	_attachMathTip(el, text) {
		el._mathTipText = text || "";
		el.setAttribute("aria-label", this._plainOp(text || ""));
		el.removeAttribute("data-tip");
		if (el._mathTipBound) return;
		el._mathTipBound = true;
		const show = () => this._showMathTip(el);
		const hide = () => this._hideMathTip();
		el.addEventListener("mouseenter", show);
		el.addEventListener("mouseleave", hide);
		el.addEventListener("focus", show);
		el.addEventListener("blur", hide);
	}
	_showMathTip(el) {
		const text = el && el._mathTipText;
		if (!text) return;
		this._mathTipFor = el;
		let tip = this._mathTip;
		if (!tip) {
			tip = document.createElement("div");
			tip.className = "pa-mathtip";
			this.container.appendChild(tip);
			this._mathTip = tip;
		}
		this._caption(tip, text);
		const cr = this.container.getBoundingClientRect();
		const br = el.getBoundingClientRect();
		const tw = tip.offsetWidth, th = tip.offsetHeight;
		let left = br.left - cr.left + br.width / 2 - tw / 2;
		left = Math.max(4, Math.min(left, cr.width - tw - 4));
		let top = br.top - cr.top - th - 8;
		if (top < 4) top = br.bottom - cr.top + 8;
		tip.style.left = `${left}px`;
		tip.style.top = `${top}px`;
		tip.style.opacity = "1";
	}
	_hideMathTip() {
		this._mathTipFor = null;
		if (this._mathTip) this._mathTip.style.opacity = "0";
	}
	_setOverall() {
		const el = this.container.querySelector(".pa-overall");
		if (!el) return;
		const oc = this.data.overall_confidence;
		if (!oc || !oc.tier) {
			el.remove();
			return;
		}
		el.classList.add(`pa-conf-${oc.tier}`);
		const icon = document.createElement("span");
		icon.className = "pa-overall-icon";
		icon.textContent = _tierGlyph(oc.tier, oc.icon);
		const label = document.createElement("span");
		label.className = "pa-overall-label";
		label.textContent = oc.label || oc.tier;
		el.append(icon, label);
		const counts = oc.counts || {};
		const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
		if (total > 0) {
			const good = (counts.grounded || 0) + (counts.verified || 0);
			const count = document.createElement("span");
			count.className = "pa-overall-count";
			count.textContent = `· ${good}/${total}`;
			el.append(count);
		}
		if (this._aiAsk) {
			el.classList.add("pa-overall-has-ask");
			el.append(this._aiAsk("pa-ask-btn pa-ask-overall", "Explain this confidence rating", () => this._askOverallMessage()));
		}
		const tip = `${oc.label} — ${oc.reason || oc.meaning || ""} · click to pin details`;
		this._attachMathTip(el, tip);
		el.setAttribute("role", "button");
		el.setAttribute("tabindex", "0");
		el.setAttribute("aria-pressed", "false");
		const toggle = () => {
			const on = this.container.classList.toggle("pa-conf-on");
			el.setAttribute("aria-pressed", String(on));
		};
		el.addEventListener("click", toggle);
		el.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggle();
			}
		});
		el.addEventListener("mouseenter", () => this.container.classList.add("pa-conf-peek"));
		el.addEventListener("mouseleave", () => this.container.classList.remove("pa-conf-peek"));
	}
	_updateStepButtons() {
		this.container.querySelectorAll(".pa-step").forEach((b, i) => b.classList.toggle("pa-active", i === this.current));
		if (this._deriveBtnEl) this._deriveBtnEl.style.display = this.current === 0 ? "none" : "";
	}
	_fitControls() {
		const controls = this.container.querySelector(".pa-controls");
		const steps = this.container.querySelector(".pa-steps");
		if (!controls || !steps) return;
		controls.classList.remove("pa-compact");
		const cs = getComputedStyle(controls);
		const gap = parseFloat(cs.columnGap || cs.gap) || 0;
		const kids = [...controls.children];
		if (kids.reduce((sum, k) => sum + k.offsetWidth, 0) + gap * Math.max(0, kids.length - 1) > controls.clientWidth + 1) controls.classList.add("pa-compact");
	}
	_opText(idx) {
		const s = this.data.steps[idx];
		return s.operation ? `${idx}. ${s.operation}` : `state ${idx}`;
	}
	_plainOp(s) {
		return String(s).replace(/\$|`|\\\(|\\\)|\\\[|\\\]/g, "").replace(/\\left|\\right/g, "").replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1/$2").replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)").replace(/\\cdot/g, "·").replace(/\\times/g, "×").replace(/\^\{([^{}]*)\}/g, "^$1").replace(/_\{([^{}]*)\}/g, "_$1").replace(/\\[a-zA-Z]+/g, "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
	}
	_nextOpText(idx) {
		const n = this.data.steps[idx + 1];
		return n ? n.operation || `state ${idx + 1}` : null;
	}
	_stepExpr(idx) {
		const s = this.data.steps[idx];
		return s.plain || s.input_latex || s.latex || "";
	}
	_deriveCurrent(anchorEl) {
		if (!this._onDerive) return;
		const i = this.current;
		const target = this._stepExpr(i);
		if (!target) return;
		const payload = { target_latex: target };
		if (this.data.domain) payload.domain = this.data.domain;
		if (i > 0) {
			const prev = this._stepExpr(i - 1);
			if (prev && prev.trim() && prev.trim() !== target.trim()) payload.start_latex = prev;
		}
		const previous_steps = this.data.steps.slice(0, i).map((s, k) => ({
			step: k + 1,
			label: s.operation || null,
			math: this._stepExpr(k)
		})).filter((p) => p.math);
		if (previous_steps.length) payload.previous_steps = previous_steps;
		const op = this.data.steps[i].operation;
		if (op) payload.intent = String(op).trim();
		this._onDerive(payload, anchorEl);
	}
	_askCurrentMessage() {
		return this._askStepMessage(this.current);
	}
	_askStepMessage(i) {
		const s = this.data.steps[i];
		let msg = `I'm looking at step ${i} of the derivation` + (this.data.title ? ` "${this.data.title}"` : "") + `:\n$$${this._stepExpr(i)}$$`;
		if (s.operation) msg += `\nOperation: ${s.operation}`;
		if (s.justification) msg += `\nJustification: ${s.justification}`;
		const c = this._conf(i);
		if (c && c.tier === "domain") {
			msg += `\n\nNote: a symbolic checker could NOT verify this step — it's marked "${c.label || "Domain"}" (${c.meaning || "valid by domain knowledge, not a symbolic identity"}).`;
			if (c.reason) msg += ` The reasoning given was: ${c.reason}.`;
			msg += "\nIs that domain justification sound? Explain the principle it relies on and whether the step genuinely follows.";
		} else msg += `\nCan you explain this step — what it does and why it's valid?`;
		return msg;
	}
	_askNextMessage() {
		const i = this.current;
		const n = this.data.steps[i + 1];
		let msg = `I'm working through the derivation` + (this.data.title ? ` "${this.data.title}"` : "") + ` and the current expression (step ${i}) is:\n$$${this._stepExpr(i)}$$`;
		if (n) {
			msg += `\nThe next step is "${n.operation || `state ${i + 1}`}"`;
			if (n.justification) msg += ` (justification: ${n.justification})`;
			msg += `.`;
		}
		msg += "\nBefore revealing the resulting expression, help me predict it myself: ask me what this operation does to the expression and why it's justified, let me attempt the result, and only then confirm or correct it.";
		return msg;
	}
	_askOverallMessage() {
		const oc = this.data && this.data.overall_confidence || {};
		const title = this.data && this.data.title ? ` "${this.data.title}"` : "";
		const tier = oc.label || oc.tier || "this";
		const counts = oc.counts || {};
		const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
		let m = `The derivation${title} carries an overall confidence of "${tier}"`;
		if (total) {
			const bits = [`${(counts.grounded || 0) + (counts.verified || 0)}/${total} steps verified`];
			if (counts.plausible) bits.push(`${counts.plausible} plausible`);
			if (counts.domain) bits.push(`${counts.domain} domain-vouched`);
			if (oc.endpoint_reached === false) bits.push(`the target endpoint was not reached`);
			m += ` (${bits.join(", ")})`;
		}
		if (oc.meaning) m += `. ${oc.meaning}`;
		return m + `.\n\nExplain what this "${tier}" confidence rating means here — how the steps are checked, why the derivation earned this tier rather than a higher one, and how much I should trust the result.`;
	}
	_beginMetaPromote(target) {
		const meta = this.container.querySelector(".pa-meta");
		const opEl = meta.querySelector(".pa-op");
		const justEl = meta.querySelector(".pa-just");
		const nextEl = meta.querySelector(".pa-next-pill");
		const badgeEl = meta.querySelector(".pa-conf-badge");
		const metaRect = meta.getBoundingClientRect();
		const opRect = opEl.getBoundingClientRect();
		const justRect = justEl.getBoundingClientRect();
		const nextRect = nextEl.getBoundingClientRect();
		const badgeShown = badgeEl && getComputedStyle(badgeEl).display !== "none";
		const badgeRect = badgeShown ? badgeEl.getBoundingClientRect() : null;
		const nextWasShown = !nextEl.classList.contains("pa-next-hidden");
		this._metaGhosts = this._metaGhosts || [];
		this._metaAnims = this._metaAnims || [];
		const Dbadge = this._baseDuration;
		const ghostOut = (el, rect, duration = this._baseDuration * .55) => {
			if (!el.textContent.trim()) return;
			const g = el.cloneNode(true);
			g.classList.add("pa-meta-ghost");
			g.style.position = "absolute";
			g.removeAttribute("data-tip");
			g.removeAttribute("aria-label");
			g.style.left = rect.left - metaRect.left + "px";
			g.style.top = rect.top - metaRect.top + "px";
			g.style.width = Math.ceil(rect.width) + "px";
			meta.appendChild(g);
			this._metaGhosts.push(g);
			const a = this._tween(g, [{ opacity: 1 }, { opacity: 0 }], {
				duration,
				easing: EASE,
				fill: "forwards"
			});
			a.onfinish = () => g.remove();
			this._metaAnims.push(a);
		};
		ghostOut(opEl, opRect);
		ghostOut(justEl, justRect);
		if (badgeShown) ghostOut(badgeEl, badgeRect, Dbadge);
		this._caption(opEl, this._opText(target));
		this._setConfBadge(target);
		this._caption(justEl, this.data.steps[target].justification || "");
		justEl.style.opacity = "0";
		nextEl.style.opacity = "0";
		const newOpRect = opEl.getBoundingClientRect();
		const dx = (nextWasShown ? nextRect.left : newOpRect.left) - newOpRect.left;
		const dy = (nextWasShown ? nextRect.top : newOpRect.top) - newOpRect.top;
		if (dx || dy) {
			opEl.classList.add("pa-promoting");
			const a = this._tween(opEl, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
				duration: this._baseDuration,
				easing: EASE,
				fill: "both"
			});
			a.onfinish = () => {
				opEl.style.transform = "";
				opEl.classList.remove("pa-promoting");
			};
			this._metaAnims.push(a);
		}
		if (badgeShown) {
			badgeEl.style.opacity = "0";
			const ba = this._tween(badgeEl, [{ opacity: 0 }, { opacity: 1 }], {
				duration: Dbadge,
				delay: Dbadge,
				easing: EASE,
				fill: "both"
			});
			ba.onfinish = () => badgeEl.style.opacity = "";
			this._metaAnims.push(ba);
		}
		return () => {
			const ja = this._tween(justEl, [{ opacity: 0 }, { opacity: 1 }], {
				duration: this._baseDuration * .6,
				easing: EASE,
				fill: "both"
			});
			ja.onfinish = () => justEl.style.opacity = "";
			this._metaAnims.push(ja);
			this._setNextPill(nextEl, target);
			if (!nextEl.classList.contains("pa-next-hidden")) {
				nextEl.style.opacity = "0";
				const na = this._tween(nextEl, [{ opacity: 0 }, { opacity: 1 }], {
					duration: this._baseDuration * .6,
					delay: this._baseDuration * .7,
					easing: EASE,
					fill: "both"
				});
				na.onfinish = () => nextEl.style.opacity = "";
				this._metaAnims.push(na);
			}
		};
	}
	_cancelMeta() {
		(this._metaAnims || []).forEach((a) => {
			try {
				a.cancel();
			} catch (e) {}
		});
		this._metaAnims = [];
		(this._metaGhosts || []).forEach((g) => g.remove());
		this._metaGhosts = [];
		const opEl = this.container.querySelector(".pa-op");
		if (opEl) {
			opEl.style.transform = "";
			opEl.style.opacity = "";
			opEl.classList.remove("pa-promoting");
		}
		const justEl = this.container.querySelector(".pa-just");
		if (justEl) justEl.style.opacity = "";
		const nextEl = this.container.querySelector(".pa-next-pill");
		if (nextEl) nextEl.style.opacity = "";
		const badgeEl = this.container.querySelector(".pa-conf-badge");
		if (badgeEl) badgeEl.style.opacity = "";
	}
	_setNextPill(el, idx) {
		if (!el) return;
		const txt = this._nextOpText(idx);
		el.innerHTML = "";
		el.removeAttribute("data-tip");
		if (txt == null) {
			el.classList.add("pa-next-hidden");
			el.removeAttribute("aria-label");
			el.removeAttribute("data-fulltip");
			return;
		}
		el.classList.remove("pa-next-hidden");
		const tip = "Next: " + this._plainOp(txt);
		el.setAttribute("data-fulltip", tip);
		el.setAttribute("aria-label", tip);
		const label = document.createElement("span");
		label.className = "pa-next-label";
		label.textContent = "Next";
		const body = document.createElement("span");
		body.className = "pa-next-body";
		this._caption(body, txt);
		el.append(label, body);
		if (this._nextAskBtn) el.appendChild(el === this._nextPillEl ? this._nextAskBtn : this._nextAskBtn.cloneNode(true));
		this._updateNextTip(el);
	}
	_updateNextTip(pill) {
		const el = pill || this.container.querySelector(".pa-next-pill");
		if (!el || el.classList.contains("pa-next-hidden")) return;
		const body = el.querySelector(".pa-next-body");
		const full = el.getAttribute("data-fulltip");
		if (body && full && body.scrollWidth > body.clientWidth + 1) el.setAttribute("data-tip", full);
		else el.removeAttribute("data-tip");
	}
};
//#endregion
//#region src/proof-animation/validate-proof.ts
var MAX_STEPS = 300;
var MAX_TERMS = 2e3;
var MAX_STR = 5e4;
var CHANGE_TYPES = /* @__PURE__ */ new Set([
	"rewrite",
	"solve",
	"substitute",
	"approximate",
	"given"
]);
/** Coerce a value to a bounded string (defends against huge / non-string fields). */
function str(v) {
	if (v == null) return "";
	return String(v).slice(0, MAX_STR);
}
/**
* Sanitize a proof "deeplink" — the full-app view an "Ask AI" opens. Hostile
* input, so allow ONLY a same-origin RELATIVE form: a leading "/" path or a bare
* "?query". Reject any scheme (javascript:, data:, http:), protocol-relative
* "//host", and off-origin URLs; drop the hash. Returns "pathname + search", or
* undefined. (Origin = the CURRENT page's, so it validates against wherever this
* runs — the renderproof page or the app, both same app origin.)
*/
function cleanDeeplink(v) {
	if (typeof v !== "string") return void 0;
	const s = v.trim();
	if (!s || s.length > 1024) return void 0;
	if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return void 0;
	if (s.startsWith("//")) return void 0;
	if (!(s.startsWith("/") || s.startsWith("?"))) return void 0;
	try {
		const u = new URL(s, location.origin);
		if (u.origin !== location.origin) return void 0;
		return u.pathname + u.search;
	} catch (e) {
		return;
	}
}
/** Shallow-sanitize a confidence object: keep known keys, primitives only. */
function cleanConfidence(c) {
	if (!c || typeof c !== "object") return void 0;
	const src = c;
	const out = {};
	for (const k of [
		"tier",
		"label",
		"icon",
		"meaning",
		"relation",
		"reason"
	]) if (src[k] != null) out[k] = str(src[k]);
	if (typeof src.type_consistent === "boolean") out.type_consistent = src.type_consistent;
	if (src.judged === true) out.judged = true;
	if (typeof src.endpoint_reached === "boolean") out.endpoint_reached = src.endpoint_reached;
	if (src.counts && typeof src.counts === "object") {
		const counts = {};
		out.counts = counts;
		for (const [k, n] of Object.entries(src.counts)) if (typeof n === "number" && isFinite(n)) counts[str(k)] = n;
	}
	return out;
}
/** Whether an untrusted value is one of the whitelisted change types. */
function isChangeType(v) {
	return CHANGE_TYPES.has(v);
}
/**
* Whitelist-validate a proof payload into a clean object the engine can consume.
* Throws on anything structurally wrong. Unknown keys are simply dropped.
*/
function validateProofData(data) {
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("proof must be a JSON object");
	const raw = data;
	if (!Array.isArray(raw.steps) || raw.steps.length === 0) throw new Error("proof has no steps");
	if (raw.steps.length > MAX_STEPS) throw new Error(`too many steps (${raw.steps.length} > ${MAX_STEPS})`);
	const steps = raw.steps.map((s, i) => {
		if (!s || typeof s !== "object") throw new Error(`step ${i} is not an object`);
		const src = s;
		const out = {
			index: typeof src.index === "number" && isFinite(src.index) ? src.index : i,
			operation: str(src.operation),
			justification: str(src.justification),
			input_latex: str(src.input_latex),
			latex: str(src.latex),
			plain: str(src.plain),
			confidence: cleanConfidence(src.confidence)
		};
		if (isChangeType(src.change_type)) out.change_type = src.change_type;
		const dl = cleanDeeplink(src.deeplink);
		if (dl) out.deeplink = dl;
		return out;
	});
	const terms = {};
	if (raw.terms && typeof raw.terms === "object" && !Array.isArray(raw.terms)) {
		let n = 0;
		for (const [id, t] of Object.entries(raw.terms)) {
			if (n++ >= MAX_TERMS) break;
			if (!t || typeof t !== "object") continue;
			const term = t;
			terms[str(id)] = {
				latex: str(term.latex),
				name: str(term.name),
				description: str(term.description)
			};
		}
	}
	const out = {
		title: str(raw.title),
		domain: str(raw.domain),
		steps,
		terms,
		overall_confidence: cleanConfidence(raw.overall_confidence)
	};
	if (raw.goal) out.goal = str(raw.goal);
	const chipList = (v) => {
		if (!Array.isArray(v)) return void 0;
		const items = [];
		for (const x of v) {
			if (items.length >= 8) break;
			if (typeof x === "string" && x.trim()) {
				items.push(str(x));
				continue;
			}
			if (x && typeof x === "object") {
				const src = x;
				if (typeof src.text === "string" && src.text.trim()) {
					const chip = { text: str(src.text) };
					const cdl = cleanDeeplink(src.deeplink);
					if (cdl) chip.deeplink = cdl;
					items.push(chip);
				}
			}
		}
		return items.length ? items : void 0;
	};
	const followups = chipList(raw.followups);
	if (followups) out.followups = followups;
	const prerequisites = chipList(raw.prerequisites);
	if (prerequisites) out.prerequisites = prerequisites;
	const dl = cleanDeeplink(raw.deeplink);
	if (dl) out.deeplink = dl;
	return out;
}
//#endregion
//#region src/theme.ts
var THEMES = /* @__PURE__ */ new Set([
	"dark",
	"light",
	"auto"
]);
var THEME_KEY = "algebench-theme";
/** Resolve "auto" to a concrete dark|light via the OS; pass the rest through. */
function resolveTheme(t) {
	if (t === "auto") return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
	return t === "light" ? "light" : "dark";
}
/** Paint a theme (concrete or "auto") onto <html data-theme>. The engine,
*  page chrome, and modals all read it off CSS vars, so this recolors live. */
function applyTheme(t) {
	document.documentElement.dataset.theme = resolveTheme(t);
}
/** The saved light|dark preference, or null (storage can throw when blocked). */
function storedTheme(key = THEME_KEY) {
	try {
		const t = localStorage.getItem(key);
		return t === "dark" || t === "light" ? t : null;
	} catch (e) {
		return null;
	}
}
/** Persist a preference (best-effort; storage can be blocked). */
function persistTheme(t, key = THEME_KEY) {
	try {
		localStorage.setItem(key, t);
	} catch (e) {}
}
/** Canonical load precedence across app surfaces:
*  URL param override (allowlisted) → saved localStorage preference → fallback.
*  If the chosen value is "auto", resolve it against the OS as the final step. */
function initialTheme({ key = THEME_KEY, param = "theme", fallback = "dark", useStored = true } = {}) {
	const raw = param ? new URLSearchParams(location.search).get(param) : null;
	return resolveTheme(raw !== null && THEMES.has(raw) ? raw : useStored && storedTheme(key) || fallback);
}
/** Wire a header toggle button: flip dark<->light, persist it, and repaint the
*  glyph (☾ in dark, ☀ in light). Calls onChange(next) after each flip. Returns
*  the repaint fn so callers can re-sync the glyph (e.g. on an OS-theme change). */
function wireThemeToggle(btn, { key = THEME_KEY, onChange } = {}) {
	if (!btn) return () => {};
	const paint = () => {
		const cur = document.documentElement.dataset.theme === "light" ? "light" : "dark";
		btn.textContent = cur === "dark" ? "☾" : "☀";
		btn.title = "Switch to " + (cur === "dark" ? "light" : "dark") + " theme";
		btn.setAttribute("aria-label", btn.title);
	};
	paint();
	btn.addEventListener("click", () => {
		const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
		document.documentElement.dataset.theme = next;
		persistTheme(next, key);
		paint();
		if (onChange) onChange(next);
	});
	return paint;
}
//#endregion
export { USER_ICON as C, TRASH_ICON as S, NEXT_ICON as _, wireThemeToggle as a, PREV_ICON as b, AI_ICON as c, CODE_ICON as d, FIRST_ICON as f, LAST_ICON as g, GEAR_ICON as h, persistTheme as i, ANGLE_LOCK_ICON as l, FUNCTION_ANALYSIS_ICON as m, applyTheme as n, validateProofData as o, FULLSCREEN_ICON as p, initialTheme as r, ProofAnimator as s, THEMES as t, BRACES_ICON as u, PAUSE_ICON as v, SHARE_VIEW_ICON as x, PLAY_ICON as y };

//# sourceMappingURL=theme.js.map