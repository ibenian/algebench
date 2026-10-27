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
export interface CodeAnalysis { variables: string[]; references: CodeReference[]; functions?: CodeFunction[]; calls?: CodeCall[]; error: string | null }

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
