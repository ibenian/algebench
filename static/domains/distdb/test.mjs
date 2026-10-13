// node --test static/domains/distdb/test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const sandbox = { window: { AlgeBenchDomains: { register: (name, functions) => { assert.equal(name, 'distdb'); sandbox.api = functions; } } } };
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync(new URL('./index.js', import.meta.url), 'utf8'), sandbox);
const { api } = sandbox;
const lab = sandbox.__distdbLab;
const last = (scenario, ov = {}) => api.ddTrace(scenario, ov).at(-1);
const labels = row => row.labels.map(l => l.split(': ').at(-1));
const ACK = { async: 0, semi: 1, majority: 2, sync: 3 };
const READ = { eventual: 0, ryw: 1, monotonic: 2, causal: 3, linearizable: 4 };

test('every scenario runs to the last tick with one row per tick, deterministically', () => {
    for (const sc of lab.SCENARIOS) {
        const rows = api.ddTrace(sc.id, {});
        assert.equal(rows.length, lab.limits.FRAMES + 1, sc.id);
        assert.deepEqual(JSON.parse(JSON.stringify(rows)), JSON.parse(JSON.stringify(lab.run(sc.id, { _fresh: 1 }))), `${sc.id} is not deterministic`);
    }
});

test('async replication: a primary crash before shipping loses acknowledged writes; semi-sync loses none', () => {
    const async = last('primary-crash', { ack: ACK.async });
    assert.ok(async.m_lost >= 1, `async lost ${async.m_lost}`);
    assert.equal(async.m_failovers, 1);
    assert.equal(async.linOk, 0);
    const semi = last('primary-crash', { ack: ACK.semi });
    assert.equal(semi.m_lost, 0);
});

test('sync replication stalls writes while a replica is down; semi-sync keeps going', () => {
    const sync = last('replica-crash', { ack: ACK.sync });
    assert.ok(sync.m_timedOut >= 1, 'sync: some write should time out');
    const semi = last('replica-crash', { ack: ACK.semi });
    assert.equal(semi.m_timedOut, 0);
    assert.equal(semi.m_lost, 0);
});

test('isolated primary without a lease: split brain loses writes; with a lease it steps down instead', () => {
    const noLease = last('split-brain', { lease: 0 });
    assert.ok(noLease.m_lost >= 2, `split brain lost ${noLease.m_lost}`);
    const lease = last('split-brain', { lease: 1 });
    assert.ok(lease.m_rejected >= 1, 'the stepped-down primary rejects writes');
    assert.ok(lease.m_lost < noLease.m_lost);
});

test('replication lag: replica reads are stale until the replica catches up, then converge', () => {
    const rows = api.ddTrace('lag', {});
    assert.ok(rows.at(-1).m_stale >= 2);
    assert.equal(rows.at(-1).converged, 1);
    assert.equal(last('lag', { replDelay: 0 }).m_stale < rows.at(-1).m_stale, true);
});

test('consistency ladder: each guarantee fixes exactly its own scenario', () => {
    const worst = (id, read) => labels(last(id, { read }));
    assert.ok(worst('ryw', READ.eventual).includes('breaks read-your-writes'));
    assert.ok(!worst('ryw', READ.ryw).includes('breaks read-your-writes'));
    assert.ok(worst('monotonic', READ.eventual).includes('breaks monotonic reads'));
    assert.ok(worst('monotonic', READ.ryw).includes('breaks monotonic reads'), 'RYW does not imply monotonic reads');
    assert.ok(!worst('monotonic', READ.monotonic).includes('breaks monotonic reads'));
    assert.ok(worst('causal', READ.monotonic).includes('breaks causal'), 'monotonic reads do not imply causal');
    assert.ok(!worst('causal', READ.causal).includes('breaks causal'));
    for (const id of lab.CONSISTENCY_ROWS) assert.equal(last(id, { read: READ.linearizable }).linOk, 1, `${id} under primary reads`);
    assert.equal(last('linearizable', { read: READ.causal }).linOk, 0, 'causal is weaker than linearizable');
});

