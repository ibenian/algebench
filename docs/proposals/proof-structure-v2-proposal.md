# Proof Data Structure v2 — Proposal

> Improving the AlgeBench proof model for education, self-learning, AI-assisted paper reading, and communication.

---

## 1. What We Have Today

The current proof model is strong for **algebraic derivations** — linear chains of equalities where each step transforms an expression. The quadratic formula example demonstrates this well:

```
given → step → step → step → ... → conclusion
```

**Current strengths:**
- Clean step-by-step structure with `math`, `justification`, `explanation`
- Interactive highlights via `\htmlClass`
- Bidirectional scene sync
- AI agent integration with per-step prompts
- Three embedding levels (root, scene, step)

**Current limitations — exposed by standard proof curricula:**

| Gap | Why It Matters |
|-----|----------------|
| Only linear step chains | Real proofs branch (cases), nest (sub-proofs), and reference prior results |
| No proof *technique* metadata | Can't teach "this is a proof by contradiction" as a strategy |
| No assumptions/hypotheses tracking | Can't show what's assumed vs. what's derived |
| No logical connective structure | Proofs aren't just algebra — they involve ∀, ∃, ⇒, ⇔ |
| No notion of "proof template" | Students need to learn *patterns* (direct, contrapositive, induction...) |
| No cross-proof references | Can't say "by Theorem 4.1" and link to it |
| No disproof / counterexample support | Can't represent disproofs or counterexamples |
| Step-level proofs are flat | Nested sub-proofs (lemmas within proofs) need proper scoping |
| No set-membership / containment reasoning | Many proofs require ∈, ⊆, = on sets |

---

## 2. Proposed Additions

### 2.1 Proof Technique Metadata

Add a `technique` field to the proof object so the system (and AI) knows *what kind* of proof this is. This enables:
- Teaching the proof pattern itself
- Filtering/grouping proofs by technique
- Strategy hints from the AI ("try contrapositive here")

```json
{
  "id": "sqrt2-irrational",
  "title": "√2 is irrational",
  "technique": "contradiction",
  "goal": "Prove that $\\sqrt{2} \\notin \\mathbb{Q}$",
  "technique_hint": "Assume the negation, derive a contradiction with the fundamental theorem of arithmetic.",
  "steps": [...]
}
```

**Supported values:**

| `technique` | Description |
|-------------|-------------|
| `"direct"` | Assume P, derive Q |
| `"contrapositive"` | Prove ¬Q → ¬P instead of P → Q |
| `"contradiction"` | Assume ¬(statement), derive a contradiction |
| `"cases"` | Split into exhaustive cases, prove each |
| `"iff"` | Prove P → Q and Q → P separately |
| `"existence"` | Exhibit a witness |
| `"existence-uniqueness"` | Exhibit a witness, prove it's the only one |
| `"constructive"` | Build the object explicitly |
| `"non-constructive"` | Prove existence without building |
| `"induction"` | Base case + inductive step |
| `"strong-induction"` | Base case + assume all k < n |
| `"smallest-counterexample"` | Assume minimal failing case, derive contradiction |
| `"counterexample"` | Single example that disproves |
| `"disproof"` | Show a statement is false |
| `"set-equality"` | Show A ⊆ B and B ⊆ A |
| `"set-containment"` | Show arbitrary x ∈ A implies x ∈ B |
| `"element-membership"` | Show a specific element belongs to a set |
| `"derivation"` | Transform expression (current default behavior) |
| `"combinatorial"` | Prove by counting both sides |

### 2.2 Branching Steps (Cases, Biconditional, Induction)

The current model is a flat `steps[]` array. Real proofs branch. Add a `branches` field to any step:

```json
{
  "id": "even-or-odd",
  "type": "step",
  "label": "Case analysis",
  "math": "\\text{Either } n \\text{ is even or } n \\text{ is odd}",
  "justification": "Integers are partitioned into even and odd",
  "branches": [
    {
      "label": "Case 1: n is even",
      "steps": [
        { "id": "case1-assume", "type": "assumption", "label": "Assume n is even", "math": "n = 2k \\text{ for some } k \\in \\mathbb{Z}", "scope": "branch" },
        { "id": "case1-s1", "type": "step", "label": "...", "math": "..." },
        { "id": "case1-qed", "type": "conclusion", "label": "...", "math": "..." }
      ]
    },
    {
      "label": "Case 2: n is odd",
      "steps": [
        { "id": "case2-assume", "type": "assumption", "label": "Assume n is odd", "math": "n = 2k + 1 \\text{ for some } k \\in \\mathbb{Z}", "scope": "branch" },
        { "id": "case2-s1", "type": "step", "label": "...", "math": "..." },
        { "id": "case2-qed", "type": "conclusion", "label": "...", "math": "..." }
      ]
    }
  ]
}
```

