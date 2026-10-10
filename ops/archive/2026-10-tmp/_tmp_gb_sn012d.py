import json
import di.integrations.sale_tax_invoice_api as sti_api
from di.integrations.sale_tax_invoice_api import build_sale_tax_invoice_payload

print("scenario", frappe.db.get_value("Scenario", "SN012", ["sn_no", "description", "sale__purchase_type"], as_dict=True))

name = frappe.db.get_value(
	"Sale Tax Invoice",
	{"seller__business_name": "Golden Ball International", "scenario_id": "SN012", "docstatus": 0},
	"name",
)
print("draft", name)
doc = frappe.get_doc("Sale Tax Invoice", name)
print("lines", [(r.description, r.sale_type, r.hs_code, r.uom, r.tax_rate_value) for r in doc.invoice_items])

_orig = sti_api._build_item_payload
def _build(row):
	payload = _orig(row)
	payload["petroleumLevyOn"] = 1
	payload["productDescription"] = "Petroleum Products"
	return payload
sti_api._build_item_payload = _build
print("payload", json.dumps(build_sale_tax_invoice_payload(doc), indent=2)[:2000])

print("=== last SN012 logs ===")
for row in frappe.get_all(
	"DI Log",
	filters={"reference_name": name},
	fields=["name", "api_type", "status", "error_message", "creation"],
	order_by="creation desc",
	limit=5,
):
	print(row)
