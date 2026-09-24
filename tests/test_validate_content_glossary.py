"""Glossary checks in scripts/validate_content.py (issue #665)."""

import json

from scripts.validate_content import check_glossary, load_glossary


def _domains(tmp_path, name, glossary):
    d = tmp_path / name
    d.mkdir(parents=True)
    (d / 'docs.json').write_text(json.dumps({'name': name, 'glossary': glossary}))
    return tmp_path


def test_unresolved_explicit_marker_is_an_error(tmp_path):
    data = {'title': 't', 'glossary': {'RBF': {'markdown': 'k'}},
            'scenes': [{'title': 's', 'markdown': 'The {{glossary:RBF}} and {{glossary:nope}}.'}]}
    errors, warnings, checked = check_glossary(data, tmp_path)
    assert checked == 2
    assert errors == ['scenes[0].markdown: {{glossary:nope}} has no glossary entry']
    assert warnings == []


def test_markers_resolve_by_term_and_alias(tmp_path):
    data = {'title': 't',
            'glossary': {'RBF': {'term': 'Gaussian RBF kernel', 'aliases': ['radial basis function'], 'markdown': 'k'}},
            'scenes': [{'title': 's', 'description': '{{glossary:gaussian rbf kernel}} {{glossary:Radial Basis Function|x}}'}]}
    errors, _, checked = check_glossary(data, tmp_path)
    assert checked == 2 and errors == []


def test_domain_glossary_is_layered_under_the_lesson(tmp_path):
    root = _domains(tmp_path, 'anomaly', {'MAD': {'markdown': 'domain'}, 'LOF': {'markdown': 'lof'}})
    data = {'title': 't', 'import': ['anomaly'], 'glossary': {'MAD': {'markdown': 'lesson'}},
            'scenes': [{'title': 's', 'markdown': '{{glossary:LOF}} {{glossary:MAD}}'}]}
    assert load_glossary(data, root)['MAD'] == {'markdown': 'lesson'}
    errors, _, _ = check_glossary(data, root)
    assert errors == []


def test_warns_on_missing_definition_and_underscore_key(tmp_path):
    data = {'title': 't', 'glossary': {'base_rate': {'markdown': 'x'}, 'nu': {}}, 'scenes': [{'title': 's'}]}
    _, warnings, _ = check_glossary(data, tmp_path)
    assert any('base_rate' in w and 'underscore' in w for w in warnings)
    assert any('glossary.nu: no markdown definition' == w for w in warnings)


def test_markers_inside_glossary_definitions_are_checked(tmp_path):
    data = {'title': 't', 'glossary': {'RBF': {'markdown': 'See {{glossary:missing}} and {{glossary:RBF}}.'}},
            'scenes': [{'title': 's'}]}
    errors, _, checked = check_glossary(data, tmp_path)
    assert checked == 2
    assert errors == ['glossary.RBF.markdown: {{glossary:missing}} has no glossary entry']


def test_malformed_entries_are_reported_not_fatal(tmp_path):
    root = _domains(tmp_path, 'dom', {'X': {'aliases': 1, 'markdown': 'x'}, 'Y': None})
    data = {'title': 't', 'import': ['dom'],
            'glossary': {'A': {'aliases': {'b': 1}, 'markdown': 'a'}, 'B': 'not an object'},
            'scenes': [{'title': 's', 'markdown': '{{glossary:A}} {{glossary:X}} {{glossary:B}} {{glossary:Y}}'}]}
    errors, warnings, checked = check_glossary(data, root)
    assert checked == 4
    # A and X resolve; B and Y are dropped exactly as the app's sanitizer drops them.
    assert errors == ['scenes[0].markdown: {{glossary:B}} has no glossary entry',
                      'scenes[0].markdown: {{glossary:Y}} has no glossary entry']
    assert 'glossary.B: not an object — the entry is ignored' in warnings
    assert any(w.startswith('glossary.A.aliases: must be a list of strings') for w in warnings)
