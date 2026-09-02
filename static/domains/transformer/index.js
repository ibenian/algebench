/**
 * AlgeBench Domain Library — Transformer
 *
 * One fixed six-token forward pass: "the cat sat on the mat",
 * d_model = 4, n_heads = 2, d_k = 2, one head shown, causal.
 *
 * Registers tfPerm, tfEmb, tfPE, tfX, tfOutNoPos, tfQ, tfK, tfV, tfQProbe,
 * tfScore, tfScoreScaled, tfScoreDiv, tfMaskVal, tfAttn, tfRowSum, tfOut,
 * tfRopeQ, tfRopeK, tfRopeDot, tfRopeEmb, tfRopeEmbTheta, tfRopeEmbDot, tfRopeEmbArc,
 * tfRopeEmbNorm, tfRopeEmbAngle,
 * tfDotSample, tfDotSampleScaled, tfSampleVar
 * into the AlgeBench expression sandbox.
 *
 * THE WEIGHTS BELOW ARE HAND-CONSTRUCTED FOR LEGIBILITY, NOT LEARNED.
 * They are chosen so one head shows a clean subject-verb dependency
 * ("sat" attends 97.09% to "cat"). The lesson must say so on screen; a
 * lesson advertising rigour while showing invented attention patterns is
 * dishonest exactly where it claims to be honest.
 *
 * Every constant here is duplicated in the lesson's `data` block. They must
 * not drift: scripts/check_transformer_domain.py asserts they agree.
 *
 * Slider values are injected via _init({ getSlider }) called by expr.js on import.
 */
