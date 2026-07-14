# Proof store (`/prove` page) — storage & credentials

User-derived proofs from the `/prove` page are persisted through a pluggable
store (`store.py`) exposed as an HTTP API (`routes.py`, mounted by
`server.py` via `build_proof_router(...)`).

- **`LocalProofStore`** — plain files on disk. The **dev/CI default**; needs no
  cloud. Also serves the built-in seed corpus at `proofs/domains/`.
- **`GcsProofStore`** — Google Cloud Storage. Used **only when
  `ALGEBENCH_PROOFS_BUCKET` is set**. Same key layout as local
  (`proofs/domains/<domain>/<name>.json` + `source-material/domains/<domain>/<name>/`),
  with the `{title,domain,goal}` catalog fields on each object's **custom
  metadata** so the catalog builds from a single `list_blobs` (no body reads).

The factory `get_proof_store()` picks GCS when a bucket is configured, else local.

---

## Environment variables

| Var | Purpose | Where |
|---|---|---|
| `ALGEBENCH_PROOFS_BUCKET` | GCS bucket name. **Unset → LocalProofStore** (no cloud). | per env |
| `GOOGLE_APPLICATION_CREDENTIALS` | **Path** to a service-account JSON key (ADC). | Render / local |
| `GCP_SA_JSON` | Service-account JSON **content, inline** (alternative to the file). | HF Spaces |
| `ALGEBENCH_PROOFS_SALT` | HMAC key for content-derived edit secrets. **Keep stable.** | per env |
| `ALGEBENCH_PROOFS_REF_BUCKETS` | Comma-separated allowlist of buckets a `proof_refs` cross-ref may resolve from (own bucket always allowed). SSRF guard. | optional |
| `ALGEBENCH_PROOFS_DIR` / `ALGEBENCH_PROOF_SOURCE_DIR` | Override the local store dirs (defaults: gitignored `.proof-store/…`). | dev/tests |

