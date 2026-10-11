"""Retry a transaction when the database aborts it (PostgreSQL, psycopg 3).

Under Repeatable Read and Serializable, PostgreSQL resolves conflicts by
aborting one transaction with SQLSTATE 40001 (serialization_failure) or
40P01 (deadlock_detected). The aborted work left no effect, so the client
must run the WHOLE transaction again, reading fresh data.
"""
import random
import time

import psycopg
from psycopg import errors

RETRYABLE = (errors.SerializationFailure, errors.DeadlockDetected)


def withdraw(conn: psycopg.Connection, account: str, amount: int) -> None:
    with conn.transaction():  # BEGIN
        balance = conn.execute("SELECT v FROM accounts WHERE id = %s", (account,)).fetchone()[0]
        conn.execute("UPDATE accounts SET v = %s WHERE id = %s", (balance - amount, account))
    # leaving the block COMMITs; an exception inside it ROLLs BACK


def run_with_retry(conn: psycopg.Connection, fn, *args, attempts: int = 5):
    for attempt in range(1, attempts + 1):
        try:
            return fn(conn, *args)
        except RETRYABLE:
            # The transaction was aborted: nothing it did is visible. Back off, then rerun it from the top.
            if attempt == attempts:
                raise
            time.sleep(random.uniform(0, 0.01 * 2**attempt))


if __name__ == "__main__":
    with psycopg.connect("dbname=lab") as conn:
        conn.isolation_level = psycopg.IsolationLevel.SERIALIZABLE
        run_with_retry(conn, withdraw, "A", 30)
