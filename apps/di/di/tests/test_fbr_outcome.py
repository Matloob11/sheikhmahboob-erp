"""Durable FBR post outcomes and filed-draft freeze (P0-3)."""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from di.integrations import fbr_outcome
from di.integrations.http import FBRRejected, FBRUncertainError
from di.tests.test_client_panel import FakeDoc


class TestPersistOutcome(unittest.TestCase):
	def test_rejection_logs_and_commits_before_throw(self):
		doc = FakeDoc(doctype="Sale Tax Invoice", name="STI-1", is_new=lambda: False)
		response = {
			"validationResponse": {
				"errorCode": "0099",
				"error": "bad uom",
				"invoiceStatuses": [],
			}
		}
		fake_db = SimpleNamespace(commit=MagicMock())
		with (
			patch.object(fbr_outcome, "create_log") as create_log,
			patch.object(fbr_outcome.frappe, "db", fake_db),
			patch.object(fbr_outcome.frappe, "flags", SimpleNamespace(in_test=False)),
			patch.object(fbr_outcome, "explain_error", side_effect=lambda c, m: m),
			patch(
				"di.integrations.sale_tax_invoice_api._make_request",
				return_value=response,
			),
			patch(
				"di.integrations.sale_tax_invoice_api.build_sale_tax_invoice_payload",
				return_value={"items": []},
			),
			patch("di.integrations.sale_tax_invoice_api._get_post_url", return_value="http://x"),
			patch("di.integrations.sale_tax_invoice_api._get_seller_token", return_value="tok"),
			patch("di.integrations.sale_tax_invoice_api.frappe.throw", side_effect=RuntimeError("rej")),
		):
			from di.integrations import sale_tax_invoice_api as sti

			with self.assertRaises(RuntimeError):
				sti.post_sale_tax_invoice(doc)

		create_log.assert_called_once()
		fake_db.commit.assert_called()

	def test_success_db_sets_number_before_return(self):
		doc = FakeDoc(
			doctype="Sale Tax Invoice",
			name="STI-1",
			is_new=lambda: False,
			db_set=MagicMock(),
		)
		response = {"invoiceNumber": "FBR-99", "dated": "2026-10-01"}
		fake_db = SimpleNamespace(commit=MagicMock())
		with (
			patch.object(fbr_outcome, "create_log"),
			patch.object(fbr_outcome.frappe, "db", fake_db),
			patch.object(fbr_outcome.frappe, "flags", SimpleNamespace(in_test=False, current_date=None)),
			patch.object(fbr_outcome, "now", return_value="2026-10-01"),
			patch("di.integrations.qr_code.generate_qr_code", return_value="qr"),
			patch(
				"di.integrations.sale_tax_invoice_api._make_request",
				return_value=response,
			),
			patch(
				"di.integrations.sale_tax_invoice_api.build_sale_tax_invoice_payload",
				return_value={"items": []},
			),
			patch("di.integrations.sale_tax_invoice_api._get_post_url", return_value="http://x"),
			patch("di.integrations.sale_tax_invoice_api._get_seller_token", return_value="tok"),
		):
			from di.integrations import sale_tax_invoice_api as sti

			sti.post_sale_tax_invoice(doc)

		self.assertEqual(doc.fbr_invoice_no, "FBR-99")
		doc.db_set.assert_any_call("fbr_invoice_no", "FBR-99", update_modified=False)
		fake_db.commit.assert_called()

	def test_fbr_rejected_and_uncertain_persist_then_reraise(self):
		doc = FakeDoc(doctype="Sale Tax Invoice", name="STI-1", is_new=lambda: False)
		fake_db = SimpleNamespace(commit=MagicMock())
		for exc in (FBRRejected("no"), FBRUncertainError("maybe")):
			with (
				patch.object(fbr_outcome, "create_log") as create_log,
				patch.object(fbr_outcome.frappe, "db", fake_db),
				patch.object(fbr_outcome.frappe, "flags", SimpleNamespace(in_test=False)),
				patch(
					"di.integrations.sale_tax_invoice_api._make_request",
					side_effect=exc,
				),
				patch(
					"di.integrations.sale_tax_invoice_api.build_sale_tax_invoice_payload",
					return_value={"items": []},
				),
				patch("di.integrations.sale_tax_invoice_api._get_post_url", return_value="http://x"),
				patch("di.integrations.sale_tax_invoice_api._get_seller_token", return_value="tok"),
			):
				from di.integrations import sale_tax_invoice_api as sti

				with self.assertRaises(type(exc)):
					sti.post_sale_tax_invoice(doc)
			create_log.assert_called()
			fake_db.commit.assert_called()


class TestFiledDraftFreeze(unittest.TestCase):
	def test_changed_filed_draft_is_refused(self):
		from di.digital_invoicing.doctype.sale_tax_invoice import sale_tax_invoice as sti_mod

		holder = SimpleNamespace(
			fbr_invoice_no="FBR-1",
			fbr_payload_hash=fbr_outcome.payload_hash({"items": [{"a": 1}]}),
			is_new=lambda: False,
			get=lambda k, d=None: getattr(holder, k, d),
		)

		with (
			patch(
				"di.integrations.sale_tax_invoice_api.build_sale_tax_invoice_payload",
				return_value={"items": [{"a": 2}]},
			),
			patch.object(sti_mod.frappe, "throw", side_effect=RuntimeError("frozen")),
		):
			with self.assertRaises(RuntimeError):
				sti_mod.SaleTaxInvoice._refuse_changes_after_filing(holder)

	def test_count_unposted_includes_filed_drafts(self):
		from di import tasks

		with (
			patch.object(tasks, "_pending", return_value=[]),
			patch.object(tasks, "_pending_filed_drafts", return_value=["STI-DRAFT"]),
			patch.object(tasks.frappe.utils, "add_days", return_value="2026-01-01"),
			patch.object(tasks, "today", return_value="2026-10-01"),
		):
			self.assertEqual(tasks.count_unposted(), 1)
