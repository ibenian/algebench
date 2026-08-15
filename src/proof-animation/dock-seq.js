// Shared monotonic creation order for docked overlays (charts + proof boxes).
// Both managers stamp each box's dataset.dockOrder from this, so the shared
// dock panel can be sorted into a stable, creation-order arrangement that
// survives navigation/re-attach regardless of which manager re-attaches first.
let _seq = 0;
export const nextDockSeq = () => ++_seq;
