"""Tests for step-to-step grounding (consecutive-consequence confidence tiers)."""

from __future__ import annotations

import time

import sympy as sp

from backend.experts.modules.proof_completion import step_grounding as SG
from backend.experts.modules.proof_completion.step_grounding import (
    Tier,
    classify_pair,
    ground_steps,
)

x = sp.Symbol("x")


def test_rewrite_chain_all_gold():
    states = [(x + 1) ** 2, x ** 2 + 2 * x + 1, x * (x + 2) + 1]
    rep = ground_steps(states, change_types=["rewrite", "rewrite"],
                       target=x * (x + 2) + 1)
    assert [p.tier for p in rep.pairs] == [Tier.GOLD, Tier.GOLD]
    assert all(p.relation == "equivalent" and p.method == "symbolic"
               for p in rep.pairs)
    assert rep.endpoint_reached is True
    assert rep.overall is Tier.GOLD


def test_solving_chain_narrows_is_valid():
    states = [
        sp.Eq(x ** 2 - 4, 0),
        sp.Eq(x ** 2, 4),
        sp.Eq(x, 2),                      # picks one branch — a valid narrowing
    ]
    rep = ground_steps(states, change_types=["rewrite", "solve"])
    assert rep.pairs[0].relation == "equivalent"
    assert rep.pairs[1].relation == "narrows"
    assert rep.pairs[1].method == "symbolic"
    assert rep.pairs[1].tier is Tier.GOLD


def test_wrong_middle_step_is_refuted():
    states = [sp.Eq(x ** 2 - 4, 0), sp.Eq(x ** 2, 4), sp.Eq(x, 7)]
    rep = ground_steps(states, change_types=["rewrite", "solve"],
                       target=sp.Eq(x, 7))
    assert rep.pairs[1].relation == "refuted"
    assert rep.pairs[1].tier is Tier.RED
    assert "7" in rep.pairs[1].reason
    assert rep.overall is Tier.RED


def test_undecidable_transcendental_is_plausible():
    a = sp.sin(x) + sp.cos(x ** 2)
    b = a + sp.exp(-x ** 2) * sp.sin(x ** 3)
    pv = classify_pair(a, b)
    assert pv.relation == "unknown"
    assert pv.method == "none"
    assert pv.tier is Tier.BLUE


def test_non_convertible_state_is_unchecked():
    rep = ground_steps([x + 1, None, x + 1])
    assert rep.steps[1].tier is Tier.GRAY     # the bad state
    assert rep.pairs[1].tier is Tier.GRAY     # and the transition out of it
    assert rep.overall is Tier.GRAY


def test_fingerprint_refutes_different_roots():
    # sympy_equiv returns False but cannot label the step wrong by itself;
    # the landmark comparison (different real roots) provides the refutation.
    pv = classify_pair((x - 1) * (x - 2), (x - 1) * (x - 3))
    assert pv.relation == "refuted"
    assert pv.method == "fingerprint"
    assert pv.tier is Tier.RED


def test_change_type_mislabel_downgrades_one_notch():
    # A narrowing step declared as a plain rewrite: proven, but mislabeled.
    pv = classify_pair(sp.Eq(x ** 2, 4), sp.Eq(x, 2), change_type="rewrite")
    assert pv.relation == "narrows"
    assert pv.type_consistent is False
    assert pv.tier is Tier.SILVER


def test_timeout_degrades_to_plausible(monkeypatch):
    def slow_solveset(*args, **kwargs):
        time.sleep(5)
        return sp.FiniteSet(0)

    monkeypatch.setattr(SG, "_solveset", slow_solveset)
    monkeypatch.setattr(SG, "_TIMEOUT_S", 0.3)
    t0 = time.monotonic()
    pv = classify_pair(sp.Eq(x ** 2, 4), sp.Eq(x, 1))
    elapsed = time.monotonic() - t0
    assert pv.tier is Tier.BLUE               # undecided, not wrong, no hang
    assert elapsed < 3.0


def test_endpoint_gate_caps_overall():
    states = [(x + 1) ** 2, x ** 2 + 2 * x + 1]
    rep = ground_steps(states, change_types=["rewrite"], target=x ** 2)
    assert rep.pairs[0].tier is Tier.GOLD     # the step itself is fine
    assert rep.endpoint_reached is False
    assert rep.overall is Tier.BLUE           # but the chain misses the goal


