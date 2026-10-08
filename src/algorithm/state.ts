/** Semantic algorithm state and comparison, independent of rendering and clocks. */
import type { AlgorithmSnapshot } from '/types/lesson.js';
export type { AlgorithmSnapshot } from '/types/lesson.js';
export interface Location { array: string; index: number }
export interface Change<T> { before: T | null; after: T | null }
export interface AlgorithmChanges {
    entities: Record<string, Change<number>>;
    moves: Record<string, Change<Location>>;
    variables: Record<string, Change<AlgorithmSnapshot['variables'][string]>>;
    references: Record<string, Change<{ array: string; index: number; entity: string | null }>>;
    relations: Record<string, Change<AlgorithmSnapshot['relations'][number]>>;
    execution: Change<AlgorithmSnapshot['execution']> | null;
}
function equal(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
    return Object.keys(x).length === Object.keys(y).length
        && Object.keys(x).every(k => Object.hasOwn(y, k) && equal(x[k], y[k]));
}
function compare<T>(a: Record<string, T>, b: Record<string, T>): Record<string, Change<T>> {
    const out: Record<string, Change<T>> = {};
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (!equal(a[id], b[id])) out[id] = { before: a[id] ?? null, after: b[id] ?? null };
    }
    return out;
}
export function locations(s: AlgorithmSnapshot): Record<string, Location> {
    return Object.fromEntries(Object.entries(s.arrays).flatMap(([array, ids]) => ids.map((id, index) => [id, { array, index }])));
}
export function references(s: AlgorithmSnapshot) {
    return Object.fromEntries(Object.entries(s.variables).flatMap(([name, variable]) => {
        if (!variable.reference) return [];
        const array = variable.reference.array, index = variable.value;
        return [[name, { array, index, entity: s.arrays[array]?.[index] ?? null }]];
    }));
}
/** Identity, never value or position, establishes correspondence between states. */
export function compareStates(before: AlgorithmSnapshot, after: AlgorithmSnapshot): AlgorithmChanges {
    return {
        entities: compare(Object.fromEntries(Object.entries(before.entities).map(([id,e]) => [id,e.value])), Object.fromEntries(Object.entries(after.entities).map(([id,e]) => [id,e.value]))),
        moves: compare(locations(before), locations(after)),
        variables: compare(before.variables, after.variables),
        references: compare(references(before), references(after)),
        relations: compare(Object.fromEntries(before.relations.map(r => [r.id,r])), Object.fromEntries(after.relations.map(r => [r.id,r]))),
        execution: equal(before.execution, after.execution) ? null : { before: before.execution, after: after.execution },
    };
}
/** Cross-field integrity checks supplement the authoring schema. */
export function validateSnapshot(s: AlgorithmSnapshot): void {
    const seen = new Set<string>();
    for (const ids of Object.values(s.arrays)) for (const id of ids) {
        if (!s.entities[id] || seen.has(id)) throw new Error(`Invalid or repeated entity: ${id}`);
        seen.add(id);
    }
    for (const [name, v] of Object.entries(s.variables)) {
        if (!Number.isFinite(v.value)) throw new Error(`Non-finite variable: ${name}`);
        if (v.reference && (!Number.isInteger(v.value) || !s.arrays[v.reference.array]?.[v.value])) throw new Error(`Invalid reference: ${name}`);
    }
    const relations = new Set<string>();
    for (const r of s.relations) {
        if (relations.has(r.id) || !s.entities[r.from] || !s.entities[r.to]) throw new Error(`Invalid relation: ${r.id}`);
        relations.add(r.id);
    }
    for (const id of s.execution.operands) if (!s.entities[id]) throw new Error(`Invalid operand: ${id}`);
}
export function snapshotIndex(value: number, count: number): number {
    return Math.max(0, Math.min(count - 1, Number.isFinite(value) ? Math.round(value) : 0));
}
/** Position interpolation is presentation-only; the destination is exact at t=1. */
export function interpolate(from: readonly number[], to: readonly number[], t: number): [number, number, number] {
    const u = Math.max(0, Math.min(1, t));
    const eased = u * u * (3 - 2 * u);
    return [0,1,2].map(i => (from[i] ?? 0) + ((to[i] ?? 0) - (from[i] ?? 0)) * eased) as [number,number,number];
}
/** Deterministic execution: record full states, including comparison-only states. */
export function heapInsertionSnapshots(values: readonly number[], key: number, array = 'heap'): AlgorithmSnapshot[] {
    if (!values.length || values.length > 15 || ![...values,key].every(Number.isFinite)) throw new Error('Use 1–15 finite starting values.');
    if (values.some((v,i) => i > 0 && v < values[Math.floor((i-1)/2)]!)) throw new Error('Starting array is not a min-heap: each parent must be ≤ its children. Edit the values to restore this rule.');
    const ids = values.map((_,i) => `item-${i}`), entities = Object.fromEntries(values.map((value,i)=>[`item-${i}`,{value}]));
    const snapshots: AlgorithmSnapshot[] = [];
    const record = (phase: string, i: number | null, p: number | null, operands: string[] = []) => {
        const variables: AlgorithmSnapshot['variables'] = {key:{value:key}, n:{value:ids.length}};
        if (i !== null) variables.i = {value:i,reference:{array}};
        if (p !== null) variables.p = {value:p,reference:{array}};
        snapshots.push(structuredClone({entities,arrays:{[array]:ids},variables,
            relations:ids.slice(1).map((id,k)=>({id:`parent-of-${id}`,from:ids[Math.floor(k/2)]!,to:id,kind:'parent'})),execution:{phase,operands}}));
    };
    record(`Ready · insert ${key}`,null,null);
    ids.push('inserted'); entities.inserted = {value:key};
    let i = ids.length - 1;
    record(`Append ${key} · next free slot ${i}`,i,Math.floor((i-1)/2));
    while (i > 0) {
        const p = Math.floor((i-1)/2), child = ids[i]!, parent = ids[p]!;
        const parentValue = entities[parent]!.value;
        record(`Compare · ${key} < ${parentValue} ? ${key < parentValue ? 'yes' : 'no'}`,i,p,[child,parent]);
        if (key >= parentValue) break;
        [ids[i],ids[p]] = [parent,child]; i = p;
        record(`Swap upward · ${key} moves to slot ${i}`,i,i > 0 ? Math.floor((i-1)/2) : null);
    }
    record(i === 0 ? 'Done · root reached' : 'Done · parent is already ≤ the new value',i,i > 0 ? Math.floor((i-1)/2) : null);
    return snapshots;
}
