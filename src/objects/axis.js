import { state } from '/state.js';
import { parseColor, addLabel3D } from '/labels.js';
import { resolveLineWidth } from '/camera.js';

export function renderAxis(el, view) {
    const axis = el.axis || 'x';
    const range = el.range || [-5, 5];
    const color = parseColor(el.color || (axis === 'x' ? '#ff4444' : axis === 'y' ? '#44ff44' : '#4488ff'));
    const width = el.width || 2;
    const opacity = (el.opacity !== undefined) ? Number(el.opacity) : 1;
    const baseOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
    const label = el.label || axis;
    const showTicks = el.showTicks !== false;
    const span = Math.abs((range[1] || 0) - (range[0] || 0));
    const defaultTickStep = span > 0 ? Math.max(1, Math.ceil(span / 24)) : 1;
    const tickStep = Math.max(1e-9, Number(el.tickStep || defaultTickStep));

    const axisMap = { x: [1,0,0], y: [0,1,0], z: [0,0,1] };
    const dir = axisMap[axis] || [1,0,0];

    const start = dir.map(d => d * range[0]);
    const end = dir.map(d => d * range[1]);

    const axisMid = [
        (start[0] + end[0]) / 2,
        (start[1] + end[1]) / 2,
        (start[2] + end[2]) / 2,
    ];
    const axisEntry = {
        node: null,
        baseWidth: width,
        baseOpacity,
        widthParam: 'axisWidth',
        anchorDataPos: axisMid,
    };
    const axisW = resolveLineWidth(axisEntry);
    const axisLine = view
        .array({ channels: 3, width: 2, data: [start, end] })
        .line({ color: new THREE.Color(...color), width: axisW, opacity: baseOpacity * (state.displayParams.axisOpacity || 1) });
    axisEntry.node = axisLine;
    state.axisLineNodes.push(axisEntry);

    if (showTicks) {
        const ticks = [];
        const startTick = Math.ceil(range[0] / tickStep) * tickStep;
        const endTick = range[1];
        for (let i = startTick; i <= endTick + tickStep * 1e-6; i += tickStep) {
            if (Math.abs(i) < tickStep * 0.5) continue;
            ticks.push(dir.map(d => d * i));
        }
        if (ticks.length > 0) {
            view
                .array({ channels: 3, width: ticks.length, data: ticks })
                .point({ color: new THREE.Color(...color), size: 6 });
        }
    }

    if (label) {
        const labelPos = dir.map(d => d * (range[1] + 0.3));
        addLabel3D(label, labelPos, color, 'label-3d label-axis');
    }
}
