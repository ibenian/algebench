/**
 * AlgeBench Domain Library — Anomaly
 *
 * Real outlier-detection arithmetic for the lesson "Outlier Detection: from
 * z-scores to learned anomaly scores". Every score drawn on screen is computed
 * here from the actual definition — the k-th nearest-neighbour distance, the
 * LOF ratio of local reachability densities, the expected isolation path
 * length, the Mahalanobis form, the Gaussian-kernel one-class level set, the
 * rank-r PCA reconstruction error, and the sweep of a threshold over a scored
 * dataset. Nothing is a hand-drawn approximation of what the algorithm "would
 * look like".
 *
 * THE DATA IS SYNTHETIC AND SEEDED, NOT REAL. Every dataset below is drawn
 * from a splitmix32 stream keyed on a string tag, so the same picture appears
 * on every rebuild and in scripts/check_anomaly_domain.py. The lesson must say
 * so on screen: a lesson claiming that a detector "finds" something should be
 * honest that it planted it. What is NOT invented is the scoring — that part
 * is the real algorithm, and scripts/check_anomaly_domain.py recomputes the
 * statistical, distance, density and evaluation scores from scratch in NumPy
 * and compares. The Isolation Forest is the exception: its trees are
 * randomised, so the checker pins c(n), the score/depth identity, ranges,
 * separation and determinism rather than rebuilding the seeded forest.
 *
 * Every function is PURE in its explicit arguments. No function reads a
 * slider. A scene passes its sliders in (`adLof('dense', i, k)`), which is
 * what makes the whole library testable outside a browser and what keeps the
 * slider contract visible in the scene JSON rather than buried here.
 *
 * Datasets (tags):
 *   'metric'  1-D: 60 readings of a stable metric. The one dataset whose
 *             CONTENT depends on a parameter — adV(i, contam) injects
 *             `contam` large readings. Scene 2's whole argument.
 *   'blob'    2-D: one Gaussian cluster plus uniform contamination.
 *   'dense'   2-D: a tight cluster and a loose one, plus a point that sits
 *             between them. Global kNN calls the loose cluster anomalous;
 *             LOF does not. Scene 3's whole argument.
 *   'ellip'   2-D: strongly correlated Gaussian. Euclidean distance and
 *             Mahalanobis distance disagree about which point is extreme.
 *   'ring'    2-D: an annulus with a few points in the hole and outside.
 *             Non-convex, so an ellipse cannot fence it; a kernel level set
 *             can. Scene 4.
 *   'eval'    labelled: 400 points, 8% anomalous, with a score attached, for
 *             the ROC / PR / confusion sweep. Scene 6.
 *
 * Function groups: data access (adN, adX, adY, adLabel), the 1-D metric and
 * its robust statistics (adV ... adCountM), distance and density (adKnn, adLof,
 * adMahal, adCovEig), isolation and one-class (adIso, adIsoGrid, adCPath,
 * adKde, adKdeQ, adKdeR), reconstruction (adSig, adRecon, adResid, adPcaErr,
 * adPcaSurf), and evaluation (adScore ... adPrecBayes).
 */
