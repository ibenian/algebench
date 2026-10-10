/**
 * Messaging systems laboratory — a deterministic, tick-based teaching model.
 *
 * One shared workload (producers, keyed messages, consumers with a service time,
 * scripted crashes/outages/poison messages) is replayed against several system
 * adapters. Each adapter owns its real conceptual structures (Kafka partitions,
 * offsets and group commits; RabbitMQ exchanges, ready/unacked deliveries and
 * prefetch; SQS visibility timeouts and receipt handles; ...). The core owns the
 * consumer runtime, side-effect accounting and the per-tick snapshot, so every
 * view (arrays, tensors, system_dag pipes, code highlights, captions, AI context)
 * reads one serializable row per tick.
 *
 * Ticks are scheduler intervals, not seconds. Nothing here is a physical layout:
 * array cells are logical records, not memory slots or segment files.
 */
(function () {
    'use strict';
    const SYSTEMS = new Map();
    const traceCache = new Map();
    const MAX_FRAMES = 120, MAX_MESSAGES = 60, MAX_CONSUMERS = 6;

    const int = (v, lo, hi, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback;
    };

    // ── Configuration ────────────────────────────────────────────────────────
    // Every option is a plain number so sliders, data tables and the AI can set it.
    const COMMON = {
        frames: [40, 1, MAX_FRAMES], messages: [12, 1, MAX_MESSAGES], producers: [1, 1, 4],
        produceRate: [2, 1, 6], keys: [4, 1, 12], hotKey: [0, 0, 100],
        consumers: [2, 1, MAX_CONSUMERS], serviceTicks: [2, 1, 8],
        slowConsumer: [0, 0, MAX_CONSUMERS], slowTicks: [6, 1, 12],
        crashConsumer: [1, 1, MAX_CONSUMERS], crashTick: [0, 0, MAX_FRAMES], crashPoint: [0, 0, 4], restartDelay: [0, 0, MAX_FRAMES],
        outageStart: [0, 0, MAX_FRAMES], outageTicks: [0, 0, MAX_FRAMES],
        poison: [0, 0, MAX_MESSAGES], maxAttempts: [3, 1, 10],
        groups: [1, 1, 2], group2Tick: [8, 1, MAX_FRAMES], replayTick: [0, 0, MAX_FRAMES],
        // System-specific knobs live in the same flat namespace; adapters read theirs.
        partitions: [3, 1, 6], maxPollRecords: [2, 1, 10], sessionTimeout: [2, 1, 10], retention: [0, 0, MAX_FRAMES],
        prefetch: [2, 1, 10], maxLength: [0, 0, MAX_MESSAGES], overflow: [0, 0, 1],
        visibilityTimeout: [4, 1, 20], receiveBatch: [1, 1, 10],
        claimIdle: [4, 1, 20], shards: [2, 1, 6], subscriptionType: [0, 0, 2], ackTimeout: [0, 0, 20],
    };
    /** Crash points, in the order a consumer reaches them in its loop. */
    const CRASH_POINTS = ['none', 'after receive · before processing', 'after processing · before acknowledgement', 'immediately (kill -9)', 'graceful shutdown'];

    function parseConfig(settings, overrides) {
        const rows = toRows(settings), raw = Object.assign({}, rows[0] || {}, plain(overrides));
        const cfg = {};
        for (const [key, [def, lo, hi]] of Object.entries(COMMON)) cfg[key] = int(raw[key], lo, hi, def);
        for (const key of Object.keys(raw)) if (!(key in COMMON)) throw new Error('Unknown messaging option: ' + key);
        return cfg;
    }
    function plain(v) {
        if (v == null) return {};
        if (typeof v.toJSON === 'function' && v.isMatrix) v = v.toArray();
        if (typeof v !== 'object' || Array.isArray(v)) throw new Error('Overrides must be an object');
        return v;
    }
    function toRows(v) {
        if (v == null || v === 0) return [];
        if (typeof v.toArray === 'function') v = v.toArray();
        if (!Array.isArray(v)) throw new Error('Settings must be a data table of row objects.');
        return v;
    }

    // ── Workload ─────────────────────────────────────────────────────────────
    /** Deterministic keyed messages: produceRate per tick, round-robin producers, optional hot key. */
    function workload(cfg) {
        const out = [];
        for (let i = 1; i <= cfg.messages; i++) {
            const hot = cfg.hotKey > 0 && Math.floor(i * cfg.hotKey / 100) > Math.floor((i - 1) * cfg.hotKey / 100);
            const key = hot ? 0 : (i - 1) % cfg.keys;
            out.push({ id: 'm' + i, seq: i, key: 'k' + key, keyIndex: key, producer: 'P' + (((i - 1) % cfg.producers) + 1),
                tick: 1 + Math.floor((i - 1) / cfg.produceRate), poison: cfg.poison === i });
        }
        return out;
    }

    // ── Shared runtime ───────────────────────────────────────────────────────
    function consumerName(i) { return 'C' + (i + 1); }
    function createRuntime(def, cfg) {
        const s = {
            cfg, def, t: 0, msgs: workload(cfg), byId: new Map(),
            consumers: [], producerBuffer: [], outage: false,
            life: {}, hist: {}, effects: {}, firstEffectSeq: {}, lastSeqByKey: {},
            m: { produced: 0, published: 0, deliveries: 0, redeliveries: 0, effects: 0, duplicates: 0, completed: 0,
                retries: 0, dlq: 0, lost: 0, outOfOrder: 0, rejected: 0, crashes: 0, replayed: 0, effects2: 0, throughput: 0 },
            prevCompleted: 0,
            crash: { armed: cfg.crashTick > 0 && cfg.crashPoint > 0, fired: false, restartAt: 0 },
        };
        for (const msg of s.msgs) { s.byId.set(msg.id, msg); s.life[msg.id] = 'pending'; s.hist[msg.id] = []; s.effects[msg.id] = 0; }
        for (let i = 0; i < cfg.consumers; i++) s.consumers.push(newConsumer(i, 'main', cfg));
        if (cfg.groups > 1) s.consumers.push(Object.assign(newConsumer(cfg.consumers, 'second', cfg), { name: 'A1', joinAt: cfg.group2Tick, alive: false }));
        def.init(s);
        return s;
    }
    function newConsumer(i, group, cfg) {
        return { index: i, name: consumerName(i), group, alive: true, buffer: [], current: null, joinAt: 0, crashedAt: 0,
            service: cfg.slowConsumer === i + 1 ? cfg.slowTicks : cfg.serviceTicks, completedHere: 0 };
    }

    function note(ctx, key, text) { if (text && !ctx.notes.has(key)) ctx.notes.set(key, text); }
    function event(s, ctx, id, text, state) {
        ctx.log.push({ m: id || '', text: 't' + s.t + ' ' + text });
        if (id && s.hist[id]) s.hist[id].push('t' + s.t + ' ' + text);
        if (id && state) s.life[id] = state;
    }
    function op(ctx, name) { ctx.ops[name] = (ctx.ops[name] || 0) + 1; }
    function flow(ctx, name, n = 1) { ctx.flows[name] = (ctx.flows[name] || 0) + n; }

    /** The application side effect (e.g. charging a card). Duplicates are counted per message id. */
    function sideEffect(s, ctx, c, d) {
        const msg = s.byId.get(d.m);
        if (c.group !== 'main') { s.m.effects2++; event(s, ctx, d.m, `${c.name} (second subscriber) processed ${d.m}`); op(ctx, 'process2'); return; }
        s.effects[d.m]++;
        s.m.effects++;
        if (s.effects[d.m] > 1) { s.m.duplicates++; note(ctx, 'dup', `**${d.m} was processed again** — its side effect now ran ${s.effects[d.m]}×. At-least-once delivery requires an idempotent handler.`); }
        else {
            const last = s.lastSeqByKey[msg.key] || 0;
            if (msg.seq < last) { s.m.outOfOrder++; note(ctx, 'ooo', `${d.m} (key ${msg.key}) completed after a later message with the same key — per-key order was not preserved.`); }
            s.lastSeqByKey[msg.key] = Math.max(last, msg.seq);
        }
        event(s, ctx, d.m, `${c.name} processed ${d.m} (side effect #${s.effects[d.m]})`, 'processed');
        op(ctx, 'process');
    }

    function crashConsumer(s, ctx, c, how) {
        s.m.crashes++;
        const lost = [c.current, ...c.buffer].filter(Boolean);
        event(s, ctx, c.current ? c.current.m : '', `${c.name} ${how === 'graceful' ? 'shuts down gracefully' : 'crashes'}${lost.length ? ' holding ' + lost.map(d => d.m).join(', ') : ''}`);
        op(ctx, how === 'graceful' ? 'shutdown' : 'crash');
        if (how === 'graceful') s.def.onStop(s, ctx, c, lost);
        else s.def.onCrash(s, ctx, c, lost);
        c.alive = false; c.current = null; c.buffer = []; c.crashedAt = s.t;
        if (s.cfg.restartDelay > 0) s.crash.restartAt = s.t + s.cfg.restartDelay;
        note(ctx, 'crash', how === 'graceful'
            ? `**${c.name} stopped cleanly.** ${s.def.stopNote}`
            : `**${c.name} crashed.** ${s.def.crashNote}`);
    }

    function lifecycleEvents(s, ctx) {
        const cfg = s.cfg, t = s.t;
        if (cfg.outageTicks > 0 && cfg.outageStart > 0) {
            const down = t >= cfg.outageStart && t < cfg.outageStart + cfg.outageTicks;
            if (down !== s.outage) {
                s.outage = down; op(ctx, down ? 'outage' : 'recover');
                event(s, ctx, '', down ? s.def.outageLabel + ' unavailable' : s.def.outageLabel + ' available again');
                note(ctx, 'outage', down ? s.def.outageNote : `**${s.def.outageLabel} recovered.** Buffered producer sends flush and consumers resume.`);
                s.def.onOutage(s, ctx, down);
            }
        }
        const victim = s.consumers[cfg.crashConsumer - 1];
        if (s.crash.armed && !s.crash.fired && victim && victim.alive && t >= cfg.crashTick) {
            if (cfg.crashPoint === 3) { s.crash.fired = true; crashConsumer(s, ctx, victim, 'kill'); }
            if (cfg.crashPoint === 4) { s.crash.fired = true; crashConsumer(s, ctx, victim, 'graceful'); }
        }
        if (s.crash.restartAt && t >= s.crash.restartAt && victim && !victim.alive) {
            s.crash.restartAt = 0; victim.alive = true; victim.joinAt = t;
            event(s, ctx, '', `${victim.name} restarts with an empty local state`); op(ctx, 'restart');
            s.def.onJoin(s, ctx, victim);
            note(ctx, 'restart', `**${victim.name} restarted.** ${s.def.restartNote}`);
        }
        for (const c of s.consumers) if (c.group === 'second' && !c.alive && !c.crashedAt && t >= c.joinAt) {
            c.alive = true; event(s, ctx, '', `Second subscriber ${c.name} attaches`); op(ctx, 'subscribe');
            s.def.onJoin(s, ctx, c);
            note(ctx, 'second', s.def.secondNote);
        }
        if (cfg.replayTick > 0 && t === cfg.replayTick) { op(ctx, 'replay'); s.def.onReplay(s, ctx); }
    }

    function processConsumers(s, ctx) {
        const cfg = s.cfg;
        // 1. Finish work whose service time elapsed, then acknowledge (or fail / crash).
        for (const c of s.consumers) {
            if (!c.alive || !c.current || c.current.doneAt > s.t) continue;
            const d = c.current, msg = s.byId.get(d.m);
            c.current = null;
            if (msg.poison && c.group === 'main') {
                s.m.retries++; op(ctx, 'fail');
                event(s, ctx, d.m, `${c.name} handler throws on ${d.m} (attempt ${d.attempt})`, 'failed');
                s.def.fail(s, ctx, c, d);
                continue;
            }
            sideEffect(s, ctx, c, d);
            if (s.crash.armed && !s.crash.fired && cfg.crashPoint === 2 && c.index === cfg.crashConsumer - 1 && s.t >= cfg.crashTick && c.group === 'main') {
                s.crash.fired = true; crashConsumer(s, ctx, c, 'crash');
                note(ctx, 'window', `The crash landed **between the side effect and the acknowledgement** — the broker never learns ${d.m} was processed.`);
                continue;
            }
            if (s.outage && s.def.ackNeedsBroker) {
                c.pendingAcks = (c.pendingAcks || []).concat([d]);
                event(s, ctx, d.m, `${c.name} cannot acknowledge ${d.m}: ${s.def.outageLabel} unavailable`);
                continue;
            }
            s.def.ack(s, ctx, c, d);
            c.completedHere++;
        }
        // 2. Retry acknowledgements that were blocked by an outage.
        if (!s.outage) for (const c of s.consumers) if (c.alive && c.pendingAcks && c.pendingAcks.length) {
            const pending = c.pendingAcks; c.pendingAcks = [];
            for (const d of pending) s.def.ack(s, ctx, c, d);
        }
        // 3. Fetch / receive / push new work, then start processing.
        if (!s.outage) s.def.dispatch(s, ctx);
        for (const c of s.consumers) {
            if (!c.alive || c.current || !c.buffer.length) continue;
            const d = c.buffer.shift();
            if (s.def.skipStale && s.def.skipStale(s, ctx, c, d)) continue;
            c.current = Object.assign(d, { doneAt: s.t + c.service, startedAt: s.t });
            event(s, ctx, d.m, `${c.name} starts processing ${d.m}`, c.group === 'main' ? 'processing' : null);
            if (s.crash.armed && !s.crash.fired && cfg.crashPoint === 1 && c.index === cfg.crashConsumer - 1 && s.t >= cfg.crashTick && c.group === 'main') {
                s.crash.fired = true; crashConsumer(s, ctx, c, 'crash');
                note(ctx, 'window', `The crash landed **after receiving but before processing** — no side effect happened; the question is only whether the message comes back.`);
            }
        }
    }

    function produce(s, ctx) {
        const due = s.msgs.filter(m => m.tick === s.t);
        for (const m of due) { s.m.produced++; s.producerBuffer.push(m); event(s, ctx, m.id, `${m.producer} sends ${m.id} (key ${m.key})`, 'buffered'); op(ctx, 'send'); }
        if (s.outage) {
            if (s.producerBuffer.length) note(ctx, 'buffer', `${s.producerBuffer.length} send(s) wait in the producer's client buffer; ${s.def.producerRetryNote}`);
            return;
        }
        const flush = s.producerBuffer.splice(0);
        for (const m of flush) {
            s.m.published++;
            s.def.store(s, ctx, m);
        }
    }

    function snapshot(s, ctx) {
        s.m.throughput = s.m.completed - s.prevCompleted; s.prevCompleted = s.m.completed;
        const consumers = s.consumers.map(c => s.def.describeConsumer(s, c));
        const metrics = s.def.metrics(s);
        const notes = [...ctx.notes.values()];
        const header = `**Tick ${s.t}${s.outage ? ' · ' + s.def.outageLabel + ' down' : ''}.** `;
        const text = notes.length ? notes.join(' ') : ctx.log.length ? ctx.log.map(e => e.text.replace(/^t\d+ /, '')).join('; ') + '.' : s.def.idleNote(s);
        // Captions keep the two most instructive notes; routine mechanics rank last.
        const ranked = [...ctx.notes.entries()].map(([k, v], i) => [ROUTINE.has(k) ? 1 : 0, i, v]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(e => e[2]);
        const brief = ranked.length ? ranked[0] : text;
        const row = Object.assign({ tick: s.t, message: header + text, text, brief, system: s.def.label, action: ctx.log.map(e => e.text).join('; ') || 't' + s.t + ' no transition',
            log: ctx.log.slice(), ops: Object.keys(ctx.ops), consumers, life: Object.assign({}, s.life), outage: s.outage ? 1 : 0 },
            prefixed('m_', Object.assign({}, s.m, metrics)), prefixed('flow_', ctx.flows), prefixed('op_', ctx.ops), s.def.snapshot(s));
        return JSON.parse(JSON.stringify(row));
    }
    const ROUTINE = new Set(['append', 'route', 'send', 'push', 'receive', 'poll', 'pollmain', 'pollsecond', 'commitmain', 'commitsecond', 'ack', 'delete', 'start']);
    function prefixed(prefix, obj) { const out = {}; for (const [k, v] of Object.entries(obj)) out[prefix + k] = v; return out; }

    function run(id, settings, overrides) {
        const def = SYSTEMS.get(id);
        if (!def) throw new Error('Unknown messaging system: ' + id + '. Known: ' + [...SYSTEMS.keys()].join(', '));
        const cfg = parseConfig(settings, overrides);
        const key = id + ':' + JSON.stringify(cfg);
        if (traceCache.has(key)) return traceCache.get(key);
        const s = createRuntime(def, cfg);
        const rows = [snapshot(s, { log: [], ops: {}, flows: {}, notes: new Map([['start', def.startNote]]) })];
        for (s.t = 1; s.t <= cfg.frames; s.t++) {
            const ctx = { log: [], ops: {}, flows: {}, notes: new Map() };
            lifecycleEvents(s, ctx);
            def.housekeeping(s, ctx);
            processConsumers(s, ctx);
            produce(s, ctx);
            rows.push(snapshot(s, ctx));
        }
        if (traceCache.size >= 48) traceCache.delete(traceCache.keys().next().value);
        traceCache.set(key, rows);
        return rows;
    }

    // ── Helpers shared by adapters ──────────────────────────────────────────
    const live = (s, group = 'main') => s.consumers.filter(c => c.alive && c.group === group);
    function delivery(s, ctx, c, m, extra) {
        const d = Object.assign({ m, attempt: 1 }, extra);
        s.m.deliveries++;
        return d;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Apache Kafka — partitioned, retained log; consumers own positions.
    // ═════════════════════════════════════════════════════════════════════════
    SYSTEMS.set('kafka', {
        label: 'Apache Kafka', outageLabel: 'Kafka cluster', ackNeedsBroker: true,
        startNote: 'Topic **orders** has empty partitions. Producers will hash each key to a partition; the consumer group **billing** will be assigned partitions.',
        crashNote: 'Its partitions are not reassigned until the group coordinator misses its heartbeats (session timeout). Records it fetched but did not commit will be read again by the next owner from the **last committed offset**.',
        stopNote: 'A clean `close()` commits processed offsets and leaves the group, so the coordinator rebalances immediately — nothing processed is re-read.',
        restartNote: 'It rejoins the group; the coordinator rebalances partitions and each owner resumes from the committed offsets stored in `__consumer_offsets`.',
        secondNote: '**Consumer group analytics joins.** A new group has no committed offsets, so with `auto.offset.reset=earliest` it reads every retained record from offset 0 — the log is shared, positions are per group.',
        outageNote: '**Kafka brokers are unreachable.** Producers keep records in their accumulator and retry until `delivery.timeout.ms`; `poll()` returns nothing and offset commits fail.',
        producerRetryNote: 'the Kafka producer retries them from its accumulator.',
        idleNote: s => s.t > 0 && s.m.completed + s.m.dlq + s.m.lost >= s.cfg.messages ? 'All records are committed. **They remain in the log** until retention removes them; consumer positions are just numbers.' : 'No transition this tick.',
        init(s) {
            const P = s.cfg.partitions;
            s.k = { log: Array.from({ length: P }, () => []), start: Array(P).fill(0), committed: Array(P).fill(0), committed2: Array(P).fill(0),
                owner: Array(P).fill(-1), position: Array(P).fill(0), position2: Array(P).fill(0), dlt: [], pendingRebalance: 0, generation: 0, done: new Set() };
            assignKafka(s, null);
        },
        store(s, ctx, m) {
            const p = m.keyIndex % s.cfg.partitions, log = s.k.log[p];
            const offset = s.k.start[p] + log.length;
            log.push({ m: m.id, at: s.t, offset });
            event(s, ctx, m.id, `append ${m.id} → partition ${p} @ offset ${offset}`, 'stored');
            op(ctx, 'append'); flow(ctx, 'append'); flow(ctx, 'p' + p);
            note(ctx, 'append', `Producers append to partitions by key hash — \`${m.key}\` always maps to **p${p}**, which is how Kafka keeps per-key order.`);
        },
        housekeeping(s, ctx) {
            const k = s.k;
            if (k.pendingRebalance && s.t >= k.pendingRebalance) { k.pendingRebalance = 0; requestRebalance(s, ctx); }
            // Eager protocol: the new assignment lands once every member has finished its in-hand record and rejoined via poll().
            if (k.seekPending && !live(s).some(c => c.current)) { k.seekPending = false; s.def.applySeek(s, ctx); }
            if (k.rebalancing) {
                const busy = live(s).filter(c => c.current);
                if (!busy.length) { k.rebalancing = false; assignKafka(s, ctx); }
                else note(ctx, 'rejoin', `Rebalance in progress: waiting for ${busy.map(c => c.name).join(', ')} to finish ${busy.map(c => c.current.m).join(', ')} and rejoin. Partitions are paused group-wide (stop-the-world).`);
            }
            if (s.cfg.retention > 0) for (let p = 0; p < k.log.length; p++) {
                while (k.log[p].length && k.log[p][0].at + s.cfg.retention <= s.t) {
                    const r = k.log[p].shift(); k.start[p]++;
                    const unread = r.offset >= k.committed[p] && !k.done.has(r.m);
                    if (unread) { s.m.lost++; event(s, ctx, r.m, `retention deletes ${r.m} before group billing committed it`, 'expired'); note(ctx, 'retention-lost', `**Retention deleted unconsumed data.** Retention is time/size based and ignores consumer progress; a lagging group loses records and \`auto.offset.reset\` moves it forward.`); }
                    else { event(s, ctx, r.m, `retention deletes ${r.m} from p${p}`, s.life[r.m] === 'acked' ? 'deleted' : s.life[r.m]); note(ctx, 'retention', `Retention removed the oldest records from the head of the log (real brokers delete whole segments). Consumers did not cause this.`); }
                    op(ctx, 'retention');
                    if (k.committed[p] < k.start[p]) k.committed[p] = k.start[p];
                    if (k.position[p] < k.start[p]) k.position[p] = k.start[p];
                    if (k.committed2[p] < k.start[p]) k.committed2[p] = k.start[p];
                    if (k.position2[p] < k.start[p]) k.position2[p] = k.start[p];
                }
            }
        },
        dispatch(s, ctx) {
            const k = s.k;
            for (const c of s.consumers) {
                if (!c.alive || c.current || c.buffer.length) continue;
                const second = c.group === 'second';
                if (!second && (k.rebalancing || k.seekPending)) continue;
                const parts = second ? k.log.map((_, p) => p) : k.owner.map((o, p) => o === c.index ? p : -1).filter(p => p >= 0);
                if (!parts.length) continue;
                const pos = second ? k.position2 : k.position, committed = second ? k.committed2 : k.committed;
                // A record committed by an in-flight finish after a rebalance is never fetched twice by its owner.
                for (const p of parts) pos[p] = Math.max(pos[p], committed[p], k.start[p]);
                const got = [];
                // poll(): round-robin across assigned partitions up to max.poll.records.
                for (let pass = 0; got.length < s.cfg.maxPollRecords && pass < s.cfg.maxPollRecords; pass++) {
                    for (const p of parts) {
                        if (got.length >= s.cfg.maxPollRecords) break;
                        const i = pos[p] - k.start[p];
                        const r = k.log[p][i];
                        if (!r) continue;
                        got.push(delivery(s, ctx, c, r.m, { p, offset: r.offset, group: c.group }));
                        pos[p]++;
                    }
                }
                if (!got.length) continue;
                op(ctx, second ? 'poll2' : 'poll'); flow(ctx, second ? 'poll2' : 'poll', got.length);
                for (const d of got) {
                    const again = !second && s.effects[d.m] > 0;
                    if (again) s.m.redeliveries++;
                    event(s, ctx, d.m, `${c.name} poll() fetches ${d.m} (p${d.p}@${d.offset})${again ? ' again' : ''}`, second ? s.life[d.m] : 'fetched');
                }
                c.buffer.push(...got);
                note(ctx, 'poll' + c.group, second
                    ? `Group **analytics** reads the same records independently; its offsets do not affect group billing.`
                    : `\`poll()\` advances the consumer's **in-memory position**; nothing is removed from the log and nothing is committed yet.`);
            }
        },
        skipStale(s, ctx, c, d) {
            // Records fetched for a partition this consumer no longer owns are discarded after a rebalance.
            if (c.group === 'main' && s.k.owner[d.p] !== c.index) { event(s, ctx, d.m, `${c.name} drops fetched ${d.m}: p${d.p} was revoked`); return true; }
            return false;
        },
        ack(s, ctx, c, d) {
            const k = s.k, second = d.group === 'second';
            const committed = second ? k.committed2 : k.committed;
            committed[d.p] = Math.max(committed[d.p], d.offset + 1);
            op(ctx, second ? 'commit2' : 'commit'); flow(ctx, second ? 'commit2' : 'commit');
            if (!second) { k.done.add(d.m); s.m.completed = k.done.size; event(s, ctx, d.m, `${c.name} commitSync p${d.p} → offset ${d.offset + 1}`, 'acked'); }
            else event(s, ctx, d.m, `analytics commits p${d.p} → ${d.offset + 1}`);
            note(ctx, 'commit' + d.group, second ? '' : `**Commit stores the next offset to read** (offset + 1) for the group. The record itself stays in the partition.`);
        },
        fail(s, ctx, c, d) {
            // Kafka has no broker-side redelivery: the application retries in place, then publishes to a dead-letter topic.
            if (d.attempt < s.cfg.maxAttempts) {
                c.buffer.unshift(Object.assign({}, d, { attempt: d.attempt + 1 })); s.m.redeliveries++;
                note(ctx, 'hol', `The handler retries **${d.m} in place** — Kafka has no per-message ack, so later records in p${d.p} wait behind it (head-of-line blocking).`);
            } else {
                s.k.dlt.push(d.m); s.m.dlq++;
                event(s, ctx, d.m, `${c.name} publishes ${d.m} to orders.DLT and commits past it`, 'dlq');
                op(ctx, 'dlt'); flow(ctx, 'dlt');
                s.k.committed[d.p] = Math.max(s.k.committed[d.p], d.offset + 1); op(ctx, 'commit');
                note(ctx, 'dlt', `After ${s.cfg.maxAttempts} attempts the application **publishes ${d.m} to a dead-letter topic** (a convention, e.g. Spring's DLT) and commits past it so the partition unblocks.`);
            }
        },
        onCrash(s, ctx, c, lost) {
            // Fetched or half-processed records simply remain in the log; only a processed one carries a side effect.
            for (const d of lost) if (s.life[d.m] === 'fetched' || s.life[d.m] === 'processing') s.life[d.m] = 'stored';
            s.k.pendingRebalance = s.t + s.cfg.sessionTimeout;
            note(ctx, 'session', `Rebalance is scheduled at tick ${s.k.pendingRebalance} (session timeout ${s.cfg.sessionTimeout}); until then ${c.name}'s partitions stall.`);
        },
        onStop(s, ctx, c, lost) {
            if (c.current) { /* graceful: finish in-hand record and commit it */ }
            for (const d of lost) if (d === c.current) {
                sideEffect(s, ctx, c, d); s.def.ack(s, ctx, c, d);
            }
            c.alive = false; requestRebalance(s, ctx);
        },
        onJoin(s, ctx, c) { if (c.group === 'main') requestRebalance(s, ctx); },
        onReplay(s, ctx) {
            // seekToBeginning() after in-hand records finish, so no late commit overwrites the reset.
            s.k.seekPending = true;
            for (const c of live(s)) c.buffer = [];
            note(ctx, 'seek', 'Replay requested: consumers finish their in-hand record, then seek every assigned partition to the earliest retained offset.');
        },
        applySeek(s, ctx) {
            const k = s.k;
            for (let p = 0; p < k.log.length; p++) { k.committed[p] = k.start[p]; k.position[p] = k.start[p]; }
            s.m.replayed++;
            event(s, ctx, '', 'offsets of group billing reset to earliest');
            note(ctx, 'replay', `**Offsets reset to earliest.** Every retained record is read again — replay is possible because consuming never deleted anything. (Production: \`kafka-consumer-groups --reset-offsets --to-earliest\` on an inactive group, or \`seek()\`.)`);
        },
        onOutage() {},
        describeConsumer(s, c) {
            if (c.group === 'second') return `${c.name} · analytics · ${c.alive ? 'all partitions' : 'not yet subscribed'}`;
            if (!c.alive) return `${c.name} · down`;
            const parts = s.k.owner.map((o, p) => o === c.index ? 'p' + p : '').filter(Boolean);
            return `${c.name} · ${parts.length ? parts.join(',') : 'idle (no partition)'}${c.current ? ' · ' + c.current.m : ''}`;
        },
        metrics(s) {
            const k = s.k;
            const end = k.log.map((l, p) => k.start[p] + l.length);
            const lag = end.reduce((n, e, p) => n + e - k.committed[p], 0);
            const lag2 = end.reduce((n, e, p) => n + e - k.committed2[p], 0);
            const retained = k.log.reduce((n, l) => n + l.length, 0);
            const inflight = s.consumers.filter(c => c.group === 'main').reduce((n, c) => n + c.buffer.length + (c.current ? 1 : 0), 0);
            const idle = live(s).filter(c => !k.owner.includes(c.index)).length;
            return { backlog: lag, lag, lag2, retained, inflight, idle, storage: retained, dlqSize: k.dlt.length, generation: k.generation };
        },
        snapshot(s) {
            const k = s.k, W = 14;
            const gridIds = [], gridOffsets = [], rows = [];
            for (let p = 0; p < 6; p++) {
                const log = k.log[p] || [], start = k.start[p] || 0;
                const end = start + log.length, base = Math.max(start, end - W);
                const ids = [], offsets = [];
                for (let col = 0; col < W; col++) {
                    const off = base + col, r = log[off - start];
                    ids.push(r ? r.m : ''); offsets.push(r ? off : -1);
                }
                gridIds.push(ids); gridOffsets.push(offsets);
                rows.push(p < s.cfg.partitions ? `p${p}→${k.owner[p] >= 0 ? consumerName(k.owner[p]) : '—'} @${k.committed[p]}` : '');
            }
            const partitionIds = k.log.map(l => l.map(r => r.m));
            return { settings: `partitions ${s.cfg.partitions} · max.poll.records ${s.cfg.maxPollRecords} · session timeout ${s.cfg.sessionTimeout}${s.cfg.retention ? ' · retention ' + s.cfg.retention : ''}`,
                gridIds, gridOffsets, gridRows: rows, partitionIds, committed: k.committed.slice(), positions: k.position.slice(), logStart: k.start.slice(),
                logEnd: k.log.map((l, p) => k.start[p] + l.length), owners: k.owner.map(o => o >= 0 ? consumerName(o) : '—'), dlt: k.dlt.slice(),
                committed2: k.committed2.slice() };
        },
    });
    function requestRebalance(s, ctx) {
        s.k.rebalancing = true;
        // Revocation: fetched-but-unprocessed records are dropped; in-hand records finish and commit.
        for (const c of live(s)) {
            for (const d of c.buffer) event(s, ctx, d.m, `${c.name} drops fetched ${d.m}: partitions revoked for rebalance`, s.life[d.m] === 'fetched' ? 'stored' : s.life[d.m]);
            c.buffer = [];
        }
        op(ctx, 'joinGroup');
    }
    function assignKafka(s, ctx) {
        const k = s.k, members = live(s).map(c => c.index).sort((a, b) => a - b), P = s.cfg.partitions;
        const before = k.owner.join(',');
        // RangeAssignor: contiguous partition ranges; members beyond the partition count stay idle.
        const n = members.length;
        for (let p = 0; p < P; p++) k.owner[p] = -1;
        if (n) {
            const per = Math.floor(P / n), extra = P % n;
            let p = 0;
            members.forEach((m, i) => { const take = per + (i < extra ? 1 : 0); for (let j = 0; j < take; j++) k.owner[p++] = m; });
        }
        // A new owner resumes from the group's committed offset, not the previous owner's in-memory position.
        for (let p = 0; p < P; p++) k.position[p] = k.committed[p];
        if (ctx && before !== k.owner.join(',')) {
            k.generation++;
            op(ctx, 'rebalance'); event(s, ctx, '', `rebalance (generation ${k.generation}): ` + k.owner.map((o, p) => `p${p}→${o >= 0 ? consumerName(o) : '—'}`).join(' '));
            const idle = members.length - Math.min(members.length, P);
            note(ctx, 'rebalance', `**Rebalance.** Partitions are reassigned and every new owner starts from the **committed** offset, so fetched-but-uncommitted records are read again.${idle > 0 ? ` ${idle} consumer(s) are idle: a group can't use more consumers than partitions.` : ''}`);
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RabbitMQ — exchange routes to a queue; broker pushes up to prefetch unacked.
    // ═════════════════════════════════════════════════════════════════════════
    SYSTEMS.set('rabbitmq', {
        label: 'RabbitMQ', outageLabel: 'RabbitMQ node', ackNeedsBroker: true,
        startNote: 'Exchange **orders** (direct) is bound to quorum queue **billing**. Consumers subscribe with `basic.consume` and a prefetch (QoS) window.',
        crashNote: 'When its channel closes, the broker **requeues every unacknowledged delivery** (marked `redelivered`) and pushes them to other consumers.',
        stopNote: 'It cancels its subscription; the delivery it was processing is acked, and prefetched-but-unprocessed deliveries are requeued when the channel closes.',
        restartNote: 'It opens a new channel and `basic.consume`; the broker starts pushing ready messages within its prefetch window.',
        secondNote: '**Queue analytics is declared and bound to the exchange.** It only receives messages published **after** the binding exists — messages already routed (or acked) elsewhere are not copied.',
        outageNote: '**The RabbitMQ node is down.** Publishers get connection errors and buffer/retry; consumer channels close, so their unacked deliveries return to ready when the queue recovers — late acks from the old channel are invalid.',
        producerRetryNote: 'the publisher retries after reconnecting (publisher confirms tell it what reached the queue).',
        idleNote: s => s.t > 0 && !s.r.ready.length && !unackedCount(s) ? 'Queue is empty. **Acked messages are gone** — RabbitMQ deletes a message once it is acknowledged.' : 'No transition this tick.',
        init(s) { s.r = { ready: [], unacked: {}, dlq: [], second: [], secondBound: false, deliveryCount: {} }; for (const c of s.consumers) s.r.unacked[c.name] = []; },
        store(s, ctx, m) {
            op(ctx, 'publish'); flow(ctx, 'publish');
            const r = s.r;
            if (s.cfg.maxLength > 0 && r.ready.length + unackedCount(s) >= s.cfg.maxLength) {
                if (s.cfg.overflow === 1) { s.m.rejected++; event(s, ctx, m.id, `queue full: publish of ${m.id} rejected (reject-publish → nack to publisher)`, 'rejected'); note(ctx, 'overflow', `**Queue at max-length.** With \`overflow=reject-publish\` the broker nacks new publishes; a publisher using confirms sees the rejection and can retry.`); return; }
                const dropped = r.ready.shift();
                if (dropped) { s.m.lost++; event(s, ctx, dropped.m, `queue full: drop-head discards ${dropped.m}`, 'dropped'); note(ctx, 'overflow', `**Queue at max-length.** The default \`drop-head\` overflow **discards the oldest ready message** to admit the new one.`); }
            }
            r.ready.push({ m: m.id, redelivered: false });
            event(s, ctx, m.id, `exchange routes ${m.id} → queue billing (ready)`, 'stored');
            flow(ctx, 'route');
            if (r.secondBound) { r.second.push({ m: m.id }); flow(ctx, 'route2'); }
            note(ctx, 'route', `The exchange routes by binding (routing key \`orders.created\`). The queue now **owns** the message until a consumer acks it.`);
        },
        housekeeping() {},
        dispatch(s, ctx) {
            const r = s.r, consumers = live(s);
            // Round-robin push while consumers have prefetch credit (basic.qos).
            let pushed = true;
            while (pushed && r.ready.length) {
                pushed = false;
                for (const c of consumers) {
                    if (!r.ready.length) break;
                    const credit = s.cfg.prefetch - r.unacked[c.name].length;
                    if (credit <= 0) continue;
                    const item = r.ready.shift();
                    r.deliveryCount[item.m] = (r.deliveryCount[item.m] || 0) + 1;
                    const d = delivery(s, ctx, c, item.m, { tag: r.deliveryCount[item.m], redelivered: item.redelivered, attempt: r.deliveryCount[item.m] });
                    r.unacked[c.name].push(d); c.buffer.push(d); pushed = true;
                    if (item.redelivered) s.m.redeliveries++;
                    event(s, ctx, item.m, `broker pushes ${item.m} to ${c.name}${item.redelivered ? ' (redelivered=true)' : ''} · unacked`, 'unacked');
                    op(ctx, 'deliver'); flow(ctx, 'deliver');
                }
            }
            if (ctx.ops.deliver) note(ctx, 'push', `The broker **pushes** deliveries; each stays **unacked** (still owned by the queue) until \`basic_ack\`. Prefetch ${s.cfg.prefetch} caps unacked deliveries per consumer — that cap is RabbitMQ's consumer backpressure.`);
            const a = s.consumers.find(c => c.group === 'second' && c.alive);
            if (a && !a.current && !a.buffer.length && r.second.length) { const item = r.second.shift(); a.buffer.push(delivery(s, ctx, a, item.m, {})); flow(ctx, 'deliver2'); op(ctx, 'deliver2'); }
        },
        ack(s, ctx, c, d) {
            if (c.group === 'second') { op(ctx, 'ack2'); return; }
            const list = s.r.unacked[c.name], i = list.indexOf(d);
            if (i < 0) { event(s, ctx, d.m, `${c.name} basic_ack for ${d.m} ignored: its channel was closed (stale delivery tag)`); note(ctx, 'stale', `An ack on a closed channel is invalid; the broker already requeued ${d.m} and may deliver it again.`); return; }
            list.splice(i, 1); s.m.completed++;
            event(s, ctx, d.m, `${c.name} basic_ack(${d.m}) → broker deletes it`, 'acked');
            op(ctx, 'ack'); flow(ctx, 'ack');
            note(ctx, 'ack', `\`basic_ack\` tells the broker the delivery is done; the broker **deletes** the message and frees a prefetch slot.`);
        },
        fail(s, ctx, c, d) {
            const r = s.r, list = r.unacked[c.name], i = list.indexOf(d);
            if (i >= 0) list.splice(i, 1);
            if (r.deliveryCount[d.m] >= s.cfg.maxAttempts) {
                r.dlq.push(d.m); s.m.dlq++; op(ctx, 'nack'); op(ctx, 'dlx'); flow(ctx, 'dlx');
                event(s, ctx, d.m, `${c.name} basic_nack(${d.m}); delivery-limit ${s.cfg.maxAttempts} reached → dead-letter exchange`, 'dlq');
                note(ctx, 'dlx', `The quorum queue counts deliveries; past \`x-delivery-limit\` it **dead-letters** the message through the DLX instead of requeueing it.`);
            } else {
                r.ready.unshift({ m: d.m, redelivered: true }); op(ctx, 'nack'); flow(ctx, 'requeue');
                event(s, ctx, d.m, `${c.name} basic_nack(requeue=true) → ${d.m} back to ready`, 'stored');
                note(ctx, 'requeue', `\`basic_nack(requeue=True)\` returns ${d.m} to the **head** of the queue for immediate redelivery — no backoff unless you add a delay/retry queue.`);
            }
        },
        onCrash(s, ctx, c) { requeueUnacked(s, ctx, c); },
        onStop(s, ctx, c, lost) {
            if (c.current) { sideEffect(s, ctx, c, c.current); s.def.ack(s, ctx, c, c.current); }
            requeueUnacked(s, ctx, c);
        },
        onJoin(s, ctx, c) {
            if (c.group === 'second') { s.r.secondBound = true; return; }
            s.r.unacked[c.name] = s.r.unacked[c.name] || [];
        },
        onReplay(s, ctx) {
            note(ctx, 'replay', `**Replay is not possible here.** Acked messages were deleted; the queue holds only unconsumed work. (Keeping history needs a separate store — or a RabbitMQ *stream* queue, which is a log.)`);
            event(s, ctx, '', 'replay requested: nothing retained to replay');
        },
        onOutage(s, ctx, down) {
            if (!down) return;
            for (const c of live(s)) {
                if (!s.r.unacked[c.name].length) continue;
                requeueUnacked(s, ctx, c);
                // The client still holds the deliveries but its channel is gone.
                c.buffer = []; if (c.current) c.current.staleChannel = true;
            }
        },
        skipStale() { return false; },
        describeConsumer(s, c) {
            if (c.group === 'second') return `${c.name} · queue analytics · ${c.alive ? 'consuming' : 'not bound yet'}`;
            if (!c.alive) return `${c.name} · down`;
            return `${c.name} · unacked ${s.r.unacked[c.name].length}/${s.cfg.prefetch}${c.current ? ' · ' + c.current.m : ''}`;
        },
        metrics(s) {
            const u = unackedCount(s);
            return { backlog: s.r.ready.length + u, ready: s.r.ready.length, unacked: u, inflight: u, storage: s.r.ready.length + u, dlqSize: s.r.dlq.length, second: s.r.second.length };
        },
        snapshot(s) {
            const unacked = {};
            for (let i = 0; i < MAX_CONSUMERS; i++) unacked['unacked' + (i + 1)] = (s.r.unacked['C' + (i + 1)] || []).map(d => d.m);
            const unackedGrid = Array.from({ length: MAX_CONSUMERS }, (_, i) => Array.from({ length: 10 }, (_, j) => ((s.r.unacked['C' + (i + 1)] || [])[j] || {}).m || ''));
            const unackedRows = Array.from({ length: MAX_CONSUMERS }, (_, i) => i < s.cfg.consumers ? `C${i + 1} ${s.consumers[i].alive ? (s.r.unacked['C' + (i + 1)] || []).length + '/' + s.cfg.prefetch : 'down'}` : '');
            return Object.assign({ settings: `prefetch ${s.cfg.prefetch} · delivery-limit ${s.cfg.maxAttempts}${s.cfg.maxLength ? ' · max-length ' + s.cfg.maxLength + (s.cfg.overflow ? ' reject-publish' : ' drop-head') : ''}`,
                ready: s.r.ready.map(x => x.m), dlqIds: s.r.dlq.slice(), secondQueue: s.r.second.map(x => x.m), unackedGrid, unackedRows }, unacked);
        },
    });
    function unackedCount(s) { return Object.values(s.r.unacked).reduce((n, l) => n + l.length, 0); }
    function requeueUnacked(s, ctx, c) {
        const list = s.r.unacked[c.name] || [];
        if (!list.length) return;
        // Requeued messages go back near the head, preserving their relative order.
        s.r.ready.unshift(...list.map(d => ({ m: d.m, redelivered: true })));
        for (const d of list) event(s, ctx, d.m, `channel closed: ${d.m} requeued (redelivered=true)`, 'stored');
        op(ctx, 'requeue'); flow(ctx, 'requeue', list.length);
        s.r.unacked[c.name] = [];
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Amazon SQS — pull-based; received messages become invisible for a timeout.
    // ═════════════════════════════════════════════════════════════════════════
    SYSTEMS.set('sqs', {
        label: 'Amazon SQS', outageLabel: 'SQS endpoint', ackNeedsBroker: true,
        startNote: 'Standard queue **billing** is empty. Consumers call `ReceiveMessage`; a received message becomes **invisible** for the visibility timeout and must be deleted with its receipt handle.',
        crashNote: 'SQS is not told anything. Its in-flight messages stay **invisible until the visibility timeout expires**, then any consumer can receive them again.',
        stopNote: 'On shutdown it releases unprocessed messages with `ChangeMessageVisibility(…, 0)` so they are visible immediately.',
        restartNote: 'It simply starts calling `ReceiveMessage` again — SQS keeps no per-consumer state.',
        secondNote: '**An SNS subscription adds queue analytics.** SQS has no consumer groups: a second independent reader needs its own queue, and it only sees messages published after it was subscribed.',
        outageNote: '**SQS API calls are failing** (simulated regional impairment). SDK calls retry with backoff; visibility timers keep running on the service side.',
        producerRetryNote: 'the SDK retries `SendMessage` with exponential backoff.',
        idleNote: s => s.t > 0 && !s.q.visible.length && !s.q.inflight.length ? 'Queue is empty. Deleted messages cannot be received again.' : 'No transition this tick.',
        init(s) { s.q = { visible: [], inflight: [], dlq: [], second: [], secondBound: false, receives: {}, handles: {}, nextHandle: 1 }; },
        store(s, ctx, m) {
            op(ctx, 'sendMessage'); flow(ctx, 'send');
            s.q.visible.push({ m: m.id, sent: s.t });
            s.q.receives[m.id] = 0;
            event(s, ctx, m.id, `SendMessage ${m.id} → visible`, 'stored');
            if (s.q.secondBound) { s.q.second.push({ m: m.id }); flow(ctx, 'send2'); }
            note(ctx, 'send', `\`SendMessage\` stores ${m.id} redundantly; it is **visible** and any consumer may receive it.`);
        },
        housekeeping(s, ctx) {
            const q = s.q;
            for (let i = q.inflight.length - 1; i >= 0; i--) {
                const f = q.inflight[i];
                if (f.until > s.t) continue;
                q.inflight.splice(i, 1);
                q.visible.unshift({ m: f.m, sent: f.sent });
                event(s, ctx, f.m, `visibility timeout expired: ${f.m} visible again (receive count ${q.receives[f.m]})`, s.life[f.m] === 'processing' ? 'processing' : 'stored');
                op(ctx, 'timeout'); flow(ctx, 'timeout');
                note(ctx, 'vt', `**Visibility timeout expired** for ${f.m}. SQS can't tell a crashed consumer from a slow one — the message becomes receivable again${s.life[f.m] === 'processing' ? ', **while the first consumer is still working on it**' : ''}.`);
            }
            // Redrive policy: on receive, messages over maxReceiveCount move to the DLQ (checked in dispatch).
        },
        dispatch(s, ctx) {
            const q = s.q;
            for (const c of live(s)) {
                if (c.current || c.buffer.length || !q.visible.length) continue;
                const got = [];
                while (got.length < s.cfg.receiveBatch && q.visible.length) {
                    const v = q.visible.shift();
                    if (q.receives[v.m] >= s.cfg.maxAttempts) {
                        q.dlq.push(v.m); s.m.dlq++; op(ctx, 'redrive'); flow(ctx, 'dlq');
                        event(s, ctx, v.m, `redrive policy moves ${v.m} to billing-dlq (maxReceiveCount ${s.cfg.maxAttempts})`, 'dlq');
                        note(ctx, 'dlq', `The **redrive policy** moves a message to the DLQ once its receive count exceeds \`maxReceiveCount\` — SQS counts receives, not failures.`);
                        continue;
                    }
                    q.receives[v.m]++;
                    const handle = 'rh' + (q.nextHandle++);
                    q.handles[v.m] = handle;
                    const d = delivery(s, ctx, c, v.m, { handle, attempt: q.receives[v.m] });
                    if (q.receives[v.m] > 1) s.m.redeliveries++;
                    q.inflight.push({ m: v.m, until: s.t + s.cfg.visibilityTimeout, sent: v.sent, consumer: c.name, handle });
                    got.push(d);
                    event(s, ctx, v.m, `${c.name} ReceiveMessage → ${v.m} (receipt ${handle}, invisible until t${s.t + s.cfg.visibilityTimeout})`, 'inflight');
                }
                if (got.length) { c.buffer.push(...got); op(ctx, 'receive'); flow(ctx, 'receive', got.length);
                    note(ctx, 'receive', `\`ReceiveMessage\` does not remove anything: it hides messages for **${s.cfg.visibilityTimeout} ticks** and returns a receipt handle needed to delete them.`); }
            }
            const a = s.consumers.find(c => c.group === 'second' && c.alive);
            if (a && !a.current && !a.buffer.length && q.second.length) { const item = q.second.shift(); a.buffer.push(delivery(s, ctx, a, item.m, {})); op(ctx, 'receive2'); flow(ctx, 'receive2'); }
        },
        ack(s, ctx, c, d) {
            if (c.group === 'second') { op(ctx, 'delete2'); return; }
            const q = s.q;
            op(ctx, 'deleteMessage'); flow(ctx, 'delete');
            if (q.handles[d.m] !== d.handle) {
                event(s, ctx, d.m, `${c.name} DeleteMessage(${d.handle}) succeeds but deletes nothing: a newer receipt handle exists`);
                note(ctx, 'stale', `**Stale receipt handle.** ${d.m} was received again after its timeout; SQS only honours the **most recent** receipt handle, so this delete has no effect.`);
                return;
            }
            const i = q.inflight.findIndex(f => f.m === d.m), j = q.visible.findIndex(v => v.m === d.m);
            if (i >= 0) q.inflight.splice(i, 1);
            if (j >= 0) q.visible.splice(j, 1);
            delete q.handles[d.m];
            s.m.completed++;
            event(s, ctx, d.m, `${c.name} DeleteMessage(${d.handle}) → ${d.m} deleted`, 'acked');
            note(ctx, 'delete', `\`DeleteMessage\` with the current receipt handle is the acknowledgement — only now is ${d.m} gone.`);
        },
        fail(s, ctx, c, d) {
            const f = s.q.inflight.find(x => x.m === d.m); if (f) f.failed = true;
            event(s, ctx, d.m, `${c.name} does not delete ${d.m}; it reappears after the visibility timeout`, 'inflight');
            note(ctx, 'retry', `A failed handler simply **doesn't delete** the message. SQS retries it after the visibility timeout — the timeout is the retry delay.`);
        },
        onCrash() {},
        onStop(s, ctx, c, lost) {
            if (c.current) { sideEffect(s, ctx, c, c.current); s.def.ack(s, ctx, c, c.current); }
            for (const d of lost) if (d !== c.current) {
                const i = s.q.inflight.findIndex(f => f.m === d.m);
                if (i >= 0) { s.q.inflight.splice(i, 1); s.q.visible.unshift({ m: d.m }); event(s, ctx, d.m, `ChangeMessageVisibility(${d.m}, 0) → visible`, 'stored'); op(ctx, 'changeVisibility'); }
            }
        },
        onJoin(s, ctx, c) { if (c.group === 'second') s.q.secondBound = true; },
        onReplay(s, ctx) {
            note(ctx, 'replay', `**Replay is not possible.** Deleted messages are gone; SQS retains only undeleted messages (up to the retention period). Replaying needs your own archive.`);
            event(s, ctx, '', 'replay requested: deleted messages cannot be received again');
        },
        onOutage() {},
        skipStale() { return false; },
        describeConsumer(s, c) {
            if (c.group === 'second') return `${c.name} · queue analytics · ${c.alive ? 'polling' : 'not subscribed yet'}`;
            if (!c.alive) return `${c.name} · down`;
            return `${c.name} · ${c.current ? 'processing ' + c.current.m : 'polling'}${c.buffer.length ? ' · +' + c.buffer.length + ' received' : ''}`;
        },
        metrics(s) {
            const q = s.q;
            return { backlog: q.visible.length + q.inflight.length, visible: q.visible.length, notVisible: q.inflight.length, inflight: q.inflight.length,
                storage: q.visible.length + q.inflight.length, dlqSize: q.dlq.length, second: q.second.length };
        },
        snapshot(s) {
            const q = s.q;
            return { settings: `visibility timeout ${s.cfg.visibilityTimeout} · batch ${s.cfg.receiveBatch} · maxReceiveCount ${s.cfg.maxAttempts}`,
                visible: q.visible.map(v => v.m), inflightIds: q.inflight.map(f => f.m),
                inflightLabels: q.inflight.map(f => `${f.m} ⏱t${f.until}`), dlqIds: q.dlq.slice(), secondQueue: q.second.map(x => x.m),
                receiveCounts: Object.assign({}, q.receives) };
        },
    });

    // ── Expression API ───────────────────────────────────────────────────────
    function rowsOf(v) { if (v && typeof v.toArray === 'function') v = v.toArray(); return Array.isArray(v) ? v : []; }
    function listOf(v) { if (v && typeof v.toArray === 'function') v = v.toArray(); return Array.isArray(v) ? v : []; }

    /** Full per-tick trace for one system: [row0..rowN]. Bind with tableBindings. */
    function mqTrace(system, settings, overrides) { return run(String(system), settings, overrides); }
    /** Lifecycle state of a message in a row's `life` map (e.g. 'stored', 'unacked', 'acked'). */
    function mqState(life, id) { return life && typeof life === 'object' && typeof id === 'string' ? (life[id] || 'pending') : 'pending'; }
    const STATE_COLORS = { pending: '#3a4552', buffered: '#9d8f6a', stored: '#4f8fc0', fetched: '#6aa7c9', unacked: '#d9a441', inflight: '#d9a441',
        processing: '#e6c35c', processed: '#e8875a', failed: '#d9534f', acked: '#4fae7b', deleted: '#3d6b52', dlq: '#b05a9a', dropped: '#7a3b3b', expired: '#7a3b3b', rejected: '#7a3b3b' };
    const idOf = v => { const m = /m\d+/.exec(String(v ?? '')); return m ? m[0] : ''; };
    /** Cell color for a cell holding a message id (or a label containing one); the traced message is drawn white. */
    function mqColor(life, value, traced) {
        const id = idOf(value);
        if (!id) return '#2a3440';
        if (traced && id === traced) return '#ffffff';
        return STATE_COLORS[mqState(life, id)] || '#5b6b7a';
    }
    /** Discrete state code for tensor colorMaps (domain 0..8). */
    const STATE_CODE = { pending: 0, buffered: 1, stored: 1, fetched: 2, unacked: 2, inflight: 2, processing: 3, failed: 3, processed: 4, acked: 5, deleted: 5, dlq: 6, dropped: 7, expired: 7, rejected: 7 };
    function mqCode(life, value, traced) {
        const id = idOf(value);
        if (!id) return 0;
        if (traced && id === traced) return 8;
        return STATE_CODE[mqState(life, id)] ?? 1;
    }
    /** "p0:3 p1:2" style list for status text. */
    function mqList(list, prefix, sep) {
        return listOf(list).map((v, i) => (prefix === undefined ? '' : String(prefix) + i + ':') + v).join(sep === undefined ? ' ' : String(sep));
    }
    /** Kafka grid cell text: "offset:id". */
    function mqGridText(ids, offsets, row, col) {
        const id = mqGrid(ids, row, col), off = mqGrid(offsets, row, col);
        return id ? off + ':' + id : '';
    }
    /** Lifecycle history of one message up to a frame, newest last. */
    function mqHistory(rows, frame, id, limit) {
        rows = rowsOf(rows); const out = [];
        const last = int(frame, 0, rows.length - 1, 0);
        for (let i = 0; i <= last; i++) for (const e of listOf(rows[i] && rows[i].log)) if (e.m === id) out.push(e.text);
        const n = int(limit, 1, 40, 8);
        return out.length > n ? ['… ' + (out.length - n + 1) + ' earlier'].concat(out.slice(out.length - n + 1)) : out;
    }
    /** True when an op happened at this tick — drives code-line highlights. */
    function mqOp(ops, name) { return listOf(ops).includes(String(name)) ? 1 : 0; }
    /** Kafka partition grid helpers (tensor valueExpr/textExpr). */
    function mqGrid(grid, row, col) { const r = listOf(grid)[int(row, 0, 99, 0)]; return r ? (listOf(r)[int(col, 0, 99, 0)] ?? 0) : 0; }
    /** A metric across frames, for charts: mqSeries(dataTable('kafka'), 'm_lag'). */
    function mqSeries(rows, field, frame) { rows = rowsOf(rows); const last = frame === undefined ? rows.length - 1 : int(frame, 0, rows.length - 1, 0); return rows.slice(0, last + 1).map(r => Number(r[field]) || 0); }
    /** Captions: mqCaption(frame, traced, 'Kafka', dataTable('kafka'), 'RabbitMQ', dataTable('rabbitmq'), ...). */
    function mqCaption(frame, traced, ...pairs) {
        const lines = [], f = int(frame, 0, MAX_FRAMES, 0);
        for (let i = 0; i + 1 < pairs.length; i += 2) {
            const rows = rowsOf(pairs[i + 1]), row = rows[Math.min(f, rows.length - 1)];
            if (!row) continue;
            const st = traced ? ` *(${traced}: ${mqState(row.life, traced)})*` : '';
            lines.push(`- **${pairs[i]}**${st} — ${row.brief || row.text}`);
        }
        const outage = pairs.some((p, i) => i % 2 === 1 && (rowsOf(p)[f] || {}).outage);
        return `**Tick ${f}**${outage ? ' · outage' : ''}${traced ? ' · tracing **' + traced + '**' : ''}\n\n` + lines.join('\n');
    }
    /** Journey of one message in every system up to a frame. */
    function mqTraceCaption(frame, traced, ...pairs) {
        const f = int(frame, 0, MAX_FRAMES, 0), out = [`**Journey of ${traced} · tick ${f}**`];
        for (let i = 0; i + 1 < pairs.length; i += 2) {
            const rows = rowsOf(pairs[i + 1]), row = rows[Math.min(f, rows.length - 1)];
            if (!row) continue;
            const h = mqHistory(rows, f, traced, 6).map(e => e.replace(/^t(\d+) /, '`t$1` '));
            out.push(`**${pairs[i]}** — now *${mqState(row.life, traced)}*${h.length ? ': ' + h.join(' → ') : ': not produced yet'}`);
        }
        return out.join('\n\n');
    }
    /** Compact, factual state for the AI tutor: metrics, consumers, stores and the traced message's history. */
    function mqContext(frame, traced, ...pairs) {
        const f = int(frame, 0, MAX_FRAMES, 0), out = [`Tick ${f}. Traced message: ${traced || 'none'}.`];
        for (let i = 0; i + 1 < pairs.length; i += 2) {
            const rows = rowsOf(pairs[i + 1]), row = rows[Math.min(f, rows.length - 1)];
            if (!row) continue;
            const metrics = Object.entries(row).filter(([k]) => k.startsWith('m_')).map(([k, v]) => k.slice(2) + '=' + v).join(', ');
            const stores = Object.entries(row).filter(([k, v]) => Array.isArray(v) && typeof v[0] === 'string' && !['ops', 'consumers', 'unackedRows', 'gridRows', 'owners'].includes(k))
                .map(([k, v]) => `${k}=[${v.slice(0, 16).join(' ')}${v.length > 16 ? ' …' : ''}]`).join('; ');
            const extra = row.committed ? `; committed offsets=[${row.committed.join(',')}]; partitions=${(row.partitionIds || []).map((p, j) => 'p' + j + ':[' + p.join(' ') + ']').join(' ')}` : '';
            out.push(`## ${pairs[i]}\nmetrics: ${metrics}\nconsumers: ${(row.consumers || []).join(' | ')}\nstores: ${stores}${extra}\nthis tick: ${row.action}\nexplanation: ${row.text}` +
                (traced ? `\n${traced} state: ${mqState(row.life, traced)}; history: ${mqHistory(rows, f, traced, 12).join(' → ')}` : ''));
        }
        return out.join('\n');
    }
    /** Consumer status cell color: down (red), idle without work assignment (grey), working (amber), ready (blue). */
    function mqConsumerColor(text) {
        const t = String(text || '');
        return t.includes('down') ? '#b5524f' : (t.includes('idle') || t.includes('not ')) ? '#56606b' : / m\d+/.test(t) ? '#d9a441' : '#4f8fc0';
    }
    /** Message id helper for sliders: mqId(3) → 'm3'. */
    function mqId(n) { return 'm' + int(n, 1, MAX_MESSAGES, 1); }
    function mqCrashPoint(n) { return CRASH_POINTS[int(n, 0, CRASH_POINTS.length - 1, 0)]; }
    function mqSystems() { return [...SYSTEMS.keys()]; }

    const api = { mqTrace, mqState, mqColor, mqCode, mqList, mqGridText, mqHistory, mqOp, mqGrid, mqCaption, mqTraceCaption, mqContext, mqConsumerColor, mqSeries, mqId, mqCrashPoint, mqSystems };
    // Test hooks (not part of the expression surface): system registry for extensions.
    if (typeof window !== 'undefined' && window.AlgeBenchDomains) window.AlgeBenchDomains.register('messaging', api);
    if (typeof globalThis !== 'undefined') globalThis.__messagingLab = { SYSTEMS, run, COMMON, CRASH_POINTS, STATE_COLORS };
})();
