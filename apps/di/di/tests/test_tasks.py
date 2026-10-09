"""Background reference-sync job (P0-2)."""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import di.tasks as tasks


class TestRunReferenceSync(unittest.TestCase):
	def test_resolves_target_notifies_success_and_commits(self):
		target = MagicMock(return_value={"message": "ok"})
		fake_db = SimpleNamespace(commit=MagicMock())
		with (
			patch.object(tasks.frappe, "get_attr", return_value=target) as get_attr,
			patch.object(tasks, "_notify_user") as notify,
			patch.object(tasks.frappe, "db", fake_db),
			patch.object(tasks.frappe, "log_error") as log_error,
		):
			tasks.run_reference_sync("di.integrations.reference_api.sync_provinces", "provinces", "a@x.com")

		get_attr.assert_called_once_with("di.integrations.reference_api.sync_provinces")
		target.assert_called_once_with()
		notify.assert_called_once()
		self.assertIn("finished", notify.call_args[0][1])
		fake_db.commit.assert_called()
		log_error.assert_not_called()

	def test_notifies_on_failure_and_rethrows(self):
		boom = RuntimeError("FBR down")
		fake_db = SimpleNamespace(commit=MagicMock())
		with (
			patch.object(tasks.frappe, "get_attr", return_value=MagicMock(side_effect=boom)),
			patch.object(tasks, "_notify_user") as notify,
			patch.object(tasks.frappe, "db", fake_db),
			patch.object(tasks.frappe, "log_error") as log_error,
			patch.object(tasks.frappe, "get_traceback", return_value="tb"),
			patch.object(tasks.frappe.utils, "escape_html", side_effect=lambda s: s),
		):
			with self.assertRaises(RuntimeError):
				tasks.run_reference_sync("di.integrations.reference_api.sync_provinces", "provinces", "a@x.com")

		notify.assert_called_once()
		self.assertIn("failed", notify.call_args[0][1])
		log_error.assert_called_once()
		fake_db.commit.assert_called()
