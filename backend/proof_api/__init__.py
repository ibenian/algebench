"""Proof storage API for the ``/prove`` page.

Two submodules:

* :mod:`~backend.proof_api.store` — the pluggable :class:`ProofStore`
  (local filesystem + GCS) and its content-HMAC capability model.
* :mod:`~backend.proof_api.routes` — the FastAPI ``APIRouter`` exposing the
  ``/api/proofs`` + ``/api/proof-ref`` endpoints over that store.

``create_app`` mounts it with
``fastapp.include_router(build_proof_router(...))``.
"""

from __future__ import annotations

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
    "GcsProofStore",
    "LocalProofStore",
    "ProofStore",
    "canonical_bytes",
    "compute_secret",
    "get_proof_store",
    "normalize_id",
    "verify_secret",
]
