import { state } from '/state.js';
import { parseColor } from '/labels.js';
import { _JS_ONLY_RE, _mathjs } from '/expr.js';

export function renderSurface(el, view) {
    const color = parseColor(el.color || '#4488ff');
    const opacity = el.opacity !== undefined ? el.opacity : 0.6;
    const rangeX = el.rangeX || [-2, 2];
    const rangeY = el.rangeY || [-2, 2];
    const expr = el.expression || el.expr || 'x + y';
    const res = el.resolution || 32;
    const label = el.label;

    const data = [];
    const dx = (rangeX[1] - rangeX[0]) / res;
    const dy = (rangeY[1] - rangeY[0]) / res;
    for (let j = 0; j <= res; j++) {
        for (let i = 0; i <= res; i++) {
            const x = rangeX[0] + i * dx;
            const y = rangeY[0] + j * dy;
            let z;
            try {
                if (_JS_ONLY_RE.test(expr) && state._sceneJsTrustState === 'trusted') {
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
