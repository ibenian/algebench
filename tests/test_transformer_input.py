"""Direct residual edits must reach every projection without adding PE twice."""
import shutil
import subprocess
import json
from pathlib import Path

import pytest


def test_input_points_share_one_legend_toggle():
    scene = json.loads(
        (Path(__file__).resolve().parents[1] / 'scenes/transformer-architecture.json').read_text()
    )
    step = scene['scenes'][1]['steps'][1]
    points = [el for el in step['add'] if el['id'].startswith('s2_input_pt_')]
    assert len(points) == 6
    primary = points[0]
    group = primary['label']
    assert all(point['color'] == primary['color'] for point in points)
    assert all(point.get('legendGroup', group) == group for point in points)

    labelled_charts = {
        el['id']: el for el in step['add']
        if el['id'] in {'s2_chart_q', 's2_chart_k', 's2_chart_v', 's2_chart_similarity'}
    }
    assert len(labelled_charts) == 4
    for chart in labelled_charts.values():
        point_series = [series for series in chart['series'] if series.get('kind') == 'points']
        assert len(point_series) == 1
        assert 'string(i)' in point_series[0]['pointLabelExpr']


def test_direct_input_and_projection_edits():
    node = shutil.which('node')
    if not node:
        pytest.skip('Node.js is required for the transformer domain')
    subprocess.run([node, '--input-type=commonjs', '-e', r'''
const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
let tf;
const sliders = {};
vm.runInNewContext(fs.readFileSync('static/domains/transformer/index.js', 'utf8'), {
    window: {AlgeBenchDomains: {register: (_, api) => { tf = api; }}},
});
tf._init({getSlider: (id, fallback) => sliders[id] ?? fallback});
const original = Array.from({length: 4}, (_, d) => tf.tfX(2, d));
const raw = tf.tfEmb(2, 0), noPos = tf.tfOutNoPos(2, 0);
const scene = JSON.parse(fs.readFileSync('scenes/transformer-architecture.json', 'utf8'));
const step = scene.scenes[1].steps[1];
for (const s of step.sliders) sliders[s.id] = structuredClone(s.default);
assert.deepEqual(Array.from({length: 4}, (_, d) => tf.tfX(2, d)), original);
const near = (a, b) => assert.ok(Math.abs(a-b) < 1e-10, `${a} != ${b}`);
// The default matrices make the fourth coordinate of x_2 feed q_2 and k_2,
// while v_2 ignores it. This is the exact interaction shown by the vectors.
const beforeX4 = tf.tfX(2, 3);
const beforeQ2 = [tf.tfQ(2, 0), tf.tfQ(2, 1)];
const beforeK2 = [tf.tfK(2, 0), tf.tfK(2, 1)];
const beforeV2 = [tf.tfV(2, 0), tf.tfV(2, 1)];
sliders.tf_x[2][3] = beforeX4 + 0.5;
near(tf.tfX(2, 3), beforeX4 + 0.5);
near(tf.tfQ(2, 0), beforeQ2[0]);
near(tf.tfQ(2, 1), beforeQ2[1] + 0.5);
near(tf.tfK(2, 0), beforeK2[0]);
near(tf.tfK(2, 1), beforeK2[1] + 0.5);
assert.deepEqual([tf.tfV(2, 0), tf.tfV(2, 1)], beforeV2);
// Mutate the nested table in place, exactly like a cell drag.
sliders.tf_x[2] = [2, 3, 4, 1];
assert.deepEqual([tf.tfQ(2,0),tf.tfQ(2,1)], [12,1]);
assert.deepEqual([tf.tfK(2,0),tf.tfK(2,1)], [9,1]);
assert.deepEqual([tf.tfV(2,0),tf.tfV(2,1)], [2,3]);
for (const [id, read] of [['s4_wq','tfQ'],['s4_wk','tfK'],['s4_wv','tfV']]) {
    sliders[id][0][1] = 2;
    for (let c=0;c<2;c++) near(tf[read](2,c), sliders.tf_x[2].reduce((v,x,d)=>v+x*sliders[id][d][c],0));
}
near(tf.tfEmb(2,0),raw);
// The X override does not change the raw-embedding demonstration.
for (const id of ['s4_wq','s4_wk','s4_wv']) delete sliders[id];
near(tf.tfOutNoPos(2,0),noPos);
sliders.tf_x[2][0] = NaN;
near(tf.tfX(2,0),original[0]);
delete sliders.tf_x;
assert.deepEqual(Array.from({length:4},(_,d)=>tf.tfX(2,d)),original);
'''], cwd=Path(__file__).resolve().parents[1], check=True)
