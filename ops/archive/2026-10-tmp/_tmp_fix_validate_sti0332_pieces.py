"""STI-0332: switch to FBR piece-UOM HS codes, Production validate, no submit."""

from __future__ import annotations

import json

import frappe

frappe.init(site="sheikhmahboob.com")
frappe.connect()

from di.integrations.reference_api import fetch_hs_code_uom
from di.integrations.sale_tax_invoice_api import (
	_get_environment,
	_get_validate_url,
	build_sale_tax_invoice_payload,
	validate_sale_tax_invoice,
)

NAME = "STI-0332"
SELLER = "SUBHAN ENTERPRISES"
PIECES = "Numbers, pieces, units"

# Closest HS that FBR allows with pieces (not the original KG-only codes).
ASSIGN = {
	"Kingtox Mosquitos spray 300ml": "3307.9010",
	"Scotch Bright Foam": "9603.5000",
	"SOAP Tibet Hand Wash 50gm": "3402.5000",
	"Broom Ring Iron": "9603.9000",
	"Broom Handle Wood": "9603.9000",
	"Duster Cloth Yellow 2' x 1'": "9603.9000",
	"Acid 600ml Fine Quality": "3402.5000",
	"Broom Sar Jhaaro": "9603.1000",
	"Dishwash Soap Sufi 150gm": "3402.5000",
	"Plastic Loota Fine Quality": "3924.9000",
	"Jala Brush Fine Quality": "9603.2900",
	"Toilet Brush Fine Quality": "9603.2900",
	"Tissue Box Pop-up Rose Petal": "3924.9000",  # box sold as piece; paper HS are KG-only
	"Harpic Blue 225ml": "3402.5000",
	"Phenyl Typhon 2.5Ltr": "3402.5000",
	"Lock China Medium Size Fine Quality": "8301.1000",
	"Pojara Cotton 1.5Kg": "9603.9000",
	"Air Freshner Cobra 300ml": "3307.9010",
	"Detergent Surf": "3402.5000",
	"Broom Bansi Jhaaro Fine quality": "9603.1000",
}

# Confirm UOM pieces for assigned codes
needed = sorted(set(ASSIGN.values()))
for hs in needed:
	if not frappe.db.exists("HS Code", hs):
		raise SystemExit(f"HS_MISSING {hs}")
	uom = (frappe.db.get_value("HS Code", hs, "uom") or "").strip()
	if uom != PIECES:
		frappe.db.set_value("HS Code", hs, "uom", "", update_modified=False)
		frappe.db.commit()
		uom = fetch_hs_code_uom(hs, company=SELLER)
	print("HS_UOM", hs, uom)
	if uom != PIECES:
		raise SystemExit(f"NOT_PIECES {hs} {uom}")

doc = frappe.get_doc("Sale Tax Invoice", NAME)
before = [
	{
		"idx": row.idx,
		"item": row.description,
		"hs": row.hs_code,
		"uom": row.uom,
	}
	for row in doc.invoice_items
]
print("BEFORE", json.dumps(before, indent=2))

doc.db_set("fbr_environment", "Production", update_modified=False)
if doc.buyer and frappe.db.exists("Buyer", doc.buyer):
	frappe.db.set_value("Buyer", doc.buyer, "buyer_registration_type", "Unregistered")

for row in doc.invoice_items:
	item = row.description
	hs = ASSIGN.get(item)
	if not hs:
		raise SystemExit(f"UNMAPPED {item}")
	if item and frappe.db.exists("Tax Item", item):
		ti = frappe.get_doc("Tax Item", item)
		ti.hs_code = hs
		ti.product_uom = PIECES
		ti.save(ignore_permissions=True)
		print("TAX_ITEM", item, hs)
	row.hs_code = hs
	row.uom = PIECES

doc.buyer_registration_type = "Unregistered"
doc.save(ignore_permissions=True)
frappe.db.commit()
doc.reload()

print("ENV", _get_environment(doc), _get_validate_url(doc))
payload = build_sale_tax_invoice_payload(doc)
print(
	"PAYLOAD_ITEMS",
	[(i + 1, it["productDescription"][:36], it["hsCode"], it["uoM"]) for i, it in enumerate(payload["items"])],
)

response = validate_sale_tax_invoice(doc)
vr = response.get("validationResponse") or {}
statuses = vr.get("invoiceStatuses") or []
bad = [s for s in statuses if s.get("status") != "Valid"]
print("STATUS", vr.get("status"), vr.get("statusCode"))
print("BAD_COUNT", len(bad), "OF", len(statuses))
if bad:
	print("BAD", json.dumps(bad, default=str, indent=2)[:5000])
else:
	print("ALL_VALID")

after = [
	{"idx": row.idx, "item": row.description, "hs": row.hs_code, "uom": row.uom}
	for row in doc.invoice_items
]
print("AFTER", json.dumps(after, indent=2))
frappe.db.commit()
frappe.destroy()
