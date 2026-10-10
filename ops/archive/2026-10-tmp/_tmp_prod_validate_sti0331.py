"""Production validate only for STI-0331. Does not post/submit."""

import json

import frappe

frappe.init(site="sheikhmahboob.com")
frappe.connect()

from di.integrations.sale_tax_invoice_api import (
	_get_environment,
	_get_validate_url,
	build_sale_tax_invoice_payload,
	validate_sale_tax_invoice,
)

name = "STI-0331"
doc = frappe.get_doc("Sale Tax Invoice", name)

# Buyer must stay Registered for production sale to registered party.
buyer_name = doc.buyer
if buyer_name and frappe.db.exists("Buyer", buyer_name):
	buyer = frappe.get_doc("Buyer", buyer_name)
	print(
		"BUYER_BEFORE",
		{
			"name": buyer.name,
			"ntn": buyer.buyer_ntncnic,
			"reg": buyer.buyer_registration_type,
		},
	)
	if (buyer.buyer_registration_type or "").strip() != "Registered":
		buyer.buyer_registration_type = "Registered"
		buyer.save(ignore_permissions=True)
		frappe.db.commit()
		print("BUYER_SET_REGISTERED")

# Switch invoice to Production for validate (user will submit themselves).
if (doc.fbr_environment or "").strip() != "Production":
	doc.db_set("fbr_environment", "Production", update_modified=False)
	frappe.db.commit()
	doc.reload()

print("ENV", _get_environment(doc))
print("VALIDATE_URL", _get_validate_url(doc))
assert "pdi" not in _get_validate_url(doc).lower() or "validate" in _get_validate_url(doc).lower()
assert "/di_data/v1/di/validateinvoicedata" in _get_validate_url(doc)

payload = build_sale_tax_invoice_payload(doc)
print("HAS_SCENARIO", "scenarioId" in payload)
print("PAYLOAD", json.dumps(payload, default=str, indent=2)[:5000])
print("---PROD_VALIDATE---")
try:
	response = validate_sale_tax_invoice(doc)
	print("RESPONSE", json.dumps(response, default=str, indent=2)[:8000])
	vr = response.get("validationResponse") or {}
	print(
		"SUMMARY",
		{
			"status": vr.get("status"),
			"statusCode": vr.get("statusCode"),
			"errorCode": vr.get("errorCode"),
			"error": vr.get("error"),
			"invoiceStatuses": vr.get("invoiceStatuses"),
		},
	)
except Exception as e:
	print("EXCEPTION", type(e).__name__, str(e)[:4000])

frappe.db.commit()
frappe.destroy()
