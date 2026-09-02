#!/usr/bin/env python3
"""Assert the transformer domain library still reproduces its pinned values.

The lesson's arithmetic is the thing it advertises. Every figure below was
computed independently with numpy during research and is quoted on screen in
scenes/transformer-architecture.json, so a silent drift in
static/domains/transformer/index.js would make the lesson state numbers it no
longer computes.

If a check here fails, the lesson is wrong -- not the test.

Usage:  ./run.sh scripts/check_transformer_domain.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOMAIN = REPO / 'static' / 'domains' / 'transformer' / 'index.js'

# (label, js expression, expected, tolerance)
CHECKS: list[tuple[str, str, list[float], float]] = [
    # --- layer input: embedding + sinusoidal positional encoding ------------
    ('x[0]  = emb + PE',            'R(d=>TF.tfX(0,d),4)',      [1.0, 1.0, 0.0, 1.0],            5e-4),
    ('x[4]  ("the", slot 4)',       'R(d=>TF.tfX(4,d),4)',      [0.2432, -0.6536, 0.04, 0.9992], 5e-4),
    ('x[5]  ("mat")',               'R(d=>TF.tfX(5,d),4)',      [-0.4589, 0.7837, 0.05, 1.4988], 5e-4),

    # --- projections --------------------------------------------------------
    ('Q[2]  ("sat")',               'R(d=>TF.tfQ(2,d),2)',      [3.06, 0.9998],                  5e-4),
    ('K[1]  ("cat")',               'R(d=>TF.tfK(1,d),2)',      [4.6209, 0.9999],                5e-4),
    ('K[0]  ("the")',               'R(d=>TF.tfK(0,d),2)',      [3.0, 1.0],                      5e-4),
    ('V[1]  ("cat")',               'R(d=>TF.tfV(1,d),2)',      [0.8415, 1.5403],                5e-4),

    # --- the flagship row: "sat" attends 97.09% to "cat" --------------------
    ('raw scores row 2',            'R(j=>TF.tfScore(2,j),6)',
     [10.1798, 15.1397, -2.8206, -7.089, -5.0014, 8.6925],                                       5e-4),
    ('scaled scores row 2',         'R(j=>TF.tfScoreScaled(2,j),3)',
     [7.1982, 10.7054, -1.9945],                                                                 5e-4),
    ('softmax row 2',               'R(j=>TF.tfAttn(2,j),3)',
     [0.029108, 0.970889, 0.000003],                                                             5e-6),
    ('output o_2',                  'R(d=>TF.tfOut(2,d),2)',    [0.8461, 1.5246],                5e-4),

    # --- accuracy-contract item 1: every row sums to exactly 1 --------------
    ('row sums (all six)',          'R(i=>TF.tfRowSum(i),6)',   [1.0] * 6,                       1e-9),

    # --- d_k vs d_model, the classic error ---------------------------------
    ('score/sqrt(d_k)   (correct)', '[TF.tfScoreDiv(2,1,2)]',   [10.7054],                       5e-4),
    ('score/sqrt(d_mdl) (wrong)',   '[TF.tfScoreDiv(2,1,4)]',   [7.5699],                        5e-4),

    # --- PE is a CONTINUOUS function of position ----------------------------
    # Dims 0 and 1 are sin(p), cos(p), so the tip traces the unit circle. A
    # scene sweeping a position slider must get intermediate points, not six
    # snapped slots, and must not be clamped at position 5.
    ('PE at integer slots unchanged', 'R(p=>TF.tfPE(p,0),6)',
     [0.0, 0.8415, 0.9093, 0.1411, -0.7568, -0.9589],                                            5e-4),
    ('PE sweeps between slots',     '[TF.tfPE(1.5,0), TF.tfPE(1.5,1)]',
     [0.997495, 0.070737],                                                                       5e-5),
    ('PE is not clamped at slot 5', '[TF.tfPE(6.2832,0), TF.tfPE(6.2832,1)]',
     [0.0, 1.0],                                                                                 5e-5),
    ('PE dims 0,1 are on the unit circle',
     'R(k=>Math.hypot(TF.tfPE(k*0.7,0),TF.tfPE(k*0.7,1)),9)',   [1.0] * 9,                       1e-12),

    # --- tfRopeEmb: the two dimension pairs turn independently ---------------
    # The conceptual scene-1 picture. Real RoPE acts on q and k after the
    # projections, never on the embedding; these checks only pin the geometry
    # the picture claims. Token 5 ("mat") is the only row in the table with
    # BOTH pairs non-zero, which is why the scene anchors on it.
    ('RoPE(emb) at p=0 is the embedding', 'R(d=>TF.tfRopeEmb(5,d,0),4)',
     [0.5, 0.5, 0.0, 0.5],                                                                       1e-12),
    ('RoPE(emb) turns "mat" at p=2',      'R(d=>TF.tfRopeEmb(5,d,2),4)',
     [-0.662722, 0.246575, -0.322109, 0.382421],                                                 5e-5),
    ('both pair norms invariant',
     'R(k=>Math.hypot(TF.tfRopeEmb(5,0,k*0.9),TF.tfRopeEmb(5,1,k*0.9)),7)'
     '.concat(R(k=>Math.hypot(TF.tfRopeEmb(5,2,k*0.9),TF.tfRopeEmb(5,3,k*0.9)),7))',
     [0.7071067811865476] * 7 + [0.5] * 7,                                                       1e-12),
    ('a zero pair stays zero ("cat")',    'R(d=>TF.tfRopeEmb(1,d+2,3.7),2)',   [0.0, 0.0],        1e-12),
    ('illustrative thetas, not 1.0/0.01', '[TF.tfRopeEmbTheta(0), TF.tfRopeEmbTheta(1)]',
     [1.0, 0.35],                                                                                1e-12),
    # The point of the picture: at a full turn of pair 0, pair 1 has NOT come
    # home (0.35 * 2pi = 2.199 rad), so the projected tip does not close.
    ('pairs disagree at 2*pi', '[TF.tfRopeEmb(5,0,6.2832), TF.tfRopeEmb(5,3,6.2832)]',
     [0.5, -0.293933],                                                                           5e-5),

    # --- RoPE: the score depends only on the gap m-n ------------------------
    ('R_4 q',                       'R(d=>TF.tfRopeQ(d,4),2)',  [-1.376, 0.3957],                5e-4),
    ('R_1 k',                       'R(d=>TF.tfRopeK(d,1),2)',  [-0.8229, -0.5412],              5e-4),
    ('<R_m q, R_n k> at gap 3',     '[TF.tfRopeDot(4,1), TF.tfRopeDot(3,0), TF.tfRopeDot(9,6)]',
     [0.918150, 0.918150, 0.918150],                                                             1e-5),
]

# Behavioural checks that need a slider override; (label, sliders, expr, expected, tol)
BEHAVIOURAL: list[tuple[str, dict, str, list[float], float]] = [
    ('mask AFTER softmax breaks the row sum',
     {'s3_maskafter': 1}, '[TF.tfRowSum(2)]', [0.989933], 5e-5),
    ('scaling relaxes row 3 ("on"), unscaled',
     {'s3_scale': 0}, 'R(j=>TF.tfAttn(3,j),4)', [0.1398, 0.1618, 0.0954, 0.6030], 5e-4),
    ('scaling relaxes row 3 ("on"), scaled',
     {'s3_scale': 1}, 'R(j=>TF.tfAttn(3,j),4)', [0.176, 0.1951, 0.1343, 0.4946], 5e-4),
]

DEFAULT_SLIDERS = {
    's1_shuffle': 0, 's1_pe': 1, 's2_rope': 0, 's2_m': 4, 's2_n': 1,
    's3_qi': 2, 's3_scale': 1, 's3_mask': 1, 's3_maskafter': 0, 's3_gen_d': 2,
}

HARNESS = """
const fs = require('fs');
const sliders = %SLIDERS%;
global.window = { AlgeBenchDomains: { register: (n, api) => { global.TF = api; } } };
eval(fs.readFileSync(%DOMAIN%, 'utf8'));
TF._init({ getSlider: (id, fb) => (id in sliders ? sliders[id] : fb) });
const R = (f, n) => Array.from({ length: n }, (_, i) => f(i));
console.log(JSON.stringify(%EXPR%));
"""


def _run(expr: str, sliders: dict) -> list[float]:
    js = (HARNESS
          .replace('%SLIDERS%', json.dumps(sliders))
          .replace('%DOMAIN%', json.dumps(str(DOMAIN)))
          .replace('%EXPR%', expr))
    out = subprocess.run(['node', '-e', js], capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        raise RuntimeError(f'node failed for {expr}:\n{out.stderr.strip()}')
    return json.loads(out.stdout.strip())


def _report(label: str, got: list[float], want: list[float], tol: float) -> bool:
    ok = len(got) == len(want) and all(abs(g - w) <= tol for g, w in zip(got, want))
    if ok:
        print(f'  ok   {label}')
    else:
        print(f'  FAIL {label}')
        print(f'         got  {[round(g, 6) for g in got]}')
        print(f'         want {want}')
    return ok


def main() -> int:
    if not DOMAIN.is_file():
        print(f'error: {DOMAIN} not found', file=sys.stderr)
        return 2
    if shutil.which('node') is None:
        print('error: node is required to evaluate the domain module', file=sys.stderr)
        return 2

    failures = 0

    print('transformer domain — pinned values (default sliders)')
    for label, expr, want, tol in CHECKS:
        if not _report(label, _run(expr, DEFAULT_SLIDERS), want, tol):
            failures += 1

    print('\ntransformer domain — behavioural cases')
    for label, override, expr, want, tol in BEHAVIOURAL:
        sliders = {**DEFAULT_SLIDERS, **override}
        if not _report(label, _run(expr, sliders), want, tol):
            failures += 1

    # Permutation equivariance: shuffling the tokens must permute the output
    # rows identically. This is proof 1, and it is the one property a careless
    # refactor (reusing the masked/positioned pass) would silently destroy.
    print('\ntransformer domain — permutation equivariance (proof 1)')
    perm = [5, 0, 3, 2, 1, 4]
    orig = _run('R(i=>R(d=>TF.tfOutNoPos(i,d),2),6)', {**DEFAULT_SLIDERS, 's1_shuffle': 0})
    shuf = _run('R(i=>R(d=>TF.tfOutNoPos(i,d),2),6)', {**DEFAULT_SLIDERS, 's1_shuffle': 1})
    worst = max(abs(shuf[k][d] - orig[perm[k]][d]) for k in range(6) for d in range(2))
    if worst <= 1e-12:
        print(f'  ok   O_perm[k] == O_orig[perm[k]]   (max deviation {worst:.2e})')
    else:
        print(f'  FAIL O_perm[k] != O_orig[perm[k]]   (max deviation {worst:.2e})')
        failures += 1

    print()
    if failures:
        print(f'{failures} check(s) FAILED — the lesson quotes numbers the domain no longer computes.')
        return 1
    print('All transformer domain checks pass.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
