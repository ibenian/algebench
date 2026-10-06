/** Presentation-only grouping. No renderer reads another renderer's state. */
export interface AnnotationValue {
    text: string;
    index?: { group: string; name: string; value: number };
}
export interface AnnotationBox extends AnnotationValue {
    x: number; y: number; width: number; height: number;
    kind: 'marker' | 'label';
}
export function annotationText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
    // math.js matrices expose a JSON-friendly array through valueOf.
    const plain = typeof value === 'object' && value !== null ? value.valueOf() : value;
    return JSON.stringify(plain) ?? String(value);
}
export function annotationRows(items: AnnotationValue[]): string[] {
    const rows: string[] = [];
    const indexes = new Map<string, { row: number; names: string[]; value: number }>();
    for (const item of items) {
        if (!item.index) { rows.push(item.text); continue; }
        const {group, name, value} = item.index;
        const key = JSON.stringify([group, value]);
        const existing = indexes.get(key);
        if (existing) {
            if (!existing.names.includes(name)) existing.names.push(name);
            rows[existing.row] = [...existing.names, String(value)].join(' = ');
        } else {
            indexes.set(key, {row: rows.length, names: [name], value});
            rows.push(`${name} = ${value}`);
        }
    }
    return rows;
}
export function annotationGroups(items: AnnotationBox[]): number[][] {
    const parent = items.map((_, i) => i);
    const root = (i: number): number => {
        while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; }
        return i;
    };
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!, b = items[j]!;
        if (a.kind !== b.kind) continue;
        const sameIndex = a.index && b.index && a.index.group === b.index.group && a.index.value === b.index.value;
        const overlaps = Math.abs(a.x-b.x) < (a.width+b.width)/2 && Math.abs(a.y-b.y) < (a.height+b.height)/2;
        if (sameIndex || overlaps) parent[root(j)] = root(i);
    }
    const groups = new Map<number, number[]>();
    items.forEach((_, i) => { const r=root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(i); });
    return [...groups.values()];
}
