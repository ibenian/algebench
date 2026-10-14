// Scene definitions for the distributed databases lab. Cluster scenes share one board and one
// trace table (`dd`); sliders are the simulation inputs (−1 = the scenario's own setting), and steps set them.
import { LAB, SCENARIO, scenarioRange, slider } from './util.mjs';
import { clusterBoard, geometry, matrix, merkleTrees, metricsStrip, capacityBoard, shardBoard, ringBoard } from './board.mjs';

const { FRAMES } = LAB.limits;

// ── Sliders ──────────────────────────────────────────────────────────────────
const auto = (id, label, max, d = -1) => slider(id, label, -1, max, d, { valueExpr: `ddSetting(scenario, '${id}', ${id})` });
const SL = {
    frame: () => slider('frame', 'Tick', 0, FRAMES, 0),
    scenario: (scene, d) => { const [lo, hi] = scenarioRange(scene); return slider('scenario', 'Scenario', lo, hi, d, { valueExpr: 'ddScenario(scenario)' }); },
    ack: d => auto('ack', 'Replication acks', 3, d),
    replDelay: d => auto('replDelay', 'Replica delay (ticks)', 10, d),
    failover: d => auto('failover', 'Failover timeout', 8, d),
    lease: d => auto('lease', 'Primary lease (fencing)', 1, d),
    read: d => auto('read', 'Read guarantee', 4, d),
    N: d => auto('N', 'N · replicas of the key', 5, d),
    R: d => auto('R', 'R · read quorum', 5, d),
    W: d => auto('W', 'W · write quorum', 5, d),
    down: d => slider('down', 'Replicas down', 0, 4, d ?? 0),
    readRepair: d => auto('readRepair', 'Read repair', 2, d),
    sloppy: d => auto('sloppy', 'Sloppy quorum', 1, d),
    policy: d => slider('policy', 'Policy', 0, LAB.CAP_POLICIES.length - 1, d ?? 0, { valueExpr: "ddSetting(scenario, 'policy', policy)" }),
    wan: d => auto('wan', 'WAN latency (ticks)', 8, d),
    hints: d => auto('hints', 'Hinted handoff', 1, d),
    ae: d => auto('ae', 'Anti-entropy period', 12, d),
    gcGrace: d => auto('gcGrace', 'Tombstone gc-grace', 40, d),
    resolve: d => auto('resolve', 'Conflict resolution', 1, d),
    profile: d => slider('profile', 'System profile', 0, LAB.PROFILES.length - 1, d ?? 0, { valueExpr: 'ddProfile(profile)' }),
    cmp: d => slider('cmp', 'Workload', 0, LAB.COMPARE_SCENARIOS.length - 1, d ?? 0, { valueExpr: 'ddScenario(ddCompareIndex(cmp))' }),
};
const OVERRIDE_KEYS = ['ack', 'replDelay', 'failover', 'lease', 'read', 'N', 'R', 'W', 'down', 'readRepair', 'sloppy', 'policy', 'wan', 'hints', 'ae', 'gcGrace', 'resolve'];

