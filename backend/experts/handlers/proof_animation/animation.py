"""Proof-animation CONVERSION library — a ProofTrajectory → animation data.

Deterministic, no LM. Given the expert's output (a ``ProofTrajectory``: a start
state + ordered ``DerivationStep``s), this threads the states so a sub-expression
that persists keeps the SAME node id across states (GumTree-style rebase) and
renders each state to **annotated LaTeX** (``\\htmlData{n=<id>}{...}``) with those
stable ids. The JS engine FLIP-morphs between states keyed on ``data-n``.

This module is the conversion core. The proof-animation *handler* (``handler.py``)
calls ``build`` after running the ProofCompletionExpert; the offline tooling
(``scripts/proof_animation/build.py``) re-imports ``build`` and wraps it with a
``ProofAnimation`` display model.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict

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
        try:
            g = svc.latex_to_graph(ltx, domain=domain)
        except Exception:
            g = None
        # An ungroundable state — one that won't parse to a graph OR whose graph
        # can't be re-rendered (e.g. an operator the renderer doesn't know) — is
        # shown as raw LaTeX (no stable-id morphing) rather than failing the whole
        # derivation. ``working`` only advances on a fully-rendered state, so the
        # next good state rebases onto the last good one.
        annotated = plain = ltx
        if g is not None:
            try:
                cand = g if working is None else _rebase(working, g)
                annotated = to_latex(cand, with_ids=True)   # annotated, stable ids
                plain = to_latex(cand)                       # for labels/fallback
                working = cand
            except Exception:
                annotated = plain = ltx
        out.append({
            "index": i,
            "operation": operation,
            "justification": justification,
            "input_latex": ltx,
            "latex": annotated,
            "plain": plain,
        })
    return {"title": title, "domain": domain, "steps": out}
