import { state } from '/state.js';
import { dataToWorld } from '/coords.js';

function clearWorldStarfield() {
    if (!state.worldStarfield || !state.three || !state.three.scene) return;
    state.three.scene.remove(state.worldStarfield);
    if (state.worldStarfield.geometry) state.worldStarfield.geometry.dispose();
    if (state.worldStarfield.material) state.worldStarfield.material.dispose();
    state.worldStarfield = null;
}

function clearWorldSkybox() {
    if (!state.three || !state.three.scene) return;
    if (state.worldSkybox && state.worldSkybox.texture && typeof state.worldSkybox.texture.dispose === 'function') {
        state.worldSkybox.texture.dispose();
    }
    state.worldSkybox = null;
    state.three.scene.background = null;
}

function _makeGradientSkyboxTexture(topHex, bottomHex, starCount = 0, starColor = '#e6efff', starMin = 0.5, starMax = 2.0) {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
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
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

export function configureWorldStarfield(spec) {
    clearWorldStarfield();
    const cfg = spec && spec.starfield;
    if (!cfg || cfg.enabled === false) return;

    const currentRange = state.currentRange;
    const currentScale = state.currentScale;

    const spanX = Math.abs(currentRange[0][1] - currentRange[0][0]);
    const spanY = Math.abs(currentRange[1][1] - currentRange[1][0]);
    const spanZ = Math.abs(currentRange[2][1] - currentRange[2][0]);
    const halfMaxSpan = Math.max(spanX, spanY, spanZ, 1) / 2;

    const count = Math.max(50, Math.floor(cfg.count || 900));
    const radiusMin = Number.isFinite(cfg.radiusMin) ? cfg.radiusMin : halfMaxSpan * 3;
    const radiusMax = Number.isFinite(cfg.radiusMax) ? cfg.radiusMax : halfMaxSpan * 7;
    const size = Number.isFinite(cfg.size) ? cfg.size : 2.1;
    const opacity = Number.isFinite(cfg.opacity) ? cfg.opacity : 0.9;
    const twinkle = Number.isFinite(cfg.twinkle) ? Math.max(0, Math.min(1, cfg.twinkle)) : 0.25;
    const baseColor = new THREE.Color(cfg.color || '#d9e6ff');

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        const z = Math.random() * 2 - 1;
        const theta = Math.random() * Math.PI * 2;
        const rXY = Math.sqrt(Math.max(0, 1 - z * z));
        const dirX = rXY * Math.cos(theta);
        const dirY = rXY * Math.sin(theta);
        const dirZ = z;

        const u = Math.random();
        const radius = radiusMin + (radiusMax - radiusMin) * Math.pow(u, 0.6);
        const dataPos = [dirX * radius, dirY * radius, dirZ * radius];
        const w = dataToWorld(dataPos);

        const pi = i * 3;
        positions[pi] = w[0];
        positions[pi + 1] = w[1];
        positions[pi + 2] = w[2];

        const f = 1 - twinkle * Math.random();
        colors[pi] = baseColor.r * f;
        colors[pi + 1] = baseColor.g * f;
        colors[pi + 2] = baseColor.b * f;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
        size: size,
        transparent: true,
        opacity: opacity,
        sizeAttenuation: true,
        vertexColors: true,
        depthWrite: false,
    });

    state.worldStarfield = new THREE.Points(geom, mat);
    state.worldStarfield.renderOrder = -1000;
    state.worldStarfield.frustumCulled = false;
    state.three.scene.add(state.worldStarfield);
}

export function renderSkybox(el) {
    if (!state.three || !state.three.scene) return null;
    clearWorldSkybox();

    const style = (el.style || el.mode || 'solid').toLowerCase();
    if (style === 'none' || style === 'off') {
        return { type: 'skybox', style };
    }

    if (style === 'solid' || style === 'color') {
        state.three.scene.background = new THREE.Color(el.color || '#02040b');
        return { type: 'skybox', style };
    }

    if (style === 'gradient') {
        const tex = _makeGradientSkyboxTexture(
            el.topColor || el.top,
            el.bottomColor || el.bottom,
            el.starCount || 0,
            el.starColor || '#e6efff',
            el.starMinSize || 0.5,
            el.starMaxSize || 2.0
        );
        state.three.scene.background = tex;
        state.worldSkybox = { texture: tex };
        return { type: 'skybox', style };
    }

    if (style === 'cubemap' && Array.isArray(el.urls) && el.urls.length === 6) {
        try {
            const loader = new THREE.CubeTextureLoader();
            const tex = loader.load(el.urls);
            tex.colorSpace = THREE.SRGBColorSpace;
            state.three.scene.background = tex;
            state.worldSkybox = { texture: tex };
            return { type: 'skybox', style };
        } catch (err) {
            console.warn('skybox cubemap load failed:', err);
            state.three.scene.background = new THREE.Color('#02040b');
            return { type: 'skybox', style: 'fallback-solid' };
        }
    }

    console.warn('Unknown skybox style:', style);
    state.three.scene.background = new THREE.Color(el.color || '#02040b');
    return { type: 'skybox', style: 'fallback-solid' };
}
