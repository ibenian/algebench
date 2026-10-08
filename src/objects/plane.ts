import { parseColor, addLabel3D } from '/labels.js';
import type { Element } from '/types/lesson.js';
import { compileExpr, evalExpr } from '/expr.js';
import { registerAnimExpr } from '/sliders.js';

/** parseColor returns `number[]`; spreading into `new THREE.Color(...)` needs a tuple. */
type Rgb3 = [number, number, number];

export function renderPlane(el: Element, view: MathBoxNode) {
    const color = parseColor(el.color || '#4466aa') as Rgb3;
    const opacity = el.opacity !== undefined ? el.opacity : 0.5;
    const normal = el.normal || [0, 1, 0];
    const point = el.point || [0, 0, 0];
    const size = typeof el.size === 'number' && el.size > 0 ? el.size : 4;
    const label = el.label;
    // Four corners in matrix order allow rectangular, state-bound panels.
    if(el.points?.length===4){
        const sources=el.points;
        const fns=sources.map(point=>point.map(value=>compileExpr(String(value))));
        const evaluate=()=>fns.map(point=>point.map(fn=>Number(evalExpr(fn,0))));
        const data=evaluate();
        const matrix=view.matrix({channels:3,width:2,height:2,data});
        matrix.surface({shaded:false,color:new THREE.Color(...color),opacity,zBias:-2});
        const animState={stopped:false};
        let previous=JSON.stringify(data);
        const entry={animState,exprStrings:sources.flat().map(String),_rebuildFn:()=>{
            if(animState.stopped)return;
            const next=evaluate(),key=JSON.stringify(next);
            if(key===previous)return;
            previous=key;matrix.set('data',next);
        }};
        if(sources.some(point=>point.some(value=>typeof value==='string')))registerAnimExpr(entry);
        return {type:'plane',color,label,_animState:animState,_animExprEntry:entry};
    }

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
