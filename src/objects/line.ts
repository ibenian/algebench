import { state } from '/state.js';
import { parseColor, addLabel3D } from '/labels.js';
import { resolveLineWidth } from '/camera.js';
import type { Vec3 } from '/coords.js';
import type { Element } from '/types/lesson.js';
import { compileExpr, evalExpr } from '/expr.js';
import { registerAnimExpr } from '/sliders.js';

/** parseColor returns `number[]`; spreading into `new THREE.Color(...)` needs a tuple. */
type Rgb3 = [number, number, number];

/** A registered line, as camera.js's width/opacity manager expects it. */
interface LineEntry {
    node: MathBoxNode | null;
    baseWidth: number;
    baseOpacity: number;
    widthParam: string;
    anchorDataPos: number[];
}

/** The slice of the shared state object this module touches. */
interface LineState {
    lineNodes: LineEntry[];
    displayParams: { lineOpacity: number };
}
const lineState = state as unknown as LineState;

export function renderLine(el: Element, view: MathBoxNode) {
    const sources = (el.points || el.data
        || (el.from && el.to ? [el.from, el.to] : null)
        || [[0,0,0],[1,1,1]]);
    const dynamic = sources.some(point => point.some(value => typeof value === 'string'));
    const fns = dynamic ? sources.map(point => point.map(value => compileExpr(String(value)))) : null;
    const evaluatePoints = (): Vec3[] => fns!.map(point => point.map(fn => Number(evalExpr(fn,0))) as Vec3);
    const points = dynamic ? evaluatePoints() : sources as Vec3[];
    const color = parseColor(el.color || '#88aaff') as Rgb3;
    const width = el.width || 3;
    const opacity = (el.opacity !== undefined) ? Number(el.opacity) : 1;
    const baseOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
    const label = el.label;

    const mid = points[Math.floor(points.length / 2)] || [0, 0, 0];
    const lineEntry: LineEntry = {
        node: null,
        baseWidth: width,
        baseOpacity,
        widthParam: 'lineWidth',
        anchorDataPos: mid,
    };
    const lineW = resolveLineWidth(lineEntry);
    const lineData = view.array({ channels: 3, width: points.length, data: points });
    const lineNode = lineData.line({ color: new THREE.Color(...color), width: lineW, zBias: 1, opacity: baseOpacity * (lineState.displayParams.lineOpacity || 1) });
    lineEntry.node = lineNode;
    lineState.lineNodes.push(lineEntry);

    if (label) {
        // Unguarded in the original: an empty `points` threw here, and still must.
        const mid = points[Math.floor(points.length / 2)]!;
        addLabel3D(label, mid, color);
    }

    if (dynamic) {
        const animState = {stopped:false};
        let previous = JSON.stringify(points);
        const entry = {animState,exprStrings:sources.flat().map(String),_rebuildFn:()=>{
            if(animState.stopped)return;
            const next=evaluatePoints(),key=JSON.stringify(next);
            if(key===previous)return;
            previous=key;lineData.set('data',next);
            lineEntry.anchorDataPos=next[Math.floor(next.length/2)]??[0,0,0];
        }};
        registerAnimExpr(entry);
        return {type:'line',color,label,_animState:animState,_animExprEntry:entry};
    }
    return { type: 'line', color, label };
}
