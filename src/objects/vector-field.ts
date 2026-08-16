import { state } from '/state.js';
import { parseColor } from '/labels.js';
import { _JS_ONLY_RE, _mathjs } from '/expr.js';
import type { Element } from '/types/lesson.js';

/** parseColor returns `number[]`; spreading into `new THREE.Color(...)` needs a tuple. */
type Rgb3 = [number, number, number];

/** A compiled field component: a trusted-JS function, a math.js node, or nothing. */
type VectorFieldFn =
    | ((x: number, y: number, z: number) => number)
    | import('mathjs').EvalFunction
    | null;

/** The slice of the shared state object this module touches. */
interface VectorFieldState {
    _sceneJsTrustState: string | null;
}
const vectorFieldState = state as unknown as VectorFieldState;

export function renderVectorField(el: Element, view: MathBoxNode) {
    const color = parseColor(el.color || '#88ccff') as Rgb3;
    const opacity = el.opacity !== undefined ? el.opacity : 0.6;
    const range = (el.range || [[-2, 2], [-2, 2], [-2, 2]]) as [[number, number], [number, number], [number, number]];
    const density = el.density || 3;
    const scale = (el.scale as number | undefined) || 0.3;
    const label = el.label;

    const exprX = el.fx || 'y';
    const exprY = el.fy || '-x';
    const exprZ = el.fz || '0';

    const _compileVF = (e: string): VectorFieldFn => {
        if (_JS_ONLY_RE.test(e)) {
            if (vectorFieldState._sceneJsTrustState === 'trusted') {
                return new Function('x', 'y', 'z', 'return ' + e) as (x: number, y: number, z: number) => number;
            }
            return null;
        }
        return _mathjs.compile(e);
    };
    const _evalVF = (compiled: VectorFieldFn, x: number, y: number, z: number): number => {
        if (!compiled) return 0;
        if (typeof compiled === 'function') return compiled(x, y, z);
        return compiled.evaluate({ x, y, z }) as number;
    };
    const compiledX = _compileVF(exprX);
    const compiledY = _compileVF(exprY);
    const compiledZ = _compileVF(exprZ);

    const starts = [];
    const ends = [];
    const rangeX = range[0], rangeY = range[1], rangeZ = range[2];
    const dxStep = (rangeX[1] - rangeX[0]) / density;
    const dyStep = (rangeY[1] - rangeY[0]) / density;
    const dzStep = (rangeZ[1] - rangeZ[0]) / density;

    for (let xi = 0; xi <= density; xi++) {
        for (let yi = 0; yi <= density; yi++) {
            for (let zi = 0; zi <= density; zi++) {
                const x = rangeX[0] + xi * dxStep;
                const y = rangeY[0] + yi * dyStep;
                const z = rangeZ[0] + zi * dzStep;
                try {
                    const vx = _evalVF(compiledX, x, y, z);
                    const vy = _evalVF(compiledY, x, y, z);
                    const vz = _evalVF(compiledZ, x, y, z);
                    starts.push([x, y, z]);
                    ends.push([x + vx*scale, y + vy*scale, z + vz*scale]);
                } catch(e) {}
            }
        }
    }

    for (let i = 0; i < starts.length; i++) {
        view
            .array({ channels: 3, width: 2, data: [starts[i], ends[i]] })
            .line({ color: new THREE.Color(...color), width: 2, opacity: opacity });
    }

    if (starts.length > 0) {
        view
            .array({ channels: 3, width: ends.length, data: ends })
            .point({ color: new THREE.Color(...color), size: 4, opacity: opacity });
    }

    return { type: 'vector_field', color, label };
}
