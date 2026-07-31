# `LineAdapter`

A DSPy adapter whose wire format has **no escape layer**, so LaTeX — and anything
else backslash-heavy — survives byte-identical.

Nothing here is AlgeBench-specific; it is written to be proposable upstream.

## What it is

A drop-in `dspy.Adapter` that keeps `ChatAdapter`'s `[[ ## field ## ]]` markers
but replaces the JSON inside them with plain lines:

```
[[ ## steps ## ]]
change_type: rewrite
operation: Divide both sides by $a$
expr_latex: x^{2} + \frac{b}{a} \cdot x = -\frac{c}{a}
justification: Make the leading coefficient 1.

change_type: solve
operation: Take the square root
expr_latex: x + \frac{b}{2a} = \pm\sqrt{\frac{b^2-4ac}{4a^2}}
justification: Both roots are kept.
```

A value is *everything after `key: ` to end of line*, taken literally. Repeated
blocks separated by a blank line are a list. That is the whole format.

## Why we need it

**Every DSPy adapter that ships carries structured field values as JSON.**
`ChatAdapter` *looks* like it doesn't — its markers are plain text — but the
marker only wraps the field; the **value** goes through `json_repair` for any
annotation that is not exactly `str`. So `list[str]` is JSON, a pydantic model is
JSON, and `BAMLAdapter` is JSON too (it subclasses `JSONAdapter` and only changes
how the schema is *described*).

That is fatal for LaTeX, because **JSON string escaping and LaTeX both use
backslash**, and five letters collide:

```
\b  \f  \n  \r  \t   ->   \beta  \frac  \neq  \right  \theta  \times  \tau
```

A model writing `"\right"` instead of `"\\right"` produces **valid** JSON that
decodes to a carriage return followed by `ight` — which then parses as the
implicit product `i·g·h·t`.

Nothing errors. The expression is still well-formed, merely *different*, and it
reaches the reader wearing whatever confidence badge the pipeline computed.
Observed in production:

```
written:   \left(x + \frac{b}{2 \cdot a}\right)^{2}
rendered:  \left(x + \frac{b}{2 \cdot a} \cdot i \cdot g \cdot h \cdot t\right)^{2}
badge:     "valid by domain knowledge" — 100% confidence
```

### Why the obvious fixes don't work

- **Prompt harder?** The model is already right. Measured over a full response it
  escaped **90/90** correctly. This is a rare sampling slip on a task it performs
  correctly, so there is nothing for an instruction to bite on.
- **Repair it?** Guesswork. `\r` + `ight` is a *legitimate* reading of those
  bytes; nothing can distinguish "meant `\right`" from "meant a carriage return".
- **Structured outputs?** They constrain the grammar to *valid* JSON — and
  `"\right"` **is** valid JSON. It kills the invalid-escape half (`\Delta` breaks
  the parse, loudly) and leaves the silent half untouched.
- **YAML?** Backslash-safe in plain scalars, but a colon in prose is a hard parse
  error and `{x}` silently becomes a mapping — a new silent failure for an old one.

So the fix is not to police the escaping. **It is to delete the task**: with no
escape sequences in the format, there is nothing for the model to get right and
nothing it can get wrong.

### Why this shape

RFC 822 — email/HTTP headers, Debian `deb822`, GNU recutils — not an invention.
Two properties earn their keep:

- **Split on the FIRST colon only**, so a colon inside a value is safe
  (`operation: Note: divide by a`). This is what disqualified YAML.
- **No metacharacters**, so no leading character is reserved. YAML turns `{x}`
  into a mapping; `configparser` chokes on `%`; JSON turns `\right` into a control
  character. None of that can happen here.

## Usage

```python
from backend.experts.adapters import LineAdapter

with dspy.context(adapter=LineAdapter()):
    pred = self.predict(**kwargs)
```

Scope it to the call that needs it; everything else keeps the globally configured
adapter.

**Structure must be flat in the signature**, not nested in one output field:

```python
steps: list[DerivationStep] = dspy.OutputField(...)   # ✅ one level
trajectory: ProofTrajectory = dspy.OutputField(...)   # ❌ steps nested inside
```

The adapter documents its own format to the model — `format_field_structure`
generates the spec from the signature's annotations and the pydantic field
descriptions, so the prompt cannot drift from the parser.

## Measured

A real derivation through the derive expert:

| | |
|---|---|
| commands written with **one** backslash | **97** |
| commands written with two | **0** |
| raw control characters | **none** |
| LM calls | **1** |

`\frac` ×28, `\right` ×8, `\text` ×1 — the three that collide with JSON escapes —
all written as in a document, all arriving intact.

---

# Limitations

The design bet is narrow and deliberate: remove the escape layer, and pay for it
by restricting what a value may contain. Everything below is that bill. Most
items are **enforced** — the format raises rather than guessing — because a silent
failure here would be the same class of bug the adapter exists to remove.

## 1. A value cannot contain a newline

