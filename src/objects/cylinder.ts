import { state } from '/state.js';
import { parseColor, addLabel3D } from '/labels.js';
import { dataToWorld } from '/coords.js';
import type { Vec3 } from '/coords.js';
import type { Element } from '/types/lesson.js';
import type { MeshPhongMaterialParameters, Object3D, Scene } from 'three';

/** parseColor returns `number[]`; spreading into `new THREE.Color(...)` needs a tuple. */
type Rgb3 = [number, number, number];

/** The slice of the shared state object this module touches. */
interface CylinderState {
    three: { scene: Scene };
    planeMeshes: Object3D[];
}
const cylinderState = state as unknown as CylinderState;

function _axisToDataDir(axis: string): Vec3 {
    if (axis === 'x') return [1, 0, 0];
    if (axis === 'y') return [0, 1, 0];
    return [0, 0, 1];
}

export function _resolveCylinderDataEndpoints(el: Element): { from: Vec3; to: Vec3 } {
    const from = Array.isArray(el.from) ? el.from.slice(0, 3) as Vec3 : null;
    const to = Array.isArray(el.to) ? el.to.slice(0, 3) as Vec3 : null;
    if (from && to) return { from, to };

    const center = (Array.isArray(el.center) ? el.center.slice(0, 3)
        : (Array.isArray(el.position) ? el.position.slice(0, 3) : [0, 0, 0])) as Vec3;
    const h = el.height !== undefined ? el.height : 1;
    const dir = _axisToDataDir(el.axis || 'z');
    const half = h / 2;
    return {
        from: [center[0] - dir[0] * half, center[1] - dir[1] * half, center[2] - dir[2] * half],
        to:   [center[0] + dir[0] * half, center[1] + dir[1] * half, center[2] + dir[2] * half],
    };
}

export function _setCylinderTransformFromData(mesh: Object3D, fromData: Vec3, toData: Vec3, radiusData: number) {
    const fromW = new THREE.Vector3(...dataToWorld(fromData));
    const toW = new THREE.Vector3(...dataToWorld(toData));
    const delta = new THREE.Vector3().subVectors(toW, fromW);
    const len = Math.max(delta.length(), 0.0001);
    const dir = delta.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const center = new THREE.Vector3().addVectors(fromW, toW).multiplyScalar(0.5);

    const dx = (toData[0] - fromData[0]);
    const dy = (toData[1] - fromData[1]);
    const dz = (toData[2] - fromData[2]);
    const dataDir = new THREE.Vector3(dx, dy, dz);
    if (dataDir.lengthSq() < 1e-12) dataDir.set(0, 0, 1);
    dataDir.normalize();
    const basis = Math.abs(dataDir.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const perpData = new THREE.Vector3().crossVectors(dataDir, basis).normalize();
    const radiusDataSafe = isFinite(radiusData) ? Number(radiusData) : 0;
    const sampleData: Vec3 = [
        fromData[0] + perpData.x * radiusDataSafe,
        fromData[1] + perpData.y * radiusDataSafe,
        fromData[2] + perpData.z * radiusDataSafe,
    ];
    const sampleW = new THREE.Vector3(...dataToWorld(sampleData));
    const rWorld = Math.max(sampleW.distanceTo(fromW), 0.0005);

    mesh.position.copy(center);
    mesh.setRotationFromQuaternion(quat);
    mesh.scale.set(rWorld, len, rWorld);
}

export function renderCylinder(el: Element, view: MathBoxNode) {
    const color = parseColor(el.color || '#88aaff') as Rgb3;
    // `opacity` is `number | string` on the schema (animated elements accept an
    // expression); the static cylinder never animates it.
    const opacity = (el.opacity !== undefined ? el.opacity : 0.35) as number;
    const radius = el.radius !== undefined ? el.radius : 1;
    const radialSegments = el.radialSegments || 32;
    const openEnded = !!el.openEnded;
    const label = el.label;

    const { from, to } = _resolveCylinderDataEndpoints(el);

    const geom = new THREE.CylinderGeometry(1, 1, 1, radialSegments, 1, openEnded);
    const matType = (el.shader && el.shader.type === 'basic') ? THREE.MeshBasicMaterial : THREE.MeshPhongMaterial;
    const matOpts: MeshPhongMaterialParameters = {
        color: new THREE.Color(...color),
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide,
    };
    const sh = el.shader || {};
    if (sh.depthWrite !== undefined) matOpts.depthWrite = !!sh.depthWrite;
    if (sh.depthTest !== undefined) matOpts.depthTest = !!sh.depthTest;
    if (matType === THREE.MeshPhongMaterial) {
        matOpts.shininess = sh.shininess !== undefined ? sh.shininess : 40;
        if (sh.emissive) matOpts.emissive = new THREE.Color(sh.emissive);
        if (sh.specular) matOpts.specular = new THREE.Color(sh.specular);
        if (sh.flatShading) matOpts.flatShading = true;
    }
    const mat = new matType(matOpts);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.targetOpacity = opacity;
    _setCylinderTransformFromData(mesh, from, to, radius);
    cylinderState.three.scene.add(mesh);
    cylinderState.planeMeshes.push(mesh);

    if (label) {
        const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
        addLabel3D(label, mid, color);
    }

    return { type: 'cylinder', color, label };
}
