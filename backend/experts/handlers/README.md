# Expert handlers

A **handler** wraps a registered expert with custom **pre/post-processing**,
exposed through the single generic endpoint:

```
POST /api/expert/{name}
```

The DSPy expert itself lives under `../modules/` and stays pure (it only knows
how to turn a typed context into typed outputs). The handler is the
orchestration glue around one expert call:

1. **pre** — parse a feature-shaped request, build the expert's context payload
   (e.g. infer a missing input, parse LaTeX → semantic graphs);
2. **call** — `backend.experts.service.invoke("<expert>", context_id, payload, …)`;
3. **post** — turn the expert's typed outputs into the JSON the client needs
   (e.g. render a trajectory into animation data).

`service.run(name, body)` is the single dispatch point: if `name` has a handler
it validates `body` against the handler's `request_model` and calls it; otherwise
`name` is treated as a plain expert and `invoke` runs directly. Either way, **no
new endpoint wiring** — experts and handlers self-register and are reachable by
name.

Concurrency/abuse is handled once, at the endpoint, by the shared per-IP
`_agentic_rate_limit`. Handlers do **not** implement their own throttling.

## Adding a handler

1. Create `handlers/<name>/handler.py`:
   ```python
   from pydantic import BaseModel
   from backend.experts.registry import register_handler
   from backend.experts.service import invoke

   class MyRequest(BaseModel):
       ...

   @register_handler("my_handler", request_model=MyRequest)
   def my_handler(req: MyRequest) -> dict:
       # pre … → invoke("some_expert", …) → post …
       return {...}
   ```
2. Add `handlers/<name>/__init__.py` that imports `handler` so registration runs
   on discovery.

`discover_handlers()` (called by `init_experts()`) imports every subpackage here,
so the decorator fires at startup.