**Use cases:**
- **Case analysis**: 2+ branches, all must reach conclusion
- **If-and-only-if**: exactly 2 branches (⇒ and ⇐)
- **Induction**: 2 branches (base case, inductive step)
- **Strong induction**: 2 branches with different assumption form

**UI rendering:** Branches display as indented sub-sections with collapsible headers. The navigator can traverse depth-first or let users pick a branch.

### 2.3 Assumptions & Hypothesis Tracking

Mathematical proofs constantly introduce, discharge, and reference assumptions. Add explicit tracking:

```json
{
  "id": "assume-neg",
  "type": "assumption",
  "label": "Assume for contradiction",
  "math": "\\text{Suppose } \\sqrt{2} = \\frac{a}{b} \\text{ where } \\gcd(a,b) = 1",
  "scope": "until:contradiction",
  "status": "active"
}
```

**New step types:**

| Type | Purpose | Visual |
|------|---------|--------|
| `"assumption"` | Introduce a hypothesis (for contradiction, WLOG, etc.) | Distinct border, "Assume" badge |
| `"definition"` | Introduce a definition to use in the proof | "Def" badge, referenceable |
| `"contradiction"` | Mark where contradiction is reached | Red accent, ⚡ icon |
| `"recall"` | Reference a previous result or theorem | Link icon, expandable |

The `scope` field tells the UI when the assumption is active:
- `"until:step-id"` — active until a specific step discharges it
- `"global"` — given/axiom, never discharged
- `"branch"` — scoped to current branch only

### 2.4 Cross-Proof References

Proofs build on each other. Add a `ref` field:

```json
{
  "id": "use-fta",
  "type": "recall",
  "label": "By the Fundamental Theorem of Arithmetic",
  "math": "a^2 = 2b^2 \\implies 2 \\mid a",
  "ref": {
    "proof_id": "fundamental-theorem-arithmetic",
    "label": "FTA (Theorem 10.1)"
  },
  "explanation": "Every integer > 1 has a unique prime factorization."
}
```

**`ref` object:**

| Field | Type | Description |
|-------|------|-------------|
| `proof_id` | string | ID of the referenced proof |
| `step_id` | string? | Specific step within that proof (optional) |
| `label` | string | Display label (e.g., "Theorem 4.1") |
| `external` | string? | URL or book reference for external results |

The UI renders references as clickable links that can open the referenced proof in a popover or navigate to it.

### 2.5 Logical Structure Annotations

For proofs involving logical reasoning, annotate the logical form:

```json
{
  "id": "sqrt2-proof",
  "title": "√2 is irrational",
  "technique": "contradiction",
  "logical_form": {
    "statement": "\\sqrt{2} \\notin \\mathbb{Q}",
    "negation": "\\sqrt{2} \\in \\mathbb{Q}",
    "structure": "P",
    "proof_form": "Assume ¬P, derive contradiction"
  },
  "steps": [...]
}
```

**`logical_form` fields:**

| Field | Description |
|-------|-------------|
| `statement` | The theorem being proved (LaTeX) |
| `negation` | The negation (for contradiction/contrapositive) |
| `structure` | Logical form: `"P → Q"`, `"P ↔ Q"`, `"∀x P(x)"`, `"∃x P(x)"`, `"P"` |
| `proof_form` | Human-readable proof strategy |
| `contrapositive` | The contrapositive `"¬Q → ¬P"` (when technique = contrapositive) |
| `quantifier_vars` | Variables and their domains for quantified statements |

This helps the AI explain *why* a particular proof technique was chosen and helps students see the logical skeleton beneath the mathematical content.

### 2.6 Disproof & Counterexample Support

Disproof and counterexamples are a core part of proof curricula. The current model has no way to represent this. Add:

