#!/usr/bin/env python3
"""Audit requirements.lock against the PyPA advisory database, as markdown.

Writes a report to the given path and exits non-zero if anything unignored was
found, so CI can gate on it.

    python3 scripts/dependency_audit_report.py DEPENDENCY-AUDIT-REPORT.md

Why this exists rather than actions/dependency-review-action: GitHub's dependency
graph only parses requirements.txt / Pipfile.lock / Pipfile / setup.py for pip.
It does not read `requirements.lock`, so it sees the 13 ranged entries in
requirements.txt and none of the ~110 pinned transitive versions that actually
get installed — which is where every advisory found in this project has been.
"""

import argparse
import json
import tomllib
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UV_TOML = ROOT / "uv.toml"
UV_TOML_URL = "https://github.com/ibenian/algebench/blob/main/uv.toml"


def cooldown() -> str:
    """The configured cutoff, read from uv.toml rather than restated.

    uv.toml is the single place the policy is set — there is no CLI flag and no
    computed cutoff anywhere in the codebase. Reading it here means the report
    cannot drift from what is actually enforced: roll the date in that file and
    every sentence below follows.

    Returns the raw value. Since uv >= 0.8 that is an ISO-8601 TIMESTAMP, not a
    duration like the old "30 days" — so it can no longer be dropped into a
    sentence as if it were an age. Use :func:`cutoff_phrase` for prose.
    """
    try:
        with open(UV_TOML, "rb") as fh:
            value = tomllib.load(fh).get("exclude-newer")
        return str(value) if value else "no cooldown configured"
    except (OSError, tomllib.TOMLDecodeError):
        return "unknown (uv.toml unreadable)"


def cutoff_phrase(cd: str) -> str:
    """``cooldown()`` rendered as something a sentence can contain.

    The value used to be a duration ("30 days"), which read naturally as an age:
    "younger than 30 days". It is now a cutoff instant, so the same interpolation
    produced "younger than 2026-07-24T00:00:00Z". This wraps it once rather than
    re-phrasing five call sites, and degrades gracefully when uv.toml is
    unreadable (the value is then already a sentence).
    """
    return f"the {cd} cutoff" if cd[:1].isdigit() else cd

# Advisories excluded from failing the build. Keyed by advisory ID, never by
# package — a different advisory against the same package still fails normally.
#
# An entry must justify itself: why no upgrade is possible, what is actually
# mitigating it today, and what is still outstanding. "No fix exists" alone is
# indistinguishable from giving up, and an entry nobody can audit is worse than
# a red build. Delete an entry the moment its premise changes.
IGNORED = {
    "PYSEC-2026-2447": {
        "package": "diskcache (via dspy)",
        "why": (
            "Unfixable rather than unfixed. `diskcache` uses `pickle` as its default "
            "serializer by design, across all 76 releases (0.1.0–5.6.3). Its last "
            "release was 2023-08-31, years before the advisory was published in "
            "Feb 2026, and the project is effectively unmaintained — there is no "
            "version to upgrade to, and none is coming."
        ),
        "mitigations": [
            "`dspy.configure_cache(restrict_pickle=True)` is applied in "
            "`backend/experts/llm_config.py`, restricting deserialization to a "
            "known-safe type set. This is the direct mitigation for the flaw. "
            "(`JSONDisk`, the advisory's general advice, is unreachable here: dspy "
            "exposes no way to swap the disk backend, and it caches litellm "
            "`ModelResponse` objects that are not JSON-serializable.)",
            "LM response caching is **off by default** (`ALGEBENCH_LM_CACHE`), so the "
            "pickle store is not written at all during normal local use.",
            "Exploitation requires **write access to the cache directory** (CVSS "
            "`AV:L/PR:L`). Anything holding that on a single-user machine can already "
            "execute as that user and has no need of a pickle.",
            "Deploys are isolated, single-tenant, ephemeral containers — the advisory "
            "names shared storage and multi-tenant hosts as the high-risk contexts, "
            "and neither applies.",
        ],
        "outstanding": [
            "**Cache poisoning is a separate, lower-bar threat that `restrict_pickle` "
            "does not address.** It constrains deserialization, not content: a "
            "crafted entry built only from safe types is accepted, served as though "
            "the model produced it, and — because the proof-completion refinement "
            "loop threads responses back into the next prompt — becomes input to a "
            "subsequent live LLM call. The precondition is the same (write access to "
            "the cache directory), so the same containment applies, but no "
            "deserialization setting can prevent it.",
        ],
    },
}

