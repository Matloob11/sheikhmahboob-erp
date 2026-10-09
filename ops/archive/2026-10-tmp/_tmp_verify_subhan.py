import frappe

frappe.init(site="sheikhmahboob.com")
frappe.connect()

email = "subhan.enterprise12@gmail.com"
print("roles", frappe.get_roles(email))
print(
	"sellers",
	frappe.get_all(
		"Client Panel Seller",
		filters={"parent": email, "parenttype": "Client Panel"},
		pluck="seller",
	),
)
print(
	"user_perm",
	frappe.get_all(
		"User Permission",
		filters={"user": email, "allow": "Seller Or Company"},
		pluck="for_value",
	),
)
for dt in [
	"Sale Tax Invoice",
	"Buyer",
	"Tax Item",
	"Seller Or Company",
	"HS Code",
	"HS Uom",
	"Scenario",
	"Sandbox Scenario",
	"Transaction Type",
	"SRO Schedule",
	"SRO Item",
]:
	print(
		dt,
		"read=",
		frappe.has_permission(dt, "read", user=email),
		"create=",
		frappe.has_permission(dt, "create", user=email),
	)

frappe.destroy()
