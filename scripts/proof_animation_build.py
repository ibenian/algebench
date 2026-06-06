#!/usr/bin/env python3
"""Build an animation.json for the proof-animation engine — deterministic, no LM.

Takes a chain of LaTeX states (a derivation), threads them so a sub-expression
that persists keeps the SAME node id across states (via graph_ops.diff/apply),
and renders each state to **annotated LaTeX** (``\\htmlData{n=<id>}{...}``) with
those stable ids. The JS engine then FLIP-morphs between any two states keyed on
``data-n``.

Usage:
    ./run.sh scripts/proof_animation_build.py --sample --out /tmp/animation.json
    ./run.sh scripts/proof_animation_build.py --out a.json "x^2 - 4 = 0" "x^2 = 4" "x = 2"
    ./run.sh scripts/proof_animation_build.py --from-json traj.json --out a.json
"""
from __future__ import annotations

import argparse
import json

from collections import defaultdict
from pathlib import Path

from pydantic import BaseModel, ConfigDict

from backend.semantic_graph.service import SemanticGraphService
from backend.semantic_graph.latex_renderer import to_latex
from backend.experts.modules.proof_completion.graph_ops import wl_colors, _content
from backend.experts.modules.proof_completion.outputs import (
    ProofTrajectory, DerivationStep,
)


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
        sig[nid] = hash((_content(nodes[nid]), kids))
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
    trajectory: ProofTrajectory


def _anim(title: str, start: str,
          steps: list[tuple[str, str, str]], domain: str = "algebra") -> ProofAnimation:
    """Author a ProofAnimation from a start state + (operation, latex, justification) steps."""
    return ProofAnimation(
        title=title,
        domain=domain,
        trajectory=ProofTrajectory(
            start_latex=start,
            target_latex=steps[-1][1] if steps else start,
            steps=[DerivationStep(step=i + 1, operation=op, expr_latex=ex, justification=ju)
                   for i, (op, ex, ju) in enumerate(steps)],
        ),
    )


# Deterministic demos, authored in the expert's own output shape (a
# ProofTrajectory: a start state + ordered DerivationSteps). operation/justification
# may use inline LaTeX in $…$ (the engine renders it).
SAMPLE = _anim(
    "Isolate a", r"a + b - c = 0",
    [
        (r"add $c$ to both sides", r"a + b = c", r"$c$ crosses the $=$ and flips sign"),
        (r"subtract $b$ from both sides", r"a = c - b", r"$b$ crosses over, leaving $a$ isolated"),
    ],
)

SAMPLES = [
    SAMPLE,
    _anim("Expand the binomial", r"(x + 1)^2", [
        (r"expand $(x+1)^2$", r"x^2 + 2 x + 1", r"$(x+1)^2 = x^2 + 2x + 1$"),
    ]),
    _anim("Factor the difference of squares", r"a^2 - b^2", [
        (r"factor", r"(a - b)(a + b)", r"$a^2 - b^2 = (a-b)(a+b)$"),
    ]),
    _anim("Relativistic energy–momentum", r"E^2 = (m c^2)^2 + (p c)^2", [
        (r"take the square root", r"E = \sqrt{(m c^2)^2 + (p c)^2}", r"solve for $E$ (positive root)"),
        (r"expand the squares", r"E = \sqrt{m^2 c^4 + p^2 c^2}", r"$(m c^2)^2 = m^2 c^4,\ (p c)^2 = p^2 c^2$"),
        (r"factor out $c^2$", r"E = \sqrt{c^2 \cdot (m^2 c^2 + p^2)}", r"$c^2$ is common to both terms"),
        (r"pull $c$ out of the root", r"E = c \sqrt{m^2 c^2 + p^2}", r"$\sqrt{c^2 x} = c \sqrt{x}$"),
        (r"factor out $m^2 c^2$", r"E = m c^2 \sqrt{1 + \frac{p^2}{m^2 c^2}}", r"the standard Lorentz-factor form"),
    ]),
    _anim("Lorentz time dilation", r"(c t)^2 = (c t_0)^2 + (v t)^2", [
        (r"expand the squares", r"c^2 t^2 = c^2 t_0^2 + v^2 t^2", r"$(c t)^2 = c^2 t^2$, etc."),
        (r"collect the $t$ terms", r"c^2 t^2 - v^2 t^2 = c^2 t_0^2", r"move $v^2 t^2$ to the left"),
        (r"factor out $t^2$", r"t^2 \cdot (c^2 - v^2) = c^2 t_0^2", r"$t^2$ is common on the left"),
        (r"divide by $c^2 - v^2$", r"t^2 = \frac{c^2 t_0^2}{c^2 - v^2}", r"isolate $t^2$"),
        (r"divide top and bottom by $c^2$", r"t^2 = \frac{t_0^2}{1 - \frac{v^2}{c^2}}", r"introduce $\frac{v^2}{c^2}$"),
        (r"take the square root", r"t = \frac{t_0}{\sqrt{1 - \frac{v^2}{c^2}}}", r"moving clocks run slow by $\gamma$"),
    ]),
]


