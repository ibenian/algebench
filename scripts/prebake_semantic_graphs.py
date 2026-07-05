#!/usr/bin/env python3
"""Pre-bake semantic graphs into an AlgeBench scene/lesson JSON file.

At runtime the server derives a semantic graph for every proof step that has
``math`` but no ``semanticGraph`` (see ``_autofill_semantic_graphs`` in
``backend/server.py``). For a large lesson that is dozens of derivations on
every load — seconds of CPU on a constrained host. Pre-baking runs those
derivations *offline* and writes the resulting ``{"graph": {...}}`` blocks
into the JSON, so the server skips them entirely and the lesson loads fast.

This script reuses the *exact* backend derivation + highlight-overlay
pipeline, so a baked graph is byte-identical to what the server would have
produced — baking only changes *when* the work happens, never the result.

Modes (exactly one is required)
--------------------------------
  --validate  Read-only. Re-derive every step and compare against any
              already-baked graph. Classifies each step as:
                valid          baked graph matches a fresh derivation
                stale          baked graph differs (math or parser changed)
                missing        derivable but not yet baked
                errorBroken    HAD a baked graph that no longer derives (a
                               committed graph the parser can't reproduce)
                errorUnbaked   never baked, parser can't derive it (unsupported
                               LaTeX) — expected, fails the same at runtime
              Never writes. Exit code 0 if nothing needs baking, 2 if there
              are missing/stale graphs. With --fail-on-stale, exits 1 only when
              a committed graph is out of sync (stale + errorBroken), 0
              otherwise — the CI gate; missing/errorUnbaked never fail.
  --write     Bake graphs into the file. By default only missing+stale steps
              are (re)written, keeping the diff minimal; pass --all to rewrite
              every derivable step. Reports the before/after server load time
              (simulating a real scene load — parse-if-missing), the
              before/after file size + % growth, and a recommended strategy
              (prebake / skip / noop) weighing that load win against the size
              cost. Use --dry-run to get the strategy without writing.

Usage
-----
    ./run.sh scripts/prebake_semantic_graphs.py scene.json --validate          # read-only report
    ./run.sh scripts/prebake_semantic_graphs.py scene.json --validate --json   # machine output
    ./run.sh scripts/prebake_semantic_graphs.py scene.json --write             # bake missing+stale
    ./run.sh scripts/prebake_semantic_graphs.py scene.json --write --all       # rebake everything
    ./run.sh scripts/prebake_semantic_graphs.py scene.json --write --dry-run

Exit codes
----------
    0  Nothing to do (validate: all valid / no derivable steps; write: file written or no-op)
    1  Usage / IO / parse error
    2  validate only: there are missing or stale graphs (work suggested)
"""

import argparse
import contextlib
import copy
import io
import json
import sys
import time
from pathlib import Path

from _json_format import dumps_compact_leaves

# Reuse the backend's derivation + highlight pipeline verbatim so baked graphs
# match server output exactly. Importing backend.server is heavy (pulls in
# FastAPI/genai) but this is an offline CLI, so that cost is irrelevant.
from backend.server import (  # noqa: E402
    _graph_service,
    _normalize_proofs,
    _extract_htmlclass_pairs,
    _strip_html_class,
    _apply_highlights_to_graph,
    _autofill_semantic_graphs,
)


def _simulate_server_load(spec):
    """Time a real scene load on a COPY of the spec.

    Runs the server's `_autofill_semantic_graphs` — the same parse-if-missing
    pass a live `/scenes/...` load performs — and returns the wall-clock
    seconds. Operates on a deep copy (autofill mutates) with stdout muted
    (autofill prints a progress line). This is what baking actually speeds up:
    before baking it derives every missing graph; after baking it skips them
    and only the unparseable (error) steps still cost anything.
    """
    clone = copy.deepcopy(spec)
    t = time.perf_counter()
    with contextlib.redirect_stdout(io.StringIO()):
        _autofill_semantic_graphs(clone)
    return time.perf_counter() - t


# A free Render instance ran the atmospheric lesson's ~5s local parse in ~61s,
# so server load is roughly this much slower than a dev machine. Used only to
# estimate the real-world (deployed) load win in the strategy rationale.
FREE_HOST_SLOWDOWN = 12

