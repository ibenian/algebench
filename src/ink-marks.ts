/**
 * The shapes of a hand's marks, shared by what draws them: the presenter over the 3D view (presenter.ts) and the agent
 * on the code (code-canvas-core.ts). Geometry only; each keeps its own layer and knows nothing of the other's.
 */
export type MarkShape = 'circle' | 'underline' | 'check' | 'cross';
export type RectLike = Pick<DOMRect, 'left' | 'top' | 'width' | 'height' | 'bottom'>;

/**
 * Where a mark goes and its strokes, in the mark's own box: a circle round `rect` (a hand's loop, a little past where
 * it began), a line under it, a tick or a cross over it (beside it, a tick on a row of cells reads as the next cell's).
 */
export function markGeometry(rect: RectLike, shape: MarkShape): {left: number; top: number; w: number; h: number; strokes: string[]} {
    if (shape === 'underline') {
        const w = rect.width + 8;
        return {left: rect.left - 4, top: rect.bottom, w: w + 4, h: 12, strokes: [`M2 5 Q ${w / 2 + 2} 8 ${w + 2} 4`]};
    }
    if (shape === 'check') {
        const s = Math.max(22, Math.min(44, rect.height * 1.3));
        return {left: rect.left + rect.width / 2 - s / 2, top: rect.top + rect.height / 2 - s / 2, w: s, h: s,
            strokes: [`M${s * .08} ${s * .55} L${s * .38} ${s * .88} L${s * .95} ${s * .1}`]};
    }
    if (shape === 'cross') {
        const pad = 4, w = Math.min(rect.width, 160) + pad * 2, h = Math.min(rect.height, 80) + pad * 2;
        const left = rect.left + rect.width / 2 - w / 2, top = rect.top + rect.height / 2 - h / 2;
        return {left, top, w, h, strokes: [`M2 2 L${w - 2} ${h - 2}`, `M${w - 2} 2 L2 ${h - 2}`]};
    }
    const {rx, ry} = ringRadii(rect), cx = rx + 2, cy = ry + 2;
    const at = (deg: number) => { const a = deg * Math.PI / 180;return `${cx + rx * Math.cos(a)} ${cy + ry * Math.sin(a)}`; };
    // From the top left, once round clockwise and a little on.
    return {left: rect.left + rect.width / 2 - rx - 2, top: rect.top + rect.height / 2 - ry - 2, w: rx * 2 + 4, h: ry * 2 + 4,
        // Both arcs on the one ellipse: the second runs 200° (60° round to -100°), so it is a large arc too; flagged small,
        // SVG fits it on another ellipse, shifted, and the ring cuts across what it rings.
        strokes: [`M${at(-120)} A${rx} ${ry} 0 1 1 ${at(60)} A${rx} ${ry} 0 1 1 ${at(-100)}`]};
}
/**
 * A ring's half-axes round `rect`: an ellipse just touching a box leaves its corners outside, so the line would cross
 * what it rings (most of all on a wide label). A little wider than the box, and as tall as it must be for the corners
 * to sit inside, with a margin.
 */
export function ringRadii(rect: Pick<RectLike, 'width' | 'height'>): {rx: number; ry: number} {
    const hw = rect.width / 2, hh = rect.height / 2, rx = hw + Math.max(12, rect.width * .12);
    return {rx, ry: hh / Math.sqrt(1 - (hw / rx) ** 2) + 4};
}
