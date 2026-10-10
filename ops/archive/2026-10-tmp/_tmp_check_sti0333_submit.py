"""Diagnose why STI-0333 shows Save but not Submit. Read-only checks + perm inspect."""

import json

import frappe

frappe.init(site="sheikhmahboob.com")
frappe.connect()

name = "STI-0333"
email = "subhan.enterprise12@gmail.com"

if not frappe.db.exists("Sale Tax Invoice", name):
	print("MISSING", name)
	frappe.destroy()
	raise SystemExit(1)

meta = frappe.get_meta("Sale Tax Invoice")
print(
	"META",
	{
		"is_submittable": meta.is_submittable,
		"issingle": meta.issingle,
		"has_web_view": meta.has_web_view,
	},
)

doc = frappe.get_doc("Sale Tax Invoice", name)
print(
	"DOC",
	{
		"name": doc.name,
		"docstatus": doc.docstatus,
		"owner": doc.owner,
		"modified_by": doc.modified_by,
		"fbr_environment": doc.get("fbr_environment"),
		"fbr_invoice_no": doc.get("fbr_invoice_no"),
		"seller": doc.get("seller__business_name"),
		"buyer": doc.get("buyer"),
		"invoice_date": str(doc.get("invoice_date")),
		"scenario_id": doc.get("scenario_id"),
		"items": len(doc.get("invoice_items") or []),
	},
)

# Role DocPerm / Custom DocPerm for DI Panel User on Sale Tax Invoice
for doctype in ("DocPerm", "Custom DocPerm"):
	rows = frappe.get_all(
		doctype,
		filters={"parent": "Sale Tax Invoice", "role": "DI Panel User"},
		fields=[
			"name",
			"role",
			"permlevel",
			"read",
			"write",
			"create",
			"submit",
			"cancel",
			"amend",
			"delete",
		],
	)
	print(doctype, json.dumps(rows, default=str, indent=2))

# Effective permission for Subhan
for ptype in ("read", "write", "create", "submit", "cancel", "amend", "delete"):
	print(
		"HAS",
		ptype,
		frappe.has_permission("Sale Tax Invoice", ptype, doc=doc, user=email),
	)

# Also check without doc (role-level)
for ptype in ("read", "write", "create", "submit"):
	print("HAS_ROLELEVEL", ptype, frappe.has_permission("Sale Tax Invoice", ptype, user=email))

roles = frappe.get_roles(email)
print("ROLES", roles)

# Workflow?
if frappe.db.exists("Workflow", {"document_type": "Sale Tax Invoice"}):
	wfs = frappe.get_all(
		"Workflow",
		filters={"document_type": "Sale Tax Invoice", "is_active": 1},
		fields=["name", "workflow_state_field"],
	)
	print("WORKFLOW", wfs)
else:
	print("WORKFLOW", None)

# Any draft validation that would block submit on client? print required empty fields
required_empty = []
for df in meta.fields:
	if df.reqd and not doc.get(df.fieldname) and df.fieldtype not in (
		"Section Break",
		"Column Break",
		"Tab Break",
		"HTML",
		"Table",
	):
		required_empty.append(df.fieldname)
print("REQUIRED_EMPTY", required_empty)
print("HAS_ITEMS", bool(doc.get("invoice_items")))

frappe.destroy()
