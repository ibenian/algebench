"""Real pika publisher with publisher confirms."""
import os
import pika
from common import encode

params = pika.URLParameters(os.getenv("AMQP_URL", "amqp://guest:guest@localhost:5672/%2F"))
connection = pika.BlockingConnection(params)
channel = connection.channel()
channel.exchange_declare(exchange="orders", exchange_type="direct", durable=True)
channel.confirm_delivery()  # basic_publish now raises if the broker nacks or cannot route


def send(order_id: str, key: str) -> None:
    channel.basic_publish(
        exchange="orders",
        routing_key="orders.created",
        body=encode(order_id, key),
        properties=pika.BasicProperties(
            delivery_mode=pika.DeliveryMode.Persistent,
            message_id=order_id,
        ),
        mandatory=True,  # unroutable messages come back instead of vanishing
    )


if __name__ == "__main__":
    for i in range(1, 13):
        send(f"m{i}", f"k{(i - 1) % 4}")
    connection.close()
