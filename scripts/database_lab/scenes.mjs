// Scene definitions for the database lab. Transaction scenes share one board and one
// trace table (`db`); sliders are the simulation inputs, and steps set them.
import { DB, LAB, SCENARIO, slider } from './util.mjs';
import { board, matrix } from './board.mjs';

const { FRAMES, ORDER_SLOTS } = LAB.limits;

// ── Sliders ──────────────────────────────────────────────────────────────────
const S = {
    frame: () => slider('frame', 'Tick', 0, FRAMES, 0),
    scenario: (id, label, max) => slider('scenario', label, 0, max, SCENARIO[id], { valueExpr: 'dbScenario(scenario)' }),
    order: id => ({ id: 'order', kind: 'tensor', shape: [ORDER_SLOTS], label: 'Schedule: which transaction runs in each slot (0 = skip)', min: 0, max: 3, step: 1,
        default: DB.dbOrder(SCENARIO[id]), reset: true }),
    level: d => slider('level', 'Isolation level', 0, 4, d, { valueExpr: 'dbLevel(level)' }),
    profile: d => slider('profile', 'Database', 0, 4, d, { valueExpr: 'dbProfile(profile)' }),
    mechanism: d => slider('mechanism', 'Concurrency control', 0, 4, d, { valueExpr: 'dbMechanism(mechanism)' }),
    retry: d => slider('retry', 'Retry aborted transactions', 0, 1, d, { valueExpr: "retry ? 'yes' : 'no'" }),
};
/** Sliders that move together when a step loads a scenario. */
const load = (scene, id, extra = []) => [S.frame(), S.scenario(id, scene.label, scene.max), S.order(id), ...extra];
/** What each scene's Scenario slider offers: a prefix of the domain's scenario list (see SCENARIOS there). */
const PICK = {
    anomalies: { label: 'Anomaly', max: 6 },
    isolation: { label: 'Anomaly or fix to replay', max: 8 },
    cc: { label: 'Workload', max: LAB.SCENARIOS.length - 1 },
};

// ── Shared transaction scene builder ─────────────────────────────────────────
function txScene({ id, title, description, markdown, prompt, trace, sliders, steps, extras = [], views = [], range, camera }) {
    const allViews = [{ name: 'Board', position: [1, -9, 44], target: [1, -9, 0] }, ...views];
    return {
        id, title, description, markdown, prompt,
        promptExpr: `dbContext(frame, dataTable('db'), concat('Schedule: ', dbOrderText(scenario, order), '.'))`,
        range: range ?? [[-22, 24], [-17, 13], [-6, 6]],
        camera: camera ?? { position: allViews[0].position, target: allViews[0].target },
        views: allViews,
        stepPlayback: { slider: 'frame', intervalMs: 1100, speedControl: true },
        // Step guidance lives in a data table, not in expression strings, so captions stay pure math.js.
        data: { guides: steps.map(step => ({ id: step.id, text: step.guide })) },
        tableBindings: [{ table: 'db', rowsExpr: trace }],
        elements: [],
        steps: steps.map((step, i) => ({
            id: step.id, title: step.title, description: step.guide,
            descriptionExpr: `dbCaption(frame, dataTable('db'), dataTable('guides', ${i}, 'text'))`,
            prompt: step.prompt ?? step.guide,
            ...(i === 0 ? { sliders, add: [...board(), ...extras] } : step.sliders ? { sliders: step.sliders } : {}),
        })),
    };
}

