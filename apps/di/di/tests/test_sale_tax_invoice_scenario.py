"""Scenario/Debit Note correctness for the standalone Sale Tax Invoice (P1-1).

Site-less: calls the unbound ``SaleTaxInvoice`` methods against a plain
stand-in object, in the style of ``test_client_panel.py`` / ``test_api_guards.py``.
"""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from di.digital_invoicing.doctype.sale_tax_invoice.sale_tax_invoice import (
	SaleTaxInvoice,
	make_debit_note,
)
from di.tests.test_client_panel import FakeDoc

MODULE = "di.digital_invoicing.doctype.sale_tax_invoice.sale_tax_invoice"


class Row(SimpleNamespace):
	def get(self, key, default=None):
		return getattr(self, key, default)


class SubmitDoc(FakeDoc):
	"""Borrows the real submit-time helpers; only post_sale_tax_invoice is mocked out."""

	_enforce_production_for_panel = SaleTaxInvoice._enforce_production_for_panel
	_apply_scenario_sale_type = SaleTaxInvoice._apply_scenario_sale_type
	_ensure_third_schedule_prices = SaleTaxInvoice._ensure_third_schedule_prices
	_validate_sro = SaleTaxInvoice._validate_sro
	_validate_third_schedule_price = SaleTaxInvoice._validate_third_schedule_price


class DebitNoteDoc(FakeDoc):
	"""Stand-in that answers the private sync/apply calls build_sale_tax_invoice_payload makes."""

	def _sync_buyer_details(self):
		pass

	def _sync_seller_details(self):
		pass

	def _sync_item_details(self):
		pass

	def _apply_scenario_sale_type(self):
		pass

	def _ensure_third_schedule_prices(self):
		pass

	def _calculate_totals(self):
		pass


class TestScenarioRequirement(unittest.TestCase):
	def test_sandbox_without_scenario_raises(self):
		doc = FakeDoc(fbr_environment="Sandbox", scenario_id="")
		with patch(f"{MODULE}.frappe.throw", side_effect=RuntimeError("required")):
			with self.assertRaises(RuntimeError):
				SaleTaxInvoice._validate_scenario_requirement(doc)

	def test_production_without_scenario_validates(self):
		doc = FakeDoc(fbr_environment="Production", scenario_id="")
		SaleTaxInvoice._validate_scenario_requirement(doc)


class TestScenarioSaleTypeApplication(unittest.TestCase):
	def test_production_row_keeps_chosen_sale_type_even_with_scenario_set(self):
		row = Row(sale_type="Exempt goods")
		doc = FakeDoc(fbr_environment="Production", scenario_id="SN001", invoice_items=[row])
		SaleTaxInvoice._apply_scenario_sale_type(doc)
		self.assertEqual(row.sale_type, "Exempt goods")

	def test_sandbox_row_forced_to_scenario_sale_type(self):
		row = Row(sale_type="")
		doc = FakeDoc(fbr_environment="Sandbox", scenario_id="SN001", invoice_items=[row])
		fake_db = SimpleNamespace(get_value=lambda *a, **k: "Goods at standard rate (default)")
		with patch(f"{MODULE}.frappe.db", fake_db):
			SaleTaxInvoice._apply_scenario_sale_type(doc)
		self.assertEqual(row.sale_type, "Goods at standard rate (default)")


class TestItemSaleTypeValidation(unittest.TestCase):
	def test_blank_sale_type_is_refused(self):
		doc = FakeDoc(invoice_items=[Row(idx=1, sale_type="")])
		with patch(f"{MODULE}.frappe.throw", side_effect=RuntimeError("blank")):
			with self.assertRaises(RuntimeError):
				SaleTaxInvoice._validate_item_sale_type(doc)

	def test_unknown_sale_type_is_refused(self):
		doc = FakeDoc(invoice_items=[Row(idx=1, sale_type="Not A Type")])
		fake_db = SimpleNamespace(exists=lambda *a, **k: False)
		with (
			patch(f"{MODULE}.frappe.db", fake_db),
			patch(f"{MODULE}.frappe.throw", side_effect=RuntimeError("unknown")),
		):
			with self.assertRaises(RuntimeError):
				SaleTaxInvoice._validate_item_sale_type(doc)

	def test_known_sale_type_passes(self):
		doc = FakeDoc(invoice_items=[Row(idx=1, sale_type="Exempt goods")])
		fake_db = SimpleNamespace(exists=lambda *a, **k: True)
		with patch(f"{MODULE}.frappe.db", fake_db):
			SaleTaxInvoice._validate_item_sale_type(doc)

	def test_exempt_row_still_sends_rate_exempt(self):
		from di.integrations.di_api import _format_rate

		self.assertEqual(_format_rate(0, "Exempt goods"), "Exempt")


