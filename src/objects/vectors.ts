import { state } from '/state.js';
import { parseColor } from '/labels.js';
import { makeArrowMesh } from '/objects/vector.js';
import type { Vec3 } from '/coords.js';
import type { Element } from '/types/lesson.js';

/** parseColor returns `number[]`; makeArrowMesh spreads it into `new THREE.Color(...)`. */
type Rgb3 = [number, number, number];

/** The slice of the shared state object this module touches. */
interface VectorsState {
    displayParams: { arrowScale: number };
}
const vectorsState = state as unknown as VectorsState;

export function renderVectors(el: Element, view: MathBoxNode) {
    // `tos`/`froms` are undocumented-but-live element properties, admitted by
    // the lesson schema through `additionalProperties: true`.
    const tos   = (el.tos as Vec3[] | undefined)   || [];
    const froms = (el.froms as Vec3[] | undefined) || tos.map((): Vec3 => [0, 0, 0]);
    const color = parseColor(el.color || '#ff8800') as Rgb3;
    const shaftBaseScale = 1;
    const elementOpacity = (typeof el.opacity === 'number' && isFinite(el.opacity))
        ? Math.max(0, Math.min(1, el.opacity))
        : 1;

    for (let i = 0; i < tos.length; i++) {
        const from = froms[i] || [0, 0, 0];
        const to   = tos[i];
        if (!to) continue;

        makeArrowMesh(from, to, color, vectorsState.displayParams.arrowScale, shaftBaseScale, elementOpacity);
    }

    return { type: 'vectors', color };
}
