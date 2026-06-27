// Shareable proof-animation page logic.
//
// Loads one or more pre-baked proof JSONs named by ?builtin=<domain>/<name> and
// renders each with the (dependency-free) ProofAnimator engine. After this module
// loads it makes only same-origin fetches to /proofs; nothing is sent anywhere.
//
// SAFETY: every proof JSON is treated as hostile input (it may be hand-edited or,
// in Phase 2, fetched from elsewhere). Defenses, layered:
//   1. The URL param is regex-validated before any fetch (no traversal reaches the server).
//   2. validateProofData() whitelists fields/types and caps sizes before the engine sees it.
//   3. The engine renders math through KaTeX with trust limited to \htmlData, and writes
//      all human text via textContent — never innerHTML of JSON-derived strings.
//   4. The /renderproof CSP (script-src 'self', no unsafe-eval) is the backstop.
// See docs/shareable-proof-animations.md §7.
import { ProofAnimator } from "/proof-animation/proof-animation.js";

const SLUG_RE = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;
const THEMES = new Set(["dark", "light", "auto"]);
// Static, author-controlled markup (no user data) — safe to set as innerHTML.
const FULLSCREEN_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const BRACES_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/>' +
  '<path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/></svg>';
const CODE_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M8 6l-6 6 6 6"/><path d="M16 6l6 6-6 6"/></svg>';

// Raw JSON text of each loaded proof, for the { } viewer. Filled during load.
const loadedProofs = [];
const MAX_PROOFS = 12;
const MAX_STEPS = 300;
const MAX_TERMS = 2000;
const MAX_STR = 50000;          // generous per-field cap (annotated latex is long)
const MAX_BYTES = 2_000_000;    // per-proof response cap

const root = document.getElementById("root");

/** Collect + validate the builtin slugs from the query string. */
function parseBuiltins() {
  const params = new URLSearchParams(location.search);
  const raw = [];
  for (const v of params.getAll("builtin")) {
    for (const part of v.split(",")) {
      const s = part.trim();
      if (s) raw.push(s);
    }
  }
  const valid = [];
  const bad = [];
  for (const s of raw) {
    if (SLUG_RE.test(s) && !s.includes("..")) valid.push(s);
    else bad.push(s);
  }
  return { valid: valid.slice(0, MAX_PROOFS), bad, overflow: valid.length > MAX_PROOFS };
}

/** Coerce a value to a bounded string (defends against huge / non-string fields). */
function str(v) {
  if (v == null) return "";
  return String(v).slice(0, MAX_STR);
}

/** Shallow-sanitize a confidence object: keep known keys, primitives only. */
function cleanConfidence(c) {
  if (!c || typeof c !== "object") return undefined;
  const out = {};
  for (const k of ["tier", "label", "icon", "meaning", "relation", "reason"]) {
    if (c[k] != null) out[k] = str(c[k]);
  }
  if (typeof c.type_consistent === "boolean") out.type_consistent = c.type_consistent;
  if (typeof c.endpoint_reached === "boolean") out.endpoint_reached = c.endpoint_reached;
  if (c.counts && typeof c.counts === "object") {
    out.counts = {};
    for (const [k, n] of Object.entries(c.counts)) {
      if (typeof n === "number" && isFinite(n)) out.counts[str(k)] = n;
    }
  }
  return out;
}

/**
 * Whitelist-validate a proof payload into a clean object the engine can consume.
 * Throws on anything structurally wrong. Unknown keys are simply dropped.
 */
function validateProofData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("proof must be a JSON object");
  }
  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    throw new Error("proof has no steps");
  }
  if (data.steps.length > MAX_STEPS) {
    throw new Error(`too many steps (${data.steps.length} > ${MAX_STEPS})`);
  }
  const steps = data.steps.map((s, i) => {
    if (!s || typeof s !== "object") throw new Error(`step ${i} is not an object`);
    return {
      index: typeof s.index === "number" && isFinite(s.index) ? s.index : i,
      operation: str(s.operation),
      justification: str(s.justification),
      input_latex: str(s.input_latex),
      latex: str(s.latex),
      plain: str(s.plain),
      confidence: cleanConfidence(s.confidence),
    };
  });

  const terms = {};
  if (data.terms && typeof data.terms === "object" && !Array.isArray(data.terms)) {
    let n = 0;
    for (const [id, t] of Object.entries(data.terms)) {
      if (n++ >= MAX_TERMS) break;
      if (!t || typeof t !== "object") continue;
      terms[str(id)] = { latex: str(t.latex), name: str(t.name), description: str(t.description) };
    }
  }

  const out = {
    title: str(data.title),
    domain: str(data.domain),
    steps,
    terms,
    overall_confidence: cleanConfidence(data.overall_confidence),
  };
  // Optional model-produced framing, prerequisites, and agentic follow-up prompts.
  if (data.goal) out.goal = str(data.goal);
  const strList = (v) => Array.isArray(v)
    ? v.filter((s) => typeof s === "string" && s.trim()).slice(0, 8).map(str) : undefined;
  if (strList(data.followups)) out.followups = strList(data.followups);
  if (strList(data.prerequisites)) out.prerequisites = strList(data.prerequisites);
  return out;
}

