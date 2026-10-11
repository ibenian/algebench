// The transaction board: sessions → concurrency control → storage, drawn as one system_dag
// whose blocks contain tensors reading the `db` trace table at the current tick.
import { LAB, T, codeColorMap } from './util.mjs';

const { MAX_TX, MAX_OPS, MAX_KEYS, VERSION_SLOTS } = LAB.limits;
const { lane: LANE, version: VERSION, edge: EDGE } = LAB.COLORS;

const wire = (id, from, to, activeExpr, extra = {}) => ({ id, from: { block: from[0], port: from[1] }, to: { block: to[0], port: to[1] }, activeExpr, ...extra });

/** The SQL file of the scenario selected by the `scenario` slider, at the line of the statement running now. */
const SQL_REF = { fileExpr: "concat('sql-', dbScenarioId(scenario))", lineExpr: `max(1, dbSqlLine(scenario, scenario, ${T('opref')}))` };

function lanes(prefix) {
    return {
        type: 'tensor', id: prefix + 'lanes', shape: [MAX_TX, MAX_OPS], origin: [-6.2, -3.9, 0.25], cellSize: 2.5, gap: 0.08, plane: 'xy',
        valueExpr: `dbCell(${T('laneCodes')}, row, col)`, textExpr: `dbText(${T('lanes')}, row, col)`, textColor: 'auto',
        colorMap: codeColorMap(LANE), colorDomain: [0, LANE.length - 1], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{ labelExpr: `dbAt(${T('laneRows')}, row)`, color: '#b8cee0' }, {}], axisLabels: 'plane',
        prompt: 'Explain each transaction lane at this tick: which statements ran (blue), which is running now (white), which is waiting (amber), and why a transaction committed (green), aborted or rolled back (red), or produced an anomaly (magenta).',
    };
}
function lockTable(prefix) {
    return {
        type: 'tensor', id: prefix + 'locks', shape: [MAX_KEYS, 3], origin: [-10.6, -5.9, 0.25], cellSize: 1.9, gap: 0.06, plane: 'xy',
        valueExpr: `dbCell(${T('lockCodes')}, row, col)`, textExpr: `dbText(${T('lockGrid')}, row, col)`, textColor: 'auto',
        colorMap: codeColorMap(['#1f2b37', '#b5524f', '#4f8fc0', '#d9a441']), colorDomain: [0, 3], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{ labelExpr: `dbAt(${T('keys')}, row)`, color: '#b8cee0' }, { labels: ['X', 'S', 'waits'], color: '#b8cee0' }], axisLabels: 'plane',
        label: 'Lock table',
        prompt: 'Explain the lock table: who holds an exclusive (X) or shared (S) lock on each row, who is waiting and why, and whether this engine uses locks at all. A superscript p marks a predicate lock.',
    };
}
function conflictMatrix(prefix) {
    return {
        type: 'tensor', id: prefix + 'conflicts', shape: [MAX_TX, MAX_TX], origin: [1.6, -4.6, 0.25], cellSize: 2.6, gap: 0.08, plane: 'xy',
        valueExpr: `dbCell(${T('edgeCodes')}, row, col)`, textExpr: `dbText(${T('edgeLabels')}, row, col)`, textColor: 'auto',
        colorMap: codeColorMap(EDGE), colorDomain: [0, EDGE.length - 1], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{ labels: ['T1 →', 'T2 →', 'T3 →'], color: '#b8cee0' }, { labels: ['T1', 'T2', 'T3'], color: '#b8cee0' }], axisLabels: 'plane',
        label: 'Conflict graph (row must precede column)',
        prompt: 'Explain the conflict (precedence) graph among committed transactions: ww = overwrote, wr = read what the other wrote, rw = read a version the other later replaced. A cycle (red) means no serial order explains the outcome.',
    };
}
function versions(prefix) {
    return {
        type: 'tensor', id: prefix + 'versions', shape: [MAX_KEYS, VERSION_SLOTS], origin: [-3.9, -6.2, 0.25], cellSize: 2.3, gap: 0.08, plane: 'xy',
        valueExpr: `dbCell(${T('verCodes')}, row, col)`, textExpr: `dbText(${T('verLabels')}, row, col)`, textColor: 'auto',
        colorMap: codeColorMap(VERSION), colorDomain: [0, VERSION.length - 1], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{ labelExpr: `dbAt(${T('keys')}, row)`, color: '#b8cee0' }, {}], axisLabels: 'plane',
        label: 'Versions, oldest → newest',
        prompt: 'Explain the row versions: value, writer and commit number (@n). Bright blue is the newest committed version, grey-blue older committed ones, amber uncommitted, violet privately buffered (OCC), dark red discarded by an abort. Which version would each transaction see now?',
    };
}

