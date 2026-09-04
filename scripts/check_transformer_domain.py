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

    # --- the relative-position identity, which step 10 is built on ----------
    # <RoPE(a at p), RoPE(b at q)> depends on q - p ALONE. Shift both positions
    # by any amount and the number must not move. Q = "mat" (slot 5), K = "the"
    # (slot 0): "mat" is the only row with both dimension pairs non-zero, and
    # "the" is zero in the second pair, which is what makes the drawn 3-D
    # projection's dot product EQUAL the true 4-D one rather than merely close.
    ('Q.K at gap 3, five absolute placements',
     '[TF.tfRopeEmbDot(5,2,0,5), TF.tfRopeEmbDot(5,12,0,15), TF.tfRopeEmbDot(5,0,0,3),'
     ' TF.tfRopeEmbDot(5,7.25,0,10.25), TF.tfRopeEmbDot(5,101,0,104)]',
     [-0.424436244270] * 5,                                                                      1e-12),
    ('one position moved -> gap 8, new value',
     '[TF.tfRopeEmbDot(5,1,0,9)]',                              [0.421929106407],                 1e-12),
    ('the drawn 3-D projection agrees exactly',
     '[TF.tfRopeEmb(5,0,12)*TF.tfRopeEmb(0,0,15) + TF.tfRopeEmb(5,1,12)*TF.tfRopeEmb(0,1,15)'
     ' + TF.tfRopeEmb(5,3,12)*TF.tfRopeEmb(0,3,15)]',
     [-0.424436244270],                                                                          1e-12),
    ('Q.K is symmetric in the two slots',
     '[TF.tfRopeEmbDot(5,2,0,5) - TF.tfRopeEmbDot(0,5,5,2)]',   [0.0],                            1e-15),
    # Why the step could NOT use "cat" and "sat": RoPE rotates each pair WITHIN
    # itself, so a token confined to pair (1,2) never acquires a component in
    # pair (3,4). cat and sat sit in different pairs and stay orthogonal at
    # every pair of positions — every cell of the demo would read 0.000000.
    # That is a limit of this one-hot-ish toy table, not of RoPE.
    ('cat . sat is identically zero at every placement',
     '[TF.tfRopeEmbDot(1,2,2,5), TF.tfRopeEmbDot(1,12,2,15), TF.tfRopeEmbDot(1,0,2,3),'
     ' TF.tfRopeEmbDot(1,1,2,9), TF.tfRopeEmbDot(1,4,2,4)]',
     [0.0] * 5,                                                                                  1e-15),
    # Q.K = |Q| |K| cos(theta) is why the dot product is preserved, so all
    # three factors on the right have to be pinned too. The norms are fixed by
    # RoPE being an isometry; the angle, like the dot product, is fixed by the
    # gap alone. These are the numbers step 10 prints on screen.
    ('true angle is 119.35 deg at gap 3, any placement',
     '[TF.tfRopeEmbAngle(5,2,0,5), TF.tfRopeEmbAngle(5,12,0,15), TF.tfRopeEmbAngle(5,0,0,3),'
     ' TF.tfRopeEmbAngle(5,101,0,104), TF.tfRopeEmbAngle(5,7.25,0,10.25)]',
     [119.3469415114] * 5,                                                                       1e-9),
    ('true angle at gap 8 and gap 2',
     '[TF.tfRopeEmbAngle(5,1,0,9), TF.tfRopeEmbAngle(5,3,0,5)]',
     [60.8431728682, 73.4578502091],                                                             1e-9),
    ('|Q| is position-invariant (RoPE is an isometry)',
     'R(k=>TF.tfRopeEmbNorm(5,k*1.7),7)',   [0.8660254037844386] * 7,                             1e-12),
    ('|K| is position-invariant',
     'R(k=>TF.tfRopeEmbNorm(0,k*1.7),7)',   [1.0] * 7,                                            1e-12),
    ('the identity closes: |Q||K|cos(theta) == Q.K',
     '[TF.tfRopeEmbNorm(5,12)*TF.tfRopeEmbNorm(0,15)'
     '*Math.cos(TF.tfRopeEmbAngle(5,12,0,15)*Math.PI/180) - TF.tfRopeEmbDot(5,12,0,15)]',
     [0.0],                                                                                      1e-12),

    # The global-rotation control: applying a shared orthogonal rotation theta
    # to BOTH vectors is exactly advancing both positions by theta, because
    # RoPE's rotation is block-diagonal and orthogonal. The step implements the
    # slider as tfRopeEmb at (p + theta) and (q + theta), so these fractional,
    # non-integer shared shifts are literally what sweeping theta evaluates.
    ('shared rotation leaves Q.K alone (gap 3)',
     '[TF.tfRopeEmbDot(5,2,0,5), TF.tfRopeEmbDot(5,2.5,0,5.5), TF.tfRopeEmbDot(5,3.7,0,6.7),'
     ' TF.tfRopeEmbDot(5,5.3,0,8.3), TF.tfRopeEmbDot(5,9.25,0,12.25)]',
     [-0.424436244270] * 5,                                                                      1e-9),
    ('shared rotation leaves the true angle alone',
     '[TF.tfRopeEmbAngle(5,2,0,5), TF.tfRopeEmbAngle(5,2.5,0,5.5), TF.tfRopeEmbAngle(5,3.7,0,6.7),'
     ' TF.tfRopeEmbAngle(5,5.3,0,8.3), TF.tfRopeEmbAngle(5,9.25,0,12.25)]',
     [119.3469415114] * 5,                                                                       1e-9),
    ('shared rotation leaves both norms alone',
     'R(k=>TF.tfRopeEmbNorm(5,2+k*0.9),7).concat(R(k=>TF.tfRopeEmbNorm(0,5+k*0.9),7))',
     [0.8660254037844386] * 7 + [1.0] * 7,                                                       1e-12),

    # the arc helper: unit-length, and its ends lie along the two directions
    ('arc endpoints are the two directions',
     'R(k=>TF.tfRopeEmbArc(k,5,2,0,5,0)*0.8660254037844387,4)'
     '.concat(R(k=>TF.tfRopeEmbArc(k,5,2,0,5,1),4))',
     [-0.662722, 0.246575, -0.322109, 0.382421, 0.283662, -0.958924, 0.0, 0.0],                   5e-6),
    ('arc stays on the unit sphere',
     'R(k=>Math.hypot(TF.tfRopeEmbArc(0,5,2,0,5,k/6),TF.tfRopeEmbArc(1,5,2,0,5,k/6),'
     'TF.tfRopeEmbArc(2,5,2,0,5,k/6),TF.tfRopeEmbArc(3,5,2,0,5,k/6)),7)',
     [1.0] * 7,                                                                                  1e-12),

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
    # Scene 3 turns the causal mask ON at its step 4. The scaling PREDICT and
    # REVEAL pair sits at steps 1-2, three steps EARLIER, and declares
    # s3_mask = 0 so the row on screen shows all six keys -- the mask has not
    # been introduced yet and must not be silently in force. These are the
    # numbers those two steps quote.
    ('scaling relaxes row 3 ("on"), unmasked, unscaled',
     {'s3_scale': 0, 's3_mask': 0}, 'R(j=>TF.tfAttn(3,j),6)',
     [0.0966, 0.1118, 0.0659, 0.4167, 0.0617, 0.2471], 5e-4),
    ('scaling relaxes row 3 ("on"), unmasked, scaled',
     {'s3_scale': 1, 's3_mask': 0}, 'R(j=>TF.tfAttn(3,j),6)',
     [0.1197, 0.1327, 0.0913, 0.3365, 0.0872, 0.2325], 5e-4),
    # From step 4 onwards the mask is on, and the doc panel's full attention
    # table quotes this masked row.
    ('row 3 masked and scaled (doc-panel table)',
     {'s3_scale': 1}, 'R(j=>TF.tfAttn(3,j),4)', [0.176, 0.1951, 0.1343, 0.4946], 5e-4),

    # RoPE REPLACES additive positional encoding; it never stacks on top of it.
    # With s2_rope on, the layer input must be the RAW embedding -- position
    # enters later, once, as a rotation of q and k. If the sinusoidal PE term
    # survived here, the lesson would be rotating a vector that already carried
    # an additive positional offset, which no model does.
    ('RoPE replaces additive PE: layer input is the raw embedding',
     {'s2_rope': 1, 's1_pe': 1}, 'R(i=>R(d=>TF.tfX(i,d)-TF.tfEmb(i,d),4),6).flat()',
     [0.0] * 24, 0.0),
    # ...and with RoPE off the additive PE is still there (x[0] = emb + PE).
    ('PE still added when RoPE is off',
     {'s2_rope': 0, 's1_pe': 1}, 'R(d=>TF.tfX(0,d),4)', [1.0, 1.0, 0.0, 1.0], 5e-4),
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
    print('transformer domain — tfToken (drives the embedding lattice row labels)')
    # tfToken is the one function here that returns TEXT, not a number: scene 1
    # step 5 feeds it to axes[].labelExpr so the lattice relabels itself under
    # shuffle instead of asserting an equation it no longer satisfies. If the
    # labels ever stop tracking tfPerm, the `e + PE = x` on screen becomes false.
    tokens = ['the', 'cat', 'sat', 'on', 'the', 'mat']
    for shuffle, want in ((0, tokens), (1, [tokens[k] for k in perm])):
        got = _run('R(k=>TF.tfToken(k),6)', {**DEFAULT_SLIDERS, 's1_shuffle': shuffle})
        if got == want:
            print(f'  ok   tfToken at s1_shuffle={shuffle} -> {got}')
        else:
            print(f'  FAIL tfToken at s1_shuffle={shuffle}')
            print(f'         got  {got}')
            print(f'         want {want}')
            failures += 1

    # The labels are only honest if they name the row they sit on: the token at
    # slot k must be the token whose embedding row tfEmb(k, .) reproduces.
    emb = {'the': [1, 0, 0, 0], 'cat': [0, 1, 0, 0], 'sat': [0, 0, 1, 0],
           'on': [0, 0, 0, 1], 'mat': [0.5, 0.5, 0, 0.5]}
    for shuffle in (0, 1):
        names = _run('R(k=>TF.tfToken(k),6)', {**DEFAULT_SLIDERS, 's1_shuffle': shuffle})
        rows = _run('R(i=>R(d=>TF.tfEmb(i,d),4),6)', {**DEFAULT_SLIDERS, 's1_shuffle': shuffle})
        bad = [k for k in range(6)
               if max(abs(a - b) for a, b in zip(rows[k], emb[names[k]])) > 1e-12]
        if not bad:
            print(f'  ok   label names its own row at s1_shuffle={shuffle}')
        else:
            print(f'  FAIL label contradicts its row at s1_shuffle={shuffle}, slots {bad}')
            failures += 1

    print()
    print('transformer domain — tfProjQK (the projection line drawn on the score step)')
    # The picture claims two things. Both are exact, so pin them exactly:
    #   proj . k == q . k        the drawn segment IS the printed score
    #   (q - proj) . k == 0      the dropped line really is perpendicular
    # If either drifts, the step shows a right angle that is not one, or a
    # length that is not the number beside it.
    for ang in (0, 37, -120, 180):
        for j in range(6):
            q = _run(f'R(dd=>TF.tfQProbe(dd,{ang}),2)', DEFAULT_SLIDERS)
            k = _run(f'R(dd=>TF.tfK({j},dd),2)', DEFAULT_SLIDERS)
            pr = _run(f'R(dd=>TF.tfProjQK(dd,{ang},{j}),2)', DEFAULT_SLIDERS)
            qk = q[0] * k[0] + q[1] * k[1]
            pk = pr[0] * k[0] + pr[1] * k[1]
            perp = (q[0] - pr[0]) * k[0] + (q[1] - pr[1]) * k[1]
            if abs(pk - qk) > 1e-9 or abs(perp) > 1e-9:
                print(f'  FAIL angle={ang} key={j}: proj.k={pk:.9f} vs q.k={qk:.9f}, '
                      f'residual.k={perp:.2e}')
                failures += 1
                break
        else:
            continue
        break
    else:
        print('  ok   proj.k == q.k and (q-proj).k == 0 at 4 angles x 6 keys')

    print()
    print('transformer domain — tfScoreProbe (drives the live row of scores)')
    # The row of scores is bound to the WHAT-IF query now, not the model's fixed
    # q_2. That is only safe if the default state is unchanged: at angle 0 the
    # probe IS the model's own query, so the step may keep quoting cat 15.1397
    # and on -7.0890. Exact equality, not a tolerance -- it is the same arithmetic.
    probe0 = _run('R(j=>TF.tfScoreProbe(j,0),6)', DEFAULT_SLIDERS)
    model = _run('R(j=>TF.tfScore(2,j),6)', DEFAULT_SLIDERS)
    if probe0 == model:
        print('  ok   tfScoreProbe(j,0) == tfScore(2,j) exactly, all six keys')
    else:
        print('  FAIL tfScoreProbe(j,0) != tfScore(2,j)')
        print(f'         probe {probe0}')
        print(f'         model {model}')
        failures += 1
    failures += 0 if _report('quoted row figures survive the rebinding',
                             [probe0[1], probe0[3]], [15.1397, -7.089], 5e-5) else 1

    if failures:
        print(f'{failures} check(s) FAILED — the lesson quotes numbers the domain no longer computes.')
        return 1
    print('All transformer domain checks pass.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
