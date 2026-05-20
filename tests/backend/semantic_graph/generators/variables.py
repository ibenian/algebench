"""Variable and decoration generators for parametric cross-product tests.

Each category provides a tuple of (label, latex_fragment) pairs that can
be slotted into expression templates.
"""

from __future__ import annotations

VARIABLES: tuple[tuple[str, str], ...] = (
    ("x", "x"),
    ("y", "y"),
    ("z", "z"),
    ("a", "a"),
    ("b", "b"),
    ("n", "n"),
)

GREEK: tuple[tuple[str, str], ...] = (
    ("alpha", r"\alpha"),
    ("beta", r"\beta"),
    ("theta", r"\theta"),
    ("gamma", r"\gamma"),
    ("omega", r"\omega"),
    ("lambda", r"\lambda"),
    ("mu", r"\mu"),
    ("phi", r"\phi"),
    ("rho", r"\rho"),
    ("sigma", r"\sigma"),
)

ACCENTED: tuple[tuple[str, str], ...] = (
    ("vec_F", r"\vec{F}"),
    ("vec_v", r"\vec{v}"),
    ("hat_n", r"\hat{n}"),
    ("hat_x", r"\hat{x}"),
    ("bar_x", r"\bar{x}"),
    ("tilde_x", r"\tilde{x}"),
)

DOT_DERIVATIVES: tuple[tuple[str, str], ...] = (
    ("dot_x", r"\dot{x}"),
    ("ddot_x", r"\ddot{x}"),
    ("dot_theta", r"\dot{\theta}"),
    ("ddot_theta", r"\ddot{\theta}"),
)

SUBSCRIPTED: tuple[tuple[str, str], ...] = (
    ("x_0", "x_0"),
    ("x_1", "x_1"),
    ("v_text_exhaust", r"v_{\text{exhaust}}"),
    ("C_d", "C_d"),
    ("a_n", "a_n"),
    ("T_ij", "T_{ij}"),
)

COMPOUND: tuple[tuple[str, str], ...] = (
    ("Delta_t", r"\Delta t"),
    ("Delta_x", r"\Delta x"),
    ("nabla_f", r"\nabla f"),
)

STYLED: tuple[tuple[str, str], ...] = (
    ("mathbb_R", r"\mathbb{R}"),
    ("mathcal_L", r"\mathcal{L}"),
    ("mathcal_F", r"\mathcal{F}"),
    ("mathbf_v", r"\mathbf{v}"),
)

ALL_VAR_STYLES: dict[str, tuple[tuple[str, str], ...]] = {
    "plain": VARIABLES,
    "greek": GREEK,
    "accented": ACCENTED,
    "dot_derivative": DOT_DERIVATIVES,
    "subscripted": SUBSCRIPTED,
    "compound": COMPOUND,
    "styled": STYLED,
}
