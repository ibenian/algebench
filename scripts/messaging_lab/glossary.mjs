// Hoverable term definitions for the messaging lab.
export const GLOSSARY = {
    'Partition': { markdown: 'An ordered, append-only log that is a shard of a Kafka topic. Order is guaranteed only within a partition, and a consumer group assigns each partition to at most one member.' },
    'Offset': { aliases: ['offsets'], markdown: 'A record\'s position in a partition. A consumer group commits the *next* offset to read. Committing does not delete anything.' },
    'Consumer group': { aliases: ['consumer groups'], markdown: 'Kafka consumers sharing a `group.id`. Partitions are divided among the members, and each group keeps its own committed offsets, so every group reads the whole topic independently.' },
    'Rebalance': { markdown: 'The group coordinator reassigning partitions when members join or leave or miss heartbeats. With the eager protocol, all members pause while it happens.' },
    'Session timeout': { markdown: 'How long Kafka waits for heartbeats before declaring a consumer dead and rebalancing. A shorter timeout detects failures faster but evicts slow or GC-paused consumers.' },
    'Prefetch': { aliases: ['basic.qos', 'prefetch window'], markdown: 'RabbitMQ\'s per-channel cap on unacknowledged deliveries (`basic_qos(prefetch_count=…)`). It is the broker-to-consumer backpressure mechanism.' },
    'Unacked': { aliases: ['unacknowledged'], markdown: 'A RabbitMQ delivery handed to a consumer but not yet acked. The queue still owns it and requeues it if the channel closes.' },
    'Exchange': { markdown: 'A RabbitMQ routing component. Producers publish to exchanges, never directly to queues; bindings decide which queues receive a copy.' },
    'Visibility timeout': { markdown: 'How long an SQS message stays hidden after `ReceiveMessage`. If it is not deleted in time, it becomes visible and can be received again, even if the first consumer is still working on it.' },
    'Receipt handle': { markdown: 'A token returned with each SQS receive. `DeleteMessage` needs the most recent handle; an older handle "succeeds" without deleting anything.' },
    'Dead-letter queue': { aliases: ['DLQ', 'dead-letter', 'DLT'], markdown: 'Where messages go after repeated failures, so they stop blocking or looping. SQS (redrive policy) and RabbitMQ (dead-letter exchange) support this natively; in Kafka it is an application convention (a dead-letter topic).' },
    'At-least-once': { markdown: 'A delivery guarantee where nothing is lost but anything may be repeated. A crash between the side effect and the acknowledgement causes a duplicate.' },
    'Idempotent': { aliases: ['idempotency'], markdown: 'Safe to apply more than once with the same result. It is the standard remedy for at-least-once redelivery, for example via a processed-ids table or a unique business key.' },
    'Retention': { markdown: 'How long a log keeps records regardless of consumption (time- or size-based). It is what makes replay possible, and it ignores whether consumers have kept up.' },
    'Consumer lag': { aliases: ['lag'], markdown: 'For Kafka: log-end offset minus committed offset, summed over partitions. It is not the same as a queue\'s depth, because consumed records remain stored.' },
};