// ── Shared cluster scene builder ─────────────────────────────────────────────
/** knobs: slider ids the scene exposes; each step's `set` gives values (missing → −1, the scenario's own). */
function clusterScene({ id, title, description, markdown, prompt, scene, knobs, steps, nodes, keys, clients, metrics, extras = [], extraViews = [], extraRange = 0, trace }) {
    const ids = knobs.slice();
    const overrides = '{' + ids.filter(k => OVERRIDE_KEYS.includes(k)).map(k => `${k}: ${k}`).join(', ') + '}';
    const rowsExpr = trace ?? `ddTrace(scenario, ${overrides})`;
    const g = geometry(nodes, keys);
    const top = 14.8, bottom = g.bottom - 5.2;
    const cy = (top + bottom) / 2, h = top - bottom;
    const board = { name: 'Board', position: [0, cy, Math.max(30, h * 1.35)], target: [0, cy, 0] };
    const allViews = extraRange ? [{ name: 'Everything', position: [extraRange / 2, cy, Math.max(h * 1.55, (g.width + extraRange + 10) * 0.8)], target: [extraRange / 2, cy, 0] }, board, ...extraViews] : [board, ...extraViews];
    const sliderSet = step => [SL.frame(), ...(scene ? [SL.scenario(scene, SCENARIO[step.scenario])] : []),
        ...ids.map(k => SL[k](step.set && step.set[k] !== undefined ? step.set[k] : undefined))];
    return {
        id, title, description, markdown, prompt,
        promptExpr: `ddContext(frame, dataTable('dd'), concat('Settings: ', ${ids.map(k => `'${k}=', ${k}`).join(", ' ', ")}))`,
        range: [[g.left - 8, g.right + 4 + extraRange], [bottom - 2, top + 2], [-6, 6]],
        camera: { position: allViews[0].position, target: allViews[0].target },
        views: allViews,
        stepPlayback: { slider: 'frame', intervalMs: 900, speedControl: true },
        data: { guides: steps.map(step => ({ id: step.id, text: step.guide })) },
        tableBindings: [{ table: 'dd', rowsExpr }],
        elements: [],
        steps: steps.map((step, i) => ({
            id: step.id, title: step.title, description: step.guide,
            descriptionExpr: `ddCaption(frame, dataTable('dd'), dataTable('guides', ${i}, 'text'))`,
            prompt: step.prompt ?? step.guide,
            sliders: sliderSet(step),
            ...(i === 0 ? { add: [...clusterBoard({ nodes, keys, clients, metrics }), ...extras] } : {}),
        })),
    };
}

// ── Scene 2 · Replication ────────────────────────────────────────────────────
const MD_REPLICATION = `### Replication: copies that follow a log

A **replica** is a copy of the data that applies the same changes in the same order. In **single-leader** (primary–replica) replication, one node — the **primary** — accepts every write, appends it to a log, and ships the log to the replicas, which replay it.

The one decision that shapes everything: **when does the primary tell the client "done"?**

| Acknowledge after… | Write latency | If the primary dies right after the ack |
|---|---|---|
| **async** — its own log only | lowest | the write may exist nowhere else → **lost** after failover |
| **semi-sync** — 1 replica has it | + one round trip | another copy exists → survives one failure |
| **majority** | + round trip to the median replica | survives any minority failure |
| **sync** — all replicas | the slowest replica's round trip | nothing lost, but **one slow or dead replica stalls every write** |

**Replication lag** is how far a replica's log trails the primary's; readers of that replica see the past.

**Failover**: a monitor notices the primary is unreachable for a timeout and **promotes** the most up-to-date replica. Writes the old primary acknowledged but never shipped are gone. If the old primary is merely cut off rather than dead, it may keep accepting writes: **split brain**. A **lease** (fencing) makes a primary that cannot reach a majority stop serving before anyone else is promoted. *How to elect safely is lesson 3.*

**The board.** *Clients* (top) shows every operation over time. *Network* lists messages in flight. Each node block holds its copy of every key: **green** = newest, **orange** = behind. Links light while messages travel and turn **red** when a partition cuts them.

**Multi-primary** (last step) lets two nodes accept writes for the same key and replicate both ways — now two writes can conflict and something must decide which survives.`;

