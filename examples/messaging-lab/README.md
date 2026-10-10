# Messaging lab samples

Producer and consumer code shown in the **Messaging Systems Laboratory** lesson
(`scenes/draft/messaging-systems-lab.json`). Each file uses the system's real client
API. AlgeBench only displays them; the browser does not run Python or contact a broker.

| System | Client | Files |
| --- | --- | --- |
| Apache Kafka | `confluent-kafka` | `kafka/producer.py`, `kafka/consumer.py` |
| RabbitMQ | `pika` (AMQP 0-9-1) | `rabbitmq/producer.py`, `rabbitmq/consumer.py` |
| Amazon SQS | `boto3` | `sqs/producer.py`, `sqs/consumer.py` |

`common.py` holds `charge()`, the deliberately non-idempotent side effect whose
repeats the lab counts as duplicates.

## How the lesson links code to the simulation

The lesson generator (`scripts/messaging_lab/build_lesson.mjs`) finds lines by their
text, such as `consumer.commit(`, `ch.basic_ack(` or `sqs.delete_message(`. It
highlights a line on every tick where the simulation performs that operation.
Selecting one of these lines in the Code tab focuses the architecture block it touches.
On the consumer's `charge(order)` and acknowledgement lines, **Crash at this line**
re-runs the deterministic simulation with the consumer dying at that point.

## What the simulation simplifies

- Ticks are scheduler steps, not seconds. A consumer spends `serviceTicks` ticks per message.
- Kafka: the partition is `key index % partitions` (the client actually uses murmur2). The
  model uses eager rebalancing with the RangeAssignor, and retention deletes single
  records (brokers delete whole segments). The dead-letter topic is an application
  convention, not a broker feature.
- RabbitMQ: a single quorum queue with `x-delivery-limit`. Requeued deliveries go back to
  the head in their original order. Publisher confirms are not shown.
- SQS: a standard queue, delivered in arrival order. Real standard queues give only
  best-effort ordering and may occasionally deliver duplicates even without failures.
