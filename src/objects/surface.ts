import { state } from '/state.js';
import { parseColor } from '/labels.js';
import { _JS_ONLY_RE, _mathjs } from '/expr.js';
import type { Element } from '/types/lesson.js';

/** parseColor returns `number[]`; spreading into `new THREE.Color(...)` needs a tuple. */
type Rgb3 = [number, number, number];

/** The slice of the shared state object this module touches. */
interface SurfaceState {
    _sceneJsTrustState: string | null;
}
const surfaceState = state as unknown as SurfaceState;

export function renderSurface(el: Element, view: MathBoxNode) {
    const color = parseColor(el.color || '#4488ff') as Rgb3;
    const opacity = el.opacity !== undefined ? el.opacity : 0.6;
    const rangeX = (el.rangeX as [number, number] | undefined) || [-2, 2];
    const rangeY = (el.rangeY as [number, number] | undefined) || [-2, 2];
    const expr = el.expression || (el.expr as string | undefined) || 'x + y';
    const res = (el.resolution as number | undefined) || 32;
    const label = el.label;

    const data = [];
    const dx = (rangeX[1] - rangeX[0]) / res;
    const dy = (rangeY[1] - rangeY[0]) / res;
    for (let j = 0; j <= res; j++) {
        for (let i = 0; i <= res; i++) {
            const x = rangeX[0] + i * dx;
            const y = rangeY[0] + j * dy;
            // `unknown`, not the `any` the Function constructor would infer:
            // the value is only ever handed straight to MathBox as data.
            let z: unknown;
            try {
                if (_JS_ONLY_RE.test(expr) && surfaceState._sceneJsTrustState === 'trusted') {
                    z = new Function('x', 'y', 'return ' + expr)(x, y);
                } else if (_JS_ONLY_RE.test(expr)) {
                    z = 0;
                } else {
                    z = _mathjs.evaluate(expr, { x, y });
                }
            } catch(e) {
                z = 0;
            }
            data.push([x, z, y]);
        }
    }

    view
        .matrix({
            channels: 3,
            width: res + 1,
            height: res + 1,
            data: data,
        })
        .surface({
            shaded: true,
            color: new THREE.Color(...color),
            opacity: opacity,
            zBias: 0,
        });

    return { type: 'surface', color, label };
}
