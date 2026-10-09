import di.integrations.sale_tax_invoice_api as sti_api
from di.integrations.reference_api import get_sro_schedules_for_rate, get_sro_items_for_schedule
from di.integrations.sale_tax_invoice_api import post_sale_tax_invoice
from frappe.utils import nowdate

frappe.set_user("Administrator")

print("sale types", [r.name for r in frappe.get_all("Transaction Type", filters={"name": ["like", "%etrol%"]})])
print("sro 653", get_sro_schedules_for_rate(653, company="Golden Ball International"))
print("sro 645", get_sro_schedules_for_rate(645, company="Golden Ball International"))
try:
	print("items 404", get_sro_items_for_schedule(404, company="Golden Ball International"))
except Exception as e:
	print("items 404", e)

SELLER = "Golden Ball International"
UNREG = "Walk-in Buyer (Unregistered)"
ITEM = "MOTOR SPIRIT"

if not frappe.db.exists("Tax Item", ITEM):
	frappe.get_doc({
		"doctype": "Tax Item",
		"seller": SELLER,
		"product_description": ITEM,
		"hs_code": "2710.1210",
		"product_uom": "Liter",
		"tax_desc": "1.43%",
		"rate_in_p": 1.43,
		"rate_id": 653,
		"transaction_type": "Petroleum Products",
		"fixed_rs": 0,
	}).insert(ignore_permissions=True)
	frappe.db.commit()
else:
	doc = frappe.get_doc("Tax Item", ITEM)
	doc.seller = SELLER
	doc.hs_code = "2710.1210"
	doc.product_uom = "Liter"
	doc.tax_desc = "1.43%"
	doc.rate_in_p = 1.43
	doc.rate_id = 653
	doc.transaction_type = "Petroleum Products"
	doc.save(ignore_permissions=True)
	frappe.db.commit()

inv = frappe.get_doc({
	"doctype": "Sale Tax Invoice",
	"invoice_type": "Sale Invoice",
	"invoice_date": nowdate(),
	"scenario_id": "SN012",
	"fbr_environment": "Sandbox",
	"buyer": UNREG,
	"seller__business_name": SELLER,
	"invoice_items": [{
		"description": ITEM,
		"quantity": 123,
		"sale_rate": 100,
		"sro_schedule_no": "1450(I)/2021",
		"sro_item_serial_no": "1",
		"sales_tax_withheld_at_source": 2,
	}],
})
inv.insert(ignore_permissions=True)
frappe.db.commit()
print("created", inv.name)

_orig = sti_api._build_item_payload
attempts = [
	{"petroleumLevyOn": 123, "productDescription": "MOTOR SPIRIT"},
	{"petroleumLevyOn": 123, "productDescription": "Petroleum Product"},
	{"petroleumLevyOn": 1, "productDescription": "MOTOR SPIRIT"},
	{"petroleumLevyOn": 123, "productDescription": "TEST"},
	{"petroleumLevyOn": 123},
]

for extra in attempts:
	def _build(row, extra=extra):
		payload = _orig(row)
		payload.update(extra)
		if "productDescription" not in extra:
			payload["productDescription"] = ITEM
		# official sample extras
		payload["extraTax"] = 0
		return payload
	sti_api._build_item_payload = _build
	doc = frappe.get_doc("Sale Tax Invoice", inv.name)
	doc.fbr_environment = "Sandbox"
	try:
		post_sale_tax_invoice(doc)
		if doc.fbr_invoice_no:
			doc.submit()
			frappe.db.commit()
			print("POSTED", doc.name, doc.fbr_invoice_no, extra)
			break
	except Exception as exc:
		frappe.db.rollback()
		print("FAIL", extra, str(exc)[:280])
else:
	print("all post attempts failed", inv.name)
