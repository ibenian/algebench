"""Tests for the proof store — id validation, content-derived capability
secret (CAS / rotation), and the LocalProofStore round-trip. All no-cloud."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.proof_store import (  # noqa: E402
    LocalProofStore,
    canonical_bytes,
    compute_secret,
    normalize_id,
    verify_secret,
)


# ── id validation / normalization ───────────────────────────────────────────
class TestNormalizeId:
    def test_valid(self):
        assert normalize_id("algebra/quadratic-formula") == "algebra/quadratic-formula"

    def test_lowercased(self):
        assert normalize_id("Algebra/Quadratic-Formula") == "algebra/quadratic-formula"

    def test_stripped(self):
        assert normalize_id("  algebra/isolate-a  ") == "algebra/isolate-a"

    @pytest.mark.parametrize("bad", [
        "",                       # empty
        "noslash",                # single segment
        "a/b/c",                  # too many segments
        "algebra/ab",             # name too short (<3)
        "algebra/" + "x" * 65,    # name too long (>64)
        "x/isolate-a",            # domain too short (<2)
        "algebra/-leading",       # leading hyphen
        "algebra/trailing-",      # trailing hyphen
        "algebra/has space",      # space
        "algebra/has_underscore", # underscore not allowed
        "algebra/../etc",         # traversal-ish
        "algebra/new",            # reserved name
        "algebra/UPPER after norm is ok but space not",
        None,
        123,
    ])
    def test_rejected(self, bad):
        assert normalize_id(bad) is None


# ── capability secret: derivation, verify, CAS, rotation, non-transfer ───────
class TestSecret:
    def test_matches_own_content(self):
        data = {"title": "T", "domain": "algebra", "steps": [1]}
        blob = canonical_bytes(data)
        secret = compute_secret("algebra/foo-bar", blob)
        assert verify_secret("algebra/foo-bar", blob, secret)

    def test_wrong_secret_rejected(self):
        blob = canonical_bytes({"a": 1})
        assert not verify_secret("algebra/foo-bar", blob, "deadbeef")
        assert not verify_secret("algebra/foo-bar", blob, "")

    def test_stale_after_content_change(self):
        # secret over the OLD content must NOT verify against NEW content (CAS)
        old = canonical_bytes({"steps": [1]})
        new = canonical_bytes({"steps": [1, 2]})
        secret = compute_secret("algebra/foo-bar", old)
        assert verify_secret("algebra/foo-bar", old, secret)
        assert not verify_secret("algebra/foo-bar", new, secret)

    def test_does_not_transfer_across_ids(self):
        # same content, different id → different secret (id is bound in)
        blob = canonical_bytes({"steps": [1]})
        s = compute_secret("algebra/foo-bar", blob)
        assert not verify_secret("algebra/other-name", blob, s)

    def test_canonical_bytes_order_independent(self):
        assert canonical_bytes({"a": 1, "b": 2}) == canonical_bytes({"b": 2, "a": 1})


# ── LocalProofStore round-trip ──────────────────────────────────────────────
@pytest.fixture
def store(tmp_path):
    return LocalProofStore(tmp_path / "domains", tmp_path / "source-material")


PROOF = {
    "title": "Difference of squares",
    "domain": "algebra",
    "goal": "factor a^2 - b^2",
    "summary": "Factor the difference of two squares.",
    "steps": [{"index": 0, "latex": "a^2-b^2"}],
}


class TestLocalProofStore:
    def test_claim_creates_and_lists(self, store):
        secret = store.claim("algebra/diff-squares", PROOF, None)
        assert secret
        assert store.name_taken("algebra/diff-squares")
        cat = store.list()
        assert cat == [{
            "id": "algebra/diff-squares",
            "title": "Difference of squares",
            "domain": "algebra",
            "goal": "factor a^2 - b^2",
        }]

    def test_get_returns_full_proof(self, store):
        store.claim("algebra/diff-squares", PROOF, None)
        got = store.get("algebra/diff-squares")
        assert got["summary"] == "Factor the difference of two squares."
        assert got["steps"][0]["latex"] == "a^2-b^2"

    def test_claim_is_create_if_absent(self, store):
        assert store.claim("algebra/diff-squares", PROOF, None)
        # second claim of same id → None (taken), original untouched
        assert store.claim("algebra/diff-squares", {"title": "other", "domain": "algebra"}, None) is None
        assert store.get("algebra/diff-squares")["title"] == "Difference of squares"

    def test_claim_rejects_bad_id(self, store):
        assert store.claim("not a valid id", PROOF, None) is None

    def test_update_requires_matching_secret(self, store):
        secret = store.claim("algebra/diff-squares", PROOF, None)
        updated = dict(PROOF, title="Difference of squares v2")
        # wrong secret → no update
        assert store.update("algebra/diff-squares", updated, "wrong", None) is None
        assert store.get("algebra/diff-squares")["title"] == "Difference of squares"
        # right secret → updates, returns a NEW (rotated) secret
        new_secret = store.update("algebra/diff-squares", updated, secret, None)
        assert new_secret and new_secret != secret
        assert store.get("algebra/diff-squares")["title"] == "Difference of squares v2"

    def test_old_secret_stale_after_update(self, store):
        secret = store.claim("algebra/diff-squares", PROOF, None)
        new_secret = store.update("algebra/diff-squares", dict(PROOF, title="v2"), secret, None)
        # old secret no longer valid (content rotated)
        assert store.update("algebra/diff-squares", dict(PROOF, title="v3"), secret, None) is None
        # new secret works
        assert store.update("algebra/diff-squares", dict(PROOF, title="v3"), new_secret, None)

    def test_delete_requires_secret(self, store):
        secret = store.claim("algebra/diff-squares", PROOF, None)
        assert store.delete("algebra/diff-squares", "wrong") is False
        assert store.name_taken("algebra/diff-squares")
        assert store.delete("algebra/diff-squares", secret) is True
        assert not store.name_taken("algebra/diff-squares")
        assert store.get("algebra/diff-squares") is None

    def test_source_material_round_trip(self, store):
        source = {
            "documentation": "Start from the factoring identity.",
            "references": [{"id": "algebra/isolate-a", "title": "Isolate a"}],
        }
        store.claim("algebra/diff-squares", PROOF, source)
        got = store.get_source("algebra/diff-squares")
        assert got["documentation"] == "Start from the factoring identity."
        assert got["references"] == [{"id": "algebra/isolate-a", "title": "Isolate a"}]

    def test_source_absent_returns_none(self, store):
        store.claim("algebra/diff-squares", PROOF, None)
        assert store.get_source("algebra/diff-squares") is None

    def test_delete_removes_source(self, store):
        secret = store.claim("algebra/diff-squares", PROOF, {"documentation": "d", "references": []})
        assert store.get_source("algebra/diff-squares") is not None
        store.delete("algebra/diff-squares", secret)
        assert store.get_source("algebra/diff-squares") is None

    def test_get_ref_resolves_locally(self, store):
        store.claim("algebra/diff-squares", PROOF, None)
        # local store ignores the bucket qualifier
        assert store.get_ref("algebra/diff-squares", "any-bucket")["title"] == "Difference of squares"
        assert store.get_ref("algebra/missing-proof", None) is None

    def test_source_is_not_in_catalog(self, store):
        # source-material lives in a sibling dir, never surfaced by list()
        store.claim("algebra/diff-squares", PROOF, {"documentation": "d", "references": []})
        assert [c["id"] for c in store.list()] == ["algebra/diff-squares"]
