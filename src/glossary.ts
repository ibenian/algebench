// Glossary — loading and the hover/focus/tap tooltip (issue #665).
//
// Reusable on any page: renderKaTeX / renderMarkdown link glossary terms in
// whatever they render, so a page only has to (1) make a glossary active with
// loadGlossary() and (2) call installGlossaryTooltip() once. Matching lives in
// glossary-core.ts; this module fetches, merges and shows the tooltip.
//
// A glossary is built from the `glossary` of each named domain
// (static/domains/<name>/docs.json), in order, then the caller's own entries
// on top — a shared key takes the caller's entry. The app does this with a
// lesson's `import` list and its `glossary`.

import { renderKaTeX, renderMarkdown, makeAiAskButton } from '/labels.js';
import { getActiveGlossary, glossaryTermName, sanitizeGlossary, setActiveGlossary, stripGlossaryMarkers } from '/glossary-core.js';
import type { Glossary, GlossaryEntry } from '/glossary-core.js';

// ----- Loading -----

const _domainGlossaries = new Map<string, Promise<Glossary>>();

function _fetchDomainGlossary(name: string): Promise<Glossary> {
    let p = _domainGlossaries.get(name);
    if (!p) {
        p = fetch(`/api/domains/${encodeURIComponent(name)}`)
            .then((r) => (r.ok ? r.json() : {}))
            .then((docs: { glossary?: unknown }) => {
                const g = docs && docs.glossary;
                return g && typeof g === 'object' && !Array.isArray(g) ? g as Glossary : {};
            })
            .catch((err: unknown) => {
                console.warn(`[glossary] could not load glossary of domain "${name}":`, err);
                return {};
            });
        _domainGlossaries.set(name, p);
    }
    return p;
}

// Bumped by every load and clear: a load whose domain fetches resolve after
// a newer load (or a clear) has started must not overwrite its result.
let _loadGen = 0;

/** Merge the glossaries of `domains` (in order) under `entries`, and make the
 *  result the active glossary. Unknown or malformed inputs contribute nothing. */
export async function loadGlossary(domains: unknown, entries?: unknown): Promise<void> {
    const gen = ++_loadGen;
    const names = Array.isArray(domains) ? domains.filter((n): n is string => typeof n === 'string') : [];
    // Each source is sanitised on its own, so a malformed entry in one
    // cannot erase a good entry of the same key from another.
    const fromDomains = await Promise.all(names.map(_fetchDomainGlossary));
    if (gen !== _loadGen) return;
    const merged: Glossary = Object.create(null);
    for (const g of [...fromDomains.map(sanitizeGlossary), sanitizeGlossary(entries)]) {
        // defineProperty, not assignment: a "__proto__" key stays an own entry.
        for (const [k, v] of Object.entries(g)) Object.defineProperty(merged, k, { value: v, enumerable: true, writable: true, configurable: true });
    }
    setActiveGlossary(merged);
    hideGlossaryTip();
}

/** Drop the active glossary (no scene loaded), cancelling any load in flight. */
export function clearGlossary(): void {
    ++_loadGen;
    setActiveGlossary(null);
    hideGlossaryTip();
}

// ----- Tooltip -----
//
// Tips form a stack: a term inside a definition links too, and opening it
// stacks a second tip above the first (then a third, ...). Opening a term at
// level k closes everything above k. Index 0 is the tip for a term on the page.

interface Tip { el: HTMLDivElement; anchor: HTMLElement | null; }

const _tips: Tip[] = [];   // elements are created once per level and reused
let _depth = 0;            // how many of them are open
let _pinned = false;
let _restoringFocus = false;   // Escape handing focus back to a term
let _hideTimer: ReturnType<typeof setTimeout> | null = null;

function _tipId(level: number): string {
    return level === 0 ? 'glossary-tip' : `glossary-tip-${level}`;
}

/** Level of the open tip containing `node`, or -1 when it is on the page. */
function _levelOf(node: Node | null): number {
    for (let i = _depth - 1; i >= 0; i--) if (node && _tips[i]!.el.contains(node)) return i;
    return -1;
}

/** Keyboard focus sits on an open tip's term, or inside an open tip. */
function _focusHeld(): boolean {
    const a = document.activeElement;
    if (!a) return false;
    for (let i = 0; i < _depth; i++) if (_tips[i]!.anchor === a || _tips[i]!.el.contains(a)) return true;
    return false;
}

function _cancelHide(): void {
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
}

function _scheduleHide(): void {
    // Pinned by a click, or held by keyboard focus: a pointer that happens to
    // rest over a scrolling panel must not close it.
    if (_pinned || _focusHeld()) return;
    _cancelHide();
    _hideTimer = setTimeout(hideGlossaryTip, 180);
}

