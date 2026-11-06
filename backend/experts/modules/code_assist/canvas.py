"""The code canvas's vocabulary: the marks the assistant draws on the learner's code, in Type along's focus mode.

It knows only the code: lines, names and expressions in the editor. Drawing on the 3D view is the presenter's
(``scene_present``), a separate expert with its own vocabulary.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

CANVAS_RULES = """The code canvas is on: the learner is in focus mode with the presenter on, seeing only the editor and you, and you
draw on their code as on a whiteboard, as a teacher would while talking. This is how you point now: when a step talks
about code, its `draw` marks that code, rather than `select` or describing where to look (`draw: [{"kind": "circle",
"line": 3, "text": "total"}, {"kind": "arrow", "line": 7, "text": "count", "to_line": 3, "to_text": "total"}]`).
Leave it empty only when a mark would add nothing. Asked to show or draw something, you do it here, on the code it is about, with `draw` never empty, and a worked
example in notes and shapes if it helps. Marks on other code that the talk has left go in `erase_marks`. Ring a parameter or sub-expression, box the
lines of a loop, an arrow from a name to where it is used or from a line to the line that runs next, a check or a
cross on what is right or wrong, a short note beside a line (a value at that point: `half = 8`), and to the right
of the code a small sketch of shapes (the call chain, a list's contents) that arrows can point to. A few marks that
say one thing; they are over the code and never change it. Refer to the code only as the editor holds it. What you
draw stays until you remove it: `canvas_marks` lists what is there now, by name, and a step's `erase_marks` takes
off what no longer helps, or "all" when the talk moves on. Don't draw again what is already there. A check or a cross leaves by itself when the code it judged changes. With `hint_level`
"question" or "vague", words alone: `draw` and `erase_marks` stay empty."""

KINDS = {"circle", "underline", "box", "check", "cross", "arrow", "note", "shape"}
#: Enough for a teacher's sketch; more is noise on the learner's code.
MAX_MARKS = 12


class CanvasMark(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kind: str = Field(description='"circle" or "underline" a name or expression; "box" round one or more lines; "check" '
                                  'or "cross" judging a line or expression; "arrow" from one piece of code to another '
                                  'or to a shape; "note": a few words typed beside a line, over the code, not in it; '
                                  '"shape": a labelled shape in the column to the right of the code')
    line: int = Field(default=0, description="the editor line it is on, numbered as in the editor after this step; a "
                                             "shape stands beside this line (0 for under the last shape)")
    end_line: int = Field(default=0, description="with a box or a mark on several lines: the last line; 0 for one line")
    text: str = Field(default="", description="the function name, parameter or sub-expression on `line` it is on, copied "
                                              "character for character; empty for the whole line")
    to_line: int = Field(default=0, description="an arrow's other end: its line, numbered like `line`")
    to_end_line: int = Field(default=0, description="an arrow to several lines: the last of them")
    to_text: str = Field(default="", description="an arrow's other end: the text on `to_line`")
    to_id: str = Field(default="", description="an arrow to a shape: that shape's `id`")
    label: str = Field(default="", description="a note's words or what a shape holds: a few words or a value")
    id: str = Field(default="", description="a shape's name, for arrows to reach it")
    shape: str = Field(default="", description='a shape\'s form: "rectangle", "ellipse" or "diamond"')
    color: str = Field(default="", description='"red", "yellow", "blue", "purple", "orange" or "pink"; empty for the usual green')


def clean_marks(raw) -> list[CanvasMark]:
    """Marks fit to draw: known kinds only, up to ``MAX_MARKS``. What they name is looked up in the editor when drawn."""
    return [m for m in (raw or []) if isinstance(m, CanvasMark) and m.kind in KINDS][:MAX_MARKS]
