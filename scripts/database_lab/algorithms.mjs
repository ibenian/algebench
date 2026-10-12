// "Inside the Algorithms": one flowchart per concurrency-control algorithm. Blocks are the
// algorithm's steps and decisions; the engine records which ones each tick's statement passed
// through (row.path, with a detail per node in row.pathInfo), so blocks and pipes light the
// path actually taken, and each block's text says what happened there.
import { T, readExample, lineIn } from './util.mjs';

// Every flowchart spans the board's width (SPAN, x = -17..22) whatever its column count: the column
// pitch is stretched so the outer blocks' edges line up with the board's. `origin` is the left edge.
export const SPAN = 39, ROW = 3.6, W = 6.2, H = 2.0;
const PORTS = [{ id: 'n', side: 'top', offset: 0 }, { id: 's', side: 'bottom', offset: 0 }, { id: 'e', side: 'right', offset: 0 }, { id: 'w', side: 'left', offset: 0 },
    { id: 's2', side: 'bottom', offset: 0.55 }];

/**
 * Flowchart definitions. Block: [id, title, trail nodes ('a|b'), [col, row], kind, idle text, code needle].
 * Edge: [from, port, to, port, label?, activeExpr override?]; by default an edge lights when the
 * trail goes straight from one block's nodes to the next block's.
 */
