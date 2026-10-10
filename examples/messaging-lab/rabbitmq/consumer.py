"""Real pika consumer: quorum queue, prefetch window, manual acks."""
import json
import os
import signal
import pika
from common import charge

PREFETCH = int(os.getenv("PREFETCH", "2"))
connection = pika.BlockingConnection(pika.URLParameters(os.getenv("AMQP_URL", "amqp://guest:guest@localhost:5672/%2F")))
channel = connection.channel()
channel.exchange_declare(exchange="orders.dlx", exchange_type="fanout", durable=True)
channel.queue_declare(queue="billing.dlq", durable=True)
channel.queue_bind(queue="billing.dlq", exchange="orders.dlx")
channel.queue_declare(queue="billing", durable=True, arguments={
    "x-queue-type": "quorum",
    "x-delivery-limit": 3,                 # after this many redeliveries: dead-letter
    "x-dead-letter-exchange": "orders.dlx",
})
channel.queue_bind(queue="billing", exchange="orders", routing_key="orders.created")
channel.basic_qos(prefetch_count=PREFETCH)  # at most PREFETCH unacked deliveries in flight


def on_message(ch, method, properties, body):
    order = json.loads(body)
    try:
        charge(order)
    except ValueError:
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
        return
    ch.basic_ack(delivery_tag=method.delivery_tag)  # broker deletes the message


signal.signal(signal.SIGTERM, lambda *_: channel.stop_consuming())
channel.basic_consume(queue="billing", on_message_callback=on_message, auto_ack=False)
channel.start_consuming()
connection.close()  # unacked deliveries on this channel are requeued
