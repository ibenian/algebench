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

export class ProofAnimator {
  constructor(container, data, opts = {}) {
    this.container = container;
    this.data = data;
    this.katex = opts.katex || (typeof window !== "undefined" && window.katex);
    if (!this.katex) throw new Error("ProofAnimator: KaTeX not available");
    this.duration = opts.duration ?? 650;
    this.mode = opts.mode || "parallel";    // 'parallel' | 'sequential'
    this.staggerMs = opts.staggerMs ?? 200;  // sequential per-item lag (specifiable; ~2× the old)
    this.current = 0;
    this._running = [];
    this._ghosts = [];
    this._token = null;
    this._build();
    this._renderInto(this.stage, this.data.steps[0].latex);
    this._syncUI();
  }

  _build() {
    this.container.classList.add("pa-root");
    this.container.innerHTML = `
      <div class="pa-stage" aria-live="polite"></div>
      <div class="pa-meta"><span class="pa-op"></span><span class="pa-just"></span></div>
      <div class="pa-controls">
        <button class="pa-btn pa-prev" title="Previous step">◀</button>
        <div class="pa-steps"></div>
        <button class="pa-btn pa-next" title="Next step">▶</button>
        <button class="pa-btn pa-play" title="Play through">▶ Play</button>
        <label class="pa-mode"><input type="checkbox"> sequential</label>
      </div>`;
    this.stage = this.container.querySelector(".pa-stage");
    const steps = this.container.querySelector(".pa-steps");
    this.data.steps.forEach((s, i) => {
      const b = document.createElement("button");
      b.className = "pa-step";
      b.textContent = String(i);
      b.title = s.operation || `state ${i}`;
      b.addEventListener("click", () => this.goTo(i));
      steps.appendChild(b);
    });
    this.container.querySelector(".pa-prev").onclick = () => this.goTo(this.current - 1);
    this.container.querySelector(".pa-next").onclick = () => this.goTo(this.current + 1);
    this.container.querySelector(".pa-play").onclick = () => this.play();
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
  _rigidBlocks(stage, fromRects, toRects) {
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
      if (!fromRects.has(id) || !toRects.has(id)) continue;       // inserted node
      const fb = fromRects.get(id), tb = toRects.get(id);
      const inner = el.querySelectorAll("[data-n]");
      const leafEls = inner.length
        ? [...inner].filter((x) => !x.querySelector("[data-n]"))
        : [el];
      const leafIds = leafEls.map((x) => x.getAttribute("data-n"));
      if (!leafIds.every((lid) => fromRects.has(lid))) continue;  // holds an inserted glyph → not rigid

      // similarity transform mapping the to-box onto the from-box (top-left origin)
      let s = tb.width > 1 ? fb.width / tb.width : (tb.height > 1 ? fb.height / tb.height : 1);
      if (!(s > 0.02 && s < 50)) s = 1;
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

  async goTo(target) {
    target = Math.max(0, Math.min(this.data.steps.length - 1, target));
    if (target === this.current && this._running.length === 0) return;
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
    // how many of each structural decoration exist now (to detect new ones)
    const fromDeco = {};
    DECORATIONS.forEach((sel) => (fromDeco[sel] = this.stage.querySelectorAll(sel).length));

    this._cancel();
    this.current = target;
    this._syncUI();

    // LAST: render target, measure
    this._renderInto(this.stage, this.data.steps[target].latex);
    const toLeaves = this._leaves(this.stage);
    const toRects = this._nodeRects(this.stage);

    const await_ = (anims) =>
      Promise.all(anims.map((a) => a.finished.catch(() => {})));

    // ── set up MOVES, but hold each group STATICALLY at its from-pose so the
    // stage still looks like the source state while dropped items fade out ──
    // matched → MOVE the LARGEST rigid groups together (translate + uniform scale,
    // about each block's top-left, so a sub-expression glides/shrinks as one unit)
    const { blocks } = this._rigidBlocks(this.stage, fromRects, toRects);
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

    // target-only glyphs → INSERT (hidden until the very end)
    const insertEls = [];
    toLeaves.forEach((el, id) => {
      if (!fromRects.has(id)) { el.style.opacity = "0"; insertEls.push(el); }
    });

    // newly-introduced structural decorations → also fade in last. Only when the
    // source had none of that type, so a persisting fraction/root never blinks.
    const decoEls = [];
    for (const sel of DECORATIONS) {
      if (fromDeco[sel]) continue;
      this.stage.querySelectorAll(sel).forEach((el) => { el.style.opacity = "0"; decoEls.push(el); });
    }

    // source-only glyphs → DELETE ghosts: clones placed at their old spot. Each
    // ghost is wrapped in a `.katex` host so KaTeX's font CSS (scoped under
    // `.katex …`) still applies — otherwise the glyph reverts to the default
    // font for a frame before fading.
    const ghosts = [];
    fromLeaves.forEach((el, id) => {
      if (toRects.has(id)) return;   // still present (as glyph or subtree)
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

    // ── PHASE 0: dropped items fade OUT first, before any motion ──
    const delAnims = [];
    let di = 0;
    for (const host of ghosts) {
      const a = host.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: this.duration * 0.6, delay: seq ? di++ * this.staggerMs : 0, easing: EASE, fill: "forwards" }
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
      const a = blk.el.animate(
        [{ transform: `translate(${blk.dx}px, ${blk.dy}px) scale(${blk.scale})` },
         { transform: "translate(0px, 0px) scale(1)" }],
        { duration: this.duration, delay: seq ? mi++ * this.staggerMs : 0, easing: EASE, fill: "backwards" }
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
      el.classList.add("pa-move");
      const a = el.animate(
        [{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "none" }],
        { duration: this.duration * 0.7, delay: seq ? ii++ * this.staggerMs : 0, easing: EASE, fill: "backwards" }
      );
      a.onfinish = () => (el.style.opacity = "");
      insAnims.push(a);
    }
    // decorations fade in by opacity only (no scale → no layout shift)
    for (const el of decoEls) {
      const a = el.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: this.duration * 0.7, delay: seq ? ii++ * this.staggerMs : 0, easing: EASE, fill: "backwards" }
      );
      a.onfinish = () => (el.style.opacity = "");
      insAnims.push(a);
    }
    this._running = insAnims;
    await await_(insAnims);
    if (this._token === token) this._running = [];
  }

  async play() {
    for (let t = this.current + 1; t < this.data.steps.length; t++) {
      await this.goTo(t);
      await new Promise((r) => setTimeout(r, 280));
    }
  }

  // render a caption with inline LaTeX ($...$) interspersed with plain text
  _caption(el, text) {
    el.innerHTML = "";
    for (const part of String(text).split(/(\$[^$]*\$)/g)) {
      if (part.length >= 2 && part[0] === "$" && part[part.length - 1] === "$") {
        const span = document.createElement("span");
        try {
          this.katex.render(part.slice(1, -1), span, { throwOnError: false, displayMode: false });
        } catch (e) {
          span.textContent = part;
        }
        el.appendChild(span);
      } else if (part) {
        el.appendChild(document.createTextNode(part));
      }
    }
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
