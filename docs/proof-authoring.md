# Authoring Proofs for AlgeBench

> A friendly guide to the **`/prove`** page — what it is, why it exists, how
> submissions get reviewed, and the two ways you can contribute a derivation of
> your own. No prior knowledge of AlgeBench assumed.

**Related docs:**

- [shareable-proof-animations.md](shareable-proof-animations.md) — the technical design of the render/embed surface
- [proofs-model.md](proofs-model.md) — the step-by-step proof & derivation data model
- [Grounded Proof Completion & Animation](https://github.com/ibenian/algebench/discussions/378) — Show & Tell: how a derivation is generated and CAS-verified

---

## 1. What is the prove page?

Open [algebench.org/prove](https://algebench.org/prove) and you land on a small
public library of **mathematical derivations**. Each one is a proof that
*animates*: it starts from one expression, and — step by step — morphs into the
next, the way you'd rewrite a line of algebra on paper, except the terms glide
into their new positions so you can *see* what moved where. Hover a symbol and it
lights up across the step, with a tooltip telling you what it means. Every step
carries a little confidence badge — because behind the scenes a **computer-algebra
system (CAS) has checked that the step is actually valid**, and the badge never
claims more certainty than the checker earned.

A proof is addressed by a two-part name, `<domain>/<name>` — for example
`algebra/quadratic-formula` or `physics/tsiolkovsky-rocket-equation`. That name is
stable: you can link to it, embed it in a blog post as an `<iframe>`, or cite it.

That last part is the whole point. Most AI-generated math is *ephemeral* — you ask,
you read, you close the tab, it's gone. The prove page takes the opposite stance:

> **A derivation is an artifact worth keeping, naming, and citing.**

So `/prove` is a growing, curated *corpus* of derivations, not a chat log. And a
corpus that anyone can add to only stays trustworthy if there's a light-touch
quality gate — which is exactly why submissions are **reviewed** before they join
the public catalog.

---

## 2. The vision

`/prove` exists to build **a shared, growing library of mathematical derivations
that help people *understand* math** — not just confirm that a result is true, but
see *why* and *how* it follows, step by legible step.

**Derivations meant for understanding.** A textbook proof often compresses the
insight out of a result: three lines, half the steps left "to the reader." A proof
on `/prove` does the opposite. It *animates* — each step morphs into the next, so you
watch a term move across the `=` or a product expand rather than having to
reconstruct it. Hover any symbol and it lights up across the step with a plain-words
tooltip. Every step is CAS-verified and carries an honest confidence badge. The goal
is a derivation you can actually *learn from*, whether you're revisiting the
quadratic formula or meeting the Tsiolkovsky rocket equation for the first time.

**Worth keeping, naming, and citing.** Because these derivations are meant to be
useful again and again, each one is a durable artifact: it has a stable
`<domain>/<name>` address, so you can link to it, drop it into a blog post or lesson
as an embedded `<iframe>`, or cite it — instead of it vanishing the moment a chat
tab closes.

**A library anyone can add to.** The value of the collection is in its *breadth and
quality*, so contributing is deliberately low-friction — no accounts, no sign-up
wall (you get a secret edit key instead; see §4). The catalog is meant to grow into
a solid, high-quality set of verified derivations across algebra, calculus, physics,
quantum, series, statistics, and beyond. That growth depends on contributors — and a
light review step (§3) keeps the shared library trustworthy as it grows. Your
derivation is welcome; this guide exists to make adding it easy.

---

## 3. How review works

Contributing doesn't mean your proof instantly appears in the public list. There's a
deliberate **trust boundary** between "submitted" and "published," and it works like
this:

1. **You submit.** Your proof goes into a separate review queue namespace
   (`proof-submissions/…`), *never* directly into the published `proofs/` catalog.
   Along with the proof JSON, the queue keeps your **supporting package**: the prompt
   used to derive it, a `documentation.md` of your reference material, and a
   `references.json` of citations. The proof itself is public; the supporting files
   stay behind your secret edit key.

2. **It's pending (under review).** While in the queue your proof is **hidden from
   the Browse list by default** — so the public catalog only ever shows vetted work.
   But it's not invisible to *you*: it's reachable two ways.
   - By **direct link**: `/prove?id=<domain>/<name>` (the response even carries an
     `X-Proof-Status: under-review` header).
   - In Browse, by ticking **"Show proofs under review"** — it appears with an
     *under review* badge.

   You can keep **editing it in place** with your edit key the whole time it's
   pending (more on the key in §4).

3. **A maintainer promotes it.** Review, and the final move into the public catalog,
   is a deliberate **offline / administrative action** — there is no public HTTP
   endpoint that flips a proof from "pending" to "published." That's the trust
   boundary made concrete. Once promoted, your proof is a normal published proof and
   shows up in Browse for everyone.

**One thing to internalize now:** once a proof is **promoted**, the edit key stops
editing it. A published proof is **clone-only** — to change it you clone it, tweak
it, and submit the result under a *new* name. Editing with the key only works while
the submission is still in the queue.

If you ever "lose" a submission, it's almost always just sitting in the
default-hidden queue. Use the direct link or the *Show proofs under review* toggle —
your proof is safe.

---

## 4. How to contribute — the two paths

There are two ways to author a proof. Pick based on how you like to work:

| | **Path 1 — Prove UI** | **Path 2 — `algebench-prove` skill** |
| --- | --- | --- |
| Best if… | you want to do it by hand, in the browser | you work with a coding agent |
| You provide | your own research + micro-edits | a topic; the agent does the research |
| The math is built by | you, guided by the app | the CAS-verified `derive.py` pipeline |
| Ends at | a submission in the review queue | a proof rendered on `/prove`, ready to submit |

Both paths end in the **same review queue** described in §3. Path 1 is entirely
in-browser and account-free. Path 2 is for people who'd rather have an agent do the
legwork.

---

### Path 1 — The Prove UI (clone → edit → submit)

This is the no-tools, no-agent route. Everything happens on the `/prove` page.

**Step 1 — Find a proof close to what you want, and clone it.**
The fastest way to author a *new* proof is to start from an existing one. Browse the
catalog, open a proof in the neighborhood of your topic, and click **⧉ Clone**. That
drops the proof's data into the **Derive** workspace as an editable starting point.
Cloning is also how you'd make a variant of a *published* proof (which is otherwise
read-only).

**Step 2 — Do your own research.**
A good proof is *grounded* — its every definition, identity, and step should trace
back to a reliable source. Before you touch the math, gather your references:

- **Wikipedia** — broad, well-referenced overviews
- **Wolfram MathWorld** — precise definitions and identities
- **ProofWiki** — formal, step-by-step proofs
- **nLab** — higher / abstract-math framing
- **arXiv or lecture notes** — research-level or applied derivations
- **Encyclopedia of Mathematics** — authoritative reference

Write down, for each source, *what it contributed* — you'll fold this into the
**documentation** field of your submission, and it's what makes your proof
citeable and reviewable.

**Step 3 — Decide the start and the target.**
Every derivation is "get from **here** to **there**." Name both explicitly. For the
quadratic formula that's *start:* `ax² + bx + c = 0`, *target:*
`x = (−b ± √(b²−4ac)) / 2a`. Sketch the high-level route in words first (complete the
square → isolate x). Knowing start → target and the route is 90% of the work.

**Step 4 — Edit in micro-steps.**
In the Derive workspace, shape the derivation one line at a time. Keep each step a
*single, checkable move* — expand a product, move a term across the `=`, apply one
identity. Small steps are easier for the CAS to verify and far easier for a reader
to follow. Fill in each step's operation (what you did) and justification (why it's
allowed). Add the `goal` framing and, if useful, prerequisite and follow-up chips.