(function () {

    // ---- seeded generation (reproducible, NOT real data) ------------------

    function _splitmix32(a) {
        return function () {
            a |= 0; a = (a + 0x9e3779b9) | 0;
            let t = a ^ (a >>> 16);
            t = Math.imul(t, 0x21f0aaad);
            t = t ^ (t >>> 15);
            t = Math.imul(t, 0x735a2d97);
            return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
        };
    }

    /** FNV-1a over a tag string, so a dataset's name fixes its numbers. */
    function _seedOf(tag) {
        let h = 0x811c9dc5;
        for (let k = 0; k < tag.length; k++) h = Math.imul(h ^ tag.charCodeAt(k), 0x01000193);
        return h ^ 0x5eed1234;
    }

    /** Two independent standard normals from one uniform pair (Box-Muller). */
    function _normals(rng) {
        let u = rng(); if (u < 1e-12) u = 1e-12;
        const v = rng();
        const r = Math.sqrt(-2 * Math.log(u));
        return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
    }

    /** A normal stream that never discards Box-Muller's spare. */
    function _gauss(rng) {
        let buf = [];
        return function () {
            if (buf.length === 0) buf = _normals(rng);
            return buf.pop();
        };
    }

    const _clampI = (v, lo, hi) => {
        const n = Math.round(Number(v));
        if (!Number.isFinite(n)) return lo;
        return n < lo ? lo : (n > hi ? hi : n);
    };
    const _num = (v, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };

    // ---- the datasets -----------------------------------------------------

    const _dsCache = Object.create(null);

    /** Builds `tag` once. Returns { n, x: Float64Array, y: Float64Array,
     *  lab: Uint8Array } — lab is the PLANTED truth, not a detector's verdict. */
    function _ds(tag) {
        const key = String(tag);
        if (_dsCache[key]) return _dsCache[key];
        const rng = _splitmix32(_seedOf(key));
        const g = _gauss(rng);
        let n, x, y, lab;

        if (key === 'blob') {
            const nIn = 180, nOut = 12;
            n = nIn + nOut;
            x = new Float64Array(n); y = new Float64Array(n); lab = new Uint8Array(n);
            for (let i = 0; i < nIn; i++) { x[i] = g(); y[i] = g(); }
            for (let i = 0; i < nOut; i++) {
                // Uniform over a wide square, rejected if it lands inside the bulk.
                let px, py;
                do { px = (rng() * 2 - 1) * 5; py = (rng() * 2 - 1) * 5; } while (px * px + py * py < 9);
                x[nIn + i] = px; y[nIn + i] = py; lab[nIn + i] = 1;
            }
        } else if (key === 'dense') {
            // A tight cluster at (-2.2, 0) with sigma 0.25, a loose one at
            // (2.4, 0) with sigma 1.0, and three planted strays. Every point
            // of the loose cluster is FARTHER from its neighbours than the
            // strays are from theirs: that is the whole point.
            const nA = 90, nB = 60, nS = 3;
            n = nA + nB + nS;
            x = new Float64Array(n); y = new Float64Array(n); lab = new Uint8Array(n);
            for (let i = 0; i < nA; i++) { x[i] = -2.2 + 0.25 * g(); y[i] = 0.25 * g(); }
            for (let i = 0; i < nB; i++) { x[nA + i] = 2.4 + 1.0 * g(); y[nA + i] = 1.0 * g(); }
            const strays = [[-2.2, 1.35], [-0.2, 2.6], [-3.6, -1.5]];
            for (let i = 0; i < nS; i++) {
                x[nA + nB + i] = strays[i][0]; y[nA + nB + i] = strays[i][1]; lab[nA + nB + i] = 1;
            }
        } else if (key === 'ellip') {
            // Correlated Gaussian: z1 along (1,1)/sqrt2 with sd 2.2, z2
            // across with sd 0.35. Two planted points, one far along the
            // ridge (Euclidean-far, Mahalanobis-near) and one just off it
            // (Euclidean-near, Mahalanobis-far). The pair IS the lesson.
            const nIn = 160;
            n = nIn + 2;
            x = new Float64Array(n); y = new Float64Array(n); lab = new Uint8Array(n);
            const c = Math.SQRT1_2;
            for (let i = 0; i < nIn; i++) {
                const a = 2.2 * g(), b = 0.35 * g();
                x[i] = c * (a - b); y[i] = c * (a + b);
            }
            x[nIn] = c * 4.6; y[nIn] = c * 4.6; lab[nIn] = 0;       // along the ridge
            x[nIn + 1] = c * (1.2 - 1.6); y[nIn + 1] = c * (1.2 + 1.6); lab[nIn + 1] = 1;  // across it
        } else if (key === 'ring') {
            const nIn = 200, nOut = 8;
            n = nIn + nOut;
            x = new Float64Array(n); y = new Float64Array(n); lab = new Uint8Array(n);
            for (let i = 0; i < nIn; i++) {
                const th = rng() * 2 * Math.PI;
                const r = 2.4 + 0.22 * g();
                x[i] = r * Math.cos(th); y[i] = r * Math.sin(th);
            }
            // Four in the hole, four outside — a convex fence cannot exclude
            // the hole, which is why this dataset is here.
            const planted = [[0.1, 0.2], [-0.3, 0.1], [0.25, -0.35], [0.0, -0.1],
                             [4.1, 0.6], [-3.9, 1.2], [1.0, 4.2], [-1.6, -4.0]];
            for (let i = 0; i < nOut; i++) {
                x[nIn + i] = planted[i][0]; y[nIn + i] = planted[i][1]; lab[nIn + i] = 1;
            }
        } else {
            // Unknown tag: a single standard cluster, so a typo degrades to a
            // visible blob rather than to NaN.
            n = 100;
            x = new Float64Array(n); y = new Float64Array(n); lab = new Uint8Array(n);
            for (let i = 0; i < n; i++) { x[i] = g(); y[i] = g(); }
        }

        const ds = { n, x, y, lab };
        _dsCache[key] = ds;
        return ds;
    }

    function adN(tag) { return _ds(tag).n; }
    function adX(tag, i) { const d = _ds(tag); return d.x[_clampI(i, 0, d.n - 1)]; }
    function adY(tag, i) { const d = _ds(tag); return d.y[_clampI(i, 0, d.n - 1)]; }
    function adLabel(tag, i) { const d = _ds(tag); return d.lab[_clampI(i, 0, d.n - 1)]; }

    // ---- scene 2: one metric, and the statistics that describe it ---------
    //
    // 60 readings ~ N(50, 3), with `contam` of them replaced by large ones.
    // The replacements are taken from a FIXED list in a FIXED order, so
    // turning the slider adds outliers one at a time and never reshuffles
    // the ones already there.

    const METRIC_N = 60;
    const METRIC_MAX_OUT = 8;
    // Slots the outliers occupy, and the value each one takes.
    const OUT_SLOT = [7, 23, 41, 12, 55, 30, 48, 3];
    const OUT_VAL = [72, 78, 69, 85, 74, 92, 67, 88];

    const _metricCache = Object.create(null);

    function _metric(contam) {
        const c = _clampI(contam, 0, METRIC_MAX_OUT);
        if (_metricCache[c]) return _metricCache[c];
        const rng = _splitmix32(_seedOf('metric'));
        const g = _gauss(rng);
        const v = new Float64Array(METRIC_N);
        for (let i = 0; i < METRIC_N; i++) v[i] = 50 + 3 * g();
        for (let k = 0; k < c; k++) v[OUT_SLOT[k]] = OUT_VAL[k];

        const sorted = Float64Array.from(v).sort();
        const mean = v.reduce((a, b) => a + b, 0) / METRIC_N;
        let ss = 0;
        for (let i = 0; i < METRIC_N; i++) { const d = v[i] - mean; ss += d * d; }
        const std = Math.sqrt(ss / (METRIC_N - 1));
        const med = _quantSorted(sorted, 0.5);
        const dev = Float64Array.from(v, u => Math.abs(u - med)).sort();
        const mad = _quantSorted(dev, 0.5);
        const q1 = _quantSorted(sorted, 0.25);
        const q3 = _quantSorted(sorted, 0.75);

        const out = { v, mean, std, med, mad, q1, q3, contam: c };
        _metricCache[c] = out;
        return out;
    }

    /** Linear-interpolation quantile of an ASCENDING array (numpy's default,
     *  the convention check_anomaly_domain.py pins). */
    function _quantSorted(s, q) {
        const m = s.length;
        if (m === 0) return NaN;
        const pos = (m - 1) * Math.min(1, Math.max(0, q));
        const lo = Math.floor(pos), hi = Math.ceil(pos);
        if (lo === hi) return s[lo];
        return s[lo] + (pos - lo) * (s[hi] - s[lo]);
    }

    /** The consistency constant that makes MAD estimate sigma for a normal:
     *  1 / Phi^{-1}(0.75) = 1.482602218505602. */
    const MAD_K = 1.482602218505602;

    function adMetricN() { return METRIC_N; }
    /** 1 if reading i was one of the `contam` planted outliers. Ground truth
     *  for the metric, so a scene can show what a rule MISSED and not only
     *  what it caught. */
    function adPlanted(i, contam) {
        const c = _clampI(contam, 0, METRIC_MAX_OUT);
        const ii = _clampI(i, 0, METRIC_N - 1);
        for (let k = 0; k < c; k++) if (OUT_SLOT[k] === ii) return 1;
        return 0;
    }
    function adV(i, contam) { return _metric(contam).v[_clampI(i, 0, METRIC_N - 1)]; }
    function adMeanV(contam) { return _metric(contam).mean; }
    function adStdV(contam) { return _metric(contam).std; }
    function adMedV(contam) { return _metric(contam).med; }
    function adMadV(contam) { return _metric(contam).mad; }
    function adSigmaHat(contam) { return MAD_K * _metric(contam).mad; }
    function adQ1(contam) { return _metric(contam).q1; }
    function adQ3(contam) { return _metric(contam).q3; }
    function adIqr(contam) { return _metric(contam).q3 - _metric(contam).q1; }

    function adZv(i, contam) {
        const m = _metric(contam);
        return (m.v[_clampI(i, 0, METRIC_N - 1)] - m.mean) / (m.std || 1e-12);
    }
    function adModZv(i, contam) {
        const m = _metric(contam);
        return (m.v[_clampI(i, 0, METRIC_N - 1)] - m.med) / (MAD_K * m.mad || 1e-12);
    }

    /** side: +1 upper, -1 lower. */
    function adFenceZ(side, k, contam) {
        const m = _metric(contam);
        return m.mean + Math.sign(_num(side, 1) || 1) * _num(k, 3) * m.std;
    }
    function adFenceM(side, k, contam) {
        const m = _metric(contam);
        return m.med + Math.sign(_num(side, 1) || 1) * _num(k, 3) * MAD_K * m.mad;
    }
    /** Tukey fences: Q1 - 1.5 IQR and Q3 + 1.5 IQR (or any whisker length). */
    function adFenceT(side, w, contam) {
        const m = _metric(contam);
        const iqr = m.q3 - m.q1, ww = _num(w, 1.5);
        return Math.sign(_num(side, 1) || 1) > 0 ? m.q3 + ww * iqr : m.q1 - ww * iqr;
    }

    /** How many of the 60 readings each rule flags. The gap between these two
     *  as `contam` climbs is scene 2's punchline: masking. */
    function adCountZ(k, contam) {
        const m = _metric(contam), kk = _num(k, 3);
        let c = 0;
        for (let i = 0; i < METRIC_N; i++) if (Math.abs(m.v[i] - m.mean) > kk * m.std) c++;
        return c;
    }
    function adCountM(k, contam) {
        const m = _metric(contam), kk = _num(k, 3), s = MAD_K * m.mad;
        let c = 0;
        for (let i = 0; i < METRIC_N; i++) if (Math.abs(m.v[i] - m.med) > kk * s) c++;
        return c;
    }
    function adCountT(w, contam) {
        const m = _metric(contam), iqr = m.q3 - m.q1, ww = _num(w, 1.5);
        let c = 0;
        for (let i = 0; i < METRIC_N; i++) if (m.v[i] > m.q3 + ww * iqr || m.v[i] < m.q1 - ww * iqr) c++;
        return c;
    }

    /** Grubbs' test statistic G = max|v - mean| / s, the largest z in the
     *  sample. Compared against its critical value it is the hypothesis-test
     *  reading of "the most extreme point". */
    function adGrubbs(contam) {
        const m = _metric(contam);
        let g = 0;
        for (let i = 0; i < METRIC_N; i++) g = Math.max(g, Math.abs(m.v[i] - m.mean));
        return g / (m.std || 1e-12);
    }

    // ---- scene 3: distance and density ------------------------------------

    const MAX_K = 40;
    const _nnCache = Object.create(null);

    /** Sorted distances from each point to every other, truncated to MAX_K.
     *  O(n^2 log n) once per dataset; n is a couple of hundred. */
    function _nn(tag) {
        const key = String(tag);
        if (_nnCache[key]) return _nnCache[key];
        const d = _ds(key), n = d.n;
        const kk = Math.min(MAX_K, n - 1);
        const dist = new Float64Array(n * kk);
        const idx = new Int32Array(n * kk);
        const buf = new Array(n - 1);
        for (let i = 0; i < n; i++) {
            let m = 0;
            for (let j = 0; j < n; j++) {
                if (j === i) continue;
                const dx = d.x[i] - d.x[j], dy = d.y[i] - d.y[j];
                buf[m++] = [Math.sqrt(dx * dx + dy * dy), j];
            }
            buf.length = m;
            buf.sort((a, b) => a[0] - b[0]);
            for (let k = 0; k < kk; k++) { dist[i * kk + k] = buf[k][0]; idx[i * kk + k] = buf[k][1]; }
        }
        const out = { n, kk, dist, idx };
        _nnCache[key] = out;
        return out;
    }

    /** Distance to the k-th nearest neighbour — the simplest distance-based
     *  anomaly score there is. */
    function adKnn(tag, i, k) {
        const nn = _nn(tag);
        const ii = _clampI(i, 0, nn.n - 1);
        const kk = _clampI(k, 1, nn.kk);
        return nn.dist[ii * nn.kk + (kk - 1)];
    }

    /** Mean distance to the k nearest neighbours. Less jumpy than the k-th. */
    function adKnnMean(tag, i, k) {
        const nn = _nn(tag);
        const ii = _clampI(i, 0, nn.n - 1);
        const kk = _clampI(k, 1, nn.kk);
        let s = 0;
        for (let m = 0; m < kk; m++) s += nn.dist[ii * nn.kk + m];
        return s / kk;
    }

    const _lofCache = Object.create(null);

    /** Local Outlier Factor, Breunig et al. 2000, as defined:
     *    reach-dist_k(a, b) = max(k-distance(b), d(a, b))
     *    lrd_k(a)           = 1 / mean_{b in N_k(a)} reach-dist_k(a, b)
     *    LOF_k(a)           = mean_{b in N_k(a)} lrd_k(b) / lrd_k(a)
     *  ~1 means "as crowded as its neighbours"; >1 means locally sparse. */
    function _lof(tag, k) {
        const key = String(tag) + '|' + k;
        if (_lofCache[key]) return _lofCache[key];
        const nn = _nn(tag), n = nn.n, kk = k;
        const kdist = new Float64Array(n);
        for (let i = 0; i < n; i++) kdist[i] = nn.dist[i * nn.kk + (kk - 1)];
        const lrd = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            let s = 0;
            for (let m = 0; m < kk; m++) {
                const j = nn.idx[i * nn.kk + m];
                s += Math.max(kdist[j], nn.dist[i * nn.kk + m]);
            }
            lrd[i] = kk / (s || 1e-12);
        }
        const lof = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            let s = 0;
            for (let m = 0; m < kk; m++) s += lrd[nn.idx[i * nn.kk + m]];
            lof[i] = (s / kk) / (lrd[i] || 1e-12);
        }
        _lofCache[key] = lof;
        return lof;
    }

    function adLof(tag, i, k) {
        const nn = _nn(tag);
        const kk = _clampI(k, 2, nn.kk);
        return _lof(tag, kk)[_clampI(i, 0, nn.n - 1)];
    }

    const _covCache = Object.create(null);

    function _cov(tag) {
        const key = String(tag);
        if (_covCache[key]) return _covCache[key];
        const d = _ds(key), n = d.n;
        let mx = 0, my = 0;
        for (let i = 0; i < n; i++) { mx += d.x[i]; my += d.y[i]; }
        mx /= n; my /= n;
        let sxx = 0, sxy = 0, syy = 0;
        for (let i = 0; i < n; i++) {
            const a = d.x[i] - mx, b = d.y[i] - my;
            sxx += a * a; sxy += a * b; syy += b * b;
        }
        sxx /= (n - 1); sxy /= (n - 1); syy /= (n - 1);
        const det = sxx * syy - sxy * sxy;
        // Closed-form eigen-decomposition of a symmetric 2x2.
        const tr = sxx + syy;
        const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
        const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
        const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        const out = { mx, my, sxx, sxy, syy, det, l1, l2, angle };
        _covCache[key] = out;
        return out;
    }

    /** Mahalanobis distance of point i from the sample mean, sqrt form. */
    function adMahal(tag, i) {
        const d = _ds(tag), c = _cov(tag);
        const ii = _clampI(i, 0, d.n - 1);
        const a = d.x[ii] - c.mx, b = d.y[ii] - c.my;
        const inv = 1 / (c.det || 1e-12);
        const q = inv * (c.syy * a * a - 2 * c.sxy * a * b + c.sxx * b * b);
        return Math.sqrt(Math.max(0, q));
    }

    /** Plain Euclidean distance from the mean — the thing Mahalanobis fixes. */
    function adEuclid(tag, i) {
        const d = _ds(tag), c = _cov(tag);
        const ii = _clampI(i, 0, d.n - 1);
        const a = d.x[ii] - c.mx, b = d.y[ii] - c.my;
        return Math.sqrt(a * a + b * b);
    }

    /** The covariance ellipse, for drawing. which: 0 angle (radians),
     *  1 semi-axis along the major direction, 2 semi-minor, 3 mean x,
     *  4 mean y. `s` scales both axes (s = 2 is the 2-sigma contour). */
    function adCovEig(tag, which, s) {
        const c = _cov(tag), ss = _num(s, 1);
        switch (_clampI(which, 0, 4)) {
            case 0: return c.angle;
            case 1: return ss * Math.sqrt(Math.max(0, c.l1));
            case 2: return ss * Math.sqrt(Math.max(0, c.l2));
            case 3: return c.mx;
            default: return c.my;
        }
    }

    /** A point on the s-sigma covariance ellipse at parameter theta — the
     *  form an animated_polygon's vertices want. axis 0 = x, 1 = y. */
    function adEllipse(tag, theta, s, axis) {
        const c = _cov(tag), ss = _num(s, 2), th = _num(theta, 0);
        const a = ss * Math.sqrt(Math.max(0, c.l1)), b = ss * Math.sqrt(Math.max(0, c.l2));
        const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
        const px = a * Math.cos(th), py = b * Math.sin(th);
        return _clampI(axis, 0, 1) === 0 ? c.mx + ca * px - sa * py : c.my + sa * px + ca * py;
    }

    /** Distance concentration -- the curse of dimensionality, measured rather
     *  than asserted. For each dimension d, 120 points are drawn uniformly in
     *  the unit cube and, from each one, the nearest and farthest of the
     *  others are found. The RELATIVE CONTRAST (dmax - dmin) / dmin is the
     *  quantity every distance-based detector depends on: when it collapses
     *  toward 0, "far from its neighbours" stops meaning anything, because
     *  every point is about equally far from every other.
     *  which: 0 relative contrast, 1 mean nearest distance, 2 mean farthest. */
    const CONC_N = 120;
    const CONC_MAX_D = 64;
    const _concCache = Object.create(null);

    function _conc(d) {
        const dd = _clampI(d, 1, CONC_MAX_D);
        if (_concCache[dd]) return _concCache[dd];
        const rng = _splitmix32(_seedOf('conc|' + dd));
        const p = new Float64Array(CONC_N * dd);
        for (let i = 0; i < CONC_N * dd; i++) p[i] = rng();
        let contrast = 0, near = 0, far = 0;
        for (let i = 0; i < CONC_N; i++) {
            let lo = Infinity, hi = 0;
            for (let j = 0; j < CONC_N; j++) {
                if (j === i) continue;
                let acc = 0;
                for (let k = 0; k < dd; k++) {
                    const t = p[i * dd + k] - p[j * dd + k];
                    acc += t * t;
                }
                const r = Math.sqrt(acc);
                if (r < lo) lo = r;
                if (r > hi) hi = r;
            }
            contrast += (hi - lo) / (lo || 1e-12);
            near += lo; far += hi;
        }
        const out = { contrast: contrast / CONC_N, near: near / CONC_N, far: far / CONC_N };
        _concCache[dd] = out;
        return out;
    }

    function adConc(d, which) {
        const c = _conc(d);
        switch (_clampI(which, 0, 2)) {
            case 0: return c.contrast;
            case 1: return c.near;
            default: return c.far;
        }
    }

    // ---- scene 4: isolation, and a one-class boundary ---------------------

    /** Expected path length of an unsuccessful search in a BST of n nodes:
     *  c(n) = 2 H(n-1) - 2(n-1)/n. The harmonic number is summed EXACTLY,
     *  not replaced by ln(m) + gamma: depth-capped trees produce small leaves
     *  constantly, and the asymptotic is 27.6% low at n = 3 and 14.5% low at
     *  n = 4, which is precisely where it gets used most. It agrees to 0.1%
     *  by n = 128, so the cost of being exact is a memoised prefix sum.
     *  Above HARMONIC_MAX the asymptotic is accurate to ~1e-13 and is used
     *  so a stray huge argument cannot spin. */
    const EULER = 0.5772156649015329;
    const HARMONIC_MAX = 100000;
    const _harmonic = [0, 1];     // _harmonic[m] = H(m)
    function _H(m) {
        if (m > HARMONIC_MAX) return Math.log(m) + EULER + 1 / (2 * m);
        for (let j = _harmonic.length; j <= m; j++) _harmonic[j] = _harmonic[j - 1] + 1 / j;
        return _harmonic[m];
    }
    function adCPath(n) {
        const nn = Math.max(1, Math.round(_num(n, 2)));
        if (nn <= 1) return 0;
        if (nn === 2) return 1;
        return 2 * _H(nn - 1) - 2 * (nn - 1) / nn;
    }

    const ISO_TREES = 100;
    const ISO_PSI = 128;          // subsample size per tree, Liu et al.'s 256 halved for speed
    const _isoCache = Object.create(null);

    /** An Isolation Forest, built for real: ISO_TREES trees, each on a
     *  subsample of ISO_PSI points, each node splitting on a random axis at
     *  a uniform point in that axis's observed range, to depth ceil(log2 psi).
     *  A node that runs out of depth or points contributes c(size) for the
     *  subtree it did not build — exactly Liu's estimator. */
    function _iso(tag) {
        const key = String(tag);
        if (_isoCache[key]) return _isoCache[key];
        const d = _ds(key), n = d.n;
        const psi = Math.min(ISO_PSI, n);
        const limit = Math.ceil(Math.log2(Math.max(2, psi)));
        const rng = _splitmix32(_seedOf(key + '|iso'));
        const trees = [];
        const sample = new Int32Array(psi);

        for (let t = 0; t < ISO_TREES; t++) {
            // Partial Fisher-Yates over an index array: a subsample without
            // replacement, which is what the algorithm specifies.
            const pool = new Int32Array(n);
            for (let i = 0; i < n; i++) pool[i] = i;
            for (let i = 0; i < psi; i++) {
                const j = i + Math.floor(rng() * (n - i));
                const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
                sample[i] = pool[i];
            }
            trees.push(_iTree(d, Array.from(sample), 0, limit, rng));
        }
        const out = { trees, psi, limit, c: adCPath(psi) };
        _isoCache[key] = out;
        return out;
    }

    function _iTree(d, ids, depth, limit, rng) {
        if (depth >= limit || ids.length <= 1) return { leaf: true, size: ids.length };
        const axis = rng() < 0.5 ? 0 : 1;
        const arr = axis === 0 ? d.x : d.y;
        let lo = Infinity, hi = -Infinity;
        for (let m = 0; m < ids.length; m++) {
            const v = arr[ids[m]];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        if (!(hi > lo)) return { leaf: true, size: ids.length };
        const split = lo + rng() * (hi - lo);
        const L = [], R = [];
        for (let m = 0; m < ids.length; m++) (arr[ids[m]] < split ? L : R).push(ids[m]);
        // Degenerate-split guard, and it is NOT the "a split landed in a gap"
        // case: with split in (lo, hi] the value at lo always falls left and
        // the value at hi always falls right, so a gap split partitions fine.
        // Verified -- values {0,10,20,30}, where EVERY split lands in a gap,
        // gave 0 empty sides in 500k draws, as did 200k random point sets.
        // The only way here is split === lo, i.e. rng() returning exactly 0,
        // where Liu's recursion would otherwise recurse on the same set
        // forever. A leaf is the correct terminal for that.
        if (L.length === 0 || R.length === 0) return { leaf: true, size: ids.length };
        return { leaf: false, axis, split, L: _iTree(d, L, depth + 1, limit, rng), R: _iTree(d, R, depth + 1, limit, rng) };
    }

    function _pathLen(node, px, py, depth) {
        while (!node.leaf) {
            const v = node.axis === 0 ? px : py;
            node = v < node.split ? node.L : node.R;
            depth++;
        }
        return depth + adCPath(node.size);
    }

    // A heatmap asks for the same few hundred grid points on every frame, and
    // each one walks 100 trees, so memoise. The key is the exact coordinate
    // pair, not a rounded one: a tree is discontinuous at every split plane,
    // so two points a ten-thousandth apart can sit either side of one and
    // must not share an answer. The repeated grid queries still hit exactly.
    // The map is cleared wholesale when it grows past a screenful so a
    // sweeping query cannot leak.
    const _depthMemo = new Map();
    const DEPTH_MEMO_MAX = 4096;

    /** Mean path length over the forest for an arbitrary point. */
    function adIsoDepth(tag, px, py) {
        const x = _num(px, 0), y = _num(py, 0);
        const key = tag + '|' + x + '|' + y;
        const hit = _depthMemo.get(key);
        if (hit !== undefined) return hit;
        const f = _iso(tag);
        let s = 0;
        for (let t = 0; t < f.trees.length; t++) s += _pathLen(f.trees[t], x, y, 0);
        const v = s / f.trees.length;
        if (_depthMemo.size >= DEPTH_MEMO_MAX) _depthMemo.clear();
        _depthMemo.set(key, v);
        return v;
    }

    /** The Isolation Forest score s(x) = 2^(-E[h(x)] / c(psi)). Near 1 means
     *  isolated in very few splits; near 0.5 means an ordinary point. */
    function adIsoGrid(tag, px, py) {
        const f = _iso(tag);
        return Math.pow(2, -adIsoDepth(tag, px, py) / (f.c || 1));
    }

    function adIso(tag, i) {
        const d = _ds(tag), ii = _clampI(i, 0, d.n - 1);
        return adIsoGrid(tag, d.x[ii], d.y[ii]);
    }

    /** Gaussian-kernel density score, sum_j exp(-gamma ||x - x_j||^2) / n.
     *  The One-Class SVM's decision function is the same object approximated
     *  with a sparse set of support vectors; here every point is a support
     *  vector, which is the honest full-rank version of the same boundary. */
    function adKde(tag, px, py, gamma) {
        const d = _ds(tag), n = d.n, g = Math.max(1e-6, _num(gamma, 0.5));
        const x = _num(px, 0), y = _num(py, 0);
        let s = 0;
        for (let j = 0; j < n; j++) {
            const a = x - d.x[j], b = y - d.y[j];
            s += Math.exp(-g * (a * a + b * b));
        }
        return s / n;
    }

    // Keyed on the exact gamma, not a rounded one: these functions are
    // documented as pure in their explicit arguments, and rounding made
    // gamma = 0.5 and gamma = 0.5000004 share an answer. Rounding was also
    // what bounded the key count, so the cap below takes over that job --
    // same wholesale clear as the isolation memo, so dragging a slider
    // cannot leak.
    const KDE_CACHE_MAX = 64;
    let _kdeScoreCache = new Map();

    /** Every training point's own density, computed once per (tag, gamma).
     *  A scene colours 200 points by whether they are inside the boundary on
     *  every frame; without this that is 40,000 exponentials per frame for a
     *  quantity that only changes when gamma does. */
    function _kdeScores(tag, gamma) {
        const key = String(tag) + '|' + gamma;
        let c = _kdeScoreCache.get(key);
        if (c) return c;
        const d = _ds(tag), n = d.n;
        const raw = new Float64Array(n);
        for (let i = 0; i < n; i++) raw[i] = adKde(tag, d.x[i], d.y[i], gamma);
        const sorted = Float64Array.from(raw).sort();
        c = { raw, sorted };
        if (_kdeScoreCache.size >= KDE_CACHE_MAX) _kdeScoreCache.clear();
        _kdeScoreCache.set(key, c);
        return c;
    }

    /** The density at training point i. */
    function adKdeScore(tag, i, gamma) {
        const d = _ds(tag);
        return _kdeScores(tag, Math.max(1e-6, _num(gamma, 0.5))).raw[_clampI(i, 0, d.n - 1)];
    }

    /** The nu-quantile of the training points' own density scores. This is an
     *  interpolated empirical quantile and the membership test keeps ties
     *  (>=), so declaring everything below it an outlier rejects APPROXIMATELY
     *  nu of them -- nu = 0.1 rejects 0.101 of 'ring'. That is an operational
     *  analogue of a nu-SVM's nu, not the same guarantee: there nu bounds the
     *  training-error fraction above and the support-vector fraction below,
     *  and this is a full-rank kernel density rather than an SVM. */
    function adKdeQ(tag, nu, gamma) {
        const g = Math.max(1e-6, _num(gamma, 0.5));
        const nuv = Math.min(0.9, Math.max(0.001, _num(nu, 0.1)));
        return _quantSorted(_kdeScores(tag, g).sorted, nuv);
    }

    /** 1 when training point i is INSIDE the one-class boundary. */
    function adKdeIn(tag, i, nu, gamma) {
        const g = Math.max(1e-6, _num(gamma, 0.5));
        return adKdeScore(tag, i, g) >= adKdeQ(tag, nu, g) ? 1 : 0;
    }

    // The boundary is traced once per (tag, nu, gamma) at BOUND_A angles and
    // read back by interpolation. Tracing costs about two million
    // exponentials; doing it per frame, per vertex, would not run.
    const BOUND_A = 128;
    // Exact key, for the same reason as the density cache, with a cap in
    // place of the rounding that used to bound it. A trace is ~70ms, so this
    // holds a slider's worth of them and no more.
    const BOUND_CACHE_MAX = 64;
    let _boundCache = new Map();

    function _boundary(tag, nu, gamma, rMax) {
        const g = Math.max(1e-6, _num(gamma, 0.5));
        const nuv = Math.min(0.9, Math.max(0.001, _num(nu, 0.1)));
        const R = _num(rMax, 8);
        const key = String(tag) + '|' + nuv + '|' + g + '|' + R;
        let b = _boundCache.get(key);
        if (b) return b;
        const thr = adKdeQ(tag, nuv, g);
        const outer = new Float64Array(BOUND_A + 1);
        const inner = new Float64Array(BOUND_A + 1);
        const STEPS = 48, BISECT = 30;
        for (let a = 0; a < BOUND_A; a++) {
            const th = 2 * Math.PI * a / BOUND_A;
            const ct = Math.cos(th), st = Math.sin(th);
            const f = r => adKde(tag, r * ct, r * st, g) - thr;
            // Scan outward once, recording the first crossing up (the inner
            // wall of an annulus) and the last crossing down (the outer wall).
            // This is deliberately a SINGLE-ANNULUS tracer: a ray through a
            // fragmented level set crosses more than twice, and the extra
            // crossings are dropped. Scene 4's large-gamma step says so rather
            // than pretending the drawn curve outlines the islands.
            let f0 = f(0);
            let inLo = -1, inHi = -1, outLo = -1, outHi = -1;
            let prevR = 0, prevF = f0;
            for (let sIdx = 1; sIdx <= STEPS; sIdx++) {
                const r = R * sIdx / STEPS, fr = f(r);
                if (prevF < 0 && fr >= 0 && inHi < 0) { inLo = prevR; inHi = r; }
                if (prevF >= 0 && fr < 0) { outLo = prevR; outHi = r; }
                prevR = r; prevF = fr;
            }
            const refine = (lo, hi, wantPos) => {
                for (let it = 0; it < BISECT; it++) {
                    const mid = 0.5 * (lo + hi);
                    if ((f(mid) >= 0) === wantPos) hi = mid; else lo = mid;
                }
                return 0.5 * (lo + hi);
            };
            inner[a] = f0 >= 0 ? 0 : (inHi < 0 ? R : refine(inLo, inHi, true));
            outer[a] = outHi < 0 ? R : refine(outHi, outLo, true);
        }
        inner[BOUND_A] = inner[0];
        outer[BOUND_A] = outer[0];
        b = { inner, outer };
        if (_boundCache.size >= BOUND_CACHE_MAX) _boundCache.clear();
        _boundCache.set(key, b);
        return b;
    }

    function _readWall(arr, theta) {
        const TAU = 2 * Math.PI;
        let th = _num(theta, 0) % TAU;
        if (th < 0) th += TAU;
        const pos = th / TAU * BOUND_A;
        const lo = Math.floor(pos);
        const frac = pos - lo;
        return arr[lo] + frac * (arr[lo + 1] - arr[lo]);
    }

    /** Radius of the OUTER boundary crossing along the ray at angle theta. */
    function adKdeR(tag, theta, nu, gamma, rMax) {
        return _readWall(_boundary(tag, nu, gamma, rMax).outer, theta);
    }

    /** Radius of the INNER crossing — the hole of an annulus. 0 when the
     *  centre is already inside, which is the right answer for a blob. */
    function adKdeRin(tag, theta, nu, gamma, rMax) {
        return _readWall(_boundary(tag, nu, gamma, rMax).inner, theta);
    }

    /** x or y of the boundary point at angle theta. axis 0 = x, 1 = y.
     *  wall 0 = outer, 1 = inner. */
    function adKdeB(tag, theta, nu, gamma, axis, wall) {
        const th = _num(theta, 0);
        const r = _clampI(wall, 0, 1) === 1
            ? adKdeRin(tag, th, nu, gamma, 8)
            : adKdeR(tag, th, nu, gamma, 8);
        return _clampI(axis, 0, 1) === 0 ? r * Math.cos(th) : r * Math.sin(th);
    }

    // ---- scene 5: reconstruction ------------------------------------------

    const SIG_N = 128;
    const _sigCache = Object.create(null);

    /** A daily-seasonal signal with noise and one planted collective anomaly:
     *  a 9-sample stretch where the level shifts. Each individual sample stays
     *  inside the global range, so a z-score never sees it — only a model of
     *  the STRUCTURE does. */
    function _sig() {
        if (_sigCache.v) return _sigCache;
        const rng = _splitmix32(_seedOf('signal'));
        const g = _gauss(rng);
        const v = new Float64Array(SIG_N);
        const lab = new Uint8Array(SIG_N);
        for (let i = 0; i < SIG_N; i++) {
            // Fourier modes 2 and 3 of the window, so rank 1 is visibly too
            // little capacity, rank 3 is exactly enough, and everything above
            // is the model learning the noise -- and then the anomaly.
            const t = 2 * Math.PI * i / SIG_N;
            v[i] = 10 + 3 * Math.sin(2 * t) + 1.2 * Math.sin(3 * t + 0.7) + 0.35 * g();
        }
        for (let i = 74; i < 83; i++) {
            // Flatten the seasonal shape: the values stay in range, the
            // PATTERN breaks. That is a collective anomaly.
            v[i] = 11.4 + 0.35 * g();
            lab[i] = 1;
        }
        _sigCache.v = v; _sigCache.lab = lab;
        return _sigCache;
    }

    function adSigN() { return SIG_N; }
    function adSig(i) { return _sig().v[_clampI(i, 0, SIG_N - 1)]; }
    function adSigLabel(i) { return _sig().lab[_clampI(i, 0, SIG_N - 1)]; }

    const _reconCache = Object.create(null);

    /** Rank-r reconstruction by keeping the r lowest Fourier modes — the
     *  linear autoencoder of a periodic signal, and a true bottleneck: the
     *  model can only express what r modes can express. Raise r far enough
     *  and it reconstructs the anomaly too, which is the failure mode every
     *  autoencoder detector has. */
    function _recon(r) {
        const rr = _clampI(r, 1, 32);
        if (_reconCache[rr]) return _reconCache[rr];
        const v = _sig().v;
        const out = new Float64Array(SIG_N);
        // Mean term.
        let m = 0;
        for (let i = 0; i < SIG_N; i++) m += v[i];
        m /= SIG_N;
        for (let i = 0; i < SIG_N; i++) out[i] = m;
        for (let k = 1; k <= rr; k++) {
            let a = 0, b = 0;
            for (let i = 0; i < SIG_N; i++) {
                const w = 2 * Math.PI * k * i / SIG_N;
                a += v[i] * Math.cos(w); b += v[i] * Math.sin(w);
            }
            a *= 2 / SIG_N; b *= 2 / SIG_N;
            for (let i = 0; i < SIG_N; i++) {
                const w = 2 * Math.PI * k * i / SIG_N;
                out[i] += a * Math.cos(w) + b * Math.sin(w);
            }
        }
        _reconCache[rr] = out;
        return out;
    }

    function adRecon(i, r) { return _recon(r)[_clampI(i, 0, SIG_N - 1)]; }
    function adResid(i, r) {
        const ii = _clampI(i, 0, SIG_N - 1);
        return Math.abs(_sig().v[ii] - _recon(r)[ii]);
    }
    /** Root-mean-square reconstruction error over the whole signal — the
     *  number that falls as r rises, and the reason "more capacity" is not
     *  automatically "better detector". */
    function adReconRmse(r) {
        const v = _sig().v, u = _recon(r);
        let s = 0;
        for (let i = 0; i < SIG_N; i++) { const d = v[i] - u[i]; s += d * d; }
        return Math.sqrt(s / SIG_N);
    }
    /** RMSE restricted to the planted anomaly window. When this falls as fast
     *  as adReconRmse, the model has learned to reconstruct the anomaly and
     *  the detector is dead. */
    function adReconRmseAnom(r) {
        const v = _sig().v, u = _recon(r), lab = _sig().lab;
        let s = 0, m = 0;
        for (let i = 0; i < SIG_N; i++) if (lab[i]) { const d = v[i] - u[i]; s += d * d; m++; }
        return m ? Math.sqrt(s / m) : 0;
    }

    /** Rank-1 PCA reconstruction error of a 2-D cloud: the distance from the
     *  first principal axis. The linear ancestor of every deep reconstruction
     *  detector, and computable in closed form from the covariance. */
    function adPcaErr(tag, i) {
        const d = _ds(tag), c = _cov(tag), ii = _clampI(i, 0, d.n - 1);
        const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
        const a = d.x[ii] - c.mx, b = d.y[ii] - c.my;
        return Math.abs(-sa * a + ca * b);   // component across the major axis
    }

    /** The same error as a surface over the plane — the "reconstruction-error
     *  landscape" a deep model learns a curved version of. */
    function adPcaSurf(tag, px, py) {
        const c = _cov(tag);
        const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
        const a = _num(px, 0) - c.mx, b = _num(py, 0) - c.my;
        const e = -sa * a + ca * b;
        return e * e;
    }

    // ---- scene 6: evaluating a detector -----------------------------------

    const EVAL_N = 400;
    const _evalCache = Object.create(null);

    /** A scored, labelled dataset: 8% anomalous. Normal scores ~ Beta-ish via
     *  a clipped normal at 0.30 sd 0.11; anomalous at 0.62 sd 0.16. The two
     *  overlap, because every real detector's do. */
    function _eval() {
        if (_evalCache.s) return _evalCache;
        const rng = _splitmix32(_seedOf('eval'));
        const g = _gauss(rng);
        const s = new Float64Array(EVAL_N);
        const lab = new Uint8Array(EVAL_N);
        const nAnom = Math.round(EVAL_N * 0.08);
        for (let i = 0; i < EVAL_N; i++) {
            const anom = i < nAnom;
            lab[i] = anom ? 1 : 0;
            const v = anom ? 0.62 + 0.16 * g() : 0.30 + 0.11 * g();
            s[i] = Math.min(1, Math.max(0, v));
        }
        // Sort descending by score once: every sweep below is then a prefix.
        const order = Array.from({ length: EVAL_N }, (_, i) => i).sort((a, b) => s[b] - s[a]);
        const ss = Float64Array.from(order, i => s[i]);
        const ll = Uint8Array.from(order, i => lab[i]);
        let P = 0;
        for (let i = 0; i < EVAL_N; i++) P += ll[i];
        _evalCache.s = ss; _evalCache.lab = ll; _evalCache.P = P; _evalCache.N = EVAL_N - P;
        return _evalCache;
    }

    function adEvalN() { return EVAL_N; }
    function adScore(i) { return _eval().s[_clampI(i, 0, EVAL_N - 1)]; }
    function adEvalLabel(i) { return _eval().lab[_clampI(i, 0, EVAL_N - 1)]; }

    /** Confusion counts at threshold t (flag when score >= t).
     *  cell: 0 TP, 1 FP, 2 FN, 3 TN. */
    function adConf(t, cell) {
        const e = _eval(), th = _num(t, 0.5);
        let tp = 0, fp = 0;
        for (let i = 0; i < EVAL_N; i++) {
            if (e.s[i] < th) break;          // sorted descending
            if (e.lab[i]) tp++; else fp++;
        }
        switch (_clampI(cell, 0, 3)) {
            case 0: return tp;
            case 1: return fp;
            case 2: return e.P - tp;
            default: return e.N - fp;
        }
    }

    function adTpr(t) { const e = _eval(); return adConf(t, 0) / (e.P || 1); }
    function adFpr(t) { const e = _eval(); return adConf(t, 1) / (e.N || 1); }
    function adRec(t) { return adTpr(t); }
    function adPrec(t) {
        const tp = adConf(t, 0), fp = adConf(t, 1);
        return (tp + fp) > 0 ? tp / (tp + fp) : 1;
    }
    function adAcc(t) {
        return (adConf(t, 0) + adConf(t, 3)) / EVAL_N;
    }
    function adFlagged(t) { return adConf(t, 0) + adConf(t, 1); }

    /** Precision at the top k scores — what an alert budget actually buys. */
    function adPrecAtK(k) {
        const e = _eval(), kk = _clampI(k, 1, EVAL_N);
        let tp = 0;
        for (let i = 0; i < kk; i++) tp += e.lab[i];
        return tp / kk;
    }

    /** The ROC and PR curves, swept by rank rather than by threshold so the
     *  i-th sample of a chart series is a real operating point. */
    function _rankT(i, n) {
        const e = _eval();
        const nn = Math.max(2, Math.round(_num(n, 64)));
        const r = _clampI(Math.round(_num(i, 0) * (EVAL_N - 1) / (nn - 1)), 0, EVAL_N - 1);
        return e.s[r];
    }
    function adRocX(i, n) { return adFpr(_rankT(i, n)); }
    function adRocY(i, n) { return adTpr(_rankT(i, n)); }
    function adPrX(i, n) { return adRec(_rankT(i, n)); }
    function adPrY(i, n) { return adPrec(_rankT(i, n)); }

    // ---- scene 5: the no-free-lunch matrix ---------------------------------

    /** The five 2-D scorers, in the order scene 5's matrix draws them, each
     *  paired with the SIGN that makes "larger = more anomalous" true. Kernel
     *  density is the odd one out: a low density is the suspicious case. */
    const NFL_DETS = [
        ['isolation',      (t, i) => adIso(t, i),            +1],
        ['LOF',            (t, i) => adLof(t, i, 20),        +1],
        ['kNN distance',   (t, i) => adKnn(t, i, 20),        +1],
        ['kernel density', (t, i) => adKdeScore(t, i, 0.5),  -1],
        ['Mahalanobis',    (t, i) => adMahal(t, i),          +1],
    ];
    // Ordered by WHAT THEY BREAK, left to right: one convex cloud (nothing
    // breaks), two densities (any global radius breaks), a hole (anything
    // convex or centroid-based breaks). The matrix reads as a difficulty axis.
    const NFL_TAGS = ['blob', 'dense', 'ring'];
    const _nflCache = Object.create(null);

    /** AUC-ROC of detector `det` on dataset `tag`, by the Mann-Whitney identity:
     *  the probability that a random planted point outranks a random normal one,
     *  with ties counting a half. Computed here rather than pinned into the
     *  scene so the matrix cannot drift from the detectors it claims to score.
     *  O(P*N) per cell, cached per (tag, det) -- the whole 5x3 matrix is 15
     *  cells built once, not per frame. */
    function adDetAuc(tagIdx, detIdx) {
        const ti = _clampI(tagIdx, 0, NFL_TAGS.length - 1);
        const di = _clampI(detIdx, 0, NFL_DETS.length - 1);
        const key = ti + '|' + di;
        const hit = _nflCache[key];
        if (hit !== undefined) return hit;
        const tag = NFL_TAGS[ti], [, f, sign] = NFL_DETS[di];
        const d = _ds(tag), n = d.n;
        const pos = [], neg = [];
        for (let i = 0; i < n; i++) (d.lab[i] ? pos : neg).push(sign * f(tag, i));
        let win = 0;
        for (let a = 0; a < pos.length; a++)
            for (let b = 0; b < neg.length; b++)
                win += pos[a] > neg[b] ? 1 : (pos[a] === neg[b] ? 0.5 : 0);
        const v = (pos.length && neg.length) ? win / (pos.length * neg.length) : 0;
        _nflCache[key] = v;
        return v;
    }

    /** Areas, by the trapezoid rule over every distinct operating point. */
    function adAucRoc() {
        const e = _eval();
        let tp = 0, fp = 0, area = 0, pFpr = 0, pTpr = 0;
        for (let i = 0; i < EVAL_N; i++) {
            if (e.lab[i]) tp++; else fp++;
            const x = fp / (e.N || 1), y = tp / (e.P || 1);
            area += (x - pFpr) * (y + pTpr) / 2;
            pFpr = x; pTpr = y;
        }
        return area;
    }
    /** Average precision — the PR-curve summary that does not flatter a
     *  detector on an imbalanced set the way ROC-AUC does. */
    function adAucPr() {
        const e = _eval();
        let tp = 0, ap = 0, pRec = 0;
        for (let i = 0; i < EVAL_N; i++) {
            if (e.lab[i]) tp++;
            const rec = tp / (e.P || 1), prec = tp / (i + 1);
            ap += (rec - pRec) * prec;
            pRec = rec;
        }
        return ap;
    }

    /** The base-rate identity, pure in its arguments:
     *      precision = TPR pi / (TPR pi + FPR (1 - pi))
     *  Hold TPR and FPR fixed, slide pi, and watch a detector that looks
     *  excellent at pi = 0.08 become useless at pi = 0.001. ROC-AUC does not
     *  move at all, which is the whole complaint against it. */
    function adPrecBayes(tpr, fpr, pi) {
        const a = _num(tpr, 0) * _num(pi, 0);
        const b = _num(fpr, 0) * (1 - _num(pi, 0));
        return (a + b) > 0 ? a / (a + b) : 0;
    }

    /** Expected false alarms per period at a given base rate and volume —
     *  the number that decides whether anyone keeps the pager on. */
    function adFalseAlarms(fpr, pi, volume) {
        return _num(fpr, 0) * (1 - _num(pi, 0)) * _num(volume, 0);
    }

    window.AlgeBenchDomains.register('anomaly', {
        // data access
        adN, adX, adY, adLabel,
        // the 1-D metric and its robust statistics
        adMetricN, adV, adPlanted, adMeanV, adStdV, adMedV, adMadV, adSigmaHat, adQ1, adQ3, adIqr,
        adZv, adModZv, adFenceZ, adFenceM, adFenceT, adCountZ, adCountM, adCountT, adGrubbs,
        // distance and density
        adKnn, adKnnMean, adLof, adMahal, adEuclid, adCovEig, adEllipse, adConc,
        // isolation and one-class
        adDetAuc,
        adCPath, adIsoDepth, adIsoGrid, adIso, adKde, adKdeScore, adKdeQ, adKdeIn, adKdeR, adKdeRin, adKdeB,
        // reconstruction
        adSigN, adSig, adSigLabel, adRecon, adResid, adReconRmse, adReconRmseAnom,
        adPcaErr, adPcaSurf,
        // evaluation
        adEvalN, adScore, adEvalLabel, adConf, adTpr, adFpr, adRec, adPrec, adAcc,
        adFlagged, adPrecAtK, adRocX, adRocY, adPrX, adPrY, adAucRoc, adAucPr,
        adPrecBayes, adFalseAlarms,
    });

})();
