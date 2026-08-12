"""Scheduled work for Digital Invoicing.

This job used to re-post automatically. It no longer does, and that is
deliberate.

Once an invoice has been sent once, we cannot prove it was not filed. A read
timeout or a 5xx means the request reached FBR and only the answer was lost —
FBR may hold the invoice while `di_integration_id` here stays empty. Sending it
again then files the same sale twice against a real tax identity, and an FBR
submission cannot be withdrawn. The payload carries no client reference, so FBR
cannot deduplicate it either.

Retrying is therefore safe only where we know the request never left, and that
case is already handled inside di.integrations.http, which retries connection
failures immediately and never retries a read.

What is left for a scheduler is the part that was actually missing: noticing.
A submitted invoice with no FBR number is reported to the accounts team so a
person can look at DI Log and press Post to FBR. That is a decision with legal
weight, and it belongs to a person.
"""

import frappe
from frappe import _
from frappe.utils import add_days, cint, today

# Below this many days an invoice is still "today's problem" and the person who
# raised it is likely to fix it themselves; the alert would be noise.
QUIET_HOURS = 2

# Older than this and an alert helps nobody — it needs a conversation, not a
# notification.
LOOKBACK_DAYS = 30

ALERT_ROLES = ("Accounts Manager", "System Manager")

TARGETS = (
	("Sales Invoice", "di_integration_id", "posting_date"),
	("Purchase Invoice", "di_integration_id", "posting_date"),
	("Sale Tax Invoice", "fbr_invoice_no", "invoice_date"),
)


def alert_unposted_invoices():
	"""Report submitted invoices that never received an FBR invoice number."""
	cutoff = add_days(today(), -LOOKBACK_DAYS)
	found = 0
	alerted = 0

	for doctype, posted_field, date_field in TARGETS:
		for name in _pending(doctype, posted_field, date_field, cutoff):
			found += 1
			if _alert(doctype, name):
				alerted += 1

	if alerted:
		frappe.db.commit()

	return {"unposted": found, "alerted": alerted}


# Kept so an existing scheduler entry or a manual call does not break, and so it
# is obvious why it no longer posts anything.
def retry_failed_posts():
	return alert_unposted_invoices()


def _pending(doctype, posted_field, date_field, cutoff):
	if not frappe.db.exists("DocType", doctype):
		return []

	meta = frappe.get_meta(doctype)
	if not meta.has_field(posted_field):
		return []

	return frappe.get_all(
		doctype,
		filters={
			"docstatus": 1,
			posted_field: ["in", ["", None]],
			date_field: [">=", cutoff],
			"modified": ["<", frappe.utils.add_to_date(None, hours=-QUIET_HOURS)],
		},
		pluck="name",
		limit_page_length=0,
	)


def _alert(doctype, name):
	"""Notify once per document. Returns True if a notification was created."""
	subject = _("Not filed with FBR: {0} {1}").format(doctype, name)
	if frappe.db.exists(
		"Notification Log", {"document_type": doctype, "document_name": name, "subject": subject}
	):
		return False

	message = _(
		"{0} {1} is submitted but has no FBR invoice number. Open DI Log to see what FBR "
		"reported, then use Post to FBR once the cause is fixed.<br><br>"
		"It is not re-sent automatically: if the earlier attempt timed out, FBR may already "
		"hold this invoice, and filing it twice cannot be undone."
	).format(doctype, name)

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

	return True


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
	recipients = [u for u in enabled if u != "Guest"]
	return recipients or ["Administrator"]


def count_unposted():
	"""Small helper for dashboards and tests."""
	cutoff = add_days(today(), -LOOKBACK_DAYS)
	return cint(
		sum(len(_pending(dt, posted, date_field, cutoff)) for dt, posted, date_field in TARGETS)
	)
