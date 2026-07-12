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