/** The theme requested in the URL (?theme=), defaulting to dark. */
function parseTheme() {
  const t = new URLSearchParams(location.search).get("theme");
  return THEMES.has(t) ? t : "dark";
}

/** Resolve "auto" to a concrete theme via the OS preference. */
function resolveTheme(t) {
  if (t === "auto") return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return t === "light" ? "light" : "dark";
}

let _currentTheme = "dark";

/** Apply a theme to the live page (the engine + chrome read it off CSS vars). */
function applyTheme(t) {
  _currentTheme = t;
  document.documentElement.dataset.theme = resolveTheme(t);
}

// Keep "auto" honest: track OS theme changes live while the page is open.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (_currentTheme === "auto") applyTheme("auto");
});

/** Build the embeddable URL. The origin comes from wherever this page is served,
 *  so the snippet is environment-specific (localhost in dev, the real host in prod). */
function buildEmbedUrl(builtins, theme) {
  const u = new URL("/renderproof", location.origin);
  for (const b of builtins) u.searchParams.append("builtin", b);
  u.searchParams.set("theme", theme);          // explicit, so the embed is deterministic
  return u.toString();
}

function embedSnippet(url) {
  // The <iframe> alone works (fixed height). The optional companion <script> auto-sizes
  // the iframe to its content — a cross-origin iframe can't resize its own element, so
  // this host-side helper applies the height the embedded page reports.
  const origin = new URL(url).origin;
  return `<iframe src="${url}" width="100%" height="600" style="border:0" loading="lazy" ` +
         `title="AlgeBench proof animation" data-algebench-embed></iframe>\n` +
         `<!-- optional: auto-fits the height to the proof; remove to keep a fixed height -->\n` +
         `<script src="${origin}/embed-resizer.js" async></script>`;
}

/** When embedded, report our content height to the host page so its resizer can
 *  size the iframe to fit (no top/bottom dead space; adapts as steps change height). */
function setupEmbedAutoResize() {
  const wrap = document.querySelector(".wrap");
  let last = 0;
  // Measure the real content height from the .wrap, not documentElement.scrollHeight
  // — the latter is clamped to the iframe's own viewport, so it can't report a height
  // smaller than the current iframe (which would defeat shrinking it).
  const measure = () => wrap
    ? Math.ceil(wrap.getBoundingClientRect().bottom + window.scrollY + 2)
    : Math.ceil(document.documentElement.scrollHeight);
  const post = (force) => {
    const h = measure();
    if (!force && Math.abs(h - last) < 2) return;   // ignore churn (e.g. a hover tooltip)
    last = h;
    try {
      parent.postMessage({ type: "algebench-embed-height", height: h }, "*");
    } catch (e) { /* cross-origin parent that refuses messages — nothing we can do */ }
  };
  // Observe the .wrap, not <body>: an absolutely-positioned hover tooltip overflows
  // without changing wrap's content box, so hovering can't drive a resize/flicker loop.
  if (window.ResizeObserver && wrap) new ResizeObserver(() => post()).observe(wrap);
  window.addEventListener("message", (e) => {
    // Only the host (our parent frame) may request a height re-report — ignore any
    // other frame/injected script so it can't spam measurements.
    if (e.source === window.parent && e.data && e.data.type === "algebench-embed-request") {
      post(true);
    }
  });
  window.addEventListener("load", () => post(true));
  post(true);
}

/** A throwaway mock host page that embeds the iframe, so the user can see how the
 *  embed looks dropped into a real article. The page adopts the chosen theme so it
 *  matches the embed (auto follows the viewer's OS). `url`/`theme` are built from
 *  validated slugs + an allowlisted theme, so they're safe to interpolate. */
