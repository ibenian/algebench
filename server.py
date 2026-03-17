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
import asyncio
import webbrowser
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
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, Response, JSONResponse, HTMLResponse, FileResponse
from pydantic import BaseModel
import uvicorn
from google import genai
from google.genai import types

script_dir = Path(__file__).parent.resolve()
scenes_dir = script_dir / "scenes"

try:
    from gemini_live_tools import GeminiLiveAPI, pcm_to_wav_bytes, get_static_content as _glt_static, _split_sentences
    TTS_AVAILABLE = True
except ImportError:
    _glt_static = None
    TTS_AVAILABLE = False
static_dir   = script_dir / "static"
app_js_path  = static_dir / "app.js"
chat_js_path = static_dir / "chat.js"

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
GEMINI_MODEL   = os.environ.get('GEMINI_MODEL', 'gemini-3-flash-preview')

DEFAULT_PORT = 8785

index_html_path = static_dir / "index.html"
style_css_path  = static_dir / "style.css"

# ---------------------------------------------------------------------------
# Agent session memory — persists across turns within one server session.
# Stores eval_math results (and anything else) under agent-chosen keys.
# Cleared on server start; agents control what's stored via store_as param.
# ---------------------------------------------------------------------------
_agent_memory: dict = {}


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
    path = (scenes_dir / f"{name}.json").resolve()
    try:
        path.relative_to(scenes_dir.resolve())
    except ValueError:
        return None
    if path.exists():
        with open(path, 'r') as f:
            return json.load(f)
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


