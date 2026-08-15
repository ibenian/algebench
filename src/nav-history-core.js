// ============================================================
// nav-history-core.js — Pure, browser-like navigation stack.
//
// A linear back/forward history with a cursor, bounded to a max size.
// Entries are opaque strings (serialized ViewStates). No imports, no DOM —
// unit-testable under `node --test` and reused by nav-history.js (which adds
// the History API + URL wiring) and, later, breadcrumb UI.
// ============================================================

export const DEFAULT_MAX = 100;

export class NavStack {
    constructor(max = DEFAULT_MAX) {
        this.max = Math.max(1, max | 0);
        this.entries = [];
        this.cursor = -1; // index of the current entry, -1 when empty
    }

    /**
     * Push a new entry after the cursor. Truncates any forward history
     * (classic browser behavior). No-op if equal to the current entry.
     * Enforces the max size by dropping the oldest entries.
     * @returns {boolean} true if an entry was added.
     */
    push(entry) {
        if (this.cursor >= 0 && this.entries[this.cursor] === entry) return false;
        // Drop forward history.
        this.entries.length = this.cursor + 1;
        this.entries.push(entry);
        this.cursor = this.entries.length - 1;
        // Enforce cap from the front.
        if (this.entries.length > this.max) {
            const overflow = this.entries.length - this.max;
            this.entries.splice(0, overflow);
            this.cursor -= overflow;
        }
        return true;
    }

    /** Replace the current entry in place (or seed the stack if empty). */
    replace(entry) {
        if (this.cursor < 0) {
            this.entries = [entry];
            this.cursor = 0;
        } else {
            this.entries[this.cursor] = entry;
        }
    }

    canBack() { return this.cursor > 0; }
    canForward() { return this.cursor >= 0 && this.cursor < this.entries.length - 1; }

    /** Move cursor back one; returns the new current entry or null. */
    back() {
        if (!this.canBack()) return null;
        this.cursor -= 1;
        return this.entries[this.cursor];
    }

    /** Move cursor forward one; returns the new current entry or null. */
    forward() {
        if (!this.canForward()) return null;
        this.cursor += 1;
        return this.entries[this.cursor];
    }

    /**
     * Sync the cursor to a known entry (used on popstate where the browser,
     * not us, moved). Picks the nearest matching index to the current cursor.
     * @returns {boolean} true if found.
     */
    syncTo(entry) {
        if (this.cursor >= 0 && this.entries[this.cursor] === entry) return true;
        let best = -1, bestDist = Infinity;
        for (let i = 0; i < this.entries.length; i++) {
            if (this.entries[i] === entry) {
                const d = Math.abs(i - this.cursor);
                if (d < bestDist) { bestDist = d; best = i; }
            }
        }
        if (best >= 0) { this.cursor = best; return true; }
        return false;
    }

    current() { return this.cursor >= 0 ? this.entries[this.cursor] : null; }
    getStack() { return this.entries.slice(); }
    getCursor() { return this.cursor; }
    get size() { return this.entries.length; }
}
