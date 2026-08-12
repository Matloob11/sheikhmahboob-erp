"""Scheduled work for Digital Invoicing.

Before this existed a failed FBR submission simply stopped. The invoice stayed
submitted in ERPNext with no FBR number, and it was only re-sent if somebody
happened to notice.

Attempts are counted in a field on the document rather than by counting DI Log
rows. A failed post calls frappe.throw, the throw rolls the transaction back, and
the log entry written moments earlier goes with it — so DI Log cannot be trusted
to say how many times we have tried.
"""

import frappe
from frappe import _
from frappe.utils import add_days, cint, today

# Give up after this many attempts. A permanently bad invoice — wrong NTN,
# missing HS code — must not be retried forever.
MAX_ATTEMPTS = 5

# An invoice that has been failing for a fortnight needs a person, not another
# retry.
LOOKBACK_DAYS = 14

ALERT_ROLES = ("Accounts Manager", "System Manager")

TARGETS = (
	("Sales Invoice", "di_integration_id", "posting_date"),
	("Purchase Invoice", "di_integration_id", "posting_date"),
	("Sale Tax Invoice", "fbr_invoice_no", "invoice_date"),
)


def retry_failed_posts():
	"""Re-post submitted invoices that never received an FBR invoice number."""
	cutoff = add_days(today(), -LOOKBACK_DAYS)
	retried = 0
	recovered = 0
	exhausted = 0

	for doctype, posted_field, date_field in TARGETS:
		for name in _pending(doctype, posted_field, date_field, cutoff):
			attempts = cint(frappe.db.get_value(doctype, name, "di_post_attempts"))
			if attempts >= MAX_ATTEMPTS:
				continue

			retried += 1
			try:
				_repost(doctype, name)
				frappe.db.commit()
				if frappe.db.get_value(doctype, name, posted_field):
					recovered += 1
			except Exception:
				frappe.db.rollback()
				attempts += 1
				# Written after the rollback so the count survives.
				frappe.db.set_value(
					doctype, name, "di_post_attempts", attempts, update_modified=False
				)
				frappe.db.commit()
				if attempts >= MAX_ATTEMPTS:
					exhausted += 1
					_alert_exhausted(doctype, name, attempts)

	return {"retried": retried, "recovered": recovered, "exhausted": exhausted}


def _pending(doctype, posted_field, date_field, cutoff):
	if not frappe.db.exists("DocType", doctype):
		return []

	meta = frappe.get_meta(doctype)
	if not (meta.has_field(posted_field) and meta.has_field("di_post_attempts")):
		return []

	return frappe.get_all(
		doctype,
		filters={
			"docstatus": 1,
			posted_field: ["in", ["", None]],
			date_field: [">=", cutoff],
		},
		pluck="name",
		limit_page_length=0,
	)


def _repost(doctype, name):
	doc = frappe.get_doc(doctype, name)

	if doctype == "Sale Tax Invoice":
		from di.integrations.sale_tax_invoice_api import post_sale_tax_invoice

		post_sale_tax_invoice(doc, resync=True)
		return

	from di.integrations.di_api import post_invoice

	post_invoice(doc, resync=True)


def _alert_exhausted(doctype, name, attempts):
	"""Tell the accounts team once, when we stop trying."""
	subject = _("FBR submission gave up on {0} {1}").format(doctype, name)
	if frappe.db.exists("Notification Log", {"document_type": doctype, "document_name": name, "subject": subject}):
		return

	message = _(
		"{0} {1} is submitted but still has no FBR invoice number after {2} attempts. "
		"Open it and check DI Log for the error FBR reported."
	).format(doctype, name, attempts)

	for user in _alert_recipients():
		frappe.get_doc(
			{
				"doctype": "Notification Log",
				"for_user": user,
				"type": "Alert",
				"subject": subject,
				"email_content": message,
				"document_type": doctype,
				"document_name": name,
			}
		).insert(ignore_permissions=True)

	frappe.db.commit()


def _alert_recipients():
	users = frappe.get_all(
		"Has Role",
		filters={"role": ["in", ALERT_ROLES], "parenttype": "User"},
		pluck="parent",
		limit_page_length=0,
	)
	if not users:
		return ["Administrator"]

	enabled = frappe.get_all(
		"User",
		filters={"name": ["in", sorted(set(users))], "enabled": 1},
		pluck="name",
		limit_page_length=0,
	)
	recipients = [u for u in enabled if u not in ("Guest",)]
	return recipients or ["Administrator"]
