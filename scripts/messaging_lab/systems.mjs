// Per-system views for the messaging lab: code files, architecture DAG, metrics.
// Each entry mirrors an adapter in static/domains/messaging/index.js.
import { T, TRACED, refs, stateColorMap, metricsTensor, consumerArray, messageArray } from './util.mjs';

const CRASH_ACTIONS = (receive, process, ack, shutdown) => [
    { at: receive, label: '💥 kill -9 at next tick', set: { crashPoint: 3, crashTick: 'frame + 1' } },
    { at: process, label: '💥 Crash here: received, not processed', set: { crashPoint: 1, crashTick: 'frame + 1' } },
    { at: ack, label: '💥 Crash here: processed, not acknowledged', set: { crashPoint: 2, crashTick: 'frame + 1' } },
    { at: shutdown, label: '🛑 Graceful shutdown at next tick', set: { crashPoint: 4, crashTick: 'frame + 1' } },
];
const W = 13.6; // column width in scene units

function group(id, label, position, height, extra = {}) {
    return { id, label, kind: 'group', position, size: [W, height, 0.12], childElevation: 0.22, opacity: 0.16, ...extra };
}
function producers(system, produceLine) {
    return { id: 'producers', label: 'Producers', kind: 'client', position: [0, 8.7, 0], size: [13, 1.6, 0.18],
        textExpr: `concat(${T(system, 'm_published')}, ' stored · ', ${T(system, 'm_produced')} - ${T(system, 'm_published')}, ' waiting in client buffer')`,
        ports: [{ id: 'out', side: 'bottom', offset: 0 }], ...refs(produceLine) };
}
function consumers(system, label, ports, codeRefs) {
    return { id: 'consumers', label, kind: 'worker', position: [0, -7.25, 0], size: [13, 2.7, 0.18],
        ports, elements: [consumerArray(system, system + '-consumers')], ...refs(...codeRefs) };
}
const wire = (id, from, to, activeExpr, extra = {}) => ({ id, from: { block: from[0], port: from[1] }, to: { block: to[0], port: to[1] }, activeExpr, ...extra });

