// Ambient declarations for the libraries AlgeBench loads as CDN globals, and
// for the small set of first-party globals the converted modules touch.
//
// These libraries are NOT bundled — index.html/prove.html/renderproof.html load
// them as classic <script> tags from jsdelivr, so at runtime they are plain
// globals. The matching npm packages are dev-only devDependencies, installed
// solely so `typeof import(...)` can borrow their types; nothing here reaches
// the browser.
//
// These four are pinned EXACTLY in package.json — no caret. A caret would let
// `npm update` pull types a minor ahead of the CDN bundle (mathjs ^13.0.0
// reaches 13.2.3, marked ^12.0.0 reaches 12.0.2), which types the code against
// APIs the page never loaded: it compiles, then fails at runtime. Bump these
// only together with the corresponding <script> tag in the HTML.
//
//   three   0.137.0   @types/three@0.137.0   (index.html)
//   katex   0.16.9    @types/katex@0.16.8    (all three pages)
//   marked  12.0.0    bundled types          (index.html, prove.html)
//   mathjs  13.0.0    bundled types          (index.html)
//
// @types/katex is one patch behind on purpose: 0.16.8 is the newest published,
// and a KaTeX patch release adds no API.
//
// MathBox (2.3.1) is deliberately absent: it has no published types and its
// chained-builder API needs a hand-written declaration. Nothing converted so
// far touches it — it arrives with the modules that actually drive it.

/** three.js, loaded from CDN as a global (index.html). */
declare const THREE: typeof import('three');

/** KaTeX, loaded from CDN as a global on every page. */
declare const katex: typeof import('katex');

/** Marked, loaded from CDN as a global (index.html, prove.html). */
declare const marked: typeof import('marked');

/** math.js, loaded from CDN as a global (index.html). */
declare const math: typeof import('mathjs');

/**
 * A domain library's exported functions, as registered by
 * static/domains/<name>/index.js. `_init` is an optional lifecycle hook the
 * expression sandbox calls once with scene accessors; every other key is a
 * function callable from scene expressions.
 */
interface AlgeBenchDomainFunctions {
  _init?: (api: { getSlider(id: string, fallback?: number): number }) => void;
  [fn: string]: unknown;
}

/**
 * Domain library registry (src/main.js). Domains are injected as <script> at
 * runtime from a URL built out of lesson data, so they can never be bundled —
 * they self-register onto this global.
 */
interface AlgeBenchDomainRegistry {
  _registry: Record<string, AlgeBenchDomainFunctions | undefined>;
  register(name: string, functions: AlgeBenchDomainFunctions): void;
}

interface Window {
  AlgeBenchDomains: AlgeBenchDomainRegistry;
  katex: typeof katex;
  marked: typeof marked;
  /**
   * Every ProofAnimator the /renderproof page built, in card order
   * (src/renderproof.ts). A debugging handle, and how autoplay reaches the
   * animators after the load loop has finished.
   */
  __animators: import('/proof-animation/proof-animation.js').ProofAnimator[];
}

// ── Globals defined by static/chat.js ────────────────────────────────────────
// chat.js is still a classic, non-module script (it becomes a module in phase
// 4), so modules reach these as bare globals behind `typeof … === 'function'`
// guards — the page can load without chat.js and the guards must stay honest.

/** Switch the right-hand panel to a named tab (chat.js:268). */
declare function switchPanelTab(tabName: string): void;

/** Send a message to the AI chat (chat.js:447). */
declare function sendChatMessage(text: string, opts?: { silent?: boolean }): Promise<void>;
