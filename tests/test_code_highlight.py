"""Syntax colouring for the Code panel (backend/code_highlight.py)."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.code_highlight import build_code_highlight_router, highlight

SOURCE = '''import heapq

def kth(nums, k):
    """Return the k-th largest."""
    heap = []  # min-heap
    for x in nums:
        if len(heap) > k and x is not None:
            heapq.heappop(heap)
    return heap[0] + 1.5'''


def spans(source, language="python"):
    lines = source.split("\n")
    return [(t["kind"], lines[t["line"] - 1][t["col"]:t["endCol"]]) for t in highlight(language, source)["tokens"]]


def test_categories_cover_python():
    got = spans(SOURCE)
    for expected in [("keyword", "import"), ("keyword", "def"), ("function", "kth"), ("string", '"""Return the k-th largest."""'),
                     ("comment", "# min-heap"), ("keyword", "for"), ("keyword", "in"), ("builtin", "len"), ("operator", ">"),
                     ("keyword", "and"), ("keyword", "is"), ("constant", "None"), ("keyword", "return"), ("number", "0"), ("number", "1.5")]:
        assert expected in got, expected
    # Plain names and punctuation stay uncoloured.
    assert not any(text in ("heap", "nums", "(", ":") for _, text in got)


def test_columns_index_each_line_exactly():
    lines = SOURCE.split("\n")
    for t in highlight("python", SOURCE)["tokens"]:
        text = lines[t["line"] - 1]
        assert 0 <= t["col"] < t["endCol"] <= len(text)


def test_a_token_over_several_lines_is_split_per_line():
    source = 'x = """one\ntwo\nthree"""\ny = 1'
    strings = [(t["line"], t["col"], t["endCol"]) for t in highlight("python", source)["tokens"] if t["kind"] == "string"]
    assert strings == [(1, 4, 10), (2, 0, 3), (3, 0, 8)]


def test_columns_are_utf16_units():
    # 😀 is one Python character but two UTF-16 units: the string after it starts at JavaScript column 5.
    source = 'x = 1  # 😀\ns = "é😀"'
    tokens = highlight("python", source)["tokens"]
    string = next(t for t in tokens if t["kind"] == "string")
    assert (string["line"], string["col"], string["endCol"]) == (2, 4, 4 + len('"é😀"'.encode("utf-16-le")) // 2)


def test_leading_and_trailing_blank_lines_keep_their_offsets():
    tokens = highlight("python", "\n\nx = 1\n\n")["tokens"]
    assert [(t["line"], t["kind"]) for t in tokens] == [(3, "operator"), (3, "number")]


def test_other_languages_and_unknown_ones():
    assert ("keyword", "SELECT") in spans("SELECT name FROM users WHERE id = 1", "sql")
    assert ("keyword", "const") in spans("const x = 1;", "javascript")
    result = highlight("no-such-language", "x")
    assert result["tokens"] == [] and "no-such-language" in result["error"]


def test_endpoint():
    app = FastAPI()
    app.include_router(build_code_highlight_router())
    client = TestClient(app)
    res = client.post("/api/code/highlight", json={"language": "python", "source": "x = 1"})
    assert res.status_code == 200
    assert res.json()["tokens"] == [{"line": 1, "kind": "operator", "col": 2, "endCol": 3}, {"line": 1, "kind": "number", "col": 4, "endCol": 5}]
    assert client.post("/api/code/highlight", json={"language": "python", "source": "x" * 200_001}).status_code == 413
