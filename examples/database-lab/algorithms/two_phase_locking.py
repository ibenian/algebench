"""Strict two-phase locking with deadlock detection.

A teaching sketch of the algorithm the lab simulates, not a real lock manager.
Locks only grow while a transaction runs and are all released at commit.
"""


def execute(tx, stmt):
    mode = "S" if stmt.is_read else "X"
    request = LockRequest(tx, stmt.row, mode)
    if lock_table.compatible(request):
        lock_table.grant(request)  # held until commit: that is the "strict" part
        return run(tx, stmt)
    lock_table.enqueue(request)
    if wait_for_graph.has_cycle_through(tx):
        abort(tx, "deadlock detected")  # the victim; the client retries it
    return WAITING  # resumes when a holder releases


def run(tx, stmt):
    if stmt.is_read:
        return stmt.row.value
    stmt.row.write_uncommitted(tx, stmt.value)


def commit(tx):
    log.flush(tx)
    for lock in lock_table.held_by(tx):
        lock_table.release(lock)
    lock_table.wake_compatible_waiters()


def rollback(tx):
    undo_log.revert(tx)
    for lock in lock_table.held_by(tx):
        lock_table.release(lock)
