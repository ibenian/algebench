/**
 * A dictionary key as Python prints it, for the label under its cell: a string quoted ('a'), a number as is,
 * a tuple in parentheses ((1, 2); a one-element tuple keeps its comma, (1,)), True / False / None. A key may be
 * any of these, so a dict shows keys exactly where an array shows indices.
 */
export function keyText(key: unknown): string {
    const plain = key !== null && typeof key === 'object' && 'valueOf' in key ? (key as {valueOf(): unknown}).valueOf() : key;
    if (Array.isArray(plain)) return plain.length === 1 ? `(${keyText(plain[0])},)` : `(${plain.map(keyText).join(', ')})`;
    if (typeof plain === 'string') return `'${plain.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    if (typeof plain === 'boolean') return plain ? 'True' : 'False';
    if (plain === null || plain === undefined) return 'None';
    if (typeof plain === 'number') return Number.isFinite(plain) ? String(plain) : plain > 0 ? "float('inf')" : plain < 0 ? "float('-inf')" : "float('nan')";
    return String(plain);
}

/**
 * keyIndex(keys, key): where a key sits in a dict's list of keys (its entry's position), or −1 when absent.
 * Keys match as Python would compare them: 2 and '2' differ, tuples match element by element. A link or
 * marker names a dict entry by position, so this turns "the entry for key k" into one.
 */
export function keyIndex(keys: unknown, key: unknown): number {
    const plain = keys !== null && typeof keys === 'object' && 'valueOf' in keys ? (keys as {valueOf(): unknown}).valueOf() : keys;
    if (!Array.isArray(plain)) return -1;
    const wanted = keyText(key);
    return plain.findIndex(k => keyText(k) === wanted);
}
