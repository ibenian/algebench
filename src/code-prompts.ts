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

/**
 * The ✦ in a code tooltip: the tutor explains one thing at once (a function, parameter or variable, a documented
 * expression or block), building on the file's own note about it when there is one.
 */
export function explainPrompt(subject: string, note: string | null): CodePrompt {
    return {label: 'Explain this', line: true, prompt: `Explain ${subject} in the selected code: what it is, what it does here and why it is needed, using the values on screen right now. Keep it short and about this alone.${note ? `\nThe code's own note about it:\n${note}` : ''}`};
}

/**
 * The ✦ on a node of the execution tree: the tutor comments on that step of the run through the code's structure,
 * for an intuition of its cost. `facts` says what the node is and where it sits in the run's tree.
 */
export function execNodePrompt(facts: { kind: 'call' | 'loop'; label: string; path: string[]; iteration: number | null;
    iterations: number; totalIterations: number; children: number; done: boolean; future?: boolean; run: string; whole: string }): CodePrompt {
    const what = facts.future
        ? `the ${facts.kind} \`${facts.label}\`, which the run has not reached yet${facts.kind === 'loop' ? ` (it will run ${facts.totalIterations} iteration${facts.totalIterations === 1 ? '' : 's'})` : ''}`
        : facts.kind === 'call'
        ? `the call \`${facts.label}\`${facts.done ? ' (it has returned)' : ''}, which made ${facts.children} call${facts.children === 1 ? '' : 's'} or loop${facts.children === 1 ? '' : 's'} so far`
        : `the loop \`${facts.label}\`, at iteration ${facts.iterations} of ${facts.totalIterations}${facts.done ? ' (it has ended)' : ''}`;
    return {label: 'Explain this step of the run', line: true, prompt: `This is a node of the run's execution tree: ${what}${facts.iteration ? `, made in iteration ${facts.iteration} of the loop above it` : ''}.
Its path from the first call: ${facts.path.join(' → ')}.
The tree so far: ${facts.run}. The whole run: ${facts.whole}.
Comment on this step in the context of the code's structure (the selected lines are the function or loop it stands for): why the run is (or will be) here, what this node does for the result, and what it says about the cost. Give an intuition for the complexity: how the number of nodes like it grows with the input (branching factor, depth, loop length, repeated work), and what that means for the running time. Keep it short and concrete, using this run's numbers.`};
}

/**
 * The ✦ on the execution tree's repeated-calls alert: the tutor recommends how to stop doing the same work again,
 * and what it would cost after.
 */
export function repeatedCallsPrompt(groups: { label: string; count: number }[], extra: number, whole: string): CodePrompt {
    const list = groups.map(g => `${g.label} ×${g.count}`).join(', ');
    return {label: 'How do I avoid the repeated work?', line: true, prompt: `The run's execution tree shows calls made more than once with the same arguments: ${list} (${extra} call${extra === 1 ? '' : 's'} repeated; the whole run: ${whole}).
Recommend how to improve the code so each distinct call is computed once: say why the repetition happens in this code's structure, name the technique (memoization, a bottom-up table, or another that fits better), show the changed code (the selected lines are the function that repeats), and compare the complexity before and after, using this run's numbers and how they grow with the input. Keep it short.`};
}

/** The ✦ on each code line: a question about that line alone. */
export const LINE_PROMPT: CodePrompt = {label: 'Ask about this line', line: true, prompt: 'Explain the selected line: what it does at this point in the algorithm and why it is needed, using the values on screen right now. Keep it to this line.'};

/** The ✦ after a line's values: the line explained through the values shown on it (appended to the prompt). */
export const LINE_VALUES_PROMPT: CodePrompt = {label: 'Explain this line with its values', line: true, prompt: "Explain the selected line in the context of the expressions and values shown on it right now: what each one says at this state, how they relate, and what the line does with them. Keep it to this line. The values shown on it:"};

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
