"""Payload construction, with no network and no database.

Every defect found in the 2026-08-12 review was a payload defect that a test at
this level would have caught: tax read from a field ERPNext 16 no longer has, so
every invoice was filed at 0%; the unit rate sent as FBR's notified retail price;
"Purchase Invoice" sent as an invoice type DI does not accept.
"""

import unittest

from di.integrations import di_api


class Row(dict):
	"""Stand-in for a Frappe child row: attribute and .get access, plus a name."""

	def __init__(self, name=None, **values):
		super().__init__(values)
		self.name = name
		self.idx = values.get("idx", 1)

	def __getattr__(self, item):
		try:
			return self[item]
		except KeyError as exc:
			raise AttributeError(item) from exc


class Doc:
	def __init__(self, **values):
		self.__dict__.update(values)

	def get(self, key, default=None):
		return self.__dict__.get(key, default)


def _invoice(taxes, item_wise=None, items=None):
	return Doc(
		doctype="Sales Invoice",
		name="SINV-TEST",
		taxes=taxes,
		items=items or [Row(name="item-row-1", item_code="ITEM-1", qty=1, net_amount=1000)],
		item_wise_tax_details=item_wise or [],
	)


class TestTaxMapping(unittest.TestCase):
	def test_reads_erpnext_16_child_table(self):
		"""v16 keys item-wise tax by child row name, not by item code."""
		doc = _invoice(
			taxes=[Row(name="tax-row-1", di_tax_type="Sales Tax", rate=18)],
			item_wise=[Row(item_row="item-row-1", tax_row="tax-row-1", rate=18, amount=180)],
		)
		self.assertEqual(
			di_api._get_taxes(doc),
			{"ITEM-1": {"Sales Tax": {"percentage": 18.0, "amount": 180.0}}},
		)

	def test_reads_pre_16_json_field(self):
		"""The older layout stored a JSON blob on the tax row, keyed by item code."""
		doc = _invoice(
			taxes=[
				Row(
					name="tax-row-1",
					di_tax_type="Sales Tax",
					item_wise_tax_detail='{"ITEM-1": [18, 180]}',
				)
			]
		)
		self.assertEqual(
			di_api._get_taxes(doc),
			{"ITEM-1": {"Sales Tax": {"percentage": 18.0, "amount": 180.0}}},
		)

	def test_tax_row_without_a_type_is_skipped(self):
		"""This is the bug that filed invoices at 0% — it must stay visible."""
		doc = _invoice(
			taxes=[Row(name="tax-row-1", di_tax_type="", rate=18)],
			item_wise=[Row(item_row="item-row-1", tax_row="tax-row-1", rate=18, amount=180)],
		)
		self.assertEqual(di_api._get_taxes(doc), {})

	def test_two_tax_rows_of_the_same_type_are_summed(self):
		doc = _invoice(
			taxes=[
				Row(name="tax-1", di_tax_type="Sales Tax"),
				Row(name="tax-2", di_tax_type="Sales Tax"),
			],
			item_wise=[
				Row(item_row="item-row-1", tax_row="tax-1", rate=18, amount=100),
				Row(item_row="item-row-1", tax_row="tax-2", rate=18, amount=80),
			],
		)
		self.assertEqual(di_api._get_taxes(doc)["ITEM-1"]["Sales Tax"]["amount"], 180.0)


class TestRateFormatting(unittest.TestCase):
	def test_exempt_sale_type_reports_exempt_not_a_percentage(self):
		self.assertEqual(di_api._format_rate(0, "Exempt goods"), "Exempt")

	def test_whole_percentages_have_no_decimals(self):
		self.assertEqual(di_api._format_rate(18, "Goods at standard rate (default)"), "18%")

	def test_fractional_percentages_keep_their_decimals(self):
		self.assertEqual(di_api._format_rate(1.5, "Goods at Reduced Rate"), "1.5%")

	def test_zero_rate_is_not_blank(self):
		self.assertEqual(di_api._format_rate(0, "Goods at zero-rate"), "0%")


class TestRounding(unittest.TestCase):
	def test_half_rounds_up_like_currency(self):
		self.assertEqual(di_api._round_currency("0.125"), 0.13)

	def test_blank_is_zero_not_an_error(self):
		self.assertEqual(di_api._round_currency(""), 0.0)
		self.assertEqual(di_api._round_currency(None), 0.0)
