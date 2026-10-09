from di.integrations.reference_api import _get_token, _make_get_request
from di.integrations.sale_tax_invoice_api import build_sale_tax_invoice_payload
from di.constants import REF_BASE_V1, REF_BASE_V2
import di.integrations.sale_tax_invoice_api as sti_api

print("Scenario SN012", frappe.db.get_value("Scenario", "SN012", ["sale__purchase_type", "scenario_description"], as_dict=True))

name = frappe.db.get_value(
	"Sale Tax Invoice",
	{"seller__business_name": "Golden Ball International", "scenario_id": "SN012", "docstatus": 0},
	"name",
)
print("draft", name)
doc = frappe.get_doc("Sale Tax Invoice", name)
print("sale_type line", [(r.description, r.sale_type, r.hs_code, r.uom) for r in doc.invoice_items])
print("item", frappe.db.get_value("Tax Item", "SN012 Golden Ball International", ["hs_code", "product_uom", "product_description"], as_dict=True))
print("hs desc", frappe.db.get_value("HS Code", "2710.1210", ["description", "short_description"], as_dict=True))

payload = build_sale_tax_invoice_payload(doc)
print("payload items", payload.get("items"))

token = _get_token("Golden Ball International")
for path in [
	"/pdi/v1/STATL",
	"/pdi/v2/STATL",
	"/pdi/v2/PetroleumLevy",
	"/pdi/v1/PetroleumLevy",
	"/pdi/v2/petroleumlevy",
	"/di_data/v1/di/getpetroleuminlevy",
]:
	try:
		rows = _make_get_request("https://gw.fbr.gov.pk" + path, token, path)
		print(path, str(rows)[:400])
	except Exception as e:
		print(path, str(e)[:160])
