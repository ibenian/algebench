/**
 * Code symbols: the variables in a lesson's code files and where they appear, shared by the Code panel and
 * the 3D view. The server analyzes a file (backend/code_intel, Python via `ast`); this module caches the
 * result and carries two signals between the views, keyed by an expression's whitespace-free source text
 * (`temps[stack[-1]]`), which is exactly what a label or marker row shows left of ` = `:
 *
 * - hover: pointing at a variable in the code, or at a row naming it, lights every occurrence of it in the
 *   open file and every row that names it (`algebench:symbolhover`). A row with a code reference (codeRef)
 *   is tied to its line the same way: pointing at the row lights the line, pointing at the line lights the row;
 * - flash: a value that just changed briefly lights its variable on the executing line (`algebench:symbolflash`).
 */
export interface CodeReference {
    key: string; root: string; kind: 'name' | 'subscript' | 'attribute'; store: boolean;
    line: number; col: number; endLine: number; endCol: number;
}
/**
 * A function the file defines (the name's span on its def line), or a call to one by name and the def it reaches,
 * keyed by the whole call's source without spaces (`h(start)`), as a trace's returns name its value.
 */
export interface CodeFunction { name: string; line: number; col: number; endCol: number }
export interface CodeCall extends CodeFunction { defLine: number; key?: string }
/**
 * Where a variable of one top-level function (lines from–to; 0–0 for the module's own code) is read, updated,
 * grown and shrunk: `count.get(k)` reads, `count[k] = v` updates (and grows a dict), `stack.pop()` updates and shrinks.
 */
export type CodeUseKind = 'read' | 'update' | 'grow' | 'shrink';
/** One mention of a variable: its line, what it does to it, how (`add-key`, `method:append`, …) and the code doing it. */
export interface CodeUseNote { line: number; kinds: CodeUseKind[]; how: string; code: string }
export interface CodeUse { name: string; from: number; to: number; read: number[]; update: number[]; grow: number[]; shrink: number[]; notes?: CodeUseNote[] }

const METHOD_DOES: Record<string, string> = {
    append: 'adds an item at its end', appendleft: 'adds an item at its front', extend: 'adds every item of another collection at its end',
    extendleft: 'adds every item of another collection at its front', insert: 'inserts an item at a position', add: 'adds an element (unless it is already there)',
    setdefault: 'adds the key with a default value if it is missing', update: 'adds or replaces entries from another collection',
    pop: 'removes an item and gives it back (the last one, or the one at the given index or key)', popleft: 'removes its first item and gives it back',
    popitem: 'removes an entry and gives it back', remove: 'removes the first item equal to the value', discard: 'removes the element if it is there',
    clear: 'removes everything', sort: 'sorts it in place', reverse: 'reverses it in place', rotate: 'rotates it in place',
    heappush: 'pushes an item onto the heap, which grows by one', heappop: 'pops the smallest item off the heap, which shrinks by one',
    heapify: 'rearranges it into a heap', heappushpop: 'pushes an item, then pops the smallest', heapreplace: 'pops the smallest, then pushes an item',
};

/** What one mention does to the variable `name`, in a sentence (markdown, the code in backticks). */
export function useSentence(name: string, note: CodeUseNote): string {
    const n = `\`${name}\``, code = `\`${note.code}\``;
    const [how, detail = ''] = note.how.split(':');
    switch (how) {
        case 'bind': return `${code} gives ${n} a new value.`;
        case 'loop': return `${n} takes the next item each time round the loop.`;
        case 'augment': return `${code} reads ${n}'s value and updates it from it.`;
        case 'delete': return `\`del ${name}\` deletes ${n}.`;
        case 'set-item': return `${code} = … replaces one item of ${n}; its size stays the same.`;
        case 'add-key': return `${code} = … sets the entry for that key: if ${n} does not have the key yet it gains an entry (grows), otherwise its value is replaced.`;
        case 'augment-item': return `${code} reads one entry of ${n} and updates it; its size stays the same.`;
        case 'delete-item': return `\`del ${note.code}\` removes one entry of ${n}, which shrinks.`;
        case 'set-attr': return `${code} = … changes a field of ${n}.`;
        case 'inside': return `${code} changes something held inside ${n}, not ${n}'s own size.`;
        case 'method': case 'heap': return `${code} ${METHOD_DOES[detail] ?? 'changes it'}.`;
        default: return note.code === name ? `Uses the value of ${n} without changing it.` : `${code} reads ${n} without changing it.`;
    }
}
export interface CodeAnalysis { variables: string[]; references: CodeReference[]; functions?: CodeFunction[]; calls?: CodeCall[]; uses?: CodeUse[]; error: string | null }

/** The uses of the variable `name` as seen from `line`: those of the function holding it, else the module's. */
export function usesAt(uses: readonly CodeUse[], name: string, line: number): CodeUse | null {
    return uses.find(u => u.name === name && u.from > 0 && u.from <= line && line <= u.to)
        ?? uses.find(u => u.name === name && u.from === 0) ?? null;
}

/**
 * The def or class starting on `line` (1-based), with its decorators and its body: the lines up to the next one
 * indented no deeper than its header. Null when the line starts no definition.
 */
export function definitionAt(source: string, line: number): {name: string; from: number; to: number} | null {
    const lines = source.split('\n');
    const head = /^(\s*)(?:async\s+)?(?:def|class)\s+(\w+)/.exec(lines[line - 1] ?? '');
    if (!head) return null;
    const indent = head[1]!.length, depth = (text: string) => text.length - text.trimStart().length;
    let from = line;
    while (from > 1 && lines[from - 2]!.trimStart().startsWith('@') && depth(lines[from - 2]!) === indent) from--;
    let to = line;
    for (let i = line; i < lines.length; i++) {
        const text = lines[i]!;
        if (!text.trim()) continue;
        if (depth(text) <= indent) break;
        to = i + 1;
    }
    return {name: head[2]!, from, to};
}

