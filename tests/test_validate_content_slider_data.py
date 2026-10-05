"""A tensor slider's `defaultData` must name a data table that fills its shape."""
from scripts.validate_content import check_tensors


def _lesson(slider, data):
    return {'data': data, 'scenes': [{'id': 's', 'steps': [{'id': 't', 'sliders': [slider]}]}]}


SLIDER = {'id': 'r', 'kind': 'tensor', 'shape': [2, 2], 'min': 0, 'max': 5, 'defaultData': 'ratings'}
TABLE = {'ratings': [{'user': 'a', 'x': 1, 'y': 2}, {'user': 'b', 'x': 3, 'y': 4}]}


def test_matching_table_passes():
    errors, _ = check_tensors(_lesson(SLIDER, TABLE))
    assert errors == []


def test_missing_table_is_an_error():
    errors, _ = check_tensors(_lesson(SLIDER, {}))
    assert any("no data table named 'ratings'" in e for e in errors)


def test_shape_mismatch_is_an_error():
    errors, _ = check_tensors(_lesson({**SLIDER, 'shape': [3, 2]}, TABLE))
    assert any('has 2 rows' in e for e in errors)
    errors, _ = check_tensors(_lesson({**SLIDER, 'defaultData': {'table': 'ratings', 'columns': ['x']}}, TABLE))
    assert any('gives 1 columns' in e for e in errors)


def test_scene_level_table_counts():
    lesson = _lesson(SLIDER, {})
    lesson['scenes'][0]['data'] = TABLE
    errors, _ = check_tensors(lesson)
    assert errors == []
