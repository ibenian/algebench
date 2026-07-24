/**
 * proof-animation.js — realtime, Manim-style morphing of a derivation.
 *
 * Framework-free ES-module class (graph-panel pattern): point it at a container
 * + data; embeddable in the app and runnable from the local launcher.
 *
 * data = { title, steps: [ { index, operation, justification, latex, plain } ] }
 * where `latex` is annotated (\htmlData{n=<id>}) on EVERY glyph — variables,
 * numbers, operators (+ = · −) and exponents — and a piece that persists across
 * steps keeps the same id (threaded server-side). The id IS the correspondence.
 *
 * Morph (FLIP on the leaf `data-n` glyphs, keyed by id):
 *   - id in both states  → MOVE: translate old → new position (coordinate interp)
 *   - id only in current → DELETE: ghost fades out (during motion, phase 1)
 *   - id only in target  → INSERT: fades in AFTER all motion completes (phase 2)
 * So everything that persists (incl. operators/powers) interpolates; only new
 * items fade in and only removed items fade out. Any-to-any jumps work by id;
 * an interrupting click cancels the in-flight morph and retargets from live pos.
 */

const EASE = "cubic-bezier(0.42, 0, 0.58, 1)"; // ease-in-out

// Untagged structural decorations KaTeX draws (no data-n of their own): the
// fraction bar and the radical sign. When newly introduced they must fade in
// LAST with the other new items — never instantly. (These selectors hold no
// tagged glyphs, so hiding them won't hide content.)
// NOTE: stretchy delimiters (`.delimsizing`) are NOT here — parentheses (plain
// OR stretchy) are handled together by the unified paren matcher (`_parens`),
// so a paren that flips representation between steps morphs as one unit.
const DECORATIONS = [".frac-line", ".sqrt svg"];

// Delimiter glyphs the renderer emits via \left…\right (plain or stretchy).
const PAREN_RE = /^[()[\]|]$/;
const _parenChar = (s) => {
  const t = (s || "").replace(/[​-‍﻿]/g, "").trim();
  return PAREN_RE.test(t) ? t : null;
};

// Playback speed multipliers the speed button cycles through (click → next).
const SPEEDS = [0.25, 0.5, 1, 2, 4];

// Monochrome tier glyphs for the confidence badges. The server bakes COLOR emoji
// (🥇🥈🎓🔹…) into the proof JSON, but emoji ignore CSS `color`, so a dark cap
// muddies against a dark badge. These are plain text glyphs that inherit the
// badge's tier color (--pa-conf-fg), staying crisp on any theme. Keyed by tier;
// falls back to the baked icon for an unknown tier.
const TIER_GLYPH = {
  grounded:  "★",   // gold   — algebraically grounded (a CAS identity)
  verified:  "✓",   // silver — verified (strong evidence)
  domain:    "✦",   // teal   — domain-vouched (expert; CAS couldn't check)
  plausible: "◇",   // blue   — plausible (tentative)
  unchecked: "○",   // gray   — unchecked (undecided)
  refuted:   "✗",   // red    — refuted
};
const _tierGlyph = (tier, fallback) => TIER_GLYPH[tier] || fallback || "";

// Info (ⓘ) icon for the explore pill — static author-controlled markup.
const INFO_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/></svg>';

// Goal pill icon — a target/bullseye (the goal is the target). Idle state of the
// goal pill; hovering expands the pill to reveal the goal text (like the rank pill).
const GOAL_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>' +
  '<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>';

// AI sparkle icon for the engine-native ask buttons (rendered only when the app
// gives no aiAskButton factory but term-ask is enabled — standalone/embedded).
// Mirrors labels.js AI_SPARKLE_SVG so the engine stays dependency-free.
const AI_SPARKLE_SVG =
  '<svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11" aria-hidden="true">' +
  '<path d="M8 1c0 4-3 6.5-7 7 4 .5 7 3 7 7 0-4 3-6.5 7-7-4-.5-7-3-7-7z"/></svg>';

// Synthetic operator-node ids (from the backend structural renderer) for n-ary /
// relational nodes that SPAN many terms — a product/fraction, a sum, an equation.
// Hovering the bare chrome of one (a fraction bar, the space between factors)
// resolves via `closest('[data-n]')` to this big wrapper; we must NOT treat that
// as the hovered term (it would light the whole sub-expression) and the
// resolve-chain stops below it. Tight operators (power, derivative, function,
// negation) are NOT here — those are real, pickable terms.
const _SPANNING_OP = /^(?:multiply|add|subtract|plus|minus|equals|not_equal|less_than|greater_than|less_equal|greater_equal|implies|iff|conjunction|disjunction)_\d+$/;
function _isSpanningWrapperId(id) {
  if (!id) return false;
  // Strip any leading id prefixes before matching the op name: rebase (`_r3_`) AND
  // disjunction-branch (`d0_`, `d1_`, … — the two sides of a `\lor`). Missing the
  // branch prefix left `d1___multiply_9` unrecognized as a spanning fraction, so
  // hovering a term inside the 2nd root's denominator lit the whole ratio (#…).
  const core = id.replace(/^(?:_r\d+_|d\d+_)+/, "").replace(/^_+/, "");
  return _SPANNING_OP.test(core);
}