test('stronger guarantees cost latency', () => {
    assert.ok(last('ryw', { read: READ.ryw }).m_p99 > last('ryw', { read: READ.eventual }).m_p99);
});

test('history checker: a read after a completed write must see it; a read inside the write may not', () => {
    // Eventual reads on the lagging replica after the acknowledged write: not linearizable.
    assert.equal(last('linearizable', { read: READ.eventual }).linOk, 0);
    // The failed (timed-out) write may legitimately appear: with blocking read repair every reader agrees.
    assert.equal(last('failed-write', { readRepair: 2 }).linOk, 1);
});

test('quorums: R + W <= N reads stale; R + W > N does not on the basic scenario', () => {
    assert.ok(last('quorum', { N: 3, R: 1, W: 1 }).m_stale >= 1);
    assert.equal(last('quorum', { N: 3, R: 2, W: 2 }).m_stale, 0);
    // Availability: two of three replicas down → W = 2 cannot be met.
    assert.ok(last('quorum', { N: 3, R: 2, W: 2, down: 2 }).m_rejected >= 1);
});

test('R + W > N is not linearizable without blocking read repair (read during a slow write)', () => {
    assert.equal(last('concurrent-read', { readRepair: 0 }).linOk, 0);
    assert.equal(last('concurrent-read', { readRepair: 2 }).linOk, 1);
});

test('a failed write leaves residue that readers disagree about', () => {
    const r = last('failed-write', { readRepair: 0 });
    assert.equal(r.m_timedOut, 1);
    assert.equal(r.linOk, 0);
    assert.ok(labels(r).includes('stale (not linearizable)'));
});

test('sloppy quorum: the write and read quorums no longer intersect', () => {
    const r = last('sloppy');
    assert.equal(r.m_ok, 4);
    assert.ok(r.m_stale >= 1);
    assert.ok(r.m_hints >= 1, 'hints are handed off after the heal');
    assert.equal(r.converged, 1);
});

test('last-write-wins with clock skew silently discards the later write', () => {
    const r = last('lww-skew');
    assert.equal(r.m_lost, 1);
    assert.equal(r.linOk, 0);
    assert.equal(r.verGrid[0][0], '1');
});

test('CAP: a CP policy rejects on the minority side and stays linearizable; AP accepts and diverges', () => {
    for (const policy of [0, 1]) {
        const r = last('partition', { policy });
        assert.ok(r.m_rejected + r.m_timedOut >= 1, `policy ${policy} should refuse something`);
        assert.equal(r.linOk, 1, `policy ${policy}`);
    }
    const rows = api.ddTrace('partition', { policy: 2 });
    assert.equal(rows.at(-1).m_rejected + rows.at(-1).m_timedOut, 0);
    assert.equal(rows.at(-1).linOk, 0);
    assert.equal(rows[20].converged, 0, 'the two sides diverge during the partition');
    assert.equal(rows.at(-1).converged, 1, 'and converge after the heal');
    assert.ok(last('partition', { policy: 3 }).m_siblings >= 1, 'siblings keep both sides');
});

test('PACELC: with no partition, CP pays latency and AP pays staleness', () => {
    const cp = last('latency', { policy: 0 }), ap = last('latency', { policy: 2 });
    assert.ok(cp.m_p99 > ap.m_p99);
    assert.equal(cp.m_stale, 0);
    assert.ok(ap.m_stale >= 1);
});

test('repair: hints fix the outage; read repair fixes only keys that are read; anti-entropy fixes everything', () => {
    assert.ok(last('outage').m_stale >= 4);
    assert.equal(last('outage', { hints: 1 }).m_stale, 0);
    const rr = last('outage', { readRepair: 1 });
    assert.equal(rr.converged, 0, 'unread keys stay stale under read repair alone');
    const ae = last('outage', { ae: 6 });
    assert.equal(ae.converged, 1);
    assert.ok(ae.m_aeKeys >= 6 && ae.m_aeKeys <= 12, `anti-entropy exchanged ${ae.m_aeKeys} keys`);
});

