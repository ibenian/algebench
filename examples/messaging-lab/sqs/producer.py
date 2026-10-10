"""Real boto3 producer for a standard SQS queue."""
import json
import os
import boto3

sqs = boto3.client("sqs")
dlq_url = sqs.create_queue(QueueName="billing-dlq")["QueueUrl"]
dlq_arn = sqs.get_queue_attributes(QueueUrl=dlq_url, AttributeNames=["QueueArn"])["Attributes"]["QueueArn"]
QUEUE_URL = sqs.create_queue(QueueName="billing", Attributes={
    "VisibilityTimeout": os.getenv("VISIBILITY_TIMEOUT", "30"),
    "RedrivePolicy": json.dumps({"deadLetterTargetArn": dlq_arn, "maxReceiveCount": "3"}),
})["QueueUrl"]


def send(order_id: str, key: str) -> None:
    # Standard queues: at-least-once, best-effort ordering. (FIFO queues need MessageGroupId.)
    sqs.send_message(QueueUrl=QUEUE_URL, MessageBody=json.dumps({"id": order_id, "key": key}))


if __name__ == "__main__":
    for i in range(1, 13):
        send(f"m{i}", f"k{(i - 1) % 4}")