The core constraint, and what buys the escape-free property. A value runs to end
of line, so a newline has nowhere to go.

Enforced both ways: `render_value` refuses to *emit* one; `parse_field` refuses to
read a line that is not `key: value` (which is what a spilled value looks like).

**Verified safe for AlgeBench**: 366/366 values across `expr_latex`, `operation`
and `justification` in every saved proof contain no CR or LF — and LaTeX has no
use for one (its line break is `\\`; a literal newline is whitespace).

**It would bite** a field carrying markdown, a code block, or any multi-line
prose. Use `JSONAdapter` for those.

## 2. One level of nesting, and no mappings

| annotation | supported |
|---|---|
| `str`, `int`, `float`, `bool`, `Literal[...]`, `Enum` | yes |
| `Optional[T]` of the above | yes |
| `list[str]`, `list[int]`, … | yes — one item per line |
| `BaseModel` with leaf-only fields | yes — one `key: value` block |
| `list[BaseModel]` with leaf-only fields | yes — blocks, blank line between |
| a model with a model/list field | **refused** |
| `list[list[...]]` | **refused** |
| `dict`, `set`, `tuple` | **refused** |

The refusals matter more than they look. An unsupported annotation used to fall
through to DSPy's `parse_value` — which is `json_repair` — silently reinstating
the exact escaping this removes. `dict` did that; `list[list[...]]` was silently
flattened. Both now raise.

## 3. Empty list items cannot be represented

A blank line *is* the absence of an item, so `['a', '', 'b']` would read back as
`['a', 'b']`. Refused at render time rather than round-tripping lossily.

## 4. DSPy media/tool types are refused as outputs

`Image`, `Audio`, `ToolCalls` and friends are `BaseType` subclasses that serialise
into multimodal **message content blocks**, not text. `Image` is the trap: its
only field is `url: str`, so it passes a naive leaf test and would render as
`url: …` — text where the provider expects an image part.

They stay fine as **inputs**, because this adapter does not touch the input path.

## 5. Only OUTPUT fields are line-oriented — inputs are still JSON

`format_user_message_content` is inherited untouched, so a structured **input** is
still JSON-encoded:

```
[[ ## ctx ## ]]
{"note": "\\frac{b}{2a}"}
```

**Not a correctness risk** — we generate that JSON with `json.dumps`, so its
escaping is machine-correct and the model-writes-JSON bug cannot occur inbound.

It still matters twice: it is an asymmetry to close before proposing upstream, and
it shows the model doubled backslashes in the input while the prompt demands
single ones in the output. Not observed to cause drift (97 single / 0 doubled in a
live run) but a plausible way to erode the property.

Harmless today for `ProofCompletionSig`, whose inputs are all `str`.

## 6. The inherited fallback is silent — and it hides bugs here

`ChatAdapter.__call__` catches **any** exception and re-runs the entire call
through `JSONAdapter`, logging nothing. `LineAdapter` inherits that.

- A parse bug here is **invisible**: the call succeeds, costing a second LM call
  and reinstating JSON escaping for that response.
- **It already fooled the author.** During development the parser rejected
  indentation, the model indented (mirroring the generated prompt example), and
  the fallback quietly rescued the call — so a broken parse looked like a clean
  success until per-call history was inspected.

**Mitigation**: pair with a check that rejects control characters in LaTeX fields.
Overriding `__call__` to log or disable the fallback is the fuller fix.

## 7. Run-together blocks can merge if a model is all-optional

Two blocks with no blank line between them are caught by the duplicate-key rule —
they necessarily repeat a key. That holds for any model with required fields.

It would **not** hold for an all-optional model whose run-together blocks set
*disjoint* fields: they would merge into one record silently. Not reachable for
`DerivationStep` (every field is required), but it is a property of the data
model, not of the format.

## 8. Keys must be bare identifiers

`KEY_PATTERN` requires `[A-Za-z_][A-Za-z0-9_]*`, so a pydantic field with a
non-identifier alias cannot be addressed. Deliberate — it is what lets
prose-before-a-colon be recognised as a spilled value rather than a key.

## 9. Coupled to DSPy's `Adapter` interface

Three methods are overridden (`format_field_structure`,
`format_assistant_message_content`, `parse`), plus reliance on
`field_header_pattern` and `parse_value`. That surface is not stable across DSPy
versions — the same fragility that left structured outputs broken in 2.6.27 via an
unrelated `__config__` signature change.

## 10. Model compliance is measured at n=1

The live run above is *encouraging, not conclusive*. **Unmeasured**: whether the
model produces this format as reliably as a JSON schema across many calls, other
signatures, and other models — and what the failure mode looks like when it
doesn't. The prompt no longer carries a JSON schema, which is a real thing given
up. This deserves the two-tier benchmark harness (issue #510) before wider
adoption.

---

## When to use `JSONAdapter` instead

- any field needing multi-line values (markdown, code)
- any nested structure that cannot be flattened into the signature
- `dict`-shaped output
- media/tool **output** fields
