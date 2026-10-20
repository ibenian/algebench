/**
 * A graph: nodes with a value each, placed by an expression, linked by connectTo. Nodes are discs ('point',
 * value written outside) or rounded blocks ('rect', value inside); one mesh holds them all. The graph behaves
 * like an array towards the rest of the app: it exposes its nodes as cells (arrayCellTarget), so owned index
 * markers sit on and glide between nodes, label wires and other objects' links can point at a node, and its own
 * connectTo is drawn live by the cell-link layer (a target without `object` stays in this graph).
 * Expressions run on state changes, never per frame.
 */
import { state } from '/state.js';
import { dataToWorld } from '/coords.js';
import { addLabel3D, parseColor } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import { registerAnimExpr } from '/sliders.js';
import type { AnimExprEntry } from '/sliders.js';
import type { Element } from '/types/lesson.js';
import { renderStepMarker } from '/objects/step-marker.js';
import { arrayCell, dynamicArrayLength } from '/objects/array-data.js';
import { setCellLinks } from '/cell-links.js';
import { compileLinkTargets, evaluateLinkTargets } from '/objects/link-targets.js';
import type { ArrayCellTarget } from '/objects/array.js';
import { identityTracker } from '/objects/cell-identity.js';
import { createCellGlide } from '/objects/cell-glide.js';
import { layoutTree } from '/objects/tree-layout.js';
import type { TreeLayoutKind } from '/objects/tree-layout.js';

const HIGHLIGHT = '#f1cc59', DEFAULT = '#9dbde3';
let graphMarkerGroup = 0;

/** Outline of one node in data units, centred on (x, y): a circle, or a rectangle with rounded corners. */
export function nodeOutline(shape: 'point' | 'rect', w: number, h: number, radius: number, segments = 24): [number, number][] {
    if (shape === 'point') return Array.from({length: segments}, (_, k) => {
        const a = 2 * Math.PI * k / segments; return [Math.cos(a) * w / 2, Math.sin(a) * w / 2];
    });
    const r = Math.min(radius, w / 2, h / 2), pts: [number, number][] = [];
    const corners: [number, number, number][] = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI], [w / 2 - r, -h / 2 + r, 1.5 * Math.PI]];
    for (const [cx, cy, a0] of corners) {
        const steps = r > 0 ? 6 : 0;
        for (let s = 0; s <= steps; s++) { const a = a0 + (Math.PI / 2) * s / Math.max(steps, 1); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    }
    return pts;
}

