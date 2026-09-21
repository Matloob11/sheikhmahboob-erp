"""Tax Item quick-entry must include Sale Type so the rate can be chosen."""

import json
import unittest
from pathlib import Path

TAX_ITEM_JSON = (
	Path(__file__).resolve().parents[1]
	/ "digital_invoicing"
	/ "doctype"
	/ "tax_item"
	/ "tax_item.json"
)


class TestTaxItemQuickEntry(unittest.TestCase):
	def test_sale_type_is_on_the_new_item_dialog(self):
		meta = json.loads(TAX_ITEM_JSON.read_text(encoding="utf-8"))
		fields = {row["fieldname"]: row for row in meta["fields"]}
		self.assertEqual(fields["transaction_type"]["options"], "Transaction Type")
		self.assertTrue(fields["transaction_type"].get("allow_in_quick_entry"))
		for name in ("hs_code", "product_description", "product_uom", "tax_desc", "rate_in_p"):
			self.assertTrue(fields[name].get("allow_in_quick_entry"), name)
		order = meta["field_order"]
		self.assertLess(order.index("transaction_type"), order.index("tax_desc"))
