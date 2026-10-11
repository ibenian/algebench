"""Real confluent-kafka consumer with manual commits (at-least-once)."""
import json
import os
import signal
from confluent_kafka import Consumer, Producer, TopicPartition, OFFSET_BEGINNING
from common import charge

MAX_POLL_RECORDS = int(os.getenv("MAX_POLL_RECORDS", "2"))
MAX_ATTEMPTS = 3
conf = {"bootstrap.servers": os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")}
consumer = Consumer({**conf,
    "group.id": "billing",
    "enable.auto.commit": False,      # we commit only after processing
    "auto.offset.reset": "earliest",  # a group with no committed offset starts at the log head
    "session.timeout.ms": 45000,      # missed heartbeats for this long => rebalance
})
dlt = Producer(conf)
running = True


def on_revoke(consumer, partitions):
    print("revoked", [p.partition for p in partitions])  # finish in-hand work before rejoining


def on_assign(consumer, partitions):
    print("assigned", [p.partition for p in partitions])  # resume from committed offsets


def replay_from_beginning(partitions):
    consumer.assign([TopicPartition("orders", p, OFFSET_BEGINNING) for p in partitions])


def handle(msg):
    order = json.loads(msg.value())
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            charge(order)
            return
        except ValueError:
            if attempt == MAX_ATTEMPTS:
                dlt.produce("orders.DLT", key=msg.key(), value=msg.value())
                dlt.flush()


signal.signal(signal.SIGTERM, lambda *_: globals().update(running=False))
consumer.subscribe(["orders"], on_assign=on_assign, on_revoke=on_revoke)
while running:
    batch = consumer.consume(num_messages=MAX_POLL_RECORDS, timeout=1.0)
    for msg in batch:
        if not running:
            break  # uncommitted records are re-read by the next owner, never processed twice
        if msg.error():
            continue
        handle(msg)
        consumer.commit(message=msg, asynchronous=False)  # stores offset + 1
consumer.close()  # commits nothing by itself here; leaves the group => immediate rebalance
