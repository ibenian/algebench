"""Unit tests for `agents.base.BaseAgent` using Pydantic-AI's TestModel."""

from __future__ import annotations

import os
from typing import ClassVar, Type

import pytest
from pydantic import BaseModel

from agents.base import AgentError, BaseAgent


class _Echo(BaseModel):
    message: str


def _make_agent(model) -> BaseAgent:
    """Construct a BaseAgent subclass against a pre-built pydantic_ai.Agent."""
    from pydantic_ai import Agent

    class _Subject(BaseAgent):
        name = "test_subject"
        system_prompt = "Echo the message."
        result_type: ClassVar[Type[BaseModel]] = _Echo

    real_agent = Agent(model, output_type=_Echo, system_prompt="Echo the message.", retries=2)
    return _Subject(agent=real_agent)


def test_run_returns_validated_output() -> None:
    from pydantic_ai.models.test import TestModel

    test_model = TestModel(custom_output_args={"message": "hello world"})
    subject = _make_agent(test_model)

    out = subject.run({"input": "anything"})

    assert isinstance(out, _Echo)
    assert out.message == "hello world"


def test_run_translates_pydantic_ai_failure_to_agent_error() -> None:
    from pydantic_ai.models.function import AgentInfo, FunctionModel
    from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart

    def always_invalid(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[TextPart(content="not json at all")])

    func_model = FunctionModel(always_invalid)
    subject = _make_agent(func_model)

    with pytest.raises(AgentError):
        subject.run({"input": "anything"})


def test_missing_api_key_raises() -> None:
    saved = {k: os.environ.pop(k, None) for k in ("GEMINI_API_KEY", "GOOGLE_API_KEY")}
    try:

        class _Subject(BaseAgent):
            name = "needs_key"
            system_prompt = "x"
            result_type: ClassVar[Type[BaseModel]] = _Echo

        with pytest.raises(AgentError, match="GEMINI_API_KEY"):
            _Subject()
    finally:
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v
