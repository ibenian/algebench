"""Multi-version concurrency control: snapshot isolation, plus the SSI commit check.

A teaching sketch of the algorithm the lab simulates. Writers add versions instead
of overwriting, so readers never wait.
"""


def begin(tx):
    tx.snapshot = last_commit_ts


def read(tx, row):
    for version in reversed(row.versions):
        if version.writer is tx or version.commit_ts <= tx.snapshot:
            return version.value  # the newest version this snapshot can see


def write(tx, row, value):
    if row.lock not in (None, tx):
        wait_for(row.lock)  # MongoDB aborts here instead of waiting
    row.lock = tx
    if row.latest_committed.commit_ts > tx.snapshot:
        abort(tx, "could not serialize access")  # first-updater-wins
    row.versions.append(Version(value, writer=tx))


def commit(tx):
    if SERIALIZABLE and closes_dependency_cycle(tx):
        abort(tx, "serialization failure")  # SSI: rw-antidependency cycle
    tx.commit_ts = next_commit_ts()  # its versions become visible to new snapshots
    release_row_locks(tx)