def test_no_target_caps_gold_at_verified():
    rep = ground_steps([(x + 1) ** 2, x ** 2 + 2 * x + 1])
    assert rep.pairs[0].tier is Tier.GOLD
    assert rep.endpoint_reached is None
    assert rep.overall is Tier.SILVER


def test_string_states_are_coerced():
    rep = ground_steps(["(x+1)**2", "x**2 + 2*x + 1"], target="x**2 + 2*x + 1")
    assert rep.pairs[0].tier is Tier.GOLD
    assert rep.overall is Tier.GOLD


def test_or_branches_count_as_full_solution_set():
    # x^2 = 4  ->  (x = 2) or (x = -2): equivalent, not narrowing.
    pv = classify_pair(sp.Eq(x ** 2, 4), sp.Or(sp.Eq(x, 2), sp.Eq(x, -2)),
                       change_type="solve")
    assert pv.relation in ("equivalent", "narrows")
    assert pv.tier is Tier.GOLD


def test_divide_both_sides_by_symbol_is_verified():
    # Residuals proportional by a symbolic factor: conditional on a != 0 -> SILVER.
    a, b, c = sp.symbols("a b c")
    pv = classify_pair(sp.Eq(a * x ** 2 + b * x + c, 0),
                       sp.Eq(x ** 2 + (b / a) * x + c / a, 0),
                       change_type="rewrite")
    assert pv.relation == "equivalent"
    assert pv.method == "scaled"
    assert pv.tier is Tier.SILVER
    assert "a" in pv.reason and "0" in pv.reason   # "...wherever a ≠ 0"


def test_multiply_both_sides_by_constant_is_proven():
    # A nonzero NUMERIC factor is an unconditional proof -> GOLD.
    pv = classify_pair(sp.Eq(x, 3), sp.Eq(2 * x, 6), change_type="rewrite")
    assert pv.relation == "equivalent"
    assert pv.method == "symbolic"
    assert pv.tier is Tier.GOLD


def test_sqrt_simplification_is_branch_not_scaled():
    # sqrt((b^2-4ac)/(4a^2)) == sqrt(b^2-4ac)/(2a) only for a > 0 — the scaled
    # check must NOT claim proportional residuals; the branch-pair check ranks
    # it Verified ("equal up to the root branch"), never Proven.
    a, b, c = sp.symbols("a b c")
    pv = classify_pair(
        sp.Eq(x + b / (2 * a), sp.sqrt((b ** 2 - 4 * a * c) / (4 * a ** 2))),
        sp.Eq(x + b / (2 * a), sp.sqrt(b ** 2 - 4 * a * c) / (2 * a)),
    )
    assert pv.method == "branch"
    assert pv.tier is Tier.SILVER


def test_scaling_by_the_unknown_is_not_equivalence():
    # x = 1  ->  x^2 = x scales the residual by x itself (k = x): that ADDS the
    # solution x = 0, so the factor must not count as an equivalence.
    pv = classify_pair(sp.Eq(x, 1), sp.Eq(x ** 2, x))
    assert pv.method != "scaled"
    assert pv.tier is not Tier.SILVER


def test_substitution_is_plausible_not_refuted():
    # let u = x+1: the fingerprint must not compare landmarks across DIFFERENT
    # variables — substitution lands undecided, never refuted.
    u = sp.Symbol("u")
    pv = classify_pair(sp.Eq((x + 1) ** 2, 4), sp.Eq(u ** 2, 4),
                       change_type="substitute")
    assert pv.relation == "unknown"
    assert pv.tier is Tier.BLUE
    assert pv.type_consistent is True


def test_approximate_within_tolerance_is_verified():
    pv = classify_pair(sp.Eq(x, sp.pi), sp.Eq(x, sp.Float("3.14159")),
                       change_type="approximate")
    assert pv.relation == "equivalent"
    assert pv.method == "numeric"
    assert pv.tier is Tier.SILVER


def test_bad_approximation_is_refuted():
    # "approximate" is not a free pass: pi -> 9 is wrong by any tolerance.
    pv = classify_pair(sp.Eq(x, sp.pi), sp.Eq(x, 9), change_type="approximate")
    assert pv.tier is Tier.RED