// ── Scene 4 · Concurrency anomalies ──────────────────────────────────────────
const MD_ANOMALIES = `### What goes wrong without isolation

Each scenario is two (or three) short transactions and a **schedule**: the order in which their statements reach the database. Here the engine provides **no isolation at all** — reads see the newest value even if it is uncommitted, and writes overwrite each other — so every interleaving problem shows up.

| Anomaly | What happens |
|---|---|
| **Dirty write** | A transaction overwrites another's **uncommitted** write. Rollback no longer has a clean "before" value, and rows written together end up mixed. |
| **Lost update** | Two read-modify-writes of the same row; the later commit erases the earlier, already **committed** one. |
| **Dirty read** | A transaction uses data that another transaction wrote and later rolled back. |
| **Non-repeatable read** | Reading the same row twice in one transaction gives two values. |
| **Read skew** | Two reads of related rows come from two different database states. |
| **Phantom read** | Re-running the same query returns a new row. |
| **Write skew** | Two transactions each check a rule, then update *different* rows; together they break the rule. |

**The board.** *Sessions* (top) shows each transaction's statements: blue ran, **white** is running now, amber is waiting, green committed, red aborted, magenta caused an anomaly. *Storage* (right) shows every version of every row. *Conflict graph* records, for committed transactions, who must come before whom.

**Edit the schedule.** The *Schedule* slider is a row of 12 slots. Hover a cell and set it to 1, 2 or 3 to decide which transaction sends its next statement. Leftover statements run in turn after the last slot. Change the order and watch whether the anomaly survives.

> The ground truth is the **serializability check** at the end: does *any* one-at-a-time order of the same transactions produce the same reads and the same final table? An anomaly is precisely a schedule where the answer is no.`;

const anomalySteps = [
    { id: 'predict', title: 'Predict', scenario: 'lost-update',
        guide: 'Two withdrawals of 30 and 20 from A = 100 run interleaved. **Predict the final balance**, then press ▶ or step with ▷.',
        prompt: 'Ask the learner to predict the final balance of A after two concurrent withdrawals of 30 and 20 from 100, interleaved R1 R2 W1 W2. Do not reveal the answer until they commit to a number.' },
    { id: 'lost-update', title: 'Lost update', scenario: 'lost-update',
        guide: 'Both read A = 100. T1 writes 70 and commits; T2 then writes 80 from its **stale** read and erases the committed withdrawal.',
        prompt: 'Explain the lost update using the live versions: both transactions read 100, T1 commits 70, T2 writes 80 computed from its stale read. Stress that T2 overwrote COMMITTED data, so this is not a dirty write. Ask which single schedule change would fix it.' },
    { id: 'dirty-write', title: 'Dirty write', scenario: 'dirty-write',
        guide: 'Alice and Bob buy the same car. Bob overwrites Alice\'s **uncommitted** listing; the listing ends up Bob\'s and the invoice Alice\'s.',
        prompt: 'Explain the dirty write: T2 overwrote a value T1 had not committed. Contrast with the lost update (which overwrites committed data via a stale read). Explain why every isolation level, even Read Uncommitted, forbids dirty writes: rollback and multi-row consistency would be meaningless. Write locks held to commit prevent it.' },
    { id: 'dirty-read', title: 'Dirty read', scenario: 'dirty-read',
        guide: 'T2 copies A into a report while T1\'s debit is **uncommitted**. Then T1 rolls back.',
        prompt: 'Explain the dirty read: T2 reads an uncommitted version, T1 rolls back, so T2 committed a value that never existed in any committed state.' },
    { id: 'non-repeatable-read', title: 'Non-repeatable read', scenario: 'non-repeatable-read',
        guide: 'T1 reads A twice. T2 commits a change in between, so T1\'s two reads **disagree**.',
        prompt: 'Explain the non-repeatable read and when it matters: a report or a decision that reads the same row twice and must see one consistent value.' },
    { id: 'read-skew', title: 'Read skew', scenario: 'read-skew',
        guide: 'An auditor sums A + B while a transfer of 20 commits between its two reads. The money appears to **grow**.',
        prompt: 'Explain read skew: each individual read was of committed data, but the two reads come from different database states, so the auditor sees 120 instead of 100. No dirty read and no non-repeatable read happened.' },
    { id: 'phantom', title: 'Phantom read', scenario: 'phantom',
        guide: 'T1 totals the orders twice. T2 **inserts** a new order in between: no existing row changed, yet the total did.',
        prompt: 'Explain the phantom: row-level locks on existing rows cannot stop an insert of a new row matching the predicate. Ask what would have to be locked instead (the predicate or the index range).' },
    { id: 'write-skew', title: 'Write skew', scenario: 'write-skew',
        guide: 'Each doctor checks "two on call", sees 2, and goes off call. They wrote **different rows** — and now nobody is on call.',
        prompt: 'Explain write skew: no row was written by both transactions, so no lost update or dirty write; each check was valid on its own snapshot, but the combination breaks the invariant. Point to the rw–rw cycle in the conflict graph.' },
    { id: 'your-schedule', title: 'Edit the schedule', scenario: 'lost-update', order: [1, 1, 1, 2, 2, 2],
        guide: 'This schedule runs T1 to completion, then T2: **serial**. Pick any scenario, then edit the Schedule cells to find the interleavings that break it.',
        prompt: 'Coach the learner to find, for the selected scenario, the minimal reordering that creates or removes the anomaly. Use the conflict graph and the serializability verdict to justify each answer.' },
];

