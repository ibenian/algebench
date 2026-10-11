// node --test static/domains/messaging/test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const sandbox = { window: { AlgeBenchDomains: { register: (name, functions) => { assert.equal(name, 'messaging'); sandbox.api = functions; } } } };
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync(new URL('./index.js', import.meta.url), 'utf8'), sandbox);
const { api } = sandbox;
const SYSTEMS = ['kafka', 'rabbitmq', 'sqs'];
const run = (system, overrides = {}) => api.mqTrace(system, [], overrides);
const last = (system, overrides) => run(system, overrides).at(-1);

test('every system registers and a trace has one row per tick plus tick 0', () => {
    assert.deepEqual([...api.mqSystems()].slice(0, 3), SYSTEMS);
    for (const s of SYSTEMS) assert.equal(run(s, { frames: 20 }).length, 21);
});

test('healthy run: every message completes exactly once', () => {
    for (const s of SYSTEMS) {
        const r = last(s);
        assert.equal(r.m_completed, 12, s);
        assert.equal(r.m_duplicates, 0, s);
        assert.equal(r.m_effects, 12, s);
        assert.equal(r.m_backlog, 0, s);
    }
});

test('Kafka retains consumed records; queues delete acknowledged messages', () => {
    assert.equal(last('kafka').m_retained, 12);
    assert.equal(last('rabbitmq').m_storage, 0);
    assert.equal(last('sqs').m_storage, 0);
});

test('crash between processing and acknowledgement duplicates the side effect in every system', () => {
    for (const s of SYSTEMS) {
        const r = last(s, { crashTick: 3, crashPoint: 2, restartDelay: 4 });
        assert.equal(r.m_duplicates, 1, s);
        assert.equal(r.m_completed, 12, s);
    }
});

test('crash before processing loses no work and duplicates nothing', () => {
    for (const s of SYSTEMS) {
        const r = last(s, { crashTick: 3, crashPoint: 1 });
        assert.equal(r.m_duplicates, 0, s);
        assert.equal(r.m_completed, 12, s);
    }
});

test('recovery timing follows each system\'s detection mechanism', () => {
    // RabbitMQ requeues on channel close in the same tick as the crash.
    const rabbit = run('rabbitmq', { crashTick: 3, crashPoint: 1 });
    const crashRow = rabbit.findIndex(r => r.ops.includes('crash'));
    assert.ok(rabbit[crashRow].ops.includes('requeue'));
    // Kafka waits for the session timeout before rebalancing.
    const kafka = run('kafka', { crashTick: 3, crashPoint: 1, sessionTimeout: 4 });
    const k = kafka.findIndex(r => r.ops.includes('crash'));
    const reb = kafka.findIndex((r, i) => i > k && r.ops.includes('joinGroup'));
    assert.equal(reb - k, 4);
    // SQS waits for the visibility timeout.
    const sqs = run('sqs', { crashTick: 3, crashPoint: 1, visibilityTimeout: 6 });
    const q = sqs.findIndex(r => r.ops.includes('crash'));
    const back = sqs.findIndex((r, i) => i > q && r.ops.includes('timeout'));
    assert.ok(back > q && back - q <= 6);
});

test('graceful shutdown neither duplicates nor stalls', () => {
    for (const s of SYSTEMS) {
        const r = last(s, { crashTick: 4, crashPoint: 4 });
        assert.equal(r.m_duplicates, 0, s);
        assert.equal(r.m_completed, 12, s);
    }
});

test('SQS: processing longer than the visibility timeout duplicates without any crash', () => {
    const r = last('sqs', { consumers: 3, slowConsumer: 1, slowTicks: 6, visibilityTimeout: 3 });
    assert.ok(r.m_duplicates > 0);
    assert.equal(r.m_crashes, 0);
});

test('Kafka: consumers beyond the partition count sit idle', () => {
    const rows = run('kafka', { partitions: 2, consumers: 4 });
    assert.equal(rows[5].m_idle, 2);
    assert.ok(rows[5].consumers.some(c => c.includes('idle')));
});

