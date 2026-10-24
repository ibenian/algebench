/**
 * heap: one list shown twice, as an array (the list as stored) and as the complete binary tree it encodes
 * (slot i's children are 2i + 1 and 2i + 2, its parent ⌊(i − 1) / 2⌋). It is a thin wrapper: it renders a
 * real array under the element's id and a real graph under `<id>-tree`, both from the same lengthExpr and
 * valueExpr, the graph laid out as a tree with an edge from each slot to its parent. Both have animateMoves
 * on, so a sift's swap glides the two values in both views and a pop's last value travels to the root.
 *
 * Everything an array or a graph supports works on its view: markers on the array, label wires and links
 * to either id, colorExpr / highlightExpr per slot (shared), edgeColorExpr on the tree's edges.
 */
import { state } from '/state.js';
import type { Element } from '/types/lesson.js';
import { renderArray } from '/objects/array.js';
import { renderGraph } from '/objects/graph.js';
import { registerCompositePart } from '/objects/composite-parts.js';

type AnimState = {stopped: boolean; hiddenByRemove?: boolean};

export function renderHeap(el: Element, view: MathBoxNode) {
    if (!state.three) return null;
    const id = el.id!, treeId = `${id}-tree`;
    const [ox = 0, oy = 0, oz = 0] = (el.origin ?? [0, 0, 0]).map(Number);
    const origin: [number, number, number] = [ox, oy, oz];
    const [rx = ox, ry = oy + 3.2, rz = oz] = (el.treeOrigin ?? []).map(Number);
    const root: [number, number, number] = [rx, ry, rz];
    const node = Number(el.nodeSize ?? .9);
    const shared = {lengthExpr: el.lengthExpr, valueExpr: el.valueExpr, values: el.values, itemType: el.itemType ?? 'number',
        colorExpr: el.colorExpr, highlightExpr: el.highlightExpr, color: el.color, showIndices: el.showIndices,
        animateMoves: true, idExpr: el.idExpr, animationMs: el.animationMs};
    const row: Element = {...shared, type: 'array', id, label: el.label, labelSide: el.labelSide ?? 'left', origin, cellSize: el.cellSize,
        fontSize: el.fontSize, indexFontSize: el.indexFontSize, axisLabels: el.axisLabels, markers: el.markers, prompt: el.prompt, codeRef: el.codeRef};
    const tree: Element = {...shared, type: 'graph', id: treeId, label: el.treeLabel,
        treeLayout: {type: 'complete', origin: root, width: Number(el.treeWidth ?? 6), levelGap: Number(el.levelGap ?? 1.3)},
        nodeShape: 'rect', nodeWidth: node, nodeHeight: node, nodeCornerRadius: node / 2, valueLabel: 'inside',
        // Each slot's edge to its parent; edgeColorExpr colours (and lights) one by its child slot.
        connectTo: {indexExpr: 'idx == 0 ? -1 : floor((idx - 1) / 2)', pinned: true, bendExpr: '0', color: el.edgeColor ?? '#7f93aa',
            ...(el.edgeColorExpr ? {colorExpr: el.edgeColorExpr, highlightExpr: el.edgeColorExpr} : {})}};

    const rowResult = renderArray(row, view);
    // The tree's meshes and labels: what renderGraph adds, registered under its own id so it can be named.
    const meshesBefore = state.planeMeshes.length;
    const treeResult = renderGraph(tree, view);
    const treeMeshes = state.planeMeshes.slice(meshesBefore);
    registerCompositePart(treeId, id, view, treeMeshes, state.labels.filter(l => l.ownerMesh && treeMeshes.includes(l.ownerMesh as never)),
        el.treeLabel ?? `${el.label ?? id} as a tree`, el.prompt, 'graph');

    // One state for the loader: hiding, showing and stopping the heap reach both views.
    const parts = [rowResult?._animState, treeResult?._animState].filter((s): s is AnimState => !!s);
    const animState: AnimState = {
        get stopped() { return parts.every(p => p.stopped); },
        set stopped(v: boolean) { for (const p of parts) p.stopped = v; },
        get hiddenByRemove() { return parts.some(p => p.hiddenByRemove); },
        set hiddenByRemove(v: boolean | undefined) { for (const p of parts) p.hiddenByRemove = v; },
    };
    return {_animState: animState, _animExprEntry: rowResult?._animExprEntry, type: el.type};
}
