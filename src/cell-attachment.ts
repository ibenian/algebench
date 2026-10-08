/** Shared screen-space anchor for a cell's index tag and connection endpoint. */
export function cellEdgeAnchor(corners: {x: number; y: number}[], edge: 'top' | 'bottom', gap = 0) {
    const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
    return {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: edge === 'top' ? Math.min(...ys) - gap : Math.max(...ys) + gap,
    };
}
