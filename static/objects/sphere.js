import { state } from '/state.js';
import { parseColor, addLabel3D } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import { dataToWorld } from '/coords.js';

export function _makeSurfaceMaterial(el, color, opacity, defaults = {}) {
    const matType = (el.shader && el.shader.type === 'basic') ? THREE.MeshBasicMaterial : THREE.MeshPhongMaterial;
    const matOpts = {
        color: new THREE.Color(...color),
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide,
    };
    const sh = el.shader || {};
    if (sh.depthWrite !== undefined) matOpts.depthWrite = !!sh.depthWrite;
    if (sh.depthTest !== undefined) matOpts.depthTest = !!sh.depthTest;
    if (matType === THREE.MeshPhongMaterial) {
        matOpts.shininess = sh.shininess !== undefined ? sh.shininess : (defaults.shininess !== undefined ? defaults.shininess : 40);
        if (sh.emissive) matOpts.emissive = new THREE.Color(sh.emissive);
        if (sh.specular) matOpts.specular = new THREE.Color(sh.specular);
        if (sh.flatShading) matOpts.flatShading = true;
    }
    return new matType(matOpts);
}

export function _dataAxisScaleFromCenter(centerData, rx, ry, rz) {
    const centerW = new THREE.Vector3(...dataToWorld(centerData));
    const xW = new THREE.Vector3(...dataToWorld([centerData[0] + rx, centerData[1], centerData[2]]));
    const yW = new THREE.Vector3(...dataToWorld([centerData[0], centerData[1] + ry, centerData[2]]));
    const zW = new THREE.Vector3(...dataToWorld([centerData[0], centerData[1], centerData[2] + rz]));
    return {
        centerW,
        sx: Math.max(centerW.distanceTo(xW), 0.0001),
        sy: Math.max(centerW.distanceTo(yW), 0.0001),
        sz: Math.max(centerW.distanceTo(zW), 0.0001),
    };
}

export function renderSphere(el, view) {
    const color = parseColor(el.color || '#66aaff');
    const opacity = el.opacity !== undefined ? el.opacity : 0.8;
    const label = el.label;
    const widthSegments = el.widthSegments || el.segments || 32;
    const heightSegments = el.heightSegments || el.rings || 20;

    const centerExpr = Array.isArray(el.centerExpr) && el.centerExpr.length === 3
        ? el.centerExpr
        : ((Array.isArray(el.center) && el.center.length === 3 ? el.center : (Array.isArray(el.position) ? el.position : [0, 0, 0]))
            .map(v => String(v)));
    const radiusExpr = typeof el.radiusExpr === 'string'
        ? el.radiusExpr
        : String(el.radius !== undefined ? el.radius : 1);

    let centerFns, radiusFn;
    try {
        centerFns = centerExpr.map(e => compileExpr(e));
        radiusFn = compileExpr(radiusExpr);
    } catch (err) {
        console.warn('sphere expr compile error:', err);
        return null;
    }

    function evalState() {
        const c = centerFns.map(fn => evalExpr(fn, 0));
        const r = Math.max(Math.abs(evalExpr(radiusFn, 0)), 0.0001);
        return { center: c, radius: r };
    }

    const geom = new THREE.SphereGeometry(1, widthSegments, heightSegments);
    const mat = _makeSurfaceMaterial(el, color, opacity, { shininess: 50 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.targetOpacity = opacity;
    state.three.scene.add(mesh);
    state.planeMeshes.push(mesh);

    let labelEl = null;
    if (label) labelEl = addLabel3D(label, [0, 0, 0], color);

    const animState = { stopped: false };
    const animExprEntry = {
        exprStrings: [...centerExpr, radiusExpr],
        animState,
        _rebuildFn() {
            const s = evalState();
            const world = _dataAxisScaleFromCenter(s.center, s.radius, s.radius, s.radius);
            mesh.position.copy(world.centerW);
            mesh.scale.set(world.sx, world.sy, world.sz);
            if (labelEl) {
                labelEl.dataPos[0] = s.center[0];
                labelEl.dataPos[1] = s.center[1] + s.radius * 1.05;
                labelEl.dataPos[2] = s.center[2];
            }
        },
    };
    state.activeAnimExprs.push(animExprEntry);
    animExprEntry._rebuildFn();

    return { type: 'sphere', color, label, _animState: animState, _animExprEntry: animExprEntry };
}