export const SYSTEMS = {
    kafka: {
        label: 'Apache Kafka', tagline: 'partitioned, retained log · consumers own positions', color: '#7fb3d5',
        code: [
            { id: 'kafka-producer', ops: { send: 'producer.produce("orders"', outage: '"delivery.timeout.ms"', recover: 'producer.poll(0)' } },
            { id: 'kafka-consumer', ops: {
                poll: 'consumer.consume(', process: 'handle(msg)', commit: 'consumer.commit(', fail: 'except ValueError:', dlt: 'dlt.produce(',
                joinGroup: 'def on_revoke', rebalance: 'def on_assign', shutdown: 'consumer.close()', replay: 'consumer.assign(', restart: 'consumer.subscribe(',
            }, actions: CRASH_ACTIONS('consumer.consume(', 'handle(msg)', 'consumer.commit(', 'consumer.close()') },
        ],
        metrics: [['Lag', 'm_lag'], ['Retained', 'm_retained'], ['Fetched', 'm_inflight'], ['Committed', 'm_completed'], ['Dupes', 'm_duplicates'], ['DLT', 'm_dlqSize']],
        dag(prefix) {
            const s = 'kafka';
            const grid = {
                type: 'tensor', id: prefix + 'kafka-grid', shape: [6, 14], origin: [-4.5, -2.75, 0.25], cellSize: 0.76, gap: 0.04, plane: 'xy',
                valueExpr: `mqCode(${T(s, 'life')}, mqGrid(${T(s, 'gridIds')}, row, col), ${TRACED})`,
                textExpr: `mqGridText(${T(s, 'gridIds')}, ${T(s, 'gridOffsets')}, row, col)`, textColor: 'auto',
                colorMap: stateColorMap(), colorDomain: [0, 8], opacity: 0.95, shader: { ignorePlaneOpacity: true },
                axes: [{ labelExpr: `arrayAt(${T(s, 'gridRows')}, row)`, color: '#b8cee0' }, {}], axisLabels: 'plane',
                label: 'Partition logs (offset:id)',
                prompt: 'Explain this partition × offset view: which records are retained, which are fetched, which are committed, and why committed records are still in the log.',
            };
            return {
                type: 'system_dag', id: prefix + 'kafka', label: 'Apache Kafka', pipeRadius: 0.05,
                blocks: [
                    producers(s, ['kafka-producer', 'producer.produce("orders"']),
                    group('cluster', 'Apache Kafka · partitioned retained log', [0, 1.4, 0], 11.4, {
                        textExpr: T(s, 'settings'),
                        ports: [{ id: 'in', side: 'top', offset: 0 }, { id: 'out', side: 'bottom', offset: -0.74 }, { id: 'commit', side: 'bottom', offset: 0.044 }, { id: 'dlt', side: 'bottom', offset: 0.67 }],
                        blocks: [
                            { id: 'topic', label: 'topic orders · partition × offset', kind: 'broker', position: [0, 1.0, 0.02], size: [13, 6.9, 0.18],
                                ports: [{ id: 'in', side: 'top', offset: 0 }, { id: 'out', side: 'bottom', offset: -0.77 }],
                                elements: [grid], ...refs(['kafka-producer', 'producer.produce("orders"'], ['kafka-consumer', 'consumer.consume(']) },
                            { id: 'offsets', label: '__consumer_offsets', kind: 'store', position: [0.3, -4.0, 0.02], size: [3.8, 1.9, 0.18],
                                textExpr: `concat('billing ', mqList(${T(s, 'committed')}, 'p'))`, ports: [{ id: 'in', side: 'bottom', offset: 0 }],
                                ...refs(['kafka-consumer', 'consumer.commit(']) },
                            { id: 'dlt', label: 'orders.DLT', kind: 'store', position: [4.55, -4.0, 0.02], size: [3.9, 1.9, 0.18],
                                textExpr: `concat(arrayCount(${T(s, 'dlt')}), ' dead-lettered')`, ports: [{ id: 'in', side: 'bottom', offset: 0 }],
                                ...refs(['kafka-consumer', 'dlt.produce(']) },
                        ],
                        connections: [
                            wire('k-append', ['cluster', 'in'], ['topic', 'in'], T(s, 'flow_append')),
                            wire('k-fetch', ['topic', 'out'], ['cluster', 'out'], T(s, 'flow_poll')),
                            wire('k-commit', ['cluster', 'commit'], ['offsets', 'in'], T(s, 'flow_commit'), { activeColor: '#7fd1a0' }),
                            wire('k-dlt', ['cluster', 'dlt'], ['dlt', 'in'], T(s, 'flow_dlt'), { activeColor: '#d58ac0' }),
                        ],
                    }),
                    consumers(s, 'Consumer group billing', [{ id: 'in', side: 'top', offset: -0.77 }, { id: 'commit', side: 'top', offset: 0.046 }, { id: 'dlt', side: 'top', offset: 0.7 }],
                        [['kafka-consumer', 'consumer.subscribe('], ['kafka-consumer', 'def on_assign'], ['kafka-consumer', 'def on_revoke']]),
                ],
                connections: [
                    wire('produce', ['producers', 'out'], ['cluster', 'in'], T(s, 'flow_append'), { label: 'produce(key)' }),
                    wire('poll', ['cluster', 'out'], ['consumers', 'in'], T(s, 'flow_poll'), { label: 'poll()' }),
                    wire('commit', ['consumers', 'commit'], ['cluster', 'commit'], T(s, 'flow_commit'), { label: 'commit', activeColor: '#7fd1a0' }),
                    wire('to-dlt', ['consumers', 'dlt'], ['cluster', 'dlt'], T(s, 'flow_dlt'), { activeColor: '#d58ac0' }),
                ],
            };
        },
    },

    rabbitmq: {
        label: 'RabbitMQ', tagline: 'exchange → queue · broker pushes, consumer acks', color: '#f0a868',
        code: [
            { id: 'rabbitmq-producer', ops: { publish: 'channel.basic_publish(', send: 'body=encode(', outage: 'channel.confirm_delivery()' } },
            { id: 'rabbitmq-consumer', ops: {
                deliver: 'def on_message', process: 'charge(order)', ack: 'ch.basic_ack(', nack: 'ch.basic_nack(', dlx: '"x-delivery-limit"',
                requeue: 'connection.close()', restart: 'channel.basic_consume(', shutdown: 'channel.stop_consuming()',
            }, actions: CRASH_ACTIONS('def on_message', 'charge(order)', 'ch.basic_ack(', 'channel.stop_consuming()') },
        ],
        metrics: [['Ready', 'm_ready'], ['Unacked', 'm_unacked'], ['Acked', 'm_completed'], ['Redelivered', 'm_redeliveries'], ['Dupes', 'm_duplicates'], ['DLQ', 'm_dlqSize']],
        dag(prefix) {
            const s = 'rabbitmq';
            const unacked = {
                type: 'tensor', id: prefix + 'rabbit-unacked', shape: [6, 10], origin: [-3.2, -2.55, 0.25], cellSize: 0.5, gap: 0.04, plane: 'xy',
                valueExpr: `mqCode(${T(s, 'life')}, mqGrid(${T(s, 'unackedGrid')}, row, col), ${TRACED})`,
                textExpr: `mqGrid(${T(s, 'unackedGrid')}, row, col)`, textColor: 'auto',
                colorMap: stateColorMap(), colorDomain: [0, 8], opacity: 0.95, shader: { ignorePlaneOpacity: true },
                axes: [{ labelExpr: `arrayAt(${T(s, 'unackedRows')}, row)`, color: '#b8cee0' }, {}], axisLabels: 'plane',
                prompt: 'Explain the unacknowledged deliveries per consumer channel: why they still belong to the queue, how prefetch bounds them, and what happens to them if the channel closes.',
            };
            return {
                type: 'system_dag', id: prefix + 'rabbitmq', label: 'RabbitMQ', pipeRadius: 0.05,
                blocks: [
                    producers(s, ['rabbitmq-producer', 'channel.basic_publish(']),
                    group('broker', 'RabbitMQ · exchange → queue, push + ack', [0, 1.4, 0], 11.4, {
                        textExpr: T(s, 'settings'),
                        ports: [{ id: 'in', side: 'top', offset: 0 }, { id: 'out', side: 'bottom', offset: -0.74 }, { id: 'ack', side: 'bottom', offset: 0.044 }],
                        blocks: [
                            { id: 'exchange', label: 'exchange orders (direct)', kind: 'gateway', position: [-2.6, 3.4, 0.02], size: [7.6, 1.7, 0.18],
                                text: 'routes by binding key', ports: [{ id: 'in', side: 'top', offset: 0.684 }, { id: 'out', side: 'bottom', offset: 0 }],
                                ...refs(['rabbitmq-producer', 'channel.exchange_declare(']) },
                            { id: 'dlq', label: 'billing.dlq', kind: 'store', position: [4.4, 3.4, 0.02], size: [4.0, 1.7, 0.18],
                                textExpr: `concat(arrayCount(${T(s, 'dlqIds')}), ' via orders.dlx')`, ports: [{ id: 'in', side: 'bottom', offset: 0 }],
                                ...refs(['rabbitmq-consumer', '"x-dead-letter-exchange"']) },
                            { id: 'queue', label: 'quorum queue billing', kind: 'broker', position: [0, -1.4, 0.02], size: [13, 6.0, 0.18],
                                ports: [{ id: 'in', side: 'top', offset: -0.4 }, { id: 'dlx', side: 'top', offset: 0.677 }, { id: 'out', side: 'bottom', offset: -0.77 }, { id: 'ack', side: 'bottom', offset: 0.046 }],
                                elements: [
                                    messageArray(s, 'ready', prefix + 'rabbit-ready', [-5.7, 1.45, 0.25], { label: 'ready (FIFO)', labelPosition: [-6.2, 2.1, 0.3],
                                        prompt: 'Explain the ready messages: the queue owns them and will push them to consumers with free prefetch credit.' }),
                                    unacked,
                                ],
                                ...refs(['rabbitmq-consumer', 'channel.queue_declare(queue="billing"'], ['rabbitmq-consumer', 'channel.basic_qos(']) },
                        ],
                        connections: [
                            wire('r-publish', ['broker', 'in'], ['exchange', 'in'], T(s, 'flow_publish')),
                            wire('r-route', ['exchange', 'out'], ['queue', 'in'], T(s, 'flow_route'), { label: 'orders.created' }),
                            wire('r-deliver', ['queue', 'out'], ['broker', 'out'], T(s, 'flow_deliver')),
                            wire('r-ack', ['broker', 'ack'], ['queue', 'ack'], `${T(s, 'flow_ack')} + ${T(s, 'flow_requeue')}`, { activeColor: '#7fd1a0' }),
                            wire('r-dlx', ['queue', 'dlx'], ['dlq', 'in'], T(s, 'flow_dlx'), { activeColor: '#d58ac0' }),
                        ],
                    }),
                    consumers(s, 'Consumers (channels)', [{ id: 'in', side: 'top', offset: -0.77 }, { id: 'ack', side: 'top', offset: 0.046 }],
                        [['rabbitmq-consumer', 'channel.basic_consume('], ['rabbitmq-consumer', 'def on_message']]),
                ],
                connections: [
                    wire('publish', ['producers', 'out'], ['broker', 'in'], T(s, 'flow_publish'), { label: 'basic_publish' }),
                    wire('push', ['broker', 'out'], ['consumers', 'in'], T(s, 'flow_deliver'), { label: 'push ≤ prefetch' }),
                    wire('ack', ['consumers', 'ack'], ['broker', 'ack'], T(s, 'flow_ack'), { label: 'basic_ack', activeColor: '#7fd1a0' }),
                ],
            };
        },
    },

    sqs: {
        label: 'Amazon SQS', tagline: 'managed queue · pull, hide, delete', color: '#e6c35c',
        code: [
            { id: 'sqs-producer', ops: { sendMessage: 'sqs.send_message(', redrive: '"RedrivePolicy"' } },
            { id: 'sqs-consumer', ops: {
                receive: 'resp = sqs.receive_message(', process: 'charge(json.loads', deleteMessage: 'sqs.delete_message(', fail: 'continue  # not deleted',
                changeVisibility: 'sqs.change_message_visibility(', timeout: 'received messages are now invisible',
            }, actions: CRASH_ACTIONS('resp = sqs.receive_message(', 'charge(json.loads', 'sqs.delete_message(', 'if not running:') },
        ],
        metrics: [['Visible', 'm_visible'], ['In flight', 'm_notVisible'], ['Deleted', 'm_completed'], ['Re-received', 'm_redeliveries'], ['Dupes', 'm_duplicates'], ['DLQ', 'm_dlqSize']],
        dag(prefix) {
            const s = 'sqs';
            return {
                type: 'system_dag', id: prefix + 'sqs', label: 'Amazon SQS', pipeRadius: 0.05,
                blocks: [
                    producers(s, ['sqs-producer', 'sqs.send_message(']),
                    group('service', 'Amazon SQS · pull, hide, delete', [0, 1.4, 0], 11.4, {
                        textExpr: T(s, 'settings'),
                        ports: [{ id: 'in', side: 'top', offset: 0 }, { id: 'out', side: 'bottom', offset: -0.74 }, { id: 'del', side: 'bottom', offset: 0.044 }],
                        blocks: [
                            { id: 'queue', label: 'standard queue billing', kind: 'broker', position: [0, 1.0, 0.02], size: [13, 6.9, 0.18],
                                ports: [{ id: 'in', side: 'top', offset: 0 }, { id: 'out', side: 'bottom', offset: -0.77 }, { id: 'del', side: 'bottom', offset: 0.046 }, { id: 'dlq', side: 'bottom', offset: 0.7 }],
                                elements: [
                                    messageArray(s, 'visible', prefix + 'sqs-visible', [-5.7, 1.2, 0.25], { label: 'visible', labelPosition: [-6.2, 1.85, 0.3],
                                        prompt: 'Explain the visible messages: any consumer may receive them; receiving hides rather than removes them.' }),
                                    messageArray(s, 'inflightLabels', prefix + 'sqs-inflight', [-5.4, -1.5, 0.25], { label: 'in flight · invisible until tick', labelPosition: [-6.2, -0.85, 0.3], cellSize: 1.4, max: 8,
                                        prompt: 'Explain the in-flight messages: they are hidden for the visibility timeout and reappear unless deleted with the current receipt handle.' }),
                                ],
                                ...refs(['sqs-consumer', 'resp = sqs.receive_message('], ['sqs-producer', '"VisibilityTimeout"']) },
                            { id: 'dlq', label: 'billing-dlq (redrive)', kind: 'store', position: [4.55, -4.0, 0.02], size: [3.9, 1.9, 0.18],
                                textExpr: `concat(arrayCount(${T(s, 'dlqIds')}), ' moved')`, ports: [{ id: 'in', side: 'top', offset: 0 }],
                                ...refs(['sqs-producer', '"RedrivePolicy"']) },
                        ],
                        connections: [
                            wire('q-send', ['service', 'in'], ['queue', 'in'], T(s, 'flow_send')),
                            wire('q-receive', ['queue', 'out'], ['service', 'out'], T(s, 'flow_receive')),
                            wire('q-delete', ['service', 'del'], ['queue', 'del'], T(s, 'flow_delete'), { activeColor: '#7fd1a0' }),
                            wire('q-dlq', ['queue', 'dlq'], ['dlq', 'in'], T(s, 'flow_dlq'), { activeColor: '#d58ac0' }),
                        ],
                    }),
                    consumers(s, 'Consumers (independent pollers)', [{ id: 'in', side: 'top', offset: -0.77 }, { id: 'del', side: 'top', offset: 0.046 }],
                        [['sqs-consumer', 'resp = sqs.receive_message(']]),
                ],
                connections: [
                    wire('send', ['producers', 'out'], ['service', 'in'], T(s, 'flow_send'), { label: 'SendMessage' }),
                    wire('receive', ['service', 'out'], ['consumers', 'in'], T(s, 'flow_receive'), { label: 'ReceiveMessage' }),
                    wire('delete', ['consumers', 'del'], ['service', 'del'], T(s, 'flow_delete'), { label: 'DeleteMessage', activeColor: '#7fd1a0' }),
                ],
            };
        },
    },
};

/** Elements for one system column at `origin`: DAG, header, metrics strip. */
export function systemColumn(id, origin, prefix = '') {
    const sys = SYSTEMS[id];
    const [x, y, z] = origin;
    return [
        { ...sys.dag(prefix), origin },
        metricsTensor(id, prefix + id + '-metrics', [x - 6.15, y - 12.1, z], sys.metrics),
    ];
}
