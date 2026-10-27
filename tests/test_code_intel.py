"""backend.code_intel: variables and variable expressions in lesson code files."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.code_intel import analyze_python, build_code_router

SOURCE = """def daily_temperatures(temps):
    answer = [0] * len(temps)
    stack = []
    for i, t in enumerate(temps):
        while stack and temps[stack[-1]] < t:
            j = stack.pop()
            answer[j] = i - j
        stack.append(i)
    return answer"""


def _keys(line):
    return [r["key"] for r in analyze_python(SOURCE)["references"] if r["line"] == line]


def test_bound_names_are_variables_and_builtins_are_not():
    result = analyze_python(SOURCE)
    assert result["error"] is None
    assert set(result["variables"]) == {"temps", "answer", "stack", "i", "t", "j"}
    assert not any(r["root"] in ("len", "enumerate") for r in result["references"])


def test_nested_expressions_are_each_a_reference_with_exact_spans():
    assert _keys(5) == ["stack", "temps[stack[-1]]", "temps", "stack[-1]", "stack", "t"]
    ref = next(r for r in analyze_python(SOURCE)["references"] if r["key"] == "temps[stack[-1]]")
    line = SOURCE.split("\n")[4]
    assert line[ref["col"]:ref["endCol"]] == "temps[stack[-1]]"


def test_attribute_calls_root_at_the_variable_and_stores_are_flagged():
    refs = [r for r in analyze_python(SOURCE)["references"] if r["line"] == 6]
    assert {r["key"]: r["store"] for r in refs} == {"j": True, "stack.pop": False, "stack": False}
    assert [r["key"] for r in analyze_python(SOURCE)["references"] if r["line"] == 1] == ["temps"], "parameters count"


def test_keys_ignore_whitespace_and_columns_count_characters():
    src = "café = {}\nx = café[ 'k' ]"
    ref = next(r for r in analyze_python(src)["references"] if r["kind"] == "subscript")
    assert ref["key"] == "café['k']" and (ref["col"], ref["endCol"]) == (4, 15)


def test_unparseable_source_reports_the_error_without_references():
    result = analyze_python("def broken(:\n    pass")
    assert result["references"] == [] and result["error"].startswith("line 1")


def test_endpoint_dispatches_by_language():
    app = FastAPI()
    app.include_router(build_code_router())
    client = TestClient(app)
    ok = client.post("/api/code/analyze", json={"language": "python", "source": SOURCE})
    assert ok.status_code == 200 and "temps[stack[-1]]" in {r["key"] for r in ok.json()["references"]}
    assert client.post("/api/code/analyze", json={"language": "cobol", "source": "x"}).status_code == 400


RECURSIVE = """def subsets(nums):
    out, path = [], []

    def backtrack(start):
        out.append(path[:])
        for i in range(start, len(nums)):
            backtrack(i + 1)

    backtrack(0)
    return out"""


def test_calls_link_to_the_def_they_reach_and_builtins_do_not():
    result = analyze_python(RECURSIVE)
    lines = RECURSIVE.split("\n")
    assert [(f["name"], f["line"]) for f in result["functions"]] == [("subsets", 1), ("backtrack", 4)]
    back = result["functions"][1]
    assert lines[3][back["col"]:back["endCol"]] == "backtrack"
    assert [(c["line"], c["defLine"]) for c in result["calls"]] == [(7, 4), (9, 4)], "range and len are not linked"
    call = result["calls"][1]
    assert lines[8][call["col"]:call["endCol"]] == "backtrack"
    assert not any(r["root"] == "backtrack" for r in result["references"]), "a function is not a variable"


def test_a_call_is_keyed_by_its_whole_text_without_spaces():
    keys = [c["key"] for c in analyze_python(RECURSIVE)["calls"]]
    assert keys == ["backtrack(i+1)", "backtrack(0)"], "the key a trace's returns names the call's value by"
