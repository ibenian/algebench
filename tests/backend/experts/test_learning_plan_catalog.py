"""Catalog preselection signals and cache invalidation (review fixes on #694)."""
from __future__ import annotations

import json
import os

from backend.experts.handlers.learning_plan import catalog as C


def test_a_glossary_alias_finds_its_lesson():
    # quadratic-formula's glossary lists FTA as an alias; nothing else names it.
    assert [c.lesson for c in C.preselect("FTA")][:1] == ["quadratic-formula"]


def test_a_two_letter_alias_finds_its_lesson():
    # GD is gradient-descent-terrain's alias; PE is in the imported transformer domain.
    assert [c.lesson for c in C.preselect("GD")][:1] == ["gradient-descent-terrain"]
    assert [c.lesson for c in C.preselect("PE")][:1] == ["transformer-architecture"]


def test_a_short_alias_matches_whole_words_only():
    cat = C.build_catalog("x", {"title": "X", "scenes": [],
                                "glossary": {"fundamental theorem": {"term": "FT", "aliases": ["FTA"]}}})
    assert C.score(cat, "the FTA") > 0
    assert C.score(cat, "the ftable") == C.score(cat, "the table")
    gd = C.build_catalog("y", {"title": "Y", "scenes": [], "glossary": {"gradient descent": {"aliases": ["GD"]}}})
    assert C.score(gd, "what is GD") > 0 and C.score(gd, "a gdp chart") == 0


def _lesson(tmp_path, monkeypatch, glossary):
    scenes, domains = tmp_path / "scenes", tmp_path / "domains"
    (domains / "dom").mkdir(parents=True)
    scenes.mkdir()
    (scenes / "les.json").write_text(json.dumps({"title": "L", "import": ["dom"], "scenes": [{"id": "s", "title": "S"}]}))
    docs = domains / "dom" / "docs.json"
    docs.write_text(json.dumps({"glossary": glossary}))
    monkeypatch.setattr(C, "SCENES_DIR", scenes)
    monkeypatch.setattr(C, "DOMAINS_DIR", domains)
    monkeypatch.setattr(C, "_cache", {})
    return docs


def _glossary_keys(cat):
    return [e.ref["glossary"] for e in cat.entries if e.kind == "glossary"]


def test_an_edited_domain_glossary_is_picked_up(tmp_path, monkeypatch):
    docs = _lesson(tmp_path, monkeypatch, {"drag": {"term": "drag"}})
    assert _glossary_keys(C.catalog_for("les")) == ["drag"]
    docs.write_text(json.dumps({"glossary": {"drag": {"term": "drag"}, "lift": {"term": "lift"}}}))
    st = docs.stat()
    os.utime(docs, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))   # coarse-mtime filesystems
    assert _glossary_keys(C.catalog_for("les")) == ["drag", "lift"]


def test_an_unchanged_catalog_comes_from_the_cache(tmp_path, monkeypatch):
    _lesson(tmp_path, monkeypatch, {"drag": {"term": "drag"}})
    assert C.catalog_for("les") is C.catalog_for("les")


def test_a_step_proof_carries_its_step_so_it_is_in_context():
    """A step-level proof is only in context at or after its step, so its ref
    (and its proof steps') names that step; a scene's own proof doesn't."""
    cat = C.catalog_for("quadratic-formula")
    proof = next(e for e in cat.entries if e.kind == "proof" and e.ref["pf"] == "complex-roots-derivation")
    assert proof.ref == {"lesson": "quadratic-formula", "sc": "roots-leave-the-real-line-the-complex-plane-in-3d",
                         "st": "the-formula-behind-it-all", "pf": "complex-roots-derivation"}
    ps = next(e for e in cat.entries if e.kind == "proofStep" and e.ref["pf"] == "complex-roots-derivation")
    assert ps.ref["st"] == "the-formula-behind-it-all"
    scene_proof = next(e for e in C.catalog_for("atmospheric-entry-physics").entries
                       if e.kind == "proof" and e.ref["pf"] == "terminal_velocity")
    assert "st" not in scene_proof.ref
