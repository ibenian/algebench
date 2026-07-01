"""ProofCompletion outputs: the ``proof_trajectory`` discriminated union.

One strongly-typed class per atomic op (``AddNode`` / ``RemoveNode`` /
``AddEdge`` / ``RemoveEdge``), each carrying exactly its own fields, with shared
fields on ``GraphOpBase`` and behavior provided polymorphically via ``apply_to``.
"""

from __future__ import annotations

import re
from typing import Annotated, List, Literal, Optional, Union

from pydantic import (
    BaseModel, ConfigDict, Discriminator, Field, Tag, TypeAdapter,
    field_validator,
)

from backend.model.semantic_graph import SemanticGraphEdge, SemanticGraphNode
from backend.util.latex import math_segments

from backend.experts.outputs import Output


class GraphOpError(ValueError):
    """An op could not be legally applied (penalized by the metric)."""


class GraphOpBase(BaseModel):
    """Shared fields + the polymorphic apply contract for every graph op."""

    model_config = ConfigDict(extra="forbid")

    # 1-based derivation step this op belongs to. Ops sharing a step are applied
    # together; the cumulative graph at each step boundary must be a complete,
    # groundable expression (a valid waypoint in the derivation).
    step: int = Field(default=1, ge=1, description="1-based derivation step index")
    explanation: str = Field(min_length=1, max_length=400, description="what changes")
    justification: str = Field(min_length=1, max_length=400,
                               description="why the change is mathematically valid")

    @field_validator("explanation", "justification", mode="before")
    @classmethod
    def _unmangle_prose(cls, v):
        """Restore single-escaped LaTeX the model emitted in these prose fields.

        See ``_unmangle_json_escapes`` — a JSON parser eats the first letter of a
        ``\\frac``/``\\rho``-style command written with one backslash.
        """
        return _unmangle_json_escapes(v) if isinstance(v, str) else v

    def apply_to(self, graph, node_ids: set) -> None:
        """Mutate ``graph`` in place (and ``node_ids``); raise on illegal op."""
        raise NotImplementedError


class AddNode(GraphOpBase):
    op: Literal["add_node"] = "add_node"
    node: SemanticGraphNode

    def apply_to(self, graph, node_ids: set) -> None:
        if self.node.id in node_ids:
            raise GraphOpError(f"add_node: duplicate id {self.node.id!r}")
        graph.nodes.append(self.node.model_copy(deep=True))
        node_ids.add(self.node.id)


class RemoveNode(GraphOpBase):
    op: Literal["remove_node"] = "remove_node"
    node_id: str = Field(min_length=1, max_length=80)

    def apply_to(self, graph, node_ids: set) -> None:
        if self.node_id not in node_ids:
            raise GraphOpError(f"remove_node: missing id {self.node_id!r}")
        if any(e.from_ == self.node_id or e.to == self.node_id for e in graph.edges):
            raise GraphOpError(f"remove_node: {self.node_id!r} still has edges")
        graph.nodes = [n for n in graph.nodes if n.id != self.node_id]
        node_ids.discard(self.node_id)


class AddEdge(GraphOpBase):
    op: Literal["add_edge"] = "add_edge"
    edge: SemanticGraphEdge

    def apply_to(self, graph, node_ids: set) -> None:
        if self.edge.from_ not in node_ids or self.edge.to not in node_ids:
            raise GraphOpError("add_edge: dangling endpoint")
        graph.edges.append(self.edge.model_copy(deep=True))


class RemoveEdge(GraphOpBase):
    op: Literal["remove_edge"] = "remove_edge"
    edge_from: str = Field(min_length=1, max_length=80)
    edge_to: str = Field(min_length=1, max_length=80)
    edge_role: Optional[str] = Field(default=None, max_length=40)

    def apply_to(self, graph, node_ids: set) -> None:
        for i, e in enumerate(graph.edges):
            if (e.from_ == self.edge_from and e.to == self.edge_to
                    and (self.edge_role is None or e.role == self.edge_role)):
                del graph.edges[i]
                return
        raise GraphOpError(f"remove_edge: no edge {self.edge_from!r}->{self.edge_to!r}")


def _op_discriminator(v) -> Optional[str]:
    """Pick the op subclass — robustly.

    LMs reliably emit the *fields* of an op but often omit the explicit ``op``
    discriminator. Fall back to inferring it from which fields are present, so
    the union still parses (the subclass then sets ``op`` via its default).
    """
    if isinstance(v, dict):
        if v.get("op"):
            return v["op"]
        if "node" in v:
            return "add_node"
        if "node_id" in v:
            return "remove_node"
        if "edge" in v:
            return "add_edge"
        if "edge_from" in v or "edge_to" in v:
            return "remove_edge"
        return None
    return getattr(v, "op", None)


