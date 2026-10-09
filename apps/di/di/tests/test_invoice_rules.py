"""Digital invoice rules — no Frappe site, no FBR network."""

import json
import unittest
from decimal import Decimal
from pathlib import Path

from di.invoice_rules import (
	extra_rupees_per_qty,
	fallback_retail_price,
	fbr_product_description,
	is_retryable_fbr_error,
	is_unassigned_scenario_error,
	petroleum_levy_on,
	row_needs_retail_price,
	row_needs_sro,
	settled_retail_price,
)

ITEM_JSON = (
	Path(__file__).resolve().parents[1]
	/ "digital_invoicing"
	/ "doctype"
	/ "sale_tax_invoice_item"
	/ "sale_tax_invoice_item.json"
)
INVOICE_JS = (
	Path(__file__).resolve().parents[1]
	/ "digital_invoicing"
	/ "doctype"
	/ "sale_tax_invoice"
	/ "sale_tax_invoice.js"
)


class TestSroRequired(unittest.TestCase):
	def test_reduced_and_mobile_need_sro_even_at_18(self):
		self.assertTrue(row_needs_sro(1, "Goods at Reduced Rate"))
		self.assertTrue(row_needs_sro(18, "Mobile Phones"))
		self.assertTrue(row_needs_sro(18, "Petroleum Products"))
		self.assertTrue(row_needs_sro(1, "Electric Vehicle"))
		self.assertTrue(row_needs_sro(18, "Potassium Chlorate"))
		self.assertTrue(row_needs_sro(200, "CNG Sales"))
		self.assertTrue(row_needs_sro(0, "Exempt goods"))
		self.assertTrue(row_needs_sro(25, "Goods as per SRO.297(|)/2023"))

	def test_standard_telecom_power_and_third_schedule_do_not_need_sro(self):
		self.assertFalse(row_needs_sro(18, "Goods at standard rate (default)"))
		self.assertFalse(row_needs_sro(17, "Telecommunication services"))
		self.assertFalse(row_needs_sro(5, "Electricity Supply to Retailers"))
		self.assertFalse(row_needs_sro(18, "Ship breaking"))
		self.assertFalse(row_needs_sro(18, "Steel melting and re-rolling"))
		self.assertFalse(row_needs_sro(18, "3rd Schedule Goods"))

	def test_third_schedule_needs_a_positive_retail_price(self):
		self.assertTrue(row_needs_retail_price("3rd Schedule Goods", 0))
		self.assertTrue(row_needs_retail_price("3rd Schedule Goods", None))
		self.assertFalse(row_needs_retail_price("3rd Schedule Goods", 1000))
		self.assertFalse(row_needs_retail_price("Goods at standard rate (default)", 0))
		self.assertTrue(row_needs_retail_price("Goods as per SRO.297(|)/2023", 0))
		self.assertFalse(row_needs_retail_price("Goods as per SRO.297(|)/2023", 1000))
		self.assertEqual(fallback_retail_price(1000, 0), 1000)
		self.assertEqual(fallback_retail_price(1000, 45000), 45000)
		self.assertEqual(settled_retail_price("3rd Schedule Goods", 0, 0), 1000)
		self.assertEqual(settled_retail_price("Goods as per SRO.297(|)/2023", 0, 2500), 2500)
		self.assertEqual(settled_retail_price("Goods at standard rate (default)", 0, 1000), 0)
		self.assertEqual(
			fbr_product_description("Petroleum Products (PUNJAB P.V.C PIPE FACTORY)", "Petroleum Products"),
			"Petroleum Products",
		)
		self.assertEqual(
			fbr_product_description("IRON AND STEEL (Pak Defence Techno Crafts)", "Steel melting and re-rolling"),
			"IRON AND STEEL",
		)
		self.assertEqual(
			fbr_product_description("SN024 PUNJAB P.V.C PIPE FACTORY", "Goods as per SRO.297(|)/2023"),
			"SN024 PUNJAB P.V.C PIPE FACTORY",
		)

	def test_filled_schedule_never_needs_another(self):
		self.assertFalse(row_needs_sro(1, "Goods at Reduced Rate", "EIGHTH SCHEDULE Table 1"))


