"""Shared handler used by every consumer sample: the side effect the lab counts."""
import json


def charge(order: dict) -> None:
    """Pretend side effect (e.g. charge a card). Not idempotent on purpose:
    a second call for the same order id is the duplicate the lab measures."""
    if order.get("poison"):
        raise ValueError(f"cannot process order {order['id']}")
    print("charged", order["id"])


def encode(order_id: str, key: str) -> bytes:
    return json.dumps({"id": order_id, "key": key}).encode()
