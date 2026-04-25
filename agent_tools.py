"""Agent tool declarations and system prompt builder for AlgeBench."""

import json
import re
import os
from google.genai import types
from gemini_live_tools import safe_eval_math, eval_math_sweep, MATH_NAMES, HAS_NUMPY

NAVIGATE_TOOL_DECL = types.FunctionDeclaration(
    name="navigate_to",
    description="Navigate to a specific scene and step. When the user says 'next', advance by ONE step within the CURRENT scene (current step + 1). Only change the scene number when the user asks for a different topic. Always check Current State in the system prompt for your current scene and step before navigating.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "scene": types.Schema(type="INTEGER", description="Scene number (1-based). Scene 1 is the first scene, scene 2 is the second, etc."),
            "step": types.Schema(type="INTEGER", description="Step number within the scene. 0 = root/base scene (before any steps). 1 = first step, 2 = second step, etc."),
            "reason": types.Schema(type="STRING", description="Brief user-facing explanation of why navigating here"),
        },
        required=["scene", "step"],
    ),
)

SET_CAMERA_TOOL_DECL = types.FunctionDeclaration(
    name="set_camera",
    description="Set the 3D camera angle. Either use a named preset view OR specify a custom position. The available view names are listed in the current state context.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "view": types.Schema(
                type="STRING",
                description="Name of a preset camera view (e.g. 'iso', 'top', 'right'). Use this instead of position/target when a preset fits.",
            ),
            "position": types.Schema(
                type="ARRAY",
                items=types.Schema(type="NUMBER"),
                description="Custom camera position as [x, y, z] in data coordinates (same coordinate system as scene elements and range). Ignored if view is set.",
            ),
            "target": types.Schema(
                type="ARRAY",
                items=types.Schema(type="NUMBER"),
                description="Point the camera looks at as [x, y, z] (defaults to [0,0,0]). Only used with position.",
            ),
            "zoom": types.Schema(
                type="NUMBER",
                description="Zoom multiplier. Values > 1 zoom in (closer), < 1 zoom out (farther). Only used with position.",
            ),
            "reason": types.Schema(type="STRING", description="Brief explanation of why this angle is useful"),
        },
        required=[],
    ),
)

ADD_SCENE_TOOL_DECL = types.FunctionDeclaration(
    name="add_scene",
    description="Add a new 3D scene to the lesson. Pass scene fields (title, elements, steps, etc.) as DIRECT top-level arguments — do NOT nest them under a 'scene' key. IMPORTANT: sliders must be placed in steps[].sliders (renderer does not use top-level scene.sliders). The scene is appended and the client auto-navigates to it — do NOT call navigate_to after add_scene. See system prompt for the full scene schema and examples.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "title": types.Schema(type="STRING", description="Scene title (supports LaTeX)"),
            "description": types.Schema(type="STRING", description="Caption below viewport"),
            "markdown": types.Schema(type="STRING", description="Explanation panel with LaTeX"),
            "elements": types.Schema(type="ARRAY", items=types.Schema(type="OBJECT"), description="Array of element objects. Element labels support LaTeX — wrap math in $...$, e.g. \"$\\\\vec{a}_c$\" not \"\\\\vec{a}_c\". Plain text labels (no math) don't need $...$."  ),
            "steps": types.Schema(type="ARRAY", items=types.Schema(type="OBJECT"), description="Progressive reveal steps. Put interactive controls in step.sliders (not at scene root)."),
            "range": types.Schema(type="ARRAY", items=types.Schema(type="ARRAY", items=types.Schema(type="NUMBER")), description="Axis ranges [[xmin,xmax],[ymin,ymax],[zmin,zmax]]"),
            "camera": types.Schema(type="OBJECT", description="Camera position and target", properties={
                "position": types.Schema(type="ARRAY", items=types.Schema(type="NUMBER")),
                "target": types.Schema(type="ARRAY", items=types.Schema(type="NUMBER")),
            }),
        },
        required=["title", "elements"],
    ),
)


