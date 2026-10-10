frappe.set_user("Administrator")

rows = frappe.get_all(
	"Sale Tax Invoice",
	filters={"seller__business_name": "Kashif Altaf"},
	fields=[
		"name",
		"docstatus",
		"buyer",
		"scenario_id",
		"fbr_environment",
		"fbr_invoice_no",
		"invoice_date",
		"modified",
	],
	order_by="scenario_id, docstatus, name",
)
print("total", len(rows))
for r in rows:
	print(
		r.name,
		"ds",
		r.docstatus,
		r.fbr_environment,
		r.scenario_id,
		r.buyer,
		r.fbr_invoice_no or "-",
	)

print("--- counts ---")
from collections import Counter
print("by docstatus", Counter(r.docstatus for r in rows))
print("by env", Counter(r.fbr_environment for r in rows))
print("submitted with fbr", sum(1 for r in rows if r.docstatus == 1 and r.fbr_invoice_no))
print("submitted no fbr", sum(1 for r in rows if r.docstatus == 1 and not r.fbr_invoice_no))
print("drafts", sum(1 for r in rows if r.docstatus == 0))
