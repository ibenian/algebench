# Distributed Databases Laboratory — client code

Short, real client snippets shown in the lesson's Code tab. Each one exposes the knob the
simulation moves: replication acknowledgements, read routing, consistency levels, hash slots.
They are illustrations of the documented APIs, not a test suite; connection details are
placeholders.

| File | Knob |
|---|---|
| `postgres/postgresql.conf` | `synchronous_commit`, `synchronous_standby_names` |
| `postgres/client.py` | write on the primary, read on a hot standby, read-your-writes by LSN |
| `cassandra/client.py` | replication factor, consistency level per statement |
| `mongodb/client.py` | `writeConcern`, `readPreference`, causal session |
| `dynamodb/client.py` | `ConsistentRead`, conditional writes |
| `redis/cluster.py` | hash slots, hash tags, `WAIT` |