# Status icons for the version table. Each answers a different question, so they
# are deliberately not a severity scale.
ICON = {
    "current":  "✅",   # nothing newer exists
    "ready":    "⬆️",   # a newer release is past the cooldown and can be taken now
    "cooling":  "⏳",   # newer exists but is too fresh — this is the policy working
    "capped":   "🔒",   # requirements.txt constraints block it, not the cooldown
    "back":     "🔻",   # a relock would move this BACKWARDS — read carefully
}


def _key(v):
    return [int(x) if x.isdigit() else x for x in re.split(r"[.\-+]", v)]


def _older(a, b):
    try:
        return _key(a) < _key(b)
    except TypeError:
        return a < b


def resolve(lock: Path, out_path: Path, cooldown: bool) -> None:
    """Compile into out_path, seeded from the lock so uv keeps existing pins."""
    out_path.write_text(lock.read_text())
    env = dict(os.environ)
    # Drop any inherited UV_EXCLUDE_NEWER before deciding what this run should use.
    # uv's env var beats uv.toml, so a developer with it exported in their shell
    # would silently resolve the "cooldown" column against THEIR cutoff instead of
    # the project's — the report would then contradict the policy it exists to
    # check, exactly the failure the cwd=ROOT comment below guards against by a
    # different route.
    env.pop("UV_EXCLUDE_NEWER", None)
    if not cooldown:
        # The ONLY place the cooldown is switched off, and it never writes to the
        # real lock — this is how the report shows what is being held back.
        env["UV_EXCLUDE_NEWER"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    # cwd=ROOT is load-bearing, not tidiness: uv discovers uv.toml by walking up
    # from the working directory, so running this script from anywhere else
    # silently drops the 30-day cooldown and the report then contradicts the
    # policy it exists to check. Measured from /tmp: numpy showed as "ready" at
    # 2.5.2, a release 11 days old that the cooldown should have held back.
    proc = subprocess.run(
        ["uv", "pip", "compile", str(ROOT / "requirements.txt"), "-o", str(out_path),
         "--universal", "--python-version", "3.12", "--no-header", "--upgrade"],
        env=env, cwd=ROOT, capture_output=True, text=True, check=False,
    )
    if proc.returncode != 0:
        # Never fall through to the copied lock: that would silently report the
        # current pins as though they were the resolution result.
        raise SystemExit(
            f"uv pip compile failed ({'no cooldown' if not cooldown else 'cooldown'} "
            f"resolution), exit {proc.returncode}:\n{proc.stderr.strip()}"
        )


def pins(path: Path) -> dict:
    out = {}
    for line in path.read_text().splitlines():
        line = line.split(";")[0].strip()
        m = re.match(r"^([A-Za-z0-9._-]+)==(.+)$", line)
        if m:
            out[m.group(1).lower()] = m.group(2)
    return out


def pypi_latest(pkg: str):
    try:
        with urllib.request.urlopen(f"https://pypi.org/pypi/{pkg}/json", timeout=15) as r:
            return pkg, json.load(r)["info"]["version"]
    except Exception:
        return pkg, "?"


def version_table(lock: Path) -> list[str]:
    """Current vs newest-allowed vs newest-in-existence, for everything that moves."""
    with tempfile.TemporaryDirectory() as tmp:
        allowed_p, newest_p = Path(tmp) / "a.lock", Path(tmp) / "n.lock"
        resolve(lock, allowed_p, cooldown=True)
        resolve(lock, newest_p, cooldown=False)
        cur, allowed, newest = pins(lock), pins(allowed_p), pins(newest_p)

    moving = sorted(p for p in cur
                    if allowed.get(p, cur[p]) != cur[p] or newest.get(p, cur[p]) != cur[p])
    if not moving:
        return ["## Versions\n", f"{ICON['current']} Every package is at the newest version "
                "`requirements.txt` allows.\n"]

    with ThreadPoolExecutor(max_workers=16) as ex:
        pypi = dict(ex.map(pypi_latest, moving))

    cd = cooldown()
    phrase = cutoff_phrase(cd)
    out = ["## Versions\n",
           f"**{len(moving)}** package(s) could move. Columns are three different "
           "ceilings, not a progression:\n",
           f"| | Package | Current | Allowed (published ≤{cd}) | Latest on PyPI |",
           "|---|---|---|---|---|"]
    counts = {k: 0 for k in ICON}
    for p in moving:
        a, n, y = allowed.get(p, "—"), newest.get(p, "—"), pypi.get(p, "?")
        if a != "—" and _older(a, cur[p]):
            state = "back"
        elif a != n:
            state = "cooling"
        elif y not in ("?", n) and n != "—":
            state = "capped"
        elif a != cur[p]:
            state = "ready"
        else:
            state = "current"
        counts[state] += 1
        out.append(f"| {ICON[state]} | `{p}` | `{cur[p]}` | `{a}` | `{y}` |")

    out += ["", "### How to read this\n",
            f"- {ICON['ready']} **Ready** ({counts['ready']}) — a newer release has cleared "
            f"{phrase}. Take it with a targeted relock.",
            f"- {ICON['cooling']} **Cooling** ({counts['cooling']}) — something newer exists but "
            f"was published after {phrase}. **This is the policy working, not a problem.** "
            "Compromised packages are usually caught and yanked within hours to days; waiting "
            "removes most of that exposure.",
            f"- {ICON['capped']} **Capped** ({counts['capped']}) — the cooldown is not what is "
            "holding this back; a constraint in `requirements.txt` (or a transitive dependency's "
            "own pin) is. Loosening the range is the only way forward.",
            f"- {ICON['back']} **Backwards** ({counts['back']}) — a relock would move this to an "
            f"*older* release, because the current pin was itself published after {phrase} (a security "
            "fix taken deliberately). Older releases carry more advisories, never fewer — check "
            "the diff before committing any relock while this row is present.",
            f"- {ICON['current']} **Current** — nothing newer exists.",
            "",
            "> **Allowed** is what `uv pip compile --upgrade` would pin today. **Latest on PyPI** "
            "may be unreachable regardless of the cooldown if a constraint caps it.",
            ""]
    return out


def advisory_url(vuln_id: str, aliases: list[str]) -> str:
    """Prefer a GHSA link (richest page), then CVE, then the OSV record."""
    for alias in aliases:
        if alias.startswith("GHSA-"):
            return f"https://github.com/advisories/{alias}"
    for alias in aliases:
        if alias.startswith("CVE-"):
            return f"https://nvd.nist.gov/vuln/detail/{alias}"
    return f"https://osv.dev/vulnerability/{vuln_id}"


def run_audit(lock: Path) -> tuple[list[dict], int]:
    """Return (pip-audit dependency records, number of pinned entries) for `lock`."""
    pinned = [
        line.split(";")[0].strip()
        for line in lock.read_text().splitlines()
        if re.match(r"^[A-Za-z0-9._-]+==", line.strip())
    ]
    tmp = ROOT / ".audit-input.txt"
    tmp.write_text("\n".join(pinned) + "\n")
    try:
        proc = subprocess.run(
            ["uvx", "pip-audit", "-r", str(tmp), "--no-deps", "--disable-pip",
             "--progress-spinner", "off", "-f", "json"],
            capture_output=True, text=True,
        )
        if not proc.stdout.strip():
            raise SystemExit(f"pip-audit produced no output:\n{proc.stderr}")
        return json.loads(proc.stdout).get("dependencies", []), len(pinned)
    finally:
        tmp.unlink(missing_ok=True)


def build(deps: list[dict], total: int) -> tuple[str, int]:
    """Render markdown. Returns (markdown, number of unignored findings)."""
    findings, ignored_hits = [], []
    for dep in deps:
        seen = set()
        for vuln in dep.get("vulns", []):
            # pip-audit can emit the same advisory twice; key on the id.
            if vuln["id"] in seen:
                continue
            seen.add(vuln["id"])
            row = {
                "package": dep["name"],
                "version": dep["version"],
                "id": vuln["id"],
                "url": advisory_url(vuln["id"], vuln.get("aliases", [])),
                "aliases": [a for a in vuln.get("aliases", []) if a.startswith("CVE-")],
                "fix": ", ".join(vuln.get("fix_versions", [])) or "none published",
            }
            (ignored_hits if vuln["id"] in IGNORED else findings).append(row)

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    cd = cooldown()
    out = [f"# Python Dependency Audit\n",
           f"`requirements.lock` — **{total}** pinned packages checked against the "
           f"PyPA advisory database.\n",
           f"Release cutoff: packages published after **{cd}** are held back — set by "
           f"[`uv.toml`]({UV_TOML_URL}) (`exclude-newer`), which uv applies to every "
           f"command in this project. Nothing here restates the value; it is read "
           f"from that file.\n",
           f"_{stamp}_\n"]

    if findings:
        out.append(f"## ⚠️ {len(findings)} advisory(s) found\n")
        out.append("| Package | Pinned | Advisory | CVE | Fixed in |")
        out.append("|---|---|---|---|---|")
        for f in findings:
            cve = ", ".join(f["aliases"]) or "—"
            out.append(f"| `{f['package']}` | `{f['version']}` | "
                       f"[{f['id']}]({f['url']}) | {cve} | `{f['fix']}` |")
        out.append("")
        out.append("Take a fix with a targeted relock, then rebuild the venv:\n")
        out.append("```bash")
        # One flag per package, not per advisory — a package can carry several.
        pkgs = " ".join(f"--upgrade-package {n}" for n in dict.fromkeys(f["package"] for f in findings))
        out.append(f"uv pip compile requirements.txt -o requirements.lock \\\n"
                   f"    --universal --python-version 3.12 --no-header {pkgs}")
        out.append("./scripts/setup-venv.sh")
        out.append("```")
        out.append("")
        out.append(f"> If the fix is newer than the {cooldown()} cooldown "
                   f"([`uv.toml`]({UV_TOML_URL})) it will be held back. Overriding the "
                   "cooldown is a deliberate decision — see AGENTS.md.")
    else:
        out.append("## ✅ No known vulnerabilities\n")
        out.append("Every pinned version is clear of the advisory database.")

    out.append("")
    out.extend(version_table(ROOT / "requirements.lock"))

    if ignored_hits:
        out.append("\n## Ignored by policy\n")
        out.append("These do not fail the build. They are listed in full every run so "
                   "the exclusion stays auditable rather than silent.\n")
        for f in ignored_hits:
            meta = IGNORED[f["id"]]
            out.append(f"### [{f['id']}]({f['url']}) — `{f['package']}` `{f['version']}`\n")
            out.append(f"**Why no upgrade:** {meta['why']}\n")
            out.append("**Mitigating today:**\n")
            out.extend(f"- {m}" for m in meta["mitigations"])
            if meta.get("outstanding"):
                out.append("\n**Still outstanding:**\n")
                out.extend(f"- {o}" for o in meta["outstanding"])
            out.append("")

    return "\n".join(out) + "\n", len(findings)


def main() -> None:
    ap = argparse.ArgumentParser(description="Audit requirements.lock, emit markdown")
    ap.add_argument("output", type=Path, help="Path to write the markdown report")
    ap.add_argument("--lock", type=Path, default=ROOT / "requirements.lock")
    args = ap.parse_args()

    deps, total = run_audit(args.lock)
    md, count = build(deps, total)
    args.output.write_text(md, encoding="utf-8")
    print(md)
    sys.exit(1 if count else 0)


if __name__ == "__main__":
    main()
