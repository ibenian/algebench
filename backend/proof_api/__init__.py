"""Proof storage API for the ``/prove`` page.

Two submodules:

* :mod:`~backend.proof_api.store` — the pluggable :class:`ProofStore`
  (local filesystem + GCS) and its content-HMAC capability model.
* :mod:`~backend.proof_api.routes` — the FastAPI ``APIRouter`` exposing the
  ``/api/proofs`` + ``/api/proof-ref`` JSON endpoints over that store.
* :mod:`~backend.proof_api.pages` — the ``/prove`` page + ``/proofs/{path}``
  proof-file serving router.

``create_app`` mounts both with
``fastapp.include_router(build_proof_router(...))`` /
``build_proof_pages_router(...)``.
"""

from __future__ import annotations

from backend.proof_api.pages import build_proof_pages_router
from backend.proof_api.routes import build_proof_router
from backend.proof_api.store import (
    GcsProofStore,
    LocalProofStore,
    ProofStore,
    canonical_bytes,
    compute_secret,
    get_proof_store,
    normalize_id,
    verify_secret,
)

__all__ = [
    "build_proof_router",
    "build_proof_pages_router",
    "GcsProofStore",
    "LocalProofStore",
    "ProofStore",
    "canonical_bytes",
    "compute_secret",
    "get_proof_store",
    "normalize_id",
    "verify_secret",
]
