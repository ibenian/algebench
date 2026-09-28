"""Stable lesson ids: backend/lesson_ids.py and scripts/backfill_lesson_ids.py."""

import json
from pathlib import Path

import pytest

from backend.lesson_ids import (
    assign_missing_ids, build_ids, carry_ids, duplicate_id_errors, id_errors,
    iter_id_targets, missing_id_errors, slugify,
)
from scripts.backfill_lesson_ids import backfill_text

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.parametrize('title, slug', [
    ('Finding Eigenvalues', 'finding-eigenvalues'),
    ("Vectors That Don't Rotate", 'vectors-that-don-t-rotate'),
    ('Eigenvector $\\mathbf{v}_1 = (1,1)/\\sqrt{2}$: stretched 4x',
     'eigenvector-mathbf-v-1-1-1-sqrt-2-stretched-4x'),
    ('  --Leading & trailing--  ', 'leading-trailing'),
    ('', ''),
    (None, ''),
])
def test_slugify_matches_client(title, slug):
    # Same rule as slugify() in src/view-state.ts.
    assert slugify(title) == slug


def test_build_ids_mirrors_client_resolution():
    items = [{'title': 'Intro'}, {'title': 'Intro'}, {'id': 'kept', 'title': 'x'}, {}]
    assert build_ids(items, 'title') == ['intro', 'intro-2', 'kept', '3']


def _lesson():
    return {
        'title': 'L',
        'scenes': [{
            'title': 'Drag',
            'steps': [{'title': 'Setup'}, {'id': 'force', 'title': 'Force'}, {'title': 'Setup'}],
            'proof': {'title': 'Terminal speed', 'steps': [{'label': 'Balance'}, {'math': 'x'}]},
        }],
    }


def test_targets_cover_scenes_steps_proofs_and_proof_steps():
    kinds = [(t.kind, t.path, t.ident) for t in iter_id_targets(_lesson())]
    assert kinds == [
        ('scene', 'scenes[0]', 'drag'),
        ('proof', 'scenes[0].proof', 'terminal-speed'),
        ('proof-step', 'scenes[0].proof.steps[0]', 'balance'),
        ('proof-step', 'scenes[0].proof.steps[1]', '1'),
        ('step', 'scenes[0].steps[0]', 'setup'),
        ('step', 'scenes[0].steps[1]', 'force'),
        ('step', 'scenes[0].steps[2]', 'setup-2'),
    ]


def test_assign_writes_client_ids_and_names_untitled_by_kind():
    data = _lesson()
    written = {t.path: ident for t, ident in assign_missing_ids(data)}
    assert written == {
        'scenes[0]': 'drag',
        'scenes[0].proof': 'terminal-speed',
        'scenes[0].proof.steps[0]': 'balance',
        # Untitled: the client's id is the bare index — write a real name.
        'scenes[0].proof.steps[1]': 'proof-step-2',
        'scenes[0].steps[0]': 'setup',
        'scenes[0].steps[2]': 'setup-2',
    }
    assert id_errors(data) == []


def test_missing_and_duplicate_errors():
    data = _lesson()
    assert 'scenes[0].steps[0]: missing "id" (suggested: "setup")' in missing_id_errors(data)
    data['scenes'][0]['steps'][2]['id'] = 'force'
    assert duplicate_id_errors(data) == [
        'scenes[0].steps[2]: duplicate id "force" (also at scenes[0].steps[1])']


def test_bare_scene_gets_ids_too():
    scene = {'title': 'Solo', 'steps': [{'title': 'One'}]}
    assign_missing_ids(scene)
    assert scene['id'] == 'solo' and scene['steps'][0]['id'] == 'one'


def test_proofs_at_every_level():
    data = {'proof': [{'title': 'Root'}],
            'scenes': [{'title': 'S', 'steps': [{'title': 'T', 'proof': {'title': 'Nested'}}]}]}
    paths = {t.path for t in iter_id_targets(data) if t.kind == 'proof'}
    assert paths == {'proof[0]', 'scenes[0].steps[0].proof'}


