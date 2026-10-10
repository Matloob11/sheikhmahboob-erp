frappe.set_user("Administrator")

# Drafts are extras. Kashif also has two submitted duplicates for SN001/SN002.
drafts = ["STI-0064", "STI-0067", "STI-0073"]
kashif_extras = ["STI-0043", "STI-0045"]


def remove(name, cancel_first=False):
	if not frappe.db.exists("Sale Tax Invoice", name):
		print("missing", name)
		return
	doc = frappe.get_doc("Sale Tax Invoice", name)
	print("remove", name, "ds", doc.docstatus, doc.scenario_id, doc.buyer, doc.fbr_invoice_no or "-")
	if cancel_first and int(doc.docstatus) == 1:
		doc.cancel()
		frappe.db.commit()
		doc.reload()
	frappe.delete_doc("Sale Tax Invoice", name, ignore_permissions=True, force=True)
	frappe.db.commit()
	print("deleted", name)


for name in drafts:
	remove(name, cancel_first=False)

for name in kashif_extras:
	remove(name, cancel_first=True)

left = frappe.get_all(
	"Sale Tax Invoice",
	filters={"seller__business_name": "Kashif Altaf"},
	fields=["name", "docstatus", "scenario_id", "buyer", "fbr_invoice_no"],
	order_by="scenario_id, name",
)
print("kashif left", len(left))
for r in left:
	print(r.name, r.docstatus, r.scenario_id, r.buyer)
