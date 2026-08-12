"""Item event handlers for Digital Invoicing."""

import frappe


def before_save(doc, method=None):
	"""Hook: before_save on Item. Auto-populate HS UOM from HS Code."""
	if not doc.get("hs_code") or doc.get("hs_uom"):
		return

	uom = frappe.db.get_value("HS Code", doc.hs_code, "uom")

	if not uom:
		# Almost no HS Code ships with a UOM, and without one the invoice falls
		# back to the ERPNext UOM, which FBR rejects. Fetch this single code from
		# FBR and cache it. Never let a network problem block saving an item.
		try:
			from di.integrations.reference_api import fetch_hs_code_uom

			uom = fetch_hs_code_uom(doc.hs_code, company=doc.get("company"))
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"HS Code UOM lookup failed for {doc.hs_code}")

	if uom:
		doc.hs_uom = uom
