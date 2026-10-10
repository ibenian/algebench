"""Exercise real service functions with mocked SQL/Kafka/HTTP boundaries."""
import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    # Tests do not require a Kafka broker, PostgreSQL, or the optional SDKs.
    modules = {key: MagicMock() for key in (
        "psycopg", "psycopg.types", "psycopg.types.json", "confluent_kafka", "requests")}
    modules["psycopg.types.json"].Jsonb.side_effect = lambda value: value
    modules["requests"].RequestException = ConnectionError
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(module)
    return module


class WorkerTest(unittest.TestCase):
    def setUp(self):
        self.worker = load("worker")
        self.db = MagicMock()
        self.db.execute.return_value.fetchone.return_value = None
        self.job = {"id": "n1:u1", "intent": "n1", "target": "u1", "body": "hello", "attempt": 1}
        self.worker.requests.post.return_value.status_code = 200
        self.env = patch.dict(os.environ, {"PUSH_GATEWAY_URL": "https://gateway.example/push", "MAX_ATTEMPTS": "3", "DELIVERY_POLICY": "at-least-once"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def writes(self, table):
        return [call for call in self.db.execute.call_args_list if call.args[0].startswith("INSERT INTO " + table)]

    def test_success_records_completion(self):
        self.worker.handle(self.db, self.job)
        self.assertEqual(len(self.writes("completed")), 1)
        self.assertFalse(self.writes("outbox"))
        self.worker.requests.post.assert_called_once_with(os.environ["PUSH_GATEWAY_URL"], json=self.job, timeout=5)

    def test_completed_or_terminal_or_scheduled_copy_skips_http(self):
        for answers in ([None, (1,)], [None, None, (1,)], [None, None, None, (1,)]):
            with self.subTest(answers=answers):
                self.db.execute.return_value.fetchone.side_effect = answers[1:]
                self.worker.handle(self.db, self.job)
                self.worker.requests.post.assert_not_called()

    def test_429_and_lost_response_schedule_durable_retry(self):
        for ambiguous in (False, True):
            with self.subTest(ambiguous=ambiguous):
                self.db.reset_mock()
                self.worker.requests.post.return_value.status_code = 429
                self.worker.requests.post.side_effect = ConnectionError if ambiguous else None
                self.worker.handle(self.db, self.job)
                event_id, topic, payload, delay = self.writes("outbox")[0].args[1]
                self.assertEqual((event_id, topic, payload["attempt"], delay), ("retry:n1:u1:2", "delivery-jobs", 2, 2))
                self.assertFalse(self.writes("completed"))

    def test_permanent_and_exhausted_failures_dead_letter(self):
        for status, attempt in ((410, 1), (503, 3)):
            with self.subTest(status=status, attempt=attempt):
                self.db.reset_mock()
                self.worker.requests.post.return_value.status_code = status
                self.worker.handle(self.db, {**self.job, "attempt": attempt})
                self.assertEqual(self.writes("outbox")[0].args[1][1], "dead-letters")
                self.assertEqual(len(self.writes("terminal")), 1)

    def test_abandon_policy_does_not_schedule_retry(self):
        os.environ["DELIVERY_POLICY"] = "at-most-once"
        self.worker.requests.post.return_value.status_code = 503
        self.worker.handle(self.db, self.job)
        self.assertEqual(len(self.writes("terminal")), 1)
        self.assertFalse(self.writes("outbox"))


class RelayTest(unittest.TestCase):
    def test_requires_broker_ack(self):
        relay = load("outbox_relay")
        producer = MagicMock()
        producer.flush.return_value = 0
        producer.produce.side_effect = lambda *args, **kwargs: kwargs["on_delivery"](None, None)
        relay.publish(producer, "notification-intents", {"id": "n1"})
        producer.produce.side_effect = lambda *args, **kwargs: kwargs["on_delivery"](RuntimeError("broker"), None)
        with self.assertRaises(RuntimeError):
            relay.publish(producer, "notification-intents", {"id": "n1"})
        producer.flush.return_value = 1
        with self.assertRaises(RuntimeError):
            relay.publish(producer, "notification-intents", {"id": "n1"})


if __name__ == "__main__":
    unittest.main()
