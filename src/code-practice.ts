/**
 * Type along: under the Doc, the learner types the code running now (the Code panel's running block) and sees,
 * as they type, how each line, each section and the whole block matches it (code-practice-core.ts). Lines they
 * could see in the Code panel score less; "Hide code" hides it there. The coach (✦) reviews the typed code by
 * meaning (the code_practice expert): on Check, and while it is on, on each new line and after a pause.
 */
import { state } from '/state.js';
import { codeView, HIDE_CODE_ICON } from '/code-panel.js';
import type { CodeView } from '/code-panel.js';
import { codeSections } from '/code-sections.js';
import type { CodeSection } from '/code-sections.js';
import { scorePractice, focusSection, isNeutral, PEEK_FACTOR, ASSIST_FACTOR, OTHER_DEPTH } from '/code-practice-core.js';
import type { PracticeScore } from '/code-practice-core.js';
import { lineTokens, paintTokens } from '/code-highlight.js';
import type { CodeToken } from '/code-highlight.js';
import { invokeExpert } from '/expert-client.js';
import { createPracticeStore } from '/practice-store.js';
import { lessonId, formerLessonKeys } from '/lesson-id.js';
import { renderMarkdown } from '/labels.js';
import { editsBetween, keystrokes, backspaces, keyDelay, findSelection } from '/code-assist-play.js';

/** The coach looks again after this long without typing. */
const IDLE_REVIEW_MS = 5000;
const INDENT = '    ';
/** Where attempts were kept before IndexedDB: read to move them, emptied as they go. */
const LEGACY_KEY = 'algebench-code-practice', VIEW_KEY = 'algebench-code-practice-view';

/** One block's practice. `reviewed` is the text the coach last saw, so the next review knows what just changed;
 *  `assisted`, the reference lines the AI assistant typed (Help me). */