SET_SLIDERS_TOOL_DECL = types.FunctionDeclaration(
    name="set_sliders",
    description="Animate one or more sliders to target values. Use this to demonstrate how changing parameters affects the visualization. Each slider animates smoothly over ~800ms. Only use when sliders are active (listed in Current State).",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "values": types.Schema(
                type="OBJECT",
                description="Map of slider ID to target numeric value, e.g. {\"ax\": 4, \"bx\": 2}. Slider IDs are listed in the Active sliders section of Current State.",
            ),
        },
        required=["values"],
    ),
)


from gemini_live_tools import safe_eval_math, eval_math_sweep, MATH_NAMES, HAS_NUMPY


def _build_eval_math_description():
    """Build tool description dynamically from the actual MATH_NAMES registry."""
    # Constants: names whose values are plain numbers
    constants = sorted(k for k, v in MATH_NAMES.items() if isinstance(v, (int, float)))
    # Functions: everything else
    functions = sorted(k for k in MATH_NAMES if k not in constants)

    desc = (
        "Evaluate a math expression and return the exact numeric result. "
        "Use this to compute magnitudes, dot products, angles, areas, or any formula — "
        "so you can cite precise numbers rather than approximating. "
        "Current slider values are automatically available as variables by their ID.\n\n"
        "IMPORTANT: Use PYTHON syntax, not JavaScript. "
        "sin(x) not Math.sin(x), sqrt(x) not Math.sqrt(x), x**2 not x^2.\n\n"
        f"Available functions: {', '.join(functions)}.\n"
        f"Available constants: {', '.join(constants)}.\n\n"
        "VECTOR/MATRIX usage: pass vectors/matrices as variables (lists or nested lists), "
        "e.g. variables={a: [1,2,3], M: [[1,2],[3,4]]}. "
        "Use vec([x,y,z]) to construct a vector inline. "
        "Use A @ b for matrix-vector multiply."
    )
    if not HAS_NUMPY:
        desc += " (Note: numpy not available — vector/matrix functions disabled.)"
    return desc


EVAL_MATH_TOOL_DECL = types.FunctionDeclaration(
    name="eval_math",
    description=_build_eval_math_description(),
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "expression": types.Schema(
                type="STRING",
                description=(
                    "PYTHON syntax (not JavaScript): use sin(x) not Math.sin(x), "
                    "sqrt(x) not Math.sqrt(x), x**2 not x^2 or Math.pow(x,2). "
                    "Scalar examples: 'sqrt(ax**2 + ay**2 + az**2)', 'degrees(atan2(ay, ax))'. "
                    "Vector examples (pass vectors via variables): "
                    "'norm(a)', 'dot(a, b)', 'angle(a, b)', 'normalize(a)', "
                    "'proj(a, b)', 'A @ b', 'det(M)'. "
                    "Inline vector literal: 'norm(vec([3,4,0]))'."
                ),
            ),
            "variables": types.Schema(
                type="OBJECT",
                description=(
                    "Optional name→value bindings. Scalars (numbers) and vectors/matrices "
                    "(lists or nested lists) are both accepted. "
                    "Slider IDs are injected automatically as scalars. "
                    "Example: {a: [1,2,3], b: [4,5,6], M: [[1,2],[3,4]]}. "
                    "Keys are plain identifiers — do NOT quote them."
                ),
            ),
            "sweep_var": types.Schema(
                type="STRING",
                description="Variable to sweep over, e.g. 'x' or 'theta'. Required when using sweep_start/sweep_end or sweep_values.",
            ),
            "sweep_start": types.Schema(type="NUMBER", description="Sweep range start value."),
            "sweep_end": types.Schema(type="NUMBER", description="Sweep range end value."),
            "sweep_steps": types.Schema(type="INTEGER", description="Number of points in the sweep (default 64)."),
            "sweep_values": types.Schema(
                type="ARRAY",
                items=types.Schema(type="NUMBER"),
                description="Explicit list of values to sweep over (alternative to sweep_start/sweep_end/sweep_steps).",
            ),
            "store_as": types.Schema(
                type="STRING",
                description=(
                    "Store the result in agent memory under this key instead of returning the full value. "
                    "Use short descriptive names like 'sin_pts', 'froms', 'eigenvals'. "
                    "Stored values are automatically available as variables in future eval_math expressions. "
                    "Reference them in add_scene element fields as '$key' (e.g. 'points': '$sin_pts'). "
                    "Always use store_as for large arrays (sweep results, matrices) to keep context small."
                ),
            ),
        },
        required=["expression"],
    ),
)


