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
    get_proof_store, LocalProofStore, normalize_id, canonical_bytes, verify_secret,
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
    catalog_cache = {"list": None}

    def invalidate():
        catalog_cache["list"] = None

    def catalog():
        # Merge seed + store (store wins on id clash), dedup by id. Cached; a
        # single GCS list_blobs (metadata only) rebuilds it, cleared on write.
        if catalog_cache["list"] is None:
            merged = {}
            for entry in seed.list() + store.list():
                merged[entry["id"]] = entry
            catalog_cache["list"] = sorted(merged.values(), key=lambda e: e["id"])
        return catalog_cache["list"]

    @router.get("/api/proofs")
    async def catalog_endpoint():
        """Merged {id,title,domain,goal} catalog for the /prove typeahead+browse."""
        return JSONResponse({"proofs": catalog()})

    @router.get("/api/proofs/name-available")
    async def name_available(name: str = ""):
        nid = normalize_id(name)
        if not nid:
            return JSONResponse({"available": False, "reason": "invalid"})
        taken = (seed.name_taken(nid) or store.name_taken(nid)
                 or any(e["id"] == nid for e in catalog()))
        return JSONResponse({"id": nid, "available": not taken})

    @router.get("/api/proofs/item")
    async def item(id: str = ""):
        """Full proof JSON by id — built-in seed first, then the writable store."""
        nid = normalize_id(id)
        if not nid:
            return JSONResponse({"error": "invalid id"}, status_code=400)
        data = seed.get(nid) or store.get(nid)
        if data is None:
            return Response(status_code=404)
        return JSONResponse(data)

    @router.get("/api/proofs/source")
    async def source(id: str = "", secret: str = ""):
        """Author-only source material (Documentation + References), secret-gated."""
        nid = normalize_id(id)
        if not nid:
            return JSONResponse({"error": "invalid id"}, status_code=400)
        data = store.get(nid)
        if data is None:
            return Response(status_code=404)
        if not verify_secret(nid, canonical_bytes(data), secret):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        src = store.get_source(nid)
        if src is None:
            return Response(status_code=404)
        return JSONResponse(src)

    @router.post("/api/proofs")
    async def claim(request: Request, _rl: None = Depends(agentic_rate_limit)):
        """Claim a unique name + save a derived proof (+ optional source material)."""
        body = await request.json()
        body = body if isinstance(body, dict) else {}
        nid = normalize_id(body.get("id", ""))
        data = _sanitize_stored_proof(body.get("data"))
        if not nid or data is None:
            return JSONResponse({"error": "invalid id or proof"}, status_code=400)
        if seed.name_taken(nid):
            return JSONResponse({"error": "name taken"}, status_code=409)
        src = body.get("source")
        secret = store.claim(nid, data, src if isinstance(src, dict) else None)
        if secret is None:
            return JSONResponse({"error": "name taken"}, status_code=409)
        invalidate()
        return JSONResponse({"id": nid, "secret": secret})

    @router.put("/api/proofs")
    async def update(request: Request, secret: str = "",
                     _rl: None = Depends(agentic_rate_limit)):
        """CAS update: the secret must match the current stored content. Rotates."""
        body = await request.json()
        body = body if isinstance(body, dict) else {}
        nid = normalize_id(body.get("id", ""))
        data = _sanitize_stored_proof(body.get("data"))
        if not nid or data is None:
            return JSONResponse({"error": "invalid id or proof"}, status_code=400)
        src = body.get("source")
        new_secret = store.update(nid, data, secret, src if isinstance(src, dict) else None)
        if new_secret is None:
            return JSONResponse({"error": "forbidden or stale — reload"}, status_code=403)
        invalidate()
        return JSONResponse({"id": nid, "secret": new_secret})

    @router.delete("/api/proofs")
    async def delete(id: str = "", secret: str = "",
                     _rl: None = Depends(agentic_rate_limit)):
        nid = normalize_id(id)
        if not nid:
            return JSONResponse({"error": "invalid id"}, status_code=400)
        if not store.delete(nid, secret):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        invalidate()
        return JSONResponse({"ok": True})

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