**Step 5 — Submit for review.**
Click **↑ Submit**. A dialog asks for a **new unique name**, `<domain>/<name>`. The
name is checked live against built-ins, published proofs, *and* other pending
submissions, so it can never collide. Naming rules:

- lowercase letters, digits, and internal hyphens only
- two segments: `domain` (2–32 chars) and `name` (3–64 chars)
- a handful of reserved names (`index`, `new`, `admin`, `api`, …) are blocked

On success your proof lands in the review queue with its package (prompt,
documentation, references).

**Step 6 — Save your edit key.**
The thank-you dialog shows a **one-time edit key** with a Copy button. **Copy it and
keep it somewhere safe.** It's never stored server-side and never shown again, and
it's your *only* way to edit the pending submission. Remember: it's a hash of the
proof content, so it **rotates every time you update the proof** — always grab the
fresh key after each update.

**Editing later.** Open your pending submission (direct link, or Browse with the
*Show proofs under review* toggle) → click **✎ Edit** → paste the key. It reloads
into Derive in edit mode (prompt and docs restored; **↑ Submit** becomes
**↑ Update**). Make changes → **↑ Update** saves in place and shows the new rotated
key. Two rules worth repeating:

- **Edit only while pending.** After a maintainer promotes your proof, the key no
  longer edits anything — the proof becomes clone-only. Lose the key while it's
  *still* pending, and you're also down to cloning.
- **Same name updates; new name forks.** In the submit dialog, keeping the same name
  updates your pending submission; typing a new name files a *separate* version for
  review. One Derive session can spawn several named versions, each with its own key.

---

### Path 2 — The `algebench-prove` skill (with a coding agent)

If you work with a coding agent, the **`algebench-prove`** skill takes you from
*"I want to derive X"* all the way to a **CAS-verified proof rendered on `/prove`**,
doing the research and the math-building for you. It's **interactive** — at every
decision point it stops and asks, so you stay in control of the topic, the route,
and the name.

**How to start.** Just ask your agent:

```
/algebench-prove the quadratic formula
```

