from pymongo import MongoClient, ReadPreference
from pymongo.read_concern import ReadConcern
from pymongo.write_concern import WriteConcern

client = MongoClient("mongodb://n1,n2,n3/?replicaSet=rs0")
db = client.app

# Defaults since 5.0: acknowledged by a majority of the replica set, read from the primary.
kv = db.get_collection("kv", write_concern=WriteConcern(w="majority"))


def write(key, value):
    kv.update_one({"_id": key}, {"$set": {"v": value}}, upsert=True)


def read(key):
    return kv.find_one({"_id": key})["v"]


# Fast, possibly stale: any secondary, whatever it has applied.
nearby = db.get_collection("kv", read_preference=ReadPreference.SECONDARY_PREFERRED,
                           read_concern=ReadConcern("local"))


def read_nearby(key):
    return nearby.find_one({"_id": key})["v"]


def causal(key, value):
    # A causally consistent session: reads wait until the secondary has seen my operations.
    with client.start_session(causal_consistency=True) as s:
        kv.update_one({"_id": key}, {"$set": {"v": value}}, session=s)
        return nearby.find_one({"_id": key}, session=s)["v"]
