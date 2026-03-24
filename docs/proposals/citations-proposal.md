# Citations System — Proposal

> A unified citation model for AlgeBench scenes, proofs, and lessons.

**Related docs:**

- [proof-structure-v2-proposal.md](proof-structure-v2-proposal.md) — Proof data structure v2 (references this proposal)

---

## 1. Overview

Proofs and lessons draw from textbooks, papers, lecture notes, and online resources. A file-level `citations` list defines each source once by `id`. Any level — scene, step, proof, or proof step — can reference citations via a `cite` array with per-use overrides.

---

## 2. File-Level Citation Definitions

The `citations` field is a list at the top level of the scene file, each entry identified by `id`:

```json
{
  "title": "Eigenvalues and the Characteristic Equation",
  "citations": [
    {
      "id": "intro-proofs",
      "type": "book",
      "title": "Introduction to Mathematical Proofs",
      "author": "J. Smith"
    },
    {
      "id": "irrationality-paper",
      "type": "paper",
      "title": "A short proof of the irrationality of √2",
      "author": "A. Doe",
      "journal": "Mathematics Monthly",
      "year": 2019,
      "doi": "10.1234/example"
    },
    {
      "id": "linalg-videos",
      "type": "url",
      "title": "Essence of Linear Algebra",
      "url": "https://example.com/linear-algebra"
    },
    {
      "id": "linalg-lecture",
      "type": "lecture",
      "title": "Linear Algebra Lecture 21",
      "url": "https://example.com/lecture-21"
    }
  ],
  "scenes": [...]
}
```

**Citation types:**

| `type` | Use | Key fields |
|--------|-----|------------|
| `"book"` | Textbook reference | `title`, `author`, `chapter`, `section`, `page` |
| `"paper"` | Journal article or preprint | `title`, `author`, `journal`, `year`, `doi` |
| `"url"` | Web resource, video, blog | `title`, `url` |
| `"lecture"` | Lecture notes or video | `title`, `url`, `author` |

---

## 3. Citing with Overrides

Any scene, step, proof, or proof step can include a `cite` array. Each entry references a citation by `id` and can override or add fields. The final citation is derived by merging the file-level definition with the cite object's overrides:

```json
{
  "id": "sqrt2-irrational",
  "title": "√2 is irrational",
  "technique": "contradiction",
  "cite": [
    { "id": "intro-proofs", "chapter": 6, "section": 1, "page": 142 }
  ],
  "steps": [
    {
      "id": "use-fta",
      "type": "recall",
      "label": "By the Fundamental Theorem of Arithmetic",
      "math": "...",
      "cite": [{ "id": "intro-proofs", "chapter": 10, "page": 201 }]
    }
  ]
}
```

**Resolution:** Given the file-level citation with `"id": "intro-proofs"` containing `{ "type": "book", "title": "Introduction to Mathematical Proofs", "author": "J. Smith" }` and the cite object `{ "id": "intro-proofs", "chapter": 6, "section": 1, "page": 142 }`, the resolved citation is:

```json
{
  "id": "intro-proofs",
  "type": "book",
  "title": "Introduction to Mathematical Proofs",
  "author": "J. Smith",
  "chapter": 6,
  "section": 1,
  "page": 142
}
```

The resolved citation retains the `id` for traceability.

The same source can be cited from different locations with different chapter/page overrides — no duplication of the base citation data.

---

## 4. Placement

The `cite` array can appear on:

| Level | Example use |
|-------|-------------|
| **Scene** | "This lesson is based on Chapter 3 of ..." |
| **Step** (scene step) | "This visualization is adapted from ..." |
| **Proof** | "This proof follows the approach in ..." |
| **Proof step** | "By [Smith, Thm 4.1]" |

---

## 5. Field Reference

### Citation Object (file-level `citations` list)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier for referencing |
| `type` | string | yes | `"book"`, `"paper"`, `"url"`, or `"lecture"` |
| `title` | string | yes | Source title |
| `author` | string | no | Author name(s) |
| `chapter` | number | no | Chapter number (books) |
| `section` | number | no | Section number (books) |
| `page` | number | no | Page number (books) |
| `journal` | string | no | Journal name (papers) |
| `year` | number | no | Publication year (papers) |
| `doi` | string | no | Digital Object Identifier (papers) |
| `url` | string | conditional | Web URL; **required** when `type` is `"url"` or `"lecture"`, optional otherwise |

### Cite Reference Object (point-of-use `cite` arrays)

Each entry references a citation by `id`. All other fields are overrides — any field from the base citation can be overridden at point of use. Resolved by merging: `{ ...baseCitation, ...citeRef }`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | References a citation's `id` |
| `label` | string | no | Display label for this usage, e.g. "Thm 4.1" |
| *any other* | — | no | Overrides the corresponding field from the base citation |

---

## 6. UI Rendering

- A "Sources" or "References" section at the bottom of the proof panel, with clickable entries that expand to show full citation details
- DOIs and URLs render as hyperlinks
- Inline `cite` references on proof steps render as bracketed labels (e.g., "[Smith, Ch. 6]") that link to the full entry
