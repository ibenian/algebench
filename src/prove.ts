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
import { DERIVE_TIMEOUT_MS, invokeExpert, ExpertError } from "/expert-client.js";
import { applyTheme, initialTheme, wireThemeToggle } from "/theme.js";
import { BRACES_ICON, CODE_ICON, AI_ICON, USER_ICON } from "/icons.js";
import { createProofEditTool } from "/proof-edit-tool.js";
import {
  ID_DOMAIN_MAX, ID_DOMAIN_MIN, ID_NAME_MAX, ID_NAME_MIN, ID_RESERVED,
  MAX_PROOF_BYTES, formatBytes, idProblem, proofBytes,
} from "/proof-id.js";

const ID_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\/[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** One catalog row from GET /api/proofs. */
export interface CatalogEntry {
  id: string;
  title?: string;
  domain?: string;
  goal?: string;
  status?: string;
}

/** One step of a proof animation, as this page reads one. */
export interface ProofStepData {
  index?: number;
  input_latex?: string;
  latex?: string;
  operation?: string;
  justification?: string;
  plain?: string;
}

/** A proof animation — the shape validateProofData() returns and ProofAnimator
 *  consumes. Only the members this page touches are named. */
export interface ProofData {
  title?: string;
  domain?: string;
  goal?: string;
  deeplink?: string;
  steps: ProofStepData[];
  terms?: Record<string, unknown>;
}

/** The `proof_from_prompt` expert request body. */
export interface DeriveRequest {
  prompt: string;
  domain?: string;
  documentation?: string;
  start_latex?: string;
}

/** One turn of a proof chat thread (the wire shape POSTed to /api/proof-chat). */
export interface ChatTurn {
  role: string;
  text: string;
}

/** An open proof tab: its tab button, its panel, and its animator. */
interface ProofTab {
  tab: HTMLDivElement;
  panel: HTMLElement;
  animator: ProofAnimator | null;
}

/**
 * Every element this page looks up by id. Populated by main() (and
 * setupSubmitModal); reads before that resolve to `undefined` and throw at the
 * point of use, exactly as they did untyped.
 */
interface Els {
  search: HTMLInputElement;
  browse: HTMLElement;
  count: HTMLElement;
  empty: HTMLElement;
  tabbar: HTMLElement;
  panels: HTMLElement;
  tabBrowse: HTMLElement;
  panelBrowse: HTMLElement;
  tabDerive: HTMLElement;
  panelDerive: HTMLElement;
  showReview: HTMLInputElement;
  dDomain: HTMLSelectElement;
  dDomainCustom: HTMLInputElement;
  dDocBtn: HTMLElement;
  dDocHint: HTMLElement;
  dDocEditor: HTMLElement;
  dDoc: HTMLTextAreaElement;
  dDocCount: HTMLElement;
  dRoot: HTMLElement;
  dEmpty: HTMLElement;
  dViewerBar: HTMLElement;
  dViewerId: HTMLElement;
  dJson: HTMLButtonElement;
  dBasedOn: HTMLElement;
  dEditing: HTMLElement;
  dSubmit: HTMLButtonElement;
  dLock: HTMLButtonElement;
  dStatus: HTMLElement;
  dLog: HTMLElement;
  dBar: HTMLElement;
  dPrompt: HTMLTextAreaElement;
  dGo: HTMLButtonElement;
  dChatInput: HTMLTextAreaElement;
  dSend: HTMLButtonElement;
  dContinue: HTMLButtonElement;
  dContinueDeep: HTMLElement;
  ctxBtn: HTMLButtonElement;
  ctxPanel: HTMLElement;
  ctxBody: HTMLElement;
  subModal: HTMLElement;
  subForm: HTMLElement;
  subDone: HTMLElement;
  subBased: HTMLElement;
  subName: HTMLInputElement;
  subHint: HTMLElement;
  subAvail: HTMLElement;
  subGo: HTMLButtonElement;
  subDoneLink: HTMLAnchorElement;
  subDoneMsg: HTMLElement;
  subKey: HTMLElement;
}

const params = () => new URLSearchParams(location.search);

/** Paint the on-load theme (?theme= > saved preference > dark). Theme helpers
 *  (resolve/persist/toggle) live in /theme.js, shared with /renderproof. */
function paintTheme() { applyTheme(initialTheme()); }

/** Wait for the deferred KaTeX classic script to define window.katex. */
async function awaitKatex() {
  for (let i = 0; i < 150 && !window.katex; i++) {
    await new Promise((r) => setTimeout(r, 30));
  }
  return window.katex || null;
}

// Filled in by main(); every field is assigned before anything reads it, so the
// assertion here keeps the original "assume the element exists" crash semantics
// rather than turning every access into an optional chain.
const els = {} as Els;
let catalog: CatalogEntry[] = [];        // [{id, title, domain, goal}]
// Multi-tab: Browse (always present) + one tab per open proof. Each entry holds
// its tab button, panel, and animator. `activeId` = null means the Browse tab.
const openTabs = new Map<string, ProofTab>();   // id -> { tab, panel, animator }
let activeId: string | null = null;

function showError(container: HTMLElement, msg: string) {
  const div = document.createElement("div");
  div.className = "pa-error";
  div.textContent = msg;                 // textContent — never innerHTML
  container.appendChild(div);
}

/** Case-insensitive substring match over title/domain/goal/id. */
function filterCatalog(q: string) {
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
function renderBrowse(list: CatalogEntry[]) {
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
    if (p.status === "under-review") {          // tagged by ?includeSubmissions=1
      const rb = document.createElement("span");
      rb.className = "review-badge";
      rb.textContent = "under review";
      meta.appendChild(document.createTextNode(" "));
      meta.appendChild(rb);
    }

    btn.appendChild(title);
    btn.appendChild(meta);
    btn.addEventListener("click", () => openProof(p.id));
    els.browse.appendChild(btn);
  }
}

/** Focus a tab: null = Browse, "derive" = Derive workspace, else an open proof id. */
function switchTo(target: string | null) {
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
function closeProof(id: string) {
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
    switchTo(rest.length ? (rest[idx] || rest[rest.length - 1]!) : null);
  } else {
    renderBrowse(filterCatalog(els.search.value));
  }
}

/** Open a proof in its own tab (or focus the existing tab if already open). */
async function openProof(id: string) {
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
  label.textContent = id.split("/")[1]!;            // placeholder until title arrives
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
  const barLeft = document.createElement("span");
  barLeft.className = "viewer-left";
  const idEl = document.createElement("span");
  idEl.className = "viewer-id"; idEl.textContent = id;
  // Revealed when the item response says this is a pending submission.
  const reviewBadge = document.createElement("span");
  reviewBadge.className = "review-badge";
  reviewBadge.textContent = "under review";
  reviewBadge.title = "Pending review — not listed publicly yet, reachable by this direct link";
  reviewBadge.hidden = true;
  barLeft.append(idEl, reviewBadge);
  const editBtn = document.createElement("button");
  editBtn.type = "button"; editBtn.className = "viewer-btn"; editBtn.textContent = "⧉ Clone";
  editBtn.disabled = true;                         // enabled once the proof loads
  editBtn.title = "Clone into the Derive workspace to tweak (nothing is saved)";
  // ✎ Edit — only for pending submissions: the author's edit key unlocks
  // updating the submission in place (published proofs can only be cloned).
  const keyEditBtn = document.createElement("button");
  keyEditBtn.type = "button"; keyEditBtn.className = "viewer-btn"; keyEditBtn.textContent = "✎ Edit";
  keyEditBtn.title = "Edit this pending submission with your edit key";
  keyEditBtn.hidden = true;                        // revealed if under review
  const closeBtn = document.createElement("button");
  closeBtn.type = "button"; closeBtn.className = "viewer-btn"; closeBtn.textContent = "✕ Close proof";
  closeBtn.addEventListener("click", () => closeProof(id));
  // { } — view this proof's raw JSON (enabled once the proof has loaded).
  const jsonBtn = document.createElement("button");
  jsonBtn.type = "button"; jsonBtn.className = "viewer-btn icon-btn";
  jsonBtn.innerHTML = BRACES_ICON;
  jsonBtn.title = "View proof JSON"; jsonBtn.setAttribute("aria-label", "View proof JSON");
  jsonBtn.disabled = true;
  jsonBtn.addEventListener("click", () => openJsonModal(loadedProof, id));
  // < > — copy an embed snippet (points at the shareable /renderproof renderer).
  const embedBtn = document.createElement("button");
  embedBtn.type = "button"; embedBtn.className = "viewer-btn icon-btn";
  embedBtn.innerHTML = CODE_ICON;
  embedBtn.title = "Get embed script"; embedBtn.setAttribute("aria-label", "Get embed script");
  embedBtn.addEventListener("click", () => openEmbedModal(id));
  // A right-aligned action group — room for more proof-manipulation ops later.
  const actions = document.createElement("div");
  actions.className = "viewer-actions";
  actions.append(jsonBtn, embedBtn, keyEditBtn, editBtn, closeBtn);
  bar.append(barLeft, actions);

  // Two columns like the Derive workspace: animation (+ app hand-off) on the
  // left, a proof-scoped chat on the right. `loadedProof` is filled after fetch;
  // the chat's getters read it (and the animator) lazily.
  let loadedProof: ProofData | null = null;
  const entry: ProofTab = { tab, panel, animator: null };
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
  continueBtn.addEventListener("click", () => continueInAppWith(loadedProof, chat.history, id, animStep(entry.animator)));
  editBtn.addEventListener("click", () => editInDerive(loadedProof, id));   // clone → Derive
  keyEditBtn.addEventListener("click", () => editSubmissionWithKey(loadedProof, id));
  const left = document.createElement("div");
  left.className = "derive-left";
  left.append(box, continueBtn);
  const cols = document.createElement("div");
  cols.className = "derive-cols";
  const resizer = document.createElement("div");
  resizer.className = "col-resizer";
  resizer.setAttribute("role", "separator");
  resizer.setAttribute("aria-orientation", "vertical");
  resizer.title = "Drag to resize the chat";
  cols.append(left, resizer, chat.wrap);
  applyStoredChatW(cols);
  wireColResizer(resizer, cols);
  panel.append(bar, cols);
  els.panels.appendChild(panel);

  openTabs.set(id, entry);
  switchTo(id);

  // -- fetch + render --
  try {
    const resp = await fetch(`/api/proofs/item?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!resp.ok) throw new Error(resp.status === 404 ? "not found" : `error ${resp.status}`);
    const underReview = resp.headers.get("X-Proof-Status") === "under-review";
    const data: ProofData = validateProofData(await resp.json());
    if (!openTabs.has(id)) return;                  // closed while loading
    loadedProof = data;
    reviewBadge.hidden = !underReview;
    keyEditBtn.hidden = !underReview;              // edit-by-key only while in review
    editBtn.disabled = false;                        // proof is loaded → editable
    jsonBtn.disabled = false;                         // JSON is available → viewable
    label.textContent = data.title || id.split("/")[1]!;
    tab.title = data.title || id;
    entry.animator = new ProofAnimator(root, data, {
      katex: window.katex, liveTerms: true, enableTermAsk: true, enableExplore: true,
      paId: id,   // same-app explore/ask navigations carry ?pa=<id> so the animation travels
      // This proof now has its own chat — a term "Ask AI" flows into it (step-
      // aware), not the app. The app hand-off is the explicit button below.
      onTermAsk: ({ message }: { message: string }) => chat.ask(message),
      // Function Analysis has no local equivalent — hand off to the app, new tab.
      onFunctionAnalysis: ({ latex, step }: { latex: string; step?: number }) => openFaInApp(data.deeplink, id, step, latex),
    });
    setContinue(continueBtn, contDeep, data);       // reveal the app hand-off
  } catch (e) {
    showError(root, `Could not load "${id}": ${(e as Error).message}`);
  }
}

/** The animator's current step index (0 = goal), or null if unavailable. */
function animStep(anim: ProofAnimator | null): number | null {
  return anim && typeof anim.current === "number" ? anim.current : null;
}

/** Open the main AlgeBench app in a new tab, in chat, with the question.
 *  Carries the proof animation (`pa`) and the step the user is on (`pas`) so the
 *  app docks the same derivation at the same step. A proof's own `deeplink` may
 *  already pin these — if so we respect them and only fill what's missing. */
function openInApp(
  message: string,
  deeplink: string | null | undefined,
  id: string | null,
  step: number | null | undefined,
) {
  let u;
  try {
    u = new URL(deeplink || "/", location.origin);
    if (u.origin !== location.origin) u = new URL("/", location.origin);
  } catch (e) { u = new URL("/", location.origin); }
  u.searchParams.set("panel", "chat");
  u.searchParams.set("aa", String(message || "").slice(0, 1500));   // app opens chat + sends once
  if (id && !u.searchParams.has("pa")) u.searchParams.set("pa", id);   // load this proof's animation
  // `pas` (step) only makes sense with a `pa` — either pinned in the deeplink or
  // just added above. Don't clobber a step the deeplink already chose.
  if ((u.searchParams.has("pa")) && step != null && !u.searchParams.has("pas")) {
    u.searchParams.set("pas", String(step));
  }
  openAppTab(u.toString());
}

/** Open an app URL in a new tab, falling back to THIS tab when the popup is
 *  blocked. Without the fallback a blocked popup is a dead click — nothing
 *  happens and nothing says why (which is exactly what an embedded preview pane
 *  or a strict popup blocker produces). `noopener` is deliberately omitted: it
 *  forces `window.open` to return null even on success, so there'd be no way to
 *  tell "blocked" from "opened". The target is our own origin, so the opener
 *  reference it leaves behind is not a cross-origin concern. */
function openAppTab(url: string) {
  let w: Window | null = null;
  try { w = window.open(url, "_blank"); } catch (e) { w = null; }
  if (!w) location.assign(url);
}

/** Open the main app's Function Analysis page for a step's expression, preferring
 *  a NEW tab. The engine would navigate this tab (it's a top-level page, not an
 *  embed), which would throw away the derivation and chat sitting here — so /prove
 *  routes the click itself. Carries `pa`/`pas` like the ask hand-off, so the
 *  analysis attaches to the right proof step and the expert gets its context; an
 *  unsaved derivation has no `pa` and lands on the expression alone.
 *  A blocked popup falls back to this tab (openAppTab) — going somewhere the user
 *  didn't want beats a button that silently does nothing. */
function openFaInApp(
  deeplink: string | null | undefined,
  id: string | null,
  step: number | null | undefined,
  latex: string | null | undefined,
) {
  const tex = String(latex || "").trim();
  if (!tex) return;
  let u;
  try {
    u = new URL(deeplink || "/", location.origin);
    if (u.origin !== location.origin) u = new URL("/", location.origin);
  } catch (e) { u = new URL("/", location.origin); }
  u.searchParams.set("view", "math");
  u.searchParams.set("fax", tex.slice(0, 1000));
  u.searchParams.delete("fa");                      // never resolve a stale id first
  if (id && !u.searchParams.has("pa")) u.searchParams.set("pa", id);
  if (u.searchParams.has("pa") && step != null && !u.searchParams.has("pas")) {
    u.searchParams.set("pas", String(step));
  }
  openAppTab(u.toString());
}

// ── { } JSON viewer + < > embed dialog (shared modals) ──────────────────────
// One instance of each modal is re-populated for whichever open proof's toolbar
// button was clicked. The embed points at /renderproof?builtin=<id> — the same
// shareable renderer the blog embeds use (works for the shipped seed proofs).

/** The embeddable /renderproof URL for a proof id, in the chosen theme. The
 *  origin is wherever this page is served, so the snippet is environment-correct
 *  (localhost in dev, the real host in prod). */
function buildEmbedUrl(id: string, theme: string) {
  const u = new URL("/renderproof", location.origin);
  u.searchParams.set("builtin", id);
  u.searchParams.set("theme", theme);          // explicit → deterministic embed
  return u.toString();
}

/** The copy-paste iframe snippet (+ optional auto-resize companion script). */
function embedSnippet(url: string) {
  const origin = new URL(url).origin;
  return `<iframe src="${url}" width="100%" height="600" style="border:0;background:transparent" loading="lazy" ` +
         `title="AlgeBench proof animation" data-algebench-embed></iframe>\n` +
         `<!-- optional: auto-fits the height to the proof; remove to keep a fixed height -->\n` +
         `<script src="${origin}/embed-resizer.js" async></script>`;
}

/** A throwaway in-browser mock host page, so the user can see the embed dropped
 *  into a real article. `url`/`theme` come from a validated id + allowlisted
 *  theme, so they're safe to interpolate. Ported from /renderproof. */
function previewPageHtml(url: string, theme: string) {
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

// Module-level openers, wired once by setupModals() in main().
let openJsonModal: (proof: ProofData | null, id: string | null | undefined) => void = () => {};    // (proof, id) → show the { } viewer
let openEmbedModal: (id: string) => void = () => {};   // (id)        → show the < > embed dialog

/** Wire the two shared modals once: close (button / backdrop / Escape) and, for
 *  the embed dialog, the theme picker + Preview + Copy. Exposes the openers. */
function setupModals() {
  // { } JSON viewer.
  const jModal = document.getElementById("pa-json-modal")!;
  const jTitle = document.getElementById("pa-json-title")!;
  const jBody = document.getElementById("pa-json-body")!;
  // Held so Copy hands over exactly what is on screen — re-serializing could
  // drift from the rendered text, and reading it back out of the <pre> would
  // depend on the DOM staying a single text node.
  let jText = "";
  openJsonModal = (proof, id) => {
    jTitle.textContent = proof && proof.title ? proof.title : (id || "Proof JSON");
    jBody.textContent = "";
    const pre = document.createElement("pre");
    // textContent — never innerHTML: the JSON is untrusted proof data.
    jText = proof ? JSON.stringify(proof, null, 2) : "(no proof loaded)";
    pre.textContent = jText;
    jBody.appendChild(pre);
    jModal.classList.add("open");
  };
  const jHide = () => jModal.classList.remove("open");
  document.getElementById("pa-json-close")!.addEventListener("click", jHide);
  jModal.addEventListener("click", (e) => { if (e.target === jModal) jHide(); });

  // Copy the whole proof JSON. Same two-step as the embed dialog: the async
  // clipboard API, falling back to a selection + execCommand where it is blocked
  // (insecure origin, or permission denied). The fallback needs a real focusable
  // node, so it selects the <pre> rather than an off-screen textarea.
  const jCopied = document.getElementById("pa-json-copied")!;
  document.getElementById("pa-json-copy")!.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(jText);
    } catch {
      const pre = jBody.querySelector("pre");
      if (pre && window.getSelection) {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        try { document.execCommand("copy"); } catch (e) { /* clipboard unavailable */ }
      }
    }
    jCopied.hidden = false;
    setTimeout(() => { jCopied.hidden = true; }, 1500);
  });

  // < > embed dialog.
  const eModal = document.getElementById("pa-embed-modal")!;
  const eTitle = document.getElementById("pa-embed-title")!;
  const code = document.getElementById("pa-embed-code") as HTMLTextAreaElement;
  const sel = document.getElementById("pa-theme") as HTMLSelectElement;
  const copied = document.getElementById("pa-copied")!;
  let embedId: string | null = null;
  const refresh = () => { if (embedId) code.value = embedSnippet(buildEmbedUrl(embedId, sel.value)); };
  openEmbedModal = (id) => {
    embedId = id;
    eTitle.textContent = "Embed this proof";
    refresh();
    eModal.classList.add("open");
    code.focus(); code.select();
  };
  const eHide = () => eModal.classList.remove("open");
  document.getElementById("pa-embed-close")!.addEventListener("click", eHide);
  eModal.addEventListener("click", (e) => { if (e.target === eModal) eHide(); });
  sel.addEventListener("change", () => { refresh(); code.focus(); code.select(); });
  document.getElementById("pa-preview")!.addEventListener("click", () => {
    if (!embedId) return;
    const w = window.open("", "_blank");
    if (!w) return;                 // popup blocked
    w.opener = null;                // sever opener (reverse-tabnabbing); can't use the
                                    // "noopener" feature here — we need the handle to write
    w.document.open();
    w.document.write(previewPageHtml(buildEmbedUrl(embedId, sel.value), sel.value));
    w.document.close();
  });
  document.getElementById("pa-copy")!.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code.value);
    } catch {
      code.focus(); code.select();
      try { document.execCommand("copy"); } catch (e) { /* clipboard unavailable */ }
    }
    copied.hidden = false;
    setTimeout(() => { copied.hidden = true; }, 1500);
  });

  // One Escape handler closes whichever modal is open.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    jHide(); eHide();
  });
}

// ── Derive workspace ────────────────────────────────────────────────────────
let deriveAnimator: ProofAnimator | null = null;
let deriveProof: ProofData | null = null;        // the current derived proof (chat context)
let deriveSourceId: string | null = null;     // published id an Edit-cloned proof came from
let chatHistory: ChatTurn[] = [];

// Interactive step editing (proof-edit-tool.js). Owns the editing lock, the
// variant picker and undo; this module only supplies the wiring.
let editTool: ReturnType<typeof createProofEditTool> | null = null;
// True while a variant is being chosen: the animator shows a CANDIDATE but
// deriveProof is still the original, so actions that act on "the proof" are
// gated to stop the user shipping the version they are not looking at.
let editPending = false;

// Edit-by-key: when set, this Derive session updates the pending submission in
// place ({id, secret}); Submit becomes Update and the secret rotates on save.
let editingSubmission: { id: string; secret: string } | null = null;

/** Enter/leave submission-edit mode: chip + Submit→Update relabel. */
function setEditingSubmission(id: string | null, secret?: string) {
  editingSubmission = id ? { id, secret: secret! } : null;
  if (els.dEditing) {
    els.dEditing.hidden = !editingSubmission;
    els.dEditing.textContent = editingSubmission ? `editing ${editingSubmission.id}` : "";
    els.dEditing.title = editingSubmission
      ? `This session updates the pending submission ${editingSubmission.id} in place` : "";
  }
  if (els.dSubmit) els.dSubmit.textContent = editingSubmission ? "↑ Update" : "↑ Submit";
}

/** Show/clear the "based on <id>" provenance chip. The inherited id belongs to
 *  a published proof, so it can never be submitted under — the chip makes that
 *  visible; the name-availability check enforces it. */
function setDeriveSource(id: string | null) {
  deriveSourceId = id || null;
  if (!els.dBasedOn) return;
  els.dBasedOn.hidden = !deriveSourceId;
  els.dBasedOn.textContent = deriveSourceId ? `based on ${deriveSourceId}` : "";
  els.dBasedOn.title = deriveSourceId
    ? `Cloned from ${deriveSourceId} — submitting requires a new unique name`
    : "";
}

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
const _escapeHtml = (s: unknown) => String(s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
function _katex(tex: string, display: boolean) {
  try { return window.katex.renderToString(tex, { throwOnError: false, strict: false, displayMode: display }); }
  catch (e) { return _escapeHtml(tex); }
}
/** Pull $…$/$$…$$ out to placeholders (so they survive escaping/markdown),
 *  run `body` on the rest, then render the math back with KaTeX. */
function _withMath(text: unknown, body: (s: string) => string) {
  const blocks: [string, boolean][] = [];
  const stash = (tex: string, display: boolean) => { blocks.push([String(tex).trim(), display]); return '%%M' + (blocks.length - 1) + '%%'; };
  let s = String(text)
    .replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => stash(tex, true))
    .replace(/\$([^$\n]+)\$/g, (m, tex) => stash(tex, false));
  s = body(s);
  return s.replace(/%%M(\d+)%%/g, (m, i) => _katex(blocks[+i]![0], blocks[+i]![1]));
}
/** Untrusted text (user input / status): escape HTML, keep newlines, render math. */
function renderSafe(text: unknown) {
  return _withMath(text, (s) => _escapeHtml(s).replace(/\n/g, '<br>'));
}
/** Assistant markdown (the proof-chat reply): markdown + math. The reply is LM
 *  output — untrusted — so escape raw HTML BEFORE markdown so embedded tags
 *  (`<img onerror=…>`, etc.) render as inert text; markdown syntax has no
 *  `<>&`, so formatting still works, and math is already stashed by _withMath. */
function renderReply(text: unknown) {
  if (typeof window.marked === 'undefined') return null;   // fall back to plain text
  return _withMath(text, (s) => window.marked.parse(_escapeHtml(s)) as string);
}

function setStatus(text: string, cls?: string) {
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

/** Append a chat bubble (wrapped with a person/bot avatar) to a log (defaults to
 *  the Derive workspace log); returns the ROW so a "pending" one can be removed.
 *  User text is escaped + math-rendered; assistant text is markdown + math. */
function addBubble(role: string, text: string, cls?: string, logEl?: HTMLElement) {
  const log = logEl || els.dLog;
  const isUser = role === "user";
  const b = document.createElement("div");
  b.className = `bubble ${isUser ? "user" : "bot"}${cls ? " " + cls : ""}`;
  const isPending = !isUser && cls && cls.includes("pending");
  const html = !_hasRender() ? null
    : isUser ? renderSafe(text)
    : isPending ? null                             // dots, not the literal "…"
    : renderReply(text);
  if (isPending) {
    // Same pulsing "typing" dots as the status line, so the chat's loading state
    // matches the rest of the app instead of showing a static "…".
    b.innerHTML = '<span class="dots" aria-hidden="true"><span></span><span></span><span></span></span>';
  } else if (html != null) { b.innerHTML = html; } else { b.textContent = text; }   // safe fallback
  // Avatar (USER_ICON for the user, AI_ICON for the assistant), shared with the
  // main app chat via /icons.js. The row handles left/right placement.
  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.innerHTML = isUser ? USER_ICON : AI_ICON;
  const row = document.createElement("div");
  row.className = `msg-row ${isUser ? "user" : "bot"}`;
  row.append(avatar, b);
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
  return row;
}

// ── chat column resizing (draggable splitter, remembered across chats) ───────
const CHAT_W_KEY = "proveChatW";
const CHAT_W_MIN = 300, CHAT_W_MAX = 680, CHAT_W_STEP = 24;
const _clampChatW = (px: number) => Math.max(CHAT_W_MIN, Math.min(CHAT_W_MAX, px));

/** Persist the chat width — localStorage can throw (blocked storage / privacy). */
function _storeChatW(px: number) {
  try { localStorage.setItem(CHAT_W_KEY, String(px)); } catch (e) { /* blocked storage */ }
}

/** Apply the remembered chat width to a `.derive-cols` element (the --chat-w var).
 *  Guarded: `localStorage.getItem` can throw a SecurityError in blocked-storage /
 *  privacy modes, which would otherwise abort page init. */
function applyStoredChatW(colsEl: HTMLElement | null) {
  if (!colsEl) return;
  let raw = "";
  try { raw = localStorage.getItem(CHAT_W_KEY) || ""; } catch (e) { return; }
  const v = parseInt(raw, 10);
  if (v) colsEl.style.setProperty("--chat-w", _clampChatW(v) + "px");
}

/** Wire a `.col-resizer` to drag- OR keyboard-resize the chat column of its
 *  `.derive-cols`. Width is clamped [300,680] and persisted so all chats (Derive
 *  + every opened proof) share the preference. */
function wireColResizer(resizer: HTMLElement | null, colsEl: HTMLElement | null) {
  if (!resizer || !colsEl) return;
  const curW = () => parseInt(getComputedStyle(colsEl).getPropertyValue("--chat-w"), 10) || 360;
  // Keyboard-accessible slider semantics (focusable + arrow-adjustable).
  resizer.tabIndex = 0;
  resizer.setAttribute("aria-label", "Resize chat width");
  resizer.setAttribute("aria-valuemin", String(CHAT_W_MIN));
  resizer.setAttribute("aria-valuemax", String(CHAT_W_MAX));
  const setW = (px: number, persist: boolean) => {
    const w = _clampChatW(px);
    colsEl.style.setProperty("--chat-w", w + "px");
    resizer.setAttribute("aria-valuenow", String(w));
    if (persist) _storeChatW(w);
    return w;
  };
  setW(curW(), false);   // seed aria-valuenow

  let startX = 0, startW = 0, dragging = false;
  const onMove = (e: PointerEvent) => { if (dragging) setW(startW - (e.clientX - startX), false); };
  const onUp = () => {
    if (!dragging) return;
    dragging = false; resizer.classList.remove("dragging");
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    _storeChatW(curW());
  };
  resizer.addEventListener("pointerdown", (e) => {
    dragging = true; resizer.classList.add("dragging");
    startX = e.clientX; startW = curW();
    e.preventDefault();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);   // gesture cancel / interrupted drag
  });
  // Keyboard: ←/↑ widen the chat, →/↓ narrow it; Home/End to the limits.
  resizer.addEventListener("keydown", (e) => {
    let w: number;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") w = curW() + CHAT_W_STEP;
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") w = curW() - CHAT_W_STEP;
    else if (e.key === "End") w = CHAT_W_MAX;
    else if (e.key === "Home") w = CHAT_W_MIN;
    else return;
    e.preventDefault();
    setW(w, true);
  });
}

/** A self-contained proof-scoped chat column (head + log + input + Send), bound
 *  to a proof and its animator via getters. Used by OPENED proofs (the Derive
 *  workspace keeps its own inline chat). Returns { wrap, ask, history }. */
function buildProofChat(getProof: () => ProofData | null, getAnimator: () => ProofAnimator | null) {
  const history: ChatTurn[] = [];
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
      const data: { answer?: string } = await resp.json();
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
  function ask(message: string) {
    const m = String(message || "").trim();
    if (!m) return;
    input.value = m;
    doSend();
  }
  return { wrap, ask, history };
}

/** Reveal an app hand-off button and surface the proof's deep link if it has one. */
function setContinue(btnEl: HTMLElement, deepEl: HTMLElement, proof: ProofData | null) {
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
function continueInAppWith(
  proof: ProofData | null,
  history: ChatTurn[],
  id: string | null,
  step: number | null,
) {
  if (!proof) return;
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const seed = (lastUser && lastUser.text)
    || `Let's keep exploring: ${proof.title || "this derivation"}`;
  openInApp(seed, proof.deeplink, id || null, step);
}

/** Reveal the Derive toolbar, showing only what the current state supports.
 *
 *  The bar used to appear only once a derivation existed, which made the lock —
 *  its only always-meaningful control — unreachable before deriving. It is
 *  reachable from the start now, because unlocking with nothing derived is a
 *  legitimate way to BEGIN one: the chat writes step 0 (see
 *  `startEmptyDerivation`). `{ }` and Submit still need a proof with steps, so
 *  they stay hidden until there is one rather than opening on an empty shell. */
function syncViewerBar() {
  if (!els.dViewerBar) return;
  els.dViewerBar.hidden = false;
  const hasSteps = !!(deriveProof && (deriveProof.steps || []).length);
  // "Describe what to derive" + Derive are for STARTING one. Once there is a
  // derivation on screen they are the wrong affordance: the chat owns changing
  // it from here, and asking there is what gets the continue-or-replace choice
  // rather than silently discarding the proof the way Rederive did.
  if (els.dBar) els.dBar.hidden = hasSteps;
  if (els.dJson) els.dJson.hidden = !hasSteps;
  if (els.dSubmit) els.dSubmit.hidden = !hasSteps;
  if (els.dViewerId) {
    els.dViewerId.textContent = hasSteps ? "Derived proof" : "New derivation";
  }
}

/** Start an EMPTY derivation so edit prompts have something to write into.
 *
 *  `deriveProof` is null until something is derived, and both the chat payload
 *  and the edit tool need a proof object. This is that object: a real, valid
 *  proof with zero steps. The expert treats an empty derivation as `at = -1`
 *  ("insert before everything") and authors step 0 from the reader's
 *  description, so "start with $E = mc^2$" works with nothing on screen. */
function startEmptyDerivation() {
  deriveProof = {
    title: "Untitled derivation",
    domain: effectiveDomain() || "algebra",
    goal: "",
    steps: [],
    terms: {},
  };
  syncViewerBar();
}

/** Reflect the lock's state on its button (label, pressed state, tooltip). */
function syncLockButton() {
  if (!els.dLock) return;
  const on = !!(editTool && editTool.isUnlocked());
  els.dLock.textContent = on ? "🔓 Editing" : "🔒 Locked";
  els.dLock.setAttribute("aria-pressed", on ? "true" : "false");
  els.dLock.title = on
    ? "Lock editing — the chat will only answer questions"
    : "Unlock step editing — describe an operation in the chat";
}

/** Gate everything while a variant is being chosen.
 *
 *  The picker is a modal question, like AskUserQuestion: until it is resolved
 *  the chat input is locked so the user can't fire another request mid-choice,
 *  and Submit/Rederive are disabled because they'd act on deriveProof — the
 *  version the user is NOT looking at while previewing a candidate. */
function setEditPending(pending: boolean) {
  editPending = !!pending;
  if (els.dSubmit) els.dSubmit.disabled = editPending;
  if (els.dGo) els.dGo.disabled = editPending;
  if (els.dSend) els.dSend.disabled = editPending;
  if (els.dChatInput) {
    els.dChatInput.disabled = editPending;
    els.dChatInput.placeholder = editPending
      ? "Choose an option below to continue…"
      : "Ask about this derivation…";
  }
}

/** Build the edit tool once the DOM refs exist. */
function initEditTool() {
  editTool = createProofEditTool({
    getProof: () => deriveProof,
    getCurrentStep: () => (deriveAnimator && typeof deriveAnimator.current === "number")
      ? deriveAnimator.current : 0,
    onMount: (proof: ProofData, startStep: number) => mountAnimator(proof, startStep),
    // syncViewerBar AFTER the assignment, not before: the preview mount ran
    // while `deriveProof` was still the empty shell, so { } and Submit are
    // hidden. Committing the first step is what earns them.
    onCommit: (proof: ProofData) => { deriveProof = proof; syncViewerBar(); },
    setEditPending,
    // Variant notes quote step captions that may contain $…$ math. renderSafe
    // escapes HTML and renders the math with KaTeX (null if KaTeX isn't ready).
    renderMath: (text: string) => (_hasRender() ? renderSafe(text) : null),
    addBubble: (role: string, text: string) => { addBubble(role, text); chatHistory.push({ role, text }); },
    // The picker is part of the conversation, not a floating toolbar. Mount it as
    // a bot message in the chat thread so the question sits where the user is
    // looking and reading; selecting still previews in the animator below.
    mountBar: (bar: HTMLElement) => {
      const avatar = document.createElement("div");
      avatar.className = "msg-avatar";
      avatar.innerHTML = AI_ICON;
      const row = document.createElement("div");
      row.className = "msg-row bot edit-variants-row";
      row.append(avatar, bar);
      els.dLog.appendChild(row);
      els.dLog.scrollTop = els.dLog.scrollHeight;
    },
    // proof-edit-tool.js is still JavaScript, and its JSDoc `@param deps.*`
    // block documents only six of the eight dependencies it destructures —
    // `renderMath` and `mountBar` are missing, so tsc reads them as excess
    // properties. Fixing the doc block belongs to that file's own conversion
    // (it is owned by another migration PR), so assert here rather than reach
    // across and edit it.
  } as Parameters<typeof createProofEditTool>[0]);
  syncLockButton();
}

/** (Re)mount the animator on a proof, WITHOUT touching the chat thread.
 *
 *  ProofAnimator has no setData, so swapping proofs means destroy + reconstruct;
 *  `startStep` keeps the user where they were. Used both for a fresh derivation
 *  and to flip between edit variants, which is why the chat reset lives in
 *  showInDerive rather than here. */
function mountAnimator(proof: ProofData, startStep?: number) {
  // Carry the user's runtime toggles (stacked / sequential / speed) across the
  // destroy+reconstruct — previewing an edit variant must not reset them.
  const keep = deriveAnimator
    ? { stacked: deriveAnimator.stacked, mode: deriveAnimator.mode, speed: deriveAnimator.speed }
    : {};
  if (deriveAnimator) { try { deriveAnimator.destroy(); } catch (e) { /* noop */ } deriveAnimator = null; }
  els.dRoot.textContent = "";
  els.dEmpty.hidden = true;
  deriveAnimator = new ProofAnimator(els.dRoot, proof, {
    katex: window.katex, liveTerms: true, enableTermAsk: true, enableExplore: true,
    startStep: typeof startStep === "number" ? startStep : 0,
    // A term "Ask AI" goes to the LOCAL step-aware chat, not the app.
    onTermAsk: ({ message }: { message: string }) => askInChat(message),
    // An in-progress derivation isn't saved, so there's no `pa` to carry — the
    // app gets the expression and analyzes it without proof context.
    onFunctionAnalysis: ({ latex, step }: { latex: string; step?: number }) => openFaInApp(proof && proof.deeplink, null, step, latex),
    ...keep,
  });
  els.dGo.textContent = "Rederive";              // a derivation now exists
  syncViewerBar();                                // now with { } and Submit
  showContinue(proof);                            // reveal the explicit app hand-off
}

/** Render a proof into the Derive workspace: fresh chat, live animator (term
 *  Ask-AI → local chat), Rederive button, app hand-off. Shared by runDerive
 *  (after deriving) and Edit (cloning an opened proof in to tweak). */
function showInDerive(proof: ProofData) {
  deriveProof = proof;
  chatHistory = [];                              // fresh thread, scoped to this proof
  if (els.dLog) els.dLog.textContent = "";
  // A newly loaded proof is never born editable — the lock re-arms, and any
  // in-flight variant selection or undo history from the previous proof is
  // dropped rather than silently carried over.
  if (editTool) editTool.reset();
  syncLockButton();
  mountAnimator(proof, 0);
}

/** "Edit" an opened proof: clone it into the Derive workspace as a fresh, unsaved
 *  working copy (nothing is written). The user can chat to refine, or edit the
 *  prompt and Rederive. The original tab is untouched. */
function editInDerive(proof: ProofData | null, id: string) {
  if (!proof) return;
  const clone: ProofData = JSON.parse(JSON.stringify(proof));   // never mutate the opened proof
  switchTo("derive");
  showInDerive(clone);
  setDeriveSource(id);                               // provenance chip (inherited id)
  setEditingSubmission(null);                        // a clone is NOT an in-place edit
  // Seed the prompt from the goal so Rederive is immediately actionable (editable).
  els.dPrompt.value = (clone.goal || "").replace(/\$/g, "").trim();
  const shown = (clone.title || "proof").replace(/^Deriving\s+/i, "");
  setStatus(`Cloned ${shown} — ${clone.steps.length} steps. Chat to refine, or edit the prompt and Rederive.`, "ok");
}

/** Edit a PENDING submission in place: ask for the author's edit key, verify it
 *  by fetching the source package (prompt + documentation), then load the proof
 *  into Derive in edit mode — Submit becomes Update (PUT, key rotates). Only
 *  offered while the proof is under review; approved proofs can only be cloned. */
async function editSubmissionWithKey(proof: ProofData | null, id: string) {
  if (!proof) return;
  const key = (window.prompt(
    `Paste the edit key for ${id}\n(shown once when it was submitted or last updated):`) || "").trim();
  if (!key) return;
  let src: { prompt?: string; documentation?: string } | undefined;
  try {
    const resp = await fetch(
      `/api/proofs/source?id=${encodeURIComponent(id)}&secret=${encodeURIComponent(key)}`,
      { cache: "no-store" });
    if (resp.status === 403) {
      window.alert("That key doesn't unlock this submission — it may have rotated on a "
        + "previous update, or the submission was already reviewed and is now published "
        + "(published proofs can only be cloned).");
      return;
    }
    // Enter edit mode ONLY on a verified 2xx. Any other status (404 gone from the
    // queue, 5xx, …) is a failure — never fall through into edit mode with an
    // empty package (that would strand the user in a confusing Update→403).
    if (!resp.ok) {
      window.alert("Couldn't load this submission to edit — please try again.");
      return;
    }
    src = await resp.json();
  } catch (e) {
    window.alert("Couldn't verify the key — please try again.");
    return;
  }
  const clone: ProofData = JSON.parse(JSON.stringify(proof));
  switchTo("derive");
  showInDerive(clone);
  setDeriveSource(null);
  setEditingSubmission(id, key);
  // Restore the submission package so a Rederive starts from the same context.
  els.dPrompt.value = (src && src.prompt) || (clone.goal || "").replace(/\$/g, "").trim();
  els.dDoc.value = (src && src.documentation) || "";
  updateDocCount();
  if (els.dDoc.value.trim()) openDocEditor(); else { closeDocEditor(); }
  setStatus(`Editing submission ${id} — chat or Rederive, then ↑ Update to save.`, "ok");
}

/** Prefill the Derive tab from a local draft written by the `algebench-prove`
 *  skill: /prove?draft=<docid> → the server (DEBUG only) resolves the token and
 *  stamps {prompt, doc, domain} onto `data-derive-draft` (CSP forbids inline
 *  scripts, so it rides a data-* attribute like data-debug). We fill the fields
 *  and switch to the tab, but NEVER auto-run — the user reviews and clicks Derive. */
function applyDeriveDraft() {
  const raw = document.body.dataset.deriveDraft;
  if (!raw) return;
  let draft: { prompt?: unknown; domain?: unknown; doc?: unknown } | undefined;
  try { draft = JSON.parse(raw); } catch (e) { return; }
  if (!draft || typeof draft !== "object") return;

  switchTo("derive");
  els.dPrompt.value = typeof draft.prompt === "string" ? draft.prompt : "";

  const domain = typeof draft.domain === "string" ? draft.domain.trim() : "";
  if (domain) {
    // A known option → the dropdown; anything else → the custom-domain field
    // (effectiveDomain() prefers the custom field, so clear the other).
    const known = Array.from(els.dDomain.options).some((o) => o.value === domain);
    if (known) { els.dDomain.value = domain; els.dDomainCustom.value = ""; }
    else { els.dDomainCustom.value = domain; els.dDomain.value = ""; }
  }

  const doc = typeof draft.doc === "string" ? draft.doc : "";
  els.dDoc.value = doc;
  if (doc.trim()) openDocEditor(); else { updateDocCount(); refreshDocHint(); }

  setStatus("Prefilled by algebench-prove — review the prompt and documentation, then click Derive.", "ok");
  els.dPrompt.focus();
}

/** The special Derive/Rederive action (top): prompt (+ domain + docs) →
 *  proof_from_prompt → render in the derivation box. Once a proof exists the
 *  button reads "Rederive". */
/** Run a derivation the CHAT asked for (the `derive` tool), then add or replace.
 *
 *  Deliberately the same expert call as the Derive box — the chat is a second
 *  door onto one derivation path, not a parallel implementation. The server
 *  hands the request over rather than running it: a derivation routinely takes
 *  longer than the chat's own timeout allows.
 *
 *  `continue` derives ONWARD from the current last step by pinning `start_latex`
 *  to it. That is what makes appending sound: the new chain's step 0 IS our last
 *  step, so every step after it was CAS-verified against the predecessor it
 *  actually lands on, and splicing needs no re-grading — only renumbering. */
async function runChatDerive(req: { prompt?: string; mode?: string }) {
  const prompt = String((req && req.prompt) || "").trim();
  if (!prompt) return false;
  const steps = (deriveProof && deriveProof.steps) || [];
  const appending = req.mode === "continue" && steps.length > 0;
  // Into the THREAD, not just the log — the agent must see what happened on the
  // next turn, or "add another step" arrives with no idea a derivation just ran.
  const say = (text: string, cls?: string) => { addBubble("bot", text, cls); chatHistory.push({ role: "bot", text }); };

  els.dGo.disabled = true;
  setStatus(appending
    ? "Continuing the derivation… (CAS-verifying each step)"
    : "Deriving… (CAS-verifying each step)", "pending");

  const body: DeriveRequest = { prompt };
  const domain = effectiveDomain();
  const documentation = els.dDoc.value.trim();
  if (domain) body.domain = domain;
  if (documentation) body.documentation = documentation;
  if (appending) body.start_latex = steps[steps.length - 1]!.input_latex || "";

  try {
    const data: { error?: string } = await invokeExpert("proof_from_prompt", body, { timeoutMs: DERIVE_TIMEOUT_MS });
    if (data && data.error) { setStatus(data.error, "err"); say(data.error, "err"); return true; }
    const derived: ProofData = validateProofData(data);

    if (!appending) {
      showInDerive(derived);                       // same as the Derive box
      setDeriveSource(null);
      const shown = (derived.title || "proof").replace(/^Deriving\s+/i, "");
      setStatus(`Derived ${shown} — ${derived.steps.length} steps.`, "ok");
      say(`Replaced the derivation — ${derived.steps.length} steps.`);
      return true;
    }

    // Drop the derived step 0: it is our own last step restated, and keeping it
    // would show the reader the same line twice.
    const added = (derived.steps || []).slice(1);
    if (!added.length) {
      setStatus("That derivation added no new steps.", "err");
      say("That didn't add any steps beyond where the derivation already is.");
      return true;
    }
    const merged = {
      ...deriveProof,
      steps: [...steps, ...added].map((s, i) => ({ ...s, index: i })),
      terms: { ...(deriveProof!.terms || {}), ...(derived.terms || {}) },
    };
    deriveProof = validateProofData(merged);       // same trust gate as a fresh derive
    if (editTool) editTool.reset();                // stale undo history / preview
    syncLockButton();
    mountAnimator(deriveProof, steps.length);      // land on the first NEW step
    setStatus(`Continued the derivation — ${added.length} step(s) added.`, "ok");
    say(`Added ${added.length} step(s) to the derivation.`);
    return true;
  } catch (e) {
    const msg = (e instanceof ExpertError ? e.message : (e ? (e as Error).message : undefined)) || "Derivation failed.";
    setStatus(msg, "err");
    say(msg, "err");
    return true;
  } finally {
    els.dGo.disabled = false;
  }
}

async function runDerive() {
  const prompt = els.dPrompt.value.trim();
  if (!prompt || els.dGo.disabled) return;
  els.dGo.disabled = true;
  setStatus("Deriving… (CAS-verifying each step)", "pending");
  // NB: don't hide the hand-off here — on a rederive the current proof stays in
  // the box while this runs (and if it errors), so the button must stay too. It's
  // shown strictly when a proof box exists: revealed on the first success below,
  // and never cleared (there's no path that empties the box).

  const body: DeriveRequest = { prompt };
  const domain = effectiveDomain();
  const documentation = els.dDoc.value.trim();
  if (domain) body.domain = domain;
  if (documentation) body.documentation = documentation;
  try {
    const data: { error?: string } = await invokeExpert("proof_from_prompt", body, { timeoutMs: DERIVE_TIMEOUT_MS });
    if (data && data.error) { setStatus(data.error, "err"); return; }
    const proof: ProofData = validateProofData(data);
    showInDerive(proof);                           // render + fresh chat + hand-off
    setDeriveSource(null);                         // fresh derivation — no inherited id
    // The title is "Deriving <target> from <start>"; strip the leading verb so
    // the status reads "Derived <target> from <start>", not "Derived Deriving …".
    const shown = (proof.title || "proof").replace(/^Deriving\s+/i, "");
    setStatus(`Derived ${shown} — ${proof.steps.length} steps.`, "ok");
  } catch (e) {
    setStatus((e instanceof ExpertError ? e.message : (e ? (e as Error).message : undefined)) || "Derivation failed.", "err");
  } finally {
    els.dGo.disabled = false;
  }
}

/** A /api/proof-chat reply: the prose answer, plus at most one tool payload
 *  keyed by the tool's own name (see CHAT_ACTIONS). */
export interface ChatReply {
  answer?: string;
  [tool: string]: unknown;
}

/** The payload the proof chat sends: the thread + the proof + the step in view. */
function chatBody() {
  return {
    messages: chatHistory,
    proof: deriveProof || null,
    currentStep: (deriveAnimator && typeof deriveAnimator.current === "number")
      ? deriveAnimator.current : null,
    // The editing lock. When false the server does not declare the edit_step
    // tool at all, so the agent CANNOT change the derivation — the lock is
    // enforced by the tool's absence rather than by asking it to behave.
    allowEdits: !!(editTool && editTool.isUnlocked()),
    // This is the Derive workspace (a lock toggle exists). Tells the server that
    // "unlock the 🔒 Locked button" is the right guidance when locked — vs a
    // read-only opened proof, where the guidance is to Clone first.
    inDerive: true,
  };
}

/** A term's "Ask AI" now flows into the LOCAL step-aware chat (we have one here),
 *  not the app. Drops the question in the input and sends it. */
function askInChat(message: string) {
  const m = String(message || "").trim();
  if (!m) return;
  els.dChatInput.value = m;
  sendChat();
}

/** Reveal the explicit "Continue in the main app" hand-off, and surface the
 *  proof's deep link when it has one (built-ins / saved proofs do; a fresh,
 *  unsaved derivation does not — then only the chat context carries over). */
function showContinue(proof: ProofData | null) {
  setContinue(els.dContinue, els.dContinueDeep, proof);
}

/** Derive-workspace app hand-off — carries the derived proof + this thread. */
function continueInApp() {
  continueInAppWith(deriveProof, chatHistory, null, animStep(deriveAnimator));
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
    const d: {
      model?: string; charCount?: number; currentStep?: number | null;
      contents?: ChatTurn[]; systemPrompt?: string;
    } = await resp.json();
    const meta = `model: ${d.model} · system prompt: ${d.charCount} chars · currentStep: ${d.currentStep ?? "—"}`;
    const contents = (d.contents || []).map((m) => `${m.role}: ${m.text}`).join("\n\n") || "(no turns yet)";
    els.ctxBody.innerHTML =
      `<div class="ctx-meta">${_escapeHtml(meta)}</div>` +
      `<h4>System prompt</h4><pre>${_escapeHtml(d.systemPrompt || "")}</pre>` +
      `<h4>Contents (thread)</h4><pre>${_escapeHtml(contents)}</pre>`;
  } catch (e) {
    els.ctxBody.innerHTML =
      `<div class="ctx-meta">Couldn't load context (${_escapeHtml(String((e ? (e as Error).message : undefined) || e))}).</div>`;
  }
}

// A chat turn that calls edit_step rebuilds and CAS-verifies up to three proof
// variants inline, so the ceiling is generous — but finite.
const CHAT_TIMEOUT_MS = 120000;

// ── chat tool results ───────────────────────────────────────────────────────
// EVERY tool the proof chat can call is listed here, and nowhere else — the
// client half of `PROOF_CHAT_TOOLS` in backend/server.py. Adding a tool means
// adding a row on each side, rather than hiding an `if (data.someKey)` inside
// `sendChat`.
//
// `tool` is the ONE identifier: it is the name the server declared to Gemini,
// AND the key the payload arrives under. Dispatch is an exact property lookup —
// no substring or prefix matching anywhere.
//
// `run(payload, data)` returns truthy when it produced something the reader can
// see; that is what stops the turn falling through to "(no response)".
//
// `blocking` marks work that outlives the request: Send stays disabled for its
// duration so a second long job cannot be queued behind it.
/** One row of the tool table below. `payload` arrives as the raw JSON value the
 *  server sent under `tool`, so each row narrows it itself. */
interface ChatAction {
  tool: string;
  blocking: boolean;
  run(payload: unknown, data: ChatReply): boolean | Promise<boolean>;
}

const CHAT_ACTIONS: ChatAction[] = [
  {
    tool: "edit_step",
    // Already done and CAS-checked server-side — the variants rode back on this
    // reply, so this only renders the picker.
    blocking: false,
    run: (payload, data) => !!(editTool && editTool.applyEditResult(data)),
  },
  {
    tool: "derive",
    // NOT done yet: a derivation outlives a chat turn, so the server handed the
    // request over and it runs here on the Derive box's own path.
    blocking: true,
    run: (payload) => runChatDerive(payload as { prompt?: string; mode?: string }),
  },
];

/** Dispatch whatever tool results came back on a chat reply.
 *
 *  The server sends at most one, but this does not assume it — each action whose
 *  key is present runs, in table order. */
async function runChatActions(data: ChatReply) {
  if (!data) return false;
  let acted = false;
  for (const action of CHAT_ACTIONS) {
    const payload = data[action.tool];
    if (!payload) continue;
    if (action.blocking) els.dSend.disabled = true;
    try {
      acted = (await action.run(payload, data)) || acted;
    } catch (e) {
      addBubble("bot", `Couldn't complete “${action.tool}”.`, "err");
      acted = true;
    } finally {
      if (action.blocking && !editPending) els.dSend.disabled = false;
    }
  }
  return acted;
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
  // "undo" is the one thing that never needs the server. Everything else — including
  // whether a message is an edit at all — is the chat agent's call, made with the
  // whole conversation in view. No keyword matching happens on this side.
  if (editTool && editTool.interceptLocal(msg)) { els.dSend.disabled = false; return; }
  const pending = addBubble("bot", "…", "pending");
  try {
    // Send the whole thread + the proof + which step is in view, so the chat is
    // conversational and step-aware (resolves "why this step").
    //
    // Bounded: a turn that calls edit_step runs a CAS-verified rebuild inline, so
    // this request can legitimately take the better part of a minute — but a
    // wedged one must not leave the reader watching a spinner forever.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CHAT_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch("/api/proof-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatBody()),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) throw new Error(`chat error ${resp.status}`);
    const data: ChatReply = await resp.json();
    pending.remove();
    const reply = ((data && data.answer) || "").trim();
    if (reply) {
      addBubble("bot", reply);
      chatHistory.push({ role: "bot", text: reply });
    }
    const acted = await runChatActions(data);
    if (!reply && !acted) addBubble("bot", "(no response)");
  } catch (e) {
    pending.remove();
    addBubble("bot", e && (e as Error).name === "AbortError"
      ? "That took too long and was stopped — try again, or a simpler operation."
      : "Chat is unavailable right now.", "err");
  } finally {
    // Don't re-enable while a variant picker is open — it is a modal question,
    // and setEditPending owns the input/Send state until it's resolved.
    if (!editPending) els.dSend.disabled = false;
  }
}

// ── Submit for review ────────────────────────────────────────────────────────
// The Submit button (Derive toolbar) opens a dialog: explanation + a NEW unique
// name (live availability across published proofs AND pending submissions),
// then POSTs the package {proof, prompt, documentation} to
// /api/proof-submissions and shows a thank-you with the direct link.
let submitAvailable = false;   // the last checked name is claimable
let submitCheckedId: string | null = null;    // the normalized id that check was for
let subCheckTimer: number | null = null;

function setAvail(text: string, cls?: string) {
  els.subAvail.textContent = text;
  els.subAvail.className = `sub-avail ${cls || ""}`;
}

/** State the naming rules and the size budget before the user types.
 *
 *  Both were previously discoverable only by failing: the character rules showed
 *  up as an error after an invalid name, and the 2 MB cap not at all until the
 *  POST came back. Shows the proof's ACTUAL size against the cap so "is mine too
 *  big?" is answered rather than left to be guessed at. */
function syncSubmitHint() {
  if (!els.subHint) return;
  const bytes = proofBytes(deriveProof);
  const over = bytes > MAX_PROOF_BYTES;
  els.subHint.innerHTML =
    `Format <code>domain/name</code> — lowercase letters, digits and hyphens only `
    + `(e.g. <code>algebra/quadratic-roots</code>). Each part must start and end `
    + `with a letter or digit. Domain ${ID_DOMAIN_MIN}–${ID_DOMAIN_MAX} characters, `
    + `name ${ID_NAME_MIN}–${ID_NAME_MAX}. Reserved names: `
    + `<code>${ID_RESERVED.join("</code>, <code>")}</code>.<br>`
    + `Proof size <strong${over ? ' class="sub-over"' : ""}>${formatBytes(bytes)}</strong>`
    + ` of ${formatBytes(MAX_PROOF_BYTES)}${over ? " — too large to submit." : ""}`;
}

function openSubmitModal() {
  if (!deriveProof) return;
  syncSubmitHint();
  els.subForm.hidden = false;
  els.subDone.hidden = true;
  els.subGo.disabled = true;
  submitAvailable = false; submitCheckedId = null;
  if (editingSubmission) {
    // Editing a pending submission: the name decides the action — keep it to
    // UPDATE in place (key rotates), or type a new one to submit a SEPARATE
    // version for review (same Derive tab, different name).
    els.subName.value = editingSubmission.id;
    els.subBased.hidden = false;
    els.subBased.textContent =
      `Editing ${editingSubmission.id} — keep this name to update it in place ` +
      `(your edit key rotates), or enter a new name to submit a separate version.`;
    els.subModal.classList.add("open");
    els.subName.focus();
    checkSubmitName();               // sets Update vs Submit from the name
    return;
  }
  els.subGo.textContent = "Submit";
  if (deriveSourceId) {
    els.subBased.hidden = false;
    els.subBased.textContent =
      `Based on ${deriveSourceId} — that name is already taken, so pick a new one.`;
    if (!els.subName.value.trim()) els.subName.value = `${deriveSourceId}-v2`;
  } else {
    els.subBased.hidden = true;
    if (!els.subName.value.trim()) {
      // Seed "<domain>/" from the proof so the user only types the name part.
      const dom = String(deriveProof.domain || effectiveDomain() || "")
        .toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
      if (dom) els.subName.value = `${dom}/`;
    }
  }
  els.subModal.classList.add("open");
  els.subName.focus();
  checkSubmitName();                 // validate whatever was prefilled
}

function checkSubmitName() {
  // Invalidate SYNCHRONOUSLY, before the debounce. `doCheckSubmitName` runs
  // 300 ms later, and until it does the button still reflects the PREVIOUS
  // name — so typing one bad character after a valid name left Submit live and
  // showing an error underneath it. Any edit now disables until re-validated.
  submitAvailable = false;
  if (els.subGo) els.subGo.disabled = true;
  clearTimeout(subCheckTimer!);
  subCheckTimer = setTimeout(doCheckSubmitName, 300);   // debounce keystrokes
}

async function doCheckSubmitName() {
  const raw = els.subName.value.trim().toLowerCase();
  submitAvailable = false; els.subGo.disabled = true;
  if (!raw) { setAvail("", ""); return; }
  if (editingSubmission && raw === editingSubmission.id) {
    // Same name → update the pending submission in place.
    setAvail("↻ Same name — updates your pending submission (edit key rotates).", "ok");
    els.subGo.textContent = "Update";
    els.subGo.disabled = false;
    return;
  }
  els.subGo.textContent = "Submit";    // different name → a separate new version
  const problem = idProblem(raw);
  if (problem) { setAvail(problem, "err"); return; }
  // Size is a hard server limit, so say so here rather than after a failed POST.
  const bytes = proofBytes(deriveProof);
  if (bytes > MAX_PROOF_BYTES) {
    setAvail(`This proof is ${formatBytes(bytes)} — over the `
      + `${formatBytes(MAX_PROOF_BYTES)} limit. Shorten it before submitting.`, "err");
    return;
  }
  setAvail("Checking…", "");
  try {
    const resp = await fetch(
      `/api/proofs/name-available?name=${encodeURIComponent(raw)}`, { cache: "no-store" });
    const d: { available?: boolean; id?: string; reason?: string } = await resp.json();
    if (els.subName.value.trim().toLowerCase() !== raw) return;   // stale — user kept typing
    if (d.available) {
      submitAvailable = true; submitCheckedId = d.id || raw;
      setAvail(`✓ ${submitCheckedId} is available`, "ok");
      els.subGo.disabled = false;
    } else if (d.reason === "invalid") {
      // The local checks above passed but the server still refused it — they have
      // drifted apart. Say that honestly instead of blaming a collision.
      setAvail("The server rejected that name as invalid — check the rules above.", "err");
    } else {
      setAvail(`✗ ${raw} is already taken — try ${raw}-v2`, "err");
    }
  } catch (e) {
    setAvail("Couldn't check availability — try again.", "err");
  }
}

async function doSubmit() {
  // The typed name decides: the editing id → UPDATE in place; anything else →
  // a fresh submission (so one Derive tab can submit several named versions).
  const raw = els.subName.value.trim().toLowerCase();
  const updating = !!(editingSubmission && raw === editingSubmission.id);
  if ((!updating && !submitAvailable) || !deriveProof || els.subGo.disabled) return;
  els.subGo.disabled = true;
  setAvail(updating ? "Updating…" : "Submitting…", "");
  // The package: proof + its context (the derive prompt + attached documentation).
  const source = {
    prompt: els.dPrompt.value.trim(),
    documentation: els.dDoc.value.trim(),
    references: [],
  };
  try {
    const url = updating
      ? `/api/proof-submissions?secret=${encodeURIComponent(editingSubmission!.secret)}`
      : "/api/proof-submissions";
    const resp = await fetch(url, {
      method: updating ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: updating ? editingSubmission!.id : submitCheckedId,
        data: deriveProof,
        source,
      }),
    });
    if (resp.status === 409) {           // lost a claim race — pick another name
      submitAvailable = false;
      setAvail("✗ that name was just taken — pick another.", "err");
      return;
    }
    if (resp.status === 403 && updating) {   // rotated key / promoted out of review
      setAvail("✗ key no longer valid — the submission was updated elsewhere or already reviewed.", "err");
      els.subGo.disabled = false;
      return;
    }
    if (!resp.ok) throw new Error(`error ${resp.status}`);
    const d: { id: string; secret: string } = await resp.json();
    // Hold the (new) key so this session can keep editing without re-entering it.
    setEditingSubmission(d.id, d.secret);
    els.subForm.hidden = true;
    els.subDone.hidden = false;
    els.subDoneMsg.textContent = updating
      ? "Your submission was updated."
      : "Your derivation was submitted for review.";
    const link = new URL("/prove", location.origin);
    link.searchParams.set("id", d.id);
    els.subDoneLink.href = link.toString();
    els.subDoneLink.textContent = link.toString();
    els.subKey.textContent = d.secret;
    setStatus(updating
      ? `Updated ${d.id} — still under review; your edit key rotated.`
      : `Submitted ${d.id} for review — it appears in Browse once approved.`, "ok");
  } catch (e) {
    setAvail(updating ? "Update failed — please try again." : "Submission failed — please try again.", "err");
    els.subGo.disabled = false;
  }
}

