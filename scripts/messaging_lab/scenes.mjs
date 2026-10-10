// Scene definitions for the messaging lab. Every lab scene runs the SAME workload
// through every visible system; sliders are the shared simulation inputs.
import { SYSTEMS, systemColumn } from './systems.mjs';
import { T, TRACED, slider } from './util.mjs';

export const FRAMES = 40;
const SIM_KEYS = new Set(['messages', 'producers', 'produceRate', 'keys', 'hotKey', 'consumers', 'serviceTicks', 'slowConsumer', 'slowTicks',
    'crashConsumer', 'crashTick', 'crashPoint', 'restartDelay', 'outageStart', 'outageTicks', 'poison', 'maxAttempts', 'groups', 'group2Tick', 'replayTick',
    'partitions', 'maxPollRecords', 'sessionTimeout', 'retention', 'prefetch', 'maxLength', 'overflow', 'visibilityTimeout', 'receiveBatch']);

// ── Sliders (the configuration playground) ──────────────────────────────────
export const S = {
    frame: () => slider('frame', 'Tick', 0, FRAMES, 0),
    traceMsg: (d = 1) => slider('traceMsg', 'Trace message', 1, 40, d, { valueExpr: 'mqId(traceMsg)' }),
    messages: (d = 12) => slider('messages', 'Messages produced', 1, 40, d),
    produceRate: (d = 2) => slider('produceRate', 'Production rate (msgs / tick)', 1, 6, d),
    consumers: (d = 2) => slider('consumers', 'Consumers', 1, 6, d),
    serviceTicks: (d = 2) => slider('serviceTicks', 'Processing time (ticks / msg)', 1, 8, d),
    partitions: (d = 3) => slider('partitions', 'Kafka · partitions', 1, 6, d),
    prefetch: (d = 2) => slider('prefetch', 'RabbitMQ · prefetch', 1, 10, d),
    visibilityTimeout: (d = 4) => slider('visibilityTimeout', 'SQS · visibility timeout (ticks)', 1, 12, d),
    sessionTimeout: (d = 2) => slider('sessionTimeout', 'Kafka · session timeout (ticks)', 1, 10, d),
    crashPoint: (d = 0) => slider('crashPoint', 'Crash point', 0, 4, d, { valueExpr: 'mqCrashPoint(crashPoint)' }),
    crashTick: (d = 0) => slider('crashTick', 'Crash at tick (0 = never)', 0, FRAMES, d),
    crashConsumer: (d = 1) => slider('crashConsumer', 'Crashing consumer', 1, 6, d, { valueExpr: "concat('C', crashConsumer)" }),
    restartDelay: (d = 0) => slider('restartDelay', 'Restart after (ticks, 0 = never)', 0, 20, d),
};

// ── Shared lab scene builder ─────────────────────────────────────────────────
const LAYOUTS = {
    side: ids => ids.map((id, i) => [id, [(i - (ids.length - 1) / 2) * 15.6, 0, 0]]),
    layers: ids => ids.map((id, i) => [id, [0, -i * 15, -i * 16]]),
};
function pairs(ids) { return ids.map(id => `'${SYSTEMS[id].label}', dataTable('${id}')`).join(', '); }

/** Overrides object passed to mqTrace: every simulation slider present in the scene. */
function overrides(sliderIds) {
    const keys = sliderIds.filter(id => SIM_KEYS.has(id));
    return '{' + keys.map(k => `${k}: ${k}`).join(', ') + '}';
}