# Local load saved (seconds) above which prebaking is clearly worth the size
# growth (~3.6s on a free host at the slowdown above).
WORTH_IT_SAVED_SECONDS = 0.3


def _propose_strategy(load_before, load_after, pct_increase, baked):
    """Weigh the measured load-time win against the size growth and recommend
    a strategy: ``prebake`` (worth it), ``skip`` (win too small for the size
    cost), or ``noop`` (nothing to bake)."""
    saved = load_before - load_after
    prod_before = load_before * FREE_HOST_SLOWDOWN
    prod_after = load_after * FREE_HOST_SLOWDOWN
    prod_saved = saved * FREE_HOST_SLOWDOWN
    if baked == 0:
        return {"recommendation": "noop",
                "rationale": "Already fully baked — no graphs to add."}
    # `--write --all` re-bakes every step even when all are already valid, so
    # `baked > 0` but the output is byte-identical (no size growth). Adding a
    # real graph always grows the file, so a ~0% delta means nothing actually
    # changed — a noop, not a misleading "skip ... saves 0.00s but grows +0%".
    if abs(pct_increase) < 0.1:
        return {"recommendation": "noop",
                "rationale": "Re-baked identical graphs (--all on an already-baked "
                             "file) — no change to load or size."}
    if saved >= WORTH_IT_SAVED_SECONDS:
        return {"recommendation": "prebake",
                "rationale": (
                    f"Prebake. Load {load_before:.2f}s→{load_after:.2f}s locally "
                    f"(~{prod_before:.0f}s→~{prod_after:.1f}s on a free host, "
                    f"~{prod_saved:.0f}s saved/load) for a {pct_increase:+.0f}% size "
                    f"change — the load win clearly outweighs the size cost.")}
    return {"recommendation": "skip",
            "rationale": (
                f"Skip. Load is already fast ({load_before:.2f}s, "
                f"~{prod_before:.1f}s on a free host); baking saves only "
                f"{saved:.2f}s for a {pct_increase:+.0f}% size change. "
                f"Not worth it unless the target host is very constrained.")}


def _derive_step_graph(step):
    """Derive a fresh graph dict for one proof step, mirroring the server's
    ``_autofill_semantic_graphs`` (strip ``\\htmlClass``, derive, overlay
    highlights). Returns ``(graph_dict | None, error_str | None, seconds)``.
    """
    math_src = step.get("math")
    if not math_src or not isinstance(math_src, str):
        return None, None, 0.0
    hl_pairs = _extract_htmlclass_pairs(math_src)
    cleaned = _strip_html_class(math_src)
    t0 = time.perf_counter()
    # Guard the whole derive→highlight→serialize path. Any single step that
    # blows up (parser crash, highlight-overlay edge case, serialization)
    # degrades to a counted error so the rest of the lesson still processes —
    # one bad step never aborts the batch.
    try:
        graph = _graph_service.latex_to_graph(cleaned)
    except Exception as e:  # parse crash — same class the server guards
        return None, f"parse_crashed: {str(e).strip() or type(e).__name__}", time.perf_counter() - t0
    if not graph:
        return None, "parse_failed: parser returned no graph", time.perf_counter() - t0
    try:
        _apply_highlights_to_graph(graph, hl_pairs, step.get("highlights") or {})
        result = graph.model_dump(by_alias=True, exclude_none=True)
    except Exception as e:  # highlight overlay / serialization failure
        return None, f"bake_error: {str(e).strip() or type(e).__name__}", time.perf_counter() - t0
    return result, None, time.perf_counter() - t0


def _iter_steps(spec):
    """Yield ``(scene_idx, proof_idx, step_idx, step_dict)`` for every proof
    step in a scene spec. Mirrors the traversal in the server's autofill."""
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
                    yield si, pi, ki, step


def _existing_graph(step):
    """Return the already-baked graph dict for a step, or ``None``."""
    sg = step.get("semanticGraph")
    if isinstance(sg, dict) and isinstance(sg.get("graph"), dict):
        return sg["graph"]
    return None


