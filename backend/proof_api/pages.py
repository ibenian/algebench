"""Page + file-serving routes for the ``/prove`` experience.

Extracted from ``server.py`` so the proof-facing HTTP surface lives together in
``backend.proof_api``. This module serves:

* ``GET /prove`` — the public proof-browser page (``static/prove.html``), with an
  optional DEBUG-only Derive-tab prefill (``?draft=<docid>``).
* ``GET /proofs/{path}`` — the built-in proof JSON files under ``proofs/``,
  confined and ``.json``-only, treated as untrusted (size-capped) input.

The JSON storage API (``/api/proofs*`` + ``/api/proof-ref``) lives in the sibling
:mod:`~backend.proof_api.routes`. ``create_app`` mounts both routers.
"""

from __future__ import annotations

import html
import json
import re
from pathlib import Path
from typing import Callable

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, Response

from backend.util import sanitize_path

# Size cap for a served proof JSON (matches the client's MAX_BYTES).
_MAX_PROOF_BYTES = 2_000_000

# ---------------------------------------------------------------------------
# /prove Derive-tab prefill drafts (local dev only).
#
# The `algebench-prove` skill writes a markdown draft under a random opaque token
# in this fixed, server-owned directory, then opens /prove?draft=<docid>. The file
# is `<docid>.md`: the documentation as markdown, with optional YAML-style
# frontmatter carrying `prompt` and `domain`. The caller never supplies a path —
# only the token — and the server resolves the file itself. Gated to DEBUG_MODE so
# the public /prove deployment never reads a local file. See
# docs/shareable-proof-animations.md.
_DERIVE_DRAFTS_DIR = Path("/tmp/algebench/proofdraft")
_DERIVE_DOCID_RE = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
# File cap must comfortably exceed the sum of the field caps below (4000 + 5000 +
# 64 ≈ 9k chars plus frontmatter overhead), else a legitimate full-size draft would
# be rejected as oversize before the per-field caps ever apply.
_MAX_DERIVE_DRAFT_BYTES = 16_384
_MAX_DERIVE_PROMPT_CHARS = 4_000  # mirrors PromptDeriveRequest.prompt bound
_MAX_DERIVE_DOC_CHARS = 5_000     # matches the #d-doc textarea maxlength
_MAX_DERIVE_DOMAIN_CHARS = 64
# Leading `---\n … \n---\n` frontmatter, followed by the markdown doc body.
_DERIVE_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.DOTALL)


def _load_derive_draft(docid: str):
    """Resolve a /prove Derive-tab prefill draft by its opaque token.

    The draft is `<docid>.md` — markdown documentation, with optional YAML-style
    frontmatter (`prompt:` / `domain:`). Returns a sanitized
    ``{"prompt", "doc", "domain"}`` dict, or ``None`` for any failure (bad token,
    missing/oversize file, decode error). The token is the only caller input; the
    path is server-constructed, and the ``^[A-Za-z0-9_-]{6,64}$`` shape forbids
    slashes and dots so traversal is structurally impossible. sanitize_path adds
    symlink-escape confinement (see below).
    """
    if not docid or not _DERIVE_DOCID_RE.match(docid):
        return None
    # We build the filename ourselves (the regex already forbids slashes/dots), but
    # route it through sanitize_path so its resolve()+is_relative_to also rejects a
    # symlinked <docid>.md that a co-tenant on a shared /tmp planted to point outside
    # the drafts dir (e.g. at /etc/passwd) — belt-and-braces for the DEBUG path.
    path = sanitize_path(_DERIVE_DRAFTS_DIR, f"{docid}.md")
    if not path:
        return None
    try:
        if not path.is_file():
            return None
        with open(path, 'rb') as f:
            raw = f.read(_MAX_DERIVE_DRAFT_BYTES + 1)
        if len(raw) > _MAX_DERIVE_DRAFT_BYTES:
            return None
        text = raw.decode('utf-8')
    except (OSError, ValueError):
        return None
    prompt, domain, doc = "", "", text
    m = _DERIVE_FRONTMATTER_RE.match(text)
    if m:
        doc = m.group(2)
        for line in m.group(1).splitlines():
            if ':' not in line:
                continue
            key, _, val = line.partition(':')
            key = key.strip().lower()
            if key == 'prompt':
                prompt = val.strip()
            elif key == 'domain':
                domain = val.strip()
    return {
        "prompt": prompt[:_MAX_DERIVE_PROMPT_CHARS],
        "doc": doc.strip()[:_MAX_DERIVE_DOC_CHARS],
        "domain": domain[:_MAX_DERIVE_DOMAIN_CHARS],
    }


