"""The collaborative-filtering domain must retrain on live table edits and
document exactly what it exports.

Numerical parity with NumPy lives in scripts/check_collaborative_filtering_domain.py;
these tests pin the live-slider behaviour a lesson relies on.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
DOMAIN = REPO / 'static/domains/collaborative-filtering'


LESSON = REPO / 'scenes/collaborative-filtering.json'


def _node(script: str) -> None:
    node = shutil.which('node')
    if not node:
        pytest.skip('Node.js is required for the collaborative-filtering domain')
    prelude = r'''
const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
let cf;
const sliders = {};
vm.runInNewContext(fs.readFileSync('static/domains/collaborative-filtering/index.js', 'utf8'), {
    window: {AlgeBenchDomains: {register: (_, api) => { cf = api; }}},
});
const data = {};
cf._init({
    getSlider: (id, fallback) => (id in sliders ? sliders[id] : fallback),
    getData: name => data[name],
});
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
'''
    subprocess.run([node, '--input-type=commonjs', '-e', prelude + script], cwd=REPO, check=True)


def test_docs_list_every_export_and_nothing_else():
    docs = json.loads((DOMAIN / 'docs.json').read_text())
    _node(f'''
const exported = Object.keys(cf).filter(k => k !== '_init').sort();
assert.deepEqual(exported, {json.dumps(sorted(docs['functions']))});
''')


def test_absent_sliders_fall_back_to_the_toy():
    _node('''
assert.equal(cf.cfNObs(), 30);
assert.equal(cf.cfR(1, 5), 5);           // Ben x Her, hidden
assert.equal(cf.cfObs(1, 5), 0);
assert.equal(cf.cfMovie(4), 'Matrix');
near(cf.cfPred(1, 5), 4.85, 0.01);        // trained to epoch 300 by default
''')


def test_editing_a_rating_retrains():
    # A cell edit replaces the slider's table (sliders.ts setTensorSliderCell
    # builds a new array), so the library must notice a new table -- and may
    # skip the cell-by-cell compare while the same table object comes back.
    _node('''
const R0 = [[4,1,1,5,5,2],[1,4,1,5,2,5],[1,1,4,2,5,5],[3,2,1,5,4,3],[2,2,2,4,4,4],[2,1,3,3,5,4]];
sliders.cf_R = R0.map(r => r.slice());
const before = cf.cfPred(1, 5);
const knnBefore = cf.cfKnn(1, 5);     // Ben's own mean moves
const edited = R0.map(r => r.slice()); edited[1][3] = 1;   // Ben now hates Mr&Mrs Smith
sliders.cf_R = edited;
assert.notEqual(cf.cfPred(1, 5), before);
assert.notEqual(cf.cfKnn(1, 5), knnBefore);
sliders.cf_R = R0.map(r => r.slice());   // and back: same numbers again
near(cf.cfPred(1, 5), before, 1e-12);
''')


def test_hiding_a_cell_moves_it_to_the_test_set():
    _node('''
const obs = [[1,0,1,1,1,1],[1,1,1,1,1,0],[1,1,1,1,0,1],[0,1,1,1,1,1],[1,1,0,1,1,1],[1,1,1,0,1,1]];
sliders.cf_obs = obs;
assert.equal(cf.cfNObs(), 30);
const fewer = obs.map(r => r.slice()); fewer[0][0] = 0;
sliders.cf_obs = fewer;
assert.equal(cf.cfNObs(), 29);
assert.equal(cf.cfObs(0, 0), 0);
''')


def test_rotation_never_changes_predictions():
    _node('''
const base = [];
for (let u = 0; u < 6; u++) for (let i = 0; i < 6; i++) base.push(cf.cfPred(u, i));
for (const [theta, axis, stretch] of [[30, 0, 1], [120, 1, 0.4], [275, 2, 2.5]]) {
    Object.assign(sliders, {cf_theta: theta, cf_axis: axis, cf_stretch: stretch});
    let k = 0;
    for (let u = 0; u < 6; u++) for (let i = 0; i < 6; i++) near(cf.cfMapPred(u, i), base[k++], 1e-9);
    // ...while the vectors themselves do move.
    let moved = 0;
    for (let f = 0; f < 3; f++) moved += Math.abs(cf.cfMapP(0, f) - cf.cfP(0, f));
    assert.ok(moved > 1e-3);
}
''')


def test_epoch_and_algorithm_sliders_scrub_the_run():
    _node('''
sliders.cf_epoch = 0;
const init = cf.cfP(0, 0);
sliders.cf_algo = 1;
assert.equal(cf.cfP(0, 0), init);             // same seeded start for ALS and SGD
sliders.cf_epoch = 10;
const sgd10 = cf.cfTestRmse(10);
assert.equal(sgd10, cf.cfSgdTest(10));
sliders.cf_algo = 0;
assert.ok(cf.cfTestRmse(10) < sgd10);     // ALS converges far faster
''')


def test_fold_in_cold_start():
    _node('''
sliders.cf_me = [[5, 0, 0, 0, 0, 0]];     // one rating: Die Hard 5
assert.equal(cf.cfMeRated(), 1);
near(cf.cfMe(1), 0, 1e-12);               // nothing known about romance or sci-fi
near(cf.cfMe(2), 0, 1e-12);
near(cf.cfMePred(1), 0, 1e-12);
sliders.cf_me = [[5, 1, 0, 0, 0, 0]];
assert.ok(cf.cfMe(1) < cf.cfMe(0));
assert.notEqual(cf.cfMeTop(0), 0);        // a rated movie is never recommended
assert.notEqual(cf.cfMeTop(0), 1);
''')


def test_lesson_data_tables_match_the_built_in_fallback():
    # The lesson owns the dataset (data tables); the library keeps a copy only
    # for scenes without them. The two must never drift.
    lesson = json.loads(LESSON.read_text())
    _node(f'''
const lessonData = {json.dumps(lesson['data'])};
const M = f => Array.from({{length: 6}}, (_, u) => Array.from({{length: 6}}, (_, i) => f(u, i)));
const builtIn = [M(cf.cfR), M(cf.cfObs), M(cf.cfC), M(cf.cfPstar).map(r => r.slice(0, 3)),
                 M(cf.cfQstar).map(r => r.slice(0, 3)), [0,1,2,3,4,5].map(cf.cfUser), [0,1,2,3,4,5].map(cf.cfMovie)];
Object.assign(data, lessonData);
const fromData = [M(cf.cfR), M(cf.cfObs), M(cf.cfC), M(cf.cfPstar).map(r => r.slice(0, 3)),
                  M(cf.cfQstar).map(r => r.slice(0, 3)), [0,1,2,3,4,5].map(cf.cfUser), [0,1,2,3,4,5].map(cf.cfMovie)];
assert.deepEqual(fromData, builtIn);
''')


def test_the_library_reads_its_data_tables():
    lesson = json.loads(LESSON.read_text())
    _node(f'''
Object.assign(data, {json.dumps(lesson['data'])});
const before = cf.cfPred(1, 5);
// A scene with different data (a new table object) must rebuild.
data.ratings = data.ratings.map(r => ({{...r}}));
data.ratings[1]['Mr&Mrs Smith'] = 1;
assert.equal(cf.cfR(1, 3), 1);
assert.notEqual(cf.cfPred(1, 5), before);
data.movies = data.movies.map((r, i) => (i === 4 ? {{...r, movie: 'The Matrix'}} : r));
assert.equal(cf.cfMovie(4), 'The Matrix');
// ...and a tensor slider still edits on top of the table.
const table = data.ratings.map(r => [r['Die Hard'], r.Notebook, r.Arrival, r['Mr&Mrs Smith'], r.Matrix, r.Her]);
table[0][0] = 2;
sliders.cf_R = table;
assert.equal(cf.cfR(0, 0), 2);
''')


PLAY = '[[4,0,1,5,5,2],[1,4,1,5,2,0],[1,1,4,2,0,5],[0,2,1,5,4,3],[2,2,0,4,4,4],[2,1,3,0,5,4]]'


def test_playground_question_marks_are_missing_not_zero():
    _node(f'''
sliders.cf_play = {PLAY};
sliders.cf_tu = 3; sliders.cf_ti = 0; sliders.cf_knn = 2;
near(cf.cfPlayPred(), 2.748456139, 1e-6);          // Dan x Die Hard, as in the scene
assert.equal(cf.cfObs(0, 1), 0);                    // Ava x Notebook is "?"
assert.equal(cf.cfCoRated(0, 3), 4);
// Ava's Die Hard rating to "?": she can no longer vote for Die Hard.
const p = {PLAY}; p[0][0] = 0; sliders.cf_play = p;
assert.equal(cf.cfUsedNbr(0), 0);
assert.equal(cf.cfObs(0, 0), 0);
assert.ok(Math.abs(cf.cfPlayPred() - 2.748456139) > 1e-3);
''')


def test_playground_target_is_held_out_even_when_rated():
    _node(f'''
sliders.cf_play = {PLAY};
sliders.cf_tu = 0; sliders.cf_ti = 0;               // Ava x Die Hard, actual 4
assert.equal(cf.cfPlay(0, 0), 4);                   // the table still shows it
assert.equal(cf.cfObs(0, 0), 0);                    // ...but no calculation sees it
near(cf.cfUserMean(0), (1 + 5 + 5 + 2) / 4, 1e-12);
assert.ok(cf.cfWalkSummary().includes('actual 4'));
''')


def test_walkthrough_numbers_match_the_computation():
    _node(f'''
sliders.cf_play = {PLAY};
sliders.cf_tu = 3; sliders.cf_ti = 0; sliders.cf_pv = 0; sliders.cf_knn = 2;
const pred = cf.cfPlayPred().toFixed(2);
assert.ok(cf.cfWalk(6).includes('= ' + pred + '$$'), cf.cfWalk(6));
assert.ok(cf.cfWalk(3).includes(cf.cfSim(3, 0).toFixed(2)));
assert.ok(cf.cfWalk(1).includes('3.00'));           // Dan's mean
assert.ok(cf.cfWalk(4).includes('Ava') && cf.cfWalk(4).includes('Eli'));
for (let s = 1; s <= 6; s++) assert.ok(cf.cfWalk(s).startsWith('### ' + s + '/6'));
''')
