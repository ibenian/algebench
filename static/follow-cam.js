// ============================================================
// Follow-cam system — tracks animated elements in real-time,
// angle-lock, and the follow-angle-lock UI toggle.
// ============================================================

import { state } from '/state.js';
import { dataToWorld } from '/coords.js';
import { compileExpr, evalExpr } from '/expr.js';

export function findElementSpecById(id) {
    if (!state.currentSpec) return null;
    for (const el of (state.currentSpec.elements || [])) {
        if (el.id === id) return el;
    }
    for (const step of (state.currentSpec.steps || [])) {
        for (const el of (step.add || [])) {
            if (el.id === id) return el;
        }
    }
    for (const scene of (state.lessonSpec && state.lessonSpec.scenes || [])) {
        for (const el of (scene.elements || [])) {
            if (el.id === id) return el;
        }
        for (const step of (scene.steps || [])) {
            for (const el of (step.add || [])) {
                if (el.id === id) return el;
            }
        }
    }
    return null;
}

function _normalizeExprTriplet(triplet) {
    if (!Array.isArray(triplet) || triplet.length !== 3) return null;
    return triplet.map(v => (typeof v === 'number' ? String(v) : v));
}

export function activateFollowCam(viewSpec) {
    const followTargets = Array.isArray(viewSpec.follow) ? viewSpec.follow : [viewSpec.follow];
    const offset = viewSpec.offset || [0, 0, 30];

    let el = null;
    for (const tid of followTargets) {
        const candidate = findElementSpecById(tid);
        if (!candidate) continue;
        const hasExpr = _normalizeExprTriplet(candidate.expr || candidate.toExpr) !== null
            || (Array.isArray(candidate.points) && candidate.points.length > 0);
        if (hasExpr) { el = candidate; break; }
    }
    if (!el) {
        console.warn('follow-cam: no element with a valid expression found for targets:', followTargets);
        return;
    }

    let exprStrings = _normalizeExprTriplet(el.expr || el.toExpr);
    let fromExprStrings = _normalizeExprTriplet(el.fromExpr);
    if (!exprStrings && Array.isArray(el.points) && el.points.length > 0) {
        exprStrings = _normalizeExprTriplet(el.points[0]);
        if (el.points.length > 1) fromExprStrings = _normalizeExprTriplet(el.points[1]);
    }
    if (!exprStrings) {
        console.warn('follow-cam: element has no expr:', el.id);
        return;
    }
    let compiledExprs, compiledFromExprs = null;
    try {
        compiledExprs = exprStrings.map(e => compileExpr(e));
    } catch (err) {
        console.warn('follow-cam: expr compile error', err);
        return;
    }
    if (Array.isArray(fromExprStrings) && fromExprStrings.length === 3) {
        try {
            compiledFromExprs = fromExprStrings.map(e => compileExpr(e));
        } catch (err) {
            console.warn('follow-cam: fromExpr compile error', err);
        }
    }

    const up = Array.isArray(viewSpec.up) ? viewSpec.up.slice(0, 3) : state.sceneUp.slice(0, 3);
    const angleLockAxisData = (Array.isArray(viewSpec.angleLockAxis) && viewSpec.angleLockAxis.length === 3)
        ? viewSpec.angleLockAxis.slice(0, 3)
        : (Array.isArray(state.currentSpec && state.currentSpec.angleLockAxis) && state.currentSpec.angleLockAxis.length === 3)
            ? state.currentSpec.angleLockAxis.slice(0, 3)
            : state.sceneUp.slice(0, 3);
    const angleLockDirectionTargets = (Array.isArray(viewSpec.angleLockDirection) && viewSpec.angleLockDirection.length === 2)
        ? viewSpec.angleLockDirection.slice(0, 2) : null;
    const angleLockDirectionVectorTargets = (typeof viewSpec.angleLockDirection === 'string' && viewSpec.angleLockDirection.trim())
        ? [viewSpec.angleLockDirection.trim()] : null;
    const angleLockVectorTargets = Array.isArray(viewSpec.angleLockVector)
        ? viewSpec.angleLockVector.slice()
        : (typeof viewSpec.angleLockVector === 'string' && viewSpec.angleLockVector.trim())
            ? [viewSpec.angleLockVector.trim()] : null;
    const resolvedAngleLockVectorTargets = angleLockVectorTargets || angleLockDirectionVectorTargets;

    let initDataPos;
    const freshEntry = _getFreshAnimEntry(followTargets);
    if (freshEntry) {
        initDataPos = freshEntry.pos;
    } else {
        try {
            initDataPos = compiledExprs.map(fn => evalExpr(fn, 0));
        } catch (err) {
            initDataPos = [0, 0, 0];
        }
    }
    const initTargetWorld = dataToWorld(initDataPos);
    const initCamDataPos = [
        initDataPos[0] + offset[0],
        initDataPos[1] + offset[1],
        initDataPos[2] + offset[2],
    ];
    const initCamWorld = dataToWorld(initCamDataPos);

    if (state.camera && state.controls) {
        state.camera.position.set(initCamWorld[0], initCamWorld[1], initCamWorld[2]);
        state.controls.target.set(initTargetWorld[0], initTargetWorld[1], initTargetWorld[2]);
        state.camera.up.copy(_normalizeUpVector(up));
        state.camera.lookAt(state.controls.target);
        state.controls.update();
    }

    let directionEval = null;
    if (resolvedAngleLockVectorTargets) {
        for (const vid of resolvedAngleLockVectorTargets) {
            const vel = findElementSpecById(vid);
            if (!vel) continue;
            const toStr = _normalizeExprTriplet(vel.expr || vel.toExpr)
                || (Array.isArray(vel.points) && vel.points.length > 0 ? _normalizeExprTriplet(vel.points[0]) : null);
            const fromStr = _normalizeExprTriplet(vel.fromExpr)
                || (Array.isArray(vel.points) && vel.points.length > 1 ? _normalizeExprTriplet(vel.points[1]) : null)
                || ['0', '0', '0'];
            if (!toStr) continue;
            try {
                const toFns = toStr.map(e => compileExpr(e));
                const fromFns = fromStr.map(e => compileExpr(e));
                directionEval = {
                    evalDir(tSec) {
                        const to = toFns.map(fn => evalExpr(fn, tSec));
                        const from = fromFns.map(fn => evalExpr(fn, tSec));
                        const d = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
                        const len = d.length();
                        return len > 1e-8 ? d.multiplyScalar(1 / len) : null;
                    }
                };
                break;
            } catch (err) { /* try next source */ }
        }
    }
    if (!directionEval && angleLockDirectionTargets) {
        const aEl = findElementSpecById(angleLockDirectionTargets[0]);
        const bEl = findElementSpecById(angleLockDirectionTargets[1]);
        const aStr = aEl ? (_normalizeExprTriplet(aEl.expr || aEl.toExpr)
            || (Array.isArray(aEl.points) && aEl.points.length > 0 ? _normalizeExprTriplet(aEl.points[0]) : null)) : null;
        const bStr = bEl ? (_normalizeExprTriplet(bEl.expr || bEl.toExpr)
            || (Array.isArray(bEl.points) && bEl.points.length > 0 ? _normalizeExprTriplet(bEl.points[0]) : null)) : null;
        if (aStr && bStr) {
            try {
                const aFns = aStr.map(e => compileExpr(e));
                const bFns = bStr.map(e => compileExpr(e));
                directionEval = {
                    evalDir(tSec) {
                        const a = aFns.map(fn => evalExpr(fn, tSec));
                        const b = bFns.map(fn => evalExpr(fn, tSec));
                        const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
                        const len = d.length();
                        return len > 1e-8 ? d.multiplyScalar(1 / len) : null;
                    }
                };
            } catch (err) { /* fall back to live tracking */ }
        }
    }

    state.followCamState = {
        followTargets,
        offset,
        compiledExprs,
        compiledFromExprs,
        up,
        exprStrings,
        fromExprStrings: fromExprStrings || null,
        lastTargetWorld: new THREE.Vector3(...initTargetWorld),
        axisWorld: _normalizeUpVector(angleLockAxisData).clone().normalize(),
        axisCenterWorld: new THREE.Vector3(...dataToWorld([0, 0, 0])),
        vectorTargets: resolvedAngleLockVectorTargets,
        directionTargets: angleLockDirectionTargets,
        lastDirectionWorld: _getDirectionWorldFromVectorTargets(resolvedAngleLockVectorTargets)
            || _getDirectionWorldFromTargets(angleLockDirectionTargets)
            || _computeDerivedDirectionWorld(followTargets),
        directionEval,
        refStartTime: (freshEntry && Number.isFinite(freshEntry.startTime)) ? freshEntry.startTime : performance.now(),
        viewKey: (viewSpec && viewSpec._viewKey) ? viewSpec._viewKey : null,
    };
    state.followCamStartTime = performance.now();
    console.log('🎥 follow-cam activated for targets:', followTargets);
    if (state.controls && Object.prototype.hasOwnProperty.call(state.controls, 'enableDamping')) {
        state.followCamSavedControls = {
            enableDamping: !!state.controls.enableDamping,
            dampingFactor: Number.isFinite(state.controls.dampingFactor) ? state.controls.dampingFactor : 0,
        };
        state.controls.enableDamping = false;
    }
    updateFollowAngleLockButtonState();
}

