import di.integrations.sale_tax_invoice_api as sti_api
from di.integrations.sale_tax_invoice_api import post_sale_tax_invoice, validate_sale_tax_invoice
from di.integrations.di_api import _is_valid_response
from di.sandbox_drafts import format_fbr_validation_errors

frappe.set_user("Administrator")

hs = frappe.get_doc("HS Code", "2710.1210")
print("HS fields", {k: hs.get(k) for k in ["name", "description", "short_description"]})

item = frappe.get_doc("Tax Item", "SN012 Golden Ball International")
item.hs_code = "2710.1210"
item.product_uom = "Liter"
item.tax_desc = "18%"
item.rate_in_p = 18
item.save(ignore_permissions=True)
frappe.db.commit()

name = frappe.db.get_value(
	"Sale Tax Invoice",
	{"seller__business_name": "Golden Ball International", "scenario_id": "SN012", "docstatus": 0},
	"name",
)
doc = frappe.get_doc("Sale Tax Invoice", name)
doc.fbr_environment = "Sandbox"
doc.invoice_items[0].description = "SN012 Golden Ball International"
doc.save(ignore_permissions=True)
frappe.db.commit()
doc.reload()

_orig = sti_api._build_item_payload
descs = [
	(hs.short_description or "").strip(),
	(hs.description or "").strip()[:120],
	"MOTOR SPIRIT",
	"Motor Spirit / Petrol",
	"Light oils and preparations",
]
descs = [d for d in descs if d]

for desc in descs:
	def _build(row, desc=desc):
		payload = _orig(row)
		payload["petroleumLevyOn"] = 1
		payload["productDescription"] = desc
		return payload
	sti_api._build_item_payload = _build
	doc.reload()
	try:
		resp = validate_sale_tax_invoice(doc)
		valid = _is_valid_response(resp)
		print("VAL", desc[:80], "OK" if valid else format_fbr_validation_errors(resp)[:220])
	except Exception as exc:
		print("VAL ERR", desc[:80], str(exc)[:220])
		valid = False
	if not valid:
		continue
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
		print("POST ERR", desc[:80], str(exc)[:300])
		doc = frappe.get_doc("Sale Tax Invoice", name)
else:
	print("still failing")
