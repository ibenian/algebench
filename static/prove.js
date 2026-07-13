// /prove — public proof browser.
//
// Loads the proof catalog (GET /api/proofs), lets the user search/browse, and
// renders a selected proof with the (dependency-free) ProofAnimator engine —
// the same widget /renderproof uses. Proofs are fetched from the same-origin
// store API and treated as untrusted: validateProofData() whitelists fields and
// caps sizes before the engine sees them, and the engine renders math through
// KaTeX with trust limited to \htmlData and all text via textContent.
//
// (Derivation chat / save-and-share come in a later pass; this pass is browse +
// render against the storage layer.)
import { ProofAnimator } from "/proof-animation/proof-animation.js";
import { validateProofData } from "/proof-animation/validate-proof.js";

const THEMES = new Set(["dark", "light", "auto"]);
const ID_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\/[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const params = () => new URLSearchParams(location.search);

/** Dark by default; ?theme=light|dark|auto. */
function applyTheme() {
  let t = params().get("theme");
  if (!THEMES.has(t)) t = "dark";
  const resolved = t === "auto"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : t;
  document.documentElement.dataset.theme = resolved;
}

/** Wait for the deferred KaTeX classic script to define window.katex. */
async function awaitKatex() {
  for (let i = 0; i < 150 && !window.katex; i++) {
    await new Promise((r) => setTimeout(r, 30));
  }
  return window.katex || null;
}

const els = {};
let catalog = [];        // [{id, title, domain, goal}]
let animator = null;
let currentId = null;

function showError(container, msg) {
  const div = document.createElement("div");
  div.className = "pa-error";
  div.textContent = msg;                 // textContent — never innerHTML
  container.appendChild(div);
}

/** Case-insensitive substring match over title/domain/goal/id. */
function filterCatalog(q) {
  q = q.trim().toLowerCase();
  if (!q) return catalog;
  const terms = q.split(/\s+/);
  return catalog.filter((p) => {
    const hay = `${p.id} ${p.title} ${p.domain} ${p.goal}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** Render the (filtered) browse list. Author-controlled markup only via DOM
 *  nodes; all catalog strings go through textContent. */
function renderBrowse(list) {
  els.browse.textContent = "";
  els.empty.hidden = list.length > 0;
  els.count.textContent = list.length
    ? `${list.length} proof${list.length === 1 ? "" : "s"}`
    : "";
  for (const p of list) {
    const btn = document.createElement("button");
    btn.className = "pitem";
    btn.type = "button";
    btn.setAttribute("role", "listitem");
    if (p.id === currentId) btn.setAttribute("aria-current", "true");

    const title = document.createElement("span");
    title.className = "pitem-title";
    title.textContent = p.title || p.id;

    const meta = document.createElement("span");
    meta.className = "pitem-meta";
    const dom = document.createElement("span");
    dom.className = "pitem-dom";
    dom.textContent = p.domain || (p.id.split("/")[0] || "");
    meta.appendChild(dom);
    meta.appendChild(document.createTextNode(" " + p.id.split("/")[1]));

    btn.appendChild(title);
    btn.appendChild(meta);
    btn.addEventListener("click", () => openProof(p.id, true));
    els.browse.appendChild(btn);
  }
}

/** Close the viewer and drop the ?id from the URL. */
function closeProof() {
  currentId = null;
  els.viewer.hidden = true;
  els.root.textContent = "";
  const u = new URL(location.href);
  u.searchParams.delete("id");
  history.replaceState(null, "", u);
  renderBrowse(filterCatalog(els.search.value));
}

/** Fetch a proof by id and render it into the viewer (above the list). */
async function openProof(id, pushUrl) {
  if (!ID_RE.test(id)) return;
  currentId = id;
  if (pushUrl) {
    const u = new URL(location.href);
    u.searchParams.set("id", id);
    history.replaceState(null, "", u);
  }
  renderBrowse(filterCatalog(els.search.value));   // refresh aria-current

  els.viewer.hidden = false;
  els.viewerId.textContent = id;
  els.root.textContent = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
  const katex = window.katex;
  try {
    const resp = await fetch(`/api/proofs/item?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!resp.ok) throw new Error(resp.status === 404 ? "not found" : `error ${resp.status}`);
    const data = validateProofData(await resp.json());
    animator = new ProofAnimator(els.root, data, {
      katex, liveTerms: true, enableTermAsk: true, enableExplore: true,
      // Ask-AI on a proof term → open the FULL app in a new tab (keep the
      // browser open here), landing in chat with the question. Use the proof's
      // own deeplink when it has one (built-ins deep-link to their lesson +
      // pre-baked animation); otherwise open the app on this proof (?pa=<id>).
      onTermAsk: ({ message }) => openInApp(message, data.deeplink, id),
    });
  } catch (e) {
    showError(els.root, `Could not load "${id}": ${e.message}`);
  }
}

/** Open the main AlgeBench app in a new tab, in chat, with the question. */
function openInApp(message, deeplink, id) {
  let u;
  try {
    u = new URL(deeplink || "/", location.origin);
    if (u.origin !== location.origin) u = new URL("/", location.origin);
  } catch (e) { u = new URL("/", location.origin); }
  u.searchParams.set("panel", "chat");
  u.searchParams.set("aa", String(message || "").slice(0, 1500));   // app opens chat + sends once
  if (!deeplink && id) u.searchParams.set("pa", id);                // load this proof's animation
  window.open(u.toString(), "_blank", "noopener");
}

async function main() {
  applyTheme();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  els.search = document.getElementById("search");
  els.browse = document.getElementById("browse");
  els.count = document.getElementById("count");
  els.empty = document.getElementById("empty");
  els.root = document.getElementById("root");
  els.viewer = document.getElementById("viewer");
  els.viewerId = document.getElementById("viewer-id");
  document.getElementById("viewer-close").addEventListener("click", closeProof);

  const katex = await awaitKatex();
  if (!katex) { showError(els.root, "Math renderer failed to load."); return; }

  try {
    const resp = await fetch("/api/proofs", { cache: "no-store" });
    if (!resp.ok) throw new Error(`catalog error ${resp.status}`);
    catalog = (await resp.json()).proofs || [];
    catalog.sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
  } catch (e) {
    showError(els.root, `Could not load the proof catalog: ${e.message}`);
    return;
  }

  renderBrowse(catalog);
  els.search.addEventListener("input", () => renderBrowse(filterCatalog(els.search.value)));

  // Deep-link: ?id=<domain>/<name> opens that proof on load.
  const deep = params().get("id");
  if (deep && ID_RE.test(deep)) openProof(deep, false);
}

main();
