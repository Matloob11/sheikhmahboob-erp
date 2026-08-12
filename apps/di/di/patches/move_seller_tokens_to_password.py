"""Move Seller Or Company FBR tokens out of plain text.

`sandbox_token` and `production_token` were `Data` fields, so every token sat
readable in the table and in any list export. Anyone holding the Accounts User
role could take a client's token and post invoices under that client's tax
identity. The fields are now `Password`, which keeps the value in the auth table
and leaves only asterisks in the column.

Changing the fieldtype does not move the existing values, so this patch reads
what the old field left behind and stores it properly.
"""

import frappe

FIELDS = ("sandbox_token", "production_token")


def _is_masked(value):
	return bool(value) and set(value) == {"*"}


def execute():
	if not frappe.db.exists("DocType", "Seller Or Company"):
		return

	moved = 0
	for name in frappe.get_all("Seller Or Company", pluck="name"):
		plaintext = {}
		for field in FIELDS:
			value = frappe.db.get_value("Seller Or Company", name, field)
			if value and not _is_masked(value):
				plaintext[field] = value

		if not plaintext:
			continue

		doc = frappe.get_doc("Seller Or Company", name)
		for field, value in plaintext.items():
			doc.set(field, value)
		# Saving runs Frappe's password handling: the value goes to the auth
		# table and the column is replaced with asterisks.
		doc.save(ignore_permissions=True)
		moved += len(plaintext)

	if moved:
		frappe.db.commit()
		print(f"Moved {moved} Seller Or Company token(s) to encrypted storage")