export const ALGORITHMS = {
    lock: {
        title: 'Two-phase locking', file: 'algorithms/two_phase_locking.py',
        blocks: [
            ['stmt', 'Statement', 'stmt', [0, 0], 'client', 'next statement in the schedule', 'def execute('],
            ['lockreq', 'Lock request', 'lock-req', [0, 1], 'processor', 'S to read · X to write', 'request = LockRequest('],
            ['compat', 'Compatible?', 'compat?', [0, 2], 'gateway', 'S+S ok · X conflicts with all', 'if lock_table.compatible('],
            ['grant', 'Grant lock', 'grant', [0, 3], 'processor', 'locks only grow', 'lock_table.grant(request)'],
            ['run', 'Read / write row', 'read-row|write-row', [0, 4], 'database', 'act on the row', 'def run('],
            ['wait', 'Wait in queue', 'wait', [1, 2], 'worker', 'blocked until a holder releases', 'lock_table.enqueue(request)'],
            ['deadlock', 'Deadlock cycle?', 'deadlock?', [1, 3], 'gateway', 'checked on every wait', 'if wait_for_graph.has_cycle_through('],
            ['abort', 'Abort victim', 'abort', [1, 4], 'worker', 'breaks the cycle', 'abort(tx, "deadlock detected")'],
            ['retry', 'Client retries', 'retry', [1, 5], 'client', 'whole transaction again', null],
            ['commit', 'Commit', 'commit', [2, 0], 'store', 'flush the log', 'def commit('],
            ['release', 'Release all locks', 'release', [2, 1], 'processor', 'all at once (strict 2PL)', 'lock_table.release(lock)'],
            ['wake', 'Wake waiters', 'wake', [2, 2], 'processor', 'a waiter resumes', 'lock_table.wake_compatible_waiters()'],
            ['rollback', 'Rollback', 'rollback', [2, 3], 'worker', 'undo, then release', 'def rollback('],
        ],
        edges: [
            ['stmt', 's', 'lockreq', 'n'], ['lockreq', 's', 'compat', 'n'], ['compat', 's', 'grant', 'n', 'yes'], ['grant', 's', 'run', 'n'],
            ['compat', 'e', 'wait', 'w', 'no'], ['wait', 's', 'deadlock', 'n'], ['deadlock', 's', 'abort', 'n', 'yes'], ['abort', 's', 'retry', 'n'],
            ['stmt', 'e', 'commit', 'w'], ['commit', 's', 'release', 'n'], ['release', 's', 'wake', 'n', null, "dbHit(PATH, 'wake')"],
            ['wake', 's', 'rollback', 'n', null, 'HOP(stmt, rollback)'],
        ],
    },
    occ: {
        title: 'Optimistic concurrency control', file: 'algorithms/optimistic.py',
        blocks: [
            ['start', 'Note start time', 'start', [-1, 0], 'processor', 'first statement only', 'tx.start = last_commit_ts'],
            ['stmt', 'Statement', 'stmt', [0, 0], 'client', 'next statement in the schedule', 'def read('],
            ['readset', 'Read → read set', 'read-set', [0, 1], 'database', 'no locks taken', 'tx.read_set[row] ='],
            ['buffer', 'Buffer write', 'buffer', [1, 1], 'processor', 'invisible to others', 'tx.write_set[row] = value'],
            ['commit', 'Commit', 'commit', [2, 0], 'store', 'validate, then write', 'def commit('],
            ['validate', 'Validate', 'validate', [2, 1], 'processor', 'compare with commits since start', 'for row in tx.read_set:'],
            ['changed', 'Changed since?', 'changed?', [2, 2], 'gateway', 'any newer commit?', 'if row.latest_committed.commit_ts > tx.start'],
            ['install', 'Install writes', 'install', [2, 3], 'database', 'writes become visible', 'row.install(value'],
            ['abort', 'Abort', 'abort', [1, 3], 'worker', 'work is thrown away', 'abort(tx, "validation failed")'],
            ['retry', 'Client retries', 'retry', [1, 4], 'client', 'whole transaction again', null],
        ],
        edges: [
            ['stmt', 'w', 'start', 'e'], ['stmt', 's', 'readset', 'n', null, 'HOP(stmt|start, read-set)'], ['stmt', 's2', 'buffer', 'n', null, 'HOP(stmt|start, buffer)'],
            ['stmt', 'e', 'commit', 'w'], ['commit', 's', 'validate', 'n'], ['validate', 's', 'changed', 'n'], ['changed', 's', 'install', 'n', 'no'],
            ['changed', 'w', 'abort', 'e', 'yes'], ['abort', 's', 'retry', 'n'],
        ],
    },
    mvcc: {
        title: 'MVCC · snapshot isolation (+ SSI)', file: 'algorithms/mvcc.py',
        blocks: [
            ['snapshot', 'Take snapshot', 'snapshot', [-1, 0], 'processor', 'first statement only', 'tx.snapshot = last_commit_ts'],
            ['stmt', 'Statement', 'stmt', [0, 0], 'client', 'next statement in the schedule', 'def read('],
            ['visible', 'Read visible version', 'visible', [0, 1], 'database', 'newest version ≤ snapshot', 'return version.value'],
            ['compat', 'Row locked?', 'lock-req|compat?', [1, 1], 'gateway', 'one writer per row', 'if row.lock not in (None, tx):'],
            ['wait', 'Wait for writer', 'wait|deadlock?', [2, 1], 'worker', 'readers never wait', 'wait_for(row.lock)'],
            ['grant', 'Lock the row', 'grant', [1, 2], 'processor', 'until commit', 'row.lock = tx'],
            ['fuw', 'Newer commit?', 'fuw?', [1, 3], 'gateway', 'first-updater-wins', 'if row.latest_committed.commit_ts > tx.snapshot'],
            ['newv', 'Append version', 'add-version', [1, 4], 'database', 'old versions stay readable', 'row.versions.append('],
            ['abort', 'Abort', 'abort', [2, 3], 'worker', 'serialization failure', 'abort(tx, "could not serialize access")'],
            ['retry', 'Client retries', 'retry', [2, 4], 'client', 'whole transaction again', null],
            ['commit', 'Commit', 'commit', [3, 0], 'store', 'publish the versions', 'def commit('],
            ['cycle', 'Cycle? (SSI)', 'cycle?', [3, 1], 'gateway', 'only under SSI', 'if SERIALIZABLE and closes_dependency_cycle(tx):'],
            ['commitTs', 'Commit timestamp', 'commit-ts', [3, 2], 'database', 'visible to later snapshots', 'tx.commit_ts = next_commit_ts()'],
        ],
        edges: [
            ['stmt', 'w', 'snapshot', 'e'], ['stmt', 's', 'visible', 'n', null, 'HOP(stmt|snapshot, visible)'], ['stmt', 's2', 'compat', 'n', null, 'HOP(stmt|snapshot, lock-req)'],
            ['compat', 's', 'grant', 'n', 'no'], ['compat', 'e', 'wait', 'w', 'yes'], ['grant', 's', 'fuw', 'n'], ['fuw', 's', 'newv', 'n', 'no'],
            ['fuw', 'e', 'abort', 'w', 'yes'], ['wait', 's', 'abort', 'n', 'deadlock', 'HOP(deadlock?, abort)'], ['abort', 's', 'retry', 'n'],
            ['stmt', 'e', 'commit', 'w'], ['commit', 's', 'cycle', 'n', null, 'HOP(commit, cycle?|commit-ts)'],
            ['cycle', 's', 'commitTs', 'n', 'no', 'HOP(cycle?|commit, commit-ts)'], ['cycle', 'w', 'abort', 'e', 'yes'],
        ],
    },
    single: {
        title: 'Single writer (SQLite WAL)', file: 'algorithms/single_writer.py',
        blocks: [
            ['snapshot', 'Take snapshot', 'snapshot', [-1, 0], 'processor', 'first statement only', 'tx.snapshot = last_commit_ts'],
            ['stmt', 'Statement', 'stmt', [0, 0], 'client', 'next statement in the schedule', 'def read('],
            ['visible', 'Read at snapshot', 'visible', [0, 1], 'database', 'readers never wait', 'return row.version_at(tx.snapshot)'],
            ['writer', 'Writer free?', 'writer?', [1, 1], 'gateway', 'one writer for the whole database', 'if writer_lock.holder not in (None, tx):'],
            ['wait', 'Wait (busy)', 'wait|deadlock?', [2, 1], 'worker', 'until the writer commits', 'wait_for(writer_lock.holder)'],
            ['stale', 'Snapshot stale?', 'stale?', [1, 2], 'gateway', 'committed since my snapshot?', 'if tx.snapshot < last_commit_ts:'],
            ['take', 'Become writer', 'take-writer', [1, 3], 'processor', 'others must wait', 'writer_lock.holder = tx'],
            ['write', 'Append to WAL', 'write-row', [1, 4], 'database', 'uncommitted until commit', 'wal.append(row, value)'],
            ['abort', 'Abort (busy)', 'abort', [2, 2], 'worker', 'reads may be stale', 'abort(tx, "SQLITE_BUSY_SNAPSHOT")'],
            ['retry', 'Client retries', 'retry', [2, 3], 'client', 'whole transaction again', null],
            ['commit', 'Commit', 'commit', [3, 0], 'store', 'WAL commit record', 'wal.commit(tx)'],
            ['release', 'Release writer', 'release', [3, 1], 'processor', 'next writer may start', 'writer_lock.holder = None'],
        ],
        edges: [
            ['stmt', 'w', 'snapshot', 'e'], ['stmt', 's', 'visible', 'n', null, 'HOP(stmt|snapshot, visible)'], ['stmt', 's2', 'writer', 'n', null, 'HOP(stmt|snapshot, writer?)'],
            ['writer', 's', 'stale', 'n', 'free'], ['writer', 'e', 'wait', 'w', 'held'], ['stale', 's', 'take', 'n', 'no'], ['take', 's', 'write', 'n'],
            ['stale', 'e', 'abort', 'w', 'yes'], ['abort', 's', 'retry', 'n'], ['stmt', 'e', 'commit', 'w'], ['commit', 's', 'release', 'n'],
        ],
    },
};

