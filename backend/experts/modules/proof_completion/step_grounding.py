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
calls (solveset / singularities / limit / simplify) run through the killable
:func:`cas_guard.guard` so a pathological expression is *stopped* (its worker
SIGTERM/SIGKILLed and the core reclaimed) and the step degrades to "unknown"
instead of hanging. Because guarded work crosses a process boundary in the
default mode, every guarded call passes a **module-level** ``_op_*`` helper (or a
top-level sympy entry point) — never a lambda/closure, which cannot be pickled.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from enum import Enum
from typing import Literal, Optional, Sequence

import sympy as sp

from .cas_guard import guard as _guard, cas_register_safe_function
from .grounding import _coerce_expr, sympy_equiv

log = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# tiers
# --------------------------------------------------------------------------- #


class Tier(str, Enum):
    """Confidence tiers, weakest to strongest (see ``TIER_RANK``)."""

    RED = "refuted"        # computed and wrong
    GRAY = "unchecked"     # state not sympy-convertible — nothing to check
    BLUE = "plausible"     # convertible, not refuted, undecided
    DOMAIN = "domain"      # valid by domain knowledge, not a symbolic identity
    SILVER = "verified"    # landmarks match / proven but mislabeled
    GOLD = "grounded"      # symbolically proven, label consistent


# DOMAIN sits between BLUE (CAS undecided) and SILVER (strong CAS evidence): an
# LM domain-expert vouched for the move, which beats "CAS couldn't decide" but
# never outranks actual symbolic evidence. The pure-CAS pass NEVER emits DOMAIN —
# it is produced only by the inference-time judge rescue (``domain_rescue.py``),
# so the offline reward stays CAS-only.
TIER_RANK = {Tier.RED: 0, Tier.GRAY: 1, Tier.BLUE: 2,
             Tier.DOMAIN: 3, Tier.SILVER: 4, Tier.GOLD: 5}

TIER_LABEL = {
    Tier.GOLD: "Grounded",
    Tier.SILVER: "Verified",
    Tier.DOMAIN: "Domain",
    Tier.BLUE: "Plausible",
    Tier.GRAY: "Unchecked",
    Tier.RED: "Refuted",
}

TIER_ICON = {
    Tier.GOLD: "🥇",
    Tier.SILVER: "🥈",
    Tier.DOMAIN: "🎓",
    Tier.BLUE: "🔹",
    Tier.GRAY: "○",
    Tier.RED: "✗",
}

