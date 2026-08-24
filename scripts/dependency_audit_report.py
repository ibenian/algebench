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

# Minimum uv, mirroring `required-version` in uv.toml (pinned by
# tests/test_uv_floor.py).
#
# WHY THIS EXISTS AT ALL, since uv.toml already sets `required-version`
# ------------------------------------------------------------------------
# `required-version` makes uv refuse to run below the floor on every PROJECT
# command, so nothing else in this repo hand-rolls a version check. `uv tool run`
# is the exception, and it is documented as such — uv's configuration-files page
# (https://docs.astral.sh/uv/concepts/configuration-files/) says:
#
#     "For `tool` commands, which operate at the user level, local configuration
#      files will be ignored. Instead, uv will exclusively read from user-level
#      configuration (e.g., ~/.config/uv/uv.toml) and system-level configuration."
#
# So a project uv.toml simply does not reach `uv tool run`. Reproduced, same
# directory and same uv.toml, against uv 0.10.12:
#
#     uv pip compile                 -> refused, "Required uv version >=0.11.15
#                                       does not match the running version 0.10.12"
#     uv tool run --no-cache cowsay  -> ran, and installed a package
#
# (`--no-cache` on purpose: it forces a real resolve+install, ruling out "the tool
# was already cached so no configuration was read".)
#
# That matters twice over, because BOTH uv.toml settings are ignored there:
#
#   * the FLOOR — hence _require_uv() below. This is the one call in this script
#     that actually INSTALLS packages, which is exactly the exposure
#     GHSA-4gg8-gxpx-9rph and GHSA-pjjw-68hj-v9mw describe.
#   * the COOLDOWN — hence the explicit `--exclude-newer` on that call in
#     run_audit(). It is load-bearing, not belt-and-braces: without it the tool
#     install has no cooldown at all.
#
# If a future uv makes `tool` commands honour project configuration, both can go.
UV_MIN = "0.11.15"


def _uv_version() -> str | None:
    """The running uv's version, or None if it cannot be trusted.

    None covers three distinct cases — uv absent, uv failing, or uv printing
    something unparseable — because none of them justify proceeding. Note the
    returncode check: a binary that exits nonzero while still printing a
    version-shaped line must not be treated as verified.
    """
    try:
        out = subprocess.run(["uv", "--version"], capture_output=True, text=True, check=False)
    except OSError:
        return None                      # not on PATH, or not executable
    if out.returncode != 0:
        return None
    parts = out.stdout.split()
    return parts[1] if len(parts) > 1 else None


def _require_uv() -> None:
    """Refuse to install through a uv below the project's security floor.

    Fails CLOSED: anything unverifiable is refused rather than assumed recent.
    """
    def triple(v: str):
        bits = v.split(".")[:3]
        return tuple(int(b) for b in bits) if len(bits) == 3 and all(b.isdigit() for b in bits) else None

    raw = _uv_version()
    have = triple(raw) if raw else None

    if have is None:
        # Distinct from "too old": `uv self update` cannot help if uv is missing
        # or broken, so do not suggest it.
        raise SystemExit(
            "uv could not be run, or its version could not be read.\n"
            f"This script installs pip-audit through uv and requires >= {UV_MIN}.\n"
            "Install or repair uv first: https://astral.sh/uv"
        )
    if have < triple(UV_MIN):
        raise SystemExit(
            f"uv {raw} is below this project's floor of {UV_MIN}.\n"
            f"Below {UV_MIN}, uv is affected by install-time advisories "
            f"(GHSA-4gg8-gxpx-9rph; below 0.11.6 also GHSA-pjjw-68hj-v9mw), and this "
            f"script installs pip-audit through uv.\n"
            f"Upgrade with `uv self update` (0.11.32 suggested), then re-run."
        )


def cutoff() -> str | None:
    """The configured cutoff as uv would accept it, or None if there is none.

    Separate from :func:`cooldown` on purpose. That one always returns something
    printable — including "no cooldown configured" and "unknown (uv.toml
    unreadable)" — because a heading has to say *something*. Those sentinels are
    prose, not values: uv rejects them outright ("could not be parsed as a valid
    exclude-newer value"). Once the same string started being forwarded as
    ``--exclude-newer`` it became machine input too, and the display fallbacks
    had to stop travelling with it.
    """
    try:
        with open(UV_TOML, "rb") as fh:
            value = tomllib.load(fh).get("exclude-newer")
    except (OSError, tomllib.TOMLDecodeError):
        raise SystemExit(
            f"{UV_TOML} could not be read, so the release cooldown is unknown.\n"
            "Refusing to resolve: an audit that silently drops the cooldown reports "
            "the opposite of the policy it exists to check."
        )
    return str(value) if value else None


def cooldown() -> str:
    """The configured release cooldown, read from uv.toml rather than restated.

    uv.toml is the single place the policy is set, and this is the single place it
    is read: the value labels the report AND is forwarded to uv as
    ``--exclude-newer`` (see :func:`resolve`), so the heading and the data cannot
    disagree, and neither can drift from what the project actually enforces.
    Change the file to "14 days" and every sentence below follows.

    Forwarding it explicitly is deliberate rather than relying on uv discovering
    uv.toml: the flag also beats an inherited ``UV_EXCLUDE_NEWER``, so the report
    does not depend on the caller's shell.
    """
    try:
        with open(UV_TOML, "rb") as fh:
            value = tomllib.load(fh).get("exclude-newer")
        return str(value) if value else "no cooldown configured"
    except (OSError, tomllib.TOMLDecodeError):
        return "unknown (uv.toml unreadable)"

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


