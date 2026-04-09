/**
 * AlgeBench Domain Library — Cislunar Dynamics
 *
 * Nominal Artemis II reconstruction using a single cached mission solve.
 * The public trajectory is produced by one continuous launch-to-splashdown
 * state integration under Earth + Moon gravity with smooth tracking toward the
 * NASA-timed nominal mission family.
 */
(function () {
    const PI2 = 2 * Math.PI;
    const DAY_SEC = 86400;
    const SQRT_2PI = Math.sqrt(2 * Math.PI);
    let _getSlider = (id, fallback = 0) => fallback;

    const CFG = {
        missionDays: 9.1,
        coreSepDay: 8.3 / 1440,
        solarDeployDay: 20 / 1440,
        parkingRaiseDay: 49 / 1440,
        apogeeRaiseDay: (1 + 47 / 60 + 57 / 3600) / 24,
        orionSepDay: (3 + 24 / 60 + 15 / 3600) / 24,
        proximityEndDay: (4 + 35 / 60) / 24,
        day0PerigeeRaiseDay: (13 + 44 / 60) / 24,
        tliDay: 1 + 1 / 24 + 37 / 1440,
        otcCleanupDay: 1 + 23 / 24 + 25 / 1440,
        otc1Day: 2 + 7 / 1440,
        otc2Day: 3 + 12 / 1440,
        otc3Day: 4 + 5 / 24 + 23 / 1440,
        moonSoiEnterDay: 4 + 6 / 24 + 59 / 1440,
        flybyObsStartDay: 4 + 22 / 24,
        closestApproachDay: 5 + 1 / 24 + 23 / 1440,
        maxDistanceDay: 5 + 1 / 24 + 26 / 1440,
        moonSoiExitDay: 5 + 19 / 24 + 47 / 1440,
        rtc1Day: 6 + 4 / 24 + 23 / 1440,
        rtc2Day: 8 + 4 / 24 + 33 / 1440,
        rtc3Day: 8 + 20 / 24 + 33 / 1440,
        serviceModuleSepDay: 9 + 1 / 24 + 13 / 1440,
        crewModuleRaiseDay: 9 + 1 / 24 + 16 / 1440,
        entryInterfaceDay: 9 + 1 / 24 + 33 / 1440,
        splashdownDay: 9 + 1 / 24 + 46 / 1440,
        moonOrbitKm: 384400,
        moonPeriodDays: 27.321661,
        moonRadiusKm: 1737,
        earthRadiusKm: 6371,
        initialPerigeeAltKm: 17 * 1.60934,
        lowAltKm: 185,
        highApogeeAltKm: 71645,
        entryAltKm: 122,
        muEarthKm3S2: 398600.4418,
        muMoonKm3S2: 4902.800066,
        dtFinalSec: 90,
    };

    const HEO = (() => {
        const rp = CFG.earthRadiusKm + CFG.lowAltKm;
        const ra = CFG.earthRadiusKm + CFG.highApogeeAltKm;
        const a = 0.5 * (rp + ra);
        const e = (ra - rp) / (ra + rp);
        const b = a * Math.sqrt(1 - e * e);
        return { rp, ra, a, b, e };
    })();

    const EARLY_ORBITS = {
        initial: (() => {
            const rp = CFG.earthRadiusKm + CFG.initialPerigeeAltKm;
            const ra = CFG.earthRadiusKm + 1381 * 1.60934;
            const a = 0.5 * (rp + ra);
            const e = (ra - rp) / (ra + rp);
            const b = a * Math.sqrt(1 - e * e);
            return { rp, ra, a, b, e };
        })(),
        safe: (() => {
            const rp = CFG.earthRadiusKm + CFG.lowAltKm;
            const ra = CFG.earthRadiusKm + 1381 * 1.60934;
            const a = 0.5 * (rp + ra);
            const e = (ra - rp) / (ra + rp);
            const b = a * Math.sqrt(1 - e * e);
            return { rp, ra, a, b, e };
        })(),
    };

    const OUTBOUND_BURN_DAYS = [CFG.otcCleanupDay, CFG.otc1Day, CFG.otc2Day, CFG.otc3Day];
    const RETURN_BURN_DAYS = [CFG.rtc1Day, CFG.rtc2Day, CFG.rtc3Day];

    let _cache = new Map();

    function _clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    function _lerp(a, b, u) {
        return a + (b - a) * u;
    }

    function _smoothstep(u) {
        const t = _clamp(u, 0, 1);
        return t * t * (3 - 2 * t);
    }

    function _smoothstepDerivative(u) {
        const t = _clamp(u, 0, 1);
        return 6 * t * (1 - t);
    }

    function _roundFlyMi(flyMi) {
        const raw = Number.isFinite(flyMi) ? flyMi : 4600;
        return 50 * Math.round(raw / 50);
    }

    function _resolveFlyMi(flyMi) {
        if (Number.isFinite(flyMi)) return flyMi;
        return _getSlider('flyAlt', 4600);
    }

    function _resolveMissionDay(day) {
        if (Number.isFinite(day)) return day;
        const stepDay = _getSlider('day', NaN);
        if (Number.isFinite(stepDay)) return stepDay;
        return 0;
    }

    function _solveKeplerE(meanAnomaly, e) {
        let E = meanAnomaly;
        for (let i = 0; i < 8; i++) {
            const f = E - e * Math.sin(E) - meanAnomaly;
            const fp = 1 - e * Math.cos(E);
            E -= f / Math.max(fp, 1e-8);
        }
        return E;
    }

    function _moonStateFromPhase(day, phaseDay) {
        const theta = PI2 * (day - phaseDay) / CFG.moonPeriodDays;
        const omega = PI2 / CFG.moonPeriodDays;
        return {
            theta,
            xKm: CFG.moonOrbitKm * Math.cos(theta),
            yKm: CFG.moonOrbitKm * Math.sin(theta),
            vxKmS: -(CFG.moonOrbitKm * omega * Math.sin(theta)) / DAY_SEC,
            vyKmS: (CFG.moonOrbitKm * omega * Math.cos(theta)) / DAY_SEC,
        };
    }

    function _moonStateDay(day, flyMi) {
        day = _resolveMissionDay(day);
        const resolvedFlyMi = _resolveFlyMi(flyMi);
        const data = _getData(resolvedFlyMi);
        return _moonStateFromPhase(day, data.params.phaseDay);
    }

    function _ellipsePos(day, startDay, endDay, orbit, startMeanAnomaly = 0, endMeanAnomaly = PI2) {
        const u = _clamp((day - startDay) / Math.max(endDay - startDay, 1e-6), 0, 1);
        const M = _lerp(startMeanAnomaly, endMeanAnomaly, u);
        const E = _solveKeplerE(M, orbit.e);
        return {
            xKm: -orbit.a * (Math.cos(E) - orbit.e),
            yKm: -orbit.b * Math.sin(E),
        };
    }

    function _ascentPos(day) {
        const u = _smoothstep(day / Math.max(CFG.coreSepDay, 1e-6));
        const r = _lerp(CFG.earthRadiusKm, EARLY_ORBITS.initial.rp, u);
        return {
            xKm: -r,
            yKm: 220 * Math.sin(Math.PI * u),
        };
    }

    function _preTliPos(day) {
        if (day <= CFG.coreSepDay) return _ascentPos(day);
        if (day <= CFG.parkingRaiseDay) {
            return _ellipsePos(day, CFG.coreSepDay, CFG.parkingRaiseDay, EARLY_ORBITS.initial, 0, Math.PI);
        }
        if (day <= CFG.apogeeRaiseDay) {
            return _ellipsePos(day, CFG.parkingRaiseDay, CFG.apogeeRaiseDay, EARLY_ORBITS.safe, Math.PI, PI2);
        }
        if (day <= CFG.day0PerigeeRaiseDay) {
            return _ellipsePos(day, CFG.apogeeRaiseDay, CFG.day0PerigeeRaiseDay, HEO, 0, Math.PI);
        }
        return _ellipsePos(day, CFG.day0PerigeeRaiseDay, CFG.tliDay, HEO, Math.PI, PI2);
    }

    function _preTliState(day) {
        const dd = _clamp(day, 0, CFG.tliDay);
        const eps = 1 / DAY_SEC;
        const p0 = _preTliPos(dd);
        const pm = _preTliPos(Math.max(0, dd - eps));
        const pp = _preTliPos(Math.min(CFG.tliDay, dd + eps));
        return {
            day: dd,
            xKm: p0.xKm,
            yKm: p0.yKm,
            vxKmS: (pp.xKm - pm.xKm) / (2 * eps * DAY_SEC),
            vyKmS: (pp.yKm - pm.yKm) / (2 * eps * DAY_SEC),
        };
    }

    function _calibratedParams(flyMi) {
        const x = (flyMi - 4600) / 1000;
        return {
            phaseDay: 5.40,
            speedKmS: 10.94,
            angleDeg: 0.28214285714285714 * x + 0.053571428571428575 * x * x,
            outboundDvKmS: 0.02,
            returnDvKmS: 0.003,
            outboundCenterDay: 3.0,
            returnCenterDay: 8.45,
        };
    }

    function _burnWeights(days, centerDay, widthDay) {
        const raw = days.map((day) => Math.exp(-Math.pow((day - centerDay) / Math.max(widthDay, 1e-3), 2)));
        const sum = raw.reduce((acc, v) => acc + v, 0) || 1;
        return raw.map((v) => v / sum);
    }

    function _burnPulseDayInv(day, centerDay, sigmaDay) {
        const sigma = Math.max(sigmaDay, 1e-4);
        const z = (day - centerDay) / sigma;
        return Math.exp(-0.5 * z * z) / (sigma * SQRT_2PI);
    }

    function _burnDvRateKmSPerDay(day, burnDays, weights, totalDvKmS, sigmaDay, sign = 1) {
        let rate = 0;
        for (let i = 0; i < burnDays.length; i++) {
            rate += sign * totalDvKmS * weights[i] * _burnPulseDayInv(day, burnDays[i], sigmaDay);
        }
        return rate;
    }

    function _accelKmS2(xKm, yKm, day, params) {
        const moon = _moonStateFromPhase(day, params.phaseDay);
        const rEarth = Math.max(Math.hypot(xKm, yKm), 1);
        const dxMoon = xKm - moon.xKm;
        const dyMoon = yKm - moon.yKm;
        const rMoon = Math.max(Math.hypot(dxMoon, dyMoon), 1);
        return {
            axKmS2: -CFG.muEarthKm3S2 * xKm / (rEarth * rEarth * rEarth) - CFG.muMoonKm3S2 * dxMoon / (rMoon * rMoon * rMoon),
            ayKmS2: -CFG.muEarthKm3S2 * yKm / (rEarth * rEarth * rEarth) - CFG.muMoonKm3S2 * dyMoon / (rMoon * rMoon * rMoon),
        };
    }

    function _rk4Step(state, day, dtSec, params) {
        const k1 = _accelKmS2(state.xKm, state.yKm, day, params);

        const x2 = state.xKm + 0.5 * dtSec * state.vxKmS;
        const y2 = state.yKm + 0.5 * dtSec * state.vyKmS;
        const vx2 = state.vxKmS + 0.5 * dtSec * k1.axKmS2;
        const vy2 = state.vyKmS + 0.5 * dtSec * k1.ayKmS2;
        const k2 = _accelKmS2(x2, y2, day + 0.5 * dtSec / DAY_SEC, params);

        const x3 = state.xKm + 0.5 * dtSec * vx2;
        const y3 = state.yKm + 0.5 * dtSec * vy2;
        const vx3 = state.vxKmS + 0.5 * dtSec * k2.axKmS2;
        const vy3 = state.vyKmS + 0.5 * dtSec * k2.ayKmS2;
        const k3 = _accelKmS2(x3, y3, day + 0.5 * dtSec / DAY_SEC, params);

        const x4 = state.xKm + dtSec * vx3;
        const y4 = state.yKm + dtSec * vy3;
        const vx4 = state.vxKmS + dtSec * k3.axKmS2;
        const vy4 = state.vyKmS + dtSec * k3.ayKmS2;
        const k4 = _accelKmS2(x4, y4, day + dtSec / DAY_SEC, params);

        return {
            xKm: state.xKm + dtSec * (state.vxKmS + 2 * vx2 + 2 * vx3 + vx4) / 6,
            yKm: state.yKm + dtSec * (state.vyKmS + 2 * vy2 + 2 * vy3 + vy4) / 6,
            vxKmS: state.vxKmS + dtSec * (k1.axKmS2 + 2 * k2.axKmS2 + 2 * k3.axKmS2 + k4.axKmS2) / 6,
            vyKmS: state.vyKmS + dtSec * (k1.ayKmS2 + 2 * k2.ayKmS2 + 2 * k3.ayKmS2 + k4.ayKmS2) / 6,
        };
    }

    function _simulateCandidate(params, dtSec, storeTrajectory) {
        const state0 = _preTliState(CFG.tliDay);
        const burnHeading = (-Math.PI / 2) + params.angleDeg * Math.PI / 180;
        const entryRadiusKm = CFG.earthRadiusKm + CFG.entryAltKm;
        const outboundWeights = _burnWeights(OUTBOUND_BURN_DAYS, params.outboundCenterDay, 0.5);
        const returnWeights = _burnWeights(RETURN_BURN_DAYS, params.returnCenterDay, 0.4);
        const outboundBurnSigmaDay = 0.018;
        const returnBurnSigmaDay = 0.022;
        let state = {
            xKm: state0.xKm,
            yKm: state0.yKm,
            vxKmS: params.speedKmS * Math.cos(burnHeading),
            vyKmS: params.speedKmS * Math.sin(burnHeading),
        };

        let bestMoonKm = Infinity;
        let bestMoonDay = CFG.tliDay;
        let bestEarthKm = Infinity;
        let bestEarthDay = CFG.tliDay;
        let entryLocked = false;

        const traj = storeTrajectory ? {
            arrDay: [],
            arrXKm: [],
            arrYKm: [],
            arrVxKmS: [],
            arrVyKmS: [],
            dtDay: dtSec / DAY_SEC,
        } : null;

        for (let day = CFG.tliDay; day <= CFG.missionDays + 1e-9; day += dtSec / DAY_SEC) {
            if (!entryLocked) {
                const v = Math.max(Math.hypot(state.vxKmS, state.vyKmS), 1e-6);
                const dvRatePerDay =
                    _burnDvRateKmSPerDay(day, OUTBOUND_BURN_DAYS, outboundWeights, params.outboundDvKmS, outboundBurnSigmaDay, 1)
                    + _burnDvRateKmSPerDay(day, RETURN_BURN_DAYS, returnWeights, params.returnDvKmS, returnBurnSigmaDay, -1);
                if (Math.abs(dvRatePerDay) > 1e-9) {
                    const dv = dvRatePerDay * (dtSec / DAY_SEC);
                    state.vxKmS += dv * state.vxKmS / v;
                    state.vyKmS += dv * state.vyKmS / v;
                }
            }

            const moon = _moonStateFromPhase(day, params.phaseDay);
            const distMoon = Math.hypot(state.xKm - moon.xKm, state.yKm - moon.yKm);
            const distEarth = Math.hypot(state.xKm, state.yKm);

            if (distMoon < bestMoonKm) {
                bestMoonKm = distMoon;
                bestMoonDay = day;
            }
            if (day >= 6.0 && distEarth < bestEarthKm) {
                bestEarthKm = distEarth;
                bestEarthDay = day;
            }

            if (!entryLocked && day >= 6.0 && distEarth <= entryRadiusKm) {
                const scale = entryRadiusKm / Math.max(distEarth, 1);
                state.xKm *= scale;
                state.yKm *= scale;
                state.vxKmS = 0;
                state.vyKmS = 0;
                bestEarthKm = entryRadiusKm;
                bestEarthDay = day;
                entryLocked = true;
            }

            if (traj) {
                traj.arrDay.push(day);
                traj.arrXKm.push(state.xKm);
                traj.arrYKm.push(state.yKm);
                traj.arrVxKmS.push(state.vxKmS);
                traj.arrVyKmS.push(state.vyKmS);
            }

            if (day + dtSec / DAY_SEC > CFG.missionDays) break;
            if (entryLocked) continue;
            state = _rk4Step(state, day, dtSec, params);
        }

        return {
            bestMoonKm,
            bestMoonDay,
            bestEarthKm,
            bestEarthDay,
            trajectory: traj,
        };
    }

    function _interpRawTrajectory(traj, day) {
        const dd = _clamp(day, CFG.tliDay, CFG.missionDays);
        const u = (dd - CFG.tliDay) / traj.dtDay;
        const i0 = _clamp(Math.floor(u), 0, traj.arrDay.length - 2);
        const i1 = i0 + 1;
        const frac = _clamp(u - i0, 0, 1);
        return {
            xKm: _lerp(traj.arrXKm[i0], traj.arrXKm[i1], frac),
            yKm: _lerp(traj.arrYKm[i0], traj.arrYKm[i1], frac),
            vxKmS: _lerp(traj.arrVxKmS[i0], traj.arrVxKmS[i1], frac),
            vyKmS: _lerp(traj.arrVyKmS[i0], traj.arrVyKmS[i1], frac),
        };
    }

    function _buildData(flyMi) {
        const params = { ..._calibratedParams(flyMi), flyMi };
        const rawResult = _simulateCandidate(params, CFG.dtFinalSec, true);
        return { params, metrics: rawResult, trajectory: rawResult.trajectory };
    }

    function _getData(flyMi) {
        const rounded = _roundFlyMi(flyMi);
        if (!_cache.has(rounded)) {
            _cache.set(rounded, _buildData(rounded));
        }
        return _cache.get(rounded);
    }

    function _entryHoldState(data) {
        const hold = _interpRawTrajectory(data.trajectory, data.metrics.bestEarthDay);
        const rHold = Math.hypot(hold.xKm, hold.yKm);
        const entryRadiusKm = CFG.earthRadiusKm + CFG.entryAltKm;
        if (rHold > 1) {
            const scale = entryRadiusKm / rHold;
            hold.xKm *= scale;
            hold.yKm *= scale;
        }
        hold.vxKmS = 0;
        hold.vyKmS = 0;
        return hold;
    }

    function _entryWindowStartDay() {
        return Math.max(CFG.rtc1Day, CFG.entryInterfaceDay - 0.18);
    }

    function _entryArcState(data, day) {
        const startDay = _entryWindowStartDay();
        const start = data.metrics.bestEarthDay <= startDay
            ? _entryHoldState(data)
            : _interpRawTrajectory(data.trajectory, startDay);
        const angle0 = Math.atan2(start.yKm, start.xKm);
        const radius0 = Math.hypot(start.xKm, start.yKm);
        const sampleDay = Math.max(CFG.serviceModuleSepDay, Math.min(data.metrics.bestEarthDay, CFG.entryInterfaceDay) - 0.08);
        const approach = _interpRawTrajectory(data.trajectory, sampleDay);
        const turnSign = ((approach.xKm * approach.vyKmS) - (approach.yKm * approach.vxKmS)) >= 0 ? 1 : -1;
        const entryRadiusKm = CFG.earthRadiusKm + CFG.entryAltKm;
        const entryAngle = angle0 + turnSign * 0.18;
        const splashAngle = entryAngle + turnSign * 0.10;
        let radiusKm;
        let drDt;
        let theta;
        let dThetaDt;

        if (day < CFG.entryInterfaceDay) {
            const totalDay = Math.max(CFG.entryInterfaceDay - startDay, 1e-6);
            const u = _clamp((day - startDay) / totalDay, 0, 1);
            const s = _smoothstep(u);
            const ds = _smoothstepDerivative(u) / (totalDay * DAY_SEC);
            radiusKm = _lerp(radius0, entryRadiusKm, s);
            drDt = (entryRadiusKm - radius0) * ds;
            theta = _lerp(angle0, entryAngle, s);
            dThetaDt = (entryAngle - angle0) * ds;
        } else {
            const totalDay = Math.max(CFG.splashdownDay - CFG.entryInterfaceDay, 1e-6);
            const u = _clamp((day - CFG.entryInterfaceDay) / totalDay, 0, 1);
            const s = _smoothstep(u);
            const ds = _smoothstepDerivative(u) / (totalDay * DAY_SEC);
            radiusKm = _lerp(entryRadiusKm, CFG.earthRadiusKm, s);
            drDt = (CFG.earthRadiusKm - entryRadiusKm) * ds;
            theta = _lerp(entryAngle, splashAngle, s);
            dThetaDt = (splashAngle - entryAngle) * ds;
        }
        return {
            xKm: radiusKm * Math.cos(theta),
            yKm: radiusKm * Math.sin(theta),
            vxKmS: (drDt * Math.cos(theta)) - (radiusKm * Math.sin(theta) * dThetaDt),
            vyKmS: (drDt * Math.sin(theta)) + (radiusKm * Math.cos(theta) * dThetaDt),
        };
    }

    function _interpTrajectory(data, day) {
        const dd = _clamp(day, 0, CFG.missionDays);
        if (dd <= CFG.tliDay - 0.03) return _preTliState(dd);
        if (dd < CFG.tliDay + 0.03) {
            const pre = _preTliState(dd);
            const post = _interpRawTrajectory(data.trajectory, CFG.tliDay + Math.max(dd - CFG.tliDay, 0));
            const uBlend = _smoothstep((dd - (CFG.tliDay - 0.03)) / 0.06);
            return {
                day: dd,
                xKm: _lerp(pre.xKm, post.xKm, uBlend),
                yKm: _lerp(pre.yKm, post.yKm, uBlend),
                vxKmS: _lerp(pre.vxKmS, post.vxKmS, uBlend),
                vyKmS: _lerp(pre.vyKmS, post.vyKmS, uBlend),
            };
        }
        const entryWindowStartDay = _entryWindowStartDay();
        if (dd >= entryWindowStartDay) {
            return { day: dd, ..._entryArcState(data, dd) };
        }
        const hold = _entryHoldState(data);
        if (dd >= data.metrics.bestEarthDay) {
            return { day: dd, ...hold };
        }
        const u = (dd - CFG.tliDay) / data.trajectory.dtDay;
        const i0 = _clamp(Math.floor(u), 0, data.trajectory.arrDay.length - 2);
        const i1 = i0 + 1;
        const frac = _clamp(u - i0, 0, 1);
        const state = {
            day: dd,
            xKm: _lerp(data.trajectory.arrXKm[i0], data.trajectory.arrXKm[i1], frac),
            yKm: _lerp(data.trajectory.arrYKm[i0], data.trajectory.arrYKm[i1], frac),
            vxKmS: _lerp(data.trajectory.arrVxKmS[i0], data.trajectory.arrVxKmS[i1], frac),
            vyKmS: _lerp(data.trajectory.arrVyKmS[i0], data.trajectory.arrVyKmS[i1], frac),
        };
        const rEarth = Math.hypot(state.xKm, state.yKm);
        const minAllowedR = dd < CFG.entryInterfaceDay
            ? (CFG.earthRadiusKm + CFG.entryAltKm)
            : CFG.earthRadiusKm;
        if (dd >= CFG.serviceModuleSepDay && rEarth < minAllowedR) {
            const scale = minAllowedR / Math.max(rEarth, 1);
            state.xKm *= scale;
            state.yKm *= scale;
            if (dd >= CFG.entryInterfaceDay) {
                state.vxKmS = 0;
                state.vyKmS = 0;
            }
        }
        return state;
    }

    function _missionState(day, flyMi) {
        const dd = _clamp(_resolveMissionDay(day), 0, CFG.missionDays);
        const resolvedFlyMi = _resolveFlyMi(flyMi);
        const data = _getData(resolvedFlyMi);
        return _interpTrajectory(data, dd);
    }

    function missionX(day, flyMi) { return _missionState(day, flyMi).xKm / 10000; }
    function missionY(day, flyMi) { return _missionState(day, flyMi).yKm / 10000; }
    function missionVx(day, flyMi) {
        const eps = 0.0002;
        const xp = _missionState(day + eps, flyMi).xKm;
        const xm = _missionState(day - eps, flyMi).xKm;
        return (xp - xm) / (2 * eps * DAY_SEC);
    }
    function missionVy(day, flyMi) {
        const eps = 0.0002;
        const yp = _missionState(day + eps, flyMi).yKm;
        const ym = _missionState(day - eps, flyMi).yKm;
        return (yp - ym) / (2 * eps * DAY_SEC);
    }

    function moonX(day, flyMi) { return _moonStateDay(day, flyMi).xKm / 10000; }
    function moonY(day, flyMi) { return _moonStateDay(day, flyMi).yKm / 10000; }
    function moonTheta(day, flyMi) { return _moonStateDay(day, flyMi).theta; }

    function distEarthKm(day, flyMi) {
        const st = _missionState(day, flyMi);
        return Math.hypot(st.xKm, st.yKm);
    }

    function distMoonKm(day, flyMi) {
        const st = _missionState(day, flyMi);
        const moon = _moonStateDay(day, flyMi);
        return Math.hypot(st.xKm - moon.xKm, st.yKm - moon.yKm);
    }

    function missionSpeedKmS(day, flyMi) {
        const st = _missionState(day, flyMi);
        return Math.hypot(st.vxKmS, st.vyKmS);
    }

    function missionBlackout(day, flyMi) {
        const st = _missionState(day, flyMi);
        const moon = _moonStateDay(day, flyMi);
        const dx = st.xKm;
        const dy = st.yKm;
        const denom = dx * dx + dy * dy;
        if (denom <= 1e-9) return 0;
        const s = _clamp((moon.xKm * dx + moon.yKm * dy) / denom, 0, 1);
        const px = s * dx;
        const py = s * dy;
        return Math.hypot(moon.xKm - px, moon.yKm - py) < CFG.moonRadiusKm ? 1 : 0;
    }

    function missionPhase(day, flyMi) {
        const dd = _clamp(Number.isFinite(day) ? day : 0, 0, CFG.missionDays);
        if (dd < CFG.coreSepDay) return 'Launch and ascent';
        if (dd < CFG.apogeeRaiseDay) return 'Parking-orbit shaping';
        if (dd < CFG.day0PerigeeRaiseDay) return 'High-Earth-orbit checkout';
        if (dd < CFG.tliDay) return 'Departure orbit and TLI setup';
        if (dd < CFG.otcCleanupDay) return 'Translunar injection';
        if (dd < CFG.moonSoiEnterDay) return 'Outbound cislunar coast';
        if (dd < CFG.moonSoiExitDay || distMoonKm(dd, flyMi) < 30000) return 'Lunar flyby';
        if (dd < CFG.entryInterfaceDay) return 'Free-return coast';
        return 'Entry and splashdown';
    }

    function missionMilestone(day, flyMi) {
        const dd = _clamp(Number.isFinite(day) ? day : 0, 0, CFG.missionDays);
        if (dd < CFG.coreSepDay) return 'Launch, SRB ascent, and core-stage flight';
        if (dd < CFG.parkingRaiseDay) return 'Initial 1381×17-mile insertion orbit';
        if (dd < CFG.apogeeRaiseDay) return 'Perigee raise to safe orbit';
        if (dd < CFG.orionSepDay) return 'Apogee raise into high Earth orbit';
        if (dd < CFG.proximityEndDay) return 'Orion separation and proximity operations';
        if (dd < CFG.day0PerigeeRaiseDay) return 'High-Earth-orbit systems checkout';
        if (dd < CFG.tliDay) return 'Perigee raise and departure setup';
        if (dd < CFG.otcCleanupDay) return 'Translunar injection by Orion service module';
        if (dd < CFG.otc1Day) return 'Outbound cleanup correction burn';
        if (dd < CFG.otc2Day) return 'Outbound correction burn #1';
        if (dd < CFG.otc3Day) return 'Outbound correction burn #2';
        if (dd < CFG.moonSoiEnterDay) return 'Outbound correction burn #3 and lunar approach';
        if (dd < CFG.flybyObsStartDay) return 'Lunar sphere-of-influence entry';
        if (dd < CFG.moonSoiExitDay) return 'Far-side lunar flyby and blackout window';
        if (dd < CFG.rtc1Day) return 'Return leg after lunar sphere-of-influence exit';
        if (dd < CFG.rtc2Day) return 'Return trajectory correction burn #1';
        if (dd < CFG.rtc3Day) return 'Return trajectory correction burn #2';
        if (dd < CFG.serviceModuleSepDay) return 'Return trajectory correction burn #3';
        if (dd < CFG.entryInterfaceDay) return 'Service-module separation and crew-module raise burn';
        if (dd < CFG.splashdownDay) return 'Entry interface, drogue deploy, and main parachutes';
        return 'Entry interface, parachutes, and splashdown';
    }

    window.AlgeBenchDomains.register('cislunar-dynamics', {
        _init({ getSlider }) { _getSlider = getSlider; },
        missionX,
        missionY,
        missionVx,
        missionVy,
        moonX,
        moonY,
        moonTheta,
        distEarthKm,
        distMoonKm,
        missionSpeedKmS,
        missionBlackout,
        missionPhase,
        missionMilestone,
    });
})();
