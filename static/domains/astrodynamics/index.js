/**
 * AlgeBench Domain Library — Astrodynamics
 *
 * Orbital mechanics simulation engine.
 * Registers orbitX, orbitY, orbitR, orbitVr, orbitVt, orbitHit, orbitOutcome
 * into the AlgeBench expression sandbox.
 *
 * Slider values are injected via _init({ getSlider }) called by expr.js on import.
 */
(function () {

    let _getSlider = (id, fallback = 0) => fallback; // replaced by _init

    let _orbitalCache = { key: null, data: null };

    function _orbitModeName(mode) {
        if (mode === 2 || mode === 'guided') return 'guided';
        if (mode === 1 || mode === 'powered') return 'powered';
        return 'coast';
    }

    function _buildOrbitalKey(modeName) {
        let ids;
        if (modeName === 'powered') {
            ids = ['Rp','Gs','Mx','h','h_target','v0','phi','athrust','tburn','T'];
        } else if (modeName === 'guided') {
            ids = ['Rp','Gs','Mx','h','h_target','v0','phi','athrust1','athrust2','tburn1','tcoast','tburn2','pitch_start','pitch_end','tpitch','T'];
        } else {
            ids = ['Rp','Gs','Mx','h','h_target','vlaunch','phi','T'];
        }
        const parts = [modeName];
        for (const id of ids) {
            parts.push(`${id}:${_getSlider(id, 0)}`);
        }
        return parts.join('|');
    }

    function _buildOrbitalCache(modeName) {
        const Rp = Math.max(1, _getSlider('Rp', 6371));
        const Gs = _getSlider('Gs', 6.6743);
        const Mx = _getSlider('Mx', 5.972);
        const mu = Math.max(1e-6, Gs * Mx * 10000);
        const h = Math.max(0, _getSlider('h', 1));
        const phiDeg = _getSlider('phi', 0);
        const phi = phiDeg * Math.PI / 180;
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);
        const T = Math.max(1, _getSlider('T', 1800));
        const vInit = modeName === 'powered' ? _getSlider('v0', 0) : _getSlider('vlaunch', 0);
        const athrust = modeName === 'powered' ? Math.max(0, _getSlider('athrust', 0)) : 0;
        const tburn = modeName === 'powered' ? Math.max(0, _getSlider('tburn', 0)) : 0;
        const athrust1 = modeName === 'guided' ? Math.max(0, _getSlider('athrust1', _getSlider('athrust', 0))) : 0;
        const athrust2 = modeName === 'guided' ? Math.max(0, _getSlider('athrust2', athrust1)) : 0;
        const tburn1 = modeName === 'guided' ? Math.max(0, _getSlider('tburn1', 180)) : 0;
        const tcoast = modeName === 'guided' ? Math.max(0, _getSlider('tcoast', 420)) : 0;
        const tburn2 = modeName === 'guided' ? Math.max(0, _getSlider('tburn2', 120)) : 0;
        const pitchStart = modeName === 'guided' ? _getSlider('pitch_start', 85) : 0;
        const pitchEnd = modeName === 'guided' ? _getSlider('pitch_end', 0) : 0;
        const tpitch = modeName === 'guided' ? Math.max(1, _getSlider('tpitch', 220)) : 1;
        const guidedPitchBiasDeg = modeName === 'guided' ? (phiDeg - 90) : 0;
        const burn2Start = tburn1 + tcoast;
        const burnEnd = modeName === 'guided' ? (burn2Start + tburn2) : (modeName === 'powered' ? tburn : 0);

        const r0 = Rp + h;
        let x = r0;
        let y = 0;
        let vx = vInit * sinPhi;
        let vy = vInit * cosPhi;
        if (modeName === 'guided') {
            vx = 0;
            vy = vInit;
        }
        let hit = false;
        let hitTime = Infinity;

        const maxSteps = 6000;
        const minSteps = 800;
        const n = Math.max(minSteps, Math.min(maxSteps, Math.round(T / 1.25)));
        const dt = T / n;

        const arrT = new Float64Array(n + 1);
        const arrX = new Float64Array(n + 1);
        const arrY = new Float64Array(n + 1);
        const arrVx = new Float64Array(n + 1);
        const arrVy = new Float64Array(n + 1);
        const arrR = new Float64Array(n + 1);
        const arrVr = new Float64Array(n + 1);
        const arrVt = new Float64Array(n + 1);
        const arrHit = new Uint8Array(n + 1);

        for (let i = 0; i <= n; i++) {
            const tt = i * dt;
            const rr = Math.max(1e-6, Math.hypot(x, y));
            const erx = x / rr;
            const ery = y / rr;
            const etx = -ery;
            const ety = erx;
            const vr = vx * erx + vy * ery;
            const vt = vx * etx + vy * ety;

            arrT[i] = tt;
            arrX[i] = x;
            arrY[i] = y;
            arrVx[i] = vx;
            arrVy[i] = vy;
            arrR[i] = rr;
            arrVr[i] = vr;
            arrVt[i] = vt;
            arrHit[i] = hit ? 1 : 0;

            if (i === n) break;
            if (hit) continue;

            const g = -mu / (rr * rr * rr);
            let ax = g * x;
            let ay = g * y;
            if (modeName === 'powered' && tt <= tburn) {
                ax += athrust * (sinPhi * erx + cosPhi * etx);
                ay += athrust * (sinPhi * ery + cosPhi * ety);
            } else if (modeName === 'guided') {
                if (tt <= tburn1) {
                    const uPitch = Math.max(0, Math.min(1, tt / tpitch));
                    const pitchDeg = pitchStart + (pitchEnd - pitchStart) * uPitch + guidedPitchBiasDeg;
                    const pitch = pitchDeg * Math.PI / 180;
                    const s = Math.sin(pitch);
                    const c = Math.cos(pitch);
                    ax += athrust1 * (s * erx + c * etx);
                    ay += athrust1 * (s * ery + c * ety);
                } else if (tt >= burn2Start && tt <= burnEnd) {
                    const rTarget = Rp + Math.max(0, _getSlider('h_target', h));
                    const vCircTarget = Math.sqrt(mu / Math.max(rTarget, Rp + 1e-6));
                    const vtErr = vCircTarget - Math.abs(vt);
                    const vrErr = -vr;
                    const vtScale = Math.max(-1, Math.min(1, vtErr / 0.3));
                    const vrScale = Math.max(-1, Math.min(1, vrErr / 0.12));
                    const sign = vt >= 0 ? 1 : -1;
                    const at = athrust2 * 0.88 * vtScale * sign;
                    const ar = athrust2 * 0.34 * vrScale;
                    ax += at * etx + ar * erx;
                    ay += at * ety + ar * ery;
                }
            }

            // Symplectic Euler
            vx += ax * dt;
            vy += ay * dt;
            x += vx * dt;
            y += vy * dt;

            const rNext = Math.hypot(x, y);
            if (rNext <= Rp) {
                hit = true;
                hitTime = (i + 1) * dt;
                const inv = rNext > 1e-6 ? (Rp / rNext) : 0;
                x *= inv;
                y *= inv;
                vx = 0;
                vy = 0;
            }
        }

        return {
            modeName, mu, Rp, T,
            hTarget: Math.max(0, _getSlider('h_target', h)),
            tburn, tburn1, tcoast, tburn2, burnEnd,
            arrT, arrX, arrY, arrVx, arrVy, arrR, arrVr, arrVt, arrHit,
            hitTime, n, dt,
        };
    }

    function _getOrbitalState(mode, tSec) {
        const modeName = _orbitModeName(mode);
        const key = _buildOrbitalKey(modeName);
        if (_orbitalCache.key !== key || !_orbitalCache.data || _orbitalCache.data.modeName !== modeName) {
            _orbitalCache = { key, data: _buildOrbitalCache(modeName) };
        }
        const data = _orbitalCache.data;
        const t = Math.max(0, Math.min(Number.isFinite(tSec) ? tSec : 0, data.T));
        const i0 = Math.max(0, Math.min(data.n - 1, Math.floor(t / data.dt)));
        const i1 = i0 + 1;
        const t0 = data.arrT[i0];
        const t1 = data.arrT[i1];
        const u = (t1 > t0) ? ((t - t0) / (t1 - t0)) : 0;
        const lerp = (a, b) => a + (b - a) * u;
        const x = lerp(data.arrX[i0], data.arrX[i1]);
        const y = lerp(data.arrY[i0], data.arrY[i1]);
        const vx = lerp(data.arrVx[i0], data.arrVx[i1]);
        const vy = lerp(data.arrVy[i0], data.arrVy[i1]);
        const r = Math.max(1e-6, Math.hypot(x, y));
        const erx = x / r;
        const ery = y / r;
        const etx = -ery;
        const ety = erx;
        const vr = vx * erx + vy * ery;
        const vt = vx * etx + vy * ety;
        const v = Math.hypot(vx, vy);
        const hit = (data.arrHit[i0] > 0) || (data.arrHit[i1] > 0) || (t >= data.hitTime);
        return { ...data, t, x, y, vx, vy, r, vr, vt, v, hit };
    }

    function orbitX(t, mode)   { return _getOrbitalState(mode, t).x; }
    function orbitY(t, mode)   { return _getOrbitalState(mode, t).y; }
    function orbitR(t, mode)   { return _getOrbitalState(mode, t).r; }
    function orbitVr(t, mode)  { return _getOrbitalState(mode, t).vr; }
    function orbitVt(t, mode)  { return _getOrbitalState(mode, t).vt; }
    function orbitHit(t, mode) { return _getOrbitalState(mode, t).hit ? 1 : 0; }

    function orbitOutcome(t, mode) {
        const st = _getOrbitalState(mode, t);
        if (st.hit || st.r <= st.Rp + 1e-3) return 'Outcome: impact/terrain intercept';
        const rTarget = st.Rp + st.hTarget;
        const vCircTarget = Math.sqrt(st.mu / Math.max(rTarget, st.Rp + 1e-6));
        const dR = Math.abs(st.r - rTarget);
        const dVt = Math.abs(Math.abs(st.vt) - vCircTarget);
        const absVr = Math.abs(st.vr);
        const burnDone = (st.modeName === 'powered' || st.modeName === 'guided') ? (st.t >= st.burnEnd) : true;
        if (burnDone && dR <= 40 && dVt <= 0.25 && absVr <= 0.08) return 'Outcome: stable-orbit target achieved';
        const vEscLocal = Math.sqrt(2 * st.mu / Math.max(st.r, st.Rp + 1e-6));
        if (st.v >= vEscLocal * 0.995) return 'Outcome: escape-leaning trajectory';
        return 'Outcome: bound but not yet stabilized';
    }

    window.AlgeBenchDomains.register('astrodynamics', {
        _init({ getSlider }) { _getSlider = getSlider; },
        orbitX, orbitY, orbitR, orbitVr, orbitVt, orbitHit, orbitOutcome,
    });

})();
