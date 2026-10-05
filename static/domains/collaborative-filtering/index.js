/**
 * AlgeBench Domain Library — Collaborative Filtering
 *
 * Everything scenes/collaborative-filtering.json computes, live, from one
 * small ratings table: six users, six movies, ratings 1-5.
 *
 * THE TOY. Ratings are built EXACTLY as R = P* Q*^T from designed taste
 * vectors on three named axes (Action, Romance, Sci-fi), so the table has
 * rank 3 and every entry is an integer 1-5. Six entries -- one per row and
 * one per column -- are hidden from training and used as the test set:
 * 30 observed ratings against the 27 degrees of freedom of a rank-3 6x6
 * matrix, which is just enough for the hidden entries to be recoverable.
 * The designed vectors are AUTHORED, not learned; the learned ones (ALS,
 * SGD below) are genuinely fitted, and the lesson shows how they differ.
 *
 * THE DATA. The lesson normally supplies the toy as `data` tables (see
 * docs.json "dataContracts": ratings, observed, tastes, movies, watches),
 * read through _init's getData; the constants below are only the fallback
 * for a scene without them, and the checker asserts the two agree.
 *
 * Every computation reads the current tables through sliders, so editing a
 * rating (tensor slider cf_R) or hiding a different cell (cf_obs) retrains
 * everything downstream on the next frame:
 *   - neighbourhood CF: Pearson similarity over co-rated items, kNN predict
 *   - latent factors: ALS and SGD from a seeded uniform(0,1) initialisation,
 *     every epoch kept so an epoch slider scrubs the training run
 *   - zero-fill: rank-k fit of the table with blanks set to 0. Computed as
 *     ALS on the FULL matrix with lambda ~ 0, which converges to the
 *     truncated SVD (Eckart-Young), so no SVD routine is needed
 *   - capacity sweep over k and lambda
 *   - the invariance P Q^T = (P A)(Q A^-T)^T under an invertible map A
 *   - biases mu + b_u + b_i
 *   - fold-in of a new user against the designed movie vectors
 *   - implicit feedback (Hu, Koren & Volinsky 2008): preference/confidence,
 *     weighted ALS over ALL cells
 *
 * Indices are 0-based: user u, movie i, factor f, epoch e. Out-of-range
 * indices clamp. Heavy results are memoised by exactly the inputs they read,
 * so a rotation slider never retrains the model.
 *
 * scripts/check_collaborative_filtering_domain.py re-implements every
 * algorithm in NumPy (including the mulberry32 initialisation) and compares.
 *
 * Slider values are injected via _init({ getSlider }) called by expr.js on import.
 */