test('Kafka: a hot key concentrates load on one partition', () => {
    const r = last('kafka', { hotKey: 75, partitions: 3 });
    const sizes = r.partitionIds.map(p => p.length);
    assert.ok(sizes[0] >= 9, JSON.stringify(sizes));
});

test('poison message ends in dead-letter storage after maxAttempts', () => {
    for (const s of SYSTEMS) {
        const r = last(s, { poison: 2, maxAttempts: 3, frames: 60 });
        assert.equal(r.m_dlq, 1, s);
        assert.equal(r.m_completed, 11, s);
    }
});

test('replay: only the retained log can re-read history', () => {
    const k = last('kafka', { replayTick: 20, frames: 50 });
    assert.equal(k.m_duplicates, 12);
    for (const s of ['rabbitmq', 'sqs']) assert.equal(last(s, { replayTick: 20, frames: 50 }).m_duplicates, 0, s);
});

test('a late second subscriber sees history only on Kafka', () => {
    const k = last('kafka', { groups: 2, group2Tick: 10, frames: 60 });
    assert.equal(k.m_effects2, 12);
    for (const s of ['rabbitmq', 'sqs']) {
        const r = last(s, { groups: 2, group2Tick: 4, frames: 60 });
        assert.ok(r.m_effects2 < 12 && r.m_effects2 > 0, s + ' ' + r.m_effects2);
    }
});

test('Kafka retention ignores consumer progress', () => {
    const r = last('kafka', { retention: 4, consumers: 1, serviceTicks: 4, frames: 60 });
    assert.ok(r.m_lost > 0);
});

test('RabbitMQ max-length drop-head discards the oldest; reject-publish refuses new', () => {
    const drop = last('rabbitmq', { maxLength: 3, consumers: 1, serviceTicks: 4, frames: 60 });
    assert.ok(drop.m_lost > 0);
    const reject = last('rabbitmq', { maxLength: 3, overflow: 1, consumers: 1, serviceTicks: 4, frames: 60 });
    assert.ok(reject.m_rejected > 0);
    assert.equal(reject.m_lost, 0);
});

test('Kafka preserves per-key order through a crash; competing queue consumers can reorder', () => {
    assert.equal(last('kafka', { crashTick: 3, crashPoint: 1, restartDelay: 2 }).m_outOfOrder, 0);
    const rabbit = last('rabbitmq', { keys: 1, consumers: 3, prefetch: 1, slowConsumer: 1, slowTicks: 6 });
    assert.ok(rabbit.m_outOfOrder > 0);
});

test('broker outage buffers producers and blocks acknowledgements', () => {
    for (const s of SYSTEMS) {
        const rows = run(s, { outageStart: 3, outageTicks: 5, frames: 60 });
        assert.ok(rows[4].outage === 1);
        assert.equal(rows.at(-1).m_completed, 12, s);
    }
});

test('each row is JSON-serializable and deterministic', () => {
    for (const s of SYSTEMS) {
        const a = JSON.stringify(run(s, { crashTick: 3, crashPoint: 2 }));
        const b = JSON.stringify(api.mqTrace(s, [{ crashTick: 3 }], { crashPoint: 2 }));
        assert.equal(a, b);
    }
});

test('unknown options are rejected rather than ignored', () => {
    assert.throws(() => run('kafka', { partitons: 3 }), /Unknown messaging option/);
    assert.throws(() => run('nats', {}), /Unknown messaging system/);
});

test('message history traces one id across ticks', () => {
    const rows = run('sqs', { crashTick: 3, crashPoint: 2, restartDelay: 2 });
    const h = api.mqHistory(rows, rows.length - 1, 'm1', 40);
    assert.ok(h.some(t => t.includes('SendMessage m1')));
    assert.ok(h.some(t => t.includes('DeleteMessage')));
});
