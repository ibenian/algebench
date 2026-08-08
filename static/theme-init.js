// Pre-paint theme stamp for the main app (index.html). Classic script, zero
// imports, loaded synchronously in <head> BEFORE tokens.css so <html> carries
// data-theme by first paint (no dark→light flash). /prove and /renderproof get
// the same effect via server-side attribute stamping instead.
//
// Mirrors theme.js#initialTheme (URL param → stored preference → dark), but
// can't import it: module scripts are deferred, which defeats pre-paint.
(function () {
  var t = null;
  try { t = new URLSearchParams(location.search).get("theme"); } catch (e) { /* no URL API */ }
  if (t !== "dark" && t !== "light" && t !== "auto") {
    try { t = localStorage.getItem("algebench-theme"); } catch (e) { t = null; }
  }
  if (t === "auto") {
    t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  document.documentElement.dataset.theme = (t === "light") ? "light" : "dark";
})();
