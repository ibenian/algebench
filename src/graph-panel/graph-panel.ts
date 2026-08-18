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

import { makeAiAskButton } from "/labels.js";
import { nodeLongLabel } from "/graph-panel/d3-semantic-graph.js";
import type { Node as GraphNode, SemanticGraph } from "/types/semantic-graph.js";

/**
 * The subset of a node's fields this panel copies out of the graph, keyed by
 * the SANITIZED node id. Partial because `_buildNodeIndex` copies only the
 * keys that are present and non-null.
 */
type PanelNodeInfo = Partial<GraphNode>;

/** One `[sanitized-from, sanitized-to]` pair of the flattened edge list. */
type PanelEdge = [string, string];

/** One removable DOM listener, as recorded for `destroy()`. */
type PanelHandler = [EventTarget, string, EventListener];

/** See the cast in `sanitizeId` — lib ES2020 predates `String.replaceAll`. */
type Es2021String = { replaceAll(searchValue: string, replaceValue: string): string };

const PANEL_FIELDS: ReadonlyArray<readonly [keyof GraphNode, string]> = [
  ["label", "Label"],
  ["type", "Type"],
  ["role", "Role"],
  ["quantity", "Quantity"],
  ["dimension", "Dimension"],
  ["unit", "Unit"],
  ["value", "Value"],
  ["op", "Operation"],
];

/** Options accepted by the panel's constructor. */
export interface SemanticGraphPanelOptions {
  /** Element containing the Mermaid SVG. */
  container?: HTMLElement;
  /** KaTeX instance (for LaTeX rendering). */
  katex?: typeof katex;
  /** Pre-existing tooltip element (created if absent). */
  tooltip?: HTMLElement;
  /** Pre-existing panel element (created if absent). */
  panel?: HTMLElement;
}

export class SemanticGraphPanel {
  graph: SemanticGraph;
  container: HTMLElement;
  katex: typeof katex | false | undefined;
  tooltip: HTMLElement;
  panel: HTMLElement;

  // Built by _buildNodeIndex() / _buildEdgeList(), both called from the
  // constructor before anything reads them.
  _nodeData!: Record<string, PanelNodeInfo | undefined>;
  _subexprs!: Record<string, string | undefined>;
  _edges!: PanelEdge[];

  _activeNode: string | null;
  _handlers: PanelHandler[];
  _nodeAskBtn: HTMLElement | null;

  // Assigned outside the constructor.
  _panelAskBtn?: HTMLElement;
  _askNodeEls?: { id: string; el: SVGGElement }[];
  _hoveredAskNodeId?: string | null;
  _nodeAskHideTimer?: ReturnType<typeof setTimeout> | null;