class TestExtraRupeesAndLevy(unittest.TestCase):
	def test_chlorate_adds_sixty_rupees_per_kg(self):
		self.assertEqual(extra_rupees_per_qty("18% along with rupees 60 per kilogram"), Decimal("60"))
		self.assertEqual(extra_rupees_per_qty("18% and Rs. 80 per Liter"), Decimal("80"))
		self.assertEqual(extra_rupees_per_qty("Rs.2"), Decimal("0"))
		self.assertEqual(extra_rupees_per_qty(""), Decimal("0"))

	def test_petroleum_levy_is_quantity(self):
		self.assertEqual(petroleum_levy_on("Petroleum Products", 123), 123.0)
		self.assertEqual(petroleum_levy_on("Petroleum Products", 0), 1.0)
		self.assertIsNone(petroleum_levy_on("Goods at standard rate (default)", 1))


class TestInvoiceFormHasSroSelects(unittest.TestCase):
	def test_schedule_field_is_a_link_select_and_visible(self):
		meta = json.loads(ITEM_JSON.read_text(encoding="utf-8"))
		fields = {row["fieldname"]: row for row in meta["fields"]}
		schedule = fields["sro_schedule_no"]
		self.assertEqual(schedule["fieldtype"], "Link")
		self.assertEqual(schedule["options"], "SRO Schedule")
		self.assertTrue(schedule.get("in_list_view"))
		self.assertTrue(fields["sro_item_serial_no"].get("in_list_view"))
		self.assertTrue(fields["fixed_notified_value_or_retail_price"].get("fetch_if_empty"))

	def test_efs_and_wrong_rate_are_retryable(self):
		self.assertTrue(
			is_retryable_fbr_error(
				"You are not an EFS license holder who has imported Compressor Scrap"
			)
		)
		self.assertTrue(
			is_retryable_fbr_error(
				"Provided Rate is not correct. Please provide valid rate for selected Sales Type."
			)
		)
		self.assertTrue(
			is_retryable_fbr_error(
				"Provided UoM is not allowed against the provided HS Code. Provide valid UOM"
			)
		)
		self.assertTrue(
			is_retryable_fbr_error(
				"Declared price is less than minimum notified price. Minimum price is 202,455."
			)
		)
		self.assertTrue(
			is_retryable_fbr_error(
				"Fixed/Notified Value or Retail Price is mandatory. Where sale type is "
				'"3rd Schedule Goods", Fixed/Notified value or Retail Price is mandatory.'
			)
		)
		self.assertFalse(is_retryable_fbr_error("Buyer NTN is invalid"))
		self.assertTrue(is_unassigned_scenario_error("Provided scenario does not exists"))
		self.assertFalse(is_unassigned_scenario_error("Compressor Scrap"))

	def test_form_loads_serials_when_schedule_is_picked(self):
		js = INVOICE_JS.read_text(encoding="utf-8")
		self.assertIn("sro_schedule_no(frm, cdt, cdn)", js)
		self.assertIn("get_sro_serials_for_schedule", js)
		self.assertIn("row_needs_sro", js)
		self.assertIn("saleTypeNeedsRetailPrice", js)
		self.assertIn("Goods as per SRO.297(|)/2023", js)
		self.assertIn("extraRupeesPerQty", js)
		self.assertIn("rupees|rs", js)
		self.assertIn("settled", js)
		self.assertNotIn("flt(row.tax_rate_value) !== 18", js)


class TestBuyerBusinessName(unittest.TestCase):
	def test_only_the_sellers_own_suffix_is_stripped(self):
		from di.invoice_rules import fbr_buyer_business_name

		seller = "SUBHAN ENTERPRISES"
		name = "University of Education"
		self.assertEqual(fbr_buyer_business_name(f"{name} ({seller})", seller), name)
		self.assertEqual(fbr_buyer_business_name(f"{name} ({seller}) 2", seller), name)
		self.assertEqual(fbr_buyer_business_name(name, seller), name)
		self.assertEqual(fbr_buyer_business_name("X Traders (Regd)", seller), "X Traders (Regd)")
		self.assertEqual(fbr_buyer_business_name("X Traders (Regd)", ""), "X Traders (Regd)")
		self.assertEqual(fbr_buyer_business_name("(SUBHAN ENTERPRISES)", seller), "(SUBHAN ENTERPRISES)")
		self.assertEqual(fbr_buyer_business_name("", seller), "")