FAVICON_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="15" fill="#1a1a2e"/>
<line x1="20" y1="75" x2="80" y2="75" stroke="#ff4444" stroke-width="4"/>
<line x1="20" y1="75" x2="20" y2="15" stroke="#44ff44" stroke-width="4"/>
<line x1="20" y1="75" x2="55" y2="50" stroke="#4488ff" stroke-width="4"/>
<line x1="20" y1="75" x2="70" y2="30" stroke="#ffaa00" stroke-width="5" stroke-linecap="round"/>
<circle cx="70" cy="30" r="4" fill="#ffaa00"/>
</svg>'''


def generate_html(debug=False):
    """Read index.html and inject the debug flag."""
    debug_mode_js = "true" if debug else "false"
    with open(index_html_path, 'r') as f:
        return f.read().replace('__DEBUG_MODE__', debug_mode_js)

from agent_tools import (
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
            return f"Gemini API error: {str(e)}", [], debug_info

        # Log finish reason for debugging
        finish = None
        if response.candidates:
            candidate = response.candidates[0]
            finish = getattr(candidate, 'finish_reason', None)
            if finish:
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
                        print(f"   ✅ eval_math → memory['{store_as}']: {summary}")
                    else:
                        n = f"{len(result)}-point sweep" if isinstance(result, list) and sweep else result
                        tc_result = {"status": "success", "expression": expr, "result": result,
                                     "hint": "Tip: use store_as to save large arrays to memory instead of returning inline."}
                        print(f"   ✅ eval_math: {expr} = {n}")
                elif tc_name == 'mem_get':
                    key = tc_args.get('key', '')
                    if key == '?':
                        listing = {k: _memory_summary(k, v) for k, v in _agent_memory.items()}
                        tc_result = {"status": "success", "keys": listing if listing else "(empty)"}
                        print(f"   🗂️  mem_get(?): {list(_agent_memory.keys())}")
                    elif key in _agent_memory:
                        val = _agent_memory[key]
                        tc_result = {"status": "success", "key": key, "value": val,
                                     "summary": _memory_summary(key, val)}
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
                        print(f"   💾 mem_set['{key}']: {summary}")
                elif tc_name == 'set_preset_prompts':
                    prompts = tc_args.get('prompts', [])
                    tc_result = {
                        "status": "success",
                        "count": len(prompts),
                        "message": f"{'Set' if prompts else 'Cleared'} {len(prompts)} preset prompt{'s' if len(prompts) != 1 else ''}.",
                    }
                    print(f"   💬 set_preset_prompts: {prompts}")
                elif tc_name == 'set_info_overlay':
                    if tc_args.get('clear'):
                        tc_result = {"status": "success", "message": "Cleared all info overlays."}
                        print(f"   🖼️  set_info_overlay: cleared all")
                    else:
                        overlay_id = tc_args.get('id', '')
                        content = tc_args.get('content', '')
                        position = tc_args.get('position', 'top-left')
                        tc_result = {
                            "status": "success",
                            "id": overlay_id,
                            "position": position,
                            "message": f"Overlay '{overlay_id}' set at {position}.",
                        }
                        print(f"   🖼️  set_info_overlay['{overlay_id}'] @ {position}: {content[:60]}{'…' if len(content) > 60 else ''}")
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

def serve_and_open(initial_scene_path=None, port=DEFAULT_PORT, json_output=False, debug=False,
                   tts_parallelism=None, tts_min_buffer=None, tts_min_sentence_chars=None,
                   tts_min_sentence_chars_growth=None, tts_chunk_timeout=None,
                   tts_max_retries=None, tts_retry_delay=None, tts_style=None,
                   tts_live=True, tts_output_file=None):
    """Serve the AlgeBench viewer and optionally open in browser."""
    global DEBUG_MODE
    DEBUG_MODE = debug

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

    html_content = generate_html(debug=debug)
    current_spec = [None]

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

    # -- GET routes --

    @fastapp.get("/")
    @fastapp.get("/index.html")
    async def get_index():
        return HTMLResponse(
            content=html_content,
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Content-Security-Policy":
                    "script-src 'self' https://cdn.jsdelivr.net 'unsafe-eval' 'unsafe-inline'",
            }
        )

    @fastapp.get("/app.js")
    async def get_app_js():
        with open(app_js_path, 'r') as f:
            js = f.read()
        return Response(content=js.encode('utf-8'), media_type="application/javascript",
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

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

    @fastapp.get("/style.css")
    async def get_style_css():
        with open(style_css_path, 'r') as f:
            css = f.read()
        return Response(content=css.encode('utf-8'), media_type="text/css",
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    @fastapp.get("/objects/{filename:path}")
    async def get_objects_js(filename: str):
        """Serve ES module files from static/objects/ subdirectory."""
        safe = filename.replace('..', '').lstrip('/')
        path = static_dir / "objects" / safe
        if not path.is_file() or not path.suffix == '.js':
            return Response(status_code=404)
        with open(path, 'r') as f:
            js = f.read()
        return Response(content=js.encode('utf-8'), media_type="application/javascript",
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    _TOP_LEVEL_MODULES = {
        'state', 'expr', 'trust', 'coords', 'labels', 'follow-cam', 'camera',
        'sliders', 'overlay', 'context-browser', 'scene-loader', 'ui',
        'json-browser', 'main',
    }

    @fastapp.get("/{name}.js")
    async def get_module_js(name: str):
        """Serve any top-level ES module from the static directory."""
        if name not in _TOP_LEVEL_MODULES:
            return Response(status_code=404)
        path = static_dir / f"{name}.js"
        if not path.is_file():
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
        resolved_path = resolve_scene_path(requested)
        if not resolved_path:
            return JSONResponse({"error": "Scene file not found"}, status_code=404)
        try:
            with open(resolved_path, 'r') as f:
                scene = json.load(f)
            return JSONResponse({"spec": scene, "path": str(resolved_path),
                                 "label": resolved_path.name})
        except json.JSONDecodeError:
            return JSONResponse({"error": "Invalid JSON in scene file"}, status_code=400)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

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
        domains_root = (static_dir / 'domains').resolve()
        docs_path = (static_dir / 'domains' / name / 'docs.json').resolve()
        try:
            docs_path.relative_to(domains_root)
            safe = True
        except ValueError:
            safe = False
        if safe and docs_path.exists():
            with open(docs_path, 'rb') as f:
                return Response(content=f.read(), media_type="application/json")
        return Response(content=b'Domain not found', status_code=404)

    @fastapp.get("/domains/{path:path}")
    async def get_domain_file(path: str):
        domains_root = (static_dir / 'domains').resolve()
        domain_path = (static_dir / 'domains' / path).resolve()
        try:
            domain_path.relative_to(domains_root)
            safe = True
        except ValueError:
            safe = False
        if safe and domain_path.exists() and domain_path.is_file():
            with open(domain_path, 'rb') as f:
                return Response(content=f.read(), media_type="application/javascript")
        return Response(content=b'Domain not found', status_code=404)

    @fastapp.get("/scenes/{name:path}")
    async def get_scene(name: str):
        scene = load_builtin_scene(name)
        if scene:
            return JSONResponse(scene)
        return Response(content=b'Scene not found', status_code=404)

    @fastapp.get("/api/scene")
    async def get_current_scene():
        return JSONResponse(current_spec[0] if current_spec[0] else {})

    @fastapp.get("/shutdown")
    async def shutdown():
        threading.Thread(target=lambda: (time.sleep(0.5), os._exit(0))).start()
        return Response(content=b'Shutting down...')

    # -- POST routes --

    @fastapp.post("/api/chat")
    async def api_chat(req: ChatRequest):
        if not req.message.strip():
            return JSONResponse({"error": "Empty message"}, status_code=400)
        try:
            loop = asyncio.get_running_loop()
            response_text, tool_calls, debug_info = await loop.run_in_executor(
                None, lambda: call_gemini_chat(req.message, req.history, req.context)
            )
            print(f"   💬 Response ({len(response_text)} chars): {response_text}")
            return JSONResponse({"response": response_text, "toolCalls": tool_calls,
                                 "debug": debug_info})
        except Exception as e:
            import traceback
            print(f"   ❌ /api/chat error: {e}\n{traceback.format_exc()}")
            return JSONResponse({"error": str(e)}, status_code=500)

    @fastapp.post("/api/tts/stream")
    async def api_tts_stream(req: TtsRequest, request: Request):
        if not TTS_AVAILABLE or not GEMINI_API_KEY:
            return JSONResponse({"error": "TTS not available"}, status_code=503)
        text = req.text.strip()
        if not text:
            return JSONResponse({"error": "Empty text"}, status_code=400)

        import time as _time
        print(f"\n🔊 TTS stream: character={req.character}, voice={req.voice}, "
              f"mode={req.mode}, {len(text)} chars")

        api = GeminiLiveAPI(api_key=GEMINI_API_KEY, client=get_gemini_client())

        if req.mode == 'perform':
            t0 = _time.monotonic()
            loop = asyncio.get_running_loop()
            tts_text = await loop.run_in_executor(
                None, lambda: api.prepare_text(text, character_name=req.character)
            )
            print(f"🔊 TTS prepared ({_time.monotonic()-t0:.2f}s): {tts_text}")
        else:
            tts_text = text

        sentences = _split_sentences(
            tts_text,
            min_chars=tts_stream_kwargs.get('min_sentence_chars', 80),
            growth=tts_stream_kwargs.get('min_sentence_chars_growth', 2.0),
        )
        chunk_count = len(sentences)

        async def generate():
            async for chunk in api.astream_parallel_wav(
                text=tts_text,
                voice_name=req.voice,
                character_name=req.character,
                **tts_stream_kwargs
            ):
                if await request.is_disconnected():
                    break
                yield chunk

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

    @fastapp.post("/api/load")
    async def api_load(request: Request):
        body = await request.body()
        try:
            new_spec = json.loads(body)
            current_spec[0] = new_spec
            return JSONResponse({"status": "loaded"})
        except json.JSONDecodeError:
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    # ---- Start uvicorn in a background thread ----

    config = uvicorn.Config(fastapp, host="0.0.0.0", port=port, log_level="error")
    uvicorn_server = uvicorn.Server(config)

    def _run_server():
        uvicorn_server.run()

    server_thread = threading.Thread(target=_run_server, daemon=False)
    server_thread.start()
    time.sleep(0.5)

    url = f"http://localhost:{port}/"
    if initial_scene_path:
        url = f"{url}?scene={quote(str(initial_scene_path))}"

    if json_output:
        result = {
            "status": "success",
            "url": url,
            "port": port,
            "pid": os.getpid()
        }
        print(json.dumps(result, indent=2))
        sys.stdout.flush()
    else:
        webbrowser.open(url)
        print(f"Opened AlgeBench in browser")
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
                            uvicorn_server.should_exit = True
                            sys.exit(0)
                    time.sleep(0.1)
            except KeyboardInterrupt:
                termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
                print(f"\n\nServer stopped")
                uvicorn_server.should_exit = True
                sys.exit(0)
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
  algebench --tts-chunk-timeout 30               Seconds before chunk timeout (default: 15)
  algebench --tts-max-retries 5                  Max retries per sentence (default: library default)
  algebench --tts-retry-delay 2.0                Seconds between retries (default: library default)
  algebench --tts-style "speak slowly"           Additional style guidance for TTS
  algebench --tts-output-file out.wav            Save TTS audio to WAV file
        '''
    )
    parser.add_argument('scene', nargs='?', help='Path to scene JSON file')
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
    parser.add_argument('--tts-chunk-timeout', type=float, default=15.0,
                        help='Seconds to wait for next chunk before timing out (default: 15.0)')
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

    args = parser.parse_args()

    if not args.json:
        print(f"Checking port {args.port}...")
    kill_server_on_port(args.port)
    time.sleep(0.5)

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
    )


if __name__ == "__main__":
    main()
