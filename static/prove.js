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
import { invokeExpert, ExpertError } from "/expert-client.js";

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
// Multi-tab: Browse (always present) + one tab per open proof. Each entry holds
// its tab button, panel, and animator. `activeId` = null means the Browse tab.
const openTabs = new Map();   // id -> { tab, panel, animator }
let activeId = null;

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
    if (p.id === activeId) btn.setAttribute("aria-current", "true");
    if (openTabs.has(p.id)) btn.classList.add("is-open");

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
    btn.addEventListener("click", () => openProof(p.id));
    els.browse.appendChild(btn);
  }
}

/** Focus a tab: null = Browse, "derive" = Derive workspace, else an open proof id. */
function switchTo(target) {
  activeId = target;
  els.tabBrowse.setAttribute("aria-selected", String(target === null));
  els.tabDerive.setAttribute("aria-selected", String(target === "derive"));
  els.panelBrowse.hidden = target !== null;
  els.panelDerive.hidden = target !== "derive";
  for (const [tid, t] of openTabs) {
    const on = tid === target;
    t.tab.setAttribute("aria-selected", String(on));
    t.panel.hidden = !on;
  }
  const u = new URL(location.href);
  if (target && target !== "derive") u.searchParams.set("id", target);
  else u.searchParams.delete("id");
  history.replaceState(null, "", u);
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (target === null) renderBrowse(filterCatalog(els.search.value));   // refresh highlights
}

/** Close a proof tab: destroy its animator, remove tab+panel, focus a neighbour. */
function closeProof(id) {
  const t = openTabs.get(id);
  if (!t) return;
  try { t.animator && t.animator.destroy(); } catch (e) { /* best effort */ }
  const wasActive = activeId === id;
  const order = [...openTabs.keys()];
  const idx = order.indexOf(id);
  t.tab.remove();
  t.panel.remove();
  openTabs.delete(id);
  if (wasActive) {
    const rest = [...openTabs.keys()];
    switchTo(rest.length ? (rest[idx] || rest[rest.length - 1]) : null);
  } else {
    renderBrowse(filterCatalog(els.search.value));
  }
}

