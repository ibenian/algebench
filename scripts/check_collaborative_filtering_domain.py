#!/usr/bin/env python3
"""Check the collaborative-filtering domain library against a NumPy reference.

static/domains/collaborative-filtering/index.js computes everything the lesson
puts on screen: kNN predictions, ALS and SGD training runs, the zero-fill fit,
the capacity sweep, the invariance map, biases, fold-in and implicit ALS.
This script re-implements each algorithm independently in NumPy, including the
mulberry32 initialisation (bit for bit), and compares under several slider
configurations. It also pins the headline numbers that
scenes/collaborative-filtering.json quotes in prose, so a drift there fails
here.

If a check here fails, the lesson is wrong -- not the test.

Usage:  ./run.sh scripts/check_collaborative_filtering_domain.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
DOMAIN = REPO / 'static' / 'domains' / 'collaborative-filtering' / 'index.js'

NU = NI = 6
MAX_EPOCH = 300
SWEEP_EPOCHS = 200
ZERO_EPOCHS = 200
FOLD_LAMBDA = 0.1
IMP_LAMBDA = 0.1
IMP_ITERS = 30
POS_ITERS = 50

PSTAR = np.array([[2, .5, .5], [.5, 2, .5], [.5, .5, 2], [1.5, 1, .5], [1, 1, 1], [1, .5, 1.5]])
QSTAR = np.array([[2, 0, 0], [0, 2, 0], [0, 0, 2], [2, 2, 0], [2, 0, 2], [0, 2, 2]], float)
R_DEFAULT = PSTAR @ QSTAR.T
HIDDEN = [(0, 1), (1, 5), (2, 4), (3, 0), (4, 2), (5, 3)]
OBS_DEFAULT = np.ones((6, 6))
for _u, _i in HIDDEN:
    OBS_DEFAULT[_u, _i] = 0
C_DEFAULT = np.where(R_DEFAULT == 5, 6.0, np.where(R_DEFAULT == 4, 2.0, 0.0))
C_DEFAULT[0, 5] = 1

M32 = 0xFFFFFFFF


# ---- NumPy reference ---------------------------------------------------------

def mulberry32(seed: int):
    a = seed & M32

    def nxt() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & M32
        t = ((a ^ (a >> 15)) * (1 | a)) & M32
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & M32)) & M32) ^ t
        return ((t ^ (t >> 14)) & M32) / 4294967296
    return nxt


def init(k: int, seed: int):
    rng = mulberry32(seed)
    P = np.array([[rng() for _ in range(k)] for _ in range(NU)])
    Q = np.array([[rng() for _ in range(k)] for _ in range(NI)])
    return P, Q


def ridge_row(Y, t, w, lam):
    sel = w > 0
    k = Y.shape[1]
    if not sel.any():
        return np.zeros(k)
    Ys, ws = Y[sel], w[sel]
    A = (Ys * ws[:, None]).T @ Ys + lam * np.eye(k)
    b = (Ys * (ws * t[sel])[:, None]).sum(0)
    try:
        return np.linalg.solve(A, b)
    except np.linalg.LinAlgError:   # the JS retries a singular system with a 1e-9 ridge
        return np.linalg.solve(A + 1e-9 * np.eye(k), b)


def als(R, W, k, lam, epochs, seed):
    P, Q = init(k, seed)
    hist = [(P.copy(), Q.copy())]
    for _ in range(epochs):
        P = np.array([ridge_row(Q, R[u], W[u], lam) for u in range(NU)])
        Q = np.array([ridge_row(P, R[:, i], W[:, i], lam) for i in range(NI)])
        hist.append((P.copy(), Q.copy()))
    return hist


def sgd(R, obs, k, lam, gamma, epochs, seed):
    P, Q = init(k, seed)
    hist = [(P.copy(), Q.copy())]
    cells = [(u, i) for u in range(NU) for i in range(NI) if obs[u, i]]
    for _ in range(epochs):
        for u, i in cells:
            e = R[u, i] - P[u] @ Q[i]
            pu = P[u].copy()
            P[u] = P[u] + gamma * (e * Q[i] - lam * P[u])
            Q[i] = Q[i] + gamma * (e * pu - lam * Q[i])
        hist.append((P.copy(), Q.copy()))
    return hist


def rmse(P, Q, R, sel):
    E = (R - P @ Q.T)[sel]
    return float(np.sqrt(np.mean(E ** 2))) if E.size else 0.0


def user_mean(R, obs, u):
    m = obs[u] > 0
    return R[u, m].mean() if m.any() else 0.0


def pearson(R, obs, a, b):
    if a == b:
        return 1.0
    co = (obs[a] > 0) & (obs[b] > 0)
    x = R[a, co] - user_mean(R, obs, a)
    y = R[b, co] - user_mean(R, obs, b)
    if co.sum() < 2 or (x @ x) == 0 or (y @ y) == 0:
        return 0.0
    return float(x @ y / np.sqrt((x @ x) * (y @ y)))


def knn(R, obs, u, i, n):
    cand = sorted(((v, pearson(R, obs, u, v)) for v in range(NU) if v != u and obs[v, i]),
                  key=lambda t: (-t[1], t[0]))[:n]
    num = sum(w * (R[v, i] - user_mean(R, obs, v)) for v, w in cand)
    den = sum(abs(w) for _, w in cand)
    return user_mean(R, obs, u) + (num / den if den > 0 else 0.0)


def biases(R, obs):
    m = obs > 0
    mu = R[m].mean()
    bi = np.array([(R[m[:, i], i] - mu).mean() if m[:, i].any() else 0 for i in range(NI)])
    bu = np.array([(R[u, m[u]] - mu - bi[m[u]]).mean() if m[u].any() else 0 for u in range(NU)])
    return mu, bu, bi


def rot(theta_deg, axis, stretch):
    t = np.radians(theta_deg)
    c, s = np.cos(t), np.sin(t)
    a, b = {0: (1, 2), 1: (2, 0), 2: (0, 1)}[axis]
    Rm = np.eye(3)
    Rm[a, a], Rm[a, b], Rm[b, a], Rm[b, b] = c, -s, s, c
    D = np.diag([stretch, 1, 1])
    return D @ Rm, np.linalg.inv(D) @ Rm


# ---- node harness ------------------------------------------------------------

HARNESS = r"""
const fs = require('fs');
const sliders = %SLIDERS%;
global.window = { AlgeBenchDomains: { register: (n, api) => { global.CF = api; } } };
eval(fs.readFileSync(%DOMAIN%, 'utf8'));
CF._init({ getSlider: (id, fb) => (id in sliders ? sliders[id] : fb) });
const R = (f, n) => Array.from({ length: n }, (_, i) => f(i));
const M = (f) => R(u => R(i => f(u, i), 6), 6);
const out = {};
for (const [name, src] of Object.entries(%EXPRS%)) out[name] = eval(src);
console.log(JSON.stringify(out));
"""


def run_js(exprs: dict[str, str], sliders: dict) -> dict:
    js = (HARNESS.replace('%SLIDERS%', json.dumps(sliders))
                 .replace('%DOMAIN%', json.dumps(str(DOMAIN)))
                 .replace('%EXPRS%', json.dumps(exprs)))
    out = subprocess.run(['node', '-e', js], capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise RuntimeError(f'node failed:\n{out.stderr.strip()}')
    return json.loads(out.stdout.strip())


_failures = 0


def check(label: str, got, want, tol: float) -> None:
    global _failures
    g, w = np.asarray(got, float), np.asarray(want, float)
    ok = g.shape == w.shape and np.allclose(g, w, atol=tol, rtol=0, equal_nan=True)
    print(f'  {"ok  " if ok else "FAIL"} {label}')
    if not ok:
        _failures += 1
        print(f'         got  {np.round(g, 6).tolist()}')
        print(f'         want {np.round(w, 6).tolist()}')


# ---- configurations ----------------------------------------------------------

def config_case(name: str, sl: dict) -> None:
    """Compare every learned quantity against the reference for slider set sl."""
    R = np.array(sl.get('cf_R', R_DEFAULT), float)
    obs = (np.array(sl.get('cf_obs', OBS_DEFAULT), float) >= 0.5).astype(float)
    k = int(sl.get('cf_k', 3))
    lam = float(sl.get('cf_lambda', 0.01))
    seed = int(sl.get('cf_seed', 1))
    gamma = float(sl.get('cf_gamma', 0.05))
    alpha = float(sl.get('cf_alpha', 10))
    C = np.array(sl.get('cf_C', C_DEFAULT), float)
    me = np.array(sl.get('cf_me', [[0] * 6]), float)[0]
    knn_n = int(sl.get('cf_knn', 2))
    test, train = obs == 0, obs > 0

    epochs = [0, 1, 2, 5, 10, 50, 300]
    exprs = {
        'als_train': f'R(j=>CF.cfAlsTrain({epochs}[j]),{len(epochs)})',
        'als_test': f'R(j=>CF.cfAlsTest({epochs}[j]),{len(epochs)})',
        'sgd_train': f'R(j=>CF.cfSgdTrain({epochs}[j]),{len(epochs)})',
        'sgd_test': f'R(j=>CF.cfSgdTest({epochs}[j]),{len(epochs)})',
        'pred': 'M(CF.cfPred)',
        'P': f'R(u=>R(f=>CF.cfP(u,f),{k}),6)',
        'zero': 'M(CF.cfZeroPred)', 'zero_rmse': 'CF.cfZeroRmse()',
        'sweep': 'R(k=>R(l=>CF.cfSweepTest(k+1,[0,0.01,0.1,1][l]),4),5)',
        'sim': 'M(CF.cfSim)', 'knn': 'M((u,i)=>CF.cfKnn(u,i))', 'knn_rmse': 'CF.cfKnnRmse()',
        'base': 'M(CF.cfBaseline)', 'base_rmse': 'CF.cfBaselineRmse()',
        'me': 'R(CF.cfMe,3)', 'me_pred': 'R(CF.cfMePred,6)',
        'imp': 'M(CF.cfImpPred)', 'pos': 'M(CF.cfImpPosOnly)',
        'map_pred': 'M(CF.cfMapPred)', 'map_P': 'R(u=>R(f=>CF.cfMapP(u,f),3),6)',
        'map_Q': 'R(i=>R(f=>CF.cfMapQ(i,f),3),6)',
        'fitA': 'R(r=>R(c=>CF.cfFitA(r,c),3),3)', 'fit_resid': 'CF.cfFitResid()',
    }
    js = run_js(exprs, sl)
    print(f'\n{name}')

    h = als(R, obs, k, lam, MAX_EPOCH, seed)
    check('ALS train RMSE by epoch', js['als_train'], [rmse(*h[e], R, train) for e in epochs], 1e-9)
    check('ALS test RMSE by epoch', js['als_test'], [rmse(*h[e], R, test) for e in epochs], 1e-9)
    Pf, Qf = h[min(int(sl.get('cf_epoch', MAX_EPOCH)), MAX_EPOCH)]
    if int(sl.get('cf_algo', 0)) == 0:
        check('ALS learned P', js['P'], Pf, 1e-9)
        check('ALS predictions', js['pred'], Pf @ Qf.T, 1e-9)
    hs = sgd(R, obs, k, lam, gamma, MAX_EPOCH, seed)
    check('SGD train RMSE by epoch', js['sgd_train'], [rmse(*hs[e], R, train) for e in epochs], 1e-8)
    check('SGD test RMSE by epoch', js['sgd_test'], [rmse(*hs[e], R, test) for e in epochs], 1e-8)

    Rz = np.where(obs > 0, R, 0)
    U, s, Vt = np.linalg.svd(Rz)
    Z = (U[:, :k] * s[:k]) @ Vt[:k]
    check('zero-fill == truncated SVD of zero-filled R', js['zero'], Z, 1e-6)
    check('zero-fill test RMSE', js['zero_rmse'], float(np.sqrt(np.mean((R - Z)[test] ** 2))), 1e-6)

    sweep = [[rmse(*als(R, obs, kk, ll, SWEEP_EPOCHS, seed)[-1], R, test) for ll in (0, 0.01, 0.1, 1)]
             for kk in range(1, 6)]
    # With fewer observations, lambda = 0 and large k leave some per-row
    # systems singular; both sides then take an arbitrary member of the
    # solution set, so only the regularised columns are comparable.
    first = 0 if 'cf_obs' not in sl else 1
    check(f'capacity sweep test RMSE (k=1..5 x lambda{" > 0" if first else ""})',
          [r[first:] for r in js['sweep']], [r[first:] for r in sweep], 1e-5)

    check('Pearson similarity matrix', js['sim'], [[pearson(R, obs, a, b) for b in range(6)] for a in range(6)], 1e-12)
    check('kNN predictions', js['knn'], [[knn(R, obs, u, i, knn_n) for i in range(6)] for u in range(6)], 1e-12)
    kt = [(R[u, i] - knn(R, obs, u, i, knn_n)) ** 2 for u in range(6) for i in range(6) if test[u, i]]
    check('kNN test RMSE', js['knn_rmse'], np.sqrt(np.mean(kt)), 1e-12)

    mu, bu, bi = biases(R, obs)
    B = mu + bu[:, None] + bi[None, :]
    check('baseline mu + b_u + b_i', js['base'], B, 1e-12)
    check('baseline test RMSE', js['base_rmse'], float(np.sqrt(np.mean((R - B)[test] ** 2))), 1e-12)

    qstar = np.array(sl.get('cf_qstar', QSTAR), float)
    pme = ridge_row(qstar, me, (me >= 1).astype(float), FOLD_LAMBDA)
    check('fold-in vector', js['me'], pme, 1e-12)
    check('fold-in predictions', js['me_pred'], qstar @ pme, 1e-12)

    pref, conf = (C > 0).astype(float), 1 + alpha * C
    X, Y = als(pref, conf, k, IMP_LAMBDA, IMP_ITERS, seed)[-1]
    check('implicit weighted-ALS predictions', js['imp'], X @ Y.T, 1e-9)
    Xp, Yp = als(np.ones((6, 6)), pref, k, IMP_LAMBDA, POS_ITERS, seed)[-1]
    check('positives-only control', js['pos'], Xp @ Yp.T, 1e-9)

    if k == 3 and int(sl.get('cf_algo', 0)) == 0:
        A, Ait = rot(float(sl.get('cf_theta', 0)), int(sl.get('cf_axis', 2)), float(sl.get('cf_stretch', 1)))
        check('mapped P = P A', js['map_P'], Pf @ A, 1e-9)
        check('mapped Q = Q A^-T', js['map_Q'], Qf @ Ait, 1e-9)
        check('predictions unchanged under the map', js['map_pred'], Pf @ Qf.T, 1e-9)
        pstar = np.array(sl.get('cf_pstar', PSTAR), float)
        Afit = np.linalg.lstsq(pstar, Pf, rcond=None)[0]
        check('least-squares A with P* A ~ P', js['fitA'], Afit, 1e-9)
        check('fit residual', js['fit_resid'], np.abs(pstar @ Afit - Pf).max(), 1e-9)


def pinned() -> None:
    """The numbers the lesson prose quotes, under default sliders."""
    print('\npinned values quoted by scenes/collaborative-filtering.json')
    js = run_js({
        'R': 'M(CF.cfR)', 'nobs': 'CF.cfNObs()',
        'als10': 'CF.cfAlsTest(10)', 'als0': 'CF.cfAlsTest(0)', 'als300': 'CF.cfAlsTest(300)',
        'sgd300': 'CF.cfSgdTest(300)', 'sgd100': 'CF.cfSgdTest(100)',
        'hidden': 'R(j=>CF.cfPred([0,1,2,3,4,5][j],[1,5,4,0,2,3][j]),6)',
        'zero_rmse': 'CF.cfZeroRmse()',
        'zero_hidden_5s': '[CF.cfZeroPred(1,5), CF.cfZeroPred(2,4)]',
        'k5l0': 'CF.cfSweepTest(5,0)', 'k5l01': 'CF.cfSweepTest(5,0.01)', 'k3l0': 'CF.cfSweepTest(3,0)',
        'knn_rmse': 'CF.cfKnnRmse(2)', 'dan_dh': 'CF.cfKnn(3,0,2)',
        'dan_nbrs': '[CF.cfKnnNbr(3,0,0,2), CF.cfKnnNbr(3,0,1,2)]',
        'base_rmse': 'CF.cfBaselineRmse()', 'mu': 'CF.cfMu()',
        'qlen': '[CF.cfQstarLen(0), CF.cfQstarLen(3)]',
        'fit_resid': 'CF.cfFitResid()',
    }, {})
    check('R = P* Q*^T, integers 1..5', js['R'], R_DEFAULT, 0)
    check('30 observed ratings', js['nobs'], 30, 0)
    check('ALS test RMSE: 2.68 at init', js['als0'], 2.684, 5e-4)
    check('ALS test RMSE: 0.14 after 10 epochs', js['als10'], 0.140, 5e-4)
    check('ALS test RMSE: 0.068 after 300 epochs', js['als300'], 0.068, 5e-4)
    check('SGD test RMSE: 0.43 at 100, 0.24 at 300', [js['sgd100'], js['sgd300']], [0.428, 0.239], 5e-4)
    check('hidden predictions ~ truth (1,5,5,3,2,3)', js['hidden'], [0.97, 4.85, 4.96, 2.97, 2.02, 3.01], 5e-3)
    check('zero-fill test RMSE 2.73', js['zero_rmse'], 2.7315, 5e-4)
    check('zero-fill predicts the hidden 5s as ~0.8 and ~0.6', js['zero_hidden_5s'], [0.766, 0.601], 5e-4)
    check('k=5, lambda=0 memorises: test RMSE ~12.3', js['k5l0'], 12.27, 5e-3)
    check('k=5, lambda=0.01: test RMSE ~1.06', js['k5l01'], 1.063, 5e-3)
    check('k=3, lambda=0: exact recovery', js['k3l0'], 0, 1e-9)
    check('kNN (n=2) test RMSE 1.61', js['knn_rmse'], 1.614, 5e-4)
    check('kNN Dan x Die Hard = 2.75 (truth 3)', js['dan_dh'], 2.748, 5e-4)
    check("Dan's neighbours for Die Hard: Ava, Eli", js['dan_nbrs'], [0, 4], 0)
    check('baseline test RMSE 1.23', js['base_rmse'], 1.232, 5e-4)
    check('mu = 2.97', js['mu'], 89 / 30, 1e-12)
    check('|q| = 2 (pure) vs 2.83 (mixed)', js['qlen'], [2, 2 * np.sqrt(2)], 1e-12)
    check('learned P = P* A up to 0.011', js['fit_resid'], 0.0111, 5e-4)


def main() -> int:
    if not DOMAIN.is_file():
        print(f'error: {DOMAIN} not found', file=sys.stderr)
        return 2
    if shutil.which('node') is None:
        print('error: node is required to evaluate the domain module', file=sys.stderr)
        return 2

    print('collaborative-filtering domain vs NumPy reference')
    config_case('default sliders', {})
    edited = R_DEFAULT.copy()
    edited[2, 0], edited[4, 4] = 3, 2
    obs = OBS_DEFAULT.copy()
    obs[0, 0], obs[5, 5] = 0, 0
    config_case('edited ratings, more hidden cells, k=2, lambda=0.1, seed 5, epoch 7', {
        'cf_R': edited.tolist(), 'cf_obs': obs.tolist(), 'cf_k': 2, 'cf_lambda': 0.1,
        'cf_seed': 5, 'cf_epoch': 7, 'cf_knn': 3, 'cf_gamma': 0.03,
    })
    C = C_DEFAULT.copy()
    C[3, 0] = 3
    config_case('rotated + stretched map, implicit alpha 40, fold-in with three ratings', {
        'cf_theta': 37, 'cf_axis': 1, 'cf_stretch': 1.7, 'cf_alpha': 40, 'cf_C': C.tolist(),
        'cf_me': [[5, 0, 2, 0, 0, 4]], 'cf_epoch': 40,
    })
    pinned()

    print()
    if _failures:
        print(f'{_failures} check(s) FAILED')
        return 1
    print('all checks passed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
