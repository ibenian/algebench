/**
 * Distributed databases laboratory — a deterministic, tick-based model of a small
 * replicated, partitioned key-value store.
 *
 * Four engines share this file:
 *
 *  - Cluster engine. Up to five nodes, four clients and a handful of keys. Nodes run
 *    either single-leader replication (a primary appends to a log and ships it to
 *    replicas; acks after 0, k, a majority or all replicas; failover by an external
 *    monitor; optional lease so a cut-off primary steps down) or leaderless quorum
 *    replication (a coordinator sends each write to N replicas and waits for W acks,
 *    each read to the replicas and waits for R replies; strict or sloppy quorums,
 *    hinted handoff, read repair, anti-entropy with Merkle trees, tombstones, LWW or
 *    sibling versions). Messages are first-class: they travel with a latency and are
 *    dropped by crashed nodes and network partitions. Every tick emits one row.
 *  - History checker. Completed client operations with real-time intervals are
 *    checked for linearizability (Wing–Gong search per key) and every read is
 *    labelled with the weakest guarantee it breaks: read-your-writes, monotonic
 *    reads, causal, or only linearizability (stale in real time). It trusts nothing
 *    the replication mechanism claims.
 *  - Placement engine. Pure key → node placement for range, hash-mod-N, fixed
 *    partitions, consistent hashing with virtual nodes and Redis-style hash slots,
 *    with load, moved keys on a node change, and query routing.
 *  - Capacity model. A fluid queue per tick for one node vs. replicas vs. shards.
 *
 * Teaching model, not a reimplementation: ticks are message hops, the failure
 * detector is perfect for "reachable" decisions, and every product profile models
 * documented visible behaviour only (see docs.json limits).
 */
