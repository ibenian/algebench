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

const PANEL_FIELDS = [
  ["label", "Label"],
  ["type", "Type"],
  ["role", "Role"],
  ["quantity", "Quantity"],
  ["dimension", "Dimension"],
  ["unit", "Unit"],
  ["op", "Operation"],
];

export class SemanticGraphPanel {
  /**
   * @param {Object} graph - Semantic graph {nodes, edges}
   * @param {Object} opts
   * @param {HTMLElement} opts.container - Element containing the Mermaid SVG
   * @param {Object}  [opts.katex]     - KaTeX instance (for LaTeX rendering)
   * @param {HTMLElement} [opts.tooltip]  - Pre-existing tooltip element (created if absent)
   * @param {HTMLElement} [opts.panel]    - Pre-existing panel element (created if absent)
   */
  constructor(graph, opts = {}) {
    this.graph = graph;
    this.container = opts.container || document.body;
    this.katex = opts.katex || (typeof window !== "undefined" && window.katex);

    this._buildNodeIndex();
    this._buildEdgeList();

    this.tooltip = opts.tooltip || this._createTooltip();
    this.panel = opts.panel || this._createPanel();
    this._activeNode = null;
    this._handlers = [];
  }

  /* ------------------------------------------------------------------ */
  /* Data setup                                                         */
  /* ------------------------------------------------------------------ */

  _buildNodeIndex() {
    this._nodeData = {};
    this._subexprs = {};
    const sanitize = SemanticGraphPanel.sanitizeId;
    for (const node of this.graph.nodes || []) {
      const sid = sanitize(node.id);
      const info = {};
      for (const key of ["id", "type", "label", "emoji", "op", "quantity",
                          "dimension", "unit", "role", "latex"]) {
        if (node[key]) info[key] = node[key];
      }
      this._nodeData[sid] = info;
      if (node.subexpr) this._subexprs[sid] = node.subexpr;
    }
  }

  _buildEdgeList() {
    const sanitize = SemanticGraphPanel.sanitizeId;
    this._edges = (this.graph.edges || []).map(e => [
      sanitize(e.from), sanitize(e.to),
    ]);
  }

  /* ------------------------------------------------------------------ */
  /* DOM creation                                                       */
  /* ------------------------------------------------------------------ */

  _createTooltip() {
    const el = document.createElement("div");
    el.className = "graph-panel-tooltip";
    document.body.appendChild(el);
    return el;
  }

  _createPanel() {
    const el = document.createElement("div");
    el.className = "graph-panel-info";
    el.innerHTML =
      '<button class="gp-close">&times;</button>' +
      '<h3>Node Details</h3>' +
      '<div class="gp-symbol"></div>' +
      '<div class="gp-fields"></div>';
    el.querySelector(".gp-close").addEventListener("click", () => {
      el.classList.remove("open");
    });
    document.body.appendChild(el);
    return el;
  }

  /* ------------------------------------------------------------------ */
  /* Graph traversal                                                    */
  /* ------------------------------------------------------------------ */

