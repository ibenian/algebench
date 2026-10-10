"""Real PyFlink 1.20 DataStream job. Run outside the AlgeBench browser."""
import json
import os
import psycopg
from pyflink.common import Types, WatermarkStrategy
from pyflink.common.serialization import SimpleStringSchema
from pyflink.datastream import StreamExecutionEnvironment
from pyflink.datastream.connectors.base import DeliveryGuarantee
from pyflink.datastream.connectors.kafka import (
    KafkaSource, KafkaSink, KafkaRecordSerializationSchema,
    KafkaOffsetsInitializer, KafkaOffsetResetStrategy,
)
from pyflink.datastream.functions import FlatMapFunction


class FanOut(FlatMapFunction):
    def open(self, runtime_context):
        self.db = psycopg.connect(os.environ["DATABASE_URL"], autocommit=True)

    def flat_map(self, raw):
        intent = json.loads(raw)
        # Real SQL lookup; sender can be a publisher, channel, or user.
        rows = self.db.execute(
            "SELECT target FROM followers WHERE source = %s "
            "ORDER BY target LIMIT %s",
            (intent["sender"], int(os.getenv("QUERY_LIMIT", "40"))),
        ).fetchall()
        for (target,) in rows:
            yield json.dumps({
                "id": intent["id"] + ":" + target,
                "intent": intent["id"], "target": target,
                "body": intent["body"], "attempt": 1,
            })

    def close(self):
        self.db.close()


def main():
    env = StreamExecutionEnvironment.get_execution_environment()
    env.set_parallelism(int(os.getenv("PARALLELISM", "2")))
    env.enable_checkpointing(5000)
    env.add_jars(os.environ["KAFKA_CONNECTOR_JAR_URI"])
    brokers = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
    source = (KafkaSource.builder()
        .set_bootstrap_servers(brokers)
        .set_topics("notification-intents")
        .set_group_id("notification-fanout")
        .set_starting_offsets(KafkaOffsetsInitializer.committed_offsets(
            KafkaOffsetResetStrategy.EARLIEST))
        .set_value_only_deserializer(SimpleStringSchema())
        .build())
    intents = env.from_source(
        source, WatermarkStrategy.no_watermarks(), "KafkaSource")
    jobs = intents.flat_map(FanOut(), output_type=Types.STRING()).name("FanOut")
    serializer = (KafkaRecordSerializationSchema.builder()
        .set_topic("delivery-jobs")
        .set_value_serialization_schema(SimpleStringSchema())
        .build())
    sink = (KafkaSink.builder()
        .set_bootstrap_servers(brokers)
        .set_record_serializer(serializer)
        .set_delivery_guarantee(DeliveryGuarantee.AT_LEAST_ONCE)
        .build())
    jobs.sink_to(sink).name("KafkaSink")
    env.execute("notification-fanout")


if __name__ == "__main__":
    main()