const replicationSteps = [
    { id: 'repl-lag', title: 'Replication lag', scenario: 'lag',
        guide: 'C1 writes x through primary N1; C3 reads x from replica N3, which applies the log 3 ticks late. **Predict what C3\'s first read returns.**',
        prompt: 'Ask the learner to predict what C3 reads at tick 4, after C1 wrote x=1 and x=2. Then walk through replication lag on the board: the log entries in flight, N3 behind (orange), and the reads labelled stale. Point out that the replicas converge once writes stop.' },
    { id: 'repl-lag-zero', title: 'No lag, no stale reads', scenario: 'lag', set: { replDelay: 0 },
        guide: 'Same workload with **Replica delay = 0**. Move it back up and watch the stale reads return.',
        prompt: 'Contrast the run with no replica delay. Emphasise that lag is a normal property of asynchronous replication, not a fault: it depends on load, network and replay speed.' },
    { id: 'repl-failover-predict', title: 'Predict the failover', scenario: 'primary-crash',
        guide: 'Async replication. N1 crashes at tick 7, a few writes after its last shipment. **How many acknowledged writes survive?** Then play.',
        prompt: 'Have the learner predict how many of C1\'s four acknowledged writes survive the crash of primary N1 under async replication. Then show the failover: the monitor promotes N2, the most up-to-date replica, and the old primary discards the entries the new one never had. Stress: these writes were acknowledged.' },
    { id: 'repl-semi', title: 'Semi-sync: one copy elsewhere', scenario: 'primary-crash', set: { ack: 1 },
        guide: 'Same crash, **Replication acks = semi-sync**: each write waits for one replica. Nothing acknowledged is lost — at the price of a round trip per write (see p99).',
        prompt: 'Compare async and semi-sync on the same crash: lost writes versus latency. Mention PostgreSQL synchronous_standby_names = ANY 1 and MySQL lossless semi-sync (AFTER_SYNC). Ask: what if the one replica that acknowledged also dies?' },
    { id: 'repl-sync-stall', title: 'Sync: one dead replica stalls everything', scenario: 'replica-crash', set: { ack: 3 },
        guide: '**Sync to all replicas.** N3 crashes at tick 5: every following write waits for an ack that never comes and **times out**, though N1 and N2 are fine. Switch to semi-sync.',
        prompt: 'Explain why requiring every replica to acknowledge turns any single replica failure into a write outage, and why production systems use a quorum (ANY 1, majority) instead. Note the timed-out writes are still on the primary — a timeout does not mean the write did not happen.' },
    { id: 'repl-split-brain', title: 'Split brain', scenario: 'split-brain', set: { lease: 0 },
        guide: 'A partition isolates primary N1 with client C1. The majority side promotes N2. Without a lease, **both** accept writes. When the partition heals, N1\'s writes are thrown away.',
        prompt: 'Walk through the split brain: two primaries in different epochs, both acknowledging writes, and the heal where the old primary steps down and discards its divergent log. Then switch Primary lease on and replay: N1 stops serving before N2 is promoted, so C1 gets rejections instead of silently lost writes.' },
    { id: 'repl-multi', title: 'Multi-primary: conflicting writes', scenario: 'multi-primary',
        guide: 'N1 and N2 both accept writes and replicate to each other across a 3-tick WAN. C1 and C2 update x a tick apart; **last write wins** by timestamp — and N1\'s clock is ahead.',
        prompt: 'Explain multi-primary replication: low local write latency in both regions, but concurrent writes to the same key conflict. Show that last-write-wins by timestamp discarded the later write because of clock skew. Ask what else could resolve it (application merge, CRDTs, routing each key to one home region).' },
];

// ── Scene 3 · Consistency models ─────────────────────────────────────────────
const MD_CONSISTENCY = `### Consistency models: what may a read return?

With replicas that lag, two clients can see different values at the same moment. A **consistency model** is a promise about **which values a read is allowed to return** — stated purely in terms of what clients observe, not how it is implemented.

| Model | Promise | A violation looks like |
|---|---|---|
| **Eventual** | if writes stop, replicas converge | (anything goes meanwhile) |
| **Read-your-writes** | you see your own writes | "I saved my name and the page shows the old one" |
| **Monotonic reads** | you never go back in time | a refresh shows an older score than the last one |
| **Causal** | if you saw an effect, you see its cause | a reply visible before the post it answers |
| **Linearizable** | every read sees the latest acknowledged write, as if there were one copy | C2 sees the new price, C3 *afterwards* sees the old one |

The first three are **session guarantees**: about one client's view. **Causal** covers chains between clients. **Linearizable** is about real time across everyone, and is the only one that needs coordination on every read.

**Guarantees vs. mechanisms.** Move **Read guarantee** to switch the *mechanism*: any replica · a session token (the log position of my last write) · a version token per key · a causal token (the highest position I have seen) · always read the primary. A replica holding a token waits until it has caught up — the latency each guarantee costs shows in *p99*.

**The checker.** Nothing on the board trusts the mechanism. A history checker labels every read with the **weakest guarantee it breaks**, and searches for a single order of all operations that respects real time (linearizability). The **guarantee matrix** (right) runs every scenario under every mechanism.

> *Isolation* (lesson 1) orders **transactions**; *consistency models* order **operations on copies**. A system can have one without the other; *strict serializability* is both.`;

