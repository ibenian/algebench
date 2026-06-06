/**
 * proof-animation.js — realtime, Manim-style morphing of a derivation.
 *
 * Mirrors the graph-panel pattern: a framework-free ES-module class you point at
 * a container + data, embeddable in the AlgeBench app and runnable standalone
 * from a local launcher.
 *
 * Input `data` = { title, steps: [ { index, operation, justification,
 *   latex (annotated with \htmlData{n=<id>}), plain } ] }, where a sub-expression
 * that persists across steps carries the SAME `data-n` id (threaded server-side).
 *
 * Morph = FLIP on the **leaf** `data-n` spans (tokens), keyed by id:
 *   - id in both states  → tween from old → new position (match / move)
 *   - id only in target  → fade / grow in (insert)
 *   - id only in current → ghost fade out (delete)
 * Leaf-level avoids nested-span transform compounding; the stable id IS the
 * correspondence, so any-to-any jumps (1→5, 5→2, …) work by id-set comparison.
 */

const EASE = "cubic-bezier(.4,0,.2,1)";

export class ProofAnimator {
  constructor(container, data, opts = {}) {
    this.container = container;
    this.data = data;
    this.katex = opts.katex || (typeof window !== "undefined" && window.katex);
    if (!this.katex) throw new Error("ProofAnimator: KaTeX not available");
    this.duration = opts.duration ?? 650;
    this.mode = opts.mode || "parallel"; // 'parallel' | 'sequential'
    this.current = 0;
    this._animating = false;
    this._build();
    this._renderInto(this.stage, this.data.steps[0].latex);
    this._syncUI();
  }

  // ---- DOM scaffold ------------------------------------------------------
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

  // ---- rendering ---------------------------------------------------------
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

  // visible leaf `[data-n]` spans (no nested data-n; excludes hidden MathML)
  _leaves(root) {
    const map = new Map();
    root.querySelectorAll(".katex-html [data-n]").forEach((el) => {
      if (el.querySelector("[data-n]")) return; // not a leaf
      map.set(el.getAttribute("data-n"), el);
    });
    return map;
  }

  _rects(map) {
    const r = new Map();
    map.forEach((el, id) => r.set(id, el.getBoundingClientRect()));
    return r;
  }

  // ---- the morph ---------------------------------------------------------
  async goTo(target) {
    target = Math.max(0, Math.min(this.data.steps.length - 1, target));
    if (target === this.current || this._animating) return;
    this._animating = true;

    // FIRST: measure where leaves are *right now* (live — survives interrupts)
    const fromLeaves = this._leaves(this.stage);
    const fromRects = this._rects(fromLeaves);
    const stageRect = this.stage.getBoundingClientRect();

    // LAST: render target, measure final positions
    this._renderInto(this.stage, this.data.steps[target].latex);
    const toLeaves = this._leaves(this.stage);
    const toRects = this._rects(toLeaves);

    const dur = this.duration;
    const seq = this.mode === "sequential";
    const step = seq ? Math.min(140, (dur * 0.8) / Math.max(1, toLeaves.size)) : 0;
    const anims = [];
    let i = 0;

    // matched/move (tween) + insert (fade in)
    toLeaves.forEach((el, id) => {
      const delay = seq ? i++ * step : 0;
      const from = fromRects.get(id);
      const to = toRects.get(id);
      if (from) {
        const dx = from.left - to.left, dy = from.top - to.top;
        const sx = from.width / Math.max(1, to.width);
        const sy = from.height / Math.max(1, to.height);
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 || Math.abs(sx - 1) > 0.02) {
          el.classList.add("pa-move");
          anims.push(el.animate(
            [{ transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }, { transform: "none" }],
            { duration: dur, delay, easing: EASE, fill: "backwards" }
          ));
        }
      } else {
        el.style.opacity = "0";
        const a = el.animate(
          [{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "none" }],
          { duration: dur, delay, easing: EASE, fill: "backwards" }
        );
        a.onfinish = () => (el.style.opacity = "");
        anims.push(a);
      }
    });

    // delete (ghost fade out): clone old leaves over the stage at their old spot
    fromLeaves.forEach((el, id) => {
      if (toLeaves.has(id)) return;
      const from = fromRects.get(id);
      const ghost = el.cloneNode(true);
      ghost.className = (el.className || "") + " pa-ghost";
      Object.assign(ghost.style, {
        position: "absolute", margin: "0",
        left: from.left - stageRect.left + "px",
        top: from.top - stageRect.top + "px",
      });
      this.stage.appendChild(ghost);
      const a = ghost.animate(
        [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.6)" }],
        { duration: dur * 0.7, easing: "ease-in", fill: "forwards" }
      );
      a.onfinish = () => ghost.remove();
    });

    await Promise.all(anims.map((a) => a.finished.catch(() => {})));
    this.current = target;
    this._animating = false;
    this._syncUI();
  }

  async play() {
    for (let t = this.current + 1; t < this.data.steps.length; t++) {
      await this.goTo(t);
      await new Promise((r) => setTimeout(r, 280));
    }
  }

  // ---- UI sync -----------------------------------------------------------
  _syncUI() {
    this.container.querySelectorAll(".pa-step").forEach((b, i) =>
      b.classList.toggle("pa-active", i === this.current));
    const s = this.data.steps[this.current];
    this.container.querySelector(".pa-op").textContent =
      s.operation ? `${this.current}. ${s.operation}` : `state ${this.current}`;
    this.container.querySelector(".pa-just").textContent = s.justification || "";
  }
}
