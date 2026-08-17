// ============================================================
// Follow-cam system — tracks animated elements in real-time,
// angle-lock, and the follow-angle-lock UI toggle.
// ============================================================

import { state } from '/state.js';
import { ANGLE_LOCK_ICON } from '/icons.js';
import { dataToWorld } from '/coords.js';
import { compileExpr, evalExpr } from '/expr.js';
import type { CompiledExpr } from '/expr.js';
import type { Vec3 } from '/coords.js';
import type { Vector3 } from 'three';

/** A scene element, as this module inspects it looking for position exprs.
 *  Looser than the schema: only the expr-bearing fields matter here. */
interface FollowElement {
    id?: string;
    expr?: unknown;
    toExpr?: unknown;
    fromExpr?: unknown;
    centerExpr?: unknown;
    center?: unknown;
    points?: unknown[];
    [field: string]: unknown;
}

/**
 * One entry of the shared animated-element position registry, written each
 * frame by the animated renderers. NOTE: state.js's comment calls this
 * "id -> [x,y,z]", but the actual value is this record — `from` is present
 * only for vector-shaped elements, which is how the direction helpers below
 * tell a vector from a point.
 */
interface AnimPosEntry {
    pos: number[];
    time: number;
    /** Vector-shaped elements publish both endpoints; points publish neither.
     *  Their presence is how the direction helpers tell the two apart. */
    from?: number[];
    to?: number[];
    /** When the element's animation began, used to align the angle-lock phase. */
    startTime?: number;
}

/** The scene/lesson shape this module walks to resolve follow targets. */
interface FollowScene {
    elements?: FollowElement[];
    steps?: { add?: FollowElement[] }[];
    /** Scene-level default for the follow-cam's angle-lock axis. */
    angleLockAxis?: unknown;
}

/** A compiled direction source: evaluates a unit direction at time t, or null
 *  when the two endpoints coincide. */
interface DirectionEval {
    evalDir(tSec: number): Vector3 | null;
}

/** A camera view that follows one or more scene elements. */
interface FollowViewSpec {
    follow?: unknown;
    offset?: number[];
    up?: unknown;
    /** Set by buildCameraButtons so the button can toggle itself off. */
    _viewKey?: string;
    [field: string]: unknown;
}

/** The live follow-cam, rebuilt on every activate. */
interface FollowCamStateShape {
    followTargets: string[];
    offset: number[];
    up: number[];
    exprStrings: string[] | null;
    compiledExprs: CompiledExpr[] | null;
    fromExprStrings: string[] | null;
    compiledFromExprs: CompiledExpr[] | null;
    /** Smoothing anchors, advanced each frame. */
    lastTargetWorld: Vector3;
    lastDirectionWorld: Vector3 | null;
    /** Angle-lock frame: the axis to rotate about and the point to rotate around. */
    axisWorld: Vector3;
    axisCenterWorld: Vector3;
    /** The two ways a lock direction can be sourced, in preference order. */
    vectorTargets: string[] | null;
    directionTargets: string[] | null;
    directionEval: DirectionEval | null;
    /** Animation start time to align the angle-lock phase against. */
    refStartTime: number;
    /** Which camera button activated this, so it can toggle itself off.
     *  `null` (not undefined) when activated without one — preserved verbatim. */
    viewKey: string | null;
}

// state.js is still untyped JavaScript, so its fields infer from their
// initializers. Describe the slice this module owns rather than spreading
// `any`; the cast goes away when state.js is converted.
interface FollowCamState {
    currentSpec: FollowScene | null | undefined;
    lessonSpec: { scenes?: FollowScene[] } | null | undefined;
    camera: (import('three').Camera & { updateProjectionMatrix(): void }) | null;
    controls: ThreeControls | null;
    sceneUp: number[];
    animatedElementPos: Record<string, AnimPosEntry | undefined>;
    followCamState: FollowCamStateShape | null;
    followCamStartTime: number;
    followCamAngleLock: boolean;
    followCamSavedControls: { enableDamping?: boolean; dampingFactor?: number } | null;
}
const followState = state as unknown as FollowCamState;

