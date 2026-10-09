"""Commit an intent and outbox row in the same PostgreSQL transaction."""
import json
import os
import sys
import psycopg
from psycopg.types.json import Jsonb


def submit(intent):
    with psycopg.connect(os.environ["DATABASE_URL"]) as db:
        # Existing id means replay of the original request, not a new intent.
        row = db.execute(
            "INSERT INTO notifications(id, payload) VALUES (%s, %s) "
            "ON CONFLICT DO NOTHING RETURNING id",
            (intent["id"], Jsonb(intent)),
        ).fetchone()
        if row:
            db.execute(
                "INSERT INTO outbox(id, topic, payload) VALUES (%s, %s, %s)",
                ("intent:" + intent["id"], "notification-intents", Jsonb(intent)),
            )
        # Connection context commits both inserts together or rolls both back.


if __name__ == "__main__":
    submit(json.loads(sys.argv[1]))
