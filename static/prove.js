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
  const editBtn = document.createElement("button");
  editBtn.type = "button"; editBtn.className = "viewer-edit"; editBtn.textContent = "✎ Edit";
  editBtn.disabled = true;                         // enabled once the proof loads
  editBtn.title = "Clone into the Derive workspace to tweak (nothing is saved)";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button"; closeBtn.className = "viewer-close"; closeBtn.textContent = "✕ Close proof";
  closeBtn.addEventListener("click", () => closeProof(id));
  bar.append(idEl, editBtn, closeBtn);

  // Two columns like the Derive workspace: animation (+ app hand-off) on the
  // left, a proof-scoped chat on the right. `loadedProof` is filled after fetch;
  // the chat's getters read it (and the animator) lazily.
  let loadedProof = null;
  const entry = { tab, panel, animator: null };
  const chat = buildProofChat(() => loadedProof, () => entry.animator);
  const box = document.createElement("div");
  box.className = "derive-box";
  const root = document.createElement("div");
  box.append(root);
  const continueBtn = document.createElement("button");
  continueBtn.type = "button"; continueBtn.className = "continue-app"; continueBtn.hidden = true;
  const contLabel = document.createElement("span");
  contLabel.className = "continue-app-label";
  contLabel.textContent = "Continue this chat in the main app →";
  const contDeep = document.createElement("span");
  contDeep.className = "continue-app-deep"; contDeep.hidden = true;
  continueBtn.append(contLabel, contDeep);
  continueBtn.addEventListener("click", () => continueInAppWith(loadedProof, chat.history, id));
  editBtn.addEventListener("click", () => editInDerive(loadedProof));   // clone → Derive
  const left = document.createElement("div");
  left.className = "derive-left";
  left.append(box, continueBtn);
  const cols = document.createElement("div");
  cols.className = "derive-cols";
  cols.append(left, chat.wrap);
  panel.append(bar, cols);
  els.panels.appendChild(panel);

  openTabs.set(id, entry);
  switchTo(id);

  // -- fetch + render --
  try {
    const resp = await fetch(`/api/proofs/item?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!resp.ok) throw new Error(resp.status === 404 ? "not found" : `error ${resp.status}`);
    const data = validateProofData(await resp.json());
    if (!openTabs.has(id)) return;                  // closed while loading
    loadedProof = data;
    editBtn.disabled = false;                        // proof is loaded → editable
    label.textContent = data.title || id.split("/")[1];
    tab.title = data.title || id;
    entry.animator = new ProofAnimator(root, data, {
      katex: window.katex, liveTerms: true, enableTermAsk: true, enableExplore: true,
      // This proof now has its own chat — a term "Ask AI" flows into it (step-
      // aware), not the app. The app hand-off is the explicit button below.
      onTermAsk: ({ message }) => chat.ask(message),
    });
    setContinue(continueBtn, contDeep, data);       // reveal the app hand-off
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
  els.dStatus.className = `derive-status ${cls || ""}`;
  if (text && cls === "pending") {
    // Animated pulsing dots (like the main app) in place of the literal "…".
    const dots = '<span class="dots" aria-hidden="true"><span></span><span></span><span></span></span>';
    els.dStatus.innerHTML = String(text).split("…").map(_escapeHtml).join(dots);
  } else if (text && _hasRender()) {
    els.dStatus.innerHTML = renderSafe(text);
  } else {
    els.dStatus.textContent = text || "";
  }
}

/** Append a chat bubble to a log (defaults to the Derive workspace log); returns
 *  it (so a "pending" one can be removed). User text is escaped + math-rendered;
 *  assistant text is markdown + math. */
function addBubble(role, text, cls, logEl) {
  const log = logEl || els.dLog;
  const b = document.createElement("div");
  b.className = `bubble ${role === "user" ? "user" : "bot"}${cls ? " " + cls : ""}`;
  const html = !_hasRender() ? null
    : role === "user" ? renderSafe(text)
    : (cls && cls.includes("pending")) ? null      // "…" placeholder — plain
    : renderReply(text);
  if (html != null) b.innerHTML = html; else b.textContent = text;   // safe fallback
  log.appendChild(b);
  log.scrollTop = log.scrollHeight;
  return b;
}

/** A self-contained proof-scoped chat column (head + log + input + Send), bound
 *  to a proof and its animator via getters. Used by OPENED proofs (the Derive
 *  workspace keeps its own inline chat). Returns { wrap, ask, history }. */
function buildProofChat(getProof, getAnimator) {
  const history = [];
  const wrap = document.createElement("div");
  wrap.className = "derive-chat";
  const head = document.createElement("div");
  head.className = "chat-head";
  head.innerHTML = '<span class="chat-head-title">Chat</span>';
  const log = document.createElement("div");
  log.className = "chat-log"; log.setAttribute("aria-live", "polite");
  const row = document.createElement("div");
  row.className = "chat-input-row";
  const input = document.createElement("textarea");
  input.className = "chat-input"; input.rows = 2;
  input.placeholder = "Ask about this proof…";
  const send = document.createElement("button");
  send.type = "button"; send.className = "chat-send"; send.textContent = "Send";
  row.append(input, send);
  wrap.append(head, log, row);

  async function doSend() {
    const msg = input.value.trim();
    if (!msg || send.disabled) return;
    addBubble("user", msg, "", log);
    history.push({ role: "user", text: msg });
    input.value = "";
    send.disabled = true;
    const pending = addBubble("bot", "…", "pending", log);
    try {
      const anim = getAnimator();
      const resp = await fetch("/api/proof-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          proof: getProof() || null,
          currentStep: (anim && typeof anim.current === "number") ? anim.current : null,
        }),
      });
      if (!resp.ok) throw new Error(`chat error ${resp.status}`);
      const data = await resp.json();
      pending.remove();
      const reply = (data && data.answer) || "(no response)";
      addBubble("bot", reply, "", log);
      history.push({ role: "bot", text: reply });
    } catch (e) {
      pending.remove();
      addBubble("bot", "Chat is unavailable right now.", "err", log);
    } finally {
      send.disabled = false;
    }
  }
  send.addEventListener("click", doSend);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  /** Drop a message into the input and send it (used by a term's "Ask AI"). */
  function ask(message) {
    const m = String(message || "").trim();
    if (!m) return;
    input.value = m;
    doSend();
  }
  return { wrap, ask, history };
}

/** Reveal an app hand-off button and surface the proof's deep link if it has one. */
function setContinue(btnEl, deepEl, proof) {
  btnEl.hidden = false;
  const deep = proof && proof.deeplink;
  if (deep) {
    let abs = deep;
    try { abs = new URL(deep, location.origin).toString(); } catch (e) { /* keep raw */ }
    deepEl.textContent = `Deep link: ${abs}`;
    deepEl.hidden = false;
  } else {
    deepEl.textContent = "";
    deepEl.hidden = true;
  }
}

/** Open the main app to continue: carry the proof (deep link or ?pa=<id>) and
 *  seed the app chat with the last thing the user asked here. */
function continueInAppWith(proof, history, id) {
  if (!proof) return;
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const seed = (lastUser && lastUser.text)
    || `Let's keep exploring: ${proof.title || "this derivation"}`;
  openInApp(seed, proof.deeplink, id || null);
}

/** Render a proof into the Derive workspace: fresh chat, live animator (term
 *  Ask-AI → local chat), Rederive button, app hand-off. Shared by runDerive
 *  (after deriving) and Edit (cloning an opened proof in to tweak). */
function showInDerive(proof) {
  deriveProof = proof;
  chatHistory = [];                              // fresh thread, scoped to this proof
  if (els.dLog) els.dLog.textContent = "";
  if (deriveAnimator) { try { deriveAnimator.destroy(); } catch (e) { /* noop */ } deriveAnimator = null; }
  els.dRoot.textContent = "";
  els.dEmpty.hidden = true;
  deriveAnimator = new ProofAnimator(els.dRoot, proof, {
    katex: window.katex, liveTerms: true, enableTermAsk: true, enableExplore: true,
    // A term "Ask AI" goes to the LOCAL step-aware chat, not the app.
    onTermAsk: ({ message }) => askInChat(message),
  });
  els.dGo.textContent = "Rederive";              // a derivation now exists
  showContinue(proof);                            // reveal the explicit app hand-off
}

/** "Edit" an opened proof: clone it into the Derive workspace as a fresh, unsaved
 *  working copy (nothing is written). The user can chat to refine, or edit the
 *  prompt and Rederive. The original tab is untouched. */
function editInDerive(proof) {
  if (!proof) return;
  const clone = JSON.parse(JSON.stringify(proof));   // never mutate the opened proof
  switchTo("derive");
  showInDerive(clone);
  // Seed the prompt from the goal so Rederive is immediately actionable (editable).
  els.dPrompt.value = (clone.goal || "").replace(/\$/g, "").trim();
  const shown = (clone.title || "proof").replace(/^Deriving\s+/i, "");
  setStatus(`Editing ${shown} — ${clone.steps.length} steps. Chat to refine, or edit the prompt and Rederive.`, "ok");
}

/** The special Derive/Rederive action (top): prompt (+ domain + docs) →
 *  proof_from_prompt → render in the derivation box. Once a proof exists the
 *  button reads "Rederive". */
async function runDerive() {
  const prompt = els.dPrompt.value.trim();
  if (!prompt || els.dGo.disabled) return;
  els.dGo.disabled = true;
  setStatus("Deriving… (CAS-verifying each step)", "pending");
  // NB: don't hide the hand-off here — on a rederive the current proof stays in
  // the box while this runs (and if it errors), so the button must stay too. It's
  // shown strictly when a proof box exists: revealed on the first success below,
  // and never cleared (there's no path that empties the box).

  const body = { prompt };
  const domain = effectiveDomain();
  const documentation = els.dDoc.value.trim();
  if (domain) body.domain = domain;
  if (documentation) body.documentation = documentation;
  try {
    const data = await invokeExpert("proof_from_prompt", body, { timeoutMs: 150000 });
    if (data && data.error) { setStatus(data.error, "err"); return; }
    const proof = validateProofData(data);
    showInDerive(proof);                           // render + fresh chat + hand-off
    // The title is "Deriving <target> from <start>"; strip the leading verb so
    // the status reads "Derived <target> from <start>", not "Derived Deriving …".
    const shown = (proof.title || "proof").replace(/^Deriving\s+/i, "");
    setStatus(`Derived ${shown} — ${proof.steps.length} steps.`, "ok");
  } catch (e) {
    setStatus((e instanceof ExpertError ? e.message : (e && e.message)) || "Derivation failed.", "err");
  } finally {
    els.dGo.disabled = false;
  }
}

/** The payload the proof chat sends: the thread + the proof + the step in view. */
function chatBody() {
  return {
    messages: chatHistory,
    proof: deriveProof || null,
    currentStep: (deriveAnimator && typeof deriveAnimator.current === "number")
      ? deriveAnimator.current : null,
  };
}

/** A term's "Ask AI" now flows into the LOCAL step-aware chat (we have one here),
 *  not the app. Drops the question in the input and sends it. */
function askInChat(message) {
  const m = String(message || "").trim();
  if (!m) return;
  els.dChatInput.value = m;
  sendChat();
}

/** Reveal the explicit "Continue in the main app" hand-off, and surface the
 *  proof's deep link when it has one (built-ins / saved proofs do; a fresh,
 *  unsaved derivation does not — then only the chat context carries over). */
function showContinue(proof) {
  setContinue(els.dContinue, els.dContinueDeep, proof);
}

/** Derive-workspace app hand-off — carries the derived proof + this thread. */
function continueInApp() {
  continueInAppWith(deriveProof, chatHistory, null);
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

/** Chat (right panel) — a PROOF-SCOPED conversation about the current derivation,
 *  via POST /api/proof-chat: the Gemini chat agent run with a proof-only system
 *  prompt (NOT the app's lesson/scene-framed /api/chat). The whole thread + the
 *  proof + the step in view ride along, so it's conversational and step-aware. */
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
  els.dContinue = document.getElementById("d-continue");
  els.dContinueDeep = document.getElementById("d-continue-deep");
  els.dContinue.addEventListener("click", continueInApp);
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
