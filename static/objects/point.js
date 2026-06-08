import { state } from '/state.js';
import { parseColor, addLabel3D } from '/labels.js';

export function renderPoint(el, view) {
    const pos = el.position || el.at || [0, 0, 0];
    const color = parseColor(el.color || '#ffcc00');
    const size = el.size || 12;
    const label = el.label;

    const positions = el.positions || [pos];

    const pointNode = view
        .array({ channels: 3, width: positions.length, data: positions })
        .point({ color: new THREE.Color(...color), size: size, zBias: 5 });
    state.pointNodes.push({ node: pointNode });

    if (label && positions.length === 1) {
        const labelPos = [positions[0][0], positions[0][1] + 0.2, positions[0][2]];
        addLabel3D(label, labelPos, color);
    }

    return { type: 'point', color, label };
}