/** Open a proof in its own tab (or focus the existing tab if already open). */
async function openProof(id) {
  if (!ID_RE.test(id)) return;
  if (openTabs.has(id)) { switchTo(id); return; }   // already open → focus it

  // -- tab button (title + ✕) --
  const tab = document.createElement("div");
  tab.className = "tab proof-tab";
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-selected", "false");
  tab.tabIndex = 0;
  const label = document.createElement("span");
  label.className = "tab-label";
  label.textContent = id.split("/")[1];             // placeholder until title arrives
  const x = document.createElement("button");
  x.type = "button"; x.className = "tab-x"; x.textContent = "✕";
  x.setAttribute("aria-label", `Close ${id}`);
  x.addEventListener("click", (e) => { e.stopPropagation(); closeProof(id); });
  tab.append(label, x);
  tab.addEventListener("click", () => switchTo(id));
  tab.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchTo(id); }
  });
  els.tabbar.appendChild(tab);

  // -- panel (bar + render root) --
  const panel = document.createElement("section");
  panel.className = "panel proof-panel";
  panel.setAttribute("role", "tabpanel");
  const bar = document.createElement("div");
  bar.className = "viewer-bar";
  const idEl = document.createElement("span");
  idEl.className = "viewer-id"; idEl.textContent = id;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button"; closeBtn.className = "viewer-close"; closeBtn.textContent = "✕ Close proof";
  closeBtn.addEventListener("click", () => closeProof(id));
  bar.append(idEl, closeBtn);
  const root = document.createElement("div");
  panel.append(bar, root);
  els.panels.appendChild(panel);

  const entry = { tab, panel, animator: null };
  openTabs.set(id, entry);
  switchTo(id);

  // -- fetch + render --
  try {
    const resp = await fetch(`/api/proofs/item?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!resp.ok) throw new Error(resp.status === 404 ? "not found" : `error ${resp.status}`);
    const data = validateProofData(await resp.json());
    if (!openTabs.has(id)) return;                  // closed while loading
    label.textContent = data.title || id.split("/")[1];
    tab.title = data.title || id;
    entry.animator = new ProofAnimator(root, data, {
      katex: window.katex, liveTerms: true, enableTermAsk: true, enableExplore: true,
      // Ask-AI on a proof term → open the FULL app in a new tab, in chat, with
      // the question. Use the proof's deeplink (built-ins) else ?pa=<id>.
      onTermAsk: ({ message }) => openInApp(message, data.deeplink, id),
    });
  } catch (e) {
    showError(root, `Could not load "${id}": ${e.message}`);
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

// ── Derive workspace ────────────────────────────────────────────────────────
let deriveAnimator = null;
let deriveProof = null;        // the current derived proof (chat context)
let chatHistory = [];

/** Domain: the custom free-text field wins over the dropdown; "" = Auto/infer. */
function effectiveDomain() {
  return els.dDomainCustom.value.trim() || els.dDomain.value || "";
}

function updateDocCount() { els.dDocCount.textContent = `${els.dDoc.value.length} / 5000`; }

/** The attached-docs affordance: a "📎 Attach" button when empty+closed, a
 *  "📎 attached (N)" chip when there's text+closed, nothing while the editor's open. */
function refreshDocHint() {
  const text = els.dDoc.value.trim();
  const editorOpen = !els.dDocEditor.hidden;
  els.dDocBtn.hidden = editorOpen || !!text;
  els.dDocHint.hidden = editorOpen || !text;
  if (!els.dDocHint.hidden) els.dDocHint.textContent = `📎 Documentation attached (${text.length} chars) · edit`;
}

function openDocEditor() { els.dDocEditor.hidden = false; refreshDocHint(); updateDocCount(); els.dDoc.focus(); }
function closeDocEditor() { els.dDocEditor.hidden = true; refreshDocHint(); }

// ── rendering (markdown + KaTeX), self-contained (no app-module deps) ─────────
const _hasRender = () => typeof window.katex !== "undefined";
const _escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function _katex(tex, display) {
  try { return window.katex.renderToString(tex, { throwOnError: false, strict: false, displayMode: display }); }
  catch (e) { return _escapeHtml(tex); }
}
/** Pull $…$/$$…$$ out to placeholders (so they survive escaping/markdown),
 *  run `body` on the rest, then render the math back with KaTeX. */
function _withMath(text, body) {
  const blocks = [];
  const stash = (tex, display) => { blocks.push([String(tex).trim(), display]); return '%%M' + (blocks.length - 1) + '%%'; };
  let s = String(text)
    .replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => stash(tex, true))
    .replace(/\$([^$\n]+)\$/g, (m, tex) => stash(tex, false));
  s = body(s);
  return s.replace(/%%M(\d+)%%/g, (m, i) => _katex(blocks[+i][0], blocks[+i][1]));
}
/** Untrusted text (user input / status): escape HTML, keep newlines, render math. */
function renderSafe(text) {
  return _withMath(text, (s) => _escapeHtml(s).replace(/\n/g, '<br>'));
}
/** Assistant markdown (our own agent's reply): markdown + math. */
function renderReply(text) {
  if (typeof window.marked === 'undefined') return null;   // fall back to plain text
  return _withMath(text, (s) => window.marked.parse(s));
}

function setStatus(text, cls) {
  els.dStatus.hidden = !text;
  if (text && _hasRender()) els.dStatus.innerHTML = renderSafe(text);
  else els.dStatus.textContent = text || "";
  els.dStatus.className = `derive-status ${cls || ""}`;
}

/** Append a chat bubble; returns it (so a "pending" one can be removed).
 *  User text is escaped + math-rendered; assistant text is markdown + math. */
function addBubble(role, text, cls) {
  const b = document.createElement("div");
  b.className = `bubble ${role === "user" ? "user" : "bot"}${cls ? " " + cls : ""}`;
  const html = !_hasRender() ? null
    : role === "user" ? renderSafe(text)
    : (cls && cls.includes("pending")) ? null      // "…" placeholder — plain
    : renderReply(text);
  if (html != null) b.innerHTML = html; else b.textContent = text;   // safe fallback
  els.dLog.appendChild(b);
  els.dLog.scrollTop = els.dLog.scrollHeight;
  return b;
}

/** The special Derive/Rederive action (top): prompt (+ domain + docs) →
 *  proof_from_prompt → render in the derivation box. Once a proof exists the
 *  button reads "Rederive". */
async function runDerive() {
  const prompt = els.dPrompt.value.trim();
  if (!prompt || els.dGo.disabled) return;
  els.dGo.disabled = true;
  setStatus("Deriving… (CAS-verifying each step)", "pending");

  const body = { prompt };
  const domain = effectiveDomain();
  const documentation = els.dDoc.value.trim();
  if (domain) body.domain = domain;
  if (documentation) body.documentation = documentation;
  try {
    const data = await invokeExpert("proof_from_prompt", body, { timeoutMs: 150000 });
    if (data && data.error) { setStatus(data.error, "err"); return; }
    const proof = validateProofData(data);
    deriveProof = proof;
    // A fresh derivation replaces the proof — reset the chat so the thread stays
    // scoped to the derivation on screen.
    chatHistory = [];
    if (els.dLog) els.dLog.textContent = "";
    if (deriveAnimator) { try { deriveAnimator.destroy(); } catch (e) { /* noop */ } deriveAnimator = null; }
    els.dRoot.textContent = "";
    els.dEmpty.hidden = true;
    deriveAnimator = new ProofAnimator(els.dRoot, proof, {
      katex: window.katex, liveTerms: true, enableTermAsk: true, enableExplore: true,
      onTermAsk: ({ message }) => openInApp(message, proof.deeplink, null),
    });
    els.dGo.textContent = "Rederive";            // a derivation now exists
    setStatus(`Derived “${proof.title || "proof"}” — ${proof.steps.length} steps.`, "ok");
  } catch (e) {
    setStatus((e instanceof ExpertError ? e.message : (e && e.message)) || "Derivation failed.", "err");
  } finally {
    els.dGo.disabled = false;
  }
}

/** Chat (right panel) — a Send-only, PROOF-SCOPED conversation about the current
 *  derivation, via POST /api/proof-chat: the Gemini chat agent run with a
 *  proof-only system prompt (NOT the app's lesson/scene-framed /api/chat). The
 *  whole thread + the proof + the step in view ride along, so it's conversational
 *  and step-aware. */
/** The payload the proof chat sends: the thread + the proof + the step in view. */
function chatBody() {
  return {
    messages: chatHistory,
    proof: deriveProof || null,
    currentStep: (deriveAnimator && typeof deriveAnimator.current === "number")
      ? deriveAnimator.current : null,
  };
}

/** Debug-only (CTX button): fetch and show the EXACT context — system prompt +
 *  thread — the proof chat would send right now. Mirrors the main app's CTX. */
async function showCtx() {
  els.ctxBody.innerHTML = '<div class="ctx-meta">Loading…</div>';
  els.ctxPanel.hidden = false;
  try {
    const resp = await fetch("/api/proof-chat/debug", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatBody()),
    });
    if (!resp.ok) throw new Error(`ctx error ${resp.status}`);
    const d = await resp.json();
    const meta = `model: ${d.model} · system prompt: ${d.charCount} chars · currentStep: ${d.currentStep ?? "—"}`;
    const contents = (d.contents || []).map((m) => `${m.role}: ${m.text}`).join("\n\n") || "(no turns yet)";
    els.ctxBody.innerHTML =
      `<div class="ctx-meta">${_escapeHtml(meta)}</div>` +
      `<h4>System prompt</h4><pre>${_escapeHtml(d.systemPrompt || "")}</pre>` +
      `<h4>Contents (thread)</h4><pre>${_escapeHtml(contents)}</pre>`;
  } catch (e) {
    els.ctxBody.innerHTML =
      `<div class="ctx-meta">Couldn't load context (${_escapeHtml(String((e && e.message) || e))}).</div>`;
  }
}

