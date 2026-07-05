#!/usr/bin/env python3
"""Pre-bake semantic graph *enrichment* into an AlgeBench scene/lesson JSON file.

Companion to ``prebake_semantic_graphs.py``. That script bakes the *structural*
graph (parser output) into every proof step. This one takes those already-baked
structural graphs and runs the Gemini **enrichment** agent over them offline —
filling in node ``description``/``emoji``, correcting ``quantity``/``unit``/
``dimension``/``role``, inferring ``domain`` — and writes the result back so the
browser never has to fire the live ``/api/graph/enrich`` round-trip (see
``enrichGraphInBackground`` in ``static/graph-view.js``).

The pipeline is the *exact* one the server uses at ``/api/graph/enrich``:
strip annotation nodes → validate as ``SemanticGraph`` → ``aenrich`` (first
pass + coherence critic + safety-net merges) → re-attach annotations. A baked
enrichment is therefore what the server would have produced live; baking only
moves *when* the work happens, never the result.

Scope guarantees
----------------
- Operates **only on existing baked graphs** (``step.semanticGraph.graph``).
  Steps with ``math`` but no baked graph are reported and skipped — run
  ``prebake_semantic_graphs.py --write`` first to derive their structure.
- Touches **nothing** but the graph object of the steps it enriches. The
  structural nodes/edges, ``math``, labels, justifications, every other scene
  field — all preserved. A round-trip assertion guards the compact rewrite.
- "Enriched" is detected purely by the presence of the ``enrichment`` block on
  a graph (same marker the server and client gate on).

Modes (exactly one is required)
--------------------------------
  --status    Read-only. Report every proof step, which have baked graphs, and
              which of those are already enriched vs not. Never calls Gemini,
              never writes. Exit 2 if there are unenriched graphs (work
              suggested), 0 otherwise.
  --dry-run   Enrich the unenriched graphs (real Gemini calls) but DO NOT write
              the file. Reports what would change.
  --write     Enrich and rewrite the file in compact-leaves form (same writer
              as ``prebake_semantic_graphs``).

Selection
---------
  Default          Only graphs without an ``enrichment`` block are enriched;
                   already-enriched graphs are left untouched.
  --all            Re-bake enrichment for EVERY existing graph, including ones
                   already enriched. The prior enrichment is reverted first
                   (the fields it added — per ``enrichment.fields`` — are
                   removed and the ``enrichment`` block dropped) so the agent
                   re-runs on the clean structural graph.

Usage
-----
    ./run.sh scripts/prebake_semantic_graph_enrichment.py scene.json --status
    ./run.sh scripts/prebake_semantic_graph_enrichment.py scene.json --status --json
    ./run.sh scripts/prebake_semantic_graph_enrichment.py scene.json --dry-run
    ./run.sh scripts/prebake_semantic_graph_enrichment.py scene.json --write
    ./run.sh scripts/prebake_semantic_graph_enrichment.py scene.json --write --all
    ./run.sh scripts/prebake_semantic_graph_enrichment.py scene.json --write --concurrency 4
    ./run.sh scripts/prebake_semantic_graph_enrichment.py scene.json --write --retries 6

``--retries N`` sets the enrichment agent's output-validation retry budget
(default 2, matching the live endpoint). Higher values give the model more
attempts to emit a schema-valid field. Note this does NOT help *dropped-node*
failures — there the validator re-raises on every retry, so more retries just
fail slower; re-running the script (a fresh first attempt) is what helps those.

Exit codes
----------
    0  Nothing to do (status: all enriched / no graphs; dry-run/write: done or no-op)
    1  Usage / IO / parse error  (or write/dry-run: one or more enrichments failed)
    2  --status only: there are unenriched graphs (work suggested)
"""

import argparse
import asyncio
import copy
import json
import sys
import time
from pathlib import Path

