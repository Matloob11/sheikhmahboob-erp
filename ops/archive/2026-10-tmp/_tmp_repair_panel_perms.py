"""One-shot: restore DI Panel User DocType access when Custom DocPerm hid DocPerm.

Run on the bench host as frappe:
  bench --site sheikhmahboob.com console < ops/_tmp_repair_panel_perms.py
or paste into bench console.
"""

from __future__ import annotations

import frappe

PANEL_ROLE = "DI Panel User"
PERM_FIELDS = (
	"read",
	"write",
	"create",
	"delete",
	"submit",
	"cancel",
	"amend",
	"report",
	"export",
	"import",
	"print",
	"email",
	"share",
	"select",
	"if_owner",
)

PANEL_WRITE = {
	"Sale Tax Invoice": {
		"read": 1,
		"write": 1,
		"create": 1,
		"delete": 0,
		"submit": 1,
		"cancel": 0,
		"amend": 0,
		"report": 1,
		"export": 1,
		"import": 0,
		"print": 1,
		"email": 1,
		"share": 0,
		"select": 1,
	},
	"Buyer": {
		"read": 1,
		"write": 1,
		"create": 1,
		"delete": 1,
		"submit": 0,
		"cancel": 0,
		"amend": 0,
		"report": 1,
		"export": 1,
		"import": 0,
		"print": 1,
		"email": 1,
		"share": 0,
		"select": 1,
	},
	"Tax Item": {
		"read": 1,
		"write": 1,
		"create": 1,
		"delete": 1,
		"submit": 0,
		"cancel": 0,
		"amend": 0,
		"report": 1,
		"export": 1,
		"import": 0,
		"print": 1,
		"email": 1,
		"share": 0,
		"select": 1,
	},
	"Seller Or Company": {
		"read": 1,
		"write": 1,
		"create": 1,
		"delete": 0,
		"submit": 0,
		"cancel": 0,
		"amend": 0,
		"report": 1,
		"export": 1,
		"import": 0,
		"print": 1,
		"email": 1,
		"share": 0,
		"select": 1,
	},
}

PANEL_READ = (
	"HS Code",
	"HS Uom",
	"Province",
	"Sale Type",
	"Transaction Type",
	"Scenario",
	"Sandbox Scenario",
	"SRO Schedule",
	"SRO Item",
	"DI Error Code",
)

PANEL_READ_RIGHTS = {
	"read": 1,
	"write": 0,
	"create": 0,
	"delete": 0,
	"submit": 0,
	"cancel": 0,
	"amend": 0,
	"report": 1,
	"export": 1,
	"import": 0,
	"print": 1,
	"email": 1,
	"share": 0,
	"select": 1,
}


def fill_gaps(doctype: str) -> int:
	if not frappe.db.exists("Custom DocPerm", {"parent": doctype}):
		return 0
	existing = {
		(row.role, int(row.permlevel or 0))
		for row in frappe.get_all(
			"Custom DocPerm", filters={"parent": doctype}, fields=["role", "permlevel"]
		)
	}
	added = 0
	for row in frappe.get_all("DocPerm", filters={"parent": doctype}, fields=["*"]):
		key = (row.role, int(row.permlevel or 0))
		if key in existing:
			continue
		values = {field: int(row.get(field) or 0) for field in PERM_FIELDS}
		frappe.get_doc(
			{
				"doctype": "Custom DocPerm",
				"parent": doctype,
				"parenttype": "DocType",
				"parentfield": "permissions",
				"role": row.role,
				"permlevel": int(row.permlevel or 0),
				**values,
			}
		).insert(ignore_permissions=True)
		existing.add(key)
		added += 1
	return added


def upsert(doctype: str, role: str, values: dict) -> None:
	name = frappe.db.exists(
		"Custom DocPerm", {"parent": doctype, "role": role, "permlevel": 0}
	)
	if name:
		doc = frappe.get_doc("Custom DocPerm", name)
		dirty = False
		for key, value in values.items():
			if int(doc.get(key) or 0) != int(value):
				doc.set(key, value)
				dirty = True
		if dirty:
			doc.save(ignore_permissions=True)
		return
	frappe.get_doc(
		{
			"doctype": "Custom DocPerm",
			"parent": doctype,
			"parenttype": "DocType",
			"parentfield": "permissions",
			"role": role,
			"permlevel": 0,
			**values,
		}
	).insert(ignore_permissions=True)


targets = set(PANEL_WRITE) | set(PANEL_READ)
for parent in frappe.get_all("Custom DocPerm", pluck="parent"):
	if parent:
		targets.add(parent)

gaps = 0
ensured = []
for doctype in sorted(targets):
	if not frappe.db.exists("DocType", doctype):
		continue
	gaps += fill_gaps(doctype)
	if not frappe.db.exists("Custom DocPerm", {"parent": doctype}):
		continue
	if doctype in PANEL_WRITE:
		upsert(doctype, PANEL_ROLE, PANEL_WRITE[doctype])
		ensured.append(doctype)
	elif doctype in PANEL_READ:
		upsert(doctype, PANEL_ROLE, PANEL_READ_RIGHTS)
		ensured.append(doctype)

frappe.db.commit()
frappe.clear_cache()

# Prove Subhan can read the key DocTypes.
email = "subhan.enterprise12@gmail.com"
checks = {}
if frappe.db.exists("User", email):
	for dt in [
		"Sale Tax Invoice",
		"Buyer",
		"Tax Item",
		"Seller Or Company",
		"HS Code",
		"HS Uom",
		"Sale Type",
		"Province",
	]:
		checks[dt] = bool(frappe.has_permission(dt, "read", user=email))

print({"gaps_filled": gaps, "panel_perms_ensured": ensured, "subhan_read": checks})