def _structural_signature(graph):
    """Canonical structural fingerprint of a baked-graph dict, for staleness.

    Reuses ``graph_signature`` — the same connectivity-signature the domain
    tests use as their structural invariant. It encodes topology + node
    kinds/ids and is inherently blind to presentation and enrichment
    (descriptions, emoji, units, ``label``, edge ``role``/``weight``, ordering),
    so an enriched graph and a fresh structural derivation fingerprint
    identically when their structure matches.

    Returns ``None`` if the graph can't be fingerprinted (invalid / cyclic),
    which the caller treats as "does not match" — a conservative, baked-graph
    can't validate ⇒ re-bake.
    """
    from backend.model import SemanticGraph
    from backend.semantic_graph.signature import graph_signature, label_by_type
    try:
        return graph_signature(SemanticGraph.model_validate(graph), labeler=label_by_type)
    except Exception:
        return None


def analyze(spec):
    """Validate pass: classify every step. Returns a report dict (no writes).

    The graph cache is cleared first so results reflect the current parser
    state, exactly like the server does before autofill.
    """
    _graph_service.clear_cache()
    steps_report = []
    # `error` splits by whether the step already had a committed graph:
    #   errorUnbaked — never baked, parser can't derive it (unsupported LaTeX);
    #                  expected, fails identically at runtime, NOT a sync failure.
    #   errorBroken  — HAD a baked graph but it no longer derives (regression):
    #                  a committed graph the current parser can't reproduce.
    counts = {"valid": 0, "stale": 0, "missing": 0,
              "errorUnbaked": 0, "errorBroken": 0}
    total_derive = 0.0    # cost to re-derive every step (the full bake cost)
    runtime_derive = 0.0  # cost the server still pays at load: steps without a
                          # valid baked graph (missing/stale/error are re-derived)
    for si, pi, ki, step in _iter_steps(spec):
        math_src = step.get("math")
        if not math_src or not isinstance(math_src, str):
            continue
        existing = _existing_graph(step)
        was_baked = existing is not None
        fresh, err, dt = _derive_step_graph(step)
        total_derive += dt
        if err or fresh is None:
            if was_baked:
                status = "errorBroken"
                detail = "committed graph no longer derives (parser regression)"
            else:
                status = "errorUnbaked"
                detail = err or "unsupported — parser produced no graph"
        elif not was_baked:
            status = "missing"
            detail = "derivable but not baked"
        elif (sig := _structural_signature(existing)) is not None and sig == _structural_signature(fresh):
            status = "valid"
            detail = "baked graph structurally matches fresh derivation"
        else:
            status = "stale"
            detail = "baked graph structure differs from fresh derivation"
        if status != "valid":
            runtime_derive += dt
        counts[status] += 1
        steps_report.append({
            "scene": si, "proof": pi, "step": ki,
            "mathPreview": (math_src[:60] + "…") if len(math_src) > 60 else math_src,
            "status": status,
            "detail": detail,
            "deriveMs": round(dt * 1000, 1),
            "wasBaked": was_baked,
        })

    needs = counts["missing"] + counts["stale"]
    # A committed graph the current parser can't reproduce — either it derives
    # differently now (stale) or no longer derives at all (broken). This is the
    # CI gate: it means a shipped lesson's graph is out of sync with its math.
    out_of_sync = counts["stale"] + counts["errorBroken"]
    # Suggest prebaking only when there are missing/stale graphs AND deriving
    # them costs enough to matter (cheap parses aren't worth the file growth) —
    # mirrors the --write strategy's prebake/skip threshold.
    recommend = needs > 0 and runtime_derive >= WORTH_IT_SAVED_SECONDS
    if needs == 0:
        reason = f"all derivable graphs are baked; runtime derives ~{runtime_derive:.2f}s"
    elif recommend:
        reason = (f"{needs} graph(s) missing/stale costing ~{runtime_derive:.2f}s/load "
                  f"(~{runtime_derive * FREE_HOST_SLOWDOWN:.0f}s on a free host) — prebake worthwhile")
    else:
        reason = (f"{needs} graph(s) missing/stale but deriving them is cheap "
                  f"(~{runtime_derive:.2f}s) — prebaking optional")
    return {
        "title": spec.get("title") if isinstance(spec, dict) else None,
        "stepsWithMath": len(steps_report),
        "counts": counts,
        "needsPrebake": needs,
        "outOfSync": out_of_sync,
        "deriveSeconds": round(total_derive, 2),
        "runtimeDeriveSeconds": round(runtime_derive, 2),
        "recommendPrebake": recommend,
        "recommendReason": reason,
        "steps": steps_report,
    }