def build_proof_pages_router(
    *,
    proofs_dir: Path,
    static_dir: Path,
    debug_mode: bool,
    get_app_version: Callable[[], str],
) -> APIRouter:
    """Build the ``/prove`` page + ``/proofs/{path}`` file-serving router.

    ``proofs_dir`` is the repo ``proofs/`` root; ``static_dir`` holds
    ``prove.html``. ``debug_mode`` gates the Derive-tab prefill (so the public
    deploy never reads a local draft). ``get_app_version`` stamps the page.
    """
    router = APIRouter()

    @router.get("/prove")
    async def get_prove(theme: str = "", draft: str = ""):
        """Serve the public /prove page — an isolated proof browser (and, later,
        an AI-driven derivation chat). Reuses the proof-animation widget like
        /renderproof, but this page also calls the same-origin proof-store API
        (/api/proofs*), hence `connect-src 'self'`. Not embeddable (interactive),
        so `frame-ancestors 'self'`.

        ``?draft=<docid>`` (DEBUG_MODE only) preloads the Derive tab from a local
        draft written by the `algebench-prove` skill — see `_load_derive_draft`."""
        path = static_dir / "prove.html"
        if not path.is_file():
            return Response(status_code=404)
        # Only honor Derive-tab prefill locally; in prod DEBUG_MODE is off so the
        # `draft` param is ignored and no local file is ever read.
        derive_draft = _load_derive_draft(draft) if (debug_mode and draft) else None
        # The page CSP is `script-src 'self'` (no inline scripts), so — like
        # __DEBUG_MODE__ — this rides on a <body> data-* attribute rather than an
        # inline <script>. HTML-attribute-escape the JSON (quote=True escapes &,<,>,",').
        draft_attr = html.escape(json.dumps(derive_draft), quote=True) if derive_draft else ''
        with open(path, 'r') as f:
            page = (f.read()
                    .replace('__APP_VERSION__', get_app_version())
                    .replace('__DEBUG_MODE__', 'true' if debug_mode else 'false')
                    .replace('__DERIVE_DRAFT__', draft_attr))
        if theme in ("light", "dark"):
            page = page.replace('<html lang="en">',
                                f'<html lang="en" data-theme="{theme}">', 1)
        return HTMLResponse(
            content=page,
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Content-Security-Policy": (
                    "default-src 'self'; "
                    "script-src 'self' https://cdn.jsdelivr.net; "
                    "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
                    "font-src 'self' https://cdn.jsdelivr.net data:; "
                    "img-src 'self' data:; "
                    "connect-src 'self'; "
                    "frame-ancestors 'self'; "
                    "object-src 'none'; "
                    "base-uri 'none'"
                ),
            }
        )

    @router.get("/proofs/{path:path}")
    async def get_proof_file(path: str):
        """Serve a built-in proof JSON from proofs/, confined and .json-only.

        Double-gated against traversal: sanitize_path keeps the result inside
        proofs/ (rejecting .., absolute paths and symlink escapes) and the suffix
        allowlist rejects anything that isn't .json."""
        proof_path = sanitize_path(proofs_dir, path)
        if not proof_path or not proof_path.is_file() or proof_path.suffix != '.json':
            return Response(status_code=404)
        # Treat proofs as untrusted: bound the read so a huge file can't exhaust
        # memory/bandwidth (mirrors the client's MAX_BYTES; see the security model).
        # A bounded read (not stat()) keeps this to the single, already-vetted open().
        with open(proof_path, 'rb') as f:
            data = f.read(_MAX_PROOF_BYTES + 1)
        if len(data) > _MAX_PROOF_BYTES:
            return Response(status_code=413)
        return Response(content=data, media_type="application/json",
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    return router