// ── Scene 5 · Isolation levels ───────────────────────────────────────────────
const MD_ISOLATION = `### Isolation levels: replay the same schedule

An isolation level is a promise about **which anomalies cannot happen**. This scene replays the **same anomaly schedules** from the previous scene — what changes is the database underneath. Pick an anomaly, keep its schedule, and move **Isolation level** and **Database**: the same statements now meet locks, snapshots or aborts. Two extra scenarios show the lost update fixed in the query itself (\`FOR UPDATE\`, atomic \`UPDATE\`).

| Level (ANSI / textbook) | Prevents | Typical mechanism |
|---|---|---|
| Read Uncommitted | dirty writes | exclusive write locks held to commit |
| Read Committed | + dirty reads | readers wait for, or skip, uncommitted versions |
| Repeatable Read | + non-repeatable reads, lost updates | shared locks held to commit |
| Snapshot | reads from one consistent snapshot | MVCC + first-updater-wins |
| Serializable | everything | predicate locks, or SSI |

**Same names, different products.** The **Database** slider replays the schedule under a model of each product's documented behaviour:

- **PostgreSQL** never shows uncommitted data. *Repeatable Read* is snapshot isolation: a concurrent update aborts with \`40001\`, but **write skew is allowed**. *Serializable* is SSI: it aborts the write skew too.
- **MySQL / InnoDB** *Repeatable Read* (the default) reads a snapshot, but \`UPDATE\` acts on the newest row without a conflict check, so the read-modify-write **lost update succeeds silently**. Use \`SELECT … FOR UPDATE\` or \`SET v = v - 30\`.
- **SQLite** is always serializable: one writer at a time, and a reader whose snapshot is stale cannot become the writer (\`SQLITE_BUSY_SNAPSHOT\`).
- **MongoDB** transactions read a snapshot and abort immediately on a write conflict (\`TransientTransactionError\`); write skew is possible.

The **isolation matrix** (right) runs every anomaly scenario at every level for the selected database. Nothing in it is typed in: each cell is the result of running the engine. ✗ = anomaly happened · *abort* / *deadlock* = prevented by aborting one transaction · *waits* = prevented by blocking · ✓ = prevented without either.

> These are models of documented behaviour, simplified to single-row values and statement-level ticks. They reproduce each product's visible outcome for these schedules, not its internals.`;