MEM_GET_TOOL_DECL = types.FunctionDeclaration(
    name="mem_get",
    description=(
        "Retrieve a value from agent memory by key. "
        "Returns the stored value (scalar, list, or nested list). "
        "Use to inspect what's stored, verify a value, or pass it to another context. "
        "Call mem_get('?') to list all stored keys."
    ),
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "key": types.Schema(
                type="STRING",
                description="Memory key to retrieve. Pass '?' to list all stored keys and their shapes.",
            ),
        },
        required=["key"],
    ),
)

MEM_SET_TOOL_DECL = types.FunctionDeclaration(
    name="mem_set",
    description=(
        "Store any value in agent memory under a key. "
        "Use for scalars, vectors, matrices, or any data you want to reference later. "
        "Stored values can be referenced as variables in eval_math, or as '$key' in add_scene fields. "
        "Prefer eval_math store_as for computed results; use mem_set for literals you already have."
    ),
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "key": types.Schema(
                type="STRING",
                description="Key to store under. Short descriptive name, e.g. 'origin', 'basis_x', 'pts'.",
            ),
            "value": types.Schema(
                type="OBJECT",
                description="Value to store. Can be a number, list, nested list, or any JSON-serializable data.",
            ),
        },
        required=["key", "value"],
    ),
)


SET_PRESET_PROMPTS_TOOL_DECL = types.FunctionDeclaration(
    name="set_preset_prompts",
    description="Set suggested prompt chips above the chat input. Users see these as clickable buttons — click sends immediately, shift-click fills the input for editing. Pass an empty list to clear all chips. Use proactively to suggest relevant follow-ups after explaining a concept or completing a task. Call at most once per turn — calling it twice replaces the first set.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "prompts": types.Schema(
                type="ARRAY",
                items=types.Schema(type="STRING"),
                description="Prompt strings to display as chips. 2-5 suggestions recommended. Keep each under 60 characters.",
            ),
        },
        required=["prompts"],
    ),
)


SET_INFO_OVERLAY_TOOL_DECL = types.FunctionDeclaration(
    name="set_info_overlay",
    description="Add, update, or remove a floating info overlay on the 3D canvas. Overlays render LaTeX and live math that updates automatically when sliders change. Use {{slider_id}} / {{expression}} placeholders for live values. Call with clear=true to remove all overlays. REQUIRED: when not clearing, you MUST pass a stable `id` (e.g. 'matrix', 'formula') — id-less calls are dropped. Use proactively to show matrix representations, formulas, or key values while users explore a scene.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "id": types.Schema(
                type="STRING",
                description="REQUIRED unless clear=true. Stable, unique identifier for this overlay (e.g. 'matrix', 'formula', 'energy'). Reuse the same id to update an existing overlay; pick a new id for a distinct overlay. Without an id the call is rejected.",
            ),
            "content": types.Schema(
                type="STRING",
                description="Content to display — same rendering as step captions: $...$ inline math, $$...$$ display math, plain text, \\n for line breaks. Use {{slider_id}} / {{expression}} for live values, e.g. '$$\\\\begin{pmatrix} {{a}} & {{b}} \\\\\\\\ {{c}} & {{d}} \\\\end{pmatrix}$$'. CRITICAL: only double-brace placeholders are evaluated; single-brace {id} is not evaluated. Omit when clear=true.",
            ),
            "position": types.Schema(
                type="STRING",
                description="Position on canvas: 'top-left' (default), 'top-right', 'top-center', 'bottom-left', or 'bottom-right'.",
            ),
            "clear": types.Schema(
                type="BOOLEAN",
                description="If true, remove all overlays and ignore id/content.",
            ),
        },
    ),
)

NAVIGATE_PROOF_TOOL_DECL = types.FunctionDeclaration(
    name="navigate_proof",
    description="Navigate to a specific step in the current mathematical proof or derivation. Use to walk through proofs step by step, jump to key steps, or return to the goal overview.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "step": types.Schema(
                type="INTEGER",
                description="Proof step number (1-based). 0 = show goal overview. 1 = first step, etc.",
            ),
            "reason": types.Schema(
                type="STRING",
                description="Brief explanation of why navigating to this step (used for narration).",
            ),
        },
        required=["step"],
    ),
)

