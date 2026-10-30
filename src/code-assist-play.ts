/**
 * Help me (code-practice.ts): the assistant's steps arrive as whole editor texts; these turn the change from one to
 * the next into the edits a person would make at the keyboard, and pace the keystrokes.
 *
 * Edits work on the text with a newline after its last line, so a line added at the end is typed as Enter, then
 * the line (and a line removed as its text, then the line break), as at a real keyboard.
 */

/** One edit: at `at` (in the text as it is when the edit starts), remove `remove` characters, then type `insert`. */
export interface Edit { at: number; remove: number; insert: string }

/** The lines of a and b that stay, as pairs of indices (a longest common subsequence). */
function commonLines(a: string[], b: string[]): [number, number][] {
    const n = a.length, m = b.length;
    const len: number[][] = Array.from({length: n + 1}, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
        len[i]![j] = a[i] === b[j] ? len[i + 1]![j + 1]! + 1 : Math.max(len[i + 1]![j]!, len[i]![j + 1]!);
    const out: [number, number][] = [];
    for (let i = 0, j = 0; i < n && j < m;) {
        if (a[i] === b[j]) { out.push([i, j]);i++;j++; }
        else if (len[i + 1]![j]! >= len[i]![j + 1]!) i++;
        else j++;
    }
    return out;
}

/**
 * The edits taking `from` to `to`, top to bottom: one per run of changed lines, trimmed to the characters that
 * really change (a renamed variable is retyped, not its line), each `at` already counting the edits before it.
 */
export function editsBetween(from: string, to: string): Edit[] {
    const a = from.split('\n'), b = to.split('\n');
    const kept = [...commonLines(a, b), [a.length, b.length] as [number, number]];
    const lineStart = (lines: string[], k: number) => lines.slice(0, k).reduce((s, l) => s + l.length + 1, 0);
    const edits: Edit[] = [];
    let i = 0, j = 0;
    for (const [ki, kj] of kept) {
        if (ki > i || kj > j) {
            // The changed lines, each with its line break; with the break before them, so an addition at the end
            // starts with Enter.
            const lead = j > 0 ? 1 : 0;
            let old = (lead ? '\n' : '') + a.slice(i, ki).map(l => l + '\n').join('');
            let neu = (lead ? '\n' : '') + b.slice(j, kj).map(l => l + '\n').join('');
            let at = lineStart(b, j) - lead;
            // What both end with stays (trimmed first, so typing goes at a line's end), then what both start with.
            let tail = 0;
            while (tail < old.length && tail < neu.length && old[old.length - 1 - tail] === neu[neu.length - 1 - tail]) tail++;
            old = old.slice(0, old.length - tail);neu = neu.slice(0, neu.length - tail);
            let head = 0;
            while (head < old.length && head < neu.length && old[head] === neu[head]) head++;
            at += head;old = old.slice(head);neu = neu.slice(head);
            if (old || neu) edits.push({at, remove: old.length, insert: neu});
        }
        i = ki + 1;j = kj + 1;
    }
    return edits;
}

/** Apply edits in order (each `at` as editsBetween gives it). */
export function applyEdits(text: string, edits: Edit[]): string {
    let t = text + '\n';
    for (const e of edits) t = t.slice(0, e.at) + e.insert + t.slice(e.at + e.remove);
    return t.slice(0, -1);
}

/**
 * The keystrokes typing `insert`: one character each, except that a new line's indentation comes with its Enter
 * (as an editor indents), and a run of spaces inside a line is typed as one.
 */
export function keystrokes(insert: string): string[] {
    const out: string[] = [];
    for (let k = 0; k < insert.length;) {
        if (insert[k] === '\n') {
            const indent = /^[ \t]*/.exec(insert.slice(k + 1))![0];
            out.push('\n' + indent);k += 1 + indent.length;
        } else { out.push(insert[k]!);k++; }
    }
    return out;
}

/** Backspaces removing `count` characters ending at the caret: one at a time for a few, a word at a time for more. */
export function backspaces(text: string, count: number): number[] {
    if (count <= 10) return Array<number>(count).fill(1);
    const out: number[] = [];
    let left = count, end = text.length;
    while (left > 0) {
        let k = end - 1;
        while (k > end - left && /\s/.test(text[k]!)) k--;
        while (k > end - left && /\w/.test(text[k]!) && /\w/.test(text[k - 1]!)) k--;
        const n = Math.max(1, end - k);
        out.push(Math.min(n, left));left -= n;end -= n;
    }
    return out;
}

/** How long to wait before typing `key` after `prev`, in ms: a steady pace, slower after a line, a stop or a word. */
export function keyDelay(prev: string, key: string, random: () => number = Math.random): number {
    const r = random();
    if (key.startsWith('\n')) return 140 + r * 160;
    if (prev.endsWith('\n') || /^[ \t]*$/.test(prev)) return 90 + r * 120;
    if (/[:,)\]]/.test(prev)) return 70 + r * 140;
    if (prev === ' ' && r < 0.12) return 220 + r * 260;   // now and then a pause between words, as if thinking
    return 28 + r * 52;
}

/**
 * Where `snippet` (a step's `select`) is in `text`, as [start, end). With `line` (1-based, the line the model says it
 * starts on), an occurrence starting on that line wins, so a name used on many lines is taken where it was meant.
 * Otherwise the first occurrence from `from` on (after the last selection), else from the top; failing that, the
 * lines it spans compared without their indentation (the model may re-indent what it quotes). Null when it isn't there.
 */
export function findSelection(text: string, snippet: string, from = 0, line = 0): [number, number] | null {
    const want = snippet.trim();
    if (!want) return null;
    const lines = text.split('\n'), parts = want.split('\n').map(l => l.trim());
    const offset = (k: number) => lines.slice(0, k).reduce((s, l) => s + l.length + 1, 0);
    const byLines = (k: number): [number, number] | null => {
        if (k < 0 || k + parts.length > lines.length || !parts.every((p, j) => lines[k + j]!.trim() === p)) return null;
        const last = k + parts.length - 1;
        return [offset(k) + lines[k]!.length - lines[k]!.trimStart().length, offset(last) + lines[last]!.trimEnd().length];
    };
    if (line >= 1 && line <= lines.length) {
        const at = text.indexOf(want, offset(line - 1));
        if (at >= 0 && at <= offset(line - 1) + lines[line - 1]!.length) return [at, at + want.length];
        const there = byLines(line - 1);
        if (there) return there;
    }
    for (const start of [text.indexOf(want, from), text.indexOf(want)]) if (start >= 0) return [start, start + want.length];
    for (let k = 0; k + parts.length <= lines.length; k++) { const found = byLines(k);if (found) return found; }
    return null;
}
