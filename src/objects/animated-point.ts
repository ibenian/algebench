import { state } from '/state.js';
import { parseColor, addLabel3D, renderKaTeX } from '/labels.js';
import type { Label3D } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import type { CompiledExpr } from '/expr.js';
import { dataToWorld, dataLenToWorld } from '/coords.js';
import type { Vec3 } from '/coords.js';
import type { Element } from '/types/lesson.js';
import type { CanvasTexture, Material, Mesh, MeshPhongMaterialParameters, Object3D, Scene, Sprite } from 'three';

/** parseColor returns `number[]`; spreading into `new THREE.Color(...)` needs a tuple. */
type Rgb3 = [number, number, number];

/** A label whose text is driven by `labelExpr`, memoising its last rendered value. */
type DynamicLabel = Label3D & { _lastDynamicText?: string };

/** Meshes the step system hides carry this flag; the updater skips them. */
type RemovableMesh = Mesh<import('three').BufferGeometry, Material> & { _hiddenByRemove?: boolean };
type RemovableSprite = Sprite & { _hiddenByRemove?: boolean };

/** A live expression-driven element, as the scene loader's rebuild pass expects it. */
interface AnimExprEntry {
    exprStrings: string[];
    animState: { stopped: boolean };
    compiledFns: CompiledExpr[];
    visibleExprString: string | null;
    visibleFn: CompiledExpr | null;
}

/** A per-frame updater, as the scene loader's animation loop expects it. */
interface AnimUpdater {
    animState: { stopped: boolean };
    updateFrame(nowMs: number): void;
}

/** The slice of the shared state object this module touches. */
interface AnimatedPointState {
    three: { scene: Scene };
    planeMeshes: Object3D[];
    activeAnimExprs: AnimExprEntry[];
    activeAnimUpdaters: AnimUpdater[];
    animatedElementPos: Record<string, { pos: number[]; startTime: number; time: number }>;
    sceneStartTime: number;
}
const animatedPointState = state as unknown as AnimatedPointState;

// Shared radial-gradient texture for glow halos (built once, reused by all points).
let _haloTexture: CanvasTexture | null = null;
function getHaloTexture(): CanvasTexture {
    if (_haloTexture) return _haloTexture;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    // `!` not `?.`: an unavailable 2d context threw in the original.
    const ctx = c.getContext('2d')!;
    // Star-shine decal: soft round core + cross light-streaks + faint diagonals.
    const ray = (rot: number, len: number, width: number, alpha: number) => {
        ctx.save();
        ctx.translate(128, 128);
        ctx.rotate(rot);
        ctx.scale(len, width);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0.0, `rgba(255,255,255,${alpha})`);
        g.addColorStop(0.35, `rgba(255,255,255,${alpha * 0.3})`);
        g.addColorStop(1.0, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    };
    ray(0, 40, 40, 1.0);                 // white-hot center core (double pass)
    ray(0, 40, 40, 1.0);
    ray(0, 110, 110, 0.35);              // broad bloom
    ray(0, 127, 9, 1.0);                 // horizontal streak
    ray(Math.PI / 2, 127, 9, 1.0);       // vertical streak
    ray(Math.PI / 4, 95, 5, 0.55);       // diagonal sparkle
    ray(-Math.PI / 4, 95, 5, 0.55);
    _haloTexture = new THREE.CanvasTexture(c);
    return _haloTexture;
}

