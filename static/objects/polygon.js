import { state } from '/state.js';
import { parseColor, addLabel3D } from '/labels.js';
import { dataToWorld, dataLenToWorld } from '/coords.js';

export function renderPolygon(el, view) {
    const color = parseColor(el.color || '#aa66ff');
    const opacity = el.opacity !== undefined ? el.opacity : 0.5;
    const thickness = el.thickness || 0.02;

    let vertices;
    if (el.regular && typeof el.regular === 'object') {
        const reg = el.regular;
        const N   = Math.max(3, Math.round(Number(reg.n) || 3));
        const r   = Number(reg.radius != null ? reg.radius : 1);
        const cx  = Array.isArray(reg.center) ? Number(reg.center[0] ?? 0) : 0;
        const cy  = Array.isArray(reg.center) ? Number(reg.center[1] ?? 0) : 0;
        const cz  = Array.isArray(reg.center) ? Number(reg.center[2] ?? 0) : 0;
        const rot = Number(reg.rotation ?? 0);
        vertices = [];
        for (let k = 0; k < N; k++) {
            const angle = rot + (2 * Math.PI * k) / N;
            vertices.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle), cz]);
        }
    } else {
        vertices = el.vertices || el.points || [[0,0,0],[1,0,0],[1,1,0],[0,1,0]];
    }
    const label = el.label;

    const wVerts = vertices.map(v => dataToWorld(v));

    const a = new THREE.Vector3(wVerts[1][0]-wVerts[0][0], wVerts[1][1]-wVerts[0][1], wVerts[1][2]-wVerts[0][2]);
    const b = new THREE.Vector3(wVerts[2][0]-wVerts[0][0], wVerts[2][1]-wVerts[0][1], wVerts[2][2]-wVerts[0][2]);
    const normal = a.cross(b).normalize();

    const baseHalf = dataLenToWorld(thickness / 2);

    function buildSlabGeometry(halfThick) {
        const positions = [];
        const top = wVerts.map(v => [v[0]+normal.x*halfThick, v[1]+normal.y*halfThick, v[2]+normal.z*halfThick]);
        const bot = wVerts.map(v => [v[0]-normal.x*halfThick, v[1]-normal.y*halfThick, v[2]-normal.z*halfThick]);

        for (let i = 1; i < top.length - 1; i++) {
            positions.push(...top[0], ...top[i], ...top[i+1]);
        }
        for (let i = 1; i < bot.length - 1; i++) {
            positions.push(...bot[0], ...bot[i+1], ...bot[i]);
        }
        for (let i = 0; i < wVerts.length; i++) {
            const j = (i + 1) % wVerts.length;
            positions.push(...top[i], ...bot[i], ...top[j]);
            positions.push(...top[j], ...bot[i], ...bot[j]);
        }
        return positions;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(buildSlabGeometry(baseHalf * state.displayParams.planeScale), 3));
    geom.computeVertexNormals();

    const sh = el.shader || {};
    const matType = sh.type === 'basic' ? THREE.MeshBasicMaterial : THREE.MeshPhongMaterial;
    const matOpts = {
        color: new THREE.Color(...color),
        opacity: state.displayParams.planeOpacity,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
    };
    if (matType === THREE.MeshPhongMaterial) {
        matOpts.shininess = sh.shininess !== undefined ? sh.shininess : 30;
        if (sh.emissive) matOpts.emissive = new THREE.Color(sh.emissive);
        if (sh.specular) matOpts.specular = new THREE.Color(sh.specular);
        if (sh.flatShading) matOpts.flatShading = true;
    }
    const mat = new matType(matOpts);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.targetOpacity = opacity;
    mesh.userData.baseHalf = baseHalf;
    mesh.userData.wVerts = wVerts;
    mesh.userData.normal = normal.clone();
    mesh.userData.buildSlab = buildSlabGeometry;
    const _serial = el.renderOrder !== undefined ? el.renderOrder : state._planeMeshSerial++;
    mesh.renderOrder = _serial;
    mesh.position.z = el.depthZ !== undefined ? el.depthZ : _serial * 0.0002;
    state.three.scene.add(mesh);
    state.planeMeshes.push(mesh);

    if (label) {
        const cx = vertices.reduce((s, v) => s + v[0], 0) / vertices.length;
        const cy = vertices.reduce((s, v) => s + v[1], 0) / vertices.length;
        const cz = vertices.reduce((s, v) => s + v[2], 0) / vertices.length;
        addLabel3D(label, [cx, cy, cz], color);
    }

    const outlineWidthVal = el.outlineWidth != null ? Number(el.outlineWidth) : (el.regular ? 1.5 : 0);
    if (outlineWidthVal > 0 && view) {
        const outlineColor = parseColor(el.outlineColor || el.color || '#aa66ff');
        const outlineOpacity = el.outlineOpacity != null ? Number(el.outlineOpacity) : Math.min(1, opacity * 2);
        const pts = vertices.slice();
        pts.push(pts[0]);
        view.array({ channels: 3, width: pts.length, data: pts })
            .line({ color: new THREE.Color(...outlineColor), width: outlineWidthVal, opacity: outlineOpacity, zBias: 2 });
    }

    return { type: 'polygon', color, label };
}
