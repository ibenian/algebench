# Distributed Databases Laboratory — proposal

Lesson 2 of 3 (Database Systems → **Distributed Databases** → Distributed Coordination).
Built like the Messaging Systems Laboratory (#704) and the Database Systems Laboratory (#705):
a deterministic domain engine, a lesson generator, real client code in the Code tab, a
computed comparison matrix, and semantic tests.

Learning arc per scene: **Concept → Mechanism → Simulation → Real-world comparison**.
Every scene answers one question, and the questions chain:

| # | Scene | The question it answers |
|---|---|---|
| 1 | Why Distribute? | What breaks when one server is not enough — and which kind of "more servers" fixes which problem? |
| 2 | Replication | How do copies stay in step, and what do we lose when the primary dies? |
| 3 | Consistency Models | With copies that lag, *what may a client observe?* |
| 4 | Quorums | Can we tune that observation per request with N, R, W — and where does that stop working? |
| 5 | Network Partitions: CAP and PACELC | When nodes cannot talk, what must we give up — and what do we give up when they can? |
| 6 | Failure, Repair and Reconciliation | After a node returns, how do divergent copies find each other and agree? |
| 7 | Partitioning and Sharding | Copies don't add write capacity; how do we split the data itself? |
| 8 | Consistent Hashing | How do we add a node without moving everything? |
| 9 | Architectures Compared | How do real systems combine these choices, by default and when configured? |

## 0. Changes from the brief

- **Order: replication thread first (2–6), then partitioning (7–8).** The brief put partitioning
  at 5–6, between quorums and CAP. Quorum → CAP → repair is one continuous story on the same
  replicated key (the quorum knob from scene 4 is exactly what the partition in scene 5 tests,
  and the divergence it creates is what scene 6 repairs). Partitioning is a separate axis;
  scene 1 sets up both threads ("replicas scale reads and survive failures; shards scale
  writes"), and scene 8 rejoins them by drawing the replication preference list on the ring.
- **CAP after quorums**, so "CP" and "AP" are concrete settings learners already used
  (strict majority quorum vs. accept-anywhere), not slogans.
- **Kept 9 scenes** but scene 1 is short (4 steps) and scene 9 is mostly computed matrix +
  drills. Total ≈ 50 steps, comparable to lesson 1.

## 1. Boundaries with lessons 1 and 3

| Topic | Here | Elsewhere |
|---|---|---|
| Isolation vs consistency | One callout in scene 3: isolation orders *transactions*; consistency models order *operations on copies*. Strict serializability = both. | Isolation levels, anomalies, MVCC → lesson 1 |
| Failover | Promotion after a timeout; consequences only (lost acknowledged writes, split brain, fencing *idea*). | How to elect safely, Raft, leases, epochs → lesson 3 |
| Conflict detection | Last-write-wins (with clock skew) and **siblings** detected by per-key version vectors, used as a black box ("these two writes didn't see each other"). | Lamport/vector clock theory, happens-before → lesson 3 |
| Linearizable systems | Spanner/CockroachDB/MongoDB-majority shown by *observable guarantee*; "a consensus group per range" as a labelled box. | Paxos/Raft/TrueTime mechanics → lesson 3 |
| Distributed transactions | Mentioned as the cost of multi-shard writes in scene 7. | 2PC, Percolator, Calvin → lesson 3 |
| Storage engines | — | lesson 1 (Cassandra appeared only as LSM there) |

## 2. Architecture (same pattern as lessons 1 and the messaging lab)

| Lesson 1 | This lesson |
|---|---|
| `static/domains/database/index.js` | `static/domains/distdb/index.js` (+ `docs.json`, `test.mjs`) |
| `dbTrace(...)` → one row per tick via `tableBindings` | `ddTrace(scenario, config, workload)` → one row per tick |
| serializability check over every serial order | **history checker**: linearizability (Wing–Gong search over ≤ 12 ops), session guarantees, causal consistency |
| `scripts/database_lab/*.mjs` → `scenes/draft/database-systems-lab.json` | `scripts/distdb_lab/*.mjs` → `scenes/draft/distributed-databases-lab.json` |
| `examples/database-lab/` SQL sessions | `examples/distdb-lab/` client code (below), lines lit per op |
| `dbCaption`, `dbContext` | `ddCaption`, `ddContext` (tutor `promptExpr`) |
| isolation / mechanism matrices computed by running the engine | scene-4 quorum matrix and scene-9 **profile × scenario** matrix, computed |

### 2.1 Engines

All deterministic and tick-based; changing any slider re-runs the scenario.

**A. Cluster engine** (scenes 2–6, 9). A discrete-event simulator of a small replicated store.

- *State*: up to 5 nodes, 4 clients, 6 keys, 40 ticks, 24 client operations.
  Each node: `up | down | recovering`, local clock offset, and per key a set of versions
  `{value, writer, ts, vv}` (more than one = siblings), a replication log with applied
  position, a **hint queue** (writes held for a down peer), tombstones with a GC deadline.
- *Network*: per-link latency (ticks), a **partition schedule** (which node groups are cut,
  from/to tick), message loss off. Messages in flight are first-class: they appear on the
  board and arrive when their latency elapses, or are dropped if the link is cut.
- *Workload*: an editable data table (like the lesson-1 schedule)
  `{client, tick, op: put|get|delete, key, value}` plus per-client routing
  (`sticky node | any replica | coordinator | primary`).
- *Configuration* (one object; each scene exposes a subset as sliders):
  - topology: `primary-replica | multi-primary | leaderless`
  - replication: `async | semi-sync (k acks) | sync (all) | quorum (N, W)`
  - reads: `primary | any replica | quorum R | session-token (min version) | sticky`
  - conflict resolution: `LWW (node clock) | siblings (version vectors) | reject (single leader)`
  - failure handling: failure-detector timeout, auto-promotion on/off, `strict | sloppy` quorum,
    hinted handoff on/off, read repair `off | async | blocking`, anti-entropy period
  - fault schedule: node crash/restart ticks, partition schedule, replication-delay spikes
- *Per-tick trace row*: node states and per-key versions, replication lag per replica,
  in-flight messages (`from, to, kind: replicate|ack|read|reply|hint|repair, key`),
  client operation lanes (`pending | ok | stale | rejected | timed out | lost`), coordinator
  ack counters vs threshold, events text, code-line refs, metrics (availability %, p50/p99
  latency, stale reads, lost acknowledged writes, conflicts/siblings, repair traffic), and the
  checker verdicts so far.

**B. History checker** (shared). Given completed operations with real-time intervals:
linearizable? (search for a legal total order consistent with real time); per-client
read-your-writes, monotonic reads, monotonic writes, writes-follow-reads; causal; eventually
convergent after quiescence. Each read is labelled with the **weakest model it violates**, so
the board can say *why* a value was allowed or not. This is the analogue of lesson 1's
serial-equivalence check: the ground truth that doesn't trust the mechanism.

**C. Placement engine** (scenes 7–8). Pure functions, plus a migration diff:
`ddPlace(strategy, keys, nodes, opts)` for `range | hash-mod | fixed-partitions |
consistent-hash (vnodes) | hash-slots (16384, Redis-style)`; returns key → node, per-node
load (with a Zipf skew / hot-key input), and for a node add/remove the **moved-key set** and
bytes moved. Query router: point, range, secondary-index (local vs global) → shards touched.

**D. Capacity model** (scene 1). Deterministic fluid queue per tick: arrival rate (read/write
mix), per-node service capacity, queue → latency; options `scale up | read replicas | shards |
second region`; node failure. Not the cluster engine — just enough to motivate.

### 2.2 Shared visual grammar (cluster scenes)

- **Clients** (top row, array lanes like lesson 1): each operation as a cell over time,
  coloured `ok · stale · rejected · timed out · lost-after-ack`; white = the traced op.
- **Cluster** (`system_dag`): one block per node with a key × version tensor inside (siblings as
  extra columns, tombstones struck), a lag bar, and a hint queue strip. Connections are the
  network: lit while a message is in flight (colour by kind), **red/broken when partitioned**,
  dimmed when an endpoint is down.
- **Coordinator panel**: acks received vs W (or R) as a filling bar with the threshold marked.
- **Timeline** (Jepsen-style history): each client's operations as intervals over real time
  with the value read/written — the picture the checker reasons about.
- **Meters** strip: availability, p99 latency, stale reads, lost writes, conflicts, repair traffic.
- **Code tab**: client code whose lines light with the running op.

### 2.3 Code tab (`examples/distdb-lab/`)

Real, short client snippets — the knob the learner moves is visible in code:
- `postgres/primary.conf`, `replica_read.py` — `synchronous_commit`, `synchronous_standby_names = 'ANY 1 (r1, r2)'`, reading from a hot standby.
- `cassandra/session.py` — `ConsistencyLevel.ONE / QUORUM / ALL` per statement; keyspace `replication_factor`.
- `mongodb/client.py` — `writeConcern {w: 'majority'}`, `readConcern`, `readPreference`, causal session.
- `dynamodb/client.py` — `ConsistentRead=True`, a Global Table write.
- `redis/cluster.py` — `CLUSTER KEYSLOT`, hash tags `{user:42}`, `WAIT`.

### 2.4 Possible small platform additions (to confirm during implementation)

- `system_dag` connection `statusExpr` (normal / active / cut / down) so partitions draw as
  broken links rather than only "inactive". Block `dimExpr` for down nodes (messaging added
  block `highlightExpr`, so this is a sibling).
- Hash ring: built from existing `parametric_curve` + `animated_point`s reading the trace
  table; a dedicated object only if that proves too slow at 5 nodes × 32 vnodes + 24 keys.

## 3. Scenes

### Scene 1 — Why Distribute?
- **Concept**: the four pressures — throughput, data size, availability, distance — and that
  they need *different* fixes. Scale up vs. scale out.
- **Simulation** (capacity model): request-rate and read/write-mix sliders against one node:
  queue builds, latency explodes past saturation. Then options: bigger node (ceiling), **read
  replicas** (read capacity grows, write ceiling doesn't move), **shards** (both grow), second
  region (latency for far clients drops). Crash the single node → 0 % availability; crash one
  of three replicas → reads continue.
- **Predict**: "80 % writes at 2× capacity — will 3 read replicas help?" (no).
- **Discover**: replication buys read scale + availability; partitioning buys write scale +
  size; both buy cost and *new failure modes*, which the rest of the lesson is about.
- **Steps (4)**: saturate · add replicas · add shards · lose a node.

### Scene 2 — Replication
- **Concept**: a replica is a copy that applies the same changes. Primary-replica vs.
  multi-primary vs. leaderless (preview). Sync vs. async vs. semi-sync. Replication lag. Failover.
- **Simulation** (cluster engine, primary-replica, 1 primary + 2 replicas): a client writes a
  stream; watch log entries travel and replicas apply them. Sliders: replication mode, replica
  delay, crash primary at tick, auto-failover timeout.
- **Key contrasts**:
  - async: low write latency, lag visible; **crash the primary after ack but before shipping →
    promotion loses acknowledged writes** (lost-after-ack counter).
  - sync (all): no loss, but one slow/down replica **stalls every write**.
  - semi-sync / `ANY 1`: the middle ground — survives one replica loss, loses nothing on one
    primary loss.
  - old primary returns → **split brain** in multi-primary-by-accident; fencing named, election
    deferred to lesson 3.
  - multi-primary: two regions write the same key concurrently → conflict that must be resolved.
- **Compare**: PostgreSQL streaming replication (async default, `synchronous_commit`
  levels, no built-in automatic failover — Patroni etc.); MySQL async binlog / semi-sync
  `AFTER_SYNC` / Group Replication; MongoDB replica set (`w:'majority'` default since 5.0).
- **Steps (6)**: write and watch lag · predict the failover loss · async failover · sync stall ·
  semi-sync · multi-primary conflict.

### Scene 3 — Consistency Models
- **Concept**: a consistency model is a promise about **what values a read may return**.
  Defined by observations, independent of mechanism. Ladder: eventual → monotonic reads /
  read-your-writes (session guarantees) → causal → linearizable. Isolation-vs-consistency callout.
- **Simulation**: 3 clients, 1 primary + 2 lagging replicas. Scenarios: *profile update then
  reload* (RYW), *refresh flips between old and new* (monotonic reads), *comment before the post
  it replies to* (causal), *two readers disagree after a write completed* (linearizability).
  A **Guarantee** selector switches the *mechanism* that provides it (any replica · sticky
  replica · session token with minimum version · causal token · read from primary/quorum).
- **What's shown**: the timeline with every read labelled by the checker ("allowed under
  eventual; violates monotonic reads because C2 already saw v3"), plus the latency each
  guarantee cost. The same history is checked against all models at once → a small
  guarantee × scenario grid.
- **Discover**: guarantees are about observations; mechanisms are interchangeable ways to get
  them, priced in latency and availability. Linearizability is the only one that needs
  cross-client coordination.
- **Compare**: MongoDB causal sessions; DynamoDB eventually vs. strongly consistent reads;
  replica-read routing in PostgreSQL/MySQL apps (read-after-write pinning).
- **Steps (6)**: eventual · read-your-writes · monotonic reads · causal · linearizable ·
  "choose for each product feature" drill.

### Scene 4 — Quorums
- **Concept**: leaderless replication. N replicas; a write succeeds after W acks; a read waits
  for R replies and returns the newest. Overlap intuition for R + W > N.
- **Simulation**: one key, N ∈ 1..5, R, W sliders, per-replica down/slow toggles, network delay.
  The coordinator bars fill with acks/replies; read and write latency = the W-th / R-th fastest
  reply; availability = can the threshold still be met.
- **Computed matrix**: R × W grid for the current N and failures: each cell runs the scenario
  and shows *stale-read possible? · write availability · read availability · latency*.
- **Why R + W > N is not enough** — four runnable counterexamples, each a step:
  1. **Read concurrent with a write**: the write has reached 1 of 3 replicas; reader A's quorum
     includes it (new), a later reader B's doesn't (old) → non-linearizable without **blocking
     read repair / write-back**.
  2. **Failed write leaves residue**: W not reached, client sees an error, but the value is on
     one replica and later reads may return it.
  3. **Sloppy quorum**: replicas down, writes accepted by fallback nodes (hinted handoff) — the
     read quorum and write quorum no longer intersect.
  4. **LWW with clock skew**: two writes, the later one carries an older timestamp and silently
     loses.
- **Compare**: Cassandra consistency levels (ONE/QUORUM/LOCAL_QUORUM/ALL, per query; LWT for
  linearizable CAS → lesson 3); Riak/Dynamo-paper sloppy quorums; DynamoDB exposes a
  per-read choice, not N/R/W.
- **Steps (7)**: overlap · fast but stale (R=W=1) · failures and availability · the matrix ·
  counterexample 1 · 2+3 · 4.

### Scene 5 — Network Partitions: CAP and PACELC
- **Concept**: a network partition means messages between groups are lost, not slow.
  CAP precisely: *for a linearizable register, during a partition, some non-failing node must
  refuse (or block on) requests*. It says nothing when there is no partition, and "pick 2 of 3"
  is a misreading. PACELC: **else**, latency vs. consistency.
- **Simulation**: 5 nodes, two regions; partition schedule slider (cut at tick, heal at tick,
  minority side). Policy selector:
  - **CP**: majority quorum; minority side rejects writes (and linearizable reads).
  - **AP**: every side accepts; reconcile on heal with LWW or siblings.
  Clients on both sides keep writing; the board shows rejected ops on one side (CP) or two
  diverging histories (AP) that the checker marks non-linearizable, then the heal.
- **PACELC half**: no partition, inter-region latency slider: CP config pays the round trip
  on every write; AP/local config answers locally and is stale for a while. Same knob,
  different trade-off — this is the one users feel daily.
- **Discover**: availability in CAP means *every* non-failing node answers; most "CP" systems are
  still highly available in the ordinary sense. Latency and partitions are different axes.
- **Compare**: MongoDB (primary steps down without a majority), Cassandra/Dynamo-style (keep
  accepting at CL ONE), Spanner/CockroachDB (minority ranges unavailable), Redis Cluster (can lose
  acknowledged writes across a partition — window bounded by `cluster-node-timeout`).
- **Steps (6)**: partition vs. latency · CP during a partition · AP during a partition · the heal ·
  PACELC else-branch · classify-the-system drill.

### Scene 6 — Failure, Repair and Reconciliation
- **Concept**: temporary vs. permanent failure; stale replica; the three repair paths and what
  each is for: **hinted handoff** (fast, for short outages), **read repair** (on the read path,
  only for keys that are read), **anti-entropy** (background, everything, via Merkle trees).
  Divergence resolution: LWW vs. siblings merged by the client.
- **Simulation**: N=3 leaderless, one node down for a window while writes continue; toggles for
  each repair path; node returns. Watch hints replay, a read repair a single key, and an
  anti-entropy pass: two Merkle trees side by side with mismatching hashes lit top-down until
  only the differing key ranges are exchanged ("bytes compared vs. bytes moved").
- **The tombstone trap**: delete while a replica is down, GC the tombstone before repair runs →
  the deleted value **comes back** (gc-grace slider vs. repair period).
- **Siblings**: concurrent writes on two sides → two versions kept; the client merges (shopping
  cart union) vs. LWW silently dropping one.
- **Compare**: Cassandra (hinted handoff window, read repair, `nodetool repair`,
  `gc_grace_seconds`), Dynamo paper / Riak (vector clocks, siblings), DynamoDB Global Tables
  (LWW across regions), primary-replica catch-up from the log (PostgreSQL / MySQL rejoining
  replica).
- **Steps (6)**: outage with writes · hinted handoff · read repair · anti-entropy (Merkle) ·
  resurrection · siblings vs. LWW.

### Scene 7 — Partitioning and Sharding
- **Concept**: vertical (split columns/tables) vs. horizontal (split rows). Partition key,
  data locality, routing. Range vs. hash. Hot partitions.
- **Simulation** (placement engine): a stream of records (users with id, country, signup time);
  sliders for strategy (range on id · range on time · hash on id · hash on country), shard
  count, skew (Zipf) and a celebrity key. Shows per-shard load bars, max/mean imbalance, and a
  query panel: point lookup (1 shard), range scan (1 shard for range, **scatter-gather for hash**),
  lookup by secondary attribute (local index = scatter-gather; global index = one shard but
  updated asynchronously).
- **Key contrasts**: range on time → all writes on the last shard; hash fixes writes but kills
  range scans; celebrity key is hot under *any* strategy → key salting/splitting; multi-shard
  writes need distributed transactions (→ lesson 3).
- **Resharding**: hash-mod-N vs. **fixed number of partitions** mapped to nodes (move whole
  partitions) — sets up scene 8.
- **Compare**: MongoDB (range and hashed shard keys, chunks, balancer, `mongos`), DynamoDB
  (partition + sort key, adaptive capacity, GSIs eventually consistent), Cassandra (partition
  key + clustering columns), CockroachDB (range-partitioned, automatic splits), Vitess / Citus
  for MySQL / PostgreSQL.
- **Steps (6)**: vertical vs. horizontal · range vs. hash · time-range hotspot · queries and
  routing · celebrity key · resharding cost.

### Scene 8 — Consistent Hashing
- **Concept**: place nodes and keys on the same hash ring; a key belongs to the next node
  clockwise. Virtual nodes for balance. Replication = the next N **distinct physical** nodes
  (preference list).
- **Simulation**: ring (circle with node tokens and key dots), sliders: nodes 2–6, vnodes per
  node 1–32, add/remove a node, RF. Moved keys flash and are counted; side panel runs the same
  change under **mod-N** for comparison.
- **Numbers shown (computed, then explained)**: mod-N, N → N+1 moves ≈ N/(N+1) of keys;
  consistent hashing moves ≈ 1/(N+1), all *to* the new node; with 1 vnode the new node steals from
  one neighbour only (uneven), with many vnodes it takes evenly from everyone. Load std-dev vs.
  vnode count.
- **Compare**: Cassandra tokens/vnodes (`num_tokens`, 16 by default since 4.0), Dynamo paper;
  **Redis Cluster is not consistent hashing** — 16384 fixed hash slots moved explicitly;
  DynamoDB / CockroachDB split and move ranges instead. Mention rendezvous and jump hashing as
  alternatives (one line).
- **Steps (5)**: the ring · add a node vs. mod-N · vnodes and balance · remove a node · preference
  lists (RF on the ring, bridge back to quorums).

### Scene 9 — Architectures Compared
- **Concept**: a "database" is a bundle of choices — topology, replication, read path, conflict
  handling, partitioning, failover — and most are configurable.
- **Computed matrix**: rows = **profiles** (each a named configuration of the cluster engine, not
  a product reimplementation), columns = scenarios from earlier scenes (read after write on a
  replica · primary/node crash · minority partition · node outage then recovery · hot key). Cells
  are produced by running the engine: ✓ / stale read / rejected / lost acknowledged write /
  siblings. A step loads any cell onto the board.

  | Profile | Configuration it models |
  |---|---|
  | PostgreSQL · async replica reads | single primary, async streaming, reads on standby |
  | PostgreSQL · `synchronous_commit=on`, `ANY 1` | semi-sync quorum of standbys |
  | MySQL · async / semi-sync `AFTER_SYNC` | binlog replication |
  | MongoDB · `w:majority`, read primary | replica set defaults (5.0+) |
  | MongoDB · read secondary, `readConcern local` | stale-tolerant reads |
  | Cassandra · `ONE`/`ONE` and `QUORUM`/`QUORUM` | RF 3, LWW, hints + read repair |
  | DynamoDB · eventually / strongly consistent read | single region, managed |
  | Redis Cluster | async replica per slot owner, failover by primaries |
  | CockroachDB / Spanner | consensus per range (black box), linearizable reads |

- **Fact table** (static, sourced, three columns per system): **default** · **configurable** ·
  **architectural limit**. E.g. DynamoDB: default eventually consistent reads · strongly
  consistent reads on the base table · not on GSIs, Global Tables LWW. Redis Cluster: async
  replication · `WAIT` for replica acks · can still lose acknowledged writes on failover.
  Distinguish **DynamoDB (the service)** from the **Dynamo paper**.
- **Design drills** (tutor-critiqued, learner sets sliders and runs): shopping cart that must
  never lose an add; bank balance; social feed; global leaderboard; session store.
- **Steps (6)**: read the matrix · same product, two configs · Dynamo ≠ DynamoDB · 3 drills.

## 4. Controls summary

| Control | Scenes |
|---|---|
| Tick, play/step, speed (existing `stepPlayback`) | all |
| Scenario selector (per scene prefix of a scenario list) | 2–9 |
| Editable workload table (client, tick, op, key, value) | 2–6 |
| Node count, replication factor N | 1, 4, 5, 8 |
| R, W, strict/sloppy quorum | 4, 6 |
| Replication mode, replica delay, inter-node latency | 2, 3, 5 |
| Read guarantee / routing | 3 |
| Crash node X at tick / restart at tick; failover timeout | 2, 4, 6 |
| Partition schedule (cut, heal, which side), CP/AP policy | 5 |
| Conflict resolution (LWW / siblings), clock skew | 4, 5, 6 |
| Hinted handoff, read repair, anti-entropy period, gc-grace | 6 |
| Strategy, shard count, skew, celebrity key, query type | 7 |
| Nodes, vnodes, add/remove node, RF | 8 |
| Profile × scenario | 9 |

## 5. Semantic tests (`static/domains/distdb/test.mjs`)

Representative, each asserting an outcome rather than a picture:
- async replication + primary crash before shipping → ≥ 1 lost acknowledged write; semi-sync
  `ANY 1` → 0; sync with one replica down → writes time out.
- RYW: any-replica routing violates it on the profile-update scenario; session token does not.
- Checker: a hand-built non-linearizable history is rejected, its linearizable twin accepted.
- R + W > N with strict quorum and blocking read repair → linearizable on the concurrent-read
  scenario; without read repair → not; sloppy quorum → stale read; LWW + skew → lost write.
- CP: minority writes rejected, history linearizable; AP: all accepted, divergence, converge after heal.
- Hinted handoff replays all hints on return; Merkle pass transfers only differing ranges.
- Tombstone GC before repair → resurrection; after repair → none.
- Consistent hashing N → N+1 moves ≤ 1/(N+1) + ε of keys, all to the new node; mod-N ≥ N/(N+1) − ε.
- Range-on-time → last shard gets all writes; hash → imbalance < threshold.

## 6. Delivery plan

1. Cluster engine + history checker + tests (scenes 2–4 need it).
2. Scenes 2–4, generator, board, Code tab.
3. Partitions and repair (scenes 5–6).
4. Placement engine + scenes 7–8 (ring).
5. Capacity model + scene 1; profiles + scene 9; glossary, captions, tutor prompts, polish.

## 7. Open questions for review

1. **Scene order** — replication thread before partitioning (proposed) or the brief's order?
2. **CockroachDB, Spanner, or both** in scene 9? Proposed: one row "CockroachDB / Spanner" shown
   by observable guarantees, mechanics deferred to lesson 3.
3. **Version vectors** — OK to use them as a black box here ("didn't see each other") and teach
   the clock theory in lesson 3? The alternative is LWW-only, which hides siblings.
4. **Scope of scene 1** — keep it as a short capacity-model scene, or fold it into the
   replication scene's opening steps (8 scenes)?
