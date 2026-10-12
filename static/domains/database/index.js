/**
 * Database systems laboratory — a deterministic, tick-based transaction engine.
 *
 * A scenario is a tiny table plus up to three transaction programs written in a
 * small op language (read, write, in-place update, predicate scan, guard,
 * insert, commit, rollback). A schedule — which transaction issues its next
 * statement in each slot — interleaves them. A concurrency-control engine
 * (no isolation, lock-based levels, MVCC levels, OCC, single writer, and
 * modelled PostgreSQL / InnoDB / SQLite / MongoDB behaviour) decides what each
 * statement sees, whether it waits, and whether a transaction must abort.
 *
 * Interleaving is therefore produced by the mechanism, not scripted: a blocked
 * transaction skips its slots and resumes when its lock is released. Every tick
 * emits one serializable row (lanes, versions, locks, conflict graph, detected
 * anomalies, invariants, metrics, captions), which every view reads.
 *
 * Anomalies are detected generically from the history (reads, versions, commit
 * order), and an independent check asks whether any serial order of the same
 * programs produces the same reads and final state.
 *
 * This is a teaching model, not a reimplementation: ticks are statement steps,
 * values are single integers, and real engines differ in many details (see
 * docs.json limits).
 */
(function () {
    'use strict';
    const MAX_TX = 3, MAX_OPS = 6, MAX_KEYS = 5, VERSION_SLOTS = 4, ORDER_SLOTS = 12, FRAMES = 36;
    const traceCache = new Map();

    // ── Scenarios ────────────────────────────────────────────────────────────
    // Op language: R k (SELECT) · RX k (SELECT … FOR UPDATE) · W k = a [+|- b] (UPDATE with a value the
    // application computed) · U k += n (UPDATE … SET v = v + n, computed by the database) · S tag (SELECT SUM … WHERE tag)
    // · IF var >= n (application check; false → ROLLBACK) · I k tag v (INSERT) · C (COMMIT) · A (ROLLBACK).
    // Order matters: scenes expose a prefix of this list. 0-6 anomalies (anomalies scene),
    // 7-8 lost-update fixes (+ isolation scene), 9-10 contention workloads (+ concurrency-control scene).
    const SCENARIOS = [
        { id: 'lost-update', title: 'Lost update', anomaly: 'lost-update', table: 'accounts',
            rows: [['A', 100, 'acct']], tx: [['R A', 'W A = A - 30', 'C'], ['R A', 'W A = A - 20', 'C']],
            order: [1, 2, 1, 1, 2, 2], invariant: { type: 'final', key: 'A', value: 50, label: 'A after both withdrawals' },
            story: 'Two withdrawals read the balance, subtract in the application, and write it back.' },
        { id: 'dirty-write', title: 'Dirty write', anomaly: 'dirty-write', table: 'cars',
            rows: [['listing', 0, 'sale'], ['invoice', 0, 'sale']], tx: [['W listing = 1', 'W invoice = 1', 'C'], ['W listing = 2', 'W invoice = 2', 'C']],
            order: [1, 2, 2, 2, 1, 1], invariant: { type: 'equal', keys: ['listing', 'invoice'], label: 'listing and invoice name the same buyer' },
            story: 'Alice (T1, buyer 1) and Bob (T2, buyer 2) buy the same car: each writes the buyer into the listing and the invoice.' },
        { id: 'dirty-read', title: 'Dirty read', anomaly: 'dirty-read', table: 'accounts',
            rows: [['A', 100, 'acct'], ['B', 0, 'acct']], tx: [['R A', 'W A = A - 60', 'A'], ['R A', 'W B = A', 'C']],
            order: [1, 1, 2, 2, 1, 2], invariant: { type: 'noDirty', label: 'readers see only committed data' },
            story: 'T1 debits A, then rolls back. T2 copies A into a report row B in between.' },
        { id: 'non-repeatable-read', title: 'Non-repeatable read', anomaly: 'non-repeatable-read', table: 'accounts',
            rows: [['A', 100, 'acct']], tx: [['R A', 'R A', 'C'], ['R A', 'W A = A - 30', 'C']],
            order: [1, 2, 2, 2, 1, 1], invariant: { type: 'repeatable', tx: 0, label: 'T1 reads the same A twice' },
            story: 'T1 reads A twice. T2 changes A and commits in between.' },
        { id: 'read-skew', title: 'Read skew', anomaly: 'read-skew', table: 'accounts',
            rows: [['A', 50, 'acct'], ['B', 50, 'acct']], tx: [['R A', 'R B', 'C'], ['R A', 'R B', 'W A = A - 20', 'W B = B + 20', 'C']],
            order: [1, 2, 2, 2, 2, 2, 1, 1], invariant: { type: 'observedSum', tx: 0, keys: ['A', 'B'], value: 100, label: 'T1 audits A + B = 100' },
            story: 'An auditor (T1) sums two accounts while a transfer (T2) moves 20 from A to B.' },
        { id: 'phantom', title: 'Phantom read', anomaly: 'phantom', table: 'orders',
            rows: [['o1', 40, 'order'], ['o2', 60, 'order']], tx: [['S order', 'S order', 'C'], ['I o3 order 30', 'C']],
            order: [1, 2, 2, 1, 1], invariant: { type: 'repeatable', tx: 0, label: 'T1 sums the same orders twice' },
            story: 'T1 totals the orders twice. T2 inserts a new order in between.' },
        { id: 'write-skew', title: 'Write skew', anomaly: 'write-skew', table: 'doctors',
            rows: [['alice', 1, 'oncall'], ['bob', 1, 'oncall']],
            tx: [['S oncall', 'IF oncall >= 2', 'W alice = 0', 'C'], ['S oncall', 'IF oncall >= 2', 'W bob = 0', 'C']],
            order: [1, 2, 1, 2, 1, 2, 1, 2], invariant: { type: 'atLeast', tag: 'oncall', value: 1, label: 'at least one doctor on call' },
            story: 'Alice and Bob each check that two doctors are on call, then take themselves off call.' },
        { id: 'for-update', title: 'Lost update fixed with FOR UPDATE', anomaly: 'lost-update', table: 'accounts',
            rows: [['A', 100, 'acct']], tx: [['RX A', 'W A = A - 30', 'C'], ['RX A', 'W A = A - 20', 'C']],
            order: [1, 2, 1, 2, 1, 2], invariant: { type: 'final', key: 'A', value: 50, label: 'A after both withdrawals' },
            story: 'The same withdrawals, but each reads with SELECT … FOR UPDATE.' },
        { id: 'atomic-update', title: 'Lost update fixed with an atomic UPDATE', anomaly: 'lost-update', table: 'accounts',
            rows: [['A', 100, 'acct']], tx: [['U A -= 30', 'C'], ['U A -= 20', 'C']],
            order: [1, 2, 1, 2], invariant: { type: 'final', key: 'A', value: 50, label: 'A after both withdrawals' },
            story: 'The same withdrawals as one statement each: UPDATE accounts SET v = v - 30.' },
        { id: 'deadlock', title: 'Opposite-order transfers', anomaly: 'deadlock', table: 'accounts',
            rows: [['A', 100, 'acct'], ['B', 100, 'acct']],
            tx: [['R A', 'W A = A - 10', 'R B', 'W B = B + 10', 'C'], ['R B', 'W B = B - 10', 'R A', 'W A = A + 10', 'C']],
            order: [1, 1, 2, 2, 1, 1, 2, 2, 1, 2], invariant: { type: 'sum', keys: ['A', 'B'], value: 200, label: 'A + B' },
            story: 'T1 moves 10 from A to B while T2 moves 10 from B to A: they touch the same rows in opposite order.' },
        { id: 'hot-counter', title: 'Hot counter', anomaly: 'lost-update', table: 'counters',
            rows: [['hits', 100, 'ctr']], tx: [['R hits', 'W hits = hits + 10', 'C'], ['R hits', 'W hits = hits + 10', 'C'], ['R hits', 'W hits = hits + 10', 'C']],
            order: [1, 2, 3, 1, 2, 3, 1, 2, 3], invariant: { type: 'final', key: 'hits', value: 130, label: 'hits after three increments' },
            story: 'Three sessions increment one hot row at the same moment.' },
    ];
    const SCENARIO_INDEX = new Map(SCENARIOS.map((s, i) => [s.id, i]));

    // ── Engines ──────────────────────────────────────────────────────────────
    // family: none | lock | mvcc | occ | single. Error strings are what the modelled product reports.
    const ENGINES = {
        none: { family: 'none', label: 'No isolation', short: 'none',
            summary: 'No locks and no snapshots: reads see the newest write, committed or not, and writes overwrite each other.' },
        'lock-ru': { family: 'lock', readLock: 'none', label: 'Read Uncommitted (locking)', short: 'RU',
            summary: 'Writes take exclusive locks until commit; reads take no locks and can see uncommitted data.' },
        'lock-rc': { family: 'lock', readLock: 'short', label: 'Read Committed (locking)', short: 'RC',
            summary: 'Writes hold exclusive locks until commit; reads take a short shared lock, so they wait for uncommitted writes and see only committed data.' },
        'lock-rr': { family: 'lock', readLock: 'long', label: 'Repeatable Read (locking)', short: 'RR',
            summary: 'Two-phase locking on rows: shared locks on everything read are held until commit. Rows cannot change under you, but new rows matching a predicate can appear.' },
        'lock-ser': { family: 'lock', readLock: 'long', predicate: true, label: 'Serializable (2PL + predicate locks)', short: 'SER',
            summary: 'Strict two-phase locking plus predicate (range) locks: conflicting work waits, and deadlocks abort one transaction.' },
        'mvcc-rc': { family: 'mvcc', snapshot: 'statement', fuw: false, wait: true, label: 'Read Committed (MVCC)', short: 'RC',
            summary: 'Each statement reads a fresh snapshot of committed data. Writers lock rows; a blocked writer proceeds on the newest version once the other commits.' },
        'mvcc-si': { family: 'mvcc', snapshot: 'tx', fuw: true, wait: true, label: 'Snapshot Isolation', short: 'SI',
            summary: 'The whole transaction reads one snapshot. Writing a row that a concurrent transaction changed aborts (first-updater-wins). Write skew is still possible.' },
        ssi: { family: 'mvcc', snapshot: 'tx', fuw: true, wait: true, ssi: true, label: 'Serializable Snapshot Isolation', short: 'SSI',
            summary: 'Snapshot isolation plus tracking of read/write dependencies; a commit that would close a dependency cycle aborts.' },
        'innodb-rr': { family: 'mvcc', snapshot: 'tx', fuw: false, wait: true, label: 'InnoDB Repeatable Read', short: 'RR',
            summary: 'Plain SELECTs read the snapshot taken at the first read, but UPDATE and locking reads act on the newest committed row. No first-updater-wins check.' },
        mongo: { family: 'mvcc', snapshot: 'tx', fuw: true, wait: false, label: 'MongoDB transaction (snapshot)', short: 'snapshot',
            summary: 'Multi-document transactions read a snapshot; a write that conflicts with another transaction aborts at once with a WriteConflict (TransientTransactionError) instead of waiting.' },
        occ: { family: 'occ', label: 'Optimistic concurrency control', short: 'OCC',
            summary: 'No locks while running: writes are buffered privately and, at commit, the transaction is validated — if anything it read changed since it started, it aborts.' },
        single: { family: 'single', label: 'Single writer (SQLite WAL)', short: 'single writer',
            summary: 'Readers use a snapshot; only one transaction may write at a time. A transaction whose snapshot is stale cannot become the writer.' },
    };
    const ERR = {
        textbook: { deadlock: 'deadlock detected', fuw: 'serialization failure: concurrent update', ssi: 'serialization failure: dependency cycle', occ: 'validation failed', conflict: 'write conflict', busy: 'snapshot is stale' },
        postgres: { deadlock: 'ERROR: deadlock detected (40P01)', fuw: 'ERROR: could not serialize access due to concurrent update (40001)', ssi: 'ERROR: could not serialize access due to read/write dependencies among transactions (40001)' },
        mysql: { deadlock: 'ERROR 1213 (40001): Deadlock found when trying to get lock; try restarting transaction' },
        sqlite: { busy: 'SQLITE_BUSY_SNAPSHOT: another connection committed since this snapshot' },
        mongodb: { conflict: 'WriteConflict (TransientTransactionError): retry the transaction', fuw: 'WriteConflict (TransientTransactionError): retry the transaction' },
    };

    /** Isolation levels by index, and what each product actually runs for them. */
    const LEVELS = ['Read Uncommitted', 'Read Committed', 'Repeatable Read', 'Snapshot', 'Serializable'];
    const PROFILES = [
        { id: 'textbook', label: 'Textbook (ANSI, locking)', engines: ['lock-ru', 'lock-rc', 'lock-rr', 'mvcc-si', 'lock-ser'], notes: [] },
        { id: 'postgres', label: 'PostgreSQL', engines: ['mvcc-rc', 'mvcc-rc', 'mvcc-si', 'mvcc-si', 'ssi'],
            notes: ['PostgreSQL runs Read Uncommitted as Read Committed: it never shows uncommitted data.', '', 'PostgreSQL\'s Repeatable Read is snapshot isolation.', 'PostgreSQL has no separate Snapshot level: Repeatable Read is snapshot isolation.', 'PostgreSQL\'s Serializable is SSI: snapshot isolation plus dependency tracking.'] },
        { id: 'mysql', label: 'MySQL / InnoDB', engines: ['lock-ru', 'mvcc-rc', 'innodb-rr', 'innodb-rr', 'lock-ser'],
            notes: ['', '', 'InnoDB Repeatable Read (the default): snapshot reads, but UPDATE writes on the newest committed row with no conflict check.', 'InnoDB has no Snapshot level; START TRANSACTION WITH CONSISTENT SNAPSHOT still runs Repeatable Read.', 'InnoDB Serializable turns plain SELECTs into locking reads (two-phase locking with next-key locks).'] },
        { id: 'sqlite', label: 'SQLite (WAL)', engines: ['single', 'single', 'single', 'single', 'single'],
            notes: Array(5).fill('SQLite transactions are always serializable: one writer at a time, readers on a snapshot. (read_uncommitted applies only to shared-cache connections.)') },
        { id: 'mongodb', label: 'MongoDB', engines: ['mongo', 'mongo', 'mongo', 'mongo', 'mongo'],
            notes: Array(5).fill('MongoDB has no isolation levels: multi-document transactions read a snapshot (readConcern "snapshot") and abort on write conflicts.') },
    ];
    const MECHANISMS = [
        { id: 'lock-ser', label: 'Two-phase locking (pessimistic)', errors: 'textbook' },
        { id: 'occ', label: 'Optimistic (validate at commit)', errors: 'textbook' },
        { id: 'mvcc-si', label: 'MVCC · snapshot isolation', errors: 'textbook' },
        { id: 'ssi', label: 'MVCC · serializable snapshot (SSI)', errors: 'postgres' },
        { id: 'single', label: 'Single writer (SQLite)', errors: 'sqlite' },
    ];

    // ── Op language ──────────────────────────────────────────────────────────
    function parseOp(src) {
        const t = String(src).trim().split(/\s+/);
        switch (t[0]) {
            case 'R': return { kind: 'read', key: t[1], src };
            case 'RX': return { kind: 'read', key: t[1], lock: true, src };
            case 'W': if (t[2] !== '=') break; return { kind: 'write', key: t[1], expr: t.slice(3), src };
            case 'U': return { kind: 'update', key: t[1], delta: Number(t[3]) * (t[2] === '-=' ? -1 : 1), src };
            case 'S': return { kind: 'scan', tag: t[1], src };
            case 'IF': return { kind: 'guard', name: t[1], cmp: t[2], value: Number(t[3]), src };
            case 'I': return { kind: 'insert', key: t[1], tag: t[2], v: Number(t[3]), src };
            case 'C': return { kind: 'commit', src };
            case 'A': return { kind: 'rollback', src };
        }
        throw new Error('Unknown database op: ' + src);
    }
    function evalExpr(expr, vars) {
        const val = tok => {
            if (/^-?\d+$/.test(tok)) return Number(tok);
            if (!(tok in vars)) throw new Error('Variable ' + tok + ' was not read before use');
            return vars[tok];
        };
        let v = val(expr[0]);
        for (let i = 1; i + 1 < expr.length; i += 2) v = expr[i] === '-' ? v - val(expr[i + 1]) : v + val(expr[i + 1]);
        return v;
    }
    function guardHolds(op, vars) {
        const v = vars[op.name] ?? 0;
        return op.cmp === '>=' ? v >= op.value : op.cmp === '>' ? v > op.value : op.cmp === '<=' ? v <= op.value : op.cmp === '<' ? v < op.value : v === op.value;
    }
    /** Lane label before execution. */
    function opLabel(op) {
        switch (op.kind) {
            case 'read': return (op.lock ? 'R⁺ ' : 'R ') + op.key;
            case 'write': return 'W ' + op.key;
            case 'update': return 'U ' + op.key;
            case 'scan': return 'Σ ' + op.tag;
            case 'guard': return 'IF';
            case 'insert': return 'INS ' + op.key;
            case 'commit': return 'COMMIT';
            case 'rollback': return 'ROLLBK';
        }
        return op.src;
    }

    // ── SQL rendering (the Code tab shows exactly the programs the engine runs) ─
    function sqlOf(op, table) {
        switch (op.kind) {
            case 'read': return `SELECT v FROM ${table} WHERE id = '${op.key}'${op.lock ? ' FOR UPDATE' : ''};`;
            case 'write': return `UPDATE ${table} SET v = :${op.expr.length > 1 ? 'new_' + op.key.toLowerCase() : 'v'} WHERE id = '${op.key}';  -- ${op.key} = ${op.expr.join(' ')}, computed in the app`;
            case 'update': return `UPDATE ${table} SET v = v ${op.delta < 0 ? '-' : '+'} ${Math.abs(op.delta)} WHERE id = '${op.key}';`;
            case 'scan': return `SELECT SUM(v) FROM ${table} WHERE tag = '${op.tag}';`;
            case 'guard': return `-- app: if ${op.name} ${op.cmp} ${op.value} continue, else ROLLBACK`;
            case 'insert': return `INSERT INTO ${table} (id, tag, v) VALUES ('${op.key}', '${op.tag}', ${op.v});`;
            case 'commit': return 'COMMIT;';
            case 'rollback': return 'ROLLBACK;';
        }
        return '';
    }
    /** SQL source for a scenario: one block per session. Returns { source, lines: {"T1:0": line, ...} }. */
    function renderSql(index) {
        const sc = SCENARIOS[index];
        const out = [`-- ${sc.title}: ${sc.story}`, `-- Each session runs in its own connection; the lab interleaves their statements.`, ''];
        const lines = {};
        sc.tx.forEach((prog, t) => {
            out.push(`-- ── Session T${t + 1} ──────────────────────────────`);
            out.push('BEGIN;  -- isolation level chosen in the lab');
            prog.forEach((src, i) => {
                const op = parseOp(src);
                if (op.kind === 'guard') out.push(sqlOf(op, sc.table));
                else out.push(sqlOf(op, sc.table));
                lines[`T${t + 1}:${i}`] = out.length;
            });
            out.push('');
        });
        return { source: out.join('\n'), lines };
    }

    // ── Runtime ──────────────────────────────────────────────────────────────
    function createState(sc, engineId, order, cfg) {
        const eng = ENGINES[engineId];
        if (!eng) throw new Error('Unknown database engine: ' + engineId + '. Known: ' + Object.keys(ENGINES).join(', '));
        const s = { sc, eng, engineId, errors: Object.assign({}, ERR.textbook, ERR[cfg.errors] || {}), t: 0, ts: 0, vid: 0,
            store: {}, keys: [], locks: {}, pred: {}, writer: null,
            order, cursor: 0, rr: -1, anoms: new Map(), notes: [],
            m: { commits: 0, aborts: 0, rollbacks: 0, waits: 0, deadlocks: 0, retries: 0, anomalies: 0, ticks: 0 },
            retry: cfg.retry, txs: [] };
        for (const [key, v, tag] of sc.rows) addKey(s, key, { v, tag, writer: 'T0', state: 'committed', ts: 0 });
        sc.tx.forEach((prog, i) => s.txs.push(newTx(i, prog.map(parseOp))));
        return s;
    }
    function newTx(i, ops) {
        return { i, id: 'T' + (i + 1), ops, pc: 0, status: 'idle', attempt: 1, snap: -1, start: -1, vars: {}, reads: [], scans: [], writes: new Map(),
            wait: null, waitSince: 0, labels: ops.map(opLabel), codes: ops.map(() => 1), abortReason: '', restartAt: 0, finishedAt: 0, ccAborted: false, sawDirty: [] };
    }
    function addKey(s, key, version) {
        if (!s.store[key]) { s.store[key] = []; s.keys.push(key); s.locks[key] = { S: new Set(), X: null }; }
        const v = Object.assign({ id: ++s.vid, tag: version.tag ?? tagOf(s, key) }, version);
        s.store[key].push(v);
        return v;
    }
    function tagOf(s, key) { const chain = s.store[key]; return chain && chain.length ? chain[0].tag : ''; }
    const committed = v => v.state === 'committed';
    /** Committed versions of a row, oldest first. With no isolation, writes overwrite the row in place,
     *  so the last WRITE stands; every other engine orders versions by commit. */
    function committedChain(s, key) {
        const chain = (s.store[key] || []).filter(committed);
        return s.eng.family === 'none' ? chain : chain.sort((a, b) => a.ts - b.ts);
    }
    function latestCommitted(s, key) { return committedChain(s, key).pop() || null; }
    function own(s, key, tx) { return (s.store[key] || []).filter(v => v.writer === tx.id && (v.state === 'pending' || v.state === 'private')).pop() || null; }
    function latestLive(s, key) { return (s.store[key] || []).filter(v => v.state !== 'aborted' && v.state !== 'private').pop() || null; }
    function visibleAt(s, key, snap, tx) {
        const mine = own(s, key, tx);
        if (mine) return mine;
        let best = null;
        for (const v of s.store[key] || []) if (committed(v) && v.ts <= snap && (!best || v.ts >= best.ts)) best = v;
        return best;
    }
    function snapFor(s, tx) { return s.eng.snapshot === 'statement' ? s.ts : tx.snap; }
    function versionFor(s, tx, key, op) {
        const e = s.eng;
        if (e.family === 'none') return latestLive(s, key);
        if (e.family === 'lock') return e.readLock === 'none' && !op.lock ? latestLive(s, key) : (own(s, key, tx) || latestCommitted(s, key));
        if (e.family === 'occ') return own(s, key, tx) || latestCommitted(s, key);
        if (e.family === 'mvcc' && op.lock && !e.fuw) return own(s, key, tx) || latestCommitted(s, key);
        return visibleAt(s, key, snapFor(s, tx), tx);
    }

    // Locks ---------------------------------------------------------------------
    function conflicts(s, tx, key, mode) {
        const l = s.locks[key];
        if (!l) return [];
        const out = [];
        if (l.X && l.X !== tx.id) out.push(l.X);
        if (mode === 'X') for (const h of l.S) if (h !== tx.id && !out.includes(h)) out.push(h);
        return out;
    }
    function predConflicts(s, tx, tag) { return [...(s.pred[tag] || [])].filter(h => h !== tx.id); }
    function grant(s, tx, key, mode) {
        const l = s.locks[key];
        if (mode === 'X') { l.X = tx.id; l.S.delete(tx.id); } else if (l.X !== tx.id) l.S.add(tx.id);
    }
    function release(s, tx) {
        for (const key of s.keys) { const l = s.locks[key]; if (l.X === tx.id) l.X = null; l.S.delete(tx.id); }
        for (const tag of Object.keys(s.pred)) s.pred[tag].delete(tx.id);
        if (s.writer === tx.id) s.writer = null;
    }
    function lockNames(s, tx) {
        const held = [];
        for (const key of s.keys) { const l = s.locks[key]; if (l.X === tx.id) held.push('X(' + key + ')'); else if (l.S.has(tx.id)) held.push('S(' + key + ')'); }
        for (const [tag, set] of Object.entries(s.pred)) if (set.has(tx.id)) held.push('pred(' + tag + ')');
        if (s.writer === tx.id) held.push('write lock');
        return held;
    }

    // Algorithm trail: the flowchart nodes this tick's statement passed through, in order,
    // with a one-line detail each. The "Inside the Algorithms" flowcharts light this path.
    function trail(ctx, node, detail) {
        if (!ctx.path) { ctx.path = []; ctx.info = {}; }
        ctx.path.push(node);
        if (detail !== undefined) ctx.info[node] = String(detail);
    }

    // Events ---------------------------------------------------------------------
    function note(ctx, text) { if (text && !ctx.notes.includes(text)) ctx.notes.push(text); }
    function anomaly(s, ctx, kind, tx, text) {
        const key = kind + ':' + tx.id;
        if (s.anoms.has(key)) return;
        s.anoms.set(key, { kind, tx: tx.id, tick: s.t, text });
        s.m.anomalies = new Set([...s.anoms.values()].map(a => a.kind)).size;
        tx.codes[Math.min(tx.pc, tx.ops.length - 1)] = 7;
        ctx.anomaly = true;
        note(ctx, `⚠️ **${ANOMALY_LABEL[kind]}** — ${text}`);
    }
    const ABORT_SHORT = { deadlock: 'deadlock victim', fuw: 'newer commit (first-updater-wins)', ssi: 'dependency cycle (SSI)', occ: 'validation failed',
        conflict: 'write conflict', busy: 'stale snapshot (BUSY_SNAPSHOT)' };
    const ANOMALY_SHORT = { 'dirty-write': 'd-write', 'dirty-read': 'd-read', 'lost-update': 'lost', 'non-repeatable-read': 'NRR', 'read-skew': 'skew', phantom: 'phantom', 'write-skew': 'w-skew' };
    const ANOMALY_LABEL = { 'dirty-read': 'Dirty read', 'lost-update': 'Lost update', 'non-repeatable-read': 'Non-repeatable read', 'read-skew': 'Read skew',
        phantom: 'Phantom read', 'write-skew': 'Write skew', 'dirty-write': 'Dirty write', deadlock: 'Deadlock' };

    function beginIfNeeded(s, ctx, tx) {
        if (tx.status !== 'idle') return;
        tx.status = 'active'; tx.snap = s.ts; tx.start = s.ts;
        ctx.ops.push(tx.id + ':begin');
        const f = s.eng.family;
        if ((f === 'mvcc' && s.eng.snapshot === 'tx') || f === 'single') trail(ctx, 'snapshot', `${tx.id} sees commits ≤ ${s.ts}`);
        else if (f === 'occ') trail(ctx, 'start', `${tx.id} starts after commit ${s.ts}`);
        if (s.eng.family === 'mvcc' && s.eng.snapshot === 'tx' || s.eng.family === 'single') note(ctx, `${tx.id} begins and takes its snapshot (it will see the ${s.ts} commit${s.ts === 1 ? '' : 's'} made so far).`);
    }

    // Waiting ----------------------------------------------------------------------
    function wait(s, ctx, tx, holders, what) {
        if (!tx.wait) { tx.waitSince = s.t; }
        tx.status = 'waiting'; tx.wait = { holders, what };
        tx.codes[tx.pc] = 3;
        note(ctx, `${tx.id} needs ${what} but ${holders.join(', ')} holds a conflicting lock — **${tx.id} waits**.`);
        trail(ctx, 'wait', `${tx.id} waits for ${holders.join(', ')}`);
        const cycle = findWaitCycle(s, tx);
        trail(ctx, 'deadlock?', cycle ? `cycle ${cycle.join('→')}→${cycle[0]}` : 'no cycle');
        if (cycle) {
            s.m.deadlocks++;
            note(ctx, `**Deadlock:** ${cycle.join(' → ')} → ${cycle[0]} all wait for each other. The lock manager breaks the cycle by aborting ${tx.id}.`);
            abort(s, ctx, tx, s.errors.deadlock);
            return 'abort';
        }
        return 'wait';
    }
    function findWaitCycle(s, start) {
        const path = [];
        const visit = tx => {
            if (path.includes(tx.id)) return path.slice(path.indexOf(tx.id));
            if (tx.status !== 'waiting' || !tx.wait) return null;
            path.push(tx.id);
            for (const h of tx.wait.holders) { const c = visit(s.txs.find(x => x.id === h)); if (c) return c; }
            path.pop();
            return null;
        };
        const c = visit(start);
        return c && c.includes(start.id) ? c : null;
    }

    // Statement execution: returns 'done' | 'wait' | 'abort'. ---------------------------
    function acquireRow(s, ctx, tx, key, mode, purpose) {
        const e = s.eng;
        if (e.family === 'none' || e.family === 'occ') return 'ok';
        if (e.family === 'single') {
            if (mode !== 'X') return 'ok';
            if (s.writer === tx.id) { trail(ctx, 'writer?', `${tx.id} already holds it`); return 'ok'; }
            trail(ctx, 'writer?', s.writer ? `held by ${s.writer}` : 'free');
            if (s.writer && s.writer !== tx.id) return wait(s, ctx, tx, [s.writer], 'the database write lock');
            trail(ctx, 'stale?', tx.snap < s.ts ? `snap@${tx.snap} < latest commit ${s.ts}` : `snap@${tx.snap} is current`);
            if (tx.snap < s.ts) return abort(s, ctx, tx, s.errors.busy, `${tx.id}'s snapshot predates a commit, so it may not become the writer: its reads could be stale.`);
            note(ctx, `${tx.id} takes the single **write lock**; other writers must wait.`);
            trail(ctx, 'take-writer', `${tx.id} is the writer`);
            s.writer = tx.id;
            return 'ok';
        }
        const holders = conflicts(s, tx, key, mode);
        const heldBy = () => { const l = s.locks[key]; return [l.X ? 'X:' + l.X : '', ...[...l.S].map(h => 'S:' + h)].filter(Boolean).join(' ') || 'free'; };
        trail(ctx, 'lock-req', `${tx.id} → ${mode}(${key})`);
        trail(ctx, 'compat?', holders.length ? `conflicts with ${heldBy()}` : `compatible (${heldBy()})`);
        if (holders.length) {
            if (e.family === 'mvcc' && e.wait === false) return abort(s, ctx, tx, s.errors.conflict, `${key} has an uncommitted write by ${holders[0]}: this engine aborts instead of waiting.`);
            return wait(s, ctx, tx, holders, `${mode === 'X' ? 'an exclusive (X)' : 'a shared (S)'} lock on ${key} ${purpose}`);
        }
        if (e.family === 'lock' && mode === 'S' && e.readLock === 'short') { trail(ctx, 'grant', `short S(${key}), released after the read`); return 'ok'; }
        grant(s, tx, key, mode);
        trail(ctx, 'grant', `${mode}(${key}) held by ${tx.id} until commit`);
        if (e.family === 'mvcc' && mode === 'X' && e.fuw) {
            const lc = latestCommitted(s, key);
            const newer = lc && lc.ts > tx.snap && lc.writer !== tx.id;
            trail(ctx, 'fuw?', newer ? `${lc.writer} committed ${key} at ${lc.ts} > snap@${tx.snap}` : `no commit to ${key} after snap@${tx.snap}`);
            if (newer) return abort(s, ctx, tx, s.errors.fuw, `${key} was changed by ${lc.writer}, which committed after ${tx.id}'s snapshot (first-updater-wins).`);
        }
        return 'ok';
    }

    function recordRead(s, ctx, tx, key, v, op) {
        const value = v ? v.v : 0;
        const prev = tx.reads.filter(r => r.key === key && !r.own).pop();
        tx.reads.push({ key, vid: v ? v.id : 0, value, ts: v && committed(v) ? v.ts : -1, writer: v ? v.writer : '', state: v ? v.state : 'missing', own: !!(v && v.writer === tx.id), tick: s.t });
        tx.vars[key] = value;
        tx.labels[tx.pc] = (op.lock ? 'R⁺ ' : 'R ') + key + '=' + value;
        const from = v ? `${value} by ${v.writer}${v.state === 'pending' ? ' (uncommitted)' : ''}` : 'missing';
        const f = s.eng.family;
        if (f === 'occ') trail(ctx, 'read-set', `${key} = ${from}; read set += ${key}@${v && committed(v) ? v.ts : '?'}`);
        else if ((f === 'mvcc' && !(op.lock && !s.eng.fuw)) || f === 'single') trail(ctx, 'visible', `${key}: newest version ≤ snap@${snapFor(s, tx)} → ${from}`);
        else trail(ctx, 'read-row', `${key} = ${from}`);
        if (v && v.writer !== tx.id && v.state === 'pending') {
            tx.sawDirty.push({ key, writer: v.writer, value });
            anomaly(s, ctx, 'dirty-read', tx, `${tx.id} read ${key} = ${value}, written by ${v.writer}, which has **not committed**.`);
        }
        if (prev && v && prev.vid !== v.id && v.writer !== tx.id) {
            anomaly(s, ctx, 'non-repeatable-read', tx, `${tx.id} read ${key} = ${prev.value} earlier and now reads ${value}: ${v.writer} changed it in between.`);
        }
        // Read skew: this read sees a writer's effect on one row while an earlier read missed its effect on another.
        if (v && committed(v)) for (const r of tx.reads) {
            if (r.key === key || r.own || r.ts < 0) continue;
            const missed = (s.store[r.key] || []).find(x => committed(x) && x.writer === v.writer && v.writer !== 'T0' && x.ts > r.ts && x.ts <= v.ts);
            if (missed) anomaly(s, ctx, 'read-skew', tx, `${tx.id} saw ${v.writer}'s change to ${key} but not its change to ${r.key}: its reads mix two database states.`);
        }
        note(ctx, `${tx.id} reads ${key} = **${value}**${v && v.writer !== 'T0' ? ` (version by ${v.writer}${v.state === 'pending' ? ', uncommitted' : ''})` : ''}.`);
    }

    function execRead(s, ctx, tx, op) {
        const e = s.eng;
        if (!s.store[op.key]) throw new Error('Unknown row ' + op.key);
        if (e.family === 'lock' && (e.readLock !== 'none' || op.lock)) {
            const r = acquireRow(s, ctx, tx, op.key, op.lock ? 'X' : 'S', 'to read it'); if (r !== 'ok') return r;
        } else if (e.family === 'mvcc' && op.lock) {
            const r = acquireRow(s, ctx, tx, op.key, 'X', 'for SELECT … FOR UPDATE'); if (r !== 'ok') return r;
        } else if (e.family === 'single' && op.lock) {
            const r = acquireRow(s, ctx, tx, op.key, 'X', 'for a locking read'); if (r !== 'ok') return r;
        }
        recordRead(s, ctx, tx, op.key, versionFor(s, tx, op.key, op), op);
        return 'done';
    }

    function execScan(s, ctx, tx, op) {
        const e = s.eng;
        const rows = s.keys.filter(k => tagOf(s, k) === op.tag);
        if (e.family === 'lock' && e.readLock !== 'none') {
            for (const k of rows) { const r = acquireRow(s, ctx, tx, k, 'S', 'to scan it'); if (r !== 'ok') return r; }
            if (e.predicate) { (s.pred[op.tag] = s.pred[op.tag] || new Set()).add(tx.id); note(ctx, `${tx.id} also takes a **predicate lock** on tag = '${op.tag}', so no one can insert a matching row until it commits.`); }
        }
        const seen = {};
        let sum = 0;
        for (const k of rows) {
            const v = versionFor(s, tx, k, op);
            if (!v) continue;
            seen[k] = v.id; sum += v.v;
            if (v.writer !== tx.id && v.state === 'pending') anomaly(s, ctx, 'dirty-read', tx, `${tx.id}'s SUM includes ${k} = ${v.v}, written by ${v.writer}, which has not committed.`);
        }
        const prev = tx.scans.filter(x => x.tag === op.tag).pop();
        tx.scans.push({ tag: op.tag, seen, sum, snap: snapFor(s, tx), tick: s.t });
        tx.vars[op.tag] = sum;
        tx.labels[tx.pc] = 'Σ ' + sum;
        const f = e.family, seenText = `${Object.keys(seen).join(',') || 'no rows'} → ${sum}`;
        if (f === 'occ') trail(ctx, 'read-set', `scan '${op.tag}': ${seenText}`);
        else if (f === 'mvcc' || f === 'single') trail(ctx, 'visible', `scan '${op.tag}' at snap@${snapFor(s, tx)}: ${seenText}`);
        else trail(ctx, 'read-row', `scan '${op.tag}': ${seenText}`);
        note(ctx, `${tx.id} sums rows with tag '${op.tag}': **${sum}** (${Object.keys(seen).join(', ') || 'no rows'}).`);
        if (prev) {
            const a = Object.keys(prev.seen).sort().join(), b = Object.keys(seen).sort().join();
            if (a !== b) anomaly(s, ctx, 'phantom', tx, `${tx.id} ran the same query twice and got different rows (${a} → ${b}): a **phantom** row appeared.`);
            else if (prev.sum !== sum) anomaly(s, ctx, 'non-repeatable-read', tx, `${tx.id} summed '${op.tag}' twice and got ${prev.sum} then ${sum}.`);
        }
        return 'done';
    }

    function execWrite(s, ctx, tx, op) {
        const e = s.eng;
        if (!s.store[op.key]) throw new Error('Unknown row ' + op.key);
        const r = acquireRow(s, ctx, tx, op.key, 'X', 'to write it');
        if (r !== 'ok') return r;
        let value;
        if (op.kind === 'update') {
            // The database computes v + delta on the row version this engine updates.
            const base = e.family === 'occ' || (e.family === 'mvcc' && e.fuw) || e.family === 'single' ? versionFor(s, tx, op.key, op)
                : e.family === 'none' || (e.family === 'lock' && e.readLock === 'none') ? latestLive(s, op.key) : (own(s, op.key, tx) || latestCommitted(s, op.key));
            value = (base ? base.v : 0) + op.delta;
            if (e.family === 'occ') tx.reads.push({ key: op.key, vid: base ? base.id : 0, value: base ? base.v : 0, ts: base && committed(base) ? base.ts : -1, writer: base ? base.writer : '', state: 'committed', own: false, implicit: true, tick: s.t });
            tx.labels[tx.pc] = 'U ' + op.key + '=' + value;
            note(ctx, `${tx.id} runs \`SET v = v ${op.delta < 0 ? '−' : '+'} ${Math.abs(op.delta)}\` on ${op.key}: the **database** reads the current version (${base ? base.v : 0}) and writes **${value}**.`);
        } else {
            value = evalExpr(op.expr, tx.vars);
            tx.labels[tx.pc] = 'W ' + op.key + '=' + value;
            note(ctx, `${tx.id} writes ${op.key} = **${value}** (computed in the application from ${op.expr.filter(x => /[A-Za-z]/.test(x)).join(', ') || 'a constant'}).`);
        }
        installWrite(s, ctx, tx, op.key, value, op);
        return 'done';
    }
    function installWrite(s, ctx, tx, key, value, op) {
        const e = s.eng;
        const mine = own(s, key, tx);
        const other = (s.store[key] || []).find(v => v.state === 'pending' && v.writer !== tx.id);
        if (other && e.family === 'none') anomaly(s, ctx, 'dirty-write', tx, `${tx.id} overwrote ${key} while ${other.writer}'s write to it is still **uncommitted**: if ${other.writer} rolls back, which value should ${key} return to?`);
        if (mine) mine.v = value;
        else addKey(s, key, { v: value, writer: tx.id, state: e.family === 'occ' ? 'private' : 'pending', ts: -1 });
        if (e.family === 'occ') trail(ctx, 'buffer', `write set: ${key} = ${value} (private)`);
        else if (e.family === 'mvcc') trail(ctx, 'add-version', `${key}: new uncommitted version ${value}`);
        else trail(ctx, 'write-row', `${key} = ${value} (uncommitted)`);
        const base = tx.reads.filter(r => r.key === key && !r.own).pop();
        tx.writes.set(key, { value, rmw: op.kind === 'write' && op.expr.includes(key), readTs: base ? base.ts : null, readVid: base ? base.vid : 0 });
        if (e.family === 'occ') note(ctx, `OCC buffers the write privately; nobody else can see it and nothing is locked.`);
    }

    function execInsert(s, ctx, tx, op) {
        const e = s.eng;
        if (e.family === 'lock' && e.predicate) {
            const holders = predConflicts(s, tx, op.tag);
            trail(ctx, 'lock-req', `${tx.id} → insert into '${op.tag}'`);
            trail(ctx, 'compat?', holders.length ? `predicate lock held by ${holders.join(',')}` : 'no predicate lock covers it');
            if (holders.length) return wait(s, ctx, tx, holders, `to insert a '${op.tag}' row (a predicate lock covers it)`);
        }
        if (e.family === 'single') { const r = acquireRow(s, ctx, tx, op.key, 'X', 'to insert'); if (r !== 'ok') return r; }
        if (s.store[op.key] && latestLive(s, op.key)) throw new Error('Duplicate key ' + op.key);
        addKey(s, op.key, { v: op.v, tag: op.tag, writer: tx.id, state: e.family === 'occ' ? 'private' : 'pending', ts: -1 });
        if (e.family === 'lock' || e.family === 'mvcc') grant(s, tx, op.key, 'X');
        tx.writes.set(op.key, { value: op.v, insert: true });
        tx.labels[tx.pc] = 'INS ' + op.key;
        note(ctx, `${tx.id} inserts row ${op.key} (tag '${op.tag}', v = ${op.v}).`);
        return 'done';
    }

    function execGuard(s, ctx, tx, op) {
        const ok = guardHolds(op, tx.vars);
        tx.labels[tx.pc] = ok ? 'IF ✓' : 'IF ✗';
        if (ok) { note(ctx, `${tx.id} checks ${op.name} ${op.cmp} ${op.value}: it saw ${tx.vars[op.name] ?? 0}, so it **continues**.`); return 'done'; }
        note(ctx, `${tx.id} checks ${op.name} ${op.cmp} ${op.value}: it saw ${tx.vars[op.name] ?? 0}, so the application **rolls back**.`);
        rollback(s, ctx, tx, 'application check failed');
        return 'rolled-back';
    }

    // Commit / abort ----------------------------------------------------------------
    function finishVersions(s, tx, state, ts) {
        for (const key of s.keys) for (const v of s.store[key]) if (v.writer === tx.id && (v.state === 'pending' || v.state === 'private')) {
            v.state = state; if (state === 'committed') v.ts = ts;
        }
    }
    function execCommit(s, ctx, tx) {
        const e = s.eng;
        if (e.family === 'occ') {
            trail(ctx, 'validate', `read set: ${[...new Set(tx.reads.filter(r => !r.own).map(r => r.key))].concat(tx.scans.map(x => "'" + x.tag + "'")).join(', ') || 'empty'} vs commits after ${tx.start}`);
            const stale = tx.reads.filter(r => !r.own).map(r => [r.key, latestCommitted(s, r.key)]).find(([, lc]) => lc && lc.ts > tx.start && lc.writer !== tx.id)
                || tx.scans.flatMap(x => s.keys.filter(k => tagOf(s, k) === x.tag)).map(k => [k, latestCommitted(s, k)]).find(([, lc]) => lc && lc.ts > tx.start && lc.writer !== tx.id);
            trail(ctx, 'changed?', stale ? `${stale[0]} changed by ${stale[1].writer} at ${stale[1].ts}` : 'nothing changed');
            for (const r of tx.reads) {
                if (r.own) continue;
                const lc = latestCommitted(s, r.key);
                if (lc && lc.ts > tx.start && lc.writer !== tx.id) return abort(s, ctx, tx, s.errors.occ, `${r.key} was changed by ${lc.writer} after ${tx.id} started, so what ${tx.id} read is stale.`);
            }
            for (const sc of tx.scans) for (const k of s.keys) if (tagOf(s, k) === sc.tag) {
                const lc = latestCommitted(s, k);
                if (lc && lc.ts > tx.start && lc.writer !== tx.id) return abort(s, ctx, tx, s.errors.occ, `a '${sc.tag}' row (${k}) changed after ${tx.id} started, so its SUM is stale.`);
            }
            note(ctx, `${tx.id} **validates**: nothing it read changed since it started, so its buffered writes are installed atomically.`);
            trail(ctx, 'install', `${[...tx.writes.keys()].join(', ') || 'no writes'} installed at ${s.ts + 1}`);
        }
        const ts = ++s.ts;
        finishVersions(s, tx, 'committed', ts);
        if (e.ssi) {
            const cycle = conflictCycle(s, tx.id);
            trail(ctx, 'cycle?', cycle ? `cycle ${cycle.join('→')}→${cycle[0]}` : 'no dependency cycle');
            if (cycle) {
                for (const key of s.keys) for (const v of s.store[key]) if (v.writer === tx.id && v.ts === ts) { v.state = 'pending'; v.ts = -1; }
                s.ts--;
                return abort(s, ctx, tx, s.errors.ssi, `committing ${tx.id} would close the dependency cycle ${cycle.join(' → ')} → ${cycle[0]}, so no serial order could explain the result.`);
            }
        }
        // Lost update: this commit overwrites a row whose value it read before someone else committed a change to it.
        for (const [key, w] of tx.writes) {
            if (!w.rmw || w.readTs == null) continue;
            const lost = s.store[key].find(v => committed(v) && v.writer !== tx.id && v.ts > w.readTs && v.ts < ts);
            if (lost) anomaly(s, ctx, 'lost-update', tx, `${tx.id} computed ${key} from a value read before ${lost.writer} committed ${key} = ${lost.v}, so it **erases** that update.`);
        }
        const held = lockNames(s, tx);
        release(s, tx);
        if (e.family === 'mvcc') trail(ctx, 'commit-ts', `commit ${ts}: ${[...tx.writes.keys()].join(', ') || 'no'} versions visible to new snapshots`);
        else if (e.family !== 'occ') trail(ctx, 'release', held.length ? `released ${held.join(' ')}` : 'nothing to release');
        tx.status = 'committed'; tx.finishedAt = s.t; tx.codes[tx.pc] = 5;
        s.m.commits++;
        ctx.ops.push(tx.id + ':commit');
        note(ctx, `**${tx.id} commits**${tx.writes.size ? ': its writes become visible to new snapshots' : ''}.`);
        writeSkewCheck(s, ctx, tx);
        return 'done';
    }
    /** Write skew: committed transactions that each read what the other wrote, with disjoint writes (an rw-rw cycle). */
    function writeSkewCheck(s, ctx, tx) {
        const g = conflictGraph(s);
        for (const other of s.txs) {
            if (other === tx || other.status !== 'committed') continue;
            const ab = g.edges.find(x => x.from === tx.id && x.to === other.id && x.kind === 'rw');
            const ba = g.edges.find(x => x.from === other.id && x.to === tx.id && x.kind === 'rw');
            const overlap = [...tx.writes.keys()].some(k => other.writes.has(k));
            if (ab && ba && !overlap) anomaly(s, ctx, 'write-skew', tx, `${tx.id} and ${other.id} each changed a row the other had read. Each check passed alone; together they break the rule.`);
        }
    }
    function rollback(s, ctx, tx, reason) {
        finishVersions(s, tx, 'aborted');
        release(s, tx);
        tx.status = 'aborted'; tx.abortReason = reason; tx.finishedAt = s.t; tx.codes[tx.pc] = 6;
        trail(ctx, 'rollback', `${tx.id}: ${reason}`);
        s.m.rollbacks++;
        ctx.ops.push(tx.id + ':rollback');
        dirtyFallout(s, ctx, tx);
        note(ctx, `**${tx.id} rolls back** (${reason}); its writes are discarded.`);
    }
    function abort(s, ctx, tx, error, why) {
        finishVersions(s, tx, 'aborted');
        release(s, tx);
        tx.status = 'aborted'; tx.ccAborted = true; tx.abortReason = error; tx.finishedAt = s.t; tx.wait = null;
        // Flowchart blocks are small: name the reason; the caption keeps the product's full error.
        const kind = Object.keys(s.errors).find(k => s.errors[k] === error);
        trail(ctx, 'abort', `${tx.id}: ${ABORT_SHORT[kind] || error}`);
        tx.codes[Math.min(tx.pc, tx.ops.length - 1)] = 6;
        s.m.aborts++;
        ctx.ops.push(tx.id + ':abort');
        ctx.abort = true;
        note(ctx, `**${tx.id} is aborted** by the database${why ? ': ' + why : '.'} \`${error}\``);
        for (const [k, a] of s.anoms) if (a.tx === tx.id && a.kind !== 'deadlock') {
            s.anoms.delete(k);
            note(ctx, `What ${tx.id} observed (${ANOMALY_LABEL[a.kind].toLowerCase()}) is discarded with it: an aborted transaction leaves no effect.`);
        }
        s.m.anomalies = new Set([...s.anoms.values()].map(a => a.kind)).size;
        dirtyFallout(s, ctx, tx);
        if (s.retry) { tx.restartAt = s.t + 1; note(ctx, `The application catches the error and **retries ${tx.id}** from the start.`); }
        return 'abort';
    }
    function dirtyFallout(s, ctx, tx) {
        for (const o of s.txs) for (const d of o.sawDirty) if (d.writer === tx.id && !d.fallout) {
            d.fallout = true;
            note(ctx, `${o.id} used ${d.key} = ${d.value} from ${tx.id}, and that value **never existed** in any committed state.`);
        }
    }
    function restart(s, ctx, tx) {
        const fresh = newTx(tx.i, tx.ops);
        fresh.attempt = tx.attempt + 1;
        Object.assign(tx, fresh);
        s.m.retries++;
        ctx.ops.push(tx.id + ':retry');
        trail(ctx, 'retry', `${tx.id} attempt ${tx.attempt}`);
        note(ctx, `${tx.id} restarts (attempt ${tx.attempt}) with a fresh snapshot and no locks.`);
    }

    // Conflict (precedence) graph over committed transactions --------------------------
    function conflictGraph(s, including) {
        const done = new Set(s.txs.filter(t => t.status === 'committed' || t.id === including).map(t => t.id));
        const edges = [];
        const add = (from, to, kind, key) => {
            if (from === to || !done.has(from) || !done.has(to)) return;
            if (!edges.some(e => e.from === from && e.to === to && e.kind === kind && e.key === key)) edges.push({ from, to, kind, key });
        };
        for (const key of s.keys) {
            const chain = committedChain(s, key);
            for (let i = 1; i < chain.length; i++) add(chain[i - 1].writer, chain[i].writer, 'ww', key);
        }
        for (const tx of s.txs) {
            if (!done.has(tx.id)) continue;
            for (const r of tx.reads) {
                if (r.own || !r.vid) continue;
                const chain = committedChain(s, r.key);
                const v = chain.find(x => x.id === r.vid);
                if (v) add(v.writer, tx.id, 'wr', r.key);
                const after = v ? chain.slice(chain.indexOf(v) + 1) : chain;
                for (const x of after) add(tx.id, x.writer, 'rw', r.key);
            }
            for (const sc of tx.scans) for (const key of s.keys) {
                if (tagOf(s, key) !== sc.tag) continue;
                const chain = committedChain(s, key);
                const seenV = chain.find(x => x.id === sc.seen[key]);
                if (seenV) add(seenV.writer, tx.id, 'wr', key);
                for (const x of seenV ? chain.slice(chain.indexOf(seenV) + 1) : chain) add(tx.id, x.writer, 'rw', key);
            }
        }
        return { edges, cycle: findCycle(edges) };
    }
    function findCycle(edges, through) {
        const nodes = [...new Set(edges.flatMap(e => [e.from, e.to]))];
        for (const start of through ? [through] : nodes) {
            const stack = [[start, [start]]];
            while (stack.length) {
                const [n, path] = stack.pop();
                for (const e of edges.filter(x => x.from === n)) {
                    if (e.to === start) return path;
                    if (!path.includes(e.to)) stack.push([e.to, path.concat(e.to)]);
                }
            }
        }
        return null;
    }
    function conflictCycle(s, txId) { return findCycle(conflictGraph(s, txId).edges, txId); }

    // Serial-equivalence check: does any serial order of the same programs give the same reads and final state? ---
    function serialRun(sc, order) {
        const state = new Map(sc.rows.map(([k, v, tag]) => [k, { v, tag }]));
        const out = {};
        for (const i of order) {
            const vars = {}, reads = [], writes = new Map();
            let outcome = 'committed';
            for (const op of sc.tx[i].map(parseOp)) {
                const cur = k => (writes.has(k) ? writes.get(k).v : state.get(k)?.v ?? 0);
                if (op.kind === 'read') { vars[op.key] = cur(op.key); reads.push(op.key + '=' + vars[op.key]); }
                else if (op.kind === 'scan') {
                    let sum = 0;
                    for (const [k, row] of state) if (row.tag === op.tag) sum += cur(k);
                    for (const [k, w] of writes) if (!state.has(k) && w.tag === op.tag) sum += w.v;
                    vars[op.tag] = sum; reads.push(op.tag + '=' + sum);
                }
                else if (op.kind === 'write') writes.set(op.key, { v: evalExpr(op.expr, vars), tag: state.get(op.key)?.tag });
                else if (op.kind === 'update') writes.set(op.key, { v: cur(op.key) + op.delta, tag: state.get(op.key)?.tag });
                else if (op.kind === 'insert') writes.set(op.key, { v: op.v, tag: op.tag });
                else if (op.kind === 'guard') { if (!guardHolds(op, vars)) { outcome = 'rolled back'; break; } }
                else if (op.kind === 'rollback') { outcome = 'rolled back'; break; }
                else if (op.kind === 'commit') break;
            }
            if (outcome === 'committed') for (const [k, w] of writes) state.set(k, Object.assign({}, state.get(k) || {}, w));
            out['T' + (i + 1)] = { outcome, reads: reads.join(' ') };
        }
        return { txs: out, state: [...state.entries()].map(([k, r]) => k + '=' + r.v).sort().join(' ') };
    }
    function permutations(list) {
        if (list.length <= 1) return [list];
        return list.flatMap((x, i) => permutations(list.slice(0, i).concat(list.slice(i + 1))).map(p => [x].concat(p)));
    }
    function serialCheck(s) {
        if (s.txs.some(t => t.status !== 'committed' && t.status !== 'aborted')) return null;
        const included = s.txs.filter(t => !t.ccAborted).map(t => t.i);
        const actualState = s.keys.map(k => [k, latestCommitted(s, k)]).filter(([, v]) => v).map(([k, v]) => k + '=' + v.v).sort().join(' ');
        // Each transaction's observations in program order: row reads and scan sums.
        const actual = {};
        for (const t of s.txs) if (!t.ccAborted) {
            const seq = [];
            let ri = 0, si = 0;
            for (const op of t.ops.slice(0, t.pc + 1)) {
                if (op.kind === 'read') { const r = t.reads.filter(x => !x.implicit)[ri++]; if (r) seq.push(r.key + '=' + r.value); }
                if (op.kind === 'scan') { const x = t.scans[si++]; if (x) seq.push(x.tag + '=' + x.sum); }
            }
            actual[t.id] = { outcome: t.status === 'committed' ? 'committed' : 'rolled back', reads: seq.join(' ') };
        }
        const sc = { rows: s.sc.rows, tx: s.sc.tx };
        for (const order of permutations(included)) {
            const run = serialRun(sc, order);
            if (run.state !== actualState) continue;
            if (Object.keys(actual).every(id => run.txs[id] && run.txs[id].outcome === actual[id].outcome && run.txs[id].reads === actual[id].reads))
                return { ok: true, order: order.map(i => 'T' + (i + 1)), text: `✅ Serializable: same result as running ${order.map(i => 'T' + (i + 1)).join(' → ')} one after another.` };
        }
        return { ok: false, order: [], text: `❌ Not serializable: no serial order of ${included.map(i => 'T' + (i + 1)).join(', ')} produces these reads and this final state.` };
    }

    // Invariants --------------------------------------------------------------------
    function invariant(s) {
        const inv = s.sc.invariant, val = k => latestCommitted(s, k)?.v ?? 0;
        const done = s.txs.every(t => t.status === 'committed' || (t.status === 'aborted' && !t.restartAt));
        switch (inv.type) {
            case 'sum': { const sum = inv.keys.reduce((a, k) => a + val(k), 0); return { ok: sum === inv.value, text: `${inv.label} = ${sum} (must be ${inv.value})` }; }
            case 'final': {
                if (!done) return { ok: true, text: `${inv.label}: expect ${inv.value} once everyone finishes (now ${val(inv.key)})` };
                const expected = serialRun({ rows: s.sc.rows, tx: s.sc.tx }, s.txs.filter(t => t.status === 'committed').map(t => t.i)).state;
                const actual = val(inv.key), want = Number((expected.split(' ').find(x => x.startsWith(inv.key + '=')) || '=0').split('=')[1]);
                return { ok: actual === want, text: `${inv.label} = ${actual} (committed work implies ${want})` };
            }
            case 'equal': { const vs = inv.keys.map(val); return { ok: vs.every(v => v === vs[0]), text: `${inv.label}: ${inv.keys.map((k, i) => k + ' = ' + vs[i]).join(', ')}` }; }
            case 'atLeast': { const n = s.keys.filter(k => tagOf(s, k) === inv.tag).reduce((a, k) => a + val(k), 0); return { ok: n >= inv.value, text: `${inv.label}: ${n} on call` }; }
            case 'observedSum': {
                const t = s.txs[inv.tx], rs = inv.keys.map(k => t.reads.filter(r => r.key === k).pop());
                if (rs.some(r => !r)) return { ok: true, text: `${inv.label}: T${inv.tx + 1} has not read both rows yet` };
                const sum = rs.reduce((a, r) => a + r.value, 0);
                return { ok: sum === inv.value, text: `${inv.label}: T${inv.tx + 1} saw ${rs.map(r => r.key + '=' + r.value).join(' + ')} = ${sum}` };
            }
            case 'repeatable': {
                const t = s.txs[inv.tx];
                const reads = t.reads.filter(r => !r.own), scans = t.scans;
                const vals = reads.length ? reads.map(r => r.value) : scans.map(x => x.sum + ' [' + Object.keys(x.seen).join(',') + ']');
                if (vals.length < 2) return { ok: true, text: `${inv.label}: ${vals.length ? 'first read ' + String(vals[0]).split(' ')[0] : 'not read yet'}` };
                return { ok: vals.every(v => v === vals[0]), text: `${inv.label}: ${vals.map(v => String(v).split(' ')[0]).join(' then ')}` };
            }
            case 'noDirty': {
                const dirty = s.txs.flatMap(t => t.sawDirty.map(d => `${t.id} saw ${d.key}=${d.value} from ${d.writer}`));
                return { ok: !dirty.length, text: dirty.length ? dirty.join('; ') : `${inv.label}` };
            }
        }
        return { ok: true, text: '' };
    }

    // Scheduler ---------------------------------------------------------------------
    function runnable(s, tx) { return (tx.status === 'idle' || tx.status === 'active') && tx.pc < tx.ops.length; }
    function pickNext(s) {
        while (s.cursor < s.order.length) {
            const tx = s.txs[s.order[s.cursor++] - 1];
            if (tx && runnable(s, tx)) { s.rr = tx.i; return tx; }
        }
        for (let k = 1; k <= s.txs.length; k++) {
            const tx = s.txs[(s.rr + k) % s.txs.length];
            if (runnable(s, tx)) { s.rr = tx.i; return tx; }
        }
        return null;
    }
    function step(s, ctx, tx) {
        const op = tx.ops[tx.pc];
        trail(ctx, 'stmt', `${tx.id}: ${opLabel(op)}`);
        beginIfNeeded(s, ctx, tx);
        ctx.opref = tx.id + ':' + tx.pc;
        ctx.ops.push(tx.id + ':' + op.kind);
        ctx.actor = tx.id;
        tx.codes[tx.pc] = 4;
        if (op.kind === 'commit') trail(ctx, 'commit', `${tx.id} commits`);
        let r;
        switch (op.kind) {
            case 'read': r = execRead(s, ctx, tx, op); break;
            case 'scan': r = execScan(s, ctx, tx, op); break;
            case 'write': case 'update': r = execWrite(s, ctx, tx, op); break;
            case 'insert': r = execInsert(s, ctx, tx, op); break;
            case 'guard': r = execGuard(s, ctx, tx, op); break;
            case 'commit': r = execCommit(s, ctx, tx); break;
            case 'rollback': rollback(s, ctx, tx, 'ROLLBACK issued by the application'); r = 'rolled-back'; break;
        }
        if (r === 'done') {
            if (tx.status === 'waiting') { tx.status = 'active'; tx.wait = null; }
            if (tx.status === 'active') { tx.pc++; }
            else if (tx.status === 'committed') tx.pc = tx.ops.length;
        } else if (r === 'rolled-back') tx.pc = tx.ops.length;
        return r;
    }
    function tick(s, ctx) {
        for (const tx of s.txs) tx.codes = tx.codes.map(c => (c === 4 ? 2 : c));
        for (const tx of s.txs) if (tx.status === 'aborted' && tx.restartAt && s.t >= tx.restartAt) restart(s, ctx, tx);
        // A waiting transaction whose locks are now free is woken first.
        const waiters = s.txs.filter(t => t.status === 'waiting').sort((a, b) => a.waitSince - b.waitSince);
        for (const w of waiters) {
            if (stillBlocked(s, w)) continue;
            note(ctx, `${w.id}'s lock is now free, so it **resumes**.`);
            trail(ctx, 'wake', `${w.id} resumes`);
            step(s, ctx, w);
            return;
        }
        const tx = pickNext(s);
        if (tx) { step(s, ctx, tx); return; }
        if (!waiters.length && !ctx.notes.length) ctx.idle = true;
    }
    function stillBlocked(s, tx) {
        const op = tx.ops[tx.pc], e = s.eng;
        if (e.family === 'single') return !!(s.writer && s.writer !== tx.id);
        if (op.kind === 'insert') return predConflicts(s, tx, op.tag).length > 0;
        if (op.kind === 'scan') return s.keys.some(k => tagOf(s, k) === op.tag && conflicts(s, tx, k, 'S').length);
        const mode = op.kind === 'read' && !op.lock ? 'S' : 'X';
        return conflicts(s, tx, op.key, mode).length > 0;
    }

    // Snapshot ----------------------------------------------------------------------
    const VER_CODE = { committed: 1, latest: 2, pending: 3, aborted: 4, private: 6 };
    function txStatus(s, tx) {
        // Short: these are lane row labels with little room.
        const base = `${tx.id}${tx.attempt > 1 ? '#' + tx.attempt : ''}`;
        if (tx.status === 'waiting') return `${base} ⏳${tx.wait.holders.join(',')}`;
        if (tx.status === 'aborted') return `${base} ${tx.ccAborted ? 'abort' : 'rollback'}${tx.restartAt ? '↻' : ''}`;
        if (tx.status === 'committed') return `${base} commit`;
        if (tx.status === 'idle') return `${base}`;
        const snap = (s.eng.family === 'mvcc' && s.eng.snapshot === 'tx') || s.eng.family === 'single' ? ` @${tx.snap}` : '';
        return `${base} run${snap}`;
    }
    function lockText(s, key) {
        const e = s.eng, l = s.locks[key];
        if (e.family === 'occ') return 'no locks (validated at commit)';
        if (e.family === 'none') return 'no locks';
        if (e.family === 'single') return s.writer ? `db write lock: ${s.writer}` : 'db write lock: free';
        const parts = [];
        if (l.X) parts.push('X ' + l.X);
        if (l.S.size) parts.push('S ' + [...l.S].join(','));
        const waiting = s.txs.filter(t => t.status === 'waiting' && t.wait && (t.ops[t.pc].key === key || (t.ops[t.pc].tag && t.ops[t.pc].tag === tagOf(s, key))));
        if (waiting.length) parts.push('⏳ ' + waiting.map(t => t.id).join(','));
        return parts.join(' · ') || 'free';
    }
    /** Lock table cells for one row: [exclusive holder, shared holders, waiting]. */
    function lockCells(s, key) {
        const e = s.eng, l = s.locks[key];
        const waiting = s.txs.filter(t => t.status === 'waiting' && t.wait && (t.ops[t.pc].key === key || (t.ops[t.pc].tag && t.ops[t.pc].tag === tagOf(s, key)))).map(t => t.id).join(',');
        if (e.family === 'single') return [s.writer && own(s, key, s.txs.find(t => t.id === s.writer)) ? s.writer : '', '', waiting];
        if (e.family === 'none' || e.family === 'occ') return ['—', '—', ''];
        const pred = Object.entries(s.pred).filter(([tag, set]) => tag === tagOf(s, key) && set.size).map(([, set]) => [...set]).flat();
        return [l.X || '', [...l.S, ...pred.map(t => t + 'ᵖ')].filter((v, i, a) => a.indexOf(v) === i).join(','), waiting];
    }
    function snapshot(s, ctx) {
        const keys = s.keys.slice(0, MAX_KEYS);
        const verLabels = [], verCodes = [];
        for (const key of keys) {
            const chain = s.store[key];
            const latest = latestCommitted(s, key);
            const shown = chain.slice(-VERSION_SLOTS);
            const pad = VERSION_SLOTS - shown.length;
            verLabels.push(Array(pad).fill('').concat(shown.map(v => `${v.v} ${v.writer}${v.state === 'committed' ? '' : v.state === 'pending' ? '…' : v.state === 'private' ? '*' : '✗'}`)));
            verCodes.push(Array(pad).fill(0).concat(shown.map(v => v.state === 'committed' ? (v === latest ? VER_CODE.latest : VER_CODE.committed) : VER_CODE[v.state])));
        }
        const g = conflictGraph(s);
        const cycle = g.cycle || [];
        const edgeLabels = [], edgeCodes = [];
        for (let i = 0; i < MAX_TX; i++) {
            edgeLabels.push([]); edgeCodes.push([]);
            for (let j = 0; j < MAX_TX; j++) {
                const es = g.edges.filter(e => e.from === 'T' + (i + 1) && e.to === 'T' + (j + 1));
                const byKey = {};
                for (const e of es) (byKey[e.key] = byKey[e.key] || []).push(e.kind);
                edgeLabels[i].push(i === j ? '·' : Object.entries(byKey).map(([k, kinds]) => kinds.join('+') + ' ' + k).join('\n'));
                const inCycle = es.length && cycle.includes('T' + (i + 1)) && cycle.includes('T' + (j + 1));
                edgeCodes[i].push(i === j ? 0 : !es.length ? 1 : inCycle ? 3 : 2);
            }
        }
        const inv = invariant(s);
        const serial = serialCheck(s);
        const allDone = !!serial;
        if (allDone && !s.m.ticks) s.m.ticks = s.t;
        const anomalies = [...s.anoms.values()];
        const notes = ctx.notes.slice();
        if (serial && ctx.finalNote !== false && !s.reportedSerial) { s.reportedSerial = true; notes.push(serial.text); }
        const text = notes.length ? notes.join(' ') : allDone ? 'All transactions have finished.' : 'No statement ran this tick.';
        // Captions keep the two most instructive notes: anomalies, aborts and the verdict before routine mechanics.
        const rank = n => (/⚠️|Deadlock/.test(n) ? 0 : /aborted|Not serializable|Serializable:/.test(n) ? 1 : /waits|commits|rolls back/.test(n) ? 2 : 3);
        const events = notes.filter(n => !/Serializable:|Not serializable:/.test(n));
        const brief = events.length ? events.map((n, i) => [rank(n), i, n]).sort((a, b) => a[0] - b[0] || a[1] - b[1])[0][2] : text;
        const row = {
            tick: s.t, engine: s.eng.label, scenario: s.sc.title, text, brief, opref: ctx.opref || '', actor: ctx.actor || '', ops: ctx.ops.slice(),
            lanes: s.txs.map(t => t.labels.concat(Array(MAX_OPS - t.labels.length).fill('')).slice(0, MAX_OPS)),
            laneCodes: s.txs.map(t => t.codes.concat(Array(MAX_OPS - t.codes.length).fill(0)).slice(0, MAX_OPS)),
            laneRows: s.txs.map(t => txStatus(s, t)).concat((s.missingTx || []).length ? Array.from({ length: MAX_TX - s.txs.length }, (_, i) => s.missingTx.includes(s.txs.length + i + 1) ? `T${s.txs.length + i + 1} n/a` : '') : []),
            scheduleNote: s.missingNote || '',
            path: ctx.path || [], pathInfo: ctx.info || {},
            keys, verLabels, verCodes, lockRows: keys.map(k => lockText(s, k)), lockGrid: keys.map(k => lockCells(s, k)), lockCodes: keys.map(k => lockCells(s, k).map((c, i) => (c && c !== '—' ? i + 1 : 0))),
            locksHeld: s.txs.map(t => lockNames(s, t).join(' ') || '—'),
            values: keys.map(k => latestCommitted(s, k)?.v ?? 0),
            edges: g.edges.map(e => `${e.from}→${e.to} ${e.kind}(${e.key})`), edgeLabels, edgeCodes, cycle: cycle.join(' → '),
            anomalies: anomalies.map(a => a.kind), anomalyText: anomalies.map(a => `${ANOMALY_LABEL[a.kind]} (${a.tx}, tick ${a.tick})`),
            invariant: inv.text, invariantOk: inv.ok ? 1 : 0,
            serial: serial ? serial.text : '', serialOk: serial ? (serial.ok ? 1 : 0) : -1, done: allDone ? 1 : 0,
            flow_op: ctx.opref ? 1 : 0, flow_read: ctx.ops.some(o => /:(read|scan)$/.test(o)) ? 1 : 0,
            flow_write: ctx.ops.some(o => /:(write|update|insert)$/.test(o)) ? 1 : 0, flow_commit: ctx.ops.some(o => /:commit$/.test(o)) ? 1 : 0,
            flow_wait: s.txs.some(t => t.status === 'waiting') ? 1 : 0, flow_abort: ctx.abort ? 1 : 0, anomalyNow: ctx.anomaly ? 1 : 0,
        };
        for (const [k, v] of Object.entries(s.m)) row['m_' + k] = v;
        return JSON.parse(JSON.stringify(row));
    }

    function rawSlots(order) {
        if (order && typeof order.toArray === 'function') order = order.toArray();
        return Array.isArray(order) ? order.flat(3).map(Number).filter(n => Number.isFinite(n)).map(n => Math.round(n)) : [];
    }
    /** The schedule to run. No schedule at all means the scenario's own; a given schedule is taken as
     *  is, so one with every slot 0 (= skip) runs everything round-robin rather than the default. */
    function orderOf(sc, order) {
        const raw = rawSlots(order);
        if (!raw.length) return sc.order.slice();
        return raw.filter(n => n >= 1 && n <= sc.tx.length).slice(0, ORDER_SLOTS * 2);
    }
    /** Schedule slots naming a transaction this scenario does not have: [{ slot (1-based), tx }]. */
    function missingSlots(sc, order) {
        return rawSlots(order).map((n, i) => ({ slot: i + 1, tx: n })).filter(x => x.tx > sc.tx.length && x.tx <= MAX_TX);
    }
    function missingNote(sc, missing) {
        if (!missing.length) return '';
        const txs = [...new Set(missing.map(m => 'T' + m.tx))].join(', ');
        const has = SCENARIOS.filter(x => x.tx.length > sc.tx.length).map(x => x.title).join(', ');
        return `⚠️ Schedule slot${missing.length > 1 ? 's' : ''} ${missing.map(m => m.slot).join(', ')} name${missing.length > 1 ? '' : 's'} ${txs}, but **${sc.title}** has only ${sc.tx.map((_, i) => 'T' + (i + 1)).join(' and ')}: ${missing.length > 1 ? 'those slots are' : 'that slot is'} skipped.${has ? ` Three transactions: *${has}*.` : ''}`;
    }
    function scenarioOf(v) {
        if (typeof v === 'string' && SCENARIO_INDEX.has(v)) return SCENARIOS[SCENARIO_INDEX.get(v)];
        const i = Math.round(Number(v));
        if (!(i >= 0 && i < SCENARIOS.length)) throw new Error('Unknown database scenario: ' + v);
        return SCENARIOS[i];
    }

    // Views read the trace once per cell per frame, so a repeat call must be cheap: compare the raw
    // arguments of the last few calls before doing any parsing or building a cache key.
    const recent = [];
    function sameArgs(a, b) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }
    function argList(scenario, engineId, order, opts) {
        if (order && typeof order.toArray === 'function') order = order.toArray();
        const flat = Array.isArray(order) ? order.flat(3) : [order];
        return [scenario, engineId, opts && opts.retry, opts && opts.errors, flat.length, ...flat];
    }
    function run(scenario, engineId, order, opts) {
        const args = argList(scenario, engineId, order, opts);
        for (const r of recent) if (sameArgs(r.args, args)) return r.rows;
        const rows = runUncached(scenario, engineId, order, opts);
        recent.unshift({ args, rows });
        if (recent.length > 8) recent.pop();
        return rows;
    }
    function runUncached(scenario, engineId, order, opts) {
        const sc = scenarioOf(scenario);
        const o = Object.assign({ retry: 0, errors: 'textbook', frames: FRAMES }, opts || {});
        const ord = orderOf(sc, order);
        const missing = missingSlots(sc, order);
        const key = JSON.stringify([sc.id, engineId, ord, missing, o]);
        if (traceCache.has(key)) return traceCache.get(key);
        const s = createState(sc, String(engineId), ord, { retry: o.retry ? 1 : 0, errors: o.errors });
        s.missingNote = missingNote(sc, missing);
        s.missingTx = [...new Set(missing.map(m => m.tx))];
        const rows = [snapshot(s, { notes: [`${sc.story} **${s.eng.label}:** ${s.eng.summary}`], ops: [], finalNote: false })];
        for (s.t = 1; s.t <= o.frames; s.t++) {
            const ctx = { notes: [], ops: [] };
            tick(s, ctx);
            for (const tx of s.txs) if (tx.status === 'waiting') s.m.waits++;
            rows.push(snapshot(s, ctx));
        }
        if (traceCache.size >= 96) traceCache.delete(traceCache.keys().next().value);
        traceCache.set(key, rows);
        return rows;
    }

    // ── Expression API ───────────────────────────────────────────────────────
    function rowsOf(v) { if (v && typeof v.toArray === 'function') v = v.toArray(); return Array.isArray(v) ? v : []; }
    function listOf(v) { if (v && typeof v.toArray === 'function') v = v.toArray(); return Array.isArray(v) ? v : []; }
    const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

    /** Engine id for an isolation level (0..4) under a product profile (0..4). */
    function dbEngine(profile, level) { return PROFILES[clampInt(profile, 0, PROFILES.length - 1)].engines[clampInt(level, 0, LEVELS.length - 1)]; }
    function dbErrors(profile) { return PROFILES[clampInt(profile, 0, PROFILES.length - 1)].id; }
    /** Full per-tick trace. engine is an id (see dbEngines()); order is the schedule (list/matrix of 1..3, 0 = empty slot). */
    function dbTrace(scenario, engine, order, retry, errors) { return run(scenario, engine, order, { retry: Number(retry) ? 1 : 0, errors: errors ? String(errors) : 'textbook' }); }
    /** Trace for a product profile and isolation level: dbLevelTrace(scenario, profile, level, order). */
    function dbLevelTrace(scenario, profile, level, order, retry) { return dbTrace(scenario, dbEngine(profile, level), order, retry, dbErrors(profile)); }
    /** Trace for a concurrency-control mechanism index (0..4). */
    function dbMechTrace(scenario, mechanism, order, retry) {
        const m = MECHANISMS[clampInt(mechanism, 0, MECHANISMS.length - 1)];
        return dbTrace(scenario, m.id, order, retry, m.errors);
    }
    function dbMechanism(n) { return MECHANISMS[clampInt(n, 0, MECHANISMS.length - 1)].label; }
    function dbLevel(n) { return LEVELS[clampInt(n, 0, LEVELS.length - 1)]; }
    function dbProfile(n) { return PROFILES[clampInt(n, 0, PROFILES.length - 1)].label; }
    function dbProfileNote(profile, level) { return PROFILES[clampInt(profile, 0, PROFILES.length - 1)].notes[clampInt(level, 0, LEVELS.length - 1)] || ''; }
    function dbScenario(n) { return scenarioOf(n).title; }
    function dbScenarioId(n) { return scenarioOf(n).id; }
    function dbStory(n) { return scenarioOf(n).story; }
    function dbTxCount(n) { return scenarioOf(n).tx.length; }
    /** Default schedule for a scenario, padded to ORDER_SLOTS. */
    function dbOrder(n) { const o = scenarioOf(n).order.slice(0, ORDER_SLOTS); return o.concat(Array(ORDER_SLOTS - o.length).fill(0)); }
    /** The effective schedule as text: "T1 T2 T1 …". */
    function dbOrderText(n, order) { return orderOf(scenarioOf(n), order).map(i => 'T' + i).join(' '); }

    /** Grid helpers for tensors. */
    function dbCell(grid, row, col) { const r = listOf(grid)[clampInt(row, 0, 99)]; return r ? (listOf(r)[clampInt(col, 0, 99)] ?? 0) : 0; }
    function dbText(grid, row, col) { const r = listOf(grid)[clampInt(row, 0, 99)]; return r ? String(listOf(r)[clampInt(col, 0, 99)] ?? '') : ''; }
    function dbAt(list, i) { const l = listOf(list); return l[clampInt(i, 0, 99)] ?? ''; }
    function dbCount(list) { return listOf(list).length; }
    /** Colors: lanes (0 empty, 1 pending, 2 done, 3 waiting, 4 running now, 5 committed, 6 aborted, 7 anomaly). */
    const LANE_COLORS = ['#1c2631', '#3a4a5c', '#4f8fc0', '#d9a441', '#ffffff', '#3f9a6c', '#b5524f', '#c561b5'];
    const VERSION_COLORS = ['#1c2631', '#41566b', '#4f8fc0', '#d9a441', '#6b3a3a', '#000000', '#8a7bc0'];
    const EDGE_COLORS = ['#1c2631', '#26323f', '#d98b4a', '#c5413f'];
    function dbLaneColor(code) { return LANE_COLORS[clampInt(code, 0, LANE_COLORS.length - 1)]; }

    /** Isolation matrix: run every anomaly scenario (rows) at every level (cols) for a profile. Codes: 0 anomaly, 1 aborted, 2 waited, 3 consistent. */
    const MATRIX_SCENARIOS = ['dirty-write', 'dirty-read', 'lost-update', 'non-repeatable-read', 'read-skew', 'phantom', 'write-skew'];
    const matrixMemo = new Map(), mechMemo = new Map();
    function matrixCell(profile, row, col) {
        const key = clampInt(profile, 0, PROFILES.length - 1) + ':' + clampInt(row, 0, 99) + ':' + clampInt(col, 0, 99);
        if (!matrixMemo.has(key)) matrixMemo.set(key, matrixCellUncached(profile, row, col));
        return matrixMemo.get(key);
    }
    function matrixCellUncached(profile, row, col) {
        const sc = SCENARIOS[SCENARIO_INDEX.get(MATRIX_SCENARIOS[clampInt(row, 0, MATRIX_SCENARIOS.length - 1)])];
        const rows = dbLevelTrace(sc.id, profile, col, sc.order, 0);
        const last = rows[rows.length - 1];
        const occurred = last.anomalies.includes(sc.anomaly) || (last.serialOk === 0 && !last.m_aborts);
        if (occurred) return { code: 0, text: '✗ ' + ANOMALY_SHORT[sc.anomaly] };
        if (last.m_aborts) return { code: 1, text: last.m_deadlocks ? 'deadlock' : 'abort' };
        if (last.m_waits) return { code: 2, text: 'waits' };
        return { code: 3, text: '✓' };
    }
    function dbMatrix(profile, row, col) { return matrixCell(profile, row, col).code; }
    function dbMatrixText(profile, row, col) { return matrixCell(profile, row, col).text; }
    function dbMatrixRow(row) { return ANOMALY_LABEL[MATRIX_SCENARIOS[clampInt(row, 0, MATRIX_SCENARIOS.length - 1)]]; }

    /** Mechanism comparison: scenario (rows) × mechanism (cols) with retries on; text "ticks · aborts · waits". */
    const MECH_SCENARIOS = ['lost-update', 'hot-counter', 'deadlock', 'write-skew', 'read-skew'];
    function mechCell(row, col) {
        const key = clampInt(row, 0, 99) + ':' + clampInt(col, 0, 99);
        if (!mechMemo.has(key)) mechMemo.set(key, mechCellUncached(row, col));
        return mechMemo.get(key);
    }
    function mechCellUncached(row, col) {
        const id = MECH_SCENARIOS[clampInt(row, 0, MECH_SCENARIOS.length - 1)];
        const rows = dbMechTrace(id, col, SCENARIOS[SCENARIO_INDEX.get(id)].order, 1);
        const last = rows[rows.length - 1];
        const bad = last.anomalies.some(a => a !== 'deadlock') || last.serialOk === 0;
        return { code: bad ? 0 : last.m_aborts ? 1 : last.m_waits ? 2 : 3,
            text: bad ? '✗ anomaly' : `${last.m_ticks || '>' + FRAMES}t · ${last.m_aborts}ab · ${last.m_waits}w` };
    }
    function dbMechMatrix(row, col) { return mechCell(row, col).code; }
    function dbMechMatrixText(row, col) { return mechCell(row, col).text; }
    function dbMechMatrixRow(row) { return SCENARIOS[SCENARIO_INDEX.get(MECH_SCENARIOS[clampInt(row, 0, MECH_SCENARIOS.length - 1)])].title; }

    /** Captions. */
    function dbCaption(frame, rows, guide) {
        rows = rowsOf(rows);
        const f = clampInt(frame, 0, rows.length - 1), row = rows[f];
        if (!row) return '';
        const verdict = row.serialOk === 1 ? ' · ✅ serializable' : row.serialOk === 0 ? ' · ❌ not serializable' : '';
        const body = f === 0 ? '' : `**Tick ${f}** — ${row.brief}\n\n${row.invariantOk ? '✅' : '❌'} ${row.invariant}${verdict}`;
        return [guide ? String(guide) : '', row.scheduleNote, body].filter(Boolean).join('\n\n');
    }
    /** Compact factual state for the AI tutor. */
    function dbContext(frame, rows, extra) {
        rows = rowsOf(rows);
        const f = clampInt(frame, 0, rows.length - 1), row = rows[f];
        if (!row) return '';
        const history = rows.slice(1, f + 1).map(r => `t${r.tick}: ${r.text}`).join('\n');
        return [`Scenario: ${row.scenario}. Engine: ${row.engine}. Tick ${f}.${extra ? ' ' + extra : ''}`,
            `Transactions: ${row.laneRows.filter(Boolean).join(' | ')}`,
            ...(row.scheduleNote ? [`Schedule problem: ${row.scheduleNote}`] : []),
            `Statements: ${row.lanes.map((l, i) => 'T' + (i + 1) + ': ' + l.filter(Boolean).join(', ')).join(' | ')}`,
            `Rows (versions oldest→newest): ${row.keys.map((k, i) => k + ' [' + row.verLabels[i].filter(Boolean).join(' | ') + ']').join('; ')}`,
            `Locks: ${row.keys.map((k, i) => k + ': ' + row.lockRows[i]).join('; ')}`,
            `Conflict edges among committed transactions: ${row.edges.join(', ') || 'none'}${row.cycle ? '; cycle ' + row.cycle : ''}`,
            `Anomalies: ${row.anomalyText.join(', ') || 'none'}. Invariant: ${row.invariant} (${row.invariantOk ? 'holds' : 'violated'}).`,
            row.serial ? `Serializability: ${row.serial}` : 'Not all transactions have finished.',
            `Metrics: commits ${row.m_commits}, aborts ${row.m_aborts}, rollbacks ${row.m_rollbacks}, wait-ticks ${row.m_waits}, deadlocks ${row.m_deadlocks}, retries ${row.m_retries}.`,
            `History:\n${history}`].join('\n');
    }
    /** Code tab: active SQL line for scenario `sid` when the current scenario is `current`. */
    function dbSqlLine(sid, current, opref) {
        if (scenarioOf(current).id !== scenarioOf(sid).id || !opref) return 0;
        return renderSql(SCENARIO_INDEX.get(scenarioOf(sid).id)).lines[String(opref)] || 0;
    }
    // Flowchart helpers. A node argument may name several trail nodes separated by '|'
    // ("read-row|write-row"), for a block that stands for either.
    const nodesOf = n => String(n).split('|');
    /** 1 when the algorithm passed through `node` this tick. */
    function dbHit(path, node) { const p = listOf(path); return nodesOf(node).some(n => p.includes(n)) ? 1 : 0; }
    /** 1 when the algorithm went from `a` straight to `b` this tick. */
    function dbHop(path, a, b) {
        const p = listOf(path), from = nodesOf(a), to = nodesOf(b);
        for (let i = 0; i + 1 < p.length; i++) if (from.includes(p[i]) && to.includes(p[i + 1])) return 1;
        return 0;
    }
    /** What happened at `node` this tick, or `fallback` when it was not visited. */
    function dbInfo(info, node, fallback) {
        const map = info && typeof info === 'object' && !Array.isArray(info) ? info : {};
        const hit = nodesOf(node).map(n => map[n]).filter(v => v != null && v !== '');
        return hit.length ? hit.join('; ') : fallback == null ? '' : String(fallback);
    }
    function dbOp(ops, name) { return listOf(ops).some(o => String(o).endsWith(':' + name) || o === name) ? 1 : 0; }

    const api = { dbTrace, dbLevelTrace, dbMechTrace, dbEngine, dbErrors, dbMechanism, dbLevel, dbProfile, dbProfileNote, dbScenario, dbScenarioId, dbStory, dbTxCount,
        dbOrder, dbOrderText, dbCell, dbText, dbAt, dbCount, dbLaneColor, dbMatrix, dbMatrixText, dbMatrixRow, dbMechMatrix, dbMechMatrixText, dbMechMatrixRow,
        dbCaption, dbContext, dbSqlLine, dbOp, dbHit, dbHop, dbInfo };
    if (typeof window !== 'undefined' && window.AlgeBenchDomains) window.AlgeBenchDomains.register('database', api);
    if (typeof globalThis !== 'undefined') globalThis.__databaseLab = { SCENARIOS, ENGINES, PROFILES, MECHANISMS, LEVELS, renderSql, run, serialRun,
        COLORS: { lane: LANE_COLORS, version: VERSION_COLORS, edge: EDGE_COLORS }, limits: { MAX_TX, MAX_OPS, MAX_KEYS, VERSION_SLOTS, ORDER_SLOTS, FRAMES } };
})();