def bake(spec, *, only_all=False):
    """Write pass: (re)bake graphs in-place. By default only missing+stale
    steps are written; ``only_all`` rebakes every derivable step. Returns a
    summary dict of what changed."""
    _graph_service.clear_cache()
    baked, skipped_valid, errors = 0, 0, 0
    changed = []
    for si, pi, ki, step in _iter_steps(spec):
        math_src = step.get("math")
        if not math_src or not isinstance(math_src, str):
            continue
        existing = _existing_graph(step)
        fresh, err, _ = _derive_step_graph(step)
        if err or fresh is None:
            errors += 1
            continue
        # Structural comparison: an enriched graph whose skeleton still matches
        # the parser is "valid" and left untouched — so a structural re-bake
        # never clobbers baked enrichment unless the structure actually changed.
        sig = _structural_signature(existing) if existing is not None else None
        is_valid = sig is not None and sig == _structural_signature(fresh)
        if is_valid and not only_all:
            skipped_valid += 1
            continue
        step["semanticGraph"] = {"graph": fresh}
        baked += 1
        changed.append({"scene": si, "proof": pi, "step": ki})
    return {"baked": baked, "skippedValid": skipped_valid, "errors": errors, "changed": changed}


def _fmt_bytes(n):
    """Human-friendly byte count (KB above 1 KiB), sign-preserving."""
    return f"{n / 1024:.1f} KB" if abs(n) >= 1024 else f"{n} B"


def _print_human(report, path):
    icon = {"valid": "✅", "stale": "♻️ ", "missing": "➕",
            "errorBroken": "❌", "errorUnbaked": "⚠️ "}
    print(f"📄 {path}  —  {report['title'] or '(untitled)'}")
    print(f"   steps with math: {report['stepsWithMath']}   "
          f"derive time: {report['deriveSeconds']}s")
    c = report["counts"]
    print(f"   valid={c['valid']}  stale={c['stale']}  missing={c['missing']}  "
          f"broken={c['errorBroken']}  unsupported={c['errorUnbaked']}")
    for s in report["steps"]:
        if s["status"] != "valid":
            print(f"   {icon[s['status']]} [{s['scene']}.{s['proof']}.{s['step']}] "
                  f"{s['status']:<12} {s['mathPreview']}")
    if report["outOfSync"]:
        print(f"   ✗ {report['outOfSync']} committed graph(s) out of sync (stale or broken)")
    print(f"   → recommend prebake: {'YES' if report['recommendPrebake'] else 'no'} "
          f"({report['recommendReason']})")