const isoSteps = [
    { id: 'ansi', title: 'Same schedule, stronger levels', scenario: 'lost-update', level: 1, profile: 0,
        guide: 'Textbook locking at **Read Committed**: the lost update still happens. Move **Isolation level** to Repeatable Read and replay.',
        prompt: 'Have the learner raise the isolation level one notch at a time on the lost-update schedule and explain what changed: at RR shared locks are held, so the two upgrades deadlock and one transaction aborts.' },
    { id: 'dirty', title: 'Read Committed: wait for the writer', scenario: 'dirty-read', level: 1, profile: 0,
        guide: 'With locking Read Committed, T2\'s read **waits** for T1\'s exclusive lock and then sees the committed value.',
        prompt: 'Contrast the locking way (reader waits) with the MVCC way (reader sees the last committed version without waiting). Switch Database to PostgreSQL to show the MVCC behaviour.' },
    { id: 'phantom', title: 'Repeatable Read lets phantoms in', scenario: 'phantom', level: 2, profile: 0,
        guide: 'Row locks protect existing rows, not **new** ones. Raise the level to Serializable: the insert waits on a predicate lock.',
        prompt: 'Explain predicate (range / next-key) locks and why Repeatable Read under locking still admits phantoms. Then show that a snapshot (level Snapshot) hides the phantom without any lock.' },
    { id: 'pg-write-skew', title: 'PostgreSQL: snapshot ≠ serializable', scenario: 'write-skew', level: 2, profile: 1,
        guide: 'PostgreSQL **Repeatable Read** is snapshot isolation: both doctors leave. Switch the level to **Serializable**.',
        prompt: 'Explain why snapshot isolation allows write skew (no write-write conflict) and how SSI detects the rw-antidependency cycle and aborts one transaction with SQLSTATE 40001. Emphasise that the application must retry.' },
    { id: 'mysql-lost-update', title: 'InnoDB: the silent lost update', scenario: 'lost-update', level: 2, profile: 2,
        guide: 'MySQL\'s default **Repeatable Read**: reads come from a snapshot, but UPDATE writes on the newest row. The withdrawal is **lost with no error**.',
        prompt: 'Contrast with PostgreSQL Repeatable Read, which aborts the same schedule. Ask the learner how to fix it in MySQL without changing the isolation level.' },
    { id: 'fixes', title: 'Fix it in the query', scenario: 'for-update', level: 2, profile: 2,
        guide: '**SELECT … FOR UPDATE** locks the row at read time, so T2 waits and reads 70. Also try *Lost update fixed with an atomic UPDATE*.',
        prompt: 'Compare the three fixes for the lost update: a locking read (pessimistic), an atomic UPDATE computed by the database, and a higher isolation level with retries. Discuss when each is appropriate.' },
    { id: 'sqlite-mongo', title: 'SQLite and MongoDB', scenario: 'write-skew', level: 2, profile: 3,
        guide: '**SQLite** serializes writers, so the second doctor\'s snapshot is stale and it cannot write. Switch Database to **MongoDB**: snapshot reads, and write skew is back.',
        prompt: 'Explain SQLite\'s single-writer design (serializable by construction, low write concurrency) and MongoDB\'s snapshot transactions (no isolation levels; write conflicts abort immediately). Neither uses the ANSI level names meaningfully.' },
    { id: 'matrix', title: 'Read the isolation matrix', scenario: 'write-skew', level: 4, profile: 0,
        guide: 'Each cell ran the engine. Flip **Database** and compare the matrices: where do products differ from the textbook?',
        prompt: 'Walk through the computed isolation matrix for the selected database. Ask the learner to explain two cells that surprise them, using the board to replay those cases.' },
];

// ── Scene 6 · Concurrency control mechanisms ─────────────────────────────────
const MD_CC = `### Concurrency control: wait, abort, or keep versions

Isolation says *what* is promised; concurrency control is *how*. Every mechanism below gives serializable results (except plain snapshot isolation), but they pay in different currencies.

| Mechanism | Conflicts are handled by | Costs |
|---|---|---|
| **Two-phase locking** | waiting for locks; deadlocks abort a victim | blocking, deadlocks, readers block writers |
| **Optimistic (OCC)** | validating at commit; stale readers abort | wasted work under contention |
| **MVCC · snapshot isolation** | versions for readers; first-updater-wins for writers | write skew, old versions to clean up |
| **MVCC · SSI** | SI + dependency tracking; cycles abort at commit | some false-positive aborts |
| **Single writer** | one writer at a time | no write concurrency at all |

Turn on **Retry aborted transactions** to see what an application does after \`40001\` / \`40P01\`: run the whole transaction again (see \`retry.py\` in the **Code** tab).

**In real systems**

- **PostgreSQL** — MVCC with tuple versions in the heap (old ones removed by \`VACUUM\`); row locks for writers; SSI at Serializable; deadlock detector aborts a victim.
- **MySQL / InnoDB** — MVCC through the undo log; record and **next-key (gap) locks** for locking reads and Serializable; a deadlock detector rolls back the smaller transaction.
- **SQLite** — a database-level write lock; in WAL mode readers keep a snapshot and never block the writer.
- **MongoDB (WiredTiger)** — document-level MVCC; a conflicting write aborts with \`WriteConflict\` and the driver's \`withTransaction\` retries.
- **DynamoDB** — no interactive transactions. Optimistic control is a **conditional write** on a version attribute; \`TransactWriteItems\` applies up to 100 actions atomically or cancels them all.
- **Redis** — commands run one at a time; \`WATCH\` + \`MULTI/EXEC\` is optimistic (EXEC fails if a watched key changed), and there is no rollback.

The **mechanism matrix** (right) runs the contention scenarios under every mechanism with retries on: *ticks to finish · aborts · wait ticks*, or ✗ when an anomaly survived.`;

