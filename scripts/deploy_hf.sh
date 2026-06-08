#!/usr/bin/env bash
#
# deploy_hf.sh — Deploy AlgeBench to its Hugging Face Space.
#
# Hugging Face Spaces build from the Space repo's own `main` branch and REJECT
# binary files that appear anywhere in git history. So we can't push a normal
# dev branch (the docs/*.png images live in its history). Instead this script
# builds a clean *snapshot* of the production app, overlays the HF deploy config
# (Dockerfile + README metadata header), strips the binaries/dev tooling, and
# pushes that snapshot commit to the Space's main.
#
# The Space is a deploy MIRROR — GitHub keeps the full dev history. Each deploy
# is chained onto the `deploy/on-huggingface` log (one commit per deploy, parent
# = previous deploy), and the SAME commit is pushed to the Space's main. Every
# commit is a clean snapshot, so the log stays binary-free and HF keeps accepting
# it. (Use --keep N to trim that log; see below.)
#
# Usage:
#   scripts/deploy_hf.sh [--source <ref>] [--keep <N>] [--dry-run] [--yes]
#
#   --source <ref>   Git ref whose tree to deploy.
#                    Default: $HF_SOURCE_REF, else origin/deploy/on-render
#                    (i.e. whatever Render production runs — HF stays in lockstep).
#   --keep <N>       Trim the deploy log (deploy/on-huggingface) to the most
#                    recent N deploys: keep the new commit + N-1 prior, re-root
#                    the rest away. 0 (default) keeps the full log; 1 makes every
#                    deploy a single root commit (no history). Safe — each commit
#                    is a complete snapshot, so dropping old commits never changes
#                    what is deployed. (Rewrites the log; origin push is force-with-lease.)
#   --dry-run        Build and report the snapshot, but do NOT push.
#   --yes            Skip the confirmation prompt.
#
# Auth (pick one; first that applies wins):
#   * git credential helper already holds your HF token  (recommended — no prompt)
#   * export HF_TOKEN=hf_xxx   (used as the git password for the push)
#   * otherwise git prompts for username + token at push time
#
# Env overrides:
#   HF_SPACE      Space id           (default: ibenian/algebench)
#   HF_USER       HF username        (default: ibenian)
#   HF_SOURCE_REF Default source ref (default: origin/deploy/on-render)
#   HF_KEEP       Default --keep value (default: 0 = full log)
#   HF_RAW_BASE   raw.githubusercontent base for README images
#   HF_BLOB_BASE  github.com/blob base for README doc links

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="$REPO/deploy/huggingface"

HF_SPACE="${HF_SPACE:-ibenian/algebench}"
HF_USER="${HF_USER:-ibenian}"
SOURCE_REF="${HF_SOURCE_REF:-origin/deploy/on-render}"
RECORD_BRANCH="${HF_RECORD_BRANCH:-deploy/on-huggingface}"
HF_RAW_BASE="${HF_RAW_BASE:-https://raw.githubusercontent.com/${HF_SPACE}/main}"
HF_BLOB_BASE="${HF_BLOB_BASE:-https://github.com/${HF_SPACE}/blob/main}"

DRY_RUN=0
ASSUME_YES=0
KEEP="${HF_KEEP:-0}"   # 0 = keep full deploy log; N>=1 = trim log to last N deploys

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
    case "$1" in
        --source) SOURCE_REF="$2"; shift 2 ;;
        --keep) KEEP="$2"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        --yes|-y) ASSUME_YES=1; shift ;;
        -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

case "$KEEP" in (''|*[!0-9]*) echo "ERROR: --keep needs a non-negative integer" >&2; exit 2 ;; esac

die() { echo "ERROR: $*" >&2; exit 1; }

[ -f "$CONFIG_DIR/Dockerfile" ]     || die "missing $CONFIG_DIR/Dockerfile"
[ -f "$CONFIG_DIR/space-header.md" ]|| die "missing $CONFIG_DIR/space-header.md"
[ -f "$CONFIG_DIR/exclude.txt" ]    || die "missing $CONFIG_DIR/exclude.txt"

# ---------------------------------------------------------------------------
# Resolve source content
# ---------------------------------------------------------------------------
echo "→ Fetching origin…"
git -C "$REPO" fetch origin --quiet --prune || die "git fetch failed"

git -C "$REPO" rev-parse --verify --quiet "$SOURCE_REF^{commit}" >/dev/null \
    || die "source ref '$SOURCE_REF' not found (try --source origin/main)"

SRC_SHA="$(git -C "$REPO" rev-parse --short "$SOURCE_REF")"
SRC_FULL="$(git -C "$REPO" rev-parse "$SOURCE_REF")"   # full 40-char SHA for the durable record
SRC_SUBJ="$(git -C "$REPO" log -1 --format=%s "$SOURCE_REF")"

