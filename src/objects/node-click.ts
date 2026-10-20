/**
 * Clickable nodes: an object's `onClick` actions run when the learner clicks one of its nodes (a graph's).
 * Picking is in screen space against each node's projected box, so it matches what is drawn whatever the
 * camera; a press that turns into a drag (orbiting the view) is not a click.
 *
 * Actions, run in order with the node's idx and value bound:
 *   {action: 'setSlider', slider: 'problem', valueExpr: '…'}   set a slider to the expression's value
 *   {action: 'goToStep', step: 'branch-2'} | {stepExpr: '…'}    go to a step of the current scene, by id
 *   {action: 'goToScene', scene: 'top-k'} | {sceneExpr: '…'}   open another scene of the lesson, by id
 */
export interface ClickAction { action: 'setSlider' | 'goToStep' | 'goToScene'; slider?: string; valueExpr?: string; step?: string; stepExpr?: string; scene?: string; sceneExpr?: string }
export interface ScreenBox { index: number; minX: number; minY: number; maxX: number; maxY: number; depth: number }

/** The node under a screen point: the nearest (smallest depth) whose box contains it, or null. */
export function pickBox(boxes: readonly ScreenBox[], x: number, y: number): number | null {
    let best: ScreenBox | null = null;
    for (const b of boxes) {
        if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
        if (!best || b.depth < best.depth) best = b;
    }
    return best ? best.index : null;
}

/** A press that moved this far before release is a drag, not a click (CSS px). */
export const CLICK_SLOP_PX = 6;
export function isClick(down: {x: number; y: number} | null, up: {x: number; y: number}): boolean {
    return !!down && Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_SLOP_PX;
}
