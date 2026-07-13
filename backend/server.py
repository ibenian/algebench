#!/usr/bin/env python3
"""
algebench - Interactive 3D Math Visualizer with AI Chat

Usage:
    algebench                        Launch empty viewer
    algebench scene.json             Launch with a scene file
    algebench --port 9000            Use custom port
"""

import sys
import json
import os
import re
import logging
import asyncio
import webbrowser
import builtins
from pathlib import Path
import threading
import time
import signal
import subprocess
import argparse
import tty
import termios
import select
from urllib.parse import quote
from fastapi import Depends, FastAPI, Request
from fastapi.responses import StreamingResponse, Response, JSONResponse, HTMLResponse, FileResponse
from pydantic import BaseModel
import uvicorn
from google import genai
from google.genai import types

script_dir = Path(__file__).parent.parent.resolve()
scenes_dir = script_dir / "scenes"
# Shareable built-in proof animations, served read-only to the /renderproof page.
# Treat every file here as untrusted input — the render path makes no trust
# assumptions about its contents. See docs/shareable-proof-animations.md.
proofs_dir = script_dir / "proofs"
_MAX_PROOF_BYTES = 2_000_000   # size cap for a served proof JSON (matches the client)

# ---------------------------------------------------------------------------
# Semantic-graph auto-derivation for proof steps missing explicit graphs.
# ---------------------------------------------------------------------------
from backend.model.semantic_graph import SemanticGraph, SemanticGraphNode
from backend.semantic_graph import SemanticGraphService
from backend.semantic_graph.preprocessor import LaTeXPreprocessor
from backend.semantic_graph.constants import _DOT_ACCENT_ORDERS

_graph_service = SemanticGraphService()
_strip_accent_commands = LaTeXPreprocessor.strip_accent_commands

# In-memory cache for Gemini-enriched semantic graphs. Key is sha256 of the
# input graph JSON (sorted keys); value is the enriched graph dict. Runtime
# only — cleared on restart.
_graph_enrich_cache: dict[str, dict] = {}
_graph_enricher = None


# ---------------------------------------------------------------------------
# Highlight metadata overlay + HTML class extraction (kept in server.py).
# ---------------------------------------------------------------------------


def _extract_htmlclass_pairs(latex: str) -> list[tuple[str, str]]:
    """Return ``[(class_key, body_latex), ...]`` for every ``\\htmlClass`` span.

    ``class_key`` drops the ``hl-`` prefix so it matches the keys in a step's
    ``highlights`` dict. Nested ``\\htmlClass`` wrappers are reported at the
    outer level only (the inner body still appears verbatim as the body).
    """
    if not isinstance(latex, str) or "\\htmlClass" not in latex:
        return []
    out: list[tuple[str, str]] = []
    i = 0
    while i < len(latex):
        # Look for \htmlClass{class}{body}
        if latex.startswith("\\htmlClass{", i):
            j = i + len("\\htmlClass{")
            # class token
            k = latex.find("}", j)
            if k == -1:
                break
            class_name = latex[j:k]
            # body — find matching brace
            if k + 1 >= len(latex) or latex[k + 1] != '{':
                i = k + 1
                continue
            b_start = k + 2
            depth = 1
            b = b_start
            while b < len(latex) and depth > 0:
                c = latex[b]
                if c == '{':
                    depth += 1
                elif c == '}':
                    depth -= 1
                    if depth == 0:
                        break
                b += 1
            body = latex[b_start:b]
            key = class_name[3:] if class_name.startswith("hl-") else class_name
            out.append((key, body.strip()))
            i = b + 1
        else:
            i += 1
    return out


def _apply_highlights_to_graph(
    graph: SemanticGraph,
    hl_pairs: list[tuple[str, str]],
    highlights_meta: dict,
) -> None:
    """Overlay step-level highlight metadata onto matching graph nodes.

    For each ``(class_key, body)`` pair harvested from the raw math, find the
    node whose latex/id matches ``body`` and annotate it with the highlight's
    ``color`` (paint override), human ``label`` (as ``description``), and the
    highlight's ``name`` — the key used in ``proofStep.highlights`` (e.g. the
    ``m`` in ``\\htmlClass{hl-m}{...}``). All three fields are defined on the
    semantic-graph node schema so annotated graphs still validate; ``highlight``
    is currently informational only and reserved for future visualizations.
    """
    if not graph or not hl_pairs or not isinstance(highlights_meta, dict):
        return
    nodes = graph.nodes

    def _normalize(s: str) -> str:
        """Normalize LaTeX for comparison — peel visual accents (``\\vec``,
        ``\\hat``, ``\\mathbf``, …) *and* dot-derivative wrappers
        (``\\dot``/``\\ddot``/...) so ``\\htmlClass{hl-mdot}{\\dot{m}}``
        still matches the graph's ``m`` variable node after the dot→frac
        pre-parse rewrite. Braces single-char sub/super-scripts (``v_e`` →
        ``v_{e}``, ``x^2`` → ``x^{2}``) and strips spaces so both author and
        sympy.latex forms match.
        """
        if not isinstance(s, str):
            return ""
        s = _strip_accent_commands(s)
        prev = None
        while prev != s:
            prev = s
            for cmd in _DOT_ACCENT_ORDERS:
                s = re.sub(rf"\\{cmd}\{{([^{{}}]*)\}}", r"\1", s)
        s = re.sub(r"_([A-Za-z0-9])(?![A-Za-z0-9_{])", r"_{\1}", s)
        s = re.sub(r"\^([A-Za-z0-9])(?![A-Za-z0-9_{])", r"^{\1}", s)
        return s.replace(" ", "")

    def _keys_for_node(n: SemanticGraphNode) -> list[str]:
        """Candidate normalized strings a highlight body might match against."""
        keys: list[str] = []
        for f in ("latex", "id", "subexpr"):
            v = getattr(n, f, None)
            if isinstance(v, str):
                keys.append(_normalize(v))
        return keys

    for class_key, body in hl_pairs:
        body = _normalize(body)
        meta = highlights_meta.get(class_key)
        if not isinstance(meta, dict):
            continue
        matched = None
        for node in nodes:
            if node.type in ("operator", "relation"):
                continue
            if body in _keys_for_node(node):
                matched = node
                break
        if matched is None:
            for node in nodes:
                if node.type not in ("operator", "relation", "expression", "function"):
                    continue
                if body in _keys_for_node(node):
                    matched = node
                    break
        if matched is None:
            continue
        if "color" in meta and not matched.color:
            matched.color = meta["color"]
        if meta.get("label") and not matched.description:
            matched.description = meta["label"]
        if not matched.highlight:
            matched.highlight = class_key


def _strip_html_class(latex: str) -> str:
    """Remove `\\htmlClass{...}{...}` wrappers, keeping only the inner body.

    AlgeBench scenes annotate math with `\\htmlClass{hl-X}{...}` for
    step-highlighting. These cannot be parsed by SymPy's LaTeX parser, so we
    strip them before handing the expression off to the graph builder.
    """
    if not isinstance(latex, str) or "\\htmlClass" not in latex:
        return latex
    out = []
    i = 0
    prefix = "\\htmlClass{"
    while i < len(latex):
        # Keep this parser regex-free; CodeQL #31 flagged repeated regex
        # matching here as a potential ReDoS risk.
        # https://github.com/ibenian/algebench/security/code-scanning/31
        if not latex.startswith(prefix, i):
            out.append(latex[i])
            i += 1
            continue
        # We're at `\htmlClass{class}{` — find matching `}` for the body.
        class_start = i + len(prefix)
        class_end = latex.find("}", class_start)
        if (
            class_end == -1
            or class_end + 1 >= len(latex)
            or latex[class_end + 1] != "{"
        ):
            out.append(latex[i])
            i += 1
            continue
        i = class_end + 2
        depth = 1
        while i < len(latex) and depth > 0:
            c = latex[i]
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    break
            out.append(c)
            i += 1
        i += 1  # skip closing `}`
    return ''.join(out)


def _normalize_proofs(proof_field: object) -> list[dict]:
    """Normalize a proof field (single object, array, or ``None``) into a list.

    Inspired by ``normalizeProofs`` in ``static/proof.js``, but stricter:
    non-dict items inside an array are filtered out, and unrecognised shapes
    return ``[]`` instead of wrapping blindly.  This keeps the server-side
    autofill resilient to unexpected scene content.
    """
    if proof_field is None:
        return []
    if isinstance(proof_field, list):
        return [p for p in proof_field if isinstance(p, dict)]
    if isinstance(proof_field, dict):
        return [proof_field]
    return []


def _autofill_semantic_graphs(scene: dict) -> dict:
    """Walk a scene spec and populate missing ``semanticGraph`` fields in-place.

    Clears the graph cache first so edits to the source JSON are always
    reflected without restarting the server.

    For each proof step that has ``math`` but no ``semanticGraph``, attempt to
    derive a graph via ``backend.semantic_graph`` and attach it under the
    standard ``{"graph": {...}}`` wrapper.

    When derivation fails (exception or returns ``None``), attach an
    ``error`` record inside ``semanticGraph`` so the UI can surface the
    problem instead of silently showing the empty-state placeholder. Issue
    #137.

    Returns the same dict for chaining. Silently skips anything that doesn't
    look like a scene with proofs — safe to call on any JSON.
    """
    _graph_service.clear_cache()
    if not isinstance(scene, dict):
        return scene
    scenes_list = scene.get('scenes')
    if not isinstance(scenes_list, list):
        return scene
    # Cap eager (load-time) derivations: each parse costs real CPU, and a
    # large lesson can carry dozens of proof steps — deriving them all up
    # front stalls server startup / scene load for tens of seconds. Steps
    # beyond the cap are left without a ``semanticGraph`` so the Graph tab
    # derives them on demand via POST /api/graph/from-latex when opened.
    # Default 10; override with ALGEBENCH_GRAPH_AUTOFILL_LIMIT (0 disables
    # eager derivation entirely, negative means unlimited).
    try:
        limit = int(os.environ.get('ALGEBENCH_GRAPH_AUTOFILL_LIMIT', '10'))
    except ValueError:
        limit = 10
    filled = 0
    failed = 0
    deferred = 0
    for sc in scenes_list:
        if not isinstance(sc, dict):
            continue
        for proof in _normalize_proofs(sc.get('proof')):
            steps = proof.get('steps')
            if not isinstance(steps, list):
                continue
            for step in steps:
                if not isinstance(step, dict):
                    continue
                sg = step.get('semanticGraph')
                if isinstance(sg, dict) and sg.get('graph'):
                    continue
                math_src = step.get('math')
                if not math_src or not isinstance(math_src, str):
                    continue
                if limit >= 0 and (filled + failed) >= limit:
                    # Over the eager budget — leave the step untouched so the
                    # Graph tab lazily derives it when opened.
                    deferred += 1
                    continue
                # Capture highlight bindings (\htmlClass{hl-X}{body}) BEFORE the
                # wrappers are stripped so we can map the class back to a node.
                hl_pairs = _extract_htmlclass_pairs(math_src)
                cleaned = _strip_html_class(math_src)
                error_reason = None
                error_message = None
                try:
                    graph = _graph_service.latex_to_graph(cleaned)
                except Exception as e:
                    print(f"   ⚠️  auto-graph crashed for {math_src!r}: {e}")
                    graph = None
                    error_reason = 'parse_crashed'
                    details = str(e).strip()
                    if details:
                        error_message = (
                            'Parser crashed while processing this expression: '
                            f'{details}'
                        )
                    else:
                        error_message = 'Parser crashed while processing this expression'
                if graph:
                    _apply_highlights_to_graph(
                        graph, hl_pairs, step.get('highlights') or {},
                    )
                    step['semanticGraph'] = {'graph': graph.model_dump(by_alias=True, exclude_none=True)}
                    filled += 1
                else:
                    if error_reason is None:
                        error_reason = 'parse_failed'
                        error_message = (
                            'Parser could not derive a semantic graph for '
                            'this expression (unsupported LaTeX construct '
                            'or empty result).'
                        )
                    step['semanticGraph'] = {'error': {
                        'reason': error_reason,
                        'message': error_message,
                        'math': math_src,
                    }}
                    failed += 1
    if filled or failed or deferred:
        title = scene.get('title') or '(scene)'
        parts = [f"auto-derived {filled} semantic graph(s)"]
        if failed:
            parts.append(f"{failed} failed")
        if deferred:
            parts.append(f"{deferred} deferred to on-demand")
        print(f"   ✨ {', '.join(parts)} for {title}")
    return scene

try:
    from gemini_live_tools import GeminiLiveAPI, pcm_to_wav_bytes, get_static_content as _glt_static, _split_sentences
    TTS_AVAILABLE = True
except ImportError:
    _glt_static = None
    TTS_AVAILABLE = False
static_dir   = script_dir / "static"
chat_js_path = static_dir / "chat.js"
version_file_path = script_dir / "VERSION"


_VERSION_RE = re.compile(r"^v?(\d+\.\d+\.\d+)$")


