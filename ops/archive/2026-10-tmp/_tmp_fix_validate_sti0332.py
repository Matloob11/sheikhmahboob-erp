"""Fix STI-0332 UOMs from FBR HS_UOM, set Production, validate. No post/submit."""

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


def resolve_uom(hs_code: str, force: bool = True) -> str | None:
	if not hs_code or not frappe.db.exists("HS Code", hs_code):
		print("HS_MISSING", hs_code)
		return None
	if force:
		frappe.db.set_value("HS Code", hs_code, "uom", "", update_modified=False)
		frappe.db.commit()
	else:
		cached = (frappe.db.get_value("HS Code", hs_code, "uom") or "").strip()
		if cached:
			print("HS_CACHE", hs_code, cached)
			return cached
	companies = [SELLER] + list(frappe.get_all("DI Settings", pluck="company") or [])
	seen = set()
	for company in companies + [None]:
		if company in seen:
			continue
		seen.add(company)
		try:
			uom = fetch_hs_code_uom(hs_code, company=company)
		except Exception as e:
			print("FETCH_ERR", hs_code, company, type(e).__name__, str(e)[:300])
			uom = None
		if uom:
			print("HS_FETCH", hs_code, uom, "via", company)
			return uom
	return None


doc = frappe.get_doc("Sale Tax Invoice", NAME)
doc.db_set("fbr_environment", "Production", update_modified=False)

# Same buyer NTN FBR rejected as Registered on STI-0331.
if doc.buyer and frappe.db.exists("Buyer", doc.buyer):
	frappe.db.set_value("Buyer", doc.buyer, "buyer_registration_type", "Unregistered")
	# Strip suffix like 9020028-3 if present — payload earlier used 9020028
	ntn = (frappe.db.get_value("Buyer", doc.buyer, "buyer_ntncnic") or "").strip()
	if "-" in ntn:
		base = ntn.split("-")[0].strip()
		if base:
			frappe.db.set_value("Buyer", doc.buyer, "buyer_ntncnic", base)
			print("BUYER_NTN_STRIPPED", ntn, "->", base)

hs_codes = sorted({(row.hs_code or "").strip() for row in doc.invoice_items if row.hs_code})
uom_by_hs: dict[str, str] = {}
for hs in hs_codes:
	uom = resolve_uom(hs)
	if not uom:
		# Force refetch even if bad cache
		frappe.db.set_value("HS Code", hs, "uom", "", update_modified=False)
		frappe.db.commit()
		uom = resolve_uom(hs)
	if not uom:
		raise SystemExit(f"NO_UOM_FOR {hs}")
	uom_by_hs[hs] = uom

print("UOM_MAP", json.dumps(uom_by_hs, indent=2))

# Update Tax Items (invoice sync overwrites line UOM from Tax Item)
for row in doc.invoice_items:
	hs = (row.hs_code or "").strip()
	desc = row.description
	uom = uom_by_hs.get(hs)
	if not uom:
		continue
	if desc and frappe.db.exists("Tax Item", desc):
		current = frappe.db.get_value("Tax Item", desc, "product_uom")
		if current != uom:
			frappe.db.set_value("Tax Item", desc, "product_uom", uom, update_modified=False)
			print("TAX_ITEM_UOM", desc, current, "->", uom)
	row.uom = uom

doc.buyer_registration_type = "Unregistered"
doc.save(ignore_permissions=True)
frappe.db.commit()
doc.reload()

print("ENV", _get_environment(doc), _get_validate_url(doc))
payload = build_sale_tax_invoice_payload(doc)
print(
	"PAYLOAD_CHECK",
	{
		"reg": payload.get("buyerRegistrationType"),
		"ntn": payload.get("buyerNTNCNIC"),
		"seller_ntn": payload.get("sellerNTNCNIC"),
		"items": [
			{"sNo": i + 1, "hs": it["hsCode"], "uom": it["uoM"], "desc": it["productDescription"][:40]}
			for i, it in enumerate(payload["items"])
		],
	},
)

response = validate_sale_tax_invoice(doc)
vr = response.get("validationResponse") or {}
statuses = vr.get("invoiceStatuses") or []
print("SUMMARY_STATUS", vr.get("status"), vr.get("statusCode"))
bad = [s for s in statuses if s.get("status") != "Valid"]
print("BAD_COUNT", len(bad), "OF", len(statuses))
if bad:
	print("BAD", json.dumps(bad, default=str, indent=2)[:6000])
else:
	print("ALL_VALID")
print("RESPONSE_HEAD", json.dumps({"status": vr.get("status"), "error": vr.get("error"), "errorCode": vr.get("errorCode")}, indent=2))

# If still 0099, clear HS cache for failing lines and retry once with forced refetch
if vr.get("status") != "Valid":
	fail_hs = set()
	for s in bad:
		if s.get("errorCode") == "0099":
			idx = int(s.get("itemSNo") or 0) - 1
			if 0 <= idx < len(doc.invoice_items):
				fail_hs.add((doc.invoice_items[idx].hs_code or "").strip())
	print("RETRY_HS", sorted(fail_hs))
	for hs in fail_hs:
		frappe.db.set_value("HS Code", hs, "uom", "", update_modified=False)
	frappe.db.commit()
	for hs in fail_hs:
		uom = None
		for company in [SELLER] + list(frappe.get_all("DI Settings", pluck="company")):
			try:
				uom = fetch_hs_code_uom(hs, company=company)
			except Exception as e:
				print("REFETCH_ERR", hs, company, str(e)[:200])
				continue
			if uom:
				break
		if not uom:
			print("STILL_NO_UOM", hs)
			continue
		uom_by_hs[hs] = uom
		print("REFETCHED", hs, uom)

	doc.reload()
	for row in doc.invoice_items:
		hs = (row.hs_code or "").strip()
		uom = uom_by_hs.get(hs)
		if not uom:
			continue
		if row.description and frappe.db.exists("Tax Item", row.description):
			frappe.db.set_value("Tax Item", row.description, "product_uom", uom, update_modified=False)
		row.uom = uom
	doc.buyer_registration_type = "Unregistered"
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	doc.reload()
	payload = build_sale_tax_invoice_payload(doc)
	print(
		"RETRY_PAYLOAD_UOMS",
		[(i + 1, it["hsCode"], it["uoM"]) for i, it in enumerate(payload["items"])],
	)
	response = validate_sale_tax_invoice(doc)
	vr = response.get("validationResponse") or {}
	statuses = vr.get("invoiceStatuses") or []
	bad = [s for s in statuses if s.get("status") != "Valid"]
	print("RETRY_STATUS", vr.get("status"))
	print("RETRY_BAD", json.dumps(bad, default=str, indent=2)[:6000])
	if vr.get("status") == "Valid":
		print("ALL_VALID")

frappe.db.commit()
frappe.destroy()
