"""Sales Invoice event handlers for Digital Invoicing."""

import frappe
from frappe import _
from frappe.utils import cint, flt

from di.constants import SRO_REQUIRED_SALE_TYPES


def before_validate(doc, method=None):
	"""Hook: before_validate on Sales Invoice. Populate DI item fields from Item Master."""
	_populate_di_item_fields(doc)


def before_submit(doc, method=None):
	"""Hook: before_submit on Sales Invoice."""
	from di.digital_invoicing.doctype.di_settings.di_settings import get_settings, is_enabled

	_populate_di_item_fields(doc)

	if not is_enabled(doc.company):
		return

	settings = get_settings(doc.company)
	if not settings:
		return

	if cint(doc.is_pos) and doc.pos_profile:
		profile = frappe.get_doc("POS Profile", doc.pos_profile)
		if cint(getattr(profile, "enable_fbr_integration", 0)):
			_validate_pos_items(doc)
			from di.integrations.pos_fiscal import fiscalize_invoice

			fiscalize_invoice(doc)
			return
		return

	if doc.customer and not cint(frappe.db.get_value("Customer", doc.customer, "enable_digital_invoicing")):
		return

	_validate_di_items(doc)
	_validate_tax_types(doc)

	if settings.auto_post_on_submit:
		from di.integrations.di_api import post_invoice

		post_invoice(doc)


def _validate_di_items(doc):
	"""Validate that items have required DI fields."""
	for item in doc.items:
		if not item.get("di_hs_code"):
			frappe.throw(
				_("Row {0}: HS Code is required for Digital Invoicing (Item: {1})").format(
					item.idx, item.item_name
				)
			)

		sale_type = item.get("di_sale_type") or ""
		if sale_type in SRO_REQUIRED_SALE_TYPES:
			if not item.get("di_sro_serial_no") and not item.get("di_schedule_no"):
				frappe.throw(
					_(
						"Row {0}: SRO Serial No or Schedule No is required for sale type '{1}' (Item: {2})"
					).format(item.idx, sale_type, item.item_name)
			)


def _validate_tax_types(doc):
	"""Refuse to submit a taxed invoice whose tax rows are not typed for FBR.

	A tax row without di_tax_type is skipped when the payload is built, so the
	invoice would be filed showing 0% sales tax while ERPNext shows the tax
	charged. That failure is invisible until someone reconciles with FBR, so it
	is worth blocking rather than warning.
	"""
	untyped = [
		tax
		for tax in doc.get("taxes") or []
		if flt(tax.get("tax_amount")) and not tax.get("di_tax_type")
	]
	if not untyped:
		return

	rows = ", ".join(str(tax.idx) for tax in untyped)
	frappe.throw(
		_(
			"Tax row(s) {0} have no Tax Type. Set it to Sales Tax, Further Tax or Advance Tax, "
			"otherwise this invoice would be reported to FBR with zero sales tax."
		).format(rows)
	)


def _populate_di_item_fields(doc):
	"""Fill missing Sales Invoice Item DI fields from the linked Item."""
	item_codes = sorted({item.get("item_code") for item in doc.items if item.get("item_code")})
	if not item_codes:
		return

	item_data = {
		row.name: row
		for row in frappe.get_all(
			"Item",
			filters={"name": ["in", item_codes]},
			fields=[
				"name",
				"hs_code",
				"hs_uom",
				"sale_type",
				"sro_item_serial_no",
				"sro_schedule_no",
				"fixed_notified_value",
			],
		)
	}

	for item in doc.items:
		if not item.get("item_code"):
			continue

		master = item_data.get(item.item_code)
		if not master:
			continue

		if not item.get("di_hs_code") and master.get("hs_code"):
			item.di_hs_code = master.hs_code
		if not item.get("di_hs_uom") and master.get("hs_uom"):
			item.di_hs_uom = master.hs_uom
		if not item.get("di_sale_type") and master.get("sale_type"):
			item.di_sale_type = master.sale_type
		if not item.get("di_sro_serial_no") and master.get("sro_item_serial_no"):
			item.di_sro_serial_no = master.sro_item_serial_no
		if not item.get("di_schedule_no") and master.get("sro_schedule_no"):
			item.di_schedule_no = master.sro_schedule_no
		if not item.get("di_fixed_notified_value") and master.get("fixed_notified_value"):
			item.di_fixed_notified_value = master.fixed_notified_value


def _validate_pos_items(doc):
	"""Validate POS items have required fields for FBR fiscal."""
	for item in doc.items:
		item_code = item.get("item_code")
		if not item_code:
			continue
		pct_code = frappe.db.get_value("Item", item_code, "customs_tariff_number")
		if not pct_code:
			frappe.throw(
				_(
					"Row {0}: Item {1} is missing Customs Tariff Number (PCT Code) required for FBR POS."
				).format(item.idx, item.item_name)
			)
