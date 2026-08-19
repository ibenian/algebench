import { d as CODE_ICON, i as persistTheme, n as applyTheme$1, o as validateProofData, p as FULLSCREEN_ICON, r as initialTheme, s as ProofAnimator, t as THEMES, u as BRACES_ICON } from "./theme.js";
//#region src/renderproof.ts
var SLUG_RE = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;
var loadedProofs = [];
var MAX_PROOFS = 12;
var MAX_BYTES = 2e6;
var PERSISTABLE_THEMES = new Set([...THEMES].filter((t) => t !== "auto"));
var root = document.getElementById("root");
/** Collect + validate the builtin slugs from the query string. */
function parseBuiltins() {
	const params = new URLSearchParams(location.search);
	const raw = [];
	for (const v of params.getAll("builtin")) for (const part of v.split(",")) {
		const s = part.trim();
		if (s) raw.push(s);
	}
	const valid = [];
	const bad = [];
	for (const s of raw) if (SLUG_RE.test(s) && !s.includes("..")) valid.push(s);
	else bad.push(s);
	return {
		valid: valid.slice(0, MAX_PROOFS),
		bad,
		overflow: valid.length > MAX_PROOFS
	};
}
/** Canonical precedence with one caveat: keep an explicit ?theme=auto raw so
*  the page can continue tracking OS changes live while open; collapsing auto
*  to dark/light on load would freeze that mode for the rest of the session. */
function loadTheme() {
	const t = new URLSearchParams(location.search).get("theme");
	if (THEMES.has(t)) return t;
	return initialTheme({ param: null });
}
var _currentTheme = "dark";
/** Apply a theme to the live page (the engine + chrome read it off CSS vars). */
function applyTheme(t) {
	_currentTheme = t;
	applyTheme$1(t);
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
	if (_currentTheme === "auto") applyTheme("auto");
});
window.addEventListener("message", (e) => {
	const data = e.data;
	if (e.source === window.parent && data && data.type === "algebench-embed-theme" && THEMES.has(data.theme)) applyTheme(data.theme);
});
/** Build the embeddable URL. The origin comes from wherever this page is served,
*  so the snippet is environment-specific (localhost in dev, the real host in prod). */
function buildEmbedUrl(builtins, theme) {
	const u = new URL("/renderproof", location.origin);
	for (const b of builtins) u.searchParams.append("builtin", b);
	u.searchParams.set("theme", theme);
	return u.toString();
}
function embedSnippet(url) {
	return `<iframe src="${url}" width="100%" height="600" style="border:0;background:transparent" loading="lazy" title="AlgeBench proof animation" data-algebench-embed></iframe>\n<!-- optional: auto-fits the height to the proof; remove to keep a fixed height -->\n<script src="${new URL(url).origin}/dist/embed-resizer.js" async><\/script>`;
}
/** When embedded, report our content height to the host page so its resizer can
*  size the iframe to fit (no top/bottom dead space; adapts as steps change height). */
function setupEmbedAutoResize() {
	const wrap = document.querySelector(".wrap");
	let last = 0;
	const measure = () => wrap ? Math.ceil(wrap.getBoundingClientRect().bottom + window.scrollY + 2) : Math.ceil(document.documentElement.scrollHeight);
	const post = (force) => {
		const h = measure();
		if (!force && Math.abs(h - last) < 2) return;
		last = h;
		try {
			parent.postMessage({
				type: "algebench-embed-height",
				height: h
			}, "*");
		} catch (e) {}
	};
	if (window.ResizeObserver && wrap) new ResizeObserver(() => post()).observe(wrap);
	window.addEventListener("message", (e) => {
		const data = e.data;
		if (e.source === window.parent && data && data.type === "algebench-embed-request") post(true);
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
	div.textContent = msg;
	container.appendChild(div);
}
/** Wait for the deferred KaTeX classic script to define window.katex. */
async function awaitKatex() {
	for (let i = 0; i < 150 && !window.katex; i++) await new Promise((r) => setTimeout(r, 30));
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
			try {
				txt = JSON.stringify(JSON.parse(p.text), null, 2);
			} catch (e) {}
			const pre = document.createElement("pre");
			pre.textContent = txt;
			body.appendChild(pre);
		}
	};
	const hide = () => modal.classList.remove("open");
	btn.addEventListener("click", () => {
		render();
		modal.classList.add("open");
	});
	close.addEventListener("click", hide);
	modal.addEventListener("click", (e) => {
		if (e.target === modal) hide();
	});
	window.addEventListener("keydown", (e) => {
		if (e.key === "Escape") hide();
	});
}
/** The < > button: opens the embed modal — a theme picker (updates the live page
*  and the snippet), Preview, Copy, and the copyable iframe snippet. Shown in both
*  views so a reader of an embed can grab the script to re-share it. */
function setupEmbedButton(builtins, theme, { persist = false } = {}) {
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
	const refresh = () => {
		code.value = embedSnippet(buildEmbedUrl(builtins, sel.value));
	};
	refresh();
	const hide = () => modal.classList.remove("open");
	btn.addEventListener("click", () => {
		refresh();
		modal.classList.add("open");
		code.focus();
		code.select();
	});
	close.addEventListener("click", hide);
	modal.addEventListener("click", (e) => {
		if (e.target === modal) hide();
	});
	window.addEventListener("keydown", (e) => {
		if (e.key === "Escape") hide();
	});
	sel.addEventListener("change", () => {
		if (persist && PERSISTABLE_THEMES.has(sel.value)) persistTheme(sel.value);
		applyTheme(sel.value);
		refresh();
		code.focus();
		code.select();
	});
	previewBtn.addEventListener("click", () => {
		const w = window.open("", "_blank");
		if (!w) return;
		w.document.open();
		w.document.write(previewPageHtml(buildEmbedUrl(builtins, sel.value), sel.value));
		w.document.close();
	});
	copyBtn.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(code.value);
		} catch {
			code.focus();
			code.select();
			try {
				document.execCommand("copy");
			} catch (e) {}
		}
		copied.hidden = false;
		setTimeout(() => {
			copied.hidden = true;
		}, 1500);
	});
}
/** Where the full-screen button opens, per the host-supplied ?fullscreenTarget= option:
*  • ?fullscreenTarget=prove → the editable /prove page for the FIRST proof (?id=<slug>);
*  • otherwise               → this standalone renderproof page (the default).
*  The destination is the host page's call — it's not part of the embedded
*  widget — so it's chosen here from the URL the host framed the iframe with. */
function fullscreenTarget(builtins, theme) {
	if ((new URLSearchParams(location.search).get("fullscreenTarget") || "").trim().toLowerCase() === "prove" && builtins.length) {
		const u = new URL("/prove", location.origin);
		u.searchParams.set("id", builtins[0]);
		u.searchParams.set("theme", theme);
		return {
			url: u.toString(),
			label: "Open on the Prove page"
		};
	}
	return {
		url: location.href,
		label: "Open full screen"
	};
}
/** Wire the control bar: { } JSON viewer and < > embed dialog (both views), plus a
*  full-screen icon only when embedded (top-level is already full screen). */
function setupControlBar(builtins, theme) {
	setupJsonButton();
	const embedded = window.self !== window.top;
	setupEmbedButton(builtins, theme, { persist: !embedded });
	if (embedded) {
		const { url, label } = fullscreenTarget(builtins, theme);
		const btn = document.getElementById("pa-action");
		btn.classList.add("pa-icon-btn");
		btn.title = label;
		btn.setAttribute("aria-label", label);
		btn.innerHTML = FULLSCREEN_ICON;
		btn.hidden = false;
		btn.addEventListener("click", () => window.open(url, "_blank", "noopener"));
	}
}
async function main() {
	const embedded = window.self !== window.top;
	if (embedded) document.documentElement.dataset.embedded = "1";
	const theme = loadTheme();
	applyTheme(theme);
	const exploreFollowups = ![
		"0",
		"false",
		"no"
	].includes((new URLSearchParams(location.search).get("explore") || "").trim().toLowerCase());
	const termAsk = [
		"1",
		"true",
		"yes"
	].includes((new URLSearchParams(location.search).get("ai") || "").trim().toLowerCase());
	const stacked = [
		"1",
		"true",
		"yes"
	].includes((new URLSearchParams(location.search).get("stacked") || "").trim().toLowerCase());
	const autoplayRaw = (new URLSearchParams(location.search).get("autoplay") || "").trim().toLowerCase();
	const { valid, bad, overflow } = parseBuiltins();
	setupControlBar(valid, theme);
	if (bad.length) showError(root, `Ignored invalid proof id(s): ${bad.join(", ")} — expected <domain>/<name>.`);
	if (overflow) showError(root, `Too many proofs requested; showing the first ${MAX_PROOFS}.`);
	if (!valid.length) {
		showError(root, "No proof to show. Add ?builtin=<domain>/<name> to the URL.");
		return;
	}
	const katex = await awaitKatex();
	if (!katex) {
		showError(root, "Math renderer failed to load.");
		return;
	}
	const paBar = document.querySelector(".pa-bar");
	window.__animators = [];
	let firstCard = true;
	for (const slug of valid) {
		const title = document.createElement("h2");
		title.className = "pa-card-title";
		const titleText = document.createElement("span");
		titleText.className = "pa-card-title-text";
		titleText.textContent = slug;
		title.appendChild(titleText);
		const card = document.createElement("div");
		if (firstCard && !embedded && paBar) {
			const row = document.createElement("div");
			row.className = "pa-title-row";
			row.appendChild(title);
			row.appendChild(paBar);
			root.appendChild(row);
		} else root.appendChild(title);
		firstCard = false;
		root.appendChild(card);
		try {
			const resp = await fetch(`/proofs/domains/${slug}.json`, { cache: "no-store" });
			if (!resp.ok) throw new Error(`not found (${resp.status})`);
			const len = Number(resp.headers.get("content-length") || 0);
			if (len && len > MAX_BYTES) throw new Error("proof file too large");
			const text = await resp.text();
			if (text.length > MAX_BYTES) throw new Error("proof file too large");
			loadedProofs.push({
				slug,
				text
			});
			const data = validateProofData(JSON.parse(text));
			if (data.title) titleText.textContent = data.title;
			window.__animators.push(new ProofAnimator(card, data, {
				katex,
				liveTerms: true,
				enableExplore: exploreFollowups,
				enableTermAsk: termAsk,
				stacked
			}));
		} catch (e) {
			showError(card, `Could not load "${slug}": ${e.message}`);
		}
	}
	if (autoplayRaw && ![
		"0",
		"false",
		"no"
	].includes(autoplayRaw)) {
		const playAll = [
			"true",
			"all",
			"yes"
		].includes(autoplayRaw);
		const n = Number.parseInt(autoplayRaw, 10);
		const targets = playAll ? window.__animators : String(n) === autoplayRaw && n >= 1 ? [window.__animators[n - 1]] : [];
		for (const a of targets) if (a) try {
			a.play();
		} catch (e) {}
	}
	if (embedded) setupEmbedAutoResize();
}
main();
//#endregion

//# sourceMappingURL=renderproof.js.map