import { state } from '/state.js';
import { parseColor } from '/labels.js';
import { makeArrowMesh } from '/objects/vector.js';

export function renderVectors(el, view) {
    const tos   = el.tos   || [];
    const froms = el.froms || tos.map(() => [0, 0, 0]);
    const color = parseColor(el.color || '#ff8800');
    const shaftBaseScale = 1;
    const elementOpacity = (typeof el.opacity === 'number' && isFinite(el.opacity))
        ? Math.max(0, Math.min(1, el.opacity))
        : 1;

    for (let i = 0; i < tos.length; i++) {
        const from = froms[i] || [0, 0, 0];
        const to   = tos[i];
        if (!to) continue;

        makeArrowMesh(from, to, color, state.displayParams.arrowScale, shaftBaseScale, elementOpacity);
    }

    return { type: 'vectors', color };
}