def test_backfill_inserts_lines_without_reformatting():
    text = (
        '{\n'
        '  "scenes": [\n'
        '    {\n'
        '      "title": "Drag",\n'
        '      "steps": [{"title": "One", "v": [1, 2]}],\n'
        '      "proof": {"title": "P", "steps": [{"label": "A"}, {}]}\n'
        '    }\n'
        '  ]\n'
        '}\n'
    )
    out, changes = backfill_text(text)
    assert len(changes) == 5
    assert out == (
        '{\n'
        '  "scenes": [\n'
        '    {\n'
        '      "id": "drag",\n'
        '      "title": "Drag",\n'
        '      "steps": [{"id": "one", "title": "One", "v": [1, 2]}],\n'
        '      "proof": {"id": "p", "title": "P", "steps": [{"id": "a", "label": "A"}, {"id": "proof-step-2"}]}\n'
        '    }\n'
        '  ]\n'
        '}\n'
    )
    # Idempotent.
    assert backfill_text(out) == (out, [])


def test_backfill_preserves_escapes_and_unicode():
    text = '{"scenes": [{"title": "Café \\u00e9 \\"q\\"", "note": "a\\\\b"}]}'
    out, _ = backfill_text(text)
    assert out.startswith('{"scenes": [{"id": "caf-q", "title": "Café \\u00e9')
    assert json.loads(out)['scenes'][0]['note'] == 'a\\b'


def test_proof_ids_are_unique_lesson_wide():
    """The client flattens root/scene/step proofs into one list and resolves
    `pf=` against all of it (collectAllProofs + proofId)."""
    data = {'scenes': [
        {'title': 'A', 'proof': {'id': 'same', 'title': 'P'}},
        {'title': 'B', 'steps': [{'id': 's', 'title': 's', 'proof': {'id': 'same', 'title': 'Q'}}]},
    ]}
    assert any('duplicate id "same"' in e for e in duplicate_id_errors(data))


def test_an_untitled_proof_keeps_its_global_index_token():
    """`pf=_idx_<n>` is not an integer, so nothing else would resolve an old link
    to an untitled proof — keep the token, numbered over the flattened list."""
    data = {'proof': {'title': 'Root'},
            'scenes': [{'title': 'A', 'proof': [{'title': 'P'}, {}]},
                       {'title': 'B', 'steps': [{'title': 't', 'proof': {}}]}]}
    written = {t.path: i for t, i in assign_missing_ids(data)}
    assert written['scenes[0].proof[1]'] == '_idx_2'
    assert written['scenes[1].steps[0].proof'] == '_idx_3'


def test_carry_ids_keeps_the_scene_and_surviving_steps():
    old = {'id': 'shipped', 'steps': [{'title': 'Setup'}, {'id': 'kept', 'title': 'Force'}]}
    new = {'id': 'fresh', 'steps': [{'id': 'force', 'title': 'Force'}, {'id': 'setup', 'title': 'New'}]}
    carry_ids(old, new, 'shipped')
    assert new['id'] == 'shipped'
    assert [s['id'] for s in new['steps']] == ['kept', 'setup']


def test_carry_ids_matches_repeated_titles_in_order():
    old = {'steps': [{'title': 'Setup'}, {'title': 'Setup'}]}
    new = {'steps': [{'id': 'a', 'title': 'Setup'}, {'id': 'b', 'title': 'Setup'}]}
    carry_ids(old, new, 'x')
    assert [s['id'] for s in new['steps']] == ['setup', 'setup-2']


@pytest.mark.parametrize('path', sorted((ROOT / 'scenes').glob('*.json'))
                         + sorted((ROOT / 'scenes' / 'draft').glob('*.json')),
                         ids=lambda p: p.name)
def test_every_repo_lesson_has_stable_ids(path):
    # Fix with: ./run.sh scripts/backfill_lesson_ids.py --write <file>
    assert id_errors(json.loads(path.read_text())) == []
