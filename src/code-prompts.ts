/**
 * The Code panel's "⋯" prompts: questions about the active code (the function running now), sent to the tutor with
 * what it needs to answer them: the active block, any selection, the whole file, where execution is, the calls
 * still waiting, and the scene's scalar values. The menu shows the short label; the tutor gets the fuller request.
 * A prompt about a line (`line`) needs a selection; the rest work without one.
 */
export interface CodePrompt { label: string; prompt: string; line?: boolean }

export const CODE_PROMPTS: CodePrompt[] = [
    {label: 'Explain the gist of this code', prompt: 'Explain the gist of this algorithm in a few sentences: the problem it solves, the one idea that makes it work, and how the code carries that idea out. Stay at that level: no line-by-line walkthrough.'},
    {label: 'Analyze code structure', prompt: 'Analyze the structure of this code: its functions and how they call each other, its loops and branches, and the data structures it keeps. Say where the selected lines fit in.'},
    {label: "What's this line for?", prompt: 'What is the selected code for? Say what goes wrong, or what is missing, if it were removed.', line: true},
    {label: 'Analyze call stack', prompt: 'Analyze the call stack at the current step: each call still waiting to return, outermost first, with its arguments and what it is waiting for, and the call that is running now.'},
    {label: "I don't understand this line", prompt: "I don't understand the selected code. Explain it in plain words, one piece at a time, using the values on screen right now.", line: true},
    {label: 'How many times does this line run?', prompt: 'How many times does the selected code run for this input? Then say how that count grows with the input size, and why.', line: true},
    {label: "This line's share of the complexity", prompt: "How much does the selected line add to the program's runtime and space complexity? Count how often it runs and what each run costs, then say whether it dominates the total or not, and why.", line: true},
    {label: 'Total runtime / space complexity', prompt: 'What is the total runtime and space complexity of this code? Derive both from the loops and the recursion, and count the call stack and the output in the space.'},
    {label: 'Which lines determine the complexity?', prompt: 'Which lines determine the runtime and space complexity of this code? Name each one by line number, say what it contributes (a loop bound, a recursive call, a growing structure, the call stack), and which one dominates.'},
    {label: 'Complexity of this function only', prompt: 'What are the runtime and space complexity of only the function that contains the selected code (or of the active code), not counting its callers?'},
    {label: 'Can you write it in a more optimal way?', prompt: 'Can this code be written in a more optimal way? If it can, give the improved version, say what it changes, and compare its runtime and space complexity with the current one. If it is already optimal, say why: the lower bound it meets. Keep its behaviour and output the same.'},
];

/** The `def` enclosing a line (1-based): the nearest one above it, indented less than the line, or null. */
export function enclosingFunction(source: string, line: number): {name: string; line: number} | null {
    const lines = source.split('\n');
    const indent = (text: string) => text.length - text.trimStart().length;
    let limit = lines[line - 1] !== undefined && lines[line - 1]!.trim() ? indent(lines[line - 1]!) : Infinity;
    for (let i = line - 1; i >= 0; i--) {
        const text = lines[i]!;
        if (!text.trim()) continue;
        const def = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(text);
        // The selected line may be the def itself.
        if (def && (i === line - 1 || indent(text) < limit)) return {name: def[1]!, line: i + 1};
        limit = Math.min(limit, indent(text));
        if (limit === 0 && !def) return null;
    }
    return null;
}

export interface CodeContext {
    /** The selection: lines first–last of the file and their text, or first 0 when nothing is selected. */
    path: string; source: string; first: number; last: number; excerpt: string;
    executing: number[]; waitingCalls: number[]; scene: string; step: number; values: Record<string, unknown>;
    /** The file's teaching structure (code-sections.ts sectionsOutline), when it has one. */
    sections?: string;
    /** The active code (the top-level block running now, else the one holding the selection): the answer is about it only. */
    active?: {from: number; to: number};
}

/** The message for one prompt: the request, then the code and the state it is about. */
export function codePromptMessage(prompt: CodePrompt, c: CodeContext): string {
    const lines = c.source.split('\n');
    const number = (text: string, i: number) => `${String(i + 1).padStart(3)}  ${text}`;
    const numbered = lines.map(number).join('\n');
    const active = c.active && (c.active.from > 1 || c.active.to < lines.length) ? c.active : null;
    const owner = active ? enclosingFunction(c.source, active.from) : null;
    const fn = c.first ? enclosingFunction(c.source, c.first) : null;
    return [
        prompt.prompt,
        ...(active ? [
            `Answer only for the active code: lines ${active.from}–${active.to}${owner ? `, ${owner.name}()` : ''}. The rest of the file is context; do not analyze, count or include it in the answer.`,
            `Active code:\n${lines.slice(active.from - 1, active.to).map((text, i) => number(text, active.from - 1 + i)).join('\n')}`,
        ] : []),
        '',
        `File: ${c.path} (shown, not executed)`,
        ...(c.first ? [
            `Selected: ${c.first === c.last ? `line ${c.first}` : `lines ${c.first}–${c.last}`}${fn ? `, inside ${fn.name}() (line ${fn.line})` : ''}`,
            `Selected text:\n${c.excerpt}`,
        ] : ['Nothing is selected: the question is about the active code as a whole.']),
        ...(c.sections ? [`The code's sections (its teaching structure; explain in these terms):\n${c.sections}`] : []),
        `Executing now: ${c.executing.length ? `line ${c.executing.join(', ')}` : 'no line marked'}`,
        `Calls waiting to return (call-site lines, outermost first): ${c.waitingCalls.length ? c.waitingCalls.join(', ') : 'none'}`,
        `Scene: ${c.scene}, step ${c.step}`,
        `Scalar variables: ${JSON.stringify(c.values)}`,
        `${active ? 'Full source (context only)' : 'Full source'}:\n${numbered}`,
    ].join('\n');
}
