/**
 * Type along: under the Doc, the learner types the code running now (the Code panel's running block) and sees,
 * as they type, how each line, each section and the whole block matches it (code-practice-core.ts). Lines they
 * could see in the Code panel score less; "Hide code" hides it there. The coach (✦) reviews the typed code by
 * meaning (the code_practice expert): on Check, and while it is on, on each new line and after a pause.
 */
import { codeView } from '/code-panel.js';
import type { CodeView } from '/code-panel.js';
import { codeSections } from '/code-sections.js';
import type { CodeSection } from '/code-sections.js';
import { scorePractice, focusSection, isNeutral, PEEK_FACTOR, OTHER_DEPTH } from '/code-practice-core.js';
import type { PracticeScore } from '/code-practice-core.js';
import { lineTokens, paintTokens } from '/code-highlight.js';
import type { CodeToken } from '/code-highlight.js';
import { invokeExpert } from '/expert-client.js';
import { createPracticeStore } from '/practice-store.js';
import { state } from '/state.js';
import { renderMarkdown } from '/labels.js';

/** The coach looks again after this long without typing. */
const IDLE_REVIEW_MS = 5000;
const INDENT = '    ';
/** Where attempts were kept before IndexedDB: read to move them, emptied as they go. */
const LEGACY_KEY = 'algebench-code-practice', VIEW_KEY = 'algebench-code-practice-view';

/** One block's practice. `reviewed` is the text the coach last saw, so the next review knows what just changed. */
interface Attempt { text: string; peeked: number[]; reviews: Record<string, number>; celebrated: string[]; reviewed?: string; issues?: {line: number; note: string}[] }
interface Review { score: number; verdict: string; commentary: string; direction: string; reply?: string; reminder?: string; line_notes: {line: number; note: string}[] }

const VERDICTS: Record<string, string> = {correct: 'Correct', close: 'Close', partial: 'Partly there', off_track: 'Off track', empty: 'Nothing yet'};

function loadJson<T>(key: string, fallback: T): T {
    try { return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? fallback; } catch { return fallback; }
}
function saveJson(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: the practice lasts the session */ }
}
/** A short stable hash, so a saved attempt belongs to the code it was typed against. */
function hash(text: string): string {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = (h * 33 ^ text.charCodeAt(i)) >>> 0;
    return h.toString(36);
}

const svg = (d: string, size = 13, width = 2): string =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${width}" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
/** The side sections' fold chevrons (side-sections.ts), and the two headers' icons: a keyboard, the coach's spark. */
const ICON_FOLD = svg('<path d="M6 9l6 6 6-6"/>', 12, 2.2), ICON_UNFOLD = svg('<path d="M6 15l6-6 6 6"/>', 12, 2.2);
const ICON_TYPE = svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h1M10.5 10h1M14.5 10h1M8 14h8"/>');
const ICON_SEEN = '<svg class="cp-eye" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="seen"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_DOC = svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>');
const ICON_CODE = svg('<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>');
const ICON_COACH = svg('<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/>');

function foldButton(): HTMLButtonElement {
    const b = document.createElement('button');b.type = 'button';b.className = 'side-head-btn side-fold-btn';return b;
}
function paintFold(b: HTMLButtonElement, folded: boolean, title: string) {
    b.innerHTML = folded ? ICON_UNFOLD : ICON_FOLD;b.title = title;
    b.setAttribute('aria-label', title);b.setAttribute('aria-expanded', String(!folded));
}

