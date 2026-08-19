// Pre-paint theme stamp for the main app (index.html). Classic script, zero
// imports, loaded synchronously in <head> BEFORE tokens.css so <html> carries
// data-theme by first paint (no dark→light flash). /prove and /renderproof get
// the same effect via server-side attribute stamping instead.
//
// Mirrors theme.ts#initialTheme (URL param → stored preference → dark), but
// can't import it: module scripts are deferred, which defeats pre-paint.
//
// "Classic script" is a statement about the OUTPUT, not the source. This is a
// Vite entry like any other (vite.config.mts) — TypeScript, type-checked with
// the rest of the frontend, emitted as a bare IIFE (it has no imports to
// bundle) to static/dist/theme-init.js and loaded from /dist/theme-init.js,
// which also gets it ?v=<version> cache-busting from the appVersion plugin.
//
// It is NOT on SERVER_SERVED: that list is for paths the Python server owns
// and Vite must leave alone, and this is an ordinary build artifact.
(function () {
  var t: string | null = null, p: string | null = null;
  try {
    var q = new URLSearchParams(location.search);
    t = q.get("theme");
    p = q.get("palette");
  } catch (e) { /* no URL API */ }
  if (t !== "dark" && t !== "light" && t !== "auto") {
    try { t = localStorage.getItem("algebench-theme"); } catch (e) { t = null; }
  }
  if (t === "auto") {
    t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  document.documentElement.dataset.theme = (t === "light") ? "light" : "dark";

  // EXPERIMENTAL palette variants (see tokens.css). ?palette=blueprint|sepia
  // applies and persists; ?palette=slate (the default) resets.
  var PALETTES = ["blueprint", "sepia", "plum", "cerulean", "graphite", "contrast"];
  if (p === "slate" || p === "default") {
    try { localStorage.removeItem("algebench-palette"); } catch (e) {}
    p = null;
  } else if (PALETTES.indexOf(p!) !== -1) {
    try { localStorage.setItem("algebench-palette", p!); } catch (e) {}
  } else {
    try { p = localStorage.getItem("algebench-palette"); } catch (e) { p = null; }
  }
  // `p!` twice — guarded by the indexOf test, which TypeScript does not use to
  // narrow. Kept as indexOf (not `includes`) so the emitted JS is unchanged.
  if (PALETTES.indexOf(p!) !== -1) document.documentElement.dataset.palette = p!;
})();