async function sendChat() {
  const msg = els.dChatInput.value.trim();
  if (!msg || els.dSend.disabled) return;
  addBubble("user", msg);
  chatHistory.push({ role: "user", text: msg });
  els.dChatInput.value = "";
  els.dSend.disabled = true;
  const pending = addBubble("bot", "…", "pending");
  try {
    // Send the whole thread + the proof + which step is in view, so the chat is
    // conversational and step-aware (resolves "why this step").
    const resp = await fetch("/api/proof-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatBody()),
    });
    if (!resp.ok) throw new Error(`chat error ${resp.status}`);
    const data = await resp.json();
    pending.remove();
    const reply = (data && data.answer) || "(no response)";
    addBubble("bot", reply);
    chatHistory.push({ role: "bot", text: reply });
  } catch (e) {
    pending.remove();
    addBubble("bot", "Chat is unavailable right now.", "err");
  } finally {
    els.dSend.disabled = false;
  }
}

async function main() {
  applyTheme();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  els.search = document.getElementById("search");
  els.browse = document.getElementById("browse");
  els.count = document.getElementById("count");
  els.empty = document.getElementById("empty");
  els.tabbar = document.getElementById("tabbar");
  els.panels = document.getElementById("panels");
  els.tabBrowse = document.getElementById("tab-browse");
  els.panelBrowse = document.getElementById("panel-browse");
  els.tabBrowse.addEventListener("click", () => switchTo(null));

  // Derive workspace
  els.tabDerive = document.getElementById("tab-derive");
  els.panelDerive = document.getElementById("panel-derive");
  els.dDomain = document.getElementById("d-domain");
  els.dDomainCustom = document.getElementById("d-domain-custom");
  els.dDocBtn = document.getElementById("d-doc-btn");
  els.dDocHint = document.getElementById("d-doc-hint");
  els.dDocEditor = document.getElementById("d-doc-editor");
  els.dDoc = document.getElementById("d-doc");
  els.dDocCount = document.getElementById("d-doc-count");
  els.dRoot = document.getElementById("d-root");
  els.dEmpty = document.getElementById("d-empty");
  els.dStatus = document.getElementById("d-status");
  els.dLog = document.getElementById("d-log");
  els.dPrompt = document.getElementById("d-prompt");
  els.dGo = document.getElementById("d-go");
  els.dChatInput = document.getElementById("d-chat-input");
  els.dSend = document.getElementById("d-send");
  els.tabDerive.addEventListener("click", () => switchTo("derive"));
  els.dDocBtn.addEventListener("click", openDocEditor);
  els.dDocHint.addEventListener("click", openDocEditor);
  document.getElementById("d-doc-done").addEventListener("click", closeDocEditor);
  document.getElementById("d-doc-clear").addEventListener("click",
    () => { els.dDoc.value = ""; updateDocCount(); refreshDocHint(); });
  els.dDoc.addEventListener("input", updateDocCount);
  // Top: the special Derive/Rederive action.
  els.dGo.addEventListener("click", runDerive);
  els.dPrompt.addEventListener("keydown",
    (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runDerive(); } });
  // Right: the chat (Send only, like the main app chat).
  els.dSend.addEventListener("click", sendChat);
  els.dChatInput.addEventListener("keydown",
    (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } });

  // Debug-only CTX inspector — shows the exact context sent to the proof chat.
  els.ctxBtn = document.getElementById("ctx-btn");
  els.ctxPanel = document.getElementById("ctx-panel");
  els.ctxBody = document.getElementById("ctx-panel-body");
  if (document.body.dataset.debug === "true" && els.ctxBtn) {
    els.ctxBtn.hidden = false;
    els.ctxBtn.addEventListener("click", showCtx);
    document.getElementById("ctx-close")
      .addEventListener("click", () => { els.ctxPanel.hidden = true; });
  }

  const katex = await awaitKatex();
  if (!katex) { showError(els.panelBrowse, "Math renderer failed to load."); return; }

  try {
    const resp = await fetch("/api/proofs", { cache: "no-store" });
    if (!resp.ok) throw new Error(`catalog error ${resp.status}`);
    catalog = (await resp.json()).proofs || [];
    catalog.sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
  } catch (e) {
    showError(els.panelBrowse, `Could not load the proof catalog: ${e.message}`);
    return;
  }

  renderBrowse(catalog);
  els.search.addEventListener("input", () => renderBrowse(filterCatalog(els.search.value)));

  // Deep-link: ?id=<domain>/<name> opens that proof on load.
  const deep = params().get("id");
  if (deep && ID_RE.test(deep)) openProof(deep);
}

main();
