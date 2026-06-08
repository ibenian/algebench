import { parseColor, addLabel3D } from '/labels.js';

export function renderPlane(el, view) {
    const color = parseColor(el.color || '#4466aa');
    const opacity = el.opacity !== undefined ? el.opacity : 0.5;
    const normal = el.normal || [0, 1, 0];
    const point = el.point || [0, 0, 0];
    const size = el.size || 4;
    const label = el.label;

    const n = new THREE.Vector3(...normal).normalize();

    let t1;
    if (Math.abs(n.x) < 0.9) {
        t1 = new THREE.Vector3(1, 0, 0).cross(n).normalize();
    } else {
        t1 = new THREE.Vector3(0, 1, 0).cross(n).normalize();
    }
    const t2 = n.clone().cross(t1).normalize();

    const half = size / 2;
    const res = 2;
    const data = [];
    for (let j = 0; j <= res; j++) {
        for (let i = 0; i <= res; i++) {
            const u = (i / res * 2 - 1) * half;
            const v = (j / res * 2 - 1) * half;
            data.push([
                point[0] + t1.x * u + t2.x * v,
                point[1] + t1.y * u + t2.y * v,
                point[2] + t1.z * u + t2.z * v,
            ]);
        }
    }

    view
        .matrix({ channels: 3, width: res + 1, height: res + 1, data: data })
        .surface({
            shaded: false,
            color: new THREE.Color(...color),
            opacity: opacity,
            zBias: -2,
        });

    if (label) {
        addLabel3D(label, point, color);
    }

    return { type: 'plane', color, label };
}