  _getUpstream(nodeId) {
    const visited = new Set();
    const queue = [nodeId];
    while (queue.length) {
      const cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const [src, dst] of this._edges) {
        if (dst === cur && !visited.has(src)) queue.push(src);
      }
    }
    return visited;
  }

  _getUpstreamEdgeIndices(upstream) {
    const indices = new Set();
    this._edges.forEach(([src, dst], i) => {
      if (upstream.has(src) && upstream.has(dst)) indices.add(i);
    });
    return indices;
  }

  /* ------------------------------------------------------------------ */
  /* Highlight                                                          */
  /* ------------------------------------------------------------------ */

  _highlight(nodeId) {
    const svg = this.container.querySelector("svg");
    if (!svg) return;
    const upstream = this._getUpstream(nodeId);
    const upEdges = this._getUpstreamEdgeIndices(upstream);
    svg.querySelectorAll(".node").forEach(el => {
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
    svg.querySelectorAll(".node, .edgePath, .flowchart-link, .edgeLabel")
      .forEach(el => { el.style.opacity = "1"; });
  }

  /* ------------------------------------------------------------------ */
  /* Info panel                                                         */
  /* ------------------------------------------------------------------ */

  _showPanel(nodeId) {
    const data = this._nodeData[nodeId];
    if (!data) { this.panel.classList.remove("open"); return; }

    const symbolEl = this.panel.querySelector(".gp-symbol");
    const fieldsEl = this.panel.querySelector(".gp-fields");
    const emoji = data.emoji || "";
    const latex = data.latex || data.id || "";

    if (latex && this.katex) {
      try {
        this.katex.render(latex, symbolEl, { displayMode: true, throwOnError: false });
        if (emoji) symbolEl.innerHTML = emoji + " " + symbolEl.innerHTML;
      } catch (_) { symbolEl.textContent = emoji + " " + latex; }
    } else {
      symbolEl.textContent = emoji + (emoji ? " " : "") + latex;
    }

    let html = "";
    for (const [key, label] of PANEL_FIELDS) {
      if (data[key]) {
        html += `<div class="gp-field"><span class="gp-key">${label}</span>` +
                `<span class="gp-val">${data[key]}</span></div>`;
      }
    }
    const expr = this._subexprs[nodeId];
    if (expr) {
      html += `<div class="gp-field gp-field-col">` +
              `<span class="gp-key">Sub-expression</span>` +
              `<span class="gp-val" id="gp-subexpr-val"></span></div>`;
    }
    fieldsEl.innerHTML = html;

    if (expr && this.katex) {
      const el = document.getElementById("gp-subexpr-val");
      if (el) this.katex.render(expr, el, { displayMode: false, throwOnError: false });
    }
    this.panel.classList.add("open");
  }

  /* ------------------------------------------------------------------ */
  /* Attach / detach                                                    */
  /* ------------------------------------------------------------------ */

  attach() {
    const svg = this.container.querySelector("svg");
    if (!svg) return;

    svg.querySelectorAll(".node").forEach(el => {
      const id = el.id.replace(/^flowchart-/, "").replace(/-\d+$/, "");
      const expr = this._subexprs[id];
      el.style.cursor = "pointer";

      if (expr && this.katex) {
        const onEnter = (e) => {
          this.katex.render(expr, this.tooltip, { displayMode: true, throwOnError: false });
          this.tooltip.classList.add("visible");
        };
        const onMove = (e) => {
          this.tooltip.style.left = (e.clientX + 16) + "px";
          this.tooltip.style.top = (e.clientY - 40) + "px";
        };
        const onLeave = () => { this.tooltip.classList.remove("visible"); };
        el.addEventListener("mouseenter", onEnter);
        el.addEventListener("mousemove", onMove);
        el.addEventListener("mouseleave", onLeave);
        this._handlers.push([el, "mouseenter", onEnter]);
        this._handlers.push([el, "mousemove", onMove]);
        this._handlers.push([el, "mouseleave", onLeave]);
      }

      const onClick = (e) => {
        e.stopPropagation();
        if (this._activeNode === id) {
          this._activeNode = null;
          this._clearHighlight();
          this.panel.classList.remove("open");
        } else {
          this._activeNode = id;
          this._highlight(id);
          this._showPanel(id);
        }
      };
      el.addEventListener("click", onClick);
      this._handlers.push([el, "click", onClick]);
    });

    const onDocClick = (e) => {
      if (this.panel.contains(e.target)) return;
      this._activeNode = null;
      this._clearHighlight();
      this.panel.classList.remove("open");
    };
    document.addEventListener("click", onDocClick);
    this._handlers.push([document, "click", onDocClick]);
  }

  destroy() {
    for (const [el, evt, fn] of this._handlers) {
      el.removeEventListener(evt, fn);
    }
    this._handlers = [];
    if (this.tooltip.parentNode) this.tooltip.remove();
    if (this.panel.parentNode) this.panel.remove();
  }

  /* ------------------------------------------------------------------ */
  /* Utilities                                                          */
  /* ------------------------------------------------------------------ */

  static sanitizeId(nodeId) {
    let out = nodeId;
    for (const ch of "-. {}()*") out = out.replaceAll(ch, "_");
    return out;
  }
}
