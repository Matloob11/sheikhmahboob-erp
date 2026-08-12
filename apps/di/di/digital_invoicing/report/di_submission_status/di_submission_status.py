"""Which submitted invoices reached FBR, and which are still stuck.

Written as a script report rather than a query report on purpose. A query report
runs raw SQL, which bypasses User Permissions — a user restricted to one client
would still have seen every client's invoices. frappe.get_list applies those
restrictions; frappe.get_all would not, so it is deliberately not used here.
"""

import frappe
from frappe import _

STATUS_POSTED = "Posted"
STATUS_PENDING = "Not posted"


def execute(filters=None):
	filters = frappe._dict(filters or {})
	return _columns(), _rows(filters)


def _columns():
	return [
		{"label": _("Document Type"), "fieldname": "document_type", "fieldtype": "Data", "width": 130},
		{
			"label": _("Document"),
			"fieldname": "document",
			"fieldtype": "Dynamic Link",
			"options": "document_type",
			"width": 170,
		},
		{"label": _("Date"), "fieldname": "date", "fieldtype": "Date", "width": 100},
		{"label": _("Party"), "fieldname": "party", "fieldtype": "Data", "width": 200},
		{"label": _("Amount"), "fieldname": "amount", "fieldtype": "Currency", "width": 130},
		{"label": _("FBR Invoice No"), "fieldname": "fbr_invoice_no", "fieldtype": "Data", "width": 240},
		{"label": _("Attempts"), "fieldname": "attempts", "fieldtype": "Int", "width": 80},
		{"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 110},
	]


def _rows(filters):
	rows = []
	rows += _collect(
		"Sales Invoice", "di_integration_id", "posting_date", "customer", "grand_total", filters
	)
	rows += _collect(
		"Purchase Invoice", "di_integration_id", "posting_date", "supplier", "grand_total", filters
	)
	rows += _collect(
		"Sale Tax Invoice", "fbr_invoice_no", "invoice_date", "buyer", "total_sales_with_taxes", filters
	)

	rows.sort(key=lambda r: (r["date"] or "", r["document"]), reverse=True)
	return rows


def _collect(doctype, posted_field, date_field, party_field, amount_field, filters):
	if not frappe.db.exists("DocType", doctype):
		return []

	meta = frappe.get_meta(doctype)
	if not meta.has_field(posted_field):
		return []

	conditions = {"docstatus": 1}
	if filters.get("from_date"):
		conditions[date_field] = [">=", filters.from_date]
	if filters.get("to_date"):
		existing = conditions.get(date_field)
		conditions[date_field] = (
			["between", [filters.from_date, filters.to_date]] if existing else ["<=", filters.to_date]
		)
	if filters.get("status") == STATUS_POSTED:
		conditions[posted_field] = ["is", "set"]
	elif filters.get("status") == STATUS_PENDING:
		conditions[posted_field] = ["in", ["", None]]

	fields = ["name", date_field, party_field, amount_field, posted_field]
	if meta.has_field("di_post_attempts"):
		fields.append("di_post_attempts")

	# get_list, not get_all: this one honours User Permissions.
	records = frappe.get_list(
		doctype, filters=conditions, fields=fields, limit_page_length=0, ignore_permissions=False
	)

	rows = []
	for record in records:
		posted = record.get(posted_field)
		rows.append(
			{
				"document_type": doctype,
				"document": record.get("name"),
				"date": record.get(date_field),
				"party": record.get(party_field),
				"amount": record.get(amount_field),
				"fbr_invoice_no": posted or "",
				"attempts": record.get("di_post_attempts") or 0,
				"status": STATUS_POSTED if posted else STATUS_PENDING,
			}
		)
	return rows
