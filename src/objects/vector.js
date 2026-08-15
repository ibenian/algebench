import { state } from '/state.js';
import { parseColor, addLabel3D } from '/labels.js';
import { dataToWorld } from '/coords.js';
import {
    resolveArrowSizeScale, resolveSmallVectorAutoScale, applyShaftThickness,
    ARROW_HEAD_MIN_FACTOR, ARROW_HEAD_MAX_FACTOR, ARROW_HEAD_RADIUS_RATIO,
    SHAFT_RADIUS_TO_HEAD_RADIUS_RATIO, SHAFT_CONE_OVERLAP_HEAD_RATIO,
} from '/camera.js';

export function makeArrowMesh(from, to, color, sizeScale, shaftBaseScale, baseOpacity = 1) {
    sizeScale = resolveArrowSizeScale(sizeScale);
    shaftBaseScale = shaftBaseScale || 1;

    const tipWorld = dataToWorld(to);
    const fromWorld = dataToWorld(from);
    const wdx = tipWorld[0]-fromWorld[0], wdy = tipWorld[1]-fromWorld[1], wdz = tipWorld[2]-fromWorld[2];
    const wLen = Math.sqrt(wdx*wdx + wdy*wdy + wdz*wdz);
    if (wLen < 0.0001) return;

    const currentScale = state.currentScale;
    const worldSceneSize = Math.min(currentScale[0], currentScale[1]) * 2;
    const baseHeadLen = Math.max(Math.min(wLen * 0.25, worldSceneSize * ARROW_HEAD_MAX_FACTOR), worldSceneSize * ARROW_HEAD_MIN_FACTOR) * sizeScale;
    const autoScale = resolveSmallVectorAutoScale(wLen, baseHeadLen);
    const wHeadLen = baseHeadLen * autoScale;
    const wHeadRadius = wHeadLen * ARROW_HEAD_RADIUS_RATIO;
    const overlapLen = Math.max(wHeadLen * SHAFT_CONE_OVERLAP_HEAD_RATIO, 0.0);

    const shaftLen = Math.max(wLen - wHeadLen + overlapLen, 0.0001);
    const shaftRadius = wHeadRadius * SHAFT_RADIUS_TO_HEAD_RADIUS_RATIO;
    const dir = new THREE.Vector3(wdx/wLen, wdy/wLen, wdz/wLen);

    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);

    const shaftGeom = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLen, 16);
    const shaftOpacity = Math.max(0, Math.min(1, Number.isFinite(baseOpacity) ? baseOpacity : 1));
    const shaftMat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(...color),
        shininess: 60,
        transparent: shaftOpacity < 0.999,
        opacity: shaftOpacity,
    });
    const shaft = new THREE.Mesh(shaftGeom, shaftMat);
    shaft.position.set(
        fromWorld[0] + dir.x * shaftLen / 2,
        fromWorld[1] + dir.y * shaftLen / 2,
        fromWorld[2] + dir.z * shaftLen / 2,
    );
    shaft.setRotationFromQuaternion(quat);
    shaft.userData.baseThicknessScale = shaftBaseScale;
    shaft.userData.autoThicknessScale = autoScale;
    shaft.userData.lengthScale = 1;
    shaft.userData.baseShaftRadius = shaftRadius;
    shaft.userData.maxRadiusFromHead = wHeadRadius * 0.75;
    applyShaftThickness(shaft);
    state.three.scene.add(shaft);
    const arrowPair = {
        fromWorld: new THREE.Vector3(...fromWorld),
        tipWorld: new THREE.Vector3(...tipWorld),
        dir: dir.clone(),
        baseHeadLen: wHeadLen,
        baseShaftLen: shaftLen,
        dynamic: false,
    };
    shaft.userData.arrowPair = arrowPair;
    shaft.userData.baseOpacity = shaftOpacity;
    state.arrowMeshes.push({ mesh: shaft, tipWorld: new THREE.Vector3(fromWorld[0] + dir.x*shaftLen, fromWorld[1] + dir.y*shaftLen, fromWorld[2] + dir.z*shaftLen), dir: dir.clone(), wLen: shaftLen, isShaft: true });

    const coneGeom = new THREE.ConeGeometry(wHeadRadius, wHeadLen, 16);
    const coneOpacity = Math.max(0, Math.min(1, Number.isFinite(baseOpacity) ? baseOpacity : 1));
    const coneMat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(...color),
        shininess: 60,
        transparent: coneOpacity < 0.999,
        opacity: coneOpacity,
    });
    const cone = new THREE.Mesh(coneGeom, coneMat);
    cone.position.set(
        tipWorld[0] - dir.x * wHeadLen / 2,
        tipWorld[1] - dir.y * wHeadLen / 2,
        tipWorld[2] - dir.z * wHeadLen / 2,
    );
    cone.setRotationFromQuaternion(quat);
    cone.userData.arrowPair = arrowPair;
    cone.userData.baseOpacity = coneOpacity;
    arrowPair.shaft = shaft;
    arrowPair.cone = cone;
    state.three.scene.add(cone);
    state.arrowMeshes.push({ mesh: cone, tipWorld: new THREE.Vector3(...tipWorld), dir: dir.clone(), wLen: wHeadLen });
}

export function renderVector(el, view) {
    const from = el.origin || el.from || [0, 0, 0];
    const to = el.to || [1, 0, 0];
    const color = parseColor(el.color || '#ff6644');
    const label = el.label;
    const elementOpacity = (typeof el.opacity === 'number' && isFinite(el.opacity))
        ? Math.max(0, Math.min(1, el.opacity))
        : 1;
    const shaftBaseScale = 1;

    makeArrowMesh(from, to, color, state.displayParams.arrowScale, shaftBaseScale, elementOpacity);

    if (label) {
        const lo = (Array.isArray(el.labelOffset) && el.labelOffset.length === 3)
            ? [Number(el.labelOffset[0]) || 0, Number(el.labelOffset[1]) || 0, Number(el.labelOffset[2]) || 0] : null;
        if (el.labelPosition) {
            addLabel3D(label, el.labelPosition, color);
        } else {
            const mid = [
                (from[0] + to[0]) / 2 + (lo ? lo[0] : 0),
                (from[1] + to[1]) / 2 + 0.15 + (lo ? lo[1] : 0),
                (from[2] + to[2]) / 2 + (lo ? lo[2] : 0)
            ];
            addLabel3D(label, mid, color);
        }
    }

    return { type: 'vector', color, label };
}

