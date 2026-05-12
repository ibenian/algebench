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

// ── Gradient support: per-vertex color interpolation along an axis ──

function _buildGradientColorFn(gradient) {
    if (gradient.stops && gradient.stops.length > 0) {
        const stops = gradient.stops.slice().sort((a, b) => a.t - b.t);
        const parsed = stops.map(s => ({ t: s.t, c: parseColor(s.color) }));
        return (t) => {
            if (t <= parsed[0].t) return parsed[0].c.slice();
            if (t >= parsed[parsed.length - 1].t) return parsed[parsed.length - 1].c.slice();
            for (let i = 0; i < parsed.length - 1; i++) {
                if (t <= parsed[i + 1].t) {
                    const f = (t - parsed[i].t) / (parsed[i + 1].t - parsed[i].t);
                    return [
                        parsed[i].c[0] + f * (parsed[i + 1].c[0] - parsed[i].c[0]),
                        parsed[i].c[1] + f * (parsed[i + 1].c[1] - parsed[i].c[1]),
                        parsed[i].c[2] + f * (parsed[i + 1].c[2] - parsed[i].c[2]),
                    ];
                }
            }
            return parsed[parsed.length - 1].c.slice();
        };
    }
    const c0 = parseColor(gradient.from || '#ff0000');
    const c1 = parseColor(gradient.to || '#0000ff');
    return (t) => [
        c0[0] + t * (c1[0] - c0[0]),
        c0[1] + t * (c1[1] - c0[1]),
        c0[2] + t * (c1[2] - c0[2]),
    ];
}

function _buildGradientSlab(wVerts, gradient, halfThick, normal) {
    const dir = gradient.direction || 'y';
    const axis = dir === 'x' ? 0 : dir === 'z' ? 2 : 1;
    const segments = gradient.segments || 64;
    const getColor = _buildGradientColorFn(gradient);

    const tValues = wVerts.map(v => v[axis]);
    const tMin = Math.min(...tValues);
    const tMax = Math.max(...tValues);
    const tRange = tMax - tMin || 1;

    const n = wVerts.length;
    const edges = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        edges.push({
            w0: wVerts[i], w1: wVerts[j],
            t0: (tValues[i] - tMin) / tRange,
            t1: (tValues[j] - tMin) / tRange,
        });
    }

    function sliceAt(t) {
        const pts = [];
        for (const e of edges) {
            const lo = Math.min(e.t0, e.t1), hi = Math.max(e.t0, e.t1);
            if (t < lo - 1e-9 || t > hi + 1e-9) continue;
            const dt = e.t1 - e.t0;
            if (Math.abs(dt) < 1e-9) {
                pts.push(e.w0.slice(), e.w1.slice());
            } else {
                const f = (t - e.t0) / dt;
                pts.push([
                    e.w0[0] + f * (e.w1[0] - e.w0[0]),
                    e.w0[1] + f * (e.w1[1] - e.w0[1]),
                    e.w0[2] + f * (e.w1[2] - e.w0[2]),
                ]);
            }
        }
        const unique = [];
        for (const p of pts) {
            if (!unique.some(u =>
                Math.abs(u[0]-p[0]) < 1e-9 &&
                Math.abs(u[1]-p[1]) < 1e-9 &&
                Math.abs(u[2]-p[2]) < 1e-9))
                unique.push(p);
        }
        const sa = axis === 0 ? 1 : 0;
        unique.sort((a, b) => a[sa] - b[sa]);
        return unique;
    }

    const positions = [];
    const vertColors = [];
    const off = (v, s) => [
        v[0] + normal.x * halfThick * s,
        v[1] + normal.y * halfThick * s,
        v[2] + normal.z * halfThick * s,
    ];

    for (let s = 0; s < segments; s++) {
        const tBot = s / segments;
        const tTop = (s + 1) / segments;
        const bp = sliceAt(tBot);
        const tp = sliceAt(tTop);
        if (bp.length < 2 || tp.length < 2) continue;

        const cB = getColor(tBot);
        const cT = getColor(tTop);
        const bL = bp[0], bR = bp[bp.length - 1];
        const tL = tp[0], tR = tp[tp.length - 1];

        for (const sign of [1, -1]) {
            const o = (v) => off(v, sign);
            if (sign === 1) {
                positions.push(...o(bL), ...o(bR), ...o(tR));
                positions.push(...o(bL), ...o(tR), ...o(tL));
            } else {
                positions.push(...o(bL), ...o(tR), ...o(bR));
                positions.push(...o(bL), ...o(tL), ...o(tR));
            }
            vertColors.push(...cB, ...cB, ...cT);
            vertColors.push(...cB, ...cT, ...cT);
        }
    }

    return { positions, colors: vertColors };
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
        const plane = (reg.plane || 'xy').toLowerCase();
        vertices = [];
        for (let k = 0; k < N; k++) {
            const angle = rot + (2 * Math.PI * k) / N;
            const a = r * Math.cos(angle), b = r * Math.sin(angle);
            if (plane === 'xz')      vertices.push([cx + a, cy, cz + b]);
            else if (plane === 'yz') vertices.push([cx, cy + a, cz + b]);
            else                     vertices.push([cx + a, cy + b, cz]);
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
    const hasGradient = !!el.gradient;
    if (hasGradient) {
        const { positions: gPos, colors: gCol } = _buildGradientSlab(
            wVerts, el.gradient, baseHalf * state.displayParams.planeScale, normal);
        geom.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
        geom.setAttribute('color', new THREE.Float32BufferAttribute(gCol, 3));
    } else {
        const { positions, uvData } = buildSlabGeometry(baseHalf * state.displayParams.planeScale);
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        if (uvData) geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvData, 2));
    }
    geom.computeVertexNormals();

    const baseMatOpts = {
        color: hasGradient ? new THREE.Color(1, 1, 1) : new THREE.Color(...color),
        opacity: state.displayParams.planeOpacity,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
    };
    if (hasGradient) baseMatOpts.vertexColors = true;

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
    mesh.userData.buildSlab = hasGradient
        ? (halfThick) => _buildGradientSlab(wVerts, el.gradient, halfThick, normal).positions
        : (halfThick) => buildSlabGeometry(halfThick).positions;
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
