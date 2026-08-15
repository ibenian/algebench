// Ambient declarations for the libraries AlgeBench loads as CDN globals, and
// for the small set of first-party globals the converted modules touch.
//
// These libraries are NOT bundled — index.html/prove.html/renderproof.html load
// them as classic <script> tags from jsdelivr, so at runtime they are plain
// globals. The matching npm packages are dev-only devDependencies, installed
// solely so `typeof import(...)` can borrow their types; nothing here reaches
// the browser.
//
// Versions are pinned to whatever the HTML actually loads — a mismatch here
// types the code against an API the page never had:
//
//   three   0.137.0   @types/three@0.137.0   (index.html)
//   katex   0.16.9    @types/katex           (all three pages)
//   marked  12.0.0    bundled types          (index.html, prove.html)
//   mathjs  13.0.0    bundled types          (index.html)
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
}