export function deactivateFollowCam() {
    if (!state.followCamState) return;
    state.followCamState = null;
    if (state.controls && state.followCamSavedControls) {
        if (Object.prototype.hasOwnProperty.call(state.controls, 'enableDamping')) {
            state.controls.enableDamping = state.followCamSavedControls.enableDamping;
            if (Number.isFinite(state.followCamSavedControls.dampingFactor)) {
                state.controls.dampingFactor = state.followCamSavedControls.dampingFactor;
            }
        }
    }
    state.followCamSavedControls = null;
    console.log('🎥 follow-cam deactivated');
    updateFollowAngleLockButtonState();
}

function _getFreshAnimEntry(targets) {
    let best = null;
    for (const tid of targets) {
        const entry = state.animatedElementPos[tid];
        if (entry && performance.now() - entry.time < 500) {
            if (!best || entry.time > best.time) best = entry;
        }
    }
    return best;
}

function _getLatestAnimEntry(targets) {
    let best = null;
    for (const tid of targets) {
        const entry = state.animatedElementPos[tid];
        if (entry) {
            if (!best || entry.time > best.time) best = entry;
        }
    }
    return best;
}

function _computeDerivedDirectionWorld(targets) {
    if (!Array.isArray(targets) || targets.length < 2) return null;
    const first = state.animatedElementPos[targets[0]];
    const last  = state.animatedElementPos[targets[targets.length - 1]];
    if (!first || !last) return null;

    const firstIsVec = first.from !== undefined;
    const lastIsVec  = last.from  !== undefined;
    let fromPos, toPos;

    if (!firstIsVec && !lastIsVec) {
        fromPos = first.pos; toPos = last.pos;
    } else if (firstIsVec && !lastIsVec) {
        fromPos = first.from; toPos = last.pos;
    } else if (!firstIsVec && lastIsVec) {
        fromPos = first.pos; toPos = last.pos;
    } else {
        const v1d = [first.pos[0]-first.from[0], first.pos[1]-first.from[1], first.pos[2]-first.from[2]];
        const v2d = [last.pos[0]-last.from[0],   last.pos[1]-last.from[1],   last.pos[2]-last.from[2]];
        fromPos = first.from;
        toPos   = [first.from[0]+v1d[0]+v2d[0], first.from[1]+v1d[1]+v2d[1], first.from[2]+v1d[2]+v2d[2]];
    }

    const fromW = new THREE.Vector3(...dataToWorld(fromPos));
    const toW   = new THREE.Vector3(...dataToWorld(toPos));
    const dir = toW.sub(fromW);
    return dir.length() > 1e-6 ? dir.normalize() : null;
}

