/**
 * Horizontal placement for a popup menu anchored to a button inside a clipping panel: where its left edge goes,
 * relative to the anchor, so the menu stays inside the panel's bounds (less a margin). It starts aligned with
 * the anchor's left edge, shifts left only as far as it must, and never past the panel's left edge; a menu
 * wider than the room is narrowed to fit (the caller lets its items wrap).
 */
export function menuPlacement(anchorLeft: number, menuWidth: number, boundsLeft: number, boundsRight: number, margin = 8):
    {offset: number; maxWidth: number} {
    const room = Math.max(0, boundsRight - boundsLeft - 2 * margin);
    const width = Math.min(menuWidth, room);
    const left = Math.max(boundsLeft + margin, Math.min(anchorLeft, boundsRight - margin - width));
    return {offset: left - anchorLeft, maxWidth: room};
}