# The discriminated union the LM (and our code) work with. A *callable*
# discriminator makes it tolerant of a missing ``op`` tag (see above).
GraphOp = Annotated[
    Union[
        Annotated[AddNode, Tag("add_node")],
        Annotated[RemoveNode, Tag("remove_node")],
        Annotated[AddEdge, Tag("add_edge")],
        Annotated[RemoveEdge, Tag("remove_edge")],
    ],
    Discriminator(_op_discriminator),
]

# For (de)serializing a single op from/to a plain dict.
GRAPH_OP_ADAPTER: TypeAdapter = TypeAdapter(GraphOp)


# The KIND of move a step makes. The CAS (step_grounding) is the judge of what
# a step actually did; ``change_type`` is the model's declared expectation —
# it selects which check applies and surfaces mislabels, never overrides sympy.
ChangeType = Literal["rewrite", "solve", "substitute", "approximate", "given"]


# Length caps for the model's PROSE fields. These are sent to the LM (via the
# JSON schema) AND enforced — but the enforcement CLAMPS rather than rejects (see
# ``_clamp_prose``): a single over-long justification must never fail the whole
# derivation. `justification` is generous because real derivation/physics
# rationales legitimately run long. `expr_latex` is NOT clamped — truncating
# LaTeX would corrupt the actual math, so it stays strict.
_OPERATION_MAX = 200
_JUSTIFICATION_MAX = 600


def _clamp(text: str, cap: int) -> str:
    """Trim ``text`` to at most ``cap`` chars, at a word boundary, with an ellipsis."""
    if len(text) <= cap:
        return text
    body = text[:cap - 1].rstrip()
    space = body.rfind(" ")
    if space > cap * 0.6:               # prefer a word boundary unless it's too early
        body = body[:space].rstrip()
    return body + "…"


# Repair for LaTeX that the model emitted in a PROSE field with a *single*
# backslash inside its JSON string (``$\frac…$`` instead of ``$\\frac…$``). A
# JSON parser reads ``\f``/``\b``/``\n``/``\r``/``\t`` as control-char escapes
# and eats the command's first letter — so ``\frac`` becomes ``\x0c`` + ``rac``
# (renders "rac") and ``\rho`` becomes ``\x0d`` + ``ho`` (renders "ho"). The
# leftover control char encodes exactly which letter was lost, so the repair is
# lossless. Expression fields (``expr_latex``) are immune (the model double-
# escapes dedicated latex fields, and a mangled value fails the graph parse), so
# this is applied to prose fields only. See README / the proof-animation bug.
#
# Why only the five escape letters and not "every ``\``": when the model slips it
# under-escapes EVERY command in the field uniformly, but only ``\b \f \n \r \t``
# are valid JSON escapes — those get eaten into control chars; everything else
# (``\cdot``, ``\alpha``, ``\sqrt``, ``\Rightarrow`` …) ``json_repair`` decodes
# back to correct single-backslash LaTeX on its own. So by the time we see the
# value, the only damage left is the control chars. We deliberately repair here
# (post-parse) rather than re-escaping the raw completion pre-parse: the model is
# inconsistent (sometimes it DOES write ``\\frac``), so blindly doubling ``\`` in
# the raw text would turn a correct ``\\frac`` into ``\\\\frac`` (→ literal
# ``\\frac``). The control char is an unambiguous "this letter was eaten" signal;
# a raw backslash is not. (Verified: 47 commands × 4 contexts all round-trip.)
#
# We only ever rewrite the CONTROL CHARS the corruption left behind — never a
# real backslash. ``\x08`` (backspace) and ``\x0c`` (form feed) never occur in
# legitimate text, so they map back unconditionally and anywhere. ``\r``/``\n``/
# ``\t`` double as real whitespace (line breaks/tabs in prose), so they are only
# un-mangled when they begin a command — a lowercase ASCII letter follows — AND
# they sit INSIDE a ``$…$`` / ``$$…$$`` segment, where the corruption always is
# (the eaten command was inside the math the model wrote). Commands hit by this
# bug are all lowercase-initial (``\b \f \n \r \t``); uppercase-initial commands
# like ``\Rightarrow`` are never escape sequences and survive json parsing.
_CTRL_TO_LATEX = {"\x08": r"\b", "\x0c": r"\f"}
_WS_CTRL = {"\r": r"\r", "\n": r"\n", "\t": r"\t"}
_WS_CTRL_RE = re.compile(r"[\r\n\t](?=[a-z])")


