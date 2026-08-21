#!/usr/bin/env python3
"""Audit requirements.lock against the PyPA advisory database, as markdown.

Writes a report to the given path and exits non-zero if anything unignored was
found, so CI can gate on it.

    python3 scripts/audit_report.py DEPENDENCY-AUDIT-REPORT.md

Why this exists rather than actions/dependency-review-action: GitHub's dependency
graph only parses requirements.txt / Pipfile.lock / Pipfile / setup.py for pip.
It does not read `requirements.lock`, so it sees the 13 ranged entries in
requirements.txt and none of the ~110 pinned transitive versions that actually
get installed — which is where every advisory found in this project has been.
"""

import argparse
import json
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

# No patched release exists in ANY version of diskcache (pickle is its default
# serializer by design, and the project's last release predates the advisory by
# years). Accepted risk, documented in AGENTS.md. Without this the gate could
# never pass.
IGNORED = {"PYSEC-2026-2447": "diskcache — no patched release exists in any version"}

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
    if not cooldown:
        # The ONLY place the cooldown is switched off, and it never writes to the
        # real lock — this is how the report shows what is being held back.
        env["UV_EXCLUDE_NEWER"] = "0 days"
    subprocess.run(
        ["uv", "pip", "compile", str(ROOT / "requirements.txt"), "-o", str(out_path),
         "--universal", "--python-version", "3.12", "--no-header", "--upgrade"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
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

    out = ["## Versions\n",
           f"**{len(moving)}** package(s) could move. Columns are three different "
           "ceilings, not a progression:\n",
           "| | Package | Current | Allowed (30-day cooldown) | Latest on PyPI |",
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
            f"- {ICON['ready']} **Ready** ({counts['ready']}) — a newer release has cleared the "
            "30-day cooldown. Take it with a targeted relock.",
            f"- {ICON['cooling']} **Cooling** ({counts['cooling']}) — something newer exists but "
            "is less than 30 days old. **This is the policy working, not a problem.** "
            "Compromised packages are usually caught and yanked within hours to days; waiting "
            "removes most of that exposure.",
            f"- {ICON['capped']} **Capped** ({counts['capped']}) — the cooldown is not what is "
            "holding this back; a constraint in `requirements.txt` (or a transitive dependency's "
            "own pin) is. Loosening the range is the only way forward.",
            f"- {ICON['back']} **Backwards** ({counts['back']}) — a relock would move this to an "
            "*older* release, because the current pin is itself younger than 30 days (a security "
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


def run_audit(lock: Path) -> list[dict]:
    """Return pip-audit's dependency records for the pinned entries in `lock`."""
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
    out = [f"# Python Dependency Audit\n",
           f"`requirements.lock` — **{total}** pinned packages checked against the "
           f"PyPA advisory database.\n", f"_{stamp}_\n"]

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
        out.append("> If the fix is newer than the 30-day cooldown it will be held back. "
                   "Overriding the cooldown is a deliberate decision — see AGENTS.md.")
    else:
        out.append("## ✅ No known vulnerabilities\n")
        out.append("Every pinned version is clear of the advisory database.")

    out.append("")
    out.extend(version_table(ROOT / "requirements.lock"))

    if ignored_hits:
        out.append("\n## Ignored by policy\n")
        out.append("| Package | Pinned | Advisory | Reason |")
        out.append("|---|---|---|---|")
        for f in ignored_hits:
            out.append(f"| `{f['package']}` | `{f['version']}` | "
                       f"[{f['id']}]({f['url']}) | {IGNORED[f['id']]} |")

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
