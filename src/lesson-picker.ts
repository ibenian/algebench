// ============================================================
// Lesson picker — the "Open Lesson" palette: a search box over the
// lessons in scenes/ (Built-in) and scenes/draft/ (Draft), in the style of
// the chat's voice-character picker.
// ============================================================

import { escapeHtml, renderKaTeX } from '/labels.js';

/** One lesson as `GET /api/scenes` lists it under `lessons`. */
export interface LessonSummary {
    /** What /scenes/{id} and ?builtin= take: "eigenvalues", "draft/chart-demo". */
    id: string;
    title: string;
    description: string;
    sceneCount: number;
    stepCount: number;
    domains: string[];
    draft: boolean;
    /** Every scene's title, for search only. */
    sceneTitles?: string[];
    /** Every scene's full description, for search only. */
    searchText?: string;
    /** Glossary keys, terms and aliases — the lesson's own and its domains'. For search only. */
    glossary?: string[];
}

export interface LessonPickerOptions {
    buttonEl: HTMLElement;
    paletteEl: HTMLElement;
    searchEl: HTMLInputElement;
    listEl: HTMLElement;
    countEl: HTMLElement | null;
    /** The Drafts filter pill: drafts are hidden unless it is on. */
    draftsEl: HTMLElement | null;
    /** Re-reads the lesson list from disk. */
    refreshEl: HTMLElement | null;
    /** Fetch the list again, rebuilding the server's index; resolves once setLessons ran. */
    onRefresh: () => Promise<void>;
    backdropEl: HTMLElement;
    /** The loaded lesson's id, to mark its row. */
    currentId: () => string | null;
    /** Load the chosen lesson. The palette is already closed. */
    onPick: (id: string) => void;
}

const RECENTS_KEY = 'algebenchLessonRecents';
const SHOW_DRAFTS_KEY = 'algebenchLessonShowDrafts';
const MAX_RECENTS = 5;

function readRecents(): string[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch { return []; }
}

