# Database Systems Laboratory — proposal

Lesson 1 of 3 (Database Systems → Distributed Databases → Distributed Coordination).
Built the same way as the Messaging Systems Laboratory (#704): a deterministic domain
engine, a lesson generator, real client code in the Code tab, and semantic tests.

Learning arc per scene: **Concept → Mechanism → Simulation → Real-world comparison**.

## 1. Architecture (reuses the messaging lab pattern)

| Messaging lab | Database lab |
|---|---|
| `static/domains/messaging/index.js` — tick engine, per-system adapters | `static/domains/database/index.js` — tick engine with three sub-engines (below) |
| `mqTrace(system, workload, overrides)` → one row per tick, bound with `tableBindings` | `dbTrace(engine, schedule, overrides)` → one row per tick, same binding pattern |
| adapters: kafka / rabbitmq / sqs | concurrency-control adapters: `none`, `2pl`, `occ`, `mvcc-si`, `ssi` + DB profiles |
| `scripts/messaging_lab/*.mjs` generator → `scenes/draft/messaging-systems-lab.json` | `scripts/database_lab/*.mjs` → `scenes/draft/database-systems-lab.json` |
| `examples/messaging-lab/` real clients, lines lit per tick, "Crash here" line actions | `examples/database-lab/` SQL sessions + Python retry loop, lines lit per op, "Crash here" / "Abort here" actions |
| `test.mjs` semantic tests | `test.mjs`: each anomaly occurs under level X and is prevented under level Y, deadlocks are detected, recovery keeps exactly the committed transactions, … |
| `mqCaption`, `mqContext` (tutor `promptExpr`) | `dbCaption`, `dbContext` |

### Sub-engines (one trace row per tick each)

1. **Transaction engine** (scenes 2–6). Small rows table with versions
   (`xmin/xmax`-style), a *schedule* = editable data table of ops
   `{tx, op: begin|read|write|insert|delete|scan|commit|abort, key|predicate, expr}`.
   Each tick the scheduler runs the next runnable op; blocked transactions wait and the
   others proceed, so interleaving is *produced by the mechanism*, not scripted.
   Per tick it emits: committed table, uncommitted/private versions, each transaction's
   snapshot and read/write sets, lock table + wait queue, wait-for graph, precedence
   (conflict) graph, detected anomalies, invariant checks (e.g. total balance), undo/redo
   log entries, aborts with reason, ops for code highlighting, caption text.
2. **Index / query engine** (scene 7). Generated table of N rows, B-tree build with page
   fan-out, plan choice (seq scan, index scan, index-only scan, sort), pages touched,
   rows examined vs returned, insert cost per extra index.
3. **Storage engine** (scene 8). Write stream into either B-tree + WAL (in-place page
   writes, checkpoints) or LSM (WAL + memtable → SSTable flush → leveled compaction,
   bloom filters). Crash slider + fsync policy → recovery replay; write/read/space
   amplification counters.

### Shared visual grammar (all transaction scenes)

- **Lanes** (array rows): T1 / T2 / T3 op timelines; colour = pending · running ·
  blocked · committed · aborted; white = the traced op.
- **Table** (tensor with text): rows × columns; committed values, with uncommitted
  versions shown as an overlay/second layer.
- **Internals** (system_dag): lock table, version chains, wait-for graph, validation
  step — whichever the mechanism uses; pipes light when a read/write/lock/validate
  happens this tick.
- **Meters** (metrics strip): invariant (e.g. `A+B = 200`), commits, aborts,
  wait ticks, anomalies.
- **Code tab**: `session_t1.sql`, `session_t2.sql` (PostgreSQL dialect) with active
  lines, plus `transfer.py` showing the serialization-failure retry loop.

## 2. Scenes

### Scene 1 — Data Models, Keys and Constraints
- **Concept**: tables, rows, primary/foreign keys, NOT NULL / UNIQUE / CHECK;
  relational vs document vs key-value modelling of the same data.
- **Simulation**: editable `customers` / `orders` tables. Insert/update rows; the engine
  accepts or rejects each with the violated constraint highlighted. Toggle the model view:
  normalized tables ↔ embedded MongoDB document ↔ DynamoDB single-table items (PK/SK).
- **Discover**: where each model enforces integrity — and where the application has to.
- **Compare**: PostgreSQL/MySQL enforce declaratively; SQLite has type affinity and
  foreign keys off by default; MongoDB optional `$jsonSchema` validation; DynamoDB enforces
  only the key schema; Redis none.

### Scene 2 — ACID: Break One Guarantee at a Time
- **Concept**: the four properties as four separate promises.
- **Simulation**: transfer $100 A→B (and a concurrent transfer). Four switches disable one
  guarantee each: **A** off + crash mid-transfer → money vanishes; **C** off → balance goes
  negative; **I** off → concurrent transfers lose an update; **D** off (ack before fsync) +
  crash → a committed transfer disappears. The invariant meter shows exactly which promise broke.
- **Compare**: where "C" actually lives (constraints vs application); durability knobs
  (`synchronous_commit`, `innodb_flush_log_at_trx_commit`, SQLite `synchronous`, Redis
  `appendfsync`, MongoDB write concern `j:true`).

### Scene 3 — Transaction Lifecycle and Failure
- **Concept**: BEGIN, READ, UPDATE, COMMIT, ROLLBACK, SAVEPOINT; private vs committed
  state; undo log (to roll back) and redo/WAL (to recover).
- **Simulation**: step one transaction; inject failure at any op (constraint error,
  client disconnect, server crash, explicit ROLLBACK, ROLLBACK TO SAVEPOINT). Watch the undo
  log unwind and the committed table stay untouched.
- **Compare**: PostgreSQL aborts the whole transaction after any error (must ROLLBACK);
  MySQL rolls back only the failing statement; autocommit defaults; Redis `MULTI/EXEC` has
  no rollback; DynamoDB `TransactWriteItems` is one request, not an interactive session;
  MongoDB multi-document transactions with retryable `TransientTransactionError`.

### Scene 4 — Concurrency Anomalies
- **Concept**: what goes wrong when transactions interleave with no isolation.
- **Simulation**: scenario selector — dirty write, dirty read, lost update,
  non-repeatable read, read skew, phantom, write skew (on-call doctors). The schedule table
  is editable: reorder ops and see whether the anomaly survives. A **precedence graph**
  shows the conflict cycle, and a "serial equivalent?" check tries T1→T2 and T2→T1.
- **Discover**: an anomaly is exactly a schedule with no equivalent serial order.
- **Compare**: none here — theory only (keeps comparisons in scene 5 sharp).

### Scene 5 — Isolation Levels: Replay the Same Schedule
- **Concept**: isolation levels as "which anomalies are allowed"; ANSI definitions vs
  real implementations.
- **Simulation**: same scenarios, now with an isolation selector (Read Uncommitted /
  Read Committed / Repeatable Read / Snapshot / Serializable). An anomaly × level matrix is
  **computed by running the engine** for every cell, not hardcoded. A **DB profile**
  selector replays the schedule under modelled PostgreSQL, MySQL/InnoDB, SQLite, MongoDB
  behaviour.
- **Discover** (interview gold):
  - PostgreSQL "Repeatable Read" is snapshot isolation: no phantoms, lost updates abort with
    a serialization failure, **write skew still happens**; Serializable (SSI) aborts it.
  - MySQL/InnoDB Repeatable Read: plain SELECTs read a snapshot but UPDATE reads the latest
    committed row — the read-modify-write lost update **succeeds silently** unless you use
    `SELECT … FOR UPDATE`.
  - SQLite: one writer at a time → serializable by construction, paid for in concurrency.
  - MongoDB transactions: snapshot isolation, write conflicts abort.
- Profiles are labelled as models of documented behaviour, not reimplementations.

### Scene 6 — Concurrency Control Mechanisms
- **Concept**: how isolation is enforced — pessimistic (2PL), optimistic (OCC), MVCC, SSI.
- **Simulation**: one workload, mechanism selector; sliders for transactions, contention
  (hot-key %), think time, deadlock-prone ordering. Shows lock table and wait queue, wait-for
  graph with deadlock detection and victim choice, OCC read/write-set validation and
  retries, MVCC version chains and per-transaction snapshot visibility, garbage versions.
  Metrics: committed/tick, aborts, wait ticks, retries, versions retained.
- **Discover**: 2PL waits, OCC wastes work under contention, MVCC lets readers never block
  writers but leaves garbage; crossover as contention rises.
- **Compare**: PostgreSQL MVCC (heap tuple versions, VACUUM); InnoDB (undo-log MVCC,
  next-key/gap locks, deadlock detector); SQLite (database-level write lock, WAL readers);
  MongoDB (document-level concurrency, write-conflict retry); DynamoDB (conditional writes /
  version attribute = OCC); Redis (single-threaded execution, `WATCH` = optimistic).

### Scene 7 — Indexes and Query Execution
- **Concept**: full scan vs B-tree lookup; selectivity; composite indexes and the
  leftmost-prefix rule; covering indexes; query plans; write cost of indexes.
- **Simulation**: table size slider, query builder (equality/range predicates, ORDER BY,
  LIMIT), index toggles (none, `(city)`, `(city, age)`, covering). B-tree drawn with the
  search path lit; plan tree with pages touched and rows examined/returned; a selectivity
  slider shows where a seq scan beats an index; insert benchmark shows per-index write cost.
- **Compare**: PostgreSQL (heap + secondary indexes, index-only scans need the visibility
  map); InnoDB (clustered primary key; secondary index → PK → row double lookup); SQLite
  (rowid B-tree, `WITHOUT ROWID`); MongoDB (B-tree indexes, ESR rule); DynamoDB (Query vs
  Scan, partition/sort keys, GSIs eventually consistent); Redis (no secondary indexes —
  sorted sets by hand).

### Scene 8 — Storage Engines and Durability
- **Concept**: B-tree (update in place) vs LSM-tree (append, then merge); WAL;
  memtable, SSTables, compaction, bloom filters; checkpoint and recovery.
- **Simulation**: write/read stream, engine selector, crash tick, fsync policy
  (every commit / group commit / every N ticks). Watch pages dirty and checkpoint, or
  memtable flush and compaction levels; crash → WAL replay shows exactly which commits
  survive. Write/read/space amplification counters.
- **Compare**: PostgreSQL / InnoDB / SQLite (B-tree + WAL/redo; InnoDB doublewrite);
  MongoDB WiredTiger (B-tree + journal); Cassandra / RocksDB / MyRocks (LSM);
  Redis (in-memory; AOF `always/everysec/no`, RDB snapshots); DynamoDB (managed — only
  documented guarantees, no invented internals).

### Scene 9 — Comparison Matrix and Design Drills
- Interactive matrix (guarantees, isolation default/max, concurrency control, indexing,
  storage engine, limits) for the seven systems; clicking a cell jumps to the scene step
  that demonstrates it.
- Interview drills: "double-booking a seat", "inventory oversell", "bank transfer",
  "write-heavy time series" — learner picks isolation/mechanism/engine, runs it, and the
  tutor critiques with the live state.

## 3. Boundaries with lessons 2 and 3

Not covered here: replication, partitioning/sharding, consistent hashing, quorums, CAP,
consistency models across replicas, clocks, consensus, distributed transactions (2PC).
Cassandra appears only as an LSM storage example; DynamoDB only as a single-region data
model, conditional writes and transactions.

## 4. Delivery plan

1. Transaction engine (2PL, OCC, MVCC/SI, SSI, anomaly + invariant detection) + tests.
2. Scenes 4–6 (the core), generator, Code tab sessions.
3. Scenes 2–3 (reuse the engine with failure injection).
4. Index engine + scene 7.
5. Storage engine + scene 8.
6. Scene 1, scene 9, glossary, captions, tutor prompts, polish.
