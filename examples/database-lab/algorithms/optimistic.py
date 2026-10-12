"""Optimistic concurrency control: read, validate, write.

A teaching sketch of the algorithm the lab simulates. Nothing is locked while a
transaction runs; conflicts are found when it tries to commit.
"""


def begin(tx):
    tx.start = last_commit_ts


def read(tx, row):
    version = row.latest_committed
    tx.read_set[row] = version.commit_ts
    return tx.write_set.get(row, version.value)


def write(tx, row, value):
    tx.write_set[row] = value  # private: invisible to everyone else


def commit(tx):
    for row in tx.read_set:
        if row.latest_committed.commit_ts > tx.start:
            abort(tx, "validation failed")  # someone committed a change I read
    for row, value in tx.write_set.items():
        row.install(value, commit_ts=next_commit_ts())