def _unmangle_json_escapes(text: str) -> str:
    """Losslessly restore single-escaped LaTeX commands mangled by JSON parsing.

    A no-op for clean text (no control chars) and idempotent. Whitespace-
    ambiguous control chars are repaired only inside ``$…$`` math, so real line
    breaks in the surrounding prose are preserved.
    """
    if not text:
        return text
    # form feed / backspace: never legitimate → restore globally
    for ctrl, latex in _CTRL_TO_LATEX.items():
        if ctrl in text:
            text = text.replace(ctrl, latex)
    # \r \n \t: ambiguous with real whitespace → restore only inside math spans
    if _WS_CTRL_RE.search(text):
        segs = math_segments(text)
        if segs:
            out: list[str] = []
            cursor = 0
            for seg in segs:
                out.append(text[cursor:seg.start])                       # prose — untouched
                out.append(_WS_CTRL_RE.sub(lambda m: _WS_CTRL[m.group()],
                                           text[seg.start:seg.end]))      # math — repaired
                cursor = seg.end
            out.append(text[cursor:])
            text = "".join(out)
    return text


class DerivationStep(BaseModel):
    """One derivation step: a complete reachable state + the move that reached it.

    The model emits what it is good at — a *full* expression — not low-level
    graph edits. ``expr_latex`` is the COMPLETE LaTeX of the expression after
    this step (e.g. ``x^2 = 4``), and ``operation`` describes the move in plain
    math terms (e.g. ``add 4 to both sides``).

    The graph for each state is derived deterministically in code via
    ``SemanticGraphService.latex_to_graph``; the atomic node/edge edits between
    consecutive states are recovered with ``diff``. So every step is a
    single-root, sympy-convertible expression *by construction* — the model
    never does graph bookkeeping.
    """

    model_config = ConfigDict(extra="forbid")

    operation: str = Field(min_length=1, max_length=_OPERATION_MAX,
                           description="the math move; wrap any math in $…$, e.g. 'add $\\frac{c}{a}$ to both sides'")
    expr_latex: str = Field(min_length=1, max_length=600,
                            description="the COMPLETE LaTeX of the resulting expression")
    justification: str = Field(min_length=1, max_length=_JUSTIFICATION_MAX,
                               description="why this step is valid; wrap any math in $…$")
    change_type: ChangeType = Field(
        description="the KIND of move: 'rewrite' (equivalence-preserving "
                    "rearrangement), 'solve' (narrows toward a solution / picks a "
                    "branch), 'substitute' (introduce a new variable, let $u=…$), "
                    "'approximate' (≈, not exact), 'given' (a premise, not derived)")

    @field_validator("operation", "justification", mode="before")
    @classmethod
    def _clamp_prose(cls, v, info):
        """Repair JSON-mangled LaTeX, then trim an over-long prose field.

        ``_unmangle_json_escapes`` first restores any single-escaped LaTeX the
        model emitted in this prose field (``\\frac``→``\x0crac`` etc.). Then
        clamping: DSPy surfaces a single field's length-validation failure as a
        hard ``RuntimeError`` that aborts the entire derivation, so clamping here
        (before the ``max_length`` constraint runs) turns a too-verbose
        justification into a harmless trim rather than a lost derivation.
        """
        if isinstance(v, str):
            v = _unmangle_json_escapes(v)
        caps = {"operation": _OPERATION_MAX, "justification": _JUSTIFICATION_MAX}
        cap = caps.get(info.field_name)
        if cap and isinstance(v, str):
            return _clamp(v, cap)
        return v


class ProofTrajectory(Output):
    """A derivation as an ordered list of complete reachable states.

    Each step holds the full expression after one math operation. The per-state
    graphs (and the atomic edits between them, for animation) are derived in code
    from ``steps`` — the model only supplies the math. ``kind`` is the
    consumer-facing dispatch key.

    ``start_latex`` / ``target_latex`` are the **reconstructed ("proper") LaTeX**
    of the start and target graphs, attached by the expert after inference so the
    trajectory is self-contained (the endpoints it derived between travel with
    it). They are NOT produced by the model. ``title`` IS model-produced — a short
    display name for the derivation, bound onto the trajectory by the expert so it
    travels with it (Optional; older data / non-titled callers leave it None).
    """

    kind: Literal["proof_trajectory"] = "proof_trajectory"
    start_latex: Optional[str] = None
    target_latex: Optional[str] = None
    title: Optional[str] = None
    # ``goal`` (one-line framing shown before the steps) and ``followups`` (suggested
    # next prompts for agentic continuation) are model-produced and bound onto the
    # trajectory by the expert, like ``title`` — they travel with it into the
    # animation. Optional so older data / non-generating callers leave them empty.
    goal: Optional[str] = None
    followups: List[str] = Field(default_factory=list)
    prerequisites: List[str] = Field(default_factory=list)
    steps: List[DerivationStep] = Field(default_factory=list)