const ccSteps = [
    { id: '2pl', title: 'Two-phase locking and deadlock', scenario: 'deadlock', mechanism: 0, retry: 1,
        guide: 'T1 and T2 lock A and B in **opposite order**. Watch the lock table fill, the wait-for cycle form, and one transaction become the victim.',
        prompt: 'Explain strict two-phase locking: locks grow until commit, then all are released. Show the deadlock in the lock table, why the lock manager must abort one transaction, and how a consistent lock order (always A before B) would avoid it.' },
    { id: 'occ', title: 'Optimistic: validate at commit', scenario: 'hot-counter', mechanism: 1, retry: 1,
        guide: 'Three increments run with **no locks**. Writes stay private (violet) until commit; a stale reader fails validation and retries.',
        prompt: 'Explain OCC read, validate and write phases. Under low contention it never waits; on a hot row most attempts are wasted. Relate to DynamoDB conditional writes and Redis WATCH.' },
    { id: 'mvcc', title: 'MVCC: readers never wait', scenario: 'read-skew', mechanism: 2, retry: 0,
        guide: 'The auditor reads A and B from **one snapshot** while the transfer commits a new version of each. No locks, no waits, no read skew.',
        prompt: 'Explain how version chains let readers see a consistent past state without blocking writers, and what that costs: old versions must be kept until no snapshot needs them (VACUUM, purge).' },
    { id: 'ssi', title: 'Snapshot vs serializable snapshot', scenario: 'write-skew', mechanism: 2, retry: 0,
        guide: 'Snapshot isolation lets the write skew through. Switch **Concurrency control** to SSI: the second commit would close a dependency cycle, so it aborts.',
        prompt: 'Compare SI and SSI on write skew. Explain the rw-antidependency (each read a row the other then wrote) and why SSI aborts at commit rather than blocking.' },
    { id: 'single', title: 'Single writer', scenario: 'lost-update', mechanism: 4, retry: 1,
        guide: 'SQLite-style: one write lock for the whole database. T2 waits for it, then finds its snapshot stale and **must restart**.',
        prompt: 'Explain why a single writer is serializable by construction and when that is the right trade-off (embedded, read-heavy, one process). Contrast write throughput with row-level locking.' },
    { id: 'tradeoffs', title: 'Compare the mechanisms', scenario: 'hot-counter', mechanism: 0, retry: 1,
        guide: 'The matrix shows **ticks · aborts · waits** per scenario and mechanism. Which mechanism would you choose for a hot counter? For read-heavy reports?',
        prompt: 'Interview drill: have the learner pick a mechanism for (a) a hot counter, (b) long read-only reports alongside writes, (c) rare conflicts at high throughput, and justify the choice with the matrix and the board.' },
];

// Right of the storage block (which ends at x = 22), leaving room for the matrix row labels.
const MATRIX_ORIGIN = [32, -6, 0];
const LEVEL_LABELS = ['RU', 'RC', 'RR', 'Snap', 'SER'];
const MECH_LABELS = ['2PL', 'OCC', 'SI', 'SSI', '1-writer'];

