import json

import frappe

frappe.init(site="sheikhmahboob.com")
frappe.connect()

from di.integrations.sale_tax_invoice_api import (
	build_sale_tax_invoice_payload,
	validate_sale_tax_invoice,
)

name = "STI-0331"
doc = frappe.get_doc("Sale Tax Invoice", name)
payload = build_sale_tax_invoice_payload(doc)
print("PAYLOAD", json.dumps(payload, default=str, indent=2)[:6000])
print("---VALIDATE---")
try:
	response = validate_sale_tax_invoice(doc)
	print("RESPONSE", json.dumps(response, default=str, indent=2)[:8000])
except Exception as e:
	print("EXCEPTION", type(e).__name__, str(e)[:4000])

frappe.destroy()
