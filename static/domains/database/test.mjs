// node --test static/domains/database/test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const sandbox = { window: { AlgeBenchDomains: { register: (name, functions) => { assert.equal(name, 'database'); sandbox.api = functions; } } } };
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync(new URL('./index.js', import.meta.url), 'utf8'), sandbox);
const { api } = sandbox;
const lab = sandbox.__databaseLab;
const last = (scenario, engine, opts = {}) => api.dbTrace(scenario, engine, opts.order ?? 0, opts.retry ?? 0, opts.errors).at(-1);
const PG = 1, MYSQL = 2, SQLITE = 3, MONGO = 4;
const [RU, RC, RR, SI, SER] = [0, 1, 2, 3, 4];
const level = (scenario, profile, lvl) => api.dbLevelTrace(scenario, profile, lvl, 0, 0).at(-1);

test('a trace has one row per tick plus tick 0, and every scenario finishes', () => {
    for (const sc of lab.SCENARIOS) for (const engine of Object.keys(lab.ENGINES)) {
        const rows = api.dbTrace(sc.id, engine, 0, 0);
        assert.equal(rows.length, lab.limits.FRAMES + 1);
        assert.equal(rows.at(-1).done, 1, `${sc.id} under ${engine} did not finish`);
    }
});

test('with no isolation, each anomaly scenario produces its anomaly and is not serializable', () => {
    for (const id of ['lost-update', 'dirty-write', 'dirty-read', 'non-repeatable-read', 'read-skew', 'phantom', 'write-skew']) {
        const r = last(id, 'none');
        assert.ok(r.anomalies.includes(id), `${id}: ${r.anomalies}`);
        assert.equal(r.serialOk, 0, id);
        assert.equal(r.invariantOk, 0, `${id} invariant: ${r.invariant}`);
    }
});

test('serial schedules are serializable under every engine', () => {
    for (const sc of lab.SCENARIOS) {
        const serial = sc.tx.flatMap((ops, i) => ops.map(() => i + 1));
        for (const engine of Object.keys(lab.ENGINES)) {
            const r = last(sc.id, engine, { order: serial });
            assert.equal(r.serialOk, 1, `${sc.id} under ${engine}: ${r.serial}`);
            assert.equal(r.m_aborts, 0, `${sc.id} under ${engine} aborted a serial schedule`);
        }
    }
});

test('the lost-update scenario is a pure lost update: no uncommitted data is overwritten', () => {
    assert.deepEqual([...last('lost-update', 'none').anomalies], ['lost-update']);
});

test('dirty write: interleaved uncommitted writes leave listing and invoice naming different buyers', () => {
    const r = last('dirty-write', 'none');
    assert.ok(r.anomalies.includes('dirty-write'));
    assert.deepEqual([...r.values], [2, 1]);
    assert.equal(r.invariantOk, 0);
    for (const engine of ['lock-ru', 'mvcc-rc', 'mvcc-si', 'single']) {
        const ok = last('dirty-write', engine);
        assert.equal(ok.invariantOk, 1, engine);
        assert.equal(ok.serialOk, 1, engine);
    }
});

test('lost update: the second commit overwrites the first; A ends at 80, not 50', () => {
    const r = last('lost-update', 'lock-rc');
    assert.deepEqual([...r.values], [80]);
    assert.ok(r.anomalies.includes('lost-update'));
});

test('locking Read Committed prevents dirty reads by waiting', () => {
    const r = last('dirty-read', 'lock-rc');
    assert.ok(!r.anomalies.includes('dirty-read'));
    assert.ok(r.m_waits > 0);
    assert.equal(r.serialOk, 1);
});

test('two-phase locking turns the lost update into a deadlock and aborts one side', () => {
    const r = last('lost-update', 'lock-rr');
    assert.equal(r.m_deadlocks, 1);
    assert.equal(r.m_aborts, 1);
    assert.equal(r.serialOk, 1);
});

