"""Real boto3 consumer: receive, process, delete with the receipt handle."""
import json
import os
import signal
import boto3
from common import charge

sqs = boto3.client("sqs")
QUEUE_URL = sqs.get_queue_url(QueueName="billing")["QueueUrl"]
BATCH = int(os.getenv("RECEIVE_BATCH", "1"))
running = True
signal.signal(signal.SIGTERM, lambda *_: globals().update(running=False))

while running:
    resp = sqs.receive_message(
        QueueUrl=QUEUE_URL,
        MaxNumberOfMessages=BATCH,
        WaitTimeSeconds=20,  # long polling
        MessageSystemAttributeNames=["ApproximateReceiveCount"],
    )  # received messages are now invisible for the visibility timeout
    messages = resp.get("Messages", [])
    for i, m in enumerate(messages):
        if not running:  # shutting down: release the rest immediately
            for rest in messages[i:]:
                sqs.change_message_visibility(QueueUrl=QUEUE_URL, ReceiptHandle=rest["ReceiptHandle"], VisibilityTimeout=0)
            break
        try:
            charge(json.loads(m["Body"]))
        except ValueError:
            continue  # not deleted: visible again after the timeout; redrive after maxReceiveCount
        sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=m["ReceiptHandle"])
