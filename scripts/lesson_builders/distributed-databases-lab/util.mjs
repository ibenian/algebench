// Shared builders for the distributed databases lab generator.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..', '..');

/** The domain library, loaded the way the browser does, so scenarios have one source of truth. */
function loadDomain() {
    const sandbox = { window: { AlgeBenchDomains: { register: (_, api) => { sandbox.api = api; } } } };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(readFileSync(join(ROOT, 'static', 'domains', 'distdb', 'index.js'), 'utf8'), sandbox);
    return { api: sandbox.api, lab: sandbox.__distdbLab };
}
export const { api: DD, lab: LAB } = loadDomain();
export const SCENARIO = Object.fromEntries(LAB.SCENARIOS.map((s, i) => [s.id, i]));
/** [first, last] scenario index of a scene's contiguous block of scenarios. */
export function scenarioRange(scene) {
    const idx = LAB.SCENARIOS.map((s, i) => (s.scene === scene ? i : -1)).filter(i => i >= 0);
    return [idx[0], idx[idx.length - 1]];
}

/** Expression reading one field of the cluster trace at the current tick. */
export const T = field => `dataTable('dd', frame, '${field}')`;

// reset: steps re-declare these sliders with new values; going back a step must restore the earlier ones.
export const slider = (id, label, min, max, def, extra = {}) => ({ id, label, min, max, step: 1, default: def, reset: true, ...extra });

/** Discrete colorMap for integer codes 0..n-1. */
export function codeColorMap(colors) {
    return { stops: colors.map((color, i) => ({ t: i / (colors.length - 1), color })) };
}

export function readExample(path) { return readFileSync(join(HERE, 'code', path), 'utf8'); }
/** One-based line of the first line containing `needle`; throws so a renamed line can't silently unlink. */
export function lineIn(source, needle) {
    const i = source.split('\n').findIndex(line => line.includes(needle));
    if (i < 0) throw new Error(`no line contains ${JSON.stringify(needle)}`);
    return i + 1;
}

// Colours shared by boards, legends and the markdown that explains them.
export const COLORS = {
    // Client timeline: idle · write in flight · read in flight · write ok · fresh read · stale read · failed · lost · siblings.
    timeline: ['#1c2631', '#4f8fc0', '#7a8ea8', '#3f9a6c', '#7fd1a0', '#c561b5', '#b5524f', '#ff7a45', '#d9a441'],
    // Replica cell: none · newest · behind · siblings · tombstone · hint only · node down.
    version: ['#1c2631', '#3f9a6c', '#d98b4a', '#d9a441', '#6a5a80', '#8a7bc0', '#262a30'],
    // Computed outcome: lost write · stale / broken guarantee · unavailable · siblings · ✓ · not applicable.
    outcome: ['#c5413f', '#c561b5', '#d98b4a', '#d9a441', '#3f9a6c', '#1c2631'],
    node: ['#5aa0c8', '#e7a14a', '#7cc47f', '#c77dce', '#e06c75', '#56b6c2', '#d8c35a', '#9aa5b1', '#f08fb0'],
};