// Caption LaTeX delimiters: $…$, `…` (backticks — what the LM emits), \(…\), \[…\].
const _CAPTION_RE = /(\$[^$]+\$|`[^`]+`|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g;
const _speedLabel = (s) => ({ 0.25: "¼×", 0.5: "½×" }[s] || `${s}×`);

export class ProofAnimator {
  constructor(container, data, opts = {}) {
    this.container = container;
    this.data = data;
    this.katex = opts.katex || (typeof window !== "undefined" && window.katex);
    if (!this.katex) throw new Error("ProofAnimator: KaTeX not available");
    // Optional AI-ask integration: a factory (className, title, getMessage) →
    // <button>. The app passes labels.js makeAiAskButton; the standalone report
    // has no chat panel and omits it — no factory, no buttons rendered.
    this._aiAsk = opts.aiAskButton || null;
    this._nextAskBtn = null;
    // Term-ask (proof terms → AI exploration). Gated by enableTermAsk; works
    // standalone/embedded (?ai=1) and in-app (docked boxes). onTermAsk lets the app
    // route the ask to chat; onBuildTermAskMessage lets it supply a graph-enriched
    // message built from its own ordered selection.
    this._enableTermAsk = !!opts.enableTermAsk;
    this._onTermAsk = typeof opts.onTermAsk === "function" ? opts.onTermAsk : null;
    this._onBuildTermAskMessage = typeof opts.onBuildTermAskMessage === "function" ? opts.onBuildTermAskMessage : null;
    this._askSel = [];          // gold CONTEXT terms [{key, chain, text, desc}] (standalone)
    this._termAskBtnEl = null;  // the fade-in "Ask AI" button (on document.body)
    this._askBtnFocus = null;   // the term the button is anchored to (the ask subject)
    this._askBtnHideTimer = null;
    this._askBtnFadeTimer = null;
    this._askBtnRelocateTimer = null;   // intent-delay before moving the button to a new term
    this._askBtnRelocateEl = null;
    // Step-ask chip (stacked mode): hovering a line's step pill fades in the same
    // sparkle chip as the term ask, but asking about that STEP (any line, not
    // just the current one). Built only when an ask factory exists (see _build).
    this._stepAskBtnEl = null;
    this._stepAskIdx = null;        // the step the visible chip would ask about
    this._stepAskHideTimer = null;
    this._stepAskFadeTimer = null;
    // Standalone/embedded term-ask has no host chat factory, but we still want the
    // per-step ask buttons — render engine-native ones that route via _routeAsk
    // (embedded → new tab + auto-ask; standalone → clipboard). The app path keeps
    // its own factory (opts.aiAskButton), which asks chat directly.
    if (!this._aiAsk && this._enableTermAsk) {
      this._aiAsk = (cls, title, getMessage, getIdx) => this._makeRoutedAskButton(cls, title, getMessage, getIdx);
    }
    // Optional "Derive this step" integration: a button factory (className,
    // title, onClick) → <button> plus an onDerive(payload, anchorEl) handler the
    // host uses to dock a fresh derivation. Both come from the app (SgProofManager
    // passes labels.js makeDeriveButton + a dock callback); the standalone report
    // omits them, so no derive button renders. Lets a learner break a single
    // animation step into finer sub-steps on demand.
    this._deriveBtnFactory = typeof opts.deriveButton === "function" ? opts.deriveButton : null;
    this._onDerive = typeof opts.onDerive === "function" ? opts.onDerive : null;
    // Host hook for clicking a prerequisite / follow-up chip. Receives
    // {kind:'prerequisite'|'followup', text, message} — the app asks its agent with
    // the context-rich `message`. Absent + embedded → posted to the parent page;
    // absent + standalone → the chip copies its text.
    this._onExplore = typeof opts.onExplore === "function" ? opts.onExplore : null;
    // Gate the bottom "Explore" panel (Prerequisites / Explore-further tabs) — off
    // unless the host opts in (the app sets it; the standalone page via ?explore=).
    this._enableExplore = !!opts.enableExplore;
    // Origin an AI ask should open against. Defaults to the page's own origin
    // (correct for the app / renderproof — env-specific automatically). A static
    // host that ISN'T the app — the proof-animation report on GitHub Pages / a
    // local http.server — sets this so its asks land in the real app (e.g. staging)
    // rather than the Pages/file host.
    // Normalize to a bare origin — _askTargetUrl compares it against `URL.origin`,
    // so a value carrying a path/trailing slash would never match and reject asks.
    this._askOrigin = null;
    if (typeof opts.askOrigin === "string" && opts.askOrigin) {
      try { this._askOrigin = new URL(opts.askOrigin).origin; } catch (e) { /* invalid → keep default */ }
    }
    // This proof's pre-baked-animation id (``<domain>/<name>``), when the host knows
    // it (e.g. /prove opened a saved proof by id). Lets an explore/ask navigation to
    // a same-app view carry ``?pa=`` so the docked animation travels along — even
    // when neither the target deeplink nor this proof's own deeplink pinned it.
    this._paId = (typeof opts.paId === "string" && opts.paId) ? opts.paId : null;
    this._deriveBtnEl = null;
    // Optional host hook fired after every internal relayout (resize / fonts), so
    // a host that scales this widget to fit a box (SgProofManager) can re-fit AFTER
    // our fixed zone heights are final — otherwise its scale races our relayout and
    // ends up stale (content overflows / positions shift on the next step).
    this._onRelayout = typeof opts.onRelayout === "function" ? opts.onRelayout : null;
    // Optional "live terms" mode — a code parameter, no UI toggle. When on, each
    // rendered term becomes hoverable/clickable: hovering gives it a soft halo,
    // and (for NAMED terms — real symbols, not operators/exponents) fires
    // onTermHover/onTermClick so the host can light up and select the linked
    // semantic-graph node. The host (SgProofManager) wires these to the graph
    // renderer; the standalone report omits opts.liveTerms entirely, so the whole
    // feature is mute there. Every term still haloes locally — only the sg sync is
    // gated on being a named term that maps to a node.
    this._liveTerms = !!opts.liveTerms;
    this._onTermHover = typeof opts.onTermHover === "function" ? opts.onTermHover : null;
    this._onTermClick = typeof opts.onTermClick === "function" ? opts.onTermClick : null;
    // Reverse-sync hooks (the host drives graph→term highlight/select):
    //   onAfterRender() — fires after EVERY stage (re)render so the host can
    //     re-apply persistent term classes (selection/linked highlight) that a
    //     morph's fresh render would otherwise wipe.
    //   onTermBackgroundClick() — a click in the expression area that misses every
    //     term (the host deselects all).
    this._onAfterRender = typeof opts.onAfterRender === "function" ? opts.onAfterRender : null;
    this._onTermBackgroundClick = typeof opts.onTermBackgroundClick === "function" ? opts.onTermBackgroundClick : null;
    this._hotTermEl = null;   // currently haloed term (event-delegation bookkeeping)
    // Container-fit mode (set by a host that gives the widget a FIXED-size box,
    // e.g. SgProofManager's grid cell): the stage fills the height the box leaves
    // after the fixed text + nav bars, and the expression is scaled to fit that
    // box (width AND height) instead of the stage growing to the expression. The
    // standalone report leaves this false — there the stage grows to the tallest
    // step and the page scrolls.
    this._fitHeight = !!opts.fitHeight;
    this.mode = opts.mode || "parallel";    // 'parallel' | 'sequential'
    // Stacked (accordion) mode: render ALL steps up to the current one as
    // static lines and fly terms from the previous line into the new one,
    // expanding/collapsing the vertical space like an accordion. Runtime-
    // toggled by the .pa-stack button; hosts may seed it via opts.stacked.
    this.stacked = !!opts.stacked;
    this._linesEl = null;   // the .pa-lines column (stacked mode only)
    // Base timings; the speed multiplier scales them live via animation.playbackRate.
    this._baseDuration = opts.duration ?? 650;
    this._baseStagger = opts.staggerMs ?? 200;
    this._baseStepPause = opts.stepPause ?? 1000;  // Play: reading pause between steps (1× ≈ 1s)
    this._speedIdx = SPEEDS.indexOf(opts.speed ?? 1);
    if (this._speedIdx < 0) this._speedIdx = SPEEDS.indexOf(1);
    // Open on a specific step (e.g. a deeplink that carries the learner's current
    // derivation step), clamped to the available steps. Defaults to the first.
    this.current = Math.max(0, Math.min(
      Number.isFinite(opts.startStep) ? Math.floor(opts.startStep) : 0,
      (this.data.steps ? this.data.steps.length : 1) - 1));
    this._running = [];
    this._ghosts = [];
    this._token = null;
    this._playId = null;  // identifies the active play() loop; user nav clears it
    this._paused = false; // freeze in-flight animations (works mid-interpolation)
    this._pauseGate = null;  // pending promise the play() loop awaits while paused
    this._pauseOpen = null;  // resolver that releases _pauseGate on resume/cancel
    this._destroyed = false;
    this._ro = null;      // ResizeObserver → re-fit when the container resizes
    this._applySpeed();   // sets this.speed (needs _running to exist)
    this._build();
    // Base (unscaled) expression font; _fit() shrinks from here to fit the width.
    this._baseFontPx = parseFloat(getComputedStyle(this.stage).fontSize) || 30;
    this._fixMetaSize();    // pin the caption area first so the stage's flex height is known
    this._fit();            // scale the expression to fit the stage (width; +height in container mode)
    this._renderStage();
    this._syncUI();
    this._capOverflow();    // never let the expression spill past the stage
    this._fitControls();    // hide step enumerations if the controls don't fit
    this._observeResize();  // responsive: re-fit on container/window resize
    this._bindLiveTerms();  // optional: hover/click terms → halo + sg sync (no-op if off)
    // KaTeX webfonts load async; the first _fit() may have measured with narrower
    // fallback-font metrics. Re-fit once the real fonts are ready.
    if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { if (!this._destroyed) this._relayout(); });
    }
  }

  // Reserve the height of the tallest caption (operation + justification) so the
  // controls below never shift as captions wrap to more/fewer lines per step.
  _fixMetaSize() {
    const meta = this.container.querySelector(".pa-meta");
    if (!meta) return;
    const probe = document.createElement("div");
    probe.className = "pa-meta";
    probe.style.cssText =
      `position:absolute; visibility:hidden; left:-9999px; top:0; width:${meta.clientWidth}px;`;
    const op = document.createElement("span"); op.className = "pa-op";
    const just = document.createElement("span"); just.className = "pa-just";
    const next = document.createElement("span"); next.className = "pa-next-pill";
    // Mirror the LIVE markup exactly: .pa-op always lives inside a .pa-op-row
    // (regardless of AI buttons), so the probe must too — otherwise the measured
    // min-height wouldn't match and captions/controls could shift between steps.
    // The inline ask button (taller than the bare text) and the pill's extra grid
    // column are added only when a factory is present, matching _build.
    const opHost = document.createElement("div"); opHost.className = "pa-op-row";
    opHost.append(op);
    // Confidence badge mirrors the live op-row (probe == live, same as the ask
    // button below) so the reserved height accounts for it. Badges are hidden
    // until revealed (pa-conf-on/peek) — force the probe's visible so the
    // reservation covers the REVEALED state and toggling never shifts layout.
    const badge = document.createElement("span"); badge.className = "pa-conf-badge";
    badge.style.display = "inline-flex";
    opHost.append(badge);
    if (this._aiAsk) {
      probe.classList.add("pa-has-ask");
      next.classList.add("pa-has-ask");
      const ask = document.createElement("span"); ask.className = "pa-ask-btn pa-ask-current";
      opHost.append(ask);
    }
    // The Derive button is a second inline button in the live op-row — mirror it
    // here too, or the probe under-measures the caption width (and reserved meta
    // height) whenever Derive is present, letting the controls row jump.
    if (this._deriveBtnFactory && this._onDerive) {
      probe.classList.add("pa-has-ask");
      const der = document.createElement("span"); der.className = "pa-ask-btn pa-derive-btn";
      opHost.append(der);
    }
    // (The overall-confidence pill is an absolute OVERLAY on the widget — out
    // of flow, so it does not participate in the meta height reservation.)
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
    // FIXED height (not min-height): the text zone is locked to the tallest step,
    // so it never grows/shrinks as captions change between steps and the controls
    // below it never shift. Both set so a stale min-height can't override.
    if (h > 0) {
      const px = Math.ceil(h) + "px";
      meta.style.height = px;
      meta.style.minHeight = px;
    }
  }

  // Measure every step at the base font and lock the stage to the max width/
  // height, then scale the font down (only down, never up) so the WIDEST step
  // fits the current stage width. Pinning to the max keeps the canvas — and the
  // controls below it — from jumping as expressions grow/shrink between steps;
  // scaling by the SHARED max keeps the scale identical across steps (no per-step
  // zoom jump); and recomputing on resize makes the whole thing responsive
  // instead of overflowing a narrowed container.
  _fit() {
    const probe = document.createElement("span");
    probe.style.cssText =
      `position:absolute; visibility:hidden; left:-9999px; top:0; white-space:nowrap; font-size:${this._baseFontPx}px;`;
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
    // Small symmetric gutter so the expression never touches the edges. The SAME
    // scale applies to every step (computed from the widest/tallest), so there is
    // no per-step zoom jump.
    const PAD = 8;
    // Stacked lines carry a step pill in a left gutter — reserve it, or the
    // widest line (pill + gap + expression, centred) overflows the column and
    // the expand tween's overflow:hidden clips the pill's left edge.
    const gutter = this.stacked ? this._lineGutterW() : 0;
    const availW = Math.max(40, this.stage.clientWidth - 2 * PAD - gutter);
    let scale = Math.min(1, availW / w);
    if (this._fitHeight) {
      // Container mode: the stage fills a FIXED height (flex remaining after the
      // text + nav bars). Scale so the tallest step also fits that height; don't
      // pin the stage height (flex owns it). Result: the animation area is a fixed
      // size across all steps and the expression never overflows it.
      const availH = Math.max(20, this.stage.clientHeight - 2 * PAD);
      scale = Math.min(scale, availH / h);
    } else if (this.stacked) {
      // Stacked mode: the stage's height is the line COLUMN's natural height —
      // it grows/shrinks with the accordion, so never pin it. (Deliberate
      // divergence from the single-step "pin to max, never shrink" invariant.)
      this.stage.style.height = "";
    } else {
      // Report mode: the stage GROWS to the tallest step (pinned, scaled) so it
      // never jumps between steps; the page scrolls if the card is short.
      this.stage.style.height = `${Math.ceil(h * scale + 8)}px`;
    }
    this.stage.style.fontSize = `${this._baseFontPx * scale}px`;
    // The expression renders into a fixed-width block (the scaled max) centred in
    // the stage with its CONTENT left-aligned (see CSS), so persistent tokens keep
    // a stable left anchor instead of re-centring — and drifting — every step.
    this.stage.style.setProperty("--pa-expr-w", `${Math.ceil(w * scale)}px`);
  }

  // Hard guarantee that the CURRENT rendered expression never overflows the stage
  // width — a safety net for cases _fit()'s probe under-measures (e.g. it ran
  // before the KaTeX webfonts loaded, so fallback-font metrics were narrower).
  // Shrinks the stage font (which reflows the existing render) until it fits.
  // Fires the host's after-render hook (reverse sync re-applies term classes a
  // fresh render wiped). Hung off _capOverflow because that runs after EVERY stage
  // (re)render — initial, relayout, and the post-morph settle.
  _capOverflow() {
    this._capOverflowImpl();
    // Re-apply the engine-owned ask-selection a fresh render wiped (standalone
    // only; in-app the host re-applies its own classes via onAfterRender). Keyed
    // by appearance, so it survives the morph's brand-new term elements.
    if (this._enableTermAsk && !this._onTermClick) { try { this._applyAskClasses(); } catch (e) {} }
    if (this._onAfterRender) { try { this._onAfterRender(); } catch (e) {} }
  }

  _capOverflowImpl() {
    if (this.stacked) return this._capOverflowStacked();
    const expr = this.stage.querySelector(".pa-expr");
    if (!expr) return;
    const k = expr.querySelector(".katex-display") || expr.querySelector(".katex");
    if (!k) return;
    const PAD = 8;
    const availW = Math.max(40, this.stage.clientWidth - 2 * PAD);
    const r = k.getBoundingClientRect();
    // Shrink to whichever axis overflows more. In container mode the stage height
    // is fixed, so a tall expression must also be capped to it (not just width).
    let ratio = r.width > availW + 0.5 ? availW / r.width : 1;
    if (this._fitHeight) {
      const availH = Math.max(20, this.stage.clientHeight - 2 * PAD);
      if (r.height > availH + 0.5) ratio = Math.min(ratio, availH / r.height);
    }
    if (ratio < 1) {
      const cur = parseFloat(getComputedStyle(this.stage).fontSize) || this._baseFontPx;
      this.stage.style.fontSize = `${cur * ratio}px`;
      this.stage.style.setProperty("--pa-expr-w", `${Math.ceil(r.width * ratio)}px`);
    }
  }

  // Width of the stacked line's left gutter (step pill + pill↔expression gap),
  // read from the CSS vars so the reserve always matches what CSS lays out.
  _lineGutterW() {
    const cs = getComputedStyle(this.container);
    const pill = parseFloat(cs.getPropertyValue("--pa-pill-w")) || 26;
    const gap = parseFloat(cs.getPropertyValue("--pa-pill-gap")) || 16;
    return pill + gap;
  }

  // Stacked variant of the overflow cap: check EVERY visible line and shrink
  // the shared stage font so the widest one fits. Height never needs capping —
  // report mode grows, fitHeight mode scrolls.
  _capOverflowStacked() {
    if (!this._linesEl) return;
    const PAD = 8;
    // Same gutter reserve as _fit() — the line is pill + gap + expression.
    const availW = Math.max(40, this.stage.clientWidth - 2 * PAD - this._lineGutterW());
    let ratio = 1, maxW = 0;
    for (const line of this._linesEl.children) {
      const k = line.querySelector(".katex-display") || line.querySelector(".katex");
      if (!k) continue;
      const w = k.getBoundingClientRect().width;
      maxW = Math.max(maxW, w);
      if (w > availW + 0.5) ratio = Math.min(ratio, availW / w);
    }
    if (ratio < 1) {
      const cur = parseFloat(getComputedStyle(this.stage).fontSize) || this._baseFontPx;
      this.stage.style.fontSize = `${cur * ratio}px`;
      this.stage.style.setProperty("--pa-expr-w", `${Math.ceil(maxW * ratio)}px`);
    }
  }

  // Re-fit when the container (or window) resizes so the expression always fits
  // the available width. Only width changes matter — guard against the height
  // changes _fit() itself triggers (which would otherwise loop forever).
  _observeResize() {
    if (this._ro || typeof ResizeObserver === "undefined") return;
    this._lastFitW = this.container.clientWidth;
    this._lastFitH = this.container.clientHeight;
    this._ro = new ResizeObserver(() => {
      if (this._destroyed) return;
      // The Explore popup is anchored to the info pill inside the box; when the
      // box resizes the pill moves, so re-anchor the popup every tick (cheap).
      this._repositionPopups();
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      // Width changes always matter. In container mode HEIGHT changes matter too
      // (the stage's flex height changed → the expression must re-fit it); since
      // container _fit() never alters the container's own size, this can't loop.
      const widthChanged = Math.abs(w - this._lastFitW) >= 1;
      const heightChanged = this._fitHeight && Math.abs(h - this._lastFitH) >= 1;
      if (!widthChanged && !heightChanged) return;
      this._lastFitW = w;
      this._lastFitH = h;
      // Debounce: _relayout() re-renders every step via KaTeX in _fit() (expensive),
      // and a live drag-resize fires many events per frame. Coalesce to one
      // relayout per animation frame — same result, far less jank.
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
    // If the tab is hidden WHILE a morph is mid-flight, its animations freeze and
    // their `finished` promises never resolve — the morph would be stuck forever
    // (partial final step). Snap to the current target's final state instead.
    if (typeof document !== "undefined") {
      this._onVisibility = () => {
        if (document.hidden && this._running.length) {
          this._cancel();
          this._renderStage();
          this._capOverflow();   // webfonts may have loaded while hidden → re-cap width
          this._syncUI();
        }
      };
      document.addEventListener("visibilitychange", this._onVisibility);
    }
  }

  // Width changed: cancel any in-flight morph, re-fit, and re-render the current
  // step at the new scale. A resize is an instantaneous reflow (not a step
  // change), so it doesn't run the fade-out → move → fade-in sequence.
  _relayout() {
    this._cancel();
    this._fixMetaSize();   // text bar height first → fixes the stage's flex height
    this._fit();           // then scale the expression to fit the stage (w + h in container mode)
    this._renderStage();
    this._capOverflow();
    this._fitControls();
    this._updateNextTip();   // truncation depends on width → re-check on resize
    if (this._onRelayout) { try { this._onRelayout(); } catch (e) {} }
  }

  // Tear down the ResizeObserver and any running animations (called when the
  // host removes the proof box — see SgProofManager.closeBox).
  destroy() {
    this._destroyed = true;
    this._cancel();
    if (this._raf && typeof cancelAnimationFrame !== "undefined") { cancelAnimationFrame(this._raf); this._raf = 0; }
    if (this._ro) { try { this._ro.disconnect(); } catch (e) {} this._ro = null; }
    if (this._onVisibility) {
      try { document.removeEventListener("visibilitychange", this._onVisibility); } catch (e) {}
      this._onVisibility = null;
    }
    if (this._onDocExplore) {
      try { document.removeEventListener("mousedown", this._onDocExplore, true); } catch (e) {}
      this._onDocExplore = null;
    }
    if (this.stage && this._onStageMove) {
      this.stage.removeEventListener("mousemove", this._onStageMove);
      this.stage.removeEventListener("mouseleave", this._onStageLeave);
      this.stage.removeEventListener("click", this._onStageClick);
      this._onStageMove = this._onStageLeave = this._onStageClick = null;
    }
    if (this._askBtnHideTimer) { clearTimeout(this._askBtnHideTimer); this._askBtnHideTimer = null; }
    if (this._askBtnFadeTimer) { clearTimeout(this._askBtnFadeTimer); this._askBtnFadeTimer = null; }
    if (this._askBtnRelocateTimer) { clearTimeout(this._askBtnRelocateTimer); this._askBtnRelocateTimer = null; }
    // Remove the body-appended popups/buttons this widget created (else they leak
    // when a proof box is torn down and recreated in the app).
    if (this._stepAskHideTimer) { clearTimeout(this._stepAskHideTimer); this._stepAskHideTimer = null; }
    if (this._stepAskFadeTimer) { clearTimeout(this._stepAskFadeTimer); this._stepAskFadeTimer = null; }
    for (const k of ["_termTip", "_mathTip", "_goalPop", "_explorePop", "_termAskBtnEl", "_stepAskBtnEl"]) {
      const el = this[k];
      if (el && el.parentNode) el.parentNode.removeChild(el);
      this[k] = null;
    }
    // Clear any host hover state this widget drove (empty chain → no linked term).
    if (this._onTermHover) { try { this._onTermHover([], null); } catch (e) {} }
  }

  // ── Live terms (optional) ──────────────────────────────────────────────────
  // Event-delegated hover/click on the rendered terms. Delegation on the stage
  // survives every re-render (initial, resize relayout, and the post-morph settle
  // all rebuild the stage DOM), so we bind once and never re-attach per glyph.
  _bindLiveTerms() {
    if (!this._liveTerms || !this.stage) return;
    this.container.classList.add("pa-live-terms");
    // The term under the pointer. A leaf glyph IS the term; anything that still
    // wraps tagged leaves — a fraction, power, √, product, equation — snaps to the
    // NEAREST leaf by box, so the inner term lights up rather than the whole
    // sub-expression. (KaTeX's transparent layout containers let a wrapper sit
    // under the pointer in the gaps between glyphs; the box-distance snap is
    // tolerance-capped, so a true background point still no-ops.) _termChain then
    // walks UP from the leaf to its enclosing operator, so the graph host can
    // still resolve the fraction/power/√ from the chain when it wants to.
    const tagOf = (t, x, y) => {
      const el = t && t.closest ? t.closest("[data-n]") : null;
      // Scoped to _liveRoot(): the current line in stacked mode (older static
      // lines are inert), the whole stage otherwise.
      if (!el || !this._liveRoot().contains(el)) return null;
      if (el.querySelector("[data-n]")) {
        if (x == null) return null;
        // Prefer the nearest inner leaf. Only when the pointer is on NO term at all
        // (the bare √ surd, a fraction bar) fall back to the wrapper itself — and
        // only when it's a tight operator (√, fraction, power), never a spanning
        // combiner (product / sum / equation) whose box sprawls. So the √ "kicks in
        // last": it's selectable, but only after we know no inner term is hovered.
        const leaf = this._nearestLeafTerm(el, x, y);
        if (leaf) return leaf;
        return _isSpanningWrapperId(el.getAttribute("data-n")) ? null : el;
      }
      return el;
    };
    // mousemove (not mouseover) + mouseleave (not mouseout): hit-test the term
    // under the cursor on every move and clear only when the pointer truly leaves
    // the stage. This is immune to the relatedTarget / pointer-events gaps that
    // KaTeX's transparent layout containers create — the cause of terms inside a √
    // or fraction flickering or refusing to light up (the enter/exit bug).
    this._onStageMove = (ev) => {
      const el = tagOf(ev.target, ev.clientX, ev.clientY);
      // Switch only to a REAL term; over chrome/gaps (null) keep the current term
      // lit so crossing a fraction bar between two glyphs never flickers.
      if (el && el !== this._hotTermEl) this._setHotTerm(el);
      // Over chrome/gap (or the same term): the pointer isn't settling on a NEW
      // term, so drop any pending button relocate — it may be heading to the button.
      else if (!el && this._enableTermAsk) this._cancelAskBtnRelocate();
    };
    this._onStageLeave = () => this._setHotTerm(null);
    this._onStageClick = (ev) => {
      const el = tagOf(ev.target, ev.clientX, ev.clientY);
      if (!el) {
        // A click in the expression area that hit no term → deselect: the host (if
        // any) clears its selection; otherwise the engine clears its ask-selection.
        if (this._onTermBackgroundClick) this._onTermBackgroundClick();
        else if (this._enableTermAsk && !this._onTermClick) this._clearAskSel();
        return;
      }
      const additive = !!(ev.metaKey || ev.ctrlKey);
      if (this._onTermClick) {
        // Host owns selection (sg-proof) — forward the candidate chain so it can
        // resolve the nearest named graph node.
        this._onTermClick(this._termChain(el), el, { additive });
      } else if (this._enableTermAsk) {
        // Standalone/embedded (no host): the engine owns an ordered ask-selection.
        this._toggleAskTerm(el, additive);
      }
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
    // SHARED tooltip: the term's own description from data.terms — needs no graph,
    // so it works both in the app and on the standalone proof-animation page.
    const desc = this._termDescription(chain);
    if (el && desc) this._showTermTip(el, desc);
    else this._hideTermTip();
    // Fade the "Ask AI" button in beside the hovered term (graph-node style); a
    // grace-delayed hide when the pointer leaves lets the cursor reach the button.
    if (this._enableTermAsk) {
      if (el) this._requestTermAskBtn(el);
      else { this._cancelAskBtnRelocate(); this._scheduleHideTermAskBtn(); }
    }
    // Host hook (optional): the app's SgProofManager lights up + selects the LINKED
    // graph node. The chain (innermost glyph → enclosing operator wrappers) lets a
    // glyph that's only PART of a named node still reach it. Absent standalone.
    if (this._onTermHover) this._onTermHover(chain, el || null);
  }

  // ── Term tooltip (shared, graph-free) ──────────────────────────────────────
  // The first chain term that has a description in data.terms (keyed by node id).
  // The rendered data-n can carry a rebase prefix (`_r3_…`) and an occurrence
  // suffix (`__<parent>`); data.terms is keyed by the clean id, so try the raw id,
  // the prefix-stripped id, then the canonical symbol before it.
  _termDescription(chain) {
    const terms = this.data && this.data.terms;
    if (!terms) return "";
    for (const c of (chain || [])) {
      const raw = c.id || "";
      const clean = raw.replace(/^_r\d+_/, "");
      const t = terms[raw] || terms[clean] || terms[clean.split("__")[0]];
      const d = t && (t.description || "").trim();
      if (d) return d;
    }
    return "";
  }

  // A rounded tooltip rendering the hovered term's description. Lives on <body>
  // (position:fixed) so a host box's overflow never clips it; placed on the side
  // the term is nearest (below in the lower half of the viewport, above otherwise),
  // flipped to the opposite side if the preferred one would run off-screen.
  _showTermTip(anchorEl, text) {
    let tip = this._termTip;
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "pa-term-tip";
      tip.setAttribute("role", "tooltip");
      document.body.appendChild(tip);
      this._termTip = tip;
    }
    this._caption(tip, text);             // descriptions may carry inline $…$
    tip.style.display = "block";
    tip.style.visibility = "hidden";      // measure before positioning
    const r = anchorEl.getBoundingClientRect();
    const vh = window.innerHeight;
    const tw = tip.offsetWidth, th = tip.offsetHeight, GAP = 10;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    let below = (r.top + r.bottom) / 2 > vh / 2;
    if (below && r.bottom + GAP + th > vh - 4) below = false;   // no room below
    else if (!below && r.top - GAP - th < 4) below = true;      // no room above
    const top = below ? r.bottom + GAP : r.top - th - GAP;
    tip.classList.toggle("pa-term-tip-below", below);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(Math.max(4, top))}px`;
    tip.style.visibility = "visible";
  }

  _hideTermTip() {
    if (this._termTip) this._termTip.style.display = "none";
  }

  // Tagged terms from the given element up to the stage root, innermost first —
  // the candidate chain the host walks to find the nearest term that maps to a
  // graph node (a leaf glyph, then its operator wrapper, then the wrapper's…).
  _termChain(el) {
    const out = [];
    for (let n = el; n && this.stage.contains(n); n = n.parentElement) {
      if (n.nodeType === 1 && n.hasAttribute && n.hasAttribute("data-n")) {
        const id = n.getAttribute("data-n");
        // Stop below a spanning combiner — a hovered glyph may reach its tight
        // operator (the "2" of a square → its power), but never the product/
        // equation above it (which would resolve to a sprawling node).
        if (n !== el && _isSpanningWrapperId(id)) break;
        out.push({ id, text: n.textContent || "" });
      }
    }
    return out;
  }

  // Nearest LEAF term inside `wrapper` to the point (x,y), or null if none is close
  // enough — so a true background click (far from any term) still deselects. A leaf
  // whose rect CONTAINS the point wins at distance 0, which is the fraction dead
  // zone: the denominator glyph's box covers the point even where the wrapper shows
  // through above it.
  _nearestLeafTerm(wrapper, x, y) {
    let best = null, bestD = Infinity;
    for (const leaf of wrapper.querySelectorAll("[data-n]")) {
      if (leaf.querySelector("[data-n]")) continue;   // leaves only
      const r = leaf.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = leaf; }
    }
    const TOL = 14;   // px — beyond this it's a background click, not a near-miss
    return (best && bestD <= TOL * TOL) ? best : null;
  }

  // ── Term ask-selection (engine-owned; standalone/embedded term-ask only) ────
  // Appearance key — identical-looking terms collapse to one key; reject empty +
  // numeric-only (a literal "2" and the "2" of a square render identically). Same
  // rule SgProofManager uses, so selection behaves consistently across contexts.
  _apprKey(text) {
    const k = (text || "").replace(/[\s\u200B-\u200F\u2060\uFEFF]/g, "");
    return (!k || /^[\d.,/+\-]+$/.test(k)) ? "" : k;
  }

  // Toggle a term in the ask CONTEXT set (gold). These are the "also include
  // these" terms that ride along when you ask about a hovered focus term — like
  // cmd/ctrl-selecting extra graph nodes. Plain click REPLACES; cmd/ctrl toggles.
  _toggleAskTerm(el, additive) {
    const chain = this._termChain(el);
    const text = (chain[0] && chain[0].text) || (el.textContent || "");
    const key = this._apprKey(text);
    if (!key) return;
    if (additive) {
      const at = this._askSel.findIndex((s) => s.key === key);
      if (at >= 0) this._askSel.splice(at, 1);                        // toggle off
      else this._askSel.push({ key, chain, text, desc: this._termDescription(chain) });
    } else {
      this._askSel = [{ key, chain, text, desc: this._termDescription(chain) }];
    }
    this._applyAskClasses();
  }

  _clearAskSel() {
    if (!this._askSel.length) return;
    this._askSel = [];
    this._applyAskClasses();
  }

  // Paint the ask CONTEXT set gold (pa-term-ask). A class DISTINCT from
  // pa-term-selected so the in-app host keeps sole ownership of that one. Keyed by
  // appearance, so a re-render (morph) re-applies it from _capOverflow.
  _applyAskClasses() {
    const expr = this._exprEl();
    if (!expr) return;
    // Stacked history lines are frozen snapshots — the outgoing current line
    // keeps whatever pa-term-ask classes it carried. Sweep them off every line
    // but the current one, so the selection only ever shows on the active step.
    if (this.stacked && this._linesEl) {
      for (const node of this._linesEl.querySelectorAll(".pa-term-ask")) {
        if (!expr.contains(node)) node.classList.remove("pa-term-ask");
      }
    }
    const keys = new Set(this._askSel.map((s) => s.key));
    for (const node of expr.querySelectorAll("[data-n]")) {
      const k = this._apprKey(node.textContent || "");
      node.classList.toggle("pa-term-ask", !!k && keys.has(k));
    }
  }

  // The AI sparkle button that FADES IN next to the hovered term — mirrors the
  // semantic-graph node ask button (graph-view._showD3NodeAskBtn). One reusable
  // button on document.body (position:fixed), so a box's overflow never clips it.
  // Engine-level so it works both standalone (?ai=1) and in-app (docked boxes).
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
    // Starts invisible: keep it out of the tab order and hidden from assistive tech
    // so keyboard/SR users don't land on a control they can't see. _showTermAskBtn /
    // _hideTermAskBtn flip these back in step with the opacity.
    btn.tabIndex = -1;
    btn.setAttribute("aria-hidden", "true");
    btn.style.zIndex = "10001";   // above the term tooltip (z 10000) so it's never covered
    // Moving onto the button cancels the hide; leaving it hides it. The grace
    // delay (below) is what lets the cursor cross the gap from term to button.
    btn.addEventListener("mouseenter", () => {
      if (this._askBtnHideTimer) { clearTimeout(this._askBtnHideTimer); this._askBtnHideTimer = null; }
      this._cancelAskBtnRelocate();   // reached the button → don't let it jump to a new term
    });
    btn.addEventListener("mouseleave", () => this._scheduleHideTermAskBtn());
    btn.addEventListener("click", (e) => { e.stopPropagation(); this._termAskClick(); });
    document.body.appendChild(btn);
    this._termAskBtnEl = btn;
  }

  // Show the ask button for `el`, but DON'T yank an already-shown button off a term
  // the pointer may be reaching for. First appearance (or moving back onto the same
  // term) snaps instantly; moving to a DIFFERENT term while a button is up waits for
  // the pointer to SETTLE there (~150ms). A move to empty chrome or onto the button
  // itself cancels the pending relocate (see _onStageMove / the button's mouseenter),
  // so a cursor traveling to the button never loses it.
  _requestTermAskBtn(el) {
    const btn = this._termAskBtnEl;
    const visible = btn && btn.style.opacity === "1";
    if (!visible || !this._askBtnFocus || this._askBtnFocus.el === el) {
      this._cancelAskBtnRelocate();
      this._showTermAskBtn(el);
      return;
    }
    if (this._askBtnRelocateEl === el) return;   // already pending for this term
    this._cancelAskBtnRelocate();
    this._askBtnRelocateEl = el;
    this._askBtnRelocateTimer = setTimeout(() => {
      this._askBtnRelocateTimer = null;
      this._askBtnRelocateEl = null;
      this._showTermAskBtn(el);
    }, 150);
  }

  _cancelAskBtnRelocate() {
    if (this._askBtnRelocateTimer) { clearTimeout(this._askBtnRelocateTimer); this._askBtnRelocateTimer = null; }
    this._askBtnRelocateEl = null;
  }

  // Fade the button in just above the hovered term (flipped below if no room),
  // and remember that term as the ask FOCUS. Clamped inside the viewport.
  _showTermAskBtn(el) {
    const btn = this._termAskBtnEl;
    if (!btn || !el) return;
    if (this._askBtnHideTimer) { clearTimeout(this._askBtnHideTimer); this._askBtnHideTimer = null; }
    const chain = this._termChain(el);
    this._askBtnFocus = {
      el, chain,
      text: (chain[0] && chain[0].text) || (el.textContent || ""),
      desc: this._termDescription(chain),
    };
    const r = el.getBoundingClientRect();
    const bRect = btn.getBoundingClientRect();
    const bw = bRect.width || btn.offsetWidth || 22;
    const bh = bRect.height || btn.offsetHeight || 22;
    // TOP-RIGHT corner of the term, like a superscript badge — it sits in the
    // empty space above the line, so the cursor reaches it WITHOUT crossing the
    // next inline glyph (which would relocate the button out from under you). The
    // button overlaps the corner by ~⅓ so a short up-right move lands on it.
    // Nudged out (right + up) to clear the term — ⅔ of a ⅓-glyph-height step (i.e.
    // a third closer than a full ⅓-height nudge).
    const shift = r.height * 2 / 9;
    let left = r.right - bw / 3 + shift;
    let top = r.top - bh * (2 / 3) - shift;
    // Flip below if there's no room above; nudge left if it would run off-screen.
    if (top < 4) top = r.bottom - bh / 3;
    left = Math.max(4, Math.min(left, window.innerWidth - bw - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - bh - 4));
    btn.style.left = `${Math.round(left)}px`;
    btn.style.top = `${Math.round(top)}px`;
    btn.style.opacity = "1";
    btn.style.pointerEvents = "auto";
    btn.tabIndex = 0;                     // now visible → reachable + announced
    btn.removeAttribute("aria-hidden");
  }

  // Grace period before the button fades out — long enough to move the cursor
  // from the term onto the button (its mouseenter cancels the timer).
  _scheduleHideTermAskBtn() {
    if (!this._termAskBtnEl) return;
    if (this._askBtnHideTimer) clearTimeout(this._askBtnHideTimer);
    this._askBtnHideTimer = setTimeout(() => this._hideTermAskBtn(), 600);
  }

  _hideTermAskBtn() {
    if (this._askBtnHideTimer) { clearTimeout(this._askBtnHideTimer); this._askBtnHideTimer = null; }
    this._cancelAskBtnRelocate();
    const btn = this._termAskBtnEl;
    if (!btn) return;
    btn.style.opacity = "0";
    // Leave the tab order / assistive tree immediately (before the fade finishes) so
    // it can't be focused while invisible; clicks still work through the fade below.
    btn.tabIndex = -1;
    btn.setAttribute("aria-hidden", "true");
    // Stay clickable through the fade (matches the fade-in timing), so a click that
    // lands while the button is still visibly fading still registers; disable it
    // only once it's actually invisible.
    if (this._askBtnFadeTimer) clearTimeout(this._askBtnFadeTimer);
    this._askBtnFadeTimer = setTimeout(() => {
      if (btn.style.opacity === "0") btn.style.pointerEvents = "none";
    }, 200);
  }

  // ── Step-ask chip (stacked pills) ──────────────────────────────────────────
  // Hovering a step pill fades in the same sparkle chip as the term ask, asking
  // about THAT step (any line — not just the current one). One reusable button
  // on document.body (fixed), created through the ask factory so the click
  // routes exactly like the meta "Ask AI about this step" button: in-app → chat,
  // embedded → new tab + auto-ask, standalone → clipboard.
  _buildStepAskButton() {
    if (!this._aiAsk || this._stepAskBtnEl) return;
    const btn = this._aiAsk("pa-term-ask-btn pa-step-ask-btn", "Ask AI about this step",
      () => (this._stepAskIdx == null ? null : this._askStepMessage(this._stepAskIdx)),
      () => (this._stepAskIdx == null ? this.current : this._stepAskIdx));
    btn.style.position = "fixed";
    btn.style.opacity = "0";
    btn.style.pointerEvents = "none";
    btn.tabIndex = -1;                       // invisible → out of the tab order
    btn.setAttribute("aria-hidden", "true");
    btn.addEventListener("mouseenter", () => {
      if (this._stepAskHideTimer) { clearTimeout(this._stepAskHideTimer); this._stepAskHideTimer = null; }
    });
    btn.addEventListener("mouseleave", () => this._scheduleHideStepAskBtn());
    btn.addEventListener("click", () => this._hideStepAskBtn());   // after the factory's ask fires
    document.body.appendChild(btn);
    this._stepAskBtnEl = btn;
  }

  // Fade the chip in at the pill's top-right corner (superscript-badge pose,
  // mirroring the term chip) — the short up-right move to reach it never crosses
  // another pill, so the chip doesn't relocate out from under the cursor.
  _showStepAskBtn(pill, idx) {
    const btn = this._stepAskBtnEl;
    if (!btn) return;
    if (this._stepAskHideTimer) { clearTimeout(this._stepAskHideTimer); this._stepAskHideTimer = null; }
    this._stepAskIdx = idx;
    const r = pill.getBoundingClientRect();
    const bw = btn.offsetWidth || 22;
    const bh = btn.offsetHeight || 22;
    let left = r.right - bw / 3;
    let top = r.top - bh * (2 / 3);
    if (top < 4) top = r.bottom - bh / 3;    // flip below when no room above
    left = Math.max(4, Math.min(left, window.innerWidth - bw - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - bh - 4));
    btn.style.left = `${Math.round(left)}px`;
    btn.style.top = `${Math.round(top)}px`;
    btn.style.opacity = "1";
    btn.style.pointerEvents = "auto";
    btn.tabIndex = 0;
    btn.removeAttribute("aria-hidden");
  }

  // Grace period long enough to travel from the pill onto the chip (its
  // mouseenter cancels the timer) — same rhythm as the term chip.
  _scheduleHideStepAskBtn() {
    if (!this._stepAskBtnEl) return;
    if (this._stepAskHideTimer) clearTimeout(this._stepAskHideTimer);
    this._stepAskHideTimer = setTimeout(() => this._hideStepAskBtn(), 600);
  }

  _hideStepAskBtn() {
    if (this._stepAskHideTimer) { clearTimeout(this._stepAskHideTimer); this._stepAskHideTimer = null; }
    const btn = this._stepAskBtnEl;
    if (!btn) return;
    btn.style.opacity = "0";
    btn.tabIndex = -1;
    btn.setAttribute("aria-hidden", "true");
    // Stay clickable through the fade; disable only once actually invisible.
    if (this._stepAskFadeTimer) clearTimeout(this._stepAskFadeTimer);
    this._stepAskFadeTimer = setTimeout(() => {
      if (btn.style.opacity === "0") btn.style.pointerEvents = "none";
    }, 200);
  }

  // Resolve the deeplink for an ask: a step's own override, else the proof-level
  // one. Empty when neither is present (the route then falls back).
  _stepDeeplink(idx) {
    const s = this.data && this.data.steps && this.data.steps[idx];
    return (s && s.deeplink) || (this.data && this.data.deeplink) || "";
  }

  // Button click: ask about the FOCUS term (the one the button is anchored to),
  // with any gold context terms riding along. Host-enriched in-app, else built by
  // the engine. Mirrors the graph node ask (hovered = subject, selected = context).
  _termAskClick() {
    const focus = this._askBtnFocus;
    let message = null;
    if (this._onBuildTermAskMessage) {
      try { message = this._onBuildTermAskMessage(focus); } catch (e) { message = null; }
    }
    if (!message) message = this._buildTermAskMessage(focus);
    if (!message) return;
    this._hideTermAskBtn();
    this._routeAsk(message, this._stepDeeplink(this.current));
  }

  // Standalone ask message: the focus term + any gold context terms. Deliberately
  // omits the full $$expr$$ (the deep-linked app already has the proof) so the
  // auto-ask URL stays short.
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

  // Route an AI ask to the right place. THREE contexts, checked in order:
  //   1. IN-APP   — a host hook is wired (e.g. docked boxes) → ask in the existing chat.
  //   2. EMBEDDED — this widget is in an iframe → open the app in a NEW TAB.
  //   3. STANDALONE — top-level renderproof page → navigate THIS tab to the app.
  // Cases 2 and 3 go to the SAME url (built by _askTargetUrl); only HOW it's opened
  // differs, and that lives in _openAppUrl. Shared by the term button, the per-step
  // buttons, and the explore chips.
  _routeAsk(message, deeplink) {
    if (!message) return;
    if (this._onTermAsk) { this._onTermAsk({ message }); return; }   // (1) in-app → chat
    this._openAppUrl(                                                // (2) embedded / (3) standalone
      this._askTargetUrl(deeplink, message),
      () => this._postToParent({ type: "algebench-term-ask", message }),           // embedded fallback
      () => { try { navigator.clipboard.writeText(message); } catch (e) {} });     // standalone fallback
  }

  // Open `url` in the app, the way the current context allows:
  //   EMBEDDED  → a NEW TAB (an iframe can't navigate its host page);
  //   STANDALONE → THIS tab (reliable — a new tab can be popup-blocked).
  // Runs the matching fallback only if there's no usable url or the open was blocked.
  _openAppUrl(url, onEmbeddedFail, onStandaloneFail) {
    const embedded = typeof window !== "undefined" && window.self !== window.top;
    if (url) {
      try {
        if (embedded) {
          // A blocked popup returns `null` WITHOUT throwing — treat that as a
          // failure so the postMessage fallback still runs (don't lose the ask).
          if (window.open(url, "_blank", "noopener")) return;
        } else {
          window.location.assign(url);
          return;
        }
      } catch (e) { /* blocked — fall through to the fallback */ }
    }
    const fail = embedded ? onEmbeddedFail : onStandaloneFail;
    if (fail) fail();
  }

  // Last-resort fallback when embedded and we couldn't open a tab: notify an
  // AlgeBench-aware parent page. Tagged with this proof's title.
  _postToParent(payload) {
    try {
      window.parent.postMessage(
        { ...payload, title: (this.data && this.data.title) || null }, "*");
    } catch (e) { /* parent refused */ }
  }

  // Where an ask should open, and how the question travels. The origin is the
  // CURRENT one, so it's automatically environment-specific (localhost in dev, the
  // real host in prod). The question rides in the `aa` query param — the app reads
  // it on boot, opens chat, and sends it once (then strips it from the URL).
  //   • with a deeplink → that scene/step view + ?panel=chat&aa=<question>;
  //   • without        → the app's MAIN PAGE + ?panel=chat&aa=<question>.
  // This proof's own pre-baked-animation id (the ?pa= on its proof-level deeplink),
  // or null. Used to carry the docked animation onto explore/ask navigations whose
  // target deeplink (a per-chip / per-step link) didn't pin one.
  // This proof's own pre-baked-animation id: the host-supplied ``paId`` if any,
  // else the ``?pa=`` on its proof-level deeplink. Null when neither is known.
  _ownPaId() {
    if (this._paId) return this._paId;
    try {
      const d = this.data && this.data.deeplink;
      if (!d) return null;
      const u = new URL(d, this._askOrigin || window.location.origin);
      return u.searchParams.get("pa");
    } catch (e) { return null; }
  }

  _askTargetUrl(deeplink, message) {
    try {
      const origin = this._askOrigin || window.location.origin;
      const raw = deeplink || "/";
      const u = new URL(raw, origin);
      if (u.origin !== origin) return null;   // off-origin deeplink → reject
      u.searchParams.set("panel", "chat");
      u.searchParams.set("aa", String(message).slice(0, 1500));
      // Carry THIS proof's pre-baked animation (?pa=) onto the target so the docked
      // derivation travels with the navigation — even when the target didn't pin it.
      // Only for a same-APP navigation: a relative deeplink (starts with "/", incl.
      // the "/" default when there's no deeplink). A full http(s) address is treated
      // as an external "go see it" cross-reference and left untouched. Never clobber
      // a pa the target already chose.
      const sameApp = raw.startsWith("/");
      const ownPa = this._ownPaId();
      if (sameApp && ownPa && !u.searchParams.has("pa")) u.searchParams.set("pa", ownPa);
      // With a pa present, carry the step the learner is currently on so the docked
      // animation opens there, not at step 0.
      if (u.searchParams.has("pa")) u.searchParams.set("pas", String(this.current));
      return u.href;
    } catch (e) { return null; }
  }

  // Engine-native ask button (used only when the app supplies no aiAskButton
  // factory but term-ask is on). Routes via _routeAsk instead of asking chat.
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
      // getIdx lets a caller pin the deeplink to a specific step (the step-ask
      // chip on a history pill); default is the current step.
      if (message) this._routeAsk(message, this._stepDeeplink(getIdx ? getIdx() : this.current));
    });
    return btn;
  }

  // Apply the current speed multiplier. Animations are created at base duration
  // and play at this.speed via playbackRate, so changing it here ALSO rescales
  // whatever is mid-flight (immediate effect), then updates the button label.
  _applySpeed() {
    this.speed = SPEEDS[this._speedIdx];
    for (const a of this._running) { try { a.playbackRate = this.speed; } catch (e) {} }
    const btn = this.container.querySelector(".pa-speed");
    if (btn) btn.textContent = _speedLabel(this.speed);
  }

  // Create an animation already running at the current speed (via playbackRate),
  // so _applySpeed can rescale it live. Durations/delays are in BASE units.
  _tween(el, keyframes, opts) {
    const a = el.animate(keyframes, opts);
    a.playbackRate = this.speed;
    if (this._paused) a.pause();   // stay frozen if paused mid-sequence
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
      b.type = "button";   // never submit a surrounding <form>
      b.className = "pa-step";
      b.textContent = String(i);
      // Keep the RAW operation (with $…$) so the tooltip renders the math via KaTeX
      // (the plain data-tip mangled e.g. "$v = \omega R$" into "v = R").
      let tip = `${i}. ${s.operation || `state ${i}`}`;
      // Confidence tint: the row of step buttons doubles as an at-a-glance
      // confidence strip (a colored bar per step, tier-keyed).
      const c = this._conf(i);
      if (c && c.tier) {
        b.classList.add(`pa-conf-${c.tier}`);
        tip += ` — ${c.label || c.tier}`;
      }
      this._attachMathTip(b, tip);   // KaTeX-rendered tooltip (sets aria-label too)
      b.addEventListener("click", () => this._userGoTo(i));
      steps.appendChild(b);
    });
    this._setOverall();   // overall-confidence pill (removed when data lacks it)
    this.container.querySelector(".pa-prev").onclick = () => this._userGoTo(this.current - 1);
    this.container.querySelector(".pa-next").onclick = () => this._userGoTo(this.current + 1);
    // The "Next" pill acts like the next button.
    const nextPill = this.container.querySelector(".pa-next-pill");
    this._nextPillEl = nextPill;
    nextPill.onclick = () => this._userGoTo(this.current + 1);
    nextPill.onkeydown = (e) => {
      if (e.target !== nextPill) return;   // e.g. Enter on the AI ask button inside
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._userGoTo(this.current + 1); }
    };
    // AI ask buttons (app-provided factory only — see constructor).
    if (this._aiAsk) {
      const meta = this.container.querySelector(".pa-meta");
      meta.classList.add("pa-has-ask");
      // Current-step button sits inline right after the explanation text (in the
      // op-row), so it reads as "ask about THIS step" rather than floating loose.
      meta.querySelector(".pa-op-row").appendChild(
        this._aiAsk("pa-ask-btn pa-ask-current", "Ask AI about this step",
          () => this._askCurrentMessage()));
      // The next-step button lives INSIDE the pill (re-attached by _setNextPill on
      // every step), so the pill's hide-on-last-step and promote fade cover it too.
      this._nextAskBtn = this._aiAsk("pa-ask-btn pa-ask-next", "Predict the next step with AI",
        () => this._askNextMessage());
      nextPill.classList.add("pa-has-ask");
    }
    // Derive button — sits beside the current-step ask button; breaks THIS step
    // into finer sub-steps (a fresh derivation toward this step's expression).
    if (this._deriveBtnFactory && this._onDerive) {
      const meta = this.container.querySelector(".pa-meta");
      meta.classList.add("pa-has-ask");
      this._deriveBtnEl = this._deriveBtnFactory(
        "pa-ask-btn pa-derive-btn", "Derive this step — break it into finer sub-steps",
        () => this._deriveCurrent(this._deriveBtnEl));
      meta.querySelector(".pa-op-row").appendChild(this._deriveBtnEl);
    }
    this.container.querySelector(".pa-play").onclick = () => this._togglePlay();
    this.container.querySelector(".pa-speed").onclick = () => {
      this._speedIdx = (this._speedIdx + 1) % SPEEDS.length;
      this._applySpeed();
    };
    const modeBtn = this.container.querySelector(".pa-mode");
    // Reflect a host-seeded mode (e.g. carried across a variant-preview remount).
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

  // Model-produced framing, shown top-left (mirrors the grounding-rank pill
  // top-right). IDLE: a compact icon-only pill. HOVER: the pill expands inline to
  // reveal the goal text (CSS-driven, exactly like the rank pill peeks). CLICK:
  // docks the goal as a banner at the front of the math view (click the banner to
  // collapse back to the pill). Hidden when no goal.
  _renderGoal() {
    const pill = this.container.querySelector(".pa-goal-pill");
    const dock = this.container.querySelector(".pa-goal-dock");
    if (!pill) return;
    const goal = (this.data && this.data.goal || "").trim();
    // Stacked mode is top-anchored, so the first line would slide under the
    // corner pill — pa-has-goal lets CSS reserve headroom only when it exists.
    this.container.classList.toggle("pa-has-goal", !!goal);
    if (!goal) { pill.hidden = true; if (dock) dock.hidden = true; return; }
    this._goalText = goal;
    this._goalDocked = false;
    // icon (always) + label (goal text, revealed on hover via CSS)
    pill.innerHTML = "";
    const icon = document.createElement("span");
    icon.className = "pa-goal-icon";
    icon.innerHTML = GOAL_ICON;
    const label = document.createElement("span");
    label.className = "pa-goal-label";
    this._caption(label, goal);            // inline math, safe (textContent + KaTeX)
    pill.append(icon, label);
    pill.hidden = false;
    pill.addEventListener("click", () => this._toggleGoalDock());
    if (dock) dock.addEventListener("click", () => this._toggleGoalDock());  // click banner to collapse
  }

  // Dock/undock the goal as a top-of-box banner. Docked: the corner pill hides and
  // the banner (with its own "Goal" label) shows the full goal, pushing the steps
  // down; click the banner to undock and restore the pill.
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
      this._caption(txt, this._goalText || "");   // inline math, safe
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

  // The goal popup — its own element (independent of the term tooltip) so a pinned
  // goal survives term hovers. Inline math via _caption; positioned under the pill.
  _showGoalPop() {
    let tip = this._goalPop;
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "pa-goal-pop";
      tip.setAttribute("role", "tooltip");
      document.body.appendChild(tip);
      this._goalPop = tip;
    }
    this._caption(tip, this._goalText || "");   // textContent + KaTeX — never raw HTML
    tip.style.display = "block";
    tip.style.visibility = "hidden";
    const pill = this.container.querySelector(".pa-goal-pill");
    const r = pill.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight, GAP = 8;
    let left = Math.max(8, Math.min(r.left, window.innerWidth - tw - 8));
    let top = r.bottom + GAP;
    if (top + th > window.innerHeight - 4) top = r.top - th - GAP;   // flip above if no room
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(Math.max(4, top))}px`;
    tip.style.visibility = "visible";
  }

  _hideGoalPop() { if (this._goalPop) this._goalPop.style.display = "none"; }

  // An info (ⓘ) pill in the controls row (next to the sequential button) that opens
  // a popup with two tabs — Prerequisites and Explore further. Gated by
  // opts.enableExplore. Hover shows it temporarily; moving onto the popup keeps it
  // open (hover bridge); leaving both hides it. Clicking the pill pins it open.
  // Every chip (both kinds) is clickable → _exploreClick.
  _renderExplore() {
    const pill = this.container.querySelector(".pa-info-pill");
    if (!pill) return;
    // Entries are strings or {text, deeplink} (validate-proof.js) — normalize to
    // objects so chips can carry their own landing view.
    const clean = (v) => (Array.isArray(v) ? v : [])
      .map((s) => (typeof s === "string" ? { text: s } : s))
      .filter((s) => s && typeof s.text === "string" && s.text.trim()).slice(0, 8);
    const tabs = [];
    const prereqs = clean(this.data && this.data.prerequisites);
    const followups = clean(this.data && this.data.followups);
    if (prereqs.length) tabs.push({ key: "prerequisite", label: "Prerequisites", items: prereqs });
    if (followups.length) tabs.push({ key: "followup", label: "Explore further", items: followups });
    if (!this._enableExplore || !tabs.length) { pill.hidden = true; return; }

    pill.classList.add("pa-icon-btn");
    pill.innerHTML = INFO_ICON;
    pill.title = "Prerequisites & follow-ups";
    pill.hidden = false;

    const pop = document.createElement("div");
    pop.className = "pa-explore-pop";
    pop.style.display = "none";
    // Top→bottom: a resize grip, the scrollable chip content, then the tab titles
    // pinned at the BOTTOM (next to the pill). The panel is bottom-anchored, so it
    // grows UPWARD — drag the grip to resize.
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
    // Contained by the box (not document.body): .pa-root is position:relative, so
    // the popup is positioned against the box and is torn down / hidden with it.
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
        // A sparkle icon marks the chip as an AI action — clicking it asks the
        // agent (in-app: chat; embedded: opens the linked view + auto-asks), the
        // same scene-linking flow the term button uses.
        const icon = document.createElement("span");
        icon.className = "pa-explore-chip-icon";
        icon.innerHTML = AI_SPARKLE_SVG;
        const text = document.createElement("span");
        text.className = "pa-explore-chip-text";
        this._caption(text, item.text);   // inline math, safe (no raw HTML)
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
    if (firstBtn) select(tabs[0], firstBtn);   // default to the first tab

    // Hover (temporary) + click (pinned), with a hover bridge so moving pill→popup
    // doesn't close it; leaving both closes it (unless pinned).
    // pinned state lives on the instance so hidePopups() (called when the box is
    // hidden) can unpin it — else a pinned popup orphans on document.body.
    this._explorePinned = false;
    let hideT = null;
    const show = () => { clearTimeout(hideT); pop.style.display = "flex"; this._positionExplorePop(); };
    const hide = () => { pop.style.display = "none"; };
    const scheduleHide = () => { if (this._explorePinned) return; clearTimeout(hideT); hideT = setTimeout(hide, 140); };
    pill.addEventListener("mouseenter", show);
    pill.addEventListener("mouseleave", scheduleHide);
    pop.addEventListener("mouseenter", () => clearTimeout(hideT));
    pop.addEventListener("mouseleave", scheduleHide);
    pill.addEventListener("click", () => {
      this._explorePinned = !this._explorePinned;
      pill.classList.toggle("pa-pinned", this._explorePinned);
      if (this._explorePinned) show(); else hide();
    });

    // Clicking anywhere outside the pill/popup dismisses a pinned popup (e.g. the
    // user steps through the proof, hovers a term, or clicks the prose around it).
    // Capture phase so it fires before in-box click handlers; chips inside the
    // popup keep it open (their target is within `pop`).
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

  // Hide every popup WITHOUT tearing the widget down, and unpin the Explore popup.
  // The term tip and goal pop are appended to document.body (so removing the box
  // doesn't hide them); the math tip and Explore popup are contained in the box,
  // but the Explore popup may be PINNED (display:flex) — unpin it so a box that's
  // hidden then re-shown doesn't resurrect it. The app calls this when a proof box
  // is hidden but kept in memory (step/scene switch). (destroy() removes them all
  // entirely; this just hides + unpins.)
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

  // Position the explore popup so its BOTTOM sits just above the info pill and it's
  // right-aligned to the pill. Bottom-anchored (top:auto) so growing the height —
  // via the resize grip — expands the panel UPWARD.
  // Re-anchor the open Explore popup to the info pill — called on box resize so
  // the popup tracks the box (no-op when it's closed).
  _repositionPopups() {
    if (this._explorePop && this._explorePop.style.display !== "none") this._positionExplorePop();
  }

  _positionExplorePop() {
    const pop = this._explorePop;
    const pill = this.container.querySelector(".pa-info-pill");
    if (!pop || !pill) return;
    // Absolute coords within the box (its containing block). Right-aligned to the
    // info pill and anchored just above it; clamped inside the box on both axes.
    pop.style.visibility = "hidden";
    pop.style.right = "auto";
    pop.style.top = "auto";
    const GAP = 8;
    const cr = this.container.getBoundingClientRect();
    const pr = pill.getBoundingClientRect();
    const pw = pop.offsetWidth;
    let left = (pr.right - cr.left) - pw;                 // right edge aligns to pill
    left = Math.max(4, Math.min(left, cr.width - pw - 4));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.bottom = `${Math.round(cr.bottom - pr.top + GAP)}px`;
    pop.style.visibility = "visible";
  }

  // Drag the top grip to resize the popup upward (bottom stays anchored to the pill).
  _wireExploreResize(grip, pop) {
    let h0 = 0, y0 = 0;
    const onMove = (e) => {
      const max = Math.round(window.innerHeight * 0.7);
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

  // A context-rich message for the agent built from the clicked prereq/follow-up +
  // this derivation's title/goal, so the agent grounds on THIS proof, not a bare prompt.
  _exploreMessage(kind, text) {
    const title = this.data && this.data.title ? ` "${this.data.title}"` : "";
    const goal = this.data && this.data.goal ? ` (${this.data.goal})` : "";
    if (kind === "prerequisite") {
      // Question-form prerequisites are already the ask — don't wrap them in
      // "explain the prerequisite «…?»".
      if (/\?\s*$/.test(text)) return `In the derivation${title}${goal}: ${text}`;
      return `In the derivation${title}${goal}, explain the prerequisite "${text}" `
        + `and how it's used here.`;
    }
    return `I'm exploring the derivation${title}${goal}.\n\n${text}`;
  }

  // Route a prerequisite / follow-up chip click — SAME three contexts as _routeAsk
  // (in-app → chat; embedded → new tab; standalone → this tab). A chip is about the
  // whole proof, so it uses the proof-level deeplink (scene/step + auto-ask) — unless
  // the chip carries its OWN deeplink, which is a "go see it" action in EVERY
  // context: navigate to that view (chat + auto-ask) instead of asking in place.
  _exploreClick(kind, item) {
    const text = item.text;
    const message = this._exploreMessage(kind, text);
    if (!item.deeplink && this._onExplore) { this._onExplore({ kind, text, message }); return; }   // (1) in-app → chat
    this._openAppUrl(                                                            // (2) embedded / (3) standalone
      this._askTargetUrl(item.deeplink || (this.data && this.data.deeplink) || "", message),
      () => this._postToParent({ type: "algebench-explore", kind, text, message }),  // embedded fallback
      () => { try { navigator.clipboard.writeText(text); } catch (e) {} });          // standalone fallback
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
      trust: (ctx) => ctx.command === "\\htmlData",
    });
    return host;
  }

  // ── Stacked (accordion) mode ────────────────────────────────────────────────
  // The stage holds a .pa-lines column with one static .pa-line per step
  // 0..current; only the boundary transition animates. Outside a transition the
  // invariant is: lines exist for EXACTLY [0, current], each a pristine render.
  // _syncLines() restores it (cheaply — untouched lines are left alone), which
  // also self-heals after an interrupted transition.

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
    line.style.fontSize = "";   // promote/demote overrides — resting size is CSS-owned
    this._renderInto(line, this.data.steps[i].latex);
    // Step pill in the line's left gutter: click jumps to that step, hover shows
    // the KaTeX-rendered operation (same tip as the control-bar step buttons).
    // Lives OUTSIDE .pa-expr, so the morph collectors (scoped to .katex-html)
    // never sweep it into a flight.
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "pa-line-pill";
    pill.textContent = String(i);
    this._attachMathTip(pill, this._opText(i));
    pill.addEventListener("click", () => this._userGoTo(i));
    // Step-ask chip: fades in beside the hovered pill (no-ops when no ask
    // factory — _stepAskBtnEl stays null).
    pill.addEventListener("mouseenter", () => this._showStepAskBtn(pill, i));
    pill.addEventListener("mouseleave", () => this._scheduleHideStepAskBtn());
    pill.addEventListener("focus", () => this._showStepAskBtn(pill, i));
    pill.addEventListener("blur", () => this._scheduleHideStepAskBtn());
    line.insertBefore(pill, line.firstChild);
  }

  // Reconcile the line set to steps [0, count): remove extras, add missing,
  // re-render only the lines a transition dirtied. Clears transient accordion
  // styles (held heights, hidden lines) so the resting state is always clean.
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
      } else if (line.dataset.step !== String(i) || line.dataset.dirty) {
        this._renderLine(line, i);
      } else {
        line.style.visibility = "";
        line.style.opacity = "";
        line.style.display = "";
        line.style.fontSize = "";
      }
    }
    this._markCurrentLine();
    // Pill ACTIVE styling moves only at settle (here) — _markCurrentLine runs at
    // transition START for layout, but the pill's highlight follows the anim.
    [...linesEl.children].forEach((el, i) => {
      const pill = el.querySelector(".pa-line-pill");
      if (pill) pill.classList.toggle("pa-pill-active", i === this.current);
    });
    // A rebuilt line discards the pill the math tooltip was anchored to — its
    // mouseleave can never fire, so the tip would stick open. Hide it here.
    if (this._mathTipFor && !this._mathTipFor.isConnected) this._hideMathTip();
    return linesEl;
  }

  _lineAt(i) {
    return this._linesEl ? this._linesEl.children[i] || null : null;
  }

  // Term interactivity is scoped to the CURRENT line in stacked mode (older
  // lines are inert — duplicate data-n ids across lines would make hover/ask
  // ambiguous). CSS keys the pointer affordances off .pa-line-current too.
  _markCurrentLine() {
    if (!this._linesEl) return;
    [...this._linesEl.children].forEach((el, i) =>
      el.classList.toggle("pa-line-current", i === this.current));
  }

  // The root live-terms events/classes operate on: the current line in stacked
  // mode, the whole stage otherwise.
  _liveRoot() {
    return (this.stacked && this._lineAt(this.current)) || this.stage;
  }

  _exprEl() {
    const root = this._liveRoot();
    return root ? root.querySelector(".pa-expr") : null;
  }

  // Mode-aware render of the RESTING state at this.current (no animation).
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

  // fitHeight boxes never grow — the line column scrolls instead. Keep the
  // newest (current) line in view.
  _scrollToCurrent(smooth) {
    if (!this._fitHeight || !this._linesEl) return;
    const el = this._linesEl;
    if (el.scrollHeight <= el.clientHeight + 1) return;
    const line = this._lineAt(this.current);
    const top = line
      ? Math.max(0, line.offsetTop + line.offsetHeight - el.clientHeight + 8)
      : el.scrollHeight;
    try { el.scrollTo({ top, behavior: smooth ? "smooth" : "auto" }); }
    catch (e) { el.scrollTop = top; }
  }

  // Toggle stacked mode at runtime: cancel anything in flight, rebuild the
  // stage scaffold for the new mode, and re-render the current step (a
  // relayout, not a step change — mirrors _relayout()).
  _setStacked(on) {
    on = !!on;
    if (this.stacked === on) return;
    this._playId = null;
    this._paused = false;
    this._openPauseGate();   // unpark a gated play() loop so it can exit
    this._syncPlayUI();
    // Invalidate any in-flight transition BEFORE cancelling: _cancel() stops the
    // animations, but the async goTo runner survives its awaits and would
    // otherwise settle by re-rendering its lines into the rebuilt stage (a
    // stacked column spilling out of a single-mode stage, or vice versa). A
    // fresh token makes every pending token check fail so the runner exits.
    this._token = {};
    this._cancel();
    this.stacked = on;
    const btn = this.container.querySelector(".pa-stack");
    if (btn) { btn.classList.toggle("pa-active", on); btn.setAttribute("aria-pressed", String(on)); }
    this.stage.innerHTML = "";
    this._linesEl = null;
    this._fit();
    this._renderStage();
    this._capOverflow();
    if (this._onRelayout) { try { this._onRelayout(); } catch (e) {} }
  }

  // Leaf glyph spans that carry NO id — e.g. parentheses, which the renderer
  // emits as `\left(\right)` without an \htmlData wrapper (and `\left…\right`
  // can't be split to tag each glyph). The morph keys off data-n, so these are
  // invisible to it and would POP in/out; we fade in the ones that are genuinely
  // ADDED and fade out the ones genuinely REMOVED (matched via _lcsMatch), so
  // parentheses that persist across a step are left untouched.
  _untaggedGlyphs(root) {
    const html = root.querySelector(".katex-html");
    if (!html) return [];
    const out = [];
    html.querySelectorAll("*").forEach((el) => {
      if (el.firstElementChild) return;        // not a leaf element
      // Strip zero-width spacers (U+200B/C/D, BOM) KaTeX inserts for structure —
      // they're not real glyphs and `String.trim()` doesn't remove them.
      const t = (el.textContent || "").replace(/[​-‍﻿]/g, "").trim();
      if (!t) return;
      // Parentheses (plain or stretchy `.delimsizing`) are handled by the unified
      // paren matcher (`_parens`) — exclude them here so they're not animated twice.
      if (_parenChar(t) || el.closest(".delimsizing")) return;
      if (el.hasAttribute("data-n")) return;   // itself a tagged glyph
      const p = el.closest("[data-n]");
      // No tagged ancestor, OR the nearest tagged ancestor is STRUCTURAL (it has
      // tagged descendants) → this is a loose decoration glyph the renderer added
      // without an id (e.g. a parenthesis from \left(\right)). If the nearest
      // tagged ancestor is a LEAF glyph, this span is just part of that glyph's
      // rendering → skip.
      if (!p || p.querySelector("[data-n]")) out.push(el);
    });
    return out;
  }

  // Every parenthesis in `root`, in DOCUMENT ORDER, whether the renderer drew it
  // as a plain glyph or a stretchy `.delimsizing` box. The "unit" is the
  // `.delimsizing` box when present (so a clone keeps its stretched size), else
  // the bare glyph span. Unifying both representations lets a paren that FLIPS
  // between them across a step (KaTeX picks plain vs stretchy by content height)
  // be matched as one and morph — instead of ghosting the old AND fading the new
  // at the same spot (which looked like DUPLICATE parentheses).
  _parens(root) {
    const html = root.querySelector(".katex-html");
    if (!html) return [];
    const out = [];
    const seen = new Set();
    html.querySelectorAll("*").forEach((el) => {
      if (el.firstElementChild) return;        // leaf glyph only
      const ch = _parenChar(el.textContent);
      if (!ch) return;
      const delim = el.closest(".delimsizing");
      const unit = delim || el;
      if (seen.has(unit)) return;
      seen.add(unit);
      if (!delim) {
        if (el.hasAttribute("data-n")) return;            // part of a tagged glyph
        const p = el.closest("[data-n]");
        if (p && !p.querySelector("[data-n]")) return;    // inside a tagged leaf glyph
      }
      // The CONTENT — the id of the node this paren wraps. A paren is identified
      // by WHAT IT ENCLOSES, not by its glyph or its position: `\sin`'s `(` wraps
      // `gamma`, `\ln`'s wraps `v`, a `(-v_e)` group wraps its negation node. The
      // morph matches parens on (char, content), so a paren only ever morphs to
      // one wrapping the SAME node — a function paren can't fly to an unrelated
      // one that merely sorts first (Allen–Eggers `\sin`→`\ln`, step 5→6), and a
      // grouping paren still glides when its OWNER operator changes but the thing
      // it wraps is the same (Tsiolkovsky `(-v_e)` moving from a fraction
      // numerator to a factor, step 3→4). Content is the wrapped node's stable id
      // (rebase prefix stripped for the canonical cross-state key).
      out.push({ char: ch, el: unit, delim: !!delim, content: this._parenContent(el, ch) });
    });
    return out;
  }

  // The stable id of the node a paren wraps — its match key (see _parens). KaTeX
  // draws `\left(X\right)` as a `.minner` row of `[mopen "(", X, mclose ")"]`, so
  // the wrapped content is the paren cell's adjacent sibling: the next sibling for
  // an OPEN delimiter, the previous for a CLOSE. Open vs close comes from KaTeX's
  // `.mopen`/`.mclose` role, NOT the glyph — `_parenChar` also admits `[`/`]`/`|`,
  // so keying off `( ` would misread an opening `[` or `|` as a close and grab the
  // wrong sibling. Returns "" when the content carries no id (e.g. a bare number)
  // — those parens fall back to order-based matching.
  _parenContent(el, ch) {
    const cell = el.closest(".mopen, .mclose") || el;
    const isOpen = cell.classList ? cell.classList.contains("mopen") : ch !== ")";
    const sib = isOpen ? cell.nextElementSibling : cell.previousElementSibling;
    if (!sib) return "";
    let id = sib.getAttribute && sib.getAttribute("data-n");
    if (!id) { const inner = sib.querySelector && sib.querySelector("[data-n]"); id = inner ? inner.getAttribute("data-n") : ""; }
    return (id || "").replace(/^_r\d+_/, "");
  }

  // Like _lcsMatch but returns the actual aligned index PAIRS [srcIdx, tgtIdx],
  // so a preserved paren can be morphed from its source pose to its target pose.
  _lcsPairs(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const pairs = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return pairs;
  }

  // Longest-common-subsequence match between two text sequences. Returns the sets
  // of source/target indices that align (the items that PERSIST). Used to tell a
  // parenthesis that stays put from one that was added or removed.
  _lcsMatch(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const aKeep = new Set(), bKeep = new Set();
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { aKeep.add(i); bKeep.add(j); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return { aKeep, bKeep };
  }

  // leaf glyph spans: a `data-n` with no nested `data-n` (excludes hidden MathML)
  _leaves(root) {
    const map = new Map();
    root.querySelectorAll(".katex-html [data-n]").forEach((el) => {
      if (el.querySelector("[data-n]")) return;
      map.set(el.getAttribute("data-n"), el);
    });
    return map;
  }
  _rects(map) {
    const r = new Map();
    map.forEach((el, id) => r.set(id, el.getBoundingClientRect()));
    return r;
  }

  // rects for EVERY tagged node (internal subexpressions too, not just leaves) —
  // ids are occurrence-unique so there are no collisions.
  _nodeRects(root) {
    const r = new Map();
    root.querySelectorAll(".katex-html [data-n]").forEach((el) =>
      r.set(el.getAttribute("data-n"), el.getBoundingClientRect()));
    return r;
  }

  // Discover the LARGEST subtrees that move as ONE rigid group, so a whole
  // sub-expression glides (and, inside a fraction, shrinks) into place together
  // instead of each glyph flying independently. A group may be *scaled* — e.g. a
  // numerator drops to scriptstyle — so we detect a uniform SIMILARITY transform
  // (translate + single scale), not just a translation.
  //
  // Greedy top-down (shallow first) so we always pick the maximal block; a node
  // qualifies iff it exists in both states, holds no inserted glyph, and every
  // descendant glyph maps from→to under one shared (scale s about the block's
  // top-left, then translate). Singletons (lone glyphs) fall out as size-1 blocks.
  // Returns { blocks: [{el, dx, dy, scale, single}] }.
  _rigidBlocks(stage, fromRects, toRects, fromFontSize, changedIds = new Set()) {
    const els = [...stage.querySelectorAll(".katex-html [data-n]")];
    const depth = (el) => {
      let d = 0, p = el.parentElement;
      while (p) { if (p.hasAttribute && p.hasAttribute("data-n")) d++; p = p.parentElement; }
      return d;
    };
    els.sort((a, b) => depth(a) - depth(b));   // shallow → deep (maximal first)

    const claimed = new WeakSet();
    const blocks = [];

    for (const el of els) {
      if (claimed.has(el)) continue;
      const id = el.getAttribute("data-n");
      if (!fromRects.has(id) || !toRects.has(id) || changedIds.has(id)) continue;  // inserted / changed-glyph node
      const fb = fromRects.get(id), tb = toRects.get(id);
      const inner = el.querySelectorAll("[data-n]");
      const leafEls = inner.length
        ? [...inner].filter((x) => !x.querySelector("[data-n]"))
        : [el];
      const leafIds = leafEls.map((x) => x.getAttribute("data-n"));
      // holds an inserted glyph OR a changed-glyph reuse → not rigid (recurse)
      if (!leafIds.every((lid) => fromRects.has(lid) && !changedIds.has(lid))) continue;

      // Scale = the glyph FONT-SIZE ratio, NOT the box-width ratio. Box width
      // changes when content restructures (parens removed, c^2→c^4) even though
      // the glyphs keep their size — using it stretched every glyph in the block.
      // Font size only changes on a real scriptstyle shift, which is uniform
      // across the whole subtree, so any representative leaf gives the true scale.
      let s = 1;
      const ffs = parseFloat(fromFontSize.get(leafIds[0]));
      const tfs = parseFloat(getComputedStyle(leafEls[0]).fontSize);
      if (ffs > 0 && tfs > 0) s = ffs / tfs;
      if (!(s > 0.02 && s < 50)) s = 1;
      if (Math.abs(s - 1) < 0.02) s = 1;   // exact-equal sizes → no scale
      const tol = 2 + 0.04 * Math.max(fb.width, fb.height);
      const fits = leafIds.every((lid) => {
        const lf = fromRects.get(lid), lt = toRects.get(lid);
        const ex = fb.left + s * (lt.left - tb.left);   // predicted from-pos under the affine
        const ey = fb.top + s * (lt.top - tb.top);
        return Math.abs(ex - lf.left) < tol && Math.abs(ey - lf.top) < tol;
      });
      if (!fits) continue;                                        // parts move/scale independently → recurse to children

      blocks.push({ el, dx: fb.left - tb.left, dy: fb.top - tb.top, scale: s, single: leafEls.length === 1 });
      el.querySelectorAll("[data-n]").forEach((c) => claimed.add(c));
      claimed.add(el);
    }
    return { blocks };
  }

  _cancel() {
    this._running.forEach((a) => { try { a.cancel(); } catch (e) {} });
    this._running = [];
    this._ghosts.forEach((g) => g.remove());
    this._ghosts = [];
    this._cancelMeta();
  }

  // Instantly show a step's final state — no animation. Used when the page can't
  // animate (hidden tab, or a phase whose clock is frozen by window occlusion).
  _snapTo(target) {
    this._cancel();
    this.current = target;
    this._renderStage();
    this._capOverflow();
    this._syncUI();
  }

  // Snapshot everything the morph needs about the CURRENT rendered state of
  // `root`: glyph rects for every tagged node (incl. in-flight transforms →
  // retarget), leaf clones (the DOM may be destroyed on re-render — needed for
  // delete ghosts), untagged glyphs, parens, and structural decorations.
  // Threaded into _morphFlight as its `from` state.
  _morphSnapshot(root) {
    const leaves = this._leaves(root);
    const rects = this._nodeRects(root);    // all nodes, not just leaves
    const cloneOf = new Map();
    const fontSize = new Map();   // exact rendered size (encodes scriptstyle etc.)
    leaves.forEach((el, id) => {
      cloneOf.set(id, el.cloneNode(true));
      fontSize.set(id, getComputedStyle(el).fontSize);
    });
    // Source untagged glyphs (parens etc.) — snapshot so we can ghost them out
    // if they disappear (they have no id to thread).
    const untagged = this._untaggedGlyphs(root).map((el) => ({
      text: el.textContent,
      clone: el.cloneNode(true),
      rect: el.getBoundingClientRect(),
      fontSize: getComputedStyle(el).fontSize,
    }));
    // Source parentheses (plain + stretchy), in document order — so a preserved
    // paren can morph from its old pose and a removed one can ghost out.
    const parens = this._parens(root).map((p) => ({
      char: p.char, delim: p.delim, content: p.content,
      clone: p.el.cloneNode(true),
      rect: p.el.getBoundingClientRect(),
      fontSize: getComputedStyle(p.el).fontSize,
    }));
    // Source decorations (fraction bar, radical, stretchy delimiter), keyed by
    // their owning node (nearest [data-n]) + type — the target ones are matched
    // against these to MORPH a preserved decoration that resized/moved, FADE OUT
    // removed ones, FADE IN new ones.
    const decos = [];
    for (const sel of DECORATIONS) {
      root.querySelectorAll(sel).forEach((el) => {
        const o = el.closest("[data-n]");
        if (!o) return;
        const key = o.getAttribute("data-n") + "|" + sel;
        decos.push({ key, clone: el.cloneNode(true), rect: el.getBoundingClientRect(), fontSize: getComputedStyle(el).fontSize });
      });
    }
    return { leaves, rects, cloneOf, fontSize, untagged, parens, decos };
  }

  async goTo(target) {
    target = Math.max(0, Math.min(this.data.steps.length - 1, target));
    if (target === this.current && this._running.length === 0) return;
    const prev = this.current;
    // When the tab/page is hidden, browsers FREEZE the document timeline, so WAAPI
    // animations never progress and `anim.finished` never resolves — the morph
    // would stall between phases and leave inserted glyphs stuck at opacity 0
    // (a half-rendered final step). There's nothing to watch anyway, so snap
    // straight to the target state; it animates normally once visible again.
    if (typeof document !== "undefined" && document.hidden) {
      this._snapTo(target);
      return;
    }
    if (this.stacked) return this._stackedGoTo(target, prev);
    const token = (this._token = {});
    const seq = this.mode === "sequential";

    // FIRST: snapshot the current state (before _cancel, so in-flight transforms
    // are captured and an interrupting click retargets from the live positions).
    const from = this._morphSnapshot(this.stage);

    this._cancel();
    this.current = target;
    // Meta: a forward (next) step gets the "promote" animation — the Next title
    // slides up into the explanation slot while the old caption fades out; the new
    // Next pill fades in only AFTER the morph (metaFinish, below). Any other jump
    // just snaps the caption.
    let metaFinish = null;
    if (target === prev + 1) {
      this._updateStepButtons();
      metaFinish = this._beginMetaPromote(target);
    } else {
      this._syncUI();
    }

    // LAST: render target, then fly from the snapshot to the fresh render
    this._renderInto(this.stage, this.data.steps[target].latex);
    const done = await this._morphFlight(from, this.stage, { token, seq });
    if (done) {
      this._running = [];
      // Settle to a PRISTINE final render. The animated DOM carries leftover morph
      // styles — pa-move (display:inline-block), pa-insert (z-index:-1), held
      // transforms, inline opacity — any of which can leave a glyph mis-layered or
      // invisible in some browsers/themes. Re-rendering the clean step drops ALL of
      // it, so the resting expression is guaranteed correct and identical to a fresh
      // render. It's visually identical to the just-finished frame, so no flicker.
      this._renderInto(this.stage, this.data.steps[target].latex);
      this._capOverflow();
      // Step animation done → now fade in the new justification + "Next" pill.
      if (metaFinish) metaFinish();
    }
  }

  // The id-keyed FLIP flight from a `_morphSnapshot` state to the freshly
  // rendered contents of `toRoot`. Runs the three phases (fade-out deleted →
  // move matched → fade-in inserted) and resolves to true iff it ran to
  // completion (false = interrupted by a newer goTo). `ghostHost` is the
  // position-relative element delete-ghost clones are appended to (defaults to
  // toRoot); `deleteGhosts:false` skips ghosting removed items entirely —
  // stacked mode uses that for a forward step, where the disappearing glyphs
  // stay visible in the frozen line above.
  async _morphFlight(from, toRoot, { token, seq, ghostHost = toRoot, deleteGhosts = true, onSetup = null } = {}) {
    const fromLeaves = from.leaves;   // NB: may be detached if the root re-rendered
    const fromRects = from.rects;
    // Delete-ghosts are absolutely positioned INSIDE ghostHost, so their offsets
    // must be relative to ghostHost's own rect — not the snapshot root's (the two
    // differ whenever a caller ghosts into a different container). Measured live,
    // in the same synchronous turn as the from-rects, so the frames agree.
    const stageRect = ghostHost.getBoundingClientRect();
    const cloneOf = from.cloneOf;
    const fromFontSize = from.fontSize;
    const fromUntagged = from.untagged;
    const fromParens = from.parens;
    const fromDecos = from.decos;
    const toLeaves = this._leaves(toRoot);
    const toRects = this._nodeRects(toRoot);

    // Matched ids whose GLYPH CHANGED — the diff reused a node id for a different
    // symbol (e.g. + → −, or a coefficient 2 → 3). Without this, such a node is
    // treated as "matched/stationary" and the NEW glyph renders instantly at full
    // opacity (popping in before anything fades). Treat them as delete+insert
    // instead: the old glyph fades OUT (phase 0) and the new one fades IN (phase 2).
    const changedIds = new Set();
    toLeaves.forEach((el, id) => {
      const old = cloneOf.get(id);
      if (old && old.textContent !== el.textContent) changedIds.add(id);
    });

    const await_ = (anims) =>
      Promise.all(anims.map((a) => a.finished.catch(() => {})));

    // ── set up MOVES, but hold each group STATICALLY at its from-pose so the
    // stage still looks like the source state while dropped items fade out ──
    // matched → MOVE the LARGEST rigid groups together (translate + uniform scale,
    // about each block's top-left, so a sub-expression glides/shrinks as one unit)
    const { blocks } = this._rigidBlocks(toRoot, fromRects, toRects, fromFontSize, changedIds);
    const movers = [];
    for (const blk of blocks) {
      const moved = Math.abs(blk.dx) > 0.5 || Math.abs(blk.dy) > 0.5;
      const scaled = Math.abs(blk.scale - 1) > 0.01;
      if (!moved && !scaled) continue;                 // identity → nothing to do
      blk.el.classList.add("pa-move");
      blk.el.style.transformOrigin = "0 0";            // deltas/scale are top-left based
      blk.el.style.transform =                         // hold at the OLD position for now
        `translate(${blk.dx}px, ${blk.dy}px) scale(${blk.scale})`;
      movers.push(blk);
    }

    // target-only glyphs (and changed-glyph reuses) → INSERT (hidden until the end)
    const insertEls = [];
    toLeaves.forEach((el, id) => {
      if (!fromRects.has(id) || changedIds.has(id)) { el.style.opacity = "0"; insertEls.push(el); }
    });

    // Untagged glyphs (parens etc.): LCS-match source↔target by text so a paren
    // that PERSISTS across the step is left untouched. Only genuinely ADDED ones
    // fade in; genuinely REMOVED ones ghost out. They are kept SEPARATE from the
    // id'd glyphs so they can animate in their own sub-phase — AFTER all id'd
    // fades — with a PLAIN opacity tween (no scale/move, so they never shift).
    const toUntagged = this._untaggedGlyphs(toRoot);
    const _uMatch = this._lcsMatch(fromUntagged.map((u) => u.text), toUntagged.map((el) => el.textContent));
    const _uFromKeep = _uMatch.aKeep;
    const untagInserts = [];
    toUntagged.forEach((el, j) => {
      if (!_uMatch.bKeep.has(j)) { el.style.opacity = "0"; untagInserts.push(el); }  // newly added → fade in last
    });

    // Diff target decorations against the source ones (matched by owner|type):
    //   • preserved but moved/resized → FLIP it (hold at the source pose now, the
    //     move phase tweens it to identity) so a fraction bar or radical grows /
    //     shrinks / slides smoothly instead of snapping to its new shape;
    //   • new → fade in last (phase 2);   • removed → ghost out (phase 0, below).
    const decoEls = [];
    const decoMovers = [];
    const srcDecoByKey = new Map();
    for (const d of fromDecos) {
      if (!srcDecoByKey.has(d.key)) srcDecoByKey.set(d.key, []);
      srcDecoByKey.get(d.key).push(d);
    }
    const matchedSrcDeco = new Set();
    for (const sel of DECORATIONS) {
      toRoot.querySelectorAll(sel).forEach((el) => {
        const owner = el.closest("[data-n]");
        const key = (owner ? owner.getAttribute("data-n") : "") + "|" + sel;
        const pool = srcDecoByKey.get(key);
        const src = pool && pool.find((s) => !matchedSrcDeco.has(s));
        if (!src) { el.style.opacity = "0"; decoEls.push(el); return; }   // new → fade in
        const tr = el.getBoundingClientRect();
        const dx = src.rect.left - tr.left, dy = src.rect.top - tr.top;
        const sx = tr.width > 0 ? src.rect.width / tr.width : 1;
        const sy = tr.height > 0 ? src.rect.height / tr.height : 1;
        const changed = Math.abs(dx) > 1 || Math.abs(dy) > 1 || Math.abs(sx - 1) > 0.02 || Math.abs(sy - 1) > 0.02;
        // A radical (`.sqrt svg`) is a single SVG whose path distorts under a
        // non-uniform transform (hook detaches from the overline). So when it
        // changes, CROSS-FADE it like parentheses — leave the source UNmatched so
        // it ghosts out (phase 0) and fade the new one in (phase 2).
        if (sel === ".sqrt svg") {
          if (changed) { el.style.opacity = "0"; decoEls.push(el); }
          else { matchedSrcDeco.add(src); }
          return;
        }
        // A fraction bar / delimiter is one self-contained box → FLIP it.
        matchedSrcDeco.add(src);
        if (changed) {
          el.style.transformOrigin = "0 0";
          el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;   // hold at source pose
          decoMovers.push({ el, dx, dy, sx, sy });
        }
      });
    }
    const removedDecos = fromDecos.filter((d) => !matchedSrcDeco.has(d));

    // ── Parentheses (plain + stretchy), matched as ONE category in document order.
    // A preserved paren MORPHS from its source pose to its target pose (so a paren
    // that flips plain↔stretchy, or grows with its content, glides as one unit
    // instead of duplicating). Genuinely new parens fade in; removed ones ghost out.
    const toParens = this._parens(toRoot);
    // Match on (char, content) — a paren only aligns with one wrapping the SAME
    // node, so a preserved function/group paren morphs while an unrelated paren that
    // merely shares the same `(`/`)` glyph can't hijack its slot (see the content
    // note in _parens).
    const _pTok = (p) => p.char + " " + p.content;
    const parenPairs = this._lcsPairs(fromParens.map(_pTok), toParens.map(_pTok));
    const _pFromKeep = new Set(parenPairs.map((pr) => pr[0]));
    const _pToKeep = new Set(parenPairs.map((pr) => pr[1]));
    const parenMovers = [];
    for (const [si, ti] of parenPairs) {
      const src = fromParens[si], el = toParens[ti].el;
      const tr = el.getBoundingClientRect();
      const dx = src.rect.left - tr.left, dy = src.rect.top - tr.top;
      // A stretchy SVG delimiter distorts under a non-uniform scale (like a
      // radical), so scale only when the target isn't an SVG; otherwise glide
      // position only and let it settle to its true size at the end.
      const isSvg = !!el.querySelector("svg");
      const sx = !isSvg && tr.width > 0 ? src.rect.width / tr.width : 1;
      const sy = !isSvg && tr.height > 0 ? src.rect.height / tr.height : 1;
      const changed = Math.abs(dx) > 1 || Math.abs(dy) > 1 || Math.abs(sx - 1) > 0.02 || Math.abs(sy - 1) > 0.02;
      if (changed) {
        el.classList.add("pa-move");
        el.style.transformOrigin = "0 0";
        el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;   // hold at source pose
        parenMovers.push({ el, dx, dy, sx, sy });
      }
    }
    const parenInserts = [];
    toParens.forEach((p, j) => {
      if (!_pToKeep.has(j)) { p.el.style.opacity = "0"; parenInserts.push(p.el); }   // new → fade in
    });
    const removedParens = fromParens.filter((p, i) => !_pFromKeep.has(i));            // removed → ghost out

    // source-only glyphs → DELETE ghosts: clones placed at their old spot. Each
    // ghost is wrapped in a `.katex` host so KaTeX's font CSS (scoped under
    // `.katex …`) still applies — otherwise the glyph reverts to the default
    // font for a frame before fading.
    const ghosts = [];
    if (deleteGhosts) fromLeaves.forEach((el, id) => {
      if (toRects.has(id) && !changedIds.has(id)) return;   // still present, same glyph
      const f = fromRects.get(id);
      const host = document.createElement("span");
      host.className = "katex pa-ghost";
      Object.assign(host.style, {
        position: "absolute", margin: "0",
        left: f.left - stageRect.left + "px",
        top: f.top - stageRect.top + "px",
        // pin the exact rendered size — the leaf's scriptstyle shrink lives on an
        // ancestor we no longer have, so without this an exponent/subscript would
        // jump to full size for a frame before fading.
        fontSize: fromFontSize.get(id),
      });
      host.appendChild(cloneOf.get(id));
      ghostHost.appendChild(host);
      this._ghosts.push(host);
      ghosts.push(host);
    });
    // Untagged source glyphs (parens etc.) that were REMOVED (not LCS-matched)
    // → ghost them out (in their own array, so they fade AFTER the id'd ghosts).
    const untagGhosts = [];
    if (deleteGhosts) fromUntagged.forEach((u, ui) => {
      if (!_uFromKeep.has(ui)) {
        const host = document.createElement("span");
        host.className = "katex pa-ghost";
        Object.assign(host.style, {
          position: "absolute", margin: "0",
          left: u.rect.left - stageRect.left + "px",
          top: u.rect.top - stageRect.top + "px",
          fontSize: u.fontSize,
        });
        host.appendChild(u.clone);
        ghostHost.appendChild(host);
        this._ghosts.push(host);
        untagGhosts.push(host);
      }
    });
    // Decorations (fraction bar, radical, stretchy delimiter) that DISAPPEARED →
    // ghost the cloned decoration (which keeps its stretched size) at its old spot
    // and fade it out with the other id-less items, instead of letting it vanish.
    if (deleteGhosts) for (const d of removedDecos) {
      const host = document.createElement("span");
      host.className = "katex pa-ghost";
      let left = d.rect.left - stageRect.left, top = d.rect.top - stageRect.top;
      Object.assign(host.style, {
        position: "absolute", margin: "0", lineHeight: "0",
        left: left + "px", top: top + "px", fontSize: d.fontSize,
      });
      host.appendChild(d.clone);
      ghostHost.appendChild(host);
      // A delimiter clone sits at a vertical-align offset inside its host, so its
      // visual box lands above/below the source spot (looks like it "jumps up").
      // Nudge the host to cancel that offset — comparing in STAGE-RELATIVE coords
      // (re-measuring the stage now) so page scroll/reflow between the source
      // snapshot and here can't skew the alignment.
      const sr = ghostHost.getBoundingClientRect();
      const cr = d.clone.getBoundingClientRect();
      const dx = (d.rect.left - stageRect.left) - (cr.left - sr.left);
      const dy = (d.rect.top - stageRect.top) - (cr.top - sr.top);
      if (dx || dy) {
        host.style.left = (left + dx) + "px";
        host.style.top = (top + dy) + "px";
      }
      this._ghosts.push(host);
      untagGhosts.push(host);
    }
    // Parentheses (plain or stretchy) that DISAPPEARED → ghost the clone at its
    // old spot. A stretchy delimiter clone carries a vertical-align offset, so
    // apply the same stage-relative nudge used for decorations above.
    if (deleteGhosts) for (const p of removedParens) {
      const host = document.createElement("span");
      host.className = "katex pa-ghost";
      let left = p.rect.left - stageRect.left, top = p.rect.top - stageRect.top;
      Object.assign(host.style, {
        position: "absolute", margin: "0", lineHeight: "0",
        left: left + "px", top: top + "px", fontSize: p.fontSize,
      });
      host.appendChild(p.clone);
      ghostHost.appendChild(host);
      const sr = ghostHost.getBoundingClientRect();
      const cr = p.clone.getBoundingClientRect();
      const dx = (p.rect.left - stageRect.left) - (cr.left - sr.left);
      const dy = (p.rect.top - stageRect.top) - (cr.top - sr.top);
      if (dx || dy) { host.style.left = (left + dx) + "px"; host.style.top = (top + dy) + "px"; }
      this._ghosts.push(host);
      untagGhosts.push(host);
    }

    // All holds/opacity-0 are applied — the to-root now poses as the source
    // state. Stacked mode unhides the freshly-added line here (it rendered
    // hidden so its final state never flashes before the flight).
    if (onSetup) onSetup();

    // ── PHASE 0: dropped items fade OUT first, before any motion ──
    const D_OUT = this._baseDuration * 0.6;
    const delAnims = [];
    let di = 0;
    for (const host of ghosts) {
      const a = this._tween(host,
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: D_OUT, delay: seq ? di++ * this._baseStagger : 0, easing: EASE, fill: "forwards" }
      );
      a.onfinish = () => host.remove();
      delAnims.push(a);
    }
    // Untagged (parens) fade out AFTER every id'd ghost has gone — plain opacity,
    // no move, clones already pinned in place.
    const _outAfter = (seq ? di * this._baseStagger : 0) + D_OUT;
    let dk = 0;
    for (const host of untagGhosts) {
      const a = this._tween(host,
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: D_OUT, delay: _outAfter + (seq ? dk++ * this._baseStagger : 0), easing: EASE, fill: "forwards" }
      );
      a.onfinish = () => host.remove();
      delAnims.push(a);
    }
    this._running = delAnims;
    await await_(delAnims);
    if (this._token !== token) return false;   // interrupted by a newer goTo

    // ── PHASE 1: matched groups MOVE into place (from held pose → identity) ──
    const moveAnims = [];
    let mi = 0;
    for (const blk of movers) {
      const a = this._tween(blk.el,
        [{ transform: `translate(${blk.dx}px, ${blk.dy}px) scale(${blk.scale})` },
         { transform: "translate(0px, 0px) scale(1)" }],
        // fill BOTH: holds the from-pose during a staggered delay AND keeps the
        // resting pose after it ends, so the block stays put even if the finish
        // event never fires (e.g. a backgrounded tab freezes the timeline).
        { duration: this._baseDuration, delay: seq ? mi++ * this._baseStagger : 0, easing: EASE, fill: "both" }
      );
      a.onfinish = () => {                              // restore normal flow at rest
        blk.el.style.transform = "";
        blk.el.style.transformOrigin = "";
        if (!blk.single) blk.el.classList.remove("pa-move");
      };
      moveAnims.push(a);
    }
    // preserved decorations (fraction bar, radical, delimiter) glide/stretch from
    // their old pose to the new one, in lockstep with the glyphs they wrap.
    for (const dm of decoMovers) {
      const a = this._tween(dm.el,
        [{ transform: `translate(${dm.dx}px, ${dm.dy}px) scale(${dm.sx}, ${dm.sy})` },
         { transform: "translate(0px, 0px) scale(1, 1)" }],
        { duration: this._baseDuration, delay: seq ? mi++ * this._baseStagger : 0, easing: EASE, fill: "both" }
      );
      a.onfinish = () => { dm.el.style.transform = ""; dm.el.style.transformOrigin = ""; };
      moveAnims.push(a);
    }
    // preserved parentheses glide/scale from their old pose to the new one (handles
    // a paren that flips plain↔stretchy or grows with its content), in lockstep.
    for (const pm of parenMovers) {
      const a = this._tween(pm.el,
        [{ transform: `translate(${pm.dx}px, ${pm.dy}px) scale(${pm.sx}, ${pm.sy})` },
         { transform: "translate(0px, 0px) scale(1, 1)" }],
        { duration: this._baseDuration, delay: seq ? mi++ * this._baseStagger : 0, easing: EASE, fill: "both" }
      );
      a.onfinish = () => {
        pm.el.style.transform = ""; pm.el.style.transformOrigin = ""; pm.el.classList.remove("pa-move");
      };
      moveAnims.push(a);
    }
    this._running = moveAnims;
    await await_(moveAnims);
    if (this._token !== token) return false;

    // ── PHASE 2: new items fade IN last (glyphs + structural decorations) ──
    const D_IN = this._baseDuration * 0.7;
    const insAnims = [];
    let ii = 0;
    for (const el of insertEls) {
      el.classList.add("pa-move", "pa-insert");   // pa-insert → paints behind movers/ghosts
      const a = this._tween(el,
        [{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "none" }],
        // fill BOTH: stays at opacity 1 after it ends, so a new glyph never gets
        // stuck invisible if the finish event doesn't fire (frozen/backgrounded tab).
        { duration: D_IN, delay: seq ? ii++ * this._baseStagger : 0, easing: EASE, fill: "both" }
      );
      a.onfinish = () => (el.style.opacity = "");
      insAnims.push(a);
    }
    // Items WITHOUT an id — structural decorations (fraction bar, radical,
    // stretchy delimiters) AND untagged parentheses — fade in AFTER every id'd
    // insert, with plain opacity only (no move/scale), so they appear in place,
    // last, without shifting anything.
    const _inAfter = (seq ? ii * this._baseStagger : 0) + D_IN;
    let ik = 0;
    for (const el of [...decoEls, ...untagInserts, ...parenInserts]) {
      const a = this._tween(el,
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: D_IN, delay: _inAfter + (seq ? ik++ * this._baseStagger : 0), easing: EASE, fill: "both" }
      );
      a.onfinish = () => (el.style.opacity = "");
      insAnims.push(a);
    }
    this._running = insAnims;
    await await_(insAnims);
    return this._token === token;
  }

  // ── Stacked-mode goTo: the accordion ──────────────────────────────────────
  // Forward: expand space for the new line(s), then fly the previous line's
  // terms down into the new current line. The old line keeps its static render
  // (departing terms visually leave their copy behind — that's why the flight
  // runs with deleteGhosts:false). Backward: fly CLONES of the outgoing line's
  // terms up into the (untouched) target line, then collapse the abandoned
  // space. Any-to-any jumps reconcile the line set first and animate only the
  // boundary transition — the same id-keyed generality single-step mode has.
  async _stackedGoTo(target, prev) {
    const token = (this._token = {});
    const seq = this.mode === "sequential";
    this._cancel();
    this._hideStepAskBtn();   // lines are about to reflow under the chip
    // Reconcile to the resting invariant [0, prev] (self-heals an interrupted run).
    this._syncLines(prev + 1);
    this.current = target;
    let metaFinish = null;
    if (target === prev + 1) {
      this._updateStepButtons();
      metaFinish = this._beginMetaPromote(target);
    } else {
      this._syncUI();
    }
    const done = target > prev
      ? await this._stackedAdvance(prev, target, token, seq)
      : await this._stackedRetreat(prev, target, token, seq);
    if (done && this.stacked) {   // mode may have flipped mid-run (belt & braces)
      this._running = [];
      this._syncLines(target + 1);   // pristine settle (drops leftover morph styles)
      // The new current line's pill arrives AFTER the morph: hidden through the
      // flight (see _stackedAdvance's onSetup), it fades in here — in the same
      // synchronous turn as the settle re-render, so no visible pop between.
      // fill:backwards self-releases (no held style). Advance only — on retreat
      // the target pill already existed and was visible; fading it would blink.
      if (target > prev) {
        const pill = this._lineAt(target) && this._lineAt(target).querySelector(".pa-line-pill");
        if (pill) this._tween(pill, [{ opacity: 0 }, { opacity: 1 }],
          { duration: this._baseDuration * 0.5, easing: EASE, fill: "backwards" });
      }
      this._scrollToCurrent(false);
      this._capOverflow();
      if (metaFinish) metaFinish();
    }
  }

  async _stackedAdvance(prev, target, token, seq) {
    const linesEl = this._linesEl;
    const h0 = linesEl.getBoundingClientRect().height;
    // Add lines (prev, target]: intermediates (multi-step jump) render at once
    // and fade in with the expansion; the target line renders HIDDEN — its
    // glyphs get posed by the flight (matched ones held exactly over the
    // previous line's copies), so its final state never flashes early.
    const faders = [];
    for (let i = prev + 1; i <= target; i++) {
      const line = document.createElement("div");
      line.className = "pa-line";
      linesEl.appendChild(line);
      this._renderLine(line, i);
      line.dataset.dirty = "1";   // re-rendered clean at settle (or after interrupt)
      if (i < target) { line.style.opacity = "0"; faders.push(line); }
      else line.style.visibility = "hidden";
    }
    const targetLine = this._lineAt(target);
    const prevLine = this._lineAt(prev);
    // Full-size font BEFORE the class toggle demotes the outgoing line (its
    // resting style shrinks to the history scale — see .pa-stacked .pa-line).
    const fullFs = prevLine ? parseFloat(getComputedStyle(prevLine).fontSize) : 0;
    this._markCurrentLine();
    const h1 = linesEl.getBoundingClientRect().height;
    // Resting opacity of a history line (the --pa-hist-dim var on .pa-root).
    const dimOp = getComputedStyle(this.container).getPropertyValue("--pa-hist-dim").trim() || "1";

    // ── expand: open the vertical space FIRST, so nothing flies into a
    // clipped area. Real `height` (not a transform) so the page/embed
    // ResizeObservers see the accordion grow. fitHeight boxes never grow —
    // the column scrolls instead. The outgoing line DEMOTES in the same
    // breath — it shrinks/dims to its history style while the space opens.
    const D_EXP = this._baseDuration * 0.6;
    const expAnims = [];
    if (!this._fitHeight && h1 - h0 > 1) {
      linesEl.style.overflow = "hidden";
      expAnims.push(this._tween(linesEl,
        [{ height: `${h0}px` }, { height: `${h1}px` }],
        { duration: D_EXP, easing: EASE, fill: "both" }));
    }
    if (prevLine) {
      const smallFs = parseFloat(getComputedStyle(prevLine).fontSize);   // post-toggle
      if (Math.abs(fullFs - smallFs) > 0.5 || Number(dimOp) < 1) {
        expAnims.push(this._tween(prevLine,
          [{ fontSize: `${fullFs}px`, opacity: 1 },
           { fontSize: `${smallFs}px`, opacity: dimOp }],
          { duration: D_EXP, easing: EASE, fill: "both" }));
      }
    }
    for (const line of faders) {
      const a = this._tween(line, [{ opacity: 0 }, { opacity: dimOp }],
        { duration: D_EXP, easing: EASE, fill: "both" });
      a.onfinish = () => (line.style.opacity = "");
      expAnims.push(a);
    }
    if (expAnims.length) {
      this._running = expAnims;
      await Promise.all(expAnims.map((a) => a.finished.catch(() => {})));
      if (this._token !== token) return false;
      expAnims.forEach((a) => { try { a.cancel(); } catch (e) {} });   // release fills
      for (const line of faders) line.style.opacity = "";
      linesEl.style.height = "";
      linesEl.style.overflow = "";
    }
    this._scrollToCurrent(false);   // fitHeight: newest line into view pre-flight

    // ── flight: snapshot the (still static, untouched) from-line and run the
    // standard FLIP phases into the new line. No delete-ghosts — disappearing
    // terms stay visible in the frozen line above.
    const from = this._morphSnapshot(this._lineAt(prev));
    return this._morphFlight(from, targetLine, {
      token, seq, ghostHost: this.stage, deleteGhosts: false,
      onSetup: () => {
        targetLine.style.visibility = "";
        // The line is revealed by a visibility flip (its glyphs are posed by the
        // flight) — keep the step pill HIDDEN through the flight; it fades in at
        // the settle, after the morph completes (see _stackedGoTo). An interrupt
        // marks the line dirty, so the reconcile re-renders a visible pill.
        const pill = targetLine.querySelector(".pa-line-pill");
        if (pill) pill.style.opacity = "0";
      },
    });
  }

  async _stackedRetreat(prev, target, token, seq) {
    const linesEl = this._linesEl;
    const fromLine = this._lineAt(prev);
    const toLine = this._lineAt(target);
    if (!fromLine || !toLine) return this._token === token;   // degenerate → settle snaps

    // ── promote: the target line grows back to full prominence FIRST, so the
    // flight measures (and lands on) its final full-size pose. The outgoing
    // line keeps its full size via inline overrides (the class toggle would
    // otherwise snap it to history style mid-dissolve); the dissolve tween
    // below owns its opacity.
    const smallFs = parseFloat(getComputedStyle(toLine).fontSize);
    const smallOp = getComputedStyle(toLine).opacity;
    fromLine.style.fontSize = getComputedStyle(fromLine).fontSize;
    fromLine.style.opacity = "1";
    this._markCurrentLine();
    const fullFs = parseFloat(getComputedStyle(toLine).fontSize);   // post-toggle
    if (Math.abs(fullFs - smallFs) > 0.5 || Number(smallOp) < 1) {
      const a = this._tween(toLine,
        [{ fontSize: `${smallFs}px`, opacity: smallOp },
         { fontSize: `${fullFs}px`, opacity: 1 }],
        { duration: this._baseDuration * 0.5, easing: EASE, fill: "both" });
      this._running = [a];
      await a.finished.catch(() => {});
      if (this._token !== token) return false;
      try { a.cancel(); } catch (e) {}
    }
    this._scrollToCurrent(false);   // target line into view before measuring

    // The target line is already pristine and visible — it is NEVER mutated.
    // Matched terms fly as CLONES from the outgoing line to their spot in the
    // target line (the clone lands exactly on top of the already-visible glyph
    // and is removed); everything else dissolves with the outgoing line(s).
    const stageRect = this.stage.getBoundingClientRect();
    const fromLeaves = this._leaves(fromLine);
    const fromRects = this._nodeRects(fromLine);
    const toLeaves = this._leaves(toLine);
    const toRects = this._nodeRects(toLine);
    const toFontSize = new Map();
    toLeaves.forEach((el, id) => toFontSize.set(id, getComputedStyle(el).fontSize));
    // ids matched but with a DIFFERENT glyph — they don't fly (they'd land on
    // another symbol); they just dissolve with the outgoing line.
    const changedIds = new Set();
    fromLeaves.forEach((el, id) => {
      const t = toLeaves.get(id);
      if (t && t.textContent !== el.textContent) changedIds.add(id);
    });

    const D = this._baseDuration;
    const flyAnims = [];
    let fi = 0;
    fromLeaves.forEach((el, id) => {
      const t = toRects.get(id);
      if (!t || changedIds.has(id)) return;
      const f = fromRects.get(id);
      const sfs = parseFloat(getComputedStyle(el).fontSize);
      const tfs = parseFloat(toFontSize.get(id));
      let s = sfs > 0 && tfs > 0 ? tfs / sfs : 1;
      if (Math.abs(s - 1) < 0.02) s = 1;
      const host = document.createElement("span");
      host.className = "katex pa-ghost";
      Object.assign(host.style, {
        position: "absolute", margin: "0",
        left: f.left - stageRect.left + "px",
        top: f.top - stageRect.top + "px",
        fontSize: getComputedStyle(el).fontSize,
        transformOrigin: "0 0",
      });
      host.appendChild(el.cloneNode(true));
      this.stage.appendChild(host);
      this._ghosts.push(host);
      const a = this._tween(host,
        [{ transform: "translate(0px, 0px) scale(1)" },
         { transform: `translate(${t.left - f.left}px, ${t.top - f.top}px) scale(${s})` }],
        { duration: D, delay: seq ? fi++ * this._baseStagger : 0, easing: EASE, fill: "both" });
      a.onfinish = () => host.remove();
      flyAnims.push(a);
    });
    // The outgoing line(s) dissolve as their terms fly home.
    const drop = [];
    for (let i = target + 1; i <= prev; i++) {
      const l = this._lineAt(i);
      if (l) drop.push(l);
    }
    for (const line of drop) {
      // Start from the line's ACTUAL opacity — the outgoing current line is at
      // 1, intermediate history lines rest at the dim value.
      flyAnims.push(this._tween(line,
        [{ opacity: getComputedStyle(line).opacity }, { opacity: 0 }],
        { duration: D * 0.6, easing: EASE, fill: "both" }));
    }
    this._running = flyAnims;
    await Promise.all(flyAnims.map((a) => a.finished.catch(() => {})));
    if (this._token !== token) return false;

    // ── collapse: drop the abandoned lines' space (real height, see advance),
    // then the settle in _stackedGoTo removes the elements for good.
    const h1 = linesEl.getBoundingClientRect().height;
    for (const line of drop) line.style.display = "none";
    const h0 = linesEl.getBoundingClientRect().height;
    if (!this._fitHeight && h1 - h0 > 1) {
      linesEl.style.overflow = "hidden";
      const a = this._tween(linesEl,
        [{ height: `${h1}px` }, { height: `${h0}px` }],
        { duration: this._baseDuration * 0.6, easing: EASE, fill: "both" });
      this._running = [a];
      await a.finished.catch(() => {});
      if (this._token !== token) return false;
      try { a.cancel(); } catch (e) {}
      linesEl.style.overflow = "";
      linesEl.style.height = "";
    }
    return this._token === token;
  }

  // the one Play/Pause button — its icon+label are DERIVED from the actual
  // playback state (autoplay loop active and not frozen), never set to a
  // hardcoded value, so the button can't drift out of sync with reality.
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
    if (this._paused) return this._resume();   // frozen → resume
    if (this._playId) return this._pause();    // autoplaying → freeze
    return this.play();                        // idle → start autoplay
  }

  // Release the gate the play() loop parks on while paused (no-op when open).
  _openPauseGate() {
    if (this._pauseOpen) { this._pauseOpen(); this._pauseOpen = null; }
    this._pauseGate = null;
  }

  // Freeze autoplay wherever it is: pause the in-flight WAAPI animations
  // (their `finished` stays pending, so a mid-morph goTo stalls until resumed)
  // AND close the gate the play() loop checks between steps — so a pause taken
  // during the reading gap holds there instead of advancing one more step.
  _pause() {
    this._paused = true;
    this._pauseGate = new Promise((r) => (this._pauseOpen = r));
    for (const a of this._running) { try { a.pause(); } catch (e) {} }
    this._syncPlayUI();
  }
  _resume() {
    this._paused = false;
    this._openPauseGate();
    for (const a of this._running) { try { a.play(); } catch (e) {} }
    this._syncPlayUI();
  }

  // a user-initiated jump: cancels any running play()/pause so autoplay never
  // fights manual navigation, then goes to the step.
  _userGoTo(target) {
    this._playId = null;
    this._paused = false;
    this._openPauseGate();   // unpark a gated play() loop so it can exit
    this._syncPlayUI();
    return this.goTo(target);
  }

  async play() {
    const playId = (this._playId = {});   // user nav clears _playId, ending this loop
    this._paused = false;
    this._openPauseGate();
    this._syncPlayUI();
    try {
      // if we're already at the end, restart from the beginning
      if (this.current >= this.data.steps.length - 1) await this.goTo(0);
      for (let t = this.current + 1; t < this.data.steps.length; t++) {
        // paused (mid-morph OR during the reading gap) → park until resumed
        while (this._paused && this._playId === playId) await this._pauseGate;
        if (this._playId !== playId) return;          // interrupted (user nav)
        await this.goTo(t);
        if (this._playId !== playId) return;
        // reading pause between steps (≈1s at 1×), scaled by the speed multiplier
        await new Promise((r) => setTimeout(r, this._baseStepPause / this.speed));
      }
      // pause taken during the LAST reading gap: hold before declaring done
      while (this._paused && this._playId === playId) await this._pauseGate;
    } finally {
      // only reset if we're still the active loop (not superseded by a newer play)
      if (this._playId === playId) { this._playId = null; this._paused = false; this._syncPlayUI(); }
    }
  }

  // Render a caption: inline LaTeX interspersed with plain text. LaTeX may be
  // delimited by $…$, `…` (backticks — what the LM tends to emit), \(…\) or \[…\];
  // everything else is plain text.
  _caption(el, text) {
    el.innerHTML = "";
    const s = String(text);
    let last = 0, m;
    _CAPTION_RE.lastIndex = 0;
    while ((m = _CAPTION_RE.exec(s)) !== null) {
      if (m.index > last) el.appendChild(document.createTextNode(s.slice(last, m.index)));
      const tok = m[0];
      const inner = (tok[0] === "$" || tok[0] === "`") ? tok.slice(1, -1) : tok.slice(2, -2);
      const span = document.createElement("span");
      try {
        this.katex.render(inner, span, { throwOnError: false, displayMode: false });
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

  // ── step-grounding confidence (tier badges) ─────────────────────────────
  // Per-step `confidence` and top-level `overall_confidence` are attached by
  // the server (animation.build → step_grounding.ground_steps). All reads are
  // guarded: payloads without them render exactly as before (no badges).
  _conf(idx) {
    const s = this.data.steps[idx];
    return (s && s.confidence && s.confidence.tier) ? s.confidence : null;
  }

  // The per-step badge beside the explanation: tier icon + color, with a
  // self-explanatory tooltip (label — meaning, then the concrete reason).
  _setConfBadge(idx, el) {
    el = el || this.container.querySelector(".pa-conf-badge");
    if (!el) return;
    const c = this._conf(idx);
    el.className = "pa-conf-badge";
    el.textContent = "";
    el.removeAttribute("data-tip");
    el.removeAttribute("aria-label");
    if (!c) return;
    el.classList.add(`pa-conf-${c.tier}`);
    el.textContent = _tierGlyph(c.tier, c.icon);
    // Tooltip: when the CAS reached a verdict (or for the start state) the
    // concrete reason IS the story — including a mislabel downgrade, where the
    // generic tier meaning ("could not decide") would contradict it. Only a
    // genuinely undecided step leads with the tier meaning. A domain-justified
    // step (#385) always leads with its specific reason — the judge's rationale
    // already restates the meaning, so the generic prefix would just repeat it.
    let tip = (c.relation === "unknown" && c.tier !== "domain")
      ? `${c.label} — ${c.meaning || ""}${c.reason ? ` (${c.reason})` : ""}`
      : `${c.label} — ${c.reason || c.meaning || ""}`;
    this._attachMathTip(el, tip);   // reasons embed $…$ LaTeX — render it
  }

  // Tooltip (anchored to ``el``) whose text may contain inline $…$ LaTeX,
  // rendered with KaTeX. The confidence reasons embed real expressions (e.g.
  // "scaled by $\frac{…}{…}$") that the plain CSS data-tip can't render, so
  // these badges use a JS tooltip instead. Listeners bind once; re-calls just
  // swap the text. ``aria-label`` keeps a plain-text version for a11y.
  _attachMathTip(el, text) {
    el._mathTipText = text || "";
    el.setAttribute("aria-label", this._plainOp(text || ""));
    el.removeAttribute("data-tip");        // ensure no double (CSS) tooltip
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
    this._mathTipFor = el;   // anchor — so a re-render that discards it can hide the tip
    let tip = this._mathTip;
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "pa-mathtip";
      this.container.appendChild(tip);
      this._mathTip = tip;
    }
    this._caption(tip, text);              // render $…$ segments with KaTeX
    // Measured while at opacity 0 (always display:block) — no display toggle, so the
    // opacity transition (fade) isn't interrupted and there's no resize animation.
    const cr = this.container.getBoundingClientRect();
    const br = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = (br.left - cr.left) + br.width / 2 - tw / 2;
    left = Math.max(4, Math.min(left, cr.width - tw - 4));
    let top = (br.top - cr.top) - th - 8;
    if (top < 4) top = (br.bottom - cr.top) + 8;   // flip below when no room above
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.opacity = "1";               // fade in
  }

  _hideMathTip() {
    this._mathTipFor = null;
    if (this._mathTip) this._mathTip.style.opacity = "0";   // fade out
  }

  // The overall-confidence pill (static for the derivation): icon + tier label
  // + how many transitions verified, e.g. "🥇 Grounded · 6/7".
  _setOverall() {
    const el = this.container.querySelector(".pa-overall");
    if (!el) return;
    const oc = this.data.overall_confidence;
    if (!oc || !oc.tier) { el.remove(); return; }   // legacy payload → no pill
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
    // AI button (same factory as the step ask buttons, so it routes the same way):
    // explain what this confidence badge means. Revealed with the expanded badge;
    // its own click stops propagation, so it never pins/unpins the pill.
    if (this._aiAsk) {
      el.classList.add("pa-overall-has-ask");
      el.append(this._aiAsk("pa-ask-btn pa-ask-overall", "Explain this confidence rating",
        () => this._askOverallMessage()));
    }
    // The overall reason already summarizes the chain (tallies + endpoint), so
    // the pill tooltip is "<Label> — <summary>", not the per-step meaning.
    const tip = `${oc.label} — ${oc.reason || oc.meaning || ""} · click to pin details`;
    this._attachMathTip(el, tip);
    // Reveal-on-demand: the chip is COMPACT (icon only) by default; hovering it
    // peeks the full badge display (label + tally + per-step badge + tinted
    // step dots), and clicking pins/unpins that state (pa-conf-on).
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-pressed", "false");
    const toggle = () => {
      const on = this.container.classList.toggle("pa-conf-on");
      el.setAttribute("aria-pressed", String(on));
    };
    el.addEventListener("click", toggle);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
    el.addEventListener("mouseenter", () => this.container.classList.add("pa-conf-peek"));
    el.addEventListener("mouseleave", () => this.container.classList.remove("pa-conf-peek"));
  }

  _updateStepButtons() {
    this.container.querySelectorAll(".pa-step").forEach((b, i) =>
      b.classList.toggle("pa-active", i === this.current));
    // The start state (step 0) has nothing before it to derive — hide the button.
    // Done HERE (not in _syncUI) because forward steps animate via _beginMetaPromote,
    // which calls _updateStepButtons but skips _syncUI.
    if (this._deriveBtnEl) this._deriveBtnEl.style.display = this.current === 0 ? "none" : "";
  }

  // If the controls row would overflow the container width, hide the numbered
  // step buttons (keep prev / next / play / speed / mode). Re-runs on resize.
  _fitControls() {
    const controls = this.container.querySelector(".pa-controls");
    const steps = this.container.querySelector(".pa-steps");
    if (!controls || !steps) return;
    controls.classList.remove("pa-compact");           // measure with steps shown
    const cs = getComputedStyle(controls);
    const gap = parseFloat(cs.columnGap || cs.gap) || 0;
    const kids = [...controls.children];
    let natural = kids.reduce((sum, k) => sum + k.offsetWidth, 0) + gap * Math.max(0, kids.length - 1);
    if (natural > controls.clientWidth + 1) controls.classList.add("pa-compact");
  }

  // The explanation/title text for a step (numbered).
  _opText(idx) {
    const s = this.data.steps[idx];
    return s.operation ? `${idx}. ${s.operation}` : `state ${idx}`;
  }
  // Flatten an operation string (text + inline LaTeX) to readable plain text for
  // a native tooltip — strip delimiters and turn the most common LaTeX into
  // legible ASCII/Unicode.
  _plainOp(s) {
    return String(s)
      .replace(/\$|`|\\\(|\\\)|\\\[|\\\]/g, "")                       // math delimiters
      .replace(/\\left|\\right/g, "")                                  // \left( -> (
      .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1/$2")       // \frac{a}{b} -> a/b
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")                      // \sqrt{x} -> √(x)
      .replace(/\\cdot/g, "·").replace(/\\times/g, "×")
      .replace(/\^\{([^{}]*)\}/g, "^$1").replace(/_\{([^{}]*)\}/g, "_$1")  // ^{2}->^2, _{0}->_0
      .replace(/\\[a-zA-Z]+/g, "").replace(/[{}]/g, "")               // drop leftover commands/braces
      .replace(/\s+/g, " ").trim();
  }

  // The plain title (no number) of the step AFTER idx, or null if idx is the last.
  _nextOpText(idx) {
    const n = this.data.steps[idx + 1];
    return n ? (n.operation || `state ${idx + 1}`) : null;
  }

  // Clean LaTeX for a step's expression — `plain` is the id-free render the
  // server emits alongside the annotated `latex`; fall back to the raw input.
  _stepExpr(idx) {
    const s = this.data.steps[idx];
    return s.plain || s.input_latex || s.latex || "";
  }

  // Build a derive request for the CURRENT step and hand it to the host to dock.
  // Target = this step's expression; START = the immediately previous step so the
  // derivation fills the gap FROM it TO this step. (Leaving the start to inference
  // produced degenerate results — the model inferred a start ≈ the target, so the
  // first two states came out identical.) The earlier steps still ride along as
  // ``previous_steps`` context; domain carries over; the host adds lesson context.
  _deriveCurrent(anchorEl) {
    if (!this._onDerive) return;
    const i = this.current;
    const target = this._stepExpr(i);
    if (!target) return;
    const payload = { target_latex: target };
    if (this.data.domain) payload.domain = this.data.domain;
    // Anchor the start to the previous step (skip if it's somehow equal/empty).
    if (i > 0) {
      const prev = this._stepExpr(i - 1);
      if (prev && prev.trim() && prev.trim() !== target.trim()) payload.start_latex = prev;
    }
    const previous_steps = this.data.steps.slice(0, i).map((s, k) => ({
      step: k + 1,
      label: s.operation || null,
      math: this._stepExpr(k),
    })).filter(p => p.math);
    if (previous_steps.length) payload.previous_steps = previous_steps;
    // intent hint from the step's own operation (what move produced it)
    const op = this.data.steps[i].operation;
    if (op) payload.intent = String(op).trim();
    this._onDerive(payload, anchorEl);
  }

  // Chat message for the "ask about the current step" button.
  _askCurrentMessage() {
    return this._askStepMessage(this.current);
  }

  // Chat message asking about step `i` — the meta "Ask AI about this step"
  // button (i = current) and the stacked step-pill chip (any line) share it.
  _askStepMessage(i) {
    const s = this.data.steps[i];
    let msg = `I'm looking at step ${i} of the derivation`
      + (this.data.title ? ` "${this.data.title}"` : "") + `:\n$$${this._stepExpr(i)}$$`;
    if (s.operation) msg += `\nOperation: ${s.operation}`;
    if (s.justification) msg += `\nJustification: ${s.justification}`;
    // A DOMAIN-tier step is NOT a symbolic identity — the CAS couldn't verify it
    // and an LM domain expert vouched for it instead. Pass that verdict + reason
    // so the AI addresses the domain justification rather than assuming the step
    // is symbolically proven (and can confirm or challenge the expert's claim).
    const c = this._conf(i);
    if (c && c.tier === "domain") {
      msg += `\n\nNote: a symbolic checker could NOT verify this step — it's marked`
        + ` "${c.label || "Domain"}" (${c.meaning || "valid by domain knowledge, not a symbolic identity"}).`;
      if (c.reason) msg += ` The reasoning given was: ${c.reason}.`;
      msg += `\nIs that domain justification sound? Explain the principle it relies on`
        + ` and whether the step genuinely follows.`;
    } else {
      msg += `\nCan you explain this step — what it does and why it's valid?`;
    }
    return msg;
  }

  // Chat message for the "predict the next step" button — predict-before-reveal:
  // give the AI the next operation/justification as context, but ask it to coach
  // the learner to the resulting expression instead of just stating it. The next
  // expression itself is deliberately NOT included (the message is visible in the
  // chat, so including it would spoil the reveal).
  _askNextMessage() {
    const i = this.current;
    const n = this.data.steps[i + 1];
    let msg = `I'm working through the derivation`
      + (this.data.title ? ` "${this.data.title}"` : "")
      + ` and the current expression (step ${i}) is:\n$$${this._stepExpr(i)}$$`;
    if (n) {
      msg += `\nThe next step is "${n.operation || `state ${i + 1}`}"`;
      if (n.justification) msg += ` (justification: ${n.justification})`;
      msg += `.`;
    }
    msg += `\nBefore revealing the resulting expression, help me predict it myself:`
      + ` ask me what this operation does to the expression and why it's justified,`
      + ` let me attempt the result, and only then confirm or correct it.`;
    return msg;
  }

  // Chat message for the "explain this confidence badge" button on the overall pill.
  _askOverallMessage() {
    const oc = (this.data && this.data.overall_confidence) || {};
    const title = this.data && this.data.title ? ` "${this.data.title}"` : "";
    const tier = oc.label || oc.tier || "this";
    const counts = oc.counts || {};
    const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
    let m = `The derivation${title} carries an overall confidence of "${tier}"`;
    if (total) {
      const good = (counts.grounded || 0) + (counts.verified || 0);
      const bits = [`${good}/${total} steps verified`];
      if (counts.plausible) bits.push(`${counts.plausible} plausible`);
      if (counts.domain) bits.push(`${counts.domain} domain-vouched`);
      if (oc.endpoint_reached === false) bits.push(`the target endpoint was not reached`);
      m += ` (${bits.join(", ")})`;
    }
    if (oc.meaning) m += `. ${oc.meaning}`;
    return m + `.\n\nExplain what this "${tier}" confidence rating means here — how the`
      + ` steps are checked, why the derivation earned this tier rather than a higher one,`
      + ` and how much I should trust the result.`;
  }

  // Meta "promote" animation for a forward (next) step: the current explanation
  // and justification fade OUT, and the title shown in the "Next" pill slides UP
  // into the title position to become the new explanation. Returns a finish()
  // closure that the caller runs AFTER the expression morph completes, which
  // fades in the new justification and the new "Next" pill (never during).
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
    // The confidence badge only animates when revealed (peek/pin); hidden in
    // compact mode it has no box, so there's nothing to fade.
    const badgeShown = badgeEl && getComputedStyle(badgeEl).display !== "none";
    const badgeRect = badgeShown ? badgeEl.getBoundingClientRect() : null;
    const nextWasShown = !nextEl.classList.contains("pa-next-hidden");
    this._metaGhosts = this._metaGhosts || [];
    this._metaAnims = this._metaAnims || [];

    // The confidence badge cross-fades SEQUENTIALLY (not with the text): the old
    // badge fades out fully IN PLACE first, then the new one fades in at its new
    // spot — so the badge never appears to jump position mid-fade. Deliberately
    // slow (~2× the text fade) so the verdict change reads clearly.
    const Dbadge = this._baseDuration;

    // 1. Ghost the OLD explanation + justification at their spots and fade out.
    const ghostOut = (el, rect, duration = this._baseDuration * 0.55) => {
      if (!el.textContent.trim()) return;
      const g = el.cloneNode(true);
      g.classList.add("pa-meta-ghost");
      // Force absolute inline (beats any selector that might keep a ghost in
      // flow) so it fades out exactly over its source spot instead of sinking to
      // the bottom of the meta column by the nav.
      g.style.position = "absolute";
      g.removeAttribute("data-tip");   // ghosts are decorative — no tooltip
      g.removeAttribute("aria-label");
      g.style.left = (rect.left - metaRect.left) + "px";
      g.style.top = (rect.top - metaRect.top) + "px";
      g.style.width = Math.ceil(rect.width) + "px";
      meta.appendChild(g);
      this._metaGhosts.push(g);
      const a = this._tween(g, [{ opacity: 1 }, { opacity: 0 }],
        { duration, easing: EASE, fill: "forwards" });
      a.onfinish = () => g.remove();
      this._metaAnims.push(a);
    };
    ghostOut(opEl, opRect);
    ghostOut(justEl, justRect);
    if (badgeShown) ghostOut(badgeEl, badgeRect, Dbadge);   // fades out IN PLACE, slow

    // 2. The new explanation IS the promoted "Next" title. Put it in the op slot,
    //    hide the (now-promoted) next pill and the old justification, then FLIP the
    //    op up from the Next position into place.
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
      const a = this._tween(opEl,
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: this._baseDuration, easing: EASE, fill: "both" });
      a.onfinish = () => { opEl.style.transform = ""; opEl.classList.remove("pa-promoting"); };
      this._metaAnims.push(a);
    }
    // The new badge fades in AFTER the old one has fully faded out (delay =
    // Dbadge) — sequential, so the badge's position only changes once nothing
    // is visible there. The live badge already reflowed to its new spot but
    // stays at opacity 0 for the whole fade-out window, so no jump is seen.
    if (badgeShown) {
      badgeEl.style.opacity = "0";
      const ba = this._tween(badgeEl, [{ opacity: 0 }, { opacity: 1 }],
        { duration: Dbadge, delay: Dbadge, easing: EASE, fill: "both" });
      ba.onfinish = () => (badgeEl.style.opacity = "");
      this._metaAnims.push(ba);
    }

    // 3. finish(): after the step animation, fade in the new justification first,
    //    then the new "Next" pill on a longer delay (so it trails the caption).
    return () => {
      const ja = this._tween(justEl, [{ opacity: 0 }, { opacity: 1 }],
        { duration: this._baseDuration * 0.6, easing: EASE, fill: "both" });
      ja.onfinish = () => (justEl.style.opacity = "");
      this._metaAnims.push(ja);
      this._setNextPill(nextEl, target);
      if (!nextEl.classList.contains("pa-next-hidden")) {
        nextEl.style.opacity = "0";
        const na = this._tween(nextEl, [{ opacity: 0 }, { opacity: 1 }],
          { duration: this._baseDuration * 0.6, delay: this._baseDuration * 0.7, easing: EASE, fill: "both" });
        na.onfinish = () => (nextEl.style.opacity = "");
        this._metaAnims.push(na);
      }
    };
  }

  // Cancel any in-flight meta animation and reset the meta elements to a clean
  // resting state (called from _cancel so a new navigation never inherits a
  // half-promoted caption).
  _cancelMeta() {
    (this._metaAnims || []).forEach((a) => { try { a.cancel(); } catch (e) {} });
    this._metaAnims = [];
    (this._metaGhosts || []).forEach((g) => g.remove());
    this._metaGhosts = [];
    const opEl = this.container.querySelector(".pa-op");
    if (opEl) { opEl.style.transform = ""; opEl.style.opacity = ""; opEl.classList.remove("pa-promoting"); }
    const justEl = this.container.querySelector(".pa-just");
    if (justEl) justEl.style.opacity = "";
    const nextEl = this.container.querySelector(".pa-next-pill");
    if (nextEl) nextEl.style.opacity = "";
    const badgeEl = this.container.querySelector(".pa-conf-badge");
    if (badgeEl) badgeEl.style.opacity = "";
  }

  // Render the "Next" pill for the step after idx (hidden on the last step).
  _setNextPill(el, idx) {
    if (!el) return;
    const txt = this._nextOpText(idx);
    el.innerHTML = "";
    el.removeAttribute("data-tip");
    if (txt == null) { el.classList.add("pa-next-hidden"); el.removeAttribute("aria-label"); el.removeAttribute("data-fulltip"); return; }
    el.classList.remove("pa-next-hidden");
    // Full text (LaTeX flattened to plain) kept in data-fulltip; data-tip (which
    // is what shows the tooltip) is only set when the title is actually truncated.
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
    // Re-attach the AI ask button (the innerHTML reset above detached it). The
    // offscreen measuring probe in _fixMetaSize gets a listener-less clone so the
    // live button is never moved into — and destroyed with — the probe.
    if (this._nextAskBtn) {
      el.appendChild(el === this._nextPillEl ? this._nextAskBtn : this._nextAskBtn.cloneNode(true));
    }
    this._updateNextTip(el);
  }

  // Show the Next pill's tooltip only when its title is truncated (re-checked on
  // resize, since the available width — and thus truncation — changes). Operates
  // on the given pill (defaults to the live one) so the offscreen probe pill in
  // _fixMetaSize() is measured in isolation, not the live pill.
  _updateNextTip(el) {
    el = el || this.container.querySelector(".pa-next-pill");
    if (!el || el.classList.contains("pa-next-hidden")) return;
    const body = el.querySelector(".pa-next-body");
    const full = el.getAttribute("data-fulltip");
    if (body && full && body.scrollWidth > body.clientWidth + 1) el.setAttribute("data-tip", full);
    else el.removeAttribute("data-tip");
  }
}
