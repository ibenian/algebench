"""Stable-id tree matching for proof animation — a GumTree-fidelity rebase.

Deterministic, no LM. Given two consecutive proof states as :class:`SemanticGraph`
(the previous good state ``prev`` and the authored new state ``gnew``), :func:`rebase`
relabels ``gnew`` so a sub-expression that persists keeps ``prev``'s node id. That
stable id is what lets the frontend FLIP engine *morph* (move) a glyph across a
step instead of deleting-and-reinserting it.

This module is the matcher *only* — kept apart from ``animation.py`` so it can be
unit-tested in isolation. ``animation.build`` imports :func:`rebase` and threads
the previous state (plus a history ``registry``) through it state-by-state. The
renderer (``semantic_graph.latex_renderer``) projects the resulting node ids to
per-glyph ``data-n`` attributes downstream; this module never touches LaTeX.

The algorithm follows GumTree (Falleri et al. 2014):

1. **Top-down** anchoring of isomorphic subtrees, tallest first. A *unique*
   isomorphic candidate is anchored at any height; an *ambiguous* match (several
   identical candidates, e.g. repeated atoms) is anchored only above
   ``MIN_HEIGHT`` and resolved by parent/position similarity — below that it is
   deferred so it gets matched in parent context (no arbitrary cross-pairing).
2. **Bottom-up** container matching: an unmatched parent re-binds to the
   counterpart sharing the most already-anchored descendants, scored by the
   **Dice coefficient** and accepted at ``MIN_DICE``.
3. **Recovery**: inside a matched container, a *locally-optimal* ordered
   alignment (bounded by ``MAX_SIZE``) recovers additional same-content mappings
   among the leftover descendants — parent-scoped, so nothing teleports.
4. **History-aware id assignment**: a node unmatched by the pairwise phases
   revives its prior canonical id from the derivation-wide ``registry`` (keyed by
   structural signature) if that id is free this state; otherwise it keeps its own
   id, collision-deduped. This keeps ids globally consistent across *all* states,
   so a sub-expression that vanishes and reappears regains its id and non-adjacent
   states morph smoothly.

**Matching criterion.** Identity is a node's *content* (``_content`` from
:mod:`graph_ops` — for symbol leaves the id/name is part of that content; for
synthetic operator/number nodes the id is ignored and only op/label/value +
structure matter) plus its *structural position*.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict

from backend.experts.modules.proof_completion.graph_ops import _content

# GumTree thresholds (paper defaults, tuned for math expressions).
MIN_HEIGHT = 2   # leaves have height 1; this gates only AMBIGUOUS top-down matches
MIN_DICE = 0.5   # min shared-descendant similarity to form a container mapping
MAX_SIZE = 100   # recovery is skipped for containers larger than this (cost ceiling)


def _children(graph):
    """node id -> [(role, child_id)] (operands = incoming edges)."""
    ch = defaultdict(list)
    for e in graph.edges:
        ch[e.to].append((e.role, e.from_))
    return ch


class _Index:
    """Precomputed per-node structure for one graph (see :func:`_index`)."""

    __slots__ = ("nodes", "ch", "par", "content", "sig", "size", "height",
                 "desc", "postorder")

    def __init__(self, nodes, ch, par, content, sig, size, height, desc, postorder):
        self.nodes = nodes          # id -> SemanticGraphNode
        self.ch = ch                # parent id -> [(role, child id)]
        self.par = par              # child id -> [(role, parent id)]
        self.content = content      # id -> _content tuple
        self.sig = sig              # id -> downward subtree signature (blake2b)
        self.size = size            # id -> subtree node count (paths; tiebreak only)
        self.height = height        # id -> subtree height (leaf = 1)
        self.desc = desc            # id -> set of proper descendant ids
        self.postorder = postorder  # ids, children before parents


def _index(graph) -> _Index:
    """Build the :class:`_Index` for *graph* in a couple of passes.

    Edges point operand -> operator, so ``ch`` (incoming) are a node's operands
    and ``par`` (outgoing) are the operators that consume it. Signatures, sizes,
    heights and descendant sets are memoized so a shared (DAG) node is computed
    once and counted once per set.
    """
    nodes = {n.id: n for n in graph.nodes}
    ch = defaultdict(list)
    par = defaultdict(list)
    for e in graph.edges:
        ch[e.to].append((e.role, e.from_))
        par[e.from_].append((e.role, e.to))
    content = {nid: _content(n) for nid, n in nodes.items()}

    sig, size, height, desc = {}, {}, {}, {}
    visiting = set()

    def walk(nid):
        if nid in sig:
            return
        if nid in visiting:          # cycle guard (defensive; graphs are DAGs)
            return
        visiting.add(nid)
        kids, d, h, sz = [], set(), 1, 1
        for r, c in ch[nid]:
            walk(c)
            if c not in sig:         # cycle fallback
                continue
            kids.append((r or "", sig[c]))
            d.add(c)
            d |= desc[c]
            h = max(h, 1 + height[c])
            sz += size[c]
        visiting.discard(nid)
        # deterministic, collision-resistant digest (not Python's salted hash())
        sig[nid] = hashlib.blake2b(
            repr((content[nid], tuple(sorted(kids)))).encode(),
            digest_size=16).hexdigest()
        size[nid] = sz
        height[nid] = h
        desc[nid] = d

    for nid in nodes:
        walk(nid)

    roots = [nid for nid in nodes if not par.get(nid)]
    postorder, seen = [], set()

    def post(nid):
        if nid in seen:
            return
        seen.add(nid)
        for _r, c in ch[nid]:
            post(c)
        postorder.append(nid)

    for r in sorted(roots):
        post(r)
    for nid in nodes:                # defensive: include anything unreached
        post(nid)

    return _Index(nodes, ch, par, content, sig, size, height, desc, postorder)


# --------------------------------------------------------------------------- #
# phase 1 — top-down anchoring (with ambiguity disambiguation)
# --------------------------------------------------------------------------- #

def _match_tree(pi, ni, pid, nid, new_to_prev, used_prev, matched_new):
    """Anchor two isomorphic subtrees, aligning descendants by (role, sig)."""
    new_to_prev[nid] = pid
    used_prev.add(pid)
    matched_new.add(nid)
    pc = sorted(pi.ch[pid], key=lambda rc: (rc[0] or "", pi.sig[rc[1]]))
    nc = sorted(ni.ch[nid], key=lambda rc: (rc[0] or "", ni.sig[rc[1]]))
    for (_pr, pcid), (_nr, ncid) in zip(pc, nc):
        _match_tree(pi, ni, pcid, ncid, new_to_prev, used_prev, matched_new)


def _disambiguate(pid, cands, pi, ni, new_to_prev, ppos, npos):
    """Pick the candidate whose parent context best matches ``pid``'s.

    Primary: how many of the candidate's parents are already mapped from one of
    ``pid``'s parents with the same role (locality — keeps a repeated subtree
    bound to the right parent). Then positional proximity, then id, for a fully
    deterministic choice.
    """
    p_parents = {(r or "", pp) for r, pp in pi.par[pid]}
    target = ppos.get(pid, 0)

    def score(c):
        return sum(1 for r, np_ in ni.par[c]
                   if (r or "", new_to_prev.get(np_)) in p_parents)

    return sorted(cands, key=lambda c: (-score(c), abs(npos.get(c, 0) - target), c))[0]


def _top_down(pi, ni, new_to_prev, used_prev, matched_new):
    new_by_sig = defaultdict(list)
    for nid in ni.nodes:
        new_by_sig[ni.sig[nid]].append(nid)

    ppos = {nid: i for i, nid in enumerate(pi.postorder)}
    npos = {nid: i for i, nid in enumerate(ni.postorder)}

    # tallest first, then largest, then stable id
    order = sorted(pi.nodes, key=lambda p: (-pi.height[p], -pi.size[p], p))
    for pid in order:
        if pid in used_prev:
            continue
        cands = [c for c in new_by_sig.get(pi.sig[pid], []) if c not in matched_new]
        if not cands:
            continue
        if len(cands) == 1:
            # a unique isomorphic match is unambiguous — anchor at any height
            _match_tree(pi, ni, pid, cands[0], new_to_prev, used_prev, matched_new)
        elif pi.height[pid] >= MIN_HEIGHT:
            # several identical candidates: resolve by parent/position context.
            # below MIN_HEIGHT (bare atoms) we defer — they get matched in parent
            # context by the bottom-up / recovery phases, never arbitrarily here.
            best = _disambiguate(pid, cands, pi, ni, new_to_prev, ppos, npos)
            _match_tree(pi, ni, pid, best, new_to_prev, used_prev, matched_new)


# --------------------------------------------------------------------------- #
# phase 2 — bottom-up container matching (Dice) + phase 3 recovery
# --------------------------------------------------------------------------- #

def _bottom_up(pi, ni, new_to_prev, used_prev, matched_new):
    for pid in pi.postorder:                 # children before parents
        if pid in used_prev or not pi.ch[pid]:
            continue
        pdesc = pi.desc[pid]
        if not any(d in used_prev for d in pdesc):
            continue                          # need an anchor to build on
        best, best_dice, ambiguous = None, 0.0, False
        for nid in ni.nodes:
            if nid in matched_new or not ni.ch[nid]:
                continue
            if ni.content[nid] != pi.content[pid]:
                continue
            ndesc = ni.desc[nid]
            common = sum(1 for nd in ndesc if new_to_prev.get(nd) in pdesc)
            denom = len(pdesc) + len(ndesc)
            if not denom:
                continue
            dice = 2.0 * common / denom
            if dice <= 0:
                continue
            if dice > best_dice:
                best, best_dice, ambiguous = nid, dice, False
            elif dice == best_dice:
                ambiguous = True
        # Match only an UNAMBIGUOUS best (a single candidate with the top Dice).
        # A tie means several new containers are equally similar (e.g. the old
        # ``(c·t)^2`` is exactly as close to ``c^2`` as to ``t^2``) — picking one
        # would teleport the glyph to an arbitrary spot, so let it fade instead.
        # A unique best still morphs (e.g. ``√x`` -> ``√(x+y)`` resizes).
        if best is not None and best_dice >= MIN_DICE and not ambiguous:
            new_to_prev[best] = pid
            used_prev.add(pid)
            matched_new.add(best)
            if len(pdesc) <= MAX_SIZE and len(ni.desc[best]) <= MAX_SIZE:
                _recover(pi, ni, pid, best, new_to_prev, used_prev, matched_new)


def _ordered_align(a, b, pi, ni, new_to_prev, used_prev, matched_new):
    """Locally-optimal ordered alignment of two child sequences.

    Weight 2 for an already-matched pair (keep the scaffold aligned), 1 for a
    fresh same-content revival, and disallow anything else. A backward DP / LCS
    maximises total weight, so leftover holes are filled optimally per level
    while ancestor + sibling order is preserved (the ordered tree-edit model).
    """
    n, m = len(a), len(b)

    def w(i, j):
        pa, nb = a[i], b[j]
        if new_to_prev.get(nb) == pa:
            return 2
        if pa not in used_prev and nb not in matched_new and pi.content[pa] == ni.content[nb]:
            return 1
        return -1

    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            best = max(dp[i + 1][j], dp[i][j + 1])
            wij = w(i, j)
            if wij > 0:
                best = max(best, wij + dp[i + 1][j + 1])
            dp[i][j] = best

    pairs, i, j = [], 0, 0
    while i < n and j < m:
        wij = w(i, j)
        if wij > 0 and dp[i][j] == wij + dp[i + 1][j + 1]:
            pairs.append((a[i], b[j]))
            i += 1
            j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return pairs


def _recover(pi, ni, pid, nid, new_to_prev, used_prev, matched_new):
    """Fill same-content leftovers inside a matched container, then descend."""
    a = [c for _r, c in sorted(pi.ch[pid], key=lambda rc: (rc[0] or "", pi.sig[rc[1]]))]
    b = [c for _r, c in sorted(ni.ch[nid], key=lambda rc: (rc[0] or "", ni.sig[rc[1]]))]
    for pa, nb in _ordered_align(a, b, pi, ni, new_to_prev, used_prev, matched_new):
        if (pa not in used_prev and nb not in matched_new
                and pi.content[pa] == ni.content[nb]):
            new_to_prev[nb] = pa
            used_prev.add(pa)
            matched_new.add(nb)
            _recover(pi, ni, pa, nb, new_to_prev, used_prev, matched_new)
        elif new_to_prev.get(nb) == pa:
            _recover(pi, ni, pa, nb, new_to_prev, used_prev, matched_new)


# --------------------------------------------------------------------------- #
# phase 4 — history-aware id assignment
# --------------------------------------------------------------------------- #

def _assign_ids(ni, new_to_prev, registry, prev_ids):
    """Map every new node id to its final, stable id.

    Matched nodes inherit the prev id. Otherwise revive a prior canonical id from
    ``registry`` (keyed by structural signature) if it is free this state; failing
    that keep the node's own id, deduped against everything already taken. After
    assignment, record every node's signature -> final id so later states can
    revive it.

    ``prev_ids`` (all of ``prev``'s node ids) seed ``taken`` so an UNMATCHED new
    node can never coincidentally reuse a *faded* prev node's synthetic id — the
    frontend would otherwise treat the shared ``data-n`` as a (false) morph and
    teleport the glyph. Morphs must come from real matches, not id collisions.
    """
    final, taken, k = {}, set(new_to_prev.values()) | set(prev_ids), 0
    for nid in ni.nodes:
        if nid in new_to_prev:
            final[nid] = new_to_prev[nid]
            continue
        revived = registry.get(ni.sig[nid]) if registry is not None else None
        if revived is not None and revived not in taken:
            final[nid] = revived
            taken.add(revived)
            continue
        tgt = nid
        while tgt in taken:
            k += 1
            tgt = f"_r{k}_{nid}"
        final[nid] = tgt
        taken.add(tgt)

    if registry is not None:
        for nid in ni.nodes:         # most-recent-wins
            registry[ni.sig[nid]] = final[nid]
    return final


# --------------------------------------------------------------------------- #
# public entry
# --------------------------------------------------------------------------- #

def rebase(prev, gnew, registry=None):
    """Relabel ``gnew`` so persisting sub-expressions keep ``prev``'s ids.

    Preserves ``gnew``'s own structure (authored side order) and minimizes change
    via the four GumTree phases above. ``registry`` (a dict owned by the caller,
    threaded across all states) makes id assignment history-aware; when omitted
    the call is pure pairwise. Genuinely new nodes get a fresh, collision-free id.
    """
    pi, ni = _index(prev), _index(gnew)
    new_to_prev, used_prev, matched_new = {}, set(), set()

    _top_down(pi, ni, new_to_prev, used_prev, matched_new)
    _bottom_up(pi, ni, new_to_prev, used_prev, matched_new)
    final = _assign_ids(ni, new_to_prev, registry, pi.nodes.keys())

    g = gnew.model_copy(deep=True)
    for n in g.nodes:
        n.id = final[n.id]
    for e in g.edges:
        e.from_, e.to = final[e.from_], final[e.to]
    return g
