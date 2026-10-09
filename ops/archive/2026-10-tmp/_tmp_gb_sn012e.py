import di.integrations.sale_tax_invoice_api as sti_api
from di.integrations.sale_tax_invoice_api import post_sale_tax_invoice, validate_sale_tax_invoice
from di.integrations.di_api import _is_valid_response
from di.sandbox_drafts import format_fbr_validation_errors

frappe.set_user("Administrator")

item = frappe.get_doc("Tax Item", "SN012 Golden Ball International")
item.hs_code = "2710.1210"
item.product_uom = "Liter"
item.tax_desc = "18%"
item.rate_in_p = 18
item.save(ignore_permissions=True)
frappe.db.commit()

doc = frappe.get_doc("Sale Tax Invoice", "STI-0073")
doc.fbr_environment = "Sandbox"
doc.save(ignore_permissions=True)
frappe.db.commit()

_orig = sti_api._build_item_payload
combos = []
for levy in ["Motor Spirit", "HSD", "High Speed Diesel", "PMG", "Premier Motor Gasoline", "Kerosene", "1", 1]:
	for desc in ["Motor Spirit", "Petroleum Products", "SN012 Golden Ball International"]:
		combos.append((levy, desc))

for levy, desc in combos:
	def _build(row, levy=levy, desc=desc):
		payload = _orig(row)
		payload["petroleumLevyOn"] = levy
		payload["productDescription"] = desc
		return payload
	sti_api._build_item_payload = _build
	doc.reload()
	try:
		resp = validate_sale_tax_invoice(doc)
	except Exception as exc:
		print("ERR", levy, desc, str(exc)[:180])
		continue
	if not _is_valid_response(resp):
		print("INV", levy, desc, format_fbr_validation_errors(resp)[:180])
		continue
	print("VALID", levy, desc)
	doc.reload()
	try:
		post_sale_tax_invoice(doc)
		if doc.fbr_invoice_no:
			doc.submit()
			frappe.db.commit()
			print("POSTED", doc.name, doc.fbr_invoice_no)
			break
	except Exception as exc:
		frappe.db.rollback()
		print("POST", levy, desc, str(exc)[:220])
		doc = frappe.get_doc("Sale Tax Invoice", "STI-0073")
else:
	print("SN012 still open")