function _computeDerivedTargetPos(targets) {
    if (!Array.isArray(targets) || targets.length === 0) return null;
    if (targets.length === 1) {
        const e = state.animatedElementPos[targets[0]];
        return e ? e.pos : null;
    }
    const first = state.animatedElementPos[targets[0]];
    const last  = state.animatedElementPos[targets[targets.length - 1]];
    if (!first && !last) return null;
    if (!first) return last.pos;
    if (!last)  return first.pos;

    const firstIsVec = first.from !== undefined;
    const lastIsVec  = last.from  !== undefined;
    let fromPos, toPos;

    if (!firstIsVec && !lastIsVec) {
        fromPos = first.pos; toPos = last.pos;
    } else if (firstIsVec && !lastIsVec) {
        fromPos = first.from; toPos = last.pos;
    } else if (!firstIsVec && lastIsVec) {
        fromPos = first.pos; toPos = last.pos;
    } else {
        const v1d = [first.pos[0]-first.from[0], first.pos[1]-first.from[1], first.pos[2]-first.from[2]];
        const v2d = [last.pos[0]-last.from[0],   last.pos[1]-last.from[1],   last.pos[2]-last.from[2]];
        fromPos = first.from;
        toPos   = [first.from[0]+v1d[0]+v2d[0], first.from[1]+v1d[1]+v2d[1], first.from[2]+v1d[2]+v2d[2]];
    }
    return [
        (fromPos[0] + toPos[0]) / 2,
        (fromPos[1] + toPos[1]) / 2,
        (fromPos[2] + toPos[2]) / 2,
    ];
}

