"""Fetch FBR UOM for HS 8421.2100, fix STI-0331, production validate. No post."""

import json

import frappe

frappe.init(site="sheikhmahboob.com")
frappe.connect()

from di.integrations.reference_api import fetch_hs_code_uom
from di.integrations.sale_tax_invoice_api import (
	build_sale_tax_invoice_payload,
	validate_sale_tax_invoice,
)

hs = "8421.2100"
seller = "SUBHAN ENTERPRISES"

print("HS_EXISTS", frappe.db.exists("HS Code", hs))
print("HS_CACHED_UOM", frappe.db.get_value("HS Code", hs, "uom") if frappe.db.exists("HS Code", hs) else None)

# Clear bad cache if SET is stored and rejected
cached = frappe.db.get_value("HS Code", hs, "uom") if frappe.db.exists("HS Code", hs) else None
if cached and str(cached).strip().upper() == "SET":
	frappe.db.set_value("HS Code", hs, "uom", "", update_modified=False)
	frappe.db.commit()
	print("CLEARED_SET_CACHE")

uom = fetch_hs_code_uom(hs, company=seller)
print("FETCHED_UOM", uom)

if not uom:
	# try with DI Settings company names
	for company in frappe.get_all("DI Settings", pluck="company"):
		print("TRY_COMPANY", company)
		uom = fetch_hs_code_uom(hs, company=company)
		print("FETCHED_UOM", company, uom)
		if uom:
			break

if not uom:
	raise SystemExit("NO_UOM_FROM_FBR")

name = "STI-0331"
doc = frappe.get_doc("Sale Tax Invoice", name)
doc.db_set("fbr_environment", "Production", update_modified=False)

# FBR rejected Registered for NTN 9020028; keep Unregistered for validate match.
if doc.buyer and frappe.db.exists("Buyer", doc.buyer):
	frappe.db.set_value("Buyer", doc.buyer, "buyer_registration_type", "Unregistered")
doc.buyer_registration_type = "Unregistered"

for row in doc.invoice_items:
	row.uom = uom

doc.save(ignore_permissions=True)
frappe.db.commit()
doc.reload()

payload = build_sale_tax_invoice_payload(doc)
print(
	"PAYLOAD_ITEM",
	{
		"uoM": payload["items"][0]["uoM"],
		"hsCode": payload["items"][0]["hsCode"],
		"buyerRegistrationType": payload["buyerRegistrationType"],
		"buyerNTNCNIC": payload["buyerNTNCNIC"],
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
