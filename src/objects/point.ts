import { state } from '/state.js';
import { parseColor, addLabel3D } from '/labels.js';
import type { Vec3 } from '/coords.js';
import type { Element } from '/types/lesson.js';

/** parseColor returns `number[]`; spreading into `new THREE.Color(...)` needs a tuple. */
type Rgb3 = [number, number, number];

/** The slice of the shared state object this module touches. */
interface PointState {
    pointNodes: { node: MathBoxNode }[];
}
const pointState = state as unknown as PointState;

export function renderPoint(el: Element, view: MathBoxNode) {
    const pos = (el.position || el.at || [0, 0, 0]) as Vec3;
    const color = parseColor(el.color || '#ffcc00') as Rgb3;
    const size = typeof el.size === 'number' && el.size > 0 ? el.size : 12;
    const label = el.label;

    // `positions` is one of the undocumented-but-live element properties the
    // lesson schema admits through `additionalProperties: true`.
    const positions = (el.positions as Vec3[] | undefined) || [pos];

    const pointNode = view
        .array({ channels: 3, width: positions.length, data: positions })
        .point({ color: new THREE.Color(...color), size: size, zBias: 5 });
    pointState.pointNodes.push({ node: pointNode });

    if (label && positions.length === 1) {
        // `!` not `?.`: the length check already guarantees the element, and the
        // original threw here rather than silently skipping the label.
        const labelPos = [positions[0]![0], positions[0]![1] + 0.2, positions[0]![2]];
        addLabel3D(label, labelPos, color);
    }

    return { type: 'point', color, label };
}