export function board(prefix = '') {
    const dag = {
        type: 'system_dag', id: prefix + 'db', label: 'Database server', pipeRadius: 0.06, origin: [0, 0, 0],
        blocks: [
            { id: 'sessions', label: 'Sessions · one connection per transaction', kind: 'client', position: [-4, 7.4, 0], size: [26, 8.6, 0.18],
                ports: [{ id: 'stmt', side: 'bottom', offset: -0.3 }, { id: 'reply', side: 'bottom', offset: 0.3 }],
                elements: [lanes(prefix)], codeRef: SQL_REF },
            { id: 'cc', label: 'Concurrency control', kind: 'processor', position: [-4, -5.2, 0], size: [26, 13.8, 0.18],
                ports: [{ id: 'stmt', side: 'top', offset: -0.3 }, { id: 'reply', side: 'top', offset: 0.3 }, { id: 'io', side: 'right', offset: 0 }],
                elements: [lockTable(prefix), conflictMatrix(prefix)] },
            { id: 'storage', label: 'Storage · row versions', kind: 'database', position: [16, 0.9, 0], size: [12, 22.4, 0.18],
                ports: [{ id: 'io', side: 'left', offset: 0 }],
                elements: [versions(prefix)] },
        ],
        connections: [
            wire('stmt', ['sessions', 'stmt'], ['cc', 'stmt'], T('flow_op')),
            wire('reply', ['cc', 'reply'], ['sessions', 'reply'], `${T('flow_wait')} + ${T('flow_abort')}`, { activeColor: '#e0a04a' }),
            wire('io', ['cc', 'io'], ['storage', 'io'], `${T('flow_read')} + ${T('flow_write')} + ${T('flow_commit')}`, { direction: 'both', activeColor: '#7fd1a0' }),
        ],
    };
    const metrics = [['Commits', 'm_commits'], ['DB aborts', 'm_aborts'], ['Rollbacks', 'm_rollbacks'], ['Wait ticks', 'm_waits'], ['Deadlocks', 'm_deadlocks'], ['Anomalies', 'm_anomalies']];
    const pick = metrics.map(([, f], i) => (i < metrics.length - 1 ? `col == ${i} ? ${T(f)} : ` : T(f))).join('');
    const strip = {
        id: prefix + 'metrics', type: 'tensor', shape: [1, metrics.length], origin: [-17, -16.6, 0], cellSize: 2.6, gap: 0.06, plane: 'xy',
        valueExpr: pick, textExpr: 'value', textColor: '#edf4ff',
        colorMap: { stops: [{ t: 0, color: '#22384d' }, { t: 1, color: '#22384d' }] }, colorDomain: [0, 1], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{}, { labels: metrics.map(m => m[0]), color: '#b8cee0', labelBand: 0.4 }], axisLabels: 'plane',
        prompt: 'Explain these counters: commits, aborts forced by the database, application rollbacks, ticks spent waiting for locks, deadlocks, and distinct anomalies. Relate them to the trade-off between waiting, aborting and anomalies.',
    };
    return [dag, strip];
}

/** A computed comparison matrix (rows × cols) with codes 0 anomaly · 1 abort · 2 waits · 3 consistent. */
export function matrix({ id, origin, rows, cols, valueExpr, textExpr, rowLabelExpr, colLabels, label, prompt, cellSize = 2.5 }) {
    return {
        type: 'tensor', id, shape: [rows, cols], origin, cellSize, gap: 0.08, plane: 'xy',
        valueExpr, textExpr, textColor: 'auto',
        colorMap: codeColorMap(['#b5524f', '#d98b4a', '#4f8fc0', '#3f9a6c']), colorDomain: [0, 3], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{ labelExpr: rowLabelExpr, color: '#b8cee0' }, { labels: colLabels, color: '#b8cee0' }], axisLabels: 'plane',
        label, prompt,
    };
}