const consistencySteps = [
    { id: 'cons-ryw', title: 'Read-your-writes', scenario: 'ryw', set: { read: 0 },
        guide: 'C1 saves profile v=2, then reloads — each reload lands on a different replica. **Predict which reload shows v=1.**',
        prompt: 'Ask the learner to predict which of C1\'s reads return the old profile. Point to the read labelled "breaks read-your-writes" and the replica it came from. Then switch Read guarantee to read-your-writes and show the replica waiting for the session token (higher latency, no violation).' },
    { id: 'cons-mr', title: 'Monotonic reads', scenario: 'monotonic', set: { read: 0 },
        guide: 'C2 refreshes repeatedly; one refresh hits the lagging N3 and the score **goes back in time**. Try *read-your-writes*: it does not help — C2 wrote nothing.',
        prompt: 'Explain monotonic reads with the history: C2 saw s=1 and then s=0. Show that a read-your-writes token does not fix it (C2 has no writes), but a version token per key or sticky routing does. Distinguish the two session guarantees precisely.' },
    { id: 'cons-causal', title: 'Causal consistency', scenario: 'causal', set: { read: 2 },
        guide: 'C3 reads C2\'s reply, then opens the post it answers — from a replica that has neither yet. Even with **monotonic reads** (per key) the reply is visible and the post is not.',
        prompt: 'Explain why the reply and the post are different keys, so monotonic reads per key cannot help. Switch to the causal token: C3 carries the log position of everything it has seen, so N3 waits until it has the post. Mention MongoDB causally consistent sessions (afterClusterTime).' },
    { id: 'cons-linear', title: 'Linearizability', scenario: 'linearizable', set: { read: 3 },
        guide: 'C1\'s price change is acknowledged. Then C2 (near N2) sees the new price and C3 (near N3) **afterwards** sees the old one — with every session guarantee satisfied.',
        prompt: 'Explain why this history satisfies causal consistency yet is not linearizable: C2 and C3 never interacted, so no causal chain forces C3 to see the write; but in real time the write finished first. Switch to "read the primary" and show the cost: every read crosses to N1.' },
    { id: 'cons-matrix', title: 'Read the guarantee matrix', scenario: 'monotonic', set: { read: 4 },
        guide: 'Each cell ran one scenario under one mechanism. ✗ names the weakest guarantee that broke; ✓ shows the p99 latency paid. Which is the cheapest mechanism for each product feature?',
        prompt: 'Drill: for a profile page, a news feed, a comment thread and a stock price, have the learner pick the weakest guarantee that is still correct, justify it from the matrix, and name the latency cost.' },
];

// ── Scene 4 · Quorums ────────────────────────────────────────────────────────
const MD_QUORUMS = `### Quorums: tune consistency per request

**Leaderless** replication (Dynamo, Cassandra, Riak): any node can **coordinate** a request. Each key has **N** replicas. A write succeeds once **W** replicas acknowledge; a read asks **R** replicas and returns the newest version among their replies.

If **R + W > N**, every read quorum overlaps every write quorum in at least one replica — so a read *should* meet the latest write. Fewer nodes to wait for means lower latency and higher availability: R = W = 1 is fast and survives N − 1 failures, but reads can be stale.

**Try it:** set N, R, W and kill replicas. A request that cannot reach enough replicas is **rejected** immediately; one whose replies are too slow **times out**. The **quorum matrix** (right) runs the selected scenario for every R × W at this N.

**Why R + W > N is not enough for linearizability** — four runnable counterexamples:

1. **A read during a slow write.** The write has reached 1 of 3 replicas. Reader A's quorum includes it (new value); reader B, *after A finished*, picks two replicas without it (old value). Fixed by **blocking read repair**: A writes the newest value back before answering.
2. **A failed write stays.** The client is told the write failed (too few acks before the timeout), but one replica stored it. Later readers disagree about whether it happened — nothing rolls it back.
3. **Sloppy quorum.** When the real replicas are unreachable, fallback nodes accept the write (holding a *hint*). The write and read quorums no longer overlap.
4. **Last write wins with clock skew.** Conflicts are settled by timestamp; a node with a fast clock makes an *earlier* write win, silently discarding a later acknowledged one.

> Cassandra: consistency level per statement (ONE / QUORUM / ALL / LOCAL_QUORUM); linearizable compare-and-set needs lightweight transactions (Paxos, lesson 3). DynamoDB does not expose N, R, W at all — only eventually or strongly consistent reads.`;

