"""Real confluent-kafka producer. Run outside AlgeBench against a broker."""
import os
from confluent_kafka import Producer
from common import encode

producer = Producer({
    "bootstrap.servers": os.getenv("KAFKA_BOOTSTRAP", "localhost:9092"),
    "enable.idempotence": True,   # broker de-duplicates producer retries
    "acks": "all",                # wait for the in-sync replicas
    "delivery.timeout.ms": 120000,  # keep retrying while brokers are down
})


def on_delivery(err, msg):
    if err is not None:
        print("delivery failed", err)
    else:
        print(f"{msg.key()} -> partition {msg.partition()} @ {msg.offset()}")


def send(order_id: str, key: str) -> None:
    # The key picks the partition (murmur2(key) % partitions): same key, same partition.
    producer.produce("orders", key=key, value=encode(order_id, key), on_delivery=on_delivery)
    producer.poll(0)  # serve delivery callbacks


if __name__ == "__main__":
    for i in range(1, 13):
        send(f"m{i}", f"k{(i - 1) % 4}")
    producer.flush()  # block until every buffered record is acknowledged