```json
{
  "id": "disprove-all-primes-odd",
  "title": "Not all primes are odd",
  "technique": "counterexample",
  "goal": "Disprove: All prime numbers are odd",
  "logical_form": {
    "statement": "\\forall p \\in \\text{Primes},\\; p \\text{ is odd}",
    "negation": "\\exists p \\in \\text{Primes},\\; p \\text{ is even}",
    "structure": "¬(∀x P(x))"
  },
  "steps": [
    {
      "id": "counter",
      "type": "counterexample",
      "label": "Counterexample: p = 2",
      "math": "p = 2 \\text{ is prime and } 2 = 2(1) \\text{ is even}",
      "explanation": "2 is prime (its only divisors are 1 and 2) and even. One counterexample suffices to disprove a universal statement."
    },
    {
      "id": "qed",
      "type": "conclusion",
      "label": "Statement disproved",
      "math": "\\exists p \\in \\text{Primes}: p \\text{ is even} \\implies \\neg(\\forall p \\in \\text{Primes}: p \\text{ is odd})",
      "justification": "A single counterexample disproves a universal claim"
    }
  ]
}
```

**New step type:** `"counterexample"` — rendered with a distinct style (e.g., red border, ✗ icon) to distinguish from constructive proofs.

### 2.7 Induction Template

Induction proofs follow a rigid structure. Provide first-class support:

```json
{
  "id": "sum-formula",
  "title": "Sum of first n integers",
  "technique": "induction",
  "goal": "Prove $\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$ for all $n \\geq 1$",
  "induction": {
    "variable": "n",
    "domain": "\\mathbb{Z}^+",
    "base_value": 1,
    "predicate": "P(n): \\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
    "variant": "weak"
  },
  "steps": [
    {
      "id": "base",
      "type": "given",
      "label": "Base case: P(1)",
      "math": "\\sum_{i=1}^{1} i = 1 = \\frac{1 \\cdot 2}{2} \\; \\checkmark",
      "tags": ["base-case"]
    },
    {
      "id": "ih",
      "type": "assumption",
      "label": "Inductive hypothesis",
      "math": "\\text{Assume } P(k): \\sum_{i=1}^{k} i = \\frac{k(k+1)}{2}",
      "scope": "branch",
      "tags": ["inductive-hypothesis"]
    },
    {
      "id": "show",
      "type": "step",
      "label": "Show P(k+1)",
      "math": "\\sum_{i=1}^{k+1} i = \\left(\\sum_{i=1}^{k} i\\right) + (k+1) = \\htmlClass{hl-ih}{\\frac{k(k+1)}{2}} + (k+1)",
      "highlights": {
        "ih": { "color": "green", "label": "Applying the inductive hypothesis" }
      },
      "justification": "Split off last term, apply IH to the sum",
      "tags": ["inductive-step"]
    },
    {
      "id": "simplify",
      "type": "step",
      "label": "Simplify",
      "math": "= \\frac{k(k+1) + 2(k+1)}{2} = \\frac{(k+1)(k+2)}{2}",
      "justification": "Common denominator, factor"
    },
    {
      "id": "qed",
      "type": "conclusion",
      "label": "P(k+1) holds",
      "math": "\\frac{(k+1)(k+2)}{2} = \\frac{(k+1)((k+1)+1)}{2} \\; \\checkmark",
      "justification": "This is exactly $P(k+1)$. By induction, $P(n)$ holds for all $n \\geq 1$."
    }
  ]
}
```

The `induction` metadata enables the UI to:
- Show the predicate P(n) prominently
- Visually separate base case from inductive step
- Highlight where the inductive hypothesis is applied
- Support strong induction variant (`"variant": "strong"`)

### 2.8 Proof Skeleton / Template System

For education, students need to learn proof *patterns* before specific proofs. Add a `skeleton` mode:

```json
{
  "id": "template-direct-proof",
  "title": "Direct Proof Template",
  "technique": "direct",
  "is_template": true,
  "goal": "Prove: If P, then Q",
  "logical_form": {
    "structure": "P → Q",
    "proof_form": "Assume P. ... Therefore Q."
  },
  "steps": [
    {
      "id": "t1",
      "type": "assumption",
      "label": "Assume the hypothesis",
      "math": "\\text{Assume } P",
      "placeholder": true,
      "explanation": "State what you're assuming. This is the 'if' part."
    },
    {
      "id": "t2",
      "type": "step",
      "label": "Chain of reasoning",
      "math": "P \\implies \\cdots \\implies Q",
      "placeholder": true,
      "explanation": "Use definitions, known theorems, and logical deductions to work toward Q."
    },
    {
      "id": "t3",
      "type": "conclusion",
      "label": "Conclude",
      "math": "\\therefore Q",
      "explanation": "State the conclusion. This is the 'then' part."
    }
  ]
}
```

**`placeholder: true`** marks steps that the student fills in. The AI can guide them through instantiating the template for a specific theorem.

### 2.9 Difficulty & Prerequisite Metadata

For self-paced learning, add metadata that helps sequence proofs:

```json
{
  "id": "cantor-diagonal",
  "title": "R is uncountable",
  "technique": "contradiction",
  "difficulty": 3,
  "prerequisites": ["countable-sets-def", "bijection-def"],
  "concepts": ["cardinality", "uncountable", "diagonal-argument"],
  "steps": [...]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `difficulty` | 1-5 | 1 = definition-level, 5 = research-level |
| `prerequisites` | string[] | IDs of proofs/definitions that should be understood first |
| `concepts` | string[] | Mathematical concepts used (for search/filtering) |

### 2.10 Definition Objects

Proofs are built on precise definitions. Definitions deserve their own first-class representation:

```json
{
  "type": "definition",
  "id": "def-even",
  "label": "Even integer",
  "math": "n \\text{ is even} \\iff \\exists k \\in \\mathbb{Z},\\; n = 2k",
  "notation": "2 \\mid n",
  "examples": ["n = 6: k = 3", "n = 0: k = 0"],
  "non_examples": ["n = 7"],
  "tags": ["number-theory", "parity"]
}
```

Definitions can appear as proof steps (type `"definition"`) or as standalone objects in a `definitions` array at the scene/file level. Proofs reference them via `ref` objects — use the definition's `id` as the `proof_id` value.

### 2.11 Citations

See the [Citations Proposal](citations-proposal.md) for the full design. In summary: a file-level `citations` list defines sources once by `id`, and any scene, step, proof, or proof step can reference them via a `cite` array with per-use overrides (chapter, page, etc.). The resolved citation merges the base definition with the cite ref's overrides.

---

## 3. Updated Step Types

| Type | Current | New | Visual | Purpose |
|------|:-------:|:---:|--------|---------|
| `given` | ✅ | ✅ | Blue-left border | Starting facts |
| `step` | ✅ | ✅ | Default | Deduction/transformation |
| `conclusion` | ✅ | ✅ | Green box, ∎ | QED |
| `remark` | ✅ | ✅ | Italic, dim | Aside |
| `assumption` | — | ✅ | Purple border, "Assume" badge | Hypothesis (for contradiction, etc.) |
| `definition` | — | ✅ | Gray box, "Def" badge | Precise definition |
| `contradiction` | — | ✅ | Red border, ⚡ | Contradiction reached |
| `counterexample` | — | ✅ | Red border, ✗ | Disproof witness |
| `recall` | — | ✅ | Link icon, expandable | Reference to prior result |

---

## 4. Updated Proof Object Fields

### 4.1 New Proof-Level Fields

All new fields are optional additions to the existing proof object.

| Field | Type | Description |
|-------|------|-------------|
| `technique` | string | Proof technique (see §2.1 for values) |
| `technique_hint` | string | Human-readable hint about the proof strategy |
| `logical_form` | object | Logical structure metadata (see below) |
| `induction` | object | Induction-specific metadata (see below) |
| `difficulty` | 1–5 | 1 = definition-level, 5 = research-level |
| `prerequisites` | string[] | IDs of proofs/definitions that should be understood first |
| `concepts` | string[] | Mathematical concepts used (for search/filtering) |
| `cite` | object[] | Citation references with overrides (see [citations proposal](citations-proposal.md)) |
| `is_template` | boolean | Whether this is a proof skeleton with placeholder steps |

### 4.2 New Proof Step Fields

| Field | Type | Description |
|-------|------|-------------|
| `branches` | object[] | Sub-branches for case analysis, induction, etc. Each has `label` and `steps` array (use an `assumption` step as the first step to introduce the branch hypothesis) |
| `ref` | object | Reference to another proof (`proof_id`, `step_id`, `label`, `external`) |
| `scope` | string | When an assumption is active: `"until:step-id"`, `"global"`, or `"branch"` |
| `placeholder` | boolean | Marks a template step for students to fill in |
| `status` | string | `"active"` or `"discharged"` (for assumptions) |
| `cite` | object[] | Citation references with overrides |

### 4.3 Logical Form Object

| Field | Type | Description |
|-------|------|-------------|
| `statement` | string | The theorem being proved (LaTeX) |
| `negation` | string | The negation (for contradiction/contrapositive) |
| `contrapositive` | string | The contrapositive ¬Q → ¬P |
| `structure` | string | Logical form: `"P → Q"`, `"P ↔ Q"`, `"∀x P(x)"`, `"∃x P(x)"`, `"P"` |
| `proof_form` | string | Human-readable proof strategy |
| `quantifier_vars` | object | Variables and their domains for quantified statements |

### 4.4 Induction Metadata Object

| Field | Type | Description |
|-------|------|-------------|
| `variable` | string | Induction variable name |
| `domain` | string | Domain (LaTeX, e.g. `"\\mathbb{Z}^+"`) |
| `base_value` | number or number[] | Base case value(s) |
| `predicate` | string | The predicate P(n) being proved (LaTeX) |
| `variant` | string | `"weak"`, `"strong"`, or `"smallest-counterexample"` |

### 4.5 Proof Reference Object

| Field | Type | Description |
|-------|------|-------------|
| `proof_id` | string? | ID of the referenced proof or definition |
| `step_id` | string? | Specific step within that proof (optional) |
| `label` | string | Display label (e.g. "Theorem 4.1") |
| `external` | string? | Optional external URL or reference |

---

## 5. Backward Compatibility

All new fields are **optional**. Existing proof JSONs (like `test-proof-quadratic.json`) remain 100% valid. The changes are purely additive:

- Missing `technique` → treated as `"derivation"` (current behavior)
- Missing `branches` → flat step list (current behavior)
- Missing `logical_form` → no logical structure display
- Missing `difficulty` / `prerequisites` → no sequencing metadata

The renderer checks for new fields and enhances display when present.

---

## 6. UI Impact Summary

| Feature | UI Change |
|---------|-----------|
| `technique` | Badge in proof header ("Direct Proof", "By Contradiction", etc.) |
| `branches` | Indented sub-sections with collapse/expand |
| `assumption` type | Purple left border + "Assume" badge, fades when discharged |
| `contradiction` type | Red flash animation + ⚡ icon |
| `counterexample` type | Red border + ✗ icon |
| `recall` type | Clickable link → opens referenced proof in popover |
| `logical_form` | Collapsible "Logical Structure" section above steps |
| `induction` | Split view: base case / inductive step with IH highlighted |
| `is_template` | Placeholder steps shown as dashed outlines with fill prompts |
| `difficulty` | Star rating in proof header |
| `prerequisites` | "Prerequisites" expandable section with links |

---

## 7. Example: Proof by Contradiction

**√2 is irrational (standard undergraduate proof):**

```json
{
  "id": "sqrt2-irrational",
  "title": "√2 is irrational",
  "technique": "contradiction",
  "technique_hint": "Assume √2 is rational, write as a/b in lowest terms, then show both a and b must be even — contradicting lowest terms.",
  "difficulty": 2,
  "prerequisites": ["def-rational", "fundamental-theorem-arithmetic"],
  "concepts": ["irrationality", "contradiction", "parity"],
  "cite": [{ "id": "textbook", "chapter": 6, "section": 1 }],
  "goal": "Prove that $\\sqrt{2}$ is irrational",
  "logical_form": {
    "statement": "\\sqrt{2} \\notin \\mathbb{Q}",
    "negation": "\\sqrt{2} \\in \\mathbb{Q}",
    "structure": "P",
    "proof_form": "Assume ¬P (√2 is rational), derive contradiction"
  },
  "steps": [
    {
      "id": "assume",
      "type": "assumption",
      "label": "Assume for contradiction",
      "math": "\\text{Suppose } \\sqrt{2} \\in \\mathbb{Q}",
      "scope": "until:contradiction",
      "explanation": "We assume the opposite of what we want to prove."
    },
    {
      "id": "write-fraction",
      "type": "step",
      "label": "Write as fraction in lowest terms",
      "math": "\\sqrt{2} = \\frac{a}{b}, \\quad a,b \\in \\mathbb{Z},\\; b \\neq 0,\\; \\gcd(a,b) = 1",
      "justification": "Definition of rational + reduce to lowest terms",
      "explanation": "Any rational number can be written as a/b where a and b share no common factors."
    },
    {
      "id": "square",
      "type": "step",
      "label": "Square both sides",
      "math": "2 = \\frac{a^2}{b^2} \\implies \\htmlClass{hl-key}{a^2 = 2b^2}",
      "highlights": {
        "key": { "color": "yellow", "label": "a² is even, so a must be even" }
      },
      "justification": "Square both sides, multiply by $b^2$"
    },
    {
      "id": "a-even",
      "type": "step",
      "label": "a must be even",
      "math": "2 \\mid a^2 \\implies 2 \\mid a \\implies a = 2k",
      "justification": "If $a^2$ is even, then $a$ is even (contrapositive of: odd² is odd)",
      "ref": {
        "proof_id": "odd-squared-is-odd",
        "label": "Lemma: odd² is odd"
      }
    },
    {
      "id": "substitute",
      "type": "step",
      "label": "Substitute a = 2k",
      "math": "(2k)^2 = 2b^2 \\implies 4k^2 = 2b^2 \\implies \\htmlClass{hl-b}{b^2 = 2k^2}",
      "highlights": {
        "b": { "color": "orange", "label": "b² is also even, so b is even" }
      },
      "justification": "Substitute $a = 2k$ into $a^2 = 2b^2$"
    },
    {
      "id": "b-even",
      "type": "step",
      "label": "b must be even",
      "math": "2 \\mid b^2 \\implies 2 \\mid b",
      "justification": "Same reasoning as for $a$"
    },
    {
      "id": "contradiction",
      "type": "contradiction",
      "label": "Contradiction!",
      "math": "2 \\mid a \\text{ and } 2 \\mid b \\implies \\gcd(a,b) \\geq 2",
      "explanation": "But we assumed gcd(a,b) = 1. Both a and b being even contradicts our assumption that the fraction was in lowest terms."
    },
    {
      "id": "qed",
      "type": "conclusion",
      "label": "√2 is irrational",
      "math": "\\htmlClass{hl-result}{\\sqrt{2} \\notin \\mathbb{Q}} \\quad \\blacksquare",
      "highlights": {
        "result": { "color": "green", "label": "Proved by contradiction" }
      },
      "justification": "The assumption that $\\sqrt{2} \\in \\mathbb{Q}$ leads to contradiction, so it must be false."
    }
  ]
}
```

---

## 8. Example: Induction Proof with Branches

**Sum of first n integers (classic induction example):**

```json
{
  "id": "sum-first-n",
  "title": "Sum of first n natural numbers",
  "technique": "induction",
  "difficulty": 1,
  "cite": [{ "id": "textbook", "chapter": 10, "section": 1 }],
  "goal": "Prove: $\\forall n \\geq 1,\\; 1 + 2 + \\cdots + n = \\frac{n(n+1)}{2}$",
  "logical_form": {
    "statement": "\\forall n \\in \\mathbb{Z}^+,\\; \\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
    "structure": "∀n P(n)",
    "proof_form": "Induction on n"
  },
  "induction": {
    "variable": "n",
    "domain": "\\mathbb{Z}^+",
    "base_value": 1,
    "predicate": "P(n): \\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
    "variant": "weak"
  },
  "steps": [
    {
      "id": "setup",
      "type": "step",
      "label": "Define the predicate",
      "math": "P(n): 1 + 2 + \\cdots + n = \\frac{n(n+1)}{2}",
      "explanation": "We prove P(n) holds for all positive integers by induction.",
      "branches": [
        {
          "label": "Base Case: P(1)",
          "steps": [
            {
              "id": "base",
              "type": "step",
              "label": "Verify P(1)",
              "math": "\\text{LHS} = 1, \\quad \\text{RHS} = \\frac{1 \\cdot 2}{2} = 1 \\; \\htmlClass{hl-check}{\\checkmark}",
              "highlights": {
                "check": { "color": "green", "label": "Base case verified" }
              },
              "tags": ["base-case"]
            }
          ]
        },
        {
          "label": "Inductive Step: P(k) → P(k+1)",
          "steps": [
            {
              "id": "ih",
              "type": "assumption",
              "label": "Inductive hypothesis",
              "math": "\\text{Assume } P(k): \\sum_{i=1}^{k} i = \\frac{k(k+1)}{2}",
              "scope": "branch",
              "tags": ["inductive-hypothesis"]
            },
            {
              "id": "show-goal",
              "type": "step",
              "label": "Want to show P(k+1)",
              "math": "\\sum_{i=1}^{k+1} i = \\frac{(k+1)(k+2)}{2}"
            },
            {
              "id": "split",
              "type": "step",
              "label": "Split off last term",
              "math": "\\sum_{i=1}^{k+1} i = \\htmlClass{hl-ih}{\\sum_{i=1}^{k} i} + (k+1) = \\htmlClass{hl-ih}{\\frac{k(k+1)}{2}} + (k+1)",
              "highlights": {
                "ih": { "color": "cyan", "label": "Replaced by inductive hypothesis" }
              },
              "justification": "Apply IH to the first k terms"
            },
            {
              "id": "algebra",
              "type": "step",
              "label": "Simplify",
              "math": "= \\frac{k(k+1) + 2(k+1)}{2} = \\frac{(k+1)(k+2)}{2}"
            },
            {
              "id": "done",
              "type": "conclusion",
              "label": "P(k+1) verified",
              "math": "\\sum_{i=1}^{k+1} i = \\frac{(k+1)(k+2)}{2} \\; \\htmlClass{hl-qed}{\\checkmark}",
              "highlights": {
                "qed": { "color": "green", "label": "Matches P(k+1)" }
              },
              "tags": ["inductive-step"]
            }
          ]
        }
      ]
    },
    {
      "id": "final",
      "type": "conclusion",
      "label": "By mathematical induction",
      "math": "\\htmlClass{hl-result}{\\forall n \\geq 1,\\; \\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}} \\quad \\blacksquare",
      "highlights": {
        "result": { "color": "green", "label": "Proved by induction" }
      },
      "justification": "Base case holds, inductive step proved. By the principle of mathematical induction, P(n) holds for all n ≥ 1."
    }
  ]
}
```

---

## 9. Implementation Priority

| Priority | Feature | Effort | Impact |
|:--------:|---------|:------:|:------:|
| **P0** | `technique` field + UI badge | S | High — instant proof classification |
| **P0** | New step types (`assumption`, `contradiction`, `counterexample`, `recall`, `definition`) | M | High — enables non-derivation proofs |
| **P1** | `branches` for case analysis / induction | L | High — unlocks most proof curriculum content |
| **P1** | `logical_form` metadata | S | Medium — helps AI explain proof strategy |
| **P1** | Cross-proof `ref` links | M | Medium — connects proof ecosystem |
| **P2** | `induction` metadata | S | Medium — specialized induction display |
| **P2** | `difficulty` + `prerequisites` | S | Medium — learning path sequencing |
| **P2** | `cite` + `concepts` | S | Low — catalog/search/sourcing feature |
| **P3** | `is_template` + `placeholder` steps | M | Medium — interactive proof writing |
| **P3** | `scope` + assumption tracking | M | Medium — sophisticated proof display |

---

## 10. Summary

The current proof model excels at **algebraic derivations** — the "follow the equals signs" kind of proof. Standard proof curricula reveal that mathematical proofs are far richer:

- They **branch** (cases, if-and-only-if, induction)
- They **assume and discharge** (contradiction, contrapositive)
- They **reference** prior results (theorems, lemmas, definitions)
- They **disprove** (counterexamples)
- They follow **patterns** (templates that students must learn)
- They have **logical structure** (∀, ∃, →, ↔)

The proposed additions are all backward-compatible and incrementally adoptable. Start with `technique` + new step types (P0), which immediately unlock the ability to represent any standard proof type. Then add branching (P1) for the structurally complex proofs.

