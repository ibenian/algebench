import { state } from '/state.js';
import { parseColor, addLabel3D } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import type { CompiledExpr } from '/expr.js';
import { _makeSurfaceMaterial, _dataAxisScaleFromCenter } from '/objects/sphere.js';
import type { Vec3 } from '/coords.js';
import type { Element } from '/types/lesson.js';
import type { Object3D, Scene } from 'three';

/** parseColor returns `number[]`; spreading into `new THREE.Color(...)` needs a tuple. */
type Rgb3 = [number, number, number];

/** A live expression-driven element, as the scene loader's rebuild pass expects it. */
interface AnimExprEntry {
    exprStrings: string[];
    animState: { stopped: boolean };
    _rebuildFn(): void;
}

/** The slice of the shared state object this module touches. */
interface EllipsoidState {
    three: { scene: Scene };
    planeMeshes: Object3D[];
    activeAnimExprs: AnimExprEntry[];
}
const ellipsoidState = state as unknown as EllipsoidState;

export function renderEllipsoid(el: Element, view: MathBoxNode) {
    const color = parseColor(el.color || '#66aaff') as Rgb3;
    // `opacity` is `number | string` on the schema (animated elements accept an
    // expression); ellipsoid has no opacity animation, so it is always a number.
    const opacity = (el.opacity !== undefined ? el.opacity : 0.8) as number;
    const label = el.label;
    const widthSegments = el.widthSegments || (el.segments as number | undefined) || 32;
    const heightSegments = el.heightSegments || (el.rings as number | undefined) || 20;

    const centerExpr: string[] = Array.isArray(el.centerExpr) && el.centerExpr.length === 3
        ? el.centerExpr
        : ((Array.isArray(el.center) && el.center.length === 3 ? el.center : (Array.isArray(el.position) ? el.position : [0, 0, 0]))
            .map(v => String(v)));
    const radiiExpr: string[] = Array.isArray(el.radiiExpr) && el.radiiExpr.length === 3
        ? el.radiiExpr
        : (() => {
            if (Array.isArray(el.radii) && el.radii.length === 3) return el.radii.map(v => String(v));
            const rx = el.rx !== undefined ? el.rx : (el.xRadius !== undefined ? el.xRadius : 1);
            const ry = el.ry !== undefined ? el.ry : (el.yRadius !== undefined ? el.yRadius : rx);
            const rz = el.rz !== undefined ? el.rz : (el.zRadius !== undefined ? el.zRadius : rx);
            return [String(rx), String(ry), String(rz)];
        })();

    let centerFns: CompiledExpr[], radiiFns: CompiledExpr[];
    try {
        centerFns = centerExpr.map(e => compileExpr(e));
        radiiFns = radiiExpr.map(e => compileExpr(e));
    } catch (err) {
        console.warn('ellipsoid expr compile error:', err);
        return null;
    }

    function evalState() {
        const c = centerFns.map(fn => evalExpr(fn, 0) as number) as Vec3;
        // `!` not `?.`: a malformed radiiExpr threw here in the original and must
        // keep throwing rather than silently rendering a unit sphere.
        const rx = Math.max(Math.abs(evalExpr(radiiFns[0]!, 0) as number), 0.0001);
        const ry = Math.max(Math.abs(evalExpr(radiiFns[1]!, 0) as number), 0.0001);
        const rz = Math.max(Math.abs(evalExpr(radiiFns[2]!, 0) as number), 0.0001);
        return { center: c, rx, ry, rz };
    }

    const geom = new THREE.SphereGeometry(1, widthSegments, heightSegments);
    const mat = _makeSurfaceMaterial(el, color, opacity, { shininess: 50 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.targetOpacity = opacity;
    ellipsoidState.three.scene.add(mesh);
    ellipsoidState.planeMeshes.push(mesh);

    let labelEl = null;
    if (label) labelEl = addLabel3D(label, [0, 0, 0], color);

    const animState = { stopped: false };
    const animExprEntry: AnimExprEntry = {
        exprStrings: [...centerExpr, ...radiiExpr],
        animState,
        _rebuildFn() {
            const s = evalState();
            const world = _dataAxisScaleFromCenter(s.center, s.rx, s.ry, s.rz);
            mesh.position.copy(world.centerW);
            mesh.scale.set(world.sx, world.sy, world.sz);
            if (labelEl) {
                labelEl.dataPos[0] = s.center[0];
                labelEl.dataPos[1] = s.center[1] + s.ry * 1.05;
                labelEl.dataPos[2] = s.center[2];
            }
        },
    };
    ellipsoidState.activeAnimExprs.push(animExprEntry);
    animExprEntry._rebuildFn();

    return { type: 'ellipsoid', color, label, _animState: animState, _animExprEntry: animExprEntry };
}
