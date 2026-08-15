import { state } from '/state.js';
import { parseColor } from '/labels.js';
import { compileSurfaceExpr, evalSurfaceExpr } from '/expr.js';
import { dataToWorld } from '/coords.js';

export function renderParametricSurface(el, view) {
    const color = parseColor(el.color || '#66aaff');
    const opacity = el.opacity !== undefined ? el.opacity : 0.6;
    const rangeU = el.rangeU || el.uRange || [0, 2 * Math.PI];
    const rangeV = el.rangeV || el.vRange || [0, 2 * Math.PI];
    const resU = el.resolutionU || el.uSamples || el.resolution || 32;
    const resV = el.resolutionV || el.vSamples || el.resolution || 32;
    const label = el.label;

    const exprX = el.x || 'Math.sin(v) * Math.cos(u)';
    const exprY = el.y || 'Math.sin(v) * Math.sin(u)';
    const exprZ = el.z || 'Math.cos(v)';

    function buildPositions(fnX, fnY, fnZ) {
        const numVerts = (resU + 1) * (resV + 1);
        const pos = new Float32Array(numVerts * 3);
        const du = (rangeU[1] - rangeU[0]) / resU;
        const dv = (rangeV[1] - rangeV[0]) / resV;
        let idx = 0;
        for (let j = 0; j <= resV; j++) {
            for (let i = 0; i <= resU; i++) {
                const u = rangeU[0] + i * du;
                const v = rangeV[0] + j * dv;
                let x = 0, y = 0, z = 0;
                try {
                    x = evalSurfaceExpr(fnX, u, v);
                    y = evalSurfaceExpr(fnY, u, v);
                    z = evalSurfaceExpr(fnZ, u, v);
                } catch(e) {}
                const w = dataToWorld([isFinite(x) ? x : 0, isFinite(y) ? y : 0, isFinite(z) ? z : 0]);
                pos[idx++] = w[0];
                pos[idx++] = w[1];
                pos[idx++] = w[2];
            }
        }
        return pos;
    }

    function buildIndices() {
        const indices = new Uint32Array(resU * resV * 6);
        let idx = 0;
        for (let j = 0; j < resV; j++) {
            for (let i = 0; i < resU; i++) {
                const a = j * (resU + 1) + i;
                const b = a + 1;
                const c = a + (resU + 1);
                const d = c + 1;
                indices[idx++] = a; indices[idx++] = b; indices[idx++] = d;
                indices[idx++] = a; indices[idx++] = d; indices[idx++] = c;
            }
        }
        return indices;
    }

    const fnX = compileSurfaceExpr(exprX);
    const fnY = compileSurfaceExpr(exprY);
    const fnZ = compileSurfaceExpr(exprZ);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(buildPositions(fnX, fnY, fnZ), 3));
    geom.setIndex(new THREE.BufferAttribute(buildIndices(), 1));
    geom.computeVertexNormals();

    const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(...color),
        opacity: opacity,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        shininess: 40,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.targetOpacity = opacity;
    mesh.userData.isParametricSurface = true;
    mesh.renderOrder = state._planeMeshSerial;
    mesh.position.z = state._planeMeshSerial * 0.0002;
    state._planeMeshSerial++;
    state.three.scene.add(mesh);
    state.planeMeshes.push(mesh);

    const animState = { stopped: false };
    const animExprEntry = {
        exprStrings: [exprX, exprY, exprZ],
        animState,
        compiledFns: [fnX, fnY, fnZ],
        _isParametricSurface: true,
        _rebuildFn() {
            const nfX = compileSurfaceExpr(exprX);
            const nfY = compileSurfaceExpr(exprY);
            const nfZ = compileSurfaceExpr(exprZ);
            const pos = buildPositions(nfX, nfY, nfZ);
            geom.attributes.position.array.set(pos);
            geom.attributes.position.needsUpdate = true;
            geom.computeVertexNormals();
        },
    };
    state.activeAnimExprs.push(animExprEntry);

    return { type: 'parametric_surface', color, label, _animState: animState, _animExprEntry: animExprEntry };
}
