/**
 * Watch expressions (code-panel.ts): a piece of code the reader selects, such as `1 - color[u]` or
 * `len(queue) > 0`, evaluated against the recorded run at the current frame. The code is Python; it is
 * translated into a math.js expression over the step's trace table (each name becomes that column at the
 * current frame) and then evaluated in the sandbox like any lesson expression. Pure, so it is testable.
 */

/** Why a selection can't be watched, in words for the reader. */
export class WatchError extends Error {}

type Tok = { kind: 'num' | 'str' | 'name' | 'op'; text: string };

const OPS = ['**', '//', '==', '!=', '<=', '>=', '+', '-', '*', '/', '%', '<', '>', '(', ')', '[', ']', ',', '='];

function tokenize(src: string): Tok[] {
    const out: Tok[] = [];
    for (let i = 0; i < src.length;) {
        const ch = src[i]!;
        if (/\s/.test(ch)) { i++; continue; }
        const num = /^\d+(\.\d+)?/.exec(src.slice(i));
        if (num) { out.push({kind: 'num', text: num[0]}); i += num[0].length; continue; }
        const name = /^[A-Za-z_]\w*/.exec(src.slice(i));
        if (name) { out.push({kind: 'name', text: name[0]}); i += name[0].length; continue; }
        if (ch === '"' || ch === "'") {
            const end = src.indexOf(ch, i + 1);
            if (end < 0) throw new WatchError('A string is not closed.');
            out.push({kind: 'str', text: src.slice(i + 1, end)}); i = end + 1; continue;
        }
        const op = OPS.find(o => src.startsWith(o, i));
        if (!op && ch === '.') throw new WatchError('Methods and attributes (".") can\'t be watched yet: select a variable or an expression of them.');
        if (!op) throw new WatchError(`"${ch}" can't be watched.`);
        out.push({kind: 'op', text: op}); i += op.length;
    }
    return out;
}

/** Python functions a watch may call, and what they become. */
const CALLS: Record<string, (args: string[]) => string> = {
    len: a => `arrayCount(${a[0]})`,
    abs: a => `abs(${a[0]})`,
    min: a => `min(${a.join(', ')})`,
    max: a => `max(${a.join(', ')})`,
};

/**
 * The math.js expression for a Python expression, each name read from `table` at the current frame. `names` are
 * the columns the table has; `fixed` gives the expression for names that never change and live elsewhere (the
 * scene's inputs). Any other name is refused, naming the `shown` ones (the code's own variables), so a typo says what exists.
 */
