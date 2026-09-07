/**
 * AlgeBench Domain Library — Transformer
 *
 * A small decoder-only transformer forward pass, general in every dimension:
 * n tokens, d_model, n_heads, n_kv (shared K/V heads), d_k, d_ff, n_layers,
 * pre- or post-norm, LayerNorm or RMSNorm, ReLU / GELU / SwiGLU, then the
 * final norm, the (tied) unembedding, logits, temperature and probabilities.
 *
 * Its DEFAULT configuration is the lesson's toy: "the cat sat on the mat",
 * d_model = 4, n_heads = 2, d_k = 2, one layer, and layer 0 / head 0 carries
 * the hand-built W_Q, W_K, W_V below, so every figure scenes 1-4 pin is
 * unchanged. Every other weight is a seeded deterministic initialisation
 * (reproducible, not learned), and any table can be replaced by a tensor
 * slider named after it (see docs.json). Scalar sliders tf_layers, tf_heads,
 * tf_kv, tf_dk, tf_dff, tf_norm, tf_prenorm, tf_act, tf_temp reshape the model.
 *
 * THE DEFAULT WEIGHTS ARE HAND-CONSTRUCTED OR SEEDED, NOT LEARNED. A lesson
 * must say so on screen; a lesson advertising rigour while showing invented
 * attention patterns is dishonest exactly where it claims to be honest.
 *
 * Functions are grouped as: configuration (tfN, tfDModel, ...), weights
 * (tfWq, tfWk, tfWv, tfWo, tfW1, tfW2, tfWu), the pass per layer and head
 * (tfH, tfQh, tfKh, tfVh, tfScoreH, tfAttnH, tfHeadOut, tfConcat, tfAttnOut,
 * tfResid1, tfFfIn, tfFfHidden, tfFfOut, tfResid2), the head of the model
 * (tfFinal, tfLogit, tfProb, tfArgmax, tfEntropy), the layer-0 / head-0
 * shorthands scenes 1-4 use (tfX, tfQ, tfK, tfV, tfScore, tfAttn, tfOut, ...),
 * and the scene-1/2 demonstration objects (RoPE on embeddings, the i.i.d.
 * sampler) that are not part of the pass.
 *
 * scripts/check_transformer_domain.py pins every figure this file computes
 * against independently derived literals, so a silent drift here fails there.
 *
 * Slider values are injected via _init({ getSlider }) called by expr.js on import.
 */
