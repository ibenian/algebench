# `domains/` — example seed catalog for the ProofCompletionExpert

This package is the **sole source of training and evaluation data** for the
`ProofCompletionExpert`. There is no external corpus — every example in
`data/proof_completion/{train,eval}.jsonl` is generated from the seeds defined
here.

## What a "domain" is

A **domain** is a named bucket of math (`algebra`, `calculus`, `equation_solving`,
`inequalities`, `logic`, `rational`). It is **not** a routing/branching key — a
single expert handles every domain. The domain string is used in four places
(see "Where domains are used" below).

Each domain lives in **its own file** here and **self-registers** a seed builder.
Adding a domain = drop a new file; `discover_domains()` imports it automatically.

## The API (`base.py`)

```python
@dataclass(frozen=True)
class Seed:
    domain: str          # which domain this seed belongs to
    intent: str          # natural-language goal ("expand the square", "solve for x")
    expr: sp.Expr        # the starting expression
    chain: tuple = ()    # OPTIONAL: an explicit scripted derivation (see below)

@register_domain("name")          # decorator: registers a seed builder
def seeds(rng: random.Random) -> list[Seed]: ...

DOMAIN_REGISTRY: dict[str, Callable[[random.Random], list[Seed]]]
x, y, a, b, c, n = sp.symbols(...)   # shared symbols
```

A seed builder takes a seeded `random.Random` and returns a list of `Seed`s.
Because it receives `rng`, seeds can be **parameterized** (random coefficients,
roots, etc.) — so a domain yields fresh variety on every draw, not a fixed list.

## Two kinds of seed

1. **Random-chain seed** — only `expr` is set. The dataset generator
   (`dataset.make_expr_chain`) builds the derivation by applying a **random
   ordered subset of sympy transforms** (`expand`, `factor`, `together`,
   `cancel`, `simplify`, `doit`, `apart`, `trigsimp`), keeping only the
   structure-changing steps. Good for "expand/factor/simplify"-style examples.
   Chain length is capped by `max_steps` (small by default → mostly 1–2 steps).

2. **Scripted-chain seed** — `chain=(e0, e1, …, eN)` is set. The tuple is used
   **verbatim**: a real, goal-directed, multi-step derivation a human would write
   (e.g. `ax + b = c → ax = c - b → x = (c-b)/a`). This is where the **longer,
   pedagogical** derivations come from — sympy's random transforms can't produce
   them (it can *verify* any chain but only *generate* a narrow set).

### Current catalog (scripted vs. random)

| Domain | Mode |
|---|---|
| `algebra` | random rewrite chains (expand/factor) |
| `calculus` | random rewrite chains (differentiate/expand) |
| `rational` | random rewrite chains (together/apart/cancel) |
| `equation_solving` | **scripted** multi-step chains (linear, √, shifted square, isolate) |
| `inequalities` | **scripted** multi-step chains |
| `logic` | **scripted** (implication rewrites) + random |

## How a seed becomes an example (`dataset.py`)

```
generate(n, seed) →
  pick a domain → DOMAIN_REGISTRY[domain](rng) → list[Seed] → pick one seed
  → chain = seed.chain (verbatim) OR make_expr_chain(seed.expr, rng)   # the two modes
  → for each expr: latex_to_graph(latex(expr), domain) → SemanticGraph
  → thread per-step diffs into a gold trajectory (apply(start, gold) ≅ target)
  → dspy.Example(context=GraphTransition(start, target, domain, intent),
                 trajectory=GraphTrajectory(gold steps), gold_ops, step_exprs, …)
```

Every example is **filtered**: each step must be sympy-groundable, the chain must
have ≥2 distinct states and ≤ `max_ops` ops, and the threaded gold must reproduce
the target. **Train uses one seed, eval another**, so eval is genuinely held out.

## Where domains are used

1. **Dataset generation (here)** — the seed catalog; the only source of train/eval.
2. **Parser/cache hint** — `domain` is passed to `SemanticGraphService.latex_to_graph(latex, domain=…)`.
3. **Evaluation breakdown** — `proof_completion_evaluate.py` reports metrics per
   domain (the "BY DOMAIN" table).
4. **Model input hint** — `domain` is a (possibly empty) input field on the
   signature, an advisory nudge about the kind of math.

It flows: `GraphTransition.domain` → `module.forward` → both `latex_to_graph()` and the prompt.

## Adding a domain

1. Create `domains/<name>.py`.
2. Define a seed builder and register it:
   ```python
   from .base import Seed, register_domain, x

   @register_domain("trig")
   def seeds(rng):
       k = rng.randint(1, 4)
       return [
           Seed("trig", "use the double-angle identity", sp.sin(2 * k * x)),  # random-chain
           # or a scripted chain:
           # Seed("trig", "prove ...", chain[0], chain=(e0, e1, e2)),
       ]
   ```
3. Regenerate the datasets (`scripts/proof_completion_generate.py`). No other edits —
   `discover_domains()` picks the file up automatically.

## Tuning the training set

Training diversity ≈ **(seed catalog) × (sympy's transform menu)**. To make the
expert stronger on richer derivations, **add scripted-chain seeds** (the high-value
lever) rather than relying on random transforms, which only generate a narrow,
mostly-short set.

### Variety > size (for DSPy optimization)

For DSPy optimizers (MIPROv2 / BootstrapFewShot / GEPA), **variety matters more
than raw example count.** These optimizers don't do gradient training over the
whole set — they search for good *instructions* and pick a *handful* of few-shot
demos, scoring candidates on the trainset. So what helps is **broad coverage of
distinct patterns** (domains, structures, operation types, chain shapes), not
volume:

- **Near-duplicate examples add cost, not signal.** 500 slightly-different
  "expand a binomial" examples teach the optimizer roughly what 5 do — but cost
  100× the LM calls per optimization round.
- **Each genuinely new pattern is worth more than many variations of an existing
  one.** A few scripted derivations of a *new shape* (a new move, a new domain)
  shift the metric; another randomized coefficient on an existing shape barely
  does.
- **Practical guidance:** prefer a **small, maximally-varied** trainset —
  maximize distinct intents / structures / domains, dedupe near-identical chains
  (the generator already dedupes structurally-equal graphs), and grow the set by
  adding *new kinds* of seed, not more draws of the same kind. Keep `n` modest
  and the catalog diverse; that's cheaper to optimize against and generalizes
  better than a large, repetitive set.
