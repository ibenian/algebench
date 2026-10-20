/**
 * Syntax colouring for the Code panel. The server lexes a file with Pygments (backend/code_highlight.py) and
 * returns coloured ranges: a kind (keyword, string, comment, …) over a line's columns, in UTF-16 units, the
 * units the line's text is indexed by here. The panel draws a line's text first; paintTokens then wraps each
 * range in a `code-tok-<kind>` span, splitting text nodes as needed, so it composes with spans already there
 * (a lesson's marks) and with anything that wraps column ranges afterwards. Colours are theme variables
 * (--code-<kind>, static/tokens.css).
 */
export interface CodeToken { line: number; col: number; endCol: number; kind: string }

const cache = new Map<string, Promise<CodeToken[]>>();

/** The file's coloured ranges, fetched once per language and source; none when unavailable (offline, unknown language). */
export function highlightCode(file: {language?: string; source: string}): Promise<CodeToken[]> {
    const language = file.language?.trim().toLowerCase();
    if (!language) return Promise.resolve([]);
    const key = `${language}\n${file.source}`;
    let pending = cache.get(key);
    if (!pending) {
        pending = fetch('/api/code/highlight', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({language, source: file.source})})
            .then(res => res.ok ? res.json() : null)
            .then((body: {tokens?: CodeToken[]} | null) => Array.isArray(body?.tokens) ? body!.tokens : [])
            .catch(() => []);
        cache.set(key, pending);
    }
    return pending;
}

/** One line's ranges, in order. */
export function lineTokens(tokens: readonly CodeToken[], line: number): CodeToken[] {
    return tokens.filter(t => t.line === line && t.endCol > t.col).sort((a, b) => a.col - b.col);
}

/**
 * Wrap columns [from, to) of an element's text in elements made by `make`, splitting text nodes at the edges.
 * A range crossing existing spans gets one wrapper per text node it covers, so the existing structure stays.
 */
export function wrapColumns(root: HTMLElement, from: number, to: number, make: () => HTMLElement): void {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const pieces: {node: Text; a: number; b: number}[] = [];
    let offset = 0;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const start = offset, end = offset + node.data.length;
        offset = end;
        const a = Math.max(from, start), b = Math.min(to, end);
        if (a < b) pieces.push({node, a: a - start, b: b - start});
    }
    for (const {node, a, b} of pieces) {
        const target = node.splitText(a);
        target.splitText(b - a);
        const wrapper = make();
        target.replaceWith(wrapper);
        wrapper.append(target);
    }
}

/** Colour one rendered line (`code` holds its text) with that line's ranges. */
export function paintTokens(code: HTMLElement, tokens: readonly CodeToken[]): void {
    for (const t of tokens) wrapColumns(code, t.col, t.endCol, () => {
        const span = code.ownerDocument.createElement('span');
        span.className = `code-tok code-tok-${t.kind}`;
        return span;
    });
}
