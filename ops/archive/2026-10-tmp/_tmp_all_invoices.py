from collections import Counter, defaultdict

frappe.set_user("Administrator")

rows = frappe.get_all(
	"Sale Tax Invoice",
	fields=[
		"name",
		"docstatus",
		"buyer",
		"seller__business_name",
		"scenario_id",
		"fbr_environment",
		"fbr_invoice_no",
		"modified",
	],
	order_by="seller__business_name, scenario_id, docstatus, name",
)
print("total", len(rows))
print("docstatus", Counter(r.docstatus for r in rows))
print("env", Counter(r.fbr_environment for r in rows))

print("\n=== drafts ===")
for r in rows:
	if r.docstatus == 0:
		print(r.name, r.seller__business_name, r.scenario_id, r.buyer, r.fbr_environment)

print("\n=== cancelled ===")
for r in rows:
	if r.docstatus == 2:
		print(r.name, r.seller__business_name, r.scenario_id)

print("\n=== duplicate submitted scenarios ===")
key_rows = defaultdict(list)
for r in rows:
	if r.docstatus == 1:
		key_rows[(r.seller__business_name, r.fbr_environment, r.scenario_id)].append(r)
for key, items in key_rows.items():
	if len(items) > 1:
		print(key, [(i.name, i.buyer, i.fbr_invoice_no) for i in items])