const quorumSteps = [
    { id: 'q-overlap', title: 'Overlapping quorums', scenario: 'quorum', set: { N: 3, R: 2, W: 2 },
        guide: 'N = 3, W = 2, R = 2. C1 writes via N1; C2 reads via N3 — its two replicas always include one that took the write.',
        prompt: 'Explain the overlap argument for R + W > N using the board: which two replicas acknowledged the write, which two answered the read, and the replica they share.' },
    { id: 'q-fast-stale', title: 'Fast but stale', scenario: 'quorum', set: { N: 3, R: 1, W: 1 },
        guide: '**R = W = 1**: one ack, one reply. Latency drops — and C2 reads from N3 before the write reaches it. **Predict** which reads are stale, then play.',
        prompt: 'Ask the learner to predict which of C2\'s reads are stale with R = W = 1. Then relate the result to R + W ≤ N and to Cassandra consistency level ONE.' },
    { id: 'q-failures', title: 'Failures and availability', scenario: 'quorum', set: { N: 3, R: 2, W: 2 }, down: 1,
        guide: 'One replica down: W = 2 still succeeds. Raise **Replicas down** to 2 — now every request is rejected. Try W = 1 with R = 3, and R = 1 with W = 3.',
        prompt: 'Explain the availability side of the trade-off: a request needs W (or R) live replicas. Have the learner find settings that keep writes available with two replicas down, and say what they give up.' },
    { id: 'q-matrix', title: 'The quorum matrix', scenario: 'quorum', set: { N: 3 },
        guide: 'Every R × W cell ran this scenario. Change **N** and **Replicas down** and watch the safe (R + W > N) corner, the stale corner and the unavailable edge move.',
        prompt: 'Walk through the computed matrix: cells with R + W ≤ N read stale, cells needing more live replicas than exist fail, and the latency cost grows with R and W. Ask the learner to pick R and W for a read-heavy, a write-heavy and a must-not-lose workload.' },
    { id: 'q-concurrent', title: 'Counterexample 1 · read during a write', scenario: 'concurrent-read', set: { readRepair: 0 },
        guide: 'R + W > N, yet reader A sees x=1 and reader B, **after A finished**, sees x=0. Switch **Read repair** to *blocking*.',
        prompt: 'Explain why this history is not linearizable even though every quorum overlaps: the write is still in flight, A\'s quorum includes the one replica that has it and B\'s does not. Blocking read repair makes A copy the newest value to a second replica before answering, so B\'s quorum must meet it.' },
    { id: 'q-failed-sloppy', title: 'Counterexamples 2 and 3', scenario: 'failed-write',
        guide: 'C1 is told its write **failed**, yet C2 reads it — and then C3 does not. Switch Scenario to **Sloppy quorum**: fallbacks N4, N5 accept the write and C2 cannot see it.',
        prompt: 'Explain both: a failed write is not rolled back (the client must treat a timeout as unknown, not as "did not happen"), and a sloppy quorum trades the overlap guarantee for availability during a partition, repaired later by hinted handoff.' },
    { id: 'q-lww', title: 'Counterexample 4 · clock skew', scenario: 'lww-skew',
        guide: 'N1\'s clock runs 6 ticks fast. C2\'s write of x=2 comes **after** C1\'s x=1 was acknowledged, but carries an older timestamp — so x=1 wins everywhere.',
        prompt: 'Explain last-write-wins: replicas keep the version with the highest timestamp, which needs synchronized clocks. A skewed clock silently discards a later acknowledged write. Mention that Cassandra uses client or coordinator timestamps; the alternative is to keep siblings (next scenes) or use consensus (lesson 3).' },
];

