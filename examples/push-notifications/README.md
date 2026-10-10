# Real PyFlink / Kafka sample

These files contain real library calls, not diagram adapter placeholders. AlgeBench displays the exact files; the browser does not execute Python or contact Kafka. Gold lines are architectural correspondences to simulated events, not instrumentation from a running Flink cluster.

## Services and prerequisites

Use a separate Python 3.11 environment with PyFlink 1.20.x, psycopg 3 (binary distribution), confluent-kafka, and requests. Use Java 17 and the matching flink-sql-connector-kafka-3.3.0-1.20.jar. A remote Flink cluster needs the connector and Python dependencies on its workers too. No dependency is added to AlgeBench's runtime.

Install the Python packages in that separate environment:

    python -m pip install "apache-flink>=1.20,<1.21" "psycopg[binary]>=3,<4" confluent-kafka requests

Download the matching [Kafka connector JAR](https://central.sonatype.com/artifact/org.apache.flink/flink-sql-connector-kafka/3.3.0-1.20); it is not bundled with AlgeBench.

Provide a reachable Kafka broker and PostgreSQL instance. Create notification-intents, delivery-jobs, and dead-letters topics; use at least two partitions to demonstrate two workers sharing one group. Configure replication/ISR for your environment. The Flink sink has null Kafka keys in this compact sample; job IDs are in the JSON payload, and per-recipient ordering is not promised.

Set DATABASE_URL, KAFKA_BOOTSTRAP, KAFKA_CONNECTOR_JAR_URI (absolute file URI), and PUSH_GATEWAY_URL in every relevant process. The HTTP endpoint must accept the displayed job JSON and return a 2xx response only when it accepts the push. This is an HTTP gateway integration, not an APNs/FCM SDK or a device receipt endpoint.

Apply schema.sql to PostgreSQL. Then run, in separate terminals from this directory:

    python outbox_relay.py
    python flink_job.py
    python worker.py
    python submit.py '{"id":"n1","sender":"publisher-1","body":"Hello"}'

Run a second worker.py process to join the same push-workers consumer group. Kafka assigns partitions to consumers; there is a committed offset per group/topic/partition, not one shared scalar offset. More workers than partitions do not add consumption parallelism. Restart workers to observe completion dedupe; return 429 from the gateway to exercise durable exponential retries. Failed Kafka publications leave outbox rows unpublished. Do not discard the database between runs if you want retry/dedupe state to survive.

## What is concrete and what remains modeled

flink_job.py implements eager fan-out on write only. Its source reads notification-intents, FanOut queries followers in PostgreSQL and emits one real record per target, and KafkaSink writes delivery-jobs. Source → transformation → sink is the actual DataStream API graph. The sink uses AT_LEAST_ONCE with checkpointing enabled. Checkpoint completion determines flush/progress; a browser tick is not a checkpoint.

submit.py atomically commits notification plus outbox. outbox_relay.py is a polling outbox implementation, not a Debezium CDC connector. It also releases due retry rows. worker.py consumes serially per process, calls an HTTP gateway, writes acknowledged completion or schedules a durable retry, then commits the Kafka offset. Published retry rows remain as attempt dedupe records in this bounded example.

The lesson also simulates deferred/read-triggered fan-out, capacity admission, gateway pacing, and device receipts. This sample does not implement those services; corresponding browser events deliberately do not highlight fake Python operations. Changing browser sliders changes the simulation and its correspondence markers, not the environment variables or data in an external cluster.

This is a small executable teaching example, not a production deployment. Synchronous SQL lookup/HTTP calls and transactions held during calls trade throughput for clarity. Lookup is a live query; audience membership changes between retries can change Flink output. Production needs an audience version/snapshot, bounded connection pools, batching, authentication/TLS, topic/schema validation, poison-message handling, partition-aware concurrency, rebalancing, checkpoint storage/recovery, and retention/cleanup policies. Repeated submission IDs are treated as the original request; conflicting content is not separately rejected.

A crash after a gateway accepts a request but before the ledger commits can duplicate the effect. Producer idempotence does not dedupe separate outbox replay sessions. No claim of end-to-end exactly-once push delivery is made. The at-most-once option only abandons failed/ambiguous responses; it does not implement strict at-most-once across worker crashes (that requires committing before the external call and accepting possible loss).

## Verification

From the AlgeBench repository root, run:

    ./run.sh examples/push-notifications/test_services.py

These tests exercise the worker failure branches and producer acknowledgement handling with mocked I/O. They do not replace a Flink/Kafka/PostgreSQL integration run. The lesson domain tests also check that every embedded source file matches its executable example and that highlight expressions select valid lines.

## Official API references

- [Flink 1.20 Kafka source/sink](https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/connectors/datastream/kafka/)
- [Kafka Python producer/consumer](https://docs.confluent.io/kafka-clients/python/current/overview.html)
- [Kafka consumer groups and offset semantics](https://kafka.apache.org/33/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html)
