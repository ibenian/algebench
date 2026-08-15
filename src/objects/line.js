import { state } from '/state.js';
import { parseColor, addLabel3D } from '/labels.js';
import { resolveLineWidth } from '/camera.js';

export function renderLine(el, view) {
    const points = el.points || el.data
        || (el.from && el.to ? [el.from, el.to] : null)
        || [[0,0,0],[1,1,1]];
    const color = parseColor(el.color || '#88aaff');
    const width = el.width || 3;
    const opacity = (el.opacity !== undefined) ? Number(el.opacity) : 1;
    const baseOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
    const label = el.label;

    const mid = points[Math.floor(points.length / 2)] || [0, 0, 0];
    const lineEntry = {
        node: null,
        baseWidth: width,
        baseOpacity,
        widthParam: 'lineWidth',
        anchorDataPos: mid,
    };
    const lineW = resolveLineWidth(lineEntry);
    const lineNode = view
        .array({ channels: 3, width: points.length, data: points })
        .line({ color: new THREE.Color(...color), width: lineW, zBias: 1, opacity: baseOpacity * (state.displayParams.lineOpacity || 1) });
    lineEntry.node = lineNode;
    state.lineNodes.push(lineEntry);

    if (label) {
        const mid = points[Math.floor(points.length / 2)];
        addLabel3D(label, mid, color);
    }

    return { type: 'line', color, label };
}