const analyses = new Map<string, Promise<CodeAnalysis | null>>();

/** The analyzer language for a file, or null when there is none for it. */
export function codeLanguage(file: {path: string; language?: string}): string | null {
    const language = file.language?.toLowerCase();
    return language === 'python' || (!language && /\.py$/i.test(file.path)) ? 'python' : null;
}

/** The file's analysis, fetched once per distinct source; null when unavailable (no analyzer, offline, error). */
export function analyzeCode(file: {path: string; language?: string; source: string}): Promise<CodeAnalysis | null> {
    const language = codeLanguage(file);
    if (!language) return Promise.resolve(null);
    const cacheKey = language + '\0' + file.source;
    let pending = analyses.get(cacheKey);
    if (!pending) {
        pending = fetch('/api/code/analyze', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({language, source: file.source})})
            .then(res => res.ok ? res.json() as Promise<CodeAnalysis> : null)
            .catch(() => null);
        analyses.set(cacheKey, pending);
    }
    return pending;
}

export const symbolKey = (text: string): string => text.replace(/\s+/g, '');
const EXPRESSION = /^[A-Za-z_][\w.]*(\[[^\]]*\]|\.[A-Za-z_]\w*)*\]*$/;

/**
 * The symbols a label or marker row names: everything left of its last ` = `. A marker row can merge names
 * (`i = j = 3`), so there may be several. Rows that are not `name = value` (conditions) name none.
 */
export function rowSymbolKeys(text: string): string[] {
    const parts = text.split(' = ');
    // Words separated by spaces (`top slot`) are a display name, not code.
    return parts.length < 2 ? [] : parts.slice(0, -1).filter(name => !/\w\s+\w/.test(name)).map(symbolKey).filter(key => EXPRESSION.test(key));
}

/** The references on one line, outermost first, so nested expressions wrap inside their parents. */
export function lineReferences(references: CodeReference[], line: number): CodeReference[] {
    return references.filter(r => r.line === line && r.endLine === line)
        .sort((a, b) => a.col - b.col || (b.endCol - b.col) - (a.endCol - a.col));
}

/** A code line, as a row's codeRef resolves it: `fileId:line`. */
export const codeLineKey = (fileId: string, line: number): string => `${fileId}:${line}`;

let hovered: string[] = [];
let hoveredLine: string | null = null;
/** Set (or clear, with an empty list and no line) the symbols and the code line being pointed at. */
export function setSymbolHover(keys: string[], line: string | null = null): void {
    if (line === hoveredLine && keys.length === hovered.length && keys.every((k, i) => k === hovered[i])) return;
    hovered = keys; hoveredLine = line;
    window.dispatchEvent(new CustomEvent('algebench:symbolhover', {detail: {keys, line}}));
}
export const hoveredSymbols = (): readonly string[] => hovered;
export const hoveredCodeLine = (): string | null => hoveredLine;

/**
 * What objects in the scene hold for a symbol right now (an array's cells as `[1, 2, 3]`), for the Code panel's
 * inline values. Each source reads its value on demand and answers null while it is not shown.
 */
const valueSources = new Map<string, Set<() => string | null>>();
export function registerSymbolValue(key: string, read: () => string | null): () => void {
    let set = valueSources.get(key);
    if (!set) valueSources.set(key, set = new Set());
    set.add(read);
    return () => { set!.delete(read); if (!set!.size) valueSources.delete(key); };
}
export function symbolValues(key: string): string[] {
    return [...valueSources.get(key) ?? []].map(read => read()).filter((v): v is string => v !== null);
}

/** Briefly light these symbols where they are executing (keys or bare variable names). */
export function flashSymbols(keys: string[]): void {
    if (keys.length) window.dispatchEvent(new CustomEvent('algebench:symbolflash', {detail: {keys}}));
}

/** Make a label/marker row take part in symbol hover: pointing at it lights its symbols (and its code line,
 * when it has a codeRef) in the code, and the code's hover lights it. Rows are rebuilt as values and lines
 * change, so a new row picks up the current hover. */
export function bindSymbolRow(row: HTMLElement, text: string, code?: {fileId: string; line: number} | null): void {
    const keys = rowSymbolKeys(text);
    const line = code ? codeLineKey(code.fileId, code.line) : null;
    if (!keys.length && !line) return;
    listenForRows();
    if (keys.length) row.dataset.symbols = keys.join('\n');
    if (line) row.dataset.codeLine = line;
    paintRow(row);
    row.addEventListener('pointerenter', () => setSymbolHover(keys, line));
    row.addEventListener('pointerleave', () => setSymbolHover([]));
}
function paintRow(row: HTMLElement): void {
    const lit = (row.dataset.symbols?.split('\n').some(k => hovered.includes(k)) ?? false)
        || (hoveredLine !== null && row.dataset.codeLine === hoveredLine);
    row.classList.toggle('annotation-row-symbol-hover', lit);
}

// Registered on first use, not at import: modules load in tests without a browser window.
let listening = false;
function listenForRows(): void {
    if (listening) return;
    listening = true;
    window.addEventListener('algebench:symbolhover', () => {
        document.querySelectorAll<HTMLElement>('.annotation-row[data-symbols], .annotation-row[data-code-line]').forEach(paintRow);
    });
}
