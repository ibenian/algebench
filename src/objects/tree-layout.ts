/**
 * Tree layouts: where each node of a tree (or forest) goes, from each node's parent. Pure, so any object can
 * use it; a graph does through `treeLayout` (graph.ts), and a heap through the 'complete' kind.
 *
 * - tidy:      any tree. Leaves evenly spaced in depth-first order, each parent centred over its children,
 *              one row per depth (or, with orientation 'horizontal', one column per depth, growing rightwards).
 * - binary:    a binary tree whose sides matter (`sideOf`: 0 left, 1 right). Nodes left to right in inorder,
 *              the picture of a binary search tree: every left subtree sits left of its parent.
 * - complete:  heap slots (parents ignored): level d holds slots 2^d − 1 .. 2^(d+1) − 2, spread evenly
 *              across `width`.
 * - radial:    root at the centre, depth d on a ring of radius d·levelGap, leaves evenly spread round it.
 * - indented:  an outline, as a file tree is shown: one row per node in preorder, indented by depth.
 *
 * Several roots (a parent of −1, an out-of-range parent, or a cycle) make a forest, laid side by side
 * (tidy, binary), one after another (indented), or round the centre (radial).
 */
export type TreeLayoutKind = 'tidy' | 'binary' | 'complete' | 'radial' | 'indented';
export interface TreeLayoutOptions {
    /** Root position (radial: the centre; indented: the first row's left end). */
    origin?: number[];
    /** Horizontal distance between neighbouring leaves (tidy, binary) or one indent (indented). */
    spacing?: number;
    /** Distance between depths (radial: between rings; indented: between rows). */
    levelGap?: number;
    /** complete: the width each level spreads across. */
    width?: number;
    /** tidy, binary: 'horizontal' grows the tree left to right (root on the left, one column per depth, leaves
     *  down the rows) instead of top to bottom; spacing is then between rows and levelGap between columns. */
    orientation?: 'vertical' | 'horizontal';
}
type Vec3 = [number, number, number];

/** Children (in index order), roots, and depths, for n nodes given each one's parent. Cycles become roots. */
export function treeShape(n: number, parentOf: (i: number) => number) {
    const parent = Array.from({length: n}, (_, i) => {
        const p = Number(parentOf(i));
        return Number.isInteger(p) && p >= 0 && p < n && p !== i ? p : -1;
    });
    // A node on a cycle (its parent chain comes back to it) is cut loose as a root, which breaks the cycle;
    // nodes merely hanging off a cycle keep their parent.
    for (let i = 0; i < n; i++) {
        for (let j = parent[i]!, steps = 0; j >= 0 && steps <= n; j = parent[j]!, steps++) if (j === i) { parent[i] = -1; break; }
    }
    const children = Array.from({length: n}, () => [] as number[]);
    parent.forEach((p, i) => { if (p >= 0) children[p]!.push(i); });
    const roots = parent.flatMap((p, i) => p < 0 ? [i] : []);
    const depth = Array<number>(n).fill(0);
    const walk = (i: number, d: number) => { depth[i] = d; for (const c of children[i]!) walk(c, d + 1); };
    roots.forEach(r => walk(r, 0));
    return {parent, children, roots, depth};
}

export function layoutTree(kind: TreeLayoutKind, n: number, parentOf: (i: number) => number, options: TreeLayoutOptions = {},
    sideOf?: (i: number) => number): Vec3[] {
    const [ox = 0, oy = 0, oz = 0] = (options.origin ?? [0, 0, 0]).map(Number);
    const spacing = Number(options.spacing ?? 1.2), gap = Number(options.levelGap ?? 1.3);
    // Leaf position along the spread, depth down the levels: top to bottom, or turned to run left to right.
    const spot = (along: number, depth: number): Vec3 => options.orientation === 'horizontal'
        ? [ox + depth * gap, oy - along * spacing, oz] : [ox + along * spacing, oy - depth * gap, oz];
    if (n <= 0) return [];
    if (kind === 'complete') {
        const width = Number(options.width ?? 6);
        return Array.from({length: n}, (_, i) => {
            const level = Math.floor(Math.log2(i + 1)), slots = 2 ** level, at = i + 1 - slots;
            return [ox - width / 2 + (at + .5) * width / slots, oy - level * gap, oz];
        });
    }
    const {children, roots, depth} = treeShape(n, parentOf);
    const x = Array<number>(n).fill(0);
    if (kind === 'indented') {
        let row = 0;
        const out = Array<Vec3>(n);
        const visit = (i: number) => { out[i] = [ox + depth[i]! * spacing, oy - row++ * gap, oz]; children[i]!.forEach(visit); };
        roots.forEach(visit);
        return out;
    }
    if (kind === 'binary') {
        // Inorder: left child, node, right child. Children with no side, or a second child on a taken side,
        // fall on whichever side is free (left first), so any tree still lays out.
        let order = 0;
        const sides = (i: number): [number | undefined, number | undefined] => {
            let left: number | undefined, right: number | undefined;
            for (const c of children[i]!) {
                const s = sideOf ? Number(sideOf(c)) : NaN;
                if (s === 1 && right === undefined) right = c;
                else if (s === 0 && left === undefined) left = c;
                else if (left === undefined) left = c;
                else if (right === undefined) right = c;
            }
            return [left, right];
        };
        const visit = (i: number) => { const [l, r] = sides(i); if (l !== undefined) visit(l); x[i] = order++; if (r !== undefined) visit(r); };
        roots.forEach(visit);
        const mid = (order - 1) / 2;
        return Array.from({length: n}, (_, i) => spot(x[i]! - mid, depth[i]!));
    }
    // Tidy (and radial, from the same leaf order): leaves 0, 1, 2… depth-first; a parent centred over the
    // span of its children.
    let leaves = 0;
    const place = (i: number): number => {
        const c = children[i]!;
        if (!c.length) return (x[i] = leaves++);
        const xs = c.map(place);
        return (x[i] = (xs[0]! + xs[xs.length - 1]!) / 2);
    };
    roots.forEach(place);
    if (kind === 'radial') {
        // A leaf's share of the circle; the root(s) sit at the centre, one ring per depth.
        return Array.from({length: n}, (_, i) => {
            if (depth[i] === 0 && roots.length === 1) return [ox, oy, oz];
            const angle = Math.PI / 2 - 2 * Math.PI * (x[i]! + .5) / Math.max(1, leaves);
            const r = (depth[i]! + (roots.length > 1 ? 1 : 0)) * gap;
            return [ox + r * Math.cos(angle), oy + r * Math.sin(angle), oz];
        });
    }
    const mid = (leaves - 1) / 2;
    return Array.from({length: n}, (_, i) => spot(x[i]! - mid, depth[i]!));
}