function _ensureTip(level: number): Tip {
    let tip = _tips[level];
    if (tip) return tip;
    const el = document.createElement('div');
    el.id = _tipId(level);
    el.className = 'glossary-tip hidden';
    el.style.zIndex = String(10000 + level);
    el.setAttribute('role', 'dialog');
    el.addEventListener('mouseenter', _cancelHide);
    el.addEventListener('mouseleave', _scheduleHide);
    el.addEventListener('focusout', () => setTimeout(_scheduleHide, 0));
    document.body.appendChild(el);
    tip = { el, anchor: null };
    _tips[level] = tip;
    return tip;
}

/** Close the tips at `level` and above. */
function _closeFrom(level: number): void {
    for (let i = level; i < _depth; i++) {
        const tip = _tips[i]!;
        tip.el.classList.add('hidden');
        if (tip.anchor) {
            tip.anchor.setAttribute('aria-expanded', 'false');
            tip.anchor.removeAttribute('aria-describedby');
        }
        tip.anchor = null;
    }
    _depth = Math.min(_depth, level);
}

function _position(tip: HTMLElement, anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect();
    const margin = 8;
    tip.style.left = '0px';
    tip.style.top = '0px';
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const below = r.bottom + 6;
    const top = below + th + margin > window.innerHeight && r.top - 6 - th >= margin
        ? r.top - 6 - th
        : below;
    const left = Math.min(Math.max(margin, r.left), window.innerWidth - tw - margin);
    tip.style.left = `${Math.max(margin, left)}px`;
    tip.style.top = `${Math.max(margin, top)}px`;
}

// A definition that mentions its own term must not link back to itself.
function _unlinkSelf(body: HTMLElement, key: string): void {
    body.querySelectorAll<HTMLElement>('.glossary-term').forEach((t) => {
        if (t.dataset.glossaryKey !== key) return;
        t.classList.remove('glossary-term');
        for (const a of ['data-glossary-key', 'tabindex', 'role', 'aria-haspopup']) t.removeAttribute(a);
    });
}

function _fill(tip: Tip, key: string, entry: GlossaryEntry): void {
    const name = glossaryTermName(key, entry);
    tip.el.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'glossary-tip-head';
    const title = document.createElement('span');
    title.className = 'glossary-tip-title';
    title.innerHTML = renderKaTeX(name, false, { glossary: false });
    head.appendChild(title);
    head.appendChild(makeAiAskButton('ai-ask-btn glossary-ask-btn', `Ask AI about ${name}`,
        () => (entry.prompt && stripGlossaryMarkers(entry.prompt)) || `Explain "${name}" in the context of what I'm looking at.`));
    tip.el.appendChild(head);
    if (entry.markdown) {
        const body = document.createElement('div');
        body.className = 'glossary-tip-body';
        body.innerHTML = renderMarkdown(entry.markdown);
        _unlinkSelf(body, key);
        tip.el.appendChild(body);
    }
    tip.el.setAttribute('aria-label', name);
}

function _show(anchor: HTMLElement): void {
    const key = anchor.dataset.glossaryKey || '';
    const g = getActiveGlossary();
    const entry = Object.prototype.hasOwnProperty.call(g, key) ? g[key] : undefined;
    // No entry, or a term that isn't rendered (a hidden tab) — nothing to anchor to.
    if (!entry || anchor.getClientRects().length === 0) return;
    _cancelHide();
    const level = _levelOf(anchor) + 1;
    const tip = _ensureTip(level);
    if (level < _depth && tip.anchor === anchor) {
        _closeFrom(level + 1);
    } else {
        _closeFrom(level);
        _fill(tip, key, entry);
        tip.anchor = anchor;
        anchor.setAttribute('aria-describedby', tip.el.id);
        _depth = level + 1;
    }
    tip.el.classList.remove('hidden');
    anchor.setAttribute('aria-expanded', 'true');
    _position(tip.el, anchor);
}

export function hideGlossaryTip(): void {
    _cancelHide();
    _pinned = false;
    _closeFrom(0);
}

// A term rendered inside a control (a camera-view button, a link) stays plain
// text: the control keeps its own click, and nested interactives are invalid.
const _CONTROL_SEL = 'button, a, input, select, textarea, label, summary';

function _termOf(target: EventTarget | null): HTMLElement | null {
    const term = target instanceof Element ? target.closest<HTMLElement>('.glossary-term') : null;
    return term && !(term.parentElement && term.parentElement.closest(_CONTROL_SEL)) ? term : null;
}

