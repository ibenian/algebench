// ============================================================
// cam-buttons.ts — find a camera-view button by its key.
//
// Camera-view keys are scene-authored names (lowercased, whitespace → '-'),
// so real ones carry selector metacharacters — `side-(yz)`, `ride:-chased-ship`
// — and a deep link's `cv` can hold anything. Rather than splice the key into
// a `[data-view="…"]` selector (which throws on `"]`, or silently misses),
// compare it against each button's data-view directly.
// ============================================================

/** The `.cam-btn` whose `data-view` is exactly `view`, or null. */
export function findCamButton(view: string, root: ParentNode = document): HTMLElement | null {
    for (const btn of root.querySelectorAll<HTMLElement>('.cam-btn')) {
        if (btn.dataset.view === view) return btn;
    }
    return null;
}