export function renderAnimatedPoint(el: Element, view: MathBoxNode) {
    const color = parseColor(el.color || '#ffdd00') as Rgb3;
    const shader = el.shader || {};
    const size = Number(el.size);
    const opacity = Number.isFinite(Number(el.opacity)) ? Math.max(0, Math.min(1, Number(el.opacity))) : 1;
    const radius = el.radius !== undefined
        ? el.radius
        : (Number.isFinite(size) ? Math.max(size, 0) / 50 : 0.25);
    const label = el.label;
    const exprStrings = (el.expr || el.positionExpr || el.toExpr
        || (Array.isArray(el.position) && el.position.length === 3 ? el.position.map(v => String(v)) : null)) as string[] | null;
    const visibleExprString = (typeof el.visibleExpr === 'string' && el.visibleExpr.trim()) ? el.visibleExpr.trim() : null;
    const sizeExprString = (typeof el.sizeExpr === 'string' && el.sizeExpr.trim()) ? el.sizeExpr.trim() : null;
    const opacityExprString = (typeof el.opacityExpr === 'string' && el.opacityExpr.trim()) ? el.opacityExpr.trim() : null;
    const labelExprString = (typeof el.labelExpr === 'string' && el.labelExpr.trim()) ? el.labelExpr.trim() : null;
    const labelOffset = (Array.isArray(el.labelOffset) && el.labelOffset.length === 3)
        ? [Number(el.labelOffset[0]) || 0, Number(el.labelOffset[1]) || 0, Number(el.labelOffset[2]) || 0]
        : [0, 0, 0.15];

    if (!Array.isArray(exprStrings) || exprStrings.length !== 3) return null;

    let exprFns: CompiledExpr[];
    let visibleFn: CompiledExpr | null = null;
    let sizeFn: CompiledExpr | null = null;
    let opacityFn: CompiledExpr | null = null;
    let initPos: Vec3;
    try {
        exprFns = exprStrings.map(e => compileExpr(e));
        initPos = exprFns.map(fn => evalExpr(fn, 0) as number) as Vec3;
        if (visibleExprString) visibleFn = compileExpr(visibleExprString);
        if (sizeExprString) sizeFn = compileExpr(sizeExprString);
        if (opacityExprString) opacityFn = compileExpr(opacityExprString);
    } catch (err) {
        console.warn('animated_point expr compile/eval error:', err);
        return null;
    }

    const initWorld = dataToWorld(initPos);
    const geom = new THREE.SphereGeometry(1, 20, 16);
    const matOpts: MeshPhongMaterialParameters = {
        color: new THREE.Color(...color),
        transparent: opacity < 0.999 || !!opacityFn,
        opacity,
    };
    if (shader.depthWrite !== undefined) matOpts.depthWrite = !!shader.depthWrite;
    if (shader.depthTest !== undefined) matOpts.depthTest = !!shader.depthTest;

    let mat;
    if (shader.type === 'basic') {
        mat = new THREE.MeshBasicMaterial(matOpts);
    } else {
        matOpts.shininess = shader.shininess !== undefined ? shader.shininess : 50;
        if (shader.emissive) matOpts.emissive = new THREE.Color(shader.emissive);
        if (shader.specular) matOpts.specular = new THREE.Color(shader.specular);
        if (shader.flatShading) matOpts.flatShading = true;
        mat = new THREE.MeshPhongMaterial(matOpts);
    }
    const mesh = new THREE.Mesh(geom, mat) as RemovableMesh;
    // With a glow halo the sprite IS the visual — the core mesh is kept only as
    // an invisible position/label anchor (visible=false each frame; targetOpacity 0
    // so the plane-opacity manager never fades it back in).
    const glowOnly = !!el.glow;
    if (glowOnly) {
        mat.transparent = true;
        mat.opacity = 0;
        mesh.visible = false;
    }
    mesh.position.set(initWorld[0], initWorld[1], initWorld[2]);
    const initWorldRadius = Math.max(dataLenToWorld(radius), 0.0005);
    mesh.scale.setScalar(initWorldRadius);
    mesh.userData.targetOpacity = glowOnly ? 0 : opacity;
    mesh.userData.ignorePlaneOpacity = !!shader.ignorePlaneOpacity;
    animatedPointState.three.scene.add(mesh);
    animatedPointState.planeMeshes.push(mesh);

    // Optional light-halo sprite: camera-facing radial gradient, additively blended.
    let halo: RemovableSprite | null = null;
    const glowScale = Number.isFinite(Number(el.glowScale)) ? Number(el.glowScale) : 2;
    if (el.glow) {
        const haloMat = new THREE.SpriteMaterial({
            map: getHaloTexture(),
            color: new THREE.Color(...color),
            transparent: true,
            opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        halo = new THREE.Sprite(haloMat);
        halo.position.copy(mesh.position);
        halo.scale.setScalar(initWorldRadius * glowScale * 2);
        halo.userData.targetOpacity = opacity;
        halo.userData.ignorePlaneOpacity = !!shader.ignorePlaneOpacity;
        animatedPointState.three.scene.add(halo);
        animatedPointState.planeMeshes.push(halo);
    }

    let labelExprFn: CompiledExpr | null = null;
    if (labelExprString) {
        try { labelExprFn = compileExpr(labelExprString); } catch (err) { console.warn('animated_point labelExpr compile error:', err); }
    }

    let labelEl: DynamicLabel | null = null;
    if (label || labelExprFn) {
        const initText = label || '';
        labelEl = addLabel3D(initText, [initPos[0] + labelOffset[0]!, initPos[1] + labelOffset[1]!, initPos[2] + labelOffset[2]!], color);
        if (labelExprFn) {
            try {
                const txt = String(evalExpr(labelExprFn, 0));
                labelEl.el.innerHTML = renderKaTeX(txt, false);
                labelEl._lastDynamicText = txt;
            } catch (_e) {}
        }
    }

    const animState = { stopped: false };
    const animExprEntry: AnimExprEntry = {
        exprStrings,
        animState,
        compiledFns: exprFns,
        visibleExprString,
        visibleFn,
    };
    animatedPointState.activeAnimExprs.push(animExprEntry);

    const startTime = animatedPointState.sceneStartTime;
    animatedPointState.activeAnimUpdaters.push({
        animState,
        updateFrame(nowMs) {
            // Step-removed elements aren't rendered and must not publish
            // positions — retract any previously published entry (so the
            // follow-cam can't latch onto a stale one) and skip evaluation.
            if (mesh._hiddenByRemove) {
                if (el.id) delete animatedPointState.animatedElementPos[el.id];
                return;
            }

            const tSec = (nowMs - startTime) / 1000;
            const fns = animExprEntry.compiledFns || exprFns;
            let p: Vec3 = initPos;
            try {
                p = fns.map(fn => evalExpr(fn, tSec) as number) as Vec3;
            } catch (err) {
                // keep previous position
            }

            if (el.id) {
                animatedPointState.animatedElementPos[el.id] = { pos: p, startTime, time: nowMs };
            }

            let isVisible = true;
            const curVisibleFn = animExprEntry.visibleFn || visibleFn;
            if (curVisibleFn) {
                try {
                    isVisible = !!evalExpr(curVisibleFn, tSec);
                } catch (_err) {
                    isVisible = true;
                }
            }
            mesh.visible = glowOnly ? false : isVisible;

            const w = dataToWorld(p);
            mesh.position.set(w[0], w[1], w[2]);
            let radiusNow = radius;
            if (sizeFn) {
                try {
                    const rv = evalExpr(sizeFn, tSec) as number;
                    if (Number.isFinite(rv)) radiusNow = Math.max(rv, 0) / 50;
                } catch (_err) { /* keep static radius */ }
            }
            const worldRadius = Math.max(dataLenToWorld(radiusNow), 0.0005);
            mesh.scale.setScalar(worldRadius);
            let opacityNow: number | null = null;
            if (opacityFn) {
                try {
                    const ov = evalExpr(opacityFn, tSec) as number;
                    if (Number.isFinite(ov)) {
                        opacityNow = Math.max(0, Math.min(1, ov));
                        if (!halo) {
                            mesh.material.opacity = opacityNow;
                            mesh.userData.targetOpacity = opacityNow;
                        }
                    }
                } catch (_err) { /* keep current opacity */ }
            }
            if (halo && !halo._hiddenByRemove) {
                halo.visible = isVisible;
                halo.position.copy(mesh.position);
                halo.scale.setScalar(worldRadius * glowScale * 2);
                if (opacityNow !== null) {
                    halo.material.opacity = opacityNow;
                    halo.userData.targetOpacity = opacityNow;
                }
            }

            if (labelEl) {
                labelEl.dataPos[0] = p[0] + labelOffset[0]!;
                labelEl.dataPos[1] = p[1] + labelOffset[1]!;
                labelEl.dataPos[2] = p[2] + labelOffset[2]!;
                labelEl.forceHidden = !isVisible;
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
        },
    });

    return { type: 'animated_point', color, label, _animState: animState, _animExprEntry: animExprEntry };
}
