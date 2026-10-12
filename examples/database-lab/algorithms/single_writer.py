"""One writer at a time, readers on a snapshot (SQLite in WAL mode).

A teaching sketch of the algorithm the lab simulates.
"""


def begin(tx):
    tx.snapshot = last_commit_ts


def read(tx, row):
    return row.version_at(tx.snapshot)


def write(tx, row, value):
    if writer_lock.holder not in (None, tx):
        wait_for(writer_lock.holder)  # busy_timeout
    if tx.snapshot < last_commit_ts:
        abort(tx, "SQLITE_BUSY_SNAPSHOT")  # my reads may be stale
    writer_lock.holder = tx
    wal.append(row, value)


def commit(tx):
    wal.commit(tx)
    writer_lock.holder = None
