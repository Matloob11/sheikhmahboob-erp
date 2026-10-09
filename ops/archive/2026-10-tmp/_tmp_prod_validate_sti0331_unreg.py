"""Retry production validate for STI-0331 with Unregistered buyer type.

FBR 0053 said Registration type does not match Buyer's profile when we sent Registered.
Does not post/submit.
"""

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
buyer_name = doc.buyer

buyer = frappe.get_doc("Buyer", buyer_name)
print("BUYER_BEFORE", buyer.buyer_ntncnic, buyer.buyer_registration_type)
buyer.buyer_registration_type = "Unregistered"
buyer.save(ignore_permissions=True)

if (doc.fbr_environment or "").strip() != "Production":
	doc.db_set("fbr_environment", "Production", update_modified=False)

doc.reload()
# Refresh buyer fields onto invoice
doc.buyer_registration_type = "Unregistered"
doc.save(ignore_permissions=True)
frappe.db.commit()
doc.reload()

print("ENV", _get_environment(doc), _get_validate_url(doc))
payload = build_sale_tax_invoice_payload(doc)
print("buyerRegistrationType", payload.get("buyerRegistrationType"))
print("buyerNTNCNIC", payload.get("buyerNTNCNIC"))
print("---PROD_VALIDATE---")
response = validate_sale_tax_invoice(doc)
print("RESPONSE", json.dumps(response, default=str, indent=2)[:8000])
vr = response.get("validationResponse") or {}
print(
	"SUMMARY",
	{
		"status": vr.get("status"),
		"errorCode": vr.get("errorCode"),
		"error": vr.get("error"),
		"invoiceStatuses": vr.get("invoiceStatuses"),
	},
)
frappe.db.commit()
frappe.destroy()
