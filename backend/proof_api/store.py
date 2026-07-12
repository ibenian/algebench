"""Pluggable storage for user-derived proofs (``/prove`` page).

Two backends behind one interface (:class:`ProofStore`):

* :class:`LocalProofStore` — plain files on disk. The dev/CI default; needs no
  cloud. Also holds the built-in seed corpus (``proofs/domains``).
* :class:`GcsProofStore` — Google Cloud Storage, same key layout
  (``proofs/domains/<domain>/<name>.json`` + ``source-material/<domain>/<name>/``),
  with the ``{title,domain,goal}`` catalog fields on each object's **custom
  metadata** so ``list()`` builds from a single ``list_blobs`` (no body reads).

Identity & capability model (no user accounts):

* ``id = "<domain>/<name>"`` is the global id (storage key + share slug).
* A proof's write **capability** is a content-derived HMAC — ``secret =
  HMAC(SALT, id + "\\0" + canonical_bytes(proof))`` — stored NOWHERE and
  recomputed from the stored object to verify. Because it's over the content it
  **rotates on every edit** and doubles as a compare-and-swap / lost-update guard
  (an ``update``/``delete`` only succeeds if the caller's secret matches the hash
  of the *current* stored bytes). ``SALT`` comes from ``ALGEBENCH_PROOFS_SALT``.

Everything stored here is model-authored proof data; raw user text never reaches
this layer (see the ``proof_animation`` handlers). Source material (the author's
Documentation + References) is written under ``source-material/`` and is only
handed back to an author who holds the secret.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
from pathlib import Path
from typing import Optional, Protocol, runtime_checkable

# Size cap for a stored/served proof JSON — mirrors the client and server
# (`_MAX_PROOF_BYTES` in server.py). A bounded read keeps a hostile/oversized
# object from exhausting memory.
MAX_PROOF_BYTES = 2_000_000

# ── id validation ───────────────────────────────────────────────────────────
# id = "<domain>/<name>"; each segment is a lowercase slug. Names carry the
# author's chosen title-slug (+ optional "-v2" version suffix); domains are
# short. Case-insensitive uniqueness is enforced by normalizing to lowercase
# before any comparison or path build.
_SEG = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")
_DOMAIN_MIN, _DOMAIN_MAX = 2, 32
_NAME_MIN, _NAME_MAX = 3, 64
# Names that would collide with routes/params or read as system-ish. Small on
# purpose — this is a PoC guard, not an exhaustive denylist.
_RESERVED_NAMES = {"index", "new", "admin", "api", "null", "undefined"}


def normalize_id(raw: str) -> Optional[str]:
    """Validate + normalize ``<domain>/<name>`` to a lowercase id, or None.

    Rejects anything that isn't exactly two slug segments within the length
    bounds (so it can never escape the store root or shadow a reserved name).
    """
    if not isinstance(raw, str):
        return None
    raw = raw.strip().lower()
    parts = raw.split("/")
    if len(parts) != 2:
        return None
    domain, name = parts
    if not (_DOMAIN_MIN <= len(domain) <= _DOMAIN_MAX and _SEG.fullmatch(domain)):
        return None
    if not (_NAME_MIN <= len(name) <= _NAME_MAX and _SEG.fullmatch(name)):
        return None
    if name in _RESERVED_NAMES:
        return None
    return f"{domain}/{name}"


# ── canonical serialization + capability secret ─────────────────────────────
def canonical_bytes(data: dict) -> bytes:
    """The exact bytes we store for a proof — a deterministic JSON encoding.

    Storing this canonical form (and hashing it) makes the capability secret
    recomputable from the stored object regardless of the caller's key order.
    """
    return json.dumps(
        data, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def _salt() -> bytes:
    # Deploy-provided secret; a loud, obviously-insecure default keeps dev/CI
    # working without cloud while never masquerading as a real secret.
    return os.environ.get("ALGEBENCH_PROOFS_SALT", "dev-insecure-salt").encode("utf-8")


def compute_secret(id: str, stored: bytes) -> str:
    """The content-derived capability for ``(id, stored-bytes)``."""
    mac = hmac.new(_salt(), id.encode("utf-8") + b"\x00" + stored, hashlib.sha256)
    return mac.hexdigest()


def verify_secret(id: str, stored: bytes, secret: str) -> bool:
    """Constant-time check that ``secret`` matches the current stored bytes."""
    if not isinstance(secret, str) or not secret:
        return False
    return hmac.compare_digest(compute_secret(id, stored), secret)


def _catalog_meta(id: str, data: dict) -> dict:
    """The three catalog fields, read out of the proof (one source of truth)."""
    domain = id.split("/", 1)[0]
    return {
        "id": id,
        "title": str(data.get("title") or id.split("/", 1)[1]),
        "domain": str(data.get("domain") or domain),
        "goal": str(data.get("goal") or ""),
    }


# ── interface ───────────────────────────────────────────────────────────────
@runtime_checkable
class ProofStore(Protocol):
    def list(self) -> list[dict]: ...                       # [{id,title,domain,goal}]
    def get(self, id: str) -> Optional[dict]: ...           # full proof JSON
    def name_taken(self, id: str) -> bool: ...
    def claim(self, id: str, data: dict, source: Optional[dict]) -> Optional[str]: ...
    def update(self, id: str, data: dict, secret: str, source: Optional[dict]) -> Optional[str]: ...
    def delete(self, id: str, secret: str) -> bool: ...
    def get_source(self, id: str) -> Optional[dict]: ...     # {documentation, references}
    def get_ref(self, ref: str, gcs_bucket: Optional[str]) -> Optional[dict]: ...


# ── local (filesystem) backend ──────────────────────────────────────────────
class LocalProofStore:
    """Writable on-disk store; the dev/CI default (and the built-in seed home).

    ``proofs_dir`` holds ``<domain>/<name>.json`` (the built-in seed lives here
    too, so ``list()`` includes it). ``source_dir`` holds
    ``<domain>/<name>/{documentation.md,references.json}``. No secret/hash is
    stored — update/delete recompute it from the stored bytes.
    """

    def __init__(self, proofs_dir: Path, source_dir: Path):
        self.proofs_dir = Path(proofs_dir)
        self.source_dir = Path(source_dir)

    # -- path helpers (confined to the roots) --
    def _proof_path(self, id: str) -> Optional[Path]:
        nid = normalize_id(id)
        if not nid:
            return None
        p = (self.proofs_dir / f"{nid}.json").resolve()
        root = self.proofs_dir.resolve()
        return p if p.is_relative_to(root) else None

    def _source_dir_for(self, id: str) -> Optional[Path]:
        nid = normalize_id(id)
        if not nid:
            return None
        p = (self.source_dir / nid).resolve()
        root = self.source_dir.resolve()
        return p if p.is_relative_to(root) else None

    def _read_bytes(self, path: Path) -> Optional[bytes]:
        try:
            with open(path, "rb") as f:
                data = f.read(MAX_PROOF_BYTES + 1)
            return data if len(data) <= MAX_PROOF_BYTES else None
        except OSError:
            return None

    # -- interface --
    def list(self) -> list[dict]:
        out: list[dict] = []
        if not self.proofs_dir.exists():
            return out
        for path in sorted(self.proofs_dir.glob("*/*.json")):
            id = f"{path.parent.name}/{path.stem}"
            if normalize_id(id) is None:
                continue
            raw = self._read_bytes(path)
            if raw is None:
                continue
            try:
                data = json.loads(raw)
            except (ValueError, TypeError):
                continue
            out.append(_catalog_meta(id, data))
        return out

    def get(self, id: str) -> Optional[dict]:
        path = self._proof_path(id)
        if not path or not path.is_file():
            return None
        raw = self._read_bytes(path)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return None

    def name_taken(self, id: str) -> bool:
        path = self._proof_path(id)
        return bool(path and path.is_file())

    def claim(self, id: str, data: dict, source: Optional[dict]) -> Optional[str]:
        nid = normalize_id(id)
        path = self._proof_path(id)
        if not nid or not path:
            return None
        blob = canonical_bytes(data)
        if len(blob) > MAX_PROOF_BYTES:
            return None
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            # exclusive create — atomic "claim only if absent" (local CAS)
            with open(path, "xb") as f:
                f.write(blob)
        except FileExistsError:
            return None
        self._write_source(nid, source)
        return compute_secret(nid, blob)

    def update(self, id: str, data: dict, secret: str, source: Optional[dict]) -> Optional[str]:
        nid = normalize_id(id)
        path = self._proof_path(id)
        if not nid or not path or not path.is_file():
            return None
        current = self._read_bytes(path)
        if current is None or not verify_secret(nid, current, secret):
            return None  # wrong or stale secret → CAS reject (no overwrite)
        blob = canonical_bytes(data)
        if len(blob) > MAX_PROOF_BYTES:
            return None
        with open(path, "wb") as f:
            f.write(blob)
        self._write_source(nid, source)
        return compute_secret(nid, blob)  # rotated

    def delete(self, id: str, secret: str) -> bool:
        nid = normalize_id(id)
        path = self._proof_path(id)
        if not nid or not path or not path.is_file():
            return False
        current = self._read_bytes(path)
        if current is None or not verify_secret(nid, current, secret):
            return False
        try:
            path.unlink()
        except OSError:
            return False
        self._delete_source(nid)
        return True

    # -- source material --
    def _write_source(self, nid: str, source: Optional[dict]) -> None:
        if not source:
            return
        d = self._source_dir_for(nid)
        if not d:
            return
        d.mkdir(parents=True, exist_ok=True)
        doc = source.get("documentation")
        (d / "documentation.md").write_text(
            doc if isinstance(doc, str) else "", encoding="utf-8"
        )
        refs = source.get("references")
        (d / "references.json").write_text(
            json.dumps(refs if isinstance(refs, list) else [], ensure_ascii=False),
            encoding="utf-8",
        )

    def _delete_source(self, nid: str) -> None:
        d = self._source_dir_for(nid)
        if not d or not d.exists():
            return
        for f in d.glob("*"):
            try:
                f.unlink()
            except OSError:
                pass
        try:
            d.rmdir()
        except OSError:
            pass

    def get_source(self, id: str) -> Optional[dict]:
        nid = normalize_id(id)
        d = self._source_dir_for(id) if nid else None
        if not d or not d.is_dir():
            return None
        doc_path, ref_path = d / "documentation.md", d / "references.json"
        documentation = doc_path.read_text(encoding="utf-8") if doc_path.is_file() else ""
        references: list = []
        if ref_path.is_file():
            try:
                references = json.loads(ref_path.read_text(encoding="utf-8")) or []
            except (ValueError, TypeError):
                references = []
        return {"documentation": documentation, "references": references}

    def get_ref(self, ref: str, gcs_bucket: Optional[str]) -> Optional[dict]:
        # Local store has no cross-bucket concept; a ref just resolves locally.
        return self.get(ref)


# ── GCS backend ─────────────────────────────────────────────────────────────
def _ref_bucket_allowlist(default_bucket: Optional[str]) -> set[str]:
    """Buckets a ``proof_refs`` cross-ref is allowed to resolve from (SSRF guard).

    Comma-separated ``ALGEBENCH_PROOFS_REF_BUCKETS``; the app's own bucket is
    always allowed.
    """
    allowed = {b.strip() for b in os.environ.get("ALGEBENCH_PROOFS_REF_BUCKETS", "").split(",") if b.strip()}
    if default_bucket:
        allowed.add(default_bucket)
    return allowed


class GcsProofStore:
    """Google Cloud Storage backend. Same key layout as :class:`LocalProofStore`.

    Credentials come from ADC (``GOOGLE_APPLICATION_CREDENTIALS``) or inline JSON
    (``GCP_SA_JSON``, for HF Spaces where secrets are env-vars only). The
    ``google-cloud-storage`` import is deferred so this module loads with no dep.
    """

    _PROOF_PREFIX = "proofs/domains"
    _SOURCE_PREFIX = "source-material"

    def __init__(self, bucket: str):
        self.bucket_name = bucket
        self._bucket = None  # lazy

    # -- client / bucket (lazy) --
    def _client(self):
        from google.cloud import storage  # deferred
        inline = os.environ.get("GCP_SA_JSON")
        if inline:
            from google.oauth2 import service_account
            info = json.loads(inline)
            creds = service_account.Credentials.from_service_account_info(info)
            return storage.Client(project=info.get("project_id"), credentials=creds)
        return storage.Client()  # ADC / GOOGLE_APPLICATION_CREDENTIALS

    def _bkt(self, name: Optional[str] = None):
        from google.cloud import storage  # noqa: F401 (ensures dep present)
        client = self._client()
        return client.bucket(name or self.bucket_name)

    def _proof_key(self, nid: str) -> str:
        return f"{self._PROOF_PREFIX}/{nid}.json"

    # -- interface --
    def list(self) -> list[dict]:
        out: list[dict] = []
        for blob in self._bkt().list_blobs(prefix=f"{self._PROOF_PREFIX}/"):
            if not blob.name.endswith(".json"):
                continue
            id = blob.name[len(self._PROOF_PREFIX) + 1: -len(".json")]
            if normalize_id(id) is None:
                continue
            md = blob.metadata or {}
            out.append({
                "id": id,
                "title": md.get("title") or id.split("/", 1)[1],
                "domain": md.get("domain") or id.split("/", 1)[0],
                "goal": md.get("goal") or "",
            })
        return out

    def _download(self, bkt, key: str) -> Optional[bytes]:
        blob = bkt.blob(key)
        if not blob.exists():
            return None
        data = blob.download_as_bytes(end=MAX_PROOF_BYTES)  # bounded
        return data if len(data) <= MAX_PROOF_BYTES else None

    def get(self, id: str) -> Optional[dict]:
        nid = normalize_id(id)
        if not nid:
            return None
        raw = self._download(self._bkt(), self._proof_key(nid))
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return None

    def name_taken(self, id: str) -> bool:
        nid = normalize_id(id)
        return bool(nid and self._bkt().blob(self._proof_key(nid)).exists())

    def claim(self, id: str, data: dict, source: Optional[dict]) -> Optional[str]:
        from google.api_core.exceptions import PreconditionFailed
        nid = normalize_id(id)
        if not nid:
            return None
        blob_bytes = canonical_bytes(data)
        if len(blob_bytes) > MAX_PROOF_BYTES:
            return None
        bkt = self._bkt()
        blob = bkt.blob(self._proof_key(nid))
        blob.metadata = {k: v for k, v in _catalog_meta(nid, data).items() if k != "id"}
        try:
            blob.upload_from_string(
                blob_bytes, content_type="application/json", if_generation_match=0
            )  # create-only-if-absent
        except PreconditionFailed:
            return None  # name taken (race)
        self._write_source(bkt, nid, source)
        return compute_secret(nid, blob_bytes)

    def update(self, id: str, data: dict, secret: str, source: Optional[dict]) -> Optional[str]:
        from google.api_core.exceptions import PreconditionFailed
        nid = normalize_id(id)
        if not nid:
            return None
        bkt = self._bkt()
        blob = bkt.blob(self._proof_key(nid))
        if not blob.exists():
            return None
        blob.reload()
        gen = blob.generation
        current = blob.download_as_bytes(end=MAX_PROOF_BYTES)
        if not verify_secret(nid, current, secret):
            return None  # wrong/stale secret
        new_bytes = canonical_bytes(data)
        if len(new_bytes) > MAX_PROOF_BYTES:
            return None
        blob.metadata = {k: v for k, v in _catalog_meta(nid, data).items() if k != "id"}
        try:
            blob.upload_from_string(
                new_bytes, content_type="application/json", if_generation_match=gen
            )  # CAS on the read generation
        except PreconditionFailed:
            return None  # changed under us
        self._write_source(bkt, nid, source)
        return compute_secret(nid, new_bytes)

    def delete(self, id: str, secret: str) -> bool:
        nid = normalize_id(id)
        if not nid:
            return False
        bkt = self._bkt()
        blob = bkt.blob(self._proof_key(nid))
        if not blob.exists():
            return False
        current = blob.download_as_bytes(end=MAX_PROOF_BYTES)
        if not verify_secret(nid, current, secret):
            return False
        blob.delete()
        self._delete_source(bkt, nid)
        return True

    # -- source material --
    def _write_source(self, bkt, nid: str, source: Optional[dict]) -> None:
        if not source:
            return
        doc = source.get("documentation")
        bkt.blob(f"{self._SOURCE_PREFIX}/{nid}/documentation.md").upload_from_string(
            doc if isinstance(doc, str) else "", content_type="text/markdown"
        )
        refs = source.get("references")
        bkt.blob(f"{self._SOURCE_PREFIX}/{nid}/references.json").upload_from_string(
            json.dumps(refs if isinstance(refs, list) else [], ensure_ascii=False),
            content_type="application/json",
        )

    def _delete_source(self, bkt, nid: str) -> None:
        for blob in bkt.list_blobs(prefix=f"{self._SOURCE_PREFIX}/{nid}/"):
            try:
                blob.delete()
            except Exception:
                pass

    def get_source(self, id: str) -> Optional[dict]:
        nid = normalize_id(id)
        if not nid:
            return None
        bkt = self._bkt()
        doc_blob = bkt.blob(f"{self._SOURCE_PREFIX}/{nid}/documentation.md")
        ref_blob = bkt.blob(f"{self._SOURCE_PREFIX}/{nid}/references.json")
        if not doc_blob.exists() and not ref_blob.exists():
            return None
        documentation = doc_blob.download_as_text() if doc_blob.exists() else ""
        references: list = []
        if ref_blob.exists():
            try:
                references = json.loads(ref_blob.download_as_text()) or []
            except (ValueError, TypeError):
                references = []
        return {"documentation": documentation, "references": references}

    def get_ref(self, ref: str, gcs_bucket: Optional[str]) -> Optional[dict]:
        nid = normalize_id(ref)
        if not nid:
            return None
        bucket = gcs_bucket or self.bucket_name
        if bucket not in _ref_bucket_allowlist(self.bucket_name):
            return None  # SSRF guard — bucket not on the allowlist
        raw = self._download(self._bkt(bucket), self._proof_key(nid))
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return None


# ── factory ─────────────────────────────────────────────────────────────────
def get_proof_store(proofs_dir: Path, source_dir: Path) -> ProofStore:
    """GCS store when a bucket is configured, else the local filesystem store."""
    bucket = os.environ.get("ALGEBENCH_PROOFS_BUCKET", "").strip()
    if bucket:
        return GcsProofStore(bucket)
    return LocalProofStore(proofs_dir, source_dir)
