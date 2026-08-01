// Shared dark/light theme helpers for the same-origin ES-module pages
// (/prove, /renderproof). No side effects on load.
//
// The blog pages (docs/landing-page/**) deliberately keep their own inline
// theme snippet: their pre-paint handler must run BEFORE first paint (a module
// script is deferred, so it can't), and in production the blog is a separate
// origin from the app. This module is for the app's module pages only.

import { MOON_GLYPH, SUN_GLYPH } from "/icons.js";

export const THEMES = new Set(["dark", "light", "auto"]);
// Shared with the blog + main app so a light/dark choice carries across pages.
export const THEME_KEY = "algebench-theme";

/** Resolve "auto" to a concrete dark|light via the OS; pass the rest through. */
export function resolveTheme(t) {
  if (t === "auto") return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return t === "light" ? "light" : "dark";
}

/** Paint a theme (concrete or "auto") onto <html data-theme>. The engine,
 *  page chrome, and modals all read it off CSS vars, so this recolors live. */
export function applyTheme(t) {
  document.documentElement.dataset.theme = resolveTheme(t);
}

/** The saved light|dark preference, or null (storage can throw when blocked). */
export function storedTheme(key = THEME_KEY) {
  try {
    const t = localStorage.getItem(key);
    return (t === "dark" || t === "light") ? t : null;
  } catch (e) { return null; }
}

/** Persist a preference (best-effort; storage can be blocked). */
export function persistTheme(t, key = THEME_KEY) {
  try { localStorage.setItem(key, t); } catch (e) { /* blocked storage */ }
}

/** Canonical load precedence across app surfaces:
 *  URL param override (allowlisted) → saved localStorage preference → fallback.
 *  If the chosen value is "auto", resolve it against the OS as the final step. */
export function initialTheme({ key = THEME_KEY, param = "theme", fallback = "dark", useStored = true } = {}) {
  let t = param ? new URLSearchParams(location.search).get(param) : null;
  if (!THEMES.has(t)) t = (useStored && storedTheme(key)) || fallback;
  return resolveTheme(t);
}

/** Wire a header toggle button: flip dark<->light, persist it, and repaint the
 *  glyph (☾ in dark, ☀ in light). Calls onChange(next) after each flip. Returns
 *  the repaint fn so callers can re-sync the glyph (e.g. on an OS-theme change). */
export function wireThemeToggle(btn, { key = THEME_KEY, onChange } = {}) {
  if (!btn) return () => {};
  const paint = () => {
    const cur = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    btn.textContent = cur === "dark" ? MOON_GLYPH : SUN_GLYPH;   // show the current theme (sun = light)
    btn.title = "Switch to " + (cur === "dark" ? "light" : "dark") + " theme";
    btn.setAttribute("aria-label", btn.title);
  };
  paint();
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    persistTheme(next, key);
    paint();
    if (onChange) onChange(next);
  });
  return paint;
}