# Reuse the backend's normalization + the prebake writer verbatim so output
# formatting matches ``prebake_semantic_graphs`` exactly. Importing backend is
# heavy (FastAPI/genai) but this is an offline CLI, so that cost is irrelevant.
from backend.server import _normalize_proofs  # noqa: E402
from backend.model import SemanticGraph  # noqa: E402
from _json_format import dumps_compact_leaves  # noqa: E402
from scripts.prebake_semantic_graphs import (  # noqa: E402
    _existing_graph,
    _fmt_bytes,
)

# Annotation nodes carry free-text labels that can exceed Pydantic field limits
# and aren't meaningful to the enricher — the server strips them before
# validation and re-attaches afterward (server.py ~1485). We mirror that here.
_ANNOTATION_TYPE = "annotation"


def _iter_steps(spec):
    """Yield ``(scene_idx, proof_idx, step_idx, scene, proof, step)`` for every
    proof step. Carries the scene/proof so enrichment context can be built,
    mirroring the traversal in the server's autofill + ``buildEnrichContext``.
    """
    if not isinstance(spec, dict):
        return
    scenes_list = spec.get("scenes")
    if not isinstance(scenes_list, list):
        return
    for si, sc in enumerate(scenes_list):
        if not isinstance(sc, dict):
            continue
        for pi, proof in enumerate(_normalize_proofs(sc.get("proof"))):
            steps = proof.get("steps")
            if not isinstance(steps, list):
                continue
            for ki, step in enumerate(steps):
                if isinstance(step, dict):
                    yield si, pi, ki, sc, proof, step


def _is_enriched(graph):
    """True iff a baked graph dict carries an ``enrichment`` block — the same
    marker the server and client gate on."""
    return isinstance(graph, dict) and isinstance(graph.get("enrichment"), dict)


def _build_context(spec, scene, proof, step):
    """Reconstruct the enrichment context the browser sends, field-for-field
    from ``buildEnrichContext`` in ``static/graph-view.js``. Context
    disambiguates ambiguous symbols (e.g. ``T`` = thrust vs temperature), so
    baking with it produces the same result the live UI would.
    """
    ctx = {}
    if isinstance(spec, dict):
        if spec.get("title"):
            ctx["lessonTitle"] = spec["title"]
        if spec.get("description"):
            ctx["lessonDescription"] = spec["description"]
    if isinstance(scene, dict):
        if scene.get("title"):
            ctx["sceneTitle"] = scene["title"]
        if scene.get("description"):
            ctx["sceneDescription"] = scene["description"]
    if isinstance(proof, dict):
        if proof.get("title"):
            ctx["proofTitle"] = proof["title"]
        if proof.get("goal"):
            ctx["proofGoal"] = proof["goal"]
        if proof.get("technique"):
            ctx["proofTechnique"] = proof["technique"]
    if isinstance(step, dict):
        if step.get("label"):
            ctx["stepLabel"] = step["label"]
        if step.get("math"):
            ctx["stepMath"] = step["math"]
        if step.get("justification"):
            ctx["stepJustification"] = step["justification"]
        if step.get("explanation"):
            ctx["stepExplanation"] = step["explanation"]
    return ctx or None


def _split_annotations(graph):
    """Return ``(clean_graph, anno_nodes, anno_edges)`` — a shallow copy with
    annotation nodes (and any edges touching them) removed, plus the removed
    pieces for re-attachment. Mirrors the server's pre-validation strip."""
    all_nodes = list(graph.get("nodes") or [])
    anno_nodes = [n for n in all_nodes if n.get("type") == _ANNOTATION_TYPE]
    if not anno_nodes:
        return graph, [], []
    anno_ids = {n.get("id") for n in anno_nodes} - {None}
    clean = dict(graph)
    clean["nodes"] = [n for n in all_nodes if n.get("type") != _ANNOTATION_TYPE]
    orig_edges = list(graph.get("edges") or [])
    anno_edges = [e for e in orig_edges if e.get("from") in anno_ids or e.get("to") in anno_ids]
    clean["edges"] = [e for e in orig_edges if e.get("from") not in anno_ids and e.get("to") not in anno_ids]
    return clean, anno_nodes, anno_edges


