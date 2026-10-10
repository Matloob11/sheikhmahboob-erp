"""Whitelisted FBR method guards and filed-field hardening (P0-1)."""

import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from di.tests import scoped_user
from di.tests.test_client_panel import FakeDoc


class TestApiGuards(unittest.TestCase):
	def test_unsupported_doctype_is_refused(self):
		from di.api import get_invoice_preview

		with self.assertRaises(Exception):
			with patch("di.api.frappe.throw", side_effect=RuntimeError("bad")):
				get_invoice_preview("Item", "ITEM-1")

	def test_non_permitted_user_cannot_post(self):
		from di.api import post_sale_tax_invoice

		doc = FakeDoc(
			doctype="Sale Tax Invoice",
			name="STI-1",
			docstatus=1,
			fbr_invoice_no="",
		)
		with (
			patch("di.api.frappe.get_doc", return_value=doc),
			patch("di.api.frappe.has_permission", side_effect=PermissionError("no")),
		):
			with self.assertRaises(PermissionError):
				post_sale_tax_invoice("STI-1")

	def test_numbered_production_invoice_refused_even_for_system_manager(self):
		from di.api import post_sale_tax_invoice

		doc = FakeDoc(
			doctype="Sale Tax Invoice",
			name="STI-1",
			docstatus=1,
			fbr_invoice_no="FBR-ALREADY",
			fbr_environment="Production",
		)
		with (
			patch("di.api.frappe.get_doc", return_value=doc),
			patch("di.api.frappe.has_permission", return_value=True),
			patch("di.api.frappe.throw", side_effect=RuntimeError("already filed")),
			patch("di.integrations.sale_tax_invoice_api.post_sale_tax_invoice") as post,
		):
			with self.assertRaises(RuntimeError):
				post_sale_tax_invoice("STI-1")
			post.assert_not_called()

	def test_post_sale_tax_invoice_persists_via_db_set_not_memory_only(self):
		"""The API call operates on an already-submitted doc with no enclosing
		save(); resync=True is what makes _apply_success db_set the number
		instead of setting it only on the in-memory doc, where it would be
		lost the moment the caller reloads."""
		from di.api import post_sale_tax_invoice

		doc = FakeDoc(
			doctype="Sale Tax Invoice",
			name="STI-1",
			docstatus=1,
			fbr_invoice_no="",
		)
		with (
			patch("di.api.frappe.get_doc", return_value=doc),
			patch("di.api.frappe.has_permission", return_value=True),
			patch("di.integrations.sale_tax_invoice_api.post_sale_tax_invoice") as post,
		):
			post_sale_tax_invoice("STI-1")
			post.assert_called_once_with(doc, resync=True)

	def test_clear_fbr_invoice_no_refused_when_post_success_log_exists(self):
		from di.api import clear_fbr_invoice_no

		doc = FakeDoc(
			doctype="Sale Tax Invoice",
			name="STI-1",
			fbr_invoice_no="FBR-1",
			fbr_environment="Production",
			db_set=MagicMock(),
		)
		fake_db = SimpleNamespace(exists=lambda *a, **k: "LOG-1")
		with (
			patch("di.api.frappe.get_roles", return_value=["System Manager"]),
			patch("di.api.frappe.get_doc", return_value=doc),
			patch("di.api.frappe.has_permission", return_value=True),
			patch("di.api.frappe.db", fake_db),
			patch("di.api.frappe.throw", side_effect=RuntimeError("blocked")),
		):
			with self.assertRaises(RuntimeError):
				clear_fbr_invoice_no("STI-1", "oops")

	def test_filed_fields_are_permlevel_1_and_no_copy(self):
		path = (
			Path(__file__).resolve().parents[1]
			/ "digital_invoicing"
			/ "doctype"
			/ "sale_tax_invoice"
			/ "sale_tax_invoice.json"
		)
		meta = json.loads(path.read_text(encoding="utf-8"))
		by_name = {f["fieldname"]: f for f in meta["fields"] if f.get("fieldname")}
		for fieldname in ("fbr_invoice_no", "qr_code_data", "qr_code", "sandbox_run_status"):
			self.assertEqual(by_name[fieldname].get("permlevel"), 1, fieldname)
			self.assertEqual(by_name[fieldname].get("no_copy"), 1, fieldname)
		sm_pl1 = [
			p
			for p in meta["permissions"]
			if p.get("role") == "System Manager" and p.get("permlevel") == 1
		]
		self.assertTrue(sm_pl1)
		self.assertEqual(sm_pl1[0].get("write"), 1)
		# Panel (and Accounts) may read FBR number / QR but must not write them.
		for role in ("DI Panel User", "Accounts User"):
			pl1 = [
				p for p in meta["permissions"] if p.get("role") == role and p.get("permlevel") == 1
			]
			self.assertTrue(pl1, role)
			self.assertEqual(pl1[0].get("read"), 1, role)
			self.assertNotEqual(pl1[0].get("write"), 1, role)


class TestPanelCreateScope(unittest.TestCase):
	def test_panel_cannot_create_invoice_under_other_seller(self):
		from di.panel import has_seller_scoped_permission

		other = FakeDoc(
			doctype="Sale Tax Invoice",
			seller__business_name="Other Co",
			_is_new=True,
		)
		own = FakeDoc(doctype="Sale Tax Invoice", seller__business_name="Acme", _is_new=True)
		blank = FakeDoc(doctype="Sale Tax Invoice", seller__business_name=None, _is_new=True)
		with scoped_user(panel=True, demo=False), patch(
			"di.panel.get_allowed_sellers", return_value=["Acme"]
		):
			self.assertFalse(has_seller_scoped_permission(other, "create"))
			self.assertTrue(has_seller_scoped_permission(own, "create"))
			self.assertTrue(has_seller_scoped_permission(blank, "create"))

	def test_panel_cannot_repoint_draft_to_other_seller(self):
		from di.panel import has_seller_scoped_permission

		doc = FakeDoc(
			doctype="Sale Tax Invoice",
			name="STI-1",
			seller__business_name="Acme",
			_is_new=False,
		)
		fake_db = SimpleNamespace(get_value=lambda *a, **k: "Other Co")
		with (
			scoped_user(panel=True, demo=False),
			patch("di.panel.get_allowed_sellers", return_value=["Acme"]),
			# Stored seller is still the other client's — set_value must not pass.
			patch("di.panel.frappe.db", fake_db),
		):
			self.assertFalse(has_seller_scoped_permission(doc, "write"))

	def test_get_tax_rate_details_refuses_other_sellers_credentials(self):
		from di.digital_invoicing.doctype.tax_item import tax_item as tax_item_mod

		with (
			patch.object(tax_item_mod.frappe, "has_permission", return_value=True),
			patch.object(
				tax_item_mod,
				"_resolve_transaction_type",
				return_value={"transaction_type": "Goods", "transaction_type_id": 1},
			),
			patch(
				"di.integrations.seller_credentials.resolve_seller_arg",
				return_value="Other Co",
			),
			patch(
				"di.integrations.seller_credentials.seller_fbr_context",
				side_effect=PermissionError("other seller"),
			),
		):
			with self.assertRaises(PermissionError):
				tax_item_mod.get_tax_rate_details(
					hs_code="0101.2100",
					product_uom="KG",
					transaction_type="Goods at standard rate",
					seller="Other Co",
				)
