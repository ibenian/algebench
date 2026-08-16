import { state } from '/state.js';
import { parseColor } from '/labels.js';
import { compileSurfaceExpr, evalSurfaceExpr } from '/expr.js';
import type { CompiledExpr } from '/expr.js';
import { dataToWorld } from '/coords.js';
import type { Element } from '/types/lesson.js';
import type { Object3D, Scene } from 'three';

/** parseColor returns `number[]`; spreading into `new THREE.Color(...)` needs a tuple. */
type Rgb3 = [number, number, number];

/** A live expression-driven element, as the scene loader's rebuild pass expects it. */
interface AnimExprEntry {
    exprStrings: string[];
    animState: { stopped: boolean };
    compiledFns: CompiledExpr[];
    _isParametricSurface: boolean;
    _rebuildFn(): void;
}

/** The slice of the shared state object this module touches. */
interface ParametricSurfaceState {
    _planeMeshSerial: number;
    three: { scene: Scene };
    planeMeshes: Object3D[];
    activeAnimExprs: AnimExprEntry[];
}
const parametricSurfaceState = state as unknown as ParametricSurfaceState;

export function renderParametricSurface(el: Element, view: MathBoxNode) {
    const color = parseColor(el.color || '#66aaff') as Rgb3;
    const opacity = (el.opacity !== undefined ? el.opacity : 0.6) as number;
    const rangeU = ((el.rangeU as [number, number] | undefined) || el.uRange || [0, 2 * Math.PI]);
    const rangeV = ((el.rangeV as [number, number] | undefined) || el.vRange || [0, 2 * Math.PI]);
    const resU = (el.resolutionU as number | undefined) || el.uSamples || (el.resolution as number | undefined) || 32;
    const resV = (el.resolutionV as number | undefined) || el.vSamples || (el.resolution as number | undefined) || 32;
    const label = el.label;

    const exprX = el.x || 'Math.sin(v) * Math.cos(u)';
    const exprY = el.y || 'Math.sin(v) * Math.sin(u)';
    const exprZ = el.z || 'Math.cos(v)';

    function buildPositions(fnX: CompiledExpr, fnY: CompiledExpr, fnZ: CompiledExpr) {
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
                    x = evalSurfaceExpr(fnX, u, v) as number;
                    y = evalSurfaceExpr(fnY, u, v) as number;
                    z = evalSurfaceExpr(fnZ, u, v) as number;
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
    mesh.renderOrder = parametricSurfaceState._planeMeshSerial;
    mesh.position.z = parametricSurfaceState._planeMeshSerial * 0.0002;
    parametricSurfaceState._planeMeshSerial++;
    parametricSurfaceState.three.scene.add(mesh);
    parametricSurfaceState.planeMeshes.push(mesh);

    const animState = { stopped: false };
    const animExprEntry: AnimExprEntry = {
        exprStrings: [exprX, exprY, exprZ],
        animState,
        compiledFns: [fnX, fnY, fnZ],
        _isParametricSurface: true,
        _rebuildFn() {
            const nfX = compileSurfaceExpr(exprX);
            const nfY = compileSurfaceExpr(exprY);
            const nfZ = compileSurfaceExpr(exprZ);
            const pos = buildPositions(nfX, nfY, nfZ);
            // `!` not `?.`: the attribute was set above, and a missing one must
            // still throw exactly as it did before. `.array` is typed
            // `ArrayLike<number>`; it is the Float32Array set above.
            (geom.attributes.position!.array as Float32Array).set(pos);
            geom.attributes.position!.needsUpdate = true;
            geom.computeVertexNormals();
        },
    };
    parametricSurfaceState.activeAnimExprs.push(animExprEntry);

    return { type: 'parametric_surface', color, label, _animState: animState, _animExprEntry: animExprEntry };
}
