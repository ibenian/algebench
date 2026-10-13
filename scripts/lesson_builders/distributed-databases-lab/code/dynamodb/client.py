import boto3

table = boto3.resource("dynamodb").Table("kv")  # partitioned by hash of the partition key "k"


def write(key, value):
    table.put_item(Item={"k": key, "v": value})


def read(key):
    # Default: eventually consistent (half the read cost; may miss a write from the last moment).
    return table.get_item(Key={"k": key})["Item"]["v"]


def read_strong(key):
    # Strongly consistent: reflects every acknowledged write; base table only, not GSIs.
    return table.get_item(Key={"k": key}, ConsistentRead=True)["Item"]["v"]


def write_if_unchanged(key, value, version):
    # Optimistic concurrency: the write fails if someone else changed the item meanwhile.
    table.put_item(Item={"k": key, "v": value, "ver": version + 1},
                   ConditionExpression="ver = :seen", ExpressionAttributeValues={":seen": version})