ALL_TOOL_DECLS = [
    NAVIGATE_TOOL_DECL,
    SET_CAMERA_TOOL_DECL,
    ADD_SCENE_TOOL_DECL,
    SET_SLIDERS_TOOL_DECL,
    EVAL_MATH_TOOL_DECL,
    MEM_GET_TOOL_DECL,
    MEM_SET_TOOL_DECL,
    SET_PRESET_PROMPTS_TOOL_DECL,
    SET_INFO_OVERLAY_TOOL_DECL,
    NAVIGATE_PROOF_TOOL_DECL,
]

def _make_tools(*exclude_names):
    decls = [d for d in ALL_TOOL_DECLS if d.name not in exclude_names]
    return [types.Tool(function_declarations=decls)]


def _load_agent_tools_reference():
    """Load the agent tools reference from the external markdown file."""
    ref_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'agent-tools-reference.md')
    try:
        with open(ref_path, 'r') as f:
            return f.read()
    except FileNotFoundError:
        return ""

_AGENT_TOOLS_REFERENCE = _load_agent_tools_reference()


def _memory_summary_line(key, value):
    """Human-readable one-liner describing a stored value."""
    if isinstance(value, list):
        if value and isinstance(value[0], list):
            return f"list of {len(value)} lists (e.g. {len(value[0])}-element)"
        return f"list [{len(value)} items]"
    if isinstance(value, (int, float)):
        return f"scalar {value}"
    return str(type(value).__name__)


def _demote_markdown_headers(markdown_text):
    """Shift embedded markdown headings down two levels, capped at ######."""
    if not markdown_text:
        return markdown_text

    def repl(match):
        level = min(len(match.group(1)) + 2, 6)
        return ('#' * level) + ' '

    return re.sub(r'^(#{1,6})\s+', repl, markdown_text, flags=re.MULTILINE)


