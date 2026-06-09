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
// fraction bar, the radical sign, and stretchy delimiters. When newly
// introduced they must fade in LAST with the other new items — never instantly.
// (These selectors hold no tagged glyphs, so hiding them won't hide content.)
const DECORATIONS = [".frac-line", ".sqrt svg", ".delimsizing"];

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
    this._fit();            // size the stage to the largest step, scaled to fit the width
    this._fixMetaSize();    // pin the caption area to the tallest op+justification
    this._renderInto(this.stage, this.data.steps[0].latex);
    this._syncUI();
    this._observeResize();  // responsive: re-fit on container/window resize
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
    probe.append(op, just);
    this.container.appendChild(probe);
    let h = 0;
    for (const s of this.data.steps) {
      this._caption(op, s.operation ? `${s.index}. ${s.operation}` : `state ${s.index}`);
      this._caption(just, s.justification || "");
      h = Math.max(h, probe.getBoundingClientRect().height);
    }
    probe.remove();
    if (h > 0) meta.style.minHeight = Math.ceil(h) + "px";
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
    if (w <= 0) return;
    this._maxExprW = w;
    // Shrink the font so the widest step fits the available width (a tiny gutter
    // keeps it off the edges). The same scale applies to every step, so there's
    // no per-step zoom jump.
    const availW = Math.max(40, this.stage.clientWidth - 8);
    const scale = Math.min(1, availW / w);
    this.stage.style.fontSize = `${this._baseFontPx * scale}px`;
    // Height is pinned (scaled) so the stage never jumps between steps. The
    // expression renders into a fixed-width block (the scaled max) that is
    // centred in the stage with its CONTENT left-aligned (see CSS), so persistent
    // tokens keep a stable left anchor instead of re-centring — and drifting —
    // every step.
    this.stage.style.height = `${Math.ceil(h * scale + 8)}px`;
    this.stage.style.setProperty("--pa-expr-w", `${Math.ceil(w * scale)}px`);
  }

  // Re-fit when the container (or window) resizes so the expression always fits
  // the available width. Only width changes matter — guard against the height
  // changes _fit() itself triggers (which would otherwise loop forever).
  _observeResize() {
    if (this._ro || typeof ResizeObserver === "undefined") return;
    this._lastFitW = this.container.clientWidth;
    this._ro = new ResizeObserver(() => {
      if (this._destroyed) return;
      const w = this.container.clientWidth;
      if (Math.abs(w - this._lastFitW) < 1) return;   // height-only change → skip
      this._lastFitW = w;
      this._relayout();
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
    this._fit();
    this._fixMetaSize();
    this._renderInto(this.stage, this.data.steps[this.current].latex);
  }

  // Tear down the ResizeObserver and any running animations (called when the
  // host removes the proof box — see SgProofManager.closeBox).
  destroy() {
    this._destroyed = true;
    this._cancel();
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
      <div class="pa-meta"><span class="pa-op"></span><span class="pa-just"></span></div>
      <div class="pa-controls">
        <button class="pa-btn pa-prev" title="Previous step" aria-label="Previous step">◀</button>
        <div class="pa-steps"></div>
        <button class="pa-btn pa-next" title="Next step" aria-label="Next step">▶</button>
        <button class="pa-btn pa-play" title="Play through">▶ Play</button>
        <button class="pa-btn pa-speed" title="Animation speed (click to cycle)">${_speedLabel(this.speed)}</button>
        <label class="pa-mode"><input type="checkbox"> sequential</label>
      </div>`;
    this.stage = this.container.querySelector(".pa-stage");
    const steps = this.container.querySelector(".pa-steps");
    this.data.steps.forEach((s, i) => {
      const b = document.createElement("button");
      b.className = "pa-step";
      b.textContent = String(i);
      b.title = s.operation || `state ${i}`;
      b.addEventListener("click", () => this._userGoTo(i));
      steps.appendChild(b);
    });
    this.container.querySelector(".pa-prev").onclick = () => this._userGoTo(this.current - 1);
    this.container.querySelector(".pa-next").onclick = () => this._userGoTo(this.current + 1);
    this.container.querySelector(".pa-play").onclick = () => this._togglePlay();
    this.container.querySelector(".pa-speed").onclick = () => {
      this._speedIdx = (this._speedIdx + 1) % SPEEDS.length;
      this._applySpeed();
    };
    this.container.querySelector(".pa-mode input").onchange = (e) =>
      (this.mode = e.target.checked ? "sequential" : "parallel");
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
  // invisible to it and would POP in/out; we fade them as a group when the
  // untagged sequence changes between steps.
  _untaggedGlyphs(root) {
    const html = root.querySelector(".katex-html");
    if (!html) return [];
    const out = [];
    html.querySelectorAll("*").forEach((el) => {
      if (el.firstElementChild) return;        // not a leaf element
      const t = el.textContent;
      if (!t || !t.trim()) return;
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
  }

  // Instantly show a step's final state — no animation. Used when the page can't
  // animate (hidden tab, or a phase whose clock is frozen by window occlusion).
  _snapTo(target) {
    this._cancel();
    this.current = target;
    this._renderInto(this.stage, this.data.steps[target].latex);
    this._syncUI();
  }

  async goTo(target) {
    target = Math.max(0, Math.min(this.data.steps.length - 1, target));
    if (target === this.current && this._running.length === 0) return;
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
    // which (node, decoration-type) pairs the SOURCE already had — used to tell a
    // genuinely new fraction/root apart from one whose node id was merely reused.
    const fromDecoKeys = new Set();
    for (const sel of DECORATIONS) {
      this.stage.querySelectorAll(sel).forEach((el) => {
        const o = el.closest("[data-n]");
        if (o) fromDecoKeys.add(o.getAttribute("data-n") + "|" + sel);
      });
    }

    this._cancel();
    this.current = target;
    this._syncUI();

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

    // Untagged glyphs (parens etc.): only animate when the sequence actually
    // CHANGED between states, so persistent parens never flicker. New untagged
    // glyphs fade in (phase 2); disappeared ones ghost out (phase 0, below).
    const toUntagged = this._untaggedGlyphs(this.stage);
    const SEP = "";
    const untaggedChanged =
      fromUntagged.map((u) => u.text).join(SEP) !== toUntagged.map((el) => el.textContent).join(SEP);
    if (untaggedChanged) {
      for (const el of toUntagged) { el.style.opacity = "0"; insertEls.push(el); }
    }

    // newly-introduced structural decorations → also fade in last. A decoration
    // (fraction bar, radical, delimiter) belongs to the node that emitted it: its
    // nearest [data-n] ancestor. If that subtree already existed in the source the
    // decoration persists (never blink it); if the subtree is new, so is the
    // decoration → fade it in. This catches a *new inner* fraction even when an
    // outer fraction is already on screen.
    const decoEls = [];
    for (const sel of DECORATIONS) {
      this.stage.querySelectorAll(sel).forEach((el) => {
        const owner = el.closest("[data-n]");
        const ownerId = owner && owner.getAttribute("data-n");
        // keep visible only if that very node already had this decoration in the
        // source (so the outer fraction persists, but a new inner one fades in).
        if (ownerId && fromDecoKeys.has(ownerId + "|" + sel)) return;
        el.style.opacity = "0";
        decoEls.push(el);
      });
    }

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
    // Untagged source glyphs (parens etc.) that disappeared → ghost them out too,
    // so removed parentheses FADE rather than pop. Only when the set changed.
    if (untaggedChanged) {
      for (const u of fromUntagged) {
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
        ghosts.push(host);
      }
    }

    // ── PHASE 0: dropped items fade OUT first, before any motion ──
    const delAnims = [];
    let di = 0;
    for (const host of ghosts) {
      const a = this._tween(host,
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: this._baseDuration * 0.6, delay: seq ? di++ * this._baseStagger : 0, easing: EASE, fill: "forwards" }
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
    this._running = moveAnims;
    await await_(moveAnims);
    if (this._token !== token) return;

    // ── PHASE 2: new items fade IN last (glyphs + structural decorations) ──
    const insAnims = [];
    let ii = 0;
    for (const el of insertEls) {
      el.classList.add("pa-move", "pa-insert");   // pa-insert → paints behind movers/ghosts
      const a = this._tween(el,
        [{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "none" }],
        // fill BOTH: stays at opacity 1 after it ends, so a new glyph never gets
        // stuck invisible if the finish event doesn't fire (frozen/backgrounded tab).
        { duration: this._baseDuration * 0.7, delay: seq ? ii++ * this._baseStagger : 0, easing: EASE, fill: "both" }
      );
      a.onfinish = () => (el.style.opacity = "");
      insAnims.push(a);
    }
    // decorations fade in by opacity only (no scale → no layout shift)
    for (const el of decoEls) {
      const a = this._tween(el,
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: this._baseDuration * 0.7, delay: seq ? ii++ * this._baseStagger : 0, easing: EASE, fill: "both" }
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
    }
  }

  // the one Play/Pause button — toggles its icon+label and starts/stops autoplay
  _setPlayLabel(playing) {
    const b = this.container.querySelector(".pa-play");
    if (!b) return;
    b.textContent = playing ? "⏸ Pause" : "▶ Play";
    b.title = playing ? "Pause" : "Play through";
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
    this.container.querySelectorAll(".pa-step").forEach((b, i) =>
      b.classList.toggle("pa-active", i === this.current));
    const s = this.data.steps[this.current];
    // both the explanation (operation) and the justification — each may use $…$ LaTeX
    this._caption(this.container.querySelector(".pa-op"),
      s.operation ? `${this.current}. ${s.operation}` : `state ${this.current}`);
    this._caption(this.container.querySelector(".pa-just"), s.justification || "");
  }
}