echo "→ Source:  $SOURCE_REF  ($SRC_SHA  $SRC_SUBJ)"
echo "→ Target:  https://huggingface.co/spaces/${HF_SPACE}  (branch main)"

# ---------------------------------------------------------------------------
# Build the snapshot in a throwaway worktree (never touches your checkout)
# ---------------------------------------------------------------------------
WORKTREE="$(mktemp -d "${TMPDIR:-/tmp}/algebench-hf.XXXXXX")"
cleanup() {
    git -C "$REPO" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || rm -rf "$WORKTREE"
    git -C "$REPO" worktree prune >/dev/null 2>&1 || true
    [ -n "${ASKPASS:-}" ] && rm -f "$ASKPASS" 2>/dev/null || true
}
trap cleanup EXIT

echo "→ Building snapshot…"
# Detached worktree at the source ref. We never create a branch — the snapshot
# commit is made with plumbing (write-tree + commit-tree) and pushed by SHA, so
# an interrupted run can never leave a branch behind to collide with the next.
# Each run uses a unique mktemp path, so a stale worktree can't block us either.
git -C "$REPO" worktree prune >/dev/null 2>&1 || true
git -C "$REPO" worktree add --quiet --detach "$WORKTREE" "$SOURCE_REF"
cd "$WORKTREE"

# Overlay the Dockerfile at repo root.
cp "$CONFIG_DIR/Dockerfile" Dockerfile

# Prepend the HF metadata header to README, and repoint relative docs links
# (which we are about to strip) to their GitHub-hosted copies so the Space
# card still renders. Images -> raw.githubusercontent, other links -> blob.
if [ -f README.md ]; then
    { cat "$CONFIG_DIR/space-header.md"; printf '\n'; cat README.md; } > .hf_readme
    sed -E "s#\]\((docs/[^)]+\.(png|jpe?g|gif|svg|webp))#](${HF_RAW_BASE}/\1#g" .hf_readme > .hf_readme2
    sed -E "s#\]\(docs/#](${HF_BLOB_BASE}/docs/#g" .hf_readme2 > README.md
    rm -f .hf_readme .hf_readme2
else
    cp "$CONFIG_DIR/space-header.md" README.md
fi

# Strip excluded paths (binaries HF rejects + dev-only tooling).
while IFS= read -r line; do
    line="${line%%#*}"                       # drop trailing comment
    line="$(printf '%s' "$line" | awk '{$1=$1};1')"  # trim whitespace
    [ -z "$line" ] && continue
    rm -rf -- "$line"
done < "$CONFIG_DIR/exclude.txt"

# Safety net: no large binary may survive (HF rejects them).
BIG="$(find . -type f -size +9M -not -path './.git/*' || true)"
if [ -n "$BIG" ]; then
    echo "ERROR: files larger than 9MB remain in the snapshot — HF will reject them:" >&2
    echo "$BIG" >&2
    echo "Add their paths to deploy/huggingface/exclude.txt and retry." >&2
    exit 1
fi

# Build the snapshot commit via plumbing and chain it onto the record branch
# (deploy/on-huggingface) so the branch is a browsable deploy log. No branch is
# ever checked out — we commit-tree then move the ref — so nothing can collide.
git add -A
SNAP_TREE="$(git write-tree)"

# Parent = current record-branch tip (prefer local, fall back to origin's), so
# each deploy appends to the log. Empty on the very first deploy (root commit).
PARENT="$(git -C "$REPO" rev-parse --verify --quiet "refs/heads/${RECORD_BRANCH}" \
        || git -C "$REPO" rev-parse --verify --quiet "refs/remotes/origin/${RECORD_BRANCH}" \
        || true)"
ORIG_TIP="$PARENT"   # the real current tip (for the ref compare-and-swap below)

# --keep N: trim the deploy log to the most recent N deploys (new one + N-1 prior).
# Safe because every commit is a complete standalone snapshot — re-rooting the
# tail rewrites only the parent chain, never the deployed content. KEEP=0 keeps
# the full log; KEEP=1 makes every deploy a single root commit (no history).
if [ -n "$PARENT" ] && [ "$KEEP" -ge 1 ]; then
    # The (KEEP-1) most recent prior deploys, oldest-first; oldest becomes a root.
    NEWTAIL=""
    for c in $(git -C "$REPO" rev-list --reverse -n "$((KEEP-1))" "$PARENT"); do
        t="$(git -C "$REPO" rev-parse "${c}^{tree}")"
        p=""; [ -n "$NEWTAIL" ] && p="-p $NEWTAIL"
        NEWTAIL="$(git -C "$REPO" log -1 --format=%B "$c" \
            | GIT_AUTHOR_DATE="$(git -C "$REPO" log -1 --format=%aI "$c")" \
              GIT_COMMITTER_DATE="$(git -C "$REPO" log -1 --format=%cI "$c")" \
              git -C "$REPO" commit-tree "$t" $p)"
    done
    PARENT="$NEWTAIL"   # empty when KEEP=1 → new commit becomes the sole root