def _revert_enrichment(graph):
    """Return a copy of ``graph`` with a prior enrichment undone: the exact
    fields the enricher added/changed (recorded in ``enrichment.fields``) are
    removed and the ``enrichment`` block dropped, reconstructing the structural
    input. Used for ``--all`` so the agent re-runs on a clean graph instead of
    short-circuiting on the existing block.

    Structural fields (``latex``/``op``/``type``/…) are never in
    ``enrichment.fields`` — the diff restores them before recording — so this
    only ever strips genuinely enrichment-owned values.
    """
    g = copy.deepcopy(graph)
    enr = g.get("enrichment") or {}
    fields = enr.get("fields") or []
    nodes_by_id = {n.get("id"): n for n in g.get("nodes", []) if isinstance(n, dict)}
    for path in fields:
        if path == "domain":
            g.pop("domain", None)
        elif path.startswith("nodes."):
            # ``nodes.<id>.<field>`` — split into exactly 3 (ids are symbol
            # tokens without dots, so the field name is whatever follows).
            parts = path.split(".", 2)
            if len(parts) == 3:
                node = nodes_by_id.get(parts[1])
                if isinstance(node, dict):
                    node.pop(parts[2], None)
    g.pop("enrichment", None)
    return g


async def _enrich_graph(agent, graph, context, *, rebake):
    """Enrich one baked graph dict through the server's exact pipeline and
    return the new graph dict. ``rebake`` reverts a prior enrichment first."""
    work = _revert_enrichment(graph) if rebake else graph
    clean, anno_nodes, anno_edges = _split_annotations(work)
    model = SemanticGraph.model_validate(clean)
    enriched_model = await agent.aenrich(model, context)
    out = enriched_model.model_dump(by_alias=True, exclude_none=True)
    if anno_nodes:
        out["nodes"].extend(anno_nodes)
        out["edges"].extend(anno_edges)
    return out


# ---------------------------------------------------------------------------
# Status (read-only)
# ---------------------------------------------------------------------------

def analyze(spec):
    """Classify every step. Returns a report dict; never calls Gemini.

    Per-step status:
      enriched     baked graph carries an ``enrichment`` block
      unenriched   baked graph present, no enrichment yet (enrichable)
      noGraph      has ``math`` but no baked graph (run prebake first)
    """
    steps_report = []
    counts = {"enriched": 0, "unenriched": 0, "noGraph": 0}
    for si, pi, ki, _sc, _pr, step in _iter_steps(spec):
        math_src = step.get("math")
        if not math_src or not isinstance(math_src, str):
            continue
        graph = _existing_graph(step)
        if graph is None:
            status = "noGraph"
        elif _is_enriched(graph):
            status = "enriched"
        else:
            status = "unenriched"
        counts[status] += 1
        steps_report.append({
            "scene": si, "proof": pi, "step": ki,
            "mathPreview": (math_src[:60] + "…") if len(math_src) > 60 else math_src,
            "status": status,
            "nodeCount": len(graph.get("nodes", [])) if isinstance(graph, dict) else 0,
        })
    return {
        "title": spec.get("title") if isinstance(spec, dict) else None,
        "stepsWithMath": len(steps_report),
        "counts": counts,
        "unenriched": counts["unenriched"],
        "steps": steps_report,
    }


def _print_status(report, path):
    icon = {"enriched": "✨", "unenriched": "○", "noGraph": "∅"}
    c = report["counts"]
    print(f"📄 {path}  —  {report['title'] or '(untitled)'}")
    print(f"   steps with math: {report['stepsWithMath']}   "
          f"baked graphs: {c['enriched'] + c['unenriched']}")
    print(f"   enriched={c['enriched']}  unenriched={c['unenriched']}  "
          f"noGraph={c['noGraph']}")
    listed = [s for s in report["steps"] if s["status"] != "enriched"]
    if listed:
        # [scene.proof.step] — zero-based indices: which scene in the lesson,
        # which proof in that scene, which step in that proof.
        print("   [scene.proof.step]:")
    for s in listed:
        print(f"   {icon[s['status']]} [{s['scene']}.{s['proof']}.{s['step']}] "
              f"{s['status']:<10} {s['mathPreview']}")
    if c["noGraph"]:
        print(f"   ∅ {c['noGraph']} step(s) have math but no baked graph — "
              f"run prebake_semantic_graphs.py --write first")
    if c["unenriched"]:
        print(f"   → {c['unenriched']} graph(s) can be enriched (run with --write)")
    else:
        print("   → nothing to enrich")


