/**
 * Alternatives: two solutions to the same problem side by side, picked from the lesson's alternatives group for the code
 * in hand (`codeFiles[].alternatives`, known at once, no search), the learner's own code among them. It draws in Compare's split view (code-compare.ts)
 * with its own kind, and has its own picker bar, its own wire shape and its own expert: comparing alternatives is not
 * checking the learner's code against the original, and the two are kept apart so each can grow on its own.
 */
import { createCompareView } from '/code-compare.js';
import type { CompareKind, CompareMatch, CompareResult, CompareStep } from '/code-compare.js';
import type { CanvasHand } from '/code-canvas.js';
import type { CodeMark } from '/code-canvas-core.js';
import type { CodeFile } from '/types/lesson.js';

/** One piece of code that can go on either side: `name` is how the talk and the parts name it, `label` its approach. */
export interface AltSource { id: string; name: string; label: string; code: string; approach?: string; when?: string }
/** The lesson's group for the code in hand: the problem they all solve, what to bring out, this member and the rest. */
export interface AltGroup { title: string; prompt: string; here: AltSource; others: AltSource[] }

interface AltMatch { left_from: number; left_to: number; right_from: number; right_to: number; verdict: string; comment: string }
interface AltStep { say: string; point?: {side: string; line: number; text: string}; draw?: CodeMark[]; draw_left?: CodeMark[] }
/** What code_alternatives answers a comparison or a question with. */
export interface AltResult { summary: string; matches: AltMatch[]; steps: AltStep[]; takeaways: string[]; closing: string }

const DEF = /^(?:async\s+)?(?:def|function|class)\s+([A-Za-z_]\w*)/;