// Terms are matched on source text, so the renderer cannot know that a
// caller will put its output inside a control (a camera-view button filled
// by renderKaTeX, an authored <a> or <button>). There the term stays plain
// text, so strip what makes it look interactive — above all `tabindex`, or it
// is a keyboard stop that does nothing.
function _demoteInControl(term: Element): void {
    if (!term.parentElement || !term.parentElement.closest(_CONTROL_SEL)) return;
    for (const a of ['tabindex', 'role', 'aria-haspopup', 'aria-expanded']) term.removeAttribute(a);
}

function _demoteWithin(root: Element): void {
    if (root.matches('.glossary-term[tabindex]')) _demoteInControl(root);
    root.querySelectorAll('.glossary-term[tabindex]').forEach(_demoteInControl);
}

let _installed = false;

/** Wire the delegated listeners. Idempotent — safe for any page to call. */
export function installGlossaryTooltip(): void {
    if (_installed) return;
    _installed = true;
    _demoteWithin(document.body);
    new MutationObserver((records) => {
        for (const r of records) {
            for (const n of r.addedNodes) if (n.nodeType === 1) _demoteWithin(n as Element);
        }
        // A re-render (a new caption, an overlay update, a scene change) can
        // remove the term an open tip is anchored to; that tip and those above
        // it would otherwise stay up, pinned, over nothing.
        for (let i = 0; i < _depth; i++) {
            const a = _tips[i]!.anchor;
            if (a && !a.isConnected) {
                _closeFrom(i);
                if (!_depth) { _cancelHide(); _pinned = false; }
                break;
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('mouseover', (e) => {
        const term = _termOf(e.target);
        // While pinned, only a term inside an open tip may open (stacked).
        if (term && (!_pinned || _levelOf(term) >= 0 || _tips[0]!.anchor === term)) _show(term);
    });
    document.addEventListener('mouseout', (e) => {
        if (_termOf(e.target) && !_termOf(e.relatedTarget)) _scheduleHide();
    });
    document.addEventListener('focusin', (e) => {
        if (_restoringFocus) return;
        const term = _termOf(e.target);
        if (term) _show(term);
    });
    document.addEventListener('focusout', (e) => {
        if (!_termOf(e.target)) return;
        // Deferred so activeElement has moved on by the time it runs.
        setTimeout(_scheduleHide, 0);
    });
    // Tap / click pins the tips open (touch has no hover); a second click on
    // the same term, a click outside every tip, Escape or a scroll closes
    // them. The click is not swallowed: a term inside a clickable row (a
    // scene in the navigation tree) still triggers the row.
    document.addEventListener('click', (e) => {
        const term = _termOf(e.target);
        if (term) {
            const level = _levelOf(term) + 1;
            if (_pinned && level < _depth && _tips[level]!.anchor === term) { _closeFrom(level); if (!_depth) _pinned = false; return; }
            _show(term);
            _pinned = true;
            return;
        }
        if (_depth && _levelOf(e.target as Node) < 0) hideGlossaryTip();
    }, true);
    document.addEventListener('keydown', (e) => {
        const term = _termOf(e.target);
        if (term && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            _show(term);
            _pinned = true;
            return;
        }
        if (e.key === 'Escape' && _depth) {
            // Close the topmost tip only, and return focus to its term. That
            // focus() fires focusin on the term, which would reopen the tip
            // Escape just closed; the flag makes the handler skip it.
            const back = _tips[_depth - 1]!.anchor;
            _closeFrom(_depth - 1);
            if (!_depth) { _cancelHide(); _pinned = false; }
            if (back && document.activeElement !== back) {
                _restoringFocus = true;
                try { back.focus(); } finally { _restoringFocus = false; }
            }
        }
    });
    // Tips are fixed-position: follow their terms while the page or a doc
    // panel scrolls, and close a tip (and those above it) once its term leaves
    // the viewport. Focusing a term scrolls it into view, so hiding on any
    // scroll would close a tip the keyboard just opened.
    document.addEventListener('scroll', (e) => {
        if (!_depth) return;
        const inTip = _levelOf(e.target instanceof Node ? e.target : null);
        for (let i = inTip + 1; i < _depth; i++) {
            const tip = _tips[i]!;
            const r = tip.anchor!.getBoundingClientRect();
            if (r.bottom < 0 || r.top > window.innerHeight || r.width === 0) { _closeFrom(i); break; }
            _position(tip.el, tip.anchor!);
        }
        if (!_depth) { _cancelHide(); _pinned = false; }
    }, true);
    window.addEventListener('resize', () => { if (_depth) hideGlossaryTip(); });
}