def get_app_version() -> str:
    """Read and validate the application version from the root VERSION file.

    The VERSION file (a plain ``MAJOR.MINOR.PATCH`` string) is the single
    source of truth for the version shown in the in-app About pill and bumped
    by the `algebench-release` skill. The value is injected verbatim into
    ``index.html``, so it is strictly validated here — a missing, unreadable, or
    malformed file (stray quotes, extra text, leading ``v``) degrades to "dev"
    rather than emitting an invalid/unsafe HTML attribute.
    """
    try:
        raw = version_file_path.read_text(encoding="utf-8").strip()
    except OSError:
        return "dev"
    m = _VERSION_RE.match(raw)
    return m.group(1) if m else "dev"

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
GEMINI_MODEL   = os.environ.get('GEMINI_MODEL', 'gemini-3-flash-preview')


def _env_bool(name: str, default: bool) -> bool:
    """Parse a boolean env var. Accepts 1/true/yes/on (and 0/false/no/off),
    case-insensitive; falls back to *default* when unset or unrecognized."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    val = raw.strip().lower()
    if val in ('1', 'true', 'yes', 'on'):
        return True
    if val in ('0', 'false', 'no', 'off'):
        return False
    return default


# Honor the PORT env var (used by preview/auto-port harnesses) as the default,
# falling back to the canonical 8785 for normal CLI use. An explicit --port flag
# still overrides this. Parse defensively so a non-numeric PORT can't crash import.
def _default_port():
    val = os.environ.get("PORT")
    if val:
        try:
            return int(val)
        except (ValueError, TypeError):
            pass
    return 8785

DEFAULT_PORT = _default_port()

index_html_path = static_dir / "index.html"
style_css_path  = static_dir / "style.css"

# ---------------------------------------------------------------------------
from backend.util import sanitize_path, limiter_from_env, rate_limit_dependency  # noqa: E402
from backend.proof_api import build_proof_router  # noqa: E402

# Per-IP rate limits for billable (Gemini-backed) endpoints. Override via env
# as "count/seconds", e.g. ALGEBENCH_RATELIMIT_CHAT="10/60". Limits protect the
# Gemini spend on a public, unauthenticated deployment; the app is otherwise open.
_chat_rate_limit = rate_limit_dependency(limiter_from_env("ALGEBENCH_RATELIMIT_CHAT", 20, 60))
_tts_rate_limit = rate_limit_dependency(limiter_from_env("ALGEBENCH_RATELIMIT_TTS", 20, 60))
# One shared limiter for ALL agentic/LM work (graph enrichment + the generic
# expert endpoint). The backend is shared by many clients, so this is per-IP,
# never a global cap.
_agentic_rate_limit = rate_limit_dependency(limiter_from_env("ALGEBENCH_RATELIMIT_AGENTIC", 60, 60))


# --- Expert framework: lazy one-time DSPy config + registry discovery --------
_experts_ready = False
_experts_lock = threading.Lock()


def _ensure_experts() -> None:
    """Configure DSPy and discover experts/handlers exactly once (idempotent).

    Lazy so a missing GEMINI key never breaks startup — the first
    ``/api/expert`` request pays the one-time cost. Safe to call from a worker
    thread; ``init_experts`` itself is import-cached, the lock just avoids a
    redundant first-call race.
    """
    global _experts_ready
    if _experts_ready:
        return
    with _experts_lock:
        if _experts_ready:
            return
        from backend.experts import init_experts
        init_experts()
        _experts_ready = True


def _safe_open_scene_path(source) -> Path:
    """Resolve source to a safe path under script_dir or scenes_dir."""
    name = str(source)
    for root in (scenes_dir, script_dir):
        path = sanitize_path(root, name)
        if path and path.is_file():
            return path
    raise ValueError(f"Path outside allowed directories: {source}")


def _load_scene(source, *, trusted: bool = False) -> dict:
    """Load a scene from a file path or dict, autofill semantic graphs, return spec.

    Raises on I/O or parse errors — callers decide how to handle.
    When trusted=True, skip path confinement (for CLI-provided paths).
    """
    if isinstance(source, dict):
        spec = source
    else:
        if trusted:
            path = Path(source).resolve()  # CodeQL [py/path-injection] trusted=True only used for CLI-provided paths, not user HTTP input
        else:
            path = _safe_open_scene_path(source)
        with open(path, 'r') as f:  # CodeQL [py/path-injection] path is either trusted (CLI) or confined by _safe_open_scene_path
            spec = json.load(f)
    _autofill_semantic_graphs(spec)
    return spec


# Agent session memory — persists across turns within one server session.
# Stores eval_math results (and anything else) under agent-chosen keys.
# Cleared on server start; agents control what's stored via store_as param.
# ---------------------------------------------------------------------------
_agent_memory: dict = {}


def print(*args, **kwargs):
    """Best-effort logging: detached stdout/stderr should not break request handling."""
    try:
        return builtins.print(*args, **kwargs)
    except BrokenPipeError:
        return None
    except UnicodeEncodeError:
        # e.g. lone UTF-16 surrogates from truncated emoji in client payloads
        safe = [str(a).encode("utf-8", "replace").decode("utf-8", "replace") for a in args]
        try:
            return builtins.print(*safe, **kwargs)
        except Exception:
            return None
    except OSError as e:
        if getattr(e, "errno", None) == 32:
            return None
        raise


def _memory_summary(key: str, value) -> str:
    """Human-readable one-liner describing a stored value."""
    if isinstance(value, list):
        if value and isinstance(value[0], list):
            return f"list of {len(value)} lists (e.g. {len(value[0])}-element)"
        return f"list [{len(value)} items]"
    if isinstance(value, (int, float)):
        return f"scalar {value}"
    return str(type(value).__name__)


def _resolve_memory_refs(obj):
    """Recursively replace '$key' strings with values from _agent_memory."""
    if isinstance(obj, str) and obj.startswith('$'):
        key = obj[1:]
        if key in _agent_memory:
            return _agent_memory[key]
        return obj  # unknown key — leave as-is
    if isinstance(obj, dict):
        return {k: _resolve_memory_refs(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_resolve_memory_refs(item) for item in obj]
    return obj


def kill_server_on_port(port):
    """Kill any process using the specified port."""
    try:
        result = subprocess.run(
            ['lsof', '-ti', f':{port}'],
            capture_output=True, text=True
        )
        if result.stdout.strip():
            pids = result.stdout.strip().split('\n')
            for pid in pids:
                try:
                    os.kill(int(pid), signal.SIGTERM)
                    print(f"Stopped previous server (PID: {pid})")
                except (ProcessLookupError, ValueError):
                    pass
            elapsed = 0
            while elapsed < 3:
                check = subprocess.run(['lsof', '-ti', f':{port}'],
                                       capture_output=True, text=True)
                if not check.stdout.strip():
                    break
                time.sleep(0.1)
                elapsed += 0.1
    except Exception:
        pass


def list_builtin_scenes():
    """Return list of built-in scene names."""
    if not scenes_dir.exists():
        return []
    return sorted([
        f.stem for f in scenes_dir.glob("*.json")
    ])


def load_builtin_scene(name):
    """Load a built-in scene JSON by name."""
    # Charset/null-byte hygiene + confinement handled by sanitize_path.
    path = sanitize_path(scenes_dir, f"{name}.json") if name else None
    if path and path.is_file():
        # Already confined by sanitize_path — load directly.
        return _load_scene(path, trusted=True)
    return None


def resolve_scene_path(scene_arg):
    """Resolve scene path from CLI/API input."""
    if not scene_arg:
        return None
    raw = str(scene_arg)
    candidate = Path(raw).expanduser()
    candidates = [candidate]
    if not candidate.is_absolute():
        candidates = [Path.cwd() / candidate, script_dir / candidate, scenes_dir / candidate]
    for path in candidates:
        if path.exists() and path.is_file():
            return path.resolve()
    return None


def resolve_scene_path_safe(scene_arg):
    """Resolve a scene path confined to scenes_dir, for untrusted API input.

    Scene files may *only* be read from ``scenes/`` and must be ``.json``.
    Accepts a bare filename (``foo.json``) or a project-root-relative path
    (``scenes/foo.json``). Everything else — ``~`` expansion, absolute
    paths, traversal, null bytes, and non-``.json`` files — yields ``None``,
    so arbitrary JSON elsewhere in the repo (e.g. ``.claude/launch.json``)
    is never served.

    All input hygiene and confinement is delegated to ``sanitize_path``
    (empty/null-byte/charset rejection, ``~`` rejection, absolute-path
    rejection, ``..`` rejection, and ``is_relative_to`` confinement that also
    defeats symlink escapes). The only thing added here is the object-specific
    shape: a final ``scenes_dir`` confinement + ``.json`` gate, so that even
    when ``script_dir`` is used as a lookup base the result can only ever live
    inside ``scenes/``.
    """
    if not scene_arg:
        return None
    raw = str(scene_arg)
    scenes_root = scenes_dir.resolve()
    # Try the input as a name within scenes/ and as a project-root-relative
    # path ("scenes/foo.json"); confine the result to scenes/ and .json.
    for base in (scenes_dir, script_dir):
        candidate = sanitize_path(base, raw)
        if not candidate:
            continue
        if candidate.suffix.lower() != '.json':
            continue
        if not candidate.is_relative_to(scenes_root):
            continue
        if candidate.is_file():
            return candidate
    return None


FAVICON_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="15" fill="#1a1a2e"/>
<line x1="20" y1="75" x2="80" y2="75" stroke="#ff4444" stroke-width="4"/>
<line x1="20" y1="75" x2="20" y2="15" stroke="#44ff44" stroke-width="4"/>
<line x1="20" y1="75" x2="55" y2="50" stroke="#4488ff" stroke-width="4"/>
<line x1="20" y1="75" x2="70" y2="30" stroke="#ffaa00" stroke-width="5" stroke-linecap="round"/>
<circle cx="70" cy="30" r="4" fill="#ffaa00"/>
</svg>'''


def generate_html(debug=False, skip_tour=False):
    """Read index.html and inject the debug + skip-tour flags."""
    debug_mode_js = "true" if debug else "false"
    skip_tour_js = "true" if skip_tour else "false"
    with open(index_html_path, 'r') as f:
        return (f.read()
                .replace('__DEBUG_MODE__', debug_mode_js)
                .replace('__SKIP_TOUR__', skip_tour_js)
                .replace('__APP_VERSION__', get_app_version()))

from backend.agent_tools import (
    ALL_TOOL_DECLS, _make_tools, build_system_prompt,
    NAVIGATE_TOOL_DECL, SET_CAMERA_TOOL_DECL, ADD_SCENE_TOOL_DECL,
    SET_SLIDERS_TOOL_DECL, EVAL_MATH_TOOL_DECL,
    MEM_GET_TOOL_DECL, MEM_SET_TOOL_DECL,
    SET_PRESET_PROMPTS_TOOL_DECL, SET_INFO_OVERLAY_TOOL_DECL,
)
from gemini_live_tools import safe_eval_math, eval_math_sweep, MATH_NAMES, HAS_NUMPY


# Lazy-initialized Gemini client
_gemini_client = None

def get_gemini_client():
    global _gemini_client
    if _gemini_client is None and GEMINI_API_KEY:
        _gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    return _gemini_client


def _detect_navigation(message, context):
    """Detect simple navigation commands and return (scene, step, direction) or None."""
    msg = message.strip().lower()
    nav_next = msg in ('next', 'next step', 'continue', 'go on', 'forward', 'n')
    nav_prev = msg in ('previous', 'prev', 'back', 'go back', 'previous step', 'p')
    if not nav_next and not nav_prev:
        return None

    scene_num = context.get('sceneNumber', 1)
    runtime = context.get('runtime', {})
    current_step = runtime.get('stepNumber', 0)  # 0=root, 1=first step
    scene = context.get('currentScene', {})
    total_steps = len(scene.get('steps', []))

    if nav_next:
        target_step = current_step + 1
        if target_step > total_steps:
            # At last step — try next scene
            total_scenes = context.get('totalScenes', 1)
            if scene_num < total_scenes:
                return (scene_num + 1, 0, 'next_scene')
            return None  # nowhere to go
        return (scene_num, target_step, 'next')
    else:  # nav_prev
        target_step = current_step - 1
        if target_step < 0:
            # At root — try previous scene
            if scene_num > 1:
                return (scene_num - 1, 0, 'prev_scene')
            return None
        return (scene_num, target_step, 'prev')


def _extract_inline_preset_prompts(text, tool_calls):
    """Detect {"prompts": [...]} JSON embedded in text by Gemini instead of a tool call.
    Strips it from the text and appends a synthetic set_preset_prompts tool call entry."""
    import re
    match = re.search(r'\{[^{}]*"prompts"\s*:\s*\[[^\]]*\][^{}]*\}', text, re.DOTALL)
    if not match:
        return text
    try:
        obj = json.loads(match.group(0))
        prompts = obj.get('prompts')
        if not isinstance(prompts, list):
            return text
    except (json.JSONDecodeError, ValueError):
        return text
    print(f"   ⚠️  Gemini wrote set_preset_prompts as inline JSON — recovering: {prompts}")
    tool_calls.append({
        "name": "set_preset_prompts",
        "rawArgs": {"prompts": prompts},
        "args": {"prompts": prompts},
        "result": {"status": "success", "count": len(prompts),
                   "message": f"Set {len(prompts)} preset prompt{'s' if len(prompts) != 1 else ''}."},
    })
    cleaned = (text[:match.start()] + text[match.end():]).strip()
    return cleaned


def call_gemini_chat(message, history, context):
    """Call Gemini API using google-genai SDK. Returns (response_text, tool_calls_list, debug_info)."""
    client = get_gemini_client()
    if not client:
        return "AI chat is not available (no API key configured).", [], {}

    # Handle simple navigation deterministically — don't rely on the agent
    nav = _detect_navigation(message, context)
    if nav:
        scene_num, step_num, direction = nav
        current_scene = context.get('currentScene', {})

        # For same-scene navigation, use current scene data.
        # For cross-scene, look up the target scene from the scene tree.
        scene_tree = context.get('sceneTree', [])
        if direction in ('next_scene', 'prev_scene'):
            # Get target scene info from scene tree
            target_idx = scene_num - 1
            if 0 <= target_idx < len(scene_tree):
                tree_entry = scene_tree[target_idx]
                step_title = tree_entry.get('title', '')
                step_desc = ''
                steps = tree_entry.get('steps', [])
            else:
                step_title = ''
                step_desc = ''
                steps = []
        else:
            steps = current_scene.get('steps', [])
            if step_num == 0:
                step_title = current_scene.get('title', '')
                step_desc = current_scene.get('description', '')
            elif 1 <= step_num <= len(steps):
                s = steps[step_num - 1]
                step_title = s.get('title', '')
                step_desc = s.get('description', '')
            else:
                step_title = ''
                step_desc = ''

        tc_result = {"status": "success", "navigated": True,
                     "scene": scene_num, "step": step_num}
        tool_calls = [{"name": "navigate_to", "args": {"scene": scene_num, "step": step_num}, "result": tc_result}]

        # Update context to reflect the navigation target so the system prompt is current
        context['sceneNumber'] = scene_num
        if 'runtime' not in context:
            context['runtime'] = {}
        context['runtime']['stepNumber'] = step_num

        # Rewrite navigation command into an explanation request.
        # The agent sees the updated Current State and knows what step it's on.
        explain_prompt = "What am I looking at now?"

        # Build system prompt with updated context
        system_prompt = build_system_prompt(context, agent_memory=_agent_memory)
        contents = []
        for msg in (history or []):
            role = 'user' if msg.get('role') == 'user' else 'model'
            contents.append(types.Content(role=role, parts=[types.Part.from_text(text=msg.get('text', ''))]))
        contents.append(types.Content(role='user', parts=[types.Part.from_text(text=explain_prompt)]))

        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            tools=_make_tools('navigate_to'),
            temperature=0.7,
        )
        print(f"   ⏩ Auto-navigation: scene {scene_num}, step {step_num} ({direction})")

        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=contents,
                config=config,
            )
            text = ""
            if response.candidates and response.candidates[0].content.parts:
                text = "".join(p.text for p in response.candidates[0].content.parts if p.text)
            debug_info = {"systemPrompt": system_prompt, "contents": [c.to_json_dict() for c in contents]}
            return text.strip() or "Let me walk you through this step.", tool_calls, debug_info
        except Exception as e:
            return f"Navigated to step {step_num}.", tool_calls, {}

    system_prompt = build_system_prompt(context, agent_memory=_agent_memory)

    # Build contents list
    contents = []
    for msg in (history or []):
        role = 'user' if msg.get('role') == 'user' else 'model'
        contents.append(types.Content(role=role, parts=[types.Part.from_text(text=msg.get('text', ''))]))

    # Add current user message
    contents.append(types.Content(role='user', parts=[types.Part.from_text(text=message)]))

    # Log history summary
    if DEBUG_MODE:
        for i, msg in enumerate(history or []):
            preview = (msg.get('text', '') or '')[:80].replace('\n', ' ')
            print(f"   💬 history[{i}] {msg.get('role','?')}: {preview}")
        print(f"   💬 current: {message[:80]}")

    tool_calls = []
    added_scenes_count = 0
    max_turns = 10

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        tools=_make_tools(),
        temperature=0.7,
    )

    # Build debug payload — the full picture of what Gemini sees
    debug_info = {
        "systemPrompt": system_prompt,
        "contents": [c.to_json_dict() for c in contents],
    }

    # Log request summary
    if DEBUG_MODE:
        tool_names = [d.name for d in config.tools[0].function_declarations] if config.tools else []
        print(f"   🤖 Gemini request: model={GEMINI_MODEL}, {len(contents)} messages, tools=[{', '.join(tool_names)}], system_prompt={len(system_prompt)} chars")

    if DEBUG_MODE:
        print(f"\n🤖 GEMINI REQUEST: {json.dumps({'model': GEMINI_MODEL, **debug_info})}\n")

    for turn in range(max_turns):
        if turn > 0:
            print(f"   🔄 Gemini turn {turn + 1}/{max_turns} ({len(contents)} messages)")
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=contents,
                config=config,
            )
        except Exception as e:
            print(f"   ❌ Gemini API error: {e}", flush=True)
            return "Sorry, I encountered an error processing your request. Please try again.", [], debug_info

        # Log finish reason for debugging
        finish = None
        if response.candidates:
            candidate = response.candidates[0]
            finish = getattr(candidate, 'finish_reason', None)
            if DEBUG_MODE and finish:
                print(f"   Gemini finish_reason: {finish}")
            if str(finish) not in ('MAX_TOKENS', 'STOP', 'FinishReason.MAX_TOKENS', 'FinishReason.STOP'):
                print(f"   ⚠️  Unexpected finish_reason: {finish}")

        if not response.candidates:
            return "", tool_calls, debug_info

        parts = response.candidates[0].content.parts
        if not parts:
            print(f"   ⚠️  Empty parts (Gemini returned STOP with no content) — nudging to respond")
            contents.append(types.Content(role='model', parts=[types.Part.from_text(text="(no response)")]))
            contents.append(types.Content(role='user', parts=[types.Part.from_text(
                text="Please respond to my request.")]))
            continue

        # Log all response parts for debugging
        if DEBUG_MODE:
            for i, p in enumerate(parts):
                if p.text:
                    print(f"   📝 part[{i}].text: {p.text}")
                if p.function_call:
                    fc = p.function_call
                    print(f"   🔧 part[{i}].function_call: {fc.name}({json.dumps(dict(fc.args) if fc.args else {}, default=str)[:300]})")
                if not p.text and not p.function_call:
                    print(f"   ❓ part[{i}] unknown: {str(p)[:300]}")

        # Handle malformed function call — retry
        if str(finish) in ('MALFORMED_FUNCTION_CALL', 'FinishReason.MALFORMED_FUNCTION_CALL'):
            print(f"   ❌ Malformed function call — asking Gemini to retry")
            contents.append(types.Content(role='model', parts=parts))
            contents.append(types.Content(role='user', parts=[types.Part.from_text(
                text="Your previous function call was malformed. Please respond with plain text instead, or retry the tool call with valid JSON arguments.")]))
            continue

        # Check for function calls vs text. Gemini may return multiple function calls
        # in a single turn; execute all of them in order.
        function_calls = []
        text_response = ""
        for part in parts:
            if part.function_call:
                function_calls.append(part.function_call)
            if part.text:
                text_response += part.text

        if function_calls:
            # Preserve the model response (including thought_signature) once.
            contents.append(types.Content(role='model', parts=parts))
            must_continue = False

            for fc in function_calls:
                tc_name = fc.name

                # Convert args to plain Python dict (handle proto objects)
                tc_args = {}
                if fc.args:
                    # Try multiple conversion strategies for proto Struct/MapComposite
                    raw_args = fc.args
                    if hasattr(raw_args, 'model_dump'):
                        tc_args = raw_args.model_dump()
                    elif hasattr(raw_args, 'to_json_dict'):
                        tc_args = raw_args.to_json_dict()
                    elif isinstance(raw_args, dict):
                        tc_args = dict(raw_args)
                    else:
                        tc_args = dict(raw_args)

                    # Deep-convert any remaining proto objects to plain Python types
                    def _to_plain(obj):
                        if isinstance(obj, (str, int, float, bool, type(None))):
                            return obj
                        if isinstance(obj, dict):
                            return {k: _to_plain(v) for k, v in obj.items()}
                        if isinstance(obj, (list, tuple)):
                            return [_to_plain(v) for v in obj]
                        # Proto MapComposite, RepeatedComposite, etc.
                        if hasattr(obj, 'items'):
                            return {k: _to_plain(v) for k, v in obj.items()}
                        if hasattr(obj, '__iter__'):
                            return [_to_plain(v) for v in obj]
                        return str(obj)

                    tc_args = _to_plain(tc_args)
                raw_tc_args = json.loads(json.dumps(tc_args, default=str))

                # Log the full tool call JSON
                if DEBUG_MODE:
                    print(f"\n🔧 TOOL CALL: {tc_name}")
                    try:
                        print(json.dumps(tc_args, indent=2, ensure_ascii=True, default=str))
                    except Exception as log_err:
                        print(f"   (could not serialize args: {log_err})")
                        print(f"   args keys: {list(tc_args.keys())}")

                # For add_scene: the scene properties are now top-level args (not nested under "scene")
                if tc_name == 'add_scene':
                    # Resolve $key memory references in element fields before building the scene
                    tc_args = _resolve_memory_refs(tc_args)
                    # Unwrap if agent nested the scene under a "scene" key (common hallucination)
                    if isinstance(tc_args.get('scene'), dict) and 'title' in tc_args.get('scene', {}):
                        print(f"   ⚠️  add_scene: agent wrapped scene under 'scene' key — unwrapping")
                        tc_args = {**tc_args['scene']}
                    # Build scene object from top-level args
                    scene_obj = {k: v for k, v in tc_args.items() if k not in ('_parseError',)}
                    # Normalize misplaced top-level sliders into the first step.
                    # Renderer only registers sliders from step.sliders.
                    normalized_root_sliders = False
                    root_sliders = scene_obj.get('sliders')
                    if isinstance(root_sliders, list) and len(root_sliders) > 0:
                        steps = scene_obj.get('steps')
                        if not isinstance(steps, list):
                            steps = []
                        if len(steps) == 0 or not isinstance(steps[0], dict):
                            steps.insert(0, {
                                "title": "Interactive Controls",
                                "description": "Adjust sliders to explore the scene interactively.",
                                "sliders": root_sliders
                            })
                        else:
                            first = steps[0]
                            existing = first.get('sliders')
                            if not isinstance(existing, list):
                                first['sliders'] = list(root_sliders)
                            else:
                                seen = {s.get('id') for s in existing if isinstance(s, dict)}
                                for s in root_sliders:
                                    if isinstance(s, dict) and s.get('id') not in seen:
                                        existing.append(s)
                        scene_obj['steps'] = steps
                        scene_obj.pop('sliders', None)
                        normalized_root_sliders = True
                        print(f"   ⚠️  add_scene: normalized {len(root_sliders)} root-level sliders into step 1")
                    tc_args['parsedScene'] = scene_obj
                    if normalized_root_sliders:
                        tc_args['_normalizedRootSliders'] = True
                    if DEBUG_MODE:
                        print(f"   ✅ scene object — {len(scene_obj.get('elements', []))} elements, "
                              f"{len(scene_obj.get('steps', []))} steps, title: {scene_obj.get('title', '?')}")
                # Track add_scene calls so navigate_to validation accounts for newly added scenes
                if tc_name == 'add_scene':
                    added_scenes_count = added_scenes_count + 1

                # Build tool result with context
                scene_count = len(context.get('sceneTree', [])) + added_scenes_count
                if tc_name == 'add_scene':
                    new_scene_num = scene_count  # 1-based number of the newly added scene
                    tc_result = {"status": "success", "newSceneNumber": new_scene_num,
                                 "message": f"Scene added as scene {new_scene_num}. The client will auto-navigate to it. Do NOT call navigate_to."}
                    if tc_args.get('_normalizedRootSliders'):
                        tc_result["note"] = "Moved top-level sliders into step 1 (renderer expects step.sliders)."
                elif tc_name == 'navigate_to':
                    # Agent sends 1-based scene numbers
                    req_scene = int(tc_args.get('scene', 0))  # 1-based
                    req_step = int(tc_args.get('step', 0))
                    # Validate scene (1-based: valid range is 1 to scene_count)
                    if req_scene < 1 or req_scene > scene_count:
                        tc_result = {"status": "error",
                                     "error": f"Scene {req_scene} out of range. Valid: 1-{scene_count}. Check Lesson Structure in system prompt."}
                        print(f"   ❌ navigate_to: scene {req_scene} out of bounds (1-{scene_count})")
                    elif req_step < 0:
                        tc_result = {"status": "error",
                                     "error": f"Step {req_step} invalid. Use 0 for root, 1 for first step, etc."}
                        print(f"   ❌ navigate_to: step {req_step} is negative")
                    else:
                        # Get step count for validation
                        scene_tree = context.get('sceneTree', [])
                        scene_idx_0 = req_scene - 1  # convert to 0-based for lookup
                        target_scene_steps = 0
                        if 0 <= scene_idx_0 < len(scene_tree):
                            target_scene_steps = len(scene_tree[scene_idx_0].get('steps', []))
                        if target_scene_steps > 0 and req_step > target_scene_steps:
                            tc_result = {"status": "error",
                                         "error": f"Step {req_step} out of range for scene {req_scene}. Has {target_scene_steps} steps. Valid: 0 (root) to {target_scene_steps}."}
                            print(f"   ❌ navigate_to: step {req_step} > max {target_scene_steps} for scene {req_scene}")
                        else:
                            tc_result = {"status": "success", "navigated": True,
                                         "scene": req_scene, "step": req_step}
                            # Include target step content so the agent can explain it
                            scene_data = context.get('currentScene', {})
                            if req_scene == context.get('sceneNumber'):
                                # Same scene — use currentScene directly
                                target_scene = scene_data
                            else:
                                # Different scene — look up from scene tree (limited info)
                                target_scene = {}
                            steps = target_scene.get('steps', [])
                            if req_step == 0:
                                tc_result["stepDescription"] = target_scene.get('description', '')
                                tc_result["stepTitle"] = target_scene.get('title', '')
                            elif 1 <= req_step <= len(steps):
                                step = steps[req_step - 1]
                                tc_result["stepDescription"] = step.get('description', '')
                                tc_result["stepTitle"] = step.get('title', '')
                elif tc_name == 'set_sliders':
                    values = tc_args.get('values', {})
                    available = context.get('runtime', {}).get('sliders', {})
                    results = {}
                    for sid, target in values.items():
                        if sid not in available:
                            results[sid] = {"status": "error", "error": f"Unknown slider '{sid}'"}
                        else:
                            s = available[sid]
                            clamped = max(s['min'], min(s['max'], float(target)))
                            results[sid] = {"status": "ok", "from": s['value'], "to": clamped}
                    tc_result = {"status": "success", "sliders": results}
                elif tc_name == 'eval_math':
                    expr = tc_args.get('expression', '')
                    raw_vars = tc_args.get('variables') or {}
                    # Strip spurious surrounding quotes from variable names (agent sometimes double-quotes keys)
                    variables = {k.strip("\"'"): v for k, v in raw_vars.items()}
                    # Convert new flat sweep shape {var, start, end, steps} or {var, values}
                    # into the internal format {var_name: spec} expected by eval_math_sweep
                    sweep_raw = tc_args.get('sweep') or None
                    sweep_var = tc_args.get('sweep_var') or None
                    if sweep_var:
                        if tc_args.get('sweep_values'):
                            sweep = {sweep_var: tc_args['sweep_values']}
                        elif 'sweep_start' in tc_args and 'sweep_end' in tc_args:
                            sweep = {sweep_var: {
                                'start': tc_args['sweep_start'],
                                'end':   tc_args['sweep_end'],
                                'steps': tc_args.get('sweep_steps', 64),
                            }}
                        else:
                            sweep = None
                    else:
                        sweep = None
                    store_as = tc_args.get('store_as') or None
                    # Auto-inject slider values and all agent memory keys as variables
                    for sid, s in context.get('runtime', {}).get('sliders', {}).items():
                        if sid not in variables:
                            variables[sid] = s['value']
                    for mem_key, mem_val in _agent_memory.items():
                        if mem_key not in variables:
                            variables[mem_key] = mem_val
                    if sweep:
                        result, error = eval_math_sweep(expr, variables, sweep)
                    else:
                        result, error = safe_eval_math(expr, variables)
                    if error:
                        tc_result = {"status": "error", "expression": expr, "error": error,
                                     "hint": "Fix the expression and call eval_math again, or call add_scene if you have enough data."}
                        print(f"   ❌ eval_math: {error}")
                    elif store_as:
                        _agent_memory[store_as] = result
                        summary = _memory_summary(store_as, result)
                        tc_result = {"status": "success", "stored_as": store_as, "summary": summary,
                                     "hint": f"Stored. Reference as variable '{store_as}' in eval_math, or as '${store_as}' in add_scene fields."}
                        if DEBUG_MODE:
                            print(f"   ✅ eval_math → memory['{store_as}']: {summary}")
                    else:
                        n = f"{len(result)}-point sweep" if isinstance(result, list) and sweep else result
                        tc_result = {"status": "success", "expression": expr, "result": result,
                                     "hint": "Tip: use store_as to save large arrays to memory instead of returning inline."}
                        if DEBUG_MODE:
                            print(f"   ✅ eval_math: {expr} = {n}")
                elif tc_name == 'mem_get':
                    key = tc_args.get('key', '')
                    if key == '?':
                        listing = {k: _memory_summary(k, v) for k, v in _agent_memory.items()}
                        tc_result = {"status": "success", "keys": listing if listing else "(empty)"}
                        if DEBUG_MODE:
                            print(f"   🗂️  mem_get(?): {list(_agent_memory.keys())}")
                    elif key in _agent_memory:
                        val = _agent_memory[key]
                        tc_result = {"status": "success", "key": key, "value": val,
                                     "summary": _memory_summary(key, val)}
                        if DEBUG_MODE:
                            print(f"   🗂️  mem_get('{key}'): {_memory_summary(key, val)}")
                    else:
                        tc_result = {"status": "error", "key": key,
                                     "error": f"Key '{key}' not found.",
                                     "available_keys": list(_agent_memory.keys())}
                        print(f"   ❌ mem_get('{key}'): not found")
                elif tc_name == 'mem_set':
                    key = tc_args.get('key', '')
                    value = tc_args.get('value')
                    if not key:
                        tc_result = {"status": "error", "error": "key is required"}
                    else:
                        _agent_memory[key] = value
                        summary = _memory_summary(key, value)
                        tc_result = {"status": "success", "stored_as": key, "summary": summary,
                                     "hint": f"Stored. Reference as variable '{key}' in eval_math, or as '${key}' in add_scene fields."}
                        if DEBUG_MODE:
                            print(f"   💾 mem_set['{key}']: {summary}")
                elif tc_name == 'set_preset_prompts':
                    prompts = tc_args.get('prompts', [])
                    tc_result = {
                        "status": "success",
                        "count": len(prompts),
                        "message": f"{'Set' if prompts else 'Cleared'} {len(prompts)} preset prompt{'s' if len(prompts) != 1 else ''}.",
                    }
                    if DEBUG_MODE:
                        print(f"   💬 set_preset_prompts: {prompts}")
                elif tc_name == 'set_info_overlay':
                    overlay_id = tc_args.get('id', '')
                    content = tc_args.get('content', '')
                    position = tc_args.get('position', 'top-left')
                    tc_result = {
                        "status": "success",
                        "id": overlay_id,
                        "position": position,
                        "message": f"Overlay '{overlay_id}' set at {position}.",
                    }
                    if DEBUG_MODE:
                        print(f"   🖼️  set_info_overlay['{overlay_id}'] @ {position}: {content[:60]}{'…' if len(content) > 60 else ''}")
                elif tc_name == 'clear_info_overlays':
                    tc_result = {"status": "success", "message": "Cleared all info overlays."}
                    if DEBUG_MODE:
                        print(f"   🖼️  clear_info_overlays: cleared all")
                elif tc_name == 'navigate_proof':
                    proof_step = int(tc_args.get('step', 0))
                    reason = tc_args.get('reason', '')
                    tc_result = {
                        "action": "navigate_proof",
                        "step": proof_step,
                        "reason": reason,
                    }
                    if DEBUG_MODE:
                        print(f"   📐 navigate_proof: step={proof_step} reason={reason}")
                elif tc_name == 'derive_proof_animation':
                    # Fire-and-forget: the client runs the SymPy-verified derivation
                    # (proof_animation handler) and docks it on the current step's
                    # graph. We only acknowledge — the steps never enter the chat.
                    target = (tc_args.get('target_latex') or '').strip()
                    reason = tc_args.get('reason', '')
                    # A derivation docks onto the current step's semantic graph. We
                    # only require that a graph EXISTS for the step — the client
                    # auto-switches to the Math view if it's hidden behind the 3D
                    # viewport. With no graph at all there's nothing to derive on, so
                    # tell the agent to send the user to a step that has one.
                    gp = (context.get('runtime') or {}).get('graphPanel') or {}
                    has_graph = bool(gp.get('hasGraph'))
                    if not has_graph:
                        tc_result = {"status": "error", "needsGraph": True,
                                     "error": ("This step has no semantic graph to derive on. Ask the user "
                                               "to navigate to a step that has one before deriving — do not "
                                               "call this tool again until then.")}
                    elif not target:
                        tc_result = {"status": "error",
                                     "error": "target_latex is required to derive."}
                    else:
                        tc_result = {
                            "status": "success",
                            "initiated": True,
                            "message": ("Derivation started on the graph — it will appear "
                                        "docked on the current step. Briefly tell the user "
                                        "you're deriving it; do NOT write the steps yourself."),
                        }
                    if DEBUG_MODE:
                        print(f"   ∴ derive_proof_animation: target={target[:60]!r} "
                              f"start={ (tc_args.get('start_latex') or '')[:40]!r} "
                              f"prompt={ (tc_args.get('prompt') or '')[:40]!r} reason={reason}")
                elif tc_name == 'control_coach':
                    # Client-executed: the browser drives the guided-tour Coach overlay.
                    action = tc_args.get('action', '')
                    step = tc_args.get('step', '')
                    tc_result = {
                        "status": "success",
                        "action": action,
                        "step": step,
                        "message": (f"Tour '{action}' done"
                                    + (f" (step: {step})" if step else "")
                                    + ". Briefly confirm to the user; the tour overlay reflects it."),
                    }
                    if DEBUG_MODE:
                        print(f"   🧭 control_coach: action={action!r} step={step!r}")
                else:
                    tc_result = {"status": "success"}
                tool_calls.append({
                    "name": tc_name,
                    "rawArgs": raw_tc_args,
                    "args": tc_args,
                    "result": tc_result,
                })

                # navigate_to: update context, rebuild system prompt, and strip navigate_to
                # from tools so the agent explains instead of double-navigating.
                if tc_name == 'navigate_to' and tc_result.get('status') == 'success':
                    # Update context to reflect new position (same as deterministic path)
                    req_scene = int(tc_args.get('scene', 0))
                    req_step = int(tc_args.get('step', 0))
                    context['sceneNumber'] = req_scene
                    if 'runtime' not in context:
                        context['runtime'] = {}
                    context['runtime']['stepNumber'] = req_step
                    # Rebuild system prompt with updated state
                    updated_prompt = build_system_prompt(context, agent_memory=_agent_memory)

                    tc_result["message"] = "Navigation done. Now explain what the user is seeing."
                    config = types.GenerateContentConfig(
                        system_instruction=updated_prompt,
                        tools=_make_tools('navigate_to'),
                        temperature=config.temperature,
                    )
                    must_continue = True

                # set_sliders: update context with new values, rebuild prompt, strip tool.
                if tc_name == 'set_sliders' and tc_result.get('status') == 'success':
                    if 'runtime' not in context:
                        context['runtime'] = {}
                    if 'sliders' not in context['runtime']:
                        context['runtime']['sliders'] = {}
                    for sid, res in tc_result.get('sliders', {}).items():
                        if res.get('status') == 'ok' and sid in context['runtime']['sliders']:
                            context['runtime']['sliders'][sid]['value'] = res['to']
                    updated_prompt = build_system_prompt(context, agent_memory=_agent_memory)
                    tc_result["message"] = "Sliders animated. Now explain what changed in the visualization."
                    remaining_decls = [d for d in config.tools[0].function_declarations if d.name != 'set_sliders']
                    config = types.GenerateContentConfig(
                        system_instruction=updated_prompt,
                        tools=[types.Tool(function_declarations=remaining_decls)] if remaining_decls else [],
                        temperature=config.temperature,
                    )
                    must_continue = True

                # eval_math with store_as requires another model turn so the agent can
                # use the stored value in subsequent calls or explanation.
                if tc_name == 'eval_math' and tc_args.get('store_as'):
                    must_continue = True

                # Feed each tool response back to Gemini in call order.
                contents.append(types.Content(role='user', parts=[
                    types.Part.from_function_response(name=tc_name, response=tc_result)
                ]))

            if text_response.strip() and not must_continue:
                text_response = _extract_inline_preset_prompts(text_response, tool_calls)
                return text_response, tool_calls, debug_info
            continue
        else:
            text_response = _extract_inline_preset_prompts(text_response, tool_calls)
            return text_response or "I'm not sure how to respond to that.", tool_calls, debug_info

    text_response = _extract_inline_preset_prompts(text_response, tool_calls)
    return text_response, tool_calls, debug_info


DEBUG_MODE = False

def create_app(initial_scene_path=None, debug=False, skip_tour=None,
               tts_parallelism=None, tts_min_buffer=None, tts_min_sentence_chars=None,
               tts_min_sentence_chars_growth=None, tts_chunk_timeout=None,
               tts_max_retries=None, tts_retry_delay=None, tts_style=None,
               tts_live=True, tts_output_file=None, tts_realtime=None):
    """Build and return the AlgeBench FastAPI (ASGI) application.

    All routes are registered here so the app can be served either by an
    external ASGI server (``uvicorn backend.asgi:app``) or by
    ``serve_and_open`` for the desktop launch flow.

    ``tts_realtime`` controls whether ``/api/tts/stream`` streams raw PCM from
    a single Live session (realtime) or buffered parallel WAV. When left as
    ``None`` (the ASGI entrypoint passes nothing) it is resolved from the
    ``ALGEBENCH_TTS_REALTIME`` env var, defaulting to realtime — so a hosted
    deploy matches the CLI default without code changes. An explicit
    ``True``/``False`` (e.g. from ``main()``) always wins over the env var.
    """
    global DEBUG_MODE
    DEBUG_MODE = debug

    # App logging. uvicorn runs at log_level="error" (quiet) and nothing else
    # configures the app loggers, so `backend.*` module logs — e.g. whether the
    # proof_completion expert loaded a compiled artifact or fell back to baseline,
    # and the per-attempt refinement dump — are otherwise dropped. Set up here (not
    # just in main()) so the uvicorn/asgi entrypoint gets it too. `debug` (CLI
    # --debug) forces DEBUG; otherwise default to INFO. Override with the
    # ALGEBENCH_LOG_LEVEL env var (e.g. staging sets it to DEBUG via render.yaml).
    # An unrecognized ALGEBENCH_LOG_LEVEL falls back to the same INFO default.
    _log_level = os.environ.get(
        "ALGEBENCH_LOG_LEVEL", "DEBUG" if debug else "INFO").upper()
    _applog = logging.getLogger("backend")
    if not any(isinstance(h, logging.StreamHandler) for h in _applog.handlers):
        _h = logging.StreamHandler()
        _h.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
        _applog.addHandler(_h)
    _applog.setLevel(getattr(logging, _log_level, logging.INFO))
    _applog.propagate = False

    # Suppress the auto-offered guided tour (handy for local debugging so the
    # Coach overlay doesn't pop up on every fresh load). ``None`` defers to the
    # ALGEBENCH_SKIP_TOUR env var (default off) so a dev running via uvicorn can
    # opt in without a code change; an explicit bool from main() always wins.
    if skip_tour is None:
        skip_tour = _env_bool("ALGEBENCH_SKIP_TOUR", default=False)

    if tts_realtime is None:
        tts_realtime = _env_bool("ALGEBENCH_TTS_REALTIME", default=True)

    # Build TTS streaming kwargs
    tts_stream_kwargs = {}
    if tts_parallelism is not None:
        tts_stream_kwargs['parallelism'] = tts_parallelism
    if tts_min_buffer is not None:
        tts_stream_kwargs['min_buffer_seconds'] = tts_min_buffer
    if tts_min_sentence_chars is not None:
        tts_stream_kwargs['min_sentence_chars'] = tts_min_sentence_chars
    if tts_min_sentence_chars_growth is not None:
        tts_stream_kwargs['min_sentence_chars_growth'] = tts_min_sentence_chars_growth
    if tts_chunk_timeout is not None:
        tts_stream_kwargs['chunk_timeout'] = tts_chunk_timeout
    if tts_max_retries is not None:
        tts_stream_kwargs['max_retries'] = tts_max_retries
    if tts_retry_delay is not None:
        tts_stream_kwargs['retry_delay'] = tts_retry_delay
    if tts_style is not None:
        tts_stream_kwargs['style'] = tts_style
    if tts_live:
        tts_stream_kwargs['use_live'] = True
    if tts_output_file is not None:
        tts_stream_kwargs['output_path'] = tts_output_file

    current_spec = [None]
    current_spec_path = [initial_scene_path]
    if initial_scene_path:
        try:
            current_spec[0] = _load_scene(initial_scene_path, trusted=True)
        except Exception as e:
            print(f"   ⚠️  failed to pre-load {initial_scene_path}: {e}")

    # ---- Pydantic request models ----

    class ChatRequest(BaseModel):
        message: str = ''
        history: list = []
        context: dict = {}

    class ContextRequest(BaseModel):
        context: dict = {}

    class TtsRequest(BaseModel):
        text: str = ''
        character: str = 'joker'
        voice: str = 'Charon'
        mode: str = 'read'

    # ---- FastAPI app ----

    fastapp = FastAPI(docs_url=None, redoc_url=None)

    # ---- TTS kill infrastructure ----
    _tts_kill_gen = [0]
    _tts_sse_queues: list[asyncio.Queue] = []
    _tts_active_gens: list = []  # active async generators to close on kill

    # -- GET routes --

    @fastapp.get("/")
    @fastapp.get("/index.html")
    async def get_index():
        # Note: --proof does NOT redirect "/" here. The launcher opens (or prints)
        # the /renderproof?builtin=… URL directly (see serve_and_open), so the proof
        # still shows on start — but "/" must keep serving the main app so the user
        # can navigate back to it from the proof page.
        # Read fresh on each request so edits to index.html are picked up
        # without a server restart (same pattern as /style.css, /*.js).
        return HTMLResponse(
            content=generate_html(debug=debug, skip_tour=skip_tour),
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Content-Security-Policy": (
                    "default-src 'self'; "
                    "script-src 'self' https://cdn.jsdelivr.net 'unsafe-eval'; "
                    "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
                    "font-src 'self' https://cdn.jsdelivr.net data:; "
                    "img-src 'self' data: blob:; "
                    "connect-src 'self'"
                ),
            }
        )

    @fastapp.get("/renderproof")
    async def get_renderproof(theme: str = ""):
        """Serve the shareable proof-animation page.

        After this HTML loads it fetches only same-origin proof JSON (via /proofs)
        plus KaTeX from the same CDN the rest of the app already uses — and makes
        no backend round-trip thereafter. The CSP is still tighter than the main
        app's (no 'unsafe-eval'); the renderer's own guards (KaTeX trust limited to
        \\htmlData, textContent-only, schema validation) are what keep a hostile
        proof JSON inert. ``frame-ancestors *`` lets it be embedded anywhere.
        See docs/shareable-proof-animations.md §7."""
        path = static_dir / "renderproof.html"
        if not path.is_file():
            return Response(status_code=404)
        with open(path, 'r') as f:
            html = f.read().replace('__APP_VERSION__', get_app_version())
        # Apply an explicit ?theme before first paint to avoid a dark→light flash:
        # the page CSS defaults to dark and renderproof.js would only switch it after
        # the module runs (post-paint). CSP forbids inline script, so stamp the
        # attribute server-side. "auto"/unset stays client-resolved (follows the OS).
        if theme in ("light", "dark"):
            html = html.replace('<html lang="en">',
                                f'<html lang="en" data-theme="{theme}">', 1)
        return HTMLResponse(
            content=html,
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Content-Security-Policy": (
                    "default-src 'self'; "
                    "script-src 'self' https://cdn.jsdelivr.net; "
                    "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
                    "font-src 'self' https://cdn.jsdelivr.net data:; "
                    "img-src 'self' data:; "
                    "connect-src 'self'; "
                    "frame-ancestors *; "
                    "object-src 'none'; "
                    "base-uri 'none'"
                ),
            }
        )

    @fastapp.get("/prove")
    async def get_prove(theme: str = ""):
        """Serve the public /prove page — an isolated proof browser (and, later,
        an AI-driven derivation chat). Reuses the proof-animation widget like
        /renderproof, but this page also calls the same-origin proof-store API
        (/api/proofs*), hence `connect-src 'self'`. Not embeddable (interactive),
        so `frame-ancestors 'self'`."""
        path = static_dir / "prove.html"
        if not path.is_file():
            return Response(status_code=404)
        with open(path, 'r') as f:
            html = f.read().replace('__APP_VERSION__', get_app_version())
        if theme in ("light", "dark"):
            html = html.replace('<html lang="en">',
                                f'<html lang="en" data-theme="{theme}">', 1)
        return HTMLResponse(
            content=html,
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

    @fastapp.get("/proofs/{path:path}")
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

    # /prove page proof storage API (catalog, claim, CAS update/delete,
    # source material, cross-refs) — see backend/proof_api/routes.py.
    fastapp.include_router(build_proof_router(
        proofs_dir=proofs_dir, script_dir=script_dir,
        agentic_rate_limit=_agentic_rate_limit,
    ))

    @fastapp.get("/chat.js")
    async def get_chat_js():
        with open(chat_js_path, 'r') as f:
            js = f.read()
        return Response(content=js.encode('utf-8'), media_type="application/javascript",
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    @fastapp.get("/gemini-live-tools/js/voice-character-selector.js")
    async def get_voice_character_selector():
        try:
            js = _glt_static('voice-character-selector.js')
            return Response(content=js.encode('utf-8'), media_type="application/javascript",
                            headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
        except Exception:
            print("⚠ voice-character-selector.js not found in gemini-live-tools package")
            return Response(status_code=404)

    @fastapp.get("/gemini-live-tools/js/tts-audio-player.js")
    async def get_tts_audio_player():
        try:
            js = _glt_static('tts-audio-player.js')
            return Response(content=js.encode('utf-8'), media_type="application/javascript",
                            headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
        except Exception:
            print("⚠ tts-audio-player.js not found in gemini-live-tools package")
            return Response(status_code=404)

    @fastapp.get("/style.css")
    async def get_style_css():
        with open(style_css_path, 'r') as f:
            css = f.read()
        return Response(content=css.encode('utf-8'), media_type="text/css",
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    @fastapp.get("/objects/{filename:path}")
    async def get_objects_js(filename: str):
        """Serve ES module files from static/objects/ subdirectory."""
        path = sanitize_path(static_dir / "objects", filename)
        if not path or not path.is_file() or path.suffix != '.js':
            return Response(status_code=404)
        with open(path, 'r') as f:
            js = f.read()
        return Response(content=js.encode('utf-8'), media_type="application/javascript",
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    _TOP_LEVEL_MODULES = {
        'state', 'expr', 'trust', 'coords', 'labels', 'follow-cam', 'camera',
        'sliders', 'overlay', 'dockable-panel', 'context-browser', 'scene-loader', 'ui',
        'json-browser', 'main', 'proof', 'graph-view', 'expert-client',
        'view-state', 'view-state-bridge', 'nav-history', 'nav-history-core',
        'renderproof', 'embed-resizer', 'object-picker', 'prove',
    }

    @fastapp.get("/api/version")
    async def get_version():
        """Report the running app version (from the root VERSION file).

        Lets the deploy/release tooling verify which version a given host
        (staging vs prod) is actually serving.
        """
        return JSONResponse({"name": "AlgeBench", "version": get_app_version()})

    @fastapp.get("/api/graph/themes")
    async def get_graph_themes():
        """List available semantic-graph theme presets from themes/semantic-graph/.

        Each entry is ``{name, mode}`` — ``mode`` is read from the theme's
        declared ``mode`` field (``"dark"`` or ``"light"``) so the picker UI
        can group themes by backdrop.
        """
        try:
            from scripts import graph_to_mermaid as g2m
            names = g2m.list_themes()
            themes = []
            for name in names:
                try:
                    t = g2m.load_theme(name)
                    themes.append({"name": name, "mode": t.get("mode", "light")})
                except Exception:
                    themes.append({"name": name, "mode": "light"})
            return JSONResponse({"themes": themes})
        except Exception as e:
            print(f"   ❌ /api/graph/themes: {e}", flush=True)
            return JSONResponse({"error": "internal error loading themes", "themes": []}, status_code=500)

    @fastapp.get("/api/graph/theme/{name}")
    async def get_graph_theme(name: str):
        """Return the full JSON for a single semantic-graph theme."""
        import re
        if not re.fullmatch(r"[A-Za-z0-9_-]+", name):
            return JSONResponse({"error": "invalid theme name"}, status_code=400)
        try:
            from scripts import graph_to_mermaid as g2m
            theme = g2m.load_theme(name)
            return JSONResponse(theme)
        except FileNotFoundError:
            return JSONResponse({"error": f"theme '{name}' not found"}, status_code=404)
        except Exception as e:
            print(f"   ❌ /api/graph/theme: {e}", flush=True)
            return JSONResponse({"error": "internal error loading theme"}, status_code=500)

    class MermaidRenderRequest(BaseModel):
        graph: dict = {}
        theme: str = "default-light"
        direction: str | None = None
        # Optional list of fields to display on node labels.
        # Valid values: "emoji", "label", "unit", "role", "quantity", "dimension".
        # Example: ["emoji","label"] -> "🏹 F (force)"
        show: list[str] | None = None

    class LatexToGraphRequest(BaseModel):
        latex: str
        domain: str | None = None
        highlights: dict | None = None

    @fastapp.post("/api/graph/from-latex")
    async def post_graph_from_latex(req: LatexToGraphRequest):
        """Derive a semantic graph from a LaTeX math string.

        Used by the Graph tab to auto-populate diagrams for proof steps that
        do not ship an explicit ``semanticGraph`` field (including steps the
        load-time autofill deferred past ALGEBENCH_GRAPH_AUTOFILL_LIMIT).

        Accepts the RAW proof-step math: ``\\htmlClass{hl-X}{...}`` wrappers
        are extracted and mapped onto graph nodes exactly like the eager
        autofill path, so lazily derived graphs keep their highlight colors.
        """
        try:
            hl_pairs = _extract_htmlclass_pairs(req.latex)
            cleaned = _strip_html_class(req.latex)
            # Offload the synchronous parse to a worker thread so a burst of
            # graph derivations can't monopolize the event loop and starve
            # /api/health (Render's probe). See also _load_scene callers below.
            graph = await asyncio.to_thread(_graph_service.latex_to_graph, cleaned, domain=req.domain)
            if graph:
                _apply_highlights_to_graph(graph, hl_pairs, req.highlights or {})
            return JSONResponse({"graph": graph.model_dump(by_alias=True, exclude_none=True) if graph else None})
        except (ValueError, SyntaxError, KeyError) as e:
            print(f"   ⚠️ /api/graph/from-latex parse error: {e}", flush=True)
            return JSONResponse({"error": "failed to derive semantic graph from LaTeX"}, status_code=400)
        except Exception as e:
            import traceback
            print(f"   ❌ /api/graph/from-latex: {e}\n{traceback.format_exc()}")
            return JSONResponse({"error": "internal error processing LaTeX"}, status_code=500)

    class GenerateMathjsRequest(BaseModel):
        subexpr: str

    @fastapp.post("/api/graph/generate-mathjs")
    async def post_generate_mathjs(req: GenerateMathjsRequest):
        """Convert a LaTeX sub-expression to a mathjs-compatible script.

        Accepts the ``subexpr`` field from a semantic graph node and returns
        a mathjs expression string suitable for ``math.compile()`` on the
        client.  Relations (``=``, ``>``, …) are automatically converted to
        ``LHS - RHS``.
        """
        from backend.semantic_graph.mathjs_converter import latex_to_mathjs

        try:
            # CPU-bound LaTeX→mathjs conversion — keep it off the event loop.
            script, variables = await asyncio.to_thread(latex_to_mathjs, req.subexpr)
            return JSONResponse({"script": script, "variables": variables})
        except (ValueError, SyntaxError) as e:
            print(f"   ⚠️  /api/graph/generate-mathjs: conversion failed: {e}")
            return JSONResponse(
                {"error": "failed to convert LaTeX to mathjs"},
                status_code=400,
            )
        except Exception as e:
            import traceback
            print(f"   ❌ /api/graph/generate-mathjs: {e}\n{traceback.format_exc()}")
            return JSONResponse(
                {"error": "internal error generating mathjs"},
                status_code=500,
            )

    @fastapp.post("/api/expert/{name}")
    async def run_expert(name: str, request: Request, _rl: None = Depends(_agentic_rate_limit)):
        """Generic expert/handler entry point.

        ``name`` selects a registered expert or a handler (a custom pre/post
        wrapper around an expert call). Adding an expert or handler needs no new
        route — they self-register and are reachable here by name. The shared
        per-IP ``_agentic_rate_limit`` (above) is the only throttle.

        Status codes: 404 unknown name, 422 bad request body, 400 derivation
        error (unparseable expression / empty result), 500 otherwise.
        """
        from pydantic import ValidationError

        from backend.experts import service as expert_service
        from backend.experts.registry import EXPERT_REGISTRY, HANDLER_REGISTRY

        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "request body must be valid JSON"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "request body must be a JSON object"}, status_code=400)

        # One-line request log — single line (newlines escaped) and length-capped
        # so a large/arbitrary LaTeX body can't flood the logs.
        _body_log = json.dumps(body, ensure_ascii=False).replace("\n", "\\n")
        if len(_body_log) > 2000:
            _body_log = _body_log[:2000] + f"…(+{len(_body_log) - 2000} chars)"
        print(f"   🧠 /api/expert/{name} {_body_log}", flush=True)

        try:
            # One-time DSPy config + discovery (imports/configures — off the loop).
            await asyncio.to_thread(_ensure_experts)
        except Exception as e:
            import traceback
            print(f"   ❌ /api/expert/{name}: expert init failed: {e}\n{traceback.format_exc()}", flush=True)
            return JSONResponse({"error": "expert framework unavailable"}, status_code=503)

        if name not in HANDLER_REGISTRY and name not in EXPERT_REGISTRY:
            return JSONResponse({"error": f"unknown expert/handler: {name!r}"}, status_code=404)

        try:
            # The whole sync pipeline (validation + LM call + conversion) off-loop.
            result = await asyncio.to_thread(expert_service.run, name, body)
        except ValidationError as e:
            print(f"   ⚠️  /api/expert/{name}: invalid request: {e.errors()}", flush=True)
            return JSONResponse({"error": "invalid request", "detail": e.errors()}, status_code=422)
        except Exception as e:
            # Never surface exception text to the client — log server-side, return
            # a generic message.
            import traceback
            print(f"   ❌ /api/expert/{name}: {e}\n{traceback.format_exc()}", flush=True)
            return JSONResponse({"error": "internal error running expert"}, status_code=500)

        # A handler reports an expected, user-facing failure as DATA — an
        # ``{"error": <message>}`` dict with no ``steps`` — so the message is a
        # controlled, handler-authored string, never an exception's str().
        if isinstance(result, dict) and result.get("error") and "steps" not in result:
            print(f"   ⚠️  /api/expert/{name}: {result['error']}", flush=True)
            return JSONResponse({"error": result["error"]}, status_code=400)
        return JSONResponse(result)

    class GraphEnrichRequest(BaseModel):
        graph: dict
        context: dict | None = None

    @fastapp.post("/api/graph/enrich")
    async def post_graph_enrich(req: GraphEnrichRequest, _rl: None = Depends(_agentic_rate_limit)):
        """Enrich a semantic graph via Gemini (descriptions, emoji, color, corrections).

        Runtime in-memory cache keyed by ``sha256({graph, context})`` — the
        same graph asked about in two different lesson/scene contexts will
        cache as two separate entries, since context disambiguates ambiguous
        symbols (e.g. ``T`` = thrust vs temperature).

        Failure modes:
          - 502 on ``AgentError`` (Gemini exhausted retries / unexpected output)
          - 503 if the agents package can't import or ``GEMINI_API_KEY`` is missing
          - 500 on any other exception
        The client treats all non-2xx as "keep showing the unenriched graph"
        and may retry on a future render.
        """
        import hashlib
        import json as _json

        global _graph_enricher

        from pydantic import ValidationError as _ValidationError
        from backend.model import SemanticGraph as _SemanticGraph

        try:
            graph_in = req.graph or {}
            context_in = req.context or None
            node_count = len(graph_in.get("nodes", []) or [])
            domain = graph_in.get("domain") or (context_in or {}).get("domain") or "?"

            # Strip annotation nodes before validation and enrichment —
            # they carry free-text labels that can exceed Pydantic field
            # limits, and they aren't meaningful to the Gemini enricher.
            # Re-attached to the enriched result before returning.
            all_nodes = list(graph_in.get("nodes") or [])
            anno_nodes = [n for n in all_nodes if n.get("type") == "annotation"]
            anno_ids = {n.get("id") for n in anno_nodes} - {None}
            if anno_nodes:
                graph_in = dict(graph_in)
                graph_in["nodes"] = [n for n in all_nodes if n.get("type") != "annotation"]
                orig_edges = list(graph_in.get("edges") or [])
                anno_edges = [e for e in orig_edges if e.get("from") in anno_ids or e.get("to") in anno_ids]
                graph_in["edges"] = [e for e in orig_edges if e.get("from") not in anno_ids and e.get("to") not in anno_ids]
            else:
                anno_edges = []

            # Validate the wire-format dict at the API boundary BEFORE any
            # short-circuit. Otherwise a caller could include any
            # ``"enrichment": {...}`` blob in their request and bypass the
            # ``extra="forbid"`` schema invariant entirely (see Codex review
            # on PR #196). Catch ``ValidationError`` specifically — anything
            # else falls through to the outer ``except`` that returns a 500
            # with a stack trace, instead of misclassifying server bugs as
            # client validation failures and echoing internal exception text.
            try:
                graph_model = _SemanticGraph.model_validate(graph_in)
            except _ValidationError as exc:
                print(f"[enrich] input failed validation: {exc}", flush=True)
                return JSONResponse(
                    {"error": "input graph failed schema validation"},
                    status_code=400,
                )

            # Short-circuit: a graph that already carries an ``enrichment``
            # block has been through the agent before. Skip the cache lookup
            # and the Gemini calls entirely and echo the (now-validated)
            # input back. The client uses the same marker to skip even
            # sending the request, so this is mostly a backstop for direct
            # API callers.
            #
            # ``cached: false`` here on purpose — the response did NOT come
            # from ``_graph_enrich_cache``; we just echoed the request body.
            # ``skipped: true`` is the signal that the Gemini call was
            # avoided. Keeping ``cached`` honest matters for any caller
            # that uses it for metrics.
            if graph_model.enrichment is not None:
                enriched_out = graph_model.model_dump(by_alias=True, exclude_none=True)
                if anno_nodes:
                    enriched_out["nodes"].extend(anno_nodes)
                    enriched_out["edges"].extend(anno_edges)
                print(f"[enrich] input already enriched  nodes={node_count} domain={domain!r}", flush=True)
                return JSONResponse({
                    "enriched": enriched_out,
                    "cached": False,
                    "skipped": True,
                })

            cache_payload = {"graph": graph_in, "context": context_in}
            key = hashlib.sha256(
                _json.dumps(cache_payload, sort_keys=True).encode("utf-8")
            ).hexdigest()
            cached = _graph_enrich_cache.get(key)
            if cached is not None:
                print(f"[enrich] cache hit  nodes={node_count} domain={domain!r} ctx={'y' if context_in else 'n'} key={key[:8]}", flush=True)
                return JSONResponse({"enriched": cached, "cached": True})

            print(f"[enrich] miss → Gemini  nodes={node_count} domain={domain!r} ctx={'y' if context_in else 'n'} key={key[:8]}", flush=True)
            # Full payload contains lesson/scene text (potentially sensitive)
            # and adds significant log volume — gate on DEBUG_MODE.
            if DEBUG_MODE:
                print(f"[enrich] payload: {_json.dumps({'graph': graph_in, 'context': context_in}, indent=2)}", flush=True)

            try:
                from backend.agents import AgentError, SemanticGraphEnrichmentAgent
            except ImportError as e:
                print(f"[enrich] import error: {e}", flush=True)
                return JSONResponse({"error": "enrichment service unavailable"}, status_code=503)

            if _graph_enricher is None:
                try:
                    _graph_enricher = SemanticGraphEnrichmentAgent()
                except AgentError as e:
                    print(f"[enrich] agent init error: {e}", flush=True)
                    return JSONResponse({"error": "enrichment service unavailable"}, status_code=503)

            try:
                enriched_model = await _graph_enricher.aenrich(graph_model, context_in)
            except AgentError as e:
                print(f"[enrich] agent error: {e}", flush=True)
                return JSONResponse({"error": "enrichment failed"}, status_code=502)

            # Serialize back to the wire format for the cache and JSON
            # response — keeps the cache hit path returning dicts so the
            # ``cached`` shape is identical regardless of how it was built.
            enriched = enriched_model.model_dump(by_alias=True, exclude_none=True)
            if anno_nodes:
                enriched["nodes"].extend(anno_nodes)
                enriched["edges"].extend(anno_edges)
            _graph_enrich_cache[key] = enriched
            print(f"[enrich] ok  cached  key={key[:8]}", flush=True)
            if DEBUG_MODE:
                print(f"[enrich] response: {_json.dumps(enriched, indent=2)}", flush=True)
            return JSONResponse({"enriched": enriched, "cached": False})
        except Exception as e:
            import traceback
            print(f"   ❌ /api/graph/enrich: {e}\n{traceback.format_exc()}")
            return JSONResponse({"error": "internal error during enrichment"}, status_code=500)

    @fastapp.post("/api/graph/mermaid")
    async def post_graph_mermaid(req: MermaidRenderRequest):
        """Regenerate Mermaid source from a semantic graph with the given theme/direction."""
        try:
            from scripts import graph_to_mermaid as g2m
            theme = g2m.load_theme(req.theme or "default-light")
            if req.direction:
                theme = dict(theme)
                theme["direction"] = req.direction
            show_set = set(req.show) if req.show else None
            mermaid_src = await asyncio.to_thread(
                g2m.semantic_graph_to_mermaid,
                req.graph or {}, theme=theme, show=show_set,
            )
            # ``edgeStyles`` is forwarded so the client can paint a legend
            # matching the theme's per-semantic arrow styling (proportional /
            # inversely proportional / neutral). Themes without ``edgeStyles``
            # render all edges identically, and the legend stays hidden.
            return JSONResponse({"mermaid": mermaid_src, "theme": req.theme,
                                 "direction": theme.get("direction"),
                                 "mode": theme.get("mode", "dark"),
                                 "edgeStyles": theme.get("edgeStyles", {})})
        except FileNotFoundError:
            return JSONResponse({"error": "theme not found"}, status_code=404)
        except Exception as e:
            import traceback
            print(f"   ❌ /api/graph/mermaid: {e}\n{traceback.format_exc()}")
            return JSONResponse({"error": "internal error generating mermaid"}, status_code=500)

    @fastapp.get("/graph-panel/{filename:path}")
    async def get_graph_panel_file(filename: str):
        """Serve files from static/graph-panel/ subdirectory."""
        path = sanitize_path(static_dir / "graph-panel", filename)
        if not path or not path.is_file():
            return Response(status_code=404)
        suffix = path.suffix
        if suffix == '.js':
            media_type = "application/javascript"
        elif suffix == '.css':
            media_type = "text/css"
        else:
            media_type = "application/octet-stream"
        with open(path, 'rb') as f:
            content = f.read()
        return Response(content=content, media_type=media_type,
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    @fastapp.get("/coach/{filename:path}")
    async def get_coach_file(filename: str):
        """Serve files from static/coach/ subdirectory (quick-intro Coach)."""
        path = sanitize_path(static_dir / "coach", filename)
        if not path or not path.is_file():
            return Response(status_code=404)
        # Allowlist only the asset types the Coach actually ships; 404 anything
        # else so future files under static/coach/ can't be served unintentionally.
        media_type = {'.js': 'application/javascript', '.css': 'text/css'}.get(path.suffix)
        if media_type is None:
            return Response(status_code=404)
        with open(path, 'rb') as f:
            content = f.read()
        return Response(content=content, media_type=media_type,
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    # The FLIP animation engine's static assets — a fixed, known set. The request
    # filename is only ever used to LOOK UP a constant (name, media_type); the
    # filesystem path is built from the mapped constant ``name`` literal, so no
    # user-controlled value reaches the path (no traversal possible).
    _PROOF_ANIM_ASSETS = {
        "proof-animation.js": ("proof-animation.js", "application/javascript"),
        "proof-animation.css": ("proof-animation.css", "text/css"),
        "sg-proof.js": ("sg-proof.js", "application/javascript"),
        "dock-seq.js": ("dock-seq.js", "application/javascript"),
        "derive-payload.js": ("derive-payload.js", "application/javascript"),
        "validate-proof.js": ("validate-proof.js", "application/javascript"),
    }

    @fastapp.get("/proof-animation/{filename:path}")
    async def get_proof_animation_file(filename: str):
        """Serve a known FLIP-engine asset from static/proof-animation/."""
        entry = _PROOF_ANIM_ASSETS.get(filename)
        if entry is None:
            return Response(status_code=404)
        name, media_type = entry                       # constants from the table
        path = static_dir / "proof-animation" / name
        if not path.is_file():
            return Response(status_code=404)
        with open(path, "rb") as f:
            content = f.read()
        return Response(content=content, media_type=media_type,
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    @fastapp.get("/{name}.js")
    async def get_module_js(name: str):
        """Serve any top-level ES module from the static directory."""
        if not re.fullmatch(r"[A-Za-z0-9_-]+", name):
            return Response(status_code=404)
        if name not in _TOP_LEVEL_MODULES:
            return Response(status_code=404)
        path = sanitize_path(static_dir, f"{name}.js")
        if not path or not path.is_file():
            return Response(status_code=404)
        with open(path, 'r') as f:
            js = f.read()
        return Response(content=js.encode('utf-8'), media_type="application/javascript",
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    @fastapp.get("/favicon.ico")
    async def get_favicon():
        return Response(content=FAVICON_SVG.encode('utf-8'), media_type="image/svg+xml",
                        headers={"Cache-Control": "public, max-age=86400"})

    @fastapp.get("/api/chat/available")
    async def get_chat_available():
        return JSONResponse({"available": bool(GEMINI_API_KEY)})

    @fastapp.get("/api/health")
    async def get_health():
        return JSONResponse({"status": "ok"})

    @fastapp.get("/api/memory")
    async def get_memory():
        payload = {
            k: {"summary": _memory_summary(k, v), "value": v}
            for k, v in _agent_memory.items()
        }
        return JSONResponse(payload)

    @fastapp.post("/api/debug/system_prompt")
    async def get_debug_system_prompt(req: ContextRequest):
        if not DEBUG_MODE:
            return JSONResponse({"error": "Debug mode is disabled."}, status_code=404)
        context = req.context or {}
        prompt = build_system_prompt(context, agent_memory=_agent_memory)
        return JSONResponse({
            "systemPrompt": prompt,
            "charCount": len(prompt),
        })

    @fastapp.get("/api/scenes")
    async def get_scenes():
        return JSONResponse({"scenes": list_builtin_scenes()})

    @fastapp.get("/api/scene_file")
    async def get_scene_file(request: Request):
        requested = request.query_params.get('path', '')
        resolved_path = resolve_scene_path_safe(requested)
        if not resolved_path:
            return JSONResponse({"error": "Scene file not found"}, status_code=404)
        try:
            # resolve_scene_path_safe already confined this to scenes/ — load directly.
            # _load_scene runs _autofill_semantic_graphs, which derives a graph per
            # proof step (seconds for a large lesson). Offload to a worker thread so
            # the load can't block the event loop and time out Render's health check.
            scene = await asyncio.to_thread(_load_scene, resolved_path, trusted=True)
            # Return a project-root-relative path ("scenes/<name>") so the
            # ?scene= URL the frontend writes round-trips: resolve_scene_path_safe
            # rejects absolute paths, so echoing an absolute path would 404 on
            # reload.
            try:
                rel_path = "scenes/" + resolved_path.relative_to(scenes_dir.resolve()).as_posix()
            except ValueError:
                rel_path = resolved_path.name
            return JSONResponse({"spec": scene, "path": rel_path,
                                 "label": resolved_path.name})
        except json.JSONDecodeError:
            return JSONResponse({"error": "Invalid JSON in scene file"}, status_code=400)
        except Exception as e:
            print(f"   ❌ /api/scene_file: {e}", flush=True)
            return JSONResponse({"error": "internal error reading scene file"}, status_code=500)

    @fastapp.get("/api/domains")
    async def get_domains():
        domains_dir = static_dir / 'domains'
        result = []
        if domains_dir.is_dir():
            for d in sorted(domains_dir.iterdir()):
                if d.is_dir():
                    docs_path = d / 'docs.json'
                    entry = {'name': d.name}
                    if docs_path.exists():
                        try:
                            with open(docs_path, 'r') as f:
                                docs = json.load(f)
                            entry['description'] = docs.get('description', '')
                            entry['functions'] = list(docs.get('functions', {}).keys())
                        except Exception:
                            pass
                    result.append(entry)
        return JSONResponse(result)

    @fastapp.get("/api/domains/{name}")
    async def get_domain_docs(name: str):
        if not re.fullmatch(r'[A-Za-z0-9_\-]+', name):
            return Response(content=b'Domain not found', status_code=404)
        docs_path = sanitize_path(static_dir / 'domains', os.path.join(name, 'docs.json'))
        if not docs_path or not docs_path.exists():
            return Response(content=b'Domain not found', status_code=404)
        with open(docs_path, 'rb') as f:
            return Response(content=f.read(), media_type="application/json")

    @fastapp.get("/domains/{path:path}")
    async def get_domain_file(path: str):
        domain_path = sanitize_path(static_dir / 'domains', path)
        if not domain_path or not domain_path.is_file():
            return Response(content=b'Domain not found', status_code=404)
        with open(domain_path, 'rb') as f:
            return Response(content=f.read(), media_type="application/javascript")

    @fastapp.get("/scenes/{name:path}")
    async def get_scene(name: str):
        # load_builtin_scene → _load_scene runs the per-step graph backfill,
        # so offload it too (same reason as the other _load_scene callers) —
        # otherwise selecting a large built-in lesson re-blocks the event loop.
        scene = await asyncio.to_thread(load_builtin_scene, name)
        if scene:
            return JSONResponse(scene)
        return Response(content=b'Scene not found', status_code=404)

    @fastapp.get("/api/scene")
    async def get_current_scene():
        if current_spec_path[0]:
            try:
                current_spec[0] = await asyncio.to_thread(_load_scene, current_spec_path[0], trusted=True)
            except Exception:
                pass
        return JSONResponse(current_spec[0] if current_spec[0] else {})

    @fastapp.get("/shutdown")
    async def shutdown():
        # Kill active TTS streams so uvicorn doesn't hang waiting for them
        for gen in list(_tts_active_gens):
            try:
                await gen.aclose()
            except Exception:
                pass
        _tts_active_gens.clear()
        threading.Thread(target=lambda: (time.sleep(0.5), os._exit(0))).start()
        return Response(content=b'Shutting down...')

    # -- POST routes --

    @fastapp.post("/api/chat")
    async def api_chat(req: ChatRequest, _rl: None = Depends(_chat_rate_limit)):
        if not req.message.strip():
            return JSONResponse({"error": "Empty message"}, status_code=400)
        try:
            loop = asyncio.get_running_loop()
            response_text, tool_calls, debug_info = await loop.run_in_executor(
                None, lambda: call_gemini_chat(req.message, req.history, req.context)
            )
            if DEBUG_MODE:
                print(f"   💬 Response ({len(response_text)} chars): {response_text}")
            result = {"response": response_text, "toolCalls": tool_calls}
            if DEBUG_MODE:
                result["debug"] = debug_info
            return JSONResponse(result)
        except Exception as e:
            import traceback
            print(f"   ❌ /api/chat error: {e}\n{traceback.format_exc()}")
            return JSONResponse({"error": "internal error processing chat request"}, status_code=500)

    @fastapp.post("/api/tts/stream")
    async def api_tts_stream(req: TtsRequest, request: Request, _rl: None = Depends(_tts_rate_limit)):
        if not TTS_AVAILABLE or not GEMINI_API_KEY:
            return JSONResponse({"error": "TTS not available"}, status_code=503)
        text = req.text.strip()
        # Strip unpaired UTF-16 surrogates (e.g. an emoji cut in half by a
        # client-side character-count truncation) — they break UTF-8 encoding
        # in logging and in the downstream TTS request.
        text = "".join(ch for ch in text if not 0xD800 <= ord(ch) <= 0xDFFF)
        if not text:
            return JSONResponse({"error": "Empty text"}, status_code=400)

        import time as _time
        if DEBUG_MODE:
            print(f"\n🔊 TTS stream: character={req.character}, voice={req.voice}, "
                  f"mode={req.mode}, realtime={tts_realtime}, {len(text)} chars")
            print(f"🔊 TTS original text: {text}")

        api = GeminiLiveAPI(api_key=GEMINI_API_KEY, client=get_gemini_client())

        if req.mode == 'perform':
            t0 = _time.monotonic()
            loop = asyncio.get_running_loop()
            tts_text = await loop.run_in_executor(
                None, lambda: api.prepare_text(text, character_name=req.character)
            )
            if DEBUG_MODE:
                print(f"🔊 TTS prepared ({_time.monotonic()-t0:.2f}s): {tts_text}")
        else:
            tts_text = text

        if tts_realtime:
            # Realtime mode: single Live API session, stream raw PCM chunks
            est_duration = GeminiLiveAPI.estimate_audio_duration(tts_text)

            async def generate_rt():
                gen_at_start = _tts_kill_gen[0]
                inner = api.astream_realtime_pcm(
                    text=tts_text,
                    voice_name=req.voice,
                    character_name=req.character,
                    style=tts_stream_kwargs.get('style'),
                )
                _tts_active_gens.append(inner)
                try:
                    async for pcm_chunk in inner:
                        if _tts_kill_gen[0] != gen_at_start or await request.is_disconnected():
                            break
                        yield pcm_chunk
                finally:
                    if inner in _tts_active_gens:
                        _tts_active_gens.remove(inner)

            headers = {
                "Cache-Control": "no-cache",
                "X-Content-Type-Options": "nosniff",
                "X-Audio-Sample-Rate": "24000",
                "X-Audio-Channels": "1",
                "X-Audio-Format": "s16le",
                "X-TTS-Est-Duration": f"{est_duration:.1f}",
            }
            if tts_output_file:
                headers["X-TTS-Has-Output-File"] = "1"

            return StreamingResponse(generate_rt(), media_type="audio/pcm", headers=headers)

        sentences = _split_sentences(
            tts_text,
            min_chars=tts_stream_kwargs.get('min_sentence_chars', 100),
            growth=tts_stream_kwargs.get('min_sentence_chars_growth', 1.2),
        )
        chunk_count = len(sentences)

        async def generate():
            gen_at_start = _tts_kill_gen[0]
            inner = api.astream_parallel_wav(
                text=tts_text,
                voice_name=req.voice,
                character_name=req.character,
                **tts_stream_kwargs
            )
            _tts_active_gens.append(inner)
            try:
                async for chunk in inner:
                    if _tts_kill_gen[0] != gen_at_start or await request.is_disconnected():
                        break
                    yield chunk
            finally:
                if inner in _tts_active_gens:
                    _tts_active_gens.remove(inner)

        headers = {
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "X-TTS-Chunk-Count": str(chunk_count),
        }
        if tts_output_file:
            headers["X-TTS-Has-Output-File"] = "1"

        return StreamingResponse(generate(), media_type="audio/wav", headers=headers)

    @fastapp.get("/api/tts/download")
    async def api_tts_download():
        if not tts_output_file or not os.path.exists(tts_output_file):
            return JSONResponse({"error": "No output file available"}, status_code=404)
        filename = os.path.basename(tts_output_file)
        return FileResponse(tts_output_file, media_type="audio/wav",
                            filename=filename, headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    @fastapp.post("/api/tts/kill")
    async def api_tts_kill():
        _tts_kill_gen[0] += 1
        # Close active Gemini API streams (triggers cancel_event / session close)
        streams_killed = 0
        for gen in list(_tts_active_gens):
            try:
                await gen.aclose()
                streams_killed += 1
            except Exception:
                pass
        _tts_active_gens.clear()
        # Kill browser-side playback via SSE
        for q in list(_tts_sse_queues):
            try:
                q.put_nowait("kill")
            except asyncio.QueueFull:
                pass
        if DEBUG_MODE:
            print(f"🔇 TTS kill: {streams_killed} stream(s) closed (gen={_tts_kill_gen[0]})")
        return JSONResponse({
            "killed": True,
            "generation": _tts_kill_gen[0],
            "streams_killed": streams_killed,
        })

    @fastapp.get("/api/tts/events")
    async def api_tts_events(request: Request):
        q: asyncio.Queue = asyncio.Queue(maxsize=16)
        _tts_sse_queues.append(q)

        async def event_stream():
            try:
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        msg = await asyncio.wait_for(q.get(), timeout=30)
                        yield f"event: {msg}\ndata: {{}}\n\n"
                    except asyncio.TimeoutError:
                        yield ": keepalive\n\n"
            finally:
                if q in _tts_sse_queues:
                    _tts_sse_queues.remove(q)

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @fastapp.post("/api/load")
    async def api_load(request: Request):
        body = await request.body()
        try:
            new_spec = json.loads(body)
            current_spec[0] = await asyncio.to_thread(_load_scene, new_spec)
            return JSONResponse({"status": "loaded"})
        except json.JSONDecodeError:
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    return fastapp


def serve_and_open(initial_scene_path=None, port=DEFAULT_PORT, json_output=False, debug=False,
                   skip_tour=None, initial_proof=None,
                   tts_parallelism=None, tts_min_buffer=None, tts_min_sentence_chars=None,
                   tts_min_sentence_chars_growth=None, tts_chunk_timeout=None,
                   tts_max_retries=None, tts_retry_delay=None, tts_style=None,
                   tts_live=True, tts_output_file=None, tts_realtime=None,
                   server_only=False):
    """Serve the AlgeBench viewer and optionally open in browser.

    ``tts_realtime=None`` defers to ``create_app``'s env-var resolution
    (``ALGEBENCH_TTS_REALTIME``, default realtime); an explicit bool wins.
    """
    fastapp = create_app(
        initial_scene_path=initial_scene_path,
        debug=debug,
        skip_tour=skip_tour,
        tts_parallelism=tts_parallelism,
        tts_min_buffer=tts_min_buffer,
        tts_min_sentence_chars=tts_min_sentence_chars,
        tts_min_sentence_chars_growth=tts_min_sentence_chars_growth,
        tts_chunk_timeout=tts_chunk_timeout,
        tts_max_retries=tts_max_retries,
        tts_retry_delay=tts_retry_delay,
        tts_style=tts_style,
        tts_live=tts_live,
        tts_output_file=tts_output_file,
        tts_realtime=tts_realtime,
    )

    # ---- Start uvicorn in a background thread ----

    config = uvicorn.Config(fastapp, host="0.0.0.0", port=port, log_level="error")
    uvicorn_server = uvicorn.Server(config)

    def _run_server():
        uvicorn_server.run()

    server_thread = threading.Thread(target=_run_server, daemon=False)
    server_thread.start()
    time.sleep(0.5)

    url = f"http://localhost:{port}/"
    if initial_proof:
        # Jump straight to the shareable proof page. ``initial_proof`` is already
        # validated as <domain>/<name> in main(); quote() is belt-and-suspenders.
        url = f"http://localhost:{port}/renderproof?builtin={quote(initial_proof)}"
    elif initial_scene_path:
        # The frontend's ?scene= load path goes through /api/scene_file, which
        # confines reads to scenes/ and REJECTS absolute paths. So only emit
        # ?scene= for files inside scenes/ (as a scenes/<name> relative path
        # that round-trips through resolve_scene_path_safe + reload). For paths
        # outside scenes/, open the bare URL: the frontend then falls back to
        # /api/scene, which serves the pre-loaded current_spec from the
        # (trusted) absolute path and keeps working across reloads.
        try:
            rel = "scenes/" + Path(initial_scene_path).resolve().relative_to(
                scenes_dir.resolve()).as_posix()
            url = f"{url}?scene={quote(rel)}"
        except ValueError:
            pass

    if json_output:
        result = {
            "status": "success",
            "url": url,
            "port": port,
            "pid": os.getpid()
        }
        print(json.dumps(result, indent=2))
        try:
            sys.stdout.flush()
        except (BrokenPipeError, OSError):
            pass
    elif server_only:
        print(f"AlgeBench server running at {url}")
        print(f"\nPress 'q' or Ctrl+C to stop the server")
    else:
        webbrowser.open(url)
        print(f"Opened AlgeBench in browser: {url}")
        print(f"\nDrag & drop JSON files onto the viewport to load scenes")
        print(f"\nPress 'q' or Ctrl+C to stop the server")

    if not json_output:
        if sys.stdin.isatty():
            old_settings = termios.tcgetattr(sys.stdin)
            try:
                tty.setcbreak(sys.stdin.fileno())
                while True:
                    if sys.stdin in select.select([sys.stdin], [], [], 0.1)[0]:
                        char = sys.stdin.read(1)
                        if char.lower() == 'q':
                            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
                            print(f"\nServer stopped")
                            os._exit(0)
                    time.sleep(0.1)
            except KeyboardInterrupt:
                termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
                print(f"\n\nServer stopped")
                os._exit(0)
            finally:
                try:
                    termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
                except Exception:
                    pass
        else:
            def signal_handler(signum, frame):
                uvicorn_server.should_exit = True
                sys.exit(0)
            signal.signal(signal.SIGTERM, signal_handler)
            signal.signal(signal.SIGINT, signal_handler)
            try:
                while True:
                    time.sleep(1)
            except Exception:
                pass


def main():
    parser = argparse.ArgumentParser(
        description='AlgeBench - Interactive 3D Linear Algebra Visualizer',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  algebench                                      Launch empty viewer
  algebench scene.json                           Launch with scene
  algebench scenes/vector-addition.json          Load built-in scene
  algebench --port 9000                          Use custom port
  algebench --no-tts-live                        Use standard TTS instead of Gemini Live
  algebench --tts-parallelism 4                  Max concurrent TTS sentence synthesis (default: 3)
  algebench --tts-min-buffer 60.0                Seconds of audio buffered before playback (default: 30)
  algebench --tts-min-sentence-chars 150         Merge short sentences to this char count (default: 100)
  algebench --tts-min-sentence-chars-growth 1.5  Sentence char growth factor (default: 1.2)
  algebench --tts-chunk-timeout 30               Seconds before chunk timeout (default: 30)
  algebench --tts-max-retries 5                  Max retries per sentence (default: library default)
  algebench --tts-retry-delay 2.0                Seconds between retries (default: library default)
  algebench --tts-style "speak slowly"           Additional style guidance for TTS
  algebench --tts-output-file out.wav            Save TTS audio to WAV file
  algebench --tts-buffered                       Buffer sentences before playback (legacy TTS mode)
  algebench -rt scene.json                       Launch scene (realtime TTS is default)
        '''
    )
    parser.add_argument('scene', nargs='?', help='Path to scene JSON file')
    parser.add_argument('--proof', default=None, metavar='DOMAIN/NAME',
                        help='Open the shareable proof page on a built-in proof '
                             '(proofs/domains/<domain>/<name>.json) instead of the main app')
    parser.add_argument('--json', action='store_true', help='Output JSON (for MCP integration)')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT, help=f'Port (default: {DEFAULT_PORT})')
    parser.add_argument('--debug', action='store_true', help='Dump full Gemini API requests to console')
    parser.add_argument('--tts-parallelism', type=int, default=3, choices=range(1, 5),
                        metavar='N (1-4)',
                        help='Max concurrent TTS sentence synthesis calls (default: 3, max: 4)')
    parser.add_argument('--tts-min-buffer', type=float, default=30.0,
                        help='Seconds of audio to buffer before first playback (default: 30.0)')
    parser.add_argument('--tts-min-sentence-chars', type=int, default=100,
                        help='Merge short sentences up to this char count (default: 100)')
    parser.add_argument('--tts-min-sentence-chars-growth', type=float, default=1.2,
                        help='Sentence char limit growth factor for merging (default: 1.2)')
    parser.add_argument('--tts-chunk-timeout', type=float, default=30.0,
                        help='Seconds to wait for next chunk before timing out (default: 30.0)')
    parser.add_argument('--tts-max-retries', type=int, default=None,
                        help='Max retries per sentence on TTS failure (default: library default)')
    parser.add_argument('--tts-retry-delay', type=float, default=None,
                        help='Seconds to wait between retries (default: library default)')
    parser.add_argument('--tts-style', type=str, default=None,
                        help='Additional style guidance for TTS synthesis')
    parser.add_argument('--tts-live', action='store_true', default=True,
                        help='Use Gemini Live API for TTS synthesis instead of standard TTS (default: enabled)')
    parser.add_argument('--no-tts-live', action='store_false', dest='tts_live',
                        help='Disable Gemini Live API for TTS synthesis')
    parser.add_argument('--tts-output-file', '--output-file', type=str, default=None,
                        dest='tts_output_file',
                        help='Save all TTS audio to this WAV file in addition to playing')
    parser.add_argument('--tts-buffered', action='store_true', default=False,
                        help='Buffer full sentences before playback instead of realtime streaming')
    parser.add_argument('--tts-realtime', '-rt', action='store_true', default=False,
                        help='(deprecated, no-op) Realtime streaming is now the default; this flag will be removed in a future release')
    parser.add_argument('--server-only', action='store_true', default=False,
                        help='Start the server without opening a browser window')
    parser.add_argument('--skip-tour', action='store_true', default=None,
                        help='Suppress the auto-offered guided tour (Coach overlay) — handy for local '
                             'debugging. When omitted, falls back to the ALGEBENCH_SKIP_TOUR env var.')

    args = parser.parse_args()

    # App-logger setup now lives in create_app() (so the uvicorn/asgi entrypoint
    # gets it too); --debug flows through as create_app(debug=...) below.

    # Auto-enable buffered mode when flags require it
    if not args.tts_buffered:
        if not args.tts_live:
            args.tts_buffered = True
            print("ℹ️  --no-tts-live requires buffered mode; enabling --tts-buffered automatically.",
                  file=sys.stderr)
        elif args.tts_output_file:
            args.tts_buffered = True
            print("ℹ️  --tts-output-file requires buffered mode; enabling --tts-buffered automatically.",
                  file=sys.stderr)

    # Warn if buffered-only tuning flags are used without --tts-buffered
    if not args.tts_buffered:
        buffered_only = ['--tts-parallelism', '--tts-min-buffer',
                         '--tts-min-sentence-chars', '--tts-min-sentence-chars-growth',
                         '--tts-chunk-timeout', '--tts-max-retries', '--tts-retry-delay']
        used = [
            f
            for f in buffered_only
            if any(arg == f or arg.startswith(f + '=') for arg in sys.argv)
        ]
        if used:
            print(f"⚠️  Warning: {', '.join(used)} only apply in buffered mode (--tts-buffered). "
                  f"Ignoring in realtime mode.", file=sys.stderr)

    if not args.json:
        print(f"Checking port {args.port}...")
    kill_server_on_port(args.port)
    time.sleep(0.5)

    initial_proof = None
    if args.proof:
        # Validate the same way the page and the /proofs route do, so a bad value
        # fails loudly here instead of opening a 404 page.
        if not re.fullmatch(r'[A-Za-z0-9_-]+/[A-Za-z0-9_-]+', args.proof):
            print(f"Error: --proof must be <domain>/<name>, got: {args.proof!r}", file=sys.stderr)
            sys.exit(1)
        if args.scene:
            print("Error: pass --proof or a scene, not both.", file=sys.stderr)
            sys.exit(1)
        initial_proof = args.proof
        if not args.json:
            print(f"Opening built-in proof: {initial_proof}")

    initial_scene_path = None
    if args.scene:
        scene_path = resolve_scene_path(args.scene)
        if not scene_path:
            print(f"Error: Scene file not found: {args.scene}", file=sys.stderr)
            sys.exit(1)
        if not args.json:
            print(f"Loading scene: {scene_path}")
        initial_scene_path = str(scene_path)

    serve_and_open(
        initial_scene_path,
        port=args.port,
        json_output=args.json,
        debug=args.debug,
        skip_tour=args.skip_tour,
        initial_proof=initial_proof,
        tts_parallelism=args.tts_parallelism,
        tts_min_buffer=args.tts_min_buffer,
        tts_min_sentence_chars=args.tts_min_sentence_chars,
        tts_min_sentence_chars_growth=args.tts_min_sentence_chars_growth,
        tts_chunk_timeout=args.tts_chunk_timeout,
        tts_max_retries=args.tts_max_retries,
        tts_retry_delay=args.tts_retry_delay,
        tts_style=args.tts_style,
        tts_live=args.tts_live,
        tts_output_file=args.tts_output_file,
        tts_realtime=not args.tts_buffered,
        server_only=args.server_only,
    )


if __name__ == "__main__":
    main()