export function setupCodePractice(): void {
    const doc = document.getElementById('tab-doc');
    if (!doc) return;
    const prefs = loadJson<{open?: boolean; coach?: boolean; hints?: boolean; speak?: boolean; height?: number; reportHeight?: number; reportFolded?: boolean; docFolded?: boolean}>(VIEW_KEY, {});
    // Attempts live in IndexedDB (practice-store.ts), one per lesson and block; this session's are cached here.
    const store = createPracticeStore<Attempt>();
    const cache = new Map<string, Attempt>();
    const legacy = loadJson<Record<string, Attempt>>(LEGACY_KEY, {});
    const lessonKey = () => String((state.lessonSpec as {title?: string} | null)?.title ?? '');
    let saveTimer = 0;

    const root = el('section', 'code-practice');root.hidden = true;root.classList.toggle('open', !!prefs.open);
    // Headers as the side panel's sections (Proof, Chat): accent icon, small-caps title, fold chevron; the header folds.
    const head = el('div', 'side-section-head side-section-foldable cp-head');
    const title = el('span', 'side-section-title');title.textContent = 'Type along';
    const toggle = foldButton();
    const target = el('span', 'cp-target');
    const total = el('span', 'cp-total');total.setAttribute('role', 'status');
    const tools = el('div', 'cp-tools');
    const hide = tool('Hide code', 'Hide the code in the Code panel: lines typed without seeing them score in full');
    const coach = tool('✦ Coach', 'The coach reviews your code on each new line and after a 5 s pause');
    const hint = tool('Hint', 'Hints: the coach also says how to begin and what to write next. Off, it only comments on what you typed');
    const check = tool('Check', 'Ask the coach to review what you typed now');
    const reset = tool('Reset', 'Start this block again');
    // Speaker, as on the state player: the coach's commentary is read aloud while it is on.
    const speak = tool('', '');speak.classList.add('cp-speak');
    speak.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
    tools.append(hide, coach, hint, check, speak, reset);
    head.insertAdjacentHTML('beforeend', ICON_TYPE);
    head.append(title, target, total, toggle);
    const bodyEl = el('div', 'cp-body');
    bodyEl.append(tools);
    const chips = el('div', 'cp-sections');
    const editor = el('div', 'cp-editor');
    const gutter = el('div', 'cp-gutter');gutter.setAttribute('aria-hidden', 'true');
    const stack = el('div', 'cp-stack');
    const paint = el('pre', 'cp-paint');paint.setAttribute('aria-hidden', 'true');
    const input = el('textarea', 'cp-input');
    input.spellcheck = false;input.wrap = 'off';input.setAttribute('autocapitalize', 'off');input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-label', 'Type the running code');input.placeholder = 'Type the running code here, from memory if you can. Ask or explain anything in a # comment: the coach answers.';
    stack.append(paint, input);editor.append(gutter, stack);
    const cheer = el('div', 'cp-cheer');cheer.hidden = true;cheer.setAttribute('role', 'status');
    // The review keeps one height, the learner's to drag (its top edge), so a new review never moves the editor.
    const reportGrip = el('div', 'cp-report-grip');reportGrip.setAttribute('role', 'separator');reportGrip.setAttribute('aria-orientation', 'horizontal');
    reportGrip.setAttribute('aria-label', 'Resize the coach\'s review');reportGrip.title = 'Drag to resize the review · double-click to reset';
    // The review's bar: its title folds the review away (its verdict stays on the bar), the rest of it is the grip.
    reportGrip.classList.add('side-section-head', 'side-section-foldable');
    const reportTitle = el('span', 'side-section-title');reportTitle.textContent = 'Coach review';
    const reportToggle = foldButton();
    const reportSummary = el('span', 'cp-report-summary');
    reportGrip.insertAdjacentHTML('beforeend', ICON_COACH);
    reportGrip.append(reportTitle, reportSummary, reportToggle);
    const report = el('div', 'cp-report');report.setAttribute('aria-live', 'polite');
    const MAX_MESSAGES = 30;
    const WELCOME = 'OK, let\'s start coding. I\'ll guide you along the way. You can talk to me in comments: explain your thinking or ask me anything about the code.';
    const EMPTY_REPORT = 'The coach reviews each new line, after a pause, or on Check.';
    const clearReport = () => { reportSummary.textContent = '';reportGrip.classList.remove('fresh', 'perfect');report.replaceChildren(Object.assign(el('div', 'cp-report-empty'), {textContent: EMPTY_REPORT})); };
    clearReport();
    // The editor's own header, as the review's: what it holds and how much of it is typed exactly.
    const codeHead = el('div', 'side-section-head cp-code-head');
    const codeTitle = el('span', 'side-section-title');codeTitle.textContent = 'Your code';
    const codeSummary = el('span', 'cp-code-summary');
    codeHead.insertAdjacentHTML('beforeend', ICON_CODE);
    codeHead.append(codeTitle, codeSummary);
    bodyEl.append(codeHead, chips, editor, cheer, reportGrip, report);
    // The top edge resizes the panel, as the side panel's edge does; double-click returns to the default height.
    const grip = el('div', 'cp-resize');grip.setAttribute('role', 'separator');grip.setAttribute('aria-orientation', 'horizontal');
    grip.setAttribute('aria-label', 'Resize the Type along panel');grip.title = 'Drag to resize · double-click to reset';
    root.append(grip, head, bodyEl);
    doc.append(root);
    const MIN_HEIGHT = 160;
    function setHeight(px: number | null) {
        if (px == null) { root.style.removeProperty('flex');root.style.removeProperty('max-height');return; }
        const max = Math.max(MIN_HEIGHT, doc!.clientHeight - 80);
        const h = Math.round(Math.max(MIN_HEIGHT, Math.min(max, px)));
        root.style.flex = `0 0 ${h}px`;root.style.maxHeight = 'none';
    }
    if (prefs.height) setHeight(prefs.height);
    grip.addEventListener('pointerdown', e => {
        if (!root.classList.contains('open')) return;
        e.preventDefault();grip.setPointerCapture(e.pointerId);grip.classList.add('dragging');
        const startY = e.clientY, startH = root.offsetHeight;
        document.body.style.cursor = 'row-resize';document.body.style.userSelect = 'none';
        const move = (ev: PointerEvent) => setHeight(startH + startY - ev.clientY);
        const up = () => {
            grip.removeEventListener('pointermove', move);grip.classList.remove('dragging');
            document.body.style.cursor = '';document.body.style.userSelect = '';
            prefs.height = root.offsetHeight;savePrefs();
        };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', up, {once: true});
        grip.addEventListener('pointercancel', up, {once: true});
    });
    grip.addEventListener('dblclick', () => { prefs.height = undefined;setHeight(null);savePrefs(); });
    const REPORT_HEIGHT = 140;
    const setReportHeight = (px: number) => {
        // Leave the editor room when the panel is showing (a collapsed panel has no height to measure).
        const max = bodyEl.clientHeight > 0 ? Math.max(48, bodyEl.clientHeight - 120) : px;
        report.style.setProperty('--report-h', `${Math.round(Math.max(48, Math.min(px, max)))}px`);
    };
    setReportHeight(prefs.reportHeight ?? REPORT_HEIGHT);
    // The review's header is its grip too: a drag resizes the review, a click (no drag) folds it.
    let dragged = false;
    reportGrip.addEventListener('pointerdown', e => {
        dragged = false;
        if ((e.target as HTMLElement).closest('button') || reportGrip.classList.contains('folded')) return;
        e.preventDefault();reportGrip.setPointerCapture(e.pointerId);
        const startY = e.clientY, startH = report.offsetHeight;
        const move = (ev: PointerEvent) => {
            if (!dragged && Math.abs(ev.clientY - startY) < 4) return;
            if (!dragged) { dragged = true;reportGrip.classList.add('dragging');document.body.style.cursor = 'row-resize';document.body.style.userSelect = 'none'; }
            setReportHeight(startH + startY - ev.clientY);
        };
        const up = () => {
            reportGrip.removeEventListener('pointermove', move);
            if (!dragged) return;
            reportGrip.classList.remove('dragging');
            document.body.style.cursor = '';document.body.style.userSelect = '';
            prefs.reportHeight = report.offsetHeight;savePrefs();
        };
        reportGrip.addEventListener('pointermove', move);
        reportGrip.addEventListener('pointerup', up, {once: true});
        reportGrip.addEventListener('pointercancel', up, {once: true});
    });
    function foldReport(folded: boolean) {
        report.hidden = folded;reportGrip.classList.toggle('folded', folded);reportGrip.classList.toggle('side-section-folded', folded);
        paintFold(reportToggle, folded, folded ? 'Show the coach\'s review' : 'Fold the coach\'s review down to its header');
    }
    foldReport(!!prefs.reportFolded);
    const flipReport = () => { prefs.reportFolded = !report.hidden;foldReport(prefs.reportFolded);savePrefs();if (!report.hidden) reportGrip.classList.remove('fresh'); };
    reportToggle.addEventListener('click', e => { e.stopPropagation();flipReport(); });
    reportGrip.addEventListener('click', e => { if (!dragged && !(e.target as HTMLElement).closest('button')) flipReport(); });
    // Fold the Doc away to give Type along the whole tab; the Doc's own toolbar gets the switch.
    // The Doc gets the same header: its fold chevron shows only when Type along is there to take the room.
    const docHead = el('div', 'side-section-head doc-head');
    const docTitle = el('span', 'side-section-title');docTitle.textContent = 'Doc';
    const docToggle = foldButton();
    docHead.insertAdjacentHTML('beforeend', ICON_DOC);
    docHead.append(docTitle, docToggle);
    const content = document.getElementById('explanation-content');
    function foldDoc(folded: boolean) {
        doc!.classList.toggle('doc-folded', folded);docHead.classList.toggle('side-section-folded', folded);
        paintFold(docToggle, folded, folded ? 'Show the Doc' : 'Fold the Doc down to its header (Type along gets the room)');
    }
    if (content) { doc.prepend(docHead);foldDoc(!!prefs.docFolded); }
    const flipDoc = () => { if (docToggle.hidden) return;prefs.docFolded = !doc!.classList.contains('doc-folded');foldDoc(prefs.docFolded);savePrefs(); };
    docToggle.addEventListener('click', e => { e.stopPropagation();flipDoc(); });
    docHead.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('button')) flipDoc(); });
    reportGrip.addEventListener('dblclick', e => {
        if ((e.target as HTMLElement).closest('button')) return; prefs.reportHeight = undefined;setReportHeight(REPORT_HEIGHT);savePrefs(); });

    let current: CodeView | null = null, key = '', block = '', sections: CodeSection[] = [];
    let attempt: Attempt = {text: '', peeked: [], reviews: {}, celebrated: []};
    let score: PracticeScore | null = null, tokens: CodeToken[] = [], tokenText = '';
    let notes = new Map<number, string>(), cheerTimer = 0, reviewSeq = 0, lastReviewed = '', idle = 0, highlightTimer = 0;
    coach.setAttribute('aria-pressed', String(!!prefs.coach));
    hint.setAttribute('aria-pressed', String(!!prefs.hints));
    // The coach's controls and its review show only while the coach is on.
    for (const b of [hint, check, speak]) b.classList.add('cp-coach-only');
    const paintCoach = () => root.classList.toggle('coach-off', coach.getAttribute('aria-pressed') !== 'true');
    paintCoach();
    paintSpeak(!!prefs.speak);

    function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
        const node = document.createElement(tag);node.className = cls;return node;
    }
    function tool(text: string, title: string) {
        const b = el('button', 'cp-tool');b.type = 'button';b.textContent = text;b.title = title;return b;
    }
    const coachOn = () => coach.getAttribute('aria-pressed') === 'true';
    const speakOn = () => speak.getAttribute('aria-pressed') === 'true';
    const hintsOn = () => hint.getAttribute('aria-pressed') === 'true';
    const savePrefs = () => saveJson(VIEW_KEY, {open: root.classList.contains('open'), coach: coachOn(), hints: hintsOn(), speak: speakOn(), height: prefs.height, reportHeight: prefs.reportHeight,
        reportFolded: prefs.reportFolded, docFolded: prefs.docFolded});
    function paintSpeak(on: boolean) {
        speak.setAttribute('aria-pressed', String(on));
        speak.title = on ? 'Reading the coach aloud · click to stop' : 'Read the coach\'s commentary aloud';
        speak.setAttribute('aria-label', speak.title);
    }
    /** The review as it is spoken: the commentary and what to do next, without markdown. */
    let spoken = '';
    function speakReview(text: string) {
        // A greeting not yet heard goes first, so the first review doesn't cut it off.
        if (greeting && text) { text = `${greeting} ${text}`;greeting = ''; }
        spoken = text;
        if (speakOn() && text) window.algebenchSpeakText?.(text);
    }
    /**
     * Turning the coach on, it says hello and how to talk to it (once per switch, not on every block). A review
     * that starts at once speaks the greeting first, so it isn't cut off; otherwise it is spoken on its own.
     */
    let greeting = '';
    function welcome() {
        if (!current || !coachOn()) return;
        message('assistant', el('div', 'cp-report-text')).querySelector('.msg-body')!.textContent = WELCOME;
        greeting = WELCOME;
    }
    /** The attempt for a block: this session's, else the stored one, else one kept in localStorage (moved over now). */
    async function loadAttempt(lesson: string, block: string): Promise<Attempt> {
        const full = `${lesson}\u0000${block}`;
        const hit = cache.get(full) ?? await store.get(lesson, block);
        if (hit) return hit;
        const old = legacy[block];
        if (old) {
            await store.put(lesson, block, old);
            delete legacy[block];
            if (Object.keys(legacy).length) saveJson(LEGACY_KEY, legacy);
            else try { localStorage.removeItem(LEGACY_KEY); } catch { /* storage blocked */ }
            return old;
        }
        return {text: '', peeked: [], reviews: {}, celebrated: []};
    }
    function persist() {
        if (!key) return;   // nothing targeted yet
        // Kept now in memory; written a moment after the typing stops, so each keystroke isn't a write.
        const lesson = lessonKey(), block = key, now = attempt;
        cache.set(`${lesson}\u0000${block}`, now);
        clearTimeout(saveTimer);
        pendingSave = () => { pendingSave = null;void store.put(lesson, block, now); };
        saveTimer = window.setTimeout(() => pendingSave?.(), 400);
    }
    // Leaving the page writes what is still waiting for its moment.
    let pendingSave: (() => void) | null = null;
    window.addEventListener('pagehide', () => { clearTimeout(saveTimer);pendingSave?.(); });

    /** Follow the Code panel to the block running now; each block keeps its own attempt. */
    function retarget() {
        const v = codeView();
        // Only where the scene or step runs code: elsewhere there is nothing to type along with.
        root.hidden = !v?.running;
        // Folding the Doc only makes room for Type along: without it, the Doc stays and the switch goes.
        docToggle.hidden = root.hidden;docHead.classList.toggle('side-section-foldable', !root.hidden);
        foldDoc(!!prefs.docFolded && !root.hidden);
        if (!v?.running) { current = null;return; }
        const text = v.file.source.split('\n').slice(v.from - 1, v.to).join('\n').replace(/\s+$/, '');
        const next = `${v.file.id}:${v.from}:${hash(text)}`;
        current = v;
        if (next === key) return;
        key = next;block = text;
        sections = codeSections(v.file).filter(s => s.from >= v.from && s.to <= v.to);
        const count = v.to - v.from + 1;
        target.textContent = `${v.file.path.split('/').pop()} · lines ${v.from}–${v.to}`;
        target.title = `${count} lines${sections.length ? `, ${sections.length} sections` : ''}`;
        // Empty until the stored attempt arrives; a move to another block meanwhile leaves it unused.
        attempt = {text: '', peeked: [], reviews: {}, celebrated: []};input.value = '';input.disabled = true;
        notes = new Map();clearReport();cheer.hidden = true;score = null;render(false);
        const wanted = key;
        void loadAttempt(lessonKey(), wanted).then(found => {
            if (key !== wanted) return;
            attempt = found;input.disabled = false;
            input.value = attempt.text;score = null;   // another block: nothing to compare with
            lastReviewed = attempt.reviewed != null ? reviewKey(attempt.reviewed) : '';
            render(false);
            highlight();
            if (hintsOn() && !input.value.trim() && root.classList.contains('open')) void review(false);
        });
    }

    function render(celebrate = true) {
        if (!current) return;
        const before = score;
        score = scorePractice(block, current.from, input.value, new Set(attempt.peeked), sections);
        // A seen line the learner deletes is theirs to type again: if they retype it with the code hidden, it
        // scores in full (seen again meanwhile, it is marked again). Seen before it was ever typed, it stays seen.
        if (before && attempt.peeked.length) {
            const was = new Set(before.lines.filter(l => l.similarity === 1).map(l => l.line));
            // Taken apart means removed (no typed line pairs with it any more), not edited: adding a comment, or a
            // keystroke on the way to the same text, leaves the line seen.
            const undone = new Set(score.lines.filter(l => l.typed == null && was.has(l.line)).map(l => l.line));
            if (undone.size) {
                attempt.peeked = attempt.peeked.filter(line => !undone.has(line));persist();
                score = scorePractice(block, current.from, input.value, new Set(attempt.peeked), sections);
            }
        }
        const cursor = input.value.slice(0, input.selectionStart).split('\n').length - 1;
        const focus = focusSection(score, cursor, sections);
        const scoreOfTyped = new Map(score.lines.filter(l => l.typed != null).map(l => [l.typed!, l]));
        const typedLines = input.value.split('\n');
        // Left of the line numbers, the section each line belongs to, in the Code panel's colour for it.
        const bands = sectionBands(typedLines.length);
        gutter.replaceChildren(...typedLines.map((text, j) => {
            const row = el('div', 'cp-mark'), t = score!.typed[j]!, line = scoreOfTyped.get(j);
            if (bands[j]) { row.classList.add('cp-in-section');row.style.setProperty('--section-tone', bands[j]!); }
            const n = el('span', 'cp-n');n.textContent = String(j + 1);
            const mark = el('span', 'cp-status');
            if (t.neutral) row.classList.add('neutral');
            else if (t.exact) { row.classList.add(line?.peeked ? 'seen' : 'exact');mark.textContent = '✓'; }
            else if (line) { row.classList.add('fuzzy');mark.textContent = `${line.score}`; }
            else if (text.trim()) { row.classList.add('miss');mark.textContent = '✗'; }
            // Seen in the Code panel before it was typed: a small eye after the mark (the line counts half).
            if (line?.peeked) { mark.insertAdjacentHTML('beforeend', ICON_SEEN);row.classList.add('peeked'); }
            row.title = t.neutral ? '' : line
                ? `Matches line ${line.line}: ${line.score}%${line.peeked ? ' (seen in the Code panel, so at most half)' : ''}`
                : 'No line of the code is like this one';
            const note = notes.get(j + 1);
            if (note) { row.classList.add('noted');row.title += `\nCoach: ${note}`; }
            row.append(n, mark);return row;
        }));
        paintLines(typedLines);
        chips.replaceChildren(...score.sections.map(s => {
            const chip = el('span', 'cp-chip');
            chip.classList.toggle('focus', s.id === focus?.id);chip.classList.toggle('done', s.score === 100);
            chip.style.setProperty('--fill', `${s.score}%`);
            const tone = current?.tone(s.id);if (tone) chip.style.setProperty('--tone', tone);
            chip.textContent = `${s.score === 100 ? '★ ' : ''}${s.title} · ${s.score}%`;
            chip.title = `${s.title}: lines ${s.from}–${s.to}`;
            return chip;
        }));
        chips.hidden = !score.sections.length;
        const exact = score.lines.filter(l => l.similarity === 1).length;
        // The score is the match from memory: a line seen in the Code panel counts half, so say how many were.
        const seen = score.lines.filter(l => l.peeked).length;
        codeSummary.textContent = `${exact} of ${score.lines.length} lines exact${seen ? ` · ${seen} seen (half marks)` : ''}`;
        codeSummary.title = seen ? 'Lines visible in the Code panel while you practised (marked with an eye) score half. Hide code and type them from memory for full marks.' : '';
        total.textContent = `${score.total}%`;
        total.style.setProperty('--fill', `${score.total * 3.6}deg`);
        total.classList.toggle('done', score.total === 100);
        total.removeAttribute('title');total.setAttribute('aria-label', `Typed from memory: ${score.total}%`);
        if (!scoreTip.hidden) explainScore();
        if (celebrate && before) cheerFor(before, score);
    }

    /** Typed text coloured like the Code panel, by the same server lexer; plain until its colours arrive. */
    /**
     * Each typed line's section tone: a line paired with a reference line takes its section's; a line between two
     * paired lines of the same section (a blank, a line not matched yet) is part of it too.
     */
    function sectionBands(count: number): (string | undefined)[] {
        const own = Array.from({length: count}, (_, j) => {
            const ref = score?.typed[j]?.reference;
            return ref == null ? undefined : sections.find(s => ref >= s.from && ref <= s.to)?.id;
        });
        const out: (string | undefined)[] = [];
        let before: string | undefined;
        for (let j = 0; j < count; j++) {
            if (own[j]) { before = own[j];out.push(current?.tone(own[j]!));continue; }
            const after = own.slice(j + 1).find(Boolean);
            out.push(before && before === after ? current?.tone(before) : undefined);
        }
        return out;
    }
    function paintLines(lines: string[]) {
        const fresh = tokenText === input.value;
        paint.replaceChildren(...lines.map((text, j) => {
            const row = el('div', 'cp-line');
            const t = score?.typed[j];
            if (t && !t.neutral) row.classList.add(t.exact ? 'exact' : t.reference != null ? 'fuzzy' : text.trim() ? 'miss' : '');
            row.textContent = text || ' ';
            if (fresh && text) paintTokens(row, lineTokens(tokens, j + 1));
            return row;
        }));
        // Room for the caret past the last character.
        paint.append(el('div', 'cp-line'));
    }
    function highlight() {
        clearTimeout(highlightTimer);
        const language = current?.file.language?.trim().toLowerCase(), text = input.value;
        if (!language || !text.trim()) return;
        highlightTimer = window.setTimeout(() => {
            fetch('/api/code/highlight', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({language, source: text})})
                .then(res => res.ok ? res.json() : null)
                .then((body: {tokens?: CodeToken[]} | null) => {
                    if (input.value !== text || !Array.isArray(body?.tokens)) return;
                    tokens = body!.tokens;tokenText = text;paintLines(text.split('\n'));
                })
                .catch(() => { /* offline: the code stays plain */ });
        }, 250);
    }

    /** How the ring's score was reached, shown while it is pointed at or focused: the rules, then this block's counts. */
    const scoreTip = el('div', 'cp-score-tip');scoreTip.hidden = true;scoreTip.setAttribute('role', 'tooltip');scoreTip.id = 'cp-score-tip';
    document.body.append(scoreTip);
    total.tabIndex = 0;total.setAttribute('aria-describedby', scoreTip.id);
    function explainScore() {
        if (!score) return;
        const lines = score.lines, n = lines.length;
        const exact = lines.filter(l => l.similarity === 1).length, typed = lines.filter(l => l.typed != null).length;
        const seen = lines.filter(l => l.peeked).length;
        const row = (label: string, value: string) => { const r = el('div', 'cp-tip-row');const a = el('span', '');a.textContent = label;const b = el('b', '');b.textContent = value;r.append(a, b);return r; };
        const p = (text: string) => Object.assign(el('p', ''), {textContent: text});
        const head = el('div', 'cp-tip-head');head.textContent = `Typed from memory: ${score.total}%`;
        const rules = el('ul', 'cp-tip-rules');
        for (const t of ['✓ exact line: 100 (spaces and trailing comments don\'t count)',
            'close line: by how few edits it is away, up to 95',
            `right code at the wrong nesting depth: ×${OTHER_DEPTH}`,
            `👁 line seen in the Code panel before you typed it: ×${PEEK_FACTOR}`,
            'line not typed yet: 0']) rules.append(Object.assign(el('li', ''), {textContent: t}));
        const now = el('div', 'cp-tip-now');
        now.append(row('Lines to type', String(n)), row('Exact', String(exact)), row('Close', String(typed - exact)), row('Not typed yet', String(n - typed)), row('Seen (count half)', String(seen)));
        const parts: HTMLElement[] = [head, p('The score is the average over the running block\'s lines (blank and comment lines aside):'), rules, now];
        if (score.sections.length) {
            const secs = el('div', 'cp-tip-now');
            for (const x of score.sections) secs.append(row(x.title, `${x.score}%`));
            parts.push(p('By section:'), secs);
        }
        if (seen) parts.push(p('Hide code, then retype a seen line (or Reset) to earn it in full.'));
        scoreTip.replaceChildren(...parts);
    }
    function showScoreTip() {
        explainScore();scoreTip.hidden = false;
        const at = total.getBoundingClientRect(), tip = scoreTip.getBoundingClientRect();
        scoreTip.style.left = `${Math.max(8, Math.min(at.right - tip.width, window.innerWidth - 8 - tip.width))}px`;
        scoreTip.style.top = `${at.bottom + 6 + tip.height > window.innerHeight ? at.top - 6 - tip.height : at.bottom + 6}px`;
    }
    const hideScoreTip = () => { scoreTip.hidden = true; };
    total.addEventListener('pointerenter', showScoreTip);total.addEventListener('pointerleave', hideScoreTip);
    total.addEventListener('focus', showScoreTip);total.addEventListener('blur', hideScoreTip);
    total.addEventListener('click', e => e.stopPropagation());   // pointing at the ring isn't a click on the header

    /** Lines just typed exactly flash; a section or the block reaching 100% is congratulated, once. */
    function cheerFor(before: PracticeScore, after: PracticeScore) {
        after.typed.forEach((t, j) => {
            if (t.exact && !before.typed[j]?.exact) gutter.children[j]?.classList.add('cp-flash');
        });
        const was = new Map(before.sections.map(s => [s.id, s.score]));
        const say = (id: string, text: string, big = false) => {
            if (attempt.celebrated.includes(id)) return;
            attempt.celebrated.push(id);persist();
            cheer.textContent = text;cheer.classList.toggle('big', big);cheer.hidden = false;
            cheer.classList.remove('pop', 'fading');void cheer.offsetWidth;cheer.classList.add('pop');
            // A section's cheer fades; the whole block's stays until the block changes.
            clearTimeout(cheerTimer);
            if (!big) cheerTimer = window.setTimeout(() => { cheer.classList.add('fading');cheerTimer = window.setTimeout(() => { cheer.hidden = true; }, 600); }, 4000);
        };
        for (const s of after.sections) if (s.score === 100 && was.get(s.id) !== 100) say(`section:${s.id}`, `🎉 “${s.title}” — 100%, from memory!`);
        if (after.total === 100 && before.total !== 100) say('block', '🏆 The whole block, typed from memory: 100%! Brilliant.', true);
        else if (after.typedAll && !before.typedAll && after.total < 100) say('typed', '✓ Every line typed. Hide the code and type it from memory for full marks.');
    }

    /** Lines on screen in the Code panel count as seen, except those already typed exactly before. */
    function watchPeeks() {
        if (!current || !root.classList.contains('open')) return;
        hide.setAttribute('aria-pressed', String(current.hidden()));
        const seen = new Set(attempt.peeked), done = new Set(score?.lines.filter(l => l.similarity === 1).map(l => l.line));
        const reference = block.split('\n');
        let added = false;
        for (const line of current.shown()) {
            if (line < current.from || line > current.to || seen.has(line) || done.has(line) || isNeutral(reference[line - current.from] ?? '')) continue;
            attempt.peeked.push(line);added = true;
        }
        if (added) { persist();render(false); }
    }
    window.setInterval(watchPeeks, 500);

    /** Only a change to the code itself calls for a review: not Enter's new indented line, nor a move of the cursor. */
    const reviewKey = (text: string) => `${hintsOn()}\n${text.split('\n').map(l => l.trimEnd()).join('\n').trimEnd()}`;
    async function review(force: boolean) {
        // With hints, an empty editor is a beginning: the coach says how to start.
        if (!coachOn() || !current || !score || (!input.value.trim() && !hintsOn())) return;
        const cursor = input.value.slice(0, input.selectionStart).split('\n').length - 1;
        const focus = focusSection(score, cursor, sections);
        const signature = reviewKey(input.value);
        if (!force && signature === lastReviewed) return;
        lastReviewed = signature;
        const id = focus?.id ?? '*', seq = ++reviewSeq, sent = input.value;
        // As in the chat: the learner's new comments are their message, the coach's review the reply.
        const asked = newComments(attempt.reviewed ?? '', sent);
        if (asked.length) message('user', Object.assign(el('div', ''), {textContent: asked.join('\n')}));
        const waiting = message('assistant', el('div', 'chat-loading'));
        waiting.querySelector('.chat-loading')!.innerHTML = '<span></span><span></span><span></span>';
        reportSummary.textContent = 'reviewing…';
        try {
            const out = await invokeExpert('code_practice', {
                language: current.file.language ?? '', expected: block, first_line: current.from,
                section: focus ? {title: focus.title, hint: focus.hint ?? '', start: focus.from, end: focus.to} : null,
                typed: input.value, ...(attempt.reviewed != null ? {previous: attempt.reviewed, open_notes: (attempt.issues ?? []).slice(0, 40)} : {}),
                match: score.typed.map((t, j) => ({typed: j + 1, score: Math.round(100 * t.similarity), ...(t.reference != null ? {reference: t.reference} : {})}))
                    .filter((_, j) => !score!.typed[j]!.neutral).slice(0, 400),
                attempts: attempt.reviews[id] ?? 0, hints: hintsOn(),
            }) as {result?: Review; reason?: string};
            waiting.remove();
            if (seq !== reviewSeq) return;
            attempt.reviews[id] = (attempt.reviews[id] ?? 0) + 1;
            // What was open before, so a carried issue is hinted at rather than spelled out again.
            const before = new Set((attempt.issues ?? []).map(n => n.note));
            if (out.result) { attempt.reviewed = sent;attempt.issues = out.result.line_notes; }
            persist();
            showReview(out, focus, before);
        } catch (e) {
            waiting.remove();
            if (seq !== reviewSeq) return;
            showReview({reason: (e as Error).message}, focus);
        }
    }
    /** Comments in `typed` that weren't in `before`: what the learner just said to the coach. */
    function newComments(before: string, typed: string): string[] {
        const said = (text: string) => text.split('\n').map(l => /(?:^|\s)(?:#|\/\/)\s?(.*)$/.exec(l)?.[1]?.trim() ?? '').filter(Boolean);
        const old = new Set(said(before));
        return said(typed).filter(c => !old.has(c));
    }
    /** One message in the review thread, styled as the chat's; the thread keeps the last MAX_MESSAGES. */
    function message(role: 'user' | 'assistant', body: HTMLElement): HTMLElement {
        const msg = el('div', `chat-msg ${role} cp-msg`);
        const avatar = el('div', 'msg-avatar');
        const icon = role === 'user' ? window.algebenchIcons?.user : window.algebenchIcons?.ai;
        if (icon) avatar.innerHTML = icon;else avatar.textContent = role === 'user' ? '👤' : '🤖';
        body.classList.add('msg-body');
        msg.append(avatar, body);
        report.querySelector('.cp-report-empty')?.remove();
        report.append(msg);
        while (report.children.length > MAX_MESSAGES) report.firstElementChild!.remove();
        report.scrollTop = report.scrollHeight;
        return msg;
    }
    function showReview(out: {result?: Review; reason?: string}, focus: CodeSection | null, carried = new Set<string>()) {
        const r = out.result;
        if (!r) {
            spoken = '';reportSummary.textContent = '';reportGrip.classList.remove('perfect');notes = new Map();
            message('assistant', Object.assign(el('div', 'cp-report-reason'), {textContent: out.reason ?? 'No review.'}));
            render(false);return;
        }
        notes = new Map(r.line_notes.map(n => [n.line, n.note]));
        const body = el('div', '');
        const top = el('div', 'cp-report-head');
        const badge = el('span', `cp-verdict cp-verdict-${r.verdict}`);badge.textContent = `${VERDICTS[r.verdict] ?? r.verdict} · ${r.score}%`;
        badge.title = 'The coach\'s judgement of this section\'s logic. The ring above scores typing it from memory.';
        // Folded, the bar still says what the coach thinks, and marks the review as new until it is opened.
        reportSummary.textContent = badge.textContent;reportGrip.classList.toggle('fresh', report.hidden === true);
        // A fully correct review is marked green: the badge, the message and the bar's summary.
        const perfect = r.verdict === 'correct' && r.score === 100;
        reportGrip.classList.toggle('perfect', perfect);
        const about = el('span', 'cp-report-about');about.textContent = focus ? focus.title : 'The whole block';
        top.append(badge, about);
        body.append(top);
        const md = (cls: string, text: string) => { const part = el('div', cls);part.innerHTML = renderMarkdown(text, {untrusted: true, glossary: false});body.append(part); };
        // The answer to the learner's own comments comes first: they asked.
        if (r.reply) md('cp-report-reply', r.reply);
        if (r.commentary) md('cp-report-text', r.commentary);
        // An issue still open from before stays marked on its line; the review only nudges back to it.
        if (r.reminder) md('cp-report-reminder', r.reminder);
        const fresh = r.line_notes.filter(n => !carried.has(n.note));
        if (fresh.length) {
            const list = el('ul', 'cp-report-notes');
            for (const n of fresh) { const li = el('li', '');li.textContent = `Line ${n.line}: ${n.note}`;list.append(li); }
            body.append(list);
        }
        if (r.direction) md('cp-report-next', `**Next:** ${r.direction}`);
        message('assistant', body).classList.toggle('cp-msg-perfect', perfect);
        render(false);
        // Read as shown: the answer, the comment, the reminder, each new line issue, then what to do next.
        speakReview([r.reply, r.commentary, r.reminder, ...fresh.map(n => `Line ${n.line}: ${n.note}`), r.direction && `Next: ${r.direction}`]
            .filter(Boolean).join(' ').replace(/[`*]/g, ''));
    }

    function insert(text: string) {
        // execCommand keeps the browser's undo history; setRangeText is the fallback.
        if (!document.execCommand('insertText', false, text)) { input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');input.dispatchEvent(new Event('input')); }
    }
    input.addEventListener('keydown', e => {
        if (e.key === 'Tab') {
            e.preventDefault();
            if (!e.shiftKey) { insert(INDENT);return; }
            const start = input.value.lastIndexOf('\n', input.selectionStart - 1) + 1;
            const lead = /^ {1,4}/.exec(input.value.slice(start))?.[0].length ?? 0;
            if (lead) { input.setSelectionRange(start, start + lead);insert(''); }
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();void review(true);
        } else if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            const start = input.value.lastIndexOf('\n', input.selectionStart - 1) + 1;
            const line = input.value.slice(start, input.selectionStart);
            const indent = /^\s*/.exec(line)![0] + (/[:{[(]\s*$/.test(line) ? INDENT : '');
            insert('\n' + indent);
            if (coachOn()) void review(false);
        }
    });
    input.addEventListener('input', () => {
        attempt.text = input.value;persist();
        render();highlight();
        clearTimeout(idle);
        if (coachOn()) idle = window.setTimeout(() => void review(false), IDLE_REVIEW_MS);
    });
    input.addEventListener('keyup', e => { if (e.key.startsWith('Arrow')) render(false); });
    input.addEventListener('click', () => render(false));
    const paintOpen = () => {
        const open = root.classList.contains('open');
        head.classList.toggle('side-section-folded', !open);
        paintFold(toggle, !open, open ? 'Fold Type along down to its header' : 'Show Type along');
    };
    const flipOpen = () => {
        root.classList.toggle('open');paintOpen();savePrefs();
        if (root.classList.contains('open') && hintsOn() && !input.value.trim()) void review(false);
    };
    toggle.addEventListener('click', e => { e.stopPropagation();flipOpen(); });
    head.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('button')) flipOpen(); });
    paintOpen();
    hide.addEventListener('click', () => { if (!current) return;current.setHidden(!current.hidden());hide.setAttribute('aria-pressed', String(current.hidden())); });
    coach.addEventListener('click', () => {
        coach.setAttribute('aria-pressed', String(!coachOn()));savePrefs();paintCoach();
        if (coachOn()) {
            const seq = reviewSeq;
            welcome();void review(false);
            if (reviewSeq === seq && greeting) { const hello = greeting;greeting = '';speakReview(hello); }
        }
        else if (speakOn() && window.algebenchTTSActive?.()) window.algebenchStopTTS?.();
    });
    check.addEventListener('click', () => void review(true));
    hint.addEventListener('click', () => {
        hint.setAttribute('aria-pressed', String(!hintsOn()));savePrefs();
        // On: a hint for where the learner is now, a start if nothing is typed yet.
        if (hintsOn()) void review(false);
    });
    speak.addEventListener('click', () => {
        paintSpeak(!speakOn());savePrefs();
        // On: read the review already shown. Off: stop, if speech is playing.
        if (speakOn()) { if (spoken) speakReview(spoken); }
        else if (window.algebenchTTSActive?.()) window.algebenchStopTTS?.();
    });
    reset.addEventListener('click', () => {
        attempt = {text: '', peeked: [], reviews: {}, celebrated: []};input.value = '';notes = new Map();
        clearReport();cheer.hidden = true;lastReviewed = '';persist();render(false);input.focus();
        if (hintsOn()) void review(false);
    });
    window.addEventListener('algebench:codeview', retarget);
    window.addEventListener('algebench:navchange', retarget);
    retarget();
}