const QUORUM_MATRIX = matrix({
    id: 'quorum-matrix', origin: [22, -6.5, 0], rows: 5, cols: 5, cellSize: 2.6,
    valueExpr: "ddQuorum(scenario, ddEff(scenario, 'N', N), down, ddEff(scenario, 'readRepair', readRepair), row, col)",
    textExpr: "ddQuorumText(scenario, ddEff(scenario, 'N', N), down, ddEff(scenario, 'readRepair', readRepair), row, col)",
    rowLabelExpr: "concat('R = ', row + 1)", colLabelExpr: "concat('W = ', idx + 1)",
    label: 'Quorum matrix (computed) · this scenario, N, failures',
    prompt: 'Explain this computed matrix: each cell ran the selected scenario with that read quorum R (row) and write quorum W (column) at the current N and number of failed replicas. Magenta = some read was stale, orange = some requests failed, green = all fresh (with the p99 latency), blank = R or W larger than N.',
});
const GUARANTEE_MATRIX = matrix({
    id: 'guarantee-matrix', origin: [28, -4, 0], rows: 4, cols: 5, cellSize: 2.8,
    valueExpr: 'ddGuarantee(row, col)', textExpr: 'ddGuaranteeText(row, col)', rowLabelExpr: 'ddGuaranteeRow(row)',
    colLabels: ['eventual', 'RYW', 'mono.', 'causal', 'primary'],
    label: 'Guarantee matrix (computed): scenario × read mechanism',
    prompt: 'Explain this computed matrix: each cell ran the scenario (row) with the read mechanism (column). ✗ names the weakest guarantee the history checker found broken; ✓ shows the 99th-percentile latency that mechanism cost.',
});

export const SCENES = [
    () => clusterScene({
        id: 'replication', title: 'Replication',
        description: 'Primary–replica replication with async, semi-sync, majority and sync acknowledgements; lag, failover, split brain and multi-primary conflicts.',
        markdown: MD_REPLICATION,
        prompt: 'You are a distributed-systems mentor preparing the learner for senior system-design interviews. Ground every claim in the live board (log positions, lag, lost writes, epochs). Ask the learner to predict before revealing. Be precise that failover here is a simplified external monitor; safe leader election is lesson 3.',
        scene: 'replication', knobs: ['ack', 'replDelay', 'failover', 'lease'], steps: replicationSteps, nodes: 3, keys: 1, clients: 3,
    }),
    () => clusterScene({
        id: 'consistency', title: 'Consistency Models',
        description: 'Read-your-writes, monotonic reads, causal and linearizable reads over lagging replicas, each checked against the real history.',
        markdown: MD_CONSISTENCY,
        prompt: 'You are a distributed-systems mentor. Define each consistency model by what clients observe, then the mechanism that provides it. Use the history checker labels and the guarantee matrix as ground truth. Keep isolation (transactions) and consistency (replicas) distinct.',
        scene: 'consistency', knobs: ['read', 'replDelay'], steps: consistencySteps, nodes: 3, keys: 2, clients: 3,
        metrics: [['p99 latency', 'm_p99'], ['p50 latency', 'm_p50'], ['Stale reads', 'm_stale'], ['Reads ok', 'm_ok'], ['Messages', 'm_msgs']],
        extras: [GUARANTEE_MATRIX], extraRange: 30,
        extraViews: [{ name: 'Guarantee matrix', position: [35, -2, 30], target: [35, -2, 0] }],
    }),
    () => clusterScene({
        id: 'quorums', title: 'Quorum Reads and Writes',
        description: 'N, R and W in a leaderless store: overlap, availability, latency, and four ways R + W > N still is not linearizable.',
        markdown: MD_QUORUMS,
        prompt: 'You are a distributed-systems mentor. Use the live board and the computed quorum matrix. Be precise: R + W > N gives overlapping quorums, not linearizability; explain each counterexample from the actual messages and replies. Relate settings to Cassandra consistency levels without overstating the model.',
        scene: 'quorums', knobs: ['N', 'R', 'W', 'down', 'readRepair', 'sloppy'], steps: quorumSteps.map(st => ({ ...st, set: { ...st.set, ...(st.down !== undefined ? { down: st.down } : {}) } })), nodes: 5, keys: 1, clients: 3,
        metrics: [['Available %', 'm_availability'], ['p99 latency', 'm_p99'], ['Stale reads', 'm_stale'], ['Lost writes', 'm_lost'], ['Failed ops', 'm_unavailable'], ['Hints replayed', 'm_hints']],
        extras: [QUORUM_MATRIX], extraRange: 22,
        extraViews: [{ name: 'Quorum matrix', position: [28, -1, 30], target: [28, -1, 0] }],
    }),
];
void merkleTrees; void metricsStrip; void capacityBoard; void shardBoard; void ringBoard;
