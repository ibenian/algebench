import { state } from '/state.js';
import { dataToWorld } from '/coords.js';
import type { Range3 } from '/coords.js';
import type { Element, Starfield } from '/types/lesson.js';
import type { BufferGeometry, Points, Scene, ShaderMaterial, Texture } from 'three';

/** The starfield Points object, with the shader material that animates it. */
type Starfield3D = Points<BufferGeometry, ShaderMaterial>;

/** The slice of the shared state object this module touches. */
interface SkyboxState {
    _starfieldAnimId: number | null;
    worldStarfield: Starfield3D | null;
    worldSkybox: { texture: Texture } | null;
    three: { scene: Scene } | null;
    currentRange: Range3;
    currentScale: [number, number, number];
}
const skyboxState = state as unknown as SkyboxState;

export function clearWorldStarfield() {
    if (skyboxState._starfieldAnimId) { cancelAnimationFrame(skyboxState._starfieldAnimId); skyboxState._starfieldAnimId = null; }
    if (!skyboxState.worldStarfield || !skyboxState.three || !skyboxState.three.scene) return;
    skyboxState.three.scene.remove(skyboxState.worldStarfield);
    if (skyboxState.worldStarfield.geometry) skyboxState.worldStarfield.geometry.dispose();
    if (skyboxState.worldStarfield.material) skyboxState.worldStarfield.material.dispose();
    skyboxState.worldStarfield = null;
}

export function clearWorldSkybox() {
    if (!skyboxState.three || !skyboxState.three.scene) return;
    if (skyboxState.worldSkybox && skyboxState.worldSkybox.texture && typeof skyboxState.worldSkybox.texture.dispose === 'function') {
        skyboxState.worldSkybox.texture.dispose();
    }
    skyboxState.worldSkybox = null;
    skyboxState.three.scene.background = null;
}

function _makeGradientSkyboxTexture(
    topHex: string,
    bottomHex: string,
    starCount: number = 0,
    starColor: string = '#e6efff',
    starMin: number = 0.5,
    starMax: number = 2.0,
) {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    // `!` not `?.`: an unavailable 2d context threw on the next line before and
    // must keep throwing.
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, topHex || '#070b18');
    grad.addColorStop(1, bottomHex || '#010205');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const n = Math.max(0, Math.floor(starCount || 0));
    if (n > 0) {
        ctx.fillStyle = starColor || '#e6efff';
        for (let i = 0; i < n; i++) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const r = (starMin || 0.5) + Math.random() * Math.max(0.05, (starMax || 2.0) - (starMin || 0.5));
            const a = 0.35 + Math.random() * 0.65;
            ctx.globalAlpha = a;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    // No encoding flag on purpose: MathBox leaves renderer.outputEncoding at
    // LinearEncoding, so tagging the texture sRGBEncoding would decode it to
    // linear and never re-encode — the authored sRGB hex gradient would render
    // near-black. Default (linear in, linear out) shows the canvas verbatim.
    return tex;
}