function _getDirectionWorldFromTargets(targetPair) {
    if (!Array.isArray(targetPair) || targetPair.length !== 2) return null;
    const fromEntry = _getFreshAnimEntry([targetPair[0]]);
    const toEntry = _getFreshAnimEntry([targetPair[1]]);
    if (!fromEntry || !toEntry) return null;
    const fromWorld = new THREE.Vector3(...dataToWorld(fromEntry.pos));
    const toWorld = new THREE.Vector3(...dataToWorld(toEntry.pos));
    const dir = toWorld.sub(fromWorld);
    const len = dir.length();
    if (len < 1e-8) return null;
    return dir.multiplyScalar(1 / len);
}

function _getDirectionWorldFromVectorTargets(vectorTargets) {
    if (!Array.isArray(vectorTargets) || vectorTargets.length === 0) return null;
    for (const vid of vectorTargets) {
        const entry = _getFreshAnimEntry([vid]);
        if (!entry) continue;
        if (Array.isArray(entry.from) && entry.from.length === 3 && Array.isArray(entry.to) && entry.to.length === 3) {
            const fromWorld = new THREE.Vector3(...dataToWorld(entry.from));
            const toWorld = new THREE.Vector3(...dataToWorld(entry.to));
            const dir = toWorld.sub(fromWorld);
            const len = dir.length();
            if (len > 1e-8) return dir.multiplyScalar(1 / len);
        }
    }
    return null;
}

