"""Fix Tax Item UOM (source of SET overwrite), then production validate STI-0331. No post."""

import json

import frappe

frappe.init(site="sheikhmahboob.com")
frappe.connect()

from di.integrations.sale_tax_invoice_api import (
	build_sale_tax_invoice_payload,
	validate_sale_tax_invoice,
)

uom = "Numbers, pieces, units"
hs = "8421.2100"
name = "STI-0331"

# Confirm HS Code cache
if frappe.db.exists("HS Code", hs):
	frappe.db.set_value("HS Code", hs, "uom", uom, update_modified=False)

doc = frappe.get_doc("Sale Tax Invoice", name)
doc.db_set("fbr_environment", "Production", update_modified=False)

# FBR said Registered does not match this NTN profile.
if doc.buyer and frappe.db.exists("Buyer", doc.buyer):
	frappe.db.set_value("Buyer", doc.buyer, "buyer_registration_type", "Unregistered")

item_name = None
for row in doc.invoice_items:
	item_name = row.description
	print("ROW_DESC", item_name, "old_uom", row.uom)

if item_name and frappe.db.exists("Tax Item", item_name):
	item = frappe.get_doc("Tax Item", item_name)
	print("TAX_ITEM_BEFORE", item.hs_code, item.product_uom)
	item.product_uom = uom
	if hasattr(item, "hs_code") and not item.hs_code:
		item.hs_code = hs
	item.save(ignore_permissions=True)
	print("TAX_ITEM_AFTER", item.hs_code, item.product_uom)
else:
	print("TAX_ITEM_MISSING", item_name)

doc.reload()
doc.buyer_registration_type = "Unregistered"
for row in doc.invoice_items:
	row.uom = uom
doc.save(ignore_permissions=True)
frappe.db.commit()
doc.reload()

payload = build_sale_tax_invoice_payload(doc)
print(
	"PAYLOAD",
	{
		"uoM": payload["items"][0]["uoM"],
		"hs": payload["items"][0]["hsCode"],
		"reg": payload["buyerRegistrationType"],
		"ntn": payload["buyerNTNCNIC"],
		"env": doc.fbr_environment,
	},
)

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
