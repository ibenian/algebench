/**
 * AlgeBench Domain Library — Atmospheric Entry
 *
 * Simplified pre-parachute atmospheric entry dynamics for blunt capsules.
 * Integrates a 2D planet-centered entry-plane model with gravity, drag, and
 * in-plane lift. The model is intentionally low-order: exponential atmosphere,
 * fixed Cd and L/D per vehicle, no winds, no rotation, no guidance law.
 */
(function () {

    let _getSlider = (id, fallback = 0) => fallback;

    const G0 = 9.80665;
    const RHO0 = 1.225;
    const H_KM = 7.2;
    const RP_KM = 6371.0;
    const MU_KM3_S2 = 398600.4418;
    const ENTRY_ALT_KM = 121.92;
    const MAX_TIME_S = 1500;

    const VEHICLES = [
        {
            name: 'Crew Dragon',
            mission: 'LEO return',
            speedKmS: 7.8232,
            massKg: 9525,
            areaM2: 10.752,
            cd: 1.5,
            ld: 0.0,
            nominalGammaDeg: 6.0,
            chuteAltKm: 5.4864,
        },
        {
            name: 'Gemini',
            mission: 'LEO return',
            speedKmS: 7.35396,
            massKg: 2132,
            areaM2: 3.888,
            cd: 1.5,
            ld: 0.26,
            nominalGammaDeg: 6.0,
            chuteAltKm: 15.24,
        },
        {
            name: 'Apollo CM',
            mission: 'lunar return',
            speedKmS: 11.0,
            massKg: 5500,
            areaM2: 12.0,
            cd: 1.0,
            ld: 0.325,
            nominalGammaDeg: 6.5,
            chuteAltKm: 7.6,
        },
        {
            name: 'Orion',
            mission: 'lunar return',
            speedKmS: 11.176,
            massKg: 9299,
            areaM2: 19.866,
            cd: 1.5,
            ld: 0.26,
            nominalGammaDeg: 6.5,
            chuteAltKm: 7.62,
        },
    ];

    let _cache = { key: null, data: null };

    function _clamp(val, lo, hi) {
        return Math.max(lo, Math.min(hi, val));
    }

    function _vehicleIndex() {
        return _clamp(Math.round(_getSlider('s2_vehicle', 0)), 0, VEHICLES.length - 1);
    }

    function _getVehicle() {
        return VEHICLES[_vehicleIndex()];
    }

    function _buildKey() {
        return [
            `v:${_vehicleIndex()}`,
            `g:${_getSlider('s2_gamma', 6)}`,
            `b:${_getSlider('s2_bank', 0)}`,
            `gl:${_getSlider('s2_g_limit', 9)}`,
        ].join('|');
    }

    function _upwardNormal(vx, vy, x, y) {
        const v = Math.max(1e-9, Math.hypot(vx, vy));
        let nx = -vy / v;
        let ny = vx / v;
        const r = Math.max(1e-9, Math.hypot(x, y));
        const erx = x / r;
        const ery = y / r;
        if (nx * erx + ny * ery < 0) {
            nx = -nx;
            ny = -ny;
        }
        return { x: nx, y: ny };
    }

    function _simulateEntry(vehicle, gammaDeg, bankDeg, options = {}) {
        const beta = vehicle.massKg / Math.max(1e-6, vehicle.cd * vehicle.areaM2);
        const ldEff = vehicle.ld * Math.cos(bankDeg * Math.PI / 180);
        const dt = options.dt || 0.25;
        const n = Math.max(1, Math.round(MAX_TIME_S / dt));
        const storeArrays = options.storeArrays !== false;

        const arrT = storeArrays ? new Float64Array(n + 1) : null;
        const arrX = storeArrays ? new Float64Array(n + 1) : null;
        const arrY = storeArrays ? new Float64Array(n + 1) : null;
        const arrVx = storeArrays ? new Float64Array(n + 1) : null;
        const arrVy = storeArrays ? new Float64Array(n + 1) : null;
        const arrAlt = storeArrays ? new Float64Array(n + 1) : null;
        const arrG = storeArrays ? new Float64Array(n + 1) : null;
        const arrHeat = storeArrays ? new Float64Array(n + 1) : null;
        const arrRho = storeArrays ? new Float64Array(n + 1) : null;

        const gamma = gammaDeg * Math.PI / 180;
        const r0 = RP_KM + ENTRY_ALT_KM;
        let x = r0;
        let y = 0;
        let vx = -vehicle.speedKmS * Math.sin(gamma);
        let vy = vehicle.speedKmS * Math.cos(gamma);

        let peakG = 0;
        let peakGT = 0;
        let peakHeat = 0;
        let peakHeatT = 0;
        let minAlt = ENTRY_ALT_KM;
        let minAltT = 0;
        let endReason = 'time_limit';
        let endTime = MAX_TIME_S;
        let skip = false;
        let deployed = false;
        let afterDip = false;

        for (let i = 0; i <= n; i++) {
            const tt = i * dt;
            const r = Math.max(1e-9, Math.hypot(x, y));
            const alt = r - RP_KM;
            const speed = Math.max(1e-9, Math.hypot(vx, vy));
            const rho = alt > ENTRY_ALT_KM + 30 ? 0 : RHO0 * Math.exp(-Math.max(0, alt) / H_KM);
            const dragAccKmS2 = 500 * rho * speed * speed / beta;
            const aeroG = dragAccKmS2 * 1000 / G0;
            const heat = Math.sqrt(Math.max(0, rho / RHO0)) * Math.pow(speed / 7.8, 3);

            if (alt < minAlt) {
                minAlt = alt;
                minAltT = tt;
            }
            if (aeroG > peakG) {
                peakG = aeroG;
                peakGT = tt;
            }
            if (heat > peakHeat) {
                peakHeat = heat;
                peakHeatT = tt;
            }

            if (storeArrays) {
                arrT[i] = tt;
                arrX[i] = x;
                arrY[i] = y;
                arrVx[i] = vx;
                arrVy[i] = vy;
                arrAlt[i] = alt;
                arrG[i] = aeroG;
                arrHeat[i] = heat;
                arrRho[i] = rho;
            }

            if (i === n) break;

            const vr = (vx * x + vy * y) / r;
            if (alt < ENTRY_ALT_KM - 10) afterDip = true;

            if (afterDip && alt > ENTRY_ALT_KM + 1 && vr > 0) {
                skip = true;
                endReason = 'skip';
                endTime = tt;
                break;
            }
            if (alt <= vehicle.chuteAltKm) {
                deployed = true;
                endReason = 'chute_window';
                endTime = tt;
                break;
            }
            if (alt <= 0) {
                endReason = 'surface';
                endTime = tt;
                break;
            }

            const vhatX = vx / speed;
            const vhatY = vy / speed;
            const dragX = -dragAccKmS2 * vhatX;
            const dragY = -dragAccKmS2 * vhatY;
            const liftDir = _upwardNormal(vx, vy, x, y);
            const liftAccKmS2 = dragAccKmS2 * ldEff;
            const liftX = liftAccKmS2 * liftDir.x;
            const liftY = liftAccKmS2 * liftDir.y;
            const grav = -MU_KM3_S2 / (r * r * r);
            const ax = grav * x + dragX + liftX;
            const ay = grav * y + dragY + liftY;

            vx += ax * dt;
            vy += ay * dt;
            x += vx * dt;
            y += vy * dt;
        }

        return {
            vehicle,
            beta,
            ldEff,
            peakG,
            peakGT,
            peakHeat,
            peakHeatT,
            minAlt,
            minAltT,
            endReason,
            endTime,
            skip,
            deployed,
            n,
            dt,
            arrT,
            arrX,
            arrY,
            arrVx,
            arrVy,
            arrAlt,
            arrG,
            arrHeat,
            arrRho,
        };
    }

    function _corridorFor(vehicle, bankDeg, gLimit) {
        let lo = null;
        let hi = null;
        for (let gamma = 1.0; gamma <= 12.0001; gamma += 0.05) {
            const sim = _simulateEntry(vehicle, gamma, bankDeg, { dt: 0.5, storeArrays: false });
            const nominal = sim.deployed && !sim.skip && sim.peakG <= gLimit;
            if (nominal) {
                if (lo === null) lo = gamma;
                hi = gamma;
            }
        }
        return {
            lo: lo == null ? vehicle.nominalGammaDeg : lo,
            hi: hi == null ? vehicle.nominalGammaDeg : hi,
        };
    }

    function _buildCache() {
        const vehicle = _getVehicle();
        const gammaDeg = _getSlider('s2_gamma', vehicle.nominalGammaDeg);
        const bankDeg = _getSlider('s2_bank', 0);
        const gLimit = _getSlider('s2_g_limit', 9);
        const sim = _simulateEntry(vehicle, gammaDeg, bankDeg, { dt: 0.25, storeArrays: true });
        const corridor = _corridorFor(vehicle, bankDeg, gLimit);
        return { vehicle, gammaDeg, bankDeg, gLimit, sim, corridor };
    }

    function _ensureCache() {
        const key = _buildKey();
        if (_cache.key !== key || !_cache.data) {
            _cache = { key, data: _buildCache() };
        }
        return _cache.data;
    }

    function _stateAt(tSec) {
        const data = _ensureCache();
        const sim = data.sim;
        const t = _clamp(Number.isFinite(tSec) ? tSec : 0, 0, sim.endTime);
        const i0 = Math.max(0, Math.min(sim.n - 1, Math.floor(t / sim.dt)));
        const i1 = Math.min(sim.n, i0 + 1);
        const t0 = sim.arrT[i0];
        const t1 = sim.arrT[i1];
        const u = (t1 > t0) ? ((t - t0) / (t1 - t0)) : 0;
        const lerp = (arr) => arr[i0] + (arr[i1] - arr[i0]) * u;
        const x = lerp(sim.arrX);
        const y = lerp(sim.arrY);
        const vx = lerp(sim.arrVx);
        const vy = lerp(sim.arrVy);
        const alt = lerp(sim.arrAlt);
        const g = lerp(sim.arrG);
        const heat = lerp(sim.arrHeat);
        const rho = lerp(sim.arrRho);
        return { ...data, t, x, y, vx, vy, alt, g, heat, rho };
    }

    function entryX(t) { return _stateAt(t).x; }
    function entryY(t) { return _stateAt(t).y; }
    function entryVx(t) { return _stateAt(t).vx; }
    function entryVy(t) { return _stateAt(t).vy; }
    function entryAlt(t) { return _stateAt(t).alt; }
    function entrySpeed(t) {
        const st = _stateAt(t);
        return Math.hypot(st.vx, st.vy);
    }
    function entryRho(t) { return _stateAt(t).rho; }
    function entryG(t) { return _stateAt(t).g; }
    function entryHeat(t) { return _stateAt(t).heat; }
    function entryEndTime() { return _ensureCache().sim.endTime; }
    function entryPeakG() { return _ensureCache().sim.peakG; }
    function entryPeakGT() { return _ensureCache().sim.peakGT; }
    function entryPeakHeat() { return _ensureCache().sim.peakHeat; }
    function entryPeakHeatT() { return _ensureCache().sim.peakHeatT; }
    function entryMinAlt() { return _ensureCache().sim.minAlt; }
    function entryCorridorLo() { return _ensureCache().corridor.lo; }
    function entryCorridorHi() { return _ensureCache().corridor.hi; }
    function entryVehicleName() { return _ensureCache().vehicle.name; }
    function entryVehicleMission() { return _ensureCache().vehicle.mission; }
    function entryVehicleMass() { return _ensureCache().vehicle.massKg; }
    function entryVehicleArea() { return _ensureCache().vehicle.areaM2; }
    function entryVehicleCd() { return _ensureCache().vehicle.cd; }
    function entryVehicleBeta() { return _ensureCache().sim.beta; }
    function entryVehicleLD() { return _ensureCache().vehicle.ld; }
    function entryVehicleSpeed() { return _ensureCache().vehicle.speedKmS; }
    function entryVehicleNominalGamma() { return _ensureCache().vehicle.nominalGammaDeg; }
    function entryChuteAlt() { return _ensureCache().vehicle.chuteAltKm; }

    function entryOutcome() {
        const data = _ensureCache();
        if (data.sim.skip) return 'Skip-out — too shallow, vehicle exits atmosphere';
        if (data.sim.deployed && data.sim.peakG <= data.gLimit) return 'Nominal entry — chute deployment within g-limit';
        if (data.sim.deployed) return 'Excessive g-load — entry too steep for crew survival';
        if (data.sim.endReason === 'surface') return 'Ballistic impact — no chute deployment';
        return 'Undetermined — simulation ended before classification';
    }

    window.AlgeBenchDomains.register('atmospheric-entry', {
        _init({ getSlider }) { _getSlider = getSlider; },
        entryX,
        entryY,
        entryVx,
        entryVy,
        entryAlt,
        entrySpeed,
        entryRho,
        entryG,
        entryHeat,
        entryEndTime,
        entryPeakG,
        entryPeakGT,
        entryPeakHeat,
        entryPeakHeatT,
        entryMinAlt,
        entryCorridorLo,
        entryCorridorHi,
        entryVehicleName,
        entryVehicleMission,
        entryVehicleMass,
        entryVehicleArea,
        entryVehicleCd,
        entryVehicleBeta,
        entryVehicleLD,
        entryVehicleSpeed,
        entryVehicleNominalGamma,
        entryChuteAlt,
        entryOutcome,
    });

})();