(function () {

    let _getSlider = (id, fallback = 0) => fallback; // replaced by _init

    // ---- fixed model constants -------------------------------------------

    const N = 6;            // tokens
    const D_MODEL = 4;
    const D_K = 2;          // per-head; deliberately != D_MODEL (design doc §3)
    const SQRT_DK = Math.sqrt(D_K);

    // Token embedding table, hand-picked. Rows are looked up per token.
    // Note "the" appears at slots 0 and 4 and gets the IDENTICAL row — the
    // two only separate once positional encoding is added.
    const EMB = [
        [1, 0, 0, 0],        // the
        [0, 1, 0, 0],        // cat
        [0, 0, 1, 0],        // sat
        [0, 0, 0, 1],        // on
        [1, 0, 0, 0],        // the
        [0.5, 0.5, 0, 0.5],  // mat
    ];

    // Per-head projections, row-vector convention: q = x W_Q.
    // Under that convention the ROWS are the images of the input basis
    // directions, so W_Q visibly reads input dims 2 and 3 while W_K reads
    // dims 1 and 3 and W_V reads dims 0 and 1 — three different readings of
    // one vector, which is the misconception scene 2 kills.
    const W_Q = [[0, 0], [0, 0], [3, 0], [0, 1]];
    const W_K = [[0, 0], [3, 0], [0, 0], [0, 1]];
    const W_V = [[1, 0], [0, 1], [0, 0], [0, 0]];

    // The shuffle used by the permutation-equivariance beat.
    const PERM = [5, 0, 3, 2, 1, 4];

    // Standalone RoPE demo vectors (scene 2). theta is 1.0 rad/position —
    // illustrative, not the paper's base-10000 schedule, which is invisible
    // at d_k = 2. The lesson says so.
    const ROPE_Q = [0.6, -1.3];
    const ROPE_K = [-0.9, 0.4];
    const ROPE_THETA = 1.0;

    const MASK_NEG = -1e9;  // stands in for -Infinity; see tfAttn

    // ---- small linear algebra --------------------------------------------

    /** Sinusoidal positional encoding for POSITION pos. Never shuffles. */
    function _pe(pos, d) {
        const pair = Math.floor(d / 2);
        const denom = Math.pow(10000, (2 * pair) / D_MODEL);
        const angle = pos / denom;
        return (d % 2 === 0) ? Math.sin(angle) : Math.cos(angle);
    }

    /** x (n x 4) times W (4 x 2) -> n x 2, flat row-major. */
    function _project(x, W) {
        const out = new Float64Array(N * D_K);
        for (let i = 0; i < N; i++) {
            for (let d = 0; d < D_K; d++) {
                let acc = 0;
                for (let c = 0; c < D_MODEL; c++) acc += x[i * D_MODEL + c] * W[c][d];
                out[i * D_K + d] = acc;
            }
        }
        return out;
    }

    /** Softmax of a plain array, max-subtracted (proof 5 is why that is legal). */
    function _softmax(z) {
        let m = -Infinity;
        for (const v of z) if (v > m) m = v;
        const e = z.map(v => Math.exp(v - m));
        let t = 0;
        for (const v of e) t += v;
        return e.map(v => v / t);
    }

    function _rot(v, angle) {
        const c = Math.cos(angle), s = Math.sin(angle);
        return [c * v[0] - s * v[1], s * v[0] + c * v[1]];
    }

    // ---- the toy forward pass, cached ------------------------------------

    const _KEY_SLIDERS = [
        's1_shuffle', 's1_pe', 's2_rope', 's2_m', 's2_n',
        's3_qi', 's3_scale', 's3_mask', 's3_maskafter',
    ];

    let _cache = { key: null, data: null };

    function _buildKey() {
        const parts = [];
        for (const id of _KEY_SLIDERS) parts.push(id + ':' + _getSlider(id, 0));
        return parts.join('|');
    }

    function _build() {
        const shuffle = _getSlider('s1_shuffle', 0) >= 0.5 ? 1 : 0;
        const peOn = _getSlider('s1_pe', 1);
        const ropeOn = _getSlider('s2_rope', 0) >= 0.5 ? 1 : 0;
        const scale = _getSlider('s3_scale', 1);
        const maskOn = _getSlider('s3_mask', 1) >= 0.5 ? 1 : 0;
        const maskAfter = _getSlider('s3_maskafter', 0) >= 0.5 ? 1 : 0;

        // Which source token sits at each slot.
        const perm = new Int32Array(N);
        for (let i = 0; i < N; i++) perm[i] = shuffle ? PERM[i] : i;

        // Raw embeddings at each slot (token travels), and x = emb + pe*PE
        // (position stays put — that asymmetry is the whole point).
        const emb = new Float64Array(N * D_MODEL);
        const x = new Float64Array(N * D_MODEL);
        for (let i = 0; i < N; i++) {
            for (let d = 0; d < D_MODEL; d++) {
                const e = EMB[perm[i]][d];
                emb[i * D_MODEL + d] = e;
                x[i * D_MODEL + d] = e + peOn * _pe(i, d);
            }
        }

        // Projections of the positioned input.
        const Q = _project(x, W_Q);
        const K = _project(x, W_K);
        const V = _project(x, W_V);   // V is NEVER rotated (contract item 7)

        if (ropeOn) {
            for (let i = 0; i < N; i++) {
                const rq = _rot([Q[i * D_K], Q[i * D_K + 1]], i * ROPE_THETA);
                const rk = _rot([K[i * D_K], K[i * D_K + 1]], i * ROPE_THETA);
                Q[i * D_K] = rq[0]; Q[i * D_K + 1] = rq[1];
                K[i * D_K] = rk[0]; K[i * D_K + 1] = rk[1];
            }
        }

        // Raw scores, and scores scaled by (sqrt d_k)^s3_scale.
        const S = new Float64Array(N * N);
        const Ss = new Float64Array(N * N);
        const div = Math.pow(SQRT_DK, scale);
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                let acc = 0;
                for (let d = 0; d < D_K; d++) acc += Q[i * D_K + d] * K[j * D_K + d];
                S[i * N + j] = acc;
                Ss[i * N + j] = acc / div;
            }
        }

        // Attention weights.
        //   maskAfter = 0 (CORRECT): additive -1e9 on the SCALED SCORES, then
        //     softmax. Rows sum to 1.000000.
        //   maskAfter = 1 (WRONG, for the misconception beat only): softmax
        //     over all six, THEN zero the future with no renormalization.
        //     Row 2 then sums to 0.98993, which is the visible failure.
        const A = new Float64Array(N * N);
        for (let i = 0; i < N; i++) {
            const row = [];
            for (let j = 0; j < N; j++) {
                const visible = !maskOn || j <= i;
                row.push(maskAfter ? Ss[i * N + j]
                                   : (visible ? Ss[i * N + j] : MASK_NEG));
            }
            let w = _softmax(row);
            if (maskAfter) {
                w = w.map((p, j) => (!maskOn || j <= i) ? p : 0);  // no renormalize
            }
            for (let j = 0; j < N; j++) A[i * N + j] = w[j];
        }

        // Output rows: convex combinations of the value rows.
        const O = new Float64Array(N * D_K);
        for (let i = 0; i < N; i++) {
            for (let d = 0; d < D_K; d++) {
                let acc = 0;
                for (let j = 0; j < N; j++) acc += A[i * N + j] * V[j * D_K + d];
                O[i * D_K + d] = acc;
            }
        }

        // The permutation-equivariance object: UNMASKED, POSITION-FREE
        // attention over the RAW EMBEDDINGS. Deliberately a separate pass —
        // reusing the masked one above would silently break the theorem,
        // because the mask is a second, independent reason equivariance fails.
        // It is still scaled dot-product attention, so it divides by sqrt(d_k).
        const Qn = _project(emb, W_Q);
        const Kn = _project(emb, W_K);
        const Vn = _project(emb, W_V);
        const On = new Float64Array(N * D_K);
        for (let i = 0; i < N; i++) {
            const row = [];
            for (let j = 0; j < N; j++) {
                let acc = 0;
                for (let d = 0; d < D_K; d++) acc += Qn[i * D_K + d] * Kn[j * D_K + d];
                row.push(acc / SQRT_DK);
            }
            const w = _softmax(row);
            for (let d = 0; d < D_K; d++) {
                let acc = 0;
                for (let j = 0; j < N; j++) acc += w[j] * Vn[j * D_K + d];
                On[i * D_K + d] = acc;
            }
        }

        return { perm, emb, x, Q, K, V, S, Ss, A, O, On };
    }

    function _st() {
        const key = _buildKey();
        if (_cache.key !== key) _cache = { key, data: _build() };
        return _cache.data;
    }

    // ---- the generic i.i.d. object (its OWN cache) -----------------------
    //
    // This has NOTHING to do with the toy model. The toy's Q and K are
    // hand-constructed and do not satisfy the i.i.d. zero-mean unit-variance
    // hypothesis, so they cannot demonstrate why sqrt(d_k) is the right
    // constant — only that scaling changes sharpness. This object can.

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

    /** Two independent standard normals from one uniform pair (Box-Muller). */
    function _normals(rng) {
        let u = rng(); if (u < 1e-12) u = 1e-12;
        const v = rng();
        const r = Math.sqrt(-2 * Math.log(u));
        return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
    }

    let _genCache = { key: null, dots: null };

    const GEN_SEED = 0x5eed1234;
    const GEN_COUNT = 4000;

    function _genDots(n) {
        const key = String(n);
        if (_genCache.key === key) return _genCache.dots;
        const dots = new Float64Array(GEN_COUNT);
        const rng = _splitmix32(GEN_SEED ^ Math.imul(n, 0x9e3779b1));
        for (let s = 0; s < GEN_COUNT; s++) {
            let acc = 0;
            let buf = [];
            for (let d = 0; d < n; d++) {
                if (buf.length < 2) buf = _normals(rng);
                const qd = buf.pop();
                if (buf.length < 2) buf = _normals(rng);
                const kd = buf.pop();
                acc += qd * kd;
            }
            dots[s] = acc;
        }
        _genCache = { key, dots };
        return dots;
    }

    // ---- exported functions ----------------------------------------------

    const _clampIdx = (v, hi) => {
        const i = Math.round(Number(v) || 0);
        return i < 0 ? 0 : (i > hi ? hi : i);
    };

    function tfPerm(k) { return _st().perm[_clampIdx(k, N - 1)]; }

    function tfEmb(i, d) { return _st().emb[_clampIdx(i, N - 1) * D_MODEL + _clampIdx(d, D_MODEL - 1)]; }

    /** Positional encoding at a CONTINUOUS position. Unlike every other index
     *  here, the position is NOT rounded to a slot and NOT clamped to N-1: PE
     *  is a smooth function of position, and a scene that sweeps a position
     *  control must see the circle traced out, not six snapped points. Integer
     *  slot arguments are unaffected. The component index d still clamps. */
    function tfPE(i, d) {
        const pos = Number(i);
        return _pe(Number.isFinite(pos) ? pos : 0, _clampIdx(d, D_MODEL - 1));
    }

    /** Illustrative per-pair rotation rates for tfRopeEmb, in radians per
     *  position. THESE ARE NOT THE REAL SCHEDULE. The real one is
     *  theta_i = 10000^(-2i/d_model), which at d_model = 4 gives 1.0 and 0.01:
     *  the second pair would move 0.06 rad over the whole six-token sentence,
     *  the trajectory would look like a single planar rotation, and a picture
     *  built on it would teach the exact misconception it exists to prevent.
     *  0.35 is slow enough to read as a different frequency and fast enough to
     *  see. Any scene using tfRopeEmb MUST label these as illustrative on
     *  screen and state the real schedule beside them. */
    const THETA_VIS = [1.0, 0.35];

    /** Component d of the RoPE-rotated EMBEDDING of the token at slot `slot`,
     *  placed at CONTINUOUS position p — a conceptual picture for scene 1, not
     *  the model's own arithmetic.
     *
     *  ACCURACY: real RoPE is applied to q and k AFTER the projections W_Q and
     *  W_K, never to the token embedding and never to v (accuracy-contract
     *  item 7). This function rotates an embedding only so a lesson can show
     *  the operation acting on a vector the student can already see; scene 2
     *  builds the real thing on q and k. A scene calling this must say so.
     *
     *  d_model = 4 gives exactly two dimension pairs, (0,1) and (2,3). Each is
     *  rotated INDEPENDENTLY, by p*THETA_VIS[0] and p*THETA_VIS[1] — that
     *  independence is the whole point: the result is not one rotation of one
     *  4-vector, and its projection into three coordinates does not close into
     *  a circle. A pair that is zero in the embedding stays zero, so a token
     *  with an empty pair rotates only in the plane of the other one.
     *  Both pair norms, and hence the full norm, are preserved for every p. */
    function tfRopeEmb(slot, d, p) {
        const i = _clampIdx(slot, N - 1);
        const c = _clampIdx(d, D_MODEL - 1);
        const pair = c >> 1;
        const pos = Number(p);
        const ang = (Number.isFinite(pos) ? pos : 0) * THETA_VIS[pair];
        const emb = _st().emb;
        const base = i * D_MODEL + (pair << 1);
        const a = emb[base], b = emb[base + 1];
        const ca = Math.cos(ang), sa = Math.sin(ang);
        return (c % 2 === 0) ? (a * ca - b * sa) : (a * sa + b * ca);
    }

    /** The illustrative rotation rate tfRopeEmb uses for dimension pair
     *  `pair` (0 or 1), so a scene can display the number it is actually
     *  drawing with rather than a hard-coded copy that can drift out of sync. */
    function tfRopeEmbTheta(pair) { return THETA_VIS[_clampIdx(pair, THETA_VIS.length - 1)]; }


    /** The full d_model-dimensional dot product of two RoPE'd embeddings:
     *  <RoPE(slotA at position pa), RoPE(slotB at position pb)>.
     *
     *  THE RELATIVE-POSITION IDENTITY, and the reason this function exists.
     *  Each dimension pair contributes <R_{pa.theta_i} a_i, R_{pb.theta_i} b_i>
     *  = a_i^T R_{(pb-pa).theta_i} b_i, because R is orthogonal and
     *  R_x^T R_y = R_{y-x}. Every term therefore depends on pb - pa ALONE, and
     *  so does their sum: shift both positions by the same amount and this
     *  number does not move. Verified to ~1e-16 by the domain check.
     *
     *  It is the FULL dot product, over all d_model coordinates. A scene that
     *  draws only three of them is showing a projection, and the projected
     *  vectors' own dot product is NOT in general invariant — it is only equal
     *  to this one when the dropped coordinate contributes nothing, e.g. when
     *  one of the two tokens is zero in that dimension pair. Do not quote this
     *  number beside a picture that disagrees with it without saying so. */
    function tfRopeEmbDot(slotA, pa, slotB, pb) {
        let acc = 0;
        for (let d = 0; d < D_MODEL; d++) {
            acc += tfRopeEmb(slotA, d, pa) * tfRopeEmb(slotB, d, pb);
        }
        return acc;
    }

    /** Euclidean norm of a RoPE-rotated embedding, |RoPE(slot at p)|.
     *
     *  It does not depend on p, and that is the point: a rotation is an
     *  isometry, so every dimension pair keeps its own norm and the whole
     *  vector keeps its length at every position. Exposed as a live quantity
     *  precisely so a lesson can show it NOT moving while the position does.
     *  Together with tfRopeEmbAngle it completes the identity
     *  <Q,K> = |Q| |K| cos(theta), which is why tfRopeEmbDot is invariant:
     *  all three factors on the right are fixed once the gap is fixed. */
    function tfRopeEmbNorm(slot, p) {
        let acc = 0;
        for (let d = 0; d < D_MODEL; d++) {
            const v = tfRopeEmb(slot, d, p);
            acc += v * v;
        }
        return Math.sqrt(acc);
    }

    /** The TRUE angle, IN DEGREES, between two RoPE-rotated embeddings in the
     *  full d_model-dimensional space: acos of tfRopeEmbDot over the two norms.
     *
     *  Like the dot product it depends on pb - pa ALONE. Note this is the angle
     *  in R^d_model, NOT the angle between the three-coordinate projections a
     *  scene actually draws: dropping a coordinate shortens one vector more at
     *  some positions than others, so the drawn angle can differ by a few
     *  degrees and is NOT invariant. A scene printing this number beside a
     *  projected picture must say which one it is. Returns 0 if either vector
     *  is degenerate. */
    function tfRopeEmbAngle(slotA, pa, slotB, pb) {
        const na = tfRopeEmbNorm(slotA, pa);
        const nb = tfRopeEmbNorm(slotB, pb);
        if (!(na > 1e-12) || !(nb > 1e-12)) return 0;
        let c = tfRopeEmbDot(slotA, pa, slotB, pb) / (na * nb);
        c = c < -1 ? -1 : (c > 1 ? 1 : c);
        return Math.acos(c) * 180 / Math.PI;
    }

    /** Component d of the unit-length great-circle (slerp) point at parameter
     *  s in [0,1] between the two RoPE'd embeddings — a DRAWING aid for the
     *  angle between them, not part of the forward pass.
     *
     *  Returns a point on the unit sphere of R^d_model, so s=0 and s=1 give the
     *  two directions themselves. Any linear projection of the result still
     *  lands on the projected direction at the endpoints, so a scene may scale
     *  it down and draw an arc whose ends sit on the two vectors it spans. The
     *  arc's true angular extent is acos of the normalised tfRopeEmbDot, which
     *  depends only on pb - pa; its projected appearance need not.
     *  Degenerate (zero-norm) or parallel inputs fall back to an endpoint. */
    function tfRopeEmbArc(d, slotA, pa, slotB, pb, s) {
        const c = _clampIdx(d, D_MODEL - 1);
        const A = new Float64Array(D_MODEL);
        const B = new Float64Array(D_MODEL);
        let na = 0, nb = 0;
        for (let k = 0; k < D_MODEL; k++) {
            A[k] = tfRopeEmb(slotA, k, pa);
            B[k] = tfRopeEmb(slotB, k, pb);
            na += A[k] * A[k];
            nb += B[k] * B[k];
        }
        na = Math.sqrt(na); nb = Math.sqrt(nb);
        if (!(na > 1e-12) || !(nb > 1e-12)) return 0;
        let dot = 0;
        for (let k = 0; k < D_MODEL; k++) dot += (A[k] / na) * (B[k] / nb);
        dot = dot < -1 ? -1 : (dot > 1 ? 1 : dot);
        const th = Math.acos(dot);
        const sth = Math.sin(th);
        let t = Number(s);
        if (!Number.isFinite(t)) t = 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        if (sth < 1e-9) return A[c] / na;
        return (Math.sin((1 - t) * th) * (A[c] / na) + Math.sin(t * th) * (B[c] / nb)) / sth;
    }

    function tfX(i, d) { return _st().x[_clampIdx(i, N - 1) * D_MODEL + _clampIdx(d, D_MODEL - 1)]; }

    function tfOutNoPos(i, d) { return _st().On[_clampIdx(i, N - 1) * D_K + _clampIdx(d, D_K - 1)]; }

    function tfQ(i, d) { return _st().Q[_clampIdx(i, N - 1) * D_K + _clampIdx(d, D_K - 1)]; }
    function tfK(i, d) { return _st().K[_clampIdx(i, N - 1) * D_K + _clampIdx(d, D_K - 1)]; }
    function tfV(i, d) { return _st().V[_clampIdx(i, N - 1) * D_K + _clampIdx(d, D_K - 1)]; }

    /** Exploratory "what if the query pointed there instead" vector. NOT the
     *  model's own q — the lesson must label it as a what-if. angleDeg = 0
     *  returns tfQ(s3_qi, d) exactly. */
    function tfQProbe(d, angleDeg) {
        const st = _st();
        const i = _clampIdx(_getSlider('s3_qi', 2), N - 1);
        const r = _rot([st.Q[i * D_K], st.Q[i * D_K + 1]], (Number(angleDeg) || 0) * Math.PI / 180);
        return r[_clampIdx(d, D_K - 1)];
    }

    function tfScore(i, j) { return _st().S[_clampIdx(i, N - 1) * N + _clampIdx(j, N - 1)]; }

    function tfScoreScaled(i, j) { return _st().Ss[_clampIdx(i, N - 1) * N + _clampIdx(j, N - 1)]; }

    /** Divide the RAW score by sqrt(dim), with dim passed literally by the
     *  scene: 2 is d_k (correct), 4 is d_model (the classic error). Passing it
     *  literally keeps the wrongness explicit in the JSON. */
    function tfScoreDiv(i, j, dim) {
        const d = Math.max(1e-9, Number(dim) || 1);
        return tfScore(i, j) / Math.sqrt(d);
    }

    function tfMaskVal(i, j) {
        if (_getSlider('s3_mask', 1) < 0.5) return 1;
        return _clampIdx(j, N - 1) <= _clampIdx(i, N - 1) ? 1 : 0;
    }

    function tfAttn(i, j) { return _st().A[_clampIdx(i, N - 1) * N + _clampIdx(j, N - 1)]; }

    /** Accuracy-contract item 1, asserted on screen. 1.000000 when correct;
     *  0.98993 for row 2 in the mask-after-softmax mode. */
    function tfRowSum(i) {
        const st = _st();
        const r = _clampIdx(i, N - 1);
        let acc = 0;
        for (let j = 0; j < N; j++) acc += st.A[r * N + j];
        return acc;
    }

    function tfOut(i, d) { return _st().O[_clampIdx(i, N - 1) * D_K + _clampIdx(d, D_K - 1)]; }

    function tfRopeQ(d, m) { return _rot(ROPE_Q, (Number(m) || 0) * ROPE_THETA)[_clampIdx(d, 1)]; }
    function tfRopeK(d, n) { return _rot(ROPE_K, (Number(n) || 0) * ROPE_THETA)[_clampIdx(d, 1)]; }

    /** <R_m q, R_n k>. Depends only on m - n — that identity IS proof 3,
     *  made draggable. */
    function tfRopeDot(m, n) {
        const a = _rot(ROPE_Q, (Number(m) || 0) * ROPE_THETA);
        const b = _rot(ROPE_K, (Number(n) || 0) * ROPE_THETA);
        return a[0] * b[0] + a[1] * b[1];
    }

    function tfDotSample(idx, n) {
        const dim = Math.max(1, Math.round(Number(n) || 1));
        const dots = _genDots(dim);
        return dots[_clampIdx(idx, GEN_COUNT - 1)];
    }

    function tfDotSampleScaled(idx, n) {
        const dim = Math.max(1, Math.round(Number(n) || 1));
        return tfDotSample(idx, dim) / Math.sqrt(dim);
    }

    /** Empirical variance of the first `count` samples at dimension n. This is
     *  the student's own small experiment; the authoritative 2,000,000-draw
     *  figures live in the lesson data block and must be labelled as such. */
    function tfSampleVar(n, count) {
        const dim = Math.max(1, Math.round(Number(n) || 1));
        const c = Math.max(2, Math.min(GEN_COUNT, Math.round(Number(count) || GEN_COUNT)));
        const dots = _genDots(dim);
        let mean = 0;
        for (let s = 0; s < c; s++) mean += dots[s];
        mean /= c;
        let acc = 0;
        for (let s = 0; s < c; s++) { const dv = dots[s] - mean; acc += dv * dv; }
        return acc / (c - 1);
    }

    window.AlgeBenchDomains.register('transformer', {
        _init({ getSlider }) { _getSlider = getSlider; },
        tfPerm, tfEmb, tfPE, tfX, tfOutNoPos,
        tfQ, tfK, tfV, tfQProbe,
        tfScore, tfScoreScaled, tfScoreDiv, tfMaskVal, tfAttn, tfRowSum, tfOut,
        tfRopeQ, tfRopeK, tfRopeDot, tfRopeEmb, tfRopeEmbTheta,
        tfRopeEmbDot, tfRopeEmbArc, tfRopeEmbNorm, tfRopeEmbAngle,
        tfDotSample, tfDotSampleScaled, tfSampleVar,
    });

})();