def build_system_prompt(context, agent_memory=None):
    """Build system prompt with full visualization context."""
    parts = ["You are an AI math tutor embedded in an interactive 3D linear algebra visualization.\n"]
    instructions_text = """
## Instructions
- You are a math tutor. **Only call `add_scene` when the user explicitly asks to "show", "visualize", "build", "create", or "plot" something, or when you are already in an active scene and a new visualization clearly improves understanding.** For questions, explanations, calculations, and navigation — answer in chat without building a new scene. Unsolicited scene creation distracts the user and risks errors.
- Use LaTeX ($...$) for math notation — the client renders it. Always use single backslashes: `$\\theta$` not `$\\\\theta$`.
- **Navigation — answer first, navigate only when explicitly asked**: If the user asks a question, answer it in chat. Do NOT navigate as a response to a question. Only call `navigate_to` when the user uses explicit navigation words: "next", "previous", "back", "go to step N", "show me scene X", "skip to", etc. A question like "what does this mean?" or "why does that happen?" is a request for explanation, not navigation. When in doubt, answer in text.
- **Proposing navigation**: If you think the user would benefit from seeing a different step or scene, propose it in chat first — e.g. "Step 3 shows this geometrically — want me to take you there?" — and only navigate if they say yes or use an explicit navigation word in reply.
- **Navigation mechanics**: When navigating forward, go to the NEXT STEP within the CURRENT scene (same scene number, increment step by 1). Only change scene when the user explicitly asks for a different topic. Scenes are 1-based (scene 1 = first). Steps: 0 = root/base, 1 = first step, 2 = second. Always read current position from Current State above.
- **One navigation per turn**: Never call `navigate_to` more than once in a single response. Never auto-advance through multiple steps in one turn.
- Use the set_camera tool to adjust the viewing angle. You can use a preset view name (e.g. view="top") or custom position/target coordinates. Use zoom (e.g. zoom=1.5 closer, zoom=0.5 farther) with custom positions to control distance.
- Use the tools in whatever order makes sense for the request. You have full discretion.
- Build scenes with 4-7 steps that progressively reveal the concept. Each step should have a detailed, conversational description that teaches.
- Always include a comprehensive markdown explanation with LaTeX formulas, definitions, and worked calculations.
- Describe what's visible when asked "what am I looking at?"
- **Keep chat responses short and direct** — 1–3 sentences max for explanations, unless the user explicitly asks for more detail. Let the scene, steps, and markdown panel do the heavy teaching. Never re-explain what's already visible in the scene or markdown.
- **Unclear or vague questions**: If the user's request is ambiguous (e.g. "show me something", "explain it", "make it nicer"), do NOT guess — ask one clarifying question. Keep the question brief: "Which part would you like explained?" or "Do you mean [X] or [Y]?"
- Do not write scene JSON as text in chat — make tool calls so things actually render.
- **CRITICAL**: Always call `set_preset_prompts` as a function tool call. NEVER write the prompts as JSON text in your response.
- **CRITICAL**: NEVER use `{{expr}}` placeholders in your chat response text. Placeholders like `{{theta}}` or `{{toFixed(v,1)}}` only work inside `set_info_overlay` content, not in chat messages. In chat, write computed values directly or describe them in words.
- **STATE over history**: The Current State section is always authoritative for scene, step, sliders, and camera.
- **Tool capabilities**:
  - `eval_math`: compute exact numbers. When asked to "compute", "calculate", "get", or "make a series" — call `eval_math` and let the result appear in chat. To sweep a range: set `sweep_var="x"`, `sweep_start`, `sweep_end`, `sweep_steps`. Only pipe the result into `add_scene` if the user also wants a visualization. Expression syntax is Python: `sin(x)` not `Math.sin(x)`, `x**2` not `x^2`.
  - `add_scene`: build a visualization. **Only call when the user explicitly requests it or when it clearly serves the current interaction — not as a default response to every question.** A `line` with many `points` draws a curve; `vectors` with `froms`/`tos` arrays draws a series of arrows. Do not hardcode arrays that could be computed — use `eval_math` first. **Put sliders only in `steps[].sliders` (never top-level `scene.sliders`).**
  - `set_sliders`: animate sliders to show how parameters change the visualization.
  - `set_preset_prompts`: call this **once** per response to surface 2–4 follow-up chips. Always a function call — never inline JSON. Never call it more than once per turn. **Do NOT also list them as links or bullets in your response text** — they already appear as buttons in the UI.
  - `set_info_overlay`: show a live LaTeX panel on the canvas. **REQUIRED: always pass a stable `id`** (e.g. `'matrix'`, `'formula'`, `'energy'`) — calls without an id are dropped. Reuse the same id to update an overlay; pick a new id for a distinct one. Use `{{expr}}` placeholders (math.js syntax) so values update automatically. Examples: `{{a}}` (slider value), `{{a*d-b*c}}` (determinant), `{{toFixed(sqrt(a^2+b^2), 2)}}` (formatted magnitude), `{{toFixed(2*pi*rpm/60, 3)}}` (angular velocity), `{{v > 0 ? "stable" : "unstable"}}` (conditional string). Do NOT use single-brace `{...}` placeholders. Always add a matrix overlay when sliders define a matrix. Call with `clear: true` to remove all overlays.
  - `parametric_curve`: continuous smooth curve using math.js expressions — use `sin(t)` not `Math.sin(t)`, `pi` not `Math.PI`, `pow(x,n)` or `x^n` not `x**n`. Use only when a slider drives the shape live and exact point values are not needed.
  - **math.js expression syntax** (used in all animated elements, parametric_curve, and info overlay placeholders): trig `sin cos tan asin acos atan atan2` · power `pow(x,n)` or `x^n` · roots `sqrt cbrt` · exp/log `exp log log2 log10` · rounding `floor ceil round fix` · misc `abs sign min max hypot` · constants `pi e` · ternary `cond ? a : b` · formatting `toFixed(val, n)`. Do NOT use `Math.sin`, `Math.PI`, `x.toFixed()`, or JS keywords (`let`, `return`, `=>`).
"""
    parts.append(instructions_text)

    # Current scene definition — the full JSON the client is rendering
    scene = context.get('currentScene', {})
    runtime = context.get('runtime', {})

    parts.append("## Current State\n*This entire system prompt is rebuilt fresh on every user message. Always trust it over chat history for scene, step, camera, sliders, and all UI state. If chat history contradicts STATE, ignore history and follow STATE.*")
    if context.get('lessonTitle'):
        parts.append(f"- Lesson: {context['lessonTitle']}")
    scene_num = context.get('sceneNumber', 1)  # 1-based
    total_scenes = context.get('totalScenes', '?')
    if scene.get('title'):
        parts.append(f"- Scene: {scene_num}/{total_scenes} \"{scene['title']}\"")
    step_num = runtime.get('stepNumber', 0)  # 0=root, 1=first step, etc.
    total_steps = len(scene.get('steps', []))
    if step_num == 0:
        parts.append(f"- Step: 0 (root/base scene) — {total_steps} steps available" if total_steps > 0 else "- Step: 0 (root/base scene, no steps)")
    elif total_steps > 0 and step_num >= 1 and step_num <= total_steps:
        step = scene['steps'][step_num - 1]
        parts.append(f"- Step: {step_num}/{total_steps}: \"{step.get('title', '')}\"")
    if runtime.get('cameraPosition'):
        cp = runtime['cameraPosition']
        parts.append(f"- Camera position: ({cp['x']}, {cp['y']}, {cp['z']})")
    if runtime.get('cameraTarget'):
        ct = runtime['cameraTarget']
        parts.append(f"- Camera target: ({ct['x']}, {ct['y']}, {ct['z']})")
    if runtime.get('cameraViews'):
        parts.append(f"- Available camera views: {', '.join(runtime['cameraViews'])}")
    if runtime.get('visibleElements'):
        items = [f"{e.get('label', e.get('type', '?'))} ({e.get('type', '?')})" for e in runtime['visibleElements']]
        parts.append(f"- Visible elements: {', '.join(items)}")
    if runtime.get('sliders'):
        slider_parts = []
        for k, v in runtime['sliders'].items():
            if isinstance(v, dict):
                label = v.get('label', k)
                slider_parts.append(f"{label} ({k})={v['value']} [range: {v['min']}..{v['max']}, step: {v['step']}]")
            else:
                slider_parts.append(f"{k}={v}")
        parts.append(f"- Active sliders: {', '.join(slider_parts)}")
    if runtime.get('currentCaption'):
        parts.append(f"- Caption displayed to user: \"{runtime['currentCaption']}\"")
    if runtime.get('projection'):
        parts.append(f"- Projection: {runtime['projection']}")
    if runtime.get('activeTab'):
        parts.append(f"- User viewing: {runtime['activeTab']} panel")

    # Scene tree for navigation
    if context.get('sceneTree'):
        parts.append("\n## Lesson Structure")
        parts.append("All numbers are 1-based. Use `navigate_to(scene=N, step=0)` for root, `step=1` for first step.")
        for s in context['sceneTree']:
            parts.append(f"- Scene {s['sceneNumber']}: {s['title']}")
            if s.get('steps'):
                for st in s['steps']:
                    desc = f" — {st['description']}" if st.get('description') else ''
                    parts.append(f"  - Step {st['stepNumber']}: {st['title']}{desc}")

    # Scene JSON — only include steps up to the current one so the agent
    # doesn't read ahead and explain future steps.
    if scene:
        step_num = runtime.get('stepNumber', 0)
        scene_for_prompt = {k: v for k, v in scene.items() if k not in ('markdown', 'prompt', 'steps', 'proof')}
        if scene.get('steps'):
            # Only include steps up to and including the current step (1-based → slice [:step_num]).
            # Strip instructional fields here so raw scene JSON stays focused on render state.
            visible_steps = scene['steps'][:step_num] if step_num > 0 else []
            scene_for_prompt['steps'] = [
                {k: v for k, v in step.items() if k not in ('prompt', 'markdown', 'proof')}
                for step in visible_steps
            ]
        parts.append(f"\n## Current Scene Definition\n```json\n{json.dumps(scene_for_prompt, indent=2)}\n```")

    # Scene documentation (from scene markdown) is nested one level deeper so it
    # stays subordinate to the prompt's own top-level sections.
    if scene.get('markdown'):
        parts.append(f"\n## Scene Documentation\n{_demote_markdown_headers(scene['markdown'])}")

    # Agent memory — show stored keys so agent knows what's available
    if agent_memory:
        mem_lines = [f"  - {k}: {_memory_summary_line(k, v)}" for k, v in agent_memory.items()]
        parts.append("\n## Agent Memory\nKeys currently in memory (reference as variable or '$key' in add_scene):\n" + "\n".join(mem_lines))

    # Scene-specific agent instructions
    if scene.get('prompt'):
        parts.append(f"\n## Current Scene Instructions\n{scene['prompt']}")

    # Step-specific agent instructions for the active step only
    if total_steps > 0 and step_num >= 1 and step_num <= total_steps:
        step = scene['steps'][step_num - 1]
        if step.get('prompt'):
            parts.append(f"\n## Active Scene Step Instructions\n{step['prompt']}")

    # Proof context — only include when the proof panel is expanded
    proof_ctx = runtime.get('proof')
    if proof_ctx and proof_ctx.get('expanded'):
        proof_title = proof_ctx.get('title', 'Untitled Proof')
        step_count = proof_ctx.get('stepCount', 0)
        proof_step_idx = proof_ctx.get('currentStepIndex', -1)

        # Active Proof — technique + goal + guidance
        technique_str = f" ({proof_ctx['technique']})" if proof_ctx.get('technique') else ""
        goal_str = f"\n{proof_ctx['goal']}" if proof_ctx.get('goal') else ""
        hint_str = f"\n\n*Technique hint:* {proof_ctx['techniqueHint']}" if proof_ctx.get('techniqueHint') else ""
        guidance_str = f"\n\n*Guidance:* {proof_ctx['proofPrompt']}" if proof_ctx.get('proofPrompt') else ""
        parts.append(f"\n## Active Proof: {proof_title}{technique_str}{goal_str}{hint_str}{guidance_str}")

        # Completed steps — compact
        prev_steps = proof_ctx.get('previousSteps')
        if prev_steps:
            lines = []
            for s in prev_steps:
                math_str = f": ${s['math']}$" if s.get('math') else ""
                lines.append(f"{s['step']}. {s.get('label', '?')}{math_str}")
            parts.append(f"\n## Completed Proof Steps\n" + "\n".join(lines))

        # Current step — detailed
        current_step = proof_ctx.get('currentStep')
        if current_step:
            step_parts = []
            if current_step.get('math'):
                step_parts.append(f"- Math: ${current_step['math']}$")
            if current_step.get('justification'):
                step_parts.append(f"- Justification: {current_step['justification']}")
            if current_step.get('explanation'):
                step_parts.append(f"- Explanation: {current_step['explanation']}")
            if current_step.get('stepPrompt'):
                step_parts.append(f"\n*Step guidance:* {current_step['stepPrompt']}")
            parts.append(f"\n## Active Proof Step {current_step['step']} of {step_count}: {current_step.get('label', '?')}\n" + "\n".join(step_parts))
        elif proof_step_idx < 0:
            parts.append(f"\n## Active Proof Step\nGoal overview ({step_count} steps total)")

        # Upcoming steps — labels only (roadmap)
        upcoming = proof_ctx.get('upcomingSteps')
        if upcoming:
            lines = [f"{s['step']}. {s.get('label', '?')}" for s in upcoming]
            parts.append(f"\n## Upcoming Proof Steps\n" + "\n".join(lines))

    # Agent tools reference (loaded from external file)
    if _AGENT_TOOLS_REFERENCE:
        parts.append(_AGENT_TOOLS_REFERENCE)

    # Log context breadcrumbs — which sections were included
    sections = ["Instructions", "Current State", "Lesson Structure", "Current Scene Definition", "Scene Documentation", "Current Scene Instructions", "Current Step Instructions", "Agent Tools Reference"]
    included = []
    prompt_text = "\n".join(parts)
    for s in sections:
        if f"## {s}" in prompt_text:
            included.append(s)
    import server as _srv
    if getattr(_srv, 'DEBUG_MODE', False):
        print(f"   📋 System prompt sections: {', '.join(included)} ({len(prompt_text)} chars)")

    return prompt_text