test('locking Repeatable Read still lets phantoms in; predicate locks stop them', () => {
    assert.ok(last('phantom', 'lock-rr').anomalies.includes('phantom'));
    const ser = last('phantom', 'lock-ser');
    assert.ok(!ser.anomalies.includes('phantom'));
    assert.ok(ser.m_waits > 0, 'the insert must wait for the predicate lock');
});

test('snapshot isolation: no read anomalies, first-updater-wins aborts, write skew survives', () => {
    for (const id of ['dirty-read', 'non-repeatable-read', 'read-skew', 'phantom']) {
        const r = last(id, 'mvcc-si');
        assert.equal(r.anomalies.length, 0, id);
        assert.equal(r.m_waits, 0, `${id}: snapshot readers never wait`);
    }
    const lu = last('lost-update', 'mvcc-si');
    assert.equal(lu.m_aborts, 1);
    assert.equal(lu.serialOk, 1);
    const ws = last('write-skew', 'mvcc-si');
    assert.ok(ws.anomalies.includes('write-skew'));
    assert.equal(ws.invariantOk, 0, 'nobody is on call');
});

test('SSI aborts write skew with a serialization failure', () => {
    const r = last('write-skew', 'ssi', { errors: 'postgres' });
    assert.equal(r.m_aborts, 1);
    assert.equal(r.serialOk, 1);
    assert.equal(r.invariantOk, 1);
    assert.match(r.text + api.dbTrace('write-skew', 'ssi', 0, 0, 'postgres').map(x => x.text).join(' '), /read\/write dependencies/);
});

test('PostgreSQL: RR aborts the lost update; Serializable aborts write skew; RU never reads dirty data', () => {
    assert.ok(level('lost-update', PG, RC).anomalies.includes('lost-update'));
    assert.equal(level('lost-update', PG, RR).m_aborts, 1);
    assert.ok(level('write-skew', PG, RR).anomalies.includes('write-skew'));
    assert.equal(level('write-skew', PG, SER).m_aborts, 1);
    assert.ok(!level('dirty-read', PG, RU).anomalies.includes('dirty-read'));
});

test('MySQL/InnoDB Repeatable Read: snapshot reads, but the read-modify-write lost update succeeds silently', () => {
    const r = level('lost-update', MYSQL, RR);
    assert.ok(r.anomalies.includes('lost-update'));
    assert.equal(r.m_aborts, 0);
    assert.equal(level('non-repeatable-read', MYSQL, RR).anomalies.length, 0);
    assert.equal(level('phantom', MYSQL, RR).anomalies.length, 0);
    assert.ok(level('dirty-read', MYSQL, RU).anomalies.includes('dirty-read'));
});

test('FOR UPDATE and atomic UPDATE fix the lost update without aborting under InnoDB RR and PostgreSQL RC', () => {
    for (const id of ['for-update', 'atomic-update']) for (const engine of ['innodb-rr', 'mvcc-rc']) {
        const r = last(id, engine);
        assert.deepEqual([...r.values], [50], `${id} under ${engine}`);
        assert.equal(r.m_aborts, 0);
        assert.equal(r.serialOk, 1);
    }
});

test('SQLite is serializable at every level; MongoDB aborts write conflicts without waiting', () => {
    for (let l = 0; l < 5; l++) for (const id of ['lost-update', 'write-skew', 'read-skew', 'phantom']) assert.equal(level(id, SQLITE, l).serialOk, 1, `${id} @ ${l}`);
    const m = level('lost-update', MONGO, SI);
    assert.equal(m.m_aborts, 1);
    assert.equal(m.m_waits, 0);
    assert.ok(level('write-skew', MONGO, SER).anomalies.includes('write-skew'));
});

