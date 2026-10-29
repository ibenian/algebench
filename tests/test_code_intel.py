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


def _uses_of(source: str, name: str) -> dict:
    return next(u for u in analyze_python(source)["uses"] if u["name"] == name)


def test_uses_say_where_a_dict_is_read_updated_and_grown():
    source = "\n".join([
        "def subarray_sum(nums, target):",
        "    count = {0: 1}",
        "    total = 0",
        "    for num in nums:",
        "        total += count.get(num - target, 0)",
        "        count[num] = count.get(num, 0) + 1",
        "    return total",
    ])
    count = _uses_of(source, "count")
    assert (count["from"], count["to"]) == (1, 7)
    assert count["read"] == [5, 6] and count["update"] == [2, 6] and count["grow"] == [6] and count["shrink"] == []
    total = _uses_of(source, "total")
    assert total["read"] == [5, 7] and total["update"] == [3, 5], "x += ... reads and updates x"


def test_uses_of_lists_heaps_and_stacks():
    source = "\n".join([
        "import heapq",
        "def f(xs):",
        "    stack, heap, grid = [], [], [[0]]",
        "    stack.append(1)",
        "    heapq.heappush(heap, 2)",
        "    grid[0][0] = 1",
        "    while stack:",
        "        stack.pop()",
        "    del heap[0]",
        "    heap.sort()",
        "    return heapq.heappop(heap)",
    ])
    stack, heap, grid = (_uses_of(source, n) for n in ("stack", "heap", "grid"))
    assert stack["grow"] == [4] and stack["shrink"] == [8] and stack["read"] == [7]
    assert heap["grow"] == [5] and heap["shrink"] == [9, 11] and heap["update"] == [3, 5, 9, 10, 11]
    assert grid["update"] == [3, 6] and grid["read"] == [], "setting a cell of a row updates the grid"
    assert grid["grow"] == [], "assigning an item of a list never grows it"


def test_each_top_level_function_has_its_own_uses_and_nested_ones_share_them():
    source = "\n".join([
        "def a():",
        "    seen = set()",
        "    def visit(u):",
        "        seen.add(u)",
        "    visit(0)",
        "def b():",
        "    seen = {}",
        "    seen[1] = 2",
    ])
    first, second = (u for u in analyze_python(source)["uses"] if u["name"] == "seen")
    assert (first["from"], first["grow"]) == (1, [4])
    assert (second["from"], second["grow"]) == (6, [8])


def test_each_use_says_how_and_with_what_code():
    source = "\n".join([
        "def f(nums):",
        "    count = {}",
        "    for num in nums:",
        "        count[num] = count.get(num, 0) + 1",
        "    return count",
    ])
    notes = _uses_of(source, "count")["notes"]
    assert notes == [
        {"line": 2, "kinds": ["update"], "how": "bind", "code": "count = {}"},
        {"line": 4, "kinds": ["update", "grow"], "how": "add-key", "code": "count[num]"},
        {"line": 4, "kinds": ["read"], "how": "read", "code": "count.get(num, 0)"},
        {"line": 5, "kinds": ["read"], "how": "read", "code": "count"},
    ]
    assert _uses_of(source, "num")["notes"][0]["how"] == "loop"
