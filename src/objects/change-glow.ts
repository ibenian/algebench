/** The soft, breathing light drawn around a cell whose state just changed — shared by array and tensor. */
import type { BufferGeometry, ShaderMaterial } from 'three';
import type { Vec3 } from '/coords.js';
import { glowBreath } from '/objects/array-changes.js';

/** How far the halo reaches past the cell edge, in data units. */
export const GLOW_HALO = 0.9;

/**
 * One glowing cell: `at(x, y)` gives the world point offset (x, y) data units from the cell centre within
 * the cell's plane (already lifted a little above it); `ex`, `ey` are the cell's half extents.
 */
export interface GlowQuad { at(x: number, y: number): Vec3; ex: number; ey: number; removed?: boolean; opacity?: number; }

/**
 * A soft light around the cell: distance to a rounded rectangle (the cell's edge), measured in data units
 * so corners stay round on wide cells and the glow keeps one width whatever the cell size; brightest at the
 * edge, a quick fade inside (text stays clear) and an exponential halo outside. `breath` makes it swell.
 */
export function changeGlowMaterial(): ShaderMaterial {
    return new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { opacity: { value: 1 }, breath: { value: 1 } },
        vertexShader: `attribute float removed; attribute float cellOpacity; attribute vec2 halfSize; attribute vec2 edgeSize;
            varying float stackOpacity; varying vec2 local; varying vec2 box; varying float removedCell;
            void main(){local=(uv*2.0-1.0)*halfSize;box=edgeSize;removedCell=removed;stackOpacity=cellOpacity;
                gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `uniform float opacity; uniform float breath; varying float stackOpacity; varying vec2 local; varying vec2 box; varying float removedCell;
            void main(){float r=min(0.3,0.5*min(box.x,box.y));
                vec2 q=abs(local)-box+r;float d=length(max(q,0.0))+min(max(q.x,q.y),0.0)-r;
                float glow=d<0.0?exp(-pow(d/0.12,2.0)):exp(-d/0.2);
                vec3 light=mix(vec3(1.0,0.88,0.55),vec3(0.65,0.80,0.92),removedCell);
                float alpha=glow*mix(0.8,0.35,removedCell)*opacity*stackOpacity*breath;
                if(alpha<0.01)discard; gl_FragColor=vec4(light,alpha);}`,
    });
}

/** Two triangles per quad, each spanning the cell plus its halo. */
export function changeGlowGeometry(quads: GlowQuad[]): BufferGeometry {
    const positions: number[] = [], uv: number[] = [], removed: number[] = [], opacity: number[] = [], halves: number[] = [], edges: number[] = [];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]] as const;
    for (const q of quads) {
        const hx = q.ex + GLOW_HALO, hy = q.ey + GLOW_HALO;
        for (const [x, y] of corners) {
            positions.push(...q.at(x * hx, y * hy));
            uv.push((x + 1) / 2, (y + 1) / 2); removed.push(q.removed ? 1 : 0); opacity.push(q.opacity ?? 1);
            halves.push(hx, hy); edges.push(q.ex, q.ey);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute('removed', new THREE.Float32BufferAttribute(removed, 1));
    geometry.setAttribute('cellOpacity', new THREE.Float32BufferAttribute(opacity, 1));
    geometry.setAttribute('halfSize', new THREE.Float32BufferAttribute(halves, 2));
    geometry.setAttribute('edgeSize', new THREE.Float32BufferAttribute(edges, 2));
    return geometry;
}

/** Called from the glow mesh's onBeforeRender: element opacity in, and the breathing swell. */
export function updateGlowUniforms(material: ShaderMaterial): void {
    material.uniforms.opacity!.value = material.opacity;
    material.uniforms.breath!.value = glowBreath(performance.now());
}
