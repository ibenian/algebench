// Shared builders for the messaging lab lesson generator.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXAMPLES = join(ROOT, 'examples', 'messaging-lab');

/** Code file ids → sample paths under examples/messaging-lab. */
export const FILES = {
    common: 'common.py',
    'kafka-producer': 'kafka/producer.py', 'kafka-consumer': 'kafka/consumer.py',
    'rabbitmq-producer': 'rabbitmq/producer.py', 'rabbitmq-consumer': 'rabbitmq/consumer.py',
    'sqs-producer': 'sqs/producer.py', 'sqs-consumer': 'sqs/consumer.py',
};
const sources = new Map();
export function source(fileId) {
    const path = FILES[fileId];
    if (!path) throw new Error('Unknown code file ' + fileId);
    if (!sources.has(fileId)) sources.set(fileId, readFileSync(join(EXAMPLES, path), 'utf8'));
    return sources.get(fileId);
}
/** One-based line of the first line containing `needle`; throws so a renamed call can't silently unlink. */
export function lineOf(fileId, needle) {
    const i = source(fileId).split('\n').findIndex(line => line.includes(needle));
    if (i < 0) throw new Error(`${FILES[fileId]}: no line contains ${JSON.stringify(needle)}`);
    return i + 1;
}
/** codeRef + codeLinks for a block from [[fileId, needle], ...]. */
export function refs(...list) {
    const resolved = list.map(([file, needle]) => ({ file, line: lineOf(file, needle) }));
    return { codeRef: resolved[0], ...(resolved.length > 1 ? { codeLinks: resolved.slice(1) } : {}) };
}

/** Expression reading one field of a system's trace at the current tick. */
export const T = (system, field) => `dataTable('${system}', frame, '${field}')`;
export const TRACED = 'mqId(traceMsg)';

/** Discrete colorMap for mqCode values 0..8 (empty, stored, delivered, processing, processed, acked, dlq, lost, traced). */
export const STATE_STOPS = ['#1c2631', '#4f8fc0', '#d9a441', '#e6c35c', '#e8875a', '#3f9a6c', '#b05a9a', '#8a3b3b', '#ffffff'];
export function stateColorMap() {
    return { stops: STATE_STOPS.map((color, i) => ({ t: i / 8, color })) };
}

/** Metrics strip: one row of system-appropriate counters. */
export function metricsTensor(system, id, origin, columns) {
    const fields = columns.map(c => c[1]);
    const pick = fields.map((f, i) => i < fields.length - 1 ? `col == ${i} ? ${T(system, f)} : ` : T(system, f)).join('');
    return {
        id, type: 'tensor', shape: [1, columns.length], origin, cellSize: 2.05, gap: 0.05, plane: 'xy',
        valueExpr: pick, textExpr: 'value', textColor: '#edf4ff',
        colorMap: { stops: [{ t: 0, color: '#22384d' }, { t: 1, color: '#22384d' }] }, colorDomain: [0, 1], opacity: 0.95,
        shader: { ignorePlaneOpacity: true },
        axes: [{}, { labels: columns.map(c => c[0]), color: '#b8cee0', labelBand: 0.4 }], axisLabels: 'plane',
        prompt: `Explain these ${system} metrics at the current tick, how each is defined for this system, and why it differs from the similarly named metric in other systems.`,
    };
}

/** Consumer status strip inside a consumers block. */
export function consumerArray(system, id) {
    return {
        type: 'array', id, itemType: 'string', origin: [-4.1, 0.05, 0.25], cellSize: 4.0, fontSize: 11, showIndices: false,
        // Fixed row pitch (no arrayHeight): up to 6 consumers wrap into 2 full-height rows instead of squashing.
        arrayColumns: 3, axisLabels: 'plane',
        lengthExpr: `arrayCount(${T(system, 'consumers')})`,
        valueExpr: `arrayAt(${T(system, 'consumers')}, idx)`,
        colorExpr: 'mqConsumerColor(value)',
        prompt: 'Explain each consumer status: which work it holds, whether it is alive, and why some may be idle.',
    };
}

/** A horizontal array of message ids, colored by lifecycle state; the traced message is white. */
export function messageArray(system, field, id, origin, opts = {}) {
    return {
        type: 'array', id, itemType: 'string', origin, cellSize: opts.cellSize ?? 0.82, fontSize: opts.fontSize ?? 10,
        showIndices: false, axisLabels: 'plane',
        lengthExpr: `min(arrayCount(${T(system, field)}), ${opts.max ?? 14})`,
        valueExpr: `arrayAt(${T(system, field)}, idx)`,
        colorExpr: `mqColor(${T(system, 'life')}, value, ${TRACED})`,
        ...(opts.label ? { label: opts.label, labelPosition: opts.labelPosition, align: 'left' } : {}),
        prompt: opts.prompt,
    };
}

export const slider = (id, label, min, max, def, extra = {}) => ({ id, label, min, max, step: 1, default: def, ...extra });