export function configureWorldStarfield(spec: { starfield?: Starfield } | null | undefined) {
    clearWorldStarfield();
    const cfg = spec && spec.starfield;
    if (!cfg || cfg.enabled === false) return;

    const currentRange = skyboxState.currentRange;
    const currentScale = skyboxState.currentScale;

    const spanX = Math.abs(currentRange[0][1] - currentRange[0][0]);
    const spanY = Math.abs(currentRange[1][1] - currentRange[1][0]);
    const spanZ = Math.abs(currentRange[2][1] - currentRange[2][0]);
    const halfMaxSpan = Math.max(spanX, spanY, spanZ, 1) / 2;

    const count = Math.max(50, Math.floor(cfg.count || 900));
    const radiusMin = Number.isFinite(cfg.radiusMin) ? cfg.radiusMin! : halfMaxSpan * 3;
    const radiusMax = Number.isFinite(cfg.radiusMax) ? cfg.radiusMax! : halfMaxSpan * 7;
    const size = Number.isFinite(cfg.size) ? cfg.size! : 2.1;
    const opacity = Number.isFinite(cfg.opacity) ? cfg.opacity! : 0.9;
    const twinkle = Number.isFinite(cfg.twinkle) ? Math.max(0, Math.min(1, cfg.twinkle!)) : 0.25;
    const baseColor = new THREE.Color(cfg.color || '#d9e6ff');

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);  // random phase offset for twinkle

    for (let i = 0; i < count; i++) {
        const z = Math.random() * 2 - 1;
        const theta = Math.random() * Math.PI * 2;
        const rXY = Math.sqrt(Math.max(0, 1 - z * z));
        const dirX = rXY * Math.cos(theta);
        const dirY = rXY * Math.sin(theta);
        const dirZ = z;

        const u = Math.random();
        const radius = radiusMin + (radiusMax - radiusMin) * Math.pow(u, 0.6);
        const dataPos: [number, number, number] = [dirX * radius, dirY * radius, dirZ * radius];
        const w = dataToWorld(dataPos);

        const pi = i * 3;
        positions[pi] = w[0];
        positions[pi + 1] = w[1];
        positions[pi + 2] = w[2];

        // Size variation: most stars small-medium, some bright, a few very bright
        const r = Math.random();
        sizes[i] = r < 0.6 ? size * (0.8 + Math.random() * 0.6)
                 : r < 0.85 ? size * (1.5 + Math.random() * 1.0)
                 : r < 0.95 ? size * (2.5 + Math.random() * 1.5)
                 : size * (4.0 + Math.random() * 2.0);  // ~5% very bright stars

        phases[i] = Math.random() * Math.PI * 2;

        const f = 1 - twinkle * Math.random();
        colors[pi] = baseColor.r * f;
        colors[pi + 1] = baseColor.g * f;
        colors[pi + 2] = baseColor.b * f;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geom.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

    // Custom shader for per-star sizes and twinkle animation
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uOpacity: { value: opacity },
            uTwinkle: { value: twinkle },
        },
        vertexShader: `
            attribute float size;
            attribute float phase;
            varying vec3 vColor;
            varying float vPhase;
            uniform float uTime;
            uniform float uTwinkle;
            void main() {
                vColor = color;
                vPhase = phase;
                float flicker = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (1.0 + fract(vPhase) * 3.0) + vPhase));
                gl_PointSize = size * max(flicker, 0.1);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uOpacity;
            varying vec3 vColor;
            varying float vPhase;
            uniform float uTime;
            uniform float uTwinkle;
            void main() {
                float d = length(gl_PointCoord - 0.5) * 2.0;
                float flicker = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (1.0 + fract(vPhase) * 3.0) + vPhase));
                float alpha = smoothstep(1.0, 0.3, d) * uOpacity * max(flicker, 0.1);
                gl_FragColor = vec4(vColor, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        vertexColors: true,
    });

    skyboxState.worldStarfield = new THREE.Points(geom, mat);
    skyboxState.worldStarfield.renderOrder = -1000;
    skyboxState.worldStarfield.frustumCulled = false;
    // `!` not `?.`: the original assumed the three context existed here and threw
    // otherwise; only the two clear* helpers above guard it.
    skyboxState.three!.scene.add(skyboxState.worldStarfield);

    // Animate twinkle (skip entirely when twinkle is off)
    skyboxState._starfieldAnimId = null;
    if (twinkle > 0) {
        const thisStarfield = skyboxState.worldStarfield;
        const startTime = performance.now();
        function animateStarfield() {
            if (!skyboxState.worldStarfield || skyboxState.worldStarfield !== thisStarfield) return;
            mat.uniforms.uTime!.value = (performance.now() - startTime) / 1000;
            skyboxState._starfieldAnimId = requestAnimationFrame(animateStarfield);
        }
        animateStarfield();
    }
}

export function renderSkybox(el: Element) {
    if (!skyboxState.three || !skyboxState.three.scene) return null;
    clearWorldSkybox();

    const style = ((el.style || el.mode || 'solid') as string).toLowerCase();
    if (style === 'none' || style === 'off') {
        return { type: 'skybox', style };
    }

    if (style === 'solid' || style === 'color') {
        // `el.color` is `string | [r,g,b]` on the schema; the skybox path has
        // always passed it straight to THREE.Color, which wants the string form.
        skyboxState.three.scene.background = new THREE.Color((el.color || '#02040b') as string);
        return { type: 'skybox', style };
    }

    if (style === 'gradient') {
        const tex = _makeGradientSkyboxTexture(
            (el.topColor || el.top) as string,
            (el.bottomColor || el.bottom) as string,
            el.starCount || 0,
            el.starColor || '#e6efff',
            el.starMinSize || 0.5,
            el.starMaxSize || 2.0
        );
        skyboxState.three.scene.background = tex;
        skyboxState.worldSkybox = { texture: tex };
        return { type: 'skybox', style };
    }

    if (style === 'cubemap' && Array.isArray(el.urls) && el.urls.length === 6) {
        try {
            const loader = new THREE.CubeTextureLoader();
            const tex = loader.load(el.urls);
            // Left at the default encoding for the same reason as the gradient
            // texture above — outputEncoding is linear, so tagging sRGB only darkens.
            skyboxState.three.scene.background = tex;
            skyboxState.worldSkybox = { texture: tex };
            return { type: 'skybox', style };
        } catch (err) {
            console.warn('skybox cubemap load failed:', err);
            skyboxState.three.scene.background = new THREE.Color('#02040b');
            return { type: 'skybox', style: 'fallback-solid' };
        }
    }

    console.warn('Unknown skybox style:', style);
    skyboxState.three.scene.background = new THREE.Color((el.color || '#02040b') as string);
    return { type: 'skybox', style: 'fallback-solid' };
}
