r"""A line-oriented DSPy adapter — no escape layer, so backslashes survive.

WHY THIS EXISTS
---------------
Every DSPy adapter that ships today carries structured field values as **JSON**.
``ChatAdapter`` looks like it doesn't — its ``[[ ## field ## ]]`` markers are
plain text — but the marker only wraps the field; the *value* still goes through
``json_repair.loads`` for any annotation that is not exactly ``str``. So a
``list[str]`` is JSON. A pydantic model is JSON. ``JSONAdapter`` and
``BAMLAdapter`` (which subclasses it) are JSON by construction.

That is fatal for LaTeX, because **JSON string escaping and LaTeX both use
backslash**, and five letters collide::

    \b  \f  \n  \r  \t   ->   \beta  \frac  \neq  \right  \theta  \times  \tau

A model that writes ``"\right"`` instead of ``"\\right"`` produces *valid* JSON
that decodes to a carriage return followed by ``ight`` — which then parses as the
implicit product ``i·g·h·t``. Nothing errors. The expression is still
well-formed, merely different, and it reaches the reader wearing whatever
confidence badge the pipeline computed. Observed in production: ``(x + b/2a)^2``
silently became ``(x + b/2a · i · g · h · t)^2``.

The model is not at fault in any fixable way — measured over a full response it
escapes correctly 90/90 times. It is a rare sampling slip on a task the model
already performs correctly, which is why it cannot be prompted away and why
repair is guesswork (``\r`` + ``ight`` is a legitimate reading of those bytes).

THE FIX IS TO REMOVE THE TASK
-----------------------------
This adapter's wire format has **no escape sequences at all**. A value is
"everything after ``key: `` to end of line", taken literally, so there is nothing
for the model to get right and nothing it can get wrong::

    [[ ## steps ## ]]
    change_type: rewrite
    operation: Divide both sides by $a$
    expr_latex: x^{2} + \frac{b}{a} \cdot x = -\frac{c}{a}
    justification: Make the leading coefficient 1.

    change_type: solve
    operation: Take the square root
    expr_latex: x + \frac{b}{2a} = \pm\sqrt{\frac{b^2-4ac}{4a^2}}
    justification: Both roots are kept.

This is the RFC 822 shape — email/HTTP headers, Debian ``deb822`` control files,
GNU recutils recfiles — not a new invention. Two properties earn their keep:

* **Split on the FIRST colon only**, so a colon inside a value is safe
  (``operation: Note: divide by a``). This is what disqualified YAML, whose
  plain scalars reject it outright.
* **No metacharacters**, so no leading character is reserved. YAML silently
  turns ``{x}`` into a mapping; JSON silently turns ``\right`` into a control
  character; ``configparser`` chokes on ``%``. None of that can happen here.

WHAT IT CANNOT CARRY, AND WHY THAT IS SAFE
------------------------------------------
A value cannot contain a newline — that is exactly what buys the escape-free
property. Verified against every saved proof in this repo: 366/366 values across
``expr_latex`` / ``operation`` / ``justification`` contain no CR or LF, and LaTeX
has no use for one (its line break is ``\\``; a literal newline is whitespace).

Anything the format cannot carry **raises**, never truncates. Silent truncation
would be the same class of bug in new clothes — and it is what DSPy's own
``XMLAdapter`` currently does when a value contains its closing tag
(stanfordnlp/dspy#10102).

SUPPORTED TYPES
---------------
==========================  =============================================
annotation                  wire form
==========================  =============================================
``str`` / ``int`` / …       the value, on the marker's own lines
``Literal[...]`` / Enum     the member, verbatim
``list[str]``               one item per line
``BaseModel``               one ``field: value`` block
``list[BaseModel]``         repeated blocks, separated by a blank line
==========================  =============================================

Deeper nesting is deliberately **rejected at format time** rather than silently
mis-rendered: a line format cannot express it, and pretending otherwise is how
formats acquire escape rules. Signatures needing that should use ``JSONAdapter``.

Nothing here is AlgeBench-specific; it is written to be proposable upstream.
Subclasses can retune the dialect via the class attributes without touching the
parsing logic.
"""