/** Wire the submit dialog once (open/close, live name check, submit). */
function setupSubmitModal() {
  els.subModal = document.getElementById("pa-submit-modal")!;
  els.subForm = document.getElementById("sub-form")!;
  els.subDone = document.getElementById("sub-done")!;
  els.subBased = document.getElementById("sub-based")!;
  els.subName = document.getElementById("sub-name") as HTMLInputElement;
  els.subHint = document.getElementById("sub-hint")!;
  els.subAvail = document.getElementById("sub-avail")!;
  els.subGo = document.getElementById("sub-go") as HTMLButtonElement;
  els.subDoneLink = document.getElementById("sub-done-link") as HTMLAnchorElement;
  els.subDoneMsg = document.getElementById("sub-done-msg")!;
  els.subKey = document.getElementById("sub-key")!;
  document.getElementById("sub-key-copy")!.addEventListener("click", async () => {
    const key = els.subKey.textContent;
    if (!key) return;
    try { await navigator.clipboard.writeText(key); } catch (e) { /* blocked clipboard */ }
  });
  const hide = () => els.subModal.classList.remove("open");
  document.getElementById("sub-close")!.addEventListener("click", hide);
  document.getElementById("sub-cancel")!.addEventListener("click", hide);
  document.getElementById("sub-done-close")!.addEventListener("click", hide);
  els.subModal.addEventListener("click", (e) => { if (e.target === els.subModal) hide(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  els.subName.addEventListener("input", checkSubmitName);
  els.subName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); if (submitAvailable || editingSubmission) doSubmit(); }
  });
  els.subGo.addEventListener("click", doSubmit);
}