  constructor(graph: SemanticGraph, opts: SemanticGraphPanelOptions = {}) {
    this.graph = graph;
    this.container = opts.container || document.body;
    this.katex = opts.katex || (typeof window !== "undefined" && window.katex);

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

  _ensurePanelHeader(panelEl: HTMLElement): void {
    if (panelEl.querySelector(".gp-header")) return;
    const h3 = panelEl.querySelector("h3");
    if (!h3) return;
    const header = document.createElement("div");
    header.className = "gp-header";
    h3.replaceWith(header);
    header.appendChild(h3);
    // Re-parent the close button into the header so it shares the flex
    // layout instead of sitting on top of (and visually colliding with)
    // the AI Ask button.
    const close = panelEl.querySelector(".gp-close");
    if (close) header.appendChild(close);
  }

  /* ------------------------------------------------------------------ */
  /* Data setup                                                         */
  /* ------------------------------------------------------------------ */

  _buildNodeIndex(): void {
    this._nodeData = {};
    this._subexprs = {};
    const sanitize = SemanticGraphPanel.sanitizeId;
    for (const node of this.graph.nodes || []) {
      const sid = sanitize(node.id);
      const info: PanelNodeInfo = {};
      // ``subexpr`` is included so ``nodeLongLabel(info)`` can resolve
      // it; ``exponent`` / ``with_respect_to`` so ``operatorGlyph`` can
      // synthesize ``(·)²`` / ``∂·/∂x`` short labels.
      // `as const` (erased at emit) types each key as a literal `keyof Node`,
      // which is what makes the reads below check.
      for (const key of ["id", "type", "label", "description", "emoji", "op", "quantity",
                          "dimension", "unit", "value", "role", "latex",
                          "subexpr", "exponent", "with_respect_to"] as const) {
        // Cast: copying one key of a union across two objects of the same
        // shape defeats TypeScript's per-key correlation, so the WRITE is
        // widened to a plain string-keyed record. The read stays typed.
        if (node[key] !== undefined && node[key] !== null) (info as Record<string, unknown>)[key] = node[key];
      }
      this._nodeData[sid] = info;
      if (node.subexpr) this._subexprs[sid] = node.subexpr;
    }
  }

  _buildEdgeList(): void {
    const sanitize = SemanticGraphPanel.sanitizeId;
    this._edges = (this.graph.edges || []).map((e): PanelEdge => [
      sanitize(e.from), sanitize(e.to),
    ]);
  }

  /* ------------------------------------------------------------------ */
  /* DOM creation                                                       */
  /* ------------------------------------------------------------------ */

  _createTooltip(): HTMLElement {
    const el = document.createElement("div");
    el.className = "graph-panel-tooltip";
    document.body.appendChild(el);
    return el;
  }

  _createPanel(): HTMLElement {
    const el = document.createElement("div");
    el.className = "graph-panel-info";
    el.innerHTML =
      '<div class="gp-header"><h3>Node Details</h3>' +
      '<button class="gp-close">&times;</button></div>' +
      '<div class="gp-symbol"></div>' +
      '<div class="gp-fields"></div>';
    // Non-null: the markup assigned to innerHTML on the line above contains
    // exactly this button.
    el.querySelector(".gp-close")!.addEventListener("click", () => {
      el.classList.remove("open");
    });
    this._injectPanelAskButton(el);
    document.body.appendChild(el);
    return el;
  }

  _injectPanelAskButton(panelEl: HTMLElement): void {
    const header = panelEl.querySelector(".gp-header") || panelEl;
    const btn = makeAiAskButton(
      "ai-ask-btn graph-panel-ai-btn",
      "Ask AI about this node",
      () => this._buildNodeAskMessage(this._activeNode),
    );
    const close = header.querySelector(".gp-close");
    if (close) header.insertBefore(btn, close);
    else header.appendChild(btn);
    this._panelAskBtn = btn;
  }

  _buildNodeAskMessage(nodeId: string | null | undefined): string {
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
    if (data.value !== undefined) lines.push(`Value: ${data.value}`);
    if (data.op) lines.push(`Operation: ${data.op}`);
    if (subexpr) lines.push(`Expression: $${subexpr}$`);
    if (data.description) lines.push(`Description: ${data.description}`);
    const incoming: string[] = [];
    const outgoing: string[] = [];
    for (const [src, dst] of this._edges) {
      if (dst === nodeId && src !== nodeId) incoming.push(src);
      if (src === nodeId && dst !== nodeId) outgoing.push(dst);
    }
    if (incoming.length) lines.push(`Incoming: ${incoming.join(", ")}`);
    if (outgoing.length) lines.push(`Outgoing: ${outgoing.join(", ")}`);
    return lines.join("\n");
  }

  /* ------------------------------------------------------------------ */
  /* Graph traversal                                                    */
  /* ------------------------------------------------------------------ */

  _getUpstream(nodeId: string): Set<string> {
    const visited = new Set<string>();
    const queue = [nodeId];
    while (queue.length) {
      // Non-null: the loop condition guarantees a non-empty queue.
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const [src, dst] of this._edges) {
        if (dst === cur && !visited.has(src)) queue.push(src);
      }
    }
    return visited;
  }

  _getUpstreamEdgeIndices(upstream: Set<string>): Set<number> {
    const indices = new Set<number>();
    this._edges.forEach(([src, dst], i) => {
      if (upstream.has(src) && upstream.has(dst)) indices.add(i);
    });
    return indices;
  }

  /* ------------------------------------------------------------------ */
  /* Highlight                                                          */
  /* ------------------------------------------------------------------ */

  _highlight(nodeId: string): void {
    const svg = this.container.querySelector("svg");
    if (!svg) return;
    const upstream = this._getUpstream(nodeId);
    const upEdges = this._getUpstreamEdgeIndices(upstream);
    svg.querySelectorAll<SVGGElement>(".node").forEach(el => {
      const id = el.id.replace(/^flowchart-/, "").replace(/-\d+$/, "");
      el.style.opacity = upstream.has(id) ? "1" : "0.15";
    });
    svg.querySelectorAll<SVGGElement>(".edgePath, .flowchart-link").forEach((el, i) => {
      el.style.opacity = upEdges.has(i) ? "1" : "0.1";
    });
    svg.querySelectorAll<SVGGElement>(".edgeLabel").forEach((el, i) => {
      el.style.opacity = upEdges.has(i) ? "1" : "0.1";
    });
  }

