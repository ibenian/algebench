"""Reusable base for Pydantic-AI agents.

A thin wrapper around `pydantic_ai.Agent` that gives subclasses a fixed shape:
- declare `name`, `system_prompt`, `result_type` (and optionally `model` / `max_retries`)
- call `self.run(input_data)` to execute the validate-and-retry loop synchronously.

Pydantic-AI owns the structured-output validation and retry; this class just
gives a clean call site and a single `AgentError` boundary.
"""

from __future__ import annotations

import json
import os
from typing import Any, ClassVar, Optional, Type

from pydantic import BaseModel


class AgentError(RuntimeError):
    """Raised when an agent fails (exhausted retries, missing creds, etc.)."""


class BaseAgent:
    """Subclasses set the four class attributes below."""

    name: ClassVar[str] = ""
    system_prompt: ClassVar[str] = ""
    result_type: ClassVar[Type[BaseModel]]
    model: ClassVar[Optional[str]] = None
    max_retries: ClassVar[int] = 2

    def __init__(self, *, model: Optional[str] = None, agent: Any = None) -> None:
        if agent is not None:
            self._agent = agent
            return

        if not os.environ.get("GEMINI_API_KEY") and not os.environ.get("GOOGLE_API_KEY"):
            raise AgentError(
                f"{self.name or type(self).__name__}: GEMINI_API_KEY (or GOOGLE_API_KEY) is not set"
            )

        try:
            from pydantic_ai import Agent
        except ImportError as exc:
            raise AgentError(f"pydantic-ai is not installed: {exc}") from exc

        chosen = (
            model
            or self.model
            or os.environ.get("GEMINI_MODEL")
            or "gemini-2.0-flash"
        )
        if ":" not in chosen and not chosen.startswith("google"):
            chosen = f"google-gla:{chosen}"

        self._agent = Agent(
            chosen,
            output_type=self.result_type,
            system_prompt=self.system_prompt,
            retries=self.max_retries,
        )

    def _build_prompt(self, input_data: Any) -> str:
        if isinstance(input_data, BaseModel):
            return input_data.model_dump_json()
        if isinstance(input_data, (dict, list)):
            return json.dumps(input_data, sort_keys=True)
        return str(input_data)

    def _unwrap(self, result: Any) -> BaseModel:
        output = getattr(result, "output", None)
        if output is None:
            output = getattr(result, "data", None)
        if output is None:
            raise AgentError(f"{self.name or type(self).__name__}: empty result from agent")
        return output

    def _wrap_exc(self, exc: Exception) -> "AgentError":
        """Wrap any underlying agent failure as ``AgentError``, surfacing
        validation details when present so we can see *which* field tripped
        instead of just ``Exceeded maximum retries``."""
        name = self.name or type(self).__name__
        details = self._extract_validation_details(exc) or str(exc)
        return AgentError(f"{name} failed: {details}")

    @staticmethod
    def _extract_validation_details(exc: Exception) -> Optional[str]:
        """Pull pydantic ValidationError messages out of pydantic-ai's
        retry-exhausted exceptions. Walks ``__cause__`` / ``__context__``
        looking for a ValidationError; returns ``str(exc)`` of that if
        found, else ``None`` so the caller falls back to the outer message."""
        try:
            from pydantic import ValidationError
        except ImportError:
            return None
        seen: set[int] = set()
        current: Optional[BaseException] = exc
        while current is not None and id(current) not in seen:
            seen.add(id(current))
            if isinstance(current, ValidationError):
                return f"{type(exc).__name__}: {current}"
            current = current.__cause__ or current.__context__
        return None

    def run(self, input_data: Any) -> BaseModel:
        """Execute the agent synchronously and return the validated result.

        Use from sync code only — pydantic-ai's ``run_sync`` calls
        ``asyncio.run`` internally and will raise inside an async context.
        """
        try:
            result = self._agent.run_sync(self._build_prompt(input_data))
        except Exception as exc:
            raise self._wrap_exc(exc) from exc
        return self._unwrap(result)

    async def arun(self, input_data: Any) -> BaseModel:
        """Async counterpart of :meth:`run` — safe to await inside FastAPI handlers."""
        try:
            result = await self._agent.run(self._build_prompt(input_data))
        except Exception as exc:
            raise self._wrap_exc(exc) from exc
        return self._unwrap(result)