export function labScene({ id, title, description, markdown, prompt, layout = 'side', systems = Object.keys(SYSTEMS), sliders, steps, workload = {} }) {
    const placed = LAYOUTS[layout](systems);
    const prefix = layout === 'side' ? '' : layout + '-';
    const elements = placed.flatMap(([sys, origin]) => systemColumn(sys, origin, prefix));
    const ids = sliders.map(s => s.id);
    const views = layout === 'side'
        ? [{ name: 'All systems', position: [0, -0.5, 30], target: [0, -0.5, 0] },
            ...placed.map(([sys, [x, y]]) => ({ name: SYSTEMS[sys].label, position: [x, y, 14], target: [x, y, 0] }))]
        : [{ name: 'Layered planes', position: [34, 6, 34], target: [0, -15, -16] },
            ...placed.map(([sys, [x, y, z]]) => ({ name: SYSTEMS[sys].label + ' plane', position: [x, y, z + 24], target: [x, y, z] }))];
    const caption = `mqCaption(frame, ${TRACED}, ${pairs(systems)})`;
    return {
        id, title, description, markdown, prompt,
        promptExpr: `mqContext(frame, ${TRACED}, ${pairs(systems)})`,
        range: layout === 'side' ? [[-24, 24], [-14, 13], [-6, 6]] : [[-10, 10], [-44, 14], [-40, 6]],
        camera: { position: views[0].position, target: views[0].target },
        views,
        stepPlayback: { slider: 'frame', intervalMs: 900, speedControl: true },
        data: { workload: [{ frames: FRAMES, messages: 12, producers: 1, keys: 4, produceRate: 2, ...workload }] },
        tableBindings: systems.map(sys => ({ table: sys, rowsExpr: `mqTrace('${sys}', dataTable('workload'), ${overrides(ids)})` })),
        elements: [],
        steps: steps.map((step, i) => ({
            id: step.id, title: step.title, description: step.description,
            ...(step.trace ? { descriptionExpr: `mqTraceCaption(frame, ${TRACED}, ${pairs(systems)})` } : step.live === false ? {} : { descriptionExpr: caption }),
            prompt: step.prompt ?? step.description,
            ...(i === 0 ? { sliders, add: elements } : step.sliders ? { sliders: step.sliders } : {}),
        })),
    };
}

// ── Scenes ───────────────────────────────────────────────────────────────────
const BASE = () => [S.frame(), S.traceMsg(), S.consumers(), S.serviceTicks(), S.produceRate(), S.messages(), S.partitions(), S.prefetch(), S.visibilityTimeout()];
const CRASH = (point, tick, restart) => [S.crashPoint(point), S.crashTick(tick), S.crashConsumer(), S.restartDelay(restart), S.sessionTimeout()];

const MARKDOWN_OVERVIEW = `### One workload, three architectures

The **same twelve keyed orders** are produced into Kafka, RabbitMQ and SQS at the same rate. Each system then serves the same consumers, which take the same time per message. Every difference you see comes from the architecture.

| | Kafka | RabbitMQ | SQS |
|---|---|---|---|
| Where a message lives | a partition's append-only log | a queue, until acked | a queue, until deleted |
| How consumers get work | they **pull** (\`poll\`) from an offset | the broker **pushes** within a prefetch window | they **pull** (\`ReceiveMessage\`); messages are hidden, not removed |
| What "done" means | commit the *next offset* | \`basic_ack\` → broker deletes | \`DeleteMessage\` with the receipt handle |
| After "done" | the record **stays** (retention) | gone | gone |

**Colours** (all panels): blue = stored · amber = delivered/in flight · yellow = processing · orange = processed but not acknowledged · green = acknowledged/committed · purple = dead-lettered · white = the traced message.

Use **Views** to zoom into one system, the **Trace message** slider to follow one id everywhere, and the **Code** tab to watch the real client calls light up as the simulation runs. Hover any block to ask the AI about it.

> This is a deterministic teaching model in scheduler ticks. Physical storage (segments, queue indexes, replication) is not drawn; the cells are logical records.`;

const MARKDOWN_CRASH = `### Consumer crash: where does the in-flight message go?

A consumer can die at three points in its loop. **Crash at this line** in the Code tab sets the same sliders.

1. **After receiving, before processing.** No side effect has happened yet. The only question is whether the message comes back, and when.
2. **After processing, before acknowledging.** The side effect *has* happened, but the system was never told. Every at-least-once system redelivers it, so the effect runs **twice**. Only an idempotent handler makes this safe.
3. **Graceful shutdown.** The consumer finishes its message, acknowledges it, and hands the rest back. Nothing is duplicated.

How each system detects the failure is architectural:

- **Kafka** — the group coordinator waits for the **session timeout**, then rebalances. The new owner resumes from the **last committed offset**.
- **RabbitMQ** — the TCP connection closes, so the broker **immediately requeues** the channel's unacked deliveries (flagged \`redelivered\`).
- **SQS** — the service is never told. The message reappears when its **visibility timeout** expires.`;

const MARKDOWN_LAYERS = `### Layered planes

The same three systems, stacked as parallel planes. Orbit to compare their timelines at a glance, or pick a plane from **Views** to inspect one. Every plane reads the same tick, the same workload and the same scenario sliders.

All controls are live in this playground. Change Kafka partitions, RabbitMQ prefetch, the SQS visibility timeout, or the crash scenario, and the whole timeline is recomputed deterministically.`;

