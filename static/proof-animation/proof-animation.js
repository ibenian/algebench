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

    // FIRST: measure current glyphs (incl. in-flight transforms → retarget) and
    // clone them now (the DOM is destroyed on re-render, needed for delete ghosts)
    const fromLeaves = this._leaves(this.stage);
    const fromRects = this._rects(fromLeaves);
    const stageRect = this.stage.getBoundingClientRect();
    const cloneOf = new Map();
    fromLeaves.forEach((el, id) => cloneOf.set(id, el.cloneNode(true)));

    this._cancel();
    this.current = target;
    this._syncUI();

    // LAST: render target, measure
    this._renderInto(this.stage, this.data.steps[target].latex);
    const toLeaves = this._leaves(this.stage);
    const toRects = this._rects(toLeaves);

    const moveAnims = [], delAnims = [], insertEls = [];
    let mi = 0;

    // matched → MOVE (coordinate interpolation); target-only → defer to phase 2
    toLeaves.forEach((el, id) => {
      if (fromRects.has(id)) {
        const f = fromRects.get(id), t = toRects.get(id);
        const dx = f.left - t.left, dy = f.top - t.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          el.classList.add("pa-move");
          moveAnims.push(el.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0px, 0px)" }],
            { duration: this.duration, delay: seq ? mi++ * this.staggerMs : 0, easing: EASE, fill: "backwards" }
          ));
        }
      } else {
        el.style.opacity = "0";   // INSERT — hidden until motion completes
        insertEls.push(el);
      }
    });

    // source-only → DELETE: ghost (clone) fades out during motion (phase 1)
    fromLeaves.forEach((el, id) => {
      if (toLeaves.has(id)) return;
      const f = fromRects.get(id);
      const ghost = cloneOf.get(id);
      ghost.classList.add("pa-ghost", "pa-move");
      Object.assign(ghost.style, {
        position: "absolute", margin: "0",
        left: f.left - stageRect.left + "px",
        top: f.top - stageRect.top + "px",
      });
      this.stage.appendChild(ghost);
      this._ghosts.push(ghost);
      const ga = ghost.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: this.duration * 0.6, easing: EASE, fill: "forwards" }
      );
      ga.onfinish = () => ghost.remove();
      delAnims.push(ga);
    });

    // phase 1: motion (moves + deletes) — wait for ALL of it
    this._running = [...moveAnims, ...delAnims];
    await Promise.all(this._running.map((a) => a.finished.catch(() => {})));
    if (this._token !== token) return;   // interrupted by a newer goTo

    // phase 2: new items fade in, only now that motion is done
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
    this._running = insAnims;
    await Promise.all(insAnims.map((a) => a.finished.catch(() => {})));
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