from __future__ import annotations

import enum
import re
import types
from functools import lru_cache
from typing import Any, Literal, Type, Union, get_args, get_origin

from pydantic import BaseModel

from dspy.adapters.chat_adapter import ChatAdapter, field_header_pattern
from dspy.adapters.utils import parse_value
from dspy.signatures.signature import Signature
from dspy.utils.exceptions import AdapterParseError


class LineFormatError(ValueError):
    """A value the line format cannot represent, or malformed model output.

    Always raised — never silently repaired or truncated. A refinement loop can
    turn this into a targeted retry, which is the honest response to output we
    know is wrong.
    """


# --------------------------------------------------------------------------- #
# type inspection (pure functions on annotations — no adapter state involved)
# --------------------------------------------------------------------------- #

def _is_model(a: Any) -> bool:
    return isinstance(a, type) and issubclass(a, BaseModel)


def _unwrap_optional(a: Any) -> Any:
    """``Optional[T]`` / ``T | None`` -> ``T``; anything else unchanged.

    BOTH spellings, deliberately. ``Optional[T]`` has ``get_origin`` of
    ``typing.Union``, but PEP 604's ``T | None`` has ``types.UnionType`` — a
    different object. Checking only the former left ``M | None`` unwrapped, so
    ``_is_leaf`` called it a scalar and it would have been ``str()``-ed into the
    line as garbage (Copilot, #522).
    """
    if get_origin(a) in (Union, types.UnionType):
        rest = [x for x in get_args(a) if x is not type(None)]
        if len(rest) == 1:
            return rest[0]
    return a


def _list_item_type(a: Any) -> Any | None:
    """Item type for ``list[T]``, else None."""
    a = _unwrap_optional(a)
    if get_origin(a) is list:
        args = get_args(a)
        return args[0] if args else str
    return None


@lru_cache(maxsize=1)
def _media_base() -> type | None:
    """DSPy's media/tool base class — ``Type`` in 3.x, ``BaseType`` in 2.6.

    Renamed in DSPy 3.0 (``dspy.adapters.types.BaseType`` -> ``.Type``). Probing
    only ONE spelling is not a cosmetic miss: :func:`_is_special` would return
    False for every media type on the other version, ``Image`` would then pass
    the leaf test, and an image output field would render as ``url: …`` — text
    where the provider expects an image part. That is the silent-corruption
    class this whole adapter exists to remove, so both names are tried.
    """
    from dspy.adapters import types as t
    return getattr(t, "Type", None) or getattr(t, "BaseType", None)


def _is_special(a: Any) -> bool:
    """True for DSPy's media/tool types (Image, Audio, History, ToolCalls, …).

    They serialise into multimodal message content blocks, not text, so the line
    format cannot carry them as OUTPUT fields.
    """
    try:
        base = _media_base()
    except Exception:                       # a DSPy without the types package
        return False
    return base is not None and isinstance(a, type) and issubclass(a, base)


#: Collection types this format cannot express, in BOTH spellings. ``get_origin``
#: alone is not enough: it returns the container for a *parameterised* generic
#: (``dict[str, str]`` -> ``dict``) but ``None`` for a BARE one (``dict``), so a
#: bare-``dict`` annotation passed the old check as a scalar. That mattered most
#: exactly where it was least visible — ``list[dict]`` is checked by its ITEM
#: type, so an unparameterised ``dict`` item made the whole field look
#: expressible, and each item would have been ``str()``-ed onto a line as a
#: Python repr (#543).
_COLLECTIONS = (list, dict, set, tuple, frozenset)


def _is_leaf(a: Any) -> bool:
    """True if ``a`` renders as a single line (not a model, not a collection)."""
    a = _unwrap_optional(a)
    if _is_model(a):
        return False
    if get_origin(a) in _COLLECTIONS:        # dict[str, str], list[int], …
        return False
    return not (isinstance(a, type) and issubclass(a, _COLLECTIONS))  # bare dict, set, …


# --------------------------------------------------------------------------- #
# the adapter
# --------------------------------------------------------------------------- #