test('Merkle comparison descends only into differing subtrees', () => {
    const rows = api.ddTrace('outage', { ae: 6 });
    const m = rows.find(r => r.merkle && r.merkle.diffKeys.length).merkle;
    assert.ok(m.compared < 15, 'fewer hashes compared than a full tree walk');
    assert.deepEqual(m.diffKeys, m.keys.filter((k, i) => k && m.diff.at(-1)[i]));
});

test('tombstones: purging before repair resurrects the deleted row; hints or a longer gc-grace prevent it', () => {
    assert.equal(last('resurrection').m_resurrected, 1);
    assert.equal(last('resurrection', { hints: 1 }).m_resurrected, 0);
    assert.equal(last('resurrection', { gcGrace: 30 }).m_resurrected, 0);
});

test('siblings: LWW drops one concurrent add; version vectors keep both and the client merges them', () => {
    assert.equal(last('siblings', { resolve: 0 }).m_lost, 1);
    const sib = last('siblings', { resolve: 1 });
    assert.equal(sib.m_lost, 0);
    assert.equal(sib.m_siblings, 1);
    assert.equal(sib.verGrid[0][0], 'eggs+milk');
});

test('comparison matrix: consensus-style profiles never lose or read stale; async and LWW profiles do somewhere', () => {
    const rowOf = id => lab.PROFILES.findIndex(p => p.id === id);
    const cols = lab.COMPARE_SCENARIOS.length;
    for (const id of ['spanner', 'mongo-majority', 'dynamo-strong']) for (let c = 0; c < cols; c++) assert.ok(api.ddProfileCell(rowOf(id), c) >= 2, `${id} × ${lab.COMPARE_SCENARIOS[c]}`);
    for (const id of ['pg-async', 'redis-cluster', 'cassandra-one']) assert.ok([...Array(cols).keys()].some(c => api.ddProfileCell(rowOf(id), c) <= 1), id);
    assert.equal(api.ddProfileCell(rowOf('cassandra-quorum'), lab.COMPARE_SCENARIOS.indexOf('cmp-concurrent')), 0, 'QUORUM + LWW still drops a concurrent write');
});

test('partitioning: range on time puts new writes on the last shard; hashing spreads them', () => {
    const time = lab.shardStats(1, 4, 120, 0), hash = lab.shardStats(2, 4, 120, 0);
    assert.equal(time.writes.indexOf(Math.max(...time.writes)), 3);
    assert.ok(time.imbalance > 2);
    assert.ok(hash.imbalance < 1.5);
    assert.ok(lab.shardStats(2, 4, 120, 1).imbalance > hash.imbalance, 'a celebrity key is hot under hashing too');
    assert.equal(hash.queries[1], 4, 'a range query on a hash-partitioned key asks every shard');
    assert.equal(lab.shardStats(0, 4, 120, 0).queries[0], 1);
});

test('consistent hashing moves about 1/(N+1) of keys, all to the new node; mod-N moves most', () => {
    for (const v of [1, 8, 32]) {
        const r = lab.ringStats(4, v, 1);
        assert.ok(r.movedN <= 48 * 0.4, `vnodes ${v}: moved ${r.movedN}`);
        assert.ok(r.movedModN >= 48 * 0.65, `mod-N moved ${r.movedModN}`);
        r.moved.forEach((m, i) => { if (m) assert.equal(r.ownA[i], 4, 'moved keys go to the new node'); });
    }
    assert.ok(lab.ringStats(4, 64, 0).sd < lab.ringStats(4, 1, 0).sd, 'virtual nodes even out the load');
});

test('capacity: replicas do not help a write-heavy load; shards do; a lone server failing is total', () => {
    const at = (o, wp) => lab.capacityTrace(o, 180, wp, 2, 0)[25];
    assert.ok(at(2, 80).latW > at(3, 80).latW * 2);
    assert.ok(at(2, 20).latR < at(0, 20).latR);
    const crash = (o) => lab.capacityTrace(o, 120, 20, 2, 20)[30];
    assert.equal(crash(0).availR, 0);
    assert.equal(crash(2).availR, 1);
    assert.equal(crash(2).availW, 0);
    assert.ok(crash(3).availW > 0 && crash(3).availW < 1);
});
