"""Remove the di_post_attempts custom fields.

They were added to count automatic retries. Automatic retrying was then removed:
after a lost reply we cannot tell whether FBR already holds the invoice, and
filing the same sale twice cannot be undone. Nothing writes the counter any
more, so leaving it would show a permanent zero on every invoice and in the
submission report.
"""

import frappe

DOCTYPES = ("Sales Invoice", "Purchase Invoice")


def execute():
	for doctype in DOCTYPES:
		name = frappe.db.get_value(
			"Custom Field", {"dt": doctype, "fieldname": "di_post_attempts"}, "name"
		)
		if name:
			frappe.delete_doc("Custom Field", name, ignore_permissions=True, force=True)

	frappe.db.commit()