# ---------------------------------------------------------------------------
# Enrich (dry-run / write)
# ---------------------------------------------------------------------------

async def enrich_all(spec, *, rebake, concurrency, retries):
    """Enrich the selected graphs in-place on ``spec``. Returns a summary dict.

    Targets: every step with a baked graph that is either unenriched, or (with
    ``rebake``) already enriched too. Each enrichment is independent — one
    failure is counted and skipped, never aborting the batch.

    ``retries`` overrides the enrichment agent's output-validation retry budget
    (``SemanticGraphEnrichmentAgent.max_retries``, normally 2 — the same value
    the live endpoint uses). Offline baking can afford more attempts than a
    latency-bound request, which lets large graphs that intermittently emit a
    schema-invalid field eventually succeed.
    """
    from backend.agents import SemanticGraphEnrichmentAgent

    # ``max_retries`` is read inside ``BaseAgent.__init__`` (``retries=...``),
    # so override it by constructing from a subclass with the bumped value
    # rather than mutating the shared class attribute.
    agent_cls = type(
        "SemanticGraphEnrichmentAgentR",
        (SemanticGraphEnrichmentAgent,),
        {"max_retries": retries},
    )

    targets = []  # (si, pi, ki, step, graph, context)
    skipped_enriched = no_graph = 0
    for si, pi, ki, sc, pr, step in _iter_steps(spec):
        math_src = step.get("math")
        if not math_src or not isinstance(math_src, str):
            continue
        graph = _existing_graph(step)
        if graph is None:
            no_graph += 1
            continue
        if _is_enriched(graph) and not rebake:
            skipped_enriched += 1
            continue
        ctx = _build_context(spec, sc, pr, step)
        targets.append((si, pi, ki, step, graph, ctx))

    agent = agent_cls() if targets else None
    sem = asyncio.Semaphore(max(1, concurrency))
    enriched = 0
    errors = []
    changed = []

    async def _run(si, pi, ki, step, graph, ctx):
        nonlocal enriched
        async with sem:
            t0 = time.perf_counter()
            try:
                out = await _enrich_graph(agent, graph, ctx, rebake=rebake)
            except Exception as e:  # noqa: BLE001 — isolate one bad step
                errors.append({"scene": si, "proof": pi, "step": ki,
                               "error": f"{type(e).__name__}: {str(e).strip()[:200]}"})
                print(f"   ✗ [{si}.{pi}.{ki}] enrich failed: {type(e).__name__}: {e}",
                      file=sys.stderr)
                return
            # Persist onto the in-memory spec; the caller writes (or not).
            step["semanticGraph"]["graph"] = out
            enriched += 1
            changed.append({"scene": si, "proof": pi, "step": ki})
            field_n = len(((out.get("enrichment") or {}).get("fields")) or [])
            print(f"   ✨ [{si}.{pi}.{ki}] enriched  "
                  f"nodes={len(out.get('nodes', []))} fields={field_n}  "
                  f"({time.perf_counter() - t0:.1f}s)")

    if targets:
        await asyncio.gather(*(_run(*t) for t in targets))

    return {
        "enriched": enriched,
        "skippedEnriched": skipped_enriched,
        "noGraph": no_graph,
        "errors": errors,
        "changed": changed,
    }


