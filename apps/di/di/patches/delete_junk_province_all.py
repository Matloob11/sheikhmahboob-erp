"""Remove the junk Province named ``all`` (code 0) when nothing links to it."""

import frappe


def execute():
	if not frappe.db.exists("Province", "all"):
		return
	# Nothing should link to this row; skip if something does.
	for doctype, field in (
		("Seller Or Company", "seller_province"),
		("Buyer", "buyer_province"),
		("DI Settings", "province"),
		("Sale Tax Invoice", "seller_province"),
	):
		if frappe.db.exists("DocType", doctype) and frappe.db.exists(doctype, {field: "all"}):
			frappe.logger().info("Leaving Province 'all' — still referenced")
			return
	frappe.delete_doc("Province", "all", ignore_permissions=True, force=True)
