"""Inspect STI-0332 and run FBR validate (no post/submit)."""

import json

import frappe

frappe.init(site="sheikhmahboob.com")
frappe.connect()

name = "STI-0332"
if not frappe.db.exists("Sale Tax Invoice", name):
	print("MISSING", name)
	frappe.destroy()
	raise SystemExit(1)

doc = frappe.get_doc("Sale Tax Invoice", name)
d = doc.as_dict()
meta = {
	"name": doc.name,
	"docstatus": doc.docstatus,
	"fbr_environment": doc.get("fbr_environment"),
	"fbr_invoice_no": doc.get("fbr_invoice_no"),
	"seller": doc.get("seller__business_name"),
	"buyer": doc.get("buyer"),
	"buyer_ntncnic": doc.get("buyer_ntncnic"),
	"buyer_registration_type": doc.get("buyer_registration_type"),
	"invoice_date": str(doc.get("invoice_date")),
	"invoice_type": doc.get("invoice_type"),
	"scenario_id": doc.get("scenario_id"),
}
print("META", json.dumps(meta, default=str, indent=2))

items = []
for row in doc.get("invoice_items") or []:
	items.append(
		{
			"description": row.get("description"),
			"hs_code": row.get("hs_code"),
			"uom": row.get("uom"),
			"sale_type": row.get("sale_type"),
			"rate": row.get("rate_in_percentage"),
			"qty": row.get("quantity"),
			"value_ex_st": row.get("value_sales_excluding_st"),
			"st": row.get("sales_tax_applicable"),
			"total": row.get("total_values"),
			"sro_schedule": row.get("sro_schedule_no"),
			"sro_item": row.get("sro_item_serial_no"),
		}
	)
print("ITEMS", json.dumps(items, default=str, indent=2))

logs = frappe.get_all(
	"DI Log",
	filters={"document_name": name},
	fields=["name", "status", "api_type", "creation", "title", "error_code", "error_message"],
	order_by="creation desc",
	limit=5,
)
print("LOGS", json.dumps(logs, default=str, indent=2))

from di.integrations.sale_tax_invoice_api import (
	_get_environment,
	_get_validate_url,
	build_sale_tax_invoice_payload,
	validate_sale_tax_invoice,
)

print("ENV", _get_environment(doc))
print("VALIDATE_URL", _get_validate_url(doc))
payload = build_sale_tax_invoice_payload(doc)
print("PAYLOAD", json.dumps(payload, default=str, indent=2)[:5000])
print("---VALIDATE---")
try:
	response = validate_sale_tax_invoice(doc)
	print("RESPONSE", json.dumps(response, default=str, indent=2)[:8000])
	vr = response.get("validationResponse") or {}
	print(
		"SUMMARY",
		json.dumps(
			{
				"status": vr.get("status"),
				"statusCode": vr.get("statusCode"),
				"errorCode": vr.get("errorCode"),
				"error": vr.get("error"),
				"invoiceStatuses": vr.get("invoiceStatuses"),
			},
			default=str,
			indent=2,
		),
	)
except Exception as e:
	print("EXCEPTION", type(e).__name__, str(e)[:4000])

frappe.destroy()
