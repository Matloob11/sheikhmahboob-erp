"""UOM seed / fetch_if_empty / sync-blank-only (P1-2)."""

import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from di.tests.test_client_panel import FakeDoc


class TestSeedHsUoms(unittest.TestCase):
	def test_seed_issues_no_delete_or_hs_code_null(self):
		from di import seed_data

		sql_calls = []
		fake_db = SimpleNamespace(
			exists=lambda *a, **k: a[0] == "DocType",
			sql=lambda *a, **k: sql_calls.append(a),
			set_value=MagicMock(),
		)
		with (
			patch.object(seed_data.frappe, "db", fake_db),
			patch.object(seed_data.frappe, "delete_doc") as delete_doc,
			patch.object(seed_data.frappe, "get_doc", return_value=SimpleNamespace(insert=MagicMock())),
			patch.object(seed_data.frappe, "get_all", return_value=[]),
		):
			seed_data.seed_hs_uoms()

		delete_doc.assert_not_called()
		self.assertFalse(any("update `tabHS Code`" in str(c).lower() for c in sql_calls))


class TestItemJsonAndSync(unittest.TestCase):
	def test_item_json_has_fetch_if_empty_not_read_only(self):
		path = (
			Path(__file__).resolve().parents[1]
			/ "digital_invoicing"
			/ "doctype"
			/ "sale_tax_invoice_item"
			/ "sale_tax_invoice_item.json"
		)
		meta = json.loads(path.read_text(encoding="utf-8"))
		by_name = {f["fieldname"]: f for f in meta["fields"] if f.get("fieldname")}
		for fieldname in ("uom", "hs_code"):
			self.assertEqual(by_name[fieldname].get("fetch_if_empty"), 1, fieldname)
			self.assertNotEqual(by_name[fieldname].get("read_only"), 1, fieldname)

	def test_sync_keeps_existing_uom(self):
		from di.digital_invoicing.doctype.sale_tax_invoice.sale_tax_invoice import SaleTaxInvoice

		row = SimpleNamespace(
			description="ITEM-1",
			hs_code="7204.4100",
			uom="Numbers, pieces, units",
			sale_type="Goods at standard rate (default)",
			idx=1,
			get=lambda k, d=None: getattr(row, k, d),
		)
		doc = FakeDoc(invoice_items=[row])
		fake_db = SimpleNamespace(
			get_value=lambda *a, **k: SimpleNamespace(
				hs_code="7204.4100",
				product_uom="KG",
				tax_desc="18%",
				rate_in_p=18,
				fixed_rs=0,
				transaction_type="Goods at standard rate (default)",
			),
			exists=lambda *a, **k: True,
		)
		with patch(
			"di.digital_invoicing.doctype.sale_tax_invoice.sale_tax_invoice.frappe.db", fake_db
		):
			SaleTaxInvoice._sync_item_details(doc)
		self.assertEqual(row.uom, "Numbers, pieces, units")


class TestTaxItemUomValidate(unittest.TestCase):
	def test_new_unknown_uom_is_refused(self):
		from di.digital_invoicing.doctype.tax_item.tax_item import TaxItem

		doc = SimpleNamespace(
			product_uom="NotARealUom",
			tax_desc="18%",
			rate_in_p=18,
			is_new=lambda: True,
			has_value_changed=lambda f: True,
			get=lambda k, d=None: getattr(doc, k, d),
		)
		fake_db = SimpleNamespace(exists=lambda *a, **k: False)
		with (
			patch("di.digital_invoicing.doctype.tax_item.tax_item.frappe.db", fake_db),
			patch(
				"di.digital_invoicing.doctype.tax_item.tax_item.frappe.throw",
				side_effect=RuntimeError("bad uom"),
			),
		):
			with self.assertRaises(RuntimeError):
				TaxItem.validate(doc)