export const SCENES = [
    () => labScene({
        id: 'lab-overview', title: 'One Workload, Three Architectures',
        description: 'Kafka, RabbitMQ and SQS consume the same keyed workload side by side.',
        markdown: MARKDOWN_OVERVIEW,
        prompt: 'You are a messaging-systems mentor. The learner sees Kafka, RabbitMQ and SQS processing the same workload. Ground every claim in the live simulation state. Contrast storage (retained log vs queue), consumption (pull from offsets vs push with prefetch vs pull with visibility timeout) and acknowledgement (commit offset vs basic_ack vs DeleteMessage). Ask the learner to predict before revealing. Flag simulation simplifications explicitly.',
        sliders: BASE(),
        steps: [
            { id: 'predict', title: 'Predict before you run', live: false,
                description: 'Before pressing play: after a consumer finishes **m1**, where is m1 in each system? Is it still stored? What exactly did the consumer send back? Then press ▶ or step with ▷.',
                prompt: 'Ask the learner to predict where m1 lives after it is processed in Kafka, RabbitMQ and SQS, and what the acknowledgement is in each. Do not reveal the answer until they commit to a prediction.' },
            { id: 'run', title: 'Run the shared timeline',
                description: 'Each tick, pipes light where data moved and the code lines run.',
                prompt: 'Explain the current tick in each system using the live state. Point out that Kafka committed records remain in the log while RabbitMQ and SQS delete acknowledged messages.' },
            { id: 'trace', title: 'Trace one message', trace: true,
                description: 'Pick a message with **Trace message**. It turns white everywhere, and its full journey is listed here.',
                prompt: 'Walk the learner through the traced message journey in each system and why the steps differ.' },
        ],
    }),
    () => labScene({
        id: 'lab-crash', title: 'Consumer Crash and Restart',
        description: 'Kill a consumer at different points in its loop and compare recovery.',
        markdown: MARKDOWN_CRASH,
        prompt: 'Teach failure semantics. Before each step, ask the learner to predict which messages are duplicated or delayed in each system. Use the live state to verify. Emphasise the window between side effect and acknowledgement, the detection mechanism of each system (session timeout, connection close, visibility timeout), and idempotency as the remedy.',
        sliders: [...BASE(), ...CRASH(1, 3, 6)],
        steps: [
            { id: 'before-processing', title: 'Crash after receive, before processing',
                description: 'C1 dies holding a message it has not processed. Watch **when** each system hands that message to someone else.',
                prompt: 'C1 crashed before processing. Compare how quickly each system recovers the message: RabbitMQ requeues at once, Kafka waits for the session timeout, SQS waits for the visibility timeout. Ask the learner to predict the tick of recovery first.' },
            { id: 'after-processing', title: 'Crash after processing, before acknowledgement',
                description: 'C1 runs the side effect, then dies before acknowledging. Count the **Dupes** metric in each system.',
                sliders: CRASH(2, 3, 6),
                prompt: 'The crash lands between side effect and acknowledgement. Every system redelivers, so the side effect runs twice. Ask how the learner would make the handler idempotent (dedupe key, transactional outbox, idempotency table).' },
            { id: 'graceful', title: 'Graceful shutdown',
                description: 'C1 receives SIGTERM: it finishes its current message, acknowledges it, and gives the rest back.',
                sliders: CRASH(4, 4, 6),
                prompt: 'Contrast graceful shutdown with a crash: Kafka leaves the group and rebalances immediately, RabbitMQ requeues unprocessed prefetched deliveries, SQS releases messages with ChangeMessageVisibility 0. No duplicates.' },
            { id: 'no-restart', title: 'kill -9, no restart',
                description: 'C1 is killed and never returns. The other consumers must absorb its work. Change the **session timeout** and **visibility timeout** to move each recovery.',
                sliders: CRASH(3, 4, 0),
                prompt: 'Have the learner experiment with sessionTimeout and visibilityTimeout to see recovery latency trade-offs: short timeouts recover faster but risk false failure detection and duplicate processing of slow consumers.' },
        ],
    }),
    () => labScene({
        id: 'lab-layers', title: 'Layered Planes Playground', layout: 'layers',
        description: 'The three systems stacked as planes: a free-form configuration playground.',
        markdown: MARKDOWN_LAYERS,
        prompt: 'This is an open playground. Offer troubleshooting exercises: propose a configuration change or failure, ask the learner to predict the effect in each system, then have them run it and compare. Adapt difficulty to their answers.',
        sliders: [...BASE(), ...CRASH(0, 0, 0)],
        steps: [
            { id: 'play', title: 'Experiment',
                description: 'All controls are live. Try a slow consumer (processing time 6) with an SQS visibility timeout of 3.',
                prompt: 'Suggest an experiment, ask for a prediction, then evaluate the learner\'s explanation against the live state.' },
        ],
    }),
];
