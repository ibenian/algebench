// Shared UI icons + glyphs, used by /prove, /renderproof, and the main app
// (and, via the /renderproof embeds, the blog showcase pages).
//
// The SVG icons are static, author-controlled markup (no user data) — safe to
// assign via innerHTML. 14×14, drawn with currentColor (stroked, or filled for
// the avatar glyphs) so they inherit the element's text color in either theme.
// The theme glyphs are plain Unicode text (matching the blog toggles). Sourcing
// them here keeps every surface identical rather than copying strings per page.

/** Theme-toggle glyphs — plain text Unicode, matching the blog's ☾/☀ toggles.
 *  Shared by the /prove + theme.js toggle and the semantic-graph mode toggle.
 *  (No U+FE0E variation selector — the blog renders these bare and looks right.) */
export const MOON_GLYPH = "☾";   // ☾ shown in dark mode
export const SUN_GLYPH = "☀";    // ☀ shown in light mode

/** { } View proof JSON. */
export const BRACES_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/>' +
  '<path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/></svg>';

/** < > Get embed script. */
export const CODE_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M8 6l-6 6 6 6"/><path d="M16 6l6 6-6 6"/></svg>';

/** ⛶ Open full screen (the embedded proof's pop-out control). */
export const FULLSCREEN_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';

/** AI — a bot/assistant head, for marking AI (chat) messages. Stroke outline in
 *  the same 14×14 style as the toolbar icons; eyes + antenna tip are filled dots. */
export const AI_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="4.5" y="7" width="15" height="12" rx="3"/><path d="M12 3v4"/>' +
  '<circle cx="12" cy="3" r="1.1" fill="currentColor" stroke="none"/>' +
  '<circle cx="9.5" cy="13" r="1.2" fill="currentColor" stroke="none"/>' +
  '<circle cx="14.5" cy="13" r="1.2" fill="currentColor" stroke="none"/></svg>';

/** User — a filled person silhouette, for marking the user's (chat) messages. */
export const USER_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">' +
  '<circle cx="12" cy="8" r="4"/>' +
  '<path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/></svg>';

// ── 3D-view chrome + player controls (main app viewport) ────────────────────
// Sized to their buttons (17–18px) rather than the 14px toolbar set. The two
// view-chrome icons keep their original 1.8-weight stroke so they look unchanged.

/** Angle-lock toggle for the follow camera (a looping arrow). */
export const ANGLE_LOCK_ICON =
  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M14.22 5.89A6.5 6.5 0 1 1 9.78 5.89"/><path d="M6.98 5.89 9.78 5.89 8.56 8.41"/></svg>';

/** Share this exact view (an eye) — copies a camera-anchored deep link. */
export const SHARE_VIEW_ICON =
  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M2 12C5 6.5 19 6.5 22 12C19 17.5 5 17.5 2 12Z"/><circle cx="12" cy="12" r="3.6"/>' +
  '<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>';

/** ⚙ Display settings (a cog). */
export const GEAR_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="3.2"/>' +
  '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

/** ‹ Previous (chevron-left) — one step back. */
export const PREV_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M14.5 5l-7 7 7 7"/></svg>';

/** › Next (chevron-right) — one step forward. */
export const NEXT_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M9.5 5l7 7-7 7"/></svg>';

/** ▶ Play (a filled triangle). */
export const PLAY_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">' +
  '<path d="M7 5l12 7-12 7z"/></svg>';

/** ⏸ Pause (two filled bars). */
export const PAUSE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">' +
  '<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/></svg>';

/** |‹ First (skip to start) — a bar + a left triangle. */
export const FIRST_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M18 6l-8 6 8 6z" stroke="none"/><path d="M7 6v12" fill="none"/></svg>';

/** ›| Last (skip to end) — a right triangle + a bar. */
export const LAST_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M6 6l8 6-8 6z" stroke="none"/><path d="M17 6v12" fill="none"/></svg>';