export function renderGraph(el: Element, view: MathBoxNode) {
    if (!state.three) return null;
    const shape = el.nodeShape === 'rect' ? 'rect' : 'point';
    const w = shape === 'point' ? Number(el.nodeSize ?? .45) : Number(el.nodeWidth ?? 1);
    const h = shape === 'point' ? w : Number(el.nodeHeight ?? .7);
    const radius = Number(el.nodeCornerRadius ?? .12);
    if (![w, h].every(v => Number.isFinite(v) && v > 0)) throw new Error('Graph node size must be positive.');
    const outline = nodeOutline(shape, w, h, radius);
    const depth = Math.max(0, Number(el.nodeDepth ?? .22));
    const valueAt = el.valueLabel && el.valueLabel !== 'auto' ? el.valueLabel : shape === 'point' ? 'outside' : 'inside';
    const lengthFn = el.lengthExpr ? compileExpr(el.lengthExpr) : null;
    const valueFn = el.valueExpr ? compileExpr(el.valueExpr) : null;
    const positionFns = (el.positionExpr ?? []).map(p => compileExpr(String(p)));
    // treeLayout: the nodes form a tree (or forest) by parentExpr, laid out by tree-layout instead of positionExpr.
    const tree = el.treeLayout;
    const parentFn = tree?.parentExpr ? compileExpr(tree.parentExpr) : null, sideFn = tree?.sideExpr ? compileExpr(tree.sideExpr) : null;
    if (!tree && positionFns.length !== 3) throw new Error('A graph needs positionExpr: [x, y, z] expressions per node, or a treeLayout.');
    const colorFn = el.colorExpr ? compileExpr(el.colorExpr) : null;
    const highlightFn = el.highlightExpr ? compileExpr(el.highlightExpr) : null;
    const links = compileLinkTargets(el.connectTo, el.id, true);
    const showIndices = el.showIndices !== false;
    // Cell content (nodeCellsExpr): a node is a row of cells, one per value in its list, like a small array
    // (a B-tree node's keys). It has a port under each gap, cells + 1 of them, where child links can start.
    const cellsFn = el.nodeCellsExpr ? compileExpr(el.nodeCellsExpr) : null;
    const cellW = Number(el.nodeCellWidth ?? .7);
    const cellHighlightFn = el.cellHighlightExpr ? compileExpr(el.cellHighlightExpr) : null;
    const cellOutline = nodeOutline('rect', Math.max(.05, cellW - .06), h, Math.min(radius, .08));

    const material = new THREE.MeshBasicMaterial({vertexColors: true, transparent: true, opacity: 1, side: THREE.DoubleSide});
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.userData.ignorePlaneOpacity = true; mesh.userData.targetOpacity = 1;
    state.three.scene.add(mesh); state.planeMeshes.push(mesh);

    type Node = {x: number; y: number; z: number; value: unknown; cells: unknown[] | null; cellLit: boolean[]; hw: number; color: string | null; lit: boolean};
    let nodes: Node[] = [];
    // The data axes may be scaled differently (a 14 × 10 range on a square view), so nodes are shaped in world
    // space with one scale, the x axis's: discs stay round and blocks keep their proportions. In data units a
    // node is then w/2 wide and (w/2)·(sx/sy) tall, which is what anchors, markers and links measure.
    const axes = () => {
        const o = dataToWorld([0, 0, 0]), ex = dataToWorld([1, 0, 0]), ey = dataToWorld([0, 1, 0]);
        const vx = ex.map((v, i) => v - o[i]!), vy = ey.map((v, i) => v - o[i]!);
        const sx = Math.hypot(...vx) || 1, sy = Math.hypot(...vy) || 1;
        return {sx, sy, ux: vx.map(v => v / sx), uy: vy.map(v => v / sy)};
    };
    let span = {hw: w / 2, hh: h / 2};
    const animState: {stopped: boolean; hiddenByRemove?: boolean} = {stopped: false};
    const cellTarget: ArrayCellTarget = {vertical: false, graph: true, round: shape === 'point' || radius >= Math.min(w, h) / 2, at(index) {
        const n = Number.isInteger(index) ? nodes[index] : undefined;
        if (!n) return null;
        const hw = n.hw, {hh} = span;
        return {position: [n.x, n.y, n.z], corners: [[n.x - hw, n.y - hh, n.z], [n.x + hw, n.y - hh, n.z], [n.x + hw, n.y + hh, n.z], [n.x - hw, n.y + hh, n.z]]};
    }, ports(index) {
        // Under a cell row: one port per gap, from the left edge to the right; otherwise just the bottom centre.
        const n = Number.isInteger(index) ? nodes[index] : undefined;
        if (!n) return [];
        const bottom = n.y - span.hh;
        if (!n.cells) return [[n.x, bottom, n.z]];
        return Array.from({length: n.cells.length + 1}, (_, p) => [n.x - n.hw + p * cellW, bottom, n.z]);
    }};
    mesh.userData.arrayCellTarget = cellTarget;

    // animateMoves: a value that moves to another node glides there (identity from idExpr, else matched by value).
    const idFn = el.idExpr ? compileExpr(el.idExpr) : null;
    const identities = el.animateMoves ? identityTracker(`${el.id ?? 'graph'}:`) : null;
    const glide = identities ? createCellGlide({ms: Math.max(0, Number(el.animationMs ?? 450)), stopped: () => animState.stopped, draw: () => paint()}) : null;
    const drawnAt = (i: number): [number, number, number] => {
        const n = nodes[i];
        const home: [number, number, number] = n ? [n.x, n.y, n.z] : [0, 0, 0];
        return glide ? glide.at(i, home) : home;
    };
    const owner = {group: 'graph-markers:' + graphMarkerGroup++, animState,
        position: (index: number) => cellTarget.at(index)?.position ?? null,
        corners: (index: number) => cellTarget.at(index)?.corners ?? []};
    const markers = (el.markers ?? []).map(marker => renderStepMarker({...marker, type: 'step_marker'}, view, owner));

    // Value and index labels, one per node, created as nodes appear and kept while they exist.
    const valueLabels: ReturnType<typeof addLabel3D>[] = [], indexLabels: ReturnType<typeof addLabel3D>[] = [];
    const labelFor = (list: typeof valueLabels, i: number, cls: string) => {
        let label = list[i];
        if (!label) {
            label = addLabel3D('', [0, 0, 0], '#e6edf5', {cssClass: `label-3d ${cls}`});
            label.ownerMesh = mesh; label.snapToProjection = true; list[i] = label;
        }
        return label;
    };

    const cellLabels = new Map<string, ReturnType<typeof addLabel3D>>();
    const cellLabelFor = (key: string) => {
        let label = cellLabels.get(key);
        if (!label) {
            label = addLabel3D('', [0, 0, 0], '#e6edf5', {cssClass: 'label-3d graph-node-value graph-node-value-inside'});
            label.ownerMesh = mesh; label.snapToProjection = true; cellLabels.set(key, label);
        }
        return label;
    };

    const rebuild = () => {
        const count = lengthFn ? dynamicArrayLength(evalExpr(lengthFn, 0)) : Array.isArray(el.values) ? el.values.length : 0;
        const values = Array.from({length: count}, (_, i) => valueFn ? evalExpr(valueFn, 0, {overrideScope: {idx: i}}) : el.values?.[i]);
        const scoped = (fn: ReturnType<typeof compileExpr> | null, i: number) => fn ? Number(evalExpr(fn, 0, {overrideScope: {idx: i, value: values[i]}})) : NaN;
        const laid = tree ? layoutTree(tree.type as TreeLayoutKind, count, i => parentFn ? scoped(parentFn, i) : -1,
            {origin: tree.origin, spacing: tree.spacing, levelGap: tree.levelGap, width: tree.width}, sideFn ? i => scoped(sideFn, i) : undefined) : null;
        const next = Array.from({length: count}, (_, i) => {
            const value = values[i];
            const [x, y, z] = laid ? laid[i]! : positionFns.map(fn => Number(evalExpr(fn, 0, {overrideScope: {idx: i, value}})));
            if (![x, y, z].every(Number.isFinite)) throw new Error(`Graph node ${i} has no position.`);
            let color: string | null = null;
            try { const c = colorFn ? evalExpr(colorFn, 0, {overrideScope: {idx: i, value}}) : ''; if (typeof c === 'string' && c) color = c; } catch { /* default colour */ }
            const lit = highlightFn ? !!evalExpr(highlightFn, 0, {overrideScope: {idx: i, value}}) : false;
            let cells: unknown[] | null = null, cellLit: boolean[] = [];
            if (cellsFn) {
                const raw = evalExpr(cellsFn, 0, {overrideScope: {idx: i, value}});
                const plain = raw !== null && typeof raw === 'object' && 'valueOf' in raw ? (raw as {valueOf(): unknown}).valueOf() : raw;
                cells = Array.isArray(plain) ? plain.flat(Infinity) : [plain];
                cellLit = cells.map((v, c) => { try { return !!(cellHighlightFn && evalExpr(cellHighlightFn, 0, {overrideScope: {node: i, idx: c, value: v}})); } catch { return false; } });
            }
            const hw = cells ? Math.max(1, cells.length) * cellW / 2 : w / 2;
            return {x: x!, y: y!, z: z!, value, cells, cellLit, hw, color: color ?? (lit ? HIGHLIGHT : el.color ? null : DEFAULT), lit};
        });
        // animateMoves: where each moving value was drawn, read before the nodes change.
        const moves = identities?.next(next.map(n => JSON.stringify(n.value ?? null)),
            idFn ? next.map((n, i) => String(evalExpr(idFn, 0, {overrideScope: {idx: i, value: n.value}}))) : undefined);
        const before = moves?.size ? new Map([...new Set(moves.values())].map(p => [p, drawnAt(p)])) : null;
        nodes = next;
        if (glide && moves) glide.moved(moves, p => before?.get(p) ?? null);
        paint();
        for (const marker of markers) marker._animExprEntry._rebuildFn?.();
        if (links.length) setCellLinks(el.id!, evaluateLinkTargets(links, next.map(n => n.value), {bend: Number(el.edgeBend ?? .12)}), links.some(l => l.pinned));
    };
    // Draw the nodes where their values are now: home, or on their way there while they glide. Index tags,
    // markers and links belong to the node's place, so they stay put.
    const paint = () => {
        const next = nodes;
        // One triangle fan per node, shaped in world space with a single scale (see axes()).
        const positions: number[] = [], colors: number[] = [];
        const {sx, sy, ux, uy} = axes();
        span = {hw: w / 2, hh: (h / 2) * sx / sy};
        const offset = (centre: number[], ax: number, ay: number) => centre.map((c, i) => c + (ax * ux[i]! + ay * uy[i]!) * sx);
        // A node is a slab as thick as an array cell (nodeDepth, 0.22 like an array's boxes): its face in the
        // node's colour, its rim shaded as an array cell's sides are, lighter where it faces up.
        const o = dataToWorld([0, 0, 0]), half = dataToWorld([0, 0, depth / 2]).map((v, i) => v - o[i]!);
        const push = (p: number[], fill: number[], shade: number) => { positions.push(...p); colors.push(fill[0]! * shade, fill[1]! * shade, fill[2]! * shade); };
        const fan = (centre: number[], shape: [number, number][], fill: number[]) => {
            const front = centre.map((c, i) => c + half[i]!), back = centre.map((c, i) => c - half[i]!);
            for (let k = 0; k < shape.length; k++) {
                const [ax, ay] = shape[k]!, [bx, by] = shape[(k + 1) % shape.length]!;
                const fa = offset(front, ax, ay), fb = offset(front, bx, by);
                for (const p of [front, fa, fb]) push(p, fill, 1);
                if (depth <= 0) continue;
                const ba = offset(back, ax, ay), bb = offset(back, bx, by);
                for (const p of [back, bb, ba]) push(p, fill, .56);
                // The outline runs counter-clockwise, so this edge faces (dy, −dx): up-facing rims catch the light.
                const ny = -(bx - ax) / (Math.hypot(bx - ax, by - ay) || 1), shade = .56 + .22 * Math.max(0, ny);
                for (const p of [fa, ba, bb, fa, bb, fb]) push(p, fill, shade);
            }
        };
        next.forEach((n, i) => {
            const rgb = parseColor(n.color ?? (typeof el.color === 'string' ? el.color : DEFAULT));
            const fill = n.lit && n.color !== HIGHLIGHT ? rgb.map(c => c + (1 - c) * .35) : rgb;
            if (!n.cells) { fan(dataToWorld(drawnAt(i)), outline, fill); return; }
            // A cell row: one block per cell, side by side, a lit cell in the highlight gold.
            n.cells.forEach((_, c) => fan(dataToWorld([n.x - n.hw + (c + .5) * cellW, n.y, n.z]), cellOutline, n.cellLit[c] ? parseColor(HIGHLIGHT) : fill));
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        mesh.geometry.dispose(); mesh.geometry = geometry;
        next.forEach((n, i) => {
            let text: string;
            // A string is a name here ("v3"), not a string literal: written as is, without quotes.
            if (typeof n.value === 'string') text = n.value;
            else try { text = arrayCell(n.value ?? null, el.itemType ?? 'mixed').text; } catch { text = String(n.value ?? ''); }
            if (n.cells) n.cells.forEach((v, c) => {
                const label = cellLabelFor(`${i}:${c}`);
                label.dataPos = [n.x - n.hw + (c + .5) * cellW, n.y, n.z];
                const t = typeof v === 'string' ? v : String(v ?? '');
                if (label.el.textContent !== t) label.el.textContent = t;
                label.el.style.display = '';
            });
            else if (valueAt !== 'none') {   // no label at all when values are not shown
                const value = labelFor(valueLabels, i, `graph-node-value graph-node-value-${valueAt}`), [x, y, z] = drawnAt(i);
                value.dataPos = valueAt === 'inside' ? [x, y, z] : [x + span.hw + .25, y, z];
                if (value.el.textContent !== text) value.el.textContent = text;
            }
            if (showIndices) {
                const tag = labelFor(indexLabels, i, 'graph-node-index');
                tag.dataPos = [n.x, n.y - span.hh - .3 * sx / sy, n.z];
                if (tag.el.textContent !== String(i)) tag.el.textContent = String(i);
            }
        });
        // Nodes (and cells) that went away keep their labels for reuse, hidden.
        for (const list of [valueLabels, indexLabels]) list.forEach((label, i) => { label.el.style.display = i < next.length ? '' : 'none'; });
        for (const [key, label] of cellLabels) {
            const [i, c] = key.split(':').map(Number);
            if (!(next[i!]?.cells && c! < next[i!]!.cells!.length)) label.el.style.display = 'none';
        }
    };
    const entry: AnimExprEntry = {animState, exprStrings: [el.lengthExpr, el.valueExpr, el.idExpr, el.treeLayout?.parentExpr, el.treeLayout?.sideExpr, ...(el.positionExpr ?? []).map(String), el.colorExpr, el.highlightExpr, el.nodeCellsExpr, el.cellHighlightExpr,
        ...links.flatMap(l => l.sources), ...markers.flatMap(m => m._animExprEntry.exprStrings ?? [])].filter((v): v is string => !!v),
        _rebuildFn: () => { if (!animState.stopped && !animState.hiddenByRemove) rebuild(); }};
    try { rebuild(); } catch (error) { console.warn('graph:', error); }
    material.addEventListener('dispose', () => { animState.stopped = true; glide?.dispose(); });
    registerAnimExpr(entry);
    return {_animState: animState, _animExprEntry: entry, type: el.type};
}