def build(trajectory: ProofTrajectory, domain: str, title: str = "") -> dict:
    """Render a ProofCompletionExpert ``ProofTrajectory`` into animation data.

    The trajectory is the expert's output: ``start_latex`` plus ordered
    ``DerivationStep``s (each a complete ``expr_latex`` reached by one
    ``operation``). The animation chain is the start state followed by each step's
    expression; we parse each, rebase onto the previous so persisting parts keep
    stable ids, and emit id-annotated LaTeX for the FLIP engine.
    """
    # (operation, justification, latex) for every state, starting from the start.
    chain: list[tuple[str, str, str]] = []
    if trajectory.start_latex:
        chain.append(("start", "", trajectory.start_latex))
    for s in trajectory.steps:
        chain.append((s.operation, s.justification, s.expr_latex))
    if not chain:
        raise SystemExit("trajectory has no states (need start_latex or steps)")

    svc = SemanticGraphService()
    working = None
    out = []
    for i, (operation, justification, ltx) in enumerate(chain):
        g = svc.latex_to_graph(ltx, domain=domain)
        if g is None:
            raise SystemExit(f"could not parse state {i}: {ltx!r}")
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("states", nargs="*", help="LaTeX states (the derivation chain)")
    ap.add_argument("--domain", default="algebra")
    ap.add_argument("--title", default="")
    ap.add_argument("--sample", action="store_true", help="use the baked sample chain")
    ap.add_argument("--from-json", default=None,
                    help="a ProofCompletionExpert ProofTrajectory (JSON) to animate")
    ap.add_argument("--dump-samples", default=None,
                    help="write the baked SAMPLES to a proofs JSON file (the test suite) and exit")
    ap.add_argument("--out", default="/tmp/animation.json")
    args = ap.parse_args()

    if args.dump_samples:
        path = Path(args.dump_samples)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps([a.model_dump() for a in SAMPLES], indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"wrote {path}  ({len(SAMPLES)} proofs)")
        return 0

    if args.sample:
        data = build(SAMPLE.trajectory, SAMPLE.domain, args.title or SAMPLE.title)
    elif args.from_json:
        with open(args.from_json, encoding="utf-8") as fh:
            traj = ProofTrajectory.model_validate_json(fh.read())
        data = build(traj, args.domain, args.title or "derivation")
    elif args.states:
        # raw LaTeX states (dev convenience) → a trajectory with placeholder captions
        traj = ProofTrajectory(
            start_latex=args.states[0],
            steps=[DerivationStep(step=i, operation=f"step {i}", expr_latex=s,
                                  justification="(manual)")
                   for i, s in enumerate(args.states[1:], start=1)],
        )
        data = build(traj, args.domain, args.title)
    else:
        ap.error("provide states, --sample, or --from-json")

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    print(f"wrote {args.out}  ({len(data['steps'])} states)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