export const SCENES = [
    () => txScene({
        id: 'anomalies', title: 'Concurrency Anomalies',
        description: 'Interleave two transactions with no isolation and watch each classic anomaly happen.',
        markdown: MD_ANOMALIES,
        prompt: 'You are a database-systems mentor. The learner sees transactions interleaving with no isolation. Ground every claim in the live state (versions, conflict graph, serializability verdict). Ask the learner to predict before revealing. Be precise about the difference between the anomalies, and flag that this is a simplified teaching model.',
        trace: "dbTrace(scenario, 'none', order, 0)",
        sliders: load(PICK.anomalies, 'lost-update'),
        steps: anomalySteps.map(st => ({ ...st, sliders: load(PICK.anomalies, st.scenario).map(s => (s.id === 'order' && st.order ? { ...s, default: st.order.concat(Array(ORDER_SLOTS - st.order.length).fill(0)) } : s)) })),
    }),
    () => txScene({
        id: 'isolation-levels', title: 'Isolation Levels',
        description: 'Replay the same schedule at each isolation level, under textbook locking and modelled PostgreSQL, MySQL, SQLite and MongoDB.',
        markdown: MD_ISOLATION,
        prompt: 'You are a database-systems mentor preparing the learner for senior system-design interviews. Use the live board and the computed isolation matrix. Distinguish ANSI definitions from product behaviour precisely (PostgreSQL RR = snapshot isolation, InnoDB RR lost update, SQLite single writer, MongoDB snapshot transactions). Always say these are models of documented behaviour.',
        trace: 'dbLevelTrace(scenario, profile, level, order, 0)',
        sliders: [...load(PICK.isolation, 'lost-update'), S.level(1), S.profile(0)],
        steps: isoSteps.map(st => ({ ...st, sliders: [...load(PICK.isolation, st.scenario), S.level(st.level), S.profile(st.profile)] })),
        extras: [matrix({ id: 'iso-matrix', origin: MATRIX_ORIGIN, rows: 7, cols: 5, valueExpr: 'dbMatrix(profile, row, col)', textExpr: 'dbMatrixText(profile, row, col)',
            rowLabelExpr: 'dbMatrixRow(row)', colLabels: LEVEL_LABELS, label: 'Isolation matrix (computed) · selected database',
            prompt: 'Explain this computed isolation matrix for the selected database: each cell ran the anomaly scenario (row) at the isolation level (column). Explain how each cell was prevented or why the anomaly happened.' })],
        views: [{ name: 'Isolation matrix', position: [34, -2, 29], target: [34, -2, 0] }, { name: 'Everything', position: [13, -7, 66], target: [13, -7, 0] }],
        range: [[-22, 46], [-17, 13], [-6, 6]],
    }),
    () => txScene({
        id: 'concurrency-control', title: 'Concurrency Control Mechanisms',
        description: 'Two-phase locking, optimistic validation, MVCC snapshots, SSI and a single writer on the same transactions.',
        markdown: MD_CC,
        prompt: 'You are a database-systems mentor. Compare concurrency-control mechanisms using the live lock table, version chains, waits, aborts and retries. Push the learner to reason about trade-offs under contention, and map each mechanism to real systems (PostgreSQL, InnoDB, SQLite, MongoDB, DynamoDB, Redis) without overstating the model.',
        trace: 'dbMechTrace(scenario, mechanism, order, retry)',
        sliders: [...load(PICK.cc, 'deadlock'), S.mechanism(0), S.retry(1)],
        steps: ccSteps.map(st => ({ ...st, sliders: [...load(PICK.cc, st.scenario), S.mechanism(st.mechanism), S.retry(st.retry)] })),
        extras: [matrix({ id: 'cc-matrix', origin: MATRIX_ORIGIN, rows: 5, cols: 5, valueExpr: 'dbMechMatrix(row, col)', textExpr: 'dbMechMatrixText(row, col)',
            rowLabelExpr: 'dbMechMatrixRow(row)', colLabels: MECH_LABELS, label: 'Mechanisms (computed, retries on): ticks · aborts · waits', cellSize: 2.9,
            prompt: 'Explain this computed comparison: each cell ran the scenario (row) under the mechanism (column) with retries. Relate ticks, aborts and waits to the mechanism, and explain any ✗.' })],
        views: [{ name: 'Mechanism matrix', position: [37, -1, 26], target: [37, -1, 0] }, { name: 'Everything', position: [14, -7, 68], target: [14, -7, 0] }],
        range: [[-22, 48], [-17, 13], [-6, 6]],
    }),
];
