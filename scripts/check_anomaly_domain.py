#!/usr/bin/env python3
"""Assert the anomaly domain library computes the algorithms it advertises.

The lesson's claim is that every score on screen is the published definition,
not a hand-drawn impression of one. This script makes that claim testable: it
pulls the raw datasets out of static/domains/anomaly/index.js, recomputes the
statistical, distance, density and evaluation scores FROM SCRATCH in NumPy from
the textbook formula, and compares. A drift in either the data or the arithmetic
fails here. The data half is not a hash: the datasets are Box-Muller
normals, whose transcendentals are not bit-identical across V8 versions,
so the corpus is pinned as exact integer facts plus mean/std/min/max per
array to 1e-9 -- see CORPUS_TOL. That catches a moved centre, a changed
sigma, a different seed or a resized dataset, and tolerates libm.

The Isolation Forest is the one exception, and it is deliberate: the trees are
randomised, so a reimplementation cannot be compared pointwise. What is pinned
instead is c(n), the score/depth identity, ranges, separation and determinism.
A bug in subsampling, axis choice or split construction would NOT be caught.

Three kinds of check:

  parity      -- an independent NumPy implementation of the same definition,
                 compared pointwise. This is the bulk of the file.
  invariants  -- properties a correct implementation must have but that a
                 reimplementation cannot pin, because the object is randomised
                 (the Isolation Forest) or defined implicitly (the kernel
                 level set).
  pinned      -- the handful of figures the lesson QUOTES on screen. These
                 depend on the seeded data, so they catch a change to the
                 generator that the parity checks would happily follow.

If a check here fails, the lesson is wrong -- not the test.

Usage:  ./run.sh scripts/check_anomaly_domain.py
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
DOMAIN = REPO / 'static' / 'domains' / 'anomaly' / 'index.js'

MAD_K = 1.482602218505602
EULER = 0.5772156649015329

HARNESS = """
const fs = require('fs');
let AD = null;
global.window = { AlgeBenchDomains: { register: (n, f) => { AD = f; } } };
eval(fs.readFileSync(%DOMAIN%, 'utf8'));
const R = (f, n) => Array.from({ length: n }, (_, i) => f(i));
console.log(JSON.stringify(%EXPR%));
"""

_failures: list[str] = []


# Drift detection for the seeded corpus. The parity checks below read their
# reference inputs out of the module under test, which makes them a check of
# the ARITHMETIC only: if the dataset generator drifted, `raw` would drift with
# it and every comparison would still agree. This closes that hole.
#
# It was a SHA-256 over the raw floats and that was wrong -- not too weak, too
# strict. The datasets are Box-Muller normals, so their values run through
# Math.log, Math.cos and Math.sin, and V8 does not produce those bit-identically
# across versions: the digest passed on node 22.17 and failed on 22.23 in CI
# while every arithmetic check still passed, because a hash cannot express a
# tolerance. Rounding before hashing does not rescue it either -- with ~1e-16
# of transcendental noise and a few thousand values, some value eventually
# straddles a rounding boundary and the hash flips for nothing.
#
# So: the EXACT half is the integers, which are portable by construction, and
# the FLOAT half is pinned summary statistics with a tolerance far above libm
# noise and far below any real change. Moving a cluster's centre or sigma, the
# seed, the contamination schedule or the sampler moves a mean or a range by
# orders of magnitude more than 1e-9.
CORPUS_TOL = 1e-9

# mean, std, min, max per array -- pinned from a deliberate regeneration.
CORPUS_STATS = {
    'ds.blob.x': [192.0, 0.042810798472, 1.282734408688, -4.924533381127, 4.136566885281],
    'ds.blob.y': [192.0, -0.064823946947, 1.194205035306, -4.668372694869, 3.690807064995],
    'ds.blob.lab': [192, 12, 0, 1],
    'ds.dense.x': [153.0, -0.475668956926, 2.313560163165, -3.6, 4.996134582482],
    'ds.dense.y': [153.0, 0.023133968549, 0.712916076533, -2.958636335328, 2.948596676123],
    'ds.dense.lab': [153, 3, 0, 1],
    'ds.ellip.x': [162.0, 0.001386687163, 1.427949010059, -4.451346142938, 4.211935306152],
    'ds.ellip.y': [162.0, 0.024083139659, 1.467815394984, -4.713312632953, 3.598131163577],
    'ds.ellip.lab': [162, 1, 0, 1],
    'ds.ring.x': [208.0, -0.09371999538, 1.740314776797, -3.9, 4.1],
    'ds.ring.y': [208.0, 0.198804394979, 1.685207139736, -4.0, 4.2],
    'ds.ring.lab': [208, 8, 0, 1],
    'metric': [540.0, 51.507596926894, 7.525671417253, 41.805492962814, 92.0],
    'planted': [540, 36, 0, 1],
    'sig': [128.0, 9.942731028241, 2.219453234995, 5.386376821552, 13.893802803929],
    'sigLab': [128, 9, 0, 1],
    'score': [400.0, 0.313116370368, 0.145929554226, 0.0, 1.0],
    'evalLab': [400, 32, 0, 1],
}
def run(expr: str):
    """Evaluate a JS expression against the domain module, as parsed JSON."""
    js = HARNESS.replace('%DOMAIN%', json.dumps(str(DOMAIN))).replace('%EXPR%', expr)
    out = subprocess.run(['node', '-e', js], capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise RuntimeError(f'node failed for {expr}:\n{out.stderr.strip()}')
    return json.loads(out.stdout.strip())


def check(label: str, got, want, tol: float = 1e-9) -> None:
    g = np.atleast_1d(np.asarray(got, dtype=float))
    w = np.atleast_1d(np.asarray(want, dtype=float))
    if g.shape != w.shape:
        _failures.append(label)
        print(f'  FAIL {label}: shape {g.shape} vs {w.shape}')
        return
    worst = float(np.max(np.abs(g - w))) if g.size else 0.0
    if worst <= tol:
        print(f'  ok   {label}   (max dev {worst:.2e})')
    else:
        _failures.append(label)
        bad = int(np.argmax(np.abs(g - w)))
        print(f'  FAIL {label}: max deviation {worst:.3e} at index {bad}')
        print(f'         got  {g.flat[bad]!r}')
        print(f'         want {w.flat[bad]!r}')


def assert_true(label: str, ok: bool, detail: str = '') -> None:
    if ok:
        print(f'  ok   {label}')
    else:
        _failures.append(label)
        print(f'  FAIL {label}' + (f': {detail}' if detail else ''))


# --------------------------------------------------------------------------
# NumPy reference implementations. Deliberately written from the published
# definition rather than transcribed from the JS -- a transcription would
# agree with a bug.
# --------------------------------------------------------------------------

def ref_c(n: int) -> float:
    """c(n) = 2 H(n-1) - 2(n-1)/n, with H summed exactly.

    This used to mirror the module's ln(m) + gamma shortcut, which made the
    parity check agree with the implementation while both drifted from the
    formula the lesson displays -- a reference has to be independent of the
    thing it checks to be worth anything.
    """
    if n <= 1:
        return 0.0
    if n == 2:
        return 1.0
    return 2 * sum(1.0 / j for j in range(1, n)) - 2 * (n - 1) / n


_M32 = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    """JS Math.imul: the low 32 bits of a*b, read as signed."""
    r = ((a & _M32) * (b & _M32)) & _M32
    return r - 0x100000000 if r >= 0x80000000 else r


def _s32(x: int) -> int:
    x &= _M32
    return x - 0x100000000 if x >= 0x80000000 else x


def _splitmix32(seed: int):
    """The module's PRNG, ported. Not pulled from the module on purpose: this
    is the one check that regenerates its own data, so it verifies the
    GENERATOR as well as the arithmetic."""
    state = [_s32(seed)]

    def nxt() -> float:
        state[0] = _s32(state[0] + 0x9E3779B9)
        t = state[0] & _M32
        t ^= t >> 16
        t = _imul(t, 0x21F0AAAD) & _M32
        t ^= t >> 15
        t = _imul(t, 0x735A2D97) & _M32
        t ^= t >> 15
        return (t & _M32) / 4294967296
    return nxt


def _seed_of(tag: str) -> int:
    """FNV-1a over the tag, as the module does it."""
    h = 0x811C9DC5
    for ch in tag:
        h = _imul(h ^ ord(ch), 0x01000193)
    return _s32(h ^ 0x5EED1234)


CONC_N = 120


def ref_conc(d: int):
    """Relative contrast (dmax - dmin) / dmin averaged over 120 uniform points
    in d dimensions, plus the mean nearest and farthest distances."""
    rng = _splitmix32(_seed_of('conc|' + str(d)))
    p = np.array([rng() for _ in range(CONC_N * d)]).reshape(CONC_N, d)
    dist = np.sqrt(((p[:, None, :] - p[None, :, :]) ** 2).sum(-1))
    np.fill_diagonal(dist, np.nan)
    lo = np.nanmin(dist, axis=1)
    hi = np.nanmax(dist, axis=1)
    return float(np.mean((hi - lo) / lo)), float(lo.mean()), float(hi.mean())


def ref_knn(pts: np.ndarray, k: int) -> np.ndarray:
    d = np.linalg.norm(pts[:, None, :] - pts[None, :, :], axis=2)
    np.fill_diagonal(d, np.inf)
    return np.sort(d, axis=1)[:, k - 1]


def ref_lof(pts: np.ndarray, k: int) -> np.ndarray:
    n = len(pts)
    d = np.linalg.norm(pts[:, None, :] - pts[None, :, :], axis=2)
    np.fill_diagonal(d, np.inf)
    order = np.argsort(d, axis=1, kind='stable')
    nb = order[:, :k]                       # the k nearest neighbours of each point
    kdist = np.take_along_axis(d, nb[:, -1:], axis=1).ravel()
    # reach-dist_k(a, b) = max(k-distance(b), d(a, b))
    reach = np.maximum(kdist[nb], np.take_along_axis(d, nb, axis=1))
    lrd = k / reach.sum(axis=1)
    return lrd[nb].sum(axis=1) / k / lrd


def ref_cov(pts: np.ndarray):
    mu = pts.mean(axis=0)
    c = np.cov(pts.T, ddof=1)
    return mu, c


def ref_mahal(pts: np.ndarray) -> np.ndarray:
    mu, c = ref_cov(pts)
    dev = pts - mu
    inv = np.linalg.inv(c)
    return np.sqrt(np.einsum('ij,jk,ik->i', dev, inv, dev))


def ref_recon(v: np.ndarray, r: int) -> np.ndarray:
    n = len(v)
    out = np.full(n, v.mean())
    i = np.arange(n)
    for k in range(1, r + 1):
        w = 2 * np.pi * k * i / n
        a = 2 / n * (v * np.cos(w)).sum()
        b = 2 / n * (v * np.sin(w)).sum()
        out = out + a * np.cos(w) + b * np.sin(w)
    return out


def _corpus_arrays(raw):
    """The seeded corpus, flattened to (name, array) pairs."""
    out = []
    for t in sorted(raw['ds']):
        for part in ('x', 'y', 'lab'):
            out.append((f'ds.{t}.{part}', np.asarray(raw['ds'][t][part], dtype=float)))
    for k in ('metric', 'planted'):
        out.append((k, np.asarray(raw[k], dtype=float).ravel()))
    for k in ('sig', 'sigLab', 'score', 'evalLab'):
        out.append((k, np.asarray(raw[k], dtype=float)))
    return out


def _corpus_stats(arr):
    """Integers get exact facts; floats get the shape of the distribution."""
    is_int = bool(np.all(arr == np.round(arr)))
    if is_int:
        return True, [len(arr), float(arr.sum()), float(arr.min()), float(arr.max())]
    return False, [len(arr), float(arr.mean()), float(arr.std()),
                   float(arr.min()), float(arr.max())]


def _check_corpus(raw) -> None:
    """Integers exactly, floats to CORPUS_TOL. See CORPUS_STATS above for why.

    Coverage is asserted BEFORE the values are. An unpinned field used to warn
    and continue, so a new or renamed dataset output could be entirely
    unchecked while the run still went green -- the guarantee regressing in
    silence, which is the failure mode this whole block exists to prevent. A
    stale pin is the same hole from the other side: an output that disappears
    leaves an entry nothing compares against, and the count still looks right.
    """
    arrays = _corpus_arrays(raw)
    got_names = {name for name, _ in arrays}
    unpinned = sorted(got_names - set(CORPUS_STATS))
    stale = sorted(set(CORPUS_STATS) - got_names)
    if unpinned:
        print('  !! pin these, then re-run:')
        for name, arr in arrays:
            if name in unpinned:
                print(f"       '{name}': {[round(v, 12) for v in _corpus_stats(arr)[1]]},")
    assert_true(f'every corpus array is pinned ({len(got_names)} arrays)',
                not unpinned and not stale,
                f'unpinned: {unpinned or "none"} / stale pins: {stale or "none"}')

    for name, arr in arrays:
        if name not in CORPUS_STATS:
            continue
        is_int, got = _corpus_stats(arr)
        check(f'corpus {name}', got, CORPUS_STATS[name], 0 if is_int else CORPUS_TOL)


def main() -> int:
    if not DOMAIN.is_file():
        print(f'error: {DOMAIN} not found', file=sys.stderr)
        return 2
    if shutil.which('node') is None:
        print('error: node is required to evaluate the domain module', file=sys.stderr)
        return 2

    tags = ['blob', 'dense', 'ellip', 'ring']

    # One node call for the whole corpus: the datasets, the metric at every
    # contamination, the signal, and the evaluation set.
    print('pulling the raw data out of the module')
    raw = run(
        '{'
        'ds: {' + ','.join(
            f'{t}: {{n: AD.adN("{t}"), '
            f'x: R(i => AD.adX("{t}", i), AD.adN("{t}")), '
            f'y: R(i => AD.adY("{t}", i), AD.adN("{t}")), '
            f'lab: R(i => AD.adLabel("{t}", i), AD.adN("{t}"))}}'
            for t in tags) + '},'
        'metric: R(c => R(i => AD.adV(i, c), AD.adMetricN()), 9),'
        # adPlanted is the metric's ground truth and scene 2 colours the
        # missed readings with it, so it belongs in the digest: a regression
        # there is scene-visible but moves nothing the parity checks compare.
        'planted: R(c => R(i => AD.adPlanted(i, c), AD.adMetricN()), 9),'
        'sig: R(i => AD.adSig(i), AD.adSigN()),'
        'sigLab: R(i => AD.adSigLabel(i), AD.adSigN()),'
        'score: R(i => AD.adScore(i), AD.adEvalN()),'
        'evalLab: R(i => AD.adEvalLabel(i), AD.adEvalN())'
        '}'
    )
    _check_corpus(raw)

    ds = {t: {'pts': np.column_stack([raw['ds'][t]['x'], raw['ds'][t]['y']]),
              'lab': np.asarray(raw['ds'][t]['lab'], dtype=int)} for t in tags}
    metric = np.asarray(raw['metric'], dtype=float)      # [contam][i]
    sig = np.asarray(raw['sig'], dtype=float)
    sig_lab = np.asarray(raw['sigLab'], dtype=int)
    score = np.asarray(raw['score'], dtype=float)
    ev_lab = np.asarray(raw['evalLab'], dtype=int)

    # ---- robust statistics on the 1-D metric ------------------------------
    print('\nparity — robust statistics (scene 2)')
    cs = list(range(9))
    check('mean', run(f'R(c => AD.adMeanV(c), 9)'), [metric[c].mean() for c in cs], 1e-12)
    check('std (n-1)', run(f'R(c => AD.adStdV(c), 9)'), [metric[c].std(ddof=1) for c in cs], 1e-12)
    check('median', run(f'R(c => AD.adMedV(c), 9)'), [np.median(metric[c]) for c in cs], 1e-12)
    check('MAD', run(f'R(c => AD.adMadV(c), 9)'),
          [np.median(np.abs(metric[c] - np.median(metric[c]))) for c in cs], 1e-12)
    check('Q1', run(f'R(c => AD.adQ1(c), 9)'), [np.quantile(metric[c], 0.25) for c in cs], 1e-12)
    check('Q3', run(f'R(c => AD.adQ3(c), 9)'), [np.quantile(metric[c], 0.75) for c in cs], 1e-12)
    check('1.4826 constant', run('[AD.adSigmaHat(0) / AD.adMadV(0)]'), [MAD_K], 1e-12)
    check('z-scores at contam 4', run('R(i => AD.adZv(i, 4), 60)'),
          (metric[4] - metric[4].mean()) / metric[4].std(ddof=1), 1e-12)
    m4 = np.median(metric[4])
    check('modified z at contam 4', run('R(i => AD.adModZv(i, 4), 60)'),
          (metric[4] - m4) / (MAD_K * np.median(np.abs(metric[4] - m4))), 1e-12)
    check('z-rule counts', run('R(c => AD.adCountZ(3, c), 9)'),
          [int((np.abs(metric[c] - metric[c].mean()) > 3 * metric[c].std(ddof=1)).sum()) for c in cs])
    check('MAD-rule counts', run('R(c => AD.adCountM(3, c), 9)'),
          [int((np.abs(metric[c] - np.median(metric[c]))
                > 3 * MAD_K * np.median(np.abs(metric[c] - np.median(metric[c])))).sum()) for c in cs])
    check('Tukey counts', run('R(c => AD.adCountT(1.5, c), 9)'),
          [int(((metric[c] > np.quantile(metric[c], .75) + 1.5 * (np.quantile(metric[c], .75) - np.quantile(metric[c], .25)))
                | (metric[c] < np.quantile(metric[c], .25) - 1.5 * (np.quantile(metric[c], .75) - np.quantile(metric[c], .25)))).sum())
           for c in cs])
    check('Grubbs G', run('R(c => AD.adGrubbs(c), 9)'),
          [np.abs(metric[c] - metric[c].mean()).max() / metric[c].std(ddof=1) for c in cs], 1e-12)

    # ---- distance and density ---------------------------------------------
    print('\nparity — distance and density (scene 3)')
    for tag in ('dense', 'blob'):
        pts = ds[tag]['pts']
        n = len(pts)
        for k in (5, 20, 40):
            check(f'kNN dist  {tag} k={k}', run(f'R(i => AD.adKnn("{tag}", i, {k}), {n})'),
                  ref_knn(pts, k), 1e-10)
        for k in (10, 20):
            check(f'LOF       {tag} k={k}', run(f'R(i => AD.adLof("{tag}", i, {k}), {n})'),
                  ref_lof(pts, k), 1e-9)
    for tag in ('ellip', 'blob'):
        pts = ds[tag]['pts']
        n = len(pts)
        mu, c = ref_cov(pts)
        check(f'Mahalanobis {tag}', run(f'R(i => AD.adMahal("{tag}", i), {n})'), ref_mahal(pts), 1e-10)
        check(f'Euclidean   {tag}', run(f'R(i => AD.adEuclid("{tag}", i), {n})'),
              np.linalg.norm(pts - mu, axis=1), 1e-12)
        vals, vecs = np.linalg.eigh(c)
        check(f'ellipse semi-axes {tag}',
              sorted(run(f'[AD.adCovEig("{tag}", 1, 1), AD.adCovEig("{tag}", 2, 1)]')),
              sorted(np.sqrt(vals)), 1e-10)
        check(f'ellipse mean {tag}', run(f'[AD.adCovEig("{tag}", 3, 1), AD.adCovEig("{tag}", 4, 1)]'),
              mu, 1e-12)
        # The drawn ellipse must be the level set it claims: every point on
        # the s-sigma ellipse has Mahalanobis distance exactly s.
        inv = np.linalg.inv(c)
        ring = np.asarray(run(
            f'R(j => [AD.adEllipse("{tag}", j * 6.283185307179586 / 24, 2, 0),'
            f'        AD.adEllipse("{tag}", j * 6.283185307179586 / 24, 2, 1)], 24)'))
        dev = ring - mu
        check(f'2-sigma ellipse is Mahalanobis 2 ({tag})',
              np.sqrt(np.einsum('ij,jk,ik->i', dev, inv, dev)), np.full(24, 2.0), 1e-9)

    # ---- isolation ---------------------------------------------------------
    print('\nparity + invariants — isolation (scene 4)')
    check('c(n) formula', run('[AD.adCPath(2), AD.adCPath(10), AD.adCPath(128), AD.adCPath(256)]'),
          [ref_c(2), ref_c(10), ref_c(128), ref_c(256)], 1e-12)
    iso = np.asarray(run('R(i => AD.adIso("blob", i), AD.adN("blob"))'))
    lab = ds['blob']['lab']
    assert_true('isolation scores lie in (0, 1)', bool(np.all((iso > 0) & (iso < 1))),
                f'range {iso.min():.3f}..{iso.max():.3f}')
    assert_true('planted points score above the bulk',
                iso[lab == 1].min() > np.quantile(iso[lab == 0], 0.95),
                f'planted min {iso[lab == 1].min():.3f} vs inlier p95 {np.quantile(iso[lab == 0], 0.95):.3f}')
    assert_true('isolation is deterministic across calls',
                run('[AD.adIso("blob", 0) === AD.adIso("blob", 0), '
                    'AD.adIsoGrid("blob", 1.5, -0.5) === AD.adIsoGrid("blob", 1.5, -0.5)]') == [True, True])
    # The score IS 2^(-E[h]/c(psi)) -- check the two functions agree.
    pair = run('R(j => [AD.adIsoDepth("blob", j - 3, 0.5), AD.adIsoGrid("blob", j - 3, 0.5)], 7)')
    depth = np.asarray([p[0] for p in pair])
    gscore = np.asarray([p[1] for p in pair])
    check('score = 2^(-E[h]/c(128))', gscore, np.power(2.0, -depth / ref_c(128)), 1e-12)

    # ---- the one-class boundary -------------------------------------------
    print('\nparity + invariants — the one-class boundary (scene 4)')
    pts = ds['ring']['pts']
    grid = [(0.0, 0.0), (2.4, 0.0), (1.0, 1.0), (-3.0, 2.0)]
    for gamma in (0.25, 0.5, 1.5):
        want = [float(np.exp(-gamma * ((pts - np.array(p)) ** 2).sum(axis=1)).mean()) for p in grid]
        got = run('[' + ','.join(f'AD.adKde("ring", {p[0]}, {p[1]}, {gamma})' for p in grid) + ']')
        check(f'kernel density gamma={gamma}', got, want, 1e-12)
    for nu in (0.05, 0.1, 0.25):
        own = np.asarray([float(np.exp(-0.5 * ((pts - p) ** 2).sum(axis=1)).mean()) for p in pts])
        check(f'nu-quantile nu={nu}', run(f'[AD.adKdeQ("ring", {nu}, 0.5)]'),
              [np.quantile(own, nu)], 1e-12)
        # nu is an OPERATIONAL ANALOGUE of a nu-SVM's nu, not the same
        # guarantee. The threshold is an interpolated empirical quantile and
        # membership keeps ties (>=), so the realised rejection is only
        # APPROXIMATELY nu -- which is why the tolerance below is a point and
        # a half of the sample rather than zero, and why the label says ~nu.
        # A nu-SVM's nu bounds the training-error fraction above and the
        # support-vector fraction below; this bounds neither.
        rejected = float((own < np.quantile(own, nu)).mean())
        assert_true(f'nu={nu} rejects ~nu of the training set ({rejected:.3f})',
                    abs(rejected - nu) <= 1.5 / len(pts) + 1e-9)
    # The traced boundary must sit exactly on the level set.
    thr = run('[AD.adKdeQ("ring", 0.1, 0.5)]')[0]
    walls = np.asarray(run(
        'R(j => [AD.adKdeB("ring", j * 6.283185307179586 / 16, 0.1, 0.5, 0, 0),'
        '        AD.adKdeB("ring", j * 6.283185307179586 / 16, 0.1, 0.5, 1, 0),'
        '        AD.adKdeB("ring", j * 6.283185307179586 / 16, 0.1, 0.5, 0, 1),'
        '        AD.adKdeB("ring", j * 6.283185307179586 / 16, 0.1, 0.5, 1, 1)], 16)'))
    for name, cols in (('outer', (0, 1)), ('inner', (2, 3))):
        pt = walls[:, cols]
        dens = np.asarray([float(np.exp(-0.5 * ((pts - p) ** 2).sum(axis=1)).mean()) for p in pt])
        check(f'{name} wall lies on the nu=0.1 level set', dens, np.full(len(dens), thr), 1e-6)
    assert_true('a simply connected cloud has no inner wall',
                run('[AD.adKdeRin("blob", 0, 0.1, 0.5, 8), AD.adKdeRin("blob", 2, 0.1, 0.5, 8)]') == [0, 0])

    # ---- reconstruction ----------------------------------------------------
    print('\nparity — reconstruction (scene 5)')
    for r in (1, 3, 8, 24):
        check(f'rank-{r} reconstruction', run(f'R(i => AD.adRecon(i, {r}), 128)'),
              ref_recon(sig, r), 1e-10)
        check(f'rank-{r} residual', run(f'R(i => AD.adResid(i, {r}), 128)'),
              np.abs(sig - ref_recon(sig, r)), 1e-10)
        check(f'rank-{r} RMSE', run(f'[AD.adReconRmse({r})]'),
              [np.sqrt(((sig - ref_recon(sig, r)) ** 2).mean())], 1e-10)
        m = sig_lab == 1
        check(f'rank-{r} RMSE on the planted window', run(f'[AD.adReconRmseAnom({r})]'),
              [np.sqrt(((sig[m] - ref_recon(sig, r)[m]) ** 2).mean())], 1e-10)
    assert_true('the planted window stays inside the global range',
                sig[sig_lab == 1].min() > sig.min() and sig[sig_lab == 1].max() < sig.max(),
                f'window {sig[sig_lab == 1].min():.2f}..{sig[sig_lab == 1].max():.2f} '
                f'vs global {sig.min():.2f}..{sig.max():.2f}')
    # No per-sample z-score can see a collective anomaly. That is why scene 5
    # exists, so the claim is a test, not a sentence.
    z = np.abs((sig - sig.mean()) / sig.std(ddof=1))
    assert_true('no 3-sigma z-score flags the collective anomaly', bool(z[sig_lab == 1].max() < 3),
                f'largest |z| inside the window is {z[sig_lab == 1].max():.2f}')
    pts = ds['ellip']['pts']
    mu, c = ref_cov(pts)
    vals, vecs = np.linalg.eigh(c)
    minor = vecs[:, 0]                       # the axis PCA discards at rank 1
    check('rank-1 PCA reconstruction error',
          run(f'R(i => AD.adPcaErr("ellip", i), {len(pts)})'),
          np.abs((pts - mu) @ minor), 1e-10)

    # ---- evaluation --------------------------------------------------------
    print('\nparity — evaluation (scene 6)')
    ths = [0.0, 0.2, 0.35, 0.5, 0.62, 0.8, 1.0]
    P, N = int(ev_lab.sum()), int((1 - ev_lab).sum())
    for cell, name in enumerate(('TP', 'FP', 'FN', 'TN')):
        want = []
        for t in ths:
            flag = score >= t
            tp = int((flag & (ev_lab == 1)).sum())
            fp = int((flag & (ev_lab == 0)).sum())
            want.append([tp, fp, P - tp, N - fp][cell])
        check(f'confusion {name}', run('[' + ','.join(f'AD.adConf({t}, {cell})' for t in ths) + ']'), want)
    want_prec, want_rec, want_fpr, want_acc = [], [], [], []
    for t in ths:
        flag = score >= t
        tp = int((flag & (ev_lab == 1)).sum())
        fp = int((flag & (ev_lab == 0)).sum())
        want_prec.append(tp / (tp + fp) if tp + fp else 1.0)
        want_rec.append(tp / P)
        want_fpr.append(fp / N)
        want_acc.append((tp + (N - fp)) / len(score))
    check('precision', run('[' + ','.join(f'AD.adPrec({t})' for t in ths) + ']'), want_prec, 1e-12)
    check('recall',    run('[' + ','.join(f'AD.adRec({t})' for t in ths) + ']'), want_rec, 1e-12)
    check('FPR',       run('[' + ','.join(f'AD.adFpr({t})' for t in ths) + ']'), want_fpr, 1e-12)
    check('accuracy',  run('[' + ','.join(f'AD.adAcc({t})' for t in ths) + ']'), want_acc, 1e-12)
    check('precision@k', run('[' + ','.join(f'AD.adPrecAtK({k})' for k in (8, 32, 64)) + ']'),
          [ev_lab[:k].mean() for k in (8, 32, 64)], 1e-12)

    # AUC-ROC by the Mann-Whitney identity: the probability a random positive
    # outranks a random negative. A different route to the same number, so an
    # error in the trapezoid sweep cannot hide.
    pos, neg = score[ev_lab == 1], score[ev_lab == 0]
    wins = (pos[:, None] > neg[None, :]).sum() + 0.5 * (pos[:, None] == neg[None, :]).sum()
    check('AUC-ROC (vs Mann-Whitney U)', run('[AD.adAucRoc()]'), [wins / (len(pos) * len(neg))], 1e-9)
    tp_cum = np.cumsum(ev_lab)
    rec = tp_cum / P
    prec = tp_cum / np.arange(1, len(score) + 1)
    ap = float((np.diff(np.concatenate([[0.0], rec])) * prec).sum())
    check('average precision', run('[AD.adAucPr()]'), [ap], 1e-12)

    # The identity, against its own algebra.
    cases = [(0.8, 0.05, 0.08), (0.8, 0.05, 0.001), (0.95, 0.01, 0.5), (0.5, 0.5, 0.3)]
    check('precision = TPR pi / (TPR pi + FPR (1-pi))',
          run('[' + ','.join(f'AD.adPrecBayes({a},{b},{c})' for a, b, c in cases) + ']'),
          [a * c / (a * c + b * (1 - c)) for a, b, c in cases], 1e-12)
    # And against the dataset it describes: at any threshold, the identity
    # evaluated at that threshold's TPR/FPR and the true base rate must
    # reproduce the measured precision exactly.
    pi = P / len(score)
    check('the identity reproduces the measured precision',
          run('[' + ','.join(
              f'AD.adPrecBayes(AD.adTpr({t}), AD.adFpr({t}), {pi})' for t in ths[:-1]) + ']'),
          want_prec[:-1], 1e-12)

    # ---- the figures the lesson quotes on screen --------------------------
    print('\npinned — figures quoted in scenes/anomaly-detection.json')
    planted = [7, 23, 41, 12, 55, 30, 48, 3]
    v8 = metric[8]
    caught_z = sum(1 for s in planted if abs(v8[s] - v8.mean()) > 3 * v8.std(ddof=1))
    m8 = np.median(v8)
    caught_m = sum(1 for s in planted
                   if abs(v8[s] - m8) > 3 * MAD_K * np.median(np.abs(v8 - m8)))
    assert_true('masking: the z-rule catches 2 of 8, the MAD rule all 8',
                (caught_z, caught_m) == (2, 8), f'got {caught_z} and {caught_m}')
    lof20 = ref_lof(ds['dense']['pts'], 20)
    strays = ds['dense']['lab'] == 1
    assert_true('a LOF threshold of 2 catches every stray and nothing else',
                bool(np.all(lof20[strays] > 2) and np.all(lof20[~strays] < 2)),
                f'strays {np.round(lof20[strays], 2)}, worst cluster point {lof20[~strays].max():.2f}')
    knn20 = ref_knn(ds['dense']['pts'], 20)
    assert_true('no global kNN threshold does the same',
                bool(knn20[strays].min() < np.median(knn20[(~strays) & (np.arange(len(knn20)) >= 90)])),
                'the quietest stray must sit below the loose cluster median')
    mah = ref_mahal(ds['ellip']['pts'])
    euc = np.linalg.norm(ds['ellip']['pts'] - ds['ellip']['pts'].mean(axis=0), axis=1)
    a, b = len(mah) - 2, len(mah) - 1        # along the ridge, across the ridge
    assert_true('Mahalanobis reverses Euclidean order on the correlated cloud',
                euc[a] > euc[b] and mah[a] < mah[b],
                f'euclid {euc[a]:.2f} vs {euc[b]:.2f}, mahal {mah[a]:.2f} vs {mah[b]:.2f}')
    ratio = [run(f'[AD.adReconRmseAnom({r}) / AD.adReconRmse({r})]')[0] for r in (1, 3, 10)]
    assert_true('capacity: the detector is inverted at r=1, best at r=3, dead by r=10',
                ratio[0] < 1 and ratio[1] > 1.8 and ratio[2] < 1.1,
                f'ratios {[round(x, 2) for x in ratio]}')
    # The inductive-bias claim in scene 4's markdown and its `kernel-prior`
    # overlay: the RBF's bias is correct by construction on the radial data and
    # cannot be made correct on the two-density one, at ANY bandwidth. Swept
    # rather than asserted, because "no gamma does better" is the whole point.
    # A SAMPLED claim, so sample properly: 61 log-spaced gammas over four
    # orders of magnitude, pulled in one node call per tag and ranked here.
    # Eight hand-picked values could not support "no gamma does better", and
    # the scene says that -- so the sweep is wide enough for the sentence, and
    # the sentence says "swept", not "no gamma anywhere".
    GAMMAS = [float(g) for g in np.logspace(-2, 2, 61)]
    best = {}
    for tag in ('ring', 'dense'):
        n = run(f'[AD.adN("{tag}")]')[0]
        lab = np.asarray(run(f'R(i => AD.adLabel("{tag}", i), {n})'), dtype=int)
        k = int(lab.sum())
        glist = '[' + ','.join(repr(g) for g in GAMMAS) + ']'
        dens = np.asarray(run(
            f'{glist}.map(g => R(i => AD.adKde("{tag}", AD.adX("{tag}", i), '
            f'AD.adY("{tag}", i), g), {n}))'))
        # lowest density = most anomalous; precision@k, per gamma
        hits = [int(lab[np.argsort(row)[:k]].sum()) for row in dens]
        best[tag] = (max(hits), k)
    assert_true(f'RBF prior fits the ring by construction ({best["ring"][0]} of {best["ring"][1]}, '
                f'{len(GAMMAS)} gammas swept)',
                best['ring'] == (8, 8), f'got {best["ring"]}')
    assert_true(f'no SWEPT gamma rescues it on dense ({best["dense"][0]} of {best["dense"][1]}, '
                f'{len(GAMMAS)} gammas over 1e-2..1e2)',
                best['dense'] == (2, 3), f'got {best["dense"]}')

    # Scene 4's 'scales' strip plot and its overlay quote these spans. They are
    # the whole argument for rank/standardise-before-averaging, so they are
    # measured here rather than trusted.
    spans = {}
    for name, expr in (('isolation', 'AD.adIso("dense", i)'),
                       ('LOF', 'AD.adLof("dense", i, 20)'),
                       ('kNN', 'AD.adKnn("dense", i, 20)'),
                       ('density', 'AD.adKdeScore("dense", i, 0.5)'),
                       ('mahal', 'AD.adMahal("dense", i)')):
        v = np.asarray(run(f'R(i => {expr}, AD.adN("dense"))'))
        spans[name] = float(v.max() - v.min())
    ratio = max(spans.values()) / min(spans.values())
    check('LOF raw span (quoted as 4.26)', spans['LOF'], 4.26, 5e-3)
    check('isolation raw span (quoted as 0.36)', spans['isolation'], 0.36, 5e-3)
    assert_true(f'widest / narrowest raw span is 11.7x (got {ratio:.2f})',
                abs(ratio - 11.7) < 0.05, f'spans {[(k, round(v, 3)) for k, v in spans.items()]}')

    # Scene 5's matrix and its three readings. adDetAuc is computed live from
    # the detectors, so the NUMBERS cannot drift -- but the CLAIMS made about
    # their pattern can, and those are what the overlays assert.
    auc = [[run(f'[AD.adDetAuc({c}, {r})]')[0] for c in range(3)] for r in range(5)]
    wins = [max(range(5), key=lambda r: auc[r][c]) for c in range(3)]
    assert_true('no detector wins all three datasets (the no-free-lunch claim)',
                len(set(wins)) > 1, f'per-dataset winners {wins}')
    check('Mahalanobis on ring is exactly chance', auc[4][2], 0.5, 1e-12)
    assert_true('LOF is last on blob while winning dense and ring',
                auc[1][0] == min(auc[r][0] for r in range(5))
                and auc[1][1] == max(auc[r][1] for r in range(5))
                and auc[1][2] == max(auc[r][2] for r in range(5)),
                f'blob col {[round(auc[r][0], 3) for r in range(5)]}')

    # adConc drives scene 3's concentration plot and docs.json lists its values
    # under verified_values -- but nothing verified them. This regenerates the
    # seeded clouds from a PORT of the module's splitmix32 and FNV-1a rather
    # than pulling them, so it checks the generator and the arithmetic at once.
    print('\nparity - distance concentration (scene 3)')
    for d in (2, 3, 5, 10, 20, 40, 64):
        want = ref_conc(d)
        got = run(f'[AD.adConc({d}, 0), AD.adConc({d}, 1), AD.adConc({d}, 2)]')
        check(f'relative contrast at d={d}', got[0], want[0], 1e-9)
        check(f'mean nearest / farthest at d={d}', got[1:], list(want[1:]), 1e-9)
    assert_true('contrast falls monotonically with dimension (the curse, measured)',
                all(ref_conc(a)[0] > ref_conc(b)[0]
                    for a, b in ((2, 3), (3, 5), (5, 10), (10, 20), (20, 40), (40, 64))))

    # verified_values.ring_boundary claims all eight planted points fall
    # OUTSIDE the level set. Nothing tested that: the wall checks sample
    # densities along rays, which a regression in adKdeIn would not touch.
    inside = run('R(i => AD.adKdeIn("ring", 200 + i, 0.1, 0.5), 8)')
    assert_true('all 8 planted ring points fall outside the nu=0.1 boundary',
                sum(inside) == 0, f'adKdeIn said inside for {sum(inside)} of them')
    # and the converse, or "outside" would be trivially satisfiable
    ring_in = run('R(i => AD.adKdeIn("ring", i, 0.1, 0.5), 200)')
    assert_true(f'most ring points fall inside it ({sum(ring_in)} of 200)',
                sum(ring_in) >= 170, f'only {sum(ring_in)} of 200 inside')

    assert_true('always predicting "normal" beats the threshold on accuracy alone',
                (1 - pi) > 0.9, f'the majority-class accuracy is {1 - pi:.3f}')

    print()
    if _failures:
        print(f'{len(_failures)} check(s) FAILED:')
        for f in _failures:
            print(f'  - {f}')
        return 1
    print('all anomaly domain checks passed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
