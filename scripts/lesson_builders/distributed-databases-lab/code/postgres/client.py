import psycopg

primary = psycopg.connect("host=primary dbname=app")
replica = psycopg.connect("host=replica-c dbname=app")


def write(key, value):
    with primary.transaction():
        primary.execute("UPDATE kv SET v = %s WHERE k = %s", (value, key))
        lsn = primary.execute("SELECT pg_current_wal_lsn()").fetchone()[0]
    return lsn  # COMMIT has returned: acknowledged


def read(key):
    # Hot standby: may lag behind the primary (replication lag).
    return replica.execute("SELECT v FROM kv WHERE k = %s", (key,)).fetchone()[0]


def read_your_writes(key, my_lsn):
    # Session token: wait until the standby has replayed my last write, else go to the primary.
    replayed = replica.execute("SELECT pg_last_wal_replay_lsn() >= %s", (my_lsn,)).fetchone()[0]
    conn = replica if replayed else primary
    return conn.execute("SELECT v FROM kv WHERE k = %s", (key,)).fetchone()[0]