interface Attempt { text: string; peeked: number[]; assisted?: number[]; reviews: Record<string, number>; celebrated: string[]; reviewed?: string; issues?: {line: number; note: string}[] }
/** Help me's reply: how it will go about it, its moves at the keyboard (each the whole editor after it), and its hand-back. */
interface AssistPlan { plan: string; steps: {say: string; code: string; explain: string; draft?: string; notice?: string; select?: string; select_line?: number}[]; closing: string }
type AssistScope = 'next' | 'section' | 'all' | 'fix' | 'narrate' | 'ask';
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
/** A line the AI assistant typed (Help me): its spark, where a seen line has the eye. */
const ICON_AI = '<svg class="cp-ai-mark" viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-label="typed by the AI"><path d="M12 2l2.4 7.1L22 12l-7.6 2.9L12 22l-2.4-7.1L2 12l7.6-2.9z"/></svg>';
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
    hide.insertAdjacentHTML('afterbegin', HIDE_CODE_ICON);
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
     * Turning the coach on with nothing typed yet, it says hello and how to talk to it (once per switch, not on
     * every block); with code already in the editor the learner is under way, so it goes straight to the review. A review
     * that starts at once speaks the greeting first, so it isn't cut off; otherwise it is spoken on its own.
     */
    let greeting = '';
    function welcome() {
        if (!current || !coachOn() || input.value.trim()) return;
        const msg = message('assistant', el('div', 'cp-report-text'));msg.querySelector('.msg-body')!.textContent = WELCOME;
        offerHelp(msg);
        greeting = WELCOME;
    }
    /**
     * The attempt for a block: this session's, else the stored one, else one stored under a former key of the lesson
     * (formerLessonKeys), else one kept in localStorage; an older one moves to the new key now.
     */
    async function loadAttempt(lesson: string, file: string, block: string): Promise<Attempt> {
        const hit = cache.get([lesson, file, block].join('\u0000')) ?? await store.get(lesson, file, block);
        if (hit) return hit;
        // Keys before lesson ids and file paths: the title with the block alone, or an earlier id with this file.
        for (const former of formerLessonKeys()) {
            const moved = await store.take(`${former}\u0000${block}`) ?? await store.take([former, file, block].join('\u0000'));
            if (moved) { await store.put(lesson, file, block, moved);return moved; }
        }
        const old = legacy[block];
        if (old) {
            await store.put(lesson, file, block, old);
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
        const lesson = lessonId(), file = current?.file.path ?? '', block = key, now = attempt;
        cache.set([lesson, file, block].join('\u0000'), now);
        clearTimeout(saveTimer);
        pendingSave = () => { pendingSave = null;void store.put(lesson, file, block, now); };
        saveTimer = window.setTimeout(() => pendingSave?.(), 400);
    }
    // Leaving the page writes what is still waiting for its moment.
    let pendingSave: (() => void) | null = null;
    window.addEventListener('pagehide', () => { clearTimeout(saveTimer);pendingSave?.(); });

    /** Leaving a block (a scene or step switch): the coach's word on it is over, spoken or still coming. */
    function hushCoach() {
        stopAssist();
        reviewSeq++;greeting = '';
        if (spoken && window.algebenchTTSActive?.()) window.algebenchStopTTS?.();
        spoken = '';
    }
    let shownScene = -1;
    /** Follow the Code panel to the block running now; each block keeps its own attempt. */
    function retarget() {
        const v = codeView();
        // Only where the scene or step runs code: elsewhere there is nothing to type along with.
        root.hidden = !v?.running;
        // Folding the Doc only makes room for Type along: without it, the Doc stays and the switch goes.
        docToggle.hidden = root.hidden;docHead.classList.toggle('side-section-foldable', !root.hidden);
        foldDoc(!!prefs.docFolded && !root.hidden);
        // Another scene ends the coach's word; the view between steps can briefly run nothing, which must not.
        const scene = state.currentSceneIndex, left = scene !== shownScene;shownScene = scene;
        if (!v?.running) { if (current && left) hushCoach();current = null;return; }
        const text = v.file.source.split('\n').slice(v.from - 1, v.to).join('\n').replace(/\s+$/, '');
        const next = `${v.file.id}:${v.from}:${hash(text)}`;
        current = v;
        if (next === key) return;
        if (key) hushCoach();
        key = next;block = text;
        sections = codeSections(v.file).filter(s => s.from >= v.from && s.to <= v.to);
        const count = v.to - v.from + 1;
        target.textContent = `${v.file.path.split('/').pop()} · lines ${v.from}–${v.to}`;
        target.title = `${count} lines${sections.length ? `, ${sections.length} sections` : ''}`;
        // Empty until the stored attempt arrives; a move to another block meanwhile leaves it unused.
        attempt = {text: '', peeked: [], reviews: {}, celebrated: []};input.value = '';input.disabled = true;
        notes = new Map();clearReport();cheer.hidden = true;score = null;render(false);
        const wanted = key;
        void loadAttempt(lessonId(), v.file.path, wanted).then(found => {
            if (key !== wanted) return;
            attempt = found;input.disabled = false;
            input.value = attempt.text;score = null;   // another block: nothing to compare with
            lastReviewed = attempt.reviewed != null ? reviewKey(attempt.reviewed) : '';
            render(false);
            highlight();
            // An empty block is a beginning, each time it is reached: the coach says how to start, even if it said so
            // on an earlier visit (that start was stored as reviewed, and would be skipped as nothing new).
            if (hintsOn() && !input.value.trim() && root.classList.contains('open')) void review(true);
        });
    }

    function render(celebrate = true) {
        if (!current) return;
        const before = score;
        score = scorePractice(block, current.from, input.value, new Set(attempt.peeked), sections, new Set(attempt.assisted));
        // A seen line the learner deletes is theirs to type again: if they retype it with the code hidden, it
        // scores in full (seen again meanwhile, it is marked again). Seen before it was ever typed, it stays seen.
        // A line the AI assistant typed is the same: deleted, it is the learner's to type.
        if (before && (attempt.peeked.length || attempt.assisted?.length)) {
            const was = new Set(before.lines.filter(l => l.similarity === 1).map(l => l.line));
            // Taken apart means removed (no typed line pairs with it any more), not edited: adding a comment, or a
            // keystroke on the way to the same text, leaves the line seen.
            const undone = new Set(score.lines.filter(l => l.typed == null && was.has(l.line)).map(l => l.line));
            if (undone.size) {
                attempt.peeked = attempt.peeked.filter(line => !undone.has(line));
                if (attempt.assisted) attempt.assisted = attempt.assisted.filter(line => !undone.has(line));
                persist();
                score = scorePractice(block, current.from, input.value, new Set(attempt.peeked), sections, new Set(attempt.assisted));
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
            else if (t.exact) { row.classList.add(line?.assisted ? 'assisted' : line?.peeked ? 'seen' : 'exact');mark.textContent = '✓'; }
            else if (line) { row.classList.add('fuzzy');mark.textContent = `${line.score}`; }
            else if (text.trim()) { row.classList.add('miss');mark.textContent = '✗'; }
            // Seen in the Code panel before it was typed: a small eye after the mark (the line counts half).
            if (line?.peeked) { mark.insertAdjacentHTML('beforeend', ICON_SEEN);row.classList.add('peeked'); }
            // Typed by the AI assistant: its spark instead (the line counts a tenth).
            if (line?.assisted) { mark.insertAdjacentHTML('beforeend', ICON_AI);row.classList.add('ai-typed'); }
            row.title = t.neutral ? '' : line
                ? `Matches line ${line.line}: ${line.score}%${line.assisted ? ` (typed by the AI assistant, so at most ${100 * ASSIST_FACTOR}%)`
                    : line.peeked ? ' (seen in the Code panel, so at most half)' : ''}`
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
        const seen = score.lines.filter(l => l.peeked).length, helped = score.lines.filter(l => l.assisted).length;
        codeSummary.textContent = `${exact} of ${score.lines.length} lines exact${seen ? ` · ${seen} seen (half marks)` : ''}${helped ? ` · ${helped} AI-typed (${100 * ASSIST_FACTOR}%)` : ''}`;
        codeSummary.title = [seen ? 'Lines visible in the Code panel while you practised (marked with an eye) score half.' : '',
            helped ? `Lines the AI assistant typed (marked with a spark) score ${100 * ASSIST_FACTOR}%.` : '',
            seen || helped ? 'Hide code and type them from memory for full marks.' : ''].filter(Boolean).join(' ');
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
        const seen = lines.filter(l => l.peeked).length, helped = lines.filter(l => l.assisted).length;
        const row = (label: string, value: string) => { const r = el('div', 'cp-tip-row');const a = el('span', '');a.textContent = label;const b = el('b', '');b.textContent = value;r.append(a, b);return r; };
        const p = (text: string) => Object.assign(el('p', ''), {textContent: text});
        const head = el('div', 'cp-tip-head');head.textContent = `Typed from memory: ${score.total}%`;
        const rules = el('ul', 'cp-tip-rules');
        for (const t of ['✓ exact line: 100 (spaces and trailing comments don\'t count)',
            'close line: by how few edits it is away, up to 95',
            `right code at the wrong nesting depth: ×${OTHER_DEPTH}`,
            `👁 line seen in the Code panel before you typed it: ×${PEEK_FACTOR}`,
            `✦ line the AI assistant typed (Help me): ×${ASSIST_FACTOR}`,
            'line not typed yet: 0']) rules.append(Object.assign(el('li', ''), {textContent: t}));
        const now = el('div', 'cp-tip-now');
        now.append(row('Lines to type', String(n)), row('Exact', String(exact)), row('Close', String(typed - exact)), row('Not typed yet', String(n - typed)), row('Seen (count half)', String(seen)), row(`AI-typed (count ${100 * ASSIST_FACTOR}%)`, String(helped)));
        const parts: HTMLElement[] = [head, p('The score is the average over the running block\'s lines (blank and comment lines aside):'), rules, now];
        if (score.sections.length) {
            const secs = el('div', 'cp-tip-now');
            for (const x of score.sections) secs.append(row(x.title, `${x.score}%`));
            parts.push(p('By section:'), secs);
        }
        if (seen || helped) parts.push(p('Hide code, then retype a seen or AI-typed line (or Reset) to earn it in full.'));
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
        if (assisting || !coachOn() || !current || !score || (!input.value.trim() && !hintsOn())) return;
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
        const msg = message('assistant', body);msg.classList.toggle('cp-msg-perfect', perfect);
        offerHelp(msg);
        render(false);
        // Read as shown: the answer, the comment, the reminder, each new line issue, then what to do next.
        speakReview([r.reply, r.commentary, r.reminder, ...fresh.map(n => `Line ${n.line}: ${n.note}`), r.direction && `Next: ${r.direction}`]
            .filter(Boolean).join(' ').replace(/[`*]/g, ''));
    }

    // ── Help me: the assistant takes the keyboard (the code_assist expert) ──
    // It says how it will go about it, then, step by step, thinks aloud, types (the change from the editor to the
    // step's text, at a person's pace: code-assist-play.ts) and says why it works; then it hands the keyboard back.
    const helpTool = tool('✋ Help me', 'Let the assistant take the keyboard: the next step, this section, or the whole block');
    helpTool.classList.add('cp-coach-only');
    const takeBack = tool('■ Take back', 'Stop the assistant and type yourself again (Esc)');
    takeBack.classList.add('cp-take-back');takeBack.hidden = true;
    tools.insertBefore(helpTool, reset);tools.append(takeBack);
    // Its own caret, as a collaborator's in a shared editor, with its name on it.
    const aiCaret = el('div', 'cp-ai-caret');aiCaret.hidden = true;
    const aiTag = el('span', 'cp-ai-tag');aiTag.textContent = '✦ AI';aiCaret.append(aiTag);
    // What it points at while it talks: its selection, drawn over the code (the textarea's own needs focus).
    const aiSelection = el('div', 'cp-ai-selection');
    stack.append(aiSelection, aiCaret);
    let selectedTo = 0;
    let assisting = 0, assistSeq = 0, charWidth = 0;
    class Stopped extends Error {}
    const sleep = (ms: number) => new Promise<void>(res => window.setTimeout(res, ms));

    function focusNow(): CodeSection | null {
        if (!score) return null;
        return focusSection(score, input.value.slice(0, input.selectionStart).split('\n').length - 1, sections);
    }
    /** What the learner can ask for: the next step, the rest of the section they are on, or the rest of the block. */
    function helpChoices(): HTMLElement {
        const row = el('div', 'cp-help');
        const label = el('span', 'cp-help-label');label.textContent = 'Help me:';
        // In their own words: sent alone (Enter), it is the whole request; with a button, it says how to go about it.
        const ask = el('form', 'cp-help-ask');
        const words = el('input', 'cp-help-input');words.type = 'text';words.maxLength = 600;
        words.placeholder = 'say what you need, e.g. "write the loop" or "why {0: 1}?"';words.setAttribute('aria-label', 'Describe the help you want');
        const send = el('button', 'cp-help-send');send.type = 'submit';send.textContent = '➤';send.title = 'Ask (Enter)';
        ask.append(words, send);
        ask.addEventListener('submit', e => { e.preventDefault();if (words.value.trim()) void assist('ask', words.value.trim()); });
        row.append(label, ask);
        const focus = focusNow();
        const choices: [AssistScope, string, string][] = [
            // Only what is typed is fixed: nothing is written ahead.
            ...(input.value.trim() ? [['fix', 'Fix errors', 'I fix only what is wrong in what you typed, and write nothing new'],
                ['narrate', 'Walk me through it', 'I select your code piece by piece and explain it, typing nothing: only what you selected, if you selected some']] as [AssistScope, string, string][] : []),
            ['next', 'Next step', 'I take the keyboard for the next logical piece, then hand it back'],
            ...(focus ? [['section', `Finish “${focus.title}”`, 'I write the rest of this section, step by step, talking it through'] as [AssistScope, string, string]] : []),
            ['all', 'Write it all', 'I write the rest of the block, thinking aloud as I go'],
        ];
        for (const [scope, text, title] of choices) {
            const b = el('button', 'cp-help-btn');b.type = 'button';b.textContent = text;b.title = title;
            b.addEventListener('click', () => void assist(scope, words.value.trim()));row.append(b);
        }
        return row;
    }
    /** Help me sits under the latest message only: an older one's choices would act on code that has moved on. */
    function offerHelp(msg: HTMLElement) {
        report.querySelectorAll('.cp-help').forEach(h => h.remove());
        msg.querySelector('.msg-body')?.append(helpChoices());
        report.scrollTop = report.scrollHeight;
    }
    /** Said aloud (when the speaker is on) while its words appear; otherwise it waits about as long as reading it takes. */
    async function say(text: string, into: HTMLElement, run: number) {
        if (!text) return;
        into.classList.add('speaking');
        const plain = text.replace(/[`*_]/g, '');
        const words = plain.split(/\s+/).length;
        const speech = new Promise<void>(res => {
            const speakNow = window.algebenchSpeakText;
            if (speakOn() && speakNow) {
                speakNow(plain, res);
                // Speech that never reports its end (a failed stream) doesn't hold the keyboard.
                window.setTimeout(res, 6000 + words * 600);
            } else window.setTimeout(res, Math.min(6000, Math.max(1200, words * 230)));
        });
        let shown = '';
        for (const part of text.split(/(\s+)/)) {
            if (assisting !== run) break;
            shown += part;into.textContent = shown;report.scrollTop = report.scrollHeight;
            if (part.trim()) await sleep(140);
        }
        into.innerHTML = renderMarkdown(text, {untrusted: true, glossary: false});
        await speech;
        into.classList.remove('speaking');
        if (assisting !== run) throw new Stopped();
        await sleep(300);
    }
    /** The assistant's caret at `offset` of the editor, kept in view. */
    function measure() {
        if (charWidth) return;
        const ctx = document.createElement('canvas').getContext('2d');
        if (ctx) { ctx.font = getComputedStyle(input).font;charWidth = ctx.measureText('M'.repeat(10)).width / 10; }
    }
    /** Select `snippet` in the editor, as a person points: where it starts on `line` if the model gave one, else the next
     *  one after the last selection, else the first. */
    function selectText(snippet: string, line = 0) {
        clearSelection();
        const at = findSelection(input.value, snippet, selectedTo, line);
        if (!at) return;
        measure();
        const [start, end] = at, lines = input.value.split('\n');
        let offset = 0;
        lines.forEach((text, k) => {
            const from = Math.max(start, offset), to = Math.min(end, offset + text.length);
            const row = paint.children[k] as HTMLElement | undefined;
            if (row && from <= to && !(from === to && start !== end)) {
                // A line inside the selection is lit from its indentation on, as a selection reads.
                const a = from - offset === 0 && start < offset ? text.length - text.trimStart().length : from - offset;
                const box = el('div', 'cp-ai-sel');
                box.style.left = `${row.offsetLeft + a * charWidth}px`;box.style.width = `${Math.max(2, (to - offset - a) * charWidth)}px`;
                box.style.top = `${row.offsetTop}px`;box.style.height = `${row.offsetHeight}px`;
                aiSelection.append(box);
            }
            offset += text.length + 1;
        });
        selectedTo = end;
        placeCaret(end);
    }
    function clearSelection() { aiSelection.replaceChildren(); }
    function placeCaret(offset: number) {
        const before = input.value.slice(0, offset).split('\n'), line = before.length - 1, col = before[line]!.length;
        const row = paint.children[line] as HTMLElement | undefined;
        if (!row) return;
        measure();
        aiCaret.hidden = false;
        aiCaret.style.left = `${row.offsetLeft + col * charWidth}px`;
        aiCaret.style.top = `${row.offsetTop}px`;aiCaret.style.height = `${row.offsetHeight}px`;
        aiCaret.classList.toggle('below', line === 0);
        const r = aiCaret.getBoundingClientRect(), view = editor.getBoundingClientRect();
        if (r.bottom > view.bottom - 6) editor.scrollTop += r.bottom - view.bottom + 24;
        if (r.top < view.top + 6) editor.scrollTop -= view.top - r.top + 24;
        // Sideways, the line starts stay in view whenever the caret fits; a long line scrolls only as far as it needs.
        const x = gutter.offsetWidth + aiCaret.offsetLeft;
        editor.scrollLeft = x + 40 < editor.clientWidth ? 0 : x + 60 - editor.clientWidth;
    }
    /** Type the change from the editor to `target`: move there, backspace what goes, type what comes. */
    async function typeTo(target: string, run: number) {
        let text = input.value + '\n', caret = input.value.length;
        const show = (at: number) => { caret = at;input.value = text.slice(0, -1);attempt.text = input.value;render(false);placeCaret(Math.min(at, input.value.length));highlight(); };
        for (const e of editsBetween(input.value, target)) {
            const end = e.at + e.remove;
            if (assisting !== run) throw new Stopped();
            // A hand moves to the spot first: a moment's pause where the caret jumps.
            const jump = Math.abs(end - caret) > 2;
            show(end);await sleep(jump ? 420 : 140);
            let at = end;
            for (const n of backspaces(text.slice(0, end), e.remove)) {
                if (assisting !== run) throw new Stopped();
                text = text.slice(0, at - n) + text.slice(at);at -= n;show(at);
                await sleep(n > 1 ? 120 : 45 + Math.random() * 35);
            }
            let prev = text[at - 1] ?? '\n';
            for (const key of keystrokes(e.insert)) {
                await sleep(keyDelay(prev, key));
                if (assisting !== run) throw new Stopped();
                text = text.slice(0, at) + key + text.slice(at);at += key.length;prev = key;show(at);
            }
            await sleep(220);
        }
    }
    async function assist(scope: AssistScope, request = '') {
        if (!current || !score || assisting) return;
        const run = ++assistSeq, blockKey = key;assisting = run;
        clearTimeout(idle);reviewSeq++;   // a review on its way is not shown over the takeover
        if (window.algebenchTTSActive?.()) window.algebenchStopTTS?.();
        report.querySelectorAll('.cp-help').forEach(h => h.remove());
        if (report.hidden) foldReport(false);
        const focus = focusNow();
        // Walking through: the learner's selection in the editor, if they made one (it outlasts the click), else all of it.
        const a = input.selectionStart, b = input.selectionEnd, picked = scope === 'narrate' && b > a && input.value.slice(a, b).trim();
        let span = '';
        const own = request;
        if (picked) {
            const first = input.value.slice(0, a).split('\n').length, last = input.value.slice(0, b).replace(/\n$/, '').split('\n').length;
            span = first === last ? `line ${first}` : `lines ${first}–${last}`;
            request = [`Only the part I selected, ${span} (nothing outside it):`, input.value.slice(a, b), request].filter(Boolean).join('\n');
        }
        const asked = {fix: 'Fix the errors in what I typed, without writing ahead.', narrate: picked ? `Walk me through the selected ${span}.` : 'Walk me through my code.', next: 'Help me with the next step.',
            section: `Help me finish “${focus?.title ?? 'this section'}”.`, all: 'Write it all for me, and talk me through it.', ask: request}[scope];
        message('user', Object.assign(el('div', ''), {textContent: scope !== 'ask' && own ? `${asked} ${own}` : asked}));
        root.classList.add('cp-assisting');input.readOnly = true;takeBack.hidden = false;helpTool.hidden = true;
        reportSummary.textContent = 'taking the keyboard…';
        const exactBefore = new Set(score.lines.filter(l => l.similarity === 1).map(l => l.line));
        const assistedBefore = new Set(attempt.assisted);
        const waiting = message('assistant', el('div', 'chat-loading'));
        waiting.querySelector('.chat-loading')!.innerHTML = '<span></span><span></span><span></span>';
        let ended = false;
        try {
            const out = await invokeExpert('code_assist', {
                language: current.file.language ?? '', expected: block, first_line: current.from,
                section: focus ? {title: focus.title, hint: focus.hint ?? '', start: focus.from, end: focus.to} : null,
                typed: input.value, scope, request,
                // The coach's remarks, while they still number the lines as they are.
                issues: attempt.reviewed === input.value ? (attempt.issues ?? []).slice(0, 40) : [],
            }) as {result?: AssistPlan; reason?: string};
            waiting.remove();
            if (assisting !== run) throw new Stopped();
            const bubble = (cls: string) => message('assistant', el('div', `cp-assist ${cls}`)).querySelector<HTMLElement>('.msg-body')!;
            if (!out.result) {
                // Nothing to type: an answer to a question, or nothing to fix, is said like the rest of its help.
                if ((scope === 'ask' || scope === 'fix' || scope === 'narrate') && out.reason) { await say(out.reason, bubble('cp-assist-close'), run);ended = true;return; }
                message('assistant', Object.assign(el('div', 'cp-report-reason'), {textContent: out.reason ?? 'No help came back.'}));
                return;
            }
            const r = out.result;
            reportSummary.textContent = '✦ AI at the keyboard';
            await say(r.plan, bubble('cp-assist-plan'), run);
            selectedTo = 0;
            for (const [k, step] of r.steps.entries()) {
                const body = bubble('cp-assist-step');
                const noun = scope === 'fix' ? 'Fix' : scope === 'narrate' ? 'Part' : 'Step';
                const head = el('div', 'cp-assist-head');
                head.textContent = r.steps.length > 1 ? `${noun} ${k + 1} of ${r.steps.length}` : scope === 'next' ? 'Next step' : noun;
                const thought = el('div', 'cp-assist-say');
                body.append(head, thought);
                // A step that types nothing points first, then talks; one that types points at what it typed, after.
                const types = !!step.code && step.code !== input.value;
                clearSelection();
                if (!types && step.select) selectText(step.select, step.select_line);
                await say(step.say, thought, run);
                if (!types) {
                    if (step.explain) { const why = el('div', 'cp-assist-why');body.append(why);await say(step.explain, why, run); }
                    continue;
                }
                body.classList.add('typing');
                // A slip and its catch: the first version typed, what is wrong with it said, then the fix.
                if (step.draft && step.notice) {
                    await typeTo(step.draft, run);
                    body.classList.remove('typing');
                    const caught = el('div', 'cp-assist-say cp-assist-notice');body.append(caught);
                    await sleep(500);await say(step.notice, caught, run);
                    body.classList.add('typing');
                }
                await typeTo(step.code, run);
                markAssisted(exactBefore);
                body.classList.remove('typing');
                if (step.select) selectText(step.select, step.select_line);
                if (step.explain) { const why = el('div', 'cp-assist-why');body.append(why);await say(step.explain, why, run); }
            }
            clearSelection();
            await say(r.closing || 'Over to you.', bubble('cp-assist-close'), run);
            ended = true;
        } catch (e) {
            waiting.remove();
            if (!(e instanceof Stopped) && assisting === run) message('assistant', Object.assign(el('div', 'cp-report-reason'), {textContent: (e as Error).message}));
        } finally {
            handBack(run, blockKey, exactBefore, assistedBefore, ended);
        }
    }
    /** The keyboard is the learner's again: the lines the assistant typed count as seen, and the coach starts from here. */
    /** Lines the assistant made exact are marked as its (✦, ASSIST_FACTOR) as soon as it has typed them. */
    function markAssisted(exactBefore: Set<number>) {
        render(false);
        const helped = score?.lines.filter(l => l.similarity === 1 && !exactBefore.has(l.line) && !l.assisted).map(l => l.line) ?? [];
        if (helped.length) { attempt.assisted = [...(attempt.assisted ?? []), ...helped];persist();render(false); }
    }
    function handBack(run: number, blockKey: string, exactBefore: Set<number>, assistedBefore: Set<number>, ended: boolean) {
        if (assisting === run) assisting = 0;
        root.classList.remove('cp-assisting');input.readOnly = false;takeBack.hidden = true;helpTool.hidden = false;aiCaret.hidden = true;clearSelection();
        reportSummary.textContent = '';
        // The lesson moved on meanwhile (that block's report is gone), or Reset started the block afresh: nothing to hand back.
        if (key !== blockKey || dropped) { dropped = false;return; }
        attempt.text = input.value;render(false);
        // Not typed by the learner at all: a line the assistant wrote counts a tenth (ASSIST_FACTOR), seen or not.
        markAssisted(exactBefore);
        const helped = (attempt.assisted ?? []).filter(line => !assistedBefore.has(line));
        // What the assistant typed isn't news to the coach: its next review starts from here.
        attempt.reviewed = input.value;lastReviewed = reviewKey(input.value);
        persist();highlight();
        const msg = ended ? report.lastElementChild as HTMLElement : message('assistant', Object.assign(el('div', 'cp-assist cp-assist-close'), {textContent: 'OK, the keyboard is yours again.'}));
        if (helped.length) {
            const note = el('div', 'cp-assist-note');
            note.textContent = `The ${helped.length === 1 ? 'line' : `${helped.length} lines`} I typed count${helped.length === 1 ? 's' : ''} as AI-typed (✦, ${100 * ASSIST_FACTOR}% each). Delete or Reset and type ${helped.length === 1 ? 'it' : 'them'} from memory for full marks.`;
            msg.querySelector('.msg-body')?.append(note);
        }
        offerHelp(msg);
        input.focus();input.setSelectionRange(input.value.length, input.value.length);
    }
    /** Stop the assistant; `drop` when its work is being thrown away (Reset), so it hands nothing back. */
    let dropped = false;
    function stopAssist(drop = false) {
        if (!assisting) return;
        assisting = 0;dropped = drop;
        root.classList.remove('cp-assisting');input.readOnly = false;takeBack.hidden = true;helpTool.hidden = false;aiCaret.hidden = true;clearSelection();
        if (window.algebenchTTSActive?.()) window.algebenchStopTTS?.();
    }
    takeBack.addEventListener('click', () => stopAssist());
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && assisting) { e.preventDefault();stopAssist(); } });
    helpTool.addEventListener('click', () => {
        if (assisting || !current) return;
        if (report.hidden) foldReport(false);
        offerHelp(message('assistant', Object.assign(el('div', ''), {textContent: 'How much should I take on? I\'ll think aloud as I type, and you can take the keyboard back any time (Esc).'})));
    });

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
        // Opened on an empty editor, the coach says how to start, as on reaching an empty block; with code typed, it
        // reviews what is new since its last word.
        if (root.classList.contains('open')) void review(!input.value.trim());
        // Folded away, the coach is put aside too: its speech stops and a review still coming isn't shown.
        else hushCoach();
    };
    toggle.addEventListener('click', e => { e.stopPropagation();flipOpen(); });
    head.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('button')) flipOpen(); });
    paintOpen();
    hide.addEventListener('click', () => { if (!current) return;current.setHidden(!current.hidden()); });
    // The Code panel's own Hide code button flips the same switch.
    window.addEventListener('algebench:codehidden', e => hide.setAttribute('aria-pressed', String((e as CustomEvent<{hidden: boolean}>).detail.hidden)));
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
        // Starting afresh ends Help me too: the assistant stops, and its work goes with the rest.
        stopAssist(true);
        attempt = {text: '', peeked: [], reviews: {}, celebrated: []};input.value = '';notes = new Map();
        clearReport();cheer.hidden = true;lastReviewed = '';persist();render(false);input.focus();
        if (hintsOn()) void review(false);
    });
    window.addEventListener('algebench:codeview', retarget);
    window.addEventListener('algebench:navchange', retarget);
    retarget();
}
