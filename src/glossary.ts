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
import { getActiveGlossary, glossaryTermName, setActiveGlossary } from '/glossary-core.js';
import type { Glossary } from '/glossary-core.js';

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

/** Merge the glossaries of `domains` (in order) under `entries`, and make the
 *  result the active glossary. Unknown or malformed inputs contribute nothing. */
export async function loadGlossary(domains: unknown, entries?: unknown): Promise<void> {
    const names = Array.isArray(domains) ? domains.filter((n): n is string => typeof n === 'string') : [];
    const fromDomains = await Promise.all(names.map(_fetchDomainGlossary));
    const merged: Glossary = Object.assign({}, ...fromDomains);
    if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
        Object.assign(merged, entries as Glossary);
    }
    setActiveGlossary(merged);
    hideGlossaryTip();
}

// ----- Tooltip -----

let _tip: HTMLDivElement | null = null;
let _anchor: HTMLElement | null = null;
let _pinned = false;
let _hideTimer: ReturnType<typeof setTimeout> | null = null;

function _cancelHide(): void {
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
}

function _scheduleHide(): void {
    // Pinned by a click, or held by keyboard focus: a pointer that happens to
    // rest over a scrolling panel must not close it.
    if (_pinned || (_anchor && document.activeElement === _anchor)) return;
    _cancelHide();
    _hideTimer = setTimeout(hideGlossaryTip, 180);
}

function _ensureTip(): HTMLDivElement {
    if (_tip) return _tip;
    const tip = document.createElement('div');
    tip.id = 'glossary-tip';
    tip.className = 'glossary-tip hidden';
    tip.setAttribute('role', 'dialog');
    tip.addEventListener('mouseenter', _cancelHide);
    tip.addEventListener('mouseleave', _scheduleHide);
    tip.addEventListener('focusout', (e) => {
        const to = e.relatedTarget as Node | null;
        if (!to || (!tip.contains(to) && to !== _anchor)) _scheduleHide();
    });
    document.body.appendChild(tip);
    _tip = tip;
    return tip;
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

function _show(anchor: HTMLElement): void {
    const key = anchor.dataset.glossaryKey || '';
    const entry = getActiveGlossary()[key];
    if (!entry) return;
    _cancelHide();
    const tip = _ensureTip();
    if (_anchor !== anchor) {
        const name = glossaryTermName(key, entry);
        tip.innerHTML = '';
        const head = document.createElement('div');
        head.className = 'glossary-tip-head';
        const title = document.createElement('span');
        title.className = 'glossary-tip-title';
        title.innerHTML = renderKaTeX(name, false, { glossary: false });
        head.appendChild(title);
        head.appendChild(makeAiAskButton('ai-ask-btn glossary-ask-btn', `Ask AI about ${name}`,
            () => entry.prompt || `Explain "${name}" in the context of what I'm looking at.`));
        const body = document.createElement('div');
        body.className = 'glossary-tip-body';
        body.innerHTML = entry.markdown ? renderMarkdown(entry.markdown, { glossary: false }) : '';
        tip.appendChild(head);
        if (entry.markdown) tip.appendChild(body);
        tip.setAttribute('aria-label', name);
        if (_anchor) _anchor.removeAttribute('aria-describedby');
        _anchor = anchor;
        anchor.setAttribute('aria-describedby', 'glossary-tip');
    }
    tip.classList.remove('hidden');
    anchor.setAttribute('aria-expanded', 'true');
    _position(tip, anchor);
}

export function hideGlossaryTip(): void {
    _cancelHide();
    _pinned = false;
    if (_tip) _tip.classList.add('hidden');
    if (_anchor) {
        _anchor.setAttribute('aria-expanded', 'false');
        _anchor.removeAttribute('aria-describedby');
    }
    _anchor = null;
}

// A term rendered inside a control (a camera-view button, a link) stays plain
// text: the control keeps its own click, and nested interactives are invalid.
const _CONTROL_SEL = 'button, a, input, select, textarea, label, summary';

function _termOf(target: EventTarget | null): HTMLElement | null {
    const term = target instanceof Element ? target.closest<HTMLElement>('.glossary-term') : null;
    return term && !(term.parentElement && term.parentElement.closest(_CONTROL_SEL)) ? term : null;
}

let _installed = false;

/** Wire the delegated listeners. Idempotent — safe for any page to call. */
export function installGlossaryTooltip(): void {
    if (_installed) return;
    _installed = true;
    document.addEventListener('mouseover', (e) => {
        const term = _termOf(e.target);
        if (term && !(_pinned && _anchor !== term)) _show(term);
    });
    document.addEventListener('mouseout', (e) => {
        if (_termOf(e.target) && !_termOf(e.relatedTarget)) _scheduleHide();
    });
    document.addEventListener('focusin', (e) => {
        const term = _termOf(e.target);
        if (term) _show(term);
    });
    document.addEventListener('focusout', (e) => {
        if (!_termOf(e.target)) return;
        const to = e.relatedTarget as Node | null;
        // Deferred so activeElement has moved off the term by the time it runs.
        if (!(to && _tip && _tip.contains(to))) setTimeout(_scheduleHide, 0);
    });
    // Tap / click pins the tip open (touch has no hover); a second click on
    // the same term, a click elsewhere, Escape or a scroll closes it. The
    // click is not swallowed: a term inside a clickable row (a scene in the
    // navigation tree) still triggers the row.
    document.addEventListener('click', (e) => {
        const term = _termOf(e.target);
        if (term) {
            if (_pinned && _anchor === term) { hideGlossaryTip(); return; }
            _show(term);
            _pinned = true;
            return;
        }
        if (_tip && !_tip.contains(e.target as Node)) hideGlossaryTip();
    }, true);
    document.addEventListener('keydown', (e) => {
        const term = _termOf(e.target);
        if (term && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            _show(term);
            _pinned = true;
            return;
        }
        if (e.key === 'Escape' && _anchor && _tip && !_tip.classList.contains('hidden')) {
            const back = _anchor;
            hideGlossaryTip();
            back.focus();
        }
    });
    // The tip is fixed-position: follow the term while the page or a doc
    // panel scrolls, and close it once the term leaves the viewport. Focusing
    // a term scrolls it into view, so hiding on any scroll would close a tip
    // the keyboard just opened.
    document.addEventListener('scroll', (e) => {
        if (!_anchor || !_tip || _tip.classList.contains('hidden')) return;
        if (e.target instanceof Node && _tip.contains(e.target)) return;
        const r = _anchor.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight || r.width === 0) hideGlossaryTip();
        else _position(_tip, _anchor);
    }, true);
    window.addEventListener('resize', () => { if (_anchor) hideGlossaryTip(); });
}