  _clearHighlight(): void {
    const svg = this.container.querySelector("svg");
    if (!svg) return;
    svg.querySelectorAll<SVGGElement>(".node, .edgePath, .flowchart-link, .edgeLabel")
      .forEach(el => { el.style.opacity = "1"; });
  }

  /* ------------------------------------------------------------------ */
  /* Info panel                                                         */
  /* ------------------------------------------------------------------ */

  _showPanel(nodeId: string): void {
    const data = this._nodeData[nodeId];
    if (!data) { this.panel.classList.remove("open"); return; }

    // Non-null: both live in the markup _createPanel() writes, and a
    // caller-supplied panel is expected to carry the same structure.
    const symbolEl = this.panel.querySelector(".gp-symbol")!;
    const fieldsEl = this.panel.querySelector(".gp-fields")!;
    const emoji = data.emoji || "";
    const expr = this._subexprs[nodeId];
    const isOp = data.type === 'operator' || data.type === 'relation' || data.type === 'function';
    // Details panel shows the *long label* — the full applied form
    // (``\cos(θ/2)``, ``⟨0|ψ⟩``, ``|⟨0|ψ⟩|²``).  ``nodeLongLabel``
    // encapsulates the precedence (``subexpr → latex → short``).
    const titleLatex = nodeLongLabel(data) || null;
    const titleText = data.id || "";
    const showEmoji = emoji && !isOp;

    if (titleLatex && this.katex) {
      try {
        const mathSpan = document.createElement("span");
        this.katex.render(titleLatex, mathSpan, { displayMode: false, throwOnError: false });
        symbolEl.innerHTML = "";
        if (showEmoji) symbolEl.appendChild(document.createTextNode(emoji));
        symbolEl.appendChild(mathSpan);
      } catch (_) { symbolEl.textContent = (showEmoji ? emoji + " " : "") + titleText; }
    } else {
      symbolEl.textContent = (showEmoji ? emoji + " " : "") + titleText;
    }

    fieldsEl.innerHTML = "";
    for (const [key, label] of PANEL_FIELDS) {
      if (!data[key]) continue;
      // ``label`` carries the symbol's raw LaTeX source — typeset it instead
      // of dumping ``F_{\text{action}}`` into the DOM as text. Skip the row
      // entirely when it's identical to the symbol already rendered at the
      // top of the panel; showing the same thing twice is just clutter.
      if (key === "label" && data.label === titleLatex) continue;
      const row = document.createElement("div");
      row.className = "gp-field";
      const keyEl = document.createElement("span");
      keyEl.className = "gp-key";
      keyEl.textContent = label;
      const valEl = document.createElement("span");
      valEl.className = "gp-val";
      if (key === "label" && typeof window !== "undefined"
          && typeof window.renderKaTeX === "function") {
        // Labels can be plain prose ("force"), pure LaTeX, or a mix —
        // ``renderKaTeX`` handles all three: text passes through, ``$..$``
        // segments typeset as math.
        // Non-null: `if (!data[key]) continue` above proved this key truthy.
        valEl.innerHTML = window.renderKaTeX(data.label!, false);
      } else {
        // String(): textContent is string-valued, while `value` is typed
        // number | string. The `if (!data[key]) continue` above has already
        // dropped every falsy value, so this is the coercion the DOM was
        // performing anyway.
        valEl.textContent = String(data[key]);
      }
      row.append(keyEl, valEl);
      fieldsEl.appendChild(row);
    }
    if (data.description) {
      const desc = document.createElement("div");
      desc.className = "gp-description";
      // Use the project's standard renderer (labels.js → window.renderKaTeX)
      // so descriptions get the same prose+math+markdown handling as the rest
      // of the app (proof steps, overlays, slider labels, 3D label objects).
      // Safe to use innerHTML here because the agent schema rejects HTML
      // brackets via _NO_HTML pattern on the description field.
      if (typeof window !== "undefined" && typeof window.renderKaTeX === "function") {
        // Non-null: guarded by `if (data.description)`.
        desc.innerHTML = window.renderKaTeX(data.description!, false);
      } else {
        desc.textContent = data.description!;
      }
      fieldsEl.appendChild(desc);
    }
    this.panel.classList.add("open");
  }