class TestDebitNoteValidation(unittest.TestCase):
	def test_sale_invoice_skips_debit_note_checks(self):
		doc = FakeDoc(invoice_type="Sale Invoice")
		SaleTaxInvoice._validate_debit_note(doc)

	def test_return_against_from_other_seller_is_refused(self):
		doc = FakeDoc(
			invoice_type="Debit Note",
			return_against="STI-1",
			seller__business_name="Acme",
			fbr_environment="Production",
		)
		original = SimpleNamespace(
			docstatus=1,
			seller__business_name="Other Co",
			fbr_environment="Production",
			fbr_invoice_no="FBR-1",
		)
		with (
			patch(f"{MODULE}.frappe.db", SimpleNamespace(get_value=lambda *a, **k: original)),
			patch(f"{MODULE}.frappe.throw", side_effect=RuntimeError("other seller")),
		):
			with self.assertRaises(RuntimeError):
				SaleTaxInvoice._validate_debit_note(doc)

	def test_return_against_from_other_environment_is_refused(self):
		doc = FakeDoc(
			invoice_type="Debit Note",
			return_against="STI-1",
			seller__business_name="Acme",
			fbr_environment="Sandbox",
		)
		original = SimpleNamespace(
			docstatus=1,
			seller__business_name="Acme",
			fbr_environment="Production",
			fbr_invoice_no="FBR-1",
		)
		with (
			patch(f"{MODULE}.frappe.db", SimpleNamespace(get_value=lambda *a, **k: original)),
			patch(f"{MODULE}.frappe.throw", side_effect=RuntimeError("other environment")),
		):
			with self.assertRaises(RuntimeError):
				SaleTaxInvoice._validate_debit_note(doc)

	def test_matching_original_passes(self):
		doc = FakeDoc(
			invoice_type="Debit Note",
			return_against="STI-1",
			seller__business_name="Acme",
			fbr_environment="Production",
		)
		original = SimpleNamespace(
			docstatus=1,
			seller__business_name="Acme",
			fbr_environment="Production",
			fbr_invoice_no="FBR-1",
		)
		with patch(f"{MODULE}.frappe.db", SimpleNamespace(get_value=lambda *a, **k: original)):
			SaleTaxInvoice._validate_debit_note(doc)


class TestDebitNotePayload(unittest.TestCase):
	def test_debit_note_payload_carries_type_and_original_number(self):
		from di.integrations.sale_tax_invoice_api import build_sale_tax_invoice_payload

		doc = DebitNoteDoc(
			invoice_type="Debit Note",
			return_against="STI-1",
			invoice_date="2026-10-01",
			seller__business_name="Acme",
			seller_ntncnic="1234567",
			seller_province="PUNJAB",
			seller_address="Addr",
			buyer="Buyer Co",
			buyer_ntncnic="7654321",
			buyer_registration_type="Registered",
			buyer_province="PUNJAB",
			buyer_address="Buyer Addr",
			fbr_environment="Production",
			scenario_id="",
			invoice_items=[],
		)
		fake_db = SimpleNamespace(get_value=lambda *a, **k: "FBR-ORIGINAL-99")
		with patch("di.integrations.sale_tax_invoice_api.frappe.db", fake_db):
			payload = build_sale_tax_invoice_payload(doc)

		self.assertEqual(payload["invoiceType"], "Debit Note")
		self.assertEqual(payload["invoiceRefNo"], "FBR-ORIGINAL-99")


class TestMakeDebitNote(unittest.TestCase):
	def test_draft_is_blanked_and_repointed(self):
		original = FakeDoc(
			doctype="Sale Tax Invoice",
			name="STI-1",
			docstatus=1,
			fbr_invoice_no="FBR-1",
			fbr_environment="Production",
		)
		draft = FakeDoc(
			name="STI-DN-1",
			fbr_invoice_no="FBR-1",
			qr_code_data="<data>",
			qr_code="<img>",
			sandbox_run_status="FBR Validated",
			fbr_payload_hash="deadbeef",
			amended_from="STI-0",
			invoice_type="Sale Invoice",
			return_against="",
			fbr_environment="Production",
			insert=MagicMock(),
		)
		with (
			patch(f"{MODULE}.frappe.get_doc", return_value=original),
			patch(f"{MODULE}.frappe.has_permission", return_value=True),
			patch(f"{MODULE}.frappe.copy_doc", return_value=draft),
		):
			result = make_debit_note("STI-1")

		draft.insert.assert_called_once()
		self.assertEqual(result, draft.name)
		self.assertEqual(draft.fbr_invoice_no, "")
		self.assertEqual(draft.qr_code_data, "")
		self.assertEqual(draft.qr_code, "")
		self.assertEqual(draft.sandbox_run_status, "")
		self.assertEqual(draft.fbr_payload_hash, "")
		self.assertEqual(draft.amended_from, "")
		self.assertEqual(draft.invoice_type, "Debit Note")
		self.assertEqual(draft.return_against, "STI-1")

	def test_refused_when_original_not_submitted(self):
		original = FakeDoc(docstatus=0, fbr_invoice_no="")
		with (
			patch(f"{MODULE}.frappe.get_doc", return_value=original),
			patch(f"{MODULE}.frappe.has_permission", return_value=True),
			patch(f"{MODULE}.frappe.throw", side_effect=RuntimeError("not submitted")),
		):
			with self.assertRaises(RuntimeError):
				make_debit_note("STI-1")

	def test_refused_when_original_has_no_fbr_number(self):
		original = FakeDoc(docstatus=1, fbr_invoice_no="")
		with (
			patch(f"{MODULE}.frappe.get_doc", return_value=original),
			patch(f"{MODULE}.frappe.has_permission", return_value=True),
			patch(f"{MODULE}.frappe.throw", side_effect=RuntimeError("no number")),
		):
			with self.assertRaises(RuntimeError):
				make_debit_note("STI-1")


class TestBeforeSubmitPostsUnfiledDraft(unittest.TestCase):
	def test_before_submit_posts_when_number_blank(self):
		row = Row(
			sale_type="Goods at standard rate (default)",
			tax_rate_value=18,
			sro_schedule_no="",
			fixed_notified_value_or_retail_price=0,
		)
		doc = SubmitDoc(
			fbr_environment="Production",
			scenario_id="",
			invoice_items=[row],
			fbr_invoice_no="",
			owner="",
		)
		with (
			patch(f"{MODULE}.frappe.session", SimpleNamespace(user="user@example.com")),
			patch("di.panel.is_panel_user", return_value=False),
			patch("di.integrations.sale_tax_invoice_api.post_sale_tax_invoice") as post,
		):
			SaleTaxInvoice.before_submit(doc)

		post.assert_called_once_with(doc)