def test_parametric_sqrt_solve_is_verified():
    # E² = (mc²)² + (pc)²  ->  E = √(...): four free symbols, but solveset
    # proves it: prev is exactly curr squared (squared-pair, unconditional).
    E, m, p, c = sp.symbols("E m p c")
    K = (m * c ** 2) ** 2 + (p * c) ** 2
    pv = classify_pair(sp.Eq(E ** 2, K), sp.Eq(E, sp.sqrt(K)),
                       change_type="solve")
    assert pv.relation == "narrows"
    assert pv.method == "symbolic"
    assert pv.tier is Tier.GOLD
    assert pv.type_consistent is True


def test_parametric_narrows_is_verified():
    # pull c out of the root (E = √(c²·X) -> E = c·√X): NOT a squared pair and
    # conditional on the sign of c, but solveset proves containment with one
    # symbol as the unknown and the rest as generic parameters -> SILVER.
    E, m, p, c = sp.symbols("E m p c")
    X = m ** 2 * c ** 2 + p ** 2
    pv = classify_pair(sp.Eq(E, sp.sqrt(c ** 2 * X)), sp.Eq(E, c * sp.sqrt(X)),
                       change_type="solve")
    assert pv.relation == "narrows"
    assert pv.method == "parametric"
    assert pv.tier is Tier.SILVER
    assert pv.type_consistent is True


def test_multivariate_square_root_is_proven_narrows():
    # (x + b/2a)² = K/4a²  ->  x + b/2a = √(K/4a²): solveset writes the root
    # sets in |a|-ambiguous forms (undecidable containment), but prev is exactly
    # curr squared — an unconditional implication, hence a PROVEN narrowing.
    a, b, c = sp.symbols("a b c")
    K = b ** 2 - 4 * a * c
    pv = classify_pair(
        sp.Eq((x + b / (2 * a)) ** 2, K / (4 * a ** 2)),
        sp.Eq(x + b / (2 * a), sp.sqrt(K / (4 * a ** 2))),
        change_type="solve",
    )
    assert pv.relation == "narrows"
    assert pv.method == "symbolic"
    assert pv.tier is Tier.GOLD


def test_principal_root_simplification_is_verified():
    # √(K/4a²) -> √K/(2a): true for a > 0, sign-flipped for a < 0 — solveset
    # returns only ConditionSets, but both equations square to the SAME
    # statement, so they are equal up to the root branch -> SILVER.
    a, b, c = sp.symbols("a b c")
    K = b ** 2 - 4 * a * c
    pv = classify_pair(
        sp.Eq(x + b / (2 * a), sp.sqrt(K / (4 * a ** 2))),
        sp.Eq(x + b / (2 * a), sp.sqrt(K) / (2 * a)),
        change_type="rewrite",
    )
    assert pv.relation == "equivalent"
    assert pv.method == "branch"
    assert pv.tier is Tier.SILVER
    assert pv.type_consistent is True


def test_wrong_branch_swap_is_still_refuted():
    # x = 3 -> x = -3 squares to the same statement too, but the univariate
    # solution-set check refutes it BEFORE the branch check can bless it.
    pv = classify_pair(sp.Eq(x, 3), sp.Eq(x, -3))
    assert pv.relation == "refuted"
    assert pv.tier is Tier.RED


def test_pm_state_is_unchecked_in_animation_build():
    # End-to-end: a derivation step written with \pm still renders/morphs, but
    # its confidence tier must be "unchecked" (GRAY) — never a fake verdict
    # computed from the ± pseudo-symbol.
    from backend.experts.handlers.proof_animation.animation import build
    from backend.experts.modules.proof_completion.outputs import (
        DerivationStep, ProofTrajectory)

    traj = ProofTrajectory(
        start_latex=r"x^2 = 9",
        target_latex=r"x = 3",
        steps=[
            DerivationStep(operation="take the square root",
                           expr_latex=r"x = \pm 3",
                           justification="square root of both sides",
                           change_type="solve"),
            DerivationStep(operation="pick the positive root",
                           expr_latex=r"x = 3",
                           justification="positive branch",
                           change_type="solve"),
        ],
    )
    data = build(traj, "algebra", "pm demo")
    tiers = [s["confidence"]["tier"] for s in data["steps"]]
    assert tiers[1] == "unchecked"            # the \pm state
    assert data["steps"][1]["latex"]          # but it still renders
    assert tiers[0] == "grounded"               # the start is untouched
