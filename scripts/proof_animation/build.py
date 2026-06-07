#!/usr/bin/env python3
"""Proof-animation CONVERSION library — a ProofTrajectory → animation data.

Deterministic, no LM. Given the expert's output (a ``ProofTrajectory``: a start
state + ordered ``DerivationStep``s), this threads the states so a sub-expression
that persists keeps the SAME node id across states (GumTree-style rebase) and
renders each state to **annotated LaTeX** (``\\htmlData{n=<id>}{...}``) with those
stable ids. The JS engine FLIP-morphs between states keyed on ``data-n``.

This module is the conversion only. The committed test cases live in
``tests/proof_animation/proof_animations.json``; rendering to HTML is ``report.py``;
deriving a proof from a prompt is ``derive.py``.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict

from pydantic import BaseModel, ConfigDict

from backend.semantic_graph.service import SemanticGraphService
from backend.semantic_graph.latex_renderer import to_latex
from backend.experts.modules.proof_completion.graph_ops import wl_colors, _content
from backend.experts.modules.proof_completion.outputs import ProofTrajectory


def _children(graph):
    """node id -> [(role, child_id)] (operands = incoming edges)."""
    ch = defaultdict(list)
    for e in graph.edges:
        ch[e.to].append((e.role, e.from_))
    return ch


def _subtree_sigs(graph):
    """Per-node DOWNWARD subtree signature: identical subtrees share a sig,
    wherever they sit. (content + sorted child sigs.) Returns (sig, children, nodes, size)."""
    nodes = {n.id: n for n in graph.nodes}
    ch = _children(graph)
    sig, size = {}, {}

    def walk(nid):
        if nid in sig:
            return
        for _r, c in ch[nid]:
            walk(c)
        kids = tuple(sorted((r or "", sig[c]) for r, c in ch[nid]))
        # deterministic, collision-resistant digest (not Python's salted hash())
        sig[nid] = hashlib.blake2b(repr((_content(nodes[nid]), kids)).encode(),
                                   digest_size=16).hexdigest()
        size[nid] = 1 + sum(size[c] for _r, c in ch[nid])

    for nid in nodes:
        walk(nid)
    return sig, ch, nodes, size


def _rebase(prev, gnew):
    """Relabel gnew so persisting sub-expressions keep prev's ids, preserving
    gnew's OWN structure (authored side order) and **minimizing change**.

    GumTree-style top-down match: anchor the LARGEST identical subtrees first
    (by downward subtree signature), pairing each prev node with an unmatched new
    node of the same signature and recursively aligning their (structurally
    identical) descendants. This keeps repeated/unchanged pieces — e.g. the ``2``
    in ``c^2`` — bound to the same id across states, so they neither move nor get
    deleted-and-reinserted. Whatever is left over falls back to a content-only
    (``diff``-style) match; genuinely new nodes get a fresh, collision-free id.
    """
    psig, pch, pnodes, psize = _subtree_sigs(prev)
    nsig, nch, nnodes, _ = _subtree_sigs(gnew)

    new_by_sig = defaultdict(list)
    for nid in nnodes:
        new_by_sig[nsig[nid]].append(nid)

    new_to_prev, used_prev, matched_new = {}, set(), set()

    def match_tree(pid, nid):
        new_to_prev[nid] = pid
        used_prev.add(pid)
        matched_new.add(nid)
        pc = sorted(pch[pid], key=lambda rc: (rc[0] or "", psig[rc[1]]))
        nc = sorted(nch[nid], key=lambda rc: (rc[0] or "", nsig[rc[1]]))
        for (_pr, pcid), (_nr, ncid) in zip(pc, nc):
            match_tree(pcid, ncid)

    # anchor largest identical subtrees first
    for pid in sorted(pnodes, key=lambda i: -psize[i]):
        if pid in used_prev:
            continue
        cand = next((c for c in new_by_sig.get(psig[pid], []) if c not in matched_new), None)
        if cand is not None:
            match_tree(pid, cand)

    # content-only fallback for whatever's left (a changed node that still has a
    # same-content counterpart, e.g. a coefficient that changed value)
    cprev, cnew = wl_colors(prev, rounds=0), wl_colors(gnew, rounds=0)
    rem_by_content = defaultdict(list)
    for p in pnodes:
        if p not in used_prev:
            rem_by_content[cprev[p]].append(p)
    for nid in nnodes:
        if nid in matched_new:
            continue
        bucket = rem_by_content.get(cnew[nid])
        if bucket:
            new_to_prev[nid] = bucket.pop(0)
            matched_new.add(nid)

    # build the id map; new nodes keep their own id, deduped against taken ones
    final, taken, k = {}, set(new_to_prev.values()), 0
    for nid in nnodes:
        if nid in new_to_prev:
            final[nid] = new_to_prev[nid]
        else:
            tgt = nid
            while tgt in taken:
                k += 1
                tgt = f"_r{k}_{nid}"
            final[nid] = tgt
            taken.add(tgt)

    g = gnew.model_copy(deep=True)
    for n in g.nodes:
        n.id = final[n.id]
    for e in g.edges:
        e.from_, e.to = final[e.from_], final[e.to]
    return g


class ProofAnimation(BaseModel):
    """One animation = a ProofCompletionExpert ``ProofTrajectory`` + display meta.

    The ``trajectory`` is the expert's output type **verbatim**, so a real expert
    result animates with zero conversion. ``title``/``domain`` are the only
    animation-side additions — a trajectory carries no display label and no parser
    domain of its own.
    """

    model_config = ConfigDict(extra="forbid")
    title: str
    domain: str = "algebra"
    # Caption for the initial state (step 0). The trajectory's start_latex carries
    # no operation/justification of its own, so the animation supplies them — both
    # may use inline $…$ LaTeX.
    start_operation: str = "Start"
    start_justification: str = "the starting expression"
    trajectory: ProofTrajectory


def build(trajectory: ProofTrajectory, domain: str, title: str = "", *,
          start_operation: str = "Start",
          start_justification: str = "the starting expression") -> dict:
    """Render a ProofCompletionExpert ``ProofTrajectory`` into animation data.

    The trajectory is the expert's output: ``start_latex`` plus ordered
    ``DerivationStep``s (each a complete ``expr_latex`` reached by one
    ``operation``). The animation chain is the start state followed by each step's
    expression; we parse each, rebase onto the previous so persisting parts keep
    stable ids, and emit id-annotated LaTeX for the FLIP engine. ``start_operation``
    / ``start_justification`` caption the initial state (step 0).
    """
    # (operation, justification, latex) for every state, starting from the start.
    chain: list[tuple[str, str, str]] = []
    if trajectory.start_latex:
        chain.append((start_operation, start_justification, trajectory.start_latex))
    for s in trajectory.steps:
        chain.append((s.operation, s.justification, s.expr_latex))
    if not chain:
        raise ValueError("trajectory has no states (need start_latex or steps)")

    svc = SemanticGraphService()
    working = None
    out = []
    for i, (operation, justification, ltx) in enumerate(chain):
        g = svc.latex_to_graph(ltx, domain=domain)
        if g is None:
            raise ValueError(f"could not parse state {i}: {ltx!r}")
        # rebase: keep g's authored structure, reuse stable ids for persisting parts
        working = g if working is None else _rebase(working, g)
        out.append({
            "index": i,
            "operation": operation,
            "justification": justification,
            "input_latex": ltx,                         # what was authored
            "latex": to_latex(working, with_ids=True),  # annotated, stable ids
            "plain": to_latex(working),                 # for labels/fallback
        })
    return {"title": title, "domain": domain, "steps": out}


def build_animation(anim: ProofAnimation) -> dict:
    """Build animation data from a ProofAnimation (carries the step-0 caption)."""
    return build(anim.trajectory, anim.domain, anim.title,
                 start_operation=anim.start_operation,
                 start_justification=anim.start_justification)
