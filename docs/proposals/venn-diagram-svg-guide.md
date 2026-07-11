# SVG Venn Diagram Reference Guide

> Visual-language reference for the interactive Venn diagram feature — see [#456](https://github.com/ibenian/algebench/issues/456) (interactive Venn diagram visualization for set-operation nodes in the semantic graph).

This guide provides copy-paste SVG templates for Venn diagrams: region colors, the "included / excluded" semantics, and the `clipPath`-for-overlap technique. It defines the visual language the semantic-graph Venn overlay should follow. All diagrams render inline in HTML.

---

## Architecture

Every Venn diagram follows the same layered structure:

```
1. Container <div>     — centers the SVG, sets margin
2. <svg> element        — viewBox, max-width, font-family
3. Title + subtitle     — <text> elements at top
4. Universe box         — dashed <rect> bounding box
5. Circles A and B      — two overlapping <circle> elements
6. Overlap highlight    — <clipPath> + clipped <circle> for A ∩ B
7. Labels               — <text> elements in each region
8. Legend               — colored <rect> + <text> at bottom
```

### Key Technique: clipPath for Overlap

The overlap region is rendered by clipping circle B to the shape of circle A:

```xml
<!-- Define clip region as circle A -->
<clipPath id="my-clipA">
  <circle cx="280" cy="215" r="115"/>
</clipPath>
<!-- Draw circle B, but only the part inside A is visible -->
<circle cx="400" cy="215" r="115" fill="rgba(46, 204, 113, 0.55)"
        stroke="none" clip-path="url(#my-clipA)"/>
```

This creates a filled lens shape at the intersection without complex path math.

**Important**: Each `clipPath` `id` must be unique within the document. Use a prefix per diagram (e.g., `uf-clipA`, `ao-clipA`, `ds-clipA`).

---

## Standard Dimensions

| Element | Value | Notes |
|---------|-------|-------|
| viewBox | `0 0 700 400` | Standard. Use `700 420` for extra legend space |
| max-width | `700px` | Responsive with `width: 100%` |
| Circle A center | `cx="270-280"` | Left circle |
| Circle B center | `cx="400-410"` | Right circle |
| Circle radius | `r="115-120"` | Controls overlap amount |
| Circle Y center | `cy="215-225"` | Vertical center |
| Universe box | `x="40" y="62" width="620" height="295"` | Dashed border |
| Title Y | `y="28"` | Main title |
| Subtitle Y | `y="50"` | Description line |
| Legend Y | `y="365-397"` | Bottom legend items |

---

## Color Palette

### Semantic Colors

| Meaning | Fill (rgba) | Stroke (rgba) |
|---------|------------|---------------|
| **Included / Selected** (green) | `rgba(46, 204, 113, 0.4)` | `rgba(39, 174, 96, 1)` |
| **Excluded** (red) | `rgba(231, 76, 60, 0.15-0.25)` | `rgba(192, 57, 43, 0.6-0.9)` |
| **Neutral / Inactive** (grey) | `rgba(200, 200, 200, 0.15)` | `rgba(180, 180, 180, 0.6)` |
| **Group A** (blue) | `rgba(54, 162, 235, 0.15-0.25)` | `rgba(54, 162, 235, 0.6-1)` |
| **Group B** (pink/red) | `rgba(255, 99, 132, 0.15-0.25)` | `rgba(255, 99, 132, 0.6-1)` |
| **Overlap** (purple) | `rgba(153, 102, 255, 0.3-0.4)` | `rgba(153, 102, 255, 1)` |
| **Universe / Neither** (yellow) | `rgba(255, 206, 86, 0.1)` | `rgba(255, 206, 86, 0.6)` |

### Opacity Guidelines

- **Active/highlighted region**: `0.4 - 0.55`
- **Background/inactive region**: `0.1 - 0.15`
- **Overlap clipped fill**: `0.3 - 0.55` (slightly more opaque than base)
- **Text labels**: `0.7 - 1.0`
- **Excluded overlay**: `0.25 - 0.35`

---

## Templates

### Template 1: Basic Two-Set Venn (Neutral)

Two groups with distinct colors, overlap in a third color. No inclusion/exclusion semantics.

```xml
<div style="text-align: center; margin: 2em 0;">
<svg viewBox="0 0 700 400" xmlns="http://www.w3.org/2000/svg" style="max-width: 700px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <text x="350" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#333">TITLE HERE</text>
  <text x="350" y="50" text-anchor="middle" font-size="13" fill="#666">Subtitle description here.</text>
  <!-- Universe bounding box -->
  <rect x="40" y="62" width="620" height="295" rx="12" ry="12" fill="rgba(240, 240, 240, 0.5)" stroke="#aaa" stroke-width="2" stroke-dasharray="8,4"/>
  <text x="55" y="84" font-size="13" font-weight="bold" fill="#888">U (Universe)</text>
  <!-- A circle -->
  <circle cx="270" cy="215" r="115" fill="rgba(54, 162, 235, 0.25)" stroke="rgba(54, 162, 235, 1)" stroke-width="2.5"/>
  <!-- B circle -->
  <circle cx="410" cy="215" r="115" fill="rgba(255, 99, 132, 0.25)" stroke="rgba(255, 99, 132, 1)" stroke-width="2.5"/>
  <!-- Overlap highlight -->
  <clipPath id="t1-clipA">
    <circle cx="270" cy="215" r="115"/>
  </clipPath>
  <circle cx="410" cy="215" r="115" fill="rgba(153, 102, 255, 0.3)" stroke="none" clip-path="url(#t1-clipA)"/>
  <!-- Labels -->
  <text x="205" y="210" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(54, 162, 235, 1)">A</text>
  <text x="205" y="230" text-anchor="middle" font-size="12" fill="rgba(54, 162, 235, 0.8)">description</text>
  <text x="340" y="210" text-anchor="middle" font-size="13" font-weight="bold" fill="rgba(153, 102, 255, 1)">A ∩ B</text>
  <text x="340" y="228" text-anchor="middle" font-size="11" fill="rgba(153, 102, 255, 0.8)">overlap</text>
  <text x="475" y="210" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(255, 99, 132, 1)">B</text>
  <text x="475" y="230" text-anchor="middle" font-size="12" fill="rgba(255, 99, 132, 0.8)">description</text>
</svg>
</div>
```

<div style="text-align: center; margin: 2em 0;">
<svg viewBox="0 0 700 400" xmlns="http://www.w3.org/2000/svg" style="max-width: 700px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <text x="350" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#333">Template 1: Basic Two-Set Venn</text>
  <text x="350" y="50" text-anchor="middle" font-size="13" fill="#666">Neutral colors, no inclusion/exclusion semantics.</text>
  <rect x="40" y="62" width="620" height="295" rx="12" ry="12" fill="rgba(240, 240, 240, 0.5)" stroke="#aaa" stroke-width="2" stroke-dasharray="8,4"/>
  <text x="55" y="84" font-size="13" font-weight="bold" fill="#888">U (Universe)</text>
  <circle cx="270" cy="215" r="115" fill="rgba(54, 162, 235, 0.25)" stroke="rgba(54, 162, 235, 1)" stroke-width="2.5"/>
  <circle cx="410" cy="215" r="115" fill="rgba(255, 99, 132, 0.25)" stroke="rgba(255, 99, 132, 1)" stroke-width="2.5"/>
  <clipPath id="t1-clipA">
    <circle cx="270" cy="215" r="115"/>
  </clipPath>
  <circle cx="410" cy="215" r="115" fill="rgba(153, 102, 255, 0.3)" stroke="none" clip-path="url(#t1-clipA)"/>
  <text x="205" y="210" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(54, 162, 235, 1)">A</text>
  <text x="205" y="230" text-anchor="middle" font-size="12" fill="rgba(54, 162, 235, 0.8)">Group A</text>
  <text x="340" y="210" text-anchor="middle" font-size="13" font-weight="bold" fill="rgba(153, 102, 255, 1)">A ∩ B</text>
  <text x="340" y="228" text-anchor="middle" font-size="11" fill="rgba(153, 102, 255, 0.8)">overlap</text>
  <text x="475" y="210" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(255, 99, 132, 1)">B</text>
  <text x="475" y="230" text-anchor="middle" font-size="12" fill="rgba(255, 99, 132, 0.8)">Group B</text>
</svg>
</div>

---

### Template 2: Highlight Overlap (A ∩ B Selected)

Overlap region highlighted in green. Use when the intersection is the focus.

```xml
<div style="text-align: center; margin: 2em 0;">
<svg viewBox="0 0 700 400" xmlns="http://www.w3.org/2000/svg" style="max-width: 700px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <text x="350" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#333">TITLE — Highlight Overlap</text>
  <text x="350" y="50" text-anchor="middle" font-size="13" fill="#666">The intersection A ∩ B is selected.</text>
  <rect x="40" y="62" width="620" height="295" rx="12" ry="12" fill="rgba(240, 240, 240, 0.5)" stroke="#aaa" stroke-width="2" stroke-dasharray="8,4"/>
  <text x="55" y="84" font-size="13" font-weight="bold" fill="#888">U</text>
  <!-- A circle — faded -->
  <circle cx="280" cy="215" r="115" fill="rgba(54, 162, 235, 0.15)" stroke="rgba(54, 162, 235, 0.6)" stroke-width="2.5"/>
  <!-- B circle — faded -->
  <circle cx="400" cy="215" r="115" fill="rgba(255, 99, 132, 0.15)" stroke="rgba(255, 99, 132, 0.6)" stroke-width="2.5"/>
  <!-- Overlap — green highlight -->
  <clipPath id="t2-clipA">
    <circle cx="280" cy="215" r="115"/>
  </clipPath>
  <circle cx="400" cy="215" r="115" fill="rgba(46, 204, 113, 0.55)" stroke="none" clip-path="url(#t2-clipA)"/>
  <!-- Labels -->
  <text x="210" y="210" text-anchor="middle" font-size="16" font-weight="bold" fill="rgba(54, 162, 235, 0.8)">A</text>
  <text x="340" y="200" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(39, 174, 96, 1)">A ∩ B</text>
  <text x="340" y="220" text-anchor="middle" font-size="13" fill="rgba(39, 174, 96, 1)">SELECTED</text>
  <text x="470" y="210" text-anchor="middle" font-size="16" font-weight="bold" fill="rgba(255, 99, 132, 0.8)">B</text>
  <!-- Legend -->
  <rect x="220" y="365" width="14" height="14" rx="3" fill="rgba(46, 204, 113, 0.55)" stroke="rgba(39, 174, 96, 1)" stroke-width="1.5"/>
  <text x="240" y="377" font-size="12" fill="#555">= Selected (A ∩ B)</text>
</svg>
</div>
```

<div style="text-align: center; margin: 2em 0;">
<svg viewBox="0 0 700 400" xmlns="http://www.w3.org/2000/svg" style="max-width: 700px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <text x="350" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#333">Template 2: Highlight Overlap</text>
  <text x="350" y="50" text-anchor="middle" font-size="13" fill="#666">The intersection A ∩ B is selected.</text>
  <rect x="40" y="62" width="620" height="295" rx="12" ry="12" fill="rgba(240, 240, 240, 0.5)" stroke="#aaa" stroke-width="2" stroke-dasharray="8,4"/>
  <text x="55" y="84" font-size="13" font-weight="bold" fill="#888">U</text>
  <circle cx="280" cy="215" r="115" fill="rgba(54, 162, 235, 0.15)" stroke="rgba(54, 162, 235, 0.6)" stroke-width="2.5"/>
  <circle cx="400" cy="215" r="115" fill="rgba(255, 99, 132, 0.15)" stroke="rgba(255, 99, 132, 0.6)" stroke-width="2.5"/>
  <clipPath id="t2-clipA">
    <circle cx="280" cy="215" r="115"/>
  </clipPath>
  <circle cx="400" cy="215" r="115" fill="rgba(46, 204, 113, 0.55)" stroke="none" clip-path="url(#t2-clipA)"/>
  <text x="210" y="210" text-anchor="middle" font-size="16" font-weight="bold" fill="rgba(54, 162, 235, 0.8)">A</text>
  <text x="340" y="200" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(39, 174, 96, 1)">A ∩ B</text>
  <text x="340" y="220" text-anchor="middle" font-size="13" fill="rgba(39, 174, 96, 1)">SELECTED</text>
  <text x="470" y="210" text-anchor="middle" font-size="16" font-weight="bold" fill="rgba(255, 99, 132, 0.8)">B</text>
  <rect x="220" y="365" width="14" height="14" rx="3" fill="rgba(46, 204, 113, 0.55)" stroke="rgba(39, 174, 96, 1)" stroke-width="1.5"/>
  <text x="240" y="377" font-size="12" fill="#555">= Selected (A ∩ B)</text>
</svg>
</div>

---

### Template 3: Both Sets Included (A ∪ B)

Both circles in green. Use for union / "include all" scenarios.

```xml
<div style="text-align: center; margin: 2em 0;">
<svg viewBox="0 0 700 400" xmlns="http://www.w3.org/2000/svg" style="max-width: 700px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <text x="350" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#333">TITLE — Union A ∪ B</text>
  <text x="350" y="50" text-anchor="middle" font-size="13" fill="#666">Both groups included.</text>
  <rect x="40" y="62" width="620" height="295" rx="12" ry="12" fill="rgba(240, 240, 240, 0.5)" stroke="#aaa" stroke-width="2" stroke-dasharray="8,4"/>
  <text x="55" y="84" font-size="13" font-weight="bold" fill="#888">U</text>
  <!-- Both circles green -->
  <circle cx="270" cy="215" r="115" fill="rgba(46, 204, 113, 0.4)" stroke="rgba(39, 174, 96, 1)" stroke-width="2.5"/>
  <circle cx="410" cy="215" r="115" fill="rgba(46, 204, 113, 0.4)" stroke="rgba(39, 174, 96, 1)" stroke-width="2.5"/>
  <!-- Overlap — slightly darker green -->
  <clipPath id="t3-clipA">
    <circle cx="270" cy="215" r="115"/>
  </clipPath>
  <circle cx="410" cy="215" r="115" fill="rgba(46, 204, 113, 0.55)" stroke="none" clip-path="url(#t3-clipA)"/>
  <!-- Labels -->
  <text x="205" y="210" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(39, 174, 96, 1)">A</text>
  <text x="205" y="230" text-anchor="middle" font-size="12" fill="rgba(39, 174, 96, 0.8)">INCLUDED</text>
  <text x="340" y="210" text-anchor="middle" font-size="13" font-weight="bold" fill="rgba(39, 174, 96, 1)">A ∩ B</text>
  <text x="340" y="228" text-anchor="middle" font-size="11" fill="rgba(39, 174, 96, 0.8)">INCLUDED</text>
  <text x="475" y="210" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(39, 174, 96, 1)">B</text>
  <text x="475" y="230" text-anchor="middle" font-size="12" fill="rgba(39, 174, 96, 0.8)">INCLUDED</text>
  <!-- Legend -->
  <rect x="220" y="365" width="14" height="14" rx="3" fill="rgba(46, 204, 113, 0.5)" stroke="rgba(39, 174, 96, 1)" stroke-width="1.5"/>
  <text x="240" y="377" font-size="12" fill="#555">= Included (A ∪ B)</text>
</svg>
</div>
```

<div style="text-align: center; margin: 2em 0;">
<svg viewBox="0 0 700 400" xmlns="http://www.w3.org/2000/svg" style="max-width: 700px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <text x="350" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#333">Template 3: Union A ∪ B</text>
  <text x="350" y="50" text-anchor="middle" font-size="13" fill="#666">Both groups included.</text>
  <rect x="40" y="62" width="620" height="295" rx="12" ry="12" fill="rgba(240, 240, 240, 0.5)" stroke="#aaa" stroke-width="2" stroke-dasharray="8,4"/>
  <text x="55" y="84" font-size="13" font-weight="bold" fill="#888">U</text>
  <circle cx="270" cy="215" r="115" fill="rgba(46, 204, 113, 0.4)" stroke="rgba(39, 174, 96, 1)" stroke-width="2.5"/>
  <circle cx="410" cy="215" r="115" fill="rgba(46, 204, 113, 0.4)" stroke="rgba(39, 174, 96, 1)" stroke-width="2.5"/>
  <clipPath id="t3-clipA">
    <circle cx="270" cy="215" r="115"/>
  </clipPath>
  <circle cx="410" cy="215" r="115" fill="rgba(46, 204, 113, 0.55)" stroke="none" clip-path="url(#t3-clipA)"/>
  <text x="205" y="210" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(39, 174, 96, 1)">A</text>
  <text x="205" y="230" text-anchor="middle" font-size="12" fill="rgba(39, 174, 96, 0.8)">INCLUDED</text>
  <text x="340" y="210" text-anchor="middle" font-size="13" font-weight="bold" fill="rgba(39, 174, 96, 1)">A ∩ B</text>
  <text x="340" y="228" text-anchor="middle" font-size="11" fill="rgba(39, 174, 96, 0.8)">INCLUDED</text>
  <text x="475" y="210" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(39, 174, 96, 1)">B</text>
  <text x="475" y="230" text-anchor="middle" font-size="12" fill="rgba(39, 174, 96, 0.8)">INCLUDED</text>
  <rect x="220" y="365" width="14" height="14" rx="3" fill="rgba(46, 204, 113, 0.5)" stroke="rgba(39, 174, 96, 1)" stroke-width="1.5"/>
  <text x="240" y="377" font-size="12" fill="#555">= Included (A ∪ B)</text>
</svg>
</div>

---

### Template 4: A Only (B Excluded)

A in green, B greyed out. Overlap stays green (it's in A).

```xml
<div style="text-align: center; margin: 2em 0;">
<svg viewBox="0 0 700 400" xmlns="http://www.w3.org/2000/svg" style="max-width: 700px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <text x="350" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#333">TITLE — A Only</text>
  <text x="350" y="50" text-anchor="middle" font-size="13" fill="#666">Only A included. B excluded.</text>
  <rect x="40" y="62" width="620" height="295" rx="12" ry="12" fill="rgba(240, 240, 240, 0.5)" stroke="#aaa" stroke-width="2" stroke-dasharray="8,4"/>
  <text x="55" y="84" font-size="13" font-weight="bold" fill="#888">U</text>
  <!-- B circle — grey (draw first so A overlaps) -->
  <circle cx="410" cy="215" r="115" fill="rgba(200, 200, 200, 0.15)" stroke="rgba(180, 180, 180, 0.6)" stroke-width="2"/>
  <!-- A circle — green -->
  <circle cx="270" cy="215" r="115" fill="rgba(46, 204, 113, 0.4)" stroke="rgba(39, 174, 96, 1)" stroke-width="2.5"/>
  <!-- Overlap — green (in A) -->
  <clipPath id="t4-clipA">
    <circle cx="270" cy="215" r="115"/>
  </clipPath>
  <circle cx="410" cy="215" r="115" fill="rgba(46, 204, 113, 0.55)" stroke="none" clip-path="url(#t4-clipA)"/>
  <!-- Labels -->
  <text x="205" y="210" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(39, 174, 96, 1)">A</text>
  <text x="205" y="230" text-anchor="middle" font-size="12" fill="rgba(39, 174, 96, 0.8)">INCLUDED</text>
  <text x="340" y="210" text-anchor="middle" font-size="13" font-weight="bold" fill="rgba(39, 174, 96, 1)">A ∩ B</text>
  <text x="340" y="228" text-anchor="middle" font-size="11" fill="rgba(39, 174, 96, 0.8)">INCLUDED</text>
  <text x="475" y="210" text-anchor="middle" font-size="14" fill="rgba(180, 180, 180, 0.9)">B</text>
  <text x="475" y="230" text-anchor="middle" font-size="12" fill="rgba(180, 180, 180, 0.8)">(excluded)</text>
  <!-- Legend -->
  <rect x="180" y="365" width="14" height="14" rx="3" fill="rgba(46, 204, 113, 0.5)" stroke="rgba(39, 174, 96, 1)" stroke-width="1.5"/>
  <text x="200" y="377" font-size="12" fill="#555">= Included (A)</text>
  <rect x="340" y="365" width="14" height="14" rx="3" fill="rgba(200, 200, 200, 0.2)" stroke="rgba(180, 180, 180, 0.7)" stroke-width="1.5"/>
  <text x="360" y="377" font-size="12" fill="#555">= Excluded</text>
</svg>
</div>
```

<div style="text-align: center; margin: 2em 0;">
<svg viewBox="0 0 700 400" xmlns="http://www.w3.org/2000/svg" style="max-width: 700px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <text x="350" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#333">Template 4: A Only</text>
  <text x="350" y="50" text-anchor="middle" font-size="13" fill="#666">Only A included. B excluded.</text>
  <rect x="40" y="62" width="620" height="295" rx="12" ry="12" fill="rgba(240, 240, 240, 0.5)" stroke="#aaa" stroke-width="2" stroke-dasharray="8,4"/>
  <text x="55" y="84" font-size="13" font-weight="bold" fill="#888">U</text>
  <circle cx="410" cy="215" r="115" fill="rgba(200, 200, 200, 0.15)" stroke="rgba(180, 180, 180, 0.6)" stroke-width="2"/>
  <circle cx="270" cy="215" r="115" fill="rgba(46, 204, 113, 0.4)" stroke="rgba(39, 174, 96, 1)" stroke-width="2.5"/>
  <clipPath id="t4-clipA">
    <circle cx="270" cy="215" r="115"/>
  </clipPath>
  <circle cx="410" cy="215" r="115" fill="rgba(46, 204, 113, 0.55)" stroke="none" clip-path="url(#t4-clipA)"/>
  <text x="205" y="210" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(39, 174, 96, 1)">A</text>
  <text x="205" y="230" text-anchor="middle" font-size="12" fill="rgba(39, 174, 96, 0.8)">INCLUDED</text>
  <text x="340" y="210" text-anchor="middle" font-size="13" font-weight="bold" fill="rgba(39, 174, 96, 1)">A ∩ B</text>
  <text x="340" y="228" text-anchor="middle" font-size="11" fill="rgba(39, 174, 96, 0.8)">INCLUDED</text>
  <text x="475" y="210" text-anchor="middle" font-size="14" fill="rgba(180, 180, 180, 0.9)">B</text>
  <text x="475" y="230" text-anchor="middle" font-size="12" fill="rgba(180, 180, 180, 0.8)">(excluded)</text>
  <rect x="180" y="365" width="14" height="14" rx="3" fill="rgba(46, 204, 113, 0.5)" stroke="rgba(39, 174, 96, 1)" stroke-width="1.5"/>
  <text x="200" y="377" font-size="12" fill="#555">= Included (A)</text>
  <rect x="340" y="365" width="14" height="14" rx="3" fill="rgba(200, 200, 200, 0.2)" stroke="rgba(180, 180, 180, 0.7)" stroke-width="1.5"/>
  <text x="360" y="377" font-size="12" fill="#555">= Excluded</text>
</svg>
</div>

---

### Template 5: Set Difference (A \ B — Overlap Excluded)

A crescent only. Both overlap and B are greyed out.

```xml
<div style="text-align: center; margin: 2em 0;">
<svg viewBox="0 0 700 400" xmlns="http://www.w3.org/2000/svg" style="max-width: 700px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <text x="350" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#333">TITLE — Set Difference A \ B</text>
  <text x="350" y="50" text-anchor="middle" font-size="13" fill="#666">A only, excluding shared elements.</text>
  <rect x="40" y="62" width="620" height="295" rx="12" ry="12" fill="rgba(240, 240, 240, 0.5)" stroke="#aaa" stroke-width="2" stroke-dasharray="8,4"/>
  <text x="55" y="84" font-size="13" font-weight="bold" fill="#888">U</text>
  <!-- B circle — grey -->
  <circle cx="410" cy="215" r="115" fill="rgba(200, 200, 200, 0.15)" stroke="rgba(180, 180, 180, 0.6)" stroke-width="2"/>
  <!-- A circle — green -->
  <circle cx="270" cy="215" r="115" fill="rgba(46, 204, 113, 0.4)" stroke="rgba(39, 174, 96, 1)" stroke-width="2.5"/>
  <!-- Overlap — grey (excluded: shared with B) -->
  <clipPath id="t5-clipA">
    <circle cx="270" cy="215" r="115"/>
  </clipPath>
  <circle cx="410" cy="215" r="115" fill="rgba(200, 200, 200, 0.35)" stroke="none" clip-path="url(#t5-clipA)"/>
  <!-- Labels -->
  <text x="205" y="210" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(39, 174, 96, 1)">A \ B</text>
  <text x="205" y="230" text-anchor="middle" font-size="12" fill="rgba(39, 174, 96, 0.8)">INCLUDED</text>
  <text x="340" y="210" text-anchor="middle" font-size="13" font-weight="bold" fill="rgba(180, 180, 180, 0.9)">A ∩ B</text>
  <text x="340" y="228" text-anchor="middle" font-size="11" fill="rgba(180, 180, 180, 0.8)">(excluded)</text>
  <text x="475" y="210" text-anchor="middle" font-size="14" fill="rgba(180, 180, 180, 0.9)">B</text>
  <text x="475" y="230" text-anchor="middle" font-size="12" fill="rgba(180, 180, 180, 0.8)">(excluded)</text>
  <!-- Legend -->
  <rect x="180" y="365" width="14" height="14" rx="3" fill="rgba(46, 204, 113, 0.5)" stroke="rgba(39, 174, 96, 1)" stroke-width="1.5"/>
  <text x="200" y="377" font-size="12" fill="#555">= Included (A \ B)</text>
  <rect x="360" y="365" width="14" height="14" rx="3" fill="rgba(200, 200, 200, 0.35)" stroke="rgba(180, 180, 180, 0.7)" stroke-width="1.5"/>
  <text x="380" y="377" font-size="12" fill="#555">= Excluded</text>
</svg>
</div>
```

<div style="text-align: center; margin: 2em 0;">
<svg viewBox="0 0 700 400" xmlns="http://www.w3.org/2000/svg" style="max-width: 700px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <text x="350" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#333">Template 5: Set Difference A \ B</text>
  <text x="350" y="50" text-anchor="middle" font-size="13" fill="#666">A only, excluding shared elements.</text>
  <rect x="40" y="62" width="620" height="295" rx="12" ry="12" fill="rgba(240, 240, 240, 0.5)" stroke="#aaa" stroke-width="2" stroke-dasharray="8,4"/>
  <text x="55" y="84" font-size="13" font-weight="bold" fill="#888">U</text>
  <circle cx="410" cy="215" r="115" fill="rgba(200, 200, 200, 0.15)" stroke="rgba(180, 180, 180, 0.6)" stroke-width="2"/>
  <circle cx="270" cy="215" r="115" fill="rgba(46, 204, 113, 0.4)" stroke="rgba(39, 174, 96, 1)" stroke-width="2.5"/>
  <clipPath id="t5-clipA">
    <circle cx="270" cy="215" r="115"/>
  </clipPath>
  <circle cx="410" cy="215" r="115" fill="rgba(200, 200, 200, 0.35)" stroke="none" clip-path="url(#t5-clipA)"/>
  <text x="205" y="210" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(39, 174, 96, 1)">A \ B</text>
  <text x="205" y="230" text-anchor="middle" font-size="12" fill="rgba(39, 174, 96, 0.8)">INCLUDED</text>
  <text x="340" y="210" text-anchor="middle" font-size="13" font-weight="bold" fill="rgba(180, 180, 180, 0.9)">A ∩ B</text>
  <text x="340" y="228" text-anchor="middle" font-size="11" fill="rgba(180, 180, 180, 0.8)">(excluded)</text>
  <text x="475" y="210" text-anchor="middle" font-size="14" fill="rgba(180, 180, 180, 0.9)">B</text>
  <text x="475" y="230" text-anchor="middle" font-size="12" fill="rgba(180, 180, 180, 0.8)">(excluded)</text>
  <rect x="180" y="365" width="14" height="14" rx="3" fill="rgba(46, 204, 113, 0.5)" stroke="rgba(39, 174, 96, 1)" stroke-width="1.5"/>
  <text x="200" y="377" font-size="12" fill="#555">= Included (A \ B)</text>
  <rect x="360" y="365" width="14" height="14" rx="3" fill="rgba(200, 200, 200, 0.35)" stroke="rgba(180, 180, 180, 0.7)" stroke-width="1.5"/>
  <text x="380" y="377" font-size="12" fill="#555">= Excluded</text>
</svg>
</div>

---

### Template 6: Exclusion with Red (A Selected, B Excluded with Red Highlight)

A crescent in green, B and overlap in red. Use when exclusion is the focus.

```xml
<div style="text-align: center; margin: 2em 0;">
<svg viewBox="0 0 700 400" xmlns="http://www.w3.org/2000/svg" style="max-width: 700px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <text x="350" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#333">TITLE — Exclusion A \ B</text>
  <text x="350" y="50" text-anchor="middle" font-size="13" fill="#666">A selected, B actively excluded (red).</text>
  <rect x="40" y="62" width="620" height="295" rx="12" ry="12" fill="rgba(240, 240, 240, 0.5)" stroke="#aaa" stroke-width="2" stroke-dasharray="8,4"/>
  <text x="55" y="84" font-size="13" font-weight="bold" fill="#888">U</text>
  <!-- B circle — red excluded -->
  <circle cx="400" cy="215" r="115" fill="rgba(231, 76, 60, 0.15)" stroke="rgba(192, 57, 43, 0.6)" stroke-width="2.5" stroke-dasharray="6,3"/>
  <!-- A circle — green -->
  <circle cx="280" cy="215" r="115" fill="rgba(46, 204, 113, 0.35)" stroke="rgba(39, 174, 96, 1)" stroke-width="2.5"/>
  <!-- Overlap — red (excluded) -->
  <clipPath id="t6-clipA">
    <circle cx="280" cy="215" r="115"/>
  </clipPath>
  <circle cx="400" cy="215" r="115" fill="rgba(231, 76, 60, 0.3)" stroke="none" clip-path="url(#t6-clipA)"/>
  <!-- Labels -->
  <text x="210" y="205" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(39, 174, 96, 1)">A \ B</text>
  <text x="210" y="225" text-anchor="middle" font-size="13" fill="rgba(39, 174, 96, 1)">SELECTED</text>
  <text x="340" y="205" text-anchor="middle" font-size="14" font-weight="bold" fill="rgba(192, 57, 43, 1)">A ∩ B</text>
  <text x="340" y="225" text-anchor="middle" font-size="12" fill="rgba(192, 57, 43, 0.9)">EXCLUDED</text>
  <text x="470" y="205" text-anchor="middle" font-size="14" font-weight="bold" fill="rgba(192, 57, 43, 0.8)">B \ A</text>
  <text x="470" y="225" text-anchor="middle" font-size="12" fill="rgba(192, 57, 43, 0.7)">EXCLUDED</text>
  <!-- Legend -->
  <rect x="140" y="365" width="14" height="14" rx="3" fill="rgba(46, 204, 113, 0.4)" stroke="rgba(39, 174, 96, 1)" stroke-width="1.5"/>
  <text x="160" y="377" font-size="12" fill="#555">= Selected (A \ B)</text>
  <rect x="350" y="365" width="14" height="14" rx="3" fill="rgba(231, 76, 60, 0.2)" stroke="rgba(192, 57, 43, 0.7)" stroke-width="1.5"/>
  <text x="370" y="377" font-size="12" fill="#555">= Excluded (B)</text>
</svg>
</div>
```

<div style="text-align: center; margin: 2em 0;">
<svg viewBox="0 0 700 400" xmlns="http://www.w3.org/2000/svg" style="max-width: 700px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <text x="350" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#333">Template 6: Exclusion with Red</text>
  <text x="350" y="50" text-anchor="middle" font-size="13" fill="#666">A selected, B actively excluded (red).</text>
  <rect x="40" y="62" width="620" height="295" rx="12" ry="12" fill="rgba(240, 240, 240, 0.5)" stroke="#aaa" stroke-width="2" stroke-dasharray="8,4"/>
  <text x="55" y="84" font-size="13" font-weight="bold" fill="#888">U</text>
  <circle cx="400" cy="215" r="115" fill="rgba(231, 76, 60, 0.15)" stroke="rgba(192, 57, 43, 0.6)" stroke-width="2.5" stroke-dasharray="6,3"/>
  <circle cx="280" cy="215" r="115" fill="rgba(46, 204, 113, 0.35)" stroke="rgba(39, 174, 96, 1)" stroke-width="2.5"/>
  <clipPath id="t6-clipA">
    <circle cx="280" cy="215" r="115"/>
  </clipPath>
  <circle cx="400" cy="215" r="115" fill="rgba(231, 76, 60, 0.3)" stroke="none" clip-path="url(#t6-clipA)"/>
  <text x="210" y="205" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(39, 174, 96, 1)">A \ B</text>
  <text x="210" y="225" text-anchor="middle" font-size="13" fill="rgba(39, 174, 96, 1)">SELECTED</text>
  <text x="340" y="205" text-anchor="middle" font-size="14" font-weight="bold" fill="rgba(192, 57, 43, 1)">A ∩ B</text>
  <text x="340" y="225" text-anchor="middle" font-size="12" fill="rgba(192, 57, 43, 0.9)">EXCLUDED</text>
  <text x="470" y="205" text-anchor="middle" font-size="14" font-weight="bold" fill="rgba(192, 57, 43, 0.8)">B \ A</text>
  <text x="470" y="225" text-anchor="middle" font-size="12" fill="rgba(192, 57, 43, 0.7)">EXCLUDED</text>
  <rect x="140" y="365" width="14" height="14" rx="3" fill="rgba(46, 204, 113, 0.4)" stroke="rgba(39, 174, 96, 1)" stroke-width="1.5"/>
  <text x="160" y="377" font-size="12" fill="#555">= Selected (A \ B)</text>
  <rect x="350" y="365" width="14" height="14" rx="3" fill="rgba(231, 76, 60, 0.2)" stroke="rgba(192, 57, 43, 0.7)" stroke-width="1.5"/>
  <text x="370" y="377" font-size="12" fill="#555">= Excluded (B)</text>
</svg>
</div>

---

### Template 7: Four-Partition View

All four mutually exclusive segments labeled. Use for validation and partition checks.

```xml
<div style="text-align: center; margin: 2em 0;">
<svg viewBox="0 0 700 400" xmlns="http://www.w3.org/2000/svg" style="max-width: 700px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <text x="350" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#333">TITLE — Four Partitions</text>
  <text x="350" y="50" text-anchor="middle" font-size="13" fill="#666">All segments sum to total.</text>
  <!-- Universe — yellow tint -->
  <rect x="40" y="62" width="620" height="295" rx="12" ry="12" fill="rgba(255, 206, 86, 0.1)" stroke="rgba(255, 206, 86, 0.6)" stroke-width="2" stroke-dasharray="8,4"/>
  <text x="55" y="84" font-size="13" font-weight="bold" fill="rgba(255, 206, 86, 0.8)">U (Total)</text>
  <!-- A circle — blue -->
  <circle cx="270" cy="215" r="115" fill="rgba(54, 162, 235, 0.3)" stroke="rgba(54, 162, 235, 1)" stroke-width="2.5"/>
  <!-- B circle — pink -->
  <circle cx="410" cy="215" r="115" fill="rgba(255, 99, 132, 0.3)" stroke="rgba(255, 99, 132, 1)" stroke-width="2.5"/>
  <!-- Overlap — purple -->
  <clipPath id="t7-clipA">
    <circle cx="270" cy="215" r="115"/>
  </clipPath>
  <circle cx="410" cy="215" r="115" fill="rgba(153, 102, 255, 0.4)" stroke="none" clip-path="url(#t7-clipA)"/>
  <!-- Labels for all four segments -->
  <text x="200" y="205" text-anchor="middle" font-size="14" font-weight="bold" fill="rgba(54, 162, 235, 1)">A \ B</text>
  <text x="200" y="225" text-anchor="middle" font-size="11" fill="rgba(54, 162, 235, 0.8)">A only</text>
  <text x="340" y="205" text-anchor="middle" font-size="14" font-weight="bold" fill="rgba(153, 102, 255, 1)">A ∩ B</text>
  <text x="340" y="225" text-anchor="middle" font-size="11" fill="rgba(153, 102, 255, 0.8)">overlap</text>
  <text x="480" y="205" text-anchor="middle" font-size="14" font-weight="bold" fill="rgba(255, 99, 132, 1)">B \ A</text>
  <text x="480" y="225" text-anchor="middle" font-size="11" fill="rgba(255, 99, 132, 0.8)">B only</text>
  <!-- Neither -->
  <text x="590" y="335" text-anchor="middle" font-size="13" font-weight="bold" fill="rgba(255, 206, 86, 0.9)">A' ∩ B'</text>
  <text x="590" y="350" text-anchor="middle" font-size="11" fill="rgba(255, 206, 86, 0.7)">neither</text>
</svg>
</div>
```

<div style="text-align: center; margin: 2em 0;">
<svg viewBox="0 0 700 400" xmlns="http://www.w3.org/2000/svg" style="max-width: 700px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <text x="350" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#333">Template 7: Four Partitions</text>
  <text x="350" y="50" text-anchor="middle" font-size="13" fill="#666">All segments sum to total.</text>
  <rect x="40" y="62" width="620" height="295" rx="12" ry="12" fill="rgba(255, 206, 86, 0.1)" stroke="rgba(255, 206, 86, 0.6)" stroke-width="2" stroke-dasharray="8,4"/>
  <text x="55" y="84" font-size="13" font-weight="bold" fill="rgba(255, 206, 86, 0.8)">U (Total)</text>
  <circle cx="270" cy="215" r="115" fill="rgba(54, 162, 235, 0.3)" stroke="rgba(54, 162, 235, 1)" stroke-width="2.5"/>
  <circle cx="410" cy="215" r="115" fill="rgba(255, 99, 132, 0.3)" stroke="rgba(255, 99, 132, 1)" stroke-width="2.5"/>
  <clipPath id="t7-clipA">
    <circle cx="270" cy="215" r="115"/>
  </clipPath>
  <circle cx="410" cy="215" r="115" fill="rgba(153, 102, 255, 0.4)" stroke="none" clip-path="url(#t7-clipA)"/>
  <text x="200" y="205" text-anchor="middle" font-size="14" font-weight="bold" fill="rgba(54, 162, 235, 1)">A \ B</text>
  <text x="200" y="225" text-anchor="middle" font-size="11" fill="rgba(54, 162, 235, 0.8)">A only</text>
  <text x="340" y="205" text-anchor="middle" font-size="14" font-weight="bold" fill="rgba(153, 102, 255, 1)">A ∩ B</text>
  <text x="340" y="225" text-anchor="middle" font-size="11" fill="rgba(153, 102, 255, 0.8)">overlap</text>
  <text x="480" y="205" text-anchor="middle" font-size="14" font-weight="bold" fill="rgba(255, 99, 132, 1)">B \ A</text>
  <text x="480" y="225" text-anchor="middle" font-size="11" fill="rgba(255, 99, 132, 0.8)">B only</text>
  <text x="590" y="335" text-anchor="middle" font-size="13" font-weight="bold" fill="rgba(255, 206, 86, 0.9)">A' ∩ B'</text>
  <text x="590" y="350" text-anchor="middle" font-size="11" fill="rgba(255, 206, 86, 0.7)">neither</text>
</svg>
</div>

---

### Template 8: Universe Complement (A ∪ B' — Green Universe)

Universe background is green (NOT B region). B crescent is red. Use for complement operations.

```xml
<div style="text-align: center; margin: 2em 0;">
<svg viewBox="0 0 700 420" xmlns="http://www.w3.org/2000/svg" style="max-width: 700px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <text x="350" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#333">TITLE — A ∪ NOT B</text>
  <text x="350" y="50" text-anchor="middle" font-size="13" fill="#666">Green = included, Red = excluded (B-only).</text>
  <!-- Universe — green fill (represents NOT B) -->
  <rect x="40" y="62" width="620" height="310" rx="12" ry="12" fill="rgba(46, 204, 113, 0.18)" stroke="rgba(39, 174, 96, 0.7)" stroke-width="2.5" stroke-dasharray="8,4"/>
  <text x="55" y="84" font-size="14" font-weight="bold" fill="rgba(39, 174, 96, 1)">U — NOT B is green</text>
  <!-- B circle — red -->
  <circle cx="400" cy="225" r="120" fill="rgba(231, 76, 60, 0.25)" stroke="rgba(192, 57, 43, 0.9)" stroke-width="2.5"/>
  <!-- A circle — green -->
  <circle cx="280" cy="225" r="120" fill="rgba(46, 204, 113, 0.45)" stroke="rgba(39, 174, 96, 1)" stroke-width="2.5"/>
  <!-- Overlap — green (in A, so included) -->
  <clipPath id="t8-clipA">
    <circle cx="280" cy="225" r="120"/>
  </clipPath>
  <circle cx="400" cy="225" r="120" fill="rgba(46, 204, 113, 0.55)" clip-path="url(#t8-clipA)"/>
  <!-- Labels -->
  <text x="215" y="220" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(39, 174, 96, 1)">A</text>
  <text x="215" y="240" text-anchor="middle" font-size="12" fill="rgba(39, 174, 96, 0.9)">INCLUDED</text>
  <text x="340" y="215" text-anchor="middle" font-size="13" font-weight="bold" fill="rgba(39, 174, 96, 1)">A ∩ B</text>
  <text x="340" y="233" text-anchor="middle" font-size="11" fill="rgba(39, 174, 96, 0.9)">INCLUDED</text>
  <text x="465" y="220" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(192, 57, 43, 1)">B \ A</text>
  <text x="465" y="240" text-anchor="middle" font-size="12" fill="rgba(192, 57, 43, 0.9)">EXCLUDED</text>
  <!-- Legend -->
  <rect x="140" y="383" width="14" height="14" rx="3" fill="rgba(46, 204, 113, 0.4)" stroke="rgba(39, 174, 96, 1)" stroke-width="1.5"/>
  <text x="160" y="395" font-size="12" fill="#555">= Included (A ∪ NOT B)</text>
  <rect x="350" y="383" width="14" height="14" rx="3" fill="rgba(231, 76, 60, 0.25)" stroke="rgba(192, 57, 43, 0.9)" stroke-width="1.5"/>
  <text x="370" y="395" font-size="12" fill="#555">= Excluded (B-only)</text>
</svg>
</div>
```

<div style="text-align: center; margin: 2em 0;">
<svg viewBox="0 0 700 420" xmlns="http://www.w3.org/2000/svg" style="max-width: 700px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <text x="350" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#333">Template 8: Universe Complement A ∪ NOT B</text>
  <text x="350" y="50" text-anchor="middle" font-size="13" fill="#666">Green = included, Red = excluded (B-only).</text>
  <rect x="40" y="62" width="620" height="310" rx="12" ry="12" fill="rgba(46, 204, 113, 0.18)" stroke="rgba(39, 174, 96, 0.7)" stroke-width="2.5" stroke-dasharray="8,4"/>
  <text x="55" y="84" font-size="14" font-weight="bold" fill="rgba(39, 174, 96, 1)">U — NOT B is green</text>
  <circle cx="400" cy="225" r="120" fill="rgba(231, 76, 60, 0.25)" stroke="rgba(192, 57, 43, 0.9)" stroke-width="2.5"/>
  <circle cx="280" cy="225" r="120" fill="rgba(46, 204, 113, 0.45)" stroke="rgba(39, 174, 96, 1)" stroke-width="2.5"/>
  <clipPath id="t8-clipA">
    <circle cx="280" cy="225" r="120"/>
  </clipPath>
  <circle cx="400" cy="225" r="120" fill="rgba(46, 204, 113, 0.55)" clip-path="url(#t8-clipA)"/>
  <text x="215" y="220" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(39, 174, 96, 1)">A</text>
  <text x="215" y="240" text-anchor="middle" font-size="12" fill="rgba(39, 174, 96, 0.9)">INCLUDED</text>
  <text x="340" y="215" text-anchor="middle" font-size="13" font-weight="bold" fill="rgba(39, 174, 96, 1)">A ∩ B</text>
  <text x="340" y="233" text-anchor="middle" font-size="11" fill="rgba(39, 174, 96, 0.9)">INCLUDED</text>
  <text x="465" y="220" text-anchor="middle" font-size="15" font-weight="bold" fill="rgba(192, 57, 43, 1)">B \ A</text>
  <text x="465" y="240" text-anchor="middle" font-size="12" fill="rgba(192, 57, 43, 0.9)">EXCLUDED</text>
  <rect x="140" y="383" width="14" height="14" rx="3" fill="rgba(46, 204, 113, 0.4)" stroke="rgba(39, 174, 96, 1)" stroke-width="1.5"/>
  <text x="160" y="395" font-size="12" fill="#555">= Included (A ∪ NOT B)</text>
  <rect x="350" y="383" width="14" height="14" rx="3" fill="rgba(231, 76, 60, 0.25)" stroke="rgba(192, 57, 43, 0.9)" stroke-width="1.5"/>
  <text x="370" y="395" font-size="12" fill="#555">= Excluded (B-only)</text>
</svg>
</div>

---

## Quick Reference: Which Template to Use

| Set Operation | Template | Overlap Color |
|--------------|----------|---------------|
| Show both groups (neutral) | **1: Basic** | Purple |
| Highlight intersection | **2: Highlight Overlap** | Green |
| Include everything (A ∪ B) | **3: Union** | Green (all green) |
| Include A, exclude B | **4: A Only** | Green (part of A) |
| A minus shared (A \ B) | **5: Set Difference** | Grey (excluded) |
| A minus B with red exclusion | **6: Exclusion Red** | Red (excluded) |
| Show all 4 partitions | **7: Four-Partition** | Purple |
| Complement (A ∪ B') | **8: Universe Complement** | Green (in A) |

## Tips

- **Draw order matters**: Draw excluded circles first, then included circles on top
- **Dashed strokes** (`stroke-dasharray="6,3"`) signal "excluded" or "boundary"
- **Unique clipPath IDs**: Prefix with diagram name to avoid collisions in multi-diagram docs
- **Responsive sizing**: Always use `max-width` + `width: 100%` on the SVG
- **Font stack**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` for cross-platform
- **Labels placement**: A labels at x~200-210, overlap at x~340, B labels at x~470-480

---

## Mapping to set operators

For the semantic-graph Venn overlay, each set-operation node maps to a template:

| Operator node | Set operation | Template | Result region |
|---------------|---------------|----------|---------------|
| `union` | `A ∪ B` | **3: Union** | Both circles + overlap shaded |
| `intersection` | `A ∩ B` | **2: Highlight Overlap** | Overlap lens shaded, circles faded |
| `set_difference` | `A ∖ B` | **5: Set Difference** (or **6: Exclusion Red**) | A-crescent shaded, overlap + B excluded |
