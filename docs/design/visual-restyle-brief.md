# AlgeBench Visual Restyle — Design Brief

Direction: **"Slate & Graph Paper"** — the material world of a mathematics lecture.
Dark theme is a chalkboard slate; light theme is engineering graph paper. Panels are
flat, print-like theorem boxes, not glass. One accent, used with intent.

This brief is the spec for `static/tokens.css`. Every color/type/motion decision in the
migration derives from here.

## Subject grounding

AlgeBench teaches mathematics through live, CAS-verified derivations and 3D scenes.
Its audience is learners who care about rigor (grounding tiers, predict-before-reveal).
The subject's own artifacts — chalkboards, graph paper, textbook theorem boxes,
worked margins, KaTeX/Computer Modern notation — are the source of every choice below.
The 3D viewport and the morphing derivation are the hero; the chrome around them should
read as the *board and paper* they're worked on, and otherwise stay quiet.

## Pass 1 — Token plan

### Palette (named values)

| Name | Dark ("Slate Lecture") | Light ("Graph Paper") | Role |
|---|---|---|---|
| Slate / Paper | `#161c19` | `#f3f4ee` | page background (`--page-bg`) |
| Board / Card | `#1e2621` | `#fbfcf8` | panel surface (`--panel-bg`) |
| Chalk / Ink | `#e8e6da` | `#253029` | text (`--text-color`) |
| Dust / Graphite | `#97a29a` | `#68726b` | muted text (`--muted-color`) |
| Ochre | `#d9a441` | `#9a6d1c` | the accent (`--accent-color`) — chalk yellow / marking pencil |
| Clay | `#c9705f` | `#a8503f` | error/destructive (`--err-fg`) |

- Borders: ink/chalk at low alpha (`--border-color`), never a third hue.
- Grid lines (signature): text color at ~4–5% alpha.
- Scrim: `rgba(10,14,12,0.55)` dark / `rgba(37,48,41,0.35)` light (`--scrim`).
- Math (`--math-fg`): full text color — KaTeX stops being lavender; notation is ink, not decoration.
- No gradients as panel paint. No backdrop blur. The green-black slate replaces
  navy/indigo entirely.

### Typography

| Role | Face | Weights | Sourcing (.woff2, OFL, vendored to `static/fonts/`) |
|---|---|---|---|
| Display (`--font-display`) | **Zilla Slab** | 500, 600 | Fontsource files via jsDelivr |
| Body/UI (`--font-body`) | **Inter** | 400 (+italic), 600, 700 | Fontsource files via jsDelivr |
| Mono (`--font-mono`) | **IBM Plex Mono** | 400, 500 | Fontsource files via jsDelivr |

- Zilla Slab: slab letterforms with a chalk-on-board weight — headings, panel titles,
  section eyebrows. Used with restraint (titles only), never body copy.
- Inter: user-selected (over Atkinson Hyperlegible / Instrument Sans / Schibsted
  Grotesk specimens) as the neutral UI/body face. Because Inter is the common AI
  default, the *rest* of the system — slate/ochre palette, slab display, theorem-box
  elevation, graph-grid signature — carries the distinctiveness; Inter stays a quiet
  delivery vehicle at 12.5–14px.
- IBM Plex Mono replaces every `'SF Mono', 'Fira Code'` stack: expressions, code, IDs.
- Type scale (px): 11 (fine print) / 12.5 (UI) / 14 (body) / 16 / 20 (panel title) /
  26 (page title). Display faces get `letter-spacing: 0.01em`; eyebrows are
  11px Zilla 600, uppercase, `letter-spacing: 0.08em`.

### Space, shape, elevation

- Spacing scale: `--space-1..6` = 4 / 8 / 12 / 16 / 24 / 32 px. No ad-hoc values in new code.
- Radius: `--radius-sm: 4px` (controls), `--radius-md: 8px` (panels/cards), `--radius-full`
  (tier badges only). No pill buttons.
- Elevation = **print, not glow.** Three levels replace the ~21 gradients + 49 shadows:
  - `--surface` — flat `--panel-bg` + 1px `--border-color`. Default for every panel/toolbar.
  - `--surface-raised` — same + `--shadow-sm` (hard, short: dark `0 2px 0 rgba(0,0,0,.35)`,
    light `0 2px 0 rgba(37,48,41,.10)`). Dropdowns, hovering cards.
  - `--surface-overlay` — same + `--shadow-lg` (dark `0 12px 32px rgba(0,0,0,.45)`,
    light `0 12px 32px rgba(37,48,41,.16)`) + `--scrim` behind. Modals only.
  - Focus ring: 2px `--accent-color` outline with 2px offset — functional, never removed.

### Motion

- Tokens: `--dur-quick: 140ms`, `--dur-slow: 260ms`, `--ease: cubic-bezier(.2,.7,.3,1)`.
- One orchestrated moment: page-load panels rise 6px + fade, 40ms stagger. Everything
  else is hover/focus at `--dur-quick`. No scattered decorative animation.
- `prefers-reduced-motion: reduce` collapses all of it (currently one lone rule; the
  token file makes it global).

### Signature

The 3px ochre **chalk rule** under active panel titles and selected tabs. That is the
one place the design is loud; everything else is disciplined.
(An earlier graph-grid page background was tried and removed at the user's request —
solid `--page-bg` surfaces won.)

### Semantic-graph themes

`themes/semantic-graph/{default-dark,default-light,linalg-dark}.json` are aligned to
this palette: sage green for values, slate blue for operators/functions, ochre for
relations/results, clay for direct edges, dust for neutral. Shapes and directions
unchanged. The other theme files (blueprint, textbook, neon, minimal) remain
deliberate alternative styles.

## Pass 2 — Critique against the defaults

Checked against the three AI-default looks and the current app:

1. *Warm cream + serif display + terracotta*: the light theme deliberately uses a **cool**
   green-tinted paper (`#f3f4ee`, not `#F4F1EA`-warm), green-black ink, slab (not
   high-contrast serif) display, ochre (not terracotta). The repo's blog already owns the
   warm-paper look; the app must not clone it.
2. *Near-black + single acid accent*: dark is slate **green** with warm chalk text and a
   muted ochre — no pure black, no acid green/vermilion.
3. *Broadsheet/hairline/zero-radius*: we keep 4/8px radii, theorem-box borders, and
   generous panel padding — textbook, not newspaper.
4. *Current glassmorphism* (the thing being removed): zero panel gradients, zero
   backdrop-blur, shadows are hard and short, one accent family instead of 26 indigo rgba
   variants.

Revisions made in critique: initial idea had a second "chalk blue" accent — cut (spend
boldness once; ochre alone). Initial light bg was warmer — cooled to avoid default #1.
Chalk-dust texture idea — cut as gimmick; the grid carries the signature alone.

## Out of scope

- 3D scene object colors and `themes/semantic-graph/*.json` node/edge themes.
- Landing page / blog (keeps its own paper identity).
