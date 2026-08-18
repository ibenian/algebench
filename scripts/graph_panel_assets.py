"""Read a ``src/graph-panel`` ES module as JavaScript, whatever it is written in.

Two generators embed the graph-panel modules straight from source rather than
from the Vite bundle: ``semantic_graph_report.py`` copies them beside the
report it serves, and ``render_math.py`` inlines one into a ``<script
type="module">``. Both predate the TypeScript migration, which converts these
modules one phase at a time — so at any given commit a module may still be
``<name>.js`` or already be ``<name>.ts``.

This module hides that split. A ``.js`` source is returned verbatim; a ``.ts``
source is TYPE-ERASED by the project's own tsc: no type checking, no module
resolution, and import specifiers left byte-for-byte alone, so the
server-root-absolute imports (``/labels.js``) keep resolving exactly as they
did against the JavaScript original.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_GRAPH_PANEL_DIR = _PROJECT_ROOT / "src" / "graph-panel"

# Match tsconfig.json so the emitted JavaScript is what the app bundle ships.
_TSC_TARGET = "es2020"
_TSC_MODULE = "esnext"


def module_source_path(stem: str) -> Path:
    """Return the ``.js`` or ``.ts`` source for a graph-panel module."""
    js_src = _GRAPH_PANEL_DIR / f"{stem}.js"
    if js_src.exists():
        return js_src
    ts_src = _GRAPH_PANEL_DIR / f"{stem}.ts"
    if ts_src.exists():
        return ts_src
    raise FileNotFoundError(
        f"graph-panel module {stem!r} exists as neither .js nor .ts in {_GRAPH_PANEL_DIR}"
    )


def transpile(sources: list[Path], dest_dir: Path) -> None:
    """Type-erase every ``.ts`` path in *sources* into *dest_dir* as ``.js``.

    ``.js`` sources are the caller's business — pass only TypeScript here.
    """
    if not sources:
        return

    # tsc reports the unresolvable server-root-absolute imports (`/labels.js`)
    # as errors but still emits, so its exit status is not the success signal —
    # the emitted files are.
    subprocess.run(
        [
            "npx", "tsc", "--ignoreConfig",
            "--target", _TSC_TARGET, "--module", _TSC_MODULE,
            "--outDir", str(dest_dir),
            *(str(p) for p in sources),
        ],
        cwd=_PROJECT_ROOT,
        check=False,
        capture_output=True,
    )

    missing = [p.stem for p in sources if not (dest_dir / f"{p.stem}.js").exists()]
    if missing:
        raise RuntimeError(
            "tsc emitted nothing for graph-panel module(s): "
            + ", ".join(missing)
            + " — is Node installed? (`npx tsc` must be runnable from the repo root)"
        )


def stage(stems: list[str], dest_dir: Path) -> None:
    """Place each named graph-panel module into *dest_dir* as ``<stem>.js``."""
    import shutil

    ts_sources: list[Path] = []
    for stem in stems:
        src = module_source_path(stem)
        if src.suffix == ".js":
            shutil.copy2(src, dest_dir / f"{stem}.js")
        else:
            ts_sources.append(src)
    transpile(ts_sources, dest_dir)


def read_js(stem: str) -> str:
    """Return one graph-panel module's JavaScript source as text."""
    src = module_source_path(stem)
    if src.suffix == ".js":
        return src.read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        transpile([src], out)
        return (out / f"{stem}.js").read_text(encoding="utf-8")