/** Fetch the catalog — optionally including pending submissions (the Browse
 *  "show proofs under review" opt-in; each such entry is status-tagged). */
async function loadCatalog(includeSubmissions: boolean) {
  const url = includeSubmissions ? "/api/proofs?includeSubmissions=1" : "/api/proofs";
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`catalog error ${resp.status}`);
  catalog = (await resp.json()).proofs || [];
  catalog.sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
}

async function main() {
  paintTheme();
  const repaintToggle = wireThemeToggle(document.getElementById("theme-toggle"));
  matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => { paintTheme(); repaintToggle(); });
  els.search = document.getElementById("search") as HTMLInputElement;
  els.browse = document.getElementById("browse")!;
  els.count = document.getElementById("count")!;
  els.empty = document.getElementById("empty")!;
  els.tabbar = document.getElementById("tabbar")!;
  els.panels = document.getElementById("panels")!;
  els.tabBrowse = document.getElementById("tab-browse")!;
  els.panelBrowse = document.getElementById("panel-browse")!;
  els.tabBrowse.addEventListener("click", () => switchTo(null));
  setupModals();                    // shared { } JSON + < > embed dialogs
  setupSubmitModal();               // submit-for-review dialog

  // Derive workspace
  els.tabDerive = document.getElementById("tab-derive")!;
  els.panelDerive = document.getElementById("panel-derive")!;
  els.dDomain = document.getElementById("d-domain") as HTMLSelectElement;
  els.dDomainCustom = document.getElementById("d-domain-custom") as HTMLInputElement;
  els.dDocBtn = document.getElementById("d-doc-btn")!;
  els.dDocHint = document.getElementById("d-doc-hint")!;
  els.dDocEditor = document.getElementById("d-doc-editor")!;
  els.dDoc = document.getElementById("d-doc") as HTMLTextAreaElement;
  els.dDocCount = document.getElementById("d-doc-count")!;
  els.dRoot = document.getElementById("d-root")!;
  els.dEmpty = document.getElementById("d-empty")!;
  // { } JSON viewer for the derived proof (revealed once a derivation exists).
  els.dViewerBar = document.getElementById("d-viewer-bar")!;
  els.dViewerId = document.getElementById("d-viewer-id")!;
  els.dJson = document.getElementById("d-json") as HTMLButtonElement;
  els.dJson.innerHTML = BRACES_ICON;
  els.dJson.addEventListener("click",
    () => openJsonModal(deriveProof, deriveProof && deriveProof.title));
  // Provenance + editing chips + Submit-for-review (same toolbar).
  els.dBasedOn = document.getElementById("d-based-on")!;
  els.dEditing = document.getElementById("d-editing")!;
  els.dSubmit = document.getElementById("d-submit") as HTMLButtonElement;
  els.dSubmit.addEventListener("click", openSubmitModal);
  // Editing lock + the variant picker slot (interactive step editing).
  els.dLock = document.getElementById("d-lock") as HTMLButtonElement;
  initEditTool();
  els.dLock.addEventListener("click", () => {
    const unlocking = !editTool!.isUnlocked();
    // Unlocking with nothing derived starts an empty derivation rather than
    // refusing: the reader can then simply state the first line in the chat.
    const starting = unlocking && !deriveProof;
    if (starting) startEmptyDerivation();
    editTool!.setUnlocked(unlocking);
    syncLockButton();
    setStatus(starting
      ? "Editing unlocked on a new, empty derivation — describe the first step in the chat, e.g. “start with $E = mc^2$”."
      : unlocking
        ? "Editing unlocked — describe an operation in the chat, e.g. “multiply both sides by 2”."
        : "Editing locked — the chat only answers questions. Click 🔒 Locked to unlock and make edits.", "ok");
  });
  els.dStatus = document.getElementById("d-status")!;
  els.dLog = document.getElementById("d-log")!;
  els.dBar = document.getElementById("d-bar")!;
  els.dPrompt = document.getElementById("d-prompt") as HTMLTextAreaElement;
  els.dGo = document.getElementById("d-go") as HTMLButtonElement;
  els.dChatInput = document.getElementById("d-chat-input") as HTMLTextAreaElement;
  els.dSend = document.getElementById("d-send") as HTMLButtonElement;
  els.dContinue = document.getElementById("d-continue") as HTMLButtonElement;
  els.dContinueDeep = document.getElementById("d-continue-deep")!;
  els.dContinue.addEventListener("click", continueInApp);
  // Reveal the toolbar up front so the lock is reachable before anything is
  // derived — { } and Submit stay hidden until there are steps.
  syncViewerBar();
  // Draggable chat splitter (Derive workspace).
  const dCols = els.panelDerive.querySelector(".derive-cols") as HTMLElement | null;
  applyStoredChatW(dCols);
  wireColResizer(dCols && dCols.querySelector(".col-resizer"), dCols);
  els.tabDerive.addEventListener("click", () => switchTo("derive"));
  els.dDocBtn.addEventListener("click", openDocEditor);
  els.dDocHint.addEventListener("click", openDocEditor);
  document.getElementById("d-doc-done")!.addEventListener("click", closeDocEditor);
  document.getElementById("d-doc-clear")!.addEventListener("click",
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
  els.ctxBtn = document.getElementById("ctx-btn") as HTMLButtonElement;
  els.ctxPanel = document.getElementById("ctx-panel")!;
  els.ctxBody = document.getElementById("ctx-panel-body")!;
  if (document.body.dataset.debug === "true" && els.ctxBtn) {
    els.ctxBtn.hidden = false;
    els.ctxBtn.addEventListener("click", showCtx);
    document.getElementById("ctx-close")!
      .addEventListener("click", () => { els.ctxPanel.hidden = true; });
  }

  const katex = await awaitKatex();
  if (!katex) { showError(els.panelBrowse, "Math renderer failed to load."); return; }

  try {
    await loadCatalog(false);
  } catch (e) {
    showError(els.panelBrowse, `Could not load the proof catalog: ${(e as Error).message}`);
    return;
  }

  renderBrowse(catalog);
  els.search.addEventListener("input", () => renderBrowse(filterCatalog(els.search.value)));

  // Deliberate opt-in: also list pending submissions (badged "under review").
  els.showReview = document.getElementById("show-review") as HTMLInputElement;
  els.showReview.addEventListener("change", async () => {
    try { await loadCatalog(els.showReview.checked); } catch (e) { return; /* keep the current list */ }
    renderBrowse(filterCatalog(els.search.value));
  });

  // Deep-link: ?id=<domain>/<name> opens that proof on load.
  const deep = params().get("id");
  if (deep && ID_RE.test(deep)) openProof(deep);

  // Prefill: /prove?draft=<docid> (DEBUG only) seeds the Derive tab from a local
  // draft. Runs after the deep-link so an explicit ?draft wins the active tab.
  applyDeriveDraft();
}

main();
