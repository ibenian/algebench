// Shared builders for the database lab lesson generator.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The domain library itself, loaded the way the browser does, so scenarios and SQL have one source of truth. */
function loadDomain() {
    const sandbox = { window: { AlgeBenchDomains: { register: (_, api) => { sandbox.api = api; } } } };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(readFileSync(join(ROOT, 'static', 'domains', 'database', 'index.js'), 'utf8'), sandbox);
    return { api: sandbox.api, lab: sandbox.__databaseLab };
}
export const { api: DB, lab: LAB } = loadDomain();
export const SCENARIO = Object.fromEntries(LAB.SCENARIOS.map((s, i) => [s.id, i]));

/** Expression reading one field of the trace at the current tick. */
export const T = field => `dataTable('db', frame, '${field}')`;
/** A math.js string literal. */
export const str = text => JSON.stringify(String(text));

// reset: steps re-declare these sliders with new values; going back a step must restore the earlier ones.
export const slider = (id, label, min, max, def, extra = {}) => ({ id, label, min, max, step: 1, default: def, reset: true, ...extra });

/** Discrete colorMap for integer codes 0..n-1. */
export function codeColorMap(colors) {
    return { stops: colors.map((color, i) => ({ t: i / (colors.length - 1), color })) };
}

export function readExample(path) { return readFileSync(join(ROOT, 'examples', 'database-lab', path), 'utf8'); }
/** One-based line of the first line containing `needle`; throws so a renamed line can't silently unlink. */
export function lineIn(source, needle) {
    const i = source.split('\n').findIndex(line => line.includes(needle));
    if (i < 0) throw new Error(`no line contains ${JSON.stringify(needle)}`);
    return i + 1;
}