export function watchExpr(python: string, table: string, names: readonly string[], shown: readonly string[] = names,
    fixed: Readonly<Record<string, string>> = {}): string {
    if (/(^|[^=!<>])=(?!=)/.test(python)) throw new WatchError('That is an assignment: select the expression on its right.');
    const toks = tokenize(python);
    if (!toks.length) throw new WatchError('Select an expression to watch.');
    let k = 0;
    const peek = () => toks[k], next = () => toks[k++];
    const isOp = (t: string) => peek()?.kind === 'op' && peek()!.text === t;
    const isWord = (t: string) => peek()?.kind === 'name' && peek()!.text === t;
    const expect = (t: string) => { if (!isOp(t)) throw new WatchError(`Expected "${t}".`); k++; };

    function atom(): string {
        const t = next();
        if (!t) throw new WatchError('The expression ends too soon.');
        if (t.kind === 'num') return t.text;
        if (t.kind === 'str') return `'${t.text.replace(/'/g, "\\'")}'`;
        if (t.kind === 'op' && t.text === '(') { const e = or();expect(')');return `(${e})`; }
        if (t.kind === 'op' && t.text === '[') {
            const items: string[] = [];
            while (!isOp(']')) { items.push(or());if (!isOp(']')) expect(','); }
            k++;return `[${items.join(', ')}]`;
        }
        if (t.kind === 'name') {
            if (t.text === 'True') return 'true';
            if (t.text === 'False') return 'false';
            if (CALLS[t.text] && isOp('(')) {
                k++;
                const args: string[] = [];
                while (!isOp(')')) { args.push(or());if (!isOp(')')) expect(','); }
                k++;return CALLS[t.text]!(args);
            }
            if (!names.includes(t.text) && Object.hasOwn(fixed, t.text)) return fixed[t.text]!;
            if (!names.includes(t.text)) throw new WatchError(`"${t.text}" isn't recorded at this step. It has: ${shown.join(', ')}.`);
            return `dataTable('${table}', frame, '${t.text}')`;
        }
        throw new WatchError(`"${t.text}" is out of place.`);
    }
    function postfix(): string {
        let e = atom();
        while (isOp('[')) { k++;const i = or();expect(']');e = `arrayAt(${e}, ${i})`; }
        return e;
    }
    function power(): string { const b = postfix();if (isOp('**')) { k++;return `(${b}) ^ (${unary()})`; }return b; }
    function unary(): string { if (isOp('-')) { k++;return `-(${unary()})`; }if (isOp('+')) { k++;return unary(); }return power(); }
    function term(): string {
        let e = unary();
        for (;;) {
            if (isOp('//')) { k++;e = `floor((${e}) / (${unary()}))`; }
            else if (isOp('*') || isOp('/') || isOp('%')) { const op = next()!.text;e = `${e} ${op === '%' ? 'mod' : op} ${unary()}`; }
            else return e;
        }
    }
    function sum(): string { let e = term();while (isOp('+') || isOp('-')) { const op = next()!.text;e = `${e} ${op} ${term()}`; }return e; }
    // `x in d` (and `not in`): x is one of a list's items, or one of a dict's keys when the run records the dict as
    // its list of keys.
    const isNotIn = () => isWord('not') && toks[k + 1]?.kind === 'name' && toks[k + 1]!.text === 'in';
    function compare(): string {
        let e = sum();
        for (;;) {
            if (['==', '!=', '<', '>', '<=', '>='].some(isOp)) { const op = next()!.text;e = `${e} ${op} ${sum()}`; }
            else if (isWord('in')) { k++;e = `keyIndex(${sum()}, ${e}) >= 0`; }
            else if (isNotIn()) { k += 2;e = `keyIndex(${sum()}, ${e}) < 0`; }
            else return e;
        }
    }
    function not(): string { if (isWord('not')) { k++;return `not (${not()})`; }return compare(); }
    function and(): string { let e = not();while (isWord('and')) { k++;e = `${e} and ${not()}`; }return e; }
    function or(): string { let e = and();while (isWord('or')) { k++;e = `${e} or ${and()}`; }return e; }

    const out = or();
    if (k < toks.length) throw new WatchError(isOp('=') ? 'That is an assignment: select the expression on its right.' : `"${peek()!.text}" is out of place.`);
    return out;
}

/** A watched value as Python prints it: lists in brackets, True and False. */
export function formatWatch(value: unknown): string {
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
    if (Array.isArray(value)) return `[${value.map(formatWatch).join(', ')}]`;
    if (value && typeof value === 'object' && 'toArray' in value) return formatWatch((value as {toArray(): unknown}).toArray());
    if (typeof value === 'string') return `'${value}'`;
    return String(value);
}

/**
 * A codeRef's returnsExpr value as a map from a call's key (its source without spaces, `h(start)`) to what it
 * returned; anything that is not such a map (no entry this frame, a bad expression) is none.
 */
export function callReturns(value: unknown): Map<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || 'toArray' in value) return new Map();
    return new Map(Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null));
}

/** `h(start) → 6`: a call and the value it returned. */
export const returnText = (key: string, value: unknown): string => `${key} → ${formatWatch(value)}`;

/** The condition an `if`, `elif` or `while` line tests (its trailing comment dropped), or null for any other line. */
export function conditionOf(line: string): string | null {
    const m = /^\s*(?:if|elif|while)\s+(.+?)\s*:\s*(?:#.*)?$/.exec(line);
    return m ? m[1]! : null;
}

/** A condition's value as Python would test it: empty lists and zero are false. Null when it isn't one of those. */
export function truthOf(value: unknown): boolean | null {
    if (value && typeof value === 'object' && 'toArray' in value) return truthOf((value as {toArray(): unknown}).toArray());
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isNaN(value) ? null : value !== 0;
    if (typeof value === 'string' || Array.isArray(value)) return value.length > 0;
    return null;
}