export function updateFollowCam() {
    if (!state.followCamState || !state.camera || !state.controls) return;
    const { followTargets, compiledExprs } = state.followCamState;

    let targetDataPos;
    const tSecRef = (performance.now() - (state.followCamState.refStartTime || state.followCamStartTime)) / 1000;
    const latest = _getLatestAnimEntry(followTargets);
    if (!state.followCamAngleLock && latest) {
        targetDataPos = latest.pos;
    }
    if (!targetDataPos && state.followCamAngleLock && compiledExprs) {
        try {
            targetDataPos = compiledExprs.map(fn => evalExpr(fn, tSecRef));
        } catch (err) { targetDataPos = null; }
    }
    if (!targetDataPos && latest) {
        targetDataPos = latest.pos;
    }
    if (!targetDataPos) {
        let staleEntry = null;
        for (const tid of followTargets) {
            if (state.animatedElementPos[tid]) { staleEntry = state.animatedElementPos[tid]; break; }
        }
        if (staleEntry && compiledExprs) {
            const tSec = (performance.now() - staleEntry.startTime) / 1000;
            try { targetDataPos = compiledExprs.map(fn => evalExpr(fn, tSec)); }
            catch (err) { return; }
        } else if (compiledExprs) {
            const tSec = (performance.now() - state.followCamStartTime) / 1000;
            try { targetDataPos = compiledExprs.map(fn => evalExpr(fn, tSec)); }
            catch (err) { return; }
        } else {
            return;
        }
    }

    const newTargetWorld = new THREE.Vector3(...dataToWorld(targetDataPos));
    const oldTargetWorld = state.followCamState.lastTargetWorld.clone();
    const delta = newTargetWorld.clone().sub(oldTargetWorld);

    state.camera.position.add(delta);
    state.controls.target.copy(newTargetWorld);

    if (state.followCamAngleLock) {
        const axis = state.followCamState.axisWorld;
        const center = state.followCamState.axisCenterWorld;
        const oldDir = state.followCamState.lastDirectionWorld ? state.followCamState.lastDirectionWorld.clone() : null;
        const newDir = (state.followCamState.directionEval && typeof state.followCamState.directionEval.evalDir === 'function')
            ? state.followCamState.directionEval.evalDir(tSecRef)
            : (_computeDerivedDirectionWorld(followTargets)
                || _getDirectionWorldFromVectorTargets(state.followCamState.vectorTargets)
                || _getDirectionWorldFromTargets(state.followCamState.directionTargets));
        const prevBase = oldDir || oldTargetWorld.clone().sub(center);
        const nextBase = newDir || newTargetWorld.clone().sub(center);
        const prevProj = prevBase.sub(axis.clone().multiplyScalar(prevBase.dot(axis)));
        const nextProj = nextBase.sub(axis.clone().multiplyScalar(nextBase.dot(axis)));
        const prevLen = prevProj.length();
        const nextLen = nextProj.length();
        if (prevLen > 1e-6 && nextLen > 1e-6) {
            prevProj.multiplyScalar(1 / prevLen);
            nextProj.multiplyScalar(1 / nextLen);
            const cross = new THREE.Vector3().crossVectors(prevProj, nextProj);
            const sinA = axis.dot(cross);
            const cosA = THREE.MathUtils.clamp(prevProj.dot(nextProj), -1, 1);
            const dAngle = Math.atan2(sinA, cosA);
            if (Number.isFinite(dAngle) && Math.abs(dAngle) > 1e-7) {
                const offset = state.camera.position.clone().sub(newTargetWorld);
                offset.applyAxisAngle(axis, dAngle);
                state.camera.position.copy(newTargetWorld).add(offset);
                state.camera.up.applyAxisAngle(axis, dAngle).normalize();
            }
        }
        if (newDir) state.followCamState.lastDirectionWorld = newDir;
    }
    state.camera.lookAt(state.controls.target);
    state.followCamState.lastTargetWorld.copy(newTargetWorld);
}

export function updateFollowAngleLockButtonState() {
    const btn = document.getElementById('follow-angle-lock-toggle');
    if (!btn) return;
    btn.classList.toggle('active', !!state.followCamAngleLock);
    btn.classList.toggle('cam-active', !!state.followCamState);
    if (state.followCamState) {
        btn.title = state.followCamAngleLock
            ? 'Angle-lock ON: camera rotates with followed object'
            : 'Angle-lock OFF: camera follows position only';
    } else {
        btn.title = state.followCamAngleLock
            ? 'Angle-lock armed (applies in follow-cam views)'
            : 'Toggle angle-lock for follow camera';
    }
}

export function setupFollowAngleLockToggle() {
    const btn = document.getElementById('follow-angle-lock-toggle');
    if (!btn) return;
    btn.style.display = 'block';
    btn.addEventListener('click', () => {
        state.followCamAngleLock = !state.followCamAngleLock;
        updateFollowAngleLockButtonState();
    });
    updateFollowAngleLockButtonState();
}

// Normalize a data-space up vector to a THREE.Vector3
function _normalizeUpVector(up) {
    const raw = Array.isArray(up) && up.length === 3 ? up : [0, 1, 0];
    const v = new THREE.Vector3(raw[0], raw[1], raw[2]);
    if (v.lengthSq() < 1e-12) return new THREE.Vector3(0, 1, 0);
    return v.normalize();
}