function previewPageHtml(url, theme) {
  const iframe = embedSnippet(url);
  const dark = "--bg:#12121c;--ink:#e5e7eb;--muted:#9ca3af;--rule:#2a2f45;--accent:#818cf8;--bar:#1a1a2e;";
  const light = "--bg:#fbfbfd;--ink:#1f2430;--muted:#5b6472;--rule:#e6e8ee;--accent:#4f46e5;--bar:#ffffff;";
  let rootCss;
  if (theme === "dark") rootCss = `:root{color-scheme:dark;${dark}}`;
  else if (theme === "light") rootCss = `:root{color-scheme:light;${light}}`;
  else rootCss = `:root{color-scheme:light dark;${light}}@media(prefers-color-scheme:dark){:root{${dark}}}`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Embed preview — Example Blog</title>
<style>
  ${rootCss}
  body { margin:0; background:var(--bg); color:var(--ink);
         font-family:Georgia,"Times New Roman",serif; line-height:1.7; }
  .bar { border-bottom:1px solid var(--rule); background:var(--bar); }
  .bar .in { max-width:760px; margin:0 auto; padding:14px 22px;
         font-family:system-ui,sans-serif; font-weight:700; }
  main { max-width:760px; margin:0 auto; padding:32px 22px 70px; }
  .kick { font-family:system-ui,sans-serif; text-transform:uppercase; letter-spacing:.12em;
          font-size:.72rem; color:var(--accent); font-weight:700; }
  h1 { font-size:2rem; line-height:1.2; margin:8px 0 6px; }
  .by { font-family:system-ui,sans-serif; color:var(--muted); font-size:.9rem; margin:0 0 26px; }
  p { margin:0 0 18px; }
  figure { margin:26px 0; }
  figure iframe { display:block; width:100%; border:0; border-radius:12px;
          box-shadow:0 0 0 1px var(--rule), 0 12px 30px rgba(0,0,0,.18); }
  figcaption { font-family:system-ui,sans-serif; color:var(--muted); font-size:.85rem;
          margin-top:10px; text-align:center; }
  .note { font-family:system-ui,sans-serif; font-size:.8rem; color:var(--muted);
          border-top:1px solid var(--rule); margin-top:40px; padding-top:14px; }
</style></head>
<body>
  <header class="bar"><div class="in">Example Blog</div></header>
  <main>
    <p class="kick">Mathematics · Worked Example</p>
    <h1>A derivation, embedded in a post</h1>
    <p class="by">By Jane Author · 5 min read</p>
    <p>This is a placeholder article showing how an AlgeBench proof animation looks
    when it is dropped into an ordinary web page. The figure below is the live embed
    you are about to copy — readers can step through the derivation right here, with
    no account and no backend calls after it loads.</p>
    <figure>
      ${iframe}
      <figcaption>Figure 1 — an embedded, interactive proof animation.</figcaption>
    </figure>
    <p>The surrounding prose, fonts, and layout all belong to the host page; only the
    framed figure comes from AlgeBench. Resize the window to see it reflow.</p>
    <p class="note">Preview only — this page is generated in your browser and is not saved.</p>
  </main>
</body></html>`;
}

function showError(container, msg) {
  const div = document.createElement("div");
  div.className = "pa-error";
  div.textContent = msg;           // textContent — never innerHTML
  container.appendChild(div);
}

/** Wait for the deferred KaTeX classic script to define window.katex. */
async function awaitKatex() {
  for (let i = 0; i < 150 && !window.katex; i++) {
    await new Promise((r) => setTimeout(r, 30));
  }
  return window.katex || null;
}

/** The { } button: opens a themed modal showing each loaded proof's raw JSON,
 *  pretty-printed. Shown in both top-level and embedded views. */
function setupJsonButton() {
  const btn = document.getElementById("pa-json");
  const modal = document.getElementById("pa-json-modal");
  const body = document.getElementById("pa-json-body");
  const close = document.getElementById("pa-json-close");
  btn.classList.add("pa-icon-btn");
  btn.title = "View proof JSON";
  btn.setAttribute("aria-label", "View proof JSON");
  btn.innerHTML = BRACES_ICON;
  btn.hidden = false;

  const render = () => {
    body.textContent = "";
    if (!loadedProofs.length) {
      const pre = document.createElement("pre");
      pre.textContent = "(no proof loaded)";
      body.appendChild(pre);
      return;
    }
    const multi = loadedProofs.length > 1;
    for (const p of loadedProofs) {
      if (multi) {
        const h = document.createElement("h3");
        h.textContent = p.slug;
        body.appendChild(h);
      }
      let txt = p.text;
      try { txt = JSON.stringify(JSON.parse(p.text), null, 2); } catch (e) { /* show raw */ }
      const pre = document.createElement("pre");
      pre.textContent = txt;              // textContent — never innerHTML
      body.appendChild(pre);
    }
  };
  const hide = () => modal.classList.remove("open");
  btn.addEventListener("click", () => { render(); modal.classList.add("open"); });
  close.addEventListener("click", hide);
  modal.addEventListener("click", (e) => { if (e.target === modal) hide(); }); // click backdrop
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
}

/** The < > button: opens the embed modal — a theme picker (updates the live page
 *  and the snippet), Preview, Copy, and the copyable iframe snippet. Shown in both
 *  views so a reader of an embed can grab the script to re-share it. */
function setupEmbedButton(builtins, theme) {
  const btn = document.getElementById("pa-embed");
  const modal = document.getElementById("pa-embed-modal");
  const close = document.getElementById("pa-embed-close");
  const code = document.getElementById("pa-embed-code");
  const sel = document.getElementById("pa-theme");
  const previewBtn = document.getElementById("pa-preview");
  const copyBtn = document.getElementById("pa-copy");
  const copied = document.getElementById("pa-copied");

  btn.classList.add("pa-icon-btn");
  btn.title = "Get embed script";
  btn.setAttribute("aria-label", "Get embed script");
  btn.innerHTML = CODE_ICON;
  btn.hidden = false;

  sel.value = theme;
  const refresh = () => { code.value = embedSnippet(buildEmbedUrl(builtins, sel.value)); };
  refresh();

  const hide = () => modal.classList.remove("open");
  btn.addEventListener("click", () => { refresh(); modal.classList.add("open"); code.focus(); code.select(); });
  close.addEventListener("click", hide);
  modal.addEventListener("click", (e) => { if (e.target === modal) hide(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });

  sel.addEventListener("change", () => {
    refresh();
    applyTheme(sel.value);          // preview the chosen theme live
    code.focus(); code.select();
  });

  previewBtn.addEventListener("click", () => {
    // Open a throwaway mock host page that embeds the current iframe, so the user
    // sees the embed in a realistic page context. Generated in-browser, not saved.
    const w = window.open("", "_blank");
    if (!w) return;                 // popup blocked — nothing to clean up
    w.document.open();
    w.document.write(previewPageHtml(buildEmbedUrl(builtins, sel.value), sel.value));
    w.document.close();
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code.value);
    } catch {
      code.focus(); code.select();
      try { document.execCommand("copy"); } catch (e) { /* clipboard unavailable */ }
    }
    copied.hidden = false;
    setTimeout(() => { copied.hidden = true; }, 1500);
  });
}

/** Wire the control bar: { } JSON viewer and < > embed dialog (both views), plus a
 *  full-screen icon only when embedded (top-level is already full screen). */
function setupControlBar(builtins, theme) {
  setupJsonButton();
  setupEmbedButton(builtins, theme);
  if (window.self !== window.top) {
    const btn = document.getElementById("pa-action");
    btn.classList.add("pa-icon-btn");
    btn.title = "Open full screen";
    btn.setAttribute("aria-label", "Open full screen");
    btn.innerHTML = FULLSCREEN_ICON;
    btn.hidden = false;
    btn.addEventListener("click", () => window.open(location.href, "_blank", "noopener"));
  }
}

async function main() {
  const embedded = window.self !== window.top;
  if (embedded) document.documentElement.dataset.embedded = "1";

  const theme = parseTheme();
  applyTheme(theme);
  // Opt-in "Explore further" follow-up chips via ?explore=1 (off by default).
  const exploreFollowups = ["1", "true", "yes"].includes(
    (new URLSearchParams(location.search).get("explore") || "").toLowerCase());

  const { valid, bad, overflow } = parseBuiltins();
  setupControlBar(valid, theme);
  if (bad.length) {
    showError(root, `Ignored invalid proof id(s): ${bad.join(", ")} — expected <domain>/<name>.`);
  }
  if (overflow) {
    showError(root, `Too many proofs requested; showing the first ${MAX_PROOFS}.`);
  }
  if (!valid.length) {
    showError(root, "No proof to show. Add ?builtin=<domain>/<name> to the URL.");
    return;
  }

  const katex = await awaitKatex();
  if (!katex) {
    showError(root, "Math renderer failed to load.");
    return;
  }

  window.__animators = [];
  for (const slug of valid) {
    const title = document.createElement("h2");
    title.className = "pa-card-title";
    title.textContent = slug;                 // placeholder until data arrives
    const card = document.createElement("div");
    root.appendChild(title);
    root.appendChild(card);

    try {
      const resp = await fetch(`/proofs/domains/${slug}.json`, { cache: "no-store" });
      if (!resp.ok) throw new Error(`not found (${resp.status})`);
      const len = Number(resp.headers.get("content-length") || 0);
      if (len && len > MAX_BYTES) throw new Error("proof file too large");
      const text = await resp.text();
      if (text.length > MAX_BYTES) throw new Error("proof file too large");
      loadedProofs.push({ slug, text });   // capture raw JSON for the { } viewer
      const data = validateProofData(JSON.parse(text));
      if (data.title) title.textContent = data.title;
      window.__animators.push(new ProofAnimator(card, data, {
        katex, liveTerms: true, enableExplore: exploreFollowups,
        // No onExplore here: standalone, the engine copies the chip text; when this
        // page is embedded in an iframe, the engine posts the click to the parent.
      }));
    } catch (e) {
      showError(card, `Could not load "${slug}": ${e.message}`);
    }
  }

  if (embedded) setupEmbedAutoResize();
}

main();
