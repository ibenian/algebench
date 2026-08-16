import { state } from '/state.js';
import { parseColor, addLabel3D } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import type { CompiledExpr } from '/expr.js';
import { resolveLineWidth } from '/camera.js';
import type { Vec3 } from '/coords.js';
import type { Element } from '/types/lesson.js';

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

/** A live expression-driven element, as the scene loader's rebuild pass expects it. */
interface AnimExprEntry {
    exprStrings: string[];
    animState: { stopped: boolean };
    compiledFns: CompiledExpr[];
    _isParametricCurve: boolean;
    _rebuildFn(): void;
}

/** The slice of the shared state object this module touches. */
interface ParametricCurveState {
    lineNodes: LineEntry[];
    displayParams: { lineOpacity: number };
    activeAnimExprs: AnimExprEntry[];
}
const parametricCurveState = state as unknown as ParametricCurveState;

export function renderParametricCurve(el: Element, view: MathBoxNode) {
    const color = parseColor(el.color || '#ff88aa') as Rgb3;
    const width = el.width || 3;
    const range = (el.range || [0, 2 * Math.PI]) as [number, number];
    const samples = el.samples || 128;
    const opacity = (el.opacity !== undefined) ? Number(el.opacity) : 1;
    const baseOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
    const label = el.label;
    const labelOffset = (Array.isArray(el.labelOffset) && el.labelOffset.length === 3)
        ? [Number(el.labelOffset[0]) || 0, Number(el.labelOffset[1]) || 0, Number(el.labelOffset[2]) || 0]
        : [0, 0.3, 0];

    const exprX = el.x || 'Math.cos(t)';
    const exprY = el.y || 'Math.sin(t)';
    const exprZ = el.z || '0';

    function buildPoints(fnX: CompiledExpr, fnY: CompiledExpr, fnZ: CompiledExpr): Vec3[] {
        const pts: Vec3[] = [];
        const dt = (range[1] - range[0]) / samples;
        // `u` is a documented alias for the curve parameter (the validators
        // and overlay allowlist accept it), so expose it alongside `t`.
        // Hoisted out of the loop; only the alias value mutates per sample.
        const opts = { useVirtualTime: false, extraScope: { u: 0 } };
        for (let i = 0; i <= samples; i++) {
            const t = range[0] + i * dt;
            opts.extraScope.u = t;
            try {
                const x = evalExpr(fnX, t, opts) as number;
                const y = evalExpr(fnY, t, opts) as number;
                const z = evalExpr(fnZ, t, opts) as number;
                pts.push([isFinite(x) ? x : 0, isFinite(y) ? y : 0, isFinite(z) ? z : 0]);
            } catch(e) {
                pts.push([0, 0, 0]);
            }
        }
        return pts;
    }

    let fnX = compileExpr(exprX);
    let fnY = compileExpr(exprY);
    let fnZ = compileExpr(exprZ);
    const points = buildPoints(fnX, fnY, fnZ);

    const curveMid = points[Math.floor(points.length / 2)] || [0, 0, 0];
    const curveEntry: LineEntry = {
        node: null,
        baseWidth: width,
        baseOpacity,
        widthParam: 'lineWidth',
        anchorDataPos: curveMid,
    };
    const lineW = resolveLineWidth(curveEntry);
    const curveData = view
        .array({ channels: 3, width: points.length, data: points, live: true });
    const curveNode = curveData.line({ color: new THREE.Color(...color), width: lineW, opacity: baseOpacity * (parametricCurveState.displayParams.lineOpacity || 1) });
    curveEntry.node = curveNode;
    parametricCurveState.lineNodes.push(curveEntry);

    let labelEl = null;
    if (label) {
        // `!` not `?.`: `samples` is always >= 0 so the midpoint exists, and the
        // original threw rather than silently dropping the label.
        const mid = points[Math.floor(points.length / 2)]!;
        labelEl = addLabel3D(label, [
            mid[0] + labelOffset[0]!,
            mid[1] + labelOffset[1]!,
            mid[2] + labelOffset[2]!,
        ], color);
    }

    const animState = { stopped: false };
    const animExprEntry: AnimExprEntry = {
        exprStrings: [exprX, exprY, exprZ],
        animState,
        compiledFns: [fnX, fnY, fnZ],
        _isParametricCurve: true,
        _rebuildFn() {
            const newFnX = compileExpr(exprX);
            const newFnY = compileExpr(exprY);
            const newFnZ = compileExpr(exprZ);
            const pts = buildPoints(newFnX, newFnY, newFnZ);
            curveData.set('data', pts);
            if (labelEl) {
                const mid = pts[Math.floor(pts.length / 2)]!;
                labelEl.dataPos[0] = mid[0] + labelOffset[0]!;
                labelEl.dataPos[1] = mid[1] + labelOffset[1]!;
                labelEl.dataPos[2] = mid[2] + labelOffset[2]!;
            }
        },
    };
    parametricCurveState.activeAnimExprs.push(animExprEntry);

    return { type: 'parametric_curve', color, label, _animState: animState, _animExprEntry: animExprEntry };
}