def main():
    ap = argparse.ArgumentParser(description="Pre-bake semantic graphs into a scene/lesson JSON.")
    ap.add_argument("scene", help="Path to the scene/lesson JSON file")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--validate", action="store_true",
                      help="Read-only: classify every step (valid/stale/missing/error); never writes")
    mode.add_argument("--write", action="store_true",
                      help="Bake graphs into the file (missing+stale by default; --all for full rebake)")
    ap.add_argument("--all", action="store_true",
                    help="With --write, rebake every derivable step (default: only missing+stale)")
    ap.add_argument("--dry-run", action="store_true",
                    help="With --write, report what would change without writing")
    ap.add_argument("--fail-on-stale", action="store_true",
                    help="With --validate, exit non-zero only if a committed graph is "
                         "out of sync (stale or broken). For CI; missing/unsupported "
                         "steps never fail.")
    ap.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = ap.parse_args()

    if args.validate and (args.all or args.dry_run):
        ap.error("--all and --dry-run only apply to --write")
    if args.write and args.fail_on_stale:
        ap.error("--fail-on-stale only applies to --validate")

    path = Path(args.scene)
    if not path.is_file():
        print(f"error: file not found: {path}", file=sys.stderr)
        return 1
    try:
        # Explicit utf-8: scenes are written with ensure_ascii=False (may hold
        # non-ASCII math), and byte sizes below are measured as utf-8 — don't
        # let the platform default encoding (e.g. cp1252) corrupt or mismatch.
        original_text = path.read_text(encoding="utf-8")
        spec = json.loads(original_text)
    except json.JSONDecodeError as e:
        print(f"error: invalid JSON in {path}: {e}", file=sys.stderr)
        return 1

    if args.validate:
        report = analyze(spec)
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            _print_human(report, path)
        # CI gate: fail only when a committed graph can't be reproduced.
        if args.fail_on_stale:
            return 1 if report["outOfSync"] > 0 else 0
        # Default: signal there is bakeable work (informational).
        return 2 if report["needsPrebake"] > 0 else 0

    # ---- write mode ----
    # Measure a real scene load (server parse-if-missing) before and after
    # baking, so the report shows the actual load-time win — not just the
    # derive cost. "before" derives every missing graph (what users pay now);
    # "after" skips the baked ones, leaving only the unparseable error steps.
    title = spec.get("title") if isinstance(spec, dict) else None
    load_before = _simulate_server_load(spec)
    result = bake(spec, only_all=args.all)
    if args.dry_run:
        result["dryRun"] = True
    load_after = _simulate_server_load(spec)  # spec is now baked in-memory
    speedup = (load_before / load_after) if load_after > 0 else None
    load = {
        "beforeSeconds": round(load_before, 3),
        "afterSeconds": round(load_after, 3),
        "speedup": round(speedup, 1) if speedup else None,
    }

    # Serialize once so we can measure the final size (and write it if real).
    orig_size = len(original_text.encode("utf-8"))
    if result["baked"] > 0:
        # Compact-leaves: structure stays indented; tiny node/edge objects
        # collapse to one line (~3x fewer lines than indent=2).
        new_text = dumps_compact_leaves(spec) + "\n"
        # Safety net: the custom writer must round-trip to the exact same data.
        if json.loads(new_text) != spec:
            print("error: compact serialization altered the data — aborting write",
                  file=sys.stderr)
            return 1
        if not args.dry_run:
            path.write_text(new_text, encoding="utf-8")
        final_size = len(new_text.encode("utf-8"))
    else:
        final_size = orig_size  # nothing baked → file unchanged
    delta = final_size - orig_size
    pct = (delta / orig_size * 100) if orig_size else 0.0
    sizes = {
        "originalBytes": orig_size,
        "finalBytes": final_size,
        "deltaBytes": delta,
        "pctIncrease": round(pct, 1),
    }

    # Recommend a strategy from the measured load win vs. size growth.
    strategy = _propose_strategy(load_before, load_after, pct, result["baked"])

    out = {"mode": "write", "file": str(path), "load": load, "sizes": sizes,
           "strategy": strategy, "result": result}
    if args.json:
        print(json.dumps(out, indent=2))
    else:
        verb = "would bake" if args.dry_run else "baked"
        print(f"📄 {path}  —  {title or '(untitled)'}")
        print(f"   {verb} {result['baked']} graph(s); "
              f"left {result['skippedValid']} valid untouched; "
              f"{result['errors']} not derivable.")
        # Only call out a speedup when baking actually changed something — a
        # ~0% size delta means nothing was added (e.g. --all on an already-baked
        # file), so before/after just time the same spec and any delta is noise.
        # When the after-time is negligible the ratio explodes into a silly
        # number, so say "near-instant" instead.
        speed_txt = ""
        if result["baked"] > 0 and abs(pct) >= 0.1 and speedup and speedup >= 1.05:
            speed_txt = ("  (near-instant)" if load_after < 0.02 or speedup >= 100
                         else f"  ({speedup:.0f}× faster)")
        print(f"   load (server parse):  {load_before:.2f}s → {load_after:.2f}s{speed_txt}")
        size_verb = "size (would grow)" if args.dry_run else "size"
        print(f"   {size_verb}:  {_fmt_bytes(orig_size)} → {_fmt_bytes(final_size)} "
              f"({pct:+.1f}%, {_fmt_bytes(delta)})")
        print(f"   → strategy: {strategy['recommendation'].upper()} — {strategy['rationale']}")
        if not args.dry_run and result["baked"] > 0:
            print(f"   ✅ wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