fi

PARENT_ARGS=""
[ -n "$PARENT" ] && PARENT_ARGS="-p $PARENT"

SNAP_COMMIT="$(printf '%s\n' \
"AlgeBench — Hugging Face Space deploy

Source: ${SRC_FULL} ${SRC_SUBJ}
Built by scripts/deploy_hf.sh from ${SOURCE_REF}.

🤖 Co-Authored-By: Claude <81847+claude@users.noreply.github.com>" \
    | git commit-tree "$SNAP_TREE" $PARENT_ARGS)"

FILE_COUNT="$(git ls-files | wc -l | tr -d ' ')"
echo "→ Snapshot ready: commit ${SNAP_COMMIT}, ${FILE_COUNT} files, Dockerfile + HF header in place."
[ -n "$ORIG_TIP" ] && echo "  Appends to ${RECORD_BRANCH} (prev deploy ${ORIG_TIP})" \
                   || echo "  First commit on ${RECORD_BRANCH} (no prior deploy)"
if [ "$KEEP" -ge 1 ] && [ -n "$ORIG_TIP" ]; then
    echo "  --keep ${KEEP}: deploy log trimmed to the last ${KEEP} deploy(s) (older history dropped)"
fi

# ---------------------------------------------------------------------------
# Push (or stop here for a dry run)
# ---------------------------------------------------------------------------
if [ "$DRY_RUN" -eq 1 ]; then
    echo "✓ Dry run — snapshot built, nothing pushed."
    echo "  Largest tracked files:"
    git ls-files | while IFS= read -r f; do
        [ -f "$f" ] || continue   # skip symlinks/dirs
        printf '%s\t%s\n' "$(wc -c < "$f" | tr -d ' ')" "$f"
    done | sort -rn | head -5 | awk '{printf "    %.0fKB  %s\n", $1/1024, $2}'
    exit 0
fi

if [ "$ASSUME_YES" -ne 1 ]; then
    printf "Push this snapshot to https://huggingface.co/spaces/%s (main)? [y/N] " "$HF_SPACE"
    read -r reply
    case "$reply" in
        y|Y|yes|YES) ;;
        *) echo "Aborted."; exit 1 ;;
    esac
fi

# Auth. When HF_TOKEN is set, feed it through GIT_ASKPASS (an env-fed helper
# script) instead of embedding it in the URL — so the token never appears in
# argv / `ps` / error output. The helper file contains no secret; it reads the
# token from the environment of the git process. Otherwise rely on the git
# credential helper (e.g. the macOS keychain).
PUSH_URL="https://huggingface.co/spaces/${HF_SPACE}"
if [ -n "${HF_TOKEN:-}" ]; then
    PUSH_URL="https://${HF_USER}@huggingface.co/spaces/${HF_SPACE}"
    ASKPASS="$(mktemp "${TMPDIR:-/tmp}/hf-askpass.XXXXXX")"
    cat > "$ASKPASS" <<'AP'
#!/bin/sh
case "$1" in
  *[Uu]sername*) printf '%s' "$HF_USER" ;;
  *)             printf '%s' "$HF_TOKEN" ;;
esac
AP
    chmod 700 "$ASKPASS"
fi

echo "→ Pushing to the Space…"
if [ -n "${HF_TOKEN:-}" ]; then
    GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0 HF_USER="$HF_USER" HF_TOKEN="$HF_TOKEN" \
        git push --force "$PUSH_URL" "${SNAP_COMMIT}:refs/heads/main"
else
    git push --force "$PUSH_URL" "${SNAP_COMMIT}:refs/heads/main"
fi

# Record the deploy: advance deploy/on-huggingface to this commit (compare-and-swap
# against the ORIGINAL tip we read), then push the log to origin. With --keep the
# history is rewritten, so the origin push uses --force-with-lease (safe: this
# branch is a deploy log nobody branches from).
git -C "$REPO" update-ref "refs/heads/${RECORD_BRANCH}" "$SNAP_COMMIT" ${ORIG_TIP:+"$ORIG_TIP"}
echo "→ Recorded on ${RECORD_BRANCH} (${SNAP_COMMIT})"
if git -C "$REPO" push --force-with-lease origin "refs/heads/${RECORD_BRANCH}:refs/heads/${RECORD_BRANCH}" >/dev/null 2>&1; then
    echo "  Pushed ${RECORD_BRANCH} to origin (deploy log)."
else
    echo "  (note: couldn't push ${RECORD_BRANCH} to origin — kept locally; push it yourself if you want the shared log)"
fi

echo "🤗 Deployed ${SRC_SHA} to https://huggingface.co/spaces/${HF_SPACE}"
echo "  App:  https://${HF_USER}-$(printf '%s' "$HF_SPACE" | cut -d/ -f2).hf.space"
echo "  Watch the build on the Space's Logs tab (~3–6 min for a fresh build)."