Notes:
- `GOOGLE_APPLICATION_CREDENTIALS` is a **path only** — it cannot hold the JSON
  itself. For inline credentials use `GCP_SA_JSON` (don't set both).
- The Gemini `GEMINI_API_KEY` (AI-Studio) **cannot** authenticate GCS — storage
  uses GCP IAM (the service account), a completely separate credential.

---

## One-time GCS provisioning

Storage is **per-environment**: each env gets its own project + bucket + key.
(`gcloud` here is `~/google-cloud-sdk/bin/gcloud` — not always on `PATH`.)

```bash
PROJECT=<your-gcp-project-id>          # must have billing enabled
BUCKET=<globally-unique-bucket-name>   # e.g. algebench-proofs-local / -staging / algebench-proofs (prod)
SA=algebench-proofs
SA_EMAIL="${SA}@${PROJECT}.iam.gserviceaccount.com"

# 1. Private, API-only bucket (no public access; uniform bucket-level access)
gcloud storage buckets create "gs://$BUCKET" \
  --project="$PROJECT" --location=us-central1 \
  --uniform-bucket-level-access --public-access-prevention

# 2. Service account
gcloud iam service-accounts create "$SA" --project="$PROJECT" \
  --display-name="AlgeBench proofs storage"

# 3. Grant object read/write on JUST this bucket (bucket-scoped IAM)
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:${SA_EMAIL}" --role=roles/storage.objectAdmin
# (SA creation is eventually consistent — if this 400s "does not exist", retry.)

# 4. JSON key, stored OUTSIDE the repo, readable only by you
mkdir -p ~/.config/algebench
gcloud iam service-accounts keys create ~/.config/algebench/${BUCKET}-sa.json \
  --iam-account="$SA_EMAIL"
chmod 600 ~/.config/algebench/${BUCKET}-sa.json
```

The downloaded JSON key holds a **private key**: secret-only, never committed,
scoped to the one bucket, rotate periodically. On GCP-hosted infra you'd skip the
key entirely and use the attached service account.

### Local dev config

`./algebench` auto-sources the gitignored **`.env.local`** (shell `set -a; . .env.local`).
Add:

```sh
ALGEBENCH_PROOFS_BUCKET=algebench-proofs-local
GOOGLE_APPLICATION_CREDENTIALS=~/.config/algebench/algebench-proofs-local-sa.json
ALGEBENCH_PROOFS_SALT=<generated — see below>
```

The `~` works **only because a shell sources the file** (bash expands `~` in an
unquoted assignment, then exports the absolute path). If anything ever loads
`.env.local` without a shell (e.g. a python-dotenv `load_dotenv()`), use an
absolute path instead.

Install the client into the venv once: `uv pip install --python .venv/bin/python3 google-cloud-storage`
(already in `requirements.txt`).

### Deploy config

- **Render** — add the key as a *Secret File* and point `GOOGLE_APPLICATION_CREDENTIALS` at its mount path.
- **HF Spaces** — secrets are env-vars only (no file mount): paste the key JSON
  content into a `GCP_SA_JSON` secret. `GcsProofStore` reads it via
  `service_account.Credentials.from_service_account_info(...)`.
- Set a **stable** `ALGEBENCH_PROOFS_SALT` per env. The two prod mirrors (Render +
  HF) serving the same corpus should point at **one** shared prod bucket and both
  hold a key with access to it.

---

## `ALGEBENCH_PROOFS_SALT` — how it's generated and why it matters

```bash
echo 'import secrets; print(secrets.token_urlsafe(32))' | ./run.sh -
```

`secrets.token_urlsafe(32)` returns 32 cryptographically-secure random bytes
(~256 bits) as a URL-safe base64 string (43 chars). It is the **HMAC key** for a
proof's edit capability:

```
secret = HMAC-SHA256(ALGEBENCH_PROOFS_SALT, id + "\0" + canonical_bytes(proof))
```

This secret is **stored nowhere** — it's recomputed from the stored object to
verify an edit/delete, and because it's over the content it rotates on every edit
(doubling as a compare-and-swap / lost-update guard). Consequences:

- **Keep the salt stable and secret** per environment. Rotating it invalidates
  **every** proof's edit link (they can no longer be verified). Losing/leaking it
  breaks or forges edit capabilities.
- Use a **different** salt per environment (local/staging/prod) so a local link
  can't manage a prod proof.
- The dev fallback when unset is a loud, obviously-insecure default
  (`dev-insecure-salt`) — fine for `LocalProofStore` tinkering, never for deploy.

---

## Quick verification (store, no server)

```bash
# with .env.local sourced (or the env vars exported):
python3 - <<'PY'
from backend.proof_api import GcsProofStore
s = GcsProofStore("algebench-proofs-local")
ID = "algebra/smoke-test"
secret = s.claim(ID, {"title":"t","domain":"algebra","steps":[{"index":0,"latex":"1=1"}]}, None)
assert secret and s.get(ID)["title"] == "t"
assert any(c["id"] == ID for c in s.list())          # catalog via blob metadata
assert s.update(ID, {"title":"t","domain":"algebra","steps":[1]}, "wrong", None) is None  # CAS reject
s.delete(ID, secret)                                  # (needs the *current* secret)
print("GCS round-trip OK")
PY
```

A private bucket must also **not** be world-readable:
`curl -o /dev/null -w '%{http_code}' https://storage.googleapis.com/<bucket>/<key>`
should return **403**.

## Test with curl (running server)

Start the server (it auto-loads `.env.local`, so it uses whatever store that
configures): `./algebench --server-only --skip-tour --port 8790`

```bash
B=http://localhost:8790

# Catalog (built-in seed merged with the store) — {id,title,domain,goal}
curl -s "$B/api/proofs" | python3 -m json.tool

# Is a name free?
curl -s "$B/api/proofs/name-available?name=algebra/my-proof"

# Save (claim a name) — returns {"id", "secret"}. KEEP the secret: it's the
# only handle to edit/delete, and it's never stored server-side.
curl -s -X POST "$B/api/proofs" -H 'Content-Type: application/json' -d '{
  "id": "algebra/my-proof",
  "data": {"title":"My proof","domain":"algebra","goal":"factor a^2-b^2",
           "summary":"demo","steps":[{"index":0,"latex":"a^2-b^2"},
                                      {"index":1,"latex":"(a-b)(a+b)"}]},
  "source": {"documentation":"my notes","references":[]}
}'

# Read it back
curl -s "$B/api/proofs/item?id=algebra/my-proof" | python3 -m json.tool

# Author-only source material (needs the secret)
curl -s "$B/api/proofs/source?id=algebra/my-proof&secret=$SECRET"

# Update in place — CAS: the secret must match the CURRENT content; returns a
# NEW rotated secret (the old one stops working).
curl -s -X PUT "$B/api/proofs?secret=$SECRET" -H 'Content-Type: application/json' -d '{
  "id": "algebra/my-proof",
  "data": {"title":"My proof v2","domain":"algebra","steps":[{"index":0,"latex":"a^2-b^2"}]}
}'

# Resolve a cross-reference (own bucket / built-in; allowlist-gated for others)
curl -s "$B/api/proof-ref?ref=algebra/binomial-square"

# Delete (needs the current secret)
curl -s -X DELETE "$B/api/proofs?id=algebra/my-proof&secret=$SECRET"
```

With a GCS bucket configured, a saved proof lands at
`gs://<bucket>/proofs/domains/<domain>/<name>.json` (with `{title,domain,goal}`
custom metadata) + `gs://<bucket>/source-material/domains/<domain>/<name>/…` — verify with
`gcloud storage objects list "gs://<bucket>/**" --format="table(name, custom_fields)"`.
