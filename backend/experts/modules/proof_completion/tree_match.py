"""Stable-id tree matching for proof animation — the GumTree-style rebase.

Deterministic, no LM. Given two consecutive proof states as :class:`SemanticGraph`
(the previous good state ``prev`` and the authored new state ``gnew``), :func:`rebase`
relabels ``gnew`` so a sub-expression that persists keeps ``prev``'s node id. That
stable id is what lets the frontend FLIP engine *morph* (move) a glyph across a
step instead of deleting-and-reinserting it.

This module is the matcher *only* — extracted from ``animation.py`` so it can be
unit-tested in isolation. ``animation.build`` imports :func:`rebase` and threads
the previous state through it state-by-state. The renderer
(``semantic_graph.latex_renderer``) projects the resulting node ids to per-glyph
``data-n`` attributes downstream; this module never touches LaTeX.

**Matching criterion.** Identity is a node's *content* (``_content`` from
:mod:`graph_ops` — for symbol leaves the id/name is part of that content; for
synthetic operator/number nodes the id is ignored and only op/label/value +
structure matter) plus its *structural position* (downward subtree signature,
then content-only fallback).

Current algorithm (GumTree phase 1 + a content-only fallback) — see the project
plan for the planned upgrade to full GumTree (bottom-up Dice + locally-optimal
recovery + history-aware identity).
"""
from __future__ import annotations

import hashlib
from collections import defaultdict

from backend.experts.modules.proof_completion.graph_ops import wl_colors, _content


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


def rebase(prev, gnew):
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