def resolve(lock: Path, out_path: Path, apply_cooldown: bool) -> None:
    """Compile into out_path, seeded from the lock so uv keeps existing pins."""
    out_path.write_text(lock.read_text())
    # Pass the cutoff EXPLICITLY rather than leaning on uv.toml plus the ambient
    # environment. --exclude-newer beats both uv.toml and an inherited
    # UV_EXCLUDE_NEWER, so the resolution depends on nothing but this line — and
    # the cooldown value comes from cooldown(), the same call that labels the
    # report, so the heading and the data cannot disagree. A developer with
    # UV_EXCLUDE_NEWER="0 days" left over in their shell would otherwise have
    # BOTH resolutions run at 0 days, making the two columns identical and the
    # report announce that nothing is held back.
    #   cooldown=False is the ONLY place the cooldown is switched off, and it
    #   never writes to the real lock — this is how the report shows what is
    #   being held back.
    # NB: the parameter is `apply_cooldown`, not `cooldown` — the latter is the
    # module-level function read from uv.toml, and shadowing it here would call a bool.
    # `None` = no cooldown configured in uv.toml. Omit the flag entirely rather
    # than inventing a value: uv then applies whatever uv.toml says (nothing),
    # which is the configured intent.
    cut = cutoff() if apply_cooldown else "0 days"
    newer = ["--exclude-newer", cut] if cut else []
    # cwd=ROOT so uv still discovers uv.toml for any OTHER setting it may grow.
    # The cooldown itself no longer depends on it — that is passed explicitly
    # above, which is the point. Before that flag existed this line was
    # load-bearing: run from /tmp, numpy showed as "ready" at 2.5.2, a release 11
    # days old that the cooldown should have held back.
    proc = subprocess.run(
        ["uv", "pip", "compile", str(ROOT / "requirements.txt"), "-o", str(out_path),
         "--universal", "--python-version", "3.12", "--no-header", "--upgrade",
         *newer],
        cwd=ROOT, capture_output=True, text=True, check=False,
    )
    if proc.returncode != 0:
        # Never fall through to the copied lock: that would silently report the
        # current pins as though they were the resolution result.
        raise SystemExit(
            f"uv pip compile failed ({'no cooldown' if not apply_cooldown else 'cooldown'} "
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
        resolve(lock, allowed_p, apply_cooldown=True)
        resolve(lock, newest_p, apply_cooldown=False)
        cur, allowed, newest = pins(lock), pins(allowed_p), pins(newest_p)

    moving = sorted(p for p in cur
                    if allowed.get(p, cur[p]) != cur[p] or newest.get(p, cur[p]) != cur[p])
    if not moving:
        return ["## Versions\n", f"{ICON['current']} Every package is at the newest version "
                "`requirements.txt` allows.\n"]

    with ThreadPoolExecutor(max_workers=16) as ex:
        pypi = dict(ex.map(pypi_latest, moving))

    cd = cooldown()
    out = ["## Versions\n",
           f"**{len(moving)}** package(s) could move. Columns are three different "
           "ceilings, not a progression:\n",
           f"| | Package | Current | Allowed (≥{cd} old) | Latest on PyPI |",
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
            f"{cd} cooldown. Take it with a targeted relock.",
            f"- {ICON['cooling']} **Cooling** ({counts['cooling']}) — something newer exists but "
            f"is younger than {cd}. **This is the policy working, not a problem.** "
            "Compromised packages are usually caught and yanked within hours to days; waiting "
            "removes most of that exposure.",
            f"- {ICON['capped']} **Capped** ({counts['capped']}) — the cooldown is not what is "
            "holding this back; a constraint in `requirements.txt` (or a transitive dependency's "
            "own pin) is. Loosening the range is the only way forward.",
            f"- {ICON['back']} **Backwards** ({counts['back']}) — a relock would move this to an "
            f"*older* release, because the current pin is itself younger than {cd} (a security "
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
        # --exclude-newer here too, for the same reason as in resolve(): uvx has to
        # resolve pip-audit ITSELF, and `tool` commands ignore project
        # configuration entirely (see UV_MIN above for the uv docs quote). So the
        # fallback without this flag is NOT "uv.toml's cooldown" — it is NO
        # project cooldown at all, plus whatever UV_EXCLUDE_NEWER the caller
        # happens to export. A stale value in a shell made this fail outright
        # once ("pip-audit was filtered by exclude-newer to only include packages
        # uploaded before 2016"), which is how the environment dependence
        # surfaced. Passing the project cooldown rather than "0 days" is
        # deliberate: pip-audit is code this script executes locally, so the
        # supply-chain argument for holding back fresh releases applies to it as much
        # as to the dependencies it inspects.
        proc = subprocess.run(
            # `uv tool run`, NOT `uvx`: uvx is a separate executable, so a newer
            # `uv` sitting beside an older standalone `uvx` would sail past
            # _require_uv(). Routing through the binary that was actually checked
            # closes that gap.
            #
            # `--exclude-newer` is REQUIRED here, not defensive: `tool` commands
            # ignore project configuration entirely (see UV_MIN above for the uv
            # docs quote), so uv.toml's cooldown does not apply to this install.
            # cwd=ROOT still matters for everything else uv reads.
            ["uv", "tool", "run", *(["--exclude-newer", _cut] if (_cut := cutoff()) else []),
             "pip-audit", "-r", str(tmp), "--no-deps", "--disable-pip",
             "--progress-spinner", "off", "-f", "json"],
            cwd=ROOT, capture_output=True, text=True,
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
           f"Release cooldown: **{cd}** — set by "
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

    _require_uv()   # before ANY uv/uvx subprocess — see UV_MIN above
    deps, total = run_audit(args.lock)
    md, count = build(deps, total)
    args.output.write_text(md, encoding="utf-8")
    print(md)
    sys.exit(1 if count else 0)


if __name__ == "__main__":
    main()