class LineAdapter(ChatAdapter):
    r"""``ChatAdapter`` field markers, but values are LINES, never JSON.

    Subclasses ``ChatAdapter`` to reuse its message assembly and marker framing —
    the markers are safe; it is the per-field JSON that is not. Only the three
    methods that decide a field's *shape* are overridden.

    The codec is exposed as methods (``render_value`` / ``parse_field``) rather
    than module functions so a subclass can retune the dialect — change
    :attr:`KEY_SEP`, or override a single hook — without reimplementing the walk.

    THE SILENT FALLBACK IS OFF (issue #527)
    ---------------------------------------
    ``ChatAdapter.__call__`` catches *any* exception and silently re-runs the
    whole prediction through ``JSONAdapter``, logging nothing. For this adapter
    that fallback is not a safety net but a trapdoor: it costs a second,
    unlogged LM call and — the part that matters — hands the field values back
    to the JSON escape layer this class exists to remove, so the very corruption
    being prevented returns by the back door with no trace. It fooled the author
    once during development.

    DSPy 3.x added ``use_json_adapter_fallback``, so it can simply be refused;
    :attr:`SILENT_JSON_FALLBACK` is that switch. A parse failure now RAISES —
    consistent with every other refusal here, and the honest signal for a
    refinement loop to retry with feedback (``refine.py``). A signature this
    format genuinely cannot express should be given ``JSONAdapter`` explicitly
    rather than discovered by silent degradation at runtime.
    """

    #: Whether to allow ``ChatAdapter``'s unlogged JSONAdapter retry. OFF: see
    #: the class docstring. Requires DSPy >= 3.0 (2.6 has no such parameter, and
    #: constructing this class against it raises — loudly, which is the point).
    SILENT_JSON_FALLBACK: bool = False

    #: Separator between a key and its value. Also what ``parse`` splits on.
    KEY_SEP: str = ": "
    #: Characters a value may never contain (they would break the line framing).
    FORBIDDEN_IN_VALUE: tuple[str, ...] = ("\n", "\r")
    #: A key must be a bare identifier, so prose before a colon is not mistaken
    #: for one — this is what makes tolerating indentation safe.
    KEY_PATTERN: re.Pattern = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*): ?(.*)$")
    #: Splits repeated ``list[BaseModel]`` blocks.
    BLOCK_SPLIT: re.Pattern = re.compile(r"\n\s*\n")

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("use_json_adapter_fallback", self.SILENT_JSON_FALLBACK)
        super().__init__(*args, **kwargs)

    # ---------------------------------------------------------------- scalars

    def scalar_str(self, value: Any) -> str:
        """Render a leaf. Enums render as their value, not ``Enum.NAME``."""
        if isinstance(value, enum.Enum):
            value = value.value
        return "" if value is None else str(value)

    def check_value(self, field: str, text: str) -> str:
        """Reject a value the line framing cannot carry."""
        if any(c in text for c in self.FORBIDDEN_IN_VALUE):
            raise LineFormatError(
                f"{field!r} contains a newline, which the line format cannot "
                f"carry. Keep every value on one line.")
        return text

    # ---------------------------------------------------------------- render

    def check_model(self, model: Type[BaseModel], field: str) -> Type[BaseModel]:
        """Reject a model this format cannot express, LOUDLY and early.

        A block is a flat list of ``key: value`` lines, so a model field that is
        itself a model or a collection has nowhere to go. Without this check it
        would be ``str()``-ed into the line — ``steps: [DerivationStep(...)]`` —
        which renders, never parses back, and is precisely the silent-corruption
        class this adapter exists to remove. Flatten the nesting into the
        signature, or use ``JSONAdapter`` for that signature.
        """
        if _is_special(model):
            # DSPy's BaseType subclasses (Image, Audio, …) serialise into
            # multimodal message CONTENT BLOCKS, not text. ``Image`` in
            # particular has a single ``url: str`` field, so it passes the leaf
            # test and would render as ``url: …`` — text where the provider
            # expects an image part. Refuse rather than quietly break it.
            raise LineFormatError(
                f"{field}: {model.__name__} is a DSPy media/tool type that "
                f"serialises to message content, not text. It is supported as an "
                f"INPUT (this adapter does not touch inputs) but cannot be a "
                f"line-format output field.")
        bad = [n for n, f in model.model_fields.items() if not _is_leaf(f.annotation)]
        if bad:
            raise LineFormatError(
                f"{field}: {model.__name__} has non-leaf field(s) {bad} — the line "
                f"format is one level deep. Lift them into the signature as their "
                f"own output fields, or use JSONAdapter for this signature.")
        return model

    def render_model(self, model: BaseModel, field: str = "") -> str:
        self.check_model(type(model), field or type(model).__name__)
        return "\n".join(
            f"{name}{self.KEY_SEP}"
            f"{self.check_value(name, self.scalar_str(getattr(model, name)))}"
            for name in type(model).model_fields)

    def render_value(self, field: str, value: Any, annotation: Any) -> str:
        """A field's value in line form. Raises if it cannot be represented."""
        self.check_annotation(field, annotation)
        item = _list_item_type(annotation)
        if item is not None:
            items = list(value or [])
            if _is_model(item):
                return "\n\n".join(self.render_model(v, field) for v in items)
            out = []
            for v in items:
                text = self.check_value(field, self.scalar_str(v))
                if not text.strip():
                    # A blank line IS the absence of an item, so an empty string
                    # cannot be represented: ``['a', '', 'b']`` would read back
                    # as ``['a', 'b']``. Refuse rather than round-trip lossily.
                    raise LineFormatError(
                        f"{field}: an empty list item cannot be represented in "
                        f"the line format (a blank line means 'no item')")
                out.append(text)
            return "\n".join(out)
        if _is_model(_unwrap_optional(annotation)) and isinstance(value, BaseModel):
            return self.render_model(value, field)
        return self.check_value(field, self.scalar_str(value))

    # ----------------------------------------------------------------- parse

    def split_blocks(self, text: str, model: Type[BaseModel]) -> list[str]:
        """A repeated-model field's text -> one block of lines per item.

        A blank line is the documented separator and the one the prompt shows,
        but models run blocks together often enough that treating it as the ONLY
        separator is not viable. A key that REPEATS is unambiguous evidence the
        next item has begun — ``parse_block`` already rejects a key appearing
        twice within one block — so the split falls back to that.

        Without this, a run-together response raised ``duplicate key`` and every
        item was lost. For a caller that swallows parse failures (``propose_edit``
        returns "not an edit") the symptom is not an error but SILENCE: a valid
        request drops through to chat with nothing to show for it (#543).

        Lines that are not ``key: value`` at all are passed through untouched, so
        ``parse_block`` still raises on a value that spilled onto a second line.
        """
        blocks: list[str] = []
        current: list[str] = []
        seen: set[str] = set()

        def flush() -> None:
            if current:
                blocks.append("\n".join(current))
            current.clear()
            seen.clear()

        for chunk in self.BLOCK_SPLIT.split(text.strip()):
            for line in chunk.splitlines():
                if not line.strip():
                    continue
                m = self.KEY_PATTERN.match(line.strip())
                key = m.group(1) if m else None
                if key is not None and key in seen:
                    flush()                       # a repeat starts the next item
                if key is not None and key in model.model_fields:
                    seen.add(key)
                current.append(line)
            flush()                               # a blank line also ends an item
        return [b for b in blocks if b.strip()]

    def parse_block(self, block: str, model: Type[BaseModel], field: str) -> BaseModel:
        """One ``key: value`` block -> a model instance. Pydantic still validates."""
        self.check_model(model, field)
        data: dict[str, str] = {}
        for lineno, line in enumerate(block.splitlines(), 1):
            if not line.strip():
                continue
            # Leading indentation is TOLERATED: models mirror the indented
            # example in the prompt, and rejecting that made a well-formed
            # response fail — which the silent JSONAdapter fallback then hid.
            # What must fail is a line that is not ``key: value`` at all, i.e. a
            # value that spilled onto a second line; honouring it would silently
            # truncate the author's text. A spill worded like ``word: text`` is
            # caught either by KEY_PATTERN (prose has spaces) or by the
            # unknown-key check below.
            m = self.KEY_PATTERN.match(line.strip())
            if not m:
                raise LineFormatError(
                    f"{field}: line {lineno} is not 'key{self.KEY_SEP.strip()} "
                    f"value' — a value must not span lines: {line.strip()[:60]!r}")
            key, val = m.group(1), m.group(2)
            if key not in model.model_fields:
                raise LineFormatError(
                    f"{field}: line {lineno} has unknown key {key!r} "
                    f"(expected one of {sorted(model.model_fields)})")
            if key in data:
                raise LineFormatError(
                    f"{field}: duplicate key {key!r} in one block")
            data[key] = val
        if not data:
            raise LineFormatError(f"{field}: empty block")
        return model(**data)                 # pydantic validation is preserved

    def check_annotation(self, field: str, annotation: Any) -> Any:
        """Reject a field type this format cannot express — LOUDLY.

        Without this, an unsupported annotation falls through to DSPy's
        ``parse_value``, which means ``json_repair`` — silently reinstating the
        JSON escaping this adapter exists to remove. A ``dict`` field did exactly
        that, and a ``list[list[...]]`` was silently flattened.
        """
        inner = _unwrap_optional(annotation)
        item = _list_item_type(annotation)
        if item is not None:
            if not _is_model(item) and not _is_leaf(item):
                raise LineFormatError(
                    f"{field}: list[{getattr(item, '__name__', item)}] is nested "
                    f"beyond one level — the line format is one level deep. Use "
                    f"JSONAdapter for this signature.")
            return annotation
        if not _is_model(inner) and not _is_leaf(inner):
            raise LineFormatError(
                f"{field}: {annotation} is not expressible in the line format "
                f"(no mappings, sets or tuples). Use JSONAdapter for this "
                f"signature.")
        return annotation

    def parse_field(self, field: str, text: str, annotation: Any) -> Any:
        """A field's raw text -> a value of ``annotation``. Raises, never guesses."""
        self.check_annotation(field, annotation)
        item = _list_item_type(annotation)
        if item is not None:
            if _is_model(item):
                return [self.parse_block(b, item, field)
                        for b in self.split_blocks(text, item)]
            # Coerce each item to the declared type. Returning raw strings for a
            # ``list[int]`` would be a SILENT type error — the caller gets
            # ``['1', '2']`` where it declared ints, and pydantic never sees it
            # because the list is the field value, not a model.
            return [parse_value(ln.strip(), item)
                    for ln in text.splitlines() if ln.strip()]
        inner = _unwrap_optional(annotation)
        if _is_model(inner):
            return self.parse_block(text.strip(), inner, field)
        # Leaves keep DSPy's coercion (int/float/bool/Literal/Enum); ``str`` is
        # returned verbatim by ``parse_value``, which is exactly what we want.
        return parse_value(text.strip(), annotation)

    # ------------------------------------------------------- prompt assembly

    def describe_leaf(self, key: str, info: Any) -> str:
        """Prompt text for one leaf field inside a block.

        The description is NOT truncated, and a ``Literal``/Enum annotation has
        its allowed values enumerated. Both matter: the JSON-schema path the
        model used to see carried the full description and an ``enum`` list, so
        omitting them here is a regression that pushes the model toward guessing
        — it would know only the values that happen to appear in the signature's
        task docstring.
        """
        desc = getattr(info, "description", None) or key
        allowed = get_args(_unwrap_optional(getattr(info, "annotation", None)))
        origin = get_origin(_unwrap_optional(getattr(info, "annotation", None)))
        if origin is Literal and allowed:
            return f"{desc} — one of: " + " | ".join(str(a) for a in allowed)
        ann = _unwrap_optional(getattr(info, "annotation", None))
        if isinstance(ann, type) and issubclass(ann, enum.Enum):
            return f"{desc} — one of: " + " | ".join(str(m.value) for m in ann)
        return desc

    def describe_field(self, name: str, annotation: Any) -> str:
        """Prompt text for one output field.

        Derived from the annotation and the model's own field descriptions, so
        it cannot drift from what :meth:`parse_field` accepts.
        """
        def keys_of(model: Type[BaseModel]) -> str:
            self.check_model(model, name)
            return "\n".join(f"    {k}{self.KEY_SEP}<{self.describe_leaf(k, f)}>"
                             for k, f in model.model_fields.items())

        self.check_annotation(name, annotation)
        item = _list_item_type(annotation)
        if item is not None and _is_model(item):
            return (f"[[ ## {name} ## ]]\n"
                    f"  # one block per item, blank line between blocks:\n"
                    f"{keys_of(item)}")
        if item is not None:
            return f"[[ ## {name} ## ]]\n  # one item per line"
        inner = _unwrap_optional(annotation)
        if _is_model(inner):
            return f"[[ ## {name} ## ]]\n{keys_of(inner)}"
        return f"[[ ## {name} ## ]]\n{{{name}}}"

    # --------------------------------------------------------- Adapter hooks

    def format_field_structure(self, signature: Type[Signature]) -> str:
        parts = ["All interactions will be structured in the following way, "
                 "with the appropriate values filled in.\n",
                 "Values are LINES of plain text. Do NOT use JSON. Do NOT escape "
                 "backslashes — write LaTeX exactly as you would in a document "
                 r"(\frac{b}{2a}, not \\frac{b}{2a}). Every value is ONE line.",
                 ""]
        for name in signature.input_fields:
            parts.append(f"[[ ## {name} ## ]]\n{{{name}}}\n")
        for name, info in signature.output_fields.items():
            parts.append(self.describe_field(name, info.annotation) + "\n")
        parts.append("[[ ## completed ## ]]\n")
        return "\n".join(parts)

    def format_assistant_message_content(
        self, signature: Type[Signature], outputs: dict[str, Any],
        missing_field_message: str | None = None,
    ) -> str:
        """Render a DEMO in the dialect the model is asked to produce.

        Without this, few-shot examples would be shown as JSON while the prompt
        demands lines — silently teaching the wrong format, and baking it into
        any compiled program.
        """
        parts = []
        for name, info in signature.output_fields.items():
            body = (self.render_value(name, outputs[name], info.annotation)
                    if name in outputs else (missing_field_message or ""))
            parts.append(f"[[ ## {name} ## ]]\n{body}\n")
        parts.append("[[ ## completed ## ]]\n")
        return "\n".join(parts)

    def parse(self, signature: Type[Signature], completion: str) -> dict[str, Any]:
        sections: list[tuple[str | None, list[str]]] = [(None, [])]
        for line in completion.splitlines():
            m = field_header_pattern.match(line.strip())
            if m:
                rest = line[m.end():].strip()
                sections.append((m.group(1), [rest] if rest else []))
            else:
                sections[-1][1].append(line)

        fields: dict[str, Any] = {}
        for name, lines in sections:
            if name in signature.output_fields and name in fields:
                # ChatAdapter keeps the FIRST and drops the rest silently. That
                # is truncation, and this adapter's whole contract is to raise
                # rather than truncate: a second ``[[ ## steps ## ]]`` block
                # means the model produced more than we would return, and
                # dropping it loses derivation steps without a trace
                # (Copilot, #522).
                raise AdapterParseError(
                    adapter_name=type(self).__name__, signature=signature,
                    lm_response=completion,
                    message=f"output field {name!r} appears more than once; "
                            f"refusing to drop the later block(s)")
            if name in signature.output_fields:
                try:
                    fields[name] = self.parse_field(
                        name, "\n".join(lines).strip(),
                        signature.output_fields[name].annotation)
                except Exception as e:
                    raise AdapterParseError(
                        adapter_name=type(self).__name__, signature=signature,
                        lm_response=completion, message=str(e)) from e

        if fields.keys() != signature.output_fields.keys():
            missing = sorted(set(signature.output_fields) - set(fields))
            raise AdapterParseError(
                adapter_name=type(self).__name__, signature=signature,
                lm_response=completion,
                message=f"missing output field(s): {missing}")
        return fields
