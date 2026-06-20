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
    // Optional "Derive this step" integration: a button factory (className,
    // title, onClick) → <button> plus an onDerive(payload, anchorEl) handler the
    // host uses to dock a fresh derivation. Both come from the app (SgProofManager
    // passes labels.js makeDeriveButton + a dock callback); the standalone report
    // omits them, so no derive button renders. Lets a learner break a single
    // animation step into finer sub-steps on demand.
    this._deriveBtnFactory = typeof opts.deriveButton === "function" ? opts.deriveButton : null;
    this._onDerive = typeof opts.onDerive === "function" ? opts.onDerive : null;
    this._deriveBtnEl = null;
    // Optional host hook fired after every internal relayout (resize / fonts), so
    // a host that scales this widget to fit a box (SgProofManager) can re-fit AFTER
    // our fixed zone heights are final — otherwise its scale races our relayout and
    // ends up stale (content overflows / positions shift on the next step).
    this._onRelayout = typeof opts.onRelayout === "function" ? opts.onRelayout : null;
    // Container-fit mode (set by a host that gives the widget a FIXED-size box,
    // e.g. SgProofManager's grid cell): the stage fills the height the box leaves
    // after the fixed text + nav bars, and the expression is scaled to fit that
    // box (width AND height) instead of the stage growing to the expression. The
    // standalone report leaves this false — there the stage grows to the tallest
    // step and the page scrolls.
    this._fitHeight = !!opts.fitHeight;
    this.mode = opts.mode || "parallel";    // 'parallel' | 'sequential'
    // Base timings; the speed multiplier scales them live via animation.playbackRate.
    this._baseDuration = opts.duration ?? 650;
    this._baseStagger = opts.staggerMs ?? 200;
    this._baseStepPause = opts.stepPause ?? 1000;  // Play: reading pause between steps (1× ≈ 1s)
    this._speedIdx = SPEEDS.indexOf(opts.speed ?? 1);
    if (this._speedIdx < 0) this._speedIdx = SPEEDS.indexOf(1);
    this.current = 0;
    this._running = [];
    this._ghosts = [];
    this._token = null;
    this._playId = null;  // identifies the active play() loop; user nav clears it
    this._paused = false; // freeze in-flight animations (works mid-interpolation)
    this._destroyed = false;
    this._ro = null;      // ResizeObserver → re-fit when the container resizes
    this._applySpeed();   // sets this.speed (needs _running to exist)
    this._build();
    // Base (unscaled) expression font; _fit() shrinks from here to fit the width.
    this._baseFontPx = parseFloat(getComputedStyle(this.stage).fontSize) || 30;
    this._fixMetaSize();    // pin the caption area first so the stage's flex height is known
    this._fit();            // scale the expression to fit the stage (width; +height in container mode)
    this._renderInto(this.stage, this.data.steps[0].latex);
    this._syncUI();
    this._capOverflow();    // never let the expression spill past the stage
    this._fitControls();    // hide step enumerations if the controls don't fit
    this._observeResize();  // responsive: re-fit on container/window resize
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
    const availW = Math.max(40, this.stage.clientWidth - 2 * PAD);
    let scale = Math.min(1, availW / w);
    if (this._fitHeight) {
      // Container mode: the stage fills a FIXED height (flex remaining after the
      // text + nav bars). Scale so the tallest step also fits that height; don't
      // pin the stage height (flex owns it). Result: the animation area is a fixed
      // size across all steps and the expression never overflows it.
      const availH = Math.max(20, this.stage.clientHeight - 2 * PAD);
      scale = Math.min(scale, availH / h);
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
  _capOverflow() {
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

  // Re-fit when the container (or window) resizes so the expression always fits
  // the available width. Only width changes matter — guard against the height
  // changes _fit() itself triggers (which would otherwise loop forever).
  _observeResize() {
    if (this._ro || typeof ResizeObserver === "undefined") return;
    this._lastFitW = this.container.clientWidth;
    this._lastFitH = this.container.clientHeight;
    this._ro = new ResizeObserver(() => {
      if (this._destroyed) return;
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
          this._renderInto(this.stage, this.data.steps[this.current].latex);
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
    this._renderInto(this.stage, this.data.steps[this.current].latex);
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
      </div>`;
    this.stage = this.container.querySelector(".pa-stage");
    const steps = this.container.querySelector(".pa-steps");
    this.data.steps.forEach((s, i) => {
      const b = document.createElement("button");
      b.type = "button";   // never submit a surrounding <form>
      b.className = "pa-step";
      b.textContent = String(i);
      let tip = `${i}. ${this._plainOp(s.operation || `state ${i}`)}`;
      // Confidence tint: the row of step buttons doubles as an at-a-glance
      // confidence strip (a colored bar per step, tier-keyed).
      const c = this._conf(i);
      if (c && c.tier) {
        b.classList.add(`pa-conf-${c.tier}`);
        tip += ` — ${c.label || c.tier}`;
      }
      b.setAttribute("data-tip", tip);
      b.setAttribute("aria-label", tip);
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
    modeBtn.onclick = () => {
      this.mode = this.mode === "sequential" ? "parallel" : "sequential";
      const on = this.mode === "sequential";
      modeBtn.classList.toggle("pa-active", on);
      modeBtn.setAttribute("aria-pressed", String(on));
    };
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
      out.push({ char: ch, el: unit, delim: !!delim });
    });
    return out;
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
    this._renderInto(this.stage, this.data.steps[target].latex);
    this._capOverflow();
    this._syncUI();
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
    const token = (this._token = {});
    const seq = this.mode === "sequential";

    // FIRST: measure current glyphs + every tagged subtree (for rigid grouping),
    // incl. in-flight transforms → retarget; clone leaves now (DOM is destroyed
    // on re-render, needed for delete ghosts).
    const fromLeaves = this._leaves(this.stage);
    const fromRects = this._nodeRects(this.stage);    // all nodes, not just leaves
    const stageRect = this.stage.getBoundingClientRect();
    const cloneOf = new Map();
    const fromFontSize = new Map();   // exact rendered size (encodes scriptstyle etc.)
    fromLeaves.forEach((el, id) => {
      cloneOf.set(id, el.cloneNode(true));
      fromFontSize.set(id, getComputedStyle(el).fontSize);
    });
    // Source untagged glyphs (parens etc.) — snapshot before re-render so we can
    // ghost them out if they disappear (they have no id to thread).
    const fromUntagged = this._untaggedGlyphs(this.stage).map((el) => ({
      text: el.textContent,
      clone: el.cloneNode(true),
      rect: el.getBoundingClientRect(),
      fontSize: getComputedStyle(el).fontSize,
    }));
    // Source parentheses (plain + stretchy), in document order — snapshot before
    // re-render so a preserved paren can morph from its old pose and a removed
    // one can ghost out.
    const fromParens = this._parens(this.stage).map((p) => ({
      char: p.char, delim: p.delim,
      clone: p.el.cloneNode(true),
      rect: p.el.getBoundingClientRect(),
      fontSize: getComputedStyle(p.el).fontSize,
    }));
    // Source decorations (fraction bar, radical, stretchy delimiter), keyed by
    // their owning node (nearest [data-n]) + type. Snapshotted before re-render
    // so the target ones can be matched against them — to MORPH a preserved
    // decoration that resized/moved, FADE OUT removed ones, FADE IN new ones.
    const fromDecos = [];
    for (const sel of DECORATIONS) {
      this.stage.querySelectorAll(sel).forEach((el) => {
        const o = el.closest("[data-n]");
        if (!o) return;
        const key = o.getAttribute("data-n") + "|" + sel;
        fromDecos.push({ key, clone: el.cloneNode(true), rect: el.getBoundingClientRect(), fontSize: getComputedStyle(el).fontSize });
      });
    }

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

    // LAST: render target, measure
    this._renderInto(this.stage, this.data.steps[target].latex);
    const toLeaves = this._leaves(this.stage);
    const toRects = this._nodeRects(this.stage);

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
    const { blocks } = this._rigidBlocks(this.stage, fromRects, toRects, fromFontSize, changedIds);
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
    const toUntagged = this._untaggedGlyphs(this.stage);
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
      this.stage.querySelectorAll(sel).forEach((el) => {
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
    const toParens = this._parens(this.stage);
    const parenPairs = this._lcsPairs(fromParens.map((p) => p.char), toParens.map((p) => p.char));
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
    fromLeaves.forEach((el, id) => {
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
      this.stage.appendChild(host);
      this._ghosts.push(host);
      ghosts.push(host);
    });
    // Untagged source glyphs (parens etc.) that were REMOVED (not LCS-matched)
    // → ghost them out (in their own array, so they fade AFTER the id'd ghosts).
    const untagGhosts = [];
    fromUntagged.forEach((u, ui) => {
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
        this.stage.appendChild(host);
        this._ghosts.push(host);
        untagGhosts.push(host);
      }
    });
    // Decorations (fraction bar, radical, stretchy delimiter) that DISAPPEARED →
    // ghost the cloned decoration (which keeps its stretched size) at its old spot
    // and fade it out with the other id-less items, instead of letting it vanish.
    for (const d of removedDecos) {
      const host = document.createElement("span");
      host.className = "katex pa-ghost";
      let left = d.rect.left - stageRect.left, top = d.rect.top - stageRect.top;
      Object.assign(host.style, {
        position: "absolute", margin: "0", lineHeight: "0",
        left: left + "px", top: top + "px", fontSize: d.fontSize,
      });
      host.appendChild(d.clone);
      this.stage.appendChild(host);
      // A delimiter clone sits at a vertical-align offset inside its host, so its
      // visual box lands above/below the source spot (looks like it "jumps up").
      // Nudge the host to cancel that offset — comparing in STAGE-RELATIVE coords
      // (re-measuring the stage now) so page scroll/reflow between the source
      // snapshot and here can't skew the alignment.
      const sr = this.stage.getBoundingClientRect();
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
    for (const p of removedParens) {
      const host = document.createElement("span");
      host.className = "katex pa-ghost";
      let left = p.rect.left - stageRect.left, top = p.rect.top - stageRect.top;
      Object.assign(host.style, {
        position: "absolute", margin: "0", lineHeight: "0",
        left: left + "px", top: top + "px", fontSize: p.fontSize,
      });
      host.appendChild(p.clone);
      this.stage.appendChild(host);
      const sr = this.stage.getBoundingClientRect();
      const cr = p.clone.getBoundingClientRect();
      const dx = (p.rect.left - stageRect.left) - (cr.left - sr.left);
      const dy = (p.rect.top - stageRect.top) - (cr.top - sr.top);
      if (dx || dy) { host.style.left = (left + dx) + "px"; host.style.top = (top + dy) + "px"; }
      this._ghosts.push(host);
      untagGhosts.push(host);
    }

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
    if (this._token !== token) return;   // interrupted by a newer goTo

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
    if (this._token !== token) return;

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
    if (this._token === token) {
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

  // the one Play/Pause button — toggles its icon+label and starts/stops autoplay
  _setPlayLabel(playing) {
    const b = this.container.querySelector(".pa-play");
    if (!b) return;
    b.textContent = playing ? "⏸ Pause" : "▶ Play";
    const tip = playing ? "Pause" : "Play through";
    b.setAttribute("data-tip", tip);
    b.setAttribute("aria-label", tip);
  }
  _togglePlay() {
    if (this._paused) return this._resume();                          // frozen → resume
    if (this._playId || this._running.length) return this._pause();   // animating/autoplaying → freeze
    return this.play();                                               // idle → start autoplay
  }

  // Freeze whatever is mid-interpolation: pause the in-flight WAAPI animations
  // (their `finished` stays pending, so goTo/play stall here until resumed).
  _pause() {
    this._paused = true;
    for (const a of this._running) { try { a.pause(); } catch (e) {} }
    this._setPlayLabel(false);
  }
  _resume() {
    this._paused = false;
    for (const a of this._running) { try { a.play(); } catch (e) {} }
    this._setPlayLabel(true);
  }

  // a user-initiated jump: cancels any running play()/pause so autoplay never
  // fights manual navigation, then goes to the step.
  _userGoTo(target) {
    this._playId = null;
    this._paused = false;
    this._setPlayLabel(false);
    return this.goTo(target);
  }

  async play() {
    const playId = (this._playId = {});   // user nav / pause clears _playId, ending this loop
    this._setPlayLabel(true);
    try {
      // if we're already at the end, restart from the beginning
      if (this.current >= this.data.steps.length - 1) await this.goTo(0);
      for (let t = this.current + 1; t < this.data.steps.length; t++) {
        if (this._playId !== playId) return;          // interrupted (user nav or pause)
        await this.goTo(t);
        if (this._playId !== playId) return;
        // reading pause between steps (≈1s at 1×), scaled by the speed multiplier
        await new Promise((r) => setTimeout(r, this._baseStepPause / this.speed));
      }
    } finally {
      // only reset if we're still the active loop (not superseded by a newer play)
      if (this._playId === playId) { this._playId = null; this._setPlayLabel(false); }
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
    el.textContent = c.icon || "";
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
    let tip = this._mathTip;
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "pa-mathtip";
      this.container.appendChild(tip);
      this._mathTip = tip;
    }
    this._caption(tip, text);              // render $…$ segments with KaTeX
    tip.style.display = "block";
    tip.style.left = "0px";
    tip.style.top = "0px";
    const cr = this.container.getBoundingClientRect();
    const br = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = (br.left - cr.left) + br.width / 2 - tw / 2;
    left = Math.max(4, Math.min(left, cr.width - tw - 4));
    let top = (br.top - cr.top) - th - 8;
    if (top < 4) top = (br.bottom - cr.top) + 8;   // flip below when no room above
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  _hideMathTip() {
    if (this._mathTip) this._mathTip.style.display = "none";
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
    icon.textContent = oc.icon || "";
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
    const i = this.current;
    const s = this.data.steps[i];
    let msg = `I'm looking at step ${i} of the derivation`
      + (this.data.title ? ` "${this.data.title}"` : "") + `:\n$$${this._stepExpr(i)}$$`;
    if (s.operation) msg += `\nOperation: ${s.operation}`;
    if (s.justification) msg += `\nJustification: ${s.justification}`;
    msg += `\nCan you explain this step — what it does and why it's valid?`;
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
