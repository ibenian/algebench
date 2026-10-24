/** Shared screen-space anchor for a cell's index tag and connection endpoint. */
export function cellEdgeAnchor(corners: {x: number; y: number}[], edge: 'top' | 'bottom' | 'left' | 'right', gap = 0) {
    const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
    if (edge === 'left' || edge === 'right') return {
        x: edge === 'left' ? Math.min(...xs) - gap : Math.max(...xs) + gap,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
    return {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: edge === 'top' ? Math.min(...ys) - gap : Math.max(...ys) + gap,
    };
}
