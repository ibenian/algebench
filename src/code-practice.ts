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
import { scorePractice, focusSection, isNeutral } from '/code-practice-core.js';
import type { PracticeScore } from '/code-practice-core.js';
import { lineTokens, paintTokens } from '/code-highlight.js';
import type { CodeToken } from '/code-highlight.js';
import { invokeExpert } from '/expert-client.js';
import { renderMarkdown } from '/labels.js';

/** The coach looks again after this long without typing. */
const IDLE_REVIEW_MS = 5000;
const INDENT = '    ';
const STORE_KEY = 'algebench-code-practice', VIEW_KEY = 'algebench-code-practice-view';

interface Attempt { text: string; peeked: number[]; reviews: Record<string, number>; celebrated: string[] }
interface Review { score: number; verdict: string; commentary: string; direction: string; reply?: string; line_notes: {line: number; note: string}[] }

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

export function setupCodePractice(): void {
    const doc = document.getElementById('tab-doc');
    if (!doc) return;
    const prefs = loadJson<{open?: boolean; coach?: boolean; hints?: boolean; speak?: boolean; height?: number}>(VIEW_KEY, {});
    const saved = loadJson<Record<string, Attempt>>(STORE_KEY, {});

    const root = el('section', 'code-practice');root.hidden = true;root.classList.toggle('open', !!prefs.open);
    const head = el('div', 'cp-head');
    const toggle = el('button', 'cp-toggle');toggle.type = 'button';toggle.innerHTML = '<span class="cp-chevron" aria-hidden="true">▸</span> Type along';
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
    head.append(toggle, target, total, tools);
    const bodyEl = el('div', 'cp-body');
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
    const report = el('div', 'cp-report');report.hidden = true;report.setAttribute('aria-live', 'polite');
    bodyEl.append(chips, editor, cheer, report);
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

    let current: CodeView | null = null, key = '', block = '', sections: CodeSection[] = [];
    let attempt: Attempt = {text: '', peeked: [], reviews: {}, celebrated: []};
    let score: PracticeScore | null = null, tokens: CodeToken[] = [], tokenText = '';
    let notes = new Map<number, string>(), cheerTimer = 0, reviewSeq = 0, lastReviewed = '', idle = 0, highlightTimer = 0;
    coach.setAttribute('aria-pressed', String(!!prefs.coach));
    hint.setAttribute('aria-pressed', String(!!prefs.hints));
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
    const savePrefs = () => saveJson(VIEW_KEY, {open: root.classList.contains('open'), coach: coachOn(), hints: hintsOn(), speak: speakOn(), height: prefs.height});
    function paintSpeak(on: boolean) {
        speak.setAttribute('aria-pressed', String(on));
        speak.title = on ? 'Reading the coach aloud · click to stop' : 'Read the coach\'s commentary aloud';
        speak.setAttribute('aria-label', speak.title);
    }
    /** The review as it is spoken: the commentary and what to do next, without markdown. */
    let spoken = '';
    function speakReview(text: string) {
        spoken = text;
        if (speakOn() && text) window.algebenchSpeakText?.(text);
    }
    function persist() {
        saved[key] = attempt;saveJson(STORE_KEY, saved);
    }

    /** Follow the Code panel to the block running now; each block keeps its own attempt. */
    function retarget() {
        const v = codeView();
        root.hidden = !v;
        if (!v) { current = null;return; }
        const text = v.file.source.split('\n').slice(v.from - 1, v.to).join('\n').replace(/\s+$/, '');
        const next = `${v.file.id}:${v.from}:${hash(text)}`;
        current = v;
        if (next === key) return;
        key = next;block = text;
        sections = codeSections(v.file).filter(s => s.from >= v.from && s.to <= v.to);
        attempt = saved[key] ?? {text: '', peeked: [], reviews: {}, celebrated: []};
        input.value = attempt.text;notes = new Map();report.hidden = true;cheer.hidden = true;lastReviewed = '';
        const count = v.to - v.from + 1;
        target.textContent = `${v.file.path.split('/').pop()} · lines ${v.from}–${v.to}`;
        target.title = `${count} lines${sections.length ? `, ${sections.length} sections` : ''}`;
        render(false);
        highlight();
        if (hintsOn() && !input.value.trim() && root.classList.contains('open')) void review(false);
    }

    function render(celebrate = true) {
        if (!current) return;
        const before = score;
        score = scorePractice(block, current.from, input.value, new Set(attempt.peeked), sections);
        const cursor = input.value.slice(0, input.selectionStart).split('\n').length - 1;
        const focus = focusSection(score, cursor, sections);
        const scoreOfTyped = new Map(score.lines.filter(l => l.typed != null).map(l => [l.typed!, l]));
        const typedLines = input.value.split('\n');
        gutter.replaceChildren(...typedLines.map((text, j) => {
            const row = el('div', 'cp-mark'), t = score!.typed[j]!, line = scoreOfTyped.get(j);
            const n = el('span', 'cp-n');n.textContent = String(j + 1);
            const mark = el('span', 'cp-status');
            if (t.neutral) row.classList.add('neutral');
            else if (t.exact) { row.classList.add(line?.peeked ? 'seen' : 'exact');mark.textContent = line?.peeked ? '✓·' : '✓'; }
            else if (line) { row.classList.add('fuzzy');mark.textContent = `${line.score}`; }
            else if (text.trim()) { row.classList.add('miss');mark.textContent = '✗'; }
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
            chip.textContent = `${s.score === 100 ? '★ ' : ''}${s.title} · ${s.score}%`;
            chip.title = `${s.title}: lines ${s.from}–${s.to}`;
            return chip;
        }));
        chips.hidden = !score.sections.length;
        total.textContent = `${score.total}%`;
        total.style.setProperty('--fill', `${score.total * 3.6}deg`);
        total.classList.toggle('done', score.total === 100);
        total.title = `The whole block: ${score.total}%`;
        if (celebrate && before) cheerFor(before, score);
    }

    /** Typed text coloured like the Code panel, by the same server lexer; plain until its colours arrive. */
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

    async function review(force: boolean) {
        // With hints, an empty editor is a beginning: the coach says how to start.
        if (!current || !score || (!input.value.trim() && !hintsOn())) return;
        const cursor = input.value.slice(0, input.selectionStart).split('\n').length - 1;
        const focus = focusSection(score, cursor, sections);
        const signature = `${focus?.id ?? '*'}\n${hintsOn()}\n${input.value}`;
        if (!force && signature === lastReviewed) return;
        lastReviewed = signature;
        const id = focus?.id ?? '*', seq = ++reviewSeq;
        report.hidden = false;report.classList.add('busy');
        report.replaceChildren(Object.assign(el('div', 'cp-report-busy'), {textContent: input.value.trim() ? `Coach is reviewing${focus ? ` “${focus.title}”` : ''}…` : 'Coach is finding a way in…'}));
        try {
            const out = await invokeExpert('code_practice', {
                language: current.file.language ?? '', expected: block, first_line: current.from,
                section: focus ? {title: focus.title, hint: focus.hint ?? '', start: focus.from, end: focus.to} : null,
                typed: input.value,
                match: score.typed.map((t, j) => ({typed: j + 1, score: Math.round(100 * t.similarity), ...(t.reference != null ? {reference: t.reference} : {})}))
                    .filter((_, j) => !score!.typed[j]!.neutral).slice(0, 400),
                attempts: attempt.reviews[id] ?? 0, hints: hintsOn(),
            }) as {result?: Review; reason?: string};
            if (seq !== reviewSeq) return;
            attempt.reviews[id] = (attempt.reviews[id] ?? 0) + 1;persist();
            showReview(out, focus);
        } catch (e) {
            if (seq !== reviewSeq) return;
            showReview({reason: (e as Error).message}, focus);
        }
    }
    function showReview(out: {result?: Review; reason?: string}, focus: CodeSection | null) {
        report.classList.remove('busy');
        const r = out.result;
        if (!r) { spoken = '';report.replaceChildren(Object.assign(el('div', 'cp-report-reason'), {textContent: out.reason ?? 'No review.'}));notes = new Map();render(false);return; }
        notes = new Map(r.line_notes.map(n => [n.line, n.note]));
        const top = el('div', 'cp-report-head');
        const badge = el('span', `cp-verdict cp-verdict-${r.verdict}`);badge.textContent = `${VERDICTS[r.verdict] ?? r.verdict} · ${r.score}%`;
        const about = el('span', 'cp-report-about');about.textContent = focus ? focus.title : 'The whole block';
        top.append(badge, about);
        const text = el('div', 'cp-report-text');text.innerHTML = renderMarkdown(r.commentary, {untrusted: true, glossary: false});
        const parts: HTMLElement[] = [top];
        // The answer to the learner's own comments comes first: they asked.
        if (r.reply) { const answer = el('div', 'cp-report-reply');answer.innerHTML = renderMarkdown(r.reply, {untrusted: true, glossary: false});parts.push(answer); }
        parts.push(text);
        if (r.direction) { const next = el('div', 'cp-report-next');next.innerHTML = renderMarkdown(`**Next:** ${r.direction}`, {untrusted: true, glossary: false});parts.push(next); }
        if (r.line_notes.length) {
            const list = el('ul', 'cp-report-notes');
            for (const n of r.line_notes) { const li = el('li', '');li.textContent = `Line ${n.line}: ${n.note}`;list.append(li); }
            parts.push(list);
        }
        report.replaceChildren(...parts);
        render(false);
        speakReview([r.reply, r.commentary, r.direction && `Next: ${r.direction}`].filter(Boolean).join(' ').replace(/[`*]/g, ''));
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
    toggle.addEventListener('click', () => {
        root.classList.toggle('open');toggle.setAttribute('aria-expanded', String(root.classList.contains('open')));savePrefs();
        if (root.classList.contains('open') && hintsOn() && !input.value.trim()) void review(false);
    });
    toggle.setAttribute('aria-expanded', String(root.classList.contains('open')));
    hide.addEventListener('click', () => { if (!current) return;current.setHidden(!current.hidden());hide.setAttribute('aria-pressed', String(current.hidden())); });
    coach.addEventListener('click', () => {
        coach.setAttribute('aria-pressed', String(!coachOn()));savePrefs();
        if (coachOn()) void review(false);
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
        if (speakOn()) { if (!report.hidden && !report.classList.contains('busy')) speakReview(spoken); }
        else if (window.algebenchTTSActive?.()) window.algebenchStopTTS?.();
    });
    reset.addEventListener('click', () => {
        attempt = {text: '', peeked: [], reviews: {}, celebrated: []};input.value = '';notes = new Map();
        report.hidden = true;cheer.hidden = true;lastReviewed = '';persist();render(false);input.focus();
    });
    window.addEventListener('algebench:codeview', retarget);
    window.addEventListener('algebench:navchange', retarget);
    retarget();
}
