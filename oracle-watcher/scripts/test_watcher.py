"""Offline tests for the Mavuri read-only Oracle ARM monitor."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import watcher


class CapacityTests(unittest.TestCase):
    def test_available(self):
        self.assertTrue(watcher.capacity_available("AVAILABLE", 1))
        self.assertTrue(watcher.capacity_available("AVAILABLE", None))
        self.assertFalse(watcher.capacity_available("OUT_OF_HOST_CAPACITY", None))
        self.assertFalse(watcher.capacity_available("AVAILABLE", 0))
        self.assertFalse(watcher.capacity_available("UNKNOWN", 2))

    def test_first_alert(self):
        self.assertTrue(watcher.should_notify({}, 100000))

    def test_no_repeated_alert_on_each_check(self):
        self.assertFalse(watcher.should_notify(
            {"available": True, "last_sent_at": 99900}, 100000))
        self.assertTrue(watcher.should_notify(
            {"available": True, "last_sent_at": 100000 - 7 * 3600}, 100000))

    def test_return_after_downtime(self):
        self.assertFalse(watcher.should_notify(
            {"available": False, "last_sent_at": 100000 - 1800}, 100000))
        self.assertTrue(watcher.should_notify(
            {"available": False, "last_sent_at": 100000 - 3600}, 100000))

    def test_state_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            with patch.object(watcher, "STATE_FILE", path):
                self.assertEqual(watcher.load_state(), {})
                watcher.save_state({"available": True, "last_sent_at": 123})
                self.assertEqual(watcher.load_state()["last_sent_at"], 123)
                self.assertTrue(json.loads(path.read_text())["available"])

    def test_alert_says_manual(self):
        msg = watcher.notification_text(None)
        self.assertIn("manualmente", msg)
        self.assertIn("nao esta reservada", msg)
        self.assertIn("1 OCPU / 4 GB", msg)

    def test_provisioning_not_present(self):
        content = Path(watcher.__file__).read_text(encoding="utf-8")
        for forbidden in ("rm.create_job(", "CreateApplyJobOperationDetails(",
                          "CreatePlanJobOperationDetails(", "compute.launch_instance("):
            self.assertNotIn(forbidden, content)


if __name__ == "__main__":
    unittest.main()
