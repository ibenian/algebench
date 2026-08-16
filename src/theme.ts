// Shared dark/light theme helpers for the same-origin ES-module pages
// (/prove, /renderproof). No side effects on load.
//
// The blog pages (docs/landing-page/**) deliberately keep their own inline
// theme snippet: their pre-paint handler must run BEFORE first paint (a module
// script is deferred, so it can't), and in production the blog is a separate
// origin from the app. This module is for the app's module pages only.

import { MOON_GLYPH, SUN_GLYPH } from "/icons.js";

/** A concrete, paintable theme. */
export type Theme = "dark" | "light";
/** A theme preference, where "auto" defers to the OS. */
export type ThemeChoice = Theme | "auto";

export const THEMES = new Set<string>(["dark", "light", "auto"]);
// Shared with the blog + main app so a light/dark choice carries across pages.
export const THEME_KEY = "algebench-theme";

/** Resolve "auto" to a concrete dark|light via the OS; pass the rest through. */
export function resolveTheme(t: ThemeChoice): Theme {
  if (t === "auto") return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return t === "light" ? "light" : "dark";
}

/** Paint a theme (concrete or "auto") onto <html data-theme>. The engine,
 *  page chrome, and modals all read it off CSS vars, so this recolors live. */
export function applyTheme(t: ThemeChoice): void {
  document.documentElement.dataset.theme = resolveTheme(t);
}

/** The saved light|dark preference, or null (storage can throw when blocked). */
export function storedTheme(key: string = THEME_KEY): Theme | null {
  try {
    const t = localStorage.getItem(key);
    return (t === "dark" || t === "light") ? t : null;
  } catch (e) { return null; }
}

/** Persist a preference (best-effort; storage can be blocked). */
export function persistTheme(t: ThemeChoice, key: string = THEME_KEY): void {
  try { localStorage.setItem(key, t); } catch (e) { /* blocked storage */ }
}

/** Canonical load precedence across app surfaces:
 *  URL param override (allowlisted) → saved localStorage preference → fallback.
 *  If the chosen value is "auto", resolve it against the OS as the final step. */
export function initialTheme({
  key = THEME_KEY,
  param = "theme",
  fallback = "dark",
  useStored = true,
}: {
  key?: string;
  // `null` opts out of reading a URL param at all — renderproof.ts passes it to
  // get "saved preference → fallback" while handling ?theme= itself.
  param?: string | null;
  fallback?: ThemeChoice;
  useStored?: boolean;
} = {}): Theme {
  // The URL param arrives as string|null; THEMES.has is the allowlist that
  // makes narrowing it to ThemeChoice sound.
  const raw = param ? new URLSearchParams(location.search).get(param) : null;
  const t: ThemeChoice = (raw !== null && THEMES.has(raw))
    ? (raw as ThemeChoice)
    : (useStored && storedTheme(key)) || fallback;
  return resolveTheme(t);
}

/** Wire a header toggle button: flip dark<->light, persist it, and repaint the
 *  glyph (☾ in dark, ☀ in light). Calls onChange(next) after each flip. Returns
 *  the repaint fn so callers can re-sync the glyph (e.g. on an OS-theme change). */
export function wireThemeToggle(
  btn: HTMLElement | null | undefined,
  { key = THEME_KEY, onChange }: { key?: string; onChange?: (next: Theme) => void } = {},
): () => void {
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
