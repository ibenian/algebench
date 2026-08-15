import { parseColor } from '/labels.js';

export function renderGrid(el, view) {
    const plane = el.plane || 'xy';
    const range = el.range || [-5, 5];
    const color = parseColor(el.color || [0.3, 0.3, 0.5]);
    const opacity = el.opacity !== undefined ? el.opacity : 0.15;
    const divideX = el.divisions || 10;
    const divideY = el.divisions || 10;

    const axes = { xy: [1, 2], xz: [1, 3], yz: [2, 3] };
    const gridAxes = axes[plane] || [1, 2];

    view
        .area({
            rangeX: range,
            rangeY: range,
            width: divideX + 1,
            height: divideY + 1,
            axes: gridAxes,
            channels: 3,
        })
        .surface({
            shaded: false,
            fill: false,
            lineX: true,
            lineY: true,
            color: new THREE.Color(...color),
            opacity: opacity,
            width: 1,
            zBias: -1,
        });
}
