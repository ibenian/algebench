# Expert framework (DSPy)

An extensible framework of optimizable AI **experts**: each is a `dspy.Module`
that takes typed, Pydantic-validated input and emits typed, validated output.
Everything self-registers via **decorators** — there is **no config file**.
Adding an expert = drop a self-contained package under `modules/`; the registries
are the single source of truth, and every dispatch is a dict lookup (no
name-branching).

This package is independent of the chat/server stack and the pydantic-ai
enricher; it is never imported by `server.py`.

## Layout

Generic framework (top level):
```
__init__.py    init_experts(): configure DSPy + discover (import expert packages)
registry.py    EXPERT / CONTEXT_MODELS / METRIC registries + decorators
context_id.py  hierarchical target id: build / parse / terminal (the scope key)
outputs.py     the Output base (subclasses declare a `kind` Literal) + ExpertResult
service.py     stateless invoke(): payload -> validated context -> module -> ExpertResult
llm_config.py  configure_dspy() -> Gemini via litellm
modules/       one self-contained expert *package* each (discovered on startup)
```

Each expert lives in its own package under `modules/<name>/` and documents
itself in its own `README.md`. Current experts:

- **`modules/proof_completion/`** — start + target expression → a step-by-step
  derivation (trajectory of complete-expression *states*; atomic graph edits are
  recovered in code, each state SymPy-verified). See `modules/proof_completion/README.md`.

## How registration works

`init_experts()` calls `configure_dspy()` then `discover()`, which imports every
package under `modules/`. Each package's `__init__.py` imports its submodules so
the decorators fire:

- `@register_expert(name, context_scope=…, context_model=…)` on the `dspy.Module`
- `@register_metric(name)` on the metric
- `Output` subclasses declare a `kind` Literal (consumers dispatch on it)

`invoke` returns a typed `ExpertResult` holding the typed outputs (no dicts, no
output/handler registries); the transport edge serializes it once. No central
catalog file — the registries *are* the source of truth.

## Adding another expert

Drop a new package under `modules/<name>/` with: `module.py`
(`@register_expert`), `signature.py`, `metric.py` (`@register_metric`), and —
if it introduces a new output kind — `outputs.py` (an `Output` subclass with its
own `kind` Literal). Its `__init__.py` imports those submodules so the decorators
fire; discovery picks the package up automatically. `service.py`,
`context_id.py`, and the registries are never touched, and there is no config
file to edit. Add a `README.md` in the package documenting it.
