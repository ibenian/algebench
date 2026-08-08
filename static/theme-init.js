// Pre-paint theme stamp for the main app (index.html). Classic script, zero
// imports, loaded synchronously in <head> BEFORE tokens.css so <html> carries
// data-theme by first paint (no dark→light flash). /prove and /renderproof get
// the same effect via server-side attribute stamping instead.
//
// Mirrors theme.js#initialTheme (URL param → stored preference → dark), but
// can't import it: module scripts are deferred, which defeats pre-paint.
(function () {
  var t = null, p = null;
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
  var PALETTES = ["blueprint", "sepia"];
  if (p === "slate" || p === "default") {
    try { localStorage.removeItem("algebench-palette"); } catch (e) {}
    p = null;
  } else if (PALETTES.indexOf(p) !== -1) {
    try { localStorage.setItem("algebench-palette", p); } catch (e) {}
  } else {
    try { p = localStorage.getItem("algebench-palette"); } catch (e) { p = null; }
  }
  if (PALETTES.indexOf(p) !== -1) document.documentElement.dataset.palette = p;
})();
