"""End-to-end tests for the /prove proof-store HTTP endpoints.

Points the writable store at a tmp dir (env override) so nothing touches the
committed proofs/. The built-in seed is still read from proofs/domains.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ALGEBENCH_PROOFS_DIR", str(tmp_path / "domains"))
    monkeypatch.setenv("ALGEBENCH_PROOF_SOURCE_DIR", str(tmp_path / "source"))
    monkeypatch.delenv("ALGEBENCH_PROOFS_BUCKET", raising=False)
    monkeypatch.setenv("ALGEBENCH_PROOFS_SALT", "test-salt")
    import backend.server as server
    from fastapi.testclient import TestClient
    return TestClient(server.create_app())


PROOF = {
    "title": "My difference of squares",
    "domain": "algebra",
    "goal": "factor a^2 - b^2",
    "summary": "Factor the difference of two squares.",
    "steps": [{"index": 0, "latex": "a^2-b^2"}],
    "evil_injected_field": "should be stripped",
}
SOURCE = {"documentation": "from the identity", "references": [{"id": "algebra/isolate-a", "title": "Isolate a"}]}
NEWID = "algebra/my-diff-squares"


class TestCatalogAndRead:
    def test_catalog_includes_builtins(self, client):
        r = client.get("/api/proofs")
        assert r.status_code == 200
        ids = {p["id"] for p in r.json()["proofs"]}
        assert "algebra/binomial-square" in ids  # a shipped built-in

    def test_name_available(self, client):
        assert client.get("/api/proofs/name-available", params={"name": "algebra/binomial-square"}).json()["available"] is False
        assert client.get("/api/proofs/name-available", params={"name": NEWID}).json()["available"] is True
        assert client.get("/api/proofs/name-available", params={"name": "bad id"}).json()["available"] is False

    def test_item_reads_builtin(self, client):
        r = client.get("/api/proofs/item", params={"id": "algebra/binomial-square"})
        assert r.status_code == 200 and r.json()["domain"] == "algebra"

    def test_item_missing_404(self, client):
        assert client.get("/api/proofs/item", params={"id": "algebra/nope-nope"}).status_code == 404


class TestClaimUpdateDelete:
    def test_claim_returns_secret_and_strips_fields(self, client):
        r = client.post("/api/proofs", json={"id": NEWID, "data": PROOF, "source": SOURCE})
        assert r.status_code == 200
        secret = r.json()["secret"]
        assert secret
        # injected field stripped server-side
        got = client.get("/api/proofs/item", params={"id": NEWID}).json()
        assert "evil_injected_field" not in got
        assert got["title"] == "My difference of squares"
        # now in the catalog
        ids = {p["id"] for p in client.get("/api/proofs").json()["proofs"]}
        assert NEWID in ids

    def test_claim_duplicate_409(self, client):
        client.post("/api/proofs", json={"id": NEWID, "data": PROOF})
        r = client.post("/api/proofs", json={"id": NEWID, "data": PROOF})
        assert r.status_code == 409

    def test_claim_over_builtin_409(self, client):
        r = client.post("/api/proofs", json={"id": "algebra/binomial-square", "data": PROOF})
        assert r.status_code == 409

    def test_claim_invalid_400(self, client):
        assert client.post("/api/proofs", json={"id": "bad id", "data": PROOF}).status_code == 400
        assert client.post("/api/proofs", json={"id": NEWID, "data": {"no": "steps"}}).status_code == 400

    def test_update_cas_and_rotation(self, client):
        secret = client.post("/api/proofs", json={"id": NEWID, "data": PROOF}).json()["secret"]
        updated = dict(PROOF, title="Updated title")
        # wrong secret → 403, no change
        assert client.put("/api/proofs", params={"secret": "wrong"}, json={"id": NEWID, "data": updated}).status_code == 403
        assert client.get("/api/proofs/item", params={"id": NEWID}).json()["title"] == "My difference of squares"
        # right secret → 200 + rotated secret
        r = client.put("/api/proofs", params={"secret": secret}, json={"id": NEWID, "data": updated})
        assert r.status_code == 200
        new_secret = r.json()["secret"]
        assert new_secret and new_secret != secret
        assert client.get("/api/proofs/item", params={"id": NEWID}).json()["title"] == "Updated title"
        # old secret now stale → 403
        assert client.put("/api/proofs", params={"secret": secret}, json={"id": NEWID, "data": dict(PROOF, title="x")}).status_code == 403

    def test_delete_requires_secret(self, client):
        secret = client.post("/api/proofs", json={"id": NEWID, "data": PROOF}).json()["secret"]
        assert client.delete("/api/proofs", params={"id": NEWID, "secret": "wrong"}).status_code == 403
        assert client.delete("/api/proofs", params={"id": NEWID, "secret": secret}).status_code == 200
        assert client.get("/api/proofs/item", params={"id": NEWID}).status_code == 404


class TestSourceMaterial:
    def test_source_gated_by_secret(self, client):
        secret = client.post("/api/proofs", json={"id": NEWID, "data": PROOF, "source": SOURCE}).json()["secret"]
        # without secret → 403
        assert client.get("/api/proofs/source", params={"id": NEWID}).status_code == 403
        # with secret → 200 + repopulation payload
        r = client.get("/api/proofs/source", params={"id": NEWID, "secret": secret})
        assert r.status_code == 200
        assert r.json()["documentation"] == "from the identity"
        assert r.json()["references"] == [{"id": "algebra/isolate-a", "title": "Isolate a"}]

    def test_source_absent_404(self, client):
        secret = client.post("/api/proofs", json={"id": NEWID, "data": PROOF}).json()["secret"]
        assert client.get("/api/proofs/source", params={"id": NEWID, "secret": secret}).status_code == 404


class TestSeedStoreCollision:
    """If an id exists in BOTH the built-in seed and the writable store, the
    built-in seed is canonical everywhere (catalog + read), matching the claim
    guard that blocks claiming a built-in name."""

    def _plant_store_collision(self):
        # Write a store-side file under a built-in's id, bypassing claim (which
        # would 409). The built-in `algebra/binomial-square` must stay canonical.
        import json, os
        store_dir = Path(os.environ["ALGEBENCH_PROOFS_DIR"])
        p = store_dir / "algebra" / "binomial-square.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"title": "STORE OVERRIDE", "domain": "algebra",
                                 "goal": "hijack", "steps": [{"index": 0, "latex": "x"}]}))

    def test_seed_wins_in_catalog(self, client):
        self._plant_store_collision()
        entry = next(p for p in client.get("/api/proofs").json()["proofs"]
                     if p["id"] == "algebra/binomial-square")
        assert entry["title"] == "Square of a binomial"   # seed, not "STORE OVERRIDE"

    def test_seed_wins_on_read(self, client):
        self._plant_store_collision()
        got = client.get("/api/proofs/item", params={"id": "algebra/binomial-square"}).json()
        assert got["title"] == "Square of a binomial"
        assert got["goal"] != "hijack"


class TestCrossRef:
    def test_ref_resolves_builtin(self, client):
        r = client.get("/api/proof-ref", params={"ref": "algebra/binomial-square"})
        assert r.status_code == 200 and r.json()["proof"]["domain"] == "algebra"

    def test_ref_foreign_bucket_denied(self, client):
        # no bucket store configured → foreign bucket can't resolve (SSRF guard)
        r = client.get("/api/proof-ref", params={"ref": "algebra/binomial-square", "gcsBucket": "someone-elses-bucket"})
        assert r.status_code == 404

    def test_ref_invalid_400(self, client):
        assert client.get("/api/proof-ref", params={"ref": "bad ref"}).status_code == 400


import html as _html
import json as _json
import re as _re


def _draft_attr(html_text):
    """Extract and JSON-decode the data-derive-draft attribute (or None if empty)."""
    m = _re.search(r'data-derive-draft="([^"]*)"', html_text)
    assert m is not None, "prove.html must carry a data-derive-draft attribute"
    raw = _html.unescape(m.group(1))
    return _json.loads(raw) if raw else None


def _draft_md(prompt=None, domain=None, doc=""):
    """Build a `<docid>.md` draft: optional YAML-ish frontmatter + markdown body."""
    fm = []
    if prompt is not None:
        fm.append(f"prompt: {prompt}")
    if domain is not None:
        fm.append(f"domain: {domain}")
    if fm:
        return "---\n" + "\n".join(fm) + "\n---\n" + doc
    return doc


@pytest.fixture
def debug_drafts(tmp_path, monkeypatch):
    """A /prove client in DEBUG mode with a temp Derive-drafts dir."""
    drafts = tmp_path / "derive-drafts"
    drafts.mkdir()
    monkeypatch.setenv("ALGEBENCH_PROOFS_DIR", str(tmp_path / "domains"))
    monkeypatch.setenv("ALGEBENCH_PROOF_SOURCE_DIR", str(tmp_path / "source"))
    monkeypatch.delenv("ALGEBENCH_PROOFS_BUCKET", raising=False)
    monkeypatch.setenv("ALGEBENCH_PROOFS_SALT", "test-salt")
    import backend.server as server
    import backend.proof_api.pages as proof_pages
    monkeypatch.setattr(proof_pages, "_DERIVE_DRAFTS_DIR", drafts)
    from fastapi.testclient import TestClient
    return TestClient(server.create_app(debug=True)), drafts


class TestDeriveDraftPrefill:
    """The /prove?draft=<docid> Derive-tab prefill (local/DEBUG only)."""

    def _write(self, drafts, docid, text):
        (drafts / f"{docid}.md").write_text(text)

    def test_valid_draft_injected(self, debug_drafts):
        client, drafts = debug_drafts
        self._write(drafts, "abc123", _draft_md("Prove it", "calculus", "some docs"))
        got = _draft_attr(client.get("/prove", params={"draft": "abc123"}).text)
        assert got == {"prompt": "Prove it", "doc": "some docs", "domain": "calculus"}

    def test_doc_only_no_frontmatter(self, debug_drafts):
        # A plain .md with no frontmatter → whole body is the doc; prompt/domain blank.
        client, drafts = debug_drafts
        self._write(drafts, "plaindoc", "# Just documentation\n\nno frontmatter here")
        got = _draft_attr(client.get("/prove", params={"draft": "plaindoc"}).text)
        assert got["prompt"] == "" and got["domain"] == "" and "Just documentation" in got["doc"]

    def test_no_param_empty(self, debug_drafts):
        client, _ = debug_drafts
        assert _draft_attr(client.get("/prove").text) is None

    def test_bad_token_slash_ignored(self, debug_drafts):
        # A traversal-shaped token fails the ^[A-Za-z0-9_-]{6,64}$ shape → no read.
        client, drafts = debug_drafts
        assert _draft_attr(client.get("/prove", params={"draft": "../../etc/passwd"}).text) is None

    def test_symlink_escape_ignored(self, debug_drafts, tmp_path):
        # MALICIOUS CASE: on a shared /tmp a co-tenant plants <docid>.md as a symlink
        # OUT of the drafts dir (e.g. -> /etc/passwd). The token passes the regex, so
        # the defense is sanitize_path's resolve()+is_relative_to, which must reject
        # the escape — otherwise the foreign file's contents would be read into the
        # draft. If the guard regressed, _load_derive_draft would return that content
        # (any readable text → a non-None dict), so `is None` is the meaningful check.
        import os
        client, drafts = debug_drafts
        secret = tmp_path / "sekrit-outside-drafts.txt"
        secret.write_text("TOP SECRET — would be a valid draft body if read")
        os.symlink(secret, drafts / "evilxyz.md")     # /prove?draft=evilxyz
        assert _draft_attr(client.get("/prove", params={"draft": "evilxyz"}).text) is None

    def test_bad_token_too_short_ignored(self, debug_drafts):
        client, _ = debug_drafts
        assert _draft_attr(client.get("/prove", params={"draft": "abc"}).text) is None

    def test_missing_file_ignored(self, debug_drafts):
        client, _ = debug_drafts
        assert _draft_attr(client.get("/prove", params={"draft": "doesnotexist99"}).text) is None

    def test_oversize_draft_ignored(self, debug_drafts):
        client, drafts = debug_drafts
        self._write(drafts, "biggie1", _draft_md("x", "algebra", "A" * 20000))
        assert _draft_attr(client.get("/prove", params={"draft": "biggie1"}).text) is None

    def test_fields_capped(self, debug_drafts):
        # Under the 16 KB file cap, but individual fields exceed their per-field caps.
        client, drafts = debug_drafts
        self._write(drafts, "capped1", _draft_md("P" * 4100, "X" * 200, "D" * 100))
        got = _draft_attr(client.get("/prove", params={"draft": "capped1"}).text)
        assert len(got["prompt"]) == 4000 and len(got["doc"]) == 100 and len(got["domain"]) == 64

    def test_full_size_draft_accepted(self, debug_drafts):
        # A legitimate max-fields draft (prompt 4000 + doc 5000) must NOT be rejected
        # by the file byte cap — regression guard on _MAX_DERIVE_DRAFT_BYTES.
        client, drafts = debug_drafts
        self._write(drafts, "fullsz1", _draft_md("P" * 4000, "calculus", "D" * 5000))
        got = _draft_attr(client.get("/prove", params={"draft": "fullsz1"}).text)
        assert got is not None and len(got["prompt"]) == 4000 and len(got["doc"]) == 5000

    def test_ignored_when_not_debug(self, client, tmp_path, monkeypatch):
        # The default `client` fixture runs create_app() with debug=False.
        import backend.proof_api.pages as proof_pages
        drafts = tmp_path / "derive-drafts-nd"
        drafts.mkdir()
        monkeypatch.setattr(proof_pages, "_DERIVE_DRAFTS_DIR", drafts)
        (drafts / "abc123.md").write_text(_draft_md("P", "algebra", "D"))
        assert _draft_attr(client.get("/prove", params={"draft": "abc123"}).text) is None