(function () {

    let _getSlider = (id, fallback = 0) => fallback; // replaced by _init
    let _getData = () => undefined;                   // replaced by _init (data tables)

    // ---- the toy -----------------------------------------------------------

    const NU = 6, NI = 6;
    const USERS = ['Ava', 'Ben', 'Cleo', 'Dan', 'Eli', 'Fay'];
    const MOVIES = ['Die Hard', 'Notebook', 'Arrival', 'Mr&Mrs Smith', 'Matrix', 'Her'];
    const GENRES = ['Action', 'Romance', 'Sci-fi'];

    // Designed taste vectors (rows = users) and movie vectors (rows = movies).
    const PSTAR = [
        [2, 0.5, 0.5],    // Ava   action fan
        [0.5, 2, 0.5],    // Ben   romance fan
        [0.5, 0.5, 2],    // Cleo  sci-fi fan
        [1.5, 1, 0.5],    // Dan   action + romance
        [1, 1, 1],        // Eli   all-rounder
        [1, 0.5, 1.5],    // Fay   sci-fi + action
    ];
    const QSTAR = [
        [2, 0, 0],        // Die Hard       pure action
        [0, 2, 0],        // Notebook       pure romance
        [0, 0, 2],        // Arrival        pure sci-fi
        [2, 2, 0],        // Mr&Mrs Smith   action + romance
        [2, 0, 2],        // Matrix         action + sci-fi
        [0, 2, 2],        // Her            romance + sci-fi
    ];
    const R_DEFAULT = PSTAR.map(p => QSTAR.map(q => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
    // Hidden (test) cells: one per row and one per column.
    const HIDDEN = [[0, 1], [1, 5], [2, 4], [3, 0], [4, 2], [5, 3]];
    const OBS_DEFAULT = R_DEFAULT.map((row, u) => row.map((_, i) =>
        HIDDEN.some(([hu, hi]) => hu === u && hi === i) ? 0 : 1));

    // Implicit feedback: how many times each user watched each movie. Derived
    // from the same tastes (a 5 was watched ~6 times, a 4 twice, the rest not
    // at all) plus one deliberate trap: Ava watched "Her" ONCE and rated it 2.
    // Watching is not liking, and the confidence model cannot tell.
    const C_DEFAULT = R_DEFAULT.map(row => row.map(r => (r === 5 ? 6 : (r === 4 ? 2 : 0))));
    C_DEFAULT[0][5] = 1;

    const MAX_EPOCH = 300;     // stored epochs for ALS and SGD
    const SWEEP_EPOCHS = 200;  // ALS epochs per cell of the capacity sweep
    const ZERO_EPOCHS = 200;   // ALS epochs for the zero-fill fit
    const ZERO_LAMBDA = 1e-9;  // "no regularisation" that keeps solves defined
    const FOLD_LAMBDA = 0.1;   // ridge for folding in a new user
    const IMP_LAMBDA = 0.1;    // ridge for implicit ALS
    const IMP_ITERS = 30;
    const POS_ITERS = 50;      // "fit the positives only" control
    const K_MAX = 5;

    // ---- small numerics ----------------------------------------------------

    /** mulberry32: a tiny seeded PRNG, re-implemented bit-for-bit in the checker. */
    function _mulberry32(seed) {
        let a = seed | 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /** Solve A x = b (A n x n, nested) by Gaussian elimination with partial
     *  pivoting. A singular system gets a 1e-9 ridge and is retried once. */
    function _solve(A, b) {
        const n = b.length;
        for (let attempt = 0; attempt < 2; attempt++) {
            const M = A.map((row, r) => row.slice().concat([b[r]]));
            if (attempt === 1) for (let r = 0; r < n; r++) M[r][r] += 1e-9;
            let ok = true;
            for (let c = 0; c < n && ok; c++) {
                let piv = c;
                for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
                if (Math.abs(M[piv][c]) < 1e-14) { ok = false; break; }
                if (piv !== c) { const tmp = M[c]; M[c] = M[piv]; M[piv] = tmp; }
                for (let r = c + 1; r < n; r++) {
                    const f = M[r][c] / M[c][c];
                    if (f !== 0) for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
                }
            }
            if (!ok) continue;
            const x = new Array(n).fill(0);
            for (let r = n - 1; r >= 0; r--) {
                let acc = M[r][n];
                for (let j = r + 1; j < n; j++) acc -= M[r][j] * x[j];
                x[r] = acc / M[r][r];
            }
            return x;
        }
        return new Array(n).fill(0);
    }

    const _dot = (a, b) => { let s = 0; for (let f = 0; f < a.length; f++) s += a[f] * b[f]; return s; };
    const _copy2 = M => M.map(r => r.slice());

    /** Ridge solve for one row: x = (sum_j w_j y_j y_j^T + lam I)^-1 sum_j w_j t_j y_j
     *  over the rows j where w_j > 0. ys: rows of the other factor. */
    function _ridgeRow(ys, targets, weights, lam, k) {
        const A = [], b = new Array(k).fill(0);
        for (let a = 0; a < k; a++) A.push(new Array(k).fill(0));
        let any = false;
        for (let j = 0; j < ys.length; j++) {
            const w = weights[j];
            if (!(w > 0)) continue;
            any = true;
            const y = ys[j];
            for (let a = 0; a < k; a++) {
                b[a] += w * targets[j] * y[a];
                for (let c = 0; c < k; c++) A[a][c] += w * y[a] * y[c];
            }
        }
        if (!any) return new Array(k).fill(0);
        for (let a = 0; a < k; a++) A[a][a] += lam;
        return _solve(A, b);
    }

    function _init(k, seed) {
        const rng = _mulberry32(seed);
        const P = [], Q = [];
        for (let u = 0; u < NU; u++) { const r = []; for (let f = 0; f < k; f++) r.push(rng()); P.push(r); }
        for (let i = 0; i < NI; i++) { const r = []; for (let f = 0; f < k; f++) r.push(rng()); Q.push(r); }
        return { P, Q };
    }

    /** ALS on the cells where W > 0 (W doubles as the per-cell weight), every
     *  epoch stored. Epoch 0 is the initialisation; one epoch = all users,
     *  then all items. */
    function _als(R, W, k, lam, epochs, seed) {
        let { P, Q } = _init(k, seed);
        const hist = [{ P: _copy2(P), Q: _copy2(Q) }];
        for (let e = 0; e < epochs; e++) {
            P = P.map((_, u) => _ridgeRow(Q, R[u], W[u], lam, k));
            Q = Q.map((_, i) => _ridgeRow(P, R.map(row => row[i]), W.map(row => row[i]), lam, k));
            hist.push({ P: _copy2(P), Q: _copy2(Q) });
        }
        return hist;
    }

    /** SGD (Funk 2006 / Koren et al. 2009), visiting observed cells in
     *  row-major order; both updates use the pre-step values. */
    function _sgd(R, obs, k, lam, gamma, epochs, seed) {
        const { P, Q } = _init(k, seed);
        const hist = [{ P: _copy2(P), Q: _copy2(Q) }];
        const cells = [];
        for (let u = 0; u < NU; u++) for (let i = 0; i < NI; i++) if (obs[u][i]) cells.push([u, i]);
        for (let e = 0; e < epochs; e++) {
            for (const [u, i] of cells) {
                const pu = P[u], qi = Q[i];
                const err = R[u][i] - _dot(pu, qi);
                const pOld = pu.slice();
                for (let f = 0; f < k; f++) {
                    pu[f] += gamma * (err * qi[f] - lam * pu[f]);
                    qi[f] += gamma * (err * pOld[f] - lam * qi[f]);
                }
            }
            hist.push({ P: _copy2(P), Q: _copy2(Q) });
        }
        return hist;
    }

    /** RMSE of P Q^T against R over the cells where sel(u,i) is true. A
     *  non-finite fit (SGD diverged) reports NaN rather than a huge number. */
    function _rmse(P, Q, R, sel) {
        let acc = 0, n = 0;
        for (let u = 0; u < NU; u++) for (let i = 0; i < NI; i++) {
            if (!sel(u, i)) continue;
            const d = R[u][i] - _dot(P[u], Q[i]);
            acc += d * d; n++;
        }
        if (!n) return 0;
        const v = Math.sqrt(acc / n);
        return Number.isFinite(v) ? v : NaN;
    }

    /** The regularised objective of Koren et al. (Eq. 2, per-vector form, no biases). */
    function _loss(P, Q, R, obs, lam) {
        let acc = 0;
        for (let u = 0; u < NU; u++) for (let i = 0; i < NI; i++) {
            if (!obs[u][i]) continue;
            const d = R[u][i] - _dot(P[u], Q[i]);
            acc += d * d;
        }
        for (const p of P) acc += lam * _dot(p, p);
        for (const q of Q) acc += lam * _dot(q, q);
        return acc;
    }

    // ---- reading sliders, and remembering what was read --------------------
    //
    // Same scheme as the transformer domain: the state is rebuilt only when a
    // slider it READ has changed, and a tensor slider is compared cell by cell
    // without allocating. Rebuilding is cheap (it only reads); the expensive
    // runs live in _memo, keyed by the inputs each one depends on.

    const ABSENT = Symbol('absent');
    let _reads = new Map();
    let _dataReads = new Map();   // table name -> the array seen (compared by identity)
    let _cache = null;

    function _snapshot(raw) {
        if (raw === ABSENT) return ABSENT;
        if (Array.isArray(raw)) return Float64Array.from(raw.flat(Infinity).map(Number));
        return Number(raw);
    }
    function _same(snap, raw) {
        if (snap === ABSENT || raw === ABSENT) return snap === raw;
        const eq = (x, y) => x === y || (x !== x && y !== y);
        if (snap instanceof Float64Array) {
            if (!Array.isArray(raw)) return false;
            let k = 0;
            for (const row of raw) {
                if (Array.isArray(row)) {
                    for (const x of row) { if (k >= snap.length || !eq(Number(x), snap[k++])) return false; }
                } else if (k >= snap.length || !eq(Number(row), snap[k++])) return false;
            }
            return k === snap.length;
        }
        return eq(Number(raw), snap);
    }
    function _readRaw(id) {
        const raw = _getSlider(id, ABSENT);
        _reads.set(id, { raw, snap: _snapshot(raw) });
        return raw;
    }
    function _read(id, fb) {
        const raw = _readRaw(id);
        if (raw === ABSENT || Array.isArray(raw)) return fb;
        const v = Number(raw);
        return Number.isFinite(v) ? v : fb;
    }
    function _intRead(id, fb, lo, hi) {
        const v = Math.round(_read(id, fb));
        return v < lo ? lo : (v > hi ? hi : v);
    }
    /** `base` with each cell replaced by tensor slider `id` where it has a
     *  finite number. A [1, n] slider may arrive as a flat array. */
    function _table(id, base) {
        const o = _readRaw(id);
        if (!Array.isArray(o)) return base;
        const rows = base.length, cols = base[0].length;
        const nested = rows === 1 && !Array.isArray(o[0]) ? [o] : o;
        const out = [];
        for (let r = 0; r < rows; r++) {
            const row = [];
            for (let c = 0; c < cols; c++) {
                const x = Array.isArray(nested[r]) ? Number(nested[r][c]) : NaN;
                row.push(Number.isFinite(x) ? x : base[r][c]);
            }
            out.push(row);
        }
        return out;
    }

    function _stale() {
        if (!_cache) return true;
        for (const [id, rec] of _reads) {
            const live = _getSlider(id, ABSENT);
            // Fast path: the app replaces a tensor slider's table on every edit
            // (sliders.ts setTensorSliderCell), so the same array object means
            // the same values. This check runs on every call -- per cell, per
            // frame -- and the cell-by-cell compare was most of its cost.
            if (live === rec.raw && live !== null && typeof live === 'object') continue;
            if (!_same(rec.snap, live)) return true;
        }
        for (const [name, seen] of _dataReads) if (_getData(name) !== seen) return true;
        return false;
    }

    /** A data table as row objects, or null; recorded for _stale(). */
    function _dataRows(name) {
        const t = _getData(name);
        _dataReads.set(name, t);
        return Array.isArray(t) && t.length ? t : null;
    }
    /** Column `key` of table `name` as strings (e.g. the movie titles), or `fallback`. */
    function _dataNames(name, key, fallback) {
        const rows = _dataRows(name);
        if (!rows) return fallback;
        return fallback.map((fb, k) => (rows[k] && rows[k][key] != null ? String(rows[k][key]) : fb));
    }
    /** Table `name` as a matrix over `cols`, shaped like `base`; any missing
     *  row or non-numeric cell keeps the built-in value. */
    function _dataMatrix(name, cols, base) {
        const rows = _dataRows(name);
        if (!rows) return base;
        return base.map((row, r) => row.map((fb, c) => {
            const x = rows[r] ? Number(rows[r][cols[c]]) : NaN;
            return Number.isFinite(x) ? x : fb;
        }));
    }

    function _build() {
        // The dataset: data tables when the lesson has them, else built-ins;
        // then any tensor slider of the same table edits on top.
        const movies = _dataNames('movies', 'movie', MOVIES);
        const users = _dataNames('ratings', 'user', USERS);
        let R = _table('cf_R', _dataMatrix('ratings', movies, R_DEFAULT));
        const obsRaw = _table('cf_obs', _dataMatrix('observed', movies, OBS_DEFAULT));
        let obs = obsRaw.map(row => row.map(v => (v >= 0.5 ? 1 : 0)));
        // PLAYGROUND. A tensor slider `cf_play` replaces the ratings outright:
        // a cell >= 1 is a rating (the scale is 1-5, so 0 can never be one)
        // and 0 means "?" -- missing, excluded from every mean, similarity
        // and co-rated count. The prediction target (cf_tu, cf_ti) is held
        // out whether or not it holds a rating, so a known rating can be
        // compared with its prediction.
        let play = null;
        const playRaw = _readRaw('cf_play');
        if (Array.isArray(playRaw)) {
            const P = _table('cf_play', R_DEFAULT.map(r => r.map(() => 0)));
            R = P.map(row => row.map(v => Math.max(0, Math.min(5, Math.round(v)))));
            obs = R.map(row => row.map(v => (v >= 1 ? 1 : 0)));
            const tu = _intRead('cf_tu', 3, 0, NU - 1), ti = _intRead('cf_ti', 0, 0, NI - 1);
            play = { tu, ti, actual: obs[tu][ti] ? R[tu][ti] : null, pv: _intRead('cf_pv', 0, 0, NU - 1) };
            obs[tu][ti] = 0;
        }
        const C = _table('cf_C', _dataMatrix('watches', movies, C_DEFAULT)).map(row => row.map(v => Math.max(0, v)));
        const me = _table('cf_me', [[0, 0, 0, 0, 0, 0]])[0];
        return {
            R, obs, C, me, users, movies, play,
            pstar: _table('cf_pstar', _dataMatrix('tastes', GENRES, PSTAR)),
            qstar: _table('cf_qstar', _dataMatrix('movies', GENRES, QSTAR)),
            k: _intRead('cf_k', 3, 1, K_MAX),
            lam: Math.max(0, _read('cf_lambda', 0.01)),
            epoch: _intRead('cf_epoch', MAX_EPOCH, 0, MAX_EPOCH),
            algo: _intRead('cf_algo', 0, 0, 1),
            gamma: Math.max(0, _read('cf_gamma', 0.05)),
            seed: _intRead('cf_seed', 1, 0, 1e9),
            theta: _read('cf_theta', 0) * Math.PI / 180,
            axis: _intRead('cf_axis', 2, 0, 2),
            stretch: _read('cf_stretch', 1),
            alpha: Math.max(0, _read('cf_alpha', 10)),
            knn: _intRead('cf_knn', 2, 1, NU - 1),
            c: {},
        };
    }

    function _st() {
        if (_stale()) {
            _reads = new Map();
            _dataReads = new Map();
            _cache = _build();
        }
        return _cache;
    }

    // Expensive results, keyed by a string of exactly what they read.
    const _memoMap = new Map();
    function _memo(key, fn) {
        if (_memoMap.has(key)) return _memoMap.get(key);
        if (_memoMap.size > 64) _memoMap.clear();
        const v = fn();
        _memoMap.set(key, v);
        return v;
    }
    const _key = (...parts) => JSON.stringify(parts);
    /** Per-state memo in front of _memo, so the JSON key is built once per
     *  rebuild rather than once per cell per frame. */
    function _cached(st, local, keyFn, fn) {
        if (local in st.c) return st.c[local];
        return (st.c[local] = _memo(keyFn(), fn));
    }

    function _alsRun(st, k, lam) {
        k = k == null ? st.k : k; lam = lam == null ? st.lam : lam;
        return _cached(st, 'als|' + k + '|' + lam + '|' + st.seed, () => _key('als', st.R, st.obs, k, lam, st.seed), () =>
            _als(st.R, st.obs, k, lam, MAX_EPOCH, st.seed));
    }
    function _sgdRun(st) {
        return _cached(st, 'sgd|' + st.k + '|' + st.lam + '|' + st.gamma + '|' + st.seed, () => _key('sgd', st.R, st.obs, st.k, st.lam, st.gamma, st.seed), () =>
            _sgd(st.R, st.obs, st.k, st.lam, st.gamma, MAX_EPOCH, st.seed));
    }
    function _run(st, algo) { return (algo == null ? st.algo : algo) === 1 ? _sgdRun(st) : _alsRun(st); }
    function _snapAt(st, algo, e) {
        const h = _run(st, algo);
        return h[_ci(e == null ? st.epoch : e, h.length - 1)];
    }

    const _ci = (x, hi) => { const v = Math.round(Number(x) || 0); return v < 0 ? 0 : (v > hi ? hi : v); };
    const _u = u => _ci(u, NU - 1);
    const _i = i => _ci(i, NI - 1);
    const _isTest = st => (u, i) => !st.obs[u][i];
    const _isTrain = st => (u, i) => !!st.obs[u][i];

    // ---- data and names ----------------------------------------------------

    /** User name, e.g. cfUser(0) = 'Ava'. */
    function cfUser(u) { return _st().users[_u(u)]; }
    /** Movie title, e.g. cfMovie(4) = 'Matrix'. */
    function cfMovie(i) { return _st().movies[_i(i)]; }
    /** Name of designed taste axis f: Action, Romance, Sci-fi. */
    function cfGenre(f) { return GENRES[_ci(f, 2)]; }
    /** Current rating r_ui (the editable table cf_R, observed or hidden). */
    function cfR(u, i) { return _st().R[_u(u)][_i(i)]; }
    /** 1 if (u,i) is in the training set Omega, 0 if hidden. */
    function cfObs(u, i) { return _st().obs[_u(u)][_i(i)]; }
    /** Number of observed ratings |Omega|. */
    function cfNObs() { let n = 0; for (const row of _st().obs) for (const v of row) n += v; return n; }
    /** Global mean of the observed ratings, mu. */
    function cfMu() {
        const st = _st(); let s = 0, n = 0;
        for (let u = 0; u < NU; u++) for (let i = 0; i < NI; i++) if (st.obs[u][i]) { s += st.R[u][i]; n++; }
        return n ? s / n : 0;
    }
    /** Mean of user u's observed ratings. */
    function cfUserMean(u) {
        const st = _st(); const uu = _u(u); let s = 0, n = 0;
        for (let i = 0; i < NI; i++) if (st.obs[uu][i]) { s += st.R[uu][i]; n++; }
        return n ? s / n : 0;
    }

    // ---- neighbourhood CF (GroupLens-style user-based) ---------------------

    /** Index of the k-th (0-based) hidden movie of user u, or -1. */
    function cfHidden(u, k) {
        const st = _st(); const uu = _u(u); const kk = Math.round(Number(k) || 0);
        let seen = 0;
        for (let i = 0; i < NI; i++) if (!st.obs[uu][i]) { if (seen === kk) return i; seen++; }
        return -1;
    }
    /** Number of movies both u and v have rated (observed). */
    function cfCoRated(u, v) {
        const st = _st(); const a = _u(u), b = _u(v); let n = 0;
        for (let i = 0; i < NI; i++) if (st.obs[a][i] && st.obs[b][i]) n++;
        return n;
    }
    function _sim(st, a, b) {
        if (a === b) return 1;
        const ma = _meanOf(st, a), mb = _meanOf(st, b);
        let num = 0, da = 0, db = 0, n = 0;
        for (let i = 0; i < NI; i++) {
            if (!(st.obs[a][i] && st.obs[b][i])) continue;
            const x = st.R[a][i] - ma, y = st.R[b][i] - mb;
            num += x * y; da += x * x; db += y * y; n++;
        }
        if (n < 2 || da === 0 || db === 0) return 0;
        return num / Math.sqrt(da * db);
    }
    function _meanOf(st, u) {
        let s = 0, n = 0;
        for (let i = 0; i < NI; i++) if (st.obs[u][i]) { s += st.R[u][i]; n++; }
        return n ? s / n : 0;
    }
    /** Pearson similarity w_uv over co-rated items, each user centred on
     *  their own mean over everything they rated. 0 with < 2 co-rated items. */
    function cfSim(u, v) { return _sim(_st(), _u(u), _u(v)); }
    function _neighbours(st, u, i, n) {
        const cand = [];
        for (let v = 0; v < NU; v++) if (v !== u && st.obs[v][i]) cand.push([v, _sim(st, u, v)]);
        cand.sort((x, y) => y[1] - x[1] || x[0] - y[0]);
        return cand.slice(0, n);
    }
    function _knn(st, u, i, n) {
        const nb = _neighbours(st, u, i, n);
        let num = 0, den = 0;
        for (const [v, w] of nb) { num += w * (st.R[v][i] - _meanOf(st, v)); den += Math.abs(w); }
        return _meanOf(st, u) + (den > 0 ? num / den : 0);
    }
    /** User-based kNN prediction: r_u_bar + sum w (r_vi - r_v_bar) / sum |w|
     *  over the n most similar users who rated i (n defaults to slider cf_knn). */
    function cfKnn(u, i, n) {
        const st = _st();
        return _knn(st, _u(u), _i(i), n == null ? st.knn : _ci(n, NU - 1));
    }
    /** The rank-th (0-based) neighbour used by cfKnn(u, i, n), or -1. */
    function cfKnnNbr(u, i, rank, n) {
        const st = _st();
        const nb = _neighbours(st, _u(u), _i(i), n == null ? st.knn : _ci(n, NU - 1));
        const r = Math.round(Number(rank) || 0);
        return r >= 0 && r < nb.length ? nb[r][0] : -1;
    }
    /** Test RMSE of kNN over the hidden cells. */
    function cfKnnRmse(n) {
        const st = _st(); const nn = n == null ? st.knn : _ci(n, NU - 1);
        let acc = 0, c = 0;
        for (let u = 0; u < NU; u++) for (let i = 0; i < NI; i++) {
            if (st.obs[u][i]) continue;
            const d = st.R[u][i] - _knn(st, u, i, nn); acc += d * d; c++;
        }
        return c ? Math.sqrt(acc / c) : 0;
    }

    // ---- the designed factor model (taste space) ---------------------------

    /** Designed taste of user u on axis f (tensor slider cf_pstar overrides). */
    function cfPstar(u, f) { return _st().pstar[_u(u)][_ci(f, 2)]; }
    /** Designed vector of movie i on axis f (tensor slider cf_qstar overrides). */
    function cfQstar(i, f) { return _st().qstar[_i(i)][_ci(f, 2)]; }
    /** Designed prediction q*_i . p*_u. */
    function cfStarPred(u, i) { const st = _st(); return _dot(st.pstar[_u(u)], st.qstar[_i(i)]); }
    /** |p*_u|. */
    function cfPstarLen(u) { const p = _st().pstar[_u(u)]; return Math.sqrt(_dot(p, p)); }
    /** |q*_i|. */
    function cfQstarLen(i) { const q = _st().qstar[_i(i)]; return Math.sqrt(_dot(q, q)); }
    /** cos of the angle between p*_u and q*_i (0 if either is zero). */
    function cfStarCos(u, i) {
        const st = _st(); const p = st.pstar[_u(u)], q = st.qstar[_i(i)];
        const d = Math.sqrt(_dot(p, p) * _dot(q, q));
        return d > 0 ? _dot(p, q) / d : 0;
    }

    // ---- learned factors: ALS / SGD ----------------------------------------

    /** Last stored epoch (the epoch slider's max). */
    function cfEpochMax() { return MAX_EPOCH; }
    /** Learned user factor p_u[f] at epoch cf_epoch for algorithm cf_algo
     *  (0 ALS, 1 SGD). 0 for f >= k. */
    function cfP(u, f) {
        const st = _st(); const s = _snapAt(st); const ff = Math.round(Number(f) || 0);
        return ff >= 0 && ff < st.k ? s.P[_u(u)][ff] : 0;
    }
    /** Learned movie factor q_i[f], as cfP. */
    function cfQ(i, f) {
        const st = _st(); const s = _snapAt(st); const ff = Math.round(Number(f) || 0);
        return ff >= 0 && ff < st.k ? s.Q[_i(i)][ff] : 0;
    }
    /** Learned prediction q_i . p_u at the current epoch. */
    function cfPred(u, i) { const s = _snapAt(_st()); return _dot(s.P[_u(u)], s.Q[_i(i)]); }
    /** Prediction at a given epoch and algorithm (for charts). */
    function cfPredAt(u, i, e, algo) {
        const st = _st(); const s = _snapAt(st, algo == null ? st.algo : _ci(algo, 1), e);
        return _dot(s.P[_u(u)], s.Q[_i(i)]);
    }
    function _rmseAt(algo, e, which) {
        const st = _st(); const s = _snapAt(st, algo, e);
        return _rmse(s.P, s.Q, st.R, which === 'test' ? _isTest(st) : _isTrain(st));
    }
    /** Training RMSE (observed cells) at epoch e, current algorithm. */
    function cfTrainRmse(e) { return _rmseAt(_st().algo, e, 'train'); }
    /** Test RMSE (hidden cells) at epoch e, current algorithm. */
    function cfTestRmse(e) { return _rmseAt(_st().algo, e, 'test'); }
    /** ALS train / test RMSE at epoch e, whatever cf_algo says. */
    function cfAlsTrain(e) { return _rmseAt(0, e, 'train'); }
    function cfAlsTest(e) { return _rmseAt(0, e, 'test'); }
    /** SGD train / test RMSE at epoch e, whatever cf_algo says. */
    function cfSgdTrain(e) { return _rmseAt(1, e, 'train'); }
    function cfSgdTest(e) { return _rmseAt(1, e, 'test'); }
    /** Regularised objective (Koren Eq. 2, per-vector form, no biases) at epoch e, current algorithm. */
    function cfLoss(e) {
        const st = _st(); const s = _snapAt(st, st.algo, e);
        return _loss(s.P, s.Q, st.R, st.obs, st.lam);
    }

    // ---- zero-fill: the wrong way ------------------------------------------

    function _zero(st) {
        return _cached(st, 'zero|' + st.k + '|' + st.seed, () => _key('zero', st.R, st.obs, st.k, st.seed), () => {
            const Rz = st.R.map((row, u) => row.map((r, i) => (st.obs[u][i] ? r : 0)));
            const ones = st.R.map(row => row.map(() => 1));
            return _als(Rz, ones, st.k, ZERO_LAMBDA, ZERO_EPOCHS, st.seed).pop();
        });
    }
    /** Rank-k fit of the table with every hidden cell treated as 0
     *  (= truncated SVD of the zero-filled matrix). */
    function cfZeroPred(u, i) { const z = _zero(_st()); return _dot(z.P[_u(u)], z.Q[_i(i)]); }
    /** Test RMSE of the zero-fill fit on the hidden cells. */
    function cfZeroRmse() { const st = _st(); const z = _zero(st); return _rmse(z.P, z.Q, st.R, _isTest(st)); }

    // ---- capacity sweep ----------------------------------------------------

    function _sweep(st, k, lam) {
        const kk = _ci(k, K_MAX) || 1, ll = Math.max(0, Number(lam) || 0);
        return _cached(st, 'sweep|' + kk + '|' + ll + '|' + st.seed, () => _key('sweep', st.R, st.obs, kk, ll, st.seed), () => {
            const s = _als(st.R, st.obs, kk, ll, SWEEP_EPOCHS, st.seed).pop();
            return { train: _rmse(s.P, s.Q, st.R, _isTrain(st)), test: _rmse(s.P, s.Q, st.R, _isTest(st)) };
        });
    }
    /** Train RMSE of ALS with k factors and penalty lam (200 epochs). */
    function cfSweepTrain(k, lam) { return _sweep(_st(), k, lam).train; }
    /** Test RMSE of ALS with k factors and penalty lam (200 epochs). */
    function cfSweepTest(k, lam) { return _sweep(_st(), k, lam).test; }

    // ---- invariance: factors are only defined up to an invertible map -----

    function _map(st) {
        // A = D R_axis(theta), D = diag(stretch, 1, 1); A^-T = D^-1 R_axis(theta).
        const c = Math.cos(st.theta), s = Math.sin(st.theta);
        const Rm = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        const [a, b] = st.axis === 0 ? [1, 2] : (st.axis === 1 ? [2, 0] : [0, 1]);
        Rm[a][a] = c; Rm[a][b] = -s; Rm[b][a] = s; Rm[b][b] = c;
        const sx = Math.abs(st.stretch) > 1e-6 ? st.stretch : 1e-6;
        const A = Rm.map((row, r) => row.map(v => (r === 0 ? sx * v : v)));
        const Ait = Rm.map((row, r) => row.map(v => (r === 0 ? v / sx : v)));
        return { A, Ait };
    }
    const _rowTimes = (v, M) => [0, 1, 2].map(c => v[0] * M[0][c] + v[1] * M[1][c] + v[2] * M[2][c]);
    /** Entry (r, c) of the invertible map A (rotation cf_theta degrees about
     *  axis cf_axis, after stretching axis 0 by cf_stretch). */
    function cfMapA(r, c) { return _map(_st()).A[_ci(r, 2)][_ci(c, 2)]; }
    /** p_u A: the learned user vector after the map (k = 3; otherwise p_u). */
    function cfMapP(u, f) {
        const st = _st(); if (st.k !== 3) return cfP(u, f);
        return _rowTimes(_snapAt(st).P[_u(u)], _map(st).A)[_ci(f, 2)];
    }
    /** q_i A^-T: the learned movie vector after the compensating map. */
    function cfMapQ(i, f) {
        const st = _st(); if (st.k !== 3) return cfQ(i, f);
        return _rowTimes(_snapAt(st).Q[_i(i)], _map(st).Ait)[_ci(f, 2)];
    }
    /** (p_u A) . (q_i A^-T) -- equal to cfPred(u, i) for every A. */
    function cfMapPred(u, i) {
        const st = _st(); if (st.k !== 3) return cfPred(u, i);
        const m = _map(st), s = _snapAt(st);
        return _dot(_rowTimes(s.P[_u(u)], m.A), _rowTimes(s.Q[_i(i)], m.Ait));
    }
    function _fit(st) {
        if (st.k !== 3) return null;
        const s = _snapAt(st);
        return _cached(st, 'fit', () => _key('fit', st.pstar, s.P), () => {
            // A = (P*^T P*)^-1 P*^T P, column by column.
            const G = [0, 1, 2].map(a => [0, 1, 2].map(b => st.pstar.reduce((t, p) => t + p[a] * p[b], 0)));
            const cols = [0, 1, 2].map(c => _solve(G, [0, 1, 2].map(a => st.pstar.reduce((t, p, u) => t + p[a] * s.P[u][c], 0))));
            const A = [0, 1, 2].map(r => [0, 1, 2].map(c => cols[c][r]));
            let resid = 0;
            st.pstar.forEach((p, u) => _rowTimes(p, A).forEach((v, c) => { resid = Math.max(resid, Math.abs(v - s.P[u][c])); }));
            return { A, resid };
        });
    }
    /** Entry (r, c) of the least-squares map with P* A ~ P (learned P, k = 3). */
    function cfFitA(r, c) { const f = _fit(_st()); return f ? f.A[_ci(r, 2)][_ci(c, 2)] : 0; }
    /** Largest |(P* A - P)_uf| for that fit: ~0 means the learned factors ARE
     *  the designed ones, seen through a linear map. */
    function cfFitResid() { const f = _fit(_st()); return f ? f.resid : NaN; }

    // ---- biases ------------------------------------------------------------

    function _biases(st) {
        return _cached(st, 'bias', () => _key('bias', st.R, st.obs), () => {
            let s = 0, n = 0;
            for (let u = 0; u < NU; u++) for (let i = 0; i < NI; i++) if (st.obs[u][i]) { s += st.R[u][i]; n++; }
            const mu = n ? s / n : 0;
            const bi = [];
            for (let i = 0; i < NI; i++) {
                let t = 0, c = 0;
                for (let u = 0; u < NU; u++) if (st.obs[u][i]) { t += st.R[u][i] - mu; c++; }
                bi.push(c ? t / c : 0);
            }
            const bu = [];
            for (let u = 0; u < NU; u++) {
                let t = 0, c = 0;
                for (let i = 0; i < NI; i++) if (st.obs[u][i]) { t += st.R[u][i] - mu - bi[i]; c++; }
                bu.push(c ? t / c : 0);
            }
            return { mu, bu, bi };
        });
    }
    /** User bias b_u: mean residual after mu and the item biases. */
    function cfBu(u) { return _biases(_st()).bu[_u(u)]; }
    /** Item bias b_i: mean of (r - mu) over the users who rated i. */
    function cfBi(i) { return _biases(_st()).bi[_i(i)]; }
    /** Baseline prediction mu + b_u + b_i. */
    function cfBaseline(u, i) { const b = _biases(_st()); return b.mu + b.bu[_u(u)] + b.bi[_i(i)]; }
    /** Test RMSE of the baseline on the hidden cells. */
    function cfBaselineRmse() {
        const st = _st(); const b = _biases(st); let acc = 0, c = 0;
        for (let u = 0; u < NU; u++) for (let i = 0; i < NI; i++) {
            if (st.obs[u][i]) continue;
            const d = st.R[u][i] - (b.mu + b.bu[u] + b.bi[i]); acc += d * d; c++;
        }
        return c ? Math.sqrt(acc / c) : 0;
    }

    // ---- fold-in: you, in taste space -------------------------------------

    function _me(st) {
        const w = st.me.map(r => (r >= 1 ? 1 : 0));
        return _ridgeRow(st.qstar, st.me, w, FOLD_LAMBDA, 3);
    }
    /** Your taste vector on (Action, Romance, Sci-fi), solved from the
     *  ratings in cf_me (0 = not rated) against the designed movie vectors:
     *  p = (Q_I^T Q_I + 0.1 I)^-1 Q_I^T r. */
    function cfMe(f) { return _me(_st())[_ci(f, 2)]; }
    /** Predicted rating of movie i for you. */
    function cfMePred(i) { const st = _st(); return _dot(_me(st), st.qstar[_i(i)]); }
    /** Your rating of movie i from cf_me (0 = not seen). */
    function cfMeR(i) { return _st().me[_i(i)]; }
    /** How many movies you have rated. */
    function cfMeRated() { return _st().me.filter(r => r >= 1).length; }
    /** Index of your rank-th best UNRATED movie (0-based), or -1. */
    function cfMeTop(rank) {
        const st = _st(); const p = _me(st);
        const cand = [];
        for (let i = 0; i < NI; i++) if (!(st.me[i] >= 1)) cand.push([i, _dot(p, st.qstar[i])]);
        cand.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
        const r = Math.round(Number(rank) || 0);
        return r >= 0 && r < cand.length ? cand[r][0] : -1;
    }

    // ---- implicit feedback (Hu, Koren & Volinsky 2008) ---------------------

    function _implicit(st) {
        return _cached(st, 'imp|' + st.alpha + '|' + st.k + '|' + st.seed, () => _key('imp', st.C, st.alpha, st.k, st.seed), () => {
            const pref = st.C.map(row => row.map(c => (c > 0 ? 1 : 0)));
            const conf = st.C.map(row => row.map(c => 1 + st.alpha * c));
            const s = _als(pref, conf, st.k, IMP_LAMBDA, IMP_ITERS, st.seed).pop();
            return s;
        });
    }
    function _posOnly(st) {
        return _cached(st, 'pos|' + st.k + '|' + st.seed, () => _key('pos', st.C, st.k, st.seed), () => {
            const ones = st.C.map(row => row.map(() => 1));
            const w = st.C.map(row => row.map(c => (c > 0 ? 1 : 0)));
            return _als(ones, w, st.k, IMP_LAMBDA, POS_ITERS, st.seed).pop();
        });
    }
    /** Watch count c_ui (tensor slider cf_C). */
    function cfC(u, i) { return _st().C[_u(u)][_i(i)]; }
    /** Preference p_ui = 1 if watched at all, else 0. */
    function cfPref(u, i) { return _st().C[_u(u)][_i(i)] > 0 ? 1 : 0; }
    /** Confidence c_ui = 1 + alpha * count. */
    function cfConf(u, i) { const st = _st(); return 1 + st.alpha * st.C[_u(u)][_i(i)]; }
    /** Implicit user factor x_u[f] (weighted ALS over ALL cells). */
    function cfImpX(u, f) { const st = _st(); const ff = Math.round(Number(f) || 0); return ff >= 0 && ff < st.k ? _implicit(st).P[_u(u)][ff] : 0; }
    /** Implicit movie factor y_i[f]. */
    function cfImpY(i, f) { const st = _st(); const ff = Math.round(Number(f) || 0); return ff >= 0 && ff < st.k ? _implicit(st).Q[_i(i)][ff] : 0; }
    /** Predicted preference x_u . y_i. */
    function cfImpPred(u, i) { const s = _implicit(_st()); return _dot(s.P[_u(u)], s.Q[_i(i)]); }
    /** The control: fit ONLY the watched cells (all targets 1). Predicts ~1
     *  everywhere -- with only positives, "everyone likes everything" fits. */
    function cfImpPosOnly(u, i) { const s = _posOnly(_st()); return _dot(s.P[_u(u)], s.Q[_i(i)]); }
    /** Index of user u's top UNWATCHED movie by predicted preference, or -1. */
    function cfImpTop(u) {
        const st = _st(); const uu = _u(u); const s = _implicit(st);
        let best = -1, bv = -Infinity;
        for (let i = 0; i < NI; i++) {
            if (st.C[uu][i] > 0) continue;
            const v = _dot(s.P[uu], s.Q[i]);
            if (v > bv) { bv = v; best = i; }
        }
        return best;
    }

    // ---- playground: a traced user-based prediction -------------------------

    const _f = x => (Number.isFinite(x) ? (Math.abs(x) < 0.005 ? '0.00' : x.toFixed(2)) : '—');
    const _sgn = x => (x < 0 ? `(${_f(x)})` : _f(x));   // wrap negatives inside sums
    function _rated(st, u) { const out = []; for (let i = 0; i < NI; i++) if (st.obs[u][i]) out.push(i); return out; }
    function _pearsonParts(st, a, b) {
        const ma = _meanOf(st, a), mb = _meanOf(st, b);
        const rows = [];
        let sxy = 0, sxx = 0, syy = 0;
        for (let i = 0; i < NI; i++) {
            if (!(st.obs[a][i] && st.obs[b][i])) continue;
            const x = st.R[a][i] - ma, y = st.R[b][i] - mb;
            rows.push({ i, ra: st.R[a][i], rb: st.R[b][i], x, y });
            sxy += x * y; sxx += x * x; syy += y * y;
        }
        return { ma, mb, rows, sxy, sxx, syy, w: _sim(st, a, b) };
    }
    function _playNbrs(st) {
        const p = st.play; if (!p) return [];
        return _neighbours(st, p.tu, p.ti, st.knn).map(([v]) => v);
    }
    /** 1 if user v is one of the n neighbors used for the playground target. */
    function cfUsedNbr(v) { const st = _st(); return _playNbrs(st).includes(_u(v)) ? 1 : 0; }
    /** Playground cell value: the rating 1-5, or 0 for "?" (the target keeps its value). */
    function cfPlay(u, i) { return _st().R[_u(u)][_i(i)]; }
    /** Prediction for the playground target (its own rating held out). */
    function cfPlayPred() { const st = _st(); const p = st.play; return p ? _knn(st, p.tu, p.ti, st.knn) : NaN; }

    const STAGES = ['Target and its user\'s mean', 'Who can vote?', 'Pearson similarity, worked',
                    'Choose the neighbors', 'Weighted deviations', 'The prediction'];
    /** Title of walkthrough stage s (1-based). */
    function cfWalkTitle(s) { return STAGES[_ci(Number(s) - 1, STAGES.length - 1)]; }

    /** One-line summary of the playground prediction. */
    function cfWalkSummary() {
        const st = _st(); const p = st.play; if (!p) return 'Playground inactive.';
        const U = st.users, M = st.movies, pred = _knn(st, p.tu, p.ti, st.knn);
        const act = p.actual == null ? 'unknown (?)' : `${p.actual} — error ${_f(pred - p.actual)}`;
        return `**${U[p.tu]} × ${M[p.ti]}**: predicted $\\hat r = ${_f(pred)}$ · actual ${act}`;
    }

    /** The full walkthrough text for stage s: what and why, formula,
     *  substituted values, intermediate steps, result. Markdown + KaTeX. */
    function cfWalk(s) {
        const st = _st(); const p = st.play;
        if (!p) return 'Playground inactive.';
        const U = st.users, M = st.movies, u = p.tu, i = p.ti, n = st.knn;
        const stage = _ci(Number(s) - 1, STAGES.length - 1) + 1;
        const Iu = _rated(st, u);
        const mu = _meanOf(st, u);
        const head = `### ${stage}/6 · ${STAGES[stage - 1]}\n`;
        const cands = [];
        for (let v = 0; v < NU; v++) if (v !== u && st.obs[v][i]) cands.push(v);
        const ranked = cands.map(v => [v, _sim(st, u, v)]).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
        const chosen = ranked.slice(0, n);

        if (stage === 1) {
            const sum = Iu.reduce((t, k) => t + st.R[u][k], 0);
            const actual = p.actual == null ? 'is **?** — unknown' : `is **${p.actual}**, but it is **held out**: we predict it as if it were unknown and compare at the end`;
            return head +
                `**What and why.** We predict **${U[u]}**'s rating of **${M[i]}**. The cell ${actual}. ` +
                `Everything starts from ${U[u]}'s *own* scale: their average rating over the movies they did rate.\n\n` +
                `**Formula.** $\\bar r_u = \\dfrac{1}{|I_u|}\\sum_{k \\in I_u} r_{uk}$\n\n` +
                `**Values.** ${U[u]} rated ${Iu.length ? Iu.map(k => `${M[k]} = ${st.R[u][k]}`).join(', ') : 'nothing'}.\n\n` +
                (Iu.length
                    ? `$$\\bar r_{\\text{${U[u]}}} = \\frac{${Iu.map(k => st.R[u][k]).join(' + ')}}{${Iu.length}} = \\frac{${sum}}{${Iu.length}} = ${_f(mu)}$$`
                    : `No ratings left: the mean is undefined (shown as 0) and the prediction falls back to it.`);
        }
        if (stage === 2) {
            const rows = cands.map(v => `| ${U[v]} | ${st.R[v][i]} | ${_rated(st, v).length} | ${_f(_meanOf(st, v))} | ${cfCoRated(u, v)} |`);
            const out = [];
            for (let v = 0; v < NU; v++) if (v !== u && !st.obs[v][i]) out.push(U[v]);
            return head +
                `**What and why.** Only people who **rated ${M[i]}** can say anything about it. For each we need their own mean ` +
                `(to read their rating relative to their scale) and how many movies they share with ${U[u]} (similarity is computed on those).\n\n` +
                `**Formulas.** $\\bar r_v = \\frac{1}{|I_v|}\\sum_{k\\in I_v} r_{vk}$, $\\;I_{uv} = I_u \\cap I_v$\n\n` +
                (rows.length ? `| user $v$ | $r_{v,i}$ | $|I_v|$ | $\\bar r_v$ | $|I_{uv}|$ |\n|---|---|---|---|---|\n${rows.join('\n')}\n\n` : '**Nobody else rated it** — no prediction beyond the user mean.\n\n') +
                (out.length ? `**Excluded** (did not rate ${M[i]}): ${out.join(', ')}.` : '');
        }
        if (stage === 3) {
            const v = p.pv;
            if (v === u) return head + `Pick a **compare with** user other than ${U[u]} to see the Pearson calculation.`;
            const pp = _pearsonParts(st, u, v);
            const rows = pp.rows.map(r => `| ${M[r.i]} | ${r.ra} | ${_f(r.x)} | ${r.rb} | ${_f(r.y)} | ${_f(r.x * r.y)} | ${_f(r.x * r.x)} | ${_f(r.y * r.y)} |`);
            let result;
            if (pp.rows.length < 2) result = `Only ${pp.rows.length} co-rated movie(s): a correlation needs at least 2, so $w = 0$.`;
            else if (pp.sxx === 0 || pp.syy === 0) result = `One user's centered ratings are all 0 on the shared movies (no spread), so the correlation is undefined: $w = 0$.`;
            else result = `$$w_{\\text{${U[u]}},\\text{${U[v]}}} = \\frac{${_f(pp.sxy)}}{\\sqrt{${_f(pp.sxx)}}\\,\\sqrt{${_f(pp.syy)}}} = \\frac{${_f(pp.sxy)}}{${_f(Math.sqrt(pp.sxx))} \\times ${_f(Math.sqrt(pp.syy))}} = ${_f(pp.w)}$$`;
            const all = ranked.map(([c, w]) => `${U[c]} ${_f(w)}`).join(' · ');
            return head +
                `**What and why.** How much does **${U[v]}** rate like **${U[u]}**? Center each user's ratings on their own mean ` +
                `($x$ for ${U[u]}, $y$ for ${U[v]}) over the movies both rated, then take the cosine of the angle between the two centered vectors.\n\n` +
                `**Formula.** $w_{uv} = \\dfrac{\\sum x_k y_k}{\\sqrt{\\sum x_k^2}\\sqrt{\\sum y_k^2}}$, $\\;x_k = r_{uk} - \\bar r_u$, $\\;y_k = r_{vk} - \\bar r_v$\n\n` +
                `**Means.** $\\bar r_{\\text{${U[u]}}} = ${_f(pp.ma)}$, $\\bar r_{\\text{${U[v]}}} = ${_f(pp.mb)}$\n\n` +
                (rows.length ? `| movie | $r_u$ | $x$ | $r_v$ | $y$ | $xy$ | $x^2$ | $y^2$ |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n| **sum** | | | | | **${_f(pp.sxy)}** | **${_f(pp.sxx)}** | **${_f(pp.syy)}** |\n\n` : '') +
                `**Result.** ${result}\n\n**All voters for ${M[i]}:** ${all || '—'}`;
        }
        if (stage === 4) {
            const rows = ranked.map(([v, w], k) => `| ${k + 1} | ${U[v]} | ${_f(w)} | ${k < n ? '**used**' : '—'} |`);
            return head +
                `**What and why.** Keep only the $n = ${n}$ voters **most similar** to ${U[u]} — the people whose taste best predicts theirs. ` +
                `Negative similarity ranks last: such a user rates opposite to ${U[u]}.\n\n` +
                `**Rule.** $N_i(u) = $ the top $n$ users by $w_{uv}$ among those with $r_{vi}$ known.\n\n` +
                (rows.length ? `| rank | user | $w$ | |\n|---|---|---|---|\n${rows.join('\n')}\n\n` : 'No voters.\n\n') +
                `**Result.** $N_{\\text{${M[i].replace(/&/g, '\\&')}}}(\\text{${U[u]}}) = \\{${chosen.map(([v]) => `\\text{${U[v]}}`).join(', ') || '\\varnothing'}\\}$`;
        }
        const terms = chosen.map(([v, w]) => { const mv = _meanOf(st, v); const d = st.R[v][i] - mv; return { v, w, mv, d, wd: w * d }; });
        const swd = terms.reduce((t, x) => t + x.wd, 0), sw = terms.reduce((t, x) => t + Math.abs(x.w), 0);
        const dbar = sw > 0 ? swd / sw : 0;
        if (stage === 5) {
            const rows = terms.map(x => `| ${U[x.v]} | ${_f(x.w)} | ${st.R[x.v][i]} | ${_f(x.mv)} | ${_f(x.d)} | ${_f(x.wd)} | ${_f(Math.abs(x.w))} |`);
            return head +
                `**What and why.** A neighbor's raw star count is not comparable across people, so use how far **above or below their own mean** ` +
                `they rated ${M[i]} ($d$), and weight it by similarity. Dividing by $\\sum|w|$ turns the sum into a weighted **average** deviation.\n\n` +
                `**Formula.** $\\bar d = \\dfrac{\\sum_{v\\in N} w_{uv}\\,(r_{vi} - \\bar r_v)}{\\sum_{v\\in N} |w_{uv}|}$\n\n` +
                (rows.length ? `| neighbor | $w$ | $r_{vi}$ | $\\bar r_v$ | $d = r_{vi}-\\bar r_v$ | $w\\,d$ | $|w|$ |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n| **sum** | | | | | **${_f(swd)}** | **${_f(sw)}** |\n\n` : '') +
                (sw > 0
                    ? `$$\\bar d = \\frac{${terms.map(x => `${_f(x.w)}\\cdot${_sgn(x.d)}`).join(' + ')}}{${terms.map(x => _f(Math.abs(x.w))).join(' + ')}} = \\frac{${_f(swd)}}{${_f(sw)}} = ${_f(dbar)}$$`
                    : `All weights are 0, so the average deviation is taken as 0.`);
        }
        const pred = mu + dbar;
        const cmp = p.actual == null ? `The true rating is unknown (**?**) — this is a genuine prediction.`
            : `The held-out rating is **${p.actual}**, so the error is $${_f(pred)} - ${p.actual} = ${_f(pred - p.actual)}$.`;
        return head +
            `**What and why.** Start from ${U[u]}'s own mean and shift it by the neighbors' average deviation: ` +
            `"${U[u]} usually gives ${_f(mu)}; people like them rated ${M[i]} ${dbar >= 0 ? 'above' : 'below'} their usual by ${_f(Math.abs(dbar))}."\n\n` +
            `**Formula.** $\\hat r_{ui} = \\bar r_u + \\dfrac{\\sum_{v\\in N} w_{uv}\\,(r_{vi}-\\bar r_v)}{\\sum_{v\\in N}|w_{uv}|}$\n\n` +
            `$$\\hat r_{\\text{${U[u]}}} = ${_f(mu)} + \\frac{${_f(swd)}}{${_f(sw)}} = ${_f(mu)} ${dbar < 0 ? '-' : '+'} ${_f(Math.abs(dbar))} = ${_f(pred)}$$\n\n` +
            `**Result.** ${cmp}`;
    }

    window.AlgeBenchDomains.register('collaborative-filtering', {
        _init({ getSlider, getData }) {
            _getSlider = getSlider;
            if (typeof getData === 'function') _getData = getData;
            _cache = null;
        },
        // data and names
        cfUser, cfMovie, cfGenre, cfR, cfObs, cfHidden, cfNObs, cfMu, cfUserMean,
        // playground
        cfPlay, cfPlayPred, cfUsedNbr, cfWalk, cfWalkTitle, cfWalkSummary,
        // neighbourhood CF
        cfCoRated, cfSim, cfKnn, cfKnnNbr, cfKnnRmse,
        // designed factor model
        cfPstar, cfQstar, cfStarPred, cfPstarLen, cfQstarLen, cfStarCos,
        // learned factors
        cfEpochMax, cfP, cfQ, cfPred, cfPredAt, cfTrainRmse, cfTestRmse,
        cfAlsTrain, cfAlsTest, cfSgdTrain, cfSgdTest, cfLoss,
        // zero-fill and capacity
        cfZeroPred, cfZeroRmse, cfSweepTrain, cfSweepTest,
        // invariance
        cfMapA, cfMapP, cfMapQ, cfMapPred, cfFitA, cfFitResid,
        // biases
        cfBu, cfBi, cfBaseline, cfBaselineRmse,
        // fold-in
        cfMe, cfMeR, cfMePred, cfMeRated, cfMeTop,
        // implicit feedback
        cfC, cfPref, cfConf, cfImpX, cfImpY, cfImpPred, cfImpPosOnly, cfImpTop,
    });

})();