# What each tier means, in user-facing words (tooltips). Phrased to follow the
# tier label ("Proven — <meaning>"), so they never repeat it.
TIER_MEANING = {
    Tier.GOLD: "symbolically proven to follow from the previous step",
    Tier.SILVER: "strong CAS evidence, short of a symbolic proof",
    Tier.DOMAIN: "valid by domain knowledge, not a symbolic identity the CAS can check",
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
    judged: bool = False            # tier came from the LM domain judge, not the CAS


@dataclass(frozen=True)
class StepConfidence:
    """Per-STATE confidence (index 0 is the start / premise)."""

    index: int
    tier: Tier
    relation: Optional[Relation]    # None for the start state
    reason: str
    type_consistent: bool
    # Provenance: True when this tier came from the LM domain judge
    # (``rescue_uncheckable``) rather than the CAS. Persisted with the stored
    # verdict (issue #542) so an offline re-grade — which has no judge — can
    # PRESERVE such a step instead of silently demoting it back to the CAS tier.
    judged: bool = False


@dataclass(frozen=True)
class StepGroundingReport:
    steps: list                     # list[StepConfidence], one per state
    pairs: list                     # list[PairVerdict], one per transition
    overall: Tier
    counts: dict                    # tier.value -> count, over transitions
    endpoint_reached: Optional[bool]  # final state equiv target (None: unknowable)
    reason: str                     # overall one-liner


# --------------------------------------------------------------------------- #
# killable guard + picklable operations
# --------------------------------------------------------------------------- #

# Every heavy sympy call routes through ``_guard`` (== ``cas_guard.guard``),
# which in its default mode runs the work in a separate, *killable* process: a
# wall-clock budget stops the computation and reclaims the core, instead of
# leaking a forever-busy thread (issue #386). The escalation ladder and all
# tunables live in ``cas_guard``.

# Indirection so tests can monkeypatch the heavy sympy entry points (effective
# in ``thread``/``inline`` isolation, which the test suite uses).
_solveset = sp.solveset
_singularities = sp.singularities
_limit = sp.limit


# -- picklable operations -------------------------------------------------- #
# In ``process`` isolation the callable handed to ``_guard`` is pickled and sent
# to a worker, so it must be a module-level function (lambdas/closures cannot be
# pickled). These wrap the small set of compound checks that previously used
# inline lambdas. Each takes/returns only picklable sympy values.

# Every op is registered (``@cas_register_safe_function``) so the killable guard's allow-list
# permits it; an unregistered callable is refused (defense in depth). The three
# ``_op_*set``/``limit`` wrappers also indirect through the monkeypatchable module
# globals so the registered, stable callable is what the guard sees while tests
# can still swap the underlying sympy entry point.

@cas_register_safe_function
def _op_is_subset(a, b):
    """``a.is_subset(b)`` — True / False / None (sympy can't decide)."""
    return a.is_subset(b)


@cas_register_safe_function
def _op_set_diff(a, b):
    """Set difference ``a - b`` (the values ``a`` has that ``b`` lacks)."""
    return a - b


@cas_register_safe_function
def _op_simplify_diff(a, b):
    """``simplify(a - b)`` — 0 iff the two are equal."""
    return sp.simplify(a - b)


@cas_register_safe_function
def _op_scaled_factor(ra, rb):
    """The proportionality factor ``ra / rb``, cancelled and simplified."""
    return sp.simplify(sp.cancel(ra / rb))


@cas_register_safe_function
def _op_squared_match(plhs, prhs, lhs, rhs):
    """Is ``prev`` exactly ``curr`` squared side-for-side? (both sides match)."""
    return bool(sp.simplify(plhs - lhs ** 2) == 0
                and sp.simplify(prhs - rhs ** 2) == 0)


@cas_register_safe_function
def _op_branch_equiv(prev, curr):
    """Do the two equations square to the same statement (equal up to branch)?"""
    def sq(e):
        return sp.Eq(e.lhs ** 2, e.rhs ** 2)
    return bool(sympy_equiv(sq(prev), sq(curr)))


@cas_register_safe_function
def _op_sets_norm_equal(a, b):
    """Are two finite landmark sets equal after nsimplify/simplify normalisation?"""
    def norm(s):
        return frozenset(sp.nsimplify(sp.simplify(v)) for v in s)
    return norm(a) == norm(b)


@cas_register_safe_function
def _op_solveset(eq, x, domain):
    """Guarded ``solveset`` (via the monkeypatchable module global)."""
    return _solveset(eq, x, domain)


@cas_register_safe_function
def _op_singularities(f, x, domain):
    """Guarded ``singularities`` (via the monkeypatchable module global)."""
    return _singularities(f, x, domain)


@cas_register_safe_function
def _op_limit(f, x, point, *rest):
    """Guarded ``limit`` (via the monkeypatchable module global)."""
    return _limit(f, x, point, *rest)


# -- complexity pre-gate (issue #386 option B) ----------------------------- #
# A cheap O(n) size check run BEFORE the heavy CAS routines: an expression big
# enough to risk a super-linear blow-up is never fed to simplify/solveset at all,
# so the step degrades to "plausible" (CAS undecided) without even spawning the
# guarded work. The killable guard is the hard guarantee; this just spares it the
# obviously-intractable inputs (and the kill/respawn churn they cause). The
# budget is generous so authored/derived math is never affected. 0 disables it.
_MAX_OPS = int(os.environ.get("ALGEBENCH_CAS_MAX_OPS", "2500"))


def _too_complex(*exprs) -> bool:
    """Over budget by a SINGLE node-count pass that early-exits at the cap.

    Counts nodes by walking ``.args`` and bails the instant the count exceeds
    ``_MAX_OPS`` — so the pre-gate stays cheap even on the giant trees it exists
    to reject (no full ``count_ops`` traversal, no big ``atoms()`` set alloc).
    """
    if _MAX_OPS <= 0:
        return False
    try:
        stack = [e for e in exprs if e is not None]
        seen = 0
        while stack:
            node = stack.pop()
            seen += 1
            if seen > _MAX_OPS:
                return True
            stack.extend(getattr(node, "args", ()))
    except Exception:
        return False
    return False


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


@cas_register_safe_function
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

    roots = _finite_set(_guard(_op_solveset, sp.Eq(f, 0), x, sp.S.Reals))
    sings = _finite_set(_guard(_op_singularities, f, x, sp.S.Reals))

    limits: dict = {}
    limits["+oo"] = _guard(_op_limit, f, x, sp.oo)
    limits["-oo"] = _guard(_op_limit, f, x, -sp.oo)
    if isinstance(sings, frozenset):
        for p in sings:
            limits[f"{p}+"] = _guard(_op_limit, f, x, p, "+")
            limits[f"{p}-"] = _guard(_op_limit, f, x, p, "-")
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
    except Exception:
        return None
    d = _guard(_op_simplify_diff, a, b, default=None)
    return None if d is None else bool(d == 0)


def _sets_equal(a, b) -> Optional[bool]:
    """True/False for two finite landmark sets, None if either is unusable."""
    if not isinstance(a, frozenset) or not isinstance(b, frozenset):
        return None
    if a == b:
        return True
    return _guard(_op_sets_norm_equal, a, b, default=None)


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

    # A state sympy has already decided to be FALSE is wrong on its own terms —
    # it needs no predecessor to be wrong against. `2 + 2 = 3` parses straight to
    # BooleanFalse, and the pairwise checks below can only ask whether it FOLLOWS
    # from the previous step; two unrelated statements come back "unknown", so a
    # decided falsehood was reaching the reader badged "Plausible — valid math".
    # It is not valid math. Refute it wherever it appears.
    #
    # Only a DECIDED falsehood qualifies: anything with a free symbol
    # (`x = 5`, `a x^2 + b x + c = 0`) stays a Relational and never lands here.
    if curr is sp.false:
        return PairVerdict(index, Tier.RED, "refuted", "symbolic", change_type, True,
                           "this step is false")

    # Complexity pre-gate: an expression large enough to risk a CAS blow-up is
    # not handed to the heavy routines at all — degrade to plausible up front.
    if _too_complex(prev, curr):
        return PairVerdict(index, Tier.BLUE, "unknown", "none", change_type, True,
                           "expression too large to verify within the CAS budget")

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
                    reason = f"both sides scaled by the nonzero constant ${sp.latex(k)}$"
                else:
                    method = "scaled"
                    # Render the factor as LaTeX (``$…$``) so the UI tooltip shows
                    # real math, not a raw sympy ``str`` (``A*dP``, ``\rho``…). The
                    # factor can be long, so name it once and refer back to it.
                    reason = (f"both sides scaled by ${sp.latex(k, mul_symbol='dot')}$ — "
                              f"equivalent wherever that factor ≠ 0")

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
    return bool(
        _guard(_op_squared_match, prev.lhs, prev.rhs, curr.lhs, curr.rhs,
               default=False)
        or _guard(_op_squared_match, prev.lhs, prev.rhs, curr.rhs, curr.lhs,
                  default=False))


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
    return bool(_guard(_op_branch_equiv, prev, curr, default=False))


def _value_sort_key(v):
    """Deterministic order for solution values: reals by magnitude, rest by srepr.

    Sorting the *rendered* strings instead puts ``$10$`` before ``$2$``, so the
    key works on the values and the rendering happens after.
    """
    try:
        if v.is_real:
            return (0, float(v), "")
    except (TypeError, ValueError):
        pass
    return (1, 0.0, sp.srepr(v))


def _values_phrase(x, values) -> str:
    """``x = 3, x = -3`` — name the VALUES, not the unknown they solve for."""
    return ", ".join(f"${sp.latex(x)} = {sp.latex(v)}$"
                     for v in sorted(values, key=_value_sort_key))


def _narrowing_detail(x, prev_sols, curr_sols) -> Optional[str]:
    """``selects …; discards …`` when both sides are finite, else None.

    Naming what a narrowing step threw away is the whole point of the badge
    (#516) — "selects x = 3; discards x = -3" is an explanation, "narrows" is
    just a label. Both sets must be finite before we ask the CAS for the
    difference: on a ConditionSet/Interval the diff can't come back as a
    ``FiniteSet`` anyway, so the round-trip is pure cost.
    """
    if not (isinstance(prev_sols, sp.FiniteSet) and isinstance(curr_sols, sp.FiniteSet)):
        return None
    dropped = _guard(_op_set_diff, prev_sols, curr_sols)
    if not isinstance(dropped, sp.FiniteSet) or len(dropped) == 0:
        return None
    return (f"selects {_values_phrase(x, curr_sols)}; "
            f"discards {_values_phrase(x, dropped)}")


_SQUARED_REASON = ("the previous step is exactly this step squared — taking a root "
                   "keeps only solutions of the original")


def _narrows_check(prev, curr, relation, method, reason):
    """Solution-set containment for relational/boolean states (solving steps)."""
    rel_kinds = ("equation", "inequality", "boolean")
    if _kind(prev) not in rel_kinds or _kind(curr) not in rel_kinds:
        return relation, method, reason
    # take-the-root pattern: an unconditional implication, decided structurally
    squared = _squared_pair(prev, curr)
    x = _sole_symbol(prev, curr)
    if x is None:
        # multivariate — a squared pair is still a proven narrowing (that check
        # exists precisely because solveset can't settle these), just with no
        # solution sets to name; anything else falls through to the (weaker)
        # parametric pass, AFTER the scaled-residual check has had its chance
        # to prove equivalence
        if squared:
            return ("narrows", "symbolic", _SQUARED_REASON)
        return relation, method, reason
    prev_sols = _guard(_solution_set, prev, x)
    curr_sols = _guard(_solution_set, curr, x)
    if squared:
        # univariate take-the-root: keep the structural proof as the reason and
        # append the dropped root when we can name it. The solution sets are
        # computed only for the wording — the verdict is already decided — so a
        # CAS degrade just costs the detail, not the grade.
        detail = (None if prev_sols is None or curr_sols is None
                  else _narrowing_detail(x, prev_sols, curr_sols))
        return ("narrows", "symbolic",
                f"{_SQUARED_REASON} — {detail}" if detail else _SQUARED_REASON)
    if prev_sols is None or curr_sols is None:
        return relation, method, reason
    contained = _guard(_op_is_subset, curr_sols, prev_sols)
    if contained:
        # equal sets are equivalence, not narrowing — don't punish a `rewrite`
        # label (e.g. "multiply both sides by 2") for preserving every solution
        if _guard(_op_is_subset, prev_sols, curr_sols):
            return ("equivalent", "symbolic",
                    "same solution set as the previous step")
        detail = _narrowing_detail(x, prev_sols, curr_sols)
        if detail:
            return ("narrows", "symbolic", detail)
        return ("narrows", "symbolic",
                "every solution of this step solves the previous one (valid narrowing)")
    # provably introduces non-solutions? (only claim it when the gap is concrete)
    gap = _guard(_op_set_diff, curr_sols, prev_sols)
    if isinstance(gap, sp.FiniteSet) and len(gap) > 0:
        extra = ", ".join(sorted(f"${sp.latex(v)}$" for v in gap))
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
    d = _guard(_op_simplify_diff, _residual(prev), _residual(curr))
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
    k = _guard(_op_scaled_factor, ra, rb)
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
        if _guard(_op_is_subset, curr_sols, prev_sols):
            return ("narrows", "parametric",
                    f"treating ${sp.latex(v)}$ as the unknown, every solution of this "
                    f"step solves the previous one (other symbols as generic parameters)")
    return relation, method, reason


def _tier_for(relation: Relation, method: Method, type_consistent: bool) -> Tier:
    if relation == "refuted":
        return Tier.RED                       # a mislabel can't make it worse
    if relation == "unknown":
        return Tier.BLUE
    # narrows is proven but weaker than equivalence — cap at SILVER
    if relation == "narrows":
        base = Tier.SILVER
    else:
        base = Tier.GOLD if method == "symbolic" else Tier.SILVER
    if not type_consistent:                   # one-notch downgrade for mislabels
        return Tier.SILVER if base is Tier.GOLD else Tier.BLUE
    return base


# --------------------------------------------------------------------------- #
# the standalone helper (issue #355)
# --------------------------------------------------------------------------- #


def ground_steps(states: Sequence, *, change_types: Optional[Sequence] = None,
                 target=None, domain=None,
                 allow_missing_change_types: bool = False) -> StepGroundingReport:
    """Rank an ordered chain of derivation states by step-to-step confidence.

    ``states``: sympy expressions or sympify-able strings (None marks a state
    that is known to be non-convertible). ``states[0]`` is the start / premise.
    ``change_types``: optional per-TRANSITION claims (len == len(states) - 1).
    ``target``: optional expression the chain should reach (endpoint gate).
    ``domain`` is advisory (kept for signature symmetry with the parsers).

    ``allow_missing_change_types`` acknowledges a deliberately claim-free grade.
    Without it, calling with no ``change_types`` at all logs a WARNING: absent
    claims resolve to ``type_consistent=True`` for every pair, so a caller that
    LOST the claims (re-grading a stored proof) silently erases every mislabel
    downgrade rather than reproducing it (issue #542). The two cases are
    indistinguishable from inside, so the caller has to say which it is.

    Pure and total: never raises, never blocks past the per-call timeout.
    """
    exprs = [_safe_coerce(s) for s in states]
    n_trans = max(len(exprs) - 1, 0)
    if change_types is None and n_trans and not allow_missing_change_types:
        log.warning(
            "ground_steps: no change_types for %d transition(s) — every pair "
            "will grade type_consistent=True, so mislabel downgrades cannot be "
            "reproduced. Pass the declared claims, or "
            "allow_missing_change_types=True to acknowledge this (issue #542).",
            n_trans)
    declared = list(change_types or [])
    declared += [None] * (n_trans - len(declared))

    steps: list[StepConfidence] = []
    pairs: list[PairVerdict] = []
    if exprs:
        start = exprs[0]
        if start is None:
            start_tier = Tier.GRAY
            start_reason = "the starting state is not a single convertible expression"
        elif start is sp.false:
            # A start state is a PREMISE, so it is normally taken as given — but a
            # premise sympy has already evaluated to False is not a premise, it is
            # a wrong statement. `2 + 2 = 3` parses straight to BooleanFalse, and
            # checking only "did it parse?" badged it GOLD, i.e. "symbolically
            # proven". Refuting a decided falsehood costs nothing: anything with a
            # free symbol (`a x^2 + b x + c = 0`) never reaches here, because it
            # stays an Equality rather than collapsing to a truth value.
            start_tier = Tier.RED
            start_reason = "the starting expression is false"
        else:
            start_tier = Tier.GOLD
            start_reason = "the given starting expression"
        steps.append(StepConfidence(0, start_tier, None, start_reason, True))
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

    counts = _count_tiers(pairs)
    overall = finalize_overall(pairs, endpoint, steps)

    return StepGroundingReport(
        steps=steps, pairs=pairs, overall=overall, counts=counts,
        endpoint_reached=endpoint,
        reason=_overall_reason(pairs, counts, endpoint, steps),
    )


def _count_tiers(pairs) -> dict:
    counts = {t.value: 0 for t in Tier}
    for pv in pairs:
        counts[pv.tier.value] += 1
    return counts


def finalize_overall(pairs, endpoint, steps=None) -> Tier:
    """The chain's overall tier: weakest link, then the endpoint gate.

    Shared by ``ground_steps`` and the inference-time rescue
    (``domain_rescue.py``), so an overridden pair re-rolls the overall the same
    way. Endpoint gate: GOLD additionally requires *reaching the goal*; an
    unverified endpoint caps at SILVER, a missed endpoint at BLUE (locally fine,
    off-goal).

    ``steps`` matters because a STEP can be refuted on its own terms — a decided
    falsehood needs no transition to be wrong against, and step 0 has no
    transition at all. Pairs alone cannot see it, and a one-step proof has no
    pairs whatsoever: `2 + 2 = 3` reported "Plausible — no steps to verify"
    beside its own Refuted badge.

    The guard lives HERE, not in the callers, deliberately. It was originally in
    ``ground_steps`` only, and ``rescue_uncheckable`` — which re-rolls the overall
    from pairs after a domain override, and is ON by default — silently undid it,
    reinstating the bug it was added for (Copilot review, #511). One rule, one
    home, so the two cannot drift apart again. Pass the POST-override steps: a
    rescue that legitimately lifts a refutation should lift the overall with it.
    """
    overall = min((pv.tier for pv in pairs), key=TIER_RANK.get, default=Tier.BLUE)
    if endpoint is False:
        overall = min(overall, Tier.BLUE, key=TIER_RANK.get)
    elif endpoint is None and overall is Tier.GOLD:
        overall = Tier.SILVER
    if any(sc.tier is Tier.RED for sc in (steps or [])):
        overall = Tier.RED
    return overall


def _safe_coerce(s):
    """sympy expr | sympify-able string -> expr; None on anything else."""
    if s is None:
        return None
    try:
        return _coerce_expr(s)
    except Exception:
        return None


# Tally wording for the overall summary. Most tier labels work as a bare
# adjective ("1 refuted", "2 plausible" — i.e. "<n> <adj> step(s)"), but
# "Domain" is a noun, so it gets an adjectival phrase so the tally reads as a
# complete fragment ("1 domain-justified" → "1 domain-justified step").
_TALLY_PHRASE = {Tier.DOMAIN: "domain-justified"}


def _overall_reason(pairs, counts, endpoint, steps=None) -> str:
    # Step 0 is the one step with no incoming pair, so a refutation there is
    # absent from `counts` (built from pairs) and has to be added by hand.
    start_refuted = bool(steps and steps[0].tier is Tier.RED)
    n = len(pairs)
    if n == 0:
        return "the only step is refuted" if start_refuted else "no steps to verify"
    best = counts[Tier.GOLD.value] + counts[Tier.SILVER.value]
    parts = [f"{best}/{n} steps verified"]
    counts = dict(counts)
    if start_refuted:
        counts[Tier.RED.value] = counts.get(Tier.RED.value, 0) + 1
    for tier in (Tier.RED, Tier.GRAY, Tier.BLUE, Tier.DOMAIN):
        if counts[tier.value]:
            phrase = _TALLY_PHRASE.get(tier, TIER_LABEL[tier].lower())
            parts.append(f"{counts[tier.value]} {phrase}")
    if endpoint is True:
        parts.append("endpoint reached")
    elif endpoint is False:
        parts.append("endpoint NOT reached")
    return " · ".join(parts)