const PATH = T('path'), INFO = T('pathInfo');
/** Expand the shorthand in an edge's activeExpr: PATH and HOP(a, b). */
function expandActive(expr) {
    return expr.replace(/HOP\(([^,]+),\s*([^)]+)\)/g, (_, a, b) => `dbHop(PATH, '${a.trim()}', '${b.trim()}')`).replace(/PATH/g, PATH);
}

export const algorithmFileId = family => 'algo-' + family;

/** The flowchart for one algorithm family, as a system_dag at `origin`. */
export function algorithmDag(family, origin) {
    const algo = ALGORITHMS[family];
    const source = readExample(algo.file);
    const byId = Object.fromEntries(algo.blocks.map(b => [b[0], b]));
    const cols = algo.blocks.map(b => b[3][0]), cMin = Math.min(...cols), cMax = Math.max(...cols);
    const pitch = (SPAN - W) / Math.max(1, cMax - cMin);
    // Only the ports an edge uses: unused ones would draw as stray dots on the block.
    const used = new Map();
    for (const [from, fp, to, tp] of algo.edges) for (const [b, p] of [[from, fp], [to, tp]]) (used.get(b) ?? used.set(b, new Set()).get(b)).add(p);
    const blocks = algo.blocks.map(([id, title, nodes, [c, r], kind, idle, needle]) => ({
        id, label: title, kind, position: [W / 2 + (c - cMin) * pitch, -r * ROW, 0], size: [W, H, 0.16],
        ...(used.has(id) ? { ports: PORTS.filter(p => used.get(id).has(p.id)) } : {}),
        textExpr: `dbInfo(${INFO}, '${nodes}', '${idle.replace(/'/g, '’')}')`,
        highlightExpr: `dbHit(${PATH}, '${nodes}')`,
        ...(needle ? { codeRef: { file: algorithmFileId(family), line: lineIn(source, needle) } }
            : { codeRef: { file: 'retry', line: lineIn(readExample('retry.py'), 'for attempt in range') } }),
    }));
    const connections = algo.edges.map(([from, fp, to, tp, label, active], i) => ({
        id: `${from}-${to}-${i}`, from: { block: from, port: fp }, to: { block: to, port: tp },
        activeExpr: active ? expandActive(active) : `dbHop(${PATH}, '${byId[from][2]}', '${byId[to][2]}')`,
        ...(label ? { label } : {}),
        ...(byId[to][0] === 'abort' || label === 'deadlock' ? { activeColor: '#e0675a' } : {}),
    }));
    return { type: 'system_dag', id: 'algo-' + family, label: algo.title, pipeRadius: 0.06, origin, blocks, connections,
        prompt: `Explain the ${algo.title} flowchart at this tick: which path the statement took through it, why each decision went that way, and what the highlighted blocks' text says happened.` };
}

/** Code tab file for one algorithm: the pseudocode, with the lines of every block the trail visited active. */
export function algorithmCodeFile(family) {
    const algo = ALGORITHMS[family];
    const source = readExample(algo.file);
    const lines = algo.blocks.filter(b => b[6]).map(b => `(dbHit(${PATH}, '${b[2]}') ? ${lineIn(source, b[6])} : 0)`);
    return { id: algorithmFileId(family), path: 'database_lab/' + algo.file, language: 'python', source, activeLineExpr: '[' + lines.join(', ') + ']' };
}