(function () {
    'use strict';
    const MAX_NODES = 5, MAX_CLIENTS = 4, MAX_KEYS = 8, FRAMES = 40, MSG_SLOTS = 8;
    const NODE_NAMES = ['N1', 'N2', 'N3', 'N4', 'N5'];
    const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
    const listOf = v => { if (v && typeof v.toArray === 'function') v = v.toArray(); return Array.isArray(v) ? v : []; };
    const objOf = v => (v && typeof v === 'object' && !Array.isArray(v) ? (typeof v.toJSON === 'function' && v.isMatrix ? {} : v) : {});

    // ── Scenarios ────────────────────────────────────────────────────────────
    // ops: { c: client (1-based), t: earliest issue tick, op: 'w' | 'r' | 'd', k: key, v: value, slow: extra ticks on this
    // write's replication messages, slowTo: node indices that extra applies to, ctx: write with the client's read context }.
    // clients: home node index per client (the node it talks to; it fails over to another reachable node if that one is down).
    const SCENARIOS = [
        // ── Scene 2 · Replication (single leader) ──
        { id: 'lag', scene: 'replication', title: 'Replication lag',
            story: 'C1 writes x five times through the primary N1. C3 reads x from replica N3, which applies the log a few ticks late. C2, next to N2, stays idle.',
            cfg: { topology: 'leader', nodes: 3, ack: 0, replDelay: [0, 0, 3], failover: 0, read: 'home' },
            clients: [0, 1, 2], keys: ['x'], init: { x: 0 },
            ops: [w(1, 1, 'x', 1), w(1, 3, 'x', 2), r(3, 4, 'x'), w(1, 6, 'x', 3), r(3, 7, 'x'), w(1, 9, 'x', 4), r(3, 11, 'x'), w(1, 12, 'x', 5), r(3, 15, 'x'), r(3, 19, 'x')] },
        { id: 'primary-crash', scene: 'replication', title: 'Primary crash and failover',
            story: 'C1 writes x through primary N1. N1 crashes at tick 7, before shipping its last writes; a monitor promotes the most up-to-date replica.',
            cfg: { topology: 'leader', nodes: 3, ack: 0, replDelay: [0, 2, 3], failover: 3, crash: [{ node: 0, at: 7, back: 22 }] },
            clients: [0, 1], keys: ['x'], init: { x: 0 },
            ops: [w(1, 1, 'x', 1), w(1, 3, 'x', 2), w(1, 5, 'x', 3), w(1, 6, 'x', 4), r(2, 11, 'x'), w(1, 13, 'x', 5), r(2, 15, 'x'), r(1, 17, 'x'), r(2, 26, 'x')] },
        { id: 'replica-crash', scene: 'replication', title: 'Replica crash',
            story: 'C1 writes x every two ticks. Replica N3 crashes at tick 5 and comes back at tick 20.',
            cfg: { topology: 'leader', nodes: 3, ack: 3, replDelay: [0, 0, 1], failover: 0, crash: [{ node: 2, at: 5, back: 20 }], timeout: 6 },
            clients: [0, 1], keys: ['x'], init: { x: 0 },
            ops: [w(1, 1, 'x', 1), w(1, 3, 'x', 2), w(1, 5, 'x', 3), w(1, 7, 'x', 4), w(1, 14, 'x', 5), r(2, 23, 'x'), w(1, 24, 'x', 6), r(2, 29, 'x')] },
        { id: 'split-brain', scene: 'replication', title: 'Isolated primary',
            story: 'A network partition cuts primary N1 (and client C1 next to it) off from N2 and N3 at tick 4. The monitor on the majority side promotes N2. C1 and C2 keep writing.',
            cfg: { topology: 'leader', nodes: 3, ack: 0, replDelay: [0, 1, 1], failover: 3, lease: 0, cut: { at: 4, heal: 18, side: [0] } },
            clients: [0, 1], keys: ['x'], init: { x: 0 },
            ops: [w(1, 1, 'x', 1), w(1, 6, 'x', 2), w(2, 9, 'x', 3), w(1, 11, 'x', 4), r(1, 13, 'x'), r(2, 14, 'x'), r(1, 21, 'x'), r(2, 22, 'x')] },
        { id: 'multi-primary', scene: 'replication', title: 'Two primaries, one key',
            story: 'Multi-primary: N1 (east) and N2 (west) both accept writes and replicate to each other asynchronously across a 3-tick WAN. C1 and C2 update x at almost the same time.',
            cfg: { topology: 'leaderless', nodes: 2, N: 2, W: 1, R: 1, regions: [0, 1], wan: 3, resolve: 'lww', skew: [2, 0] },
            clients: [0, 1], keys: ['x'], init: { x: 0 },
            ops: [w(1, 2, 'x', 10), w(2, 3, 'x', 20), r(1, 4, 'x'), r(2, 4, 'x'), r(1, 10, 'x'), r(2, 10, 'x')] },

        // ── Scene 3 · Consistency models (single leader, lagging replicas) ──
        { id: 'ryw', scene: 'consistency', title: 'Profile update, then reload',
            story: 'C1 saves a new profile name (v=2) and immediately reloads the page. Reads go to whichever replica the load balancer picks.',
            cfg: { topology: 'leader', nodes: 3, ack: 0, replDelay: [0, 1, 6], read: 'rotate' },
            clients: [1], keys: ['p'], init: { p: 1 }, readStart: [1],
            ops: [w(1, 1, 'p', 2), r(1, 3, 'p'), r(1, 5, 'p'), r(1, 7, 'p'), r(1, 11, 'p')] },
        { id: 'monotonic', scene: 'consistency', title: 'Refresh goes back in time',
            story: 'C1 posts a new score every few ticks. C2 keeps refreshing; each refresh may land on a different replica.',
            cfg: { topology: 'leader', nodes: 3, ack: 0, replDelay: [0, 1, 6], read: 'rotate' },
            clients: [0, 1], keys: ['s'], init: { s: 0 }, readStart: [0, 0],
            ops: [w(1, 1, 's', 1), w(1, 4, 's', 2), r(2, 5, 's'), r(2, 7, 's'), r(2, 9, 's'), r(2, 11, 's'), w(1, 12, 's', 3), r(2, 14, 's'), r(2, 16, 's')] },
        { id: 'causal', scene: 'consistency', title: 'Reply before the post',
            story: 'C1 publishes a post. C2 reads it and replies. C3 reads the reply, then opens the post it answers.',
            cfg: { topology: 'leader', nodes: 3, ack: 0, replDelay: [0, 1, 6], read: 'rotate' },
            clients: [0, 0, 1], keys: ['post', 'reply'], init: { post: 0, reply: 0 }, readStart: [0, 0, 0],
            ops: [w(1, 1, 'post', 1), r(2, 2, 'post'), w(2, 3, 'reply', 1), r(3, 6, 'reply'), r(3, 7, 'post'), r(3, 16, 'post')] },
        { id: 'linearizable', scene: 'consistency', title: 'Two readers disagree',
            story: 'C1 sets the price x to 2 and gets an acknowledgement. Afterwards C2 and C3 read the price, each from its nearest replica.',
            cfg: { topology: 'leader', nodes: 3, ack: 0, replDelay: [0, 1, 6], read: 'home' },
            clients: [0, 1, 2], keys: ['x'], init: { x: 1 }, readStart: [0, 0, 0],
            ops: [w(1, 1, 'x', 2), r(2, 4, 'x'), r(3, 4, 'x'), r(2, 6, 'x'), r(3, 6, 'x'), r(3, 12, 'x')] },

        // ── Scene 4 · Quorums (leaderless) ──
        { id: 'quorum', scene: 'quorums', title: 'Write, then read elsewhere',
            story: 'C1 writes x through coordinator N1; C2 reads x through N3 right after. The replicas of x are the first N nodes.',
            cfg: { topology: 'leaderless', nodes: 5, N: 3, W: 2, R: 2, readRepair: 'off', replDelay: [0, 0, 2, 0, 0] },
            clients: [0, 2], keys: ['x'], init: { x: 0 },
            ops: [w(1, 1, 'x', 1), r(2, 3, 'x'), w(1, 7, 'x', 2), r(2, 9, 'x'), r(2, 14, 'x')] },
        { id: 'concurrent-read', scene: 'quorums', title: 'Read during a slow write',
            story: 'C1\'s write of x=1 reaches its coordinator N1 at once but is delayed on the way to N2 and N3. Reader A (C2, via N1) and then reader B (C3, via N3) read x while the write is still in flight.',
            cfg: { topology: 'leaderless', nodes: 3, N: 3, W: 2, R: 2, readRepair: 'off', timeout: 12 },
            clients: [0, 0, 2], keys: ['x'], init: { x: 0 },
            ops: [{ c: 1, t: 1, op: 'w', k: 'x', v: 1, slow: 7, slowTo: [1, 2] }, r(2, 2, 'x'), r(3, 5, 'x'), r(3, 13, 'x')] },
        { id: 'failed-write', scene: 'quorums', title: 'A failed write that stays',
            story: 'N3 is down until tick 8 and the link to N2 is very slow. C1\'s write of x=1 cannot collect W = 2 acks before its timeout, so C1 is told it failed — but N1 already stored it. Later readers disagree about whether it happened.',
            cfg: { topology: 'leaderless', nodes: 3, N: 3, W: 2, R: 2, readRepair: 'off', timeout: 3, crash: [{ node: 2, at: 0, back: 8 }] },
            clients: [0, 1, 2], keys: ['x'], init: { x: 0 },
            ops: [{ c: 1, t: 1, op: 'w', k: 'x', v: 1, slow: 20, slowTo: [1] }, r(2, 5, 'x'), r(3, 10, 'x'), r(2, 14, 'x')] },
        { id: 'sloppy', scene: 'quorums', title: 'Sloppy quorum',
            story: 'A partition cuts N2 and N3 (the replicas of x besides N1) away from C1. With a sloppy quorum, fallback nodes N4 and N5 accept x=1 on their behalf. C2, on the other side, reads x from N2 and N3.',
            cfg: { topology: 'leaderless', nodes: 5, N: 3, W: 2, R: 2, sloppy: 1, hints: 1, readRepair: 'off', cut: { at: 2, heal: 16, side: [1, 2] } },
            clients: [0, 1], keys: ['x'], init: { x: 0 },
            ops: [w(1, 3, 'x', 1), r(2, 6, 'x'), r(1, 8, 'x'), r(2, 20, 'x')] },
        { id: 'lww-skew', scene: 'quorums', title: 'Last write wins, clock skew',
            story: 'N1\'s clock runs 6 ticks fast. C1 writes x=1 via N1; after it is acknowledged, C2 writes x=2 via N2. Both writes reach every replica.',
            cfg: { topology: 'leaderless', nodes: 3, N: 3, W: 2, R: 2, readRepair: 'off', skew: [6, 0, 0] },
            clients: [0, 1, 2], keys: ['x'], init: { x: 0 },
            ops: [w(1, 1, 'x', 1), w(2, 5, 'x', 2), r(3, 9, 'x'), r(2, 12, 'x')] },

        // ── Scene 5 · Partitions: CAP and PACELC ──
        { id: 'partition', scene: 'cap', title: 'Two regions lose contact',
            story: 'Five nodes in two regions: east N1–N3, west N4–N5. At tick 8 the WAN link fails; it heals at tick 24. C1 (east) and C2 (west) keep updating the same key.',
            cfg: { topology: 'leaderless', nodes: 5, N: 5, W: 3, R: 3, regions: [0, 0, 0, 1, 1], wan: 2, cut: { at: 8, heal: 24, side: [3, 4] }, timeout: 8 },
            clients: [0, 3], keys: ['x'], init: { x: 0 },
            ops: [w(1, 1, 'x', 1), r(2, 2, 'x'), w(1, 10, 'x', 2), w(2, 11, 'x', 3), r(1, 14, 'x'), r(2, 15, 'x'), w(2, 17, 'x', 4), r(1, 20, 'x'), r(2, 28, 'x'), r(1, 31, 'x')] },
        { id: 'latency', scene: 'cap', title: 'No partition, just distance',
            story: 'The same two regions, no failures. C1 (east) and C2 (west) write and read x. The only thing in the way is the WAN round trip.',
            cfg: { topology: 'leaderless', nodes: 5, N: 5, W: 3, R: 3, regions: [0, 0, 0, 1, 1], wan: 4, timeout: 16 },
            clients: [0, 3], keys: ['x'], init: { x: 0 },
            ops: [w(1, 1, 'x', 1), r(2, 2, 'x'), w(2, 8, 'x', 2), r(1, 9, 'x'), r(2, 16, 'x'), r(1, 18, 'x')] },

        // ── Scene 6 · Failure, repair, reconciliation (leaderless, N = 3) ──
        { id: 'outage', scene: 'repair', title: 'Writes during an outage',
            story: 'N3 is down from tick 3 to tick 14 while C1 writes keys a–f. When N3 returns it is missing all six writes. C2 then reads through N3 with R = 1.',
            cfg: { topology: 'leaderless', nodes: 3, N: 3, W: 2, R: 1, crash: [{ node: 2, at: 3, back: 14 }], readRepair: 'off', hints: 0, ae: 0, readLocal: 1 },
            clients: [0, 2], keys: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], init: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0 },
            ops: [w(1, 4, 'a', 1), w(1, 5, 'b', 1), w(1, 6, 'c', 1), w(1, 8, 'd', 1), w(1, 9, 'e', 1), w(1, 10, 'f', 1), r(2, 17, 'a'), r(2, 19, 'b'), r(2, 21, 'a'), r(2, 27, 'c'), r(2, 33, 'e')] },
        { id: 'resurrection', scene: 'repair', title: 'The deleted row comes back',
            story: 'C1 writes a=1, then deletes it while N3 is down (tick 5 to 22). Tombstones are purged after gc-grace ticks. Anti-entropy runs when N3 is back.',
            cfg: { topology: 'leaderless', nodes: 3, N: 3, W: 2, R: 2, crash: [{ node: 2, at: 5, back: 22 }], readRepair: 'off', hints: 0, ae: 8, gcGrace: 6 },
            clients: [0, 1], keys: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], init: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0 },
            ops: [w(1, 1, 'a', 1), { c: 1, t: 7, op: 'd', k: 'a' }, r(2, 10, 'a'), r(2, 30, 'a'), r(2, 36, 'a')] },
        { id: 'siblings', scene: 'repair', title: 'Two carts, no coordination',
            story: 'C1 adds milk through N1 while C2 adds eggs through N2, each from the same empty cart. With W = 1 both succeed. Then C3 reads the cart and writes back what it saw.',
            cfg: { topology: 'leaderless', nodes: 3, N: 3, W: 1, R: 3, readRepair: 'async', resolve: 'lww', skew: [1, 0, 0] },
            clients: [0, 1, 2], keys: ['cart'], init: { cart: '∅' },
            ops: [w(1, 2, 'cart', 'milk'), w(2, 2, 'cart', 'eggs'), r(3, 6, 'cart'), { c: 3, t: 9, op: 'w', k: 'cart', v: 'merge', ctx: 1 }, r(1, 13, 'cart'), r(2, 16, 'cart')] },

        // ── Scene 9 · comparison workloads (run under each profile) ──
        { id: 'cmp-replica-read', scene: 'compare', title: 'Read right after a write',
            story: 'C1 writes x; once it is acknowledged, C2 reads x from the node next to it, a replica that applies changes a few ticks late.',
            cfg: { nodes: 3, replDelay: [0, 0, 4] }, clients: [0, 2], keys: ['x'], init: { x: 0 },
            ops: [w(1, 1, 'x', 1), r(2, 5, 'x'), r(1, 6, 'x'), r(2, 14, 'x')] },
        { id: 'cmp-crash', scene: 'compare', title: 'Primary/coordinator node crash',
            story: 'C1 writes through N1, which crashes at tick 5 right after accepting a write; it returns at tick 24.',
            cfg: { nodes: 3, replDelay: [0, 2, 2], crash: [{ node: 0, at: 5, back: 24 }] }, clients: [0, 1], keys: ['x'], init: { x: 0 },
            ops: [w(1, 1, 'x', 1), w(1, 4, 'x', 2), r(2, 12, 'x'), w(2, 14, 'x', 3), r(1, 18, 'x'), r(2, 28, 'x')] },
        { id: 'cmp-partition', scene: 'compare', title: 'Minority partition',
            story: 'N1 and C1 are cut off from N2, N3 between ticks 4 and 20; both clients keep writing.',
            cfg: { nodes: 3, replDelay: [0, 1, 1], cut: { at: 4, heal: 20, side: [0] } }, clients: [0, 1], keys: ['x'], init: { x: 0 },
            ops: [w(1, 1, 'x', 1), w(1, 7, 'x', 2), w(2, 8, 'x', 3), r(1, 12, 'x'), r(2, 13, 'x'), r(1, 24, 'x'), r(2, 26, 'x')] },
        { id: 'cmp-outage', scene: 'compare', title: 'Replica outage and recovery',
            story: 'N3 is down from tick 2 to 14 while C1 writes; C2 reads through N3 the moment it is back, and again later.',
            cfg: { nodes: 3, replDelay: [0, 0, 0], crash: [{ node: 2, at: 2, back: 14 }] }, clients: [0, 2], keys: ['x'], init: { x: 0 },
            ops: [w(1, 3, 'x', 1), w(1, 6, 'x', 2), r(2, 14, 'x'), r(2, 20, 'x')] },
        { id: 'cmp-concurrent', scene: 'compare', title: 'Concurrent writes to one key',
            story: 'C1 and C2 write x at the same tick through different nodes, then both read.',
            cfg: { nodes: 3, replDelay: [0, 0, 0] }, clients: [0, 1], keys: ['x'], init: { x: 0 },
            ops: [w(1, 2, 'x', 1), w(2, 2, 'x', 2), r(1, 8, 'x'), r(2, 9, 'x')] },
    ];
    function w(c, t, k, v) { return { c, t, op: 'w', k, v }; }
    function r(c, t, k) { return { c, t, op: 'r', k }; }
    const SCENARIO_INDEX = new Map(SCENARIOS.map((s, i) => [s.id, i]));
    function scenarioOf(v) {
        if (typeof v === 'string' && SCENARIO_INDEX.has(v)) return SCENARIOS[SCENARIO_INDEX.get(v)];
        const i = Math.round(Number(v));
        if (!(i >= 0 && i < SCENARIOS.length)) throw new Error('Unknown distdb scenario: ' + v);
        return SCENARIOS[i];
    }

    // ── Option vocabularies (slider index → setting) ───────────────────────────
    const ACK_MODES = [
        { id: 'async', label: 'async', acks: () => 0 },
        { id: 'semi', label: 'semi-sync (1 replica)', acks: () => 1 },
        { id: 'majority', label: 'majority', acks: n => Math.floor(n / 2) },
        { id: 'sync', label: 'sync (all replicas)', acks: n => n - 1 },
    ];
    const READ_MODES = [
        { id: 'rotate', label: 'Eventual · any replica', short: 'eventual' },
        { id: 'ryw', label: 'Read-your-writes · session token', short: 'RYW' },
        { id: 'monotonic', label: 'Monotonic reads · version token', short: 'MR' },
        { id: 'causal', label: 'Causal · causal token', short: 'causal' },
        { id: 'primary', label: 'Linearizable · read the primary', short: 'linear.' },
    ];
    const REPAIR_MODES = ['off', 'async', 'blocking'];
    // CAP policies: one engine configuration each.
    const CAP_POLICIES = [
        { id: 'cp-quorum', label: 'CP · strict majority quorum', cfg: { topology: 'leaderless', W: 3, R: 3, sloppy: 0, hints: 1, readRepair: 'blocking', resolve: 'lww' } },
        { id: 'cp-leader', label: 'CP · leader + majority + lease', cfg: { topology: 'leader', ack: 'majority', lease: 1, failover: 3, read: 'primary' } },
        { id: 'ap-lww', label: 'AP · accept anywhere, last write wins', cfg: { topology: 'leaderless', W: 1, R: 1, sloppy: 1, hints: 1, readRepair: 'async', resolve: 'lww' } },
        { id: 'ap-siblings', label: 'AP · accept anywhere, keep siblings', cfg: { topology: 'leaderless', W: 1, R: 1, sloppy: 1, hints: 1, readRepair: 'async', resolve: 'siblings' } },
    ];
    // Product profiles: named configurations of the same engine (scene 9). Models of documented behaviour.
    const PROFILES = [
        { id: 'pg-async', label: 'PostgreSQL · async, replica reads', short: 'PG async',
            cfg: { topology: 'leader', ack: 'async', read: 'home', failover: 4, lease: 0 },
            note: 'Streaming replication is asynchronous by default; reads on a hot standby can be stale. Failover needs an external tool (Patroni, repmgr); here it promotes after 4 ticks.' },
        { id: 'pg-sync', label: 'PostgreSQL · synchronous_commit=on, ANY 1', short: 'PG sync',
            cfg: { topology: 'leader', ack: 'semi', read: 'primary', failover: 4, lease: 1 },
            note: 'synchronous_standby_names = \'ANY 1 (…)\' makes COMMIT wait for one standby. Reads on the primary. Patroni-style failover with a DCS lease.' },
        { id: 'mysql-semi', label: 'MySQL · semi-sync AFTER_SYNC', short: 'MySQL semi',
            cfg: { topology: 'leader', ack: 'semi', read: 'home', failover: 4, lease: 0 },
            note: 'Lossless semi-sync waits for one replica to receive the binlog event before the commit returns; reads from replicas can lag. MySQL falls back to async after rpl_semi_sync_source_timeout (not modelled).' },
        { id: 'mongo-majority', label: 'MongoDB · w:majority, read primary', short: 'Mongo maj.',
            cfg: { topology: 'leader', ack: 'majority', read: 'primary', failover: 3, lease: 1 },
            note: 'Replica-set defaults since 5.0: writeConcern majority, readPreference primary. A primary that loses the majority steps down. readConcern "linearizable" (not modelled) closes the remaining stale-primary window.' },
        { id: 'mongo-secondary', label: 'MongoDB · read secondary', short: 'Mongo sec.',
            cfg: { topology: 'leader', ack: 'majority', read: 'home', failover: 3, lease: 1 },
            note: 'readPreference secondary with readConcern local: fast, local, possibly stale. Causal sessions (afterClusterTime) would wait for the replica to catch up.' },
        { id: 'cassandra-one', label: 'Cassandra · ONE / ONE', short: 'Cass. ONE',
            cfg: { topology: 'leaderless', N: 3, W: 1, R: 1, hints: 1, readRepair: 'off', resolve: 'lww' },
            note: 'RF 3, consistency level ONE for writes and reads: highest availability, stale reads, cell-level last-write-wins by timestamp. Hinted handoff for down replicas.' },
        { id: 'cassandra-quorum', label: 'Cassandra · QUORUM / QUORUM', short: 'Cass. QUORUM',
            cfg: { topology: 'leaderless', N: 3, W: 2, R: 2, hints: 1, readRepair: 'blocking', resolve: 'lww' },
            note: 'R + W > N, with blocking read repair on QUORUM reads. Still last-write-wins by client/coordinator timestamp; lightweight transactions (Paxos) are lesson 3.' },
        { id: 'dynamo-eventual', label: 'DynamoDB · eventually consistent read', short: 'Dynamo EC',
            cfg: { topology: 'leader', ack: 'majority', read: 'home', failover: 2, lease: 1 },
            note: 'Modelled as a leader per partition with a write acknowledged by 2 of 3 replicas; the default read may go to any replica. DynamoDB is not the Dynamo paper: no sloppy quorums or client-visible siblings.' },
        { id: 'dynamo-strong', label: 'DynamoDB · strongly consistent read', short: 'Dynamo SC',
            cfg: { topology: 'leader', ack: 'majority', read: 'primary', failover: 2, lease: 1 },
            note: 'ConsistentRead=true on the base table reads the leader: reflects every acknowledged write, costs twice the read capacity and fails when the leader is unreachable. Not available on GSIs.' },
        { id: 'redis-cluster', label: 'Redis Cluster', short: 'Redis',
            cfg: { topology: 'leader', ack: 'async', read: 'primary', failover: 3, lease: 1 },
            note: 'Each hash slot has one master replicating asynchronously; failover after cluster-node-timeout by a majority of masters. A master in the minority stops accepting writes after the timeout, but acknowledged writes can still be lost.' },
        { id: 'spanner', label: 'CockroachDB / Spanner', short: 'Crdb/Spanner',
            cfg: { topology: 'leader', ack: 'majority', read: 'primary', failover: 3, lease: 1 },
            note: 'A consensus group per range with a leaseholder (black box here; lesson 3). Writes need a majority, reads go to the leaseholder: linearizable, and a minority side is unavailable.' },
    ];
    const COMPARE_SCENARIOS = ['cmp-replica-read', 'cmp-crash', 'cmp-partition', 'cmp-outage', 'cmp-concurrent'];

    // ── Configuration ────────────────────────────────────────────────────────
    const DEFAULTS = {
        topology: 'leader', nodes: 3, ack: 0, read: 'primary', failover: 0, lease: 0,
        N: 3, W: 2, R: 2, sloppy: 0, hints: 0, readRepair: 'off', ae: 0, gcGrace: 99, resolve: 'lww',
        lat: 1, wan: 2, regions: null, replDelay: null, skew: null, crash: [], cut: null, timeout: 8, readLocal: 0,
    };
    function ackCount(cfg) {
        const n = cfg.nodes;
        if (typeof cfg.ack === 'string') { const m = ACK_MODES.find(a => a.id === cfg.ack); return m ? m.acks(n) : 0; }
        return ACK_MODES[clampInt(cfg.ack, 0, ACK_MODES.length - 1)].acks(n);
    }
    /** Scenario config + scene overrides → full config. Overrides use slider-friendly numbers. */
    function configOf(sc, ov) {
        const cfg = Object.assign({}, DEFAULTS, sc.cfg);
        const o = objOf(ov);
        // A negative slider value means "the scenario's own setting".
        const num = k => (o[k] !== undefined && o[k] !== null && Number.isFinite(Number(o[k])) && Number(o[k]) >= 0 ? Number(o[k]) : undefined);
        if (num('profile') !== undefined) Object.assign(cfg, PROFILES[clampInt(o.profile, 0, PROFILES.length - 1)].cfg);
        if (num('policy') !== undefined) Object.assign(cfg, CAP_POLICIES[clampInt(o.policy, 0, CAP_POLICIES.length - 1)].cfg);
        if (num('ack') !== undefined) cfg.ack = clampInt(o.ack, 0, ACK_MODES.length - 1);
        if (num('read') !== undefined) cfg.read = READ_MODES[clampInt(o.read, 0, READ_MODES.length - 1)].id;
        if (num('failover') !== undefined) cfg.failover = clampInt(o.failover, 0, 20);
        if (num('lease') !== undefined) cfg.lease = clampInt(o.lease, 0, 1);
        if (num('N') !== undefined) cfg.N = clampInt(o.N, 1, cfg.nodes);
        if (num('W') !== undefined) cfg.W = clampInt(o.W, 1, MAX_NODES);
        if (num('R') !== undefined) cfg.R = clampInt(o.R, 1, MAX_NODES);
        if (num('sloppy') !== undefined) cfg.sloppy = clampInt(o.sloppy, 0, 1);
        if (num('hints') !== undefined) cfg.hints = clampInt(o.hints, 0, 1);
        if (num('readRepair') !== undefined) cfg.readRepair = REPAIR_MODES[clampInt(o.readRepair, 0, 2)];
        if (num('ae') !== undefined) cfg.ae = clampInt(o.ae, 0, 40);
        if (num('gcGrace') !== undefined) cfg.gcGrace = clampInt(o.gcGrace, 1, 99);
        if (num('resolve') !== undefined) cfg.resolve = clampInt(o.resolve, 0, 1) ? 'siblings' : 'lww';
        if (num('wan') !== undefined) cfg.wan = clampInt(o.wan, 1, 10);
        if (num('lat') !== undefined) cfg.lat = clampInt(o.lat, 1, 6);
        if (num('replDelay') !== undefined) {
            // Scales the scenario's lagging replicas; a scenario with no lag gets it on its last node.
            const base = (sc.cfg.replDelay || []).slice();
            const d = clampInt(o.replDelay, 0, 12);
            const lagging = base.map((x, i) => (x > 0 ? i : -1)).filter(i => i >= 0);
            const targets = lagging.length ? lagging : [cfg.nodes - 1];
            const maxBase = Math.max(1, ...base.filter(x => x > 0));
            cfg.replDelay = Array.from({ length: cfg.nodes }, (_, i) => (targets.includes(i) ? Math.round(d * ((base[i] || maxBase) / maxBase)) : 0));
        }
        if (num('skew') !== undefined && cfg.skew) cfg.skew = cfg.skew.map(x => (x ? clampInt(o.skew, 0, 12) : 0));
        if (num('down') !== undefined) {
            const d = clampInt(o.down, 0, cfg.nodes - 1);
            // Crash the last `d` replicas of the key for the whole run.
            const replicas = Array.from({ length: Math.min(cfg.N, cfg.nodes) }, (_, i) => i);
            cfg.crash = (cfg.crash || []).concat(replicas.slice(replicas.length - d).map(node => ({ node, at: 0, back: 999 })));
        }
        if (num('crashAt') !== undefined && cfg.crash && cfg.crash.length) cfg.crash = cfg.crash.map((c, i) => (i === 0 ? Object.assign({}, c, { at: clampInt(o.crashAt, 0, FRAMES) || 999 }) : c));
        if (num('backAt') !== undefined && cfg.crash && cfg.crash.length) cfg.crash = cfg.crash.map((c, i) => (i === 0 ? Object.assign({}, c, { back: clampInt(o.backAt, 0, FRAMES) || 999 }) : c));
        if (num('cut') !== undefined && cfg.cut && !clampInt(o.cut, 0, 1)) cfg.cut = null;
        if (num('cutAt') !== undefined && cfg.cut) cfg.cut = Object.assign({}, cfg.cut, { at: clampInt(o.cutAt, 0, FRAMES) || 999 });
        if (num('healAt') !== undefined && cfg.cut) cfg.cut = Object.assign({}, cfg.cut, { heal: clampInt(o.healAt, 0, FRAMES) || 999 });
        if (num('timeout') !== undefined) cfg.timeout = clampInt(o.timeout, 1, 30);
        cfg.N = Math.min(cfg.N, cfg.nodes);
        cfg.acks = Math.min(ackCount(cfg), cfg.nodes - 1);
        return cfg;
    }

    // ── Versions ─────────────────────────────────────────────────────────────
    // A version: { id: 'w3', k, v, del, ts, node, vv: {node: counter}, epoch, seq, t (tick written) }.
    function vvDominates(a, b) { // a ≥ b and a ≠ b
        let ge = true, gt = false;
        for (const n of new Set([...Object.keys(a), ...Object.keys(b)])) {
            const x = a[n] || 0, y = b[n] || 0;
            if (x < y) ge = false; if (x > y) gt = true;
        }
        return ge && gt;
    }
    function vvMerge(...vs) { const out = {}; for (const v of vs) for (const [n, c] of Object.entries(v || {})) out[n] = Math.max(out[n] || 0, c); return out; }
    const lwwKey = v => [v.ts, v.node, Number(String(v.id).slice(1))];
    function lwwNewer(a, b) { const x = lwwKey(a), y = lwwKey(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; }
    /** Merge a version into a sibling set under the resolution policy. Returns the new set. */
    function mergeVersion(set, ver, resolve) {
        if (set.some(x => x.id === ver.id)) return set;
        if (resolve === 'lww') {
            const best = set.reduce((b, x) => (!b || lwwNewer(x, b) ? x : b), null);
            return !best || lwwNewer(ver, best) ? [ver] : [best];
        }
        if (set.some(x => vvDominates(x.vv, ver.vv))) return set;
        return set.filter(x => !vvDominates(ver.vv, x.vv)).concat([ver]);
    }
    const setKey = set => set.map(x => x.id).sort().join(',');
    const showVal = v => (v === null || v === undefined ? '∅' : String(v));
    function verText(set) {
        if (!set || !set.length) return '';
        return set.map(x => (x.del ? '†' : showVal(x.v))).join(' | ');
    }

    // ── Cluster state ────────────────────────────────────────────────────────
    function createState(sc, cfg) {
        const n = cfg.nodes;
        const nodes = Array.from({ length: n }, (_, i) => ({
            i, name: NODE_NAMES[i], up: true, role: cfg.topology === 'leader' ? (i === 0 ? 'primary' : 'replica') : 'peer', epoch: 1,
            log: [], store: {}, hints: [], counter: 0, unreachTicks: 0, recovering: 0,
            sentUpTo: Array(n).fill(0), acked: Array(n).fill(0),
        }));
        const s = {
            sc, cfg, t: 0, nodes, msgs: [], seq: 0, wseq: 0, events: [], tickEvents: [], ops: [], pending: [],
            clients: sc.clients.map((home, c) => ({ c: c + 1, home, busy: null, readCount: (sc.readStart || [])[c] || 0, lastWriteSeq: 0, seenSeq: 0, maxSeen: {}, ctx: {}, past: new Set() })),
            writes: new Map(), // id → version (for the checker / pasts)
            monitor: 0, failovers: 0, lastMerkle: null, gcd: 0, resurrected: 0,
            m: { ok: 0, rejected: 0, timedOut: 0, stale: 0, lost: 0, siblings: 0, msgs: 0, repair: 0, hintsReplayed: 0, aeKeys: 0, lat: [] },
            flow: [],
        };
        // Nodes scheduled to crash at tick 0 start down.
        for (const c of cfg.crash || []) if (c.at <= 0 && nodes[c.node]) nodes[c.node].up = false;
        // Initial values exist on every replica (written before tick 0 by the "system").
        for (const k of sc.keys) {
            const ver = { id: 'w0' + k, k, v: sc.init[k], del: false, ts: -1, node: -1, vv: {}, epoch: 0, seq: 0, t: -1, init: true };
            s.writes.set(ver.id, ver);
            for (const nd of nodes) {
                if (cfg.topology === 'leader') nd.store[k] = [ver];
                else if (replicasOf(s, k).includes(nd.i)) nd.store[k] = [ver];
            }
        }
        return s;
    }
    function replicasOf(s, k) { return Array.from({ length: s.cfg.N }, (_, i) => i); }
    function fallbacksOf(s) { return Array.from({ length: s.cfg.nodes - s.cfg.N }, (_, i) => s.cfg.N + i); }
    function cutActive(s, t) { const c = s.cfg.cut; return !!(c && t >= c.at && t < c.heal); }
    function sideOf(s, node) { return cutActive(s, s.t) && s.cfg.cut.side.includes(node) ? 1 : 0; }
    function linked(s, a, b) { return a === b || !cutActive(s, s.t) || (s.cfg.cut.side.includes(a) === s.cfg.cut.side.includes(b)); }
    function reachable(s, a, b) { return s.nodes[a].up && s.nodes[b].up && linked(s, a, b); }
    function latency(s, a, b, kind, op) {
        if (a === b) return 0;
        const cfg = s.cfg;
        let d = cfg.lat;
        if (cfg.regions && cfg.regions[a] !== cfg.regions[b]) d = cfg.wan;
        if ((kind === 'repl' || kind === 'put') && cfg.replDelay) d += cfg.replDelay[b] || 0;
        if (op && op.slow && kind === 'put' && (!op.slowTo || op.slowTo.includes(b))) d += op.slow;
        return d;
    }
    function event(s, text) { s.tickEvents.push(text); }
    function send(s, from, to, kind, body, op) {
        const msg = { id: ++s.seq, from, to, kind, body, sent: s.t, arrive: s.t + latency(s, from, to, kind, op) };
        if (from !== to) s.m.msgs++;
        if (from !== to) s.flow.push({ from, to, kind });
        if (kind === 'repair' || kind === 'hint') s.m.repair++;
        if (!reachable(s, from, to)) { dropped(s, msg); return; }
        if (msg.arrive <= s.t) deliver(s, msg); else s.msgs.push(msg);
    }
    function dropped(s, msg) {
        // The sender learns of the loss (perfect failure detector); leaders rewind what they shipped.
        if (msg.kind === 'repl') { const p = s.nodes[msg.from]; p.sentUpTo[msg.to] = p.acked[msg.to]; }
    }

    // ── Client operations ────────────────────────────────────────────────────
    function coordinatorFor(s, client) {
        const home = client.home;
        if (s.nodes[home].up) return home;
        // Reconnect to another node the client can reach (on its side of any partition).
        for (let i = 0; i < s.cfg.nodes; i++) if (s.nodes[i].up && linked(s, home, i)) return i;
        return -1;
    }
    function startOp(s, client, spec) {
        const op = { idx: s.ops.length, c: client.c, type: spec.op, k: spec.k, v: spec.v, spec, start: s.t, end: null, status: 'pending', result: undefined, resultIds: [], coord: -1, acks: 0, replies: [], need: 0, note: '', past: new Set(client.past), served: -1 };
        s.ops.push(op);
        client.busy = op;
        if (spec.ctx && op.v === 'merge') {
            // The client merges what it read: a union of the newest values it has seen.
            const seen = [...client.past].map(id => s.writes.get(id)).filter(x => x && x.k === op.k && !x.init && !x.del);
            const latest = seen.filter(x => !seen.some(y => y !== x && (y.past || new Set()).has(x.id)));
            op.v = latest.map(x => x.v).sort().join('+') || 'merge';
        }
        const coord = coordinatorFor(s, client);
        op.coord = coord;
        if (coord < 0) return finish(s, op, 'rejected', 'no reachable node');
        const verb = op.type === 'w' ? `writes ${op.k}=${showVal(op.v)}` : op.type === 'd' ? `deletes ${op.k}` : `reads ${op.k}`;
        event(s, `C${op.c} ${verb} via ${NODE_NAMES[coord]}.`);
        if (s.cfg.topology === 'leader') leaderStart(s, op, client); else quorumStart(s, op, client);
    }
    function finish(s, op, status, note, ids) {
        if (op.end !== null) return;
        op.end = s.t; op.status = status; op.note = note || '';
        const client = s.clients[op.c - 1];
        if (client.busy === op) client.busy = null;
        if (status === 'ok') {
            s.m.ok++; s.m.lat.push(op.end - op.start);
            if (op.type === 'r') {
                op.resultIds = ids && ids.length ? ids : [emptyRead(s, op.k)];
                const vers = op.resultIds.map(id => s.writes.get(id)).filter(Boolean);
                op.result = vers.length > 1 ? vers.map(x => (x.del ? '†' : showVal(x.v))).join(' | ') : vers.length ? (vers[0].del ? null : vers[0].v) : null;
                if (vers.length > 1) s.m.siblings++;
                for (const v of vers) { client.past.add(v.id); for (const p of v.past || []) client.past.add(p); }
                for (const v of vers) client.ctx[op.k] = vvMerge(client.ctx[op.k], v.vv);
                for (const v of vers) if (v.seq) client.maxSeen[op.k] = Math.max(client.maxSeen[op.k] || 0, v.seq);
                event(s, `C${op.c} reads ${op.k} = ${showVal(op.result)}${op.served >= 0 ? ' from ' + NODE_NAMES[op.served] : ''}${op.note ? ' (' + op.note + ')' : ''}.`);
            } else {
                event(s, `C${op.c}'s ${op.type === 'd' ? 'delete' : 'write'} of ${op.k}${op.type === 'w' ? '=' + showVal(op.v) : ''} is acknowledged${op.note ? ' (' + op.note + ')' : ''}.`);
            }
        } else if (status === 'rejected') {
            s.m.rejected++; event(s, `C${op.c}'s ${opWord(op)} is rejected: ${note}.`);
        } else {
            s.m.timedOut++; event(s, `C${op.c}'s ${opWord(op)} times out${note ? ' (' + note + ')' : ''}.`);
        }
    }
    /** A read that found nothing (tombstone purged) observed the effect of the latest acknowledged delete. */
    function emptyRead(s, k) {
        const dels = [...s.writes.values()].filter(v => v.k === k && v.del);
        return dels.length ? dels[dels.length - 1].id : 'w0' + k;
    }
    const opWord = op => (op.type === 'r' ? `read of ${op.k}` : op.type === 'd' ? `delete of ${op.k}` : `write ${op.k}=${showVal(op.v)}`);
    function newVersion(s, op, coordNode) {
        const client = s.clients[op.c - 1];
        const nd = s.nodes[coordNode];
        nd.counter++;
        const base = s.cfg.resolve === 'siblings' ? client.ctx[op.k] || {} : {};
        const vv = vvMerge(base); vv[nd.name] = Math.max(vv[nd.name] || 0, 0) + nd.counter;
        const v = op.v;
        const ver = { id: 'w' + (++s.wseq), k: op.k, v: op.type === 'd' ? null : v, del: op.type === 'd', ts: s.t + ((s.cfg.skew || [])[coordNode] || 0), node: coordNode, vv, epoch: nd.epoch, seq: 0, t: s.t, past: new Set(client.past), op: op.idx };
        s.writes.set(ver.id, ver);
        op.wid = ver.id;
        client.past.add(ver.id);
        client.ctx[op.k] = vvMerge(client.ctx[op.k], vv);
        return ver;
    }

    // ── Single leader ────────────────────────────────────────────────────────
    function primaryFor(s, from) {
        // The highest-epoch node acting as primary that `from` can reach.
        let best = -1;
        for (const nd of s.nodes) if (nd.role === 'primary' && reachable(s, from, nd.i) && (best < 0 || nd.epoch > s.nodes[best].epoch)) best = nd.i;
        return best;
    }
    function leaderStart(s, op, client) {
        const cfg = s.cfg;
        if (op.type !== 'r' || cfg.read === 'primary') {
            const p = primaryFor(s, op.coord);
            if (p < 0) return finish(s, op, 'rejected', op.type === 'r' ? 'no primary reachable' : 'no primary reachable — writes are unavailable');
            op.target = p;
            // Single leader: whatever node the client talks to, writes (and primary reads) are served by the primary.
            if (p !== op.coord) event(s, `${NODE_NAMES[op.coord]} is a replica, so it forwards the ${op.type === 'r' ? 'read' : 'write'} to the primary ${NODE_NAMES[p]}.`);
            send(s, op.coord, p, op.type === 'r' ? 'read' : 'write', { op: op.idx });
            return;
        }
        // Reads served by a replica, chosen by the routing mode.
        let target = op.coord;
        if (cfg.read !== 'home') {
            const order = Array.from({ length: cfg.nodes }, (_, i) => (client.home + i) % cfg.nodes).filter(i => reachable(s, op.coord, i));
            target = order.length ? order[client.readCount % order.length] : op.coord;
            client.readCount++;
        }
        op.target = target;
        op.token = cfg.read === 'ryw' ? client.lastWriteSeq : cfg.read === 'causal' ? Math.max(client.lastWriteSeq, client.seenSeq) : cfg.read === 'monotonic' ? (client.maxSeen[op.k] || 0) : 0;
        send(s, op.coord, target, 'read', { op: op.idx });
    }
    function appliedSeq(nd) { return nd.log.length; }
    function rebuildStore(s, nd) {
        const store = {};
        for (const k of s.sc.keys) store[k] = [s.writes.get('w0' + k)];
        for (const e of nd.log) store[e.k] = [s.writes.get(e.id)];
        nd.store = store;
    }
    function leaderDeliver(s, msg) {
        const nd = s.nodes[msg.to];
        if (msg.kind === 'write') {
            const op = s.ops[msg.body.op];
            if (op.end !== null) return;
            if (nd.role !== 'primary') return finish(s, op, 'rejected', `${nd.name} is no longer primary`);
            const ver = newVersion(s, op, nd.i);
            ver.epoch = nd.epoch; ver.seq = nd.log.length + 1;
            nd.log.push({ id: ver.id, k: ver.k, epoch: nd.epoch });
            nd.store[ver.k] = [ver];
            s.clients[op.c - 1].lastWriteSeq = ver.seq;
            event(s, `${nd.name} (primary) appends ${ver.k}=${showVal(ver.v)} at log position ${ver.seq}.`);
            op.seq = ver.seq; op.primary = nd.i;
            s.pending.push(op);
            leaderMaybeAck(s, nd);
        } else if (msg.kind === 'read') {
            const op = s.ops[msg.body.op];
            if (op.end !== null) return;
            if (s.cfg.read === 'primary' && op.target === nd.i && nd.role !== 'primary') return finish(s, op, 'rejected', `${nd.name} stepped down`);
            op.waitAt = nd.i;
            tryServeRead(s, op);
        } else if (msg.kind === 'repl') {
            const { start, entries, epoch } = msg.body;
            if (nd.role === 'primary' && nd.epoch >= epoch) return;
            if (epoch > nd.epoch) adoptEpoch(s, nd, epoch, msg.from);
            if (start <= nd.log.length) {
                const fresh = entries.slice(nd.log.length - start);
                for (const e of fresh) { nd.log.push(e); const ver = s.writes.get(e.id); nd.store[e.k] = [ver]; }
            }
            send(s, nd.i, msg.from, 'ack', { applied: nd.log.length, epoch: nd.epoch });
        } else if (msg.kind === 'ack') {
            if (nd.role !== 'primary') return;
            nd.acked[msg.from] = Math.max(nd.acked[msg.from], Math.min(msg.body.applied, nd.log.length));
            if (msg.body.applied < nd.sentUpTo[msg.from]) nd.sentUpTo[msg.from] = msg.body.applied;
            leaderMaybeAck(s, nd);
        } else if (msg.kind === 'reply') {
            const op = s.ops[msg.body.op];
            if (op.end !== null) return;
            finish(s, op, 'ok', msg.body.note, msg.body.ids);
        }
    }
    function leaderMaybeAck(s, nd) {
        const need = s.cfg.acks;
        for (const op of s.pending.slice()) {
            if (op.primary !== nd.i || op.end !== null) { if (op.end !== null) s.pending.splice(s.pending.indexOf(op), 1); continue; }
            const have = nd.acked.filter((a, i) => i !== nd.i && a >= op.seq).length;
            op.acks = have; op.need = need;
            if (have >= need) {
                s.pending.splice(s.pending.indexOf(op), 1);
                send(s, nd.i, op.coord, 'reply', { op: op.idx, note: need ? `${have} replica ack${have === 1 ? '' : 's'}` : 'async: not yet on any replica' });
            }
        }
    }
    function tryServeRead(s, op) {
        const nd = s.nodes[op.waitAt];
        if (!nd.up) return;
        if (op.token && appliedSeq(nd) < op.token) { op.waiting = true; return; }
        op.waiting = false;
        op.served = nd.i;
        const ids = (nd.store[op.k] || []).map(v => v.id);
        const client = s.clients[op.c - 1];
        client.seenSeq = Math.max(client.seenSeq, appliedSeq(nd));
        const note = op.token ? `token ${op.token} satisfied` : '';
        if (op.coord === nd.i) finish(s, op, 'ok', note, ids);
        else send(s, nd.i, op.coord, 'reply', { op: op.idx, ids, note });
    }
    function adoptEpoch(s, nd, epoch, leader) {
        // A node that learns of a newer primary follows it, cutting its log back to the longest common prefix.
        const L = s.nodes[leader];
        let common = 0;
        while (common < nd.log.length && common < L.log.length && nd.log[common].id === L.log[common].id) common++;
        const dropped = nd.log.slice(common);
        if (dropped.length) {
            for (const e of dropped) {
                const ver = s.writes.get(e.id);
                const op = ver && s.ops[ver.op];
                if (op && op.status === 'ok') { ver.lost = true; }
            }
            event(s, `${nd.name} discards ${dropped.length} log entr${dropped.length === 1 ? 'y' : 'ies'} the new primary never had (${dropped.map(e => e.k + '=' + showVal(s.writes.get(e.id).v)).join(', ')}).`);
        }
        nd.log = nd.log.slice(0, common);
        rebuildStore(s, nd);
        if (nd.role === 'primary') event(s, `${nd.name} sees epoch ${epoch} and steps down to replica.`);
        nd.role = 'replica'; nd.epoch = epoch;
    }
    function leaderTick(s) {
        const cfg = s.cfg, n = cfg.nodes;
        // Lease: a primary that cannot reach a majority for `failover` ticks stops serving.
        for (const nd of s.nodes) {
            if (!nd.up || nd.role !== 'primary') continue;
            const reach = s.nodes.filter(o => reachable(s, nd.i, o.i)).length;
            nd.unreachTicks = reach > n / 2 ? 0 : nd.unreachTicks + 1;
            // The lease is one tick shorter than the failover timeout, so it expires before anyone is promoted.
            const lease = Math.max(1, cfg.failover - 1);
            if (cfg.lease && cfg.failover && nd.unreachTicks >= lease) {
                nd.role = 'stepped-down';
                event(s, `${nd.name} cannot reach a majority for ${lease} tick${lease === 1 ? '' : 's'}: its lease expires and it stops accepting writes.`);
            }
        }
        // Monitor on the majority side promotes the most up-to-date replica when it cannot see a primary.
        if (cfg.failover) {
            const majority = majorityGroup(s);
            if (majority) {
                const topEpoch = Math.max(...s.nodes.map(x => x.epoch));
                const seen = majority.some(i => s.nodes[i].role === 'primary' && s.nodes[i].epoch === Math.max(...majority.map(j => s.nodes[j].epoch)));
                s.monitor = seen ? 0 : s.monitor + 1;
                if (!seen && s.monitor >= cfg.failover) {
                    const best = majority.slice().sort((a, b) => s.nodes[b].log.length - s.nodes[a].log.length || a - b)[0];
                    const nd = s.nodes[best];
                    nd.role = 'primary'; nd.epoch = topEpoch + 1; nd.sentUpTo = Array(n).fill(0); nd.acked = Array(n).fill(0);
                    nd.acked[nd.i] = nd.log.length;
                    s.monitor = 0; s.failovers++;
                    event(s, `Failover: ${nd.name} is promoted to primary (epoch ${nd.epoch}) with ${nd.log.length} log entr${nd.log.length === 1 ? 'y' : 'ies'}.`);
                    for (const j of majority) if (j !== best) { const o = s.nodes[j]; if (o.role === 'stepped-down' || o.role === 'primary') o.role = 'replica'; adoptEpoch(s, o, nd.epoch, best); }
                }
            }
        }
        // A deposed primary that can reach a newer one follows it.
        for (const nd of s.nodes) {
            if (!nd.up || (nd.role !== 'primary' && nd.role !== 'stepped-down')) continue;
            const newer = s.nodes.find(o => o.role === 'primary' && o.epoch > nd.epoch && reachable(s, nd.i, o.i));
            if (newer) adoptEpoch(s, nd, newer.epoch, newer.i);
        }
        // Each primary ships what each reachable replica has not received.
        for (const p of s.nodes) {
            if (!p.up || p.role !== 'primary') continue;
            p.acked[p.i] = p.log.length;
            for (const rep of s.nodes) {
                if (rep.i === p.i || !reachable(s, p.i, rep.i)) continue;
                if (rep.role === 'primary' && rep.epoch >= p.epoch) continue;
                if (p.sentUpTo[rep.i] < p.log.length) {
                    const start = p.sentUpTo[rep.i];
                    send(s, p.i, rep.i, 'repl', { start, entries: p.log.slice(start), epoch: p.epoch });
                    p.sentUpTo[rep.i] = p.log.length;
                }
            }
        }
        // Reads waiting for a replica to catch up to their session token.
        for (const op of s.ops) if (op.end === null && op.waiting) tryServeRead(s, op);
    }
    function majorityGroup(s) {
        const n = s.cfg.nodes;
        const up = s.nodes.filter(x => x.up).map(x => x.i);
        for (const a of up) {
            const g = up.filter(b => linked(s, a, b));
            if (g.length > n / 2) return g;
        }
        return null;
    }

    // ── Leaderless quorums ───────────────────────────────────────────────────
    function quorumTargets(s, coord, forRead) {
        const cfg = s.cfg, prefs = replicasOf(s);
        const live = prefs.filter(i => reachable(s, coord, i));
        if (!cfg.sloppy) return live.map(i => ({ node: i, hintFor: -1 }));
        // Sloppy: the first N reachable nodes of the extended list; a fallback stands in for a missing replica.
        const missing = prefs.filter(i => !reachable(s, coord, i));
        const extra = fallbacksOf(s).filter(i => reachable(s, coord, i)).slice(0, missing.length);
        return live.map(i => ({ node: i, hintFor: -1 })).concat(extra.map((node, j) => ({ node, hintFor: forRead ? -1 : missing[j] })));
    }
    function quorumStart(s, op, client) {
        const cfg = s.cfg;
        const prefs = replicasOf(s);
        const local = cfg.readLocal && op.type === 'r';
        let targets = quorumTargets(s, op.coord, op.type === 'r');
        void local;
        const need = op.type === 'r' ? cfg.R : cfg.W;
        op.need = need;
        if (targets.length < need) {
            if (op.type !== 'r' && cfg.hints && !cfg.sloppy) storeHints(s, op, prefs.filter(i => !reachable(s, op.coord, i)), null);
            return finish(s, op, 'rejected', `only ${targets.length} of the ${need} replicas needed are reachable`);
        }
        if (op.type === 'r') {
            // Ask only the R closest reachable replicas: the coordinator first, then by distance (lower index on ties).
            // With async read repair the rest are asked too; the answer still goes out after R replies,
            // and late replies that turn out stale get repaired in the background.
            targets = targets.slice().sort((a, b) => Math.abs(a.node - op.coord) - Math.abs(b.node - op.coord) || a.node - b.node);
            if (cfg.readRepair !== 'async') targets = targets.slice(0, need);
            op.asked = targets.map(x => x.node);
            for (const t of targets) send(s, op.coord, t.node, 'get', { op: op.idx });
            return;
        }
        const ver = newVersion(s, op, op.coord);
        op.ver = ver;
        // Replicas with no stand-in get a hint kept by the coordinator itself (strict quorums, or no fallback left).
        const covered = new Set(targets.filter(x => x.hintFor >= 0).map(x => x.hintFor));
        if (cfg.hints) storeHints(s, op, prefs.filter(i => !reachable(s, op.coord, i) && !covered.has(i)), ver);
        for (const t of targets) send(s, op.coord, t.node, 'put', { op: op.idx, ver, hintFor: t.hintFor }, op.spec);
    }
    function storeHints(s, op, missing, ver) {
        if (!ver || !missing.length) return;
        const coord = s.nodes[op.coord];
        for (const m of missing) coord.hints.push({ target: m, ver, since: s.t });
        event(s, `${coord.name} keeps a hint for ${missing.map(i => NODE_NAMES[i]).join(', ')} (down or unreachable).`);
    }
    function applyToStore(s, nd, ver) {
        const prev = nd.store[ver.k] || [];
        const was = setKey(prev);
        nd.store[ver.k] = mergeVersion(prev, ver, s.cfg.resolve);
        if (s.cfg.resolve === 'lww') {
            // Last-write-wins discarded a write the winner never saw, and which was not older: a silent loss.
            const win = nd.store[ver.k][0];
            for (const loser of prev.concat([ver])) {
                if (!win || loser.id === win.id || loser.init || (win.past && win.past.has(loser.id))) continue;
                if (loser.t >= win.t) loser.lwwDropped = true;
            }
        }
        return setKey(nd.store[ver.k]) !== was;
    }
    function quorumDeliver(s, msg) {
        const nd = s.nodes[msg.to], cfg = s.cfg;
        const op = msg.body.op !== undefined ? s.ops[msg.body.op] : null;
        if (msg.kind === 'put') {
            const { ver, hintFor } = msg.body;
            if (hintFor >= 0) {
                nd.hints.push({ target: hintFor, ver, since: s.t, fallback: true });
                event(s, `${nd.name} stores ${ver.k}=${showVal(ver.v)} as a hint for ${NODE_NAMES[hintFor]}.`);
            } else applyToStore(s, nd, ver);
            send(s, nd.i, msg.from, 'putack', { op: msg.body.op });
        } else if (msg.kind === 'putack') {
            if (!op || op.end !== null) return;
            op.acks++;
            if (op.acks >= op.need) finish(s, op, 'ok', `${op.acks}/${op.need} acks`);
        } else if (msg.kind === 'get') {
            // A fallback node answers with the writes it holds for others; a coordinator's own hints are not data it serves.
            const set = (nd.store[s.ops[msg.body.op].k] || []).concat(nd.hints.filter(h => h.fallback && h.ver.k === s.ops[msg.body.op].k).map(h => h.ver));
            send(s, nd.i, msg.from, 'getreply', { op: msg.body.op, ids: set.map(v => v.id) });
        } else if (msg.kind === 'getreply') {
            if (!op) return;
            const vers = msg.body.ids.map(id => s.writes.get(id));
            op.replies.push({ node: msg.from, vers });
            if (op.end !== null || op.repairing) { if (op.end !== null && cfg.readRepair === 'async') repairStale(s, op, false); return; }
            if (op.replies.length >= op.need) {
                op.merged = op.replies.reduce((set, rep) => rep.vers.reduce((acc, v) => mergeVersion(acc, v, cfg.resolve), set), []);
                op.served = op.replies.length === 1 ? op.replies[0].node : -1;
                const stale = op.replies.filter(rep => setKey(rep.vers.reduce((acc, v) => mergeVersion(acc, v, cfg.resolve), [])) !== setKey(op.merged));
                if (cfg.readRepair === 'blocking' && stale.length) {
                    event(s, `Read repair: the coordinator writes the newest ${op.k} back to ${stale.map(x => NODE_NAMES[x.node]).join(', ')} before answering C${op.c}.`);
                    if (repairStale(s, op, true)) return;
                    if (op.end !== null) return;
                }
                if (cfg.readRepair === 'async') repairStale(s, op, false);
                finish(s, op, 'ok', `${op.replies.length}/${op.need} replies${stale.length ? ', replicas disagreed' : ''}`, op.merged.map(v => v.id));
            }
        } else if (msg.kind === 'repair' || msg.kind === 'hint') {
            if (applyToStore(s, nd, msg.body.ver)) event(s, `${nd.name} applies ${msg.kind === 'hint' ? 'a hinted write' : 'a repair'}: ${msg.body.ver.k}=${verText(nd.store[msg.body.ver.k])}.`);
            if (msg.kind === 'hint') s.m.hintsReplayed++;
            send(s, nd.i, msg.from, msg.kind + 'ack', { op: msg.body.op, ver: msg.body.ver, target: nd.i });
        } else if (msg.kind === 'repairack') {
            if (!op || !op.repairing) return;
            op.repairing--;
            if (!op.repairing) finish(s, op, 'ok', `${op.replies.length}/${op.need} replies, repaired`, op.merged.map(v => v.id));
        } else if (msg.kind === 'hintack') {
            nd.hints = nd.hints.filter(h => !(h.target === msg.body.target && h.ver.id === msg.body.ver.id));
        }
    }
    function repairStale(s, op, blocking) {
        // Merge every reply received so far, including ones that arrived after the client was answered.
        op.merged = op.replies.reduce((set, rep) => rep.vers.reduce((acc, v) => mergeVersion(acc, v, s.cfg.resolve), set), []);
        op.repaired = op.repaired || new Set();
        const targets = [];
        for (const rep of op.replies) {
            if (op.repaired.has(rep.node)) continue;
            const have = rep.vers.reduce((acc, v) => mergeVersion(acc, v, s.cfg.resolve), []);
            if (setKey(have) === setKey(op.merged)) continue;
            op.repaired.add(rep.node);
            targets.push(rep.node);
        }
        const total = targets.length * op.merged.length;
        // Count before sending: a repair to the coordinator itself is delivered (and acknowledged) inline.
        if (blocking) op.repairing = total;
        for (const node of targets) for (const v of op.merged) send(s, op.coord, node, 'repair', { op: op.idx, ver: v });
        return blocking ? op.repairing : 0;
    }
    function quorumTick(s) {
        const cfg = s.cfg;
        // Hinted handoff: deliver hints to targets that are reachable again.
        for (const nd of s.nodes) {
            if (!nd.up) continue;
            for (const h of nd.hints) {
                if (h.sentAt === s.t || !reachable(s, nd.i, h.target) || (h.sentAt && s.t - h.sentAt < 3)) continue;
                h.sentAt = s.t;
                send(s, nd.i, h.target, 'hint', { ver: h.ver });
            }
        }
        // Tombstone GC: purge deletes older than gc-grace (only the tombstone; the key then looks never written).
        for (const nd of s.nodes) {
            if (!nd.up) continue;
            for (const k of Object.keys(nd.store)) {
                const set = nd.store[k];
                if (set.length === 1 && set[0].del && s.t - set[0].t >= cfg.gcGrace) {
                    nd.store[k] = [];
                    s.gcd++;
                    event(s, `${nd.name} purges the tombstone for ${k} (older than gc-grace = ${cfg.gcGrace} ticks).`);
                }
            }
        }
        // Anti-entropy: every `ae` ticks, replica pairs compare Merkle trees and exchange only differing keys.
        if (cfg.ae && s.t > 0 && s.t % cfg.ae === 0) {
            const reps = replicasOf(s).filter(i => s.nodes[i].up);
            let best = null;
            for (let a = 0; a < reps.length; a++) for (let b = a + 1; b < reps.length; b++) {
                if (!reachable(s, reps[a], reps[b])) continue;
                const pass = merklePass(s, reps[a], reps[b]);
                if (!best || pass.diffKeys.length > best.diffKeys.length) best = pass;
            }
            if (best) s.lastMerkle = Object.assign({ at: s.t }, best);
        }
    }

    // ── Merkle trees ─────────────────────────────────────────────────────────
    function hashStr(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        // murmur3 finalizer: FNV alone leaves near-identical strings ("node1#3", "node1#4") close together.
        h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
        return h >>> 0;
    }
    function merkleTree(s, nd) {
        const keys = s.sc.keys.slice(0, MAX_KEYS);
        while (keys.length & (keys.length - 1)) keys.push('');
        let level = keys.map(k => (k ? hashStr(k + ':' + setKey(nd.store[k] || [])) : 0));
        const levels = [level];
        while (level.length > 1) { const next = []; for (let i = 0; i < level.length; i += 2) next.push(hashStr(level[i] + ':' + level[i + 1])); levels.unshift(next); level = next; }
        return { levels, keys };
    }
    function merklePass(s, a, b) {
        const A = merkleTree(s, s.nodes[a]), B = merkleTree(s, s.nodes[b]);
        // Compare top-down; only descend into subtrees whose hashes differ.
        const diff = A.levels.map(l => l.map(() => 0));
        let compared = 0;
        const walk = (lvl, i) => {
            compared++;
            if (A.levels[lvl][i] === B.levels[lvl][i]) return;
            diff[lvl][i] = 1;
            if (lvl + 1 < A.levels.length) { walk(lvl + 1, 2 * i); walk(lvl + 1, 2 * i + 1); }
        };
        walk(0, 0);
        const leaves = diff[diff.length - 1];
        const diffKeys = A.keys.filter((k, i) => k && leaves[i]);
        for (const k of diffKeys) {
            const merged = (s.nodes[a].store[k] || []).concat(s.nodes[b].store[k] || []).reduce((acc, v) => mergeVersion(acc, v, s.cfg.resolve), []);
            for (const v of merged) { send(s, a, b, 'repair', { ver: v }); send(s, b, a, 'repair', { ver: v }); }
            s.m.aeKeys++;
        }
        if (diffKeys.length) event(s, `Anti-entropy ${NODE_NAMES[a]}↔${NODE_NAMES[b]}: ${compared} hashes compared, ${diffKeys.length} key${diffKeys.length === 1 ? '' : 's'} differ (${diffKeys.join(', ')}) and are exchanged.`);
        else event(s, `Anti-entropy ${NODE_NAMES[a]}↔${NODE_NAMES[b]}: root hashes match — nothing to send.`);
        return { a, b, A: A.levels, B: B.levels, diff, compared, diffKeys, keys: A.keys };
    }

    // ── Tick loop ────────────────────────────────────────────────────────────
    function deliver(s, msg) {
        // A message already on the wire survives its sender's crash; it needs a live receiver and an intact link.
        if (!s.nodes[msg.to].up || !linked(s, msg.from, msg.to)) { dropped(s, msg); return; }
        if (s.cfg.topology === 'leader') leaderDeliver(s, msg); else quorumDeliver(s, msg);
    }
    function tick(s) {
        const cfg = s.cfg;
        s.flow = [];
        // Faults scheduled for this tick.
        for (const c of cfg.crash || []) {
            const nd = s.nodes[c.node];
            if (!nd) continue;
            if (c.at === s.t && nd.up) {
                nd.up = false; event(s, `💥 ${nd.name} crashes.`);
                for (const op of s.ops) if (op.end === null && op.coord === nd.i) finish(s, op, 'timeout', `${nd.name} crashed`);
            }
            if (c.back === s.t && !nd.up) { nd.up = true; nd.recovering = 3; event(s, `${nd.name} restarts${cfg.topology === 'leader' && nd.role === 'primary' ? ' and still believes it is primary' : ''}.`); }
        }
        if (cfg.cut && cfg.cut.at === s.t) event(s, `✂️ Network partition: ${cfg.cut.side.map(i => NODE_NAMES[i]).join(', ')} cut off from the rest.`);
        if (cfg.cut && cfg.cut.heal === s.t) event(s, '🔗 The partition heals.');
        // Messages arriving now (dropped if the link or an endpoint is gone).
        const due = s.msgs.filter(m => m.arrive <= s.t).sort((a, b) => a.arrive - b.arrive || a.id - b.id);
        s.msgs = s.msgs.filter(m => m.arrive > s.t);
        for (const m of due) deliver(s, m);
        if (cfg.topology === 'leader') leaderTick(s); else quorumTick(s);
        // Clients issue their next operation once the previous one finished.
        for (const client of s.clients) {
            if (client.busy) continue;
            const next = s.sc.ops.find(o => o.c === client.c && !o.issued && o.t <= s.t);
            if (next) { next.issued = true; startOp(s, client, next); }
        }
        // Timeouts.
        for (const op of s.ops) if (op.end === null && s.t - op.start >= cfg.timeout) finish(s, op, 'timeout', op.type === 'r' ? `${op.replies.length}/${op.need || 1} replies` : `${op.acks}/${op.need} acks`);
        for (const nd of s.nodes) if (nd.recovering) nd.recovering--;
    }

    // ── History checker ──────────────────────────────────────────────────────
    /** Real-time precedence: a finished strictly before b started. */
    const before = (a, b) => a.end !== null && a.end !== Infinity && b.start > a.end;
    function analyse(s, upTo) {
        const ops = s.ops.filter(o => o.start <= upTo);
        const done = o => o.end !== null && o.end <= upTo;
        const writesById = s.writes;
        const writeOp = id => { const v = writesById.get(id); return v && !v.init ? s.ops[v.op] : null; };
        const hb = (a, b) => { const vb = writesById.get(b); return !!(vb && vb.past && vb.past.has(a)); };
        const labels = [];
        const byClient = new Map();
        for (const op of ops) {
            if (op.type !== 'r' || !done(op) || op.status !== 'ok') continue;
            const client = op.c, key = op.k;
            const returned = op.resultIds;
            const ret = returned.length === 1 ? returned[0] : null;
            const isInit = id => !id || (writesById.get(id) || {}).init;
            const earlier = ops.filter(o => o.c === client && o.idx < op.idx && done(o));
            let label = 'fresh';
            if (returned.length > 1) label = 'siblings';
            else {
                // Weakest guarantee broken, checked strongest-first so the last assignment is the weakest.
                const realtimeStale = ops.some(o => o !== op && o.k === key && o.type !== 'r' && o.status === 'ok' && done(o) && before(o, op) && o.wid !== ret
                    && (isInit(ret) || (writeOp(ret) && before(writeOp(ret), o)) || hb(ret, o.wid)));
                // Or a read that finished before this one began already returned a newer write.
                const readInversion = ops.some(o => o !== op && o.k === key && o.type === 'r' && o.status === 'ok' && done(o) && before(o, op) && o.resultIds.length === 1
                    && o.resultIds[0] !== ret && !isInit(o.resultIds[0]) && (isInit(ret) || hb(ret, o.resultIds[0]) || (writeOp(ret) && writeOp(o.resultIds[0]) && before(writeOp(ret), writeOp(o.resultIds[0])))));
                if (realtimeStale || readInversion) label = 'stale';
                const past = [...op.past].filter(id => (writesById.get(id) || {}).k === key && !(writesById.get(id) || {}).init);
                if (past.some(p => p !== ret && (isInit(ret) || hb(ret, p)))) label = 'causal';
                const prevReads = earlier.filter(o => o.type === 'r' && o.k === key && o.status === 'ok' && o.resultIds.length === 1);
                if (prevReads.some(o => o.resultIds[0] !== ret && !isInit(o.resultIds[0]) && (isInit(ret) || hb(ret, o.resultIds[0]) || (writeOp(ret) && writeOp(o.resultIds[0]) && before(writeOp(ret), writeOp(o.resultIds[0])))))) label = 'monotonic';
                const ownWrites = earlier.filter(o => o.type !== 'r' && o.k === key && o.status === 'ok');
                if (ownWrites.some(o => o.wid !== ret && (isInit(ret) || hb(ret, o.wid)))) label = 'ryw';
            }
            labels.push({ op: op.idx, c: client, k: key, label });
            byClient.set(client, (byClient.get(client) || 0) + 1);
        }
        const lin = linearizable(s, ops.filter(o => o.start <= upTo), upTo);
        return { labels, lin };
    }
    /** Wing–Gong search per key over completed ops; writes that timed out may or may not have taken effect. */
    function linearizable(s, ops, upTo) {
        const keys = [...new Set(ops.map(o => o.k))];
        for (const k of keys) {
            const list = ops.filter(o => o.k === k && (o.status === 'ok' || (o.type !== 'r' && o.status === 'timeout') || (o.type !== 'r' && o.end === null)) && o.start <= upTo)
                .map(o => ({ type: o.type === 'r' ? 'r' : 'w', start: o.start, end: o.end !== null && o.end <= upTo && o.status === 'ok' ? o.end : Infinity,
                    required: o.status === 'ok' && o.end !== null && o.end <= upTo, value: o.type === 'r' ? (o.resultIds.length === 1 ? o.resultIds[0] : '∗siblings') : o.wid }));
            if (list.some(o => o.value === '∗siblings')) return { ok: false, key: k, reason: `a read of ${k} returned siblings (two values at once)` };
            if (list.length > 18) continue;
            const init = 'w0' + k;
            const memo = new Set();
            const n = list.length;
            const full = (1 << n) - 1;
            const dfs = (mask, value) => {
                const id = mask + '|' + value;
                if (memo.has(id)) return false;
                let pendingRequired = false;
                let minEnd = Infinity;
                for (let i = 0; i < n; i++) if (!(mask & (1 << i))) { if (list[i].required) pendingRequired = true; minEnd = Math.min(minEnd, list[i].end); }
                if (!pendingRequired) return true;
                for (let i = 0; i < n; i++) {
                    if (mask & (1 << i)) continue;
                    const o = list[i];
                    if (o.start > minEnd) continue;
                    if (o.type === 'r') { if ((o.value || init) === value && dfs(mask | (1 << i), value)) return true; }
                    else if (dfs(mask | (1 << i), o.value)) return true;
                }
                memo.add(id);
                return false;
            };
            void full;
            if (!dfs(0, init)) return { ok: false, key: k, reason: `no single order of the operations on ${k} explains every read while respecting real time` };
        }
        return { ok: true };
    }

    // ── Snapshot ─────────────────────────────────────────────────────────────
    const LABEL_TEXT = { fresh: 'fresh', stale: 'stale (not linearizable)', causal: 'breaks causal', monotonic: 'breaks monotonic reads', ryw: 'breaks read-your-writes', siblings: 'siblings' };
    function newestIds(s, k) {
        // The newest version(s) of a key anywhere in the cluster: what a fully repaired replica would hold.
        let set = [];
        for (const nd of s.nodes) for (const v of (nd.store[k] || []).concat(nd.hints.filter(h => h.ver.k === k).map(h => h.ver))) set = mergeVersion(set, v, s.cfg.resolve);
        if (s.cfg.topology === 'leader') {
            const p = s.nodes.filter(x => x.role === 'primary').sort((a, b) => b.epoch - a.epoch)[0];
            if (p) return (p.store[k] || []).map(v => v.id).join(',');
        }
        return setKey(set);
    }
    function nodeStatus(s, nd) {
        const cfg = s.cfg;
        if (!nd.up) return { code: 2, text: 'down' };
        const cut = cutActive(s, s.t) && cfg.cut.side.includes(nd.i);
        if (cfg.topology === 'leader') {
            const top = s.nodes.filter(x => x.role === 'primary').sort((a, b) => b.epoch - a.epoch)[0];
            const lag = top && nd !== top ? Math.max(0, top.log.length - nd.log.length) : 0;
            if (nd.role === 'primary') return { code: 1, text: `primary · epoch ${nd.epoch} · log ${nd.log.length}${cut ? ' · cut off' : ''}` };
            if (nd.role === 'stepped-down') return { code: 3, text: `stepped down · log ${nd.log.length}` };
            return { code: cut ? 3 : nd.recovering ? 4 : 0, text: `replica · log ${nd.log.length}${lag ? ' · lag ' + lag : ''}${cut ? ' · cut off' : ''}` };
        }
        const isRep = replicasOf(s).includes(nd.i);
        return { code: cut ? 3 : nd.recovering ? 4 : isRep ? 0 : 5, text: `${isRep ? 'replica' : 'fallback'}${nd.hints.length ? ' · ' + nd.hints.length + ' hint' + (nd.hints.length === 1 ? '' : 's') : ''}${cut ? ' · cut off' : ''}` };
    }
    function snapshot(s) {
        const cfg = s.cfg, keys = s.sc.keys.slice(0, MAX_KEYS);
        const analysis = analyse(s, s.t);
        const labelOf = new Map(analysis.labels.map(l => [l.op, l.label]));
        const newest = Object.fromEntries(keys.map(k => [k, newestIds(s, k)]));
        // Per node × key: text and code (0 none, 1 newest, 2 behind, 3 siblings, 4 tombstone, 5 hint held, 6 node down).
        const verGrid = [], verCodes = [];
        for (const nd of s.nodes) {
            const row = [], codes = [];
            for (const k of keys) {
                const set = nd.store[k] || [];
                const hint = nd.hints.filter(h => h.ver.k === k);
                let text = verText(set);
                if (hint.length) text = (text ? text + ' ' : '') + '⟨' + hint.map(h => (h.ver.del ? '†' : showVal(h.ver.v)) + '→' + NODE_NAMES[h.target]).join(' ') + '⟩';
                row.push(text);
                codes.push(!nd.up ? 6 : !set.length && !hint.length ? 0 : set.length > 1 ? 3 : set.length && set[0].del ? 4 : !set.length ? 5 : setKey(set) === newest[k] ? 1 : 2);
            }
            verGrid.push(row); verCodes.push(codes);
        }
        const status = s.nodes.map(nd => nodeStatus(s, nd));
        // Client timeline: per client × tick codes. 0 idle · 1 write in flight · 2 read in flight · 3 write ok · 4 fresh read ·
        // 5 stale read (any guarantee broken) · 6 rejected / timed out · 7 acknowledged write later lost · 8 siblings.
        const tl = s.clients.map(() => Array(FRAMES + 1).fill(0));
        const tlText = s.clients.map(() => Array(FRAMES + 1).fill(''));
        for (const op of s.ops) {
            const row = op.c - 1, end = op.end === null ? s.t : op.end;
            const lost = op.wid && (s.writes.get(op.wid) || {}).lost;
            for (let t = op.start; t <= Math.min(end, FRAMES); t++) tl[row][t] = op.type === 'r' ? 2 : 1;
            if (op.end !== null && op.end <= FRAMES) {
                const lab = labelOf.get(op.idx);
                tl[row][op.end] = op.status !== 'ok' ? 6 : op.type !== 'r' ? (lost ? 7 : 3) : lab === 'siblings' ? 8 : lab && lab !== 'fresh' ? 5 : 4;
            }
            if (op.start <= FRAMES) tlText[row][op.start] = op.type === 'r' ? 'R' + op.k : op.type === 'd' ? 'D' + op.k : op.k + '=' + showVal(op.v);
            if (op.end !== null && op.end <= FRAMES) tlText[row][op.end] = op.status === 'ok' ? (op.type === 'r' ? '→' + showVal(op.result) : (lost ? 'lost' : '✓')) : op.status === 'rejected' ? '✗' : '⌛';
        }
        // Messages in flight.
        const inflight = s.msgs.slice().sort((a, b) => a.arrive - b.arrive || a.id - b.id);
        const msgText = inflight.slice(0, MSG_SLOTS).map(m => `${NODE_NAMES[m.from]}→${NODE_NAMES[m.to]} ${msgLabel(s, m)} · t${m.arrive}`);
        // Links: each node's connection to the network. 0 idle · 1 traffic this tick · 2 cut · 3 node down.
        const linkCodes = s.nodes.map(nd => (!nd.up ? 3 : cutActive(s, s.t) && cfg.cut.side.includes(nd.i) ? 2 : s.flow.some(f => f.from === nd.i || f.to === nd.i) || inflight.some(m => m.sent === s.t && (m.from === nd.i || m.to === nd.i)) ? 1 : 0));
        // Node pairs (a < b, in order 01 02 … 12 …): 0 idle · 1 a message between them is in flight or arrived this tick ·
        // 2 cut by the partition · 3 an endpoint is down.
        // pairDirs: which way that traffic goes — 1 a → b, -1 b → a, 2 both ways, 0 none.
        const pairCodes = [], pairDirs = [];
        for (let a = 0; a < s.nodes.length; a++) for (let b = a + 1; b < s.nodes.length; b++) {
            const msgs = inflight.concat(s.flow);
            const ab = msgs.some(m => m.from === a && m.to === b), ba = msgs.some(m => m.from === b && m.to === a);
            pairCodes.push(!s.nodes[a].up || !s.nodes[b].up ? 3 : !linked(s, a, b) ? 2 : ab || ba ? 1 : 0);
            pairDirs.push(ab && ba ? 2 : ab ? 1 : ba ? -1 : 0);
        }
        // Client ↔ node: a request reached or was answered by this node (its coordinator) this tick.
        const clientLinks = s.nodes.map(nd => (s.ops.some(o => o.coord === nd.i && (o.start === s.t || o.end === s.t)) ? 1 : 0));
        const clientText = s.clients.map(c => {
            const op = c.busy;
            const coord = op ? op.coord : coordinatorFor(s, c);
            const where = coord >= 0 ? NODE_NAMES[coord] : 'no node';
            if (!op) return `C${c.c} · idle · via ${where}`;
            const what = op.type === 'r' ? `read ${op.k}` : op.type === 'd' ? `delete ${op.k}` : `write ${op.k}=${showVal(op.v)}`;
            const progress = cfg.topology === 'leader'
                ? (op.type === 'r' ? (op.waiting ? `waits for ${NODE_NAMES[op.waitAt]} to reach position ${op.token}` : `at ${NODE_NAMES[op.target] ?? where}`) : op.seq ? `${op.acks}/${op.need} replica acks` : `to primary`)
                : (op.type === 'r' ? `${op.replies.length}/${op.need} replies${op.repairing ? ', repairing' : ''}` : `${op.acks}/${op.need} acks`);
            return `C${c.c} · ${what} · ${progress}`;
        });
        const ackRows = s.clients.map(c => { const op = c.busy; return op ? [op.type === 'r' ? op.replies.length : op.acks, op.need || (op.type === 'r' ? 1 : cfg.acks)] : [0, 0]; });
        // Metrics.
        const reads = analysis.labels;
        const staleN = reads.filter(l => l.label !== 'fresh').length;
        const lost = [...s.writes.values()].filter(v => v.lost || lostByLww(s, v)).length;
        const lats = s.m.lat.slice().sort((a, b) => a - b);
        const pct = p => (lats.length ? lats[Math.min(lats.length - 1, Math.floor(p * lats.length))] : 0);
        const finished = s.m.ok + s.m.rejected + s.m.timedOut;
        const converged = keys.every(k => { const sets = s.nodes.filter(nd => nd.up && (cfg.topology === 'leader' || replicasOf(s).includes(nd.i))).map(nd => setKey(nd.store[k] || [])); return sets.every(x => x === sets[0]); });
        const resurrected = resurrections(s);
        const notes = s.tickEvents.slice();
        const row = {
            tick: s.t, scenario: s.sc.title, topology: cfg.topology,
            text: notes.join(' ') || (s.t === 0 ? '' : 'Nothing happens this tick.'), events: notes,
            nodeNames: s.nodes.map(nd => nd.name), nodeCount: s.nodes.length, clientNames: s.clients.map(c => `C${c.c} → ${NODE_NAMES[c.home]}`), nodeText: status.map(x => x.text), nodeCodes: status.map(x => x.code),
            keys, verGrid, verCodes,
            msgText, msgCount: inflight.length, linkCodes, pairCodes, pairDirs, clientLinks,
            clientText, ackRows,
            tl, tlText,
            labels: reads.map(l => `C${l.c} read ${l.k} (op ${l.op + 1}): ${LABEL_TEXT[l.label]}`),
            linOk: analysis.lin.ok ? 1 : 0, linText: analysis.lin.ok ? 'linearizable so far' : `not linearizable: ${analysis.lin.reason}`,
            converged: converged ? 1 : 0,
            merkle: s.lastMerkle ? { a: NODE_NAMES[s.lastMerkle.a], b: NODE_NAMES[s.lastMerkle.b], at: s.lastMerkle.at, A: s.lastMerkle.A, B: s.lastMerkle.B, diff: s.lastMerkle.diff, compared: s.lastMerkle.compared, diffKeys: s.lastMerkle.diffKeys, keys: s.lastMerkle.keys } : null,
            ops: s.ops.filter(o => o.start === s.t || o.end === s.t).map(o => `C${o.c}:${o.type === 'r' ? 'get' : o.type === 'd' ? 'del' : 'put'}${o.start === s.t ? ':start' : ''}${o.end === s.t ? ':' + o.status : ''}`),
            flow: s.flow.map(f => `${f.from}>${f.to}:${f.kind}`),
            m_ok: s.m.ok, m_rejected: s.m.rejected, m_timedOut: s.m.timedOut, m_unavailable: s.m.rejected + s.m.timedOut,
            m_availability: finished ? Math.round(100 * s.m.ok / finished) : 100,
            m_p50: pct(0.5), m_p99: pct(0.99), m_maxLat: lats.length ? lats[lats.length - 1] : 0,
            m_stale: staleN, m_lost: lost, m_siblings: s.m.siblings, m_msgs: s.m.msgs, m_repair: s.m.repair, m_hints: s.m.hintsReplayed, m_aeKeys: s.m.aeKeys,
            m_failovers: s.failovers, m_resurrected: resurrected, m_gc: s.gcd,
        };
        return JSON.parse(JSON.stringify(row));
    }
    function msgLabel(s, m) {
        const b = m.body || {};
        const ver = b.ver;
        switch (m.kind) {
            case 'repl': return `log ${b.start + 1}–${b.start + b.entries.length}`;
            case 'put': return `put ${ver.k}=${showVal(ver.v)}${b.hintFor >= 0 ? ' (hint)' : ''}`;
            case 'hint': return `hint ${ver.k}=${showVal(ver.v)}`;
            case 'repair': return `repair ${ver.k}=${ver.del ? '†' : showVal(ver.v)}`;
            case 'get': case 'read': return `read ${s.ops[b.op].k}`;
            case 'getreply': case 'reply': return 'reply';
            case 'write': return `write ${s.ops[b.op].k}=${showVal(s.ops[b.op].v)}`;
            default: return m.kind;
        }
    }
    /** An acknowledged write silently discarded by last-write-wins (marked when a replica merge dropped it). */
    function lostByLww(s, v) {
        if (s.cfg.topology === 'leader' || s.cfg.resolve !== 'lww' || v.init || v.lost || !v.lwwDropped) return false;
        const op = s.ops[v.op];
        return !!(op && op.status === 'ok');
    }
    /** Keys whose surviving value was deleted (in causal order) by an acknowledged delete. */
    function resurrections(s) {
        let n = 0;
        for (const k of s.sc.keys) {
            const dels = [...s.writes.values()].filter(v => v.k === k && v.del && s.ops[v.op] && s.ops[v.op].status === 'ok');
            const live = new Set();
            for (const nd of s.nodes) for (const v of nd.store[k] || []) if (!v.del && !v.init) live.add(v.id);
            if ([...live].some(id => dels.some(d => d.past && d.past.has(id)))) n++;
        }
        return n;
    }

    // ── Runner + cache ───────────────────────────────────────────────────────
    const traceCache = new Map();
    const recent = [];
    function overridesKey(ov) { const o = objOf(ov); return JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]])); }
    function run(scenario, ov, frames) {
        const sc = scenarioOf(scenario);
        const argKey = sc.id + '|' + overridesKey(ov) + '|' + (frames || FRAMES);
        for (const r of recent) if (r.key === argKey) return r.rows;
        let rows = traceCache.get(argKey);
        if (!rows) {
            const cfg = configOf(sc, ov);
            const scCopy = Object.assign({}, sc, { ops: sc.ops.map(o => Object.assign({}, o)) });
            const s = createState(scCopy, cfg);
            rows = [];
            const total = frames || FRAMES;
            for (s.t = 0; s.t <= total; s.t++) {
                s.tickEvents = [];
                if (s.t > 0) tick(s); else s.tickEvents.push(sc.story);
                rows.push(snapshot(s));
            }
            rows.cfg = cfg;
            if (traceCache.size >= 160) traceCache.delete(traceCache.keys().next().value);
            traceCache.set(argKey, rows);
        }
        recent.unshift({ key: argKey, rows });
        if (recent.length > 8) recent.pop();
        return rows;
    }

    // ── Computed matrices ────────────────────────────────────────────────────
    const memo = new Map();
    const memoize = (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); };
    /** Outcome summary of a finished run: code 0 lost write · 1 stale/broken guarantee · 2 unavailable · 3 siblings · 4 ✓. */
    function outcome(rows) {
        const last = rows[rows.length - 1];
        const parts = [];
        if (last.m_lost) parts.push(`${last.m_lost} lost`);
        if (last.m_resurrected) parts.push('resurrected');
        if (last.m_stale) parts.push(`${last.m_stale} stale`);
        if (last.m_unavailable) parts.push(`${last.m_unavailable} failed`);
        if (last.m_siblings) parts.push('siblings');
        const code = last.m_lost || last.m_resurrected ? 0 : last.m_stale || !last.linOk ? 1 : last.m_unavailable ? 2 : last.m_siblings ? 3 : 4;
        return { code, text: parts.length ? parts.join(' · ') : '✓', last };
    }
    /** Consistency scene: scenario (row) × read guarantee (col). */
    const CONSISTENCY_ROWS = ['ryw', 'monotonic', 'causal', 'linearizable'];
    function guaranteeCell(row, col) {
        return memoize(`g:${row}:${col}`, () => {
            const rows = run(CONSISTENCY_ROWS[clampInt(row, 0, 3)], { read: clampInt(col, 0, READ_MODES.length - 1) });
            const o = outcome(rows), last = o.last;
            const worst = ['ryw', 'monotonic', 'causal', 'stale'].find(l => last.labels.some(x => x.endsWith(LABEL_TEXT[l])));
            return { code: worst ? 1 : last.m_unavailable ? 2 : 4, text: worst ? '✗ ' + { ryw: 'RYW', monotonic: 'MR', causal: 'causal', stale: 'stale' }[worst] : `✓ p99 ${last.m_p99}t` };
        });
    }
    /** Quorum scene: R (row 1..N) × W (col 1..N) for the scenario at N, with failures. */
    function quorumCell(scenario, N, down, rr, row, col) {
        const R = clampInt(row, 0, 4) + 1, W = clampInt(col, 0, 4) + 1;
        const n = clampInt(N, 1, 5);
        return memoize(`q:${scenario}:${n}:${down}:${rr}:${R}:${W}`, () => {
            if (R > n || W > n) return { code: 5, text: '' };
            const rows = run(scenario, { N: n, R, W, down: clampInt(down, 0, 4), readRepair: clampInt(rr, 0, 2) });
            const o = outcome(rows), last = o.last;
            const label = last.m_stale ? `${last.m_stale} stale` : last.m_unavailable ? `${last.m_unavailable} failed` : `✓ ${last.m_p99}t`;
            return { code: last.m_lost ? 0 : last.m_stale ? 1 : last.m_unavailable ? 2 : 4, text: label };
        });
    }
    /** Comparison scene: profile (row) × comparison scenario (col). */
    function profileCell(row, col) {
        const p = clampInt(row, 0, PROFILES.length - 1), c = clampInt(col, 0, COMPARE_SCENARIOS.length - 1);
        return memoize(`p:${p}:${c}`, () => outcome(run(COMPARE_SCENARIOS[c], { profile: p })));
    }

    // ── Placement engine ─────────────────────────────────────────────────────
    const STRATEGIES = [
        { id: 'range-id', label: 'Range on user id' },
        { id: 'range-time', label: 'Range on signup time' },
        { id: 'hash-id', label: 'Hash of user id' },
        { id: 'hash-country', label: 'Hash of country' },
    ];
    const COUNTRIES = ['US', 'IN', 'BR', 'DE', 'JP', 'NG', 'FR', 'MX'];
    const COUNTRY_WEIGHT = [8, 6, 3, 2, 2, 1, 1, 1];
    /** Deterministic records: id, signup time (increasing), country (skewed). */
    function records(count) {
        const out = [];
        let seed = 7;
        const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
        const total = COUNTRY_WEIGHT.reduce((a, b) => a + b, 0);
        for (let i = 0; i < count; i++) {
            let pick = rnd() * total, c = 0;
            while (pick >= COUNTRY_WEIGHT[c]) { pick -= COUNTRY_WEIGHT[c]; c++; }
            out.push({ id: 1000 + Math.floor(rnd() * 9000), time: i, country: COUNTRIES[c] });
        }
        return out;
    }
    function shardOf(strategy, rec, shards, total) {
        switch (strategy) {
            case 'range-id': return Math.min(shards - 1, Math.floor((rec.id - 1000) / (9000 / shards)));
            case 'range-time': return Math.min(shards - 1, Math.floor(rec.time / Math.ceil(total / shards)));
            case 'hash-id': return hashStr('u' + rec.id) % shards;
            case 'hash-country': return hashStr(rec.country) % shards;
        }
        return 0;
    }
    /** Shard load for a strategy: writes per shard over the recent window, with optional celebrity traffic on one user. */
    function shardStats(strategyIdx, shards, count, celebrity) {
        const strat = STRATEGIES[clampInt(strategyIdx, 0, STRATEGIES.length - 1)].id;
        const S = clampInt(shards, 1, 8), n = clampInt(count, 8, 400);
        return memoize(`sh:${strat}:${S}:${n}:${celebrity}`, () => {
            const recs = records(n);
            const stored = Array(S).fill(0), writes = Array(S).fill(0);
            // "Now" traffic: new signups (the last quarter of records) plus updates to existing users.
            for (const rec of recs) stored[shardOf(strat, rec, S, n)]++;
            const recentFrom = Math.floor(n * 0.75);
            for (const rec of recs.slice(recentFrom)) writes[shardOf(strat, rec, S, n)] += 2;
            for (const rec of recs.slice(0, recentFrom)) if (rec.id % 3 === 0) writes[shardOf(strat, rec, S, n)] += 1;
            if (celebrity) { const star = recs[Math.floor(n / 3)]; writes[shardOf(strat, star, S, n)] += Math.round(n * 0.4 * celebrity); }
            const mean = writes.reduce((a, b) => a + b, 0) / S;
            const max = Math.max(...writes);
            // Queries: point lookup by id, range of ids, recent signups, by country.
            const touched = q => {
                const hit = new Set();
                if (q === 0) hit.add(shardOf(strat, recs[5], S, n));
                if (q === 1) for (const rec of recs.filter(x => x.id >= 3000 && x.id < 3600)) hit.add(shardOf(strat, rec, S, n));
                if (q === 2) for (const rec of recs.slice(n - Math.ceil(n / 10))) hit.add(shardOf(strat, rec, S, n));
                if (q === 3) for (const rec of recs.filter(x => x.country === 'DE')) hit.add(shardOf(strat, rec, S, n));
                // A strategy that cannot route the predicate must ask every shard.
                const routable = { 'range-id': [0, 1], 'range-time': [2], 'hash-id': [0], 'hash-country': [3] }[strat];
                return routable.includes(q) ? hit.size : S;
            };
            return { stored, writes, mean, max, imbalance: mean ? max / mean : 1, queries: [0, 1, 2, 3].map(touched) };
        });
    }
    const QUERIES = ['user by id', 'ids 3000–3599', 'latest signups', 'users in DE'];

    /** Consistent hashing: ring positions in [0, 1). */
    const RING_KEYS = 48;
    function ringTokens(nodes, vnodes) {
        const out = [];
        for (let n = 0; n < nodes; n++) for (let v = 0; v < vnodes; v++) out.push({ node: n, pos: hashStr(`node${n}#${v}`) / 4294967296 });
        return out.sort((a, b) => a.pos - b.pos);
    }
    const keyPos = i => hashStr('key' + i) / 4294967296;
    function ownerOf(tokens, pos) { for (const t of tokens) if (t.pos >= pos) return t.node; return tokens[0].node; }
    function preference(tokens, pos, rf) {
        const out = [];
        const start = tokens.findIndex(t => t.pos >= pos);
        for (let j = 0; j < tokens.length && out.length < rf; j++) { const t = tokens[(Math.max(0, start) + j) % tokens.length]; if (!out.includes(t.node)) out.push(t.node); }
        return out;
    }
    /** Placement before/after a change of node count; scheme 0 consistent hashing, 1 mod-N, 2 hash slots (16384, moved explicitly). */
    function ringStats(nodes, vnodes, change) {
        const N = clampInt(nodes, 1, 8), V = clampInt(vnodes, 1, 64), C = clampInt(change, -1, 1);
        return memoize(`ring:${N}:${V}:${C}`, () => {
            const N2 = Math.max(1, Math.min(9, N + C));
            const before = ringTokens(N, V), after = ringTokens(N2, V);
            const ownB = [], ownA = [], modB = [], modA = [];
            for (let i = 0; i < RING_KEYS; i++) {
                const p = keyPos(i), h = hashStr('key' + i);
                ownB.push(ownerOf(before, p)); ownA.push(ownerOf(after, p));
                modB.push(h % N); modA.push(h % N2);
            }
            const moved = ownB.map((o, i) => (o !== ownA[i] ? 1 : 0));
            const movedMod = modB.map((o, i) => (o !== modA[i] ? 1 : 0));
            const loadA = Array(N2).fill(0); for (const o of ownA) loadA[o]++;
            // Exact share of the ring each node owns (arc lengths), a smoother load measure than 48 keys.
            const share = Array(N2).fill(0);
            for (let i = 0; i < after.length; i++) { const prev = i === 0 ? after[after.length - 1].pos - 1 : after[i - 1].pos; share[after[i].node] += after[i].pos - prev; }
            const mean = 1 / N2;
            const sd = Math.sqrt(share.reduce((a, x) => a + (x - mean) ** 2, 0) / N2) / mean;
            return { before, after, ownB, ownA, moved, movedMod, movedN: moved.reduce((a, b) => a + b, 0), movedModN: movedMod.reduce((a, b) => a + b, 0), loadA, share, sd, N2 };
        });
    }

    // ── Capacity model ───────────────────────────────────────────────────────
    const CAP_OPTIONS = ['One server', 'Bigger server', 'Read replicas', 'Shards', 'Second region'];
    /** Fluid queue per tick. Returns per-tick rows with queue, latency, utilization for reads and writes. */
    function capacityTrace(option, rate, writePct, extra, crashAt) {
        const opt = clampInt(option, 0, CAP_OPTIONS.length - 1), lam = Math.max(0, Number(rate) || 0), wp = clampInt(writePct, 0, 100) / 100;
        const k = clampInt(extra, 1, 4), crash = clampInt(crashAt, 0, FRAMES);
        return memoize(`cap:${opt}:${lam}:${wp}:${k}:${crash}`, () => {
            const BASE = 100; // requests per tick one node serves
            const rows = [];
            let qr = 0, qw = 0;
            for (let t = 0; t <= FRAMES; t++) {
                const ramp = Math.min(1, t / 10); // load ramps up over 10 ticks
                const arrivals = lam * ramp, reads = arrivals * (1 - wp), writes = arrivals * wp;
                const nodes = opt === 0 || opt === 1 ? 1 : 1 + k;
                const down = crash && t >= crash ? 1 : 0;
                const per = opt === 1 ? BASE * 2 : BASE;
                let readCap, writeCap;
                if (opt === 2) { // replicas: every node serves reads, only the primary writes; writes are also replayed on replicas
                    const alive = Math.max(0, nodes - down);
                    writeCap = down ? 0 : per; // the crashed node is the primary in this model
                    readCap = alive * per;
                    // The primary spends capacity on writes first.
                    readCap = Math.max(0, readCap - Math.min(writes, writeCap));
                } else if (opt === 3) { // shards: each node owns 1/nodes of the data
                    const alive = Math.max(0, nodes - down);
                    writeCap = alive * per; readCap = alive * per;
                    const share = (writes + reads) || 1;
                    writeCap = writeCap * (writes / share); readCap = readCap * (reads / share);
                } else if (opt === 4) { // second region: same capacity as one server per region, halves far-client latency
                    const alive = Math.max(0, nodes - down);
                    writeCap = down ? per : per; readCap = alive * per - Math.min(writes, per);
                } else {
                    writeCap = down ? 0 : per * (wp || 1); readCap = down ? 0 : per * (1 - wp || 1);
                    const total = down ? 0 : per, share = (writes + reads) || 1;
                    writeCap = total * (writes / share); readCap = total * (reads / share);
                }
                qr = Math.max(0, qr + reads - readCap); qw = Math.max(0, qw + writes - writeCap);
                const failed = down && (opt === 0 || opt === 1);
                const rtt = opt === 4 ? 2 : 6; // far clients: 6 ticks across the ocean, 2 with a nearby region
                const latR = failed ? 0 : 1 + (readCap > 0 ? qr / readCap : 99) + rtt / 2;
                const latW = failed || (opt === 2 && down) ? 0 : 1 + (writeCap > 0 ? qw / writeCap : 99) + (opt === 4 ? 6 : rtt) / 2;
                rows.push({ t, arrivals, reads, writes, readCap, writeCap, qr, qw, latR: Math.min(60, latR), latW: Math.min(60, latW),
                    utilR: readCap ? Math.min(1.5, reads / readCap) : (reads ? 1.5 : 0), utilW: writeCap ? Math.min(1.5, writes / writeCap) : (writes ? 1.5 : 0),
                    // Shards: a crashed shard takes its slice of the keys with it; the rest keep working.
                    availR: failed ? 0 : opt === 3 && down ? (nodes - 1) / nodes : 1,
                    availW: failed || (opt === 2 && down) ? 0 : opt === 3 && down ? (nodes - 1) / nodes : 1, nodes, down });
            }
            return rows;
        });
    }

    // ── Expression API ───────────────────────────────────────────────────────
    function ddTrace(scenario, overrides) { return run(scenario, overrides); }
    function ddScenario(n) { return scenarioOf(n).title; }
    function ddScenarioId(n) { return scenarioOf(n).id; }
    function ddStory(n) { return scenarioOf(n).story; }
    function ddAck(n) { return ACK_MODES[clampInt(n, 0, ACK_MODES.length - 1)].label; }
    function ddRead(n) { return READ_MODES[clampInt(n, 0, READ_MODES.length - 1)].label; }
    function ddRepair(n) { return REPAIR_MODES[clampInt(n, 0, 2)]; }
    function ddPolicy(n) { return CAP_POLICIES[clampInt(n, 0, CAP_POLICIES.length - 1)].label; }
    function ddProfile(n) { return PROFILES[clampInt(n, 0, PROFILES.length - 1)].label; }
    function ddProfileNote(n) { return PROFILES[clampInt(n, 0, PROFILES.length - 1)].note; }
    function ddCell(grid, row, col) { const r = listOf(grid)[clampInt(row, 0, 99)]; return r ? (Number(listOf(r)[clampInt(col, 0, 999)]) || 0) : 0; }
    function ddText(grid, row, col) { const r = listOf(grid)[clampInt(row, 0, 99)]; return r ? String(listOf(r)[clampInt(col, 0, 999)] ?? '') : ''; }
    function ddAt(list, i) { return listOf(list)[clampInt(i, 0, 999)] ?? ''; }
    function ddCount(list) { return listOf(list).length; }
    /** A node's version text for key `col`, or its status for col = -1. */
    function ddLink(codes, i) { return Number(listOf(codes)[clampInt(i, 0, 99)]) || 0; }
    const LINK_COLORS = ['#8296a4', '#f1c96b', '#c5413f', '#3a4048'];
    // Node status: replica · primary (gold, so the one node that takes writes stands out) · down · cut off / stepped down · recovering · fallback.
    const NODE_COLORS = ['#80b9d6', '#e7be63', '#5b5f66', '#d98b4a', '#b9a1dd', '#6f8aa0'];
    function ddLinkColor(codes, i) { return LINK_COLORS[ddLink(codes, i)]; }
    function ddNodeColor(codes, i) { const l = listOf(codes); return clampInt(i, 0, 99) >= l.length ? '#2a3038' : NODE_COLORS[ddLink(codes, i)] || NODE_COLORS[0]; }
    /** Resting colour of a node's network link: only its state (cut, down); traffic lights it through activeExpr. */
    function ddLinkColor2(codes, i) { const l = listOf(codes); const c = ddLink(codes, i); return clampInt(i, 0, 99) >= l.length ? '#2a3038' : LINK_COLORS[c === 1 ? 0 : c]; }
    /** Code of the link between nodes a and b (see pairCodes), −1 when either is not in this scenario. */
    function pairCode(codes, nodes, a, b) {
        const n = clampInt(nodes, 0, MAX_NODES), i = clampInt(Math.min(a, b), 0, 9), j = clampInt(Math.max(a, b), 0, 9);
        if (j >= n || i === j) return -1;
        let k = 0;
        for (let x = 0; x < n; x++) for (let y = x + 1; y < n; y++) { if (x === i && y === j) return Number(listOf(codes)[k]) || 0; k++; }
        return -1;
    }
    function ddPair(codes, nodes, a, b) { return pairCode(codes, nodes, a, b) === 1 ? 1 : 0; }
    /** Pulse direction for the pipe drawn from node a to node b: 'forward' when traffic goes a → b. */
    function ddPairDir(dirs, nodes, a, b) {
        const d = pairCode(dirs, nodes, a, b);
        const fwd = a < b ? d : -d;
        return d === 2 ? 'both' : fwd === 1 ? 'forward' : fwd === -1 ? 'backward' : 'none';
    }
    function ddPairColor(codes, nodes, a, b) { const c = pairCode(codes, nodes, a, b); return c < 0 ? '#20262d' : LINK_COLORS[c]; }
    /** Slider readout: a negative value means the scenario's own setting, shown as "auto (…)". */
    function ddSetting(scenario, key, value) {
        const sc = scenarioOf(scenario), cfg = configOf(sc, {}), v = Number(value);
        const label = (k, x) => {
            switch (k) {
                case 'ack': return typeof x === 'string' ? (ACK_MODES.find(a => a.id === x) || ACK_MODES[0]).label : ACK_MODES[clampInt(x, 0, 3)].label;
                case 'read': return (READ_MODES.find(m => m.id === x) || { label: typeof x === 'number' ? READ_MODES[clampInt(x, 0, 4)].label : 'home replica' }).label;
                case 'readRepair': return typeof x === 'string' ? x : REPAIR_MODES[clampInt(x, 0, 2)];
                case 'resolve': return x === 'siblings' || x === 1 ? 'siblings (version vectors)' : 'last write wins';
                case 'lease': case 'hints': case 'sloppy': return x ? 'on' : 'off';
                case 'failover': return x ? `after ${x} ticks` : 'none';
                case 'ae': return x ? `every ${x} ticks` : 'off';
                case 'replDelay': return Array.isArray(x) ? `${Math.max(0, ...x)} ticks` : `${x} ticks`;
                case 'policy': return CAP_POLICIES[clampInt(x, 0, CAP_POLICIES.length - 1)].label;
                case 'profile': return PROFILES[clampInt(x, 0, PROFILES.length - 1)].label;
                default: return String(x);
            }
        };
        if (v >= 0) return label(key, v);
        const own = key === 'replDelay' ? (cfg.replDelay || [0]) : cfg[key];
        return 'auto · ' + label(key, own === undefined || own === null ? 0 : own);
    }
    function ddGuarantee(row, col) { return guaranteeCell(row, col).code; }
    function ddGuaranteeText(row, col) { return guaranteeCell(row, col).text; }
    function ddGuaranteeRow(row) { return scenarioOf(CONSISTENCY_ROWS[clampInt(row, 0, 3)]).title; }
    function ddQuorum(scenario, N, down, rr, row, col) { return quorumCell(ddScenarioId(scenario), N, down, rr, row, col).code; }
    function ddQuorumText(scenario, N, down, rr, row, col) { return quorumCell(ddScenarioId(scenario), N, down, rr, row, col).text; }
    function ddProfileCell(row, col) { return profileCell(row, col).code; }
    function ddProfileText(row, col) { return profileCell(row, col).text; }
    function ddProfileRow(row) { return PROFILES[clampInt(row, 0, PROFILES.length - 1)].short; }
    function ddCompareScenario(i) { return COMPARE_SCENARIOS[clampInt(i, 0, COMPARE_SCENARIOS.length - 1)]; }
    function ddCompareIndex(i) { return SCENARIO_INDEX.get(ddCompareScenario(i)); }
    /** Merkle tree cell: which = 0 (first node) / 1 (second); level 0 = root; i = position. Text and code (0 empty, 1 same, 2 differs). */
    function ddMerkleText(merkle, which, level, i) {
        const m = objOf(merkle);
        const tree = (which ? m.B : m.A); const lv = listOf(tree)[clampInt(level, 0, 9)];
        if (!lv) return '';
        const h = listOf(lv)[clampInt(i, 0, 99)];
        if (h === undefined) return '';
        const leaf = level === listOf(tree).length - 1;
        return (leaf ? ddAt(m.keys, i) + ' ' : '') + (Number(h) % 4096).toString(16).padStart(3, '0');
    }
    function ddMerkleCode(merkle, level, i) {
        const m = objOf(merkle);
        const lv = listOf(m.diff)[clampInt(level, 0, 9)];
        if (!lv) return 0;
        const d = listOf(lv)[clampInt(i, 0, 99)];
        return d === undefined ? 0 : (d ? 2 : 1);
    }
    function ddMerkleTitle(merkle, which) { const m = objOf(merkle); return m.a ? `${which ? m.b : m.a} · Merkle tree (pass at t${m.at})` : 'Merkle tree (no anti-entropy pass yet)'; }

    // Placement API
    function ddStrategy(n) { return STRATEGIES[clampInt(n, 0, STRATEGIES.length - 1)].label; }
    function ddShardLoad(strategy, shards, count, celebrity, i) { const st = shardStats(strategy, shards, count, celebrity); return st.writes[clampInt(i, 0, 99)] ?? 0; }
    function ddShardStored(strategy, shards, count, celebrity, i) { const st = shardStats(strategy, shards, count, celebrity); return st.stored[clampInt(i, 0, 99)] ?? 0; }
    function ddShardMax(strategy, shards, count, celebrity) { return shardStats(strategy, shards, count, celebrity).max || 1; }
    function ddShardImbalance(strategy, shards, count, celebrity) { return Math.round(shardStats(strategy, shards, count, celebrity).imbalance * 100) / 100; }
    function ddShardsTouched(strategy, shards, count, celebrity, q) { return shardStats(strategy, shards, count, celebrity).queries[clampInt(q, 0, 3)]; }
    function ddQuery(q) { return QUERIES[clampInt(q, 0, QUERIES.length - 1)]; }
    // Ring API: xy positions on a circle of radius `radius`; points not drawn return 99 (outside the chart domain).
    function ringXY(pos, radius, axis) { const a = Math.PI / 2 - 2 * Math.PI * pos; return axis ? radius * Math.sin(a) : radius * Math.cos(a); }
    function ddTokenX(nodes, vnodes, change, phase, i, node, radius) { return tokenXY(nodes, vnodes, change, phase, i, node, radius, 0); }
    function ddTokenY(nodes, vnodes, change, phase, i, node, radius) { return tokenXY(nodes, vnodes, change, phase, i, node, radius, 1); }
    function tokenXY(nodes, vnodes, change, phase, i, node, radius, axis) {
        const st = ringStats(nodes, vnodes, change);
        const tokens = clampInt(phase, 0, 1) ? st.after : st.before;
        const mine = tokens.filter(t => t.node === clampInt(node, 0, 9));
        const t = mine[clampInt(i, 0, 999)];
        return t ? ringXY(t.pos, radius, axis) : 99;
    }
    function ddKeyX(i, radius) { return ringXY(keyPos(clampInt(i, 0, RING_KEYS - 1)), radius, 0); }
    function ddKeyY(i, radius) { return ringXY(keyPos(clampInt(i, 0, RING_KEYS - 1)), radius, 1); }
    /** Key i drawn only if its owner (after the change when phase = 1) is `node`; moved = 1 restricts to moved keys. */
    function ddKeyOn(nodes, vnodes, change, phase, i, node, moved, axis, radius) {
        const st = ringStats(nodes, vnodes, change);
        const k = clampInt(i, 0, RING_KEYS - 1);
        const own = clampInt(phase, 0, 1) ? st.ownA[k] : st.ownB[k];
        if (own !== clampInt(node, 0, 9)) return 99;
        if (moved && !st.moved[k]) return 99;
        return ringXY(keyPos(k), radius, axis);
    }
    function ddRingMoved(nodes, vnodes, change) { return ringStats(nodes, vnodes, change).movedN; }
    function ddRingMovedMod(nodes, vnodes, change) { return ringStats(nodes, vnodes, change).movedModN; }
    function ddRingKeys() { return RING_KEYS; }
    function ddRingShare(nodes, vnodes, change, i) { const st = ringStats(nodes, vnodes, change); return Math.round((st.share[clampInt(i, 0, 99)] ?? 0) * 1000) / 10; }
    function ddRingLoad(nodes, vnodes, change, i) { const st = ringStats(nodes, vnodes, change); return st.loadA[clampInt(i, 0, 99)] ?? 0; }
    function ddRingSd(nodes, vnodes, change) { return Math.round(ringStats(nodes, vnodes, change).sd * 100); }
    function ddRingNodes(nodes, change) { return Math.max(1, Math.min(9, clampInt(nodes, 1, 8) + clampInt(change, -1, 1))); }
    /** Preference list (RF distinct nodes clockwise) for ring key i after the change, as text. */
    function ddPreference(nodes, vnodes, change, i, rf) {
        const st = ringStats(nodes, vnodes, change);
        return preference(st.after, keyPos(clampInt(i, 0, RING_KEYS - 1)), clampInt(rf, 1, st.N2)).map(n => 'N' + (n + 1)).join(' → ');
    }
    function ddInPreference(nodes, vnodes, change, i, rf, node) {
        const st = ringStats(nodes, vnodes, change);
        return preference(st.after, keyPos(clampInt(i, 0, RING_KEYS - 1)), clampInt(rf, 1, st.N2)).includes(clampInt(node, 0, 9)) ? 1 : 0;
    }
    // Capacity API
    function ddCapacity(option, rate, writePct, extra, crashAt) { return capacityTrace(option, rate, writePct, extra, crashAt); }
    function ddCapOption(n) { return CAP_OPTIONS[clampInt(n, 0, CAP_OPTIONS.length - 1)]; }
    /** One field of the capacity model at tick t. */
    function ddCapAt(option, rate, writePct, extra, crashAt, t, field) {
        const rows = capacityTrace(option, rate, writePct, extra, crashAt);
        const r = rows[clampInt(t, 0, rows.length - 1)];
        const v = r ? r[String(field)] : 0;
        return typeof v === 'number' ? Math.round(v * 100) / 100 : 0;
    }
    function ddCapCaption(option, rate, writePct, extra, crashAt, frame, guide) {
        const rows = capacityTrace(option, rate, writePct, extra, crashAt);
        const r = rows[clampInt(frame, 0, rows.length - 1)];
        const pct = x => Math.round(100 * x) + '%';
        const opt = CAP_OPTIONS[clampInt(option, 0, CAP_OPTIONS.length - 1)];
        const state = r.availR === 0 && r.availW === 0 ? '❌ **Down** — every request fails.'
            : `Reads: ${pct(r.utilR)} busy, ${r.availR < 1 ? pct(r.availR) + ' of keys available, ' : ''}latency ${r.latR.toFixed(1)} ticks. Writes: ${r.availW === 0 ? '❌ unavailable (no primary)' : `${pct(r.utilW)} busy, ${r.availW < 1 ? pct(r.availW) + ' of keys available, ' : ''}latency ${r.latW.toFixed(1)} ticks`}.`;
        const body = `**Tick ${r.t}** — ${opt}, ${r.nodes} node${r.nodes === 1 ? '' : 's'}${r.down ? ' (one crashed)' : ''}: ${Math.round(r.arrivals)} requests/tick (${Math.round(r.writes)} writes). ${state}`;
        return [guide ? String(guide) : '', body].filter(Boolean).join('\n\n');
    }
    /** Capacity scene: one server cell. Text names the node's role; code 0 absent · 1 ok · 2 busy · 3 overloaded · 4 down. */
    function capNode(option, rate, writePct, extra, crashAt, frame, i) {
        const rows = capacityTrace(option, rate, writePct, extra, crashAt);
        const r = rows[clampInt(frame, 0, rows.length - 1)];
        const opt = clampInt(option, 0, CAP_OPTIONS.length - 1), k = clampInt(i, 0, 9);
        if (k >= r.nodes) return { text: '', code: 0 };
        if (r.down && k === 0) return { text: 'down', code: 4 };
        const role = opt === 0 ? 'server' : opt === 1 ? 'big server' : opt === 2 ? (k === 0 ? 'primary' : 'replica') : opt === 3 ? `shard ${k + 1}` : (k === 0 ? 'home region' : 'far region');
        const util = opt === 2 && k === 0 ? r.utilW : opt === 0 || opt === 1 ? Math.max(r.utilR, r.utilW) : r.utilR;
        return { text: `${role}\n${Math.round(util * 100)}%`, code: util < 0.7 ? 1 : util <= 1 ? 2 : 3 };
    }
    function ddCapNodeText(option, rate, writePct, extra, crashAt, frame, i) { return capNode(option, rate, writePct, extra, crashAt, frame, i).text; }
    function ddCapNodeCode(option, rate, writePct, extra, crashAt, frame, i) { return capNode(option, rate, writePct, extra, crashAt, frame, i).code; }
    /** Partitioning scene: the shard (0-based) of record i, or -1 past the shard count. */
    function ddRecShard(strategy, shards, count, i) {
        const strat = STRATEGIES[clampInt(strategy, 0, STRATEGIES.length - 1)].id, S = clampInt(shards, 1, 8), n = clampInt(count, 8, 400);
        const recs = memoize('recs:' + n, () => records(n));
        const rec = recs[clampInt(i, 0, n - 1)];
        return rec ? shardOf(strat, rec, S, n) : -1;
    }
    function ddRecText(count, i) { const n = clampInt(count, 8, 400); const rec = memoize('recs:' + n, () => records(n))[clampInt(i, 0, n - 1)]; return rec ? `${rec.id}\n${rec.country}` : ''; }
    /** Ring: a key that changed owner, drawn only after the change (phase 1). */
    function ddKeyMoved(nodes, vnodes, change, phase, i, axis, radius) {
        const st = ringStats(nodes, vnodes, change), k = clampInt(i, 0, RING_KEYS - 1);
        return clampInt(phase, 0, 1) && st.moved[k] ? ringXY(keyPos(k), radius, axis) : 99;
    }
    const VER_COLORS = ['#1c2631', '#3f9a6c', '#d98b4a', '#d9a441', '#6a5a80', '#8a7bc0', '#262a30'];
    function ddVerColor(codes, node, key) { return VER_COLORS[clampInt(ddCell(codes, node, key), 0, VER_COLORS.length - 1)]; }
    /** Effective numeric setting: the slider value, or the scenario's own when the slider is negative. */
    function ddEff(scenario, key, value) {
        if (Number(value) >= 0) return Number(value);
        const cfg = configOf(scenarioOf(scenario), {});
        const v = cfg[String(key)];
        if (key === 'readRepair') return Math.max(0, REPAIR_MODES.indexOf(v));
        if (key === 'resolve') return v === 'siblings' ? 1 : 0;
        if (key === 'ack') return typeof v === 'string' ? Math.max(0, ACK_MODES.findIndex(a => a.id === v)) : clampInt(v, 0, 3);
        return Number(v) || 0;
    }
    /** Code tab: `line` while an operation named `name` (put / get / delete) starts or ends under `topology`, else 0. */
    function ddCodeLine(ops, topology, want, name, line) { return String(topology) === String(want) && ddOp(ops, name) ? Number(line) : 0; }
    function ddShardCaption(strategy, shards, count, celebrity, guide) {
        const st = shardStats(strategy, shards, count, celebrity);
        const S = clampInt(shards, 1, 8);
        const body = `**${STRATEGIES[clampInt(strategy, 0, STRATEGIES.length - 1)].label}**, ${S} shard${S === 1 ? '' : 's'}: the busiest shard takes ${st.imbalance.toFixed(2)}× the average write load. Queries touch ${QUERIES.map((q, i) => `${q}: ${st.queries[i]}/${S}`).join(' · ')}.`;
        return [guide ? String(guide) : '', body].filter(Boolean).join('\n\n');
    }
    function ddRingCaption(nodes, vnodes, change, phase, guide) {
        const st = ringStats(nodes, vnodes, change);
        const N = clampInt(nodes, 1, 8), C = clampInt(change, -1, 1);
        const what = C > 0 ? `adding N${st.N2}` : C < 0 ? `removing N${N}` : 'no change';
        const body = C ? `**${what}** with ${clampInt(vnodes, 1, 64)} virtual node${vnodes > 1 ? 's' : ''} each: consistent hashing moves **${st.movedN} of ${RING_KEYS}** keys (${Math.round(100 * st.movedN / RING_KEYS)}%); hash mod N would move **${st.movedModN}** (${Math.round(100 * st.movedModN / RING_KEYS)}%). Load spread after: ±${Math.round(st.sd * 100)}% of the fair share.${clampInt(phase, 0, 1) ? '' : ' (Showing the ring **before** the change — set Phase to 1.)'}`
            : `${N} nodes × ${clampInt(vnodes, 1, 64)} virtual nodes: each node's share of the ring varies by ±${Math.round(st.sd * 100)}% around the fair ${Math.round(100 / N)}%.`;
        return [guide ? String(guide) : '', body].filter(Boolean).join('\n\n');
    }

    /** Captions. */
    function ddCaption(frame, rows, guide) {
        rows = listOf(rows);
        const f = clampInt(frame, 0, rows.length - 1), row = rows[f];
        if (!row) return guide ? String(guide) : '';
        const lin = row.linOk ? '✅ linearizable so far' : '❌ ' + row.linText;
        const lastLabel = row.labels.length ? row.labels[row.labels.length - 1] : '';
        const body = f === 0 ? '' : `**Tick ${f}** — ${row.text}\n\n${lin}${lastLabel ? ' · last read: ' + lastLabel : ''}`;
        return [guide ? String(guide) : '', body].filter(Boolean).join('\n\n');
    }
    function ddContext(frame, rows, extra) {
        rows = listOf(rows);
        const f = clampInt(frame, 0, rows.length - 1), row = rows[f];
        if (!row) return '';
        const history = rows.slice(1, f + 1).filter(r => r.text && r.text !== 'Nothing happens this tick.').map(r => `t${r.tick}: ${r.text}`).join('\n');
        return [`Scenario: ${row.scenario} (${row.topology}). Tick ${f}.${extra ? ' ' + extra : ''}`,
            `Nodes: ${row.nodeNames.map((nm, i) => `${nm} ${row.nodeText[i]} [${row.keys.map((k, j) => k + '=' + (row.verGrid[i][j] || '—')).join(', ')}]`).join(' | ')}`,
            `Clients: ${row.clientText.join(' | ')}`,
            `In flight: ${row.msgText.join('; ') || 'nothing'}`,
            `Reads so far: ${row.labels.join('; ') || 'none'}`,
            `History check: ${row.linText}. Replicas ${row.converged ? 'agree' : 'disagree'}.`,
            `Metrics: ok ${row.m_ok}, rejected ${row.m_rejected}, timed out ${row.m_timedOut}, availability ${row.m_availability}%, p50 ${row.m_p50} ticks, p99 ${row.m_p99}, stale reads ${row.m_stale}, lost acknowledged writes ${row.m_lost}, sibling reads ${row.m_siblings}, repair messages ${row.m_repair}, failovers ${row.m_failovers}, resurrected ${row.m_resurrected}.`,
            `History:\n${history}`].join('\n');
    }
    function ddOp(ops, name) { return listOf(ops).some(o => String(o).includes(':' + name)) ? 1 : 0; }

    const api = { ddTrace, ddScenario, ddScenarioId, ddStory, ddAck, ddRead, ddRepair, ddPolicy, ddProfile, ddProfileNote,
        ddCell, ddText, ddAt, ddCount, ddLink, ddLinkColor, ddNodeColor,
        ddGuarantee, ddGuaranteeText, ddGuaranteeRow, ddQuorum, ddQuorumText, ddProfileCell, ddProfileText, ddProfileRow, ddCompareScenario, ddCompareIndex,
        ddMerkleText, ddMerkleCode, ddMerkleTitle,
        ddStrategy, ddShardLoad, ddShardStored, ddShardMax, ddShardImbalance, ddShardsTouched, ddQuery,
        ddTokenX, ddTokenY, ddKeyX, ddKeyY, ddKeyOn, ddRingMoved, ddRingMovedMod, ddRingKeys, ddRingShare, ddRingLoad, ddRingSd, ddRingNodes, ddPreference, ddInPreference,
        ddCapacity, ddCapOption, ddCapAt, ddCapCaption, ddShardCaption, ddRingCaption, ddCaption, ddContext, ddOp, ddLinkColor2, ddSetting,
        ddCapNodeText, ddCapNodeCode, ddRecShard, ddRecText, ddKeyMoved, ddVerColor, ddEff, ddCodeLine, ddPair, ddPairColor, ddPairDir };
    if (typeof window !== 'undefined' && window.AlgeBenchDomains) window.AlgeBenchDomains.register('distdb', api);
    if (typeof globalThis !== 'undefined') globalThis.__distdbLab = { SCENARIOS, PROFILES, CAP_POLICIES, ACK_MODES, READ_MODES, REPAIR_MODES, STRATEGIES, QUERIES, CAP_OPTIONS, COMPARE_SCENARIOS, CONSISTENCY_ROWS,
        run, configOf, shardStats, ringStats, capacityTrace, analyse, LINK_COLORS, NODE_COLORS, limits: { MAX_NODES, MAX_CLIENTS, MAX_KEYS, FRAMES, MSG_SLOTS, RING_KEYS } };
})();