export function findElementSpecById(id: string): FollowElement | null {
    if (!followState.currentSpec) return null;
    for (const el of (followState.currentSpec.elements || [])) {
        if (el.id === id) return el;
    }
    for (const step of (followState.currentSpec.steps || [])) {
        for (const el of (step.add || [])) {
            if (el.id === id) return el;
        }
    }
    for (const scene of (followState.lessonSpec && followState.lessonSpec.scenes || [])) {
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

function _normalizeExprTriplet(triplet: unknown): string[] | null {
    if (!Array.isArray(triplet) || triplet.length !== 3) return null;
    return triplet.map(v => (typeof v === 'number' ? String(v) : v));
}

function _getElementPosExprTriplet(el: FollowElement | null | undefined): string[] | null {
    if (!el) return null;
    return _normalizeExprTriplet(el.expr || el.toExpr || el.centerExpr)
        || (Array.isArray(el.center) && el.center.length === 3 ? _normalizeExprTriplet(el.center) : null)
        || (Array.isArray(el.points) && el.points.length > 0 ? _normalizeExprTriplet(el.points[0]) : null);
}

function _getElementFromExprTriplet(el: FollowElement | null | undefined): string[] | null {
    if (!el) return null;
    return _normalizeExprTriplet(el.fromExpr)
        || (Array.isArray(el.points) && el.points.length > 1 ? _normalizeExprTriplet(el.points[1]) : null);
}

export function activateFollowCam(viewSpec: FollowViewSpec): void {
    const followTargets = Array.isArray(viewSpec.follow) ? viewSpec.follow : [viewSpec.follow];
    const offset = viewSpec.offset || [0, 0, 30];

    let el = null;
    for (const tid of followTargets) {
        const candidate = findElementSpecById(tid);
        if (!candidate) continue;
        const hasExpr = _getElementPosExprTriplet(candidate) !== null;
        if (hasExpr) { el = candidate; break; }
    }
    if (!el) {
        console.warn('follow-cam: no element with a valid expression found for targets:', followTargets);
        return;
    }

    let exprStrings = _getElementPosExprTriplet(el);
    let fromExprStrings = _getElementFromExprTriplet(el);
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

    const up = Array.isArray(viewSpec.up) ? viewSpec.up.slice(0, 3) : followState.sceneUp.slice(0, 3);
    // Locals, because Array.isArray() narrows the expression it is given, not
    // the underlying `unknown`-typed property on a later line.
    const viewAxis = viewSpec.angleLockAxis as unknown[] | undefined;
    const sceneAxis = (followState.currentSpec && followState.currentSpec.angleLockAxis) as unknown[] | undefined;
    const angleLockAxisData = (Array.isArray(viewAxis) && viewAxis.length === 3)
        ? viewAxis.slice(0, 3)
        : (Array.isArray(sceneAxis) && sceneAxis.length === 3)
            ? sceneAxis.slice(0, 3)
            : followState.sceneUp.slice(0, 3);
    const angleLockDirectionTargets = (Array.isArray(viewSpec.angleLockDirection) && viewSpec.angleLockDirection.length === 2)
        ? viewSpec.angleLockDirection.slice(0, 2) : null;
    const angleLockDirectionVectorTargets = (typeof viewSpec.angleLockDirection === 'string' && viewSpec.angleLockDirection.trim())
        ? [viewSpec.angleLockDirection.trim()] : null;
    const angleLockVectorTargets = Array.isArray(viewSpec.angleLockVector)
        ? viewSpec.angleLockVector.slice()
        : (typeof viewSpec.angleLockVector === 'string' && viewSpec.angleLockVector.trim())
            ? [viewSpec.angleLockVector.trim()] : null;
    let resolvedAngleLockVectorTargets = angleLockVectorTargets || angleLockDirectionVectorTargets;
    if (!resolvedAngleLockVectorTargets && el && (el.type === 'animated_vector' || el.type === 'vector')) {
        resolvedAngleLockVectorTargets = [el.id];
    }

    let initDataPos: number[];
    const freshEntry = _getFreshAnimEntry(followTargets);
    if (freshEntry) {
        initDataPos = freshEntry.pos;
    } else {
        try {
            initDataPos = compiledExprs.map(fn => evalExpr(fn, 0) as number);
        } catch (err) {
            initDataPos = [0, 0, 0];
        }
    }
    const initTargetWorld = dataToWorld(initDataPos as Vec3);
    const initCamDataPos = [
        // Non-null: both are three-element data triplets by construction.
        initDataPos[0]! + offset[0]!,
        initDataPos[1]! + offset[1]!,
        initDataPos[2]! + offset[2]!,
    ];
    const initCamWorld = dataToWorld(initCamDataPos as Vec3);

    if (followState.camera && followState.controls) {
        followState.camera.position.set(initCamWorld[0], initCamWorld[1], initCamWorld[2]);
        followState.controls.target.set(initTargetWorld[0], initTargetWorld[1], initTargetWorld[2]);
        followState.camera.up.copy(_normalizeUpVector(up));
        followState.camera.lookAt(followState.controls.target);
        followState.controls.update();
    }

    let directionEval: DirectionEval | null = null;
    if (resolvedAngleLockVectorTargets) {
        for (const vid of resolvedAngleLockVectorTargets) {
            const vel = findElementSpecById(vid);
            if (!vel) continue;
            const toStr = _getElementPosExprTriplet(vel);
            const fromStr = _getElementFromExprTriplet(vel)
                || ['0', '0', '0'];
            if (!toStr) continue;
            try {
                const toFns = toStr.map(e => compileExpr(e));
                const fromFns = fromStr.map(e => compileExpr(e));
                directionEval = {
                    evalDir(tSec: number) {
                        const to = toFns.map(fn => evalExpr(fn, tSec) as number);
                        const from = fromFns.map(fn => evalExpr(fn, tSec) as number);
                        const d = new THREE.Vector3(to[0]! - from[0]!, to[1]! - from[1]!, to[2]! - from[2]!);
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
        const aStr = aEl ? _getElementPosExprTriplet(aEl) : null;
        const bStr = bEl ? _getElementPosExprTriplet(bEl) : null;
        if (aStr && bStr) {
            try {
                const aFns = aStr.map(e => compileExpr(e));
                const bFns = bStr.map(e => compileExpr(e));
                directionEval = {
                    evalDir(tSec: number) {
                        const a = aFns.map(fn => evalExpr(fn, tSec) as number);
                        const b = bFns.map(fn => evalExpr(fn, tSec) as number);
                        const d = new THREE.Vector3(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
                        const len = d.length();
                        return len > 1e-8 ? d.multiplyScalar(1 / len) : null;
                    }
                };
            } catch (err) { /* fall back to live tracking */ }
        }
    }

    followState.followCamState = {
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
        refStartTime: (freshEntry && Number.isFinite(freshEntry.startTime)) ? freshEntry.startTime! : performance.now(),
        viewKey: (viewSpec && viewSpec._viewKey) ? viewSpec._viewKey : null,
    };
    followState.followCamStartTime = performance.now();
    console.log('🎥 follow-cam activated for targets:', followTargets);
    if (followState.controls && Object.prototype.hasOwnProperty.call(followState.controls, 'enableDamping')) {
        followState.followCamSavedControls = {
            enableDamping: !!followState.controls.enableDamping,
            dampingFactor: Number.isFinite(followState.controls.dampingFactor) ? followState.controls.dampingFactor : 0,
        };
        followState.controls.enableDamping = false;
    }
    updateFollowAngleLockButtonState();
}

export function deactivateFollowCam(): void {
    if (!followState.followCamState) return;
    followState.followCamState = null;
    if (followState.controls && followState.followCamSavedControls) {
        if (Object.prototype.hasOwnProperty.call(followState.controls, 'enableDamping')) {
            followState.controls.enableDamping = followState.followCamSavedControls.enableDamping;
            if (Number.isFinite(followState.followCamSavedControls.dampingFactor)) {
                followState.controls.dampingFactor = followState.followCamSavedControls.dampingFactor;
            }
        }
    }
    followState.followCamSavedControls = null;
    console.log('🎥 follow-cam deactivated');
    updateFollowAngleLockButtonState();
}

function _getFreshAnimEntry(targets: string[]): AnimPosEntry | null {
    let best: AnimPosEntry | null = null;
    for (const tid of targets) {
        const entry = followState.animatedElementPos[tid];
        if (entry && performance.now() - entry.time < 500) {
            if (!best || entry.time > best.time) best = entry;
        }
    }
    return best;
}

function _getLatestAnimEntry(targets: string[]): AnimPosEntry | null {
    let best: AnimPosEntry | null = null;
    for (const tid of targets) {
        const entry = followState.animatedElementPos[tid];
        if (entry) {
            if (!best || entry.time > best.time) best = entry;
        }
    }
    return best;
}

function _computeDerivedDirectionWorld(targets: string[]): Vector3 | null {
    if (!Array.isArray(targets) || targets.length < 2) return null;
    // Non-null indexes: the length check above proves both ends exist.
    const first = followState.animatedElementPos[targets[0]!];
    const last  = followState.animatedElementPos[targets[targets.length - 1]!];
    if (!first || !last) return null;

    const firstIsVec = first.from !== undefined;
    const lastIsVec  = last.from  !== undefined;
    let fromPos, toPos;

    if (!firstIsVec && !lastIsVec) {
        fromPos = first.pos; toPos = last.pos;
    } else if (firstIsVec && !lastIsVec) {
        fromPos = first.from!; toPos = last.pos;
    } else if (!firstIsVec && lastIsVec) {
        fromPos = first.pos; toPos = last.pos;
    } else {
        const v1d = [first.pos[0]!-first.from![0]!, first.pos[1]!-first.from![1]!, first.pos[2]!-first.from![2]!];
        const v2d = [last.pos[0]!-last.from![0]!,   last.pos[1]!-last.from![1]!,   last.pos[2]!-last.from![2]!];
        fromPos = first.from!;
        toPos   = [first.from![0]!+v1d[0]!+v2d[0]!, first.from![1]!+v1d[1]!+v2d[1]!, first.from![2]!+v1d[2]!+v2d[2]!];
    }

    const fromW = new THREE.Vector3(...dataToWorld(fromPos as Vec3));
    const toW   = new THREE.Vector3(...dataToWorld(toPos as Vec3));
    const dir = toW.sub(fromW);
    return dir.length() > 1e-6 ? dir.normalize() : null;
}

function _computeDerivedTargetPos(targets: string[]): number[] | null {
    if (!Array.isArray(targets) || targets.length === 0) return null;
    if (targets.length === 1) {
        const e = followState.animatedElementPos[targets[0]!];
        return e ? e.pos : null;
    }
    const first = followState.animatedElementPos[targets[0]!];
    const last  = followState.animatedElementPos[targets[targets.length - 1]!];
    if (!first && !last) return null;
    if (!first) return last!.pos;
    if (!last)  return first.pos;

    const firstIsVec = first.from !== undefined;
    const lastIsVec  = last.from  !== undefined;
    let fromPos, toPos;

    if (!firstIsVec && !lastIsVec) {
        fromPos = first.pos; toPos = last.pos;
    } else if (firstIsVec && !lastIsVec) {
        fromPos = first.from!; toPos = last.pos;
    } else if (!firstIsVec && lastIsVec) {
        fromPos = first.pos; toPos = last.pos;
    } else {
        const v1d = [first.pos[0]!-first.from![0]!, first.pos[1]!-first.from![1]!, first.pos[2]!-first.from![2]!];
        const v2d = [last.pos[0]!-last.from![0]!,   last.pos[1]!-last.from![1]!,   last.pos[2]!-last.from![2]!];
        fromPos = first.from!;
        toPos   = [first.from![0]!+v1d[0]!+v2d[0]!, first.from![1]!+v1d[1]!+v2d[1]!, first.from![2]!+v1d[2]!+v2d[2]!];
    }
    return [
        (fromPos[0]! + toPos[0]!) / 2,
        (fromPos[1]! + toPos[1]!) / 2,
        (fromPos[2]! + toPos[2]!) / 2,
    ];
}

function _getDirectionWorldFromTargets(targetPair: string[] | null): Vector3 | null {
    if (!Array.isArray(targetPair) || targetPair.length !== 2) return null;
    const fromEntry = _getFreshAnimEntry([targetPair[0]!]);
    const toEntry = _getFreshAnimEntry([targetPair[1]!]);
    if (!fromEntry || !toEntry) return null;
    const fromWorld = new THREE.Vector3(...dataToWorld(fromEntry.pos as Vec3));
    const toWorld = new THREE.Vector3(...dataToWorld(toEntry.pos as Vec3));
    const dir = toWorld.sub(fromWorld);
    const len = dir.length();
    if (len < 1e-8) return null;
    return dir.multiplyScalar(1 / len);
}

function _getDirectionWorldFromVectorTargets(vectorTargets: string[] | null): Vector3 | null {
    if (!Array.isArray(vectorTargets) || vectorTargets.length === 0) return null;
    for (const vid of vectorTargets) {
        const entry = _getFreshAnimEntry([vid]);
        if (!entry) continue;
        if (Array.isArray(entry.from) && entry.from.length === 3 && Array.isArray(entry.to) && entry.to.length === 3) {
            const fromWorld = new THREE.Vector3(...dataToWorld(entry.from as Vec3));
            const toWorld = new THREE.Vector3(...dataToWorld(entry.to as Vec3));
            const dir = toWorld.sub(fromWorld);
            const len = dir.length();
            if (len > 1e-8) return dir.multiplyScalar(1 / len);
        }
    }
    return null;
}

export function updateFollowCam(): void {
    if (!followState.followCamState || !followState.camera || !followState.controls) return;
    const { followTargets, compiledExprs } = followState.followCamState;

    let targetDataPos;
    const tSecRef = (performance.now() - (followState.followCamState.refStartTime || followState.followCamStartTime)) / 1000;
    const latest = _getLatestAnimEntry(followTargets);
    if (!followState.followCamAngleLock && latest) {
        targetDataPos = latest.pos;
    }
    if (!targetDataPos && followState.followCamAngleLock && compiledExprs) {
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
            if (followState.animatedElementPos[tid]) { staleEntry = followState.animatedElementPos[tid]; break; }
        }
        if (staleEntry && compiledExprs) {
            const tSec = (performance.now() - staleEntry.startTime!) / 1000;
            try { targetDataPos = compiledExprs.map(fn => evalExpr(fn, tSec)); }
            catch (err) { return; }
        } else if (compiledExprs) {
            const tSec = (performance.now() - followState.followCamStartTime) / 1000;
            try { targetDataPos = compiledExprs.map(fn => evalExpr(fn, tSec)); }
            catch (err) { return; }
        } else {
            return;
        }
    }

    const newTargetWorld = new THREE.Vector3(...dataToWorld(targetDataPos as Vec3));
    const oldTargetWorld = followState.followCamState.lastTargetWorld.clone();
    const delta = newTargetWorld.clone().sub(oldTargetWorld);

    followState.camera.position.add(delta);
    followState.controls.target.copy(newTargetWorld);

    if (followState.followCamAngleLock) {
        const axis = followState.followCamState.axisWorld;
        const center = followState.followCamState.axisCenterWorld;
        const oldDir = followState.followCamState.lastDirectionWorld ? followState.followCamState.lastDirectionWorld.clone() : null;
        const newDir = (followState.followCamState.directionEval && typeof followState.followCamState.directionEval.evalDir === 'function')
            ? followState.followCamState.directionEval.evalDir(tSecRef)
            : (_computeDerivedDirectionWorld(followTargets)
                || _getDirectionWorldFromVectorTargets(followState.followCamState.vectorTargets)
                || _getDirectionWorldFromTargets(followState.followCamState.directionTargets));
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
                const offset = followState.camera.position.clone().sub(newTargetWorld);
                offset.applyAxisAngle(axis, dAngle);
                followState.camera.position.copy(newTargetWorld).add(offset);
                followState.camera.up.applyAxisAngle(axis, dAngle).normalize();
            }
        }
        if (newDir) followState.followCamState.lastDirectionWorld = newDir;
    }
    followState.camera.lookAt(followState.controls.target);
    followState.followCamState.lastTargetWorld.copy(newTargetWorld);
}

export function updateFollowAngleLockButtonState(): void {
    const btn = document.getElementById('follow-angle-lock-toggle');
    if (!btn) return;
    btn.classList.toggle('active', !!followState.followCamAngleLock);
    btn.classList.toggle('cam-active', !!followState.followCamState);
    if (followState.followCamState) {
        btn.title = followState.followCamAngleLock
            ? 'Angle-lock ON: camera rotates with followed object'
            : 'Angle-lock OFF: camera follows position only';
    } else {
        btn.title = followState.followCamAngleLock
            ? 'Angle-lock armed (applies in follow-cam views)'
            : 'Toggle angle-lock for follow camera';
    }
}

export function setupFollowAngleLockToggle(): void {
    const btn = document.getElementById('follow-angle-lock-toggle');
    if (!btn) return;
    btn.innerHTML = ANGLE_LOCK_ICON;
    btn.style.display = 'flex';
    btn.addEventListener('click', () => {
        followState.followCamAngleLock = !followState.followCamAngleLock;
        updateFollowAngleLockButtonState();
    });
    updateFollowAngleLockButtonState();
}

// Normalize a data-space up vector to a THREE.Vector3
function _normalizeUpVector(up: unknown): Vector3 {
    const raw = Array.isArray(up) && up.length === 3 ? up : [0, 1, 0];
    const v = new THREE.Vector3(raw[0], raw[1], raw[2]);
    if (v.lengthSq() < 1e-12) return new THREE.Vector3(0, 1, 0);
    return v.normalize();
}
