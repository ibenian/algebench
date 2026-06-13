"""Step-to-step grounding: rank each derivation transition by CAS-verified confidence.

``grounding.py`` answers "does a single state mean the right math?". This module
answers the question it leaves open: **does step n actually follow from step
n-1?** A well-formed-but-wrong middle step (``x^2 = 4 -> x = 7``) parses fine
and reaches no verdict today; here every consecutive transition is classified
and ranked into one of five confidence tiers. The point is never to fail or
stop processing — only to rank, so consumers (animation badges, CLI, API) can
*show* how solid each step is.

Per transition ``state[k-1] -> state[k]`` we establish a relation:

* ``equivalent`` — ``sympy_equiv`` holds (rewriting / rearrangement).
* ``narrows``    — not equivalent, but the new statement's solution set is
  contained in the previous one's (a valid solving step / branch selection).
* ``refuted``    — provably wrong: introduces non-solutions, or the
  characteristic fingerprints (roots / singularities / limits) provably differ.
* ``unknown``    — sympy can decide neither way.

When symbolic checks are inconclusive we compare **characteristic
fingerprints** — the defining landmarks of a univariate expression (real roots,
singularities, limits at ±oo and at each pole) — instead of sampling points.
Matching landmarks is strong evidence (Verified), differing landmarks a proof
of difference (Refuted), uncomputable landmarks no evidence at all (Plausible).

The model's per-step ``change_type`` (rewrite / solve / substitute /
approximate / given) is an advisory *claim*, never the authority: sympy is the
judge, and a mislabel (e.g. a narrowing step declared ``rewrite``) downgrades
the tier by one notch.

Pure module: sympy only — no LM, no DSPy, no SemanticGraphService. Heavy sympy
calls (solveset / singularities / limit / simplify) run under a wall-clock
guard so a pathological expression degrades to "unknown" instead of hanging.
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from enum import Enum
from typing import Literal, Optional, Sequence

import sympy as sp

from .grounding import _coerce_expr, sympy_equiv

# --------------------------------------------------------------------------- #
# tiers
# --------------------------------------------------------------------------- #


class Tier(str, Enum):
    """Confidence tiers, weakest to strongest (see ``TIER_RANK``)."""

    RED = "refuted"        # computed and wrong
    GRAY = "unchecked"     # state not sympy-convertible — nothing to check
    BLUE = "plausible"     # convertible, not refuted, undecided
    SILVER = "verified"    # landmarks match / proven but mislabeled
    GOLD = "grounded"      # symbolically proven, label consistent


TIER_RANK = {Tier.RED: 0, Tier.GRAY: 1, Tier.BLUE: 2, Tier.SILVER: 3, Tier.GOLD: 4}

TIER_LABEL = {
    Tier.GOLD: "Grounded",
    Tier.SILVER: "Verified",
    Tier.BLUE: "Plausible",
    Tier.GRAY: "Unchecked",
    Tier.RED: "Refuted",
}

TIER_ICON = {
    Tier.GOLD: "🥇",
    Tier.SILVER: "🥈",
    Tier.BLUE: "🔹",
    Tier.GRAY: "○",
    Tier.RED: "✗",
}

# What each tier means, in user-facing words (tooltips). Phrased to follow the
# tier label ("Proven — <meaning>"), so they never repeat it.
TIER_MEANING = {
    Tier.GOLD: "symbolically proven to follow from the previous step",
    Tier.SILVER: "strong CAS evidence, short of a symbolic proof",
    Tier.BLUE: "valid math, but the CAS could not decide this step",
    Tier.GRAY: "this state is not a single convertible expression",
    Tier.RED: "the CAS shows this does NOT follow from the previous step",
}

Relation = Literal["equivalent", "narrows", "refuted", "unknown"]
# "scaled": equivalence up to a nonzero residual factor (multiply/divide both
# sides) — conditional on that factor being nonzero, hence Verified not Proven.
# "numeric": declared-approximate step confirmed within numeric tolerance.
# "parametric": multivariate narrows proven with one symbol as the unknown and
# the rest as GENERIC parameters (solveset's generic manipulations) — Verified.
# "branch": the two equations SQUARE to the same statement — equal up to the
# choice of root branch (principal-root simplifications) — Verified.
Method = Literal["symbolic", "scaled", "fingerprint", "numeric", "parametric",
                 "branch", "none"]

# change_type -> the relations that label would predict. sympy is the judge;
# disagreement marks the pair type-inconsistent (one-notch downgrade). ``solve``
# accepts ``equivalent`` because the canonical solve step (x^2=4 -> x=±2)
# preserves the solution set exactly.
_EXPECTED_RELATIONS = {
    "rewrite": {"equivalent"},
    "solve": {"narrows", "equivalent"},
    "substitute": {"equivalent", "unknown"},
    "approximate": {"unknown", "equivalent"},
    "given": {"equivalent"},
}


# --------------------------------------------------------------------------- #
# report dataclasses
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class PairVerdict:
    """Verdict for one transition ``state[index-1] -> state[index]``."""

    index: int                      # 1-based: the state this transition reaches
    tier: Tier
    relation: Relation
    method: Method
    change_type: Optional[str]      # the model's declared claim, if any
    type_consistent: bool           # did the CAS finding agree with the claim?
    reason: str                     # human one-liner (tooltip text)


@dataclass(frozen=True)
class StepConfidence:
    """Per-STATE confidence (index 0 is the start / premise)."""

    index: int
    tier: Tier
    relation: Optional[Relation]    # None for the start state
    reason: str
    type_consistent: bool


@dataclass(frozen=True)
class StepGroundingReport:
    steps: list                     # list[StepConfidence], one per state
    pairs: list                     # list[PairVerdict], one per transition
    overall: Tier
    counts: dict                    # tier.value -> count, over transitions
    endpoint_reached: Optional[bool]  # final state equiv target (None: unknowable)
    reason: str                     # overall one-liner


# --------------------------------------------------------------------------- #
# timeout guard
# --------------------------------------------------------------------------- #

_TIMEOUT_S = float(os.environ.get("ALGEBENCH_VERIFY_TIMEOUT", "2.0"))

# Indirection so tests can monkeypatch the heavy sympy entry points.
_solveset = sp.solveset
_singularities = sp.singularities
_limit = sp.limit


def _guard(fn, *args, default=None, timeout=None):
    """Run ``fn(*args)`` with a wall-clock bound; ``default`` on timeout/error.

    ``signal.alarm`` is unsafe under the threaded server (and on non-main
    threads generally), so we wait on a worker thread instead. Caveat: Python
    cannot kill a thread — the bound is on *waiting*, not CPU; a runaway sympy
    call keeps its worker busy until it finishes. We mitigate by gating which
    calls run at all (cheap checks first, univariate only).
    """
    t = _TIMEOUT_S if timeout is None else timeout
    ex = ThreadPoolExecutor(max_workers=1)
    try:
        return ex.submit(fn, *args).result(timeout=t)
    except Exception:
        return default
    finally:
        ex.shutdown(wait=False)


# --------------------------------------------------------------------------- #
# expression shape helpers
# --------------------------------------------------------------------------- #


def _kind(e) -> str:
    from sympy.logic.boolalg import BooleanFunction

    if e is None:
        return "none"
    if isinstance(e, sp.Equality):
        return "equation"
    if isinstance(e, sp.core.relational.Relational):
        return "inequality"
    if isinstance(e, BooleanFunction):
        return "boolean"
    return "expression"


def _residual(e):
    """Equation -> lhs - rhs; plain expression unchanged."""
    return e.lhs - e.rhs if isinstance(e, sp.Equality) else e


def _sole_symbol(*exprs):
    """The single shared free symbol, or None (multivariate / constant)."""
    syms = set()
    for e in exprs:
        syms |= e.free_symbols
    return next(iter(syms)) if len(syms) == 1 else None


def _solution_set(e, x, domain=sp.S.Reals):
    """Solution set of a relational / boolean combination of relationals.

    ``Or`` is a union of branches (e.g. ``x = 2 or x = -2``), ``And`` an
    intersection. Raises if sympy can't solve — callers run this under _guard.
    Univariate checks use the reals; the parametric path uses the default
    complex domain, where solveset handles symbolic parameters much better.
    """
    if isinstance(e, sp.Or):
        return sp.Union(*[_solution_set(a, x, domain) for a in e.args])
    if isinstance(e, sp.And):
        return sp.Intersection(*[_solution_set(a, x, domain) for a in e.args])
    return _solveset(e, x, domain)


# --------------------------------------------------------------------------- #
# characteristic fingerprint (roots / singularities / limits — not sampling)
# --------------------------------------------------------------------------- #

# Sentinel for a landmark that exists but is not a finite, comparable set
# (interval / ConditionSet / ImageSet). Distinct from None = "couldn't compute".
_NONFINITE = "nonfinite"


@dataclass(frozen=True)
class _Fingerprint:
    roots: object    # frozenset | _NONFINITE | None
    sings: object    # frozenset | _NONFINITE | None
    limits: dict     # (point_label,) -> sympy value | None


def _finite_set(s):
    """frozenset for a FiniteSet, _NONFINITE for other sets, None otherwise."""
    if isinstance(s, sp.FiniteSet):
        return frozenset(s)
    if isinstance(s, sp.Set):
        return _NONFINITE
    return None


def _fingerprint(e) -> Optional[_Fingerprint]:
    """Defining landmarks of a univariate expression/equation over the reals.

    Returns None when fingerprinting does not apply (inequalities, booleans,
    multivariate, constants) — the caller then has symbolic evidence only.
    """
    if _kind(e) in ("inequality", "boolean", "none"):
        return None
    f = _residual(e)
    x = _sole_symbol(f)
    if x is None:
        return None

    roots = _finite_set(_guard(_solveset, sp.Eq(f, 0), x, sp.S.Reals))
    sings = _finite_set(_guard(_singularities, f, x, sp.S.Reals))

    limits: dict = {}
    limits["+oo"] = _guard(_limit, f, x, sp.oo)
    limits["-oo"] = _guard(_limit, f, x, -sp.oo)
    if isinstance(sings, frozenset):
        for p in sings:
            limits[f"{p}+"] = _guard(_limit, f, x, p, "+")
            limits[f"{p}-"] = _guard(_limit, f, x, p, "-")
    return _Fingerprint(roots=roots, sings=sings, limits=limits)


def _vals_equal(a, b) -> Optional[bool]:
    """True/False if two landmark values are provably equal/different, else None."""
    if a is None or b is None:
        return None
    try:
        if a == b:
            return True
        if a.has(sp.oo, -sp.oo, sp.zoo, sp.nan) or b.has(sp.oo, -sp.oo, sp.zoo, sp.nan):
            return None  # only finite values are compared for difference
        return bool(sp.simplify(a - b) == 0)
    except Exception:
        return None


def _sets_equal(a, b) -> Optional[bool]:
    """True/False for two finite landmark sets, None if either is unusable."""
    if not isinstance(a, frozenset) or not isinstance(b, frozenset):
        return None
    if a == b:
        return True
    try:
        norm = lambda s: {sp.nsimplify(sp.simplify(v)) for v in s}  # noqa: E731
        return norm(a) == norm(b)
    except Exception:
        return None


def _fp_compare(a: _Fingerprint, b: _Fingerprint) -> Optional[bool]:
    """True = landmarks all match, False = a landmark provably differs, None = inconclusive."""
    roots = _sets_equal(a.roots, b.roots)
    sings = _sets_equal(a.sings, b.sings)
    if roots is False or sings is False:
        return False
    lims = []
    for key in set(a.limits) & set(b.limits):
        eq = _vals_equal(a.limits.get(key), b.limits.get(key))
        if eq is False:
            return False
        lims.append(eq)
    if roots is True and sings is True and lims and all(lims):
        return True
    return None


def _fingerprint_relation(prev, curr) -> Optional[bool]:
    """Fingerprint verdict for prev vs curr; equations tried up to sign.

    True = equivalent-by-landmarks, False = refuted, None = inconclusive.
    """
    # Different variable sets (e.g. a substitution introduced `u`): the two
    # landmark sets live on different axes — comparing them proves nothing.
    if getattr(prev, "free_symbols", set()) != getattr(curr, "free_symbols", set()):
        return None
    fa, fb = _fingerprint(prev), _fingerprint(curr)
    if fa is None or fb is None:
        return None
    verdict = _fp_compare(fa, fb)
    # An equation's residual is sign-ambiguous (lhs-rhs vs rhs-lhs): limits
    # negate under the flip, so only refute if BOTH orientations refute.
    if verdict is not True and (_kind(prev) == "equation" or _kind(curr) == "equation"):
        flipped = _fp_compare(fa, _fingerprint(sp.Mul(-1, _residual(curr), evaluate=False)) or fb)
        if flipped is True:
            return True
        if verdict is False and flipped is False:
            return False
        return None
    return verdict


# --------------------------------------------------------------------------- #
# pair classification
# --------------------------------------------------------------------------- #


def classify_pair(prev, curr, change_type: Optional[str] = None,
                  index: int = 1) -> PairVerdict:
    """Classify one transition and rank it. Never raises."""
    if prev is None or curr is None:
        which = "previous" if prev is None else "this"
        return PairVerdict(index, Tier.GRAY, "unknown", "none", change_type, False,
                           f"{which} state is not a single convertible expression")

    relation: Relation = "unknown"
    method: Method = "none"
    reason = "neither equivalence nor a valid narrowing could be established"

    # 1) symbolic equivalence — the cheap, common case (rewrite / rearrange)
    if _guard(sympy_equiv, prev, curr, default=False):
        relation, method = "equivalent", "symbolic"
        reason = "symbolically equivalent to the previous step"
    else:
        # 1b) declared-approximate steps are not exact BY DESIGN — verify them
        # numerically before the exact checks get a chance to "refute" the
        # rounding. A genuinely wrong value still falls through and gets RED.
        if change_type == "approximate":
            close = _approx_close(prev, curr)
            if close is True:
                relation, method = "equivalent", "numeric"
                reason = "numerically equal to the previous step within tolerance (≈)"

        # 2) narrows — a solving step: solution set must not grow
        if relation == "unknown":
            relation, method, reason = _narrows_check(prev, curr, relation, method, reason)

        # 2b) scaled residual — "multiply/divide both sides by k": residuals
        # proportional. A NUMERIC factor is an unconditional proof; a symbolic
        # one is conditional on k != 0, hence method "scaled" (-> Verified).
        if relation == "unknown":
            k = _scaled_residual(prev, curr)
            if k is not None:
                relation = "equivalent"
                if k.is_number:
                    method = "symbolic"
                    reason = f"both sides scaled by the nonzero constant {k}"
                else:
                    method = "scaled"
                    reason = (f"both sides scaled by {k} — "
                              f"equivalent wherever {k} ≠ 0")

        # 2c) parametric narrows — multivariate solving steps (weakest of the
        # equation checks, so it runs only when scaled equivalence failed)
        if relation == "unknown" and _kind(prev) != "expression" \
                and _kind(curr) != "expression":
            relation, method, reason = _parametric_narrows(
                prev, curr, relation, method, reason)

        # 2d) branch pair — principal-root simplifications (√(K/4a²) → √K/2a):
        # the two equations square to the SAME statement, so they are equal up
        # to the choice of root branch. Runs after the refuting checks (a
        # univariate wrong branch like x=3 → x=-3 is refuted at step 2 first).
        if relation == "unknown" and _branch_pair(prev, curr):
            relation, method = "equivalent", "branch"
            reason = ("both sides square to the same statement — equal up to "
                      "the choice of root branch (principal root assumed)")

        # 3) characteristic fingerprint — landmarks instead of sampling
        if relation == "unknown":
            fp = _fingerprint_relation(prev, curr)
            if fp is True:
                relation, method = "equivalent", "fingerprint"
                reason = "characteristic landmarks (roots, poles, limits) all match"
            elif fp is False:
                relation, method = "refuted", "fingerprint"
                reason = "characteristic landmarks provably differ from the previous step"

    expected = _EXPECTED_RELATIONS.get(change_type or "")
    # No declared type = no claim to contradict; undecided pairs aren't mislabels.
    type_consistent = expected is None or relation in expected or relation == "unknown"

    tier = _tier_for(relation, method, type_consistent)
    if not type_consistent:
        reason += f" — but the step was declared '{change_type}'"
    return PairVerdict(index, tier, relation, method, change_type,
                       type_consistent, reason)


def _squared_pair(prev, curr) -> bool:
    """Is ``prev`` exactly ``curr`` with both sides squared (sides either way)?

    ``u = w  =>  u² = w²`` holds unconditionally — any symbols, any signs — so
    a take-the-square-root step whose previous state IS its square is a proven
    narrowing with no solveset and no parameter conditions. This catches the
    multivariate root steps the solution-set checks can't settle (sympy writes
    the two sides' roots in |a|-ambiguous forms and is_subset returns None).
    """
    if not (isinstance(prev, sp.Equality) and isinstance(curr, sp.Equality)):
        return False
    def _matches(lhs, rhs):
        return (sp.simplify(prev.lhs - lhs ** 2) == 0
                and sp.simplify(prev.rhs - rhs ** 2) == 0)
    return bool(_guard(_matches, curr.lhs, curr.rhs, default=False)
                or _guard(_matches, curr.rhs, curr.lhs, default=False))


def _branch_pair(prev, curr) -> bool:
    """Do the two equations SQUARE to the same statement?

    ``u = s`` and ``u = t`` with ``s² = t²`` differ at most by the sign of a
    root (``t = ±s``) — the situation of principal-root simplifications like
    ``√(K/4a²) → √K/(2a)``, where solveset only returns undecidable
    ConditionSets. Equal-up-to-branch is Verified-grade evidence, not a proof:
    the identification is exact on the principal branch and sign-flipped off
    it. Refutable cases (e.g. univariate ``x=3 → x=-3``) never reach this
    check — the solution-set pass refutes them first.
    """
    if not (isinstance(prev, sp.Equality) and isinstance(curr, sp.Equality)):
        return False
    sq = lambda e: sp.Eq(e.lhs ** 2, e.rhs ** 2)  # noqa: E731
    return bool(_guard(lambda: sympy_equiv(sq(prev), sq(curr)), default=False))


def _narrows_check(prev, curr, relation, method, reason):
    """Solution-set containment for relational/boolean states (solving steps)."""
    rel_kinds = ("equation", "inequality", "boolean")
    if _kind(prev) not in rel_kinds or _kind(curr) not in rel_kinds:
        return relation, method, reason
    # take-the-root pattern: an unconditional implication, decided structurally
    if _squared_pair(prev, curr):
        return ("narrows", "symbolic",
                "the previous step is exactly this step squared — taking a root "
                "keeps only solutions of the original")
    x = _sole_symbol(prev, curr)
    if x is None:
        # multivariate — handled later by the (weaker) parametric pass, AFTER
        # the scaled-residual check has had its chance to prove equivalence
        return relation, method, reason
    prev_sols = _guard(_solution_set, prev, x)
    curr_sols = _guard(_solution_set, curr, x)
    if prev_sols is None or curr_sols is None:
        return relation, method, reason
    contained = _guard(lambda: curr_sols.is_subset(prev_sols))
    if contained:
        # equal sets are equivalence, not narrowing — don't punish a `rewrite`
        # label (e.g. "multiply both sides by 2") for preserving every solution
        if _guard(lambda: prev_sols.is_subset(curr_sols)):
            return ("equivalent", "symbolic",
                    "same solution set as the previous step")
        return ("narrows", "symbolic",
                "every solution of this step solves the previous one (valid narrowing)")
    # provably introduces non-solutions? (only claim it when the gap is concrete)
    gap = _guard(lambda: curr_sols - prev_sols)
    if isinstance(gap, sp.FiniteSet) and len(gap) > 0:
        extra = ", ".join(sorted(str(v) for v in gap))
        return ("refuted", "symbolic",
                f"introduces value(s) that do not solve the previous step: {extra}")
    return relation, method, reason


# Relative tolerance for declared-approximate steps (covers e.g. pi -> 3.14).
_APPROX_TOL = 1e-2


def _approx_close(prev, curr) -> Optional[bool]:
    """For declared-approximate steps: residual difference numerically tiny?

    True/False when the difference evaluates to a number (within / beyond
    tolerance), None when it stays symbolic (tolerance undecidable).
    """
    d = _guard(lambda: sp.simplify(_residual(prev) - _residual(curr)))
    if d is None or d.free_symbols:
        return None
    try:
        return abs(float(d)) <= _APPROX_TOL
    except Exception:
        return None


def _scaled_residual(prev, curr):
    """Residual-proportionality: ``residual(prev) == k * residual(curr)``.

    Catches "multiply/divide both sides by k" — the residuals differ by the
    factor, so the strict residual comparison in ``sympy_equiv`` rejects the
    step even though the solution set is unchanged wherever ``k != 0``.

    Returns the factor ``k`` (nonzero, and — when symbolic — free of at least
    one shared symbol, the would-be unknown), or None if the residuals are not
    cleanly proportional. A factor that CONTAINS every shared symbol could
    change the solution set, so it is conservatively rejected.
    """
    if not (isinstance(prev, sp.Equality) and isinstance(curr, sp.Equality)):
        return None
    ra, rb = prev.lhs - prev.rhs, curr.lhs - curr.rhs
    k = _guard(lambda: sp.simplify(sp.cancel(ra / rb)))
    if k is None or k == 0 or k.has(sp.oo, -sp.oo, sp.zoo, sp.nan):
        return None
    if k.is_number:
        return k
    shared = ra.free_symbols & rb.free_symbols
    if not (shared - k.free_symbols):
        return None
    return k


def _parametric_narrows(prev, curr, relation, method, reason):
    """Multivariate narrows: prove containment with ONE symbol as the unknown.

    If, for some shared symbol v (the others held as generic parameters),
    every v-solution of ``curr`` is a v-solution of ``prev``, then any point
    satisfying ``curr`` satisfies ``prev`` — the step introduces no
    non-solutions. solveset's parametric manipulations are *generic* (it
    squares / divides freely in the parameters), so this is Verified-grade
    evidence, not a proof; we therefore never REFUTE in this mode, and we
    conservatively report ``narrows`` (not ``equivalent``) even for two-way
    containment.
    """
    shared = sorted(prev.free_symbols & curr.free_symbols, key=str)
    if not (1 <= len(shared) <= 5):     # bound the work (each try is guarded)
        return relation, method, reason
    # prefer the symbol the step is visibly solved for (a bare-symbol lhs)
    if isinstance(curr, sp.Equality) and curr.lhs in shared:
        shared.remove(curr.lhs)
        shared.insert(0, curr.lhs)
    for v in shared:
        prev_sols = _guard(_solution_set, prev, v, sp.S.Complexes)
        curr_sols = _guard(_solution_set, curr, v, sp.S.Complexes)
        if prev_sols is None or curr_sols is None:
            continue
        if _guard(lambda: curr_sols.is_subset(prev_sols)):
            return ("narrows", "parametric",
                    f"treating {v} as the unknown, every solution of this step "
                    f"solves the previous one (other symbols as generic parameters)")
    return relation, method, reason


def _tier_for(relation: Relation, method: Method, type_consistent: bool) -> Tier:
    if relation == "refuted":
        return Tier.RED                       # a mislabel can't make it worse
    if relation == "unknown":
        return Tier.BLUE
    base = Tier.GOLD if method == "symbolic" else Tier.SILVER
    if not type_consistent:                   # one-notch downgrade for mislabels
        return Tier.SILVER if base is Tier.GOLD else Tier.BLUE
    return base


# --------------------------------------------------------------------------- #
# the standalone helper (issue #355)
# --------------------------------------------------------------------------- #


def ground_steps(states: Sequence, *, change_types: Optional[Sequence] = None,
                 target=None, domain=None) -> StepGroundingReport:
    """Rank an ordered chain of derivation states by step-to-step confidence.

    ``states``: sympy expressions or sympify-able strings (None marks a state
    that is known to be non-convertible). ``states[0]`` is the start / premise.
    ``change_types``: optional per-TRANSITION claims (len == len(states) - 1).
    ``target``: optional expression the chain should reach (endpoint gate).
    ``domain`` is advisory (kept for signature symmetry with the parsers).

    Pure and total: never raises, never blocks past the per-call timeout.
    """
    exprs = [_safe_coerce(s) for s in states]
    n_trans = max(len(exprs) - 1, 0)
    declared = list(change_types or [])
    declared += [None] * (n_trans - len(declared))

    steps: list[StepConfidence] = []
    pairs: list[PairVerdict] = []
    if exprs:
        start_ok = exprs[0] is not None
        steps.append(StepConfidence(
            0,
            Tier.GOLD if start_ok else Tier.GRAY,
            None,
            "the given starting expression" if start_ok
            else "the starting state is not a single convertible expression",
            True,
        ))
    for i in range(1, len(exprs)):
        pv = classify_pair(exprs[i - 1], exprs[i], declared[i - 1], index=i)
        pairs.append(pv)
        steps.append(StepConfidence(i, pv.tier, pv.relation, pv.reason,
                                    pv.type_consistent))

    endpoint = None
    if target is not None:
        target_expr = _safe_coerce(target)
        final = next((e for e in reversed(exprs) if e is not None), None)
        if target_expr is not None and final is not None:
            endpoint = bool(_guard(sympy_equiv, final, target_expr, default=False))

    counts = {t.value: 0 for t in Tier}
    for pv in pairs:
        counts[pv.tier.value] += 1

    overall = min((pv.tier for pv in pairs), key=TIER_RANK.get, default=Tier.BLUE)
    # Endpoint gate: GOLD additionally requires *reaching the goal*. Unverified
    # endpoint caps at SILVER, a missed endpoint at BLUE (locally fine, off-goal).
    if endpoint is False:
        overall = min(overall, Tier.BLUE, key=TIER_RANK.get)
    elif endpoint is None and overall is Tier.GOLD:
        overall = Tier.SILVER

    return StepGroundingReport(
        steps=steps, pairs=pairs, overall=overall, counts=counts,
        endpoint_reached=endpoint, reason=_overall_reason(pairs, counts, endpoint),
    )


def _safe_coerce(s):
    """sympy expr | sympify-able string -> expr; None on anything else."""
    if s is None:
        return None
    try:
        return _coerce_expr(s)
    except Exception:
        return None


def _overall_reason(pairs, counts, endpoint) -> str:
    n = len(pairs)
    if n == 0:
        return "no steps to verify"
    best = counts[Tier.GOLD.value] + counts[Tier.SILVER.value]
    parts = [f"{best}/{n} steps verified"]
    for tier in (Tier.RED, Tier.GRAY, Tier.BLUE):
        if counts[tier.value]:
            parts.append(f"{counts[tier.value]} {TIER_LABEL[tier].lower()}")
    if endpoint is True:
        parts.append("endpoint reached")
    elif endpoint is False:
        parts.append("endpoint NOT reached")
    return " · ".join(parts)
