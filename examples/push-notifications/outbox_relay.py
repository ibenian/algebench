"""Real Kafka producer: publish committed intents and due retry rows."""
import json
import os
import time
import psycopg
from confluent_kafka import Producer


def publish(producer, topic, payload):
    result = []
    producer.produce(topic, key=payload["id"], value=json.dumps(payload),
                     on_delivery=lambda error, message: result.append(error))
    remaining = producer.flush(10)
    if remaining or not result or result[0] is not None:
        raise RuntimeError("Kafka publication was not acknowledged")


def main():
    producer = Producer({
        "bootstrap.servers": os.getenv("KAFKA_BOOTSTRAP", "localhost:9092"),
        "enable.idempotence": True,
        "acks": "all",
    })
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as db:
        while True:
            with db.transaction():
                row = db.execute(
                    "SELECT id, topic, payload FROM outbox "
                    "WHERE NOT published AND due_at <= now() "
                    "ORDER BY due_at, id LIMIT 1 FOR UPDATE SKIP LOCKED"
                ).fetchone()
                if row:
                    event_id, topic, payload = row
                    publish(producer, topic, payload)
                    db.execute("UPDATE outbox SET published = true WHERE id = %s",
                               (event_id,))
                    # Crash after Kafka ACK but before DB commit can replay.
            if not row:
                time.sleep(0.2)


if __name__ == "__main__":
    main()