/** The top-level functions of a source: each from its header to the last code line before the next top-level line. */
export function topLevelFunctions(source: string): {name: string; from: number; to: number}[] {
    const lines = source.split('\n'), out: {name: string; from: number; to: number}[] = [];
    let open: {name: string; from: number; to: number} | null = null;
    lines.forEach((text, k) => {
        if (!text.trim() || /^\s/.test(text) || /^[@#)\]}]/.test(text)) { if (open && text.trim()) open.to = k + 1;return; }
        if (open) out.push(open);
        const def = DEF.exec(text);
        open = def ? {name: def[1]!, from: k + 1, to: k + 1} : null;
    });
    if (open) out.push(open);
    return out;
}

/**
 * The alternatives group the code in hand belongs to: a group (declared on any file) with a member whose function, in
 * `at`'s file, overlaps its lines. Members whose function can't be found are left out; null when nothing is left to compare.
 */
export function blockAlternatives(files: CodeFile[], at: {file: string; from: number; to: number}): AltGroup | null {
    const byId = new Map(files.map(f => [f.id, f]));
    const find = (fileId: string, name: string) => {
        const file = byId.get(fileId), fn = file && topLevelFunctions(file.source).find(f => f.name === name);
        return fn ? {...fn, code: file!.source.split('\n').slice(fn.from - 1, fn.to).join('\n').replace(/\s+$/, '')} : null;
    };
    for (const file of files) {
        for (const group of file.alternatives ?? []) {
            const members = group.members.map(m => ({m, fileId: m.file ?? file.id, fn: find(m.file ?? file.id, m.function)}))
                .filter((x): x is typeof x & {fn: NonNullable<typeof x.fn>} => !!x.fn);
            const here = members.find(x => x.fileId === at.file && x.fn.from <= at.to && x.fn.to >= at.from);
            if (!here || members.length < 2) continue;
            const source = (x: typeof here): AltSource => ({id: `alt:${x.fileId}:${x.m.function}`, name: x.m.function, label: x.m.label, code: x.fn.code,
                ...(x.m.approach ? {approach: x.m.approach} : {}), ...(x.m.when ? {when: x.m.when} : {})});
            return {title: group.title, prompt: group.prompt ?? '', here: source(here), others: members.filter(x => x !== here).map(source)};
        }
    }
    return null;
}

/** What the comparer is told of the two from the lesson: the problem, what to bring out, and each side's approach. */
export function alternativesFocus(group: AltGroup, left: AltSource, right: AltSource): string {
    const side = (where: string, s: AltSource) => [`${where}, ${s.name}: ${s.label}.`, s.approach, s.when ? `When to choose it: ${s.when}` : ''].filter(Boolean).join(' ');
    return [`The problem both solve: ${group.title}.`, group.prompt, side('Left', left), side('Right', right)].filter(Boolean).join('\n').slice(0, 2000);
}

const TONES: Record<string, string> = {same: 'exact', equivalent: 'equivalent', different: 'alternate', only_left: 'missing', only_right: 'extra'};

/** The expert's answer in the split view's terms: its left is the view's "original", its right the view's "yours". */
export function toView(r: AltResult): CompareResult {
    return {summary: r.summary, same_behaviour: false, debrief: r.takeaways ?? [], closing: r.closing, steps: (r.steps ?? []).map(viewStep),
        matches: (r.matches ?? []).map(m => ({original_from: m.left_from, original_to: m.left_to, yours_from: m.right_from, yours_to: m.right_to, verdict: m.verdict, comment: m.comment}))};
}
function viewStep(s: AltStep): CompareStep {
    return {say: s.say, draw: s.draw ?? [], draw_original: s.draw_left ?? [],
        ...(s.point ? {point: {side: s.point.side === 'left' ? 'original' : 'yours', line: s.point.line, text: s.point.text}} : {})};
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);e.className = cls;return e;
}

/**
 * The picker bar over the split view: the left side (what to compare against) and the right (by default the code in
 * hand), with a swap between them. A change of either side is a new comparison (`choose`). The caller places `root`.
 */
export function createAlternativesView(o: {charWidth: () => number; hand: CanvasHand; ask: (m: CompareMatch, ownWords: boolean) => void; choose: () => void; explain: (side: AltSource, other: AltSource) => void}) {
    const root = el('div', 'cp-alt');
    const bar = el('div', 'cp-alt-bar');
    const pick = (side: string) => { const s = el('select', 'cp-alt-pick');s.setAttribute('aria-label', `${side} side`);s.addEventListener('change', () => { paintAbout();o.choose(); });return s; };
    const leftPick = pick('Left'), rightPick = pick('Right');
    const swap = el('button', 'cp-alt-swap');swap.type = 'button';swap.textContent = '⇄';swap.title = 'Swap the sides';swap.setAttribute('aria-label', swap.title);
    swap.addEventListener('click', () => { const l = leftPick.value;leftPick.value = rightPick.value;rightPick.value = l;paintAbout();o.choose(); });
    const status = el('span', 'cp-alt-status');status.setAttribute('role', 'status');
    bar.append(leftPick, swap, rightPick, status);
    // What the lesson says of each side, shown at once, before any comparison comes back: its approach and when to choose
    // it (`info`), and the problem both solve (`heading`). The caller places both, the heading on the panel's title bar,
    // whose click folds `info` away (`setInfoOpen`); folded or not is remembered.
    const info = el('div', 'cp-alt-info');
    const INFO_KEY = 'algebench-alt-info-open';
    let infoOpen = true;
    try { infoOpen = localStorage.getItem(INFO_KEY) !== '0'; } catch { /* storage off: open */ }
    info.hidden = !infoOpen;
    const title = el('span', 'cp-alt-heading');
    const about = el('div', 'cp-alt-about');
    info.append(about);
    const scroll = el('div', 'cp-compare cp-alt-view');
    root.append(bar, scroll);
    let sources: AltSource[] = [];
    const chosen = (s: HTMLSelectElement) => sources.find(x => x.id === s.value) ?? null;
    let names: [string, string] = ['left', 'right'];
    const kind: CompareKind = {
        titles: () => names,
        sides: () => names,
        label: verdict => ({same: 'same', equivalent: 'equivalent', different: 'different approach', only_left: `only in ${names[0]}`, only_right: `only in ${names[1]}`} as Record<string, string>)[verdict] ?? verdict,
        tone: verdict => TONES[verdict] ?? 'alternate',
        gap: m => m.verdict === 'only_left' ? `not in ${names[1]}` : null,
        askTitle: () => 'Explain this part',
    };
    const view = createCompareView({host: scroll, charWidth: o.charWidth, hand: o.hand, ask: o.ask, kind});
    function card(source: AltSource | null, other: AltSource | null) {
        const c = el('div', 'cp-alt-card');
        if (!source) return c;
        const head = el('div', 'cp-alt-card-head');
        const name = el('code', 'cp-alt-card-name');name.textContent = source.name;
        const label = el('span', 'cp-alt-card-label');label.textContent = source.label;
        head.append(name, label);c.append(head);
        if (source.id === 'scene') { const tag = el('span', 'cp-alt-card-tag');tag.textContent = 'this scene';head.append(tag); }
        // Ask about this approach: how it works, and when to choose it over the other side.
        if (other) {
            const ai = el('button', 'cp-alt-card-ask');ai.type = 'button';ai.textContent = '✦';
            ai.title = `Explain ${source.name}: how it works, and when to choose it over ${other.name}`;ai.setAttribute('aria-label', ai.title);
            ai.addEventListener('click', () => o.explain(source, other));
            head.append(ai);
        }
        if (source.approach) c.append(Object.assign(el('div', 'cp-alt-card-approach'), {textContent: source.approach}));
        if (source.when) {
            const when = el('div', 'cp-alt-card-when'), key = el('span', 'cp-alt-card-key');key.textContent = 'When: ';
            when.append(key, document.createTextNode(source.when));c.append(when);
        }
        return c;
    }
    function paintAbout() { const l = chosen(leftPick), r = chosen(rightPick);about.replaceChildren(card(l, r), card(r, l)); }
    return {
        root, info, heading: title, view, scroll, kind,
        infoOpen: () => infoOpen,
        setInfoOpen(on: boolean) {
            infoOpen = on;info.hidden = !on;
            try { localStorage.setItem(INFO_KEY, on ? '1' : '0'); } catch { /* not kept */ }
        },
        /** The sources to choose from, and which goes on each side. */
        setSources(heading: string, list: AltSource[], left: string, right: string) {
            sources = list;title.textContent = heading;
            for (const s of [leftPick, rightPick]) s.replaceChildren(...list.map(x => {
                const opt = el('option', '');opt.value = x.id;opt.textContent = `${x.id === 'scene' ? 'This scene: ' : ''}${x.name} — ${x.label}`;
                if (x.approach) opt.title = x.approach;
                return opt;
            }));
            leftPick.value = left;rightPick.value = right;
            paintAbout();
        },
        /** What is on each side now (null when the list is empty). */
        picked(): {left: AltSource; right: AltSource} | null {
            const left = chosen(leftPick), right = chosen(rightPick);
            return left && right ? {left, right} : null;
        },
        /** The sides as the comparison on screen names them, set as it is shown. */
        name(left: AltSource, right: AltSource) { names = [left.name, right.name]; },
        sideName: (side: string) => side === 'original' ? names[0] : names[1],
        setBusy(on: boolean) { leftPick.disabled = rightPick.disabled = swap.disabled = on; },
        setStatus(text: string) { status.textContent = text; },
        clear() { view.clear();status.textContent = '';title.textContent = '';about.replaceChildren(); },
    };
}
