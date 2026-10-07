/** Immutable array operations for state-driven visualizations. All indices are zero-based. */
export type ArrayPrimitive = number | string | boolean | null;
export interface ArrayOperationSnapshot {
    values: ArrayPrimitive[];
    result: ArrayPrimitive | ArrayPrimitive[];
    changed: number[];
}
export function primitiveArray(input: unknown): ArrayPrimitive[] {
    // math.js vector literals arrive as matrices; data tables already contain arrays.
    const values = input && typeof input === 'object' && 'toArray' in input && typeof input.toArray === 'function'
        ? input.toArray() : input;
    if (!Array.isArray(values) || values.length > 256) throw new Error('Expected a one-dimensional array of at most 256 cells.');
    for (const value of values) if (!(value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))))
        throw new Error('Array cells must be finite numbers, strings, booleans, or null.');
    return values.slice();
}
function index(input: unknown, length: number, allowEnd = false): number {
    if (typeof input !== 'number' || !Number.isInteger(input) || input < 0 || input >= length + (allowEnd ? 1 : 0))
        throw new Error('Array index is outside its bounds.');
    return input;
}
function primitive(value: unknown): ArrayPrimitive { return primitiveArray([value])[0]!; }
export function arrayOperation(input: unknown, operation: string, a: unknown = undefined, b: unknown = undefined): ArrayOperationSnapshot {
    const before = primitiveArray(input), values = before.slice();
    let result: ArrayPrimitive | ArrayPrimitive[] = null;
    switch (operation) {
        case 'get': case 'traverse': result = values[index(a, values.length)]!; break;
        case 'length': result = values.length; break;
        case 'set': values[index(a, values.length)] = primitive(b); result = primitive(b); break;
        case 'insert': values.splice(index(a, values.length, true), 0, primitive(b)); result = values.length; break;
        case 'remove': result = values.splice(index(a, values.length), 1)[0]!; break;
        case 'push': values.push(primitive(a)); result = values.length; break;
        case 'pop': result = values.pop() ?? null; break;
        case 'unshift': values.unshift(primitive(a)); result = values.length; break;
        case 'shift': result = values.shift() ?? null; break;
        case 'swap': {
            const i = index(a, values.length), j = index(b, values.length);
            [values[i], values[j]] = [values[j]!, values[i]!]; result = values.slice(); break;
        }
        case 'reverse': values.reverse(); result = values.slice(); break;
        case 'sort': {
            if (values.some(v => typeof v !== 'number') && values.some(v => typeof v !== 'string'))
                throw new Error('Sort requires all numbers or all strings.');
            values.sort((x,y) => typeof x === 'number' && typeof y === 'number' ? x-y : x! < y! ? -1 : x! > y! ? 1 : 0);
            result = values.slice(); break;
        }
        case 'indexOf': result = values.indexOf(primitive(a)); break;
        case 'includes': result = values.includes(primitive(a)); break;
        case 'slice': {
            const start = index(a, values.length, true), end = index(b, values.length, true);
            if (end < start) throw new Error('Slice end must not precede its start.');
            values.splice(0, values.length, ...before.slice(start, end)); result = values.slice(); break;
        }
        case 'concat': values.push(...primitiveArray(a)); result = values.slice(); break;
        case 'fill': values.fill(primitive(a)); result = values.slice(); break;
        case 'resize': {
            const length = index(a, 256, true);
            if (length < values.length) values.length = length;
            else while (values.length < length) values.push(primitive(b));
            result = values.length; break;
        }
        case 'clear': values.length = 0; result = 0; break;
        default: throw new Error(`Unknown array operation: ${operation}`);
    }
    if (values.length > 256) throw new Error('Array operations cannot exceed 256 cells.');
    const changed = Array.from({length: Math.max(before.length, values.length)}, (_,i) => i)
        .filter(i => i >= before.length || i >= values.length || before[i] !== values[i]);
    return {values, result, changed};
}
/** Safe expression helpers. They return new data and never mutate a scene or visual control. */
export function arrayValues(input: unknown, operation: string, a: unknown = undefined, b: unknown = undefined): ArrayPrimitive[] {
    return arrayOperation(input, operation, a, b).values;
}
export function arrayResult(input: unknown, operation: string, a: unknown = undefined, b: unknown = undefined): string {
    const result = arrayOperation(input, operation, a, b).result;
    return result === null ? '∅' : JSON.stringify(result);
}
export function arrayCount(input: unknown): number { return primitiveArray(input).length; }
export function arrayAt(input: unknown, at: unknown): ArrayPrimitive {
    const values = primitiveArray(input); return values[index(at, values.length)]!;
}
