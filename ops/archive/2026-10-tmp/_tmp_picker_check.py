frappe.set_user("Administrator")
from di.invoice_picker import get_sale_invoice_company_cards

data = get_sale_invoice_company_cards()
print("companies", len(data["companies"]))
for row in data["companies"][:8]:
	print(row["name"], "sb", row["sandbox"], "pr", row["production"], row["ntn"])
