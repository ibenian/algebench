// The Settings popover behind the gear in the chat toolbar. For now it holds one setting: the language the AI
// talks in (src/language.ts). The field is a typeahead over the common languages that also takes any name typed,
// up to LANGUAGE_MAX_CHARS characters. Its suggestions are our own list right under the field (a native
// <datalist> opens its dropdown wherever the browser likes, away from the field).

import { LANGUAGES, LANGUAGE_MAX_CHARS, getLanguage, setLanguage, onLanguageChange } from '/language.js';

/** The listed languages that match ``typed``: names starting with it first, then names containing it. */
export function languageSuggestions(typed: string): string[] {
    const q = typed.trim().toLowerCase();
    if (!q) return [...LANGUAGES];
    const starts = LANGUAGES.filter(l => l.toLowerCase().startsWith(q));
    return [...starts, ...LANGUAGES.filter(l => !starts.includes(l) && l.toLowerCase().includes(q))];
}

export function setupChatSettings(): void {
    const btn = document.getElementById('chat-settings-btn') as HTMLButtonElement | null;
    const pop = document.getElementById('chat-settings-popover') as HTMLDivElement | null;
    const input = document.getElementById('chat-language-input') as HTMLInputElement | null;
    const list = document.getElementById('chat-language-list') as HTMLUListElement | null;
    if (!btn || !pop || !input || !list) return;

    input.maxLength = LANGUAGE_MAX_CHARS;
    const showCurrent = (lang: string) => {
        input.value = lang;
        btn.title = `Settings · language: ${lang}`;
    };
    showCurrent(getLanguage());
    onLanguageChange(showCurrent);

    // The suggestion list: filtered as the learner types, arrow keys move the highlight, Enter or a click picks.
    let active = -1;
    const items = () => [...list.querySelectorAll<HTMLLIElement>('li')];
    const highlight = (i: number) => {
        const all = items();
        active = all.length ? (i + all.length) % all.length : -1;
        all.forEach((li, j) => li.setAttribute('aria-selected', String(j === active)));
        all[active]?.scrollIntoView({ block: 'nearest' });
        input.setAttribute('aria-activedescendant', all[active]?.id ?? '');
    };
    const suggest = (typed: string) => {
        list.replaceChildren(...languageSuggestions(typed).map((lang, i) => {
            const li = document.createElement('li');
            li.id = `chat-language-option-${i}`;
            li.role = 'option';
            li.textContent = lang;
            li.addEventListener('pointerdown', e => { e.preventDefault(); pick(lang); });
            return li;
        }));
        list.hidden = !list.children.length;
        active = -1;
        // Empty: the current language is highlighted. Typed: the first name starting with it, so Enter completes
        // it; a name nothing starts with is kept as typed.
        const q = typed.trim().toLowerCase();
        const at = q ? (items()[0]?.textContent?.toLowerCase().startsWith(q) ? 0 : -1)
                     : items().findIndex(li => li.textContent === getLanguage());
        if (at >= 0) highlight(at);
    };
    const pick = (lang: string) => { input.value = lang; close(); btn.focus(); };

    const place = () => {
        const r = btn.getBoundingClientRect();
        const width = pop.offsetWidth || 260;
        pop.style.top = `${Math.round(r.bottom + 6)}px`;
        pop.style.left = `${Math.round(Math.max(8, Math.min(r.right - width, innerWidth - width - 8)))}px`;
    };
    const open = () => {
        pop.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        place();
        suggest('');
        input.focus();
        input.select();
    };
    const commit = () => showCurrent(setLanguage(input.value));
    const close = () => {
        if (pop.hidden) return;
        commit();
        pop.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
    };

    btn.addEventListener('click', () => (pop.hidden ? open() : close()));
    input.addEventListener('input', () => suggest(input.value));
    input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (list.hidden) suggest(input.value);
            highlight(active + (e.key === 'ArrowDown' ? 1 : -1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const chosen = items()[active]?.textContent;
            pick(chosen && !list.hidden ? chosen : input.value);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            showCurrent(getLanguage());
            close();
            btn.focus();
        }
    });
    document.addEventListener('pointerdown', e => {
        const t = e.target as Node;
        if (!pop.hidden && !pop.contains(t) && !btn.contains(t)) close();
    });
    addEventListener('resize', () => { if (!pop.hidden) place(); });
}
