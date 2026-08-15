import { state } from '/state.js';
import { parseColor, addLabel3D, renderKaTeX } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
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
        const v = 205 + Math.floor(Math.random() * 50);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    _noiseTexture = new THREE.CanvasTexture(canvas);
    _noiseTexture.wrapS = _noiseTexture.wrapT = THREE.RepeatWrapping;
    return _noiseTexture;
}

// Project polygon world-space vertices onto the polygon plane as normalised [0,1] UVs.
function _computePlaneUVs(wVerts, normal) {
    const n = normal.clone().normalize();
    const v0 = new THREE.Vector3(wVerts[0][0], wVerts[0][1], wVerts[0][2]);
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

export function renderAnimatedPolygon(el, view) {
    const color = parseColor(el.color || '#aa66ff');
    const opacityRaw = el.opacity !== undefined ? el.opacity : 0.3;
    const opacityExpr = typeof opacityRaw === 'string' ? compileExpr(opacityRaw) : null;
    const opacity = opacityExpr ? 0.3 : opacityRaw;
    const thickness = el.thickness || 0.02;
    const label = el.label;
    const labelExprString = (typeof el.labelExpr === 'string' && el.labelExpr.trim()) ? el.labelExpr.trim() : null;
    const sh = el.shader || {};

    const animState = { stopped: false };
    const isRegular = el.regular && typeof el.regular === 'object';
    let getVerts;
    let animExprEntry;

    if (isRegular) {
        const reg = el.regular;
        const nExpr   = String(reg.n        != null ? reg.n        : '3');
        const rExpr   = String(reg.radius   != null ? reg.radius   : '1');
        const cxExpr  = String(Array.isArray(reg.center) && reg.center[0] != null ? reg.center[0] : '0');
        const cyExpr  = String(Array.isArray(reg.center) && reg.center[1] != null ? reg.center[1] : '0');
        const czExpr  = String(Array.isArray(reg.center) && reg.center[2] != null ? reg.center[2] : '0');
        const rotExpr = String(reg.rotation != null ? reg.rotation : '0');
        const regExprs = [nExpr, rExpr, cxExpr, cyExpr, czExpr, rotExpr];

        const regState = {
            cN:   compileExpr(nExpr),
            cR:   compileExpr(rExpr),
            cCx:  compileExpr(cxExpr),
            cCy:  compileExpr(cyExpr),
            cCz:  compileExpr(czExpr),
            cRot: compileExpr(rotExpr),
        };

        const plane = (reg.plane || 'xy').toLowerCase();

        getVerts = (tSec) => {
            const N   = Math.max(3, Math.round(evalExpr(regState.cN,   tSec)));
            const r   = evalExpr(regState.cR,   tSec);
            const cx  = evalExpr(regState.cCx,  tSec);
            const cy  = evalExpr(regState.cCy,  tSec);
            const cz  = evalExpr(regState.cCz,  tSec);
            const rot = evalExpr(regState.cRot, tSec);
            const verts = [];
            for (let k = 0; k < N; k++) {
                const angle = rot + (2 * Math.PI * k) / N;
                const a = r * Math.cos(angle), b = r * Math.sin(angle);
                if (plane === 'xz')      verts.push([cx + a, cy, cz + b]);
                else if (plane === 'yz')  verts.push([cx, cy + a, cz + b]);
                else                      verts.push([cx + a, cy + b, cz]);
            }
            return verts;
        };

        animExprEntry = {
            exprStrings: regExprs,
            animState,
            compiledFns: Object.values(regState),
            _isRegularPolygon: true,
            _regExprs: regExprs,
            _regState: regState,
        };
    } else {
        const vertexExprs = el.vertices;
        if (!Array.isArray(vertexExprs) || vertexExprs.length < 3) return null;

        let compiledVerts = vertexExprs.map(v => v.map(e => compileExpr(e)));
        getVerts = (tSec) => animExprEntry._compiledVerts.map(vfns => vfns.map(fn => evalExpr(fn, tSec)));

        animExprEntry = {
            exprStrings: vertexExprs.flat(),
            animState,
            compiledFns: compiledVerts.flat(),
            _isAnimatedPolygon: true,
            _vertexExprs: vertexExprs,
            _compiledVerts: compiledVerts,
        };
    }

    let currentDataVerts;
    try {
        currentDataVerts = getVerts(0);
    } catch(err) {
        console.warn('animated_polygon eval error:', err);
        return null;
    }

    function rebuildGeometry(dataVerts) {
        const wVerts = dataVerts.map(v => dataToWorld(v));
        const a = new THREE.Vector3(wVerts[1][0]-wVerts[0][0], wVerts[1][1]-wVerts[0][1], wVerts[1][2]-wVerts[0][2]);
        const b = new THREE.Vector3(wVerts[2][0]-wVerts[0][0], wVerts[2][1]-wVerts[0][1], wVerts[2][2]-wVerts[0][2]);
        const normal = a.cross(b).normalize();
        const halfThick = dataLenToWorld(thickness / 2) * (state.displayParams.planeScale || 1);

        const positions = [];
        const top = wVerts.map(v => [v[0]+normal.x*halfThick, v[1]+normal.y*halfThick, v[2]+normal.z*halfThick]);
        const bot = wVerts.map(v => [v[0]-normal.x*halfThick, v[1]-normal.y*halfThick, v[2]-normal.z*halfThick]);
        for (let i = 1; i < top.length - 1; i++) positions.push(...top[0], ...top[i], ...top[i+1]);
        for (let i = 1; i < bot.length - 1; i++) positions.push(...bot[0], ...bot[i+1], ...bot[i]);
        for (let i = 0; i < wVerts.length; i++) {
            const j = (i + 1) % wVerts.length;
            positions.push(...top[i], ...bot[i], ...top[j]);
            positions.push(...top[j], ...bot[i], ...bot[j]);
        }
        return new Float32Array(positions);
    }

    const isStandard = sh.type === 'standard';

    const FILL_MAX_FLOATS = 12 * 512 * 3;
    const UV_MAX_FLOATS   = 12 * 512 * 2;
    const fillAttr = new THREE.Float32BufferAttribute(new Float32Array(FILL_MAX_FLOATS), 3);
    fillAttr.setUsage(THREE.DynamicDrawUsage);
    const uvAttr = isStandard
        ? new THREE.Float32BufferAttribute(new Float32Array(UV_MAX_FLOATS), 2)
        : null;
    if (uvAttr) uvAttr.setUsage(THREE.DynamicDrawUsage);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', fillAttr);
    if (uvAttr) geom.setAttribute('uv', uvAttr);

    function applyGeomVerts(dataVerts) {
        const arr = rebuildGeometry(dataVerts);
        fillAttr.array.set(arr);
        fillAttr.needsUpdate = true;
        geom.setDrawRange(0, arr.length / 3);
        geom.computeVertexNormals();

        if (uvAttr) {
            // Recompute planar UVs from current world vertices
            const wV = dataVerts.map(v => dataToWorld(v));
            const a2 = new THREE.Vector3(wV[1][0]-wV[0][0], wV[1][1]-wV[0][1], wV[1][2]-wV[0][2]);
            const b2 = new THREE.Vector3(wV[2][0]-wV[0][0], wV[2][1]-wV[0][1], wV[2][2]-wV[0][2]);
            const norm2 = a2.clone().cross(b2).normalize();
            const planeUVs = _computePlaneUVs(wV, norm2);

            const uvData = [];
            // Top face
            for (let i = 1; i < wV.length - 1; i++) {
                uvData.push(...planeUVs[0], ...planeUVs[i], ...planeUVs[i+1]);
            }
            // Bottom face
            for (let i = 1; i < wV.length - 1; i++) {
                uvData.push(...planeUVs[0], ...planeUVs[i+1], ...planeUVs[i]);
            }
            // Sides (degenerate UVs)
            for (let i = 0; i < wV.length; i++) {
                uvData.push(0,0, 0,0, 0,0,  0,0, 0,0, 0,0);
            }
            uvAttr.array.set(uvData);
            uvAttr.needsUpdate = true;
        }
    }
    applyGeomVerts(currentDataVerts);

    const baseMatOpts = {
        color: new THREE.Color(...color),
        opacity: state.displayParams.planeOpacity * (opacity / 0.5),
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
        baseMatOpts.shininess = sh.shininess !== undefined ? sh.shininess : 30;
        if (sh.emissive) baseMatOpts.emissive = new THREE.Color(sh.emissive);
        if (sh.specular) baseMatOpts.specular = new THREE.Color(sh.specular);
        mat = new THREE.MeshPhongMaterial(baseMatOpts);
    }
    const mesh = new THREE.Mesh(geom, mat);
    const _serialA = el.renderOrder !== undefined ? el.renderOrder : state._planeMeshSerial++;
    mesh.renderOrder = _serialA;
    mesh.position.z = el.depthZ !== undefined ? el.depthZ : _serialA * 0.0002;
    state.three.scene.add(mesh);
    state.planeMeshes.push(mesh);

    let outlineArrayNode = null;
    let outlineLineNode = null;
    let outlineWidthExpr = null;
    let outlineOpacityExpr = null;
    const OUTLINE_MAX_PTS = 513;
    function buildOutlinePts(dataVerts) {
        const pts = dataVerts.slice();
        pts.push(pts[0]);
        const last = pts[pts.length - 1];
        while (pts.length < OUTLINE_MAX_PTS) pts.push(last);
        return pts;
    }
    const outlineWidthRaw = el.outlineWidth != null ? el.outlineWidth : (isRegular ? 1.5 : 0);
    const outlineOpacityRaw = el.outlineOpacity != null ? el.outlineOpacity : null;
    const outlineWidthInit = typeof outlineWidthRaw === 'string' ? (evalExpr(compileExpr(outlineWidthRaw), 0) || 1.5) : outlineWidthRaw;
    if (outlineWidthInit > 0 || typeof outlineWidthRaw === 'string') {
        if (typeof outlineWidthRaw === 'string') outlineWidthExpr = compileExpr(outlineWidthRaw);
        if (outlineOpacityRaw != null && typeof outlineOpacityRaw === 'string') outlineOpacityExpr = compileExpr(String(outlineOpacityRaw));
        const outlineColor = parseColor(el.outlineColor || el.color || '#aa66ff');
        const outlineOpacityInit = outlineOpacityRaw != null
            ? (typeof outlineOpacityRaw === 'string' ? evalExpr(compileExpr(String(outlineOpacityRaw)), 0) : Number(outlineOpacityRaw))
            : Math.min(1, opacity * 2);

        outlineArrayNode = view.array({ channels: 3, width: OUTLINE_MAX_PTS, data: buildOutlinePts(currentDataVerts), live: true });
        outlineLineNode = outlineArrayNode.line({
            color: new THREE.Color(...outlineColor),
            width: outlineWidthInit,
            opacity: outlineOpacityInit,
            zBias: 2,
        });
    }

    let labelExprFn = null;
    if (labelExprString) {
        try { labelExprFn = compileExpr(labelExprString); } catch (err) { console.warn('animated_polygon labelExpr compile error:', err); }
    }

    let labelEl = null;
    if (label || labelExprFn) {
        const cx = currentDataVerts.reduce((s, v) => s + v[0], 0) / currentDataVerts.length;
        const cy = currentDataVerts.reduce((s, v) => s + v[1], 0) / currentDataVerts.length;
        const cz = currentDataVerts.reduce((s, v) => s + v[2], 0) / currentDataVerts.length;
        labelEl = addLabel3D(label || '', [cx, cy, cz], color);
        if (labelExprFn) {
            try {
                const txt = String(evalExpr(labelExprFn, 0));
                labelEl.el.innerHTML = renderKaTeX(txt, false);
                labelEl._lastDynamicText = txt;
            } catch (_e) {}
        }
    }

    state.activeAnimExprs.push(animExprEntry);

    const startTime = state.sceneStartTime;
    state.activeAnimUpdaters.push({
        animState,
        updateFrame(nowMs) {
            if (!mesh.visible) return;

            const tSec = (nowMs - startTime) / 1000;
            try {
                const verts = getVerts(tSec);
                applyGeomVerts(verts);

                if (opacityExpr) {
                    const op = evalExpr(opacityExpr, tSec);
                    mat.opacity = state.displayParams.planeOpacity * (op / 0.5);
                    if (outlineLineNode && !outlineOpacityExpr) outlineLineNode.set('opacity', Math.min(1, op * 2));
                }
                if (outlineArrayNode) {
                    outlineArrayNode.set('data', buildOutlinePts(verts));
                }
                if (outlineLineNode && outlineWidthExpr) {
                    outlineLineNode.set('width', evalExpr(outlineWidthExpr, tSec));
                }
                if (outlineLineNode && outlineOpacityExpr) {
                    outlineLineNode.set('opacity', evalExpr(outlineOpacityExpr, tSec));
                }

                if (labelEl) {
                    labelEl.dataPos[0] = verts.reduce((s, v) => s + v[0], 0) / verts.length;
                    labelEl.dataPos[1] = verts.reduce((s, v) => s + v[1], 0) / verts.length + 0.3;
                    labelEl.dataPos[2] = verts.reduce((s, v) => s + v[2], 0) / verts.length;
                    if (labelExprFn) {
                        try {
                            const txt = String(evalExpr(labelExprFn, tSec));
                            if (labelEl._lastDynamicText !== txt) {
                                labelEl.el.innerHTML = renderKaTeX(txt, false);
                                labelEl._lastDynamicText = txt;
                            }
                        } catch (_e) {}
                    }
                }
            } catch(err) { /* keep last frame */ }
        },
    });

    return { type: 'animated_polygon', color, label, _animState: animState, _animExprEntry: animExprEntry };
}