function storeRecent(id: string): void {
    try {
        const next = [id, ...readRecents().filter(r => r !== id)].slice(0, MAX_RECENTS);
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch { /* storage blocked: recents are a convenience */ }
}

/** Title and description with the LaTeX and markdown markers taken out, for matching. */
function plain(s: string): string {
    return s.replace(/[$*`_\\{}]/g, ' ').toLowerCase();
}

/**
 * How well a lesson matches the query: every word of the query has to hit
 * something, and a hit in the title counts most. 0 is no match.
 */
export function scoreLesson(lesson: LessonSummary, query: string): number {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return 1;
    const title = plain(lesson.title);
    const titleWords = title.split(/[^a-z0-9π]+/);
    const id = lesson.id.toLowerCase();
    const desc = plain(lesson.description);
    const body = plain(lesson.searchText || '');
    const scenes = (lesson.sceneTitles || []).map(plain);
    const glossary = (lesson.glossary || []).map(plain);
    const domains = lesson.domains.join(' ').toLowerCase();
    const status = lesson.draft ? 'draft' : 'built-in builtin';
    let score = 0;
    for (const w of words) {
        let best = 0;
        if (titleWords.some(t => t.startsWith(w))) best = 30;
        else if (title.includes(w)) best = 20;
        if (scenes.some(t => t.split(/[^a-z0-9π]+/).some(x => x.startsWith(w)))) best = Math.max(best, 16);
        else if (scenes.some(t => t.includes(w))) best = Math.max(best, 11);
        if (id.includes(w)) best = Math.max(best, 12);
        if (glossary.some(t => t.startsWith(w) || t.includes(' ' + w))) best = Math.max(best, 14);
        else if (glossary.some(t => t.includes(w))) best = Math.max(best, 7);
        if (domains.includes(w)) best = Math.max(best, 10);
        if (status.includes(w)) best = Math.max(best, 8);
        if (desc.includes(w)) best = Math.max(best, 5);
        else if (body.includes(w)) best = Math.max(best, 3);
        if (!best) return 0;
        score += best;
    }
    return score;
}

/**
 * The built-in id ("eigenvalues", "draft/chart-demo") a loaded scene's source
 * path names, or null. A built-in picked in the picker is recorded as
 * "/scenes/<id>"; one opened from a ?scene= link as "scenes/<id>.json".
 */
export function builtinIdFromPath(p: unknown): string | null {
    if (typeof p !== 'string') return null;
    const m = /^\/?scenes\/(.+?)(?:\.json)?$/.exec(p);
    return m ? m[1]! : null;
}

interface Group { title: string; lessons: LessonSummary[] }

/** Row ids for aria-activedescendant; unique across renders. */
let optionSeq = 0;

export class LessonPicker {
    private opts: LessonPickerOptions;
    private lessons: LessonSummary[] = [];
    private loaded = false;
    private loadError: string | null = null;
    private visible: { id: string; el: HTMLElement }[] = [];
    private active = -1;
    private showDrafts = false;

    constructor(opts: LessonPickerOptions) {
        this.opts = opts;
        try { this.showDrafts = localStorage.getItem(SHOW_DRAFTS_KEY) === '1'; } catch { /* default off */ }
        this.syncDraftsPill();
        this.bind();
    }

    private syncDraftsPill(): void {
        const el = this.opts.draftsEl;
        if (!el) return;
        el.setAttribute('aria-pressed', String(this.showDrafts));
        el.classList.toggle('on', this.showDrafts);
        const n = this.lessons.filter(l => l.draft).length;
        el.textContent = n ? `Drafts ${n}` : 'Drafts';
    }

    private setShowDrafts(on: boolean): void {
        this.showDrafts = on;
        try { localStorage.setItem(SHOW_DRAFTS_KEY, on ? '1' : '0'); } catch { /* per-visit only */ }
        this.syncDraftsPill();
        this.render(this.opts.searchEl.value);
    }

    /** The lessons the filter lets through. */
    private pool(): LessonSummary[] {
        return this.showDrafts ? this.lessons : this.lessons.filter(l => !l.draft);
    }

    setLessons(lessons: LessonSummary[]): void {
        this.lessons = lessons;
        this.loaded = true;
        this.loadError = null;
        this.syncDraftsPill();
        if (this.isOpen()) this.render(this.opts.searchEl.value);
    }

    /** The list failed to load: keep the lessons already shown, and say so. */
    setLoadError(message: string): void {
        this.loadError = message;
        if (this.isOpen()) this.render(this.opts.searchEl.value);
    }

    isOpen(): boolean { return !this.opts.paletteEl.hidden; }

    open(): void {
        const { paletteEl, backdropEl, searchEl, buttonEl } = this.opts;
        backdropEl.hidden = false;
        paletteEl.hidden = false;
        buttonEl.setAttribute('aria-expanded', 'true');
        searchEl.value = '';
        this.position();
        this.render('');
        setTimeout(() => searchEl.focus(), 0);
    }

    close(): void {
        const { paletteEl, backdropEl, buttonEl } = this.opts;
        // Focus must not stay in a field that is about to be hidden.
        if (paletteEl.contains(document.activeElement)) buttonEl.focus();
        backdropEl.hidden = true;
        paletteEl.hidden = true;
        buttonEl.setAttribute('aria-expanded', 'false');
    }

    toggle(): void { if (this.isOpen()) this.close(); else this.open(); }

    private pick(id: string): void {
        storeRecent(id);
        this.close();
        this.opts.onPick(id);
    }

    /** Under the button, kept on screen; the palette's own CSS caps its size. */
    private position(): void {
        const { buttonEl, paletteEl } = this.opts;
        const r = buttonEl.getBoundingClientRect();
        const margin = 8;
        const width = paletteEl.offsetWidth;
        const left = Math.min(Math.max(margin, r.right - width), window.innerWidth - width - margin);
        paletteEl.style.left = `${Math.max(margin, left)}px`;
        paletteEl.style.top = `${r.bottom + 6}px`;
        // The space actually left below the button, however little.
        paletteEl.style.maxHeight = `${Math.max(0, window.innerHeight - r.bottom - 6 - margin)}px`;
    }

    private groups(query: string): Group[] {
        const q = query.trim();
        const byTitle = (a: LessonSummary, b: LessonSummary) => a.title.localeCompare(b.title);
        if (q) {
            const hits = this.pool()
                .map(l => ({ l, s: scoreLesson(l, q) }))
                .filter(x => x.s > 0)
                .sort((a, b) => b.s - a.s || Number(a.l.draft) - Number(b.l.draft) || byTitle(a.l, b.l))
                .map(x => x.l);
            return hits.length ? [{ title: 'Results', lessons: hits }] : [];
        }
        const recents = readRecents()
            .map(id => this.pool().find(l => l.id === id))
            .filter((l): l is LessonSummary => !!l);
        return [
            { title: 'Recent', lessons: recents },
            { title: 'Lessons', lessons: this.lessons.filter(l => !l.draft).sort(byTitle) },
            { title: 'Drafts', lessons: this.pool().filter(l => l.draft).sort(byTitle) },
        ].filter(g => g.lessons.length);
    }

    private render(query: string): void {
        const { listEl, countEl } = this.opts;
        listEl.innerHTML = '';
        this.visible = [];
        // The rows are gone: drop the old active one, so an empty result list
        // cannot leave aria-activedescendant pointing at a removed element.
        this.setActive(-1, false);
        const groups = this.groups(query);
        const current = this.opts.currentId();

        const total = this.pool().length;
        if (countEl) {
            const shown = query.trim() ? (groups[0]?.lessons.length ?? 0) : total;
            countEl.textContent = !this.loaded ? '' : query.trim()
                ? `${shown} of ${total}`
                : `${total} lessons`;
        }

        if (this.loadError) {
            const err = document.createElement('div');
            err.className = 'lesson-picker-error';
            err.setAttribute('role', 'alert');
            err.textContent = this.loadError;
            listEl.appendChild(err);
        }

        if (!groups.length) {
            // A failed first load has nothing to list; the error above says why.
            if (this.loadError && !this.loaded) return;
            const empty = document.createElement('div');
            empty.className = 'lesson-picker-empty';
            empty.textContent = !this.loaded ? 'Loading lessons…'
                : !total ? 'No built-in lessons found.'
                : !this.showDrafts && this.lessons.some(l => l.draft && scoreLesson(l, query) > 0)
                    ? 'No lessons match. Turn on Drafts to search drafts too.'
                    : 'No lessons match your search.';
            listEl.appendChild(empty);
            return;
        }

        for (const g of groups) {
            const section = document.createElement('div');
            section.className = 'lesson-picker-group';
            section.setAttribute('role', 'group');
            section.setAttribute('aria-label', g.title);
            const title = document.createElement('div');
            title.className = 'lesson-picker-group-title';
            title.textContent = g.title;
            section.appendChild(title);
            for (const l of g.lessons) {
                const row = this.row(l, l.id === current);
                section.appendChild(row);
                this.visible.push({ id: l.id, el: row });
            }
            listEl.appendChild(section);
        }
        listEl.scrollTop = 0;
        this.setActive(0, false);
    }

    private row(l: LessonSummary, isCurrent: boolean): HTMLElement {
        const row = document.createElement('div');
        row.className = 'lesson-row' + (isCurrent ? ' current' : '') + (l.draft ? ' draft' : '');
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        row.id = `lesson-option-${++optionSeq}`;
        row.dataset.lessonId = l.id;

        const meta = [
            `${l.sceneCount} scene${l.sceneCount === 1 ? '' : 's'}`,
            `${l.stepCount} step${l.stepCount === 1 ? '' : 's'}`,
            ...l.domains,
        ].map(escapeHtml).join(' · ');

        row.innerHTML = `
            <div class="lesson-row-head">
                <div class="lesson-row-title">${renderKaTeX(l.title, false, { glossary: false })}</div>
                ${isCurrent ? '<span class="lesson-pill lesson-pill-current">Open</span>' : ''}
                <span class="lesson-pill ${l.draft ? 'lesson-pill-draft' : 'lesson-pill-builtin'}">${l.draft ? 'Draft' : 'Built-in'}</span>
            </div>
            ${l.description ? `<div class="lesson-row-desc">${renderKaTeX(l.description, false, { glossary: false })}</div>` : ''}
            <div class="lesson-row-meta">${meta}</div>`;
        row.title = l.id;
        return row;
    }

    private setActive(index: number, scroll = true): void {
        if (!this.visible.length) {
            this.active = -1;
            this.opts.searchEl.removeAttribute('aria-activedescendant');
            return;
        }
        this.active = Math.max(0, Math.min(index, this.visible.length - 1));
        this.visible.forEach((v, i) => {
            const on = i === this.active;
            v.el.classList.toggle('active', on);
            v.el.setAttribute('aria-selected', String(on));
        });
        // Focus stays in the search box; this tells assistive tech which row ↑/↓ picked.
        this.opts.searchEl.setAttribute('aria-activedescendant', this.visible[this.active]!.el.id);
        if (scroll) this.visible[this.active]!.el.scrollIntoView({ block: 'nearest' });
    }

    private bind(): void {
        const { buttonEl, backdropEl, searchEl, listEl, draftsEl, refreshEl } = this.opts;
        if (refreshEl) {
            refreshEl.addEventListener('mousedown', (e) => e.preventDefault());
            refreshEl.addEventListener('click', async () => {
                if (refreshEl.classList.contains('busy')) return;
                refreshEl.classList.add('busy');
                refreshEl.setAttribute('aria-busy', 'true');
                try { await this.opts.onRefresh(); }
                finally {
                    refreshEl.classList.remove('busy');
                    refreshEl.setAttribute('aria-busy', 'false');
                }
            });
        }
        if (draftsEl) {
            // Keep focus in the search box, so typing carries on after a toggle.
            draftsEl.addEventListener('mousedown', (e) => e.preventDefault());
            draftsEl.addEventListener('click', () => this.setShowDrafts(!this.showDrafts));
        }
        buttonEl.setAttribute('aria-haspopup', 'dialog');
        const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
        buttonEl.title = `Open a lesson (${isMac ? '⌘O' : 'Ctrl+O'})`;
        buttonEl.setAttribute('aria-keyshortcuts', isMac ? 'Meta+O' : 'Control+O');
        // Cmd/Ctrl+O toggles the picker, in place of the browser's Open File.
        // Caught in the capture phase so it works from any focused field too.
        document.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() !== 'o' || e.shiftKey || e.altKey) return;
            if (!(isMac ? e.metaKey : e.ctrlKey)) return;
            e.preventDefault();
            e.stopPropagation();
            this.toggle();
        }, { capture: true });
        buttonEl.setAttribute('aria-expanded', 'false');
        buttonEl.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
        backdropEl.addEventListener('mousedown', () => this.close());
        searchEl.addEventListener('input', () => this.render(searchEl.value));
        searchEl.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); this.setActive(this.active + 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); this.setActive(this.active - 1); }
            else if (e.key === 'Enter') {
                e.preventDefault();
                const v = this.visible[this.active];
                if (v) this.pick(v.id);
            }
        });
        // Esc closes from any control in the palette (search, ↻, Drafts, From JSON).
        this.opts.paletteEl.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); this.close(); }
        });
        listEl.addEventListener('mousemove', (e) => {
            const row = (e.target as Element).closest<HTMLElement>('.lesson-row');
            const i = row ? this.visible.findIndex(v => v.el === row) : -1;
            if (i >= 0 && i !== this.active) this.setActive(i, false);
        });
        listEl.addEventListener('click', (e) => {
            const row = (e.target as Element).closest<HTMLElement>('.lesson-row');
            if (row?.dataset.lessonId) this.pick(row.dataset.lessonId);
        });
        window.addEventListener('resize', () => { if (this.isOpen()) this.position(); });
    }
}
