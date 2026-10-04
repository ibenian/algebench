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
cf._init({getSlider: (id, fallback) => (id in sliders ? sliders[id] : fallback)});
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


def test_editing_a_rating_in_place_retrains():
    # A tensor-slider drag mutates the nested table in place; the state must
    # notice the cell change, not just a new array identity.
    _node('''
sliders.cf_R = [[4,1,1,5,5,2],[1,4,1,5,2,5],[1,1,4,2,5,5],[3,2,1,5,4,3],[2,2,2,4,4,4],[2,1,3,3,5,4]];
const before = cf.cfPred(1, 5);
const knnBefore = cf.cfKnn(1, 5);     // Ben's own mean moves
sliders.cf_R[1][3] = 1;                   // Ben now hates Mr&Mrs Smith
assert.notEqual(cf.cfPred(1, 5), before);
assert.notEqual(cf.cfKnn(1, 5), knnBefore);
sliders.cf_R[1][3] = 5;                   // and back: same numbers again
near(cf.cfPred(1, 5), before, 1e-12);
''')


def test_hiding_a_cell_moves_it_to_the_test_set():
    _node('''
const obs = [[1,0,1,1,1,1],[1,1,1,1,1,0],[1,1,1,1,0,1],[0,1,1,1,1,1],[1,1,0,1,1,1],[1,1,1,0,1,1]];
sliders.cf_obs = obs;
assert.equal(cf.cfNObs(), 30);
obs[0][0] = 0;
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
