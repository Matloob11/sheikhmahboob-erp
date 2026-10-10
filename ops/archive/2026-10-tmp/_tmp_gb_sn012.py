import di.integrations.sale_tax_invoice_api as sti_api
from di.integrations.di_api import _is_valid_response
from di.integrations.sale_tax_invoice_api import validate_sale_tax_invoice
from di.sandbox_drafts import format_fbr_validation_errors

frappe.set_user("Administrator")

_orig_build = sti_api._build_item_payload
DESCS = [
	"Motor Spirit",
	"Petroleum Product",
	"High Speed Diesel",
	"Petrol",
	"HSD",
	"MS",
]


def patch(desc, levy=1):
	def _build(row):
		payload = _orig_build(row)
		payload["petroleumLevyOn"] = levy
		payload["productDescription"] = desc
		return payload
	sti_api._build_item_payload = _build


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
	order_by="creation desc",
)
doc = frappe.get_doc("Sale Tax Invoice", name)
doc.fbr_environment = "Sandbox"
doc.invoice_items[0].description = "SN012 Golden Ball International"
doc.save(ignore_permissions=True)
frappe.db.commit()
doc.reload()

ok = False
reason = ""
for desc in DESCS:
	for levy in (1, 0, 80):
		patch(desc, levy)
		try:
			resp = validate_sale_tax_invoice(doc)
		except Exception as exc:
			reason = str(exc)[:300]
			print("ERR", desc, levy, reason)
			continue
		if _is_valid_response(resp):
			print("VALID", desc, levy)
			doc.reload()
			try:
				doc.submit()
				frappe.db.commit()
				doc.reload()
				print("POSTED SN012", doc.name, doc.fbr_invoice_no)
				ok = True
			except Exception as exc:
				frappe.db.rollback()
				reason = str(exc)[:300]
				print("POST FAIL", desc, levy, reason)
				doc = frappe.get_doc("Sale Tax Invoice", name)
			if ok:
				break
		else:
			reason = format_fbr_validation_errors(resp)[:300]
			print("INV", desc, levy, reason)
	if ok:
		break

if not ok:
	print("FAILED", reason)