…or in plain language: *"research and prove the normalization constant of the
normal distribution."* The skill's triggers include *build a proof*, *prove this*,
*derive a proof*, and *research a derivation*.

**What the skill does, in order:**

1. **Picks the target.** Confirms *what* you want to prove or derive (offering
   concrete examples if you're not sure).

2. **Offers research sources — opt-in per source.** It identifies the math domain,
   then proposes reliable sources (Wikipedia, MathWorld, ProofWiki, nLab, arXiv,
   Encyclopedia of Mathematics) and lets you **pick which ones** it may consult. It
   researches *only* the sources you choose — nothing behind your back.

3. **Researches and captures citations.** Using web search against your chosen
   sources, it gathers the definitions, identities, and proof outline — recording a
   citation for each (a stable key, the type, the full reference, and one line on
   what it contributed). Correctness is the priority: everything it carries forward
   should be traceable to a source.

4. **Summarizes the research** — definitions, key results, and the *candidate
   derivation(s)* — in words, without dumping algebra on you yet. This summary
   doubles as your submission's **documentation**.

5. **Confirms the derivation path.** It asks you to confirm the **start → target**
   and the **high-level route**, still in words. If the research surfaced several
   valid routes (say, the Gaussian integral via polar coordinates *vs.* via the
   Gamma function), it presents them as options and lets you choose. It won't
   generate until you've said "yes, that route."

6. **Generates the proof — CAS-verified.** Only now does it build the actual
   step-by-step chain, using the **`derive.py`** pipeline from the
   `algebench-proof-anim` skill. That pipeline runs a proof-completion expert to
   propose the steps and then **verifies every step with a computer-algebra
   system**, attaching a confidence tier to each. The steps are *not* hand-guessed,
   and the annotated LaTeX (the term ids that make the animation morph correctly) is
   machine-generated — which is what keeps it both correct and safe to render. If a
   step is wrong, the skill **re-derives** with an adjusted prompt rather than
   hand-editing the JSON.

7. **Names it (collision-checked).** It recommends a kebab-case `<domain>/<name>`
   slug, checks the name is free (against the committed seeds, the runtime store, and
   — if a server is up — the live availability API), and confirms with you before
   saving to `proofs/domains/<domain>/<name>.json`.

8. **Opens it on `/prove`.** It launches the prove server and opens
   `/prove?id=<domain>/<name>` so you can see your derivation render and step through
   it live, then offers a final loop: *looks good / revise a step / rename / build
   another?*

**Research-only mode.** If you just want the *inputs* — a ready-to-use derive prompt
plus the documentation write-up — run it with `--research`:

```
/algebench-prove the normal distribution pdf --research
```

The skill stops after the research summary and hands you a copy-paste **recommended
derivation prompt** and **documentation**, and can (locally) open the `/prove`
**Derive** tab pre-filled with both — so you click **Derive** yourself when ready.

**Two ways the skill's output reaches the public catalog.** Be aware there are two
distinct publish paths, and they end in different places:

1. **Authored + committed (the built-in path).** The skill writes
   `proofs/domains/<domain>/<name>.json`. If that file is merged into the repo via a
   pull request, it ships as a **built-in** — a canonical proof that's always in
   Browse. (Note: the skill won't commit for you unless you ask; you decide, and you
   merge the PR.)
2. **Submit-for-review (the queue path).** Alternatively — exactly like Path 1 — you
   open the derived proof in the Derive tab and click **↑ Submit**. It enters the
   review queue and waits for a maintainer to promote it. Same lifecycle, same edit
   key, same rules as §3–4.

Use the committed path when you're contributing to the repository itself; use the
submit path when you just want your derivation reviewed and published without
touching the codebase.

---

## 5. A note on safety

Because proofs are **public, hand-editable data**, the renderer assumes every proof
might have been written by a hostile stranger — and renders it inertly regardless.
Math goes through KaTeX with a strict trust filter; human text is inserted via
`textContent`, never `innerHTML`; and a strict Content-Security-Policy backstops the
whole page. The practical upshot for you as an author: a proof JSON can't run
scripts, inject HTML, or phone home, so you never have to worry that opening or
cloning someone else's derivation could harm you. The full threat model and the
layered defenses are documented in
[shareable-proof-animations.md §7](shareable-proof-animations.md#7-security-model).

---

## 6. In short

- **`/prove` is a keepable, citeable, embeddable library of CAS-verified
  derivations** — not throwaway AI output.
- **No accounts.** A rotating, content-derived **edit key** is your handle to a
  pending submission. Save it.
- **Everything is reviewed** before it's public: submit → pending (hidden by
  default, reachable by link) → a maintainer promotes it. Published proofs are
  **clone-only**.
- **Two ways to contribute:** author by hand in the **Prove UI** (clone → research →
  micro-edit → submit), or let the **`algebench-prove` skill** research and build a
  verified proof for you.

The corpus grows one good derivation at a time — and yours is welcome. Pick a
theorem you love, follow either path above, and add it to the library.
