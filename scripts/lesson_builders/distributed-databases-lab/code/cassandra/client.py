from cassandra.cluster import Cluster
from cassandra.query import SimpleStatement
from cassandra import ConsistencyLevel

session = Cluster(["n1", "n2", "n3"]).connect()
session.execute("""
    CREATE KEYSPACE IF NOT EXISTS app
    WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 3}
""")  # N = 3 replicas of every partition
session.set_keyspace("app")

W = ConsistencyLevel.QUORUM  # wait for 2 of 3 replica acks
R = ConsistencyLevel.QUORUM  # wait for 2 of 3 replica replies (ONE = 1, ALL = 3)


def write(key, value):
    stmt = SimpleStatement("UPDATE kv SET v = %s WHERE k = %s", consistency_level=W)
    session.execute(stmt, (value, key))  # cell timestamp decides conflicts: last write wins


def read(key):
    stmt = SimpleStatement("SELECT v FROM kv WHERE k = %s", consistency_level=R)
    return session.execute(stmt, (key,)).one().v  # mismatching replicas are read-repaired


def delete(key):
    # Writes a tombstone; it is purged after gc_grace_seconds (run repair more often than that).
    session.execute(SimpleStatement("DELETE FROM kv WHERE k = %s", consistency_level=W), (key,))