(function () {

    let _getSlider = (id, fallback = 0) => fallback; // replaced by _init

    // ---- the toy: constants the default configuration is built from ------

    const TOY_N = 6;
    const TOY_D_MODEL = 4;
    const TOY_D_K = 2;      // per head; deliberately != d_model (design doc §3)
    const MAX_DIM = 256;    // upper bound on tf_dk and tf_dff (a legibility toy, not a model)

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

    // Layer 0 / head 0 projections, row-vector convention: q = x W_Q.
    // Under that convention the ROWS are the images of the input basis
    // directions, so W_Q visibly reads input dims 2 and 3 while W_K reads
    // dims 1 and 3 and W_V reads dims 0 and 1 — three different readings of
    // one vector, which is the misconception scene 2 kills.
    const W_Q = [[0, 0], [0, 0], [3, 0], [0, 1]];
    const W_K = [[0, 0], [3, 0], [0, 0], [0, 1]];
    const W_V = [[1, 0], [0, 1], [0, 0], [0, 0]];

    // The shuffle used by the permutation-equivariance beat.
    const PERM = [5, 0, 3, 2, 1, 4];

    // Token surface forms, in their original reading order. Indexed through
    // the permutation by tfToken(), so a lattice labelled with it keeps saying
    // which word actually occupies each slot.
    const TOKENS = ['the', 'cat', 'sat', 'on', 'the', 'mat'];

    // Standalone RoPE demo vectors (scene 2). theta is 1.0 rad/position —
    // illustrative, not the paper's base-10000 schedule, which is invisible
    // at d_k = 2. The lesson says so.
    const ROPE_Q = [0.6, -1.3];
    const ROPE_K = [-0.9, 0.4];
    const ROPE_THETA = 1.0;

    const MASK_NEG = -1e9;  // stands in for -Infinity; see tfAttn
    const LN_EPS = 1e-5;

    // ---- small linear algebra --------------------------------------------

    /** Sinusoidal positional encoding for POSITION pos in a d-dimensional model. */
    function _pe(pos, d, dModel) {
        const pair = Math.floor(d / 2);
        const denom = Math.pow(10000, (2 * pair) / dModel);
        const angle = pos / denom;
        return (d % 2 === 0) ? Math.sin(angle) : Math.cos(angle);
    }

    /** x (n x a, flat) times W (a x b, nested) -> n x b, flat row-major. */
    function _matmul(x, n, a, W, b) {
        const out = new Float64Array(n * b);
        for (let i = 0; i < n; i++) {
            for (let d = 0; d < b; d++) {
                let acc = 0;
                for (let c = 0; c < a; c++) acc += x[i * a + c] * W[c][d];
                out[i * b + d] = acc;
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

    /** Row-wise normalisation of x (n x d). rms=1 skips the mean (RMSNorm has
     *  no mean subtraction and no bias — accuracy item 6). Unit gain, zero bias. */
    function _norm(x, n, d, rms) {
        const out = new Float64Array(n * d);
        for (let i = 0; i < n; i++) {
            let mean = 0;
            if (!rms) { for (let k = 0; k < d; k++) mean += x[i * d + k]; mean /= d; }
            let ss = 0;
            for (let k = 0; k < d; k++) { const v = x[i * d + k] - mean; ss += v * v; }
            const inv = 1 / Math.sqrt(ss / d + LN_EPS);
            for (let k = 0; k < d; k++) out[i * d + k] = (x[i * d + k] - mean) * inv;
        }
        return out;
    }

    const _relu = v => (v > 0 ? v : 0);
    const _gelu = v => 0.5 * v * (1 + Math.tanh(0.7978845608028654 * (v + 0.044715 * v * v * v)));
    const _silu = v => v / (1 + Math.exp(-v));

    // ---- seeded initialisation (reproducible, NOT learned) ----------------

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

    /** A deterministic (rows x cols) table, entries ~ N(0, scale^2), keyed by a tag
     *  so the same slot gets the same numbers on every rebuild and in the checker. */
    function _seededMatrix(tag, rows, cols, scale) {
        let h = 0x811c9dc5;
        for (let k = 0; k < tag.length; k++) h = Math.imul(h ^ tag.charCodeAt(k), 0x01000193);
        const rng = _splitmix32(h ^ 0x7f4a7c15);
        const out = [];
        let buf = [];
        for (let r = 0; r < rows; r++) {
            const row = [];
            for (let c = 0; c < cols; c++) {
                if (buf.length === 0) buf = _normals(rng);
                row.push(buf.pop() * scale);
            }
            out.push(row);
        }
        return out;
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
                // Refill only when EMPTY. `< 2` discarded the spare on every
                // pop -- _normals() returns two normals and one was thrown
                // away each time, doubling the Box-Muller work for nothing.
                if (buf.length === 0) buf = _normals(rng);
                const qd = buf.pop();
                if (buf.length === 0) buf = _normals(rng);
                const kd = buf.pop();
                acc += qd * kd;
            }
            dots[s] = acc;
        }
        _genCache = { key, dots };
        return dots;
    }


    // ---- reading sliders, and remembering what was read --------------------
    //
    // The pass is rebuilt only when a slider it READ has changed. Which
    // sliders those are depends on the configuration (a two-layer model reads
    // tf_wq_1_0, a one-layer model never does), so instead of a fixed key list
    // every read inside _build goes through _read(), which records the value
    // seen; _stale() then compares exactly that set against the live sliders.
    // A tensor slider is recorded as a flat copy and compared cell by cell.

    const ABSENT = Symbol('absent');
    let _reads = new Map();          // id -> ABSENT | number | Float64Array
    let _cache = { data: null };
    let _neverBuilt = true;

    function _snapshot(raw) {
        if (raw === ABSENT) return ABSENT;
        if (Array.isArray(raw)) return Float64Array.from(raw.flat(Infinity).map(Number));
        return Number(raw);
    }
    /** Does the live value `raw` still equal the recorded `snap`? Tables are
     *  walked in place against the flat copy: no allocation, since this runs
     *  once per keyed slider on every _st() call, i.e. per cell per frame. */
    function _same(snap, raw) {
        if (snap === ABSENT || raw === ABSENT) return snap === raw;
        if (snap instanceof Float64Array) {
            if (!Array.isArray(raw)) return false;
            // NaN cells compare equal to NaN, or a table holding one would
            // rebuild the pass on every call.
            const eq = (x, y) => x === y || (x !== x && y !== y);
            let k = 0;
            for (const row of raw) {
                if (Array.isArray(row)) {
                    for (const x of row) { if (k >= snap.length || !eq(Number(x), snap[k++])) return false; }
                } else if (k >= snap.length || !eq(Number(row), snap[k++])) return false;
            }
            return k === snap.length;
        }
        const v = Number(raw);
        return v === snap || (v !== v && snap !== snap);
    }
    /** Read a slider for the pass: the raw value, recorded for _stale(). */
    function _readRaw(id) {
        const raw = _getSlider(id, ABSENT);
        _reads.set(id, _snapshot(raw));
        return raw;
    }
    /** A scalar slider for the pass, or `fb` when absent / not a number. */
    function _read(id, fb) {
        const raw = _readRaw(id);
        if (raw === ABSENT || Array.isArray(raw)) return fb;
        const v = Number(raw);
        return Number.isFinite(v) ? v : fb;
    }
    /** `base` with each cell replaced by the tensor slider `id` where it has
     *  one (a nested array); cells it does not cover, or that are not finite
     *  numbers, keep the constant. `base` may be null when the table has no
     *  constant, in which case a missing slider yields null. */
    function _effective(base, id, rows, cols) {
        const o = _readRaw(id);
        if (!Array.isArray(o)) return base;
        const out = [];
        for (let r = 0; r < rows; r++) {
            const row = [];
            for (let c = 0; c < cols; c++) {
                const x = Array.isArray(o[r]) ? Number(o[r][c]) : NaN;
                row.push(Number.isFinite(x) ? x : (base ? base[r][c] : 0));
            }
            out.push(row);
        }
        return out;
    }

    function _stale() {
        if (_neverBuilt) return true;
        for (const [id, snap] of _reads) {
            if (!_same(snap, _getSlider(id, ABSENT))) return true;
        }
        return false;
    }

    function _st() {
        if (_stale()) {
            _reads = new Map();
            _cache = { data: _build() };
            _neverBuilt = false;
        }
        return _cache.data;
    }

    // ---- configuration --------------------------------------------------

    function _intRead(id, fb, lo, hi) {
        const v = Math.round(_read(id, fb));
        return v < lo ? lo : (v > hi ? hi : v);
    }

    /** The model's shape, from the embedding table in force and the tf_* sliders. */
    function _config() {
        // The embedding table decides n and d_model: tf_emb (any shape) wins,
        // then the scene-4 alias s4_emb over the toy table.
        const rawEmb = _readRaw('tf_emb');
        // A usable table has at least one row and one column; anything else
        // (including empty rows, which would make d_model 0) falls back to the toy.
        const embOk = Array.isArray(rawEmb) && rawEmb.length > 0 && Array.isArray(rawEmb[0]) && rawEmb[0].length > 0;
        const table = embOk
            ? _effective(null, 'tf_emb', rawEmb.length, rawEmb[0].length)
            : _effective(EMB, 's4_emb', TOY_N, TOY_D_MODEL);
        const n = table.length;
        const dModel = table[0].length;
        const heads = _intRead('tf_heads', 2, 1, 64);
        const kv = _intRead('tf_kv', heads, 1, heads);
        const dk = _intRead('tf_dk', Math.max(1, Math.floor(dModel / heads)), 1, MAX_DIM);
        const layers = _intRead('tf_layers', 1, 1, 12);
        const dff = _intRead('tf_dff', 2 * dModel, 1, MAX_DIM);
        // 0 = no normalisation anywhere (the toy of scenes 1-4), 1 LayerNorm, 2 RMSNorm.
        const normKind = _intRead('tf_norm', 0, 0, 2);
        const rms = normKind === 2;
        // Read only when a norm is on, so toggling it with tf_norm = 0 never
        // invalidates the cache for nothing.
        const pre = normKind ? _read('tf_prenorm', 1) >= 0.5 : true;   // 1 pre-norm, 0 post-norm
        const nrm = normKind ? (v) => _norm(v, n, dModel, rms) : (v) => v;
        const act = _intRead('tf_act', 0, 0, 2);         // 0 relu, 1 gelu, 2 swiglu
        const temp = Math.max(1e-6, _read('tf_temp', 1));
        // Vocabulary: one entry per distinct surface form, in first-seen order.
        const names = n === TOY_N ? TOKENS : Array.from({ length: n }, (_, i) => 't' + i);
        const vocab = [], vocabRow = [];
        const seen = new Set();
        for (let i = 0; i < n; i++) {
            if (!seen.has(names[i])) { seen.add(names[i]); vocab.push(names[i]); vocabRow.push(i); }
        }
        return { n, dModel, heads, kv, dk, layers, dff, normKind, rms, pre, nrm, act, temp, table, names, vocab, vocabRow };
    }

    /** Every weight of the configured model: the hand-built toy at layer 0 /
     *  head 0 when its shape fits, seeded tables elsewhere, any of them
     *  replaced by a tensor slider named after it. */
    function _weights(cfg) {
        const { dModel, dk, heads, kv, layers, dff } = cfg;
        const toyFits = dModel === TOY_D_MODEL && dk === TOY_D_K;
        const sc = 1 / Math.sqrt(dModel);
        const L = [];
        for (let l = 0; l < layers; l++) {
            const Wq = [], Wk = [], Wv = [];
            for (let h = 0; h < heads; h++) {
                const base = (l === 0 && h === 0 && toyFits) ? W_Q : _seededMatrix(`wq${l}_${h}`, dModel, dk, sc);
                let w = _effective(base, `tf_wq_${l}_${h}`, dModel, dk);
                if (l === 0 && h === 0) w = _effective(w, 's4_wq', dModel, dk);
                Wq.push(w);
            }
            for (let g = 0; g < kv; g++) {
                const bk = (l === 0 && g === 0 && toyFits) ? W_K : _seededMatrix(`wk${l}_${g}`, dModel, dk, sc);
                const bv = (l === 0 && g === 0 && toyFits) ? W_V : _seededMatrix(`wv${l}_${g}`, dModel, dk, sc);
                let wk = _effective(bk, `tf_wk_${l}_${g}`, dModel, dk);
                let wv = _effective(bv, `tf_wv_${l}_${g}`, dModel, dk);
                if (l === 0 && g === 0) { wk = _effective(wk, 's4_wk', dModel, dk); wv = _effective(wv, 's4_wv', dModel, dk); }
                Wk.push(wk); Wv.push(wv);
            }
            const Wo = _effective(_seededMatrix(`wo${l}`, heads * dk, dModel, 1 / Math.sqrt(heads * dk)), `tf_wo_${l}`, heads * dk, dModel);
            const W1 = _effective(_seededMatrix(`w1${l}`, dModel, dff, sc), `tf_w1_${l}`, dModel, dff);
            // The SwiGLU gate exists only under tf_act = 2; other activations never read it.
            const W3 = cfg.act === 2 ? _effective(_seededMatrix(`w3${l}`, dModel, dff, sc), `tf_w3_${l}`, dModel, dff) : null;
            const W2 = _effective(_seededMatrix(`w2${l}`, dff, dModel, 1 / Math.sqrt(dff)), `tf_w2_${l}`, dff, dModel);
            L.push({ Wq, Wk, Wv, Wo, W1, W2, W3 });
        }
        // Tied unembedding: row v of W_U is the embedding row of vocabulary entry v.
        const Wu = cfg.vocabRow.map(r => cfg.table[r].slice());
        return { L, Wu };
    }

    // ---- the forward pass, cached -------------------------------------------

    /** One attention sub-layer on `ain` (n x d_model): every head's Q, K, V,
     *  scores, weights and output, the concatenation and its W_O projection. */
    function _attention(ain, cfg, Lw, opts) {
        const { n, dModel, dk, heads, kv } = cfg;
        const { ropeOn, scale, maskOn, maskAfter } = opts;
        const Ks = [], Vs = [];
        for (let g = 0; g < kv; g++) {
            const K = _matmul(ain, n, dModel, Lw.Wk[g], dk);
            if (ropeOn) _rope(K, n, dk);
            Ks.push(K);
            Vs.push(_matmul(ain, n, dModel, Lw.Wv[g], dk));   // V is NEVER rotated
        }
        const div = Math.pow(Math.sqrt(dk), scale);
        const headsOut = [];
        const concat = new Float64Array(n * heads * dk);
        for (let h = 0; h < heads; h++) {
            const g = Math.floor((h * kv) / heads);   // integer: head h reads K/V head floor(h n_kv / n_heads)
            const Q = _matmul(ain, n, dModel, Lw.Wq[h], dk);
            if (ropeOn) _rope(Q, n, dk);
            const K = Ks[g], V = Vs[g];
            const S = new Float64Array(n * n), Ss = new Float64Array(n * n), A = new Float64Array(n * n);
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    let acc = 0;
                    for (let d = 0; d < dk; d++) acc += Q[i * dk + d] * K[j * dk + d];
                    S[i * n + j] = acc;
                    Ss[i * n + j] = acc / div;
                }
            }
            // Attention weights.
            //   maskAfter = 0 (CORRECT): additive -1e9 on the SCALED SCORES, then
            //     softmax. Rows sum to 1.000000.
            //   maskAfter = 1 (WRONG, for the misconception beat only): softmax
            //     over all n, THEN zero the future with no renormalization.
            for (let i = 0; i < n; i++) {
                const row = [];
                for (let j = 0; j < n; j++) {
                    const visible = !maskOn || j <= i;
                    row.push(maskAfter ? Ss[i * n + j] : (visible ? Ss[i * n + j] : MASK_NEG));
                }
                let w = _softmax(row);
                if (maskAfter) w = w.map((p, j) => (!maskOn || j <= i) ? p : 0);
                for (let j = 0; j < n; j++) A[i * n + j] = w[j];
            }
            const O = new Float64Array(n * dk);
            for (let i = 0; i < n; i++) {
                for (let d = 0; d < dk; d++) {
                    let acc = 0;
                    for (let j = 0; j < n; j++) acc += A[i * n + j] * V[j * dk + d];
                    O[i * dk + d] = acc;
                    concat[i * heads * dk + h * dk + d] = acc;
                }
            }
            headsOut.push({ Q, K, V, S, Ss, A, O, g });
        }
        const attnOut = _matmul(concat, n, heads * dk, Lw.Wo, dModel);
        return { heads: headsOut, concat, attnOut };
    }

    /** RoPE in place on X (n x dk): pair p of position i turns by i * theta_p,
     *  theta_p = ROPE_THETA * 10000^(-2p/dk). At dk = 2 that is the single
     *  pair at 1.0 rad/position the lesson quotes. */
    function _rope(X, n, dk) {
        for (let i = 0; i < n; i++) {
            for (let p = 0; 2 * p + 1 < dk; p++) {
                const th = i * ROPE_THETA * Math.pow(10000, -(2 * p) / dk);
                const a = X[i * dk + 2 * p], b = X[i * dk + 2 * p + 1];
                const c = Math.cos(th), s = Math.sin(th);
                X[i * dk + 2 * p] = c * a - s * b;
                X[i * dk + 2 * p + 1] = s * a + c * b;
            }
        }
    }

    function _build() {
        const cfg = _config();
        const W = _weights(cfg);
        const { n, dModel, dff, layers, normKind, pre, nrm, act, temp } = cfg;

        const shuffle = _read('s1_shuffle', 0) >= 0.5 ? 1 : 0;
        const ropeOn = _read('s2_rope', 0) >= 0.5 ? 1 : 0;
        // RoPE REPLACES additive positional encoding; it does not stack on top
        // of it. Real models pick one scheme or the other, so whenever RoPE is
        // on the sinusoidal PE term is forced off no matter what s1_pe says.
        const peOn = ropeOn ? 0 : _read('s1_pe', 1);
        const scale = _read('s3_scale', 1);
        const maskOn = _read('s3_mask', 0) >= 0.5 ? 1 : 0;
        const maskAfter = _read('s3_maskafter', 0) >= 0.5 ? 1 : 0;
        const opts = { ropeOn, scale, maskOn, maskAfter };

        // Which source token sits at each slot.
        const perm = new Int32Array(n);
        for (let i = 0; i < n; i++) perm[i] = shuffle ? (n === TOY_N ? PERM[i] : (n - 1 - i)) : i;

        // Raw embeddings at each slot (token travels), and x = emb + pe*PE
        // (position stays put — that asymmetry is the whole point). With RoPE
        // on, peOn is 0 and x is the raw embedding: position enters later, as
        // a rotation of q and k, and never twice.
        const emb = new Float64Array(n * dModel);
        const x = new Float64Array(n * dModel);
        for (let i = 0; i < n; i++) {
            for (let d = 0; d < dModel; d++) {
                const e = cfg.table[perm[i]][d];
                emb[i * dModel + d] = e;
                x[i * dModel + d] = e + peOn * _pe(i, d, dModel);
            }
        }

        // The stack. H[l] is the residual stream entering layer l; H[layers]
        // leaves the last one. With a norm on, pre-norm normalises what a
        // sub-layer READS and adds its raw output; post-norm adds first and
        // normalises the sum. With tf_norm = 0 (the toy) nrm is the identity.
        const H = [x];
        const L = [];
        const add = (a, b) => { const o = new Float64Array(a.length); for (let k = 0; k < a.length; k++) o[k] = a[k] + b[k]; return o; };
        for (let l = 0; l < layers; l++) {
            const hin = H[l];
            const ain = pre ? nrm(hin) : hin;
            const attn = _attention(ain, cfg, W.L[l], opts);
            let r1 = add(hin, attn.attnOut);
            if (!pre) r1 = nrm(r1);
            const fin = pre ? nrm(r1) : r1;
            const pre1 = _matmul(fin, n, dModel, W.L[l].W1, dff);
            const hidden = new Float64Array(n * dff);
            if (act === 2) {
                const gate = _matmul(fin, n, dModel, W.L[l].W3, dff);
                for (let k = 0; k < hidden.length; k++) hidden[k] = _silu(pre1[k]) * gate[k];
            } else {
                const f = act === 1 ? _gelu : _relu;
                for (let k = 0; k < hidden.length; k++) hidden[k] = f(pre1[k]);
            }
            const ffOut = _matmul(hidden, n, dff, W.L[l].W2, dModel);
            let r2 = add(r1, ffOut);
            if (!pre) r2 = nrm(r2);
            L.push({ hin, ain, attn, r1, fin, pre1, hidden, ffOut, r2 });
            H.push(r2);
        }
        const final = (normKind && pre) ? nrm(H[layers]) : H[layers];

        // Logits over the vocabulary (tied unembedding), then temperature.
        const V = cfg.vocab.length;
        const logits = new Float64Array(n * V);
        const probs = new Float64Array(n * V);
        for (let i = 0; i < n; i++) {
            const row = [];
            for (let v = 0; v < V; v++) {
                let acc = 0;
                for (let d = 0; d < dModel; d++) acc += final[i * dModel + d] * W.Wu[v][d];
                logits[i * V + v] = acc;
                row.push(acc / temp);
            }
            const p = _softmax(row);
            for (let v = 0; v < V; v++) probs[i * V + v] = p[v];
        }

        // The permutation-equivariance object: UNMASKED, POSITION-FREE
        // attention of layer 0 / head 0 over the RAW EMBEDDINGS. Deliberately a
        // separate pass — reusing the masked one above would silently break
        // the theorem, because the mask is a second, independent reason
        // equivariance fails. Still scaled dot-product attention.
        const dk = cfg.dk;
        const Qn = _matmul(emb, n, dModel, W.L[0].Wq[0], dk);
        const Kn = _matmul(emb, n, dModel, W.L[0].Wk[0], dk);
        const Vn = _matmul(emb, n, dModel, W.L[0].Wv[0], dk);
        const On = new Float64Array(n * dk);
        for (let i = 0; i < n; i++) {
            const row = [];
            for (let j = 0; j < n; j++) {
                let acc = 0;
                for (let d = 0; d < dk; d++) acc += Qn[i * dk + d] * Kn[j * dk + d];
                row.push(acc / Math.sqrt(dk));
            }
            const w = _softmax(row);
            for (let d = 0; d < dk; d++) {
                let acc = 0;
                for (let j = 0; j < n; j++) acc += w[j] * Vn[j * dk + d];
                On[i * dk + d] = acc;
            }
        }

        // Layer-0 / head-0 views under the names scenes 1-4 read.
        const h0 = L[0].attn.heads[0];
        return {
            cfg, W, perm, emb, x, H, L, final, logits, probs, On,
            N: n, dModel, dk,
            Q: h0.Q, K: h0.K, V: h0.V, S: h0.S, Ss: h0.Ss, A: h0.A, O: h0.O,
            EMBe: cfg.table, WQ: W.L[0].Wq[0], WK: W.L[0].Wk[0], WV: W.L[0].Wv[0],
        };
    }

    // ---- exported functions ----------------------------------------------

    const _clampIdx = (v, hi) => {
        const i = Math.round(Number(v) || 0);
        return i < 0 ? 0 : (i > hi ? hi : i);
    };
    const _n = () => _st().N;
    const _dm = () => _st().dModel;
    const _layer = (l) => { const st = _st(); return st.L[_clampIdx(l, st.cfg.layers - 1)]; };
    const _head = (l, h) => { const st = _st(); return _layer(l).attn.heads[_clampIdx(h, st.cfg.heads - 1)]; };
    const _cell = (arr, i, d, width, hiD) => { const st = _st(); return arr[_clampIdx(i, st.N - 1) * width + _clampIdx(d, hiD)]; };

    // Configuration
    function tfN() { return _st().N; }
    function tfDModel() { return _st().dModel; }
    function tfDk() { return _st().dk; }
    function tfHeads() { return _st().cfg.heads; }
    function tfKv() { return _st().cfg.kv; }
    function tfLayers() { return _st().cfg.layers; }
    function tfDff() { return _st().cfg.dff; }
    function tfTemp() { return _st().cfg.temp; }
    function tfVocabN() { return _st().cfg.vocab.length; }
    function tfVocabToken(v) { const st = _st(); return st.cfg.vocab[_clampIdx(v, st.cfg.vocab.length - 1)]; }
    /** Which K/V head query head h reads: floor(h / (n_heads / n_kv)). */
    function tfHeadKv(h) { const c = _st().cfg; return Math.floor((_clampIdx(h, c.heads - 1) * c.kv) / c.heads); }
    /** Numbers held in the K/V cache for the whole sequence: 2 * n * n_kv * d_k per layer. */
    function tfKvCache() { const c = _st().cfg; return 2 * c.n * c.kv * c.dk * c.layers; }
    /** The cache saving of sharing K/V heads, n_heads / n_kv (1 = MHA, n_heads = MQA). */
    function tfKvSaving() { const c = _st().cfg; return c.heads / c.kv; }

    // Weights
    function tfWq(l, h, r, c) { const st = _st(); const W = st.W.L[_clampIdx(l, st.cfg.layers - 1)].Wq[_clampIdx(h, st.cfg.heads - 1)]; return W[_clampIdx(r, st.dModel - 1)][_clampIdx(c, st.dk - 1)]; }
    function tfWk(l, g, r, c) { const st = _st(); const W = st.W.L[_clampIdx(l, st.cfg.layers - 1)].Wk[_clampIdx(g, st.cfg.kv - 1)]; return W[_clampIdx(r, st.dModel - 1)][_clampIdx(c, st.dk - 1)]; }
    function tfWv(l, g, r, c) { const st = _st(); const W = st.W.L[_clampIdx(l, st.cfg.layers - 1)].Wv[_clampIdx(g, st.cfg.kv - 1)]; return W[_clampIdx(r, st.dModel - 1)][_clampIdx(c, st.dk - 1)]; }
    function tfWo(l, r, c) { const st = _st(); const W = st.W.L[_clampIdx(l, st.cfg.layers - 1)].Wo; return W[_clampIdx(r, st.cfg.heads * st.dk - 1)][_clampIdx(c, st.dModel - 1)]; }
    function tfW1(l, r, c) { const st = _st(); const W = st.W.L[_clampIdx(l, st.cfg.layers - 1)].W1; return W[_clampIdx(r, st.dModel - 1)][_clampIdx(c, st.cfg.dff - 1)]; }
    function tfW2(l, r, c) { const st = _st(); const W = st.W.L[_clampIdx(l, st.cfg.layers - 1)].W2; return W[_clampIdx(r, st.cfg.dff - 1)][_clampIdx(c, st.dModel - 1)]; }
    function tfWu(v, d) { const st = _st(); return st.W.Wu[_clampIdx(v, st.cfg.vocab.length - 1)][_clampIdx(d, st.dModel - 1)]; }

    // The pass, per layer and head
    /** Component d of the residual stream entering layer l at slot i (l = 0 is x; l = n_layers is what leaves the stack). */
    function tfH(l, i, d) { const st = _st(); return _cell(st.H[_clampIdx(l, st.cfg.layers)], i, d, st.dModel, st.dModel - 1); }
    /** What the attention sub-layer of layer l reads: the normed stream (pre-norm) or the stream itself (post-norm). */
    function tfAttnIn(l, i, d) { const st = _st(); return _cell(_layer(l).ain, i, d, st.dModel, st.dModel - 1); }
    function tfQh(l, h, i, d) { const st = _st(); return _cell(_head(l, h).Q, i, d, st.dk, st.dk - 1); }
    function tfKh(l, h, i, d) { const st = _st(); return _cell(_head(l, h).K, i, d, st.dk, st.dk - 1); }
    function tfVh(l, h, i, d) { const st = _st(); return _cell(_head(l, h).V, i, d, st.dk, st.dk - 1); }
    function tfScoreH(l, h, i, j) { const st = _st(); return _cell(_head(l, h).S, i, j, st.N, st.N - 1); }
    function tfScoreScaledH(l, h, i, j) { const st = _st(); return _cell(_head(l, h).Ss, i, j, st.N, st.N - 1); }
    function tfAttnH(l, h, i, j) { const st = _st(); return _cell(_head(l, h).A, i, j, st.N, st.N - 1); }
    /** Head h's own output row i, component d — before the heads are concatenated and projected by W_O. */
    function tfHeadOut(l, h, i, d) { const st = _st(); return _cell(_head(l, h).O, i, d, st.dk, st.dk - 1); }
    /** The concatenated heads, width n_heads * d_k: column c belongs to head floor(c / d_k). */
    function tfConcat(l, i, c) { const st = _st(); const w = st.cfg.heads * st.dk; return _cell(_layer(l).attn.concat, i, c, w, w - 1); }
    /** The attention sub-layer's increment to the stream: concat times W_O. */
    function tfAttnOut(l, i, d) { const st = _st(); return _cell(_layer(l).attn.attnOut, i, d, st.dModel, st.dModel - 1); }
    /** The stream after the attention residual add (and, post-norm, its norm). */
    function tfResid1(l, i, d) { const st = _st(); return _cell(_layer(l).r1, i, d, st.dModel, st.dModel - 1); }
    /** What the FFN reads: the normed stream (pre-norm) or the stream itself. */
    function tfFfIn(l, i, d) { const st = _st(); return _cell(_layer(l).fin, i, d, st.dModel, st.dModel - 1); }
    /** FFN hidden unit k at slot i, after the activation (SwiGLU: after the gate). */
    function tfFfHidden(l, i, k) { const st = _st(); return _cell(_layer(l).hidden, i, k, st.cfg.dff, st.cfg.dff - 1); }
    /** FFN hidden unit k BEFORE the activation: the raw pre-activation fin . W1. */
    function tfFfPre(l, i, k) { const st = _st(); return _cell(_layer(l).pre1, i, k, st.cfg.dff, st.cfg.dff - 1); }
    /** The FFN's increment to the stream. */
    function tfFfOut(l, i, d) { const st = _st(); return _cell(_layer(l).ffOut, i, d, st.dModel, st.dModel - 1); }
    /** The stream leaving layer l (= tfH(l + 1, i, d)). */
    function tfResid2(l, i, d) { const st = _st(); return _cell(_layer(l).r2, i, d, st.dModel, st.dModel - 1); }

    // The head of the model
    /** The vector the unembedding reads at slot i: the final norm of the stream (pre-norm) or the stream itself. */
    function tfFinal(i, d) { const st = _st(); return _cell(st.final, i, d, st.dModel, st.dModel - 1); }
    /** Logit of vocabulary entry v at slot i: tfFinal(i, .) dot the embedding row of v (tied unembedding), before temperature. */
    function tfLogit(i, v) { const st = _st(); const V = st.cfg.vocab.length; return _cell(st.logits, i, v, V, V - 1); }
    /** softmax(logits / tf_temp)[v] at slot i: the model's next-token distribution for the slot after i. */
    function tfProb(i, v) { const st = _st(); const V = st.cfg.vocab.length; return _cell(st.probs, i, v, V, V - 1); }
    /** Index of the most probable vocabulary entry at slot i (temperature-independent). */
    function tfArgmax(i) {
        const st = _st(); const V = st.cfg.vocab.length; const r = _clampIdx(i, st.N - 1);
        let best = 0;
        for (let v = 1; v < V; v++) if (st.logits[r * V + v] > st.logits[r * V + best]) best = v;
        return best;
    }
    /** Shannon entropy (bits) of the slot-i distribution: 0 as T -> 0, log2(vocab) as T -> infinity. */
    function tfEntropy(i) {
        const st = _st(); const V = st.cfg.vocab.length; const r = _clampIdx(i, st.N - 1);
        let acc = 0;
        for (let v = 0; v < V; v++) { const p = st.probs[r * V + v]; if (p > 0) acc -= p * Math.log2(p); }
        return acc;
    }

    // Layer-0 / head-0 shorthands: the names scenes 1-4 read.
    function tfPerm(k) { return _st().perm[_clampIdx(k, _n() - 1)]; }
    function tfToken(k) { const st = _st(); return st.cfg.names[tfPerm(k)]; }
    /** Row r (a TOKEN row, no shuffle) of the embedding table in force. */
    function tfEmbBase(r, d) { const st = _st(); return st.EMBe[_clampIdx(r, st.N - 1)][_clampIdx(d, st.dModel - 1)]; }
    /** Entry (r, c) of a layer-0 / head-0 projection in force -- m = 0 for W_Q, 1 for W_K, 2 for W_V. */
    function tfW(m, r, c) {
        const st = _st();
        const W = _clampIdx(m, 2) === 0 ? st.WQ : (_clampIdx(m, 2) === 1 ? st.WK : st.WV);
        return W[_clampIdx(r, st.dModel - 1)][_clampIdx(c, st.dk - 1)];
    }
    function tfEmb(i, d) { const st = _st(); return _cell(st.emb, i, d, st.dModel, st.dModel - 1); }

    /** Positional encoding at a CONTINUOUS position. Unlike every other index
     *  here, the position is NOT rounded to a slot and NOT clamped to N-1: PE
     *  is a smooth function of position, and a scene that sweeps a position
     *  control must see the circle traced out, not six snapped points. Integer
     *  slot arguments are unaffected. The component index d still clamps. */
    function tfPE(i, d) {
        const pos = Number(i);
        return _pe(Number.isFinite(pos) ? pos : 0, _clampIdx(d, _dm() - 1), _dm());
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
        const i = _clampIdx(slot, _n() - 1);
        const c = _clampIdx(d, _dm() - 1);
        const pair = c >> 1;
        const pos = Number(p);
        const ang = (Number.isFinite(pos) ? pos : 0) * _thetaVis(pair);
        const emb = _st().emb;
        const base = i * _dm() + (pair << 1);
        const a = emb[base], b = emb[base + 1];
        const ca = Math.cos(ang), sa = Math.sin(ang);
        return (c % 2 === 0) ? (a * ca - b * sa) : (a * sa + b * ca);
    }

    /** The illustrative rotation rate tfRopeEmb uses for dimension pair
     *  `pair` (0 or 1), so a scene can display the number it is actually
     *  drawing with rather than a hard-coded copy that can drift out of sync. */
    /** The rate for dimension pair `pair`: the two illustrative values for the
     *  toy's pairs, and the real schedule 10000^(-2p/d_model) for any further
     *  pair a wider tf_emb brings, so a reshaped model never sees NaN here. */
    function _thetaVis(pair) {
        const p = Math.max(0, Math.round(Number(pair) || 0));
        return p < THETA_VIS.length ? THETA_VIS[p] : Math.pow(10000, -(2 * p) / _dm());
    }
    function tfRopeEmbTheta(pair) { return _thetaVis(pair); }


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
        for (let d = 0; d < _dm(); d++) {
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
        for (let d = 0; d < _dm(); d++) {
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
    // Scratch for tfRopeEmbArc. It feeds a parametric_curve sampled 160 times,
    // once per component, so allocating inside the function meant ~960 typed
    // arrays per frame while the reader dragged. Reuse is safe here: the
    // function fills both buffers before reading them, returns a number, and
    // keeps nothing across calls, so there is no reentrancy to spoil.
    let _arcA = new Float64Array(TOY_D_MODEL);
    let _arcB = new Float64Array(TOY_D_MODEL);

    function tfRopeEmbArc(d, slotA, pa, slotB, pb, s) {
        const c = _clampIdx(d, _dm() - 1);
        // Grow the scratch to the model's width once; a reshaped model must
        // not write past the end of a buffer sized for the toy.
        if (_arcA.length < _dm()) { _arcA = new Float64Array(_dm()); _arcB = new Float64Array(_dm()); }
        const A = _arcA;
        const B = _arcB;
        let na = 0, nb = 0;
        for (let k = 0; k < _dm(); k++) {
            A[k] = tfRopeEmb(slotA, k, pa);
            B[k] = tfRopeEmb(slotB, k, pb);
            na += A[k] * A[k];
            nb += B[k] * B[k];
        }
        na = Math.sqrt(na); nb = Math.sqrt(nb);
        if (!(na > 1e-12) || !(nb > 1e-12)) return 0;
        let dot = 0;
        for (let k = 0; k < _dm(); k++) dot += (A[k] / na) * (B[k] / nb);
        dot = dot < -1 ? -1 : (dot > 1 ? 1 : dot);
        const th = Math.acos(dot);
        const sth = Math.sin(th);
        let t = Number(s);
        if (!Number.isFinite(t)) t = 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        if (sth < 1e-9) return A[c] / na;
        return (Math.sin((1 - t) * th) * (A[c] / na) + Math.sin(t * th) * (B[c] / nb)) / sth;
    }

    function tfX(i, d) { const st = _st(); return _cell(st.x, i, d, st.dModel, st.dModel - 1); }

    function tfOutNoPos(i, d) { const st = _st(); return _cell(st.On, i, d, st.dk, st.dk - 1); }

    function tfQ(i, d) { const st = _st(); return _cell(st.Q, i, d, st.dk, st.dk - 1); }
    function tfK(i, d) { const st = _st(); return _cell(st.K, i, d, st.dk, st.dk - 1); }
    function tfV(i, d) { const st = _st(); return _cell(st.V, i, d, st.dk, st.dk - 1); }

    /** Score of the what-if (rotated) query against key j: q_probe . k_j.
     *  Equals tfScore(s3_qi, j) exactly at angleDeg = 0, where the probe IS
     *  the model's own query. */
    function tfScoreProbe(j, angleDeg) {
        const q = _probeVec(angleDeg);
        return q[0] * tfK(j, 0) + q[1] * tfK(j, 1);
    }

    /** Foot of the perpendicular dropped from the probe query onto key j:
     *  ((q.k)/(k.k)) * k, component d. Returns 0 for a zero-length key. */
    function tfProjQK(d, angleDeg, j) {
        const q = _probeVec(angleDeg);
        const q0 = q[0], q1 = q[1];
        const k0 = tfK(j, 0), k1 = tfK(j, 1);
        const kk = k0 * k0 + k1 * k1;
        if (kk === 0) return 0;
        const t = (q0 * k0 + q1 * k1) / kk;
        return _clampIdx(d, 1) === 0 ? t * k0 : t * k1;
    }

    /** The what-if query as a vector: token s3_qi's own q (its first two
     *  components), turned by angleDeg. Read outside the cache on purpose. */
    function _probeVec(angleDeg) {
        const st = _st();
        const i = _clampIdx(_getSlider('s3_qi', 2), st.N - 1);
        return _rot([st.Q[i * st.dk], st.Q[i * st.dk + 1] || 0], (Number(angleDeg) || 0) * Math.PI / 180);
    }

    function tfQProbe(d, angleDeg) {
        return _probeVec(angleDeg)[_clampIdx(d, 1)];
    }

    function tfScore(i, j) { const st = _st(); return _cell(st.S, i, j, st.N, st.N - 1); }

    function tfScoreScaled(i, j) { const st = _st(); return _cell(st.Ss, i, j, st.N, st.N - 1); }

    /** Divide the RAW score by sqrt(dim), with dim passed literally by the
     *  scene: 2 is d_k (correct), 4 is d_model (the classic error). Passing it
     *  literally keeps the wrongness explicit in the JSON. */
    function tfScoreDiv(i, j, dim) {
        const d = Math.max(1e-9, Number(dim) || 1);
        return tfScore(i, j) / Math.sqrt(d);
    }

    function tfMaskVal(i, j) {
        if (_getSlider('s3_mask', 0) < 0.5) return 1;
        const n = _n();
        return _clampIdx(j, n - 1) <= _clampIdx(i, n - 1) ? 1 : 0;
    }

    function tfAttn(i, j) { const st = _st(); return _cell(st.A, i, j, st.N, st.N - 1); }

    /** Accuracy-contract item 1, asserted on screen. 1.000000 when correct;
     *  0.98993 for row 2 in the mask-after-softmax mode. */
    function tfRowSum(i) {
        const st = _st();
        const r = _clampIdx(i, st.N - 1);
        let acc = 0;
        for (let j = 0; j < st.N; j++) acc += st.A[r * st.N + j];
        return acc;
    }

    function tfOut(i, d) { const st = _st(); return _cell(st.O, i, d, st.dk, st.dk - 1); }

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
        // configuration
        tfN, tfDModel, tfDk, tfHeads, tfKv, tfLayers, tfDff, tfTemp, tfVocabN, tfVocabToken,
        tfHeadKv, tfKvCache, tfKvSaving,
        // weights
        tfWq, tfWk, tfWv, tfWo, tfW1, tfW2, tfWu,
        // the pass, per layer and head
        tfH, tfAttnIn, tfQh, tfKh, tfVh, tfScoreH, tfScoreScaledH, tfAttnH, tfHeadOut,
        tfConcat, tfAttnOut, tfResid1, tfFfIn, tfFfPre, tfFfHidden, tfFfOut, tfResid2,
        // the head of the model
        tfFinal, tfLogit, tfProb, tfArgmax, tfEntropy,
        // layer-0 / head-0 shorthands and the scene-1/2 demonstration objects
        tfPerm, tfToken, tfEmb, tfPE, tfX, tfOutNoPos,
        tfEmbBase, tfW,
        tfQ, tfK, tfV, tfQProbe, tfProjQK, tfScoreProbe,
        tfScore, tfScoreScaled, tfScoreDiv, tfMaskVal, tfAttn, tfRowSum, tfOut,
        tfRopeQ, tfRopeK, tfRopeDot, tfRopeEmb, tfRopeEmbTheta,
        tfRopeEmbDot, tfRopeEmbArc, tfRopeEmbNorm, tfRopeEmbAngle,
        tfDotSample, tfDotSampleScaled, tfSampleVar,
    });

})();