  /* ------------------------------------------------------------------ */
  /* Attach / detach                                                    */
  /* ------------------------------------------------------------------ */

  _ensureNodeAskBtn(): HTMLElement {
    if (this._nodeAskBtn) return this._nodeAskBtn;
    const btn = makeAiAskButton(
      "ai-ask-btn graph-node-ai-btn",
      "Ask AI about this node",
      () => this._buildNodeAskMessage(this._hoveredAskNodeId || this._activeNode),
    );
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

  _showNodeAskBtnFor(nodeEl: SVGGElement): void {
    const btn = this._ensureNodeAskBtn();
    this._cancelNodeAskHide();
    const r = nodeEl.getBoundingClientRect();
    btn.style.left = (r.right - 6) + "px";
    btn.style.top = (r.top - 10) + "px";
    btn.style.opacity = "1";
    btn.style.pointerEvents = "auto";
  }

  _cancelNodeAskHide(): void {
    if (this._nodeAskHideTimer) {
      clearTimeout(this._nodeAskHideTimer);
      this._nodeAskHideTimer = null;
    }
  }

  _hideNodeAskBtn(): void {
    if (!this._nodeAskBtn) return;
    const btn = this._nodeAskBtn;
    this._cancelNodeAskHide();
    this._nodeAskHideTimer = setTimeout(() => {
      btn.style.opacity = "0";
      btn.style.pointerEvents = "none";
    }, 220);
  }

  attach(): void {
    const svg = this.container.querySelector("svg");
    if (!svg) return;

    this._askNodeEls = [];

    svg.querySelectorAll<SVGGElement>(".node").forEach(el => {
      const id = el.id.replace(/^flowchart-/, "").replace(/-\d+$/, "");
      const expr = this._subexprs[id];
      el.style.cursor = "pointer";

      if (expr && this.katex) {
        // Alias: `this.katex` is typed as possibly-false, and the truthiness
        // narrowing above does not survive into the closure below.
        const katexLib = this.katex;
        const onEnter = (e: Event) => {
          katexLib.render(expr, this.tooltip, { displayMode: true, throwOnError: false });
          this.tooltip.classList.add("visible");
        };
        const onMove = (e: MouseEvent) => {
          this.tooltip.style.left = (e.clientX + 16) + "px";
          this.tooltip.style.top = (e.clientY - 40) + "px";
        };
        const onLeave = () => { this.tooltip.classList.remove("visible"); };
        el.addEventListener("mouseenter", onEnter);
        el.addEventListener("mousemove", onMove as EventListener);
        el.addEventListener("mouseleave", onLeave);
        this._handlers.push([el, "mouseenter", onEnter]);
        this._handlers.push([el, "mousemove", onMove as EventListener]);
        this._handlers.push([el, "mouseleave", onLeave]);
      }

      const onClick = (e: Event) => {
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
      this._handlers.push([el, "click", onClick]);

      // Track this node for the global pointer-tracking ask-button logic.
      this._askNodeEls = this._askNodeEls || [];
      this._askNodeEls.push({ id, el });
    });

    const onDocClick = (e: MouseEvent) => {
      if (this._activeNode === null) return;
      if (this.panel.contains(e.target as globalThis.Node)) return;
      // Only deselect when the click landed inside the graph viewport itself
      // (i.e. clicked the canvas / empty SVG area). Clicks on the chat,
      // side panel, scenes tree, controls, etc. must preserve selection so
      // the user can reference the active node from the chat.
      if (!this.container.contains(e.target as globalThis.Node)) return;
      // Clicks on a node are handled by the node-level click handler above —
      // bail here so we don't double-process and clear state mid-toggle.
      if ((e.target as Element).closest && (e.target as Element).closest(".node")) return;
      this._activeNode = null;
      this._clearHighlight();
      this.panel.classList.remove("open");
      this._hideNodeAskBtn();
      this._emitSelectionChange();
    };
    document.addEventListener("click", onDocClick);
    this._handlers.push([document, "click", onDocClick as EventListener]);

    // Global pointer tracker for the ask button — robust to gaps between a
    // node and the floating button when nodes are large or shapes are wide.
    const onPointerMove = (e: PointerEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      const btn = this._nodeAskBtn;
      if (btn) {
        const br = btn.getBoundingClientRect();
        const padded = (r: DOMRect, pad: number) => x >= r.left - pad && x <= r.right + pad
          && y >= r.top - pad && y <= r.bottom + pad;
        if (btn.style.opacity === "1" && padded(br, 12)) {
          this._cancelNodeAskHide();
          return;
        }
      }
      let bestEl: SVGGElement | null = null;
      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const { id, el } of this._askNodeEls || []) {
        const op = el.style.opacity;
        if (op && parseFloat(op) < 0.9) continue;
        const r = el.getBoundingClientRect();
        const padX = 24;
        const padY = 18;
        if (x >= r.left - padX && x <= r.right + padX
            && y >= r.top - padY && y <= r.bottom + padY) {
          const cx = (r.left + r.right) / 2;
          const cy = (r.top + r.bottom) / 2;
          const d = Math.hypot(x - cx, y - cy);
          if (d < bestDist) { bestDist = d; bestEl = el; bestId = id; }
        }
      }
      if (bestEl) {
        this._hoveredAskNodeId = bestId;
        this._showNodeAskBtnFor(bestEl);
      } else {
        this._hideNodeAskBtn();
      }
    };
    document.addEventListener("pointermove", onPointerMove as EventListener);
    this._handlers.push([document, "pointermove", onPointerMove as EventListener]);
  }

  /**
   * Programmatically activate a node — same effect as a user click.
   * No-op (returns false) if the id isn't in this graph's node index, so
   * callers can safely pass a stale id from a previous render without
   * having to check first. Returns true on successful selection.
   */
  selectNode(nodeId: string | null | undefined): boolean {
    if (!nodeId || !this._nodeData[nodeId]) return false;
    this._activeNode = nodeId;
    this._highlight(nodeId);
    this._showPanel(nodeId);
    this._emitSelectionChange();
    return true;
  }

  /** Currently active node id, or null. */
  get activeNode(): string | null {
    return this._activeNode;
  }

  /**
   * Return a serializable payload for a node id (sanitized id form),
   * including immediate edge neighbors. Used by chat-context builders to
   * tell the AI assistant which node the user has selected.
   */
  getNodePayload(
    nodeId: string | null | undefined,
  ): (Omit<PanelNodeInfo, "subexpr"> & { subexpr: string | null; neighbors: { incoming: string[]; outgoing: string[] } }) | null {
    if (!nodeId || !this._nodeData[nodeId]) return null;
    const data = this._nodeData[nodeId];
    const subexpr = this._subexprs[nodeId] || null;
    const incoming: string[] = [];
    const outgoing: string[] = [];
    for (const [src, dst] of this._edges) {
      if (dst === nodeId && src !== nodeId) incoming.push(src);
      if (src === nodeId && dst !== nodeId) outgoing.push(dst);
    }
    return {
      ...data,
      subexpr,
      neighbors: { incoming, outgoing },
    };
  }

  _emitSelectionChange(): void {
    if (typeof window === "undefined") return;
    try {
      window.dispatchEvent(new CustomEvent("algebench:graphselectionchange", {
        detail: {
          activeNode: this._activeNode,
          payload: this._activeNode ? this.getNodePayload(this._activeNode) : null,
        },
      }));
    } catch {}
  }

  destroy(): void {
    for (const [el, evt, fn] of this._handlers) {
      el.removeEventListener(evt, fn);
    }
    this._handlers = [];
    if (this.tooltip.parentNode) this.tooltip.remove();
    if (this.panel.parentNode) this.panel.remove();
    if (this._nodeAskBtn && this._nodeAskBtn.parentNode) this._nodeAskBtn.remove();
    this._nodeAskBtn = null;
  }

  /* ------------------------------------------------------------------ */
  /* Utilities                                                          */
  /* ------------------------------------------------------------------ */

  static sanitizeId(nodeId: string): string {
    let out = String(nodeId);
    // Cast: `String.prototype.replaceAll` is ES2021 and this project compiles
    // against lib ES2020, so the string type has no `replaceAll`; every browser
    // that runs this build does.
    for (const ch of "-. {}()*") out = (out as unknown as Es2021String).replaceAll(ch, "_");
    if (!out || !/^[A-Za-z_]/.test(out)) out = `n_${out}`;
    return out;
  }
}
