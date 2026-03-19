import { state } from '/state.js';
import { parseColor, addLabel3D } from '/labels.js';
import { dataToWorld, dataLenToWorld } from '/coords.js';

// ── Shared noise texture (generated once, reused across all standard-shaded polygons) ──
let _noiseTexture = null;
function _getNoiseTexture() {
    if (_noiseTexture) return _noiseTexture;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
        const v = 205 + Math.floor(Math.random() * 50); // 205-254: subtle grain
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    _noiseTexture = new THREE.CanvasTexture(canvas);
    _noiseTexture.wrapS = _noiseTexture.wrapT = THREE.RepeatWrapping;
    return _noiseTexture;
}

// Project polygon world-space vertices onto the polygon plane as normalised [0,1] UVs.
// Aspect-ratio-preserving: both axes divided by the larger extent so the grain is isotropic.
function _computePlaneUVs(wVerts, normal) {
    const n = normal.clone().normalize();
    const v0 = new THREE.Vector3(wVerts[0][0], wVerts[0][1], wVerts[0][2]);
    // Tangent = edge 0→1 projected perpendicular to normal
    const tang = new THREE.Vector3(
        wVerts[1][0] - wVerts[0][0],
        wVerts[1][1] - wVerts[0][1],
        wVerts[1][2] - wVerts[0][2],
    );
    tang.addScaledVector(n, -tang.dot(n));
    if (tang.length() < 1e-9) return wVerts.map(() => [0, 0]);
    tang.normalize();
    const bitang = new THREE.Vector3().crossVectors(n, tang);

    const proj = wVerts.map(v => {
        const dx = v[0] - v0.x, dy = v[1] - v0.y, dz = v[2] - v0.z;
        return [dx * tang.x + dy * tang.y + dz * tang.z,
                dx * bitang.x + dy * bitang.y + dz * bitang.z];
    });
    const minU = Math.min(...proj.map(p => p[0]));
    const minV = Math.min(...proj.map(p => p[1]));
    const maxU = Math.max(...proj.map(p => p[0]));
    const maxV = Math.max(...proj.map(p => p[1]));
    const scale = Math.max(maxU - minU, maxV - minV) || 1;
    return proj.map(([u, v]) => [(u - minU) / scale, (v - minV) / scale]);
}

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

    const sh = el.shader || {};
    const isStandard = sh.type === 'standard';
    const planeUVs = isStandard ? _computePlaneUVs(wVerts, normal) : null;

    function buildSlabGeometry(halfThick) {
        const positions = [];
        const uvData = isStandard ? [] : null;
        const top = wVerts.map(v => [v[0]+normal.x*halfThick, v[1]+normal.y*halfThick, v[2]+normal.z*halfThick]);
        const bot = wVerts.map(v => [v[0]-normal.x*halfThick, v[1]-normal.y*halfThick, v[2]-normal.z*halfThick]);

        // Top face (fan)
        for (let i = 1; i < top.length - 1; i++) {
            positions.push(...top[0], ...top[i], ...top[i+1]);
            if (uvData) uvData.push(...planeUVs[0], ...planeUVs[i], ...planeUVs[i+1]);
        }
        // Bottom face (fan, reversed winding)
        for (let i = 1; i < bot.length - 1; i++) {
            positions.push(...bot[0], ...bot[i+1], ...bot[i]);
            if (uvData) uvData.push(...planeUVs[0], ...planeUVs[i+1], ...planeUVs[i]);
        }
        // Side faces (thin — degenerate UVs are fine)
        for (let i = 0; i < wVerts.length; i++) {
            const j = (i + 1) % wVerts.length;
            positions.push(...top[i], ...bot[i], ...top[j]);
            positions.push(...top[j], ...bot[i], ...bot[j]);
            if (uvData) { uvData.push(0,0, 0,0, 0,0,  0,0, 0,0, 0,0); }
        }
        return { positions, uvData };
    }

    const geom = new THREE.BufferGeometry();
    const { positions, uvData } = buildSlabGeometry(baseHalf * state.displayParams.planeScale);
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (uvData) geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvData, 2));
    geom.computeVertexNormals();

    const baseMatOpts = {
        color: new THREE.Color(...color),
        opacity: state.displayParams.planeOpacity,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
    };

    let mat;
    if (sh.type === 'basic') {
        mat = new THREE.MeshBasicMaterial(baseMatOpts);
    } else if (sh.type === 'standard') {
        const repeat = sh.textureRepeat !== undefined ? sh.textureRepeat : 5;
        const noiseTex = _getNoiseTexture();
        noiseTex.repeat.set(repeat, repeat);
        Object.assign(baseMatOpts, {
            roughness: sh.roughness !== undefined ? sh.roughness : 0.85,
            metalness: sh.metalness !== undefined ? sh.metalness : 0.08,
            map: noiseTex,
        });
        if (sh.emissive) baseMatOpts.emissive = new THREE.Color(sh.emissive);
        mat = new THREE.MeshStandardMaterial(baseMatOpts);
    } else {
        // MeshPhongMaterial (default)
        baseMatOpts.shininess = sh.shininess !== undefined ? sh.shininess : 30;
        if (sh.emissive) baseMatOpts.emissive = new THREE.Color(sh.emissive);
        if (sh.specular) baseMatOpts.specular = new THREE.Color(sh.specular);
        if (sh.flatShading) baseMatOpts.flatShading = true;
        mat = new THREE.MeshPhongMaterial(baseMatOpts);
    }

    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.targetOpacity = opacity;
    mesh.userData.baseHalf = baseHalf;
    mesh.userData.wVerts = wVerts;
    mesh.userData.normal = normal.clone();
    mesh.userData.buildSlab = (halfThick) => buildSlabGeometry(halfThick).positions;
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
