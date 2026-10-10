"""Real Kafka consumer with PostgreSQL completion/retry state and HTTP push."""
import json
import os
import psycopg
import requests
from psycopg.types.json import Jsonb
from confluent_kafka import Consumer, KafkaException


def enqueue(db, event_id, topic, job, delay=0):
    db.execute(
        "INSERT INTO outbox(id, topic, payload, due_at) "
        "VALUES (%s, %s, %s, now() + %s * interval '1 second') "
        "ON CONFLICT DO NOTHING", (event_id, topic, Jsonb(job), delay),
    )


def handle(db, job):
    # Serialize concurrent replays of one job while checking/updating the ledger.
    db.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (job["id"],))
    done = db.execute("SELECT 1 FROM completed WHERE id = %s", (job["id"],)).fetchone()
    if done:
        return  # acknowledged completion suppresses a replay
    terminal = db.execute("SELECT 1 FROM terminal WHERE id = %s", (job["id"],)).fetchone()
    if terminal:
        return
    attempt = job["attempt"]
    # If a prior copy already scheduled this attempt's retry, don't send it again.
    scheduled = db.execute("SELECT 1 FROM outbox WHERE id = %s",
                           (f"retry:{job['id']}:{attempt + 1}",)).fetchone()
    if scheduled:
        return
    try:
        response = requests.post(os.environ["PUSH_GATEWAY_URL"], json=job, timeout=5)
        accepted = 200 <= response.status_code < 300
        permanent = 400 <= response.status_code < 500 and response.status_code not in (408, 429)
    except requests.RequestException:
        accepted, permanent = False, False  # ambiguous: effect may have happened
    if accepted:
        db.execute("INSERT INTO completed(id) VALUES (%s) ON CONFLICT DO NOTHING",
                   (job["id"],))
    elif permanent:
        db.execute("INSERT INTO terminal(id) VALUES (%s) ON CONFLICT DO NOTHING", (job["id"],))
        enqueue(db, "dead:" + job["id"], "dead-letters", job)
    elif os.getenv("DELIVERY_POLICY", "at-least-once") == "at-most-once":
        # Abandon ambiguous/failed responses without scheduling another attempt.
        db.execute("INSERT INTO terminal(id) VALUES (%s) ON CONFLICT DO NOTHING", (job["id"],))
    elif attempt >= int(os.getenv("MAX_ATTEMPTS", "3")):
        db.execute("INSERT INTO terminal(id) VALUES (%s) ON CONFLICT DO NOTHING", (job["id"],))
        enqueue(db, "dead:" + job["id"], "dead-letters", job)
    else:
        retry = {**job, "attempt": attempt + 1}
        enqueue(db, f"retry:{job['id']}:{retry['attempt']}", "delivery-jobs", retry, 2 ** attempt)
    # HTTP effect and this DB transaction are NOT atomic. Lost ACKs may duplicate pushes.


def main():
    consumer = Consumer({
        "bootstrap.servers": os.getenv("KAFKA_BOOTSTRAP", "localhost:9092"),
        "group.id": "push-workers", "auto.offset.reset": "earliest",
        "enable.auto.commit": False, "enable.auto.offset.store": False,
        "isolation.level": "read_committed",
    })
    consumer.subscribe(["delivery-jobs"])
    try:
        with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as db:
            while True:
                message = consumer.poll(1.0)
                if message is None:
                    continue
                if message.error():
                    raise KafkaException(message.error())
                job = json.loads(message.value())
                with db.transaction():
                    handle(db, job)
                consumer.commit(message=message, asynchronous=False)
                # Commit next offset only AFTER durable completion/retry/terminal state.
    finally:
        consumer.close()


if __name__ == "__main__":
    main()
