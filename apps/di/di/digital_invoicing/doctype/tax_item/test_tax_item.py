# Copyright (c) 2026, kodlyft and Contributors
# See license.txt

from frappe.tests.utils import FrappeTestCase


def assert_tax_item_hs_code_meta():
	import frappe

	meta = frappe.get_meta("Tax Item")
	field = meta.get_field("hs_code")
	assert field.fieldtype == "Link", f"expected Link, got {field.fieldtype}"
	assert field.options == "HS Code", f"expected HS Code options, got {field.options}"

	hs_code_meta = frappe.get_meta("HS Code")
	search_fields = {field.strip() for field in (hs_code_meta.search_fields or "").split(",") if field.strip()}
	assert {"hs_code", "short_description", "description"}.issubset(search_fields)


def assert_tax_item_hs_code_detail_lookup():
	import frappe

	from di.digital_invoicing.doctype.tax_item.tax_item import get_hs_code_details

	uom = "CODEX TEST UOM"
	hs_code = "CODEX.0001"
	created_uom = False
	created_hs_code = False

	try:
		if not frappe.db.exists("HS Uom", uom):
			frappe.get_doc({"doctype": "HS Uom", "uom_name": uom, "uom_id": 99999}).insert(
				ignore_permissions=True
			)
			created_uom = True

		if not frappe.db.exists("HS Code", hs_code):
			frappe.get_doc(
				{
					"doctype": "HS Code",
					"hs_code": hs_code,
					"description": "Codex parent group - Codex practical option - Codex final item",
					"uom": uom,
				}
			).insert(ignore_permissions=True)
			created_hs_code = True

		details = get_hs_code_details(hs_code)
		assert details["product_description"] == "Codex final item"
		assert details["product_uom"] == uom
		assert details["description"] == "Codex parent group - Codex practical option - Codex final item"
		assert [option["value"] for option in details["description_options"][:3]] == [
			"Codex final item",
			"Codex practical option",
			"Codex parent group",
		]
	finally:
		if created_hs_code:
			frappe.delete_doc("HS Code", hs_code, force=True, ignore_permissions=True)
		if created_uom:
			frappe.delete_doc("HS Uom", uom, force=True, ignore_permissions=True)


def assert_tax_item_product_uom_options_are_curated_only():
	import frappe

	from di.constants import PRODUCT_UOM_OPTIONS
	from di.digital_invoicing.doctype.tax_item.tax_item import get_product_uom_options

	uom = "CODEX CARTON"
	hs_code = "CODEX.UOM1"
	hs_code_uom = "CODEX CRATE / KG"
	created_uom = False
	created_hs_code = False

	try:
		if not frappe.db.exists("HS Uom", uom):
			frappe.get_doc({"doctype": "HS Uom", "uom_name": uom, "uom_id": 99998}).insert(
				ignore_permissions=True
			)
			created_uom = True

		if not frappe.db.exists("HS Code", hs_code):
			frappe.get_doc(
				{
					"doctype": "HS Code",
					"hs_code": hs_code,
					"description": "Codex UOM option test",
				}
			).insert(ignore_permissions=True)
			created_hs_code = True

		frappe.db.set_value("HS Code", hs_code, "uom", hs_code_uom, update_modified=False)

		options = get_product_uom_options()
		values = [option["value"] for option in options]

		assert values == list(PRODUCT_UOM_OPTIONS)
		assert options[0]["label"] == "1. MT"
		assert options[0]["search_text"] == "1 MT"
		assert uom not in values
		assert hs_code_uom not in values
	finally:
		if created_hs_code:
			frappe.delete_doc("HS Code", hs_code, force=True, ignore_permissions=True)
		if created_uom:
			frappe.delete_doc("HS Uom", uom, force=True, ignore_permissions=True)


def assert_tax_item_rate_helpers_handle_fbr_rows():
	from di.digital_invoicing.doctype.tax_item.tax_item import _normalise_rate_row, _select_rate_option

	normalised = _normalise_rate_row(
		{
			"ratE_ID": 734,
			"ratE_DESC": "18% along with rupees 60 per kilogram",
			"ratE_VALUE": 18,
		}
	)
	assert normalised == {
		"rate_id": 734,
		"tax_desc": "18% along with rupees 60 per kilogram",
		"rate_in_p": 18,
	}

	selected, ambiguous = _select_rate_option(
		[
			normalised,
			{"rate_id": 280, "tax_desc": "0%", "rate_in_p": 0},
		],
		"KG",
	)
	assert selected["rate_id"] == 734
	assert ambiguous is False


class TestTaxItem(FrappeTestCase):
	def test_hs_code_uses_hs_code_master(self):
		meta = self.get_meta("Tax Item")
		field = meta.get_field("hs_code")

		self.assertEqual(field.fieldtype, "Link")
		self.assertEqual(field.options, "HS Code")

	def test_hs_code_search_matches_code_and_descriptions(self):
		meta = self.get_meta("HS Code")
		search_fields = {field.strip() for field in (meta.search_fields or "").split(",") if field.strip()}

		self.assertIn("hs_code", search_fields)
		self.assertIn("short_description", search_fields)
		self.assertIn("description", search_fields)

	def test_hs_code_detail_lookup_returns_product_fields(self):
		assert_tax_item_hs_code_detail_lookup()

	def test_product_uom_options_are_curated_only(self):
		assert_tax_item_product_uom_options_are_curated_only()

	def test_tax_rate_context_fields_exist(self):
		meta = self.get_meta("Tax Item")

		self.assertEqual(meta.get_field("transaction_type").options, "Transaction Type")
		self.assertEqual(meta.get_field("rate_id").fieldtype, "Int")
		self.assertEqual(meta.get_field("rate_id").read_only, 1)
		self.assertEqual(meta.get_field("rate_in_p").reqd, 1)

	def test_tax_rate_helpers_handle_fbr_rows(self):
		assert_tax_item_rate_helpers_handle_fbr_rows()

	def get_meta(self, doctype):
		import frappe

		return frappe.get_meta(doctype)