test('opposite-order transfers deadlock under 2PL; retries finish with the money conserved', () => {
    const r = last('deadlock', 'lock-ser', { retry: 1 });
    assert.ok(r.m_deadlocks >= 1);
    assert.ok(r.m_retries >= 1);
    assert.equal(r.invariantOk, 1);
    assert.deepEqual([...r.values], [100, 100]);
    assert.equal(r.serialOk, 1);
});

test('OCC never waits; it aborts at validation and anomalies seen by aborted transactions are discarded', () => {
    for (const id of ['lost-update', 'read-skew', 'phantom', 'write-skew']) {
        const r = last(id, 'occ');
        assert.equal(r.m_waits, 0, id);
        assert.equal(r.m_aborts, 1, id);
        assert.equal(r.anomalies.length, 0, id);
        assert.equal(r.serialOk, 1, id);
    }
});

test('hot counter: every serializable mechanism with retries reaches 130', () => {
    for (let m = 0; m < 5; m++) {
        const r = api.dbMechTrace('hot-counter', m, 0, 1).at(-1);
        assert.deepEqual([...r.values], [130], api.dbMechanism(m));
    }
});

test('matrices are computed from the engine', () => {
    assert.equal(api.dbMatrixText(0, 5, 2), '✗ phantom');
    assert.equal(api.dbMatrix(1, 6, 4), 1); // PostgreSQL Serializable aborts write skew
    assert.equal(api.dbMatrix(2, 2, 2), 0); // InnoDB RR loses the update
    for (let p = 0; p < 5; p++) for (let l = 0; l < 5; l++) assert.notEqual(api.dbMatrix(p, 0, l), 0, `dirty write prevented at every level (${p}, ${l})`);
    assert.match(api.dbMechMatrixText(3, 2), /anomaly/); // SI lets write skew through
});

test('SQL rendering maps every statement to a line, and the code line follows the trace', () => {
    for (let i = 0; i < lab.SCENARIOS.length; i++) {
        const { source, lines } = lab.renderSql(i);
        const n = source.split('\n').length;
        lab.SCENARIOS[i].tx.forEach((ops, t) => ops.forEach((_, k) => assert.ok(lines[`T${t + 1}:${k}`] > 0 && lines[`T${t + 1}:${k}`] <= n)));
    }
    const rows = api.dbTrace('lost-update', 'none', 0, 0);
    assert.ok(api.dbSqlLine('lost-update', 'lost-update', rows[1].opref) > 0);
    assert.equal(api.dbSqlLine('phantom', 'lost-update', rows[1].opref), 0);
});

test('an edited schedule changes the outcome: serial order removes the anomaly', () => {
    assert.ok(last('lost-update', 'none', { order: [1, 2, 1, 2, 1, 2] }).anomalies.includes('lost-update'));
    assert.equal(last('lost-update', 'none', { order: [1, 1, 1, 2, 2, 2] }).anomalies.length, 0);
    assert.equal(api.dbOrderText(0, [2, 2, 0, 1, 9]), 'T2 T2 T1');
});

test('schedule slots naming a transaction the scenario lacks are skipped, and the trace says so', () => {
    const rows = api.dbTrace('lost-update', 'none', [1, 3, 2, 1, 2, 3, 1, 2], 0);
    const r = rows.at(-1);
    assert.match(r.scheduleNote, /slots 2, 6 name T3/);
    assert.equal(r.laneRows[2], 'T3 n/a');
    assert.match(api.dbCaption(0, rows, ''), /skipped/);
    // The skipped slots do not change what runs.
    assert.deepEqual([...r.values], [...last('lost-update', 'none', { order: [1, 2, 1, 2, 1, 2] }).values]);
    // A valid schedule carries no note and no padded lane.
    const ok = last('lost-update', 'none');
    assert.equal(ok.scheduleNote, '');
    assert.equal(ok.laneRows.length, 2);
    // Hot counter really has T3.
    assert.equal(last('hot-counter', 'none', { order: [3, 3, 3] }).scheduleNote, '');
});