def main():
    ap = argparse.ArgumentParser(
        description="Pre-bake semantic graph enrichment into a scene/lesson JSON.")
    ap.add_argument("scene", help="Path to the scene/lesson JSON file")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--status", action="store_true",
                      help="Read-only: report which baked graphs are enriched; never writes")
    mode.add_argument("--dry-run", action="store_true",
                      help="Enrich (real Gemini calls) but do not write the file")
    mode.add_argument("--write", action="store_true",
                      help="Enrich and rewrite the file in compact-leaves form")
    ap.add_argument("--all", action="store_true",
                    help="Re-bake enrichment for every existing graph, including "
                         "already-enriched ones (default: only unenriched)")
    ap.add_argument("--concurrency", type=int, default=3, metavar="N",
                    help="Max concurrent enrichment calls (default: 3)")
    ap.add_argument("--retries", type=int, default=2, metavar="N",
                    help="Output-validation retry budget per graph (default: 2, "
                         "matching the live endpoint). Higher values give the model "
                         "more attempts to emit a schema-valid field — but do NOT "
                         "help dropped-node failures, where the validator re-raises "
                         "every retry (re-running the script is what helps those).")
    ap.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = ap.parse_args()

    if args.status and args.concurrency != 3:
        ap.error("--concurrency only applies to --dry-run / --write")
    if args.status and args.retries != 2:
        ap.error("--retries only applies to --dry-run / --write")
    if args.retries < 1:
        ap.error("--retries must be >= 1")

    path = Path(args.scene)
    if not path.is_file():
        print(f"error: file not found: {path}", file=sys.stderr)
        return 1
    try:
        # Explicit utf-8: scenes are written with ensure_ascii=False (math +
        # emoji), and byte sizes below are measured as utf-8.
        original_text = path.read_text(encoding="utf-8")
        spec = json.loads(original_text)
    except json.JSONDecodeError as e:
        print(f"error: invalid JSON in {path}: {e}", file=sys.stderr)
        return 1

    # ---- status mode ----
    if args.status:
        report = analyze(spec)
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            _print_status(report, path)
        return 2 if report["unenriched"] > 0 else 0

    # ---- dry-run / write mode ----
    result = asyncio.run(enrich_all(
        spec, rebake=args.all, concurrency=args.concurrency, retries=args.retries))

    orig_size = len(original_text.encode("utf-8"))
    final_size = orig_size
    wrote = False
    if result["enriched"] > 0:
        # Same compact-leaves writer as prebake: structure stays indented,
        # tiny node/edge objects collapse to one line.
        new_text = dumps_compact_leaves(spec) + "\n"
        # Safety net: the writer must round-trip to the exact same data — this
        # is also what guarantees we touched nothing but the enriched graphs.
        if json.loads(new_text) != spec:
            print("error: compact serialization altered the data — aborting write",
                  file=sys.stderr)
            return 1
        final_size = len(new_text.encode("utf-8"))
        if args.write and not args.dry_run:
            path.write_text(new_text, encoding="utf-8")
            wrote = True
    delta = final_size - orig_size
    pct = (delta / orig_size * 100) if orig_size else 0.0

    out = {
        "mode": "dry-run" if args.dry_run else "write",
        "file": str(path),
        "rebake": args.all,
        "result": result,
        "sizes": {
            "originalBytes": orig_size,
            "finalBytes": final_size,
            "deltaBytes": delta,
            "pctIncrease": round(pct, 1),
        },
        "wrote": wrote,
    }
    if args.json:
        print(json.dumps(out, indent=2))
    else:
        title = spec.get("title") if isinstance(spec, dict) else None
        verb = "would enrich" if args.dry_run else "enriched"
        print(f"📄 {path}  —  {title or '(untitled)'}")
        print(f"   {verb} {result['enriched']} graph(s); "
              f"left {result['skippedEnriched']} already-enriched untouched; "
              f"{len(result['errors'])} failed; "
              f"{result['noGraph']} step(s) without a baked graph skipped.")
        if result["enriched"] > 0:
            size_verb = "size (would grow)" if args.dry_run else "size"
            print(f"   {size_verb}:  {_fmt_bytes(orig_size)} → {_fmt_bytes(final_size)} "
                  f"({pct:+.1f}%, {_fmt_bytes(delta)})")
        if wrote:
            print(f"   ✅ wrote {path}")
        elif args.dry_run and result["enriched"] > 0:
            print("   (dry-run — file not written)")

    # Surface enrichment failures as a non-zero exit so CI / callers notice.
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
