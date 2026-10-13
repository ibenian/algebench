from redis.cluster import RedisCluster

r = RedisCluster(host="n1", port=6379)  # 16384 hash slots spread over the masters

# Slot = CRC16(key) mod 16384; the client routes each command to the slot's master.
print(r.cluster_keyslot("user:42"))

# Hash tags: only the part in {...} is hashed, so these keys share a slot (multi-key ops work).
r.set("{user:42}:profile", "...")
r.set("{user:42}:cart", "...")


def write(key, value):
    r.set(key, value)  # acknowledged by the master; replicated to its replica asynchronously


def write_and_wait(key, value):
    r.set(key, value)
    # Block until 1 replica acknowledges. Narrows, but does not close, the window for losing
    # an acknowledged write on failover: Redis Cluster is not strongly consistent.
    return r.execute_command("WAIT", 1, 100, target_nodes=r.get_node_from_key(key))
