"""HTTP router for the ``/prove`` page's proof storage API.

Extracted from ``server.py`` so the proof-store endpoints live on their own
``APIRouter``. ``create_app`` mounts it with
``fastapp.include_router(build_proof_router(...))``.

Backed by the pluggable :class:`~backend.proof_api.store.ProofStore`: GCS when
``ALGEBENCH_PROOFS_BUCKET`` is set, else the local filesystem. The built-in seed
(``proofs/domains``) is always read so the catalog + cross-ref resolution
include the shipped proofs even when the writable store is a user-only bucket.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Callable, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from backend.proof_api.store import (
    get_proof_store, get_submission_store, LocalProofStore, normalize_id,
    canonical_bytes, verify_secret,
)

# Top-level keys allowed on a stored proof — everything else (any injected
# field) is dropped server-side. Deep per-field validation is the client
# validator + engine's job; this bounds what the public write path persists.
_PROOF_TOP_KEYS = {
    "title", "domain", "goal", "summary", "steps", "terms",
    "overall_confidence", "followups", "prerequisites", "deeplink", "proof_refs",
}


def _sanitize_stored_proof(data) -> Optional[dict]:
    """Whitelist top-level keys + require a non-empty steps list, else None."""
    if not isinstance(data, dict):
        return None
    if not isinstance(data.get("steps"), list) or not data["steps"]:
        return None
    out = {k: data[k] for k in _PROOF_TOP_KEYS if k in data}
    out["title"] = str(out.get("title") or "")
    out["domain"] = str(out.get("domain") or "")
    return out


def build_proof_router(
    *,
    proofs_dir: Path,
    script_dir: Path,
    agentic_rate_limit: Callable,
) -> APIRouter:
    """Build the ``/api/proofs`` + ``/api/proof-ref`` router.

    ``proofs_dir`` is the repo ``proofs/`` root (its ``domains/`` holds the
    built-in seed). ``script_dir`` is the app root (the writable local store
    defaults under it). ``agentic_rate_limit`` is the shared per-IP write throttle.
    """
    router = APIRouter()

    # Writable local store defaults to a gitignored dir (NOT the committed
    # proofs/domains seed), overridable via env for tests/dev. GCS (when a
    # bucket is set) ignores these paths.
    domains_dir = Path(os.environ.get(
        "ALGEBENCH_PROOFS_DIR", str(script_dir / ".proof-store" / "domains")))
    source_dir = Path(os.environ.get(
        "ALGEBENCH_PROOF_SOURCE_DIR", str(script_dir / ".proof-store" / "source-material")))
    store = get_proof_store(domains_dir, source_dir)
    seed = LocalProofStore(proofs_dir / "domains", source_dir)
    # Review queue — pending submissions. Separate key space (proof-submissions/),
    # same id namespace: uniqueness checks below union seed + store + subs.
    subs_dir = Path(os.environ.get(
        "ALGEBENCH_PROOF_SUBMISSIONS_DIR",
        str(script_dir / ".proof-store" / "proof-submissions" / "domains")))
    subs_source_dir = Path(os.environ.get(
        "ALGEBENCH_PROOF_SUBMISSIONS_SOURCE_DIR",
        str(script_dir / ".proof-store" / "proof-submissions" / "source-material")))
    subs = get_submission_store(subs_dir, subs_source_dir)
    catalog_cache = {"list": None, "subs": None}

    def invalidate():
        catalog_cache["list"] = None
        catalog_cache["subs"] = None

    def catalog():
        # Merge store + seed, dedup by id. The built-in SEED is canonical and
        # WINS on an id clash (seed applied last), consistent with reads
        # (`seed.get or store.get`) and the claim guard (a built-in name can't
        # be claimed in the store). So a stray store proof sharing a built-in's
        # id is fully shadowed — never half-shown. Cached; a single GCS
        # list_blobs (metadata only) rebuilds it, cleared on write.
        if catalog_cache["list"] is None:
            merged = {}
            for entry in store.list() + seed.list():
                merged[entry["id"]] = entry
            catalog_cache["list"] = sorted(merged.values(), key=lambda e: e["id"])
        return catalog_cache["list"]

    def subs_catalog():
        # Pending submissions, each tagged so the client can badge them. NOT
        # part of the default catalog — only served on explicit opt-in.
        if catalog_cache["subs"] is None:
            catalog_cache["subs"] = sorted(
                (dict(e, status="under-review") for e in subs.list()),
                key=lambda e: e["id"])
        return catalog_cache["subs"]

    @router.get("/api/proofs")
    async def catalog_endpoint(includeSubmissions: bool = False):
        """Merged {id,title,domain,goal} catalog for the /prove typeahead+browse.

        ``includeSubmissions=1`` (a deliberate Browse-tab opt-in) additionally
        returns pending submissions, each tagged ``status: "under-review"``.
        The default response never lists them."""
        proofs = catalog()
        if includeSubmissions:
            proofs = proofs + subs_catalog()
        return JSONResponse({"proofs": proofs})

    @router.get("/api/proofs/name-available")
    async def name_available(name: str = ""):
        nid = normalize_id(name)
        if not nid:
            return JSONResponse({"available": False, "reason": "invalid"})
        # Union across published AND pending — a submission can never collide
        # with (or shadow) a published proof, and vice versa.
        taken = (seed.name_taken(nid) or store.name_taken(nid) or subs.name_taken(nid)
                 or any(e["id"] == nid for e in catalog()))
        return JSONResponse({"id": nid, "available": not taken})

    @router.get("/api/proofs/item")
    async def item(id: str = ""):
        """Full proof JSON by id — seed, then the store, then pending submissions.

        Submissions are readable by their full id (shareable link) even though
        the default catalog hides them; those responses carry an
        ``X-Proof-Status: under-review`` header so the client can badge them."""
        nid = normalize_id(id)
        if not nid:
            return JSONResponse({"error": "invalid id"}, status_code=400)
        data = seed.get(nid) or store.get(nid)
        if data is not None:
            return JSONResponse(data)
        data = subs.get(nid)
        if data is None:
            return Response(status_code=404)
        return JSONResponse(data, headers={"X-Proof-Status": "under-review"})

    @router.get("/api/proofs/source")
    async def source(id: str = "", secret: str = ""):
        """Author-only source material (documentation + references + prompt),
        secret-gated. Falls back to the review queue so a submission's author
        can restore their package (the edit-by-key flow)."""
        nid = normalize_id(id)
        if not nid:
            return JSONResponse({"error": "invalid id"}, status_code=400)
        owner = store
        data = store.get(nid)
        if data is None:
            owner, data = subs, subs.get(nid)
        if data is None:
            return Response(status_code=404)
        if not verify_secret(nid, canonical_bytes(data), secret):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        src = owner.get_source(nid)
        if src is None:
            return Response(status_code=404)
        return JSONResponse(src)

    # NOTE: there is intentionally NO public write path into the published
    # `proofs/` space — no POST/PUT/DELETE /api/proofs. The only public write is
    # the review queue below (`/api/proof-submissions`); a submission reaches
    # `proofs/` solely through promotion (an admin/offline step, not an HTTP
    # endpoint), which is where the submitter's content-HMAC capability is
    # meant to be broken. `store.claim/update/delete` still exist for that
    # server-side promotion path.

    @router.post("/api/proof-submissions")
    async def submit(request: Request, _rl: None = Depends(agentic_rate_limit)):
        """Submit a derivation for review under a NEW unique name.

        The submission is a package: the proof JSON plus its context (the derive
        prompt + documentation + references) written to the review-queue store.
        The claimed id is unique across published proofs AND pending submissions;
        the response secret is the content-HMAC edit key — the only handle to
        edit the pending submission (it rotates on every update, never stored)."""
        body = await request.json()
        body = body if isinstance(body, dict) else {}
        nid = normalize_id(body.get("id", ""))
        data = _sanitize_stored_proof(body.get("data"))
        if not nid or data is None:
            return JSONResponse({"error": "invalid id or proof"}, status_code=400)
        if seed.name_taken(nid) or store.name_taken(nid):
            return JSONResponse({"error": "name taken"}, status_code=409)
        src = body.get("source")
        secret = subs.claim(nid, data, src if isinstance(src, dict) else None)
        if secret is None:
            return JSONResponse({"error": "name taken"}, status_code=409)
        invalidate()
        return JSONResponse({"id": nid, "secret": secret, "status": "under-review"})

    @router.put("/api/proof-submissions")
    async def update_submission(request: Request, secret: str = "",
                                _rl: None = Depends(agentic_rate_limit)):
        """Edit a PENDING submission by its edit key (CAS; the key rotates).

        Works only while the id is still in the review queue — once a submission
        is approved (promoted into ``proofs/``) it's gone from here and the author
        can only clone. 403 covers a wrong/stale key and an already-promoted id
        alike (no oracle distinguishing them). There is deliberately no public
        edit path into the published ``proofs/`` space."""
        body = await request.json()
        body = body if isinstance(body, dict) else {}
        nid = normalize_id(body.get("id", ""))
        data = _sanitize_stored_proof(body.get("data"))
        if not nid or data is None:
            return JSONResponse({"error": "invalid id or proof"}, status_code=400)
        src = body.get("source")
        new_secret = subs.update(nid, data, secret, src if isinstance(src, dict) else None)
        if new_secret is None:
            return JSONResponse({"error": "forbidden, stale, or no longer in review"},
                                status_code=403)
        invalidate()
        return JSONResponse({"id": nid, "secret": new_secret, "status": "under-review"})

    @router.get("/api/proof-ref")
    async def proof_ref(ref: str = "", gcsBucket: str = "",
                        _rl: None = Depends(agentic_rate_limit)):
        """Resolve a source-qualified cross-reference (allowlist-gated bucket)."""
        nid = normalize_id(ref)
        if not nid:
            return JSONResponse({"error": "invalid ref"}, status_code=400)
        if not gcsBucket:                       # own store / built-in seed
            data = seed.get(nid) or store.get_ref(nid, None)
        else:                                   # foreign bucket → allowlist enforced in get_ref
            data = store.get_ref(nid, gcsBucket)
        if data is None:
            return JSONResponse({"error": "not found or not allowed"}, status_code=404)
        return JSONResponse({"id": nid, "title": data.get("title"),
                             "domain": data.get("domain"), "proof": data})

    return router
