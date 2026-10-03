// ============================================================
// side-sections.ts — Fold the Chat tab's sections (Proof, Chat) down to
// their headers, like the docked learning plan (plan-ui.ts): click the header
// or its chevron. Each section's fold is remembered.
//
// Folding the Proof leaves only its header above the chat; folding the Chat
// hides the messages and the input and gives the proof the whole tab. At
// least one stays open. A reply that arrives while the Chat is folded marks
// its header until it's opened.
// ============================================================

const svg = (d: string): string =>
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON_FOLD = svg('M6 9l6 6 6-6');
const ICON_UNFOLD = svg('M6 15l6-6 6 6');

interface Section {
    /** The section's header (`.side-section-head`). */
    head: string;
    /** The element that carries the folded class. */
    host: string;
    /** The class that folds it (styled in style.css). */
    cls: string;
    key: string;
    name: string;
}

const SECTIONS: Section[] = [
    { head: 'proof-section-head', host: 'proof-panel', cls: 'side-folded', key: 'algebench.foldProof', name: 'proof' },
    { head: 'chat-section-head', host: 'tab-chat', cls: 'chat-folded', key: 'algebench.foldChat', name: 'chat' },
];

function loadFolded(key: string): boolean {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function saveFolded(key: string, folded: boolean): void {
    try { localStorage.setItem(key, folded ? '1' : '0'); } catch { /* not remembered */ }
}

/** A wired section's handles. */
interface Wired { sec: Section; head: HTMLElement; host: HTMLElement; btn: HTMLButtonElement }
const wired: Wired[] = [];

const isFolded = (w: Wired): boolean => w.host.classList.contains(w.sec.cls);
/** On screen: the proof panel is closed (`hidden`) when there's no proof to show. */
const isShown = (w: Wired): boolean => !w.head.closest('.hidden');

function setFolded(w: Wired, folded: boolean, remember = true): void {
    w.host.classList.toggle(w.sec.cls, folded);
    w.head.classList.toggle('side-section-folded', folded);
    if (!folded) w.head.classList.remove('side-unread');
    if (remember) saveFolded(w.sec.key, folded);
}

/**
 * At least one shown section stays open: the tab must show something. Fold
 * one while the other is folded and the other opens; a section on its own
 * (the chat, with the proof closed) can't fold at all.
 */
function keepOneOpen(changed?: Wired): void {
    const shown = wired.filter(isShown);
    if (shown.length && shown.every(isFolded)) {
        const other = shown.find((w) => w !== changed) ?? shown[0]!;
        // Saved only when the learner's own fold forced it. Opened because the
        // proof is closed (at load, before a scene shows one, say), the chat's
        // saved fold is kept and comes back once the proof is shown again.
        setFolded(other, false, !!changed);
    }
    refreshButtons();
}

/** Re-apply the saved folds: the proof has just been shown again. */
function restoreSaved(): void {
    for (const w of wired) setFolded(w, loadFolded(w.sec.key), false);
    keepOneOpen();
}

function refreshButtons(): void {
    const shown = wired.filter(isShown);
    for (const w of wired) {
        const folded = isFolded(w);
        const alone = shown.length === 1 && shown[0] === w;
        w.btn.innerHTML = folded ? ICON_UNFOLD : ICON_FOLD;
        w.btn.disabled = alone && !folded;
        w.btn.title = folded ? `Show the ${w.sec.name}`
            : alone ? `The ${w.sec.name} is the only section open, so it stays open`
            : `Fold the ${w.sec.name} down to its header`;
        w.btn.setAttribute('aria-label', w.btn.title);
        w.btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
        w.head.classList.toggle('side-section-foldable', !w.btn.disabled);
    }
}

function wire(sec: Section): void {
    const head = document.getElementById(sec.head);
    const host = document.getElementById(sec.host);
    if (!head || !host || head.dataset.foldable) return;
    head.dataset.foldable = '1';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'side-head-btn side-fold-btn';
    // Before the section's own buttons (the proof's close), as in the plan's header.
    const firstBtn = head.querySelector('button');
    if (firstBtn) head.insertBefore(btn, firstBtn);
    else head.appendChild(btn);
    const w: Wired = { sec, head, host, btn };
    wired.push(w);

    const toggle = (): void => {
        if (btn.disabled) return;
        setFolded(w, !isFolded(w));
        keepOneOpen(w);
        // Graphs and the proof's overlays size themselves to their box.
        window.dispatchEvent(new Event('resize'));
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    head.addEventListener('click', (e) => {
        if (!(e.target as Element).closest('button')) toggle();
    });
    setFolded(w, loadFolded(sec.key), false);
}

/**
 * Unfold the Proof: something navigated to a proof step (a plan step, a link,
 * the AI, a click in the proof), so the step must be on screen. Scene-driven
 * proof syncing doesn't call this — a fold the learner chose survives that.
 */
export function showProofSection(): void {
    const w = wired.find((x) => x.sec.host === 'proof-panel');
    if (!w || !isFolded(w)) return;
    setFolded(w, false);
    keepOneOpen(w);
    window.dispatchEvent(new Event('resize'));
}

/** A reply that lands while the Chat is folded: mark its header so it isn't missed. */
function watchUnread(): void {
    const messages = document.getElementById('chat-messages');
    const tab = document.getElementById('tab-chat');
    const head = document.getElementById('chat-section-head');
    if (!messages || !tab || !head || typeof MutationObserver !== 'function') return;
    new MutationObserver(() => {
        if (tab.classList.contains('chat-folded')) head.classList.add('side-unread');
    }).observe(messages, { childList: true });
}

export function setupSideSections(): void {
    for (const sec of SECTIONS) wire(sec);
    // The proof opening or closing changes what's shown: a chat folded under
    // a proof that then closes must open again.
    const proof = document.getElementById('proof-panel');
    if (proof && typeof MutationObserver === 'function') {
        let shown = !proof.classList.contains('hidden');
        new MutationObserver(() => {
            const now = !proof.classList.contains('hidden');
            if (now === shown) return;   // a fold, not the proof opening or closing
            shown = now;
            if (now) restoreSaved();
            else keepOneOpen();
        }).observe(proof, { attributes: true, attributeFilter: ['class'] });
    }
    keepOneOpen();
    watchUnread();
}
